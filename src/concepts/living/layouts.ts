// The six shapes of one system. Every state is a list of slots (node looks) plus edges between slots.
// At build time each state's slots are matched to the SAME 64 node identities, greedily, by distance
// from where each node sat in the previous state. Nodes a state doesn't need are parked inside the
// nearest visible node, so they appear to split out of / merge into it during the morph.

export const N = 64;
export const S = 6; // hero, rules, workflows, ai, platform, settled

// Node attribute layout (per node, per state).
export const NX = 0, NY = 1, NZ = 2, NW = 3, NH = 4, NROUND = 5, NROT = 6, NFILL = 7, NGLOW = 8, NINT = 9, NR = 10, NG = 11, NB = 12;
export const NODE_STRIDE = 13;

// Edge attribute layout (per edge, per state).
export const EW = 0, EPULSE = 1, EMODE = 2, EBEND = 3, EWIDTH = 4, EFLICK = 5, EDASH = 6, EPHASE = 7, EPERIOD = 8;
export const EDGE_STRIDE = 9;

export const MODE_LINE = 0, MODE_HV = 1, MODE_VH = 2;

type RGB = readonly [number, number, number];
export const COL = {
  cream: [0.93, 0.88, 0.8] as RGB,
  copper: [0.86, 0.55, 0.33] as RGB,
  patina: [0.37, 0.7, 0.62] as RGB,
  dim: [0.55, 0.51, 0.46] as RGB,
};

interface Slot {
  x: number; y: number; z?: number;
  w: number; h?: number; round?: number; rot?: number;
  fill?: number; glow?: number; inten?: number; col: RGB;
}
interface EdgeSpec {
  a: number; b: number;
  weight?: number; pulse?: number; mode?: number; bend?: number; width?: number;
  flicker?: number; dash?: number; phase?: number; period?: number;
}
export type LabelPos = 'r' | 'l' | 't' | 'b';
interface LabelSpec { slot: number; text: string; pos: LabelPos; strong?: boolean }
interface StateSpec { slots: Slot[]; edges: EdgeSpec[]; labels: LabelSpec[] }

export interface Label { node: number; state: number; text: string; pos: LabelPos; strong: boolean }

export interface Built {
  nodes: Float32Array;      // S * N * NODE_STRIDE
  edgeA: Uint16Array;
  edgeB: Uint16Array;
  edgeCount: number;
  edges: Float32Array;      // E * S * EDGE_STRIDE
  edgeSeed: Float32Array;   // E, random 0..1
  delay: Float32Array;      // S * N, stagger for transition k -> k+1 (index by k)
  arc: Float32Array;        // N, signed arc amount for morph trajectories
  phase: Float32Array;      // N * 3, drift phases
  labels: Label[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const D45 = Math.PI / 4;

// ---------------------------------------------------------------- state 0: hero (alive, loose)
function heroSlots(scale: number, inten: number, seed: number): StateSpec {
  const r = rng(seed);
  const slots: Slot[] = [];
  for (let i = 0; i < N; i++) {
    const th = r() * Math.PI * 2;
    const ph = Math.acos(2 * r() - 1);
    const rad = 0.28 + 0.82 * Math.cbrt(r());
    const big = i % 9 === 0;
    const c = r();
    slots.push({
      x: rad * Math.sin(ph) * Math.cos(th) * 1.32 * scale,
      y: rad * Math.cos(ph) * 0.86 * scale,
      z: rad * Math.sin(ph) * Math.sin(th) * 0.9,
      w: big ? 0.05 : 0.016 + r() * 0.018,
      round: 1, fill: 1, glow: big ? 1.1 : 0.55,
      inten: inten * (big ? 1 : 0.85),
      col: big ? COL.copper : c < 0.18 ? COL.patina : c < 0.26 ? COL.copper : COL.cream,
    });
  }
  const edges: EdgeSpec[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < N; i++) {
    const d: [number, number][] = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const a = slots[i], b = slots[j];
      d.push([j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z ?? 0) - (b.z ?? 0)) ** 2]);
    }
    d.sort((p, q) => p[1] - q[1]);
    for (let k = 0; k < 2; k++) {
      const j = d[k][0];
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pulsing = r() < 0.28;
      edges.push({
        a: i, b: j, weight: 0.32 * inten, width: 1,
        pulse: pulsing ? 0.75 * inten : 0, phase: r() * 6, period: 3 + r() * 4,
      });
    }
  }
  return { slots, edges, labels: [] };
}

// ---------------------------------------------------------------- state 1: rules (decision tree)
function rulesSlots(): StateSpec {
  const r = rng(11);
  const slots: Slot[] = [];
  const edges: EdgeSpec[] = [];
  const depth = 5; // 31 nodes
  for (let i = 0; i < 2 ** depth - 1; i++) {
    const d = Math.floor(Math.log2(i + 1));
    const j = i + 1 - 2 ** d;
    const x = ((j + 0.5) / 2 ** d - 0.5) * 2.7;
    const y = 0.82 - d * 0.41;
    const leaf = d === depth - 1;
    const c = r();
    if (leaf) {
      slots.push({ x, y, w: 0.042, round: 1, fill: 1, glow: 0.8, inten: 1, col: c < 0.4 ? COL.patina : c < 0.62 ? COL.copper : COL.cream });
    } else {
      slots.push({ x, y, w: i === 0 ? 0.1 : 0.075, round: 0.12, rot: D45, fill: i === 0 ? 0.35 : 0.06, glow: i === 0 ? 0.9 : 0.25, inten: 1, col: i === 0 ? COL.copper : COL.cream });
    }
    if (i > 0) {
      const p = (i - 1) >> 1;
      edges.push({ a: p, b: i, weight: 0.62, width: 1.25, pulse: 0.8, phase: -(d - 1), period: depth + 1.5, mode: MODE_HV });
    }
  }
  return {
    slots, edges,
    labels: [
      { slot: 0, text: 'policy', pos: 'r', strong: true },
      { slot: 2, text: 'condition', pos: 'r' },
      { slot: 26, text: 'decision', pos: 'b' },
    ],
  };
}

// ---------------------------------------------------------------- state 2: workflows (BPMN)
function workflowSlots(): StateSpec {
  const slots: Slot[] = [];
  const edges: EdgeSpec[] = [];
  const add = (s: Slot) => (slots.push(s), slots.length - 1);
  const task = (x: number, y: number) => add({ x, y, w: 0.25, h: 0.15, round: 0.28, fill: 0.07, glow: 0.18, inten: 1, col: COL.cream });
  const gate = (x: number, y: number) => add({ x, y, w: 0.085, round: 0.1, rot: D45, fill: 0.12, glow: 0.4, inten: 1, col: COL.copper });

  const start = add({ x: -1.3, y: 0, w: 0.075, round: 1, fill: 0.05, glow: 0.6, inten: 1, col: COL.patina });
  const t1 = task(-0.96, 0);
  const g1 = gate(-0.64, 0);
  const rows = [0.4, 0, -0.4];
  const ta = rows.map((y) => task(-0.31, y));
  const tb = rows.map((y) => task(0.03, y));
  const g2 = gate(0.35, 0);
  const t3 = task(0.67, 0);
  const end = add({ x: 0.98, y: 0, w: 0.085, round: 1, fill: 0.5, glow: 0.8, inten: 1, col: COL.patina });

  // Pool frame: invisible corner nodes, faint edges.
  const P = { l: -1.58, r: 1.16, t: 0.66, b: -0.66, h: -1.46 };
  const hid = (x: number, y: number) => add({ x, y, w: 0, inten: 0, col: COL.dim });
  const tl = hid(P.l, P.t), tr = hid(P.r, P.t), br = hid(P.r, P.b), bl = hid(P.l, P.b);
  const ht = hid(P.h, P.t), hb = hid(P.h, P.b);
  for (const [a, b] of [[tl, tr], [tr, br], [br, bl], [bl, tl], [ht, hb]]) edges.push({ a, b, weight: 0.16, width: 1 });

  const per = 8.5;
  const flow = (a: number, b: number, depth: number, mode = MODE_LINE) =>
    edges.push({ a, b, weight: 0.55, width: 1.3, pulse: 1, phase: -depth, period: per, mode });
  flow(start, t1, 0);
  flow(t1, g1, 1);
  for (let k = 0; k < 3; k++) {
    flow(g1, ta[k], 2, MODE_VH);
    flow(ta[k], tb[k], 3);
    flow(tb[k], g2, 4, MODE_HV);
  }
  flow(g2, t3, 5);
  flow(t3, end, 6);

  return {
    slots, edges,
    labels: [
      { slot: start, text: 'start', pos: 'b' },
      { slot: g1, text: 'gateway', pos: 'b' },
      { slot: ta[0], text: 'service task', pos: 't' },
      { slot: tb[2], text: 'user task', pos: 'b' },
      { slot: g2, text: 'join', pos: 'b' },
      { slot: end, text: 'end', pos: 'b' },
    ],
  };
}

// ---------------------------------------------------------------- state 3: AI (knowledge / conversation graph)
function aiSlots(): StateSpec {
  const r = rng(29);
  const slots: Slot[] = [];
  const edges: EdgeSpec[] = [];
  const centers: [number, number][] = [[-0.86, 0.3], [0.04, 0.56], [0.9, 0.24], [-0.44, -0.46], [0.56, -0.48]];
  const sizes = [13, 13, 13, 13, 12];
  const hubs: number[] = [];
  const members: number[][] = [];
  centers.forEach(([cx, cy], ci) => {
    const hub = slots.length;
    hubs.push(hub);
    slots.push({ x: cx, y: cy, z: 0, w: 0.058, round: 1, fill: 1, glow: 1.3, inten: 1, col: COL.copper });
    const m: number[] = [];
    for (let k = 1; k < sizes[ci]; k++) {
      const a = r() * Math.PI * 2;
      const rad = 0.11 + 0.25 * Math.sqrt(r());
      const c = r();
      m.push(slots.length);
      slots.push({
        x: cx + Math.cos(a) * rad * 1.15, y: cy + Math.sin(a) * rad * 0.9, z: (r() - 0.5) * 0.4,
        w: 0.015 + r() * 0.02, round: 1, fill: 1, glow: 0.7, inten: 0.95,
        col: c < 0.62 ? COL.patina : c < 0.8 ? COL.cream : COL.copper,
      });
    }
    members.push(m);
    for (const s of m) {
      const spoke = r() < 0.7;
      if (spoke) edges.push({ a: hub, b: s, weight: 0.34, width: 1, pulse: 0.55, phase: r() * 5, period: 2.5 + r() * 3, bend: (r() - 0.5) * 0.25 });
    }
    // Satellite to its nearest satellite: these form and re-form.
    for (const s of m) {
      let best = -1, bd = 1e9;
      for (const t of m) {
        if (t === s) continue;
        const d = (slots[s].x - slots[t].x) ** 2 + (slots[s].y - slots[t].y) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
      if (best >= 0 && s < best) edges.push({ a: s, b: best, weight: 0.42, width: 1, flicker: 1, bend: 0.12 });
      else if (best >= 0) edges.push({ a: best, b: s, weight: 0.42, width: 1, flicker: 1, bend: 0.12 });
    }
  });
  // Hub ring: a traversal path through every cluster, pulses travel in sequence.
  const path = [0, 1, 2, 4, 3, 0];
  for (let k = 0; k < path.length - 1; k++) {
    edges.push({ a: hubs[path[k]], b: hubs[path[k + 1]], weight: 0.5, width: 1.3, pulse: 1, phase: -k, period: path.length + 1.5, bend: 0.16 });
  }
  edges.push({ a: hubs[1], b: hubs[3], weight: 0.28, width: 1, flicker: 1, bend: -0.1 });
  // Cross-cluster bridges between satellites.
  for (let k = 0; k < 7; k++) {
    const ca = Math.floor(r() * 5), cb = (ca + 1 + Math.floor(r() * 4)) % 5;
    const a = members[ca][Math.floor(r() * members[ca].length)];
    const b = members[cb][Math.floor(r() * members[cb].length)];
    edges.push({ a, b, weight: 0.3, width: 1, flicker: 1, bend: 0.22, pulse: 0.5, phase: r() * 4, period: 4 + r() * 3 });
  }
  return {
    slots, edges,
    labels: [
      { slot: hubs[0], text: 'intent', pos: 'l', strong: true },
      { slot: hubs[1], text: 'knowledge', pos: 't', strong: true },
      { slot: hubs[2], text: 'retrieval', pos: 'r', strong: true },
      { slot: hubs[3], text: 'evaluation', pos: 'b', strong: true },
      { slot: hubs[4], text: 'fallback', pos: 'b', strong: true },
    ],
  };
}

// ---------------------------------------------------------------- state 4: platform (canonical model + adapters)
function platformSlots(): StateSpec {
  const slots: Slot[] = [];
  const edges: EdgeSpec[] = [];
  const add = (s: Slot) => (slots.push(s), slots.length - 1);
  const per = 7.5;
  const flow = (a: number, b: number, depth: number, extra: Partial<EdgeSpec> = {}) =>
    edges.push({ a, b, weight: 0.5, width: 1.25, pulse: 1, phase: -depth, period: per, ...extra });

  // Canonical model core.
  const center = add({ x: 0, y: 0, w: 0.075, round: 1, fill: 1, glow: 1.6, inten: 1, col: COL.copper });
  const ring = (n: number, rad: number, w: number, col: RGB, inten: number, off = 0) => {
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * Math.PI * 2;
      ids.push(add({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, w, round: 1, fill: 1, glow: 0.6, inten, col }));
    }
    return ids;
  };
  const r1 = ring(6, 0.13, 0.024, COL.copper, 1, Math.PI / 6);
  const r2 = ring(12, 0.25, 0.018, COL.cream, 0.9);
  const others = 21;
  const r3 = ring(N - 1 - 6 - 12 - others, 0.37, 0.014, COL.copper, 0.75, 0.05);
  const loop = (ids: number[], w: number) => ids.forEach((id, k) => edges.push({ a: id, b: ids[(k + 1) % ids.length], weight: w, width: 1, bend: 0.06 }));
  loop(r1, 0.5); loop(r2, 0.3); loop(r3, 0.22);
  r1.forEach((id, k) => {
    edges.push({ a: center, b: id, weight: 0.45, width: 1, pulse: 0.6, phase: k * 0.4, period: 2.8 });
    edges.push({ a: id, b: r2[(k * 2) % 12], weight: 0.3, width: 1 });
    edges.push({ a: id, b: r2[(k * 2 + 1) % 12], weight: 0.3, width: 1 });
  });
  const nearestR3 = (ang: number) => {
    let best = r3[0], bd = 1e9;
    for (const id of r3) {
      const a = Math.atan2(slots[id].y, slots[id].x);
      const d = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)));
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  };

  // Sources -> adapters.
  const adapter = (y: number) => add({ x: -0.86, y, w: 0.22, h: 0.11, round: 0.35, fill: 0.08, glow: 0.3, inten: 1, col: COL.cream });
  const boomi = adapter(0.34), celigo = adapter(-0.34);
  const procY = [[0.68, 0.52, 0.36, 0.2], [-0.2, -0.36, -0.52, -0.68]];
  [boomi, celigo].forEach((ad, k) => {
    for (const y of procY[k]) {
      const p = add({ x: -1.36, y, w: 0.022, round: 1, fill: 1, glow: 0.4, inten: 0.8, col: COL.dim });
      flow(p, ad, 0, { weight: 0.35, width: 1 });
    }
  });
  flow(boomi, nearestR3(Math.PI * 0.82), 1, { bend: -0.08 });
  flow(celigo, nearestR3(-Math.PI * 0.82), 1, { bend: 0.08 });

  // Canonical -> target planner -> generator -> Workato recipes.
  const planner = add({ x: 0.66, y: 0, w: 0.2, h: 0.11, round: 0.35, fill: 0.08, glow: 0.3, inten: 1, col: COL.cream });
  const gen = add({ x: 1.0, y: 0, w: 0.2, h: 0.11, round: 0.35, fill: 0.08, glow: 0.3, inten: 1, col: COL.cream });
  flow(nearestR3(0), planner, 2);
  flow(planner, gen, 3);
  const recY = [0.55, 0.33, 0.11, -0.11, -0.33, -0.55];
  const recipes = recY.map((y) => {
    const id = add({ x: 1.38, y, w: 0.055, h: 0.055, round: 0.3, fill: 0.12, glow: 0.5, inten: 1, col: COL.patina });
    flow(gen, id, 4, { mode: MODE_VH, weight: 0.4 });
    return id;
  });

  // A finding is visible, never a silent drop. Revision store below. LLM proposes, dashed.
  const finding = add({ x: 0.5, y: -0.6, w: 0.036, round: 1, fill: 1, glow: 1.4, inten: 1, col: COL.copper });
  flow(nearestR3(-Math.PI * 0.2), finding, 2, { weight: 0.5, dash: 1 });
  const rev = add({ x: -0.52, y: -0.7, w: 0.2, h: 0.08, round: 0.4, fill: 0.06, glow: 0.2, inten: 0.9, col: COL.dim });
  edges.push({ a: center, b: rev, weight: 0.32, width: 1, bend: 0.1, pulse: 0.5, phase: 0, period: 4 });
  const llm = add({ x: 0.0, y: 0.7, w: 0.045, round: 1, fill: 1, glow: 1.4, inten: 1, col: COL.patina });
  edges.push({ a: llm, b: nearestR3(Math.PI / 2), weight: 0.55, width: 1.1, dash: 1, flicker: 0.6 });

  if (slots.length !== N) throw new Error(`platform slots ${slots.length}`);
  return {
    slots, edges,
    labels: [
      { slot: boomi, text: 'Boomi', pos: 't', strong: true },
      { slot: celigo, text: 'Celigo', pos: 'b', strong: true },
      { slot: nearestR3(-Math.PI / 2), text: 'canonical model\n53 entity types', pos: 'b', strong: true },
      { slot: planner, text: 'planner', pos: 't' },
      { slot: gen, text: 'generator', pos: 'b' },
      { slot: recipes[0], text: 'Workato', pos: 't', strong: true },
      { slot: finding, text: 'finding', pos: 'r' },
      { slot: rev, text: 'revision store', pos: 'b' },
      { slot: llm, text: 'LLM · proposes', pos: 'r' },
    ],
  };
}

// ---------------------------------------------------------------- assembly
export function build(): Built {
  const specs: StateSpec[] = [heroSlots(1, 1, 3), rulesSlots(), workflowSlots(), aiSlots(), platformSlots(), heroSlots(1.65, 0.42, 3)];
  const nodes = new Float32Array(S * N * NODE_STRIDE);
  const labels: Label[] = [];
  const edgeIndex = new Map<string, number>();
  const ea: number[] = [], eb: number[] = [];
  const edgeRows: Float32Array[] = [];

  let prev = new Float32Array(N * 3);
  for (let s = 0; s < S; s++) {
    const spec = specs[s];
    const M = spec.slots.length;
    const nodeOfSlot = new Int32Array(M).fill(-1);
    const slotOfNode = new Int32Array(N).fill(-1);
    if (s === 0) {
      for (let i = 0; i < M; i++) { nodeOfSlot[i] = i; slotOfNode[i] = i; }
    } else {
      // Greedy nearest matching of visible slots to nodes.
      const pairs: [number, number, number][] = [];
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
          const sl = spec.slots[j];
          // Invisible helper slots are matched last.
          const pen = sl.inten === 0 ? 100 : 0;
          pairs.push([i, j, pen + (prev[i * 3] - sl.x) ** 2 + (prev[i * 3 + 1] - sl.y) ** 2 + 0.3 * (prev[i * 3 + 2] - (sl.z ?? 0)) ** 2]);
        }
      }
      pairs.sort((p, q) => p[2] - q[2]);
      for (const [i, j] of pairs) {
        if (slotOfNode[i] >= 0 || nodeOfSlot[j] >= 0) continue;
        slotOfNode[i] = j; nodeOfSlot[j] = i;
      }
    }
    const base = s * N * NODE_STRIDE;
    const write = (i: number, sl: Slot, park: boolean) => {
      const o = base + i * NODE_STRIDE;
      nodes[o + NX] = sl.x; nodes[o + NY] = sl.y; nodes[o + NZ] = sl.z ?? 0;
      nodes[o + NW] = park ? 0 : sl.w; nodes[o + NH] = park ? 0 : sl.h ?? sl.w;
      nodes[o + NROUND] = sl.round ?? 1; nodes[o + NROT] = sl.rot ?? 0;
      nodes[o + NFILL] = sl.fill ?? 1; nodes[o + NGLOW] = park ? 0 : sl.glow ?? 0.5;
      nodes[o + NINT] = park ? 0 : sl.inten ?? 1;
      nodes[o + NR] = sl.col[0]; nodes[o + NG] = sl.col[1]; nodes[o + NB] = sl.col[2];
    };
    for (let i = 0; i < N; i++) {
      const j = slotOfNode[i];
      if (j >= 0) { write(i, spec.slots[j], false); continue; }
      // Park inside the nearest visible slot.
      let best = 0, bd = 1e9;
      for (let k = 0; k < M; k++) {
        const sl = spec.slots[k];
        if (sl.inten === 0 || sl.w === 0) continue;
        const d = (prev[i * 3] - sl.x) ** 2 + (prev[i * 3 + 1] - sl.y) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      write(i, spec.slots[best], true);
    }
    const next = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const o = base + i * NODE_STRIDE;
      next[i * 3] = nodes[o + NX]; next[i * 3 + 1] = nodes[o + NY]; next[i * 3 + 2] = nodes[o + NZ];
    }
    prev = next;

    for (const e of spec.edges) {
      const a = nodeOfSlot[e.a], b = nodeOfSlot[e.b];
      if (a < 0 || b < 0) continue;
      const key = `${a}>${b}`;
      let idx = edgeIndex.get(key);
      if (idx === undefined) {
        idx = ea.length;
        edgeIndex.set(key, idx);
        ea.push(a); eb.push(b);
        edgeRows.push(new Float32Array(S * EDGE_STRIDE));
      }
      const row = edgeRows[idx];
      const o = s * EDGE_STRIDE;
      row[o + EW] = e.weight ?? 0.4;
      row[o + EPULSE] = e.pulse ?? 0;
      row[o + EMODE] = e.mode ?? MODE_LINE;
      row[o + EBEND] = e.bend ?? 0;
      row[o + EWIDTH] = e.width ?? 1;
      row[o + EFLICK] = e.flicker ?? 0;
      row[o + EDASH] = e.dash ?? 0;
      row[o + EPHASE] = e.phase ?? 0;
      row[o + EPERIOD] = e.period ?? 0;
    }
    for (const l of spec.labels) labels.push({ node: nodeOfSlot[l.slot], state: s, text: l.text, pos: l.pos, strong: !!l.strong });
  }

  // Edges that don't exist in a state keep that state's mode = the neighbour's, so curves don't snap.
  const E = ea.length;
  const edges = new Float32Array(E * S * EDGE_STRIDE);
  for (let e = 0; e < E; e++) {
    const row = edgeRows[e];
    for (let s = 0; s < S; s++) {
      const o = s * EDGE_STRIDE;
      if (row[o + EW] === 0) {
        // Borrow geometry from nearest state where the edge exists.
        for (let d = 1; d < S; d++) {
          const c = [s - d, s + d].find((t) => t >= 0 && t < S && row[t * EDGE_STRIDE + EW] > 0);
          if (c !== undefined) {
            const oc = c * EDGE_STRIDE;
            row[o + EMODE] = row[oc + EMODE]; row[o + EBEND] = row[oc + EBEND]; row[o + EWIDTH] = row[oc + EWIDTH];
            row[o + EDASH] = row[oc + EDASH]; row[o + EPHASE] = row[oc + EPHASE]; row[o + EPERIOD] = row[oc + EPERIOD];
            break;
          }
        }
      }
    }
    edges.set(row, e * S * EDGE_STRIDE);
  }

  const r = rng(91);
  const delay = new Float32Array(S * N);
  for (let s = 0; s < S - 1; s++) {
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < N; i++) { const x = nodes[((s + 1) * N + i) * NODE_STRIDE + NX]; mn = Math.min(mn, x); mx = Math.max(mx, x); }
    for (let i = 0; i < N; i++) {
      const x = nodes[((s + 1) * N + i) * NODE_STRIDE + NX];
      delay[s * N + i] = ((x - mn) / (mx - mn || 1)) * 0.32 + r() * 0.08;
    }
  }
  const arc = new Float32Array(N);
  const phase = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    arc[i] = (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.16);
    phase[i * 3] = r() * 6.283; phase[i * 3 + 1] = r() * 6.283; phase[i * 3 + 2] = 0.6 + r() * 0.8;
  }
  const edgeSeed = new Float32Array(E);
  for (let e = 0; e < E; e++) edgeSeed[e] = r();

  return { nodes, edgeA: Uint16Array.from(ea), edgeB: Uint16Array.from(eb), edgeCount: E, edges, edgeSeed, delay, arc, phase, labels };
}
