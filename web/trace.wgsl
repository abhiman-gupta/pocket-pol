// WebGPU port of the Pollia Jarecki/Mueller path. See LICENSE.
struct Shape {
  corner: vec4f, // w is the material index
  edge_u: vec4f,
  edge_v: vec4f,
  normal: vec4f,
}
struct Material {
  jarecki: vec4f,
  extra: vec4f, // xi, reflectance
}
struct Hit { distance: f32, index: u32, normal: vec3f }
struct LightSample { direction: vec3f, pdf: f32, cosine: f32 }
struct Params {
  config: vec4u, // size, max depth, RR depth (0 = off), light index
  eye: vec4f, // w is half of the camera plane height
  forward: vec4f,
  right: vec4f,
  up: vec4f,
  source: vec4f,
  emission: vec4f,
}

@group(0) @binding(0) var<storage,read_write> accumulation: array<vec4f>;
@group(0) @binding(1) var<storage,read> shapes: array<Shape>;
@group(0) @binding(2) var<storage,read> materials: array<Material>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<uniform> pass_info: vec4u; // start sample, count, seed

override channels: u32 = 3u;
const pi = 3.14159265;
const eps = .0001;
const identity = mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(0,0,0,1));
const depolarizer = mat4x4f(vec4f(1,0,0,0), vec4f(0), vec4f(0), vec4f(0));

// PCG hash. Seeding each pixel and sample through it decorrelates neighboring pixels, whose raw
// seeds differ only linearly and otherwise show up as diagonal streaks at low sample counts.
fn pcg_hash(x: u32) -> u32 {
  let state = x*747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state)*277803737u;
  return (word >> 22u) ^ word;
}

fn random(rng: ptr<function, u32>) -> f32 {
  *rng = *rng * 1664525u + 1013904223u;
  return f32(*rng >> 8u) / 16777216.0;
}

fn intersect(origin: vec3f, ray: vec3f, limit: f32, shadow: bool) -> Hit {
  var hit = Hit(limit, 0xffffffffu, vec3f(0));
  for (var index = 0u; index < arrayLength(&shapes); index++) {
    let shape = shapes[index];
    let denom = dot(ray,shape.normal.xyz);
    // Cutaway room walls carry a negative area (normal.w, read only for the lamp) and are skipped
    // from behind, so orbiting past a wall shows the inside. Other shapes block from either side.
    if (shape.normal.w < 0) {
      if (denom > -eps) { continue; }
    } else if (abs(denom) < eps) { continue; }
    let delta = shape.corner.xyz-origin;
    let t = dot(delta,shape.normal.xyz)/denom;
    if (t <= eps || t >= hit.distance) { continue; }
    let offset = t*ray-delta;
    let u = dot(offset,shape.edge_u.xyz)*shape.edge_u.w;
    let v = dot(offset,shape.edge_v.xyz)*shape.edge_v.w;
    if (u < 0 || u > 1 || v < 0 || v > 1) { continue; }
    hit = Hit(t,index,shape.normal.xyz);
    if (shadow) { return hit; }
  }
  return hit;
}

fn sample_light(p: vec3f, n: vec3f, rng: ptr<function,u32>) -> LightSample {
  let light = shapes[params.config.w];
  let u = random(rng);
  let v = random(rng);
  let offset = light.corner.xyz+light.edge_u.xyz*u+light.edge_v.xyz*v-p;
  let d2 = dot(offset,offset);
  let distance = sqrt(d2);
  if (distance <= eps) { return LightSample(vec3f(0),0,0); }
  let ray = offset/distance;
  let cosine = dot(ray,n);
  let light_cos = -dot(ray,light.normal.xyz);
  if (cosine <= 0 || light_cos <= 0 || intersect(p,ray,distance-eps,true).index != 0xffffffffu) {
    return LightSample(ray,0,0);
  }
  return LightSample(ray,d2/(light.normal.w*light_cos),cosine);
}
fn hemisphere(n: vec3f,rng: ptr<function,u32>) -> vec3f {
  let phi = 2*pi*random(rng);
  let r2 = random(rng);
  let r = sqrt(r2);
  let tangent = normalize(cross(select(vec3f(1,0,0),vec3f(0,1,0),abs(n.y)<.9),n));
  return n*sqrt(1-r2)+tangent*r*cos(phi)+cross(n,tangent)*r*sin(phi);
}

fn basis(v: vec3f) -> vec3f {
  let s = select(1.0,-1.0,v.z<0);
  let a = -s/(s+v.z);
  return vec3f(1+v.x*v.x*a,v.x*v.y*a,-s*v.x);
}
fn cmul(a: vec2f,b: vec2f) -> vec2f {
  return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);
}
fn cconj(a: vec2f) -> vec2f { return vec2f(a.x,-a.y); }
fn cdiv(a: vec2f,b: vec2f) -> vec2f { return cmul(a,cconj(b))/dot(b,b); }

fn jarecki(wi: vec3f,wo: vec3f,n: vec3f,material: Material) -> mat4x4f {
  let half_raw = wi+wo;
  if (dot(half_raw,half_raw)<1e-10) { return mat4x4f(vec4f(0),vec4f(0),vec4f(0),vec4f(0)); }
  let h = normalize(half_raw);
  let sr = cross(wo,h);
  if (dot(sr,sr)<1e-10) { return depolarizer; }
  let s = normalize(sr);
  let hp = cross(h,n);
  var cp = 1.0;
  var sp = 0.0;
  if (dot(hp,hp)>=1e-10) {
    let unit_hp = normalize(hp);
    cp = dot(unit_hp,-s);
    sp = dot(cross(unit_hp,-s),h);
  }
  let nh = dot(n,h);
  let cos_d = clamp(dot(h,wo),0,1);
  let nr = material.jarecki.z;
  let ki = material.jarecki.w;
  let eta2 = vec2f(nr*nr-ki*ki,2*nr*ki);
  let r = eta2.x-1+cos_d*cos_d;
  let modulus = length(vec2f(r,eta2.y));
  let root = vec2f(sqrt(max(0,(modulus+r)/2)),sqrt(max(0,(modulus-r)/2))*select(-1.0,1.0,eta2.y>0));
  let cs = vec2f(cos_d,0);
  let rs = cdiv(cs-root,cs+root);
  let rp = cdiv(eta2*cos_d-root,eta2*cos_d+root);
  let rs2 = dot(rs,rs);
  let rp2 = dot(rp,rp);
  let gamma = clamp((rs2-rp2)/max(1e-30,rs2+rp2)*(4*material.extra.x-1)/3,0,1);
  if (gamma == 0) { return depolarizer; }
  let f = material.jarecki.x*pow(sqrt(max(0,1-nh*nh)),material.jarecki.y);
  let ja = rs+vec2f(f*cp*cp,0);
  let jb = vec2f(f*cp*sp,0);
  let jc = -jb;
  let jd = rp-vec2f(f*sp*sp,0);

  let xi = basis(-wi);
  let yi = cross(-wi,xi);
  let xo = basis(wo);
  let yo = cross(wo,xo);
  let pin = cross(-wi,s);
  let pout = cross(wo,s);
  let x = ja*dot(s,xi)+jb*dot(pin,xi);
  let y = ja*dot(s,yi)+jb*dot(pin,yi);
  let z = jc*dot(s,xi)+jd*dot(pin,xi);
  let w = jc*dot(s,yi)+jd*dot(pin,yi);
  let a = x*dot(xo,s)+z*dot(xo,pout);
  let b = y*dot(xo,s)+w*dot(xo,pout);
  let c = x*dot(yo,s)+z*dot(yo,pout);
  let d = y*dot(yo,s)+w*dot(yo,pout);

  let a2 = dot(a,a); let b2 = dot(b,b); let c2 = dot(c,c); let d2 = dot(d,d);
  let ab = cmul(a,cconj(b)); let ac = cmul(a,cconj(c)); let ad = cmul(a,cconj(d));
  let bc = cmul(b,cconj(c)); let bd = cmul(b,cconj(d)); let cd = cmul(c,cconj(d));
  let m00 = (a2+b2+c2+d2)/2;
  if (!(m00 > 1e-30)) { return mat4x4f(vec4f(0),vec4f(0),vec4f(0),vec4f(0)); }
  let g = gamma/m00;
  return mat4x4f(
    vec4f(1,g*(a2+b2-c2-d2)/2,g*(ac.x+bd.x),-g*(ac.y+bd.y)),
    g*vec4f((a2-b2+c2-d2)/2,(a2-b2-c2+d2)/2,ac.x-bd.x,-ac.y+bd.y),
    g*vec4f(ab.x+cd.x,ab.x-cd.x,ad.x+bc.x,-ad.y-bc.y),
    g*vec4f(ab.y+cd.y,ab.y-cd.y,ad.y-bc.y,ad.x-bc.x));
}

fn emitted(forward: vec3f,normal: vec3f) -> vec4f {
  let source = params.source;
  if (source.x == 0) { return vec4f(1,0,0,0); }
  let horizontal = vec3f(1,0,0)-normal*normal.x;
  let projection = horizontal-forward*dot(horizontal,forward);
  let axis = normalize(select(cross(cross(normal,horizontal),forward),projection,
    dot(projection,projection)>1e-10));
  let reference_axis = basis(forward);
  let theta = atan2(dot(forward,cross(axis,reference_axis)),dot(axis,reference_axis));
  let chi = atan(source.z);
  let psi = 2*(source.y*pi/180-theta);
  let linear = source.x*cos(2*chi);
  return vec4f(1,linear*cos(psi),linear*sin(psi),source.x*sin(2*chi));
}
fn mis(a: f32,b: f32) -> f32 { return a*a/(a*a+b*b); }

fn trace_mueller(ray_origin: vec3f, ray_direction: vec3f, rng: ptr<function,u32>) -> array<vec4f, 3> {
  var origin = ray_origin;
  var ray = ray_direction;
  var transport: array<mat4x4f, 3>;
  var beta: array<f32, 3>;
  var result: array<vec4f, 3>;
  for (var c=0u; c<channels; c++) {
    transport[c] = identity;
    beta[c] = 1;
  }
  let light_index = params.config.w;
  let light = shapes[light_index];
  var prev_pdf = 0.0;
  for (var depth=0u; depth<params.config.y; depth++) {
    let hit = intersect(origin,ray,1e20,false);
    if (hit.index == 0xffffffffu) { break; }
    let wo = -ray;
    let n = hit.normal;
    let facing = dot(wo,n);
    if (facing <= 0) { break; }
    if (hit.index == light_index) {
      let pdf = hit.distance*hit.distance/(light.normal.w*facing);
      let input = emitted(wo,light.normal.xyz);
      let weight = select(mis(prev_pdf,pdf),1.0,depth==0u);
      for (var c=0u; c<channels; c++) {
        result[c] += (transport[c]*input)*(beta[c]*params.emission[c]*weight);
      }
    }
    if (depth+1u == params.config.y) { break; }
    let material_offset = u32(shapes[hit.index].corner.w)*channels;
    origin = (origin+ray*hit.distance)+n*eps;
    let direct = sample_light(origin,n,rng);
    var source = vec4f(0);
    var direct_weight = 0.0;
    if (direct.pdf > 0) {
      let bsdf_pdf = direct.cosine/pi;
      direct_weight = bsdf_pdf/direct.pdf*mis(direct.pdf,bsdf_pdf);
      source = emitted(-direct.direction,light.normal.xyz);
    }
    ray = hemisphere(n,rng);
    prev_pdf = max(0,dot(n,ray))/pi;
    var brightest = 0.0;
    for (var c=0u; c<channels; c++) {
      if (beta[c] == 0) { continue; }
      let material = materials[material_offset+c];
      beta[c] *= material.extra.y;
      if (direct_weight > 0) {
        let matrix = jarecki(direct.direction,wo,n,material);
        result[c] += (transport[c]*(matrix*source))*(direct_weight*beta[c]*params.emission[c]);
      }
      let matrix = jarecki(ray,wo,n,material);
      if (matrix[0][0] == 0) { beta[c] = 0; }
      else { transport[c] *= matrix; }
      brightest = max(brightest,beta[c]);
    }
    if (brightest <= 0) { break; }
    // Russian roulette is off while RR depth is 0 (the default); set rr_depth to re-enable it.
    if (params.config.z != 0u && depth+1u >= params.config.z) {
      let probability = min(.95,brightest);
      if (random(rng) >= probability) { break; }
      for (var c=0u; c<channels; c++) { beta[c] /= probability; }
    }
  }
  return result;
}

fn sensor_stokes(value: vec4f,ray: vec3f,up: vec3f) -> vec4f {
  let current = basis(-ray);
  let axis = normalize(cross(ray,up));
  let c = dot(current,axis);
  let s = dot(-ray,cross(current,axis));
  let cos2 = c*c-s*s;
  let sin2 = 2*c*s;
  return vec4f(value.x,cos2*value.y+sin2*value.z,-sin2*value.y+cos2*value.z,value.w);
}

@compute @workgroup_size(8,4)
fn render(@builtin(global_invocation_id) id: vec3u) {
  let size = params.config.x;
  if (id.x >= size || id.y >= size) { return; }
  let index = id.y*size+id.x;
  let offset = index*channels;
  var total: array<vec4f,3>;
  for (var c=0u; c<channels; c++) { total[c] = accumulation[offset+c]; }
  for (var i=0u; i<pass_info.y; i++) {
    let sample = pass_info.x+i;
    var rng = pcg_hash(index + pcg_hash(sample + pass_info.z));
    let size_f = f32(size);
    let u = (2*((f32(id.x)+random(&rng))/size_f)-1)*params.eye.w;
    let v = (1-2*((f32(id.y)+random(&rng))/size_f))*params.eye.w;
    let ray = normalize(params.forward.xyz+(params.right.xyz*u+params.up.xyz*v));
    let result = trace_mueller(params.eye.xyz,ray,&rng);
    for (var c=0u; c<channels; c++) {
      total[c] += sensor_stokes(result[c],ray,params.up.xyz);
    }
  }
  for (var c=0u; c<channels; c++) { accumulation[offset+c] = total[c]; }
}
