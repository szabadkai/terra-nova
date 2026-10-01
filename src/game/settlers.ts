// Settler movement, action queue execution and per-role thinking.
import type { Game } from './game';
import type { Action, Anim, Building, Settler } from './types';
import { workerThink } from './work';
import { soldierUpdate, isSoldier, isCombatant } from './military';
import { DX8, DY8 } from './world';
import { builderThink, diggerThink } from './economy';
import { pioneerThink } from './pioneers';
import { donkeyThink } from './trade';
import { catapultThink } from './siege';
import { atan2, hypot, sq } from '../core/fmath';

const BASE_STEP = 0.52;

export function abortPlan(g: Game, s: Settler) {
  const f = s.onAbort;
  s.onAbort = null;
  s.actions.length = 0;
  s.path = null;
  if (f) f();
}

export function plan(s: Settler, actions: Action[], onAbort?: () => void) {
  s.actions.push(...actions);
  if (onAbort) s.onAbort = onAbort;
}

export const A = {
  walk: (to: number, adj = false): Action => ({ k: 'walk', to, adj }),
  anim: (anim: Anim, dur: number, face?: number, tick?: (t: number) => void): Action => ({ k: 'anim', anim, dur, face, tick }),
  do: (fn: () => boolean | void): Action => ({ k: 'do', fn }),
  wait: (dur: number): Action => ({ k: 'wait', dur }),
};

export function enter(g: Game, s: Settler, b: Building) {
  s.hidden = true;
  s.inside = b.id;
  s.node = b.door;
  s.next = -1;
  s.path = null;
  g.syncPos(s);
}

export function exit(g: Game, s: Settler) {
  if (s.inside) {
    const b = g.buildings.get(s.inside);
    s.inside = 0;
    s.hidden = false;
    if (b) {
      s.node = b.door;
      g.syncPos(s);
    }
  }
}

function startStep(g: Game, s: Settler): boolean {
  const w = g.world;
  if (!s.path || s.pathI >= s.path.length) return false;
  const n = s.path[s.pathI];
  if (!w.walkable(n) && !(s.pathI === s.path.length - 1 && !w.isWater(n))) {
    // path blocked -> drop it, walk action will re-plan
    s.path = null;
    return false;
  }
  s.pathI++;
  const ax = w.nx(s.node), az = w.ny(s.node);
  const bx = w.nx(n), bz = w.ny(n);
  const dx = bx - ax, dz = bz - az;
  const dist = dx !== 0 && dz !== 0 ? 1.4142 : 1;
  const dh = w.h[n] - w.h[s.node];
  let dur = BASE_STEP * dist * (1 + Math.max(0, dh) * 0.55 + Math.max(0, -dh) * 0.1);
  if (s.job === 'donkey') dur *= 0.88; // a donkey trots along, laden or not
  else if (s.job === 'catapult') dur *= 1.75; // hauled along on its wheels
  else if (s.carrying) dur *= 1.06;
  if (isSoldier(s) && s.sstate === 'attack') dur *= 0.92;
  // marching to a post in step with a slower group
  else if (s.pace > 1 && s.sstate === 'hold') dur *= s.pace;
  s.stepDur = dur;
  s.next = n;
  s.t = 0;
  return true;
}

export function updateMovement(g: Game, s: Settler, dt: number) {
  const w = g.world;
  if (s.next >= 0) {
    s.t += dt / s.stepDur;
    if (s.t >= 1) {
      s.node = s.next;
      s.next = -1;
      s.t = 0;
      const wr = w.wear[s.node] + 0.0035;
      w.wear[s.node] = wr > 1 ? 1 : wr;
      if (s.path && s.pathI < s.path.length) {
        // carry over leftover time for smooth motion
        startStep(g, s);
      }
    }
  } else if (s.path && s.pathI < s.path.length) {
    startStep(g, s);
  }
  // world position + heading
  const ax = w.nx(s.node), az = w.ny(s.node);
  if (s.next >= 0) {
    const bx = w.nx(s.next), bz = w.ny(s.next);
    s.x = ax + (bx - ax) * s.t;
    s.z = az + (bz - az) * s.t;
    const target = atan2(bx - ax, bz - az);
    s.heading = turnTo(s.heading, target, dt * 10);
  } else {
    s.x = ax;
    s.z = az;
  }
}

export function turnTo(cur: number, target: number, maxStep: number) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

function atGoal(g: Game, s: Settler, act: { to: number; adj: boolean }) {
  if (s.node === act.to) return true;
  if (!act.adj) return false;
  const w = g.world;
  return Math.abs(w.nx(s.node) - w.nx(act.to)) <= 1 && Math.abs(w.ny(s.node) - w.ny(act.to)) <= 1;
}

/**
 * Nodes the path finder may have searched in one step before a soldier starts a new walk: an army
 * ordered at once (all of them in one tick, each search ~1,000 nodes on a long march) then walks off
 * over a few ticks instead of searching 50-70 paths in one (15-19 ms on a fast machine). A count, so
 * every machine in a game with a friend holds back the same men.
 */
const SOLDIER_PATH_BUDGET = 12000;

/** Runs the current action. Returns false if the plan failed. */
function runAction(g: Game, s: Settler, dt: number): boolean {
  const act = s.actions[0];
  if (!act) return true;
  switch (act.k) {
    case 'walk': {
      if (!act.started) {
        if (s.next >= 0) return true; // finish current step first
        // (the step has searched enough: he sets off on a later one)
        if (isSoldier(s) && g.path.expansions - g.pathMark > SOLDIER_PATH_BUDGET) return true;
        act.started = true;
        if (atGoal(g, s, act)) {
          s.actions.shift();
          return true;
        }
        const p = g.path.find(s.node, act.to, act.adj);
        if (!p) return false;
        s.path = p;
        s.pathI = 0;
        s.anim = 'walk';
      }
      if (s.next < 0 && (!s.path || s.pathI >= s.path.length)) {
        if (atGoal(g, s, act)) {
          s.actions.shift();
          s.path = null;
          s.anim = 'idle';
        } else {
          act.tries = (act.tries ?? 0) + 1;
          if (act.tries > 3) return false;
          act.started = false;
        }
      }
      return true;
    }
    case 'anim': {
      if (s.next >= 0) return true;
      if (act.t === undefined) {
        act.t = 0;
        s.anim = act.anim;
        s.animT = 0;
        if (act.face !== undefined && act.face !== s.node) {
          const w = g.world;
          s.heading = atan2(w.nx(act.face) - w.nx(s.node), w.ny(act.face) - w.ny(s.node));
        }
      }
      act.t += dt;
      if (act.tick) act.tick(act.t);
      if (act.t >= act.dur) {
        s.actions.shift();
        s.anim = 'idle';
      }
      return true;
    }
    case 'wait': {
      if (s.next >= 0) return true;
      act.t = (act.t ?? 0) + dt;
      if (act.t >= act.dur) s.actions.shift();
      return true;
    }
    case 'do': {
      if (s.next >= 0) return true;
      s.actions.shift();
      const r = act.fn();
      if (r === false) return false;
      return true;
    }
  }
  return true;
}

export function updateSettler(g: Game, s: Settler, dt: number) {
  // held fast by Winter's Grasp: no step, no blow, no thought, not even the swing of an arm
  if (g.time < s.frozenUntil && !s.dead) return;
  s.animT += dt;
  if (s.dead) {
    s.deadT += dt;
    if (s.deadT > 5) g.settlers.delete(s.id);
    return;
  }
  if (s.aboard) return; // the ship moves them
  if (s.hidden) {
    // inside building: only process actions (waiting, etc.)
    if (s.actions.length) {
      if (!runAction(g, s, dt)) abortPlan(g, s);
    } else think(g, s, dt);
    return;
  }
  if (isSoldier(s)) {
    if (soldierUpdate(g, s, dt)) {
      updateMovement(g, s, dt);
      return;
    }
  }
  if (s.actions.length) {
    if (!runAction(g, s, dt)) abortPlan(g, s);
    // a completed plan drops its abort handler
    if (!s.actions.length) s.onAbort = null;
  } else {
    think(g, s, dt);
    // nothing to do: make sure he is not standing on someone else's spot
    if (!s.actions.length) unstack(g, s, dt);
  }
  updateMovement(g, s, dt);
  if (s.next < 0 && s.anim === 'walk' && (!s.path || s.pathI >= s.path.length)) s.anim = 'idle';
}

function think(g: Game, s: Settler, dt: number) {
  if (isSoldier(s)) return; // handled in soldierUpdate
  if (s.job === 'carrier') return idleWander(g, s, dt);
  if (s.job === 'builder') return builderThink(g, s, dt);
  if (s.job === 'digger') return diggerThink(g, s, dt);
  if (s.job === 'pioneer') return pioneerThink(g, s, dt);
  if (s.job === 'donkey') return donkeyThink(g, s, dt);
  if (s.job === 'catapult') return catapultThink(g, s, dt);
  // specialist worker
  if (s.home) {
    const b = g.buildings.get(s.home);
    if (!b || b.state === 'burning' || b.owner !== s.owner) {
      s.home = 0;
    } else if (b.state === 'done') {
      if (s.inside !== b.id) {
        plan(s, [A.walk(b.door), A.do(() => { enter(g, s, b); })]);
        return;
      }
      workerThink(g, s, b);
      return;
    }
  }
  idleWander(g, s, dt);
}

export function idleWander(g: Game, s: Settler, dt: number) {
  s.idle = true;
  if (s.hidden) {
    // idle while inside a storage? leave it
    exit(g, s);
    return;
  }
  s.wanderT -= dt;
  if (s.wanderT > 0) return;
  s.wanderT = g.rng.range(5, 14);
  const w = g.world;
  // hang around nearest storage / residence
  let base = g.nearestStorage(s.owner, s.x, s.z, g.world.region[s.node]);
  if (!base) {
    s.anim = 'idle';
    return;
  }
  const bx = w.nx(base.door), by = w.ny(base.door);
  const d = hypot(s.x - bx, s.z - by);
  const R = d > 9 ? 3 : 6;
  for (let k = 0; k < 6; k++) {
    const tx = bx + g.rng.int(-R, R + 1), ty = by + g.rng.int(-R + 1, R + 2);
    if (!w.inBounds(tx, ty)) continue;
    const ti = w.idx(tx, ty);
    if (!parkable(g, s, ti) || w.owner[ti] !== s.owner) continue;
    park(g, s, ti);
    return;
  }
}

// ------------------------------------------------------------------ parking
// Settlers walk through one another, but one standing about looks for a spot of his own, and one
// who finds someone else standing where he is steps aside onto a free node beside it.

/** Who stands on each node and where walkers are bound. Rebuilt at the start of every step by `markSpots`. */
export class Spots {
  /** the settler who keeps the node: someone busy there before anyone idling, a guard before a loafer */
  stand: Int32Array;
  /** how many settlers stand on the node (capped) */
  crowd: Uint8Array;
  /** a settler whose walk ends on the node */
  dest: Int32Array;
  marks: number[] = [];
  constructor(n: number) {
    this.stand = new Int32Array(n);
    this.crowd = new Uint8Array(n);
    this.dest = new Int32Array(n);
  }
}

/** How firmly a settler holds the node he stands on: busy > guard at his post > idle. */
const keep = (s: Settler) => (s.actions.length ? 2 : s.sstate === 'hold' && isCombatant(s) ? 1 : 0);

export function markSpots(g: Game) {
  const sp = g.spots;
  const { stand, crowd, dest, marks } = sp;
  for (let k = 0; k < marks.length; k++) {
    const i = marks[k];
    stand[i] = 0;
    crowd[i] = 0;
    dest[i] = 0;
  }
  marks.length = 0;
  for (const s of g.settlers.values()) {
    if (s.hidden || s.dead || s.aboard) continue;
    if (s.next < 0) {
      const i = s.node;
      if (!crowd[i]) {
        stand[i] = s.id;
        marks.push(i);
      } else {
        const o = g.settlers.get(stand[i]);
        if (!o || keep(s) > keep(o)) stand[i] = s.id;
      }
      if (crowd[i] < 255) crowd[i]++;
    }
    let to = -1;
    if (s.path && s.pathI < s.path.length) to = s.path[s.path.length - 1];
    else if (s.actions[0]?.k === 'walk') to = s.actions[0].to;
    if (to >= 0 && !dest[to]) {
      dest[to] = s.id;
      marks.push(to);
    }
  }
}

/** Nobody but `id` stands on node i or is walking there. */
export function spotFree(g: Game, i: number, id: number) {
  const sp = g.spots;
  const c = sp.crowd[i];
  return (c === 0 || (c === 1 && sp.stand[i] === id)) && (sp.dest[i] === 0 || sp.dest[i] === id);
}

/** A free node on s's landmass that is fit to stand about on: open ground, off doors and footprints, not inside a tree (unless `trees`). */
export function parkable(g: Game, s: Settler, i: number, trees = false) {
  const w = g.world;
  return w.walkable(i) && !w.building[i] && !w.reserve[i] && (trees || !w.tree[i]) && w.region[i] === w.region[s.node] && spotFree(g, i, s.id);
}

/** Book node i for settler `id`, so nobody else picks it before his walk there shows up in the next `markSpots`. */
export function book(g: Game, i: number, id: number) {
  const sp = g.spots;
  if (sp.dest[i]) return;
  sp.dest[i] = id;
  sp.marks.push(i);
}

/** Book node i for s and walk there. */
export function park(g: Game, s: Settler, i: number) {
  book(g, i, s.id);
  s.actions.push(A.walk(i));
}

/** The free node within `r` steps of `c` (and no further than `maxD` from it) nearest to s, or -1. */
export function freeSpotNear(g: Game, s: Settler, c: number, r: number, maxD = Infinity, trees = false) {
  const w = g.world;
  const cx = w.nx(c), cy = w.ny(c);
  const m2 = maxD * maxD;
  let best = -1, bd = Infinity;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!w.inBounds(x, y) || sq(x - cx) + sq(y - cy) > m2) continue;
      const i = w.idx(x, y);
      if (i === c || !parkable(g, s, i, trees)) continue;
      const d = sq(x - s.x) + sq(y - s.z);
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

/** An idle settler sharing his node with another steps onto a free one beside it (a guard makes that his post). */
function unstack(g: Game, s: Settler, dt: number) {
  if (s.hidden || s.dead || s.aboard || s.next >= 0 || s.engaged) return;
  const sp = g.spots, i = s.node;
  if (sp.crowd[i] < 2 || sp.stand[i] === s.id) return;
  const w = g.world;
  // look up a few times a second, each at his own moment, so a crowd does not break up in lockstep
  // (but clear a doorway at once)
  const ph = s.seed * 3;
  if (!w.reserve[i] && Math.floor(g.time * 3 + ph) === Math.floor((g.time - dt) * 3 + ph)) return;
  const x = w.nx(i), y = w.ny(i);
  const k0 = s.id & 7; // each starts looking in his own direction, so they spread out
  for (let ring = 1; ring <= 2; ring++) {
    for (let k = 0; k < 8; k++) {
      const d = (k0 + k) & 7;
      const tx = x + DX8[d] * ring, ty = y + DY8[d] * ring;
      if (!w.inBounds(tx, ty)) continue;
      const ti = w.idx(tx, ty);
      if (!parkable(g, s, ti)) continue;
      if (s.sstate === 'hold' && isCombatant(s)) {
        s.order = ti;
        book(g, ti, s.id);
      } else park(g, s, ti);
      return;
    }
  }
}

/** Prepare an idle settler for a new job assignment. */
export function claim(g: Game, s: Settler) {
  if (s.actions.length) abortPlan(g, s);
  s.idle = false;
  s.order = -1;
  if (s.inside) exit(g, s);
}
