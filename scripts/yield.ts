// Headless check of the end of a won war: a computer rival whose headquarters falls can hide its
// strongholds no longer (they show through the fog and the player hears where the nearest stands)
// and yields once it is down to its last three, unless it still holds a castle; a human player
// never yields; the fallen state survives a save.
// Usage: npx tsx scripts/yield.ts [seed]
import { Game, YIELD_FORTS, strongholdsOf } from '../src/game/game';
import { BUILDINGS, type BuildingType } from '../src/game/defs';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import type { Building, GameEvent } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

/** A two-player game where the computer rival stands still (its controller stays, so it counts as a computer). */
function setup() {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
  for (const a of g.ai) a.update = () => {};
  return g;
}
const events: GameEvent[] = [];
const run = (g: Game, sec: number) => { for (let k = 0; k < sec * 4; k++) { g.update(0.25); events.push(...g.events); g.events.length = 0; } };

/** A manned stronghold of `owner` on free land about `dist` from `from`, on its landmass. */
function fort(g: Game, owner: number, type: BuildingType, from: Building, dist: number, a0: number): Building {
  const w = g.world, home = w.region[from.door];
  for (let a = a0; a < a0 + Math.PI * 2; a += 0.3) {
    const cx = from.cx + Math.cos(a) * dist, cz = from.cz + Math.sin(a) * dist;
    let t: Building | null = null;
    for (let r = 0; r < 6 && !t; r++) w.forRadius(cx, cz, r, (_i, x, y) => {
      if (t) return;
      const an = g.anchorFor(type, x, y);
      if (g.placeError(type, owner, an.x, an.y, true) !== null) return;
      if (w.region[g.doorOf(BUILDINGS[type].size, an.x, an.y)] !== home) return;
      t = g.addBuilding(type, owner, an.x, an.y, true);
    });
    if (!t) continue;
    const b: Building = t;
    const d = g.addSettler(owner, 'swordsman', b.door);
    d.hidden = true; d.inside = b.id; d.sstate = 'garrison'; d.home = b.id;
    b.garrison.push(d.id);
    b.occupied = true;
    b.desiredSoldiers = 1;
    g.territoryDirty = true;
    return b;
  }
  throw new Error(`no room for a ${type} of player ${owner}`);
}
const seen = (g: Game, b: Building) => !!g.world.explored[g.world.idx(Math.round(b.cx), Math.round(b.cz))];

// 1. the rival's headquarters falls while it still has five towers scattered over the land
{
  const g = setup();
  const foe = g.players[1];
  const fhq = g.buildings.get(foe.hq)!;
  const towers = [0, 1, 2, 3, 4].map((k) => fort(g, 1, 'tower_s', fhq, 16 + k * 3, k * 1.3));
  run(g, 3);
  const hidden = towers.filter((b) => !seen(g, b)).length;
  console.log(`     ${towers.length} rival towers, ${hidden} of them in the fog`);
  check(hidden > 0, 'some of the rival towers start out in the fog');
  g.destroyBuilding(fhq, false);
  events.length = 0;
  run(g, 4);
  check(foe.fallen && foe.alive, `with its headquarters gone and ${strongholdsOf(g, 1).length} towers left the rival fights on`);
  const note = events.find((e) => e.type === 'msg' && /headquarters of/.test(e.text ?? ''));
  check(!!note && note.x !== undefined, `the player hears of it with a place to go (${note?.text})`);
  check(towers.every((b) => seen(g, b)), 'every rival tower now shows through the fog');
  // a save keeps the fallen state
  for (const ai of g.ai) delete (ai as { update?: unknown }).update; // a stub can't go into a save
  const copy = restore(await decodeSave(await encodeSave(snapshot(g))));
  for (const ai of g.ai) ai.update = () => {};
  check(copy.players[1].fallen, 'a save remembers the fallen headquarters');
  // down to four: still standing; down to three: it yields
  g.destroyBuilding(towers[0], false);
  run(g, 4);
  check(foe.alive, `${strongholdsOf(g, 1).length} towers left: still fighting`);
  events.length = 0;
  g.destroyBuilding(towers[1], false);
  run(g, 4);
  const def = events.find((e) => e.type === 'defeated');
  check(!foe.alive && /yields/.test(def?.text ?? ''), `down to ${YIELD_FORTS} it yields (${def?.text})`);
  check(g.over && g.winner === 0, 'and the war is won');
}

// 2. a castle holds out: no yielding while one stands
{
  const g = setup();
  const foe = g.players[1];
  const fhq = g.buildings.get(foe.hq)!;
  const castle = fort(g, 1, 'castle', fhq, 18, 0);
  fort(g, 1, 'tower_s', fhq, 20, 2);
  run(g, 2);
  g.destroyBuilding(fhq, false);
  run(g, 6);
  check(foe.alive && foe.fallen, 'a rival without headquarters but with a castle fights on');
  g.destroyBuilding(castle, false);
  run(g, 4);
  check(!foe.alive, 'once the castle is gone it yields');
}

// 3. the human player never yields
{
  const g = setup();
  const me = g.players[0];
  const hq = g.buildings.get(me.hq)!;
  fort(g, 0, 'tower_s', hq, 14, 0);
  fort(g, 0, 'tower_s', hq, 16, 2.5);
  run(g, 2);
  g.destroyBuilding(hq, false);
  run(g, 10);
  check(me.alive && me.fallen && !g.over, 'the player fights on from two towers without the headquarters');
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
