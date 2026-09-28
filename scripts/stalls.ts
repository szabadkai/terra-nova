// Headless check of the economy at a glance (roadmap 1). Stalls: a sawmill with no logs waits for an
// input, a second with no saw left misses a tool, a woodcutter with the trees cleared round it finds
// none in range; each only counts as stalled after the grace time, keeps its reason and clock through
// a save, and clears once logs arrive or it is paused. Cause chains: the walk upstream finds the
// missing maker, the maker that is stuck in turn, and a circle of two waiting on each other. Alerts:
// a worked-out mine, buildings no settler is free for, a toolsmith with no coal and a worker with no
// tool are each raised once, a burst of the same kind only once. Goods flow: what is made and used is
// counted, sampled once a minute and kept through a save. Then an AI town is sampled for what stalls
// it, with the chains behind it.
// Usage: npx tsx scripts/stalls.ts [seed] [aiMinutes]
import { AIController } from '../src/game/ai';
import { Game } from '../src/game/game';
import { FOODS, type BuildingType } from '../src/game/defs';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import { STALL_GRACE, stallText, stalled, stalledBuildings } from '../src/game/status';
import { causeLine, causeOf, chainText, rootCauses, type Cause } from '../src/game/causes';
import { StallWatch, type Alert } from '../src/game/alerts';
import { FLOW_EVERY, flowReport } from '../src/game/flow';
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

// ---------------------------------------------------------------- goods flow (1d)
{
  const pl = g.players[P];
  const made = pl.produced.board, logs = pl.used.log;
  check(made >= S.prodCount && logs >= S.prodCount, `boards made (${made}) and logs used (${logs}) are counted, at least the ${S.prodCount} the sawmill turned out`);
  check(pl.used.board > 0 || pl.used.stone > 0 || pl.used.saw + pl.used.axe > 0, `tools handed out and materials built in count as used (${['board', 'stone', 'saw', 'axe'].map((gd) => `${gd} ${pl.used[gd as 'board']}`).join(', ')})`);
  check(pl.flow.length >= Math.floor(g.time / FLOW_EVERY) && pl.flow.length <= Math.floor(g.time / FLOW_EVERY) + 2, `one sample a minute (${pl.flow.length} in ${(g.time / 60).toFixed(1)} min)`);
  const rep = flowReport(g, P);
  check(rep.goods.board.made > 0 && rep.goods.board.made <= made && rep.goods.log.used > 0, `the Economy tab's report sees the boards (${rep.goods.board.made} made, ${rep.goods.log.used} logs used over ${Math.round(rep.span)} s)`);
  check(rep.goods.board.madeSeries.reduce((a, b) => a + b, 0) <= rep.goods.board.made + made && rep.goods.board.madeSeries.length === 10, 'and splits them into buckets for the sparkline');
  const c2 = restore(await decodeSave(await encodeSave(snapshot(g))));
  check(JSON.stringify(c2.players[P].used) === JSON.stringify(pl.used) && JSON.stringify(c2.players[P].flow) === JSON.stringify(pl.flow), 'counts and samples survive a save');
}

// ---------------------------------------------------------------- cause chains (1c)
const fresh = (sd: number) => { const x = new Game({ size: 160, seed: sd, players: 2, aiLevel: 1 }); x.ai.length = 0; return x; };
/** A spot a building of `size` fits on near (x, z), for placing one where it couldn't normally go (a mine off the mountain). */
function force(x: Game, type: BuildingType, like: BuildingType, px: number, pz: number): Building {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  x.world.forRadius(px, pz, 14, (_i, nx, ny, d2) => {
    if (d2 >= bd) return;
    const a = x.anchorFor(like, nx, ny);
    if (!x.canPlace(like, P, a.x, a.y)) return;
    bd = d2;
    best = a;
  });
  if (!best) throw new Error(`no room for a ${type}`);
  const at = best as { x: number; y: number };
  return x.addBuilding(type, P, at.x, at.y, true);
}
const until = (x: Game, ok: () => boolean, max: number) => { const t = x.time; while (!ok() && x.time - t < max) run(x, 0.5); return ok(); };
const flat = (c: Cause | null) => (c ? chainText(c) : '(not stalled)');
{
  const h = fresh(seed + 1);
  const hh = h.buildings.get(h.players[P].hq)!;
  for (const gd of ['log', 'iron', 'ironore', 'axe'] as const) hh.stock[gd] = 0;
  hh.stock.axe = 1;
  const gw = g;
  // a sawmill with no logs anywhere and nobody felling trees
  const saw = force(h, 'sawmill', 'sawmill', hh.cx - 7, hh.cz + 3);
  until(h, () => saw.stall?.kind === 'input', 60);
  let c = causeOf(h, saw);
  log('sawmill:', flat(c));
  check(!!c && c.next.length === 1 && causeLine(c.next[0]) === "No Woodcutter's Hut" && c.next[0].hint === "Build a Woodcutter's Hut", 'a sawmill with no logs and no woodcutter: the woodcutter is missing');
  // a woodcutter that finds no trees
  const wc = force(h, 'woodcutter', 'woodcutter', hh.cx, hh.cz - 8);
  const R = (wc.def.radius ?? 11) + 2;
  for (const t of [...h.trees.values()]) {
    const x = t.node % h.world.W, z = Math.floor(t.node / h.world.W);
    if ((x - wc.cx) ** 2 + (z - wc.cz) ** 2 <= R * R) h.removeTree(t);
  }
  until(h, () => wc.stall?.kind === 'range', 90);
  c = causeOf(h, saw);
  log('sawmill:', flat(c));
  check(!!c && c.next[0]?.type === 'woodcutter' && c.next[0].text === 'no trees in range' && !!c.next[0].hint?.includes('forester'), 'with a woodcutter that finds no trees, the chain goes on to it, with a hint to plant');
  // a toolsmith with no iron, then an iron smelter with no ore
  const ts = force(h, 'toolsmith', 'toolsmith', hh.cx + 8, hh.cz + 2);
  until(h, () => ts.stall?.kind === 'input', 90);
  c = causeOf(h, ts);
  log('toolsmith:', flat(c));
  check(!!c && causeLine(c.next[0]) === 'No Iron Smelter' && c.next[0].hint === 'Build an Iron Smelter', 'a toolsmith with no iron: no iron smelter (and "an")');
  const sm = force(h, 'ironsmelter', 'ironsmelter', hh.cx - 8, hh.cz - 5);
  until(h, () => sm.stall?.kind === 'input', 90);
  c = causeOf(h, ts);
  log('toolsmith:', flat(c));
  const sc = c?.next[0];
  check(sc?.type === 'ironsmelter' && sc.text === 'waiting for iron ore' && causeLine(sc.next[0] ?? { type: null, ids: [], text: '', bad: true, next: [] }) === 'No Iron Mine', 'three steps: toolsmith → iron smelter waiting for ore → no iron mine');
  check(rootCauses(c!).length === 1 && rootCauses(c!)[0].type === 'ironmine', 'the root cause is the missing iron mine');

  // a circle: the toolsmith waits for coal, the only coal mine waits for a pickaxe only the toolsmith can make
  hh.stock.iron = 6;
  hh.stock.coal = 0;
  hh.stock.pickaxe = 0;
  ts.toolChoice = 'axe'; // coal already on its way must not become the one pickaxe that breaks the circle
  for (const b of h.buildings.values()) b.stock.coal = 0;
  const cm = force(h, 'coalmine', 'sawmill', hh.cx + 2, hh.cz + 10);
  const watch = new StallWatch(P);
  const alerts: Alert[] = [];
  alerts.push(...watch.poll(h));
  check(alerts.length === 0, 'the first look only takes note of what is already stuck');
  until(h, () => ts.stall?.kind === 'input' && ts.stall.goods[0] === 'coal' && cm.stall?.kind === 'tool', 120);
  for (let k = 0; k < 40; k++) { run(h, 1); alerts.push(...watch.poll(h)); }
  c = causeOf(h, ts);
  log('toolsmith:', flat(c));
  const circle = c?.next.find((n) => n.type === 'coalmine')?.next[0];
  check(!!circle && circle.type === 'toolsmith' && /deadlock/.test(circle.text), 'toolsmith → coal mine missing a pickaxe → the toolsmith again: a deadlock');
  const tA = alerts.find((a) => a.kind === 'toolsmith'), tB = alerts.find((a) => a.kind === 'tool' && a.b.id === cm.id);
  log('alerts:', alerts.map((a) => `[${a.kind}] ${a.title} — ${a.detail}${a.hint ? ` (${a.hint})` : ''}`).join(' | '));
  check(!!tA && tA.b.id === ts.id && /no coal/.test(tA.title) && /Coal Mine/.test(tA.detail), 'the toolsmith with no coal raises an alert that names the coal mine');
  check(!!tB && /pickaxe/.test(tB.title) && /Toolsmith/.test(tB.detail), 'the coal mine with no pickaxe raises one that names the toolsmith');
  const n = alerts.length;
  for (let k = 0; k < 30; k++) { run(h, 1); alerts.push(...watch.poll(h)); }
  check(alerts.length === n, 'each only once while the stall lasts');
  void gw;
}

// ---------------------------------------------------------------- alerts (1b)
{
  const h = fresh(seed + 2);
  const hh = h.buildings.get(h.players[P].hq)!;
  const watch = new StallWatch(P);
  const alerts: Alert[] = [];
  const poll = (sec: number) => { for (let k = 0; k < sec; k++) { run(h, 1); alerts.push(...watch.poll(h)); } };
  poll(1);
  // a coal mine on a deposit that is already worked out
  const cm = force(h, 'coalmine', 'sawmill', hh.cx - 8, hh.cz + 4);
  h.world.forRadius(cm.cx, cm.cz, (cm.def.radius ?? 3) + 1.5, (i) => { h.world.ore[i] = 0; h.world.oreAmt[i] = 0; });
  until(h, () => cm.stall?.kind === 'exhausted', 90);
  poll(STALL_GRACE + 2);
  const ex = alerts.filter((a) => a.kind === 'exhausted');
  check(ex.length === 1 && ex[0].b.id === cm.id && /coal is worked out/.test(ex[0].title) && /geologist/.test(ex[0].hint), `a worked-out mine raises one alert, pointing at the mine (${ex[0]?.title})`);
  // nobody free: every carrier turned digger, then two new huts
  for (const s of h.settlers.values()) if (s.owner === P && s.job === 'carrier') s.job = 'digger';
  const f1 = force(h, 'fisher', 'fisher', hh.cx + 6, hh.cz - 6), f2 = force(h, 'fisher', 'fisher', hh.cx - 5, hh.cz - 8);
  poll(STALL_GRACE + 3);
  const st = alerts.filter((a) => a.kind === 'settlers');
  log('alerts:', alerts.map((a) => `[${a.kind}] ${a.title} — ${a.detail}${a.hint ? ` (${a.hint})` : ''}`).join(' | '));
  check(f1.stall?.kind === 'settlers' && f2.stall?.kind === 'settlers', `huts with no free settler say so (${f1.status})`);
  check(st.length === 1 && st[0].count >= 2 && /residence/.test(st[0].hint), `two stuck at once bring one alert that counts them (${st[0]?.title})`);
  force(h, 'fisher', 'fisher', hh.cx + 9, hh.cz + 7);
  poll(STALL_GRACE + 3);
  check(alerts.filter((a) => a.kind === 'settlers').length === 1, 'a third soon after is held back (its badge still shows)');
  check(stalledBuildings(h, P).length >= 4, 'and all of them are on the ⚠ list');
}

// 5. what stalls in an AI town (information: the reasons, how many, for how long, and the chains behind them)
const ai = new Game({ size: 160, seed: seed + 100, players: 2, aiLevel: 2 });
ai.ai.push(new AIController(ai, 0, 2));
for (let k = 0; k < aiMin * 60 * 4; k++) { ai.update(0.25); ai.events.length = 0; }
for (const p of ai.players) {
  const list = stalledBuildings(ai, p.id);
  const by = new Map<string, number[]>();
  for (const b of list) { const r = by.get(b.status) ?? []; r.push(Math.round((ai.time - b.stallT) / 60)); by.set(b.status, r); }
  const total = [...ai.buildings.values()].filter((b) => b.owner === p.id && b.state === 'done').length;
  console.log(`AI ${p.id} at ${aiMin} min: ${list.length} of ${total} buildings stalled${list.length ? ' — ' : ''}${[...by].map(([s, m]) => `${s} ×${m.length} (${m.join('/')} min)`).join('; ')}`);
  const chains = new Map<string, number>();
  for (const b of list) { const t = chainText(causeOf(ai, b)!); chains.set(t, (chains.get(t) ?? 0) + 1); }
  for (const [t, k] of chains) console.log(`   ${k > 1 ? `${k}× ` : ''}${t}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
