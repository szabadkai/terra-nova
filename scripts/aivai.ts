import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
for (const seed of [5, 6]) {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
  g.ai.push(new AIController(g, 0, 1));
  const t0 = Date.now();
  let attacks = 0, captures = 0;
  for (let s = 0; s < 150 * 60; s++) {
    g.update(1);
    for (const e of g.events) { if (e.type === 'attack') attacks++; if (e.type === 'captured') captures++; }
    g.events.length = 0;
    if (g.over) break;
  }
  console.log(`seed ${seed}: t=${Math.round(g.time / 60)}min over=${g.over} winner=${g.winner} attacks=${attacks} captures=${captures} soldiers=${g.population(0).soldiers}/${g.population(1).soldiers} ms=${Date.now() - t0}`);
}
