// The finished buildings' batches draw every library material in one shader, in three families
// (buildingBatches.ts): single-sided, double-sided, and what casts no shadow (windows and glows,
// single-sided too). Each vertex carries its material's row (aMat) in a table of colour, roughness,
// metalness, emissive, snow, grime and texture layers, which the fragment shader reads; the building
// textures sit in two texture arrays, albedo and normal. A texture smaller than a layer is tiled
// across it and sampled at a matching scale, which fetches the same texels at every mip level, so a
// piece looks as it does with its own material. A town then costs three draws a pass for its finished
// buildings instead of one per material, some forty-five, each of which set up its textures, colours
// and matrices again: a third of the frame's GL calls (1,700 instead of 2,600 in a 30-minute town at
// 3440x1440) and 0.3-0.5 ms of the renderer's CPU. On the GPU the fewer draws save about as much as
// the shader costs per pixel over the library's own, whose material is a constant for it: 0.07 ms
// faster at 1280x720, 0.05-0.19 ms (1-3% of the frame) slower at 3440x1440. (A uniform buffer for the
// table, families split by normal map so none has a branch, or the materials covering the most
// pixels kept in batches of their own did no better.)
import * as THREE from 'three';
import { lookOf, windowGlow } from './materials';
import { patchMaterial } from './shaderPatch';
import { MAT_TEX_KEYS, matTexOf, type MatTexKey } from './textures';

/** a layer's size: the largest building texture */
const SIZE = 512;
/** rows of the material table (the library has about sixty-five materials) */
const ROWS = 128;
/** texels a row: colour + roughness, emissive + metalness, layers + normal scale + snow, uv scale + grime + window */
const ROW_W = 4;

function layerTex(srgb: boolean): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array(SIZE * SIZE * 4 * MAT_TEX_KEYS.length), SIZE, SIZE, MAT_TEX_KEYS.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Atlas {
  readonly albedo = layerTex(true);
  readonly normal = layerTex(false);
  readonly table: THREE.DataTexture;
  private rows = new Map<string, { row: number; double: boolean }>();
  private filled = new Set<MatTexKey>();
  private onGpu = new Set<THREE.Texture>();

  constructor() {
    this.table = new THREE.DataTexture(new Float32Array(ROW_W * ROWS * 4), ROW_W, ROWS, THREE.RGBAFormat, THREE.FloatType);
    this.table.magFilter = this.table.minFilter = THREE.NearestFilter;
    this.table.needsUpdate = true;
    // until an array's first upload the whole of it goes up; after that only a layer painted since
    for (const t of [this.albedo, this.normal]) t.onUpdate = () => this.onGpu.add(t);
  }

  /** The table row of library material `key` (and whether it draws both sides), made on first use. */
  rowOf(key: string): { row: number; double: boolean } {
    let r = this.rows.get(key);
    if (r) return r;
    const L = lookOf(key);
    const row = this.rows.size;
    if (row >= ROWS) throw new Error('buildingFamilies: material table full');
    const pair = matTexOf(L.map ?? L.normalMap);
    const layer = pair ? this.fill(pair.key, pair.tex.map, pair.tex.normal) : -1;
    const img = pair?.tex.map.image as { width: number; height: number } | undefined;
    const d = this.table.image.data as Float32Array;
    const o = row * ROW_W * 4;
    d.set([L.color.r, L.color.g, L.color.b, L.roughness], o);
    d.set([L.emissive.r, L.emissive.g, L.emissive.b, L.metalness], o + 4);
    d.set([L.map ? layer : -1, L.normalMap ? layer : -1, L.normalScale, L.snow], o + 8);
    d.set([img ? img.width / SIZE : 1, img ? img.height / SIZE : 1, L.grime, L.window ? 1 : 0], o + 12);
    this.table.needsUpdate = true;
    r = { row, double: L.double };
    this.rows.set(key, r);
    return r;
  }

  /** Copy a texture pair into its layer of both arrays (tiled to fill it), once. */
  private fill(key: MatTexKey, map: THREE.DataTexture, normal: THREE.DataTexture): number {
    const layer = MAT_TEX_KEYS.indexOf(key);
    if (this.filled.has(key)) return layer;
    this.filled.add(key);
    for (const [src, dst] of [[map, this.albedo], [normal, this.normal]] as const) {
      const { width: w, height: h, data } = src.image as { width: number; height: number; data: Uint8Array };
      if (SIZE % w || SIZE % h) throw new Error(`buildingFamilies: ${key} is ${w}x${h}, not a divisor of ${SIZE}`);
      const out = dst.image.data as Uint8Array;
      const base = layer * SIZE * SIZE * 4;
      for (let y = 0; y < SIZE; y++) {
        const row = data.subarray((y % h) * w * 4, ((y % h) + 1) * w * 4);
        for (let x = 0; x < SIZE; x += w) out.set(row, base + (y * SIZE + x) * 4);
      }
      if (this.onGpu.has(dst)) dst.addLayerUpdate(layer);
      dst.needsUpdate = true;
    }
    return layer;
  }
}

let atlas: Atlas | null = null;
export function getAtlas(): Atlas {
  return (atlas ??= new Atlas());
}

// Only the row goes from the vertex to the fragment shader, which reads the table itself: a tile-based
// GPU (every Apple one) writes out what each vertex hands on, and the buildings' pieces are not
// indexed (three vertices a triangle), so handing on the row's sixteen numbers instead cost the frame
// about 0.07 ms more at 3440x1440.
const VERTEX_HEAD = /* glsl */ `
attribute float aMat;
flat varying float vBRow;
varying vec2 vBUv;`;

const VERTEX_BEGIN = /* glsl */ `
  vBRow = aMat;
  vBUv = uv;`;

// (vBRow is flat, the same over each primitive and so over every 2x2 block of pixels shaded
// together: the texture lookups inside the branches below keep their derivatives)
const FRAG_HEAD = /* glsl */ `
uniform highp sampler2D tBldMat;
uniform sampler2DArray tBldAlbedo;
uniform sampler2DArray tBldNormal;
uniform float uBldGlow;
flat varying float vBRow;
varying vec2 vBUv;
// the piece's row: colour + roughness, emissive + metalness, layers + normal scale + snow, uv scale + grime + window
vec4 vBM0, vBM1, vBM2, vBM3;
// three's getTangentFrame, which it only defines for a material with a normal map
mat3 bldTangentFrame(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
  vec3 q0 = dFdx(eye_pos.xyz);
  vec3 q1 = dFdy(eye_pos.xyz);
  vec2 st0 = dFdx(uv.st);
  vec2 st1 = dFdy(uv.st);
  vec3 N = surf_norm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}`;

// the material's colour, and its map (the material's own `diffuse` is white); the row is read here,
// after the shroud has let the pixel through
const FRAG_MAP = /* glsl */ `
  {
    int mr = int(vBRow + 0.5);
    vBM0 = texelFetch(tBldMat, ivec2(0, mr), 0);
    vBM1 = texelFetch(tBldMat, ivec2(1, mr), 0);
    vBM2 = texelFetch(tBldMat, ivec2(2, mr), 0);
    vBM3 = texelFetch(tBldMat, ivec2(3, mr), 0);
  }
  diffuseColor.rgb *= vBM0.rgb;
  if (vBM2.x >= 0.0) diffuseColor *= texture2D(tBldAlbedo, vec3(vBUv * vBM3.xy, vBM2.x));`;

const FRAG_ROUGH = /* glsl */ `
  roughnessFactor = vBM0.w;`;

// (in place of normal_fragment_maps, which comes after the metalness)
const FRAG_NORMAL = /* glsl */ `
  metalnessFactor = vBM1.w;
  if (vBM2.y >= 0.0) {
    mat3 tbn = bldTangentFrame(-vViewPosition, normal, vBUv);
    #ifdef DOUBLE_SIDED
      tbn[0] *= faceDirection;
      tbn[1] *= faceDirection;
    #endif
    vec3 mapN = texture2D(tBldNormal, vec3(vBUv * vBM3.xy, vBM2.y)).xyz * 2.0 - 1.0;
    mapN.xy *= vBM2.z;
    normal = normalize(tbn * mapN);
  }`;

const FRAG_EMISSIVE = /* glsl */ `
  totalEmissiveRadiance = vBM1.rgb * (vBM3.w > 0.5 ? uBldGlow : 1.0);`;

const families = new Map<boolean, THREE.MeshStandardMaterial>();

/** The shared material of a family: single- or double-sided. */
export function familyMaterial(double: boolean): THREE.MeshStandardMaterial {
  let m = families.get(double);
  if (m) return m;
  const a = getAtlas();
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide });
  patchMaterial(m, {
    key: 'bld_family',
    snow: 'vBM2.w',
    grime: 'vBM3.z',
    uniforms: { tBldMat: { value: a.table }, tBldAlbedo: { value: a.albedo }, tBldNormal: { value: a.normal }, uBldGlow: windowGlow },
    vertexHead: VERTEX_HEAD,
    vertexBegin: VERTEX_BEGIN,
    fragHead: FRAG_HEAD,
    fragMap: FRAG_MAP,
    fragRough: FRAG_ROUGH,
    fragNormal: FRAG_NORMAL,
    fragEmissive: FRAG_EMISSIVE,
  });
  families.set(double, m);
  return m;
}
