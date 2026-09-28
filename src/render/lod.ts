// Levels of detail. Models are simplified once at load with meshoptimizer (shipped with three),
// and every frame each instance takes the coarsest level whose geometric error stays under about
// a pixel on screen. The shadow map and the water reflection draw the coarse level of everything:
// neither can show the difference. Instances are also culled against the view and the shadow
// camera here, since the big instanced meshes cover the whole map and three cannot cull them.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { uploadFirst } from './instancing';

/** Resolves once the simplifier's WebAssembly is compiled; await it before building models. */
export const lodReady: Promise<void> = MeshoptSimplifier.ready;

/** Largest geometric error allowed on screen, in pixels. */
export const LOD_PIXELS = 1;

// ------------------------------------------------------------------ simplification
/**
 * Weld a triangle soup by position. Corners whose normals differ by more than the crease angle stay
 * apart, so hard edges survive; within a weld normals and colours are averaged and anything else
 * (uvs, tint flags) is taken from the first corner.
 */
function weld(src: THREE.BufferGeometry, crease: number): { geo: THREE.BufferGeometry; index: Uint32Array; pos: Float32Array } {
  const g = src.index ? src.toNonIndexed() : src;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const n = p.count;
  const remap = new Uint32Array(n);
  const first: number[] = [];
  const seen = new Map<string, number[]>();
  const q = (v: number) => Math.round(v * 2e4);
  const cosC = Math.cos(crease);
  for (let i = 0; i < n; i++) {
    const key = `${q(p.getX(i))},${q(p.getY(i))},${q(p.getZ(i))}`;
    let list = seen.get(key);
    if (!list) { list = []; seen.set(key, list); }
    let j = -1;
    for (const c of list) {
      const f = first[c];
      if (!nrm || nrm.getX(i) * nrm.getX(f) + nrm.getY(i) * nrm.getY(f) + nrm.getZ(i) * nrm.getZ(f) >= cosC) { j = c; break; }
    }
    if (j < 0) { j = first.length; first.push(i); list.push(j); }
    remap[i] = j;
  }
  const u = first.length;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    const k = attr.itemSize;
    const a = new Float32Array(u * k);
    if (name === 'normal' || name === 'color') {
      const cnt = new Float32Array(u);
      for (let i = 0; i < n; i++) {
        const j = remap[i];
        for (let c = 0; c < k; c++) a[j * k + c] += attr.getComponent(i, c);
        cnt[j]++;
      }
      for (let j = 0; j < u; j++) {
        if (name === 'normal') {
          const l = Math.hypot(a[j * 3], a[j * 3 + 1], a[j * 3 + 2]) || 1;
          a[j * 3] /= l; a[j * 3 + 1] /= l; a[j * 3 + 2] /= l;
        } else for (let c = 0; c < k; c++) a[j * k + c] /= cnt[j];
      }
    } else {
      for (let j = 0; j < u; j++) for (let c = 0; c < k; c++) a[j * k + c] = attr.getComponent(first[j], c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(a, k));
  }
  out.setIndex(new THREE.BufferAttribute(remap, 1));
  return { geo: out, index: remap, pos: out.getAttribute('position').array as Float32Array };
}

export interface Simplified {
  geo: THREE.BufferGeometry;
  /** geometric error in model units */
  error: number;
  tris: number;
}

/**
 * A coarser copy of geo with about `ratio` of its triangles, stopping early where the error would
 * pass `maxError` (model units). Sloppy mode also merges separate parts, for the far distance.
 * Edges sharper than `crease` (radians) stay hard.
 */
export function simplify(geo: THREE.BufferGeometry, ratio: number, maxError = 1, sloppy = false, crease = Math.PI / 3): Simplified {
  const w = weld(geo, crease);
  const target = Math.max(3, Math.floor((w.index.length * ratio) / 3) * 3);
  const scale = MeshoptSimplifier.getScale(w.pos, 3) || 1;
  const [idx, err] = sloppy
    ? MeshoptSimplifier.simplifySloppy(w.index, w.pos, 3, null, target, maxError / scale)
    : MeshoptSimplifier.simplify(w.index, w.pos, 3, target, maxError / scale, ['Prune']);
  w.geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return { geo: w.geo, error: err * scale, tris: idx.length / 3 };
}

export const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

// ------------------------------------------------------------------ the view
/** Set while the water reflection renders, so instanced LODs can switch to their coarse level. */
export const lodPass = { reflect: false };

/** What the frame's cameras see: main view frustum, shadow frustum and the pixel scale. */
export class LodView {
  /** pixels per world unit at distance 1 */
  K = 1000;
  /** off: everything at full detail, nothing culled (for comparisons) */
  enabled = true;
  readonly eye = new THREE.Vector3();
  readonly frustum = new THREE.Frustum();
  readonly shadow = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private s = new THREE.Sphere();

  update(camera: THREE.PerspectiveCamera, heightPx: number, sun: THREE.DirectionalLight | null) {
    camera.updateMatrixWorld();
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.K = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (sun && sun.castShadow) {
      sun.updateMatrixWorld();
      sun.target.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      this.shadow.copy(sun.shadow.getFrustum());
    } else this.shadow.planes.forEach((p) => p.set(new THREE.Vector3(0, 1, 0), -1e9));
  }

  /** Pixels per world unit at a point. */
  px(x: number, y: number, z: number) {
    if (!this.enabled) return 1e9;
    const d = Math.hypot(x - this.eye.x, y - this.eye.y, z - this.eye.z);
    return this.K / Math.max(0.5, d);
  }

  /** 2 in view, 1 only casting a shadow into it, 0 neither. */
  cull(x: number, y: number, z: number, r: number): 0 | 1 | 2 {
    if (!this.enabled) return 2;
    this.s.center.set(x, y, z);
    this.s.radius = r;
    if (this.frustum.intersectsSphere(this.s)) return 2;
    return this.shadow.intersectsSphere(this.s) ? 1 : 0;
  }
}

/** The frame's view, updated by the renderer before any instanced renderer runs. */
export const lodView = new LodView();

// ------------------------------------------------------------------ instanced pairs
export interface PairOpts {
  /** per-instance colour slots: 0 none, 1 instanceColor, 2 also the geometry attribute instanceColor2 */
  colors?: 0 | 1 | 2;
  castShadow?: boolean;
  receiveShadow?: boolean;
  depth?: THREE.Material;
}

/**
 * One instanced part at two levels. The near mesh holds the instances close enough to need
 * detail; the far mesh holds the rest, followed by copies of the near ones and then instances that
 * are only there for their shadow. Its instance count changes by pass: far ones in the view,
 * everything seen in the reflection, everything in the shadow map.
 * Pass the near geometry as the far one for a part that is not worth simplifying (one mesh drawn at
 * every distance), or null for a part too small to see from afar (it then only casts its shadow).
 */
export class LodPair {
  readonly near: THREE.InstancedMesh;
  readonly far: THREE.InstancedMesh | null;
  private single: boolean;
  // instances written this frame
  private wNear = 0;
  private wFar = 0;
  private wShadow = 0;
  // and what the passes draw, fixed when the frame's writing is finished
  private nNear = 0;
  private nFar = 0;
  private nShadow = 0;
  private shadowM: Float32Array;
  private shadowC: Float32Array | null;
  private shadowC2: Float32Array | null;
  private nearC2: THREE.InstancedBufferAttribute | null = null;
  private farC2: THREE.InstancedBufferAttribute | null = null;

  constructor(nearGeo: THREE.BufferGeometry, farGeo: THREE.BufferGeometry | null, mat: THREE.Material, readonly cap: number, o: PairOpts = {}) {
    const colors = o.colors ?? 0;
    this.single = farGeo === nearGeo;
    const hasFar = !!farGeo && !this.single;
    const mk = (geo: THREE.BufferGeometry, far: boolean) => {
      // the far mesh (or a lone near one) also carries the near copies and the shadow-only instances
      const slots = far || !hasFar ? cap * 2 : cap;
      if (colors === 2) {
        geo = geo.clone();
        const c2 = new THREE.InstancedBufferAttribute(new Float32Array(slots * 3), 3);
        c2.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('instanceColor2', c2);
        if (far) this.farC2 = c2; else this.nearC2 = c2;
      }
      const m = new THREE.InstancedMesh(geo, mat, slots);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (colors >= 1) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(slots * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.receiveShadow = o.receiveShadow ?? true;
      if (o.depth) m.customDepthMaterial = o.depth;
      return m;
    };
    this.near = mk(nearGeo, false);
    this.far = hasFar ? mk(farGeo!, true) : null;
    // detail never goes into the shadow map when a far level can stand in for it
    this.near.castShadow = this.far ? false : o.castShadow ?? true;
    if (this.far) this.far.castShadow = o.castShadow ?? true;
    this.shadowM = new Float32Array(cap * 16);
    this.shadowC = colors >= 1 ? new Float32Array(cap * 3) : null;
    this.shadowC2 = colors === 2 ? new Float32Array(cap * 3) : null;
    this.hookPasses();
  }

  get meshes(): THREE.InstancedMesh[] {
    return this.far ? [this.near, this.far] : [this.near];
  }

  private hookPasses() {
    const near = this.near, far = this.far;
    if (far) {
      near.onBeforeRender = () => { if (lodPass.reflect) near.count = 0; };
      near.onAfterRender = () => { near.count = this.nNear; };
      far.onBeforeRender = () => { if (lodPass.reflect) far.count = this.nFar + this.nNear; };
      far.onAfterRender = () => { far.count = this.nFar; };
      far.onBeforeShadow = () => { far.count = this.nFar + this.nNear + this.nShadow; };
      far.onAfterShadow = () => { far.count = this.nFar; };
    } else {
      near.onBeforeShadow = () => { near.count = this.nNear + this.nShadow; };
      near.onAfterShadow = () => { near.count = this.nNear; };
    }
  }

  /** Add an instance: level 0 near, 1 far, -1 only for its shadow. */
  add(level: 0 | 1 | -1, m: THREE.Matrix4, c1?: THREE.Color, c2?: THREE.Color) {
    this.addArray(level, m.elements, 0, c1, c2);
  }

  /** Same, with the matrix as 16 floats at `off` in an array. */
  addArray(level: 0 | 1 | -1, e: ArrayLike<number>, off: number, c1?: THREE.Color, c2?: THREE.Color) {
    if (level === 1 && !this.far) level = this.single ? 0 : -1;
    if (level === -1) {
      if (this.wShadow >= this.cap) return;
      const s = this.wShadow++;
      for (let k = 0; k < 16; k++) this.shadowM[s * 16 + k] = e[off + k];
      if (c1 && this.shadowC) { this.shadowC[s * 3] = c1.r; this.shadowC[s * 3 + 1] = c1.g; this.shadowC[s * 3 + 2] = c1.b; }
      if (c2 && this.shadowC2) { this.shadowC2[s * 3] = c2.r; this.shadowC2[s * 3 + 1] = c2.g; this.shadowC2[s * 3 + 2] = c2.b; }
      return;
    }
    const isFar = level === 1;
    if (this.wNear + this.wFar >= this.cap) return;
    const mesh = isFar ? this.far! : this.near;
    const i = isFar ? this.wFar++ : this.wNear++;
    const a = mesh.instanceMatrix.array as Float32Array;
    for (let k = 0; k < 16; k++) a[i * 16 + k] = e[off + k];
    if (c1 && mesh.instanceColor) mesh.instanceColor.setXYZ(i, c1.r, c1.g, c1.b);
    const c2a = isFar ? this.farC2 : this.nearC2;
    if (c2 && c2a) c2a.setXYZ(i, c2.r, c2.g, c2.b);
  }

  /** Lay out the buffers for this frame's passes and upload what was written. */
  finish() {
    const near = this.near, far = this.far;
    const nN = this.wNear, nF = this.wFar, nS = this.wShadow;
    this.nNear = nN; this.nFar = nF; this.nShadow = nS;
    this.wNear = this.wFar = this.wShadow = 0;
    // the mesh that also draws the rest: after its own instances come near copies (far level only) and shadow-only ones
    const host = far ?? near;
    const own = far ? nF : nN;
    const ma = host.instanceMatrix.array as Float32Array;
    const ca = host.instanceColor?.array as Float32Array | undefined;
    const c2 = far ? this.farC2 : this.nearC2;
    let at = own;
    if (far) {
      ma.set((near.instanceMatrix.array as Float32Array).subarray(0, nN * 16), at * 16);
      if (ca && near.instanceColor) ca.set((near.instanceColor.array as Float32Array).subarray(0, nN * 3), at * 3);
      if (c2 && this.nearC2) (c2.array as Float32Array).set((this.nearC2.array as Float32Array).subarray(0, nN * 3), at * 3);
      at += nN;
    }
    ma.set(this.shadowM.subarray(0, nS * 16), at * 16);
    if (ca && this.shadowC) ca.set(this.shadowC.subarray(0, nS * 3), at * 3);
    if (c2 && this.shadowC2) (c2.array as Float32Array).set(this.shadowC2.subarray(0, nS * 3), at * 3);
    at += nS;
    host.count = own;
    host.visible = at > 0;
    uploadFirst(host.instanceMatrix, at);
    uploadFirst(host.instanceColor, at);
    uploadFirst(c2, at);
    if (far) {
      near.count = nN;
      near.visible = nN > 0;
      uploadFirst(near.instanceMatrix, nN);
      uploadFirst(near.instanceColor, nN);
      uploadFirst(this.nearC2, nN);
    }
  }
}
