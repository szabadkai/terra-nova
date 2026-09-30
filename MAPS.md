# Maps of your own

Terra Nova plays on maps of the players' own making as well as on the generator's. A map is plain data
(`src/game/map.ts`): the height, material, ore and fish of every node, where each player starts, and every
tree, rock and deer. Starting a game on it is deterministic - the same map makes the same game on every
machine - so a map can be saved, shared as a file and played like a seed.

There are three ways to make one:

- **The map editor** on the title screen: brushes on the live 3D world, undo, a library of maps in the
  browser, map files to share, and the checks that say what would make a game on it unfair.
- **A script in the editor** (the Script button): JavaScript over the same API as the brushes, for maps
  made by code - a symmetric arena, an archipelago, a river valley - and for the tedious parts of a
  hand-made map (a forest of a thousand trees).
- **Headless**, from Node with `npx tsx`: the same API, for tools and pipelines of your own; the game
  itself can be played on the result without a browser (see `scripts/mapedit.ts`).

## Playing a map

- **Free play → Map → Own…** lists the maps in the browser: pick one and free play is on it (its size,
  and no more rivals than it has starts). Play as usual; the autosave and saved games carry the map.
- **Play** in the editor starts a game on the map being made (it must pass the checks first).
- **A link:** `?map=<url>` fetches a map file and plays free play on it (`&play=1` skips the title
  screen, `&players=3` sets the players). A file on GitHub Pages, a gist's raw URL, anything the browser
  may fetch.
- **A file:** Import in the editor or on the maps page opens a `.tnmap` file; Export writes one.

A map file (`.tnmap`) is gzip over a small binary container (`src/core/pack.ts`): a JSON header with the
typed arrays stored raw after it. `encodeMap` / `decodeMap` read and write it; `mapError` says why a file
cannot be played.

Games with a friend play the generator's maps for now: the host's map is not yet sent through the room.

## The API

`MapBuilder` in `src/game/map.ts` is the map being made. Coordinates are nodes: `x` to the right, `y`
down the map, both from 0 to `size - 1`. A circle takes a centre and a radius in nodes. Heights are the
world's: the sea lies at `WATER_LEVEL` (2), the shore a little above it, a mountain 5 to 10 higher. Every
brush has a soft edge: `hard` is the part of the radius that gets the full effect (0 all soft, 1 a hard
edge). Every operation is deterministic for the builder's seed (`rng`); the scatter brushes draw from it.

In the editor's script console the map is `map`, and `T`, `ORE`, `rng`, `WATER_LEVEL` and `log` are
given. Headless:

```ts
import { MapBuilder, encodeMap } from './src/game/map';
import { ORE_COAL, ORE_IRON, T_FOREST } from './src/game/defs';
import { WATER_LEVEL } from './src/game/world';
```

### Making one

| | |
|---|---|
| `new MapBuilder(size, seed?)` | an empty map, everything at height 0 (below the sea); sizes 64 to 256 |
| `MapBuilder.blank(size, 'sea' \| 'land', seed?)` | open sea, or flat grassland with the sea round its edge |
| `MapBuilder.generate(size, seed, players, islands?)` | the generator's map for these settings, to be worked on |
| `MapBuilder.from(data)` | a map from its data |
| `generatedMap(size, seed, players, islands?)` | the generator's map as data |
| `map.toData()` | the map as `MapData` (the arrays copied; trees and rocks in node order, so the same map is the same data however it was made) |
| `map.name`, `map.author`, `map.description` | what the library and the free-play page show |

### The ground

| | |
|---|---|
| `raise(x, y, r, amount, hard = 0.4)` | raise the ground by up to `amount` (negative lowers it) |
| `lower(x, y, r, amount, hard = 0.4)` | the same, down |
| `flatten(x, y, r, target?, strength = 1, hard = 0.4)` | pull the ground towards one height (the centre's unless given) |
| `smooth(x, y, r, strength = 0.5, hard = 0.4)` | towards the average of each node's neighbours |
| `roughen(x, y, r, amount = 0.6, scale = 8, hard = 0.4)` | noise `amount` high and `scale` nodes wide |
| `hills(x, y, r, amount = 0.6, scale = 12)` | rolling hills |
| `fill(height)` | every node of the map |
| `coast(width, depth = 2.5)` | sink the map's edge into the sea over `width` nodes |

### Features

| | |
|---|---|
| `island(x, y, r, height = 1.3)` | land rising to `height` above the shore, its edge broken by noise, shallows round it |
| `mountain(x, y, r, height = 7)` | a ridged massif, its rock painted and its top snowed |
| `lake(x, y, r, depth = 1.5)` | the ground sunk below the water, sand round it |
| `carve(points, width = 3, depth = 2.6)` | a valley along a line of `{x, y}` points; a river once it dips below the sea |

### Materials, ore, fish

| | |
|---|---|
| `paint(x, y, r, terrain, hard = 1)` | a material: `T_GRASS`, `T_MEADOW`, `T_FOREST`, `T_DIRT`, `T_SAND`, `T_ROCK`, `T_SNOW`, `T_SWAMP` (`defs.ts`; `T.GRASS`… in the console) |
| `paintOre(x, y, r, ore, amount = 14, hard = 0.8)` | ore under the rock: `ORE_COAL`, `ORE_IRON`, `ORE_GOLD`, `ORE_STONE`; 0 clears it. Only rock and snow hold ore: mines stand on mountains |
| `stockFish(x, y, r, amount = 5, hard = 0.8)` | fish a node in the water; 0 empties it |
| `autoTerrain(x?, y?, r?)` | dress the land from its shape (the whole map without a circle): sand on the shore and under the water, rock where it is steep and snow high up, grass, meadow or woodland floor by a moisture noise elsewhere. Rock and snow already painted on gentle ground are kept |

### Woods, rocks, game

| | |
|---|---|
| `plant(x, y, r, density = 0.5, species = -1, growth = 1, hard = 0.6)` | trees on the free land nodes, each with chance `density`; species 0 oak, 1 pine, 2 birch, 3 palm, 4 fruit tree, -1 to suit the ground |
| `clearTrees(x, y, r)` | |
| `scatterStones(x, y, r, density = 0.35, amount = 8, hard = 0.6)` | rocks for the stonecutters, `amount` stone each |
| `clearStones(x, y, r)` | |
| `herd(x, y, n = 4)` | a herd of deer about (x, y) |
| `clearDeer(x, y, r)` | |

Trees and rocks are kept by node in `map.trees` (`{ species, growth }`) and `map.stones` (the stone in it);
`map.deer` is a list of `{ node, herd }`. `map.idx(x, y)`, `map.nx(i)`, `map.ny(i)` go between the two.

### The players

| | |
|---|---|
| `setStart(p, x, y, prepare = true)` | where player `p` (0–3) starts: the centre of its headquarters. With `prepare` the ground is made ready as the generator makes it: levelled, cleared of trees and rocks, bare earth in the yard. Returns what is wrong with the spot, or null |
| `clearStart(p)` | |
| `prepareStart(x, y)` | level and clear a headquarters' ground, lifting it out of the water if it must |
| `startProblem(p)` | `'in the water'`, `'on a mountain'`, `'too close to the edge of the map'`, or null |
| `map.starts` | by slot; a slot not yet placed is null. The data's `starts` is the compacted list |
| `connect()` | raise land bridges until every start can be walked to from the first, as the generator does |

### Checking and undoing

| | |
|---|---|
| `validate()` | the problems, errors first: `{ level: 'error' \| 'warn', text, x?, y? }`. An error stops a game from starting (no start, a headquarters in the water or on a mountain or off the edge, two starts within 12 nodes); a warning is a fairness note (a start on another landmass, few trees, little stone, no mountain or ore, no water, little land within 30 nodes) |
| `playable` | no errors |
| `stats()` | land, water, mountain, trees, rocks and stone, fish, deer, ore by kind, players |
| `cut(rect)` / `paste(patch)` | a patch of everything inside a rect, put back where it was (the editor's undo) |
| `onChange` | told of every change and the nodes it touched: `(rect, what)` with `what` one of `h`, `terrain`, `ore`, `fish`, `trees`, `stones`, `deer`, `starts` |

### Starting a game on it

```ts
import { Game } from './src/game/game';
const g = new Game({ size: 160, seed: 5, players: 2, aiLevel: 1, map: map.toData() });
```

The map's size wins over `size`; `players` may not exceed the map's starts. Every other option is as in
free play. `scripts/mapedit.ts` does all of this headless and checks it: a captured generator's map plays
exactly as its seed does, two games from one map agree hash for hash, a save of one restored agrees too.

## An example

Two players on a round island, a mountain each with coal, iron and a little gold, a lake apiece, a river,
woods and rocks by each start, deer, fish in the sea:

```js
const S = map.size, c = S / 2;
map.fill(WATER_LEVEL - 2.5);
map.island(c, c, S * 0.42, 1.6);
map.hills(c, c, S * 0.4, 0.5, 14);
map.mountain(c - S * 0.22, c - S * 0.2, 13, 7);
map.mountain(c + S * 0.22, c + S * 0.2, 13, 7);
map.lake(c - S * 0.05, c + S * 0.18, 7, 1.6);
map.lake(c + S * 0.05, c - S * 0.18, 7, 1.6);
map.carve([{ x: c - 10, y: c + S * 0.18 }, { x: c - 45, y: c + S * 0.45 }], 2.5, 3);
map.autoTerrain();
for (const [x, y] of [[c - S * 0.22, c - S * 0.2], [c + S * 0.22, c + S * 0.2]]) {
  map.paintOre(x - 4, y - 3, 4, ORE.COAL, 16);
  map.paintOre(x + 4, y + 3, 4, ORE.IRON, 16);
  map.paintOre(x, y - 5, 3, ORE.GOLD, 12);
}
map.setStart(0, Math.round(c - S * 0.25), Math.round(c + S * 0.05));
map.setStart(1, Math.round(c + S * 0.25), Math.round(c - S * 0.05));
for (const s of map.starts) {
  if (!s) continue;
  map.paint(s.x - 12, s.y - 8, 7, T.FOREST);
  map.plant(s.x - 12, s.y - 8, 8, 0.6);
  map.plant(s.x + 10, s.y + 9, 7, 0.45);
  map.scatterStones(s.x + 12, s.y - 6, 3.5, 0.5, 9);
  map.herd(s.x - 14, s.y + 14, 4);
}
map.stockFish(c, c, S * 0.5, 4);
map.name = 'Twin Peaks';
```

The editor's Script button has this and an archipelago for four as examples. In Node, replace `T.FOREST`
with `T_FOREST` and `ORE.COAL` with `ORE_COAL` from `src/game/defs`, and write the file with
`encodeMap(map.toData())`.

## The editor

Title screen → Map editor. New makes a map from a generated world (the generator's map for a seed and a
number of players), open sea or flat land. The panel on the left holds the tools in four tabs (keys 1–4):

- **Ground:** raise, lower, smooth, level (to the height where the stroke began), hills; a mountain, an
  island or a lake with a click; sea sinks the ground under the water.
- **Paint:** the eight materials, ore under the rock (mountains only), and Auto, which dresses the land
  from its shape.
- **Nature:** woods to suit the ground or of one species, rocks, fish, a herd of deer, and their
  opposites.
- **Players:** the four headquarters (a click places one; the ground is levelled and cleared for it) and
  their removal.

`[` and `]` change the brush; the strength slider is how hard a held tool works and how dense a scatter
falls. Right-drag moves the view, the wheel zooms, Option/Alt-drag turns it. Ctrl+Z undoes a stroke,
Ctrl+Shift+Z redoes it, Ctrl+S saves. The checks under the tools update after every stroke; click one to
be shown where it is. The map being worked on is kept in the browser every few seconds, so a reload or
a look at the title screen loses nothing.
