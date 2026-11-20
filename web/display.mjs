import {palettes} from "./palettes.mjs?v=34";
import {clamp} from "./scene.mjs?v=34";

export const filters = {
  rgbIntensity:{title:"RGB Intensity",exposure:true,rgb:true},
  rgbAnalyzer:{title:"RGB Analyzer",exposure:true,rgb:true,analyzer:true,hint:"Light passed by a linear polarizer at the angle below."},
  intensity:{title:"Intensity",exposure:true,log:true,hint:"Total light reaching the camera in the selected channel."},
  analyzer:{title:"Analyzer",exposure:true,log:true,analyzer:true,hint:"Light passed by a linear polarizer at the angle below."},
  dop:{title:"Degree of Polarization",log:true,hint:"The fraction of the light that is polarized."},
  aolp:{title:"AoLP [°]",range:[-90,90],map:"phase",hint:"The angle of linear polarization, measured in degrees."},
  ellipticity:{title:"Ellipticity",range:[-1,1],map:"viridis",hint:"How close the polarization is to linear or circular."},
  q:{title:"Q / I",range:[-1,1],map:"diverging",hint:"Horizontal versus vertical linear polarization, divided by intensity."},
  u:{title:"U / I",range:[-1,1],map:"diverging",hint:"+45° versus −45° linear polarization, divided by intensity."},
  v:{title:"V / I",range:[-1,1],map:"diverging",hint:"Right versus left circular polarization, divided by intensity."},
};
export const maps = ["turbo","viridis","phase","diverging","grayscale","seismic"];

export function displayDefaults(filter) {
  const [minimum,maximum] = filters[filter].range ?? [0,1];
  return {filter,channel:0,exposure:0,angle:0,minimum,maximum,map:filters[filter].map ?? "grayscale",log:false};
}

function scalar(pixels,offset,filter,cosine,sine) {
  const i = pixels[offset], q = pixels[offset+1], u = pixels[offset+2], v = pixels[offset+3];
  switch (filter) {
    case "rgbIntensity":
    case "intensity": return i;
    case "rgbAnalyzer":
    case "analyzer": return .5*(i+q*cosine+u*sine);
    default: if (i<=0) return NaN;
  }
  const linear = Math.hypot(q,u);
  const polarized = Math.hypot(linear,v);
  switch (filter) {
    case "dop": return polarized/i;
    case "aolp": return linear>0 ? Math.atan2(u,q)*90/Math.PI : NaN;
    case "ellipticity": return polarized>0 ? v/(polarized+linear) : NaN;
    case "q": return q/i;
    case "u": return u/i;
    case "v": return v/i;
  }
}

function srgb(value) {
  const x = clamp(value,0,1);
  return x<=.0031308 ? x*12.92 : 1.055*x**(1/2.4)-.055;
}

export function displayPixels(frame,display) {
  const {size,channels,pixels} = frame;
  const {filter,channel,exposure,angle,minimum,maximum,map,log} = display;
  const spec = filters[filter];
  const gain = spec.exposure ? 2**exposure : 1;
  const cosine = Math.cos(angle*Math.PI/90);
  const sine = Math.sin(angle*Math.PI/90);
  const palette = palettes[map];
  const span = maximum-minimum;
  const floor = span*1e-3;
  const result = new Uint8ClampedArray(size*size*4);
  for (let pixel=0; pixel<size*size; pixel++) {
    const output = pixel*4;
    result[output+3] = 255;
    const base = pixel*channels*4;
    if (spec.rgb) {
      for (let c=0; c<3; c++) {
        const value = scalar(pixels,base+Math.min(channels-1,c)*4,filter,cosine,sine);
        result[output+c] = srgb(value*gain)*255;
      }
      continue;
    }
    const value = scalar(pixels,base+Math.min(channel,channels-1)*4,filter,cosine,sine)*gain;
    if (!Number.isFinite(value)) continue;
    let position = (value-minimum)/span;
    if (log && spec.log) {
      position = minimum>0
        ? Math.log(Math.max(value,minimum)/minimum)/Math.log(maximum/minimum)
        : Math.log(Math.max(value-minimum,floor)/floor)/Math.log(span/floor);
    }
    const index = clamp(position,0,1)*(palette.length-1);
    const lower = Math.floor(index);
    const upper = Math.min(lower+1,palette.length-1);
    for (let c=0; c<3; c++) result[output+c] = 255*(palette[lower][c]+(index-lower)*(palette[upper][c]-palette[lower][c]));
  }
  return result;
}

export function colorbar(map) {
  return "linear-gradient(to top,"+palettes[map].map(color => "rgb("+color.map(x=>Math.round(x*255)).join(" ")+")").join(",")+")";
}
