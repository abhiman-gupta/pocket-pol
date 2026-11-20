// GPU vs CPU agreement benchmark.
// Renders the same scene, seed, and sample count with the WebGPU (Dawn) and CPU backends and
// compares the Stokes channels per pixel, with a high-sample GPU reference for noise scale.
//
//   npm install --no-save --package-lock=false webgpu@0.6.2
//   node bench/agreement.mjs
//
// Both backends seed each pixel and sample through the same PCG hash, so they should agree to
// float32 rounding, not just statistically.
import {renderHeadlessGpu,renderHeadless,defaultWorkers} from "../web/headless.mjs";
import {defaultScene} from "../web/scene.mjs";

const size = 256, spp = 64, seed = 7, refSpp = 4096;
const cases = {
  "default (unpolarized light)": {},
  "polarized light (DoP 100%, AoP 30°, ellipticity 0.3)": {source_dop:1,source_aolp:30,source_ellipticity:.3},
};
const names = ["I","Q","U","V"], colors = ["R","G","B"];

function stats(a,b,ref) {
  // a, b: frames to compare; ref: high-SPP frame used for scale and noise.
  const out = [];
  for (let s=0; s<4; s++) {
    let maxAbs = 0, sumAbs = 0, sumA = 0, sumB = 0, refScale = 0, noise = 0, n = 0;
    for (let p=0; p<size*size; p++) for (let c=0; c<3; c++) {
      const i = (p*3+c)*4+s;
      const d = Math.abs(a[i]-b[i]);
      maxAbs = Math.max(maxAbs,d); sumAbs += d; sumA += a[i]; sumB += b[i];
      refScale = Math.max(refScale,Math.abs(ref[i]));
      noise += Math.abs(a[i]-ref[i]); n++;
    }
    out.push({stokes:names[s],meanCpu:sumA/n,meanGpu:sumB/n,maxAbs,meanAbs:sumAbs/n,
      maxRel:maxAbs/refScale,meanNoiseVsRef:noise/n});
  }
  return out;
}

const fmt = x => Math.abs(x)<1e-3 && x!==0 ? x.toExponential(2) : x.toFixed(5);
for (const [label,overrides] of Object.entries(cases)) {
  const settings = {...defaultScene,size,...overrides};
  let t = performance.now();
  const gpu = await renderHeadlessGpu(settings,seed,spp,() => {});
  if (!gpu) throw new Error("WebGPU unavailable: install the optional webgpu package (see the header).");
  const gpuMs = performance.now()-t;
  t = performance.now();
  const cpu = await renderHeadless(settings,seed,spp,defaultWorkers,() => {});
  const cpuMs = performance.now()-t;
  const ref = await renderHeadlessGpu(settings,99,refSpp,() => {});
  console.log(`\n## ${label} — ${size}×${size}, ${spp} SPP, seed ${seed}`);
  console.log(`GPU ${gpuMs.toFixed(0)} ms · CPU (${defaultWorkers} workers) ${cpuMs.toFixed(0)} ms`);
  console.log("Stokes | mean CPU | mean GPU | max |CPU−GPU| | mean |CPU−GPU| | max diff / ref peak | mean MC noise vs 4096-SPP ref");
  for (const r of stats(cpu.pixels,gpu.pixels,ref.pixels)) {
    console.log([r.stokes,fmt(r.meanCpu),fmt(r.meanGpu),fmt(r.maxAbs),fmt(r.meanAbs),(r.maxRel*100).toFixed(4)+"%",fmt(r.meanNoiseVsRef)].join(" | "));
  }
  // Pixels that differ beyond float32 rounding (relative to that pixel's intensity).
  let off = 0;
  for (let p=0; p<size*size*3; p++) {
    const I = Math.max(Math.abs(cpu.pixels[p*4]),1e-6);
    for (let s=0; s<4; s++) if (Math.abs(cpu.pixels[p*4+s]-gpu.pixels[p*4+s])/I > 1e-3) {off++; break;}
  }
  console.log(`Pixel-channels differing by more than 0.1% of their intensity: ${off} of ${size*size*3}`);
}
process.exit(0);
