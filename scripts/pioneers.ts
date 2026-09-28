// Headless check of pioneers: carriers pick up shovels, stake out the free land beside the
// border around a chosen spot, the land survives territory recomputes, can be built on, and
// a foreign stronghold takes it for good.
// Usage: npx tsx scripts/pioneers.ts [seed]
import { Game } from '../src/game/game';
import { pioneerError, pioneersAtWork, sendPioneer } from '../src/game/pioneers';
import { recomputeTerritory } from '../src/game/military';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
const w = g.world;
const P = 0;
const owned = (p: number) => { let n = 0; for (let i = 0; i < w.N; i++) if (w.owner[i] === p) n++; return n; };
const claimed = (p: number) => { let n = 0; for (let i = 0; i < w.N; i++) if (w.claim[i] === p) n++; return n; };
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

// the AI must not interfere
g.ai.length = 0;
const hq = g.buildings.get(g.players[P].hq)!;
// a spot 3 nodes beyond the border, on land, in the direction away from the map edge
let spot: { x: number; z: number } | null = null;
for (let k = 0; k < 32 && !spot; k++) {
  const a = (k / 32) * Math.PI * 2;
  for (let r = 10; r < 30; r++) {
    const x = Math.round(hq.cx + Math.cos(a) * r), z = Math.round(hq.cz + Math.sin(a) * r);
    if (!w.inBounds(x, z)) break;
    const i = w.idx(x, z);
    if (w.owner[i] === P) continue;
    if (w.isWater(i)) break;
    const x2 = Math.round(hq.cx + Math.cos(a) * (r + 3)), z2 = Math.round(hq.cz + Math.sin(a) * (r + 3));
    if (w.inBounds(x2, z2) && !w.isWater(w.idx(x2, z2)) && pioneerError(g, P, x2, z2) === null) spot = { x: x2, z: z2 };
    break;
  }
}
if (!spot) { console.log('no spot beside the border'); process.exit(1); }
console.log('spot', spot, 'owned at start', owned(P));
check(pioneerError(g, P, hq.cx, hq.cz) !== null, `own land rejected: "${pioneerError(g, P, hq.cx, hq.cz)}"`);
const far = { x: Math.round(hq.cx + (spot.x - hq.cx) * 3), z: Math.round(hq.cz + (spot.z - hq.cz) * 3) };
if (w.inBounds(far.x, far.z)) check(pioneerError(g, P, far.x, far.z) !== null, `far land rejected: "${pioneerError(g, P, far.x, far.z)}"`);
const shovels0 = g.totalStock(P).shovel;
for (let k = 0; k < 3; k++) check(sendPioneer(g, P, spot.x, spot.z) === null, `pioneer ${k + 1} sent`);
g.update(1);
const before = owned(P);
let doneAt = -1;
for (let t = 0; t < 8 * 60; t++) {
  g.update(1);
  const busy = pioneersAtWork(g, P);
  if (t % 30 === 0) console.log(`t=${t}s pioneers at work ${busy}, owned ${owned(P)}, staked ${claimed(P)}`);
  if (t > 5 && busy === 0 && doneAt < 0) { doneAt = t; break; }
}
check(doneAt > 0, `pioneers finished (${doneAt}s)`);
const pioneers = [...g.settlers.values()].filter((s) => s.owner === P && s.job === 'pioneer');
check(pioneers.length === 3, `three pioneers (${pioneers.length})`);
check(g.totalStock(P).shovel === shovels0 - 3, `three shovels taken (${shovels0} -> ${g.totalStock(P).shovel})`);
const gained = owned(P) - before;
check(gained > 40, `territory grew by ${gained} nodes`);
check(w.owner[w.idx(spot.x, spot.z)] === P, 'the spot itself is ours');
// staked land survives a recompute
const snap = owned(P);
recomputeTerritory(g);
check(owned(P) === snap, `recompute keeps staked land (${snap} -> ${owned(P)})`);
// build on it
let built = false;
w.forRadius(spot.x, spot.z, 5, (i, x, y) => {
  if (built) return;
  const a = g.anchorFor('woodcutter', x, y);
  if (g.canPlace('woodcutter', P, a.x, a.y) && w.claim[w.idx(a.x, a.y)] === P) { g.placeBuilding('woodcutter', P, a.x, a.y); built = true; }
});
check(built, 'a woodcutter can be placed on staked land');
// the pioneers can be sent again (reuse, no new shovels)
const shovels1 = g.totalStock(P).shovel;
const spot2 = { x: Math.round(spot.x + (spot.x - hq.cx) * 0.25), z: Math.round(spot.z + (spot.z - hq.cz) * 0.25) };
const err2 = pioneerError(g, P, spot2.x, spot2.z);
if (!err2) {
  sendPioneer(g, P, spot2.x, spot2.z);
  g.update(2);
  check(g.totalStock(P).shovel === shovels1, 'an idle pioneer is reused');
} else console.log('(no second spot:', err2, ')');
// an enemy stronghold takes the staked land
const e = g.addBuilding('castle', 1, spot.x - 1, spot.z - 1, true);
e.occupied = true;
recomputeTerritory(g);
check(w.owner[w.idx(spot.x, spot.z)] === 1 && w.claim[w.idx(spot.x, spot.z)] === -1, 'a foreign castle takes it for good');
g.finalRemove(e);
recomputeTerritory(g);
check(w.owner[w.idx(spot.x, spot.z)] !== P, 'and it stays lost when the castle goes');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
