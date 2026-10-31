// Build-time: embed every piece of real content with a local model on the GPU (Ollama),
// project the vectors to 3D with UMAP, and write the map the site renders.
//
//   ollama serve & ollama pull qwen3-embedding:0.6b
//   node scripts/embed.ts
import { writeFileSync } from 'node:fs';
import { UMAP } from 'umap-js';
import { profile, projects, experience, skills } from '../src/content.ts';

const MODEL = process.env.EMBED_MODEL ?? 'qwen3-embedding:0.6b';
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

type Kind = 'project' | 'highlight' | 'skill' | 'role' | 'domain' | 'era';
type Item = { label: string; kind: Kind; group: string; text: string };

const items: Item[] = [];
for (const p of projects) {
  items.push({ label: p.name, kind: 'project', group: p.id, text: `${p.name}: ${p.tagline}. ${p.problem}` });
  for (const h of p.highlights) items.push({ label: h, kind: 'highlight', group: p.id, text: `${p.name}: ${h}` });
}
for (const [group, list] of Object.entries(skills)) {
  for (const s of list) items.push({ label: s, kind: 'skill', group, text: `${s} (${group})` });
}
for (const r of experience) {
  items.push({ label: r.role, kind: 'role', group: r.client ?? r.org, text: `${r.role}, ${r.client ?? r.org}. ${r.points.join(' ')}` });
}
const domains = profile.facts.find(([k]) => k === 'domains')![1].split('·').map((s) => s.trim());
for (const d of domains) items.push({ label: d, kind: 'domain', group: 'domains', text: `Enterprise software for ${d}` });
const eras: [string, string][] = [
  ['Rules', 'Business rules and decision automation, IBM ODM, provable policy'],
  ['Workflows', 'Workflow automation, Camunda BPM, Java microservices'],
  ['AI', 'Conversational AI, LLMs, RAG, LLM evaluation, agents'],
  ['Platforms', 'Integration platforms, Workato, canonical models, adapters'],
];
for (const [label, text] of eras) items.push({ label, kind: 'era', group: 'arc', text });

console.log(`embedding ${items.length} items with ${MODEL} …`);
const res = await fetch(`${OLLAMA}/api/embed`, {
  method: 'POST',
  body: JSON.stringify({ model: MODEL, input: items.map((i) => i.text) }),
});
if (!res.ok) throw new Error(`ollama: ${res.status} ${await res.text()}`);
const { embeddings } = (await res.json()) as { embeddings: number[][] };

const unit = embeddings.map((v) => { const n = Math.hypot(...v); return v.map((x) => x / n); });
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

// Deterministic PRNG so the layout is stable between builds.
let seed = 42;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const umap = new UMAP({ nComponents: 3, nNeighbors: 10, minDist: 0.35, spread: 1.2, random, distanceFn: (a, b) => 1 - cos(a, b) });
const pos = umap.fit(unit);

// Centre and scale to [-1, 1] on the widest axis.
const mean = [0, 1, 2].map((k) => pos.reduce((s, p) => s + p[k], 0) / pos.length);
const centred = pos.map((p) => p.map((x, k) => x - mean[k]));
const ext = Math.max(...centred.flat().map(Math.abs));
const nodes = items.map((it, i) => ({
  label: it.label,
  kind: it.kind,
  group: it.group,
  pos: centred[i].map((x) => +(x / ext).toFixed(4)),
}));

// Edges: each node to its 3 nearest neighbours in the original embedding space.
const seen = new Set<string>();
const edges: [number, number, number][] = [];
unit.forEach((a, i) => {
  unit
    .map((b, j) => [j, cos(a, b)] as const)
    .filter(([j]) => j !== i)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .forEach(([j, s]) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) { seen.add(key); edges.push([Math.min(i, j), Math.max(i, j), +s.toFixed(3)]); }
    });
});

const out = { model: MODEL, dims: embeddings[0].length, built: new Date().toISOString().slice(0, 10), nodes, edges };
writeFileSync(new URL('../src/space/embedding.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${nodes.length} nodes, ${edges.length} edges (${out.dims}-d → 3-d)`);
