// All WGSL lives here. Particle = 32 bytes: pos.xyz + hue seed (w), vel.xyz + unused (w).

const common = /* wgsl */ `
struct Particle { pos: vec4f, vel: vec4f };

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rnd(v: u32) -> f32 { return f32(pcg(v)) * (1.0 / 4294967296.0); }
`;

export const simShader = /* wgsl */ `
${common}

struct Sim {
  time: f32, dt: f32, morph: f32, fraction: f32,
  mouse: vec4f,          // xyz = world point, w = strength
  count: u32, targetCount: u32, seed: u32, _pad: u32,
  offset: vec4f,         // xyz = shape centre, w = jitter
  shape: vec4f,          // x = spin speed, y = scale
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> targets: array<vec4f>;
@group(0) @binding(2) var<uniform> u: Sim;

// Divergence-free flow: each component depends only on the other two axes.
fn flow(p: vec3f, t: f32) -> vec3f {
  let a = vec3f(
    sin(p.y * 1.7 + t) + cos(p.z * 1.3 - t * 0.7),
    sin(p.z * 1.5 + t * 0.8) + cos(p.x * 1.1 + t),
    sin(p.x * 1.9 - t * 0.6) + cos(p.y * 1.4 + t * 0.9));
  let q = p * 2.3 + vec3f(3.1, 1.7, 5.3);
  let b = vec3f(sin(q.y - t * 1.3), sin(q.z + t * 1.1), sin(q.x + t * 0.9));
  return a + b * 0.5;
}

// Procedural spiral-galaxy "home" position for particle i, rotating rigidly over time.
fn galaxyHome(i: u32, t: f32) -> vec3f {
  let base = i * 7u;
  if (rnd(base + 5u) < 0.14) {
    // central bulge
    let z = rnd(base + 1u) * 2.0 - 1.0;
    let a = rnd(base + 2u) * 6.2831853 + t * 0.1;
    let r = pow(rnd(base + 3u), 2.0) * 0.55;
    let s = sqrt(1.0 - z * z);
    return vec3f(cos(a) * s * r, z * r * 0.6, sin(a) * s * r);
  }
  let r = 0.12 + pow(rnd(base + 1u), 1.5) * 2.7;
  let arm = f32(pcg(base + 2u) % 4u) * 1.5707963;
  let g = (rnd(base + 3u) + rnd(base + 6u) - 1.0);
  let ang = arm + log(r + 0.15) * 2.1 + g * (0.25 + 0.35 / (r + 0.3)) - t * 0.07;
  let h = (rnd(base + 4u) + rnd(base + 0u) - 1.0) * 0.22 * exp(-r * 0.7);
  return vec3f(cos(ang) * r, h, sin(ang) * r);
}

@compute @workgroup_size(256)
fn init(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&particles)) { return; }
  // Big bang: everyone starts at the origin flying outward; springs pull them into the galaxy.
  let z = rnd(i * 11u + 1u) * 2.0 - 1.0;
  let a = rnd(i * 11u + 2u) * 6.2831853;
  let s = sqrt(1.0 - z * z);
  let dir = vec3f(cos(a) * s, z, sin(a) * s);
  particles[i].pos = vec4f(dir * 0.01, rnd(i * 11u + 3u));
  particles[i].vel = vec4f(dir * (1.5 + rnd(i * 11u + 4u) * 5.0), 0.0);
}

@compute @workgroup_size(256)
fn update(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u.count) { return; }
  let p = particles[i];
  let t = u.time;
  let dt = u.dt;

  let home = galaxyHome(i, t);
  var tgt = home;
  var k = 2.2;
  var flowAmt = 0.55;

  if (u.targetCount > 0u && rnd(i * 7u + 4u) < u.fraction) {
    // staggered morph so the swarm peels off the galaxy in waves
    let m = clamp(u.morph * 1.7 - rnd(i * 13u + 9u) * 0.7, 0.0, 1.0);
    let e = m * m * (3.0 - 2.0 * m);
    let ti = pcg(i ^ u.seed) % u.targetCount;
    let jit = vec3f(rnd(i * 13u + 1u), rnd(i * 13u + 2u), rnd(i * 13u + 3u)) - 0.5;
    var s = targets[ti].xyz * u.shape.y;
    let ca = cos(t * u.shape.x);
    let sa = sin(t * u.shape.x);
    s = vec3f(s.x * ca + s.z * sa, s.y, -s.x * sa + s.z * ca);
    let shapePos = s + u.offset.xyz + jit * u.offset.w;
    tgt = mix(home, shapePos, e);
    k = mix(2.2, 16.0, e);
    flowAmt = mix(0.55, 0.035, e);
  }

  let pos = p.pos.xyz;
  var vel = p.vel.xyz;
  var acc = (tgt - pos) * k - vel * (1.25 * sqrt(k));
  acc += flow(pos * 1.4, t * 0.35) * flowAmt;

  let d = pos - u.mouse.xyz;
  let dd = dot(d, d);
  acc += normalize(d + vec3f(1e-5)) * u.mouse.w * 7.0 * exp(-dd * 9.0);

  vel += acc * dt;
  particles[i].pos = vec4f(pos + vel * dt, p.pos.w);
  particles[i].vel = vec4f(vel, 0.0);
}
`;

export const renderShader = /* wgsl */ `
${common}

struct View {
  view: mat4x4f,
  proj: mat4x4f,
  params: vec4f,   // x = size, y = intensity, z = time
  colA: vec4f, colB: vec4f, colC: vec4f,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> v: View;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = particles[ii];
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let speed = length(p.vel.xyz);
  let size = v.params.x * (0.6 + p.pos.w * 0.8);
  var vp = v.view * vec4f(p.pos.xyz, 1.0);
  vp = vec4f(vp.xy + corner * size, vp.z, vp.w);

  var out: VOut;
  out.pos = v.proj * vp;
  out.uv = corner;
  let base = mix(v.colA.rgb, v.colB.rgb, p.pos.w);
  let hot = v.colC.rgb * clamp(speed * 0.35, 0.0, 1.5);
  out.color = (base + hot) * v.params.y;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = dot(in.uv, in.uv);
  if (d > 1.0) { discard; }
  let a = exp(-d * 4.0) - 0.018;
  return vec4f(in.color * a, 0.0);
}
`;

const fullscreen = /* wgsl */ `
struct FsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex
fn vs(@builtin(vertex_index) i: u32) -> FsOut {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: FsOut;
  out.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(uv.x, 1.0 - uv.y);
  return out;
}
`;

export const downsampleShader = /* wgsl */ `
${fullscreen}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(src));
  var c = vec3f(0.0);
  c += textureSample(src, samp, in.uv + texel * vec2f(-1.0, -1.0)).rgb;
  c += textureSample(src, samp, in.uv + texel * vec2f( 1.0, -1.0)).rgb;
  c += textureSample(src, samp, in.uv + texel * vec2f(-1.0,  1.0)).rgb;
  c += textureSample(src, samp, in.uv + texel * vec2f( 1.0,  1.0)).rgb;
  return vec4f(c * 0.25, 1.0);
}
`;

export const compositeShader = /* wgsl */ `
${fullscreen}
struct Post { params: vec4f, bg: vec4f };   // x = time, y = bloom, z = exposure
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> post: Post;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(bloom));
  var b = vec3f(0.0);
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let w = (3.0 - abs(f32(x))) * (3.0 - abs(f32(y)));
      b += textureSample(bloom, samp, in.uv + vec2f(f32(x), f32(y)) * texel * 1.6).rgb * w;
    }
  }
  b /= 81.0;

  let uvc = in.uv - 0.5;
  let vig = 1.0 - dot(uvc, uvc) * 0.9;
  var c = textureSample(hdr, samp, in.uv).rgb + b * post.params.y;
  c = c * post.params.z + post.bg.rgb * (0.6 + 0.4 * (1.0 - length(uvc)));
  c = aces(c) * vig;
  let n = fract(sin(dot(in.pos.xy + post.params.x * 61.0, vec2f(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.025;
  return vec4f(pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2)), 1.0);
}
`;
