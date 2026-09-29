// Guided objectives: the free-play "Chronicle", a light chain that teaches the economy, and the panel
// that shows it — or a campaign mission's goals (missions.ts), which come with a "Show me".
import { BuildingType } from '../game/defs';
import type { Game } from '../game/game';
import type { FocusSpec, Goal } from '../game/campaign';

const has = (g: Game, t: BuildingType, n = 1) => g.countBuildings(g.local, t, false) >= n;
const hasAny = (g: Game, ts: BuildingType[]) => ts.some((t) => has(g, t));

export const OBJECTIVES: Goal[] = [
  { id: 'wood', text: "Build a Woodcutter's Hut", hint: 'Place it next to a forest — it fells mature trees.', done: (g) => has(g, 'woodcutter') },
  { id: 'saw', text: 'Build a Sawmill', hint: 'Sawmills turn logs into the boards every building needs.', done: (g) => has(g, 'sawmill') },
  { id: 'stone', text: "Build a Stonecutter's Hut", hint: 'Place it close to grey rock outcrops.', done: (g) => has(g, 'stonecutter') },
  { id: 'forest', text: "Build a Forester's Hut", hint: 'Foresters replant so your woodcutters never run dry.', done: (g) => has(g, 'forester') },
  { id: 'tower', text: 'Expand with a Guard Tower', hint: 'Military buildings claim land once a soldier moves in. Build near your border.', done: (g) => { for (const b of g.buildings.values()) if (b.owner === g.local && b.type !== 'hq' && b.def.military && b.occupied) return true; return false; } },
  { id: 'home', text: 'Build a Residence', hint: 'New carriers move into residences over time.', done: (g) => hasAny(g, ['residence_s', 'residence_m', 'residence_l']) },
  { id: 'food', text: 'Produce food: Fisher or Hunter', hint: 'Mines need bread, fish or meat to work.', done: (g) => hasAny(g, ['fisher', 'hunter']) },
  { id: 'bread', text: 'Bake bread', hint: 'Farm → Windmill → Bakery, plus a Waterworks by the water.', done: (g) => has(g, 'farm') && has(g, 'mill') && has(g, 'bakery') && has(g, 'waterworks'),
    progress: (g) => `${['farm', 'mill', 'bakery', 'waterworks'].filter((t) => has(g, t as BuildingType)).length}/4` },
  { id: 'geo', text: 'Prospect the mountains', hint: 'Pick the Geologist in the Industry tab and click a mountain inside your borders. His signs show what lies beneath.',
    done: (g) => { for (const s of g.signs.values()) if (s.owner === g.local) return true; return g.countBuildings(g.local, 'coalmine') + g.countBuildings(g.local, 'ironmine') > 0; } },
  { id: 'mines', text: 'Open a Coal Mine and an Iron Mine', hint: 'Mines go on mountains where your geologist found ore: black lumps (and specks in the rock) for coal, rust red for iron. Mine markers glow green over rich veins.', done: (g) => has(g, 'coalmine') && has(g, 'ironmine'),
    progress: (g) => `${['coalmine', 'ironmine'].filter((t) => has(g, t as BuildingType)).length}/2` },
  { id: 'iron', text: 'Smelt iron and forge weapons', hint: 'Iron Smelter (ore + coal → iron) and a Weaponsmith (iron + coal → swords & bows).', done: (g) => has(g, 'ironsmelter') && has(g, 'weaponsmith'),
    progress: (g) => `${['ironsmelter', 'weaponsmith'].filter((t) => has(g, t as BuildingType)).length}/2` },
  { id: 'army', text: 'Train an army of 12 soldiers', hint: 'Barracks turn a carrier and a weapon into a soldier.', done: (g) => g.population(g.local).soldiers >= 12,
    progress: (g) => `${g.population(g.local).soldiers}/12` },
  { id: 'siege', text: 'Build a catapult', hint: 'A Siege Workshop (Military tab) turns boards and iron into catapults. Select one and right-click an enemy stronghold: its stones kill the garrison and bring an empty stronghold down. Send soldiers along — a catapult cannot defend itself.',
    done: (g) => { for (const b of g.buildings.values()) if (b.owner === g.local && b.type === 'siegeworks' && b.prodCount > 0) return true; return false; },
    progress: (g) => `${[has(g, 'siegeworks'), [...g.buildings.values()].some((b) => b.owner === g.local && b.type === 'siegeworks' && b.prodCount > 0)].filter(Boolean).length}/2` },
  { id: 'faith', text: 'Win the favour of the gods', hint: 'Build a Vineyard and a Temple. The priest offers wine as mana — then cast a spell from the ✦ Faith tab.',
    done: (g) => g.players[g.local].spellsCast > 0,
    progress: (g) => `${[has(g, 'vineyard'), hasAny(g, ['temple', 'greattemple']), g.players[g.local].spellsCast > 0].filter(Boolean).length}/3` },
  { id: 'trade', text: 'Open a trade route', hint: 'Build a Donkey Ranch and two Market Places. In one market choose the other as destination and click + on the goods to send; carriers stock them and donkeys carry them over.',
    done: (g) => g.players[g.local].traded > 0,
    progress: (g) => `${[has(g, 'donkeyfarm'), has(g, 'market'), has(g, 'market', 2), g.players[g.local].traded > 0].filter(Boolean).length}/4` },
  { id: 'sea', text: 'Take to the sea', hint: 'Build a Harbour and a Shipyard on the coast. Ships carry goods to your other harbours — and a harbour can send an expedition to found a colony on an island.',
    done: (g) => has(g, 'harbour') && [...g.ships.values()].some((s) => s.owner === g.local),
    progress: (g) => `${[has(g, 'harbour'), has(g, 'shipyard'), [...g.ships.values()].some((s) => s.owner === g.local)].filter(Boolean).length}/3` },
  { id: 'navy', text: 'Launch a warship', hint: 'Select your Shipyard and set it to build a Warship: boards, and iron for the fittings. Select the warship and right-click an enemy ship to hunt it, or a stronghold by the water to bombard it.',
    done: (g) => (g as any).__warship === true || [...g.ships.values()].some((s) => s.owner === g.local && s.kind === 'war'),
    progress: (g) => `${[[...g.buildings.values()].some((b) => b.owner === g.local && b.type === 'shipyard' && b.shipKind === 'war'), [...g.ships.values()].some((s) => s.owner === g.local && s.kind === 'war')].filter(Boolean).length}/2` },
  { id: 'capture', text: 'Capture an enemy military building', hint: 'Select an enemy tower within reach and press Attack.', done: (g) => (g as any).__captured === true },
  { id: 'win', text: 'Conquer every rival kingdom', hint: 'Destroy or capture all enemy military buildings.', done: (g) => g.over && g.winner === g.local },
];

export class Objectives {
  el: HTMLElement;
  /** how many goals, in order, have been announced as done (saved with the view, so a reload does not repeat them) */
  index = 0;
  private t = 0;
  private open = false;
  /** the panel is put away entirely (the top bar's scroll button brings it back); remembered between games */
  hidden = false;
  /**
   * `goals`: the chain to follow (a mission puts its optional goals last: they never hold it up).
   * `onFocus`: what "Show me" does; without it no button is shown. `label`: the panel's heading.
   */
  constructor(private game: Game, parent: HTMLElement, readonly goals: Goal[], private onComplete: (goal: Goal) => void,
    private onFocus?: (f: FocusSpec) => void, readonly label = 'Chronicle') {
    this.el = document.createElement('div');
    this.el.className = 'panel objectives';
    parent.appendChild(this.el);
    this.el.onclick = () => { this.open = !this.open; this.render(); };
    try { this.hidden = localStorage.getItem(this.key) === '1'; } catch { /* private window: shown */ }
    this.el.classList.toggle('hidden', this.hidden);
    this.render();
  }

  private get key() {
    return `terra-nova.hide-${this.goals === OBJECTIVES ? 'chronicle' : 'mission'}`;
  }

  setHidden(v: boolean) {
    this.hidden = v;
    this.el.classList.toggle('hidden', v);
    try { localStorage.setItem(this.key, v ? '1' : '0'); } catch { /* not remembered */ }
  }

  /** The goal the panel points at, if any is left. */
  get current(): Goal | undefined {
    return this.goals[this.index];
  }

  /** Every goal a mission needs is done (the optional ones may still be open). */
  get required() {
    return this.goals.filter((o) => !o.optional).length;
  }

  noteEvent(type: string, owner?: number) {
    // free play only: a mission reads the game's own tally (campaign.ts)
    if (this.game.mission) return;
    if (type === 'captured' && owner === this.game.local) (this.game as any).__captured = true;
    if (type === 'warship' && owner === this.game.local) (this.game as any).__warship = true;
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    if (this.index > this.goals.length) this.index = this.goals.length;
    let changed = false;
    while (this.index < this.goals.length && this.goals[this.index].done(this.game)) {
      this.onComplete(this.goals[this.index]);
      this.index++;
      changed = true;
    }
    if (changed || this.open) this.render();
    else this.renderProgress();
  }

  private renderProgress() {
    const o = this.goals[this.index];
    const p = this.el.querySelector('.prog');
    if (o && o.progress && p) p.textContent = o.progress(this.game);
  }

  private wireClose() {
    const x = this.el.querySelector<HTMLElement>('.oclose');
    if (x) x.onclick = (e) => { e.stopPropagation(); this.setHidden(true); this.onToggle?.(); };
  }

  /** called when the panel is hidden or shown from inside it, so the top bar's button can follow */
  onToggle?: () => void;

  render() {
    const o = this.goals[this.index];
    const required = this.required;
    const doneReq = Math.min(required, this.index);
    const pct = Math.round((doneReq / Math.max(1, required)) * 100);
    const head = (text: string) => `<div class="ohead"><span class="crest-s">⚜</span><span class="olabel">${text}</span><span class="ochev">${this.open ? '▴' : '▾'}</span><button class="oclose" type="button" title="Hide (the ${this.label.startsWith('Mission') ? 'goals' : 'chronicle'} button in the top bar brings it back)" aria-label="Hide">✕</button></div>`;
    const list = this.open
      ? `<ol class="olist">${this.goals.map((x, i) => `<li class="${i < this.index ? 'done' : i === this.index ? 'cur' : ''}${x.optional ? ' opt' : ''}">${x.text}${x.optional ? ' <small>(optional)</small>' : ''}</li>`).join('')}</ol>`
      : '';
    if (!o) {
      this.el.innerHTML = `${head(`${this.label} complete`)}${list}`;
      this.wireClose();
      return;
    }
    const show = o.focus && this.onFocus ? '<button class="oshow" type="button">Show me</button>' : '';
    const done = o.optional;
    this.el.innerHTML = `
      ${head(done ? `${this.label} complete` : `${this.label} · ${this.index + 1}/${required}`)}
      <div class="otext">${done ? '<span class="muted">Optional:</span> ' : ''}${o.text} <span class="prog">${o.progress ? o.progress(this.game) : ''}</span></div>
      <div class="ohint">${o.hint}</div>${show}
      <div class="obar"><i style="width:${pct}%"></i></div>
      ${list}`;
    this.wireClose();
    const btn = this.el.querySelector<HTMLElement>('.oshow');
    if (btn) btn.onclick = (e) => { e.stopPropagation(); this.onFocus?.(o.focus!); };
  }
}
