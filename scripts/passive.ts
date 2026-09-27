import { Game } from '../src/game/game';
for (const lvl of [0, 1, 2]) {
  const g = new Game({ size: 160, seed: 99 + lvl, players: 2, aiLevel: lvl });
  let firstAttack = -1;
  for (let s = 0; s < 90 * 60; s++) {
    g.update(1);
    for (const e of g.events) if (e.type === 'attack' && e.owner === 1 && firstAttack < 0) firstAttack = g.time;
    g.events.length = 0;
    if (g.over) break;
  }
  const p1 = g.population(1);
  console.log(`AI level ${lvl}: firstAttack=${Math.round(firstAttack)}s over=${g.over} winner=${g.winner} t=${Math.round(g.time)} aiSoldiers=${p1.soldiers} aiBuildings=${g.countBuildings(1)} p0alive=${g.players[0].alive}`);
}
