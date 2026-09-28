// Ships on the water: hull, set or furled sail, pennant, cargo on deck, rolling in the swell,
// spray at the bow and wakes drawn by the water shader.
import * as THREE from 'three';
import { GOODS, Good } from '../game/defs';
import type { Game } from '../game/game';
import type { Ship } from '../game/types';
import { WATER_LEVEL } from '../game/world';
import { DECK_H, SHIP_SCALE, cargoCount, shipDeckY } from '../game/sea';
import { getMaterial } from './materials';
import { BANNER_COLORS } from './materials';
import { patchMaterial } from './shaderPatch';
import { HULL_L, Sail, sailTexture, shipParts } from './shipModels';
import type { PilesRenderer } from './entities';
import type { Particles } from './particles';

interface ShipView {
  id: number;
  group: THREE.Group;
  sail: Sail;
  open: number;
  roll: number;
  lastHeading: number;
  sprayT: number;
}

export const MAX_WAKES = 8;

export class ShipsRenderer {
  group = new THREE.Group();
  views = new Map<number, ShipView>();
  /** x, z, heading, speed of the ships nearest the camera, for the water shader. */
  wakes: THREE.Vector4[] = Array.from({ length: MAX_WAKES }, () => new THREE.Vector4());
  wakeCount = 0;
  private sailMats = new Map<number, THREE.Material>();
  private flagGeo: THREE.BufferGeometry;

  constructor(private game: Game, private piles: PilesRenderer, private particles: Particles) {
    const fg = new THREE.PlaneGeometry(0.5, 0.13, 10, 2);
    fg.translate(0.25, 0, 0);
    this.flagGeo = fg;
  }

  private sailMat(owner: number) {
    let m = this.sailMats.get(owner);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: sailTexture(owner, BANNER_COLORS[owner] ?? 0xc8342a), roughness: 0.92, side: THREE.DoubleSide });
      patchMaterial(m, { key: `sail${owner}`, snow: 0 });
      this.sailMats.set(owner, m);
    }
    return m;
  }

  private create(sh: Ship): ShipView {
    const parts = shipParts(sh.owner);
    const group = parts.mb.build((k) => getMaterial(k));
    const sail = new Sail(this.sailMat(sh.owner), parts);
    sail.mesh.position.z += 0.08;
    group.add(sail.mesh);
    const flag = new THREE.Mesh(this.flagGeo, getMaterial(`banner${sh.owner}`));
    flag.position.copy(parts.flagPos);
    flag.rotation.y = Math.PI / 2; // streams aft
    group.add(flag);
    group.scale.setScalar(SHIP_SCALE);
    group.userData.shipId = sh.id;
    group.traverse((o) => { o.userData.shipId = sh.id; });
    this.group.add(group);
    const v: ShipView = { id: sh.id, group, sail, open: sh.route ? 1 : 0, roll: 0, lastHeading: sh.heading, sprayT: 0 };
    this.views.set(sh.id, v);
    return v;
  }

  update(dt: number, time: number, camX: number, camZ: number) {
    const g = this.game;
    const w = g.world;
    for (const v of [...this.views.values()]) {
      if (!g.ships.has(v.id)) {
        this.group.remove(v.group);
        v.sail.mesh.geometry.dispose();
        this.views.delete(v.id);
      }
    }
    const near: { d: number; sh: Ship }[] = [];
    for (const sh of g.ships.values()) {
      let v = this.views.get(sh.id);
      if (!v) v = this.create(sh);
      const xi = Math.max(0, Math.min(w.W - 1, Math.round(sh.x))), zi = Math.max(0, Math.min(w.H - 1, Math.round(sh.z)));
      const seen = sh.owner === g.local || w.explored[w.idx(xi, zi)];
      v.group.visible = !!seen;
      if (!seen) continue;
      // turning heels the ship over; waves rock it gently
      let dh = sh.heading - v.lastHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      v.lastHeading = sh.heading;
      const turn = dt > 0 ? dh / dt : 0;
      v.roll += (Math.max(-0.12, Math.min(0.12, -turn * sh.speed * 0.08)) - v.roll) * Math.min(1, dt * 2);
      const swell = Math.sin(time * 1.1 + sh.id * 1.7) * 0.03 + Math.sin(time * 0.63 + sh.id) * 0.02;
      const pitch = Math.sin(time * 0.9 + sh.id * 2.3) * 0.022 - sh.speed * 0.006;
      v.group.position.set(sh.x, shipDeckY(time, sh.id) - 0.02, sh.z);
      v.group.rotation.set(pitch, sh.heading, v.roll + swell, 'YXZ');
      // sail: set under way, furled in port
      const target = sh.route || sh.speed > 0.35 ? 1 : 0;
      v.open += (target - v.open) * Math.min(1, dt * (target ? 0.9 : 0.6));
      const belly = 0.05 + Math.min(1, sh.speed / 2.7) * 0.2;
      if (Math.abs(v.group.position.x - camX) < 90 && Math.abs(v.group.position.z - camZ) < 90) v.sail.shape(v.open, belly, time * 3 + sh.id);
      // spray under the bow
      v.sprayT -= dt;
      if (sh.speed > 1.1 && v.sprayT <= 0 && Math.hypot(sh.x - camX, sh.z - camZ) < 60) {
        v.sprayT = 0.07;
        const fx = Math.sin(sh.heading), fz = Math.cos(sh.heading);
        for (const side of [-1, 1]) {
          const px = sh.x + fx * HULL_L * 0.42 * SHIP_SCALE + fz * side * 0.25, pz = sh.z + fz * HULL_L * 0.42 * SHIP_SCALE - fx * side * 0.25;
          this.particles.emit({
            x: px, y: WATER_LEVEL + 0.05, z: pz, vx: fz * side * 0.7 + fx * 0.4, vz: -fx * side * 0.7 + fz * 0.4, vy: 0.9 + Math.random() * 0.5,
            spread: 0.08, life: 0.55, size: 0.07, grow: 0.8, color: [0.92, 0.96, 1.0], alpha: 0.7, gravity: 3.5, drag: 0.6, kind: 1,
          });
        }
      }
      // goods on deck
      if (cargoCount(sh)) this.deckCargo(sh, time);
      near.push({ d: (sh.x - camX) ** 2 + (sh.z - camZ) ** 2, sh });
    }
    near.sort((a, b) => a.d - b.d);
    this.wakeCount = Math.min(MAX_WAKES, near.length);
    for (let k = 0; k < this.wakeCount; k++) {
      const sh = near[k].sh;
      this.wakes[k].set(sh.x, sh.z, sh.heading, sh.speed);
    }
  }

  private deckCargo(sh: Ship, time: number) {
    const c = Math.cos(sh.heading), s = Math.sin(sh.heading);
    const y = shipDeckY(time, sh.id) - 0.02 + DECK_H;
    // amidships and on the hatch, in rows
    const slots = [[-0.15, -0.1], [0.15, -0.1], [-0.15, -0.36], [0.15, -0.36], [0, 0.3], [-0.15, 0.32], [0.15, 0.32], [0, -0.6]];
    let k = 0;
    for (const gd of GOODS) {
      const n = sh.cargo[gd as Good];
      if (!n || k >= slots.length) continue;
      const lx = slots[k][0] * SHIP_SCALE, lz = slots[k][1] * SHIP_SCALE;
      k++;
      this.piles.pile(gd as Good, Math.min(6, n), sh.x + lx * c + lz * s, y, sh.z - lx * s + lz * c, sh.heading);
    }
  }

  /** Stern lanterns light the water at night. */
  lightSources(out: THREE.Vector4[], start: number, camX: number, camZ: number, maxDist: number, night: number) {
    if (night < 0.05) return start;
    let n = start;
    const t = shipParts(0).lantern;
    for (const v of this.views.values()) {
      if (n >= out.length) break;
      if (!v.group.visible) continue;
      const sh = this.game.ships.get(v.id);
      if (!sh || Math.hypot(sh.x - camX, sh.z - camZ) > maxDist) continue;
      const c = Math.cos(sh.heading), s = Math.sin(sh.heading);
      out[n++].set(sh.x + t.z * SHIP_SCALE * s, v.group.position.y + t.y * SHIP_SCALE, sh.z + t.z * SHIP_SCALE * c, 0.9);
    }
    return n;
  }

  pick(ray: THREE.Raycaster): number {
    const hits = ray.intersectObjects(this.group.children, true);
    for (const h of hits) if (h.object.userData.shipId) return h.object.userData.shipId;
    return 0;
  }
}
