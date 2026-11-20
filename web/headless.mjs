import {availableParallelism} from "node:os";
import {readFile} from "node:fs/promises";
import {Worker,isMainThread,parentPort,workerData} from "node:worker_threads";
import {Estimate} from "./renderer.mjs?v=45";
import {openGpu} from "./gpu.mjs?v=45";

export const defaultWorkers = Math.min(8,availableParallelism());

export async function renderHeadlessGpu(settings,seed,target,onProgress) {
  let dawn;
  try {
    dawn = await import("webgpu");
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("package 'webgpu'")) return null;
    throw error;
  }
  const gpu = await openGpu({gpu:dawn.create([]),bufferUsage:dawn.globals.GPUBufferUsage,
    mapMode:dawn.globals.GPUMapMode,loadShader:() => readFile(new URL("./trace.wgsl",import.meta.url),"utf8")});
  if (!gpu) throw new Error("No hardware WebGPU adapter was found");
  let estimate;
  let frame;
  try {
    estimate = await gpu.newEstimate(settings,seed);
    let batch = 8;
    while (estimate.samples < target) {
      const count = Math.min(batch,target-estimate.samples);
      const started = performance.now();
      frame = await estimate.addSamples(count,{readFilm:estimate.samples+count===target});
      batch = Math.min(128,Math.max(1,Math.floor(count*100/(performance.now()-started))));
      onProgress(estimate.samples);
    }
    return frame;
  } finally {
    estimate?.dispose();
    gpu.dispose();
  }
}

function renderTile(settings,seed,target,rows,onProgress) {
  const estimate = new Estimate(settings,seed,rows);
  while (estimate.samples<target) {
    estimate.addSamples(Math.min(8,target-estimate.samples));
    onProgress(estimate.samples);
  }
  return estimate.frame();
}

export async function renderHeadless(settings,seed,target,workers,onProgress) {
  if (workers===1) return renderTile(settings,seed,target,[0,settings.size],onProgress);
  const children = [];
  const progress = new Uint32Array(workers);
  let reported = 0;
  try {
    const frames = await Promise.all(Array.from({length:workers},(_,i) => new Promise((resolve,reject) => {
      const rows = [Math.floor(i*settings.size/workers),Math.floor((i+1)*settings.size/workers)];
      const child = new Worker(new URL(import.meta.url),{workerData:{settings,seed,target,rows}});
      children.push(child);
      child.on("message",message => {
        if (message.frame) {
          resolve(message.frame);
        } else {
          progress[i] = message.samples;
          const completed = Math.min(...progress);
          if (completed>reported) {
            reported = completed;
            onProgress(completed);
          }
        }
      });
      child.once("error",reject);
      child.once("exit",() => reject(new Error("A render worker exited before producing its film tile")));
    })));
    const {size,channels} = frames[0];
    const pixels = new Float32Array(size*size*channels*4);
    let offset = 0;
    for (const tile of frames) {
      pixels.set(tile.pixels,offset);
      offset += tile.pixels.length;
    }
    return {...frames[0],pixels};
  } finally {
    await Promise.all(children.map(child => child.terminate()));
  }
}

if (!isMainThread) {
  const {settings,seed,target,rows} = workerData;
  const frame = renderTile(settings,seed,target,rows,samples => parentPort.postMessage({samples}));
  parentPort.postMessage({frame},[frame.pixels.buffer]);
}
