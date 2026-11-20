import {Estimate} from "./renderer.mjs";
import {openGpu} from "./gpu.mjs";

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
    const count = Math.min(remaining,batchSize);
    let frame;
    let backend = "CPU";
    if (estimate.backend === "WebGPU") {
      try {
        frame = await estimate.addSamples(count);
        backend = "WebGPU";
        lastGpuFrame = {...frame,pixels:frame.pixels.slice()};
      } catch (error) {
        postMessage({type:"fallback",message:error.message});
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

self.onmessage = async ({data}) => {
  if (data.type === "stop") {
    clearTimeout(timer);
    stopping = true;
    if (!inFlight) finishStop();
    return;
  }
  if (data.type === "fresh") {
    inFlight = true;
    estimate?.dispose?.();
    lastGpuFrame = undefined;
    try {
      if (!data.forceCpu) {
        gpu ??= openGpu();
        estimate = await (await gpu)?.newEstimate(data.settings);
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
  }
  remaining = data.samples;
  schedule();
};
