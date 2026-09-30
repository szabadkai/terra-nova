// Shared shader extensions for every world material: cloud shadows, wind sway,
// warm night light pools, fog of war and construction clipping.
import * as THREE from 'three';
import { getNoiseTexture } from './textures';

export const MAX_LIGHTS = 32;

export const G = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uCloud: { value: 0.35 },
  uCloudSpeed: { value: new THREE.Vector2(0.9, 0.35) },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uWindStrength: { value: 1 },
  uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uLightCount: { value: 0 },
  uLightColor: { value: new THREE.Color(1.0, 0.55, 0.22) },
  tFog: { value: null as THREE.Texture | null },
  uMapSize: { value: new THREE.Vector2(128, 128) },
  uFogOn: { value: 1 },
  // below this much exploration a pixel is the shroud's whatever else it is (SHROUD_CUT; -1 = never cut short, for comparisons)
  uShroudCut: { value: 0 },
  uWet: { value: 0 },
  tNoise: { value: getNoiseTexture() as THREE.Texture },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
  uSnow: { value: 0 },
  // the year (seasons.ts): deciduous leaf amount, autumn turn, spring freshness, blossom
  uSeasonA: { value: new THREE.Vector4(1, 0, 0, 0) },
  // grass dryness, fallen-leaf litter, meadow flowers, cold
  uSeasonB: { value: new THREE.Vector4(0, 0, 1, 0) },
  // one bright transient light (lightning, divine pillars): xyz + intensity, colour
  uFlash: { value: new THREE.Vector4(0, -100, 0, 0) },
  uFlashCol: { value: new THREE.Color(0.7, 0.8, 1.0) },
  // terrain height (world units) for ground-contact effects on buildings
  tHeight: { value: null as THREE.Texture | null },
  uGrime: { value: 1 },
  // paths worn by traffic (trails.ts): worn (r) and fresh footfall (g), four texels a node
  tTrail: { value: null as THREE.Texture | null },
};

// The lamps (G.uLights, 32 vec4s) go to a program only when they have changed since it last had
// them. three sends an array uniform, flattened into a scratch array first, every time a material
// using it is switched to: some 300 times a frame, 512 bytes each, whether it changed or not (and by
// day, when no shader reads them, it never needs them at all).
let lightsVersion = 0;
const lightsSent = new Float32Array(MAX_LIGHTS * 4 + 1);
/** off: the lamps go with every material switch again, as three sends them (for comparisons) */
export const uniformCache = { lights: true };

/** Call once the frame's lamps are written (the first `count` of G.uLights): marks them changed if they are. */
export function noteLights(count: number) {
  const L = G.uLights.value;
  let same = lightsSent[0] === count;
  for (let i = 0; i < count && same; i++) {
    const v = L[i], o = 1 + i * 4;
    same = lightsSent[o] === v.x && lightsSent[o + 1] === v.y && lightsSent[o + 2] === v.z && lightsSent[o + 3] === v.w;
  }
  if (same) return;
  lightsSent[0] = count;
  for (let i = 0; i < count; i++) L[i].toArray(lightsSent, 1 + i * 4);
  lightsVersion++;
}

type UniformSetter = (gl: WebGL2RenderingContext, v: unknown, textures: unknown) => void;
interface ProgramUniforms { map: Record<string, { setValue: UniformSetter }> }
const hooked = new WeakSet<object>();
let hookedLen = -1;
let hookedLast: unknown = null;

/** Give each of the renderer's programs (as they appear) the lamps' send-on-change (call once a frame, before drawing). */
export function cacheSharedUniforms(renderer: THREE.WebGLRenderer) {
  const progs = renderer.info.programs as unknown as { getUniforms(): ProgramUniforms }[] | null;
  if (!progs || (progs.length === hookedLen && progs[progs.length - 1] === hookedLast)) return;
  hookedLen = progs.length;
  hookedLast = progs[progs.length - 1];
  for (const p of progs) {
    if (hooked.has(p)) continue;
    hooked.add(p);
    const u = p.getUniforms().map.uLights;
    if (!u) continue;
    const send = u.setValue;
    let had = -1;
    u.setValue = function (gl, v, textures) {
      if (had === lightsVersion && uniformCache.lights) return;
      had = lightsVersion;
      send.call(this, gl, v, textures);
    };
  }
}

/** A flag's cloth: a plane `len` long from the pole and `height` high (uv 0..1 across it);
 *  `align` turns it round its pole to stream downwind. */
export interface FlagCloth {
  len: number;
  height: number;
  align?: boolean;
}

export interface PatchOpts {
  wind?: 'tree' | 'grass' | 'flag' | 'none';
  windAmp?: number;
  /** size of the cloth for wind 'flag' */
  flag?: FlagCloth;
  clip?: boolean;
  fog?: boolean;
  clouds?: boolean;
  lights?: boolean;
  /** extra code injection hooks */
  vertexHead?: string;
  vertexBegin?: string;
  fragHead?: string;
  fragMap?: string; // replaces map_fragment
  fragRough?: string; // after roughnessmap_fragment
  fragNormal?: string; // replaces normal_fragment_maps
  fragEmissive?: string; // after emissivemap_fragment
  fragAO?: string; // before aomap_fragment
  fragPost?: string; // before opaque_fragment
  uniforms?: Record<string, THREE.IUniform>;
  key?: string;
  /** how much snow may settle on this material (0 = none, 1 = full), or a GLSL expression for it
   * (the buildings' batches, whose materials differ from piece to piece: none of the lookups where it is 0) */
  snow?: number | string;
  /** runs where the snow is laid on: may change `coverS` (0..1) and the snow's colour `snowC` */
  snowHook?: string;
  /** splash-back grime where the surface meets the ground (0 = none, 1 = full), or a GLSL expression for it (as `snow`) */
  grime?: number | string;
  /**
   * A transparent material that may finish early deep in the shroud, as opaque ones do, once its map
   * code has worked out its alpha (what shows through it is the shroud's own colour, or what lies
   * under it where that is explored).
   */
  shroudLate?: boolean;
  /**
   * How much of the ambient occlusion shows on this material (default 1), left in the scene's alpha
   * for postfx.ts. Its normals are rebuilt from the depth, which makes a blade of grass seen edge-on
   * face the camera, and then the ground around it darkens it.
   */
  ao?: number;
}

const COMMON_FRAG = /* glsl */ `
varying vec3 vWPos;
uniform float uTime;
uniform float uNight;
uniform float uCloud;
uniform vec2 uCloudSpeed;
uniform vec4 uLights[${MAX_LIGHTS}];
uniform int uLightCount;
uniform vec3 uLightColor;
uniform sampler2D tFog;
uniform sampler2D tNoise;
uniform vec2 uMapSize;
uniform float uFogOn;
uniform float uShroudCut;
uniform float uWet;
uniform vec3 uSunDir;
uniform float uSnow;
uniform vec4 uSeasonA;
uniform vec4 uSeasonB;
uniform vec4 uFlash;
uniform vec3 uFlashCol;

vec3 flashLight(vec3 wp) {
  if (uFlash.w <= 0.0) return vec3(0.0);
  vec3 d = wp - uFlash.xyz;
  return uFlashCol * (uFlash.w / (1.0 + dot(d, d) * 0.07));
}

float cloudShadow(vec3 wp) {
  vec2 p = wp.xz + uCloudSpeed * uTime;
  float a = texture2D(tNoise, p * 0.0065).r;
  float b = texture2D(tNoise, p * 0.017 + vec2(0.37, 0.11)).g;
  float c = a * 0.7 + b * 0.3;
  return 1.0 - smoothstep(0.46, 0.68, c) * uCloud;
}

vec3 nightLights(vec3 wp) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec4 L = uLights[i];
    vec3 d = wp - L.xyz;
    float dist2 = dot(d, d);
    float r = 3.2 + L.w * 1.6;
    float att = L.w / (1.0 + dist2 * 1.1);
    att *= 1.0 - smoothstep(0.0, r * r, dist2);
    acc += att;
  }
  return acc * uLightColor;
}

// the unexplored land's own colour, the same for anything standing on it
vec3 shroudColor(vec3 wp) {
  float n2 = texture2D(tNoise, wp.xz * 0.013 - uTime * 0.002).g;
  return mix(vec3(0.012, 0.016, 0.024), vec3(0.05, 0.06, 0.08), n2);
}

vec3 applyFog(vec3 col, vec3 wp) {
  if (uFogOn < 0.5) return col;
  vec2 uv = (wp.xz + 0.5) / uMapSize;
  float e = texture2D(tFog, uv).r;
  // explored ground shows as it is (the noise below moves it by under half a percent)
  if (e > 0.999) return col;
  float n = texture2D(tNoise, wp.xz * 0.05 + uTime * 0.004).r;
  float m = smoothstep(0.2, 0.85, e + (n - 0.5) * 0.35);
  // (a pixel next to one that left early, deep in the shroud (SHROUD_CUT), may have worked its colour
  // from derivatives of nothing: under a thousandth of it could show, so none does)
  return m > 1e-3 ? mix(shroudColor(wp), col, m) : shroudColor(wp);
}
`;

/**
 * Below this much exploration the shroud hides a pixel whatever the noise (applyFog's mix is 0 up
 * to e + 0.175 = 0.2): opaque materials without cut-outs finish there at once, with the shroud's
 * colour, instead of lighting and texturing what nobody can see.
 */
export const SHROUD_CUT = 0.025;
G.uShroudCut.value = SHROUD_CUT;

// A flag is a plane cut from its hoist (uv.x = 0, on the pole) to the fly (uv.x = 1), facing along
// its normal. Waves run from the pole to the fly and bend it; each row of the cloth is laid out by
// integrating the bend angles along it, so the flag keeps its length and the pole edge stays put.
// The wave fronts run slanted across the cloth, the flag sags as the wind drops and flaps harder in
// a gale, and the normals follow the folds so they catch the light.
function flagGlsl(f: FlagCloth) {
  return `
const float FLAG_L = ${f.len.toFixed(4)};
const float FLAG_H = ${f.height.toFixed(4)};
// bend angle of the cloth (x) and its rate of change up the flag (y) at s along a row h up the hoist;
// q = (turn at the fly in radians, gale mix, phase)
vec2 flagAngle(float s, float h, vec3 q) {
  float k = 7.2 / FLAG_L, kv = 1.8 / FLAG_L;
  float env = q.x * (0.3 + 0.7 * s / FLAG_L);
  float a1 = k * s - 6.0 * uTime + q.z + kv * h;
  float a2 = 1.3 * k * s - 11.0 * uTime + q.z * 1.7 + kv * h;
  float a3 = 2.1 * k * s - 15.0 * uTime + q.z * 2.3 - 0.6 * kv * h;
  float th = (1.0 - q.y) * sin(a1) + q.y * sin(a2) + 0.25 * sin(a3);
  float dh = kv * ((1.0 - q.y) * cos(a1) + q.y * cos(a2) - 0.15 * cos(a3));
  return env * vec2(th, dh);
}
void flagBend(inout vec3 p, inout vec3 nrm) {
  vec3 n0 = normalize(vec3(nrm.x, 0.0, nrm.z) + vec3(0.0, 0.0, 1e-5));
  vec3 f = vec3(n0.z, 0.0, -n0.x);
  float s = uv.x * FLAG_L, h = uv.y * FLAG_H;
  vec3 hoist = p - f * s;
  #ifdef USE_INSTANCING
    mat4 M = modelMatrix * instanceMatrix;
  #else
    mat4 M = modelMatrix;
  #endif
  vec3 wp = (M * vec4(hoist.x, 0.0, hoist.z, 1.0)).xyz;
  float ph = dot(wp.xz, vec2(3.7, 5.3));
  float gust = 0.6 + 0.4 * sin(uTime * 0.23 + wp.x * 0.05);
  float w = length(uWind) * uWindStrength * uWindAmp * gust * (0.85 + 0.15 * sin(uTime * 1.3 + ph));
  vec3 q = vec3(mix(0.5, 1.0, smoothstep(0.15, 2.0, w)), smoothstep(0.6, 1.8, w), ph);
  float sag = mix(0.55, 0.05, smoothstep(0.05, 0.9, w));
  ${f.align ? `// stream downwind (the wind is in world space)
  vec2 wd = (transpose(mat3(M)) * vec3(uWind.x, 0.0, uWind.y)).xz;
  f = vec3(normalize(wd + vec2(1e-5, 0.0)), 0.0).xzy;` : ''}
  float yaw = 0.1 * sin(uTime * 0.6 + ph) + 0.05 * sin(uTime * 1.7 + ph * 2.0);
  f = vec3(f.x * cos(yaw) - f.z * sin(yaw), 0.0, f.x * sin(yaw) + f.z * cos(yaw));
  vec3 n = vec3(-f.z, 0.0, f.x), up = vec3(0.0, 1.0, 0.0);
  float X = 0.0, Z = 0.0, Xh = 0.0, Zh = 0.0, ds = s / 8.0;
  for (int i = 0; i < 8; i++) {
    vec2 a = flagAngle((float(i) + 0.5) * ds, h, q);
    float c = cos(a.x), sn = sin(a.x);
    X += c * ds; Z += sn * ds;
    Xh -= sn * a.y * ds; Zh += c * a.y * ds;
  }
  vec2 e = flagAngle(s, h, q);
  // the hems ripple a little too: the rows lift and drop along the fly
  float rip = 0.1 * q.x * sin(0.6 * 7.2 / FLAG_L * s - 4.3 * uTime + ph * 0.7) * s / FLAG_L;
  float cs = cos(sag), ss = sin(sag) - rip;
  p = hoist + f * (X * cs) - up * (X * ss) + n * Z;
  vec3 ts = f * (cos(e.x) * cs) - up * (cos(e.x) * ss) + n * sin(e.x);
  vec3 th = f * (Xh * cs) + up * (1.0 - Xh * ss) + n * Zh;
  nrm = normalize(cross(ts, th));
}
`;
}

// thin cloth: the sun shines through the side facing away from it, most when you look into the sun
const CLOTH_GLOW = `{
    vec3 V = normalize(vViewPosition);
    vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float through = max(-dot(normal, L), 0.0) * (0.45 + 0.55 * pow(clamp(dot(-V, L), 0.0, 1.0), 2.0));
    totalEmissiveRadiance += diffuseColor.rgb * through * 0.4 * (1.0 - uNight * 0.9);
  }`;

const DEFAULT_FLAG: FlagCloth = { len: 0.46, height: 0.3 };
const flagKey = (f = DEFAULT_FLAG) => `${f.len},${f.height},${f.align ? 1 : 0}`;

let patchCount = 0;

/** A short key for the code a patch injects (FNV-1a over it, with its length): the same code, the same key. */
function codeKey(...parts: (string | undefined)[]) {
  const code = parts.map((p) => p ?? '').join('\u0001');
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + code.length.toString(36);
}

export function patchMaterial<T extends THREE.Material>(mat: T, opts: PatchOpts = {}): T {
  const o = { wind: 'none', fog: true, clouds: true, lights: true, windAmp: 1, ...opts } as Required<PatchOpts> & PatchOpts;
  const uClip = { value: 1e9 };
  (mat as any).userData.uClip = uClip;
  const uWindAmp = { value: o.windAmp };
  (mat as any).userData.uWindAmp = uWindAmp;
  // what batching needs to know (buildingBatches.ts leaves wind-bent and clipped materials alone)
  (mat as any).userData.wind = o.wind;
  (mat as any).userData.clip = !!o.clip;
  // a material that cuts pixels out of its surface (the view draws these after the solid ones: cutOrder)
  const cuts = /discard/.test([o.fragHead, o.fragMap, o.fragNormal, o.fragEmissive, o.fragPost, o.fragAO, o.fragRough].join(''));
  (mat as any).userData.cuts = cuts || !!o.clip;
  // (the program's key is what the patch writes into the shader, not the material's name: materials
  // whose shaders come out the same share one program, as the batched buildings' forty-odd do)
  const key = `p${o.wind}${o.wind === 'flag' ? flagKey(o.flag) : ''}|${o.clip ? 1 : 0}|${o.fog ? 1 : 0}|${o.clouds ? 1 : 0}|${o.lights ? 1 : 0}|${o.snow ?? 0}|${o.grime ?? 0}|${o.ao ?? 1}|${o.shroudLate ? 1 : 0}|${codeKey(o.vertexHead, o.vertexBegin, o.fragHead, o.fragMap, o.fragRough, o.fragNormal, o.fragEmissive, o.fragAO, o.fragPost, o.snowHook)}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: G.uTime, uNight: G.uNight, uCloud: G.uCloud, uCloudSpeed: G.uCloudSpeed, uWind: G.uWind,
      uWindStrength: G.uWindStrength, uLights: G.uLights, uLightCount: G.uLightCount, uLightColor: G.uLightColor,
      tFog: G.tFog, uMapSize: G.uMapSize, uFogOn: G.uFogOn, uShroudCut: G.uShroudCut, uWet: G.uWet, tNoise: G.tNoise, uSunDir: G.uSunDir,
      uSnow: G.uSnow, uSeasonA: G.uSeasonA, uSeasonB: G.uSeasonB, uFlash: G.uFlash, uFlashCol: G.uFlashCol, uClip, uWindAmp, tHeight: G.tHeight, uGrime: G.uGrime,
      ...(o.uniforms ?? {}),
    });
    // ---------------- vertex
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStrength;
uniform float uWindAmp;
${o.wind === 'flag' ? flagGlsl(o.flag ?? DEFAULT_FLAG) : ''}
${o.vertexHead ?? ''}
`);
    let windCode = '';
    if (o.wind === 'flag') {
      vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  vec3 flagP = position;
  flagBend(flagP, objectNormal);`);
      windCode = 'transformed = flagP;';
    } else if (o.wind !== 'none') {
      windCode = `
  {
    #if defined(USE_BATCHING)
      vec3 ip = vec3(batchingMatrix[3][0], batchingMatrix[3][1], batchingMatrix[3][2]);
    #elif defined(USE_INSTANCING)
      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    #else
      vec3 ip = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
    #endif
    float ph = ip.x * 0.37 + ip.z * 0.23;
    float gust = 0.6 + 0.4 * sin(uTime * 0.23 + ip.x * 0.05);
    ${o.wind === 'tree' ? `
    float hgt = max(transformed.y, 0.0);
    float sway = sin(uTime * 1.3 + ph) * 0.55 + sin(uTime * 2.9 + ph * 1.7 + transformed.x * 2.0) * 0.18;
    transformed.xz += uWind * sway * uWindAmp * uWindStrength * gust * hgt * hgt * 0.012;
    ` : o.wind === 'grass' ? `
    float hgt = max(transformed.y, 0.0);
    float sway = sin(uTime * 2.1 + ph + transformed.x * 3.0) * 0.6 + 0.5;
    transformed.xz += uWind * sway * uWindAmp * uWindStrength * gust * hgt * 0.35;
    ` : ''}
  }`;
    }
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
${o.vertexBegin ?? ''}
${windCode}`);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 wpp = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      wpp = batchingMatrix * wpp;
    #endif
    #ifdef USE_INSTANCING
      wpp = instanceMatrix * wpp;
    #endif
    vWPos = (modelMatrix * wpp).xyz;
  }`);
    shader.vertexShader = vs;

    // ---------------- fragment
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
${COMMON_FRAG}
uniform float uClip;
${o.fragHead ?? ''}
`);
    if (o.clip) {
      fs = fs.replace('void main() {', `void main() {
  if (vWPos.y > uClip) discard;`);
    }
    // deep in the shroud: the colour of the unexplored land, with the scene's own distance fog after
    // it, as the full path would have ended (only where nothing is cut out of the surface, so the
    // depth it leaves is the same)
    let fragMap = o.fragMap;
    if (o.fog && !cuts) {
      // (the opaque chunk written out: the lamps and the shroud go in before the main path's own)
      const finish = (alpha: string) => `{
    gl_FragColor = vec4(shroudColor(vWPos), ${alpha});
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    #include <premultiplied_alpha_fragment>
    #include <dithering_fragment>
    return;
  }`;
      fs = fs.replace(/void main\(\) \{(\n  if \(vWPos\.y > uClip\) discard;)?/, (m) => `${m}
  // (taken for the whole 2x2 block of pixels or none of it: a pixel that goes on works derivatives
  // from its neighbours, which would be garbage from one that had left; the exploration is smooth
  // enough over the block that its own change across it bounds the others)
  float shroudE = texture2D(tFog, (vWPos.xz + 0.5) / uMapSize).r;
  bool shrouded = uFogOn > 0.5 && shroudE + 2.0 * fwidth(shroudE) <= uShroudCut;
#if defined(OPAQUE) && !defined(USE_ALPHATEST)
  if (shrouded) ${finish(o.ao !== undefined && o.ao !== 1 ? o.ao.toFixed(2) : '1.0')}
#endif`);
      if (o.shroudLate && fragMap) fragMap += `\n  if (shrouded) ${finish('diffuseColor.a')}`;
    }
    if (fragMap) fs = fs.replace('#include <map_fragment>', fragMap);
    if (o.fragRough) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
${o.fragRough}`);
    if (o.fragNormal) fs = fs.replace('#include <normal_fragment_maps>', o.fragNormal);
    const emissive = (o.wind === 'flag' ? CLOTH_GLOW : '') + (o.fragEmissive ?? '');
    if (emissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${emissive}`);
    const grimeAmt = o.grime ?? 0;
    if (typeof grimeAmt === 'string' || grimeAmt > 0) {
      const amt = typeof grimeAmt === 'string' ? `(${grimeAmt})` : grimeAmt.toFixed(2);
      fs = fs.replace('#include <common>', `#include <common>
uniform sampler2D tHeight;
uniform float uGrime;`);
      fs = fs.replace('#include <lights_physical_fragment>', `${typeof grimeAmt === 'string' ? `if (${amt} > 0.0) ` : ''}{
    // rain splash and soil creep darken the bottom of walls; it follows the real terrain
    float gh = texture2D(tHeight, (vWPos.xz + 0.5) / uMapSize).r;
    float above = vWPos.y - gh;
    float gn = texture2D(tNoise, vWPos.xz * 0.9 + vWPos.y * 0.6).r;
    float grime = (1.0 - smoothstep(0.02, 0.26 + gn * 0.16, above)) * uGrime * ${amt};
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.58, 0.52, 0.44), grime);
    roughnessFactor = mix(roughnessFactor, 1.0, grime * 0.5);
  }
#include <lights_physical_fragment>`);
    }
    const snowAmt = o.snow ?? 0;
    if (typeof snowAmt === 'string' || snowAmt > 0) {
      const amt = typeof snowAmt === 'string' ? `(${snowAmt})` : snowAmt.toFixed(2);
      fs = fs.replace('#include <lights_physical_fragment>', `if (uSnow > 0.0${typeof snowAmt === 'string' ? ` && ${amt} > 0.0` : ''}) {
    // snow settles on upward-facing surfaces while it snows and melts away afterwards (none at all,
    // and none of its lookups, once the last of it has gone)
    #ifndef FLAT_SHADED
      vec3 wnS = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
    #else
      vec3 wnS = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    #endif
    float upS = smoothstep(0.3, 0.85, wnS.y);
    float nS = texture2D(tNoise, vWPos.xz * 0.37).r * 0.6 + texture2D(tNoise, vWPos.xz * 1.9).g * 0.4;
    float coverS = clamp(uSnow * 1.7 - (1.0 - upS) * 1.3 - nS * 0.45 + 0.15, 0.0, 1.0) * ${amt};
    vec3 snowC = vec3(0.66, 0.7, 0.76);
    ${o.snowHook ?? ''}
    diffuseColor.rgb = mix(diffuseColor.rgb, snowC, coverS);
  }
#include <lights_physical_fragment>`);
    }
    if (o.clouds) {
      const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cloudShadow(vWPos);',
      );
      fs = fs.replace('#include <lights_fragment_begin>', chunk);
    }
    if (o.fragAO) fs = fs.replace('#include <aomap_fragment>', `${o.fragAO}
#include <aomap_fragment>`);
    let post = o.fragPost ?? '';
    // the lamp loop only runs after dusk
    if (o.lights) post += `\n  outgoingLight += diffuseColor.rgb * ((uNight > 0.001 ? nightLights(vWPos) * uNight : vec3(0.0)) + flashLight(vWPos));`;
    if (o.fog) post += `\n  outgoingLight = applyFog(outgoingLight, vWPos);`;
    fs = fs.replace('#include <opaque_fragment>', `${post}
#include <opaque_fragment>${o.ao !== undefined && o.ao !== 1 ? `\n  gl_FragColor.a = ${o.ao.toFixed(2)};` : ''}`);
    shader.fragmentShader = fs;
    patchCount++;
  };
  return mat;
}

/**
 * Depth material for shadows that shares wind/clip behaviour (vertexHead/vertexBegin/fragHead/fragPost hooks apply too).
 * (The shadow map is read from its depth buffer: the colour it writes is never looked at, so it is not packed.)
 */
export function patchedDepthMaterial(opts: PatchOpts & { alphaTest?: number; map?: THREE.Texture } = {}): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ map: opts.map ?? null, alphaTest: opts.alphaTest ?? 0 });
  const o = { wind: 'none', windAmp: 1, ...opts };
  const uClip = { value: 1e9 };
  (m as any).userData.uClip = uClip;
  const uWindAmp = { value: o.windAmp };
  const key = `d${o.wind}${o.wind === 'flag' ? flagKey(opts.flag) : ''}|${o.clip ? 1 : 0}|${opts.map ? 1 : 0}|${codeKey(opts.vertexHead, opts.vertexBegin, opts.fragHead, opts.fragPost)}`;
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: G.uTime, uWind: G.uWind, uWindStrength: G.uWindStrength, uClip, uWindAmp, ...(o.uniforms ?? {}) });
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStrength;
uniform float uWindAmp;
varying float vWY;
${o.wind === 'flag' ? flagGlsl(opts.flag ?? DEFAULT_FLAG) : ''}
${o.vertexHead ?? ''}`);
    let windCode = '';
    if (o.wind === 'flag') {
      windCode = `
  {
    vec3 flagN = normal;
    flagBend(transformed, flagN);
  }`;
    } else if (o.wind === 'tree') {
      windCode = `
  {
    #ifdef USE_INSTANCING
      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    #else
      vec3 ip = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
    #endif
    float ph = ip.x * 0.37 + ip.z * 0.23;
    float gust = 0.6 + 0.4 * sin(uTime * 0.23 + ip.x * 0.05);
    float hgt = max(transformed.y, 0.0);
    float sway = sin(uTime * 1.3 + ph) * 0.55 + sin(uTime * 2.9 + ph * 1.7 + transformed.x * 2.0) * 0.18;
    transformed.xz += uWind * sway * uWindAmp * uWindStrength * gust * hgt * hgt * 0.012;
  }`;
    }
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
${o.vertexBegin ?? ''}
${windCode}`);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 wpp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wpp = instanceMatrix * wpp;
    #endif
    vWY = (modelMatrix * wpp).y;
  }`);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
uniform float uClip;
varying float vWY;
${o.fragHead ?? ''}`);
    if (o.clip) fs = fs.replace('void main() {', 'void main() {\n  if (vWY > uClip) discard;');
    if (o.fragPost) fs = fs.replace('#include <logdepthbuf_fragment>', `${o.fragPost}
#include <logdepthbuf_fragment>`);
    shader.fragmentShader = fs;
  };
  return m;
}

/**
 * The view's order for solid draws: those that cut pixels out of themselves (alpha-tested leaves and
 * needles, crowns losing their leaves, sites clipped at their height) after all the rest, then three's
 * own order (by material, then front to back). A tile-based GPU (every Apple one) keeps back the
 * shading of solid pixels until it knows which one is in front; a draw that can cut pixels out makes
 * it shade what it holds back so far first, so the ground under a building drawn after the first
 * leaf card was shaded for nothing. `program` gives the program a material was last drawn with (0 if none yet).
 */
export function cutOrder(a: THREE.RenderItem, b: THREE.RenderItem, program?: (m: THREE.Material) => number): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const ca = a.material.alphaTest > 0 || a.material.userData.cuts ? 1 : 0, cb = b.material.alphaTest > 0 || b.material.userData.cuts ? 1 : 0;
  if (ca !== cb) return ca - cb;
  // then by program: materials sharing one keep the textures they share bound, and the camera's uniforms
  if (program) {
    const pa = program(a.material), pb = program(b.material);
    if (pa !== pb) return pa - pb;
  }
  const ia = (a.material as unknown as { id: number }).id, ib = (b.material as unknown as { id: number }).id;
  if (ia !== ib) return ia - ib;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}
