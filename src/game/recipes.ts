// The campaign's designed maps (CAMPAIGN.md): each a recipe on top of the generator (mapgen.ts) - where
// the starts stand, the forests, rocks and veins, and the carving of the land, with sheer rock where
// nobody may pass. A recipe is data; `npx tsx scripts/mapshot.ts <id>` draws one to look at.
import { ORE_COAL, ORE_GOLD, ORE_IRON, ORE_STONE } from './defs';
import type { MapRecipe } from './mapgen';
import { cos, sin } from '../core/fmath';

/**
 * Saltus, the pass. An inland map cut in two from north to south by a wall of mountains. The legate's
 * valley lies west: woods, a lake, a small mountain with coal and iron in the south-west. The one good
 * road east goes through the pass in the middle; a goat path climbs the wall in the far north. Beyond,
 * Varro's side: a fort at the eastern mouth of the pass, his camp further east, and the gold.
 */
const SALTUS: MapRecipe = {
  id: 'saltus',
  size: 160,
  frame: 'land',
  mountains: false,
  lakes: false,
  starts: [[34, 92], [134, 70]],
  forests: [
    { x: 21, y: 80, r: 6 }, { x: 48, y: 104, r: 6 },
    { x: 18, y: 58, r: 10 }, { x: 44, y: 60, r: 6 }, { x: 22, y: 146, r: 8 }, { x: 58, y: 126, r: 7 },
    { x: 112, y: 30, r: 9 }, { x: 146, y: 112, r: 9 }, { x: 118, y: 128, r: 6 },
  ],
  rocks: [{ x: 46, y: 83, r: 2.8 }, { x: 16, y: 104, r: 2.6 }, { x: 60, y: 70, r: 3 }, { x: 146, y: 88, r: 3 }, { x: 108, y: 58, r: 2.4 }],
  lakeBlobs: [{ x: 14, y: 94, r: 7 }, { x: 150, y: 40, r: 6 }],
  peaks: [{ x: 30, y: 124, r: 11 }, { x: 118, y: 108, r: 10 }],
  carve: [
    // the wall, north to south, with a bend where the pass goes through
    { op: 'range', path: [[86, -6], [80, 30], [84, 62], [80, 88], [76, 116], [82, 166]], width: 13, height: 10, wall: true },
    // the pass: a saddle and a road through it
    { op: 'gap', at: [80, 88], r: 8, height: 2.0 },
    { op: 'road', path: [[60, 90], [80, 88], [100, 84]], width: 4.5, height: 1.7 },
    // the goat path in the far north: narrow and high
    { op: 'gap', at: [81, 26], r: 8.5, height: 4.4 },
    // walls on the map's edges, so the valleys end in mountains, not at the world's rim
    { op: 'range', path: [[-4, -4], [164, -4]], width: 9, height: 9, wall: true },
    { op: 'range', path: [[-4, 164], [164, 164]], width: 9, height: 9, wall: true },
    { op: 'range', path: [[-4, -4], [-4, 164]], width: 9, height: 9, wall: true },
    { op: 'range', path: [[164, -4], [164, 164]], width: 9, height: 9, wall: true },
    // the ground where the fort and the camp stand
    { op: 'flat', at: [104, 84], r: 5, height: 1.6 },
    { op: 'flat', at: [134, 70], r: 10 },
  ],
  ore: [
    { at: [26, 121], r: 3.5, kind: ORE_COAL, amt: [12, 20] },
    { at: [35, 127], r: 3.5, kind: ORE_IRON, amt: [12, 20] },
    { at: [24, 130], r: 2.5, kind: ORE_STONE, amt: [10, 16] },
    { at: [34, 118], r: 2.5, kind: ORE_COAL, amt: [10, 16] },
    { at: [116, 104], r: 3, kind: ORE_GOLD, amt: [14, 22] },
    { at: [121, 111], r: 3, kind: ORE_IRON, amt: [12, 20] },
  ],
  clear: [{ x: 80, y: 88, r: 7 }],
};

/** A ring of small rock patches: the stones of an old circle. */
const ring = (x: number, y: number, r: number, n: number, size = 1.2) =>
  Array.from({ length: n }, (_, k) => ({ x: x + cos((k / n) * Math.PI * 2) * r, y: y + sin((k / n) * Math.PI * 2) * r, r: size }));

/**
 * Silva, the forest. An island of old woods in the sea. The legate lands in a clearing in the
 * south-west; the grove at the forest's heart is an open ring of stones by a spring; the Ninth's
 * camp hides in the north-west; Varro's timber company works in from the north-east, where its
 * stockade and the iron are.
 */
const SILVA: MapRecipe = {
  id: 'silva',
  size: 160,
  frame: 'continent',
  mountains: false,
  lakes: false,
  starts: [[42, 114], [124, 50], [48, 46]],
  forests: [
    { x: 60, y: 62, r: 16 }, { x: 100, y: 62, r: 14 }, { x: 62, y: 98, r: 14 }, { x: 100, y: 100, r: 16 },
    { x: 80, y: 42, r: 12 }, { x: 80, y: 120, r: 11 }, { x: 36, y: 82, r: 10 }, { x: 124, y: 84, r: 11 },
    { x: 30, y: 100, r: 5 }, { x: 58, y: 124, r: 6 },
  ],
  rocks: [{ x: 54, y: 120, r: 2.6 }, { x: 30, y: 118, r: 2.2 }, { x: 116, y: 40, r: 2.6 }, ...ring(80, 80, 7.5, 7)],
  lakeBlobs: [{ x: 106, y: 118, r: 7 }, { x: 46, y: 70, r: 5 }],
  carve: [
    // two short ridges on the coast: the legate's in the south-west, the timber company's in the north-east
    { op: 'range', path: [[24, 124], [30, 134]], width: 8, height: 7 },
    { op: 'range', path: [[132, 30], [142, 38]], width: 8, height: 8 },
    { op: 'flat', at: [80, 80], r: 8, height: 1.5 },
    { op: 'water', at: [80, 80], r: 1.6, depth: 0.8 },
    { op: 'flat', at: [48, 46], r: 8 },
    // the timber company's stockade: two clearings on the road in from the north-east
    { op: 'flat', at: [106, 62], r: 4, height: 1.4 },
    { op: 'flat', at: [96, 72], r: 3, height: 1.4 },
  ],
  ore: [
    { at: [24, 125], r: 3.5, kind: ORE_COAL, amt: [12, 20] },
    { at: [30, 133], r: 3.5, kind: ORE_IRON, amt: [12, 20] },
    { at: [133, 31], r: 3.5, kind: ORE_IRON, amt: [12, 20] },
    { at: [141, 38], r: 3.5, kind: ORE_GOLD, amt: [12, 20] },
  ],
  clear: [{ x: 80, y: 80, r: 9 }, { x: 48, y: 46, r: 9 }, { x: 106, y: 62, r: 5 }, { x: 96, y: 72, r: 4 }],
};

/**
 * Vallis, the valley. A broad valley running west to east between two walls of mountains, farmland
 * from end to end, a lake in its middle. The legate comes in at the west end, Varro's colonists at
 * the east, and the land between goes to whoever claims it first.
 */
const VALLIS: MapRecipe = {
  id: 'vallis',
  size: 160,
  frame: 'land',
  mountains: false,
  lakes: false,
  starts: [[22, 80], [138, 80]],
  forests: [{ x: 30, y: 52, r: 7 }, { x: 34, y: 108, r: 7 }, { x: 126, y: 54, r: 7 }, { x: 128, y: 106, r: 7 }, { x: 80, y: 50, r: 6 }, { x: 80, y: 112, r: 6 }],
  rocks: [{ x: 32, y: 72, r: 2.6 }, { x: 128, y: 90, r: 2.6 }, { x: 60, y: 58, r: 2.4 }, { x: 100, y: 104, r: 2.4 }],
  lakeBlobs: [{ x: 80, y: 80, r: 9 }, { x: 52, y: 96, r: 3.5 }, { x: 108, y: 64, r: 3.5 }],
  // mountains in the valley under the walls: coal and iron at each end, gold in the middle
  peaks: [{ x: 36, y: 42, r: 8 }, { x: 124, y: 118, r: 8 }, { x: 80, y: 38, r: 6 }],
  carve: [
    // the two walls, out to the map's edges, and its ends
    { op: 'range', path: [[-6, 12], [40, 8], [80, 16], [120, 6], [166, 12]], width: 19, height: 11, wall: true },
    { op: 'range', path: [[-6, 148], [40, 152], [80, 144], [120, 154], [166, 148]], width: 19, height: 11, wall: true },
    { op: 'range', path: [[-6, -6], [-6, 166]], width: 9, height: 9, wall: true },
    { op: 'range', path: [[166, -6], [166, 166]], width: 9, height: 9, wall: true },
  ],
  ore: [
    { at: [32, 40], r: 3.5, kind: ORE_COAL, amt: [12, 20] },
    { at: [40, 44], r: 3.5, kind: ORE_IRON, amt: [12, 20] },
    { at: [128, 120], r: 3.5, kind: ORE_COAL, amt: [12, 20] },
    { at: [120, 116], r: 3.5, kind: ORE_IRON, amt: [12, 20] },
    { at: [80, 37], r: 3, kind: ORE_GOLD, amt: [12, 20] },
  ],
};

/** Castra, the capital: the legate's own coast, as free play would make it, for the day Varro comes for it. */
const CASTRA: MapRecipe = {
  id: 'castra',
  size: 160,
  frame: 'continent',
  starts: [[48, 88], [118, 66]],
  anchors: true,
  veins: true,
};

/** Walls of mountains round the map's four edges, for an inland region. */
const EDGES: MapRecipe['carve'] = [
  { op: 'range', path: [[-6, -6], [166, -6]], width: 10, height: 9, wall: true },
  { op: 'range', path: [[-6, 166], [166, 166]], width: 10, height: 9, wall: true },
  { op: 'range', path: [[-6, -6], [-6, 166]], width: 10, height: 9, wall: true },
  { op: 'range', path: [[166, -6], [166, 166]], width: 10, height: 9, wall: true },
];

/**
 * Metalla, the gold plateau. A table mountain fills the north-east, cliffs all round it and one path
 * up from the lowland, and on top of it Varro's mining camp and the gold. The legate's camp is in the
 * south-west lowland with its own coal and iron; the hill tribes live in the north-west hills and
 * know the path better than anyone.
 */
const METALLA: MapRecipe = {
  id: 'metalla',
  size: 160,
  frame: 'land',
  mountains: false,
  lakes: false,
  starts: [[36, 124], [118, 46], [26, 34]],
  forests: [{ x: 22, y: 100, r: 7 }, { x: 56, y: 136, r: 7 }, { x: 48, y: 78, r: 6 }, { x: 132, y: 110, r: 9 }, { x: 102, y: 128, r: 7 }, { x: 40, y: 50, r: 6 }],
  rocks: [{ x: 50, y: 116, r: 2.6 }, { x: 24, y: 136, r: 2.2 }, { x: 128, y: 62, r: 2.6 }],
  lakeBlobs: [{ x: 76, y: 132, r: 6 }, { x: 142, y: 140, r: 5 }],
  carve: [
    ...EDGES,
    // the plateau, cliffs all round it
    { op: 'plateau', at: [112, 52], r: 30, height: 7, wall: true },
    // its mountains, on top of it: the gold, and iron
    { op: 'range', path: [[120, 30], [136, 40]], width: 8, height: 5 },
    { op: 'range', path: [[92, 32], [102, 28]], width: 6, height: 4 },
    // the one path up, from the lowland at its foot to its rim
    { op: 'ramp', path: [[60, 108], [72, 94], [90, 76]], width: 4, from: 1.4, to: 7 },
    // the legate's own ridge in the south-west, and the tribes' hills in the north-west
    { op: 'range', path: [[14, 142], [24, 150]], width: 7, height: 6 },
    { op: 'range', path: [[12, 58], [40, 16]], width: 9, height: 6 },
    { op: 'flat', at: [26, 34], r: 6, height: 2.2 },
  ],
  ore: [
    { at: [124, 32], r: 3.5, kind: ORE_GOLD, amt: [16, 22] },
    { at: [133, 38], r: 3.5, kind: ORE_GOLD, amt: [16, 22] },
    { at: [96, 30], r: 2.8, kind: ORE_IRON, amt: [12, 18] },
    { at: [15, 143], r: 3, kind: ORE_COAL, amt: [12, 20] },
    { at: [22, 149], r: 3, kind: ORE_IRON, amt: [12, 20] },
  ],
  clear: [{ x: 90, y: 76, r: 4 }],
};

/**
 * Collis, the tribes' upland. Hill country: three hill forts of the tribes, each on its own table of
 * rock with one way up; their chief's camp behind them in the north. The legate comes up from the
 * south.
 */
const COLLIS: MapRecipe = {
  id: 'collis',
  size: 160,
  frame: 'land',
  lakes: false,
  starts: [[80, 138], [80, 28]],
  forests: [{ x: 40, y: 120, r: 8 }, { x: 122, y: 118, r: 8 }, { x: 80, y: 60, r: 6 }, { x: 26, y: 80, r: 7 }, { x: 136, y: 80, r: 7 }],
  rocks: [{ x: 66, y: 128, r: 2.6 }, { x: 96, y: 130, r: 2.2 }],
  lakeBlobs: [{ x: 60, y: 104, r: 4 }, { x: 102, y: 106, r: 4 }],
  carve: [
    ...EDGES,
    { op: 'plateau', at: [42, 58], r: 11, height: 5, wall: true },
    { op: 'ramp', path: [[56, 80], [47, 64]], width: 3.5, from: 1.5, to: 5 },
    { op: 'plateau', at: [118, 58], r: 11, height: 5, wall: true },
    { op: 'ramp', path: [[104, 80], [113, 64]], width: 3.5, from: 1.5, to: 5 },
    { op: 'plateau', at: [80, 92], r: 10, height: 4, wall: true },
    { op: 'ramp', path: [[80, 116], [80, 99]], width: 3.5, from: 1.4, to: 4 },
    { op: 'range', path: [[20, 132], [30, 146]], width: 7, height: 6 },
    { op: 'flat', at: [80, 138], r: 9 },
  ],
  ore: [
    { at: [22, 136], r: 3, kind: ORE_COAL, amt: [12, 20] },
    { at: [28, 143], r: 3, kind: ORE_IRON, amt: [12, 20] },
  ],
  clear: [{ x: 42, y: 58, r: 8 }, { x: 118, y: 58, r: 8 }, { x: 80, y: 92, r: 7 }],
};

/**
 * Ara, the sacred hill. An island with a hill in its middle, cliffs round the top and two ways up:
 * the pilgrims' from the south-west, the priests' from the north-east. On top, the Great Temple and
 * the towers that keep it; Varro's camp in the north-east, the legate's in the south-west.
 */
const ARA: MapRecipe = {
  id: 'ara',
  size: 160,
  frame: 'continent',
  mountains: false,
  lakes: false,
  starts: [[40, 116], [124, 46]],
  forests: [{ x: 26, y: 96, r: 8 }, { x: 58, y: 128, r: 7 }, { x: 132, y: 66, r: 8 }, { x: 104, y: 30, r: 7 }, { x: 110, y: 110, r: 9 }, { x: 52, y: 52, r: 8 }],
  rocks: [{ x: 50, y: 108, r: 2.6 }, { x: 114, y: 50, r: 2.6 }],
  lakeBlobs: [{ x: 70, y: 124, r: 5 }],
  carve: [
    { op: 'plateau', at: [82, 78], r: 14, height: 5.5, wall: true },
    { op: 'ramp', path: [[60, 100], [74, 86]], width: 3.5, from: 1.4, to: 5.5 },
    { op: 'ramp', path: [[104, 56], [90, 70]], width: 3.5, from: 1.4, to: 5.5 },
    { op: 'range', path: [[24, 128], [30, 138]], width: 7, height: 6 },
    { op: 'range', path: [[136, 30], [144, 40]], width: 7, height: 6 },
  ],
  ore: [
    { at: [24, 129], r: 3, kind: ORE_COAL, amt: [12, 20] },
    { at: [30, 137], r: 3, kind: ORE_IRON, amt: [12, 20] },
    { at: [138, 32], r: 3, kind: ORE_IRON, amt: [12, 20] },
    { at: [143, 39], r: 3, kind: ORE_GOLD, amt: [12, 20] },
  ],
  clear: [{ x: 82, y: 78, r: 12 }],
};

/**
 * Aestuarium, the estuary. A long water cut through the land from the sea in the south to the sea in
 * the north, deep enough for ships all the way, which parts the east bank from ours. The legate's camp
 * is on the west bank by a bay at the head, with coal and iron in the north-west; the east bank is rich
 * and empty, gold on a hill across from the bay and more with iron in the north-east; the pirates Varro
 * hired keep an islet off the mouth, and a customs post on the east bank's southern point.
 */
const AESTUARIUM: MapRecipe = {
  id: 'aestuarium',
  size: 160,
  frame: 'continent',
  mountains: false,
  lakes: false,
  starts: [[48, 70], [148, 150]],
  forests: [{ x: 22, y: 66, r: 8 }, { x: 60, y: 104, r: 7 }, { x: 118, y: 66, r: 8 }, { x: 116, y: 100, r: 8 }, { x: 104, y: 120, r: 5 }],
  rocks: [{ x: 58, y: 62, r: 2.6 }, { x: 108, y: 84, r: 2.6 }],
  carve: [
    // the estuary: from the open sea in the south right through the land to the north coast, and a bay at its head on our side
    { op: 'channel', path: [[84, 170], [84, 128], [82, 100], [80, 72], [84, 40], [86, -10]], width: 6, depth: 3 },
    { op: 'channel', path: [[80, 78], [64, 78]], width: 4.5, depth: 2.6 },
    // the pirates' island off the mouth
    { op: 'land', at: [148, 150], r: 8, height: 0.9 },
    { op: 'range', path: [[30, 46], [40, 40]], width: 7, height: 6 },
    // the gold hill across the water from the bay, and the north-east's gold and iron
    { op: 'range', path: [[99, 58], [106, 52]], width: 6, height: 5 },
    { op: 'range', path: [[124, 38], [134, 46]], width: 7, height: 6 },
    { op: 'flat', at: [98, 138], r: 4, height: 1.2 },
  ],
  ore: [
    { at: [31, 45], r: 3, kind: ORE_COAL, amt: [12, 20] },
    { at: [39, 41], r: 3, kind: ORE_IRON, amt: [12, 20] },
    { at: [100, 57], r: 2.6, kind: ORE_GOLD, amt: [14, 22] },
    { at: [105, 53], r: 2.6, kind: ORE_GOLD, amt: [14, 22] },
    { at: [126, 40], r: 3, kind: ORE_GOLD, amt: [14, 22] },
    { at: [133, 45], r: 3, kind: ORE_IRON, amt: [12, 20] },
  ],
  clear: [{ x: 98, y: 138, r: 5 }],
  connect: false,
};

/**
 * Insulae, the archipelago. Open sea and islands: the legate's own in the west, four more to found
 * colonies on (the pirates have a tower on two of them), Varro's naval base in the north-east and the
 * pirates' nest on an islet in the south-east.
 */
const INSULAE: MapRecipe = {
  id: 'insulae',
  size: 160,
  frame: 'sea',
  mountains: false,
  lakes: false,
  starts: [[46, 88], [130, 36], [138, 132]],
  forests: [{ x: 26, y: 76, r: 6 }, { x: 44, y: 104, r: 5 }, { x: 96, y: 40, r: 5 }, { x: 126, y: 84, r: 5 }, { x: 92, y: 130, r: 5 }, { x: 46, y: 26, r: 4 }],
  rocks: [{ x: 46, y: 80, r: 2.4 }, { x: 118, y: 84, r: 2 }, { x: 40, y: 34, r: 1.8 }],
  isles: [{ x: 44, y: 30, r: 10 }, { x: 94, y: 44, r: 12 }, { x: 122, y: 90, r: 13 }, { x: 90, y: 126, r: 12 }],
  carve: [
    { op: 'land', at: [36, 90], r: 24, height: 1.2 },
    { op: 'land', at: [44, 30], r: 10, height: 1 },
    { op: 'land', at: [94, 44], r: 12, height: 1 },
    { op: 'land', at: [122, 90], r: 13, height: 1 },
    { op: 'land', at: [90, 126], r: 12, height: 1 },
    { op: 'land', at: [138, 132], r: 9, height: 0.9 },
    { op: 'land', at: [132, 34], r: 16, height: 1.2 },
    { op: 'range', path: [[20, 100], [26, 108]], width: 6, height: 5 },
    { op: 'range', path: [[124, 96], [130, 100]], width: 5, height: 5 },
    { op: 'range', path: [[92, 118], [98, 122]], width: 5, height: 5 },
  ],
  ore: [
    { at: [21, 101], r: 2.8, kind: ORE_COAL, amt: [12, 20] },
    { at: [26, 107], r: 2.8, kind: ORE_IRON, amt: [12, 20] },
    { at: [127, 98], r: 2.8, kind: ORE_GOLD, amt: [14, 22] },
    { at: [95, 120], r: 2.8, kind: ORE_IRON, amt: [14, 22] },
  ],
  connect: false,
};

/**
 * Litus, the pirate coast. The legate's coast in the north; the sea between; and off the south shore
 * the pirates' harbour on its own island, where the flagship rides.
 */
const LITUS: MapRecipe = {
  id: 'litus',
  size: 160,
  frame: 'sea',
  mountains: false,
  lakes: false,
  starts: [[70, 50], [100, 124]],
  forests: [{ x: 28, y: 42, r: 8 }, { x: 110, y: 34, r: 8 }, { x: 88, y: 58, r: 5 }],
  rocks: [{ x: 84, y: 36, r: 2.6 }, { x: 50, y: 50, r: 2.2 }],
  carve: [
    // the legate's coast: a broad strip of land along the north
    { op: 'land', at: [40, 40], r: 30, height: 1.4 },
    { op: 'land', at: [80, 34], r: 30, height: 1.4 },
    { op: 'land', at: [120, 40], r: 28, height: 1.4 },
    { op: 'range', path: [[46, 26], [56, 20]], width: 7, height: 6 },
    // the pirates' island
    { op: 'land', at: [100, 124], r: 14, height: 1 },
    { op: 'range', path: [[108, 132], [114, 126]], width: 5, height: 5 },
  ],
  ore: [
    { at: [47, 25], r: 3, kind: ORE_COAL, amt: [12, 20] },
    { at: [55, 21], r: 3, kind: ORE_IRON, amt: [12, 20] },
  ],
  connect: false,
};

/**
 * Castellum, Varro's fortress. Inland, walled round: a hill in the east of the middle with cliffs all
 * round it and one ramp up on each side, Varro's hall on top; four castles round its foot (at each
 * ramp's foot and on each flank; placed by the mission); the legate's lowland in the west with coal
 * and iron in the south-west, the gold beyond the hill in the north-east.
 */
const CASTELLUM: MapRecipe = {
  id: 'castellum',
  size: 160,
  frame: 'land',
  mountains: false,
  lakes: false,
  starts: [[24, 80], [112, 80]],
  forests: [{ x: 26, y: 56, r: 8 }, { x: 42, y: 122, r: 8 }, { x: 54, y: 66, r: 5 }, { x: 54, y: 98, r: 5 }, { x: 140, y: 52, r: 7 }, { x: 140, y: 110, r: 7 }, { x: 118, y: 66, r: 3.5 }],
  rocks: [{ x: 38, y: 70, r: 2.6 }, { x: 34, y: 92, r: 2.4 }, { x: 122, y: 94, r: 2 }],
  lakeBlobs: [{ x: 48, y: 128, r: 5 }, { x: 66, y: 40, r: 4 }],
  carve: [
    ...EDGES,
    { op: 'plateau', at: [112, 80], r: 18, height: 6, wall: true },
    { op: 'ramp', path: [[82, 80], [96, 80]], width: 3.5, from: 1.4, to: 6 },
    { op: 'ramp', path: [[142, 80], [128, 80]], width: 3.5, from: 1.4, to: 6 },
    { op: 'range', path: [[14, 102], [24, 114]], width: 8, height: 6 },
    { op: 'range', path: [[134, 24], [146, 32]], width: 7, height: 6 },
    { op: 'flat', at: [24, 80], r: 8 },
    { op: 'flat', at: [76, 80], r: 5, height: 1.4 },
    { op: 'flat', at: [92, 50], r: 5, height: 1.4 },
    { op: 'flat', at: [92, 110], r: 5, height: 1.4 },
    { op: 'flat', at: [148, 80], r: 5, height: 1.4 },
  ],
  ore: [
    { at: [15, 103], r: 3.5, kind: ORE_COAL, amt: [12, 20] },
    { at: [23, 113], r: 3.5, kind: ORE_IRON, amt: [12, 20] },
    { at: [19, 108], r: 2.5, kind: ORE_COAL, amt: [10, 16] },
    { at: [136, 25], r: 3, kind: ORE_GOLD, amt: [14, 22] },
    { at: [144, 31], r: 3, kind: ORE_IRON, amt: [12, 20] },
  ],
  clear: [{ x: 76, y: 80, r: 6 }, { x: 92, y: 50, r: 6 }, { x: 92, y: 110, r: 6 }, { x: 148, y: 80, r: 6 }, { x: 89, y: 80, r: 4 }, { x: 135, y: 80, r: 4 }],
};

/**
 * Nova Ostia, Varro's seat: the finale, a large coast. A wall of mountains runs north to south east of
 * the middle with two passes through it; behind it Varro's capital by a bay on the east coast, gold in
 * the south-east; west of it the legate's land, and Varro's two client colonies to our north and south
 * (his own towns, placed by the mission round 104,38 and 104,170).
 */
const NOVAOSTIA: MapRecipe = {
  id: 'novaostia',
  size: 208,
  frame: 'continent',
  mountains: false,
  lakes: false,
  starts: [[42, 104], [174, 104]],
  forests: [
    { x: 30, y: 80, r: 9 }, { x: 52, y: 146, r: 9 }, { x: 64, y: 104, r: 6 }, { x: 84, y: 52, r: 7 }, { x: 84, y: 156, r: 7 },
    { x: 124, y: 30, r: 7 }, { x: 124, y: 178, r: 7 }, { x: 166, y: 70, r: 8 }, { x: 166, y: 140, r: 8 }, { x: 110, y: 104, r: 6 },
  ],
  rocks: [{ x: 52, y: 92, r: 2.8 }, { x: 50, y: 118, r: 2.6 }, { x: 96, y: 30, r: 2.4 }, { x: 96, y: 178, r: 2.4 }, { x: 180, y: 82, r: 2.6 }],
  lakeBlobs: [{ x: 76, y: 80, r: 5 }, { x: 76, y: 128, r: 5 }],
  carve: [
    // the wall, and its two passes
    { op: 'range', path: [[146, 14], [140, 60], [144, 104], [140, 148], [146, 194]], width: 12, height: 10, wall: true },
    { op: 'gap', at: [141, 74], r: 8, height: 1.8 },
    { op: 'road', path: [[124, 74], [141, 74], [158, 76]], width: 4.5, height: 1.6 },
    { op: 'gap', at: [141, 134], r: 8, height: 1.8 },
    { op: 'road', path: [[124, 134], [141, 134], [158, 132]], width: 4.5, height: 1.6 },
    // Nova Ostia's bay
    { op: 'water', at: [194, 104], r: 9, depth: 2.6 },
    // the legate's mountain in the south-west, the colonies' and Varro's
    { op: 'range', path: [[20, 124], [30, 136]], width: 8, height: 6 },
    { op: 'range', path: [[70, 24], [80, 16]], width: 6, height: 5 },
    { op: 'range', path: [[70, 184], [80, 192]], width: 6, height: 5 },
    { op: 'range', path: [[170, 160], [182, 170]], width: 7, height: 6 },
    { op: 'flat', at: [42, 104], r: 9 },
    { op: 'flat', at: [174, 104], r: 10 },
    { op: 'flat', at: [128, 74], r: 5, height: 1.5 },
    { op: 'flat', at: [128, 134], r: 5, height: 1.5 },
  ],
  ore: [
    { at: [21, 125], r: 3.5, kind: ORE_COAL, amt: [12, 20] },
    { at: [29, 135], r: 3.5, kind: ORE_IRON, amt: [12, 20] },
    { at: [25, 130], r: 2.5, kind: ORE_GOLD, amt: [10, 16] },
    { at: [72, 22], r: 2.6, kind: ORE_COAL, amt: [10, 18] },
    { at: [78, 18], r: 2.6, kind: ORE_IRON, amt: [10, 18] },
    { at: [72, 186], r: 2.6, kind: ORE_COAL, amt: [10, 18] },
    { at: [78, 190], r: 2.6, kind: ORE_IRON, amt: [10, 18] },
    { at: [172, 162], r: 3, kind: ORE_GOLD, amt: [14, 22] },
    { at: [180, 168], r: 3, kind: ORE_IRON, amt: [12, 20] },
  ],
  clear: [{ x: 141, y: 74, r: 7 }, { x: 141, y: 134, r: 7 }, { x: 128, y: 74, r: 5 }, { x: 128, y: 134, r: 5 }],
};

export const RECIPES: Record<string, MapRecipe> = { saltus: SALTUS, silva: SILVA, vallis: VALLIS, castra: CASTRA, metalla: METALLA, collis: COLLIS, ara: ARA, aestuarium: AESTUARIUM, insulae: INSULAE, litus: LITUS, castellum: CASTELLUM, novaostia: NOVAOSTIA };

export function recipeById(id: string | undefined): MapRecipe | undefined {
  return id ? RECIPES[id] : undefined;
}
