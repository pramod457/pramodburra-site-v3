// Raw WebGL2: two instanced draw calls per frame (edges as curved ribbons, nodes as SDF sprites).
import { NODE_INST, EDGE_INST } from './system';

const SEG = 20;

const NODE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 iPos;
layout(location=2) in vec4 iShape;  // w h round rot
layout(location=3) in vec3 iLook;   // fill glow inten
layout(location=4) in vec3 iCol;
uniform mat4 uVP;
uniform vec2 uOffset;
uniform vec2 uViewport;
uniform float uPxPerUnit;
uniform float uDpr;
uniform float uSizeScale;
out vec2 vLocal;
out vec2 vHalf;
out float vRound;
out float vRot;
out vec3 vLook;
out vec3 vCol;
out float vGlowR;
void main() {
  vec4 clip = uVP * vec4(iPos, 1.0);
  clip.xy += uOffset * clip.w;
  float pxu = uPxPerUnit / clip.w * uSizeScale;
  vec2 halfPx = max(iShape.xy * 0.5 * pxu, vec2(0.0));
  float glowR = (2.5 + 7.0 * iLook.y) * uDpr;
  float ext = max(halfPx.x, halfPx.y) * 1.42 + glowR * 4.0 + 2.0;
  if (iLook.z < 0.003 || max(halfPx.x, halfPx.y) < 0.15) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 local = aCorner * ext;
  clip.xy += local * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vLocal = local; vHalf = halfPx; vRound = iShape.z; vRot = iShape.w;
  vLook = iLook; vCol = iCol; vGlowR = glowR;
}`;

const NODE_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in vec2 vHalf; in float vRound; in float vRot; in vec3 vLook; in vec3 vCol; in float vGlowR;
uniform float uDpr;
uniform float uBright;
out vec4 frag;
float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float c = cos(vRot), s = sin(vRot);
  vec2 p = mat2(c, -s, s, c) * vLocal;
  float r = clamp(vRound, 0.0, 1.0) * min(vHalf.x, vHalf.y);
  float d = sdRoundBox(p, vHalf, r);
  float aa = 0.85;
  float body = 1.0 - smoothstep(-aa, aa, d);
  float rw = 1.15 * uDpr;
  float ring = 1.0 - smoothstep(rw * 0.5 - aa, rw * 0.5 + aa, abs(d + rw * 0.5));
  float tiny = 1.0 - smoothstep(2.0, 5.0, min(vHalf.x, vHalf.y)); // tiny nodes: always solid
  float fill = max(vLook.x, tiny) * body;
  float glow = exp(-max(d, 0.0) / vGlowR) * vLook.y * 0.32;
  float a = max(fill * 0.92, ring) + glow;
  frag = vec4(vCol * a * vLook.z * uBright, 1.0);
}`;

const EDGE_VS = `#version 300 es
layout(location=0) in vec2 aSeg;     // t, side
layout(location=1) in vec3 iA;
layout(location=2) in vec3 iC;
layout(location=3) in vec3 iB;
layout(location=4) in vec4 iP;       // alpha pulse phase period
layout(location=5) in vec4 iQ;       // width t0 t1 dash
layout(location=6) in vec3 iCol;
uniform mat4 uVP;
uniform vec2 uOffset;
uniform vec2 uViewport;
uniform float uDpr;
out float vT;
out float vAcross;
out float vHalfW;
out float vLenPx;
flat out vec4 vP;
flat out float vDash;
out vec3 vCol;
vec4 proj(vec3 p) { vec4 c = uVP * vec4(p, 1.0); c.xy += uOffset * c.w; return c; }
vec2 toPx(vec4 c) { return (c.xy / c.w * 0.5 + 0.5) * uViewport; }
void main() {
  if (iP.x < 0.003 && iP.y < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float t = mix(iQ.y, iQ.z, aSeg.x);
  float it = 1.0 - t;
  vec3 P = it * it * iA + 2.0 * it * t * iC + t * t * iB;
  vec3 dP = 2.0 * it * (iC - iA) + 2.0 * t * (iB - iC);
  vec4 c0 = proj(P);
  vec4 c1 = proj(P + dP * 0.01);
  vec2 s0 = toPx(c0), s1 = toPx(c1);
  vec2 dir = s1 - s0;
  dir = length(dir) > 1e-4 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float halfW = iQ.x * 0.6 * uDpr;
  float ext = halfW + 5.0 * uDpr;
  c0.xy += nrm * aSeg.y * ext * 2.0 / uViewport * c0.w;
  gl_Position = c0;
  vT = aSeg.x;
  vAcross = aSeg.y * ext;
  vHalfW = halfW;
  vLenPx = length(toPx(proj(iB)) - toPx(proj(iA))) * (iQ.z - iQ.y);
  vP = iP; vDash = iQ.w; vCol = iCol;
}`;

const EDGE_FS = `#version 300 es
precision highp float;
in float vT; in float vAcross; in float vHalfW; in float vLenPx;
flat in vec4 vP; flat in float vDash;
in vec3 vCol;
uniform float uTime;
uniform float uDpr;
uniform float uBright;
out vec4 frag;
void main() {
  float ad = abs(vAcross);
  float core = 1.0 - smoothstep(vHalfW - 0.5, vHalfW + 0.8, ad);
  float a = vP.x * core;
  if (vDash > 0.01) {
    float dpos = fract(vT * vLenPx / (7.0 * uDpr));
    a *= mix(1.0, step(dpos, 0.5), vDash);
  }
  // Fade the very ends so lines tuck in softly.
  float ends = smoothstep(0.0, 0.04, vT) * smoothstep(1.0, 0.96, vT);
  float pulse = 0.0;
  if (vP.y > 0.003 && vP.w > 0.0) {
    float g = mod(uTime * 0.62 + vP.z, vP.w);
    float d = vT - g;
    float comet = d < 0.0 ? exp(d / 0.16) : exp(-d * 70.0);
    comet *= step(g, 1.08);
    float halo = exp(-ad / (2.2 * uDpr));
    pulse = vP.y * comet * (core * 1.3 + halo * 0.55);
  }
  frag = vec4(vCol * (a + pulse) * ends * uBright, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

type U = Record<string, WebGLUniformLocation | null>;
function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): U {
  const u: U = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}

export interface Frame {
  vp: Float32Array;
  offX: number; offY: number;
  pxPerUnit: number;
  sizeScale: number;
  time: number;
  bright: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private nodeProg: WebGLProgram;
  private edgeProg: WebGLProgram;
  private nodeU: U;
  private edgeU: U;
  private nodeVao: WebGLVertexArrayObject;
  private edgeVao: WebGLVertexArrayObject;
  private nodeBuf: WebGLBuffer;
  private edgeBuf: WebGLBuffer;
  dpr = 1;
  width = 1;
  height = 1;

  static create(canvas: HTMLCanvasElement, nodes: number, edges: number): Renderer | null {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', premultipliedAlpha: true });
    if (!gl) return null;
    try { return new Renderer(gl, nodes, edges); } catch (e) { console.warn('[living] WebGL init failed', e); return null; }
  }

  private constructor(gl: WebGL2RenderingContext, private nodes: number, private edges: number) {
    this.gl = gl;
    this.nodeProg = compile(gl, NODE_VS, NODE_FS);
    this.edgeProg = compile(gl, EDGE_VS, EDGE_FS);
    const common = ['uVP', 'uOffset', 'uViewport', 'uDpr', 'uBright'];
    this.nodeU = uniforms(gl, this.nodeProg, [...common, 'uPxPerUnit', 'uSizeScale']);
    this.edgeU = uniforms(gl, this.edgeProg, [...common, 'uTime']);

    // Node VAO.
    this.nodeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.nodeVao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.nodeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, nodes * NODE_INST * 4, gl.DYNAMIC_DRAW);
    const ns = NODE_INST * 4;
    const nattr: [number, number, number][] = [[1, 3, 0], [2, 4, 3], [3, 3, 7], [4, 3, 10]];
    for (const [loc, size, off] of nattr) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, ns, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    // Edge VAO.
    this.edgeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.edgeVao);
    const seg = new Float32Array((SEG + 1) * 4);
    for (let i = 0; i <= SEG; i++) seg.set([i / SEG, -1, i / SEG, 1], i * 4);
    const segBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seg, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.edgeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, Math.max(1, edges) * EDGE_INST * 4, gl.DYNAMIC_DRAW);
    const es = EDGE_INST * 4;
    const eattr: [number, number, number][] = [[1, 3, 0], [2, 3, 3], [3, 3, 6], [4, 4, 9], [5, 4, 13], [6, 3, 17]];
    for (const [loc, size, off] of eattr) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, es, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.width = w; this.height = h;
  }

  draw(f: Frame, nodeData: Float32Array, edgeData: Float32Array) {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.055, 0.051, 0.047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.edgeProg);
    let u = this.edgeU;
    gl.uniformMatrix4fv(u.uVP, false, f.vp);
    gl.uniform2f(u.uOffset, f.offX, f.offY);
    gl.uniform2f(u.uViewport, this.width, this.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1f(u.uBright, f.bright);
    gl.uniform1f(u.uTime, f.time);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, edgeData);
    gl.bindVertexArray(this.edgeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, this.edges);

    gl.useProgram(this.nodeProg);
    u = this.nodeU;
    gl.uniformMatrix4fv(u.uVP, false, f.vp);
    gl.uniform2f(u.uOffset, f.offX, f.offY);
    gl.uniform2f(u.uViewport, this.width, this.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1f(u.uBright, f.bright);
    gl.uniform1f(u.uPxPerUnit, f.pxPerUnit);
    gl.uniform1f(u.uSizeScale, f.sizeScale);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodeData);
    gl.bindVertexArray(this.nodeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nodes);
    gl.bindVertexArray(null);
  }
}
