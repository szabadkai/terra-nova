// Headless check of geologists: ore starts hidden, a geologist probes a mountain inside the
// borders, leaves signs and reveals the veins; the AI prospects before it builds mines.
// Usage: npx tsx scripts/geology.ts [seed]
import { Game } from '../src/game/game';
import { ORE_NAMES } from '../src/game/defs';
import { sendGeologist, prospectError } from '../src/game/geology';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
const w = g.world;
const P = 0;
const known = (p: number) => { let n = 0; for (let i = 0; i < w.N; i++) if (w.known(i, p)) n++; return n; };
console.log('known at start', known(0), known(1));
// claim the start mountain with an instant tower so there is rock inside the borders
const hq = g.buildings.get(g.players[P].hq)!;
let mtn = -1, bd = Infinity;
for (let i = 0; i < w.N; i++) if (w.isMountain(i) && w.ore[i]) { const d = Math.hypot(w.nx(i) - hq.cx, w.ny(i) - hq.cz); if (d < bd) { bd = d; mtn = i; } }
console.log('nearest ore rock', w.nx(mtn), w.ny(mtn), 'dist', bd.toFixed(1));
let placed = null as any;
for (let r = 0; r < 12 && !placed; r++) for (let a = 0; a < 16 && !placed; a++) {
  const x = Math.round(hq.cx + (w.nx(mtn) - hq.cx) * 0.6 + Math.cos(a) * r), y = Math.round(hq.cz + (w.ny(mtn) - hq.cz) * 0.6 + Math.sin(a) * r);
  const t = g.addBuilding('castle', P, x, y, true);
  if (!t) continue;
  placed = t;
}
placed.occupied = true;
g.territoryDirty = true;
g.update(0.1);
console.log('mountain owned?', w.owner[mtn] === P, 'error:', prospectError(g, P, w.nx(mtn), w.ny(mtn)));
console.log('send:', sendGeologist(g, P, w.nx(mtn), w.ny(mtn)) ?? 'ok');
for (let s = 0; s < 8 * 60; s++) {
  g.update(1);
  if (s % 60 === 0) {
    const geo = [...g.settlers.values()].find((x) => x.owner === P && (x.job === 'geologist' || x.task.startsWith('Prospect')));
    console.log(`t=${s}s geologist=${geo ? `${geo.job} "${geo.task}"` : '-'} signs=${[...g.signs.values()].filter((x) => x.owner === P).map((x) => `${ORE_NAMES[x.ore]}:${x.amt}`).join(' ')} known=${known(0)}`);
  }
}
// the AI's own prospecting over a normal game start
const g2 = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
let firstMine = -1, firstSign = -1;
for (let s = 0; s < 40 * 60; s++) {
  g2.update(1);
  if (firstSign < 0 && [...g2.signs.values()].some((x) => x.owner === 1)) firstSign = s;
  if (firstMine < 0 && [...g2.buildings.values()].some((b) => b.owner === 1 && b.def.mine)) firstMine = s;
}
console.log(`AI: first sign at ${Math.round(firstSign / 60)}min, first mine at ${Math.round(firstMine / 60)}min, mines=${[...g2.buildings.values()].filter((b) => b.owner === 1 && b.def.mine).map((b) => b.type).join(',')}`);
