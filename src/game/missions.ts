// The campaign: fifteen missions that raise a Roman province one lesson at a time, told by Gaius
// Sestius, quaestor. Content only; the framework is campaign.ts. The narration in voice/SCRIPT.md is
// generated from this file (scripts/voicelines.ts), so the words here are the words that are spoken.
// Game helpers may be imported, but only used inside functions: game.ts imports this file through
// campaign.ts, so nothing here may run at load.
import {
  addCarriers, allRivalsDefeated, bestMineSite, borderToward, colonySpot, fewerCarriers, fillResidence, fort, garrison, handOver, has, hqOf, knowOre,
  knowsCoalAndIron, me, mine, mountainCentre, moveGarrison, nearestFish, nearestIsle, nearestRock, nearestTrees, nearestWater, ownedOre, placeNear,
  plantableNear, pop, prebuilt, revealAround, seaNear, ship, stock, stockUp, tally, type Mission,
} from './campaign';
import type { Game } from './game';
import { strongholdsOf } from './game';
import type { Building } from './types';
import { ORE_COAL, ORE_IRON, TOOLS, type BuildingType } from './defs';
import { recomputeTerritory } from './military';
import { gameNear } from './wildlife';
import { launchShip } from './sea';
import { sinkShip } from './naval';
import { spawnCatapult } from './siege';
import { hypot, sq } from '../core/fmath';

// ------------------------------------------------------------------ what the quaestor had raised while the legate travelled
/** Trees grown enough to fell, and stone in the rocks, within reach of the headquarters. */
function woodAndStoneNear(g: Game, r: number) {
  const w = g.world, hq = hqOf(g);
  let trees = 0, stone = 0;
  for (const t of g.trees.values()) if (t.growth >= 1 && sq(w.nx(t.node) - hq.cx) + sq(w.ny(t.node) - hq.cz) <= sq(r)) trees++;
  for (const s of g.stones.values()) if (sq(w.nx(s.node) - hq.cx) + sq(w.ny(s.node) - hq.cz) <= sq(r)) stone += s.amount;
  return { trees, stone };
}
const first = (g: Game, t: BuildingType): Building | undefined => mine(g).find((b) => b.type === t && b.state === 'done');
const roomFor = (g: Game, types: BuildingType[], r = 11): string | null => {
  const hq = hqOf(g);
  for (const t of types) if (!placeNear(g, g.local, t, hq.cx, hq.cz, r)) return `no room for a ${t} near the headquarters`;
  return null;
};
const foodInStore = (g: Game) => { const s = stock(g); return s.bread + s.fish + s.meat; };
const toolsMade = (g: Game) => TOOLS.reduce((n, t) => n + me(g).produced[t], 0);
const liveMine = (g: Game, t: 'coalmine' | 'ironmine') => mine(g).some((b) => b.type === t && b.state === 'done' && g.mineOreLeft(b) > 0);
const mannedTower = (g: Game) => mine(g).some((b) => b.def.military && b.type !== 'hq' && b.state === 'done' && b.occupied);

/** Core A: the camp of Castra - woodcutter, forester, stonecutter, sawmill. */
function coreA(g: Game) {
  const t = nearestTrees(g)!, r = nearestRock(g)!, hq = hqOf(g);
  prebuilt(g, 'woodcutter', t.x, t.z, 10);
  prebuilt(g, 'forester', t.x, t.z, 12);
  prebuilt(g, 'stonecutter', r.x, r.z, 10);
  prebuilt(g, 'sawmill', hq.cx + 6, hq.cz, 10);
}
/** Core B: A with homes and food - a full small residence, a fisher on the shore, a hunter by the wood. */
function coreB(g: Game) {
  coreA(g);
  const hq = hqOf(g), t = nearestTrees(g)!, f = nearestFish(g);
  fillResidence(g, prebuilt(g, 'residence_s', hq.cx - 6, hq.cz, 10));
  if (f) prebuilt(g, 'fisher', f.x, f.z, 10);
  prebuilt(g, 'hunter', t.x, t.z, 12);
  stockUp(g, { water: 10 });
}
/** A watchtower towards the mountain, manned from the headquarters, and the land it takes: at the mountain's foot just
 *  beyond the border where there is room (it makes its own land), else on the border itself. */
function towerToMountain(g: Game) {
  const m = mountainCentre(g);
  let a: { x: number; y: number } | null = null;
  for (const d of [17, 19, 21, 15]) { const b = borderToward(g, m, d)!; a = placeNear(g, g.local, 'tower_l', b.x, b.z, 6, true); if (a) break; }
  if (!a) { const b = borderToward(g, m, 11)!; a = placeNear(g, g.local, 'tower_l', b.x, b.z, 9); }
  if (!a) throw new Error('campaign: no room for a watchtower towards the mountain');
  const tower = g.addBuilding('tower_l', g.local, a.x, a.y, true);
  moveGarrison(g, hqOf(g), tower, 1);
  recomputeTerritory(g);
  return tower;
}
/** Coal and iron mines on the mountain's richest veins, known to the player. */
function minesOnTheMountain(g: Game) {
  for (const t of ['coalmine', 'ironmine'] as const) {
    const site = bestMineSite(g, t);
    if (!site || site.ore < 15) throw new Error(`campaign: no vein for a ${t} inside the border`);
    knowOre(g, g.local, site.x + 1, site.y + 1, 5);
    g.addBuilding(t, g.local, site.x, site.y, true);
  }
}
/** Core C: B with the province's spine - the watchtower, the mines, a smelter and a toolsmith, a medium residence. */
function coreC(g: Game) {
  coreB(g);
  towerToMountain(g);
  minesOnTheMountain(g);
  const hq = hqOf(g);
  prebuilt(g, 'ironsmelter', hq.cx, hq.cz + 7, 11);
  prebuilt(g, 'toolsmith', hq.cx, hq.cz - 7, 11);
  fillResidence(g, prebuilt(g, 'residence_m', hq.cx - 8, hq.cz + 5, 12));
  stockUp(g, { coal: 8, iron: 6, bread: 12, fish: 10, meat: 8 });
}
/** The spine with arms: barracks, a weaponsmith and soldiers in the headquarters' reserve. */
function coreD(g: Game, soldiers: number) {
  coreC(g);
  const hq = hqOf(g);
  prebuilt(g, 'weaponsmith', hq.cx + 8, hq.cz - 3, 12);
  prebuilt(g, 'barracks', hq.cx - 9, hq.cz - 4, 12);
  garrison(g, hq, { sword: Math.max(0, soldiers - pop(g).soldiers), bow: 0 });
  hq.desiredSoldiers = hq.def.military!.capacity;
  stockUp(g, { sword: 4, bow: 2, board: 50, stone: 30 });
}
const fortAt = (g: Game, k: number): Building | undefined => g.buildings.get(g.ms?.forts[k] ?? 0);
const fortDown = (g: Game, k: number) => { const b = fortAt(g, k); return !b || b.state === 'burning' || b.owner === g.local; };
const rebelsAfield = (g: Game) => [...g.settlers.values()].some((s) => s.owner !== g.local && (s.job === 'swordsman' || s.job === 'bowman') && !s.dead && !s.inside);
const ownShip = (g: Game, kind?: 'trade' | 'war') => [...g.ships.values()].some((sh) => sh.owner === g.local && (!kind || sh.kind === kind));
const colonyHarbour = (g: Game) => mine(g).some((b) => b.type === 'harbour' && b.state === 'done' && b.occupied && g.world.region[b.door] !== g.ms?.home);
const homeHarbour = (g: Game) => mine(g).find((b) => b.type === 'harbour' && b.state === 'done' && g.world.region[b.door] === g.ms?.home);
/** A manned colony harbour on the nearest island, as an expedition would have founded it. */
function foundColony(g: Game) {
  const spot = colonySpot(g);
  if (!spot) throw new Error('campaign: no island coast for a colony');
  const b = g.addBuilding('harbour', g.local, spot.x, spot.y, true);
  garrison(g, b, { sword: 1, bow: 0 });
  return b;
}
/** The spine stands: the tower manned, the mines on ore. */
function spineProbe(g: Game): string | null {
  if (!mannedTower(g)) return 'the watchtower is not manned';
  if (!liveMine(g, 'coalmine') || !liveMine(g, 'ironmine')) return 'a mine sits on no ore';
  return null;
}

export const MISSIONS: Mission[] = [
  // ---------------------------------------------------------------- I
  {
    id: 'castra',
    title: 'Castra',
    subtitle: 'The Camp',
    briefing: [
      'Legate. The Senate has given you a legion’s worth of tools and a coastline nobody wanted. This is Terra Nova; that hill is your camp.',
      'Rome was not built in a day, but it was built of boards and stone. So: a woodcutter for logs, a sawmill to make boards of them, a stonecutter for the rocks, and a forester, because woodcutters are thorough.',
      'I am Gaius Sestius, your quaestor. I count things. Give me something to count.',
    ],
    debrief: 'Fifty boards, forty stone. The Senate would call it a start. I call it a camp that will not run out of nails.',
    hook: 'Next: the men are sleeping under carts.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['woodcutter', 'sawmill', 'stonecutter', 'forester'],
    setup: (g) => {
      const hq = hqOf(g);
      // the woods, the rocks and the lake show from the first minute
      revealAround(g, hq.cx, hq.cz, 26);
    },
    goals: [
      {
        id: 'wood', text: 'Build a Woodcutter’s Hut', hint: 'By the trees: he fells the grown ones within his circle.',
        done: (g) => has(g, 'woodcutter'), focus: { build: 'woodcutter', spot: nearestTrees },
        satisfy: (g) => { const t = nearestTrees(g)!; prebuilt(g, 'woodcutter', t.x, t.z, 10); },
      },
      {
        id: 'saw', text: 'Build a Sawmill', hint: 'Logs in, boards out. Every building wants boards.',
        done: (g) => has(g, 'sawmill'), focus: { build: 'sawmill' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'sawmill', hq.cx + 6, hq.cz, 10); },
      },
      {
        id: 'stone', text: 'Build a Stonecutter’s Hut', hint: 'By the grey rocks. Every building wants stone.',
        done: (g) => has(g, 'stonecutter'), focus: { build: 'stonecutter', spot: nearestRock },
        satisfy: (g) => { const r = nearestRock(g)!; prebuilt(g, 'stonecutter', r.x, r.z, 10); },
      },
      {
        id: 'forest', text: 'Build a Forester’s Hut', hint: 'He replants. Put him where the woodcutter works.',
        done: (g) => has(g, 'forester'), focus: { build: 'forester' },
        satisfy: (g) => { const t = nearestTrees(g)!; prebuilt(g, 'forester', t.x, t.z, 12); },
      },
      {
        id: 'stock', text: 'Stock 50 boards and 40 stone', hint: 'Carriers bring finished goods to the headquarters. Watch the top bar.',
        done: (g) => stock(g).board >= 50 && stock(g).stone >= 40,
        progress: (g) => { const s = stock(g); return `${Math.min(50, s.board)}/50 boards · ${Math.min(40, s.stone)}/40 stone`; },
        focus: { building: (g) => hqOf(g).id },
        satisfy: (g) => stockUp(g, { board: 60, stone: 50 }),
      },
    ],
    tips: [
      { id: 'site', on: 'placed', title: 'A site.', detail: 'Diggers level it, carriers bring boards and stone, builders raise it. Click it to watch.' },
      { id: 'tool', on: 'equip', title: 'He took an axe from the store.', detail: 'Every trade needs its tool. The store has a few of each; a toolsmith makes more, later.' },
      { id: 'log', on: 'produced', when: (_g, e) => e.good === 'log', title: 'A log on the pile.', detail: 'A carrier will fetch it to the sawmill. Nobody needs a road.' },
      { id: 'board', on: 'produced', when: (_g, e) => e.good === 'board', title: 'Boards.', detail: 'Now you can build anything the Senate allows.' },
      { id: 'panel', on: 'built', title: 'Click a building to see what it is doing.', detail: 'Its panel shows the worker, the goods and why it might be waiting.' },
      { id: 'camera', on: 'time', when: (g) => g.time > 75 && !tally(g, 'placed'), title: 'Getting your bearings?', detail: 'The wheel zooms, right-drag moves the view, Option-drag or Shift + wheel turns it. Esc → Controls has the rest.' },
      { id: 'speed', on: 'time', when: (g) => g.time > 200, title: 'Waiting is for senators.', detail: 'The 2× button in the top bar speeds the sun. Nothing else changes.' },
    ],
    probe: (g) => {
      const hq = hqOf(g);
      const near = woodAndStoneNear(g, 14);
      if (near.trees < 40) return `only ${near.trees} grown trees within 14 of the headquarters`;
      if (near.stone < 40) return `only ${near.stone} stone within 14 of the headquarters`;
      if (!nearestTrees(g) || !nearestRock(g)) return 'no trees or rocks to point at';
      for (const t of ['woodcutter', 'sawmill', 'stonecutter', 'forester'] as const) if (!placeNear(g, g.local, t, hq.cx, hq.cz, 10)) return `no room for a ${t} near the headquarters`;
      if (mine(g).length !== 1) return 'the camp should start with the headquarters alone';
      return null;
    },
  },
  // ---------------------------------------------------------------- II
  {
    id: 'domus',
    title: 'Domus',
    subtitle: 'Homes',
    briefing: [
      'Twenty-two carriers marched in with you; sixteen are still with us, and the Senate’s letter is very clear that no more are coming.',
      'A Small Residence brings eight settlers to the camp, a Medium one eighteen. Each new man carries until a building needs him for something better. Build homes.',
      'And a storehouse near the huts: your men carry everything from the headquarters, and every step they save is a board sawn sooner.',
    ],
    debrief: 'Forty-eight mouths, forty-eight pairs of hands. I have written down both figures; you will want the second.',
    hook: 'Next: the mouths.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['residence_s', 'residence_m', 'storehouse'],
    setup: (g) => {
      coreA(g);
      fewerCarriers(g, 6);
      const hq = hqOf(g);
      revealAround(g, hq.cx, hq.cz, 26);
    },
    goals: [
      {
        id: 'home', text: 'Build a Small Residence', hint: 'Anywhere on your land. Settlers move in one at a time.',
        done: (g) => has(g, 'residence_s'), focus: { build: 'residence_s' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'residence_s', hq.cx - 6, hq.cz, 10); },
      },
      {
        id: 'movedin', text: 'Eight settlers move in', hint: 'One every nine seconds. Each is a carrier until a building needs him.',
        done: (g) => mine(g).filter((b) => b.def.residence && b.state === 'done').reduce((n, b) => n + b.spawned, 0) >= 8,
        progress: (g) => `${Math.min(8, mine(g).filter((b) => b.def.residence && b.state === 'done').reduce((n, b) => n + b.spawned, 0))}/8`,
        focus: { building: (g) => first(g, 'residence_s')?.id ?? 0 },
        satisfy: (g) => { const b = first(g, 'residence_s'); if (b) fillResidence(g, b, 8 - b.spawned); },
      },
      {
        id: 'store', text: 'Build a Storehouse near the huts', hint: 'Goods go to the nearest store; work goes faster near one.',
        done: (g) => has(g, 'storehouse'), focus: { build: 'storehouse', spot: (g) => { const b = first(g, 'woodcutter'); return b ? { x: b.cx, z: b.cz, r: 4 } : null; } },
        satisfy: (g) => { const b = first(g, 'woodcutter') ?? hqOf(g); prebuilt(g, 'storehouse', b.cx, b.cz + 4, 12); },
      },
      {
        id: 'pop', text: 'Reach 48 settlers', hint: 'A Medium Residence holds eighteen. The top bar counts them.',
        done: (g) => pop(g).total >= 48, progress: (g) => `${Math.min(48, pop(g).total)}/48`, focus: { build: 'residence_m' },
        satisfy: (g) => addCarriers(g, Math.max(0, 48 - pop(g).total)),
      },
    ],
    tips: [
      { id: 'spawn', on: 'spawn', title: 'A settler moved in.', detail: 'He is a carrier until someone needs him. The top bar counts the idle ones.' },
      { id: 'store', on: 'built', when: (g, e) => g.buildings.get(e.b ?? 0)?.type === 'storehouse', title: 'Goods now go to the nearest store.', detail: 'A hut beside it never waits long for its carrier.' },
      { id: 'badge', on: 'time', when: (g) => g.time > 150, title: 'A badge over a roof says why it has stopped.', detail: 'Press . to go to the next one. B changes how many you see.' },
    ],
    probe: (g) => (mine(g).length === 5 ? null : 'the camp of Castra should stand') ?? roomFor(g, ['residence_s', 'residence_m', 'storehouse']),
  },
  // ---------------------------------------------------------------- III
  {
    id: 'piscis',
    title: 'Piscis et Venatio',
    subtitle: 'Fish and Game',
    briefing: [
      'Men eat. At present they eat what we brought, which is twenty meals in a pile.',
      'A Fisher’s Hut on the lake shore feeds us from the water; a Hunter’s Hut by the woods lives off the hares, and the woods keep the hares, so keep the woods.',
      'Each hut works within a circle; the ground shows it while you choose the spot. Mines, when we have them, will not turn a wheel without food.',
    ],
    debrief: 'Fish and hare. Not Rome’s table, but the men have stopped looking at the mules.',
    hook: 'Next: bread, which is a longer story.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['fisher', 'hunter'],
    setup: (g) => {
      coreA(g);
      const hq = hqOf(g);
      fillResidence(g, prebuilt(g, 'residence_s', hq.cx - 6, hq.cz, 10));
      stockUp(g, { fish: 2, meat: 2, bread: 8 });
      revealAround(g, hq.cx, hq.cz, 28);
    },
    goals: [
      {
        id: 'fisher', text: 'Build a Fisher’s Hut on the shore', hint: 'His circle must reach water with fish in it.',
        done: (g) => has(g, 'fisher'), focus: { build: 'fisher', spot: nearestFish },
        satisfy: (g) => { const f = nearestFish(g)!; prebuilt(g, 'fisher', f.x, f.z, 10); },
      },
      {
        id: 'hunter', text: 'Build a Hunter’s Hut by the woods', hint: 'His panel counts the game in range.',
        done: (g) => has(g, 'hunter'), focus: { build: 'hunter', spot: nearestTrees },
        satisfy: (g) => { const t = nearestTrees(g)!; prebuilt(g, 'hunter', t.x, t.z, 12); },
      },
      {
        id: 'food', text: 'Catch 10 fish, bring in 6 meat', hint: 'Food piles up in the store for the mines to come.',
        done: (g) => me(g).produced.fish >= 10 && me(g).produced.meat >= 6,
        progress: (g) => `${Math.min(10, me(g).produced.fish)}/10 fish · ${Math.min(6, me(g).produced.meat)}/6 meat`,
        satisfy: (g) => { me(g).produced.fish = 10; me(g).produced.meat = 6; },
      },
      {
        id: 'larder', text: 'Keep 30 food in store', hint: 'Bread, fish and meat together.', optional: true,
        done: (g) => foodInStore(g) >= 30, progress: (g) => `${Math.min(30, foodInStore(g))}/30`,
        satisfy: (g) => stockUp(g, { fish: 20, meat: 12 }),
      },
    ],
    tips: [
      { id: 'fish', on: 'produced', when: (_g, e) => e.good === 'fish', title: 'A fish.', detail: 'They come back slowly; two fishers on one pond starve each other.' },
      { id: 'meat', on: 'produced', when: (_g, e) => e.good === 'meat', title: 'Meat.', detail: 'Hares live off grown trees. Fell the wood and they leave.' },
      { id: 'range', on: 'placed', title: 'The circle you saw is where he works.', detail: 'Water, game or trees outside it might as well be in Rome.' },
    ],
    probe: (g) => {
      const hq = hqOf(g), f = nearestFish(g);
      if (!f || sq(f.x - hq.cx) + sq(f.z - hq.cz) > sq(17)) return 'no fish within 17 of the headquarters';
      if (!placeNear(g, g.local, 'fisher', f.x, f.z, 8)) return 'no shore to build a fisher on';
      if (gameNear(g, hq.cx, hq.cz, 20, hq.door).hares < 10) return 'too few hares within 20';
      return roomFor(g, ['hunter'], 14);
    },
  },
  // ---------------------------------------------------------------- IV
  {
    id: 'panem',
    title: 'Panem',
    subtitle: 'Bread',
    briefing: [
      'Fish and hare feed a camp; bread feeds a province. It takes four buildings, and I will not pretend otherwise.',
      'A Grain Farm sows fields around itself and reaps them in a minute and a half. A Windmill grinds the grain. A Waterworks by the water fills buckets. A Bakery takes flour and water and gives us loaves.',
      'When something stands idle, the Economy tab says what is short. Read it before you build a second of anything.',
    ],
    debrief: 'Bread. Now the mines can be fed, when there are mines.',
    hook: 'Next: the border, which is closer than you think.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['farm', 'waterworks', 'mill', 'bakery', 'pigfarm', 'slaughter'],
    setup: (g) => {
      coreB(g);
      stockUp(g, { grain: 4 });
      const hq = hqOf(g);
      revealAround(g, hq.cx, hq.cz, 28);
    },
    goals: [
      {
        id: 'chain', text: 'Raise the bread chain: Farm, Waterworks, Windmill, Bakery', hint: 'The farm wants open grass around it; the waterworks wants water within its circle.',
        done: (g) => (['farm', 'waterworks', 'mill', 'bakery'] as const).every((t) => has(g, t)),
        progress: (g) => `${(['farm', 'waterworks', 'mill', 'bakery'] as const).filter((t) => has(g, t)).length}/4`,
        focus: { build: 'farm' },
        satisfy: (g) => {
          const hq = hqOf(g), wt = nearestWater(g);
          prebuilt(g, 'farm', hq.cx + 9, hq.cz + 8, 14);
          if (wt) prebuilt(g, 'waterworks', wt.x, wt.z, 10);
          prebuilt(g, 'mill', hq.cx - 7, hq.cz - 6, 12);
          prebuilt(g, 'bakery', hq.cx + 7, hq.cz - 6, 12);
        },
      },
      {
        id: 'bread', text: 'Bake 8 loaves', hint: 'Grain ripens, the mill grinds, the bakery waits on flour and water. Watch the Economy tab.',
        done: (g) => me(g).produced.bread >= 8, progress: (g) => `${Math.min(8, me(g).produced.bread)}/8`,
        focus: { building: (g) => first(g, 'bakery')?.id ?? 0 },
        satisfy: (g) => { me(g).produced.bread = 8; },
      },
      {
        id: 'prio', text: 'Put the Bakery first in line', hint: 'Select it and press P, or the star: its goods and crews come before all others.', optional: true,
        done: (g) => mine(g).some((b) => b.type === 'bakery' && b.priority),
        focus: { building: (g) => first(g, 'bakery')?.id ?? 0 },
        satisfy: (g) => { const b = first(g, 'bakery'); if (b) g.setPriority(b, true); },
      },
    ],
    tips: [
      { id: 'farm', on: 'built', when: (g, e) => g.buildings.get(e.b ?? 0)?.type === 'farm', title: 'Grain takes ninety seconds to ripen.', detail: 'The farmer sows first and reaps later; the mill waits meanwhile.' },
      { id: 'flour', on: 'produced', when: (_g, e) => e.good === 'flour', title: 'Flour.', detail: 'Flour and water make bread; the bakery’s panel shows both piles.' },
      { id: 'prio', on: 'priority', title: 'The starred building comes first.', detail: 'Goods and crews go there before anywhere else. Only one at a time.' },
      { id: 'economy', on: 'time', when: (g) => g.time > 240, title: 'The Economy tab.', detail: 'What is made and used each minute, and which tools are short. Read it before building a second of anything.' },
    ],
    probe: (g) => {
      const hq = hqOf(g), wt = nearestWater(g);
      if (!wt || sq(wt.x - hq.cx) + sq(wt.z - hq.cz) > sq(16)) return 'no water within 16 of the headquarters';
      if (!placeNear(g, g.local, 'waterworks', wt.x, wt.z, 8)) return 'no room for a waterworks by the water';
      let fields = 0;
      g.world.forRadius(hq.cx, hq.cz, 12, (_i, x, y) => { const a = g.anchorFor('farm', x, y); if (g.placeError('farm', g.local, a.x, a.y) === null) fields = Math.max(fields, plantableNear(g, a.x + 1.5, a.y + 1.5, 7)); });
      if (fields < 14) return `no farm site with room for fields (${fields})`;
      return roomFor(g, ['mill', 'bakery'], 12);
    },
  },
  // ---------------------------------------------------------------- V
  {
    id: 'fines',
    title: 'Fines',
    subtitle: 'The Border',
    briefing: [
      'Your land ends where the headquarters’ reach ends: a circle, and everything of ours inside it. The mountain to the north-east is outside it, and the mountain is where the iron is.',
      'A Guard Tower claims a smaller circle of its own once a soldier walks into it; a Watchtower a larger one. The headquarters sends the soldier by itself and keeps two back.',
      'Build on land that is not yours and the building burns. Build at the edge and the edge moves. Pioneers, if you have a shovel and a spare man, stake out land with nothing but their feet.',
    ],
    debrief: 'A tower, and the hill inside it. The Senate likes a border it can see.',
    hook: 'Next: what the hill is made of.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['tower_s', 'tower_l'],
    tools: ['pioneer'],
    setup: (g) => {
      coreB(g);
      const hq = hqOf(g), m = mountainCentre(g);
      revealAround(g, hq.cx, hq.cz, 28);
      if (m) revealAround(g, m.x, m.z, 16);
    },
    goals: [
      {
        id: 'tower', text: 'Build a Guard Tower at the edge of your land', hint: 'Towards the mountain. A soldier walks out to it by himself.',
        done: mannedTower, focus: { build: 'tower_s', spot: (g) => borderToward(g, mountainCentre(g), 12) },
        satisfy: (g) => { const b = borderToward(g, mountainCentre(g), 12)!; const t = prebuilt(g, 'tower_s', b.x, b.z, 9); moveGarrison(g, hqOf(g), t, 1); recomputeTerritory(g); },
      },
      {
        id: 'ore', text: 'Bring the ore inside the border: 30 rock nodes with ore', hint: 'A second tower further out, a watchtower, or pioneers. Ore glitters in the rock once a geologist has been - for now, the mountain is enough.',
        done: (g) => ownedOre(g) >= 30, progress: (g) => `${Math.min(30, ownedOre(g))}/30`,
        focus: { spot: mountainCentre },
        satisfy: (g) => { const t = towerToMountain(g); void t; },
      },
      {
        id: 'stake', text: 'Stake land with a pioneer', hint: 'The Pioneer card in the Military tab: click free land just beyond the border.', optional: true,
        done: (g) => tally(g, 'staked') > 0, focus: { tool: 'pioneer' },
        satisfy: (g) => { const hq = hqOf(g); g.emit({ type: 'staked', owner: g.local, x: hq.cx, z: hq.cz }); },
      },
    ],
    tips: [
      { id: 'manned', on: 'occupied', title: 'A soldier walked out of the headquarters by himself.', detail: 'It keeps two back. The border moved with him: look at the minimap.' },
      { id: 'staked', on: 'staked', title: 'Staked.', detail: 'Pioneers claim a patch each; a foreign tower takes it back for good.' },
      { id: 'burn', on: 'razed', title: 'On land that turns foreign a building burns.', detail: 'Build behind your towers, not beside them.' },
    ],
    probe: (g) => {
      const hq = hqOf(g), m = mountainCentre(g), w = g.world;
      if (!m) return 'no mountain by the start';
      let ore = 0;
      w.forRadius(hq.cx, hq.cz, 26, (i) => { if (w.ore[i]) ore++; });
      if (ore < 45) return `only ${ore} ore nodes within 26 of the headquarters`;
      const b = borderToward(g, m, 12)!;
      if (!placeNear(g, g.local, 'tower_s', b.x, b.z, 9)) return 'no room for a guard tower on the border towards the mountain';
      if (!placeNear(g, g.local, 'tower_l', borderToward(g, m, 11)!.x, borderToward(g, m, 11)!.z, 9)) return 'no room for a watchtower towards the mountain';
      return null;
    },
  },
  // ---------------------------------------------------------------- VI
  {
    id: 'metalla',
    title: 'Metalla',
    subtitle: 'The Mines',
    briefing: [
      'The mountain is inside the border. What is inside the mountain, nobody knows, and I will not have the men digging at random.',
      'Send a geologist. Any free carrier will take the trade; pick the card in the Industry tab and click the mountain. He probes eight spots and leaves a sign at each: black lumps for coal, rust for iron, gold for gold, a cross for nothing.',
      'A mine goes on a sign, or where the rock has begun to glitter. Its marker glows green over a rich vein. And a mine eats: one meal a cart. The larder is full for now.',
    ],
    debrief: 'Coal and iron ore, in carts. The smiths will want both, and the miners will want dinner.',
    hook: 'Next: bars, and tools.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['coalmine', 'ironmine', 'stonemine'],
    tools: ['geologist'],
    setup: (g) => {
      coreB(g);
      towerToMountain(g);
      stockUp(g, { bread: 10, fish: 10, meat: 10 });
      const hq = hqOf(g), m = mountainCentre(g);
      revealAround(g, hq.cx, hq.cz, 28);
      if (m) revealAround(g, m.x, m.z, 16);
    },
    goals: [
      {
        id: 'geo', text: 'Send a geologist onto the mountain', hint: 'Industry tab, the Geologist card, then click the mountain inside your border. Coal and iron must both be found.',
        done: knowsCoalAndIron, focus: { tool: 'geologist', spot: mountainCentre },
        progress: (g) => { const w = g.world; let c = false, i = false; for (let k = 0; k < w.N && !(c && i); k++) if (w.known(k, g.local)) { if (w.ore[k] === ORE_COAL) c = true; if (w.ore[k] === ORE_IRON) i = true; } return `${c ? 'coal' : 'coal?'} · ${i ? 'iron' : 'iron?'}`; },
        satisfy: (g) => { const m = mountainCentre(g)!; knowOre(g, g.local, m.x, m.z, 14); },
      },
      {
        id: 'coal', text: 'Open a Coal Mine on a coal vein', hint: 'The marker glows green where the vein is rich.',
        done: (g) => liveMine(g, 'coalmine'), focus: { build: 'coalmine', spot: mountainCentre },
        satisfy: (g) => { const s = bestMineSite(g, 'coalmine')!; g.addBuilding('coalmine', g.local, s.x, s.y, true); },
      },
      {
        id: 'iron', text: 'Open an Iron Mine on an iron vein', hint: 'Rust-red signs. A mine on the wrong vein digs nothing.',
        done: (g) => liveMine(g, 'ironmine'), focus: { build: 'ironmine', spot: mountainCentre },
        satisfy: (g) => { const s = bestMineSite(g, 'ironmine')!; g.addBuilding('ironmine', g.local, s.x, s.y, true); },
      },
      {
        id: 'carts', text: 'Mine 10 coal and 6 iron ore', hint: 'Miners eat one meal a cart. When the food stops, so do they.',
        done: (g) => me(g).produced.coal >= 10 && me(g).produced.ironore >= 6,
        progress: (g) => `${Math.min(10, me(g).produced.coal)}/10 coal · ${Math.min(6, me(g).produced.ironore)}/6 ore`,
        satisfy: (g) => { me(g).produced.coal = 10; me(g).produced.ironore = 6; },
      },
    ],
    tips: [
      { id: 'sign', on: 'sign', title: 'A sign.', detail: 'What lies beneath and how much. It fades after eight minutes; the ore stays known, and the rock glitters.' },
      { id: 'mine', on: 'built', when: (g, e) => !!g.buildings.get(e.b ?? 0)?.def.mine, title: 'A mine.', detail: 'It eats one meal a cart: bread, fish or meat. Watch its food pile.' },
      { id: 'geologist', on: 'equip', title: 'He set out with a hammer.', detail: 'Geologists work only inside your border, and need a store on this land to come home to.' },
    ],
    probe: (g) => {
      if (!mannedTower(g)) return 'the watchtower is not manned';
      const c = bestMineSite(g, 'coalmine'), i = bestMineSite(g, 'ironmine');
      if (!c || c.ore < 20) return `no coal vein worth a mine inside the border (${c?.ore ?? 0})`;
      if (!i || i.ore < 20) return `no iron vein worth a mine inside the border (${i?.ore ?? 0})`;
      return null;
    },
  },
  // ---------------------------------------------------------------- VII
  {
    id: 'ferrum',
    title: 'Ferrum',
    subtitle: 'Iron',
    briefing: [
      'Ore is a rock with ambitions. An Iron Smelter turns it into bars with coal; a Toolsmith turns bars into tools with more coal. Two coal mines for one smelter is the rule of thumb.',
      'You will have noticed the second sawmill standing idle. It wants a saw, and the store had one. The toolsmith forges whatever idle buildings lack; the sliders in the Economy tab tell him what to stockpile.',
      'Iron feeds tools, weapons, warships and engines. Everything from here on begins at that furnace.',
    ],
    debrief: 'Every man has his tool again. I have stopped hearing about it.',
    hook: 'Next: arms.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['ironsmelter', 'toolsmith'],
    setup: (g) => {
      coreB(g);
      towerToMountain(g);
      minesOnTheMountain(g);
      const hq = hqOf(g);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz + 5, 10);
      stockUp(g, { saw: 1, coal: 6, iron: 0, bread: 10, fish: 10, meat: 10 });
      revealAround(g, hq.cx, hq.cz, 28);
    },
    goals: [
      {
        id: 'smelter', text: 'Build an Iron Smelter', hint: 'Ore and coal in, bars out.',
        done: (g) => has(g, 'ironsmelter'), focus: { build: 'ironsmelter' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'ironsmelter', hq.cx, hq.cz + 7, 11); },
      },
      {
        id: 'toolsmith', text: 'Build a Toolsmith', hint: 'Bars and coal in, whatever is missing out.',
        done: (g) => has(g, 'toolsmith'), focus: { build: 'toolsmith' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'toolsmith', hq.cx, hq.cz - 7, 11); },
      },
      {
        id: 'bars', text: 'Smelt 5 iron bars', hint: 'The smelter waits on ore and coal alike; the mines must keep up.',
        done: (g) => me(g).produced.iron >= 5, progress: (g) => `${Math.min(5, me(g).produced.iron)}/5`,
        satisfy: (g) => { me(g).produced.iron = 5; },
      },
      {
        id: 'tools', text: 'Forge 3 tools', hint: 'The idle sawmill asks for a saw first. Raise a slider in the Economy tab to stockpile a tool.',
        done: (g) => toolsMade(g) >= 3, progress: (g) => `${Math.min(3, toolsMade(g))}/3`,
        focus: { building: (g) => first(g, 'toolsmith')?.id ?? 0 },
        satisfy: (g) => { me(g).produced.saw = 3; },
      },
    ],
    tips: [
      { id: 'iron', on: 'produced', when: (_g, e) => e.good === 'iron', title: 'A bar of iron.', detail: 'Tools, weapons, warships and engines all begin here.' },
      { id: 'tool', on: 'produced', when: (_g, e) => (TOOLS as readonly string[]).includes(e.good ?? ''), title: 'A tool.', detail: 'The toolsmith forges what idle buildings lack; a slider in the Economy tab makes him stockpile one.' },
      { id: 'saw', on: 'time', when: (g) => g.time > 20 && mine(g).some((b) => b.type === 'sawmill' && b.stall?.kind === 'tool'), title: 'The second sawmill wants a saw.', detail: 'The store had one. Until the toolsmith forges another, it stands.' },
    ],
    probe: (g) => spineProbe(g) ?? (mine(g).filter((b) => b.type === 'sawmill').length === 2 ? null : 'two sawmills should stand') ?? roomFor(g, ['ironsmelter', 'toolsmith'], 12),
  },
  // ---------------------------------------------------------------- VIII
  {
    id: 'arma',
    title: 'Arma',
    subtitle: 'Arms',
    briefing: [
      'Seven soldiers hold this province, and two of them are the headquarters’ own. The Senate does not call that a garrison; it calls it a rumour.',
      'A Weaponsmith beats bars into swords and bows; the slider on its panel says which. Barracks take one weapon and one idle carrier and give back a soldier, and they leave four carriers free however many weapons wait, so homes come before recruits.',
      'Gold, if the mountain has any, does nothing but sit in the store; it happens to make every soldier fight harder while it does.',
    ],
    debrief: 'Twelve soldiers. The Ninth had four thousand, and look where that got them.',
    hook: 'Next: the road, and who is on it.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['weaponsmith', 'barracks', 'goldmine', 'goldsmelter'],
    setup: (g) => {
      coreC(g);
      stockUp(g, { sword: 2, bow: 2 });
      const hq = hqOf(g);
      revealAround(g, hq.cx, hq.cz, 30);
    },
    goals: [
      {
        id: 'weapons', text: 'Build a Weaponsmith', hint: 'Bars and coal in; swords or bows out, by its slider.',
        done: (g) => has(g, 'weaponsmith'), focus: { build: 'weaponsmith' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'weaponsmith', hq.cx + 8, hq.cz - 3, 12); },
      },
      {
        id: 'barracks', text: 'Build Barracks', hint: 'One weapon and one idle carrier make a soldier. They leave four carriers free.',
        done: (g) => has(g, 'barracks'), focus: { build: 'barracks' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'barracks', hq.cx - 9, hq.cz - 4, 12); },
      },
      {
        id: 'muster', text: 'Muster 12 soldiers', hint: 'Four weapons wait in the store; the rest must be forged.',
        done: (g) => pop(g).soldiers >= 12, progress: (g) => `${Math.min(12, pop(g).soldiers)}/12`,
        focus: { building: (g) => first(g, 'barracks')?.id ?? 0 },
        satisfy: (g) => { const hq = hqOf(g); for (let k = pop(g).soldiers; k < 12; k++) g.syncPos(g.addSettler(g.local, 'swordsman', hq.door)); },
      },
      {
        id: 'gold', text: 'Gold in the store: morale', hint: 'A Gold Mine on a gold vein and a Gold Smelter. Twenty-five gold is the most that counts.', optional: true,
        done: (g) => me(g).morale > 0, progress: (g) => `${Math.round(me(g).morale * 100)}%`, focus: { build: 'goldmine' },
        satisfy: (g) => stockUp(g, { gold: 10 }),
      },
    ],
    tips: [
      { id: 'recruit', on: 'soldier', title: 'A recruit.', detail: 'One weapon and one idle carrier. He walks to the headquarters and waits for a tower to need him.' },
      { id: 'weapon', on: 'produced', when: (_g, e) => e.good === 'sword' || e.good === 'bow', title: 'A weapon.', detail: 'Swordsmen hold a line; bowmen shoot over it. The weaponsmith’s slider sets the mix.' },
      { id: 'gold', on: 'produced', when: (_g, e) => e.good === 'gold', title: 'Gold.', detail: 'In the store it raises morale: up to sixty percent harder blows at twenty-five bars.' },
      { id: 'idle', on: 'time', when: (g) => g.time > 120 && pop(g).idle <= 4, title: 'The barracks keep four carriers free.', detail: 'Build homes for more men, or they train nobody.' },
    ],
    probe: (g) => spineProbe(g) ?? roomFor(g, ['weaponsmith', 'barracks'], 12),
  },
  // ---------------------------------------------------------------- IX
  {
    id: 'pugna',
    title: 'Prima Pugna',
    subtitle: 'First Blood',
    briefing: [
      'Deserters of the Ninth Legion hold two towers on the road east and call themselves free men. The Senate calls them something shorter.',
      'Select a tower of theirs and press Attack, and your men march by themselves. Or command them: drag a box around your soldiers, right-click where they should go or what they should storm, and a number key with Ctrl keeps a group under it. A captured tower keeps its land and its walls.',
      'They will not take it kindly. When they come, select a tower of yours, call out its garrison to meet them, and R sends the men back to their posts.',
    ],
    debrief: 'The road is ours. The deserters were not many, and are fewer.',
    hook: 'Next: the gods, who have been patient.',
    map: { size: 128, seed: 3, players: 2, aiLevel: 0, islands: false },
    unlocks: ['residence_l'],
    rules: {
      rivals: [{ mode: 'dormant', noPeople: true, name: 'The Ninth' }],
      reveal: 'strongholds',
      raids: [{ t: 75, after: 'captured', from: 'edge', men: { sword: 3, bow: 0, hp: 80 }, target: 'nearest-tower' }],
    },
    setup: (g) => {
      coreD(g, 10);
      fort(g, { type: 'tower_s', owner: 1, near: { dist: [24, 28], toward: 'rival' }, garrison: { sword: 1, bow: 0 } });
      fort(g, { type: 'tower_s', owner: 1, near: { dist: [29, 34], toward: 'rival', spread: Math.PI / 2 }, garrison: { sword: 2, bow: 0 } });
      const hq = hqOf(g);
      revealAround(g, hq.cx, hq.cz, 30);
    },
    goals: [
      {
        id: 'first', text: 'Storm the rebel tower on the road', hint: 'Select it and press Attack, or box-select your men and right-click it. Five swordsmen are plenty for one.',
        done: (g) => fortAt(g, 0)?.owner === g.local, focus: { building: (g) => g.ms?.forts[0] ?? 0 },
        satisfy: (g) => { const b = fortAt(g, 0); if (b) handOver(g, b, g.local); },
      },
      {
        id: 'second', text: 'Take the second tower', hint: 'Two men inside. Bring more than two.',
        done: (g) => fortAt(g, 1)?.owner === g.local, focus: { building: (g) => g.ms?.forts[1] ?? 0 },
        satisfy: (g) => { const b = fortAt(g, 1); if (b) handOver(g, b, g.local); },
      },
      {
        id: 'hold', text: 'Hold them: both manned, no rebel left in the field', hint: 'A captured tower wants a garrison. The deserters send a band to take theirs back.',
        done: (g) => [0, 1].every((k) => { const b = fortAt(g, k); return !!b && b.owner === g.local && b.occupied; }) && !rebelsAfield(g) && tally(g, 'raid') > 0,
        progress: (g) => rebelsAfield(g) ? 'rebels in the field' : tally(g, 'raid') ? 'held' : 'waiting',
        satisfy: (g) => { for (const s of [...g.settlers.values()]) if (s.owner === 1 && !s.inside) g.removeSettler(s); g.emit({ type: 'raid', owner: 1, x: 0, z: 0 }); },
      },
    ],
    tips: [
      { id: 'march', on: 'attack', title: 'They march.', detail: 'Swordsmen in front, bowmen behind. The tower\u2019s garrison comes out to meet them.' },
      { id: 'taken', on: 'captured', title: 'Captured.', detail: 'A taken tower keeps its land. One man of yours mans it now; it wants more.' },
      { id: 'raid', on: 'raid', title: 'The deserters come for their tower.', detail: 'Select a tower of yours and Call out its garrison to meet them. R sends the men back.', focus: { building: (g) => g.ms?.forts[0] ?? 0 } },
      { id: 'group', on: 'time', when: (g) => g.time > 90, title: 'Groups.', detail: 'Box-select soldiers, then Ctrl (or Option) and a number key keeps them under it. The number picks them again; twice takes you there.' },
    ],
    voice: { raid: 'They are coming for it. Call out the garrison, legate; a tower is worth a fight.' },
    probe: (g) => {
      if (g.ms?.forts.length !== 2) return 'two rebel towers should stand';
      if (!g.ms.forts.every((id) => g.buildings.get(id)?.occupied)) return 'a rebel tower is not manned';
      if (pop(g).soldiers < 10) return `only ${pop(g).soldiers} soldiers`;
      return spineProbe(g);
    },
  },
  // ---------------------------------------------------------------- X
  {
    id: 'dei',
    title: 'Dei',
    subtitle: 'The Gods',
    briefing: [
      'The priests have written to the Senate, and the Senate has written to me. A province without a temple is a camp, they say, whatever its walls.',
      'A Vineyard grows the wine; carriers take it to a Temple, where the priest offers it and the gods answer in mana. The Faith tab holds what you can ask of them.',
      'Blessed Harvest ripens every field and vine in its circle at once. Healing Light mends your soldiers and puts iron in their arms for a minute. Both reach only so far from your strongholds. Ask for both; I want to see the priests earn their keep.',
    ],
    debrief: 'The priests are content and the fields are early. I distrust both, but I will take the grain.',
    hook: 'Next: donkeys.',
    map: { size: 128, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['vineyard', 'temple'],
    tools: ['spells'],
    setup: (g) => {
      coreC(g);
      const hq = hqOf(g), wt = nearestWater(g);
      prebuilt(g, 'farm', hq.cx + 9, hq.cz + 8, 14);
      if (wt) prebuilt(g, 'waterworks', wt.x, wt.z, 10);
      stockUp(g, { wine: 4 });
      revealAround(g, hq.cx, hq.cz, 30);
    },
    goals: [
      {
        id: 'vines', text: 'Plant a Vineyard', hint: 'It wants open ground around it, like a farm. The vines fruit in two minutes.',
        done: (g) => has(g, 'vineyard'), focus: { build: 'vineyard' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'vineyard', hq.cx - 9, hq.cz + 9, 14); },
      },
      {
        id: 'temple', text: 'Build a Temple', hint: 'Four boards, six stone, and a priest from among your carriers.',
        done: (g) => has(g, 'temple'), focus: { build: 'temple' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'temple', hq.cx + 10, hq.cz - 8, 14); },
      },
      {
        id: 'harvest', text: 'Call Blessed Harvest over your fields', hint: 'Faith tab, fifteen mana, then click the farm. Everything growing in the circle ripens.',
        done: (g) => tally(g, 'spell:harvest') > 0, progress: (g) => tally(g, 'spell:harvest') ? 'called' : `${Math.floor(me(g).mana)}/15 mana`,
        focus: { tool: 'spells' },
        satisfy: (g) => { const hq = hqOf(g); g.emit({ type: 'spell', kind: 'harvest', owner: g.local, x: hq.cx, z: hq.cz }); },
      },
      {
        id: 'heal', text: 'Call Healing Light on your soldiers', hint: 'Twenty mana, over the headquarters. Wounds close and blows land harder for a minute.',
        done: (g) => tally(g, 'spell:heal') > 0, progress: (g) => tally(g, 'spell:heal') ? 'called' : `${Math.floor(me(g).mana)}/20 mana`,
        focus: { tool: 'spells' },
        satisfy: (g) => { const hq = hqOf(g); g.emit({ type: 'spell', kind: 'heal', owner: g.local, x: hq.cx, z: hq.cz }); },
      },
    ],
    tips: [
      { id: 'wine', on: 'produced', when: (_g, e) => e.good === 'wine', title: 'Wine.', detail: 'Carriers take it to the temple; the priest offers it. Nobody drinks it, which I find hard to believe.' },
      { id: 'offering', on: 'offering', title: 'An offering.', detail: 'Three mana a cycle, up to a hundred and fifty. Spells need a temple, a priest at his post and reach from a stronghold.' },
      { id: 'cast', on: 'spell', title: 'The gods answered.', detail: 'Four seconds, and the priests can ask again.' },
    ],
    probe: (g) => spineProbe(g) ?? (has(g, 'farm') && has(g, 'waterworks') ? null : 'the farm and the waterworks should stand') ?? roomFor(g, ['vineyard', 'temple'], 14),
  },
  // ---------------------------------------------------------------- XI
  {
    id: 'mercatura',
    title: 'Mercatura',
    subtitle: 'Trade',
    briefing: [
      'The far side of the mountain has the better veins, so the mines are there, with a storehouse and a watchtower, and the food is here. The miners are eating the walk.',
      'A Market Place is the end of a road. Build one here and one there; in one, choose the other as destination and click + on the goods to send, and carriers stock them. A Donkey Ranch breeds the donkeys that carry them, two goods a trip, fed on grain and water.',
      'Twelve goods delivered up the road, and the miners will stop writing to me.',
    ],
    debrief: 'The mines are fed and the donkeys are not consulted. That is trade.',
    hook: 'Next: the sea.',
    map: { size: 160, seed: 7, players: 1, aiLevel: 0, islands: false },
    unlocks: ['market', 'donkeyfarm'],
    setup: (g) => {
      coreB(g);
      const hq = hqOf(g), m = mountainCentre(g);
      // the far camp: a watchtower beyond the mountain, its mines and a store; the food stays at home
      const far = borderToward(g, m, 30)!;
      // (on nobody's land: the tower stands beyond the border and makes its own)
      const a = placeNear(g, g.local, 'tower_l', far.x, far.z, 14, true);
      if (!a) throw new Error(`campaign: no room for the far watchtower near ${far.x.toFixed(0)},${far.z.toFixed(0)}`);
      const tower = g.addBuilding('tower_l', g.local, a.x, a.y, true);
      moveGarrison(g, hq, tower, 1);
      recomputeTerritory(g);
      for (const t of ['coalmine', 'ironmine'] as const) {
        const site = bestMineSite(g, t, g.local, 16, { x: tower.cx, z: tower.cz });
        if (!site || site.ore < 15) throw new Error(`campaign: no far vein for a ${t}`);
        knowOre(g, g.local, site.x + 1, site.y + 1, 5);
        g.addBuilding(t, g.local, site.x, site.y, true);
      }
      prebuilt(g, 'storehouse', tower.cx, tower.cz, 10);
      prebuilt(g, 'farm', hq.cx + 9, hq.cz + 8, 14);
      const wt = nearestWater(g);
      if (wt) prebuilt(g, 'waterworks', wt.x, wt.z, 10);
      stockUp(g, { grain: 20, water: 20, bread: 16, fish: 12, meat: 10, board: 50, stone: 30 });
      revealAround(g, hq.cx, hq.cz, 30);
      revealAround(g, tower.cx, tower.cz, 20);
    },
    goals: [
      {
        id: 'ranch', text: 'Build a Donkey Ranch', hint: 'Grain and water in, a donkey out every so often. Two donkeys, and four more for every market.',
        done: (g) => has(g, 'donkeyfarm'), focus: { build: 'donkeyfarm' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'donkeyfarm', hq.cx - 9, hq.cz + 8, 14); },
      },
      {
        id: 'markets', text: 'Two Market Places: one at the camp, one at the mines', hint: 'Then, in one, choose the other as destination and click + on bread, fish or meat.',
        done: (g) => has(g, 'market', 2), progress: (g) => `${Math.min(2, g.countBuildings(g.local, 'market', false))}/2`,
        focus: { build: 'market', spot: (g) => { const t = mine(g).find((b) => b.type === 'tower_l'); return t ? { x: t.cx, z: t.cz, r: 5 } : null; } },
        satisfy: (g) => { const hq = hqOf(g), t = mine(g).find((b) => b.type === 'tower_l')!; prebuilt(g, 'market', hq.cx + 7, hq.cz - 7, 12); prebuilt(g, 'market', t.cx, t.cz + 4, 12); },
      },
      {
        id: 'caravan', text: 'Send food up the road: 12 goods delivered by caravan', hint: 'The market panel: destination, then + on the goods. Carriers stock the pile; donkeys carry it.',
        done: (g) => me(g).traded >= 12, progress: (g) => `${Math.min(12, me(g).traded)}/12`,
        focus: { building: (g) => first(g, 'market')?.id ?? 0 },
        satisfy: (g) => { me(g).traded = 12; },
      },
    ],
    tips: [
      { id: 'market', on: 'built', when: (g, e) => g.buildings.get(e.b ?? 0)?.type === 'market', title: 'A market.', detail: 'The end of a road. Its panel: choose the other market, then + on the goods to send.' },
      { id: 'donkey', on: 'donkey', title: 'A donkey.', detail: 'It waits at a market with goods to carry; two a trip.' },
      { id: 'caravan', on: 'caravan', title: 'Delivered.', detail: 'Carriers at the far end take it on to whoever needs it.' },
    ],
    probe: (g) => {
      const tower = mine(g).find((b) => b.type === 'tower_l');
      if (!tower || !tower.occupied) return 'the far watchtower should stand manned';
      if (!liveMine(g, 'coalmine') || !liveMine(g, 'ironmine')) return 'the far mines sit on no ore';
      if (hypot(tower.cx - hqOf(g).cx, tower.cz - hqOf(g).cz) < 24) return 'the far camp is not far';
      if (!placeNear(g, g.local, 'market', tower.cx, tower.cz + 4, 12)) return 'no room for a market at the far camp';
      return roomFor(g, ['market', 'donkeyfarm'], 14);
    },
  },
  // ---------------------------------------------------------------- XII
  {
    id: 'mare',
    title: 'Mare Nostrum',
    subtitle: 'Our Sea',
    briefing: [
      'There is an island off this coast, and the fishermen say it glitters. The Senate has heard the fishermen.',
      'A Harbour goes on the shore beside deep water; a Shipyard likewise, and it builds a ship from ten boards. A harbour can send an expedition: a builder, a digger, a soldier, two carriers and the makings of a second harbour, by ship, to found a colony where you point.',
      'Once the colony stands and a soldier mans it, ships carry goods between your harbours by themselves, or as you order.',
    ],
    debrief: 'A harbour, a ship, a colony. Rome began smaller, though it did not have to swim.',
    hook: 'Next: engines.',
    map: { size: 160, seed: 27, players: 1, aiLevel: 0, islands: true },
    unlocks: ['harbour', 'shipyard'],
    setup: (g) => {
      coreC(g);
      stockUp(g, { board: 60, stone: 30 });
      const hq = hqOf(g), isle = nearestIsle(g);
      revealAround(g, hq.cx, hq.cz, 30);
      if (isle) revealAround(g, isle.x, isle.y, isle.r + 7);
    },
    goals: [
      {
        id: 'harbour', text: 'Build a Harbour on the coast', hint: 'Beside deep water: the markers show where a ship can moor.',
        done: (g) => !!homeHarbour(g), focus: { build: 'harbour', spot: (g) => { const i = seaNear(g, hqOf(g).cx, hqOf(g).cz, 24); return i < 0 ? null : { x: g.world.nx(i), z: g.world.ny(i), r: 3 }; } },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'harbour', hq.cx, hq.cz, 15); },
      },
      {
        id: 'yard', text: 'Build a Shipyard', hint: 'On the coast too. Ten boards make a ship.',
        done: (g) => has(g, 'shipyard'), focus: { build: 'shipyard' },
        satisfy: (g) => { const hb = homeHarbour(g) ?? hqOf(g); prebuilt(g, 'shipyard', hb.cx, hb.cz, 15); },
      },
      {
        id: 'ship', text: 'Launch a ship', hint: 'The shipyard\u2019s panel shows the hull on the slipway.',
        done: (g) => ownShip(g), focus: { building: (g) => first(g, 'shipyard')?.id ?? 0 },
        satisfy: (g) => { const y = first(g, 'shipyard'); if (y) launchShip(g, g.local, y); },
      },
      {
        id: 'colony', text: 'Found a colony on the island', hint: 'The harbour\u2019s panel: Expedition, then click the island\u2019s shore. The party gathers, sails, and builds.',
        done: colonyHarbour, focus: { building: (g) => homeHarbour(g)?.id ?? 0 },
        satisfy: (g) => { foundColony(g); },
      },
      {
        id: 'cargo', text: 'A ship unloads at the colony', hint: 'The harbour\u2019s Shipping section: choose the colony and + on boards.', optional: true,
        done: (g) => tally(g, 'unloaded') > 0,
        satisfy: (g) => { const hq = hqOf(g); g.emit({ type: 'unloaded', owner: g.local, x: hq.cx, z: hq.cz }); },
      },
    ],
    tips: [
      { id: 'launch', on: 'launch', title: 'A ship.', detail: 'Twenty goods or twelve settlers. It waits at your harbour for orders.' },
      { id: 'expedition', on: 'expedition', title: 'An expedition gathers.', detail: 'Five people and a harbour\u2019s worth of boards and stone at the dock; the ship takes them over.' },
      { id: 'landed', on: 'landed', title: 'Landed.', detail: 'The colony\u2019s harbour holds the shore until its soldier mans it.' },
      { id: 'unloaded', on: 'unloaded', title: 'Unloaded.', detail: 'Ships keep a colony supplied by themselves; Shipping orders send what you choose.' },
    ],
    probe: (g) => {
      const hq = hqOf(g);
      if (seaNear(g, hq.cx, hq.cz, 16) < 0) return 'no sea within 16 of the headquarters';
      if (!placeNear(g, g.local, 'harbour', hq.cx, hq.cz, 15)) return 'no harbour site by the headquarters';
      if (!placeNear(g, g.local, 'shipyard', hq.cx, hq.cz, 15)) return 'no shipyard site by the headquarters';
      if (!colonySpot(g)) return 'no island coast for a colony';
      return spineProbe(g);
    },
  },
  // ---------------------------------------------------------------- XIII
  {
    id: 'machinae',
    title: 'Machinae',
    subtitle: 'Engines',
    briefing: [
      'The Ninth again: a watchtower and two guard towers on the hill road, and this time they have bowmen on the walls. Men at the door of a manned watchtower die at the door.',
      'A Siege Workshop builds catapults from boards and iron. Select one and right-click a stronghold: its stones kill the garrison first, then bring the walls down. It cannot fight, so send swordsmen with it, formed up in front, and tell them to stand firm.',
      'Their tower is out of the catapult\u2019s range from your land, so it must roll out beyond the border. Escort it.',
    ],
    debrief: 'The tower fell without a man of ours at its door. Engineers are worth their iron.',
    hook: 'Next: the fleet.',
    map: { size: 160, seed: 12, players: 2, aiLevel: 0, islands: true },
    unlocks: ['siegeworks'],
    rules: { rivals: [{ mode: 'dormant', noPeople: true, name: 'The Ninth' }], reveal: 'strongholds' },
    setup: (g) => {
      coreD(g, 12);
      stockUp(g, { iron: 10 });
      fort(g, { type: 'tower_l', owner: 1, near: { dist: [28, 32], toward: 'rival' }, garrison: { sword: 1, bow: 2 } });
      fort(g, { type: 'tower_s', owner: 1, near: { dist: [27, 33], toward: 'rival', spread: Math.PI / 2 }, garrison: { sword: 1, bow: 0 } });
      fort(g, { type: 'tower_s', owner: 1, near: { dist: [27, 33], toward: 'rival', spread: Math.PI / 2 }, garrison: { sword: 1, bow: 0 } });
      const hq = hqOf(g);
      revealAround(g, hq.cx, hq.cz, 30);
    },
    goals: [
      {
        id: 'works', text: 'Build a Siege Workshop', hint: 'Military tab. Boards and iron; an engineer with a hammer.',
        done: (g) => has(g, 'siegeworks'), focus: { build: 'siegeworks' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'siegeworks', hq.cx - 9, hq.cz + 9, 14); },
      },
      {
        id: 'engine', text: 'A catapult rolls out', hint: 'Six boards and four iron, in four stages. It parks in the yard.',
        done: (g) => pop(g).catapults >= 1, focus: { building: (g) => first(g, 'siegeworks')?.id ?? 0 },
        satisfy: (g) => { const w = first(g, 'siegeworks'); if (w) spawnCatapult(g, w); },
      },
      {
        id: 'tower', text: 'Bring down the rebel watchtower', hint: 'Select the catapult, right-click the watchtower. Swordsmen in front of it: the garrison sallies at anything within reach.',
        done: (g) => fortDown(g, 0), focus: { building: (g) => g.ms?.forts[0] ?? 0 },
        satisfy: (g) => { const b = fortAt(g, 0); if (b) handOver(g, b, g.local); },
      },
      {
        id: 'road', text: 'Clear the road: both guard towers', hint: 'Stones or swords, as you like.', optional: true,
        done: (g) => fortDown(g, 1) && fortDown(g, 2),
        satisfy: (g) => { for (const k of [1, 2]) { const b = fortAt(g, k); if (b) handOver(g, b, g.local); } },
      },
    ],
    tips: [
      { id: 'machine', on: 'machine', title: 'A catapult.', detail: 'Select it and right-click a stronghold. It cannot fight back: send swordsmen along.' },
      { id: 'hit', on: 'siegehit', title: 'A stone through the roof.', detail: 'One of the garrison falls with each hit; an empty tower loses its walls.' },
      { id: 'razed', on: 'razed', title: 'Walls down.', detail: 'A ruined tower gives its land back.' },
      { id: 'firm', on: 'time', when: (g) => g.time > 60, title: 'Stand firm.', detail: 'Select the escort and set a formation and Stand firm in their panel: they hold their line instead of chasing.' },
    ],
    probe: (g) => {
      if (g.ms?.forts.length !== 3) return 'three rebel towers should stand';
      if (!g.ms.forts.every((id) => g.buildings.get(id)?.occupied)) return 'a rebel tower is not manned';
      return spineProbe(g) ?? roomFor(g, ['siegeworks'], 14);
    },
  },
  // ---------------------------------------------------------------- XIV
  {
    id: 'classis',
    title: 'Classis',
    subtitle: 'The Fleet',
    briefing: [
      'The Ninth have taken to the water: a tower on the shore north of the harbour and a ship that stops ours. Land is my business; this is yours.',
      'The shipyard\u2019s panel has a switch: Warship. Twelve boards and three iron fittings, and a catapult on the foredeck. Select the warship and right-click an enemy ship to hunt it, or a stronghold by the water to shell it; it stands off beyond the archers\u2019 reach where the coast allows.',
      'A battered ship mends at its harbour. Bring it home between fights.',
    ],
    debrief: 'A warship of our own. Varro will have heard the news by now.',
    hook: 'Next: Varro.',
    map: { size: 160, seed: 29, players: 2, aiLevel: 0, islands: true },
    unlocks: [],
    tools: ['warships'],
    rules: { rivals: [{ mode: 'dormant', noPeople: true, name: 'The Ninth' }], reveal: 'strongholds' },
    setup: (g) => {
      coreD(g, 8);
      const hq = hqOf(g);
      const hb = prebuilt(g, 'harbour', hq.cx, hq.cz, 15);
      prebuilt(g, 'shipyard', hb.cx, hb.cz, 15);
      stockUp(g, { board: 40, iron: 8 });
      fort(g, { type: 'tower_s', owner: 1, near: { dist: [24, 34], toward: 'rival', spread: Math.PI }, garrison: { sword: 1, bow: 1 }, coastal: true });
      const w = g.world, dock = w.nx(hb.dock), dz = w.ny(hb.dock);
      ship(g, { kind: 'trade', owner: 1, x: dock + (dock - hb.cx) * 6, z: dz + (dz - hb.cz) * 6, r: 30 });
      revealAround(g, hq.cx, hq.cz, 30);
      const sh = g.ships.get(g.ms!.ships[0]);
      if (sh) revealAround(g, sh.x, sh.z, 10);
    },
    goals: [
      {
        id: 'warship', text: 'Set the yard to warships and launch one', hint: 'The switch in the shipyard\u2019s panel; then twelve boards and three iron.',
        done: (g) => ownShip(g, 'war'), focus: { tool: 'warships', building: (g) => first(g, 'shipyard')?.id ?? 0 },
        satisfy: (g) => { const y = first(g, 'shipyard'); if (y) launchShip(g, g.local, y, 'war'); },
      },
      {
        id: 'shore', text: 'Shell the rebel tower on the shore', hint: 'Select the warship, right-click the tower. It finds its own water within range.',
        done: (g) => fortDown(g, 0) && tally(g, `siegehit:ship:${g.ms?.forts[0]}`) > 0, focus: { building: (g) => g.ms?.forts[0] ?? 0 },
        satisfy: (g) => { const b = fortAt(g, 0); if (b) { g.emit({ type: 'siegehit', b: b.id, owner: g.local, kind: 'ship', x: b.cx, z: b.cz }); handOver(g, b, g.local); } },
      },
      {
        id: 'sink', text: 'Sink the rebel ship', hint: 'Right-click it with the warship selected. Everyone aboard goes down with it.',
        done: (g) => tally(g, `sinking:${g.ms?.ships[0]}`) > 0,
        focus: { spot: (g) => { const sh = g.ships.get(g.ms?.ships[0] ?? 0); return sh ? { x: sh.x, z: sh.z, r: 4 } : null; } },
        satisfy: (g) => { const sh = g.ships.get(g.ms!.ships[0]); if (sh) sinkShip(g, sh, g.local); },
      },
    ],
    tips: [
      { id: 'warship', on: 'warship', title: 'A warship.', detail: 'Right-click a ship to hunt it, a shore tower to shell it. It keeps beyond the archers where it can.' },
      { id: 'broadside', on: 'broadside', title: 'A stone from the foredeck.', detail: 'Twenty of a ship\u2019s hundred and twenty; a tower\u2019s garrison falls a man a hit.' },
      { id: 'sinking', on: 'sinking', title: 'She goes down.', detail: 'Everyone aboard is lost with a ship. Mend yours at a harbour between fights.' },
    ],
    probe: (g) => {
      if (!homeHarbour(g) || !has(g, 'shipyard')) return 'the harbour and the shipyard should stand';
      const f = fortAt(g, 0);
      if (!f || !f.occupied) return 'the shore tower should stand manned';
      if (seaNear(g, f.cx, f.cz, 8) < 0) return 'the shore tower is not by the water';
      if (!g.ships.get(g.ms!.ships[0])) return 'the rebel ship should be at sea';
      return spineProbe(g);
    },
  },
  // ---------------------------------------------------------------- XV
  {
    id: 'provincia',
    title: 'Provincia',
    subtitle: 'The Province',
    briefing: [
      'Quintus Varro, legate of Nova Ostia, has declared his colony independent of the Senate, and therefore of us. He has a headquarters, towers, a harbour and ambitions.',
      'You have everything this province has taught you, and the Senate has opened its last doors: the Castle, and the Great Temple with the Wrath of the Heavens in it.',
      'Take or raze his strongholds one after another until the last lays down its arms. A colony whose headquarters falls cannot hide its towers, and one down to its last three will yield. The sea gives you ten minutes\u2019 truce. Use them.',
    ],
    debrief: 'The last of Varro\u2019s towers strikes its colours. Terra Nova is a province of Rome, and you are its governor. I have counted everything. It comes to: enough.',
    hook: 'The maps beyond are yours to draw: Free play, any size, any rivals.',
    map: { size: 160, seed: 9, players: 2, aiLevel: 1, islands: true },
    unlocks: ['greattemple', 'castle'],
    rules: { rivals: [{ mode: 'ai', level: 1, name: 'Nova Ostia' }], truce: 600 },
    setup: (g) => {
      coreD(g, 10);
      const hq = hqOf(g), wt = nearestWater(g);
      prebuilt(g, 'farm', hq.cx + 9, hq.cz + 8, 14);
      if (wt) prebuilt(g, 'waterworks', wt.x, wt.z, 10);
      prebuilt(g, 'mill', hq.cx - 7, hq.cz - 7, 14);
      prebuilt(g, 'bakery', hq.cx + 7, hq.cz - 8, 14);
      stockUp(g, { board: 60, stone: 40, coal: 12, iron: 10, sword: 4, bow: 2, bread: 16, fish: 12, meat: 10 });
      revealAround(g, hq.cx, hq.cz, 30);
    },
    goals: [
      {
        id: 'varro', text: 'Break the colony of Nova Ostia', hint: 'Its headquarters first makes the rest easy: a fallen realm cannot hide its towers, and at three or fewer it yields.',
        done: allRivalsDefeated, progress: (g) => g.players[1]?.alive ? `${strongholdsOf(g, 1).length} strongholds stand` : 'fallen',
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
      {
        id: 'wrath', text: 'Raise a Great Temple and call down the Wrath of the Heavens', hint: 'Eight boards, fourteen stone; fifty mana; lightning on his soldiers.', optional: true,
        done: (g) => has(g, 'greattemple') && tally(g, 'spell:wrath') > 0, focus: { build: 'greattemple' },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'greattemple', hq.cx, hq.cz, 26); g.emit({ type: 'spell', kind: 'wrath', owner: g.local, x: hq.cx, z: hq.cz }); },
      },
      {
        id: 'overseas', text: 'Hold a colony overseas at the end', hint: 'A harbour, a ship, an expedition: as in Mare Nostrum.', optional: true,
        done: colonyHarbour,
        satisfy: (g) => { foundColony(g); },
      },
    ],
    tips: [
      { id: 'truce', on: 'truceover', title: 'The truce is over.', detail: 'Varro may march at any time. Towers on the road towards him, manned.' },
      { id: 'fallen', on: 'time', when: (g) => !!g.players[1]?.fallen && !!g.players[1]?.alive, title: 'His headquarters is down.', detail: 'His towers show through the fog now. Three left and no castle: he yields.' },
      { id: 'castle', on: 'built', when: (g, e) => g.buildings.get(e.b ?? 0)?.type === 'castle', title: 'A castle.', detail: 'Ten men and the widest circle a stronghold claims. A realm with a castle never yields.' },
    ],
    voice: { truceover: 'The truce is over. Varro may march at any time. I would have towers on the road by now.' },
    probe: (g) => {
      if (g.ai.length !== 1 || g.ai[0].level !== 1 || g.ai[0].mode !== 'ai') return 'Nova Ostia should be a Normal computer kingdom';
      if (g.players[1].name !== 'Nova Ostia') return 'the rival should be Nova Ostia';
      if (pop(g).soldiers < 10) return `only ${pop(g).soldiers} soldiers`;
      return spineProbe(g) ?? (has(g, 'bakery') ? null : 'the bread chain should stand');
    },
  },
];
