// Headless check of naval warfare: a shipyard set to warships builds one out of boards and iron;
// standing guard it goes for an enemy trade ship that comes near and sinks it with everyone aboard;
// it duels an enemy warship (with a save and a load in the middle of the fight); told to bombard a
// manned enemy tower on the coast it stands off beyond the archers' reach and brings it down; tower
// archers shoot at a ship that sails close under their walls; a battered ship mends at its harbour.
// Usage: npx tsx scripts/naval.ts [seed]
import { Game } from '../src/game/game';
import { WARSHIP_BOARDS, WARSHIP_HP, WARSHIP_IRON, WARSHIP_RANGE } from '../src/game/defs';
import type { BuildingType } from '../src/game/defs';
import { launchShip } from '../src/game/sea';
import { ARCHER_REACH, afloat, orderShipAttack, orderShipBombard, orderShipHome, orderShipMove, seaOf, warshipsOf } from '../src/game/naval';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import type { Building, Ship } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.length = 0; // the AI must not interfere
const w = g.world;
const P = 0, E = 1;
const hq = g.buildings.get(g.players[P].hq)!;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);
const counts: Record<string, number> = {};
const run = (x: Game, sec: number) => {
  for (let k = 0; k < sec * 4; k++) {
    x.update(0.25);
    if (x === g) for (const e of x.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    x.events.length = 0;
  }
};
const runUntil = (x: Game, sec: number, cond: () => boolean) => { for (let t = 0; t < sec * 4 && !cond(); t++) run(x, 0.25); return cond(); };

// ---- a harbour and a shipyard on the home coast, claimed by an instant tower
let site: { x: number; y: number } | null = null, bd = Infinity;
for (let y = 3; y < w.H - 6; y++) for (let x = 3; x < w.W - 6; x++) {
  if (w.region[w.idx(x, y)] !== w.region[hq.door]) continue;
  const d = Math.hypot(x - hq.cx, y - hq.cz);
  if (d >= bd) continue;
  if (g.placeError('harbour', P, x, y, true) && g.placeError('harbour', P, x, y)) continue;
  site = { x, y }; bd = d;
}
if (!site) throw new Error('no coast');
const t0 = g.addBuilding('tower_l', P, site.x - 4, site.y - 4, true);
const sol = [...g.settlers.values()].find((s) => s.owner === P && s.job === 'swordsman')!;
hq.garrison = hq.garrison.filter((id) => id !== sol.id);
sol.inside = t0.id; sol.sstate = 'garrison'; sol.home = t0.id; t0.garrison.push(sol.id); t0.occupied = true;
g.territoryDirty = true;
g.update(0.1);
const hb = g.addBuilding('harbour', P, site.x, site.y, true);
let yard: Building | null = null;
for (let r = 3; r < 14 && !yard; r++) for (let a = 0; a < 24 && !yard; a++) {
  const x = Math.round(site.x + Math.cos(a / 24 * Math.PI * 2) * r), y = Math.round(site.y + Math.sin(a / 24 * Math.PI * 2) * r);
  if (!g.placeError('shipyard', P, x, y)) yard = g.addBuilding('shipyard', P, x, y, true);
}
if (!yard) throw new Error('no shipyard site');
const sea = w.sea[hb.dock];
log('harbour', hb.x, hb.y, 'sea', sea, 'shipyard', yard.x, yard.y);

// 1. build a warship
yard.shipKind = 'war';
hq.stock.board += 40; hq.stock.iron = 6; hq.stock.hammer += 2;
const iron0 = hq.stock.iron;
check(runUntil(g, 900, () => warshipsOf(g, P) > 0), `the shipyard launched a warship (${(g.time / 60).toFixed(1)} min, ${yard.status})`);
const war = [...g.ships.values()].find((sh) => sh.owner === P && sh.kind === 'war')!;
check(!!war && war.hp === WARSHIP_HP && war.state === 'guard' && war.postX >= 0, `it stands guard off the yard (${war?.name}, ${war?.hp} hp)`);
// iron left: in the store, at the yard or in a carrier's hands (what is merely on order still lies in the store)
let ironUsed = iron0 - hq.stock.iron - yard.stock.iron;
for (const s of g.settlers.values()) if (s.carrying === 'iron') ironUsed--;
check(ironUsed === WARSHIP_IRON, `it took ${WARSHIP_BOARDS} boards and ${ironUsed} iron (${WARSHIP_IRON} expected)`);
check(![...g.ships.values()].some((sh) => sh.owner === P && sh.kind !== 'war'), 'no trade ship was built meanwhile');
yard.paused = true;
run(g, 20);

/** An enemy ship afloat on our sea, `dist` from (x, z). */
function enemyShip(kind: 'trade' | 'war', x: number, z: number, dist: number): Ship | null {
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    const px = Math.round(x + Math.cos(a) * dist), pz = Math.round(z + Math.sin(a) * dist);
    if (!w.inBounds(px, pz)) continue;
    const i = w.idx(px, pz);
    if (!w.navigable(i) || w.sea[i] !== sea || w.shoreDist[i] < 2) continue;
    const fake = { ...yard!, owner: E, dock: i, cx: px, cz: pz + 1 } as Building;
    const sh = launchShip(g, E, fake, kind);
    sh.route = null; sh.state = kind === 'war' ? 'guard' : 'idle'; sh.at = 0; sh.postX = sh.x; sh.postZ = sh.z;
    return sh;
  }
  return null;
}

// 2. an enemy trade ship with passengers comes near: the guard sinks it
const prey = enemyShip('trade', war.postX, war.postZ, 11);
if (!prey) throw new Error('no water for an enemy ship');
const pax = [0, 1, 2].map(() => {
  const s = g.addSettler(E, 'carrier', g.buildings.get(g.players[E].hq)!.door);
  s.hidden = true; s.aboard = prey.id; prey.passengers.push(s.id);
  return s;
});
prey.cargo.board = 6;
check(runUntil(g, 120, () => !g.ships.has(prey.id) || !afloat(prey)), `the warship engaged and sank the enemy trade ship (${counts.broadside ?? 0} shots, ${counts.shiphit ?? 0} hits, ${counts.seamiss ?? 0} misses)`);
check(pax.every((s) => s.dead || !g.settlers.has(s.id)), 'everyone aboard drowned');
run(g, 10);
check(!g.ships.has(prey.id), 'the wreck has gone under');
check(war.state === 'guard' && !war.target, `the warship went back to its post (${Math.hypot(war.x - war.postX, war.z - war.postZ).toFixed(1)} away)`);

// 3. a duel with an enemy warship, saved and loaded in the middle
const foe = enemyShip('war', war.x, war.z, 13);
if (!foe) throw new Error('no water for an enemy warship');
foe.state = 'hunt'; foe.target = war.id;
check(runUntil(g, 60, () => war.hp < war.maxHp && foe.hp < foe.maxHp), `both warships have taken hits (${war.hp.toFixed(0)} / ${foe.hp.toFixed(0)} hp)`);
const copy = restore(await decodeSave(await encodeSave(snapshot(g))));
copy.ai.length = 0;
const cw = copy.ships.get(war.id), cf = copy.ships.get(foe.id);
check(!!cw && !!cf && cw.kind === 'war' && cf.state === 'hunt' && cf.target === war.id && Math.abs(cw.hp - war.hp) < 1e-9, 'the saved game keeps the fight, the orders and the damage');
check(runUntil(g, 240, () => !afloat(war) || !afloat(foe)), `one of them went down (ours ${afloat(war) ? `${war.hp.toFixed(0)} hp` : 'sunk'}, theirs ${afloat(foe) ? `${foe.hp.toFixed(0)} hp` : 'sunk'})`);
check(runUntil(copy, 240, () => [cw!, cf!].some((sh) => !copy.ships.has(sh.id) || !afloat(sh))), 'and in the restored game too');
// an old save without warship fields: ships get their defaults
const old = snapshot(g);
for (const sh of old.ships) for (const k of ['kind', 'hp', 'maxHp', 'target', 'postX', 'postZ', 'reload', 'fired', 'aim', 'hitT', 'sinkT', 'scanT', 'routeT']) delete (sh as unknown as Record<string, unknown>)[k];
const oldG = restore(old);
check([...oldG.ships.values()].every((sh) => sh.kind === 'trade' && sh.hp === sh.maxHp && sh.hp > 0), 'ships from an older save come back as sound trade ships');

// our side needs a warship for the rest: build a fresh one if ours was lost
let navy: Ship | undefined = afloat(war) && g.ships.has(war.id) ? war : undefined;
if (!navy) {
  navy = launchShip(g, P, yard, 'war');
  run(g, 5);
}
navy.hp = navy.maxHp;

// 4. bombard a manned enemy tower on the coast
function coastalTower(garrison: number, job: 'swordsman' | 'bowman'): Building | null {
  let best: { x: number; y: number } | null = null, bd2 = Infinity;
  w.forRadius(navy!.x, navy!.z, 40, (i, x, y, d2) => {
    if (d2 >= bd2 || d2 < 12 * 12 || w.owner[i] >= 0) return;
    const an = g.anchorFor('tower_s', x, y);
    if (g.placeError('tower_s', E, an.x, an.y, true) !== null) return;
    // near enough to the water for a ship to reach it, owned by nobody around
    let water = false, claimed = false;
    w.forRadius(an.x + 0.5, an.y + 0.5, 6, (j) => { if (w.navigable(j) && w.sea[j] === sea) water = true; if (w.owner[j] >= 0) claimed = true; });
    if (!water || claimed) return;
    bd2 = d2; best = an;
  });
  if (!best) return null;
  const b = best as { x: number; y: number };
  const t = g.addBuilding('tower_s', E, b.x, b.y, true);
  for (let k = 0; k < garrison; k++) {
    const d = g.addSettler(E, job, t.door);
    d.hidden = true; d.inside = t.id; d.sstate = 'garrison'; d.home = t.id;
    t.garrison.push(d.id);
  }
  t.occupied = true;
  t.desiredSoldiers = garrison;
  g.territoryDirty = true;
  run(g, 1);
  return t;
}
const T = coastalTower(2, 'bowman');
if (!T) { console.log('(no coast for an enemy tower)'); }
else {
  check(orderShipBombard(g, P, [navy.id], T) === 1, `ordered to bombard a manned tower ${Math.hypot(T.cx - navy.x, T.cz - navy.z).toFixed(0)} away`);
  counts.siegehit = 0;
  let closest = Infinity;
  const ok = runUntil(g, 300, () => { if (navy!.reload > 3.5) closest = Math.min(closest, Math.hypot(T.cx - navy!.x, T.cz - navy!.z)); return !g.buildings.has(T.id) || T.state === 'burning'; });
  check(ok, `the tower fell to the warship (${counts.siegehit} hits, ship ${navy.hp.toFixed(0)}/${navy.maxHp} hp)`);
  check(closest <= WARSHIP_RANGE + 0.01, `it fired from within reach (closest shot at ${closest.toFixed(1)}, reach ${WARSHIP_RANGE}, archers ${ARCHER_REACH})`);
  run(g, 5);
  check(navy.state === 'guard', 'it stands guard where it was afterwards');
}

// 5. archers shoot at a ship close under their walls
const T2 = coastalTower(3, 'bowman');
if (!T2) console.log('(no coast for a second tower)');
else {
  let spot = -1;
  w.forRadius(T2.cx, T2.cz, ARCHER_REACH - 1.5, (i) => { if (spot < 0 && w.navigable(i) && w.sea[i] === sea) spot = i; });
  const victim = enemyShip('trade', w.nx(spot), w.ny(spot), 0);
  if (spot < 0 || !victim) console.log('(no water within bowshot of the tower)');
  else {
    victim.owner = P; // one of ours this time, sitting under the enemy's walls
    const h0 = victim.hp;
    counts.bow = 0;
    check(runUntil(g, 40, () => victim.hp < h0), `the tower's archers hit a ship close by (${counts.bow} arrows, ${victim.hp.toFixed(0)}/${h0} hp)`);
    // 6. a battered ship mends, quickly at its harbour
    victim.hp = victim.maxHp * 0.3;
    victim.hitT = -99;
    victim.x = hb.cx; victim.z = hb.cz; // pretend it limped home
    const ow = navy;
    ow.hp = ow.maxHp * 0.5; ow.hitT = -99;
    check(orderShipHome(g, P, [ow.id], hb) === 1, 'the warship is sent home to mend');
    const h1 = ow.hp;
    check(runUntil(g, 120, () => ow.hp >= ow.maxHp - 1e-6), `moored, it mended (${h1.toFixed(0)} → ${ow.hp.toFixed(0)} hp, ${ow.at === hb.id ? 'at the harbour' : 'at sea'})`);
  }
}

// 7. orders: a move to open water, and a hunt that ends with its prey gone
const mv = orderShipMove(g, P, [navy.id], navy.x + 6, navy.z);
check(mv <= 1, `a move order is taken or refused cleanly (${mv})`);
const far = enemyShip('trade', navy.x, navy.z, 25);
if (far) {
  check(orderShipAttack(g, P, [navy.id], far) === 1, 'sent to hunt a distant enemy ship');
  check(runUntil(g, 200, () => !afloat(far) || !g.ships.has(far.id)), `it ran it down and sank it (${navy.state})`);
  run(g, 3);
  check(navy.state === 'guard', 'and stood guard afterwards');
}
check(seaOf(g, navy) === sea, 'it never left its sea');

log('events', JSON.stringify({ broadside: counts.broadside, shiphit: counts.shiphit, seamiss: counts.seamiss, sinking: counts.sinking, wreck: counts.wreck, siegehit: counts.siegehit }));
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
