import {clamp,defaultScene} from "./scene.mjs?v=36";
import {channelNames,colorbar,displayDefaults,displayPixels,filters,luminanceWeights,maps} from "./display.mjs?v=36";
import {setupExport} from "./export.mjs?v=36";

const el = id => document.getElementById(id);
const canvas = el("image");
const context = canvas.getContext("2d",{alpha:false});
const stage = el("stage");
const workerUrl = new URL("./worker.mjs?v=36",import.meta.url);
const worker = new Worker(workerUrl,{type:"module"});
const controls = {};
const narrow = matchMedia("(max-width: 540px)");
const forceCpu = new URLSearchParams(location.search).get("backend")==="cpu";
const cpuSamples = 8;
let cpuFallback = forceCpu;
if (forceCpu) el("spp").value = cpuSamples;
let frame;
let previewFrame;
let previewRequest;
let running = false;
let stopping = false;
let requested = 0;
let lastRemaining = 0;
let drag;
let yaw = defaultScene.yaw;
let pitch = defaultScene.pitch;
let cameraRenderPending = false;
let renderTimer;
let barMap;
let filterMemory;
let suggestionCache;
// Full-resolution throughput, used to estimate export times.
let speed;
let timing;
let display = {...displayDefaults("rgbIntensity"),channel:"rgb"};

function slider(group,id,label,min,max,step,value,format) {
  const wrapper = document.createElement("label");
  wrapper.className = "slider";
  const row = document.createElement("span");
  row.className = "row";
  const text = document.createElement("span");
  text.textContent = label;
  const output = document.createElement("output");
  const field = document.createElement("input");
  field.type = "range";
  field.id = id;
  field.min = min;
  field.max = max;
  field.step = step;
  field.value = value;
  field.setAttribute("aria-label",label);
  output.htmlFor = id;
  row.append(text,output);
  wrapper.append(row,field);
  el(group).append(wrapper);
  controls[id] = {field,wrapper,output,format};
  updateSlider(id);
}

function updateSlider(id,value) {
  const {field,output,format} = controls[id];
  if (value !== undefined) field.value = value;
  output.value = format(Number(field.value));
  // Fill from zero for ranges that straddle it, otherwise from the minimum.
  const min = Number(field.min), max = Number(field.max), span = max-min;
  const percent = x => (span ? (x-min)/span*100 : 0)+"%";
  const origin = min<0 && max>0 ? 0 : min;
  const ends = [origin,Number(field.value)].sort((a,b) => a-b);
  field.style.setProperty("--from",percent(ends[0]));
  field.style.setProperty("--to",percent(ends[1]));
}

const fixed = digits => value => value.toFixed(digits);
const degrees = value => value.toFixed(1)+"°";
const factor = digits => value => value.toFixed(digits)+"×";
// Scene sliders preview live while they move and start a fresh render when released.
const sceneSliders = ["source_dop","source_aolp","source_ellipticity","distance"];
slider("sourceControls","source_dop","Degree of polarization",0,1,.01,0,value => Math.round(value*100)+"%");
slider("sourceControls","source_aolp","Angle of polarization",-90,90,.1,0,degrees);
slider("sourceControls","source_ellipticity","Ellipticity",-1,1,.01,0,fixed(2));
slider("cameraSliders","distance","Camera distance",.25,4,.01,1,factor(2));

function readSettings() {
  return Object.fromEntries(Object.entries(defaultScene).map(([id,value]) => {
    if (id === "yaw") return [id,yaw];
    if (id === "pitch") return [id,pitch];
    if (id === "source_dop" && el("sourceMode").value !== "polarized") return [id,0];
    const field = el(id);
    // Settings without a control, such as light intensity, channels, and size, keep their defaults.
    if (!field) return [id,value];
    return [id,typeof value === "number" ? Number(field.value) : field.value];
  }));
}

const samplesText = (done,total) => (total===undefined ? done : done+" / "+total)+" SPP";

function updateButtons() {
  const spp = el("spp");
  spp.classList.toggle("invalid",!spp.validity.valid);
  el("sppError").hidden = spp.validity.valid;
  const cameraDefault = yaw===defaultScene.yaw && pitch===defaultScene.pitch &&
    Number(controls.distance.field.value)===defaultScene.distance;
  el("reset").disabled = cameraDefault || Boolean(drag?.moved);
  el("progress").classList.toggle("active",running);
  el("stopRender").hidden = !running || stopping || Boolean(drag?.moved);
  for (const button of document.querySelectorAll("[data-spp]")) button.setAttribute("aria-pressed",String(button.dataset.spp===spp.value));
  const depth = Number(el("max_depth").value);
  el("depthDown").disabled = depth<=1;
  el("depthUp").disabled = depth>=64;
}

function setStatus(text) {
  el("status").textContent = text;
}

function updateSourceControls() {
  const polarized = el("sourceMode").value === "polarized";
  el("sourceControls").hidden = !polarized;
  // Choosing Polarized with DoP at zero would still render unpolarized light, so start fully polarized.
  if (polarized && Number(controls.source_dop.field.value) === 0) updateSlider("source_dop",1);
}

function setOptions(element,entries) {
  element.replaceChildren(...entries.map(([value,title]) => new Option(title,value)));
}

const frameChannels = () => frame?.channels ?? (defaultScene.channels==="rgb" ? 3 : 1);

// Every filter is listed, but RGB filters show in the RGB view and the others in one channel.
// Picking a filter moves the channel switch to match (Green for single-channel filters). Switching maps
// Intensity and Analyzer to their counterparts, and switching straight back restores the filter
// that was showing before.
const counterpart = {rgbIntensity:"intensity",rgbAnalyzer:"analyzer",intensity:"rgbIntensity",analyzer:"rgbAnalyzer"};
function updateFilterOptions(wanted = display.filter) {
  const rgbFrame = frameChannels() === 3;
  const rgbView = rgbFrame && display.channel === "rgb";
  el("viewSwitch").hidden = !rgbFrame;
  const entries = Object.entries(filters).filter(([,spec]) => rgbFrame || !spec.rgb);
  setOptions(el("filter"),entries.map(([id,spec]) => [id,spec.title]));
  if (Boolean(filters[wanted].rgb) !== rgbView) {
    const previous = wanted;
    wanted = filterMemory?.to === wanted ? filterMemory.from : counterpart[wanted] ?? (rgbView ? "rgbIntensity" : "intensity");
    filterMemory = {from:previous,to:wanted};
  }
  el("filter").value = wanted;
  if (wanted!==display.filter) changeFilter();
  else updateDisplayControls();
}

function updateDisplayControls() {
  const spec = filters[display.filter];
  const hint = el("viewHint");
  hint.textContent = spec.hint ?? "";
  hint.hidden = !spec.hint;
  const previousMap = display.map;
  el("scalarControls").hidden = Boolean(spec.rgb);
  el("ellipticityHelp").hidden = display.filter !== "ellipticity";
  el("analyzerControl").hidden = !spec.analyzer;
  el("logControl").hidden = !spec.log;
  const channelRatio = ["q","u","v"].includes(display.filter);
  const available = maps.filter(map => map !== "seismic" || channelRatio);
  setOptions(el("map"),available.map(map => [map,map[0].toUpperCase()+map.slice(1)]));
  display.map = available.includes(previousMap) ? previousMap : displayDefaults(display.filter).map;
  el("map").value = display.map;
  el("log").checked = display.log;
  el("minimum").value = display.minimum;
  el("maximum").value = display.maximum;
  el("rangeError").hidden = true;
  updateLogSuggestion();
}

function changeFilter() {
  const next = displayDefaults(el("filter").value);
  display = {...next,channel:display.channel,exposure:display.exposure,angle:display.angle};
  updateDisplayControls();
  draw();
}

// Diffuse scenes polarize light only weakly, so a linear DoP scale looks almost black.
// Sample the image and suggest log scale when most of it sits near zero.
function dopPercentile(image,channel) {
  const {size,channels,pixels} = image;
  const luminance = channel === "rgb" && channels === 3;
  const index = luminance ? 0 : Math.min(Number(channel) || 0,channels-1);
  const values = [];
  for (let pixel=0; pixel<size*size; pixel+=7) {
    const base = pixel*channels*4;
    let s = [0,0,0,0];
    if (luminance) {
      for (let c=0; c<3; c++) for (let k=0; k<4; k++) s[k] += luminanceWeights[c]*pixels[base+c*4+k];
    } else {
      s = pixels.subarray(base+index*4,base+index*4+4);
    }
    if (s[0]>0) values.push(Math.hypot(s[1],s[2],s[3])/s[0]);
  }
  if (!values.length) return NaN;
  values.sort((a,b) => a-b);
  return values[Math.floor(values.length*.75)];
}

function updateLogSuggestion() {
  const note = el("logSuggestion");
  if (display.filter !== "dop" || display.log || !frame) {note.hidden = true; return;}
  const key = frame.samples+":"+display.channel;
  if (suggestionCache?.frame !== frame || suggestionCache.key !== key) {
    suggestionCache = {frame,key,value:dopPercentile(frame,display.channel)};
  }
  const value = suggestionCache.value;
  const low = Number.isFinite(value) && value < .25;
  note.hidden = !low;
  if (low) {
    const shown = value<.01 ? "1%" : Math.ceil(value*100)+"%";
    note.textContent = "Most of this image is below "+shown+" DoP, so it looks dark on a linear scale. Turn on log scale to see the small values.";
  }
}

const plain = value => Number(value.toPrecision(3)).toString().replace("-","−");
const power = k => k===0 ? "10<sup>0</sup>" : "10<sup>"+String(k).replace("-","−")+"</sup>";
// Linear colorbars mark the ends and middle. Log colorbars mark each power of ten.
function colorbarTicks(spec) {
  const {minimum,maximum} = display;
  const span = maximum-minimum;
  if (!(display.log && spec.log)) return [[0,plain(minimum)],[.5,plain(minimum+span/2)],[1,plain(maximum)]];
  const shifted = minimum<=0;
  const low = shifted ? span*1e-3 : minimum;
  const high = shifted ? span : maximum;
  const first = Math.ceil(Math.log10(low)-1e-9), last = Math.floor(Math.log10(high)+1e-9);
  const step = Math.max(1,Math.ceil((last-first+1)/6));
  const ticks = [];
  for (let k=first; k<=last; k+=step) {
    const label = shifted && minimum!==0 ? plain(minimum+10**k) : power(k);
    ticks.push([Math.log(10**k/low)/Math.log(high/low),label]);
  }
  return ticks;
}

function draw() {
  const image = previewFrame ?? frame;
  const spec = filters[display.filter];
  stage.classList.toggle("preview",Boolean(previewFrame));
  el("stageMessage").hidden = Boolean(image) || (!running && !cameraRenderPending && el("error").hidden);
  const showBar = Boolean(image) && !spec.rgb && el("showColorbar").checked;
  // Keep the colorbar's space reserved so the image never shifts between filters.
  el("colorbar").classList.toggle("off",!showBar);
  el("colorbar").setAttribute("aria-hidden",String(!showBar));
  if (showBar) {
    el("barTitle").textContent = spec.title+(image.channels===3 && display.channel!=="rgb" ? " · "+channelNames[display.channel] : "");
    el("barTicks").replaceChildren(...colorbarTicks(spec).map(([position,label]) => {
      const tick = document.createElement("output");
      tick.style.setProperty("--at",position*100+"%");
      tick.innerHTML = label;
      return tick;
    }));
    // Phones lay the colorbar under the image, so its gradient runs left to right.
    const horizontal = narrow.matches;
    if (barMap!==display.map+horizontal) {
      barMap = display.map+horizontal;
      const gradient = colorbar(display.map);
      el("barGradient").style.background = horizontal ? gradient.replace("to top","to right") : gradient;
    }
  }
  if (!image) return;
  if (canvas.width!==image.size) canvas.width = canvas.height = image.size;
  context.putImageData(new ImageData(displayPixels(image,display),image.size,image.size),0,0);
}

function begin() {
  if (running) return;
  requested = el("spp").valueAsNumber;
  if (!Number.isInteger(requested) || !el("spp").validity.valid) {updateButtons(); return;}
  const settings = readSettings();
  frame = undefined;
  previewFrame = undefined;
  lastRemaining = requested;
  timing = {ms:0,samples:0,batches:0};
  el("completed").textContent = "0 SPP";
  for (const id of ["batch","delivery","dimensions","backend"]) el(id).textContent = "—";
  updateFilterOptions();
  draw();
  el("error").hidden = true;
  running = true;
  stopping = false;
  el("progress").value = 0;
  el("stageMessage").classList.remove("failed");
  el("stageMessageText").textContent = "Rendering…";
  el("stageMessage").hidden = false;
  setStatus("Rendering · "+samplesText(0,requested));
  updateButtons();
  worker.postMessage({type:"fresh",settings,samples:requested,forceCpu});
}

function fail(message) {
  running = false;
  stopping = false;
  cameraRenderPending = false;
  previewRequest = previewFrame = undefined;
  setStatus("Render failed");
  el("error").textContent = message;
  el("error").hidden = false;
  el("stageMessage").classList.add("failed");
  el("stageMessageText").textContent = "Render failed";
  el("stageMessage").hidden = Boolean(frame);
  updateButtons();
}

worker.onerror = event => fail(event.message || "Could not start the render worker.");
worker.onmessage = ({data}) => {
  if (data.type === "preview") {
    if (previewRequest === drag && drag?.moved && data.frame) {
      previewFrame = data.frame;
      draw();
    }
    previewRequest = undefined;
    advanceCameraRender();
    return;
  }
  if (data.type === "fallback") {
    console.warn("Pocket Pol is using its CPU renderer.",data.message);
    // The CPU renderer is far slower, so drop to 8 SPP the first time it takes over.
    if (!cpuFallback) {
      cpuFallback = true;
      if (el("spp").valueAsNumber>cpuSamples) el("spp").value = cpuSamples;
      if (running && requested>cpuSamples) {
        requested = cpuSamples;
        worker.postMessage({type:"cap",samples:cpuSamples});
      }
      updateButtons();
    }
    el("gpuNote").textContent = data.message;
    // Compare with the page itself to tell a worker limitation from a missing GPU.
    Promise.resolve(navigator.gpu?.requestAdapter()).catch(() => null).then(adapter => {
      el("gpuNote").textContent = data.message+" in worker · page "+(!navigator.gpu ? "lacks WebGPU" :
        adapter ? "has an adapter" : "has no adapter either");
    });
    return;
  }
  if (data.type === "error") {fail(data.message); return;}
  if (data.type === "stopped") {
    if (!stopping) return;
    running = stopping = false;
    if (drag?.moved) setStatus(drag.slider ? "Light preview" : "Camera preview");
    else setStatus("Stopped · "+samplesText(frame?.samples ?? 0,requested));
    advanceCameraRender();
    return;
  }
  const first = !frame;
  frame = data.frame;
  const count = lastRemaining-data.remaining;
  lastRemaining = data.remaining;
  // Skip the first batch, which includes pipeline setup, unless it is the only one.
  timing.batches++;
  if (timing.batches>1 || !data.remaining) {
    timing.ms += data.renderMs;
    timing.samples += count;
    if (timing.samples) speed = {msPerSample:timing.ms/timing.samples,backend:data.backend};
  }
  el("completed").textContent = frame.samples+" SPP";
  el("backend").textContent = data.backend;
  el("dimensions").textContent = frame.size+" × "+frame.size;
  el("batch").textContent = data.renderMs.toFixed(2)+" ms";
  el("delivery").textContent = Math.max(0,performance.timeOrigin+performance.now()-data.sentAt).toFixed(2)+" ms";
  el("progress").value = 1-data.remaining/requested;
  if (first) updateFilterOptions();
  if (!data.remaining || first) updateLogSuggestion();
  draw();
  if (!data.remaining && !stopping) {
    running = false;
    setStatus("Ready · "+samplesText(frame.samples));
  } else if (!stopping && !drag?.moved) {
    setStatus("Rendering · "+samplesText(frame.samples,requested));
  }
  updateButtons();
};

const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
function selectPanel(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected",String(active));
    tab.tabIndex = active ? 0 : -1;
    el(tab.getAttribute("aria-controls")).hidden = !active;
  }
}
for (const tab of tabs) {
  tab.addEventListener("click",() => selectPanel(tab));
  tab.addEventListener("keydown",event => {
    const index = tabs.indexOf(tab);
    const target = {
      ArrowLeft:tabs[(index+tabs.length-1)%tabs.length], ArrowRight:tabs[(index+1)%tabs.length],
      Home:tabs[0], End:tabs.at(-1),
    }[event.key];
    if (!target) return;
    event.preventDefault();
    selectPanel(target);
    target.focus();
  });
}

function stop() {
  if (!running || stopping) return;
  stopping = true;
  setStatus("Stopping after this batch…");
  updateButtons();
  worker.postMessage({type:"stop"});
}
el("stopRender").addEventListener("click",stop);

// Every scene change renders right away; a short delay lets quick repeated clicks settle first.
function renderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {renderTimer = undefined; renderCamera();},250);
  updateButtons();
}

el("estimateForm").addEventListener("submit",event => {event.preventDefault(); renderCamera();});
el("spp").addEventListener("input",updateButtons);
el("spp").addEventListener("change",() => {if (el("spp").validity.valid) renderCamera();});
for (const button of document.querySelectorAll("[data-spp]")) {
  button.addEventListener("click",() => {
    if (el("spp").value === button.dataset.spp && (running || frame?.samples === requested)) return;
    el("spp").value = button.dataset.spp;
    renderCamera();
  });
}
el("preset").addEventListener("change",() => {
  el("sceneName").textContent = el("preset").selectedOptions[0].text;
  renderCamera();
});
el("sourceMode").addEventListener("change",() => {updateSourceControls(); renderCamera();});

function stepDepth(delta) {
  const value = clamp(Number(el("max_depth").value)+delta,1,64);
  el("max_depth").value = value;
  el("depthValue").value = value;
  renderSoon();
}
el("depthDown").addEventListener("click",() => stepDepth(-1));
el("depthUp").addEventListener("click",() => stepDepth(1));

for (const [id,{field}] of Object.entries(controls)) {
  field.addEventListener("input",() => {
    updateSlider(id);
    if (sceneSliders.includes(id)) previewSlider();
  });
  // Releasing a scene slider (or each arrow-key step) starts the full render.
  if (sceneSliders.includes(id)) field.addEventListener("change",() => {
    if (!drag?.slider) return;
    drag = undefined;
    renderCamera();
  });
}
el("filter").addEventListener("change",() => {
  filterMemory = undefined;
  const rgbFilter = Boolean(filters[el("filter").value].rgb);
  if (frameChannels() === 3 && rgbFilter !== (display.channel === "rgb")) {
    display.channel = rgbFilter ? "rgb" : 1;
    viewSwitch.querySelector(`input[value="${display.channel}"]`).checked = true;
  }
  changeFilter();
});
el("map").addEventListener("change",() => {display.map = el("map").value; draw();});
el("log").addEventListener("change",() => {display.log = el("log").checked; updateLogSuggestion(); draw();});
el("showColorbar").addEventListener("change",draw);
for (const id of ["minimum","maximum"]) el(id).addEventListener("input",() => {
  const minimum = el("minimum").valueAsNumber;
  const maximum = el("maximum").valueAsNumber;
  const valid = Number.isFinite(minimum) && Number.isFinite(maximum) && maximum>minimum && Number.isFinite(maximum-minimum);
  el("rangeError").hidden = valid;
  if (!valid) return;
  Object.assign(display,{minimum,maximum});
  draw();
});

// The channel switch on the image is a display choice, so it never re-renders.
const viewSwitch = el("viewSwitch");
viewSwitch.addEventListener("change",event => {
  hideOrbitHint();
  display.channel = event.target.value === "rgb" ? "rgb" : Number(event.target.value);
  updateFilterOptions();
  updateLogSuggestion();
  draw();
});
// Keep presses and arrow keys on the switch from orbiting the camera.
for (const type of ["pointerdown","keydown"]) viewSwitch.addEventListener(type,event => event.stopPropagation());

function advanceCameraRender() {
  if (!running && !previewRequest) {
    if (drag?.moved && drag.previewDirty) {
      drag.previewDirty = false;
      previewRequest = drag;
      const settings = readSettings();
      settings.size /= 2;
      worker.postMessage({type:"preview",settings,samples:1,seed:0,forceCpu});
    } else if (!drag?.moved && cameraRenderPending) {
      cameraRenderPending = false;
      previewFrame = undefined;
      updateButtons();
      begin();
      if (!running) draw();
      return;
    }
  }
  updateButtons();
}

// Light and camera sliders preview live like orbiting: low-resolution single-sample frames while moving.
function previewSlider() {
  if (drag && !drag.slider) return;
  if (!drag) {
    drag = {slider:true,moved:true};
    cameraRenderPending = false;
    stop();
    setStatus("Preview");
  }
  drag.previewDirty = true;
  advanceCameraRender();
}

function renderCamera() {
  clearTimeout(renderTimer);
  renderTimer = undefined;
  cameraRenderPending = true;
  stop();
  advanceCameraRender();
}

// The orbit hint covers the image on load and fades at the first interaction.
let hintTimer = setTimeout(hideOrbitHint,8000);
function hideOrbitHint() {
  clearTimeout(hintTimer);
  el("orbitHint").classList.add("gone");
  el("channelHint").classList.add("gone");
}

stage.addEventListener("pointerdown",event => {
  if (!event.isPrimary || event.button!==0) return;
  hideOrbitHint();
  drag = {id:event.pointerId,x:event.clientX,y:event.clientY,yaw,pitch,moved:false};
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove",event => {
  if (drag?.id!==event.pointerId) return;
  const dx = event.clientX-drag.x;
  const dy = event.clientY-drag.y;
  if (!drag.moved) {
    if (Math.hypot(dx,dy)<2) return;
    drag.moved = true;
    cameraRenderPending = false;
    stage.classList.add("orbiting");
    stop();
    setStatus("Camera preview");
  }
  yaw = drag.yaw-dx*.2;
  pitch = clamp(drag.pitch+dy*.2,-80,80);
  drag.previewDirty = true;
  advanceCameraRender();
});
stage.addEventListener("lostpointercapture",event => {
  if (drag?.id!==event.pointerId) return;
  const {moved} = drag;
  drag = undefined;
  stage.classList.remove("orbiting");
  if (moved) renderCamera();
});
stage.addEventListener("keydown",event => {
  if (drag) return;
  const delta = {ArrowLeft:[4.8,0],ArrowRight:[-4.8,0],ArrowUp:[0,-4.8],ArrowDown:[0,4.8],Home:[-yaw,-pitch]}[event.key];
  if (!delta) return;
  event.preventDefault();
  hideOrbitHint();
  const nextPitch = clamp(pitch+delta[1],-80,80);
  if (!delta[0] && nextPitch===pitch) return;
  yaw += delta[0];
  pitch = nextPitch;
  renderCamera();
});
el("reset").addEventListener("click",() => {
  yaw = defaultScene.yaw;
  pitch = defaultScene.pitch;
  updateSlider("distance",defaultScene.distance);
  renderCamera();
});

// Analyzer: a linear polarizer angle from −90° to +90°, centered at 0°.
slider("analyzerControl","analyzer","Analyzer angle",-90,90,1,0,value => String(value).replace("-","−")+"°");
function setAnalyzer() {
  display.angle = Number(controls.analyzer.field.value);
  updateSlider("analyzer");
  draw();
}
controls.analyzer.field.addEventListener("input",setAnalyzer);
// Append ?stats to the URL to show the renderer and timing, e.g. when testing on a phone.
if (new URLSearchParams(location.search).has("stats")) {
  const stats = el("statistics").querySelector("details");
  stats.hidden = false;
  stats.open = true;
}
narrow.addEventListener("change",draw);

setupExport({
  workerUrl,
  readSettings,
  getDisplay:() => display,
  getSpeed:() => speed,
  getForceCpu:() => forceCpu || cpuFallback,
});

updateFilterOptions();
updateSourceControls();
setAnalyzer();
begin();
