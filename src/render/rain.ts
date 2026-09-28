// GPU rain: stateless drops in world-fixed tiles around the view. Each drop is a thin
// screen-space quad stretched along its projected velocity, so every streak slants the same
// way; when it reaches the ground it turns into a small splash ring.
import * as THREE from 'three';
import { G } from './shaderPatch';
import { WATER_LEVEL } from '../game/world';

const TILE = 16; // world units per rain tile
const MAX_SIDE = 18; // tiles per side at the widest zoom
const MAX_PER_TILE = 400;
const HEIGHT = 14; // drops start this far above the spot they land on
const FALL = 11; // fall speed, units/s
const SPLASH = 0.3; // seconds a splash ring lasts

export class Rain {
  mesh: THREE.Mesh;
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
        uniform float uTime, uSide, uPx, uMinPx;
        uniform vec2 uTile0, uDrift, uRes, uMapSize, uBounds;
        uniform vec3 uAmbient;
        uniform vec4 uFlash;
        uniform vec3 uFlashCol;
        uniform sampler2D tHeight, tFog;
        varying vec2 vUv;
        varying float vA;
        varying float vRing;
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
          const float D = ${HEIGHT.toFixed(1)} + ${FALL.toFixed(1)} * ${SPLASH.toFixed(2)};
          float cyc = uTime * ${FALL.toFixed(1)} / D + rnd3(key).x;
          float n = floor(cyc);
          float f = cyc - n;
          // every fall cycle lands the drop somewhere new in its tile
          vec3 r = rnd3(uvec3(key.x ^ (uint(n) * 2654435761u), key.y, key.z * 7919u + 17u));
          vec2 land = (tile + r.xy) * ${TILE.toFixed(1)};
          if (land.x < 0.0 || land.y < 0.0 || land.x > uBounds.x - 1.0 || land.y > uBounds.y - 1.0) { hide(); return; }
          vec2 muv = (land + 0.5) / uMapSize;
          float gh = max(texture2D(tHeight, muv).r, ${WATER_LEVEL.toFixed(2)});
          float seen = smoothstep(0.1, 0.6, texture2D(tFog, muv).r);
          float after = (f * D - ${HEIGHT.toFixed(1)}) / ${FALL.toFixed(1)}; // seconds since touchdown (< 0 while falling)
          vec3 col = vec3(0.72, 0.77, 0.86) * uAmbient;
          if (uFlash.w > 0.0) {
            vec3 fd = vec3(land.x, gh, land.y) - uFlash.xyz;
            col += uFlashCol * (uFlash.w * 0.35 / (1.0 + dot(fd, fd) * 0.07));
          }
          vCol = col;
          mat4 vp = projectionMatrix * viewMatrix;

          if (after >= 0.0) {
            // splash ring lying on the ground (or water)
            float k = after / ${SPLASH.toFixed(2)};
            float rad = mix(0.05, 0.3, sqrt(k));
            vec3 p = vec3(land.x + position.x * rad, gh + 0.06, land.y + (position.y * 2.0 - 1.0) * rad);
            gl_Position = vp * vec4(p, 1.0);
            float px = rad * uPx / gl_Position.w;
            vUv = vec2(position.x, position.y * 2.0 - 1.0);
            vRing = 1.0;
            vA = (1.0 - k) * (1.0 - k) * 0.55 * seen * smoothstep(1.5, 4.0, px);
            return;
          }

          vec3 vel = vec3(uDrift.x, -${FALL.toFixed(1)}, uDrift.y);
          vec3 head = vec3(land + uDrift * after, gh - after * ${FALL.toFixed(1)});
          vec3 tail = head - vel * (0.055 + r.z * 0.03);
          vec4 c0 = vp * vec4(head, 1.0);
          vec4 c1 = vp * vec4(tail, 1.0);
          if (c0.w < 0.6 || c1.w < 0.6) { hide(); return; }
          vec2 hr = uRes * 0.5;
          vec2 s0 = c0.xy / c0.w * hr, s1 = c1.xy / c1.w * hr;
          vec2 d = s1 - s0;
          float len = length(d);
          vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float wpx = 0.018 * uPx / c0.w;
          float cover = clamp(wpx / uMinPx, 0.25, 1.0);
          wpx = max(wpx, uMinPx);
          vec4 c = position.y < 0.5 ? c0 : c1;
          // widen across, and pad the ends by half a width so the caps stay soft
          vec2 off = nrm * position.x * wpx * 0.5 + dir * (position.y - 0.5) * wpx;
          c.xy += off / hr * c.w;
          gl_Position = c;
          vUv = vec2(position.x, position.y);
          vRing = 0.0;
          // fade in at the top of the fall and for drops right in front of the lens
          vA = seen * cover * smoothstep(0.0, 0.08, f) * smoothstep(1.5, 5.0, c0.w);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying vec2 vUv;
        varying float vA;
        varying float vRing;
        varying vec3 vCol;
        void main() {
          float a;
          if (vRing > 0.5) {
            float d = length(vUv);
            a = smoothstep(0.55, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d));
          } else {
            float across = 1.0 - vUv.x * vUv.x;
            a = across * mix(1.0, 0.2, clamp(vUv.y, 0.0, 1.0));
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

  update(dt: number, amount: number, cam: THREE.Camera, target: THREE.Vector3, viewSize: number, dist: number, wind: THREE.Vector2) {
    this.t = (this.t + dt) % 3600;
    this.u.uTime.value = this.t;
    const perTile = Math.min(MAX_PER_TILE, Math.round(200 * Math.pow(30 / dist, 1.2) * amount));
    this.mesh.visible = perTile > 0;
    if (!this.mesh.visible) return;
    // cover the view, pushed forward a little since the camera looks past its target
    const fx = target.x - cam.position.x, fz = target.z - cam.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    const cx = target.x + (fx / fl) * viewSize * 0.25, cz = target.z + (fz / fl) * viewSize * 0.25;
    const E = viewSize * 1.2;
    const tx0 = Math.floor((cx - E) / TILE), tz0 = Math.floor((cz - E) / TILE);
    const side = Math.min(MAX_SIDE, Math.max(Math.floor((cx + E) / TILE) - tx0, Math.floor((cz + E) / TILE) - tz0) + 1);
    (this.u.uTile0.value as THREE.Vector2).set(tx0, tz0);
    this.u.uSide.value = side;
    (this.u.uDrift.value as THREE.Vector2).set(wind.x * 1.8 - 0.4, wind.y * 1.8);
    this.geo.instanceCount = side * side * perTile;
  }
}
