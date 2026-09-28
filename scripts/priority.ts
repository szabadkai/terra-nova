// Headless check of the priority building: with boards and stone scarce, three sites go up in
// turn; the youngest is prioritised and must get its materials and builders ahead of the older
// two. Then a finished workshop is prioritised and gets the scarce logs before its twin, the
// priority moves when another building takes it, survives a save, and goes with a demolition.
// Usage: npx tsx scripts/priority.ts [seed]
import { Game } from '../src/game/game';
import type { BuildingType } from '../src/game/defs';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import type { Building } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.length = 0; // the AI must not interfere
const w = g.world;
const P = 0;
const hq = g.buildings.get(g.players[P].hq)!;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);
const run = (x: Game, sec: number) => { for (let k = 0; k < sec * 4; k++) x.update(0.25); x.events.length = 0; };

function siteNear(x: number, z: number, type: BuildingType): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  w.forRadius(x, z, 10, (_i, nx, ny, d2) => {
    if (d2 >= bd) return;
    const a = g.anchorFor(type, nx, ny);
    if (!g.canPlace(type, P, a.x, a.y)) return;
    bd = d2;
    best = a;
  });
  return best;
}
const put = (type: BuildingType, x: number, z: number, instant = false): Building => {
  const a = siteNear(x, z, type);
  if (!a) throw new Error(`no site for ${type} near ${x},${z}`);
  return g.addBuilding(type, P, a.x, a.y, instant);
};

// 1. three sites, materials for barely one; the youngest is put first
hq.stock.board = 6;
hq.stock.stone = 3;
const A = put('residence_m', hq.cx - 9, hq.cz + 2);
run(g, 2);
const B = put('residence_m', hq.cx + 9, hq.cz + 2);
run(g, 2);
const C = put('residence_m', hq.cx, hq.cz + 9);
check(g.setPriority(C, true), 'the youngest site is prioritised');
check(C.priority && !A.priority && !B.priority, 'only it carries the flag');
run(g, 60);
const got = (b: Building) => b.delivered.board + b.delivered.stone;
log('materials', `A ${got(A)}`, `B ${got(B)}`, `C ${got(C)}`, 'crews', `A ${A.diggers.length + A.builders.length}`, `B ${B.diggers.length + B.builders.length}`, `C ${C.diggers.length + C.builders.length}`);
check(got(C) >= 6 && got(C) > got(A) && got(C) > got(B), `the prioritised site got the scarce materials first (C ${got(C)}, A ${got(A)}, B ${got(B)})`);
check(C.diggers.length + C.builders.length >= 2, `and a full crew (${C.diggers.length} diggers, ${C.builders.length} builders)`);
// the priority survives a save and a load
const copy = restore(await decodeSave(await encodeSave(snapshot(g))));
copy.ai.length = 0;
check(copy.priorityOf(P)?.id === C.id, 'the priority survives a save');
run(copy, 20);
const cC = copy.buildings.get(C.id)!;
check(cC.priority && (cC.builders.length > 0 || cC.state === 'done'), 'and the restored game keeps building it first');

// 2. plenty of material: the prioritised site still finishes first
hq.stock.board += 30;
hq.stock.stone += 30;
let firstDone = '';
for (let t = 0; t < 400 && !firstDone; t++) {
  g.update(1);
  g.events.length = 0;
  for (const [name, b] of [['A', A], ['B', B], ['C', C]] as const) if (b.state === 'done') { firstDone = name; break; }
}
log('first finished:', firstDone || 'none');
check(firstDone === 'C', `the prioritised site finished first (${firstDone})`);
check(!C.priority && g.priorityOf(P) === null, 'a finished residence drops the flag: nothing more can be brought');

// 3. a finished workshop: two sawmills, logs for one; the second is prioritised
for (const b of [...g.buildings.values()]) if (b.owner === P && b.type !== 'hq') g.destroyBuilding(b, false);
run(g, 2);
hq.stock.log = 5;
hq.stock.saw = 2;
const S1 = put('sawmill', hq.cx - 8, hq.cz + 3, true);
const S2 = put('sawmill', hq.cx + 8, hq.cz + 3, true);
check(g.setPriority(S2, true) && S2.priority, 'the second sawmill is prioritised');
run(g, 45);
log('logs', `S1 ${S1.stock.log + S1.incoming.log}`, `S2 ${S2.stock.log + S2.incoming.log}`, 'workers', `S1 ${S1.worker ? 'yes' : 'no'}`, `S2 ${S2.worker ? 'yes' : 'no'}`);
check(S2.stock.log + S2.incoming.log + S2.prodCount >= 4, `it got the scarce logs (${S2.stock.log} in, ${S2.prodCount} sawn)`);
check(!!S2.worker || !!S2.workerIncoming, 'and its sawyer');

// 4. the priority moves, and a building that takes nothing in cannot have it
check(g.setPriority(S1, true) && S1.priority && !S2.priority, 'prioritising another building moves the flag');
const wc = put('woodcutter', hq.cx, hq.cz + 8, true);
check(!g.setPriority(wc, true) && !wc.priority && S1.priority, 'a woodcutter (nothing to bring) is refused');
check(g.setPriority(S1, false) && g.priorityOf(P) === null, 'the flag can be taken off');
g.setPriority(S2, true);
g.destroyBuilding(S2, true);
check(g.priorityOf(P) === null, 'demolition takes the priority with it');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
