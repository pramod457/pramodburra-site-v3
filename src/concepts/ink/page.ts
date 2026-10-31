import { profile } from '../../content';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const arrow = '<span class="arr" aria-hidden="true">↗</span>';

export function renderPage(root: HTMLElement) {
  const facts = profile.facts
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');

  root.innerHTML = `
  <section class="hero" id="top" aria-labelledby="name">
    <p class="eyebrow reveal"><span>${esc(profile.role)}</span> <span class="sep">—</span> <span>${esc(profile.location)}</span></p>
    <h1 id="name" class="name"><span class="w">Pramod</span> <span class="w">Burra<span class="seal">.</span></span></h1>
    <div class="hero-foot reveal">
      <p class="summary">${esc(profile.summary)}</p>
      <dl class="facts">${facts}</dl>
      <div class="cta">
        <a class="btn btn--ink" href="#contact">Get in touch</a>
        <a class="btn" href="${esc(profile.resume)}" target="_blank" rel="noopener">Résumé (PDF) ${arrow}</a>
      </div>
    </div>
    <p class="hint reveal" aria-hidden="true"><em>Move through the water. The ink follows.</em></p>
  </section>

  <section class="section contact" id="contact" data-ink="left" data-ink-color="vermilion" aria-labelledby="contact-h">
    <header class="section-head">
      <h2 id="contact-h">Let’s talk.</h2>
    </header>
    <div class="contact-body panel">
      <p class="contact-note">${esc(profile.contactNote)}</p>
      <a class="email" href="mailto:${esc(profile.email)}">${esc(profile.email)}</a>
      <ul class="contact-links">
        <li><a href="${esc(profile.links.linkedin)}" target="_blank" rel="noopener">LinkedIn ${arrow}</a></li>
        <li><a href="${esc(profile.links.github)}" target="_blank" rel="noopener">GitHub ${arrow}</a></li>
        <li><a href="${esc(profile.resume)}" target="_blank" rel="noopener">Résumé (PDF) ${arrow}</a></li>
      </ul>
    </div>
  </section>

  <footer class="footer">
    <span>© ${new Date().getFullYear()} ${esc(profile.name)} · ${esc(profile.location)}</span>
    <span class="footer-note">Ink simulated live on your GPU: Navier–Stokes, in your browser.</span>
  </footer>`;
}
