// Instanced catapults: the war machines rolling on their wheels, the arm winding back over the
// reload and snapping forward against the stop bar when a stone flies, a pennant in the owner's
// colour, and a tipped-over wreck once smashed.
import * as THREE from 'three';
import { CATAPULT_RELOAD, PLAYER_COLORS } from '../game/defs';
import type { Game } from '../game/game';
import type { Settler } from '../game/types';
import { buildCatapultGeos, CATAPULT_PENNANT } from './models';
import { patchedDepthMaterial, patchMaterial } from './shaderPatch';
import { commitInstances, withInstanceColor } from './instancing';

const SCALE = 1.1;
const MAX = 64;
/** arm angle at rest (wound back) and at the stop bar */
const REST = -1.15, FIRED = 0.5;
const WHEEL_R = 0.15;

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class CatapultsRenderer {
  group = new THREE.Group();
  visibleList: { s: Settler; x: number; y: number; z: number }[] = [];
  private frame: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private stones: THREE.InstancedMesh;
  private flags: THREE.InstancedMesh;
  private roll = new Map<number, number>();
  /** renderer time each machine last let fly, for the wind-back */
  private shot = new Map<number, number>();
  private frustum = new THREE.Frustum();
  private projM = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  private base = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private r = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(private game: Game) {
    const g = buildCatapultGeos();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    patchMaterial(mat, { key: 'catapult' });
    this.frame = inst(g.frame, mat, MAX);
    this.wheels = inst(g.wheel, mat, MAX * 4);
    this.arms = inst(g.arm, mat, MAX);
    this.stones = inst(g.stone, mat, MAX);
    const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    patchMaterial(flagMat, { key: 'catapultflag', wind: 'flag', flag: CATAPULT_PENNANT });
    this.flags = withInstanceColor(inst(g.flag, flagMat, MAX));
    this.flags.customDepthMaterial = patchedDepthMaterial({ key: 'catapultflag', wind: 'flag', flag: CATAPULT_PENNANT });
    this.flags.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.group.add(this.frame, this.wheels, this.arms, this.stones, this.flags);
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    const g = this.game;
    const w = g.world;
    this.projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
    this.visibleList.length = 0;
    let n = 0, nw = 0, ns = 0;
    for (const s of g.settlers.values()) {
      if (s.job !== 'catapult' || s.hidden) continue;
      if (n >= MAX) break;
      // the arm's clock keeps time whether or not the machine is on screen
      if (s.anim === 'shoot' && s.animT < 0.2 && !s.dead) this.shot.set(s.id, time - s.animT);
      const y0 = w.heightAt(s.x, s.z);
      this.sphere.center.set(s.x, y0 + 0.6, s.z);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      if (!w.explored[w.idx(Math.round(s.x), Math.round(s.z))] && s.owner !== g.local) continue;
      this.visibleList.push({ s, x: s.x, y: y0, z: s.z });
      const moving = s.next >= 0 && !s.dead;
      let roll = this.roll.get(s.id) ?? 0;
      if (moving) roll += (dt / Math.max(0.3, s.stepDur)) / WHEEL_R;
      this.roll.set(s.id, roll);
      const sink = s.dead ? Math.max(0, s.deadT - 3) * 0.15 : 0;
      this.q.setFromEuler(this.e.set(0, s.heading, 0));
      this.base.compose(this.v.set(s.x, y0 - sink, s.z), this.q, this.sc.set(SCALE, SCALE, SCALE));
      // a wreck lies on its side, one wheel in the air
      if (s.dead) this.base.multiply(this.r.makeTranslation(0.36, 0.22, 0)).multiply(this.m.makeRotationZ(-1.25)).multiply(this.r.makeTranslation(-0.36, -0.22, 0));
      else if (moving) {
        // a little rocking on the road
        const rock = Math.sin(roll * 0.7) * 0.02;
        this.base.multiply(this.r.makeRotationZ(rock));
      }
      this.frame.setMatrixAt(n, this.base);
      // wheels
      for (const [wx, wz] of [[-0.36, -0.38], [0.36, -0.38], [-0.36, 0.38], [0.36, 0.38]]) {
        this.m.copy(this.base).multiply(this.r.makeTranslation(wx, 0.22, wz)).multiply(new THREE.Matrix4().makeRotationX(roll));
        this.wheels.setMatrixAt(nw++, this.m);
      }
      // arm: snaps forward on the shot, then is wound back over the reload
      let ang = REST;
      const at = this.shot.get(s.id);
      if (at !== undefined) {
        const k = time - at;
        if (k < 0.16) ang = REST + (FIRED - REST) * smooth(0, 0.16, k);
        else if (k < 1.0) ang = FIRED + Math.sin((k - 0.16) * 26) * Math.exp(-(k - 0.16) * 7) * 0.16;
        else ang = FIRED + (REST - FIRED) * smooth(1.0, Math.max(1.5, CATAPULT_RELOAD - 1.2), k);
      }
      this.m.copy(this.base).multiply(this.r.makeTranslation(0, 0.45, 0.12)).multiply(new THREE.Matrix4().makeRotationX(ang));
      this.arms.setMatrixAt(n, this.m);
      // the stone waits in the cup once the arm is back
      const loaded = !s.dead && (at === undefined || time - at > CATAPULT_RELOAD - 1.2);
      if (loaded) this.stones.setMatrixAt(ns++, this.m);
      // pennant in the owner's colour
      this.flags.setMatrixAt(n, this.base);
      this.col.set(PLAYER_COLORS[s.owner] ?? 0xffffff);
      this.flags.setColorAt(n, this.col);
      n++;
    }
    commitInstances(this.frame, n);
    commitInstances(this.arms, n);
    commitInstances(this.flags, n);
    commitInstances(this.wheels, nw);
    commitInstances(this.stones, ns);
    if (this.roll.size > 200) for (const id of this.roll.keys()) if (!g.settlers.has(id)) { this.roll.delete(id); this.shot.delete(id); }
  }
}
