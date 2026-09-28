// Soldier command visuals: rings under the chosen men (tinted by their health), fainter rings
// under the men a selection box is about to take, a ring under whatever the pointer is over (red
// for a foe), a ring that pulses out where an order lands, and screen-space picking for box selection.
import * as THREE from 'three';
import type { Game } from '../game/game';
import type { GameEvent, Settler } from '../game/types';
import { commandable } from '../game/orders';

const MAX_RINGS = 256;
const PULSE_COLORS: Record<string, number> = { move: 0xffd36a, attack: 0xff5a40, garrison: 0x7ac8ff };

export class OrdersFX {
  group = new THREE.Group();
  /** ids of the soldiers the player has picked */
  chosen: number[] = [];
  /** soldiers inside the selection box being drawn */
  preview: number[] = [];
  /** what the pointer is over; a building's ring is drawn on the ground by the terrain shader */
  hover: { kind: 'settler' | 'building'; id: number; foe: boolean } | null = null;
  private rings: THREE.InstancedMesh;
  private pulses: { mesh: THREE.Mesh; t: number }[] = [];
  private pulseGeo: THREE.RingGeometry;

  constructor(private game: Game) {
    const ring = new THREE.RingGeometry(0.3, 0.4, 28);
    ring.rotateX(-Math.PI / 2);
    // drawn over trees and roofs, so the chosen men can always be told apart
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, toneMapped: false });
    this.rings = new THREE.InstancedMesh(ring, mat, MAX_RINGS);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 20;
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
    this.group.add(this.rings);
    this.pulseGeo = new THREE.RingGeometry(0.82, 1, 40);
    this.pulseGeo.rotateX(-Math.PI / 2);
  }

  /** Drop men who died, boarded a ship or were taken inside. */
  prune() {
    const g = this.game;
    this.chosen = this.chosen.filter((id) => { const s = g.settlers.get(id); return commandable(g, g.local, s) && !s.inside; });
  }

  update(dt: number) {
    const g = this.game, w = g.world;
    const m = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (const id of this.chosen) {
      if (n >= MAX_RINGS) break;
      const s = g.settlers.get(id);
      if (!s || s.hidden || s.dead) continue;
      const k = s.job === 'catapult' ? 2.2 : 1;
      m.makeScale(k, 1, k).setPosition(s.x, w.heightAt(s.x, s.z) + 0.05, s.z);
      this.rings.setMatrixAt(n, m);
      const hp = Math.max(0, s.hp / s.maxHp);
      col.setRGB(hp < 0.5 ? 1 : 2 - hp * 2 + 0.25, hp > 0.5 ? 1 : hp * 2, 0.25);
      this.rings.setColorAt(n, col);
      n++;
    }
    const ring = (s: Settler | undefined, scale: number, r: number, gg: number, b: number) => {
      if (n >= MAX_RINGS || !s || s.hidden || s.dead) return;
      m.makeScale(scale, 1, scale).setPosition(s.x, w.heightAt(s.x, s.z) + 0.05, s.z);
      this.rings.setMatrixAt(n, m);
      this.rings.setColorAt(n, col.setRGB(r, gg, b));
      n++;
    };
    for (const id of this.preview) if (!this.chosen.includes(id)) ring(g.settlers.get(id), 1, 0.55, 0.5, 0.3);
    const h = this.hover;
    if (h?.kind === 'settler' && !this.chosen.includes(h.id)) {
      const s = g.settlers.get(h.id);
      const big = s?.job === 'catapult' ? 2.2 : s?.job === 'donkey' ? 1.5 : 1.1;
      if (h.foe) ring(s, big, 1, 0.16, 0.08); else ring(s, big, 0.85, 0.82, 0.7);
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor!.needsUpdate = true;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      const k = p.t / 0.9;
      if (k >= 1) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.pulses.splice(i, 1);
        continue;
      }
      p.mesh.scale.setScalar(0.4 + k * 1.6);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
  }

  onEvent(e: GameEvent) {
    if (e.type !== 'order' || e.owner !== this.game.local || e.x === undefined || e.z === undefined) return;
    const mat = new THREE.MeshBasicMaterial({ color: PULSE_COLORS[e.kind ?? 'move'] ?? 0xffffff, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    const mesh = new THREE.Mesh(this.pulseGeo, mat);
    mesh.position.set(e.x, this.game.world.heightAt(e.x, e.z) + 0.06, e.z);
    mesh.renderOrder = 20;
    this.group.add(mesh);
    this.pulses.push({ mesh, t: 0 });
  }

  /** Ground ring (x, z, radius) and colour for the building under the pointer, or null. */
  hoverRing(selectedId: number): { x: number; z: number; r: number; foe: boolean } | null {
    const h = this.hover;
    if (h?.kind !== 'building' || h.id === selectedId) return null;
    const b = this.game.buildings.get(h.id);
    return b ? { x: b.cx, z: b.cz, r: b.size * 0.75 + 0.3, foe: h.foe } : null;
  }

  /** The local player's field soldiers whose screen position falls in a client-space rectangle. */
  inRect(camera: THREE.Camera, canvas: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number, job?: Settler['job']): number[] {
    const g = this.game, w = g.world;
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    const out: number[] = [];
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0], [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
    for (const s of g.settlers.values()) {
      if (!commandable(g, g.local, s) || s.inside || s.hidden || (job && s.job !== job)) continue;
      if (!w.explored[w.idx(Math.round(s.x), Math.round(s.z))]) continue;
      v.set(s.x, w.heightAt(s.x, s.z) + 0.4, s.z).project(camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * r.width + r.left, sy = (-v.y * 0.5 + 0.5) * r.height + r.top;
      if (sx >= ax && sx <= bx && sy >= ay && sy <= by) out.push(s.id);
    }
    return out;
  }

  dispose() {
    this.rings.geometry.dispose();
    (this.rings.material as THREE.Material).dispose();
    this.pulseGeo.dispose();
    for (const p of this.pulses) (p.mesh.material as THREE.Material).dispose();
  }
}
