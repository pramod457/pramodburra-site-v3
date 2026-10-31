import './style.css';
import { profile } from './content';
import { GpuWorld, NullWorld, type WorldControl } from './world/world';
import { Terminal, draggable, cmd } from './terminal/terminal';
import { buildCommands } from './terminal/commands';

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const win = $('#term');
const dock = $<HTMLButtonElement>('#dock');
const statusEl = $('#status');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot() {
  await document.fonts.load('800 200px Inter').catch(() => {});

  let world: WorldControl = new NullWorld();
  let gpuOk = false;
  if ('gpu' in navigator) {
    const gw = new GpuWorld($<HTMLCanvasElement>('#world'));
    gpuOk = await gw.init().catch((e) => (console.warn(e), false));
    if (gpuOk) world = gw;
  }
  if (!gpuOk) document.body.classList.add('no-gpu');

  const term = new Terminal($('#out'), $<HTMLInputElement>('#in'), $('.inputline .prompt').outerHTML);
  term.register(buildCommands(world));

  // Keep shapes centred in whatever space the terminal leaves free.
  const refocus = () => {
    const top = 34;
    const r = win.getBoundingClientRect();
    const visible = !win.hidden && !win.classList.contains('min') && !win.classList.contains('max');
    const freeAbove = r.top - top;
    world.setFocus(top, visible && freeAbove > innerHeight * 0.3 ? r.top - 8 : innerHeight);
  };
  refocus();
  addEventListener('resize', refocus);
  new ResizeObserver(refocus).observe(win);
  draggable(win, $('.titlebar'), refocus);

  // window chrome
  $('.close').addEventListener('click', () => { win.hidden = true; dock.hidden = false; refocus(); });
  dock.addEventListener('click', () => { win.hidden = false; dock.hidden = true; refocus(); term.focus(); });
  $('.min').addEventListener('click', () => { win.classList.toggle('min'); refocus(); });
  $('.max').addEventListener('click', () => { win.classList.toggle('max'); refocus(); });
  $('.titlebar').addEventListener('dblclick', () => { win.classList.toggle('max'); refocus(); });
  $('#out').addEventListener('click', () => { if (!getSelection()?.toString()) term.focus(); });

  // menubar
  const clock = $('#clock');
  setInterval(() => {
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const s = world.stats();
    statusEl.innerHTML = gpuOk
      ? `WebGPU · <b>${s.particles.toLocaleString()}</b> particles · ${s.fps} fps`
      : 'lite mode · no WebGPU';
  }, 500);

  // boot sequence
  const s = world.stats();
  await term.type(`pramodburra.com — booting`, 'dim', 10);
  if (gpuOk) {
    term.print(`<span class="ok">[ ok ]</span> webgpu adapter: ${s.gpu}`);
    term.print(`<span class="ok">[ ok ]</span> ${s.maxParticles.toLocaleString()}-particle buffer · compute + render pipelines compiled`);
  } else {
    term.print(`<span class="err">[warn]</span> WebGPU unavailable in this browser — running lite mode (try Chrome, Edge or Safari 26)`);
  }
  await sleep(250);
  term.print(`<span class="h">${profile.name}</span> <span class="dim">— ${profile.role}</span>`);
  term.print(`11+ years taking AI from demo to production: conversational AI, LLM evaluation, integration platforms.`);
  term.print(`type ${cmd('help')} or start with ${cmd('about')} · ${cmd('projects')} · ${cmd('contact')}`);
  term.focus();

  // Let the big bang settle into a galaxy, spell the name, then let it go unless someone is already exploring.
  await sleep(1400);
  if (!term.history.length) world.formText(profile.name);
  await sleep(6500);
  if (!term.history.length) world.release();
}

boot();
