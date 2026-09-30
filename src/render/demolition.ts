// Building destruction: a fire that grows into a blaze, timbers that groan and shed embers, the roof
// coming down in a burst of debris, sparks and dust, and rubble that smoulders on after the building
// itself is gone.
import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { Game } from '../game/game';
import type { BuildingsRenderer } from './buildings';
import { box } from './geom';
import { getMaterial } from './materials';
import type { Particles } from './particles';
import { patchMaterial } from './shaderPatch';
import { commitInstances, withInstanceColor } from './instancing';

/** Seconds a building burns before the game removes it (economy.ts). */
export const BURN_TIME = 12;
/** Seconds the roof takes to come down. */
const DROP_TIME = 0.75;

/** Second of the burn at which the roof of building `id` gives way; staggered so a razed town does not fall in unison. */
export function collapseAt(id: number) {
  return 5.4 + hash2(id, 17) * 1.8;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface BurnPose {
  /** flame strength */
  fire: number;
  /** blackening of the walls */
  char: number;
  /** ember glow from inside the walls */
  glow: number;
  /** how far the structure has come down: 0 standing, 1 fallen */
  drop: number;
  /** trembling in the moments before it gives */
  shudder: number;
  /** the wreck settling into the ground once it has fallen */
  sink: number;
}

/** The state of a building `t` seconds into its burn, whose roof falls at `tc`. Shared by the building pose, its lights and the effects. */
export function burnPose(t: number, tc: number): BurnPose {
  const fire = smooth(0, 3.5, t) * (1 - 0.7 * smooth(tc + 0.4, tc + 4.5, t));
  const char = smooth(0.8, tc + 1, t);
  let drop = 0;
  if (t >= tc) {
    const k = Math.min(1, (t - tc) / DROP_TIME);
    drop = Math.pow(k, 1.8);
    const after = t - tc - DROP_TIME;
    // a short rebound as the walls hit the ground
    if (after > 0) drop = 1 - 0.05 * Math.exp(-after * 5) * Math.sin(after * 24);
  }
  const shudder = t < tc ? smooth(tc - 1.4, tc - 0.1, t) : 0;
  const sink = smooth(tc + 2.5, BURN_TIME - 0.4, t);
  return { fire, char, glow: fire * (1 - 0.5 * drop), drop, shudder, sink };
}

// ------------------------------------------------------------------ rubble
type Kind = 'timber' | 'stone' | 'roof' | 'wall';
const KIND_KEYS: Record<Kind, string[]> = {
  timber: ['timber', 'planks', 'wood', 'dark'],
  stone: ['stone', 'stoneDark', 'sandstone', 'cobble', 'rock', 'marble', 'marbleDark'],
  roof: ['roof0', 'roof1', 'roof2', 'roof3', 'thatch', 'terracotta'],
  wall: ['plaster', 'plasterWarm', 'sandstone', 'marble'],
};
const CAP = 384;
const CHAR_COL = new THREE.Color(0.2, 0.16, 0.14);
const SOOT_COL = new THREE.Color(0.82, 0.8, 0.78);

interface Chunk {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  q: THREE.Quaternion;
  wx: number; wy: number; wz: number;
  sx: number; sy: number; sz: number;
  /** 0 while flying, else seconds since it came to rest */
  settled: number;
  /** the orientation it settles into: lying flat, some way round */
  flat: THREE.Quaternion;
  hot: number;
  hot0: number;
  /** seconds left lying there before it sinks away */
  life: number;
  sink: number;
}

interface Pool { mesh: THREE.InstancedMesh; chunks: Chunk[] }

interface Wreck {
  id: number; owner: number;
  x: number; z: number; y: number;
  size: number; height: number;
  tc: number;
  keys: Set<string>;
  collapsed: boolean;
  creaks: number;
  flareT: number;
  emit: number;
  mine: boolean;
}

interface Scorch { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; t: number; life: number }

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

export class Demolition {
  group = new THREE.Group();
  private pools = new Map<string, Pool>();
  private wrecks = new Map<number, Wreck>();
  private scorches: Scorch[] = [];
  private chunkGeo = box(1, 1, 1, 1);
  private scorchGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  private scorchTex: THREE.Texture;
  private emitT = 0;

  constructor(
    private game: Game,
    private particles: Particles,
    private buildings: BuildingsRenderer,
    /** the moment the roof comes down: a flash and a jolt of the camera at the wreck */
    private onImpact: (x: number, y: number, z: number, flash: number, shake: number) => void,
    private sound: (name: string, x: number, z: number, vol?: number) => void,
  ) {
    // soft-edged disc for the scorch mark left on the ground
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.scorchTex = new THREE.CanvasTexture(c);
  }

  /** A fat tongue of flame: a soft bright blob that rises, shrinks and reddens, with a licking streak on top. */
  private flame(x: number, y: number, z: number, s: number) {
    const P = this.particles;
    P.emit({ x, y, z, vy: 1.2 * s + 0.5, spread: 0.35 * s, vspread: 0.5, life: 0.45 + 0.25 * s, size: 0.4 * s, grow: -0.6, color: [2.2, 1.1, 0.35], color2: [1.2, 0.2, 0.03], alpha: 0.6, drag: 1.4, jitter: 0.25 * s, additive: true });
    if (Math.random() < 0.5) P.fire(x, y + 0.2 * s, z, 0.7 * s);
  }

  /** Thick black smoke that greys as it thins out. */
  private soot(x: number, y: number, z: number, big: number, dark = 1) {
    const g = 0.12 + (1 - dark) * 0.3;
    this.particles.emit({ x, y, z, vy: 0.9 * big, spread: 0.25, vspread: 0.3, life: 5 * big, size: 0.5 * big, grow: 3.0, color: [g, g * 0.95, g * 0.9], color2: [g + 0.2, g + 0.2, g + 0.2], alpha: 0.7, drag: 0.35, jitter: 0.3 * big });
  }

  /** Every rubble pool, made up front so their shaders compile with the rest (see GameRenderer.warmUp). */
  makePools() {
    for (const keys of Object.values(KIND_KEYS)) for (const k of keys) this.pool(k);
    // a scorch mark that never shows: each mark has a material of its own, disposed as it fades, and
    // this one keeps their shader compiled between fires
    if (!this.scorchProto) {
      this.scorchProto = new THREE.Mesh(this.scorchGeo, this.scorchMaterial());
      this.scorchProto.visible = false;
      this.scorchProto.renderOrder = 1;
      this.scorchProto.receiveShadow = true;
      this.group.add(this.scorchProto);
    }
  }
  private scorchProto: THREE.Mesh | null = null;

  private scorchMaterial() {
    return patchMaterial(new THREE.MeshStandardMaterial({
      color: 0x0b0907, roughness: 1, alphaMap: this.scorchTex, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }), { snow: 0, grime: 0, key: 'scorch' });
  }

  private pool(key: string): Pool {
    let p = this.pools.get(key);
    if (!p) {
      const mesh = withInstanceColor(new THREE.InstancedMesh(this.chunkGeo, getMaterial(key, 'inst'), CAP));
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      p = { mesh, chunks: [] };
      this.pools.set(key, p);
    }
    return p;
  }

  private pickKey(w: Wreck, kind: Kind): string {
    const have = KIND_KEYS[kind].filter((k) => w.keys.has(k));
    if (have.length) return have[Math.floor(Math.random() * have.length)];
    return kind === 'timber' ? 'timber' : kind === 'stone' ? 'stone' : kind === 'roof' ? `roof${w.owner}` : 'plaster';
  }

  /** Throw `n` pieces of the building outwards from where it stood. */
  private spawnDebris(w: Wreck, n: number, strength: number) {
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const kind: Kind = r < 0.38 ? 'timber' : r < 0.6 ? 'stone' : r < 0.8 ? 'roof' : 'wall';
      const key = this.pickKey(w, kind);
      const pool = this.pool(key);
      if (pool.chunks.length >= CAP) continue;
      let sx: number, sy: number, sz: number, hot = 0;
      if (kind === 'timber') { sx = 0.35 + Math.random() * 0.4; sy = 0.07; sz = 0.07 + Math.random() * 0.04; if (Math.random() < 0.55) hot = 3 + Math.random() * 7; }
      else if (kind === 'stone') { sx = 0.16 + Math.random() * 0.14; sy = 0.12 + Math.random() * 0.08; sz = 0.16 + Math.random() * 0.14; }
      else if (kind === 'roof') {
        if (key === 'thatch') { sx = 0.3 + Math.random() * 0.2; sy = 0.12; sz = 0.3 + Math.random() * 0.2; hot = 4 + Math.random() * 4; }
        else { sx = 0.22 + Math.random() * 0.16; sy = 0.035; sz = 0.2 + Math.random() * 0.12; }
      } else { sx = 0.2 + Math.random() * 0.22; sy = 0.06; sz = 0.15 + Math.random() * 0.16; }
      const a = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * w.size * 0.48;
      const hy = kind === 'roof' ? 0.65 + Math.random() * 0.35 : kind === 'stone' ? Math.random() * 0.35 : 0.15 + Math.random() * 0.7;
      const sp = ((kind === 'roof' ? 1.3 : 0.8) + Math.random() * 1.6) * strength;
      const up = ((kind === 'roof' ? 2.2 : 1.0) + Math.random() * 2.6) * strength;
      pool.chunks.push({
        x: w.x + Math.cos(a) * rad, y: w.y + hy * w.height * 0.75 + 0.1, z: w.z + Math.sin(a) * rad,
        vx: Math.cos(a) * sp + (Math.random() - 0.5) * 1.2, vy: up, vz: Math.sin(a) * sp + (Math.random() - 0.5) * 1.2,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3)),
        wx: (Math.random() - 0.5) * 14, wy: (Math.random() - 0.5) * 14, wz: (Math.random() - 0.5) * 14,
        sx, sy, sz, settled: 0,
        flat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6.3, 0)),
        hot, hot0: hot, life: 20 + Math.random() * 12, sink: 0,
      });
    }
  }

  private makeScorch(w: Wreck) {
    const mat = this.scorchMaterial();
    const mesh = new THREE.Mesh(this.scorchGeo, mat);
    const r = (w.size - 1) / 2 + 0.45;
    mesh.scale.set(r, 1, r);
    mesh.position.set(w.x, w.y + 0.03, w.z);
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.scorches.push({ mesh, mat, t: 0, life: 42 });
  }

  /** The roof gives way: debris flies, dust rolls out from the foot of the walls, embers go up in a column. */
  private collapse(w: Wreck, near: boolean, closeness: number) {
    const strength = 0.8 + w.size * 0.15;
    this.spawnDebris(w, Math.round(14 + w.size * w.size * 4.5), strength);
    if (!w.mine) this.makeScorch(w);
    if (!near) return;
    const P = this.particles;
    const { x, z, size } = w;
    const gy = w.y;
    // a ring of dust rolling outwards along the ground
    const n = 40 + size * 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, r = size * 0.5;
      const sp = (2.4 + Math.random() * 2.2) * strength;
      P.emit({ x: x + Math.cos(a) * r, y: gy + 0.15, z: z + Math.sin(a) * r, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.4 + Math.random() * 0.5, spread: 0.5, life: 1.8, size: 0.55, grow: 3.2, color: [0.42, 0.37, 0.31], color2: [0.5, 0.46, 0.4], alpha: 0.6, drag: 1.7, jitter: 0.3 });
    }
    // a boiling cloud of soot over the wreck
    P.emit({ x, y: gy + 0.6, z, vy: 2.2, spread: 2.2, vspread: 1.6, life: 3.2, size: 0.7, grow: 2.8, color: [0.2, 0.18, 0.16], color2: [0.42, 0.4, 0.38], alpha: 0.6, drag: 0.9, count: 24 + size * 8, jitter: size * 0.8 });
    // the fireball as the roof falls into the flames
    P.emit({ x, y: gy + 0.8, z, vy: 3.0, spread: 1.8, vspread: 1.4, life: 0.7, size: 0.7 * strength, grow: 1.6, color: [2.0, 0.9, 0.3], color2: [1.0, 0.2, 0.03], alpha: 0.6, drag: 1.5, count: 8 + size * 3, additive: true, jitter: size * 0.6 });
    // sparks thrown up in a column, and embers that drift
    P.emit({ x, y: gy + 0.5, z, vy: 5, spread: 3, vspread: 3.5, life: 1.3, size: 0.06, color: [2.4, 1.4, 0.5], color2: [1.4, 0.35, 0.05], alpha: 1, gravity: 4, drag: 0.8, count: 90 + size * 20, additive: true, kind: 1, jitter: size * 0.6 });
    P.emit({ x, y: gy + 1, z, vy: 2.5, spread: 1.8, vspread: 1.5, life: 3, size: 0.045, color: [2.2, 1.1, 0.3], color2: [1, 0.25, 0.04], alpha: 1, gravity: -0.15, drag: 0.6, count: 50, additive: true, kind: 1, jitter: size * 0.7 });
    this.onImpact(x, gy + 1.5, z, 0.02 + 0.04 * closeness, (0.7 + size * 0.2) * (0.4 + 0.6 * closeness));
    this.sound('collapse', x, z, 1);
  }

  update(dt: number, camX: number, camZ: number, viewSize: number) {
    const g = this.game;
    const w = g.world;
    const P = this.particles;
    this.emitT -= dt;
    const tick = this.emitT <= 0;
    if (tick) this.emitT = 0.12;
    const R = viewSize * 1.4;

    // ---- burning buildings
    for (const id of [...this.wrecks.keys()]) {
      const b = g.buildings.get(id);
      if (!b || b.state !== 'burning') this.wrecks.delete(id);
    }
    for (const b of g.buildings.values()) {
      if (b.state !== 'burning') continue;
      const v = this.buildings.views.get(b.id);
      let wr = this.wrecks.get(b.id);
      if (!wr) {
        const keys = new Set<string>();
        v?.group.traverse((o) => { const k = (o as THREE.Mesh).userData?.matKey; if (k) keys.add(k); });
        const tc = collapseAt(b.id);
        wr = {
          id: b.id, owner: b.owner, x: b.cx, z: b.cz, y: v ? v.baseY : b.targetH, size: b.size, height: v?.height ?? 1.5, tc, keys,
          collapsed: b.burnT >= tc, creaks: b.burnT >= tc ? 2 : 0, flareT: 0.5, emit: 0, mine: !!b.def.mine,
        };
        this.wrecks.set(b.id, wr);
      }
      const d = Math.hypot(b.cx - camX, b.cz - camZ);
      const near = d < R && !!v?.group.visible;
      const closeness = Math.max(0, 1 - d / R);
      const p = burnPose(b.burnT, wr.tc);
      if (!wr.collapsed && b.burnT >= wr.tc) {
        wr.collapsed = true;
        this.collapse(wr, near, closeness);
      }
      if (!wr.collapsed) {
        // the frame groans twice before it gives, shaking embers loose
        const due = b.burnT > wr.tc - 0.5 ? 2 : b.burnT > wr.tc - 1.3 ? 1 : 0;
        while (wr.creaks < due) {
          wr.creaks++;
          if (near) {
            this.sound('creak', wr.x, wr.z, 0.8);
            P.sparks(wr.x + (Math.random() - 0.5) * wr.size * 0.6, wr.y + wr.height, wr.z + (Math.random() - 0.5) * wr.size * 0.6, 14);
            this.onImpact(wr.x, wr.y + 1, wr.z, 0, 0.12 * closeness);
          }
        }
      }
      if (!near) continue;
      const { x, z, size } = wr;
      // where the structure is now: it crumples as it drops, then settles into the ground (the pose in buildings.ts)
      const base = wr.y - (p.drop * 0.2 + p.sink * 0.6) * wr.height;
      const top = Math.max(wr.y + 0.15, base + wr.height * (1 - 0.55 * p.drop));
      const hNow = top - wr.y;
      // flames over the whole structure, thickest while it still stands
      wr.emit += p.fire * (28 + size * 14) * (1 - p.sink * 0.6) * dt;
      const nFl = Math.floor(wr.emit);
      wr.emit -= nFl;
      for (let i = 0; i < nFl; i++) {
        this.flame(x + (Math.random() - 0.5) * size * 0.9, wr.y + 0.05 + Math.random() * hNow, z + (Math.random() - 0.5) * size * 0.9, 0.7 + 0.6 * p.fire * (1 - p.drop * 0.4));
      }
      // fire licking out of the windows and chimneys
      if (v && p.drop < 0.5) {
        const sy = 1 - 0.55 * p.drop;
        for (const a of v.anchors.windows) if (Math.random() < p.fire * 7 * dt) P.fire(x + a.x, base + a.y * sy, z + a.z, 0.5);
        for (const a of v.anchors.chimneys) if (Math.random() < p.fire * 10 * dt) P.fire(x + a.x, base + a.y * sy, z + a.z, 0.7);
      }
      // a column of black smoke, greying to ash smoke as the fire dies down
      if (tick) {
        const dark = 0.95 - p.sink * 0.55;
        const big = 2.4 + size * 0.5 - p.sink * 1.2;
        const n = 1 + Math.round(p.fire * size * 0.8);
        for (let k = 0; k < n; k++) this.soot(x + (Math.random() - 0.5) * size * 0.6, top + 0.4, z + (Math.random() - 0.5) * size * 0.6, big * 0.55, dark);
      }
      // embers carried up on the heat
      if (Math.random() < p.fire * 12 * dt) P.emit({ x, y: top - hNow * 0.2, z, vy: 1.6 + Math.random(), spread: 0.8, life: 2.2, size: 0.04, color: [2.4, 1.2, 0.3], color2: [1.2, 0.3, 0.05], alpha: 1, gravity: -0.35, drag: 0.5, jitter: size * 0.7, additive: true, kind: 1 });
      // flare-ups along the roof line
      wr.flareT -= dt;
      if (wr.flareT <= 0) {
        wr.flareT = 0.7 + Math.random() * 0.8;
        if (p.fire > 0.5 && !wr.collapsed) P.sparks(x + (Math.random() - 0.5) * size * 0.7, top, z + (Math.random() - 0.5) * size * 0.7, 10);
      }
    }

    // ---- debris in flight and rubble at rest
    for (const pool of this.pools.values()) {
      const cs = pool.chunks;
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i];
        if (c.settled === 0) {
          c.vy -= 9.5 * dt;
          c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
          c.x = Math.min(w.W - 1, Math.max(1, c.x));
          c.z = Math.min(w.H - 1, Math.max(1, c.z));
          tmpE.set(c.wx * dt, c.wy * dt, c.wz * dt);
          c.q.multiply(tmpQ.setFromEuler(tmpE));
          const gh = w.heightAt(c.x, c.z) + c.sy * 0.5 + 0.02;
          if (c.y <= gh) {
            c.y = gh;
            if (c.vy < -1.2) {
              // bounce
              c.vy *= -0.32; c.vx *= 0.55; c.vz *= 0.55; c.wx *= 0.4; c.wy *= 0.4; c.wz *= 0.4;
              const d = Math.hypot(c.x - camX, c.z - camZ);
              if (d < R && Math.random() < 0.5) P.dust(c.x, gh, c.z, 2, [0.5, 0.45, 0.38]);
            } else {
              c.vy = 0;
              const f = Math.exp(-7 * dt);
              c.vx *= f; c.vz *= f; c.wx *= f; c.wy *= f; c.wz *= f;
              if (Math.hypot(c.vx, c.vz) < 0.12) c.settled = 1e-3;
            }
          }
        } else {
          c.settled += dt;
          c.q.slerp(c.flat, Math.min(1, dt * 8));
          c.life -= dt;
          if (c.life <= 0) {
            c.sink += dt / 4;
            if (c.sink >= 1) { cs.splice(i, 1); continue; }
          }
        }
        if (c.hot > 0) {
          c.hot -= dt;
          const d = Math.hypot(c.x - camX, c.z - camZ);
          if (d < R) {
            const k = Math.min(1, c.hot / 1.5);
            if (Math.random() < k * 11 * dt) P.fire(c.x, c.y + c.sy * 0.5, c.z, 0.28 + 0.14 * k);
            if (Math.random() < dt) P.smoke(c.x, c.y + 0.1, c.z, 0.55, 0.55);
          }
        }
      }
      // write the instances
      const m = pool.mesh;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        tmpP.set(c.x, c.y - c.sink * (c.sy + 0.2), c.z);
        tmpS.set(c.sx, c.sy, c.sz);
        m.setMatrixAt(i, tmpM.compose(tmpP, c.q, tmpS));
        const ch = c.hot0 > 0 ? 1 - c.hot / c.hot0 : 0;
        m.setColorAt(i, tmpC.copy(SOOT_COL).lerp(CHAR_COL, ch * 0.85));
      }
      commitInstances(m, cs.length);
    }

    // ---- scorch marks fade in, linger, fade out
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i];
      s.t += dt;
      if (s.t > s.life) {
        this.group.remove(s.mesh);
        s.mat.dispose();
        this.scorches.splice(i, 1);
        continue;
      }
      s.mat.opacity = 0.7 * Math.min(1, s.t / 1.5) * Math.min(1, (s.life - s.t) / 8);
    }
  }
}
