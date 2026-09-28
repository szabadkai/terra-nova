// Terrain mesh with a procedural, multi-material splat shader.
import * as THREE from 'three';
import type { Game } from '../game/game';
import { WATER_LEVEL } from '../game/world';
import { G, patchMaterial } from './shaderPatch';
import { getTerrainDetail } from './terrainDetail';

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
uniform vec4 uHov;
uniform vec3 uHovCol;
uniform vec4 uRange;
uniform vec3 uRangeCol;
uniform vec4 uSpell;
uniform vec3 uSpellCol;
uniform float uBorderOn;
uniform float uSunI;
varying vec3 vWNormal;

#define C(r,g,b) pow(vec3(float(r),float(g),float(b))/255.0, vec3(2.2))

vec4 triN(vec3 wp, vec3 w3, float scale, vec2 off) {
  return texture2D(tNoise, wp.zy * scale + off) * w3.x + texture2D(tNoise, wp.xz * scale + off) * w3.y + texture2D(tNoise, wp.xy * scale + off) * w3.z;
}

float tBump;
float tRough;
float tAO;
vec3 tEmis;
vec3 tDetG;

// close-up detail layers (see terrainDetail.ts): two lookups per layer at different
// rotations/scales, merged height-aware so the tiling never shows.
uniform sampler2DArray tDetail;
uniform sampler2DArray tDetailN;
const mat2 DROT = mat2(0.4536, 0.8912, -0.8912, 0.4536);
vec2 dUv1, dUv2, dD1x, dD1y, dD2x, dD2y;
float dMix;

void detailAt(float layer, out vec4 A, out vec4 M) {
  vec4 a1 = textureGrad(tDetail, vec3(dUv1, layer), dD1x, dD1y);
  vec4 a2 = textureGrad(tDetail, vec3(dUv2, layer), dD2x, dD2y);
  vec4 m1 = textureGrad(tDetailN, vec3(dUv1, layer), dD1x, dD1y);
  vec4 m2 = textureGrad(tDetailN, vec3(dUv2, layer), dD2x, dD2y);
  float b = clamp(0.5 + ((a2.a - a1.a) * 0.6 + dMix - 0.5) * 5.0, 0.0, 1.0);
  A = mix(a1, a2, b);
  vec2 g1 = m1.rg * 2.0 - 1.0;
  vec2 g2 = (m2.rg * 2.0 - 1.0) * DROT; // back into world orientation
  M = vec4(mix(g1, g2, b), mix(m1.b, m2.b, b), mix(m1.a, m2.a, b));
}
vec3 dMod(vec4 A, float k) { return mix(vec3(1.0), A.rgb * 2.5, k); }
// grass through the year (uSeasonA.z fresh, uSeasonB.x dry): lime in spring, straw by late summer, dormant in winter
vec3 seasonGrass(vec3 c, float n) {
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  float d = clamp(uSeasonB.x * (0.75 + n * 0.5), 0.0, 1.0);
  // summer straw is golden, dormant winter grass a duller olive-brown
  vec3 dry = mix(vec3(1.35, 1.0, 0.32) * 1.15, vec3(1.12, 1.0, 0.58) * 0.9, uSeasonB.w);
  c = mix(c, lum * dry, d * 0.8);
  return mix(c, c * vec3(1.04, 1.1, 0.88), uSeasonA.z * 0.7);
}
vec3 hash32(vec2 q) {
  vec3 p3 = fract(vec3(q.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
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

  // ---- close-up detail
  float detK = 1.0 - smoothstep(24.0, 66.0, camDist);
  dUv1 = p * 0.5;
  dUv2 = DROT * p * 0.43 + vec2(0.37, 0.71);
  dD1x = dFdx(dUv1); dD1y = dFdy(dUv1); dD2x = dFdx(dUv2); dD2y = dFdy(dUv2);
  vec3 wpx = dFdx(vWPos), wpy = dFdy(vWPos);
  dMix = smoothstep(0.3, 0.7, n2.r * 0.6 + n1.g * 0.4);
  vec4 dA0 = vec4(0.4, 0.4, 0.4, 0.5), dA1 = dA0, dA2 = dA0, dA3 = dA0, dA5 = dA0;
  vec4 dM0 = vec4(0.0, 0.0, 1.0, 0.5), dM1 = dM0, dM2 = dM0, dM3 = dM0, dM5 = dM0;
  if (detK > 0.001) {
    if (w[0] + w[1] > 0.001) detailAt(0.0, dA0, dM0);
    if (w[2] > 0.001) detailAt(1.0, dA1, dM1);
    if (w[3] > 0.001 || misc.a > 0.01) detailAt(2.0, dA2, dM2);
    if (w[4] + w[6] > 0.001) detailAt(3.0, dA3, dM3);
    if (w[7] > 0.001) detailAt(5.0, dA5, dM5);
  }
  vec3 dg = vec3(0.0);
  float dCav = 0.0, dRough = 0.0;

  float hts[8];
  hts[0] = n3.r * 0.55 + n4.g * 0.45;
  hts[1] = n3.g * 0.55 + n4.r * 0.45;
  hts[2] = n2.b * 0.5 + n3.b * 0.5;
  hts[3] = n2.r * 0.35 + n4.b * 0.3;
  hts[4] = n2.g * 0.3 + n3.a * 0.1;
  hts[5] = n1.r * 0.55 + n2.r * 0.55;
  hts[6] = n1.g * 0.4 + 0.35;
  hts[7] = n2.a * 0.25;
  // fine detail relief makes transitions ragged up close (blades poking through soil)
  float dhK = detK * (1.0 - smoothstep(10.0, 30.0, camDist) * 0.6);
  hts[0] += (dA0.a - 0.5) * 0.3 * dhK; hts[1] += (dA0.a - 0.5) * 0.3 * dhK;
  hts[2] += (dA1.a - 0.5) * 0.26 * dhK; hts[3] += (dA2.a - 0.5) * 0.26 * dhK;
  hts[4] += (dA3.a - 0.5) * 0.2 * dhK; hts[7] += (dA5.a - 0.5) * 0.2 * dhK;
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
    vec3 c = mix(C(60,118,32), C(92,140,42), smoothstep(0.3, 0.75, n0.r));
    c = mix(c, C(40,90,30), smoothstep(0.45, 0.8, n1.g) * 0.5);
    c *= 0.88 + 0.24 * mix(0.5, n4.r * 0.7 + n5.g * 0.3, farFade * (1.0 - detK));
    c = mix(c, C(118,150,54), smoothstep(0.74, 0.95, n2.g) * 0.25);
    c *= dMod(dA0, detK);
    c = seasonGrass(c, n1.g);
    dg += vec3(dM0.x, 0.0, dM0.y) * 0.7 * v[0]; dCav += dM0.z * v[0]; dRough += dM0.w * v[0];
    col += c * v[0]; rough += 0.95 * v[0]; bump += (n4.r * 0.5 + n5.r * 0.5) * 0.35 * (1.0 - detK) * v[0];
  }
  // meadow with flowers
  if (v[1] > 0.0) {
    vec3 c = mix(C(72,128,38), C(104,150,48), n0.g);
    c *= 0.88 + 0.24 * mix(0.5, n4.g, farFade * (1.0 - detK));
    c *= dMod(dA0, detK);
    c = seasonGrass(c, n0.r);
    // flowers grow in scattered drifts through spring and summer and are gone by winter;
    // the drifts follow the lighter, drier patches of the sward
    float bloom = uSeasonB.z;
    float fpatch = smoothstep(0.52, 0.7, n0.r * 0.55 + n1.r * 0.45) * min(bloom, 1.0);
    vec4 fl = texture2D(tNoise, pr1 * 0.62 + vec2(0.2, 0.9));
    float f = (1.0 - smoothstep(0.1, 0.24, fl.b)) * step(0.95, fl.a) * farFade * fpatch * (1.0 - detK);
    vec3 fc = fl.a > 0.98 ? C(252,212,58) : fl.a > 0.965 ? C(176,118,222) : C(248,244,236);
    c = mix(c, fc, f);
    // up close: analytic five-petal flowers, crisp at any zoom, in the same drifts
    vec2 fp = p * 4.0;
    float fw = (fwidth(fp.x) + fwidth(fp.y)) * 0.7;
    if (detK > 0.001 && fpatch > 0.001) {
      vec2 fi = floor(fp), ff = fract(fp) - 0.5;
      vec3 hh = hash32(fi);
      float h1 = hh.x, h2 = hh.y, h3 = hh.z;
      if (h1 < 0.25 * fpatch) {
        vec2 d = ff - (vec2(h2, h3) - 0.5) * 0.5;
        float r = length(d);
        float R = 0.1 + h2 * 0.07;
        float petal = R * (0.6 + 0.4 * abs(cos(atan(d.y, d.x) * 2.5 + h3 * 6.28)));
        float fm = (1.0 - smoothstep(petal - fw, petal + fw, r)) * detK;
        float core = 1.0 - smoothstep(R * 0.28 - fw, R * 0.28 + fw, r);
        float hc = fract(h3 * 7.13);
        vec3 pc = hc > 0.55 ? C(250,248,240) : hc > 0.3 ? C(255,214,50) : hc > 0.15 ? C(170,110,230) : C(236,110,130);
        pc *= 0.85 + 0.3 * smoothstep(0.0, R, r);
        c = mix(c, mix(pc, C(240,170,30), core), fm);
        f = max(f, fm);
      }
    }
    dg += vec3(dM0.x, 0.0, dM0.y) * 0.7 * (1.0 - f) * v[1]; dCav += mix(dM0.z, 1.0, f) * v[1]; dRough += dM0.w * v[1];
    col += c * v[1]; rough += 0.93 * v[1]; bump += (n4.g * 0.4 * (1.0 - detK) + f * 0.6) * 0.35 * v[1];
  }
  // forest floor
  if (v[2] > 0.0) {
    vec3 c = mix(C(62,98,34), C(74,92,38), smoothstep(0.35, 0.7, n2.r));
    c = mix(c, C(96,82,44), smoothstep(0.62, 0.9, n3.a) * 0.4);
    c = mix(c, C(48,78,30), smoothstep(0.5, 0.8, n0.g) * 0.5);
    c = seasonGrass(c, n2.r);
    // autumn leaf litter, fading to brown mulch over the winter
    if (uSeasonB.y > 0.01) {
      float lit = smoothstep(0.25, 0.65, uSeasonB.y * (0.55 + n3.a * 0.7 + n4.g * 0.2)) * (1.0 - uSeasonB.w * 0.3);
      vec3 lc = mix(C(176,96,30), C(150,58,26), smoothstep(0.4, 0.7, n2.g));
      lc = mix(lc, C(196,150,40), smoothstep(0.62, 0.85, n3.r) * 0.6);
      lc = mix(lc, C(104,82,62), uSeasonB.w * 0.85);
      c = mix(c, lc, lit);
    }
    c *= 0.86 + 0.26 * mix(0.5, n4.b, farFade * (1.0 - detK));
    c *= dMod(dA1, detK);
    dg += vec3(dM1.x, 0.0, dM1.y) * 0.8 * v[2]; dCav += dM1.z * v[2]; dRough += dM1.w * v[2];
    col += c * v[2]; rough += 0.97 * v[2]; bump += n4.b * 0.4 * (1.0 - detK) * v[2];
  }
  // dirt / packed earth
  if (v[3] > 0.0) {
    vec3 c = mix(C(116,86,56), C(142,110,74), n2.g);
    c *= 0.84 + 0.28 * n3.r;
    float peb = (1.0 - smoothstep(0.1, 0.24, n3.b)) * step(0.45, n3.a) * farFade * (1.0 - detK);
    c = mix(c, C(156,146,130), peb * 0.65);
    c = mix(c, c * 0.8, pathM * 0.35 * (1.0 - n4.r));
    c *= dMod(dA2, detK);
    dg += vec3(dM2.x, 0.0, dM2.y) * 0.9 * v[3]; dCav += dM2.z * v[3]; dRough += dM2.w * v[3];
    col += c * v[3]; rough += 0.95 * v[3]; bump += (n3.r * 0.4 + peb * 0.8) * 0.4 * v[3];
  }
  // sand
  if (v[4] > 0.0) {
    vec3 c = mix(C(212,188,134), C(228,208,158), n1.r);
    float rip = sin(dot(p, vec2(2.4, 1.1)) + n2.r * 7.0) * 0.5 + 0.5;
    c *= 0.92 + 0.08 * rip + 0.1 * (n4.r - 0.5) * farFade * (1.0 - detK);
    float wetS = 1.0 - smoothstep(0.02, 0.28, wh);
    c = mix(c, c * 0.58, wetS);
    c *= dMod(dA3, detK);
    dg += vec3(dM3.x, 0.0, dM3.y) * mix(0.6, 0.25, wetS) * v[4]; dCav += dM3.z * v[4]; dRough += dM3.w * v[4];
    col += c * v[4]; rough += mix(0.9, 0.35, wetS) * v[4]; bump += rip * 0.25 * v[4];
  }
  // rock (triplanar so cliffs don't stretch)
  if (v[5] > 0.0) {
    vec3 tw = pow(abs(vWNormal), vec3(4.0));
    tw /= (tw.x + tw.y + tw.z);
    vec4 r1 = triN(vWPos, tw, 0.047, vec2(0.31, 0.17));
    vec4 r2 = triN(vWPos, tw, 0.17, vec2(0.63, 0.41));
    vec4 r3 = triN(vWPos, tw, 0.61, vec2(0.11, 0.87));
    vec4 r4 = triN(vWPos, tw, 1.73, vec2(0.47, 0.29));
    float strata = sin(vWPos.y * 3.6 + r1.r * 4.0 + r2.g * 1.5) * 0.5 + 0.5;
    vec3 c = mix(C(96,90,82), C(128,120,108), strata * 0.45 + r2.b * 0.35 + r3.r * 0.2);
    c = mix(c, C(80,76,72), smoothstep(0.55, 0.8, r1.g) * 0.45);
    c = mix(c, C(118,100,82), smoothstep(0.6, 0.85, n0.r) * 0.35);
    float crack = (1.0 - smoothstep(0.0, 0.1, r3.b)) * step(0.55, r3.a) * 0.6 * farFade;
    c *= 1.0 - crack * 0.35;
    c *= 0.9 + 0.2 * r4.g * farFade * (1.0 - detK);
    c = mix(c, C(96,110,58), smoothstep(0.66, 0.9, r3.b) * (1.0 - slope) * 0.55);
    // triplanar close-up detail
    vec4 ra = vec4(0.4, 0.4, 0.4, 0.5);
    vec3 rgW = vec3(0.0);
    float rc = 1.0, rr = 0.5;
    if (detK > 0.001) {
      vec3 q = vWPos * 0.3333, qx = wpx * 0.3333, qy = wpy * 0.3333;
      ra = vec4(0.0); rc = 0.0; rr = 0.0;
      vec4 a, m;
      a = textureGrad(tDetail, vec3(q.zy, 4.0), qx.zy, qy.zy); m = textureGrad(tDetailN, vec3(q.zy, 4.0), qx.zy, qy.zy);
      ra += a * tw.x; rgW += vec3(0.0, m.g * 2.0 - 1.0, m.r * 2.0 - 1.0) * tw.x; rc += m.b * tw.x; rr += m.a * tw.x;
      a = textureGrad(tDetail, vec3(q.xz, 4.0), qx.xz, qy.xz); m = textureGrad(tDetailN, vec3(q.xz, 4.0), qx.xz, qy.xz);
      ra += a * tw.y; rgW += vec3(m.r * 2.0 - 1.0, 0.0, m.g * 2.0 - 1.0) * tw.y; rc += m.b * tw.y; rr += m.a * tw.y;
      a = textureGrad(tDetail, vec3(q.xy, 4.0), qx.xy, qy.xy); m = textureGrad(tDetailN, vec3(q.xy, 4.0), qx.xy, qy.xy);
      ra += a * tw.z; rgW += vec3(m.r * 2.0 - 1.0, m.g * 2.0 - 1.0, 0.0) * tw.z; rc += m.b * tw.z; rr += m.a * tw.z;
    }
    c *= dMod(ra, detK);
    dg += rgW * 1.1 * v[5]; dCav += rc * v[5]; dRough += rr * v[5];
    // ore specks (only where some ore is known: most rock has none, and the specks cost six taps)
    vec4 ore = texture2D(tOre, muv);
    float gold = 0.0;
    if (dot(ore, vec4(1.0)) > 0.001) {
      vec3 wp2 = vWPos + vec3(r2.g - 0.5, 0.0, r2.b - 0.5) * 0.9;
      vec4 on1 = triN(wp2, tw, 0.42, vec2(0.13, 0.57));
      vec4 on2 = triN(wp2, tw, 0.23, vec2(0.71, 0.33));
      float spk = (1.0 - smoothstep(0.08, 0.2, on1.b + n3.r * 0.08)) * step(0.62, on1.a) * farFade;
      float spk2 = (1.0 - smoothstep(0.06, 0.18, on2.b + n3.g * 0.08)) * step(0.78, on2.a);
      c = mix(c, C(28,26,28), clamp(ore.r * 2.0, 0.0, 1.0) * max(spk, spk2 * 0.6));
      c = mix(c, C(168,78,44), clamp(ore.g * 2.0, 0.0, 1.0) * max(spk, spk2 * 0.6));
      c = mix(c, C(214,206,196), clamp(ore.a * 2.0, 0.0, 1.0) * spk2 * 0.8);
      gold = clamp(ore.b * 2.0, 0.0, 1.0) * max(spk, spk2 * 0.6);
      c = mix(c, C(250,200,60), gold);
      tEmis += C(255,190,60) * gold * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.5 + on1.a * 40.0), 8.0)) * 1.4;
    }
    col += c * v[5]; rough += mix(0.72, 0.3, gold) * v[5]; bump += (r1.r * 0.3 + r2.r * 0.5 + r3.g * 0.3 - crack * 0.6) * 1.1 * v[5];
  }
  // snow
  if (v[6] > 0.0) {
    vec3 c = mix(C(234,240,248), C(212,224,242), n2.r * 0.8);
    c = mix(c, C(190,205,230), slope * 0.6);
    tEmis += vec3(0.8, 0.9, 1.0) * pow(n5.a, 40.0) * 2.0 * farFade;
    c *= dMod(dA3, detK * 0.25);
    dg += vec3(dM3.x, 0.0, dM3.y) * 0.3 * v[6]; dCav += mix(1.0, dM3.z, 0.3) * v[6]; dRough += 0.5 * v[6];
    col += c * v[6]; rough += 0.55 * v[6]; bump += n2.r * 0.4 * v[6];
  }
  // swamp
  if (v[7] > 0.0) {
    vec3 c = mix(C(70,80,42), C(56,62,38), n2.g);
    float pud = (1.0 - smoothstep(0.36, 0.44, n1.g + (n3.r - 0.5) * 0.1));
    c = mix(c, C(34,46,44), pud * 0.85);
    c *= dMod(dA5, detK * (1.0 - pud * 0.8));
    dg += vec3(dM5.x, 0.0, dM5.y) * 0.7 * (1.0 - pud) * v[7]; dCav += mix(dM5.z, 1.0, pud) * v[7]; dRough += mix(dM5.w, 0.5, pud) * v[7];
    col += c * v[7]; rough += mix(0.9, 0.08, pud) * v[7]; bump += (1.0 - pud) * n3.r * 0.4 * v[7];
  }

  // tilled farm soil
  float tilled = misc.a;
  if (tilled > 0.01) {
    float furrow = sin(p.x * 8.0 + n2.r * 2.0) * 0.5 + 0.5;
    vec3 soil = mix(C(92,64,40), C(120,86,54), furrow) * (0.9 + 0.2 * n4.r) * dMod(dA2, detK);
    col = mix(col, soil, tilled);
    bump = mix(bump, furrow * 0.5, tilled);
    dg = mix(dg, vec3(dM2.x, 0.0, dM2.y) * 0.9, tilled); dCav = mix(dCav, dM2.z, tilled); dRough = mix(dRough, dM2.w, tilled);
  }

  // detail cavities darken crevices between blades / around pebbles; per-texel roughness
  col *= mix(1.0, dCav, detK * 0.75);
  rough = clamp(rough * mix(1.0, dRough * 2.0, detK), 0.04, 1.0);
  tDetG = dg * detK;

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
    tDetG *= 1.0 - smoothstep(0.0, 0.6, depth);
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
  // the building under the pointer
  if (uHov.w > 0.0) {
    float d = abs(length(p - uHov.xz) - uHov.w);
    tEmis += uHovCol * ((1.0 - smoothstep(0.0, 0.07, d)) * 0.75 + (1.0 - smoothstep(0.0, 0.28, d)) * 0.2);
  }
  // work range circle
  if (uRange.w > 0.0) {
    float d = length(p - uRange.xz);
    float ang = atan(p.y - uRange.z, p.x - uRange.x);
    float dash = step(0.5, fract(ang * uRange.w * 0.8 / 6.2831 * 2.0 + uTime * 0.2));
    float ring = (1.0 - smoothstep(0.0, 0.1, abs(d - uRange.w))) * dash;
    float fill = (1.0 - smoothstep(uRange.w - 0.2, uRange.w, d)) * 0.05;
    tEmis += uRangeCol * (ring * 0.9 + fill);
  }
  // divine rune circle
  if (uSpell.w > 0.0) {
    vec2 q = p - uSpell.xy;
    float d = length(q);
    float R = uSpell.z;
    if (d < R + 0.6) {
      float a = atan(q.y, q.x);
      float rot = uTime * 0.35;
      float aw = fwidth(d) + 0.02;
      float ring1 = 1.0 - smoothstep(0.0, aw + 0.05, abs(d - R));
      float ring2 = 1.0 - smoothstep(0.0, aw + 0.035, abs(d - R * 0.84));
      float ring3 = 1.0 - smoothstep(0.0, aw + 0.03, abs(d - R * 0.3));
      // rune glyphs in the band between the outer rings
      float seg = (a + rot) / 6.2831853 * 28.0;
      float cellId = floor(seg);
      float cu = fract(seg), cv = (d - R * 0.86) / (R * 0.12);
      float h1 = fract(sin(cellId * 91.7 + 3.1) * 43758.5);
      float h2 = fract(sin(cellId * 47.3 + 7.7) * 24634.6);
      float inBand = step(0.0, cv) * step(cv, 1.0) * step(0.18, cu) * step(cu, 0.82);
      float stroke = 0.0;
      stroke += (1.0 - smoothstep(0.0, 0.09, abs(cu - 0.5))) * step(0.25, h1);
      stroke += (1.0 - smoothstep(0.0, 0.09, abs(cv - mix(0.2, 0.8, h2)))) * step(0.4, h2);
      stroke += (1.0 - smoothstep(0.0, 0.1, abs((cu - 0.18) / 0.64 - cv))) * step(0.6, h1);
      float glyph = inBand * min(1.0, stroke);
      // a rotating star between the inner rings
      float star = (1.0 - smoothstep(0.0, 0.05 + aw, abs(sin((a - rot * 1.6) * 2.5)) * d)) * step(R * 0.3, d) * step(d, R * 0.84);
      float fill = (1.0 - smoothstep(R * 0.2, R, d)) * 0.12;
      float pulse = 0.8 + 0.2 * sin(uTime * 3.0 - d * 1.5);
      tEmis += uSpellCol * (ring1 * 1.3 + ring2 + ring3 * 0.8 + glyph * 1.1 + star * 0.55 + fill) * uSpell.w * pulse;
    }
  }

  tBump = bump;
  tRough = rough;
  tAO = misc.b * mix(1.0, dCav, detK * 0.5);
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
    float dist = length(vViewPosition);
    float scale = 0.9 * (1.0 - smoothstep(15.0, 80.0, dist)) * (0.35 + 0.65 * smoothstep(20.0, 60.0, dist));
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(det) * normal - grad * scale);
    normal = normalize(normal + (viewMatrix * vec4(tDetG, 0.0)).xyz);
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
    G.tHeight.value = this.heightTex;
    G.tFog.value = this.misc;
    G.uMapSize.value.set(W, H);
    const detail = getTerrainDetail();

    this.uniforms = {
      tSplatA: { value: this.splatA },
      tSplatB: { value: this.splatB },
      tTerr: { value: this.terr },
      tOre: { value: this.ore },
      uWaterLevel: { value: WATER_LEVEL },
      uPlayerCols: { value: game.players.map((p) => new THREE.Color(p.color)).concat([new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()]).slice(0, 4) },
      uSel: { value: new THREE.Vector4(0, 0, 0, 0) },
      uHov: { value: new THREE.Vector4(0, 0, 0, 0) },
      uHovCol: { value: new THREE.Color(1, 1, 1) },
      uRange: { value: new THREE.Vector4(0, 0, 0, 0) },
      uRangeCol: { value: new THREE.Color(0.45, 0.85, 1.0) },
      uSpell: { value: new THREE.Vector4(0, 0, 0, 0) },
      uSpellCol: { value: new THREE.Color(1, 0.8, 0.3) },
      uBorderOn: { value: 1 },
      uSunI: { value: 1 },
      tDetail: { value: detail.albedo },
      tDetailN: { value: detail.normal },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    patchMaterial(mat, {
      key: 'terrain',
      snow: 0.95,
      uniforms: this.uniforms,
      vertexHead: 'varying vec3 vWNormal;',
      vertexBegin: 'vWNormal = normalize(mat3(modelMatrix) * objectNormal);',
      fragHead: TERRAIN_FRAG_HEAD,
      fragMap: 'tBump = 0.0; tRough = 1.0; tAO = 1.0; tEmis = vec3(0.0); tDetG = vec3(0.0);\n' + TERRAIN_MAP,
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

  /** Ore specks glitter only where the local player's geologists have probed. */
  updateOre() {
    const w = this.game.world;
    const O = this.ore.image.data as Uint8Array;
    O.fill(0);
    const local = this.game.local;
    for (let i = 0; i < w.N; i++) {
      const o = w.ore[i];
      if (o > 0 && w.known(i, local)) O[i * 4 + (o - 1)] = Math.min(255, 60 + w.oreAmt[i] * 10);
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
      w.oreDirty = true;
      this.aoT = Math.min(this.aoT, 0.3);
    }
    if (w.oreDirty) {
      w.oreDirty = false;
      this.updateOre();
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
