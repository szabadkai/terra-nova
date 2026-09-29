// Naval warfare. A shipyard set to build warships turns boards and iron into war galleys with a
// catapult on the foredeck. A warship stands guard where it is told to: it goes for enemy ships
// that come near its post, shells any enemy stronghold within reach of the water and answers orders
// — sail there, hunt that ship, bombard that stronghold, back to the harbour. Stones that land hole
// a hull; a ship with no timbers left sinks, taking its cargo and everyone aboard with it. Tower and
// harbour archers shoot at enemy ships that pass close, and a ship out of the fighting mends slowly
// (quickly, moored at one of its harbours).
import {
  MAX_WARSHIPS, SHIP_HP, SHIP_STONE_DAMAGE, WARSHIP_HP, WARSHIP_RANGE, WARSHIP_RELOAD, WARSHIP_SIGHT, emptyStock,
} from './defs';
import type { Game } from './game';
import type { Building, Projectile, Ship, ShipKind } from './types';
import { kill } from './military';
import { WATER_LEVEL } from './world';
import { berthPos, nearestHarbourBySea, nearestNavigable, sailTo, shipDeckY } from './sea';
import { atan2, cos, hypot, sin, sq } from '../core/fmath';

/** A guard lets a foe go once the chase would lead this far from its post. */
export const SHIP_LEASH = 18;
/** Seconds a ship takes to go under. */
export const SINK_TIME = 7;
/** Tower archers reach this far out over the water. */
export const ARCHER_REACH = 9;
const ARROW_DAMAGE = 3;

export const isWarship = (sh: Ship) => sh.kind === 'war';
export const afloat = (sh: Ship) => sh.state !== 'sinking';

/** Combat fields of a new ship (and the defaults for ships from saves made before there were warships). */
export function shipFields(kind: ShipKind) {
  const hp = kind === 'war' ? WARSHIP_HP : SHIP_HP;
  return { kind, hp, maxHp: hp, target: 0, postX: -1, postZ: -1, reload: 0, fired: -99, aim: 0, hitT: -99, sinkT: 0, scanT: 0, routeT: 0 };
}

export function warshipsOf(g: Game, owner: number): number {
  let n = 0;
  for (const sh of g.ships.values()) if (sh.owner === owner && sh.kind === 'war' && afloat(sh)) n++;
  return n;
}

export function tradeShipsOf(g: Game, owner: number): number {
  let n = 0;
  for (const sh of g.ships.values()) if (sh.owner === owner && sh.kind !== 'war' && afloat(sh)) n++;
  return n;
}

export const warshipCap = () => MAX_WARSHIPS;

/** The body of water a ship is on. */
export function seaOf(g: Game, sh: Ship): number {
  const i = nearestNavigable(g, sh.x, sh.z);
  return i >= 0 ? g.world.sea[i] : 0;
}

function hostile(g: Game, a: number, b: number) {
  return a !== b && !!g.players[b]?.alive;
}

/** The nearest afloat enemy ship on the same water within `r` of (x, z); warships first when both are near. */
export function enemyShipNear(g: Game, sh: Ship, x: number, z: number, r: number, sea = seaOf(g, sh)): Ship | null {
  let best: Ship | null = null, bs = Infinity;
  for (const o of g.ships.values()) {
    if (!afloat(o) || !hostile(g, sh.owner, o.owner)) continue;
    const d2 = sq(o.x - x) + sq(o.z - z);
    if (d2 > r * r) continue;
    if (seaOf(g, o) !== sea) continue;
    const sc = d2 - (o.kind === 'war' ? 25 : 0);
    if (sc < bs) { bs = sc; best = o; }
  }
  return best;
}

/** The nearest enemy stronghold a stone from this ship can reach. */
export function strongholdInReach(g: Game, sh: Ship): Building | null {
  let best: Building | null = null, bd = WARSHIP_RANGE * WARSHIP_RANGE;
  for (const b of g.buildings.values()) {
    if (!b.def.military || b.state !== 'done' || !hostile(g, sh.owner, b.owner)) continue;
    const d = sq(b.cx - sh.x) + sq(b.cz - sh.z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Open water within reach of `b` for a ship on `sea`: close to the ship, beyond the archers' reach where the coast allows. */
export function bombardSpot(g: Game, sh: Ship, b: Building, sea = seaOf(g, sh)): { x: number; z: number } | null {
  const w = g.world;
  let best = -1, bs = Infinity;
  w.forRadius(b.cx, b.cz, WARSHIP_RANGE - 0.5, (i, x, y, d2) => {
    if (!w.navigable(i) || w.sea[i] !== sea) return;
    const d = Math.sqrt(d2);
    const sc = sq(x - sh.x) + sq(y - sh.z) + sq(Math.max(0, ARCHER_REACH + 0.4 - d)) * 8;
    if (sc < bs) { bs = sc; best = i; }
  });
  return best < 0 ? null : { x: w.nx(best), z: w.ny(best) };
}

/** Can a warship on this water get within reach of stronghold `b` at all? */
export function canBombard(g: Game, sh: Ship, b: Building): boolean {
  return !!b.def.military && b.state === 'done' && hostile(g, sh.owner, b.owner) && !!bombardSpot(g, sh, b);
}

// ------------------------------------------------------------------ gunnery
function shot(g: Game, sh: Ship, tx: number, tz: number) {
  sh.aim = atan2(tx - sh.x, tz - sh.z);
  sh.fired = g.time;
  sh.reload = WARSHIP_RELOAD * (0.9 + g.rng.next() * 0.2);
  g.emit({ type: 'broadside', x: sh.x, z: sh.z, owner: sh.owner, s: sh.id });
}

/** Where the catapult sits: on the foredeck, a little above the deck. */
function muzzle(g: Game, sh: Ship) {
  const f = 0.62 * 1.25;
  return { x: sh.x + sin(sh.heading) * f, y: shipDeckY(g.time, sh.id) + 0.75, z: sh.z + cos(sh.heading) * f };
}

/** A stone at a ship: aimed where it will be when the stone comes down, surer at short range on a slow target. */
export function fireAtShip(g: Game, sh: Ship, t: Ship) {
  const m = muzzle(g, sh);
  const d = hypot(t.x - sh.x, t.z - sh.z);
  const dur = Math.max(0.9, d * 0.14);
  const px = t.x + sin(t.heading) * t.speed * dur, pz = t.z + cos(t.heading) * t.speed * dur;
  const acc = 0.8 - d * 0.02 - t.speed * 0.07 - sh.speed * 0.04;
  const hit = g.rng.next() < acc;
  let tx = px, tz = pz;
  if (hit) { tx += (g.rng.next() - 0.5) * 0.5; tz += (g.rng.next() - 0.5) * 0.5; }
  else {
    const a = g.rng.range(0, Math.PI * 2), r = 1.7 + g.rng.next() * 1.8;
    tx += cos(a) * r;
    tz += sin(a) * r;
  }
  g.projectiles.push({
    id: g.id(), owner: sh.owner, sx: m.x, sy: m.y, sz: m.z, tx, ty: WATER_LEVEL + 0.25, tz, t: 0, dur,
    target: 0, damage: hit ? SHIP_STONE_DAMAGE * (0.85 + g.rng.next() * 0.3) : 0, kind: 'stone', ship: t.id, by: sh.id,
  });
  shot(g, sh, t.x, t.z);
}

/** A stone at a stronghold: a hit kills one of the garrison or cracks the empty walls, as a catapult's does. */
export function fireAtBuilding(g: Game, sh: Ship, b: Building) {
  const w = g.world;
  const m = muzzle(g, sh);
  const d = hypot(b.cx - sh.x, b.cz - sh.z);
  const hit = g.rng.next() < 0.75 - sh.speed * 0.05;
  let tx: number, tz: number, ty: number;
  if (hit) {
    tx = b.cx + (g.rng.next() - 0.5) * b.size * 0.7;
    tz = b.cz + (g.rng.next() - 0.5) * b.size * 0.7;
    ty = w.heightAt(b.cx, b.cz) + b.size * 0.55 + 0.6;
  } else {
    const a = g.rng.range(0, Math.PI * 2), rr = b.size * 0.5 + 1 + g.rng.next() * 1.5;
    tx = b.cx + cos(a) * rr;
    tz = b.cz + sin(a) * rr;
    ty = Math.max(WATER_LEVEL, w.heightAt(tx, tz)) + 0.1;
  }
  g.projectiles.push({
    id: g.id(), owner: sh.owner, sx: m.x, sy: m.y, sz: m.z, tx, ty, tz,
    t: 0, dur: Math.max(1.2, d * 0.16), target: 0, damage: hit ? 1 : 0, kind: 'stone', building: b.id, by: sh.id,
  });
  b.underAttackT = Math.max(b.underAttackT, 12);
  shot(g, sh, b.cx, b.cz);
}

/** A stone aimed at a ship comes down: on its deck, on another enemy hull that sailed into the way, or in the sea. */
export function shipStoneLands(g: Game, p: Projectile) {
  const t = p.ship ? g.ships.get(p.ship) : undefined;
  let victim: Ship | null = null;
  const reach = 1.25 * 1.1;
  if (t && afloat(t) && p.damage > 0 && hypot(t.x - p.tx, t.z - p.tz) < reach + 0.35) victim = t;
  if (!victim) {
    for (const o of g.ships.values()) {
      if (!afloat(o) || !hostile(g, p.owner, o.owner)) continue;
      if (hypot(o.x - p.tx, o.z - p.tz) < reach * 0.75) { victim = o; break; }
    }
  }
  if (!victim) { g.emit({ type: 'seamiss', x: p.tx, z: p.tz }); return; }
  damageShip(g, victim, p.damage > 0 ? p.damage : SHIP_STONE_DAMAGE * 0.7, p.owner, 'stone');
}

/** An arrow aimed at a ship: most find the planking, few do much harm. */
export function shipArrowLands(g: Game, p: Projectile) {
  const t = p.ship ? g.ships.get(p.ship) : undefined;
  if (!t || !afloat(t) || hypot(t.x - p.tx, t.z - p.tz) > 1.6 || g.rng.next() > 0.75) {
    if (g.world.isWater(g.world.idx(Math.max(0, Math.min(g.world.W - 1, Math.round(p.tx))), Math.max(0, Math.min(g.world.H - 1, Math.round(p.tz)))))) g.emit({ type: 'arrowsplash', x: p.tx, z: p.tz });
    return;
  }
  damageShip(g, t, p.damage, p.owner, 'arrow');
}

/** Tower archers loose at an enemy ship within reach (called when no enemy soldier is near). */
export function towerShootShip(g: Game, b: Building, top: number): boolean {
  let best: Ship | null = null, bd = ARCHER_REACH * ARCHER_REACH;
  for (const o of g.ships.values()) {
    if (!afloat(o) || !hostile(g, b.owner, o.owner)) continue;
    const d = sq(o.x - b.cx) + sq(o.z - b.cz);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return false;
  const d = Math.sqrt(bd);
  const dur = Math.max(0.35, d * 0.08);
  const tx = best.x + sin(best.heading) * best.speed * dur, tz = best.z + cos(best.heading) * best.speed * dur;
  g.projectiles.push({
    id: g.id(), owner: b.owner, sx: b.cx, sy: top, sz: b.cz, tx, ty: shipDeckY(g.time, best.id) + 0.35, tz,
    t: 0, dur, target: 0, damage: ARROW_DAMAGE, kind: 'arrow', ship: best.id,
  });
  g.emit({ type: 'bow', x: b.cx, z: b.cz });
  return true;
}

// ------------------------------------------------------------------ damage
const warned = new Map<number, number>(); // ship id -> game time of the last "under attack" message

export function damageShip(g: Game, sh: Ship, dmg: number, by: number, kind: 'stone' | 'arrow') {
  if (!afloat(sh)) return;
  sh.hp -= dmg;
  sh.hitT = g.time;
  g.emit({ type: 'shiphit', x: sh.x, z: sh.z, s: sh.id, owner: sh.owner, kind });
  if (sh.hp <= 0) { sinkShip(g, sh, by); return; }
  if (g.time - (warned.get(sh.id) ?? -99) > 30) {
    warned.set(sh.id, g.time);
    g.message(sh.owner, `The ${sh.kind === 'war' ? 'warship' : 'ship'} “${sh.name}” is under attack!`, sh.x, sh.z, 'bad');
  }
  // a warship keeping guard turns on whoever fires on it, if it can see them
  if (sh.kind === 'war' && sh.state === 'guard' && !sh.target) {
    const foe = enemyShipNear(g, sh, sh.x, sh.z, WARSHIP_SIGHT);
    if (foe) sh.target = foe.id;
  }
}

/** Holed below the waterline: the cargo is lost and whoever is aboard drowns. */
export function sinkShip(g: Game, sh: Ship, by: number) {
  sh.hp = 0;
  sh.state = 'sinking';
  sh.sinkT = 0;
  sh.route = null;
  sh.target = 0;
  sh.at = 0;
  // goods on board go back on the books, to be shipped again
  for (const lot of sh.lots) {
    const o = g.seaOrders.find((x) => x.id === lot.order);
    if (o) o.loaded = Math.max(0, o.loaded - lot.n);
  }
  sh.lots = [];
  sh.cargo = emptyStock();
  let lost = 0;
  for (const id of sh.passengers) {
    const s = g.settlers.get(id);
    if (!s || s.dead) continue;
    s.aboard = 0;
    s.voyage = 0;
    s.voyageFrom = 0;
    kill(g, s);
    s.hidden = true;
    s.deadT = 4;
    lost++;
  }
  sh.passengers = [];
  if (sh.expedition) {
    g.expeditions = g.expeditions.filter((e) => e.id !== sh.expedition);
    sh.expedition = 0;
    g.message(sh.owner, 'The expedition went down with its ship', sh.x, sh.z, 'bad');
  }
  warned.delete(sh.id);
  g.emit({ type: 'sinking', x: sh.x, z: sh.z, s: sh.id, owner: sh.owner });
  const what = sh.kind === 'war' ? 'warship' : 'ship';
  g.message(sh.owner, `The ${what} “${sh.name}” has been sunk!${lost ? ` ${lost} aboard were lost.` : ''}`, sh.x, sh.z, 'bad');
  if (by >= 0 && by !== sh.owner) g.message(by, `We sank the enemy ${what} “${sh.name}”!`, sh.x, sh.z, 'good');
}

/** Going down: it settles and is gone after a few seconds. Returns true once it has sunk. */
export function sinkStep(g: Game, sh: Ship, dt: number): boolean {
  sh.sinkT += dt;
  sh.speed = Math.max(0, sh.speed - dt * 1.2);
  if (sh.sinkT < SINK_TIME) return false;
  g.ships.delete(sh.id);
  g.emit({ type: 'wreck', x: sh.x, z: sh.z, s: sh.id, owner: sh.owner });
  return true;
}

/** Out of the fighting the crew patches the hull: slowly at sea, quickly moored at one of its harbours. */
export function mendShip(g: Game, sh: Ship, dt: number) {
  if (sh.hp >= sh.maxHp || g.time - sh.hitT < 20) return;
  const hb = sh.at ? g.buildings.get(sh.at) : undefined;
  const moored = !sh.route && !!hb && hb.owner === sh.owner && hb.type === 'harbour' && hb.state === 'done';
  sh.hp = Math.min(sh.maxHp, sh.hp + dt * (moored ? 1.6 : 0.12));
}

// ------------------------------------------------------------------ warship brain
function foeOf(g: Game, sh: Ship): Ship | null {
  const t = sh.target ? g.ships.get(sh.target) : undefined;
  return t && afloat(t) && hostile(g, sh.owner, t.owner) ? t : null;
}

/** Stand guard where it is now. */
function guardHere(sh: Ship) {
  sh.state = 'guard';
  sh.target = 0;
  sh.postX = sh.x;
  sh.postZ = sh.z;
}

/** Sail after a ship, to where it is heading. */
function chase(g: Game, sh: Ship, t: Ship) {
  sh.routeT = 1.5;
  const lead = Math.min(4, hypot(t.x - sh.x, t.z - sh.z) * 0.25);
  if (!sailTo(g, sh, t.x + sin(t.heading) * t.speed * lead, t.z + cos(t.heading) * t.speed * lead)) sailTo(g, sh, t.x, t.z);
}

/** Shoot at whatever is within reach: an enemy ship first, else a stronghold. */
function fireAtWill(g: Game, sh: Ship) {
  if (sh.reload > 0) return;
  const foe = enemyShipNear(g, sh, sh.x, sh.z, WARSHIP_RANGE);
  if (foe) { fireAtShip(g, sh, foe); return; }
  const b = strongholdInReach(g, sh);
  if (b) fireAtBuilding(g, sh, b);
}

export function warshipStep(g: Game, sh: Ship, dt: number, arrived: boolean) {
  sh.reload -= dt;
  sh.scanT -= dt;
  sh.routeT -= dt;
  if (arrived) {
    // moored beside one of its harbours, it can mend there
    const hb = nearestHarbourBySea(g, sh.owner, sh);
    if (hb && hypot(hb.cx - sh.x, hb.cz - sh.z) < hb.size + 5) sh.at = hb.id;
  }
  switch (sh.state) {
    case 'hunt': {
      const t = foeOf(g, sh);
      if (!t || (sh.scanT <= 0 && seaOf(g, t) !== seaOf(g, sh))) { guardHere(sh); sh.route = null; return; }
      if (sh.scanT <= 0) sh.scanT = 0.5;
      const d = hypot(t.x - sh.x, t.z - sh.z);
      if (d > WARSHIP_RANGE - 1.5) { if (sh.routeT <= 0 || !sh.route) chase(g, sh, t); }
      else if (sh.route && d < WARSHIP_RANGE - 3) sh.route = null;
      if (d <= WARSHIP_RANGE && sh.reload <= 0) fireAtShip(g, sh, t);
      else fireAtWill(g, sh);
      return;
    }
    case 'bombard': {
      const b = g.buildings.get(sh.target);
      if (!b || !b.def.military || b.state !== 'done' || !hostile(g, sh.owner, b.owner)) { guardHere(sh); sh.route = null; return; }
      const d = hypot(b.cx - sh.x, b.cz - sh.z);
      if (d <= WARSHIP_RANGE - 0.2) {
        if (sh.route && d <= WARSHIP_RANGE - 0.9) sh.route = null;
        // an enemy warship closing in is answered first
        const foe = sh.reload <= 0 ? enemyShipNear(g, sh, sh.x, sh.z, WARSHIP_RANGE) : null;
        if (foe && foe.kind === 'war') fireAtShip(g, sh, foe);
        else if (sh.reload <= 0) fireAtBuilding(g, sh, b);
        return;
      }
      if (!sh.route && sh.routeT <= 0) {
        sh.routeT = 3;
        const spot = bombardSpot(g, sh, b);
        if (!spot || !sailTo(g, sh, spot.x, spot.z)) {
          g.message(sh.owner, `The “${sh.name}” cannot get within range of the enemy ${b.def.name}`, sh.x, sh.z, 'bad');
          guardHere(sh);
          return;
        }
      }
      fireAtWill(g, sh);
      return;
    }
    default: {
      sh.state = 'guard';
      if (sh.postX < 0) { sh.postX = sh.x; sh.postZ = sh.z; }
      const px = sh.postX, pz = sh.postZ;
      const underWay = !!sh.route && !sh.target;
      if (sh.scanT <= 0) {
        sh.scanT = 0.5;
        // foes near the post are gone after, as long as the chase stays close to it
        if (!underWay) {
          const cur = foeOf(g, sh);
          if (cur && hypot(cur.x - px, cur.z - pz) > SHIP_LEASH) { sh.target = 0; sh.route = null; }
          else if (!cur) {
            if (sh.target) { sh.target = 0; sh.route = null; }
            const foe = enemyShipNear(g, sh, sh.x, sh.z, WARSHIP_SIGHT);
            if (foe && hypot(foe.x - px, foe.z - pz) < SHIP_LEASH) sh.target = foe.id;
          }
        }
      }
      const foe = sh.target ? foeOf(g, sh) : null;
      if (foe) {
        const d = hypot(foe.x - sh.x, foe.z - sh.z);
        if (d > WARSHIP_RANGE - 1.5) { if (sh.routeT <= 0 || !sh.route) chase(g, sh, foe); }
        else if (sh.route && d < WARSHIP_RANGE - 3) sh.route = null;
        if (d <= WARSHIP_RANGE && sh.reload <= 0) fireAtShip(g, sh, foe);
        else fireAtWill(g, sh);
        return;
      }
      if (sh.target) sh.target = 0;
      // back to the post
      if (!sh.route && sh.routeT <= 0 && hypot(sh.x - px, sh.z - pz) > 1.6) {
        sh.routeT = 3;
        if (!sailTo(g, sh, px, pz)) { sh.postX = sh.x; sh.postZ = sh.z; }
      }
      fireAtWill(g, sh);
    }
  }
}

// ------------------------------------------------------------------ orders
function mine(g: Game, owner: number, ids: Iterable<number>): Ship[] {
  const out: Ship[] = [];
  for (const id of ids) {
    const sh = g.ships.get(id);
    if (sh && sh.owner === owner && sh.kind === 'war' && afloat(sh)) out.push(sh);
  }
  return out;
}

/** Open water around (x, z) on `sea` for `n` ships to stand on, a hull's length apart. */
function stations(g: Game, x: number, z: number, n: number, sea: number): { x: number; z: number }[] {
  const w = g.world;
  const cands: { i: number; d: number }[] = [];
  w.forRadius(x, z, 3 + Math.sqrt(n) * 3, (i, _x, _y, d2) => {
    if (w.navigable(i) && w.sea[i] === sea) cands.push({ i, d: d2 });
  });
  cands.sort((a, b) => a.d - b.d);
  const out: { x: number; z: number }[] = [];
  for (const c of cands) {
    if (out.length >= n) break;
    const cx = w.nx(c.i), cz = w.ny(c.i);
    if (out.some((o) => hypot(o.x - cx, o.z - cz) < 2.6)) continue;
    out.push({ x: cx, z: cz });
  }
  return out;
}

/** Sail to (x, z) and stand guard there. Returns how many went. */
export function orderShipMove(g: Game, owner: number, ids: Iterable<number>, x: number, z: number): number {
  const i = nearestNavigable(g, x, z);
  if (i < 0 || hypot(g.world.nx(i) - x, g.world.ny(i) - z) > 4) return 0;
  const sea = g.world.sea[i];
  const fleet = mine(g, owner, ids).filter((sh) => seaOf(g, sh) === sea);
  const spots = stations(g, g.world.nx(i), g.world.ny(i), fleet.length, sea);
  if (!spots.length) return 0;
  let n = 0;
  fleet.forEach((sh, k) => {
    const p = spots[k % spots.length];
    sh.state = 'guard';
    sh.target = 0;
    sh.postX = p.x;
    sh.postZ = p.z;
    sh.routeT = 3;
    if (sailTo(g, sh, p.x, p.z) || hypot(sh.x - p.x, sh.z - p.z) < 1.6) n++;
  });
  if (n) g.emit({ type: 'order', x, z, owner, kind: 'move' });
  return n;
}

/** Go after an enemy ship. */
export function orderShipAttack(g: Game, owner: number, ids: Iterable<number>, t: Ship): number {
  if (!afloat(t) || !hostile(g, owner, t.owner)) return 0;
  const sea = seaOf(g, t);
  let n = 0;
  for (const sh of mine(g, owner, ids)) {
    if (seaOf(g, sh) !== sea) continue;
    sh.state = 'hunt';
    sh.target = t.id;
    sh.routeT = 0;
    n++;
  }
  if (n) g.emit({ type: 'order', x: t.x, z: t.z, owner, kind: 'attack' });
  return n;
}

/** Sail within reach of an enemy stronghold and shell it until it falls. */
export function orderShipBombard(g: Game, owner: number, ids: Iterable<number>, b: Building): number {
  if (!b.def.military || b.state !== 'done' || !hostile(g, owner, b.owner)) return 0;
  let n = 0;
  for (const sh of mine(g, owner, ids)) {
    if (!bombardSpot(g, sh, b)) continue;
    sh.state = 'bombard';
    sh.target = b.id;
    sh.routeT = 0;
    sh.route = null;
    n++;
  }
  if (n) {
    g.emit({ type: 'order', x: b.cx, z: b.cz, owner, kind: 'attack' });
    g.message(b.owner, `Enemy warships are sailing on your ${b.def.name}!`, b.cx, b.cz, 'bad', b.id);
    b.underAttackT = Math.max(b.underAttackT, 20);
  }
  return n;
}

/** Back to a harbour (the one given, else the nearest) to moor and mend. */
export function orderShipHome(g: Game, owner: number, ids: Iterable<number>, to?: Building): number {
  let n = 0;
  for (const sh of mine(g, owner, ids)) {
    const hb = to && to.owner === owner && to.type === 'harbour' && to.state === 'done' && to.dock >= 0 && g.world.sea[to.dock] === seaOf(g, sh) ? to : nearestHarbourBySea(g, owner, sh);
    if (!hb) continue;
    let k = 0;
    for (const o of g.ships.values()) if (o.id !== sh.id && o.owner === owner && (o.at === hb.id || (o.kind === 'war' && hypot(o.postX - hb.cx, o.postZ - hb.cz) < hb.size + 5))) k++;
    const p = berthPos(g, hb, 1 + (k % 4));
    sh.state = 'guard';
    sh.target = 0;
    sh.postX = p.x;
    sh.postZ = p.z;
    sh.routeT = 3;
    if (sailTo(g, sh, p.x, p.z) || hypot(sh.x - p.x, sh.z - p.z) < 1.6) { n++; if (!sh.route) sh.at = hb.id; }
  }
  if (n && to) g.emit({ type: 'order', x: to.cx, z: to.cz, owner, kind: 'garrison' });
  return n;
}

/** What a ship is up to, for panels. */
export function warshipDoing(g: Game, sh: Ship): string {
  if (sh.state === 'sinking') return 'Sinking!';
  if (sh.state === 'hunt') { const t = g.ships.get(sh.target); return t ? `Hunting the “${t.name}”` : 'Hunting'; }
  if (sh.state === 'bombard') { const b = g.buildings.get(sh.target); return b ? `Bombarding the enemy ${b.def.name}` : 'Bombarding'; }
  if (sh.target) { const t = g.ships.get(sh.target); if (t) return `Engaging the “${t.name}”`; }
  if (sh.route) return 'Sailing to its post';
  if (sh.at) { const b = g.buildings.get(sh.at); if (b) return `Moored at the ${b.def.name.toLowerCase()}`; }
  return 'Standing guard';
}
