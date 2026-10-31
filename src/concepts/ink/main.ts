import './ink.css';
import { renderPage } from './page';
import { InkFluid, LEVELS } from '../../fluid/fluid';

// ---------------------------------------------------------------------------
// Debug params (for screenshots):
//   ?t=<s>     fast-forward the simulation/intro by s seconds, then hold the frame (add &live=1 to keep running)
//   ?splat=1   inject a few deterministic stirs and plumes
//   ?scroll=<px> scroll before starting   ?q=<0..4> force quality level   ?static=1 reduced-motion path
// ---------------------------------------------------------------------------
const qs = new URLSearchParams(location.search);
const debugT = qs.has('t') ? Math.max(0, parseFloat(qs.get('t') ?? '0') || 0) : null;
const debugSplat = qs.get('splat') === '1';
const live = debugT === null || qs.get('live') === '1';
const debugScroll = qs.has('scroll') ? parseFloat(qs.get('scroll') ?? '0') || 0 : null;
const forcedQ = qs.has('q') ? parseInt(qs.get('q') ?? '1', 10) : null;
const reduced = qs.get('static') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;

const root = document.documentElement;
const content = document.getElementById('content') as HTMLElement;
renderPage(content);
if (debugScroll !== null) {
  // Headless screenshots don't capture scrolled viewports reliably, so shift the content instead.
  content.style.transform = `translateY(${-debugScroll}px)`;
}

const setIntro = (v: number) => root.style.setProperty('--intro', v.toFixed(3));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function fallback() {
  root.classList.remove('ink-loading', 'ink-live');
  root.classList.add('no-gl');
  setIntro(1);
}

// ---------------------------------------------------------------------------
const canvas = document.getElementById('ink') as HTMLCanvasElement;
const fluidOrNull = (() => {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    return new InkFluid(canvas, forcedQ ?? (coarse ? 2 : 1));
  } catch (e) {
    console.info('[ink] live simulation unavailable, showing static paper.', e);
    return null;
  }
})();
if (fluidOrNull) run(fluidOrNull);
else fallback();

function run(fluid: InkFluid) {
  // Canvas-space mapping (canvas is fixed, 100vw × 100lvh).
  let cw = canvas.clientWidth || innerWidth;
  let ch = canvas.clientHeight || innerHeight;
  const uvX = (clientX: number) => clientX / cw;
  const uvY = (clientY: number) => 1 - clientY / ch;

  // ---------------------------------------------------------------------------
  // Plume emitters: preallocated pool, no per-frame allocation.
  type Emitter = {
    on: boolean; x: number; y: number; dx: number; dy: number;
    t: number; dur: number; r: number; g: number; b: number; a: number; force: number; seed: number;
  };
  const pool: Emitter[] = Array.from({ length: 12 }, () => ({
    on: false, x: 0, y: 0, dx: 0, dy: 0, t: 0, dur: 1, r: 0, g: 0, b: 0, a: 0, force: 0, seed: 0,
  }));
  let seedCounter = 1;
  function plume(x: number, y: number, dx: number, dy: number, r: number, g: number, force = 260, dur = 1.5, b = 0, a = 0) {
    const e = pool.find((p) => !p.on) ?? pool[0];
    const len = Math.hypot(dx, dy) || 1;
    e.on = true; e.x = x; e.y = y; e.dx = dx / len; e.dy = dy / len;
    e.t = 0; e.dur = dur; e.r = r; e.g = g; e.b = b; e.a = a; e.force = force; e.seed = seedCounter++ * 1.7;
    wake();
  }
  function runEmitters(dt: number) {
    const k60 = dt * 60;
    for (const e of pool) {
      if (!e.on) continue;
      e.t += dt;
      const p = e.t / e.dur;
      if (p >= 1) { e.on = false; continue; }
      const fall = (1 - p) * (1 - p);
      const wob = Math.sin(e.t * 6.5 + e.seed) * 0.35 + Math.sin(e.t * 2.3 + e.seed * 3.1) * 0.2;
      const vx = (e.dx - e.dy * wob) * e.force * fall * k60 * 0.18;
      const vy = (e.dy + e.dx * wob) * e.force * fall * k60 * 0.18;
      const ink = (p < 0.7 ? 1 : (1 - p) / 0.3) * k60 * 0.11;
      fluid.splat(e.x, e.y, vx, vy, 0.0009, e.r * ink, e.g * ink, 0.00022, e.b * ink, e.a * ink);
    }
  }

  // ---------------------------------------------------------------------------
  // Intro: the name blooms out of ink, holds, then sinks away as the crisp type condenses.
  type Box = { x0: number; x1: number; y0: number; y1: number; sealX: number; sealY: number; size: number };
  let box: Box | null = null;
  let introT = 0;
  const INTRO_END = 7;
  let introDone = false;
  let sealDropped = false;
  let softPlumes = false;
  const h1 = document.getElementById('name') as HTMLElement;
  const BASELINE_NUDGE = parseFloat(qs.get('nudge') ?? '0.0');

  function buildMask(): Box | null {
    const r = h1.getBoundingClientRect();
    if (r.bottom < 0 || r.top > ch) return null;
    const { dyeW, dyeH } = fluid.simSize;
    const sx = dyeW / cw;
    const sy = dyeH / ch;
    const c = document.createElement('canvas');
    c.width = dyeW;
    c.height = dyeH;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const st = getComputedStyle(h1);
    const fs = parseFloat(st.fontSize);
    const ls = parseFloat(st.letterSpacing) || 0;
    ctx.font = `${st.fontStyle} ${st.fontWeight} ${fs}px ${st.fontFamily}`;
    const m = ctx.measureText('Pramod Burra');
    const asc = m.fontBoundingBoxAscent;
    const desc = m.fontBoundingBoxDescent;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.filter = `blur(${Math.max(0.5, fs * 0.0045 * sy).toFixed(2)}px)`;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${ls}px`;
    ctx.textBaseline = 'alphabetic';
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    let sealX = 0, sealY = 0;
    h1.querySelectorAll<HTMLElement>('.w').forEach((w) => {
      const wr = w.getBoundingClientRect();
      const base = wr.top + (wr.height - asc - desc) / 2 + asc + fs * BASELINE_NUDGE;
      const text = (w.firstChild?.textContent ?? '').trim();
      ctx.fillText(text, wr.left, base);
      x0 = Math.min(x0, wr.left); x1 = Math.max(x1, wr.right);
      y0 = Math.min(y0, base - asc * 0.8); y1 = Math.max(y1, base + desc * 0.3);
      const seal = w.querySelector<HTMLElement>('.seal');
      if (seal) {
        const sr = seal.getBoundingClientRect();
        sealX = sr.left + sr.width * 0.42;
        sealY = base - fs * 0.055;
      }
    });
    fluid.setMask(c);
    return { x0: uvX(x0), x1: uvX(x1), y0: uvY(y1), y1: uvY(y0), sealX: uvX(sealX), sealY: uvY(sealY), size: fs / ch };
  }

  function updateIntro(dt: number) {
    const P = fluid.params;
    if (introDone) return;
    introT += dt;
    const t = introT;
    if (box) {
      // brush stroke reveal, left → right
      P.emitFront = lerp(box.x0 - 0.03, box.x1 + 0.1, smooth(0.1, 1.5, t));
      P.emitAmount = t < 1.8 ? 5.0 : 0;
      P.maskPush = 16 * smooth(0.1, 0.5, t) * (1 - smooth(1.4, 2.4, t));
      P.maskNoise = 1.5 + 32 * smooth(2.4, 3.3, t) * (1 - smooth(4.2, 5.6, t));
      P.curl = lerp(8, 26, smooth(2.3, 3.6, t));
      P.velocityDissipation = lerp(1.2, 0.3, smooth(2.2, 3.2, t));
      P.dyeDissipation = lerp(0, 0.2, smooth(2.6, 4.5, t));
      P.buoyancy = 70 * smooth(2.3, 3.2, t) - 40 * smooth(4.5, 7, t);
      if (!sealDropped && t > 1.65) {
        sealDropped = true;
        const rr = box.size * box.size * 0.0016;
        fluid.splat(box.sealX, box.sealY, 0, 0, 0.001, 0, 0.9, rr);
        fluid.splat(box.sealX + box.size * 0.02, box.sealY - box.size * 0.012, 0, -8, 0.0003, 0, 0.4, rr * 0.25);
      }
      setIntro(smooth(2.0, 3.3, t));
      if (!softPlumes && t > 4.2) {
        softPlumes = true;
        plume(0.996, 0.3, -1, 0.15, 0, 0, 240, 1.7, 0.9, 0);
        plume(0.004, 0.62, 1, -0.1, 0, 0, 220, 1.6, 0, 0.9);
      }
    } else {
      setIntro(smooth(0.1, 0.9, t));
    }
    if (t >= INTRO_END) {
      introDone = true;
      fluid.setMask(null);
      P.emitAmount = 0; P.maskNoise = 0; P.maskPush = 0;
      P.curl = 26; P.velocityDissipation = 0.3; P.dyeDissipation = 0.14; P.buoyancy = 30;
      setIntro(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Input: cursor / touch stir the water and release a thread of ink; click drops ink.
  const ptr = { x: 0, y: 0, dx: 0, dy: 0, moved: false, has: false, down: 0 };
  function move(x: number, y: number) {
    if (ptr.has) { ptr.dx += x - ptr.x; ptr.dy += y - ptr.y; ptr.moved = true; }
    ptr.x = x; ptr.y = y; ptr.has = true;
    wake();
  }
  let drops = 0;
  function drop(x: number, y: number) {
    const u = uvX(x), v = uvY(y);
    drops++;
    // indigo → teal → ochre, with vermilion as the rare accent
    const c = drops % 7 === 0 ? [0, 1, 0, 0] : [[1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]][drops % 3];
    const a = 1.5;
    fluid.splat(u, v, 0, -30, 0.0012, c[0] * a, c[1] * a, 0.00045, c[2] * a, c[3] * a);
    fluid.splat(u + 0.006, v + 0.004, 0, 0, 0.0004, c[0] * 0.5, c[1] * 0.5, 0.00008, c[2] * 0.5, c[3] * 0.5);
    wake();
  }
  if (!reduced) {
    addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') move(e.clientX, e.clientY); }, { passive: true });
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') drop(e.clientX, e.clientY); }, { passive: true });
    addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (!t) return;
      ptr.has = false; move(t.clientX, t.clientY);
      ptr.down = performance.now();
    }, { passive: true });
    addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
    addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (t && performance.now() - ptr.down < 220 && Math.hypot(ptr.dx, ptr.dy) < 8) drop(t.clientX, t.clientY);
      ptr.has = false;
    }, { passive: true });
  }

  function runPointer() {
    if (!ptr.moved) return;
    ptr.moved = false;
    const dx = ptr.dx, dy = ptr.dy;
    ptr.dx = 0; ptr.dy = 0;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    const u = uvX(ptr.x), v = uvY(ptr.y);
    const vx = (dx / cw) * 5200;
    const vy = (-dy / ch) * 5200;
    const ink = Math.min(dist / 28, 1) * 0.16;
    const s = Math.sin(performance.now() * 0.00012);
    fluid.splat(u, v, vx, vy, 0.0016, ink * (1 - 0.75 * Math.abs(s)), 0, 0.00011, ink * Math.max(0, s), ink * Math.max(0, -s));
  }

  // Scrolling drags the water with the page.
  let lastScroll = scrollY;
  let scrollAcc = 0;
  addEventListener('scroll', () => {
    scrollAcc += scrollY - lastScroll;
    lastScroll = scrollY;
    wake();
  }, { passive: true });
  function runScroll() {
    const s = scrollAcc;
    scrollAcc = 0;
    const texels = (s / ch) * fluid.simSize.h;
    fluid.params.shear = Math.max(-14, Math.min(14, texels * 0.45));
    fluid.params.shearPhase += s * 0.002;
  }

  // ---------------------------------------------------------------------------
  // Each section releases its own plume when it reaches the middle of the screen.
  const fired = new WeakMap<Element, number>();
  function fireSection(sec: HTMLElement) {
    const now = performance.now();
    if (now - (fired.get(sec) ?? -1e9) < 9000) return;
    fired.set(sec, now);
    // Plumes enter mid-screen, beside the content, where the reader is looking.
    const y = 0.42 + ((sections.indexOf(sec) * 0.37) % 1) * 0.2;
    const fromLeft = sec.dataset.ink === 'left';
    const verm = sec.dataset.inkColor === 'vermilion';
    const x = fromLeft ? 0.004 : 0.996;
    const dir = fromLeft ? 1 : -1;
    plume(x, y, dir, 0.12, verm ? 0.25 : 1, verm ? 0.85 : 0, 300, 1.6);
    plume(x, y - 0.12, dir, -0.25, 0.7, 0, 180, 1.2);
  }
  const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-ink]'));
  const io = new IntersectionObserver(
    (entries) => { for (const en of entries) if (en.isIntersecting && !reduced) fireSection(en.target as HTMLElement); },
    { rootMargin: '-30% 0px -30% 0px' },
  );

  // ---------------------------------------------------------------------------
  // Deterministic stirs for ?splat=1 screenshots.
  function scriptedStirs(t: number) {
    if (!debugSplat) return;
    if (t > 0.6 && t < 2.2) {
      const s = (t - 0.6) / 1.6;
      const x = lerp(0.12, 0.9, s) * cw;
      const y = (0.82 + Math.sin(s * 9) * 0.06) * ch;
      move(x, y);
    }
  }
  function scriptedPlumes() {
    if (!debugSplat) return;
    plume(0.996, 0.78, -1, 0.1, 1, 0, 320, 1.6);
    plume(0.004, 0.32, 1, -0.2, 1, 0, 280, 1.5);
    plume(0.9, 0.004, -0.2, 1, 0, 1, 220, 1.2);
  }

  // ---------------------------------------------------------------------------
  // Frame loop with adaptive quality and idle/visibility pausing.
  let running = false;
  let raf = 0;
  let last = 0;
  let lastActivity = performance.now();
  let frameSum = 0, frameN = 0, warm = 0;

  function tick(dt: number) {
    updateIntro(dt);
    scriptedStirs(introT);
    runPointer();
    runScroll();
    runEmitters(dt);
    fluid.step(dt);
  }

  function frame(now: number) {
    if (!running) return;
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(Math.max(raw, 1 / 240), 1 / 30);
    tick(dt);
    fluid.render();

    // adapt down if we're consistently slow (skip warm-up frames)
    if (forcedQ === null && debugT === null && ++warm > 90) {
      frameSum += raw; frameN++;
      if (frameN >= 90) {
        const avg = frameSum / frameN;
        if (avg > 0.0215 && fluid.level < LEVELS.length - 1) { fluid.setLevel(fluid.level + 1); warm = 0; }
        frameSum = 0; frameN = 0;
      }
    }
    const active = pool.some((e) => e.on) || ptr.moved || scrollAcc !== 0;
    if (active) lastActivity = now;
    if (introDone && now - lastActivity > 25000) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    lastActivity = performance.now();
    if (running || reduced || !live || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!reduced && live) wake();
  });

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      cw = canvas.clientWidth || innerWidth;
      ch = canvas.clientHeight || innerHeight;
      fluid.resizeCanvas();
      if (!running) fluid.render();
    }, 150);
  });

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; fallback(); });

  // ---------------------------------------------------------------------------
  async function boot() {
    setIntro(0);
    // The ink has to know the exact shape of the type, so wait for the display face.
    await Promise.race([
      Promise.all([document.fonts.load('400 120px "Instrument Serif"'), document.fonts.ready]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    cw = canvas.clientWidth || innerWidth;
    ch = canvas.clientHeight || innerHeight;

    if (reduced) {
      // A single composed still, simulated offline: no motion after load.
      setIntro(1);
      introDone = true;
      fluid.params.buoyancy = 26;
      plume(0.996, 0.72, -1, 0.15, 1, 0, 320, 1.6);
      plume(0.004, 0.28, 1, -0.1, 1, 0, 280, 1.5);
      plume(0.004, 0.62, 1, 0.3, 0, 0.8, 160, 0.9);
      root.classList.add('ink-static');
      for (let i = 0; i < 180; i++) {
        tick(1 / 60);
        if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0));
      }
      fluid.render();
      root.classList.remove('ink-loading');
      root.classList.add('ink-live');
      return;
    }

    const atTop = scrollY < ch * 0.4;
    box = atTop ? buildMask() : null;
    if (!box) introT = INTRO_END - 1;
    scriptedPlumes();

    // initial sections already on screen
    for (const s of sections) {
      const r = s.getBoundingClientRect();
      if (r.top < ch * 0.7 && r.bottom > ch * 0.3) fireSection(s);
      io.observe(s);
    }

    if (debugT !== null) {
      const n = Math.round(debugT * 60);
      for (let i = 0; i < n; i++) tick(1 / 60);
    }
    fluid.render();
    root.classList.remove('ink-loading');
    root.classList.add('ink-live');
    if (live) wake();
  }

  void boot();
}
