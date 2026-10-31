// Every texture in the room is painted once into a canvas at startup. No image downloads.
import * as THREE from 'three';
import { projects } from '../../content';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Small deterministic PRNG so the city and books look the same on every visit.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Night skyline seen through the window. */
export function cityTexture(): THREE.CanvasTexture {
  const W = 768;
  const H = 768;
  const [c, g] = canvas(W, H);
  const r = rng(7);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0b0b26');
  sky.addColorStop(0.55, '#26214f');
  sky.addColorStop(0.85, '#5a3f73');
  sky.addColorStop(1, '#7a4f6e');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // stars
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(220,225,255,${0.25 + r() * 0.6})`;
    const s = r() * 1.6 + 0.4;
    g.fillRect(r() * W, r() * H * 0.55, s, s);
  }
  // moon + halo
  const mx = W * 0.72;
  const my = H * 0.2;
  const halo = g.createRadialGradient(mx, my, 10, mx, my, 220);
  halo.addColorStop(0, 'rgba(210,215,255,0.55)');
  halo.addColorStop(0.3, 'rgba(160,160,255,0.15)');
  halo.addColorStop(1, 'rgba(120,120,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#f1efff';
  g.beginPath();
  g.arc(mx, my, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(190,190,230,0.35)';
  g.beginPath();
  g.arc(mx - 9, my - 6, 8, 0, Math.PI * 2);
  g.arc(mx + 12, my + 10, 5, 0, Math.PI * 2);
  g.fill();
  // skyline layers, far to near
  const layers = [
    { base: H * 0.62, hMin: 40, hMax: 170, col: '#2a2550', lit: 0.18, win: 'rgba(255,200,140,0.5)' },
    { base: H * 0.78, hMin: 80, hMax: 280, col: '#1a1838', lit: 0.28, win: 'rgba(255,196,120,0.85)' },
    { base: H * 1.0, hMin: 120, hMax: 420, col: '#100f24', lit: 0.33, win: 'rgba(255,205,140,0.95)' },
  ];
  for (const L of layers) {
    let x = -20;
    while (x < W) {
      const bw = 40 + r() * 90;
      const bh = L.hMin + r() * (L.hMax - L.hMin);
      const top = L.base - bh;
      g.fillStyle = L.col;
      g.fillRect(x, top, bw, H - top);
      if (r() < 0.25) g.fillRect(x + bw * 0.4, top - 18, 3, 18); // antenna
      const cols = Math.floor(bw / 12);
      for (let cy = top + 10; cy < H; cy += 16) {
        for (let cx = 0; cx < cols; cx++) {
          if (r() < L.lit) {
            g.fillStyle = r() < 0.15 ? 'rgba(150,220,255,0.75)' : L.win;
            g.fillRect(x + 6 + cx * 12, cy, 6, 8);
          }
        }
      }
      x += bw + r() * 6;
    }
    // haze between layers
    const hz = g.createLinearGradient(0, L.base - 120, 0, L.base);
    hz.addColorStop(0, 'rgba(120,90,170,0)');
    hz.addColorStop(1, 'rgba(120,90,170,0.18)');
    g.fillStyle = hz;
    g.fillRect(0, L.base - 120, W, 120);
  }
  return tex(c);
}

/** Main monitor: the Migration Studio pipeline, drawn as a calm product UI. */
export function screenTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 600;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#0d1424';
  g.fillRect(0, 0, W, H);
  // top bar
  g.fillStyle = '#121c31';
  g.fillRect(0, 0, W, 44);
  ['#ff6b6b', '#ffd36b', '#62e6a6'].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(26 + i * 22, 22, 6.5, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = '#8fa6cc';
  g.font = '500 18px "Space Grotesk", system-ui, sans-serif';
  g.fillText('Migration Studio — canonical pipeline', 110, 28);
  // sidebar of real projects
  g.fillStyle = '#0f182b';
  g.fillRect(0, 44, 250, H - 44);
  g.font = '600 13px Inter, system-ui, sans-serif';
  g.fillStyle = '#5f7398';
  g.fillText('PROJECTS', 24, 82);
  projects.forEach((p, i) => {
    const y = 104 + i * 44;
    if (i === 0) {
      g.fillStyle = 'rgba(94,234,255,0.12)';
      rr(g, 12, y - 4, 226, 36, 8);
      g.fill();
    }
    g.fillStyle = i === 0 ? '#bff6ff' : '#9fb1d3';
    g.font = '500 16px Inter, system-ui, sans-serif';
    g.fillText(p.name, 28, y + 19);
  });
  // pipeline diagram
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, accent: string) => {
    g.fillStyle = '#152240';
    rr(g, x, y, w, h, 14);
    g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 2;
    rr(g, x, y, w, h, 14);
    g.stroke();
    g.fillStyle = '#e8f1ff';
    g.font = '600 20px "Space Grotesk", system-ui, sans-serif';
    g.fillText(title, x + 18, y + 36);
    g.fillStyle = '#8ea3c8';
    g.font = '400 14px Inter, system-ui, sans-serif';
    g.fillText(sub, x + 18, y + 60);
  };
  const arrow = (x1: number, y1: number, x2: number, y2: number) => {
    g.strokeStyle = '#5eeaff';
    g.lineWidth = 2.5;
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#5eeaff';
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - 10, y2 - 6);
    g.lineTo(x2 - 10, y2 + 6);
    g.fill();
  };
  box(290, 96, 200, 80, 'Boomi', 'source adapter', '#7aa2ff');
  box(290, 200, 200, 80, 'Celigo', 'source adapter', '#7aa2ff');
  box(540, 148, 210, 80, 'Canonical model', '53 entity types', '#5eeaff');
  box(800, 148, 196, 80, 'Workato', 'native recipes', '#62e6a6');
  arrow(490, 136, 538, 178);
  arrow(490, 240, 538, 200);
  arrow(750, 188, 798, 188);
  // findings strip
  g.fillStyle = '#101b33';
  rr(g, 290, 320, 706, 240, 14);
  g.fill();
  g.fillStyle = '#5f7398';
  g.font = '600 13px Inter, system-ui, sans-serif';
  g.fillText('REVIEW', 312, 352);
  const rows: [string, string][] = [
    ['#62e6a6', 'Every generated step traces back to its source shape'],
    ['#ffd36b', 'Untranslatable shapes become visible findings'],
    ['#7aa2ff', 'Recipes are delivered stopped, pending human review'],
    ['#5eeaff', 'New source platform = one new adapter'],
  ];
  rows.forEach(([col, t], i) => {
    const y = 382 + i * 44;
    g.fillStyle = col;
    g.beginPath();
    g.arc(320, y + 10, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c9d6ee';
    g.font = '400 17px Inter, system-ui, sans-serif';
    g.fillText(t, 338, y + 16);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(312, y + 32, 662, 1);
  });
  return tex(c);
}

/** Secondary portrait monitor: an editor full of abstract code. */
export function codeTexture(): THREE.CanvasTexture {
  const W = 420;
  const H = 640;
  const [c, g] = canvas(W, H);
  const r = rng(21);
  g.fillStyle = '#0c1220';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#111a2d';
  g.fillRect(0, 0, W, 34);
  g.fillStyle = '#7f93b8';
  g.font = '500 15px "Space Grotesk", system-ui, sans-serif';
  g.fillText('evaluate.py', 16, 23);
  const palette = ['#7aa2ff', '#5eeaff', '#c792ea', '#ffd36b', '#9fb1d3', '#62e6a6'];
  let indent = 0;
  for (let y = 54; y < H - 10; y += 21) {
    g.fillStyle = '#34405a';
    g.fillRect(12, y, 14, 7);
    if (r() < 0.12) {
      indent = Math.max(0, indent + (r() < 0.5 ? -1 : 1));
      continue;
    }
    let x = 42 + indent * 22;
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n && x < W - 30; k++) {
      const w = 18 + r() * 70;
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      g.globalAlpha = 0.75;
      rr(g, x, y, w, 8, 4);
      g.fill();
      x += w + 9;
    }
    g.globalAlpha = 1;
    if (r() < 0.2) indent = Math.min(3, indent + 1);
  }
  return tex(c);
}

/** Neon sign: name in a monoline script, glow baked into the canvas. */
export function neonTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 360;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = '150px Sacramento, "Brush Script MT", cursive';
  const draw = (blur: number, color: string, lw: number, alpha: number) => {
    g.save();
    g.globalAlpha = alpha;
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.font = font;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.strokeStyle = color;
    g.fillStyle = color;
    g.strokeText('Pramod Burra', W / 2, H / 2 - 10);
    g.fillText('Pramod Burra', W / 2, H / 2 - 10);
    g.restore();
  };
  draw(60, '#ff7ad9', 10, 0.55);
  draw(26, '#ff9be3', 6, 0.9);
  draw(8, '#ffe3f6', 2.5, 1);
  // small caps line
  g.font = '500 30px "Space Grotesk", system-ui, sans-serif';
  g.shadowColor = '#8ad8ff';
  g.shadowBlur = 18;
  g.fillStyle = '#d9f4ff';
  g.letterSpacing = '10px';
  g.fillText('AI ENGINEER', W / 2, H - 52);
  return tex(c);
}

/** Framed typographic poster: the career arc. */
export function posterTexture(): THREE.CanvasTexture {
  const W = 400;
  const H = 520;
  const [c, g] = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f3e6d4');
  bg.addColorStop(1, '#e8d3bd');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2b2a52';
  g.font = '600 18px "Space Grotesk", system-ui, sans-serif';
  g.fillText('THE ARC', 34, 52);
  const words = ['rules', 'workflows', 'AI', 'platforms'];
  const cols = ['#c75b4a', '#d99a3e', '#3d8b8b', '#4b4fa0'];
  words.forEach((w, i) => {
    const y = 130 + i * 92;
    g.fillStyle = cols[i];
    g.beginPath();
    g.arc(46, y - 14, 10, 0, Math.PI * 2);
    g.fill();
    if (i < 3) {
      g.fillStyle = 'rgba(43,42,82,0.25)';
      g.fillRect(45, y, 2, 70);
    }
    g.fillStyle = '#2b2a52';
    g.font = '600 46px "Space Grotesk", system-ui, sans-serif';
    g.fillText(w, 74, y);
  });
  g.fillStyle = 'rgba(43,42,82,0.6)';
  g.font = '400 15px Inter, system-ui, sans-serif';
  g.fillText('2015 → today', 34, H - 30);
  return tex(c);
}

/** Soft radial sprite used for every glow halo and the contact-shadow blobs. */
export function radialTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c, false);
}

/** Rug: concentric rounded stripes. */
export function rugTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#3a3f7a';
  g.fillRect(0, 0, S, S);
  const rings = ['#454b8c', '#e7b98a', '#3a3f7a', '#c76f5e', '#3a3f7a', '#4f57a0'];
  rings.forEach((col, i) => {
    g.strokeStyle = col;
    g.lineWidth = i === 1 || i === 3 ? 6 : 14;
    const m = 30 + i * 26;
    rr(g, m, m, S - m * 2, S - m * 2, 40);
    g.stroke();
  });
  // subtle weave noise
  const r = rng(3);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  return tex(c);
}

/** Wood floor planks. */
export function floorTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(11);
  const planks = 8;
  const pw = S / planks;
  for (let i = 0; i < planks; i++) {
    let y = -r() * 200;
    while (y < S) {
      const len = 160 + r() * 200;
      const l = 0.9 + r() * 0.16;
      g.fillStyle = `rgb(${Math.round(150 * l)},${Math.round(104 * l)},${Math.round(82 * l)})`;
      g.fillRect(i * pw, y, pw, len);
      g.fillStyle = 'rgba(40,20,20,0.35)';
      g.fillRect(i * pw, y, pw, 2);
      // grain
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(60,30,20,${0.05 + r() * 0.06})`;
        g.fillRect(i * pw + r() * pw, y, 1.5, len);
      }
      y += len;
    }
    g.fillStyle = 'rgba(30,15,15,0.45)';
    g.fillRect(i * pw, 0, 2, S);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Moonlight falling through the window panes onto the floor (soft, pre-blurred). */
export function windowLightTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.filter = 'blur(7px)';
  g.fillStyle = '#ffffff';
  const pad = 26;
  const gap = 12;
  const pw = (W - pad * 2 - gap) / 2;
  const ph = (H - pad * 2 - gap) / 2;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      g.globalAlpha = 0.9 - j * 0.25;
      g.fillRect(pad + i * (pw + gap), pad + j * (ph + gap), pw, ph);
    }
  return tex(c, false);
}
