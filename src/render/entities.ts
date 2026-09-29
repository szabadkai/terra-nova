// Instanced renderers for trees, rocks, fields, grass, animals, goods and arrows (settlers live in settlers.ts).
import * as THREE from 'three';
import { GOODS, Good, T_FOREST, T_GRASS, T_MEADOW } from '../game/defs';
import type { Game } from '../game/game';
import type { Animal, Tree } from '../game/types';
import { BURROW_TIME } from '../game/wildlife';
import { WATER_LEVEL } from '../game/world';
import { hash2 } from '../core/rng';
import { DEER_HEAD, DEER_HIPS, DEER_KNEE, DEER_NECK, buildDeerGeos, buildGoodGeos, buildHareGeos, buildGrassTuft, buildRockGeos, buildTreeGeos, buildVineGeos, buildWheatGeo } from './models';
import { G, patchMaterial, patchedDepthMaterial } from './shaderPatch';
import { getTerrainDetail } from './terrainDetail';
import { leafTexture, twigTexture } from './textures';
import { LOD_PIXELS, LodPair, lodView, simplify } from './lod';
import { commitInstances, uploadFirst, withInstanceColor } from './instancing';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function vcMat(opts: THREE.MeshStandardMaterialParameters = {}, wind: 'none' | 'tree' | 'grass' = 'none', windAmp = 1, extra: any = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...opts });
  patchMaterial(m, { wind, windAmp, key: `vc_${wind}_${windAmp}_${extra.key ?? ''}`, ...extra });
  return m;
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = true, depth?: THREE.Material) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.frustumCulled = false;
  if (depth) m.customDepthMaterial = depth;
  return m;
}

// ------------------------------------------------------------------ trees
// Deciduous foliage through the year (uSeasonA = leaf, turn, fresh, blossom from seasons.ts).
// Crowns thin out by noise, leaf cards drop one by one and then show bare twigs instead.
const DECIDUOUS: Record<number, { autumnA: number; autumnB: number; twig: number; blossom: number }> = {
  0: { autumnA: 0xe0901c, autumnB: 0xb4441a, twig: 0x7e6c5c, blossom: 0 }, // oak: gold to russet
  2: { autumnA: 0xf0c828, autumnB: 0xdca020, twig: 0x74625a, blossom: 0 }, // birch: bright yellow
  4: { autumnA: 0xd84020, autumnB: 0xe88a24, twig: 0x786452, blossom: 1 }, // fruit tree: red/orange, spring blossom
};
const leafVertHead = (cards: boolean) => `
varying vec3 vLeafP;
varying float vTreeR;
${cards ? 'attribute float aRnd;\nvarying float vCardR;\nvarying vec2 vCardUv;' : ''}`;
const leafVert = (cards: boolean) => `
  vLeafP = transformed;
  #ifdef USE_INSTANCING
    vTreeR = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vTreeR = 0.5;
  #endif
  ${cards ? 'vCardR = aRnd;\n  vCardUv = uv;' : ''}`;
const leafFragHead = (cards: boolean, depth: boolean) => `
varying vec3 vLeafP;
varying float vTreeR;
${depth ? 'uniform vec4 uSeasonA;\nuniform sampler2D tNoise;' : ''}
uniform vec3 uAutumnA;
uniform vec3 uAutumnB;
uniform vec3 uTwigCol;
uniform float uBlossomOn;
// staggered per tree: some trees turn and drop early, others late
float treeLeaf() { return clamp((uSeasonA.x - 0.5) * 1.6 + 0.5 + (vTreeR - 0.5) * 0.5, 0.0, 1.0); }
float treeTurn() { return clamp((uSeasonA.y - 0.5) * 1.6 + 0.5 - (vTreeR - 0.5) * 0.6, 0.0, 1.0); }
float crownNoise() {
  return texture2D(tNoise, vLeafP.xy * 1.4 + vTreeR * 5.0).r * 0.5 + texture2D(tNoise, vLeafP.zy * 1.4 + 0.37).g * 0.5;
}
bool crownGone(float nz) { float tl = treeLeaf(); return nz > tl * tl * 1.1 - 0.05; }
vec3 seasonLeaf(vec3 base, float vary) {
  const vec3 W = vec3(0.3, 0.59, 0.11);
  float lum = dot(base, W);
  float tt = clamp(treeTurn() * 1.25 - vary * 0.3, 0.0, 1.0);
  vec3 hue = mix(uAutumnA, uAutumnB, fract(vTreeR * 7.31));
  // turned leaves are brighter than summer green; the last ones wither to brown
  float wither = smoothstep(0.82, 1.0, tt);
  hue = mix(hue, vec3(0.3, 0.17, 0.07), wither * 0.85);
  vec3 turned = hue * (lum / max(dot(hue, W), 1e-3)) * (1.9 - wither * 0.8);
  vec3 c = mix(base, turned, smoothstep(0.05, 0.5, tt));
  return mix(c, c * vec3(1.2, 1.25, 0.7), uSeasonA.z * 0.6);
}
${cards ? `
varying float vCardR;
varying vec2 vCardUv;
uniform sampler2D tLeaf;
uniform sampler2D tTwig;
// 0 bare twigs, 1 leaves, 2 blossom
float cardState() {
  float nz = texture2D(tNoise, vCardUv * 0.4 + vCardR * 3.1).r;
  float score = vCardR * 0.8 + nz * 0.2;
  if (score < treeLeaf() * 1.05 - 0.02) return 1.0;
  if (score < uSeasonA.w * uBlossomOn * 0.9) return 2.0;
  return 0.0;
}
float cardAlpha(float st) {
  // thin twigs keep their coverage in the distance instead of dissolving in the lower mips
  vec2 tuv = vCardUv * 256.0;
  float lod = max(0.0, 0.5 * log2(max(dot(dFdx(tuv), dFdx(tuv)), dot(dFdy(tuv), dFdy(tuv)))));
  float la = texture2D(tLeaf, vCardUv).a;
  float ta = texture2D(tTwig, vCardUv).a * (1.0 + lod * 0.35);
  return st > 0.5 ? la : ta;
}` : ''}`;

/** Geometric error allowed in a far tree (model units): used once it is under LOD_PIXELS on screen. */
const TREE_FAR_ERR = 0.03;

export class TreesRenderer {
  group = new THREE.Group();
  private trunks: LodPair[] = [];
  private crowns: LodPair[] = [];
  private cards: (LodPair | null)[] = [];
  private limbs: (LodPair | null)[] = [];
  private version = -1;
  private fallStart = new Map<number, number>();
  private leafMat: THREE.Material;
  // every tree's instance, rebuilt when the forest changes; culled and sorted by level every frame
  private n = 0;
  private mats = new Float32Array(0);
  private cols: THREE.Color[] = [];
  private species = new Uint8Array(0);
  private spheres = new Float32Array(0);
  private falling: { i: number; id: number }[] = [];
  /** deciduous crowns: a thinning material (cuts the crown away as leaves fall) and a full one */
  private crownMats: { sp: number; thin: THREE.Material; thinDepth: THREE.Material; full: THREE.Material; fullDepth: THREE.Material }[] = [];
  private fullLeaf: boolean | null = null;

  constructor(private game: Game) {
    const geos = buildTreeGeos();
    const barkMat = vcMat({ roughness: 0.95 }, 'tree', 0.6, { snow: 0.35, key: 'bark' });
    const limbMat = vcMat({ roughness: 0.95 }, 'tree', 1, { snow: 0.5, key: 'limb' });
    const leafEmissive = (k: number, back: number, twig = '1.0') => `{
        vec3 V = normalize(vViewPosition);
        vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float back = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * (${k} + back * ${back}) * (1.0 - uNight * 0.8) * ${twig};
      }`;
    this.leafMat = vcMat({ roughness: 0.8, side: THREE.DoubleSide }, 'tree', 1, {
      key: 'leaf',
      snow: 0.8,
      fragEmissive: leafEmissive(0.1, 0.35),
    });
    const depth = patchedDepthMaterial({ wind: 'tree' });
    const leafTex = leafTexture(0);
    const needleTex = leafTexture(1);
    const twigTex = twigTexture();
    const mkCard = (map: THREE.Texture, key: string) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, map, alphaTest: 0.45, side: THREE.DoubleSide });
      return patchMaterial(m, { wind: 'tree', key, snow: 0.75, fragEmissive: leafEmissive(0.08, 0.45) });
    };
    const needleMat = mkCard(needleTex, 'needlecard');
    const needleDepth = patchedDepthMaterial({ wind: 'tree', map: needleTex, alphaTest: 0.45, key: 'nd' });
    // per-species seasonal materials (same programs, own colours)
    const seasonal = (sp: number) => {
      const d = DECIDUOUS[sp];
      const uniforms = {
        uAutumnA: { value: new THREE.Color(d.autumnA) }, uAutumnB: { value: new THREE.Color(d.autumnB) },
        uTwigCol: { value: new THREE.Color(d.twig) }, uBlossomOn: { value: d.blossom },
        tLeaf: { value: leafTex }, tTwig: { value: twigTex },
      };
      const depthU = { ...uniforms, uSeasonA: G.uSeasonA, tNoise: G.tNoise };
      const crown = vcMat({ roughness: 0.8, side: THREE.DoubleSide }, 'tree', 1, {
        key: 'leafS', snow: 0.8, uniforms,
        vertexHead: leafVertHead(false), vertexBegin: leafVert(false), fragHead: leafFragHead(false, false),
        fragRough: `{
          float nzC = crownNoise();
          if (crownGone(nzC)) discard;
          diffuseColor.rgb = seasonLeaf(diffuseColor.rgb, nzC);
        }`,
        fragEmissive: leafEmissive(0.1, 0.35),
      });
      // in full leaf nothing is ever cut out of the crown: without the discard (and with its hidden
      // inside faces culled) the GPU can drop the crown's covered pixels before shading them
      const crownFull = vcMat({ roughness: 0.8 }, 'tree', 1, {
        key: 'leafSf', snow: 0.8, uniforms,
        vertexHead: leafVertHead(false), vertexBegin: leafVert(false), fragHead: leafFragHead(false, false),
        fragRough: 'diffuseColor.rgb = seasonLeaf(diffuseColor.rgb, crownNoise());',
        fragEmissive: leafEmissive(0.1, 0.35),
      });
      const crownDepth = patchedDepthMaterial({
        wind: 'tree', key: 'leafSd', uniforms: depthU,
        vertexHead: leafVertHead(false), vertexBegin: leafVert(false), fragHead: leafFragHead(false, true),
        fragPost: 'if (crownGone(crownNoise())) discard;',
      });
      const card = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, alphaTest: 0.45, side: THREE.DoubleSide }), {
        wind: 'tree', key: 'cardS', snow: 0.75, uniforms,
        vertexHead: leafVertHead(true), vertexBegin: leafVert(true), fragHead: leafFragHead(true, false),
        fragMap: `
  float lfSt = cardState();
  diffuseColor.a *= cardAlpha(lfSt);
  if (lfSt > 0.5) diffuseColor.rgb *= texture2D(tLeaf, vCardUv).rgb;`,
        fragRough: `{
          if (lfSt < 0.5) diffuseColor.rgb = uTwigCol * clamp(dot(vColor.rgb, vec3(0.3, 0.59, 0.11)) * 2.4, 0.45, 1.25);
          else if (lfSt > 1.5) diffuseColor.rgb = vec3(1.0, 0.76, 0.84) * clamp(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * 4.0, 0.55, 1.15);
          else diffuseColor.rgb = seasonLeaf(diffuseColor.rgb, 1.0 - vCardR);
        }`,
        fragEmissive: leafEmissive(0.08, 0.45, '(lfSt < 0.5 ? 0.15 : 1.0)'),
      });
      const cardDepth = patchedDepthMaterial({
        wind: 'tree', key: 'cardSd', uniforms: depthU,
        vertexHead: leafVertHead(true), vertexBegin: leafVert(true), fragHead: leafFragHead(true, true),
        fragPost: 'if (cardAlpha(cardState()) < 0.45) discard;',
      });
      return { crown, crownFull, crownDepth, card, cardDepth };
    };
    const cap = Math.max(4000, game.trees.size * 2);
    const far = (g: THREE.BufferGeometry) => simplify(g, 0.2, TREE_FAR_ERR).geo;
    const pair = (near: THREE.BufferGeometry, farGeo: THREE.BufferGeometry, mat: THREE.Material, dm: THREE.Material, colors: 0 | 1) => {
      const p = new LodPair(near, farGeo, mat, cap, { colors, depth: dm });
      this.group.add(...p.meshes);
      return p;
    };
    geos.forEach((g, sp) => {
      const sm = DECIDUOUS[sp] ? seasonal(sp) : null;
      this.trunks.push(pair(g.trunk, far(g.trunk), barkMat, depth, 0));
      this.crowns.push(pair(g.crown, far(g.crown), sm ? sm.crown : this.leafMat, sm ? sm.crownDepth : depth, 1));
      if (sm) this.crownMats.push({ sp, thin: sm.crown, thinDepth: sm.crownDepth, full: sm.crownFull, fullDepth: depth });
      if (g.cards) {
        const cf = g.cardsFar ?? g.cards;
        this.cards.push(g.needles ? pair(g.cards, cf, needleMat, needleDepth, 1) : pair(g.cards, cf, sm!.card, sm!.cardDepth, 1));
      } else this.cards.push(null);
      this.limbs.push(g.branches ? pair(g.branches, far(g.branches), limbMat, depth, 0) : null);
    });
  }

  /** Recompute every tree's matrix and tint (when the forest changed). */
  private rebuild(time: number) {
    const g = this.game;
    const w = g.world;
    const n = g.trees.size;
    if (this.mats.length < n * 16) {
      this.mats = new Float32Array(n * 32);
      this.species = new Uint8Array(n * 2);
      this.spheres = new Float32Array(n * 8);
    }
    while (this.cols.length < n) this.cols.push(new THREE.Color());
    this.falling.length = 0;
    let i = 0;
    for (const t of g.trees.values()) {
      this.species[i] = t.species;
      const tint = 0.85 + hash2(t.node, 4, 7) * 0.3;
      // a few copper-leaved trees for variety (real autumn colour comes from the season)
      const warm = hash2(t.node, 6, 7) > 0.9 ? 0.12 : 0;
      this.cols[i].setRGB(tint * (1 + warm * 0.9), tint * (0.95 + hash2(t.node, 5, 7) * 0.1), tint * (0.9 - warm));
      if (t.state === 'falling') this.falling.push({ i, id: t.id });
      this.place(i, t, time);
      i++;
    }
    this.n = i;
  }

  private place(i: number, t: Tree, time: number) {
    const w = this.game.world;
    const x = w.nx(t.node) + (hash2(t.node, 1, 7) - 0.5) * 0.5;
    const z = w.ny(t.node) + (hash2(t.node, 2, 7) - 0.5) * 0.5;
    const y = w.heightAt(x, z) - 0.05;
    const s = t.scale * (0.18 + 0.82 * Math.min(1, t.growth));
    tmpE.set(0, t.rot, 0);
    tmpQ.setFromEuler(tmpE);
    if (t.state === 'falling') {
      let st = this.fallStart.get(t.id);
      if (st === undefined) { st = time; this.fallStart.set(t.id, st); }
      const k = Math.min(1, (time - st) / 1.5);
      const ang = k * k * (Math.PI / 2 - 0.08);
      const axis = tmpV.set(Math.cos(t.fallDir), 0, -Math.sin(t.fallDir)).normalize();
      tmpQ.premultiply(tmpQ2.setFromAxisAngle(axis, ang));
    }
    tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(s, s * (0.95 + hash2(t.node, 3, 7) * 0.15), s));
    tmpM.toArray(this.mats, i * 16);
    const sp = this.spheres;
    sp[i * 4] = x; sp[i * 4 + 1] = y + 1.2 * s; sp[i * 4 + 2] = z; sp[i * 4 + 3] = 1.7 * s;
  }

  update(time: number) {
    const g = this.game;
    if (g.treesVersion !== this.version) {
      this.version = g.treesVersion;
      this.rebuild(time);
    } else {
      // only falling trees move between rebuilds
      for (const f of this.falling) {
        const t = g.trees.get(f.id);
        if (t) this.place(f.i, t, time);
      }
    }
    // bare limbs only matter once the crowns start to thin
    const bare = G.uSeasonA.value.x < 0.97;
    // no crown is cut away above 0.96 leaf, the least leafy tree included (see treeLeaf/crownGone)
    const full = G.uSeasonA.value.x >= 0.96;
    if (full !== this.fullLeaf) {
      this.fullLeaf = full;
      for (const c of this.crownMats) for (const m of this.crowns[c.sp].meshes) {
        m.material = full ? c.full : c.thin;
        m.customDepthMaterial = full ? c.fullDepth : c.thinDepth;
      }
    }
    const V = lodView;
    const sp = this.spheres, M = this.mats;
    for (let i = 0; i < this.n; i++) {
      const x = sp[i * 4], y = sp[i * 4 + 1], z = sp[i * 4 + 2], r = sp[i * 4 + 3];
      const c = V.cull(x, y, z, r);
      if (!c) continue;
      // the tree's scale sits in its matrix: far detail goes where its error shrinks under a pixel
      const lv = c === 1 ? -1 : V.px(x, y, z) * TREE_FAR_ERR * (r / 1.7) < LOD_PIXELS ? 1 : 0;
      const s = this.species[i];
      const col = this.cols[i];
      this.trunks[s].addArray(lv, M, i * 16);
      this.crowns[s].addArray(lv, M, i * 16, col);
      this.cards[s]?.addArray(lv, M, i * 16, col);
      if (bare) this.limbs[s]?.addArray(lv, M, i * 16);
    }
    for (const p of [...this.trunks, ...this.crowns, ...this.cards, ...this.limbs]) p?.finish();
    if (this.fallStart.size > 200) {
      for (const id of this.fallStart.keys()) if (!g.trees.has(id)) this.fallStart.delete(id);
    }
  }
}

// ------------------------------------------------------------------ rocks
// Stone deposits wear the mountains' rock: the same macro palette and, up close, the same
// painted detail layer (facets, cracks, lichen) mapped triplanar in world space, so a
// quarry reads as a broken-off piece of the cliff. Vertex colours only darken crevices.
const ROCK_FRAG_HEAD = /* glsl */ `
uniform sampler2DArray tDetail;
uniform sampler2DArray tDetailN;
varying vec3 vWNormal;
varying float vRockR;
vec3 sDetG;
float sRough;
#define C(r,g,b) pow(vec3(float(r),float(g),float(b))/255.0, vec3(2.2))
vec4 rockN(vec3 wp, vec3 w3, float s, vec2 off) {
  return texture2D(tNoise, wp.zy * s + off) * w3.x + texture2D(tNoise, wp.xz * s + off) * w3.y + texture2D(tNoise, wp.xy * s + off) * w3.z;
}
`;
const ROCK_MAP = /* glsl */ `
  {
    vec3 wn = normalize(vWNormal);
    vec3 tw = pow(abs(wn), vec3(4.0));
    tw /= tw.x + tw.y + tw.z;
    float camDist = length(vViewPosition);
    float farFade = 1.0 - smoothstep(30.0, 90.0, camDist);
    float detK = 1.0 - smoothstep(24.0, 66.0, camDist);
    vec2 ro = vec2(vRockR, fract(vRockR * 7.31));
    vec4 r1 = rockN(vWPos, tw, 0.17, vec2(0.63, 0.41) + ro);
    vec4 r2 = rockN(vWPos, tw, 0.61, vec2(0.11, 0.87) + ro);
    vec4 r3 = rockN(vWPos, tw, 1.73, vec2(0.47, 0.29));
    vec4 r4 = rockN(vWPos, tw, 4.9, vec2(0.77, 0.19));
    vec3 c = mix(C(96,90,82), C(128,120,108), clamp(r1.r * 0.35 + r2.r * 0.35 + r3.g * 0.3 + (vRockR - 0.5) * 0.4, 0.0, 1.0));
    c = mix(c, C(80,76,72), smoothstep(0.55, 0.8, r1.g) * 0.45);
    c = mix(c, C(118,100,82), smoothstep(0.6, 0.85, r2.a) * 0.3);
    float crack = (1.0 - smoothstep(0.0, 0.1, r2.b)) * step(0.55, r2.a) * 0.6 * farFade;
    c *= 1.0 - crack * 0.35;
    c *= 0.9 + 0.2 * r3.r * farFade * (1.0 - detK);
    // close-up detail: the mountain's rock layer, a little denser to suit boulders
    vec3 q = vWPos * 0.45;
    vec4 ax = texture(tDetail, vec3(q.zy, 4.0)), ay = texture(tDetail, vec3(q.xz, 4.0)), az = texture(tDetail, vec3(q.xy, 4.0));
    vec4 mx = texture(tDetailN, vec3(q.zy, 4.0)), my = texture(tDetailN, vec3(q.xz, 4.0)), mz = texture(tDetailN, vec3(q.xy, 4.0));
    vec4 ra = ax * tw.x + ay * tw.y + az * tw.z;
    float rc = mx.b * tw.x + my.b * tw.y + mz.b * tw.z;
    float rr = mx.a * tw.x + my.a * tw.y + mz.a * tw.z;
    sDetG = (vec3(0.0, mx.g, mx.r) * 2.0 - vec3(0.0, 1.0, 1.0)) * tw.x
          + (vec3(my.r, 0.0, my.g) * 2.0 - vec3(1.0, 0.0, 1.0)) * tw.y
          + (vec3(mz.r, mz.g, 0.0) * 2.0 - vec3(1.0, 1.0, 0.0)) * tw.z;
    sDetG *= 1.05 * detK;
    // patchy moss and lichen on the tops
    float mossN = r2.g * 0.45 + r3.r * 0.15 + r4.r * 0.2 + mix(0.5, ra.a, detK) * 0.3 + (vRockR - 0.5) * 0.25;
    float moss = smoothstep(0.65, 0.69, mossN) * smoothstep(0.45, 0.9, wn.y);
    c = mix(c, mix(C(96,110,58), C(72,86,42), smoothstep(0.4, 0.7, r3.g)), moss * 0.65);
    c *= mix(vec3(1.0), ra.rgb * 2.5, detK);
    c *= mix(1.0, rc, detK * 0.75);
    c *= 1.0 - uWet * 0.28;
    sRough = mix(clamp(0.78 * mix(1.0, rr * 2.0, detK), 0.04, 1.0), 0.25, uWet * 0.7);
    diffuseColor.rgb *= c;
  }
`;

/** Geometric error allowed in a far rock (model units). */
const ROCK_FAR_ERR = 0.02;

export class StonesRenderer {
  group = new THREE.Group();
  private pairs: LodPair[] = [];
  private version = -1;
  // every deposit's instance, rebuilt when the stones change; culled and sorted by level every frame
  private n = 0;
  private mats = new Float32Array(0);
  private info = new Float32Array(0); // x, y, z, radius, variant
  constructor(private game: Game) {
    const detail = getTerrainDetail();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    patchMaterial(mat, {
      key: 'stones',
      snow: 1,
      grime: 0.5,
      uniforms: { tDetail: { value: detail.albedo }, tDetailN: { value: detail.normal } },
      vertexHead: 'varying vec3 vWNormal;\nvarying float vRockR;',
      vertexBegin: `vWNormal = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);
  #ifdef USE_INSTANCING
    vRockR = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vRockR = 0.5;
  #endif`,
      fragHead: ROCK_FRAG_HEAD,
      fragMap: ROCK_MAP,
      fragRough: 'roughnessFactor = sRough;',
      fragNormal: 'normal = normalize(normal + (viewMatrix * vec4(sDetG, 0.0)).xyz);',
    });
    for (const g of buildRockGeos()) {
      // cut faces keep their crisp edges in the far copy too
      const p = new LodPair(g, simplify(g, 0.2, ROCK_FAR_ERR, false, Math.PI / 4).geo, mat, 2000);
      this.pairs.push(p);
      this.group.add(...p.meshes);
    }
  }
  update() {
    const g = this.game;
    if (g.stonesVersion !== this.version) {
      this.version = g.stonesVersion;
      const w = g.world;
      const n = g.stones.size;
      if (this.mats.length < n * 16) { this.mats = new Float32Array(n * 32); this.info = new Float32Array(n * 10); }
      let i = 0;
      for (const s of g.stones.values()) {
        const x = w.nx(s.node), z = w.ny(s.node);
        const y = w.heightAt(x, z) - 0.08;
        const k = 0.55 + 0.6 * (s.amount / s.max);
        tmpE.set(0, s.rot, 0);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(k * 1.3, k * 1.25, k * 1.3));
        tmpM.toArray(this.mats, i * 16);
        const f = this.info;
        f[i * 5] = x; f[i * 5 + 1] = y + 0.35 * k; f[i * 5 + 2] = z; f[i * 5 + 3] = 1.1 * k; f[i * 5 + 4] = s.variant;
        i++;
      }
      this.n = i;
    }
    const V = lodView, f = this.info;
    for (let i = 0; i < this.n; i++) {
      const x = f[i * 5], y = f[i * 5 + 1], z = f[i * 5 + 2], r = f[i * 5 + 3];
      const c = V.cull(x, y, z, r);
      if (!c) continue;
      // the matrix scales the rock by about 1.3 k
      const lv = c === 1 ? -1 : V.px(x, y, z) * ROCK_FAR_ERR * r * 1.2 < LOD_PIXELS ? 1 : 0;
      this.pairs[f[i * 5 + 4]].addArray(lv, this.mats, i * 16);
    }
    for (const p of this.pairs) p.finish();
  }
}

// ------------------------------------------------------------------ wheat fields
export class FieldsRenderer {
  mesh: THREE.InstancedMesh;
  private version = -1;
  constructor(private game: Game) {
    const mat = vcMat({ roughness: 0.9 }, 'grass', 0.25, { snow: 0.6, key: 'wheat' });
    this.mesh = withInstanceColor(inst(buildWheatGeo(), mat, 1500, true));
  }
  update() {
    const g = this.game;
    if (g.fieldsVersion === this.version) return;
    this.version = g.fieldsVersion;
    const w = g.world;
    let n = 0;
    const green = new THREE.Color(0x6a9a38), gold = new THREE.Color(0xe0b850);
    for (const f of g.fields.values()) {
      if (f.kind !== 'grain') continue;
      const x = w.nx(f.node), z = w.ny(f.node);
      const y = w.heightAt(x, z);
      const s = 0.2 + 0.8 * f.growth;
      tmpQ.setFromAxisAngle(UP, hash2(f.node, 1, 3) * 6);
      tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(1.05, s, 1.05));
      this.mesh.setMatrixAt(n, tmpM);
      tmpC.copy(green).lerp(gold, Math.pow(f.growth, 2));
      this.mesh.setColorAt(n, tmpC);
      n++;
    }
    commitInstances(this.mesh, n);
  }
}

// ------------------------------------------------------------------ vineyards
export class VinesRenderer {
  group = new THREE.Group();
  private plants: THREE.InstancedMesh;
  private grapes: THREE.InstancedMesh;
  private version = -1;
  constructor(private game: Game) {
    const geos = buildVineGeos();
    this.plants = withInstanceColor(inst(geos.plant, vcMat({ roughness: 0.85 }, 'grass', 0.12, { snow: 0.5, key: 'vine' }), 1200, true));
    this.grapes = withInstanceColor(inst(geos.grapes, vcMat({ roughness: 0.35 }, 'grass', 0.1, { key: 'grape' }), 1200, true));
    this.group.add(this.plants, this.grapes);
  }
  update() {
    const g = this.game;
    if (g.fieldsVersion === this.version) return;
    this.version = g.fieldsVersion;
    const w = g.world;
    let n = 0, m = 0;
    const young = new THREE.Color(0x9ac860), unripe = new THREE.Color(0x8aa040), ripe = new THREE.Color(0x4a1848);
    for (const f of g.fields.values()) {
      if (f.kind !== 'vine') continue;
      const x = w.nx(f.node), z = w.ny(f.node);
      const y = w.heightAt(x, z);
      const s = Math.min(1, 0.3 + f.growth * 1.4);
      tmpQ.setFromAxisAngle(UP, (hash2(f.node, 1, 9) - 0.5) * 0.2);
      tmpM.compose(tmpS.set(x, y - 0.02, z), tmpQ, tmpV.set(s, s, 1));
      this.plants.setMatrixAt(n, tmpM);
      tmpC.set(0xffffff).lerp(young, Math.max(0, 0.5 - f.growth));
      this.plants.setColorAt(n, tmpC);
      n++;
      if (f.growth > 0.7) {
        this.grapes.setMatrixAt(m, tmpM);
        tmpC.copy(unripe).lerp(ripe, Math.min(1, (f.growth - 0.7) / 0.28));
        this.grapes.setColorAt(m, tmpC);
        m++;
      }
    }
    commitInstances(this.plants, n);
    commitInstances(this.grapes, m);
  }
}

// ------------------------------------------------------------------ grass tufts
/** Grass is kept in square patches of this many nodes: the view culls the ones it cannot see. */
const GRASS_CHUNK = 32;

export class GrassRenderer {
  /** one instanced mesh per patch of land */
  mesh = new THREE.Group();
  enabled = true;
  // the first look comes straight away (the world may have changed since the renderer was made)
  private t = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.Material;
  private cols: number;
  private chunks: { mesh: THREE.InstancedMesh | null; sig: number }[] = [];
  /** patches whose ground changed and wait for their tufts */
  private queue: number[] = [];

  constructor(private game: Game) {
    this.mat = vcMat({ roughness: 0.95 }, 'grass', 0.5, {
      key: 'tuft', snow: 1, ao: 0,
      // trodden down where people walk (trails.ts): shorter and splayed beside a path, flat on it and
      // for a while where someone has just gone by. The lookup wanders like the terrain's.
      uniforms: { tTrail: G.tTrail, uMapSize: G.uMapSize, tNoise: G.tNoise },
      vertexHead: 'uniform sampler2D tTrail;\nuniform sampler2D tNoise;\nuniform vec2 uMapSize;',
      vertexBegin: `
  #ifdef USE_INSTANCING
  {
    vec2 gp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    vec2 wob = vec2(texture2D(tNoise, gp * 0.047 + vec2(0.31, 0.17)).b, texture2D(tNoise, gp * 0.17 + vec2(0.63, 0.41)).a) - 0.5;
    vec2 trl = texture2D(tTrail, (gp + wob * 0.3 + 0.5) / uMapSize).rg;
    float down = max(smoothstep(0.15, 0.55, trl.r), smoothstep(0.05, 0.7, trl.g) * 0.8);
    transformed *= vec3(1.0 + down * 0.3, 1.0 - down, 1.0 + down * 0.3) * (1.0 - down * 0.5);
  }
  #endif`,
      // same seasonal grass tint as the terrain underneath
      fragRough: `{
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        float d = clamp(uSeasonB.x * (0.8 + fract(vWPos.x * 3.1 + vWPos.z * 1.7) * 0.4), 0.0, 1.0);
        vec3 dry = mix(vec3(1.35, 1.0, 0.32) * 1.15, vec3(1.12, 1.0, 0.58) * 0.9, uSeasonB.w);
        diffuseColor.rgb = mix(diffuseColor.rgb, lum * dry, d * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.12, 0.8), uSeasonA.z * 0.7);
      }`,
    });
    this.geo = buildGrassTuft();
    const w = game.world;
    this.cols = Math.ceil(w.W / GRASS_CHUNK);
    const rows = Math.ceil(w.H / GRASS_CHUNK);
    for (let c = 0; c < this.cols * rows; c++) this.chunks.push({ mesh: null, sig: NaN });
    this.scan();
    while (this.queue.length) this.build(this.queue.pop()!);
  }

  /** What the tufts of a patch depend on, hashed: ground type, what stands there and height (paths
   * press them down on the GPU). */
  private signature(c: number): number {
    const w = this.game.world;
    const x0 = (c % this.cols) * GRASS_CHUNK, y0 = Math.floor(c / this.cols) * GRASS_CHUNK;
    let h = 0x811c9dc5 | 0;
    for (let y = y0; y < Math.min(w.H, y0 + GRASS_CHUNK); y++)
      for (let x = x0; x < Math.min(w.W, x0 + GRASS_CHUNK); x++) {
        const i = y * w.W + x;
        const taken = w.building[i] || w.reserve[i] || w.field[i] || w.stone[i] ? 1 : 0;
        const code = w.terrain[i] | (taken << 4) | ((Math.round(w.h[i] * 32) & 0xffff) << 5);
        h = Math.imul(h ^ code, 16777619);
      }
    return h;
  }

  private scan() {
    for (let c = 0; c < this.chunks.length; c++) {
      const s = this.signature(c);
      if (s === this.chunks[c].sig) continue;
      this.chunks[c].sig = s;
      if (!this.queue.includes(c)) this.queue.push(c);
    }
  }

  private build(c: number) {
    const w = this.game.world;
    const x0 = (c % this.cols) * GRASS_CHUNK, y0 = Math.floor(c / this.cols) * GRASS_CHUNK;
    const colors: Record<number, number[]> = { [T_GRASS]: [0.07, 0.19, 0.03], [T_MEADOW]: [0.1, 0.23, 0.04], [T_FOREST]: [0.06, 0.14, 0.03] };
    const ch = this.chunks[c];
    // at most four tufts a node
    const cap = GRASS_CHUNK * GRASS_CHUNK * 4;
    if (!ch.mesh) {
      ch.mesh = withInstanceColor(inst(this.geo, this.mat, cap, false));
      ch.mesh.frustumCulled = true;
      this.mesh.add(ch.mesh);
    }
    const m = ch.mesh;
    let n = 0;
    for (let y = y0; y < Math.min(w.H, y0 + GRASS_CHUNK); y++)
      for (let x = x0; x < Math.min(w.W, x0 + GRASS_CHUNK); x++) {
        const i = y * w.W + x;
        const t = w.terrain[i];
        const col = colors[t];
        if (!col) continue;
        if (w.building[i] || w.reserve[i] || w.field[i] || w.stone[i]) continue;
        if (w.h[i] < WATER_LEVEL + 0.25) continue;
        if (w.slopeAt(i) > 0.6) continue;
        const per = t === T_MEADOW ? 4 : t === T_FOREST ? 2 : 3;
        for (let k = 0; k < per; k++) {
          if (hash2(i, k, 91) < 0.25) continue;
          const px = x + (hash2(i, k, 1) - 0.5), pz = y + (hash2(i, k, 2) - 0.5);
          const py = w.heightAt(px, pz) - 0.01;
          const s = 0.55 + hash2(i, k, 3) * 0.6;
          tmpQ.setFromAxisAngle(UP, hash2(i, k, 4) * 6.28);
          tmpM.compose(tmpS.set(px, py, pz), tmpQ, tmpV.set(s, s, s));
          m.setMatrixAt(n, tmpM);
          const v = 0.8 + hash2(i, k, 5) * 0.4;
          tmpC.setRGB(col[0] * v, col[1] * v, col[2] * v * 0.9);
          m.setColorAt(n, tmpC);
          n++;
        }
      }
    commitInstances(m, n);
    m.computeBoundingSphere();
  }

  update(dt: number) {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 6;
      this.scan();
    }
    // a few patches a frame, so a change never costs one long frame
    for (let k = 0; k < 2 && this.queue.length; k++) this.build(this.queue.shift()!);
  }
}

// ------------------------------------------------------------------ deer
/** What the renderer keeps about a deer that the game does not: how it is turned, where it is
 * in its stride, what its neck and head are doing, and whether it is a stag, a hind or a fawn. */
interface DeerLook { h: number; ph: number; neck: number; head: number; yaw: number; kind: 0 | 1 | 2; size: number; seed: number }

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** a lateral walk: left fore, right fore, left hind, right hind a quarter stride apart */
const DEER_GAIT = [Math.PI / 2, Math.PI * 1.5, 0, Math.PI];

/** A hare's heading, how far it is tipped forward (grazing, +) or back (sat up, −), and its size. */
interface HareLook { h: number; pitch: number; seed: number; size: number }
const MAX_HARES = 1500;
/** drawn a little larger than life, like the deer, so a hare reads at play size */
const HARE_SCALE = 1.25;

export class AnimalsRenderer {
  group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private fawn: THREE.InstancedMesh;
  private neck: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private stag: THREE.InstancedMesh;
  private upper: THREE.InstancedMesh;
  private lower: THREE.InstancedMesh;
  private looks = new Map<number, DeerLook>();
  private hareSit: THREE.InstancedMesh;
  private hareLeap: THREE.InstancedMesh;
  private hares = new Map<number, HareLook>();
  private base = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private r = new THREE.Matrix4();
  constructor(private game: Game) {
    const g = buildDeerGeos();
    const mat = vcMat({ roughness: 0.85 });
    this.body = inst(g.body, mat, 600);
    this.fawn = inst(g.fawn, mat, 600);
    this.neck = inst(g.neck, mat, 600);
    this.head = inst(g.head, mat, 600);
    this.stag = inst(g.stag, mat, 600);
    this.upper = inst(g.upper, mat, 2400);
    this.lower = inst(g.lower, mat, 2400);
    this.group.add(this.body, this.fawn, this.neck, this.head, this.stag, this.upper, this.lower);
    const hg = buildHareGeos();
    this.hareSit = inst(hg.sit, mat, MAX_HARES);
    this.hareLeap = inst(hg.leap, mat, MAX_HARES);
    this.group.add(this.hareSit, this.hareLeap);
  }

  private look(id: number, herd: number, heading: number): DeerLook {
    let L = this.looks.get(id);
    if (!L) {
      const k = hash2(id, herd, 17);
      const kind = k < 0.2 ? 1 : k < 0.4 ? 2 : 0;
      L = { h: heading, ph: hash2(id, 3, 5) * 6, neck: 1.2, head: -0.3, yaw: 0, kind, size: kind === 1 ? 1.08 : kind === 2 ? 0.62 : 0.94 + hash2(id, 9, 2) * 0.08, seed: hash2(id, 7, 1) * 100 };
      this.looks.set(id, L);
    }
    return L;
  }

  update(dt: number, time: number) {
    const g = this.game;
    const w = g.world;
    dt = Math.min(dt, 0.1);
    let nb = 0, nf = 0, nn = 0, nh = 0, ns = 0, nu = 0, nl = 0;
    const ease = (v: number, t: number, k: number) => v + (t - v) * Math.min(1, dt * k);
    this.nSit = this.nLeap = 0;
    let deer = 0;
    for (const a of g.animals.values()) {
      if (a.kind === 'deer') deer++;
      if (!w.explored[w.idx(Math.round(a.x), Math.round(a.z))]) continue;
      if (a.kind === 'hare') { this.hare(a, dt, time); continue; }
      if (nn >= 600) continue;
      const L = this.look(a.id, a.herd, a.heading);
      const y = w.heightAt(a.x, a.z);
      const moving = a.alive && a.next >= 0;
      // turn into the way it is going rather than snapping round at every step
      if (moving) L.h = wrapA(L.h + Math.max(-5 * dt, Math.min(5 * dt, wrapA(a.heading - L.h))));
      if (moving) L.ph += dt * 11 / L.size;
      // the head: down to graze most of the time, up now and then to look round, carried forward on the move
      const alert = Math.sin(time * 0.37 + L.seed * 1.7) + 0.6 * Math.sin(time * 0.83 + L.seed) > 0.75;
      let neck: number, head: number, yaw = 0;
      if (!a.alive) { neck = 0.8; head = 0.1; }
      else if (moving) { neck = 0.35 + Math.sin(L.ph * 2) * 0.05; head = -0.08; }
      else if (alert) { neck = -0.12; head = 0.12; yaw = Math.sin(time * 0.7 + L.seed) * 0.7; }
      else { neck = 1.62; head = -0.38 + Math.sin(time * 6 + L.seed) * 0.05; yaw = Math.sin(time * 0.3 + L.seed) * 0.25; }
      L.neck = ease(L.neck, neck, 3);
      L.head = ease(L.head, head, 4);
      L.yaw = ease(L.yaw, yaw, 3);
      const s = L.size;
      const bob = moving ? Math.sin(L.ph * 2) * 0.008 * s : 0;
      tmpQ.setFromEuler(tmpE.set(0, L.h, 0));
      this.base.compose(tmpS.set(a.x, y + bob, a.z), tmpQ, tmpV.set(s, s, s));
      if (!a.alive) {
        // rolled over onto its side where it fell
        this.base.multiply(this.r.makeTranslation(0.1, 0, 0)).multiply(this.m.makeRotationZ(-Math.PI / 2 * 0.95)).multiply(this.r.makeTranslation(-0.1, 0, 0));
      }
      if (L.kind === 2) this.fawn.setMatrixAt(nf++, this.base);
      else this.body.setMatrixAt(nb++, this.base);
      this.m.copy(this.base).multiply(this.r.makeTranslation(DEER_NECK[0], DEER_NECK[1], DEER_NECK[2]))
        .multiply(this.r.makeRotationFromEuler(tmpE.set(L.neck, L.yaw * 0.5, 0, 'YXZ')));
      this.neck.setMatrixAt(nn++, this.m);
      this.m2.copy(this.m).multiply(this.r.makeTranslation(DEER_HEAD[0], DEER_HEAD[1], DEER_HEAD[2]))
        .multiply(this.r.makeRotationFromEuler(tmpE.set(L.head, L.yaw * 0.5, 0, 'YXZ')));
      if (L.kind === 1) this.stag.setMatrixAt(ns++, this.m2);
      else this.head.setMatrixAt(nh++, this.m2);
      // slender legs in two halves: the hind ones angled back at the hock; on the move each lifts
      // and folds in turn, a quarter stride after the one before
      for (let l = 0; l < 4; l++) {
        const hind = l >= 2;
        const [hx, hy, hz] = DEER_HIPS[l];
        let up = hind ? 0.3 : 0, lo = hind ? -0.3 : 0;
        if (!a.alive) { up = hind ? 0.45 : -0.35; lo = 0; }
        else if (moving) {
          const p = L.ph + DEER_GAIT[l];
          up += -Math.sin(p) * 0.4;
          lo += Math.max(0, Math.cos(p)) * (hind ? 0.7 : 0.95);
        }
        this.m.copy(this.base).multiply(this.r.makeTranslation(hx, hy, hz)).multiply(this.m2.makeRotationX(up));
        this.upper.setMatrixAt(nu++, this.m);
        this.m.multiply(this.r.makeTranslation(0, -DEER_KNEE, 0)).multiply(this.m2.makeRotationX(lo));
        this.lower.setMatrixAt(nl++, this.m);
      }
    }
    const counts: [THREE.InstancedMesh, number][] = [[this.body, nb], [this.fawn, nf], [this.neck, nn], [this.head, nh], [this.stag, ns], [this.upper, nu], [this.lower, nl],
      [this.hareSit, this.nSit], [this.hareLeap, this.nLeap]];
    for (const [mesh, c] of counts) commitInstances(mesh, c);
    if (this.looks.size > deer + 64) for (const id of this.looks.keys()) if (!g.animals.has(id)) this.looks.delete(id);
    if (this.hares.size > g.animals.size + 64) for (const id of this.hares.keys()) if (!g.animals.has(id)) this.hares.delete(id);
  }

  private nSit = 0;
  private nLeap = 0;
  /** A hare: crouched between hops and stretched out in the air, nibbling or sat up when still. */
  private hare(a: Animal, dt: number, time: number) {
    const g = this.game, w = g.world, V = lodView;
    if (this.nSit >= MAX_HARES || this.nLeap >= MAX_HARES) return;
    const y = w.heightAt(a.x, a.z);
    // too small to make out, or out of view (its shadow is too small to matter)
    if (V.cull(a.x, y + 0.08, a.z, 0.16) !== 2 || V.px(a.x, y, a.z) * 0.25 < 1.2) return;
    let L = this.hares.get(a.id);
    if (!L) {
      L = { h: a.heading, pitch: 0, seed: hash2(a.id, 11, 3) * 100, size: (0.92 + hash2(a.id, 5, 9) * 0.16) * HARE_SCALE };
      this.hares.set(a.id, L);
    }
    const moving = a.alive && !a.leave && a.next >= 0;
    if (moving) L.h = wrapA(L.h + Math.max(-9 * dt, Math.min(9 * dt, wrapA(a.heading - L.h))));
    // still: mostly nose down in the grass, now and then sat up on its haunches to look round
    const up = Math.sin(time * 0.29 + L.seed * 1.3) + 0.7 * Math.sin(time * 0.71 + L.seed) > 1.1;
    const pitch = moving ? 0 : up ? -0.42 : 0.2 + Math.sin(time * 5 + L.seed) * 0.03;
    L.pitch += (pitch - L.pitch) * Math.min(1, dt * 6);
    let s = L.size, lift = 0, sink = 0, leap = false;
    if (moving) {
      // one bound per step: up and over, stretched out in the middle of it
      lift = Math.sin(Math.PI * a.t) * 0.075 * s;
      leap = a.t > 0.18 && a.t < 0.82;
    }
    if (a.leave) {
      // down into its burrow
      const k = Math.min(1, (g.time - a.leave) / BURROW_TIME);
      sink = k * 0.16;
      s *= 1 - k * 0.5;
    }
    tmpQ.setFromEuler(tmpE.set(0, L.h, 0));
    this.base.compose(tmpS.set(a.x, y + lift - sink, a.z), tmpQ, tmpV.set(s, s, s));
    if (!a.alive) this.base.multiply(this.m.makeRotationZ(Math.PI / 2 * 0.95)).multiply(this.r.makeTranslation(0.04, 0, 0));
    else if (moving) this.base.multiply(this.m.makeRotationX((a.t - 0.5) * 0.5));
    else {
      // tip about the hind feet
      this.base.multiply(this.r.makeTranslation(0, 0, -0.02)).multiply(this.m.makeRotationX(L.pitch)).multiply(this.r.makeTranslation(0, 0, 0.02));
    }
    if (leap) this.hareLeap.setMatrixAt(this.nLeap++, this.base);
    else this.hareSit.setMatrixAt(this.nSit++, this.base);
  }
}

// ------------------------------------------------------------------ arrows
export class ProjectilesRenderer {
  mesh: THREE.InstancedMesh;
  constructor(private game: Game) {
    const shaft = new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4);
    shaft.rotateX(Math.PI / 2);
    const tip = new THREE.ConeGeometry(0.02, 0.06, 4);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.22);
    const fl = new THREE.BoxGeometry(0.04, 0.002, 0.07);
    fl.translate(0, 0, -0.18);
    const geo = new THREE.BufferGeometry();
    const merged = [shaft, tip, fl].map((x) => x.toNonIndexed());
    const pos: number[] = [], nrm: number[] = [];
    for (const m of merged) { pos.push(...(m.getAttribute('position').array as Float32Array)); nrm.push(...(m.getAttribute('normal').array as Float32Array)); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7 });
    patchMaterial(mat, { key: 'arrow' });
    this.mesh = inst(geo, mat, 400, true);
    // catapult stones: rough lumps tumbling along a high arc
    const sg = new THREE.DodecahedronGeometry(0.13, 0);
    const sp = sg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const j = 0.88 + hash2(Math.round(sp.getX(i) * 100), Math.round(sp.getY(i) * 100) + Math.round(sp.getZ(i) * 100) * 3, 4) * 0.24;
      sp.setXYZ(i, sp.getX(i) * j, sp.getY(i) * j * 0.9, sp.getZ(i) * j);
    }
    sg.computeVertexNormals();
    const smat = new THREE.MeshStandardMaterial({ color: 0x6e6a64, roughness: 0.95 });
    patchMaterial(smat, { key: 'siegestone' });
    this.stones = inst(sg, smat, 64, true);
  }
  /** catapult stones in flight */
  stones: THREE.InstancedMesh;
  update() {
    const g = this.game;
    let n = 0, ns = 0;
    const from = new THREE.Vector3(), to = new THREE.Vector3(), pos = new THREE.Vector3(), nxt = new THREE.Vector3();
    for (const p of g.projectiles) {
      if (p.kind === 'stone') {
        if (ns >= 64) continue;
        const k = p.t / p.dur;
        const d = Math.hypot(p.tx - p.sx, p.tz - p.sz);
        pos.set(p.sx + (p.tx - p.sx) * k, p.sy + (p.ty - p.sy) * k + Math.sin(k * Math.PI) * d * 0.42, p.sz + (p.tz - p.sz) * k);
        tmpQ.setFromEuler(tmpE.set(p.t * 5.5, p.id * 0.7, p.t * 3.1));
        tmpM.compose(pos, tmpQ, tmpV.set(1, 1, 1));
        this.stones.setMatrixAt(ns++, tmpM);
        continue;
      }
      if (n >= 400) continue;
      const k = p.t / p.dur;
      const arc = (t: number, out: THREE.Vector3) => {
        const d = Math.hypot(p.tx - p.sx, p.tz - p.sz);
        out.set(p.sx + (p.tx - p.sx) * t, p.sy + (p.ty - p.sy) * t + Math.sin(t * Math.PI) * d * 0.18, p.sz + (p.tz - p.sz) * t);
        return out;
      };
      arc(k, pos);
      arc(Math.min(1, k + 0.02), nxt);
      from.copy(pos);
      to.copy(nxt);
      tmpM.lookAt(from, to, UP);
      tmpQ.setFromRotationMatrix(tmpM);
      // lookAt on matrix points -z towards target; arrow geometry points +z
      tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
      tmpM.compose(pos, tmpQ, tmpV.set(1, 1, 1));
      this.mesh.setMatrixAt(n++, tmpM);
    }
    commitInstances(this.mesh, n);
    commitInstances(this.stones, ns);
  }
}

// ------------------------------------------------------------------ goods piles (at buildings)
export class PilesRenderer {
  group = new THREE.Group();
  private meshes = new Map<Good, THREE.InstancedMesh>();
  constructor(goodGeos: Record<Good, THREE.BufferGeometry>) {
    const mat = vcMat({ roughness: 0.75 }, 'none', 1, { key: 'pile' });
    for (const gd of GOODS) {
      const m = inst(goodGeos[gd], mat, 1500);
      this.meshes.set(gd, m);
      this.group.add(m);
    }
  }
  private counts = new Map<Good, number>();
  begin() {
    this.counts.clear();
  }
  /** Stack n items of good gd around (x, y, z). */
  pile(gd: Good, n: number, x: number, y: number, z: number, ry = 0) {
    const m = this.meshes.get(gd)!;
    let c = this.counts.get(gd) ?? 0;
    const flat = gd === 'board' || gd === 'log' || gd === 'iron' || gd === 'gold';
    for (let k = 0; k < n && c < 1500; k++) {
      let px = x, py = y, pz = z, r = ry;
      if (flat) {
        const layer = Math.floor(k / 2), slot = k % 2;
        const hgt = gd === 'log' ? 0.1 : gd === 'board' ? 0.032 : 0.05;
        const sp = gd === 'log' ? 0.12 : gd === 'board' ? 0.11 : 0.08;
        px += Math.cos(ry) * 0 + Math.sin(ry) * (slot - 0.5) * sp;
        pz += Math.cos(ry) * (slot - 0.5) * sp;
        py += layer * hgt;
        if (layer % 2 === 1 && gd !== 'log') r += 0.1;
      } else {
        const ring = [[0, 0], [0.16, 0.02], [-0.02, 0.15], [0.15, 0.16], [0.07, 0.07], [-0.14, 0.04], [0.04, -0.13], [0.2, -0.1]];
        const [ox, oz] = ring[k % ring.length];
        px += ox; pz += oz;
        py += k >= 4 && (k === 4) ? 0.1 : 0;
        r += k * 1.3;
      }
      tmpQ.setFromAxisAngle(UP, r);
      tmpM.compose(tmpS.set(px, py, pz), tmpQ, tmpV.set(1, 1, 1));
      m.setMatrixAt(c++, tmpM);
    }
    this.counts.set(gd, c);
  }
  end() {
    for (const [gd, m] of this.meshes) commitInstances(m, this.counts.get(gd) ?? 0);
  }
}

export { buildGoodGeos };
void G;
