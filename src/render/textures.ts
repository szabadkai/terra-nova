// Procedurally generated textures (no external image assets).
import * as THREE from 'three';
import { RNG, hash2 } from '../core/rng';

import { fade, pfbm, pnoise, pworley } from './textureNoise';
export { pfbm, pnoise, pworley } from './textureNoise';

function makeData(size: number, fn: (u: number, v: number, out: number[]) => void, srgb: boolean, h = size): THREE.DataTexture {
  const data = new Uint8Array(size * h * 4);
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      out[3] = 255;
      fn(x / size, y / h, out);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, out[0]));
      data[i + 1] = Math.max(0, Math.min(255, out[1]));
      data[i + 2] = Math.max(0, Math.min(255, out[2]));
      data[i + 3] = Math.max(0, Math.min(255, out[3]));
    }
  }
  const t = new THREE.DataTexture(data, size, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Normal map from a height function (tangent space). */
function normalFromHeight(size: number, height: Float32Array, strength: number, h = size): THREE.DataTexture {
  const data = new Uint8Array(size * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const yu = (y - 1 + h) % h, yd = (y + 1) % h;
      const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
      const dy = (height[yd * size + x] - height[yu * size + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- global noise texture
let noiseTex: THREE.DataTexture | null = null;
export function getNoiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const S = 256;
  noiseTex = makeData(S, (u, v, o) => {
    o[0] = pfbm(u, v, 8, 5, 11) * 255;
    o[1] = pfbm(u, v, 4, 5, 41) * 255;
    const [f1, id] = pworley(u, v, 16, 77);
    o[2] = f1 * 255;
    o[3] = id * 255;
  }, false);
  return noiseTex;
}

let waterNormal: THREE.DataTexture | null = null;
export function getWaterNormal(): THREE.DataTexture {
  if (waterNormal) return waterNormal;
  const S = 256;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let s = pfbm(u, v, 6, 4, 301) * 0.7;
      s += Math.sin((u * 5 + pfbm(u, v, 3, 2, 9) * 1.5) * Math.PI * 2) * 0.06;
      s += (1 - pworley(u, v, 10, 55)[0]) * 0.25;
      h[y * S + x] = s;
    }
  waterNormal = normalFromHeight(S, h, 7);
  return waterNormal;
}

// ---------------------------------------------------------------- building materials
export interface MatTex { map: THREE.DataTexture; normal: THREE.DataTexture; }

/** Share of their size the buildings' textures are made at (Low: half, a quarter of the texels to work
 * out at boot and to hold); set before the first material asks for one, as they are made once a page. */
let texScale = 1;
export function setTextureScale(s: number) { texScale = s; }
export const textureScale = () => texScale;

function build(size0: number, fn: (u: number, v: number) => [number, number, number, number], strength0: number, h0 = size0): MatTex {
  const size = Math.max(16, Math.round(size0 * texScale)), h = Math.max(16, Math.round(h0 * texScale));
  // (a texel spans more of the surface: the same slope is a bigger step from one to the next)
  const strength = strength0 * (size / size0);
  const height = new Float32Array(size * h);
  const data = new Uint8Array(size * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, hh] = fn(x / size, y / h);
      const i = y * size + x;
      data[i * 4] = Math.max(0, Math.min(255, r));
      data[i * 4 + 1] = Math.max(0, Math.min(255, g));
      data[i * 4 + 2] = Math.max(0, Math.min(255, b));
      data[i * 4 + 3] = 255;
      height[i] = hh;
    }
  const map = new THREE.DataTexture(data, size, h, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = texScale < 1 ? 2 : 8;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  const normal = normalFromHeight(size, height, strength, h);
  normal.anisotropy = map.anisotropy;
  return { map, normal };
}

const cache = new Map<string, MatTex>();
function cached(key: string, f: () => MatTex) {
  let t = cache.get(key);
  if (!t) { t = f(); cache.set(key, t); }
  return t;
}

/** Anisotropic periodic value noise: separate integer periods along x and y. */
function pnoiseA(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = fade(xf), v = fade(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function pfbmA(u: number, v: number, bx: number, by: number, oct: number, seed: number): number {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const kx = bx << o, ky = by << o;
    sum += amp * pnoiseA(u * kx, v * ky, kx, ky, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a rounded rectangle centred at the origin. */
function rrect(x: number, y: number, hx: number, hy: number, r: number) {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Tileable courses of stones/bricks: random row heights, random stone lengths per row. */
interface Course { y0: number; y1: number; joints: number[]; off: number }
function makeCourses(rows: number, seed: number, minLen: number, maxLen: number, hVar: number): Course[] {
  const rng = new RNG(seed);
  const hs = Array.from({ length: rows }, () => 1 + (rng.next() - 0.5) * 2 * hVar);
  const tot = hs.reduce((a, b) => a + b, 0);
  let y = 0;
  return hs.map((hh) => {
    const y0 = y;
    y += hh / tot;
    const joints = [0];
    let x = 0;
    for (;;) {
      const len = minLen + rng.next() * (maxLen - minLen);
      if (x + len > 1 - minLen * 0.7) break;
      x += len;
      joints.push(x);
    }
    joints.push(1);
    return { y0, y1: y, joints, off: rng.next() };
  });
}

/** Locate (u,v) in a course layout: stone id, offset from stone centre and half extents. */
function courseAt(cs: Course[], u: number, v: number) {
  let r = 0;
  while (r < cs.length - 1 && v >= cs[r].y1) r++;
  const c = cs[r];
  const uu = (((u + c.off) % 1) + 1) % 1;
  let j = 0;
  while (j < c.joints.length - 2 && uu >= c.joints[j + 1]) j++;
  const a = c.joints[j], b = c.joints[j + 1];
  return { id: r * 61 + j, dx: uu - (a + b) / 2, dy: v - (c.y0 + c.y1) / 2, hx: (b - a) / 2, hy: (c.y1 - c.y0) / 2, row: r };
}

/** Whitewashed lime plaster: trowel undulation, grain, stains, hairline cracks and a few
 *  patches where it has fallen away to show the brickwork beneath. 1 texture = 1 world unit. */
export const plasterTex = () => cached('plaster', () => {
  const bricks = makeCourses(14, 71, 0.16, 0.24, 0.05);
  return build(512, (u, v) => {
    const n = pfbm(u, v, 6, 5, 5);
    const blotch = pfbm(u, v, 3, 3, 9);
    const grain = pnoise(u * 256, v * 256, 256, 3);
    const grain2 = pnoise(u * 512, v * 512, 512, 4);
    const [, , e] = pworley(u + (n - 0.5) * 0.06, v + (blotch - 0.5) * 0.06, 5, 21);
    const crack = e < 0.007 && pfbm(u, v, 2, 3, 23) > 0.6 ? 1 - e / 0.007 : 0;
    const pm = pfbm(u, v, 3, 5, 31);
    const patch = sstep(0.74, 0.75, pm);
    const lip = sstep(0.7, 0.74, pm) * (1 - patch);
    let c = 228 + (n - 0.5) * 22 + (grain - 0.5) * 10 + (grain2 - 0.5) * 6 - Math.max(0, blotch - 0.58) * 70 - crack * 35;
    let r = c, g = c * 0.965, b = c * 0.9;
    let hgt = n * 0.35 + grain * 0.08 + grain2 * 0.04 + lip * 0.12 - crack * 0.25;
    if (patch > 0) {
      const k = courseAt(bricks, u, v);
      const d = rrect(k.dx, k.dy, k.hx - 0.006, k.hy - 0.006, 0.006) + (grain - 0.5) * 0.006;
      const inB = sstep(0.002, -0.004, d);
      const tone = 0.8 + hash2(k.id, 3, 7) * 0.35;
      const br = 150 * tone, bg = 78 * tone, bb = 52 * tone;
      const mr = 170 + (grain - 0.5) * 30;
      const pr = br * inB + mr * (1 - inB), pg = bg * inB + mr * 0.94 * (1 - inB), pb = bb * inB + mr * 0.82 * (1 - inB);
      r = r * (1 - patch) + pr * patch; g = g * (1 - patch) + pg * patch; b = b * (1 - patch) + pb * patch;
      hgt = hgt * (1 - patch) + (inB * 0.25 + grain * 0.06 - 0.35) * patch;
    }
    return [r, g, b, hgt];
  }, 3.5);
});

/** Polished marble with faint veins. */
export const marbleTex = () => cached('marble', () => build(512, (u, v) => {
  const w = pfbm(u, v, 3, 5, 51);
  const vein = 1 - Math.abs(Math.sin((u * 2 + v * 3 + w * 3.2) * Math.PI * 2));
  const fine = pfbm(u, v, 24, 3, 53);
  const c = 236 + (fine - 0.5) * 12 - Math.pow(vein, 14) * 45 - Math.pow(vein, 4) * 8;
  return [c, c * 0.985, c * 0.955, fine * 0.1];
}, 2));

/** Dark weathered timber: grain along v, drying checks and the odd knot. */
export const timberTex = () => cached('timber', () => build(256, (u, v) => {
  const warp = pfbmA(u, v, 3, 1, 3, 21);
  const rings = Math.sin((u * 12 + warp * 2.5) * Math.PI * 2) * 0.5 + 0.5;
  const streak = pfbmA(u, v, 48, 2, 3, 22);
  const fibre = pnoiseA(u * 128, v * 8, 128, 8, 23);
  const check = streak > 0.72 && pfbmA(u, v, 8, 1, 2, 24) > 0.55 ? (streak - 0.72) * 6 : 0;
  // knots
  let knot = 0;
  for (let k = 0; k < 3; k++) {
    const kx = hash2(k, 1, 25), ky = hash2(k, 2, 25);
    let dx = u - kx, dy = (v - ky) * 0.35;
    dx -= Math.round(dx); dy -= Math.round(dy);
    const d = Math.hypot(dx, dy);
    knot = Math.max(knot, sstep(0.05, 0.0, d) * (0.6 + 0.4 * Math.sin(d * 200)));
  }
  const tone = 70 + rings * 16 + (streak - 0.5) * 34 + (fibre - 0.5) * 14 - check * 55 - knot * 22;
  return [tone * 1.02, tone * 0.74, tone * 0.52, rings * 0.25 + streak * 0.35 + fibre * 0.12 - check * 0.6 + knot * 0.2];
}, 6, 512));

/** Neutral clay barrel tiles (tinted per player through the material colour): ROOF_TILE.cols
 *  channels across and ROOF_TILE.rows courses per texture unit, not staggered, so the channels
 *  run straight from eave to ridge. Roofs are built as rounded, stepped courses whose humps
 *  line up with the channels; the texture adds each tile's own tone, the dark lip at every
 *  course, grime in the valleys and the shadow of the course above. */
export const ROOF_TILE = { cols: 7, rows: 8 };
export const roofTex = () => cached('roof', () => build(512, (u, v) => {
  const { rows, cols } = ROOF_TILE;
  const ry = v * rows;
  const row = Math.floor(ry);
  const fy = ry - row; // 0 = exposed lower edge, 1 = under the next row
  const cx = u * cols;
  const col = Math.floor(cx);
  const fx = cx - col;
  const cc = ((col % cols) + cols) % cols, rr = ((row % rows) + rows) % rows;
  const id = hash2(cc, rr, 5);
  const id2 = hash2(cc, rr, 6);
  const id3 = hash2(cc, rr, 7);
  const edge = Math.min(fx, 1 - fx);
  const valley = sstep(0.16, 0.0, edge);
  const prof = Math.pow(Math.sin(fx * Math.PI), 0.6);
  const n = pfbm(u, v, 8, 3, 31);
  const fine = pnoise(u * 256, v * 256, 256, 32);
  const under = Math.pow(fy, 2.2); // shadow from the course above
  const lip = sstep(0.05, 0.0, fy); // the tile's own end, facing down the roof
  const lm = pfbm(u, v, 12, 3, 33);
  const lichen = lm > 0.66 && id2 > 0.6 ? sstep(0.66, 0.74, lm) * (1 - lip) : 0;
  let c = 205 + prof * 26 - under * 80 + (id - 0.5) * 70 + (n - 0.5) * 34 + (fine - 0.5) * 12;
  c *= 1 - valley * 0.42;
  c *= 1 - lip * 0.5;
  // a few tiles burnt darker or paler, as fired clay comes out of the kiln
  const kiln = id3 > 0.88 ? 0.72 : id3 < 0.08 ? 1.12 : 1;
  c *= kiln;
  let r = c, g = c * (0.93 + id2 * 0.08), b = c * (0.86 + id2 * 0.12);
  if (lichen) { const k = lichen * 0.4; r = r * (1 - k) + 170 * k; g = g * (1 - k) + 176 * k; b = b * (1 - k) + 128 * k; }
  const hgt = prof * 0.3 + (1 - fy) * 0.35 + fine * 0.05 - valley * 0.2 + lichen * 0.1;
  return [r, g, b, hgt];
}, 3));

/** Random rubble masonry in the Settlers manner: rounded fieldstones of mixed size in rough,
 *  wandering courses, each stone its own tone, set in deep dark mortar. 1 texture = 1 unit. */
export const rubbleTex = () => cached('rubble', () => {
  const cs = makeCourses(9, 83, 0.07, 0.3, 0.6);
  return build(512, (u, v) => {
    const wu = u + (pfbm(u, v, 3, 3, 84) - 0.5) * 0.05;
    let wv = v + (pfbm(u, v, 4, 3, 85) - 0.5) * 0.045;
    wv = ((wv % 1) + 1) % 1;
    const k = courseAt(cs, wu, wv);
    const n = pfbm(u, v, 16, 4, 86);
    const fine = pnoise(u * 256, v * 256, 256, 87);
    const fine2 = pnoise(u * 128, v * 128, 128, 88);
    const edgeN = pfbm(u, v, 20, 3, 89);
    // split long stones in two now and then so the rows don't read as bricks
    let dx = k.dx, hx = k.hx;
    let sid = k.id;
    if (hx > 0.09 && hash2(k.id, 4, 90) > 0.4) {
      const cut = (hash2(k.id, 5, 90) - 0.5) * hx * 0.6;
      if (dx < cut) { hx = (cut + k.hx) / 2; dx = dx - (cut - k.hx) / 2; sid += 1000; }
      else { hx = (k.hx - cut) / 2; dx = dx - (cut + k.hx) / 2; }
    }
    const hy = k.hy * (0.85 + hash2(sid, 6, 90) * 0.15);
    const dy = k.dy + (hash2(sid, 7, 90) - 0.5) * (k.hy - hy);
    const rad = Math.min(hx, hy) * (0.55 + hash2(sid, 1, 90) * 0.4);
    const d = rrect(dx, dy, hx - 0.009, hy - 0.009, rad) + (edgeN - 0.5) * 0.024;
    const inS = sstep(0.002, -0.006, d);
    const pillow = Math.sqrt(sstep(0, Math.min(hx, hy) * 0.9, -d));
    const id = hash2(sid, 0, 91);
    const hue = hash2(sid, 2, 91);
    let tone = 150 + (id - 0.5) * 60 + (n - 0.5) * 34 + (fine - 0.5) * 16 + (fine2 - 0.5) * 12;
    tone *= 0.74 + 0.26 * pillow; // stones darken towards their rounded edges
    const [hr, hg, hb] = hue > 0.7 ? [1.08, 0.98, 0.8] : hue < 0.2 ? [0.95, 0.97, 0.98] : hue < 0.45 ? [1.05, 0.96, 0.84] : [1.02, 0.97, 0.88];
    const mc = 84 + (fine - 0.5) * 20 + (n - 0.5) * 16;
    const r = tone * hr * inS + mc * (1 - inS), g = tone * hg * inS + mc * 0.93 * (1 - inS), b = tone * hb * inS + mc * 0.82 * (1 - inS);
    const hgt = inS * (0.3 + pillow * 0.55 + n * 0.1 + fine * 0.04) + (1 - inS) * fine * 0.04;
    return [r, g, b, hgt];
  }, 9);
});

/** Small red bricks in running bond with pale lime mortar: furnaces, hearths and arches. */
export const brickTex = () => cached('brick', () => {
  const cs = makeCourses(12, 97, 0.15, 0.2, 0.05);
  return build(256, (u, v) => {
    const k = courseAt(cs, u, v);
    const n = pfbm(u, v, 8, 3, 98);
    const fine = pnoise(u * 128, v * 128, 128, 99);
    const d = rrect(k.dx, k.dy, k.hx - 0.006, k.hy - 0.006, 0.008) + (fine - 0.5) * 0.006;
    const inB = sstep(0.002, -0.004, d);
    const id = hash2(k.id, 0, 97);
    const t = 0.78 + id * 0.36 + (n - 0.5) * 0.2;
    const soot = sstep(0.55, 0.8, pfbm(u, v, 3, 3, 96)) * 0.4;
    const br = 176 * t * (1 - soot), bg = 84 * t * (1 - soot * 0.9), bb = 56 * t * (1 - soot * 0.8);
    const mc = 176 + (fine - 0.5) * 30 - soot * 60;
    return [br * inB + mc * (1 - inB), bg * inB + mc * 0.95 * (1 - inB), bb * inB + mc * 0.86 * (1 - inB), inB * (0.6 + n * 0.2) + fine * 0.05];
  }, 5);
});

/** Split wooden shakes for plank roofs: courses of boards of random width, grain down the slope,
 *  gaps between the boards and the shadow of the course above. Rows match `thatch`/`tile`. */
export const SHINGLE_ROWS = 7;
export const shingleTex = () => cached('shingle', () => {
  const rows = SHINGLE_ROWS;
  const rng = new RNG(131);
  const cuts: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const c = [0];
    while (c[c.length - 1] < 0.9) c.push(c[c.length - 1] + 0.07 + rng.next() * 0.09);
    c.push(1);
    cuts.push(c);
  }
  return build(256, (u, v) => {
    const ry = v * rows;
    const row = Math.min(rows - 1, Math.floor(ry));
    const fy = ry - row;
    const c = cuts[row];
    let bi = 0;
    while (bi < c.length - 2 && u >= c[bi + 1]) bi++;
    const fx = (u - c[bi]) / (c[bi + 1] - c[bi]);
    const id = hash2(bi, row, 132);
    const grain = pfbmA(u, v, 64, 2, 3, 133 + bi);
    const fibre = pnoiseA(u * 256, v * 16, 256, 16, 134);
    const gap = sstep(0.06, 0.0, Math.min(fx, 1 - fx) * (c[bi + 1] - c[bi]) * 12);
    const lip = sstep(0.06, 0.0, fy);
    const under = Math.pow(fy, 2) * 0.45;
    const tone = (132 + (id - 0.5) * 50 + (grain - 0.5) * 40 + (fibre - 0.5) * 16) * (1 - under) * (1 - gap * 0.6) * (1 - lip * 0.35);
    const gray = 0.25 + id * 0.3;
    const l = tone * 0.8;
    return [tone * (1 - gray) + l * gray, tone * 0.76 * (1 - gray) + l * gray, tone * 0.54 * (1 - gray) + l * gray * 0.95,
      (1 - gap) * (0.5 + grain * 0.2) + (1 - fy) * 0.3];
  }, 5);
});

/** Rough coursed stone: irregular rows, stones of random length with rounded, chipped
 *  edges, recessed mortar. */
export const stoneTex = () => cached('stone', () => {
  const cs = makeCourses(5, 13, 0.18, 0.42, 0.3);
  return build(512, (u, v) => {
    const k = courseAt(cs, u, v);
    const n = pfbm(u, v, 16, 4, 12);
    const n2 = pfbm(u, v, 32, 3, 44);
    const fine = pnoise(u * 256, v * 256, 256, 45);
    const edgeN = pfbm(u, v, 24, 3, 46);
    const rad = 0.012 + hash2(k.id, 1, 17) * 0.03;
    const d = rrect(k.dx, k.dy, k.hx - 0.01, k.hy - 0.01, rad) + (edgeN - 0.5) * 0.03;
    const inS = sstep(0.003, -0.004, d);
    const bulge = sstep(0, 0.05, -d);
    const id = hash2(k.id, 0, 17);
    const hue = hash2(k.id, 2, 17);
    const tone = 142 + (id - 0.5) * 44 + (n - 0.5) * 36 + (n2 - 0.5) * 18 + (fine - 0.5) * 12;
    const wear = 0.84 + 0.16 * bulge;
    const sc = tone * wear;
    const sr = sc * (hue > 0.7 ? 1.05 : hue < 0.25 ? 0.97 : 1), sg = sc * 0.97, sb = sc * (hue > 0.7 ? 0.87 : hue < 0.25 ? 0.97 : 0.92);
    const mc = (150 + (fine - 0.5) * 30 + (n - 0.5) * 20) * 0.78;
    const r = sr * inS + mc * (1 - inS), g = sg * inS + mc * 0.96 * (1 - inS), b = sb * inS + mc * 0.86 * (1 - inS);
    const hgt = inS * (0.45 + bulge * 0.35 + n * 0.14 + fine * 0.04) + (1 - inS) * fine * 0.05;
    return [r, g, b, hgt];
  }, 7);
});

/** Wooden boards (vertical): varied widths, grain, butt joints with nails, weathering. */
export const planksTex = () => cached('planks', () => {
  const rng = new RNG(77);
  const edges = [0];
  while (edges[edges.length - 1] < 0.86) edges.push(edges[edges.length - 1] + 0.12 + rng.next() * 0.08);
  edges.push(1);
  const joint = edges.map(() => rng.next());
  return build(512, (u, v) => {
    let bi = 0;
    while (bi < edges.length - 2 && u >= edges[bi + 1]) bi++;
    const a = edges[bi], b = edges[bi + 1];
    const fx = (u - a) / (b - a);
    const jv = joint[bi];
    let dv = v - jv; dv -= Math.round(dv);
    const grain = pfbmA(u, v, 64, 2, 3, 7 + bi);
    const rings = Math.sin((u * 40 + pfbmA(u, v, 4, 1, 3, 70 + bi) * 5) * Math.PI) * 0.5 + 0.5;
    const fibre = pnoiseA(u * 256, v * 8, 256, 8, 71);
    const weather = hash2(bi, 0, 3);
    const gap = sstep(0.05, 0.0, Math.min(fx, 1 - fx) * (b - a) * 10);
    const butt = sstep(0.006, 0.0, Math.abs(dv));
    let nail = 0;
    for (const sx of [0.22, 0.78]) {
      const nd = Math.hypot((fx - sx) * (b - a), dv - 0.025 * Math.sign(dv || 1));
      nail = Math.max(nail, sstep(0.007, 0.004, nd));
    }
    const tone = 146 + (weather - 0.5) * 50 + rings * 16 + (grain - 0.5) * 34 + (fibre - 0.5) * 12;
    const gray = 0.2 + weather * 0.35;
    let r = tone, g = tone * 0.74, bb = tone * 0.5;
    const l = (r + g + bb) / 3;
    r = r * (1 - gray) + l * gray; g = g * (1 - gray) + l * gray; bb = bb * (1 - gray) + l * gray * 0.95;
    const dark = 1 - gap * 0.6 - butt * 0.5;
    r *= dark; g *= dark; bb *= dark;
    if (nail > 0) { r = r * (1 - nail) + 60 * nail; g = g * (1 - nail) + 56 * nail; bb = bb * (1 - nail) + 54 * nail; }
    return [r, g, bb, (1 - gap) * (0.6 + rings * 0.12 + grain * 0.18) - butt * 0.3 + nail * 0.15];
  }, 6);
});

/** Straw thatch laid in courses; ragged strand ends shade the course below. */
export const thatchTex = () => cached('thatch', () => build(512, (u, v) => {
  const courses = 6;
  const rag = pnoiseA(u * 18, 0, 18, 1, 41) * 0.14 + pnoiseA(u * 90, 0, 90, 1, 42) * 0.05 + pnoiseA(u * 260, 0, 260, 1, 43) * 0.03;
  const cv = v * courses + rag;
  const fy = cv - Math.floor(cv); // 0 = strand ends, 1 = under the next course
  const ci = Math.floor(cv);
  const strands = pnoiseA(u * 260, v * 6, 260, 6, 44 + (ci & 3));
  const strands2 = pnoiseA(u * 130, v * 12, 130, 12, 48);
  const n = pfbm(u, v, 6, 4, 3);
  const grey = sstep(0.55, 0.85, pfbm(u, v, 3, 3, 49)) * 0.4;
  const shade = 1 - Math.pow(fy, 3) * 0.4 - (fy < 0.05 ? (0.05 - fy) * 4 : 0);
  const tone = (150 + strands * 56 + (strands2 - 0.5) * 30 + (n - 0.5) * 44) * shade;
  const r = tone * 1.06, g = tone * (0.78 - grey * 0.04), b = tone * (0.34 + grey * 0.3);
  const l = (r + g + b) / 3;
  return [r * (1 - grey * 0.45) + l * grey * 0.45, g * (1 - grey * 0.45) + l * grey * 0.45, b * (1 - grey * 0.45) + l * grey * 0.4,
    strands * 0.18 + (1 - fy) * 0.6 + strands2 * 0.06];
}, 3.5));

/** Dirt/cobble ground patch for yards. */
export const cobbleTex = () => cached('cobble', () => build(256, (u, v) => {
  const [f1, id, edge] = pworley(u, v, 12, 191);
  const n = pfbm(u, v, 16, 3, 2);
  const gap = edge < 0.08 ? 1 - edge / 0.08 : 0;
  const c = 140 + (id - 0.5) * 50 + (n - 0.5) * 30;
  return [c * (1 - gap * 0.5), c * 0.95 * (1 - gap * 0.5), c * 0.88 * (1 - gap * 0.5), (1 - gap) * (0.8 - f1 * 0.4)];
}, 5));

/** Cloth texture for banners (subtle weave). */
export const clothTex = () => cached('cloth', () => build(64, (u, v) => {
  const weave = (Math.sin(u * 64 * Math.PI) * Math.sin(v * 64 * Math.PI)) * 0.5 + 0.5;
  const c = 225 + weave * 30;
  return [c, c, c, weave];
}, 1));

/** Leaf cluster card (RGBA with alpha) painted procedurally. kind 0 broadleaf, 1 needles. */
const leafCache = new Map<number, THREE.CanvasTexture>();
export function leafTexture(kind = 0): THREE.CanvasTexture {
  const hit = leafCache.get(kind);
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  let seed = 1234 + kind * 77;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 0) {
    for (let i = 0; i < 300; i++) {
      // cluster leaves towards the centre so the card has an organic silhouette
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * S * 0.37;
      const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
      const len = 16 + rnd() * 14, wid = len * (0.45 + rnd() * 0.15);
      const rot = a + Math.PI / 2 + (rnd() - 0.5) * 1.6;
      const lum = 0.75 + rnd() * 0.5;
      const gcol = `rgb(${Math.round(150 * lum)},${Math.round(200 * lum)},${Math.round(110 * lum)})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = gcol;
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0);
      ctx.quadraticCurveTo(0, -wid, len / 2, 0);
      ctx.quadraticCurveTo(0, wid, -len / 2, 0);
      ctx.fill();
      ctx.strokeStyle = `rgba(40,70,20,0.35)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0);
      ctx.lineTo(len / 2, 0);
      ctx.stroke();
      ctx.restore();
    }
    // a few twigs
    ctx.strokeStyle = 'rgba(90,70,45,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(S / 2, S / 2);
      ctx.lineTo(S / 2 + Math.cos(a) * S * 0.3, S / 2 + Math.sin(a) * S * 0.3);
      ctx.stroke();
    }
  } else {
    // a fan of branches spreading from the top centre (trunk side) downwards
    const branches = 7;
    for (let b = 0; b < branches; b++) {
      const tx = S * (0.1 + (b / (branches - 1)) * 0.8);
      const x0 = S * 0.5, y0 = 4;
      const x1 = tx + (rnd() - 0.5) * 20, y1 = S * (0.86 + rnd() * 0.1);
      ctx.strokeStyle = 'rgba(70,50,30,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const steps = 26;
      for (let k = 2; k < steps; k++) {
        const t = k / steps;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const dirA = Math.atan2(y1 - y0, x1 - x0);
        for (const side of [-1, 1]) {
          const ang = dirA + side * (0.9 + rnd() * 0.3);
          const len = 12 + rnd() * 12 * (0.6 + t * 0.5);
          const lum = 0.65 + rnd() * 0.55;
          ctx.strokeStyle = `rgb(${Math.round(80 * lum)},${Math.round(140 * lum)},${Math.round(84 * lum)})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
          ctx.stroke();
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  leafCache.set(kind, t);
  return t;
}

/** Bare twig card (alpha only) for deciduous crowns in winter: forking twigs spreading from the card centre. */
let twigTex: THREE.CanvasTexture | null = null;
export function twigTexture(): THREE.CanvasTexture {
  if (twigTex) return twigTex;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  let seed = 4711;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const twig = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    // slightly zig-zagging segment, then fork
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.5;
      const nx = x + Math.cos(a) * (len / steps), ny = y + Math.sin(a) * (len / steps);
      ctx.lineWidth = w * (1 - s * 0.12);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx; y = ny;
    }
    if (depth <= 0 || w < 1.3) return;
    const n = rnd() < 0.35 ? 3 : 2;
    for (let k = 0; k < n; k++) twig(x, y, a + (k - (n - 1) / 2) * (0.55 + rnd() * 0.35), len * (0.62 + rnd() * 0.15), w * 0.7, depth - 1);
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.6;
    twig(S / 2 + Math.cos(a) * 8, S / 2 + Math.sin(a) * 8, a, S * (0.13 + rnd() * 0.05), 4.5, 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  twigTex = t;
  return t;
}
