import {clamp,defaultScene} from "./scene.mjs?v=34";
import {colorbar,displayDefaults,displayPixels,filters,maps} from "./display.mjs?v=34";

const el = id => document.getElementById(id);
const canvas = el("image");
const context = canvas.getContext("2d",{alpha:false});
const stage = el("stage");
const estimateAction = el("estimateAction");
const worker = new Worker(new URL("./worker.mjs?v=34",import.meta.url),{type:"module"});
const controls = {};
const narrow = matchMedia("(max-width: 540px)");
const forceCpu = new URLSearchParams(location.search).get("backend")==="cpu";
const cpuSamples = 8;
let cpuFallback = forceCpu;
if (forceCpu) el("spp").value = cpuSamples;
let frame;
let previewFrame;
let previewRequest;
let loadedSettings;
let running = false;
let stopping = false;
let requested = 0;
let drag;
let yaw = defaultScene.yaw;
let pitch = defaultScene.pitch;
let cameraRenderPending = false;
let barMap;
let display = displayDefaults("rgbIntensity");

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
const lightSliders = ["source_dop","source_aolp","source_ellipticity"];
slider("sourceControls","source_dop","Degree of polarization",0,1,.01,0,value => Math.round(value*100)+"%");
slider("sourceControls","source_aolp","Angle of polarization",-90,90,.1,0,degrees);
slider("sourceControls","source_ellipticity","Ellipticity",-1,1,.01,0,fixed(2));
slider("displaySliders","exposure","Exposure",-8,8,.1,0,value => (value>0 ? "+" : "")+value.toFixed(1)+" EV");
slider("zoomControl","zoom","Display zoom",1,4,.1,1,factor(1));
slider("cameraSliders","distance","Camera distance",.25,4,.01,1,factor(2));

function readSettings() {
  return Object.fromEntries(Object.entries(defaultScene).map(([id,value]) => {
    if (id === "yaw") return [id,yaw];
    if (id === "pitch") return [id,pitch];
    if (id === "source_dop" && el("sourceMode").value !== "polarized") return [id,0];
    const field = el(id);
    // Settings without a control, such as light intensity, keep their defaults.
    if (!field) return [id,value];
    return [id,typeof value === "number" ? Number(field.value) : field.value];
  }));
}

function updateButtons() {
  const dirty = loadedSettings !== undefined && JSON.stringify(readSettings()) !== loadedSettings;
  const fields = ["spp","max_depth"].map(el);
  for (const field of fields) field.classList.toggle("invalid",!field.validity.valid);
  const invalid = fields.some(field => !field.validity.valid);
  el("sppError").hidden = el("spp").validity.valid;
  const cameraBusy = Boolean(drag?.moved || previewRequest || cameraRenderPending);
  const busy = running || cameraBusy;
  const actionType = running ? "button" : "submit";
  if (estimateAction.type !== actionType) {
    estimateAction.type = actionType;
    estimateAction.textContent = running ? "Stop" : "Fresh render";
  }
  estimateAction.classList.toggle("stop",running);
  estimateAction.classList.toggle("has-changes",!running && dirty);
  estimateAction.disabled = running ? stopping : busy || invalid;
  // Scene edits stay available while rendering; they apply on the next fresh render.
  const cameraDefault = yaw===defaultScene.yaw && pitch===defaultScene.pitch &&
    Number(controls.distance.field.value)===defaultScene.distance && Number(controls.zoom.field.value)===1;
  el("reset").disabled = cameraDefault || Boolean(drag?.moved);
  // Re-render stays quiet until a setting changes, then stands out so the edit is easy to apply.
  const rerender = el("rerender");
  rerender.classList.toggle("has-changes",dirty);
  rerender.disabled = Boolean(drag?.moved) || invalid || stopping || (running && !dirty);
  el("sceneChanges").hidden = cameraBusy || !dirty;
  el("progress").classList.toggle("active",running);
  const spp = el("spp").value;
  for (const button of document.querySelectorAll("[data-spp]")) button.setAttribute("aria-pressed",String(button.dataset.spp===spp));
}

function setStatus(text) {
  el("status").textContent = text;
}

const samplesText = (done,total) => (total===undefined ? done : done+" / "+total)+" samples per pixel";

function updateSourceControls() {
  const polarized = el("sourceMode").value === "polarized";
  el("sourceControls").hidden = !polarized;
  // Choosing Polarized with DoP at zero would still render unpolarized light, so start fully polarized.
  if (polarized && Number(controls.source_dop.field.value) === 0) updateSlider("source_dop",1);
}

function setOptions(element,entries) {
  element.replaceChildren(...entries.map(([value,title]) => new Option(title,value)));
}

function updateFilterOptions(wanted = display.filter) {
  const rgb = (frame?.channels ?? (el("channels").value==="rgb" ? 3 : 1)) === 3;
  const entries = Object.entries(filters).filter(([,spec]) => rgb || !spec.rgb);
  setOptions(el("filter"),entries.map(([id,spec]) => [id,spec.title]));
  if (!entries.some(([id]) => id===wanted)) wanted = wanted === "rgbAnalyzer" ? "analyzer" : "intensity";
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
  const hasRGB = (frame?.channels ?? (el("channels").value === "rgb" ? 3 : 1)) === 3;
  el("channelRow").hidden = spec.rgb || !hasRGB;
  el("scalarControls").hidden = Boolean(spec.rgb);
  el("ellipticityHelp").hidden = display.filter !== "ellipticity";
  controls.exposure.wrapper.hidden = !spec.exposure;
  el("analyzerControl").hidden = !spec.analyzer;
  const channelRatio = ["q","u","v"].includes(display.filter);
  const available = maps.filter(map => map !== "seismic" || channelRatio);
  setOptions(el("map"),available.map(map => [map,map[0].toUpperCase()+map.slice(1)]));
  display.map = available.includes(previousMap) ? previousMap : displayDefaults(display.filter).map;
  el("map").value = display.map;
  el("log").disabled = !spec.log;
  el("log").checked = display.log;
  el("minimum").value = display.minimum;
  el("maximum").value = display.maximum;
  el("rangeError").hidden = true;
}

function changeFilter() {
  const next = displayDefaults(el("filter").value);
  display = {...next,channel:display.channel,exposure:display.exposure,angle:display.angle};
  updateDisplayControls();
  draw();
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
    const gain = spec.exposure ? 2**display.exposure : 1;
    const fmt = value => Number((value/gain).toPrecision(3)).toString().replace("-","−");
    const {minimum,maximum} = display;
    const span = maximum-minimum;
    let middle = minimum+span/2;
    if (display.log && spec.log) {
      const floor = span*1e-3;
      middle = minimum>0 ? Math.sqrt(minimum*maximum) : minimum+floor*Math.sqrt(span/floor);
    }
    el("barTitle").textContent = spec.title;
    el("barMaximum").value = fmt(maximum);
    el("barMiddle").value = fmt(middle);
    el("barMinimum").value = fmt(minimum);
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
  if (running || estimateAction.disabled) return;
  const settings = readSettings();
  requested = el("spp").valueAsNumber;
  if (!Number.isInteger(requested) || !el("spp").validity.valid) return;
  frame = undefined;
  previewFrame = undefined;
  loadedSettings = JSON.stringify(settings);
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
  loadedSettings = undefined;
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
  el("completed").textContent = frame.samples+" SPP";
  el("backend").textContent = data.backend;
  el("dimensions").textContent = frame.size+" × "+frame.size;
  el("batch").textContent = data.renderMs.toFixed(2)+" ms";
  el("delivery").textContent = Math.max(0,performance.timeOrigin+performance.now()-data.sentAt).toFixed(2)+" ms";
  el("progress").value = 1-data.remaining/requested;
  if (first) updateFilterOptions();
  draw();
  if (!data.remaining && !stopping) {
    running = false;
    setStatus("Ready · "+samplesText(frame.samples));
  } else if (!stopping && !drag?.moved) {
    setStatus("Rendering · "+samplesText(frame.samples,requested));
  }
  updateButtons();
};

el("estimateForm").addEventListener("submit",event => {event.preventDefault(); begin();});
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
estimateAction.addEventListener("click",stop);
for (const id of ["preset","max_depth","spp"]) el(id).addEventListener("input",updateButtons);
el("sourceMode").addEventListener("change",() => {updateSourceControls(); renderCamera();});
for (const group of document.querySelectorAll(".segmented")) {
  group.addEventListener("change",event => {
    el(group.dataset.target).value = event.target.value;
    updateButtons();
  });
}
for (const button of document.querySelectorAll("[data-spp]")) {
  button.addEventListener("click",() => {
    el("spp").value = button.dataset.spp;
    updateButtons();
  });
}
for (const [id,{field}] of Object.entries(controls)) {
  field.addEventListener("input",() => {
    updateSlider(id);
    if (id === "zoom") {applyZoom(); updateButtons();}
    else if (id === "exposure") {display.exposure = Number(field.value);draw();}
    else if (lightSliders.includes(id)) previewLight();
    else updateButtons();
  });
  // Releasing a light slider (or each arrow-key step) starts the full render.
  if (lightSliders.includes(id)) field.addEventListener("change",() => {
    if (!drag?.slider) return;
    drag = undefined;
    renderCamera();
  });
}
el("filter").addEventListener("change",changeFilter);
el("channel").addEventListener("change",() => {display.channel = Number(el("channel").value); draw();});
el("map").addEventListener("change",() => {display.map = el("map").value;draw();});
el("log").addEventListener("change",() => {display.log = el("log").checked;draw();});
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

function applyZoom() {
  canvas.style.transform = "scale("+controls.zoom.field.value+")";
}

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
      setStatus("Camera changed");
      updateButtons();
      begin();
      if (!running) draw();
      return;
    }
  }
  updateButtons();
}

el("rerender").addEventListener("click",() => {
  if (running) renderCamera();
  else begin();
});

// Light sliders preview live like orbiting: low-resolution single-sample frames while moving.
function previewLight() {
  if (drag && !drag.slider) return;
  if (!drag) {
    drag = {slider:true,moved:true};
    cameraRenderPending = false;
    stop();
    setStatus("Light preview");
  }
  drag.previewDirty = true;
  advanceCameraRender();
}

function renderCamera() {
  cameraRenderPending = true;
  stop();
  advanceCameraRender();
}
stage.addEventListener("pointerdown",event => {
  if (!event.isPrimary || event.button!==0) return;
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
  updateSlider("zoom",1);
  applyZoom();
  updateButtons();
  if (JSON.stringify(readSettings())!==loadedSettings) renderCamera();
});

// Analyzer: a linear polarizer angle on the same 0–180° scale as before.
slider("analyzerControl","analyzer","Analyzer angle",0,180,1,0,value => value+"°");
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

updateFilterOptions();
updateSourceControls();
setAnalyzer();
begin();
