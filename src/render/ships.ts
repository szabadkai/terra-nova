// Ships on the water: hull, set or furled sail, pennant, cargo on deck, rolling in the swell,
// spray at the bow and wakes drawn by the water shader. Warships row with banks of oars, turn the
// catapult on their foredeck towards what they shoot at and swing its arm; a holed ship smokes,
// then burns, lists, and at the last settles by the stern and goes under.
import * as THREE from 'three';
import { GOODS, Good } from '../game/defs';
import type { Game } from '../game/game';
import type { Ship } from '../game/types';
import { WATER_LEVEL } from '../game/world';
import { DECK_H, SHIP_SCALE, cargoCount, shipDeckY } from '../game/sea';
import { SINK_TIME } from '../game/naval';
import { BANNER_COLORS, getMaterial, PENNANT } from './materials';
import { patchMaterial } from './shaderPatch';
import { HULL_L, Sail, sailTexture, shipParts } from './shipModels';
import { WAR_L, WarshipParts, warSailTexture, warshipParts } from './warshipModels';
import type { PilesRenderer } from './entities';
import type { Particles } from './particles';

interface WarView {
  parts: WarshipParts;
  turret: THREE.Object3D;
  arm: THREE.Object3D;
  stone: THREE.Object3D;
  oars: THREE.InstancedMesh;
  yaw: number;
  stroke: number;
  row: number;
}

interface ShipView {
  id: number;
  group: THREE.Group;
  sail: Sail;
  open: number;
  roll: number;
  lastHeading: number;
  sprayT: number;
  smokeT: number;
  war: WarView | null;
  bar: THREE.Group | null;
  barFill: THREE.Mesh | null;
  sinkSide: number;
}

export const MAX_WAKES = 8;
/** The catapult arm: cocked back towards the stern, and thrown up against the padded bar. */
const ARM_COCKED = -1.35, ARM_THROWN = 0.62;

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YZX'), tmpV = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);

export class ShipsRenderer {
  group = new THREE.Group();
  views = new Map<number, ShipView>();
  /** x, z, heading, speed of the ships nearest the camera, for the water shader. */
  wakes: THREE.Vector4[] = Array.from({ length: MAX_WAKES }, () => new THREE.Vector4());
  wakeCount = 0;
  /** ships whose health bar shows even when they are sound (the selected ones) */
  highlight = new Set<number>();
  private sailMats = new Map<string, THREE.Material>();
  private flagGeo: THREE.BufferGeometry;
  private stoneGeo: THREE.BufferGeometry;
  private barGeo = new THREE.PlaneGeometry(1, 1);
  private barBack: THREE.MeshBasicMaterial;

  constructor(private game: Game, private piles: PilesRenderer, private particles: Particles) {
    const fg = new THREE.PlaneGeometry(PENNANT.len, PENNANT.height, 14, 3);
    fg.translate(PENNANT.len / 2, 0, 0);
    this.flagGeo = fg;
    this.stoneGeo = new THREE.DodecahedronGeometry(0.045, 0);
    this.barBack = new THREE.MeshBasicMaterial({ color: 0x140e08, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false, toneMapped: false });
  }

  private sailMat(owner: number, war: boolean) {
    const key = `${war ? 'w' : 's'}${owner}`;
    let m = this.sailMats.get(key);
    if (!m) {
      const col = BANNER_COLORS[owner] ?? 0xc8342a;
      m = new THREE.MeshStandardMaterial({ map: war ? warSailTexture(owner, col) : sailTexture(owner, col), roughness: 0.92, side: THREE.DoubleSide });
      patchMaterial(m, { key: `sail${key}`, snow: 0 });
      this.sailMats.set(key, m);
    }
    return m;
  }

  /** A merchantman and a warship for each owner, only for GameRenderer.warmUp to compile their shaders. */
  samples(owners: number[]): THREE.Group {
    const out = new THREE.Group();
    for (const o of owners) for (const war of [false, true]) {
      const parts = war ? warshipParts(o) : shipParts(o);
      const g = parts.mb.build((k) => getMaterial(k));
      const sail = new Sail(this.sailMat(o, war), parts).mesh;
      sail.geometry.userData.sail = true;
      g.add(sail, new THREE.Mesh(this.flagGeo, getMaterial(`pennant${o}`)), new THREE.Mesh(this.barGeo, this.barBack));
      if (war) {
        const wp = parts as WarshipParts;
        g.add(wp.turret.build((k) => getMaterial(k)), wp.arm.build((k) => getMaterial(k)), new THREE.Mesh(this.stoneGeo, getMaterial('rock')));
        g.add(new THREE.InstancedMesh(wp.oarGeo, getMaterial('timber'), wp.oars.length));
      }
      out.add(g);
    }
    return out;
  }

  private create(sh: Ship): ShipView {
    const war = sh.kind === 'war';
    const parts = war ? warshipParts(sh.owner) : shipParts(sh.owner);
    const group = parts.mb.build((k) => getMaterial(k));
    const sail = new Sail(this.sailMat(sh.owner, war), parts);
    sail.mesh.position.z += war ? 0.07 : 0.08;
    group.add(sail.mesh);
    const flag = new THREE.Mesh(this.flagGeo, getMaterial(`pennant${sh.owner}`));
    flag.position.copy(parts.flagPos);
    flag.rotation.y = Math.PI / 2; // streams aft
    group.add(flag);
    let wv: WarView | null = null;
    if (war) {
      const wp = parts as WarshipParts;
      const banner = new THREE.Mesh(this.flagGeo, getMaterial(`pennant${sh.owner}`));
      banner.position.copy(wp.sternFlag);
      banner.rotation.y = Math.PI / 2;
      banner.scale.set(0.8, 1.6, 1);
      group.add(banner);
      const turret = wp.turret.build((k) => getMaterial(k));
      turret.position.copy(wp.turretPos);
      turret.scale.setScalar(1.3);
      group.add(turret);
      const arm = wp.arm.build((k) => getMaterial(k));
      arm.position.copy(wp.armPivot);
      arm.rotation.x = ARM_COCKED;
      turret.add(arm);
      const stone = new THREE.Mesh(this.stoneGeo, getMaterial('rock'));
      stone.position.copy(wp.cupPos);
      stone.castShadow = true;
      arm.add(stone);
      const oars = new THREE.InstancedMesh(wp.oarGeo, getMaterial('timber'), wp.oars.length);
      oars.castShadow = true;
      oars.receiveShadow = true;
      oars.frustumCulled = false;
      group.add(oars);
      wv = { parts: wp, turret, arm, stone, oars, yaw: 0, stroke: sh.id, row: 0 };
      this.pose(wv, 0, 0);
    }
    group.scale.setScalar(SHIP_SCALE);
    group.userData.shipId = sh.id;
    group.traverse((o) => { o.userData.shipId = sh.id; });
    this.group.add(group);
    const v: ShipView = {
      id: sh.id, group, sail, open: sh.route ? 1 : 0, roll: 0, lastHeading: sh.heading, sprayT: 0, smokeT: 0,
      war: wv, bar: null, barFill: null, sinkSide: sh.id % 2 ? 1 : -1,
    };
    this.views.set(sh.id, v);
    return v;
  }

  private dispose(v: ShipView) {
    this.group.remove(v.group);
    v.sail.mesh.geometry.dispose();
    v.war?.oars.dispose();
    if (v.bar) { this.group.remove(v.bar); (v.barFill!.material as THREE.Material).dispose(); }
  }

  /** Oars: pulled through the water in unison under way, held level at rest. */
  private pose(wv: WarView, row: number, stroke: number) {
    const oars = wv.parts.oars;
    const s = Math.sin(stroke), c = Math.cos(stroke);
    const sweep = s * 0.36 * row;
    // at rest the blades lie on the water; under way they dig in on the pull (moving aft) and lift clear on the way back
    const tilt = -0.21 - row * 0.1 * c;
    for (let k = 0; k < oars.length; k++) {
      const o = oars[k];
      tmpE.set(0, o.side > 0 ? sweep : Math.PI - sweep, tilt, 'YZX');
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpV.set(o.x, o.y, o.z), tmpQ, ONE);
      wv.oars.setMatrixAt(k, tmpM);
    }
    wv.oars.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, time: number, camX: number, camZ: number, camera?: THREE.Camera) {
    const g = this.game;
    const w = g.world;
    for (const v of [...this.views.values()]) {
      if (!g.ships.has(v.id)) { this.dispose(v); this.views.delete(v.id); }
    }
    const near: { d: number; sh: Ship }[] = [];
    for (const sh of g.ships.values()) {
      let v = this.views.get(sh.id);
      if (!v) v = this.create(sh);
      const xi = Math.max(0, Math.min(w.W - 1, Math.round(sh.x))), zi = Math.max(0, Math.min(w.H - 1, Math.round(sh.z)));
      const seen = sh.owner === g.local || w.explored[w.idx(xi, zi)];
      v.group.visible = !!seen;
      if (v.bar) v.bar.visible = false;
      if (!seen) continue;
      const close = Math.abs(sh.x - camX) < 90 && Math.abs(sh.z - camZ) < 90;
      const camD = Math.hypot(sh.x - camX, sh.z - camZ);
      const sinking = sh.state === 'sinking';
      const sk = sinking ? Math.min(1, sh.sinkT / SINK_TIME) : 0;
      const health = Math.max(0, sh.hp / sh.maxHp);
      // turning heels the ship over; waves rock it gently; a holed hull lists
      let dh = sh.heading - v.lastHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      v.lastHeading = sh.heading;
      const turn = dt > 0 ? dh / dt : 0;
      v.roll += (Math.max(-0.12, Math.min(0.12, -turn * sh.speed * 0.08)) - v.roll) * Math.min(1, dt * 2);
      const swell = Math.sin(time * 1.1 + sh.id * 1.7) * 0.03 + Math.sin(time * 0.63 + sh.id) * 0.02;
      const pitch = Math.sin(time * 0.9 + sh.id * 2.3) * 0.022 - sh.speed * 0.006;
      const list = (1 - health) * 0.07 * v.sinkSide;
      // going down: settles by the stern, rolls over and slips under
      const down = sk ** 1.6 * 1.9, pitchDown = -sk * 0.42, rollDown = sk * sk * 0.9 * v.sinkSide;
      v.group.position.set(sh.x, shipDeckY(time, sh.id) - 0.02 - down, sh.z);
      v.group.rotation.set(pitch + pitchDown, sh.heading, v.roll + swell + list + rollDown, 'YXZ');
      // sail: set under way, furled in port, torn loose when she founders
      const target = sinking ? 0.25 : sh.route || sh.speed > 0.35 ? 1 : 0;
      v.open += (target - v.open) * Math.min(1, dt * (target ? 0.9 : 0.6));
      const belly = sinking ? 0.02 : 0.05 + Math.min(1, sh.speed / 2.7) * 0.2;
      if (close) v.sail.shape(v.open, belly, time * 3 + sh.id);
      const L = v.war ? WAR_L : HULL_L;
      // warships: oars, the catapult turning to its mark and the arm's swing
      if (v.war && close) {
        const wv = v.war;
        const want = sinking ? 0 : Math.min(1, sh.speed / 1.2);
        wv.row += (want - wv.row) * Math.min(1, dt * 1.5);
        wv.stroke += dt * (1.3 + sh.speed * 0.8) * (0.25 + wv.row);
        this.pose(wv, wv.row, wv.stroke);
        const since = g.time - sh.fired;
        let yaw = 0;
        if (since < 7 || sh.state === 'bombard' || sh.state === 'hunt' || sh.target) {
          yaw = sh.aim - sh.heading;
          while (yaw > Math.PI) yaw -= Math.PI * 2;
          while (yaw < -Math.PI) yaw += Math.PI * 2;
        }
        let dy = yaw - wv.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        wv.yaw += dy * Math.min(1, dt * 2.5);
        wv.turret.rotation.y = wv.yaw;
        let a = ARM_COCKED;
        if (since >= 0 && since < 0.2) a = ARM_COCKED + (ARM_THROWN - ARM_COCKED) * Math.sin((since / 0.2) * Math.PI / 2);
        else if (since < 0.9) a = ARM_THROWN - Math.sin(((since - 0.2) / 0.7) * Math.PI * 3) * 0.06 * (1 - (since - 0.2) / 0.7);
        else if (since < 3.4) a = ARM_THROWN + (ARM_COCKED - ARM_THROWN) * ((since - 0.9) / 2.5);
        wv.arm.rotation.x = a;
        wv.stone.visible = since < 0 || since > 3.4;
      }
      const fx = Math.sin(sh.heading), fz = Math.cos(sh.heading);
      // spray under the bow
      v.sprayT -= dt;
      if (!sinking && sh.speed > 1.1 && v.sprayT <= 0 && camD < 60) {
        v.sprayT = 0.07;
        for (const side of [-1, 1]) {
          const px = sh.x + fx * L * 0.42 * SHIP_SCALE + fz * side * 0.25, pz = sh.z + fz * L * 0.42 * SHIP_SCALE - fx * side * 0.25;
          this.particles.emit({
            x: px, y: WATER_LEVEL + 0.05, z: pz, vx: fz * side * 0.7 + fx * 0.4, vz: -fx * side * 0.7 + fz * 0.4, vy: 0.9 + Math.random() * 0.5,
            spread: 0.08, life: 0.55, size: 0.07, grow: 0.8, color: [0.92, 0.96, 1.0], alpha: 0.7, gravity: 3.5, drag: 0.6, kind: 1,
          });
        }
      }
      // smoke from a holed deck, then fire; foam and bubbles round a sinking hull
      v.smokeT -= dt;
      if ((health < 0.75 || sinking) && camD < 70 && v.smokeT <= 0) {
        v.smokeT = sinking ? 0.06 : health < 0.4 ? 0.09 : 0.35;
        const spots = v.war ? v.war.parts.fires : [new THREE.Vector3(0.05, 0.3, -0.2), new THREE.Vector3(-0.08, 0.3, 0.45)];
        const sp = spots[Math.floor(Math.random() * spots.length)];
        const lx = sp.x * SHIP_SCALE, lz = sp.z * SHIP_SCALE;
        const px = sh.x + lx * fz + lz * fx, pz = sh.z - lx * fx + lz * fz;
        const py = v.group.position.y + sp.y * SHIP_SCALE;
        if (!sinking || sk < 0.7) this.particles.smoke(px, py, pz, health < 0.4 || sinking ? 0.75 : 0.3, health < 0.4 ? 0.8 : 0.55);
        if ((health < 0.4 && !sinking) || (sinking && sk < 0.55)) this.particles.fire(px, py + 0.05, pz, health < 0.2 || sinking ? 0.8 : 0.55);
        if (sinking) {
          const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * L * 0.5 * SHIP_SCALE;
          this.particles.emit({ x: sh.x + Math.cos(a) * r, y: WATER_LEVEL + 0.03, z: sh.z + Math.sin(a) * r, vy: 0.5 + Math.random(), spread: 0.3, life: 0.8, size: 0.05, color: [0.9, 0.96, 1], alpha: 0.8, gravity: 4, count: 3, kind: 1 });
          if (Math.random() < 0.3) this.particles.splash(sh.x + (Math.random() - 0.5) * L, WATER_LEVEL, sh.z + (Math.random() - 0.5) * L);
        }
      }
      // goods on deck
      if (!sinking && cargoCount(sh)) this.deckCargo(sh, time);
      // health bar over hulls that have taken damage, and over the chosen ones
      if (camera && !sinking && (health < 0.999 || this.highlight.has(sh.id)) && camD < 80) this.healthBar(v, sh, health, camera);
      near.push({ d: (sh.x - camX) ** 2 + (sh.z - camZ) ** 2, sh });
    }
    near.sort((a, b) => a.d - b.d);
    this.wakeCount = Math.min(MAX_WAKES, near.length);
    for (let k = 0; k < this.wakeCount; k++) {
      const sh = near[k].sh;
      this.wakes[k].set(sh.x, sh.z, sh.heading, sh.state === 'sinking' ? 0 : sh.speed);
    }
  }

  private healthBar(v: ShipView, sh: Ship, health: number, camera: THREE.Camera) {
    if (!v.bar) {
      const bar = new THREE.Group();
      const back = new THREE.Mesh(this.barGeo, this.barBack);
      back.scale.set(1, 0.11, 1);
      back.renderOrder = 24;
      const fill = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x60d040, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      fill.renderOrder = 25;
      fill.position.z = 0.001;
      bar.add(back, fill);
      this.group.add(bar);
      v.bar = bar;
      v.barFill = fill;
    }
    // over the hull, level with the yard
    const top = (v.war ? v.war.parts.yardY : shipParts(sh.owner).yardY) * SHIP_SCALE;
    v.bar.visible = true;
    v.bar.position.set(sh.x, v.group.position.y + top + 0.2, sh.z);
    v.bar.quaternion.copy(camera.quaternion);
    const f = v.barFill!;
    f.scale.set(0.94 * health, 0.07, 1);
    f.position.x = -0.47 * (1 - health);
    (f.material as THREE.MeshBasicMaterial).color.setRGB(health < 0.5 ? 0.95 : 1.9 - health * 1.9 + 0.1, health > 0.5 ? 0.82 : health * 1.6, 0.2);
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
    for (const v of this.views.values()) {
      if (n >= out.length) break;
      if (!v.group.visible) continue;
      const sh = this.game.ships.get(v.id);
      if (!sh || sh.state === 'sinking' || Math.hypot(sh.x - camX, sh.z - camZ) > maxDist) continue;
      const t = v.war ? v.war.parts.lantern : shipParts(0).lantern;
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
