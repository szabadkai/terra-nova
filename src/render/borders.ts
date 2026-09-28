// Border posts along territory edges (a nod to the original's boundary stones),
// with a player-coloured cap that glows softly at night.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../game/game';
import { hash2 } from '../core/rng';
import { BANNER_COLORS } from './materials';
import { patchMaterial } from './shaderPatch';
import { uploadFirst } from './instancing';

export class BordersRenderer {
  posts: THREE.InstancedMesh;
  caps: THREE.InstancedMesh;
  private version = -1;

  constructor(private game: Game) {
    const stone = new THREE.CylinderGeometry(0.06, 0.085, 0.34, 6);
    stone.translate(0, 0.14, 0);
    const base = new THREE.CylinderGeometry(0.1, 0.11, 0.05, 6);
    base.translate(0, 0.0, 0);
    const postGeo = mergeGeometries([stone.toNonIndexed(), base.toNonIndexed()].map((g) => { g.deleteAttribute('uv'); return g; }))!;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.85 });
    patchMaterial(postMat, { key: 'borderpost', snow: 1 });
    this.posts = new THREE.InstancedMesh(postGeo, postMat, 6000);
    this.posts.castShadow = true;
    this.posts.receiveShadow = true;
    this.posts.frustumCulled = false;
    this.posts.count = 0;
    const cap = new THREE.IcosahedronGeometry(0.075, 1);
    cap.translate(0, 0.34, 0);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.25 });
    patchMaterial(capMat, {
      key: 'bordercap',
      fragEmissive: 'totalEmissiveRadiance = diffuseColor.rgb * (0.15 + uNight * 1.6);',
    });
    this.caps = new THREE.InstancedMesh(cap, capMat, 6000);
    this.caps.castShadow = false;
    this.caps.frustumCulled = false;
    this.caps.count = 0;
  }

  update(force = false) {
    const g = this.game;
    const w = g.world;
    // owner texture updates set ownerDirty, the terrain consumes it; we track our own version
    const ver = g.ownerVersion;
    if (!force && ver === this.version) return;
    this.version = ver;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    for (let y = 1; y < w.H - 1; y++) {
      for (let x = 1; x < w.W - 1; x++) {
        const i = y * w.W + x;
        const o = w.owner[i];
        if (o < 0) continue;
        if (((x * 7 + y * 13) % 3) !== 0) continue; // spacing
        const edge = w.owner[i - 1] !== o || w.owner[i + 1] !== o || w.owner[i - w.W] !== o || w.owner[i + w.W] !== o;
        if (!edge || w.isWater(i) || w.building[i] || w.stone[i] || w.reserve[i]) continue;
        if (n >= 6000) break;
        const jx = (hash2(x, y, 3) - 0.5) * 0.3, jz = (hash2(x, y, 4) - 0.5) * 0.3;
        p.set(x + jx, w.heightAt(x + jx, y + jz) - 0.03, y + jz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(x, y, 5) * 6.28);
        const sc = 0.85 + hash2(x, y, 6) * 0.3;
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        this.posts.setMatrixAt(n, m);
        this.caps.setMatrixAt(n, m);
        col.set(BANNER_COLORS[o] ?? 0xffffff);
        this.caps.setColorAt(n, col);
        n++;
      }
    }
    // (visibility belongs to the borders setting)
    this.posts.count = this.caps.count = n;
    uploadFirst(this.posts.instanceMatrix, n);
    uploadFirst(this.caps.instanceMatrix, n);
    uploadFirst(this.caps.instanceColor, n);
  }
}
