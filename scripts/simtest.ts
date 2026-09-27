import { Game } from '../src/game/game';
import { GOODS } from '../src/game/defs';

const g = new Game({ size: 160, seed: Number(process.argv[2] ?? 1234), players: 2, aiLevel: 1 });
console.log('starts', g.starts, 'trees', g.trees.size, 'stones', g.stones.size, 'deer', g.animals.size);
// Let player 0 be driven by an AI too for testing
import { AIController } from '../src/game/ai';
g.ai.push(new AIController(g, 0, 1));
const t0 = Date.now();
const minutes = Number(process.argv[3] ?? 20);
for (let s = 0; s < minutes * 60; s++) {
  g.update(1);
  if (s % 120 === 0) {
    for (const p of g.players) {
      const pop = g.population(p.id);
      const st = g.totalStock(p.id);
      const types: Record<string, number> = {};
      for (const b of g.buildings.values()) if (b.owner === p.id) types[b.type + (b.state !== 'done' ? '*' : '')] = (types[b.type + (b.state !== 'done' ? '*' : '')] ?? 0) + 1;
      console.log(`t=${s}s P${p.id} alive=${p.alive} pop=${JSON.stringify(pop)}`);
      console.log('   stock', GOODS.filter((x) => st[x]).map((x) => `${x}:${st[x]}`).join(' '));
      console.log('   bld', JSON.stringify(types));
    }
  }
}
console.log('sim ms', Date.now() - t0, 'expansions', g.path.expansions);
const statuses: Record<string, number> = {};
for (const b of g.buildings.values()) statuses[b.type + ':' + b.status] = (statuses[b.type + ':' + b.status] ?? 0) + 1;
console.log(statuses);
