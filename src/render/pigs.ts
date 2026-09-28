// Live pigs. Every pig farm keeps a herd in its pen: a boar and a sow once the pig farmer has
// moved in, piglets that grow as the farm works through its feed (the oldest is full grown just
// as the farm finishes a pig), and the fattened pigs the farm has ready — its stock — which trot
// to the gate and wait there until a carrier takes one away. Each new portion of grain and water
// brings the herd running to the trough; an empty trough keeps them nosing round it. Pigs waiting
// at a slaughterhouse (or any other workshop holding some) stand about by its goods pile.
// Render-only: nothing here touches the game state or its random numbers.
import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Building } from '../game/types';
import type { BuildingsRenderer } from './buildings';
import { PIG_HIPS, PIG_HIP_Y, PIG_NECK, buildPigGeos } from './models';
import { patchMaterial } from './shaderPatch';
import { uploadFirst } from './instancing';

const MAX = 480;
/** Drawn a little larger than life, like the settlers and donkeys. */
const SCALE = 1.05;
/** piglets growing at once; the oldest is ready each time the farm finishes a cycle */
const YOUNG = 3;

// The pig farm's pen (buildingModels.ts) in building-local coordinates: snouts and rumps stay
// inside the fence ellipse, pigs wander to spots inside the smaller one and step round the trough
// and the hay, three at a time eat at places along the trough, and the fattened pigs wait by the
// gate in front.
const FENCE = { x: 0.05, z: 0.55, rx: 1.24, rz: 0.76 };
const PEN = { x: 0.05, z: 0.55, rx: 0.95, rz: 0.48 };
/** the trough's front edge runs from (x0, z0) to (x1, z1); pigs eat facing across it */
const TROUGH = { x0: -1.01, z0: 0.38, x1: -0.34, z1: 0.17, face: Math.PI + 0.3, stand: 0.33 };
const TROUGH_SLOTS = [0.1, 0.5, 0.9];
/** things in the pen to walk round: the trough (a capsule along its middle) and the hay pile */
const OBSTACLES = [{ x0: -1.034, z0: 0.303, x1: -0.366, z1: 0.097, r: 0.08 }, { x0: 0.8, z0: 0.1, x1: 0.8, z1: 0.1, r: 0.2 }];
const GATE = { x: 0.3, z: 0.98 };
/** pigs waiting at these buildings stand in their yard rather than by the goods pile */
const YARDS: Partial<Record<string, { x: number; z: number; r: number }>> = { slaughter: { x: 0.72, z: 0.6, r: 0.3 } };
/** how far the snout, the rump and the flanks reach from a pig's centre at full size */
const REACH = { nose: 0.36, rump: 0.24, flank: 0.12 };
/** how long the herd crowds the trough after a new portion of feed */
const FEED_TIME = 5.5;
/** paler, pinker and duskier skins and the odd ginger one, multiplied into the vertex colours */
const TINTS = [new THREE.Color(1, 1, 1), new THREE.Color(1.03, 0.97, 0.95), new THREE.Color(0.96, 0.9, 0.87), new THREE.Color(0.8, 0.58, 0.36)];
const TINT_ODDS = [0.35, 0.3, 0.22, 0.13];

type Act = 'stand' | 'root' | 'eat' | 'lie';
type Role = 'breeder' | 'young' | 'ready';

interface Pig {
  role: Role;
  x: number; z: number; h: number;
  /** where it is heading, what it will do there and for how long, and which way it will face */
  tx: number; tz: number; next: Act; nextT: number; face: number | null;
  moving: boolean; fast: boolean; walkT: number;
  act: Act; actT: number;
  /** the place at the trough it holds, or -1 */
  slot: number;
  /** its body on the ground for bumping: rump x, z, chest x, z, radius */
  cap: number[];
  /** drawn size (eased), the size it is growing to and its own build */
  size: number; grow: number; build: number;
  spotted: boolean; tint: number; seed: number;
  phase: number; lie: number; pitch: number; yaw: number;
}

interface Herd {
  id: number;
  /** a pig farm's pen, or pigs waiting by a goods pile */
  pen: boolean;
  breeders: Pig[];
  /** growing piglets, oldest first */
  young: Pig[];
  ready: Pig[];
  stock: number;
  working: boolean;
  feedT: number;
  gruntT: number;
  /** renderer time it was last moved: after a spell off screen the pigs are simply grown, not seen growing */
  simT: number;
  /** waiting spot by the goods pile or in the yard (building-local), for herds without a pen */
  sx: number; sz: number; sr: number;
}

/** a pig's body for bumping into others: a capsule from the rump to the chest, at full size */
const BODY = { back: 0.1, front: 0.17, r: 0.125 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Closest points between segments p1-q1 and p2-q2 on the ground, into CP (x1, z1, x2, z2). */
const CP = [0, 0, 0, 0];
function closest(p1x: number, p1z: number, q1x: number, q1z: number, p2x: number, p2z: number, q2x: number, q2z: number) {
  const d1x = q1x - p1x, d1z = q1z - p1z, d2x = q2x - p2x, d2z = q2z - p2z, rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  const c = d1x * rx + d1z * rz, bb = d1x * d2x + d1z * d2z, den = a * e - bb * bb;
  let s = den > 1e-9 ? clamp((bb * f - c * e) / den, 0, 1) : 0;
  let t = (bb * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / a, 0, 1); }
  CP[0] = p1x + d1x * s; CP[1] = p1z + d1z * s; CP[2] = p2x + d2x * t; CP[3] = p2z + d2z * t;
}

function pickTint() {
  let r = Math.random();
  for (let k = 0; k < TINT_ODDS.length; k++) if ((r -= TINT_ODDS[k]) < 0) return k;
  return 0;
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  m.setColorAt(0, TINTS[0]); // colour buffer from the start, so the shader never has to change
  return m;
}

export class PigsRenderer {
  group = new THREE.Group();
  private herds = new Map<number, Herd>();
  private body: THREE.InstancedMesh;
  private spots: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private frustum = new THREE.Frustum();
  private projM = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 2.2);
  private base = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private r = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private game: Game, private buildings: BuildingsRenderer, private sound: (name: string, x: number, z: number, vol: number) => void) {
    const g = buildPigGeos();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
    patchMaterial(mat, { key: 'pig' });
    this.body = inst(g.body, mat, MAX);
    this.spots = inst(g.spotted, mat, MAX);
    this.heads = inst(g.head, mat, MAX);
    this.legs = inst(g.leg, mat, MAX * 4);
    this.group.add(this.body, this.spots, this.heads, this.legs);
  }

  /** How far the farm is through fattening its next pig, 0..1. */
  private progress(b: Building) {
    return b.working && b.def.cycle ? clamp(b.workT / b.def.cycle, 0, 1) : 0;
  }

  private spawn(role: Role, x: number, z: number, size: number): Pig {
    return {
      role, x, z, h: rand(-Math.PI, Math.PI), tx: x, tz: z, next: 'stand', nextT: 1, face: null,
      moving: false, fast: false, walkT: 0, act: 'stand', actT: rand(0.2, 2.5), slot: -1, cap: [0, 0, 0, 0, 0],
      size, grow: size, build: rand(0.95, 1.05), spotted: Math.random() < 0.25, tint: pickTint(),
      seed: Math.random() * 100, phase: Math.random() * 6, lie: 0, pitch: 0, yaw: 0,
    };
  }

  /** A spot to wander to in the pen, clear of the trough and the hay. */
  private inPen(): [number, number] {
    for (let k = 0; ; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.92;
      const x = PEN.x + Math.cos(a) * r * PEN.rx, z = PEN.z + Math.sin(a) * r * PEN.rz;
      if (k >= 12 || OBSTACLES.every((o) => {
        closest(x, z, x + 1e-4, z, o.x0, o.z0, o.x1 + 1e-4, o.z1);
        return Math.hypot(CP[0] - CP[2], CP[1] - CP[3]) > o.r + 0.2;
      })) return [x, z];
    }
  }

  private nearGate(): [number, number] {
    return [GATE.x + rand(-0.3, 0.3), GATE.z + rand(-0.22, 0.08)];
  }

  private create(b: Building, pen: boolean): Herd {
    const h: Herd = { id: b.id, pen, breeders: [], young: [], ready: [], stock: 0, working: b.working, feedT: 0, gruntT: rand(1, 6), simT: -1e9, sx: 0, sz: 0, sr: 0.32 };
    if (pen) {
      const [bx, bz] = this.inPen();
      const boar = this.spawn('breeder', bx, bz, 1.14);
      const [sx, sz] = this.inPen();
      const sow = this.spawn('breeder', sx, sz, 1.06);
      h.breeders.push(boar, sow);
      for (let k = 0; k < YOUNG; k++) {
        const [x, z] = this.inPen();
        h.young.push(this.spawn('young', x, z, 0.6));
      }
    } else {
      const yard = YARDS[b.type];
      const a = this.buildings.views.get(b.id)?.anchors.piles[0];
      h.sx = yard ? yard.x : a ? a.x - Math.sign(a.x || 1) * 0.42 : 0.9;
      h.sz = yard ? yard.z : a ? a.z : 0.9;
      h.sr = yard ? yard.r : 0.32;
    }
    // pigs already waiting (a farm seen for the first time, or a loaded game) are at the gate
    for (; h.stock < b.stock.pig; h.stock++) h.ready.push(this.readyPig(h));
    return h;
  }

  private readyPig(h: Herd) {
    const [x, z] = h.pen ? this.nearGate() : [h.sx + rand(-0.6, 0.6) * h.sr, h.sz + rand(-0.6, 0.6) * h.sr];
    return this.spawn('ready', x, z, 1);
  }

  /** Follow the building's pig stock: a finished pig leaves the young for the gate, a pig taken away leaves the herd. */
  private reconcile(b: Building, h: Herd) {
    while (h.stock < b.stock.pig) {
      h.stock++;
      const oldest = h.pen ? h.young.shift() : undefined;
      if (!oldest) { h.ready.push(this.readyPig(h)); continue; }
      oldest.role = 'ready';
      h.ready.push(oldest);
      const [gx, gz] = this.nearGate();
      this.go(oldest, gx, gz, 'root', rand(2, 5), null, false);
      // and the sow has another piglet
      const sow = h.breeders[1];
      const piglet = this.spawn('young', sow.x - Math.sin(sow.h) * 0.2, sow.z - Math.cos(sow.h) * 0.2, 0.2);
      piglet.h = sow.h;
      h.young.push(piglet);
    }
    while (h.stock > b.stock.pig && h.stock > 0) {
      h.stock--;
      // the one nearest the gate goes (for a pile, any of them)
      let best = -1, bd = Infinity;
      for (let k = 0; k < h.ready.length; k++) {
        const p = h.ready[k];
        const d = h.pen ? (p.x - GATE.x) ** 2 + (p.z - GATE.z) ** 2 : k;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) h.ready.splice(best, 1);
    }
  }

  private go(p: Pig, x: number, z: number, next: Act, nextT: number, face: number | null, fast: boolean) {
    p.tx = x; p.tz = z; p.next = next; p.nextT = nextT; p.face = face;
    p.moving = true; p.fast = fast; p.walkT = 0;
    if (p.act === 'lie') p.act = 'stand';
  }

  /** To a free place at the trough, or to wait behind the pigs that hold them all. */
  private atTrough(h: Herd, p: Pig, next: Act, t: number, fast: boolean) {
    const taken = new Set<number>();
    for (const o of [...h.breeders, ...h.young, ...h.ready]) if (o !== p && o.slot >= 0) taken.add(o.slot);
    const free = TROUGH_SLOTS.map((_t, k) => k).filter((k) => !taken.has(k));
    if (!free.length) {
      // wait beside the pigs at the trough, eyeing it
      this.go(p, rand(-0.05, 0.3), rand(0.4, 0.75), 'root', rand(1.2, 2.5), -Math.PI / 2 - 0.3 + rand(-0.5, 0.5), fast);
      return;
    }
    const at = (k: number): [number, number] => {
      const t = TROUGH_SLOTS[k];
      return [TROUGH.x0 + (TROUGH.x1 - TROUGH.x0) * t - Math.sin(TROUGH.face) * TROUGH.stand, TROUGH.z0 + (TROUGH.z1 - TROUGH.z0) * t - Math.cos(TROUGH.face) * TROUGH.stand];
    };
    const k = free.reduce((a, c) => (Math.hypot(at(c)[0] - p.x, at(c)[1] - p.z) < Math.hypot(at(a)[0] - p.x, at(a)[1] - p.z) ? c : a));
    p.slot = k;
    const [x, z] = at(k);
    this.go(p, x + rand(-0.02, 0.02), z + rand(-0.02, 0.02), next, t, TROUGH.face + rand(-0.08, 0.08), fast);
  }

  private capsule(p: Pig) {
    const s = SCALE * p.size, sh = Math.sin(p.h), ch = Math.cos(p.h);
    const roll = p.lie * 0.14 * s * (p.seed % 2 < 1 ? 1 : -1);
    const x = p.x + ch * roll, z = p.z - sh * roll;
    const c = p.cap;
    c[0] = x - sh * BODY.back * s; c[1] = z - ch * BODY.back * s;
    c[2] = x + sh * BODY.front * s; c[3] = z + ch * BODY.front * s;
    c[4] = BODY.r * s;
  }

  /** Step out of the trough and the hay pile. */
  private avoidProps(p: Pig) {
    this.capsule(p);
    const c = p.cap;
    for (const o of OBSTACLES) {
      closest(c[0], c[1], c[2], c[3], o.x0, o.z0, o.x1 + 1e-4, o.z1);
      const dx = CP[0] - CP[2], dz = CP[1] - CP[3], d = Math.hypot(dx, dz), min = c[4] + o.r;
      if (d >= min || d < 1e-6) continue;
      p.x += dx * (min - d) / d;
      p.z += dz * (min - d) / d;
      this.capsule(p);
    }
  }

  /** Keep the snout, the rump and both flanks inside the fence. */
  private fence(p: Pig) {
    const s = SCALE * p.size, sh = Math.sin(p.h), ch = Math.cos(p.h);
    const pts = [[sh * REACH.nose, ch * REACH.nose], [-sh * REACH.rump, -ch * REACH.rump], [ch * REACH.flank, -sh * REACH.flank], [-ch * REACH.flank, sh * REACH.flank]];
    for (const [ox, oz] of pts) {
      const ex = (p.x + ox * s - FENCE.x) / FENCE.rx, ez = (p.z + oz * s - FENCE.z) / FENCE.rz, q = ex * ex + ez * ez;
      if (q <= 1) continue;
      const k = 1 - 1 / Math.sqrt(q);
      p.x -= ex * k * FENCE.rx;
      p.z -= ez * k * FENCE.rz;
    }
  }

  /** Pick what a pig does next once it has finished what it was doing. */
  private decide(b: Building, h: Herd, p: Pig) {
    p.slot = -1;
    if (!h.pen) {
      if (Math.random() < 0.45) this.go(p, h.sx + rand(-0.7, 0.7) * h.sr, h.sz + rand(-0.7, 0.7) * h.sr, Math.random() < 0.6 ? 'root' : 'stand', rand(1.5, 4), null, false);
      else { p.act = Math.random() < 0.5 ? 'root' : 'stand'; p.actT = rand(1.5, 4); }
      return;
    }
    const feeding = h.feedT > 0;
    const hungry = !b.working && b.status.startsWith('Waiting for');
    if (p.role === 'ready') {
      if (feeding && Math.random() < 0.4) this.atTrough(h, p, 'eat', h.feedT, true);
      else this.go(p, ...this.nearGate(), Math.random() < 0.6 ? 'root' : 'stand', rand(2, 6), null, false);
      return;
    }
    // the smallest piglets keep close to their mother
    if (p.role === 'young' && p.grow < 0.62) {
      const sow = h.breeders[1];
      const d = Math.hypot(p.x - sow.x, p.z - sow.z);
      // beside her or at her heels, not under her
      const a = sow.h + (Math.random() < 0.5 ? 1 : -1) * rand(1.2, 2.4);
      this.go(p, sow.x + Math.sin(a) * 0.36, sow.z + Math.cos(a) * 0.36, feeding ? 'eat' : 'root', rand(0.8, 2), null, d > 0.6);
      return;
    }
    if (feeding) { this.atTrough(h, p, 'eat', h.feedT + rand(0, 1.5), true); return; }
    if (hungry && Math.random() < 0.55) { this.atTrough(h, p, 'root', rand(2, 4), false); return; }
    if (p.role === 'breeder' && Math.random() < 0.3) { p.act = 'lie'; p.actT = rand(8, 16); return; }
    if (Math.random() < 0.6) this.go(p, ...this.inPen(), Math.random() < 0.65 ? 'root' : 'stand', rand(2, 5), null, false);
    else { p.act = 'stand'; p.actT = rand(1.5, 4); }
  }

  /** A step towards where it is going, steering round the pigs in the way. */
  private walk(b: Building, h: Herd, p: Pig, all: Pig[], dt: number) {
    const dx = p.tx - p.x, dz = p.tz - p.z, dl = Math.hypot(dx, dz);
    p.walkT += dt;
    if (dl < 0.06 || (p.walkT > 3.5 && dl < 0.3)) {
      p.moving = false;
      p.act = p.next;
      p.actT = p.nextT;
      return;
    }
    if (p.walkT > 7) { p.moving = false; this.decide(b, h, p); return; }
    const ux = dx / dl, uz = dz / dl;
    let wx = ux, wz = uz, block = 0;
    const look = 0.55 * SCALE * p.size + 0.15;
    for (const o of all) {
      if (o === p) continue;
      const rx = o.x - p.x, rz = o.z - p.z;
      const fwd = rx * ux + rz * uz;
      if (fwd <= 0 || fwd > Math.min(look, dl + 0.15)) continue;
      const lat = rx * uz - rz * ux; // > 0: on the right
      const clear = 0.27 * SCALE * (p.size + o.size);
      if (Math.abs(lat) >= clear) continue;
      const k = (1 - fwd / look) * (1 - Math.abs(lat) / clear) * 2.2;
      // nose to flank with it: slow down rather than shove through
      const touch = 0.32 * SCALE * (p.size + o.size);
      if (Math.abs(lat) < clear * 0.7 && fwd < touch) block = Math.max(block, 1 - fwd / touch);
      const side = lat >= 0 ? -1 : 1;
      wx += side * uz * k;
      wz -= side * ux * k;
    }
    const da = wrap(Math.atan2(wx, wz) - p.h);
    const turn = (p.fast ? 6 : 3.2) * dt;
    p.h = wrap(p.h + clamp(da, -turn, turn));
    const sp = (p.fast ? 0.62 : 0.24) * (0.55 + 0.45 * p.size) * Math.max(0, Math.cos(da)) * (1 - 0.8 * block);
    p.x += Math.sin(p.h) * sp * dt;
    p.z += Math.cos(p.h) * sp * dt;
    p.phase += dt * sp / (0.02 * Math.max(0.4, p.size));
  }

  private simulate(b: Building, h: Herd, dt: number, time: number) {
    const all = [...h.breeders, ...h.young, ...h.ready];
    const away = time - h.simT > 1;
    h.simT = time;
    // feed goes in: everyone up and off to the trough, grunting
    if (b.working && !h.working && h.pen) {
      h.feedT = FEED_TIME;
      // the biggest shove in first
      for (const p of [...all].sort((a, c) => c.size - a.size)) if (p.role !== 'ready' || Math.random() < 0.4) this.decide(b, h, p);
      this.sound('grunt', b.cx, b.cz, 0.8);
      h.gruntT = rand(1, 3);
    }
    h.working = b.working;
    h.feedT = Math.max(0, h.feedT - dt);
    // the piglets grow with the farm's work: the oldest is full grown as the cycle ends
    const f = this.progress(b);
    h.young.forEach((p, k) => { p.grow = 0.42 + 0.58 * (YOUNG - 1 - k + f) / YOUNG; });
    for (const p of all) {
      const target = p.role === 'young' ? p.grow : p.grow * p.build;
      p.size = away ? target : p.size + (target - p.size) * Math.min(1, dt * 1.5);
      if (p.moving) this.walk(b, h, p, all, dt);
      else {
        if (p.face !== null) p.h = wrap(p.h + clamp(wrap(p.face - p.h), -2.5 * dt, 2.5 * dt));
        p.actT -= dt;
        if (p.actT <= 0) this.decide(b, h, p);
      }
      p.lie += ((p.act === 'lie' && !p.moving ? 1 : 0) - p.lie) * Math.min(1, dt * 2);
    }
    // shoulder to shoulder, not through each other: each body is a capsule from rump to chest
    // (rolled out to its side when it lies down), and the bigger or lying pig gives way less
    for (let pass = 0; pass < 2; pass++) {
      for (const p of all) this.capsule(p);
      for (let i = 0; i < all.length; i++) {
        const a = all[i], A = a.cap;
        for (let j = i + 1; j < all.length; j++) {
          const c = all[j], C = c.cap;
          const reach = A[4] + C[4] + 0.3 * SCALE * (a.size + c.size);
          if (Math.abs(a.x - c.x) > reach || Math.abs(a.z - c.z) > reach) continue;
          closest(A[0], A[1], A[2], A[3], C[0], C[1], C[2], C[3]);
          let dx = CP[2] - CP[0], dz = CP[3] - CP[1];
          let d = Math.hypot(dx, dz);
          const min = A[4] + C[4];
          if (d >= min) continue;
          if (d < 1e-5) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
          const ma = a.lie > 0.5 ? 6 : a.size, mc = c.lie > 0.5 ? 6 : c.size;
          const k = (min - d) / d;
          a.x -= dx * k * mc / (ma + mc); a.z -= dz * k * mc / (ma + mc);
          c.x += dx * k * ma / (ma + mc); c.z += dz * k * ma / (ma + mc);
          this.capsule(a); this.capsule(c);
        }
      }
      for (const p of all) {
        if (h.pen) { this.avoidProps(p); this.fence(p); } // the fence has the last word
        else {
          const dx = p.x - h.sx, dz = p.z - h.sz, d = Math.hypot(dx, dz);
          if (d > h.sr) { p.x = h.sx + dx * h.sr / d; p.z = h.sz + dz * h.sr / d; }
        }
      }
    }
    h.gruntT -= dt;
    if (h.gruntT <= 0) {
      this.sound('grunt', b.cx, b.cz, all.length ? 0.45 : 0);
      h.gruntT = rand(3, 10) * (h.feedT > 0 ? 0.3 : 1);
    }
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    const g = this.game;
    dt = Math.min(dt, 0.1);
    this.projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
    for (const id of this.herds.keys()) if (!g.buildings.has(id)) this.herds.delete(id);
    let n = 0, nb = 0, ns = 0, nl = 0;
    for (const b of g.buildings.values()) {
      const pen = b.type === 'pigfarm';
      let h = this.herds.get(b.id);
      const want = b.state === 'done' && (pen ? !!h || b.worker !== 0 || b.prodCount > 0 || b.stock.pig > 0 : !b.def.storage && b.stock.pig > 0);
      if (!want) { if (h) this.herds.delete(b.id); continue; }
      if (!h) { h = this.create(b, pen); this.herds.set(b.id, h); }
      this.reconcile(b, h);
      const v = this.buildings.views.get(b.id);
      if (!v || !v.group.visible) continue;
      const y0 = v.group.position.y;
      this.sphere.center.set(b.cx, y0 + 0.3, b.cz);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      this.simulate(b, h, dt, time);
      for (const p of [...h.breeders, ...h.young, ...h.ready]) {
        if (n >= MAX) break;
        const wx = b.cx + p.x, wz = b.cz + p.z;
        const y = pen ? y0 + 0.022 : g.world.heightAt(wx, wz);
        const s = SCALE * p.size;
        const moving = p.moving && !p.lie;
        const bob = moving ? Math.abs(Math.sin(p.phase)) * 0.018 * s : 0;
        const breath = 1 + Math.sin(time * (p.lie > 0.5 ? 1.3 : 2.1) + p.seed) * (p.lie > 0.5 ? 0.025 : 0.012);
        this.q.setFromEuler(this.e.set(0, p.h, 0));
        this.base.compose(this.v.set(wx, y + bob, wz), this.q, this.sc.set(s, s * breath, s));
        if (p.lie > 0.01) {
          // flops over onto its side, rolling about the edge of the belly
          const side = p.seed % 2 < 1 ? 1 : -1;
          this.base.multiply(this.r.makeTranslation(side * 0.12, 0, 0)).multiply(this.m.makeRotationZ(-side * p.lie * 1.35)).multiply(this.r.makeTranslation(-side * 0.12, 0, 0));
        }
        const tint = TINTS[p.tint];
        if (p.spotted) { this.spots.setMatrixAt(ns, this.base); this.spots.setColorAt(ns++, tint); }
        else { this.body.setMatrixAt(nb, this.base); this.body.setColorAt(nb++, tint); }
        // the head: rooting nods, chewing at the trough, a look round while it stands
        let pitch = 0, yaw = 0;
        if (p.lie > 0.5) pitch = 0.12;
        else if (p.moving) pitch = Math.sin(p.phase * 2) * 0.05 + (p.fast ? -0.08 : 0.05);
        else if (p.act === 'root') pitch = 0.42 + Math.sin(time * 7 + p.seed) * 0.12, yaw = Math.sin(time * 1.3 + p.seed) * 0.25;
        else if (p.act === 'eat') pitch = 0.5 + Math.sin(time * 10 + p.seed) * 0.06;
        else pitch = -0.08 + Math.sin(time * 0.6 + p.seed) * 0.06, yaw = Math.sin(time * 0.45 + p.seed * 3) * 0.5;
        const ease = Math.min(1, dt * 6);
        p.pitch += (pitch - p.pitch) * ease;
        p.yaw += (yaw - p.yaw) * ease;
        this.m.copy(this.base).multiply(this.r.makeTranslation(PIG_NECK[0], PIG_NECK[1], PIG_NECK[2]))
          .multiply(this.r.makeRotationFromEuler(this.e.set(p.pitch, p.yaw, 0, 'YXZ')));
        this.heads.setMatrixAt(n, this.m);
        this.heads.setColorAt(n, tint);
        // short legs trotting in diagonal pairs
        for (let l = 0; l < 4; l++) {
          const [hx, hz] = PIG_HIPS[l];
          const ang = moving ? Math.sin(p.phase + (l === 0 || l === 3 ? 0 : Math.PI)) * 0.6 : p.lie * (l < 2 ? -0.35 : 0.35);
          this.m.copy(this.base).multiply(this.r.makeTranslation(hx, PIG_HIP_Y, hz)).multiply(this.r.makeRotationX(ang));
          this.legs.setMatrixAt(nl, this.m);
          this.legs.setColorAt(nl++, tint);
        }
        n++;
      }
    }
    this.body.count = nb;
    this.spots.count = ns;
    this.heads.count = n;
    this.legs.count = nl;
    for (const m of [this.body, this.spots, this.heads, this.legs]) {
      uploadFirst(m.instanceMatrix, m.count);
      uploadFirst(m.instanceColor, m.count);
    }
  }
}
