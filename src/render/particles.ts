// CPU-simulated soft particles rendered as point sprites (normal + additive layers).
import * as THREE from 'three';
import { G } from './shaderPatch';

export interface EmitOpts {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  spread?: number; vspread?: number;
  life?: number; size?: number; grow?: number;
  color?: [number, number, number]; color2?: [number, number, number];
  alpha?: number; gravity?: number; drag?: number;
  additive?: boolean; count?: number; jitter?: number;
  kind?: number; // 0 soft blob, 1 hard spark, 2 streak
}

class Layer {
  max: number;
  n = 0;
  pos: Float32Array; vel: Float32Array; col: Float32Array; col2: Float32Array;
  age: Float32Array; life: Float32Array; size: Float32Array; grow: Float32Array; alpha: Float32Array;
  grav: Float32Array; drag: Float32Array; rot: Float32Array; kind: Float32Array;
  geo: THREE.BufferGeometry;
  points: THREE.Points;
  private aPos: THREE.BufferAttribute; private aCol: THREE.BufferAttribute; private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute; private aRot: THREE.BufferAttribute; private aKind: THREE.BufferAttribute;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3); this.col2 = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.size = new Float32Array(max);
    this.grow = new Float32Array(max); this.alpha = new Float32Array(max); this.grav = new Float32Array(max);
    this.drag = new Float32Array(max); this.rot = new Float32Array(max); this.kind = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('pcolor', this.aCol);
    this.geo.setAttribute('psize', this.aSize);
    this.geo.setAttribute('palpha', this.aAlpha);
    this.geo.setAttribute('prot', this.aRot);
    this.geo.setAttribute('pkind', this.aKind);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uScale: { value: 800 },
        tNoise: G.tNoise,
        uNight: G.uNight,
        uAdd: { value: additive ? 1 : 0 },
        tFog: G.tFog,
        uMapSize: G.uMapSize,
        uAmbient: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 pcolor; attribute float psize; attribute float palpha; attribute float prot; attribute float pkind;
        varying vec3 vCol; varying float vAlpha; varying float vRot; varying float vKind; varying float vFog;
        uniform float uScale; uniform sampler2D tFog; uniform vec2 uMapSize;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = psize * uScale / max(0.5, -mv.z);
          vCol = pcolor; vAlpha = palpha; vRot = prot; vKind = pkind;
          vFog = texture2D(tFog, (position.xz + 0.5) / uMapSize).r;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vAlpha; varying float vRot; varying float vKind; varying float vFog;
        uniform sampler2D tNoise; uniform float uAdd; uniform vec3 uAmbient;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          uv = mat2(c, -s, s, c) * uv;
          float d = length(uv);
          float a;
          if (vKind < 0.5) {
            float n = texture2D(tNoise, uv * 0.35 + vec2(vRot * 0.1, vRot * 0.07)).r;
            a = (1.0 - smoothstep(0.1, 0.5, d + (n - 0.5) * 0.35));
          } else if (vKind < 1.5) {
            a = (1.0 - smoothstep(0.0, 0.5, d));
            a = a * a;
          } else {
            a = (1.0 - smoothstep(0.0, 0.08, abs(uv.x))) * (1.0 - smoothstep(0.2, 0.5, abs(uv.y)));
          }
          a *= vAlpha * smoothstep(0.1, 0.6, vFog);
          if (a < 0.003) discard;
          vec3 col = uAdd > 0.5 ? vCol : vCol * uAmbient;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(o: EmitOpts) {
    const count = o.count ?? 1;
    for (let k = 0; k < count; k++) {
      let i: number;
      if (this.n < this.max) i = this.n++;
      else {
        // replace the oldest-ish particle
        i = Math.floor(Math.random() * this.max);
      }
      const sp = o.spread ?? 0, vs = o.vspread ?? sp, j = o.jitter ?? 0;
      this.pos[i * 3] = o.x + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 1] = o.y + (Math.random() - 0.5) * j * 0.5;
      this.pos[i * 3 + 2] = o.z + (Math.random() - 0.5) * j;
      this.vel[i * 3] = (o.vx ?? 0) + (Math.random() - 0.5) * sp;
      this.vel[i * 3 + 1] = (o.vy ?? 0) + (Math.random() - 0.5) * vs;
      this.vel[i * 3 + 2] = (o.vz ?? 0) + (Math.random() - 0.5) * sp;
      const c = o.color ?? [1, 1, 1], c2 = o.color2 ?? c;
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
      this.col2[i * 3] = c2[0]; this.col2[i * 3 + 1] = c2[1]; this.col2[i * 3 + 2] = c2[2];
      this.age[i] = 0;
      this.life[i] = (o.life ?? 1) * (0.75 + Math.random() * 0.5);
      this.size[i] = (o.size ?? 0.3) * (0.8 + Math.random() * 0.4);
      this.grow[i] = o.grow ?? 0;
      this.alpha[i] = o.alpha ?? 1;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0.5;
      this.rot[i] = Math.random() * 6.28;
      this.kind[i] = o.kind ?? 0;
    }
  }

  update(dt: number, wind: THREE.Vector2) {
    let n = this.n;
    const p = this.pos, v = this.vel;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      v[i * 3] = v[i * 3] * dr + wind.x * 0.25 * dt * (this.kind[i] === 0 ? 1 : 0.1);
      v[i * 3 + 1] = v[i * 3 + 1] * dr - this.grav[i] * dt;
      v[i * 3 + 2] = v[i * 3 + 2] * dr + wind.y * 0.25 * dt * (this.kind[i] === 0 ? 1 : 0.1);
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      this.rot[i] += dt * 0.3;
    }
    this.n = n;
    const ap = this.aPos.array as Float32Array, ac = this.aCol.array as Float32Array;
    const as = this.aSize.array as Float32Array, aa = this.aAlpha.array as Float32Array;
    const ar = this.aRot.array as Float32Array, ak = this.aKind.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      ap[i * 3] = p[i * 3]; ap[i * 3 + 1] = p[i * 3 + 1]; ap[i * 3 + 2] = p[i * 3 + 2];
      ac[i * 3] = this.col[i * 3] + (this.col2[i * 3] - this.col[i * 3]) * t;
      ac[i * 3 + 1] = this.col[i * 3 + 1] + (this.col2[i * 3 + 1] - this.col[i * 3 + 1]) * t;
      ac[i * 3 + 2] = this.col[i * 3 + 2] + (this.col2[i * 3 + 2] - this.col[i * 3 + 2]) * t;
      as[i] = this.size[i] * (1 + this.grow[i] * t);
      const fadeIn = Math.min(1, t * 8);
      aa[i] = this.alpha[i] * fadeIn * (1 - t) * (1 - t * 0.3);
      ar[i] = this.rot[i];
      ak[i] = this.kind[i];
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true; this.aRot.needsUpdate = true; this.aKind.needsUpdate = true;
    this.geo.setDrawRange(0, n);
  }

  private copy(from: number, to: number) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
      this.col[to * 3 + k] = this.col[from * 3 + k];
      this.col2[to * 3 + k] = this.col2[from * 3 + k];
    }
    this.age[to] = this.age[from]; this.life[to] = this.life[from]; this.size[to] = this.size[from];
    this.grow[to] = this.grow[from]; this.alpha[to] = this.alpha[from]; this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from]; this.rot[to] = this.rot[from]; this.kind[to] = this.kind[from];
  }
}

export class Particles {
  group = new THREE.Group();
  normal: Layer;
  add: Layer;
  constructor() {
    this.normal = new Layer(6000, false);
    this.add = new Layer(4000, true);
    this.group.add(this.normal.points, this.add.points);
  }
  setScale(pxScale: number) {
    (this.normal.points.material as THREE.ShaderMaterial).uniforms.uScale.value = pxScale;
    (this.add.points.material as THREE.ShaderMaterial).uniforms.uScale.value = pxScale;
  }
  setAmbient(c: THREE.Color) {
    ((this.normal.points.material as THREE.ShaderMaterial).uniforms.uAmbient.value as THREE.Color).copy(c);
  }
  emit(o: EmitOpts) {
    (o.additive ? this.add : this.normal).emit(o);
  }
  update(dt: number, wind: THREE.Vector2) {
    this.normal.update(dt, wind);
    this.add.update(dt, wind);
  }

  // ---- presets
  smoke(x: number, y: number, z: number, dark = 0.0, big = 1) {
    const g = 0.72 - dark * 0.45;
    this.emit({ x, y, z, vy: 0.55 * big, spread: 0.12, life: 4.5 * big, size: 0.32 * big, grow: 3.2, color: [g, g, g * 1.02], color2: [g * 0.9, g * 0.9, g * 0.95], alpha: 0.42, drag: 0.35, jitter: 0.08 });
  }
  dust(x: number, y: number, z: number, n = 6, col: [number, number, number] = [0.55, 0.45, 0.32]) {
    this.emit({ x, y: y + 0.08, z, vy: 0.4, spread: 1.1, vspread: 0.4, life: 1.2, size: 0.28, grow: 2.2, color: col, alpha: 0.45, drag: 2.2, count: n, jitter: 0.3 });
  }
  chips(x: number, y: number, z: number) {
    this.emit({ x, y: y + 0.45, z, vy: 1.5, spread: 1.8, vspread: 0.8, life: 0.9, size: 0.05, color: [0.75, 0.58, 0.36], alpha: 1, gravity: 6, drag: 0.5, count: 6, kind: 1 });
  }
  sparks(x: number, y: number, z: number, n = 8) {
    this.emit({ x, y, z, vy: 1.4, spread: 2.2, vspread: 1.2, life: 0.55, size: 0.05, color: [1.6, 0.9, 0.35], color2: [1.2, 0.35, 0.05], alpha: 1, gravity: 5, drag: 1, count: n, additive: true, kind: 1 });
  }
  fire(x: number, y: number, z: number, s = 1) {
    this.emit({ x, y, z, vy: 1.5 * s, spread: 0.3 * s, vspread: 0.4, life: 0.55, size: 0.42 * s, grow: -0.55, color: [3.2, 2.0, 0.8], color2: [1.6, 0.35, 0.06], alpha: 0.9, drag: 1.2, jitter: 0.55 * s, additive: true, kind: 3 });
    if (Math.random() < 0.15 * s) this.emit({ x, y: y + 0.3, z, vy: 1.8, spread: 0.8, vspread: 0.6, life: 1.4, size: 0.035, color: [2.4, 1.2, 0.3], color2: [1.2, 0.3, 0.05], alpha: 1, gravity: -0.4, drag: 0.6, jitter: 0.5 * s, additive: true, kind: 1 });
  }
  splash(x: number, y: number, z: number) {
    this.emit({ x, y, z, vy: 1.8, spread: 1.2, vspread: 0.6, life: 0.7, size: 0.06, color: [0.85, 0.92, 1], alpha: 0.9, gravity: 7, drag: 0.4, count: 10, kind: 1 });
    this.emit({ x, y: y + 0.02, z, life: 1.0, size: 0.5, grow: 1.5, color: [0.9, 0.95, 1], alpha: 0.35, drag: 3, count: 1 });
  }
  sparkle(x: number, y: number, z: number, n = 30, col: [number, number, number] = [2.0, 1.6, 0.6]) {
    this.emit({ x, y, z, vy: 1.2, spread: 2.4, vspread: 1.8, life: 1.6, size: 0.1, color: col, color2: [col[0] * 0.6, col[1] * 0.4, col[2] * 0.3], alpha: 1, gravity: -0.3, drag: 1.5, count: n, additive: true, kind: 1, jitter: 1.2 });
  }
  leaves(x: number, y: number, z: number, n = 12) {
    this.emit({ x, y: y + 1.2, z, vy: 0.4, spread: 1.6, vspread: 0.6, life: 2.4, size: 0.08, color: [0.35, 0.55, 0.18], color2: [0.45, 0.5, 0.15], alpha: 1, gravity: 0.8, drag: 1.4, count: n, kind: 1, jitter: 0.8 });
  }
  hit(x: number, y: number, z: number) {
    this.emit({ x, y, z, vy: 0.8, spread: 1.6, life: 0.35, size: 0.08, color: [2, 1.8, 1.2], alpha: 1, gravity: 3, drag: 2, count: 6, additive: true, kind: 1 });
  }
  firefly(x: number, y: number, z: number) {
    this.emit({ x, y, z, vy: 0.05, spread: 0.3, vspread: 0.15, life: 3.5, size: 0.07, color: [1.2, 1.8, 0.5], color2: [0.6, 1.0, 0.2], alpha: 1, drag: 0.2, additive: true, kind: 1 });
  }
}
