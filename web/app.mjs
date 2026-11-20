import {clamp,defaultScene} from "./scene.mjs";
import {colorbar,displayDefaults,displayPixels,filters,maps} from "./display.mjs?v=2";
import {exportChannels} from "./renderer.mjs";
import {zipFiles} from "./files.mjs";

const el = id => document.getElementById(id);
const canvas = el("image");
const context = canvas.getContext("2d",{alpha:false});
const stage = el("stage");
const worker = new Worker(new URL("./worker.mjs",import.meta.url),{type:"module"});
const controls = {};
const forceCpu = new URLSearchParams(location.search).get("backend")==="cpu";
let frame;
let loadedSettings;
let running = false;
let stopping = false;
let requested = 0;
let drag;
let restartAfterStop = false;
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
}

const fixed = digits => value => value.toFixed(digits);
const degrees = value => value.toFixed(1)+"°";
const factor = digits => value => value.toFixed(digits)+"×";
slider("advancedSourceControls","light_scale","Light intensity",0,10,.01,1,factor(2));
slider("sourceControls","source_dop","Source polarization",0,1,.01,0,value => Math.round(value*100)+"%");
slider("sourceControls","source_aolp","Source angle",-90,90,.1,0,degrees);
slider("sourceControls","source_ellipticity","Source ellipticity",-1,1,.01,0,fixed(2));
slider("displaySliders","exposure","Exposure",-8,8,.1,0,value => (value>0 ? "+" : "")+value.toFixed(1)+" EV");
slider("analyzerControl","angle","Analyzer angle",-90,90,.1,0,degrees);
slider("zoomControl","zoom","Display zoom",1,4,.1,1,factor(1));
slider("cameraSliders","yaw","Yaw",-180,180,.1,0,degrees);
slider("cameraSliders","pitch","Pitch",-80,80,.1,0,degrees);
slider("cameraSliders","distance","Camera distance",.25,4,.01,1,factor(2));

function readSettings() {
  return Object.fromEntries(Object.entries(defaultScene).map(([id,value]) => {
    if (id === "preset") return [id,value];
    const field = el(id);
    return [id,typeof value === "number" ? Number(field.value) : field.value];
  }));
}

function updateButtons() {
  const dirty = JSON.stringify(readSettings()) !== loadedSettings;
  const invalid = !el("spp").validity.valid || !el("max_depth").validity.valid || !el("rr_depth").validity.valid;
  el("fresh").disabled = running || invalid;
  el("continue").disabled = running || !frame || dirty || invalid;
  el("stop").disabled = !running || stopping;
  el("scene").disabled = running;
  el("camera").disabled = running;
  el("export").disabled = !frame;
  el("sceneChanges").hidden = running || !frame || !dirty;
  el("progress").classList.toggle("active",running);
}

function updateSourceControls() {
  const unpolarized = Number(controls.source_dop.field.value) === 0;
  controls.source_aolp.wrapper.hidden = unpolarized;
  controls.source_ellipticity.wrapper.hidden = unpolarized;
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
  el("viewHint").textContent = spec.hint;
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
  const spec = filters[display.filter];
  const showBar = Boolean(frame) && !spec.rgb && el("showColorbar").checked;
  el("colorbar").hidden = !showBar;
  if (showBar) {
    const gain = spec.exposure ? 2**display.exposure : 1;
    const fmt = value => Number((value/gain).toPrecision(4)).toString();
    el("barTitle").textContent = spec.title;
    el("barMaximum").value = fmt(display.maximum);
    el("barMinimum").value = fmt(display.minimum);
    if (barMap!==display.map) {
      barMap = display.map;
      el("barGradient").style.background = colorbar(barMap);
    }
  }
  if (!frame) return;
  if (canvas.width!==frame.size) canvas.width = canvas.height = frame.size;
  context.putImageData(new ImageData(displayPixels(frame,display),frame.size,frame.size),0,0);
}

function begin(fresh,startup = false) {
  if (running || drag || el(fresh ? "fresh" : "continue").disabled) return;
  const settings = readSettings();
  requested = el("spp").valueAsNumber;
  if (!Number.isInteger(requested) || !el("spp").validity.valid) return;
  if (fresh) {
    frame = undefined;
    loadedSettings = JSON.stringify(settings);
    el("completed").textContent = "0 SPP";
    for (const id of ["batch","delivery","dimensions","backend"]) el(id).textContent = "—";
    updateFilterOptions();
    draw();
  }
  el("error").hidden = true;
  running = true;
  stopping = false;
  el("progress").value = 0;
  el("status").textContent = "Rendering…";
  updateButtons();
  worker.postMessage({type:fresh ? "fresh" : "continue",settings,samples:requested,forceCpu,startup});
}

function fail(message) {
  running = false;
  stopping = false;
  restartAfterStop = false;
  loadedSettings = undefined;
  el("status").textContent = "Render failed";
  el("error").textContent = message;
  el("error").hidden = false;
  updateButtons();
}

worker.onerror = event => fail(event.message || "Could not start the render worker.");
worker.onmessage = ({data}) => {
  if (data.type === "target") { requested = data.samples; return; }
  if (data.type === "fallback") {
    console.warn("Pocket Pol is using its CPU renderer.",data.message);
    return;
  }
  if (data.type === "error") {fail(data.message); return;}
  if (data.type === "stopped") {
    if (!stopping) return;
    running = stopping = false;
    el("status").textContent = "Stopped · "+(frame?.samples ?? 0)+" SPP";
    updateButtons();
    if (restartAfterStop) {
      restartAfterStop = false;
      begin(true);
    }
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
    el("status").textContent = "Ready · "+frame.samples+" SPP";
  }
  updateButtons();
};

el("estimateForm").addEventListener("submit",event => {event.preventDefault(); begin(true);});
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
el("continue").addEventListener("click",() => begin(false));
function stop() {
  if (!running || stopping) return;
  stopping = true;
  el("status").textContent = "Stopping after this sample batch…";
  updateButtons();
  worker.postMessage({type:"stop"});
}
el("stop").addEventListener("click",stop);
for (const id of ["channels","size","max_depth","rr_depth","spp"]) el(id).addEventListener("input",updateButtons);
for (const [id,{field}] of Object.entries(controls)) {
  field.addEventListener("input",() => {
    updateSlider(id);
    if (id === "zoom") canvas.style.transform = "scale("+field.value+")";
    else if (id === "exposure" || id === "angle") {display[id] = Number(field.value);draw();}
    else {
      if (id === "source_dop") updateSourceControls();
      updateButtons();
    }
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

function orbit(yaw,pitch) {
  updateSlider("yaw",((yaw+180)%360+360)%360-180);
  updateSlider("pitch",clamp(pitch,-80,80));
  updateButtons();
}
stage.addEventListener("pointerdown",event => {
  if (!event.isPrimary || event.button!==0) return;
  drag = {id:event.pointerId,x:event.clientX,y:event.clientY,yaw:Number(el("yaw").value),pitch:Number(el("pitch").value),moved:false};
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove",event => {
  if (drag?.id!==event.pointerId) return;
  const dx = event.clientX-drag.x;
  const dy = event.clientY-drag.y;
  if (!drag.moved && Math.hypot(dx,dy)<2) return;
  drag.moved = true;
  stop();
  orbit(drag.yaw-dx*.2,drag.pitch+dy*.2);
});
stage.addEventListener("lostpointercapture",() => {
  const moved = drag?.moved;
  drag = undefined;
  if (moved && stopping) restartAfterStop = true;
  else if (moved) begin(true);
});
stage.addEventListener("keydown",event => {
  const delta = {ArrowLeft:[-3,0],ArrowRight:[3,0],ArrowUp:[0,3],ArrowDown:[0,-3]}[event.key];
  if (!delta || running) return;
  event.preventDefault();
  orbit(Number(el("yaw").value)+delta[0],Number(el("pitch").value)+delta[1]);
  begin(true);
});
el("reset").addEventListener("click",() => {
  for (const [id,value] of Object.entries({yaw:0,pitch:0,distance:1,zoom:1})) updateSlider(id,value);
  canvas.style.transform = "";
  begin(true);
});

function download(blob,filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),10000);
}
el("saveImage").addEventListener("click",() => {
  canvas.toBlob(blob => {
    if (blob) download(blob,"pocket-pol.png");
  },"image/png");
});
el("saveChannels").addEventListener("click",() => {
  const {bytes,metadata} = exportChannels(frame);
  const json = new TextEncoder().encode(JSON.stringify(metadata,null,2)+"\n");
  download(zipFiles([["pocket-pol.f32",bytes],["pocket-pol.f32.json",json]]),"pocket-pol-channels.zip");
});

updateFilterOptions();
updateSourceControls();
begin(true,true);
