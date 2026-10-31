import * as THREE from 'three';
import { buildRoom, type Hotspot } from './scene';
import { fallbackHTML, sectionHTML, SECTION_META, SECTIONS, type SectionId } from './panels';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const body = document.body;
const canvas = $<HTMLCanvasElement>('room-canvas');
const panel = $<HTMLElement>('panel');
const panelBody = $<HTMLElement>('panel-body');
const panelKicker = $<HTMLElement>('panel-kicker');
const tip = $<HTMLElement>('tip');
const hint = $<HTMLElement>('hint');
const hotspotLayer = $<HTMLElement>('hotspots');
const loader = $<HTMLElement>('loader');

const params = new URLSearchParams(location.search);
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reduceMQ.matches;

function isSection(s: string | null | undefined): s is SectionId {
  return !!s && (SECTIONS as string[]).includes(s);
}

// ---------------------------------------------------------------- fallback
function hasWebGL2(): boolean {
  if (params.has('nogl')) return false;
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function showFallback() {
  const fb = $<HTMLElement>('fallback');
  fb.innerHTML = fallbackHTML();
  fb.hidden = false;
  body.classList.remove('is-loading');
  body.classList.add('no-webgl');
  // nav buttons scroll to sections instead of flying
  document.querySelectorAll<HTMLElement>('[data-go]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.dataset.go;
      const target = id && id !== 'home' ? document.getElementById(id) : fb;
      target?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }),
  );
}

async function fontsReady() {
  const wanted = ['500 18px "Space Grotesk"', '600 20px "Space Grotesk"', '400 16px Inter', '150px Sacramento'];
  await Promise.race([
    Promise.all(wanted.map((f) => document.fonts.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, 1800)),
  ]);
}

// ---------------------------------------------------------------- app
async function start() {
  if (!hasWebGL2()) return showFallback();
  await fontsReady();

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return showFallback();
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // everything that casts is static: bake once
  renderer.shadowMap.needsUpdate = true;
  renderer.setClearColor(0x000000, 0);

  const room = buildRoom();
  const { scene, hotspots, uniforms } = room;
  const byId = new Map<SectionId, Hotspot>(hotspots.map((h) => [h.id, h]));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

  // ---------------------------------------------------------- camera rig
  // Orbit is a constrained spherical rig around a fixed target; focus views are explicit poses.
  const ORBIT_TARGET = new THREE.Vector3(-0.05, 0.95, -0.3);
  const AZ0 = 0.68; // radians, viewing from front-right
  const EL0 = 0.4;
  const AZ_RANGE = 0.42;
  const EL_MIN = 0.18;
  const EL_MAX = 0.72;
  let az = AZ0;
  let el = EL0;
  let azGoal = AZ0;
  let elGoal = EL0;
  let radius = 13;
  let zoom = 1; // wheel/pinch multiplier
  let zoomGoal = 1;

  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const orbitPos = new THREE.Vector3();
  const flyFromPos = new THREE.Vector3();
  const flyFromTarget = new THREE.Vector3();
  const flyToPos = new THREE.Vector3();
  const flyToTarget = new THREE.Vector3();
  const focusPos = new THREE.Vector3();
  const focusTarget = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const pointer = new THREE.Vector2(0, 0); // ndc, for parallax + picking
  const parallax = new THREE.Vector2(0, 0);

  let mode: 'orbit' | 'flying' | 'focused' = 'orbit';
  let current: SectionId | null = null;
  let flyT = 0;
  let flyDur = 1.5;
  let flyingTo: 'orbit' | 'focused' = 'orbit';
  let shift = 0; // 0..1 how much of the panel offset is applied
  let shiftGoal = 0;

  let width = 1;
  let height = 1;
  let portrait = false;
  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  function orbitRadius() {
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * camera.aspect;
    const needH = 3.75 / tanV; // half-height of the diorama
    const needW = (portrait ? 3.85 : 6.0) / tanH; // half-width
    return Math.max(needH, needW);
  }

  function focusDistanceScale() {
    // Narrow screens: pull back so the object still fits in the visible part above the sheet.
    if (!portrait) return camera.aspect < 1.3 ? 1.25 : 1;
    return THREE.MathUtils.clamp(1.0 / camera.aspect, 1.4, 2.2) * 0.95;
  }

  function computeFocus(id: SectionId, outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    const h = byId.get(id) as Hotspot;
    outTarget.copy(h.view.target);
    outPos.copy(h.view.pos).sub(outTarget).multiplyScalar(focusDistanceScale()).add(outTarget);
  }

  function computeOrbit(out: THREE.Vector3) {
    const r = radius * zoom;
    out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(r).add(ORBIT_TARGET);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    portrait = width / height < 0.85;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = portrait ? 44 : 30;
    radius = orbitRadius();
    uniforms.uPixelRatio.value = dpr * (height / 900);
    applyViewOffset();
    camera.updateProjectionMatrix();
    if (mode === 'focused' && current) {
      computeFocus(current, focusPos, focusTarget);
      camPos.copy(focusPos);
      camTarget.copy(focusTarget);
    }
    invalidate();
  }

  function applyViewOffset() {
    // Shift the projection so the focused object sits in the part of the screen the panel doesn't cover.
    if (shift < 0.001) {
      camera.clearViewOffset();
      return;
    }
    if (portrait) {
      const sheet = panel.offsetHeight || height * 0.58;
      camera.setViewOffset(width, height, 0, (sheet / 2) * shift * 0.92, width, height);
    } else {
      const pw = panel.offsetWidth || Math.min(520, width * 0.42);
      camera.setViewOffset(width, height, (pw / 2 + 12) * shift, 0, width, height);
    }
  }

  // ---------------------------------------------------------- hotspot markers + hover
  const markers = new Map<SectionId, HTMLButtonElement>();
  for (const h of hotspots) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'marker';
    b.tabIndex = -1; // nav is the keyboard path; markers are for pointer users
    b.innerHTML = `<span class="dot"></span><span class="lbl">${h.label}</span>`;
    b.addEventListener('click', () => go(h.id));
    b.addEventListener('pointerenter', () => setHover(h));
    b.addEventListener('pointerleave', () => setHover(null));
    hotspotLayer.appendChild(b);
    markers.set(h.id, b);
  }

  let hovered: Hotspot | null = null;
  function setHover(h: Hotspot | null) {
    if (hovered === h) return;
    hovered = h;
    canvas.style.cursor = h ? 'pointer' : '';
    markers.forEach((m, id) => m.classList.toggle('hot', !!h && h.id === id));
    if (h && mode === 'orbit') {
      tip.textContent = SECTION_META[h.id].object;
      tip.classList.add('show');
    } else tip.classList.remove('show');
    invalidate();
  }

  const ray = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  function pick(ndcX: number, ndcY: number): Hotspot | null {
    ray.setFromCamera(pointer.set(ndcX, ndcY), camera);
    let best: Hotspot | null = null;
    let bestD = Infinity;
    for (const h of hotspots) {
      if (ray.ray.intersectBox(h.box, hit)) {
        const d = hit.distanceToSquared(ray.ray.origin);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------- navigation
  let lastTrigger: HTMLElement | null = null;

  function go(id: SectionId | 'home', fromHistory = false) {
    if (id === 'home') return goHome(fromHistory);
    if (!fromHistory && location.hash !== `#${id}`) history.pushState({ id }, '', `#${id}`);
    openPanel(id);
    flyTo(id);
  }

  function goHome(fromHistory = false) {
    if (!fromHistory && location.hash) history.pushState({}, '', location.pathname + location.search.replace(/[?&]focus=[^&]*/, ''));
    closePanel();
    if (mode !== 'orbit' || current) flyHome();
  }

  function openPanel(id: SectionId) {
    current = id;
    panelKicker.textContent = SECTION_META[id].kicker;
    panelBody.innerHTML = sectionHTML(id);
    panelBody.scrollTop = 0;
    panel.setAttribute('aria-hidden', 'false');
    body.classList.add('has-panel');
    body.dataset.section = id;
    document.querySelectorAll<HTMLElement>('.nav [data-go]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.go === id)));
    panelBody.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => go(b.dataset.go as SectionId)),
    );
    tip.classList.remove('show');
    const title = panel.querySelector<HTMLElement>('#panel-title');
    title?.setAttribute('tabindex', '-1');
    requestAnimationFrame(() => title?.focus({ preventScroll: true }));
  }

  function closePanel() {
    current = null;
    panel.setAttribute('aria-hidden', 'true');
    body.classList.remove('has-panel');
    delete body.dataset.section;
    document.querySelectorAll<HTMLElement>('.nav [data-go]').forEach((b) => b.setAttribute('aria-current', 'false'));
    lastTrigger?.focus({ preventScroll: true });
  }

  function beginFly(toPos: THREE.Vector3, toTarget: THREE.Vector3, to: 'orbit' | 'focused') {
    flyFromPos.copy(camPos);
    flyFromTarget.copy(camTarget);
    flyToPos.copy(toPos);
    flyToTarget.copy(toTarget);
    flyingTo = to;
    flyT = 0;
    const dist = flyFromPos.distanceTo(flyToPos);
    flyDur = reduced ? 0.001 : THREE.MathUtils.clamp(0.9 + dist * 0.06, 1.1, 1.8);
    mode = 'flying';
    invalidate();
  }

  function flyTo(id: SectionId) {
    computeFocus(id, focusPos, focusTarget);
    shiftGoal = 1;
    beginFly(focusPos, focusTarget, 'focused');
  }

  function flyHome() {
    shiftGoal = 0;
    // return to the orbit pose closest to where we are, so the exit feels continuous
    azGoal = az = THREE.MathUtils.clamp(Math.atan2(camPos.x - ORBIT_TARGET.x, camPos.z - ORBIT_TARGET.z), AZ0 - AZ_RANGE, AZ0 + AZ_RANGE);
    elGoal = el = EL0;
    computeOrbit(orbitPos);
    beginFly(orbitPos, ORBIT_TARGET, 'orbit');
  }

  document.querySelectorAll<HTMLElement>('[data-go]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      lastTrigger = el;
      const id = el.dataset.go as SectionId | 'home';
      if (id !== 'home' && current === id) return;
      go(id);
    }),
  );
  $<HTMLButtonElement>('back').addEventListener('click', () => goHome());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) {
      e.preventDefault();
      goHome();
    }
  });
  window.addEventListener('popstate', () => {
    const id = location.hash.slice(1);
    if (isSection(id)) go(id, true);
    else goHome(true);
  });

  // ---------------------------------------------------------- pointer: drag to orbit, tap to open
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  let pickDirty = false;
  let interacted = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart = 0;
  let pinchZoom = 1;

  function noteInteraction() {
    if (interacted) return;
    interacted = true;
    hint.classList.add('gone');
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      pinchZoom = zoomGoal;
    }
    dragging = true;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    moved = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
    if (e.pointerType === 'mouse') parallax.copy(pointer);
    pickDirty = true;
    const p = pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (pointers.size === 2 && mode === 'orbit') {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomGoal = THREE.MathUtils.clamp(pinchZoom * (pinchStart / Math.max(d, 1)), 0.72, 1.12);
      moved = 99;
      invalidate();
      return;
    }
    if (!dragging) {
      invalidate();
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
    if (mode === 'orbit' && moved > 4) {
      azGoal = THREE.MathUtils.clamp(azGoal - dx * 0.005, AZ0 - AZ_RANGE, AZ0 + AZ_RANGE);
      elGoal = THREE.MathUtils.clamp(elGoal + dy * 0.004, EL_MIN, EL_MAX);
      noteInteraction();
    }
    invalidate();
  });
  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!dragging) return;
    if (pointers.size > 0) return;
    dragging = false;
    if (moved < 7 && e.type === 'pointerup') {
      const h = pick((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
      if (h) {
        noteInteraction();
        lastTrigger = null;
        if (current !== h.id) go(h.id);
      }
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      parallax.set(0, 0);
      setHover(null);
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (mode !== 'orbit') return;
      e.preventDefault();
      zoomGoal = THREE.MathUtils.clamp(zoomGoal * (1 + Math.sign(e.deltaY) * 0.06), 0.72, 1.12);
      noteInteraction();
      invalidate();
    },
    { passive: false },
  );

  // ---------------------------------------------------------- loop
  let raf = 0;
  let needsRender = true;
  let last = performance.now();
  let time = 0;
  let frames = 0;
  let slowFrames = 0;

  function invalidate() {
    needsRender = true;
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

  function frame(now: number) {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const animate = !reduced;
    if (animate) time += dt;
    uniforms.uTime.value = time;
    uniforms.uMotion.value = reduced ? 0 : 1;

    // adaptive resolution: if we keep missing frames on a weak GPU, drop to 1x
    if (animate && frames++ > 30 && dpr > 1) {
      slowFrames = dt > 0.026 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 45) {
        dpr = 1;
        resize();
      }
    }

    let moving = false;
    // orbit easing + idle drift
    az = damp(az, azGoal, 6, dt);
    el = damp(el, elGoal, 6, dt);
    zoom = damp(zoom, zoomGoal, 6, dt);
    if (Math.abs(az - azGoal) + Math.abs(el - elGoal) + Math.abs(zoom - zoomGoal) > 1e-4) moving = true;

    if (mode === 'orbit') {
      computeOrbit(camPos);
      if (animate) {
        const drift = Math.sin(time * 0.11) * 0.05;
        tmp.set(Math.cos(az), 0, -Math.sin(az)).multiplyScalar((drift + parallax.x * 0.06) * radius);
        camPos.add(tmp);
        camPos.y += (Math.sin(time * 0.07) * 0.03 + parallax.y * 0.04) * radius * 0.5;
      }
      camTarget.copy(ORBIT_TARGET);
    } else if (mode === 'flying') {
      flyT = Math.min(1, flyT + dt / flyDur);
      const k = ease(flyT);
      camPos.lerpVectors(flyFromPos, flyToPos, k);
      // a gentle arc: lift slightly mid-flight
      camPos.y += Math.sin(Math.PI * k) * 0.35 * (flyingTo === 'focused' ? 1 : 0.6);
      camTarget.lerpVectors(flyFromTarget, flyToTarget, k);
      moving = true;
      if (flyT >= 1) mode = flyingTo;
    } else {
      camPos.copy(focusPos);
      camTarget.copy(focusTarget);
      if (animate) {
        camPos.x += parallax.x * 0.08 + Math.sin(time * 0.3) * 0.015;
        camPos.y += parallax.y * 0.05;
      }
    }

    // panel offset
    const ns = reduced ? shiftGoal : damp(shift, shiftGoal, 4, dt);
    if (Math.abs(ns - shift) > 1e-4 || (ns !== shift && reduced)) {
      shift = ns;
      applyViewOffset();
      camera.updateProjectionMatrix();
      moving = true;
    }

    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();

    // hover picking (desktop) — only when the pointer moved
    if (pickDirty && !dragging && mode === 'orbit') {
      pickDirty = false;
      setHover(pick(pointer.x, pointer.y));
    }

    // hover glow + outline
    for (const h of hotspots) {
      const goal = (hovered === h && mode === 'orbit') || (current === h.id && mode === 'flying') ? 1 : 0;
      const g = reduced ? goal : damp(h.glow, goal, 10, dt);
      if (Math.abs(g - h.glow) > 1e-3) moving = true;
      h.glow = g;
      h.material.emissive.setRGB(0.07 * g, 0.045 * g, 0.02 * g);
      const hm = h.hull.material as THREE.ShaderMaterial;
      hm.uniforms.uOpacity.value = g;
      h.hull.visible = g > 0.01;
    }

    renderer.render(scene, camera);
    placeMarkers();

    if (needsRender && body.classList.contains('is-loading')) {
      body.classList.remove('is-loading');
      setTimeout(() => loader.remove(), 900);
    }
    needsRender = false;
    // keep looping while anything moves; with reduced motion we only render on demand
    if ((animate || moving) && !document.hidden) raf = requestAnimationFrame(frame);
  }

  const proj = new THREE.Vector3();
  function placeMarkers() {
    const show = mode === 'orbit';
    hotspotLayer.classList.toggle('hidden', !show);
    if (!show) return;
    for (const h of hotspots) {
      proj.copy(h.anchor).project(camera);
      const x = (proj.x * 0.5 + 0.5) * width;
      const y = (-proj.y * 0.5 + 0.5) * height;
      (markers.get(h.id) as HTMLElement).style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
    if (hovered) {
      proj.copy(hovered.anchor).project(camera);
      tip.style.transform = `translate3d(${((proj.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-proj.y * 0.5 + 0.5) * height).toFixed(1)}px, 0)`;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      last = performance.now();
      invalidate();
    }
  });
  reduceMQ.addEventListener('change', () => {
    reduced = reduceMQ.matches;
    invalidate();
  });
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------- initial state
  resize();
  computeOrbit(camPos);
  camTarget.copy(ORBIT_TARGET);
  const initial = params.get('focus') ?? location.hash.slice(1);
  if (isSection(initial)) {
    // deep link: open directly, no flight
    openPanel(initial);
    computeFocus(initial, focusPos, focusTarget);
    camPos.copy(focusPos);
    camTarget.copy(focusTarget);
    shift = shiftGoal = 1;
    mode = 'focused';
    applyViewOffset();
    camera.updateProjectionMatrix();
    hint.classList.add('gone');
    body.classList.add('instant');
    setTimeout(() => body.classList.remove('instant'), 1200);
  }
  const hv = params.get('hover'); // debug: preview the hover state in screenshots
  if (isSection(hv) && mode === 'orbit') setHover(byId.get(hv) as Hotspot);
  invalidate();
}

start().catch((err) => {
  console.error(err);
  showFallback();
});
