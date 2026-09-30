// Free play's maps must not change when the generator is worked on (mapgen.ts, recipes.ts): 240 maps
// - three sizes, one to four players, islands on and off, ten seeds - each hashed over every world
// array and the generator's lists, against the fingerprints in scripts/mapprint.txt.
//   npx tsx scripts/mapprint.ts           check
//   npx tsx scripts/mapprint.ts --write   record the fingerprints anew (only when a change to free play's maps is meant)
import { readFileSync, writeFileSync } from 'node:fs';
import { World } from '../src/game/world';
import { generateMap } from '../src/game/mapgen';

const fnv = (bytes: Uint8Array, h = 2166136261) => { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const enc = new TextEncoder();
// (arrays added to the world for designed maps only, all zero in free play, stay out of the hash)
const DESIGN_ONLY = new Set(['cliff']);
const out: string[] = [];
for (const size of [128, 160, 208]) for (const players of [1, 2, 3, 4]) for (const islands of [true, false]) for (const seed of [1, 3, 7, 9, 12, 27, 29, 199, 4242, 77777]) {
  const w = new World(size, size);
  const r = generateMap(w, { size, seed, players, islands });
  let h = 2166136261;
  for (const [k, v] of Object.entries(w)) if (ArrayBuffer.isView(v) && !DESIGN_ONLY.has(k)) h = fnv(bytesOf(v), fnv(enc.encode(k), h));
  h = fnv(enc.encode(JSON.stringify(r) + JSON.stringify(w.seaSize) + JSON.stringify(w.regionSize)), h);
  out.push(`${size} ${players} ${islands ? 'i' : '-'} ${seed} ${h.toString(16)}`);
}
const file = new URL('./mapprint.txt', import.meta.url);
if (process.argv.includes('--write')) { writeFileSync(file, out.join('\n') + '\n'); console.log(`recorded ${out.length} fingerprints`); process.exit(0); }
const want = readFileSync(file, 'utf8').trim().split('\n');
const bad = out.filter((l, i) => l !== want[i]);
console.log(bad.length ? `FAIL ${bad.length} of ${out.length} free-play maps changed: ${bad.slice(0, 5).join(', ')}` : `ok   all ${out.length} free-play maps as recorded`);
process.exit(bad.length ? 1 : 0);
