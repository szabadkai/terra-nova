// Animated water surface: depth-based colour, shoreline foam, scrolling normals, glints.
import * as THREE from 'three';
import { WATER_LEVEL } from '../game/world';
import { patchMaterial } from './shaderPatch';
import { getWaterNormal } from './textures';

/** how far the water's surface reaches past the map on each side */
export const WATER_MARGIN = 260;

export class WaterRenderer {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;

  constructor(W: number, H: number, heightTex: THREE.Texture) {
    const geo = new THREE.PlaneGeometry(W + WATER_MARGIN * 2, H + WATER_MARGIN * 2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, WATER_LEVEL, H / 2);
    this.uniforms = {
      tHeight: { value: heightTex },
      tWaterN: { value: getWaterNormal() },
      uWaterLevel: { value: WATER_LEVEL },
      uSkyCol: { value: new THREE.Color(0.5, 0.7, 1.0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      tReflect: { value: null },
      uReflMat: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
      uReflRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uWakes: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uWakeN: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, depthWrite: false,
      envMapIntensity: 1.2,
    });
    patchMaterial(mat, {
      key: 'water',
      snow: 0,
      uniforms: this.uniforms,
      lights: true,
      fragHead: /* glsl */ `
uniform sampler2D tHeight;
uniform sampler2D tWaterN;
uniform float uWaterLevel;
uniform vec3 uSkyCol;
uniform vec3 uSunCol;
uniform sampler2D tReflect;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform vec4 uReflRect; // the part of tReflect drawn this frame, inset by half a texel
uniform vec4 uWakes[8]; // ship x, z, heading, speed
uniform float uWakeN;
#define C(r,g,b) pow(vec3(float(r),float(g),float(b))/255.0, vec3(2.2))
vec2 wSlope;
float wFoam;
float wDepth;
vec3 wEmis;
`,
      fragMap: /* glsl */ `
  vec2 muv = (vWPos.xz + 0.5) / uMapSize;
  vec2 cl = clamp(muv, vec2(0.0), vec2(1.0));
  float th = texture2D(tHeight, cl).r;
  float outside = step(0.001, abs(muv.x - cl.x) + abs(muv.y - cl.y));
  th = mix(th, uWaterLevel - 6.0, outside);
  float depth = max(0.0, uWaterLevel - th);
  wDepth = depth;
  vec2 p = vWPos.xz;
  float n = texture2D(tNoise, p * 0.08 + uTime * 0.01).r;
  vec3 shallow = C(70, 178, 170);
  vec3 mid = C(28, 112, 138);
  vec3 deep = C(12, 50, 88);
  vec3 col = mix(shallow, mid, smoothstep(0.0, 1.6, depth));
  col = mix(col, deep, smoothstep(1.2, 5.0, depth));
  // shoreline foam and lapping waves
  float shore = 1.0 - smoothstep(0.0, 0.22 + n * 0.12, depth);
  float waves = smoothstep(0.72, 0.98, sin(depth * 9.0 - uTime * 1.7 + n * 5.0)) * (1.0 - smoothstep(0.0, 0.9, depth));
  float fn = texture2D(tNoise, p * 0.9 - uTime * 0.03).g;
  float foam = clamp(shore * 0.9 + waves * 0.75, 0.0, 1.0) * smoothstep(0.25, 0.6, fn + shore * 0.4);
  // ship wakes: foam hugging the hull, a churned trail and the two Kelvin arms fanning out behind
  float wake = 0.0;
  for (int k = 0; k < 8; k++) {
    if (float(k) >= uWakeN) break;
    vec4 wk = uWakes[k];
    vec2 d = vWPos.xz - wk.xy;
    if (dot(d, d) > 256.0) continue;
    vec2 fwd = vec2(sin(wk.z), cos(wk.z));
    vec2 rgt = vec2(fwd.y, -fwd.x);
    float along = dot(d, fwd), side = dot(d, rgt);
    float spd = clamp(wk.w / 3.4, 0.0, 1.0);
    // bow wave and a thin collar of foam where the hull meets the water
    float hull = length(vec2(side / 0.5, along / 1.45));
    float ring = (1.0 - smoothstep(0.0, 0.1 + spd * 0.12, abs(hull - 1.02))) * (0.18 + 0.6 * spd) * (0.45 + 0.55 * smoothstep(-1.2, 1.4, along));
    float back = -(along + 1.1);
    if (back > 0.0) {
      float armX = back * 0.34 + 0.38;
      float w0 = 0.05 + back * 0.03;
      // the arms are chains of short crests, not lines: modulate along their length
      float crest = 0.55 + 0.45 * sin(back * 7.0 - uTime * 2.6 + side * 3.0);
      float arm = (1.0 - smoothstep(0.0, w0, abs(abs(side) - armX))) * exp(-back * 0.85) * spd * 0.6 * crest;
      float trail = (1.0 - smoothstep(0.0, 0.18 + back * 0.06, abs(side))) * exp(-back * 0.8) * spd * 0.75;
      // faint transverse ripples between the arms
      float tr = smoothstep(0.75, 1.0, sin(back * 4.0 - uTime * 3.0)) * (1.0 - smoothstep(armX * 0.5, armX, abs(side))) * exp(-back * 0.9) * spd * 0.12;
      wake = max(wake, max(arm, max(trail, tr)));
    }
    wake = max(wake, ring);
  }
  float wn = texture2D(tNoise, p * 1.7 + uTime * vec2(0.02, -0.015)).b;
  foam = max(foam, wake * smoothstep(0.25, 0.75, wn * 0.7 + fn * 0.5 + wake * 0.25));
  wFoam = foam;
  col = mix(col, vec3(0.62, 0.7, 0.72), foam);
  diffuseColor.rgb = col;
  float alpha = clamp(0.22 + depth * 0.95, 0.0, 0.95);
  diffuseColor.a = max(alpha, foam * 0.95);
  // soft light scattering in shallow water
  wEmis = C(40, 150, 140) * 0.06 * (1.0 - smoothstep(0.2, 2.0, depth)) * max(uSunCol.r, 0.2);
`,
      // only real foam roughens the surface: a faint trace would smear the sun glint along it
      fragRough: 'roughnessFactor = mix(0.07, 0.8, smoothstep(0.18, 0.6, wFoam));',
      fragNormal: /* glsl */ `
  {
    vec2 p2 = vWPos.xz;
    vec3 a = texture2D(tWaterN, p2 * 0.075 + uTime * vec2(0.011, 0.007)).xyz * 2.0 - 1.0;
    vec3 b = texture2D(tWaterN, p2 * 0.13 - uTime * vec2(0.009, -0.013)).xyz * 2.0 - 1.0;
    vec3 c = texture2D(tWaterN, p2 * 0.031 + uTime * vec2(-0.004, 0.005)).xyz * 2.0 - 1.0;
    float calm = mix(0.35, 1.0, smoothstep(0.0, 1.5, wDepth));
    vec2 slopeXY = (a.xy * 0.5 + b.xy * 0.35 + c.xy * 0.45) * calm;
    wSlope = slopeXY;
    vec3 wn = normalize(vec3(slopeXY.x, 1.0, slopeXY.y));
    normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  }
`,
      fragEmissive: /* glsl */ `
  {
    // fresnel sky boost + sun glints
    vec3 V = normalize(vViewPosition);
    float ndv = clamp(dot(normal, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 4.0);
    totalEmissiveRadiance += uSkyCol * fres * 0.25 * (1.0 - wFoam) * (1.0 - uReflOn) + wEmis;
    if (uReflOn > 0.5) {
      vec4 rc = uReflMat * vec4(vWPos, 1.0);
      vec2 ruv = clamp(rc.xy / rc.w + wSlope * 0.06, uReflRect.xy, uReflRect.zw);
      vec3 refl = texture2D(tReflect, ruv).rgb;
      float k = clamp(0.1 + pow(1.0 - ndv, 3.0) * 0.6, 0.0, 1.0) * (1.0 - wFoam) * smoothstep(0.02, 0.35, wDepth);
      diffuseColor.rgb *= 1.0 - k * 0.3;
      totalEmissiveRadiance += refl * k * 0.5;
      diffuseColor.a = max(diffuseColor.a, k * 0.95);
    }
  }
`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }
}
