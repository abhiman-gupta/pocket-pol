import {parseArgs} from "node:util";
import {writeFile} from "node:fs/promises";
import {deflateSync} from "node:zlib";
import {defaultScene} from "./scene.mjs?v=31";
import {exportChannels} from "./renderer.mjs?v=31";
import {defaultWorkers,renderHeadless,renderHeadlessGpu} from "./headless.mjs?v=31";
import {displayDefaults,displayPixels,filters} from "./display.mjs?v=31";
import {crc32} from "./files.mjs?v=31";

const usage = `Usage: node render.mjs --scene cornell --spp 256 --out cornell
Options:
  --size 128|256|512                  Default: 512
  --channels rgb|mono                 Default: rgb
  --spp positive integer              Default: 256
  --seed uint32                       Default: 0
  --backend auto|cpu|webgpu           Default: auto
  --workers 1–32                      Default: up to 8 CPU threads
  --filter ${Object.keys(filters).join("|")}
  --channel red|green|blue             Scalar display channel
  --exposure EV --analyzer degrees    Display controls
Writes <out>.png, <out>.f32 and <out>.f32.json.`;

function int(value,name,min,max) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed<min || parsed>max) {
    throw new Error("--"+name+" must be an integer from "+min+" to "+max);
  }
  return parsed;
}

function number(value,name,min,max) {
  const parsed = Number(value);
  if (value.trim()==="" || !Number.isFinite(parsed) || parsed<min || parsed>max) {
    throw new Error("--"+name+" must be a number from "+min+" to "+max);
  }
  return parsed;
}

function pngChunk(name,data) {
  const type = Buffer.from(name);
  const chunk = Buffer.alloc(data.length+12);
  chunk.writeUInt32BE(data.length);
  type.copy(chunk,4);
  data.copy(chunk,8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
  return chunk;
}

function encodePng(size,pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size,4);
  header[8] = 8;
  header[9] = 6;
  const stride = size*4+1;
  const scanlines = Buffer.alloc(size*stride);
  for (let row=0; row<size; row++) {
    scanlines.set(pixels.subarray(row*size*4,(row+1)*size*4),row*stride+1);
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk("IHDR",header),pngChunk("sRGB",Buffer.from([0])),
    pngChunk("IDAT",deflateSync(scanlines)),pngChunk("IEND",Buffer.alloc(0)),
  ]);
}

async function main() {
  const {values} = parseArgs({options:{
    help:{type:"boolean",short:"h"},
    scene:{type:"string",default:"cornell"},
    size:{type:"string",default:"512"},
    channels:{type:"string",default:"rgb"},
    spp:{type:"string",default:"256"},
    seed:{type:"string",default:"0"},
    out:{type:"string",default:"pocket-pol-cornell"},
    backend:{type:"string",default:"auto"},
    workers:{type:"string"},
    filter:{type:"string"},
    channel:{type:"string",default:"red"},
    exposure:{type:"string",default:"0"},
    analyzer:{type:"string",default:"0"},
  }});
  if (values.help) {console.log(usage); return;}
  if (values.scene!=="cornell") throw new Error("Only the cornell preset is available");
  if (!["128","256","512"].includes(values.size)) throw new Error("--size must be 128, 256, or 512");
  if (!["rgb","mono"].includes(values.channels)) throw new Error("--channels must be rgb or mono");
  const filter = values.filter ?? (values.channels==="rgb" ? "rgbIntensity" : "intensity");
  if (!Object.hasOwn(filters,filter) || (filters[filter].rgb && values.channels==="mono")) throw new Error("Filter is unavailable for these channels");
  const channel = ["red","green","blue"].indexOf(values.channel);
  if (channel<0) throw new Error("--channel must be red, green or blue");
  if (!values.out.trim()) throw new Error("--out requires a file prefix");
  if (!["auto","cpu","webgpu"].includes(values.backend)) throw new Error("--backend must be auto, cpu, or webgpu");
  const display = {...displayDefaults(filter),channel,exposure:number(values.exposure,"exposure",-8,8),
    angle:number(values.analyzer,"analyzer",-90,90)};
  const target = int(values.spp,"spp",1,0xffffffff);
  const seed = int(values.seed,"seed",0,0xffffffff);
  const workers = values.workers === undefined ? defaultWorkers : int(values.workers,"workers",1,32);
  const settings = {...defaultScene,size:Number(values.size),channels:values.channels};
  const onProgress = samples => console.error(samples+" / "+target+" SPP");
  let frame;
  if (values.backend !== "cpu") {
    try {
      frame = await renderHeadlessGpu(settings,seed,target,onProgress);
    } catch (error) {
      if (values.backend === "webgpu") throw error;
      console.error("WebGPU unavailable. Using CPU workers.",error.message);
    }
    if (!frame && values.backend === "webgpu") throw new Error("Install the optional webgpu package to use --backend webgpu");
  }
  frame ??= await renderHeadless(settings,seed,target,workers,onProgress);
  const {bytes,metadata} = exportChannels(frame);
  const png = encodePng(frame.size,displayPixels(frame,display));
  await Promise.all([
    writeFile(values.out+".png",png),
    writeFile(values.out+".f32",new Uint8Array(bytes)),
    writeFile(values.out+".f32.json",JSON.stringify(metadata,null,2)+"\n"),
  ]);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
