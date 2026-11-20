import {Estimate} from "./renderer.mjs?v=52";
import {openGpu} from "./gpu.mjs?v=52";

let gpu;
let estimate;
let lastGpuFrame;
let remaining = 0;
let timer;
let inFlight = false;
let stopping = false;
let batchSize = 1;

function finishStop() {
  remaining = 0;
  stopping = false;
  postMessage({type:"stopped"});
}

function schedule() {
  timer = setTimeout(nextBatch,0);
}

async function nextBatch() {
  timer = undefined;
  inFlight = true;
  try {
    const started = performance.now();
    let count = Math.min(remaining,batchSize);
    let frame;
    let backend = "CPU";
    if (estimate.backend === "WebGPU") {
      try {
        frame = await estimate.addSamples(count);
        backend = "WebGPU";
        lastGpuFrame = {...frame,pixels:frame.pixels.slice()};
      } catch (error) {
        postMessage({type:"fallback",message:error.message});
        // GPU batches can be 64 samples; one CPU sample at 256 × 256 takes ~0.3 s, so restart small.
        count = Math.min(count,1);
        const cpu = new Estimate(estimate.settings);
        if (lastGpuFrame) {
          const {pixels,samples,batches} = lastGpuFrame;
          cpu.samples = samples;
          cpu.batches = batches.slice();
          for (let i=0; i<pixels.length; i++) cpu.sum[i] = pixels[i]*samples;
        }
        estimate.dispose();
        estimate = cpu;
        lastGpuFrame = undefined;
        void gpu.then(renderer => renderer?.dispose());
        gpu = Promise.resolve(null);
      }
    }
    if (!frame) {
      estimate.addSamples(count);
      frame = estimate.frame();
    }
    remaining -= count;
    const renderMs = performance.now()-started;
    // Keep the first image quick and bound Stop latency on slower GPUs.
    batchSize = Math.min(backend==="WebGPU" ? 64 : 8,Math.max(1,Math.floor(count*85/renderMs)));
    postMessage({type:"frame",frame,renderMs,remaining,backend,sentAt:performance.timeOrigin+performance.now()},[frame.pixels.buffer]);
  } catch (error) {
    remaining = 0;
    postMessage({type:"error",message:error.message});
  } finally {
    inFlight = false;
    if (stopping) finishStop();
    else if (remaining) schedule();
  }
}

async function renderFilm({type,settings,samples,seed,forceCpu}) {
  let gpuEstimate;
  if (!forceCpu) {
    try {
      gpu ??= openGpu();
      gpuEstimate = await (await gpu)?.newEstimate(settings,seed);
      if (gpuEstimate) {
        let frame;
        while (gpuEstimate.samples < samples) {
          const count = Math.min(32,samples-gpuEstimate.samples);
          frame = await gpuEstimate.addSamples(count,{readFilm:gpuEstimate.samples+count===samples});
        }
        return frame;
      }
    } catch (error) {
      postMessage({type:"fallback",message:error.message});
      // Stop retrying a broken GPU on every preview frame, as fresh renders already do.
      const failed = gpu;
      gpu = Promise.resolve(null);
      void failed?.then(renderer => renderer?.dispose(),() => {});
    } finally {
      gpuEstimate?.dispose();
    }
  }
  const cpuSettings = type==="preview" ? {...settings,size:Math.min(settings.size,64)} : settings;
  const cpuEstimate = new Estimate(cpuSettings,seed);
  cpuEstimate.addSamples(samples);
  return cpuEstimate.frame();
}

self.onmessage = async ({data}) => {
  if (data.type === "preview") {
    try {
      const frame = await renderFilm(data);
      postMessage({type:"preview",frame},[frame.pixels.buffer]);
    } catch {
      postMessage({type:"preview"});
    }
    return;
  }
  if (data.type === "stop") {
    clearTimeout(timer);
    stopping = true;
    if (!inFlight) finishStop();
    return;
  }
  if (data.type === "cap") {
    remaining = Math.max(0,Math.min(remaining,data.samples-(estimate?.samples ?? 0)));
    return;
  }
  if (data.type !== "fresh") return;
  inFlight = true;
  estimate?.dispose?.();
  lastGpuFrame = undefined;
  try {
    if (!data.forceCpu) {
      gpu ??= openGpu();
      estimate = await (await gpu)?.newEstimate(data.settings);
      if (!estimate) {
        let message = "WebGPU unavailable in worker";
        if (self.navigator?.gpu) {
          const adapter = await self.navigator.gpu.requestAdapter().catch(() => null);
          message = !adapter ? "No WebGPU adapter" :
            "Software fallback adapter"+(adapter.info?.description ? " ("+adapter.info.description+")" : "");
        }
        postMessage({type:"fallback",message});
      }
    } else {
      estimate = undefined;
    }
  } catch (error) {
    postMessage({type:"fallback",message:error.message});
    gpu = Promise.resolve(null);
    estimate = undefined;
  } finally {
    inFlight = false;
  }
  estimate ??= new Estimate(data.settings);
  batchSize = 1;
  if (stopping) {finishStop(); return;}
  remaining = data.samples;
  schedule();
};
