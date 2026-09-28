// GPU rain: stateless drops in world-fixed tiles around the view. Each drop is a thin
// screen-space quad stretched along its projected velocity, so every streak slants the same
// way; when it reaches the ground it becomes a tiny splash (a ripple ring on water).
import * as THREE from 'three';
import { G } from './shaderPatch';
import { WATER_LEVEL } from '../game/world';

const TILE = 16; // world units per rain tile
const MAX_SIDE = 18; // tiles per side at the widest zoom
const MAX_PER_TILE = 480;
const HEIGHT = 14; // drops start this far above the spot they land on
export const RAIN_FALL = 11; // fall speed, units/s
const SPLASH = 0.45; // seconds a water ripple lasts (ground splashes are quicker)
const CYCLE = (HEIGHT + RAIN_FALL * SPLASH) / RAIN_FALL; // seconds per fall + splash
const WRAP = 2048; // cycles before the clock wraps (masked in the shader, so nothing jumps)

export class Rain {
  mesh: THREE.Mesh;
  /** horizontal drift of the drops, world units/s */
  drift = new THREE.Vector2();
  private geo: THREE.InstancedBufferGeometry;
  private u: Record<string, THREE.IUniform>;
  private t = 0;

  constructor(mapW: number, mapH: number) {
    const geo = new THREE.InstancedBufferGeometry();
    // x: -1/1 across the streak, y: 0 at the head (leading end), 1 at the tail
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    const n = MAX_SIDE * MAX_SIDE * MAX_PER_TILE;
    const ids = new Float32Array(n);
    for (let i = 0; i < n; i++) ids[i] = i;
    geo.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
    geo.instanceCount = 0;
    this.geo = geo;
    this.u = {
      uTime: { value: 0 },
      uTile0: { value: new THREE.Vector2() },
      uSide: { value: 1 },
      uDrift: { value: new THREE.Vector2() },
      uInt: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uPx: { value: 800 },
      uMinPx: { value: 1 },
      uAlpha: { value: 0.4 },
      uAmbient: { value: new THREE.Color(1, 1, 1) },
      uBounds: { value: new THREE.Vector2(mapW, mapH) },
      tHeight: G.tHeight,
      tFog: G.tFog,
      uMapSize: G.uMapSize,
      uFlash: G.uFlash,
      uFlashCol: G.uFlashCol,
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute float aId;
        uniform float uTime, uSide, uPx, uMinPx, uInt;
        uniform vec2 uTile0, uDrift, uRes, uMapSize, uBounds;
        uniform vec3 uAmbient;
        uniform vec4 uFlash;
        uniform vec3 uFlashCol;
        uniform sampler2D tHeight, tFog;
        varying vec2 vUv;
        varying float vA;
        varying float vKind; // 0 streak, 1 ground splash, 2 water ripple
        varying vec3 vCol;

        uvec3 pcg3d(uvec3 v) {
          v = v * 1664525u + 1013904223u;
          v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
          v ^= v >> 16u;
          v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
          return v;
        }
        vec3 rnd3(uvec3 v) { return vec3(pcg3d(v)) * (1.0 / 4294967296.0); }

        void hide() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vA = 0.0; }

        void main() {
          // instances are drop-major, so a smaller instanceCount thins every tile evenly
          float nT = uSide * uSide;
          float i = floor(aId / nT);
          float ti = aId - i * nT;
          float ty = floor(ti / uSide);
          vec2 tile = uTile0 + vec2(ti - ty * uSide, ty);
          uvec3 key = uvec3(uvec2(ivec2(tile) + 4096), uint(i));
          const float FALL = ${RAIN_FALL.toFixed(1)};
          float cyc = uTime / ${CYCLE.toFixed(5)} + rnd3(key).x;
          float n = floor(cyc);
          float f = cyc - n;
          // every fall lands the drop somewhere new in its tile
          vec3 r = rnd3(uvec3(key.x ^ ((uint(n) & ${WRAP - 1}u) * 2654435761u), key.y, key.z * 7919u + 17u));
          vec2 land = (tile + r.xy) * ${TILE.toFixed(1)};
          if (land.x < 0.0 || land.y < 0.0 || land.x > uBounds.x - 1.0 || land.y > uBounds.y - 1.0) { hide(); return; }
          vec2 muv = (land + 0.5) / uMapSize;
          float th = texture2D(tHeight, muv).r;
          float water = step(th, ${(WATER_LEVEL - 0.03).toFixed(2)});
          float gh = max(th, ${WATER_LEVEL.toFixed(2)});
          float seen = smoothstep(0.1, 0.6, texture2D(tFog, muv).r);
          float after = (f * ${CYCLE.toFixed(5)} * FALL - ${HEIGHT.toFixed(1)}) / FALL; // seconds since touchdown (< 0 while falling)
          vec3 col = vec3(0.72, 0.77, 0.86) * uAmbient;
          if (uFlash.w > 0.0) {
            vec3 fd = vec3(land.x, gh, land.y) - uFlash.xyz;
            col += uFlashCol * (uFlash.w * 0.35 / (1.0 + dot(fd, fd) * 0.07));
          }
          vCol = col;
          mat4 vp = projectionMatrix * viewMatrix;

          if (after >= 0.0) {
            // a quick bright splash on the ground, a spreading ripple ring on water
            float dur = mix(0.14, ${SPLASH.toFixed(2)}, water);
            float k = after / dur;
            if (k >= 1.0) { hide(); return; }
            float rad = mix(mix(0.02, 0.07, sqrt(k)), mix(0.04, 0.22, sqrt(k)), water);
            vec3 p = vec3(land.x + position.x * rad, gh + 0.03, land.y + (position.y * 2.0 - 1.0) * rad);
            gl_Position = vp * vec4(p, 1.0);
            float px = rad * uPx / gl_Position.w;
            vUv = vec2(position.x, position.y * 2.0 - 1.0);
            vKind = 1.0 + water;
            vA = (1.0 - k) * (1.0 - k) * mix(0.75, 0.45, water) * seen * smoothstep(1.2, 3.0, px);
            return;
          }

          vec3 vel = vec3(uDrift.x, -FALL, uDrift.y);
          vec3 head = vec3(land.x + uDrift.x * after, gh - after * FALL, land.y + uDrift.y * after);
          // bigger drops in heavier rain leave longer trails: 0.1 .. 0.32 units
          vec3 tail = head - vel * ((0.1 + r.z * 0.1 + uInt * 0.12) / FALL);
          vec4 c0 = vp * vec4(head, 1.0);
          vec4 c1 = vp * vec4(tail, 1.0);
          if (c0.w < 0.6 || c1.w < 0.6) { hide(); return; }
          vec2 hr = uRes * 0.5;
          vec2 s0 = c0.xy / c0.w * hr, s1 = c1.xy / c1.w * hr;
          vec2 d = s1 - s0;
          float sl = length(d);
          vec2 dir = sl > 1e-3 ? d / sl : vec2(0.0, 1.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float wpx = (0.011 + uInt * 0.008) * uPx / c0.w;
          // never thinner than a pixel; fade instead so distant rain stays soft
          float cover = clamp(wpx / uMinPx, 0.3, 1.0);
          wpx = max(wpx, uMinPx);
          vec4 c = position.y < 0.5 ? c0 : c1;
          // widen across, and pad the ends by half a width so the caps stay soft
          vec2 off = nrm * position.x * wpx * 0.5 + dir * (position.y - 0.5) * wpx;
          c.xy += off / hr * c.w;
          gl_Position = c;
          vUv = vec2(position.x, position.y);
          vKind = 0.0;
          // fade in at the top of the fall and for drops right in front of the lens
          vA = seen * cover * (0.7 + 0.3 * r.z) * smoothstep(0.0, 0.08, f) * smoothstep(1.5, 5.0, c0.w);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying vec2 vUv;
        varying float vA;
        varying float vKind;
        varying vec3 vCol;
        void main() {
          float a;
          if (vKind > 1.5) {
            float d = length(vUv);
            a = smoothstep(0.55, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d));
          } else if (vKind > 0.5) {
            a = 1.0 - smoothstep(0.3, 1.0, length(vUv));
          } else {
            float across = 1.0 - vUv.x * vUv.x;
            a = across * mix(1.0, 0.15, clamp(vUv.y, 0.0, 1.0));
          }
          a *= vA * uAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** Viewport size in device pixels and the particle-style pixel scale (px per unit at depth 1). */
  setScale(resW: number, resH: number, pxScale: number, pixelRatio: number) {
    (this.u.uRes.value as THREE.Vector2).set(resW, resH);
    this.u.uPx.value = pxScale;
    this.u.uMinPx.value = pixelRatio;
  }

  setAmbient(c: THREE.Color) {
    (this.u.uAmbient.value as THREE.Color).copy(c);
  }

  /** `amount` is the rain intensity 0..1 (drizzle ≈ 0.3, downpour = 1). */
  update(dt: number, amount: number, cam: THREE.Camera, target: THREE.Vector3, viewSize: number, dist: number, wind: THREE.Vector2) {
    this.t = (this.t + dt) % (CYCLE * WRAP);
    this.u.uTime.value = this.t;
    const I = Math.min(1, amount);
    const perTile = I <= 0.01 ? 0 : Math.min(MAX_PER_TILE, Math.round((50 + 400 * Math.pow(I, 1.5)) * Math.pow(30 / dist, 1.2)));
    this.mesh.visible = perTile > 0;
    if (!this.mesh.visible) return;
    this.u.uInt.value = I;
    // individual drops matter less from high up, where the haze and the screen sheet take over
    const far = THREE.MathUtils.smoothstep(dist, 45, 90);
    this.u.uAlpha.value = (0.4 + 0.4 * I) * (1 - far * 0.6);
    this.drift.set(wind.x * (1.2 + I * 1.4) - 0.3, wind.y * (1.2 + I * 1.4));
    (this.u.uDrift.value as THREE.Vector2).copy(this.drift);
    // cover the view, pushed forward a little since the camera looks past its target
    const fx = target.x - cam.position.x, fz = target.z - cam.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    const cx = target.x + (fx / fl) * viewSize * 0.25, cz = target.z + (fz / fl) * viewSize * 0.25;
    const E = viewSize * 1.2;
    const tx0 = Math.floor((cx - E) / TILE), tz0 = Math.floor((cz - E) / TILE);
    const side = Math.min(MAX_SIDE, Math.max(Math.floor((cx + E) / TILE) - tx0, Math.floor((cz + E) / TILE) - tz0) + 1);
    (this.u.uTile0.value as THREE.Vector2).set(tx0, tz0);
    this.u.uSide.value = side;
    this.geo.instanceCount = side * side * perTile;
  }
}
