// Real HTML for every section. Used both by the 3D room's side panel and the no-WebGL fallback page.
import { profile, projects, experience, education, skills } from '../../content';

export type SectionId = 'about' | 'projects' | 'experience' | 'skills' | 'contact';
export const SECTIONS: SectionId[] = ['about', 'projects', 'experience', 'skills', 'contact'];

export const SECTION_META: Record<SectionId, { kicker: string; title: string; object: string }> = {
  about: { kicker: 'The sign on the wall', title: 'About', object: 'Neon sign · About' },
  projects: { kicker: 'On the monitors', title: 'Selected work', object: 'Monitors · Work' },
  experience: { kicker: 'From the bookshelf', title: 'Experience', object: 'Bookshelf · Experience' },
  skills: { kicker: 'The homelab rack', title: 'Stack & homelab', object: 'Homelab rack · Stack' },
  contact: { kicker: 'The phone on the cabinet', title: 'Contact', object: 'Phone · Contact' },
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const chips = (items: string[]) => `<ul class="chips">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

function about(h: string): string {
  return `
    <${h} class="p-title" id="panel-title">${esc(profile.name)}</${h}>
    <p class="p-lede">${esc(profile.role)} · ${esc(profile.location)}</p>
    <p>${esc(profile.summary)}</p>
    <dl class="facts">
      ${profile.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
    </dl>
    <p class="p-actions">
      <a class="btn" href="${profile.resume}" target="_blank" rel="noopener">Résumé (PDF)</a>
      <button type="button" class="btn ghost" data-go="projects">See the work →</button>
    </p>`;
}

function work(h: string): string {
  return `
    <${h} class="p-title" id="panel-title">Selected work</${h}>
    <p class="p-lede">From business rules to evaluation platforms to an AI-native iPaaS.</p>
    <div class="cards">
      ${projects
        .map(
          (p) => `
        <article class="card" id="project-${p.id}">
          <header>
            <h3>${esc(p.name)}</h3>
            <p class="card-tag">${esc(p.tagline)}</p>
            ${p.status ? `<p class="status"><span aria-hidden="true"></span>${esc(p.status)}</p>` : ''}
          </header>
          <p>${esc(p.problem)}</p>
          <ul class="ticks">${p.highlights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          ${chips(p.stack)}
          ${p.url ? `<p><a class="link" href="${p.url}" target="_blank" rel="noopener">View on GitHub ↗</a></p>` : ''}
        </article>`,
        )
        .join('')}
    </div>`;
}

function exp(h: string): string {
  return `
    <${h} class="p-title" id="panel-title">Experience</${h}>
    <p class="p-lede">${esc(profile.facts.find(([k]) => k === 'arc')?.[1] ?? '')}</p>
    <ol class="timeline">
      ${experience
        .map(
          (r) => `
        <li class="${r.current ? 'current' : ''}">
          <p class="when">${esc(r.period)}${r.current ? ' <span class="now">now</span>' : ''}</p>
          <h3>${esc(r.role)}</h3>
          <p class="org">${esc(r.org)}${r.client ? ` · ${esc(r.client)}` : ''}</p>
          <ul>${r.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        </li>`,
        )
        .join('')}
      <li class="edu">
        <p class="when">${esc(education.period)}</p>
        <h3>${esc(education.degree)}</h3>
        <p class="org">${esc(education.school)}</p>
      </li>
    </ol>`;
}

function stack(h: string): string {
  const lab = projects.find((p) => p.id === 'homelab');
  return `
    <${h} class="p-title" id="panel-title">Stack & homelab</${h}>
    <p class="p-lede">The tools I reach for, grouped by layer.</p>
    <div class="groups">
      ${Object.entries(skills)
        .map(([g, list]) => `<section class="group"><h3>${esc(g)}</h3>${chips(list)}</section>`)
        .join('')}
    </div>
    ${
      lab
        ? `<section class="lab">
        <h3><span class="led" aria-hidden="true"></span>The box in the corner</h3>
        <p>${esc(lab.problem)}</p>
        ${chips(lab.stack)}
        ${lab.url ? `<p><a class="link" href="${lab.url}" target="_blank" rel="noopener">${esc(lab.name)} on GitHub ↗</a></p>` : ''}
      </section>`
        : ''
    }`;
}

function contact(h: string): string {
  const gh = profile.links.github.replace('https://', '');
  const li = profile.links.linkedin.replace('https://', '');
  return `
    <${h} class="p-title" id="panel-title">Let's talk</${h}>
    <p>${esc(profile.contactNote)}</p>
    <ul class="contact">
      <li><a href="mailto:${profile.email}"><span>Email</span><b>${esc(profile.email)}</b></a></li>
      <li><a href="${profile.links.linkedin}" target="_blank" rel="noopener"><span>LinkedIn</span><b>${esc(li)}</b></a></li>
      <li><a href="${profile.links.github}" target="_blank" rel="noopener"><span>GitHub</span><b>${esc(gh)}</b></a></li>
      <li><a href="${profile.resume}" target="_blank" rel="noopener"><span>Résumé</span><b>resume.pdf</b></a></li>
    </ul>
    <p class="muted">${esc(profile.location)}</p>`;
}

const builders: Record<SectionId, (h: string) => string> = {
  about,
  projects: work,
  experience: exp,
  skills: stack,
  contact,
};

export function sectionHTML(id: SectionId, heading = 'h2'): string {
  return builders[id](heading);
}

/** Full single-page document for browsers without WebGL2. */
export function fallbackHTML(): string {
  return `
    ${SECTIONS.map(
      (id) => `<section class="fb-section" id="${id}">${sectionHTML(id, id === 'about' ? 'h1' : 'h2').replace(/id="panel-title"/g, '')}</section>`,
    ).join('')}
    <footer class="fb-foot">This page is normally a small 3D studio; your browser does not support WebGL2, so here is everything in plain HTML.</footer>`;
}
