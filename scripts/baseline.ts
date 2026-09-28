// One balance sample, printed as a JSON line, so many can run in parallel and be compared by median.
//   passive <seed> <level> [islands]: the human player does nothing; when does the AI first attack?
//   aivai <seed> <level> [islands]: AI against AI for up to 150 minutes; when (and whether) does it end?
// Each sample also lists what each side is stuck on at the end, followed upstream to its root causes.
// Usage: npx tsx scripts/baseline.ts passive 99 0 1
// Many:  for l in 0 1 2; do for s in 99 199 299 399 499; do echo "passive $((s+l)) $l 1"; done; done | xargs -P 8 -L 1 npx tsx scripts/baseline.ts
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
import { causeLine, causeOf, rootCauses } from '../src/game/causes';
import { stalledBuildings } from '../src/game/status';

const [mode = 'passive', seedS = '99', levelS = '1', islandsS = '1'] = process.argv.slice(2);
const seed = Number(seedS), level = Number(levelS), islands = islandsS !== '0';
const g = new Game({ size: 160, seed, players: 2, aiLevel: level, islands });
if (mode === 'aivai') g.ai.push(new AIController(g, 0, level));
const limit = (mode === 'aivai' ? 150 : 90) * 60;
let firstAttack = -1, attacks = 0, captures = 0, staked = 0, sunk = 0, warships = 0;
const t0 = Date.now();
for (let s = 0; s < limit; s++) {
  g.update(1);
  for (const e of g.events) {
    if (e.type === 'attack') { attacks++; if (firstAttack < 0 && (mode === 'aivai' || e.owner === 1)) firstAttack = g.time; }
    if (e.type === 'captured') captures++;
    if (e.type === 'staked') staked++;
    if (e.type === 'sinking') sunk++;
    if (e.type === 'launch' && g.ships.get(e.s ?? 0)?.kind === 'war') warships++;
  }
  g.events.length = 0;
  if (g.over) break;
}
const out = {
  mode, seed, level, islands,
  firstAttackMin: firstAttack < 0 ? null : Math.round(firstAttack / 6) / 10,
  endMin: g.over ? Math.round(g.time / 6) / 10 : null,
  winner: g.winner, attacks, captures, staked, sunk, warships,
  soldiers: g.players.map((p) => g.population(p.id).soldiers),
  buildings: g.players.map((p) => g.countBuildings(p.id)),
  traded: g.players.map((p) => p.traded),
  // what each side is stuck on at the end, followed upstream to the root causes, by count
  stalls: g.players.map((p) => {
    const by: Record<string, number> = {};
    for (const b of stalledBuildings(g, p.id)) {
      for (const r of rootCauses(causeOf(g, b)!)) { const k = causeLine({ ...r, ids: r.ids.slice(0, 1) }); by[k] = (by[k] ?? 0) + 1; }
    }
    return by;
  }),
  ms: Date.now() - t0,
};
console.log(JSON.stringify(out));
