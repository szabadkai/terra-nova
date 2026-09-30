// Regression checks for adjacent paths into blocked footprints.
// Usage: npx tsx scripts/path.ts
import assert from 'node:assert/strict';
import { PathFinder } from '../src/game/path';
import { World } from '../src/game/world';

const w = new World(160, 160);
w.h.fill(3);
w.region.fill(1);
const pf = new PathFinder(w);
const start = w.idx(20, 80), goal = w.idx(80, 80);
for (let y = 79; y <= 81; y++) for (let x = 79; x <= 81; x++) {
  const i = w.idx(x, y);
  w.blocked[i] = 1;
  w.building[i] = 7;
}
// The pathological case: a worker repeatedly tries to reach something covered by a footprint.
for (let i = 0; i < 600; i++) assert.equal(pf.find(start, goal, true), null);
assert.equal(pf.expansions, 0, 'impossible endpoints must not flood the island');

// A door opens without any cached failure keeping it unreachable.
const door = w.idx(79, 80);
w.blocked[door] = 0;
const path = pf.find(start, goal, true);
assert.ok(path?.length);
assert.equal(path.at(-1), door);
w.blocked[door] = 1;
assert.equal(pf.find(start, goal, true), null);

// The existing exceptions still apply: already adjacent, escaping a footprint, custom walking.
assert.deepEqual(pf.find(w.idx(79, 80), goal, true), []);
assert.deepEqual(pf.find(goal, goal, true), []);
w.blocked[start] = 1;
w.building[start] = 7;
assert.ok(pf.find(start, goal, true), 'a settler can move through his own footprint');
w.blocked[start] = 0;
w.building[start] = 0;
assert.ok(pf.find(start, goal, true, 40000, () => true), 'custom walkers can enter blocked cells');

// Exact walks and endpoints at the edge keep the usual bounds and corner rules.
assert.equal(pf.find(start, goal), null);
w.blocked[goal] = 0;
assert.equal(pf.find(start, goal, true), null, 'an open cell enclosed by a footprint is still unreachable');
const edge = w.idx(0, 0);
for (const i of [edge, 1, w.W, w.W + 1]) w.blocked[i] = 1;
assert.equal(pf.find(start, edge, true), null);
w.blocked[w.W + 1] = 0;
assert.equal(pf.find(start, edge, true)?.at(-1), w.W + 1);
console.log('path checks passed: 600 impossible routes rejected without node expansions');
