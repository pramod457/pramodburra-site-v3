// CPU-side generators for the point clouds particles morph into.
// Every generator returns xyz triples (packed as vec4 for the GPU) roughly within a unit-ish box.

export const MAX_TARGETS = 65536;

export type ShapeName = 'sphere' | 'torus' | 'helix' | 'cube' | 'wave' | 'knot';
export const SHAPES: ShapeName[] = ['sphere', 'torus', 'helix', 'cube', 'wave', 'knot'];

function pack(points: number[][]): Float32Array {
  const out = new Float32Array(points.length * 4);
  points.forEach(([x, y, z], i) => out.set([x, y, z, 1], i * 4));
  return out;
}

/** Rasterise text and return its filled pixels, scaled to `width` world units (and no taller than `height`). */
export function textTargets(text: string, width: number, height: number): Float32Array {
  const words = text.trim().toUpperCase().split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= 12) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
  }

  const fontPx = 200;
  const lineH = fontPx * 1.05;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const font = `800 ${fontPx}px Inter, system-ui, sans-serif`;
  ctx.font = font;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  canvas.width = Math.ceil(textW + 40);
  canvas.height = Math.ceil(lines.length * lineH + 40);
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, 20 + lineH * (i + 0.5)));

  const { data, width: W, height: H } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let filled = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) filled++;
  const step = Math.max(1, Math.ceil(Math.sqrt(filled / MAX_TARGETS)));
  const scale = Math.min(width / textW, height / (lines.length * lineH));

  const pts: number[][] = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (data[(y * W + x) * 4 + 3] > 128) pts.push([(x - W / 2) * scale, (H / 2 - y) * scale, 0]);
    }
  }
  return pack(pts.slice(0, MAX_TARGETS));
}

export function shapeTargets(name: ShapeName, n = 40000): Float32Array {
  const pts: number[][] = [];
  const TAU = Math.PI * 2;
  switch (name) {
    case 'sphere': {
      const ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        pts.push([Math.cos(ga * i) * r * 1.1, y * 1.1, Math.sin(ga * i) * r * 1.1]);
      }
      break;
    }
    case 'torus':
      for (let i = 0; i < n; i++) {
        const u = Math.random() * TAU, v = Math.random() * TAU;
        const r = 1 + 0.38 * Math.cos(v);
        pts.push([r * Math.cos(u), 0.38 * Math.sin(v), r * Math.sin(u)]);
      }
      break;
    case 'helix':
      for (let i = 0; i < n; i++) {
        const t = Math.random();
        const a = t * TAU * 3;
        const y = (t - 0.5) * 2.6;
        if (i % 5 === 0) {
          // rungs between the two strands
          const s = Math.random() * 2 - 1;
          pts.push([Math.cos(a) * 0.55 * s, y, Math.sin(a) * 0.55 * s]);
        } else {
          const off = i % 2 ? 0 : Math.PI;
          pts.push([Math.cos(a + off) * 0.55, y, Math.sin(a + off) * 0.55]);
        }
      }
      break;
    case 'cube': {
      const corners = [-1, 1];
      for (let i = 0; i < n; i++) {
        const axis = i % 3;
        const p = [0, 0, 0];
        p[axis] = Math.random() * 2 - 1;
        p[(axis + 1) % 3] = corners[Math.random() < 0.5 ? 0 : 1];
        p[(axis + 2) % 3] = corners[Math.random() < 0.5 ? 0 : 1];
        pts.push(p.map((c) => c * 0.8));
      }
      break;
    }
    case 'wave':
      for (let i = 0; i < n; i++) {
        const x = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
        const r = Math.hypot(x, z);
        pts.push([x * 1.6, Math.sin(r * 9) * 0.18 * (1 - r * 0.5), z * 1.6]);
      }
      break;
    case 'knot':
      // (3,2) torus knot with a thin tube
      for (let i = 0; i < n; i++) {
        const t = Math.random() * TAU;
        const r = 0.7 + 0.32 * Math.cos(3 * t);
        const c = [r * Math.cos(2 * t), 0.32 * Math.sin(3 * t), r * Math.sin(2 * t)];
        pts.push(c.map((v) => v + (Math.random() - 0.5) * 0.08));
      }
      break;
  }
  return pack(pts);
}
