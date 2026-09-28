// Seafaring: harbours and shipyards, sailing ships, overseas logistics and colony expeditions.
//
// Every landmass is its own little economy (world.region). Carriers never cross water; instead
// harbours gather what another landmass lacks, ships carry the goods and settlers over, and the
// receiving harbour hands them to that island's carriers like any storehouse would.
import {
  BUILDINGS, GOODS, Good, JOB_TOOL, Job, MAX_SHIPS, SHIP_BOARDS, SHIP_CARGO, SHIP_PASSENGERS, emptyStock,
} from './defs';
import type { Game } from './game';
import { A, abortPlan, claim, enter, plan } from './settlers';
import type { Building, Expedition, SeaOrder, Settler, Ship } from './types';
import { WATER_LEVEL } from './world';
import { isSoldier } from './military';
import { Need, availableAt, needsOf } from './economy';

const SHIP_SPEED = 2.7; // nodes per second at full sail
/** Ship models are drawn at this scale; deck positions of passengers and cargo follow it. */
export const SHIP_SCALE = 1.25;
const SHIP_NAMES = [
  'Seagull', 'Fortuna', 'Albatross', 'Wavecrest', 'Northwind', 'Mermaid', 'Swift', 'Morning Star', 'Pelican', 'Tern',
  'Sea Rose', 'Bold Heart', 'Kingfisher', 'Dolphin', 'Gale', 'Osprey', 'Harvest Moon', 'Cormorant', 'Silver Fin', 'Brave Oak',
];

export function regionOf(g: Game, b: Building) {
  return g.world.region[b.door];
}

export function isHarbour(b: Building) {
  return b.type === 'harbour';
}

function harbourAlive(g: Game, id: number, owner: number): Building | null {
  const b = g.buildings.get(id);
  return b && b.type === 'harbour' && b.state === 'done' && b.owner === owner ? b : null;
}

// ------------------------------------------------------------------ docks
/** Nearest navigable sea node beside a footprint, or -1 if the site is not on the coast. */
export function findDock(g: Game, size: number, x: number, y: number): number {
  const w = g.world;
  const cx = x + (size - 1) / 2, cy = y + (size - 1) / 2;
  let best = -1, bd = Infinity;
  w.forRadius(cx, cy, size / 2 + 3.4, (i, _x, _y, d2) => {
    if (!w.navigable(i)) return;
    if (d2 < bd) { bd = d2; best = i; }
  });
  return best;
}

/** Mooring spot for the k-th ship at a dock: spread out along the shore so hulls don't overlap. */
export function berthPos(g: Game, b: Building, k: number): { x: number; z: number } {
  const w = g.world;
  const dx = w.nx(b.dock), dz = w.ny(b.dock);
  const ax = dx - b.cx, az = dz - b.cz;
  const l = Math.hypot(ax, az) || 1;
  const px = -az / l, pz = ax / l;
  // alongside the jetty head, then further out along the shore
  const spots: [number, number][] = k === 0
    ? [[0.95, -0.3], [-0.95, -0.3], [0.95, 0.3], [-0.95, 0.3], [0, 1.4]]
    : [[k * 1.7, 0.6], [-k * 1.7, 0.6], [k * 1.7, 1.4], [-k * 1.7, 1.4]];
  for (const [off, out] of spots) {
    const x = dx + px * off + (ax / l) * out, z = dz + pz * off + (az / l) * out;
    const xi = Math.round(x), zi = Math.round(z);
    if (w.inBounds(xi, zi) && w.navigable(w.idx(xi, zi)) && w.sea[w.idx(xi, zi)] === w.sea[b.dock]) return { x, z };
  }
  return { x: dx + (ax / l) * 0.8, z: dz + (az / l) * 0.8 };
}

// ------------------------------------------------------------------ routes
function nearestNavigable(g: Game, x: number, z: number, sea = 0): number {
  const w = g.world;
  const i0 = w.idx(Math.max(0, Math.min(w.W - 1, Math.round(x))), Math.max(0, Math.min(w.H - 1, Math.round(z))));
  if (w.navigable(i0) && (!sea || w.sea[i0] === sea)) return i0;
  let best = -1, bd = Infinity;
  w.forRadius(x, z, 5, (i, _x, _y, d2) => {
    if (!w.navigable(i) || (sea && w.sea[i] !== sea)) return;
    if (d2 < bd) { bd = d2; best = i; }
  });
  return best;
}

function clearLine(g: Game, ax: number, az: number, bx: number, bz: number, minShore: number) {
  const w = g.world;
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.35));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = Math.round(ax + (bx - ax) * t), z = Math.round(az + (bz - az) * t);
    if (!w.inBounds(x, z)) return false;
    const i = w.idx(x, z);
    if (!w.navigable(i) || w.shoreDist[i] < minShore) return false;
  }
  return true;
}

/** Smoothed polyline [x0,z0,x1,z1,...] from (x,z) to a water node, or null if unreachable. */
export function seaRoute(g: Game, x: number, z: number, tx: number, tz: number): number[] | null {
  const w = g.world;
  const start = nearestNavigable(g, x, z);
  const goalN = nearestNavigable(g, tx, tz, start >= 0 ? w.sea[start] : 0);
  if (start < 0 || goalN < 0) return null;
  const nodes = g.path.findSea(start, goalN);
  if (!nodes) return null;
  const pts: number[] = [x, z];
  for (const n of nodes) pts.push(w.nx(n), w.ny(n));
  pts.push(tx, tz);
  // string pulling: skip waypoints while the straight line stays in open water
  const out: number[] = [pts[0], pts[1]];
  let i = 0;
  const count = pts.length / 2;
  while (i < count - 1) {
    let j = count - 1;
    for (; j > i + 1; j--) {
      const nearEnd = j >= count - 3 || i <= 1;
      if (clearLine(g, pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], nearEnd ? 1 : 2)) break;
    }
    out.push(pts[j * 2], pts[j * 2 + 1]);
    i = j;
  }
  // round the corners (Chaikin), keeping the result in open water
  let path = out;
  for (let it = 0; it < 2; it++) {
    if (path.length < 6) break;
    const sm: number[] = [path[0], path[1]];
    for (let k = 0; k < path.length / 2 - 1; k++) {
      const ax = path[k * 2], az = path[k * 2 + 1], bx = path[k * 2 + 2], bz = path[k * 2 + 3];
      if (k > 0) sm.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25);
      if (k < path.length / 2 - 2) sm.push(ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
    }
    sm.push(path[path.length - 2], path[path.length - 1]);
    let ok = true;
    for (let k = 0; k < sm.length / 2 - 1 && ok; k++) ok = clearLine(g, sm[k * 2], sm[k * 2 + 1], sm[k * 2 + 2], sm[k * 2 + 3], 0);
    if (!ok) break;
    path = sm;
  }
  return path;
}

function routeLength(r: number[]) {
  let L = 0;
  for (let k = 0; k < r.length / 2 - 1; k++) L += Math.hypot(r[k * 2 + 2] - r[k * 2], r[k * 2 + 3] - r[k * 2 + 1]);
  return L;
}

/** Point and tangent at arc length s along a polyline. */
function routeAt(r: number[], s: number): { x: number; z: number; tx: number; tz: number } {
  let acc = 0;
  const n = r.length / 2 - 1;
  for (let k = 0; k < n; k++) {
    const ax = r[k * 2], az = r[k * 2 + 1], bx = r[k * 2 + 2], bz = r[k * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (acc + L >= s || k === n - 1) {
      const t = L > 1e-6 ? Math.min(1, Math.max(0, (s - acc) / L)) : 1;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / (L || 1), tz: (bz - az) / (L || 1) };
    }
    acc += L;
  }
  return { x: r[r.length - 2], z: r[r.length - 1], tx: 0, tz: 1 };
}

function sailTo(g: Game, sh: Ship, x: number, z: number): boolean {
  const r = seaRoute(g, sh.x, sh.z, x, z);
  if (!r) return false;
  sh.route = r;
  sh.routeS = 0;
  sh.routeLen = routeLength(r);
  sh.at = 0;
  return true;
}

function sailToBuilding(g: Game, sh: Ship, b: Building): boolean {
  let k = 0;
  for (const o of g.ships.values()) if (o.id !== sh.id && (o.at === b.id || o.to === b.id || o.from === b.id) && o.owner === sh.owner) k++;
  sh.berth = k % 5;
  const p = berthPos(g, b, sh.berth);
  return sailTo(g, sh, p.x, p.z);
}

// ------------------------------------------------------------------ ships
export function launchShip(g: Game, owner: number, yard: Building): Ship {
  const w = g.world;
  let n = 0;
  for (const s of g.ships.values()) if (s.owner === owner) n++;
  const ang = Math.atan2(w.nx(yard.dock) - yard.cx, w.ny(yard.dock) - yard.cz);
  const sh: Ship = {
    id: g.id(), owner, name: SHIP_NAMES[(n * 7 + owner * 3 + g.ships.size) % SHIP_NAMES.length],
    x: w.nx(yard.dock), z: w.ny(yard.dock), heading: ang, speed: 0,
    route: null, routeS: 0, routeLen: 0, state: 'idle', at: yard.id, from: 0, to: 0, timer: 0,
    cargo: emptyStock(), lots: [], passengers: [], expedition: 0, berth: 0, born: g.time, wait: 0,
  };
  g.ships.set(sh.id, sh);
  g.emit({ type: 'launch', x: sh.x, z: sh.z, owner, s: sh.id });
  g.message(owner, `The ship “${sh.name}” has been launched`, sh.x, sh.z, 'good');
  // sail to the nearest harbour to await orders
  const hb = nearestHarbourBySea(g, owner, sh);
  if (hb) sailToBuilding(g, sh, hb);
  return sh;
}

function nearestHarbourBySea(g: Game, owner: number, sh: Ship): Building | null {
  const w = g.world;
  const i = nearestNavigable(g, sh.x, sh.z);
  const sea = i >= 0 ? w.sea[i] : 0;
  let best: Building | null = null, bd = Infinity;
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || b.type !== 'harbour' || b.state !== 'done' || b.dock < 0 || w.sea[b.dock] !== sea) continue;
    const d = (b.cx - sh.x) ** 2 + (b.cz - sh.z) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export function cargoCount(sh: Ship) {
  let n = 0;
  for (const gd of GOODS) n += sh.cargo[gd];
  return n;
}

function moveShip(g: Game, sh: Ship, dt: number) {
  if (!sh.route) {
    sh.speed = Math.max(0, sh.speed - dt * 1.5);
    return false;
  }
  const remaining = sh.routeLen - sh.routeS;
  const target = Math.min(SHIP_SPEED, 0.35 + remaining * 0.55);
  sh.speed += (target - sh.speed) * Math.min(1, dt * (target > sh.speed ? 0.6 : 2));
  sh.routeS = Math.min(sh.routeLen, sh.routeS + sh.speed * dt);
  const p = routeAt(sh.route, sh.routeS);
  const ahead = routeAt(sh.route, Math.min(sh.routeLen, sh.routeS + 1.2));
  sh.x = p.x;
  sh.z = p.z;
  const hx = ahead.x - p.x, hz = ahead.z - p.z;
  if (Math.hypot(hx, hz) > 0.05) {
    const want = Math.atan2(hx, hz);
    let d = want - sh.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sh.heading += d * Math.min(1, dt * 1.6);
  }
  if (sh.routeS >= sh.routeLen - 0.02) {
    sh.route = null;
    return true;
  }
  return false;
}

/** Passengers stand on deck: keep their positions on the ship for rendering, picking and fog. */
function syncPassengers(g: Game, sh: Ship) {
  const c = Math.cos(sh.heading), s = Math.sin(sh.heading);
  sh.passengers = sh.passengers.filter((id) => g.settlers.has(id));
  sh.passengers.forEach((id, k) => {
    const p = g.settlers.get(id)!;
    const row = Math.floor(k / 2), side = k % 2 ? 1 : -1;
    const lx = side * 0.16 * SHIP_SCALE, lz = (0.55 - row * 0.28) * SHIP_SCALE;
    p.x = sh.x + lx * c + lz * s;
    p.z = sh.z - lx * s + lz * c;
    p.heading = sh.heading + (k % 3 === 0 ? Math.PI * 0.5 * side : 0);
    p.node = g.world.idx(Math.max(0, Math.min(g.world.W - 1, Math.round(p.x))), Math.max(0, Math.min(g.world.H - 1, Math.round(p.z))));
  });
}

function board(g: Game, s: Settler, sh: Ship) {
  s.actions.length = 0;
  s.onAbort = null; // drop the waiting plan without cancelling the voyage
  s.path = null;
  s.next = -1;
  s.inside = 0;
  s.hidden = true;
  s.aboard = sh.id;
  s.anim = 'idle';
  s.task = `Sailing on the “${sh.name}”`;
  sh.passengers.push(s.id);
}

function goAshore(g: Game, s: Settler, node: number) {
  s.aboard = 0;
  s.hidden = false;
  s.inside = 0;
  s.node = node;
  s.next = -1;
  s.path = null;
  s.t = 0;
  s.voyage = 0;
  s.voyageFrom = 0;
  s.task = '';
  s.idle = s.job === 'carrier';
  if (isSoldier(s)) { s.sstate = 'idle'; s.home = 0; }
  else s.home = 0;
  g.syncPos(s);
  g.emit({ type: 'ashore', x: s.x, z: s.z, owner: s.owner });
}

function updateShip(g: Game, sh: Ship, dt: number) {
  const arrived = moveShip(g, sh, dt);
  syncPassengers(g, sh);
  switch (sh.state) {
    case 'idle': {
      if (sh.at) {
        const b = g.buildings.get(sh.at);
        if (!b || b.owner !== sh.owner || b.state === 'burning') sh.at = 0;
      }
      if (arrived) {
        const hb = nearestHarbourBySea(g, sh.owner, sh);
        if (hb && Math.hypot(hb.cx - sh.x, hb.cz - sh.z) < hb.size + 5) sh.at = hb.id;
      }
      // unloaded cargo from an aborted trip goes to the nearest harbour
      if (!sh.route && (cargoCount(sh) || sh.passengers.length)) {
        const hb = nearestHarbourBySea(g, sh.owner, sh);
        if (hb) { sh.to = hb.id; sh.state = 'toUnload'; sailToBuilding(g, sh, hb); }
      }
      break;
    }
    case 'toLoad': {
      const b = harbourAlive(g, sh.from, sh.owner);
      if (!b) { abortTrip(g, sh); break; }
      if (!arrived && !sh.route && !sailToBuilding(g, sh, b) && Math.hypot(b.cx - sh.x, b.cz - sh.z) > b.size + 4) { abortTrip(g, sh); break; }
      if (arrived) {
        sh.state = 'loading';
        sh.at = b.id;
        sh.timer = 0;
        sh.wait = 0;
        g.emit({ type: 'moor', x: sh.x, z: sh.z, owner: sh.owner, s: sh.id });
      }
      break;
    }
    case 'loading': loadStep(g, sh, dt); break;
    case 'toUnload': {
      const b = harbourAlive(g, sh.to, sh.owner);
      if (!b) {
        // destination lost: head for another harbour on this sea
        const hb = nearestHarbourBySea(g, sh.owner, sh);
        if (hb && hb.id !== sh.to) { sh.to = hb.id; sailToBuilding(g, sh, hb); }
        else { sh.state = 'idle'; sh.route = null; }
        break;
      }
      if (arrived || !sh.route) {
        sh.state = 'unloading';
        sh.at = b.id;
        sh.timer = 0;
        g.emit({ type: 'moor', x: sh.x, z: sh.z, owner: sh.owner, s: sh.id });
      }
      break;
    }
    case 'unloading': unloadStep(g, sh, dt); break;
    case 'expedition': {
      const ex = g.expeditions.find((e) => e.id === sh.expedition);
      if (!ex) { sh.state = 'idle'; break; }
      if (arrived || !sh.route) landExpedition(g, sh, ex);
      break;
    }
    case 'scouting': {
      if (arrived || !sh.route) {
        sh.state = 'idle';
        const hb = nearestHarbourBySea(g, sh.owner, sh);
        if (hb && Math.hypot(hb.cx - sh.x, hb.cz - sh.z) < hb.size + 5) sh.at = hb.id;
        g.message(sh.owner, `The “${sh.name}” is back from scouting`, sh.x, sh.z, 'good');
      }
      break;
    }
  }
}

function abortTrip(g: Game, sh: Ship) {
  sh.state = 'idle';
  sh.route = null;
  sh.from = 0;
  sh.to = 0;
}

function waitingAt(g: Game, hb: Building, to: number): Settler[] {
  const out: Settler[] = [];
  for (const s of g.settlers.values()) {
    if (s.owner !== hb.owner || s.dead || s.aboard || s.inside !== hb.id || s.voyageFrom !== hb.id || s.voyage !== to) continue;
    out.push(s);
  }
  return out;
}

function loadStep(g: Game, sh: Ship, dt: number) {
  const hb = harbourAlive(g, sh.from, sh.owner);
  if (!hb) { abortTrip(g, sh); return; }
  sh.timer += dt;
  if (sh.timer < 0.35) return;
  sh.timer -= 0.35;
  const ex = sh.expedition ? g.expeditions.find((e) => e.id === sh.expedition) : null;
  if (ex) {
    // an expedition takes everything it needs in one go
    for (const s of waitingAt(g, hb, -ex.id)) board(g, s, sh);
    for (const gd of ['board', 'stone'] as const) {
      const n = Math.min(ex.goods[gd] - sh.cargo[gd], hb.stock[gd] - hb.outgoing[gd]);
      if (n > 0) { hb.stock[gd] -= n; sh.cargo[gd] += n; }
    }
    ex.state = 'sailing';
    ex.ship = sh.id;
    sh.state = 'expedition';
    const w = g.world;
    if (!sailTo(g, sh, w.nx(ex.landing), w.ny(ex.landing))) { failExpedition(g, sh, ex, 'The expedition found no sea route'); return; }
    g.emit({ type: 'setsail', x: sh.x, z: sh.z, owner: sh.owner, s: sh.id });
    g.message(sh.owner, `The “${sh.name}” sets sail with an expedition`, sh.x, sh.z, 'good');
    return;
  }
  // passengers first, then one good per step so the deck fills up visibly
  let did = false;
  if (sh.passengers.length < SHIP_PASSENGERS) {
    const p = waitingAt(g, hb, sh.to)[0];
    if (p) { board(g, p, sh); did = true; }
  }
  if (!did && cargoCount(sh) < SHIP_CARGO) {
    for (const o of g.seaOrders) {
      if (o.owner !== sh.owner || o.from !== hb.id || o.to !== sh.to) continue;
      const rem = o.n - o.loaded - o.delivered;
      if (rem <= 0 || hb.stock[o.good] - hb.outgoing[o.good] <= 0) continue;
      hb.stock[o.good]--;
      sh.cargo[o.good]++;
      o.loaded++;
      o.t = g.time;
      const lot = sh.lots.find((l) => l.order === o.id);
      if (lot) lot.n++; else sh.lots.push({ order: o.id, good: o.good, n: 1 });
      did = true;
      break;
    }
  }
  if (did) { sh.wait = 0; return; }
  // nothing more to take on: wait a moment for goods still on their way, then leave
  sh.wait++;
  const incoming = GOODS.some((gd) => (hb.seaWant?.[gd] ?? 0) > 0 && hb.incoming[gd] > 0);
  if (sh.wait < (incoming ? 40 : 6)) return;
  sh.wait = 0;
  const dest = harbourAlive(g, sh.to, sh.owner);
  if (!dest || (!cargoCount(sh) && !sh.passengers.length)) { abortTrip(g, sh); sh.at = hb.id; return; }
  sh.state = 'toUnload';
  if (!sailToBuilding(g, sh, dest)) { sh.state = 'unloading'; return; }
  g.emit({ type: 'setsail', x: sh.x, z: sh.z, owner: sh.owner, s: sh.id });
}

function unloadStep(g: Game, sh: Ship, dt: number) {
  const hb = harbourAlive(g, sh.to, sh.owner) ?? harbourAlive(g, sh.at, sh.owner);
  if (!hb) { sh.state = 'idle'; return; }
  sh.timer += dt;
  if (sh.timer < 0.3) return;
  sh.timer -= 0.3;
  if (sh.passengers.length) {
    const s = g.settlers.get(sh.passengers.shift()!);
    if (s) goAshore(g, s, hb.door);
    return;
  }
  for (const gd of GOODS) {
    if (sh.cargo[gd] <= 0) continue;
    sh.cargo[gd]--;
    hb.stock[gd]++;
    const lot = sh.lots.find((l) => l.good === gd && l.n > 0);
    if (lot) {
      lot.n--;
      const o = g.seaOrders.find((x) => x.id === lot.order);
      if (o) { o.loaded = Math.max(0, o.loaded - 1); o.delivered++; o.t = g.time; }
    }
    return;
  }
  // all ashore
  sh.lots = [];
  sh.state = 'idle';
  sh.at = hb.id;
  sh.from = 0;
  sh.to = 0;
  g.emit({ type: 'unloaded', x: sh.x, z: sh.z, owner: sh.owner, s: sh.id });
}

// ------------------------------------------------------------------ shipyard
export function shipwrightThink(g: Game, s: Settler, b: Building) {
  const w = g.world;
  let fleet = 0;
  for (const sh of g.ships.values()) if (sh.owner === b.owner) fleet++;
  if (fleet >= MAX_SHIPS) { b.status = 'The fleet is complete'; b.working = false; plan(s, [A.wait(5)]); return; }
  if (b.stock.board <= 0 && b.shipProgress <= 0) { b.status = 'Waiting for boards'; b.working = false; plan(s, [A.wait(3)]); return; }
  if (b.stock.board <= 0) { b.status = 'Waiting for boards'; b.working = false; plan(s, [A.wait(3)]); return; }
  b.status = `Building a ship (${Math.round(b.shipProgress * 100)}%)`;
  b.working = true;
  // work from the footprint edge closest to the slipway
  const dx = w.nx(b.dock), dz = w.ny(b.dock);
  let spot = b.door, bd = Infinity;
  for (let yy = b.y - 1; yy <= b.y + b.size; yy++)
    for (let xx = b.x - 1; xx <= b.x + b.size; xx++) {
      if (!w.inBounds(xx, yy)) continue;
      const i = w.idx(xx, yy);
      if (!w.walkable(i) || w.building[i]) continue;
      const d = (xx - dx) ** 2 + (yy - dz) ** 2;
      if (d < bd) { bd = d; spot = i; }
    }
  let took = false;
  plan(s, [
    A.do(() => {
      if (!g.buildings.has(b.id) || b.stock.board <= 0) return false;
      b.stock.board--;
      took = true;
      s.inside = 0;
      s.hidden = false;
      s.carrying = 'board';
    }),
    A.walk(spot),
    A.do(() => { s.carrying = null; }),
    A.anim('hammer', 5.2, b.dock, (t) => { if (Math.floor(t * 2.2) !== Math.floor((t - 0.05) * 2.2)) g.emit({ type: 'hammer', x: s.x, z: s.z }); }),
    A.do(() => {
      if (!g.buildings.has(b.id) || b.state !== 'done') return false;
      took = false;
      b.shipProgress = Math.min(1, b.shipProgress + 1 / SHIP_BOARDS);
      b.prodCount++;
      b.lastProd = g.time;
      if (b.shipProgress >= 1 - 1e-6) {
        b.shipProgress = 0;
        launchShip(g, b.owner, b);
      }
    }),
    A.walk(b.door),
    A.do(() => { if (g.buildings.has(b.id)) enter(g, s, b); }),
    A.wait(1.5),
  ], () => {
    if (took && g.buildings.has(b.id)) b.stock.board++;
    s.carrying = null;
  });
}

// ------------------------------------------------------------------ voyages (settlers)
export function cancelVoyage(g: Game, s: Settler) {
  if (!s.voyage && !s.voyageFrom) return;
  const hb = g.buildings.get(s.voyageFrom);
  s.voyage = 0;
  s.voyageFrom = 0;
  s.task = '';
  if (isSoldier(s)) { if (s.sstate === 'ship') s.sstate = 'idle'; s.home = 0; }
  else if (hb && s.home === hb.id) s.home = 0;
  if (s.inside && hb && s.inside === hb.id) {
    s.inside = 0;
    s.hidden = false;
    s.node = hb.door;
    g.syncPos(s);
  }
}

/** Send a settler to wait in harbour `from` for a ship to `to` (a harbour id, or -expedition id). */
function sendToHarbour(g: Game, s: Settler, from: Building, to: number) {
  claim(g, s);
  s.voyage = to;
  s.voyageFrom = from.id;
  s.idle = false;
  if (isSoldier(s)) { s.sstate = 'ship'; s.home = 0; }
  else if (s.job !== 'carrier') s.home = from.id; // keeps other jobs from claiming them
  s.task = 'Walking to the harbour';
  plan(s, [
    A.walk(from.door),
    A.do(() => {
      if (!harbourAlive(g, from.id, s.owner)) return false;
      enter(g, s, from);
      s.task = 'Waiting for a ship';
    }),
    A.wait(1e9),
  ], () => cancelVoyage(g, s));
}

// ------------------------------------------------------------------ expeditions
export interface ColonySite { x: number; y: number; landing: number; shore: number }

/** Where an expedition from `from` could found a harbour near (px, pz), or an error. */
export function colonySite(g: Game, owner: number, from: Building, px: number, pz: number): ColonySite | string {
  const w = g.world;
  if (from.dock < 0) return 'This harbour has no dock';
  const sea = w.sea[from.dock];
  let best: ColonySite | null = null, bd = Infinity;
  let why = 'Pick a spot on an unclaimed coast';
  const size = BUILDINGS.harbour.size;
  w.forRadius(px, pz, 6, (i, x, y, d2) => {
    if (d2 >= bd) return;
    const a = g.anchorFor('harbour', x, y);
    const err = g.placeError('harbour', owner, a.x, a.y, true);
    if (err) { if (d2 < 4) why = err === 'Outside your territory' ? 'That coast is already claimed' : err; return; }
    const dock = findDock(g, size, a.x, a.y);
    if (dock < 0 || w.sea[dock] !== sea) { if (d2 < 4) why = 'Ships cannot reach that coast from here'; return; }
    // leave room: the colony claims land around itself
    let foreign = false;
    w.forRadius(a.x + 1, a.y + 1, 5, (j) => { if (w.owner[j] >= 0 && w.owner[j] !== owner) foreign = true; });
    if (foreign) { if (d2 < 4) why = 'Too close to a foreign border'; return; }
    bd = d2;
    best = { x: a.x, y: a.y, landing: dock, shore: g.doorOf(size, a.x, a.y) };
  });
  if (!best) return why;
  const b = best as ColonySite;
  if (w.region[b.shore] === regionOf(g, from) && w.owner[b.shore] === owner) return 'That coast is already yours';
  return b;
}

export function startExpedition(g: Game, owner: number, from: Building, site: ColonySite): Expedition {
  const cost = BUILDINGS.harbour.cost;
  const ex: Expedition = {
    id: g.id(), owner, from: from.id, x: site.x, y: site.y, landing: site.landing, shore: site.shore,
    state: 'gathering', ship: 0, goods: { board: cost.board, stone: cost.stone },
    people: { builder: 1, digger: 1, soldier: 1, carrier: 2 }, t: g.time,
  };
  g.expeditions.push(ex);
  g.emit({ type: 'expedition', owner, x: g.world.nx(site.shore), z: g.world.ny(site.shore) });
  return ex;
}

export function cancelExpedition(g: Game, ex: Expedition) {
  if (ex.state !== 'gathering') return;
  g.expeditions = g.expeditions.filter((e) => e !== ex);
  for (const s of g.settlers.values()) if (s.voyage === -ex.id) { abortPlan(g, s); cancelVoyage(g, s); }
}

function failExpedition(g: Game, sh: Ship, ex: Expedition, why: string) {
  ex.state = 'failed';
  g.expeditions = g.expeditions.filter((e) => e !== ex);
  sh.expedition = 0;
  // sail everyone and everything back home
  const hb = harbourAlive(g, ex.from, sh.owner) ?? nearestHarbourBySea(g, sh.owner, sh);
  for (const id of sh.passengers) { const s = g.settlers.get(id); if (s) s.voyage = hb ? hb.id : 0; }
  if (hb) { sh.to = hb.id; sh.state = 'toUnload'; sailToBuilding(g, sh, hb); } else sh.state = 'idle';
  g.message(sh.owner, why, sh.x, sh.z, 'bad');
}

function landExpedition(g: Game, sh: Ship, ex: Expedition) {
  const w = g.world;
  const err = g.placeError('harbour', sh.owner, ex.x, ex.y, true);
  if (err) { failExpedition(g, sh, ex, `The expedition could not land: ${err.toLowerCase()}`); return; }
  const b = g.addBuilding('harbour', sh.owner, ex.x, ex.y);
  b.colony = true;
  // the materials are unloaded straight onto the site
  b.delivered.board = Math.min(b.def.cost.board, sh.cargo.board);
  b.delivered.stone = Math.min(b.def.cost.stone, sh.cargo.stone);
  sh.cargo.board -= b.delivered.board;
  sh.cargo.stone -= b.delivered.stone;
  for (const id of sh.passengers) {
    const s = g.settlers.get(id);
    if (s) goAshore(g, s, ex.shore);
  }
  sh.passengers = [];
  sh.expedition = 0;
  sh.state = 'idle';
  ex.state = 'landed';
  g.expeditions = g.expeditions.filter((e) => e !== ex);
  g.territoryDirty = true;
  g.emit({ type: 'landed', b: b.id, x: b.cx, z: b.cz, owner: sh.owner });
  g.message(sh.owner, 'The expedition has landed — a colony harbour is being built', b.cx, b.cz, 'good');
  void w;
}

/** A ship sails a loop through unexplored waters and back. */
export function scoutSeas(g: Game, owner: number, from: Building): string | null {
  const w = g.world;
  let sh: Ship | null = null, bd = Infinity;
  for (const s of g.ships.values()) {
    if (s.owner !== owner || s.state !== 'idle' || cargoCount(s) || s.passengers.length) continue;
    const d = (s.x - from.cx) ** 2 + (s.z - from.cz) ** 2;
    if (d < bd) { bd = d; sh = s; }
  }
  if (!sh) return 'No idle ship to send';
  const sea = w.sea[from.dock];
  // far, unexplored, open water; visited as a loop
  const cands: number[] = [];
  for (let k = 0; k < 400 && cands.length < 60; k++) {
    const i = g.rng.int(0, w.N);
    if (w.sea[i] !== sea || !w.navigable(i) || w.shoreDist[i] < 3) continue;
    cands.push(i);
  }
  const score = (i: number) => {
    let unex = 0;
    w.forRadius(w.nx(i), w.ny(i), 7, (j) => { if (!w.explored[j]) unex++; });
    return unex + Math.hypot(w.nx(i) - from.cx, w.ny(i) - from.cz) * 0.3;
  };
  cands.sort((a, b) => score(b) - score(a));
  const pts = cands.slice(0, 4);
  if (!pts.length) return 'There is no open sea to explore';
  const route: number[] = [];
  let cx = sh.x, cz = sh.z;
  const left = [...pts];
  while (left.length) {
    left.sort((a, b) => Math.hypot(w.nx(a) - cx, w.ny(a) - cz) - Math.hypot(w.nx(b) - cx, w.ny(b) - cz));
    const n = left.shift()!;
    const r = seaRoute(g, cx, cz, w.nx(n), w.ny(n));
    if (!r) continue;
    route.push(...(route.length ? r.slice(2) : r));
    cx = w.nx(n); cz = w.ny(n);
  }
  const bp = berthPos(g, from, 0);
  const back = seaRoute(g, cx, cz, bp.x, bp.z);
  if (back) route.push(...(route.length ? back.slice(2) : back));
  if (route.length < 4) return 'There is no open sea to explore';
  sh.route = route;
  sh.routeS = 0;
  sh.routeLen = routeLength(route);
  sh.state = 'scouting';
  sh.at = 0;
  g.emit({ type: 'setsail', x: sh.x, z: sh.z, owner, s: sh.id });
  return null;
}

// ------------------------------------------------------------------ planning
interface RegionInfo {
  region: number;
  harbour: Building;
  need: Record<Good, number>;
  avail: Record<Good, number>;
  sites: number;
  levelling: number;
  buildings: number;
  idleCarriers: Settler[];
  idleBuilders: Settler[];
  idleDiggers: Settler[];
  idleSoldiers: Settler[];
  builders: number;
  diggers: number;
  soldierNeed: number;
  milSites: number; // military buildings still going up here (they will want a soldier)
  jobless: number; // buildings waiting for a worker nobody here can become
  slots: { goods: Good[]; n: number }[]; // needs any one of several goods (food for mines)
  pending: { carrier: number; builder: number; digger: number; soldier: number; other: number };
}

function roleOf(s: Settler): 'carrier' | 'builder' | 'digger' | 'soldier' | 'other' {
  if (isSoldier(s)) return 'soldier';
  if (s.job === 'carrier' || s.job === 'builder' || s.job === 'digger') return s.job;
  return 'other';
}

function survey(g: Game, owner: number, harbours: Building[]): Map<number, RegionInfo> {
  const w = g.world;
  const info = new Map<number, RegionInfo>();
  for (const hb of harbours) {
    const r = regionOf(g, hb);
    if (info.has(r)) continue;
    info.set(r, {
      region: r, harbour: hb, need: emptyStock(), avail: emptyStock(), sites: 0, levelling: 0, buildings: 0,
      idleCarriers: [], idleBuilders: [], idleDiggers: [], idleSoldiers: [], builders: 0, diggers: 0, soldierNeed: 0, milSites: 0, jobless: 0, slots: [],
      pending: { carrier: 0, builder: 0, digger: 0, soldier: 0, other: 0 },
    });
  }
  const specialists = new Map<string, number>(); // `${region}:${job}` -> unemployed count
  for (const s of g.settlers.values()) {
    if (s.owner !== owner || s.dead) continue;
    if (s.voyage > 0) {
      const dest = g.buildings.get(s.voyage);
      const ri = dest ? info.get(regionOf(g, dest)) : undefined;
      if (ri) ri.pending[roleOf(s)]++;
      continue;
    }
    if (s.voyage < 0 || s.aboard) continue;
    const ri = info.get(w.region[s.node]);
    if (!ri) continue;
    if (s.job === 'carrier') { if (s.idle && !s.home) ri.idleCarriers.push(s); }
    else if (s.job === 'builder') { ri.builders++; if (!s.home) ri.idleBuilders.push(s); }
    else if (s.job === 'digger') { ri.diggers++; if (!s.home) ri.idleDiggers.push(s); }
    else if (isSoldier(s)) { if (s.sstate === 'idle' && !s.engaged) ri.idleSoldiers.push(s); }
    else if (!s.home) specialists.set(`${ri.region}:${s.job}`, (specialists.get(`${ri.region}:${s.job}`) ?? 0) + 1);
  }
  const needs: Need[] = [];
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || b.state === 'burning') continue;
    const ri = info.get(regionOf(g, b));
    if (!ri) continue;
    if (b.state === 'leveling' || b.state === 'building') {
      ri.sites++;
      if (b.state === 'leveling') ri.levelling++;
      if (b.def.military) ri.milSites++;
    } else ri.buildings++;
    needs.length = 0;
    needsOf(g, b, needs);
    for (const nd of needs) {
      if (nd.goods.length > 1) ri.slots.push({ goods: nd.goods, n: nd.n });
      else ri.need[nd.goods[0]] += nd.n;
    }
    if (b.state === 'done') {
      for (const gd of GOODS) ri.avail[gd] += Math.max(0, availableAt(b, gd));
      if (b.def.military && b.type !== 'hq') ri.soldierNeed += Math.max(0, b.desiredSoldiers - b.garrison.length - b.soldiersIncoming);
      if (b.def.worker && !b.worker && !b.workerIncoming) {
        const spec = specialists.get(`${ri.region}:${b.def.worker}`) ?? 0;
        if (spec > 0) specialists.set(`${ri.region}:${b.def.worker}`, spec - 1);
        else {
          ri.jobless++;
          const tool = JOB_TOOL[b.def.worker];
          if (tool) ri.need[tool]++;
        }
      }
    }
  }
  return info;
}

function openOrder(g: Game, owner: number, from: Building, to: Building, gd: Good, n: number) {
  const o = g.seaOrders.find((x) => x.owner === owner && x.from === from.id && x.to === to.id && x.good === gd && x.n - x.loaded - x.delivered > 0);
  if (o) { o.n += n; return; }
  g.seaOrders.push({ id: g.id(), owner, from: from.id, to: to.id, good: gd, n, loaded: 0, delivered: 0, t: g.time } as SeaOrder);
}

function planSea(g: Game, owner: number) {
  const harbours: Building[] = [];
  for (const b of g.buildings.values()) if (b.owner === owner && b.type === 'harbour' && b.state === 'done' && b.dock >= 0) harbours.push(b);
  // orders whose ends are gone are dropped (anything already aboard finds another harbour)
  g.seaOrders = g.seaOrders.filter((o) => {
    if (o.owner !== owner) return true;
    const alive = harbourAlive(g, o.from, owner) && harbourAlive(g, o.to, owner);
    if (!alive) return o.loaded > 0;
    if (o.delivered >= o.n && o.loaded === 0) return false;
    // stale: the source never had it; forget the rest
    if (g.time - o.t > 240 && o.loaded === 0) { o.n = o.delivered; return o.delivered < o.n; }
    return true;
  });
  const info = survey(g, owner, harbours);
  const regions = [...info.values()];

  // expeditions gather at their harbour
  for (const ex of g.expeditions) {
    if (ex.owner !== owner || ex.state !== 'gathering') continue;
    const hb = harbourAlive(g, ex.from, owner);
    if (!hb) { cancelExpedition(g, ex); g.message(owner, 'An expedition was called off: its harbour is gone', undefined, undefined, 'bad'); continue; }
    const ri = info.get(regionOf(g, hb));
    const have = { carrier: 0, builder: 0, digger: 0, soldier: 0, other: 0 };
    for (const s of g.settlers.values()) if (s.owner === owner && s.voyage === -ex.id && !s.dead) have[roleOf(s)]++;
    const send = (role: 'carrier' | 'builder' | 'digger' | 'soldier', pool: Settler[]) => {
      while (have[role] < ex.people[role] && pool.length) {
        const s = pool.shift()!;
        sendToHarbour(g, s, hb, -ex.id);
        have[role]++;
      }
    };
    if (ri) {
      send('builder', ri.idleBuilders);
      send('digger', ri.idleDiggers);
      send('carrier', ri.idleCarriers.length > 3 ? ri.idleCarriers : []);
      if (have.soldier < ex.people.soldier) {
        const pool = [...ri.idleSoldiers];
        if (!pool.length) { const s = reserveSoldier(g, owner, ri.region, true); if (s) pool.push(s); }
        send('soldier', pool);
      }
    }
  }

  if (regions.length >= 2) {
    // ---- goods
    for (const dst of regions) {
      // a food slot asks for whichever kind is most plentiful on the other landmasses (unless one is at hand)
      for (const sl of dst.slots) {
        let have = 0;
        for (const gd of sl.goods) have += dst.avail[gd];
        if (have >= sl.n) continue;
        let pick = sl.goods[0], pv = -1;
        for (const gd of sl.goods) {
          let v = 0;
          for (const r of regions) if (r !== dst) v += r.avail[gd];
          if (v > pv) { pv = v; pick = gd; }
        }
        dst.need[pick] += sl.n - have;
      }
      for (const gd of GOODS) {
        let pendingIn = 0;
        for (const o of g.seaOrders) if (o.owner === owner && o.to === dst.harbour.id && o.good === gd) pendingIn += o.n - o.delivered;
        let unmet = dst.need[gd] - dst.avail[gd] - pendingIn;
        if (unmet <= 0) {
          // over-ordered: trim what has not been loaded yet
          for (const o of g.seaOrders) {
            if (unmet >= 0 || o.owner !== owner || o.to !== dst.harbour.id || o.good !== gd) continue;
            const rem = o.n - o.loaded - o.delivered;
            const cut = Math.min(rem, -unmet);
            o.n -= cut;
            unmet += cut;
          }
          continue;
        }
        // the best-stocked other landmass ships it
        let src: RegionInfo | null = null, best = 0;
        for (const s of regions) {
          if (s === dst || s.harbour.dock < 0 || g.world.sea[s.harbour.dock] !== g.world.sea[dst.harbour.dock]) continue;
          let reserved = 0;
          for (const o of g.seaOrders) if (o.owner === owner && o.from === s.harbour.id && o.good === gd) reserved += o.n - o.loaded - o.delivered;
          const spare = s.avail[gd] - reserved - Math.max(0, s.need[gd] - s.avail[gd] * 0.5);
          if (spare > best) { best = spare; src = s; }
        }
        if (!src) continue;
        openOrder(g, owner, src.harbour, dst.harbour, gd, Math.min(unmet, Math.floor(best), 12));
      }
    }
    // ---- people
    const pickSource = (dst: RegionInfo, key: 'idleCarriers' | 'idleBuilders' | 'idleDiggers' | 'idleSoldiers', keep: number) => {
      let src: RegionInfo | null = null, best = 0;
      for (const s of regions) {
        if (s === dst || g.world.sea[s.harbour.dock] !== g.world.sea[dst.harbour.dock]) continue;
        // soldiers stay where towers are still waiting for them
        const spare = s[key].length - keep - (key === 'idleSoldiers' ? s.soldierNeed + s.milSites : 0);
        if (spare > best) { best = spare; src = s; }
      }
      return src;
    };
    for (const dst of regions) {
      const active = dst.sites + dst.buildings > 1; // more than the harbour itself
      // carriers: a few for hauling plus one per job nobody can take
      const wantC = active ? Math.min(14, 2 + dst.jobless + Math.ceil(dst.buildings * 0.25) + (dst.sites ? 2 : 0)) : 0;
      let lack = wantC - dst.idleCarriers.length - dst.pending.carrier;
      if (lack > 0) {
        const src = pickSource(dst, 'idleCarriers', 5);
        if (src) for (let k = 0; k < Math.min(lack, 6) && src.idleCarriers.length > 5; k++) sendToHarbour(g, src.idleCarriers.pop()!, src.harbour, dst.harbour.id);
      }
      if (dst.sites) {
        lack = Math.min(2, dst.sites) - dst.builders - dst.pending.builder;
        const src = lack > 0 ? pickSource(dst, 'idleBuilders', 1) : null;
        if (src) for (let k = 0; k < lack && src.idleBuilders.length > 1; k++) sendToHarbour(g, src.idleBuilders.pop()!, src.harbour, dst.harbour.id);
      }
      if (dst.levelling) {
        lack = 1 - dst.diggers - dst.pending.digger;
        const src = lack > 0 ? pickSource(dst, 'idleDiggers', 1) : null;
        if (src) sendToHarbour(g, src.idleDiggers.pop()!, src.harbour, dst.harbour.id);
      }
      lack = Math.min(6, dst.soldierNeed - dst.idleSoldiers.length - dst.pending.soldier);
      while (lack > 0) {
        let s: Settler | null = null, from: Building | null = null;
        const src = pickSource(dst, 'idleSoldiers', 0);
        if (src) { s = src.idleSoldiers.pop()!; from = src.harbour; }
        else {
          for (const r of regions) {
            if (r === dst || g.world.sea[r.harbour.dock] !== g.world.sea[dst.harbour.dock]) continue;
            s = reserveSoldier(g, owner, r.region);
            if (s) { from = r.harbour; break; }
          }
        }
        if (!s || !from) break;
        sendToHarbour(g, s, from, dst.harbour.id);
        lack--;
      }
    }
  }

  // what each harbour should gather for loading
  for (const hb of harbours) hb.seaWant = null;
  const want = (hb: Building, gd: Good, n: number) => {
    if (n <= 0) return;
    if (!hb.seaWant) hb.seaWant = emptyStock();
    hb.seaWant[gd] += n;
  };
  for (const o of g.seaOrders) {
    if (o.owner !== owner) continue;
    const hb = harbourAlive(g, o.from, owner);
    if (hb) want(hb, o.good, o.n - o.loaded - o.delivered);
  }
  for (const ex of g.expeditions) {
    if (ex.owner !== owner || ex.state !== 'gathering') continue;
    const hb = harbourAlive(g, ex.from, owner);
    if (hb) { want(hb, 'board', ex.goods.board); want(hb, 'stone', ex.goods.stone); }
  }
}

/** Pull a surplus soldier out of a garrison on landmass `region`; `any` also thins out full garrisons. */
function reserveSoldier(g: Game, owner: number, region: number, any = false): Settler | null {
  let pick: Building | null = null, spare = 0;
  for (const b of g.buildings.values()) {
    if (b.owner !== owner || !b.def.military || b.state !== 'done' || regionOf(g, b) !== region) continue;
    let surplus = b.type === 'hq' ? b.garrison.length - 2 : b.garrison.length - b.desiredSoldiers;
    if (any) surplus = Math.max(surplus, b.garrison.length - (b.underAttackT > 0 ? 99 : 1));
    if (surplus > spare) { spare = surplus; pick = b; }
  }
  if (pick) {
    const b = pick;
    const id = b.garrison.pop()!;
    const s = g.settlers.get(id);
    if (!s) return null;
    s.inside = 0;
    s.hidden = false;
    s.node = b.door;
    g.syncPos(s);
    s.sstate = 'idle';
    s.home = 0;
    return s;
  }
  return null;
}

// ------------------------------------------------------------------ dispatch
function readyCount(g: Game, from: Building, to: number) {
  let n = 0;
  const left = emptyStock();
  for (const gd of GOODS) left[gd] = from.stock[gd] - from.outgoing[gd];
  for (const o of g.seaOrders) {
    if (o.owner !== from.owner || o.from !== from.id || o.to !== to) continue;
    const k = Math.min(o.n - o.loaded - o.delivered, left[o.good]);
    if (k > 0) { n += k; left[o.good] -= k; }
  }
  return n;
}

function dispatchShips(g: Game, owner: number) {
  const idle: Ship[] = [];
  for (const sh of g.ships.values()) if (sh.owner === owner && sh.state === 'idle' && !sh.route && !cargoCount(sh) && !sh.passengers.length) idle.push(sh);
  if (!idle.length) return;
  const takeNearest = (x: number, z: number, sea: number): Ship | null => {
    let bi = -1, bd = Infinity;
    for (let k = 0; k < idle.length; k++) {
      const s = idle[k];
      const n = nearestNavigable(g, s.x, s.z);
      if (n < 0 || g.world.sea[n] !== sea) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) { bd = d; bi = k; }
    }
    return bi >= 0 ? idle.splice(bi, 1)[0] : null;
  };
  // expeditions whose party and materials are all waiting
  for (const ex of g.expeditions) {
    if (ex.owner !== owner || ex.state !== 'gathering' || ex.ship) continue;
    const hb = harbourAlive(g, ex.from, owner);
    if (!hb) continue;
    const party = waitingAt(g, hb, -ex.id);
    const need = ex.people.builder + ex.people.digger + ex.people.soldier + ex.people.carrier;
    if (party.length < need || hb.stock.board < ex.goods.board || hb.stock.stone < ex.goods.stone) continue;
    const sh = takeNearest(hb.cx, hb.cz, g.world.sea[hb.dock]);
    if (!sh) return;
    ex.ship = sh.id;
    sh.expedition = ex.id;
    sh.from = hb.id;
    sh.to = 0;
    sh.state = 'toLoad';
    if (!sailToBuilding(g, sh, hb)) { sh.state = 'loading'; sh.at = hb.id; }
  }
  // cargo and passengers: busiest route first
  const pairs: { from: Building; to: number; score: number }[] = [];
  const seen = new Set<string>();
  const add = (from: number, to: number) => {
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    const hb = harbourAlive(g, from, owner);
    if (!hb || !harbourAlive(g, to, owner)) return;
    let score = readyCount(g, hb, to) + waitingAt(g, hb, to).length * 3;
    // ships already on their way to take this route
    for (const sh of g.ships.values()) if (sh.owner === owner && (sh.state === 'toLoad' || sh.state === 'loading') && sh.from === from && sh.to === to) score -= SHIP_CARGO;
    if (score > 0) pairs.push({ from: hb, to, score });
  };
  for (const o of g.seaOrders) if (o.owner === owner && o.n - o.loaded - o.delivered > 0) add(o.from, o.to);
  for (const s of g.settlers.values()) if (s.owner === owner && s.voyage > 0 && s.voyageFrom && s.inside === s.voyageFrom) add(s.voyageFrom, s.voyage);
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (p.score < 3 && !waitingAt(g, p.from, p.to).length) {
      // a small lot waits a little for company
      let oldest = g.time;
      for (const o of g.seaOrders) if (o.from === p.from.id && o.to === p.to) oldest = Math.min(oldest, o.t);
      if (g.time - oldest < 40) continue;
    }
    const sh = takeNearest(p.from.cx, p.from.cz, g.world.sea[p.from.dock]);
    if (!sh) break;
    sh.from = p.from.id;
    sh.to = p.to;
    sh.state = 'toLoad';
    if (sh.at === p.from.id || !sailToBuilding(g, sh, p.from)) { sh.state = 'loading'; sh.at = p.from.id; sh.route = null; }
  }
}

// ------------------------------------------------------------------ tick
export function updateSea(g: Game, dt: number) {
  for (const sh of g.ships.values()) updateShip(g, sh, dt);
  g.seaT -= dt;
  if (g.seaT > 0) return;
  g.seaT = 1.5;
  for (const p of g.players) {
    if (!p.alive) continue;
    let any = false;
    for (const b of g.buildings.values()) if (b.owner === p.id && b.type === 'harbour') { any = true; break; }
    if (!any) {
      for (const sh of g.ships.values()) if (sh.owner === p.id) { any = true; break; }
    }
    if (!any) continue;
    planSea(g, p.id);
    dispatchShips(g, p.id);
  }
}

/** Remove a defeated player's fleet. */
export function sinkFleet(g: Game, owner: number) {
  for (const sh of [...g.ships.values()]) {
    if (sh.owner !== owner) continue;
    g.emit({ type: 'sink', x: sh.x, z: sh.z, owner, s: sh.id });
    g.ships.delete(sh.id);
  }
  g.seaOrders = g.seaOrders.filter((o) => o.owner !== owner);
  g.expeditions = g.expeditions.filter((e) => e.owner !== owner);
}

/** Status line for the harbour panel. */
export function harbourTraffic(g: Game, hb: Building) {
  let docked = 0, inbound = 0;
  for (const sh of g.ships.values()) {
    if (sh.owner !== hb.owner) continue;
    if (sh.at === hb.id && !sh.route) docked++;
    else if ((sh.state === 'toLoad' && sh.from === hb.id) || (sh.state === 'toUnload' && sh.to === hb.id)) inbound++;
  }
  let waiting = 0;
  for (const s of g.settlers.values()) if (s.owner === hb.owner && s.voyageFrom === hb.id && s.inside === hb.id) waiting++;
  let exports = 0;
  if (hb.seaWant) for (const gd of GOODS) exports += hb.seaWant[gd];
  return { docked, inbound, waiting, exports };
}

/** Height of the ship's waterline (it bobs in the swell); the deck is ~0.25 above. */
export const shipDeckY = (t: number, id: number) => WATER_LEVEL + 0.02 + Math.sin(t * 1.3 + id) * 0.025;
export const DECK_H = 0.2 * SHIP_SCALE;
