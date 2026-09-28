// Pause / options menu: a modal over the dimmed world. In a game it pauses the simulation
// and holds the graphics, sound and controls settings plus restart and quit; on the title
// screen it opens with just the settings pages.
import { GOODS, PLAYER_COLORS } from '../game/defs';
import type { Game } from '../game/game';
import type { GameRenderer, Quality, RenderSettings } from '../render/renderer';
import type { Audio } from '../audio/audio';
import type { SeasonMode } from '../render/seasons';
import { OBJECTIVES, type Objectives } from './objectives';
import { applyAudioPrefs, applyRenderPrefs, defaultPrefs, prefs, savePrefs } from './prefs';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

type Page = 'overview' | 'graphics' | 'sound' | 'controls' | 'restart' | 'quit';
type NavId = Page | 'resume' | 'close' | 'save' | 'load' | '-';

interface NavItem { id: NavId; icon?: string; label?: string; cls?: string; kbd?: string; soon?: boolean }

const GAME_NAV: NavItem[] = [
  { id: 'resume', icon: '▶', label: 'Resume', cls: 'primary', kbd: 'Esc' },
  { id: 'overview', icon: '⚜', label: 'Overview' },
  { id: 'save', icon: '💾', label: 'Save game', soon: true },
  { id: 'load', icon: '📂', label: 'Load game', soon: true },
  { id: '-' },
  { id: 'graphics', icon: '🖼', label: 'Graphics' },
  { id: 'sound', icon: '🔊', label: 'Sound' },
  { id: 'controls', icon: '🎮', label: 'Controls' },
  { id: '-' },
  { id: 'restart', icon: '↻', label: 'Restart map', cls: 'danger' },
  { id: 'quit', icon: '⏏', label: 'Quit to title', cls: 'danger' },
];

const TITLE_NAV: NavItem[] = [
  { id: 'graphics', icon: '🖼', label: 'Graphics' },
  { id: 'sound', icon: '🔊', label: 'Sound' },
  { id: 'controls', icon: '🎮', label: 'Controls' },
  { id: '-' },
  { id: 'close', icon: '✕', label: 'Close', kbd: 'Esc' },
];

const PAGES: Record<Page, [string, string]> = {
  overview: ['Overview', 'The world stands still while this menu is open.'],
  graphics: ['Graphics', 'Changes apply at once. The land behind this menu shows them.'],
  sound: ['Sound', ''],
  controls: ['Controls', ''],
  restart: ['Restart map', ''],
  quit: ['Quit to title', ''],
};

const MAP_SIZES: Record<number, string> = { 128: 'Small', 160: 'Medium', 208: 'Large' };
const AI_LEVELS = ['Easy', 'Normal', 'Hard'];

const KEYS_VIEW: [string, string][] = [
  ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows', 'Scroll (hold <kbd>Shift</kbd> to go faster)'],
  ['Right or middle drag', 'Pan'],
  ['<kbd>Wheel</kbd> or <kbd>+</kbd> <kbd>−</kbd>', 'Zoom'],
  ['<kbd>Q</kbd> <kbd>E</kbd>', 'Rotate the view'],
  ['<kbd>H</kbd>', 'Jump to your headquarters'],
  ['Click the minimap', 'Jump there'],
];
const KEYS_ORDERS: [string, string][] = [
  ['Click', 'Select a building or settler, or place the chosen building'],
  ['<kbd>Shift</kbd> + click', 'Place buildings or cast spells in a row'],
  ['Right-click', 'Cancel placing, casting or the selection'],
  ['<kbd>Del</kbd>', 'Demolish the selected building'],
];
const KEYS_GAME: [string, string][] = [
  ['<kbd>Esc</kbd>', 'Cancel or deselect, then open this menu'],
  ['<kbd>F10</kbd>', 'Open or close this menu'],
  ['<kbd>Space</kbd>', 'Pause without the menu'],
  ['<kbd>1</kbd> – <kbd>4</kbd>', 'Game speed'],
];
const KEYS_TOUCH: [string, string][] = [
  ['Drag', 'Pan'],
  ['Pinch', 'Zoom'],
  ['Tap', 'Select or place'],
  ['⚒ button', 'Show or hide the build panel'],
];

export interface GameMenuOptions {
  game: Game;
  gr: GameRenderer;
  audio: Audio;
  /** a running game (pause menu) rather than the title screen (settings only) */
  inGame: boolean;
  objectives?: Objectives;
  onClose(): void;
  onRestart?(): void;
  onQuit?(): void;
}

export class GameMenu {
  el: HTMLElement;
  private nav: HTMLElement;
  private titleEl: HTMLElement;
  private descEl: HTMLElement;
  private body: HTMLElement;
  private page: Page;
  private returnFocus: HTMLElement | null;
  private inerted: Element[] = [];

  constructor(parent: HTMLElement, private o: GameMenuOptions) {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.el = h('div', 'gmenu');
    const modal = h('div', 'panel gm-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', o.inGame ? 'Game menu' : 'Options');
    this.nav = h('nav', 'gm-nav');
    const main = h('section', 'gm-body');
    const head = h('header');
    this.titleEl = h('h1');
    this.descEl = h('p');
    head.append(this.titleEl, this.descEl);
    this.body = h('div', 'gm-page');
    main.append(head, this.body);
    modal.append(this.nav, main);
    this.el.appendChild(modal);
    this.buildNav();
    // everything behind the modal stops taking focus and clicks
    for (const sib of parent.children) { sib.setAttribute('inert', ''); this.inerted.push(sib); }
    parent.appendChild(this.el);
    this.el.addEventListener('keydown', (e) => this.navKeys(e));
    this.page = o.inGame ? 'overview' : 'graphics';
    this.show(this.page);
    this.nav.querySelector<HTMLElement>('.gm-item:not(:disabled)')?.focus();
  }

  /** Esc: leave a confirmation, otherwise close the menu. */
  back() {
    if (this.page === 'restart' || this.page === 'quit') this.show('overview');
    else this.close();
  }

  close() {
    if (!this.el.isConnected) return;
    this.el.remove();
    for (const el of this.inerted) el.removeAttribute('inert');
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    this.o.onClose();
  }

  // ------------------------------------------------------------ frame
  private buildNav() {
    const g = this.o.game;
    this.nav.appendChild(h('div', 'gm-head', this.o.inGame
      ? `<div class="crest">⚜</div><h2>Paused</h2><small>⏱ ${clock(g.time)} played</small>`
      : `<div class="crest">⚜</div><h2>Options</h2>`));
    for (const it of this.o.inGame ? GAME_NAV : TITLE_NAV) {
      if (it.id === '-') { this.nav.appendChild(h('div', 'gm-sep')); continue; }
      const extra = it.soon ? '<span class="tag">Soon</span>' : it.kbd ? `<kbd>${it.kbd}</kbd>` : '';
      const b = h('button', `gm-item ${it.cls ?? ''}`, `<span class="ic">${it.icon}</span><span>${it.label}</span>${extra}`) as HTMLButtonElement;
      b.dataset.id = it.id;
      if (it.soon) { b.disabled = true; b.title = 'Saving and loading games is not built yet'; }
      b.onclick = () => {
        this.o.audio.play('ui');
        if (it.id === 'resume' || it.id === 'close') this.close();
        else this.show(it.id as Page);
      };
      this.nav.appendChild(b);
    }
  }

  private navKeys(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...this.nav.querySelectorAll<HTMLElement>('.gm-item:not(:disabled)')];
    const i = items.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }

  private show(page: Page) {
    this.page = page;
    this.nav.querySelectorAll<HTMLElement>('.gm-item').forEach((b) => {
      const on = b.dataset.id === page;
      b.classList.toggle('on', on);
      if (on) {
        b.setAttribute('aria-current', 'page');
        // on phones the nav is a sideways strip: keep the current page's chip in sight
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else b.removeAttribute('aria-current');
    });
    const [title, desc] = PAGES[page];
    this.titleEl.textContent = title;
    this.descEl.textContent = desc;
    // the graphics page lifts the dimming so changes can be judged on the land itself
    this.el.classList.toggle('peek', page === 'graphics');
    const c = this.body;
    c.innerHTML = '';
    c.scrollTop = 0;
    switch (page) {
      case 'overview': return this.renderOverview(c);
      case 'graphics': return this.renderGraphics(c);
      case 'sound': return this.renderSound(c);
      case 'controls': return this.renderControls(c);
      case 'restart':
      case 'quit': return this.renderConfirm(c, page);
    }
  }

  // ------------------------------------------------------------ pages
  private renderOverview(c: HTMLElement) {
    const g = this.o.game;
    const me = g.players[g.local];
    const level = g.ai[0]?.level ?? g.opts.aiLevel;
    let produced = 0;
    for (const gd of GOODS) produced += me.produced[gd];
    const kv = (k: string, v: string) => c.appendChild(h('div', 'kv', `<span>${k}</span><b>${v}</b>`));
    c.appendChild(h('h3', '', 'This game'));
    kv('Map', `${MAP_SIZES[g.opts.size] ?? `${g.opts.size}²`} · seed ${g.opts.seed}`);
    kv('Rivals', `${g.players.length - 1} · ${AI_LEVELS[level] ?? 'Normal'}`);
    kv('Time played', clock(g.time));
    kv('Goods produced', String(produced));
    if (this.o.objectives) {
      const ob = OBJECTIVES[this.o.objectives.index];
      kv('Chronicle', ob ? `${ob.text}${ob.progress ? ` <small>${ob.progress(g)}</small>` : ''}` : 'Complete');
    }
    c.appendChild(h('h3', '', 'Kingdoms'));
    for (const p of g.players) {
      const pop = g.population(p.id);
      kv(`<i class="sw" style="background:${hex(PLAYER_COLORS[p.id])}"></i>${p.name}${p.id === g.local ? ' (you)' : ''}${p.alive ? '' : ' · defeated'}`,
        `👥 ${pop.total} · ⚔ ${pop.soldiers} · 🏠 ${g.countBuildings(p.id, undefined, false)}`);
    }
    c.appendChild(h('p', 'note', 'Games cannot be saved yet, so restarting or quitting ends this one for good.'));
  }

  private renderGraphics(c: HTMLElement) {
    const gr = this.o.gr;
    const s = prefs.render;
    const set = <K extends keyof RenderSettings>(k: K) => (v: RenderSettings[K]) => {
      s[k] = v;
      gr.settings[k] = v;
      gr.applyQuality();
    };
    c.appendChild(h('h3', '', 'Quality'));
    c.appendChild(this.seg('Detail level', 'Resolution and shadow sharpness. Lower it if the game stutters.',
      [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], () => s.quality, (v) => set('quality')(v as Quality)));
    c.appendChild(h('h3', '', 'Effects'));
    c.appendChild(this.toggle('Bloom and glow', 'Glowing windows, forges and water glints', () => s.bloom, set('bloom')));
    c.appendChild(this.toggle('Tilt-shift depth of field', 'Miniature diorama look', () => s.dof, set('dof')));
    c.appendChild(this.toggle('Ambient occlusion', 'Soft contact shadows. Costs a few milliseconds a frame.', () => s.ao, set('ao')));
    c.appendChild(this.toggle('Colour grading', 'Filmic tone and vignette', () => s.grade, set('grade')));
    c.appendChild(this.toggle('Grass tufts', 'Wind-swept grass blades (always off on Low)', () => s.grass, set('grass')));
    c.appendChild(this.toggle('Water reflections', 'The land mirrored in lakes and sea', () => s.reflections, set('reflections')));
    c.appendChild(h('h3', '', 'World'));
    c.appendChild(this.select('Weather', '', [['auto', 'Changing'], ['clear', 'Always clear'], ['rain', 'Rain'], ['snow', 'Snow']],
      () => s.weather, (v) => set('weather')(v as RenderSettings['weather'])));
    c.appendChild(this.select('Season', 'Picking one runs the year forward to it', [['auto', 'Changing'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']],
      () => prefs.season, (v) => { prefs.season = v as SeasonMode; gr.seasons.mode = prefs.season; }));
    c.appendChild(this.toggle('Day and night cycle', 'Off holds the sun where it is', () => s.dayCycle, set('dayCycle')));
    const hhmm = (v: number) => { const m = Math.round(v * 24 * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    c.appendChild(this.slider('Time of day', '', 0, 1, 1 / 96, () => gr.sky.timeOfDay, (v) => { gr.sky.timeOfDay = v; }, hhmm));
    c.appendChild(this.select('Day length', 'A full day at normal speed', [['300', '5 min'], ['600', '10 min'], ['1200', '20 min'], ['2400', '40 min']],
      () => String(prefs.dayLength), (v) => { prefs.dayLength = Number(v); gr.sky.dayLength = prefs.dayLength; }));
    c.appendChild(h('h3', '', 'Interface'));
    c.appendChild(this.toggle('Territory borders', 'Border posts and tinted realm edges', () => s.borders, set('borders')));
    c.appendChild(this.toggle('Frame rate counter', 'Shown at the end of the top bar', () => prefs.showFps, (v) => { prefs.showFps = v; }));
    this.resetButton(c, 'Reset graphics to defaults', () => {
      const d = defaultPrefs();
      Object.assign(prefs, { render: d.render, season: d.season, dayLength: d.dayLength, showFps: d.showFps });
      applyRenderPrefs(gr);
    });
  }

  private renderSound(c: HTMLElement) {
    const a = this.o.audio;
    const apply = () => applyAudioPrefs(a);
    if (!a.started) c.appendChild(h('p', 'note', 'Sound starts with your first click or key press. Browsers require it.'));
    c.appendChild(h('h3', '', 'Volume'));
    c.appendChild(this.slider('Master volume', '', 0, 1, 0.01, () => prefs.volume, (v) => { prefs.volume = v; apply(); }, pct));
    c.appendChild(this.slider('Effects', 'Work, building and battle sounds', 0, 1, 0.01, () => prefs.sfx, (v) => { prefs.sfx = v; apply(); }, pct, () => a.play('built')));
    c.appendChild(this.slider('Ambience', 'Wind, rain and birdsong', 0, 1, 0.01, () => prefs.ambience, (v) => { prefs.ambience = v; apply(); }, pct));
    c.appendChild(h('h3', '', 'Music'));
    c.appendChild(this.toggle('Play music', 'A generative lute over a drone', () => prefs.musicOn, (v) => { prefs.musicOn = v; apply(); }));
    c.appendChild(this.slider('Music volume', '', 0, 1, 0.01, () => prefs.music, (v) => { prefs.music = v; apply(); }, pct));
    this.resetButton(c, 'Reset sound to defaults', () => {
      const d = defaultPrefs();
      Object.assign(prefs, { volume: d.volume, sfx: d.sfx, ambience: d.ambience, musicOn: d.musicOn, music: d.music });
      apply();
    });
  }

  private renderControls(c: HTMLElement) {
    const cam = this.o.gr.cam;
    c.appendChild(h('h3', '', 'Camera'));
    c.appendChild(this.toggle('Edge scrolling', 'Move the view when the pointer touches the edge of the screen', () => prefs.edgeScroll, (v) => { prefs.edgeScroll = v; cam.edgeScroll = v; }));
    c.appendChild(this.slider('Scroll speed', 'Keyboard and edge scrolling', 0.5, 2, 0.1, () => prefs.scrollSpeed, (v) => { prefs.scrollSpeed = v; cam.scrollSpeed = v; }, (v) => `${v.toFixed(1)}×`));
    const keys = (title: string, rows: [string, string][]) => {
      c.appendChild(h('h3', '', title));
      c.appendChild(h('dl', 'keys-grid', rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')));
    };
    keys('View', KEYS_VIEW);
    keys('Orders', KEYS_ORDERS);
    keys('Game', KEYS_GAME);
    keys('Touch', KEYS_TOUCH);
    this.resetButton(c, 'Reset controls to defaults', () => {
      const d = defaultPrefs();
      Object.assign(prefs, { edgeScroll: d.edgeScroll, scrollSpeed: d.scrollSpeed });
      cam.edgeScroll = prefs.edgeScroll;
      cam.scrollSpeed = prefs.scrollSpeed;
    });
  }

  private renderConfirm(c: HTMLElement, page: 'restart' | 'quit') {
    const restart = page === 'restart';
    const box = h('div', 'gm-confirm', `
      <div class="crest">${restart ? '↻' : '⏏'}</div>
      <p>${restart ? 'Start this map again from the beginning? The land, the seed and your rivals stay the same.' : 'Leave this game and return to the title screen?'}</p>
      <p class="muted">Games cannot be saved yet, so your progress will be lost.</p>
      <div class="row"><button class="wide" data-a="no">Keep playing</button><button class="wide danger" data-a="yes">${restart ? 'Restart map' : 'Quit to title'}</button></div>`);
    c.appendChild(box);
    const no = box.querySelector<HTMLButtonElement>('[data-a=no]')!;
    no.onclick = () => { this.o.audio.play('ui'); this.show('overview'); };
    box.querySelector<HTMLButtonElement>('[data-a=yes]')!.onclick = () => {
      this.close();
      (restart ? this.o.onRestart : this.o.onQuit)?.();
    };
    no.focus();
  }

  // ------------------------------------------------------------ controls
  private row(label: string, desc: string, ctl: HTMLElement, tag = 'label', cls = '') {
    const row = h(tag, `opt ${cls}`, `<div class="lbl"><b>${label}</b>${desc ? `<small>${desc}</small>` : ''}</div>`);
    const box = h('div', 'ctl');
    box.appendChild(ctl);
    row.appendChild(box);
    return row;
  }

  private toggle(label: string, desc: string, get: () => boolean, set: (v: boolean) => void) {
    const sw = h('span', 'switch', '<input type="checkbox" role="switch"><i></i>');
    const inp = sw.querySelector('input')!;
    inp.checked = get();
    inp.onchange = () => { set(inp.checked); savePrefs(); this.o.audio.play('ui'); };
    return this.row(label, desc, sw, 'label', 'opt-switch');
  }

  private slider(label: string, desc: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string, done?: () => void) {
    const box = h('span', 'range');
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(get());
    const out = document.createElement('output');
    out.textContent = fmt(get());
    inp.oninput = () => { const v = Number(inp.value); set(v); out.textContent = fmt(v); };
    inp.onchange = () => { savePrefs(); done?.(); };
    box.append(inp, out);
    return this.row(label, desc, box);
  }

  private select(label: string, desc: string, options: [string, string][], get: () => string, set: (v: string) => void) {
    const sel = document.createElement('select');
    sel.innerHTML = options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    sel.value = get();
    sel.onchange = () => { set(sel.value); savePrefs(); };
    return this.row(label, desc, sel);
  }

  private seg(label: string, desc: string, options: [string, string][], get: () => string, set: (v: string) => void) {
    const box = h('div', 'seg');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', label);
    box.style.gridTemplateColumns = `repeat(${options.length}, 1fr)`;
    for (const [v, t] of options) {
      const b = h('button', v === get() ? 'on' : '', t);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === get()));
      b.onclick = () => {
        set(v);
        savePrefs();
        this.o.audio.play('ui');
        box.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      };
      box.appendChild(b);
    }
    // a <label> would forward clicks on its text to the first button
    return this.row(label, desc, box, 'div');
  }

  private resetButton(c: HTMLElement, label: string, reset: () => void) {
    const b = h('button', 'wide gm-reset', label);
    b.onclick = () => { reset(); savePrefs(); this.o.audio.play('ui'); this.show(this.page); };
    c.appendChild(b);
  }
}
