// The campaign: fifteen missions that raise a Roman province one lesson at a time, told by Gaius
// Sestius, quaestor. Content only; the framework is campaign.ts. The narration in voice/SCRIPT.md is
// generated from this file (scripts/voicelines.ts), so the words here are the words that are spoken.
// Game helpers may be imported, but only used inside functions: game.ts imports this file through
// campaign.ts, so nothing here may run at load.
import { has, hqOf, mine, nearestRock, nearestTrees, placeNear, prebuilt, revealAround, stock, stockUp, tally, type Mission } from './campaign';
import type { Game } from './game';
import { sq } from '../core/fmath';

/** Trees grown enough to fell, and stone in the rocks, within reach of the headquarters. */
function woodAndStoneNear(g: Game, r: number) {
  const w = g.world, hq = hqOf(g);
  let trees = 0, stone = 0;
  for (const t of g.trees.values()) if (t.growth >= 1 && sq(w.nx(t.node) - hq.cx) + sq(w.ny(t.node) - hq.cz) <= sq(r)) trees++;
  for (const s of g.stones.values()) if (sq(w.nx(s.node) - hq.cx) + sq(w.ny(s.node) - hq.cz) <= sq(r)) stone += s.amount;
  return { trees, stone };
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
];
