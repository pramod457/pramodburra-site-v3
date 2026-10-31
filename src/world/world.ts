import { simShader, renderShader, downsampleShader, compositeShader } from './shaders';
import { MAX_TARGETS, textTargets, shapeTargets, type ShapeName } from './targets';

type RGB = [number, number, number];
export const THEMES: Record<string, { a: RGB; b: RGB; c: RGB; bg: RGB; css: string }> = {
  aurora: { a: [0.1, 0.42, 1.0], b: [0.8, 0.18, 1.0], c: [0.3, 1.0, 0.8], bg: [0.004, 0.006, 0.02], css: '#7cf9ff' },
  ember: { a: [1.0, 0.32, 0.06], b: [0.9, 0.08, 0.22], c: [1.0, 0.8, 0.4], bg: [0.02, 0.006, 0.004], css: '#ffae6b' },
  ice: { a: [0.35, 0.75, 1.0], b: [0.85, 0.92, 1.0], c: [0.5, 0.6, 1.0], bg: [0.004, 0.01, 0.02], css: '#bfe6ff' },
  matrix: { a: [0.1, 1.0, 0.3], b: [0.0, 0.45, 0.12], c: [0.7, 1.0, 0.7], bg: [0.0, 0.01, 0.004], css: '#5dff8b' },
  mono: { a: [0.75, 0.75, 0.8], b: [0.45, 0.45, 0.55], c: [1, 1, 1], bg: [0.008, 0.008, 0.01], css: '#e6e6e6' },
};

export interface WorldStats {
  gpu: string;
  particles: number;
  maxParticles: number;
  fps: number;
}

/** What the terminal is allowed to do to the universe. */
export interface WorldControl {
  formText(text: string): void;
  formShape(name: ShapeName): void;
  release(): void;
  setTheme(name: string): void;
  setParticles(n: number): number;
  setFocus(topPx: number, bottomPx: number): void;
  stats(): WorldStats;
}

/** Used when WebGPU is unavailable: the terminal keeps working, the universe just doesn't. */
export class NullWorld implements WorldControl {
  formText() {}
  formShape() {}
  release() {}
  setTheme(name: string) {
    if (THEMES[name]) document.documentElement.style.setProperty('--accent', THEMES[name].css);
  }
  setParticles() { return 0; }
  setFocus() {}
  stats(): WorldStats { return { gpu: 'unavailable', particles: 0, maxParticles: 0, fps: 0 }; }
}

const FOV = (40 * Math.PI) / 180;
const CAM_DIST = 5;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class GpuWorld implements WorldControl {
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private gpuName = 'WebGPU';

  private maxCount: number;
  private count: number;
  private growLocked = false;

  private buffers!: { particles: GPUBuffer; targets: GPUBuffer; sim: GPUBuffer; view: GPUBuffer; post: GPUBuffer };
  private pipes!: { init: GPUComputePipeline; update: GPUComputePipeline; render: GPURenderPipeline; down: GPURenderPipeline; comp: GPURenderPipeline };
  private groups!: { init: GPUBindGroup; update: GPUBindGroup; render: GPUBindGroup; down?: GPUBindGroup; comp?: GPUBindGroup };
  private hdr?: GPUTexture;
  private small?: GPUTexture;
  private sampler!: GPUSampler;
  private needsInit = true;

  // simulation state
  private time = 0;
  private morph = 0;
  private morphTarget = 0;
  private targetCount = 0;
  private seed = 1;
  private fraction = 0.75;
  private spin = 0;
  private shapeScale = 1;
  private focusY = 0;
  private focusH = 3;
  private theme = THEMES.aurora;
  private mouse = { x: 0, y: 0, active: 0, pulse: 0 };

  private frames: number[] = [];
  private fps = 0;
  private lastTune = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const override = Number(new URLSearchParams(location.search).get('particles'));
    this.maxCount = coarse ? 1 << 17 : 1 << 20;
    this.count = override > 0 ? Math.min(override, this.maxCount) : coarse ? 1 << 15 : 1 << 17;
    if (override > 0) this.growLocked = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.count = 1 << 16; this.growLocked = true; }
  }

  async init(): Promise<boolean> {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    this.device = await adapter.requestDevice();
    const info = adapter.info;
    this.gpuName = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'WebGPU';
    this.device.lost.then((e) => console.warn('GPU device lost:', e.message));

    this.ctx = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    const d = this.device;
    const U = GPUBufferUsage;
    this.buffers = {
      particles: d.createBuffer({ size: this.maxCount * 32, usage: U.STORAGE }),
      targets: d.createBuffer({ size: MAX_TARGETS * 16, usage: U.STORAGE | U.COPY_DST }),
      sim: d.createBuffer({ size: 80, usage: U.UNIFORM | U.COPY_DST }),
      view: d.createBuffer({ size: 192, usage: U.UNIFORM | U.COPY_DST }),
      post: d.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST }),
    };

    const mod = (code: string) => d.createShaderModule({ code });
    const sim = mod(simShader);
    const blendAdd: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };
    const fullscreen = (code: string, format: GPUTextureFormat) => {
      const m = mod(code);
      return d.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: m, entryPoint: 'vs' },
        fragment: { module: m, entryPoint: 'fs', targets: [{ format }] },
      });
    };
    const render = mod(renderShader);
    const [init, update, renderPipe, down, comp] = await Promise.all([
      d.createComputePipelineAsync({ layout: 'auto', compute: { module: sim, entryPoint: 'init' } }),
      d.createComputePipelineAsync({ layout: 'auto', compute: { module: sim, entryPoint: 'update' } }),
      d.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: render, entryPoint: 'vs' },
        fragment: { module: render, entryPoint: 'fs', targets: [{ format: 'rgba16float', blend: blendAdd }] },
        primitive: { topology: 'triangle-strip' },
      }),
      fullscreen(downsampleShader, 'rgba16float'),
      fullscreen(compositeShader, this.format),
    ]);
    this.pipes = { init, update, render: renderPipe, down, comp };

    const b = this.buffers;
    this.groups = {
      init: d.createBindGroup({ layout: init.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: b.particles } }] }),
      update: d.createBindGroup({
        layout: update.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: b.particles } },
          { binding: 1, resource: { buffer: b.targets } },
          { binding: 2, resource: { buffer: b.sim } },
        ],
      }),
      render: d.createBindGroup({
        layout: renderPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: b.particles } },
          { binding: 1, resource: { buffer: b.view } },
        ],
      }),
    };
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      this.track(now);
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return true;
  }

  // ---------------------------------------------------------------- control

  formText(text: string) {
    const visW = this.visibleHeight() * this.aspect();
    const pts = textTargets(text, Math.min(4.2, visW * 0.84), this.focusH * 0.8);
    this.setTargets(pts, 0.78, 0, 0.035);
  }

  formShape(name: ShapeName) {
    this.setTargets(shapeTargets(name), 0.85, 0.35, 0.05);
    this.shapeScale = Math.min(1, this.focusH / 2.9, (this.visibleHeight() * this.aspect()) / 3.4);
  }

  release() { this.morphTarget = 0; }

  setTheme(name: string) {
    const t = THEMES[name];
    if (!t) return;
    this.theme = t;
    document.documentElement.style.setProperty('--accent', t.css);
  }

  setParticles(n: number) {
    this.count = Math.max(1024, Math.min(Math.round(n), this.maxCount));
    this.growLocked = true;
    return this.count;
  }

  setFocus(topPx: number, bottomPx: number) {
    const H = this.canvas.clientHeight || innerHeight;
    const visH = this.visibleHeight();
    this.focusY = (0.5 - (topPx + bottomPx) / 2 / H) * visH;
    this.focusH = Math.max(0.8, ((bottomPx - topPx) / H) * visH);
  }

  stats(): WorldStats {
    return { gpu: this.gpuName, particles: this.count, maxParticles: this.maxCount, fps: this.fps };
  }

  // ---------------------------------------------------------------- internals

  private setTargets(pts: Float32Array, fraction: number, spin: number, jitter: number) {
    this.device.queue.writeBuffer(this.buffers.targets, 0, pts);
    this.targetCount = pts.length / 4;
    this.fraction = fraction;
    this.spin = spin;
    this.shapeScale = 1;
    this.jitter = jitter;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.morphTarget = 1;
  }
  private jitter = 0.035;

  private aspect() { return (this.canvas.clientWidth || innerWidth) / (this.canvas.clientHeight || innerHeight); }
  private visibleHeight() { return 2 * CAM_DIST * Math.tan(FOV / 2); }

  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.25);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.hdr && this.hdr.width === w && this.hdr.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.hdr?.destroy();
    this.small?.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.hdr = this.device.createTexture({ size: [w, h], format: 'rgba16float', usage });
    this.small = this.device.createTexture({ size: [Math.max(1, w >> 2), Math.max(1, h >> 2)], format: 'rgba16float', usage });
    this.groups.down = this.device.createBindGroup({
      layout: this.pipes.down.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.hdr.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.groups.comp = this.device.createBindGroup({
      layout: this.pipes.comp.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.hdr.createView() },
        { binding: 1, resource: this.small.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.buffers.post } },
      ],
    });
  }

  private bindInput() {
    const toNdc = (e: PointerEvent) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = 1 - (e.clientY / innerHeight) * 2;
    };
    addEventListener('pointermove', (e) => {
      toNdc(e);
      this.mouse.active = e.target === this.canvas ? 1 : 0;
    });
    this.canvas.addEventListener('pointerdown', (e) => { toNdc(e); this.mouse.pulse = 1; });
    document.addEventListener('pointerleave', () => { this.mouse.active = 0; });
  }

  /** Grow particle count while we hold frame rate; back off (and stop growing) when we don't. */
  private track(now: number) {
    this.frames.push(now);
    while (this.frames.length && this.frames[0] < now - 1000) this.frames.shift();
    this.fps = this.frames.length;
    if (now - this.lastTune < 1500 || now < 2500) return;
    this.lastTune = now;
    if (this.fps < 50 && this.count > 1 << 15) {
      this.count >>= 1;
      this.growLocked = true;
    } else if (this.fps >= 55 && !this.growLocked && this.count < this.maxCount) {
      this.count <<= 1;
    }
  }

  private camera(): { eye: V3; view: Float32Array; proj: Float32Array } {
    const m = this.morph * this.morph * (3 - 2 * this.morph);
    const orbit = this.time * 0.04;
    const yaw = orbit * (1 - m) + this.mouse.x * 0.18;
    const pitch = 0.5 * (1 - m) + 0.06 * m - this.mouse.y * 0.08;
    const eye: V3 = [
      Math.sin(yaw) * Math.cos(pitch) * CAM_DIST,
      Math.sin(pitch) * CAM_DIST,
      Math.cos(yaw) * Math.cos(pitch) * CAM_DIST,
    ];
    const z = norm(eye);
    const x = norm(cross([0, 1, 0], z));
    const y = cross(z, x);
    const view = new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
    ]);
    const f = 1 / Math.tan(FOV / 2);
    const near = 0.05, far = 100;
    const proj = new Float32Array([
      f / this.aspect(), 0, 0, 0,
      0, f, 0, 0,
      0, 0, far / (near - far), -1,
      0, 0, (near * far) / (near - far), 0,
    ]);
    return { eye, view, proj };
  }

  /** Project the pointer onto the plane through the origin facing the camera. */
  private mouseWorld(eye: V3): V3 {
    const fwd = norm(sub([0, 0, 0], eye));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const t = Math.tan(FOV / 2);
    const dir = norm([
      fwd[0] + right[0] * this.mouse.x * t * this.aspect() + up[0] * this.mouse.y * t,
      fwd[1] + right[1] * this.mouse.x * t * this.aspect() + up[1] * this.mouse.y * t,
      fwd[2] + right[2] * this.mouse.x * t * this.aspect() + up[2] * this.mouse.y * t,
    ]);
    const s = -dot(eye, fwd) / dot(dir, fwd);
    return [eye[0] + dir[0] * s, eye[1] + dir[1] * s, eye[2] + dir[2] * s];
  }

  private frame(dt: number) {
    const d = this.device;
    this.time += dt;
    const step = dt * 0.75;
    this.morph += Math.max(-step, Math.min(step, this.morphTarget - this.morph));
    this.mouse.pulse *= Math.exp(-dt * 6);

    const cam = this.camera();
    const mw = this.mouseWorld(cam.eye);

    const simBuf = new ArrayBuffer(80);
    const f = new Float32Array(simBuf);
    const u = new Uint32Array(simBuf);
    f.set([this.time, dt, this.morph, this.fraction]);
    f.set([mw[0], mw[1], mw[2], this.mouse.active * 0.6 + this.mouse.pulse * 6], 4);
    u.set([this.count, this.targetCount, this.seed, 0], 8);
    f.set([0, this.focusY, 0, this.jitter], 12);
    f.set([this.spin, this.shapeScale, 0, 0], 16);
    d.queue.writeBuffer(this.buffers.sim, 0, simBuf);

    const ref = 1 << 18;
    const t = this.theme;
    const viewBuf = new Float32Array(48);
    viewBuf.set(cam.view, 0);
    viewBuf.set(cam.proj, 16);
    viewBuf.set([0.0085 * Math.pow(ref / this.count, 0.2), 0.11 * Math.pow(ref / this.count, 0.8), this.time, 0], 32);
    viewBuf.set([...t.a, 0, ...t.b, 0, ...t.c, 0], 36);
    d.queue.writeBuffer(this.buffers.view, 0, viewBuf);
    d.queue.writeBuffer(this.buffers.post, 0, new Float32Array([this.time, 1.1, 1.0, 0, ...t.bg, 0]));

    const enc = d.createCommandEncoder();
    const cp = enc.beginComputePass();
    if (this.needsInit) {
      cp.setPipeline(this.pipes.init);
      cp.setBindGroup(0, this.groups.init);
      cp.dispatchWorkgroups(Math.ceil(this.maxCount / 256));
      this.needsInit = false;
    }
    cp.setPipeline(this.pipes.update);
    cp.setBindGroup(0, this.groups.update);
    cp.dispatchWorkgroups(Math.ceil(this.count / 256));
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: this.hdr!.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
    });
    rp.setPipeline(this.pipes.render);
    rp.setBindGroup(0, this.groups.render);
    rp.draw(4, this.count);
    rp.end();

    const pass = (view: GPUTextureView, pipe: GPURenderPipeline, group: GPUBindGroup) => {
      const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      p.setPipeline(pipe);
      p.setBindGroup(0, group);
      p.draw(3);
      p.end();
    };
    pass(this.small!.createView(), this.pipes.down, this.groups.down!);
    pass(this.ctx.getCurrentTexture().createView(), this.pipes.comp, this.groups.comp!);
    d.queue.submit([enc.finish()]);
  }
}
