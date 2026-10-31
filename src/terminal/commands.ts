import { profile, projects, experience, education, skills } from '../content';
import { SHAPES, type ShapeName } from '../world/targets';
import { THEMES, type WorldControl } from '../world/world';
import { cmd, esc, type Command } from './terminal';

// The word the particles spell when a project is opened.
const MARKS: Record<string, string> = {
  'ai-ipaas': 'IPAAS',
  dialoglens: 'DIALOGLENS',
  'conversational-ai': 'XO AI',
  'decision-automation': 'ODM',
  homelab: 'HOMELAB',
};

const FILES: Record<string, string> = {
  'about.txt': 'about',
  'experience.log': 'experience',
  'skills.json': 'skills',
  'contact.vcf': 'contact',
  'resume.pdf': 'resume',
  'colophon.md': 'colophon',
};

const link = (url: string, label = url.replace(/^https?:\/\/(www\.)?/, '')) =>
  `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const chips = (items: string[]) => items.map((s) => `<span class="chip">${esc(s)}</span>`).join('');
const h = (s: string) => `<span class="h">${esc(s)}</span>`;

function findProject(q: string) {
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= projects.length) return projects[n - 1];
  const s = q.toLowerCase();
  return projects.find((p) => p.id === s || p.id.startsWith(s) || p.name.toLowerCase().includes(s));
}

export function buildCommands(world: WorldControl): Command[] {
  const list: Command[] = [
    {
      name: 'help',
      desc: 'list commands',
      aliases: ['?', 'man'],
      run: ({ term }) => {
        const rows = term
          .list()
          .filter((c) => !c.hidden)
          .map((c) => `<div class="row">${cmd(c.name)}<span class="dim">${esc(c.usage ?? '')}</span><span>${esc(c.desc)}</span></div>`)
          .join('');
        term.print(`<div class="table">${rows}</div>`);
        term.print(`<span class="dim">tab completes · ↑↓ history · ctrl+l clears · click anything highlighted · click the void for a shockwave</span>`);
      },
    },
    {
      name: 'about',
      desc: 'who I am',
      aliases: ['whoami'],
      run: ({ term }) => {
        world.formText(profile.name);
        term.print(`${h(profile.name)} <span class="dim">— ${esc(profile.role)}</span>`);
        term.print(esc(profile.summary));
        term.print(
          `<div class="facts">${profile.facts.map(([k, v]) => `<div><span class="dim">${esc(k)}</span>${esc(v)}</div>`).join('')}</div>`,
        );
        term.print(`next: ${cmd('projects')} ${cmd('experience')} ${cmd('contact')}`);
      },
    },
    {
      name: 'projects',
      desc: 'systems I have built',
      aliases: ['work', 'systems'],
      run: ({ term }) => {
        world.formText('SYSTEMS');
        const rows = projects
          .map((p, i) => `<div class="row">${cmd(`open ${p.id}`, `${i + 1}. ${p.name}`)}<span class="dim">${esc(p.tagline)}</span></div>`)
          .join('');
        term.print(`<div class="table projects">${rows}</div>`);
        term.print(`<span class="dim">open &lt;n|name&gt; for the case study</span>`);
      },
    },
    {
      name: 'open',
      desc: 'open a case study',
      usage: '<n|name>',
      run: ({ term, args }) => {
        const p = args[0] && findProject(args.join(' '));
        if (!p) {
          term.print(`usage: open &lt;n|name&gt; — see ${cmd('projects')}`, 'err');
          return;
        }
        world.formText(MARKS[p.id] ?? p.name);
        term.print(`${h(p.name)} <span class="dim">— ${esc(p.tagline)}</span>`);
        if (p.status) term.print(`<span class="ok">● ${esc(p.status)}</span>`);
        term.print(esc(p.problem));
        term.print(`<ul>${p.highlights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
        term.print(`<div class="chips">${chips(p.stack)}</div>`);
        if (p.url) term.print(link(p.url));
        const i = projects.indexOf(p);
        const next = projects[(i + 1) % projects.length];
        term.print(`${cmd('projects', '← all')}  ${cmd(`open ${next.id}`, `next: ${next.name} →`)}`);
      },
    },
    {
      name: 'experience',
      desc: 'career timeline',
      aliases: ['career', 'cv'],
      run: ({ term }) => {
        world.formText('11+ YEARS');
        for (const r of experience) {
          term.print(
            `<div class="role${r.current ? ' current' : ''}"><span class="dim">${esc(r.period)}</span> ${h(r.role)}` +
              `<div class="dim">${esc(r.org)}${r.client ? ` · ${esc(r.client)}` : ''}</div>` +
              `<ul>${r.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`,
          );
        }
        term.print(`<div class="role"><span class="dim">${education.period}</span> ${h(education.degree)}<div class="dim">${esc(education.school)}</div></div>`);
      },
    },
    {
      name: 'skills',
      desc: 'stack & tools',
      aliases: ['stack'],
      run: ({ term }) => {
        world.formShape('helix');
        for (const [group, items] of Object.entries(skills)) {
          term.print(`<div class="skill"><span class="dim">${esc(group)}</span><div class="chips">${chips(items)}</div></div>`);
        }
      },
    },
    {
      name: 'contact',
      desc: 'get in touch',
      aliases: ['email', 'hire'],
      run: ({ term }) => {
        world.formText('SAY HI');
        term.print(esc(profile.contactNote));
        term.print(
          `<div class="facts">` +
            `<div><span class="dim">email</span><a href="mailto:${profile.email}">${profile.email}</a> ${cmd('copy', '[copy]')}</div>` +
            `<div><span class="dim">linkedin</span>${link(profile.links.linkedin)}</div>` +
            `<div><span class="dim">github</span>${link(profile.links.github)}</div>` +
            `<div><span class="dim">where</span>${esc(profile.location)}</div></div>`,
        );
      },
    },
    {
      name: 'copy',
      desc: 'copy my email',
      hidden: true,
      run: async ({ term }) => {
        try {
          await navigator.clipboard.writeText(profile.email);
          term.print(`<span class="ok">copied ${profile.email}</span>`);
        } catch {
          term.print(`clipboard blocked — it's ${profile.email}`);
        }
      },
    },
    {
      name: 'resume',
      desc: 'download my CV (pdf)',
      run: ({ term }) => {
        window.open(profile.resume, '_blank');
        term.print(`opening <a href="${profile.resume}" download="Pramod-Burra-Resume.pdf">resume.pdf</a>`);
      },
    },
    { name: 'github', desc: 'open GitHub', hidden: true, run: ({ term }) => { window.open(profile.links.github, '_blank'); term.print(link(profile.links.github)); } },
    { name: 'linkedin', desc: 'open LinkedIn', hidden: true, run: ({ term }) => { window.open(profile.links.linkedin, '_blank'); term.print(link(profile.links.linkedin)); } },
    {
      name: 'ls',
      desc: 'list files',
      run: ({ term, args }) => {
        if (args[0]?.replace(/\/$/, '') === 'projects') {
          term.print(projects.map((p) => cmd(`open ${p.id}`, p.id)).join('  '));
          return;
        }
        term.print(Object.entries(FILES).map(([f, c]) => cmd(c, f)).join('  ') + `  ${cmd('ls projects', 'projects/')}`);
      },
    },
    {
      name: 'cat',
      desc: 'read a file',
      usage: '<file>',
      hidden: true,
      run: ({ term, args }) => {
        const c = FILES[args[0] ?? ''];
        if (c) term.exec(c, false);
        else term.print(`cat: ${esc(args[0] ?? '')}: no such file`, 'err');
      },
    },
    {
      name: 'shape',
      desc: 'morph the universe',
      usage: `<${SHAPES.join('|')}>`,
      run: ({ term, args }) => {
        const s = args[0] as ShapeName;
        if (!SHAPES.includes(s)) {
          term.print(`try: ${SHAPES.map((x) => cmd(`shape ${x}`, x)).join(' ')}`);
          return;
        }
        world.formShape(s);
      },
    },
    {
      name: 'say',
      desc: 'write words in particles',
      usage: '<text>',
      run: ({ term, raw }) => {
        if (!raw) term.print(`usage: say &lt;text&gt; — e.g. ${cmd('say hello world')}`);
        else world.formText(raw.slice(0, 40));
      },
    },
    { name: 'galaxy', desc: 'release everything back to the galaxy', aliases: ['release'], run: () => world.release() },
    {
      name: 'theme',
      desc: 'change palette',
      usage: `<${Object.keys(THEMES).join('|')}>`,
      run: ({ term, args }) => {
        if (THEMES[args[0]]) world.setTheme(args[0]);
        else term.print(`themes: ${Object.keys(THEMES).map((t) => cmd(`theme ${t}`, t)).join(' ')}`);
      },
    },
    {
      name: 'particles',
      desc: 'set particle count',
      usage: '<n>',
      run: ({ term, args }) => {
        const s = world.stats();
        const n = Number(args[0]?.replace(/[_,]/g, '').replace(/k$/i, '000').replace(/m$/i, '000000'));
        if (!n) {
          term.print(`${s.particles.toLocaleString()} live / ${s.maxParticles.toLocaleString()} max — try ${cmd('particles 1m')}`);
          return;
        }
        term.print(`<span class="ok">${world.setParticles(n).toLocaleString()} particles</span>`);
      },
    },
    {
      name: 'neofetch',
      desc: 'system info',
      aliases: ['gpu', 'stats', 'uname'],
      run: ({ term }) => {
        world.formShape('torus');
        const s = world.stats();
        const art = [
          '  ██████╗ ',
          '  ██╔══██╗',
          '  ██████╔╝',
          '  ██╔═══╝ ',
          '  ██║     ',
          '  ╚═╝     ',
        ];
        const info = [
          `${h(`${profile.user}@pramodburra.com`)}`,
          `<span class="dim">role</span>     ${esc(profile.role)}`,
          `<span class="dim">gpu</span>      ${esc(s.gpu)}`,
          `<span class="dim">engine</span>   raw WebGPU · WGSL compute`,
          `<span class="dim">entities</span> ${s.particles.toLocaleString()} particles`,
          `<span class="dim">fps</span>      ${s.fps || '—'}`,
        ];
        term.print(`<div class="neofetch"><pre class="art">${art.join('\n')}</pre><div>${info.join('<br>')}</div></div>`);
      },
    },
    {
      name: 'colophon',
      desc: 'how this site works',
      aliases: ['source', 'how'],
      run: ({ term }) => {
        world.formText('WEBGPU');
        term.print(
          [
            'No framework, no Three.js. Hand-written WGSL.',
            '• Up to 1,048,576 particles simulated by a compute shader each frame: spring dynamics toward a procedural spiral galaxy, perturbed by a divergence-free flow field.',
            '• Commands rasterise text or sample 3D shapes into a target buffer; particles peel off the galaxy in staggered waves and spring into place.',
            '• Additive HDR billboards → quarter-res bloom → ACES tonemap, vignette, film grain.',
            '• Particle count adapts to your GPU: it doubles while you hold 55 fps and backs off below 50.',
          ]
            .map(esc)
            .join('<br>'),
        );
      },
    },
    { name: 'clear', desc: 'clear the screen', aliases: ['cls'], run: ({ term }) => term.clear() },
    { name: 'history', desc: 'command history', hidden: true, run: ({ term }) => term.print(term.history.map((x, i) => `${i + 1}  ${esc(x)}`).join('<br>')) },
    { name: 'echo', desc: 'echo', hidden: true, run: ({ term, raw }) => { term.print(esc(raw)); } },
    { name: 'date', desc: 'date', hidden: true, run: ({ term }) => { term.print(esc(new Date().toString())); } },
    { name: 'sudo', desc: 'sudo', hidden: true, run: ({ term }) => { term.print(`${profile.user} is not in the sudoers file. This incident will be reported.`, 'err'); } },
    { name: 'rm', desc: 'rm', hidden: true, run: ({ term }) => { world.formText('NICE TRY'); term.print('permission denied: the universe is read-only', 'err'); } },
    { name: 'exit', desc: 'exit', hidden: true, aliases: ['quit'], run: () => { document.querySelector<HTMLButtonElement>('.win .close')?.click(); } },
  ];
  return list;
}
