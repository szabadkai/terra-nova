// The campaign, The Province (CAMPAIGN.md): the regions of Terra Nova, each a designed map (recipes.ts)
// with everything granted, a working enemy and an hour of play. Content only, like missions.ts, and
// under the same rule: game helpers may be imported but only used inside functions, since game.ts
// imports this file through campaign.ts.
import {
  allRivalsDefeated, atPeace, bandLeft, colonySpot, fleetLeft, fortAt, garrison, has, hqOf, knowOre, me, mine, nearestRock, nearestTrees, placeNear, prebuilt, raidersLeft, raidsBroken,
  revealAround, seaNear, ship, stock, tally, type FleetOrder, type Mission,
} from './campaign';
import { BUILDINGS } from './defs';
import { afloat, sinkShip } from './naval';
import { launchShip } from './sea';
import type { Game } from './game';
import { strongholdsOf } from './game';
import type { Building } from './types';
import { recomputeTerritory, turnCoat } from './military';
import { REGION_INFO, type RegionId } from './province';
import { recipeById } from './recipes';
import { addCarriers, fillResidence, nearestFish, nearestWater, stockUp } from './campaign';
import { hypot, sq } from '../core/fmath';

const fortOf = (g: Game, k: number): Building | undefined => g.buildings.get(g.ms?.forts[k] ?? 0);
/** Taken (ours now) or gone. */
const fortTaken = (g: Game, k: number) => { const b = fortOf(g, k); return !b || b.state === 'burning' || b.owner === g.local; };
/** A manned stronghold of the player's (not the headquarters) within r of a spot. */
const holds = (g: Game, x: number, z: number, r: number) =>
  mine(g).some((b) => b.def.military && b.type !== 'hq' && b.state === 'done' && b.occupied && sq(b.cx - x) + sq(b.cz - z) <= sq(r));
const seenAt = (g: Game, x: number, z: number) => ((g.world.seen[g.world.idx(x, z)] >> g.local) & 1) === 1;
/** The middle of the player's soldiers in the field within r of a spot (where a frost would catch most), if there are `n` of them. */
function ourMenNear(g: Game, x: number, z: number, r: number, n = 3): { x: number; z: number } | null {
  let sx = 0, sz = 0, k = 0;
  for (const s of g.settlers.values()) {
    if (s.owner !== g.local || s.dead || s.hidden || (s.job !== 'swordsman' && s.job !== 'bowman')) continue;
    if (sq(s.x - x) + sq(s.z - z) > sq(r)) continue;
    sx += s.x; sz += s.z; k++;
  }
  return k >= n ? { x: sx / k, z: sz / k } : null;
}
/** Ours now (the fort taken), not burnt. */
const fortOurs = (g: Game, k: number) => { const b = fortOf(g, k); return !!b && b.owner === g.local && b.state !== 'burning'; };

/** The player's share and a rival's of the land nodes in a zone (a region's farmland): 0..1 each. */
const zoneCache = new WeakMap<Game, number[]>();
function shares(g: Game, zone: (x: number, z: number) => boolean, rival = 1): { mine: number; theirs: number } {
  const w = g.world;
  let nodes = zoneCache.get(g);
  if (!nodes) {
    nodes = [];
    for (let i = 0; i < w.N; i++) if (!w.isWater(i) && !w.cliff[i] && zone(w.nx(i), w.ny(i))) nodes.push(i);
    zoneCache.set(g, nodes);
  }
  let a = 0, b = 0;
  for (const i of nodes) { if (w.owner[i] === g.local) a++; else if (w.owner[i] === rival) b++; }
  return { mine: a / Math.max(1, nodes.length), theirs: b / Math.max(1, nodes.length) };
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** A building of the player's that stores goods within r of a spot, with at least n of a good in it. */
const storeWith = (g: Game, x: number, z: number, r: number, good: 'bread', n: number) =>
  mine(g).find((b) => b.def.storage && b.state === 'done' && sq(b.cx - x) + sq(b.cz - z) <= sq(r) && b.stock[good] - (b.outgoing[good] ?? 0) >= n);
/** Whether a player's land reaches within r of a spot. */
const landNear = (g: Game, x: number, z: number, r: number) => {
  let found = false;
  g.world.forRadius(x, z, r, (i) => { if (!found && g.world.owner[i] === g.local) found = true; });
  return found;
};

// the places on Saltus's map (recipes.ts)
const GROVE = { x: 80, z: 80 }, NINTH = { x: 48, z: 46 }, NEAR_NINTH = 26;
// Metalla, Collis, Ara (recipes.ts)
const RAMP_FOOT = { x: 58, z: 110 }, RAMP_TOP = { x: 90, z: 76 };
const HILLS = [{ x: 42, z: 58 }, { x: 118, z: 58 }, { x: 80, z: 92 }];
const TEMPLE = { x: 82, z: 78 }, PILGRIMS = { x: 58, z: 102 };
/** A store of the player's within r of a spot holding what a feast takes. */
const feastAt = (g: Game, x: number, z: number, r: number) =>
  mine(g).find((b) => b.def.storage && b.state === 'done' && sq(b.cx - x) + sq(b.cz - z) <= sq(r) && b.stock.bread - (b.outgoing.bread ?? 0) >= 15 && b.stock.meat - (b.outgoing.meat ?? 0) >= 10);
/** The one building of a type a mission's setup placed for a rival, by the tally key it keeps (`ms.forts` holds strongholds only). */
const templeOf = (g: Game) => [...g.buildings.values()].find((b) => b.sacred);
/** Vallis: the valley's floor between the walls' feet, and the hour the harvest comes in. */
const inValley = (x: number, z: number) => z > 26 && z < 134 && x > 6 && x < 154;
const HARVEST = 35 * 60, CLAIM = 0.25;
const PASS_WEST = { x: 66, z: 89 }, PASS = { x: 80, z: 88 }, FORT = { x: 104, z: 84 }, GOAT = { x: 81, z: 26 }, SW_MOUNTAIN = { x: 30, z: 124 };

export const REGIONS: Mission[] = [
  {
    id: 'saltus',
    kicker: 'The Province',
    title: 'Saltus',
    subtitle: 'The Pass',
    briefing: [
      'The Senate’s governor has landed at Nova Ostia, and his first act was to close the pass. The road east runs through Saltus; so, now, do his toll, his fort and, I am told, his priests.',
      'The valley is ours and nothing in it is built. Wood, stone, homes, bread: you know the order. The mountain in the south-west has coal and iron, and we will want both before the snow.',
      'He will not come himself. He will send men through the pass, a few at first and more each time. Put a tower at our end of it and keep men in it. When we are ready, we go through the other way.',
    ],
    debrief: 'The fort at the far end flies our colours and the road east is open. Varro has written to the Senate that we attacked him. I have written that we were in a hurry.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 31, players: 2, aiLevel: 1, islands: false, recipe: 'saltus' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'builder', level: 0, name: 'Varro’s Legion' }],
      raids: [
        { t: 600, from: 'rival', men: { sword: 2, bow: 0 }, target: 'nearest-tower' },
        { t: 900, from: 'rival', men: { sword: 2, bow: 1 }, target: 'nearest-tower' },
        { t: 1200, from: 'rival', men: { sword: 3, bow: 1 }, target: 'nearest-tower' },
        { t: 1500, from: 'rival', men: { sword: 3, bow: 2 }, target: 'nearest-tower' },
        { t: 1800, from: 'rival', men: { sword: 4, bow: 3 }, target: 'nearest-tower' },
      ],
      script: [
        {
          id: 'letter', when: { t: 25 },
          do: [{ a: 'say', who: 'varro', title: 'A letter from Nova Ostia', text: 'To the camp in the valley. The pass is closed by order of the Senate. Those who would use it will pay the toll at the fort, or turn back. — Q. Varro, governor.' }],
        },
        {
          id: 'goat', when: { test: (g) => seenAt(g, GOAT.x, GOAT.z) },
          do: [{ a: 'say', who: 'quaestor', title: 'A way over the wall.', text: 'In the north the rock is low enough for goats, and for men who do not mind goats. It comes down behind his fort.' }],
        },
        {
          id: 'toll', when: { test: (g) => (g.ms?.raid ?? 0) >= 3 && raidersLeft(g) === 0 },
          do: [{ a: 'say', who: 'varro', title: 'Another letter', text: 'Your men fight well for men without a governor. The toll has doubled.' }],
        },
        {
          // the priests at the fort hold a storming party fast, once
          id: 'frost', when: { test: (g) => !!fortOf(g, 0) && fortOf(g, 0)!.owner !== g.local && !!ourMenNear(g, FORT.x, FORT.z, 9) },
          do: [{ a: 'cast', spell: 'freeze', at: (g) => ourMenNear(g, FORT.x, FORT.z, 9) }],
        },
        {
          id: 'counter', when: { test: (g) => fortTaken(g, 0) },
          do: [
            { a: 'say', who: 'varro', title: 'The fort is the Senate’s.', text: 'I shall have it back before the week is out, and the men who took it.' },
            { a: 'raid', band: 'counter', raid: { from: 'rival', men: { sword: 5, bow: 3, level: 1 }, target: (g) => (fortOurs(g, 0) ? fortOf(g, 0) : undefined) } },
            { a: 'attack', men: 4, target: (g) => (fortOurs(g, 0) ? fortOf(g, 0) : undefined) },
          ],
        },
        {
          id: 'held', when: { test: (g) => bandLeft(g, 'counter').sent && bandLeft(g, 'counter').alive === 0 },
          do: [{ a: 'say', who: 'quaestor', title: 'They broke on the walls.', text: 'Varro has lost his fort twice in a week. He will write to the Senate about it, at length.' }],
        },
      ],
    },
    setup: (g) => {
      const hq = hqOf(g);
      // the camp: the column's carpenters had a head start
      const t = nearestTrees(g), r = nearestRock(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz + 1, 10);
      // Varro's side: the fort at the far mouth of the pass, and the priests in his camp
      fortAt(g, 'tower_l', 1, FORT.x, FORT.z, 6, { sword: 3, bow: 2 });
      const v = hqOf(g, 1);
      prebuilt(g, 'greattemple', v.cx + 9, v.cz + 5, 12, 1);
      prebuilt(g, 'vineyard', v.cx - 8, v.cz + 7, 12, 1);
      // (enough for a frost or two when the fort is stormed; the vineyard earns the rest)
      g.players[1].mana = 40;
      recomputeTerritory(g);
      // the quaestor's scouts have been over the south-west mountain: its veins are known
      knowOre(g, g.local, SW_MOUNTAIN.x, SW_MOUNTAIN.z, 12);
      revealAround(g, SW_MOUNTAIN.x, SW_MOUNTAIN.z, 12);
      // the pass and the fort beyond it are known ground
      revealAround(g, PASS.x, PASS.z, 9);
      revealAround(g, FORT.x, FORT.z, 7);
    },
    goals: [
      {
        id: 'mouth', text: 'Man a tower at the western mouth of the pass',
        hint: 'Towers claim land as they go: one towards the pass, then one at its mouth, where the road leaves the valley.',
        done: (g) => holds(g, PASS_WEST.x, PASS_WEST.z, 9),
        focus: { build: 'tower_s', spot: () => ({ x: PASS_WEST.x, z: PASS_WEST.z, r: 4 }) },
        satisfy: (g) => {
          const a = placeNear(g, g.local, 'tower_l', PASS_WEST.x, PASS_WEST.z, 8, true) ?? placeNear(g, g.local, 'tower_l', PASS_WEST.x, PASS_WEST.z, 8);
          if (!a) throw new Error('no room at the mouth of the pass');
          const b = g.addBuilding('tower_l', g.local, a.x, a.y, true);
          const s = g.addSettler(g.local, 'swordsman', b.door);
          s.hidden = true; s.inside = b.id; s.sstate = 'garrison'; s.home = b.id; b.garrison.push(s.id); b.occupied = true;
          recomputeTerritory(g);
        },
      },
      {
        id: 'iron', text: 'Smelt 20 bars of iron',
        hint: 'The south-west mountain has both veins: a coal mine and an iron mine, bread or fish for the miners, a smelter between them.',
        done: (g) => me(g).produced.iron >= 20, progress: (g) => `${Math.min(20, me(g).produced.iron)}/20`,
        focus: { build: 'ironsmelter', spot: () => ({ x: SW_MOUNTAIN.x, z: SW_MOUNTAIN.z, r: 6 }) },
        satisfy: (g) => { me(g).produced.iron = 20; },
      },
      {
        id: 'raids', text: 'Break Varro’s five raids',
        hint: 'They come through the pass and go for the tower nearest them. Keep it manned: a watchtower holds five, and the headquarters sends men to fill it.',
        done: raidsBroken,
        progress: (g) => `${Math.min(5, g.ms?.raid ?? 0)}/5 have marched${raidersLeft(g) ? ` · ${raidersLeft(g)} still standing` : ''}`,
        satisfy: (g) => {
          const ms = g.ms!;
          ms.raid = g.mission!.rules!.raids!.length;
          for (const id of ms.raiders ?? []) { const s = g.settlers.get(id); if (s) g.removeSettler(s); }
        },
      },
      {
        id: 'fort', text: 'Take the fort at the eastern mouth',
        hint: 'Its garrison comes out to meet an attack, and his priests can freeze a crowd where it stands. Go in with men to spare, or come down on it by the goat path in the north.',
        done: (g) => fortTaken(g, 0),
        focus: { spot: () => ({ x: FORT.x, z: FORT.z, r: 4 }) },
        satisfy: (g) => { const b = fortOf(g, 0); if (b) g.destroyBuilding(b, false); },
      },
      {
        id: 'hold', text: 'Hold it against his counterattack',
        hint: 'His veterans march from the camp once the fort falls. Fill it from the headquarters and keep men near it.',
        done: (g) => { const c = bandLeft(g, 'counter'); return c.sent && c.alive === 0; },
        progress: (g) => { const c = bandLeft(g, 'counter'); return c.sent ? `${c.alive} of his men still standing` : 'not yet'; },
        satisfy: (g) => {
          const ms = g.ms!;
          if (!ms.fired?.includes('counter')) (ms.fired ??= []).push('counter');
          for (const id of ms.bands?.counter ?? []) { const s = g.settlers.get(id); if (s) g.removeSettler(s); }
          (ms.bands ??= {}).counter = [];
        },
      },
      {
        id: 'goat', text: 'Find the goat path over the wall', optional: true,
        hint: 'Somewhere in the north the wall is low enough to climb. A tower up there would see it.',
        done: (g) => seenAt(g, GOAT.x, GOAT.z),
        satisfy: (g) => revealAround(g, GOAT.x, GOAT.z, 5),
      },
      {
        id: 'camp', text: 'Break Varro’s camp beyond the pass', optional: true,
        hint: 'His headquarters, his temple and the gold in the hills behind it. Once his headquarters falls, his towers cannot hide.',
        done: allRivalsDefeated,
        satisfy: (g) => { for (const b of [...g.buildings.values()]) if (b.owner === 1 && b.def.military) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'raid', on: 'raid', title: 'Men in the pass.', detail: 'They go for the tower nearest them. Its garrison fights at the door; the headquarters sends more.' },
      { id: 'wall', on: 'time', when: (g) => g.time > 90, title: 'The dark ridge is sheer rock.', detail: 'Nobody walks over it or builds on it. The pass is the way east, and the goat path, if you find it.' },
      { id: 'frozen', on: 'frozen', title: 'Frost.', detail: 'Varro’s priests. The frozen can still be struck; send the next men in behind, not with them.' },
    ],
    voice: { raid: 'Men in the pass again.' },
    probe: (g) => {
      if (g.players.length !== 2 || g.ai.length !== 1 || g.ai[0].mode !== 'builder') return 'Varro’s side should be a builder';
      if (sq(SW_MOUNTAIN.x - hqOf(g).cx) + sq(SW_MOUNTAIN.z - hqOf(g).cz) > sq(36)) return 'the iron is too far from the camp';
      if (!fortOf(g, 0)?.occupied) return 'the fort is not manned';
      const w = g.world;
      let cliff = 0;
      for (let i = 0; i < w.N; i++) if (w.cliff[i]) cliff++;
      if (cliff < 1000) return `only ${cliff} nodes of sheer rock`;
      // one landmass, crossed only by the pass and the goat path
      const a = hqOf(g), b = hqOf(g, 1);
      if (w.region[a.door] !== w.region[b.door]) return 'the two sides are not joined';
      const path = g.path.find(a.door, b.door, true, 200000);
      if (!path) return 'no way on foot from camp to camp';
      if (!path.some((n) => sq(w.nx(n) - PASS.x) + sq(w.ny(n) - PASS.z) < sq(10))) return 'the road east does not go through the pass';
      // coal and iron on open rock in the south-west, gold beyond the pass
      let coal = 0, iron = 0, gold = 0;
      w.forRadius(SW_MOUNTAIN.x, SW_MOUNTAIN.z, 12, (i) => { if (!w.cliff[i] && w.isMountain(i)) { if (w.ore[i] === 1) coal += w.oreAmt[i]; if (w.ore[i] === 2) iron += w.oreAmt[i]; } });
      w.forRadius(118, 108, 10, (i) => { if (!w.cliff[i] && w.isMountain(i) && w.ore[i] === 3) gold += w.oreAmt[i]; });
      if (coal < 200 || iron < 200) return `the south-west mountain holds coal ${coal}, iron ${iron}`;
      if (gold < 100) return `the gold beyond the pass is only ${gold}`;
      if (!has(g, 'woodcutter') || !has(g, 'sawmill')) return 'the camp is not standing';
      if (g.countBuildings(1, 'greattemple', false) < 1) return 'Varro has no temple';
      return tally(g, 'raid') === 0 ? null : 'a raid before the start';
    },
  },

  // ---------------------------------------------------------------- Silva
  {
    id: 'silva',
    kicker: 'The Province',
    title: 'Silva',
    subtitle: 'The Forest',
    briefing: [
      'Varro has sold the forest. Not to anyone we know: to a timber company of Nova Ostia, which is to say to Varro, who owns it. His loggers are working in from the north-east and they are not slow.',
      'In the middle of the wood there is an old grove, open ground round a spring, that nobody has built on because the men say it is haunted. Take it. Ground that is flat, watered and haunted is worth three that are only flat.',
      'And somewhere in the north-west are the Ninth, what is left of them after Prima Pugna: forty deserters in a camp, cold and hungry. Hungry men can be fought. They can also be fed.',
    ],
    debrief: 'The forest is ours, the loggers are gone, and the Ninth eat at our table. I have entered them in the rolls as reinforcements. The Senate need not know where from.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 43, players: 3, aiLevel: 1, islands: false, recipe: 'silva' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'builder', level: 1, name: 'The Timber Company' }, { mode: 'dormant', noPeople: true, name: 'The Ninth' }],
      raids: [
        { t: 900, from: 'rival', men: { sword: 2, bow: 1 }, target: 'nearest-tower' },
        { t: 1500, from: 'rival', men: { sword: 3, bow: 1 }, target: 'nearest-tower' },
        { t: 2100, from: 'rival', men: { sword: 4, bow: 2 }, target: 'nearest-tower' },
      ],
      script: [
        {
          id: 'lease', when: { t: 20 },
          do: [{ a: 'say', who: 'varro', title: 'A notice from Nova Ostia', text: 'The Senate has leased the forest of Silva to the timber company of Nova Ostia. Anyone found felling in it will be treated as a thief, and anyone found living in it as a squatter. — Q. Varro, governor.' }],
        },
        {
          id: 'grove', when: { test: (g) => landNear(g, GROVE.x, GROVE.z, 6) },
          do: [{ a: 'say', who: 'quaestor', title: 'The old grove.', text: 'The men say it is haunted. I say it is flat, it has water, and nobody has built on it yet.' }],
        },
        {
          id: 'ninth', when: { test: (g) => landNear(g, NINTH.x, NINTH.z, 24) },
          do: [{ a: 'say', who: 'quaestor', title: 'The Ninth.', text: 'Cold, hungry and ashamed of it. Twenty loaves in a store of ours near their camp and they might remember whose soldiers they were.' }],
        },
        {
          // twenty loaves in a store near their camp: the Ninth come over, towers and all, and burn their camp behind them
          id: 'fed', when: { test: (g) => !!g.players[2]?.alive && !!storeWith(g, NINTH.x, NINTH.z, NEAR_NINTH, 'bread', 20) },
          do: [
            { a: 'do', run: (g) => { const b = storeWith(g, NINTH.x, NINTH.z, NEAR_NINTH, 'bread', 20); if (b) b.stock.bread -= 20; } },
            { a: 'flip', to: 0, pick: (g) => strongholdsOf(g, 2).filter((b) => b.type !== 'hq'), men: { sword: 2, bow: 1, level: 1 } },
            { a: 'join', men: { sword: 4, bow: 2, level: 1 } },
            { a: 'do', run: (g) => { const hq = g.buildings.get(g.players[2].hq); if (hq) g.destroyBuilding(hq, true); } },
            { a: 'say', who: 'quaestor', title: 'The Ninth have eaten our bread.', text: 'And taken our side. Their centurion says he would like a word with Varro, when it is convenient, and a sword when it is not.' },
          ],
        },
        {
          id: 'stockade', when: { test: (g) => fortTaken(g, 0) || fortTaken(g, 1) },
          do: [{ a: 'say', who: 'varro', title: 'On the matter of the timber', text: 'Men who steal the Senate’s timber are hanged at Nova Ostia. I mention it only for your records.' }],
        },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz - 2, 10);
      // the timber company's stockade, pushed into the wood towards the grove
      fortAt(g, 'tower_l', 1, 106, 62, 7, { sword: 3, bow: 1 });
      fortAt(g, 'tower_s', 1, 96, 72, 7, { sword: 2, bow: 0 });
      // the Ninth's camp: their headquarters and two towers, manned
      const n = hqOf(g, 2);
      for (const [dx, dz] of [[9, 3], [-3, 10]]) garrison(g, prebuilt(g, 'tower_s', n.cx + dx, n.cz + dz, 6, 2), { sword: 2, bow: 1 });
      recomputeTerritory(g);
      knowOre(g, g.local, 27, 129, 8);
      revealAround(g, 27, 129, 8);
      revealAround(g, GROVE.x, GROVE.z, 5);
    },
    goals: [
      {
        id: 'grove', text: 'Hold the grove at the forest’s heart',
        hint: 'A tower in the ring of stones by the spring, manned. The wood is thick: towers claim it faster than woodcutters clear it.',
        done: (g) => holds(g, GROVE.x, GROVE.z, 9),
        focus: { build: 'tower_s', spot: () => ({ x: GROVE.x, z: GROVE.z, r: 5 }) },
        satisfy: (g) => { const a = placeNear(g, g.local, 'tower_s', GROVE.x, GROVE.z, 8, true)!; const b = g.addBuilding('tower_s', g.local, a.x, a.y, true); garrison(g, b, { sword: 1, bow: 0 }); recomputeTerritory(g); },
      },
      {
        id: 'ninth', text: 'Win over the Ninth, with bread or with the sword',
        hint: 'Carry twenty loaves into a storehouse of ours near their camp in the north-west, or take their towers.',
        done: (g) => !g.players[2]?.alive || strongholdsOf(g, 2).length === 0,
        progress: (g) => { const s = storeWith(g, NINTH.x, NINTH.z, NEAR_NINTH, 'bread', 0); return s ? `${Math.min(20, s.stock.bread)}/20 loaves near their camp` : `${strongholdsOf(g, 2).length} strongholds of theirs stand`; },
        focus: { build: 'storehouse', spot: () => ({ x: NINTH.x, z: NINTH.z, r: 6 }) },
        satisfy: (g) => { for (const b of strongholdsOf(g, 2)) g.destroyBuilding(b, false); },
      },
      {
        id: 'loggers', text: 'Drive the timber company out of the wood',
        hint: 'Its stockade: a watchtower and a guard tower on the road from the north-east towards the grove.',
        done: (g) => fortTaken(g, 0) && fortTaken(g, 1),
        progress: (g) => `${(fortTaken(g, 0) ? 1 : 0) + (fortTaken(g, 1) ? 1 : 0)}/2`,
        focus: { spot: () => ({ x: 104, z: 64, r: 5 }) },
        satisfy: (g) => { for (const k of [0, 1]) { const b = fortOf(g, k); if (b) g.destroyBuilding(b, false); } },
      },
      {
        id: 'boards', text: 'Stack 60 boards', optional: true,
        hint: 'The forest’s own tribute: what goes into the next region’s wagons.',
        done: (g) => stock(g).board >= 60, progress: (g) => `${Math.min(60, stock(g).board)}/60`,
        satisfy: (g) => { hqOf(g).stock.board = 60; },
      },
      {
        id: 'company', text: 'Break the company’s camp', optional: true,
        hint: 'Its headquarters in the north-east, by the iron and the gold.',
        done: (g) => !g.players[1]?.alive,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'wood', on: 'time', when: (g) => g.time > 60, title: 'The wood is thick.', detail: 'Every tree is a board, and in the way of every building. Woodcutters by the sites you want.' },
      { id: 'raid', on: 'raid', title: 'The company’s guards.', detail: 'They come for the tower nearest their stockade.' },
      { id: 'turncoat', on: 'turncoat', title: 'Turned.', detail: 'The Ninth’s towers fly our colours now, their men in them.' },
    ],
    probe: (g) => {
      if (g.players.length !== 3 || g.ai.length !== 1 || g.ai[0].mode !== 'builder') return 'the company should be the one builder, the Ninth dormant';
      if (!fortOf(g, 0)?.occupied || !fortOf(g, 1)?.occupied) return 'the stockade is not manned';
      if (strongholdsOf(g, 2).filter((b) => b.occupied).length < 3) return 'the Ninth\'s camp is not manned';
      const w = g.world, a = hqOf(g);
      if (!g.path.find(a.door, hqOf(g, 2).door, true, 200000) || !g.path.find(a.door, hqOf(g, 1).door, true, 200000)) return 'the camps are not joined on foot';
      let trees = 0;
      for (const t of g.trees.values()) if (sq(w.nx(t.node) - GROVE.x) + sq(w.ny(t.node) - GROVE.z) < sq(8)) trees++;
      if (trees) return `${trees} trees in the grove`;
      if (!placeNear(g, g.local, 'tower_s', GROVE.x, GROVE.z, 8, true)) return 'no room for a tower in the grove';
      let iron = 0;
      w.forRadius(27, 129, 9, (i) => { if (w.isMountain(i) && w.ore[i] === 2) iron += w.oreAmt[i]; });
      return iron < 150 ? `only ${iron} iron by the camp` : null;
    },
  },

  // ---------------------------------------------------------------- Vallis
  {
    id: 'vallis',
    kicker: 'The Province',
    title: 'Vallis',
    subtitle: 'The Valley',
    briefing: [
      'The best farmland in the province lies in a valley between two walls of mountains, a day’s march long. Varro has granted it to a colony of his veterans, who arrived at the east end this morning with ploughs and surveyors.',
      'We arrived at the west end this morning with ploughs and no surveyors. The Senate’s rule is old and simple: land belongs to whoever holds it. So hold it: towers claim ground, and his colonists are building fast.',
      'They will not fight while the harvest stands in the fields. After the harvest, I would not count on it.',
    ],
    debrief: 'The valley is ours to the lake and beyond it, and the granaries are full. Varro’s veterans have gone back to Nova Ostia to be veterans somewhere else.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 57, players: 2, aiLevel: 2, islands: false, recipe: 'vallis' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'builder', level: 2, name: 'Varro’s Colonists' }],
      script: [
        {
          id: 'deed', when: { t: 20 },
          do: [{ a: 'say', who: 'varro', title: 'A deed of grant', text: 'The valley is granted to the veterans’ colony of Nova Ostia. Your settlers may stay where they stand. Where they stand is not to move.' }],
        },
        {
          id: 'third', when: { test: (g) => shares(g, inValley).mine >= 0.15 },
          do: [{ a: 'say', who: 'quaestor', title: 'The valley is filling up.', text: 'A sixth of it flies our flag. Varro’s surveyors are measuring the rest very quickly.' }],
        },
        {
          // the harvest is in: the colonists turn to war
          id: 'harvest', when: { t: HARVEST },
          do: [
            { a: 'say', who: 'varro', title: 'The harvest is in', text: 'And the survey is finished. What is not mine by the survey will be mine by other means.' },
            { a: 'mode', mode: 'ai' },
            { a: 'raid', band: 'harvest', raid: { from: 'rival', men: { sword: 5, bow: 3, level: 1 }, target: 'nearest-tower' } },
          ],
        },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz + 1, 10);
      knowOre(g, g.local, 36, 42, 9);
      revealAround(g, 36, 42, 9);
      revealAround(g, 80, 80, 11);
    },
    goals: [
      {
        id: 'claim', text: 'Hold a quarter of the valley, and more of it than Varro',
        hint: 'Every tower claims its circle. Watchtowers claim more, and the lake in the middle is the valley’s centre.',
        done: (g) => { const s = shares(g, inValley); return s.mine >= CLAIM && s.mine > s.theirs; },
        progress: (g) => { const s = shares(g, inValley); return `ours ${pct(s.mine)} · Varro’s ${pct(s.theirs)}`; },
        focus: { build: 'tower_l', spot: () => ({ x: 64, z: 80, r: 5 }) },
        satisfy: (g) => {
          // manned watchtowers across the west of the valley until it is claimed
          for (const [x, z] of [[40, 56], [40, 104], [58, 70], [58, 94], [74, 52], [74, 108], [62, 44], [62, 118], [88, 100], [88, 60], [48, 80], [96, 44], [96, 116], [104, 80]]) {
            if (shares(g, inValley).mine >= CLAIM + 0.05) break;
            const a = placeNear(g, g.local, 'tower_l', x, z, 6, true);
            if (!a) continue;
            garrison(g, g.addBuilding('tower_l', g.local, a.x, a.y, true), { sword: 1, bow: 0 });
            recomputeTerritory(g);
          }
        },
      },
      {
        id: 'harvest', text: 'Stand when the harvest is in',
        hint: 'After the harvest his colonists come for the tower nearest them, veterans in front. Fill the towers towards the east.',
        done: (g) => { const b = bandLeft(g, 'harvest'); return b.sent && b.alive === 0; },
        progress: (g) => { const b = bandLeft(g, 'harvest'); return b.sent ? `${b.alive} of them still standing` : `the harvest in ${Math.max(0, Math.ceil((HARVEST - g.time) / 60))} min`; },
        satisfy: (g) => { const ms = g.ms!; if (!ms.fired?.includes('harvest')) (ms.fired ??= []).push('harvest'); (ms.bands ??= {}).harvest = []; },
      },
      {
        id: 'break', text: 'Take three of his strongholds',
        hint: 'Select one in reach and press Attack, or take your soldiers there yourself.',
        done: (g) => tally(g, 'captured') >= 3, progress: (g) => `${Math.min(3, tally(g, 'captured'))}/3`,
        satisfy: (g) => { const ms = g.ms!; ms.tally.captured = 3; },
      },
      {
        id: 'granary', text: 'Fill the granaries: 40 loaves in store', optional: true,
        hint: 'The valley’s own tribute, for the next region’s wagons.',
        done: (g) => stock(g).bread >= 40, progress: (g) => `${Math.min(40, stock(g).bread)}/40`,
        satisfy: (g) => { hqOf(g).stock.bread = 40; },
      },
      {
        id: 'all', text: 'Send the colonists home', optional: true,
        hint: 'Their headquarters at the east end of the valley.',
        done: allRivalsDefeated,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'race', on: 'time', when: (g) => g.time > 120, title: 'A race, for now.', detail: 'His colonists will not attack before the harvest. Their towers claim land as fast as ours: build where the valley is still nobody’s.' },
      { id: 'captured', on: 'captured', title: 'Taken.', detail: 'A captured tower keeps its land. The more of his you hold, the less valley is his.' },
    ],
    probe: (g) => {
      if (g.ai.length !== 1 || g.ai[0].mode !== 'builder' || g.ai[0].level !== 2) return 'the colonists should be a fast builder';
      const w = g.world, a = hqOf(g), b = hqOf(g, 1);
      if (w.region[a.door] !== w.region[b.door]) return 'the two ends are not joined';
      const s = shares(g, inValley);
      if (s.mine > 0.2 || s.theirs > 0.2) return `the valley starts claimed (${pct(s.mine)}, ${pct(s.theirs)})`;
      let iron = 0;
      w.forRadius(36, 42, 9, (i) => { if (w.isMountain(i) && w.ore[i] === 2) iron += w.oreAmt[i]; });
      return iron < 150 ? `only ${iron} iron at the west end` : null;
    },
  },
];

// ------------------------------------------------------------------ Metalla, Collis, Ara
REGIONS.push(
  {
    // (the tutorial has a Metalla of its own: this one's id is the gold)
    id: 'aurum',
    kicker: 'The Province',
    title: 'Metalla',
    subtitle: 'The Gold Plateau',
    briefing: [
      'The gold of Terra Nova is on top of a table of rock with cliffs all round it, and there is one path up. Varro’s mining company holds the top of it, with a watchtower where the path comes over the rim.',
      'Take the foot of the path, then the tower, and the mines are ours to work. Miners eat. Every loaf will go up that path on a carrier’s back.',
      'The hill tribes in the north-west have been watching the path for longer than Varro has owned it. They will watch us too.',
    ],
    debrief: 'The gold comes down the path in carts now, and the bread goes up. The tribes have learned to wave at the carters, which is more than they ever did for Varro.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 61, players: 3, aiLevel: 1, islands: false, recipe: 'metalla' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'builder', level: 1, name: 'The Mining Company' }, { mode: 'dormant', noPeople: true, name: 'The Hill Tribes', people: 'tribes' }],
      // once the path is ours, the tribes try it (unless Collis has made them our friends)
      raids: [
        { t: 150, after: 'captured', rival: 2, from: [40, 72], men: { sword: 3, bow: 1 }, target: (g) => (fortOurs(g, 0) ? fortOf(g, 0) : undefined) },
        { t: 450, after: 'captured', rival: 2, from: [40, 72], men: { sword: 3, bow: 2 }, target: (g) => (fortOurs(g, 0) ? fortOf(g, 0) : undefined) },
        { t: 750, after: 'captured', rival: 2, from: [40, 72], men: { sword: 4, bow: 2 }, target: (g) => (fortOurs(g, 0) ? fortOf(g, 0) : undefined) },
      ],
      script: [
        { id: 'claim', when: { t: 20 }, do: [{ a: 'say', who: 'varro', title: 'On the matter of the plateau', text: 'The gold of Metalla is the Senate’s, and the Senate has let it to my company. Trespass on the path is theft, whatever the tribes may have told you.' }] },
        { id: 'path', when: { test: (g) => fortTaken(g, 0) }, do: [{ a: 'say', who: 'quaestor', title: 'The path is ours.', text: 'Every loaf for the miners goes up it now, and the tribes know it as well as we do. Keep men at the tower.' }] },
        { id: 'tribes', when: { tally: ['raid', 1] }, do: [{ a: 'say', who: 'quaestor', title: 'The tribes.', text: 'Not Varro’s men: the hills’ own. They take what comes up the path, and they have always taken it.' }] },
        { id: 'friends', when: { t: 45, test: (g) => atPeace(g, 2) }, do: [{ a: 'say', who: 'quaestor', title: 'The tribes are watching the path.', text: 'For us, this time. Word has come down from Collis: the carts go up the path unmolested, and anyone else’s do not.' }] },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz - 1, 10);
      fortAt(g, 'tower_l', 1, RAMP_TOP.x, RAMP_TOP.z, 7, { sword: 4, bow: 2 });
      recomputeTerritory(g);
      knowOre(g, g.local, 19, 146, 8);
      revealAround(g, 19, 146, 8);
      revealAround(g, RAMP_FOOT.x, RAMP_FOOT.z, 8);
      revealAround(g, RAMP_TOP.x, RAMP_TOP.z, 6);
    },
    goals: [
      {
        id: 'foot', text: 'Hold the foot of the path',
        hint: 'A tower where the path leaves the lowland, south-west of the cliffs.',
        done: (g) => holds(g, RAMP_FOOT.x, RAMP_FOOT.z, 10),
        focus: { build: 'tower_s', spot: () => ({ x: RAMP_FOOT.x, z: RAMP_FOOT.z, r: 4 }) },
        satisfy: (g) => { const a = placeNear(g, g.local, 'tower_s', RAMP_FOOT.x, RAMP_FOOT.z, 8, true) ?? placeNear(g, g.local, 'tower_s', RAMP_FOOT.x, RAMP_FOOT.z, 8)!; garrison(g, g.addBuilding('tower_s', g.local, a.x, a.y, true), { sword: 1, bow: 0 }); recomputeTerritory(g); },
      },
      {
        id: 'fort', text: 'Take the watchtower at the top of the path',
        hint: 'The path is narrow: its garrison meets you where only a few can fight at once. Bowmen behind the swords.',
        done: (g) => fortTaken(g, 0),
        focus: { spot: () => ({ x: RAMP_TOP.x, z: RAMP_TOP.z, r: 4 }) },
        satisfy: (g) => { const b = fortOf(g, 0); if (b) turnCoat(g, b, g.local, { sword: 2, bow: 0 }); recomputeTerritory(g); },
      },
      {
        id: 'gold', text: 'Smelt 10 bars of gold',
        hint: 'The gold is in the mountains on the plateau: a gold mine, coal, and a gold smelter. The miners eat what comes up the path.',
        done: (g) => me(g).produced.gold >= 10, progress: (g) => `${Math.min(10, me(g).produced.gold)}/10`,
        focus: { build: 'goldmine' },
        satisfy: (g) => { me(g).produced.gold = 10; },
      },
      {
        id: 'camp', text: 'Close the mining company', optional: true,
        hint: 'Its headquarters on the plateau.',
        done: (g) => !g.players[1]?.alive,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'cliff', on: 'time', when: (g) => g.time > 90, title: 'The dark rim is sheer.', detail: 'Nobody climbs it. The path is the only way up, for us and for the carts.' },
      { id: 'raid', on: 'raid', title: 'Tribesmen on the path.', detail: 'They go for the tower at the top. Keep it full.' },
    ],
    probe: (g) => {
      if (!fortOf(g, 0)?.occupied) return 'the watchtower is not manned';
      const w = g.world, a = hqOf(g), b = hqOf(g, 1);
      const path = g.path.find(a.door, b.door, true, 200000);
      if (!path) return 'no way up to the plateau';
      if (!path.some((n) => sq(w.nx(n) - 75) + sq(w.ny(n) - 92) < sq(8))) return 'the way up does not take the path';
      // shut the path (its whole length, from the foot to the rim) and the plateau must be out of reach
      const along = (x: number, z: number) => { const t = Math.max(0, Math.min(1, ((x - 60) * 30 + (z - 108) * -32) / (30 * 30 + 32 * 32))); return sq(x - (60 + 30 * t)) + sq(z - (108 - 32 * t)); };
      const ramp = (i: number) => along(w.nx(i), w.ny(i)) < sq(7);
      if (g.path.find(a.door, b.door, true, 400000, (i) => w.walkable(i) && !ramp(i))) return 'the cliffs leave another way up';
      let gold = 0;
      w.forRadius(128, 35, 10, (i) => { if (w.isMountain(i) && w.ore[i] === 3) gold += w.oreAmt[i]; });
      return gold < 200 ? `only ${gold} gold on the plateau` : null;
    },
  },
  {
    id: 'collis',
    kicker: 'The Province',
    title: 'Collis',
    subtitle: 'The Hill Forts',
    briefing: [
      'The upland belongs to the tribes, who have never paid the Senate a tax or Varro a toll, and hold three hills to prove it: a fort on each, one way up each, and their chief behind them in the north.',
      'Hill forts are taken the hard way, one path at a time. Or the other way: the tribes feast before they talk. A store of ours below a hill with fifteen loaves and ten joints of meat in it, and that hill may decide it was always our friend.',
      'Take two, by either means, and I wager the third sends its chief down to talk.',
    ],
    debrief: 'The upland is ours by right of two hills taken and one that came to dinner. The tribes will fight beside us now. They have asked, very politely, to be pointed at Varro.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 67, players: 2, aiLevel: 1, islands: false, recipe: 'collis' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'dormant', noPeople: true, name: 'The Hill Tribes' }],
      raids: [
        { t: 240, after: 'captured', from: 'rival', men: { sword: 3, bow: 2 }, target: 'nearest-tower' },
        { t: 600, after: 'captured', from: 'rival', men: { sword: 4, bow: 2 }, target: 'nearest-tower' },
      ],
      script: [
        ...[0, 1, 2].map((k) => ({
          id: `feast${k}`, when: { test: (g: Game) => !fortTaken(g, k) && !!feastAt(g, HILLS[k].x, HILLS[k].z, 18) },
          do: [
            { a: 'do' as const, run: (g: Game) => { const b = feastAt(g, HILLS[k].x, HILLS[k].z, 18); if (b) { b.stock.bread -= 15; b.stock.meat -= 10; } } },
            { a: 'flip' as const, to: 0, pick: (g: Game) => { const b = fortOf(g, k); return b && b.owner !== g.local ? [b] : []; }, men: { sword: 2, bow: 2, level: 1 } },
            { a: 'say' as const, who: 'quaestor' as const, title: 'A feast.', text: 'The hill ate our bread and our meat, and its men came down singing. They are ours now, and they sing worse sober.' },
          ],
        })),
        {
          id: 'yield', when: { test: (g) => [0, 1, 2].filter((k) => fortOurs(g, k)).length >= 2 && [0, 1, 2].some((k) => !fortTaken(g, k)) },
          do: [
            { a: 'flip', to: 0, pick: (g) => [0, 1, 2].map((k) => fortOf(g, k)).filter((b): b is Building => !!b && b.owner !== g.local && b.state !== 'burning'), men: { sword: 2, bow: 2, level: 1 } },
            { a: 'say', who: 'quaestor', title: 'The third hill has sent its chief.', text: 'With a goat and a speech. We accepted the goat.' },
          ],
        },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz - 1, 10);
      for (const h of HILLS) fortAt(g, 'tower_l', 1, h.x, h.z, 7, { sword: 3, bow: 2 });
      recomputeTerritory(g);
      knowOre(g, g.local, 25, 139, 7);
      for (const h of HILLS) revealAround(g, h.x, h.z, 8);
    },
    goals: [
      {
        id: 'hills', text: 'Win the three hill forts',
        hint: 'Storm them up their one path each, or feast one: a storehouse below a hill with 15 loaves and 10 joints of meat. Two won, the third will talk.',
        done: (g) => [0, 1, 2].every((k) => fortTaken(g, k)),
        progress: (g) => `${[0, 1, 2].filter((k) => fortTaken(g, k)).length}/3`,
        focus: { spot: () => ({ x: HILLS[2].x, z: HILLS[2].z, r: 5 }) },
        satisfy: (g) => { for (const k of [0, 1, 2]) { const b = fortOf(g, k); if (b && b.owner !== g.local) turnCoat(g, b, g.local, { sword: 1, bow: 0 }); } recomputeTerritory(g); },
      },
      {
        id: 'feast', text: 'Win a hill with a feast', optional: true,
        hint: 'Fifteen loaves and ten joints of meat in a storehouse of ours below it.',
        done: (g) => [0, 1, 2].some((k) => g.ms?.fired?.includes(`feast${k}`)),
        satisfy: (g) => { (g.ms!.fired ??= []).push('feast0'); },
      },
      {
        id: 'chief', text: 'Burn the chief’s camp', optional: true,
        hint: 'In the north, behind the hills.',
        done: (g) => !g.players[1]?.alive,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'turncoat', on: 'turncoat', title: 'A hill has come over.', detail: 'Its men fight for us now, and its land is ours.' },
      { id: 'raid', on: 'raid', title: 'The chief’s men.', detail: 'Out of the north, for the nearest tower of ours.' },
    ],
    probe: (g) => {
      if ([0, 1, 2].some((k) => !fortOf(g, k)?.occupied)) return 'a hill fort is not manned';
      const w = g.world, a = hqOf(g);
      for (const k of [0, 1, 2]) if (!g.path.find(a.door, fortOf(g, k)!.door, true, 200000)) return `hill ${k} cannot be reached`;
      return w.region[a.door] === w.region[hqOf(g, 1).door] ? null : 'the chief cannot be reached';
    },
  },
  {
    id: 'ara',
    kicker: 'The Province',
    title: 'Ara',
    subtitle: 'The Sacred Hill',
    briefing: [
      'On the hill in the middle of Ara stands the Great Temple of the province, older than Rome’s claim to it, and Varro’s priests are in it. They can call down lightning, freeze a cohort where it stands, and turn a soldier’s loyalty in his hands. They have been practising.',
      'Three towers keep the hilltop; two paths go up, the pilgrims’ from our side and the priests’ from his. Take the towers and the hill, and the temple with it: a temple goes to whoever holds its ground.',
      'But take it standing. If it burns, the Senate will hear that the legate burned the gods’ house, and the gods will hear it first.',
    ],
    debrief: 'The temple is ours and its priests have changed their prayers. They tell me the gods did not notice. I have entered the temple in the accounts as “restored”.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 71, players: 2, aiLevel: 2, islands: false, recipe: 'ara' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'builder', level: 2, name: 'The Priests of Ara' }],
      raids: [
        { t: 1080, from: 'rival', men: { sword: 3, bow: 2 }, target: 'nearest-tower' },
        { t: 1680, from: 'rival', men: { sword: 4, bow: 3, level: 1 }, target: 'nearest-tower' },
      ],
      fail: (g) => { const t = templeOf(g); return !t || t.state === 'burning' ? 'The Great Temple burned. The gods will remember it, and so will the Senate.' : null; },
      script: [
        { id: 'hymn', when: { t: 25 }, do: [{ a: 'say', who: 'varro', title: 'From the governor, at Ara', text: 'The gods of this province have always been on the Senate’s side. I should not like you to find out how.' }] },
        { id: 'convert', when: { tally: ['converted', 1] }, do: [{ a: 'say', who: 'quaestor', title: 'Converted.', text: 'Three of ours walked over to his side with a hymn on their lips. Do not stand them in a crowd under his hill.' }] },
        { id: 'restored', when: { test: (g) => templeOf(g)?.owner === g.local }, do: [{ a: 'say', who: 'quaestor', title: 'The temple is ours.', text: 'Standing, and with its priests in it, who have changed their prayers. They say the gods did not notice.' }] },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz - 1, 10);
      // the hill's towers first (they make the ground), then the temple on it
      for (const [x, z] of [[74, 70], [92, 74], [80, 88]]) fortAt(g, 'tower_s', 1, x, z, 5, { sword: 2, bow: 1 });
      recomputeTerritory(g);
      const temple = prebuilt(g, 'greattemple', TEMPLE.x, TEMPLE.z, 7, 1);
      temple.sacred = true;
      const v = hqOf(g, 1);
      prebuilt(g, 'vineyard', v.cx - 8, v.cz + 6, 12, 1);
      g.players[1].mana = 150;
      knowOre(g, g.local, 27, 133, 7);
      revealAround(g, TEMPLE.x, TEMPLE.z, 14);
    },
    goals: [
      {
        id: 'foot', text: 'Hold the foot of the pilgrims’ way',
        hint: 'A tower where the path starts up the hill from our side, south-west of it.',
        done: (g) => holds(g, PILGRIMS.x, PILGRIMS.z, 10),
        focus: { build: 'tower_s', spot: () => ({ x: PILGRIMS.x, z: PILGRIMS.z, r: 4 }) },
        satisfy: (g) => { const a = placeNear(g, g.local, 'tower_s', PILGRIMS.x, PILGRIMS.z, 8, true) ?? placeNear(g, g.local, 'tower_s', PILGRIMS.x, PILGRIMS.z, 8)!; garrison(g, g.addBuilding('tower_s', g.local, a.x, a.y, true), { sword: 1, bow: 0 }); recomputeTerritory(g); },
      },
      {
        id: 'towers', text: 'Take the three towers on the hill',
        hint: 'Small groups, spread out: his priests strike where soldiers crowd. Healing Light from a temple of ours helps.',
        done: (g) => [0, 1, 2].every((k) => fortTaken(g, k)),
        progress: (g) => `${[0, 1, 2].filter((k) => fortTaken(g, k)).length}/3`,
        focus: { spot: () => ({ x: TEMPLE.x, z: TEMPLE.z, r: 6 }) },
        satisfy: (g) => { for (const k of [0, 1, 2]) { const b = fortOf(g, k); if (b && b.owner !== g.local) turnCoat(g, b, g.local, { sword: 1, bow: 0 }); } recomputeTerritory(g); },
      },
      {
        id: 'temple', text: 'Hold the Great Temple, standing',
        hint: 'It goes to whoever holds the hill. No catapult near it, and no fire.',
        done: (g) => { const t = templeOf(g); return !!t && t.owner === g.local && t.state !== 'burning'; },
        satisfy: (g) => { recomputeTerritory(g); },
      },
      {
        id: 'wrath', text: 'Call down the Wrath of the Heavens from it', optional: true,
        hint: 'Fifty mana, and his soldiers under the storm.',
        done: (g) => tally(g, 'spell:wrath') > 0,
        satisfy: (g) => { g.emit({ type: 'spell', kind: 'wrath', owner: g.local, x: TEMPLE.x, z: TEMPLE.z }); },
      },
      {
        id: 'camp', text: 'Break Varro’s camp beyond the hill', optional: true,
        hint: 'In the north-east, by the iron and the gold.',
        done: allRivalsDefeated,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'frozen', on: 'frozen', title: 'Frost.', detail: 'The frozen can still be struck. Send the next men in behind, not beside them.' },
      { id: 'turncoat', on: 'turncoat', title: 'The temple has changed hands.', detail: 'With the ground it stands on. Its priests serve us now, if we bring them wine.' },
    ],
    probe: (g) => {
      const t = templeOf(g);
      if (!t || t.owner !== 1 || t.type !== 'greattemple') return 'no great temple of his on the hill';
      if ([0, 1, 2].some((k) => !fortOf(g, k)?.occupied)) return 'a tower on the hill is not manned';
      if (g.ai[0]?.level !== 2) return 'his priests should be sharp (level 2)';
      const w = g.world;
      return w.owner[w.idx(Math.round(t.cx), Math.round(t.cz))] === 1 ? null : 'the temple is not on his land';
    },
  },
);

// ------------------------------------------------------------------ Aestuarium, Insulae, Litus: the sea
/** The player's harbour on the home landmass, standing. */
const homeHarbour = (g: Game) => mine(g).find((b) => b.type === 'harbour' && b.state === 'done' && g.world.region[b.door] === g.ms?.home);
/** The player's harbours across the water, standing (manned or not). */
const colonies = (g: Game) => mine(g).filter((b) => b.type === 'harbour' && b.state === 'done' && g.world.region[b.door] !== g.ms?.home);
/** How many landmasses beyond the home one have a manned colony of ours. */
const colonyLands = (g: Game) => new Set(colonies(g).filter((b) => b.occupied).map((b) => g.world.region[b.door])).size;
/** Cargoes ships of ours have unloaded at the colonies standing. */
const cargoes = (g: Game) => colonies(g).reduce((n, b) => n + tally(g, `unloaded:${b.id}`), 0);
/** A manned colony harbour of ours on an island (or across the water), as an expedition would have founded it. */
function colonyOn(g: Game, isle: { x: number; y: number; r: number }): Building | null {
  const spot = colonySpot(g, isle);
  if (!spot) return null;
  const b = g.addBuilding('harbour', g.local, spot.x, spot.y, true);
  garrison(g, b, { sword: 1, bow: 0 });
  recomputeTerritory(g);
  g.emit({ type: 'landed', b: b.id, x: b.cx, z: b.cz, owner: g.local });
  return b;
}
/** Named fleets: how many have sailed, and how many of their ships are still afloat. */
function fleetsLeft(g: Game, names: readonly string[]) {
  let sent = 0, afloat = 0;
  for (const n of names) { const f = fleetLeft(g, n); if (f.sent) sent++; afloat += f.afloat; }
  return { sent, afloat };
}
const fleetsSunk = (g: Game, names: readonly string[]) => { const f = fleetsLeft(g, names); return f.sent === names.length && f.afloat === 0; };
/** A goal's shortcut: named fleets counted as sailed and sent to the bottom. */
function sinkFleets(g: Game, names: readonly string[]) {
  const ms = g.ms!;
  for (const n of names) {
    if (!ms.fired?.includes(n)) (ms.fired ??= []).push(n);
    for (const id of ms.bands?.[n] ?? []) { const sh = g.ships.get(id); if (sh && afloat(sh)) sinkShip(g, sh, g.local); }
    (ms.bands ??= {})[n] ??= [];
    delete ms.fleets?.[n];
  }
}
/** A fleet's progress line: what has sailed, what is still afloat. */
const fleetsLine = (g: Game, names: readonly string[], before: string) => {
  const f = fleetsLeft(g, names);
  return f.sent ? `${f.sent}/${names.length} have sailed${f.afloat ? ` · ${f.afloat} ${f.afloat === 1 ? 'ship' : 'ships'} afloat` : ''}` : before;
};
const coastal = (g: Game, b: Building | undefined) => !!b && seaNear(g, b.cx, b.cz, 9) >= 0;

// Aestuarium (recipes.ts)
const BAY = { x: 62, z: 78 }, FAR_BANK = { x: 96, y: 76, r: 4 }, MOUTH: [number, number] = [84, 152], POST = { x: 98, z: 138 }, EAST_GOLD = { x: 102, z: 55 };
const FLOTILLAS = ['flotilla1', 'flotilla2', 'flotilla3'] as const;
// Insulae
const ISLES = [{ x: 44, y: 30, r: 10 }, { x: 94, y: 44, r: 12 }, { x: 122, y: 90, r: 13 }, { x: 90, y: 126, r: 12 }];
const VARRO_SEA: [number, number] = [120, 60];
const SQUADRONS = ['squadron', 'aquila'] as const;
// Litus
const PIRATE_SEA: [number, number] = [100, 102];
const nestOf = (g: Game) => fortOf(g, 0);
const nestStands = (g: Game) => { const b = nestOf(g); return !!b && b.owner !== g.local && b.state === 'done'; };
const RAIDS: [number, number, FleetOrder][] = [[900, 1, 'hunt'], [1500, 2, 'shell'], [2100, 2, 'hunt'], [2700, 3, 'shell'], [3300, 3, 'hunt']];

REGIONS.push(
  {
    id: 'aestuarium',
    kicker: 'The Province',
    title: 'Aestuarium',
    subtitle: 'The Estuary',
    briefing: [
      'The estuary runs up from the sea right through the land, a day’s sail, and cuts the province in two: our bank on the west, the east bank on the other side of the water, rich, empty and out of reach of anything that walks. Gold on the hill across from the bay, and more in the north-east.',
      'A harbour in the bay at the head, a shipyard, a ship; then a colony on the far bank, and the ships keep it supplied. What the colony digs, the ships bring back. Every cargo is a round trip across the water.',
      'Varro has farmed the estuary’s dues to the pirates on the islet off its mouth. They will not come for our harbours. They will come for our ships, as soon as they see a cargo land, and they will keep coming.',
    ],
    debrief: 'The estuary is ours from the head to the mouth. The pirates’ flotillas are on the bottom of it, which the fishermen say is good for the fish.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 73, players: 2, aiLevel: 1, islands: false, recipe: 'aestuarium' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'dormant', noPeople: true, name: 'The Pirates', people: 'pirates' }],
      script: [
        { id: 'dues', when: { t: 20 }, do: [{ a: 'say', who: 'varro', title: 'On the dues of the estuary', text: 'The dues of the estuary are farmed to a company of honest seamen. They keep seamen’s hours and seamen’s accounts, and I cannot answer for either. — Q. Varro, governor.' }] },
        { id: 'sails', by: 1, when: { tally: ['launch', 1] }, do: [{ a: 'say', who: 'quaestor', title: 'A hull in the water.', text: 'The pirates at the mouth will have seen it. When they see a cargo land, they come up the estuary. A warship at the harbour and a tower by the dock would give them something to think about.' }] },
        {
          id: 'flotilla1', by: 1, when: { after: 'unloaded', t: 60 },
          do: [{ a: 'say', who: 'quaestor', title: 'A sail at the mouth.', text: 'One ship, low in the water and fast. It will go for whatever of ours is afloat, then back to the islet to wait for the next.' }, { a: 'fleet', n: 1, near: MOUTH, order: 'prey' }],
        },
        {
          id: 'flotilla2', by: 1, when: { after: 'unloaded', t: 540 },
          do: [{ a: 'say', who: 'varro', title: 'A letter from Nova Ostia', text: 'I am told the collectors of the estuary have lost a ship. I have written to them to be more careful.' }, { a: 'fleet', n: 2, near: MOUTH, order: 'prey' }],
        },
        {
          id: 'flotilla3', by: 1, when: { after: 'unloaded', t: 1080 },
          do: [{ a: 'say', who: 'quaestor', title: 'The whole flotilla.', text: 'Three of them, the Lupa in front: everything the islet has left. If these go down, the estuary is ours.' }, { a: 'fleet', n: 3, near: MOUTH, order: 'prey', name: 'Lupa', hp: 160 }],
        },
        { id: 'peace', when: { t: 40, test: (g) => atPeace(g, 1) }, do: [{ a: 'say', who: 'quaestor', title: 'No sails at the mouth.', text: 'Since Litus the pirates keep to their islet, and send their compliments. Our ships may cross as they please.' }] },
        { id: 'clear', by: 1, when: { test: (g) => fleetsSunk(g, FLOTILLAS) }, do: [{ a: 'say', who: 'quaestor', title: 'The estuary is clear.', text: 'Three flotillas on the bottom. The dues of the estuary will be collected by us from now on, and honestly, which will be a novelty for it.' }] },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 2, hq.cz - 6, 10);
      // the pirates' customs post on the east bank's point
      fortAt(g, 'tower_l', 1, POST.x, POST.z, 6, { sword: 2, bow: 2 });
      recomputeTerritory(g);
      knowOre(g, g.local, 35, 43, 8);
      revealAround(g, 35, 43, 8);
      knowOre(g, g.local, EAST_GOLD.x, EAST_GOLD.z, 6);
      // the head of the estuary, the far bank and its gold hill, the post at the mouth
      revealAround(g, 82, 72, 16);
      revealAround(g, EAST_GOLD.x, EAST_GOLD.z, 7);
      revealAround(g, POST.x, POST.z, 7);
    },
    goals: [
      {
        id: 'harbour', text: 'Build a harbour in the bay at the head',
        hint: 'On the shore of the bay east of the headquarters, beside deep water: the markers show where a ship can moor. A shipyard next to it.',
        done: (g) => !!homeHarbour(g),
        focus: { build: 'harbour', spot: () => ({ x: BAY.x, z: BAY.z, r: 4 }) },
        satisfy: (g) => { const hq = hqOf(g); prebuilt(g, 'harbour', hq.cx + 10, hq.cz + 6, 12); },
      },
      {
        id: 'colony', text: 'Found a colony on the far bank',
        hint: 'A ship from the shipyard, then the harbour’s panel: Expedition, and click the far bank’s shore across the water. The party gathers, sails, and builds.',
        done: (g) => colonyLands(g) >= 1,
        focus: { spot: () => ({ x: FAR_BANK.x, z: FAR_BANK.y, r: 5 }) },
        satisfy: (g) => { if (!colonyOn(g, FAR_BANK)) throw new Error('no harbour site on the far bank'); },
      },
      {
        id: 'cargo', text: 'Land nine cargoes at the colony',
        hint: 'Ships keep a colony supplied by themselves: give it building sites and they bring what they need. The harbour’s Shipping section sends what you choose.',
        done: (g) => cargoes(g) >= 9, progress: (g) => `${Math.min(9, cargoes(g))}/9`,
        focus: { building: (g) => colonies(g)[0]?.id ?? 0 },
        satisfy: (g) => {
          const b = colonies(g)[0]!, ms = g.ms!;
          ms.tally[`unloaded:${b.id}`] = 9;
          if (!ms.tally.unloaded) { ms.tally.unloaded = 9; ms.at.unloaded = g.time; }
        },
      },
      {
        id: 'flotillas', text: 'Sink the pirates’ three flotillas',
        hint: 'They sail up from the mouth after cargo, one ship, then two, then three, and go back to the islet between kills. Warships at the harbour, and bring them home to mend.',
        done: (g) => atPeace(g, 1) || fleetsSunk(g, FLOTILLAS),
        progress: (g) => (atPeace(g, 1) ? 'at peace since Litus' : fleetsLine(g, FLOTILLAS, 'they come once a cargo lands')),
        satisfy: (g) => sinkFleets(g, FLOTILLAS),
      },
      {
        id: 'gold', text: 'Smelt 5 bars of gold', optional: true,
        hint: 'The gold is on the hill across from the bay, the coal on our side in the north-west: ships carry the one to the other.',
        done: (g) => me(g).produced.gold >= 5, progress: (g) => `${Math.min(5, me(g).produced.gold)}/5`,
        focus: { build: 'goldmine', spot: () => ({ x: EAST_GOLD.x, z: EAST_GOLD.z, r: 4 }) },
        satisfy: (g) => { me(g).produced.gold = 5; },
      },
      {
        id: 'post', text: 'Take the pirates’ customs post', optional: true,
        hint: 'A watchtower on the far bank’s southern point: soldiers shipped to the colony can march on it, or a warship can shell it from the water.',
        done: (g) => fortTaken(g, 0),
        focus: { spot: () => ({ x: POST.x, z: POST.z, r: 4 }) },
        satisfy: (g) => { const b = fortOf(g, 0); if (b) g.destroyBuilding(b, false); },
      },
      {
        id: 'nest', text: 'Burn the pirates’ nest on the islet', optional: true,
        hint: 'Their headquarters, off the mouth: only warships reach it.',
        done: (g) => !g.players[1]?.alive,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'expedition', on: 'expedition', title: 'An expedition gathers.', detail: 'Five people and a harbour’s worth of boards and stone at the dock; the ship takes them across.' },
      { id: 'unloaded', on: 'unloaded', title: 'A cargo landed.', detail: 'The pirates saw it too.' },
      { id: 'fleet', on: 'fleet', title: 'Pirates.', detail: 'They go for our ships, not our walls. A ship moored under a tower is safer than one crossing; a warship beside it, safer still.' },
      { id: 'sinking', on: 'sinking', title: 'She goes down.', detail: 'Everyone and everything aboard with her. A battered warship mends at its harbour.' },
    ],
    probe: (g) => {
      if (g.players.length !== 2 || g.ai.length !== 0) return 'the pirates should be dormant';
      const w = g.world, hq = hqOf(g);
      const post = fortOf(g, 0);
      if (!post?.occupied) return 'the customs post is not manned';
      if (w.region[post.door] === w.region[hq.door]) return 'the customs post is on our bank';
      if (!placeNear(g, g.local, 'harbour', hq.cx + 10, hq.cz + 6, 12)) return 'no harbour site in the bay';
      const far = colonySpot(g, FAR_BANK);
      if (!far) return 'no colony site on the far bank';
      if (w.region[g.doorOf(BUILDINGS.harbour.size, far.x, far.y)] === w.region[hq.door]) return 'the far bank can be walked to';
      const mouth = seaNear(g, MOUTH[0], MOUTH[1], 8);
      if (mouth < 0 || w.sea[mouth] !== w.sea[far.dock]) return 'the mouth and the head are not one water';
      let gold = 0, coal = 0;
      w.forRadius(EAST_GOLD.x, EAST_GOLD.z, 7, (i) => { if (w.isMountain(i) && w.ore[i] === 3) gold += w.oreAmt[i]; });
      w.forRadius(35, 43, 8, (i) => { if (w.isMountain(i) && w.ore[i] === 1) coal += w.oreAmt[i]; });
      if (gold < 150 || coal < 150) return `gold ${gold} across the water, coal ${coal} at home`;
      return has(g, 'sawmill') ? null : 'the camp is not standing';
    },
  },

  // ---------------------------------------------------------------- Insulae
  {
    id: 'insulae',
    kicker: 'The Province',
    title: 'Insulae',
    subtitle: 'The Islands',
    briefing: [
      'West of the estuary the coast breaks up into islands, a dozen if you count the rocks, four worth a harbour. Varro keeps his fleet at a base on the biggest of them, in the north-east, and calls the rest the Senate’s.',
      'The Senate has never seen them. Put a colony on three and they are the province’s, which is to say ours. His colonists will be putting ashore too, sooner or later; the islands go to whoever lands first.',
      'The pirates have a tower on two of them, on the gold and on the iron, and his warships will shell any harbour of ours they find. Neither can be reached on foot. Both can be reached with a catapult on a deck.',
    ],
    debrief: 'Three islands fly our colours and the pirates’ towers are rubble in the surf. Varro writes that his fleet was “dispersed by weather”. I have checked: it was fine all week.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 79, players: 3, aiLevel: 1, islands: false, recipe: 'insulae' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'builder', level: 1, name: 'Varro’s Fleet' }, { mode: 'dormant', noPeople: true, name: 'The Pirates', people: 'pirates' }],
      script: [
        { id: 'licence', when: { t: 20 }, do: [{ a: 'say', who: 'varro', title: 'On the islands of the province', text: 'The islands of Terra Nova are the Senate’s, and the Senate’s fleet keeps them. Settlers found on them without my licence will be treated as pirates, and so, for that matter, will the pirates. — Q. Varro, governor.' }] },
        { id: 'rival', when: { test: (g) => [...g.buildings.values()].some((b) => b.owner === 1 && b.type === 'harbour' && g.world.region[b.door] !== g.world.region[hqOf(g, 1).door]) }, do: [{ a: 'say', who: 'quaestor', title: 'Varro’s colonists.', text: 'His ships have put settlers ashore on one of the islands. A harbour of his is a stronghold like any other: it can be shelled, and the island settled after.' }] },
        { id: 'landed', when: { tally: ['landed', 1] }, do: [{ a: 'say', who: 'quaestor', title: 'Our first island.', text: 'The flag is up and the harbour is building. Varro will have it reported by the evening and shelled by the morning, if we give him the morning.' }] },
        {
          id: 'squadron', when: { after: 'landed', t: 300 },
          do: [{ a: 'say', who: 'varro', title: 'An unlicensed settlement', text: 'An unlicensed settlement has been reported on the Senate’s islands. The fleet will attend to it.' }, { a: 'fleet', n: 2, near: VARRO_SEA, order: 'shell' }],
        },
        {
          id: 'aquila', when: { tally: ['landed', 2] },
          do: [
            { a: 'say', who: 'varro', title: 'To the legate', text: 'Two islands. You are either very brave or very badly advised. The Aquila will explain the difference.' },
            { a: 'fleet', n: 3, near: VARRO_SEA, order: 'hunt', name: 'Aquila', hp: 180 },
            { a: 'mode', mode: 'ai' },
          ],
        },
        { id: 'towers', when: { test: (g) => fortTaken(g, 0) || fortTaken(g, 1) }, do: [{ a: 'say', who: 'quaestor', title: 'A pirate tower down.', text: 'Shelled from a ship, which the pirates think very unsporting, having done it to everyone else for years.' }] },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx - 7, hq.cz + 1, 10);
      // the pirates' towers on the gold island and the iron island, on the shores that face us
      fortAt(g, 'tower_s', 2, 112, 89, 5, { sword: 1, bow: 1 });
      fortAt(g, 'tower_s', 2, 83, 120, 5, { sword: 1, bow: 1 });
      // Varro's naval base: a harbour and a yard on the island's south-west shore, facing the islands, and
      // arms in store for the men his expeditions take (the island has no ore of its own)
      const v = hqOf(g, 1);
      const base = prebuilt(g, 'harbour', v.cx - 9, v.cz + 9, 10, 1);
      garrison(g, base, { sword: 1, bow: 0 });
      // (the yard waits for his mind to turn to the sea, or it eats every board the island cuts)
      try { prebuilt(g, 'shipyard', base.cx, base.cz, 9, 1).paused = true; } catch { /* the harbour is what matters */ }
      stockUp(g, { sword: 10, bow: 6, iron: 6 }, 1);
      recomputeTerritory(g);
      knowOre(g, g.local, 23, 104, 7);
      revealAround(g, 23, 104, 7);
      for (const I of ISLES) revealAround(g, I.x, I.y, I.r + 3);
      revealAround(g, 130, 36, 8);
    },
    goals: [
      {
        id: 'yard', text: 'Build a harbour and a shipyard',
        hint: 'On the east shore of our island, beside deep water.',
        done: (g) => !!homeHarbour(g) && has(g, 'shipyard'),
        focus: { build: 'harbour' },
        satisfy: (g) => { const hq = hqOf(g); const hb = prebuilt(g, 'harbour', hq.cx + 9, hq.cz, 12); prebuilt(g, 'shipyard', hb.cx, hb.cz, 12); },
      },
      {
        id: 'colonies', text: 'Found colonies on three islands',
        hint: 'The harbour’s panel: Expedition, then click an island’s shore. The nearest, in the north-west, is free; Varro’s colonists will race us for the rest, and the pirates hold part of two.',
        done: (g) => colonyLands(g) >= 3, progress: (g) => `${Math.min(3, colonyLands(g))}/3`,
        focus: { building: (g) => homeHarbour(g)?.id ?? 0 },
        satisfy: (g) => { for (const I of ISLES) if (colonyLands(g) < 3) colonyOn(g, I); if (colonyLands(g) < 3) throw new Error('room for fewer than three colonies'); },
      },
      {
        id: 'towers', text: 'Raze the pirates’ two towers',
        hint: 'On the gold island in the east and the iron island in the south, by the water. A warship shells a tower from beyond its archers’ reach; or ship soldiers to a colony on the same island.',
        done: (g) => fortTaken(g, 0) && fortTaken(g, 1),
        progress: (g) => `${(fortTaken(g, 0) ? 1 : 0) + (fortTaken(g, 1) ? 1 : 0)}/2`,
        focus: { building: (g) => g.ms?.forts[fortTaken(g, 0) ? 1 : 0] ?? 0 },
        satisfy: (g) => { for (const k of [0, 1]) { const b = fortOf(g, k); if (b) g.destroyBuilding(b, false); } },
      },
      {
        id: 'squadrons', text: 'Sink Varro’s squadrons',
        hint: 'One comes to shell our first colony, the Aquila’s after our second. Meet them at sea with warships, and bring the battered home to mend.',
        done: (g) => fleetsSunk(g, SQUADRONS),
        progress: (g) => fleetsLine(g, SQUADRONS, 'they come once we have landed'),
        satisfy: (g) => sinkFleets(g, SQUADRONS),
      },
      {
        id: 'gold', text: 'Smelt 8 bars of gold', optional: true,
        hint: 'The gold is on the east island; coal and iron on ours.',
        done: (g) => me(g).produced.gold >= 8, progress: (g) => `${Math.min(8, me(g).produced.gold)}/8`,
        focus: { build: 'goldmine' },
        satisfy: (g) => { me(g).produced.gold = 8; },
      },
      {
        id: 'base', text: 'Burn Varro’s naval base', optional: true,
        hint: 'His headquarters on the island in the north-east, and every harbour of his.',
        done: (g) => !g.players[1]?.alive,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'expedition', on: 'expedition', title: 'An expedition gathers.', detail: 'Five people and a harbour’s worth of boards and stone at the dock; the ship takes them over.' },
      { id: 'landed', on: 'landed', title: 'Landed.', detail: 'The colony’s harbour holds the shore until its soldier mans it. Ships keep it supplied by themselves.' },
      { id: 'fleet', on: 'fleet', title: 'Varro’s warships.', detail: 'They shell the nearest harbour or tower of ours they can reach. Meet them at sea.' },
      { id: 'sinking', on: 'sinking', title: 'She goes down.', detail: 'Everyone aboard is lost with her. Mend yours at a harbour between fights.' },
    ],
    probe: (g) => {
      if (g.players.length !== 3 || g.ai.length !== 1 || g.ai[0].mode !== 'builder') return 'Varro should be a builder, the pirates dormant';
      if (g.countBuildings(1, 'harbour', false) < 1 || g.countBuildings(1, 'shipyard', false) < 1) return 'Varro’s naval base has no harbour and yard';
      if (g.isles.length !== ISLES.length) return `${g.isles.length} isles known to the game`;
      const w = g.world, hq = hqOf(g);
      for (const k of [0, 1]) { const f = fortOf(g, k); if (!f?.occupied || !coastal(g, f)) return `pirate tower ${k} is not manned by the water`; }
      const home = placeNear(g, g.local, 'harbour', hq.cx + 9, hq.cz, 12);
      if (!home) return 'no harbour site on our shore';
      const sea = w.sea[seaNear(g, hq.cx + 12, hq.cz, 14)];
      for (const I of ISLES.slice(0, 2)) { const c = colonySpot(g, I); if (!c || w.sea[c.dock] !== sea) return `no colony site on the isle at ${I.x},${I.y}`; }
      const v = seaNear(g, VARRO_SEA[0], VARRO_SEA[1], 6);
      if (v < 0 || w.sea[v] !== sea) return 'Varro’s fleet cannot reach us';
      let gold = 0;
      w.forRadius(127, 98, 6, (i) => { if (w.isMountain(i) && w.ore[i] === 3) gold += w.oreAmt[i]; });
      return gold < 120 ? `only ${gold} gold on the east island` : null;
    },
  },

  // ---------------------------------------------------------------- Litus
  {
    id: 'litus',
    kicker: 'The Province',
    title: 'Litus',
    subtitle: 'The Pirate Coast',
    briefing: [
      'The pirates Varro hired live on an island off this coast, in a harbour with towers either side of it and a flagship in front: the Corvus, which we sank once at Classis, or thought we did. This one is twice the size and flies the same rag.',
      'They cannot land and neither can we. So this is a fleet war: a harbour and a shipyard, iron for the fittings, and warships, as many as the yard can launch. They will come across to shell our coast and sink our ships while we build.',
      'Sink the Corvus and burn the harbour she hides in. Pirates without a harbour are fishermen with bad manners.',
    ],
    debrief: 'The Corvus is on the bottom, and this time I watched her go. The pirates’ harbour is ash. Their survivors have asked to join our fleet; I have said we will think about it, which they understand to mean yes.',
    hook: 'Next: the province, one region at a time.',
    map: { size: 160, seed: 83, players: 2, aiLevel: 1, islands: false, recipe: 'litus' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'dormant', noPeople: true, name: 'The Pirates' }],
      script: [
        { id: 'letter', when: { t: 20 }, do: [{ a: 'say', who: 'varro', title: 'On the pirates of the south coast', text: 'I am told there are pirates on the south coast. I have never met them. I have, I confess, paid them, but for one season only, and I cannot be blamed if they have taken a liking to the work.' }] },
        { id: 'corvus', when: { test: (g) => { const sh = g.ships.get(g.ms?.bands?.corvus?.[0] ?? 0); return !!sh && seenAt(g, Math.round(sh.x), Math.round(sh.z)) && g.time > 30; } }, do: [{ a: 'say', who: 'quaestor', title: 'The Corvus.', text: 'Three hundred and sixty of a warship’s hundred and twenty, by the look of her timbers. Do not send one ship. Send four, and bring them home to mend.' }] },
        ...RAIDS.map(([t, n, order], k) => ({
          id: `raid${k + 1}`, when: { t, test: nestStands },
          do: [
            ...(k === 0 ? [{ a: 'say' as const, who: 'quaestor' as const, title: 'Sails from the island.', text: 'A raider, come across to see what we have afloat and what we have built by the water. More will follow while their harbour stands.' }] : []),
            { a: 'fleet' as const, n, near: PIRATE_SEA, order },
          ],
        })),
        { id: 'sunk', when: { test: (g) => fleetLeft(g, 'corvus').afloat === 0 }, do: [{ a: 'say', who: 'quaestor', title: 'The Corvus is on the bottom.', text: 'Where she belongs, and this time I have seen it with my own eyes. So have the pirates.' }] },
        { id: 'burnt', when: { test: (g) => fortTaken(g, 0) }, do: [{ a: 'say', who: 'quaestor', title: 'Their harbour burns.', text: 'No more raiders will come from it. What ships they have left have nowhere to mend.' }] },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx - 7, hq.cz - 2, 10);
      // the pirates' harbour on the island's north shore, a tower either side of it, the yard behind
      const p = hqOf(g, 1);
      const nest = prebuilt(g, 'harbour', p.cx, p.cz - 11, 7, 1);
      garrison(g, nest, { sword: 1, bow: 1 });
      g.ms!.forts.push(nest.id);
      for (const dx of [-9, 9]) { const tw = prebuilt(g, 'tower_s', nest.cx + dx, nest.cz + 1, 5, 1); garrison(g, tw, { sword: 1, bow: 1 }); g.ms!.forts.push(tw.id); }
      try { prebuilt(g, 'shipyard', p.cx + 7, p.cz - 6, 7, 1); } catch { /* the yard is for show */ }
      recomputeTerritory(g);
      // the Corvus off the harbour, and two escorts
      const w = g.world, dx = w.nx(nest.dock), dz = w.ny(nest.dock);
      const corvus = ship(g, { kind: 'war', owner: 1, x: dx, z: dz - 6, r: 10, name: 'Corvus' });
      corvus.hp = corvus.maxHp = 360;
      const escort = [ship(g, { kind: 'war', owner: 1, x: dx - 6, z: dz - 3, r: 10, name: 'Draco' }), ship(g, { kind: 'war', owner: 1, x: dx + 6, z: dz - 3, r: 10, name: 'Ursa' })];
      g.ms!.bands = { corvus: [corvus.id], escort: escort.map((s) => s.id) };
      knowOre(g, g.local, 51, 23, 8);
      revealAround(g, 51, 23, 8);
      revealAround(g, nest.cx, nest.cz, 12);
    },
    goals: [
      {
        id: 'yard', text: 'Build a harbour and a shipyard on our coast',
        hint: 'South of the headquarters, beside deep water.',
        done: (g) => !!homeHarbour(g) && has(g, 'shipyard'),
        focus: { build: 'harbour' },
        satisfy: (g) => { const hq = hqOf(g); const hb = prebuilt(g, 'harbour', hq.cx, hq.cz + 10, 12); prebuilt(g, 'shipyard', hb.cx, hb.cz, 12); },
      },
      {
        id: 'navy', text: 'Launch four warships',
        hint: 'The shipyard’s switch: Warship. Twelve boards and three iron fittings each; the iron comes from the north-west.',
        done: (g) => tally(g, 'warship') >= 4, progress: (g) => `${Math.min(4, tally(g, 'warship'))}/4`,
        focus: { tool: 'warships', building: (g) => mine(g).find((b) => b.type === 'shipyard')?.id ?? 0 },
        satisfy: (g) => { const y = mine(g).find((b) => b.type === 'shipyard')!; for (let k = tally(g, 'warship'); k < 4; k++) launchShip(g, g.local, y, 'war'); },
      },
      {
        id: 'corvus', text: 'Sink the Corvus',
        hint: 'Off the pirates’ harbour, with two escorts. Three times a warship’s timbers: go in together.',
        done: (g) => fleetLeft(g, 'corvus').afloat === 0,
        focus: { spot: (g) => { const sh = g.ships.get(g.ms?.bands?.corvus?.[0] ?? 0); return sh ? { x: sh.x, z: sh.z, r: 4 } : null; } },
        satisfy: (g) => { const sh = g.ships.get(g.ms!.bands!.corvus[0]); if (sh && afloat(sh)) sinkShip(g, sh, g.local); },
      },
      {
        id: 'nest', text: 'Burn the harbour she hides in',
        hint: 'The pirates’ harbour on the island’s north shore. Its towers’ archers reach a ship close in; a warship shells from further out where it can.',
        done: (g) => fortTaken(g, 0),
        focus: { building: (g) => g.ms?.forts[0] ?? 0 },
        satisfy: (g) => { const b = nestOf(g); if (b) g.destroyBuilding(b, false); },
      },
      {
        id: 'towers', text: 'Silence the towers either side of it', optional: true,
        hint: 'Two guard towers on the shore, bowmen in them.',
        done: (g) => fortTaken(g, 1) && fortTaken(g, 2),
        satisfy: (g) => { for (const k of [1, 2]) { const b = fortOf(g, k); if (b) g.destroyBuilding(b, false); } },
      },
      {
        id: 'raiders', text: 'Send eight pirate ships to the bottom', optional: true,
        hint: 'The Corvus, her escorts, and the raiders that come across while their harbour stands.',
        done: (g) => tally(g, 'sunk:1') >= 8, progress: (g) => `${Math.min(8, tally(g, 'sunk:1'))}/8`,
        satisfy: (g) => { g.ms!.tally['sunk:1'] = 8; },
      },
      {
        id: 'isle', text: 'Break the pirates for good', optional: true,
        hint: 'Their headquarters on the island, behind the harbour.',
        done: (g) => !g.players[1]?.alive,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'warship', on: 'warship', title: 'A warship.', detail: 'Right-click a ship to hunt it, a stronghold by the water to shell it. Several together finish a fight before it finishes them.' },
      { id: 'fleet', on: 'fleet', title: 'Raiders.', detail: 'Across from the island for our ships and our coast. A warship at the harbour meets them; the harbour mends it after.' },
      { id: 'sinking', on: 'sinking', title: 'She goes down.', detail: 'Everyone aboard is lost with her.' },
    ],
    probe: (g) => {
      if (g.players.length !== 2 || g.ai.length !== 0) return 'the pirates should be dormant';
      const w = g.world, hq = hqOf(g);
      const nest = nestOf(g);
      if (!nest?.occupied || nest.type !== 'harbour' || nest.dock < 0) return 'the pirates’ harbour is not manned';
      for (const k of [1, 2]) { const f = fortOf(g, k); if (!f?.occupied || !coastal(g, f)) return `shore tower ${k} is not manned by the water`; }
      const corvus = g.ships.get(g.ms!.bands!.corvus[0]);
      if (!corvus || corvus.maxHp !== 360 || corvus.name !== 'Corvus') return 'the Corvus is not at sea';
      if (!placeNear(g, g.local, 'harbour', hq.cx, hq.cz + 10, 12)) return 'no harbour site on our coast';
      const home = seaNear(g, hq.cx, hq.cz + 14, 12);
      if (home < 0 || w.sea[home] !== w.sea[nest.dock]) return 'our coast and theirs are not one sea';
      let iron = 0;
      w.forRadius(51, 23, 8, (i) => { if (w.isMountain(i) && w.ore[i] === 2) iron += w.oreAmt[i]; });
      return iron < 150 ? `only ${iron} iron in the north-west` : null;
    },
  },
);

// ------------------------------------------------------------------ Castellum, Nova Ostia: the siege and the finale
/** Varro's headquarters gone (his hall, his seat): he fights on from his towers, but the place is ours. */
const hallFallen = (g: Game) => !!g.players[1] && (g.players[1].fallen || !g.players[1].alive);
/** The player's stronghold nearest a spot, for a sortie. */
const ourNearest = (g: Game, x: number, z: number) => {
  let best: Building | undefined, bd = Infinity;
  for (const b of mine(g)) { if (!b.def.military || b.state !== 'done') continue; const d = sq(b.cx - x) + sq(b.cz - z); if (d < bd) { bd = d; best = b; } }
  return best;
};
// Castellum (recipes.ts): the castles at the western ramp's foot, on the north and south flanks, at the eastern ramp's foot
const CASTLES = [{ x: 76, z: 80 }, { x: 92, z: 50 }, { x: 92, z: 110 }, { x: 148, z: 80 }];
const hallStands = (g: Game) => !hallFallen(g);

/** A town of a rival's on free land round a spot: a castle to hold it, a storehouse, homes and a start of an economy (a client colony). */
function rivalTown(g: Game, owner: number, x: number, z: number) {
  const c = fortAt(g, 'castle', owner, x, z, 8, { sword: 5, bow: 3 });
  recomputeTerritory(g);
  const at = (t: Parameters<typeof prebuilt>[1], dx: number, dz: number, r = 8) => { try { return prebuilt(g, t, c.cx + dx, c.cz + dz, r, owner); } catch { return null; } };
  at('storehouse', 0, 7);
  for (const [dx, dz] of [[-7, 2], [7, 2]]) { const r = at('residence_s', dx, dz); if (r) fillResidence(g, r); }
  at('woodcutter', -9, -6, 10);
  at('farm', 9, -7, 10);
  at('tower_l', 0, 14, 8);
  const t = [...g.buildings.values()].filter((b) => b.owner === owner && b.type === 'tower_l' && hypot(b.cx - c.cx, b.cz - c.cz) < 18 && !b.occupied);
  for (const b of t) garrison(g, b, { sword: 2, bow: 2 });
  recomputeTerritory(g);
  return c;
}
// Nova Ostia: the castles at the passes, the colonies, the Senate's clock
const PASSES = [{ x: 154, z: 76 }, { x: 154, z: 132 }];
const COLONIES = [{ x: 104, z: 38 }, { x: 104, z: 170 }];
/** Varro's strongholds that still stand round a colony. */
const colonyLeft = (g: Game, k: number) => strongholdsOf(g, 1).filter((b) => sq(b.cx - COLONIES[k].x) + sq(b.cz - COLONIES[k].z) <= sq(30)).length;
/** When the Senate's ship docks at Nova Ostia: two hours and ten minutes on Easy, an hour and forty as written, an hour and twenty on Hard. */
const senateDocks = (g: Game) => [130, 100, 80][g.opts.difficulty ?? 1] * 60;
const minutesTo = (g: Game, t: number) => Math.max(0, Math.ceil((t - g.time) / 60));

REGIONS.push(
  {
    id: 'castellum',
    kicker: 'The Province',
    title: 'Castellum',
    subtitle: 'The Fortress',
    briefing: [
      'Between the valley and Nova Ostia stands Castellum: a hill with cliffs round it and Varro’s hall on top, and four castles round its foot, one at each way up and one on each flank. Every road to his capital goes past them.',
      'Castles do not yield and cannot be rushed. Ten men in each, archers on the walls, and they come out to meet whatever comes near. Catapults take them from beyond the archers’ reach: a siege workshop, iron for the engines, and swordsmen to stand in front of them.',
      'His priests are on the hill. They will freeze a storming party at the gate and call lightning on a crowd. Spread out, and bring a temple of our own.',
    ],
    debrief: 'Castellum has fallen: four castles and the hall on the hill. Varro has written to the Senate that it was never meant to be held. I have written that it was held, for a while, by him.',
    hook: 'Next: Nova Ostia, when the province is ready.',
    map: { size: 160, seed: 89, players: 2, aiLevel: 2, islands: false, recipe: 'castellum' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'builder', level: 2, name: 'Varro’s Garrison' }],
      noYield: true,
      script: [
        { id: 'letter', when: { t: 20 }, do: [{ a: 'say', who: 'varro', title: 'From the hall at Castellum', text: 'Castellum has never been taken. It was built by men who expected you, and it is held by men who have been told about you.' }] },
        ...CASTLES.map((c, k) => ({
          id: `frost${k}`, when: { test: (g: Game) => !fortTaken(g, k) && !!ourMenNear(g, c.x, c.z, 10, 4) },
          do: [{ a: 'cast' as const, spell: 'freeze' as const, at: (g: Game) => ourMenNear(g, c.x, c.z, 10, 4) }],
        })),
        {
          id: 'wrath', when: { test: (g) => CASTLES.some((c, k) => !fortTaken(g, k) && !!ourMenNear(g, c.x, c.z, 9, 7)) },
          do: [
            { a: 'cast', spell: 'wrath', at: (g) => { for (const [k, c] of CASTLES.entries()) { const at = !fortTaken(g, k) && ourMenNear(g, c.x, c.z, 9, 7); if (at) return at; } return null; } },
            { a: 'say', who: 'quaestor', title: 'Lightning.', text: 'His priests saw a crowd and asked the sky about it. Fewer men at a time, and from more sides.' },
          ],
        },
        ...[1200, 2400, 3600].map((t, j) => ({
          id: `garrison${j + 1}`, when: { t, test: hallStands },
          do: CASTLES.map((_, k) => ({ a: 'reinforce' as const, fort: k, men: { sword: 2, bow: 1, level: 1 } })),
        })),
        ...[1500, 2700].map((t, j) => ({
          id: `sortie${j + 1}`, when: { t, test: hallStands },
          do: [
            ...(j === 0 ? [{ a: 'say' as const, who: 'quaestor' as const, title: 'A sortie.', text: 'The castles are sending men out against our nearest tower. They will go back in if they can; do not let them.' }] : []),
            { a: 'attack' as const, men: 6, target: (g: Game) => ourNearest(g, CASTLES[0].x, CASTLES[0].z) },
          ],
        })),
        {
          id: 'breach', when: { test: (g) => CASTLES.some((_, k) => fortTaken(g, k)) },
          do: [
            { a: 'say', who: 'varro', title: 'On the matter of one castle', text: 'You have one castle. I have three, and the hill, and the Senate. My garrison has been told to stop waiting for you.' },
            { a: 'mode', mode: 'ai' },
          ],
        },
        { id: 'hall', when: { test: hallFallen }, do: [{ a: 'say', who: 'quaestor', title: 'The hall on the hill is burning.', text: 'Varro was not in it. He left for Nova Ostia a day ago, which I take to mean he knew before we did.' }] },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz + 2, 10);
      // the ring
      for (const c of CASTLES) fortAt(g, 'castle', 1, c.x, c.z, 6, { sword: 6, bow: 3 });
      recomputeTerritory(g);
      // the hall's priests and their wine
      const v = hqOf(g, 1);
      prebuilt(g, 'greattemple', v.cx + 6, v.cz - 7, 9, 1);
      prebuilt(g, 'vineyard', v.cx - 7, v.cz + 7, 9, 1);
      g.players[1].mana = 80;
      stockUp(g, { sword: 8, bow: 4 }, 1);
      knowOre(g, g.local, 19, 108, 8);
      revealAround(g, 19, 108, 8);
      for (const c of CASTLES) revealAround(g, c.x, c.z, 7);
      revealAround(g, v.cx, v.cz, 6);
    },
    goals: [
      {
        id: 'engines', text: 'Roll out three catapults',
        hint: 'A siege workshop: six boards and four iron a catapult. Iron from the south-west mountain.',
        done: (g) => tally(g, 'machine') >= 3, progress: (g) => `${Math.min(3, tally(g, 'machine'))}/3`,
        focus: { build: 'siegeworks' },
        satisfy: (g) => { g.ms!.tally.machine = 3; },
      },
      {
        id: 'breach', text: 'Bring down a castle',
        hint: 'The western one first, at the foot of the ramp. Catapults from beyond its archers, swordsmen in front of them standing firm.',
        done: (g) => CASTLES.some((_, k) => fortTaken(g, k)),
        focus: { building: (g) => g.ms?.forts[0] ?? 0 },
        satisfy: (g) => { const b = fortOf(g, 0); if (b) g.destroyBuilding(b, false); },
      },
      {
        id: 'ring', text: 'Break the ring: all four castles',
        hint: 'North, south and the one at the eastern ramp beyond the hill.',
        done: (g) => CASTLES.every((_, k) => fortTaken(g, k)),
        progress: (g) => `${CASTLES.filter((_, k) => fortTaken(g, k)).length}/4`,
        focus: { building: (g) => g.ms?.forts[CASTLES.findIndex((_, k) => !fortTaken(g, k))] ?? 0 },
        satisfy: (g) => { for (const k of CASTLES.keys()) { const b = fortOf(g, k); if (b) g.destroyBuilding(b, false); } },
      },
      {
        id: 'hall', text: 'Take the hall on the hill',
        hint: 'Varro’s headquarters, up either ramp. His priests’ temple is beside it.',
        done: hallFallen,
        focus: { spot: (g) => ({ x: hqOf(g, 1).cx, z: hqOf(g, 1).cz, r: 5 }) },
        satisfy: (g) => { g.destroyBuilding(hqOf(g, 1), false); },
      },
      {
        id: 'wrath', text: 'Answer his priests with the Wrath of the Heavens', optional: true,
        hint: 'A great temple of our own and fifty mana; his garrison under the storm.',
        done: (g) => tally(g, 'spell:wrath') > 0,
        satisfy: (g) => { g.emit({ type: 'spell', kind: 'wrath', owner: g.local, x: CASTLES[0].x, z: CASTLES[0].z }); },
      },
      {
        id: 'standing', text: 'Take a castle standing', optional: true,
        hint: 'Kill its garrison with stones and send men through the gate before the walls come down.',
        done: (g) => CASTLES.some((_, k) => tally(g, `captured:${g.ms?.forts[k]}`) > 0),
        satisfy: (g) => { g.ms!.tally[`captured:${g.ms!.forts[1]}`] = 1; },
      },
    ],
    tips: [
      { id: 'machine', on: 'machine', title: 'A catapult.', detail: 'Select it and right-click a castle. It cannot fight: swordsmen in front of it, told to stand firm.' },
      { id: 'frozen', on: 'frozen', title: 'Frost.', detail: 'His priests. The frozen can still be struck; the next men in behind, not beside them.' },
      { id: 'razed', on: 'razed', title: 'Walls down.', detail: 'A castle that falls gives its land back, and the next one is closer.' },
    ],
    probe: (g) => {
      if (g.ai.length !== 1 || g.ai[0].mode !== 'builder' || g.ai[0].level !== 2) return 'the garrison should be a sharp builder';
      if (g.ms?.forts.length !== 4 || !g.ms.forts.every((id) => { const b = g.buildings.get(id); return b?.type === 'castle' && b.occupied; })) return 'four castles should stand manned';
      if (g.countBuildings(1, 'greattemple', false) < 1) return 'no temple on the hill';
      const w = g.world, a = hqOf(g), b = hqOf(g, 1);
      const path = g.path.find(a.door, b.door, true, 400000);
      if (!path) return 'no way up the hill';
      // shut both ramps and the hall is out of reach
      const onRamp = (i: number) => { const x = w.nx(i), z = w.ny(i); return Math.abs(z - 80) < 6 && ((x > 80 && x < 98) || (x > 126 && x < 144)); };
      if (g.path.find(a.door, b.door, true, 400000, (i) => w.walkable(i) && !onRamp(i))) return 'the cliffs leave another way up';
      let iron = 0, coal = 0;
      w.forRadius(19, 108, 9, (i) => { if (w.isMountain(i)) { if (w.ore[i] === 2) iron += w.oreAmt[i]; if (w.ore[i] === 1) coal += w.oreAmt[i]; } });
      return iron < 150 || coal < 150 ? `coal ${coal}, iron ${iron} in the south-west` : null;
    },
  },

  // ---------------------------------------------------------------- Nova Ostia
  {
    id: 'novaostia',
    kicker: 'The Province',
    title: 'Nova Ostia',
    subtitle: 'The Governor’s Seat',
    briefing: [
      'Nova Ostia: Varro’s capital on the east coast, behind a wall of mountains with two passes through it and a castle at the far end of each, his fleet in the bay, and his two client colonies on our flanks, north and south, who hold their charters from him.',
      'Everything we have comes with us: the column, the wagons, every region’s gift. He has the Senate’s money, a sharp garrison and ten minutes of truce while his heralds ride; after that he marches, and he does not stop.',
      'And the Senate has sent a ship with its verdict on the two of us. Whoever holds Nova Ostia when it docks is the governor it will find. Take his headquarters before it does.',
    ],
    debrief: 'Nova Ostia has opened its gates. The Senate’s ship came in on the same tide, and the verdict it carried named the governor of Terra Nova. The name has been changed. The ink is still wet.',
    hook: 'The province is yours.',
    map: { size: 208, seed: 97, players: 2, aiLevel: 2, islands: false, recipe: 'novaostia' },
    open: true,
    unlocks: [],
    rules: {
      rivals: [{ mode: 'ai', level: 2, name: 'Quintus Varro' }],
      truce: 600,
      noYield: true,
      fail: (g) => (g.time >= senateDocks(g) && !hallFallen(g) ? 'The Senate’s ship docked at Nova Ostia with Varro still in his hall. He read its verdict aloud from the steps, and it named him.' : null),
      script: [
        { id: 'letter', when: { t: 20 }, do: [{ a: 'say', who: 'varro', title: 'From the governor’s seat', text: 'You have come a long way to be recalled. The Senate’s ship is on the sea; I have asked it to take you home.' }] },
        { id: 'truce', when: { t: 600 }, do: [{ a: 'say', who: 'varro', title: 'The heralds are back', text: 'My colonies have their orders, and so have my legions. Let us see which of us the Senate finds standing.' }] },
        {
          id: 'sighted', when: { test: (g) => g.time >= senateDocks(g) - 30 * 60 && !hallFallen(g) },
          do: [{ a: 'say', who: 'quaestor', title: 'A sail on the horizon.', text: 'The Senate’s, low and slow and heavy with seals. Half an hour to Nova Ostia, by the look of the wind.' }],
        },
        {
          id: 'close', when: { test: (g) => g.time >= senateDocks(g) - 10 * 60 && !hallFallen(g) },
          do: [{ a: 'say', who: 'quaestor', title: 'Ten minutes.', text: 'The Senate’s ship has rounded the point. If his hall is standing when it ties up, the verdict is his to read.' }],
        },
        ...[1500, 2400, 3300].map((t, j) => ({
          id: `squadron${j + 1}`, when: { t, test: (g: Game) => g.countBuildings(1, 'harbour', false) > 0 && !hallFallen(g) },
          do: [{ a: 'fleet' as const, n: j < 2 ? 2 : 3, near: [196, 104] as [number, number], order: 'shell' as const }],
        })),
        ...COLONIES.map((_, k) => ({
          id: `colony${k}`, when: { test: (g: Game) => colonyLeft(g, k) === 0 },
          do: [{ a: 'say' as const, who: 'varro' as const, title: 'A charter withdrawn', text: k === 0 ? 'The northern colony has lost its charter, and its colonists their homes. I shall find the Senate other colonists.' : 'The southern colony too. You are very thorough, legate. So is the Senate.' }],
        })),
        { id: 'gates', when: { test: hallFallen }, do: [{ a: 'say', who: 'quaestor', title: 'The gates are open.', text: 'His hall is burning and his seal is in my hand. Whatever towers he still holds, Nova Ostia is ours when the Senate’s ship ties up.' }] },
      ],
    },
    setup: (g) => {
      const t = nearestTrees(g), r = nearestRock(g), hq = hqOf(g);
      if (t) prebuilt(g, 'woodcutter', t.x, t.z, 10);
      if (r) prebuilt(g, 'stonecutter', r.x, r.z, 10);
      prebuilt(g, 'sawmill', hq.cx + 6, hq.cz + 2, 10);
      // Varro's castles at the passes, his client colonies on our flanks
      for (const p of PASSES) fortAt(g, 'castle', 1, p.x, p.z, 7, { sword: 6, bow: 3 });
      recomputeTerritory(g);
      for (const c of COLONIES) rivalTown(g, 1, c.x, c.z);
      // his seat: the temple, the harbour on the bay and the fleet in it
      const v = hqOf(g, 1);
      prebuilt(g, 'greattemple', v.cx - 8, v.cz - 6, 9, 1);
      prebuilt(g, 'vineyard', v.cx - 8, v.cz + 7, 9, 1);
      const port = prebuilt(g, 'harbour', v.cx + 10, v.cz, 9, 1);
      garrison(g, port, { sword: 1, bow: 1 });
      try { prebuilt(g, 'shipyard', port.cx, port.cz + 6, 8, 1).paused = true; } catch { /* the harbour is what matters */ }
      const w = g.world, dx = w.nx(port.dock), dz = w.ny(port.dock);
      const fleet = [0, 1, 2].map((k) => ship(g, { kind: 'war', owner: 1, x: dx + 3 + k * 2, z: dz - 3 + k * 3, r: 8, name: ['Neptunus', 'Victoria', 'Concordia'][k] }));
      (g.ms!.bands ??= {}).fleet = fleet.map((s) => s.id);
      g.players[1].mana = 60;
      stockUp(g, { sword: 12, bow: 6, iron: 10, coal: 10, board: 40, stone: 30 }, 1);
      recomputeTerritory(g);
      knowOre(g, g.local, 25, 130, 9);
      revealAround(g, 25, 130, 9);
      for (const p of PASSES) revealAround(g, p.x, p.z, 7);
      for (const c of COLONIES) revealAround(g, c.x, c.z, 9);
      revealAround(g, v.cx, v.cz, 8);
    },
    goals: [
      {
        id: 'pass', text: 'Force a pass: take a castle at the far end',
        hint: 'Two passes through the wall, a castle at the far end of each. Catapults, and swordsmen in front of them.',
        done: (g) => fortTaken(g, 0) || fortTaken(g, 1),
        focus: { building: (g) => g.ms?.forts[0] ?? 0 },
        satisfy: (g) => { const b = fortOf(g, 0); if (b) g.destroyBuilding(b, false); },
      },
      {
        id: 'seat', text: 'Take Nova Ostia before the Senate’s ship docks',
        hint: 'His headquarters by the bay. Once it burns he may fight on from his towers, but the province is ours.',
        done: hallFallen,
        progress: (g) => { const m = minutesTo(g, senateDocks(g)); return g.time >= senateDocks(g) - 30 * 60 ? `the Senate’s ship docks in ${m} min` : `the Senate’s ship is at sea: ${m} min`; },
        focus: { spot: (g) => ({ x: hqOf(g, 1).cx, z: hqOf(g, 1).cz, r: 5 }) },
        satisfy: (g) => { g.destroyBuilding(hqOf(g, 1), false); },
      },
      {
        id: 'north', text: 'Break the northern colony', optional: true,
        hint: 'His castle and towers on our northern flank.',
        done: (g) => colonyLeft(g, 0) === 0,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) if (sq(b.cx - COLONIES[0].x) + sq(b.cz - COLONIES[0].z) <= sq(30)) g.destroyBuilding(b, false); },
      },
      {
        id: 'south', text: 'Break the southern colony', optional: true,
        hint: 'His castle and towers on our southern flank.',
        done: (g) => colonyLeft(g, 1) === 0,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) if (sq(b.cx - COLONIES[1].x) + sq(b.cz - COLONIES[1].z) <= sq(30)) g.destroyBuilding(b, false); },
      },
      {
        id: 'fleet', text: 'Sink the fleet in his bay', optional: true,
        hint: 'Three warships off his harbour, more while it stands.',
        done: (g) => fleetLeft(g, 'fleet').afloat === 0,
        satisfy: (g) => sinkFleets(g, ['fleet']),
      },
      {
        id: 'all', text: 'Leave him nothing', optional: true,
        hint: 'Every stronghold of his, to the last tower.',
        done: allRivalsDefeated,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: [
      { id: 'truce', on: 'truceover', title: 'The truce is over.', detail: 'His legions march now, and his colonies with them. The towers on our flanks first.' },
      { id: 'machine', on: 'machine', title: 'A catapult.', detail: 'For the castles at the passes: from beyond their archers, swordsmen in front.' },
      { id: 'fleet', on: 'fleet', title: 'His squadrons.', detail: 'Out of the bay for our coast. Warships meet them; the harbour mends.' },
    ],
    probe: (g) => {
      if (g.ai.length !== 1 || g.ai[0].level !== 2 || g.ai[0].mode !== 'ai') return 'Varro should be a sharp computer kingdom';
      const f = g.ms!.forts;
      if (f.length !== 4 || !f.every((id) => g.buildings.get(id)?.occupied)) return 'the castles at the passes and the colonies’ should stand manned';
      for (const k of [0, 1]) if (colonyLeft(g, k) < 2) return `colony ${k} has ${colonyLeft(g, k)} strongholds`;
      if (fleetLeft(g, 'fleet').afloat !== 3) return 'his fleet is not in the bay';
      const w = g.world, a = hqOf(g), b = hqOf(g, 1);
      const path = g.path.find(a.door, b.door, true, 600000);
      if (!path) return 'no way on foot to Nova Ostia';
      if (!path.some((n) => { const x = w.nx(n), z = w.ny(n); return Math.abs(x - 141) < 6 && (Math.abs(z - 74) < 8 || Math.abs(z - 134) < 8); })) return 'the road to his seat does not take a pass';
      let iron = 0;
      w.forRadius(25, 130, 9, (i) => { if (w.isMountain(i) && w.ore[i] === 2) iron += w.oreAmt[i]; });
      return iron < 150 ? `only ${iron} iron in the south-west` : null;
    },
  },
);

// ------------------------------------------------------------------ defences: Varro strikes a region we hold
/** Our town as we left it: the economy's spine round the headquarters, homes full, towers manned towards him. */
function raiseTown(g: Game) {
  const hq = hqOf(g), v = hqOf(g, 1);
  const tryBuild = (t: Parameters<typeof prebuilt>[1], x: number, z: number, r = 12) => { try { return prebuilt(g, t, x, z, r); } catch { return null; } };
  const tr = nearestTrees(g), rk = nearestRock(g), wt = nearestWater(g), fi = nearestFish(g);
  if (tr) { tryBuild('woodcutter', tr.x, tr.z, 10); tryBuild('forester', tr.x, tr.z, 12); tryBuild('hunter', tr.x, tr.z, 13); }
  if (rk) tryBuild('stonecutter', rk.x, rk.z, 10);
  tryBuild('sawmill', hq.cx + 6, hq.cz, 10);
  for (const [dx, dz, t] of [[-6, 0, 'residence_s'], [-6, 6, 'residence_s'], [0, 8, 'residence_m']] as const) { const b = tryBuild(t, hq.cx + dx, hq.cz + dz, 11); if (b) fillResidence(g, b); }
  tryBuild('farm', hq.cx - 9, hq.cz - 7, 13);
  tryBuild('mill', hq.cx + 7, hq.cz + 7, 13);
  tryBuild('bakery', hq.cx + 7, hq.cz - 7, 13);
  if (wt) tryBuild('waterworks', wt.x, wt.z, 10);
  if (fi) tryBuild('fisher', fi.x, fi.z, 10);
  tryBuild('weaponsmith', hq.cx - 1, hq.cz - 9, 13);
  tryBuild('barracks', hq.cx - 10, hq.cz + 3, 13);
  // two watchtowers on the side he comes from, manned from the headquarters' reserve
  const d = hypot(v.cx - hq.cx, v.cz - hq.cz) || 1, ux = (v.cx - hq.cx) / d, uz = (v.cz - hq.cz) / d;
  for (const side of [-1, 1]) {
    const x = hq.cx + ux * 12 - uz * side * 6, z = hq.cz + uz * 12 + ux * side * 6;
    const t = tryBuild('tower_l', x, z, 5);
    if (t) garrison(g, t, { sword: 2, bow: 1 });
  }
  addCarriers(g, 8);
  stockUp(g, { board: 40, stone: 30, sword: 6, bow: 4, bread: 20, fish: 10, meat: 6, water: 10 });
  recomputeTerritory(g);
}

/** A sea region's town: the same, with a harbour, a shipyard, a warship at the dock and iron for more. */
function raiseHarbourTown(g: Game) {
  // (the shore first, before the town takes the room)
  const hq = hqOf(g), shore = seaNear(g, hq.cx, hq.cz, 16);
  const sx = shore >= 0 ? g.world.nx(shore) : hq.cx, sz = shore >= 0 ? g.world.ny(shore) : hq.cz;
  const hb = prebuilt(g, 'harbour', (hq.cx + sx) / 2, (hq.cz + sz) / 2, 12);
  try { prebuilt(g, 'shipyard', hb.cx, hb.cz, 12); } catch { /* one yard is enough, and the harbour is what matters */ }
  raiseTown(g);
  const w = g.world;
  ship(g, { kind: 'war', owner: g.local, x: w.nx(hb.dock), z: w.ny(hb.dock), r: 8, own: true });
  stockUp(g, { iron: 12, board: 30 });
}
const NAVAL_WAVES: [number, number, FleetOrder][] = [[240, 2, 'shell'], [540, 2, 'hunt'], [840, 3, 'shell'], [1140, 4, 'hunt']];
const WAVE_NAMES = NAVAL_WAVES.map((_, k) => `wave${k + 1}`);

const defences = new Map<string, Mission>();
/** The defence of a region we hold (`defence.<region>`), made from its conquest's map. */
export function defenceMission(id: string): Mission | undefined {
  const hit = defences.get(id);
  if (hit) return hit;
  const r = id.slice('defence.'.length) as RegionId;
  const info = REGION_INFO[r];
  // (Nova Ostia taken ends the war: there is nothing after it to defend it in)
  if (!info || r === 'novaostia') return undefined;
  const conquest = info.mission ? REGIONS.find((m) => m.id === info.mission) : undefined;
  if (r !== 'castra' && !conquest) return undefined;
  const capital = r === 'castra';
  // (a region that is parted from his by the sea is struck from the sea)
  const recipe = recipeById(capital ? 'castra' : conquest!.map.recipe);
  const naval = recipe?.connect === false;
  const from = (recipe?.starts[1] ?? [0, 0]) as [number, number];
  const m: Mission = {
    id, kicker: 'The Province · Defence', title: info.name, subtitle: capital ? 'The capital' : 'Varro strikes',
    briefing: capital ? [
      'Varro has come for Castra itself: the camp we raised plank by plank, the town it became, and the men who built it. If it falls, the Senate recalls the legate, and I go with him.',
      'Four waves, the scouts say, each heavier than the last. The towers towards him are manned; the barracks can make more. Keep the headquarters standing.',
    ] : naval ? [
      `Varro’s fleet has put out for ${info.name}. Nobody can march on it, so he will not try: four squadrons, the lookouts say, to shell the harbour and the towers by the water until there is nothing left to hold the coast.`,
      'The town stands as we left it, with a warship at the dock and iron in store for more. Meet them at sea; a battered ship mends at the harbour. If the headquarters falls, the region is his again.',
    ] : [
      `Varro’s legion is on the road to ${info.name}. The scouts count them in hundreds, which means in dozens, but good dozens.`,
      'The town stands as we left it. Fill the towers on his side, keep the barracks busy, and do not let them reach the headquarters. If it falls, the region is his again.',
    ],
    debrief: capital ? 'Castra held. The Senate will hear that the governor came to the capital and went home without it.' : `${info.name} held. His legion went home lighter than it came, and fewer.`,
    hook: 'Back to the province.',
    map: { size: 160, seed: conquest?.map.seed ?? 11, players: 2, aiLevel: 1, islands: false, recipe: capital ? 'castra' : conquest!.map.recipe },
    open: true,
    unlocks: [],
    rules: naval ? {
      rivals: [{ mode: 'dormant', noPeople: true, name: 'Varro’s Fleet' }],
      script: [
        { id: 'march', when: { t: 15 }, do: [{ a: 'say', who: 'varro', title: 'A word before the shelling', text: `Give me ${info.name} and your ships may sail home. Make me take it and they will not sail anywhere.` }] },
        ...NAVAL_WAVES.map(([t, n, order], k) => ({ id: WAVE_NAMES[k], when: { t }, do: [{ a: 'fleet' as const, n, near: from, order, ...(k === NAVAL_WAVES.length - 1 ? { name: 'Aquila', hp: 180 } : {}) }] })),
        { id: 'last', when: { t: NAVAL_WAVES[NAVAL_WAVES.length - 1][0] + 4 }, do: [{ a: 'say', who: 'quaestor', title: 'The last of them.', text: 'The Aquila in front, as flagships go. When these are on the bottom, it is over.' }] },
      ],
    } : {
      rivals: [{ mode: 'dormant', name: 'Varro’s Legion' }],
      raids: [
        { t: 240, from: 'rival', men: { sword: 3, bow: 1 }, target: 'nearest-tower' },
        { t: 540, from: 'rival', men: { sword: 4, bow: 2 }, target: 'nearest-tower' },
        { t: 840, from: 'rival', men: { sword: 5, bow: 3 }, target: 'nearest-tower' },
        { t: 1140, from: 'rival', men: { sword: 6, bow: 4, level: 1 }, target: 'nearest-tower' },
      ],
      script: [
        { id: 'march', when: { t: 15 }, do: [{ a: 'say', who: 'varro', title: 'A word before the fighting', text: capital ? 'You may still surrender the capital with honour. After today you will not have the choice, or the capital.' : `Give me ${info.name} and your men may keep their swords. Make me take it and they will not.` }] },
        { id: 'last', when: { tally: ['raid', 4] }, do: [{ a: 'say', who: 'quaestor', title: 'The last of them.', text: 'His veterans, at the back where veterans stand. When these break, it is over.' }] },
      ],
    },
    setup: naval ? raiseHarbourTown : raiseTown,
    goals: naval ? [
      {
        id: 'waves', text: 'Sink the four squadrons of his fleet',
        hint: 'They shell the harbour and the towers by the water, or hunt our ships. Warships from the yard meet them; bring the battered home to mend.',
        done: (g) => fleetsSunk(g, WAVE_NAMES),
        progress: (g) => fleetsLine(g, WAVE_NAMES, 'the first sails in four minutes'),
        satisfy: (g) => sinkFleets(g, WAVE_NAMES),
      },
      {
        id: 'hold', text: 'Keep the harbour standing', optional: true,
        hint: 'A harbour burnt can be built again; one that stands mends ships all through the fight.',
        done: (g) => fleetsSunk(g, WAVE_NAMES) && !!homeHarbour(g),
        satisfy: () => {},
      },
    ] : [
      {
        id: 'waves', text: 'Break the four waves of his legion',
        hint: 'They go for the tower nearest them. Fill it from the headquarters, and call the garrisons out to meet them together.',
        done: raidsBroken,
        progress: (g) => `${Math.min(4, g.ms?.raid ?? 0)}/4 have marched${raidersLeft(g) ? ` · ${raidersLeft(g)} still standing` : ''}`,
        satisfy: (g) => { const ms = g.ms!; ms.raid = 4; for (const id of ms.raiders ?? []) { const s = g.settlers.get(id); if (s) g.removeSettler(s); } },
      },
      {
        id: 'camp', text: 'Burn the camp he marched from', optional: true,
        hint: 'His headquarters on the far side of the map: nothing in it but the men he kept back.',
        done: allRivalsDefeated,
        satisfy: (g) => { for (const b of strongholdsOf(g, 1)) g.destroyBuilding(b, false); },
      },
    ],
    tips: naval ? [{ id: 'wave', on: 'fleet', title: 'A squadron.', detail: 'For our harbour and towers by the water, or our ships. Select the warship and right-click them.' }]
      : [{ id: 'wave', on: 'raid', title: 'A wave.', detail: 'They come for the tower nearest their camp. Select it and Call out its garrison, or send men from the headquarters to stand beside it.' }],
    probe: naval ? (g) => {
      if (!homeHarbour(g)) return 'the harbour is not standing';
      if (![...g.ships.values()].some((sh) => sh.owner === g.local && sh.kind === 'war')) return 'no warship at the dock';
      const w = g.world, v = seaNear(g, from[0], from[1], 20);
      return v >= 0 && w.sea[v] === w.sea[homeHarbour(g)!.dock] ? null : 'his fleet cannot reach our harbour';
    } : (g) => {
      const towers = mine(g).filter((b) => b.type === 'tower_l' && b.occupied).length;
      if (towers < 1) return 'no watchtower manned towards him';
      if (!has(g, 'barracks') && !has(g, 'sawmill')) return 'the town is not standing';
      return g.path.find(hqOf(g).door, hqOf(g, 1).door, true, 200000) ? null : 'his camp cannot reach ours';
    },
  };
  defences.set(id, m);
  return m;
}
