import * as S from './shaders';

const GLYPHS = ['.,:;-=+*x%#@', '01{}<>/=;$λ#'];

type Program = { prog: WebGLProgram; u: Record<string, WebGLUniformLocation> };
type FBO = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number; tx: number; ty: number };
type DoubleFBO = { read: FBO; write: FBO; swap(): void };
type Fmt = { internal: number; format: number; type: number };

export type Quality = { sim: number; dye: number; iters: number };

/** Ordered high → low. The runtime only ever steps down. */
export const LEVELS: Quality[] = [
  { sim: 176, dye: 960, iters: 20 },
  { sim: 144, dye: 768, iters: 18 },
  { sim: 120, dye: 600, iters: 14 },
  { sim: 96, dye: 460, iters: 10 },
  { sim: 72, dye: 360, iters: 8 },
];

export type FluidParams = {
  curl: number;
  velocityDissipation: number;
  dyeDissipation: number;
  buoyancy: number;
  maskNoise: number;
  maskPush: number;
  ambient: number;
  shear: number;
  shearPhase: number;
  emitAmount: number;
  emitFront: number;
  emitSoft: number;
  emitBand: number;
  inkScale: number;
  edge: number;
};

/** Thrown when the device can't run the simulation; the page falls back to static paper + ink. */
export class FluidUnsupported extends Error {}

export class InkFluid {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  params: FluidParams = {
    curl: 22,
    velocityDissipation: 0.25,
    dyeDissipation: 0.12,
    buoyancy: 0,
    maskNoise: 0,
    maskPush: 0,
    ambient: 0,
    shear: 0,
    shearPhase: 0,
    emitAmount: 0,
    emitFront: 0,
    emitSoft: 0.06,
    emitBand: 0.1,
    inkScale: 1.0,
    edge: 2.2,
  };
  level: number;
  time = 0;
  /** 0 = ink, 1 = token stream, 2 = flow field, 3 = dot matrix */
  style = 0;

  private vao: WebGLVertexArrayObject;
  private fmtRGBA: Fmt;
  private fmtRG: Fmt;
  private fmtR: Fmt;
  private p: Record<string, Program> = {};
  private velocity!: DoubleFBO;
  private dye!: DoubleFBO;
  private pressure!: DoubleFBO;
  private divergence!: FBO;
  private curlFbo!: FBO;
  private paper: FBO | null = null;
  private mask: WebGLTexture;
  private glyphs: WebGLTexture | null = null;
  private hasMask = false;
  private dpr: number;

  constructor(canvas: HTMLCanvasElement, level: number, dprCap = 1.5) {
    this.canvas = canvas;
    this.level = Math.min(Math.max(level, 0), LEVELS.length - 1);
    this.dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    });
    if (!gl) throw new FluidUnsupported('webgl2');
    this.gl = gl;

    const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    const hasHalf = hasFloat || !!gl.getExtension('EXT_color_buffer_half_float');
    if (!hasHalf) throw new FluidUnsupported('float render targets');

    this.fmtRGBA = this.pickFormat([{ internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }]);
    this.fmtRG = this.pickFormat([{ internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT }, this.fmtRGBA]);
    this.fmtR = this.pickFormat([{ internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }, this.fmtRGBA]);

    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new FluidUnsupported('buffers');
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const vs = this.shader(gl.VERTEX_SHADER, S.baseVert);
    const frags: Record<string, string> = {
      copy: S.copyFrag,
      splat: S.splatFrag,
      advect: S.advectFrag,
      advectDye: S.advectDyeFrag,
      emit: S.emitFrag,
      forces: S.forcesFrag,
      curl: S.curlFrag,
      vorticity: S.vorticityFrag,
      divergence: S.divergenceFrag,
      scale: S.scaleFrag,
      pressure: S.pressureFrag,
      gradient: S.gradientFrag,
      paper: S.paperFrag,
      display: S.displayFrag,
      tech: S.techFrag,
    };
    for (const k of Object.keys(frags)) this.p[k] = this.program(vs, this.shader(gl.FRAGMENT_SHADER, frags[k]));

    const mask = gl.createTexture();
    if (!mask) throw new FluidUnsupported('texture');
    this.mask = mask;
    gl.bindTexture(gl.TEXTURE_2D, mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    this.texParams(gl.LINEAR);

    gl.disable(gl.BLEND);
    this.resizeCanvas();
    this.allocate(false);
  }

  // ---------- setup helpers ----------

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type);
    if (!s) throw new FluidUnsupported('shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log, src);
      throw new FluidUnsupported('shader compile: ' + log);
    }
    return s;
  }

  private program(vs: WebGLShader, fs: WebGLShader): Program {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new FluidUnsupported('program');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new FluidUnsupported('link: ' + gl.getProgramInfoLog(prog));
    const u: Record<string, WebGLUniformLocation> = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const loc = gl.getUniformLocation(prog, info.name);
      if (loc) u[info.name] = loc;
    }
    return { prog, u };
  }

  private texParams(filter: number) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private pickFormat(candidates: Fmt[]): Fmt {
    const gl = this.gl;
    for (const f of candidates) {
      const tex = gl.createTexture();
      const fb = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, 4, 4, 0, f.format, f.type, null);
      this.texParams(gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fb);
      if (ok) return f;
    }
    throw new FluidUnsupported('no renderable half-float format');
  }

  private fbo(w: number, h: number, fmt: Fmt, filter: number): FBO {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new FluidUnsupported('fbo');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null);
    this.texParams(filter);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); // alpha is a pigment channel (ochre), so it must start empty
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h, tx: 1 / w, ty: 1 / h };
  }

  private double(w: number, h: number, fmt: Fmt, filter: number): DoubleFBO {
    return {
      read: this.fbo(w, h, fmt, filter),
      write: this.fbo(w, h, fmt, filter),
      swap() {
        const t = this.read;
        this.read = this.write;
        this.write = t;
      },
    };
  }

  private free(f: FBO) {
    this.gl.deleteTexture(f.tex);
    this.gl.deleteFramebuffer(f.fb);
  }

  private dims(short: number): [number, number] {
    const a = this.canvas.width / Math.max(1, this.canvas.height);
    return a >= 1 ? [Math.round(short * a), short] : [short, Math.round(short / a)];
  }

  /** (Re)allocate simulation targets for the current level & aspect; optionally resample old state. */
  private allocate(keep: boolean) {
    const gl = this.gl;
    const q = LEVELS[this.level];
    const [sw, sh] = this.dims(q.sim);
    const [dw, dh] = this.dims(Math.min(q.dye, Math.max(this.canvas.width, this.canvas.height)));
    const oldVel = keep ? this.velocity : null;
    const oldDye = keep ? this.dye : null;
    if (this.pressure) {
      this.free(this.pressure.read);
      this.free(this.pressure.write);
      this.free(this.divergence);
      this.free(this.curlFbo);
    }
    this.velocity = this.double(sw, sh, this.fmtRG, gl.LINEAR);
    this.dye = this.double(dw, dh, this.fmtRGBA, gl.LINEAR);
    this.pressure = this.double(sw, sh, this.fmtR, gl.NEAREST);
    this.divergence = this.fbo(sw, sh, this.fmtR, gl.NEAREST);
    this.curlFbo = this.fbo(sw, sh, this.fmtR, gl.NEAREST);
    if (oldVel && oldDye) {
      this.resample(oldVel.read, this.velocity.read);
      this.resample(oldDye.read, this.dye.read);
      for (const f of [oldVel.read, oldVel.write, oldDye.read, oldDye.write]) this.free(f);
    }
  }

  private resample(src: FBO, dst: FBO) {
    const pr = this.use('copy', dst);
    this.tex(0, src.tex, pr.u.uSource);
    this.draw(dst);
  }

  // ---------- public API ----------

  get simSize() {
    return { w: this.velocity.read.w, h: this.velocity.read.h, dyeW: this.dye.read.w, dyeH: this.dye.read.h };
  }

  /** Current dye (r = indigo, g = vermilion) and velocity textures, for external renderers. */
  get fields() {
    return { dye: this.dye.read.tex, velocity: this.velocity.read.tex };
  }

  get aspect() {
    return this.canvas.width / Math.max(1, this.canvas.height);
  }

  /** Match the drawing buffer to CSS size. Returns true if sim targets were reallocated. */
  resizeCanvas(): boolean {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (w === this.canvas.width && h === this.canvas.height && this.paper) return false;
    const oldAspect = this.canvas.width / Math.max(1, this.canvas.height);
    const oldW = this.canvas.width;
    this.canvas.width = w;
    this.canvas.height = h;
    this.renderPaper();
    if (!this.velocity) return false;
    // Mobile URL-bar show/hide changes height a little: don't rebuild the sim for that.
    const newAspect = w / h;
    if (w !== oldW || Math.abs(newAspect - oldAspect) / oldAspect > 0.12) {
      this.allocate(true);
      return true;
    }
    return false;
  }

  setLevel(level: number) {
    const l = Math.min(Math.max(level, 0), LEVELS.length - 1);
    if (l === this.level) return;
    this.level = l;
    this.allocate(true);
  }

  /** Upload a text mask (canvas sized to the dye grid, top-left origin). */
  setMask(src: HTMLCanvasElement | null) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    if (!src) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
      this.hasMask = false;
      return;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.hasMask = true;
  }

  /** x,y in [0,1] with y up; velocity in sim texels/s; pigment amounts r indigo, g vermilion, teal, ochre. Radius in uv² units. */
  splat(x: number, y: number, vx: number, vy: number, velRadius: number, r: number, g: number, dyeRadius: number, teal = 0, ochre = 0) {
    const a = this.aspect;
    const corr = a > 1 ? a : 1;
    if (vx !== 0 || vy !== 0) {
      const pr = this.use('splat', this.velocity.write);
      this.tex(0, this.velocity.read.tex, pr.u.uTarget);
      this.gl.uniform1f(pr.u.uAspect, a);
      this.gl.uniform2f(pr.u.uPoint, x, y);
      this.gl.uniform4f(pr.u.uValue, vx, vy, 0, 0);
      this.gl.uniform1f(pr.u.uRadius, velRadius * corr);
      this.draw(this.velocity.write);
      this.velocity.swap();
    }
    if (r !== 0 || g !== 0 || teal !== 0 || ochre !== 0) {
      const pr = this.use('splat', this.dye.write);
      this.tex(0, this.dye.read.tex, pr.u.uTarget);
      this.gl.uniform1f(pr.u.uAspect, a);
      this.gl.uniform2f(pr.u.uPoint, x, y);
      this.gl.uniform4f(pr.u.uValue, r, g, teal, ochre);
      this.gl.uniform1f(pr.u.uRadius, dyeRadius * corr);
      this.draw(this.dye.write);
      this.dye.swap();
    }
  }

  step(dt: number) {
    const gl = this.gl;
    const P = this.params;
    const q = LEVELS[this.level];
    this.time += dt;
    const vel = this.velocity;
    const simT = vel.read;
    gl.bindVertexArray(this.vao);

    // forces (buoyancy, mask turbulence, scroll current)
    let pr = this.use('forces', vel.write);
    this.tex(0, vel.read.tex, pr.u.uVelocity);
    this.tex(1, this.dye.read.tex, pr.u.uDye);
    this.tex(2, this.mask, pr.u.uMask);
    gl.uniform1f(pr.u.uAspect, this.aspect);
    gl.uniform1f(pr.u.uDt, dt);
    gl.uniform1f(pr.u.uTime, this.time);
    gl.uniform1f(pr.u.uBuoyancy, P.buoyancy);
    gl.uniform1f(pr.u.uMaskNoise, this.hasMask ? P.maskNoise : 0);
    gl.uniform1f(pr.u.uMaskPush, this.hasMask ? P.maskPush : 0);
    gl.uniform1f(pr.u.uAmbient, P.ambient);
    gl.uniform1f(pr.u.uShear, P.shear);
    gl.uniform1f(pr.u.uShearPhase, P.shearPhase);
    this.draw(vel.write);
    vel.swap();

    // vorticity confinement → curly tendrils
    pr = this.use('curl', this.curlFbo);
    this.tex(0, vel.read.tex, pr.u.uVelocity);
    this.draw(this.curlFbo);

    pr = this.use('vorticity', vel.write);
    this.tex(0, vel.read.tex, pr.u.uVelocity);
    this.tex(1, this.curlFbo.tex, pr.u.uCurl);
    gl.uniform1f(pr.u.uCurlStrength, P.curl);
    gl.uniform1f(pr.u.uDt, dt);
    this.draw(vel.write);
    vel.swap();

    // projection
    pr = this.use('divergence', this.divergence);
    this.tex(0, vel.read.tex, pr.u.uVelocity);
    this.draw(this.divergence);

    pr = this.use('scale', this.pressure.write);
    this.tex(0, this.pressure.read.tex, pr.u.uSource);
    gl.uniform1f(pr.u.uValue, 0.8);
    this.draw(this.pressure.write);
    this.pressure.swap();

    pr = this.use('pressure', this.pressure.write);
    this.tex(1, this.divergence.tex, pr.u.uDivergence);
    for (let i = 0; i < q.iters; i++) {
      this.tex(0, this.pressure.read.tex, pr.u.uPressure);
      this.draw(this.pressure.write);
      this.pressure.swap();
    }

    pr = this.use('gradient', vel.write);
    this.tex(0, this.pressure.read.tex, pr.u.uPressure);
    this.tex(1, vel.read.tex, pr.u.uVelocity);
    this.draw(vel.write);
    vel.swap();

    // advect velocity
    pr = this.use('advect', vel.write);
    this.tex(0, vel.read.tex, pr.u.uVelocity);
    this.tex(1, vel.read.tex, pr.u.uSource);
    gl.uniform2f(pr.u.uVelTexel, simT.tx, simT.ty);
    gl.uniform1f(pr.u.uDt, dt);
    gl.uniform1f(pr.u.uDissipation, P.velocityDissipation);
    this.draw(vel.write);
    vel.swap();

    // seed dye from the name mask (intro only)
    if (this.hasMask && P.emitAmount > 0) {
      pr = this.use('emit', this.dye.write);
      this.tex(0, this.dye.read.tex, pr.u.uDye);
      this.tex(1, this.mask, pr.u.uMask);
      gl.uniform1f(pr.u.uAmount, P.emitAmount * dt);
      gl.uniform1f(pr.u.uFront, P.emitFront);
      gl.uniform1f(pr.u.uSoft, P.emitSoft);
      gl.uniform1f(pr.u.uBand, P.emitBand);
      gl.uniform1f(pr.u.uAspect, this.aspect);
      this.draw(this.dye.write);
      this.dye.swap();
    }

    // advect dye (MacCormack)
    pr = this.use('advectDye', this.dye.write);
    this.tex(0, vel.read.tex, pr.u.uVelocity);
    this.tex(1, this.dye.read.tex, pr.u.uSource);
    gl.uniform2f(pr.u.uVelTexel, simT.tx, simT.ty);
    gl.uniform2f(pr.u.uSrcTexel, this.dye.read.tx, this.dye.read.ty);
    gl.uniform1f(pr.u.uDt, dt);
    gl.uniform1f(pr.u.uDissipation, P.dyeDissipation);
    this.draw(this.dye.write);
    this.dye.swap();
  }

  render() {
    const gl = this.gl;
    if (!this.paper) return;
    gl.bindVertexArray(this.vao);
    if (this.style > 0) {
      const pr = this.use('tech', null);
      this.tex(0, this.dye.read.tex, pr.u.uDye);
      this.tex(1, this.velocity.read.tex, pr.u.uVelocity);
      this.tex(2, this.glyphAtlas(), pr.u.uGlyphs);
      gl.uniform2f(pr.u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(pr.u.uDpr, this.dpr);
      gl.uniform1f(pr.u.uTime, this.time);
      gl.uniform1f(pr.u.uInkScale, this.params.inkScale);
      gl.uniform1f(pr.u.uVelNorm, 1 / 400);
      gl.uniform1f(pr.u.uGlyphCount, GLYPHS[0].length);
      gl.uniform1i(pr.u.uStyle, this.style);
      this.draw(null);
      return;
    }
    const pr = this.use('display', null);
    this.tex(0, this.dye.read.tex, pr.u.uDye);
    this.tex(1, this.velocity.read.tex, pr.u.uVelocity);
    this.tex(2, this.paper.tex, pr.u.uPaper);
    gl.uniform2f(pr.u.uDyeTexel, this.dye.read.tx, this.dye.read.ty);
    gl.uniform2f(pr.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform3f(pr.u.uPaperColor, 0.957, 0.941, 0.91);
    gl.uniform1f(pr.u.uInkScale, this.params.inkScale);
    gl.uniform1f(pr.u.uEdge, this.params.edge);
    this.draw(null);
  }

  /** Two rows of monospace glyphs: a light→dense ramp, and code tokens for fast-moving flow. */
  private glyphAtlas(): WebGLTexture {
    if (this.glyphs) return this.glyphs;
    const gl = this.gl;
    const cw = 36, chh = 64;
    const c = document.createElement('canvas');
    c.width = cw * GLYPHS[0].length;
    c.height = chh * 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = `500 ${chh * 0.62}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    GLYPHS.forEach((row, r) => [...row].forEach((g, i) => ctx.fillText(g, (i + 0.5) * cw, (r + 0.5) * chh)));
    this.glyphs = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.glyphs);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
    this.texParams(gl.LINEAR);
    return this.glyphs;
  }

  private renderPaper() {
    const gl = this.gl;
    if (this.paper) this.free(this.paper);
    this.paper = this.fbo(this.canvas.width, this.canvas.height, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }, gl.LINEAR);
    gl.bindVertexArray(this.vao);
    const pr = this.use('paper', this.paper);
    gl.uniform1f(pr.u.uScale, this.dpr);
    this.draw(this.paper);
  }

  // ---------- draw plumbing ----------

  private use(name: string, target: FBO | null): Program {
    const pr = this.p[name];
    const gl = this.gl;
    gl.useProgram(pr.prog);
    const t = target ?? this.velocity?.read;
    if (pr.u.uTexel && t) gl.uniform2f(pr.u.uTexel, t.tx, t.ty);
    return pr;
  }

  private tex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | undefined) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
  }

  private draw(target: FBO | null) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
