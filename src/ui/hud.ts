// In-game HUD: resource bar, build menu, economy/military/faith/stats tabs,
// selection panel, messages and overlays. Settings live in the Esc menu (gameMenu.ts).
import {
  BUILDINGS, BUILD_ORDER, BuildingType, CATEGORY_NAMES, Category, GOODS, GOOD_NAMES, Good, JOB_NAMES, PLAYER_COLORS, TOOLS,
} from '../game/defs';
import type { Game } from '../game/game';
import type { Building, GameEvent, Settler } from '../game/types';
import type { GameRenderer } from '../render/renderer';
import type { Audio } from '../audio/audio';
import { attackableSoldiers, launchAttack } from '../game/military';
import { MANA_MAX, SPELLS, SPELL_ORDER, SpellId, castError, castSpell, faithStatus } from '../game/faith';
import { cancelExpedition, cargoCount, colonySite, harbourTraffic, scoutSeas, startExpedition } from '../game/sea';
import type { Ship } from '../game/types';
import { MAX_SHIPS } from '../game/defs';
import { PROBES, geologistsAtWork, sendGeologist } from '../game/geology';
import { pioneersAtWork, recallPioneer, sendPioneer } from '../game/pioneers';
import { callOut, commandable, fieldSoldiers, orderAttack, orderGarrison, orderMove, orderReturn } from '../game/orders';
import { ORDER_STEP, destinationsOf, donkeyCap, donkeysOf, marketAlive, marketLabel, marketTraffic, openOrder, placeOrder } from '../game/trade';
import { buildingIcons, goodIcons } from './icons';
import { Minimap } from './minimap';
import { Objectives } from './objectives';
import { prefs } from './prefs';
import { immersiveAvailable, isImmersive, leaveHint, toggleImmersive } from './immersive';

// corner brackets pointing out (fill the screen) and in (leave it) for the top-bar button
const IMM_ON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';
const IMM_OFF = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"/></svg>';

const SEASON_ICON = ['🌸', '🌿', '🍂', '❄'];

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

type Tab = 'build' | 'goods' | 'military' | 'faith' | 'stats';

export interface HudHooks {
  getSpeed(): number;
  setSpeed(s: number): void;
  restart(): void;
  openMenu(): void;
}

export class HUD {
  root: HTMLElement;
  private top!: HTMLElement;
  private left!: HTMLElement;
  private content!: HTMLElement;
  private info!: HTMLElement;
  private msgs!: HTMLElement;
  private tip!: HTMLElement;
  private hint!: HTMLElement;
  private tab: Tab = 'build';
  private cat: Category = 'basic';
  minimap!: Minimap;
  objectives!: Objectives;
  private t = 0;
  private infoT = 0;
  private attackCount = 5;
  private lastInfoKey = '';
  private fpsEl!: HTMLElement;
  private frames = 0;
  private fpsT = 0;

  constructor(private game: Game, private gr: GameRenderer, private audio: Audio, private hooks: HudHooks, parent: HTMLElement) {
    this.root = h('div', 'hud');
    parent.appendChild(this.root);
    this.buildTop();
    this.buildLeft();
    this.info = h('div', 'panel info hidden');
    this.root.appendChild(this.info);
    this.msgs = h('div', 'msgs');
    this.root.appendChild(this.msgs);
    this.tip = h('div', 'tip hidden');
    this.root.appendChild(this.tip);
    this.hint = h('div', 'hint hidden');
    this.root.appendChild(this.hint);
    this.objectives = new Objectives(this.game, this.root, (text) => {
      this.message(`✔ Objective complete: ${text}`, undefined, undefined, 'good');
      this.audio.play('built');
    });
    this.renderTab();
  }

  // ------------------------------------------------------------ top bar
  private buildTop() {
    this.top = h('div', 'panel topbar');
    this.root.appendChild(this.top);
    const menu = h('button', 'panel menu-btn', '☰');
    menu.title = 'Menu: settings, restart, quit (Esc)';
    menu.setAttribute('aria-label', 'Open the menu');
    menu.onclick = () => { this.audio.play('ui'); this.hooks.openMenu(); };
    this.root.appendChild(menu);
  }

  private icon(g: Good, cls = 'gi') {
    const src = goodIcons.get(g);
    return src ? `<img class="${cls}" src="${src}" alt="${GOOD_NAMES[g]}" title="${GOOD_NAMES[g]}">` : '';
  }

  private refreshTop() {
    const g = this.game;
    const st = g.totalStock(g.local);
    const pop = g.population(g.local);
    const food = st.bread + st.fish + st.meat;
    const tools = TOOLS.reduce((a, t) => a + st[t], 0);
    const item = (ic: string, v: number | string, label: string, warn = false) => `<div class="res${warn ? ' warn' : ''}" title="${label}">${ic}<span>${v}</span></div>`;
    const tod = this.gr.sky.timeOfDay;
    const hours = Math.floor(tod * 24), mins = Math.floor((tod * 24 - hours) * 60);
    const isNight = this.gr.sky.sunElev < 0;
    const speed = this.hooks.getSpeed();
    const mm = Math.floor(g.time / 60), ss = Math.floor(g.time % 60);
    const season = this.gr.seasons;
    this.top.innerHTML = `
      ${item(this.icon('board'), st.board, 'Boards', st.board < 4)}
      ${item(this.icon('stone'), st.stone, 'Stone', st.stone < 4)}
      ${item(this.icon('log'), st.log, 'Logs')}
      ${item(this.icon('bread'), food, 'Food (bread, fish, meat)', food < 3)}
      ${item(this.icon('coal'), st.coal, 'Coal')}
      ${item(this.icon('iron'), st.iron, 'Iron')}
      ${item(this.icon('gold'), st.gold, 'Gold — raises soldier morale')}
      ${g.players[g.local].mana > 0 || g.countBuildings(g.local, 'temple') + g.countBuildings(g.local, 'greattemple') > 0 ? item('<span class="emo mana">✦</span>', Math.floor(g.players[g.local].mana), 'Mana — offered wine, spent on divine spells') : ''}
      ${item(this.icon('hammer'), tools, 'Tools in stock')}
      <div class="sep"></div>
      ${item('<span class="emo">⚔</span>', pop.soldiers, 'Soldiers')}
      ${item('<span class="emo">👥</span>', `${pop.idle}/${pop.total}`, 'Idle carriers / total population', pop.idle < 2)}
      <div class="sep"></div>
      <div class="clock" title="${season.name}, day ${season.day(this.gr.sky.dayLength)}">${SEASON_ICON[season.index]} ${season.name}</div>
      <div class="clock" title="Time of day">${isNight ? '☾' : '☀'} ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}</div>
      <div class="clock" title="Game time">⏱ ${mm}:${String(ss).padStart(2, '0')}</div>
      <div class="speed">
        ${[0, 1, 2, 4].map((s) => `<button data-speed="${s}" class="${speed === s ? 'on' : ''}">${s === 0 ? '❚❚' : s + '×'}</button>`).join('')}
      </div>
      ${immersiveAvailable ? `<button class="mini imm${isImmersive() ? ' on' : ''}" id="imm" aria-pressed="${isImmersive()}" aria-label="Immersive mode" title="${isImmersive() ? `Leave immersive mode (F, or ${leaveHint})` : 'Immersive mode: fill the screen, so scrolling at the top edge never leaves the window (F)'}">${isImmersive() ? IMM_OFF : IMM_ON}</button>` : ''}
      <div class="fps${prefs.showFps ? '' : ' hidden'}" id="fps"></div>`;
    this.top.querySelectorAll<HTMLButtonElement>('button[data-speed]').forEach((b) => {
      b.onclick = () => { this.hooks.setSpeed(Number(b.dataset.speed)); this.audio.play('ui'); this.refreshTop(); };
    });
    const imm = this.top.querySelector<HTMLButtonElement>('#imm');
    if (imm) imm.onclick = () => { this.audio.play('ui'); void toggleImmersive(); };
    this.fpsEl = this.top.querySelector('#fps')!;
  }

  /** Fullscreen came or went (button, F, Esc or the browser itself): redraw the button, say how to get back out. */
  immersiveChanged(on: boolean) {
    this.refreshTop();
    if (on) this.message(`Immersive mode: the game fills the screen. F switches it off, ${leaveHint}.`);
  }

  // ------------------------------------------------------------ left panel
  private buildLeft() {
    this.left = h('div', 'panel left');
    this.root.appendChild(this.left);
    // on narrow screens the panel slides in from a toggle
    const toggle = h('button', 'panel-toggle', '⚒');
    toggle.title = 'Show or hide the build panel';
    toggle.onclick = () => { this.left.classList.toggle('open'); this.audio.play('ui'); };
    this.root.appendChild(toggle);
    const mmWrap = h('div', 'mm-wrap');
    this.left.appendChild(mmWrap);
    this.minimap = new Minimap(this.game, this.gr.cam, mmWrap);
    const tabs = h('div', 'tabs');
    const defs: [Tab, string, string][] = [['build', '⚒', 'Build'], ['goods', '⚖', 'Economy'], ['military', '⚔', 'Military'], ['faith', '✦', 'Faith'], ['stats', '📈', 'Statistics']];
    for (const [id, ic, label] of defs) {
      const b = h('button', 'tab' + (id === this.tab ? ' on' : ''), `<span>${ic}</span>`);
      b.title = label;
      b.onclick = () => {
        this.tab = id;
        tabs.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.audio.play('ui');
        this.renderTab();
      };
      tabs.appendChild(b);
    }
    this.left.appendChild(tabs);
    this.content = h('div', 'content');
    this.left.appendChild(this.content);
  }

  renderTab() {
    const c = this.content;
    c.innerHTML = '';
    switch (this.tab) {
      case 'build': return this.renderBuild(c);
      case 'goods': return this.renderGoods(c);
      case 'military': return this.renderMilitary(c);
      case 'faith': return this.renderFaith(c);
      case 'stats': return this.renderStats(c);
    }
  }

  private renderBuild(c: HTMLElement) {
    c.appendChild(h('h3', '', 'Construction'));
    const cats = h('div', 'cats');
    for (const k of Object.keys(CATEGORY_NAMES) as Category[]) {
      const b = h('button', 'cat' + (k === this.cat ? ' on' : ''), CATEGORY_NAMES[k]);
      b.onclick = () => { this.cat = k; this.audio.play('ui'); this.renderTab(); };
      cats.appendChild(b);
    }
    c.appendChild(cats);
    const grid = h('div', 'bgrid');
    const st = this.game.totalStock(this.game.local);
    for (const t of BUILD_ORDER[this.cat]) {
      const d = BUILDINGS[t];
      const afford = st.board >= d.cost.board && st.stone >= d.cost.stone;
      const card = h('button', 'bcard' + (this.gr.placing === t ? ' on' : '') + (afford ? '' : ' poor'));
      card.innerHTML = `<img src="${buildingIcons.get(t) ?? ''}" alt="">
        <div class="bname">${d.name}</div>
        <div class="bcost">${this.icon('board', 'ci')}${d.cost.board}${d.cost.stone ? ` ${this.icon('stone', 'ci')}${d.cost.stone}` : ''}</div>`;
      card.onmouseenter = (e) => this.showTip(e as MouseEvent, this.buildTip(t));
      card.onmouseleave = () => this.hideTip();
      card.onclick = () => { this.startPlacing(t); };
      grid.appendChild(card);
    }
    if (this.cat === 'industry') {
      // not a building: an order for a geologist to prospect a mountain
      const busy = geologistsAtWork(this.game, this.game.local);
      const card = h('button', 'bcard geo' + (this.gr.prospecting ? ' on' : ''));
      card.innerHTML = `<div class="geoicon">⛏</div>
        <div class="bname">Geologist</div>
        <div class="bcost">${busy ? `${busy} at work` : 'Prospect'}</div>`;
      card.onmouseenter = (e) => this.showTip(e as MouseEvent, `<b>Send a geologist</b><br>Click a mountain inside your borders. He probes ${PROBES} spots and leaves signs: black lumps for coal, rust for iron, gold nuggets, grey granite — one to three for a poor, fair or rich vein, a red cross for nothing. Ore he finds glitters in the rock.<br><span class="muted">Any free carrier can take up the trade.</span>`);
      card.onmouseleave = () => this.hideTip();
      card.onclick = () => this.startProspecting(!this.gr.prospecting);
      grid.appendChild(card);
    }
    if (this.cat === 'military') {
      // not a building either: pioneers stake out free land beside the border
      const busy = pioneersAtWork(this.game, this.game.local);
      const card = h('button', 'bcard geo' + (this.gr.pioneering ? ' on' : ''));
      card.innerHTML = `<div class="geoicon">⚑</div>
        <div class="bname">Pioneer</div>
        <div class="bcost">${busy ? `${busy} at work` : 'Claim land'}</div>`;
      card.onmouseenter = (e) => this.showTip(e as MouseEvent, `<b>Send a pioneer</b><br>Click free land just beyond your border. He digs in at the edge nearest the spot and stakes out the land around it, patch by patch — no tower or soldier needed. Staked land can be built on, but a foreign stronghold's borders take it for good.<br><span class="muted">A free carrier takes a shovel and becomes a pioneer; send several to work faster.</span>`);
      card.onmouseleave = () => this.hideTip();
      card.onclick = () => this.startPioneering(!this.gr.pioneering);
      grid.appendChild(card);
    }
    c.appendChild(grid);
    c.appendChild(h('p', 'note', 'Pick a building, then click a green marker on your land. <b>Shift</b>+click to place several. Right-click or <b>Esc</b> cancels.'));
  }

  private buildTip(t: BuildingType) {
    const d = BUILDINGS[t];
    let s = `<b>${d.name}</b><br>${d.desc}`;
    if (d.inputs) s += `<br><span class="muted">Needs:</span> ${d.inputs.map((i) => i.goods.map((g) => this.icon(g, 'ci')).join('/')).join(' ')}`;
    if (d.outputs) s += `<br><span class="muted">Makes:</span> ${d.outputs.map((g) => this.icon(g, 'ci')).join(' ')}`;
    if (d.worker) s += `<br><span class="muted">Worker:</span> ${JOB_NAMES[d.worker]}`;
    if (d.military) s += `<br><span class="muted">Garrison:</span> ${d.military.capacity} · <span class="muted">Radius:</span> ${d.military.radius}`;
    return s;
  }

  startPlacing(t: BuildingType | null) {
    if (t) { this.gr.casting = null; this.gr.expedition = 0; this.gr.prospecting = false; this.gr.pioneering = false; }
    this.gr.placing = t;
    if (t && window.innerWidth <= 700) this.left.classList.remove('open');
    this.audio.play('ui');
    if (t) {
      this.hint.innerHTML = `Placing <b>${BUILDINGS[t].name}</b> — click a marker to build · <b>Shift</b> keeps placing · <b>Esc</b>/right-click cancels`;
      this.hint.classList.remove('hidden');
    } else this.hint.classList.add('hidden');
    if (this.tab === 'build') this.renderTab();
  }

  private renderGoods(c: HTMLElement) {
    const g = this.game;
    const st = g.totalStock(g.local);
    c.appendChild(h('h3', '', 'Stockpiles'));
    const grid = h('div', 'ggrid');
    for (const gd of GOODS) {
      const cell = h('div', 'gcell' + (st[gd] ? '' : ' zero'), `${this.icon(gd)}<span>${st[gd]}</span>`);
      cell.title = GOOD_NAMES[gd];
      grid.appendChild(cell);
    }
    c.appendChild(grid);
    c.appendChild(h('h3', '', 'Tool production'));
    c.appendChild(h('p', 'note', 'The toolsmith forges what idle buildings are missing. Raise a priority to stockpile extra.'));
    const p = g.players[g.local];
    for (const t of TOOLS) {
      const row = h('div', 'slider-row');
      row.innerHTML = `${this.icon(t, 'ci')}<label>${GOOD_NAMES[t]}</label><input type="range" min="0" max="10" value="${p.toolPrio[t]}"><span>${p.toolPrio[t]}</span>`;
      const inp = row.querySelector('input')!;
      inp.oninput = () => { p.toolPrio[t] = Number(inp.value); row.querySelector('span')!.textContent = inp.value; };
      c.appendChild(row);
    }
    const fleet = [...g.ships.values()].filter((sh) => sh.owner === g.local);
    if (fleet.length || g.countBuildings(g.local, 'harbour') || g.countBuildings(g.local, 'shipyard')) {
      c.appendChild(h('h3', '', `Fleet <small class="muted">${fleet.length}/${MAX_SHIPS}</small>`));
      const list = h('div', 'list');
      for (const sh of fleet) {
        const row = h('button', 'lrow', `<span class="emo">⛵</span><span>${sh.name}</span><b>${shipDoing(g, sh)}</b>`);
        row.onclick = () => { this.gr.cam.jumpTo(sh.x, sh.z + 2); this.select({ kind: 'ship', id: sh.id }); };
        list.appendChild(row);
      }
      if (!fleet.length) list.appendChild(h('p', 'note', 'Build a Shipyard on the coast: its shipwright turns boards into ships.'));
      c.appendChild(list);
    }
    const markets = [...g.buildings.values()].filter((b) => b.owner === g.local && b.type === 'market' && b.state === 'done');
    if (markets.length || g.countBuildings(g.local, 'donkeyfarm')) {
      c.appendChild(h('h3', '', `Caravans <small class="muted">${donkeysOf(g, g.local)} donkeys of ${donkeyCap(g, g.local)}</small>`));
      const list = h('div', 'list');
      const orders = g.tradeOrders.filter((o) => o.owner === g.local && o.n - o.delivered > 0);
      for (const o of orders) {
        const from = g.buildings.get(o.from), to = g.buildings.get(o.to);
        if (!from || !to) continue;
        const row = h('button', 'lrow', `${this.icon(o.good)}<span>${GOOD_NAMES[o.good]} → ${marketLabel(g, to, from.cx, from.cz).replace('Market ', '')}</span><b>${o.delivered}/${o.n}${o.loaded ? ` <small>· ${o.loaded} on the road</small>` : ''}</b>`);
        row.onclick = () => { this.gr.cam.jumpTo(from.cx, from.cz + 2); this.select({ kind: 'building', id: from.id }); };
        list.appendChild(row);
      }
      if (!orders.length) list.appendChild(h('p', 'note', markets.length < 2 ? 'Build two Market Places on the same land and a Donkey Ranch; donkeys carry goods between the markets.' : 'Select a market place, choose the other market and click + on the goods to send.'));
      c.appendChild(list);
    }
    c.appendChild(h('h3', '', 'Weapons'));
    const row = h('div', 'slider-row');
    row.innerHTML = `${this.icon('sword', 'ci')}<label>Swords vs bows</label><input type="range" min="0" max="100" value="${Math.round(p.swordRatio * 100)}"><span>${Math.round(p.swordRatio * 100)}%</span>`;
    const inp = row.querySelector('input')!;
    inp.oninput = () => { p.swordRatio = Number(inp.value) / 100; row.querySelector('span')!.textContent = inp.value + '%'; };
    c.appendChild(row);
  }

  private renderMilitary(c: HTMLElement) {
    const g = this.game;
    const pop = g.population(g.local);
    const p = g.players[g.local];
    c.appendChild(h('h3', '', 'Army'));
    let inTowers = 0, idle = 0, swords = 0, bows = 0;
    for (const s of g.settlers.values()) {
      if (s.owner !== g.local || s.dead) continue;
      if (s.job === 'swordsman') swords++;
      if (s.job === 'bowman') bows++;
      if (s.job === 'swordsman' || s.job === 'bowman') { if (s.sstate === 'garrison') inTowers++; else idle++; }
    }
    c.appendChild(h('div', 'kv', `<span>Soldiers</span><b>${pop.soldiers}</b>`));
    c.appendChild(h('div', 'kv', `<span>Swordsmen / Bowmen</span><b>${swords} / ${bows}</b>`));
    c.appendChild(h('div', 'kv', `<span>Garrisoned / in the field</span><b>${inTowers} / ${idle}</b>`));
    c.appendChild(h('div', 'kv', `<span>Morale (gold)</span><b>${Math.round(p.morale * 100)}%</b>`));
    const field = fieldSoldiers(g, g.local);
    const all = h('button', 'wide', field.length ? `⚔ Select the ${field.length} in the field` : 'No soldiers in the field');
    (all as HTMLButtonElement).disabled = !field.length;
    all.onclick = () => { this.selectSoldiers(field.map((x) => x.id)); const f = field[0]; if (f) this.gr.cam.jumpTo(f.x, f.z + 2); };
    c.appendChild(all);
    c.appendChild(h('h3', '', 'Strongholds'));
    const list = h('div', 'list');
    for (const b of g.buildings.values()) {
      if (b.owner !== g.local || !b.def.military) continue;
      const row = h('button', 'lrow', `<img src="${buildingIcons.get(b.type)}"><span>${b.def.name}</span><b>${b.state === 'done' ? `${b.garrison.length}/${b.desiredSoldiers}` : 'building'}</b>`);
      row.onclick = () => { this.gr.cam.jumpTo(b.cx, b.cz + 2); this.select({ kind: 'building', id: b.id }); };
      list.appendChild(row);
    }
    c.appendChild(list);
    c.appendChild(h('p', 'note', 'Drag a box around your soldiers (or <b>Call out</b> a stronghold\'s garrison), then <b>right-click</b> the ground to send them there to stand guard, an enemy stronghold to storm it, or one of your towers to man it. <b>R</b> sends them back to duty. To attack from your towers directly, select an enemy stronghold and press <b>Attack</b>. Train soldiers in <b>Barracks</b> with swords and bows from the <b>Weaponsmith</b>.'));
  }

  private renderFaith(c: HTMLElement) {
    const g = this.game;
    const p = g.players[g.local];
    const st = faithStatus(g, g.local);
    c.appendChild(h('h3', '', 'Favour of the gods'));
    c.appendChild(h('div', 'mana-gauge', `<div class="mana-orb">✦</div><div class="mana-body"><div class="kv"><span>Mana</span><b>${Math.floor(p.mana)} / ${MANA_MAX}</b></div><div class="bar mana"><i style="width:${Math.round((p.mana / MANA_MAX) * 100)}%"></i></div></div>`));
    c.appendChild(h('div', 'kv', `<span>Temples · priests serving</span><b>${st.temples} · ${st.priests}</b></div>`));
    c.appendChild(h('div', 'kv', `<span>Great Temple</span><b>${st.great ? 'Consecrated' : '<span class="muted">none</span>'}</b>`));
    c.appendChild(h('h3', '', 'Divine spells'));
    const list = h('div', 'spells');
    for (const id of SPELL_ORDER) {
      const d = SPELLS[id];
      const lock = !st.temples ? 'Needs a Temple' : d.great && !st.great ? 'Needs a Great Temple' : !st.priests ? 'No priest serving' : p.mana < d.cost ? `${Math.floor(p.mana)}/${d.cost} mana` : '';
      const col = `rgb(${d.color.map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`;
      const card = h('button', 'spell' + (lock ? ' locked' : '') + (this.gr.casting === id ? ' on' : ''), `
        <div class="sglyph" style="--sc:${col}">${d.glyph}</div>
        <div class="sbody"><div class="sname">${d.name}<span class="scost">✦ ${d.cost}</span></div><div class="sdesc">${d.desc}</div>${lock ? `<div class="slock">${lock}</div>` : ''}</div>`);
      card.onclick = () => {
        if (lock) { this.message(lock, undefined, undefined, 'bad'); this.audio.play('click'); return; }
        this.startCasting(this.gr.casting === id ? null : id);
      };
      list.appendChild(card);
    }
    c.appendChild(list);
    c.appendChild(h('p', 'note', 'A <b>Vineyard</b> makes wine. Carriers take it to a <b>Temple</b>, where the priest offers it to the gods as mana. Pick a spell, then click the ground within reach of your strongholds.'));
  }

  startCasting(id: SpellId | null) {
    this.gr.casting = id;
    if (id) { this.gr.placing = null; this.gr.expedition = 0; this.gr.prospecting = false; this.gr.pioneering = false; }
    if (id && window.innerWidth <= 700) this.left.classList.remove('open');
    this.audio.play('ui');
    if (id) {
      this.hint.innerHTML = `Casting <b>${SPELLS[id].name}</b> — click the ground to call it down · <b>Shift</b> keeps casting · <b>Esc</b>/right-click cancels`;
      this.hint.classList.remove('hidden');
    } else if (!this.gr.placing) this.hint.classList.add('hidden');
    if (this.tab === 'faith') this.renderTab();
  }

  /** Cast the active spell at a ground point. Returns true on success. */
  castAt(x: number, z: number, keep: boolean) {
    const id = this.gr.casting;
    if (!id) return false;
    const g = this.game;
    const err = castError(g, g.local, id, x, z);
    if (err) { this.message(err, undefined, undefined, 'bad'); this.audio.play('click'); return false; }
    castSpell(g, g.local, id, x, z);
    if (!keep || g.players[g.local].mana < SPELLS[id].cost) this.startCasting(null);
    else if (this.tab === 'faith') this.renderTab();
    return true;
  }

  private renderStats(c: HTMLElement) {
    const g = this.game;
    c.appendChild(h('h3', '', 'Kingdoms'));
    for (const p of g.players) {
      const pop = g.population(p.id);
      const row = h('div', 'kv', `<span><i class="sw" style="background:${hex(PLAYER_COLORS[p.id])}"></i>${p.name}${p.ai ? ' (AI)' : ' (you)'}${p.alive ? '' : ' — defeated'}</span><b>${pop.total} · ⚔${pop.soldiers} · 🏠${g.countBuildings(p.id, undefined, false)}</b>`);
      c.appendChild(row);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 540;
    canvas.height = 300;
    canvas.className = 'chart';
    c.appendChild(h('h3', '', 'Population over time'));
    c.appendChild(canvas);
    this.drawChart(canvas, 'pop');
    const canvas2 = document.createElement('canvas');
    canvas2.width = 540;
    canvas2.height = 240;
    canvas2.className = 'chart';
    c.appendChild(h('h3', '', 'Soldiers over time'));
    c.appendChild(canvas2);
    this.drawChart(canvas2, 'soldiers');
    const p = g.players[g.local];
    c.appendChild(h('h3', '', 'Produced so far'));
    const grid = h('div', 'ggrid');
    for (const gd of GOODS) {
      if (!p.produced[gd]) continue;
      grid.appendChild(h('div', 'gcell', `${this.icon(gd)}<span>${p.produced[gd]}</span>`));
    }
    c.appendChild(grid);
  }

  private drawChart(cv: HTMLCanvasElement, key: 'pop' | 'soldiers') {
    const ctx = cv.getContext('2d')!;
    const g = this.game;
    const W = cv.width, H = cv.height, pad = 30;
    ctx.clearRect(0, 0, W, H);
    let maxV = 5, maxT = 60;
    for (const p of g.players) for (const hpt of p.history) { maxV = Math.max(maxV, hpt[key]); maxT = Math.max(maxT, hpt.t); }
    ctx.strokeStyle = 'rgba(241,230,207,0.15)';
    ctx.fillStyle = 'rgba(241,230,207,0.6)';
    ctx.font = '16px Inter, sans-serif';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const y = pad + ((H - pad * 2) * k) / 4;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - 8, y); ctx.stroke();
      ctx.fillText(String(Math.round(maxV * (1 - k / 4))), 2, y + 5);
    }
    for (const p of g.players) {
      ctx.strokeStyle = hex(PLAYER_COLORS[p.id]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      p.history.forEach((hpt, k) => {
        const x = pad + ((W - pad - 8) * hpt.t) / maxT, y = pad + (H - pad * 2) * (1 - hpt[key] / maxV);
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
  }

  /** Geologist targeting: click a mountain inside the borders. */
  startProspecting(on: boolean) {
    this.gr.prospecting = on;
    if (on) { this.gr.placing = null; this.gr.casting = null; this.gr.expedition = 0; this.gr.pioneering = false; }
    if (on && window.innerWidth <= 700) this.left.classList.remove('open');
    this.audio.play('ui');
    if (on) {
      this.hint.innerHTML = `Send a <b>geologist</b> — click a mountain inside your borders · <b>Shift</b> sends several · <b>Esc</b>/right-click cancels`;
      this.hint.classList.remove('hidden');
    } else if (!this.gr.placing && !this.gr.casting && !this.gr.expedition && !this.gr.pioneering) this.hint.classList.add('hidden');
    if (this.tab === 'build') this.renderTab();
  }

  prospectAt(x: number, z: number, keep: boolean) {
    const g = this.game;
    const err = sendGeologist(g, g.local, x, z);
    if (err) { this.message(err, undefined, undefined, 'bad'); this.audio.play('click'); return; }
    this.message('A geologist sets out for the mountain', x, z, 'good');
    this.audio.play('place');
    if (!keep) this.startProspecting(false);
    else if (this.tab === 'build') this.renderTab();
  }

  /** Pioneer targeting: click free land beside the border. */
  startPioneering(on: boolean) {
    this.gr.pioneering = on;
    if (on) { this.gr.placing = null; this.gr.casting = null; this.gr.expedition = 0; this.gr.prospecting = false; }
    if (on && window.innerWidth <= 700) this.left.classList.remove('open');
    this.audio.play('ui');
    if (on) {
      this.hint.innerHTML = `Send a <b>pioneer</b> — click free land just beyond your border · <b>Shift</b> sends several · <b>Esc</b>/right-click cancels`;
      this.hint.classList.remove('hidden');
    } else if (!this.gr.placing && !this.gr.casting && !this.gr.expedition && !this.gr.prospecting) this.hint.classList.add('hidden');
    if (this.tab === 'build') this.renderTab();
  }

  pioneerAt(x: number, z: number, keep: boolean) {
    const g = this.game;
    const err = sendPioneer(g, g.local, x, z);
    if (err) { this.message(err, undefined, undefined, 'bad'); this.audio.play('click'); return; }
    this.message('A pioneer sets out to stake out the land', x, z, 'good');
    this.audio.play('place');
    if (!keep) this.startPioneering(false);
    else if (this.tab === 'build') this.renderTab();
  }

  /** Leave whichever targeting mode is on. Returns false when none was. */
  cancelMode(): boolean {
    if (this.gr.placing) this.startPlacing(null);
    else if (this.gr.casting) this.startCasting(null);
    else if (this.gr.expedition) this.startExpedition(0);
    else if (this.gr.prospecting) this.startProspecting(false);
    else if (this.gr.pioneering) this.startPioneering(false);
    else if (this.gr.commanding) this.startCommanding(null);
    else return false;
    return true;
  }

  /** Expedition targeting: pick a free coast for a colony founded from harbour `from`. */
  startExpedition(from: number) {
    this.gr.expedition = from;
    this.gr.placing = null;
    this.gr.casting = null;
    this.gr.prospecting = false;
    this.gr.pioneering = false;
    if (window.innerWidth <= 700) this.left.classList.remove('open');
    this.audio.play('ui');
    if (from) {
      this.hint.innerHTML = `Choose a coast for the <b>colony</b> — blue markers show free landing sites · <b>Esc</b>/right-click cancels`;
      this.hint.classList.remove('hidden');
    } else if (!this.gr.placing && !this.gr.casting) this.hint.classList.add('hidden');
  }

  /** Click during expedition targeting. */
  expeditionAt(x: number, z: number) {
    const g = this.game;
    const from = g.buildings.get(this.gr.expedition);
    if (!from) { this.startExpedition(0); return; }
    const site = colonySite(g, g.local, from, x, z);
    if (typeof site === 'string') { this.message(site, undefined, undefined, 'bad'); this.audio.play('click'); return; }
    startExpedition(g, g.local, from, site);
    this.message('An expedition is gathering at the harbour: a builder, a digger, a soldier, two carriers and building materials', from.cx, from.cz, 'good');
    this.audio.play('horn');
    this.startExpedition(0);
    this.lastInfoKey = '';
  }

  // ------------------------------------------------------------ selection panel
  select(sel: { kind: 'building' | 'settler' | 'ship'; id: number } | null, add = false) {
    // one of our soldiers: he joins (or starts) the group that takes orders
    if (sel?.kind === 'settler') {
      const s = this.game.settlers.get(sel.id);
      if (commandable(this.game, this.game.local, s) && !s.inside) {
        const cur = this.gr.orders.chosen;
        if (add) this.selectSoldiers(cur.includes(s.id) ? cur.filter((id) => id !== s.id) : [...cur, s.id]);
        else this.selectSoldiers([s.id]);
        return;
      }
    }
    if (this.gr.orders.chosen.length && !this.modeOn()) this.hint.classList.add('hidden');
    this.gr.orders.chosen = [];
    this.gr.commanding = null;
    this.gr.selected = sel;
    this.lastInfoKey = '';
    this.infoT = 0;
    if (sel) this.audio.play('click');
    this.refreshInfo();
  }

  /** Pick soldiers to give orders to (an empty list lets them go). */
  selectSoldiers(ids: number[], add = false) {
    const o = this.gr.orders;
    o.chosen = add ? [...new Set([...o.chosen, ...ids])] : [...new Set(ids)];
    o.prune();
    this.gr.selected = null;
    this.gr.commanding = null;
    this.lastInfoKey = '';
    this.infoT = 0;
    if (o.chosen.length) this.audio.play('click');
    this.refreshInfo();
    if (o.chosen.length) {
      this.hint.innerHTML = `<b>Right-click</b>: march there and stand guard · on an enemy stronghold: storm it · on your tower: man it · <b>R</b> back to duty · <b>Esc</b> lets them go`;
      this.hint.classList.remove('hidden');
    } else if (!this.modeOn()) this.hint.classList.add('hidden');
  }

  private modeOn() {
    const gr = this.gr;
    return !!(gr.placing || gr.casting || gr.expedition || gr.prospecting || gr.pioneering || gr.commanding);
  }

  /** Give the chosen soldiers an order at a screen point: storm, man or march there. */
  commandAt(clientX: number, clientY: number, kind: 'move' | 'attack' | null = null) {
    const g = this.game, gr = this.gr;
    const ids = gr.orders.chosen;
    if (!ids.length) return false;
    const b = gr.pickBuilding(clientX, clientY);
    const w = g.world;
    const seen = b && w.explored[w.idx(Math.round(b.cx), Math.round(b.cz))];
    if (b && seen && b.def.military && b.state === 'done' && b.owner !== g.local && kind !== 'move') {
      const n = orderAttack(g, g.local, ids, b);
      if (!n) { this.message('None of them can reach it', b.cx, b.cz, 'bad'); this.audio.play('click'); return false; }
      this.message(`${n} soldier${n > 1 ? 's' : ''} storm the enemy ${b.def.name}!`, b.cx, b.cz, 'good');
      this.audio.play('horn');
      return true;
    }
    if (kind === 'attack') { this.message('Pick an enemy stronghold to storm', undefined, undefined, 'bad'); this.audio.play('click'); return false; }
    if (b && b.owner === g.local && b.def.military && b.state === 'done' && kind !== 'move') {
      const n = orderGarrison(g, g.local, ids, b);
      this.message(n ? `${n} soldier${n > 1 ? 's' : ''} march into the ${b.def.name}` : `The ${b.def.name} has no room`, b.cx, b.cz, n ? 'good' : 'bad');
      this.audio.play(n ? 'place' : 'click');
      return n > 0;
    }
    const p = gr.pickGround(clientX, clientY);
    if (!p) return false;
    const n = orderMove(g, g.local, ids, p.x, p.z);
    if (!n) { this.message('They cannot get there', p.x, p.z, 'bad'); this.audio.play('click'); return false; }
    this.audio.play('place');
    return true;
  }

  /** The chosen soldiers go back to garrison duty. */
  returnToDuty() {
    const n = orderReturn(this.game, this.game.local, this.gr.orders.chosen);
    if (n) this.message(`${n} soldier${n > 1 ? 's' : ''} return to their posts`, undefined, undefined, 'good');
    this.selectSoldiers([]);
  }

  /** Move or Attack from the panel: the next click picks the target. */
  startCommanding(kind: 'move' | 'attack' | null) {
    this.gr.commanding = kind;
    this.audio.play('ui');
    if (kind) {
      this.hint.innerHTML = kind === 'move'
        ? `Click where they should stand guard · <b>Esc</b>/right-click cancels`
        : `Click an enemy stronghold to storm · <b>Esc</b>/right-click cancels`;
      this.hint.classList.remove('hidden');
    } else this.selectSoldiers(this.gr.orders.chosen);
  }

  private renderGroupInfo(ids: number[]) {
    const g = this.game;
    let sw = 0, bw = 0, hp = 0, max = 0;
    const doing: Record<string, number> = {};
    const ORDERS: Record<string, string> = { hold: 'Standing guard', attack: 'Storming', moving: 'Marching to a post', idle: 'Awaiting orders', return: 'Returning', defend: 'Defending' };
    for (const id of ids) {
      const s = g.settlers.get(id)!;
      if (s.job === 'swordsman') sw++; else bw++;
      hp += Math.max(0, s.hp);
      max += s.maxHp;
      const d = s.engaged ? 'Fighting' : ORDERS[s.sstate] ?? 'Busy';
      doing[d] = (doing[d] ?? 0) + 1;
    }
    let body = `<div class="kv"><span>Swordsmen · bowmen</span><b>⚔ ${sw} · 🏹 ${bw}</b></div>`;
    body += `<div class="kv"><span>Health</span><b>${Math.round((hp / Math.max(1, max)) * 100)}%</b></div><div class="bar hp"><i style="width:${(hp / Math.max(1, max)) * 100}%"></i></div>`;
    body += `<div class="kv"><span>Orders</span><b>${Object.entries(doing).map(([k, v]) => `${k} ${v}`).join(' · ')}</b></div>`;
    const cm = this.gr.commanding;
    const buttons = `<button class="${cm === 'move' ? 'primary' : ''}" data-act="move">🚩 Move…</button><button class="${cm === 'attack' ? 'primary' : ''}" data-act="attack">⚔ Attack…</button><button data-act="duty">↩ Back to duty</button>`;
    const key = `grp|${ids.join(',')}|${body}|${cm}`;
    if (key === this.lastInfoKey) return;
    this.lastInfoKey = key;
    this.info.innerHTML = `
      <div class="ihead"><div class="avatar" style="background:${hex(PLAYER_COLORS[g.local])}">⚔</div><div><h2>${ids.length} soldier${ids.length > 1 ? 's' : ''}</h2><div class="owner">${g.players[g.local].name}</div></div><button class="close" data-act="close">✕</button></div>
      <div class="ibody">${body}</div>
      <div class="ibtns">${buttons}</div>`;
    this.info.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      const act = el.dataset.act!;
      el.onclick = () => {
        if (act === 'close') this.selectSoldiers([]);
        else if (act === 'move' || act === 'attack') this.startCommanding(this.gr.commanding === act ? null : act);
        else if (act === 'duty') this.returnToDuty();
      };
    });
  }

  private refreshInfo() {
    const sel = this.gr.selected;
    const g = this.game;
    const grp = this.gr.orders;
    if (grp.chosen.length) {
      grp.prune();
      if (grp.chosen.length) { this.renderGroupInfo(grp.chosen); this.info.classList.remove('hidden'); return; }
      this.selectSoldiers([]);
      return;
    }
    if (!sel) { this.info.classList.add('hidden'); return; }
    if (sel.kind === 'building') {
      const b = g.buildings.get(sel.id);
      if (!b) { this.select(null); return; }
      this.renderBuildingInfo(b);
    } else if (sel.kind === 'ship') {
      const sh = g.ships.get(sel.id);
      if (!sh) { this.select(null); return; }
      this.renderShipInfo(sh);
    } else {
      const s = g.settlers.get(sel.id);
      if (!s || s.dead) { this.select(null); return; }
      this.renderSettlerInfo(s);
    }
    this.info.classList.remove('hidden');
  }

  private renderBuildingInfo(b: Building) {
    const g = this.game;
    const mine = b.owner === g.local;
    const d = b.def;
    let body = '';
    const pct = (v: number) => `<div class="bar"><i style="width:${Math.round(Math.min(1, v) * 100)}%"></i></div>`;
    if (b.state === 'leveling' || b.state === 'building') {
      const total = d.cost.board + d.cost.stone;
      const del = b.delivered.board + b.delivered.stone;
      body += `<div class="kv"><span>${b.state === 'leveling' ? 'Levelling ground' : 'Construction'}</span><b>${Math.round((b.buildWork / b.buildTotal) * 100)}%</b></div>${pct(b.buildWork / b.buildTotal)}`;
      body += `<div class="kv"><span>Materials delivered</span><b>${this.icon('board', 'ci')}${b.delivered.board}/${d.cost.board} ${this.icon('stone', 'ci')}${b.delivered.stone}/${d.cost.stone}</b></div>`;
      body += `<div class="kv"><span>Crew</span><b>${b.diggers.length} diggers · ${b.builders.length} builders</b></div>`;
      void total; void del;
    } else if (b.state === 'burning') {
      body += `<div class="status bad">🔥 Burning down…</div>`;
    } else {
      if (d.worker) {
        const w = b.worker ? g.settlers.get(b.worker) : null;
        body += `<div class="kv"><span>Worker</span><b>${w ? JOB_NAMES[w.job] : b.workerIncoming ? 'on the way' : '<span class="bad">none</span>'}</b></div>`;
      }
      if (d.cycle && b.working) body += `<div class="kv"><span>Production</span><b>${Math.round((b.workT / d.cycle) * 100)}%</b></div>${pct(b.workT / d.cycle)}`;
      if (d.inputs) {
        body += `<div class="kv"><span>Supplies</span><b>${d.inputs.map((inp) => inp.goods.map((gd) => `${this.icon(gd, 'ci')}${b.stock[gd]}`).join(' ') + `<small>/${inp.cap}</small>`).join(' &nbsp; ')}</b></div>`;
      }
      if (d.outputs && !d.storage) {
        const outs = d.outputs.filter((gd) => b.stock[gd] > 0 || d.outputs!.length === 1);
        body += `<div class="kv"><span>Ready for pickup</span><b>${outs.length ? outs.map((gd) => `${this.icon(gd, 'ci')}${b.stock[gd]}`).join(' ') : '—'}</b></div>`;
        body += `<div class="kv"><span>Produced</span><b>${b.prodCount}</b></div>`;
      }
      if (d.mine) body += `<div class="kv"><span>Deposit remaining</span><b>${g.mineOreLeft(b)}</b></div>`;
      if (d.residence) body += `<div class="kv"><span>Residents</span><b>${b.spawned}/${d.residence}</b></div>${pct(b.spawned / d.residence)}`;
      if (d.storage) {
        const cells = GOODS.filter((gd) => b.stock[gd] > 0).map((gd) => `<div class="gcell" title="${GOOD_NAMES[gd]}">${this.icon(gd)}<span>${b.stock[gd]}</span></div>`).join('');
        body += `<div class="ggrid small">${cells || '<span class="muted">empty</span>'}</div>`;
      }
      if (d.military) {
        const cap = d.military.capacity;
        let sw = 0, bw = 0;
        for (const id of b.garrison) { const s = g.settlers.get(id); if (s?.job === 'swordsman') sw++; else if (s?.job === 'bowman') bw++; }
        body += `<div class="kv"><span>Garrison</span><b>⚔ ${sw} · 🏹 ${bw} &nbsp;(${b.garrison.length}/${b.type === 'hq' ? '∞' : cap})</b></div>`;
        if (mine && b.type !== 'hq') body += `<div class="kv"><span>Desired soldiers</span><b><button class="mini" data-act="des-">−</button> ${b.desiredSoldiers} <button class="mini" data-act="des+">+</button></b></div>`;
        if (!b.occupied && mine) body += `<div class="status">Waiting for a soldier to man it</div>`;
        if (!mine && b.state === 'done') {
          const avail = attackableSoldiers(g, g.local, b).length;
          this.attackCount = Math.min(Math.max(1, this.attackCount), Math.max(1, avail));
          body += avail
            ? `<div class="attack"><div class="kv"><span>Soldiers in reach</span><b>${avail}</b></div>
               <div class="slider-row"><label>Send</label><input type="range" min="1" max="${avail}" value="${this.attackCount}" data-act="count"><span>${this.attackCount}</span></div>
               <button class="wide danger" data-act="attack">⚔ Attack!</button></div>`
            : `<div class="status">No soldiers in reach. Build military buildings closer to attack.</div>`;
        }
      }
      if (b.type === 'harbour' && mine) {
        const tr = harbourTraffic(g, b);
        body += `<div class="kv"><span>Ships moored · inbound</span><b>⛵ ${tr.docked} · ${tr.inbound}</b></div>`;
        if (tr.waiting) body += `<div class="kv"><span>Waiting to sail</span><b>👥 ${tr.waiting}</b></div>`;
        if (tr.exports) body += `<div class="kv"><span>Gathering for shipping</span><b>${GOODS.filter((gd) => b.seaWant && b.seaWant[gd] > 0).map((gd) => `${this.icon(gd, 'ci')}${b.seaWant![gd]}`).join(' ')}</b></div>`;
        const ex = g.expeditions.find((e) => e.from === b.id && e.owner === g.local);
        if (ex) {
          let party = 0;
          for (const s of g.settlers.values()) if (s.voyage === -ex.id && s.inside === b.id) party++;
          const need = ex.people.builder + ex.people.digger + ex.people.soldier + ex.people.carrier;
          body += `<div class="status">${ex.state === 'gathering' ? `⚓ Expedition gathering: party ${party}/${need} · ${this.icon('board', 'ci')}${Math.min(b.stock.board, ex.goods.board)}/${ex.goods.board} ${this.icon('stone', 'ci')}${Math.min(b.stock.stone, ex.goods.stone)}/${ex.goods.stone}${party >= need && b.stock.board >= ex.goods.board && b.stock.stone >= ex.goods.stone ? ' · waiting for a ship' : ''}` : '⛵ The expedition is at sea'}</div>`;
        }
      }
      if (b.type === 'shipyard' && mine) {
        let fleet = 0;
        for (const sh of g.ships.values()) if (sh.owner === b.owner) fleet++;
        body += `<div class="kv"><span>Hull on the slipway</span><b>${Math.round(b.shipProgress * 100)}%</b></div>${pct(b.shipProgress)}`;
        body += `<div class="kv"><span>Fleet</span><b>⛵ ${fleet}/${MAX_SHIPS}</b></div>`;
      }
      if (b.type === 'market' && mine) {
        const tr = marketTraffic(g, b);
        const dests = destinationsOf(g, b);
        body += `<div class="kv"><span>Donkeys waiting · bound here</span><b>🐴 ${tr.here} · ${tr.coming}</b></div>`;
        if (tr.incoming) body += `<div class="kv"><span>Expected from other markets</span><b>${tr.incoming}</b></div>`;
        const opts = dests.map((d) => `<option value="${d.id}"${b.tradeTo === d.id ? ' selected' : ''}>${marketLabel(g, d, b.cx, b.cz)}</option>`).join('');
        body += `<div class="kv"><span>Send goods to</span><b><select data-act="dest"><option value="0">${dests.length ? '— choose a market —' : 'no other market on this land'}</option>${opts}</select></b></div>`;
        if (b.tradeTo && marketAlive(g, b.tradeTo, g.local)) {
          body += `<div class="tgrid">${GOODS.map((gd) => {
            const o = openOrder(g, b, b.tradeTo, gd);
            const here = b.stock[gd];
            return `<div class="tcell${o ? ' on' : ''}" title="${GOOD_NAMES[gd]}: ${here} here${o ? `, ${o.delivered} of ${o.n} delivered${o.loaded ? `, ${o.loaded} on the road` : ''}` : ''}">${this.icon(gd, 'ci')}<span>${o ? `${o.delivered}/${o.n}` : here || ''}</span><div class="tbtn"><button class="mini" data-act="ord-|${gd}" title="Send ${ORDER_STEP} fewer">−</button><button class="mini" data-act="ord+|${gd}" title="Send ${ORDER_STEP} more">+</button></div></div>`;
          }).join('')}</div>`;
          body += `<p class="note">Each <b>+</b> orders ${ORDER_STEP} more of a good. Carriers stock them here${tr.ready ? ` (${tr.ready} ready)` : ''}; donkeys carry two at a time.</p>`;
        } else if (dests.length) body += `<div class="status">Choose a market to trade with</div>`;
        else body += `<div class="status">Build another Market Place on this land to trade with${g.countBuildings(g.local, 'donkeyfarm') ? '' : ', and a Donkey Ranch for the donkeys'}</div>`;
      }
      if (b.type === 'donkeyfarm' && mine) {
        body += `<div class="kv"><span>Donkeys bred · kept</span><b>🐴 ${donkeysOf(g, g.local)} / ${donkeyCap(g, g.local)}</b></div>`;
      }
      if (b.type === 'toolsmith' && mine) {
        body += `<div class="kv"><span>Forge</span><select data-act="tool"><option value="auto">Auto (by demand)</option>${TOOLS.map((t) => `<option value="${t}" ${b.toolChoice === t ? 'selected' : ''}>${GOOD_NAMES[t]}</option>`).join('')}</select></div>`;
      }
      if (b.status && !d.military) body += `<div class="status ${/Missing|No |Waiting|full|exhausted/.test(b.status) ? 'warn' : ''}">${b.status}</div>`;
    }
    const buttons: string[] = [];
    if (mine && b.state === 'done' && b.type === 'harbour') {
      const ex = g.expeditions.find((e) => e.from === b.id && e.owner === g.local);
      if (ex && ex.state === 'gathering') buttons.push(`<button data-act="exCancel">✕ Call off expedition</button>`);
      else if (!ex) buttons.push(`<button class="primary" data-act="expedition">⚓ Found a colony</button>`);
      buttons.push(`<button data-act="scout">🧭 Scout the seas</button>`);
    }
    if (mine && b.state === 'done' && d.military && b.garrison.length > 1) buttons.push(`<button class="primary" data-act="callout">⚔ Call out ${b.garrison.length - 1}</button>`);
    if (mine && b.state === 'done' && (d.cycle || d.worker) && !d.military) buttons.push(`<button data-act="pause">${b.paused ? '▶ Resume' : '❚❚ Pause'}</button>`);
    if (mine && b.type !== 'hq' && b.state !== 'burning') buttons.push(`<button class="danger" data-act="destroy">🔥 Demolish</button>`);
    const key = `${b.id}|${body}|${buttons.join('')}`;
    if (key === this.lastInfoKey) return;
    this.lastInfoKey = key;
    const owner = g.players[b.owner];
    this.info.innerHTML = `
      <div class="ihead"><img src="${buildingIcons.get(b.type) ?? ''}"><div><h2>${d.name}</h2><div class="owner"><i class="sw" style="background:${hex(PLAYER_COLORS[b.owner])}"></i>${owner.name}</div></div><button class="close" data-act="close">✕</button></div>
      <div class="ibody">${body}</div>
      <div class="ibtns">${buttons.join('')}</div>`;
    this.info.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      const act = el.dataset.act!;
      if (act === 'count') {
        (el as HTMLInputElement).oninput = () => { this.attackCount = Number((el as HTMLInputElement).value); el.nextElementSibling!.textContent = String(this.attackCount); };
        return;
      }
      if (act === 'tool') {
        (el as HTMLSelectElement).onchange = () => { b.toolChoice = (el as HTMLSelectElement).value as any; };
        return;
      }
      if (act === 'dest') {
        (el as HTMLSelectElement).onchange = () => { b.tradeTo = Number((el as HTMLSelectElement).value) || 0; this.audio.play('ui'); this.lastInfoKey = ''; this.refreshInfo(); };
        return;
      }
      el.onclick = () => {
        this.audio.play('ui');
        if (act === 'close') this.select(null);
        else if (act === 'pause') b.paused = !b.paused;
        else if (act === 'callout') {
          const men = callOut(g, g.local, b, 1);
          if (men.length) { this.selectSoldiers(men.map((x) => x.id)); this.audio.play('horn'); return; }
        }
        else if (act === 'destroy') { g.destroyBuilding(b, true); this.select(null); }
        else if (act === 'des-') b.desiredSoldiers = Math.max(1, b.desiredSoldiers - 1);
        else if (act === 'des+') b.desiredSoldiers = Math.min(b.def.military!.capacity, b.desiredSoldiers + 1);
        else if (act === 'expedition') {
          if (![...g.ships.values()].some((sh) => sh.owner === g.local)) this.message('You have no ship yet — build a Shipyard on the coast first', b.cx, b.cz, 'bad');
          this.startExpedition(b.id);
        } else if (act === 'exCancel') {
          const ex = g.expeditions.find((e) => e.from === b.id && e.owner === g.local);
          if (ex) cancelExpedition(g, ex);
        } else if (act === 'scout') {
          const err = scoutSeas(g, g.local, b);
          this.message(err ?? 'A ship sets out to explore the seas', b.cx, b.cz, err ? 'bad' : 'good');
        }
        else if (act.startsWith('ord')) {
          const gd = act.slice(5) as Good;
          const err = placeOrder(g, b, b.tradeTo, gd, act[3] === '+' ? ORDER_STEP : -ORDER_STEP);
          if (err) { this.message(err, undefined, undefined, 'bad'); this.audio.play('click'); }
        }
        else if (act === 'attack') {
          const n = launchAttack(g, g.local, b, this.attackCount);
          this.message(n ? `${n} soldiers march on the enemy ${d.name}!` : 'No soldiers available', b.cx, b.cz, n ? 'good' : 'bad');
          this.audio.play('horn');
        }
        this.lastInfoKey = '';
        this.refreshInfo();
      };
    });
  }

  private renderShipInfo(sh: Ship) {
    const g = this.game;
    let body = `<div class="kv"><span>Doing</span><b>${shipDoing(g, sh)}</b></div>`;
    const n = cargoCount(sh);
    body += `<div class="kv"><span>Cargo</span><b>${n ? GOODS.filter((gd) => sh.cargo[gd] > 0).map((gd) => `${this.icon(gd, 'ci')}${sh.cargo[gd]}`).join(' ') : '<span class="muted">empty</span>'}</b></div>`;
    if (sh.passengers.length) {
      const jobs: Record<string, number> = {};
      for (const id of sh.passengers) { const s = g.settlers.get(id); if (s) jobs[JOB_NAMES[s.job]] = (jobs[JOB_NAMES[s.job]] ?? 0) + 1; }
      body += `<div class="kv"><span>Passengers</span><b>${Object.entries(jobs).map(([j, k]) => `${k} ${j.toLowerCase()}${k > 1 ? 's' : ''}`).join(', ')}</b></div>`;
    }
    body += `<div class="kv"><span>Speed</span><b>${sh.speed > 0.1 ? `${(sh.speed * 3.6).toFixed(1)} knots` : 'at rest'}</b></div>`;
    const key = `ship${sh.id}|${body}`;
    if (key === this.lastInfoKey) return;
    this.lastInfoKey = key;
    this.info.innerHTML = `
      <div class="ihead"><div class="avatar" style="background:${hex(PLAYER_COLORS[sh.owner])}">⛵</div><div><h2>${sh.name}</h2><div class="owner">${g.players[sh.owner].name}</div></div><button class="close" data-act="close">✕</button></div>
      <div class="ibody">${body}</div>`;
    this.info.querySelector<HTMLElement>('[data-act=close]')!.onclick = () => this.select(null);
  }

  private renderSettlerInfo(s: Settler) {
    const g = this.game;
    const soldier = s.job === 'swordsman' || s.job === 'bowman';
    const donkey = s.job === 'donkey';
    let body = donkey ? '' : `<div class="kv"><span>Occupation</span><b>${JOB_NAMES[s.job]}</b></div>`;
    if (donkey && (s.carrying || s.pack)) body += `<div class="kv"><span>Carrying</span><b>${[s.carrying, s.pack].filter(Boolean).map((gd) => `${this.icon(gd as Good, 'ci')} ${GOOD_NAMES[gd as Good]}`).join(' · ')}</b></div>`;
    else if (s.carrying) body += `<div class="kv"><span>Carrying</span><b>${this.icon(s.carrying, 'ci')} ${GOOD_NAMES[s.carrying]}</b></div>`;
    if (donkey && s.target) { const m = g.buildings.get(s.target); if (m) body += `<div class="kv"><span>Bound for</span><b>${marketLabel(g, m, s.x, s.z)}</b></div>`; }
    if (s.home && !s.voyage) { const b = g.buildings.get(s.home); if (b) body += `<div class="kv"><span>Workplace</span><b>${b.def.name}</b></div>`; }
    if (s.aboard) { const sh = g.ships.get(s.aboard); if (sh) body += `<div class="kv"><span>Aboard</span><b>⛵ ${sh.name}</b></div>`; }
    if (soldier) {
      body += `<div class="kv"><span>Health</span><b>${Math.max(0, Math.round(s.hp))}/${s.maxHp}</b></div><div class="bar hp"><i style="width:${Math.max(0, (s.hp / s.maxHp) * 100)}%"></i></div>`;
      body += `<div class="kv"><span>Orders</span><b>${{ garrison: 'Guarding', idle: 'Awaiting orders', moving: 'Marching', attack: 'Attacking', defend: 'Defending', fight: 'Fighting', return: 'Returning', ship: 'Travelling by sea', hold: 'Holding position' }[s.sstate]}</b></div>`;
    } else {
      body += `<div class="kv"><span>Doing</span><b>${s.task || (s.idle ? (donkey ? 'Waiting for goods to carry' : 'Idle') : s.anim === 'walk' ? 'Walking' : 'Working')}</b></div>`;
    }
    const recall = s.job === 'pioneer' && s.order >= 0 && s.owner === g.local;
    const key = `s${s.id}|${body}|${recall}`;
    if (key === this.lastInfoKey) return;
    this.lastInfoKey = key;
    this.info.innerHTML = `
      <div class="ihead"><div class="avatar" style="background:${hex(PLAYER_COLORS[s.owner])}">${soldier ? '⚔' : s.job === 'pioneer' ? '⚑' : donkey ? '🐴' : '☺'}</div><div><h2>${JOB_NAMES[s.job]}</h2><div class="owner">${g.players[s.owner].name}</div></div><button class="close" data-act="close">✕</button></div>
      <div class="ibody">${body}</div>${recall ? '<div class="ibtns"><button data-act="recall">↩ Call back</button></div>' : ''}`;
    this.info.querySelector<HTMLElement>('[data-act=close]')!.onclick = () => this.select(null);
    const rb = this.info.querySelector<HTMLElement>('[data-act=recall]');
    if (rb) rb.onclick = () => { this.audio.play('ui'); recallPioneer(g, s); this.lastInfoKey = ''; this.refreshInfo(); };
  }

  // ------------------------------------------------------------ messages / tooltip
  message(text: string, x?: number, z?: number, kind = 'info') {
    const m = h('div', `msg ${kind}`, text);
    if (x !== undefined && z !== undefined) {
      m.classList.add('link');
      m.onclick = () => this.gr.cam.jumpTo(x, z + 2);
    }
    this.msgs.prepend(m);
    while (this.msgs.children.length > 6) this.msgs.lastChild?.remove();
    setTimeout(() => m.classList.add('fade'), 7000);
    setTimeout(() => m.remove(), 8200);
  }

  showTip(e: MouseEvent, html: string) {
    this.tip.innerHTML = html;
    this.tip.classList.remove('hidden');
    this.moveTip(e.clientX, e.clientY);
  }
  moveTip(x: number, y: number) {
    const r = this.tip.getBoundingClientRect();
    let tx = x + 18, ty = y + 14;
    if (tx + r.width > window.innerWidth - 8) tx = x - r.width - 14;
    if (ty + r.height > window.innerHeight - 8) ty = y - r.height - 10;
    this.tip.style.left = tx + 'px';
    this.tip.style.top = ty + 'px';
  }
  hideTip() {
    this.tip.classList.add('hidden');
  }

  onEvent(e: GameEvent) {
    this.objectives.noteEvent(e.type, e.owner);
    if (e.type === 'msg' && e.text) this.message(e.text, e.x, e.z, e.kind);
    if (e.type === 'defeated' && e.text) this.message(e.text, undefined, undefined, e.owner === this.game.local ? 'bad' : 'good');
    if (e.type === 'gameover') this.gameOver(e.owner === this.game.local);
  }

  private gameOver(won: boolean) {
    const g = this.game;
    const ov = h('div', 'overlay');
    const p = g.players[g.local];
    const mm = Math.floor(g.time / 60);
    let produced = 0;
    for (const gd of GOODS) produced += p.produced[gd];
    ov.innerHTML = `<div class="panel dialog">
      <h1>${won ? 'Victory!' : 'Defeat'}</h1>
      <p>${won ? 'All rival kingdoms have fallen. Your settlers celebrate across the land.' : 'Your last stronghold has fallen.'}</p>
      <div class="kv"><span>Time played</span><b>${mm} min</b></div>
      <div class="kv"><span>Goods produced</span><b>${produced}</b></div>
      <div class="kv"><span>Population</span><b>${g.population(g.local).total}</b></div>
      <div class="row"><button class="wide" data-act="cont">Keep watching</button><button class="wide primary" data-act="menu">Main menu</button></div>
    </div>`;
    this.root.appendChild(ov);
    ov.querySelector<HTMLElement>('[data-act=cont]')!.onclick = () => ov.remove();
    ov.querySelector<HTMLElement>('[data-act=menu]')!.onclick = () => this.hooks.restart();
    this.audio.play(won ? 'fanfare' : 'death');
    if (won) for (const s of g.settlers.values()) if (s.owner === g.local && !s.hidden && !s.dead && s.actions.length === 0) { s.anim = 'cheer'; s.animT = 0; }
  }

  // ------------------------------------------------------------ per frame
  update(dt: number) {
    this.frames++;
    this.fpsT += dt;
    this.t -= dt;
    this.infoT -= dt;
    this.minimap.update(dt);
    this.objectives.update(dt);
    if (this.t <= 0) {
      this.t = 0.5;
      this.refreshTop();
      if (this.tab === 'build') {
        // refresh affordability without re-rendering on hover
        const st = this.game.totalStock(this.game.local);
        this.content.querySelectorAll<HTMLElement>('.bcard:not(.geo)').forEach((card, k) => {
          const t = BUILD_ORDER[this.cat][k];
          const d = BUILDINGS[t];
          card.classList.toggle('poor', !(st.board >= d.cost.board && st.stone >= d.cost.stone));
        });
      } else if (this.tab === 'military' || this.tab === 'goods' || this.tab === 'faith') {
        if (!this.content.matches(':hover')) this.renderTab();
      }
    }
    if (this.fpsT >= 1) {
      if (this.fpsEl) this.fpsEl.textContent = `${Math.round(this.frames / this.fpsT)} fps`;
      this.frames = 0;
      this.fpsT = 0;
    }
    if (this.infoT <= 0) {
      this.infoT = 0.25;
      if (!this.info.matches(':hover') || !this.info.querySelector('input[type=range]:active, select:focus')) this.refreshInfo();
    }
  }
}

/** Short description of what a ship is doing, for panels and lists. */
function shipDoing(g: Game, sh: Ship): string {
  const name = (id: number) => { const b = g.buildings.get(id); return b ? b.def.name.toLowerCase() : 'harbour'; };
  switch (sh.state) {
    case 'idle': return sh.at ? `Moored at the ${name(sh.at)}` : 'At anchor';
    case 'toLoad': return 'Sailing to take on cargo';
    case 'loading': return 'Loading';
    case 'toUnload': return 'Sailing with cargo';
    case 'unloading': return 'Unloading';
    case 'expedition': return 'Carrying an expedition';
    case 'scouting': return 'Scouting the seas';
  }
  return '';
}
