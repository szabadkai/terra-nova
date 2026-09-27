// Headless check of the religion system: AI vs AI, reporting temples, mana and spells cast.
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
const level = Number(process.argv[2] ?? 1);
for (const seed of [5, 6, 11]) {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: level });
  g.ai.push(new AIController(g, 0, level));
  const t0 = Date.now();
  const spells: Record<string, number> = {};
  let strikes = 0, converted = 0, healed = 0, offerings = 0, attacks = 0, captures = 0;
  const firstTemple: number[] = [-1, -1];
  for (let s = 0; s < 150 * 60; s++) {
    g.update(1);
    for (const e of g.events) {
      if (e.type === 'spell') spells[`${e.owner}:${e.kind}`] = (spells[`${e.owner}:${e.kind}`] ?? 0) + 1;
      if (e.type === 'lightning') strikes++;
      if (e.type === 'converted') converted++;
      if (e.type === 'healed') healed++;
      if (e.type === 'offering') offerings++;
      if (e.type === 'attack') attacks++;
      if (e.type === 'captured') captures++;
    }
    g.events.length = 0;
    for (const p of [0, 1]) if (firstTemple[p] < 0 && g.countBuildings(p, 'temple', false)) firstTemple[p] = Math.round(g.time / 60);
    if (g.over) break;
  }
  const vines = [...g.fields.values()].filter((f) => f.kind === 'vine').length;
  console.log(`seed ${seed}: t=${Math.round(g.time / 60)}min over=${g.over} winner=${g.winner} attacks=${attacks} captures=${captures}`);
  console.log(`  temples at min ${firstTemple} · great=${g.countBuildings(0, 'greattemple', false)}/${g.countBuildings(1, 'greattemple', false)} · vines=${vines} · offerings=${offerings} · mana=${g.players.map((p) => Math.floor(p.mana))}`);
  console.log(`  spells ${JSON.stringify(spells)} strikes=${strikes} converted=${converted} healed=${healed} · ms=${Date.now() - t0}`);
}
