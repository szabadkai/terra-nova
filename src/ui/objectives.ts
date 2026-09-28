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
  { id: 'geo', text: 'Prospect the mountains', hint: 'Pick the Geologist in the Industry tab and click a mountain inside your borders. His signs show what lies beneath.',
    done: (g) => { for (const s of g.signs.values()) if (s.owner === g.local) return true; return g.countBuildings(g.local, 'coalmine') + g.countBuildings(g.local, 'ironmine') > 0; } },
  { id: 'mines', text: 'Open a Coal Mine and an Iron Mine', hint: 'Mines go on mountains where your geologist found ore: black lumps (and specks in the rock) for coal, rust red for iron. Mine markers glow green over rich veins.', done: (g) => has(g, 'coalmine') && has(g, 'ironmine'),
    progress: (g) => `${['coalmine', 'ironmine'].filter((t) => has(g, t as BuildingType)).length}/2` },
  { id: 'iron', text: 'Smelt iron and forge weapons', hint: 'Iron Smelter (ore + coal → iron) and a Weaponsmith (iron + coal → swords & bows).', done: (g) => has(g, 'ironsmelter') && has(g, 'weaponsmith'),
    progress: (g) => `${['ironsmelter', 'weaponsmith'].filter((t) => has(g, t as BuildingType)).length}/2` },
  { id: 'army', text: 'Train an army of 12 soldiers', hint: 'Barracks turn a carrier and a weapon into a soldier.', done: (g) => g.population(g.local).soldiers >= 12,
    progress: (g) => `${g.population(g.local).soldiers}/12` },
  { id: 'faith', text: 'Win the favour of the gods', hint: 'Build a Vineyard and a Temple. The priest offers wine as mana — then cast a spell from the ✦ Faith tab.',
    done: (g) => g.players[g.local].spellsCast > 0,
    progress: (g) => `${[has(g, 'vineyard'), hasAny(g, ['temple', 'greattemple']), g.players[g.local].spellsCast > 0].filter(Boolean).length}/3` },
  { id: 'trade', text: 'Open a trade route', hint: 'Build a Donkey Ranch and two Market Places. In one market choose the other as destination and click + on the goods to send; carriers stock them and donkeys carry them over.',
    done: (g) => g.players[g.local].traded > 0,
    progress: (g) => `${[has(g, 'donkeyfarm'), has(g, 'market'), has(g, 'market', 2), g.players[g.local].traded > 0].filter(Boolean).length}/4` },
  { id: 'sea', text: 'Take to the sea', hint: 'Build a Harbour and a Shipyard on the coast. Ships carry goods to your other harbours — and a harbour can send an expedition to found a colony on an island.',
    done: (g) => has(g, 'harbour') && [...g.ships.values()].some((s) => s.owner === g.local),
    progress: (g) => `${[has(g, 'harbour'), has(g, 'shipyard'), [...g.ships.values()].some((s) => s.owner === g.local)].filter(Boolean).length}/3` },
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
