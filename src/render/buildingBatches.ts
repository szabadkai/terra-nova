// Finished buildings drawn in batches: a BatchedMesh per family of materials (buildingFamilies.ts:
// single-sided, double-sided, and those that cast no shadow) holds every piece of every finished
// building, near and far model alike, each with its material's row in the families' table, so the
// town costs three draws a pass instead of one per building, material and pass (about 1,800 draws in
// a 30-minute town, over the view, the shadow map and the water reflection). `families` off: a batch
// per material instead, drawn with the library's own materials (for comparisons). Each building
// keeps its own meshes: picking still hits them, and they come back when the building burns. An
// instance shows exactly when the level group it stands for (the near or far model) and the building
// are shown, so the view's level of detail, the shadow map's far models (withFar) and the reflection's
// coarsest level carry over as they are. Moving parts, flags (their cloth bends in the vertex shader)
// and sites stay on their own.
import * as THREE from 'three';
import { ScreenLod } from './lod';
import { getMaterial } from './materials';
import { ownDepth } from './instancing';
import { familyMaterial, getAtlas } from './buildingFamilies';

/** the material rows of a piece's vertices, as a family batch takes them (one array, refilled for each piece) */
let rowScratch = new Float32Array(1 << 16);

interface Slot {
  /** the model the instance is a piece of (a ScreenLod level, or the building itself) */
  level: THREE.Object3D;
  /** the building's group */
  root: THREE.Object3D;
}

/** The parts of three's BatchedMesh (r186) the draw list below fills in itself. */
interface Internals {
  _instanceInfo: { active: boolean; geometryIndex: number }[];
  _geometryInfo: { start: number; count: number }[];
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _multiDrawBytesPerElement: number;
  _indirectTexture: THREE.DataTexture;
  _maxVertexCount: number;
}

const _m = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

class Batch extends THREE.BatchedMesh {
  private slots: (Slot | null)[] = [];
  /** each instance's bounds in the world (x, y, z, r): buildings stand still */
  private bounds = new Float32Array(64 * 4);
  /** where a geometry sits in the batch, by material row (-1 in a batch of one material) */
  private geoIds = new Map<THREE.BufferGeometry, Map<number, number>>();
  private identity = false;

  constructor(material: THREE.Material, castShadow: boolean) {
    super(64, 1 << 15, 0, material);
    this.castShadow = castShadow;
    this.receiveShadow = true;
    ownDepth(this);
    // culled per instance below (three's check of the whole batch would need its bounds kept up to date)
    this.frustumCulled = false;
  }

  private get t() {
    return this as unknown as Internals;
  }

  /** Add an instance of `geo`, drawn with material row `row` of a family's table (-1: the batch's own material). */
  put(geo: THREE.BufferGeometry, slot: Slot, matrix: THREE.Matrix4, row = -1): number {
    let ids = this.geoIds.get(geo);
    if (!ids) this.geoIds.set(geo, (ids = new Map()));
    let gid = ids.get(row);
    if (gid === undefined) {
      const n = geo.getAttribute('position').count;
      const max = this.t._maxVertexCount;
      if (n > this.unusedVertexCount) this.setGeometrySize(Math.max(max * 2, max + n), 0);
      let src = geo;
      if (row >= 0) {
        // the piece with its material's row on every vertex (the batch copies it in)
        if (rowScratch.length < n) rowScratch = new Float32Array(Math.max(n, rowScratch.length * 2));
        const rows = rowScratch.subarray(0, n).fill(row);
        src = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv']) src.setAttribute(k, geo.getAttribute(k));
        src.setAttribute('aMat', new THREE.BufferAttribute(rows, 1));
      }
      gid = this.addGeometry(src);
      ids.set(row, gid);
    }
    if (this.instanceCount >= this.maxInstanceCount) {
      this.setInstanceCount(this.maxInstanceCount * 2);
      const b = new Float32Array(this.maxInstanceCount * 4);
      b.set(this.bounds);
      this.bounds = b;
      this.identity = false;
    }
    const id = this.addInstance(gid);
    this.slots[id] = slot;
    this.place(id, matrix);
    this.visible = true;
    return id;
  }

  place(id: number, matrix: THREE.Matrix4) {
    this.setMatrixAt(id, matrix);
    const bs = this.getBoundingSphereAt(this.t._instanceInfo[id].geometryIndex, _sphere);
    if (bs) bs.applyMatrix4(matrix);
    else _sphere.set(_sphere.center.setFromMatrixPosition(matrix), 1e4);
    this.bounds.set([_sphere.center.x, _sphere.center.y, _sphere.center.z, _sphere.radius], id * 4);
  }

  take(id: number) {
    this.deleteInstance(id);
    this.slots[id] = null;
    // an empty batch would still cost its draw calls
    this.visible = this.instanceCount > 0;
  }

  /**
   * The draw list for the pass about to draw. Draw i is always instance i, so the index texture that
   * maps one to the other never changes: three rewrites it before every draw, and on ANGLE/Metal an
   * upload in the middle of the frame cost more GPU time than the batching saved. An instance whose
   * model is hidden in this pass (the other level, a building out of view or left out of the
   * reflection) or that lies outside the camera's frustum gets an empty draw, which is skipped.
   */
  private drawList(camera: THREE.Camera, geometry: THREE.BufferGeometry) {
    const t = this.t;
    if (!this.identity) {
      const d = t._indirectTexture.image.data as Uint32Array;
      for (let i = 0; i < d.length; i++) d[i] = i;
      t._indirectTexture.needsUpdate = true;
      this.identity = true;
    }
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    _frustum.setFromProjectionMatrix(_m, camera.coordinateSystem, camera.reversedDepth);
    const index = geometry.getIndex();
    const bpe = index ? index.array.BYTES_PER_ELEMENT : 1;
    const info = t._instanceInfo, geos = t._geometryInfo, starts = t._multiDrawStarts, counts = t._multiDrawCounts;
    const slots = this.slots, bounds = this.bounds;
    let n = 0;
    for (let i = 0; i < info.length; i++) {
      const s = slots[i];
      let c = 0;
      if (s && info[i].active && s.level.visible && s.root.visible) {
        _sphere.center.set(bounds[i * 4], bounds[i * 4 + 1], bounds[i * 4 + 2]);
        _sphere.radius = bounds[i * 4 + 3];
        if (_frustum.intersectsSphere(_sphere)) {
          const g = geos[info[i].geometryIndex];
          starts[i] = g.start * bpe;
          c = g.count;
        }
      }
      counts[i] = c;
      if (c) n = i + 1;
    }
    t._multiDrawCount = n;
    t._multiDrawBytesPerElement = bpe;
  }

  override onBeforeRender(_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera, geometry: THREE.BufferGeometry) {
    this.drawList(camera, geometry);
  }

  override onBeforeShadow(_r: THREE.WebGLRenderer, _s: THREE.Scene, _c: THREE.Camera, shadowCamera: THREE.Camera, geometry: THREE.BufferGeometry) {
    this.drawList(shadowCamera, geometry);
  }
}

/** A building's pieces in the batches. */
export interface Batched {
  items: { batch: Batch; id: number; mesh: THREE.Mesh; /** the level group the mesh came out of, to go back into */ parent: THREE.Object3D }[];
  /** the building's transform they were placed with */
  matrix: THREE.Matrix4;
}

export class BuildingBatches {
  /** the batches; add it to the scene (not under the buildings, which are raycast for picking) */
  readonly group = new THREE.Group();
  private batches = new Map<string, Batch>();
  /** off: a batch per material (for comparisons); takes effect for buildings batched from then on */
  families = true;

  constructor() {
    this.group.name = 'building batches';
  }

  /**
   * Move a building's static pieces into the batches. Its own meshes leave the scene graph meanwhile
   * (`remove` puts them back): hidden, they would still be walked by every pass and by the matrix
   * update, and a town has thousands of them.
   */
  add(root: THREE.Object3D, lod: ScreenLod | null): Batched {
    root.updateMatrix();
    const out: Batched = { items: [], matrix: root.matrix.clone() };
    const levels = lod ? lod.levels.map((l) => l.object) : [root];
    for (const level of levels) {
      for (const c of [...level.children]) {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh || !mesh.userData.matKey || !mesh.visible) continue;
        const mat = mesh.material as THREE.Material;
        if ((mat.userData.wind && mat.userData.wind !== 'none') || mat.userData.clip) continue;
        const matKey = mesh.userData.matKey as string;
        const fam = this.families ? getAtlas().rowOf(matKey) : null;
        const key = fam ? `family|${fam.double ? 2 : 1}|${mesh.castShadow ? 1 : 0}` : `${mat.uuid}|${mesh.castShadow ? 1 : 0}`;
        let batch = this.batches.get(key);
        if (!batch) {
          // (a family's material, or the library's twin for batches: the building's own meshes that
          // stay out, its moving parts, use the plain one)
          batch = new Batch(fam ? familyMaterial(fam.double) : getMaterial(matKey, 'batch'), mesh.castShadow);
          batch.name = fam ? key : `${matKey}|${mesh.castShadow ? 1 : 0}`;
          this.batches.set(key, batch);
          this.group.add(batch);
        }
        out.items.push({ batch, id: batch.put(mesh.geometry, { level, root }, out.matrix, fam ? fam.row : -1), mesh, parent: level });
        level.remove(mesh);
      }
    }
    return out;
  }

  /** Give the building its own meshes back. */
  remove(b: Batched) {
    for (const it of b.items) {
      it.batch.take(it.id);
      it.parent.add(it.mesh);
      // (its matrix is composed once and kept, buildings.ts freeze: the world one is worked out
      // again in case the building moved while it was batched)
      it.mesh.matrixWorldNeedsUpdate = true;
    }
    b.items.length = 0;
  }

  /**
   * Follow the building when its transform changes (the ground under it levelled). The root's matrix
   * must be up to date (the buildings renderer composes it whenever it moves one): composing it here
   * every frame would mark the whole building's world matrices for recomputing every frame.
   */
  move(root: THREE.Object3D, b: Batched) {
    if (root.matrixAutoUpdate) root.updateMatrix();
    if (root.matrix.equals(b.matrix)) return;
    b.matrix.copy(root.matrix);
    for (const it of b.items) it.batch.place(it.id, b.matrix);
  }

  dispose() {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.group.clear();
  }
}
