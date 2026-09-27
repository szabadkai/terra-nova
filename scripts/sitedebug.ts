import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
const g = new Game({ size: 160, seed: 1234, players: 2, aiLevel: 1 });
g.ai.push(new AIController(g, 0, 1));
for (let s = 0; s < 900; s++) g.update(1);
const w = g.world;
for (const b of g.buildings.values()) {
  if (b.state === 'done') continue;
  console.log('SITE', b.id, b.type, 'p', b.owner, 'state', b.state, 'status', b.status, 'created', b.created.toFixed(0), 'deliv', JSON.stringify(b.delivered), 'inc', b.incoming.board, b.incoming.stone, 'used', b.used, 'work', b.buildWork, '/', b.buildTotal, 'builders', b.builders, 'diggers', b.diggers, 'lvl', b.levelTotal.toFixed(2));
  for (const id of [...b.builders, ...b.diggers]) {
    const s = g.settlers.get(id)!;
    console.log('   crew', id, s.job, 'node', s.node, w.nx(s.node), w.ny(s.node), 'acts', s.actions.map(a => a.k + ('to' in a ? ':' + a.to : '')).join(','), 'hidden', s.hidden);
  }
  // perimeter walkable?
}
const carriers = [...g.settlers.values()].filter(s => s.owner === 0 && s.job === 'carrier');
console.log('P0 carriers', carriers.length, 'idle', carriers.filter(s => s.idle).length, 'home!=0', carriers.filter(s=>s.home).length);
console.log(carriers.slice(0, 50).map(s => `${s.idle ? 'I' : 'B'}:${s.task}:${s.actions.length}:h${s.hidden}`).join(' | '));
for (const b of g.buildings.values()) {
  if (b.state !== 'leveling' || b.owner !== 0) continue;
  const fp = g.footprint(b.size, b.x, b.y); fp.push(b.door);
  console.log('site', b.type, 'at', b.x, b.y, fp.map(i => `${w.nx(i)},${w.ny(i)} h=${w.h[i].toFixed(2)} walk=${w.walkable(i)} blk=${w.blocked[i]} bld=${w.building[i]} water=${w.isWater(i)}`).join('\n   '));
  const d = g.settlers.get(b.diggers[0])!;
  console.log('digger at', w.nx(d.node), w.ny(d.node), 'walkable', w.walkable(d.node), 'blocked', w.blocked[d.node], 'building', w.building[d.node]);
  for (const i of fp) console.log('  path to', w.nx(i), w.ny(i), '=>', g.path.find(d.node, i, false)?.length ?? null);
}
