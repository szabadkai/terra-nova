// Planar reflection for the water surface (mirrored camera + oblique near plane). Only the part of
// the texture that the water in view can sample is drawn: the mirrored frustum is narrowed to that
// rectangle, so the pixels and the objects outside it cost nothing (a lake in a corner of the view
// no longer re-renders the whole town upside down).
import * as THREE from 'three';
import type { World } from '../game/world';
import { lodPass } from './lod';

/** size of a water cell, in nodes */
const CELL = 4;
/** the sea runs this far past the map edge (the water plane's margin) */
const SEA = 260;

/** Where on the map water can show: cells of CELL x CELL nodes with a water node in or beside them. */
export class WaterCells {
  private readonly cw: number;
  private readonly ch: number;
  private readonly mask: Uint8Array;
  private box = new THREE.Box3();
  private v = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private rebuildT = 0;

  constructor(private world: World, private level: number) {
    this.cw = Math.ceil(world.W / CELL);
    this.ch = Math.ceil(world.H / CELL);
    this.mask = new Uint8Array(this.cw * this.ch);
    this.rebuild();
  }

  private rebuild() {
    const w = this.world;
    this.mask.fill(0);
    for (let z = 0; z < w.H; z++)
      for (let x = 0; x < w.W; x++) {
        if (!w.isWater(z * w.W + x)) continue;
        // the ground between this node and its neighbours can be under water too
        const x0 = Math.max(0, Math.floor((x - 1) / CELL)), x1 = Math.min(this.cw - 1, Math.floor((x + 1) / CELL));
        const z0 = Math.max(0, Math.floor((z - 1) / CELL)), z1 = Math.min(this.ch - 1, Math.floor((z + 1) / CELL));
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) this.mask[cz * this.cw + cx] = 1;
      }
  }

  private water(cx: number, cz: number) {
    if (cx < 0 || cz < 0 || cx >= this.cw || cz >= this.ch) return true; // the sea round the map
    return this.mask[cz * this.cw + cx] === 1;
  }

  /**
   * The rectangle of the reflection texture (uv x0, y0, x1, y1) that the water in view projects to
   * through `texMat`, or false when no water is in view. `dt` paces the rebuild of the mask, which
   * follows the ground as it is levelled.
   */
  rect(camera: THREE.PerspectiveCamera, frustum: THREE.Frustum, texMat: THREE.Matrix4, dt: number, out: THREE.Vector4): boolean {
    this.rebuildT -= dt;
    if (this.rebuildT <= 0) {
      this.rebuildT = 3;
      this.rebuild();
    }
    // the view's footprint on the water plane
    const L = this.level, v = this.v;
    const far = camera.far;
    let fx0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fz1 = -Infinity;
    const eye = this.eye.setFromMatrixPosition(camera.matrixWorld);
    for (let k = 0; k < 4; k++) {
      v.set(k & 1 ? 1 : -1, k & 2 ? 1 : -1, 0.5).unproject(camera).sub(eye).normalize();
      const t = v.y < -1e-3 ? Math.min(far, (L - eye.y) / v.y) : far;
      const x = eye.x + v.x * t, z = eye.z + v.z * t;
      fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x);
      fz0 = Math.min(fz0, z); fz1 = Math.max(fz1, z);
    }
    const W = this.world.W, H = this.world.H;
    const cx0 = Math.floor(Math.max(-SEA, fx0) / CELL), cx1 = Math.floor(Math.min(W + SEA, fx1) / CELL);
    const cz0 = Math.floor(Math.max(-SEA, fz0) / CELL), cz1 = Math.floor(Math.min(H + SEA, fz1) / CELL);
    const e = texMat.elements;
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    const box = this.box;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.water(cx, cz)) continue;
        const x = cx * CELL, z = cz * CELL;
        box.min.set(x, L - 0.05, z);
        box.max.set(x + CELL, L + 0.05, z + CELL);
        if (!frustum.intersectsBox(box)) continue;
        for (let c = 0; c < 4; c++) {
          const px = c & 1 ? x + CELL : x, pz = c & 2 ? z + CELL : z;
          const w = e[3] * px + e[7] * L + e[11] * pz + e[15];
          if (w <= 1e-6) { out.set(0, 0, 1, 1); return true; }
          const u = (e[0] * px + e[4] * L + e[8] * pz + e[12]) / w;
          const vv = (e[1] * px + e[5] * L + e[9] * pz + e[13]) / w;
          if (u < u0) u0 = u;
          if (u > u1) u1 = u;
          if (vv < v0) v0 = vv;
          if (vv > v1) v1 = vv;
        }
        if (u0 <= 0 && v0 <= 0 && u1 >= 1 && v1 >= 1) { out.set(0, 0, 1, 1); return true; }
      }
    }
    if (u0 > u1) return false;
    out.set(Math.max(0, u0), Math.max(0, v0), Math.min(1, u1), Math.min(1, v1));
    return out.x < out.z && out.y < out.w;
  }
}

/**
 * How far from the water (per unit of height) something can stand and still show in it: a view
 * ray that meets the water at an angle e above the horizon rises by tan(e) per unit it travels
 * on, so only objects within height * cot(e) of the water are reached. e is the shallowest ray of
 * the view (a top corner). Infinity when the view is too flat to tell.
 */
export function reflectionReach(camera: THREE.PerspectiveCamera): number {
  const v = new THREE.Vector3(1, 1, 0.5).unproject(camera).sub(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)).normalize();
  const s = -v.y; // sine of the angle below the horizon
  if (s < 0.05) return Infinity;
  return Math.sqrt(1 - s * s) / s;
}

export class PlanarReflection {
  rt: THREE.WebGLRenderTarget;
  virtualCamera = new THREE.PerspectiveCamera();
  textureMatrix = new THREE.Matrix4();
  /** the part of the texture drawn this frame (uv x0, y0, x1, y1); the water samples only inside it */
  readonly drawn = new THREE.Vector4(0, 0, 1, 1);
  enabled = true;
  private plane = new THREE.Plane();
  private normal = new THREE.Vector3(0, 1, 0);
  private reflectorPos = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private lookAt = new THREE.Vector3();
  private view = new THREE.Vector3();
  private target = new THREE.Vector3();
  private clip = new THREE.Vector4();
  private q = new THREE.Vector4();
  private sub = new THREE.Matrix4();

  constructor(private height: number, w: number, h: number) {
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
  }

  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(64, Math.floor(w)), Math.max(64, Math.floor(h)));
  }

  /** Place the mirrored camera for this frame's view and work out the texture matrix. */
  setup(camera: THREE.PerspectiveCamera) {
    this.reflectorPos.set(0, this.height, 0);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.reflectorPos, this.camPos);
    // mirror position
    this.view.set(this.camPos.x, 2 * this.height - this.camPos.y, this.camPos.z);
    this.rot.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.target.set(this.lookAt.x, 2 * this.height - this.lookAt.y, this.lookAt.z);
    const vc = this.virtualCamera;
    vc.position.copy(this.view);
    vc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    vc.lookAt(this.target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    // texture matrix: world -> reflection uv
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);

    // oblique near plane clipping (Lengyel) so nothing below the water shows up
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorPos);
    this.plane.applyMatrix4(vc.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = vc.projectionMatrix;
    const q = this.q;
    q.x = (Math.sign(this.clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(this.clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    this.clip.multiplyScalar(2.0 / this.clip.dot(q));
    pm.elements[2] = this.clip.x;
    pm.elements[6] = this.clip.y;
    pm.elements[10] = this.clip.z + 1.0 - 0.003;
    pm.elements[14] = this.clip.w;
  }

  /** Draw the part `uv` (x0, y0, x1, y1) of the reflection, with the objects in `hide` left out. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: THREE.Object3D[], uv: THREE.Vector4) {
    if (!this.enabled) return;
    const vc = this.virtualCamera;
    // whole texels, with a couple to spare for the filtering at the edge
    const W = this.rt.width, H = this.rt.height;
    const x0 = Math.max(0, Math.floor(uv.x * W) - 2), x1 = Math.min(W, Math.ceil(uv.z * W) + 2);
    const y0 = Math.max(0, Math.floor(uv.y * H) - 2), y1 = Math.min(H, Math.ceil(uv.w * H) + 2);
    this.drawn.set(x0 / W, y0 / H, x1 / W, y1 / H);
    // narrow the frustum to that rectangle: its NDC range is stretched over the whole clip range,
    // so three culls everything outside it and the viewport puts it back in place
    const sx = W / (x1 - x0), sy = H / (y1 - y0);
    const cx = (x0 + x1) / W - 1, cy = (y0 + y1) / H - 1;
    this.sub.set(sx, 0, 0, -cx * sx, 0, sy, 0, -cy * sy, 0, 0, 1, 0, 0, 0, 0, 1);
    const full = vc.projectionMatrix.clone();
    vc.projectionMatrix.premultiply(this.sub);
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    this.rt.viewport.set(x0, y0, x1 - x0, y1 - y0);
    this.rt.scissor.set(x0, y0, x1 - x0, y1 - y0);
    this.rt.scissorTest = true;

    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const oldTarget = renderer.getRenderTarget();
    // the shadow map from this frame stays as it is
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    lodPass.reflect = true;
    renderer.render(scene, vc);
    lodPass.reflect = false;
    renderer.setRenderTarget(oldTarget);
    renderer.shadowMap.autoUpdate = shadowAuto;
    hide.forEach((o, i) => (o.visible = vis[i]));
    vc.projectionMatrix.copy(full);
    vc.projectionMatrixInverse.copy(full).invert();
  }
}
