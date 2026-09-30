// Headless check of maps of the players' own (src/game/map.ts): the generator's map captured as data
// plays exactly as its seed does; a map scripted from a blank sea with the builder's API passes its
// own checks, starts a game, is played by two computer kingdoms and stays deterministic (two games
// from one map, and a save of one restored, agree hash for hash); a map file round-trips; the checks
// refuse what they should (a start in the water, more players than starts, a foreign file); a cut
// patch pasted back leaves the map as it was; a map of an odd size plays. Usage: npx tsx scripts/mapedit.ts [minutes]
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
import { stateHash } from '../src/game/hash';
import { MapBuilder, decodeMap, encodeMap, generatedMap, mapError, type MapData } from '../src/game/map';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import { ORE_COAL, ORE_GOLD, ORE_IRON, T_FOREST, T_MEADOW } from '../src/game/defs';
import { WATER_LEVEL } from '../src/game/world';

const minutes = Number(process.argv[2] ?? 8);
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const note = (what: string) => console.log(`     ${what}`);
const run = (g: Game, sec: number, dt = 0.25) => { for (let k = 0; k < sec / dt; k++) { g.update(dt); g.events.length = 0; } };
const json = (d: MapData) => JSON.stringify(d, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array).join(',') : v));
const t0 = Date.now();

// ---- the generator's map, captured, plays as its seed does
{
  const seed = 199;
  const data = generatedMap(160, seed, 2, true);
  check(mapError(data) === null, 'the generator\'s map passes the format check');
  const a = new Game({ size: 160, seed, players: 2, aiLevel: 1, islands: true });
  const b = new Game({ size: 160, seed, players: 2, aiLevel: 1, islands: true, map: data });
  check(stateHash(a) === stateHash(b), 'a game on the captured map starts as the seed\'s game does');
  run(a, 180); run(b, 180);
  check(stateHash(a) === stateHash(b), 'and plays the same for three minutes');
  const bb = MapBuilder.from(data);
  const problems = bb.validate();
  check(!problems.some((p) => p.level === 'error'), `the generator's map has no errors (${problems.length} notes)`);
  for (const p of problems) note(`${p.level}: ${p.text}`);
}

// ---- a map scripted from a blank sea
function scripted(size = 160, seed = 7): MapBuilder {
  const m = MapBuilder.blank(size, 'sea', seed);
  const c = size / 2;
  m.island(c, c, size * 0.42, 1.6);
  m.hills(c, c, size * 0.4, 0.5, 14);
  m.mountain(c - size * 0.22, c - size * 0.2, 13, 7);
  m.mountain(c + size * 0.22, c + size * 0.2, 13, 7);
  m.mountain(c, c, 9, 6);
  m.lake(c - size * 0.05, c + size * 0.18, 7, 1.6);
  m.lake(c + size * 0.05, c - size * 0.18, 7, 1.6);
  m.carve([{ x: c - 10, y: c + size * 0.18 }, { x: c - 30, y: c + size * 0.3 }, { x: c - 45, y: c + size * 0.45 }], 2.5, 3);
  m.autoTerrain();
  for (const [x, y] of [[c - size * 0.22, c - size * 0.2], [c + size * 0.22, c + size * 0.2]]) {
    m.paintOre(x - 4, y - 3, 4, ORE_COAL, 16);
    m.paintOre(x + 4, y + 3, 4, ORE_IRON, 16);
    m.paintOre(x, y - 5, 3, ORE_GOLD, 12);
  }
  m.paintOre(c, c, 4, ORE_COAL, 14);
  m.setStart(0, Math.round(c - size * 0.25), Math.round(c + size * 0.05));
  m.setStart(1, Math.round(c + size * 0.25), Math.round(c - size * 0.05));
  for (const s of m.starts) {
    if (!s) continue;
    m.paint(s.x - 12, s.y - 8, 7, T_FOREST);
    m.plant(s.x - 12, s.y - 8, 8, 0.6);
    m.plant(s.x + 10, s.y + 9, 7, 0.45);
    m.scatterStones(s.x + 12, s.y - 6, 3.5, 0.5, 9);
    m.paint(s.x, s.y + 14, 5, T_MEADOW);
    m.herd(s.x - 14, s.y + 14, 4);
  }
  m.plant(c, c + size * 0.3, 14, 0.2);
  m.stockFish(c, c, size * 0.5, 4);
  m.name = 'Twin Peaks';
  m.author = 'scripts/mapedit.ts';
  return m;
}
{
  const m = scripted();
  const problems = m.validate();
  for (const p of problems) note(`${p.level}: ${p.text}`);
  check(!problems.some((p) => p.level === 'error'), 'the scripted map has no errors');
  const st = m.stats();
  note(`land ${st.land} water ${st.water} mountain ${st.mountain} trees ${st.trees} rocks ${st.stones} (${st.stone} stone) fish ${st.fish} deer ${st.deer} coal ${st.coal} iron ${st.iron} gold ${st.gold}`);
  check(st.land > 8000 && st.mountain > 300 && st.trees > 200 && st.coal > 0 && st.iron > 0 && st.fish > 0, 'it holds land, mountains, woods, ore and fish');
  const data = m.toData();
  check(json(MapBuilder.from(data).toData()) === json(data), 'data → builder → data is the identity');
  const file = await encodeMap(data);
  const back = await decodeMap(file);
  check(json(back) === json(data), `a map file round-trips (${(file.length / 1024).toFixed(0)} KB)`);

  // two games from one map agree, and a save of one restored agrees too
  const a = new Game({ size: 160, seed: 5, players: 2, aiLevel: 1, map: data });
  const b = new Game({ size: 160, seed: 5, players: 2, aiLevel: 1, map: data });
  a.ai.push(new AIController(a, 0, 1));
  b.ai.push(new AIController(b, 0, 1));
  check(a.starts.length === 2 && a.buildings.size === 2, 'two headquarters stand on the two starts');
  check(stateHash(a) === stateHash(b), 'two games from one map start alike');
  run(a, minutes * 60); run(b, minutes * 60);
  check(stateHash(a) === stateHash(b), `and agree after ${minutes} minutes of two computer kingdoms`);
  const built = a.players.map((p) => a.countBuildings(p.id, undefined, false));
  note(`buildings after ${minutes} min: ${built.join(' / ')}, population ${a.players.map((p) => a.population(p.id).total).join(' / ')}`);
  check(built.every((n) => n >= 6), 'both kingdoms build on it');
  const snap = snapshot(a);
  check(snap.opts.map?.name === 'Twin Peaks' && snap.opts.map.h instanceof Float32Array, 'the save carries the map');
  const r = restore(await decodeSave(await encodeSave(snap)));
  check(r.opts.map?.name === 'Twin Peaks', 'and a restored game knows it');
  const r2 = restore(snapshot(a));
  run(r, 60); run(r2, 60);
  check(stateHash(r) === stateHash(r2), 'two restores of the game on the map agree');
}

// ---- refusals
{
  const m = scripted();
  const p0 = m.starts[0]!;
  m.setStart(0, p0.x, p0.y, false);
  m.h.fill(WATER_LEVEL - 1, m.idx(p0.x - 1, p0.y - 1), m.idx(p0.x + 3, p0.y - 1));
  check(m.validate().some((p) => p.level === 'error' && /in the water/.test(p.text)), 'a headquarters in the water is an error');
  check(!m.playable, 'and the map is not playable');
  m.prepareStart(p0.x, p0.y);
  check(m.playable, 'preparing the start lifts it out again');
  let threw = '';
  try { new Game({ size: 160, seed: 1, players: 3, aiLevel: 1, map: m.toData() }); } catch (e) { threw = (e as Error).message; }
  check(/starts for 2 players, not 3/.test(threw), `three players on a map with two starts is refused: ${threw}`);
  check(mapError({ format: 'terra-nova-save' }) !== null, 'a save is not a map');
  const bad = m.toData();
  bad.h = new Float32Array(10);
  check(mapError(bad) !== null, 'a map with the wrong arrays is refused');
  let notMap = '';
  try { await decodeMap(new Uint8Array([1, 2, 3])); } catch (e) { notMap = (e as Error).message; }
  check(/not a Terra Nova map/.test(notMap), `a foreign file is refused: ${notMap}`);
  let notMap2 = '';
  try { await decodeMap(await encodeSave(snapshot(new Game({ size: 128, seed: 1, players: 2, aiLevel: 1 })))); } catch (e) { notMap2 = (e as Error).message; }
  check(/not a Terra Nova map/.test(notMap2), `a save file is refused as a map: ${notMap2}`);
}

// ---- a patch cut and pasted back is the identity (the editor's undo)
{
  const m = scripted();
  const before = json(m.toData());
  const rect = { x0: 40, y0: 40, x1: 90, y1: 80 };
  const patch = m.cut(rect);
  let changes = 0;
  m.onChange = () => { changes++; };
  m.raise(60, 60, 12, 3).paint(70, 50, 8, 5).clearTrees(50, 70, 15).scatterStones(60, 60, 10, 0.5).herd(45, 45);
  check(changes >= 5 && json(m.toData()) !== before, `the brushes change the map and report it (${changes} changes)`);
  m.paste(patch);
  check(json(m.toData()) === before, 'pasting the patch back restores it exactly');
}

// ---- an odd size plays; a blank land map too
{
  const m = scripted(96, 3);
  const problems = m.validate();
  for (const p of problems) note(`${p.level}: ${p.text}`);
  check(!problems.some((p) => p.level === 'error'), 'a 96-node map has no errors');
  const g = new Game({ size: 96, seed: 2, players: 2, aiLevel: 1, map: m.toData() });
  g.ai.push(new AIController(g, 0, 1));
  run(g, 240);
  check(g.world.W === 96 && g.countBuildings(0, undefined, false) >= 3, 'and a game runs on it');
  const land = MapBuilder.blank(128, 'land', 9);
  land.setStart(0, 40, 64);
  land.setStart(1, 88, 64);
  land.connect();
  check(!land.validate().some((p) => p.level === 'error'), 'a blank land map with two starts has no errors');
  const g2 = new Game({ size: 128, seed: 2, players: 2, aiLevel: 1, map: land.toData() });
  run(g2, 30);
  check(g2.settlers.size > 40, 'and a game starts on it');
}

console.log(`${fails ? `${fails} check(s) failed` : 'all checks passed'}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(fails ? 1 : 0);
