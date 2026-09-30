// Instanced donkeys: the pack animals of the trade routes, trotting between markets with a
// pack saddle and up to two goods slung over their flanks.
import * as THREE from 'three';
import { GOODS, Good } from '../game/defs';
import type { Game } from '../game/game';
import type { Settler } from '../game/types';
import { DONKEY_HIPS, DONKEY_KNEE, DONKEY_NECK, buildDonkeyGeos } from './models';
import { patchMaterial } from './shaderPatch';
import { commitInstances } from './instancing';

/** Drawn a little larger than life, like the settlers, so they read at play distance. */
const SCALE = 1.12;

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

export class DonkeysRenderer {
  group = new THREE.Group();
  visibleList: { s: Settler; x: number; y: number; z: number }[] = [];
  private visiblePool: { s: Settler; x: number; y: number; z: number }[] = [];
  private body: THREE.InstancedMesh;
  private necks: THREE.InstancedMesh;
  private uppers: THREE.InstancedMesh;
  private lowers: THREE.InstancedMesh;
  private packs: THREE.InstancedMesh;
  private goods = new Map<Good, THREE.InstancedMesh>();
  private phase = new Map<number, number>();
  private frustum = new THREE.Frustum();
  private projM = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 0.9);
  private base = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private r = new THREE.Matrix4();
  private partRotation = new THREE.Matrix4();
  private goodCounts = new Uint16Array(GOODS.length);
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private game: Game, goodGeos: Record<Good, THREE.BufferGeometry>) {
    const g = buildDonkeyGeos();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    patchMaterial(mat, { key: 'donkey' });
    this.body = inst(g.body, mat, 200);
    this.necks = inst(g.neck, mat, 200);
    this.uppers = inst(g.upper, mat, 800);
    this.lowers = inst(g.lower, mat, 800);
    this.packs = inst(g.pack, mat, 200);
    const goodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    patchMaterial(goodMat, { key: 'donkeygood' });
    for (const gd of GOODS) this.goods.set(gd, inst(goodGeos[gd], goodMat, 200));
    this.group.add(this.body, this.necks, this.uppers, this.lowers, this.packs, ...this.goods.values());
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    const g = this.game;
    const w = g.world;
    this.projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
    this.visibleList.length = 0;
    const counts = this.goodCounts;
    counts.fill(0);
    let nb = 0, nl = 0, np = 0;
    const r2 = this.partRotation;
    for (const s of g.settlers.values()) {
      if (s.job !== 'donkey' || s.hidden) continue;
      if (nb >= 200) break;
      const y0 = w.heightAt(s.x, s.z);
      this.sphere.center.set(s.x, y0 + 0.4, s.z);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      if (!w.explored[w.idx(Math.round(s.x), Math.round(s.z))] && s.owner !== g.local) continue;
      const vi = this.visibleList.length;
      const visible = this.visiblePool[vi] ?? (this.visiblePool[vi] = { s, x: 0, y: 0, z: 0 });
      visible.s = s; visible.x = s.x; visible.y = y0; visible.z = s.z;
      this.visibleList.push(visible);
      const moving = s.next >= 0;
      let ph = this.phase.get(s.id) ?? s.seed * 10;
      if (moving) ph += dt * Math.PI * 2 * 1.15 / Math.max(0.3, s.stepDur);
      this.phase.set(s.id, ph);
      // body: a little rise and fall with each step, slow breathing at rest; on its side when dead
      const bob = moving ? (Math.sin(ph * 2) * 0.5 + 0.5) * 0.012 : 0;
      const breath = moving ? 0 : Math.sin(time * 1.4 + s.seed * 9) * 0.012;
      const sink = s.dead ? Math.max(0, s.deadT - 3) * 0.15 : 0;
      this.q.setFromEuler(this.e.set(0, s.heading, 0));
      this.base.compose(this.v.set(s.x, y0 + bob - sink, s.z), this.q, this.sc.set(SCALE * (1 + breath * 0.3), SCALE * (1 + breath), SCALE));
      if (s.dead) this.base.multiply(this.r.makeTranslation(0.12, 0, 0)).multiply(this.m.makeRotationZ(-Math.PI / 2 * 0.95)).multiply(this.r.makeTranslation(-0.12, 0, 0));
      this.body.setMatrixAt(nb, this.base);
      // the head nods with the walk; waiting, it dips now and then to crop the grass
      const dip = s.dead ? 0.5 : moving ? 0.12 + Math.sin(ph * 2) * 0.05 : Math.max(0, Math.sin(time * 0.5 + s.seed * 7)) * 1.1;
      this.m.copy(this.base).multiply(this.r.makeTranslation(DONKEY_NECK[0], DONKEY_NECK[1], DONKEY_NECK[2])).multiply(r2.makeRotationX(dip));
      this.necks.setMatrixAt(nb++, this.m);
      // sturdy legs in two halves, a quarter stride apart (left fore, right fore, left hind, right hind)
      for (let l = 0; l < 4; l++) {
        const hind = l >= 2;
        const [lx, ly, lz] = DONKEY_HIPS[l];
        let up = hind ? 0.22 : 0, lo = hind ? -0.22 : 0;
        if (s.dead) { up = hind ? 0.4 : -0.3; lo = 0; }
        else if (moving) {
          const p = ph + [Math.PI / 2, Math.PI * 1.5, 0, Math.PI][l];
          up += -Math.sin(p) * 0.38;
          lo += Math.max(0, Math.cos(p)) * (hind ? 0.6 : 0.85);
        }
        this.m.copy(this.base).multiply(this.r.makeTranslation(lx, ly, lz)).multiply(r2.makeRotationX(up));
        this.uppers.setMatrixAt(nl, this.m);
        this.m.multiply(this.r.makeTranslation(0, -DONKEY_KNEE, 0)).multiply(r2.makeRotationX(lo));
        this.lowers.setMatrixAt(nl++, this.m);
      }
      if (s.carrying || s.pack) {
        this.packs.setMatrixAt(np++, this.base);
        for (const [gd, side] of [[s.carrying, -1], [s.pack, 1]] as const) {
          if (!gd) continue;
          const mesh = this.goods.get(gd)!;
          const gi = GOODS.indexOf(gd);
          const k = counts[gi];
          if (k >= 200) continue;
          // loads ride high on either side of the pack saddle
          const long = gd === 'log' || gd === 'board';
          this.m.copy(this.base).multiply(this.r.makeTranslation(side * 0.19, long ? 0.66 : 0.58, 0.02));
          if (long) this.m.multiply(this.r.makeRotationFromEuler(this.e.set(0, Math.PI / 2, side * 0.22)));
          else this.m.multiply(this.r.makeRotationFromEuler(this.e.set(0, side * 1.2, side * 0.25))).multiply(this.r.makeScale(1.15, 1.15, 1.15));
          mesh.setMatrixAt(k, this.m);
          counts[gi] = k + 1;
        }
      }
    }
    for (const m of [this.body, this.necks]) commitInstances(m, nb);
    for (const m of [this.uppers, this.lowers]) commitInstances(m, nl);
    commitInstances(this.packs, np);
    for (let i = 0; i < GOODS.length; i++) commitInstances(this.goods.get(GOODS[i])!, counts[i]);
    if (this.phase.size > 400) for (const id of this.phase.keys()) if (!g.settlers.has(id)) this.phase.delete(id);
  }
}
