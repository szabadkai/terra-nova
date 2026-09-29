// Headless check of the lockstep game (src/net/lockstep.ts). Three machines play one game over a network
// that delays, reorders and repeats their packets (the third seat only watches); the game must come out
// the same on all three, turn by turn. Two seats give commands of every kind, the host pauses and
// changes the speed, one machine stops for a while, and all the people fall in the end. Also checked: the
// look-ahead calls the interface makes stay pure, the fog is each player's own, and nothing in src/ui,
// src/render or src/main.ts writes the game directly.
// Usage: npx tsx scripts/lockstep.ts [minutes] [seed]
import { readFileSync, readdirSync } from 'node:fs';
import { Game, strongholdsOf } from '../src/game/game';
import { Lockstep, TURN_S, type TurnPacket } from '../src/net/lockstep';
import { stateHash, stateHashParts } from '../src/game/hash';
import type { Cmd } from '../src/game/commands';
import { snapshot } from '../src/game/save';
import { RNG } from '../src/core/rng';
import { BUILD_ORDER, TOOLS } from '../src/game/defs';
import { planFormation } from '../src/game/orders';
import { canBombard } from '../src/game/naval';
import { colonySite } from '../src/game/sea';
import { castError, type SpellId } from '../src/game/faith';
import type { Formation } from '../src/game/types';

const minutes = Number(process.argv[2] ?? 20), seed = Number(process.argv[3] ?? 7);
let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) fails++; console.log(ok ? '  ok  ' : '  FAIL', what); };

// ---- three machines, one game
const DELAY = 2;
const opts = { size: 128, seed, players: 4, aiLevel: 1, islands: true, humans: 3 };
const A = new Game({ ...opts, local: 0 }), B = new Game({ ...opts, local: 1 }), C = new Game({ ...opts, local: 2 });
const games = [A, B, C];
check(stateHash(A) === stateHash(B) && stateHash(B) === stateHash(C), 'the machines start from the same game, whichever seat they hold');
const SEATS = [0, 1, 2];
const dA = new Lockstep(A, SEATS, DELAY), dB = new Lockstep(B, SEATS, DELAY), dC = new Lockstep(C, SEATS, DELAY);
const drivers = [dA, dB, dC];
for (const d of drivers) d.start();

// ---- a network that delays each packet by up to 600 ms, delivers them in any order and repeats one in ten
const net = new RNG(seed * 7 + 1);
interface Wire { at: number; to: Lockstep; slot: number; pkt: TurnPacket; id: number }
let queue: Wire[] = [];
let now = 0, rejected = 0, wires = 0;
/** how many copies of each repeated packet have arrived */
const arrived = new Map<number, number>();
const post = (from: number, pkt: TurnPacket) => {
  for (const to of drivers) {
    if (to.local === from) continue;
    const copies = net.chance(0.1) ? 2 : 1, id = wires++;
    if (copies > 1) arrived.set(id, 0);
    for (let k = 0; k < copies; k++) queue.push({ at: now + net.range(0, 600), to, slot: from, pkt: JSON.parse(JSON.stringify(pkt)), id });
  }
};
dA.send = (p) => post(0, p);
dB.send = (p) => post(1, p);
dC.send = (p) => post(2, p);
const deliver = () => {
  const due = queue.filter((w) => w.at <= now);
  queue = queue.filter((w) => w.at > now);
  net.shuffle(due);
  for (const w of due) {
    if (!w.to.onPacket(w.slot, w.pkt)) rejected++;
    if (arrived.has(w.id)) arrived.set(w.id, arrived.get(w.id)! + 1);
  }
};

// ---- what each machine reports
const desyncs: string[] = [];
let waits = 0, lost = 0;
for (const [i, d] of drivers.entries()) d.onEvent = (e) => {
  if (e.type === 'desync') desyncs.push(`machine ${i} at turn ${e.turn}`);
  if (e.type === 'waiting') waits++;
  if (e.type === 'lost') lost++;
};
/** each machine's hash sections at each turn's end, compared once all three have the turn */
const parts: Map<number, Record<string, number>>[] = [new Map(), new Map(), new Map()];
const snaps: Map<number, string>[] = [new Map(), new Map(), new Map()];
let firstDrift: string | null = null, turnsCompared = 0, snapsCompared = 0, snapDrift: number | null = null;
const SNAP_EVERY = 300;
/** the turns at which the guest, the host and the third seat fall (the network's waits make turns slower than TURN_S) */
const RAZE1 = Math.round((minutes * 60 * 0.5) / TURN_S), RAZE0 = Math.round((minutes * 60 * 0.62) / TURN_S), RAZE2 = Math.round((minutes * 60 * 0.74) / TURN_S);
const persistent = (g: Game) => {
  const d = snapshot(g) as unknown as Record<string, any>;
  delete d.ui;
  delete d.world.arrays.explored;
  delete d.scalars.local;
  delete d.opts.local;
  return JSON.stringify(d, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array).join(',') : v));
};
for (const [i, d] of drivers.entries()) d.onTurnEnd = (turn) => {
  const g = games[i];
  parts[i].set(turn, stateHashParts(g));
  if (parts.every((m) => m.has(turn))) {
    const [a, b, c] = parts.map((m) => m.get(turn)!);
    for (const k in a) if ((a[k] !== b[k] || a[k] !== c[k]) && !firstDrift) firstDrift = `turn ${turn} (${(turn * TURN_S / 60).toFixed(1)} min) section "${k}": ${a[k]} / ${b[k]} / ${c[k]}`;
    turnsCompared++;
    for (const m of parts) m.delete(turn);
  }
  if (turn % SNAP_EVERY === 0 && turn > 0) {
    snaps[i].set(turn, persistent(g));
    if (snaps.every((m) => m.has(turn))) {
      const [a, b, c] = snaps.map((m) => m.get(turn)!);
      if ((a !== b || a !== c) && snapDrift === null) snapDrift = turn;
      snapsCompared++;
      for (const m of snaps) m.delete(turn);
    }
  }
  // the people fall, at the same turn on every machine: the guest, the host, then the third seat
  const razed = turn === RAZE1 ? 1 : turn === RAZE0 ? 0 : turn === RAZE2 ? 2 : -1;
  if (razed >= 0) {
    for (const b of strongholdsOf(g, razed)) g.destroyBuilding(b, true);
    const hq = g.buildings.get(g.players[razed].hq);
    if (hq && hq.owner === razed) g.destroyBuilding(hq, true);
  }
};

// ---- the players: random commands of every kind from each seat, from that seat's own machine
const rnd = new RNG(seed * 13 + 5);
const pick = <T>(a: T[]): T | undefined => (a.length ? a[rnd.int(0, a.length)] : undefined);
const SHAPES: Formation[] = ['line', 'block', 'wedge', 'ring'];
const SPELLS: SpellId[] = ['harvest', 'heal', 'wrath', 'convert'];
const TYPES = [...BUILD_ORDER.basic, ...BUILD_ORDER.food, ...BUILD_ORDER.military, ...BUILD_ORDER.industry, ...BUILD_ORDER.faith];
function randomCmd(g: Game, owner: number): Cmd | null {
  const my = [...g.buildings.values()].filter((b) => b.owner === owner);
  const hq = g.buildings.get(g.players[owner].hq);
  if (!hq) return null;
  const near = () => ({ x: hq.cx + rnd.range(-18, 18), z: hq.cz + rnd.range(-18, 18) });
  const men = () => [...g.settlers.values()].filter((s) => s.owner === owner && (s.job === 'swordsman' || s.job === 'bowman') && !s.inside && !s.dead).map((s) => s.id);
  const foes = () => [...g.buildings.values()].filter((b) => b.owner !== owner && b.def.military && b.state === 'done');
  switch (rnd.int(0, 26)) {
    case 0: case 1: case 2: case 3: case 4: {
      const t = pick(TYPES)!, p = near(), a = g.anchorFor(t, Math.round(p.x), Math.round(p.z));
      return { t: 'place', b: t, x: a.x, y: a.y };
    }
    case 5: { const b = pick(my.filter((b) => b.type !== 'hq')); return b ? { t: 'destroy', id: b.id } : null; }
    case 6: { const b = pick(my); return b ? { t: 'prio', id: b.id, on: rnd.chance(0.5) } : null; }
    case 7: { const b = pick(my); return b ? { t: 'set', id: b.id, k: 'paused', v: rnd.chance(0.5) } : null; }
    case 8: { const b = pick(my.filter((b) => b.def.military)); return b ? { t: 'set', id: b.id, k: 'desiredSoldiers', v: rnd.int(1, 7) } : null; }
    case 9: return { t: 'pset', k: 'swordRatio', v: rnd.next() };
    case 10: return { t: 'pset', k: 'toolPrio', tool: pick(TOOLS)!, v: rnd.int(0, 11) };
    case 11: case 12: { const m = men(); const p = near(); return m.length ? { t: 'move', ids: m.slice(0, rnd.int(1, m.length + 1)), x: p.x, z: p.z, shape: pick(SHAPES) } : null; }
    case 13: { const m = men(); return m.length ? { t: 'drill', ids: m, shape: pick(SHAPES)! } : null; }
    case 14: { const m = men(); return m.length ? { t: 'firm', ids: m, firm: rnd.chance(0.5) } : null; }
    case 15: { const b = pick(my.filter((b) => b.def.military && b.garrison.length > 1)); return b ? { t: 'callout', b: b.id, keep: 1 } : null; }
    case 16: { const m = men(); return m.length ? { t: 'return', ids: m } : null; }
    case 17: { const f = pick(foes()); return f ? { t: 'launch', b: f.id, n: rnd.int(1, 8) } : null; }
    case 18: { const f = pick(foes()), m = men(); return f && m.length ? { t: 'storm', ids: m, b: f.id } : null; }
    case 19: { const b = pick(my.filter((b) => b.def.military && b.state === 'done')), m = men(); return b && m.length ? { t: 'garrison', ids: m, b: b.id } : null; }
    case 20: { const p = near(); return { t: 'cast', id: pick(SPELLS)!, x: p.x, z: p.z }; }
    case 21: { const p = near(); return { t: 'geologist', x: p.x, z: p.z }; }
    case 22: { const p = near(); return { t: 'pioneer', x: p.x, z: p.z }; }
    case 23: { const b = pick(my.filter((b) => b.type === 'toolsmith')); return b ? { t: 'set', id: b.id, k: 'toolChoice', v: pick(['auto', 'axe', 'saw'])! } : null; }
    case 24: return { t: 'destroy', id: 999999 }; // nonsense: refused, quietly
    case 25: return { t: 'set', id: hq.id, k: 'tradeTo', v: 12345 }; // a destination that is not one
  }
  return null;
}
/** command kinds given and answered well, per seat */
const issued = new Map<Lockstep, Map<number, string>>([[dA, new Map()], [dB, new Map()]]);
const okKinds = new Set<string>(), failKinds = new Set<string>();
const give = (d: Lockstep, c: Cmd) => { const seq = d.issue(c); issued.get(d)!.set(seq, c.t); };
const drain = (i: number) => {
  const g = games[i], d = drivers[i];
  for (const e of g.events) {
    if (e.type === 'cmd' && e.owner === g.local && e.seq !== undefined) {
      const t = issued.get(d)?.get(e.seq);
      if (t) (e.ok ? okKinds : failKinds).add(t);
    }
    if (e.type === 'defeated') defeats[i].push(e.owner!);
    if (e.type === 'gameover') overs[i].push(e.owner!);
  }
  g.events.length = 0;
};
const defeats: number[][] = [[], [], []], overs: number[][] = [[], [], []];

// ---- play
const END = minutes * 60 * 1000;
// (all multiples of the 16 ms step)
const PAUSE_AT = 30000, UNPAUSE_AT = 33008, FREEZE_AT = 60000, THAW_AT = 63008;
let nextCmd = 3000, nextSpeed = 45000, ticksAtFreeze = -1, pausedTurns = -1, pausedTicks = -1, turnsWhilePaused = 0, ticksWhilePaused = 0, gapMax = 0;
const t0 = Date.now();
for (now = 0; now < END; now += 16) {
  deliver();
  const frozen = now >= FREEZE_AT && now < THAW_AT;
  dA.pump(now);
  if (!frozen) dB.pump(now);
  dC.pump(now);
  for (let i = 0; i < 3; i++) drain(i);
  gapMax = Math.max(gapMax, Math.abs(dA.turn - dB.turn), Math.abs(dA.turn - dC.turn));
  if (now >= nextCmd) {
    nextCmd = now + rnd.range(200, 900);
    const a = randomCmd(A, 0); if (a) give(dA, a);
    const b = randomCmd(B, 1); if (b) give(dB, b);
  }
  // the host pauses for three seconds, then plays on at double speed; later it tries every speed
  if (now === PAUSE_AT) give(dA, { t: 'speed', s: 0 });
  if (now === PAUSE_AT + 1008) { pausedTurns = dA.turn; pausedTicks = dA.ticks; }
  if (now === UNPAUSE_AT) { turnsWhilePaused = dA.turn - pausedTurns; ticksWhilePaused = dA.ticks - pausedTicks; give(dA, { t: 'speed', s: 2 }); }
  if (now >= nextSpeed) { nextSpeed = now + 20000; give(dA, { t: 'speed', s: pick([1, 2, 4])! }); give(dB, { t: 'speed', s: 3 }); /* the guest's: not theirs to set */ }
  if (now === FREEZE_AT + 1008) ticksAtFreeze = dA.ticks;
  if (now === THAW_AT - 16) check(dA.ticks === ticksAtFreeze && dA.turn - dB.turn <= DELAY, `a machine that stops stops the others within ${DELAY} turns (${dA.ticks - ticksAtFreeze} ticks run, ${dA.turn - dB.turn} turns ahead)`);
}
// play on (nobody giving orders) until the last fall is well past, then pause so all three come to rest on the same tick
let restAt = -1;
for (let k = 0; k < END / 16 && (restAt < 0 || k < restAt + 300); k++) {
  now += 16; deliver(); for (const d of drivers) d.pump(now); for (let i = 0; i < 3; i++) drain(i);
  if (restAt < 0 && dA.turn >= RAZE2 + 100) { restAt = k; give(dA, { t: 'speed', s: 0 }); }
}
const ms = Date.now() - t0;

console.log(`${minutes} min of lockstep in ${(ms / 1000).toFixed(1)} s: ${dA.turn} turns, ${dA.ticks} ticks, ${turnsCompared} turns compared, ${snapsCompared} snapshots compared, ${waits} waits`);
check(desyncs.length === 0, `no machine reports a desync${desyncs.length ? `: ${desyncs.join(', ')}` : ''}`);
check(!firstDrift, `every section of the hash agrees on all three machines at every turn${firstDrift ? ` — drift at ${firstDrift}` : ''}`);
check(turnsCompared >= dA.turn - 1, `every turn was compared (${turnsCompared} of ${dA.turn})`);
check(snapDrift === null && snapsCompared > 0, `the full snapshots agree every ${SNAP_EVERY} turns (${snapsCompared} compared${snapDrift !== null ? `, drift at turn ${snapDrift}` : ''})`);
check(dA.ticks === dB.ticks && dA.ticks === dC.ticks, `paused at the end, all three rest on the same tick (${dA.ticks}/${dB.ticks}/${dC.ticks}; turns ${dA.turn}/${dB.turn}/${dC.turn})`);
check(stateHash(A) === stateHash(B) && stateHash(B) === stateHash(C), 'and with the same game');
check(gapMax <= DELAY, `no machine ever ran more than ${DELAY} turns ahead (${gapMax})`);
const pairs = [...arrived.values()].filter((n) => n === 2).length;
check(rejected === pairs, `each repeated packet was refused once (${pairs} repeats arrived, ${rejected} refused)`);
check(lost === 0, 'no machine gave anyone up for lost');
check(waits > 0, 'the slow network made the machines wait for one another now and then');
check(turnsWhilePaused >= 5 && ticksWhilePaused === 0, `paused, the turns go on (${turnsWhilePaused} in 2 s) and the ticks do not (${ticksWhilePaused})`);
check(dA.speed === dB.speed && dA.speed === dC.speed && dA.speed !== 3, `the speed is the same everywhere (${dA.speed}/${dB.speed}/${dC.speed}) and the guest's speed commands were ignored`);
const wanted = ['place', 'destroy', 'prio', 'set', 'pset', 'move', 'drill', 'firm', 'return', 'geologist', 'pioneer'];
check(wanted.every((k) => okKinds.has(k)), `commands of every everyday kind got through from both seats (done: ${[...okKinds].sort().join(' ')}; refused: ${[...failKinds].sort().join(' ')})`);
check(okKinds.has('callout') || okKinds.has('launch') || okKinds.has('storm') || okKinds.has('garrison'), 'and some soldiers were commanded');

// ---- the fall of the people, seen alike everywhere
check(games.every((g) => !g.players[1].alive && !g.players[0].alive && !g.players[2].alive), 'the people have all fallen, on every machine');
check(games.every((g) => g.over && g.winner === 3), `with them fallen the game is over everywhere, won by the computer kingdom (${A.winner}/${B.winner}/${C.winner})`);
check(defeats.every((d) => d.includes(0) && d.includes(1) && d.includes(2)), 'each machine heard of every fall');
check(overs.every((o) => o.length === 1 && o[0] === 3), 'and of the one end');

// ---- each player's own fog
{
  const w = A.world;
  let seenHq = true, ownA = true, ownB = true;
  for (const p of A.players) { const hq = A.starts[p.id]; if (!((w.seen[w.idx(hq.x, hq.y)] >> p.id) & 1)) seenHq = false; }
  for (let i = 0; i < w.N; i++) {
    if (A.world.explored[i] !== ((A.world.seen[i] >> 0) & 1)) ownA = false;
    if (B.world.explored[i] !== ((B.world.seen[i] >> 1) & 1)) ownB = false;
  }
  check(seenHq, 'every player has seen the ground around their headquarters');
  check(ownA && ownB, "each machine's fog is its own player's view of what the game has seen");
  let same = true;
  for (let i = 0; i < w.N; i++) if (A.world.seen[i] !== B.world.seen[i]) same = false;
  check(same, 'and what the game has seen is the same on both');
}

// ---- the look-ahead calls the interface makes change nothing
{
  const g = new Game({ ...opts, local: 0 });
  for (let i = 0; i < 300; i++) { g.update(1); g.events.length = 0; }
  const before = `${g.rng.state}/${g.nextId}/${stateHash(g)}`;
  const hq = g.buildings.get(g.players[0].hq)!;
  const men = [...g.settlers.values()].filter((s) => s.owner === 0 && s.job === 'swordsman').map((s) => s.id);
  const ships = [...g.ships.values()];
  const forts = [...g.buildings.values()].filter((b) => b.def.military && b.state === 'done');
  const harbours = [...g.buildings.values()].filter((b) => b.type === 'harbour' && b.owner === 0);
  const r = new RNG(3);
  for (let i = 0; i < 200; i++) {
    const x = hq.cx + r.range(-30, 30), z = hq.cz + r.range(-30, 30);
    planFormation(g, 0, men, x, z, SHAPES[i % 4]);
    const t = TYPES[i % TYPES.length], a = g.anchorFor(t, Math.round(x), Math.round(z));
    g.placeError(t, 0, a.x, a.y);
    castError(g, 0, SPELLS[i % 4], x, z);
    if (ships.length && forts.length) canBombard(g, ships[i % ships.length], forts[i % forts.length]);
    if (harbours.length) colonySite(g, 0, harbours[i % harbours.length], x, z);
  }
  check(`${g.rng.state}/${g.nextId}/${stateHash(g)}` === before, 'planFormation, placeError, castError, canBombard and colonySite leave the game as it was');
}

// ---- the hash is cheap
{
  const t = performance.now();
  for (let i = 0; i < 50; i++) stateHash(A);
  const per = (performance.now() - t) / 50;
  check(per < 1, `the state hash takes ${per.toFixed(2)} ms with ${A.settlers.size} settlers and ${A.buildings.size} buildings`);
}

// ---- the interface only ever gives commands
{
  const files = ['src/main.ts', ...readdirSync('src/ui').map((f) => `src/ui/${f}`), ...readdirSync('src/render').map((f) => `src/render/${f}`)].filter((f) => f.endsWith('.ts'));
  const calls = /\b(placeBuilding|destroyBuilding|setPriority|orderMove|setDrill|setFirm|orderAttack|orderGarrison|orderReturn|callOut|launchAttack|orderShipMove|orderShipAttack|orderShipBombard|orderShipHome|castSpell|sendGeologist|sendPioneer|recallPioneer|startExpedition|cancelExpedition|scoutSeas|placeShipOrder|cancelShipOrder|bookPassengers|placeOrder)\(/;
  const writes = /\b(b|p|s|sh|m|hq|ship)\.(paused|desiredSoldiers|toolChoice|tradeTo|seaAuto|shipKind|swordRatio|anim|animT|priority|mana|alive)\s*=[^=]/;
  const bad: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      const code = l.replace(/\/\/.*$/, '');
      // (a method of the HUD's own by one of these names, or a call to it, is not a call into the game)
      if ((calls.test(code) && !/(^\s*|\b(this|hud)\.)startExpedition\(/.test(code)) || writes.test(code)) bad.push(`${f}:${i + 1}`);
    });
  }
  check(bad.length === 0, `no direct call into the game or write to it outside the command layer${bad.length ? `: ${bad.join(', ')}` : ''}`);
}

// ---- the game's arithmetic is the same on every engine (src/core/fmath.ts)
{
  const engine = /\bMath\.(sin|cos|tan|atan|atan2|asin|acos|hypot|pow|exp|log|cbrt|sinh|cosh|tanh)\(|[^*/]\*\*\s*[\w(]/;
  const bad: string[] = [];
  for (const f of [...readdirSync('src/game').map((x) => `src/game/${x}`), 'src/core/rng.ts', 'src/core/noise.ts']) {
    if (!f.endsWith('.ts')) continue;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (engine.test(l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))) bad.push(`${f}:${i + 1}`); });
  }
  check(bad.length === 0, `the game uses no trigonometry or power of the engine's own${bad.length ? `: ${bad.join(', ')}` : ''}`);
}

console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
