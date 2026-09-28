// Economy: logistics dispatch, construction, worker recruitment, production.
import {
  BUILDINGS, FOODS, GOODS, GOOD_NAMES, Good, JOB_TOOL, Job, MINE_ORE, TOOLS, WEAPONS,
} from './defs';
import type { Game } from './game';
import { OUT_CAP } from './game';
import { A, abortPlan, claim, enter, exit, plan } from './settlers';
import type { Building, Settler } from './types';
import { recomputeTerritory, isSoldier, sendSoldierTo } from './military';
import { offer } from './faith';

const SITE_DIGGERS = (b: Building) => (b.size >= 4 ? 3 : b.size >= 3 ? 2 : 1);
const SITE_BUILDERS = (b: Building) => (b.size >= 4 ? 3 : b.size >= 3 ? 2 : 1);

function dist2(ax: number, az: number, bx: number, bz: number) {
  return (ax - bx) ** 2 + (az - bz) ** 2;
}

/** Landmass a building's door stands on; carriers never cross water. */
const reg = (g: Game, b: Building) => g.world.region[b.door];
const regS = (g: Game, s: Settler) => g.world.region[s.node];

// ------------------------------------------------------------------ building tick
export function updateBuilding(g: Game, b: Building, dt: number) {
  if (b.state === 'burning') {
    b.burnT += dt;
    if (b.burnT > 12) g.finalRemove(b);
    return;
  }
  if (b.underAttackT > 0) b.underAttackT -= dt;
  if (b.state === 'leveling') {
    if (b.levelTotal < 0.06) {
      g.finishLeveling(b);
    }
    return;
  }
  if (b.state === 'building') {
    if (b.buildWork >= b.buildTotal) {
      b.state = 'done';
      onBuildingComplete(g, b, false);
    }
    return;
  }
  // done
  if (b.def.residence) {
    if (b.spawned < b.def.residence) {
      b.spawnT += dt;
      if (b.spawnT > 9) {
        b.spawnT = 0;
        b.spawned++;
        const s = g.addSettler(b.owner, 'carrier', b.door);
        g.syncPos(s);
        g.emit({ type: 'spawn', x: s.x, z: s.z, owner: b.owner });
      }
    }
    b.status = b.spawned < b.def.residence ? `Settlers moving in (${b.spawned}/${b.def.residence})` : 'Fully occupied';
    return;
  }
  updateProduction(g, b, dt);
}

export function onBuildingComplete(g: Game, b: Building, instant: boolean) {
  b.status = '';
  for (const id of [...b.builders, ...b.diggers]) {
    const s = g.settlers.get(id);
    if (s && s.home === b.id) s.home = 0;
  }
  b.builders = [];
  b.diggers = [];
  if (b.def.military) {
    b.desiredSoldiers = b.def.military.capacity;
    if (b.type === 'hq') b.occupied = true;
  }
  if (!instant) {
    g.emit({ type: 'built', b: b.id, x: b.cx, z: b.cz, owner: b.owner });
    g.message(b.owner, `${b.def.name} completed`, b.cx, b.cz, 'good');
  }
  g.world.splatDirty = true;
  if (b.def.military) g.territoryDirty = true;
}

// ------------------------------------------------------------------ production
function hasInput(b: Building, goods: Good[]) {
  for (const gd of goods) if (b.stock[gd] > 0) return true;
  return false;
}
function takeInput(b: Building, goods: Good[]): Good | null {
  let best: Good | null = null;
  for (const gd of goods) if (b.stock[gd] > 0 && (!best || b.stock[gd] > b.stock[best])) best = gd;
  if (best) b.stock[best]--;
  return best;
}

function chooseTool(g: Game, b: Building): Good {
  if (b.toolChoice !== 'auto') return b.toolChoice;
  const demand: Record<string, number> = {};
  for (const t of TOOLS) demand[t] = 0;
  for (const o of g.buildings.values()) {
    if (o.owner !== b.owner) continue;
    if (o.state === 'done' && o.def.worker && !o.worker && !o.workerIncoming) {
      const t = JOB_TOOL[o.def.worker];
      if (t && demand[t] !== undefined) demand[t] += 3;
    }
  }
  const stock = g.totalStock(b.owner);
  let best: Good = 'hammer', bv = -Infinity;
  const p = g.players[b.owner];
  for (const t of TOOLS) {
    const v = demand[t] * 2 - stock[t] + (p.toolPrio[t] ?? 1) * 0.5 + g.rng.next() * 0.4;
    if (v > bv) { bv = v; best = t; }
  }
  return best;
}

function updateProduction(g: Game, b: Building, dt: number) {
  const def = b.def;
  if (!def.cycle || b.type === 'barracks') {
    if (b.type === 'barracks') updateBarracks(g, b, dt);
    return;
  }
  if (b.paused) { b.status = 'Paused'; b.working = false; return; }
  if (def.worker) {
    const w = b.worker ? g.settlers.get(b.worker) : null;
    if (!w || w.inside !== b.id) {
      b.working = false;
      if (!b.worker) b.status = b.workerIncoming ? 'Worker on the way' : b.status || 'Waiting for worker';
      return;
    }
  }
  if (!b.working) {
    // choose output
    let out: Good | null;
    if (b.type === 'toolsmith') out = chooseTool(g, b);
    else if (b.type === 'weaponsmith') out = g.rng.next() < g.players[b.owner].swordRatio ? 'sword' : 'bow';
    else out = def.outputs?.[0] ?? null;
    let outCount = 0;
    for (const o of def.outputs ?? []) outCount += b.stock[o];
    if (outCount >= OUT_CAP) { b.status = 'Output storage full'; return; }
    for (const inp of def.inputs ?? []) {
      if (!hasInput(b, inp.goods)) {
        b.status = `Waiting for ${inp.goods.length > 1 ? 'food' : GOOD_NAMES[inp.goods[0]].toLowerCase()}`;
        return;
      }
    }
    if (def.mine) {
      if (g.mineOreLeft(b) <= 0) { b.status = 'Deposit exhausted'; return; }
    }
    for (const inp of def.inputs ?? []) takeInput(b, inp.goods);
    b.working = true;
    b.workT = 0;
    (b as any).curOut = out;
    b.status = def.mana ? 'Offering wine to the gods' : 'Working';
  } else {
    b.workT += dt;
    if (b.workT >= def.cycle) {
      b.working = false;
      if (def.mana) {
        offer(g, b);
        b.prodCount++;
        b.lastProd = g.time;
        return;
      }
      const out: Good = (b as any).curOut ?? def.outputs![0];
      if (def.mine) {
        // consume ore from a node in range
        const ore = MINE_ORE[def.mine];
        const w = g.world;
        let found = -1;
        w.forRadius(b.cx, b.cz, (def.radius ?? 3) + 0.5, (i) => {
          if (found < 0 && w.ore[i] === ore && w.oreAmt[i] > 0) found = i;
        });
        if (found >= 0) {
          w.oreAmt[found]--;
          if (w.oreAmt[found] === 0) w.ore[found] = 0;
          w.splatDirty = true;
          const n = def.mine === 'coal' ? 2 : 1;
          b.stock[out] += n;
          g.players[b.owner].produced[out] += n;
        }
      } else {
        b.stock[out]++;
        g.players[b.owner].produced[out]++;
      }
      b.prodCount++;
      b.lastProd = g.time;
      g.emit({ type: 'produced', b: b.id, good: out, x: b.cx, z: b.cz });
    }
  }
}

function updateBarracks(g: Game, b: Building, dt: number) {
  if (b.paused) { b.status = 'Paused'; return; }
  if (b.workerIncoming) { b.status = 'Recruit on the way'; return; }
  const sw = b.stock.sword - b.outgoing.sword, bw = b.stock.bow - b.outgoing.bow;
  if (sw <= 0 && bw <= 0) { b.status = 'Waiting for weapons'; return; }
  // find idle carrier (always keep a few carriers for transport)
  let best: Settler | null = null, bd = Infinity;
  let idleCount = 0;
  const r = reg(g, b);
  for (const s of g.settlers.values()) if (s.owner === b.owner && s.job === 'carrier' && s.idle && !s.dead && regS(g, s) === r) idleCount++;
  if (idleCount <= 4) { b.status = 'Keeping carriers for transport'; return; }
  for (const s of g.settlers.values()) {
    if (s.owner !== b.owner || s.job !== 'carrier' || !s.idle || s.dead || regS(g, s) !== r) continue;
    const d = dist2(s.x, s.z, b.cx, b.cz);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best) { b.status = 'No free settlers to recruit'; return; }
  const ratio = g.players[b.owner].swordRatio;
  const weapon: Good = sw > 0 && (bw <= 0 || g.rng.next() < ratio) ? 'sword' : 'bow';
  const s = best;
  claim(g, s);
  b.outgoing[weapon]++;
  b.workerIncoming = s.id;
  let taken = false;
  plan(s, [
    A.walk(b.door),
    A.do(() => {
      if (!g.buildings.has(b.id) || b.state !== 'done') return false;
      enter(g, s, b);
      b.stock[weapon]--;
      b.outgoing[weapon]--;
      taken = true;
      b.status = 'Training soldier';
    }),
    A.wait(b.def.cycle ?? 6),
    A.do(() => {
      b.workerIncoming = 0;
      s.job = weapon === 'sword' ? 'swordsman' : 'bowman';
      s.hp = s.maxHp = s.job === 'bowman' ? 80 : 100;
      s.sstate = 'idle';
      s.home = 0;
      exit(g, s);
      g.emit({ type: 'soldier', x: s.x, z: s.z, owner: s.owner });
      g.message(s.owner, `A new ${s.job} has been trained`, s.x, s.z, 'good');
      b.prodCount++;
    }),
  ], () => {
    if (!taken) b.outgoing[weapon]--;
    b.workerIncoming = 0;
  });
}

// ------------------------------------------------------------------ logistics
export interface Need { b: Building; goods: Good[]; n: number; prio: number; }

export function needsOf(g: Game, b: Building, out: Need[]) {
  if (b.state === 'burning') return;
  if (b.state === 'leveling' || b.state === 'building') {
    const cost = b.def.cost;
    const nb = cost.board - b.delivered.board - b.incoming.board;
    const ns = cost.stone - b.delivered.stone - b.incoming.stone;
    const prio = 100 - Math.min(90, (g.time - b.created) * 0.05);
    if (nb > 0) out.push({ b, goods: ['board'], n: nb, prio: prio - 1 });
    if (ns > 0) out.push({ b, goods: ['stone'], n: ns, prio });
    return;
  }
  if (b.state === 'done' && b.seaWant) {
    // a harbour gathers goods that ships will carry overseas
    for (const gd of GOODS) {
      const n = b.seaWant[gd] - b.stock[gd] - b.incoming[gd];
      if (n > 0) out.push({ b, goods: [gd], n: Math.min(n, 8), prio: 160 });
    }
  }
  if (b.state !== 'done' || b.paused || !b.def.inputs) return;
  for (const inp of b.def.inputs) {
    let have = 0;
    for (const gd of inp.goods) have += b.stock[gd] + b.incoming[gd];
    const n = inp.cap - have;
    if (n > 0) out.push({ b, goods: inp.goods, n, prio: 200 + have * 10 });
  }
}

function available(b: Building, gd: Good) {
  if (b.state !== 'done') return 0;
  if (b.def.storage) return b.stock[gd] - b.outgoing[gd];
  if (b.def.outputs && b.def.outputs.includes(gd)) return b.stock[gd] - b.outgoing[gd];
  return 0;
}
export const availableAt = available;

export function updateEconomy(g: Game, owner: number) {
  const carriers: Settler[] = [];
  for (const s of g.settlers.values()) {
    if (s.owner === owner && s.job === 'carrier' && s.idle && !s.dead && s.home === 0) carriers.push(s);
  }
  const mine: Building[] = [];
  for (const b of g.buildings.values()) if (b.owner === owner && b.state !== 'burning') mine.push(b);

  assignConstruction(g, owner, mine, carriers);
  assignWorkers(g, owner, mine, carriers);

  if (!carriers.length) return;
  const needs: Need[] = [];
  for (const b of mine) needsOf(g, b, needs);
  needs.sort((a, b) => a.prio - b.prio);

  const sources = mine.filter((b) => b.state === 'done' && (b.def.storage || b.def.outputs));
  let budget = 12;
  for (const need of needs) {
    if (!carriers.length || budget <= 0) break;
    const r = reg(g, need.b);
    for (let k = 0; k < need.n && carriers.length && budget > 0; k++) {
      // find nearest source on the same landmass
      let best: Building | null = null, bestG: Good | null = null, bd = Infinity;
      for (const src of sources) {
        if (src.id === need.b.id || reg(g, src) !== r) continue;
        // a harbour does not feed its own export pile back to itself
        if (need.b.type === 'harbour' && src.type === 'harbour' && need.prio === 160) continue;
        for (const gd of need.goods) {
          if (available(src, gd) <= 0) continue;
          let d = dist2(src.cx, src.cz, need.b.cx, need.b.cz);
          if (src.def.storage && need.b.def.storage) d += 1e6;
          if (d < bd) { bd = d; best = src; bestG = gd; }
        }
      }
      if (!best || !bestG) break;
      const c = nearestCarrier(carriers, best.cx, best.cz, g, r);
      if (!c) break;
      transport(g, c, best, need.b, bestG);
      budget--;
    }
  }
  // move surplus production to storage
  if (!carriers.length) return;
  for (const b of mine) {
    if (!carriers.length || budget <= 0) break;
    if (b.state !== 'done' || b.def.storage || !b.def.outputs) continue;
    for (const gd of b.def.outputs) {
      const av = available(b, gd);
      if (av < 3) continue;
      const st = g.nearestStorage(owner, b.cx, b.cz, reg(g, b));
      if (!st) break;
      const c = nearestCarrier(carriers, b.cx, b.cz, g, reg(g, b));
      if (!c) break;
      transport(g, c, b, st, gd);
      budget--;
    }
  }
}

function nearestCarrier(list: Settler[], x: number, z: number, g?: Game, region = 0): Settler | null {
  let bi = -1, bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    if (region && g && g.world.region[list[i].node] !== region) continue;
    const d = dist2(list[i].x, list[i].z, x, z);
    if (d < bd) { bd = d; bi = i; }
  }
  if (bi < 0) return null;
  const s = list[bi];
  list.splice(bi, 1);
  return s;
}

function isSite(b: Building) {
  return b.state === 'leveling' || b.state === 'building';
}

function transport(g: Game, s: Settler, from: Building, to: Building, gd: Good) {
  claim(g, s);
  from.outgoing[gd]++;
  to.incoming[gd]++;
  let picked = false;
  s.task = `Carrying ${gd}`;
  plan(s, [
    A.walk(from.door),
    A.anim('pick', 0.5, from.door),
    A.do(() => {
      if (!g.buildings.has(from.id) || from.stock[gd] <= 0 || from.state !== 'done') return false;
      from.stock[gd]--;
      from.outgoing[gd]--;
      picked = true;
      s.carrying = gd;
    }),
    A.walk(to.door),
    A.do(() => {
      const alive = g.buildings.has(to.id) && to.state !== 'burning' && to.owner === s.owner;
      if (!alive) return false;
      to.incoming[gd]--;
      if (isSite(to) && (gd === 'board' || gd === 'stone')) to.delivered[gd]++;
      else to.stock[gd]++;
      s.carrying = null;
      picked = false;
      s.task = '';
    }),
    A.anim('pick', 0.4),
  ], () => {
    if (!picked) from.outgoing[gd] = Math.max(0, from.outgoing[gd] - (g.buildings.has(from.id) ? 1 : 0));
    if (g.buildings.has(to.id)) to.incoming[gd] = Math.max(0, to.incoming[gd] - 1);
    if (picked && s.carrying) {
      // bring it back to a storage
      const st = g.nearestStorage(s.owner, s.x, s.z, regS(g, s));
      const good = s.carrying;
      s.carrying = good;
      if (st) {
        st.incoming[good]++;
        plan(s, [A.walk(st.door), A.do(() => {
          st.incoming[good]--;
          if (g.buildings.has(st.id)) st.stock[good]++;
          s.carrying = null;
        })], () => {
          if (g.buildings.has(st.id)) st.incoming[good] = Math.max(0, st.incoming[good] - 1);
          s.carrying = null;
        });
      } else s.carrying = null;
    }
    s.task = '';
  });
}

// ------------------------------------------------------------------ construction crew
function assignConstruction(g: Game, owner: number, mine: Building[], carriers: Settler[]) {
  const all = mine.filter(isSite).sort((a, b) => a.created - b.created);
  if (!all.length) return;
  // every landmass has its own crew
  const regions = new Set(all.map((b) => reg(g, b)));
  for (const r of regions) assignCrewIn(g, owner, all.filter((b) => reg(g, b) === r), carriers, r);
}

function assignCrewIn(g: Game, owner: number, sites: Building[], carriers: Settler[], r: number) {
  const idleBuilders: Settler[] = [];
  const idleDiggers: Settler[] = [];
  let totalBuilders = 0, totalDiggers = 0;
  for (const s of g.settlers.values()) {
    if (s.owner !== owner || s.dead || s.aboard || s.voyage || regS(g, s) !== r) continue;
    if (s.job === 'builder') { totalBuilders++; if (!s.home) idleBuilders.push(s); }
    if (s.job === 'digger') { totalDiggers++; if (!s.home) idleDiggers.push(s); }
  }
  let wantDiggers = 0, wantBuilders = 0;
  for (const b of sites) {
    b.diggers = b.diggers.filter((id) => { const s = g.settlers.get(id); return s && !s.dead && s.home === b.id; });
    b.builders = b.builders.filter((id) => { const s = g.settlers.get(id); return s && !s.dead && s.home === b.id; });
    if (b.state === 'leveling') {
      const want = SITE_DIGGERS(b);
      while (b.diggers.length < want) {
        const s = pickNearest(idleDiggers, b.cx, b.cz);
        if (!s) { wantDiggers += want - b.diggers.length; break; }
        s.home = b.id;
        s.idle = false;
        b.diggers.push(s.id);
        if (s.actions.length) { s.actions.length = 0; s.onAbort = null; }
      }
      b.status = b.diggers.length ? 'Levelling the ground' : 'Waiting for diggers';
    } else if (b.state === 'building') {
      const want = SITE_BUILDERS(b);
      while (b.builders.length < want) {
        const s = pickNearest(idleBuilders, b.cx, b.cz);
        if (!s) { wantBuilders += want - b.builders.length; break; }
        s.home = b.id;
        s.idle = false;
        b.builders.push(s.id);
        if (s.actions.length) { s.actions.length = 0; s.onAbort = null; }
      }
      const avail = b.delivered.board + b.delivered.stone - b.used;
      b.status = !b.builders.length ? 'Waiting for builders' : avail <= 0 && b.used < b.buildTotal ? 'Waiting for materials' : 'Under construction';
    }
  }
  // recruit extra crew from carriers with tools
  const recruit = (job: Job, want: number, total: number) => {
    let local = 0;
    for (const c of carriers) if (regS(g, c) === r) local++;
    if (want <= 0 || total >= 4 + sites.length * 1.5 || local < (total > 0 ? 2 : 1)) return;
    const tool = JOB_TOOL[job]!;
    const st = findToolSource(g, owner, tool, sites[0].cx, sites[0].cz, r);
    if (!st) return;
    // keep one tool in reserve for specialists (a lone island crew may use the last one)
    if (g.totalStock(owner)[tool] < 2 && total > 0) return;
    const c = nearestCarrier(carriers, st.cx, st.cz, g, r);
    if (!c) return;
    equip(g, c, st, tool, job, null);
  };
  recruit('digger', wantDiggers, totalDiggers);
  recruit('builder', wantBuilders, totalBuilders);
}

function pickNearest(list: Settler[], x: number, z: number): Settler | null {
  return nearestCarrier(list, x, z);
}

export function findToolSource(g: Game, owner: number, tool: Good, x: number, z: number, region = 0): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || b.state !== 'done') continue;
    if (region && reg(g, b) !== region) continue;
    if (available(b, tool) <= 0) continue;
    const d = dist2(b.cx, b.cz, x, z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Carrier walks to `src`, picks up a tool and becomes `job`; then optionally walks to `home`. */
function equip(g: Game, s: Settler, src: Building, tool: Good, job: Job, home: Building | null) {
  claim(g, s);
  src.outgoing[tool]++;
  if (home) home.workerIncoming = s.id;
  let taken = false;
  s.task = `Fetching ${tool}`;
  const acts = [
    A.walk(src.door),
    A.do(() => {
      if (!g.buildings.has(src.id) || src.stock[tool] <= 0) return false;
      src.stock[tool]--;
      src.outgoing[tool]--;
      taken = true;
      s.job = job;
      s.task = '';
      if (home) s.home = home.id;
      g.emit({ type: 'equip', x: s.x, z: s.z, owner: s.owner });
    }),
  ];
  if (home) {
    acts.push(A.walk(home.door));
    acts.push(A.do(() => {
      if (!g.buildings.has(home.id) || home.state !== 'done') return false;
      enter(g, s, home);
      home.worker = s.id;
      home.workerIncoming = 0;
      s.home = home.id;
    }));
  }
  plan(s, acts, () => {
    if (!taken && g.buildings.has(src.id)) src.outgoing[tool] = Math.max(0, src.outgoing[tool] - 1);
    if (home && home.workerIncoming === s.id) home.workerIncoming = 0;
    if (taken) s.home = 0; // becomes an unemployed specialist
    s.task = '';
  });
}

function assignWorkers(g: Game, owner: number, mine: Building[], carriers: Settler[]) {
  for (const b of mine) {
    if (b.state !== 'done' || !b.def.worker) continue;
    if (b.worker) {
      const w = g.settlers.get(b.worker);
      if (!w || w.dead || w.home !== b.id) b.worker = 0;
      else continue;
    }
    if (b.workerIncoming) {
      const w = g.settlers.get(b.workerIncoming);
      if (!w || w.dead) b.workerIncoming = 0;
      else continue;
    }
    const job = b.def.worker;
    const r = reg(g, b);
    // unemployed specialist?
    let spec: Settler | null = null, sd = Infinity;
    for (const s of g.settlers.values()) {
      if (s.owner !== owner || s.job !== job || s.home || s.dead || s.aboard || s.voyage || regS(g, s) !== r) continue;
      const d = dist2(s.x, s.z, b.cx, b.cz);
      if (d < sd) { sd = d; spec = s; }
    }
    if (spec) {
      const s = spec;
      claim(g, s);
      b.workerIncoming = s.id;
      s.home = b.id;
      plan(s, [A.walk(b.door), A.do(() => {
        if (!g.buildings.has(b.id)) return false;
        enter(g, s, b);
        b.worker = s.id;
        b.workerIncoming = 0;
      })], () => { if (b.workerIncoming === s.id) b.workerIncoming = 0; s.home = 0; });
      continue;
    }
    if (!carriers.length) { b.status = 'No free settlers'; continue; }
    const tool = JOB_TOOL[job];
    if (tool) {
      const src = findToolSource(g, owner, tool, b.cx, b.cz, r);
      if (!src) {
        b.status = `Missing tool: ${GOOD_NAMES[tool].replace(/s$/, '').toLowerCase()}`;
        // iron and coal keep the toolsmith going: borrow a miner from a gold or stone mine rather than deadlock
        if (b.type === 'ironmine' || b.type === 'coalmine') reassignMiner(g, owner, b, mine);
        continue;
      }
      const c = nearestCarrier(carriers, src.cx, src.cz, g, r);
      if (!c) { b.status = 'No free settlers'; continue; }
      equip(g, c, src, tool, job, b);
      b.status = 'Worker on the way';
    } else {
      const c = nearestCarrier(carriers, b.cx, b.cz, g, r);
      if (!c) { b.status = 'No free settlers'; continue; }
      claim(g, c);
      c.job = job;
      c.home = b.id;
      b.workerIncoming = c.id;
      b.status = 'Worker on the way';
      plan(c, [A.walk(b.door), A.do(() => {
        if (!g.buildings.has(b.id)) return false;
        enter(g, c, b);
        b.worker = c.id;
        b.workerIncoming = 0;
      })], () => { if (b.workerIncoming === c.id) b.workerIncoming = 0; c.home = 0; });
    }
  }
}

function reassignMiner(g: Game, owner: number, b: Building, mine: Building[]) {
  for (const o of mine) {
    if (o.type !== 'goldmine' && o.type !== 'stonemine' && !(b.type === 'ironmine' && o.type === 'coalmine' && g.totalStock(owner).coal > 6)) continue;
    if (reg(g, o) !== reg(g, b)) continue;
    const w = o.worker ? g.settlers.get(o.worker) : null;
    if (!w || w.dead) continue;
    o.worker = 0;
    o.working = false;
    abortPlan(g, w);
    exit(g, w);
    o.status = `Miner sent to the ${b.def.name}`;
    // straight to the mine that needs him, or the old one would simply hire him back
    const s = w;
    s.home = b.id;
    s.idle = false;
    b.workerIncoming = s.id;
    b.status = 'Worker on the way';
    plan(s, [A.walk(b.door), A.do(() => {
      if (!g.buildings.has(b.id)) return false;
      enter(g, s, b);
      b.worker = s.id;
      b.workerIncoming = 0;
    })], () => { if (b.workerIncoming === s.id) b.workerIncoming = 0; s.home = 0; });
    return;
  }
}

// ------------------------------------------------------------------ builder & digger behaviour
export function diggerThink(g: Game, s: Settler, dt: number) {
  const b = s.home ? g.buildings.get(s.home) : null;
  if (!b || b.state !== 'leveling' || b.owner !== s.owner) {
    s.home = 0;
    return crewIdle(g, s, dt);
  }
  s.idle = false;
  const w = g.world;
  const nodes = g.footprint(b.size, b.x, b.y);
  nodes.push(b.door);
  // choose node with the biggest error, prefer ones not targeted by other diggers
  let best = -1, bv = 0.02;
  for (const i of nodes) {
    let e = Math.abs(w.h[i] - b.targetH);
    if (i === b.door) e *= 0.5;
    if (e > bv) {
      // spread diggers apart
      let taken = false;
      for (const id of b.diggers) {
        if (id === s.id) continue;
        const o = g.settlers.get(id);
        if (o && (o.node === i || o.next === i)) taken = true;
      }
      if (!taken || e > bv * 3) { bv = e; best = i; }
    }
  }
  if (best < 0) {
    // every node is within tolerance (or being worked on by another digger)
    let maxErr = 0;
    for (const i of nodes) maxErr = Math.max(maxErr, Math.abs(w.h[i] - b.targetH));
    if (maxErr < 0.08) g.finishLeveling(b);
    else plan(s, [A.wait(0.5)]);
    return;
  }
  const node = best;
  plan(s, [
    A.walk(node),
    A.anim('dig', 1.5, b.door, (t) => { if (t < 0.05) g.emit({ type: 'dig', x: w.nx(node), z: w.ny(node) }); }),
    A.do(() => {
      if (!g.buildings.has(b.id) || b.state !== 'leveling') return false;
      const diff = b.targetH - w.h[node];
      const stepH = Math.sign(diff) * Math.min(Math.abs(diff), 0.3);
      w.h[node] += stepH;
      // feather neighbours outside footprint slightly
      const x = w.nx(node), y = w.ny(node);
      w.markHeightDirty(x - 1, y - 1, x + 1, y + 1);
      g.computeLevelWork(b);
      b.levelWork += Math.abs(stepH);
      g.emit({ type: 'dirt', x, z: y });
    }),
  ]);
}

export function builderThink(g: Game, s: Settler, dt: number) {
  const b = s.home ? g.buildings.get(s.home) : null;
  if (!b || (b.state !== 'building' && b.state !== 'leveling') || b.owner !== s.owner) {
    s.home = 0;
    return crewIdle(g, s, dt);
  }
  s.idle = false;
  const w = g.world;
  // spot around the building perimeter
  const idx = b.builders.indexOf(s.id);
  const spots: number[] = [];
  const x0 = b.x - 1, y0 = b.y - 1, x1 = b.x + b.size, y1 = b.y + b.size;
  for (let x = x0; x <= x1; x++) { spots.push(w.idx(x, y1)); }
  for (let y = y0; y <= y1; y++) { spots.push(w.idx(x0, y)); spots.push(w.idx(x1, y)); }
  const good = spots.filter((i) => w.walkable(i));
  if (!good.length) { plan(s, [A.wait(1)]); return; }
  const spot = good[(idx * 5 + ((g.time / 9) | 0)) % good.length];
  if (b.state === 'leveling') {
    plan(s, [A.walk(spot), A.wait(1.0)]);
    return;
  }
  const avail = b.delivered.board + b.delivered.stone - b.used;
  if (avail <= 0 || b.used >= b.buildTotal) {
    plan(s, [A.walk(spot), A.anim('idle', 1.5)]);
    return;
  }
  const center = w.idx(Math.round(b.cx), Math.round(b.cz));
  let consumed = false;
  plan(s, [
    A.walk(spot),
    A.do(() => {
      const av = b.delivered.board + b.delivered.stone - b.used;
      if (av <= 0 || b.used >= b.buildTotal || b.state !== 'building') return false;
      b.used++;
      consumed = true;
    }),
    A.anim('hammer', 4.4, center, (t) => { if (Math.floor(t * 2.5) !== Math.floor((t - 0.05) * 2.5)) g.emit({ type: 'hammer', x: s.x, z: s.z }); }),
    A.do(() => {
      if (!g.buildings.has(b.id) || b.state !== 'building') return false;
      b.buildWork++;
      consumed = false;
      g.emit({ type: 'buildstep', b: b.id, x: b.cx, z: b.cz });
    }),
  ], () => {
    if (consumed && g.buildings.has(b.id)) b.used = Math.max(0, b.used - 1);
  });
}

function crewIdle(g: Game, s: Settler, dt: number) {
  s.idle = true;
  s.wanderT -= dt;
  if (s.wanderT > 0) return;
  s.wanderT = g.rng.range(6, 14);
  const st = g.nearestStorage(s.owner, s.x, s.z, regS(g, s));
  if (!st) return;
  const w = g.world;
  const bx = w.nx(st.door), by = w.ny(st.door);
  for (let k = 0; k < 5; k++) {
    const tx = bx + g.rng.int(-4, 5), ty = by + g.rng.int(0, 5);
    if (!w.inBounds(tx, ty)) continue;
    const ti = w.idx(tx, ty);
    if (!w.walkable(ti) || w.reserve[ti]) continue;
    s.actions.push(A.walk(ti));
    return;
  }
}

// helpers for UI
export function buildingNeeds(b: Building): { good: Good; have: number; cap: number }[] {
  const r: { good: Good; have: number; cap: number }[] = [];
  for (const inp of b.def.inputs ?? []) {
    for (const gd of inp.goods) r.push({ good: gd, have: b.stock[gd], cap: inp.cap });
  }
  return r;
}

void BUILDINGS; void GOODS; void FOODS; void WEAPONS; void recomputeTerritory; void isSoldier; void sendSoldierTo;
