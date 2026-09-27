import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
const g = new Game({ size: 160, seed: 1234, players: 2, aiLevel: 1 });
g.ai.push(new AIController(g, 0, 1));
for (let s = 0; s < 500; s++) g.update(1);
const w = g.world;
for (const b of g.buildings.values()) {
  if (b.state !== 'leveling') continue;
  console.log('SITE', b.id, b.type, 'owner', b.owner, 'created', b.created.toFixed(0), 'levelTotal', b.levelTotal.toFixed(2), 'target', b.targetH.toFixed(2), 'diggers', b.diggers);
  const fp = g.footprint(b.size, b.x, b.y); fp.push(b.door);
  console.log('  heights', fp.map(i => w.h[i].toFixed(2) + (w.walkable(i) ? '' : '!') + (w.isWater(i)?'W':'')).join(' '));
  for (const id of b.diggers) {
    const s = g.settlers.get(id)!;
    console.log('  digger', id, 'node', s.node, 'next', s.next, 'actions', s.actions.map(a => a.k + ('to' in a ? ':' + a.to : '')).join(','), 'hidden', s.hidden, 'home', s.home);
  }
}
const diggers = [...g.settlers.values()].filter(s => s.job === 'digger');
console.log('all diggers', diggers.map(s => `${s.id}/p${s.owner}/home${s.home}/idle${s.idle}/acts${s.actions.length}`).join(' '));
