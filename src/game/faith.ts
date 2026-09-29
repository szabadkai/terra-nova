// Religion: temples turn wine into mana, priests call down divine spells.
// Beside the four of our own, the book holds six from The Settlers III: the Romans' Magic Eye and Midas
// Touch, the Divine Gift every people's priests know, the Asians' shoals of fish, and from the Amazons'
// book the forest that springs up overnight and the frost that holds an enemy fast.
import type { Game } from './game';
import type { Building, Settler } from './types';
import { GOOD_NAMES, type Good } from './defs';
import { abortPlan } from './settlers';
import { isSoldier, kill } from './military';
import { plantable, treeSpecies } from './work';
import { cos, sin, sq } from '../core/fmath';

export type SpellId = 'eye' | 'fish' | 'forest' | 'harvest' | 'midas' | 'gift' | 'heal' | 'freeze' | 'wrath' | 'convert';

export interface SpellDef {
  id: SpellId;
  name: string;
  cost: number;
  radius: number;
  great: boolean; // needs a Great Temple
  /** the Faith tab's two pages of the book: the land and its plenty, or war */
  school: 'plenty' | 'war';
  glyph: string;
  color: [number, number, number];
  desc: string;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  eye: { id: 'eye', name: 'All-Seeing Eye', cost: 6, radius: 16, great: false, school: 'plenty', glyph: '◉', color: [0.78, 0.6, 1.0],
    desc: 'Lifts the fog from a wide circle up to 30 paces past your strongholds, even where none of yours has been.' },
  fish: { id: 'fish', name: 'Teeming Waters', cost: 10, radius: 8, great: false, school: 'plenty', glyph: '≋', color: [0.35, 0.78, 1.0],
    desc: 'Shoals of fish fill the lakes and shallows in the circle again.' },
  forest: { id: 'forest', name: "Forest's Favour", cost: 10, radius: 7, great: false, school: 'plenty', glyph: '♣', color: [0.45, 0.95, 0.4],
    desc: 'Saplings spring up on the open ground in the circle: timber for you, or a thicket where a rival meant to build.' },
  harvest: { id: 'harvest', name: 'Blessed Harvest', cost: 15, radius: 6, great: false, school: 'plenty', glyph: '❦', color: [1.0, 0.82, 0.3],
    desc: 'Every tree, vine and field in the circle ripens at once.' },
  midas: { id: 'midas', name: 'Midas Touch', cost: 15, radius: 6, great: false, school: 'plenty', glyph: '☉', color: [1.0, 0.68, 0.12],
    desc: 'Up to forty iron bars in the storehouses in the circle turn to gold.' },
  gift: { id: 'gift', name: 'Gift of the Gods', cost: 30, radius: 4, great: false, school: 'plenty', glyph: '✧', color: [1.0, 0.62, 0.78],
    desc: 'Materials, food and ore of eight kinds, one or two of each, appear in the storehouse you call it over.' },
  heal: { id: 'heal', name: 'Healing Light', cost: 20, radius: 6, great: false, school: 'war', glyph: '✚', color: [1.0, 0.95, 0.7],
    desc: 'Heals your soldiers, thaws any the frost holds, and blesses them: they fight 40% harder for a minute.' },
  freeze: { id: 'freeze', name: "Winter's Grasp", cost: 30, radius: 6, great: true, school: 'war', glyph: '❄', color: [0.62, 0.88, 1.0],
    desc: 'Enemy soldiers in the circle freeze where they stand for 15 seconds: they can neither march nor strike, but they can be struck.' },
  wrath: { id: 'wrath', name: 'Wrath of the Heavens', cost: 50, radius: 5.5, great: true, school: 'war', glyph: 'ϟ', color: [0.4, 0.62, 1.0],
    desc: 'A storm gathers and lightning strikes the enemy soldiers below.' },
  convert: { id: 'convert', name: 'Conversion', cost: 60, radius: 5, great: true, school: 'war', glyph: '☼', color: [0.5, 1.0, 0.9],
    desc: 'Up to three enemy soldiers see the light and join your side.' },
};

export const SPELL_ORDER: SpellId[] = ['eye', 'fish', 'forest', 'harvest', 'midas', 'gift', 'heal', 'freeze', 'wrath', 'convert'];
export const MANA_MAX = 150;
const CHANNEL = 1.3; // seconds between the call and the effect
const BLESS_TIME = 60;
export const FREEZE_TIME = 15;
const FREEZE_MAX = 25; // soldiers one frost can hold
/** how far past a stronghold's border the Eye can be cast (every other spell: 7) */
const EYE_REACH = 30;
const MIDAS_MAX = 40;
const FISH_CAP = 12;
/** what the gods may send: materials, food and ore - what the craftsmen make of them is left to the craftsmen */
const GIFTS: Good[] = ['log', 'board', 'stone', 'grain', 'flour', 'bread', 'fish', 'meat', 'water', 'coal', 'ironore', 'goldore'];

interface Pending { at: number; kind: SpellId | 'strike'; owner: number; x: number; z: number; }

function temples(g: Game, owner: number): Building[] {
  const out: Building[] = [];
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || b.state !== 'done' || !b.def.mana) continue;
    out.push(b);
  }
  return out;
}

function priestPresent(g: Game, b: Building) {
  const s = b.worker ? g.settlers.get(b.worker) : null;
  return !!s && s.inside === b.id;
}

export function faithStatus(g: Game, owner: number) {
  let temple = 0, great = false, priests = 0;
  for (const b of temples(g, owner)) {
    temple++;
    const has = priestPresent(g, b);
    if (has) priests++;
    if (b.type === 'greattemple' && has) great = true;
  }
  return { temples: temple, priests, great };
}

function enemySoldiersNear(g: Game, owner: number, x: number, z: number, r: number): Settler[] {
  const out: Settler[] = [];
  for (const s of g.settlers.values()) {
    if (s.owner === owner || !isSoldier(s) || s.dead || s.hidden) continue;
    if (sq(s.x - x) + sq(s.z - z) <= r * r) out.push(s);
  }
  return out;
}

/** Spells reach as far as your military buildings see (the Eye further). */
function inReach(g: Game, owner: number, x: number, z: number, extra = 7) {
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || !b.def.military || b.state !== 'done' || !b.occupied) continue;
    const r = b.def.military.radius + extra;
    if (sq(b.cx - x) + sq(b.cz - z) <= r * r) return true;
  }
  return false;
}

/** Returns null when the spell can be cast there, otherwise the reason it can't. */
export function castError(g: Game, owner: number, id: SpellId, x: number, z: number): string | null {
  const def = SPELLS[id];
  const p = g.players[owner];
  const st = faithStatus(g, owner);
  if (!st.temples) return 'Build a Temple first';
  if (!st.priests) return 'No priest is serving in your temples';
  if (def.great && !st.great) return `${def.name} needs a Great Temple with a priest`;
  if (p.mana < def.cost) return `Not enough mana (${Math.floor(p.mana)}/${def.cost})`;
  if (p.spellCd > 0) return 'The priests are still recovering';
  const w = g.world;
  const xi = Math.round(x), zi = Math.round(z);
  if (!w.inBounds(xi, zi)) return 'Out of bounds';
  // the Eye is for looking into the dark
  if (id !== 'eye' && !p.ai && !((w.seen[w.idx(xi, zi)] >> owner) & 1)) return 'You cannot see that place';
  if (!inReach(g, owner, x, z, id === 'eye' ? EYE_REACH : 7)) return 'Too far from your strongholds';
  if ((id === 'wrath' || id === 'convert' || id === 'freeze') && !enemySoldiersNear(g, owner, x, z, def.radius).length) return 'No enemy soldiers there';
  if (id === 'gift' && !giftStore(g, owner, x, z)) return 'Call it over one of your storehouses';
  if (id === 'midas') {
    if (!storesIn(g, owner, x, z, def.radius).length) return 'No storehouse of yours in the circle';
    if (!storesIn(g, owner, x, z, def.radius).some((b) => b.stock.iron - b.outgoing.iron > 0)) return 'No iron in store there';
  }
  if (id === 'fish' && !anyNode(g, x, z, def.radius, (i) => w.isWater(i) && w.fish[i] < FISH_CAP)) return 'No water there to fill';
  if (id === 'forest' && !anyNode(g, x, z, def.radius, (i) => plantable(g, i, true))) return 'No open ground there';
  return null;
}

function anyNode(g: Game, x: number, z: number, r: number, ok: (i: number) => boolean) {
  let found = false;
  g.world.forRadius(x, z, r, (i) => { if (!found && ok(i)) found = true; });
  return found;
}

/** A player's finished storehouses (the headquarters and harbours too) standing in a circle. */
function storesIn(g: Game, owner: number, x: number, z: number, r: number): Building[] {
  const out: Building[] = [];
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || !b.def.storage || b.state !== 'done') continue;
    const rr = r + b.size / 2;
    if (sq(b.cx - x) + sq(b.cz - z) <= rr * rr) out.push(b);
  }
  return out;
}

/** The storehouse a Gift lands in: the one of the caster's nearest the spot, under the circle. */
function giftStore(g: Game, owner: number, x: number, z: number): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of storesIn(g, owner, x, z, SPELLS.gift.radius)) {
    const d = sq(b.cx - x) + sq(b.cz - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Is s held fast by a frost? */
export function frozen(g: Game, s: Settler) {
  return g.time < s.frozenUntil;
}

export function castSpell(g: Game, owner: number, id: SpellId, x: number, z: number): boolean {
  if (castError(g, owner, id, x, z)) return false;
  const def = SPELLS[id];
  const p = g.players[owner];
  p.mana -= def.cost;
  p.spellCd = 4;
  p.spellsCast++;
  // the nearest temple with a priest sends a beam to the heavens
  let src: Building | null = null, bd = Infinity;
  for (const b of temples(g, owner)) {
    if (!priestPresent(g, b)) continue;
    const d = sq(b.cx - x) + sq(b.cz - z) + (b.type === 'greattemple' ? 0 : def.great ? 1e9 : 0);
    if (d < bd) { bd = d; src = b; }
  }
  g.emit({ type: 'spell', kind: id, x, z, owner, b: src?.id });
  pending(g).push({ at: g.time + CHANNEL, kind: id, owner, x, z });
  if (id === 'wrath') {
    for (let k = 0; k < 6; k++) pending(g).push({ at: g.time + CHANNEL + 0.25 + k * 0.32 + g.rng.next() * 0.2, kind: 'strike', owner, x, z });
  }
  g.message(owner, `Your priests call upon ${def.name}`, x, z, 'good');
  const w = g.world;
  const victim = w.owner[w.idx(Math.round(x), Math.round(z))];
  if (def.great && victim >= 0 && victim !== owner) g.message(victim, 'The sky darkens over your lands…', x, z, 'bad');
  return true;
}

function pending(g: Game): Pending[] {
  const a = g as any;
  return (a.__spells ??= []);
}

export function updateFaith(g: Game, dt: number) {
  for (const p of g.players) if (p.spellCd > 0) p.spellCd -= dt;
  const list = pending(g);
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (g.time < e.at) continue;
    list.splice(i, 1);
    apply(g, e);
  }
}

function apply(g: Game, e: Pending) {
  const w = g.world;
  switch (e.kind) {
    case 'harvest': {
      const r = SPELLS.harvest.radius;
      w.forRadius(e.x, e.z, r, (i) => {
        const tid = w.tree[i];
        if (tid) {
          const t = g.trees.get(tid);
          if (t && t.state === 'grow') { t.growth = 1; t.state = 'mature'; g.treesVersion++; }
        }
        const fid = w.field[i];
        if (fid) {
          const f = g.fields.get(fid);
          if (f && f.owner === e.owner && f.growth < 1) { f.growth = 1; g.fieldsVersion++; }
        }
      });
      g.emit({ type: 'spellfx', kind: 'harvest', x: e.x, z: e.z, owner: e.owner });
      break;
    }
    case 'heal': {
      const r = SPELLS.heal.radius;
      for (const s of g.settlers.values()) {
        if (s.owner !== e.owner || !isSoldier(s) || s.dead) continue;
        if (sq(s.x - e.x) + sq(s.z - e.z) > r * r) continue;
        s.hp = s.maxHp;
        s.blessUntil = g.time + BLESS_TIME;
        if (frozen(g, s)) { s.frozenUntil = 0; g.emit({ type: 'thawed', x: s.x, z: s.z, s: s.id, owner: s.owner }); }
        if (!s.hidden) g.emit({ type: 'healed', x: s.x, z: s.z, s: s.id, owner: s.owner });
      }
      g.emit({ type: 'spellfx', kind: 'heal', x: e.x, z: e.z, owner: e.owner });
      break;
    }
    case 'strike': {
      const r = SPELLS.wrath.radius;
      const foes = enemySoldiersNear(g, e.owner, e.x, e.z, r);
      let tx: number, tz: number;
      if (foes.length) {
        const f = foes[g.rng.int(0, foes.length)];
        tx = f.x; tz = f.z;
      } else {
        const a = g.rng.range(0, Math.PI * 2), d = Math.sqrt(g.rng.next()) * r;
        tx = e.x + cos(a) * d; tz = e.z + sin(a) * d;
      }
      for (const s of enemySoldiersNear(g, e.owner, tx, tz, 1.1)) {
        s.hp -= 60;
        g.emit({ type: 'hit', x: s.x, z: s.z, s: s.id });
        if (s.hp <= 0) kill(g, s);
      }
      // scorched earth
      const si = w.idx(Math.round(tx), Math.round(tz));
      if (w.inBounds(Math.round(tx), Math.round(tz))) w.wear[si] = Math.max(w.wear[si], 0.75);
      g.emit({ type: 'lightning', x: tx, z: tz, owner: e.owner });
      break;
    }
    case 'wrath':
      g.emit({ type: 'spellfx', kind: 'wrath', x: e.x, z: e.z, owner: e.owner });
      break;
    case 'convert': {
      const foes = enemySoldiersNear(g, e.owner, e.x, e.z, SPELLS.convert.radius)
        .sort((a, b) => (sq(a.x - e.x) + sq(a.z - e.z)) - (sq(b.x - e.x) + sq(b.z - e.z)))
        .slice(0, 3);
      for (const s of foes) {
        const prev = s.owner;
        abortPlan(g, s);
        for (const o of g.settlers.values()) if (o.engaged === s.id) o.engaged = 0;
        for (const b of g.buildings.values()) if (b.garrison.includes(s.id)) b.garrison = b.garrison.filter((id) => id !== s.id);
        s.owner = e.owner;
        s.engaged = 0;
        s.frozenUntil = 0;
        s.sstate = 'idle';
        s.home = 0;
        s.targetB = 0;
        s.target = 0;
        s.hp = s.maxHp;
        g.emit({ type: 'converted', x: s.x, z: s.z, s: s.id, owner: e.owner });
        g.message(prev, 'Some of your soldiers have deserted to the enemy!', s.x, s.z, 'bad');
      }
      g.emit({ type: 'spellfx', kind: 'convert', x: e.x, z: e.z, owner: e.owner });
      break;
    }
    case 'eye': {
      const bit = 1 << e.owner;
      const local = e.owner === g.local;
      w.forRadius(e.x, e.z, SPELLS.eye.radius, (i) => {
        w.seen[i] |= bit;
        if (local && !w.explored[i]) { w.explored[i] = 1; w.exploredDirty = true; }
      });
      g.emit({ type: 'spellfx', kind: 'eye', x: e.x, z: e.z, owner: e.owner });
      break;
    }
    case 'gift': {
      const b = giftStore(g, e.owner, e.x, e.z);
      if (!b) break; // the storehouse burnt down while the priests prayed
      const kinds = g.rng.shuffle([...GIFTS]).slice(0, 8);
      const got: string[] = [];
      for (const gd of kinds) {
        const n = g.rng.int(1, 3);
        b.stock[gd] += n;
        got.push(`${n} ${GOOD_NAMES[gd]}`);
      }
      g.emit({ type: 'spellfx', kind: 'gift', x: b.cx, z: b.cz, b: b.id, owner: e.owner });
      g.message(e.owner, `The gods send ${got.join(', ')}`, b.cx, b.cz, 'good', b.id);
      break;
    }
    case 'fish': {
      w.forRadius(e.x, e.z, SPELLS.fish.radius, (i) => {
        if (w.isWater(i)) w.fish[i] = Math.min(FISH_CAP, w.fish[i] + g.rng.int(1, 5));
      });
      g.emit({ type: 'spellfx', kind: 'fish', x: e.x, z: e.z, owner: e.owner });
      break;
    }
    case 'forest': {
      // row by row, so each sapling keeps the next from standing right beside it
      let n = 0;
      w.forRadius(e.x, e.z, SPELLS.forest.radius, (i) => {
        if (!plantable(g, i, true) || g.rng.chance(0.25)) return;
        g.addTree(i, treeSpecies(g, i), g.rng.range(0.05, 0.3));
        n++;
      });
      g.emit({ type: 'spellfx', kind: 'forest', x: e.x, z: e.z, owner: e.owner, n });
      break;
    }
    case 'midas': {
      let left = MIDAS_MAX, n = 0;
      for (const b of storesIn(g, e.owner, e.x, e.z, SPELLS.midas.radius)) {
        const k = Math.min(left, b.stock.iron - b.outgoing.iron);
        if (k <= 0) continue;
        b.stock.iron -= k;
        b.stock.gold += k;
        left -= k;
        n += k;
        g.emit({ type: 'transmuted', x: b.cx, z: b.cz, b: b.id, owner: e.owner, n: k });
        if (!left) break;
      }
      g.emit({ type: 'spellfx', kind: 'midas', x: e.x, z: e.z, owner: e.owner, n });
      if (n) g.message(e.owner, `${n} iron bar${n > 1 ? 's' : ''} turned to gold`, e.x, e.z, 'good');
      break;
    }
    case 'freeze': {
      const foes = enemySoldiersNear(g, e.owner, e.x, e.z, SPELLS.freeze.radius)
        .sort((a, b) => (sq(a.x - e.x) + sq(a.z - e.z)) - (sq(b.x - e.x) + sq(b.z - e.z)))
        .slice(0, FREEZE_MAX);
      const hit = new Set<number>();
      for (const s of foes) {
        s.frozenUntil = g.time + FREEZE_TIME;
        s.anim = s.anim === 'walk' ? 'idle' : s.anim;
        hit.add(s.owner);
        g.emit({ type: 'frozen', x: s.x, z: s.z, s: s.id, owner: s.owner });
      }
      for (const o of hit) g.message(o, 'A bitter frost has seized your soldiers!', e.x, e.z, 'bad');
      g.emit({ type: 'spellfx', kind: 'freeze', x: e.x, z: e.z, owner: e.owner, n: foes.length });
      break;
    }
  }
}

/** Offering at a temple: called when a production cycle completes. */
export function offer(g: Game, b: Building) {
  const p = g.players[b.owner];
  p.mana = Math.min(MANA_MAX, p.mana + (b.def.mana ?? 0));
  g.emit({ type: 'offering', b: b.id, x: b.cx, z: b.cz, owner: b.owner });
}
