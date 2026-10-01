// Regression checks for adjacent paths into blocked footprints, and for targets walled in (the reach
// labels: every change to walkability bumps world.walkVersion, as the game's own writers do).
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
w.walkVersion++;
// The pathological case: a worker repeatedly tries to reach something covered by a footprint.
for (let i = 0; i < 600; i++) assert.equal(pf.find(start, goal, true), null);
assert.equal(pf.expansions, 0, 'impossible endpoints must not flood the island');

// A door opens without any cached failure keeping it unreachable.
const door = w.idx(79, 80);
w.blocked[door] = 0;
w.walkVersion++;
const path = pf.find(start, goal, true);
assert.ok(path?.length);
assert.equal(path.at(-1), door);
w.blocked[door] = 1;
w.walkVersion++;
assert.equal(pf.find(start, goal, true), null);

// The existing exceptions still apply: already adjacent, escaping a footprint, custom walking.
assert.deepEqual(pf.find(w.idx(79, 80), goal, true), []);
assert.deepEqual(pf.find(goal, goal, true), []);
w.blocked[start] = 1;
w.building[start] = 7;
w.walkVersion++;
assert.ok(pf.find(start, goal, true), 'a settler can move through his own footprint');
w.blocked[start] = 0;
w.building[start] = 0;
w.walkVersion++;
assert.ok(pf.find(start, goal, true, 40000, () => true), 'custom walkers can enter blocked cells');

// Exact walks and endpoints at the edge keep the usual bounds and corner rules.
assert.equal(pf.find(start, goal), null);
w.blocked[goal] = 0;
w.walkVersion++;
assert.equal(pf.find(start, goal, true), null, 'an open cell enclosed by a footprint is still unreachable');
const edge = w.idx(0, 0);
for (const i of [edge, 1, w.W, w.W + 1]) w.blocked[i] = 1;
w.walkVersion++;
assert.equal(pf.find(start, edge, true), null);
w.blocked[w.W + 1] = 0;
w.walkVersion++;
assert.equal(pf.find(start, edge, true)?.at(-1), w.W + 1);

// A tree walled in by rocks (an open patch inside a ring of stones): the walk to it, or beside it,
// fails at once instead of flooding the whole landmass, and works again once a stone is gone.
const tx = 120, ty = 40, tree = w.idx(tx, ty);
for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 3) w.blocked[w.idx(x, y)] = 1;
w.walkVersion++;
const before = pf.expansions;
for (let i = 0; i < 200; i++) { assert.equal(pf.find(start, tree), null); assert.equal(pf.find(start, tree, true), null); }
assert.equal(pf.expansions, before, 'a walled-in target must not flood the island');
w.blocked[w.idx(tx - 3, ty)] = 0;
w.walkVersion++;
assert.equal(pf.find(start, tree)?.at(-1), tree, 'a gap in the ring lets the walk through');
w.blocked[w.idx(tx - 3, ty)] = 1;
// a diagonal gap is no gap: the search never cuts a corner
w.blocked[w.idx(tx - 3, ty - 3)] = 0;
w.walkVersion++;
assert.equal(pf.find(start, tree), null, 'a corner gap is still closed');
console.log('path checks passed: 600 impossible routes and 400 walled-in ones rejected without node expansions');
