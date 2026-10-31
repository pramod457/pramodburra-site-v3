// Per-frame interpolation of the system between states. All buffers are preallocated; no per-frame allocation.
import {
  N, S, NODE_STRIDE, EDGE_STRIDE, NX, NY, NZ, NW, NH, NROUND, NROT, NFILL, NGLOW, NINT, NR, NG, NB,
  EW, EPULSE, EMODE, EBEND, EWIDTH, EFLICK, EDASH, EPHASE, EPERIOD, MODE_HV, MODE_VH, type Built,
} from './layouts';

// GPU instance layouts.
export const NODE_INST = 13; // pos3, w,h,round,rot, fill,glow,inten, rgb
export const EDGE_INST = 20; // A3, C3, B3, alpha, pulse, phase, period, width, t0, t1, dash, rgb

// How much each state drifts and responds to the cursor.
const DRIFT = [0.035, 0.0, 0.0, 0.02, 0.006, 0.05];
const REPEL = [1, 0.15, 0.1, 0.5, 0.25, 0.6];
const SPIN = [1, 0, 0, 0, 0, 1];

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export class LivingSystem {
  readonly nodeData = new Float32Array(N * NODE_INST);
  readonly edgeData: Float32Array;
  readonly pos = new Float32Array(N * 3); // current world positions (for labels)
  readonly vis = new Float32Array(N);     // current visibility 0..1
  private readonly u = new Float32Array(N);
  readonly edgeCount: number;

  constructor(private readonly b: Built) {
    this.edgeCount = b.edgeCount;
    this.edgeData = new Float32Array(b.edgeCount * EDGE_INST);
  }

  /**
   * @param s     state float 0..S-1
   * @param time  seconds (frozen under reduced motion)
   * @param cx,cy cursor in world units on z=0 (or NaN when absent)
   */
  update(s: number, time: number, cx: number, cy: number, motion: number) {
    const b = this.b;
    const k = Math.min(Math.floor(s), S - 2);
    const u = clamp01(s - k);
    const A = k * N * NODE_STRIDE, B = (k + 1) * N * NODE_STRIDE;
    const nodes = b.nodes;
    const out = this.nodeData;

    const spinA = SPIN[k] * time * 0.045, spinB = SPIN[k + 1] * time * 0.045;
    const caA = Math.cos(spinA), saA = Math.sin(spinA), caB = Math.cos(spinB), saB = Math.sin(spinB);

    for (let i = 0; i < N; i++) {
      const d = b.delay[k * N + i];
      const ui = smooth(clamp01((u - d) / 0.6));
      this.u[i] = ui;
      const oa = A + i * NODE_STRIDE, ob = B + i * NODE_STRIDE;

      // Spin hero-like states around Y.
      let ax = nodes[oa + NX], ay = nodes[oa + NY], az = nodes[oa + NZ];
      if (SPIN[k]) { const x = ax * caA + az * saA; az = -ax * saA + az * caA; ax = x; }
      let bx = nodes[ob + NX], by = nodes[ob + NY], bz = nodes[ob + NZ];
      if (SPIN[k + 1]) { const x = bx * caB + bz * saB; bz = -bx * saB + bz * caB; bx = x; }

      let x = ax + (bx - ax) * ui, y = ay + (by - ay) * ui, z = az + (bz - az) * ui;
      // Curved trajectories: push sideways and towards the viewer mid-flight.
      const arcT = Math.sin(Math.PI * ui) * b.arc[i];
      x += -(by - ay) * arcT; y += (bx - ax) * arcT; z += Math.abs(arcT) * 1.4;

      const drift = (DRIFT[k] + (DRIFT[k + 1] - DRIFT[k]) * ui) * motion;
      if (drift > 0) {
        const p0 = b.phase[i * 3], p1 = b.phase[i * 3 + 1], sp = b.phase[i * 3 + 2];
        x += Math.sin(time * 0.5 * sp + p0) * drift;
        y += Math.cos(time * 0.43 * sp + p1) * drift;
        z += Math.sin(time * 0.37 * sp + p1 + p0) * drift;
      }
      const rep = REPEL[k] + (REPEL[k + 1] - REPEL[k]) * ui;
      if (rep > 0 && cx === cx) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        const f = rep * 0.075 * Math.exp(-d2 / 0.09);
        const inv = 1 / Math.sqrt(d2 + 1e-4);
        x += dx * inv * f; y += dy * inv * f;
      }

      const o = i * NODE_INST;
      out[o] = x; out[o + 1] = y; out[o + 2] = z;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      out[o + 3] = nodes[oa + NW] + (nodes[ob + NW] - nodes[oa + NW]) * ui;
      out[o + 4] = nodes[oa + NH] + (nodes[ob + NH] - nodes[oa + NH]) * ui;
      out[o + 5] = nodes[oa + NROUND] + (nodes[ob + NROUND] - nodes[oa + NROUND]) * ui;
      out[o + 6] = nodes[oa + NROT] + (nodes[ob + NROT] - nodes[oa + NROT]) * ui;
      out[o + 7] = nodes[oa + NFILL] + (nodes[ob + NFILL] - nodes[oa + NFILL]) * ui;
      out[o + 8] = nodes[oa + NGLOW] + (nodes[ob + NGLOW] - nodes[oa + NGLOW]) * ui;
      const inten = nodes[oa + NINT] + (nodes[ob + NINT] - nodes[oa + NINT]) * ui;
      out[o + 9] = inten;
      out[o + 10] = nodes[oa + NR] + (nodes[ob + NR] - nodes[oa + NR]) * ui;
      out[o + 11] = nodes[oa + NG] + (nodes[ob + NG] - nodes[oa + NG]) * ui;
      out[o + 12] = nodes[oa + NB] + (nodes[ob + NB] - nodes[oa + NB]) * ui;
      this.vis[i] = Math.min(1, out[o + 3] * 40) * inten;
    }

    // Edges.
    const E = this.edgeCount, ed = b.edges, eo = this.edgeData;
    for (let e = 0; e < E; e++) {
      const ia = b.edgeA[e], ib = b.edgeB[e];
      const ue = (this.u[ia] + this.u[ib]) * 0.5;
      const ra = e * S * EDGE_STRIDE + k * EDGE_STRIDE, rb = ra + EDGE_STRIDE;
      let alpha = ed[ra + EW] + (ed[rb + EW] - ed[ra + EW]) * ue;
      const pulseA = ed[ra + EPULSE], pulseB = ed[rb + EPULSE];
      const pulse = pulseA + (pulseB - pulseA) * ue;
      const o = e * EDGE_INST;
      if (alpha < 0.004 && pulse < 0.004) { eo[o + 9] = 0; eo[o + 10] = 0; continue; }

      const flick = ed[ra + EFLICK] + (ed[rb + EFLICK] - ed[ra + EFLICK]) * ue;
      if (flick > 0) {
        const seed = b.edgeSeed[e];
        const w = 0.5 + 0.5 * Math.sin(time * (0.35 + seed * 0.4) + seed * 40);
        alpha *= 1 - flick * (1 - smooth(clamp01(w * 1.6 - 0.3)));
      }

      const pa = ia * NODE_INST, pb = ib * NODE_INST;
      const Ax = out[pa], Ay = out[pa + 1], Az = out[pa + 2];
      const Bx = out[pb], By = out[pb + 1], Bz = out[pb + 2];
      const dx = Bx - Ax, dy = By - Ay;
      const len = Math.sqrt(dx * dx + dy * dy) + 1e-5;

      // Control point per state, blended.
      let cxA = 0, cyA = 0, cxB = 0, cyB = 0;
      for (let side = 0; side < 2; side++) {
        const r = side === 0 ? ra : rb;
        const mode = ed[r + EMODE], bend = ed[r + EBEND];
        let px: number, py: number;
        if (mode === MODE_HV) { px = Bx; py = Ay; }
        else if (mode === MODE_VH) { px = Ax; py = By; }
        else { px = (Ax + Bx) * 0.5 - dy * bend; py = (Ay + By) * 0.5 + dx * bend; }
        if (side === 0) { cxA = px; cyA = py; } else { cxB = px; cyB = py; }
      }
      const Cx = cxA + (cxB - cxA) * ue, Cy = cyA + (cyB - cyA) * ue, Cz = (Az + Bz) * 0.5;

      // Trim at node boundaries, along the start/end tangents.
      const t0 = this.trim(pa, Cx - Ax, Cy - Ay) / len;
      const t1 = 1 - this.trim(pb, Cx - Bx, Cy - By) / len;
      if (t1 <= t0) { eo[o + 9] = 0; eo[o + 10] = 0; continue; }

      const useB = ue > 0.5;
      const rp = useB ? rb : ra;
      eo[o] = Ax; eo[o + 1] = Ay; eo[o + 2] = Az;
      eo[o + 3] = Cx; eo[o + 4] = Cy; eo[o + 5] = Cz;
      eo[o + 6] = Bx; eo[o + 7] = By; eo[o + 8] = Bz;
      eo[o + 9] = alpha;
      eo[o + 10] = pulse * motion;
      eo[o + 11] = ed[rp + EPHASE];
      eo[o + 12] = ed[rp + EPERIOD];
      eo[o + 13] = ed[ra + EWIDTH] + (ed[rb + EWIDTH] - ed[ra + EWIDTH]) * ue;
      eo[o + 14] = t0;
      eo[o + 15] = t1;
      eo[o + 16] = ed[ra + EDASH] + (ed[rb + EDASH] - ed[ra + EDASH]) * ue;
      eo[o + 17] = (out[pa + 10] + out[pb + 10]) * 0.5;
      eo[o + 18] = (out[pa + 11] + out[pb + 11]) * 0.5;
      eo[o + 19] = (out[pa + 12] + out[pb + 12]) * 0.5;
    }
  }

  /** Distance from a node's centre to its outline along direction (dx,dy), plus a small gap. */
  private trim(o: number, dx: number, dy: number) {
    const nd = this.nodeData;
    const hw = nd[o + 3] * 0.5, hh = nd[o + 4] * 0.5;
    if (hw <= 0) return 0;
    const l = Math.sqrt(dx * dx + dy * dy) + 1e-6;
    const ux = Math.abs(dx / l), uy = Math.abs(dy / l);
    const box = Math.min(hw / (ux + 1e-6), hh / (uy + 1e-6));
    const dia = (hw * Math.SQRT2) / (ux + uy + 1e-6);
    const circ = Math.min(hw, hh);
    const rotT = Math.min(1, nd[o + 6] / (Math.PI / 4));
    const round = nd[o + 5];
    let t = box + (dia - box) * rotT;
    if (rotT < 0.5) t = t + (circ - t) * Math.max(0, round * round);
    return t + 0.014;
  }
}
