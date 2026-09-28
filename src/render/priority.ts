// The prioritised building's marker: a golden star turning slowly above the roof, with a soft
// ring breathing on the ground around the site, so the player can always find what he put first.
import * as THREE from 'three';
import type { Game } from '../game/game';

function starShape(outer: number, inner: number, points = 5): THREE.Shape {
  const s = new THREE.Shape();
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? outer : inner;
    const a = (k / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (k === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export class PriorityMarker {
  group = new THREE.Group();
  private star: THREE.Mesh;
  private ring: THREE.Mesh;
  private glow: THREE.Mesh;

  constructor(private game: Game) {
    const geo = new THREE.ExtrudeGeometry(starShape(0.42, 0.185), { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2 });
    geo.center();
    const mat = new THREE.MeshStandardMaterial({ color: 0xf6c94e, emissive: 0x7a4e08, metalness: 0.55, roughness: 0.3 });
    this.star = new THREE.Mesh(geo, mat);
    this.star.castShadow = true;
    // a faint halo behind the star that always faces the camera
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), glowMat);
    const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf6c94e, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.renderOrder = 19;
    this.group.add(this.star, this.glow, this.ring);
    this.group.visible = false;
  }

  /** `top` is the building's roof height above its base `baseY`. */
  update(time: number, camera: THREE.Camera, top: number, baseY: number) {
    const g = this.game;
    const b = g.priorityOf(g.local);
    if (!b) { this.group.visible = false; return; }
    this.group.visible = true;
    const y = baseY + top + 0.55 + Math.sin(time * 2.2) * 0.08;
    this.star.position.set(b.cx, y, b.cz);
    this.star.rotation.y = time * 1.1;
    this.glow.position.set(b.cx, y, b.cz);
    this.glow.quaternion.copy(camera.quaternion);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(time * 2.2) * 0.06;
    const r = b.size * 0.75 + 0.45;
    const k = 1 + Math.sin(time * 2.2) * 0.04;
    this.ring.position.set(b.cx, g.world.heightAt(b.cx, b.cz) + 0.07, b.cz);
    this.ring.scale.set(r * k, 1, r * k);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.42 + Math.sin(time * 2.2) * 0.12;
  }

  dispose() {
    for (const m of [this.star, this.glow, this.ring]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}
