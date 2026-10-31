// Real, semantic HTML for every word on the page. The canvas only illustrates it.
import { profile, projects, experience, education, skills, type Project } from '../../content';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const byId = (id: string) => projects.find((p) => p.id === id)!;
const chips = (xs: string[]) => `<ul class="lv-chips" aria-label="Stack">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const points = (xs: string[]) => `<ul class="lv-points">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

export const CHAPTERS = ['Intro', 'Rules', 'Workflows', 'AI', 'Platforms', 'Work'];

function chapter(state: number, id: string, num: string, name: string, period: string, title: string, body: string) {
  return `
  <section class="lv-stage lv-chapter" id="${id}" data-state="${state}" aria-labelledby="${id}-h">
    <div class="lv-copy">
      <p class="lv-kicker"><span class="lv-num">${num}</span><span>${esc(name)}</span><span class="lv-period">${esc(period)}</span></p>
      <h2 class="lv-h2" id="${id}-h">${title}</h2>
      ${body}
    </div>
  </section>`;
}

function project(p: Project, i: number) {
  return `
  <article class="lv-project" id="p-${p.id}">
    <header class="lv-project-head">
      <span class="lv-project-num">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(p.name)}</h3>
      <p class="lv-project-tag">${esc(p.tagline)}</p>
      ${p.status ? `<p class="lv-status"><span aria-hidden="true"></span>${esc(p.status)}</p>` : ''}
    </header>
    <div class="lv-project-body">
      <p>${esc(p.problem)}</p>
      ${points(p.highlights)}
      ${chips(p.stack)}
      ${p.url ? `<a class="lv-link" href="${esc(p.url)}" rel="noopener" target="_blank">View on GitHub <span aria-hidden="true">↗</span></a>` : ''}
    </div>
  </article>`;
}

export function pageHtml() {
  const rules = byId('decision-automation');
  const dl = byId('dialoglens');
  const cai = byId('conversational-ai');
  const ipaas = byId('ai-ipaas');
  const odm = experience.find((e) => e.role.includes('ODM'))!;
  const camunda = experience.find((e) => e.role.includes('Camunda'))!;
  const bpx = experience.find((e) => e.client === 'BPX Energy')!;
  const years = profile.facts.find((f) => f[0] === 'experience')?.[1] ?? '';
  const onsite = profile.facts.find((f) => f[0] === 'on-site US')?.[1] ?? '';
  const domains = profile.facts.find((f) => f[0] === 'domains')?.[1] ?? '';
  const arc = profile.facts.find((f) => f[0] === 'arc')?.[1] ?? '';
  const order = ['agent-platform', 'agent-harness', 'llm-infra', 'foundry-telemetry', 'ai-ipaas', 'dialoglens', 'conversational-ai', 'decision-automation', 'homelab'];
  const work = order.map(byId).filter(Boolean);

  return `
  <a class="lv-skip" href="#main">Skip to content</a>
  <header class="lv-nav">
    <a class="lv-brand" href="#top" aria-label="Pramod Burra, back to top"><span class="lv-brand-mark" aria-hidden="true"></span>Pramod Burra</a>
    <nav aria-label="Primary">
      <a href="#work">Work</a>
      <a href="#experience">Experience</a>
      <a href="#contact">Contact</a>
      <a class="lv-nav-cta" href="${esc(profile.resume)}">Résumé</a>
    </nav>
  </header>

  <nav class="lv-rail" aria-label="Chapters">
    <ol>${CHAPTERS.map((c, i) => `<li><a href="#${['top', 'rules', 'workflows', 'ai', 'platforms', 'work'][i]}" data-rail="${i}"><span class="lv-rail-tick" aria-hidden="true"></span><span class="lv-rail-label">${esc(c)}</span></a></li>`).join('')}</ol>
  </nav>

  <main id="main">
    <section class="lv-stage lv-hero" id="top" data-state="0" aria-labelledby="hero-h">
      <div class="lv-copy">
        <h1 class="lv-name" id="hero-h">${esc(profile.name)}<span>${esc(profile.role)}</span></h1>
        <p class="lv-display">I make AI <em>behave</em> in production.</p>
        <p class="lv-lede">${esc(years)} designing systems that have to be right: business rules, then workflows, then conversational AI and the evaluation that keeps it honest. ${esc(onsite)} on site in the US, across ${esc(domains.replace(/ · /g, ', '))}. Currently architecting an AI-native integration platform on Workato.</p>
        <p class="lv-arc" aria-label="Career arc">${arc.split('→').map((s) => `<span>${esc(s.trim())}</span>`).join('<i aria-hidden="true">→</i>')}</p>
        <p class="lv-cue" aria-hidden="true"><span></span>Scroll. One system, four shapes.</p>
      </div>
    </section>

    ${chapter(1, 'rules', '01', 'Rules', '2015 — 2023', 'Policy, made <em>provable</em>.', `
      <p class="lv-lede">${esc(rules.problem)}</p>
      ${points([rules.highlights[1]])}
      <p class="lv-meta"><span>Clients</span>${esc(odm.client ?? '')}</p>
      ${chips(['IBM ODM', 'Java', 'Microservices'])}`)}

    ${chapter(2, 'workflows', '02', 'Workflows', '2022 — 2025', 'Process, made to <em>flow</em>.', `
      <p class="lv-lede">${esc(camunda.points[0])} ${esc(bpx.points[0])}</p>
      <dl class="lv-roles">
        <div><dt>${esc(camunda.role)}</dt><dd>${esc(camunda.client ?? '')} · ${esc(camunda.period)}</dd></div>
        <div><dt>${esc(bpx.role)}</dt><dd>${esc(bpx.client ?? '')} · ${esc(bpx.period)}</dd></div>
      </dl>
      ${chips(['Camunda BPM', 'Java', 'Microservices', 'REST'])}`)}

    ${chapter(3, 'ai', '03', 'AI', '2025 —', 'Conversation, made <em>testable</em>.', `
      <p class="lv-lede">${esc(dl.problem)}</p>
      ${points([dl.highlights[0], dl.highlights[3], cai.highlights[1]])}
      ${chips(['Kore.ai XO', 'RAG', 'Azure OpenAI', 'pgvector', 'FastAPI'])}`)}

    ${chapter(4, 'platforms', '04', 'Platforms', 'Now', 'Integration, made <em>native</em>.', `
      <p class="lv-lede">${esc(ipaas.problem)}</p>
      ${points(ipaas.highlights)}
      <p class="lv-status"><span aria-hidden="true"></span>${esc(ipaas.status ?? '')}</p>`)}

    <section class="lv-section lv-work" id="work" data-state="5" aria-labelledby="work-h">
      <div class="lv-section-head">
        <p class="lv-kicker"><span class="lv-num">05</span><span>Selected work</span></p>
        <h2 class="lv-h2" id="work-h">Systems that have to be <em>right</em>.</h2>
      </div>
      <div class="lv-projects">${work.map(project).join('')}</div>
    </section>

    <section class="lv-section lv-exp" id="experience" aria-labelledby="exp-h">
      <div class="lv-section-head">
        <p class="lv-kicker"><span class="lv-num">06</span><span>Experience</span></p>
        <h2 class="lv-h2" id="exp-h">Eleven years, <em>one</em> discipline.</h2>
        <p class="lv-lede lv-narrow">${esc(profile.summary)}</p>
      </div>
      <ol class="lv-timeline">
        ${experience.map((e) => `
        <li class="${e.current ? 'is-current' : ''}">
          <p class="lv-when">${esc(e.period)}</p>
          <div>
            <h3>${esc(e.role)}</h3>
            <p class="lv-where">${esc(e.org)}${e.client ? ` · ${esc(e.client)}` : ''}</p>
            ${points(e.points)}
          </div>
        </li>`).join('')}
        <li>
          <p class="lv-when">${esc(education.period)}</p>
          <div><h3>${esc(education.degree)}</h3><p class="lv-where">${esc(education.school)}</p></div>
        </li>
      </ol>
      <div class="lv-skills">
        ${Object.entries(skills).map(([k, v]) => `<div><h3>${esc(k)}</h3><ul>${v.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`).join('')}
      </div>
    </section>

    <section class="lv-section lv-contact" id="contact" aria-labelledby="contact-h">
      <p class="lv-kicker"><span class="lv-num">07</span><span>Contact</span></p>
      <h2 class="lv-display" id="contact-h">Let’s <em>talk</em>.</h2>
      <p class="lv-lede lv-narrow">${esc(profile.contactNote)}</p>
      <a class="lv-email" href="mailto:${esc(profile.email)}">${esc(profile.email)}</a>
      <ul class="lv-contact-links">
        <li><a href="${esc(profile.links.linkedin)}" rel="noopener" target="_blank">LinkedIn <span aria-hidden="true">↗</span></a></li>
        <li><a href="${esc(profile.links.github)}" rel="noopener" target="_blank">GitHub <span aria-hidden="true">↗</span></a></li>
        <li><a href="${esc(profile.resume)}">Résumé (PDF) <span aria-hidden="true">↓</span></a></li>
      </ul>
    </section>
  </main>

  <footer class="lv-footer">
    <span>© ${new Date().getFullYear()} ${esc(profile.name)}</span>
    <span>${esc(profile.location)}</span>
  </footer>`;
}
