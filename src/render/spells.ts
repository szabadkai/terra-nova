// Divine spell effects: lightning, light pillars, temple beams, storm clouds, the terrain rune circle
// and the ice that holds the soldiers Winter's Grasp has seized.
import * as THREE from 'three';
import type { Game } from '../game/game';
import type { GameEvent } from '../game/types';
import { FREEZE_TIME, SPELLS, SpellId } from '../game/faith';
import { WATER_LEVEL } from '../game/world';
import { hash2 } from '../core/rng';
import { G } from './shaderPatch';
import { commitInstances } from './instancing';
import type { Particles } from './particles';

// ------------------------------------------------------------------ lightning ribbons
const BOLT_VS = /* glsl */ `
  attribute vec3 aDir; attribute float aSide; attribute float aWidth;
  varying float vSide;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 d = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz);
    vec3 s = normalize(cross(d, normalize(mv.xyz)));
    mv.xyz += s * aSide * aWidth;
    gl_Position = projectionMatrix * mv;
    vSide = aSide;
  }`;
const BOLT_FS = /* glsl */ `
  uniform float uI; uniform vec3 uCol; varying float vSide;
  void main() {
    float x = min(abs(vSide), 1.0);
    float core = 1.0 - smoothstep(0.0, 0.28, x);
    float glow = pow(max(1.0 - x, 0.0), 2.2);
    gl_FragColor = vec4((uCol * glow * 2.5 + vec3(1.0) * core * 7.0) * uI, 1.0);
  }`;

function jag(a: THREE.Vector3, b: THREE.Vector3, levels: number, disp: number): THREE.Vector3[] {
  let pts = [a.clone(), b.clone()];
  let d = disp;
  for (let l = 0; l < levels; l++) {
    const out: THREE.Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const len = p.distanceTo(q);
      const m = p.clone().lerp(q, 0.5 + (Math.random() - 0.5) * 0.2);
      m.x += (Math.random() - 0.5) * len * d;
      m.z += (Math.random() - 0.5) * len * d;
      m.y += (Math.random() - 0.5) * len * d * 0.25;
      out.push(m, q);
    }
    pts = out;
    d *= 0.62;
  }
  return pts;
}

function ribbon(lines: { pts: THREE.Vector3[]; w: number }[]): THREE.BufferGeometry {
  const pos: number[] = [], dir: number[] = [], side: number[] = [], width: number[] = [], idx: number[] = [];
  let base = 0;
  for (const { pts, w } of lines) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const taper = w * (0.55 + 0.45 * (1 - i / pts.length));
      for (const s of [-1, 1]) {
        pos.push(p.x, p.y, p.z);
        dir.push(dx, dy, dz);
        side.push(s);
        width.push(taper);
      }
      if (i < pts.length - 1) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    base += pts.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aWidth', new THREE.Float32BufferAttribute(width, 1));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ light pillars
const PILLAR_VS = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const PILLAR_FS = /* glsl */ `
  uniform float uI; uniform vec3 uCol; uniform float uTime; uniform sampler2D tNoise; uniform float uFadeTop;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    float v = vUv.y;
    float fade = (1.0 - smoothstep(uFadeTop, 1.0, v)) * smoothstep(0.0, 0.03, v);
    float streak = texture2D(tNoise, vec2(vUv.x * 2.0, v * 0.5 - uTime * 0.3)).r;
    float streak2 = texture2D(tNoise, vec2(vUv.x * 5.0 + 0.3, v * 1.3 - uTime * 0.55)).g;
    float edge = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.6);
    float a = (0.05 + edge * 0.9) * (0.35 + streak * 0.8 + streak2 * 0.5) * fade * uI;
    gl_FragColor = vec4(uCol * a, 1.0);
  }`;

interface Fx { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; life: number; kind: 'bolt' | 'pillar'; r: number; peak: number; hold: number; }

interface Rune { x: number; z: number; r: number; col: THREE.Color; t: number; life: number; }

/** A six-sided ice crystal with a pointed cap, a little taller than a settler. */
function crystalGeo() {
  const g = new THREE.LatheGeometry([
    new THREE.Vector2(0.0, -0.02), new THREE.Vector2(0.4, 0.0), new THREE.Vector2(0.36, 0.78),
    new THREE.Vector2(0.2, 1.08), new THREE.Vector2(0.0, 1.22),
  ], 6);
  return g.toNonIndexed();
}
const ICE_MAX = 64;

export class SpellFX {
  group = new THREE.Group();
  private fx: Fx[] = [];
  private runes: Rune[] = [];
  private storms: { x: number; z: number; t: number; life: number }[] = [];
  private blizzards: { x: number; z: number; r: number; t: number; life: number }[] = [];
  /** game time until which some soldier may still be frozen (checked again now and then, for loaded games) */
  private frostUntil = 0;
  private frostScanT = 0;
  private ice: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private flash = { x: 0, y: 0, z: 0, i: 0, col: new THREE.Color() };
  private pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
  preview: { x: number; z: number; r: number; col: THREE.Color; ok: boolean } | null = null;

  constructor(
    private game: Game,
    private particles: Particles,
    private terrainU: Record<string, THREE.IUniform>,
    private onFlash: (amount: number, shake: number) => void,
  ) {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.72, 0.88, 1.0), emissive: new THREE.Color(0.1, 0.22, 0.36), roughness: 0.08, metalness: 0.1,
      transparent: true, opacity: 0.5, depthWrite: false, flatShading: true, side: THREE.DoubleSide,
    });
    this.ice = new THREE.InstancedMesh(crystalGeo(), mat, ICE_MAX);
    this.ice.count = 0;
    this.ice.visible = false;
    this.ice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ice.frustumCulled = false;
    this.ice.renderOrder = 5;
    this.group.add(this.ice);
  }

  private ground(x: number, z: number) {
    return this.game.world.heightAt(x, z);
  }

  private makePillar(x: number, y: number, z: number, r: number, h: number, col: THREE.Color, life: number, hold: number, peak = 1, fadeTop = 0.35) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 }, uCol: { value: col.clone() }, uTime: G.uTime, tNoise: G.tNoise, uFadeTop: { value: fadeTop } },
      vertexShader: PILLAR_VS, fragmentShader: PILLAR_FS,
    });
    const mesh = new THREE.Mesh(this.pillarGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(0.01, h, 0.01);
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.fx.push({ mesh, mat, t: 0, life, kind: 'pillar', r, peak, hold });
  }

  private makeBolt(x: number, z: number, col: THREE.Color) {
    const gy = this.ground(x, z);
    const top = new THREE.Vector3(x + (Math.random() - 0.5) * 6, gy + 20 + Math.random() * 4, z + (Math.random() - 0.5) * 6);
    const bottom = new THREE.Vector3(x, gy, z);
    const trunk = jag(top, bottom, 6, 0.55);
    const lines = [{ pts: trunk, w: 0.2 }];
    const nb = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < nb; k++) {
      const i = Math.floor(trunk.length * (0.15 + Math.random() * 0.5));
      const s = trunk[i];
      const len = (s.y - gy) * (0.3 + Math.random() * 0.3);
      const a = Math.random() * Math.PI * 2;
      const e = new THREE.Vector3(s.x + Math.cos(a) * len * 0.7, s.y - len, s.z + Math.sin(a) * len * 0.7);
      lines.push({ pts: jag(s, e, 4, 0.6), w: 0.08 });
    }
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 1 }, uCol: { value: col.clone() } },
      vertexShader: BOLT_VS, fragmentShader: BOLT_FS,
    });
    const mesh = new THREE.Mesh(ribbon(lines), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    this.group.add(mesh);
    this.fx.push({ mesh, mat, t: 0, life: 0.45, kind: 'bolt', r: 0, peak: 1, hold: 0 });
    this.flashAt(x, gy + 3, z, 9, col);
  }

  /** The one bright transient world light: the stronger request wins. */
  flashAt(x: number, y: number, z: number, i: number, col: THREE.Color) {
    if (i < this.flash.i) return;
    this.flash.x = x; this.flash.y = y; this.flash.z = z; this.flash.i = i;
    this.flash.col.copy(col);
  }

  /** Storm lightning: a bolt striking the ground at (x, z), or only the far-off flash of one. */
  lightning(x: number, z: number, near: boolean) {
    if (near) {
      this.makeBolt(x, z, new THREE.Color(0.65, 0.75, 1.0));
      this.onFlash(0.14, 0.3);
    } else {
      this.flashAt(x, this.ground(x, z) + 35, z, 40, new THREE.Color(0.6, 0.7, 1.0));
      this.onFlash(0.04 + Math.random() * 0.06, 0);
    }
    // lightning flickers
    setTimeout(() => this.onFlash(near ? 0.06 : 0.03, 0), 60 + Math.random() * 90);
  }

  onEvent(e: GameEvent, sound: (name: string, vol?: number) => void) {
    const P = this.particles;
    const x = e.x ?? 0, z = e.z ?? 0;
    const y = this.ground(x, z);
    switch (e.type) {
      case 'spell': {
        const def = SPELLS[e.kind as SpellId];
        const col = new THREE.Color(...def.color);
        const long = e.kind === 'wrath' ? 5.5 : 3.6;
        this.runes.push({ x, z, r: def.radius, col, t: 0, life: long });
        if (e.kind === 'wrath') {
          this.storms.push({ x, z, t: 0, life: 5 });
        } else if (e.kind === 'freeze') {
          this.blizzards.push({ x, z, r: def.radius, t: 0, life: 2.6 });
          this.makePillar(x, y - 0.5, z, def.radius * 0.8, 10, col, 2.4, 1.2, 0.45);
        } else {
          this.makePillar(x, y - 0.5, z, def.radius * 0.8, 16, col, 2.8, 1.3, 0.7);
          this.makePillar(x, y - 0.5, z, 0.3, 30, col, 2.4, 1.3, 0.55, 0.6);
        }
        const b = e.b ? this.game.buildings.get(e.b) : undefined;
        if (b) {
          const by = this.ground(b.cx, b.cz);
          const top = b.type === 'greattemple' ? 3.4 : 1.8;
          this.makePillar(b.cx, by + top, b.cz - (b.type === 'greattemple' ? 0.15 : 0.2), 0.14, 40, new THREE.Color(1.6, 1.3, 0.7), 2.2, 1.0, 1.6, 0.5);
          P.sparkle(b.cx, by + top, b.cz, 30, [2.0, 1.7, 0.9]);
        }
        sound('chant');
        break;
      }
      case 'spellfx': {
        const def = SPELLS[e.kind as SpellId];
        const c = def.color;
        if (e.kind === 'harvest') {
          for (let k = 0; k < 90; k++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * def.radius;
            const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
            P.emit({ x: px, y: this.ground(px, pz) + 0.1, z: pz, vy: 0.8 + Math.random() * 0.8, spread: 0.3, life: 2.2, size: 0.07, color: [2.2, 1.8, 0.6], color2: [0.8, 1.4, 0.3], alpha: 1, gravity: -0.2, drag: 0.8, additive: true, kind: 1 });
          }
          P.leaves(x, y, z, 30);
          sound('chime');
        } else if (e.kind === 'heal') {
          this.ringBurst(x, y + 0.2, z, def.radius, [c[0] * 2, c[1] * 2, c[2] * 1.6]);
          sound('heal');
        } else if (e.kind === 'convert') {
          this.ringBurst(x, y + 0.2, z, def.radius, [c[0] * 1.5, c[1] * 2, c[2] * 2]);
          sound('chime');
        } else if (e.kind === 'eye') {
          // the fog parts: a ring runs out to the edge and motes rise all over the circle
          this.ringBurst(x, y + 0.3, z, def.radius, [c[0] * 1.8, c[1] * 1.8, c[2] * 2.2]);
          this.makePillar(x, y - 0.5, z, def.radius * 0.95, 6, new THREE.Color(...c), 2.2, 0.6, 0.5, 0.2);
          for (let k = 0; k < 140; k++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * def.radius;
            const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
            P.emit({ x: px, y: this.ground(px, pz) + 0.2, z: pz, vy: 1.2 + Math.random(), spread: 0.2, life: 1.8, size: 0.07, color: [1.6, 1.3, 2.4], alpha: 1, gravity: -0.4, drag: 0.6, additive: true, kind: 1 });
          }
          sound('chime');
        } else if (e.kind === 'gift') {
          // parcels drop out of the sky onto the storehouse roof
          for (let k = 0; k < 26; k++) {
            const px = x + (Math.random() - 0.5) * 2.4, pz = z + (Math.random() - 0.5) * 2.4;
            P.emit({ x: px, y: y + 9 + Math.random() * 5, z: pz, vy: -4, spread: 0.2, life: 1.6, size: 0.16, color: [1.8, 1.3, 0.9], color2: [1.2, 0.7, 1.0], alpha: 1, gravity: 5, drag: 0.4, additive: true, kind: 1 });
          }
          setTimeout(() => { P.sparkle(x, y + 2.2, z, 40, [2.2, 1.5, 1.8]); sound('coins', 0.7); }, 900);
          this.makePillar(x, y, z, 1.6, 12, new THREE.Color(...c), 2.0, 0.9, 0.8, 0.3);
          sound('chime');
        } else if (e.kind === 'fish') {
          // shoals break the surface all over the water in the circle
          const w = this.game.world;
          let n = 0;
          for (let k = 0; k < 400 && n < 26; k++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * def.radius;
            const px = Math.round(x + Math.cos(a) * d), pz = Math.round(z + Math.sin(a) * d);
            if (!w.inBounds(px, pz) || !w.isWater(w.idx(px, pz))) continue;
            n++;
            const dir = Math.random() * Math.PI * 2, delay = Math.random() * 1400;
            setTimeout(() => {
              P.splash(px, WATER_LEVEL, pz);
              P.emit({ x: px, y: WATER_LEVEL + 0.05, z: pz, vx: Math.cos(dir) * 0.9, vz: Math.sin(dir) * 0.9, vy: 2.6, life: 0.62, size: 0.09, color: [0.85, 0.9, 0.95], alpha: 1, gravity: 8.2, drag: 0, kind: 1 });
            }, delay);
            P.emit({ x: px, y: WATER_LEVEL + 0.1, z: pz, vy: 0.6, spread: 0.4, life: 1.4, size: 0.06, color: [0.8, 1.6, 2.4], alpha: 1, gravity: -0.2, drag: 0.8, additive: true, count: 3, kind: 1 });
          }
          this.ringBurst(x, WATER_LEVEL + 0.1, z, def.radius, [c[0] * 1.6, c[1] * 1.8, c[2] * 2.2]);
          sound('splash');
          setTimeout(() => sound('splash', 0.7), 500);
          sound('chime', 0.6);
        } else if (e.kind === 'forest') {
          for (let k = 0; k < 110; k++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * def.radius;
            const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
            P.emit({ x: px, y: this.ground(px, pz) + 0.05, z: pz, vy: 0.9 + Math.random() * 0.9, spread: 0.3, life: 2.0, size: 0.07, color: [0.9, 2.2, 0.6], color2: [1.6, 1.8, 0.5], alpha: 1, gravity: -0.25, drag: 0.8, additive: true, kind: 1 });
          }
          for (let k = 0; k < 5; k++) {
            const a = Math.random() * Math.PI * 2, d = Math.random() * def.radius * 0.8;
            const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
            P.leaves(px, this.ground(px, pz) + 0.6, pz, 10);
          }
          sound('chime');
        } else if (e.kind === 'midas') {
          this.ringBurst(x, y + 0.2, z, def.radius, [c[0] * 2.2, c[1] * 2, c[2] * 1.4]);
          sound('chime');
        } else if (e.kind === 'freeze') {
          this.ringBurst(x, y + 0.2, z, def.radius, [c[0] * 1.8, c[1] * 2, c[2] * 2.4]);
          P.emit({ x, y: y + 0.3, z, vy: 0.4, spread: def.radius * 0.9, vspread: 0.3, life: 2.4, size: 1.6, grow: 0.6, color: [0.82, 0.9, 1.0], alpha: 0.28, drag: 0.8, count: 22 });
          sound('frost');
        }
        this.flashAt(x, y + 2.5, z, 3, new THREE.Color(...c));
        break;
      }
      case 'transmuted': {
        // a storehouse full of iron turns to gold
        P.sparkle(x, y + 1.8, z, 45, [2.4, 1.8, 0.5]);
        P.emit({ x, y: y + 1.2, z, vy: 1.6, spread: 1.2, life: 1.2, size: 0.07, color: [2.4, 1.9, 0.6], alpha: 1, gravity: 1.5, drag: 0.6, additive: true, count: 30, kind: 1 });
        this.flashAt(x, y + 2.5, z, 4, new THREE.Color(1.0, 0.75, 0.25));
        sound('coins');
        break;
      }
      case 'frozen': {
        this.frostUntil = Math.max(this.frostUntil, this.game.time + FREEZE_TIME);
        P.sparkle(x, y + 0.7, z, 16, [1.6, 2.0, 2.4]);
        P.emit({ x, y: y + 0.4, z, vy: 0.2, spread: 0.6, life: 1.4, size: 0.5, grow: 0.5, color: [0.85, 0.92, 1.0], alpha: 0.3, drag: 1, count: 3 });
        break;
      }
      case 'thawed':
        P.smoke(x, y + 0.5, z, 0.0, 0.6);
        P.sparkle(x, y + 0.8, z, 12, [2.0, 1.9, 1.3]);
        sound('hiss', 0.5);
        break;
      case 'lightning': {
        this.makeBolt(x, z, new THREE.Color(0.6, 0.72, 1.0));
        P.sparks(x, y + 0.1, z, 26);
        P.emit({ x, y: y + 0.1, z, vy: 2.2, spread: 3.6, vspread: 1.4, life: 0.5, size: 0.06, color: [2.2, 2.5, 3.2], alpha: 1, gravity: 6, drag: 1, count: 18, additive: true, kind: 1 });
        P.dust(x, y, z, 14, [0.3, 0.28, 0.26]);
        P.smoke(x, y + 0.2, z, 0.9, 1.3);
        this.onFlash(0.1, 0.45);
        sound('thunder');
        break;
      }
      case 'healed':
        this.makePillar(x, y, z, 0.28, 2.6, new THREE.Color(1.6, 1.5, 0.9), 1.4, 0.3, 1.2, 0.3);
        P.sparkle(x, y + 1.0, z, 14, [2.0, 1.9, 1.2]);
        break;
      case 'converted':
        this.makePillar(x, y, z, 0.32, 4, new THREE.Color(0.7, 1.8, 1.6), 1.8, 0.4, 1.4, 0.4);
        P.sparkle(x, y + 0.8, z, 24, [0.8, 2.2, 2.0]);
        break;
      case 'offering': {
        // a thin wisp of holy smoke rises from the altar fires
        P.emit({ x, y: y + 1.6, z, vy: 1.4, spread: 0.3, life: 1.6, size: 0.08, color: [2.0, 1.7, 0.9], alpha: 1, gravity: -0.3, drag: 0.6, additive: true, count: 8, kind: 1, jitter: 0.8 });
        if (Math.random() < 0.5) sound('chime', 0.25);
        break;
      }
      case 'grapes':
        P.emit({ x, y: y + 0.35, z, vy: 0.5, spread: 0.8, life: 0.9, size: 0.04, color: [0.45, 0.1, 0.4], alpha: 1, gravity: 3, count: 6, kind: 1 });
        break;
    }
  }

  private ringBurst(x: number, y: number, z: number, r: number, col: [number, number, number]) {
    const n = 64;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.particles.emit({ x: x + Math.cos(a) * 0.3, y, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * r * 1.6, vz: Math.sin(a) * r * 1.6, vy: 0.3, life: 0.9, size: 0.12, color: col, alpha: 1, drag: 2.2, additive: true, kind: 1 });
    }
  }

  update(dt: number) {
    const P = this.particles;
    // pillars & bolts
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const t = f.t;
      if (t >= f.life) {
        this.group.remove(f.mesh);
        f.mat.dispose();
        if (f.kind === 'bolt') f.mesh.geometry.dispose();
        this.fx.splice(i, 1);
        continue;
      }
      if (f.kind === 'bolt') {
        const k = t / f.life;
        const flick = t < 0.06 ? 1 : t < 0.12 ? 0.25 : t < 0.2 ? 0.9 : 0.5 * (1 - k);
        f.mat.uniforms.uI.value = flick * (1 - k * 0.6);
      } else {
        const grow = 1 - Math.pow(1 - Math.min(1, t / 0.45), 3);
        const flare = t > f.hold ? Math.max(0, 1 - (t - f.hold) / 0.35) * 0.8 : 0;
        const out = t > f.hold ? Math.max(0, 1 - (t - f.hold) / (f.life - f.hold)) : 1;
        const r = f.r * (grow + (t > f.hold ? (t - f.hold) * 0.3 : 0));
        f.mesh.scale.x = f.mesh.scale.z = Math.max(0.01, r);
        f.mat.uniforms.uI.value = f.peak * (Math.min(1, t / 0.3) * out + flare);
        if (f.r > 1) this.flashAt(f.mesh.position.x, f.mesh.position.y + 2.5, f.mesh.position.z, 1.6 * out, f.mat.uniforms.uCol.value);
      }
    }
    // storm clouds gather over the target of a Wrath
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i];
      s.t += dt;
      if (s.t > s.life) { this.storms.splice(i, 1); continue; }
      const gy = this.ground(s.x, s.z);
      if (s.t < s.life - 1.2) {
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 6;
          P.emit({ x: s.x + Math.cos(a) * d, y: gy + 9 + Math.random() * 2, z: s.z + Math.sin(a) * d, vx: -Math.sin(a) * 0.8, vz: Math.cos(a) * 0.8, spread: 0.2, life: 3.5, size: 3.2, grow: 0.5, color: [0.13, 0.14, 0.18], alpha: 0.5, drag: 0.3 });
        }
        if (Math.random() < dt * 3) this.flashAt(s.x + (Math.random() - 0.5) * 6, gy + 10, s.z + (Math.random() - 0.5) * 6, 1.2, new THREE.Color(0.55, 0.65, 1.0));
      }
    }
    // a whirl of snow over the target of Winter's Grasp while the priests call it
    for (let i = this.blizzards.length - 1; i >= 0; i--) {
      const b = this.blizzards[i];
      b.t += dt;
      if (b.t > b.life) { this.blizzards.splice(i, 1); continue; }
      const gy = this.ground(b.x, b.z);
      const n = Math.ceil(dt * 90);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * b.r;
        P.emit({ x: b.x + Math.cos(a) * d, y: gy + 3 + Math.random() * 4, z: b.z + Math.sin(a) * d, vx: -Math.sin(a) * 2.2, vz: Math.cos(a) * 2.2, vy: -1.6, spread: 0.3, life: 2.2, size: 0.06, color: [0.95, 0.97, 1.0], alpha: 0.95, drag: 0.3, kind: 1 });
      }
    }
    this.updateIce(dt);
    // rune circle on the ground: the newest active spell, else the targeting preview
    const U = this.terrainU;
    let rune: Rune | null = null;
    for (let i = this.runes.length - 1; i >= 0; i--) {
      const r = this.runes[i];
      r.t += dt;
      if (r.t > r.life) { this.runes.splice(i, 1); continue; }
      if (!rune) rune = r;
    }
    if (rune) {
      const k = Math.min(1, rune.t / 0.5) * Math.min(1, (rune.life - rune.t) / 0.8);
      (U.uSpell.value as THREE.Vector4).set(rune.x, rune.z, rune.r * (0.85 + 0.15 * Math.min(1, rune.t / 0.6)), k * 0.8);
      (U.uSpellCol.value as THREE.Color).copy(rune.col);
    } else if (this.preview) {
      const p = this.preview;
      (U.uSpell.value as THREE.Vector4).set(p.x, p.z, p.r, p.ok ? 0.45 : 0.3);
      (U.uSpellCol.value as THREE.Color).copy(p.ok ? p.col : new THREE.Color(1, 0.25, 0.2));
    } else (U.uSpell.value as THREE.Vector4).w = 0;
    // one transient light for the whole world
    const F = this.flash;
    (G.uFlash.value as THREE.Vector4).set(F.x, F.y, F.z, F.i);
    (G.uFlashCol.value as THREE.Color).copy(F.col);
    F.i = Math.max(0, F.i - dt * (F.i > 3 ? 40 : 6));
  }

  /** Ice crystals around the frozen soldiers: they grow round them in a moment and melt away at the end. */
  private updateIce(dt: number) {
    const g = this.game;
    this.frostScanT -= dt;
    if (this.frostUntil <= g.time && this.frostScanT <= 0) {
      // a game loaded mid-frost sends no 'frozen' events
      this.frostScanT = 1;
      for (const s of g.settlers.values()) if (s.frozenUntil > g.time) this.frostUntil = Math.max(this.frostUntil, s.frozenUntil);
    }
    let n = 0;
    if (this.frostUntil > g.time) {
      const w = g.world;
      for (const s of g.settlers.values()) {
        if (n >= ICE_MAX) break;
        if (s.dead || s.hidden || s.frozenUntil <= g.time) continue;
        if (!w.explored[w.idx(Math.round(s.x), Math.round(s.z))] && s.owner !== g.local) continue;
        const left = s.frozenUntil - g.time, since = FREEZE_TIME - left;
        const k = Math.min(1, since / 0.35) * Math.min(1, left / 0.8);
        if (k <= 0.01) continue;
        const j = hash2(s.id, 3, 71);
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), j * Math.PI);
        this.sc.set(0.95 + j * 0.2, (1.0 + j * 0.15) * k, 0.95 + j * 0.2);
        this.m4.compose(this.v.set(s.x, w.heightAt(s.x, s.z), s.z), this.q, this.sc);
        this.ice.setMatrixAt(n++, this.m4);
        // frost glitters on the ice
        if (Math.random() < dt * 3) this.particles.sparkle(s.x, w.heightAt(s.x, s.z) + 0.3 + Math.random() * 0.8, s.z, 2, [1.6, 2.0, 2.6]);
      }
    }
    // (hidden while empty: a transparent double-sided material is drawn in two passes, each of which
    // has three look its program up again, empty or not; and only the crystals written are sent)
    commitInstances(this.ice, n);
  }

  /** True while any effect is running (lets callers keep the preview hidden). */
  get busy() {
    return this.fx.length > 0 || this.runes.length > 0;
  }
}
