// GLSL for the ink-in-water simulation. Stable fluids (Stam) on a half-float grid:
// advect → forces → vorticity confinement → divergence → Jacobi pressure → project.
// Dye channels: r = indigo, g = vermilion, b = sea-glass teal, a = warm ochre (concentrations, not colours).

export const baseVert = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform vec2 uTexel;
out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const head = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
out vec4 o;
`;

const noise = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

export const copyFrag = head + /* glsl */ `
uniform sampler2D uSource;
void main() { o = texture(uSource, vUv); }`;

export const splatFrag = head + /* glsl */ `
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec2 uPoint;
uniform vec4 uValue;
uniform float uRadius;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float g = exp(-dot(p, p) / uRadius);
  o = texture(uTarget, vUv) + uValue * g;
}`;

// Plain semi-Lagrangian advection (velocity field).
export const advectFrag = head + /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uVelTexel;
  o = texture(uSource, coord) / (1.0 + uDissipation * uDt);
}`;

// MacCormack advection with min/max limiter: keeps ink filaments crisp instead of
// smearing them into smoke.
export const advectDyeFrag = head + /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelTexel;
uniform vec2 uSrcTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 v0 = texture(uVelocity, vUv).xy;
  vec2 p = vUv - uDt * v0 * uVelTexel;
  vec4 fwd = texture(uSource, p);
  vec2 v1 = texture(uVelocity, p).xy;
  vec2 q = p + uDt * v1 * uVelTexel;
  vec4 back = texture(uSource, q);
  vec4 orig = texture(uSource, vUv);
  vec4 r = fwd + 0.5 * (orig - back);
  vec2 st = p / uSrcTexel - 0.5;
  vec2 base = (floor(st) + 0.5) * uSrcTexel;
  vec4 a = texture(uSource, base);
  vec4 b = texture(uSource, base + vec2(uSrcTexel.x, 0.0));
  vec4 c = texture(uSource, base + vec2(0.0, uSrcTexel.y));
  vec4 d = texture(uSource, base + uSrcTexel);
  r = clamp(r, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
  o = max(r, 0.0) / (1.0 + uDissipation * uDt);
}`;

// Gradual dye seeding from a text mask, revealed left→right like a brush stroke.
export const emitFrag = head + noise + /* glsl */ `
uniform sampler2D uDye;
uniform sampler2D uMask;
uniform float uAmount;
uniform float uFront;
uniform float uSoft;
uniform float uBand;
uniform float uAspect;
void main() {
  vec4 dye = texture(uDye, vUv);
  float m = texture(uMask, vUv).r;
  float n = fbm(vUv * vec2(uAspect, 1.0) * 22.0);
  float d = uFront - (vUv.x + (n - 0.5) * 0.06);
  float reveal = smoothstep(0.0, uSoft, d) * (1.0 - smoothstep(uBand, uBand + uSoft, d));
  float seep = 0.45 + 1.1 * n;
  o = dye + vec4(m * uAmount * reveal * seep, 0.0, 0.0, 0.0);
}`;

// External forces in one pass: sinking ink (negative buoyancy), curl-noise turbulence
// near the name mask, outward push from letter edges, ambient drift, scroll current.
export const forcesFrag = head + noise + /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uDye;
uniform sampler2D uMask;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uDt;
uniform float uTime;
uniform float uBuoyancy;
uniform float uMaskNoise;
uniform float uMaskPush;
uniform float uAmbient;
uniform float uShear;
uniform float uShearPhase;
vec2 curlNoise(vec2 p) {
  const float e = 0.08;
  float n1 = vnoise(p + vec2(0.0, e)), n2 = vnoise(p - vec2(0.0, e));
  float n3 = vnoise(p + vec2(e, 0.0)), n4 = vnoise(p - vec2(e, 0.0));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec4 dye = texture(uDye, vUv);
  float dens = dye.r + dye.g + dye.b + dye.a;
  vel.y -= uBuoyancy * dens * uDt;

  float m = texture(uMask, vUv).r;
  vec2 q = vUv * vec2(uAspect, 1.0);
  vec2 cn = curlNoise(q * 5.0 + vec2(0.0, uTime * 0.35)) + 0.3 * curlNoise(q * 11.0 - uTime * 0.2);
  vel += cn * (uMaskNoise * m + uAmbient) * uDt;

  float mL = texture(uMask, vL).r, mR = texture(uMask, vR).r;
  float mT = texture(uMask, vT).r, mB = texture(uMask, vB).r;
  vel -= vec2(mR - mL, mT - mB) * uMaskPush * uDt;

  vel.y += uShear * (0.6 + 0.4 * sin(vUv.x * 9.42 + uShearPhase));
  o = vec4(vel, 0.0, 1.0);
}`;

export const curlFrag = head + /* glsl */ `
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

export const vorticityFrag = head + /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlStrength;
uniform float uDt;
void main() {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy + force * uDt;
  o = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
}`;

export const divergenceFrag = head + /* glsl */ `
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

export const scaleFrag = head + /* glsl */ `
uniform sampler2D uSource;
uniform float uValue;
void main() { o = uValue * texture(uSource, vUv); }`;

export const pressureFrag = head + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

export const gradientFrag = head + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 vel = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  o = vec4(vel, 0.0, 1.0);
}`;

// Rendered once per resize: r = pulp grain, g = absorbency, b = fibres.
export const paperFrag = head + noise + /* glsl */ `
uniform float uScale;
void main() {
  vec2 px = gl_FragCoord.xy / uScale;
  float fine = vnoise(px * 0.85);
  float pulp = fbm(px / 5.0);
  float cloud = fbm(px / 140.0);
  float fib = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = float(i) * 2.1 + 0.4;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 fp = r * px;
    float f = vnoise(vec2(fp.x * 0.035, fp.y * 0.9) + float(i) * 13.0);
    fib += smoothstep(0.8, 0.97, f);
  }
  float grain = 0.45 * pulp + 0.25 * fine + 0.3 * cloud;
  float absorb = clamp(0.35 * cloud + 0.65 * pulp, 0.0, 1.0);
  o = vec4(grain, absorb, clamp(fib, 0.0, 1.0), 1.0);
}`;

// Subtractive (Beer–Lambert) ink on warm paper, with edge darkening and soft refraction.
export const displayFrag = head + /* glsl */ `
uniform sampler2D uDye;
uniform sampler2D uVelocity;
uniform sampler2D uPaper;
uniform vec2 uDyeTexel;
uniform vec2 uRes;
uniform vec3 uPaperColor;
uniform float uInkScale;
uniform float uEdge;
float dens(vec4 c) { return c.r + c.g + c.b + c.a; }
float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 t = uDyeTexel * 1.5;
  float dl = dens(texture(uDye, vUv - vec2(t.x, 0.0)));
  float dr = dens(texture(uDye, vUv + vec2(t.x, 0.0)));
  float db = dens(texture(uDye, vUv - vec2(0.0, t.y)));
  float dt = dens(texture(uDye, vUv + vec2(0.0, t.y)));
  vec2 grad = vec2(dr - dl, dt - db);
  vec2 vel = texture(uVelocity, vUv).xy;

  // refraction: ink-laden water bends what is seen through it
  vec2 uv = vUv - grad * 0.0016 + vel * 0.000012;
  vec4 ink = texture(uDye, uv);

  vec4 p = texture(uPaper, (gl_FragCoord.xy - grad * 5.0) / uRes);
  vec3 paper = uPaperColor * (0.965 + 0.055 * p.r) + 0.008 * p.b;
  float absorb = mix(0.78, 1.25, p.g);

  float e = clamp(length(grad) * uEdge, 0.0, 1.2);
  float ki = ink.r * absorb * uInkScale * (1.0 + e);
  float kv = ink.g * absorb * uInkScale * (1.0 + e);
  float kt = ink.b * absorb * uInkScale * (1.0 + e);
  float ko = ink.a * absorb * uInkScale * (1.0 + e);
  // pigment granulation: dense ink settles into the paper tooth
  ki *= 1.0 + 0.25 * (p.r - 0.5) * smoothstep(0.1, 1.0, ink.r);

  // absorption = -ln(pigment colour): indigo, vermilion, sea-glass teal, warm ochre
  vec3 col = paper * exp(-(vec3(2.17, 1.78, 0.87) * ki + vec3(0.19, 1.29, 1.75) * kv
                         + vec3(1.2, 0.54, 0.58) * kt + vec3(0.15, 0.51, 1.27) * ko));

  vec2 c = vUv - 0.5;
  col *= 1.0 - 0.07 * dot(c, c) * 2.2;
  col += (h12(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

// Software/AI renderings of the same dye + velocity fields, chosen by uStyle:
// 1 = token stream (monospace glyphs; fast flow flickers through code tokens),
// 2 = flow field (per-cell velocity strokes over a soft heatmap),
// 3 = dot matrix (halftone dots on a fixed lattice).
export const techFrag = head + /* glsl */ `
uniform sampler2D uDye;
uniform sampler2D uVelocity;
uniform sampler2D uGlyphs;
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uInkScale;
uniform float uVelNorm;
uniform float uGlyphCount;
uniform int uStyle;
const vec3 PAPER = vec3(0.957, 0.941, 0.91);
const vec3 INDIGO = vec3(0.114, 0.169, 0.42);
const vec3 VERM = vec3(0.831, 0.275, 0.173);
float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float coverage(vec4 ink) { return 1.0 - exp(-(ink.r + ink.g + ink.b + ink.a) * uInkScale * 1.6); }
vec3 inkColor(vec4 ink) { return mix(INDIGO, VERM, clamp(ink.g / (ink.r + ink.g + 1e-4), 0.0, 1.0)); }
float lines(vec2 px, float s) {
  vec2 g = abs(fract(px / s + 0.5) - 0.5) * s;
  return 1.0 - smoothstep(0.0, uDpr, min(g.x, g.y));
}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 col = mix(PAPER, INDIGO, 0.04 * lines(px, 32.0 * uDpr));

  if (uStyle == 1) {
    vec2 cs = vec2(9.0, 16.0) * uDpr;
    vec2 cell = floor(px / cs);
    vec2 uv = (cell + 0.5) * cs / uRes;
    vec4 ink = texture(uDye, uv);
    float d = coverage(ink);
    float sp = clamp(length(texture(uVelocity, uv).xy) * uVelNorm, 0.0, 1.0);
    float tick = floor(uTime * (3.0 + 12.0 * sp));
    bool code = sp > 0.12 && h12(cell * 1.31 + tick) < sp * 0.9;
    float idx = code ? floor(h12(cell + tick * 0.71) * uGlyphCount)
                     : floor(clamp(d * 1.1, 0.0, 0.999) * uGlyphCount);
    vec2 local = fract(px / cs);
    vec2 guv = vec2((idx + local.x) / uGlyphCount, ((code ? 1.0 : 0.0) + 1.0 - local.y) * 0.5);
    float g = texture(uGlyphs, guv).r;
    vec3 c = code ? mix(inkColor(ink), VERM, 0.35) : inkColor(ink);
    col = mix(col, c, d * 0.07);
    col = mix(col, c, g * smoothstep(0.03, 0.14, d) * (0.5 + 0.5 * d));
  } else if (uStyle == 2) {
    float s = 22.0 * uDpr;
    vec2 cell = floor(px / s);
    vec2 cpx = (cell + 0.5) * s;
    vec2 uv = cpx / uRes;
    vec4 ink = texture(uDye, uv);
    float d = coverage(ink);
    vec2 v = texture(uVelocity, uv).xy * uVelNorm;
    float sp = length(v);
    vec2 dir = sp > 1e-4 ? v / sp : vec2(1.0, 0.0);
    float len = s * 0.46 * clamp(sp, 0.0, 1.0);
    float w = uDpr * (0.55 + 0.9 * d);
    float stroke = 1.0 - smoothstep(w, w + uDpr, seg(px, cpx - dir * len, cpx + dir * len));
    float tip = 1.0 - smoothstep(uDpr * (1.1 + d), uDpr * (2.2 + d), length(px - cpx - dir * len));
    float node = 1.0 - smoothstep(uDpr, 2.0 * uDpr, length(px - cpx));
    vec4 soft = texture(uDye, vUv);
    col = mix(col, inkColor(soft), coverage(soft) * 0.16);
    float a = max(max(stroke * (0.16 + 0.84 * d), tip * (0.25 + 0.75 * d) * step(0.05, sp)), node * 0.16);
    col = mix(col, inkColor(ink), a);
  } else {
    float s = 8.0 * uDpr;
    vec2 cell = floor(px / s);
    vec2 cpx = (cell + 0.5) * s;
    vec4 ink = texture(uDye, cpx / uRes);
    float d = coverage(ink);
    float r = s * 0.48 * sqrt(d);
    float dist = length(px - cpx);
    col = mix(col, INDIGO, 0.06 * (1.0 - smoothstep(0.5 * uDpr, 1.1 * uDpr, dist)));
    col = mix(col, inkColor(ink), 1.0 - smoothstep(r - 0.7 * uDpr, r + 0.7 * uDpr, dist));
  }
  vec2 c2 = vUv - 0.5;
  col *= 1.0 - 0.05 * dot(c2, c2) * 2.2;
  o = vec4(col, 1.0);
}`;
