import {makeScene} from "./scene.mjs?v=44";

async function browserShader() {
  const response = await fetch(new URL("./trace.wgsl?v=44",import.meta.url));
  if (!response.ok) throw new Error("Could not load the WebGPU shader");
  return response.text();
}

export async function openGpu({gpu = globalThis.navigator?.gpu,loadShader = browserShader,
  bufferUsage = globalThis.GPUBufferUsage,mapMode = globalThis.GPUMapMode} = {}) {
  const adapter = await gpu?.requestAdapter();
  if (!adapter || adapter.info?.isFallbackAdapter) return null;
  const device = await adapter.requestDevice();
  try {
    const shader = device.createShaderModule({code:await loadShader(),label:"Jarecki/Mueller"});
    const problems = (await shader.getCompilationInfo()).messages.filter(message => message.type==="error");
    if (problems.length) throw new Error(problems.map(problem => problem.message).join("\n"));
    return new GpuRenderer(gpu,device,shader,bufferUsage,mapMode);
  } catch (error) {
    device.destroy();
    throw error;
  }
}

class GpuRenderer {
  constructor(gpu,device,shader,bufferUsage,mapMode) {
    // Keep the provider alive for the lifetime of its native Dawn device.
    this.gpu = gpu;
    this.device = device;
    this.shader = shader;
    this.bufferUsage = bufferUsage;
    this.mapMode = mapMode;
    this.pipelines = new Map();
    this.lost = false;
    void device.lost.then(() => {this.lost = true;});
  }

  async newEstimate(settings,seed = 0) {
    if (this.lost) throw new Error("WebGPU device lost");
    const channels = settings.channels==="mono" ? 1 : 3;
    if (!this.pipelines.has(channels)) {
      this.pipelines.set(channels,this.device.createComputePipelineAsync({
        layout:"auto",compute:{module:this.shader,entryPoint:"render",constants:{channels}},
      }));
    }
    const pipeline = await this.pipelines.get(channels);
    return new GpuEstimate(this.device,pipeline,settings,seed,this.bufferUsage,this.mapMode);
  }

  dispose() {
    this.device.destroy();
    this.gpu = null;
  }
}

function sceneBuffers(settings) {
  const {shapes,light,source,camera} = makeScene(settings);
  const unique = new Map();
  const geometry = new Float32Array(shapes.length*16);
  const materials = [];
  shapes.forEach((shape,index) => {
    if (!unique.has(shape.material)) {
      unique.set(shape.material,unique.size);
      for (const {coefficients,reflectance} of shape.material) {
        materials.push(...coefficients,reflectance,0,0);
      }
    }
    geometry.set([
      ...shape.corner,unique.get(shape.material),
      ...shape.u,shape.invU,...shape.v,shape.invV,...shape.normal,shape.area,
    ],index*16);
  });
  const params = new ArrayBuffer(7*16);
  new Uint32Array(params,0,4).set([settings.size,settings.max_depth,settings.rr_depth,shapes.indexOf(light)]);
  new Float32Array(params,16).set([
    ...camera.eye,camera.halfHeight,...camera.forward,0,...camera.right,0,...camera.up,0,
    ...source,0,...light.emission,
  ]);
  return [geometry,new Float32Array(materials),new Uint8Array(params)];
}

class GpuEstimate {
  constructor(device,pipeline,settings,seed,usage,mapMode) {
    this.device = device;
    this.pipeline = pipeline;
    this.settings = settings;
    this.seed = seed >>> 0;
    this.readMode = mapMode.READ;
    this.size = settings.size;
    this.channels = settings.channels==="mono" ? 1 : 3;
    this.samples = 0;
    this.batches = [];
    this.backend = "WebGPU";
    const bytes = this.size*this.size*this.channels*16;
    const buffer = (size,usage,data) => {
      const result = device.createBuffer({size,usage,mappedAtCreation:Boolean(data)});
      if (data) {
        new Uint8Array(result.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
        result.unmap();
      }
      return result;
    };
    const [geometry,materials,params] = sceneBuffers(settings);
    this.accumulation = buffer(bytes,usage.STORAGE|usage.COPY_SRC);
    const shapeBuffer = buffer(geometry.byteLength,usage.STORAGE,geometry);
    const materialBuffer = buffer(materials.byteLength,usage.STORAGE,materials);
    const paramsBuffer = buffer(params.byteLength,usage.UNIFORM,params);
    this.control = buffer(16,usage.UNIFORM|usage.COPY_DST);
    this.readback = buffer(bytes,usage.COPY_DST|usage.MAP_READ);
    const resources = [this.accumulation,shapeBuffer,materialBuffer,paramsBuffer,this.control];
    this.buffers = [...resources,this.readback];
    this.group = device.createBindGroup({
      layout:pipeline.getBindGroupLayout(0),
      entries:resources.map((resource,binding) => ({binding,resource:{buffer:resource}})),
    });
  }

  async addSamples(count,{readFilm = true} = {}) {
    const {device,control,accumulation,readback} = this;
    device.queue.writeBuffer(control,0,new Uint32Array([this.samples,count,this.seed,0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,this.group);
    pass.dispatchWorkgroups(Math.ceil(this.size/8),Math.ceil(this.size/4));
    pass.end();
    if (readFilm) encoder.copyBufferToBuffer(accumulation,0,readback,0,readback.size);
    device.queue.submit([encoder.finish()]);
    if (!readFilm) {
      await device.queue.onSubmittedWorkDone();
      this.recordBatch(count);
      return;
    }
    await readback.mapAsync(this.readMode);
    try {
      const sums = new Float32Array(readback.getMappedRange());
      this.recordBatch(count);
      const inverse = 1/this.samples;
      const pixels = new Float32Array(sums.length);
      for (let i=0; i<pixels.length; i++) pixels[i] = sums[i]*inverse;
      return {size:this.size,channels:this.channels,samples:this.samples,seed:this.seed,pixels,
        settings:this.settings,batches:this.batches.slice()};
    } finally {
      readback.unmap();
    }
  }

  recordBatch(count) {
    this.batches.push({seed:this.seed,first_sample:this.samples,spp:count});
    this.samples += count;
  }

  dispose() {
    for (const buffer of this.buffers) buffer.destroy();
  }
}
