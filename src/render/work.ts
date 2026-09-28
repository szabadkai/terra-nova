// Workers at work. While a workshop is busy its worker comes out into the yard and works at the
// stations its model already has, as in Settlers 3: the toolsmith heats an iron bar in the hearth,
// hammers it into the tool he is making on the anvil and quenches it in the barrel; the smelter
// shovels ore into the furnace, works the bellows and pours the melt into a mould. Each scene is
// timed against the building's production clock (b.workT / def.cycle) and ends with the worker
// putting the finished good on the pile just as the simulation adds it to the stock. A workshop
// that has stopped shows why without a click: waiting for an input its worker sits on the step,
// with a full pile he stands beside it with his arms folded.
// Render-only: nothing here touches the game state or its random numbers; a worker far away or out
// of view simply stays indoors, as before.
import * as THREE from 'three';
import { GOODS, type Good } from '../game/defs';
import type { Game } from '../game/game';
import type { Building, Settler } from '../game/types';
import { clamp, smoothstep as sm } from '../core/rng';
import type { Particles } from './particles';
import { Pose, copyPose, kf, mixPose, reach, resetPose, win } from './idle';
import { RIG } from './settlerModels';
import { lodView } from './lod';
import { buildWorkGeos, type WorkGeo } from './models';
import { patchMaterial } from './shaderPatch';
import { commitInstances } from './instancing';
import type { Anchors } from './geom';

const TAU = Math.PI * 2;
/** how fast a worker walks to catch up with his scene (world units per second) */
const WALK = 1.9;
/** walk cycle, radians of leg swing per world unit walked */
const STRIDE = 9;
/** pixels per world unit below which workers stay indoors (a size-3 workshop is then ~50 px wide) */
const PX_MIN = 16;
/** a stall must be this old (game seconds) before the worker comes out to show it */
const WAIT_DELAY = 2.5;
/** after his last cycle a worker stands about this long before going back in */
const LINGER = 3;
/** poses blend over this long when the worker moves on to the next thing */
const BLEND = 0.22;

// ------------------------------------------------------------------ what the director needs from the building renderer
export interface WorkView { y: number; anchors: Anchors; movers: THREE.Object3D[]; visible: boolean }
export interface WorkHost { workView(id: number): WorkView | null }

/** Where to draw a worker this frame, and what he has in his hands. */
export interface Shot {
  x: number; y: number; z: number; heading: number;
  /** the tool in his tool hand: undefined = his job's own, null = none */
  tool: Good | null | undefined;
  /** the good on his shoulder */
  carry: Good | null;
}

// ------------------------------------------------------------------ scenes
type Spot = { x: number; z: number };
type SpotRef = Spot | ((c: Ctx) => Spot);

/** One step of a scene: walk somewhere, or stand and do something. */
interface Beat {
  /** nominal seconds; a scene is stretched or squeezed to fit the building's cycle */
  d: number;
  /** walk here during the beat */
  to?: SpotRef;
  /** once there, face this point (or this heading) */
  face?: SpotRef | number;
  pose?: (P: Pose, c: Ctx) => void;
  /** tool hand: undefined = the job's own tool, null = empty */
  tool?: Good | null | ((c: Ctx) => Good | null);
  /** on the shoulder ('out' = the good being made) */
  carry?: Good | 'out' | null;
  /** things in his hands (drawn after the body, from the hand matrices) */
  props?: (c: Ctx, d: WorkDirector) => void;
  /** things in the yard (drawn even while he is indoors) */
  yard?: (c: Ctx, d: WorkDirector) => void;
  /** one-off effects: called with the beat-local seconds (a, b] that passed this frame */
  fx?: (c: Ctx, a: number, b: number) => void;
  /** he is indoors for this beat */
  hide?: boolean;
}

interface Layout {
  /** the house door he comes out of and goes back into */
  door: Spot;
  /** where he sits waiting for an input, and which way he faces */
  sit: Spot & { face: number; h?: number };
  /** open ground: next to a pile he stands on this side of it */
  yard: Spot;
  /** height of the floor he stands on (a temple's podium and steps); ground level when absent */
  floor?: (x: number, z: number) => number;
}

interface Scene {
  layout: Layout;
  beats: Beat[];
  /** other beats for some goods (the weaponsmith's bows) */
  pick?: (out: Good) => Beat[] | null;
  /** what the scene makes when the building doesn't say (the good on the pile) */
  good?: (b: Building, s: Settler) => Good;
  /** how far through its work the building is (0..1), null when it isn't working; default b.workT / cycle */
  clock?: (b: Building, s: Settler) => number | null;
  /** is s the settler this scene is about; default the building's worker */
  who?: (b: Building, s: Settler) => boolean;
}

/** The context a beat's functions get. */
interface Ctx {
  b: Building;
  dir: WorkDirector;
  out: Good;
  /** seconds into the beat, the beat's length in seconds, and how far through it (0..1) */
  t: number; d: number; k: number;
  /** how far through the whole cycle (0..1) */
  u: number;
  walking: boolean;
  /** the goods pile anchor of the building (model space) */
  anchor: Spot;
  layout: Layout;
  seed: number;
}

// ------------------------------------------------------------------ small helpers
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => a - Math.round(a / TAU) * TAU;
const ease = (k: number) => 0.5 * k + 0.25 * (1 - Math.cos(Math.PI * k));
/** Did the moment `x` pass between a and b? */
const hit = (a: number, b: number, x: number) => a < x && x <= b;
/** the moments of a regular beat (every `p` seconds from `t0`, n of them) that passed between a and b */
function beats(a: number, b: number, t0: number, p: number, n: number) {
  let c = 0;
  for (let i = 0; i < n; i++) if (hit(a, b, t0 + i * p)) c++;
  return c;
}

/** Where the pile of good `gd` stands (model space), as buildings.ts lays the piles out. */
export function pileOf(b: Building, anchor: Spot, gd: Good): Spot {
  let k = 0;
  for (const g of GOODS) {
    if (g === 'pig') continue;
    const n = g === gd ? 1 : b.stock[g];
    if (!n) continue;
    if (g === gd) break;
    k++;
    if (k > 3) break;
  }
  k = Math.min(k, 3);
  const isOut = b.def.outputs?.includes(gd);
  const off = isOut ? 0 : 1;
  return { x: anchor.x - off * 0.35 * (anchor.x > 0 ? 1 : -1) - k * 0.05, z: anchor.z - k * 0.3 };
}

/** A spot beside a pile, on the side of the open yard. */
function besidePile(c: Ctx, gd: Good, gap = 0.27): Spot {
  const p = pileOf(c.b, c.anchor, gd);
  const dx = c.layout.yard.x - p.x, dz = c.layout.yard.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: p.x + (dx / d) * gap, z: p.z + (dz / d) * gap };
}
const atOut = (c: Ctx) => besidePile(c, c.out);
const pileOut = (c: Ctx) => pileOf(c.b, c.anchor, c.out);
const inputOf = (c: Ctx) => (c.b.def.inputs?.[0]?.goods[0] ?? c.out);
const atIn = (c: Ctx) => besidePile(c, inputOf(c));
const pileIn = (c: Ctx) => pileOf(c.b, c.anchor, inputOf(c));

/** How hot metal glows: yellow-white, orange, dull red, dark. */
function heat(h: number, out: number[], gold = false) {
  h = clamp(h, 0, 1);
  out[0] = 1.7 * h ** 1.4;
  out[1] = (gold ? 0.95 : 0.46) * h ** 2.2;
  out[2] = 0.06 * h ** 4;
  return out;
}

// ------------------------------------------------------------------ poses (body space, settler units)
function breathe(P: Pose, time: number, seed: number) {
  P.bob = Math.sin(time * 1.6 + seed * 10) * 0.004;
  P.squash = Math.sin(time * 1.6 + seed * 10) * 0.008;
  P.armL = Math.sin(time * 0.7 + seed * 5) * 0.05;
  P.armR = -Math.sin(time * 0.7 + seed * 5) * 0.05;
  P.tilt = Math.sin(time * 0.6 + seed * 13) * 0.05;
}

function walkPose(P: Pose, ph: number) {
  const sw = Math.sin(ph);
  P.legL = sw * 0.7; P.legR = -sw * 0.7;
  P.armL = -sw * 0.6; P.armR = sw * 0.6;
  P.bob = Math.abs(Math.cos(ph)) * 0.03;
  P.squash = Math.cos(ph * 2) * 0.025;
  P.roll = sw * 0.06;
  P.tilt = -sw * 0.05;
  P.lean = 0.07;
  P.nod = Math.cos(ph * 2) * 0.03;
}

/** a good riding on the shoulder, steadied by the raised hand (as the carriers do) */
function shoulder(P: Pose) {
  P.armR = -2.75;
  P.splayR = 0.42;
  P.tilt -= 0.08;
}

/** bending down to a pile or the ground: k 0..1 how far down */
function stoop(P: Pose, k: number) {
  P.lean = 0.8 * k;
  P.nod = 0.25 * k;
  P.armL = P.armR = -1.05 * k;
  P.splayL = P.splayR = 0.1 + 0.05 * k;
  P.legL = 0.3 * k; P.legR = -0.12 * k;
  P.bob = -0.035 * k;
}
/** down and up again over the beat, the hands at the bottom at k = 0.5 */
const pickUp = (P: Pose, c: Ctx) => stoop(P, Math.sin(Math.PI * c.k));

/** holding something in both hands in front of the belly */
function holdFront(P: Pose, y = 0.26, z = 0.13, w = 0.06) {
  reach(P, -1, -w, y, z);
  reach(P, 1, w, y, z);
}

/** folded arms, weight on one leg, tapping the other foot */
function armsFolded(P: Pose, t: number, seed: number) {
  P.armL = P.armR = -1.35;
  P.splayL = P.splayR = -0.78;
  P.reachL = P.reachR = 0.85;
  P.roll = 0.05;
  P.nod = -0.04;
  P.legR = -Math.max(0, Math.sin(t * 7 + seed)) * 0.18 * win((t + seed * 5) % 6, 0.5, 3.5, 0.3);
  P.yaw = Math.sin(t * 0.4 + seed * 7) * 0.35;
  P.tilt = 0.12 + Math.sin(t * 0.33) * 0.05;
}

/** sitting on the step, elbows on the knees, chin in the hands now and then, looking down the road */
function sitWait(P: Pose, t: number, seed: number, h: number, look: number) {
  P.bob = -0.2 + h;
  P.legL = P.legR = -1.45;
  P.legSpL = P.legSpR = 0.1;
  const chin = win((t + seed * 11) % 9, 3, 6.5, 0.6);
  P.lean = 0.2 + 0.2 * chin;
  P.armL = P.armR = lerp(-1.05, -2.1, chin);
  P.splayL = P.splayR = lerp(-0.1, -0.45, chin);
  P.reachL = P.reachR = lerp(1, 0.75, chin);
  P.nod = lerp(0.05, -0.12, chin);
  // looks down the road for whoever should be bringing it, and sighs
  P.yaw = look * win((t + seed * 7) % 7, 1, 3, 0.5) + Math.sin(t * 0.3 + seed) * 0.15;
  const sigh = win((t + seed * 3) % 5.5, 0.2, 0.9, 0.25);
  P.squash = -0.03 * sigh;
}

/** hands on hips, then a shrug: nothing left to dig here */
function shrugPose(P: Pose, t: number, seed: number) {
  const s = win((t + seed * 4) % 4.2, 0.4, 1.3, 0.25);
  P.armL = P.armR = lerp(0.5, -0.45, s);
  P.splayL = P.splayR = lerp(0.85, 1.0, s);
  P.reachL = P.reachR = lerp(0.8, 1, s);
  P.bob = 0.025 * s;
  P.tilt = 0.18 * s;
  P.nod = lerp(0.2, -0.05, s);
  P.yaw = Math.sin(t * 2.3) * 0.3 * (1 - s) * win((t + seed * 4) % 4.2, 2, 3.8, 0.3);
}

/** the tool arm raised and brought down on a strike every `p` seconds; returns 0..1 of the arm's lift */
function strike(P: Pose, t: number, p: number, low = -1.0, high = -2.55) {
  const f = (t % p) / p;
  const a = kf(f, [0, 0.52, 0.7, 0.8, 1], [low - 0.25, high, low, low - 0.12, low - 0.25]);
  P.armR = a;
  P.splayR = 0.18;
  P.toolRot = kf(f, [0, 0.52, 0.7, 1], [1.2, 0.8, 1.55, 1.2]);
  return (a - low) / (high - low);
}

// ------------------------------------------------------------------ props
class HotBatch {
  mesh: THREE.InstancedMesh;
  glow: THREE.InstancedBufferAttribute;
  n = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number) {
    geo = geo.clone();
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glow);
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.visible = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    this.mesh = m;
  }
  add(m: THREE.Matrix4, g?: number[]) {
    if (this.n >= this.cap) return;
    this.mesh.setMatrixAt(this.n, m);
    if (g) this.glow.setXYZ(this.n, g[0], g[1], g[2]); else this.glow.setXYZ(this.n, 0, 0, 0);
    this.n++;
  }
  finish() {
    commitInstances(this.mesh, this.n, this.glow);
    this.n = 0;
  }
}

/** Props glow where hot: the per-instance aGlow colour is added as light and dims the paint under it. */
function hotMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  patchMaterial(m, {
    key: 'workprop',
    vertexHead: 'attribute vec3 aGlow;\nvarying vec3 vGlow;',
    vertexBegin: 'vGlow = aGlow;',
    fragHead: 'varying vec3 vGlow;',
    fragEmissive: 'totalEmissiveRadiance += vGlow; diffuseColor.rgb /= 1.0 + dot(vGlow, vec3(0.8));',
  });
  return m;
}

type PropKey = WorkGeo | Good;

// ------------------------------------------------------------------ per-building state
interface WS {
  seen: number;
  sid: number;
  /** drawn position (model space), heading and walk phase */
  x: number; z: number; head: number; ph: number;
  hidden: boolean;
  mode: 'scene' | 'wait' | 'linger' | 'in';
  /** what the pose came from last frame: when it changes the new pose blends in */
  src: string;
  from: Pose; last: Pose; bt: number;
  /** the beat and its local time last frame (for one-off effects) */
  beat: number; bt0: number;
  lastWork: number;
  /** the good being made this cycle */
  out: Good;
  /** where the target was last frame (how fast a scripted walk goes) */
  tx: number; tz: number; tkey: string;
  movers: Set<THREE.Object3D>;
}

/** The target a scene or a wait sets for this frame. */
interface Target {
  x: number; z: number; head: number;
  walk: boolean;
  beat: Beat | null;
  key: string;
  hide: boolean;
  pose: ((P: Pose) => void) | null;
}

export class WorkDirector {
  group = new THREE.Group();
  /** particle effects; set by the renderer */
  fx: Particles | null = null;
  /** positional sound; set by the renderer */
  sound: ((name: string, x: number, z: number, vol: number) => void) | null = null;
  /** the building renderer (positions, anchors, moving parts) */
  host: WorkHost | null = null;
  /** preview tool: draw every worker whatever the distance */
  force = false;
  /** buildings whose worker is out in the yard this frame (their generic sparks and sawdust stay off) */
  shown = new Set<number>();
  now = 0;
  private frame = 0;
  private lastNow = -1;
  private gdt = 0;
  private states = new Map<number, WS>();
  private batches = new Map<PropKey, HotBatch>();
  private cur: { st: WS; b: Building; c: Ctx; beat: Beat | null; v: WorkView } | null = null;
  private tgt: Target = { x: 0, z: 0, head: 0, walk: false, beat: null, key: '', hide: false, pose: null };
  private P = resetPose({} as Pose);
  // scratch
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private m3 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private v5 = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private glow = [0, 0, 0];
  private hands: { body: THREE.Matrix4; L: THREE.Matrix4; R: THREE.Matrix4 } | null = null;

  constructor(private game: Game, private scale: number, goodGeos: Record<Good, THREE.BufferGeometry>) {
    const mat = hotMaterial();
    const geos = buildWorkGeos();
    for (const [k, g] of Object.entries(geos)) this.batches.set(k as WorkGeo, new HotBatch(g, mat, 48));
    for (const gd of GOODS) this.batches.set(gd, new HotBatch(goodGeos[gd], mat, 48));
    for (const b of this.batches.values()) this.group.add(b.mesh);
  }

  begin() {
    this.frame++;
    this.now = this.game.time;
    this.gdt = this.lastNow < 0 ? 0 : clamp(this.now - this.lastNow, 0, 0.1);
    this.lastNow = this.now;
    this.shown.clear();
    this.cur = null;
  }

  /**
   * A worker indoors: if his workshop is in view and close, work out where he is in his scene and
   * fill P with his pose; null when he stays indoors (then nothing of him is drawn).
   */
  shot(s: Settler, P: Pose): Shot | null {
    this.cur = null;
    const g = this.game;
    const b = g.buildings.get(s.inside);
    if (!b || b.state !== 'done' || b.owner !== s.owner) return null;
    const scene = SCENES[b.type];
    if (!scene || !(scene.who ? scene.who(b, s) : b.worker === s.id)) return null;
    const v = this.host?.workView(b.id);
    if (!v || !v.visible) return null;
    if (!this.force) {
      if (lodView.cull(b.cx, v.y + 0.5, b.cz, b.size * 0.9) !== 2) return null;
      if (lodView.px(b.cx, v.y, b.cz) < PX_MIN) return null;
    }
    let st = this.states.get(b.id);
    const fresh = !st || st.seen < this.frame - 1 || st.sid !== s.id;
    if (!st) {
      st = {
        seen: 0, sid: s.id, x: 0, z: 0, head: 0, ph: 0, hidden: true, mode: 'in', src: '', from: resetPose({} as Pose), last: resetPose({} as Pose),
        bt: 0, beat: -1, bt0: 0, lastWork: -1e9, out: 'iron', movers: new Set(), tx: 0, tz: 0, tkey: '',
      };
      this.states.set(b.id, st);
    }
    st.seen = this.frame;
    st.sid = s.id;
    const anchor = v.anchors.piles[0] ?? { x: 0, z: 1 };
    const u = scene.clock ? scene.clock(b, s) : b.working && b.def.cycle ? b.workT / b.def.cycle : null;
    if (u !== null) {
      st.lastWork = this.now;
      st.out = ((b as { curOut?: Good }).curOut) ?? scene.good?.(b, s) ?? b.def.outputs?.[0] ?? 'iron';
    }
    const c: Ctx = { b, dir: this, out: st.out, t: 0, d: 1, k: 0, u: 0, walking: false, anchor, layout: scene.layout, seed: s.seed };
    const cur = (this.cur = { st, b, c, beat: null as Beat | null, v });
    const T = this.target(b, st, scene, c, u);
    cur.beat = T.beat;

    // --- move towards the target, walking when it is more than a step away
    const dt = this.gdt;
    let moved = 0;
    if (fresh) {
      st.x = T.x; st.z = T.z; st.head = T.head;
      st.hidden = T.hide || T.x === scene.layout.door.x && T.z === scene.layout.door.z && st.mode === 'in';
      st.src = '';
    } else if (st.hidden && !T.hide && st.mode !== 'in') {
      // out of the door he comes (straight into his scene when it starts at the door)
      st.hidden = false;
      const L = scene.layout;
      const near = Math.hypot(T.x - L.door.x, T.z - L.door.z) < 0.6;
      st.x = near ? T.x : L.door.x; st.z = near ? T.z : L.door.z;
      if (near) st.head = T.head;
    }
    let walking = T.walk;
    if (!fresh) {
      const dx = T.x - st.x, dz = T.z - st.z, d = Math.hypot(dx, dz);
      // keep up with a scripted walk, and close any gap (a pile that moved) at walking pace
      const scripted = T.walk && T.key === st.tkey ? Math.hypot(T.x - st.tx, T.z - st.tz) : 0;
      const stepMax = WALK * dt + scripted;
      if (d <= Math.max(0.025, stepMax)) { moved = d; st.x = T.x; st.z = T.z; }
      else {
        moved = WALK * dt;
        st.x += (dx / d) * moved; st.z += (dz / d) * moved;
        walking = true;
      }
      const want = walking && moved > 1e-4 ? Math.atan2(dx, dz) : T.head;
      st.head += wrap(want - st.head) * (1 - Math.exp(-dt * 12));
    }
    st.tx = T.x; st.tz = T.z; st.tkey = T.key;
    st.ph += moved * STRIDE;
    if (st.mode === 'in' && !walking && Math.hypot(st.x - scene.layout.door.x, st.z - scene.layout.door.z) < 0.03) st.hidden = true;
    if (T.hide) st.hidden = true;
    else if (st.hidden && st.mode !== 'in') st.hidden = false;

    // --- pose
    const key = `${T.key}${walking ? 'w' : ''}`;
    if (key !== st.src) {
      if (st.src) copyPose(st.from, st.last);
      else copyPose(st.from, resetPose(this.P));
      st.src = key;
      st.bt = 0;
    }
    st.bt += dt;
    resetPose(P);
    if (walking) walkPose(P, st.ph);
    else breathe(P, this.now, s.seed);
    if (T.beat?.carry) shoulder(P);
    c.walking = walking;
    if (T.pose) T.pose(P);
    if (st.bt < BLEND && st.src) mixPose(P, st.from, sm(0, BLEND, st.bt));
    copyPose(st.last, P);

    // --- yard things, moving parts and one-off effects run even while he is indoors
    const beat = T.beat;
    if (beat?.yard) beat.yard(c, this);
    if (st.hidden) {
      this.cur = null;
      return null;
    }
    this.shown.add(b.id);
    const tool = beat ? (typeof beat.tool === 'function' ? beat.tool(c) : beat.tool) : st.mode === 'wait' ? null : undefined;
    const carry = beat?.carry === 'out' ? st.out : (beat?.carry ?? null);
    const fl = scene.layout.floor;
    return {
      x: b.cx + st.x, y: v.y + (fl ? fl(st.x, st.z) : 0), z: b.cz + st.z,
      heading: st.head, tool, carry,
    };
  }

  /** What the worker should be doing now: his scene while the building works, the stall while it waits, else indoors. */
  private target(b: Building, st: WS, scene: Scene, c: Ctx, u: number | null): Target {
    const T = this.tgt;
    T.beat = null; T.pose = null; T.hide = false; T.walk = false;
    const L = scene.layout;
    const now = this.now;
    const time = now;
    const seed = c.seed;
    if (u !== null) {
      st.mode = 'scene';
      this.evalScene(scene, st, c, T, u);
      return T;
    }
    const stall = b.stall;
    const age = stall ? now - b.stallT : 0;
    if (stall && age > WAIT_DELAY && (stall.kind === 'input' || stall.kind === 'full' || stall.kind === 'exhausted')) {
      st.mode = 'wait';
      T.key = `wait:${stall.kind}`;
      if (stall.kind === 'input') {
        const road = { x: L.sit.x + 1, z: L.sit.z + 3 };
        const look = wrap(Math.atan2(road.x - L.sit.x, road.z - L.sit.z) - L.sit.face);
        T.x = L.sit.x; T.z = L.sit.z; T.head = L.sit.face;
        T.pose = (P) => sitWait(P, time, seed, L.sit.h ?? 0, clamp(look, -1, 1));
      } else if (stall.kind === 'full') {
        const p = besidePile(c, c.out, 0.3);
        const pile = pileOut(c);
        T.x = p.x; T.z = p.z;
        // his back half to the pile, facing the yard
        T.head = Math.atan2(p.x - pile.x, p.z - pile.z) + 0.6;
        T.pose = (P) => armsFolded(P, time, seed);
      } else {
        T.x = L.door.x; T.z = L.door.z + 0.3; T.head = 0;
        T.pose = (P) => shrugPose(P, time, seed);
      }
      return T;
    }
    if (now - st.lastWork < LINGER && st.mode !== 'in') {
      st.mode = 'linger';
      T.key = 'linger';
      T.x = st.x; T.z = st.z; T.head = st.head;
      return T;
    }
    st.mode = 'in';
    T.key = 'in';
    T.x = L.door.x; T.z = L.door.z; T.head = Math.PI;
    return T;
  }

  private resolve(r: SpotRef, c: Ctx): Spot {
    return typeof r === 'function' ? r(c) : r;
  }

  /** Where the scene has the worker now. */
  private evalScene(sc: Scene, st: WS, c: Ctx, T: Target, u: number) {
    const beats = sc.pick?.(c.out) ?? sc.beats;
    const total = sceneTotal(beats);
    const cycle = c.b.def.cycle ?? 6;
    const k = clamp(u, 0, 0.99999);
    const time = k * total;
    const scale = cycle / total;
    // the end of the loop is where each cycle starts from
    let x = sc.layout.door.x, z = sc.layout.door.z, head = 0;
    const step = (bt: Beat) => {
      if (bt.to) {
        const p = this.resolve(bt.to, c);
        if (Math.hypot(p.x - x, p.z - z) > 0.01) head = Math.atan2(p.x - x, p.z - z);
        x = p.x; z = p.z;
      }
      if (bt.face !== undefined) head = typeof bt.face === 'number' ? bt.face : ((p) => Math.atan2(p.x - x, p.z - z))(this.resolve(bt.face, c));
    };
    for (const bt of beats) step(bt);
    let i = 0, acc = 0;
    while (i < beats.length - 1 && acc + beats[i].d <= time) { step(beats[i]); acc += beats[i].d; i++; }
    const bt = beats[i];
    const lk = clamp((time - acc) / bt.d, 0, 1);
    c.u = k; c.k = lk; c.d = bt.d * scale; c.t = lk * c.d;
    const sx = x, sz = z;
    let walk = false;
    if (bt.to) {
      const p = this.resolve(bt.to, c);
      const d = Math.hypot(p.x - sx, p.z - sz);
      if (d > 0.02) {
        walk = lk > 0 && lk < 1;
        const e = ease(lk);
        x = lerp(sx, p.x, e); z = lerp(sz, p.z, e);
        head = Math.atan2(p.x - sx, p.z - sz);
      } else { x = p.x; z = p.z; }
    }
    if (!walk && bt.face !== undefined) head = typeof bt.face === 'number' ? bt.face : ((p) => Math.atan2(p.x - x, p.z - z))(this.resolve(bt.face, c));
    T.x = x; T.z = z; T.head = head; T.walk = walk; T.beat = bt; T.hide = !!bt.hide;
    T.key = `b${i}${beats === sc.beats ? '' : 'p'}`;
    T.pose = bt.pose ? (P) => bt.pose!(P, c) : null;
    // one-off effects for the time that passed within this beat
    const a = st.beat === i ? st.bt0 : -1e-6;
    if (bt.fx && c.t > a) bt.fx(c, a, c.t);
    st.beat = i;
    st.bt0 = c.t;
  }

  // ------------------------------------------------------------ helpers for the scenes
  /** building space → world */
  w(x: number, y: number, z: number, out = this.v1) {
    const cur = this.cur!;
    return out.set(cur.b.cx + x, cur.v.y + y, cur.b.cz + z);
  }
  snd(name: string, vol = 1) {
    const b = this.cur!.b;
    this.sound?.(name, b.cx, b.cz, vol);
  }
  heat(h: number, gold = false) {
    return heat(h, this.glow, gold);
  }
  /** a prop at a world point, turned by ry about y (then rx, rz), scaled by s */
  worldProp(k: PropKey, p: THREE.Vector3, ry = 0, glow?: number[], s = 1, rx = 0, rz = 0) {
    this.q.setFromEuler(this.e.set(rx, ry, rz, 'YXZ'));
    this.batches.get(k)!.add(this.m.compose(p, this.q, this.sc.set(s, s, s)), glow);
  }
  /** a prop lying in the yard (building space) */
  yardProp(k: PropKey, x: number, y: number, z: number, ry = 0, glow?: number[], s = 1, rx = 0, rz = 0) {
    this.worldProp(k, this.w(x, y, z, this.v3), ry, glow, s, rx, rz);
  }
  /** a prop placed in body space (settler units, +z ahead, +y up) */
  bodyProp(k: PropKey, local: THREE.Matrix4, glow?: number[]) {
    this.m.copy(this.hands!.body).multiply(local);
    this.batches.get(k)!.add(this.m, glow);
  }
  /** world position of a point in body space, optionally inside a prop placed by `local` */
  bodyAt(local: THREE.Matrix4 | null, x: number, y: number, z: number, out = this.v1) {
    out.set(x, y, z);
    if (local) out.applyMatrix4(local);
    return out.applyMatrix4(this.hands!.body);
  }
  /** world position of a hand; `along` further down the line of a tool held at toolRot */
  handPoint(side: -1 | 1, out = this.v1, toolRot = 0, along = 0) {
    this.m.copy(side < 0 ? this.hands!.L : this.hands!.R).multiply(this.m2.makeTranslation(0, RIG.handY, 0.01));
    if (along) this.m.multiply(this.m2.makeRotationX(toolRot)).multiply(this.m2.makeTranslation(0, -0.11 + along * 0.9, 0));
    return out.set(0, 0, 0).applyMatrix4(this.m);
  }
  /** a prop by a hand: at the hand, then moved by `local` (hand space: -y runs on down the arm) */
  handProp(k: PropKey, side: -1 | 1, local: THREE.Matrix4 | null, glow?: number[]) {
    this.m.copy(side < 0 ? this.hands!.L : this.hands!.R).multiply(this.m2.makeTranslation(0, RIG.handY, 0.01));
    if (local) this.m.multiply(local);
    this.batches.get(k)!.add(this.m, glow);
  }
  /** a hand tool (handle up +y from its end) gripped in the tool hand the way the settlers hold theirs */
  toolProp(k: PropKey, toolRot: number, glow?: number[]) {
    this.handProp(k, 1, this.m3.makeRotationX(toolRot).multiply(this.m2.makeTranslation(0, -0.11, 0)).scale(this.sc.setScalar(0.9)), glow);
  }
  /** a rod-like prop (grip at its origin, running up +y) from world point `from` towards `to`, len long (default: settler scale) */
  rodProp(k: PropKey, from: THREE.Vector3, to: THREE.Vector3, glow?: number[], len = this.scale, thick = this.scale) {
    const dir = this.v2.subVectors(to, from);
    const l = dir.length() || 1;
    dir.divideScalar(l);
    this.q.setFromUnitVectors(UP, dir);
    this.batches.get(k)!.add(this.m.compose(from, this.q, this.sc.set(thick, len, thick)), glow);
  }
  /** Tongs from the left hand towards a world point; returns where the jaws hold the work (and its heading in jawYaw). */
  tongsTo(target: THREE.Vector3, out = this.v4) {
    const hand = this.handPoint(-1, this.v5);
    this.rodProp('tongs', hand, target);
    const dx = target.x - hand.x, dy = target.y - hand.y, dz = target.z - hand.z;
    const l = Math.hypot(dx, dy, dz) || 1, j = 0.285 * this.scale;
    this.jawYaw = Math.atan2(dx, dz) - Math.PI / 2;
    return out.set(hand.x + (dx / l) * j, hand.y + (dy / l) * j, hand.z + (dz / l) * j);
  }
  jawYaw = 0;
  /** the building's named moving part (e.g. the bellows); remembers its rest pose so it can be put back */
  mover(name: string): THREE.Object3D[] {
    const cur = this.cur!;
    const out: THREE.Object3D[] = [];
    for (const o of cur.v.movers) {
      if (o.name !== name) continue;
      if (!o.userData.rest) o.userData.rest = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
      cur.st.movers.add(o);
      out.push(o);
    }
    return out;
  }
  get particles() { return this.fx; }

  /** Draws what the worker holds (called by the settler renderer with his body and arm matrices). */
  props(body: THREE.Matrix4, armL: THREE.Matrix4, armR: THREE.Matrix4) {
    const cur = this.cur;
    if (!cur || !cur.beat?.props) return;
    this.hands = { body, L: armL, R: armR };
    cur.beat.props(cur.c, this);
    this.hands = null;
  }

  end() {
    for (const b of this.batches.values()) b.finish();
    this.cur = null;
    // workshops that just dropped out of view put their moving parts back
    for (const [id, st] of this.states) {
      if (st.seen === this.frame) continue;
      if (st.movers.size) {
        for (const o of st.movers) {
          const r = o.userData.rest;
          if (r) { o.position.copy(r.p); o.rotation.copy(r.r); o.scale.copy(r.s); o.visible = true; }
        }
        st.movers.clear();
      }
      if (st.seen < this.frame - 600 || !this.game.buildings.has(id)) this.states.delete(id);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const totals = new WeakMap<Beat[], number>();
function sceneTotal(beats: Beat[]) {
  let t = totals.get(beats);
  if (t === undefined) { t = beats.reduce((a, b) => a + b.d, 0); totals.set(beats, t); }
  return t;
}

// scratch for scene code
const M = new THREE.Matrix4(), M2 = new THREE.Matrix4();
const E = new THREE.Euler();
const VA = new THREE.Vector3(), VB = new THREE.Vector3();
/** translate, then rotate (x, y, z in 'XYZ' order), then scale */
function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) {
  M.makeRotationFromEuler(E.set(rx, ry, rz));
  M.setPosition(x, y, z);
  if (s !== 1) M.scale(VA.set(s, s, s));
  return M;
}

// ------------------------------------------------------------------ the smiths
/** the head the smith is shaping for each tool (plain bar for anything else) */
const HEADS: Partial<Record<Good, WorkGeo>> = {
  axe: 'h_axe', pickaxe: 'h_pickaxe', saw: 'h_saw', hammer: 'h_hammer', shovel: 'h_shovel', scythe: 'h_scythe', rod: 'h_rod', sword: 'h_sword',
};
const headOf = (c: Ctx): WorkGeo => HEADS[c.out] ?? 'blank';

interface Forge {
  /** the glowing coals of the hearth (building space) */
  coals: { x: number; y: number; z: number };
  /** where he stands to heat the metal and to hammer it, and the face of the anvil */
  hearthSpot: Spot;
  anvil: { x: number; y: number; z: number };
  anvilSpot: Spot;
}

/** Hot work carried in the tongs, held out ahead of him while he walks. */
function carryHot(c: Ctx, d: WorkDirector, key: PropKey, h: number) {
  const jaws = d.tongsTo(d.bodyAt(null, -0.06, 0.2, 0.5, VA));
  d.worldProp(key, jaws, d.jawYaw, d.heat(h));
}

/** The forge work shared by both smiths: fetch a bar, heat it, hammer it into shape. */
function forgeBeats(f: Forge): Beat[] {
  const toHearth = Math.atan2(f.coals.x - f.hearthSpot.x, f.coals.z - f.hearthSpot.z);
  const toAnvil = Math.atan2(f.anvil.x - f.anvilSpot.x, f.anvil.z - f.anvilSpot.z);
  const P_STRIKE = 0.42, N_STRIKE = 6;
  return [
    // fetch an iron bar from the pile
    { d: 0.8, to: atIn, tool: null },
    { d: 0.45, face: pileIn, tool: null, pose: pickUp },
    {
      d: 0.7, to: f.hearthSpot, tool: null,
      pose: (P) => holdFront(P, 0.27, 0.12, 0.05),
      props: (_c, d) => d.bodyProp('iron', trs(0, 0.2, 0.15, 0, Math.PI / 2, 0)),
    },
    // into the coals with it: the bar glows up, the coals flare
    {
      d: 1.6, face: toHearth,
      pose: (P, c) => {
        P.lean = 0.28; P.nod = 0.3;
        reach(P, -1, -0.03, 0.25, 0.19);
        P.armR = -0.3; P.splayR = 0.45;
        P.legL = 0.25; P.legR = -0.1;
        P.twist = Math.sin(c.t * 2.2) * 0.06;
      },
      props: (c, d) => {
        const jaws = d.tongsTo(d.w(f.coals.x, f.coals.y + 0.01, f.coals.z, VA));
        d.worldProp('blank', jaws, d.jawYaw, d.heat(Math.min(1, c.k * 1.15)));
      },
      fx: (c, a, b) => {
        const P = c.dir.particles;
        const n = Math.floor(b * 7) - Math.floor(a * 7);
        if (P) for (let i = 0; i < n; i++) {
          const w = c.dir.w(f.coals.x, f.coals.y, f.coals.z);
          P.fire(w.x, w.y, w.z, 0.2 + 0.12 * c.k);
        }
        if (hit(a, b, 0.2)) c.dir.snd('fire', 0.35);
      },
    },
    // round to the anvil
    { d: 0.3, to: f.anvilSpot, face: toAnvil, props: (_c, d) => carryHot(_c, d, 'blank', 1) },
    // and hammer it into shape, sparks flying at every blow
    {
      d: N_STRIKE * P_STRIKE + 0.1, face: toAnvil,
      pose: (P, c) => {
        P.lean = 0.2; P.nod = 0.32;
        P.legL = 0.3; P.legR = -0.15;
        reach(P, -1, -0.08, 0.22, 0.15);
        const lift = strike(P, c.t, P_STRIKE);
        P.twist = 0.08 * lift;
      },
      props: (c, d) => {
        const n = Math.min(N_STRIKE, Math.floor((c.t + P_STRIKE * 0.3) / P_STRIKE));
        const key = n >= 3 ? headOf(c) : 'blank';
        const p = d.w(f.anvil.x, f.anvil.y, f.anvil.z, VB);
        d.worldProp(key, p, 0.15, d.heat(1 - 0.4 * n / N_STRIKE), 1, 0, 0);
        d.tongsTo(d.w(f.anvil.x - 0.05, f.anvil.y + 0.01, f.anvil.z, VA));
      },
      fx: (c, a, b) => {
        for (let i = 0; i < N_STRIKE; i++) {
          if (!hit(a, b, i * P_STRIKE + P_STRIKE * 0.7)) continue;
          const w = c.dir.w(f.anvil.x, f.anvil.y + 0.03, f.anvil.z);
          c.dir.particles?.sparks(w.x, w.y, w.z, 8 - i);
          c.dir.snd('anvil', 0.6);
        }
      },
    },
  ];
}

// The toolsmith (buildingModels.toolsmith): hearth at (-0.35, 0.62), the anvil on its stump at
// (0.07, 0.87) with its horn to +x, the water barrel at (0.95, 0.7), the pile anchor at (-1.0, 0.75).
const TS_FORGE: Forge = {
  coals: { x: -0.32, y: 0.36, z: 0.63 },
  hearthSpot: { x: 0.02, z: 0.64 },
  anvil: { x: 0.06, y: 0.272, z: 0.87 },
  anvilSpot: { x: 0.06, z: 0.66 },
};
const TS_WATER = { x: 0.95, y: 0.2, z: 0.7 };
const TS_QUENCH: Spot = { x: 0.71, z: 0.78 };

const toolsmithScene: Scene = {
  layout: {
    door: { x: -0.65, z: 0.1 },
    sit: { x: -0.65, z: 0.12, face: 0, h: 0.07 },
    yard: { x: -0.3, z: 1.2 },
  },
  good: () => 'hammer',
  beats: [
    ...forgeBeats(TS_FORGE),
    // over to the barrel with it
    { d: 0.55, to: TS_QUENCH, pose: (P) => reach(P, -1, -0.06, 0.26, 0.16), props: (c, d) => carryHot(c, d, headOf(c), 0.6) },
    // and quench it: a hiss and a cloud of steam
    {
      d: 0.75, face: TS_WATER,
      pose: (P, c) => {
        const dip = win(c.k, 0.2, 0.75, 0.12);
        P.lean = 0.25 + 0.3 * dip; P.nod = 0.35;
        reach(P, -1, -0.04, 0.27 - 0.07 * dip, 0.2);
      },
      props: (c, d) => {
        const dip = win(c.k, 0.2, 0.75, 0.12);
        const jaws = d.tongsTo(d.w(TS_WATER.x, TS_WATER.y + 0.28 - 0.3 * dip, TS_WATER.z, VA));
        d.worldProp(headOf(c), jaws, d.jawYaw, d.heat(0.6 * (1 - sm(0.2, 0.45, c.k))));
      },
      fx: (c, a, b) => {
        if (!hit(a, b, c.d * 0.3)) return;
        c.dir.snd('hiss', 0.7);
        const w = c.dir.w(TS_WATER.x, TS_WATER.y + 0.05, TS_WATER.z);
        const P = c.dir.particles;
        if (P) for (let i = 0; i < 6; i++) P.emit({ x: w.x, y: w.y, z: w.z, vy: 0.7, spread: 0.3, life: 1.4, size: 0.12, grow: 2.6, color: [0.95, 0.95, 0.97], alpha: 0.5, drag: 1.2, jitter: 0.1 });
      },
    },
    // holds it up to the light: a good one
    {
      d: 0.8, face: 0.35, tool: (c) => c.out,
      pose: (P, c) => {
        const up = sm(0, 0.35, c.k) * (1 - sm(0.85, 1, c.k));
        P.armR = lerp(-0.6, -2.5, up); P.splayR = 0.25;
        P.toolRot = lerp(1.3, 0.25, up);
        P.nod = -0.25 * up; P.yaw = 0.25 * up;
        P.armL = 0.35; P.splayL = 0.7;
      },
    },
    // onto the pile
    { d: 0.9, to: atOut, tool: null, carry: 'out' },
    { d: 0.4, face: pileOut, tool: null, pose: pickUp },
  ],
};

// ------------------------------------------------------------------ the smelters
// Iron and gold smelter (buildingModels.ironsmelter / goldsmelter): the furnace at (0.72, 0.15)
// with its mouth to the yard, the bellows on its right flank worked from their handle at +x, a clay
// mould in front at (0.72, 0.97), the ore and coal heaps on the left, the pile anchor at (0.15, 1.05).
const FURNACE_MOUTH = { x: 0.72, y: 0.24, z: 0.45 };
const FURNACE_SPOT: Spot = { x: 0.72, z: 0.66 };
/** his back to the furnace mouth, the mould under the crucible he holds out */
const POUR_SPOT: Spot = { x: 0.72, z: 0.56 };
const BELLOWS_SPOT: Spot = { x: 1.44, z: 0.3 };
const MOULD = { x: 0.72, y: 0.065, z: 0.97 };
const CRUCIBLE = (tip: number, y = 0.3) => trs(0, y, 0.34, 0, 0, -1.7 * tip, 0.95);

function smelterScene(gold: boolean): Scene {
  const heap: Spot = gold ? { x: -0.78, z: 0.74 } : { x: -0.9, z: 0.68 };
  const heapSpot: Spot = { x: heap.x + 0.05, z: heap.z + 0.34 };
  const ore: Good = gold ? 'goldore' : 'ironore';
  const bar: Good = gold ? 'gold' : 'iron';
  const hot = (d: WorkDirector, h: number) => d.heat(h, gold);
  /** a lump of ore on the shovel's blade */
  const lump = (d: WorkDirector, rot: number) => d.worldProp(ore, d.handPoint(1, VA, rot, 0.38), 0, undefined, 0.9);
  const holdCrucible = (P: Pose, y = 0.3) => { reach(P, -1, -0.015, y + 0.03, 0.09); reach(P, 1, 0.015, y + 0.035, 0.15); };
  return {
    layout: {
      door: { x: -0.3, z: 0.24 },
      sit: { x: -0.3, z: 0.25, face: 0, h: 0.07 },
      yard: { x: 0.35, z: 1.25 },
    },
    good: () => bar,
    beats: [
      // a shovelful of ore and coal from the heaps
      { d: 1.05, to: heapSpot, tool: 'shovel' },
      {
        d: 0.6, face: heap, tool: 'shovel',
        pose: (P, c) => {
          const k = Math.sin(c.k * Math.PI);
          P.armL = P.armR = -0.9 + k * 0.45; P.splayL = 0.05;
          P.lean = 0.3 + k * 0.25; P.nod = 0.25;
          P.legL = 0.3; P.legR = -0.15;
          P.toolRot = 2.3;
        },
        props: (c, d) => { if (c.k > 0.55) lump(d, 2.3); },
        fx: (c, a, b) => {
          if (!hit(a, b, c.d * 0.45)) return;
          c.dir.snd('dig', 0.5);
          const w = c.dir.w(heap.x, 0.05, heap.z);
          c.dir.particles?.dust(w.x, w.y, w.z, 3, gold ? [0.55, 0.48, 0.3] : [0.35, 0.3, 0.28]);
        },
      },
      {
        d: 0.9, to: FURNACE_SPOT, tool: 'shovel',
        pose: (P) => { P.armR = -0.95; P.splayR = 0.1; P.armL = -0.8; P.splayL = -0.2; P.toolRot = 1.75; },
        props: (_c, d) => lump(d, 1.75),
      },
      // into the furnace mouth with it: the fire roars up
      {
        d: 0.5, face: FURNACE_MOUTH, tool: 'shovel',
        pose: (P, c) => {
          const th = sm(0.1, 0.55, c.k);
          P.armR = lerp(-0.95, -1.5, th); P.armL = lerp(-0.8, -1.3, th); P.splayL = -0.2;
          P.lean = 0.1 + 0.25 * th; P.toolRot = lerp(1.75, 1.2, th);
          P.legL = 0.35 * th; P.legR = -0.2 * th;
        },
        props: (c, d) => { if (c.k < 0.5) lump(d, lerp(1.75, 1.2, sm(0.1, 0.55, c.k))); },
        fx: (c, a, b) => {
          if (!hit(a, b, c.d * 0.5)) return;
          const w = c.dir.w(FURNACE_MOUTH.x, FURNACE_MOUTH.y, FURNACE_MOUTH.z + 0.05);
          const P = c.dir.particles;
          if (P) { for (let i = 0; i < 3; i++) P.fire(w.x, w.y, w.z, 0.3); P.sparks(w.x, w.y + 0.05, w.z, 6); }
          c.dir.snd('fire', 0.4);
        },
      },
      // work the bellows: every stroke brightens the fire
      { d: 0.5, to: BELLOWS_SPOT, face: -Math.PI / 2, tool: null },
      {
        d: 1.2, face: -Math.PI / 2, tool: null,
        pose: (P, c) => {
          const down = Math.sin(((c.t / 0.35) % 1) * Math.PI);
          reach(P, -1, -0.05, 0.28 - 0.08 * down, 0.14);
          reach(P, 1, 0.05, 0.28 - 0.08 * down, 0.14);
          P.lean = 0.25 + 0.2 * down; P.nod = 0.15;
          P.bob = -0.02 * down;
        },
        yard: (c, d) => {
          const down = Math.sin(((c.t / 0.35) % 1) * Math.PI);
          for (const o of d.mover('bellows')) o.rotation.z = 0.3 * (1 - down);
        },
        fx: (c, a, b) => {
          if (!beats(a, b, 0.175, 0.35, 8)) return;
          const w = c.dir.w(FURNACE_MOUTH.x, FURNACE_MOUTH.y, FURNACE_MOUTH.z + 0.04);
          const P = c.dir.particles;
          if (P) { P.fire(w.x, w.y, w.z, 0.28); P.fire(w.x, w.y, w.z, 0.2); }
          c.dir.snd('bellows', 0.5);
          const ch = c.dir.w(0.855, 1.97, -0.06);
          if (P && Math.random() < 0.5) P.smoke(ch.x, ch.y, ch.z, 0.6, 1.2);
        },
      },
      // take the crucible out of the fire
      { d: 0.5, to: FURNACE_SPOT, face: Math.PI, tool: null, yard: (_c, d) => { for (const o of d.mover('bellows')) o.rotation.z = 0; } },
      {
        d: 0.45, face: Math.PI, tool: null,
        pose: (P, c) => {
          const k = Math.sin(c.k * Math.PI);
          P.lean = 0.15 + 0.3 * k; P.nod = 0.3;
          holdCrucible(P, 0.3 - 0.07 * k);
        },
        props: (c, d) => {
          if (c.k < 0.35) return;
          d.bodyProp('crucible', CRUCIBLE(0, 0.3 - 0.07 * Math.sin(c.k * Math.PI)));
          d.bodyProp('melt', M, hot(d, 1));
        },
      },
      // turn round to the mould and pour
      {
        d: 0.3, to: POUR_SPOT, face: 0, tool: null,
        pose: (P) => { holdCrucible(P); P.lean = 0.12; P.nod = 0.3; },
        props: (_c, d) => { d.bodyProp('crucible', CRUCIBLE(0)); d.bodyProp('melt', M, hot(d, 1)); },
      },
      {
        d: 0.8, face: 0, tool: null,
        pose: (P, c) => {
          const tip = sm(0, 0.3, c.k) * (1 - sm(0.85, 1, c.k));
          P.lean = 0.12 + 0.1 * tip; P.nod = 0.35;
          holdCrucible(P, 0.3 + 0.02 * tip);
          P.twist = -0.08 * tip;
        },
        props: (c, d) => {
          const tip = sm(0, 0.3, c.k) * (1 - sm(0.85, 1, c.k));
          const m = CRUCIBLE(tip);
          d.bodyProp('crucible', m);
          if (c.k < 0.8) d.bodyProp('melt', m, hot(d, 1));
          if (tip > 0.6 && c.k < 0.82) {
            // the melt runs over the lowest point of the rim straight down into the mould
            const lip = d.bodyAt(m, 0.048, 0.05, 0, VA);
            const top = VB.set(lip.x, d.w(MOULD.x, MOULD.y + 0.03, MOULD.z, VB).y, lip.z);
            d.rodProp('stream', top, lip, hot(d, 1), Math.max(0.01, lip.y - top.y), 1.3);
          }
        },
        yard: (c, d) => {
          if (c.k > 0.35) d.yardProp(bar, MOULD.x, MOULD.y - 0.03, MOULD.z, 0, hot(d, 1), 0.2 + 0.72 * sm(0.35, 0.8, c.k));
        },
        fx: (c, a, b) => {
          if (hit(a, b, c.d * 0.35)) c.dir.snd('hiss', 0.4);
          const P = c.dir.particles;
          if (P && c.k > 0.35 && c.k < 0.85 && Math.floor(b * 12) !== Math.floor(a * 12)) {
            const w = c.dir.w(MOULD.x, MOULD.y + 0.04, MOULD.z);
            P.sparks(w.x, w.y, w.z, 2);
          }
        },
      },
      // the bar cools in the mould while he puts the crucible down and wipes his brow
      {
        d: 0.8, face: 0.4, tool: null,
        pose: (P, c) => {
          const wipe = win(c.k, 0.15, 0.55, 0.12);
          P.armL = lerp(0.2, -2.6, wipe); P.splayL = lerp(0.4, -0.12, wipe);
          P.armR = 0.45; P.splayR = 0.8;
          P.nod = -0.12 * wipe; P.tilt = 0.12 * wipe;
          P.squash = -0.02 * win(c.k, 0.6, 0.8, 0.1);
        },
        yard: (c, d) => {
          d.yardProp(bar, MOULD.x, MOULD.y - 0.03, MOULD.z, 0, hot(d, 1 - 0.85 * c.k), 0.92);
          d.yardProp('crucible', MOULD.x - 0.27, 0, MOULD.z + 0.02, 1.2);
        },
        fx: (c, a, b) => {
          const P = c.dir.particles;
          if (!P || Math.floor(b * 3) === Math.floor(a * 3)) return;
          const w = c.dir.w(MOULD.x, MOULD.y + 0.05, MOULD.z);
          P.emit({ x: w.x, y: w.y, z: w.z, vy: 0.35, spread: 0.1, life: 1.2, size: 0.07, grow: 2, color: [0.8, 0.8, 0.82], alpha: 0.3, drag: 1 });
        },
      },
      {
        d: 0.35, face: MOULD, tool: null, pose: pickUp,
        yard: (c, d) => {
          if (c.k < 0.5) d.yardProp(bar, MOULD.x, MOULD.y - 0.03, MOULD.z, 0, hot(d, 0.15), 0.92);
          d.yardProp('crucible', MOULD.x - 0.27, 0, MOULD.z + 0.02, 1.2);
        },
      },
      // and onto the stack
      { d: 0.75, to: atOut, tool: null, carry: bar },
      { d: 0.35, face: pileOut, tool: null, pose: pickUp },
    ],
  };
}

// ------------------------------------------------------------------ the weaponsmith
// buildingModels.weaponsmith: hearth at (-0.8, 0.6) with its anvil at (-0.38, 0.85), the front door
// at (-0.4, 0.05), swords leaning on a rail at (0.38, 0.62), a grindstone at (0.86, 0.76), the pile
// anchor at (0.1, 1.0).
const WS_FORGE: Forge = {
  coals: { x: -0.78, y: 0.36, z: 0.61 },
  hearthSpot: { x: -0.43, z: 0.63 },
  anvil: { x: -0.38, y: 0.272, z: 0.85 },
  anvilSpot: { x: -0.38, z: 0.64 },
};
const GRIND = { x: 0.86, y: 0.22, z: 0.76 };
const GRIND_SPOT: Spot = { x: 0.61, z: 0.77 };
const RACK_SPOT: Spot = { x: 0.38, z: 0.86 };
const wsLayout: Layout = {
  door: { x: -0.4, z: 0.2 },
  sit: { x: -0.4, z: 0.19, face: 0, h: 0.07 },
  yard: { x: 0, z: 1.25 },
};
const toPile = (): Beat[] => [
  { d: 0.9, to: atOut, tool: null, carry: 'out' },
  { d: 0.4, face: pileOut, tool: null, pose: pickUp },
];

const weaponsmithScene: Scene = {
  layout: wsLayout,
  good: () => 'sword',
  beats: [
    ...forgeBeats(WS_FORGE),
    // sharpen the blade on the grindstone: a spray of sparks
    { d: 0.6, to: GRIND_SPOT, face: Math.PI / 2, pose: (P) => holdFront(P, 0.26, 0.12, 0.1), props: (_c, d) => d.bodyProp('h_sword', trs(0, 0.22, 0.14)) , tool: null },
    {
      d: 1.3, face: Math.PI / 2, tool: null,
      pose: (P, c) => {
        const x = Math.sin(c.t * 5) * 0.05;
        reach(P, -1, -0.12 + x, 0.19, 0.1);
        reach(P, 1, 0.1 + x, 0.19, 0.1);
        P.lean = 0.3; P.nod = 0.35;
        P.legL = 0.25; P.legR = -0.1;
      },
      props: (c, d) => d.bodyProp('h_sword', trs(-0.01 + Math.sin(c.t * 5) * 0.05, 0.17, 0.1, 0, 0, 0.12)),
      yard: (c, d) => { for (const o of d.mover('grind')) o.rotation.z = -c.t * 16; },
      fx: (c, a, b) => {
        const P = c.dir.particles;
        if (P && Math.floor(b * 12) !== Math.floor(a * 12)) {
          const w = c.dir.w(GRIND.x - 0.12, GRIND.y + 0.02, GRIND.z + 0.02);
          P.emit({ x: w.x, y: w.y, z: w.z, vx: -0.2, vy: 0.6, vz: 1.4, spread: 1.4, vspread: 0.6, life: 0.4, size: 0.035, color: [1.8, 1.0, 0.35], color2: [1.2, 0.35, 0.05], alpha: 1, gravity: 5, drag: 1, count: 5, additive: true, kind: 1 });
        }
        if (beats(a, b, 0.05, 0.6, 3)) c.dir.snd('grind', 0.5);
      },
    },
    // and tries a swing or two
    {
      d: 0.9, face: 0.2, tool: 'sword',
      pose: (P, c) => {
        const t = c.t * 2.4;
        P.legL = 0.32; P.legR = -0.22;
        P.armL = -0.6; P.splayL = 0.4;
        P.armR = kf(t % 1.3, [0, 0.35, 0.55, 0.9, 1.3], [-1.2, -2.7, -0.6, -1.2, -1.2]);
        P.twist = kf(t % 1.3, [0.35, 0.55, 0.9], [0.1, -0.35, 0]);
        P.lean = 0.2 * win(t % 1.3, 0.5, 0.6, 0.1);
        P.toolRot = 1.45;
      },
      fx: (c, a, b) => { if (hit(a, b, c.d * 0.25) || hit(a, b, c.d * 0.8)) c.dir.snd('swing', 0.4); },
    },
    ...toPile(),
  ],
  pick: (out) => (out === 'bow' ? BOW_BEATS : null),
};

/** Bows: a few blows at the anvil for the fittings, then the stave from the rack: shaped, strung, drawn. */
const BOW_BEATS: Beat[] = [
  { d: 0.8, to: atIn, tool: null },
  { d: 0.45, face: pileIn, tool: null, pose: pickUp },
  { d: 0.7, to: WS_FORGE.anvilSpot, face: 0, tool: null, pose: (P) => holdFront(P, 0.27, 0.12, 0.05), props: (_c, d) => d.bodyProp('iron', trs(0, 0.2, 0.15, 0, Math.PI / 2, 0)) },
  {
    d: 1.7, face: 0,
    pose: (P, c) => { P.lean = 0.2; P.nod = 0.32; reach(P, -1, -0.08, 0.22, 0.15); strike(P, c.t, 0.42, -1.0, -2.2); },
    props: (_c, d) => d.yardProp('blank', WS_FORGE.anvil.x, WS_FORGE.anvil.y, WS_FORGE.anvil.z, 0.15, d.heat(0.35), 0.6),
    fx: (c, a, b) => {
      for (let i = 0; i < 4; i++) if (hit(a, b, i * 0.42 + 0.3)) {
        const w = c.dir.w(WS_FORGE.anvil.x, WS_FORGE.anvil.y + 0.03, WS_FORGE.anvil.z);
        c.dir.particles?.sparks(w.x, w.y, w.z, 3);
        c.dir.snd('anvil', 0.45);
      }
    },
  },
  // a stave from the rack
  { d: 0.5, to: RACK_SPOT, face: Math.PI, tool: null },
  { d: 0.35, face: Math.PI, tool: null, pose: pickUp },
  // shaved down with the knife, curls of wood flying
  {
    d: 1.6, face: 0.3, tool: null,
    pose: (P, c) => {
      const f = (c.t / 0.45) % 1;
      reach(P, -1, -0.07, 0.2, 0.14);
      reach(P, 1, 0.02, lerp(0.34, 0.18, sm(0.1, 0.8, f)), 0.16);
      P.nod = 0.3; P.lean = 0.12;
    },
    props: (_c, d) => d.handProp('stave', -1, trs(0, 0, 0, Math.PI, 0, 0.1)),
    fx: (c, a, b) => {
      const P = c.dir.particles;
      if (!P || !beats(a, b, 0.3, 0.45, 4)) return;
      const w = c.dir.w(RACK_SPOT.x, 0.3, RACK_SPOT.z + 0.2);
      P.emit({ x: w.x, y: w.y, z: w.z, vy: 0.3, spread: 0.5, life: 0.9, size: 0.03, color: [0.85, 0.66, 0.42], gravity: 2, count: 3, kind: 1 });
    },
  },
  // strung and drawn
  {
    d: 0.8, face: 0.3, tool: 'bow',
    pose: (P, c) => { P.armL = -1.2; P.splayL = 0.3; reach(P, 1, -0.05, 0.3 + 0.05 * Math.sin(c.k * Math.PI), 0.16); P.nod = 0.25; },
  },
  {
    d: 1.2, face: 0.35, tool: 'bow',
    pose: (P, c) => {
      const draw = sm(0.15, 0.6, c.k) * (1 - sm(0.8, 0.9, c.k));
      P.armL = -1.55; P.splayL = 0.1;
      P.armR = -1.4; P.splayR = 0.35 + 0.5 * draw;
      P.twist = -0.3; P.yaw = 0.3; P.nod = -0.1;
    },
    fx: (c, a, b) => { if (hit(a, b, c.d * 0.85)) c.dir.snd('bow', 0.35); },
  },
  ...toPile(),
];

// ------------------------------------------------------------------ the sawmill
// buildingModels.sawmill: the mill house (door at (-0.3, 0.2)), a log across two sawhorses at
// (-0.6, 0.64), the saw shed on the right, the pile anchor at (0.3, 1.1).
const TRESTLE = { x: -0.62, y: 0.37, z: 0.64 };
const SAW_SPOT: Spot = { x: -0.62, z: 0.41 };
const SAW_WAY: Spot = { x: -0.04, z: 0.43 };
const sawmillScene: Scene = {
  layout: { door: { x: -0.3, z: 0.34 }, sit: { x: -0.3, z: 0.33, face: 0, h: 0.07 }, yard: { x: 0.1, z: 1.35 } },
  good: () => 'board',
  beats: [
    { d: 0.7, to: atIn, tool: null },
    { d: 0.35, face: pileIn, tool: null, pose: pickUp },
    { d: 0.5, to: SAW_WAY, tool: null, carry: 'log' },
    { d: 0.3, to: SAW_SPOT, face: 0, tool: null, carry: 'log' },
    { d: 0.35, face: 0, tool: null, pose: pickUp },
    // sawn through with the frame saw: sawdust falls under the cut
    {
      d: 2.05, face: 0, tool: null,
      pose: (P, c) => {
        const z = Math.sin(c.t * 7) * 0.06;
        reach(P, 1, 0.05, 0.4, 0.06 + z);
        reach(P, -1, -0.13, 0.26, 0.16);
        P.lean = 0.22; P.nod = 0.35; P.twist = -0.1 + z * 0.8;
        P.legL = 0.3; P.legR = -0.15;
        P.bob = -0.01 * Math.abs(Math.sin(c.t * 7));
      },
      props: (c, d) => d.bodyProp('saw', trs(0.05, 0.315 - 0.05 * c.k, 0.05 + Math.sin(c.t * 7) * 0.06, 0, -Math.PI / 2, 0.08, 1.05)),
      fx: (c, a, b) => {
        const P = c.dir.particles;
        if (P && Math.floor(b * 8) !== Math.floor(a * 8)) {
          const w = c.dir.w(TRESTLE.x + 0.05, TRESTLE.y - 0.04, TRESTLE.z);
          P.emit({ x: w.x, y: w.y, z: w.z, vy: -0.1, spread: 0.25, life: 0.9, size: 0.03, color: [0.9, 0.78, 0.55], gravity: 2.5, count: 3, kind: 1 });
        }
        if (beats(a, b, 0.2, 0.9, 3)) c.dir.snd('saw', 0.45);
      },
    },
    { d: 0.3, face: 0, tool: null, pose: pickUp },
    { d: 0.4, to: SAW_WAY, tool: null, carry: 'board' },
    { d: 0.5, to: atOut, tool: null, carry: 'board' },
    { d: 0.3, face: pileOut, tool: null, pose: pickUp },
  ],
};

// ------------------------------------------------------------------ the bakery
// buildingModels.bakery: the house door at (-0.25, 0.18), a kneading table at (0.2, 0.64), the
// round oven at (0.85, 0) with its mouth to the yard, the pile anchor at (-1.0, 0.8).
const TABLE = { x: 0.2, y: 0.29, z: 0.64 };
const KNEAD_SPOT: Spot = { x: 0.2, z: 0.36 };
const OVEN_MOUTH = { x: 0.85, y: 0.13, z: 0.42 };
const OVEN_SPOT: Spot = { x: 0.6, z: 0.8 };
const toOven = Math.atan2(OVEN_MOUTH.x - OVEN_SPOT.x, OVEN_MOUTH.z - OVEN_SPOT.z);
/** the peel held out in both hands (body space), `ext` pushed further out, a loaf on its blade */
function peel(_c: Ctx, d: WorkDirector, ext: number, load: 'dough' | 'bread' | null) {
  const m = trs(0.05, 0.2 - 0.04 * ext, 0.42 + 0.25 * ext, 0.12, 0, 0, 0.75);
  d.bodyProp('peel', m);
  if (load) d.bodyProp(load, M2.copy(m).multiply(trs(0, 0.01, 0, 0, 0.4, 0, load === 'dough' ? 0.9 : 1.2)));
}
const peelHands = (P: Pose, ext: number) => {
  reach(P, 1, 0.07, 0.23 - 0.03 * ext, 0.12 + 0.2 * ext);
  reach(P, -1, 0.02, 0.24 - 0.03 * ext, 0.24 + 0.2 * ext);
};
const bakeryScene: Scene = {
  layout: { door: { x: -0.25, z: 0.32 }, sit: { x: -0.25, z: 0.31, face: 0, h: 0.07 }, yard: { x: -0.3, z: 1.25 } },
  good: () => 'bread',
  beats: [
    // a sack of flour from the pile to the table
    { d: 0.7, to: atIn, tool: null },
    { d: 0.35, face: pileIn, tool: null, pose: pickUp },
    { d: 0.4, to: { x: -0.2, z: 0.4 }, tool: null, carry: 'flour' },
    { d: 0.25, to: KNEAD_SPOT, face: 0, tool: null, carry: 'flour' },
    { d: 0.35, face: 0, tool: null, pose: pickUp, yard: (c, d) => { if (c.k > 0.5) d.yardProp('dough', TABLE.x, TABLE.y, TABLE.z, 0, undefined, 1.3); } },
    // kneading, a puff of flour at every push
    {
      d: 1.6, face: 0, tool: null,
      pose: (P, c) => {
        const f = (c.t / 0.4) % 1, side = Math.floor(c.t / 0.4) % 2 ? 1 : -1;
        const push = Math.sin(f * Math.PI);
        reach(P, -1, -0.05, 0.25 - (side < 0 ? 0.05 * push : 0), 0.19);
        reach(P, 1, 0.05, 0.25 - (side > 0 ? 0.05 * push : 0), 0.19);
        P.lean = 0.25 + 0.12 * push; P.nod = 0.3; P.roll = side * 0.05 * push;
        P.bob = -0.015 * push;
      },
      yard: (c, d) => d.yardProp('dough', TABLE.x, TABLE.y, TABLE.z, c.t * 0.7, undefined, 1.3),
      fx: (c, a, b) => {
        const P = c.dir.particles;
        if (!P || !beats(a, b, 0.2, 0.4, 4)) return;
        const w = c.dir.w(TABLE.x, TABLE.y + 0.03, TABLE.z);
        P.emit({ x: w.x, y: w.y, z: w.z, vy: 0.2, spread: 0.3, life: 1.0, size: 0.1, grow: 1.5, color: [0.95, 0.93, 0.88], alpha: 0.35, drag: 2, count: 2 });
      },
    },
    // shaped into a loaf and onto the peel
    {
      d: 0.4, face: 0, tool: null,
      pose: (P, c) => { peelHands(P, 0); P.nod = 0.3; P.lean = 0.1 * Math.sin(c.k * Math.PI); },
      props: (c, d) => peel(c, d, 0, 'dough'),
    },
    { d: 0.35, to: { x: 0.52, z: 0.45 }, tool: null, pose: (P) => peelHands(P, 0), props: (c, d) => peel(c, d, 0, 'dough') },
    { d: 0.3, to: OVEN_SPOT, face: toOven, tool: null, pose: (P) => peelHands(P, 0), props: (c, d) => peel(c, d, 0, 'dough') },
    // into the oven with it
    {
      d: 0.5, face: toOven, tool: null,
      pose: (P, c) => { const e = sm(0, 0.8, c.k); peelHands(P, e); P.lean = 0.15 + 0.2 * e; P.legL = 0.3 * e; },
      props: (c, d) => peel(c, d, sm(0, 0.8, c.k), c.k < 0.75 ? 'dough' : null),
    },
    // it bakes: the fire glows up; he waits leaning on the peel
    {
      d: 1.0, face: toOven, tool: null,
      pose: (P) => { peelHands(P, 0); P.nod = 0.1; P.tilt = 0.1; },
      props: (c, d) => peel(c, d, 0, null),
      fx: (c, a, b) => {
        const P = c.dir.particles;
        if (P && Math.floor(b * 6) !== Math.floor(a * 6)) {
          const w = c.dir.w(OVEN_MOUTH.x, OVEN_MOUTH.y + 0.05, OVEN_MOUTH.z + 0.08);
          P.fire(w.x, w.y, w.z, 0.2);
        }
        if (hit(a, b, 0.1)) c.dir.snd('fire', 0.3);
      },
    },
    // and out comes the bread
    {
      d: 0.5, face: toOven, tool: null,
      pose: (P, c) => { const e = 1 - sm(0.2, 1, c.k); peelHands(P, e); P.lean = 0.15 + 0.2 * e; },
      props: (c, d) => peel(c, d, 1 - sm(0.2, 1, c.k), c.k > 0.25 ? 'bread' : null),
    },
    { d: 0.45, to: { x: 0.2, z: 0.98 }, tool: null, carry: 'bread' },
    { d: 0.6, to: atOut, tool: null, carry: 'bread' },
    { d: 0.3, face: pileOut, tool: null, pose: pickUp },
  ],
};

// ------------------------------------------------------------------ the mines
// buildingModels.mineDesign: the adit at (0, 0.35) opening at z 0.6, the rails running out to
// z 1.5 with the tub ('tub' + 'tubore', pivot on the front axle) at their end, the pile anchor at
// (-0.7, 1.05).
const TUB_IN = -1.0;
const tubAt = (d: WorkDirector, dz: number, tip = 0, loaded = true) => {
  for (const o of d.mover('tub')) { o.position.z = o.userData.rest.p.z + dz; o.rotation.x = tip; }
  for (const o of d.mover('tubore')) { o.position.z = o.userData.rest.p.z + dz; o.rotation.x = tip; o.visible = loaded; }
};
const SPILL = { x: 0.1, z: 1.66 };
const pushArms = (P: Pose) => { reach(P, -1, -0.08, 0.2, 0.2); reach(P, 1, 0.08, 0.2, 0.2); P.lean = 0.3; P.nod = 0.1; };
const mineScene: Scene = {
  layout: { door: { x: 0, z: 0.58 }, sit: { x: -0.42, z: 0.8, face: 0.3, h: 0 }, yard: { x: -0.3, z: 1.35 } },
  beats: [
    // push the empty tub back into the mountain and go in after it
    { d: 0.7, to: { x: 0, z: 1.66 }, face: Math.PI, tool: null, yard: (_c, d) => tubAt(d, 0, 0, false) },
    {
      d: 1.3, to: { x: 0, z: 0.66 }, face: Math.PI, tool: null, pose: pushArms,
      yard: (c, d) => tubAt(d, lerp(0, TUB_IN, ease(c.k)), 0, false),
      fx: (c, a, b) => { if (hit(a, b, 0.05)) c.dir.snd('rumble', 0.5); },
    },
    { d: 0.35, to: { x: 0, z: 0.02 }, tool: null, yard: (_c, d) => tubAt(d, TUB_IN, 0, false) },
    // at the face: the pick rings out of the dark
    {
      d: 2.3, hide: true, yard: (_c, d) => tubAt(d, TUB_IN, 0, false),
      fx: (c, a, b) => { if (beats(a, b, 0.3, 0.7, 3)) c.dir.snd('pick', 0.2); },
    },
    // out he comes pushing it full
    {
      d: 1.6, to: { x: 0, z: 1.02 }, face: 0, tool: null, pose: pushArms,
      yard: (c, d) => tubAt(d, lerp(TUB_IN, 0, ease(c.k))),
      fx: (c, a, b) => { if (hit(a, b, 0.05)) c.dir.snd('rumble', 0.6); },
    },
    // tips it out at the end of the rails
    {
      d: 0.6, face: 0, tool: null,
      pose: (P, c) => { const tip = Math.sin(c.k * Math.PI); reach(P, -1, -0.08, 0.2 + 0.12 * tip, 0.2); reach(P, 1, 0.08, 0.2 + 0.12 * tip, 0.2); P.lean = 0.2; P.nod = -0.05; },
      yard: (c, d) => {
        const tip = Math.sin(c.k * Math.PI);
        tubAt(d, 0, 0.95 * tip, c.k < 0.45);
        if (c.k > 0.4) d.yardProp(c.out, SPILL.x, 0, SPILL.z, 0.7);
      },
      fx: (c, a, b) => {
        if (!hit(a, b, c.d * 0.42)) return;
        const w = c.dir.w(SPILL.x, 0.05, SPILL.z);
        c.dir.particles?.dust(w.x, w.y, w.z, 8, [0.45, 0.4, 0.35]);
        c.dir.snd('dig', 0.6);
      },
    },
    // throws the spoil aside
    {
      d: 0.5, to: { x: 0.34, z: 1.36 }, face: Math.PI / 2, tool: null,
      pose: (P, c) => { if (c.walking) return; const f = c.k; P.armR = kf(f, [0, 0.4, 0.7, 1], [-0.6, -2.4, -1.2, -0.5]); P.twist = kf(f, [0.4, 0.7], [0.25, -0.2]); },
      yard: (c, d) => {
        d.yardProp(c.out, SPILL.x, 0, SPILL.z, 0.7);
        if (c.k > 0.55) {
          const f = (c.k - 0.55) / 0.45;
          d.yardProp('stone', lerp(0.4, 1.05, f), 0.5 * f * (1 - f) * 4 * 0.25 + 0.3 * (1 - f), lerp(1.36, 1.2, f), f * 6, undefined, 0.6);
        }
      },
    },
    { d: 0.35, to: { x: 0.36, z: 1.68 }, face: SPILL, tool: null, pose: pickUp, yard: (c, d) => { if (c.k < 0.5) d.yardProp(c.out, SPILL.x, 0, SPILL.z, 0.7); } },
    { d: 0.7, to: atOut, tool: null, carry: 'out' },
    { d: 0.3, face: pileOut, tool: null, pose: pickUp },
  ],
};

// ------------------------------------------------------------------ the mill, the slaughterhouse
// buildingModels.mill: the tower door at (0, 0.43), the pile anchor at (-0.8, 0.8).
const millScene: Scene = {
  layout: { door: { x: 0, z: 0.6 }, sit: { x: 0.3, z: 0.62, face: 0.2, h: 0.1 }, yard: { x: -0.3, z: 1.25 } },
  good: () => 'flour',
  beats: [
    { d: 0.7, to: atIn, tool: null },
    { d: 0.35, face: pileIn, tool: null, pose: pickUp },
    { d: 0.7, to: { x: 0, z: 0.62 }, tool: null, carry: 'grain' },
    { d: 0.25, to: { x: 0, z: 0.46 }, tool: null, carry: 'grain' },
    // up the tower to the millstones
    { d: 2.4, hide: true },
    { d: 0.2, to: { x: 0, z: 0.66 }, face: 0, tool: null, carry: 'flour' },
    { d: 0.8, to: atOut, tool: null, carry: 'flour' },
    { d: 0.3, face: pileOut, tool: null, pose: pickUp },
  ],
};

// buildingModels.slaughter: the house door at (-0.2, 0.1), the chopping block at (-0.9, 0.62),
// the pile anchor at (0.1, 1.0). What happens to the pig stays indoors.
const BLOCK = { x: -0.9, y: 0.24, z: 0.62 };
const BLOCK_SPOT: Spot = { x: -0.9, z: 0.37 };
const slaughterScene: Scene = {
  layout: { door: { x: -0.2, z: 0.25 }, sit: { x: -0.2, z: 0.24, face: 0, h: 0.07 }, yard: { x: 0, z: 1.25 } },
  good: () => 'meat',
  beats: [
    { d: 0.8, to: { x: -0.2, z: 0.25 }, tool: null },
    { d: 1.4, hide: true },
    { d: 0.8, to: BLOCK_SPOT, face: 0, tool: null, carry: 'meat' },
    { d: 0.35, face: 0, tool: null, pose: pickUp, yard: (c, d) => { if (c.k > 0.5) d.yardProp('meat', BLOCK.x, BLOCK.y, BLOCK.z, 0.4, undefined, 1.2); } },
    // the cleaver comes down, three times
    {
      d: 1.4, face: 0, tool: null,
      pose: (P, c) => {
        strike(P, c.t, 0.46, -1.1, -2.6);
        reach(P, -1, -0.1, 0.22, 0.16);
        P.lean = 0.2; P.nod = 0.3; P.legL = 0.25; P.legR = -0.1;
      },
      props: (_c, d) => d.toolProp('cleaver', 1.3),
      yard: (_c, d) => d.yardProp('meat', BLOCK.x, BLOCK.y, BLOCK.z, 0.4, undefined, 1.2),
      fx: (c, a, b) => { if (beats(a, b, 0.46 * 0.7, 0.46, 3)) c.dir.snd('chop', 0.5); },
    },
    { d: 0.35, face: 0, tool: null, pose: pickUp, yard: (c, d) => { if (c.k < 0.5) d.yardProp('meat', BLOCK.x, BLOCK.y, BLOCK.z, 0.4, undefined, 1.2); } },
    { d: 0.9, to: atOut, tool: null, carry: 'meat' },
    { d: 0.3, face: pileOut, tool: null, pose: pickUp },
  ],
};

// ------------------------------------------------------------------ the temples
/** holding the amphora in both hands, tipped `tip` forward over a brazier */
function amphora(d: WorkDirector, tip: number) {
  d.bodyProp('wine', trs(0, 0.2 + 0.08 * tip, 0.16 + 0.04 * tip, 1.9 * tip, 0, 0, 1.15));
}
const amphoraHands = (P: Pose, tip: number) => {
  reach(P, -1, -0.07, 0.3 + 0.08 * tip, 0.15 + 0.04 * tip);
  reach(P, 1, 0.07, 0.3 + 0.08 * tip, 0.15 + 0.04 * tip);
};
function offerBeats(brazier: { x: number; y: number; z: number }): Beat[] {
  return [
    // wine poured into the fire: the flames leap up gold
    {
      d: 1.0, face: brazier, tool: null,
      pose: (P, c) => { const tip = win(c.k, 0.2, 0.8, 0.15); amphoraHands(P, tip); P.lean = 0.1 * tip; P.nod = 0.25; },
      props: (c, d) => amphora(d, win(c.k, 0.2, 0.8, 0.15)),
      fx: (c, a, b) => {
        const P = c.dir.particles;
        if (!P) return;
        const w = c.dir.w(brazier.x, brazier.y + 0.1, brazier.z);
        if (c.k > 0.3 && c.k < 0.8 && Math.floor(b * 10) !== Math.floor(a * 10)) P.emit({ x: w.x, y: w.y + 0.15, z: w.z, vy: -0.8, spread: 0.1, life: 0.3, size: 0.03, color: [0.45, 0.08, 0.22], gravity: 3, count: 2, kind: 1 });
        if (hit(a, b, c.d * 0.5)) { P.sparkle(w.x, w.y, w.z, 20, [2.2, 1.7, 0.6]); c.dir.snd('chime', 0.4); }
      },
    },
    // and a prayer with the arms raised
    {
      d: 0.9, face: brazier, tool: null, carry: null,
      pose: (P, c) => {
        const up = sm(0, 0.3, c.k) * (1 - sm(0.8, 1, c.k));
        P.armL = P.armR = lerp(-0.4, -2.7, up); P.splayL = P.splayR = 0.45;
        P.nod = -0.3 * up; P.eyes = up > 0.5 ? 0.12 : 1;
        P.roll = Math.sin(c.t * 2) * 0.04 * up;
      },
      props: (c, d) => { if (c.k < 0.15) amphora(d, 0); },
    },
  ];
}
function templeScene(o: { door: Spot; top: Spot; foot: Spot; left: { x: number; y: number; z: number }; right: { x: number; y: number; z: number }; leftSpot: Spot; rightSpot: Spot; floor: (x: number, z: number) => number; sit: Layout['sit'] }): Scene {
  const holding = (P: Pose) => amphoraHands(P, 0);
  const hold = (_c: Ctx, d: WorkDirector) => amphora(d, 0);
  return {
    layout: { door: o.door, sit: o.sit, yard: { x: 0, z: o.foot.z + 0.3 }, floor: o.floor },
    good: () => 'wine',
    beats: [
      { d: 0.5, to: o.top, tool: null },
      { d: 0.6, to: o.foot, tool: null },
      { d: 0.6, to: atIn, tool: null },
      { d: 0.35, face: pileIn, tool: null, pose: pickUp, props: (c, d) => { if (c.k > 0.5) amphora(d, 0); } },
      { d: 0.5, to: o.rightSpot, tool: null, pose: holding, props: hold },
      ...offerBeats(o.right),
      { d: 0.8, to: o.leftSpot, tool: null, pose: holding, props: hold },
      ...offerBeats(o.left),
      { d: 0.6, to: o.foot, tool: null },
      { d: 0.6, to: o.top, tool: null },
      { d: 0.35, to: o.door, tool: null },
      { d: 0.5, hide: true },
    ],
  };
}
// buildingModels.temple: a podium 0.26 high (x within 1.1, z -1.05..0.75), three steps down to z 1.35
// (1.25 wide), the cella door at (0, 0.26), braziers at (±0.78, 1.1), the pile anchor at (1.2, 1.2).
const templeFloor = (x: number, z: number) => {
  if (Math.abs(x) < 0.625 && z > 0.75 && z < 1.35) return z < 0.95 ? 0.26 : z < 1.15 ? 0.17 : 0.09;
  return Math.abs(x) < 1.1 && z > -1.05 && z <= 0.75 ? 0.26 : 0;
};
const templeSceneS = templeScene({
  door: { x: 0, z: 0.34 }, top: { x: 0, z: 0.7 }, foot: { x: 0, z: 1.45 },
  left: { x: -0.78, y: 0.46, z: 1.1 }, right: { x: 0.78, y: 0.46, z: 1.1 },
  leftSpot: { x: -0.5, z: 1.44 }, rightSpot: { x: 0.5, z: 1.44 },
  floor: templeFloor, sit: { x: 0.35, z: 0.86, face: 0, h: 0 },
});
// buildingModels.greattemple: a round podium 0.36 high, the portico (x within 0.85, z 0.75..1.75),
// three steps down to z 2.3 (1.3 wide), the door at (0, 0.8), braziers at (±0.95, 1.9), the pile
// anchor at (-1.5, 1.4).
const greatFloor = (x: number, z: number) => {
  if (Math.abs(x) < 0.65 && z > 1.75 && z < 2.305) return z < 1.945 ? 0.27 : z < 2.125 ? 0.18 : 0.09;
  if (Math.abs(x) < 0.85 && z >= 0.7 && z <= 1.75) return 0.36;
  return Math.hypot(x, z + 0.15) < 1.5 ? 0.36 : 0;
};
const greatTempleScene = templeScene({
  door: { x: 0, z: 0.9 }, top: { x: 0, z: 1.68 }, foot: { x: 0, z: 2.42 },
  left: { x: -0.95, y: 0.5, z: 1.9 }, right: { x: 0.95, y: 0.5, z: 1.9 },
  leftSpot: { x: -0.72, z: 2.4 }, rightSpot: { x: 0.72, z: 2.4 },
  floor: greatFloor, sit: { x: 0.35, z: 1.85, face: 0, h: 0 },
});

// ------------------------------------------------------------------ the barracks
// A recruit spends his training (the wait in economy.training) at the dummies in the yard: swordsmen
// hack at the one on the left, bowmen loose arrows at the one on the right (buildingModels.barracks:
// dummies at (±0.6, 0.75), the door at (0, 0.08)).
const DUMMY_L = { x: -0.6, y: 0.52, z: 0.75 };
const DUMMY_R = { x: 0.6, y: 0.52, z: 0.75 };
const recruitClock = (_b: Building, s: Settler) => {
  const a = s.actions[0];
  return a && a.k === 'wait' ? clamp((a.t ?? 0) / a.dur, 0, 0.9999) : null;
};
const hayPuff = (c: Ctx, p: { x: number; y: number; z: number }) => {
  const w = c.dir.w(p.x, p.y, p.z);
  c.dir.particles?.emit({ x: w.x, y: w.y, z: w.z, vy: 0.5, spread: 1.0, vspread: 0.4, life: 0.8, size: 0.04, color: [0.9, 0.78, 0.4], gravity: 2, count: 6, kind: 1 });
  c.dir.snd('hit', 0.3);
};
const SWORD_BEATS: Beat[] = [
  { d: 0.8, to: { x: -0.3, z: 0.84 }, tool: 'sword' },
  {
    d: 3.6, face: DUMMY_L, tool: 'sword',
    pose: (P, c) => {
      const t = c.t % 1.2;
      P.legL = 0.32; P.legR = -0.22 - 0.15 * win(t, 0.5, 0.65, 0.08);
      P.armL = -1.0; P.splayL = 0.3;
      P.armR = kf(t, [0, 0.35, 0.55, 0.9, 1.2], [-1.2, -2.7, -0.7, -1.2, -1.2]);
      P.twist = kf(t, [0.35, 0.55, 0.9], [0.2, -0.3, 0]);
      P.lean = 0.25 * win(t, 0.5, 0.62, 0.08);
      P.toolRot = 1.45;
    },
    fx: (c, a, b) => { for (let i = 0; i < 3; i++) if (hit(a, b, i * 1.2 + 0.55)) hayPuff(c, DUMMY_L); },
  },
  { d: 0.9, to: { x: 0, z: 0.22 }, tool: 'sword' },
  { d: 0.3, to: { x: 0, z: 0.1 }, tool: 'sword' },
  { d: 0.4, hide: true },
];
const BOW_SPOT: Spot = { x: 0.1, z: 0.45 };
const BOWMAN_BEATS: Beat[] = [
  { d: 0.6, to: BOW_SPOT, tool: 'bow' },
  {
    d: 3.8, face: DUMMY_R, tool: 'bow',
    pose: (P, c) => {
      const t = c.t % 1.9;
      const draw = sm(0.2, 1.0, t) * (1 - sm(1.3, 1.36, t));
      P.armL = -1.55; P.splayL = 0.1;
      P.armR = -1.4; P.splayR = 0.35 + 0.5 * draw;
      P.twist = -0.3; P.yaw = 0.3; P.nod = -0.05;
    },
    yard: (c, d) => {
      const t = c.t % 1.9;
      if (t < 1.33 || t > 1.6) return;
      const f = (t - 1.33) / 0.27;
      const from = VA.set(BOW_SPOT.x + 0.12, 0.5, BOW_SPOT.z + 0.08), to = VB.set(DUMMY_R.x, DUMMY_R.y, DUMMY_R.z);
      d.yardProp('arrow', lerp(from.x, to.x, f), lerp(from.y, to.y, f) + 0.06 * Math.sin(f * Math.PI), lerp(from.z, to.z, f), Math.atan2(to.x - from.x, to.z - from.z));
    },
    fx: (c, a, b) => {
      for (let i = 0; i < 2; i++) {
        if (hit(a, b, i * 1.9 + 1.33)) c.dir.snd('bow', 0.4);
        if (hit(a, b, i * 1.9 + 1.6)) hayPuff(c, DUMMY_R);
      }
    },
  },
  { d: 0.6, to: { x: 0, z: 0.22 }, tool: 'bow' },
  { d: 0.3, to: { x: 0, z: 0.1 }, tool: 'bow' },
  { d: 0.4, hide: true },
];
const barracksScene: Scene = {
  layout: { door: { x: 0, z: 0.1 }, sit: { x: 0, z: 0.2, face: 0 }, yard: { x: 0, z: 1.2 } },
  beats: SWORD_BEATS,
  pick: (out) => (out === 'bow' ? BOWMAN_BEATS : null),
  who: (b, s) => b.workerIncoming === s.id && (s.carrying === 'sword' || s.carrying === 'bow'),
  clock: recruitClock,
  good: (_b, s) => s.carrying ?? 'sword',
};

// ------------------------------------------------------------------ the siege workshop
// buildingModels.siegeworks: the catapult on the stocks under the shed at (0.82, -0.55), its arm
// lying on the ground in front at (0.82, 0.55), the house door at (-0.3, -0.05), the pile anchor at
// (-0.2, 1.15).
const ARM = { x: 0.82, y: 0.08, z: 0.5 };
const siegeScene: Scene = {
  layout: { door: { x: -0.3, z: 0.1 }, sit: { x: -0.3, z: 0.1, face: 0, h: 0.07 }, yard: { x: 0.2, z: 1.3 } },
  good: () => 'board',
  beats: [
    { d: 0.7, to: atIn, tool: null },
    { d: 0.35, face: pileIn, tool: null, pose: pickUp },
    { d: 0.6, to: { x: 0.52, z: 0.52 }, face: Math.PI / 2, tool: null, carry: 'board' },
    { d: 0.35, face: Math.PI / 2, tool: null, pose: pickUp, yard: (c, d) => { if (c.k > 0.5) d.yardProp('board', ARM.x - 0.05, ARM.y, ARM.z, 0); } },
    // trims it to fit, kneeling
    {
      d: 2.2, face: Math.PI / 2,
      pose: (P, c) => {
        P.bob = -0.1; P.legL = -1.1; P.legR = 0.9; P.lean = 0.35; P.nod = 0.3;
        reach(P, -1, -0.08, 0.14, 0.2);
        strike(P, c.t, 0.44, -0.7, -2.2);
      },
      yard: (_c, d) => d.yardProp('board', ARM.x - 0.05, ARM.y, ARM.z, 0),
      fx: (c, a, b) => {
        for (let i = 0; i < 5; i++) if (hit(a, b, i * 0.44 + 0.3)) {
          const w = c.dir.w(ARM.x - 0.1, ARM.y + 0.03, ARM.z);
          c.dir.particles?.dust(w.x, w.y, w.z, 1, [0.62, 0.55, 0.45]);
          c.dir.snd('hammer', 0.5);
        }
      },
    },
    { d: 0.3, face: Math.PI / 2, tool: null, pose: pickUp, yard: (c, d) => { if (c.k < 0.5) d.yardProp('board', ARM.x - 0.05, ARM.y, ARM.z, 0); } },
    // and fits it to the machine
    { d: 0.5, to: { x: 0.82, z: 0.14 }, face: Math.PI, tool: null, carry: 'board' },
    {
      d: 1.0, face: Math.PI,
      pose: (P, c) => { reach(P, -1, -0.06, 0.42, 0.2); strike(P, c.t, 0.4, -1.6, -2.8); P.nod = -0.2; },
      fx: (c, a, b) => { if (beats(a, b, 0.28, 0.4, 2)) c.dir.snd('hammer', 0.5); },
    },
    { d: 0.4, face: Math.PI, tool: null, pose: (P, c) => { P.armL = P.armR = 0.5; P.splayL = P.splayR = 0.85; P.nod = -0.1 + 0.1 * Math.sin(c.t * 6); } },
  ],
};

const SCENES: Partial<Record<string, Scene>> = {
  toolsmith: toolsmithScene,
  ironsmelter: smelterScene(false),
  goldsmelter: smelterScene(true),
  weaponsmith: weaponsmithScene,
  sawmill: sawmillScene,
  bakery: bakeryScene,
  coalmine: mineScene,
  ironmine: mineScene,
  goldmine: mineScene,
  stonemine: mineScene,
  mill: millScene,
  slaughter: slaughterScene,
  temple: templeSceneS,
  greattemple: greatTempleScene,
  barracks: barracksScene,
  siegeworks: siegeScene,
};

/** Which building types have a worker at work in the yard. */
export const WORK_TYPES = Object.keys(SCENES);

