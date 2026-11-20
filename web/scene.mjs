// Cornell geometry and material parameters from Pollia (a8c7d7ea).
export const add = (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const scale = (a,s) => [a[0]*s, a[1]*s, a[2]*s];
export const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const unit = a => scale(a, 1/Math.sqrt(dot(a,a)));
export const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
const radians = angle => angle*Math.PI/180;

const white = [
  [.97,.26,2,1.26,.08,.26], [.97,.26,2,1.25,.08,.26], [.97,.26,2,1.24,.08,.26],
];
const red = [
  [.80,.17,2,1.30,.08,.33], [.05,.09,2.4,1.23,.19,1], [.05,.03,2.5,1.20,.25,.75],
];
const green = [
  [.08,.07,2.1,1.30,.25,.71], [.53,.17,2.5,1.23,.08,.43], [.13,.13,2.4,1.20,.13,.54],
];
const radiance = [18.387,13.9873,6.75357];
const luminanceWeights = [.212671,.715160,.072169];

function quad(corner,u,v,material) {
  const normal = cross(u,v);
  return {corner,u,v,normal:unit(normal),invU:1/dot(u,u),invV:1/dot(v,v),
    area:Math.sqrt(dot(normal,normal)),material};
}

function box(center,angle,halfHeight,material) {
  const theta = radians(angle);
  const x = [.6*Math.cos(theta),0,-.6*Math.sin(theta)];
  const y = [0,halfHeight*2,0];
  const z = [.6*Math.sin(theta),0,.6*Math.cos(theta)];
  const origin = sub(center,scale(add(add(x,y),z),.5));
  return [
    quad(origin,x,z,material), quad(add(origin,y),z,x,material),
    quad(origin,y,x,material), quad(add(origin,z),x,y,material),
    quad(origin,z,y,material), quad(add(origin,x),y,z,material),
  ];
}

export const defaultScene = Object.freeze({
  preset:"cornell", channels:"rgb", size:512, max_depth:4, rr_depth:8,
  light_scale:1, source_dop:0, source_aolp:0, source_ellipticity:0, yaw:0, pitch:0, distance:1,
});

export function makeScene(settings) {
  const channels = settings.channels === "mono" ? [1] : [0,1,2];
  const material = presets => channels.map(channel => ({
    reflectance:presets[channel][0], coefficients:presets[channel].slice(1),
  }));
  const whiteNylon = material(white);
  const light = quad([-.23,.99,-.18],[.46,0,0],[0,0,.38],whiteNylon);
  // Pollia takes the green material coefficients in mono, but Mitsuba's RGB emitter converts to luminance.
  const emitter = channels.length === 1 ? [dot(radiance,luminanceWeights)] : radiance;
  light.emission = emitter.map(value => value*settings.light_scale);
  const shapes = [
    quad([-1,-1,-1],[0,0,2],[2,0,0],whiteNylon),
    quad([-1,1,-1],[2,0,0],[0,0,2],whiteNylon),
    quad([-1,-1,-1],[2,0,0],[0,2,0],whiteNylon),
    quad([-1,-1,-1],[0,2,0],[0,0,2],material(red)),
    quad([1,-1,-1],[0,0,2],[0,2,0],material(green)),
    light,
    ...box([.335,-.7,.38],-17,.3,whiteNylon),
    // Mitsuba's cornell_box() centers this block at y = -0.4, which sinks it 0.01 into the floor.
    // Raise it by 0.01 so it rests on the floor like the short block, keeping its 1.22 height.
    ...box([-.33,-.39,-.28],18.25,.61,whiteNylon),
  ];
  const yaw = radians(settings.yaw);
  const pitch = radians(settings.pitch);
  const eye = scale([Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)],3.9*settings.distance);
  const forward = unit(scale(eye,-1));
  const right = unit(cross(forward,[0,1,0]));
  return {shapes,light,channels:channels.length,source:[settings.source_dop,settings.source_aolp,settings.source_ellipticity],
    camera:{eye,forward,right,up:cross(right,forward),halfHeight:Math.tan(radians(39)/2)}};
}
