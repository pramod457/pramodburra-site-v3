// The 3D layer: a point lattice lying on the fluid (ink density lifts it into terrain) and,
// floating above it, the embedding map of the real content (built offline on the GPU, see scripts/embed.ts).
import data from './embedding.json';

export type Node = { label: string; kind: string; group: string; pos: number[] };
export const nodes = data.nodes as Node[];
const edges = data.edges as [number, number, number][];

const FOV = (40 * Math.PI) / 180;
const PLANE_D = 2; // world depth of the fluid domain; width = PLANE_D * aspect

// Lattice extends past the fluid domain (u, v in [0,1]) so the 3D view fades into a horizon, not an edge.
const U0 = -0.35, U1 = 1.35, V0 = -0.1, V1 = 2.2;

const head = `#version 300 es
precision highp float;
precision highp sampler2D;
`;

const latticeVert = head + `
const float U0 = ${U0.toFixed(2)}, U1 = ${U1.toFixed(2)}, V0 = ${V0.toFixed(2)}, V1 = ${V1.toFixed(2)};
layout(location = 0) in vec2 aUv;
uniform sampler2D uDye;
uniform sampler2D uVel;
uniform mat4 uViewProj;
uniform vec2 uPlane;      // world width, depth
uniform float uCell;      // world spacing between lattice points
uniform float uPxPerUnit; // projection scale: pixels per world unit at distance 1
uniform float uTime;
uniform float uLift;      // 0 = flat (top-down intro), 1 = full terrain
uniform float uInk;
out vec4 vColor;
out float vSize;
const vec3 INDIGO = vec3(0.114, 0.169, 0.42);
const vec3 VERM = vec3(0.831, 0.275, 0.173);
// Plasma-like map tuned for paper: blue → violet → magenta → orange → gold.
vec3 cmap(float t) {
  vec3 a = vec3(0.13, 0.30, 0.86), b = vec3(0.47, 0.20, 0.82), c = vec3(0.86, 0.19, 0.55);
  vec3 d = vec3(0.98, 0.46, 0.18), e = vec3(0.96, 0.72, 0.10);
  t = clamp(t, 0.0, 1.0) * 4.0;
  return t < 1.0 ? mix(a, b, t) : t < 2.0 ? mix(b, c, t - 1.0) : t < 3.0 ? mix(c, d, t - 2.0) : mix(d, e, t - 3.0);
}
void main() {
  bool inside = aUv.x >= 0.0 && aUv.x <= 1.0 && aUv.y >= 0.0 && aUv.y <= 1.0;
  vec4 ink = inside ? texture(uDye, aUv) : vec4(0.0);
  vec2 vel = inside ? texture(uVel, aUv).xy : vec2(0.0);
  float d = 1.0 - exp(-(ink.r + ink.g) * uInk * 1.6);
  vec3 p = vec3((aUv.x - 0.5) * uPlane.x, 0.0, (0.5 - aUv.y) * uPlane.y);
  p.xz += vec2(vel.x, -vel.y) * 0.00018 * uLift;
  // a slow swell keeps the empty lattice breathing in 3D
  float swell = sin(p.x * 1.7 + uTime * 0.5) * cos(p.z * 1.3 - uTime * 0.37) * 0.025;
  p.y = (d * 0.42 + swell) * uLift;
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_Position = clip;

  float fade = smoothstep(U0, 0.0, aUv.x) * smoothstep(U1, 1.0, aUv.x) * smoothstep(V0, 0.05, aUv.y) * smoothstep(V1, 1.0, aUv.y);
  fade = mix(1.0, fade, uLift) * (inside ? 1.0 : 0.85 * uLift);
  float r = uCell * (0.13 + 0.45 * sqrt(d)); // halftone radius in world units
  vSize = max(1.0, 2.0 * r * uPxPerUnit / clip.w);
  float tone = clamp(ink.g / (ink.r + ink.g + 1e-4), 0.0, 1.0);
  vec3 heat = mix(cmap(pow(d, 0.7) * 1.3), VERM, tone * 0.5);
  vec3 col = mix(INDIGO * 1.6 + 0.12, heat, smoothstep(0.02, 0.22, d));
  vColor = vec4(col, (0.22 + 0.78 * smoothstep(0.02, 0.4, d)) * fade);
  gl_PointSize = vSize;
}`;

const pointFrag = head + `
in vec4 vColor;
in float vSize;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  float aa = 1.5 / max(vSize, 1.0);
  float a = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  if (a <= 0.0) discard;
  o = vec4(vColor.rgb, vColor.a * a);
}`;

const nodeVert = head + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aStyle; // size px, ring (0/1), unused, emphasis
layout(location = 2) in vec3 aColor;
uniform mat4 uViewProj;
uniform float uAlpha;
uniform float uDpr;
uniform float uHover;
out vec4 vColor;
out float vRing;
out float vSize;
const vec3 INDIGO = vec3(0.114, 0.169, 0.42);
const vec3 VERM = vec3(0.831, 0.275, 0.173);
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  gl_Position = clip;
  float hov = float(gl_VertexID) == uHover ? 1.0 : 0.0;
  vSize = (aStyle.x * (1.0 + 0.6 * hov)) * uDpr * clamp(3.2 / clip.w, 0.6, 1.6);
  vRing = aStyle.y;
  vColor = vec4(aColor, uAlpha * (0.6 + 0.4 * max(aStyle.w, hov)));
  gl_PointSize = vSize;
}`;

const nodeFrag = head + `
in vec4 vColor;
in float vRing;
in float vSize;
out vec4 o;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float aa = 2.0 / max(vSize, 1.0);
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  float ring = disc * smoothstep(0.62 - aa, 0.62, r);
  float a = mix(disc, max(ring, disc * 0.18), vRing);
  if (a <= 0.0) discard;
  o = vec4(vColor.rgb, vColor.a * a);
}`;

const lineVert = head + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
uniform float uAlpha;
out vec4 vC;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vC = vec4(aColor.rgb, aColor.a * uAlpha); }`;

const lineFrag = head + `
in vec4 vC;
out vec4 o;
void main() { o = vC; }`;

type Prog = { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

// ---------------------------------------------------------------- tiny mat4 (column-major)
function mul(a: Float32Array, b: Float32Array, out: Float32Array) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
}

export type CameraState = {
  tilt: number;   // 0 = straight down (intro), 1 = full 3D
  yaw: number;    // radians, small
  pitchJitter: number;
  scroll: number; // 0..1 page progress
};

export class Space {
  private gl: WebGL2RenderingContext;
  private lattice!: { vao: WebGLVertexArrayObject; count: number; prog: Prog };
  private nodeVao!: WebGLVertexArrayObject;
  private nodeBuf!: WebGLBuffer;
  private nodeData: Float32Array;
  private lineVao!: WebGLVertexArrayObject;
  private lineBuf!: WebGLBuffer;
  private lineData: Float32Array;
  private lineCount: number;
  private nodeProg: Prog;
  private lineProg: Prog;

  private view = new Float32Array(16);
  private proj = new Float32Array(16);
  readonly viewProj = new Float32Array(16);
  private eye = [0, 0, 0];
  private aspect = 1;
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** World positions of the embedding nodes this frame (x, y, z per node). */
  readonly nodePos: Float32Array;
  hover = -1;

  constructor(gl: WebGL2RenderingContext, private rows: number) {
    this.gl = gl;
    this.nodePos = new Float32Array(nodes.length * 3);
    this.nodeData = new Float32Array(nodes.length * 10);
    this.lineCount = edges.length * 2 + this.stemNodes().length * 2;
    this.lineData = new Float32Array(this.lineCount * 7);
    this.lattice = { vao: gl.createVertexArray()!, count: 0, prog: this.program(latticeVert, pointFrag) };
    this.nodeProg = this.program(nodeVert, nodeFrag);
    this.lineProg = this.program(lineVert, lineFrag);

    this.nodeVao = gl.createVertexArray()!;
    this.nodeBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.nodeData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 28);

    this.lineVao = gl.createVertexArray()!;
    this.lineBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
  }

  /** Nodes that get a stem down to the lattice, like a 3D scatter plot. */
  private stemNodes() {
    return nodes.map((n, i) => [n, i] as const).filter(([n]) => n.kind === 'project' || n.kind === 'era');
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.aspect = w / h;
    this.buildLattice();
  }

  private buildLattice() {
    const gl = this.gl;
    const rows = this.rows;
    const cols = Math.round(rows * this.aspect);
    const pts: number[] = [];
    // Far rows first so nearer dots draw over farther ones.
    for (let j = Math.round(V1 * rows); j >= Math.round(V0 * rows); j--) {
      for (let i = Math.round(U0 * cols); i <= Math.round(U1 * cols); i++) pts.push((i + 0.5) / cols, (j + 0.5) / rows);
    }
    const buf = gl.createBuffer()!;
    gl.bindVertexArray(this.lattice.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.lattice.count = pts.length / 2;
  }

  get latticeCount() { return this.lattice.count; }

  /** Camera: straight down at tilt 0 (plane exactly fills the screen), a low 3D angle at tilt 1. */
  setCamera(c: CameraState) {
    const top = PLANE_D / 2 / Math.tan(FOV / 2);
    const t = c.tilt * c.tilt * (3 - 2 * c.tilt);
    const pitch = Math.PI / 2 + (0.5 + 0.12 * c.scroll - Math.PI / 2) * t + c.pitchJitter * t;
    const dist = top + (2.7 - top) * t - 0.25 * c.scroll * t;
    const yaw = (c.yaw + 0.5 * c.scroll) * t;
    const target = [0, 0.12 * t, -0.25 * t];
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const e = [target[0] + dist * sy * cp, target[1] + dist * sp, target[2] + dist * cy * cp];
    this.eye = e;
    const f = [-sy * cp, -sp, -cy * cp];         // forward
    const r = [cy, 0, -sy];                      // right (always horizontal, valid looking straight down)
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const v = this.view;
    v.set([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1]);
    v[12] = -(r[0] * e[0] + r[1] * e[1] + r[2] * e[2]);
    v[13] = -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]);
    v[14] = f[0] * e[0] + f[1] * e[1] + f[2] * e[2];
    const fy = 1 / Math.tan(FOV / 2), near = 0.05, far = 40;
    this.proj.set([fy / this.aspect, 0, 0, 0, 0, fy, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
    mul(this.proj, this.view, this.viewProj);
  }

  /** Screen point → fluid uv on the plane (y = 0). Null when the ray misses. */
  pick(x: number, y: number): [number, number] | null {
    const nx = (x / (this.w / this.dpr)) * 2 - 1;
    const ny = 1 - (y / (this.h / this.dpr)) * 2;
    const v = this.view, t = Math.tan(FOV / 2);
    // camera basis vectors are the rows of the view rotation
    const r = [v[0], v[4], v[8]], u = [v[1], v[5], v[9]], f = [-v[2], -v[6], -v[10]];
    const d = [0, 1, 2].map((k) => f[k] + r[k] * nx * t * this.aspect + u[k] * ny * t);
    if (d[1] >= -1e-4) return null;
    const s = -this.eye[1] / d[1];
    const px = this.eye[0] + d[0] * s, pz = this.eye[2] + d[2] * s;
    return [px / (PLANE_D * this.aspect) + 0.5, 0.5 - pz / PLANE_D];
  }

  /** Project a world point to CSS pixels; returns [x, y, depth] or null when behind the camera. */
  project(x: number, y: number, z: number): [number, number, number] | null {
    const m = this.viewProj;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.01) return null;
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
    const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    return [(cx * 0.5 + 0.5) * (this.w / this.dpr), (0.5 - cy * 0.5) * (this.h / this.dpr), cw];
  }

  /** Lay out the embedding cloud above the lattice; called once per frame before render. */
  updateNodes(time: number) {
    // Compact, high and far back: the cloud lives in the band above the headline, never across the text.
    // At the resting camera, y ∈ [0.45, 0.75] at z ≈ -1 projects to roughly the top 10–22% of the screen.
    const sx = Math.min(0.85 * this.aspect, 1.35);
    nodes.forEach((n, i) => {
      const [x, y, z] = n.pos;
      const bob = Math.sin(time * 0.6 + i * 1.7) * 0.012;
      this.nodePos[i * 3] = x * sx;
      this.nodePos[i * 3 + 1] = 0.6 + y * 0.15 + bob;
      this.nodePos[i * 3 + 2] = -1.0 + z * 0.3;
    });
  }

  render(dye: WebGLTexture, vel: WebGLTexture, time: number, lift: number, cloud: number, ink: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0.957, 0.941, 0.91, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // lattice
    const L = this.lattice.prog;
    gl.useProgram(L.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dye); gl.uniform1i(L.u.uDye, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, vel); gl.uniform1i(L.u.uVel, 1);
    gl.uniformMatrix4fv(L.u.uViewProj, false, this.viewProj);
    gl.uniform2f(L.u.uPlane, PLANE_D * this.aspect, PLANE_D);
    gl.uniform1f(L.u.uCell, PLANE_D / this.rows);
    gl.uniform1f(L.u.uPxPerUnit, (this.h / 2) / Math.tan(FOV / 2));
    gl.uniform1f(L.u.uTime, time);
    gl.uniform1f(L.u.uLift, lift);
    gl.uniform1f(L.u.uInk, ink);
    gl.bindVertexArray(this.lattice.vao);
    gl.drawArrays(gl.POINTS, 0, this.lattice.count);

    if (cloud > 0.01) {
      // edges + stems
      let k = 0;
      const put = (i: number, a: number, yOverride?: number) => {
        this.lineData[k++] = this.nodePos[i * 3];
        this.lineData[k++] = yOverride ?? this.nodePos[i * 3 + 1];
        this.lineData[k++] = this.nodePos[i * 3 + 2];
        const c = NODE_COLOR[i];
        this.lineData[k++] = c[0]; this.lineData[k++] = c[1]; this.lineData[k++] = c[2];
        this.lineData[k++] = a;
      };
      for (const [a, b, s] of edges) {
        const w = 0.04 + 0.2 * Math.max(0, (s - 0.45) / 0.4);
        const hot = a === this.hover || b === this.hover ? 0.5 : 0;
        put(a, w + hot); put(b, w + hot);
      }
      for (const [, i] of this.stemNodes()) { put(i, 0.12); put(i, 0.0, 0); }
      gl.useProgram(this.lineProg.prog);
      gl.uniformMatrix4fv(this.lineProg.u.uViewProj, false, this.viewProj);
      gl.uniform1f(this.lineProg.u.uAlpha, cloud);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineData);
      gl.drawArrays(gl.LINES, 0, this.lineCount);

      // nodes
      nodes.forEach((n, i) => {
        const o = i * 10;
        this.nodeData[o] = this.nodePos[i * 3];
        this.nodeData[o + 1] = this.nodePos[i * 3 + 1];
        this.nodeData[o + 2] = this.nodePos[i * 3 + 2];
        const style = NODE_STYLE[n.kind] ?? NODE_STYLE.skill;
        this.nodeData.set(style, o + 3);
        this.nodeData.set(NODE_COLOR[i], o + 7);
      });
      gl.useProgram(this.nodeProg.prog);
      gl.uniformMatrix4fv(this.nodeProg.u.uViewProj, false, this.viewProj);
      gl.uniform1f(this.nodeProg.u.uAlpha, cloud);
      gl.uniform1f(this.nodeProg.u.uDpr, this.dpr);
      gl.uniform1f(this.nodeProg.u.uHover, this.hover);
      gl.bindVertexArray(this.nodeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.nodeData);
      gl.drawArrays(gl.POINTS, 0, nodes.length);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  private program(vs: string, fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('space shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('space link: ' + gl.getProgramInfoLog(prog));
    const u: Prog['u'] = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, u };
  }
}

// size px, ring, tone, emphasis
const NODE_STYLE: Record<string, number[]> = {
  era: [15, 1, 1, 1],
  project: [10, 0, 0, 1],
  role: [8, 1, 0, 0.6],
  highlight: [4.5, 0, 0, 0.2],
  skill: [6, 1, 0, 0.3],
  domain: [6, 1, 0, 0.3],
};

// Colour carries meaning: one hue per area of the work.
const HUE = {
  ai: [0.49, 0.26, 0.86],
  conversation: [0.0, 0.6, 0.62],
  integration: [0.93, 0.55, 0.08],
  engineering: [0.16, 0.42, 0.92],
  platform: [0.16, 0.64, 0.36],
  domain: [0.88, 0.3, 0.5],
};
const GROUP_HUE: Record<string, number[]> = {
  'AI / LLM': HUE.ai, 'Conversational AI': HUE.conversation, Integration: HUE.integration,
  Engineering: HUE.engineering, Platform: HUE.platform, domains: HUE.domain,
  'agent-platform': HUE.ai, 'agent-harness': HUE.ai, 'llm-infra': HUE.ai, 'foundry-telemetry': HUE.ai,
  dialoglens: HUE.conversation, 'conversational-ai': HUE.conversation,
  'ai-ipaas': HUE.integration, 'decision-automation': HUE.engineering, homelab: HUE.platform,
  'Enterprise conversational AI': HUE.conversation, PepsiCo: HUE.integration, 'BPX Energy': HUE.engineering,
};
const ERA_HUE: Record<string, number[]> = { Rules: HUE.engineering, Workflows: HUE.platform, AI: HUE.ai, Platforms: HUE.integration };
const NODE_COLOR = nodes.map((n) => (n.kind === 'era' ? ERA_HUE[n.label] : undefined) ?? GROUP_HUE[n.group] ?? HUE.engineering);
