// Instanced renderers for trees, rocks, fields, grass, animals, goods and arrows (settlers live in settlers.ts).
import * as THREE from 'three';
import { GOODS, Good, T_FOREST, T_GRASS, T_MEADOW } from '../game/defs';
import type { Game } from '../game/game';
import { WATER_LEVEL } from '../game/world';
import { hash2 } from '../core/rng';
import { buildDeerGeos, buildGoodGeos, buildGrassTuft, buildRockGeos, buildTreeGeos, buildVineGeos, buildWheatGeo } from './models';
import { G, patchMaterial, patchedDepthMaterial } from './shaderPatch';
import { getTerrainDetail } from './terrainDetail';
import { leafTexture, twigTexture } from './textures';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
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

export class TreesRenderer {
  group = new THREE.Group();
  private trunks: THREE.InstancedMesh[] = [];
  private crowns: THREE.InstancedMesh[] = [];
  private cards: (THREE.InstancedMesh | null)[] = [];
  private limbs: (THREE.InstancedMesh | null)[] = [];
  private version = -1;
  private fallStart = new Map<number, number>();
  private leafMat: THREE.Material;

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
      return { crown, crownDepth, card, cardDepth };
    };
    const cap = Math.max(4000, game.trees.size * 2);
    geos.forEach((g, sp) => {
      const sm = DECIDUOUS[sp] ? seasonal(sp) : null;
      const t = inst(g.trunk, barkMat, cap, true, depth);
      const c = inst(g.crown, sm ? sm.crown : this.leafMat, cap, true, sm ? sm.crownDepth : depth);
      this.trunks.push(t);
      this.crowns.push(c);
      this.group.add(t, c);
      if (g.cards) {
        const cm = g.needles ? inst(g.cards, needleMat, cap, true, needleDepth) : inst(g.cards, sm!.card, cap, true, sm!.cardDepth);
        this.cards.push(cm);
        this.group.add(cm);
      } else this.cards.push(null);
      if (g.branches) {
        const lm = inst(g.branches, limbMat, cap, true, depth);
        lm.visible = false;
        this.limbs.push(lm);
        this.group.add(lm);
      } else this.limbs.push(null);
    });
  }

  update(time: number) {
    const g = this.game;
    // bare limbs only matter once the crowns start to thin
    const bare = G.uSeasonA.value.x < 0.97;
    for (const lm of this.limbs) if (lm) lm.visible = bare;
    let falling = false;
    for (const t of g.trees.values()) if (t.state === 'falling') { falling = true; break; }
    if (g.treesVersion === this.version && !falling) return;
    this.version = g.treesVersion;
    const w = g.world;
    const counts = this.trunks.map(() => 0);
    for (const t of g.trees.values()) {
      const sp = t.species;
      const i = counts[sp]++;
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
        const fq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
        tmpQ.premultiply(fq);
      }
      tmpM.compose(tmpS.set(x, y, z), tmpQ, new THREE.Vector3(s, s * (0.95 + hash2(t.node, 3, 7) * 0.15), s));
      this.trunks[sp].setMatrixAt(i, tmpM);
      this.crowns[sp].setMatrixAt(i, tmpM);
      this.limbs[sp]?.setMatrixAt(i, tmpM);
      const tint = 0.85 + hash2(t.node, 4, 7) * 0.3;
      // a few copper-leaved trees for variety (real autumn colour comes from the season)
      const warm = hash2(t.node, 6, 7) > 0.9 ? 0.12 : 0;
      tmpC.setRGB(tint * (1 + warm * 0.9), tint * (0.95 + hash2(t.node, 5, 7) * 0.1), tint * (0.9 - warm));
      this.crowns[sp].setColorAt(i, tmpC);
      const cm = this.cards[sp];
      if (cm) { cm.setMatrixAt(i, tmpM); cm.setColorAt(i, tmpC); }
    }
    for (let sp = 0; sp < this.trunks.length; sp++) {
      this.trunks[sp].count = counts[sp];
      this.crowns[sp].count = counts[sp];
      const lm = this.limbs[sp];
      if (lm) { lm.count = counts[sp]; lm.instanceMatrix.needsUpdate = true; }
      const cm = this.cards[sp];
      if (cm) { cm.count = counts[sp]; cm.instanceMatrix.needsUpdate = true; if (cm.instanceColor) cm.instanceColor.needsUpdate = true; }
      this.trunks[sp].instanceMatrix.needsUpdate = true;
      this.crowns[sp].instanceMatrix.needsUpdate = true;
      if (this.crowns[sp].instanceColor) this.crowns[sp].instanceColor!.needsUpdate = true;
    }
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

export class StonesRenderer {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private version = -1;
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
      const m = inst(g, mat, 2000);
      this.meshes.push(m);
      this.group.add(m);
    }
  }
  update() {
    const g = this.game;
    if (g.stonesVersion === this.version) return;
    this.version = g.stonesVersion;
    const w = g.world;
    const counts = [0, 0, 0];
    for (const s of g.stones.values()) {
      const v = s.variant;
      const x = w.nx(s.node), z = w.ny(s.node);
      const y = w.heightAt(x, z) - 0.08;
      const k = 0.55 + 0.6 * (s.amount / s.max);
      tmpE.set(0, s.rot, 0);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(k * 1.3, k * 1.25, k * 1.3));
      this.meshes[v].setMatrixAt(counts[v]++, tmpM);
    }
    this.meshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; });
  }
}

// ------------------------------------------------------------------ wheat fields
export class FieldsRenderer {
  mesh: THREE.InstancedMesh;
  private version = -1;
  constructor(private game: Game) {
    const mat = vcMat({ roughness: 0.9 }, 'grass', 0.25, { snow: 0.6, key: 'wheat' });
    this.mesh = inst(buildWheatGeo(), mat, 1500, true);
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
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
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
    this.plants = inst(geos.plant, vcMat({ roughness: 0.85 }, 'grass', 0.12, { snow: 0.5, key: 'vine' }), 1200, true);
    this.grapes = inst(geos.grapes, vcMat({ roughness: 0.35 }, 'grass', 0.1, { key: 'grape' }), 1200, true);
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
    for (const [mesh, count] of [[this.plants, n], [this.grapes, m]] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ grass tufts
export class GrassRenderer {
  mesh: THREE.InstancedMesh;
  private t = 0;
  enabled = true;
  constructor(private game: Game) {
    const mat = vcMat({ roughness: 0.95 }, 'grass', 0.5, {
      key: 'tuft', snow: 1,
      // same seasonal grass tint as the terrain underneath
      fragRough: `{
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        float d = clamp(uSeasonB.x * (0.8 + fract(vWPos.x * 3.1 + vWPos.z * 1.7) * 0.4), 0.0, 1.0);
        vec3 dry = mix(vec3(1.35, 1.0, 0.32) * 1.15, vec3(1.12, 1.0, 0.58) * 0.9, uSeasonB.w);
        diffuseColor.rgb = mix(diffuseColor.rgb, lum * dry, d * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.12, 0.8), uSeasonA.z * 0.7);
      }`,
    });
    this.mesh = inst(buildGrassTuft(), mat, 60000, false);
    this.rebuild();
  }
  rebuild() {
    const g = this.game;
    const w = g.world;
    let n = 0;
    const cap = 60000;
    const colors: Record<number, number[]> = { [T_GRASS]: [0.07, 0.19, 0.03], [T_MEADOW]: [0.1, 0.23, 0.04], [T_FOREST]: [0.06, 0.14, 0.03] };
    for (let i = 0; i < w.N && n < cap; i++) {
      const t = w.terrain[i];
      const col = colors[t];
      if (!col) continue;
      if (w.building[i] || w.reserve[i] || w.field[i] || w.stone[i] || w.wear[i] > 0.25) continue;
      if (w.h[i] < WATER_LEVEL + 0.25) continue;
      if (w.slopeAt(i) > 0.6) continue;
      const x0 = w.nx(i), z0 = w.ny(i);
      const per = t === T_MEADOW ? 4 : t === T_FOREST ? 2 : 3;
      for (let k = 0; k < per && n < cap; k++) {
        if (hash2(i, k, 91) < 0.25) continue;
        const x = x0 + (hash2(i, k, 1) - 0.5), z = z0 + (hash2(i, k, 2) - 0.5);
        const y = w.heightAt(x, z) - 0.01;
        const s = 0.55 + hash2(i, k, 3) * 0.6;
        tmpQ.setFromAxisAngle(UP, hash2(i, k, 4) * 6.28);
        tmpM.compose(tmpS.set(x, y, z), tmpQ, tmpV.set(s, s * (1 - w.wear[i] * 2), s));
        this.mesh.setMatrixAt(n, tmpM);
        const v = 0.8 + hash2(i, k, 5) * 0.4;
        tmpC.setRGB(col[0] * v, col[1] * v, col[2] * v * 0.9);
        this.mesh.setColorAt(n, tmpC);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number) {
    this.mesh.visible = this.enabled;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 6;
      if (this.enabled) this.rebuild();
    }
  }
}

// ------------------------------------------------------------------ deer
export class AnimalsRenderer {
  group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private phase = new Map<number, number>();
  constructor(private game: Game) {
    const g = buildDeerGeos();
    const mat = vcMat({ roughness: 0.85 });
    this.body = inst(g.body, mat, 600);
    this.legs = inst(g.leg, mat, 2400);
    this.group.add(this.body, this.legs);
  }
  update(dt: number, time: number) {
    const g = this.game;
    const w = g.world;
    let nb = 0, nl = 0;
    const base = new THREE.Matrix4(), m = new THREE.Matrix4(), r = new THREE.Matrix4();
    for (const a of g.animals.values()) {
      if (nb >= 600) break;
      if (!w.explored[w.idx(Math.round(a.x), Math.round(a.z))]) continue;
      const y = w.heightAt(a.x, a.z);
      const moving = a.next >= 0;
      let ph = this.phase.get(a.id) ?? a.id;
      if (moving) ph += dt * 9;
      this.phase.set(a.id, ph);
      tmpQ.setFromEuler(tmpE.set(0, a.heading, 0));
      base.compose(tmpS.set(a.x, y, a.z), tmpQ, tmpV.set(1, 1, 1));
      if (!a.alive) base.multiply(r.makeRotationZ(Math.PI / 2 * 0.92)).multiply(m.makeTranslation(0.15, -0.15, 0));
      else if (!moving) {
        // graze: head down occasionally
        const graze = Math.max(0, Math.sin(time * 0.4 + a.id)) * 0.25;
        base.multiply(r.makeTranslation(0, 0.3, 0.2)).multiply(m.makeRotationX(graze)).multiply(r.makeTranslation(0, -0.3, -0.2));
      }
      this.body.setMatrixAt(nb++, base);
      const legs = [[-0.07, 0.18, 0], [0.07, 0.18, Math.PI], [-0.07, -0.16, Math.PI], [0.07, -0.16, 0]];
      for (const [lx, lz, off] of legs) {
        const ang = moving ? Math.sin(ph + off) * 0.6 : 0;
        m.copy(base).multiply(r.makeTranslation(lx, 0.32, lz)).multiply(new THREE.Matrix4().makeRotationX(ang));
        this.legs.setMatrixAt(nl++, m);
      }
    }
    this.body.count = nb; this.legs.count = nl;
    this.body.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
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
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stones.count = ns;
    this.stones.instanceMatrix.needsUpdate = true;
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
    for (const [gd, m] of this.meshes) {
      m.count = this.counts.get(gd) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

export { buildGoodGeos };
void G;
