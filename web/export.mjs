// Export window: re-renders the current scene at a higher sample count in its own worker,
// then offers a PNG of the current view and the float32 Stokes channels, like Pollia's
// Save Image and Save Channels.
import {channelNames,displayPixels,filters} from "./display.mjs?v=43";
import {exportChannels} from "./renderer.mjs?v=43";
import {zipFiles} from "./files.mjs?v=43";

const el = id => document.getElementById(id);
const sceneNames = {cornell:"Cornell Box"};

const duration = ms => {
  const s = ms/1000;
  if (s<1) return "under a second";
  if (s<90) return Math.round(s)+" s";
  if (s<5400) return Math.round(s/60)+" min";
  return (s/3600).toFixed(1)+" h";
};

function save(blob,name) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"),{href:url,download:name});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),10000);
}

function describe(settings) {
  const light = settings.source_dop>0
    ? "Polarized · DoP "+Math.round(settings.source_dop*100)+"%, AoP "+settings.source_aolp.toFixed(1)+"°, ellipticity "+settings.source_ellipticity.toFixed(2)
    : "Unpolarized";
  const camera = "Yaw "+settings.yaw.toFixed(1)+"°, pitch "+settings.pitch.toFixed(1)+"°, distance "+settings.distance.toFixed(2)+"×";
  return [["Scene",sceneNames[settings.preset] ?? settings.preset],["Light",light],["Camera",camera],
    ["Max depth",String(settings.max_depth)],["Image",settings.size+" × "+settings.size+" · RGB Stokes"]];
}

export function setupExport({workerUrl,readSettings,getDisplay,getSpeed,getForceCpu}) {
  const dialog = el("exportDialog");
  const canvas = el("exportCanvas");
  const context = canvas.getContext("2d",{alpha:false});
  const spp = el("exportSpp");
  let worker;
  let job;

  function sameScene() {
    return job && JSON.stringify(job.settings) === JSON.stringify(readSettings());
  }

  function updateSummary() {
    const settings = job?.settings ?? readSettings();
    el("exportSummary").replaceChildren(...describe(settings).map(([term,value]) => {
      const row = document.createElement("div");
      row.className = "row";
      row.append(Object.assign(document.createElement("dt"),{textContent:term}),
        Object.assign(document.createElement("dd"),{textContent:value}));
      return row;
    }));
  }

  function updateEstimate() {
    const note = el("exportEstimate");
    const count = spp.valueAsNumber;
    spp.classList.toggle("invalid",!spp.validity.valid);
    for (const button of document.querySelectorAll("[data-export-spp]")) {
      button.setAttribute("aria-pressed",String(button.dataset.exportSpp===spp.value));
    }
    if (!spp.validity.valid || !Number.isInteger(count)) {
      note.textContent = "Enter a whole number from 1 to 65536.";
      note.classList.add("error");
      return;
    }
    note.classList.remove("error");
    const speed = getSpeed();
    note.textContent = speed
      ? "Estimated time: about "+duration(speed.msPerSample*count)+" on this device ("+(speed.backend==="WebGPU" ? "GPU" : "CPU renderer")+")."
      : "The time estimate appears after the first render in the viewer finishes.";
  }

  function updateControls() {
    const active = job?.running;
    const start = el("exportStart");
    start.textContent = active ? (job.stopping ? "Stopping…" : "Stop export render") : job?.frame ? "Render again" : "Start export render";
    start.classList.toggle("stop",Boolean(active));
    start.disabled = Boolean(job?.stopping) || (!active && !spp.validity.valid);
    spp.disabled = Boolean(active);
    for (const button of document.querySelectorAll("[data-export-spp]")) button.disabled = Boolean(active);
    el("exportDownloads").hidden = !job?.frame || active;
    el("exportProgress").classList.toggle("active",Boolean(active));
    el("exportEmpty").hidden = Boolean(job?.frame);
    const badge = el("exportBadge");
    badge.hidden = !job || (!active && !job.frame);
    badge.textContent = active ? Math.floor(el("exportProgress").value*100)+"%" : "Ready";
    badge.classList.toggle("ready",!active);
    let status = "";
    if (job?.error) status = job.error;
    else if (active) {
      const done = job.frame?.samples ?? 0;
      const elapsed = performance.now()-job.started;
      const left = done ? elapsed/done*(job.requested-done) : NaN;
      status = "Rendering "+done+" / "+job.requested+" SPP"+(Number.isFinite(left) ? " · about "+duration(left)+" left" : "");
    } else if (job?.frame) {
      status = (job.frame.samples<job.requested ? "Stopped at " : "Done · ")+job.frame.samples+" SPP"+
        (job.finished ? " in "+duration(job.finished-job.started) : "");
      if (!sameScene()) status += ". The scene has changed since; render again to include the changes.";
    }
    if (job?.cpu && active) status += " · CPU renderer, which is much slower";
    el("exportStatus").textContent = status;
  }

  function drawPreview() {
    if (!job?.frame) return;
    const {frame} = job;
    if (canvas.width!==frame.size) canvas.width = canvas.height = frame.size;
    context.putImageData(new ImageData(displayPixels(frame,getDisplay()),frame.size,frame.size),0,0);
  }

  function onMessage({data}) {
    if (!job) return;
    if (data.type === "fallback") {job.cpu = true; updateControls(); return;}
    if (data.type === "error") {
      Object.assign(job,{running:false,stopping:false,error:"Export failed: "+data.message});
      updateControls();
      return;
    }
    if (data.type === "stopped") {
      Object.assign(job,{running:false,stopping:false});
      updateControls();
      return;
    }
    if (data.type !== "frame") return;
    job.frame = data.frame;
    el("exportProgress").value = 1-data.remaining/job.requested;
    if (!data.remaining) Object.assign(job,{running:false,finished:performance.now()});
    // Redrawing every batch keeps the preview lively without slowing the render much.
    if (dialog.open) drawPreview();
    updateControls();
  }

  function start() {
    if (job?.running) {
      job.stopping = true;
      worker.postMessage({type:"stop"});
      updateControls();
      return;
    }
    const requested = spp.valueAsNumber;
    if (!spp.validity.valid || !Number.isInteger(requested)) return;
    if (!worker) {
      worker = new Worker(workerUrl,{type:"module"});
      worker.onmessage = onMessage;
      worker.onerror = event => onMessage({data:{type:"error",message:event.message || "Could not start the export worker."}});
    }
    job = {settings:readSettings(),requested,running:true,started:performance.now()};
    el("exportProgress").value = 0;
    context.fillStyle = "#0b0b0a";
    context.fillRect(0,0,canvas.width,canvas.height);
    updateSummary();
    updateControls();
    worker.postMessage({type:"fresh",settings:job.settings,samples:requested,forceCpu:getForceCpu()});
  }

  function baseName() {
    return "pocket-pol-"+job.frame.samples+"spp";
  }

  el("exportOpen").addEventListener("click",() => {
    updateSummary();
    updateEstimate();
    updateControls();
    drawPreview();
    dialog.showModal();
  });
  el("exportClose").addEventListener("click",() => dialog.close());
  // Clicking the dimmed backdrop closes the window too.
  dialog.addEventListener("click",event => {if (event.target === dialog) dialog.close();});
  el("exportStart").addEventListener("click",start);
  spp.addEventListener("input",() => {updateEstimate(); updateControls();});
  for (const button of document.querySelectorAll("[data-export-spp]")) {
    button.addEventListener("click",() => {spp.value = button.dataset.exportSpp; updateEstimate(); updateControls();});
  }
  el("downloadPng").addEventListener("click",() => {
    const display = getDisplay();
    const view = filters[display.filter].rgb ? "rgb" : channelNames[display.channel].toLowerCase();
    const off = document.createElement("canvas");
    off.width = off.height = job.frame.size;
    off.getContext("2d").putImageData(new ImageData(displayPixels(job.frame,display),job.frame.size,job.frame.size),0,0);
    off.toBlob(blob => save(blob,baseName()+"-"+display.filter+"-"+view+".png"),"image/png");
  });
  el("downloadStokes").addEventListener("click",() => {
    const {bytes,metadata} = exportChannels(job.frame);
    const name = baseName()+"-stokes";
    const json = new TextEncoder().encode(JSON.stringify({...metadata,data_file:name+".f32"},null,2));
    save(zipFiles([[name+".f32",bytes],[name+".json",json]]),name+".zip");
  });
  updateEstimate();
}
