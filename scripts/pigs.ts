// Headless check of the live pigs (src/render/pigs.ts): a pig farm's herd follows the farm's pig
// stock — the oldest piglet is full grown as each pig is finished, ready pigs wait at the gate and
// one leaves for every pig a carrier takes — pigs keep inside the fence and out of each other,
// crowd the trough when the feed runs out, and a full pen shows all eight pigs waiting. Pigs
// waiting at the slaughterhouse match its stock too. Nothing here may touch the game's numbers.
// Usage: npx tsx scripts/pigs.ts [seed]
import * as THREE from 'three';
import { Game } from '../src/game/game';
import type { BuildingType } from '../src/game/defs';
import type { Building } from '../src/game/types';
import { PigsRenderer } from '../src/render/pigs';
import type { BuildingsRenderer } from '../src/render/buildings';

const seed = Number(process.argv[2] ?? 7);
const P = 0;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

function put(g: Game, type: BuildingType, x: number, z: number): Building {
  const w = g.world;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  w.forRadius(x, z, 9, (_i, nx, ny, d2) => {
    if (d2 >= bd) return;
    const a = g.anchorFor(type, nx, ny);
    if (!g.canPlace(type, P, a.x, a.y)) return;
    bd = d2;
    best = a;
  });
  if (!best) throw new Error(`no site for ${type}`);
  const a = best as { x: number; y: number };
  return g.addBuilding(type, P, a.x, a.y, true);
}
function setup() {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
  g.ai.length = 0;
  const hq = g.buildings.get(g.players[P].hq)!;
  const farm = put(g, 'pigfarm', hq.cx + 7, hq.cz + 2);
  const butcher = put(g, 'slaughter', hq.cx - 6, hq.cz + 4);
  hq.stock.grain += 16;
  hq.stock.water += 16;
  return { g, hq, farm, butcher };
}
const { g, hq, farm, butcher } = setup();
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);
// the same game run without the pigs drawn, to show they change nothing
const control = setup();

// stand-ins for the building views: every building visible, piles at the slaughterhouse's anchor
const views = new Map<number, unknown>();
const view = (b: Building) => {
  let v = views.get(b.id);
  if (!v) views.set(b.id, (v = { group: { visible: true, position: { y: b.targetH } }, anchors: { piles: [new THREE.Vector3(1, 0, 1)] } }));
  return v;
};
const buildings = { get views() { for (const b of g.buildings.values()) view(b); return views; } } as unknown as BuildingsRenderer;
const camera = new THREE.PerspectiveCamera(45, 1.3, 0.5, 400);
camera.position.set(hq.cx, 80, hq.cz + 40);
camera.lookAt(hq.cx, 0, hq.cz);
camera.updateMatrixWorld();
let grunts = 0;
const pigs = new PigsRenderer(g, buildings, () => { grunts++; });
const herds = (pigs as any).herds as Map<number, any>;
const herdOf = (b: Building) => herds.get(b.id);
const pigsOf = (h: any): any[] => [...h.breeders, ...h.young, ...h.ready];

const FENCE = { x: 0.05, z: 0.55, rx: 1.24, rz: 0.76 };
const SCALE = 1.05;
const outside = (p: any) => {
  let worst = 0;
  const s = SCALE * p.size, sh = Math.sin(p.h), ch = Math.cos(p.h);
  for (const [ox, oz] of [[sh * 0.36, ch * 0.36], [-sh * 0.24, -ch * 0.24], [ch * 0.12, -sh * 0.12], [-ch * 0.12, sh * 0.12]]) {
    const ex = (p.x + ox * s - FENCE.x) / FENCE.rx, ez = (p.z + oz * s - FENCE.z) / FENCE.rz;
    worst = Math.max(worst, Math.sqrt(ex * ex + ez * ez) - 1);
  }
  return worst;
};
/** how deep two pigs' bodies overlap, from their centres' distance (a quick lower bound) */
const overlap = (a: any, c: any) => {
  // as drawn: a lying pig's body rolled out to its side
  const segs = (p: any) => {
    const s = SCALE * p.size, roll = p.lie * 0.14 * s * (p.seed % 2 < 1 ? 1 : -1);
    const x = p.x + Math.cos(p.h) * roll, z = p.z - Math.sin(p.h) * roll;
    return [x - Math.sin(p.h) * 0.1 * s, z - Math.cos(p.h) * 0.1 * s, x + Math.sin(p.h) * 0.17 * s, z + Math.cos(p.h) * 0.17 * s];
  };
  const A = segs(a), C = segs(c);
  let best = Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const ax = A[0] + (A[2] - A[0]) * i / 8, az = A[1] + (A[3] - A[1]) * i / 8;
    const cx = C[0] + (C[2] - C[0]) * j / 8, cz = C[1] + (C[3] - C[1]) * j / 8;
    best = Math.min(best, Math.hypot(ax - cx, az - cz));
  }
  return 0.125 * SCALE * (a.size + c.size) - best;
};

const DT = 0.1;
let controlOn = true;
const PROPS = [{ x0: -1.034, z0: 0.303, x1: -0.366, z1: 0.097, r: 0.08 }, { x0: 0.8, z0: 0.1, x1: 0.8001, z1: 0.1, r: 0.2 }];
const inProps = (p: any) => {
  let worst = 0;
  const s = SCALE * p.size;
  for (let i = 0; i <= 8; i++) {
    const t = -0.1 + 0.27 * i / 8;
    const x = p.x + Math.sin(p.h) * t * s, z = p.z + Math.cos(p.h) * t * s;
    for (const o of PROPS) {
      const vx = o.x1 - o.x0, vz = o.z1 - o.z0, k = Math.max(0, Math.min(1, ((x - o.x0) * vx + (z - o.z0) * vz) / (vx * vx + vz * vz)));
      worst = Math.max(worst, o.r + 0.125 * s - Math.hypot(x - o.x0 - vx * k, z - o.z0 - vz * k));
    }
  }
  return worst;
};
let maxProp = 0, propFrames = 0;
let mismatch = 0, frames = 0, deepFrames = 0, maxDeep = 0, maxOut = 0, orderBad = 0, grewAtRipe = 0, ripe = 0;
let lastStock = 0, lastYoung: any = null, hungryFrames = 0, hungryNear = 0;
const run = (secs: number, each?: () => void) => {
  for (let t = 0; t < secs; t += DT) {
    g.update(DT);
    g.events.length = 0;
    pigs.update(DT, g.time, camera);
    if (controlOn) { control.g.update(DT); control.g.events.length = 0; }
    const h = herdOf(farm);
    if (!h) continue;
    frames++;
    if (h.ready.length !== farm.stock.pig) mismatch++;
    // a new ready pig is the young one that was oldest, and it was full grown
    if (farm.stock.pig > lastStock && lastYoung) {
      ripe++;
      if (h.ready.includes(lastYoung) && lastYoung.size > 0.9) grewAtRipe++;
    }
    lastStock = farm.stock.pig;
    lastYoung = h.young[0] ?? null;
    for (let k = 1; k < h.young.length; k++) if (h.young[k].grow > h.young[k - 1].grow + 1e-6) orderBad++;
    const all = pigsOf(h);
    let deep = 0, propFlag = false;
    for (let i = 0; i < all.length; i++) {
      maxOut = Math.max(maxOut, outside(all[i]));
      if (all[i].lie < 0.5) { const d = inProps(all[i]); maxProp = Math.max(maxProp, d); if (d > 0.04) propFlag = true; }
      for (let j = i + 1; j < all.length; j++) deep = Math.max(deep, overlap(all[i], all[j]));
    }
    maxDeep = Math.max(maxDeep, deep);
    if (propFlag) propFrames++;
    if (deep > 0.06) deepFrames++;
    each?.();
  }
};

run(4 * 60);
const fingerprint = (x: Game) => JSON.stringify([x.players[P].produced, [...x.settlers.values()].map((s) => [s.x.toFixed(4), s.z.toFixed(4), s.carrying]), x.rng.next()]);
check(fingerprint(g) === fingerprint(control.g), 'the game runs exactly the same with the pigs drawn');
controlOn = false;
const h = herdOf(farm);
check(!!h, 'the pig farm has a herd');
log(`produced ${g.players[P].produced.pig} pigs, herd ${pigsOf(h).length} (2 breeders, ${h.young.length} young, ${h.ready.length} ready), ${grunts} grunts`);
check(h.breeders.length === 2 && h.young.length === 3, 'a boar, a sow and three piglets');
check(mismatch === 0, `ready pigs always match the farm's stock (${mismatch} of ${frames} frames off)`);
check(orderBad === 0, 'piglets are ordered oldest first');
check(ripe > 5 && grewAtRipe === ripe, `each finished pig is the oldest piglet, full grown (${grewAtRipe}/${ripe})`);
check(maxOut < 0.02, `snouts and rumps keep inside the fence (worst ${maxOut.toFixed(3)} past it)`);
check(propFrames / frames < 0.01 && maxProp < 0.12, `pigs keep out of the trough and the hay (${(100 * propFrames / frames).toFixed(1)}% of frames past 4 cm, deepest ${maxProp.toFixed(3)})`);
check(deepFrames / frames < 0.02, `pigs rarely push into each other (${(100 * deepFrames / frames).toFixed(1)}% of frames past 6 cm, deepest ${maxDeep.toFixed(3)})`);
check(grunts > 10, `the herd grunts now and then (${grunts})`);

// the feed runs out: the farm waits, the pigs nose round the empty trough, nobody grows
const grows = h.young.map((p: any) => p.grow);
run(3 * 60, () => {
  if (!farm.status.startsWith('Waiting for')) return;
  hungryFrames++;
  const all = pigsOf(herdOf(farm)).filter((p: any) => p.role !== 'ready');
  hungryNear += all.filter((p: any) => p.x < 0 && p.z < 0.95).length / all.length;
});
log(`status "${farm.status}", grain ${farm.stock.grain} water ${farm.stock.water}`);
check(hungryFrames > 300, `the farm ran out of feed (${hungryFrames} frames waiting)`);
check(hungryNear / Math.max(1, hungryFrames) > 0.55, `hungry pigs hang about the trough half (${(100 * hungryNear / Math.max(1, hungryFrames)).toFixed(0)}% on the trough side)`);
check(h.young.every((p: any, k: number) => p.grow <= grows[k] + 0.35), 'piglets stop growing without feed');

// eight pigs waiting at once (the carriers all busy): they stand about the gate, and leave one
// by one as the carriers come for them
hq.stock.grain += 30;
hq.stock.water += 30;
farm.stock.pig = 8;
run(20);
const nearGate = h.ready.filter((p: any) => Math.hypot(p.x - 0.3, p.z - 0.98) < 0.8).length;
log(`${h.ready.length} ready, ${nearGate} of them by the gate`);
check(h.ready.length === farm.stock.pig, `ready pigs match the stock (${h.ready.length} / ${farm.stock.pig})`);
check(nearGate >= h.ready.length - 2, `the ready pigs wait near the gate (${nearGate}/${h.ready.length})`);
let emptied = -1;
run(90, () => { if (emptied < 0 && farm.stock.pig === 0) emptied = g.time; });
check(emptied > 0 && h.ready.length === farm.stock.pig, `the carriers took them all away and the herd let them go (${h.ready.length} left)`);
check(maxOut < 0.02, `still inside the fence (worst ${maxOut.toFixed(3)})`);
check(deepFrames / frames < 0.03, `still rarely inside each other (${(100 * deepFrames / frames).toFixed(1)}% of frames past 6 cm, deepest ${maxDeep.toFixed(3)})`);

// the slaughterhouse's pigs stand by its pile, one for each in stock (the butcher is taking a
// break, or they would go straight in)
butcher.paused = true;
butcher.stock.pig = 3;
let pileOk = 0, pileFrames = 0, pileNear = 0;
const bstart = butcher.stock.pig;
run(20, () => {
  const hh = herdOf(butcher);
  pileFrames++;
  if ((hh ? hh.ready.length : 0) === butcher.stock.pig) pileOk++;
  if (hh && hh.ready.every((p: any) => Math.hypot(p.x - hh.sx, p.z - hh.sz) <= hh.sr + 0.01)) pileNear++;
});
butcher.paused = false;
run(40, () => { const hh = herdOf(butcher); pileFrames++; if ((hh ? hh.ready.length : 0) === butcher.stock.pig) pileOk++; });
check(pileOk === pileFrames, `pigs at the slaughterhouse follow its stock (${pileOk}/${pileFrames}, ${bstart} waiting at first, ${butcher.stock.pig} now)`);
check(pileNear === 200, `they stand in the yard (${pileNear}/200 frames)`);

// a burnt-down farm takes its herd with it
g.destroyBuilding(farm, false);
run(1);
check(!herdOf(farm), 'no herd without the farm');

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
