// Browser adaptation of Pollia's Jarecki model and Stokes conventions.
import {add,sub,scale,dot,cross,unit} from "./scene.mjs?v=54";

export const identity = Array.from({length:16},(_,i) => i%5 === 0 ? 1 : 0);
const depolarizer = [1,...Array(15).fill(0)];
const norm2 = a => dot(a,a);
const conj = a => [a[0],-a[1]];
const cmul = (a,b) => [a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
const power = a => a[0]*a[0]+a[1]*a[1];
function divide(a,b) {
  const d = power(b);
  return [(a[0]*b[0]+a[1]*b[1])/d,(a[1]*b[0]-a[0]*b[1])/d];
}
function basis([x,y,z]) {
  const sign = z < 0 ? -1 : 1;
  const a = -sign/(sign+z);
  return [1+x*x*a,x*y*a,-sign*x];
}
function fresnel(c,n,k) {
  const index = [n*n-k*k,2*n*k];
  const r = index[0]-1+c*c;
  const length = Math.hypot(r,index[1]);
  const root = [Math.sqrt(Math.max(0,(length+r)/2)),
    Math.sqrt(Math.max(0,(length-r)/2))*(index[1] > 0 ? 1 : -1)];
  const nc = c*index[0], kc = c*index[1];
  return [divide([c-root[0],-root[1]],[c+root[0],root[1]]),
    divide([nc-root[0],kc-root[1]],[nc+root[0],kc+root[1]])];
}
function combine(a,b,u,v) {
  return [a[0]*u+b[0]*v,a[1]*u+b[1]*v];
}
function worldJones([a,b,c,d],s,wi,wo) {
  const incoming = scale(wi,-1);
  const xi = basis(incoming), yi = cross(incoming,xi);
  const xo = basis(wo), yo = cross(wo,xo);
  const pi = cross(incoming,s), po = cross(wo,s);
  const x = combine(a,b,dot(s,xi),dot(pi,xi)), y = combine(a,b,dot(s,yi),dot(pi,yi));
  const z = combine(c,d,dot(s,xi),dot(pi,xi)), w = combine(c,d,dot(s,yi),dot(pi,yi));
  return [combine(x,z,dot(xo,s),dot(xo,po)),combine(y,w,dot(xo,s),dot(xo,po)),
    combine(x,z,dot(yo,s),dot(yo,po)),combine(y,w,dot(yo,s),dot(yo,po))];
}

export function jarecki(wi,wo,normal,[A,B,n,k,xi]) {
  const half = add(wi,wo), hl = norm2(half);
  if (hl < 1e-10) return null;
  const h = scale(half,1/Math.sqrt(hl));
  const raw = cross(wo,h);
  if (norm2(raw) < 1e-10) return depolarizer;
  const s = unit(raw), halfPlane = cross(h,normal);
  let cosPhi = 1, sinPhi = 0;
  if (norm2(halfPlane) >= 1e-10) {
    const hp = unit(halfPlane), exit = scale(s,-1);
    cosPhi = dot(hp,exit);
    sinPhi = dot(cross(hp,exit),h);
  }
  const hn = dot(h,normal);
  const cd = Math.min(1,Math.max(0,dot(h,wo)));
  const [rs,rp] = fresnel(cd,n,k);
  const rs2 = power(rs), rp2 = power(rp);
  const gamma = Math.max(0,Math.min(1,(rs2-rp2)/Math.max(1e-30,rs2+rp2)*(4*xi-1)/3));
  if (gamma === 0) return depolarizer;
  const f = A*Math.sqrt(Math.max(0,1-hn*hn))**B;
  const [a,b,c,d] = worldJones([
    [rs[0]+f*cosPhi*cosPhi,rs[1]],[f*cosPhi*sinPhi,0],
    [-f*cosPhi*sinPhi,0],[rp[0]-f*sinPhi*sinPhi,rp[1]]
  ],s,wi,wo);
  const a2 = power(a), b2 = power(b), c2 = power(c), d2 = power(d);
  const m00 = (a2+b2+c2+d2)/2;
  if (!(m00 > 1e-30)) return null;
  const g = gamma/m00;
  const [ab,ac,ad,bc,bd,ce] = [cmul(a,conj(b)),cmul(a,conj(c)),cmul(a,conj(d)),
    cmul(b,conj(c)),cmul(b,conj(d)),cmul(c,conj(d))];
  return [
    1,g*(a2-b2+c2-d2)/2,g*(ab[0]+ce[0]),g*(ab[1]+ce[1]),
    g*(a2+b2-c2-d2)/2,g*(a2-b2-c2+d2)/2,g*(ab[0]-ce[0]),g*(ab[1]-ce[1]),
    g*(ac[0]+bd[0]),g*(ac[0]-bd[0]),g*(ad[0]+bc[0]),g*(ad[1]-bc[1]),
    -g*(ac[1]+bd[1]),g*(-ac[1]+bd[1]),-g*(ad[1]+bc[1]),g*(ad[0]-bc[0])
  ];
}

export function applyMatrix(m,v) {
  return [0,4,8,12].map(i => m[i]*v[0]+m[i+1]*v[1]+m[i+2]*v[2]+m[i+3]*v[3]);
}
export function product(a,b) {
  const result = new Array(16);
  for (let i=0; i<16; i+=4) {
    for (let j=0; j<4; j++) {
      result[i+j] = a[i]*b[j]+a[i+1]*b[j+4]+a[i+2]*b[j+8]+a[i+3]*b[j+12];
    }
  }
  return result;
}

export function emitted([dop,angle,ellipticity],forward,normal) {
  if (dop === 0) return [1,0,0,0];
  const horizontal = sub([1,0,0],scale(normal,normal[0]));
  const projection = sub(horizontal,scale(forward,dot(horizontal,forward)));
  const axis = unit(norm2(projection)>1e-10 ? projection :
    cross(cross(normal,horizontal),forward));
  const target = basis(forward);
  const theta = Math.atan2(dot(forward,cross(axis,target)),dot(axis,target));
  const chi = Math.atan(ellipticity);
  const psi = 2*(angle*Math.PI/180-theta);
  const linear = dop*Math.cos(2*chi);
  return [1,linear*Math.cos(psi),linear*Math.sin(psi),dop*Math.sin(2*chi)];
}

export function sensorStokes(value,ray,up) {
  const forward = scale(ray,-1);
  const current = basis(forward);
  const target = unit(cross(ray,up));
  const c = dot(current,target);
  const s = dot(forward,cross(current,target));
  const cos2 = c*c-s*s;
  const sin2 = 2*c*s;
  return [value[0],cos2*value[1]+sin2*value[2],-sin2*value[1]+cos2*value[2],value[3]];
}
