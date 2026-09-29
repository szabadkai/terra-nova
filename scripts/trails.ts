// Headless check of the paths worn by traffic (src/render/trails.ts): a walk along a line wears about
// one pass into its middle and a walker keeps to its own side, going back the other side; a path
// halves in a game day and fresh footfall fades in seconds; a walker carried off (a jump) or out of
// sight leaves no track; in a grown town the busiest ways and the doors of working workshops are worn
// while open grass is not, and only a part of the realm is bare; the map comes back from a save
// through the file format, and a save from before it starts from the game's own wear; the game plays
// out exactly as it does with nobody watching; and a look at a grown town costs little.
// Usage: npx tsx scripts/trails.ts [seed] [minutes]
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
import type { Settler } from '../src/game/types';
import { decodeSave, encodeSave, restore, snapshot, type SaveData } from '../src/game/save';
import { TRAIL_RES, TrailMap } from '../src/render/trails';

const seed = Number(process.argv[2] ?? 199);
const minutes = Number(process.argv[3] ?? 20);
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---- one walker on an empty map
type Fake = { settlers: Map<number, Partial<Settler>> };
const walker = (id: number, x: number, z: number): Partial<Settler> => ({ id, x, z, inside: 0, hidden: false, aboard: 0, dead: false });
const texel = (m: TrailMap, x: number, z: number) => Math.round((z + 0.5) * TRAIL_RES - 0.5) * m.W + Math.round((x + 0.5) * TRAIL_RES - 0.5);
/** the most worn texel across the line x = const, and the z it lies at */
const across = (m: TrailMap, x: number, z0: number, z1: number) => {
  let best = 0, at = z0;
  for (let z = z0; z <= z1; z += 1 / TRAIL_RES) { const v = m.acc[texel(m, x, z)]; if (v > best) { best = v; at = z; } }
  return { peak: best, at };
};
{
  const m = new TrailMap(40, 40);
  const s = walker(7, 5, 20);
  const g = { settlers: new Map([[7, s]]) } as Fake;
  const walk = (x0: number, x1: number, speed = 1.6, dt = 1 / 60) => {
    const dir = Math.sign(x1 - x0);
    for (let x = x0; dir * (x1 - x) > 0; x += dir * speed * dt) { s.x = x; m.observe(g as never, dt); }
    s.x = x1;
    for (let k = 0; k < 60; k++) m.observe(g as never, dt);
  };
  walk(5, 35);
  const one = across(m, 20, 18, 22);
  check(one.peak > 0.85 && one.peak < 1.2, `a walk along a line wears about one pass into it (${r2(one.peak)})`);
  const out = one.at;
  walk(35, 5);
  const both = across(m, 20, 18, 22);
  check(Math.abs(out - 20) > 0.05, `the walker keeps to one side of its line (${r2(out - 20)} nodes)`);
  // the way back runs on the other side: going out and back leaves a wider, flatter track
  const wide = (v: number) => { let n = 0; for (let z = 18; z <= 22; z += 1 / TRAIL_RES) if (m.acc[texel(m, 20, z)] > v) n++; return n / TRAIL_RES; };
  check(both.peak < 2 && wide(0.5) > 0.7, `out and back: ${r2(both.peak)} passes at the most, ${wide(0.5)} nodes wide over half a pass`);
  let fr = 0;
  for (let z = 19; z <= 21; z += 1 / TRAIL_RES) fr = Math.max(fr, m.fresh[texel(m, 20, z)]);
  const before = m.acc[texel(m, 20, both.at)];
  // a game day with nobody about
  s.hidden = true;
  let t = 0;
  for (; t < 600; t += 0.5) m.observe(g as never, 0.5);
  const after = m.acc[texel(m, 20, both.at)];
  check(Math.abs(after / before - 0.5) < 0.03, `a path halves in a game day (${r2(after / before)})`);
  let frLeft = 0;
  for (let z = 19; z <= 21; z += 1 / TRAIL_RES) frLeft = Math.max(frLeft, m.fresh[texel(m, 20, z)]);
  check(fr > 0.2 && frLeft === 0, `fresh footfall (${r2(fr)} ten seconds on) is gone after a while`);
  // carried off: no track
  s.hidden = false;
  m.observe(g as never, 0.1);
  const sum = () => { let a = 0; for (let i = 0; i < m.acc.length; i++) a += m.acc[i]; return a; };
  const s0 = sum();
  s.x = 5; s.z = 5; m.observe(g as never, 0.1);
  s.x = 30; s.z = 30; m.observe(g as never, 0.1);
  for (let k = 0; k < 30; k++) m.observe(g as never, 1 / 30);
  check(sum() <= s0 * 1.0001, 'a walker that jumps (put on a ship, loaded) leaves no track');
  // looked at seldom (a slow frame at four times the speed: 0.64 nodes between looks), a walk still
  // wears an even line, not a string of beads
  {
    const m3 = new TrailMap(40, 40);
    const s3 = walker(9, 5, 30);
    const g3 = { settlers: new Map([[9, s3]]) } as Fake;
    for (let x = 5; x < 35; x += 0.64) { s3.x = x; m3.observe(g3 as never, 0.4); }
    let lo = Infinity, hi = 0;
    for (let x = 15; x <= 25; x += 1 / TRAIL_RES) { const p = across(m3, x, 28, 32).peak; lo = Math.min(lo, p); hi = Math.max(hi, p); }
    check(lo / hi > 0.9 && hi < 1.2, `a walk looked at seldom still wears an even line (${r2(lo)}-${r2(hi)} passes along it)`);
  }
  // a staircase of node steps (E, NE, E, NE…) is worn as one smooth line: the worn middle keeps to
  // within a third of a node of the straight line from end to end
  const m2 = new TrailMap(40, 40);
  const s2 = walker(8, 4, 10);
  const g2 = { settlers: new Map([[8, s2]]) } as Fake;
  const pts: [number, number][] = [[4, 10]];
  for (let k = 0; k < 20; k++) { const [x, z] = pts[pts.length - 1]; pts.push(k % 2 ? [x + 1, z + 1] : [x + 1, z]); }
  for (let rep = 0; rep < 6; rep++) {
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (1.6 / 60));
      for (let i = 1; i <= n; i++) { s2.x = ax + ((bx - ax) * i) / n; s2.z = az + ((bz - az) * i) / n; m2.observe(g2 as never, 1 / 60); }
    }
    s2.hidden = true; m2.observe(g2 as never, 1 / 60); s2.hidden = false; s2.x = 4; s2.z = 10; m2.observe(g2 as never, 1 / 60);
  }
  let dev = 0;
  for (let x = 8; x <= 20; x += 1) {
    const zLine = 10 + (x - 4) * 0.5;
    const a = across(m2, x, zLine - 1.5, zLine + 1.5);
    dev = Math.max(dev, Math.abs(a.at - zLine));
  }
  check(dev < 0.34, `a staircase of node steps is worn as a smooth line (within ${r2(dev)} of it)`);
}

// ---- a grown town
const setup = () => {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1, islands: true });
  g.ai.push(new AIController(g, 0, 2));
  return g;
};
const fingerprint = (g: Game) => {
  let h = 0;
  for (const s of g.settlers.values()) h = (h * 31 + Math.round(s.x * 100) * 7 + Math.round(s.z * 100) + s.node) % 1e9;
  for (const b of g.buildings.values()) h = (h * 31 + b.id + Math.round(b.workT * 10)) % 1e9;
  return `${g.settlers.size}/${g.buildings.size}/${g.rng.state}/${h}`;
};
const a = setup(), b = setup();
const map = new TrailMap(a.world.W, a.world.H);
const STEP = 0.25;
let obsMs = 0;
for (let t = 0; t < minutes * 60; t += STEP) {
  a.update(STEP); a.events.length = 0;
  const t0 = performance.now();
  map.observe(a, STEP);
  obsMs += performance.now() - t0;
  b.update(STEP); b.events.length = 0;
}
check(fingerprint(a) === fingerprint(b), `the game plays out exactly as with nobody watching (${fingerprint(a)})`);
{
  const w = a.world;
  const worn = (i: number) => map.wornAt(w.nx(i), w.ny(i));
  // the ways to the woodcutters, the quarries and the sawmills, which have been busy from the start
  // (a workshop that stood waiting for its inputs, or was built late, has only a faint track)
  const near = (i: number) => { let mx = 0; w.forRadius(w.nx(i), w.ny(i), 1.5, (j) => { mx = Math.max(mx, worn(j)); }); return mx; };
  const doors: number[] = [];
  for (const bl of a.buildings.values()) {
    if (bl.owner !== 0 || bl.state !== 'done' || !['woodcutter', 'stonecutter', 'sawmill'].includes(bl.type)) continue;
    doors.push(near(bl.door));
  }
  check(doors.length >= 4 && doors.every((v) => v > 0.45), `the ways to the woodcutters, quarries and sawmills are worn (${doors.map(r2).join(' ')})`);
  const hq = a.buildings.get(a.players[0].hq)!;
  check(worn(hq.door) > 0.9, `the HQ's door is trodden bare (${r2(worn(hq.door))})`);
  // the game's own wear marks the nodes walked most in the last minutes: they are worn here too
  let busy = 0, busyWorn = 0;
  for (let i = 0; i < w.N; i++) if (w.wear[i] > 0.2) { busy++; busyWorn += worn(i); }
  check(busy > 10 && busyWorn / busy > 0.6, `the ground the game counts as busiest is worn (${busy} nodes, ${r2(busyWorn / busy)} on average)`);
  // open grass away from everything
  let open = 0, openWorn = 0;
  for (let i = 0; i < w.N; i++) {
    const x = w.nx(i), y = w.ny(i);
    if (!w.walkable(i) || w.terrain[i] > 2) continue;
    let near = false;
    for (const bl of a.buildings.values()) if (Math.hypot(bl.cx - x, bl.cz - y) < 14) { near = true; break; }
    if (near) continue;
    open++; openWorn += worn(i) > 0.5 ? 1 : 0;
  }
  check(open > 500 && openWorn / open < 0.02, `open grass far from any building is not (${openWorn} of ${open} nodes)`);
  // only a part of the realm is bare: paths, not a trodden field
  let realm = 0, bare = 0;
  for (let i = 0; i < w.N; i++) if (w.owner[i] === 0 && w.walkable(i)) { realm++; if (worn(i) > 0.6) bare++; }
  check(bare > 30 && bare / realm < 0.2, `a part of the realm is trodden bare: ${bare} of ${realm} nodes (${Math.round((100 * bare) / realm)}%)`);
  const calls = (minutes * 60) / STEP;
  console.log(`     ${a.settlers.size} settlers; a look over ${STEP} s costs ${r2(obsMs / calls)} ms`);
}

// ---- cost at play speed: a look a frame at 60 fps in the grown town
{
  const t0 = performance.now();
  const n = 600;
  for (let k = 0; k < n; k++) { a.update(1 / 60); a.events.length = 0; }
  const sim = performance.now() - t0;
  const m = new TrailMap(a.world.W, a.world.H);
  m.load(a, map.save());
  const t1 = performance.now();
  for (let k = 0; k < n; k++) { a.update(1 / 60); a.events.length = 0; m.observe(a, 1 / 60); }
  const per = (performance.now() - t1 - sim) / n;
  check(per < 0.15, `a look a frame at 60 fps costs ${r2(per)} ms (${a.settlers.size} settlers)`);
}

// ---- a save keeps the map
{
  const ui = { trails: map.save() };
  const data = await decodeSave(await encodeSave(snapshot(a, ui)));
  const g2 = restore(data);
  const m2 = new TrailMap(g2.world.W, g2.world.H);
  m2.load(g2, (data.ui as { trails?: never }).trails);
  let same = 0, off = 0;
  for (let t = 0; t < map.acc.length; t++) {
    const d = Math.abs(m2.bytes[t * 2] - map.bytes[t * 2]);
    if (d === 0) same++;
    if (d > 1) off++;
  }
  check(off === 0 && same > map.acc.length * 0.99, `the worn map comes back from a save file (${map.acc.length - same} texels a step of 255 off, ${off} further)`);
  // a save from before the paths: the busiest ways start off from the game's own wear
  const old: SaveData = { ...data, ui: {} };
  const g3 = restore(old);
  const m3 = new TrailMap(g3.world.W, g3.world.H);
  m3.load(g3, (old.ui as { trails?: never }).trails);
  const hq = g3.buildings.get(g3.players[0].hq)!;
  let seeded = 0;
  for (let i = 0; i < m3.acc.length; i++) if (m3.bytes[i * 2] > 128) seeded++;
  check(seeded > 20 && m3.wornAt(g3.world.nx(hq.door), g3.world.ny(hq.door)) > 0.3, `a save from before paths starts from the game's wear (${seeded} texels worn over half)`);
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
