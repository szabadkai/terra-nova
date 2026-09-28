// Military: territory, garrisons, attacks, melee/ranged combat, capturing.
import type { Game } from './game';
import { A, abortPlan, claim, enter, exit, plan, turnTo } from './settlers';
import type { Building, Settler } from './types';

export function isSoldier(s: Settler) {
  return s.job === 'swordsman' || s.job === 'bowman';
}

const regB = (g: Game, b: Building) => g.world.region[b.door];
const regS = (g: Game, s: Settler) => g.world.region[s.node];

// ------------------------------------------------------------------ territory
export function recomputeTerritory(g: Game) {
  const w = g.world;
  const best = new Float32Array(w.N).fill(1e9);
  const prev = new Int8Array(w.owner);
  w.owner.fill(-1);
  const mil: Building[] = [];
  for (const b of g.buildings.values()) {
    if (!b.def.military || b.state !== 'done' || !b.occupied) continue;
    mil.push(b);
  }
  // older buildings first so ties keep established borders
  mil.sort((a, b) => a.created - b.created);
  for (const b of mil) {
    const r = b.def.military!.radius;
    w.forRadius(b.cx, b.cz, r, (i, _x, _y, d2) => {
      const score = Math.sqrt(d2) / r + (prev[i] === b.owner ? -0.08 : 0);
      if (score < best[i]) {
        best[i] = score;
        w.owner[i] = b.owner;
      }
    });
  }
  // an expedition's harbour site holds the unclaimed shore around it until it is manned
  for (const b of g.buildings.values()) {
    if (!b.colony || b.occupied || b.state === 'burning') continue;
    w.forRadius(b.cx, b.cz, 5.5, (i) => { if (w.owner[i] < 0 && !w.isWater(i)) w.owner[i] = b.owner; });
  }
  // land staked out by pioneers is kept where no stronghold claims it; a foreign one takes it for good
  const claim = w.claim;
  for (let i = 0; i < w.N; i++) {
    const c = claim[i];
    if (c < 0) continue;
    const o = w.owner[i];
    if (o < 0 && g.players[c]?.alive) w.owner[i] = c;
    else if (o !== c) claim[i] = -1;
  }
  w.ownerDirty = true;
  g.ownerVersion++;
  // buildings on foreign land burn down
  for (const b of g.buildings.values()) {
    if (b.state === 'burning') continue;
    if (b.def.military && b.occupied) continue;
    const c = w.idx(Math.round(b.cx), Math.round(b.cz));
    if (w.owner[c] !== b.owner) {
      g.message(b.owner, `${b.def.name} was lost to the enemy!`, b.cx, b.cz, 'bad');
      g.destroyBuilding(b, true);
    }
  }
  // fields outside territory vanish
  for (const f of [...g.fields.values()]) if (w.owner[f.node] !== f.owner) g.removeField(f);
}

// ------------------------------------------------------------------ dispatch
export function updateMilitary(g: Game, owner: number) {
  const p = g.players[owner];
  // morale from gold
  const st = g.totalStock(owner);
  p.morale = Math.min(1, st.gold / 25);

  const mil: Building[] = [];
  for (const b of g.buildings.values()) {
    if (b.owner === owner && b.def.military && b.state === 'done') mil.push(b);
  }
  // clean garrison lists
  for (const b of mil) {
    b.garrison = b.garrison.filter((id) => {
      const s = g.settlers.get(id);
      return s && !s.dead && s.inside === b.id;
    });
    if (b.type !== 'hq' && b.garrison.length === 0 && b.occupied && b.soldiersIncoming === 0) {
      // abandoned tower keeps territory until conquered; nothing to do
    }
  }
  // idle soldiers go to buildings that need them
  const idle: Settler[] = [];
  for (const s of g.settlers.values()) {
    if (s.owner !== owner || !isSoldier(s) || s.dead) continue;
    if (s.sstate === 'idle' && !s.engaged) idle.push(s);
  }
  const hq = g.buildings.get(p.hq);
  for (const b of mil) {
    if (b.type === 'hq') continue;
    let need = b.desiredSoldiers - b.garrison.length - b.soldiersIncoming;
    const r = regB(g, b);
    while (need > 0) {
      // nearest idle soldier on the same landmass
      let bi = -1, bd = Infinity;
      for (let i = 0; i < idle.length; i++) {
        if (regS(g, idle[i]) !== r) continue;
        const d = (idle[i].x - b.cx) ** 2 + (idle[i].z - b.cz) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      let s: Settler | null = null;
      if (bi >= 0) {
        s = idle[bi];
        idle.splice(bi, 1);
      } else {
        // take from a reserve (HQ or castle with surplus)
        const src = reserveSource(g, owner, b);
        if (!src) break;
        const id = src.garrison.pop()!;
        s = g.settlers.get(id)!;
        exit(g, s);
      }
      sendSoldierTo(g, s, b);
      need--;
    }
    // too many soldiers (desired lowered): send extras home
    while (b.garrison.length > Math.max(1, b.desiredSoldiers) && hq && hq.id !== b.id && regB(g, hq) === r) {
      const id = b.garrison.pop()!;
      const s = g.settlers.get(id);
      if (!s) continue;
      exit(g, s);
      sendSoldierTo(g, s, hq);
    }
  }
  // remaining idle soldiers return to HQ / nearest military building with space
  for (const s of idle) {
    if (s.actions.length) continue;
    let target: Building | null = null, bd = Infinity;
    const r = regS(g, s);
    for (const b of mil) {
      if (regB(g, b) !== r) continue;
      const cap = b.type === 'hq' ? 999 : b.desiredSoldiers;
      if (b.garrison.length + b.soldiersIncoming >= cap) continue;
      const d = (s.x - b.cx) ** 2 + (s.z - b.cz) ** 2 + (b.type === 'hq' ? 0 : 400);
      if (d < bd) { bd = d; target = b; }
    }
    if (target) sendSoldierTo(g, s, target);
  }
  // towers under threat send defenders
  for (const b of mil) defend(g, b);
}

function reserveSource(g: Game, owner: number, target: Building): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || b.state !== 'done' || !b.def.military) continue;
    if (b.id === target.id || regB(g, b) !== regB(g, target)) continue;
    const surplus = b.type === 'hq' ? b.garrison.length - 2 : b.garrison.length - b.desiredSoldiers;
    if (surplus <= 0) continue;
    const d = (b.cx - target.cx) ** 2 + (b.cz - target.cz) ** 2 - (b.type === 'hq' ? 0 : 0);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export function sendSoldierTo(g: Game, s: Settler, b: Building) {
  claim(g, s);
  s.sstate = 'moving';
  s.home = b.id;
  b.soldiersIncoming++;
  let arrived = false;
  plan(s, [
    A.walk(b.door),
    A.do(() => {
      b.soldiersIncoming = Math.max(0, b.soldiersIncoming - 1);
      arrived = true;
      if (!g.buildings.has(b.id) || b.state !== 'done' || b.owner !== s.owner) { s.sstate = 'idle'; s.home = 0; return; }
      enter(g, s, b);
      s.sstate = 'garrison';
      b.garrison.push(s.id);
      s.hp = Math.min(s.maxHp, s.hp + 30);
      if (!b.occupied) {
        b.occupied = true;
        g.territoryDirty = true;
        g.emit({ type: 'occupied', b: b.id, x: b.cx, z: b.cz, owner: b.owner });
        g.message(b.owner, `${b.def.name} is now manned — territory expanded`, b.cx, b.cz, 'good');
      }
    }),
  ], () => {
    if (!arrived) b.soldiersIncoming = Math.max(0, b.soldiersIncoming - 1);
    if (s.sstate === 'moving') s.sstate = 'idle';
  });
}

// ------------------------------------------------------------------ attack command
export function attackableSoldiers(g: Game, owner: number, target: Building): Settler[] {
  const out: Settler[] = [];
  const r = regB(g, target);
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || !b.def.military || b.state !== 'done' || regB(g, b) !== r) continue;
    const d = Math.hypot(b.cx - target.cx, b.cz - target.cz);
    if (d > 42) continue;
    const keep = 1;
    const avail = b.garrison.slice(keep);
    for (const id of avail) {
      const s = g.settlers.get(id);
      if (s) out.push(s);
    }
  }
  out.sort((a, b) => ((a.x - target.cx) ** 2 + (a.z - target.cz) ** 2) - ((b.x - target.cx) ** 2 + (b.z - target.cz) ** 2));
  return out;
}

export function launchAttack(g: Game, owner: number, target: Building, count: number): number {
  if (target.owner === owner || !target.def.military) return 0;
  const soldiers = attackableSoldiers(g, owner, target).slice(0, count);
  for (const s of soldiers) {
    const home = g.buildings.get(s.inside);
    if (home) home.garrison = home.garrison.filter((id) => id !== s.id);
    exit(g, s);
    s.home = home ? home.id : 0;
    orderAttack(g, s, target);
  }
  if (soldiers.length) {
    g.emit({ type: 'attack', b: target.id, owner, x: target.cx, z: target.cz });
    g.message(target.owner, `Your ${target.def.name} is under attack!`, target.cx, target.cz, 'bad');
    target.underAttackT = 20;
  }
  return soldiers.length;
}

function orderAttack(g: Game, s: Settler, target: Building) {
  claim(g, s);
  s.sstate = 'attack';
  s.targetB = target.id;
}

// ------------------------------------------------------------------ defence
function defend(g: Game, b: Building) {
  if (!b.garrison.length) return;
  const threats: Settler[] = [];
  const r = regB(g, b);
  for (const s of g.settlers.values()) {
    if (s.owner === b.owner || !isSoldier(s) || s.dead || s.hidden || regS(g, s) !== r) continue;
    const d = Math.hypot(s.x - b.cx, s.z - b.cz);
    if ((s.sstate === 'attack' && s.targetB === b.id && d < 12) || d < 5) threats.push(s);
  }
  if (!threats.length) return;
  b.underAttackT = 10;
  // count defenders already outside
  const defenders = new Set<number>();
  for (const s of g.settlers.values()) {
    if (s.owner === b.owner && s.sstate === 'defend' && s.home === b.id && !s.dead) defenders.add(s.target);
  }
  for (const t of threats) {
    if (!b.garrison.length) break;
    if (defenders.has(t.id)) continue;
    // keep one inside for bowmen towers? all defenders may go
    const id = b.garrison.shift()!;
    const s = g.settlers.get(id);
    if (!s) continue;
    exit(g, s);
    s.idle = false;
    s.sstate = 'defend';
    s.target = t.id;
    s.home = b.id;
    defenders.add(t.id);
  }
}

// ------------------------------------------------------------------ per-soldier update
const MELEE_RANGE = 1.55;
const BOW_RANGE = 7;

function enemySoldierNear(g: Game, s: Settler, range: number): Settler | null {
  let best: Settler | null = null, bd = range * range;
  for (const o of g.settlers.values()) {
    if (o.owner === s.owner || !isSoldier(o) || o.dead || o.hidden) continue;
    const d = (o.x - s.x) ** 2 + (o.z - s.z) ** 2;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function strength(g: Game, s: Settler) {
  const morale = g.players[s.owner]?.morale ?? 0;
  return (1 + morale * 0.6 + s.level * 0.25) * (g.time < s.blessUntil ? 1.4 : 1);
}

function hit(g: Game, attacker: Settler, victim: Settler, dmg: number) {
  victim.hp -= dmg;
  g.emit({ type: 'hit', x: victim.x, z: victim.z, s: victim.id });
  if (victim.hp <= 0) kill(g, victim);
}

export function kill(g: Game, s: Settler) {
  if (s.dead) return;
  abortPlan(g, s);
  s.dead = true;
  s.deadT = 0;
  s.anim = 'die';
  s.animT = 0;
  s.engaged = 0;
  s.next = -1;
  g.syncPos(s);
  g.emit({ type: 'death', x: s.x, z: s.z, owner: s.owner });
  // release garrison membership
  for (const b of g.buildings.values()) {
    if (b.garrison.includes(s.id)) b.garrison = b.garrison.filter((id) => id !== s.id);
  }
  for (const o of g.settlers.values()) if (o.engaged === s.id) o.engaged = 0;
}

/** Returns true when the soldier is busy with combat this frame (skip normal actions). */
export function soldierUpdate(g: Game, s: Settler, dt: number): boolean {
  s.cooldown -= dt;
  // engaged in melee
  if (s.engaged) {
    const e = g.settlers.get(s.engaged);
    if (!e || e.dead || e.hidden) {
      s.engaged = 0;
    } else {
      if (s.next >= 0) return true; // finish step
      s.path = null;
      const tgt = Math.atan2(e.x - s.x, e.z - s.z);
      s.heading = turnTo(s.heading, tgt, dt * 8);
      const d = Math.hypot(e.x - s.x, e.z - s.z);
      if (d > MELEE_RANGE + 0.6) {
        // chase
        if (!s.actions.length || s.actions[0].k !== 'walk') {
          s.actions.length = 0;
          s.actions.push(A.walk(e.next >= 0 ? e.next : e.node, true));
        }
        return false;
      }
      s.actions.length = 0;
      if (s.cooldown <= 0) {
        s.cooldown = 1.0 + g.rng.next() * 0.5;
        s.anim = 'fight';
        s.animT = 0;
        const base = s.job === 'swordsman' ? 22 : 9;
        const chance = s.job === 'swordsman' ? 0.62 : 0.45;
        if (g.rng.next() < chance) {
          const dmg = base * strength(g, s) * (0.8 + g.rng.next() * 0.4);
          setTimeoutHit(g, s, e, dmg);
        } else g.emit({ type: 'parry', x: e.x, z: e.z });
        g.emit({ type: 'swing', x: s.x, z: s.z });
      } else if (s.animT > 0.6) s.anim = 'idle';
      return true;
    }
  }
  // scan for enemies
  s.scanT -= dt;
  const combatant = s.sstate === 'attack' || s.sstate === 'defend' || s.sstate === 'moving' || s.sstate === 'idle' || s.sstate === 'return';
  if (combatant && s.scanT <= 0) {
    s.scanT = 0.25;
    const near = enemySoldierNear(g, s, s.job === 'bowman' ? BOW_RANGE : MELEE_RANGE + 1.4);
    if (near) {
      const d = Math.hypot(near.x - s.x, near.z - s.z);
      if (s.job === 'bowman' && d > MELEE_RANGE + 0.2) {
        // ranged attack
        if (s.cooldown <= 0 && s.next < 0) {
          s.actions.length = 0;
          s.path = null;
          s.cooldown = 1.9 + g.rng.next() * 0.5;
          s.heading = Math.atan2(near.x - s.x, near.z - s.z);
          s.anim = 'shoot';
          s.animT = 0;
          fireArrow(g, s, near, 13 * strength(g, s));
        }
        if (s.next < 0) return true;
      } else if (d <= MELEE_RANGE + 1.4 && regS(g, near) === regS(g, s)) {
        engage(g, s, near);
        return true;
      }
    }
  }
  if (s.anim === 'shoot' && s.animT < 0.9) return true;
  if (s.actions.length) return false;
  // think by state
  switch (s.sstate) {
    case 'attack': return thinkAttack(g, s);
    case 'defend': return thinkDefend(g, s);
    case 'return':
    case 'idle': {
      // go home if we have one
      const home = s.home ? g.buildings.get(s.home) : null;
      if (home && home.owner === s.owner && home.state === 'done' && home.def.military) {
        sendSoldierTo(g, s, home);
      } else {
        s.home = 0;
        s.sstate = 'idle';
      }
      return false;
    }
  }
  return false;
}

// Delay damage slightly so it lines up with the swing animation
const pendingHits: { at: number; a: number; v: number; dmg: number }[] = [];
function setTimeoutHit(g: Game, a: Settler, v: Settler, dmg: number) {
  pendingHits.push({ at: g.time + 0.3, a: a.id, v: v.id, dmg });
}
export function flushHits(g: Game) {
  for (let i = pendingHits.length - 1; i >= 0; i--) {
    const h = pendingHits[i];
    if (g.time < h.at) continue;
    pendingHits.splice(i, 1);
    const a = g.settlers.get(h.a), v = g.settlers.get(h.v);
    if (!a || !v || a.dead || v.dead) continue;
    hit(g, a, v, h.dmg);
  }
}

function engage(g: Game, s: Settler, e: Settler) {
  s.actions.length = 0;
  s.path = null;
  s.engaged = e.id;
  if (!e.engaged && !e.hidden) {
    e.engaged = s.id;
    e.actions.length = 0;
    e.path = null;
  }
}

function fireArrow(g: Game, s: Settler, target: Settler, dmg: number) {
  const w = g.world;
  const sy = w.heightAt(s.x, s.z) + 0.5;
  const ty = w.heightAt(target.x, target.z) + 0.35;
  const d = Math.hypot(target.x - s.x, target.z - s.z);
  g.projectiles.push({
    id: g.id(), owner: s.owner, sx: s.x, sy, sz: s.z, tx: target.x, ty, tz: target.z,
    t: 0, dur: Math.max(0.3, d * 0.08), target: target.id, damage: dmg, kind: 'arrow',
  });
  g.emit({ type: 'bow', x: s.x, z: s.z });
}

function thinkAttack(g: Game, s: Settler): boolean {
  const b = g.buildings.get(s.targetB);
  if (!b || b.state !== 'done' || b.owner === s.owner) {
    s.sstate = 'return';
    s.targetB = 0;
    return false;
  }
  const w = g.world;
  const dx = w.nx(s.node) - w.nx(b.door), dy = w.ny(s.node) - w.ny(b.door);
  const atDoor = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
  if (!atDoor) {
    plan(s, [A.walk(b.door, true)], () => {});
    return false;
  }
  // at the door: capture if empty and no defenders out
  if (b.garrison.length === 0) {
    let defendersOut = false;
    for (const o of g.settlers.values()) {
      if (o.owner === b.owner && o.sstate === 'defend' && o.home === b.id && !o.dead) { defendersOut = true; break; }
    }
    if (!defendersOut) {
      capture(g, b, s);
      return true;
    }
  }
  plan(s, [A.anim('idle', 0.6)]);
  return false;
}

function thinkDefend(g: Game, s: Settler): boolean {
  const t = g.settlers.get(s.target);
  const home = g.buildings.get(s.home);
  if (!t || t.dead || t.hidden || !home || home.state !== 'done') {
    s.sstate = home && home.owner === s.owner ? 'return' : 'idle';
    return false;
  }
  const d = Math.hypot(t.x - s.x, t.z - s.z);
  if (d > 16) { s.sstate = 'return'; return false; }
  plan(s, [A.walk(t.next >= 0 ? t.next : t.node, true)]);
  return false;
}

function capture(g: Game, b: Building, s: Settler) {
  const prev = b.owner;
  g.message(prev, `Your ${b.def.name} has been captured!`, b.cx, b.cz, 'bad');
  g.message(s.owner, `We captured an enemy ${b.def.name}!`, b.cx, b.cz, 'good');
  g.emit({ type: 'captured', b: b.id, owner: s.owner, x: b.cx, z: b.cz });
  if (b.type === 'hq') {
    // the headquarters is razed
    g.destroyBuilding(b, true);
    s.sstate = 'return';
    s.targetB = 0;
    g.territoryDirty = true;
    return;
  }
  // release anyone associated with the previous owner
  for (const o of g.settlers.values()) {
    if (o.owner === prev && (o.home === b.id || o.inside === b.id)) {
      if (o.inside === b.id) exit(g, o);
      abortPlan(g, o);
      o.home = 0;
      if (isSoldier(o)) o.sstate = 'idle';
    }
  }
  b.owner = s.owner;
  b.garrison = [];
  b.soldiersIncoming = 0;
  b.desiredSoldiers = b.def.military!.capacity;
  b.stock = Object.fromEntries(Object.keys(b.stock).map((k) => [k, 0])) as any;
  b.incoming = Object.fromEntries(Object.keys(b.incoming).map((k) => [k, 0])) as any;
  b.outgoing = Object.fromEntries(Object.keys(b.outgoing).map((k) => [k, 0])) as any;
  b.occupied = true;
  abortPlan(g, s);
  enter(g, s, b);
  s.sstate = 'garrison';
  s.home = b.id;
  s.targetB = 0;
  b.garrison.push(s.id);
  // other attackers aiming at this building go home
  for (const o of g.settlers.values()) {
    if (o.targetB === b.id && o.id !== s.id) { o.targetB = 0; o.sstate = 'return'; }
  }
  g.territoryDirty = true;
}

// ------------------------------------------------------------------ projectiles & tower archers
export function updateProjectiles(g: Game, dt: number) {
  flushHits(g);
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const p = g.projectiles[i];
    p.t += dt;
    if (p.t >= p.dur) {
      g.projectiles.splice(i, 1);
      if (p.target < 0) continue; // animal (handled by hunter plan)
      const v = g.settlers.get(p.target);
      if (!v || v.dead) continue;
      const d = Math.hypot(v.x - p.tx, v.z - p.tz);
      if (d < 1.2 && g.rng.next() < 0.78) {
        v.hp -= p.damage;
        g.emit({ type: 'hit', x: v.x, z: v.z, s: v.id });
        if (v.hp <= 0) kill(g, v);
      }
    }
  }
  // towers with bowmen shoot at nearby enemies
  towerT -= dt;
  if (towerT > 0) return;
  towerT = 0.5;
  for (const b of g.buildings.values()) {
    if (!b.def.military || b.state !== 'done' || !b.garrison.length) continue;
    b.shootT -= 0.5;
    if (b.shootT > 0) continue;
    let archers = 0;
    for (const id of b.garrison) {
      const s = g.settlers.get(id);
      if (s && s.job === 'bowman') archers++;
    }
    if (!archers) continue;
    let best: Settler | null = null, bd = 9 * 9;
    for (const o of g.settlers.values()) {
      if (o.owner === b.owner || !isSoldier(o) || o.dead || o.hidden) continue;
      const d = (o.x - b.cx) ** 2 + (o.z - b.cz) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) continue;
    b.shootT = 2.4 / archers;
    const w = g.world;
    const top = w.heightAt(b.cx, b.cz) + (b.type === 'tower_s' ? 2.6 : b.type === 'castle' || b.type === 'hq' ? 3.4 : 3.2);
    const ty = w.heightAt(best.x, best.z) + 0.35;
    const d = Math.sqrt(bd);
    g.projectiles.push({
      id: g.id(), owner: b.owner, sx: b.cx, sy: top, sz: b.cz, tx: best.x, ty, tz: best.z,
      t: 0, dur: Math.max(0.35, d * 0.08), target: best.id, damage: 11, kind: 'arrow',
    });
    g.emit({ type: 'bow', x: b.cx, z: b.cz });
  }
}
let towerT = 0;
