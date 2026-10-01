// The map editor: a map of the player's own, shaped on the live 3D world with brushes - the ground
// raised, lowered, smoothed and levelled, materials and ore painted, fish stocked, woods planted and
// cleared, rocks scattered, herds set out, the players' headquarters placed - with undo, a library
// of maps in the browser, map files to share, a script console over the same API (src/game/map.ts)
// for maps made by code, the checks that say what would make a game on it unfair, and Play.
//
// The map is a MapBuilder whose arrays are the world's own, so every brush stroke shows at once; the
// trees, rocks, deer and headquarters the world draws are kept in step with the builder's after each
// change (`sync`). The game the world belongs to is never stepped here: nothing grows, nothing walks.
import type { Game } from '../game/game';
import type { GameRenderer } from '../render/renderer';
import { MapBuilder, MAX_PLAYERS, MAP_SIZES, SPECIES_NAMES, TERRAIN_NAMES, applyMap, decodeMap, encodeMap, hqNodes, mapError, type MapChange, type MapData, type MapPatch, type MapProblem, type Rect } from '../game/map';
import { ORE_COAL, ORE_GOLD, ORE_IRON, ORE_NAMES, ORE_STONE, PLAYER_COLORS, PLAYER_NAMES, T_DIRT, T_FOREST, T_GRASS, T_MEADOW, T_ROCK, T_SAND, T_SNOW, T_SWAMP } from '../game/defs';
import { WATER_LEVEL } from '../game/world';
import { RNG } from '../core/rng';
import { glyph, type GlyphName } from './glyphs';
import { deleteMap, getMap, listMaps, newMapId, paintMap, putMap, type MapSummary } from './mapStore';
import { timeAgo } from './saveStore';

export interface EditorHooks {
  /** a fresh world for the map: a game with no players, its renderer; resolves once it is drawn */
  build(data: MapData): Promise<{ game: Game; gr: GameRenderer }>;
  /** play a game on the map (the editor is gone by then) */
  play(data: MapData): Promise<void>;
  /** back to the title screen */
  back(): void;
  /** the options over the editor (graphics, sound) */
  options(): void;
  /** the map to open at first, if one was asked for */
  initial?: MapData;
}

type Tab = 'ground' | 'paint' | 'nature' | 'players';
interface ToolDef {
  id: string;
  tab: Tab;
  name: string;
  icon: GlyphName;
  tip: string;
  /** a stroke applies it every frame while the button is down (the ground), else once per stamp */
  continuous?: boolean;
  color: number;
  /** a click, not a stroke (the starts) */
  click?: boolean;
  /** shown as a colour swatch rather than an icon */
  swatch?: string;
}

const TERRAIN_SWATCH: Record<number, string> = {
  [T_GRASS]: '#5c803a', [T_MEADOW]: '#809646', [T_FOREST]: '#3a602c', [T_DIRT]: '#78603e',
  [T_SAND]: '#c4b078', [T_ROCK]: '#767068', [T_SNOW]: '#e8ecf0', [T_SWAMP]: '#566c46',
};
const ORE_SWATCH: Record<number, string> = { [ORE_COAL]: '#2a2a2e', [ORE_IRON]: '#9a6a4a', [ORE_GOLD]: '#e0b020', [ORE_STONE]: '#a8a8a0' };
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const TOOLS: ToolDef[] = [
  { id: 'raise', tab: 'ground', name: 'Raise', icon: 'plus', tip: 'Raise the ground (hold)', continuous: true, color: 0xe2b857 },
  { id: 'lower', tab: 'ground', name: 'Lower', icon: 'minus', tip: 'Lower the ground (hold)', continuous: true, color: 0xe2b857 },
  { id: 'smooth', tab: 'ground', name: 'Smooth', icon: 'wave', tip: 'Smooth the ground (hold)', continuous: true, color: 0xe2b857 },
  { id: 'flatten', tab: 'ground', name: 'Level', icon: 'level', tip: 'Level the ground to the height where the stroke began (hold)', continuous: true, color: 0xe2b857 },
  { id: 'roughen', tab: 'ground', name: 'Hills', icon: 'stairs', tip: 'Rolling hills (hold)', continuous: true, color: 0xe2b857 },
  { id: 'mountain', tab: 'ground', name: 'Mountain', icon: 'mountain', tip: 'Raise a ridged mountain, its rock painted (click)', click: true, color: 0xbdb7ad },
  { id: 'island', tab: 'ground', name: 'Island', icon: 'pin', tip: 'Raise an island out of the sea (click)', click: true, color: 0x9ad07a },
  { id: 'lake', tab: 'ground', name: 'Lake', icon: 'water', tip: 'Sink a lake (click)', click: true, color: 0x5aa0e0 },
  { id: 'sea', tab: 'ground', name: 'Sea', icon: 'wave', tip: 'Sink the ground under the sea (hold)', continuous: true, color: 0x3a70c0 },
  { id: 'auto', tab: 'paint', name: 'Auto', icon: 'wand', tip: 'Dress the land from its shape: sand on the shore, rock where it is steep, grass, meadow and woodland floor elsewhere', color: 0xe2b857 },
  ...([T_GRASS, T_MEADOW, T_FOREST, T_DIRT, T_SAND, T_ROCK, T_SNOW, T_SWAMP] as const).map((t): ToolDef => ({ id: `t${t}`, tab: 'paint', name: TERRAIN_NAMES[t], icon: 'brush', tip: `Paint ${TERRAIN_NAMES[t].toLowerCase()}`, color: parseInt(TERRAIN_SWATCH[t].slice(1), 16), swatch: TERRAIN_SWATCH[t] })),
  ...([ORE_COAL, ORE_IRON, ORE_GOLD, ORE_STONE] as const).map((o): ToolDef => ({ id: `o${o}`, tab: 'paint', name: ORE_NAMES[o][0].toUpperCase() + ORE_NAMES[o].slice(1), icon: 'ore', tip: `Lay ${ORE_NAMES[o]} under the rock (mountains only: a geologist finds it, a mine digs it)`, color: parseInt(ORE_SWATCH[o].slice(1), 16), swatch: ORE_SWATCH[o] })),
  { id: 'o0', tab: 'paint', name: 'No ore', icon: 'close', tip: 'Take the ore out of the rock', color: 0x767068 },
  { id: 'trees', tab: 'nature', name: 'Woods', icon: 'tree', tip: 'Plant trees to suit the ground', color: 0x4a9a3a },
  ...SPECIES_NAMES.map((n, sp): ToolDef => ({ id: `sp${sp}`, tab: 'nature', name: n, icon: 'tree', tip: `Plant ${n.toLowerCase()}s`, color: 0x4a9a3a })),
  { id: 'notrees', tab: 'nature', name: 'Clear woods', icon: 'axe', tip: 'Fell every tree under the brush', color: 0xc06040 },
  { id: 'stones', tab: 'nature', name: 'Rocks', icon: 'rock', tip: 'Scatter rocks for the stonecutters', color: 0xa8a8a0 },
  { id: 'nostones', tab: 'nature', name: 'Clear rocks', icon: 'close', tip: 'Take the rocks away', color: 0xc06040 },
  { id: 'fish', tab: 'nature', name: 'Fish', icon: 'fish', tip: 'Stock the water with fish', color: 0x5ac0e0 },
  { id: 'nofish', tab: 'nature', name: 'No fish', icon: 'close', tip: 'Empty the water of fish', color: 0xc06040 },
  { id: 'deer', tab: 'nature', name: 'Deer', icon: 'deer', tip: 'A herd of deer for the hunters (click)', click: true, color: 0xc09a60 },
  { id: 'nodeer', tab: 'nature', name: 'No deer', icon: 'close', tip: 'Send the deer away', color: 0xc06040 },
  ...PLAYER_NAMES.map((n, p): ToolDef => ({ id: `p${p}`, tab: 'players', name: n, icon: 'flag', tip: `Where ${n}'s headquarters stands (click; the ground is levelled and cleared for it)`, click: true, color: PLAYER_COLORS[p] })),
  { id: 'nostart', tab: 'players', name: 'Remove', icon: 'close', tip: 'Take a headquarters off the map (click on it)', click: true, color: 0xc06040 },
];
const TABS: [Tab, string, GlyphName][] = [['ground', 'Ground', 'mountain'], ['paint', 'Paint', 'brush'], ['nature', 'Nature', 'tree'], ['players', 'Players', 'flag']];

const EXAMPLES: Record<string, string> = {
  'Twin peaks (two players)': `// A round island with a mountain for each player, a lake apiece and a river.
const S = map.size, c = S / 2;
map.fill(WATER_LEVEL - 2.5);
map.island(c, c, S * 0.42, 1.6);
map.hills(c, c, S * 0.4, 0.5, 14);
map.mountain(c - S * 0.22, c - S * 0.2, 13, 7);
map.mountain(c + S * 0.22, c + S * 0.2, 13, 7);
map.lake(c - S * 0.05, c + S * 0.18, 7, 1.6);
map.lake(c + S * 0.05, c - S * 0.18, 7, 1.6);
map.carve([{ x: c - 10, y: c + S * 0.18 }, { x: c - 45, y: c + S * 0.45 }], 2.5, 3);
map.autoTerrain();
for (const [x, y] of [[c - S * 0.22, c - S * 0.2], [c + S * 0.22, c + S * 0.2]]) {
  map.paintOre(x - 4, y - 3, 4, ORE.COAL, 16);
  map.paintOre(x + 4, y + 3, 4, ORE.IRON, 16);
  map.paintOre(x, y - 5, 3, ORE.GOLD, 12);
}
map.setStart(0, Math.round(c - S * 0.25), Math.round(c + S * 0.05));
map.setStart(1, Math.round(c + S * 0.25), Math.round(c - S * 0.05));
for (const s of map.starts) {
  if (!s) continue;
  map.paint(s.x - 12, s.y - 8, 7, T.FOREST);
  map.plant(s.x - 12, s.y - 8, 8, 0.6);
  map.plant(s.x + 10, s.y + 9, 7, 0.45);
  map.scatterStones(s.x + 12, s.y - 6, 3.5, 0.5, 9);
  map.herd(s.x - 14, s.y + 14, 4);
}
map.stockFish(c, c, S * 0.5, 4);
map.name = 'Twin Peaks';`,
  'Archipelago (four players)': `// Four islands round a central one, each with a mountain; the players meet by sea.
const S = map.size, c = S / 2, R = S * 0.34;
map.fill(WATER_LEVEL - 3);
map.island(c, c, S * 0.1, 1.2);
map.mountain(c, c, 6, 6);
map.paintOre(c, c, 5, ORE.GOLD, 16);
for (let p = 0; p < 4; p++) {
  const a = Math.PI / 4 + (p / 4) * Math.PI * 2;
  const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R;
  map.island(x, y, S * 0.13, 1.5);
  const mx = x + Math.cos(a) * S * 0.08, my = y + Math.sin(a) * S * 0.08;
  map.mountain(mx, my, 8, 6);
  map.autoTerrain(x, y, S * 0.25);
  map.paintOre(mx - 3, my, 3, ORE.COAL, 15);
  map.paintOre(mx + 3, my, 3, ORE.IRON, 15);
  map.setStart(p, Math.round(x - Math.cos(a) * S * 0.05), Math.round(y - Math.sin(a) * S * 0.05));
  const s = map.starts[p];
  map.plant(s.x + Math.sin(a) * 12, s.y - Math.cos(a) * 12, 8, 0.6);
  map.scatterStones(s.x - Math.sin(a) * 11, s.y + Math.cos(a) * 11, 3.5, 0.5, 9);
  map.herd(s.x + Math.sin(a) * 18, s.y - Math.cos(a) * 18, 4);
}
map.stockFish(c, c, S * 0.5, 4);
map.name = 'Archipelago';`,
  'Touch up this map': `// Work on the map as it is: a forest where the brush would take an hour.
for (const s of map.starts) {
  if (!s) continue;
  map.plant(s.x + 14, s.y + 14, 10, 0.5);
}
// rng is seeded: the same script on the same map gives the same result
const x = rng.int(20, map.size - 20), y = rng.int(20, map.size - 20);
map.herd(x, y, 5);`,
};

const h = (tag: string, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const DRAFT = 'draft';

export class MapEditor {
  root: HTMLElement;
  map!: MapBuilder;
  private game!: Game;
  private gr!: GameRenderer;
  /** the library entry the map was opened from or saved to, if any */
  private id: string | null = null;
  private dirty = false;
  private tool: ToolDef = TOOLS[0];
  private tab: Tab = 'ground';
  private size = 6;
  private strength = 0.5;
  private undo: MapPatch[] = [];
  private redo: MapPatch[] = [];
  private stroke: { x: number; y: number; h0: number; lastX: number; lastY: number; stamped: boolean } | null = null;
  private hover: { x: number; y: number } | null = null;
  /** the headquarters drawn for each start, by slot */
  private hqs: (number | null)[] = [];
  private modal: HTMLElement | null = null;
  private checkT = 0;
  private draftT = 0;
  private busy = false;
  private ac = new AbortController();
  private left!: HTMLElement;
  private top!: HTMLElement;
  private status!: HTMLElement;
  private checks!: HTMLElement;
  private nameIn!: HTMLInputElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private toolGrid!: HTMLElement;

  constructor(parent: HTMLElement, private hooks: EditorHooks) {
    this.root = h('div', 'ed');
    this.root.innerHTML = `
      <div class="ed-top panel">
        <button data-a="new" title="A new map">${glyph('new', 18)}<span>New</span></button>
        <button data-a="open" title="The maps in this browser">${glyph('folder', 18)}<span>Open</span></button>
        <button data-a="save" title="Keep the map in this browser (Ctrl+S)">${glyph('save', 18)}<span>Save</span></button>
        <button data-a="export" title="A map file to keep or share (.tnmap)">${glyph('download', 18)}<span>Export</span></button>
        <button data-a="import" title="Open a map file">${glyph('upload', 18)}<span>Import</span></button>
        <span class="ed-sep"></span>
        <button data-a="undo" title="Undo (Ctrl+Z)">${glyph('undo', 18)}</button>
        <button data-a="redo" title="Redo (Ctrl+Shift+Z)">${glyph('redo', 18)}</button>
        <span class="ed-sep"></span>
        <button data-a="script" title="Shape the map by script">${glyph('code', 18)}<span>Script</span></button>
        <button data-a="options" title="Graphics and sound">${glyph('sliders', 18)}</button>
        <span class="ed-grow"></span>
        <button data-a="back" title="Back to the title screen">${glyph('back', 18)}<span>Title</span></button>
        <button class="primary" data-a="play" title="Play a game on this map">${glyph('play', 18)}<span>Play</span></button>
      </div>
      <div class="ed-left panel">
        <div class="ed-name"><label>Map</label><input type="text" maxlength="40" spellcheck="false" aria-label="The map's name"><span class="ed-size"></span></div>
        <div class="ed-tabs">${TABS.map(([id, name, ic]) => `<button class="ed-tab" data-tab="${id}" title="${name}">${glyph(ic, 18)}<span>${name}</span></button>`).join('')}</div>
        <div class="ed-tools"></div>
        <div class="ed-brush">
          <label>Brush <b class="ed-sizev"></b></label><input type="range" min="1" max="24" step="1" data-k="size" aria-label="Brush size">
          <label>Strength <b class="ed-strv"></b></label><input type="range" min="0.05" max="1" step="0.05" data-k="strength" aria-label="Brush strength">
        </div>
        <div class="ed-help"></div>
        <div class="ed-checks"><div class="ed-sect">Checks</div><ul></ul></div>
      </div>
      <div class="ed-status"></div>`;
    parent.appendChild(this.root);
    this.top = this.root.querySelector('.ed-top')!;
    this.left = this.root.querySelector('.ed-left')!;
    this.status = this.root.querySelector('.ed-status')!;
    this.checks = this.root.querySelector('.ed-checks ul')!;
    this.nameIn = this.root.querySelector('.ed-name input')!;
    this.toolGrid = this.root.querySelector('.ed-tools')!;
    this.undoBtn = this.top.querySelector('[data-a=undo]')!;
    this.redoBtn = this.top.querySelector('[data-a=redo]')!;
    this.nameIn.onchange = () => { this.map.name = this.nameIn.value.trim() || 'Untitled map'; this.nameIn.value = this.map.name; this.touch(); };
    const acts: Record<string, () => void> = {
      new: () => this.newDialog(), open: () => void this.library(), save: () => void this.save(), export: () => void this.exportFile(),
      import: () => this.importFile(), undo: () => this.doUndo(), redo: () => this.doRedo(), script: () => this.scriptDialog(),
      options: () => this.hooks.options(), back: () => this.leave(), play: () => void this.play(),
    };
    this.top.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => { b.onclick = () => acts[b.dataset.a!]?.(); });
    this.root.querySelectorAll<HTMLButtonElement>('.ed-tab').forEach((b) => { b.onclick = () => this.showTab(b.dataset.tab as Tab); });
    const sizeIn = this.root.querySelector<HTMLInputElement>('input[data-k=size]')!, strIn = this.root.querySelector<HTMLInputElement>('input[data-k=strength]')!;
    sizeIn.oninput = () => this.setSize(Number(sizeIn.value));
    strIn.oninput = () => { this.strength = Number(strIn.value); this.root.querySelector('.ed-strv')!.textContent = `${Math.round(this.strength * 100)}%`; };
    sizeIn.value = String(this.size);
    strIn.value = String(this.strength);
    this.setSize(this.size);
    strIn.dispatchEvent(new Event('input'));
    this.showTab('ground');
    window.addEventListener('keydown', (e) => this.onKey(e), { signal: this.ac.signal });
  }

  /** Open the map to work on: the one asked for, the unfinished one from last time, or a fresh sea. */
  async start() {
    let data = this.hooks.initial ?? null;
    let id: string | null = null;
    if (!data) {
      try {
        data = await getMap(DRAFT);
        if (data && mapError(data)) data = null;
      } catch { data = null; }
    }
    if (!data) {
      const b = MapBuilder.generate(160, Math.floor(Math.random() * 99999) + 1, 2, true);
      b.name = 'New world';
      data = b.toData();
    } else if (this.hooks.initial) id = null;
    await this.open(data, id);
  }

  /** Put a map on the world and take it up. */
  async open(data: MapData, id: string | null) {
    this.busy = true;
    this.setStatus('Shaping the land…');
    try {
      const { game, gr } = await this.hooks.build(data);
      this.game = game;
      this.gr = gr;
      const w = game.world;
      this.map = MapBuilder.from(data, Math.floor(Math.random() * 1e9));
      // the builder works the world's own arrays: every stroke shows at once
      this.map.h = w.h;
      this.map.terrain = w.terrain;
      this.map.ore = w.ore;
      this.map.oreAmt = w.oreAmt;
      this.map.fish = w.fish;
      this.map.onChange = (rect, what) => this.changed(rect, what);
      w.explored.fill(1);
      w.exploredDirty = true;
      this.hqs = [];
      this.syncStarts();
      this.id = id;
      this.undo = [];
      this.redo = [];
      this.dirty = false;
      this.nameIn.value = this.map.name;
      this.root.querySelector('.ed-size')!.textContent = `${this.map.size} × ${this.map.size}`;
      this.bind(gr);
      gr.cam.jumpTo(this.map.size / 2, this.map.size / 2, true);
      gr.cam.zoomTo(60, true);
      this.refreshUndo();
      this.check();
      this.setStatus('');
    } catch (e) {
      this.setStatus(`Could not open the map: ${(e as Error).message}`, true);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  remove() {
    this.ac.abort();
    this.modal?.remove();
    if (this.gr) this.gr.brush = null;
    this.root.remove();
  }

  // ------------------------------------------------------------ the world in step with the map
  private changed(rect: Rect, what: MapChange) {
    const w = this.game.world;
    if (what === 'h') { w.markHeightDirty(rect.x0, rect.y0, rect.x1, rect.y1); w.splatDirty = true; }
    else if (what === 'terrain') w.splatDirty = true;
    else if (what === 'ore' || what === 'fish') w.oreDirty = true;
    else if (what === 'trees') this.syncTrees(rect);
    else if (what === 'stones') this.syncStones(rect);
    else if (what === 'deer') this.syncDeer(rect);
    else if (what === 'starts') this.syncStarts();
    this.touch();
  }

  private forRect(rect: Rect, fn: (i: number) => void) {
    const S = this.map.size;
    for (let y = Math.max(0, rect.y0); y <= Math.min(S - 1, rect.y1); y++) for (let x = Math.max(0, rect.x0); x <= Math.min(S - 1, rect.x1); x++) fn(y * S + x);
  }
  private syncTrees(rect: Rect) {
    const g = this.game, w = g.world;
    this.forRect(rect, (i) => {
      const want = this.map.trees.get(i), have = w.tree[i] ? g.trees.get(w.tree[i]) : undefined;
      if (have && (!want || have.species !== want.species || have.growth !== want.growth)) g.removeTree(have);
      if (want && (!have || have.species !== want.species || have.growth !== want.growth)) g.addTree(i, want.species, want.growth);
    });
  }
  private syncStones(rect: Rect) {
    const g = this.game, w = g.world;
    this.forRect(rect, (i) => {
      const want = this.map.stones.get(i), have = w.stone[i] ? g.stones.get(w.stone[i]) : undefined;
      if (have && (want === undefined || have.amount !== want)) g.removeStone(have);
      if (want !== undefined && (!have || have.amount !== want)) g.addStone(i, want);
    });
  }
  private syncDeer(rect: Rect) {
    const g = this.game, w = g.world;
    const inside = (i: number) => { const x = w.nx(i), y = w.ny(i); return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1; };
    for (const a of [...g.animals.values()]) if (a.kind === 'deer' && inside(a.node)) g.animals.delete(a.id);
    for (const d of this.map.deer) if (inside(d.node)) g.addAnimal(d.node, d.herd);
  }
  /** A headquarters stands on every start, as the game will place it (which levels its ground). */
  private syncStarts() {
    const g = this.game;
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const s = this.map.starts[p], id = this.hqs[p];
      const b = id ? g.buildings.get(id) : undefined;
      if (b && s && b.x === s.x - 1 && b.y === s.y - 1) continue;
      if (b) { g.finalRemove(b); this.hqs[p] = null; }
      if (!s) continue;
      while (g.players.length <= p) g.players.push(g.newPlayer(g.players.length));
      for (const i of hqNodes(this.map.size, s)) { this.map.trees.delete(i); this.map.stones.delete(i); }
      this.syncTrees({ x0: s.x - 1, y0: s.y - 1, x1: s.x + 2, y1: s.y + 3 });
      this.syncStones({ x0: s.x - 1, y0: s.y - 1, x1: s.x + 2, y1: s.y + 3 });
      const hq = g.addBuilding('hq', p, s.x - 1, s.y - 1, true);
      this.hqs[p] = hq.id;
      g.world.markHeightDirty(s.x - 3, s.y - 3, s.x + 4, s.y + 5);
    }
    g.events.length = 0;
  }

  // ------------------------------------------------------------ tools
  private showTab(tab: Tab) {
    this.tab = tab;
    this.root.querySelectorAll<HTMLButtonElement>('.ed-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.toolGrid.innerHTML = TOOLS.filter((t) => t.tab === tab).map((t) =>
      `<button class="ed-tool${t === this.tool ? ' on' : ''}" data-tool="${t.id}" title="${esc(t.tip)}">${t.swatch ? `<i class="ed-swatch" style="background:${t.swatch}"></i>` : `<span style="color:${hex(t.color)}">${glyph(t.icon, 18)}</span>`}<span>${esc(t.name)}</span></button>`).join('');
    this.toolGrid.querySelectorAll<HTMLButtonElement>('.ed-tool').forEach((b) => { b.onclick = () => this.pick(TOOLS.find((t) => t.id === b.dataset.tool)!); });
    const first = TOOLS.find((t) => t.tab === tab)!;
    if (this.tool.tab !== tab) this.pick(first);
    this.showHelp();
  }
  private pick(t: ToolDef) {
    this.tool = t;
    this.toolGrid.querySelectorAll<HTMLButtonElement>('.ed-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t.id));
    this.showHelp();
  }
  private showHelp() {
    const t = this.tool;
    const how = t.click ? 'Click to place it.' : t.continuous ? 'Hold the button and move the pointer.' : 'Drag to paint.';
    this.root.querySelector('.ed-help')!.innerHTML = `<b>${esc(t.name)}</b> ${esc(t.tip)}. ${how}<br><span class="muted"><kbd>[</kbd> <kbd>]</kbd> brush · <kbd>Right-drag</kbd> move · <kbd>Wheel</kbd> zoom · <kbd>Option</kbd>+drag turn</span>`;
  }
  private setSize(n: number) {
    this.size = Math.max(1, Math.min(24, n));
    this.root.querySelector<HTMLInputElement>('input[data-k=size]')!.value = String(this.size);
    this.root.querySelector('.ed-sizev')!.textContent = String(this.size);
  }

  /** One application of the tool at (x, y), `k` how much (a frame's worth for a held tool). */
  private apply(x: number, y: number, k: number) {
    const m = this.map, r = this.size, t = this.tool, s = this.strength;
    switch (t.id) {
      case 'raise': m.raise(x, y, r, 0.25 * s * k * 6); break;
      case 'lower': m.raise(x, y, r, -0.25 * s * k * 6); break;
      case 'smooth': m.smooth(x, y, r, Math.min(1, s * k * 3)); break;
      case 'flatten': m.flatten(x, y, r, this.stroke?.h0, Math.min(1, s * k * 3)); break;
      case 'roughen': m.roughen(x, y, r, 0.12 * s * k * 6, Math.max(4, r)); break;
      case 'sea': m.flatten(x, y, r, WATER_LEVEL - 1.6, Math.min(1, s * k * 3)); break;
      case 'mountain': m.mountain(x, y, r * 1.6, 3 + 6 * s); break;
      case 'island': m.island(x, y, r * 1.6, 0.6 + 1.6 * s); break;
      case 'lake': m.lake(x, y, r * 1.3, 0.8 + 2 * s); break;
      case 'auto': m.autoTerrain(x, y, r); break;
      case 'trees': m.plant(x, y, r, s * 0.7); break;
      case 'notrees': m.clearTrees(x, y, r); break;
      case 'stones': m.scatterStones(x, y, r, s * 0.6, 8); break;
      case 'nostones': m.clearStones(x, y, r); break;
      case 'fish': m.stockFish(x, y, r, Math.round(2 + 8 * s)); break;
      case 'nofish': m.stockFish(x, y, r, 0); break;
      case 'deer': m.herd(x, y, 3 + Math.round(3 * s)); break;
      case 'nodeer': m.clearDeer(x, y, r); break;
      case 'nostart': {
        for (let p = 0; p < MAX_PLAYERS; p++) { const st = m.starts[p]; if (st && Math.abs(st.x - x) <= 3 && Math.abs(st.y - y) <= 3) m.clearStart(p); }
        break;
      }
      default:
        if (t.id.startsWith('sp')) m.plant(x, y, r, s * 0.7, Number(t.id.slice(2)));
        else if (t.id.startsWith('t')) m.paint(x, y, r, Number(t.id.slice(1)), 0.85);
        else if (t.id.startsWith('o')) m.paintOre(x, y, r, Number(t.id.slice(1)), Math.round(6 + 16 * s));
        else if (t.id.startsWith('p')) {
          const p = Number(t.id.slice(1));
          const why = m.setStart(p, x, y);
          if (why) this.setStatus(`${PLAYER_NAMES[p]}'s headquarters is ${why}`, true);
        }
    }
  }

  // ------------------------------------------------------------ pointer
  private bind(gr: GameRenderer) {
    const c = gr['canvas' as keyof GameRenderer] as unknown as HTMLCanvasElement;
    const o = { signal: this.ac.signal };
    const at = (e: PointerEvent) => {
      const p = gr.pickGround(e.clientX, e.clientY);
      if (!p) return null;
      const x = Math.round(p.x), y = Math.round(p.z);
      return this.map.inBounds(x, y) ? { x, y } : null;
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey || this.busy || this.modal) return;
      const p = at(e);
      if (!p) return;
      this.begin(p.x, p.y);
      c.setPointerCapture(e.pointerId);
    }, o);
    c.addEventListener('pointermove', (e) => {
      if (this.modal) return;
      const p = at(e);
      this.hover = p;
      if (p) this.showAt(p.x, p.y);
      if (this.stroke && p) {
        this.stroke.x = p.x;
        this.stroke.y = p.y;
        this.stamp(false);
      }
    }, o);
    const up = (e: PointerEvent) => { if (e.button === 0 || e.type === 'pointercancel') this.end(); };
    c.addEventListener('pointerup', up, o);
    c.addEventListener('pointercancel', up, o);
    c.addEventListener('pointerleave', () => { this.hover = null; gr.brush = null; }, o);
    c.addEventListener('contextmenu', (e) => e.preventDefault(), o);
  }

  private begin(x: number, y: number) {
    this.snapshot();
    this.stroke = { x, y, h0: this.map.heightAt(x, y), lastX: x, lastY: y, stamped: false };
    if (this.tool.click) { this.apply(x, y, 1); this.end(); return; }
    this.stamp(true);
  }
  /** A discrete tool lands once per brush-width of travel (a held one lands every frame in `update`). */
  private stamp(first: boolean) {
    const st = this.stroke;
    if (!st || this.tool.continuous) return;
    const d = Math.hypot(st.x - st.lastX, st.y - st.lastY);
    if (!first && d < Math.max(1, this.size * 0.45)) return;
    st.lastX = st.x;
    st.lastY = st.y;
    this.apply(st.x, st.y, 1);
  }
  private end() {
    if (!this.stroke) return;
    this.stroke = null;
    this.game.events.length = 0;
    this.checkT = 0.4;
  }

  /** a tool is held down (a stroke goes on even while the pointer stands still) */
  get painting() { return !!this.stroke; }

  /** Once a frame from the main loop: a held tool works on, the brush ring follows the pointer. */
  update(dt: number) {
    if (!this.gr) return;
    if (this.stroke && this.tool.continuous) this.apply(this.stroke.x, this.stroke.y, Math.min(0.1, dt));
    const hv = this.stroke ?? this.hover;
    this.gr.brush = hv && !this.modal ? { x: hv.x, z: hv.y, r: this.tool.click ? Math.max(2, this.size * (this.tool.id === 'deer' ? 0.5 : 1.4)) : this.size, color: this.tool.color } : null;
    if (this.checkT > 0) { this.checkT -= dt; if (this.checkT <= 0) this.check(); }
    if (this.draftT > 0) { this.draftT -= dt; if (this.draftT <= 0) void this.draft(); }
  }

  private showAt(x: number, y: number) {
    const m = this.map, i = m.idx(x, y);
    const hh = m.h[i] - WATER_LEVEL;
    const what = m.isWater(i) ? `water, ${(-hh).toFixed(1)} deep${m.fish[i] ? `, ${m.fish[i]} fish` : ''}` : `${TERRAIN_NAMES[m.terrain[i]].toLowerCase()}, ${hh.toFixed(1)} high`;
    const ore = m.ore[i] ? ` · ${ORE_NAMES[m.ore[i]]} ${m.oreAmt[i]}` : '';
    const tree = m.trees.get(i);
    const on = tree ? ` · ${SPECIES_NAMES[tree.species].toLowerCase()}` : m.stones.has(i) ? ` · rock, ${m.stones.get(i)} stone` : '';
    this.setStatus(`${x}, ${y} · ${what}${ore}${on}`);
  }
  private setStatus(text: string, bad = false) {
    this.status.textContent = text;
    this.status.classList.toggle('bad', bad);
    this.status.classList.toggle('hidden', !text);
  }

  // ------------------------------------------------------------ undo
  private snapshot() {
    this.undo.push(this.map.cut(this.map.all()));
    if (this.undo.length > 40) this.undo.shift();
    this.redo = [];
    this.refreshUndo();
  }
  private doUndo() {
    const p = this.undo.pop();
    if (!p) return;
    this.redo.push(this.map.cut(this.map.all()));
    this.map.paste(p);
    this.refreshUndo();
    this.checkT = 0.2;
  }
  private doRedo() {
    const p = this.redo.pop();
    if (!p) return;
    this.undo.push(this.map.cut(this.map.all()));
    this.map.paste(p);
    this.refreshUndo();
    this.checkT = 0.2;
  }
  private refreshUndo() {
    this.undoBtn.disabled = !this.undo.length;
    this.redoBtn.disabled = !this.redo.length;
  }
  private touch() {
    this.dirty = true;
    this.draftT = 4;
  }

  // ------------------------------------------------------------ checks
  private check() {
    const problems = this.map.validate();
    this.renderChecks(problems);
  }
  private renderChecks(problems: MapProblem[]) {
    if (!problems.length) { this.checks.innerHTML = '<li class="ok">The map is ready to play</li>'; return; }
    this.checks.innerHTML = problems.map((p) => `<li class="${p.level}"${p.x !== undefined ? ` data-x="${p.x}" data-y="${p.y}" title="Show me"` : ''}>${esc(p.text)}</li>`).join('');
    this.checks.querySelectorAll<HTMLElement>('li[data-x]').forEach((li) => { li.onclick = () => { this.gr.cam.jumpTo(Number(li.dataset.x), Number(li.dataset.y)); this.gr.teach = { x: Number(li.dataset.x), z: Number(li.dataset.y), r: 4, until: this.gr.time + 3 }; }; });
  }

  // ------------------------------------------------------------ keys
  private onKey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT';
    if (e.key === 'Escape') {
      if (this.modal) { e.preventDefault(); this.closeModal(); }
      else if (!typing) { e.preventDefault(); this.leave(); }
      return;
    }
    if (typing) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.modal?.querySelector('[data-a=run]')) (this.modal.querySelector('[data-a=run]') as HTMLButtonElement).click(); return; }
    if (this.modal) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) this.doRedo(); else this.doUndo(); }
    else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); this.doRedo(); }
    else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void this.save(); }
    else if (e.key === '[') this.setSize(this.size - 1);
    else if (e.key === ']') this.setSize(this.size + 1);
    else if (/^[1-4]$/.test(e.key) && !mod) this.showTab(TABS[Number(e.key) - 1][0]);
  }

  // ------------------------------------------------------------ dialogs
  private openModal(cls: string, html: string): HTMLElement {
    this.closeModal();
    const ov = h('div', 'ed-ov');
    ov.innerHTML = `<div class="panel ed-dialog ${cls}" role="dialog">${html}</div>`;
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) this.closeModal(); });
    this.root.appendChild(ov);
    this.modal = ov;
    this.gr.brush = null;
    if (this.gr) this.gr.cam.inputEnabled = false;
    ov.querySelector<HTMLElement>('[autofocus]')?.focus();
    return ov;
  }
  private closeModal() {
    this.modal?.remove();
    this.modal = null;
    if (this.gr) this.gr.cam.inputEnabled = true;
  }
  private err(ov: HTMLElement, text: string) {
    ov.querySelector('.menu-err')?.remove();
    const p = h('p', 'menu-err');
    p.textContent = text;
    ov.querySelector('.ed-dialog')!.prepend(p);
  }

  private newDialog() {
    const ov = this.openModal('ed-new', `
      <h2>A new map</h2>
      <div class="tm-form">
        <label>Size</label>
        <div class="seg" data-k="size">${MAP_SIZES.map((s) => `<button data-v="${s}"${s === 160 ? ' class="on"' : ''}>${s === 128 ? 'Small' : s === 160 ? 'Medium' : 'Large'}<small>${s}²</small></button>`).join('')}</div>
        <label>Start from</label>
        <div class="seg seg-2" data-k="kind"><button data-v="gen" class="on">A generated world</button><button data-v="sea">Open sea</button><button data-v="land">Flat land</button></div>
        <label for="ed-seed">World</label>
        <div class="tm-seed"><input type="number" id="ed-seed" min="1" value="${Math.floor(Math.random() * 99999) + 1}" aria-label="World seed"><button data-a="dice" title="Another">${glyph('dice', 20)}</button></div>
        <label>Players</label>
        <div class="seg" data-k="players"><button data-v="2" class="on">2</button><button data-v="3">3</button><button data-v="4">4</button></div>
      </div>
      <p class="tm-note">A generated world is the generator's map for the seed and players, to be worked on. The sea and the land are empty: place the players' headquarters before playing.</p>
      <div class="row"><button class="tm-btn" data-a="cancel">Cancel</button><button class="tm-btn primary" data-a="ok" autofocus>${glyph('new', 16)}Make it</button></div>`);
    const pick = (k: string) => Number(ov.querySelector<HTMLElement>(`.seg[data-k=${k}] .on`)!.dataset.v);
    const pickS = (k: string) => ov.querySelector<HTMLElement>(`.seg[data-k=${k}] .on`)!.dataset.v!;
    ov.querySelectorAll<HTMLElement>('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => { b.onclick = () => seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }));
    const seedIn = ov.querySelector<HTMLInputElement>('#ed-seed')!;
    ov.querySelector<HTMLButtonElement>('[data-a=dice]')!.onclick = () => { seedIn.value = String(Math.floor(Math.random() * 99999) + 1); };
    ov.querySelector<HTMLButtonElement>('[data-a=cancel]')!.onclick = () => this.closeModal();
    ov.querySelector<HTMLButtonElement>('[data-a=ok]')!.onclick = () => {
      const size = pick('size'), kind = pickS('kind'), seed = Math.max(1, Math.floor(Number(seedIn.value)) || 1), players = pick('players');
      const b = kind === 'gen' ? MapBuilder.generate(size, seed, players, true) : MapBuilder.blank(size, kind as 'sea' | 'land', seed);
      b.name = kind === 'gen' ? `World ${seed}` : 'New map';
      this.closeModal();
      void this.open(b.toData(), null).then(() => { this.touch(); });
    };
  }

  private async library() {
    const ov = this.openModal('ed-lib', `<h2>Your maps</h2><div class="ed-list"><p class="muted">Looking…</p></div><div class="row"><button class="tm-btn" data-a="cancel">Close</button></div>`);
    ov.querySelector<HTMLButtonElement>('[data-a=cancel]')!.onclick = () => this.closeModal();
    const list = ov.querySelector<HTMLElement>('.ed-list')!;
    let maps: MapSummary[] = [];
    try { maps = (await listMaps()).filter((m) => m.id !== DRAFT); } catch (e) { list.innerHTML = `<p class="menu-err">${esc((e as Error).message)}</p>`; return; }
    if (!ov.isConnected) return;
    if (!maps.length) { list.innerHTML = '<p class="muted">No maps yet. Save this one, or import a map file.</p>'; return; }
    list.innerHTML = maps.map((m) => `<div class="ed-row${m.id === this.id ? ' cur' : ''}" data-id="${m.id}">
        ${m.meta.thumb ? `<img src="${m.meta.thumb}" alt="">` : '<span class="ed-nothumb"></span>'}
        <div class="ed-rowt"><b>${esc(m.meta.name)}</b><small>${m.meta.size}² · ${m.meta.players} player${m.meta.players === 1 ? '' : 's'} · saved ${timeAgo(m.meta.savedAt)}${m.meta.author ? ` · by ${esc(m.meta.author)}` : ''}</small></div>
        <button class="tm-btn" data-a="load">Open</button><button class="ed-x" data-a="del" title="Delete">${glyph('trash', 16)}</button>
      </div>`).join('');
    list.querySelectorAll<HTMLElement>('.ed-row').forEach((row) => {
      const id = row.dataset.id!;
      row.querySelector<HTMLButtonElement>('[data-a=load]')!.onclick = async () => {
        try {
          const data = await getMap(id);
          if (!data) throw new Error('That map is gone');
          this.closeModal();
          await this.open(data, id);
        } catch (e) { this.err(ov, (e as Error).message); }
      };
      row.querySelector<HTMLButtonElement>('[data-a=del]')!.onclick = async () => {
        if (!row.classList.contains('sure')) { row.classList.add('sure'); row.querySelector<HTMLButtonElement>('[data-a=del]')!.title = 'Click again to delete'; return; }
        try { await deleteMap(id); row.remove(); if (this.id === id) this.id = null; } catch (e) { this.err(ov, (e as Error).message); }
      };
    });
  }

  private async save() {
    if (this.busy) return;
    const data = this.map.toData();
    const id = this.id ?? newMapId();
    try {
      await putMap(id, data);
      this.id = id;
      this.dirty = false;
      this.setStatus(`"${data.name}" saved to your maps`);
    } catch (e) {
      this.setStatus(`Could not save the map: ${(e as Error).message}`, true);
    }
  }
  /** The unfinished map, kept so a reload or a look at the title screen loses nothing. */
  private async draft() {
    if (!this.dirty || this.busy) return;
    try { await putMap(DRAFT, this.map.toData()); } catch { /* storage blocked */ }
  }

  private async exportFile() {
    const data = this.map.toData();
    const bytes = await encodeMap(data);
    const a = document.createElement('a');
    a.download = `${data.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'map'}.tnmap`;
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  private importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tnmap';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const data = await decodeMap(new Uint8Array(await f.arrayBuffer()));
        await this.open(data, null);
        this.touch();
      } catch (e) { this.setStatus(`Could not open the file: ${(e as Error).message}`, true); }
    };
    input.click();
  }

  private scriptDialog() {
    const names = Object.keys(EXAMPLES);
    const ov = this.openModal('ed-script', `
      <h2>Script</h2>
      <p class="muted ed-scriptnote">JavaScript over the map's API: <code>map</code> is the map (a <code>MapBuilder</code>), <code>T</code> and <code>ORE</code> name the materials and ores, <code>rng</code> is a seeded random generator, <code>WATER_LEVEL</code> the sea. Every call is undone as one step. See <a href="MAPS.md" target="_blank" rel="noopener">MAPS.md</a> for the whole API.</p>
      <div class="ed-scriptbar"><label>Example <select data-a="ex"><option value="">—</option>${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label><span class="ed-grow"></span><small class="muted">Ctrl+Enter runs</small></div>
      <textarea spellcheck="false" autofocus placeholder="map.mountain(80, 80, 12, 7);"></textarea>
      <pre class="ed-out hidden"></pre>
      <div class="row"><button class="tm-btn" data-a="cancel">Close</button><button class="tm-btn primary" data-a="run">${glyph('play', 16)}Run</button></div>`);
    const ta = ov.querySelector<HTMLTextAreaElement>('textarea')!, out = ov.querySelector<HTMLElement>('.ed-out')!;
    try { ta.value = localStorage.getItem('terra-nova.editor.script') ?? ''; } catch { /* storage blocked */ }
    ov.querySelector<HTMLSelectElement>('[data-a=ex]')!.onchange = (e) => { const v = (e.target as HTMLSelectElement).value; if (v) ta.value = EXAMPLES[v]; };
    ov.querySelector<HTMLButtonElement>('[data-a=cancel]')!.onclick = () => this.closeModal();
    ov.querySelector<HTMLButtonElement>('[data-a=run]')!.onclick = () => {
      const code = ta.value;
      try { localStorage.setItem('terra-nova.editor.script', code); } catch { /* storage blocked */ }
      const log: string[] = [];
      const t0 = performance.now();
      this.snapshot();
      try {
        const T = { GRASS: T_GRASS, MEADOW: T_MEADOW, FOREST: T_FOREST, DIRT: T_DIRT, SAND: T_SAND, ROCK: T_ROCK, SNOW: T_SNOW, SWAMP: T_SWAMP };
        const ORE = { COAL: ORE_COAL, IRON: ORE_IRON, GOLD: ORE_GOLD, STONE: ORE_STONE };
        const fn = new Function('map', 'T', 'ORE', 'rng', 'WATER_LEVEL', 'log', code) as (...a: unknown[]) => unknown;
        const r = fn(this.map, T, ORE, new RNG(Math.floor(Math.random() * 1e9) + 1), WATER_LEVEL, (...a: unknown[]) => log.push(a.map(String).join(' ')));
        if (r !== undefined) log.push(String(r));
        const st = this.map.stats();
        log.push(`— done in ${(performance.now() - t0).toFixed(0)} ms: ${st.land} land, ${st.mountain} mountain, ${st.trees} trees, ${st.stones} rocks, ${st.deer} deer, ${st.players} player${st.players === 1 ? '' : 's'}`);
        this.nameIn.value = this.map.name;
        this.checkT = 0.1;
        this.game.events.length = 0;
      } catch (e) {
        log.push(`Error: ${(e as Error).message}`);
      }
      out.textContent = log.join('\n');
      out.classList.remove('hidden');
    };
  }

  private async play() {
    if (this.busy) return;
    const problems = this.map.validate();
    this.renderChecks(problems);
    const errors = problems.filter((p) => p.level === 'error');
    if (errors.length) { this.setStatus(`The map cannot be played yet: ${errors[0].text}`, true); return; }
    const data = this.map.toData();
    await this.draft();
    this.busy = true;
    try { await this.hooks.play(data); } catch (e) { this.busy = false; this.setStatus(`Could not start the game: ${(e as Error).message}`, true); }
  }

  private leave() {
    if (this.busy) return;
    void this.draft().finally(() => this.hooks.back());
  }
}

/** A world for the editor: a game with no players on the map, everything in the open. */
export function editorGame(GameCtor: new (o: { size: number; seed: number; players: number; aiLevel: number }, generate: boolean) => Game, data: MapData): Game {
  const g = new GameCtor({ size: data.size, seed: 1, players: 0, aiLevel: 0 }, false);
  applyMap(g, data);
  g.world.explored.fill(1);
  g.world.exploredDirty = true;
  return g;
}

/** A map's picture on a canvas of `px` pixels a side (the free-play page's choice, the library). */
export function mapPicture(data: MapData, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  paintMap(c.getContext('2d')!, data, px);
  return c;
}
