// Guided objectives: a light campaign-style chain that teaches the economy.
import { BUILDINGS, BuildingType } from '../game/defs';
import type { Game } from '../game/game';

interface Objective {
  id: string;
  text: string;
  hint: string;
  done: (g: Game) => boolean;
  progress?: (g: Game) => string;
}

const has = (g: Game, t: BuildingType, n = 1) => g.countBuildings(g.local, t, false) >= n;
const hasAny = (g: Game, ts: BuildingType[]) => ts.some((t) => has(g, t));

export const OBJECTIVES: Objective[] = [
  { id: 'wood', text: "Build a Woodcutter's Hut", hint: 'Place it next to a forest — it fells mature trees.', done: (g) => has(g, 'woodcutter') },
  { id: 'saw', text: 'Build a Sawmill', hint: 'Sawmills turn logs into the boards every building needs.', done: (g) => has(g, 'sawmill') },
  { id: 'stone', text: "Build a Stonecutter's Hut", hint: 'Place it close to grey rock outcrops.', done: (g) => has(g, 'stonecutter') },
  { id: 'forest', text: "Build a Forester's Hut", hint: 'Foresters replant so your woodcutters never run dry.', done: (g) => has(g, 'forester') },
  { id: 'tower', text: 'Expand with a Guard Tower', hint: 'Military buildings claim land once a soldier moves in. Build near your border.', done: (g) => { for (const b of g.buildings.values()) if (b.owner === g.local && b.type !== 'hq' && b.def.military && b.occupied) return true; return false; } },
  { id: 'home', text: 'Build a Residence', hint: 'New carriers move into residences over time.', done: (g) => hasAny(g, ['residence_s', 'residence_m', 'residence_l']) },
  { id: 'food', text: 'Produce food: Fisher or Hunter', hint: 'Mines need bread, fish or meat to work.', done: (g) => hasAny(g, ['fisher', 'hunter']) },
  { id: 'bread', text: 'Bake bread', hint: 'Farm → Windmill → Bakery, plus a Waterworks by the water.', done: (g) => has(g, 'farm') && has(g, 'mill') && has(g, 'bakery') && has(g, 'waterworks'),
    progress: (g) => `${['farm', 'mill', 'bakery', 'waterworks'].filter((t) => has(g, t as BuildingType)).length}/4` },
  { id: 'mines', text: 'Open a Coal Mine and an Iron Mine', hint: 'Mines go on mountains. Look for black (coal) and rusty red (iron) specks in the rock.', done: (g) => has(g, 'coalmine') && has(g, 'ironmine'),
    progress: (g) => `${['coalmine', 'ironmine'].filter((t) => has(g, t as BuildingType)).length}/2` },
  { id: 'iron', text: 'Smelt iron and forge weapons', hint: 'Iron Smelter (ore + coal → iron) and a Weaponsmith (iron + coal → swords & bows).', done: (g) => has(g, 'ironsmelter') && has(g, 'weaponsmith'),
    progress: (g) => `${['ironsmelter', 'weaponsmith'].filter((t) => has(g, t as BuildingType)).length}/2` },
  { id: 'army', text: 'Train an army of 12 soldiers', hint: 'Barracks turn a carrier and a weapon into a soldier.', done: (g) => g.population(g.local).soldiers >= 12,
    progress: (g) => `${g.population(g.local).soldiers}/12` },
  { id: 'capture', text: 'Capture an enemy military building', hint: 'Select an enemy tower within reach and press Attack.', done: (g) => (g as any).__captured === true },
  { id: 'win', text: 'Conquer every rival kingdom', hint: 'Destroy or capture all enemy military buildings.', done: (g) => g.over && g.winner === g.local },
];

export class Objectives {
  el: HTMLElement;
  index = 0;
  private t = 0;
  private open = false;
  constructor(private game: Game, parent: HTMLElement, private onComplete: (text: string) => void) {
    this.el = document.createElement('div');
    this.el.className = 'panel objectives';
    parent.appendChild(this.el);
    this.el.onclick = () => { this.open = !this.open; this.render(); };
    this.render();
  }

  noteEvent(type: string, owner?: number) {
    if (type === 'captured' && owner === this.game.local) (this.game as any).__captured = true;
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    let changed = false;
    while (this.index < OBJECTIVES.length && OBJECTIVES[this.index].done(this.game)) {
      this.onComplete(OBJECTIVES[this.index].text);
      this.index++;
      changed = true;
    }
    if (changed || this.open) this.render();
    else this.renderProgress();
  }

  private renderProgress() {
    const o = OBJECTIVES[this.index];
    const p = this.el.querySelector('.prog');
    if (o && o.progress && p) p.textContent = o.progress(this.game);
  }

  render() {
    const o = OBJECTIVES[this.index];
    const pct = Math.round((this.index / OBJECTIVES.length) * 100);
    if (!o) {
      this.el.innerHTML = `<div class="ohead"><span class="crest-s">⚜</span><b>Chronicle complete</b></div>`;
      return;
    }
    const list = this.open
      ? `<ol class="olist">${OBJECTIVES.map((x, i) => `<li class="${i < this.index ? 'done' : i === this.index ? 'cur' : ''}">${x.text}</li>`).join('')}</ol>`
      : '';
    this.el.innerHTML = `
      <div class="ohead"><span class="crest-s">⚜</span><span class="olabel">Chronicle · ${this.index + 1}/${OBJECTIVES.length}</span><span class="ochev">${this.open ? '▴' : '▾'}</span></div>
      <div class="otext">${o.text} <span class="prog">${o.progress ? o.progress(this.game) : ''}</span></div>
      <div class="ohint">${o.hint}</div>
      <div class="obar"><i style="width:${pct}%"></i></div>
      ${list}`;
  }
}

void BUILDINGS;
