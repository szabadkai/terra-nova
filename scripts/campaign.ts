// Headless check of the campaign (src/game/campaign.ts, src/game/missions.ts): the framework (ids,
// cumulative unlocks, the building gate, a mission's victory apart from free play's), every mission's
// map and goals (each goal driven to done through its `satisfy`, a save round trip half way), and the
// rivals a mission can script (dormant, a forward fort captured, a truce, a raid, a builder, a ship
// sunk, the finale's yield). Free play must be untouched: `scripts/baseline.ts passive 199 1 1` stays
// bit-identical.
// Usage: npx tsx scripts/campaign.ts [missionId]        every mission, or one
//        npx tsx scripts/campaign.ts seeds <id> <from> <to>   which seeds pass the mission's probe
//        npx tsx scripts/campaign.ts time <id> [seed]    how long a level-1 AI takes over the goals (an upper bound on a player)
import { Game, YIELD_FORTS, strongholdsOf } from '../src/game/game';
import { BUILDINGS, type BuildingType } from '../src/game/defs';
import { MISSIONS } from '../src/game/missions';
import { allRivalsDefeated, allowedTypes, fort, garrison, hqOf, missionById, placeNear, ship, tally, unlockedIn, type Mission } from '../src/game/campaign';
import { decodeSave, describe, encodeSave, restore, snapshot } from '../src/game/save';
import { AIController } from '../src/game/ai';
import { orderAttack } from '../src/game/orders';
import { orderShipAttack } from '../src/game/naval';
import type { GameEvent } from '../src/game/types';

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const note = (what: string) => console.log(`     ${what}`);
const events: GameEvent[] = [];
const run = (g: Game, sec: number, dt = 0.25) => { for (let k = 0; k < sec / dt; k++) { g.update(dt); events.push(...g.events); g.events.length = 0; } };
const runUntil = (g: Game, sec: number, ok: () => boolean) => { let t = 0; while (t < sec && !ok()) { run(g, 1); t++; } return ok(); };
const seen = (type: string, owner?: number) => events.some((e) => e.type === type && (owner === undefined || e.owner === owner));
const count = (type: string, owner?: number) => events.filter((e) => e.type === type && (owner === undefined || e.owner === owner)).length;
const clear = () => { events.length = 0; };
const mk = (m: Mission) => new Game({ ...m.map, mission: m.id });
/** A synthetic mission for a check of the framework: registered while the check runs. */
const withMission = (m: Mission, fn: (g: Game, m: Mission) => void | Promise<void>) => { MISSIONS.push(m); try { return fn(mk(m), m); } finally { MISSIONS.splice(MISSIONS.indexOf(m), 1); } };
const buildable = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => BUILDINGS[t].buildable !== false);
const roundTrip = async (g: Game, ui?: Record<string, unknown>) => restore(await decodeSave(await encodeSave(snapshot(g, ui))));

const mode = process.argv[2];

// ------------------------------------------------------------ seeds: which maps fit a mission
if (mode === 'seeds') {
  const m = missionById(process.argv[3] ?? '');
  if (!m) { console.log('no such mission'); process.exit(1); }
  const from = Number(process.argv[4] ?? 1), to = Number(process.argv[5] ?? 40);
  let ok = 0;
  for (let seed = from; seed <= to; seed++) {
    let why: string | null;
    try { const g = new Game({ ...m.map, seed, mission: m.id }); why = m.probe?.(g) ?? null; } catch (e) { why = `setup: ${(e as Error).message}`; }
    console.log(JSON.stringify({ seed, ok: !why, why }));
    if (!why) ok++;
  }
  console.log(`${ok} of ${to - from + 1} seeds fit ${m.id}`);
  process.exit(0);
}

// ------------------------------------------------------------ time: a level-1 AI plays the mission
if (mode === 'time') {
  const m = missionById(process.argv[3] ?? '');
  if (!m) { console.log('no such mission'); process.exit(1); }
  const g = new Game({ ...m.map, seed: Number(process.argv[4] ?? m.map.seed), mission: m.id });
  // the AI as the player: the building gate in placeError holds it to what the mission has granted
  g.ai.push(new AIController(g, g.local, 1));
  const at = new Map<string, number>();
  const limit = 60 * 60;
  while (g.time < limit && !g.ms?.won) {
    g.update(1);
    g.events.length = 0;
    for (const goal of m.goals) if (!at.has(goal.id) && goal.done(g)) at.set(goal.id, g.time);
  }
  for (const goal of m.goals) console.log(`${at.has(goal.id) ? `${(at.get(goal.id)! / 60).toFixed(1).padStart(5)} min` : '   never'}  ${goal.text}${goal.optional ? ' (optional)' : ''}`);
  const stalls = [...g.buildings.values()].filter((b) => b.owner === g.local && b.stall).map((b) => `${b.def.name}: ${b.status}`);
  console.log(g.ms?.won ? `mission won at ${(g.time / 60).toFixed(1)} min` : `not won within ${limit / 60} min; stalls: ${stalls.join('; ') || 'none'}`);
  process.exit(0);
}

// ------------------------------------------------------------ the framework
{
  const ids = new Set(MISSIONS.map((m) => m.id));
  check(ids.size === MISSIONS.length, `${MISSIONS.length} missions with distinct ids`);
  for (const m of MISSIONS) {
    const gids = new Set(m.goals.map((x) => x.id));
    check(gids.size === m.goals.length, `${m.id}: goal ids distinct`);
    const firstOpt = m.goals.findIndex((x) => x.optional);
    check(firstOpt < 0 || m.goals.slice(firstOpt).every((x) => x.optional), `${m.id}: optional goals come last`);
    check(m.goals.every((x) => !!x.satisfy), `${m.id}: every goal has a satisfy() for this check`);
    check(!!m.probe, `${m.id}: has a probe() for its map`);
    check(m.briefing.length > 0 && !!m.debrief && !!m.hook, `${m.id}: briefing, debrief and hook`);
  }
  let prev = 0;
  for (const m of MISSIONS) { const n = allowedTypes(m).size; check(n >= prev, `${m.id}: unlocks grow (${n})`); prev = n; }
  const all = allowedTypes(MISSIONS[MISSIONS.length - 1]);
  const missing = buildable.filter((t) => !all.has(t));
  if (MISSIONS.length >= 15) check(missing.length === 0, `the last mission grants everything${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
  else note(`${MISSIONS.length} of 15 missions so far; still to grant: ${missing.join(', ')}`);
  check(buildable.every((t) => !all.has(t) || !!unlockedIn(t)), 'every granted building names the mission that grants it');
  // free play is untouched
  const free = new Game({ size: 160, seed: 199, players: 2, aiLevel: 1, islands: true });
  check(free.mission === null && free.ms === null, 'free play: no mission, no mission state');
  check(buildable.every((t) => free.canBuildType(0, t)), 'free play: every building allowed');
  run(free, 30);
  check(free.ms === null && !seen('missionwon'), 'free play: nothing of the campaign runs');
  clear();
}

// ------------------------------------------------------------ every mission
const only = mode && mode !== 'all' ? mode : null;
for (const m of MISSIONS) {
  if (only && m.id !== only) continue;
  console.log(`--- ${m.id}: ${m.title} (${m.map.size}, ${m.map.players} players, seed ${m.map.seed})`);
  let g: Game;
  try { g = mk(m); } catch (e) { check(false, `${m.id}: the map builds (${(e as Error).message})`); continue; }
  check(g.mission?.id === m.id && !!g.ms, 'the game knows its mission');
  const why = m.probe?.(g) ?? null;
  check(why === null, `the map fits the goals${why ? `: ${why}` : ''}`);
  const rules = m.rules;
  check(g.ai.length === g.players.filter((p) => p.ai && rules?.rivals?.[p.id - 1]?.mode !== 'dormant').length, 'controllers as the rivals rule says');
  // the gate
  const locked = buildable.find((t) => !allowedTypes(m).has(t));
  const hq = hqOf(g);
  if (locked) {
    check(g.placeError(locked, g.local, hq.x + 6, hq.y) === 'The Senate has not granted this building yet', `${locked} is refused to the player`);
    check(g.placeBuilding(locked, g.local, hq.x + 6, hq.y) === null, 'and cannot be placed');
    if (g.players.length > 1) check(g.placeError(locked, 1, hq.x + 6, hq.y) !== 'The Senate has not granted this building yet', 'a rival is not held to the player\'s grants');
  } else note('everything is granted here');
  for (const t of allowedTypes(m)) check(g.canBuildType(g.local, t), `${t} is allowed`);
  // the game does not end on its own
  clear();
  run(g, 10);
  check(!g.over && !seen('gameover'), `${g.players.length === 1 ? 'a game of one' : 'the game'} runs on: no early end`);
  // the goals, in order (the events from here on: the mission must be won exactly once)
  clear();
  const half = Math.ceil(m.goals.length / 2);
  let copy: Game | null = null;
  for (let k = 0; k < m.goals.length; k++) {
    const goal = m.goals[k];
    if (k === 0) check(!goal.done(g), `"${goal.text}" starts undone`);
    try { goal.satisfy!(g); } catch (e) { check(false, `${goal.id}: satisfy threw (${(e as Error).message})`); }
    run(g, 3);
    check(goal.done(g), `"${goal.text}" is done once satisfied`);
    check(m.goals.slice(0, k + 1).every((x) => x.done(g)), 'the earlier goals stay done');
    if (k + 1 === half) {
      copy = await roundTrip(g, { objective: k + 1 });
      check(copy.mission?.id === m.id, 'a save half way keeps the mission');
      check(JSON.stringify(copy.ms) === JSON.stringify(g.ms), 'and its state');
      if (locked) check(!copy.canBuildType(copy.local, locked), 'and the gate');
      check(copy.ai.every((a, i) => a.mode === g.ai[i].mode && a.attackT === g.ai[i].attackT), 'and the rivals\' minds');
      check(describe(copy).mission === m.id, 'the save\'s summary names the mission');
      const again = await roundTrip(copy);
      check(JSON.stringify(snapshot(again).scalars) === JSON.stringify(snapshot(copy).scalars), 'saving the copy again changes nothing');
      run(copy, 10);
      check(!copy.over, 'the copy runs on');
    }
  }
  run(g, 3);
  check(!!g.ms?.won && count('missionwon') === 1, 'the mission is won once every goal is done, said once');
  run(g, 10);
  check(count('missionwon') === 1 && !seen('gameover'), 'and stays won quietly');
  if (copy) note(`copy at ${copy.time.toFixed(0)} s, ${copy.buildings.size} buildings`);
}

// ------------------------------------------------------------ the rivals a mission can script
if (!only) {
  const base = { size: 128, players: 2, aiLevel: 1, islands: false };
  const goal = { id: 'x', text: 'x', hint: '', done: () => false };
  // 1. a dormant rival stands still
  withMission({ id: 'test.dormant', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal],
    rules: { rivals: [{ mode: 'dormant', noPeople: true, name: 'The Ninth' }] } }, (g) => {
    clear();
    run(g, 20 * 60, 1);
    check(g.ai.length === 0 && g.players[1].name === 'The Ninth', 'dormant rival: no controller, its name given');
    check(g.countBuildings(1) === 1 && g.population(1).soldiers === 7 && g.population(1).total === 7, `dormant rival: only its headquarters and its seven soldiers after 20 min (${g.countBuildings(1)} buildings, ${g.population(1).total} people)`);
    check(!seen('placed', 1) && !seen('attack', 1) && !g.over && g.players[1].alive, 'dormant rival: builds nothing, attacks nobody, the game goes on');
  });
  // 2. a forward fort is captured without the rival falling
  withMission({ id: 'test.fort', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal],
    rules: { rivals: [{ mode: 'dormant', noPeople: true }], reveal: 'strongholds' },
    setup: (g) => { fort(g, { type: 'tower_s', owner: 1, near: { dist: [24, 28], toward: 'rival' }, garrison: { sword: 2, bow: 0 } }); } }, (g) => {
    const w = g.world, hq = hqOf(g);
    const t = g.buildings.get(g.ms!.forts[0])!;
    run(g, 1);
    const d = Math.hypot(t.cx - hq.cx, t.cz - hq.cz);
    check(t.state === 'done' && t.occupied && t.owner === 1 && t.garrison.length === 2, `the fort stands manned ${d.toFixed(1)} from the headquarters`);
    check(w.owner[w.idx(Math.round(t.cx), Math.round(t.cz))] === 1, 'it holds its land');
    const rx = hq.cx + ((t.cx - hq.cx) / d) * 14, rz = hq.cz + ((t.cz - hq.cz) / d) * 14;
    check(w.owner[w.idx(Math.round(rx), Math.round(rz))] === 0, 'the player\'s own ring is whole');
    check(!!w.explored[w.idx(Math.round(t.cx), Math.round(t.cz))], 'it shows through the fog');
    const ids: number[] = [];
    for (let k = 0; k < 8; k++) { const s = g.addSettler(0, 'swordsman', hq.door); g.syncPos(s); ids.push(s.id); }
    clear();
    check(orderAttack(g, 0, ids, t) === 8, 'eight swordsmen march on it');
    check(runUntil(g, 300, () => t.owner === 0), `it is captured (${g.time.toFixed(0)} s)`);
    check(tally(g, 'captured') === 1 && tally(g, `captured:${t.id}`) === 1, 'the tally counts the capture');
    check(!seen('defeated') && !seen('gameover') && g.players[1].alive && !g.players[1].fallen, 'the rival fights on: no defeat, no end');
    check(g.population(1).soldiers === 7, 'its far headquarters sent nobody');
  });
  // 3. a truce holds the computer back, then lets it go
  withMission({ id: 'test.truce', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal],
    rules: { truce: 600 },
    setup: (g) => {
      const f = fort(g, { type: 'tower_l', owner: 1, near: { dist: [26, 30], toward: 'rival' }, garrison: { sword: 6, bow: 0 } });
      const hq = hqOf(g);
      const a = placeNear(g, 0, 'tower_s', hq.cx + (f.cx - hq.cx) * 0.4, hq.cz + (f.cz - hq.cz) * 0.4, 12) ?? placeNear(g, 0, 'tower_s', hq.cx, hq.cz, 14)!;
      garrison(g, g.addBuilding('tower_s', 0, a.x, a.y, true), { sword: 1, bow: 0 });
    } }, (g) => {
    const a = g.ai[0] as unknown as { attackStep(): void };
    run(g, 3);
    clear();
    a.attackStep();
    run(g, 1);
    check(!seen('attack', 1), 'under the truce the computer does not march');
    g.time = 601;
    clear();
    a.attackStep();
    run(g, 1);
    check(seen('attack', 1), 'once it is over, it does');
    check(seen('truceover'), 'the end of the truce is announced');
  });
  // 4. a raid marches on the player's tower and breaks on it; a save mid-march keeps it
  await withMission({ id: 'test.raid', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal],
    rules: { rivals: [{ mode: 'dormant', noPeople: true }], raids: [{ t: 30, from: 'edge', men: { sword: 2, bow: 0, hp: 60 }, target: 'nearest-tower' }] },
    setup: (g) => {
      const hq = hqOf(g), r = hqOf(g, 1);
      const d = Math.hypot(r.cx - hq.cx, r.cz - hq.cz);
      const a = placeNear(g, 0, 'tower_s', hq.cx + ((r.cx - hq.cx) / d) * 11, hq.cz + ((r.cz - hq.cz) / d) * 11, 12) ?? placeNear(g, 0, 'tower_s', hq.cx, hq.cz, 14)!;
      garrison(g, g.addBuilding('tower_s', 0, a.x, a.y, true), { sword: 1, bow: 1 });
    } }, async (g) => {
    const tower = [...g.buildings.values()].find((b) => b.owner === 0 && b.type === 'tower_s')!;
    clear();
    run(g, 32);
    const raiders = [...g.settlers.values()].filter((s) => s.owner === 1 && !s.inside && !s.dead);
    check(seen('raid', 1) && seen('attack', 1), 'the raid is announced and marches');
    check(raiders.length === 2 && raiders.every((s) => s.sstate === 'attack' && s.targetB === tower.id && s.hp === 60), `two raiders of 60 hp march on the tower (${raiders.length})`);
    check(raiders.every((s) => Math.hypot(s.x - tower.cx, s.z - tower.cz) >= 20), 'from well outside the border');
    const copy = await roundTrip(g);
    const cr = [...copy.settlers.values()].filter((s) => s.owner === 1 && !s.inside && !s.dead);
    check(cr.length === 2 && cr.every((s) => s.sstate === 'attack' && s.targetB === tower.id), 'a save mid-march keeps the raiders marching');
    for (const x of [g, copy]) {
      clear();
      run(x, 240, 1);
      const tw = x.buildings.get(tower.id)!;
      const alive = [...x.settlers.values()].filter((s) => s.owner === 1 && !s.inside && !s.dead).length;
      check(alive === 0, `${x === g ? 'the game' : 'the copy'}: the raiders are dead within four minutes (${alive} left)`);
      check(tw.owner === 0 && !x.over && !seen('defeated') && x.ms!.raid === 1, 'the tower holds, the game goes on, the raid is spent');
    }
  });
  // 5. a builder raises its realm and never marches
  withMission({ id: 'test.builder', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal],
    rules: { rivals: [{ mode: 'builder', level: 1 }] } }, (g) => {
    clear();
    run(g, 15 * 60, 1);
    check(g.ai.length === 1 && g.ai[0].mode === 'builder' && g.ai[0].level === 1, 'builder rival: a controller in builder mode at the level asked');
    check(g.countBuildings(1) > 4, `builder rival: raises its realm (${g.countBuildings(1)} buildings in 15 min)`);
    check(!seen('attack', 1) && !g.over, 'builder rival: marches on nobody');
  });
  // 6. a rebel ship is sunk by a warship
  withMission({ id: 'test.ship', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { size: 160, seed: 16, players: 2, aiLevel: 1, islands: true }, unlocks: buildable, goals: [goal],
    rules: { rivals: [{ mode: 'dormant', noPeople: true }] },
    setup: (g) => { const hq = hqOf(g); ship(g, { kind: 'trade', owner: 1, x: hq.cx, z: hq.cz, r: 60 }); } }, (g) => {
    const rebel = g.ships.get(g.ms!.ships[0])!;
    run(g, 5);
    check(g.ships.has(rebel.id) && rebel.state === 'idle', `the rebel ship waits at ${rebel.x.toFixed(0)},${rebel.z.toFixed(0)}`);
    const war = ship(g, { kind: 'war', owner: 0, x: rebel.x + 4, z: rebel.z + 4, r: 10 });
    check(orderShipAttack(g, 0, [war.id], rebel) === 1, 'a warship of the player is sent after it');
    check(runUntil(g, 300, () => tally(g, `sinking:${rebel.id}`) > 0), `it is sunk (${g.time.toFixed(0)} s)`);
    check(g.players[1].alive && !g.over, 'the rival lives on');
  });
  // 7. the finale: a computer rival yields at its last few strongholds, and the mission is won without free play's end
  for (const noYield of [false, true]) {
    withMission({ id: `test.finale${noYield ? '.stubborn' : ''}`, title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [{ id: 'win', text: 'win', hint: '', done: allRivalsDefeated }],
      rules: { rivals: [{ mode: 'ai', level: 1 }], noYield },
      setup: (g) => { for (let k = 0; k < YIELD_FORTS; k++) fort(g, { type: 'tower_s', owner: 1, near: { of: { x: hqOf(g, 1).cx, z: hqOf(g, 1).cz }, dist: [12 + k * 3, 20 + k * 3], toward: k * 2 }, garrison: { sword: 1, bow: 0 } }); } }, (g) => {
      run(g, 3);
      check(strongholdsOf(g, 1).length === 1 + YIELD_FORTS, `the rival holds ${strongholdsOf(g, 1).length} strongholds`);
      g.destroyBuilding(hqOf(g, 1), false);
      clear();
      run(g, 6);
      if (noYield) {
        check(g.players[1].fallen && g.players[1].alive && !seen('missionwon'), 'stubborn: with its headquarters gone it fights on');
        for (const id of g.ms!.forts) { const b = g.buildings.get(id); if (b) g.destroyBuilding(b, false); }
        run(g, 6);
        check(!g.players[1].alive && !!g.ms!.won, 'and falls with its last tower');
      } else {
        check(seen('defeated', 1) && !g.players[1].alive, 'it yields at its last three towers');
        check(!!g.ms!.won && seen('missionwon') && !seen('gameover'), 'the mission is won by its goal, not by free play\'s last man standing');
      }
    });
  }
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
