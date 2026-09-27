// Instanced renderers for trees, rocks, fields, grass, settlers, animals, goods and arrows.
import * as THREE from 'three';
import { GOODS, Good, Job, T_FOREST, T_GRASS, T_MEADOW } from '../game/defs';
import type { Game } from '../game/game';
import type { Settler } from '../game/types';
import { WATER_LEVEL } from '../game/world';
import { hash2 } from '../core/rng';
import { buildDeerGeos, buildGoodGeos, buildGrassTuft, buildRockGeos, buildSettlerGeos, buildTreeGeos, buildWheatGeo } from './models';
import { G, patchMaterial, patchedDepthMaterial } from './shaderPatch';
import { leafTexture } from './textures';
import { BANNER_COLORS } from './materials';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function vcMat(opts: THREE.MeshStandardMaterialParameters = {}, wind: 'none' | 'tree' | 'grass' = 'none', windAmp = 1, extra: any = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...opts });
  patchMaterial(m, { wind, windAmp, key: `vc_${wind}_${windAmp}_${extra.key ?? ''}`, ...extra });
  return m;
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = true, depth?: THREE.Material) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.frustumCulled = false;
  if (depth) m.customDepthMaterial = depth;
  return m;
}

// ------------------------------------------------------------------ trees
export class TreesRenderer {
  group = new THREE.Group();
  private trunks: THREE.InstancedMesh[] = [];
  private crowns: THREE.InstancedMesh[] = [];
  private cards: (THREE.InstancedMesh | null)[] = [];
  private version = -1;
  private fallStart = new Map<number, number>();
  private leafMat: THREE.Material;

  constructor(private game: Game) {
    const geos = buildTreeGeos();
    const barkMat = vcMat({ roughness: 0.95 }, 'tree', 0.6);
    this.leafMat = vcMat({ roughness: 0.8, side: THREE.DoubleSide }, 'tree', 1, {
      key: 'leaf',
      fragEmissive: `{
        vec3 V = normalize(vViewPosition);
        vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float back = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * (0.10 + back * 0.35) * (1.0 - uNight * 0.8);
      }`,
    });
    const depth = patchedDepthMaterial({ wind: 'tree' });
    const leafTex = leafTexture(0);
    const needleTex = leafTexture(1);
    const mkCard = (map: THREE.Texture, key: string) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, map, alphaTest: 0.45, side: THREE.DoubleSide });
      return patchMaterial(m, {
      wind: 'tree', key,
      fragEmissive: `{
        vec3 V = normalize(vViewPosition);
        vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float back = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * (0.08 + back * 0.45) * (1.0 - uNight * 0.8);
      }`,
      });
    };
    const cardMat = mkCard(leafTex, 'leafcard');
    const needleMat = mkCard(needleTex, 'needlecard');
    const cardDepth = patchedDepthMaterial({ wind: 'tree', map: leafTex, alphaTest: 0.45 });
    const needleDepth = patchedDepthMaterial({ wind: 'tree', map: needleTex, alphaTest: 0.45, key: 'nd' });
    const cap = Math.max(4000, game.trees.size * 2);
    for (const g of geos) {
      const t = inst(g.trunk, barkMat, cap, true, depth);
      const c = inst(g.crown, this.leafMat, cap, true, depth);
      this.trunks.push(t);
      this.crowns.push(c);
      this.group.add(t, c);
      if (g.cards) {
        const cm = inst(g.cards, g.needles ? needleMat : cardMat, cap, true, g.needles ? needleDepth : cardDepth);
        this.cards.push(cm);
        this.group.add(cm);
      } else this.cards.push(null);
    }
  }

  update(time: number) {
    const g = this.game;
    let falling = false;
    for (const t of g.trees.values()) if (t.state === 'falling') { falling = true; break; }
    if (g.treesVersion === this.version && !falling) return;
    this.version = g.treesVersion;
    const w = g.world;
    const counts = this.trunks.map(() => 0);
    for (const t of g.trees.values()) {
      const sp = t.species;
      const i = counts[sp]++;
      const x = w.nx(t.node) + (hash2(t.node, 1, 7) - 0.5) * 0.5;
      const z = w.ny(t.node) + (hash2(t.node, 2, 7) - 0.5) * 0.5;
      const y = w.heightAt(x, z) - 0.05;
      const s = t.scale * (0.18 + 0.82 * Math.min(1, t.growth));
      tmpE.set(0, t.rot, 0);
      tmpQ.setFromEuler(tmpE);
      if (t.state === 'falling') {
        let st = this.fallStart.get(t.id);
        if (st === undefined) { st = time; this.fallStart.set(t.id, st); }
        const k = Math.min(1, (time - st) / 1.5);
        const ang = k * k * (Math.PI / 2 - 0.08);
        const axis = tmpV.set(Math.cos(t.fallDir), 0, -Math.sin(t.fallDir)).normalize();
        const fq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
        tmpQ.premultiply(fq);
      }
      tmpM.compose(tmpS.set(x, y, z), tmpQ, new THREE.Vector3(s, s * (0.95 + hash2(t.node, 3, 7) * 0.15), s));
      this.trunks[sp].setMatrixAt(i, tmpM);
      this.crowns[sp].setMatrixAt(i, tmpM);
      const tint = 0.85 + hash2(t.node, 4, 7) * 0.3;
      // autumn-ish variety on some trees
      const warm = hash2(t.node, 6, 7) > 0.88 ? 0.25 : 0;
      tmpC.setRGB(tint * (1 + warm * 0.9), tint * (0.95 + hash2(t.node, 5, 7) * 0.1), tint * (0.9 - warm));
      this.crowns[sp].setColorAt(i, tmpC);
      const cm = this.cards[sp];
      if (cm) { cm.setMatrixAt(i, tmpM); cm.setColorAt(i, tmpC); }
    }
    for (let sp = 0; sp < this.trunks.length; sp++) {
      this.trunks[sp].count = counts[sp];
      this.crowns[sp].count = counts[sp];
      const cm = this.cards[sp];
      if (cm) { cm.count = counts[sp]; cm.instanceMatrix.needsUpdate = true; if (cm.instanceColor) cm.instanceColor.needsUpdate = true; }
      this.trunks[sp].instanceMatrix.needsUpdate = true;
      this.crowns[sp].instanceMatrix.needsUpdate = true;
      if (this.crowns[sp].instanceColor) this.crowns[sp].instanceColor!.needsUpdate = true;
    }
    if (this.fallStart.size > 200) {
      for (const id of this.fallStart.keys()) if (!g.trees.has(id)) this.fallStart.delete(id);
    }
  }
}

// ------------------------------------------------------------------ rocks
export class StonesRenderer {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private version = -1;
  constructor(private game: Game) {
    const mat = vcMat({ roughness: 0.9 });
    for (const g of buildRockGeos()) {
      const m = inst(g, mat, 2000);
      this.meshes.push(m);
      this.group.add(m);
    }
  }
  update() {
    const g = this.game;
    if (g.stonesVersion === this.version) return;
    this.version = g.stonesVersion;
    const w = g.world;
    const counts = [0, 0, 0];
    for (const s of g.stones.values()) {
      const v = s.variant;
      const x = w.nx(s.node), z = w.ny(s.node);
      const y = w.heightAt(x, z) - 0.08;
      const k = 0.55 + 0.6 * (s.amount / s.max);
      tmpE.set(0, s.rot, 0);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(k * 1.3, k * 1.25, k * 1.3));
      this.meshes[v].setMatrixAt(counts[v]++, tmpM);
    }
    this.meshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; });
  }
}

// ------------------------------------------------------------------ wheat fields
export class FieldsRenderer {
  mesh: THREE.InstancedMesh;
  private version = -1;
  constructor(private game: Game) {
    const mat = vcMat({ roughness: 0.9 }, 'grass', 0.25);
    this.mesh = inst(buildWheatGeo(), mat, 1500, true);
  }
  update() {
    const g = this.game;
    if (g.fieldsVersion === this.version) return;
    this.version = g.fieldsVersion;
    const w = g.world;
    let n = 0;
    const green = new THREE.Color(0x6a9a38), gold = new THREE.Color(0xe0b850);
    for (const f of g.fields.values()) {
      const x = w.nx(f.node), z = w.ny(f.node);
      const y = w.heightAt(x, z);
      const s = 0.2 + 0.8 * f.growth;
      tmpQ.setFromAxisAngle(UP, hash2(f.node, 1, 3) * 6);
      tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(1.05, s, 1.05));
      this.mesh.setMatrixAt(n, tmpM);
      tmpC.copy(green).lerp(gold, Math.pow(f.growth, 2));
      this.mesh.setColorAt(n, tmpC);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ grass tufts
export class GrassRenderer {
  mesh: THREE.InstancedMesh;
  private t = 0;
  enabled = true;
  constructor(private game: Game) {
    const mat = vcMat({ roughness: 0.95 }, 'grass', 0.5, { key: 'tuft' });
    this.mesh = inst(buildGrassTuft(), mat, 60000, false);
    this.rebuild();
  }
  rebuild() {
    const g = this.game;
    const w = g.world;
    let n = 0;
    const cap = 60000;
    const colors: Record<number, number[]> = { [T_GRASS]: [0.09, 0.2, 0.03], [T_MEADOW]: [0.14, 0.26, 0.05], [T_FOREST]: [0.06, 0.14, 0.03] };
    for (let i = 0; i < w.N && n < cap; i++) {
      const t = w.terrain[i];
      const col = colors[t];
      if (!col) continue;
      if (w.building[i] || w.reserve[i] || w.field[i] || w.stone[i] || w.wear[i] > 0.25) continue;
      if (w.h[i] < WATER_LEVEL + 0.25) continue;
      if (w.slopeAt(i) > 0.6) continue;
      const x0 = w.nx(i), z0 = w.ny(i);
      const per = t === T_MEADOW ? 4 : t === T_FOREST ? 2 : 3;
      for (let k = 0; k < per && n < cap; k++) {
        if (hash2(i, k, 91) < 0.25) continue;
        const x = x0 + (hash2(i, k, 1) - 0.5), z = z0 + (hash2(i, k, 2) - 0.5);
        const y = w.heightAt(x, z) - 0.01;
        const s = 0.55 + hash2(i, k, 3) * 0.6;
        tmpQ.setFromAxisAngle(UP, hash2(i, k, 4) * 6.28);
        tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(s, s * (1 - w.wear[i] * 2), s));
        this.mesh.setMatrixAt(n, tmpM);
        const v = 0.8 + hash2(i, k, 5) * 0.4;
        tmpC.setRGB(col[0] * v, col[1] * v, col[2] * v * 0.9);
        this.mesh.setColorAt(n, tmpC);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number) {
    this.mesh.visible = this.enabled;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 6;
      if (this.enabled) this.rebuild();
    }
  }
}

// ------------------------------------------------------------------ settlers
const HAT: Record<Job, [number, number]> = {
  carrier: [4, 0x5a3a20], builder: [0, 0xd8a030], digger: [2, 0xc8a860], woodcutter: [0, 0x3a7030],
  forester: [2, 0x4a7a38], stonecutter: [0, 0x8a8a88], sawyer: [0, 0x8a5a30], fisher: [2, 0x3a5a8a],
  hunter: [3, 0x4a6a30], farmer: [2, 0xe0c060], miller: [0, 0xf0f0e8], baker: [0, 0xf8f8f0],
  butcher: [0, 0xb03a30], pigfarmer: [2, 0x8a6040], waterman: [0, 0x4a7ab0], miner: [1, 0x6a4a2a],
  smelter: [3, 0x3a3a3a], toolsmith: [0, 0x4a4a4a], weaponsmith: [3, 0x5a3a3a], swordsman: [1, 0xb0b4bc], bowman: [3, 0x4a5a2a],
};
const TOOL: Partial<Record<Job, Good>> = {
  woodcutter: 'axe', stonecutter: 'pickaxe', builder: 'hammer', digger: 'shovel', farmer: 'scythe', fisher: 'rod',
  hunter: 'bow', miner: 'pickaxe', forester: 'shovel', swordsman: 'sword', bowman: 'bow', sawyer: 'saw', waterman: 'water',
};
const SKIN = [0xf0c8a0, 0xe0b088, 0xc89070, 0xa87050, 0xf4d4b4];

interface Pose { legL: number; legR: number; armL: number; armR: number; armLz: number; armRz: number; lean: number; bob: number; twist: number; lie: number; toolRot: number; }

function pose(s: Settler, walkPhase: number, moving: boolean, time: number): Pose {
  const p: Pose = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0.08, armRz: -0.08, lean: 0, bob: 0, twist: 0, lie: 0, toolRot: 0 };
  const t = s.animT;
  if (s.dead) {
    p.lie = Math.min(1, t / 0.6);
    p.armL = -0.3; p.armR = -0.4;
    return p;
  }
  if (moving || s.anim === 'walk') {
    const sw = Math.sin(walkPhase);
    p.legL = sw * 0.6; p.legR = -sw * 0.6;
    p.armL = -sw * 0.5; p.armR = sw * 0.5;
    p.bob = Math.abs(Math.cos(walkPhase)) * 0.025;
    if (s.carrying) { p.armL = p.armR = -1.1; p.armLz = 0.25; p.armRz = -0.25; }
    return p;
  }
  switch (s.anim) {
    case 'chop': {
      const c = (t * 1.35) % 1;
      const swing = c < 0.6 ? c / 0.6 : 1 - (c - 0.6) / 0.4 * 1.0;
      p.armR = p.armL = -2.6 + swing * 2.2;
      p.armLz = 0.25; p.armRz = -0.25;
      p.lean = 0.1 + swing * 0.25;
      p.toolRot = 1.6;
      break;
    }
    case 'pick': {
      const c = (t * 1.6) % 1;
      const swing = Math.sin(c * Math.PI);
      p.armR = p.armL = -2.2 + swing * 1.9;
      p.armLz = 0.2; p.armRz = -0.2;
      p.lean = 0.3 + swing * 0.2;
      p.toolRot = 1.5;
      break;
    }
    case 'hammer': {
      const c = (t * 2.6) % 1;
      p.armR = -1.3 - Math.sin(c * Math.PI * 2) * 0.8;
      p.armL = -0.7;
      p.lean = 0.25;
      p.toolRot = 1.4;
      break;
    }
    case 'dig': {
      const c = (t * 1.2) % 1;
      const k = Math.sin(c * Math.PI * 2);
      p.armL = p.armR = -0.9 + k * 0.5;
      p.lean = 0.45 + k * 0.15;
      p.legL = 0.3; p.legR = -0.15;
      p.toolRot = 2.3;
      break;
    }
    case 'plant': case 'fill': case 'harvest': {
      if (s.anim === 'harvest') {
        const k = Math.sin(t * 4);
        p.twist = k * 0.6;
        p.armL = p.armR = -0.9;
        p.lean = 0.35;
        p.toolRot = 1.8;
      } else {
        const k = Math.sin(t * 3) * 0.5 + 0.5;
        p.lean = 0.75;
        p.armL = p.armR = -1.2 - k * 0.3;
        p.legL = 0.5; p.legR = -0.3;
      }
      break;
    }
    case 'fish': {
      p.armL = p.armR = -1.1 + Math.sin(t * 1.3) * 0.08;
      p.lean = 0.05;
      p.toolRot = 1.1 + Math.sin(t * 0.8) * 0.1;
      break;
    }
    case 'shoot': {
      p.armL = -1.55; p.armLz = 0.1;
      p.armR = -1.4; p.armRz = -0.5 - Math.min(1, t * 2) * 0.4;
      p.twist = -0.3;
      p.toolRot = 0;
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
      p.armL = p.armR = -2.9 + Math.sin(t * 8) * 0.2;
      p.bob = Math.abs(Math.sin(t * 8)) * 0.06;
      break;
    }
    default: {
      // idle breathing, occasional weight shift
      p.bob = Math.sin(time * 1.5 + s.seed * 10) * 0.004;
      p.armL = Math.sin(time * 0.7 + s.seed * 5) * 0.05;
      p.armR = -Math.sin(time * 0.7 + s.seed * 5) * 0.05;
      p.twist = Math.sin(time * 0.3 + s.seed * 20) * 0.25;
      if (s.carrying) { p.armL = p.armR = -1.1; p.armLz = 0.25; p.armRz = -0.25; }
      if (s.job === 'swordsman' || s.job === 'bowman') { p.armR = -0.3; p.armL = -0.5; }
    }
  }
  return p;
}

export class SettlersRenderer {
  group = new THREE.Group();
  private legs: THREE.InstancedMesh;
  private torsos: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private hats: THREE.InstancedMesh[];
  private shields: THREE.InstancedMesh;
  private tools = new Map<Good, THREE.InstancedMesh>();
  private carried = new Map<Good, THREE.InstancedMesh>();
  private phase = new Map<number, number>();
  private frustum = new THREE.Frustum();
  private projM = new THREE.Matrix4();
  cap = 3000;
  visibleList: { s: Settler; x: number; y: number; z: number }[] = [];

  constructor(private game: Game, goodGeos: Record<Good, THREE.BufferGeometry>) {
    const g = buildSettlerGeos();
    const mat = vcMat({ roughness: 0.8 });
    const metalMat = vcMat({ roughness: 0.35, metalness: 0.7 }, 'none', 1, { key: 'smetal' });
    const n = this.cap;
    this.legs = inst(g.leg, mat, n * 2);
    this.torsos = inst(g.torso, mat, n);
    this.arms = inst(g.arm, mat, n * 2);
    this.heads = inst(g.head, mat, n);
    this.hats = g.hats.map((h, i) => inst(h, i === 1 ? metalMat : mat, n));
    this.shields = inst(g.shield, mat, 800);
    this.group.add(this.legs, this.torsos, this.arms, this.heads, ...this.hats, this.shields);
    const toolMat = vcMat({ roughness: 0.5, metalness: 0.3 }, 'none', 1, { key: 'tool' });
    for (const tg of ['axe', 'pickaxe', 'saw', 'hammer', 'shovel', 'scythe', 'rod', 'sword', 'bow', 'water'] as Good[]) {
      const m = inst(goodGeos[tg], toolMat, 1200);
      this.tools.set(tg, m);
      this.group.add(m);
    }
    const goodMat = vcMat({ roughness: 0.7 }, 'none', 1, { key: 'good' });
    for (const gd of GOODS) {
      const m = inst(goodGeos[gd], goodMat, 800);
      this.carried.set(gd, m);
      this.group.add(m);
    }
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    const g = this.game;
    const w = g.world;
    this.projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
    let nL = 0, nT = 0, nA = 0, nH = 0, nS = 0;
    const hatN = this.hats.map(() => 0);
    const toolN = new Map<Good, number>();
    const carN = new Map<Good, number>();
    const base = new THREE.Matrix4();
    const part = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const sphere = new THREE.Sphere(new THREE.Vector3(), 0.8);
    this.visibleList.length = 0;
    const pc = g.players.map((p) => new THREE.Color(BANNER_COLORS[p.id] ?? p.color));
    for (const s of g.settlers.values()) {
      if (s.hidden) continue;
      if (nT >= this.cap) break;
      const y0 = w.heightAt(s.x, s.z);
      sphere.center.set(s.x, y0 + 0.3, s.z);
      if (!this.frustum.intersectsSphere(sphere)) continue;
      if (!w.explored[w.idx(Math.round(s.x), Math.round(s.z))] && s.owner !== g.local) continue;
      this.visibleList.push({ s, x: s.x, y: y0, z: s.z });
      const moving = s.next >= 0;
      let ph = this.phase.get(s.id) ?? s.seed * 10;
      if (moving) ph += dt * Math.PI * 2 / Math.max(0.3, s.stepDur * 1.1);
      this.phase.set(s.id, ph);
      const P = pose(s, ph, moving, time);
      // base transform
      const sink = s.dead ? Math.max(0, s.deadT - 3) * 0.15 : 0;
      tmpE.set(0, s.heading, 0);
      tmpQ.setFromEuler(tmpE);
      base.compose(tmpS.set(s.x, y0 + P.bob - sink, s.z), tmpQ, tmpV.set(1, 1, 1));
      if (P.lie > 0) {
        rot.makeRotationX(-P.lie * Math.PI / 2 * 0.95);
        base.multiply(rot);
      }
      const bodyM = new THREE.Matrix4().copy(base);
      if (P.twist) bodyM.multiply(rot.makeRotationY(P.twist));
      if (P.lean) {
        bodyM.multiply(part.makeTranslation(0, 0.27, 0)).multiply(rot.makeRotationX(P.lean)).multiply(new THREE.Matrix4().makeTranslation(0, -0.27, 0));
      }
      const owner = s.owner;
      const col = pc[owner] ?? tmpC.set(0xffffff);
      const soldier = s.job === 'swordsman' || s.job === 'bowman';
      // legs
      const trouser = soldier ? new THREE.Color(0x5a4a3a) : new THREE.Color(0x6a5040).multiplyScalar(0.8 + s.seed * 0.4);
      for (const [side, ang] of [[-1, P.legL], [1, P.legR]] as [number, number][]) {
        part.copy(base).multiply(rot.makeTranslation(side * 0.045, 0.27, 0)).multiply(new THREE.Matrix4().makeRotationX(ang));
        this.legs.setMatrixAt(nL, part);
        this.legs.setColorAt(nL, trouser);
        nL++;
      }
      // torso
      this.torsos.setMatrixAt(nT, bodyM);
      const tunic = tmpC.copy(col);
      if (!soldier && s.job !== 'carrier') tunic.lerp(new THREE.Color(HAT[s.job][1]), 0.25);
      if (s.job === 'carrier') tunic.multiplyScalar(0.85 + s.seed * 0.2);
      this.torsos.setColorAt(nT, tunic);
      // head
      this.heads.setMatrixAt(nT, bodyM);
      this.heads.setColorAt(nT, new THREE.Color(SKIN[Math.floor(s.seed * SKIN.length) % SKIN.length]));
      nT++;
      // hat
      const [hat, hatCol] = HAT[s.job];
      this.hats[hat].setMatrixAt(hatN[hat], bodyM);
      const hc = new THREE.Color(hatCol);
      if (hat === 4) hc.setHex([0x3a2414, 0x6a4020, 0xb08040, 0x1a1210, 0x8a5a30][Math.floor(s.seed * 97) % 5]);
      if (s.job === 'swordsman' && s.level > 0) hc.lerp(new THREE.Color(0xe0b040), 0.5);
      this.hats[hat].setColorAt(hatN[hat], hc);
      hatN[hat]++;
      // arms
      const sleeve = tmpC.copy(col).multiplyScalar(0.9);
      let rightArm: THREE.Matrix4 | null = null, leftArm: THREE.Matrix4 | null = null;
      for (const [side, ang, az] of [[-1, P.armL, P.armLz], [1, P.armR, P.armRz]] as [number, number, number][]) {
        const m = new THREE.Matrix4().copy(bodyM).multiply(rot.makeTranslation(side * 0.13, 0.49, 0));
        tmpE.set(ang, 0, az * -side);
        m.multiply(new THREE.Matrix4().makeRotationFromEuler(tmpE));
        this.arms.setMatrixAt(nA, m);
        this.arms.setColorAt(nA, sleeve);
        nA++;
        if (side === 1) rightArm = m; else leftArm = m;
      }
      // tool
      let tool = TOOL[s.job];
      if (s.job === 'waterman' && s.carrying !== 'water') tool = undefined;
      if (s.carrying && s.job !== 'waterman') tool = undefined;
      if (tool && rightArm) {
        const tm = this.tools.get(tool)!;
        const c = toolN.get(tool) ?? 0;
        if (c < 1200) {
          const hand = tool === 'bow' && leftArm ? leftArm : rightArm;
          part.copy(hand).multiply(rot.makeTranslation(0, -0.24, 0.02));
          if (tool === 'bow') part.multiply(new THREE.Matrix4().makeRotationFromEuler(tmpE.set(Math.PI / 2, Math.PI / 2, 0))).multiply(new THREE.Matrix4().makeTranslation(0.1, -0.2, 0));
          else if (tool === 'water') part.multiply(new THREE.Matrix4().makeTranslation(0, -0.13, 0));
          else part.multiply(new THREE.Matrix4().makeRotationX(P.toolRot || 1.3)).multiply(new THREE.Matrix4().makeTranslation(0, -0.12, 0));
          tm.setMatrixAt(c, part);
          toolN.set(tool, c + 1);
        }
      }
      if (s.job === 'swordsman' && leftArm && nS < 800) {
        part.copy(leftArm).multiply(rot.makeTranslation(-0.02, -0.16, 0.06));
        this.shields.setMatrixAt(nS, part);
        this.shields.setColorAt(nS, pc[owner]);
        nS++;
      }
      // carried good
      if (s.carrying) {
        const cm = this.carried.get(s.carrying)!;
        const c = carN.get(s.carrying) ?? 0;
        if (c < 800) {
          part.copy(bodyM).multiply(rot.makeTranslation(0, 0.34, 0.2));
          if (s.carrying === 'log' || s.carrying === 'board') part.multiply(new THREE.Matrix4().makeRotationY(0.25));
          cm.setMatrixAt(c, part);
          carN.set(s.carrying, c + 1);
        }
      }
    }
    const fin = (m: THREE.InstancedMesh, n: number) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    fin(this.legs, nL); fin(this.torsos, nT); fin(this.heads, nT); fin(this.arms, nA); fin(this.shields, nS);
    this.hats.forEach((h, i) => fin(h, hatN[i]));
    for (const [k, m] of this.tools) fin(m, toolN.get(k) ?? 0);
    for (const [k, m] of this.carried) fin(m, carN.get(k) ?? 0);
    if (this.phase.size > g.settlers.size + 500) {
      for (const id of this.phase.keys()) if (!g.settlers.has(id)) this.phase.delete(id);
    }
  }
}

// ------------------------------------------------------------------ deer
export class AnimalsRenderer {
  group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private phase = new Map<number, number>();
  constructor(private game: Game) {
    const g = buildDeerGeos();
    const mat = vcMat({ roughness: 0.85 });
    this.body = inst(g.body, mat, 600);
    this.legs = inst(g.leg, mat, 2400);
    this.group.add(this.body, this.legs);
  }
  update(dt: number, time: number) {
    const g = this.game;
    const w = g.world;
    let nb = 0, nl = 0;
    const base = new THREE.Matrix4(), m = new THREE.Matrix4(), r = new THREE.Matrix4();
    for (const a of g.animals.values()) {
      if (nb >= 600) break;
      if (!w.explored[w.idx(Math.round(a.x), Math.round(a.z))]) continue;
      const y = w.heightAt(a.x, a.z);
      const moving = a.next >= 0;
      let ph = this.phase.get(a.id) ?? a.id;
      if (moving) ph += dt * 9;
      this.phase.set(a.id, ph);
      tmpQ.setFromEuler(tmpE.set(0, a.heading, 0));
      base.compose(tmpS.set(a.x, y, a.z), tmpQ, tmpV.set(1, 1, 1));
      if (!a.alive) base.multiply(r.makeRotationZ(Math.PI / 2 * 0.92)).multiply(m.makeTranslation(0.15, -0.15, 0));
      else if (!moving) {
        // graze: head down occasionally
        const graze = Math.max(0, Math.sin(time * 0.4 + a.id)) * 0.25;
        base.multiply(r.makeTranslation(0, 0.3, 0.2)).multiply(m.makeRotationX(graze)).multiply(r.makeTranslation(0, -0.3, -0.2));
      }
      this.body.setMatrixAt(nb++, base);
      const legs = [[-0.07, 0.18, 0], [0.07, 0.18, Math.PI], [-0.07, -0.16, Math.PI], [0.07, -0.16, 0]];
      for (const [lx, lz, off] of legs) {
        const ang = moving ? Math.sin(ph + off) * 0.6 : 0;
        m.copy(base).multiply(r.makeTranslation(lx, 0.32, lz)).multiply(new THREE.Matrix4().makeRotationX(ang));
        this.legs.setMatrixAt(nl++, m);
      }
    }
    this.body.count = nb; this.legs.count = nl;
    this.body.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ arrows
export class ProjectilesRenderer {
  mesh: THREE.InstancedMesh;
  constructor(private game: Game) {
    const shaft = new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4);
    shaft.rotateX(Math.PI / 2);
    const tip = new THREE.ConeGeometry(0.02, 0.06, 4);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.22);
    const fl = new THREE.BoxGeometry(0.04, 0.002, 0.07);
    fl.translate(0, 0, -0.18);
    const geo = new THREE.BufferGeometry();
    const merged = [shaft, tip, fl].map((x) => x.toNonIndexed());
    const pos: number[] = [], nrm: number[] = [];
    for (const m of merged) { pos.push(...(m.getAttribute('position').array as Float32Array)); nrm.push(...(m.getAttribute('normal').array as Float32Array)); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7 });
    patchMaterial(mat, { key: 'arrow' });
    this.mesh = inst(geo, mat, 400, true);
  }
  update() {
    const g = this.game;
    let n = 0;
    const from = new THREE.Vector3(), to = new THREE.Vector3(), pos = new THREE.Vector3(), nxt = new THREE.Vector3();
    for (const p of g.projectiles) {
      if (n >= 400) break;
      const k = p.t / p.dur;
      const arc = (t: number, out: THREE.Vector3) => {
        const d = Math.hypot(p.tx - p.sx, p.tz - p.sz);
        out.set(p.sx + (p.tx - p.sx) * t, p.sy + (p.ty - p.sy) * t + Math.sin(t * Math.PI) * d * 0.18, p.sz + (p.tz - p.sz) * t);
        return out;
      };
      arc(k, pos);
      arc(Math.min(1, k + 0.02), nxt);
      from.copy(pos);
      to.copy(nxt);
      tmpM.lookAt(from, to, UP);
      tmpQ.setFromRotationMatrix(tmpM);
      // lookAt on matrix points -z towards target; arrow geometry points +z
      tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
      tmpM.compose(pos, tmpQ, tmpV.set(1, 1, 1));
      this.mesh.setMatrixAt(n++, tmpM);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ goods piles (at buildings)
export class PilesRenderer {
  group = new THREE.Group();
  private meshes = new Map<Good, THREE.InstancedMesh>();
  constructor(goodGeos: Record<Good, THREE.BufferGeometry>) {
    const mat = vcMat({ roughness: 0.75 }, 'none', 1, { key: 'pile' });
    for (const gd of GOODS) {
      const m = inst(goodGeos[gd], mat, 1500);
      this.meshes.set(gd, m);
      this.group.add(m);
    }
  }
  private counts = new Map<Good, number>();
  begin() {
    this.counts.clear();
  }
  /** Stack n items of good gd around (x, y, z). */
  pile(gd: Good, n: number, x: number, y: number, z: number, ry = 0) {
    const m = this.meshes.get(gd)!;
    let c = this.counts.get(gd) ?? 0;
    const flat = gd === 'board' || gd === 'log' || gd === 'iron' || gd === 'gold';
    for (let k = 0; k < n && c < 1500; k++) {
      let px = x, py = y, pz = z, r = ry;
      if (flat) {
        const layer = Math.floor(k / 2), slot = k % 2;
        const hgt = gd === 'log' ? 0.1 : gd === 'board' ? 0.032 : 0.05;
        const sp = gd === 'log' ? 0.12 : gd === 'board' ? 0.11 : 0.08;
        px += Math.cos(ry) * 0 + Math.sin(ry) * (slot - 0.5) * sp;
        pz += Math.cos(ry) * (slot - 0.5) * sp;
        py += layer * hgt;
        if (layer % 2 === 1 && gd !== 'log') r += 0.1;
      } else {
        const ring = [[0, 0], [0.16, 0.02], [-0.02, 0.15], [0.15, 0.16], [0.07, 0.07], [-0.14, 0.04], [0.04, -0.13], [0.2, -0.1]];
        const [ox, oz] = ring[k % ring.length];
        px += ox; pz += oz;
        py += k >= 4 && (k === 4) ? 0.1 : 0;
        r += k * 1.3;
      }
      tmpQ.setFromAxisAngle(UP, r);
      tmpM.compose(tmpS.set(px, py, pz), tmpQ, tmpV.set(1, 1, 1));
      m.setMatrixAt(c++, tmpM);
    }
    this.counts.set(gd, c);
  }
  end() {
    for (const [gd, m] of this.meshes) {
      m.count = this.counts.get(gd) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

export { buildGoodGeos };
void G;
