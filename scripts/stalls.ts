// Headless check of structured building statuses (roadmap 1a): a sawmill with no logs waits for an
// input, a second with no saw left misses a tool, a woodcutter with the trees cleared round it finds
// none in range. Each only counts as stalled after the grace time, keeps its reason and clock through
// a save, and clears once logs arrive or it is paused. Then an AI town is sampled for what stalls it.
// Usage: npx tsx scripts/stalls.ts [seed] [aiMinutes]
import { AIController } from '../src/game/ai';
import { Game } from '../src/game/game';
import { FOODS, type BuildingType } from '../src/game/defs';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import { STALL_GRACE, stallText, stalled, stalledBuildings } from '../src/game/status';
import type { Building } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const aiMin = Number(process.argv[3] ?? 25);
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
  w.forRadius(x, z, 12, (_i, nx, ny, d2) => {
    if (d2 >= bd) return;
    const a = g.anchorFor(type, nx, ny);
    if (!g.canPlace(type, P, a.x, a.y)) return;
    bd = d2;
    best = a;
  });
  return best;
}
const put = (type: BuildingType, x: number, z: number): Building => {
  const a = siteNear(x, z, type);
  if (!a) throw new Error(`no site for ${type} near ${x},${z}`);
  return g.addBuilding(type, P, a.x, a.y, true);
};

// the wording the AI and the pig pen read stays as it was
check(stallText({ kind: 'input', goods: FOODS }) === 'Waiting for food', 'a mine without food says "Waiting for food"');
check(stallText({ kind: 'input', goods: ['sword', 'bow'] }) === 'Waiting for weapons', 'a barracks without arms says "Waiting for weapons"');
check(stallText({ kind: 'tool', good: 'pickaxe' }) === 'Missing tool: pickaxe', 'a missing tool reads as before');

// 1. one saw and no logs: the first sawmill waits for logs, the second has no saw
for (const t of ['saw', 'log', 'axe'] as const) hq.stock[t] = 0;
hq.stock.saw = 1;
hq.stock.axe = 1;
const S = put('sawmill', hq.cx - 7, hq.cz + 3);
let t0 = g.time;
while (!S.stall && g.time - t0 < 120) run(g, 0.25);
check(S.stall?.kind === 'input' && S.stall.goods.join() === 'log', `the sawmill waits for logs (${S.status})`);
check(!stalled(g, S) && !stalledBuildings(g, P).includes(S), 'a fresh stall is not a warning yet');
run(g, STALL_GRACE + 1);
check(stalled(g, S) && stalledBuildings(g, P).includes(S), `after ${STALL_GRACE} s it is`);

const S2 = put('sawmill', hq.cx + 7, hq.cz + 3);
run(g, 30);
check(S2.stall?.kind === 'tool' && S2.stall.good === 'saw' && S2.status === 'Missing tool: saw', `the second sawmill misses a saw (${S2.status})`);

// 2. a woodcutter with every tree round it gone
const Wc = put('woodcutter', hq.cx, hq.cz - 8);
const R = (Wc.def.radius ?? 11) + 2;
for (const t of [...g.trees.values()]) {
  const x = t.node % w.W, z = Math.floor(t.node / w.W);
  if ((x - Wc.cx) ** 2 + (z - Wc.cz) ** 2 <= R * R) g.removeTree(t);
}
t0 = g.time;
while (Wc.stall?.kind !== 'range' && g.time - t0 < 120) run(g, 0.5);
check(Wc.stall?.kind === 'range' && Wc.stall.lack === 'trees', `the woodcutter finds no trees (${Wc.status})`);
const sinceWc = Wc.stallT;
run(g, STALL_GRACE + 12);
check(Wc.stallT === sinceWc, 'the stall clock keeps running while the reason stays the same (the woodcutter looks again every few seconds)');
const ids = stalledBuildings(g, P).map((b) => b.id);
log('stalled:', stalledBuildings(g, P).map((b) => `${b.def.name}: ${b.status}`).join(' | '));
check(ids.includes(S.id) && ids.includes(S2.id) && ids.includes(Wc.id), 'all three are listed as stalled');
check(ids.every((id, k) => k === 0 || ids[k - 1] < id), 'in a stable order');

// 3. the reasons and their clocks survive a save
const copy = restore(await decodeSave(await encodeSave(snapshot(g))));
copy.ai.length = 0;
const cS = copy.buildings.get(S.id)!, cS2 = copy.buildings.get(S2.id)!;
check(JSON.stringify(cS.stall) === JSON.stringify(S.stall) && cS.stallT === S.stallT && JSON.stringify(cS2.stall) === JSON.stringify(S2.stall), 'stalls survive a save');
check(stalledBuildings(copy, P).map((b) => b.id).join() === ids.join(), 'and so does the list');

// 4. logs arrive: the sawmill gets going and drops off the list; a paused one is not stuck
hq.stock.log = 20;
S2.paused = true;
t0 = g.time;
while ((S.stall || !S.prodCount) && g.time - t0 < 120) run(g, 0.5);
check(!S.stall && S.prodCount > 0, `with logs the sawmill works (${S.status}, ${S.prodCount} made)`);
check(!stalledBuildings(g, P).includes(S), 'and is off the list');
check(!S2.stall && S2.status === 'Paused' && !stalledBuildings(g, P).includes(S2), 'a paused sawmill is not stalled');

// 5. what stalls in an AI town (information: the reasons, how many, for how long)
const ai = new Game({ size: 160, seed: seed + 100, players: 2, aiLevel: 2 });
ai.ai.push(new AIController(ai, 0, 2));
for (let k = 0; k < aiMin * 60 * 4; k++) { ai.update(0.25); ai.events.length = 0; }
for (const p of ai.players) {
  const list = stalledBuildings(ai, p.id);
  const by = new Map<string, number[]>();
  for (const b of list) { const r = by.get(b.status) ?? []; r.push(Math.round((ai.time - b.stallT) / 60)); by.set(b.status, r); }
  const total = [...ai.buildings.values()].filter((b) => b.owner === p.id && b.state === 'done').length;
  console.log(`AI ${p.id} at ${aiMin} min: ${list.length} of ${total} buildings stalled${list.length ? ' — ' : ''}${[...by].map(([s, m]) => `${s} ×${m.length} (${m.join('/')} min)`).join('; ')}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
