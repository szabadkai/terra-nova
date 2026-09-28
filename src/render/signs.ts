// Geologists' signs: a stake with a painted board and samples of what lies beneath —
// one to three lumps for a poor, fair or rich vein; a bare board with a cross for nothing.
import * as THREE from 'three';
import type { Game } from '../game/game';
import { signLife } from '../game/geology';
import { patchMaterial } from './shaderPatch';
import { commitInstances, withInstanceColor } from './instancing';

const ORE_COL = [0xf2eee6, 0x1e1e22, 0xa0522d, 0xf0c040, 0x9a968e];
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const BOARD_Y = 0.64;

function mat(params: THREE.MeshStandardMaterialParameters, key: string) {
  const m = new THREE.MeshStandardMaterial(params);
  patchMaterial(m, { key, snow: 0.5 });
  return m;
}

function inst(geo: THREE.BufferGeometry, m: THREE.Material, n: number) {
  const im = new THREE.InstancedMesh(geo, m, n);
  im.count = 0;
  im.castShadow = true;
  im.receiveShadow = true;
  im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return im;
}

function mergePost(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  const A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b;
  for (const k of ['position', 'normal'] as const) {
    const x = A.getAttribute(k).array as Float32Array, y = B.getAttribute(k).array as Float32Array;
    const m = new Float32Array(x.length + y.length);
    m.set(x);
    m.set(y, x.length);
    out.setAttribute(k, new THREE.BufferAttribute(m, 3));
  }
  return out;
}

export class SignsRenderer {
  group = new THREE.Group();
  private posts: THREE.InstancedMesh;
  private boards: THREE.InstancedMesh;
  private lumps: THREE.InstancedMesh;
  private gold: THREE.InstancedMesh;
  private crosses: THREE.InstancedMesh;
  private flags: THREE.InstancedMesh;
  private born = new Map<number, number>();

  constructor(private game: Game) {
    const post = new THREE.CylinderGeometry(0.022, 0.03, 0.72, 6);
    post.translate(0, 0.36, 0);
    const board = new THREE.BoxGeometry(0.31, 0.2, 0.028);
    board.translate(0, BOARD_Y, 0.03);
    const lump = new THREE.DodecahedronGeometry(0.052, 0);
    const cross = new THREE.BoxGeometry(0.21, 0.03, 0.014);
    // a little pennant atop the stake, dyed like the find, readable from afar
    const flag = new THREE.BufferGeometry();
    flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.86, 0, 0, 0.74, 0, 0.17, 0.8, 0], 3));
    flag.computeVertexNormals();
    this.posts = inst(post, mat({ color: 0x7a5a38, roughness: 0.9 }, 'signpost'), 400);
    this.boards = inst(board, mat({ color: 0xd2b88c, roughness: 0.85 }, 'signboard'), 400);
    this.flags = withInstanceColor(inst(flag, mat({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }, 'signflag'), 400));
    const pole = new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4);
    pole.translate(0, 0.78, 0);
    this.posts.geometry = mergePost(post, pole);
    this.lumps = withInstanceColor(inst(lump, mat({ color: 0xffffff, roughness: 0.55 }, 'signlump'), 1200));
    this.gold = inst(lump, mat({ color: 0xf0c040, roughness: 0.25, metalness: 1, emissive: new THREE.Color(0.35, 0.22, 0.02) }, 'signgold'), 1200);
    this.crosses = inst(cross, mat({ color: 0x8a1c14, roughness: 0.7 }, 'signx'), 800);
    this.group.add(this.posts, this.boards, this.lumps, this.gold, this.crosses, this.flags);
  }

  update(time: number) {
    const g = this.game;
    const w = g.world;
    let np = 0, nl = 0, ng = 0, nx = 0;
    for (const sg of g.signs.values()) {
      if (sg.owner !== g.local || np >= 400) continue;
      if (!w.explored[sg.node]) continue;
      let b = this.born.get(sg.id);
      if (b === undefined) { b = time; this.born.set(sg.id, b); }
      // hammered in with a little bounce, sinking again as the sign weathers away
      const k = Math.min(1, (time - b) / 0.35);
      const pop = k < 1 ? Math.sin(k * Math.PI * 0.5) * (1 + Math.sin(k * Math.PI) * 0.25) : 1;
      const age = g.time - sg.t;
      const sink = Math.max(0, (age - (signLife - 25)) / 25);
      const x = w.nx(sg.node) + ((sg.node * 7919) % 17) / 17 * 0.3 - 0.15, z = w.ny(sg.node) + ((sg.node * 104729) % 13) / 13 * 0.3 - 0.15;
      const y = w.heightAt(x, z) - 0.05 - sink * 0.5;
      const ry = ((sg.node * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
      tmpQ.setFromAxisAngle(UP, ry);
      // lean a touch downhill, like a stake knocked into scree
      tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.08));
      tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(pop, pop, pop));
      this.posts.setMatrixAt(np, tmpM);
      this.boards.setMatrixAt(np, tmpM);
      this.flags.setMatrixAt(np, tmpM);
      this.flags.setColorAt(np, tmpC.set(sg.ore ? ORE_COL[sg.ore] : 0xc8342a));
      np++;
      if (sg.ore === 0) {
        for (const a of [0.7, -0.7]) {
          const m = tmpM.clone().multiply(new THREE.Matrix4().makeTranslation(0, BOARD_Y, 0.05)).multiply(new THREE.Matrix4().makeRotationZ(a));
          this.crosses.setMatrixAt(nx++, m);
        }
        continue;
      }
      const lumps = sg.amt >= 80 ? 3 : sg.amt >= 30 ? 2 : 1;
      for (let j = 0; j < lumps; j++) {
        const m = tmpM.clone().multiply(new THREE.Matrix4().makeTranslation((j - (lumps - 1) / 2) * 0.088, BOARD_Y, 0.07));
        m.multiply(new THREE.Matrix4().makeRotationY(j * 1.9));
        if (sg.ore === 3) this.gold.setMatrixAt(ng++, m);
        else { this.lumps.setMatrixAt(nl, m); this.lumps.setColorAt(nl, tmpC.set(ORE_COL[sg.ore])); nl++; }
      }
    }
    for (const [mesh, n] of [[this.posts, np], [this.boards, np], [this.flags, np], [this.lumps, nl], [this.gold, ng], [this.crosses, nx]] as const) commitInstances(mesh, n);
    if (this.born.size > g.signs.size + 100) for (const id of this.born.keys()) if (!g.signs.has(id)) this.born.delete(id);
  }
}
