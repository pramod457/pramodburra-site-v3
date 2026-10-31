// The studio, built entirely from code. Static geometry is merged by material into a handful of meshes;
// each clickable object is its own merged mesh so it can glow and get an outline on hover.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SectionId } from './panels';
import {
  cityTexture,
  codeTexture,
  floorTexture,
  neonTexture,
  posterTexture,
  radialTexture,
  rng,
  rugTexture,
  screenTexture,
  windowLightTexture,
} from './textures';

// Room extents: floor x,z in [-R, R]; back wall at z=-R, left wall at x=-R.
export const R = 3;
const WALL_H = 3.2;
const WALL_T = 0.18;

// ---------------------------------------------------------------- helpers
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function mat(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

class Builder {
  parts: THREE.BufferGeometry[] = [];
  /** Adds a geometry baked with a transform and a flat vertex colour (with an optional subtle top-to-bottom shade). */
  add(geo: THREE.BufferGeometry, color: string | number, m: THREE.Matrix4, shade = 0.12): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g === geo) g = geo.clone();
    g.deleteAttribute('uv');
    g.applyMatrix4(m);
    const pos = g.getAttribute('position');
    g.computeBoundingBox();
    const bb = g.boundingBox as THREE.Box3;
    const span = Math.max(1e-4, bb.max.y - bb.min.y);
    const col = new Float32Array(pos.count * 3);
    _c.set(color);
    for (let i = 0; i < pos.count; i++) {
      // a gentle vertical gradient on every part reads like baked bounce light
      const k = 1 - shade + shade * ((pos.getY(i) - bb.min.y) / span);
      col[i * 3] = _c.r * k;
      col[i * 3 + 1] = _c.g * k;
      col[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    geo.dispose();
    return this;
  }
  box(w: number, h: number, d: number, color: string | number, m: THREE.Matrix4, r = 0.02, shade = 0.12) {
    const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, color, m, shade);
  }
  merge(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false) as THREE.BufferGeometry;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// Fake ambient occlusion: darken surfaces as they approach the floor and the two walls,
// unless they face away from that plane. Cheap, and gives the "baked" diorama look.
const AO_CHUNK = /* glsl */ `
  float roomPlaneAO(float d, float facing) {
    float a = 0.42 + 0.58 * smoothstep(0.0, 0.85, max(d, 0.0));
    return mix(a, 1.0, clamp(facing, 0.0, 1.0));
  }
  float roomAO(vec3 p, vec3 n) {
    return roomPlaneAO(p.y, n.y) * roomPlaneAO(p.z + ${R.toFixed(1)}, n.z) * roomPlaneAO(p.x + ${R.toFixed(1)}, n.x);
  }`;

export function patchAO(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoomPos;\nvarying vec3 vRoomNrm;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvRoomPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRoomNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRoomPos;\nvarying vec3 vRoomNrm;\n${AO_CHUNK}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= roomAO(vRoomPos, normalize(vRoomNrm));');
  };
  m.customProgramCacheKey = () => 'roomAO';
  return m;
}

const clay = () =>
  patchAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0 }));

// ---------------------------------------------------------------- palette
const C = {
  wall: '#46468a',
  wallLow: '#3a3a76',
  trim: '#c9b8d8',
  slab: '#2a2547',
  slabTop: '#8b6a5c',
  wood: '#b07b5c',
  woodDark: '#7a4f3e',
  woodLight: '#d39d72',
  charcoal: '#25263a',
  ink: '#1b1c2b',
  cream: '#f2e6d0',
  coral: '#e46b5a',
  plum: '#5b4a86',
  teal: '#3d8b8b',
  sand: '#e8b77e',
  leaf1: '#5aa36f',
  leaf2: '#3f8160',
  leaf3: '#7cbf7a',
  pot: '#c9775a',
  metal: '#9aa0b8',
};
const BOOKS = ['#e07a5f', '#f2cc8f', '#3d8b8b', '#81667a', '#f4f1de', '#3d405b', '#c75b4a', '#6d9dc5', '#d99a3e', '#4b4fa0', '#9c6b98'];

// ---------------------------------------------------------------- types
export type Hotspot = {
  id: SectionId;
  label: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  hull: THREE.Mesh;
  box: THREE.Box3;
  anchor: THREE.Vector3;
  /** camera position + look target when focused */
  view: { pos: THREE.Vector3; target: THREE.Vector3 };
  glow: number;
};

export type Room = {
  scene: THREE.Scene;
  hotspots: Hotspot[];
  uniforms: { uTime: { value: number }; uPixelRatio: { value: number }; uMotion: { value: number } };
  lamp: THREE.SpotLight;
};

// ---------------------------------------------------------------- builders per object
function plantInto(b: Builder, x: number, y: number, z: number, scale: number, seed: number, potCol = C.pot) {
  const r = rng(seed);
  b.add(new THREE.CylinderGeometry(0.16 * scale, 0.12 * scale, 0.28 * scale, 14), potCol, mat(x, y + 0.14 * scale, z));
  b.add(new THREE.CylinderGeometry(0.165 * scale, 0.165 * scale, 0.04 * scale, 14), potCol, mat(x, y + 0.27 * scale, z), 0);
  b.add(new THREE.CylinderGeometry(0.14 * scale, 0.14 * scale, 0.02 * scale, 14), '#4a3428', mat(x, y + 0.275 * scale, z), 0);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const tilt = 0.35 + r() * 0.45;
    const len = (0.35 + r() * 0.35) * scale;
    const lx = x + Math.cos(a) * Math.sin(tilt) * len * 0.6;
    const lz = z + Math.sin(a) * Math.sin(tilt) * len * 0.6;
    const ly = y + 0.28 * scale + Math.cos(tilt) * len * 0.75;
    const leaf = new THREE.IcosahedronGeometry(0.11 * scale, 0);
    const col = [C.leaf1, C.leaf2, C.leaf3][i % 3];
    b.add(leaf, col, mat(lx, ly, lz, tilt * Math.sin(a), a, tilt * Math.cos(a), 0.9, 1.9, 0.55), 0.3);
  }
  const top = new THREE.IcosahedronGeometry(0.12 * scale, 0);
  b.add(top, C.leaf3, mat(x, y + 0.28 * scale + 0.42 * scale, z, 0.2, 0.4, 0, 0.8, 1.6, 0.8), 0.3);
}

function buildShell(b: Builder) {
  // slab under the floor (floor surface itself is a textured plane)
  b.box(2 * R + WALL_T, 0.32, 2 * R + WALL_T, C.slab, mat(-WALL_T / 2, -0.16, -WALL_T / 2), 0.06, 0.25);
  b.box(2 * R + WALL_T + 0.02, 0.04, 2 * R + WALL_T + 0.02, C.slabTop, mat(-WALL_T / 2, -0.02, -WALL_T / 2), 0.02, 0);

  // back wall with a window opening: x in [wx0, wx1], y in [wy0, wy1]
  const wx0 = -2.55;
  const wx1 = -0.95;
  const wy0 = 1.0;
  const wy1 = 2.55;
  const zc = -R - WALL_T / 2;
  const seg = (x0: number, x1: number, y0: number, y1: number, col: string) =>
    b.box(x1 - x0, y1 - y0, WALL_T, col, mat((x0 + x1) / 2, (y0 + y1) / 2, zc), 0, 0.08);
  const xl = -R - WALL_T;
  seg(xl, wx0, 0, WALL_H, C.wall);
  seg(wx1, R, 0, WALL_H, C.wall);
  seg(wx0, wx1, 0, wy0, C.wall);
  seg(wx0, wx1, wy1, WALL_H, C.wall);
  // left wall
  b.box(WALL_T, WALL_H, 2 * R, C.wall, mat(-R - WALL_T / 2, WALL_H / 2, 0), 0, 0.08);
  // wall caps (light edge reads as a cut-away diorama)
  b.box(WALL_T + 0.02, 0.04, 2 * R + WALL_T + 0.02, C.trim, mat(-R - WALL_T / 2, WALL_H + 0.02, -WALL_T / 2), 0.01, 0);
  b.box(2 * R + 0.02, 0.04, WALL_T + 0.02, C.trim, mat(0.01, WALL_H + 0.02, zc), 0.01, 0);
  // wainscot rail + skirting
  b.box(2 * R, 0.035, 0.03, C.trim, mat(0, 0.95, -R + 0.015), 0.01, 0);
  b.box(0.03, 0.035, 2 * R, C.trim, mat(-R + 0.015, 0.95, 0), 0.01, 0);
  b.box(2 * R, 0.09, 0.025, C.trim, mat(0, 0.045, -R + 0.0125), 0.01, 0);
  b.box(0.025, 0.09, 2 * R, C.trim, mat(-R + 0.0125, 0.045, 0), 0.01, 0);
  // lower wall panels slightly darker
  b.box(2 * R, 0.86, 0.008, C.wallLow, mat(0, 0.5, -R + 0.004), 0, 0.1);
  b.box(0.008, 0.86, 2 * R, C.wallLow, mat(-R + 0.004, 0.5, 0), 0, 0.1);

  // window frame
  const fz = -R + 0.02;
  const ft = 0.07;
  b.box(wx1 - wx0 + ft * 2, ft, 0.12, C.cream, mat((wx0 + wx1) / 2, wy1 + ft / 2, fz), 0.015);
  b.box(wx1 - wx0 + ft * 2 + 0.16, 0.06, 0.26, C.cream, mat((wx0 + wx1) / 2, wy0 - 0.03, -R + 0.08), 0.02); // sill
  b.box(ft, wy1 - wy0, 0.12, C.cream, mat(wx0 - ft / 2, (wy0 + wy1) / 2, fz), 0.015);
  b.box(ft, wy1 - wy0, 0.12, C.cream, mat(wx1 + ft / 2, (wy0 + wy1) / 2, fz), 0.015);
  b.box(0.04, wy1 - wy0, 0.05, C.cream, mat((wx0 + wx1) / 2, (wy0 + wy1) / 2, -R - 0.05), 0.01);
  b.box(wx1 - wx0, 0.04, 0.05, C.cream, mat((wx0 + wx1) / 2, (wy0 + wy1) / 2 + 0.1, -R - 0.05), 0.01);
  // window reveal (inner sides of the opening)
  b.box(wx1 - wx0, 0.01, WALL_T, '#2c2b5c', mat((wx0 + wx1) / 2, wy1 - 0.005, zc), 0, 0);
  b.box(0.01, wy1 - wy0, WALL_T, '#2c2b5c', mat(wx0 + 0.005, (wy0 + wy1) / 2, zc), 0, 0);
  b.box(0.01, wy1 - wy0, WALL_T, '#2c2b5c', mat(wx1 - 0.005, (wy0 + wy1) / 2, zc), 0, 0);

  // curtains: soft folds from stretched capsules
  const curtain = (x0: number, dir: number) => {
    for (let i = 0; i < 4; i++) {
      const cap = new THREE.CapsuleGeometry(0.06, 2.1, 3, 8);
      b.add(cap, i % 2 ? '#b9a6d9' : '#a893cf', mat(x0 + dir * i * 0.075, 1.68, -R + 0.13 + (i % 2) * 0.02, 0, 0, dir * 0.015 * i, 1, 1, 0.7), 0.35);
    }
  };
  curtain(wx0 - 0.12, -1);
  curtain(wx1 + 0.12, 1);
  b.box(wx1 - wx0 + 1.0, 0.03, 0.03, C.metal, mat((wx0 + wx1) / 2, 2.82, -R + 0.13), 0.01, 0);

  // sill plants
  plantInto(b, -2.25, wy0, -R + 0.1, 0.55, 4, '#e0c9a8');
  b.add(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 10), '#6d9dc5', mat(-1.35, wy0 + 0.08, -R + 0.1));
  b.add(new THREE.IcosahedronGeometry(0.07, 0), C.leaf1, mat(-1.35, wy0 + 0.2, -R + 0.1, 0, 0, 0, 1, 1.4, 1), 0.3);

  return { wx0, wx1, wy0, wy1 };
}

function buildDesk(b: Builder) {
  const top = 0.76;
  const x0 = -0.25;
  const x1 = 2.45;
  const zc = -2.53;
  const depth = 0.78;
  b.box(x1 - x0, 0.06, depth, C.woodLight, mat((x0 + x1) / 2, top - 0.03, zc), 0.02);
  // drawer unit (left)
  b.box(0.48, top - 0.06, depth - 0.06, C.wood, mat(x0 + 0.27, (top - 0.06) / 2, zc), 0.02);
  for (let i = 0; i < 3; i++) {
    const y = 0.14 + i * 0.22;
    b.box(0.44, 0.19, 0.02, C.woodLight, mat(x0 + 0.27, y, zc + depth / 2 - 0.02), 0.01);
    b.box(0.12, 0.018, 0.025, C.metal, mat(x0 + 0.27, y + 0.04, zc + depth / 2 + 0.005), 0.008, 0);
  }
  // legs right
  for (const dz of [-0.3, 0.3]) b.box(0.05, top - 0.06, 0.05, C.woodDark, mat(x1 - 0.08, (top - 0.06) / 2, zc + dz), 0.015);
  b.box(0.05, 0.05, 0.6, C.woodDark, mat(x1 - 0.08, 0.12, zc), 0.015);

  // keyboard + keys, mouse, mousepad
  b.box(1.0, 0.008, 0.42, '#2d2e48', mat(1.0, top + 0.004, -2.28), 0.004, 0);
  b.box(0.52, 0.022, 0.17, '#e9e3ef', mat(0.92, top + 0.019, -2.28), 0.01, 0.2);
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 13; k++)
      b.box(0.03, 0.012, 0.03, r === 3 && k > 3 && k < 9 ? '#cfc6dc' : '#fbf8ff', mat(0.92 - 0.225 + k * 0.0375, top + 0.034, -2.28 - 0.056 + r * 0.0375), 0, 0);
  b.add(new THREE.CapsuleGeometry(0.028, 0.05, 4, 10), '#fbf8ff', mat(1.36, top + 0.025, -2.25, Math.PI / 2, 0, 0, 1, 1, 0.6), 0.3);

  // mug with handle
  b.add(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 16), C.coral, mat(0.18, top + 0.06, -2.3));
  b.add(new THREE.TorusGeometry(0.035, 0.012, 6, 12), C.coral, mat(0.24, top + 0.065, -2.3, 0, 0, 0));
  b.add(new THREE.CylinderGeometry(0.048, 0.048, 0.005, 16), '#3b2219', mat(0.18, top + 0.11, -2.3), 0);

  // notebook + pen
  b.box(0.22, 0.02, 0.3, '#3d405b', mat(1.75, top + 0.01, -2.27, 0, 0.25, 0), 0.008);
  b.box(0.2, 0.005, 0.28, C.cream, mat(1.75, top + 0.022, -2.27, 0, 0.25, 0), 0.002, 0);
  b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), '#e8b77e', mat(1.84, top + 0.03, -2.25, Math.PI / 2, 0, 0.9), 0);

  // desk plant + books stack on desk
  plantInto(b, 0.02, top, -2.75, 0.5, 9, '#e9e3ef');
  b.box(0.26, 0.05, 0.18, '#c75b4a', mat(2.2, top + 0.025, -2.3, 0, -0.2, 0), 0.008);
  b.box(0.24, 0.045, 0.17, '#f2cc8f', mat(2.21, top + 0.07, -2.3, 0, -0.05, 0), 0.008);

  // desk lamp (amber) – base, two arms, head
  const lb = new THREE.Vector3(2.2, top, -2.72);
  b.add(new THREE.CylinderGeometry(0.1, 0.11, 0.035, 20), C.ink, mat(lb.x, lb.y + 0.018, lb.z));
  b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8), '#e8b77e', mat(lb.x - 0.04, lb.y + 0.26, lb.z + 0.03, 0.12, 0, 0.18), 0);
  b.add(new THREE.SphereGeometry(0.025, 10, 8), C.ink, mat(lb.x - 0.085, lb.y + 0.5, lb.z + 0.06));
  b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), '#e8b77e', mat(lb.x - 0.27, lb.y + 0.59, lb.z + 0.12, 0.35, 0, 1.15), 0);
  const head = new THREE.Vector3(lb.x - 0.46, lb.y + 0.66, lb.z + 0.2);
  b.add(new THREE.CylinderGeometry(0.045, 0.11, 0.16, 20, 1, true), C.ink, mat(head.x, head.y, head.z, 0.25, 0, -0.45), 0);
  b.add(new THREE.SphereGeometry(0.046, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), C.ink, mat(head.x - 0.035, head.y + 0.075, head.z - 0.02, 0.25, 0, -0.45));
  return { top, head };
}

function buildChair(b: Builder) {
  const x = 1.0;
  const z = -1.72;
  const ry = 0.18;
  const col = '#5b4a86';
  const base = '#23243a';
  b.box(0.54, 0.09, 0.5, col, mat(x, 0.5, z, 0, ry, 0), 0.04, 0.3);
  b.box(0.5, 0.62, 0.08, col, mat(x + Math.sin(ry) * 0.25, 0.92, z + Math.cos(ry) * 0.25, -0.08, ry, 0), 0.04, 0.25);
  b.box(0.06, 0.24, 0.04, base, mat(x + Math.sin(ry) * 0.25, 0.6, z + Math.cos(ry) * 0.27, 0, ry, 0), 0.015);
  for (const s of [-1, 1]) {
    const ax = x + Math.cos(ry) * 0.29 * s;
    const az = z - Math.sin(ry) * 0.29 * s;
    b.box(0.05, 0.035, 0.32, base, mat(ax, 0.7, az, 0, ry, 0), 0.015);
    b.box(0.03, 0.18, 0.03, base, mat(ax, 0.6, az + 0.05, 0, ry, 0), 0.01);
  }
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 10), C.metal, mat(x, 0.29, z), 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    b.box(0.3, 0.035, 0.05, base, mat(x + Math.cos(a) * 0.15, 0.09, z - Math.sin(a) * 0.15, 0, a, 0), 0.015, 0);
    b.add(new THREE.SphereGeometry(0.03, 8, 6), base, mat(x + Math.cos(a) * 0.29, 0.03, z - Math.sin(a) * 0.29));
  }
}

function buildMonitors(b: Builder, top: number) {
  // main monitor
  const mx = 0.95;
  const my = top + 0.46;
  const mz = -2.72;
  b.box(1.06, 0.62, 0.035, C.ink, mat(mx, my, mz), 0.02);
  b.box(0.5, 0.3, 0.03, '#2a2b40', mat(mx, my, mz - 0.03), 0.02);
  b.box(0.05, 0.36, 0.04, '#3a3b52', mat(mx, top + 0.18, mz - 0.06), 0.015);
  b.box(0.3, 0.018, 0.2, '#3a3b52', mat(mx, top + 0.009, mz - 0.02), 0.009);
  // portrait monitor, angled toward the chair
  const px = 1.86;
  const py = top + 0.43;
  const pz = -2.66;
  const pr = -0.42;
  b.box(0.42, 0.68, 0.035, C.ink, mat(px, py, pz, 0, pr, 0), 0.02);
  b.box(0.05, 0.3, 0.04, '#3a3b52', mat(px + 0.02, top + 0.15, pz - 0.05, 0, pr, 0), 0.015);
  b.box(0.24, 0.018, 0.18, '#3a3b52', mat(px + 0.02, top + 0.009, pz - 0.03, 0, pr, 0), 0.009);
  return {
    main: { x: mx, y: my, z: mz + 0.019, w: 1.0, h: 0.565 },
    side: { x: px + Math.sin(pr) * 0.019, y: py, z: pz + Math.cos(pr) * 0.019, w: 0.38, h: 0.62, ry: pr },
  };
}

function buildBookshelf(b: Builder) {
  const x0 = -R;
  const d = 0.38;
  const xc = x0 + d / 2;
  const z0 = -2.55;
  const z1 = -1.0;
  const h = 2.12;
  const zc = (z0 + z1) / 2;
  const wcol = C.woodDark;
  b.box(d, 0.06, z1 - z0, wcol, mat(xc, h - 0.03, zc), 0.015);
  b.box(d, 0.08, z1 - z0, wcol, mat(xc, 0.04, zc), 0.015);
  b.box(d, h, 0.05, wcol, mat(xc, h / 2, z0 + 0.025), 0.015);
  b.box(d, h, 0.05, wcol, mat(xc, h / 2, z1 - 0.025), 0.015);
  b.box(0.02, h, z1 - z0, '#5c3b30', mat(x0 + 0.01, h / 2, zc), 0, 0.2);
  const shelves = [0.08, 0.58, 1.08, 1.58];
  for (const y of shelves.slice(1)) b.box(d - 0.02, 0.035, z1 - z0 - 0.1, C.wood, mat(xc, y, zc), 0.01, 0);
  const r = rng(42);
  shelves.forEach((sy, si) => {
    let z = z0 + 0.07;
    const end = z1 - 0.07;
    while (z < end - 0.05) {
      const roll = r();
      if (roll < 0.08 && si !== 1) {
        // horizontal stack
        const n = 2 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const bh = 0.04 + r() * 0.02;
          b.box(0.26, bh, 0.2, BOOKS[Math.floor(r() * BOOKS.length)], mat(xc + 0.02, sy + 0.02 + k * 0.05 + bh / 2, z + 0.11, 0, r() * 0.2, 0), 0.006, 0.05);
        }
        z += 0.26;
        continue;
      }
      if (roll < 0.14) {
        z += 0.06 + r() * 0.08; // gap
        continue;
      }
      const t = 0.035 + r() * 0.05;
      const bh = 0.27 + r() * 0.15;
      const bd = 0.22 + r() * 0.08;
      const lean = r() < 0.08 ? 0.18 : 0;
      b.box(bd, bh, t, BOOKS[Math.floor(r() * BOOKS.length)], mat(xc + 0.03, sy + 0.018 + bh / 2, z + t / 2, lean, 0, 0), 0.006, 0.18);
      z += t + 0.004;
    }
  });
  // a few objects on shelves: globe, small plant
  b.add(new THREE.SphereGeometry(0.09, 16, 12), '#6d9dc5', mat(xc + 0.02, 1.58 + 0.2, z1 - 0.2));
  b.add(new THREE.CylinderGeometry(0.02, 0.05, 0.1, 10), '#e8b77e', mat(xc + 0.02, 1.58 + 0.07, z1 - 0.2), 0);
  plantInto(b, xc, h, -2.2, 0.55, 17, '#e9e3ef');
  // ivy trailing from the top plant
  for (let i = 0; i < 6; i++)
    b.add(new THREE.IcosahedronGeometry(0.05, 0), i % 2 ? C.leaf1 : C.leaf2, mat(xc + 0.2, h - 0.08 - i * 0.12, -2.2 + Math.sin(i) * 0.06, i, i, 0, 1, 0.7, 1), 0.2);
  return new THREE.Vector3(xc, 1.1, zc);
}

function buildRack(b: Builder) {
  const x0 = -R;
  const d = 0.5;
  const xc = x0 + d / 2 + 0.04;
  const zc = -0.3;
  const w = 0.58;
  const h = 1.18;
  const front = xc + d / 2;
  b.box(d, h, w, '#45486e', mat(xc, 0.06 + h / 2, zc), 0.03, 0.25);
  b.box(0.02, h - 0.08, w - 0.08, '#1d1e33', mat(front - 0.005, 0.06 + h / 2, zc), 0.005, 0); // dark recess
  for (const dz of [-0.22, 0.22]) for (const dx of [-0.18, 0.18]) b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 8), '#111', mat(xc + dx, 0.03, zc + dz));
  // rack units (front panels) – each unit is a slightly different box
  const units: [number, number, string][] = [
    [0.15, 0.1, '#5d6190'], // switch
    [0.27, 0.1, '#4a4d75'], // patch panel
    [0.42, 0.18, '#6a6ea0'], // node 1
    [0.63, 0.18, '#6a6ea0'], // node 2
    [0.84, 0.18, '#6a6ea0'], // node 3
    [1.06, 0.16, '#55598a'], // NAS
  ];
  for (const [y, uh, col] of units) {
    b.box(0.03, uh - 0.015, w - 0.1, col, mat(front + 0.005, y + 0.06, zc), 0.006, 0.3);
    if (uh > 0.15) {
      // vent slots
      for (let k = 0; k < 5; k++) b.box(0.005, uh * 0.5, 0.012, '#2a2c48', mat(front + 0.021, y + 0.06, zc - 0.05 + k * 0.03), 0, 0);
    }
  }
  // patch cables
  const cables = ['#5eeaff', '#ffd36b', '#e46b5a', '#62e6a6', '#7aa2ff', '#c792ea'];
  cables.forEach((col, i) => {
    b.box(0.02, 0.02, 0.025, col, mat(front + 0.025, 0.27 + 0.06, zc - 0.17 + i * 0.045), 0.004, 0);
    b.add(new THREE.TorusGeometry(0.05 + (i % 3) * 0.01, 0.006, 4, 12, Math.PI), col, mat(front + 0.035, 0.27 + 0.06 - 0.06, zc - 0.17 + i * 0.045 + 0.02, 0, Math.PI / 2, Math.PI), 0);
  });
  // router with antennas on top
  b.box(0.3, 0.05, 0.36, '#e9e3ef', mat(xc, 0.06 + h + 0.025, zc), 0.015, 0.1);
  for (const dz of [-0.12, 0.12]) b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 8), C.ink, mat(xc - 0.1, 0.06 + h + 0.16, zc + dz, dz * 1.2, 0, 0), 0);
  // LED anchor list
  const leds: { x: number; y: number; z: number; col: string; rate: number }[] = [];
  const lr = rng(5);
  const ledCols = ['#62e6a6', '#62e6a6', '#5eeaff', '#ffd36b'];
  for (const [y, uh] of units) {
    const n = uh > 0.15 ? 3 : 8;
    for (let k = 0; k < n; k++)
      leds.push({
        x: front + 0.022,
        y: y + 0.06 + (uh > 0.15 ? uh * 0.3 : 0.02),
        z: zc + 0.2 - k * (uh > 0.15 ? 0.03 : 0.03),
        col: ledCols[Math.floor(lr() * ledCols.length)],
        rate: 0.6 + lr() * 4,
      });
  }
  // router LEDs
  for (let k = 0; k < 4; k++) leds.push({ x: xc + 0.152, y: 0.06 + h + 0.025, z: zc - 0.06 + k * 0.04, col: '#62e6a6', rate: 1 + k });
  return { leds, center: new THREE.Vector3(xc, 0.7, zc) };
}

function buildCabinet(b: Builder) {
  const x0 = -R;
  const d = 0.46;
  const xc = x0 + d / 2;
  const z0 = 0.7;
  const z1 = 2.35;
  const zc = (z0 + z1) / 2;
  const top = 0.7;
  b.box(d, top - 0.12, z1 - z0, C.wood, mat(xc, 0.12 + (top - 0.12) / 2, zc), 0.025);
  b.box(d + 0.02, 0.035, z1 - z0 + 0.02, C.woodLight, mat(xc, top + 0.0, zc), 0.012, 0);
  for (const dz of [-0.7, 0.7]) for (const dx of [-0.15, 0.15]) b.add(new THREE.CylinderGeometry(0.018, 0.012, 0.12, 8), C.woodDark, mat(xc + dx, 0.06, zc + dz), 0);
  // three doors with slatted fronts
  for (let i = 0; i < 3; i++) {
    const dzc = z0 + 0.06 + (i + 0.5) * ((z1 - z0 - 0.12) / 3);
    b.box(0.02, top - 0.2, (z1 - z0 - 0.16) / 3, C.woodLight, mat(xc + d / 2, 0.12 + (top - 0.12) / 2, dzc), 0.008);
    for (let k = 0; k < 5; k++) b.box(0.006, top - 0.26, 0.012, C.wood, mat(xc + d / 2 + 0.012, 0.12 + (top - 0.12) / 2, dzc - 0.1 + k * 0.05), 0, 0);
  }
  // record player-ish speaker + cactus at the far end
  b.box(0.22, 0.32, 0.2, C.ink, mat(xc, top + 0.17, 2.12), 0.03);
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), '#3a3b52', mat(xc + 0.111, top + 0.22, 2.12, 0, 0, Math.PI / 2));
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16), '#3a3b52', mat(xc + 0.111, top + 0.08, 2.12, 0, 0, Math.PI / 2));
  // framed poster above cabinet: frame only (poster is a textured plane)
  b.box(0.04, 0.84, 0.66, C.cream, mat(-R + 0.02, 1.72, 1.55), 0.01, 0);
  return { top, xc, posterZ: 1.55, posterY: 1.72 };
}

function buildPhone(b: Builder, top: number) {
  const x = -R + 0.27;
  const z = 1.2;
  const y = top + 0.017;
  const red = '#ef6f5c';
  const red2 = '#e0604f';
  // base: square frustum (classic desk phone silhouette), slightly rounded via a lip
  b.add(new THREE.CylinderGeometry(0.15, 0.21, 0.15, 4, 1), red, mat(x, y + 0.075, z, 0, Math.PI / 4, 0, 1, 1, 1.15), 0.3);
  b.box(0.2, 0.025, 0.25, red2, mat(x, y + 0.155, z), 0.012, 0);
  b.box(0.3, 0.02, 0.34, '#3a2030', mat(x, y + 0.01, z), 0.01, 0);
  // dial on the sloped front face, facing the room (+x)
  const dx = x + 0.115;
  const dy = y + 0.08;
  b.add(new THREE.CylinderGeometry(0.068, 0.068, 0.014, 28), C.cream, mat(dx, dy, z, 0, 0, -1.05), 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 1.6 + 0.6;
    const yy = Math.cos(a) * 0.045;
    const zz = Math.sin(a) * 0.045;
    b.add(new THREE.CylinderGeometry(0.009, 0.009, 0.016, 8), '#c9b9a6', mat(dx + 0.006 - yy * Math.sin(-1.05) * 0, dy + yy * Math.cos(1.05), z + zz, 0, 0, -1.05), 0);
  }
  b.add(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 16), red, mat(dx + 0.004, dy + 0.002, z, 0, 0, -1.05), 0);
  // handset resting across the cradle (along z)
  b.add(new THREE.CapsuleGeometry(0.028, 0.26, 4, 12), red, mat(x - 0.02, y + 0.21, z, Math.PI / 2, 0, 0), 0.25);
  for (const sgn of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.052, 0.04, 0.06, 16), red, mat(x - 0.02, y + 0.185, z + sgn * 0.16), 0.3);
    b.box(0.05, 0.05, 0.05, red2, mat(x - 0.02, y + 0.17, z + sgn * 0.1), 0.015, 0);
  }
  // coiled cord
  for (let i = 0; i < 9; i++)
    b.add(new THREE.TorusGeometry(0.016, 0.005, 4, 10), red2, mat(x - 0.06 + i * 0.006, y + 0.11 - i * 0.008, z + 0.2 + i * 0.016, 0, Math.PI / 2, 0.3), 0);
  // envelopes stack with stamps + a standing postcard
  const ez = 1.68;
  for (let i = 0; i < 3; i++) b.box(0.22, 0.012, 0.3, i === 1 ? '#fbf7ea' : C.cream, mat(-R + 0.25, y + 0.006 + i * 0.013, ez, 0, 0.18 * (i - 1), 0), 0.004, 0);
  b.box(0.045, 0.004, 0.04, C.coral, mat(-R + 0.31, y + 0.04, ez + 0.09, 0, 0.18, 0), 0, 0);
  b.box(0.15, 0.003, 0.012, '#c9b9a6', mat(-R + 0.22, y + 0.04, ez - 0.04, 0, 0.18, 0), 0, 0);
  b.box(0.012, 0.16, 0.22, '#6d9dc5', mat(-R + 0.1, y + 0.08, 1.7, 0, 0, 0.12), 0.004, 0.3);
}

function buildArmchair(b: Builder) {
  // a soft lounge chair + side table + floor lamp in the front-right corner
  const x = 1.85;
  const z = 1.2;
  const ry = -1.85; // facing toward the bookshelf wall
  const col = '#e3a35f';
  const col2 = '#d38f4c';
  const leg = C.woodDark;
  const place = (lx: number, ly: number, lz: number) => {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    return [x + lx * c + lz * s, ly, z - lx * s + lz * c] as const;
  };
  const P = (lx: number, ly: number, lz: number, w: number, h: number, d: number, color: string, r: number, rx = 0, shade = 0.25) => {
    const [px, py, pz] = place(lx, ly, lz);
    b.box(w, h, d, color, mat(px, py, pz, 0, ry, 0).multiply(new THREE.Matrix4().makeRotationX(rx)), r, shade);
  };
  P(0, 0.3, 0, 0.8, 0.2, 0.72, col2, 0.08); // seat base
  P(0, 0.44, 0.04, 0.66, 0.12, 0.62, col, 0.06); // cushion
  P(0, 0.68, -0.33, 0.8, 0.62, 0.16, col2, 0.08, -0.12); // back
  P(-0.38, 0.5, 0, 0.12, 0.34, 0.72, col2, 0.06); // arms
  P(0.38, 0.5, 0, 0.12, 0.34, 0.72, col2, 0.06);
  for (const lx of [-0.32, 0.32]) for (const lz of [-0.28, 0.28]) {
    const [px, , pz] = place(lx, 0, lz);
    b.add(new THREE.CylinderGeometry(0.022, 0.015, 0.2, 8), leg, mat(px, 0.1, pz), 0);
  }
  // throw pillow
  {
    const [px, py, pz] = place(0.12, 0.62, -0.18);
    b.box(0.3, 0.28, 0.1, '#5b4a86', mat(px, py, pz, -0.3, ry, 0.2), 0.05, 0.3);
  }
  // side table with a book and a cup
  const tx = 2.45;
  const tz = 0.35;
  b.add(new THREE.CylinderGeometry(0.24, 0.24, 0.035, 28), C.woodLight, mat(tx, 0.52, tz), 0);
  b.add(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 10), C.ink, mat(tx, 0.26, tz), 0);
  b.add(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 20), C.ink, mat(tx, 0.01, tz), 0);
  b.box(0.2, 0.035, 0.27, '#4b4fa0', mat(tx - 0.02, 0.555, tz, 0, 0.4, 0), 0.008);
  b.add(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 14), C.cream, mat(tx + 0.1, 0.58, tz - 0.1), 0.2);
  // stack of books + a pouf on the floor
  b.add(new THREE.CylinderGeometry(0.2, 0.22, 0.24, 24), '#5b4a86', mat(1.05, 0.12, 1.0), 0.3);
  b.add(new THREE.TorusGeometry(0.18, 0.035, 8, 24), '#6c5a9c', mat(1.05, 0.24, 1.0, Math.PI / 2, 0, 0), 0.1);
  b.box(0.3, 0.05, 0.22, '#c75b4a', mat(2.35, 0.025, 1.95, 0, 0.3, 0), 0.01);
  b.box(0.28, 0.045, 0.2, '#f2cc8f', mat(2.35, 0.072, 1.95, 0, 0.1, 0), 0.01);
  b.box(0.26, 0.04, 0.2, '#3d8b8b', mat(2.35, 0.115, 1.95, 0, 0.4, 0), 0.01);
  return { table: new THREE.Vector3(tx, 0.62, tz) };
}

function buildCabinetLamp(b: Builder, top: number) {
  // little mushroom lamp next to the phone: warm light for the contact corner
  const x = -R + 0.22;
  const z = 0.88;
  b.add(new THREE.CylinderGeometry(0.035, 0.06, 0.2, 14), '#e9d7bf', mat(x, top + 0.12, z), 0.2);
  b.add(new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#f6e3c6', mat(x, top + 0.2, z, 0, 0, 0, 1, 0.75, 1), 0);
  return new THREE.Vector3(x, top + 0.2, z);
}

function buildPlantFloor(b: Builder) {
  const x = 2.55;
  const z = -1.55;
  b.add(new THREE.CylinderGeometry(0.24, 0.18, 0.5, 18), '#e9e3ef', mat(x, 0.25, z));
  b.add(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 18), '#4a3428', mat(x, 0.49, z), 0);
  const r = rng(77);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.4;
    const tilt = 0.25 + r() * 0.65;
    const len = 0.5 + r() * 0.6;
    const ly = 0.5 + Math.cos(tilt) * len;
    const lx = x + Math.cos(a) * Math.sin(tilt) * len * 0.7;
    const lz = z + Math.sin(a) * Math.sin(tilt) * len * 0.7;
    b.add(new THREE.CylinderGeometry(0.008, 0.01, len, 4), C.leaf2, mat((x + lx) / 2, (0.5 + ly) / 2, (z + lz) / 2, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt), 0);
    b.add(new THREE.IcosahedronGeometry(0.13, 0), [C.leaf1, C.leaf2, C.leaf3][i % 3], mat(lx, ly, lz, tilt * Math.sin(a), -a, tilt * Math.cos(a), 1.4, 0.35, 0.8), 0.25);
  }
}

// ---------------------------------------------------------------- shaders for glow bits
const ledVert = /* glsl */ `
  attribute vec3 color;
  attribute float phase;
  attribute float rate;
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vCol;
  varying float vOn;
  void main(){
    float t = uTime * rate + phase;
    float blink = step(0.25, fract(t)) * (0.75 + 0.25 * sin(t * 6.2831));
    vOn = mix(1.0, blink, uMotion);
    vCol = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const ledFrag = /* glsl */ `
  varying vec3 vCol;
  varying float vOn;
  void main(){
    gl_FragColor = vec4(vCol * (0.25 + 2.2 * vOn), 1.0);
    #include <colorspace_fragment>
  }`;

const glowVert = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float phase;
  attribute float rate;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uMotion;
  varying vec3 vCol;
  varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float t = uTime * rate + phase;
    float tw = rate > 2.0 ? step(0.25, fract(t)) : 0.7 + 0.3 * sin(t);
    vA = mix(0.9, tw, uMotion);
    vCol = color;
    gl_PointSize = size * uPixelRatio * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const glowFrag = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  void main(){
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float a = exp(-r * r * 5.0) * vA;
    a *= 1.0 - smoothstep(0.85, 1.0, r);
    gl_FragColor = vec4(vCol * a, a);
    #include <colorspace_fragment>
  }`;

const dustVert = /* glsl */ `
  attribute float seed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uMotion;
  uniform vec3 uLamp;
  varying float vA;
  varying vec3 vCol;
  void main(){
    vec3 p = position;
    float t = uTime * uMotion;
    p.y = 0.2 + mod(p.y + t * (0.02 + seed * 0.03), 2.9);
    p.x += sin(t * 0.21 + seed * 40.0) * 0.18;
    p.z += cos(t * 0.17 + seed * 23.0) * 0.18;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dl = distance(p, uLamp);
    float lampK = smoothstep(1.6, 0.2, dl);
    vCol = mix(vec3(0.62, 0.68, 1.0), vec3(1.0, 0.75, 0.45), lampK);
    vA = (0.18 + lampK * 0.7) * (0.5 + 0.5 * sin(t * (0.5 + seed) + seed * 10.0));
    vA *= smoothstep(0.2, 0.6, p.y) * smoothstep(3.1, 2.6, p.y);
    gl_PointSize = (1.4 + seed * 2.2) * uPixelRatio * (12.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const dustFrag = /* glsl */ `
  varying float vA;
  varying vec3 vCol;
  void main(){
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.2, 1.0, r)) * vA;
    gl_FragColor = vec4(vCol * a, a);
  }`;

const hullVert = /* glsl */ `
  uniform float uThick;
  void main(){
    vec3 p = position + normal * uThick;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const hullFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main(){
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }`;

// ---------------------------------------------------------------- main build
export function buildRoom(): Room {
  const scene = new THREE.Scene();
  const uniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uMotion: { value: 1 } };
  const radial = radialTexture();

  // ---- static clay
  const sb = new Builder();
  const win = buildShell(sb);
  const desk = buildDesk(sb);
  buildChair(sb);
  buildPlantFloor(sb);
  const cab = buildCabinet(sb);
  buildArmchair(sb);
  const cabLamp = buildCabinetLamp(sb, cab.top);
  const staticMesh = new THREE.Mesh(sb.merge(), clay());
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  scene.add(staticMesh);

  // ---- floor + rug
  const ftex = floorTexture();
  ftex.repeat.set(2.4, 2.4);
  const floorMat = patchAO(new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.75, color: '#ffffff' }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  scene.add(floor);
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 2.1),
    patchAO(new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1, color: '#ffffff' })),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.55, 0.008, -0.95);
  rug.receiveShadow = true;
  scene.add(rug);

  // ---- contact shadows (blobs) – one merged mesh
  const blobs: [number, number, number, number, number][] = [
    // x, z, sx, sz, opacity
    [1.0, -1.72, 0.95, 0.95, 0.55],
    [2.55, -1.55, 0.8, 0.8, 0.5],
    [-2.75, -0.3, 0.9, 1.0, 0.55],
    [-2.75, 1.52, 0.9, 2.0, 0.5],
    [-2.8, -1.78, 0.75, 1.8, 0.5],
    [1.1, -2.55, 3.0, 1.1, 0.45],
    [1.85, 1.2, 1.3, 1.3, 0.55],
    [2.45, 0.35, 0.65, 0.65, 0.45],
    [1.05, 1.0, 0.7, 0.7, 0.5],
    [2.35, 1.95, 0.5, 0.45, 0.4],
  ];
  const blobGeos = blobs.map(([x, z, sx, sz, o]) => {
    const g = new THREE.PlaneGeometry(sx, sz);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.012, z);
    const a = new Float32Array(g.getAttribute('position').count).fill(o);
    g.setAttribute('alpha', new THREE.BufferAttribute(a, 1));
    return g;
  });
  const blobMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: radial } },
    vertexShader: `attribute float alpha; varying float vA; varying vec2 vUv; void main(){ vA = alpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `uniform sampler2D map; varying float vA; varying vec2 vUv; void main(){ float a = texture2D(map, vUv).r * vA; gl_FragColor = vec4(0.03,0.02,0.08, a); }`,
    transparent: true,
    depthWrite: false,
  });
  const blobMesh = new THREE.Mesh(mergeGeometries(blobGeos) as THREE.BufferGeometry, blobMat);
  blobMesh.renderOrder = 1;
  scene.add(blobMesh);

  // ---- window: city outside + moonlight patch
  const cw = win.wx1 - win.wx0;
  const ch = win.wy1 - win.wy0;
  const city = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 2.6),
    new THREE.MeshBasicMaterial({ map: cityTexture(), toneMapped: false }),
  );
  city.position.set((win.wx0 + win.wx1) / 2 + 0.05, 1.75, -R - 0.55);
  scene.add(city);
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(cw * 1.05, ch * 0.95),
    new THREE.MeshBasicMaterial({ map: windowLightTexture(), color: '#6f78d8', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set((win.wx0 + win.wx1) / 2 + 0.35, 0.015, -R + 1.0);
  patch.rotation.z = -0.25;
  scene.add(patch);
  // faint light shaft
  const shaftGeo = new THREE.PlaneGeometry(cw * 0.95, 2.2);
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `varying vec2 vUv; void main(){ float a = smoothstep(0.0,0.6,vUv.y) * smoothstep(0.0,0.25,vUv.x) * smoothstep(1.0,0.75,vUv.x) * 0.06; gl_FragColor = vec4(vec3(0.5,0.55,1.0)*a, a);} `,
  });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.set((win.wx0 + win.wx1) / 2 + 0.15, 0.95, -R + 0.62);
  shaft.rotation.x = -0.62;
  scene.add(shaft);

  // ---- poster
  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.78),
    patchAO(new THREE.MeshStandardMaterial({ map: posterTexture(), roughness: 0.9 })),
  );
  poster.position.set(-R + 0.045, cab.posterY, cab.posterZ);
  poster.rotation.y = Math.PI / 2;
  scene.add(poster);

  // ---- interactive objects
  const hotspots: Hotspot[] = [];
  const hullMat = () =>
    new THREE.ShaderMaterial({
      uniforms: { uThick: { value: 0.022 }, uColor: { value: new THREE.Color('#ffd9a8') }, uOpacity: { value: 0 } },
      vertexShader: hullVert,
      fragmentShader: hullFrag,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
  const addHotspot = (
    id: SectionId,
    label: string,
    b: Builder,
    view: { pos: [number, number, number]; target: [number, number, number] },
    anchorOffsetY = 0.15,
  ) => {
    const geo = b.merge();
    const material = clay();
    material.emissive.set('#000000');
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const hull = new THREE.Mesh(geo, hullMat());
    hull.visible = false;
    hull.renderOrder = 2;
    scene.add(mesh, hull);
    const box = (geo.boundingBox as THREE.Box3).clone().expandByScalar(0.06);
    const anchor = box.getCenter(new THREE.Vector3());
    anchor.y = box.max.y + anchorOffsetY;
    const h: Hotspot = {
      id,
      label,
      mesh,
      material,
      hull,
      box,
      anchor,
      view: { pos: new THREE.Vector3(...view.pos), target: new THREE.Vector3(...view.target) },
      glow: 0,
    };
    hotspots.push(h);
    return h;
  };

  // monitors → projects
  const mb = new Builder();
  const mons = buildMonitors(mb, desk.top);
  const hp = addHotspot('projects', 'Work', mb, { pos: [1.7, 2.3, 0.7], target: [1.3, 1.12, -2.62] }, 0.12);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(mons.main.w, mons.main.h), new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false, color: '#d8e4ff' }));
  scr.position.set(mons.main.x, mons.main.y, mons.main.z);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(mons.side.w, mons.side.h), new THREE.MeshBasicMaterial({ map: codeTexture(), toneMapped: false, color: '#d8e4ff' }));
  side.position.set(mons.side.x, mons.side.y, mons.side.z);
  side.rotation.y = mons.side.ry;
  scene.add(scr, side);
  void hp;

  // bookshelf → experience
  const bb = new Builder();
  buildBookshelf(bb);
  addHotspot('experience', 'Experience', bb, { pos: [1.55, 1.75, -0.15], target: [-2.7, 1.08, -1.78] }, 0.1);

  // rack → skills
  const rb = new Builder();
  const rack = buildRack(rb);
  addHotspot('skills', 'Stack', rb, { pos: [0.25, 1.65, 1.35], target: [-2.65, 0.7, -0.35] }, 0.12);

  // phone → contact
  const pb = new Builder();
  buildPhone(pb, cab.top);
  addHotspot('contact', 'Contact', pb, { pos: [-0.35, 1.8, 3.0], target: [-2.7, 0.95, 1.4] }, 0.15);

  // neon sign → about
  const nb = new Builder();
  const nx = 1.1;
  const ny = 2.42;
  nb.box(1.56, 0.6, 0.03, '#2c2a55', mat(nx, ny, -R + 0.05), 0.03, 0);
  for (const sx of [-0.7, 0.7]) for (const sy of [-0.24, 0.24]) nb.add(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 8), C.metal, mat(nx + sx, ny + sy, -R + 0.025, Math.PI / 2, 0, 0), 0);
  addHotspot('about', 'About', nb, { pos: [0.85, 1.95, 1.25], target: [1.12, 1.95, -2.9] }, 0.08);
  const neon = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5 * (360 / 1024)),
    new THREE.MeshBasicMaterial({ map: neonTexture(), transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  neon.position.set(nx, ny + 0.01, -R + 0.075);
  scene.add(neon);

  // ---- LEDs (one mesh, blink computed on the GPU)
  {
    const geos: THREE.BufferGeometry[] = [];
    rack.leds.forEach((l) => {
      const g = new THREE.BoxGeometry(0.008, 0.012, 0.012).toNonIndexed();
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      g.translate(l.x, l.y, l.z);
      const n = g.getAttribute('position').count;
      _c.set(l.col);
      const col = new Float32Array(n * 3);
      const ph = new Float32Array(n).fill(Math.random());
      const rt = new Float32Array(n).fill(l.rate);
      for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
      g.setAttribute('rate', new THREE.BufferAttribute(rt, 1));
      geos.push(g);
    });
    const ledMesh = new THREE.Mesh(
      mergeGeometries(geos) as THREE.BufferGeometry,
      new THREE.ShaderMaterial({ uniforms, vertexShader: ledVert, fragmentShader: ledFrag }),
    );
    scene.add(ledMesh);
  }

  // ---- glow points: fairy lights, LED halos, lamp bulb
  {
    const pts: { p: THREE.Vector3; col: string; size: number; rate: number }[] = [];
    // fairy lights along a sagging string over the window
    const fx0 = win.wx0 - 0.35;
    const fx1 = win.wx1 + 0.35;
    const fairyGeo: THREE.BufferGeometry[] = [];
    const curve: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = fx0 + (fx1 - fx0) * t;
      const y = 2.78 - Math.sin(t * Math.PI) * 0.22 - Math.abs(Math.sin(t * Math.PI * 3)) * 0.05;
      const p = new THREE.Vector3(x, y, -R + 0.2);
      curve.push(p);
      if (i % 1 === 0 && i > 0 && i < 16)
        pts.push({ p, col: i % 3 === 0 ? '#ffd0a0' : '#ffb870', size: 0.11, rate: 0.6 + (i % 4) * 0.3 });
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve), 40, 0.004, 3, false);
    fairyGeo.push(tube);
    const wire = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: '#2b2840' }));
    scene.add(wire);
    rack.leds.forEach((l, i) => {
      if (i % 2 === 0) pts.push({ p: new THREE.Vector3(l.x + 0.01, l.y, l.z), col: l.col, size: 0.05, rate: l.rate });
    });
    // lamp bulb + screen corner glow
    pts.push({ p: new THREE.Vector3(desk.head.x + 0.03, desk.head.y - 0.07, desk.head.z), col: '#ffc27a', size: 0.55, rate: 0.2 });
    const n = pts.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    const rate = new Float32Array(n);
    pts.forEach((q, i) => {
      pos.set([q.p.x, q.p.y, q.p.z], i * 3);
      _c.set(q.col);
      col.set([_c.r, _c.g, _c.b], i * 3);
      size[i] = q.size;
      phase[i] = i * 1.7;
      rate[i] = q.rate;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('rate', new THREE.BufferAttribute(rate, 1));
    const glow = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ uniforms, vertexShader: glowVert, fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.renderOrder = 3;
    scene.add(glow);
  }

  // ---- large soft halos (sprites): screen spill, neon spill, lamp pool
  const halo = (x: number, y: number, z: number, s: number, color: string, o: number) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sp.position.set(x, y, z);
    sp.scale.set(s, s, 1);
    sp.renderOrder = 4;
    scene.add(sp);
  };
  halo(mons.main.x, mons.main.y, mons.main.z + 0.05, 2.0, '#3b7dd8', 0.16);
  halo(nx, ny, -R + 0.1, 2.6, '#c04ab0', 0.16);
  halo(desk.head.x, desk.head.y - 0.1, desk.head.z, 1.0, '#ffb060', 0.22);
  halo(cabLamp.x + 0.02, cabLamp.y, cabLamp.z, 0.9, '#ffb060', 0.3);

  // ---- dust motes
  {
    const n = 180;
    const r = rng(99);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -2.6 + r() * 5.2;
      pos[i * 3 + 1] = r() * 2.9;
      pos[i * 3 + 2] = -2.7 + r() * 4.0;
      seed[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, -0.5), 6);
    const dust = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uLamp: { value: new THREE.Vector3(desk.head.x, desk.head.y - 0.3, desk.head.z + 0.2) } },
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    dust.renderOrder = 5;
    scene.add(dust);
  }

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight('#8a86f0', '#3a2440', 1.15);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight('#a9b4ff', 0.9);
  fill.position.set(-2, 6, 7);
  scene.add(fill);
  const lamp = new THREE.SpotLight('#ffb468', 18, 6, 1.0, 0.85, 1.5);
  lamp.position.set(desk.head.x, desk.head.y - 0.05, desk.head.z);
  lamp.target.position.set(1.15, desk.top, -2.35);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 4;
  lamp.shadow.camera.near = 0.05;
  lamp.shadow.camera.far = 5;
  scene.add(lamp, lamp.target);
  const warm = new THREE.PointLight('#ff9a52', 7, 8, 1.3);
  warm.position.set(1.5, 1.6, -1.5);
  scene.add(warm);
  const screenLight = new THREE.PointLight('#4fc3ff', 1.6, 2.6, 1.6);
  screenLight.position.set(mons.main.x, mons.main.y, mons.main.z + 0.45);
  scene.add(screenLight);
  const cornerLight = new THREE.PointLight('#ffb070', 2.6, 3.2, 1.5);
  cornerLight.position.set(cabLamp.x + 0.25, cabLamp.y + 0.05, cabLamp.z + 0.3);
  scene.add(cornerLight);

  return { scene, hotspots, uniforms, lamp };
}
