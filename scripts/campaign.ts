// Headless check of the campaign (src/game/campaign.ts, src/game/missions.ts): the framework (ids,
// cumulative unlocks, the building gate, a mission's victory apart from free play's), every mission's
// map and goals (each goal driven to done through its `satisfy`, a save round trip half way), and the
// rivals a mission can script (dormant, a forward fort captured, a truce, a raid, a builder, a ship
// sunk, the finale's yield). Free play must be untouched: `scripts/baseline.ts passive 199 1 1` stays
// bit-identical.
// Usage: npx tsx scripts/campaign.ts [missionId]        every mission, or one
//        npx tsx scripts/campaign.ts seeds <id> <from> <to>   which seeds pass the mission's probe
//        npx tsx scripts/campaign.ts time <id> [seed]    how long a level-1 AI takes over the goals (an upper bound on a player)
// A mission id may be one of the campaign's regions (src/game/regions.ts) as well as the tutorial's.
import { Game, YIELD_FORTS, strongholdsOf } from '../src/game/game';
import { BUILDINGS, type BuildingType } from '../src/game/defs';
import { MISSIONS } from '../src/game/missions';
import { REGIONS } from '../src/game/regions';
import { recomputeTerritory, turnCoat } from '../src/game/military';
import { REGION_IDS, REGION_INFO, TO_THE_FINALE, frontier, strikeWeight, newProvince, regionWon, startOf, strikeHeld, strikeLost, varrosTurn, type ProvinceState, type RegionId } from '../src/game/province';
import { COLUMN_MEN, TOP_LEVEL, allRivalsDefeated, allowedTypes, applyCarry, bandLeft, colonySpot, columnOf, fleetLeft, fort, garrison, hqOf, missionById, placeNear, ship, tally, unlockedIn, type Mission } from '../src/game/campaign';
import { placeShipOrder } from '../src/game/sea';
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
const withMission = async (m: Mission, fn: (g: Game, m: Mission) => void | Promise<void>) => { MISSIONS.push(m); try { return await fn(mk(m), m); } finally { MISSIONS.splice(MISSIONS.indexOf(m), 1); } };
const buildable = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => BUILDINGS[t].buildable !== false);
const roundTrip = async (g: Game, ui?: Record<string, unknown>) => restore(await decodeSave(await encodeSave(snapshot(g, ui))));

const mode = process.argv[2];
const regionOf = (id: string) => (Object.keys(REGION_INFO) as RegionId[]).find((r) => REGION_INFO[r].mission === id || `defence.${r}` === id);

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
  // `late`: the start a player would have late in a campaign (every other region held, a column of twelve veterans of the second rank)
  const late = process.argv.includes('late');
  const seedArg = process.argv[4] && process.argv[4] !== 'late' ? Number(process.argv[4]) : m.map.seed;
  const lateRun: ProvinceState = { ...newProvince(1, 1), held: REGION_IDS.filter((r) => r !== regionOf(m.id)), column: { veterans: Array.from({ length: COLUMN_MEN }, (_, k) => ({ job: k < 8 ? 'swordsman' : 'bowman', level: 2 })), goods: { board: 30, stone: 30, iron: 12, coal: 12, sword: 6, bow: 4, bread: 10 } } };
  const g = new Game({ ...m.map, seed: seedArg, mission: m.id, ...(late ? { carry: startOf(lateRun), difficulty: 1 as const } : {}) });
  // the AI as the player: the building gate in placeError holds it to what the mission has granted
  g.ai.push(new AIController(g, g.local, 1));
  const at = new Map<string, number>();
  const limit = 60 * 60;
  let fell = 0;
  while (g.time < limit && !g.ms?.won && !g.ms?.lost && g.players[g.local].alive) {
    g.update(1);
    g.events.length = 0;
    for (const goal of m.goals) if (!at.has(goal.id) && goal.done(g)) at.set(goal.id, g.time);
    if (!fell && g.players[g.local].fallen) fell = g.time;
  }
  if (late) note('with a late campaign\'s start: every other region\'s boon and a column of twelve veterans');
  if (fell) note(`the player's headquarters fell at ${(fell / 60).toFixed(1)} min`);
  for (const goal of m.goals) console.log(`${at.has(goal.id) ? `${(at.get(goal.id)! / 60).toFixed(1).padStart(5)} min` : '   never'}  ${goal.text}${goal.optional ? ' (optional)' : ''}`);
  const stalls = [...g.buildings.values()].filter((b) => b.owner === g.local && b.stall).map((b) => `${b.def.name}: ${b.status}`);
  console.log(g.ms?.won ? `mission won at ${(g.time / 60).toFixed(1)} min` : g.ms?.lost ? `mission lost at ${(g.time / 60).toFixed(1)} min: ${g.ms.lost}` : `not won within ${limit / 60} min; stalls: ${stalls.join('; ') || 'none'}`);
  // who is standing: the floor for "not impossible" is a player still there at the end
  console.log(g.players.map((p) => `${p.name}: ${!p.alive ? 'defeated' : p.fallen ? 'headquarters lost' : 'standing'}, ${strongholdsOf(g, p.id).length} strongholds, ${g.population(p.id).soldiers} soldiers`).join(' · '));
  process.exit(0);
}

// ------------------------------------------------------------ the framework
{
  const ids = new Set(MISSIONS.map((m) => m.id));
  check(ids.size === MISSIONS.length, `${MISSIONS.length} missions with distinct ids`);
  const clash = REGIONS.filter((r) => ids.has(r.id) || REGIONS.filter((x) => x.id === r.id).length > 1);
  check(!clash.length, `${REGIONS.length} regions, none sharing an id with a lesson or another region${clash.length ? ` (${clash.map((r) => r.id).join(', ')})` : ''}`);
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

// ------------------------------------------------------------ every mission (the tutorial's and the campaign's regions)
const only = mode && mode !== 'all' ? mode : null;
const DEFENDED = (Object.keys(REGION_INFO) as RegionId[]).filter((r) => !!missionById(`defence.${r}`));
for (const m of [...MISSIONS, ...REGIONS, ...DEFENDED.map((r) => missionById(`defence.${r}`)!)]) {
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

// ------------------------------------------------------------ the director (MissionRules.script) and the column
if (!only || only === 'director') {
  const base = { size: 128, players: 2, aiLevel: 1, islands: false };
  const goal = { id: 'x', text: 'x', hint: '', done: () => false };
  const hqA = (g: Game) => hqOf(g);
  const sentinel = { fired: 0 };
  await withMission({ id: 'test.director', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal],
    rules: {
      rivals: [{ mode: 'builder', level: 1 }],
      script: [
        { id: 'hello', when: { t: 4 }, do: [{ a: 'say', who: 'varro', title: 'A letter', text: 'Words.' }, { a: 'goods', goods: { gold: 5 } }] },
        { id: 'band', when: { after: 'say', t: 2 }, do: [{ a: 'raid', band: 'b1', raid: { from: 'rival', men: { sword: 2, bow: 1, level: 2 }, target: 'hq' } }] },
        { id: 'allies', when: { tally: ['raid', 0], test: (g) => bandLeft(g, 'b1').sent }, do: [{ a: 'join', men: { sword: 2, bow: 0, level: 1 } }] },
        { id: 'war', when: { t: 12 }, do: [{ a: 'mode', mode: 'ai' }, { a: 'do', run: () => { sentinel.fired++; } }] },
      ],
    } }, async (g) => {
    clear();
    run(g, 3);
    check(!seen('say') && !(g.ms!.fired ?? []).length, 'the director waits for its moment');
    const goldBefore = hqA(g).stock.gold;
    run(g, 3);
    const say = events.find((e) => e.type === 'say');
    check(!!say && say.kind === 'varro' && say.text === 'A letter' && say.detail === 'Words.' && say.voice === 'test.director.hello', 'a line is said with its speaker, words and recording');
    check(hqA(g).stock.gold === goldBefore + 5, 'goods arrive in the headquarters');
    run(g, 4);
    const b1 = g.ms!.bands?.b1 ?? [];
    check(b1.length === 3 && b1.every((id) => g.settlers.get(id)?.level === 2 && g.settlers.get(id)?.owner === 1), 'a named band of veterans marches, 2 s after the line was counted');
    const hq = hqA(g);
    const vets = hq.garrison.map((id) => g.settlers.get(id)!).filter((x) => x.level === 1);
    check(vets.length === 2, 'allies join the headquarters with their level');
    const copy = await roundTrip(g);
    check(JSON.stringify(copy.ms!.fired) === JSON.stringify(g.ms!.fired) && JSON.stringify(copy.ms!.bands) === JSON.stringify(g.ms!.bands), 'the fired triggers and the bands survive a save');
    run(g, 6);
    check(g.ai[0].mode === 'ai' && sentinel.fired === 1, 'a rival turns to war when its trigger comes');
    run(g, 10);
    check(sentinel.fired === 1 && (g.ms!.fired ?? []).length === 4 && count('say') === 1, 'every trigger fired once, and only once');
    run(copy, 10);
    check(copy.ai[0].mode === 'ai' && (copy.ms!.fired ?? []).length === 4, 'the saved copy finishes its script the same');
  });
  // a rebellion: a stronghold goes over, and the land round it with it
  await withMission({ id: 'test.flip', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal],
    rules: { rivals: [{ mode: 'dormant' }], script: [{ id: 'rise', when: { t: 4 }, do: [{ a: 'flip', to: 1, pick: (g) => [...g.buildings.values()].filter((b) => b.owner === 0 && b.type === 'tower_s'), men: { sword: 2, bow: 0 } }] }] },
    setup: (g) => { const hq = hqOf(g); const a = placeNear(g, 0, 'tower_s', hq.cx + 11, hq.cz, 5)!; const t = g.addBuilding('tower_s', 0, a.x, a.y, true); garrison(g, t, { sword: 1, bow: 0 }); } }, (g) => {
    const t = [...g.buildings.values()].find((b) => b.type === 'tower_s')!;
    const man = g.settlers.get(t.garrison[0])!;
    clear();
    run(g, 8);
    const rebels = [...g.settlers.values()].filter((x) => !x.dead && (x.inside === t.id || x.home === t.id));
    check(t.owner === 1 && t.occupied && rebels.length === 2 && rebels.every((x) => x.owner === 1), 'the tower goes over, manned by the other side (its men in it or out at its door)');
    check(seen('turncoat') && man.inside !== t.id && man.owner === 0, 'its own man is turned out, not taken over');
    check(g.world.owner[g.world.idx(Math.round(t.cx), Math.round(t.cz))] === 1, 'and the land round it follows');
  });
  // the column: the best men march on a level higher, into the next start
  {
    const g = new Game({ ...base, seed: 5 });
    const hq = hqOf(g);
    garrison(g, hq, { sword: 3, bow: 2 });
    const all = [...g.settlers.values()].filter((s) => s.job === 'swordsman' || s.job === 'bowman');
    all.forEach((s, k) => { s.level = k % 4; });
    hq.stock.board = 99; hq.stock.sword = 3;
    const c = columnOf(g);
    check(c.veterans.length === Math.min(COLUMN_MEN, all.length) && c.veterans.every((v) => v.level >= 1 && v.level <= TOP_LEVEL), `${c.veterans.length} men march on, each a level higher (to ${TOP_LEVEL})`);
    check(c.veterans[0].level === TOP_LEVEL && c.goods.board === 30 && c.goods.sword === 3, 'the best first; the wagons take a capped share');
    const m: Mission = { id: 'test.column', title: 'T', subtitle: '', briefing: ['.'], debrief: '.', hook: '.', map: { ...base, seed: 5 }, unlocks: buildable, goals: [goal] };
    MISSIONS.push(m);
    try {
      const next = new Game({ ...m.map, mission: m.id, carry: c });
      const h2 = hqOf(next);
      const men = h2.garrison.map((id) => next.settlers.get(id)!);
      check(men.length === h2.def.military!.capacity && men.filter((x) => x.level > 0).length === c.veterans.length, 'the veterans take the recruits\' places and fill the headquarters');
      check(h2.stock.board >= 30 + 40 && h2.stock.sword >= 3 + 2, 'the wagons are unloaded on top of the standard start');
      const again = await roundTrip(next);
      check(hqOf(again).garrison.map((id) => again.settlers.get(id)!.level).join() === men.map((x) => x.level).join(), 'a save keeps every man\'s level, and the start is not applied twice');
    } finally { MISSIONS.splice(MISSIONS.indexOf(m), 1); }
  }
}

// ------------------------------------------------------------ the regions' own turns of events, as they happen
if (!only || only === 'scripts') {
  const byId = (id: string) => REGIONS.find((m) => m.id === id)!;
  // Saltus: the fort taken, his veterans march on it
  {
    const m = byId('saltus');
    const g = mk(m);
    const f = g.buildings.get(g.ms!.forts[0])!;
    clear();
    turnCoat(g, f, g.local, { sword: 3, bow: 0 });
    run(g, 4);
    const c = bandLeft(g, 'counter');
    check(c.sent && c.alive === 8 && (g.ms!.bands!.counter ?? []).every((id) => g.settlers.get(id)!.level === 1), 'saltus: the fort taken, eight of his veterans march on it');
    check(events.some((e) => e.type === 'say' && e.kind === 'varro' && e.voice === 'saltus.counter'), 'saltus: and Varro says so');
    check(!m.goals.find((x) => x.id === 'hold')!.done(g), 'saltus: the fort is not held until they are broken');
  }
  // Silva: twenty loaves near their camp and the Ninth come over
  {
    const m = byId('silva');
    const g = mk(m);
    const ninth = hqOf(g, 2);
    const towers = strongholdsOf(g, 2).filter((b) => b.type !== 'hq');
    const a = placeNear(g, g.local, 'tower_l', ninth.cx + 18, ninth.cz + 18, 8, true)!;
    garrison(g, g.addBuilding('tower_l', g.local, a.x, a.y, true), { sword: 1, bow: 0 });
    recomputeTerritory(g);
    // (the wood between their camp and ours is thick: the woodcutters would have cleared a patch)
    g.world.forRadius(ninth.cx + 14, ninth.cz + 14, 4, (i) => { const t = g.trees.get(g.world.tree[i]); if (t) g.removeTree(t); });
    const s = placeNear(g, g.local, 'storehouse', ninth.cx + 14, ninth.cz + 14, 5)!;
    const store = g.addBuilding('storehouse', g.local, s.x, s.y, true);
    const vetsBefore = [...g.settlers.values()].filter((x) => x.owner === g.local && x.level > 0).length;
    clear();
    run(g, 4);
    check(!events.some((e) => e.type === 'turncoat'), 'silva: an empty store near them changes nothing');
    store.stock.bread = 20;
    run(g, 4);
    check(towers.every((b) => b.owner === g.local && b.occupied), 'silva: twenty loaves, and their towers are ours, manned');
    check(!g.buildings.has(ninth.id) || ninth.state === 'burning', 'silva: they burn their camp behind them');
    check([...g.settlers.values()].filter((x) => x.owner === g.local && x.level > 0).length >= vetsBefore + 9, 'silva: six of them join the headquarters, the rest man the towers, all veterans');
    check(store.stock.bread === 0, 'silva: and the bread is eaten');
    run(g, 6);
    check(m.goals.find((x) => x.id === 'ninth')!.done(g), 'silva: the Ninth are won over');
  }
  // Collis: a feast wins a hill; two won, the third yields
  {
    const m = byId('collis');
    const g = mk(m);
    const forts = g.ms!.forts.map((id) => g.buildings.get(id)!);
    const hill = forts[2];
    const a = placeNear(g, g.local, 'tower_l', hill.cx, hill.cz + 20, 6, true)!;
    garrison(g, g.addBuilding('tower_l', g.local, a.x, a.y, true), { sword: 1, bow: 0 });
    recomputeTerritory(g);
    const sp = placeNear(g, g.local, 'storehouse', hill.cx, hill.cz + 16, 6)!;
    const store = g.addBuilding('storehouse', g.local, sp.x, sp.y, true);
    store.stock.bread = 15; store.stock.meat = 10;
    clear();
    run(g, 4);
    check(hill.owner === g.local && hill.occupied && store.stock.bread === 0 && store.stock.meat === 0, 'collis: fifteen loaves and ten joints below the hill, and it comes over');
    check(forts[0].owner !== g.local && forts[1].owner !== g.local, 'collis: the other two stand');
    turnCoat(g, forts[0], g.local, { sword: 2, bow: 0 });
    run(g, 4);
    check(forts.every((b) => b.owner === g.local), 'collis: two won, the third yields');
    check(m.goals[0].done(g) && m.goals[1].done(g), 'collis: the hills are won, one of them with a feast');
  }
  // Ara: the temple goes over with the hill, standing; burn it and the mission is lost
  {
    const m = byId('ara');
    const g = mk(m);
    const temple = [...g.buildings.values()].find((b) => b.sacred)!;
    clear();
    for (const id of g.ms!.forts) turnCoat(g, g.buildings.get(id)!, g.local, { sword: 2, bow: 0 });
    run(g, 4);
    check(temple.owner === g.local && temple.state !== 'burning' && g.buildings.has(temple.id), 'ara: the hill taken, the temple goes over with its ground, standing');
    check(seen('turncoat', g.local) && !seen('missionlost'), 'ara: and the mission goes on');
    const g2 = mk(m);
    const t2 = [...g2.buildings.values()].find((b) => b.sacred)!;
    clear();
    g2.destroyBuilding(t2, true);
    run(g2, 4);
    check(seen('missionlost') && !!g2.ms!.lost && !g2.ms!.won, `ara: a burnt temple loses the mission ("${g2.ms!.lost}")`);
    for (const goal of m.goals) goal.satisfy?.(g2);
    run(g2, 4);
    check(!g2.ms!.won && count('missionwon') === 0, 'ara: and nothing after it wins it');
  }
  // Metalla: once the path is ours, the tribes come down it
  {
    const m = byId('aurum');
    const g = mk(m);
    const f = g.buildings.get(g.ms!.forts[0])!;
    clear();
    run(g, 60, 1);
    check(!seen('raid'), 'metalla: the tribes wait');
    // (as a storming would: the tower changes hands, and the capture is told)
    turnCoat(g, f, g.local, { sword: 3, bow: 0 });
    g.emit({ type: 'captured', b: f.id, owner: g.local, x: f.cx, z: f.cz });
    recomputeTerritory(g);
    run(g, 170, 1);
    const tribes = events.filter((e) => e.type === 'raid');
    check(tribes.length === 1 && tribes[0].owner === 2 && tribes[0].b === f.id, 'metalla: the path taken, the tribes march on the tower at its top');
  }
  // Vallis: a race until the harvest, war after it
  {
    const m = byId('vallis');
    const g = mk(m);
    clear();
    run(g, 34 * 60, 1);
    check(g.ai[0].mode === 'builder' && !seen('attack', 1), 'vallis: no attack before the harvest');
    const hq = hqOf(g);
    const a = placeNear(g, g.local, 'tower_s', hq.cx + 14, hq.cz, 6)!;
    garrison(g, g.addBuilding('tower_s', g.local, a.x, a.y, true), { sword: 2, bow: 0 });
    run(g, 2 * 60, 1);
    check(g.ai[0].mode === 'ai' && bandLeft(g, 'harvest').sent, 'vallis: at the harvest the colonists turn to war and march');
    note(`vallis at 36 min: ${m.goals[0].progress!(g)}; colonists ${g.population(1).total} people, ${strongholdsOf(g, 1).length} strongholds`);
  }
  // Aestuarium: the pirates wait for a cargo, then prey on our ships, and go home between kills
  {
    const m = byId('aestuarium');
    const g = mk(m);
    clear();
    run(g, 300, 1);
    check(!seen('fleet'), 'aestuarium: no pirate sails before a cargo lands');
    m.goals.find((x) => x.id === 'harbour')!.satisfy!(g);
    m.goals.find((x) => x.id === 'colony')!.satisfy!(g);
    const home = [...g.buildings.values()].find((b) => b.owner === 0 && b.type === 'harbour' && g.world.region[b.door] === g.ms!.home)!;
    const colony = [...g.buildings.values()].find((b) => b.owner === 0 && b.type === 'harbour' && b.id !== home.id)!;
    const w = g.world;
    const trader = ship(g, { kind: 'trade', owner: 0, x: w.nx(home.dock), z: w.ny(home.dock), r: 6, own: true });
    home.stock.board = 30;
    check(placeShipOrder(g, home, colony.id, 'board', 6) === null, 'aestuarium: six boards ordered across the water');
    check(runUntil(g, 240, () => tally(g, `unloaded:${colony.id}`) > 0), `aestuarium: a cargo is landed at the colony and counted there (${g.time.toFixed(0)} s)`);
    check(m.goals.find((x) => x.id === 'cargo')!.progress!(g) === '1/9', 'aestuarium: and the goal counts it');
    clear();
    run(g, 64, 1);
    const f1 = g.ms!.bands?.flotilla1 ?? [];
    const pirate = g.ships.get(f1[0]);
    check(f1.length === 1 && !!pirate && pirate.owner === 1 && g.ms!.fleets?.flotilla1?.order === 'prey', 'aestuarium: a minute after the cargo, one pirate sails from the mouth');
    check(pirate?.state === 'hunt' && pirate.target === trader.id, 'aestuarium: and goes for our ship');
    const copy = await roundTrip(g);
    check(JSON.stringify(copy.ms!.fleets) === JSON.stringify(g.ms!.fleets), 'aestuarium: a save keeps the fleet at its order');
    for (const x of [g, copy]) {
      const tr = x.ships.get(trader.id);
      runUntil(x, 300, () => !x.ships.get(trader.id) || x.ships.get(trader.id)!.state === 'sinking');
      const gone = !x.ships.get(trader.id) || x.ships.get(trader.id)!.state === 'sinking';
      check(!!tr && gone, `aestuarium${x === copy ? ' (the copy)' : ''}: with no warship to stop it, it sinks the trader (${x.time.toFixed(0)} s)`);
      const p = x.ships.get(pirate!.id)!;
      run(x, 90, 1);
      const st = x.ms!.fleets!.flotilla1!.at;
      check(p.state !== 'bombard' && Math.hypot(p.x - st[0], p.z - st[1]) < Math.hypot(colony.cx - st[0], colony.cz - st[1]), `aestuarium${x === copy ? ' (the copy)' : ''}: then it sails back for the mouth, and shells nothing (${Math.hypot(p.x - st[0], p.z - st[1]).toFixed(0)} from its station)`);
    }
    // a warship of ours at the dock: the pirate comes for it and is sunk
    const war = ship(g, { kind: 'war', owner: 0, x: w.nx(home.dock), z: w.ny(home.dock), r: 6, own: true });
    check(runUntil(g, 400, () => fleetLeft(g, 'flotilla1').afloat === 0), `aestuarium: a warship of ours afloat, the pirate comes for it and goes down (${g.time.toFixed(0)} s, ours at ${war.hp.toFixed(0)} hp)`);
    run(g, 4);
    check(!g.ms!.fleets?.flotilla1, 'aestuarium: a fleet with nothing afloat is struck off');
  }
  // Insulae: Varro's colonists race for the islands; a colony of ours brings his squadron to shell it
  {
    const m = byId('insulae');
    const g = mk(m);
    clear();
    runUntil(g, 45 * 60, () => [...g.buildings.values()].some((b) => b.owner === 1 && b.type === 'harbour' && g.world.region[b.door] !== g.world.region[hqOf(g, 1).door]));
    const his = [...g.buildings.values()].filter((b) => b.owner === 1 && b.type === 'harbour');
    check(his.some((b) => g.world.region[b.door] !== g.world.region[hqOf(g, 1).door]), `insulae: Varro’s colonists put ashore on an island of their own (${(g.time / 60).toFixed(0)} min; ${his.length} harbours of his)`);
    check(!seen('fleet') && g.ai[0].mode === 'builder', 'insulae: and his warships stay home while we have landed nowhere');
    const h = mk(m);
    m.goals.find((x) => x.id === 'yard')!.satisfy!(h);
    const isle = [{ x: 44, y: 30, r: 10 }];
    const spot = colonySpot(h, isle[0])!;
    const col = h.addBuilding('harbour', 0, spot.x, spot.y, true);
    garrison(h, col, { sword: 1, bow: 0 });
    recomputeTerritory(h);
    h.emit({ type: 'landed', b: col.id, x: col.cx, z: col.cz, owner: 0 });
    clear();
    run(h, 302, 1);
    const sq = h.ms!.bands?.squadron ?? [];
    check(sq.length === 2 && seen('fleet', 1), 'insulae: five minutes after our first landing, his squadron of two sails');
    const shelling = sq.map((id) => h.ships.get(id)!).filter((sh) => sh.state === 'bombard');
    const targets = new Set(shelling.map((sh) => h.buildings.get(sh.target)?.owner));
    check(shelling.length === 2 && targets.size === 1 && targets.has(0), `insulae: and shells a stronghold of ours by the water (${shelling.map((sh) => h.buildings.get(sh.target)?.type).join(', ')})`);
    const first = h.buildings.get(shelling[0].target)!;
    runUntil(h, 600, () => !h.buildings.has(first.id) || first.state === 'burning');
    const fell = h.time;
    const shellingNext = () => sq.map((id) => h.ships.get(id)).filter((sh) => sh && sh.state === 'bombard' && sh.target !== first.id).map((sh) => h.buildings.get(sh!.target));
    runUntil(h, 180, () => shellingNext().length > 0);
    const next = shellingNext();
    note(`insulae: the ${first.type} fell at ${(fell / 60).toFixed(1)} min; ${(h.time - fell).toFixed(0)} s later the squadron ${next.length ? `shells the ${next[0]?.type}` : sq.map((id) => h.ships.get(id)?.state).join(', ')} (${count('sinking', 0)} ships of ours sunk on the way)`);
    check(next.length > 0 && next.every((b) => b?.owner === 0), 'insulae: and goes on to the next');
    const spot2 = colonySpot(h, { x: 94, y: 44, r: 12 })!;
    const col2 = h.addBuilding('harbour', 0, spot2.x, spot2.y, true);
    garrison(h, col2, { sword: 1, bow: 0 });
    recomputeTerritory(h);
    h.emit({ type: 'landed', b: col2.id, x: col2.cx, z: col2.cz, owner: 0 });
    run(h, 4);
    const aq = (h.ms!.bands?.aquila ?? []).map((id) => h.ships.get(id)!);
    check(aq.length === 3 && aq[0].name === 'Aquila' && aq[0].maxHp === 180 && h.ai[0].mode === 'ai', 'insulae: a second landing, the Aquila’s three, and Varro turns to war');
  }
  // Litus: the Corvus rides at her harbour; raids come while it stands, and not after
  {
    const m = byId('litus');
    const g = mk(m);
    const corvus = g.ships.get(g.ms!.bands!.corvus[0])!;
    clear();
    run(g, 880, 1);
    check(!seen('fleet') && corvus.state === 'guard' && corvus.hp === 360, 'litus: the Corvus keeps her post, and no raid in the first quarter hour');
    run(g, 24, 1);
    check((g.ms!.bands?.raid1 ?? []).length === 1, 'litus: at fifteen minutes the first raider sails');
    g.destroyBuilding(g.buildings.get(g.ms!.forts[0])!, false);
    run(g, 700, 1);
    check(!g.ms!.bands?.raid2 && m.goals.find((x) => x.id === 'nest')!.done(g), 'litus: the harbour burnt, no more raiders come');
    // four warships of ours against her and her escort
    const h = mk(m);
    const c = h.ships.get(h.ms!.bands!.corvus[0])!;
    const ours = [0, 1, 2, 3].map((k) => ship(h, { kind: 'war', owner: 0, x: c.x - 6 + k * 3, z: c.z - 26, r: 8, own: true }));
    orderShipAttack(h, 0, ours.map((s) => s.id), c);
    runUntil(h, 600, () => fleetLeft(h, 'corvus').afloat === 0 || ours.every((s) => !h.ships.get(s.id) || h.ships.get(s.id)!.state === 'sinking'));
    const left = ours.filter((s) => h.ships.get(s.id) && h.ships.get(s.id)!.state !== 'sinking');
    note(`litus: four warships on the Corvus: ${fleetLeft(h, 'corvus').afloat ? 'she is still afloat' : 'she goes down'} at ${h.time.toFixed(0)} s, ${left.length} of ours afloat (${left.map((s) => s.hp.toFixed(0)).join(', ')} hp), escorts ${fleetLeft(h, 'escort').afloat} afloat`);
    check(fleetLeft(h, 'corvus').afloat === 0, 'litus: four warships together can sink the Corvus');
  }
  // peace: with the tribes won over (Collis held) Metalla's path is quiet; with the pirates (Litus) the estuary is
  {
    const peace = { veterans: [], goods: {}, peace: ['tribes', 'pirates'] as ('tribes' | 'pirates')[] };
    const m = byId('aurum');
    const g = new Game({ ...m.map, mission: m.id, carry: peace });
    const f = g.buildings.get(g.ms!.forts[0])!;
    clear();
    turnCoat(g, f, g.local, { sword: 3, bow: 0 });
    g.emit({ type: 'captured', b: f.id, owner: g.local, x: f.cx, z: f.cz });
    recomputeTerritory(g);
    run(g, 800, 1);
    check(!seen('raid') && g.ms!.raid === 3 && events.some((e) => e.type === 'say' && e.voice === 'aurum.friends'), 'peace: Collis held, the path taken, and no tribesman comes down it (the quaestor says why)');
    const a = byId('aestuarium');
    const h = new Game({ ...a.map, mission: a.id, carry: peace });
    clear();
    a.goals.find((x) => x.id === 'harbour')!.satisfy!(h);
    a.goals.find((x) => x.id === 'colony')!.satisfy!(h);
    a.goals.find((x) => x.id === 'cargo')!.satisfy!(h);
    check(a.goals.find((x) => x.id === 'flotillas')!.done(h), 'peace: Litus held, the flotillas are no concern in the estuary');
    run(h, 1200, 1);
    check(!seen('fleet') && h.ships.size === 0 && !events.some((e) => e.type === 'say' && e.voice?.startsWith('aestuarium.flotilla')), 'peace: a cargo lands and no pirate sails, nor is one announced');
    run(h, 4);
    check(!!h.ms!.won, 'peace: and the estuary is won on its cargoes');
  }
  // Castellum: frost at the gate, the garrison wakes at the first breach, the castles are kept full to their walls
  {
    const m = byId('castellum');
    const g = mk(m);
    const castles = g.ms!.forts.map((id) => g.buildings.get(id)!);
    const west = castles[0];
    const party: number[] = [];
    for (let k = 0; k < 5; k++) { const s = g.addSettler(0, 'swordsman', west.door); g.syncPos(s); s.x -= 4; s.z += (k - 2) * 0.8; party.push(s.id); }
    clear();
    runUntil(g, 90, () => events.some((e) => e.type === 'frozen' && e.owner === 0));
    check(events.some((e) => e.type === 'frozen' && e.owner === 0), `castellum: five of ours at the western castle, and once his priest is at the temple they are frozen (${g.time.toFixed(0)} s)`);
    check(castles.slice(1).every((b) => b.garrison.length === 9), `castellum: the other castles keep their nine men, far from us as they are (${castles.map((b) => b.garrison.length).join(', ')})`);
    check(g.ai[0].mode === 'builder', 'castellum: the garrison waits behind its walls');
    g.destroyBuilding(castles[3], false);
    run(g, 4);
    check(g.ai[0].mode === 'ai' && events.some((e) => e.type === 'say' && e.voice === 'castellum.breach'), 'castellum: one castle down, and his garrison stops waiting');
    const before = castles.slice(0, 3).map((b) => b.garrison.length);
    g.time = 1200;
    run(g, 4);
    check(castles.slice(0, 3).every((b, k) => b.garrison.length === Math.min(b.def.military!.capacity, before[k] + 3)), `castellum: at twenty minutes the castles are reinforced to their walls (${castles.slice(0, 3).map((b) => b.garrison.length).join(', ')} of ${west.def.military!.capacity})`);
  }
  // Nova Ostia: the truce, and the Senate's ship
  {
    const m = byId('novaostia');
    const g = mk(m);
    clear();
    run(g, 580, 1);
    check(!seen('attack', 1) && g.ai[0].mode === 'ai', 'novaostia: ten minutes of truce while his heralds ride');
    const lost = mk(m);
    lost.time = 100 * 60 - 5;
    clear();
    run(lost, 10, 1);
    check(seen('missionlost') && !!lost.ms!.lost && !lost.ms!.won, `novaostia: the Senate’s ship docks with his hall standing, and the finale is lost ("${lost.ms!.lost}")`);
    const hard = new Game({ ...m.map, mission: m.id, difficulty: 2 });
    hard.time = 80 * 60 + 1;
    run(hard, 3, 1);
    check(!!hard.ms!.lost, 'novaostia: on Hard the ship docks at an hour and twenty');
    const won = mk(m);
    for (const goal of m.goals.filter((x) => !x.optional)) goal.satisfy!(won);
    run(won, 3, 1);
    won.time = 100 * 60 + 10;
    run(won, 3, 1);
    check(!!won.ms!.won && !won.ms!.lost, 'novaostia: his hall taken before the ship docks: won, and the ship changes nothing');
  }
}

// ------------------------------------------------------------ the province: seasons, Varro's turn, the column and the boons
if (!only || only === 'province') {
  const drawn = (id: string) => !!missionById(id);
  const col = { veterans: [{ job: 'swordsman' as const, level: 1 }], goods: { board: 10 } };
  const s = newProvince(12345, 1);
  check(s.held.join() === 'castra' && s.season === 1 && !s.strike, 'a campaign begins with the capital held, in season I');
  const nextToCastra = REGION_INFO.castra.roads.filter((r) => REGION_INFO[r].mission && drawn(REGION_INFO[r].mission!));
  check(frontier(s, drawn).join() === REGION_IDS.filter((r) => nextToCastra.includes(r)).join(), `the border opens on the regions drawn next to it (${frontier(s, drawn).join(', ')})`);
  regionWon(s, 'saltus', col);
  check(s.held.includes('saltus') && s.season === 2 && s.column === col, 'a region won is held, its column kept, and the season turns');
  const fortified = Object.entries(s.fortified).filter(([, n]) => n);
  check(fortified.length === 1 && REGION_INFO[fortified[0][0] as RegionId].roads.some((r) => s.held.includes(r)), `Varro fortifies a region of his on our border (${fortified.map(([r]) => r).join()})`);
  check(frontier(s, drawn).includes('vallis'), 'the pass opens the road to the valley');
  const b = startOf(s)!;
  check(b.goods.iron === 12 && b.goods.coal === 12 && b.goods.board === 30 && b.veterans.length === 1, 'the next start: the column, the capital\'s stores and the pass\'s iron and coal');
  regionWon(s, 'silva', col);
  check(s.season === 3 && !!s.strike && s.held.includes(s.strike) && s.strike !== 'castra', `in season III he strikes a region we hold (${s.strike})`);
  check(frontier(s, drawn).length === 0, 'no campaign elsewhere while his legion is on the road');
  const struck = s.strike!;
  strikeHeld(s, col);
  check(!s.strike && s.held.includes(struck) && s.season === 4, 'a strike beaten off: the region stays ours and the season turns');
  check(startOf(s)!.veterans.filter((v) => v.level === 1).length === 1 + 3, 'the Ninth\'s three veterans march with every column once the forest is ours');
  const won: ProvinceState = { ...newProvince(5, 1), held: ['castra', 'collis', 'litus', 'aestuarium'] };
  const st = startOf(won)!;
  check(st.peace?.join() === 'collis,litus'.split(',').map((r) => REGION_INFO[r as RegionId].boon.peace).join() && st.ships?.war === 2 && st.ships?.trade === 1, `Collis and Litus held: peace with the tribes and the pirates, and their ships, in every start (${JSON.stringify({ peace: st.peace, ships: st.ships })})`);
  // Castellum held: nothing left for him to fortify from, and his strikes at half the weight
  const late2: ProvinceState = { ...newProvince(11, 1), held: ['castra', 'saltus', 'vallis', 'castellum'], season: 10 };
  const turns = [10, 11, 12, 13].map((season) => varrosTurn({ ...late2, season }));
  check(turns.every((t) => t === null || t.kind === 'strike'), `Castellum held: he fortifies no more (${turns.map((t) => t?.kind ?? '-').join(', ')})`);
  check(strikeWeight(late2) === 2 && strikeWeight({ ...late2, held: ['castra', 'saltus', 'vallis'] }) === 4, 'and his strikes come at half the weight');
  // determinism: the same run from the same seed moves the same way
  const again = newProvince(12345, 1);
  regionWon(again, 'saltus', col); regionWon(again, 'silva', col); strikeHeld(again, col);
  check(JSON.stringify(again) === JSON.stringify(s), 'the same seed, the same moves: Varro\'s turn is deterministic');
  // a strike lost: the region is his again, fortified; the capital lost ends the campaign
  const t: ProvinceState = { ...newProvince(7, 2), held: ['castra', 'silva', 'saltus'], season: 5 };
  const turn = varrosTurn(t);
  check(turn?.kind === 'strike', `on Hard he strikes in season V too (${turn?.kind} ${turn?.region})`);
  t.strike = 'silva';
  strikeLost(t);
  check(!t.held.includes('silva') && (t.fortified.silva ?? 0) >= 1 && t.season === 6, 'a strike lost: the forest is his again, and fortified');
  const late: ProvinceState = { ...newProvince(9, 1), held: ['castra', 'saltus'], season: 8 };
  check(varrosTurn(late)?.region === 'castra', 'late and weak: he comes for the capital');
  late.strike = 'castra';
  strikeLost(late);
  check(late.end === 'recalled' && varrosTurn(late) === null, 'the capital lost: recalled to Rome, and the war is over');
  // the finale waits for eight regions
  const big: ProvinceState = { ...newProvince(3, 1), held: ['castra', 'silva', 'saltus', 'vallis', 'metalla', 'ara', 'litus'] };
  big.held.push('castellum');
  const fake = () => true;
  check(big.held.length === TO_THE_FINALE && frontier(big, fake).includes('novaostia') === !!REGION_INFO.novaostia.mission, 'Nova Ostia opens at eight regions held (once it is drawn)');
  big.held.pop();
  check(!frontier(big, fake).includes('novaostia'), 'and not at seven');
  // every region we can hold has a defence that builds
  for (const r of DEFENDED) check(!!missionById(`defence.${r}`), `a defence of ${REGION_INFO[r].name} is drawn`);
  // a whole campaign, as far as it is drawn: every region taken, every strike held
  const run = newProvince(424242, 1);
  let guard = 0;
  while (guard++ < 40 && !run.end) {
    if (run.strike) { strikeHeld(run, col); continue; }
    const f = frontier(run, drawn);
    if (!f.length) break;
    regionWon(run, f[0], col);
  }
  note(`a campaign as far as it is drawn: ${run.held.join(', ')} held in ${run.season} seasons; fortified ${JSON.stringify(run.fortified)}; ${run.log.length} dispatches; ledger ${JSON.stringify(run.ledger)}`);
  check(run.end === 'won' && run.held.includes('novaostia') && run.ledger!.won === run.held.length - 1, 'the whole war can be won: Nova Ostia last, and the ledger counts every region taken');
  check(REGION_IDS.every((r) => run.held.includes(r)), `every region can be taken in one campaign (${run.held.length})`);
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
