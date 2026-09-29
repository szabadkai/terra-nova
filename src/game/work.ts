// Outdoor worker behaviours (gatherers). Indoor production is handled in economy.ts.
import { T_DIRT, T_FOREST, T_GRASS, T_MEADOW, T_ROCK, T_SAND, T_SNOW } from './defs';
import type { Game } from './game';
import { OUT_CAP } from './game';
import { A, enter, exit, plan } from './settlers';
import type { Building, Settler, Tree } from './types';
import { DX8, DY8, WATER_LEVEL } from './world';
import { shipwrightThink } from './sea';
import { setStall, setStatus } from './status';
import { huntable } from './wildlife';
import { atan2, cos, hypot, sin, sq } from '../core/fmath';

function outFull(b: Building) {
  let n = 0;
  for (const o of b.def.outputs ?? []) n += b.stock[o];
  return n >= OUT_CAP;
}

function alive(g: Game, b: Building) {
  return g.buildings.has(b.id) && b.state === 'done';
}

export function returnHome(g: Game, s: Settler, b: Building, deposit: boolean) {
  return [
    A.walk(b.door),
    A.do(() => {
      if (!alive(g, b) || b.owner !== s.owner) return false;
      enter(g, s, b);
      if (deposit && s.carrying) {
        // a second of the same in his pack (a deer is two meat) goes on the pile too, if there is room
        const k = s.pack === s.carrying && b.stock[s.carrying] < OUT_CAP - 1 ? 2 : 1;
        b.stock[s.carrying] += k;
        g.players[b.owner].produced[s.carrying] += k;
        b.prodCount += k;
        b.lastProd = g.time;
        g.emit({ type: 'produced', b: b.id, good: s.carrying, x: b.cx, z: b.cz });
      }
      s.carrying = s.pack = null;
    }),
  ];
}

export function workerThink(g: Game, s: Settler, b: Building) {
  if (b.paused) {
    setStatus(b, 'Paused');
    plan(s, [A.wait(2)]);
    return;
  }
  switch (b.type) {
    case 'woodcutter': return woodcutter(g, s, b);
    case 'forester': return forester(g, s, b);
    case 'stonecutter': return stonecutter(g, s, b);
    case 'fisher': return fisher(g, s, b);
    case 'hunter': return hunter(g, s, b);
    case 'farm': return farmer(g, s, b);
    case 'waterworks': return waterman(g, s, b);
    case 'vineyard': return vintner(g, s, b);
    case 'shipyard': return shipwrightThink(g, s, b);
    default:
      // indoor workers simply stay inside
      plan(s, [A.wait(1.5)]);
  }
}

function woodcutter(g: Game, s: Settler, b: Building) {
  if (outFull(b)) { setStall(g, b, { kind: 'full' }); plan(s, [A.wait(3)]); return; }
  const w = g.world;
  const R = b.def.radius!;
  let best: Tree | null = null, bd = Infinity;
  w.forRadius(b.cx, b.cz, R, (i, _x, _y, d2) => {
    const tid = w.tree[i];
    if (!tid) return;
    const t = g.trees.get(tid);
    if (!t || t.state !== 'mature' || t.reserved) return;
    if (w.owner[i] !== b.owner && w.owner[i] !== -1) return;
    if (w.region[i] !== w.region[b.door]) return;
    if (d2 < bd) { bd = d2; best = t; }
  });
  if (!best) { setStall(g, b, { kind: 'range', lack: 'trees' }); plan(s, [A.wait(5)]); return; }
  const tree: Tree = best;
  tree.reserved = true;
  setStatus(b, 'Felling trees');
  let felled = false;
  plan(s, [
    A.do(() => { exit(g, s); }),
    A.walk(tree.node, true),
    A.anim('chop', 4.2, tree.node, (t) => {
      if (Math.floor(t / 0.7) !== Math.floor((t - 0.05) / 0.7)) g.emit({ type: 'chop', x: w.nx(tree.node), z: w.ny(tree.node) });
    }),
    A.do(() => {
      if (!g.trees.has(tree.id)) return false;
      tree.state = 'falling';
      tree.timer = 0;
      tree.fallDir = atan2(w.nx(tree.node) - s.x, w.ny(tree.node) - s.z);
      felled = true;
      g.treesVersion++;
      g.emit({ type: 'treefall', x: w.nx(tree.node), z: w.ny(tree.node) });
    }),
    A.wait(1.8),
    A.anim('chop', 1.6, tree.node),
    A.do(() => {
      g.removeTree(tree);
      s.carrying = 'log';
    }),
    ...returnHome(g, s, b, true),
    A.wait(2.5),
  ], () => {
    if (!felled) tree.reserved = false;
    else if (g.trees.has(tree.id)) g.removeTree(tree);
    s.carrying = null;
  });
}

/** Can a sapling (forTree) or a field be planted at node i? Open ground, off paths, clear of buildings. */
export function plantable(g: Game, i: number, forTree: boolean) {
  const w = g.world;
  if (!w.walkable(i) || w.tree[i] || w.stone[i] || w.building[i] || w.reserve[i] || w.field[i]) return false;
  const t = w.terrain[i];
  if (t === T_ROCK || t === T_SNOW) return false;
  if (!forTree && t === T_SAND) return false;
  if (w.h[i] < WATER_LEVEL + 0.2) return false;
  if (w.wear[i] > 0.35) return false;
  // keep away from buildings footprints
  const x = w.nx(i), y = w.ny(i);
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (!w.inBounds(nx, ny)) return false;
    const ni = w.idx(nx, ny);
    if (w.building[ni] || w.reserve[ni]) return false;
    if (forTree && w.tree[ni] && d < 4) return false;
  }
  return true;
}

/** What grows at a spot: palms on the sand, pines up high, now and then a fruit tree on a meadow. */
function pickSpecies(g: Game, t: number, hh: number) {
  if (t === T_SAND) return 3;
  if (hh > 3.2) return 1;
  if (t === T_MEADOW && g.rng.chance(0.3)) return 4;
  return g.rng.pick([0, 0, 1, 2]);
}
export function treeSpecies(g: Game, i: number) {
  return pickSpecies(g, g.world.terrain[i], g.world.h[i] - WATER_LEVEL);
}

function forester(g: Game, s: Settler, b: Building) {
  const w = g.world;
  const R = b.def.radius!;
  let spot = -1;
  for (let k = 0; k < 30; k++) {
    const a = g.rng.range(0, Math.PI * 2), r = g.rng.range(2.5, R);
    const x = Math.round(b.cx + cos(a) * r), y = Math.round(b.cz + sin(a) * r);
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    if (w.owner[i] !== b.owner || w.region[i] !== w.region[b.door]) continue;
    if (plantable(g, i, true)) { spot = i; break; }
  }
  if (spot < 0) { setStall(g, b, { kind: 'range', lack: 'space' }, 'No space to plant'); plan(s, [A.wait(6)]); return; }
  setStatus(b, 'Planting trees');
  const t = w.terrain[spot];
  const hh = w.h[spot] - WATER_LEVEL;
  plan(s, [
    A.do(() => { exit(g, s); }),
    A.walk(spot, true),
    A.anim('plant', 2.6, spot),
    A.do(() => {
      if (!plantable(g, spot, true)) return;
      g.addTree(spot, pickSpecies(g, t, hh), 0.05);
      g.emit({ type: 'plant', x: w.nx(spot), z: w.ny(spot) });
      b.prodCount++;
    }),
    ...returnHome(g, s, b, false),
    A.wait(5),
  ]);
}

function stonecutter(g: Game, s: Settler, b: Building) {
  if (outFull(b)) { setStall(g, b, { kind: 'full' }); plan(s, [A.wait(3)]); return; }
  const w = g.world;
  let best = null as import('./types').Stone | null, bd = Infinity;
  for (const st of g.stones.values()) {
    if (st.amount - st.reserved <= 0) continue;
    if (w.region[st.node] !== w.region[b.door]) continue;
    const x = w.nx(st.node), y = w.ny(st.node);
    const d2 = sq(x - b.cx) + sq(y - b.cz);
    if (d2 > sq(b.def.radius!)) continue;
    if (d2 < bd) { bd = d2; best = st; }
  }
  if (!best) { setStall(g, b, { kind: 'range', lack: 'rocks' }); plan(s, [A.wait(5)]); return; }
  const stone = best;
  stone.reserved++;
  setStatus(b, 'Cutting stone');
  let done = false;
  plan(s, [
    A.do(() => { exit(g, s); }),
    A.walk(stone.node, true),
    A.anim('pick', 5, stone.node, (t) => {
      if (Math.floor(t / 0.62) !== Math.floor((t - 0.05) / 0.62)) g.emit({ type: 'stonehit', x: w.nx(stone.node), z: w.ny(stone.node) });
    }),
    A.do(() => {
      if (!g.stones.has(stone.id)) return false;
      stone.reserved--;
      done = true;
      stone.amount--;
      g.stonesVersion++;
      if (stone.amount <= 0) g.removeStone(stone);
      s.carrying = 'stone';
    }),
    ...returnHome(g, s, b, true),
    A.wait(2),
  ], () => {
    if (!done && g.stones.has(stone.id)) stone.reserved--;
    s.carrying = null;
  });
}

function shoreSpot(g: Game, b: Building, R: number, needFish: boolean): { land: number; water: number } | null {
  const w = g.world;
  let best: { land: number; water: number } | null = null, bd = Infinity;
  w.forRadius(b.cx, b.cz, R, (i, x, y, d2) => {
    if (!w.walkable(i) || w.building[i]) return;
    if (w.owner[i] !== b.owner || w.region[i] !== w.region[b.door]) return;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (!w.inBounds(nx, ny)) continue;
      const ni = w.idx(nx, ny);
      if (!w.isWater(ni)) continue;
      let fishy = 0;
      if (needFish) {
        // look a bit into the water for fish
        for (let k = 1; k <= 3; k++) {
          const fx = x + DX8[d] * k, fy = y + DY8[d] * k;
          if (!w.inBounds(fx, fy)) break;
          const fi = w.idx(fx, fy);
          if (w.isWater(fi) && w.fish[fi] > 0) { fishy = fi; break; }
        }
        if (!fishy) continue;
      }
      const score = d2 + g.rng.next() * 12;
      if (score < bd) { bd = score; best = { land: i, water: needFish ? fishy : ni }; }
      break;
    }
  });
  return best;
}

function fisher(g: Game, s: Settler, b: Building) {
  if (outFull(b)) { setStall(g, b, { kind: 'full' }); plan(s, [A.wait(3)]); return; }
  const spot = shoreSpot(g, b, b.def.radius!, true);
  if (!spot) { setStall(g, b, { kind: 'range', lack: 'fish' }); plan(s, [A.wait(6)]); return; }
  setStatus(b, 'Fishing');
  const w = g.world;
  let caught = false;
  plan(s, [
    A.do(() => { exit(g, s); }),
    A.walk(spot.land),
    A.anim('fish', 6.5, spot.water, (t) => { if (t < 0.05) g.emit({ type: 'cast', x: w.nx(spot.water), z: w.ny(spot.water) }); }),
    A.do(() => {
      if (w.fish[spot.water] > 0 && g.rng.chance(0.75)) {
        w.fish[spot.water]--;
        s.carrying = 'fish';
        caught = true;
        g.emit({ type: 'splash', x: w.nx(spot.water), z: w.ny(spot.water) });
      }
    }),
    ...returnHome(g, s, b, true),
    A.wait(2),
  ], () => { s.carrying = null; void caught; });
}

function hunter(g: Game, s: Settler, b: Building) {
  if (outFull(b)) { setStall(g, b, { kind: 'full' }); plan(s, [A.wait(3)]); return; }
  const w = g.world;
  let best = null as import('./types').Animal | null, bd = Infinity;
  for (const a of g.animals.values()) {
    if (!huntable(a) || w.region[a.node] !== w.region[b.door]) continue;
    const d2 = sq(a.x - b.cx) + sq(a.z - b.cz);
    if (d2 > sq(b.def.radius!)) continue;
    // the nearest, but a deer (two meat) is worth a longer walk
    const score = a.kind === 'deer' ? d2 * 0.5 : d2;
    if (score < bd) { bd = score; best = a; }
  }
  if (!best) { setStall(g, b, { kind: 'range', lack: 'game' }); plan(s, [A.wait(8)]); return; }
  const deer = best;
  deer.reserved = true;
  setStatus(b, 'Hunting');
  let shot = false;
  const approach = () => A.do(() => {
    if (!deer.alive) return;
    const d = hypot(deer.x - s.x, deer.z - s.z);
    if (d > 5.5) {
      // re-target: insert walk in front
      s.actions.unshift(A.walk(deer.node, true), approachAgain());
    }
  });
  let tries = 0;
  const approachAgain = (): import('./types').Action => A.do(() => {
    tries++;
    if (tries > 6) return false;
    const d = hypot(deer.x - s.x, deer.z - s.z);
    if (d > 5.5 && deer.alive) s.actions.unshift(A.walk(deer.node, true), approachAgain());
  });
  plan(s, [
    A.do(() => { exit(g, s); }),
    A.walk(deer.node, true),
    approach(),
    A.do(() => {
      // face and shoot
      if (!deer.alive) return;
      s.heading = atan2(deer.x - s.x, deer.z - s.z);
    }),
    A.anim('shoot', 1.3),
    A.do(() => {
      if (!g.animals.has(deer.id)) return false;
      const sy = w.heightAt(s.x, s.z) + 0.45, ty = w.heightAt(deer.x, deer.z) + 0.35;
      g.projectiles.push({
        id: g.id(), owner: s.owner, sx: s.x, sy, sz: s.z, tx: deer.x, ty, tz: deer.z,
        t: 0, dur: Math.max(0.25, hypot(deer.x - s.x, deer.z - s.z) * 0.07), target: -deer.id, damage: 999, kind: 'arrow',
      });
      shot = true;
    }),
    A.wait(0.8),
    A.do(() => {
      if (!g.animals.has(deer.id)) return false;
      deer.alive = false;
      deer.next = -1;
      deer.path = null;
    }),
    A.walk(deer.node, true),
    A.anim('pick', 2, deer.node),
    A.do(() => {
      g.animals.delete(deer.id);
      s.carrying = 'meat';
      if (deer.kind === 'deer') s.pack = 'meat';
    }),
    ...returnHome(g, s, b, true),
    A.wait(3),
  ], () => {
    if (!shot) deer.reserved = false;
    s.carrying = s.pack = null;
  });
}

function farmer(g: Game, s: Settler, b: Building) {
  const w = g.world;
  const R = b.def.radius! + b.size / 2;
  // ripe field?
  let ripe = null as import('./types').Field | null, rd = Infinity;
  let count = 0;
  for (const f of g.fields.values()) {
    if (f.farm !== b.id) continue;
    count++;
    if (f.growth >= 1 && !f.reserved) {
      const d2 = sq(w.nx(f.node) - b.cx) + sq(w.ny(f.node) - b.cz);
      if (d2 < rd) { rd = d2; ripe = f; }
    }
  }
  if (ripe && !outFull(b)) {
    const f = ripe;
    f.reserved = true;
    setStatus(b, 'Harvesting');
    plan(s, [
      A.do(() => { exit(g, s); }),
      A.walk(f.node),
      A.anim('harvest', 3.2, f.node, (t) => { if (t < 0.05) g.emit({ type: 'harvest', x: w.nx(f.node), z: w.ny(f.node) }); }),
      A.do(() => {
        if (!g.fields.has(f.id)) return false;
        g.removeField(f);
        s.carrying = 'grain';
      }),
      ...returnHome(g, s, b, true),
      A.wait(1.5),
    ], () => { if (g.fields.has(f.id)) f.reserved = false; s.carrying = null; });
    return;
  }
  if (count < 14) {
    let spot = -1, sd = Infinity;
    w.forRadius(b.cx, b.cz, R, (i, x, y, d2) => {
      if (w.owner[i] !== b.owner || w.region[i] !== w.region[b.door]) return;
      const t = w.terrain[i];
      if (t !== T_GRASS && t !== T_MEADOW && t !== T_DIRT && t !== T_FOREST) return;
      if (!plantable(g, i, false)) return;
      const sc = d2 + g.rng.next() * 3;
      if (sc < sd) { sd = sc; spot = i; }
    });
    if (spot >= 0) {
      setStatus(b, 'Sowing');
      plan(s, [
        A.do(() => { exit(g, s); }),
        A.walk(spot),
        A.anim('plant', 2.2, spot),
        A.do(() => {
          if (!plantable(g, spot, false) && !(g.world.walkable(spot) && !w.field[spot])) return;
          if (w.field[spot]) return;
          g.addField(spot, b.owner, b.id);
        }),
        ...returnHome(g, s, b, false),
        A.wait(1.5),
      ]);
      return;
    }
  }
  if (count) setStatus(b, 'Waiting for the grain to ripen');
  else setStall(g, b, { kind: 'range', lack: 'space' }, 'No space for fields');
  plan(s, [A.wait(3)]);
}

function vintner(g: Game, s: Settler, b: Building) {
  const w = g.world;
  const R = b.def.radius! + b.size / 2;
  let ripe = null as import('./types').Field | null, rd = Infinity;
  let count = 0;
  for (const f of g.fields.values()) {
    if (f.farm !== b.id) continue;
    count++;
    if (f.growth >= 1 && !f.reserved) {
      const d2 = sq(w.nx(f.node) - b.cx) + sq(w.ny(f.node) - b.cz);
      if (d2 < rd) { rd = d2; ripe = f; }
    }
  }
  if (ripe && !outFull(b)) {
    // pick the grapes; the vine stays and fruits again
    const f = ripe;
    f.reserved = true;
    setStatus(b, 'Picking grapes');
    plan(s, [
      A.do(() => { exit(g, s); }),
      A.walk(f.node, true),
      A.anim('harvest', 3.6, f.node, (t) => { if (t < 0.05) g.emit({ type: 'grapes', x: w.nx(f.node), z: w.ny(f.node) }); }),
      A.do(() => {
        if (!g.fields.has(f.id)) return false;
        f.growth = 0.3;
        f.reserved = false;
        g.fieldsVersion++;
        s.carrying = 'wine';
      }),
      ...returnHome(g, s, b, true),
      A.wait(2.5),
    ], () => { if (g.fields.has(f.id)) f.reserved = false; s.carrying = null; });
    return;
  }
  if (count < 10) {
    // vines go in rows: every other column around the press house
    let spot = -1, sd = Infinity;
    w.forRadius(b.cx, b.cz, R, (i, x, y, d2) => {
      if (w.owner[i] !== b.owner || (x & 1) || w.region[i] !== w.region[b.door]) return;
      const t = w.terrain[i];
      if (t !== T_GRASS && t !== T_MEADOW && t !== T_DIRT) return;
      if (!plantable(g, i, false)) return;
      const sc = d2 + g.rng.next() * 2;
      if (sc < sd) { sd = sc; spot = i; }
    });
    if (spot >= 0) {
      setStatus(b, 'Planting vines');
      plan(s, [
        A.do(() => { exit(g, s); }),
        A.walk(spot, true),
        A.anim('plant', 2.6, spot),
        A.do(() => {
          if (w.field[spot] || !plantable(g, spot, false)) return;
          g.addField(spot, b.owner, b.id, 'vine');
          g.emit({ type: 'plant', x: w.nx(spot), z: w.ny(spot) });
        }),
        ...returnHome(g, s, b, false),
        A.wait(1.5),
      ]);
      return;
    }
  }
  if (count) setStatus(b, 'Waiting for the grapes to ripen');
  else setStall(g, b, { kind: 'range', lack: 'space' }, 'No space for vines');
  plan(s, [A.wait(3)]);
}

function waterman(g: Game, s: Settler, b: Building) {
  if (outFull(b)) { setStall(g, b, { kind: 'full' }); plan(s, [A.wait(3)]); return; }
  const spot = shoreSpot(g, b, b.def.radius!, false);
  if (!spot) { setStall(g, b, { kind: 'range', lack: 'water' }); plan(s, [A.wait(6)]); return; }
  setStatus(b, 'Drawing water');
  const w = g.world;
  plan(s, [
    A.do(() => { exit(g, s); }),
    A.walk(spot.land),
    A.anim('fill', 2.2, spot.water, (t) => { if (t < 0.05) g.emit({ type: 'splash', x: w.nx(spot.water), z: w.ny(spot.water) }); }),
    A.do(() => { s.carrying = 'water'; }),
    ...returnHome(g, s, b, true),
    A.wait(1.5),
  ], () => { s.carrying = null; });
}

void T_FOREST;
