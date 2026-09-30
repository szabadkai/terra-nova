// Draws a designed map to look at while working on it, and says what a player would find there.
//   npx tsx scripts/mapshot.ts <recipe id> [out.png] [scale]      the recipe's map as generated
//   npx tsx scripts/mapshot.ts mission <mission id> [out.png]     the game a mission starts with (its setup run, buildings drawn)
// The picture: the minimap's colours with hillshade, sheer rock in charcoal, ore as coloured specks,
// trees and rocks, each start ringed in its player's colour, buildings as squares, and the walking
// route between the first two starts in white.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { World, WATER_LEVEL } from '../src/game/world';
import { generateMap } from '../src/game/mapgen';
import { recipeById, RECIPES } from '../src/game/recipes';
import { PathFinder } from '../src/game/path';
import { Game } from '../src/game/game';
import { missionById } from '../src/game/campaign';
import { ORE_COAL, ORE_GOLD, ORE_IRON, ORE_STONE, PLAYER_COLORS, T_DIRT, T_FOREST, T_GRASS, T_MEADOW, T_ROCK, T_SAND, T_SNOW, T_SWAMP } from '../src/game/defs';

const TCOL: Record<number, [number, number, number]> = {
  [T_GRASS]: [96, 146, 52], [T_MEADOW]: [128, 160, 62], [T_FOREST]: [64, 104, 44], [T_DIRT]: [140, 110, 76],
  [T_SAND]: [214, 194, 140], [T_ROCK]: [128, 122, 114], [T_SNOW]: [236, 240, 246], [T_SWAMP]: [80, 90, 56],
};
const ORECOL: Record<number, [number, number, number]> = { [ORE_COAL]: [30, 30, 30], [ORE_IRON]: [190, 90, 60], [ORE_GOLD]: [250, 210, 60], [ORE_STONE]: [200, 200, 210] };

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

interface Drawn { world: World; starts: { x: number; y: number }[]; trees: Set<number>; stones: Set<number>; buildings: { x: number; y: number; size: number; owner: number; type: string }[] }

function draw(d: Drawn, out: string, scale: number) {
  const w = d.world, S = scale, W = w.W * S, H = w.H * S;
  const img = new Uint8Array(W * H * 3);
  const put = (px: number, py: number, c: [number, number, number]) => { if (px < 0 || py < 0 || px >= W || py >= H) return; const k = (py * W + px) * 3; img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2]; };
  const fill = (x: number, y: number, c: [number, number, number], s0 = 0, s1 = S) => { for (let yy = s0; yy < s1; yy++) for (let xx = s0; xx < s1; xx++) put(x * S + xx, y * S + yy, c); };
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
    const i = w.idx(x, y), h = w.h[i];
    let c: [number, number, number];
    if (h < WATER_LEVEL - 0.02) { const dep = Math.min(1, (WATER_LEVEL - h) / 4); c = [40 - dep * 25, 120 - dep * 60, 150 - dep * 50]; }
    else c = TCOL[w.terrain[i]] ?? [100, 140, 60];
    const hl = x > 0 ? w.h[i - 1] : h, hu = y > 0 ? w.h[i - w.W] : h;
    const shade = 1 + Math.max(-0.35, Math.min(0.35, (hl - h) * 0.25 + (hu - h) * 0.25));
    c = [c[0] * shade, c[1] * shade, c[2] * shade];
    if (w.cliff[i]) c = [c[0] * 0.42, c[1] * 0.42, c[2] * 0.45];
    if (d.trees.has(i)) c = [c[0] * 0.62, c[1] * 0.76, c[2] * 0.58];
    fill(x, y, c.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as [number, number, number]);
    if (d.stones.has(i)) fill(x, y, [168, 166, 158], 1, S - 1);
    if (w.ore[i] && !w.cliff[i]) fill(x, y, ORECOL[w.ore[i]], Math.floor(S / 2) - 1, Math.floor(S / 2) + 1);
  }
  for (const b of d.buildings) {
    const pc = PLAYER_COLORS[b.owner] ?? 0xffffff, c: [number, number, number] = [(pc >> 16) & 255, (pc >> 8) & 255, pc & 255];
    for (let yy = 0; yy < b.size * S; yy++) for (let xx = 0; xx < b.size * S; xx++) {
      const edge = xx < 2 || yy < 2 || xx >= b.size * S - 2 || yy >= b.size * S - 2;
      put(b.x * S + xx, b.y * S + yy, edge ? [20, 16, 12] : c);
    }
  }
  // the walking route between the first two starts
  if (d.starts.length > 1) {
    const pf = new PathFinder(w);
    const a = w.idx(d.starts[0].x, d.starts[0].y + 3), b = w.idx(d.starts[1].x, d.starts[1].y + 3);
    const path = pf.find(a, b, true, 400000);
    console.log(path ? `on foot from start 0 to start 1: ${path.length} steps` : 'NO walking route from start 0 to start 1');
    if (path) for (const n of path) fill(w.nx(n), w.ny(n), [250, 250, 250], 1, S - 1);
  }
  d.starts.forEach((s, p) => {
    const pc = PLAYER_COLORS[p], c: [number, number, number] = [(pc >> 16) & 255, (pc >> 8) & 255, pc & 255];
    for (let a = 0; a < 360; a += 2) for (const r of [6 * S, 6 * S + 1, 6 * S + 2]) put(Math.round((s.x + 0.5) * S + Math.cos(a * Math.PI / 180) * r), Math.round((s.y + 0.5) * S + Math.sin(a * Math.PI / 180) * r), c);
  });
  writeFileSync(out, png(W, H, img));
  console.log(`wrote ${out} (${W}x${H})`);
}

function report(w: World) {
  let cliff = 0, water = 0, rock = 0;
  const ore: Record<number, number> = {};
  for (let i = 0; i < w.N; i++) {
    if (w.cliff[i]) cliff++;
    if (w.isWater(i)) water++;
    if (w.isMountain(i) && !w.cliff[i]) rock++;
    if (w.ore[i] && !w.cliff[i]) ore[w.ore[i]] = (ore[w.ore[i]] ?? 0) + w.oreAmt[i];
  }
  const big = w.regionSize.map((n, id) => ({ id, n })).filter((r) => r.id && r.n > 50).sort((a, b) => b.n - a.n);
  console.log(`sheer rock ${cliff}, water ${water}, open rock ${rock}; landmasses over 50 nodes: ${big.map((r) => r.n).join(', ')}`);
  console.log(`ore on open rock: coal ${ore[ORE_COAL] ?? 0}, iron ${ore[ORE_IRON] ?? 0}, gold ${ore[ORE_GOLD] ?? 0}, granite ${ore[ORE_STONE] ?? 0}`);
}

const [a0, a1, a2, a3] = process.argv.slice(2);
if (!a0) { console.log(`recipes: ${Object.keys(RECIPES).join(', ')}`); process.exit(0); }
if (a0 === 'mission') {
  const m = missionById(a1);
  if (!m) throw new Error(`no mission ${a1}`);
  const g = new Game({ size: m.map.size, seed: m.map.seed, players: m.map.players, aiLevel: m.map.aiLevel, islands: m.map.islands, mission: m.id });
  const probe = m.probe?.(g);
  console.log(`probe: ${probe ?? 'ok'}`);
  report(g.world);
  draw({
    world: g.world, starts: g.starts,
    trees: new Set([...g.trees.values()].map((t) => t.node)), stones: new Set([...g.stones.values()].map((s) => s.node)),
    buildings: [...g.buildings.values()].map((b) => ({ x: b.x, y: b.y, size: b.size, owner: b.owner, type: b.type })),
  }, a2 ?? `${a1}.png`, Number(a3 ?? 4));
} else {
  const r = recipeById(a0);
  if (!r) throw new Error(`no recipe ${a0} (there are: ${Object.keys(RECIPES).join(', ')})`);
  const world = new World(r.size, r.size);
  const t = performance.now();
  const gen = generateMap(world, { size: r.size, seed: 1, players: r.starts.length, recipe: r });
  console.log(`generated in ${(performance.now() - t).toFixed(0)} ms`);
  report(world);
  draw({ world, starts: gen.starts, trees: new Set(gen.trees.map((t) => t.node)), stones: new Set(gen.stones.map((s) => s.node)), buildings: [] }, a1 ?? `${a0}.png`, Number(a2 ?? 4));
}
