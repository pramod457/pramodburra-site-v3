export type Ctx = {
  term: Terminal;
  args: string[];
  raw: string;
};

export type Command = {
  name: string;
  desc: string;
  usage?: string;
  aliases?: string[];
  hidden?: boolean;
  run: (ctx: Ctx) => void | Promise<void>;
};

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A clickable command in output: `cmd('projects')` renders a link that runs it. */
export const cmd = (line: string, label = line) => `<button class="cmd" data-cmd="${esc(line)}">${esc(label)}</button>`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Terminal {
  readonly history: string[] = [];
  private hIndex = 0;
  private commands = new Map<string, Command>();
  private busy = false;

  constructor(
    private out: HTMLElement,
    private input: HTMLInputElement,
    private prompt: string,
  ) {
    input.addEventListener('keydown', (e) => this.onKey(e));
    // Any clickable command anywhere on the page runs through the terminal.
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
      if (el) this.exec(el.dataset.cmd!);
    });
  }

  register(list: Command[]) {
    for (const c of list) [c.name, ...(c.aliases ?? [])].forEach((n) => this.commands.set(n, c));
  }

  list(): Command[] {
    return [...new Set(this.commands.values())];
  }

  print(html: string, cls = '') {
    const div = document.createElement('div');
    div.className = `line ${cls}`;
    div.innerHTML = html;
    this.out.appendChild(div);
    this.scroll();
    return div;
  }

  /** Types a line out character by character (plain text only). */
  async type(text: string, cls = '', speed = 12) {
    const div = this.print('', cls);
    for (let i = 0; i < text.length; i += 2) {
      div.textContent = text.slice(0, i + 2);
      this.scroll();
      await sleep(speed);
    }
  }

  clear() { this.out.innerHTML = ''; }

  focus() {
    // Don't pop the mobile keyboard unless the user asked for it.
    if (!matchMedia('(pointer: coarse)').matches) this.input.focus({ preventScroll: true });
  }

  async exec(line: string, echo = true) {
    if (this.busy) return;
    const raw = line.trim();
    if (echo) this.print(`<span class="prompt">${this.prompt}</span> ${esc(raw)}`, 'echo');
    if (!raw) return;
    if (this.history[this.history.length - 1] !== raw) this.history.push(raw);
    this.hIndex = this.history.length;

    const [name, ...args] = raw.split(/\s+/);
    const c = this.commands.get(name.toLowerCase());
    if (!c) {
      this.print(`command not found: ${esc(name)}. try ${cmd('help')}`, 'err');
      return;
    }
    this.busy = true;
    try {
      await c.run({ term: this, args, raw: raw.slice(name.length).trim() });
    } catch (err) {
      this.print(esc(String(err)), 'err');
    } finally {
      this.busy = false;
      this.focus();
    }
  }

  private scroll() { this.out.scrollTop = this.out.scrollHeight; }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const v = this.input.value;
      this.input.value = '';
      this.exec(v);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.hIndex = Math.max(0, Math.min(this.history.length, this.hIndex + (e.key === 'ArrowUp' ? -1 : 1)));
      this.input.value = this.history[this.hIndex] ?? '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const v = this.input.value.toLowerCase();
      const hits = [...this.commands.keys()].filter((n) => n.startsWith(v) && !this.commands.get(n)!.hidden);
      if (hits.length === 1) this.input.value = hits[0] + ' ';
      else if (hits.length > 1) this.print(hits.map((h) => cmd(h)).join('  '), 'dim');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      this.clear();
    }
  }
}

/** Makes a fixed-position element draggable by its handle, clamped to the viewport. */
export function draggable(win: HTMLElement, handle: HTMLElement, onMove: () => void) {
  let sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || win.classList.contains('max')) return;
    const r = win.getBoundingClientRect();
    Object.assign(win.style, { left: `${r.left}px`, top: `${r.top}px`, bottom: 'auto', transform: 'none' });
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    handle.setPointerCapture(e.pointerId);
    win.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const x = Math.max(0, Math.min(innerWidth - 120, ox + e.clientX - sx));
    const y = Math.max(28, Math.min(innerHeight - 40, oy + e.clientY - sy));
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
    onMove();
  });
  handle.addEventListener('pointerup', (e) => {
    handle.releasePointerCapture(e.pointerId);
    win.classList.remove('dragging');
    onMove();
  });
}
