import { Game } from '../src/game/game';
const g = new Game({ size: 160, seed: 100, players: 2, aiLevel: 1 });
const hq0 = g.buildings.get(g.players[0].hq)!;
for (let s = 0; s < 60 * 60; s++) {
  g.update(1);
  g.events.length = 0;
  if (s % 300 === 0) {
    let mil = 0, sites = 0, closest = Infinity, owned = 0;
    for (const b of g.buildings.values()) {
      if (b.owner !== 1 || !b.def.military) continue;
      if (b.state === 'done') mil++; else sites++;
      closest = Math.min(closest, Math.hypot(b.cx - hq0.cx, b.cz - hq0.cz));
    }
    for (let i = 0; i < g.world.N; i++) if (g.world.owner[i] === 1) owned++;
    const hq1 = g.buildings.get(g.players[1].hq)!;
    let reserve = hq1.garrison.length;
    console.log(`t=${s} mil=${mil} sites=${sites} closestToP0=${closest.toFixed(0)} territory=${owned} hqGarrison=${reserve} soldiers=${g.population(1).soldiers}`);
  }
}
