// The campaign: fifteen missions that raise a Roman province one lesson at a time, told by Gaius
// Sestius, quaestor. Content only; the framework is campaign.ts. The narration in voice/SCRIPT.md is
// generated from this file (scripts/voicelines.ts), so the words here are the words that are spoken.
// Game helpers may be imported, but only used inside functions: game.ts imports this file through
// campaign.ts, so nothing here may run at load.
import {
  addCarriers, bestMineSite, borderToward, fewerCarriers, fillResidence, has, hqOf, knowOre, knowsCoalAndIron, me, mine, mountainCentre, moveGarrison,
  nearestFish, nearestRock, nearestTrees, nearestWater, ownedOre, placeNear, plantableNear, pop, prebuilt, revealAround, stock, stockUp, tally, type Mission,
} from './campaign';
import type { Game } from './game';
import type { Building } from './types';
import { ORE_COAL, ORE_IRON, TOOLS, type BuildingType } from './defs';
import { recomputeTerritory } from './military';
import { gameNear } from './wildlife';
import { sq } from '../core/fmath';

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
/** A watchtower on the border towards the mountain, manned from the headquarters, and the land it takes. */
function towerToMountain(g: Game) {
  const b = borderToward(g, mountainCentre(g), 11)!;
  const tower = prebuilt(g, 'tower_l', b.x, b.z, 9);
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
];
