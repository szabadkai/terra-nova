// Procedurally generated textures (no external image assets).
import * as THREE from 'three';
import { hash2 } from '../core/rng';

// ---------------------------------------------------------------- tileable noise helpers
function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Periodic value noise in [0,1]. x,y in lattice units; period in lattice cells. */
export function pnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = fade(xf), v = fade(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Periodic fbm; u,v in [0,1). */
export function pfbm(u: number, v: number, basePeriod: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, per = basePeriod;
  for (let o = 0; o < oct; o++) {
    sum += amp * pnoise(u * per, v * per, per, seed + o * 17);
    norm += amp;
    amp *= gain;
    per *= 2;
  }
  return sum / norm;
}

/** Periodic worley noise: returns [F1 distance (0..~1), cell random, F2-F1]. */
export function pworley(u: number, v: number, cells: number, seed: number): [number, number, number] {
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
      const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 2); }
      else if (d < f2) f2 = d;
    }
  }
  return [Math.min(1, f1), id, Math.min(1, f2 - f1)];
}

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
      let nx = -dx, ny = dy, nz = 1;
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

function build(size: number, fn: (u: number, v: number) => [number, number, number, number], strength: number, h = size): MatTex {
  const height = new Float32Array(size * h);
  const cols: number[][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, hh] = fn(x / size, y / h);
      cols.push([r, g, b]);
      height[y * size + x] = hh;
    }
  let k = 0;
  const map = makeData(size, (_u, _v, o) => {
    const c = cols[k++];
    o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
  }, true, h);
  const normal = normalFromHeight(size, height, strength, h);
  return { map, normal };
}

const cache = new Map<string, MatTex>();
function cached(key: string, f: () => MatTex) {
  let t = cache.get(key);
  if (!t) { t = f(); cache.set(key, t); }
  return t;
}

/** Whitewashed plaster wall. 1 texture unit = 1 world unit. */
export const plasterTex = () => cached('plaster', () => build(256, (u, v) => {
  const n = pfbm(u, v, 8, 5, 5);
  const blotch = pfbm(u, v, 3, 3, 9);
  const speck = pnoise(u * 128, v * 128, 128, 3);
  let c = 226 + (n - 0.5) * 30 - (blotch > 0.62 ? (blotch - 0.62) * 80 : 0);
  c -= speck > 0.92 ? 25 : 0;
  const warm = 0.97 + blotch * 0.04;
  return [c * 1.0, c * 0.96 * warm, c * 0.88 * warm, n * 0.6 + speck * 0.2];
}, 2.2));

/** Dark weathered timber beams. */
export const timberTex = () => cached('timber', () => build(128, (u, v) => {
  const grain = pfbm(u * 0.5, v, 4, 5, 21) ;
  const lines = Math.sin((u * 18 + grain * 6) * Math.PI) * 0.5 + 0.5;
  const c = 72 + lines * 22 + (grain - 0.5) * 30;
  return [c * 1.0, c * 0.72, c * 0.5, lines * 0.5 + grain * 0.5];
}, 3.5));

/** Neutral clay roof tiles (tinted per player through material color). */
export const roofTex = () => cached('roof', () => build(256, (u, v) => {
  const rows = 8, cols = 10;
  const ry = v * rows;
  const row = Math.floor(ry);
  const fy = ry - row;
  const off = (row % 2) * 0.5;
  const cx = u * cols + off;
  const col = Math.floor(cx);
  const fx = cx - col;
  // curved tile profile
  const prof = Math.sin(fx * Math.PI);
  const tileVar = hash2(col % cols, row, 5);
  const n = pfbm(u, v, 16, 3, 31);
  const shadow = Math.pow(fy, 3); // overlapped bottom edge darker
  let c = 200 + prof * 40 - shadow * 110 + (tileVar - 0.5) * 50 + (n - 0.5) * 30;
  const edge = fx < 0.05 || fx > 0.95 ? 0.6 : 1;
  c *= edge;
  const hgt = prof * 0.6 + (1 - fy) * 0.4 + n * 0.1;
  return [c, c * 0.97, c * 0.94, hgt];
}, 4));

/** Rough stone masonry (coursed ashlar-ish blocks). */
export const stoneTex = () => cached('stone', () => build(256, (u, v) => {
  const rows = 5;
  const ry = v * rows;
  const row = Math.floor(ry);
  const fy = ry - row;
  const off = hash2(row, 0, 13) * 0.5;
  const cols = 3 + Math.floor(hash2(row, 1, 13) * 2);
  const cx = (u + off) * cols;
  const col = Math.floor(cx);
  const fx = cx - col;
  const id = hash2(((col % cols) + cols) % cols, row, 17);
  const n = pfbm(u, v, 16, 4, 12);
  const n2 = pfbm(u, v, 32, 3, 44);
  const ex = Math.min(fx, 1 - fx) * 2.2, ey = Math.min(fy, 1 - fy) * 1.3;
  const edge = Math.min(ex, ey);
  const mortar = 1 - Math.min(1, edge / 0.09);
  const bulge = Math.min(1, edge / 0.35);
  const tone = 140 + (id - 0.5) * 34 + (n - 0.5) * 34 + (n2 - 0.5) * 16;
  const c = tone * (1 - mortar * 0.38) * (0.9 + bulge * 0.1);
  const tint = 0.97 + id * 0.05;
  return [c * tint, c * 0.97, c * 0.9 / tint, (1 - mortar) * (0.6 + bulge * 0.3) + n * 0.12];
}, 4));

/** Wooden planks (vertical). */
export const planksTex = () => cached('planks', () => build(256, (u, v) => {
  const boards = 6;
  const bx = u * boards;
  const bi = Math.floor(bx);
  const fx = bx - bi;
  const grain = pfbm(u * 0.3 + bi * 0.17, v * 2, 4, 4, 7 + bi);
  const lines = Math.sin((v * 40 + grain * 10) * Math.PI) * 0.5 + 0.5;
  const tone = 150 + (hash2(bi, 0, 3) - 0.5) * 50 + lines * 18 + (grain - 0.5) * 30;
  const gap = fx < 0.04 || fx > 0.96 ? 0.45 : 1;
  const c = tone * gap;
  return [c, c * 0.74, c * 0.5, gap * (0.6 + lines * 0.2)];
}, 3));

/** Straw thatch. */
export const thatchTex = () => cached('thatch', () => build(256, (u, v) => {
  const strands = pnoise(u * 180, v * 12, 180, 44);
  const layer = (v * 9) % 1;
  const n = pfbm(u, v, 8, 3, 3);
  const c = 170 + strands * 60 - Math.pow(layer, 4) * 70 + (n - 0.5) * 40;
  return [c, c * 0.86, c * 0.52, strands * 0.6 + (1 - layer) * 0.4];
}, 5));

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
