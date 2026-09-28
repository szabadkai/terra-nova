// Instanced settler renderer: chibi-proportioned people assembled from posed parts,
// with per-settler looks (hair, skin, clothes), job hats and aprons, blinking and idle fidgets.
import * as THREE from 'three';
import { GOODS, Good, Job } from '../game/defs';
import type { Game } from '../game/game';
import type { Settler } from '../game/types';
import { DECK_H, shipDeckY } from '../game/sea';
import { hash2 } from '../core/rng';
import { patchMaterial } from './shaderPatch';
import { BANNER_COLORS } from './materials';
import { HAIR_STYLES, HATS, HairStyle, Hat, RIG, buildSettlerGeos } from './settlerModels';

/** Settlers are drawn a little larger than life (as in the original) so they read well. */
const SCALE = 1.3;

/** Settler shader: per-vertex choice of tint (see settlerModels) plus metal/gloss flags and a soft rim light. */
function settlerMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  patchMaterial(m, {
    key: 'settler',
    vertexHead: 'attribute float aTint;\nattribute vec3 instanceColor2;\nvarying float vSurf;',
    vertexBegin: `
  vSurf = floor(aTint / 3.0 + 0.01);
  #ifdef USE_INSTANCING_COLOR
  {
    float tm = aTint - vSurf * 3.0;
    vec3 tc = tm < 0.5 ? vec3(1.0) : (tm < 1.5 ? instanceColor.rgb : instanceColor2);
    vColor.rgb = color * tc;
  }
  #endif`,
    fragHead: 'varying float vSurf;',
    fragEmissive: `
  {
    float isMetal = 1.0 - step(0.5, abs(vSurf - 1.0));
    float isGloss = step(1.5, vSurf);
    metalnessFactor = mix(metalnessFactor, 0.85, isMetal);
    roughnessFactor = mix(roughnessFactor, 0.32, isMetal);
    roughnessFactor = mix(roughnessFactor, 0.18, isGloss);
    vec3 V = normalize(vViewPosition);
    float rim = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0);
    totalEmissiveRadiance += diffuseColor.rgb * rim * 0.3 * (1.0 - uNight * 0.7) * (1.0 - isMetal);
  }`,
  });
  return m;
}

function simpleMat(roughness: number, metalness: number, key: string) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
  patchMaterial(m, { key });
  return m;
}

/** One instanced part with a primary (instanceColor) and secondary (instanceColor2) tint. */
class Batch {
  mesh: THREE.InstancedMesh;
  n = 0;
  private c2: THREE.InstancedBufferAttribute | null = null;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number, tinted = true) {
    if (tinted) {
      geo = geo.clone();
      this.c2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      this.c2.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('instanceColor2', this.c2);
    }
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (tinted) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    this.mesh = m;
  }
  add(mat: THREE.Matrix4, c1?: THREE.Color, c2?: THREE.Color) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.mesh.setMatrixAt(i, mat);
    if (c1 && this.mesh.instanceColor) this.mesh.setColorAt(i, c1);
    if (c2 && this.c2) this.c2.setXYZ(i, c2.r, c2.g, c2.b);
  }
  finish() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (this.c2) this.c2.needsUpdate = true;
    this.n = 0;
  }
}

// ------------------------------------------------------------------ looks
const SKIN = [0xe2a47a, 0xd6946a, 0xc48058, 0x9c6442, 0x6e442a, 0xeab48e];
const HAIR = [0x3a2414, 0x5e3a1c, 0xc8923e, 0x1e1510, 0xa84a1e, 0x80542c, 0xe0c080];
const GREY_HAIR = 0xbab2a6;
const TROUSERS = [0x5a4a3a, 0x6a5040, 0x4a4a52, 0x5a5a3a, 0x7a6048, 0x3e4a5a];

interface JobLook { hat: Hat | null; hatCol: number; apron?: number; beardy?: number }
const JOB_LOOK: Record<Job, JobLook> = {
  carrier: { hat: null, hatCol: 0x7a5a38 },
  builder: { hat: 'cap', hatCol: 0xd8a030 },
  digger: { hat: 'straw', hatCol: 0xc8a860 },
  woodcutter: { hat: 'cap', hatCol: 0x3a7030, beardy: 0.5 },
  forester: { hat: 'straw', hatCol: 0x5a8a40 },
  stonecutter: { hat: 'bandana', hatCol: 0x8a8a88, beardy: 0.3 },
  sawyer: { hat: 'cap', hatCol: 0x8a5a30, apron: 0x8a6440 },
  fisher: { hat: 'straw', hatCol: 0xe0b030 },
  hunter: { hat: 'hood', hatCol: 0x4a6a30 },
  farmer: { hat: 'straw', hatCol: 0xe8cc70 },
  miller: { hat: 'cap', hatCol: 0xf0ece0, apron: 0xf4f0e6 },
  baker: { hat: 'toque', hatCol: 0xfaf8f2, apron: 0xf4f0e6 },
  butcher: { hat: 'bandana', hatCol: 0xc03a30, apron: 0xf0e4dc, beardy: 0.3 },
  pigfarmer: { hat: 'straw', hatCol: 0xb08850 },
  waterman: { hat: 'cap', hatCol: 0x4a7ab0 },
  miner: { hat: 'miner', hatCol: 0x7a5230, beardy: 0.55 },
  smelter: { hat: 'bandana', hatCol: 0x4a4a4a, apron: 0x6a4a30, beardy: 0.4 },
  toolsmith: { hat: 'cap', hatCol: 0x4a4a4a, apron: 0x6a4a30, beardy: 0.4 },
  weaponsmith: { hat: 'bandana', hatCol: 0x6a2a2a, apron: 0x6a4a30, beardy: 0.5 },
  vintner: { hat: 'straw', hatCol: 0x9a6ab0, apron: 0x5a2448 },
  priest: { hat: 'hood', hatCol: 0xf4efe2, apron: 0xf8f2e0, beardy: 0.6 },
  shipwright: { hat: 'bandana', hatCol: 0x2a5a8a, apron: 0x8a6440, beardy: 0.6 },
  geologist: { hat: 'hood', hatCol: 0x7a5a30, beardy: 0.9 },
  pioneer: { hat: 'bandana', hatCol: 0xb85a28, apron: 0x6a5a3a, beardy: 0.45 },
  donkeybreeder: { hat: 'straw', hatCol: 0xb89a58, apron: 0x7a6a4a, beardy: 0.3 },
  engineer: { hat: 'cap', hatCol: 0x5a5a62, apron: 0x6a5a48, beardy: 0.5 },
  swordsman: { hat: 'helmet', hatCol: 0xb8bcc4 },
  bowman: { hat: 'hood', hatCol: 0x4a5a2a },
  donkey: { hat: null, hatCol: 0x7a6a5a }, // drawn by DonkeysRenderer, never as a person
  catapult: { hat: null, hatCol: 0x7a5a38 }, // drawn by CatapultsRenderer, never as a person
};

const TOOL: Partial<Record<Job, Good>> = {
  woodcutter: 'axe', stonecutter: 'pickaxe', builder: 'hammer', digger: 'shovel', farmer: 'scythe', fisher: 'rod',
  hunter: 'bow', miner: 'pickaxe', forester: 'shovel', swordsman: 'sword', bowman: 'bow', sawyer: 'saw', waterman: 'water',
  toolsmith: 'hammer', weaponsmith: 'hammer', shipwright: 'hammer', geologist: 'hammer', pioneer: 'shovel', engineer: 'hammer',
};

interface Look {
  job: Job;
  hair: HairStyle;
  hat: Hat | null;
  skin: THREE.Color;
  hairCol: THREE.Color;
  trousers: THREE.Color;
  hatCol: THREE.Color;
  apron: THREE.Color | null;
  tunicK: number;
  blinkP: number;
  blinkO: number;
}

function makeLook(s: Settler): Look {
  const h = (k: number) => hash2(s.id, k, 971);
  const jl = JOB_LOOK[s.job];
  let hat = jl.hat;
  let hatCol = jl.hatCol;
  // some carriers wear a cap, in varied earthy colours
  if (s.job === 'carrier' && h(1) < 0.3) {
    hat = 'cap';
    hatCol = [0x7a5a38, 0x5a6a38, 0x8a4a38, 0x6a6a70][Math.floor(h(2) * 4)];
  }
  const beardy = jl.beardy ?? 0.15;
  let hair: HairStyle;
  const r = h(3);
  if (r < beardy) hair = h(4) < 0.35 ? 'bald' : 'bearded';
  else hair = (['tousled', 'tousled', 'bowl', 'bowl', 'long', 'bun'] as const)[Math.floor(h(5) * 6)];
  // keep hair from poking through hats that cover the back of the head
  if (hair === 'bun' && hat && hat !== 'bandana') hair = 'bowl';
  if (hair === 'long' && hat === 'hood') hair = 'tousled';
  const bearded = hair === 'bald' || hair === 'bearded';
  const hairHex = bearded && h(6) < 0.35 ? GREY_HAIR : HAIR[Math.floor(h(7) * HAIR.length)];
  return {
    job: s.job, hair, hat,
    skin: new THREE.Color(SKIN[Math.floor(h(8) * SKIN.length)]),
    hairCol: new THREE.Color(hairHex),
    trousers: new THREE.Color(TROUSERS[Math.floor(h(9) * TROUSERS.length)]).multiplyScalar(0.85 + h(10) * 0.3),
    hatCol: new THREE.Color(hatCol),
    apron: jl.apron !== undefined ? new THREE.Color(jl.apron) : null,
    tunicK: 0.88 + h(11) * 0.2,
    blinkP: 2.8 + h(12) * 2.5,
    blinkO: h(13) * 10,
  };
}

// ------------------------------------------------------------------ poses
interface Pose {
  legL: number; legR: number;
  armL: number; armR: number; splayL: number; splayR: number;
  lean: number; roll: number; twist: number; bob: number; squash: number; lie: number;
  nod: number; yaw: number; tilt: number;
  toolRot: number;
}

function pose(s: Settler, ph: number, moving: boolean, time: number, p: Pose): Pose {
  p.legL = p.legR = p.armL = p.armR = 0;
  p.splayL = p.splayR = 0.2;
  p.lean = p.roll = p.twist = p.bob = p.squash = p.lie = 0;
  p.nod = p.yaw = p.tilt = 0;
  p.toolRot = 0;
  const t = s.animT;
  const sd = s.seed;
  // goods ride on the right shoulder, steadied by the raised right hand, like in the original
  const carryPose = () => {
    p.armR = -2.75 + Math.sin(ph * 2) * 0.03;
    p.splayR = 0.42;
    p.tilt -= 0.08;
  };
  if (s.dead) {
    p.lie = Math.min(1, t / 0.6);
    p.armL = -0.3; p.armR = -0.5;
    p.splayL = p.splayR = 0.6;
    return p;
  }
  if (moving || s.anim === 'walk') {
    const sw = Math.sin(ph);
    p.legL = sw * 0.7; p.legR = -sw * 0.7;
    p.armL = -sw * 0.6; p.armR = sw * 0.6;
    p.bob = Math.abs(Math.cos(ph)) * 0.03;
    p.squash = Math.cos(ph * 2) * 0.025;
    p.roll = sw * 0.06;
    p.tilt = -sw * 0.05;
    p.lean = 0.07;
    p.nod = Math.cos(ph * 2) * 0.03;
    if (s.carrying) carryPose();
    return p;
  }
  switch (s.anim) {
    case 'chop': {
      const c = (t * 1.35) % 1;
      const swing = c < 0.6 ? c / 0.6 : 1 - (c - 0.6) / 0.4;
      p.armR = p.armL = -2.6 + swing * 2.2;
      p.splayL = p.splayR = 0.25;
      p.lean = 0.1 + swing * 0.25;
      p.nod = 0.1 + swing * 0.15;
      p.squash = swing > 0.9 ? 0.03 : 0;
      p.toolRot = 1.6;
      break;
    }
    case 'pick': {
      const c = (t * 1.6) % 1;
      const swing = Math.sin(c * Math.PI);
      p.armR = p.armL = -2.2 + swing * 1.9;
      p.splayL = p.splayR = 0.22;
      p.lean = 0.3 + swing * 0.2;
      p.nod = 0.2;
      p.toolRot = 1.5;
      break;
    }
    case 'hammer': {
      const c = (t * 2.6) % 1;
      p.armR = -1.3 - Math.sin(c * Math.PI * 2) * 0.8;
      p.armL = -0.8;
      p.splayL = 0.35;
      p.lean = 0.25;
      p.nod = 0.25;
      p.toolRot = 1.4;
      break;
    }
    case 'dig': {
      const c = (t * 1.2) % 1;
      const k = Math.sin(c * Math.PI * 2);
      p.armL = p.armR = -0.9 + k * 0.5;
      p.lean = 0.4 + k * 0.15;
      p.nod = 0.25;
      p.legL = 0.3; p.legR = -0.15;
      p.toolRot = 2.3;
      break;
    }
    case 'plant': case 'fill': case 'harvest': {
      if (s.anim === 'harvest') {
        const k = Math.sin(t * 4);
        p.twist = k * 0.6;
        p.armL = p.armR = -0.9;
        p.lean = 0.3;
        p.nod = 0.2;
        p.toolRot = 1.8;
      } else {
        const k = Math.sin(t * 3) * 0.5 + 0.5;
        p.lean = 0.65;
        p.nod = 0.1;
        p.armL = p.armR = -1.2 - k * 0.3;
        p.legL = 0.45; p.legR = -0.3;
      }
      break;
    }
    case 'fish': {
      p.armL = p.armR = -1.1 + Math.sin(t * 1.3) * 0.08;
      p.lean = 0.05;
      p.nod = 0.15;
      p.tilt = Math.sin(t * 0.4) * 0.08;
      p.toolRot = 1.1 + Math.sin(t * 0.8) * 0.1;
      break;
    }
    case 'shoot': {
      p.armL = -1.55; p.splayL = 0.1;
      p.armR = -1.4; p.splayR = 0.5 + Math.min(1, t * 2) * 0.4;
      p.twist = -0.3;
      p.yaw = 0.3;
      break;
    }
    case 'fight': {
      const c = Math.min(1, t / 0.5);
      p.armR = -2.7 + c * 2.5;
      p.armL = -1.0;
      p.lean = 0.15 * c;
      p.legL = 0.35; p.legR = -0.25;
      p.toolRot = 1.4;
      break;
    }
    case 'cheer': {
      const j = Math.abs(Math.sin(t * 7));
      p.armL = p.armR = -2.8 + Math.sin(t * 14) * 0.2;
      p.splayL = p.splayR = 0.5;
      p.bob = j * 0.09;
      p.squash = j < 0.2 ? 0.05 : -0.03;
      p.nod = -0.2;
      break;
    }
    default: {
      // idle: breathe, shift weight, look around
      p.bob = Math.sin(time * 1.6 + sd * 10) * 0.004;
      p.squash = Math.sin(time * 1.6 + sd * 10) * 0.008;
      p.armL = Math.sin(time * 0.7 + sd * 5) * 0.05;
      p.armR = -Math.sin(time * 0.7 + sd * 5) * 0.05;
      p.roll = Math.sin(time * 0.5 + sd * 4) * 0.025;
      p.twist = Math.sin(time * 0.3 + sd * 20) * 0.2;
      p.yaw = Math.sin(time * 0.45 + sd * 31) * 0.45 * Math.max(0, Math.sin(time * 0.21 + sd * 9));
      p.tilt = Math.sin(time * 0.6 + sd * 13) * 0.09;
      p.nod = Math.sin(time * 0.37 + sd * 17) * 0.06;
      if (s.carrying) carryPose();
      if (s.job === 'swordsman' || s.job === 'bowman') { p.armR = -0.3; p.armL = -0.5; p.yaw *= 0.5; }
    }
  }
  return p;
}

// ------------------------------------------------------------------ renderer
export class SettlersRenderer {
  group = new THREE.Group();
  cap = 3000;
  visibleList: { s: Settler; x: number; y: number; z: number }[] = [];
  private legs: Batch;
  private torsos: Batch;
  private arms: Batch;
  private aprons: Batch;
  private eyes: Batch;
  private tufts: Batch;
  private shields: Batch;
  private heads = new Map<HairStyle, Batch>();
  private hats = new Map<Hat, Batch>();
  private tools = new Map<Good, Batch>();
  private carried = new Map<Good, Batch>();
  private phase = new Map<number, number>();
  private looks = new Map<number, Look>();
  private frustum = new THREE.Frustum();
  private projM = new THREE.Matrix4();
  private P: Pose = {} as Pose;
  // scratch
  private mBase = new THREE.Matrix4();
  private mBody = new THREE.Matrix4();
  private mHead = new THREE.Matrix4();
  private mArmL = new THREE.Matrix4();
  private mArmR = new THREE.Matrix4();
  private mA = new THREE.Matrix4();
  private mB = new THREE.Matrix4();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private cTunic = new THREE.Color();
  private cSleeve = new THREE.Color();
  private cJob = new THREE.Color();
  private white = new THREE.Color(1, 1, 1);
  private goldHelm = new THREE.Color(0xe0b040);
  private playerCols: THREE.Color[] = [];
  private sphere = new THREE.Sphere(new THREE.Vector3(), 0.8);

  constructor(private game: Game, goodGeos: Record<Good, THREE.BufferGeometry>) {
    const g = buildSettlerGeos();
    const mat = settlerMaterial();
    const n = this.cap;
    this.legs = new Batch(g.leg, mat, n * 2);
    this.torsos = new Batch(g.torso, mat, n);
    this.arms = new Batch(g.arm, mat, n * 2);
    this.aprons = new Batch(g.apron, mat, n);
    this.eyes = new Batch(g.eyes, mat, n, false);
    this.tufts = new Batch(g.tuft, mat, n);
    this.shields = new Batch(g.shield, mat, 800);
    this.eyes.mesh.castShadow = false;
    for (const hs of HAIR_STYLES) this.heads.set(hs, new Batch(g.heads[hs], mat, n));
    for (const h of HATS) this.hats.set(h, new Batch(g.hats[h], mat, n));
    const toolMat = simpleMat(0.5, 0.3, 'tool');
    for (const tg of ['axe', 'pickaxe', 'saw', 'hammer', 'shovel', 'scythe', 'rod', 'sword', 'bow', 'water'] as Good[]) {
      this.tools.set(tg, new Batch(goodGeos[tg], toolMat, 1200, false));
    }
    const goodMat = simpleMat(0.7, 0, 'good');
    for (const gd of GOODS) this.carried.set(gd, new Batch(goodGeos[gd], goodMat, 800, false));
    for (const b of this.all()) this.group.add(b.mesh);
  }

  private all(): Batch[] {
    return [this.legs, this.torsos, this.arms, this.aprons, this.eyes, this.tufts, this.shields,
      ...this.heads.values(), ...this.hats.values(), ...this.tools.values(), ...this.carried.values()];
  }

  private look(s: Settler): Look {
    let l = this.looks.get(s.id);
    if (!l || l.job !== s.job) {
      l = makeLook(s);
      this.looks.set(s.id, l);
    }
    return l;
  }

  /** m = m * T(0, y, 0) * R * T(0, -y, 0) */
  private rotAbout(m: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder = 'XYZ') {
    m.multiply(this.mA.makeTranslation(x, y, z));
    m.multiply(this.mA.makeRotationFromEuler(this.e.set(rx, ry, rz, order)));
    m.multiply(this.mA.makeTranslation(-x, -y, -z));
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    const g = this.game;
    const w = g.world;
    this.projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
    this.visibleList.length = 0;
    if (this.playerCols.length !== g.players.length) this.playerCols = g.players.map((p) => new THREE.Color(BANNER_COLORS[p.id] ?? p.color));
    const P = this.P;
    let count = 0;
    for (const s of g.settlers.values()) {
      if ((s.hidden && !s.aboard) || s.job === 'donkey' || s.job === 'catapult') continue;
      if (count >= this.cap) break;
      // passengers stand on the deck of their ship
      const y0 = s.aboard ? shipDeckY(time, s.aboard) - 0.02 + DECK_H : w.heightAt(s.x, s.z);
      this.sphere.center.set(s.x, y0 + 0.35, s.z);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      if (!w.explored[w.idx(Math.round(s.x), Math.round(s.z))] && s.owner !== g.local) continue;
      count++;
      this.visibleList.push({ s, x: s.x, y: y0, z: s.z });
      const L = this.look(s);
      const moving = s.next >= 0;
      let ph = this.phase.get(s.id) ?? s.seed * 10;
      // short legs take quick little steps
      if (moving) ph += dt * Math.PI * 2 * 1.6 / Math.max(0.3, s.stepDur * 1.1);
      this.phase.set(s.id, ph);
      pose(s, ph, moving, time, P);

      // --- skeleton
      const sink = s.dead ? Math.max(0, s.deadT - 3) * 0.15 : 0;
      this.q.setFromEuler(this.e.set(0, s.heading, 0));
      this.mBase.compose(this.v.set(s.x, y0 + P.bob - sink, s.z), this.q, this.sc.set(SCALE * (1 + P.squash * 0.5), SCALE * (1 - P.squash), SCALE * (1 + P.squash * 0.5)));
      if (P.lie > 0) this.mBase.multiply(this.mA.makeRotationX(-P.lie * Math.PI / 2 * 0.95));
      const body = this.mBody.copy(this.mBase);
      if (P.twist) body.multiply(this.mA.makeRotationY(P.twist));
      if (P.lean || P.roll) this.rotAbout(body, 0, RIG.hipY, 0, P.lean, 0, P.roll);
      const head = this.mHead.copy(body);
      this.rotAbout(head, 0, RIG.neckY, 0, P.nod, P.yaw, P.tilt, 'YXZ');

      // --- colours
      const pc = this.playerCols[s.owner] ?? this.white;
      const soldier = s.job === 'swordsman' || s.job === 'bowman';
      const tunic = this.cTunic.copy(pc);
      if (!soldier && s.job !== 'carrier') tunic.lerp(this.cJob.set(JOB_LOOK[s.job].hatCol), s.job === 'priest' ? 0.8 : 0.15);
      tunic.multiplyScalar(L.tunicK);
      const sleeve = this.cSleeve.copy(tunic);

      // --- legs
      for (const [side, ang] of [[-1, P.legL], [1, P.legR]] as const) {
        this.mB.copy(this.mBase).multiply(this.mA.makeTranslation(side * RIG.hipX, RIG.hipY, 0)).multiply(this.mA.makeRotationX(ang));
        this.legs.add(this.mB, L.trousers);
      }
      // --- torso, apron
      this.torsos.add(body, tunic);
      if (L.apron) this.aprons.add(body, L.apron);
      // --- head, eyes, hat
      this.heads.get(L.hair)!.add(head, L.skin, L.hairCol);
      const tb = (time + L.blinkO) % L.blinkP;
      const blink = s.dead ? 0.12 : tb < 0.14 ? Math.max(0.12, Math.abs(tb - 0.07) / 0.07) : 1;
      this.mB.copy(head);
      if (blink < 1) this.mB.multiply(this.mA.makeTranslation(0, RIG.eyeY, 0)).multiply(this.mA.makeScale(1, blink, 1)).multiply(this.mA.makeTranslation(0, -RIG.eyeY, 0));
      this.eyes.add(this.mB);
      if (!L.hat && (L.hair === 'tousled' || L.hair === 'bearded')) this.tufts.add(head, L.hairCol);
      if (L.hat) {
        let hc = L.hatCol;
        if (s.job === 'swordsman' && s.level > 0) hc = this.cJob.copy(L.hatCol).lerp(this.goldHelm, Math.min(1, s.level * 0.35));
        this.hats.get(L.hat)!.add(head, hc, pc);
      }
      // --- arms
      for (const [side, ang, splay, out] of [[-1, P.armL, P.splayL, this.mArmL], [1, P.armR, P.splayR, this.mArmR]] as const) {
        out.copy(body).multiply(this.mA.makeTranslation(side * RIG.shoulderX, RIG.shoulderY, 0));
        out.multiply(this.mA.makeRotationFromEuler(this.e.set(ang, 0, side * splay)));
        this.arms.add(out, sleeve, L.skin);
      }
      // --- tool
      let tool = TOOL[s.job];
      if (s.job === 'waterman' && s.carrying !== 'water') tool = undefined;
      if (s.carrying && s.job !== 'waterman') tool = undefined;
      if (tool) {
        const hand = tool === 'bow' ? this.mArmL : this.mArmR;
        const m = this.mB.copy(hand).multiply(this.mA.makeTranslation(0, RIG.handY, 0.01));
        if (tool === 'bow') {
          m.multiply(this.mA.makeRotationFromEuler(this.e.set(Math.PI / 2, Math.PI / 2, 0))).multiply(this.mA.makeTranslation(0.1, -0.2, 0));
        } else if (tool === 'water') {
          m.multiply(this.mA.makeTranslation(0, -0.12, 0));
        } else {
          m.multiply(this.mA.makeRotationX(P.toolRot || 1.3)).multiply(this.mA.makeTranslation(0, -0.11, 0)).multiply(this.mA.makeScale(0.9, 0.9, 0.9));
        }
        this.tools.get(tool)!.add(m);
      }
      if (s.job === 'swordsman') {
        const m = this.mB.copy(this.mArmL).multiply(this.mA.makeTranslation(-0.05, -0.11, 0.02));
        m.multiply(this.mA.makeRotationY(-1.05));
        this.shields.add(m, pc);
      }
      // --- carried good on the right shoulder, long goods slung diagonally
      if (s.carrying) {
        const m = this.mB.copy(body).multiply(this.mA.makeTranslation(0.17, 0.425, -0.01));
        if (s.carrying === 'log' || s.carrying === 'board') m.multiply(this.mA.makeRotationFromEuler(this.e.set(0, 1.25, 0.45)));
        else m.multiply(this.mA.makeTranslation(0, 0.02, 0));
        this.carried.get(s.carrying)!.add(m);
      }
    }
    for (const b of this.all()) b.finish();
    if (this.phase.size > g.settlers.size + 500) {
      for (const id of this.phase.keys()) if (!g.settlers.has(id)) { this.phase.delete(id); this.looks.delete(id); }
    }
  }
}
