import {Estimate} from "./renderer.mjs";

let estimate;
let remaining = 0;
let timer;
let batchSize = 1;

function nextBatch() {
  timer = undefined;
  try {
    const started = performance.now();
    const count = Math.min(remaining,batchSize);
    estimate.addSamples(count);
    remaining -= count;
    const renderMs = performance.now()-started;
    batchSize = Math.min(8,Math.max(1,Math.floor(count*120/renderMs)));
    const frame = estimate.frame();
    postMessage({type:"frame",frame,renderMs,remaining,sentAt:performance.timeOrigin+performance.now()},[frame.pixels.buffer]);
    if (remaining) timer = setTimeout(nextBatch,0);
  } catch (error) {
    remaining = 0;
    postMessage({type:"error",message:error.message});
  }
}

self.onmessage = ({data}) => {
  clearTimeout(timer);
  if (data.type === "stop") {
    remaining = 0;
    postMessage({type:"stopped"});
    return;
  }
  if (data.type === "fresh") {
    estimate = new Estimate(data.settings);
    batchSize = 1;
  }
  remaining = data.samples;
  timer = setTimeout(nextBatch,0);
};
