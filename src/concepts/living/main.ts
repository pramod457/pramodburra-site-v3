import './style.css';
import { build, S } from './layouts';
import { LivingSystem } from './system';
import { Renderer, type Frame } from './renderer';
import { pageHtml } from './page';

const root = document.getElementById('lv-root')!;
root.innerHTML = pageHtml();

// ----- debug: ?p=0..1 forces scroll progress, ?s=0..5 forces a state.
// Headless Chrome screenshots mis-composite a scrolled window, so in debug mode the page scrolls
// inside #lv-root instead of the window.
const params = new URLSearchParams(location.search);
const forceP = params.has('p') ? Number(params.get('p')) : NaN;
const forceS = params.has('s') ? Number(params.get('s')) : NaN;
const debug = forceP === forceP || forceS === forceS;
if (debug) document.documentElement.classList.add('lv-debug');
const getScroll = debug ? () => root.scrollTop : () => window.scrollY;
const setScroll = (y: number) => (debug ? (root.scrollTop = y) : scrollTo({ top: y, behavior: 'instant' }));

const html = document.documentElement;
const canvas = document.getElementById('lv-canvas') as HTMLCanvasElement;
const labelLayer = document.getElementById('lv-labels')!;
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reduceMQ.matches;
reduceMQ.addEventListener('change', () => (reduced = reduceMQ.matches));

// ----- grain (static, generated once)
{
  const g = document.createElement('canvas');
  g.width = g.height = 128;
  const c = g.getContext('2d');
  if (c) {
    const img = c.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    html.style.setProperty('--lv-grain', `url(${g.toDataURL()})`);
  }
}

// ----- system + renderer
const built = build();
const system = new LivingSystem(built);
const renderer = Renderer.create(canvas, 64, system.edgeCount);
if (!renderer) html.classList.add('lv-nogl');
else html.classList.add('lv-gl');

// ----- labels
const labelEls = built.labels.map((l) => {
  const el = document.createElement('span');
  el.className = `lv-label lv-label-${l.pos}${l.strong ? ' is-strong' : ''}`;
  el.textContent = l.text;
  labelLayer.appendChild(el);
  return { el, l, shown: -1 };
});

// ----- layout measurement (only on resize / load, never in the frame loop)
const stages = Array.from(document.querySelectorAll<HTMLElement>('[data-state]'));
const copies = stages.map((s) => s.querySelector<HTMLElement>('.lv-copy'));
const railLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-rail]'));
const anchors = new Float64Array(S);
let vw = innerWidth, vh = innerHeight, ch = innerHeight, mobile = false, maxScroll = 1;
// ch = canvas height (100lvh, may exceed innerHeight on mobile); projection and labels use it.

function measure() {
  vw = document.documentElement.clientWidth;
  vh = innerHeight;
  mobile = vw / vh < 0.95 || vw < 760;
  const sy = getScroll();
  for (const st of stages) {
    const s = Number(st.dataset.state);
    const r = st.getBoundingClientRect();
    const top = r.top + sy;
    if (s === 0) anchors[s] = 0;
    else if (s === S - 1) anchors[s] = top - vh * 0.55;
    else anchors[s] = mobile ? top + vh * 0.05 : top + Math.max(0, (r.height - vh) / 2);
  }
  for (let i = 1; i < S; i++) anchors[i] = Math.max(anchors[i], anchors[i - 1] + 1);
  maxScroll = Math.max(1, (debug ? root.scrollHeight : document.documentElement.scrollHeight) - vh);
  if (renderer) {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    ch = canvas.clientHeight || vh;
    renderer.resize(vw, ch, dpr);
    dirty = true;
  }
}
let dprCap = 1.5;

/** Linear "where am I in the story" from scroll position. */
function rawState(y: number) {
  if (y <= anchors[0]) return 0;
  for (let i = 0; i < S - 1; i++) {
    if (y < anchors[i + 1]) return i + (y - anchors[i]) / (anchors[i + 1] - anchors[i]);
  }
  return S - 1;
}
/** Hold each shape while its chapter is being read; morph in between. */
function heldState(raw: number) {
  const k = Math.min(Math.floor(raw), S - 2);
  const u = raw - k;
  const t = Math.min(1, Math.max(0, (u - 0.14) / 0.72));
  return k + t * t * (3 - 2 * t);
}

// ----- camera
const vp = new Float32Array(16);
const FOV = (28 * Math.PI) / 180;
const F = 1 / Math.tan(FOV / 2);
function camera(sState: number, tiltX: number, tiltY: number, out: Frame) {
  const aspect = vw / ch;
  const settle = Math.min(1, Math.max(0, sState - (S - 2)));
  const e = settle * settle * (3 - 2 * settle);
  let offX: number, offY: number, fw: number, fh: number;
  if (mobile) {
    offX = 0; offY = 0.4 * (1 - e) + 0.05 * e;
    fw = 0.94 * (1 - e) + 1.05 * e; fh = 0.34 * (1 - e) + 0.85 * e;
  } else {
    offX = 0.44 * (1 - e) + 0.12 * e; offY = -0.03 * (1 - e);
    fw = 0.51 * (1 - e) + 0.95 * e; fh = 0.76 * (1 - e) + 0.95 * e;
  }
  // Offsets/fit are authored against the visible viewport (vh); convert to the canvas (ch).
  const r = vh / ch;
  offY = 1 - (1 - offY) * r;
  fh *= r;
  const D = Math.max((1.6 * F) / (aspect * fw), (0.9 * F) / fh);
  // P * T(0,0,-D) * Rx(tiltY) * Ry(tiltX), column-major.
  const n = 0.05, f = 60;
  const cy = Math.cos(tiltX), sy = Math.sin(tiltX), cx = Math.cos(tiltY), sx = Math.sin(tiltY);
  // R = Rx * Ry
  const r00 = cy, r01 = 0, r02 = sy;
  const r10 = sx * sy, r11 = cx, r12 = -sx * cy;
  const r20 = -cx * sy, r21 = sx, r22 = cx * cy;
  const pa = F / aspect, pb = F, pc = (f + n) / (n - f), pd = (2 * f * n) / (n - f);
  // view = T * R  -> rows: [r0, r1, r2 - D]
  // clip = P * view
  vp[0] = pa * r00; vp[4] = pa * r01; vp[8] = pa * r02; vp[12] = 0;
  vp[1] = pb * r10; vp[5] = pb * r11; vp[9] = pb * r12; vp[13] = 0;
  vp[2] = pc * r20; vp[6] = pc * r21; vp[10] = pc * r22; vp[14] = pc * -D + pd;
  vp[3] = -r20; vp[7] = -r21; vp[11] = -r22; vp[15] = D;
  out.vp = vp; out.offX = offX; out.offY = offY;
  out.pxPerUnit = (F * ch * (renderer?.dpr ?? 1)) / 2;
  out.sizeScale = mobile ? 1.3 : 1;
  return D;
}

// ----- input
let pointerX = NaN, pointerY = NaN; // NDC
let tx = 0, ty = 0;
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  pointerX = (e.clientX / vw) * 2 - 1;
  pointerY = 1 - (e.clientY / ch) * 2;
  dirty = true;
}, { passive: true });
document.addEventListener('pointerleave', () => { pointerX = pointerY = NaN; });


// ----- frame loop
const frame: Frame = { vp, offX: 0, offY: 0, pxPerUnit: 1, sizeScale: 1, time: 0, bright: 1 };
let sDisp = -1;
let simTime = 0;
let last = performance.now();
let raf = 0;
let slowFrames = 0;
let lastRail = -1;
let lastDrawnS = -1;
let dirty = true;
const copyOpacity = new Float32Array(stages.length).fill(-1);

function tick(now: number) {
  raf = requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const y = getScroll(); // single read per frame
  const raw = rawState(y);
  let target = heldState(raw);
  if (forceS === forceS) target = Math.min(S - 1, Math.max(0, forceS));
  if (sDisp < 0 || reduced) sDisp = target;
  else sDisp += (target - sDisp) * (1 - Math.exp(-dt * 7));

  // Copy focus (desktop): fade chapters in/out around their anchor.
  if (!mobile) {
    for (let i = 0; i < stages.length; i++) {
      const c = copies[i];
      if (!c) continue;
      const s = Number(stages[i].dataset.state);
      const d = Math.abs(raw - s);
      let o = 1 - Math.min(1, Math.max(0, (d - 0.26) / 0.22));
      if (s === 0 && raw < 0) o = 1;
      o = Math.round(o * 50) / 50;
      if (o !== copyOpacity[i]) { copyOpacity[i] = o; c.style.opacity = String(o); }
    }
  } else if (copyOpacity[0] !== 1) {
    for (let i = 0; i < stages.length; i++) { copyOpacity[i] = 1; const c = copies[i]; if (c) c.style.opacity = ''; }
  }

  const rail = Math.min(S - 1, Math.round(raw));
  if (rail !== lastRail) {
    if (lastRail >= 0) railLinks[lastRail]?.removeAttribute('aria-current');
    railLinks[rail]?.setAttribute('aria-current', 'step');
    lastRail = rail;
  }

  if (!renderer) return;

  const motion = reduced ? 0 : 1;
  if (reduced) {
    // Static: only redraw when the scroll state, pointer or size changed.
    if (Math.abs(sDisp - lastDrawnS) < 1e-4 && !dirty) return;
  } else simTime += dt;
  lastDrawnS = sDisp;
  dirty = false;

  // Cursor tilt.
  const hasPtr = pointerX === pointerX;
  const wantX = hasPtr && motion ? pointerX * 0.16 : Math.sin(simTime * 0.13) * 0.05 * motion;
  const wantY = hasPtr && motion ? -pointerY * 0.1 : 0;
  const k = 1 - Math.exp(-dt * 3);
  tx += (wantX - tx) * k; ty += (wantY - ty) * k;

  const D = camera(sDisp, tx, ty, frame);
  frame.time = simTime;
  frame.bright = 1;

  let cx = NaN, cy = NaN;
  if (hasPtr) {
    cx = ((pointerX - frame.offX) * D * (vw / ch)) / F;
    cy = ((pointerY - frame.offY) * D) / F;
  }
  system.update(sDisp, simTime, cx, cy, motion);
  renderer.draw(frame, system.nodeData, system.edgeData);
  placeLabels();

  // Adaptive resolution: drop to 1x if frames are consistently slow.
  if (dt > 0.024 && dprCap > 1 && !debug) {
    if (++slowFrames > 90) { dprCap = 1; measure(); }
  } else slowFrames = Math.max(0, slowFrames - 1);
}

function placeLabels() {
  const p = system.pos;
  const w = vw, h = ch;
  for (const L of labelEls) {
    const vis = Math.max(0, 1 - Math.abs(sDisp - L.l.state) * 2.4) * Math.min(1, system.vis[L.l.node] * 1.2);
    const o = Math.round(vis * 40) / 40;
    if (o <= 0) {
      if (L.shown !== 0) { L.el.style.opacity = '0'; L.shown = 0; }
      continue;
    }
    const i = L.l.node * 3;
    const x = p[i], yy = p[i + 1], z = p[i + 2];
    const cw = vp[3] * x + vp[7] * yy + vp[11] * z + vp[15];
    const nx = (vp[0] * x + vp[4] * yy + vp[8] * z + vp[12]) / cw + frame.offX;
    const ny = (vp[1] * x + vp[5] * yy + vp[9] * z + vp[13]) / cw + frame.offY;
    const sx = (nx * 0.5 + 0.5) * w, sy = (0.5 - ny * 0.5) * h;
    L.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
    if (o !== L.shown) { L.el.style.opacity = String(o); L.shown = o; }
  }
}

function start() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}
function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

let resizeT = 0;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  if (debug) { measure(); applyForce(); }
  else resizeT = window.setTimeout(measure, 80);
});

function applyForce() {
  if (forceP === forceP) {
    setScroll(Math.min(1, Math.max(0, forceP)) * maxScroll);
  } else if (forceS === forceS) {
    const k = Math.min(S - 2, Math.floor(forceS));
    setScroll(anchors[k] + (anchors[k + 1] - anchors[k]) * (forceS - k));
  }
}

function boot() {
  measure();
  applyForce();
  start();
}
if (document.readyState === 'complete') boot();
else addEventListener('load', boot);
document.fonts?.ready.then(() => measure());
