// War machines. A siege workshop builds catapults out of boards and iron; they roll out as
// settlers of job `catapult` (machines, not people: never counted as population, drawn by their
// own renderer) and take the same orders as soldiers — march to a spot, storm a stronghold, back
// to duty. A catapult in range of an enemy stronghold lobs a stone every few seconds, standing
// guard or on its own initiative; a stone that lands kills one of the garrison, and on an empty
// stronghold it cracks the walls until, after `def.military.siege` hits, the place burns.
// Catapults outrange tower archers but cannot fight back: soldiers coming out to meet them
// smash them, so they want an escort.
import { CATAPULT_HP, CATAPULT_RANGE, CATAPULT_RELOAD, MAX_CATAPULTS } from './defs';
import type { Game } from './game';
import { kill } from './military';
import { A, plan, turnTo } from './settlers';
import type { Building, Projectile, Settler } from './types';

/** Stones that miss fall this far around the walls. */
const ACCURACY = 0.8;

export function isCatapult(s: Settler) {
  return s.job === 'catapult';
}

export function catapultsOf(g: Game, owner: number): number {
  let n = 0;
  for (const s of g.settlers.values()) if (s.owner === owner && s.job === 'catapult' && !s.dead) n++;
  return n;
}

export function catapultCap(_g: Game, _owner: number): number {
  return MAX_CATAPULTS;
}

/** Stones an empty stronghold takes before it falls. */
export function siegeHits(b: Building): number {
  return b.def.military?.siege ?? 0;
}

/** A free spot in the workshop's yard for a new machine to stand on, so they do not pile up in the doorway. */
function parkingSpot(g: Game, works: Building): number {
  const w = g.world;
  const taken = new Set<number>();
  for (const o of g.settlers.values()) if (o.job === 'catapult' && !o.dead && o.order >= 0) taken.add(o.order);
  let best = -1, bd = Infinity;
  w.forRadius(w.nx(works.door), w.ny(works.door), 4, (i, _x, _y, d2) => {
    if (i === works.door || d2 < 1.5 || d2 >= bd || !w.walkable(i) || w.building[i] || w.reserve[i] || taken.has(i)) return;
    if (w.region[i] !== w.region[works.door] || w.owner[i] !== works.owner) return;
    bd = d2;
    best = i;
  });
  return best;
}

/** A finished catapult rolls out of the workshop and takes up a place in the yard. */
export function spawnCatapult(g: Game, works: Building): Settler {
  const s = g.addSettler(works.owner, 'catapult', works.door);
  s.hp = s.maxHp = CATAPULT_HP;
  s.home = works.id;
  s.wanderT = 0;
  const spot = parkingSpot(g, works);
  if (spot >= 0) { s.sstate = 'hold'; s.order = spot; } else s.sstate = 'idle';
  g.syncPos(s);
  g.emit({ type: 'machine', x: s.x, z: s.z, owner: s.owner });
  g.message(works.owner, catapultsOf(g, works.owner) === 1
    ? 'Your first catapult is ready — select it and right-click an enemy stronghold to bombard it'
    : 'A new catapult has rolled out of the workshop', s.x, s.z, 'good');
  return s;
}

export function inRange(s: Settler, b: Building) {
  return Math.hypot(b.cx - s.x, b.cz - s.z) <= CATAPULT_RANGE;
}

/** The nearest enemy stronghold a catapult standing where it is can reach (water is no obstacle to a stone). */
export function siegeTarget(g: Game, s: Settler): Building | null {
  let best: Building | null = null, bd = CATAPULT_RANGE * CATAPULT_RANGE;
  for (const b of g.buildings.values()) {
    if (b.owner === s.owner || !b.def.military || b.state !== 'done' || !g.players[b.owner]?.alive) continue;
    const d = (b.cx - s.x) ** 2 + (b.cz - s.z) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Where to roll up to bombard `b`: a reachable spot inside range, as far from the walls (and their archers) as the ground allows. */
function approach(g: Game, s: Settler, b: Building): number {
  const w = g.world;
  const r = w.region[s.node];
  let best = -1, bs = Infinity;
  w.forRadius(b.cx, b.cz, CATAPULT_RANGE - 0.6, (i, x, y, d2) => {
    if (d2 < 12 || !w.walkable(i) || w.region[i] !== r || w.reserve[i] || w.building[i]) return;
    const d = Math.sqrt(d2);
    // close to us, but stay out on the rim beyond an archer's reach where the ground allows
    const sc = (x - s.x) ** 2 + (y - s.z) ** 2 + Math.max(0, 9.1 - d) ** 2 * 6;
    if (sc < bs) { bs = sc; best = i; }
  });
  return best;
}

function fireStone(g: Game, s: Settler, b: Building) {
  const w = g.world;
  s.heading = Math.atan2(b.cx - s.x, b.cz - s.z);
  const d = Math.hypot(b.cx - s.x, b.cz - s.z);
  const hit = g.rng.next() < ACCURACY;
  let tx: number, tz: number, ty: number;
  if (hit) {
    tx = b.cx + (g.rng.next() - 0.5) * b.size * 0.7;
    tz = b.cz + (g.rng.next() - 0.5) * b.size * 0.7;
    ty = w.heightAt(b.cx, b.cz) + b.size * 0.55 + 0.6;
  } else {
    // short or wide: on the ground beside the walls
    const a = g.rng.range(0, Math.PI * 2), rr = b.size * 0.5 + 1 + g.rng.next() * 1.5;
    tx = b.cx + Math.cos(a) * rr;
    tz = b.cz + Math.sin(a) * rr;
    ty = w.heightAt(tx, tz) + 0.1;
  }
  g.projectiles.push({
    id: g.id(), owner: s.owner, sx: s.x, sy: w.heightAt(s.x, s.z) + 0.9, sz: s.z, tx, ty, tz,
    t: 0, dur: Math.max(1.3, d * 0.16), target: 0, damage: hit ? 1 : 0, kind: 'stone', building: b.id,
  });
  g.emit({ type: 'catapult', x: s.x, z: s.z, owner: s.owner });
  b.underAttackT = Math.max(b.underAttackT, 12);
  s.task = 'Bombarding';
  plan(s, [A.anim('shoot', 1.0), A.wait(CATAPULT_RELOAD - 1)]);
}

/** The per-tick brain of a catapult that has nothing queued. */
export function catapultThink(g: Game, s: Settler, dt: number) {
  s.idle = false;
  s.task = '';
  // held by a swordsman it cannot answer: it stands there and takes it
  if (s.engaged) { s.path = null; plan(s, [A.wait(0.3)]); return; }
  const w = g.world;
  if (s.sstate !== 'attack' && s.sstate !== 'hold') s.sstate = 'idle';
  if (s.sstate === 'attack') {
    const b = g.buildings.get(s.targetB);
    if (!b || b.state !== 'done' || b.owner === s.owner || !b.def.military) { s.sstate = 'idle'; s.targetB = 0; s.fails = 0; return; }
    if (inRange(s, b)) { s.fails = 0; fireStone(g, s, b); return; }
    const spot = s.fails > 3 ? -1 : approach(g, s, b);
    if (spot < 0) {
      g.message(s.owner, 'The catapult cannot get within range of the enemy ' + b.def.name, s.x, s.z, 'bad');
      s.sstate = 'idle'; s.targetB = 0; s.fails = 0;
      return;
    }
    s.task = 'Rolling up to the enemy ' + b.def.name;
    plan(s, [A.walk(spot)], () => { s.fails++; });
    return;
  }
  if (s.sstate === 'hold' && s.order >= 0 && s.node !== s.order) {
    if (!w.walkable(s.order) || s.fails > 3) { s.order = s.node; s.fails = 0; }
    else { plan(s, [A.walk(s.order)], () => { s.fails++; }); return; }
  }
  s.fails = 0;
  s.pace = 1;
  // standing: shell whatever enemy stronghold is within reach
  const b = siegeTarget(g, s);
  if (b) { fireStone(g, s, b); return; }
  // else it is swung round slowly the way its formation faces
  if (s.sstate === 'hold' && s.face !== null && Math.abs(Math.atan2(Math.sin(s.face - s.heading), Math.cos(s.face - s.heading))) > 0.02) {
    s.heading = turnTo(s.heading, s.face, dt * 1.2);
    return;
  }
  plan(s, [A.wait(1)]);
}

/** A stone comes down. Called when a `stone` projectile reaches the end of its flight. */
export function siegeHit(g: Game, p: Projectile) {
  const b = p.building ? g.buildings.get(p.building) : undefined;
  if (!b || b.state !== 'done' || b.owner === p.owner || p.damage <= 0 || !b.def.military) {
    g.emit({ type: 'stonefall', x: p.tx, z: p.tz });
    return;
  }
  b.underAttackT = Math.max(b.underAttackT, 12);
  g.emit({ type: 'siegehit', b: b.id, x: p.tx, z: p.tz, owner: p.owner });
  if (b.garrison.length) {
    // the stone comes through the roof: one of the garrison falls
    const id = b.garrison[b.garrison.length - 1];
    const v = g.settlers.get(id);
    if (v && !v.dead) {
      kill(g, v);
      g.message(b.owner, `A ${p.by ? 'warship’s' : 'catapult'} stone struck your ${b.def.name} — a soldier was killed`, b.cx, b.cz, 'bad', b.id);
    }
    return;
  }
  b.damage += 1;
  const hits = siegeHits(b);
  const who = p.by ? 'warships' : 'catapults';
  if (b.damage < hits - 1e-6) {
    if (b.damage < 1.5) g.message(b.owner, `${p.by ? 'Warships' : 'Catapults'} are battering your ${b.def.name}!`, b.cx, b.cz, 'bad', b.id);
    return;
  }
  g.message(b.owner, `Your ${b.def.name} was razed by ${who}!`, b.cx, b.cz, 'bad');
  g.message(p.owner, `Our ${who} razed the enemy ${b.def.name}!`, b.cx, b.cz, 'good');
  g.emit({ type: 'razed', b: b.id, x: b.cx, z: b.cz, owner: p.owner });
  g.destroyBuilding(b, true);
}

/** Battered walls mend slowly once the stones stop falling. */
export function mendWalls(b: Building, dt: number) {
  if (b.damage > 0 && b.underAttackT <= 0) b.damage = Math.max(0, b.damage - dt / 45);
}
