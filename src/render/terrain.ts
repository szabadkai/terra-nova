// Terrain mesh with a procedural, multi-material splat shader.
import * as THREE from 'three';
import type { Game } from '../game/game';
import { WATER_LEVEL } from '../game/world';
import { G, patchMaterial } from './shaderPatch';

function dataTex(W: number, H: number, linear = true): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(W * H * 4), W, H, THREE.RGBAFormat);
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export const TERRAIN_FRAG_HEAD = /* glsl */ `
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2D tTerr;
uniform sampler2D tOre;
uniform float uWaterLevel;
uniform vec3 uPlayerCols[4];
uniform vec4 uSel;
uniform vec4 uRange;
uniform float uBorderOn;
uniform float uSunI;
varying vec3 vWNormal;

#define C(r,g,b) pow(vec3(float(r),float(g),float(b))/255.0, vec3(2.2))

float tBump;
float tRough;
float tAO;
vec3 tEmis;
`;

const TERRAIN_MAP = /* glsl */ `
  vec2 muv = (vWPos.xz + 0.5) / uMapSize;
  vec4 sa = texture2D(tSplatA, muv);
  vec4 sb = texture2D(tSplatB, muv);
  vec4 misc = texture2D(tFog, muv);
  vec2 p = vWPos.xz;
  float camDist = length(vViewPosition);
  vec4 n0 = texture2D(tNoise, p * 0.013);
  vec4 n1 = texture2D(tNoise, p * 0.047 + vec2(0.31, 0.17));
  vec4 n2 = texture2D(tNoise, p * 0.17 + vec2(0.63, 0.41));
  vec4 n3 = texture2D(tNoise, p * 0.61 + vec2(0.11, 0.87));
  // rotated sampling breaks up visible tiling of the high-frequency layers
  vec2 pr1 = mat2(0.8, -0.6, 0.6, 0.8) * p;
  vec2 pr2 = mat2(0.28, -0.96, 0.96, 0.28) * p;
  vec4 n4 = texture2D(tNoise, pr1 * 1.73 + vec2(0.47, 0.29));
  vec4 n5 = texture2D(tNoise, pr2 * 4.9 + vec2(0.77, 0.19));
  float farFade = (1.0 - smoothstep(30.0, 90.0, camDist));

  float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
  float wh = vWPos.y - uWaterLevel;

  float w[8];
  w[0] = sa.r; w[1] = sa.g; w[2] = sa.b; w[3] = sa.a;
  w[4] = sb.r; w[5] = sb.g; w[6] = sb.b; w[7] = sb.a;

  float rockBoost = smoothstep(0.30, 0.52, slope + (n1.r - 0.5) * 0.25) * (1.0 - w[6]);
  w[5] += rockBoost * 2.0;
  float beach = 1.0 - smoothstep(0.12, 0.42, wh + (n1.g - 0.5) * 0.35);
  w[4] += beach * 1.6 * (1.0 - rockBoost);
  float wear = misc.g;
  float pathM = smoothstep(0.22, 0.55, wear + (n3.r - 0.5) * 0.3);
  w[3] += pathM * 1.5 * (w[0] + w[1] + w[2] + w[7]);

  float hts[8];
  hts[0] = n3.r * 0.55 + n4.g * 0.45;
  hts[1] = n3.g * 0.55 + n4.r * 0.45;
  hts[2] = n2.b * 0.5 + n3.b * 0.5;
  hts[3] = n2.r * 0.35 + n4.b * 0.3;
  hts[4] = n2.g * 0.3 + n3.a * 0.1;
  hts[5] = n1.r * 0.55 + n2.r * 0.55;
  hts[6] = n1.g * 0.4 + 0.35;
  hts[7] = n2.a * 0.25;
  float mx = 0.0;
  float v[8];
  for (int i = 0; i < 8; i++) { v[i] = w[i] > 0.001 ? w[i] + hts[i] * 0.55 : 0.0; mx = max(mx, v[i]); }
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) { v[i] = w[i] > 0.001 ? max(v[i] - mx + 0.22, 0.0) : 0.0; wsum += v[i]; }
  for (int i = 0; i < 8; i++) v[i] /= max(wsum, 1e-4);

  vec3 col = vec3(0.0);
  float rough = 0.0;
  float bump = 0.0;

  // grass
  if (v[0] > 0.0) {
    vec3 c = mix(C(84,130,40), C(124,150,50), smoothstep(0.3, 0.75, n0.r));
    c = mix(c, C(54,96,32), smoothstep(0.45, 0.8, n1.b) * 0.55);
    c *= 0.88 + 0.24 * mix(0.5, n4.r * 0.7 + n5.g * 0.3, farFade);
    c = mix(c, C(152,158,72), smoothstep(0.74, 0.95, n2.g) * 0.3);
    col += c * v[0]; rough += 0.95 * v[0]; bump += (n4.r * 0.5 + n5.r * 0.5) * 0.35 * v[0];
  }
  // meadow with flowers
  if (v[1] > 0.0) {
    vec3 c = mix(C(106,150,48), C(142,166,62), n0.g);
    c *= 0.88 + 0.24 * mix(0.5, n4.g, farFade);
    vec4 fl = texture2D(tNoise, pr1 * 0.62 + vec2(0.2, 0.9));
    float f = (1.0 - smoothstep(0.14, 0.3, fl.b)) * step(0.5, fl.a) * farFade;
    vec3 fc = fl.a > 0.88 ? C(248,244,236) : fl.a > 0.78 ? C(252,212,58) : fl.a > 0.67 ? C(176,118,222) : C(232,96,84);
    c = mix(c, fc, f);
    col += c * v[1]; rough += 0.93 * v[1]; bump += (n4.g * 0.4 + f * 0.6) * 0.35 * v[1];
  }
  // forest floor
  if (v[2] > 0.0) {
    vec3 c = mix(C(62,98,34), C(74,92,38), smoothstep(0.35, 0.7, n2.r));
    c = mix(c, C(96,82,44), smoothstep(0.62, 0.9, n3.a) * 0.4);
    c = mix(c, C(48,78,30), smoothstep(0.5, 0.8, n1.b) * 0.5);
    c *= 0.86 + 0.26 * mix(0.5, n4.b, farFade);
    col += c * v[2]; rough += 0.97 * v[2]; bump += n4.b * 0.4 * v[2];
  }
  // dirt / packed earth
  if (v[3] > 0.0) {
    vec3 c = mix(C(116,86,56), C(142,110,74), n2.g);
    c *= 0.84 + 0.28 * n3.r;
    float peb = (1.0 - smoothstep(0.1, 0.24, n3.b)) * step(0.45, n3.a) * farFade;
    c = mix(c, C(156,146,130), peb * 0.65);
    c = mix(c, c * 0.8, pathM * 0.35 * (1.0 - n4.r));
    col += c * v[3]; rough += 0.95 * v[3]; bump += (n3.r * 0.4 + peb * 0.8) * 0.4 * v[3];
  }
  // sand
  if (v[4] > 0.0) {
    vec3 c = mix(C(212,188,134), C(228,208,158), n1.r);
    float rip = sin(dot(p, vec2(2.4, 1.1)) + n2.r * 7.0) * 0.5 + 0.5;
    c *= 0.92 + 0.08 * rip + 0.1 * (n4.r - 0.5) * farFade;
    float wetS = 1.0 - smoothstep(0.02, 0.28, wh);
    c = mix(c, c * 0.58, wetS);
    col += c * v[4]; rough += mix(0.9, 0.35, wetS) * v[4]; bump += rip * 0.25 * v[4];
  }
  // rock
  if (v[5] > 0.0) {
    float strata = sin(vWPos.y * 3.6 + n1.r * 4.0 + n2.g * 1.5) * 0.5 + 0.5;
    vec3 c = mix(C(96,90,82), C(128,120,108), strata * 0.45 + n2.b * 0.35 + n3.r * 0.2);
    c = mix(c, C(80,76,72), smoothstep(0.55, 0.8, n1.g) * 0.45);
    c = mix(c, C(118,100,82), smoothstep(0.6, 0.85, n0.b) * 0.35);
    float crack = (1.0 - smoothstep(0.0, 0.1, n3.b)) * step(0.55, n3.a) * 0.6 * farFade;
    c *= 1.0 - crack * 0.35;
    c *= 0.9 + 0.2 * n4.g * farFade;
    c = mix(c, C(96,110,58), smoothstep(0.66, 0.9, n3.b) * (1.0 - slope) * 0.55);
    // ore specks
    vec4 ore = texture2D(tOre, muv);
    vec2 warp = (vec2(n2.g, n2.b) - 0.5) * 0.9;
    vec4 on1 = texture2D(tNoise, (pr2 + warp) * 0.42 + vec2(0.13, 0.57));
    vec4 on2 = texture2D(tNoise, (pr1 - warp) * 0.23 + vec2(0.71, 0.33));
    float spk = (1.0 - smoothstep(0.08, 0.2, on1.b + n3.r * 0.08)) * step(0.62, on1.a) * farFade;
    float spk2 = (1.0 - smoothstep(0.06, 0.18, on2.b + n3.g * 0.08)) * step(0.78, on2.a);
    c = mix(c, C(28,26,28), clamp(ore.r * 2.0, 0.0, 1.0) * max(spk, spk2 * 0.6));
    c = mix(c, C(168,78,44), clamp(ore.g * 2.0, 0.0, 1.0) * max(spk, spk2 * 0.6));
    c = mix(c, C(214,206,196), clamp(ore.a * 2.0, 0.0, 1.0) * spk2 * 0.8);
    float gold = clamp(ore.b * 2.0, 0.0, 1.0) * max(spk, spk2 * 0.6);
    c = mix(c, C(250,200,60), gold);
    tEmis += C(255,190,60) * gold * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.5 + on1.a * 40.0), 8.0)) * 1.4;
    col += c * v[5]; rough += mix(0.72, 0.3, gold) * v[5]; bump += (n1.r * 0.3 + n2.r * 0.5 + n3.g * 0.3 - crack * 0.6) * 1.1 * v[5];
  }
  // snow
  if (v[6] > 0.0) {
    vec3 c = mix(C(234,240,248), C(212,224,242), n2.r * 0.8);
    c = mix(c, C(190,205,230), slope * 0.6);
    tEmis += vec3(0.8, 0.9, 1.0) * pow(n5.a, 40.0) * 2.0 * farFade;
    col += c * v[6]; rough += 0.55 * v[6]; bump += n2.r * 0.4 * v[6];
  }
  // swamp
  if (v[7] > 0.0) {
    vec3 c = mix(C(70,80,42), C(56,62,38), n2.g);
    float pud = (1.0 - smoothstep(0.36, 0.44, n1.b + (n3.r - 0.5) * 0.1));
    c = mix(c, C(34,46,44), pud * 0.85);
    col += c * v[7]; rough += mix(0.9, 0.08, pud) * v[7]; bump += (1.0 - pud) * n3.r * 0.4 * v[7];
  }

  // tilled farm soil
  float tilled = misc.a;
  if (tilled > 0.01) {
    float furrow = sin(p.x * 8.0 + n2.r * 2.0) * 0.5 + 0.5;
    vec3 soil = mix(C(92,64,40), C(120,86,54), furrow) * (0.9 + 0.2 * n4.r);
    col = mix(col, soil, tilled);
    bump = mix(bump, furrow * 0.5, tilled);
  }

  // underwater: tint, caustics
  if (wh < 0.0) {
    float depth = -wh;
    col = mix(col, C(40,86,84), smoothstep(0.0, 2.8, depth) * 0.75);
    vec2 cp = p * 0.55;
    float c1 = texture2D(tNoise, cp + vec2(uTime * 0.021, uTime * 0.013)).b;
    float c2 = texture2D(tNoise, cp * 1.31 - vec2(uTime * 0.017, -uTime * 0.02)).b;
    float caust = (1.0 - smoothstep(0.05, 0.4, abs(c1 - c2))) ;
    tEmis += vec3(0.55, 0.85, 0.8) * caust * 0.22 * uSunI * (1.0 - smoothstep(0.0, 2.6, depth)) * smoothstep(0.0, 0.25, depth);
    rough = 0.6;
  }

  // wetness from rain
  col *= 1.0 - uWet * 0.28 * (1.0 - v[6]);
  rough = mix(rough, 0.25, uWet * 0.7);

  // territory borders
  if (uBorderOn > 0.5) {
    vec4 terr = texture2D(tTerr, muv);
    for (int k = 0; k < 4; k++) {
      float tv = terr[k];
      if (tv < 0.02) continue;
      float fw = fwidth(tv) + 1e-4;
      float line = 1.0 - smoothstep(0.0, fw * 1.6, abs(tv - 0.5));
      float glow = smoothstep(0.5, 0.62, tv) * (1.0 - smoothstep(0.62, 0.95, tv));
      float pulse = 0.65 + 0.35 * sin(uTime * 2.2 - (p.x + p.y) * 0.35);
      vec3 pc = uPlayerCols[k];
      col = mix(col, pc * 0.9 + 0.1, line * 0.75);
      tEmis += pc * (line * 0.9 + glow * 0.18) * pulse;
    }
  }

  // selection ring
  if (uSel.w > 0.0) {
    float d = length(p - uSel.xz);
    float ring = (1.0 - smoothstep(0.0, 0.09, abs(d - uSel.w))) + (1.0 - smoothstep(0.0, 0.35, abs(d - uSel.w))) * 0.3;
    tEmis += vec3(1.0, 0.85, 0.35) * ring * (0.7 + 0.3 * sin(uTime * 5.0));
  }
  // work range circle
  if (uRange.w > 0.0) {
    float d = length(p - uRange.xz);
    float ang = atan(p.y - uRange.z, p.x - uRange.x);
    float dash = step(0.5, fract(ang * uRange.w * 0.8 / 6.2831 * 2.0 + uTime * 0.2));
    float ring = (1.0 - smoothstep(0.0, 0.1, abs(d - uRange.w))) * dash;
    float fill = (1.0 - smoothstep(uRange.w - 0.2, uRange.w, d)) * 0.05;
    tEmis += vec3(0.45, 0.85, 1.0) * (ring * 0.9 + fill);
  }

  tBump = bump;
  tRough = rough;
  tAO = misc.b;
  diffuseColor.rgb = col;
`;

const TERRAIN_NORMAL = /* glsl */ `
  {
    // derivative based bump mapping on the combined material height
    vec3 surfPos = -vViewPosition;
    vec3 dpx = dFdx(surfPos);
    vec3 dpy = dFdy(surfPos);
    float dhx = dFdx(tBump);
    float dhy = dFdy(tBump);
    vec3 r1 = cross(dpy, normal);
    vec3 r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    float scale = 0.9 * (1.0 - smoothstep(15.0, 80.0, length(vViewPosition)));
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(det) * normal - grad * scale);
  }
`;

export class TerrainRenderer {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  splatA: THREE.DataTexture;
  splatB: THREE.DataTexture;
  terr: THREE.DataTexture;
  misc: THREE.DataTexture;
  ore: THREE.DataTexture;
  heightTex: THREE.DataTexture;
  uniforms: Record<string, THREE.IUniform>;
  private aoT = 0;
  private wearT = 0;

  constructor(private game: Game) {
    const w = game.world;
    const W = w.W, H = w.H;
    const pos = new Float32Array(W * H * 3);
    const nrm = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        pos[i * 3] = x;
        pos[i * 3 + 1] = w.h[i];
        pos[i * 3 + 2] = y;
      }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let k = 0;
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W - 1; x++) {
        const a = y * W + x, b = a + 1, c = a + W, d = c + 1;
        // split along the diagonal with smaller height difference
        if (Math.abs(w.h[a] - w.h[d]) < Math.abs(w.h[b] - w.h[c])) {
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
        } else {
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    this.computeNormals(0, 0, W - 1, H - 1);

    this.splatA = dataTex(W, H);
    this.splatB = dataTex(W, H);
    this.terr = dataTex(W, H);
    this.misc = dataTex(W, H);
    this.ore = dataTex(W, H);
    this.heightTex = new THREE.DataTexture(new Uint16Array(W * H), W, H, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;
    G.tFog.value = this.misc;
    G.uMapSize.value.set(W, H);

    this.uniforms = {
      tSplatA: { value: this.splatA },
      tSplatB: { value: this.splatB },
      tTerr: { value: this.terr },
      tOre: { value: this.ore },
      uWaterLevel: { value: WATER_LEVEL },
      uPlayerCols: { value: game.players.map((p) => new THREE.Color(p.color)).concat([new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()]).slice(0, 4) },
      uSel: { value: new THREE.Vector4(0, 0, 0, 0) },
      uRange: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBorderOn: { value: 1 },
      uSunI: { value: 1 },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    patchMaterial(mat, {
      key: 'terrain',
      uniforms: this.uniforms,
      vertexHead: 'varying vec3 vWNormal;',
      vertexBegin: 'vWNormal = normalize(mat3(modelMatrix) * objectNormal);',
      fragHead: TERRAIN_FRAG_HEAD,
      fragMap: 'tBump = 0.0; tRough = 1.0; tAO = 1.0; tEmis = vec3(0.0);\n' + TERRAIN_MAP,
      fragRough: 'roughnessFactor = tRough;',
      fragNormal: TERRAIN_NORMAL,
      fragEmissive: 'totalEmissiveRadiance += tEmis;',
      fragAO: 'reflectedLight.indirectDiffuse *= tAO; reflectedLight.indirectSpecular *= tAO; reflectedLight.directDiffuse *= mix(1.0, tAO, 0.35);',
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;

    this.updateSplat();
    this.updateOwner();
    this.updateMisc(true);
    this.updateOre();
    this.updateHeightTex();
  }

  computeNormals(x0: number, y0: number, x1: number, y1: number) {
    const w = this.game.world;
    const W = w.W, H = w.H;
    const nrm = this.geo.getAttribute('normal') as THREE.BufferAttribute;
    const arr = nrm.array as Float32Array;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const hl = w.h[y * W + Math.max(0, x - 1)], hr = w.h[y * W + Math.min(W - 1, x + 1)];
        const hu = w.h[Math.max(0, y - 1) * W + x], hd = w.h[Math.min(H - 1, y + 1) * W + x];
        let nx = (hl - hr) * 0.5, ny = 1, nz = (hu - hd) * 0.5;
        const l = Math.hypot(nx, ny, nz);
        arr[i * 3] = nx / l;
        arr[i * 3 + 1] = ny / l;
        arr[i * 3 + 2] = nz / l;
      }
    nrm.needsUpdate = true;
  }

  updateHeights() {
    const w = this.game.world;
    const d = w.heightDirty;
    if (!d) return;
    w.heightDirty = null;
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const W = w.W;
    for (let y = Math.max(0, d.y0); y <= Math.min(w.H - 1, d.y1); y++)
      for (let x = Math.max(0, d.x0); x <= Math.min(W - 1, d.x1); x++) {
        const i = y * W + x;
        arr[i * 3 + 1] = w.h[i];
      }
    pos.needsUpdate = true;
    this.computeNormals(d.x0 - 1, d.y0 - 1, d.x1 + 1, d.y1 + 1);
    this.updateHeightTex();
    this.aoT = 0;
  }

  updateHeightTex() {
    const w = this.game.world;
    const d = this.heightTex.image.data as Uint16Array;
    for (let i = 0; i < w.N; i++) d[i] = THREE.DataUtils.toHalfFloat(w.h[i]);
    this.heightTex.needsUpdate = true;
  }

  updateSplat() {
    const w = this.game.world;
    const W = w.W, H = w.H;
    const A = this.splatA.image.data as Uint8Array;
    const B = this.splatB.image.data as Uint8Array;
    const tmp = new Float32Array(W * H * 8);
    for (let i = 0; i < w.N; i++) {
      const t = w.terrain[i];
      tmp[i * 8 + t] = 1;
    }
    // gentle blur so the shader has gradients to blend with
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const acc = [0, 0, 0, 0, 0, 0, 0, 0];
        let wsum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
            const j = yy * W + xx;
            const wt = dx === 0 && dy === 0 ? 2 : 0.6;
            wsum += wt;
            for (let c = 0; c < 8; c++) acc[c] += tmp[j * 8 + c] * wt;
          }
        for (let c = 0; c < 4; c++) A[i * 4 + c] = (acc[c] / wsum) * 255;
        for (let c = 0; c < 4; c++) B[i * 4 + c] = (acc[c + 4] / wsum) * 255;
      }
    this.splatA.needsUpdate = true;
    this.splatB.needsUpdate = true;
  }

  updateOwner() {
    const w = this.game.world;
    const T = this.terr.image.data as Uint8Array;
    T.fill(0);
    for (let i = 0; i < w.N; i++) {
      const o = w.owner[i];
      if (o >= 0 && o < 4) T[i * 4 + o] = 255;
    }
    this.terr.needsUpdate = true;
  }

  updateOre() {
    const w = this.game.world;
    const O = this.ore.image.data as Uint8Array;
    O.fill(0);
    for (let i = 0; i < w.N; i++) {
      const o = w.ore[i];
      if (o > 0) O[i * 4 + (o - 1)] = Math.min(255, 60 + w.oreAmt[i] * 10);
    }
    this.ore.needsUpdate = true;
  }

  updateMisc(full: boolean) {
    const g = this.game;
    const w = g.world;
    const M = this.misc.image.data as Uint8Array;
    const W = w.W, H = w.H;
    const fields = new Uint8Array(w.N);
    for (const f of g.fields.values()) fields[f.node] = 255;
    for (let i = 0; i < w.N; i++) {
      M[i * 4] = w.explored[i] ? 255 : 0;
      M[i * 4 + 1] = Math.min(255, w.wear[i] * 255);
      M[i * 4 + 3] = fields[i];
    }
    if (full) this.bakeAO();
    this.misc.needsUpdate = true;
    void H;
  }

  /** Horizon-based ambient occlusion + contact darkening under buildings and trees. */
  bakeAO() {
    const g = this.game;
    const w = g.world;
    const W = w.W, H = w.H;
    const M = this.misc.image.data as Uint8Array;
    const dirs = 8;
    const occ = new Float32Array(w.N);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const h0 = Math.max(w.h[i], WATER_LEVEL - 0.5);
        let sum = 0;
        for (let d = 0; d < dirs; d++) {
          const a = (d / dirs) * Math.PI * 2;
          const cx = Math.cos(a), cy = Math.sin(a);
          let maxSlope = 0;
          for (let s = 1; s <= 6; s++) {
            const xx = Math.round(x + cx * s * 1.3), yy = Math.round(y + cy * s * 1.3);
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
            const dh = w.h[yy * W + xx] - h0;
            const sl = dh / (s * 1.3);
            if (sl > maxSlope) maxSlope = sl;
          }
          sum += Math.atan(maxSlope) / (Math.PI / 2);
        }
        occ[i] = sum / dirs;
      }
    // contact occlusion from buildings and trees
    const extra = new Float32Array(w.N);
    for (const b of g.buildings.values()) {
      if (b.state === 'leveling') continue;
      const r = b.size * 0.5 + 1.6;
      w.forRadius(b.cx, b.cz, r, (i, _x, _y, d2) => {
        const d = Math.sqrt(d2);
        const inside = d < b.size * 0.5;
        extra[i] = Math.max(extra[i], inside ? 0.5 : 0.45 * (1 - (d - b.size * 0.5) / 1.6));
      });
    }
    for (const t of g.trees.values()) {
      if (t.growth < 0.4) continue;
      const i = t.node;
      extra[i] = Math.max(extra[i], 0.25 * t.growth);
      const x = w.nx(i), y = w.ny(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        extra[j] = Math.max(extra[j], 0.12 * t.growth);
      }
    }
    for (let i = 0; i < w.N; i++) {
      const ao = Math.max(0.15, 1 - occ[i] * 1.5 - extra[i]);
      M[i * 4 + 2] = ao * 255;
    }
  }

  update(dt: number) {
    const w = this.game.world;
    this.updateHeights();
    if (w.splatDirty) {
      w.splatDirty = false;
      this.updateSplat();
      this.updateOre();
      this.aoT = Math.min(this.aoT, 0.3);
    }
    if (w.ownerDirty) {
      w.ownerDirty = false;
      this.updateOwner();
    }
    this.wearT -= dt;
    this.aoT -= dt;
    if (w.exploredDirty || this.wearT <= 0 || this.aoT <= 0) {
      const full = this.aoT <= 0;
      if (full) this.aoT = 3;
      if (this.wearT <= 0) this.wearT = 1.5;
      w.exploredDirty = false;
      this.updateMisc(full);
    }
  }
}
