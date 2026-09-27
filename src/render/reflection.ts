// Planar reflection for the water surface (mirrored camera + oblique near plane).
import * as THREE from 'three';

export class PlanarReflection {
  rt: THREE.WebGLRenderTarget;
  virtualCamera = new THREE.PerspectiveCamera();
  textureMatrix = new THREE.Matrix4();
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

  constructor(private height: number, w: number, h: number) {
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
  }

  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(64, Math.floor(w)), Math.max(64, Math.floor(h)));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]) {
    if (!this.enabled) return;
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

    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const oldTarget = renderer.getRenderTarget();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(oldTarget);
    renderer.shadowMap.autoUpdate = shadowAuto;
    hide.forEach((o, i) => (o.visible = vis[i]));
  }
}
