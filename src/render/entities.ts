// Instanced renderers for trees, rocks, fields, grass, animals, goods and arrows (settlers live in settlers.ts).
import * as THREE from 'three';
import { GOODS, Good, T_FOREST, T_GRASS, T_MEADOW } from '../game/defs';
import type { Game } from '../game/game';
import { WATER_LEVEL } from '../game/world';
import { hash2 } from '../core/rng';
import { buildDeerGeos, buildGoodGeos, buildGrassTuft, buildRockGeos, buildTreeGeos, buildWheatGeo } from './models';
import { G, patchMaterial, patchedDepthMaterial } from './shaderPatch';
import { leafTexture } from './textures';

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
    const barkMat = vcMat({ roughness: 0.95 }, 'tree', 0.6, { snow: 0.35, key: 'bark' });
    this.leafMat = vcMat({ roughness: 0.8, side: THREE.DoubleSide }, 'tree', 1, {
      key: 'leaf',
      snow: 0.8,
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
      wind: 'tree', key, snow: 0.75,
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
    const mat = vcMat({ roughness: 0.9 }, 'none', 1, { snow: 1, key: 'rock' });
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
    const mat = vcMat({ roughness: 0.9 }, 'grass', 0.25, { snow: 0.6, key: 'wheat' });
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
    const mat = vcMat({ roughness: 0.95 }, 'grass', 0.5, { key: 'tuft', snow: 1 });
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
