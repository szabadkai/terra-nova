// Pause / options menu: a modal over the dimmed world. In a game it pauses the simulation
// and holds the graphics, sound and controls settings plus restart and quit; on the title
// screen it opens with just the settings pages.
import { GOODS, PLAYER_COLORS } from '../game/defs';
import type { Game } from '../game/game';
import type { GameRenderer, Quality, RenderSettings, Resolution } from '../render/renderer';
import { framePace, type FrameCap } from '../render/framePace';
import type { Audio } from '../audio/audio';
import type { SeasonMode } from '../render/seasons';
import type { Objectives } from './objectives';
import { missionIndex, numeralOf } from '../game/campaign';
import { applyAudioPrefs, applyControlPrefs, applyRenderPrefs, defaultPrefs, defaultRender, detectGraphics, prefs, savePrefs } from './prefs';
import { LEVELS, LEVEL_NAMES, levelText } from '../render/hardware';
import type { WheelMode } from '../render/camera';
import { AUTO, playTime, saveSubtitle, type SaveSummary } from './saveStore';
import { enterImmersive, immersiveAvailable, isImmersive, leaveHint, leaveImmersive } from './immersive';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

type Page = 'overview' | 'save' | 'load' | 'graphics' | 'sound' | 'controls' | 'restart' | 'quit';
type NavId = Page | 'resume' | 'close' | '-';

interface NavItem { id: NavId; icon?: string; label?: string; cls?: string; kbd?: string; soon?: boolean }

const GAME_NAV: NavItem[] = [
  { id: 'resume', icon: '▶', label: 'Resume', cls: 'primary', kbd: 'Esc' },
  { id: 'overview', icon: '⚜', label: 'Overview' },
  { id: 'save', icon: '💾', label: 'Save game' },
  { id: 'load', icon: '📂', label: 'Load game' },
  { id: '-' },
  { id: 'graphics', icon: '🖼', label: 'Graphics' },
  { id: 'sound', icon: '🔊', label: 'Sound' },
  { id: 'controls', icon: '🎮', label: 'Controls' },
  { id: '-' },
  { id: 'restart', icon: '↻', label: 'Restart map', cls: 'danger' },
  { id: 'quit', icon: '⏏', label: 'Quit to title', cls: 'danger' },
];

const TITLE_NAV: NavItem[] = [
  { id: 'load', icon: '📂', label: 'Load game' },
  { id: '-' },
  { id: 'graphics', icon: '🖼', label: 'Graphics' },
  { id: 'sound', icon: '🔊', label: 'Sound' },
  { id: 'controls', icon: '🎮', label: 'Controls' },
  { id: '-' },
  { id: 'close', icon: '✕', label: 'Close', kbd: 'Esc' },
];

const PAGES: Record<Page, [string, string]> = {
  overview: ['Overview', 'The world stands still while this menu is open.'],
  save: ['Save game', 'Your game also saves itself every half minute and whenever you leave the page.'],
  load: ['Load game', 'Saved games live in this browser. Download a save file to keep one elsewhere.'],
  graphics: ['Graphics', 'Changes apply at once. The land behind this menu shows them.'],
  sound: ['Sound', ''],
  controls: ['Controls', ''],
  restart: ['Restart map', ''],
  quit: ['Quit to title', ''],
};

const MAP_SIZES: Record<number, string> = { 128: 'Small', 160: 'Medium', 208: 'Large' };
const AI_LEVELS = ['Easy', 'Normal', 'Hard'];

const KEYS_VIEW: [string, string][] = [
  ['Right-drag', 'Grab the ground and drag the view'],
  ['<kbd>Wheel</kbd>', 'Zoom towards the pointer'],
  ['Middle-drag, or <kbd>Alt</kbd>/<kbd>⌥</kbd> + drag', 'Turn the view (sideways) and tilt it (up and down)'],
  ['<kbd>Shift</kbd> + wheel', 'Turn the view'],
  ['Middle-click or the minimap compass', 'Face north again'],
  ['⟲ ⟳ under the minimap', 'Turn the view by an eighth'],
  ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, arrows or the screen edge', 'Scroll (hold <kbd>Shift</kbd> to go faster)'],
  ['<kbd>Q</kbd> <kbd>E</kbd> · <kbd>+</kbd> <kbd>−</kbd>', 'Turn · zoom'],
  ['<kbd>H</kbd>', 'Jump to your headquarters'],
  ['<kbd>.</kbd> or ⚠ in the top bar', 'Go to the next stalled building (<kbd>Shift</kbd>: the one before)'],
  ['<kbd>B</kbd>', 'Stall badges: the three that hold up the most, all of them, or none'],
  ['Click or drag on the minimap', 'Jump there'],
];
const KEYS_ORDERS: [string, string][] = [
  ['Click', 'Select a building or settler, or place the chosen building'],
  ['<kbd>Shift</kbd> + click', 'Place buildings or cast spells in a row'],
  ['Right-click', 'Cancel placing, casting or the selection'],
  ['<kbd>Del</kbd>', 'Demolish the selected building'],
];
const KEYS_ARMY: [string, string][] = [
  ['Left-drag', 'Draw a box around your soldiers to pick them (<kbd>Shift</kbd> adds)'],
  ['<kbd>Shift</kbd> + click a soldier', 'Add him to the group, or take him out'],
  ['Double-click or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + click a soldier', 'Pick all of his kind on screen'],
  ['Right-click the ground', 'March the picked soldiers there to stand guard'],
  ['Right-click a stronghold', 'Storm an enemy one (⚔ cursor), or man one of yours (shield cursor)'],
  ['Right-click the minimap', 'March them there'],
  ['Formation buttons in their panel', 'Line, block, wedge or ring: they form up facing the way they marched, swordsmen in front; the rings on the ground show where'],
  ['🛡 Stand firm', 'They keep their posts and let the foe come to them instead of charging out'],
  ['<kbd>R</kbd>', 'Send the picked soldiers back to duty'],
  ['<kbd>Ctrl</kbd> or <kbd>⌥</kbd>/<kbd>Alt</kbd> + <kbd>1</kbd> – <kbd>9</kbd>, <kbd>0</kbd>', 'Keep the picked soldiers (or warships) as a group (<kbd>Shift</kbd> adds them to it)'],
  ['<kbd>1</kbd> – <kbd>9</kbd>, <kbd>0</kbd>', 'Pick that group again (<kbd>Shift</kbd> adds it to the picked ones); press twice to go there'],
];
const KEYS_GAME: [string, string][] = [
  ['<kbd>Esc</kbd>', 'Cancel or deselect, then open this menu'],
  ['<kbd>F10</kbd>', 'Open or close this menu'],
  ...(immersiveAvailable ? [['<kbd>F</kbd>', `Immersive mode: fill the screen (${leaveHint.replace('Esc', '<kbd>Esc</kbd>')})`]] as [string, string][] : []),
  ['<kbd>Space</kbd>', 'Pause without the menu'],
  ['<kbd>[</kbd> <kbd>]</kbd>', 'Game speed slower / faster'],
  ['<kbd>N</kbd>', 'Next music track (<kbd>Shift</kbd> for the previous one)'],
];
const KEYS_TRACKPAD: [string, string][] = [
  ['Pinch', 'Zoom towards the fingers'],
  ['Two-finger swipe', 'Pan once you have pinched (see Scroll wheel above)'],
  ['<kbd>⌥</kbd> + drag, or <kbd>Shift</kbd> + swipe', 'Turn the view'],
  ['Twist (Safari)', 'Turn the view'],
  ['Two-finger click and drag', 'Grab the ground and drag the view'],
];
const KEYS_TOUCH: [string, string][] = [
  ['Drag', 'Pan'],
  ['Pinch and twist', 'Zoom and turn'],
  ['Tap', 'Select or place'],
  ['⚒ button', 'Show or hide the build panel'],
];

export interface GameMenuOptions {
  game: Game;
  gr: GameRenderer;
  audio: Audio;
  /** a running game (pause menu) rather than the title screen (settings only) */
  inGame: boolean;
  /** a game with a friend: it goes on behind the menu, and cannot be saved or restarted */
  net?: boolean;
  objectives?: Objectives;
  /** page to open on (default: overview in a game, graphics on the title screen) */
  page?: Page;
  saves?: SaveHooks;
  onClose(): void;
  onRestart?(): void;
  onQuit?(): void;
}

export interface SaveHooks {
  list(): Promise<SaveSummary[]>;
  /** save the running game under `name`, over slot `id` if given */
  save(name: string, id?: string): Promise<void>;
  load(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  exportFile(): Promise<void>;
  importFile(file: File): Promise<void>;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

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
    this.page = o.page ?? (o.inGame ? 'overview' : 'graphics');
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
    const nav = (this.o.inGame ? GAME_NAV : TITLE_NAV).filter((it) => !this.o.net || !['save', 'load', 'restart'].includes(it.id));
    for (const it of nav) {
      if (it.id === '-') { this.nav.appendChild(h('div', 'gm-sep')); continue; }
      if ((it.id === 'save' || it.id === 'load') && !this.o.saves) continue;
      const extra = it.soon ? '<span class="tag">Soon</span>' : it.kbd ? `<kbd>${it.kbd}</kbd>` : '';
      const b = h('button', `gm-item ${it.cls ?? ''}`, `<span class="ic">${it.icon}</span><span>${it.label}</span>${extra}`) as HTMLButtonElement;
      b.dataset.id = it.id;
      if (it.soon) b.disabled = true;
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
    this.descEl.textContent = page === 'overview' && this.o.net ? 'The game goes on while this menu is open: your friend is still playing.' : desc;
    // the graphics page lifts the dimming so changes can be judged on the land itself
    this.el.classList.toggle('peek', page === 'graphics');
    const c = this.body;
    c.innerHTML = '';
    c.scrollTop = 0;
    switch (page) {
      case 'overview': return this.renderOverview(c);
      case 'save': return this.renderSave(c);
      case 'load': return this.renderLoad(c);
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
    const m = g.mission;
    if (m) kv('Mission', `${numeralOf(missionIndex(m.id))} · ${m.title}`);
    kv('Map', `${MAP_SIZES[g.opts.size] ?? `${g.opts.size}²`} · seed ${g.opts.seed}`);
    if (g.players.length > 1) kv('Rivals', `${g.players.length - 1} · ${AI_LEVELS[level] ?? 'Normal'}`);
    kv('Time played', clock(g.time));
    kv('Goods produced', String(produced));
    if (this.o.objectives) {
      const ob = this.o.objectives.current;
      kv(m ? 'Goal' : 'Chronicle', ob ? `${ob.text}${ob.progress ? ` <small>${ob.progress(g)}</small>` : ''}` : 'Complete');
    }
    c.appendChild(h('h3', '', 'Kingdoms'));
    for (const p of g.players) {
      const pop = g.population(p.id);
      kv(`<i class="sw" style="background:${hex(PLAYER_COLORS[p.id])}"></i>${p.name}${p.id === g.local ? ' (you)' : ''}${p.alive ? (p.fallen ? ' · headquarters fallen' : '') : ' · defeated'}`,
        `👥 ${pop.total} · ⚔ ${pop.soldiers} · 🏠 ${g.countBuildings(p.id, undefined, false)}`);
    }
  }

  private renderSave(c: HTMLElement) {
    const saves = this.o.saves!;
    const g = this.o.game;
    c.appendChild(h('h3', '', 'New save'));
    const form = h('form', 'save-new') as HTMLFormElement;
    form.innerHTML = `<input type="text" maxlength="48" aria-label="Name of the saved game" spellcheck="false"><button class="wide primary" type="submit">Save</button>`;
    const name = form.querySelector('input')!;
    name.value = `Seed ${g.opts.seed} · ${playTime(g.time)}`;
    const status = h('p', 'note save-status');
    form.onsubmit = (e) => {
      e.preventDefault();
      this.o.audio.play('ui');
      void this.act(status, () => saves.save(name.value.trim() || name.placeholder || 'Saved game'), 'Game saved', () => this.show('save'));
    };
    c.append(form, status);
    c.appendChild(h('h3', '', 'Save over'));
    const list = h('div', 'save-list');
    c.appendChild(list);
    this.fillList(list, status, (sv) => sv.id !== AUTO, (sv) => [
      this.confirmButton('Overwrite', 'Overwrite?', () => this.act(status, () => saves.save(sv.name, sv.id), 'Game saved', () => this.show('save'))),
      this.deleteButton(sv, status),
    ], 'No saved games yet.');
    c.appendChild(h('h3', '', 'Save file'));
    const dl = h('button', 'wide gm-file', '⬇ Download a save file');
    dl.onclick = () => { this.o.audio.play('ui'); void this.act(status, () => saves.exportFile(), 'Save file downloaded'); };
    c.appendChild(dl);
    c.appendChild(h('p', 'note', 'Keep a copy outside this browser, or carry a game over to another computer.'));
    name.focus();
    name.select();
  }

  private renderLoad(c: HTMLElement) {
    const saves = this.o.saves!;
    const status = h('p', 'note save-status');
    if (this.o.inGame) c.appendChild(h('p', 'note', 'Loading ends this game. Anything since you last saved it is lost.'));
    const list = h('div', 'save-list');
    c.append(status, list);
    this.fillList(list, status, () => true, (sv) => {
      const load = h('button', 'wide primary', 'Load') as HTMLButtonElement;
      load.onclick = () => {
        this.o.audio.play('ui');
        this.el.querySelectorAll<HTMLButtonElement>('.save-list button').forEach((b) => (b.disabled = true));
        void this.act(status, () => saves.load(sv.id), '', () => this.el.querySelectorAll<HTMLButtonElement>('.save-list button').forEach((b) => (b.disabled = false)));
      };
      return sv.id === AUTO ? [load] : [load, this.deleteButton(sv, status)];
    }, 'No saved games yet. Your game saves itself as you play, and the Save game page keeps as many as you like.');
    c.appendChild(h('h3', '', 'Save file'));
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = '.tnsave';
    pick.hidden = true;
    pick.onchange = () => {
      const f = pick.files?.[0];
      if (f) void this.act(status, () => saves.importFile(f), '');
      pick.value = '';
    };
    const up = h('button', 'wide gm-file', '⬆ Load a save file…');
    up.onclick = () => { this.o.audio.play('ui'); pick.click(); };
    c.append(up, pick);
  }

  /** Run a save action and report how it went (in the page's status line, which `after` may rebuild). */
  private async act(status: HTMLElement, fn: () => Promise<void>, ok: string, after?: () => void) {
    status.classList.remove('bad');
    status.textContent = 'One moment…';
    let msg = ok, bad = false;
    try { await fn(); } catch (e) { msg = (e as Error)?.message ?? String(e); bad = true; }
    if (!this.el.isConnected) return; // a game was loaded and the menu closed
    after?.();
    const line = this.body.querySelector<HTMLElement>('.save-status') ?? status;
    line.textContent = msg;
    line.classList.toggle('bad', bad);
  }

  private fillList(list: HTMLElement, status: HTMLElement, keep: (s: SaveSummary) => boolean, actions: (s: SaveSummary) => HTMLElement[], empty: string) {
    list.innerHTML = '<p class="note">Reading saved games…</p>';
    this.o.saves!.list().then((all) => {
      const shown = all.filter(keep);
      list.innerHTML = '';
      if (!shown.length) { list.appendChild(h('p', 'note', empty)); return; }
      for (const sv of shown) {
        const m = sv.meta;
        const row = h('div', 'save-row');
        const thumb = h('div', 'save-thumb');
        if (m.thumb) thumb.style.backgroundImage = `url("${m.thumb}")`;
        const text = h('div', 'save-text', `<b>${esc(sv.id === AUTO ? 'Autosave — the last game played' : sv.name)}</b>
          <small>${esc(saveSubtitle(m))}</small>
          <small>👥 ${m.pop} · ⚔ ${m.soldiers} · 🏠 ${m.buildings} · seed ${m.seed}${m.over ? (m.won ? ' · won' : ' · lost') : ''}</small>`);
        const acts = h('div', 'save-acts');
        acts.append(...actions(sv));
        row.append(thumb, text, acts);
        list.appendChild(row);
      }
    }).catch((e) => {
      list.innerHTML = '';
      status.textContent = `Saved games are unavailable: ${(e as Error)?.message ?? e}`;
      status.classList.add('bad');
    });
  }

  /** A button that asks once more before it acts. */
  private confirmButton(label: string, ask: string, fn: () => Promise<void> | void, cls = '') {
    const b = h('button', `wide ${cls}`, label) as HTMLButtonElement;
    let armed = false;
    b.onclick = () => {
      this.o.audio.play('ui');
      if (!armed) { armed = true; b.textContent = ask; b.classList.add('danger'); return; }
      void fn();
    };
    b.onblur = () => { armed = false; b.textContent = label; b.classList.remove('danger'); };
    return b;
  }

  private deleteButton(sv: SaveSummary, status: HTMLElement) {
    const b = this.confirmButton('🗑', 'Delete?', () => this.act(status, () => this.o.saves!.remove(sv.id), 'Deleted', () => this.show(this.page)), 'save-del');
    b.title = 'Delete this saved game';
    b.setAttribute('aria-label', `Delete ${sv.name}`);
    return b;
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
    const rec = prefs.hw.level;
    c.appendChild(this.seg('Detail level', `Resolution and shadow sharpness. Lower it if the game stutters.${rec ? ' ★ marks the level recommended for this machine.' : ''}`,
      LEVELS.map((q) => [q, LEVEL_NAMES[q]]), () => s.quality, (v) => set('quality')(v as Quality), rec || undefined));
    c.appendChild(this.detectRow());
    c.appendChild(this.seg('Resolution', 'The world is drawn at this share of the screen and scaled up. The biggest saving on large, high-refresh screens. Auto draws at full and drops to 92% or 85% only while frames keep running late, and the counter shows when it does.',
      [['auto', 'Auto'], ['full', 'Full'], ['85', '85%'], ['70', '70%'], ['50', '50%']], () => s.resolution, (v) => set('resolution')(v as Resolution)));
    const hz = framePace.hz;
    const fps = (cap: FrameCap) => `${framePace.capFps(cap)} fps`;
    c.appendChild(this.select('Frame cap', `Draws every second or third frame of the ${hz} Hz display, so the frames that are shown come evenly spaced instead of in bursts; the game runs the same.`,
      [['off', `Off (up to ${hz} fps)`], ['half', `Half the display rate (${fps('half')})`], ['third', `A third (${fps('third')})`], ['60', `About 60 (${fps('60')})`], ['30', `About 30 (${fps('30')})`]],
      () => s.frameCap, (v) => set('frameCap')(v as FrameCap)));
    c.appendChild(h('h3', '', 'Effects'));
    c.appendChild(this.toggle('Bloom and glow', 'Glowing windows, forges and water glints', () => s.bloom, set('bloom')));
    c.appendChild(this.toggle('Tilt-shift depth of field', 'Miniature diorama look', () => s.dof, set('dof')));
    c.appendChild(this.toggle('Ambient occlusion', 'Soft contact shadows under eaves, around trees and at the foot of cliffs. The heaviest effect: a frame takes about 60% longer. Off is the first thing to try if the game stutters.', () => s.ao, set('ao')));
    c.appendChild(this.toggle('Colour grading', 'Filmic tone and vignette', () => s.grade, set('grade')));
    c.appendChild(this.toggle('Grass tufts', 'Wind-swept grass blades (always off on Low)', () => s.grass, set('grass')));
    c.appendChild(this.toggle('Water reflections', 'The land mirrored in lakes and sea', () => s.reflections, set('reflections')));
    c.appendChild(h('h3', '', 'World'));
    c.appendChild(this.select('Weather', '', [['auto', 'Changing'], ['clear', 'Always clear'], ['drizzle', 'Drizzle'], ['rain', 'Rain'], ['storm', 'Storm'], ['snow', 'Snow']],
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
    c.appendChild(this.seg('Stall badges', 'Over buildings that have stopped: the three that hold up the most (each about something different), all of them, or none. ⚠ in the top bar counts them all. B switches it.',
      [['top', 'Top 3'], ['all', 'All'], ['off', 'Off']], () => prefs.stallBadges, (v) => { prefs.stallBadges = v as typeof prefs.stallBadges; }));
    c.appendChild(this.toggle('Stall alerts', 'A message when a mine runs dry, nobody is free for a job or a worker has no tool', () => prefs.stallAlerts, (v) => { prefs.stallAlerts = v; }));
    this.resetButton(c, rec ? 'Reset graphics to the defaults for this machine' : 'Reset graphics to defaults', () => {
      const d = defaultPrefs();
      Object.assign(prefs, { render: defaultRender(), season: d.season, dayLength: d.dayLength, showFps: d.showFps, stallBadges: d.stallBadges, stallAlerts: d.stallAlerts });
      applyRenderPrefs(gr);
    });
  }

  /** What the detection found, and a button to run it again (it times the land behind the menu). */
  private detectRow() {
    const hw = prefs.hw;
    // (the screen as the detection counts it: the window where that is larger)
    const scr = `${Math.max(screen.width, innerWidth)}×${Math.max(screen.height, innerHeight)}${devicePixelRatio > 1 ? ` at ${Math.round(devicePixelRatio * 100) / 100}×` : ''}`;
    const desc = hw.level
      ? `${esc(hw.gpu)}, a ${scr} screen: <span class="hw-level">${levelText(hw.level, hw.ao)}</span>${hw.ms ? `, timed at about ${Math.round(hw.ms)} ms a frame for a grown town` : ''}. Detecting again sets the detail level, the resolution and the effects.`
      : 'Reads the graphics card and the screen, then times a few frames at each level. Sets the detail level, the resolution and the effects.';
    const b = h('button', 'gm-detect', hw.level ? 'Detect again' : 'Detect') as HTMLButtonElement;
    b.onclick = () => {
      this.o.audio.play('ui');
      b.disabled = true;
      b.textContent = 'Timing…';
      // let the button say so before the frames are timed
      setTimeout(() => {
        detectGraphics(this.o.gr, this.o.game);
        prefs.hw.told = true;
        savePrefs();
        if (this.el.isConnected && this.page === 'graphics') this.show('graphics');
      }, 30);
    };
    return this.row('Pick for this machine', desc, b, 'div');
  }

  private renderSound(c: HTMLElement) {
    const a = this.o.audio;
    const apply = () => applyAudioPrefs(a);
    if (!a.started) c.appendChild(h('p', 'note', 'Sound starts with your first click or key press. Browsers require it.'));
    c.appendChild(h('h3', '', 'Volume'));
    c.appendChild(this.toggle('Sound', import.meta.env.DEV ? 'Off by default on the dev server' : 'Everything: effects, ambience and music', () => prefs.soundOn, (v) => { prefs.soundOn = v; apply(); }));
    c.appendChild(this.slider('Master volume', '', 0, 1, 0.01, () => prefs.volume, (v) => { prefs.volume = v; apply(); }, pct));
    c.appendChild(this.slider('Effects', 'Work, building and battle sounds', 0, 1, 0.01, () => prefs.sfx, (v) => { prefs.sfx = v; apply(); }, pct, () => a.play('built')));
    c.appendChild(this.slider('Ambience', 'Wind, rain and birdsong', 0, 1, 0.01, () => prefs.ambience, (v) => { prefs.ambience = v; apply(); }, pct));
    c.appendChild(h('h3', '', 'Music'));
    c.appendChild(this.toggle('Play music', a.soundtrack ? 'The soundtrack in order; N skips to the next track' : 'A generative lute over a drone', () => prefs.musicOn, (v) => { prefs.musicOn = v; apply(); }));
    c.appendChild(this.slider('Music volume', '', 0, 1, 0.01, () => prefs.music, (v) => { prefs.music = v; apply(); }, pct));
    c.appendChild(h('h3', '', 'Narration'));
    c.appendChild(this.slider('The quaestor', 'His briefings and tips in the campaign, when their recordings are there', 0, 1, 0.01, () => prefs.voice, (v) => { prefs.voice = v; apply(); }, pct, () => { void a.say('quaestor.noted.1', { interrupt: true }); }));
    this.resetButton(c, 'Reset sound to defaults', () => {
      const d = defaultPrefs();
      Object.assign(prefs, { soundOn: d.soundOn, volume: d.volume, sfx: d.sfx, ambience: d.ambience, musicOn: d.musicOn, music: d.music, voice: d.voice });
      apply();
    });
  }

  private renderControls(c: HTMLElement) {
    const cam = this.o.gr.cam;
    c.appendChild(h('h3', '', 'Camera'));
    c.appendChild(this.toggle('Edge scrolling', 'Move the view when the pointer touches the edge of the screen', () => prefs.edgeScroll, (v) => { prefs.edgeScroll = v; cam.edgeScroll = v; }));
    c.appendChild(this.slider('Scroll speed', 'Keyboard and edge scrolling', 0.5, 2, 0.1, () => prefs.scrollSpeed, (v) => { prefs.scrollSpeed = v; cam.scrollSpeed = v; }, (v) => `${v.toFixed(1)}×`));
    c.appendChild(this.toggle('Zoom towards the pointer', 'Off zooms on the middle of the screen', () => prefs.zoomToPointer, (v) => { prefs.zoomToPointer = v; cam.zoomToPointer = v; }));
    c.appendChild(this.select('Scroll wheel', 'A pinch always zooms; Shift + wheel turns', [['auto', 'Mouse zooms, trackpad pans'], ['zoom', 'Always zoom'], ['pan', 'Always pan']],
      () => prefs.wheel, (v) => { prefs.wheel = v as WheelMode; cam.wheelMode = prefs.wheel; }));
    c.appendChild(this.select('Right-drag', 'The middle button (or Alt/⌥ + right-drag) does the other', [['pan', 'Moves the view'], ['orbit', 'Turns and tilts the view']],
      () => prefs.rightDrag, (v) => { prefs.rightDrag = v as 'pan' | 'orbit'; cam.rightDrag = prefs.rightDrag; }));
    if (immersiveAvailable) {
      c.appendChild(h('h3', '', 'Screen'));
      c.appendChild(this.toggle('Immersive mode', `Fills the screen, so scrolling at the top edge never slips into the browser's tabs. F switches it; ${leaveHint}.`, isImmersive, (v) => {
        // the switch shows the real state: put it back if the browser refused
        void (v ? enterImmersive() : leaveImmersive()).then(() => { if (isImmersive() !== v && this.page === 'controls') this.show('controls'); });
      }));
    }
    const keys = (title: string, rows: [string, string][]) => {
      c.appendChild(h('h3', '', title));
      c.appendChild(h('dl', 'keys-grid', rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')));
    };
    keys('View', KEYS_VIEW);
    keys('Orders', KEYS_ORDERS);
    keys('Soldiers', KEYS_ARMY);
    keys('Game', KEYS_GAME);
    keys('Trackpad', KEYS_TRACKPAD);
    keys('Touch', KEYS_TOUCH);
    this.resetButton(c, 'Reset controls to defaults', () => {
      const d = defaultPrefs();
      Object.assign(prefs, { edgeScroll: d.edgeScroll, scrollSpeed: d.scrollSpeed, zoomToPointer: d.zoomToPointer, wheel: d.wheel, rightDrag: d.rightDrag, immersive: d.immersive });
      applyControlPrefs(this.o.gr);
      void leaveImmersive();
    });
  }

  private renderConfirm(c: HTMLElement, page: 'restart' | 'quit') {
    const restart = page === 'restart';
    const mission = !!this.o.game.mission;
    const box = h('div', 'gm-confirm', `
      <div class="crest">${restart ? '↻' : '⏏'}</div>
      <p>${restart ? mission ? 'Start this mission again from the beginning?' : 'Start this map again from the beginning? The land, the seed and your rivals stay the same.' : 'Leave this game and return to the title screen?'}</p>
      <p class="muted">${restart ? 'The autosave is replaced by the new start — save the game first to keep it.' : 'Your game stays in the autosave; continue it from the title screen.'}</p>
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

  /** A row of choices; `mark` gets a ★ (the level recommended for this machine). */
  private seg(label: string, desc: string, options: [string, string][], get: () => string, set: (v: string) => void, mark?: string) {
    const box = h('div', 'seg');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', label);
    box.style.gridTemplateColumns = `repeat(${options.length}, 1fr)`;
    for (const [v, t] of options) {
      const b = h('button', v === get() ? 'on' : '', v === mark ? `<span class="rec" aria-hidden="true">★</span>${t}` : t);
      if (v === mark) { b.title = 'Recommended for this machine'; b.setAttribute('aria-label', `${t} (recommended)`); }
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
