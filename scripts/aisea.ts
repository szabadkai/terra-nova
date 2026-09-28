// Headless AI-vs-AI check of seafaring: harbours, ships, colonies and overseas trade, plus game length.
// Usage: npx tsx scripts/aisea.ts [level] [minutes]
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
const level = Number(process.argv[2] ?? 1), minutes = Number(process.argv[3] ?? 120);
for (const seed of [5, 6, 11]) {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: level });
  g.ai.push(new AIController(g, 0, level));
  const t0 = Date.now();
  const first: Record<string, number> = {};
  let landings = 0, launches = 0, deliveries = 0;
  const mark = (k: string) => { if (first[k] === undefined) first[k] = Math.round(g.time / 60); };
  for (let s = 0; s < minutes * 60; s++) {
    g.update(1);
    for (const e of g.events) {
      if (e.type === 'launch') { launches++; mark(`ship${e.owner}`); }
      if (e.type === 'landed') { landings++; mark(`colony${e.owner}`); }
      if (e.type === 'unloaded') deliveries++;
    }
    g.events.length = 0;
    for (const p of [0, 1]) if (g.countBuildings(p, 'harbour', false)) mark(`harbour${p}`);
    if (g.over) break;
  }
  const home = g.players.map((p) => { const hq = g.buildings.get(p.hq); return hq ? g.world.region[hq.door] : -1; });
  const overseas = g.players.map((p) => [...g.buildings.values()].filter((b) => b.owner === p.id && g.world.region[b.door] !== home[p.id]).map((b) => b.type));
  console.log(`seed ${seed}: t=${Math.round(g.time / 60)}min over=${g.over} winner=${g.winner} first=${JSON.stringify(first)} launches=${launches} landings=${landings} deliveries=${deliveries} ms=${Date.now() - t0}`);
  console.log(`  overseas P0: ${overseas[0].join(',') || '-'} | P1: ${overseas[1].join(',') || '-'} | pop ${g.players.map((p) => g.population(p.id).total)}`);
}
