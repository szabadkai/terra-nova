// Animated water surface: depth-based colour, shoreline foam, scrolling normals, glints.
import * as THREE from 'three';
import { WATER_LEVEL } from '../game/world';
import { patchMaterial } from './shaderPatch';
import { getWaterNormal } from './textures';

export class WaterRenderer {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;

  constructor(W: number, H: number, heightTex: THREE.Texture) {
    const margin = 260;
    const geo = new THREE.PlaneGeometry(W + margin * 2, H + margin * 2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, WATER_LEVEL, H / 2);
    this.uniforms = {
      tHeight: { value: heightTex },
      tWaterN: { value: getWaterNormal() },
      uWaterLevel: { value: WATER_LEVEL },
      uSkyCol: { value: new THREE.Color(0.5, 0.7, 1.0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, depthWrite: false,
      envMapIntensity: 1.2,
    });
    patchMaterial(mat, {
      key: 'water',
      uniforms: this.uniforms,
      lights: true,
      fragHead: /* glsl */ `
uniform sampler2D tHeight;
uniform sampler2D tWaterN;
uniform float uWaterLevel;
uniform vec3 uSkyCol;
uniform vec3 uSunCol;
#define C(r,g,b) pow(vec3(float(r),float(g),float(b))/255.0, vec3(2.2))
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
  wFoam = foam;
  col = mix(col, vec3(0.92, 0.96, 0.98), foam);
  diffuseColor.rgb = col;
  float alpha = clamp(0.22 + depth * 0.95, 0.0, 0.95);
  diffuseColor.a = max(alpha, foam * 0.95);
  // soft light scattering in shallow water
  wEmis = C(40, 150, 140) * 0.06 * (1.0 - smoothstep(0.2, 2.0, depth)) * max(uSunCol.r, 0.2);
`,
      fragRough: 'roughnessFactor = mix(0.07, 0.8, wFoam);',
      fragNormal: /* glsl */ `
  {
    vec2 p2 = vWPos.xz;
    vec3 a = texture2D(tWaterN, p2 * 0.075 + uTime * vec2(0.011, 0.007)).xyz * 2.0 - 1.0;
    vec3 b = texture2D(tWaterN, p2 * 0.13 - uTime * vec2(0.009, -0.013)).xyz * 2.0 - 1.0;
    vec3 c = texture2D(tWaterN, p2 * 0.031 + uTime * vec2(-0.004, 0.005)).xyz * 2.0 - 1.0;
    float calm = mix(0.35, 1.0, smoothstep(0.0, 1.5, wDepth));
    vec2 slopeXY = (a.xy * 0.5 + b.xy * 0.35 + c.xy * 0.45) * calm;
    vec3 wn = normalize(vec3(slopeXY.x, 1.0, slopeXY.y));
    normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  }
`,
      fragEmissive: /* glsl */ `
  {
    // fresnel sky boost + sun glints
    vec3 V = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 4.0);
    totalEmissiveRadiance += uSkyCol * fres * 0.25 * (1.0 - wFoam) + wEmis;
  }
`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }
}
