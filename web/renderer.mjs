import {add,sub,scale,dot,cross,unit,makeScene} from "./scene.mjs";
import {jarecki,applyMatrix,product,identity,emitted,sensorStokes} from "./polarization.mjs";

const EPS = .0001;
const PI = Math.PI;
const mis = (a,b) => a*a/(a*a+b*b);

function intersect(shapes,origin,ray,limit = Infinity,shadow = false) {
  let hit = null;
  for (const shape of shapes) {
    const denominator = dot(ray,shape.normal);
    if (Math.abs(denominator)<EPS) continue;
    const delta = sub(shape.corner,origin);
    const distance = dot(delta,shape.normal)/denominator;
    if (distance <= EPS || distance >= limit) continue;
    const offset = sub(scale(ray,distance),delta);
    const u = dot(offset,shape.u)*shape.invU;
    const v = dot(offset,shape.v)*shape.invV;
    if (u<0 || u>1 || v<0 || v>1) continue;
    if (shadow) return true;
    limit = distance;
    hit = shape;
  }
  return hit ? {shape:hit,distance:limit} : null;
}

function sampleLight({light,shapes},origin,normal,random) {
  const point = add(light.corner,add(scale(light.u,random()),scale(light.v,random())));
  const offset = sub(point,origin);
  const squared = dot(offset,offset);
  const distance = Math.sqrt(squared);
  if (distance <= EPS) return null;
  const ray = scale(offset,1/distance);
  const cosine = dot(ray,normal);
  const lightCosine = -dot(ray,light.normal);
  if (cosine<=0 || lightCosine<=0 || intersect(shapes,origin,ray,distance-EPS,true)) return null;
  return {ray,cosine,pdf:squared/(light.area*lightCosine)};
}

function sampleHemisphere(normal,random) {
  const angle = 2*PI*random();
  const squared = random();
  const radius = Math.sqrt(squared);
  const tangent = unit(cross(Math.abs(normal[1])<.9 ? [0,1,0] : [1,0,0],normal));
  return add(scale(normal,Math.sqrt(1-squared)),add(scale(tangent,radius*Math.cos(angle)),
    scale(cross(normal,tangent),radius*Math.sin(angle))));
}

function trace(scene,origin,ray,random,{max_depth,rr_depth}) {
  const {light,shapes,channels,source} = scene;
  const result = Array.from({length:channels},() => [0,0,0,0]);
  const transport = Array(channels).fill(identity);
  const beta = Array(channels).fill(1);
  let directionPdf = 0;
  for (let depth=0; depth<max_depth; depth++) {
    const hit = intersect(shapes,origin,ray);
    if (!hit) break;
    const {shape,distance} = hit;
    const wo = scale(ray,-1);
    const facing = dot(wo,shape.normal);
    if (facing<=0) break;
    if (shape === light) {
      const lightPdf = distance*distance/(light.area*facing);
      const weight = depth === 0 ? 1 : mis(directionPdf,lightPdf);
      const input = emitted(source,wo,light.normal);
      for (let c=0; c<channels; c++) {
        const value = applyMatrix(transport[c],input);
        for (let s=0; s<4; s++) result[c][s] += value[s]*weight*beta[c]*light.emission[c];
      }
    }
    if (depth+1 === max_depth) break;
    origin = add(add(origin,scale(ray,distance)),scale(shape.normal,EPS));
    const direct = sampleLight(scene,origin,shape.normal,random);
    const input = direct && emitted(source,scale(direct.ray,-1),light.normal);
    const bsdfPdf = direct && direct.cosine/PI;
    const weight = direct && bsdfPdf/direct.pdf*mis(direct.pdf,bsdfPdf);
    ray = sampleHemisphere(shape.normal,random);
    directionPdf = Math.max(0,dot(ray,shape.normal))/PI;
    for (let c=0; c<channels; c++) {
      if (!beta[c]) continue;
      const {reflectance,coefficients} = shape.material[c];
      beta[c] *= reflectance;
      if (direct) {
        const matrix = jarecki(direct.ray,wo,shape.normal,coefficients);
        if (matrix) {
          const value = applyMatrix(transport[c],applyMatrix(matrix,input));
          for (let s=0; s<4; s++) result[c][s] += value[s]*weight*beta[c]*light.emission[c];
        }
      }
      const matrix = jarecki(ray,wo,shape.normal,coefficients);
      if (matrix) transport[c] = product(transport[c],matrix);
      else beta[c] = 0;
    }
    const brightest = Math.max(...beta);
    if (brightest<=0) break;
    if (depth+1 >= rr_depth) {
      const probability = Math.min(.95,brightest);
      if (random() >= probability) break;
      for (let c=0; c<channels; c++) beta[c] /= probability;
    }
  }
  return result;
}

export class Estimate {
  constructor(settings,seed = 0,rows = [0,settings.size]) {
    this.settings = {...settings};
    this.scene = makeScene(settings);
    this.size = settings.size;
    this.channels = this.scene.channels;
    this.seed = seed >>> 0;
    this.samples = 0;
    this.batches = [];
    this.firstPixel = rows[0]*this.size;
    this.lastPixel = rows[1]*this.size;
    this.sum = new Float64Array((this.lastPixel-this.firstPixel)*this.channels*4);
  }

  addSamples(count) {
    const {size,channels,scene,sum,settings} = this;
    const {eye,forward,right,up,halfHeight} = scene.camera;
    const first = this.samples;
    let state;
    const random = () => {
      state = (Math.imul(state,1664525)+1013904223)>>>0;
      return (state>>>8)/16777216;
    };
    for (let sample=first; sample<first+count; sample++) {
      for (let pixel=this.firstPixel; pixel<this.lastPixel; pixel++) {
        state = this.seed ^ Math.imul(pixel,747796405) ^ Math.imul(sample,2891336453);
        const u = (2*((pixel%size+random())/size)-1)*halfHeight;
        const v = (1-2*((Math.floor(pixel/size)+random())/size))*halfHeight;
        const ray = unit(add(forward,add(scale(right,u),scale(up,v))));
        const values = trace(scene,eye,ray,random,settings);
        for (let c=0; c<channels; c++) {
          const value = sensorStokes(values[c],ray,up);
          const offset = ((pixel-this.firstPixel)*channels+c)*4;
          for (let s=0; s<4; s++) sum[offset+s] += value[s];
        }
      }
    }
    this.samples += count;
    this.batches.push({seed:this.seed,first_sample:first,spp:count});
  }

  frame() {
    return {
      size:this.size, channels:this.channels, samples:this.samples, seed:this.seed,
      pixels:Float32Array.from(this.sum,value => value/this.samples),
      settings:this.settings, batches:this.batches.slice(),
    };
  }
}

export function exportChannels(frame) {
  const names = frame.channels === 3 ? ["R","G","B"] : ["Y"];
  const channelNames = [...names,...[0,1,2,3].flatMap(s => names.map(name => "S"+s+"."+name))];
  const bytes = new ArrayBuffer(frame.size*frame.size*channelNames.length*4);
  const view = new DataView(bytes);
  for (let pixel=0; pixel<frame.size*frame.size; pixel++) {
    const offset = pixel*channelNames.length;
    const source = pixel*frame.channels*4;
    for (let c=0; c<frame.channels; c++) {
      view.setFloat32((offset+c)*4,frame.pixels[source+c*4],true);
      for (let s=0; s<4; s++) {
        view.setFloat32((offset+(s+1)*frame.channels+c)*4,frame.pixels[source+c*4+s],true);
      }
    }
  }
  return {bytes,metadata:{
    shape:[frame.size,frame.size,channelNames.length], channel_names:channelNames,
    dtype:"float32-le", bytes:bytes.byteLength, sample_count:frame.samples, seed:frame.seed,
    render_batches:frame.batches, scene_settings:frame.settings, variant:frame.channels===3 ? "rgb_polarized" : "mono_polarized",
  }};
}
