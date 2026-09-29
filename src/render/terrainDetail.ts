// Painted high-resolution detail layers for close-up terrain: grass blades, leaf litter,
// soil with pebbles, sand grains, fractured rock and mud. Every layer is painted in the
// terrain's real colours and then normalised by its mean, so the shader multiplies it onto
// the macro colour: far away (where mips average out) the map looks exactly as before.
//
// tDetail  (RGBA): albedo modulation * 0.4, height
// tDetailN (RGBA): normal xy (tangent space, 0.5 = flat), cavity, roughness multiplier * 0.5
import * as THREE from 'three';
import { RNG, hash2 as hashf } from '../core/rng';
import { pfbm, pnoise, pworley } from './textures';

export const DETAIL_SIZE = 512;
/** Layer indices inside the detail arrays. */
export const DETAIL = { grass: 0, forest: 1, dirt: 2, sand: 3, rock: 4, mud: 5 } as const;
const LAYERS = 6;

const S = DETAIL_SIZE;
const N = S * S;
const wrap = (x: number, y: number) => ((y & (S - 1)) << 9) | (x & (S - 1));

type RGB = [number, number, number];

class Layer {
  r = new Float32Array(N);
  g = new Float32Array(N);
  b = new Float32Array(N);
  h = new Float32Array(N);
  rough = new Float32Array(N).fill(1);

  fill(fn: (u: number, v: number, i: number) => void) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x / S, y / S, y * S + x);
  }

  set(i: number, c: RGB, k: number, z: number, rough: number) {
    this.r[i] = c[0] * k; this.g[i] = c[1] * k; this.b[i] = c[2] * k;
    this.h[i] = z;
    this.rough[i] = rough;
  }

  /** Tapered stroke (grass blade, needle, twig) with a rounded cross-section; z-tested. */
  stroke(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: RGB, z0: number, z1: number, rough = 1, tipLight = 0.15) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1e-6;
    const pad = Math.max(w0, w1) * 0.5 + 1;
    const ax = Math.floor(Math.min(x0, x1) - pad), bx = Math.ceil(Math.max(x0, x1) + pad);
    const ay = Math.floor(Math.min(y0, y1) - pad), by = Math.ceil(Math.max(y0, y1) + pad);
    for (let py = ay; py <= by; py++) {
      for (let px = ax; px <= bx; px++) {
        const qx = px + 0.5 - x0, qy = py + 0.5 - y0;
        const t = (qx * dx + qy * dy) / len2;
        if (t < 0 || t > 1) continue;
        const ex = qx - dx * t, ey = qy - dy * t;
        const hw = (w0 + (w1 - w0) * t) * 0.5;
        const d2 = ex * ex + ey * ey;
        if (d2 > hw * hw) continue;
        const prof = 1 - d2 / (hw * hw);
        const z = z0 + (z1 - z0) * t + prof * 0.05;
        const i = wrap(px, py);
        if (z <= this.h[i]) continue;
        this.set(i, c, (0.78 + 0.22 * prof) * (1 - tipLight + tipLight * 2 * t), z, rough);
      }
    }
  }

  /** Irregular dome (pebble, clod, lichen) or pointed lens (leaf). */
  blob(cx: number, cy: number, rx: number, ry: number, rot: number, c: RGB, z0: number, zAmp: number, rough: number,
    shape: 'dome' | 'leaf' | 'flat' = 'dome', wob = 0.15, seed = 0) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const rm = Math.max(rx, ry) * (1 + wob) + 1;
    for (let py = Math.floor(cy - rm); py <= Math.ceil(cy + rm); py++) {
      for (let px = Math.floor(cx - rm); px <= Math.ceil(cx + rm); px++) {
        const qx = px + 0.5 - cx, qy = py + 0.5 - cy;
        const lx = (qx * cs + qy * sn) / rx, ly = (-qx * sn + qy * cs) / ry;
        let prof: number;
        if (shape === 'leaf') {
          if (lx < -1 || lx > 1) continue;
          const hwid = (1 - lx * lx) * (1 + 0.25 * lx);
          const a = Math.abs(ly);
          if (a > hwid) continue;
          prof = 1 - a / hwid;
          // curled edges sit higher, a darker mid-rib
          const shade = (0.8 + 0.2 * prof) * (a < 0.08 ? 0.72 : 1);
          const z = z0 + zAmp * (0.55 + 0.45 * (1 - prof) * (1 - prof));
          const i = wrap(px, py);
          if (z <= this.h[i]) continue;
          this.set(i, c, shade, z, rough);
          continue;
        }
        const ang = Math.atan2(ly, lx);
        const r = 1 + wob * (Math.sin(ang * 3 + seed) * 0.6 + Math.sin(ang * 5 + seed * 1.7) * 0.4);
        const q = (lx * lx + ly * ly) / (r * r);
        if (q >= 1) continue;
        prof = Math.sqrt(1 - q);
        const i = wrap(px, py);
        if (shape === 'flat') {
          // paint only (lichen, stains): keeps the surface relief underneath
          const k = 0.92 + 0.08 * prof;
          this.r[i] = c[0] * k; this.g[i] = c[1] * k; this.b[i] = c[2] * k;
          this.h[i] += zAmp * Math.min(1, prof * 3);
          this.rough[i] = rough;
          continue;
        }
        const z = z0 + zAmp * prof;
        if (z <= this.h[i]) continue;
        this.set(i, c, 0.82 + 0.18 * prof, z, rough);
      }
    }
  }
}

function jitter(rng: RNG, c: RGB, lum: number, hue = 0.08): RGB {
  const l = 1 + (rng.next() - 0.5) * 2 * lum;
  return [c[0] * l * (1 + (rng.next() - 0.5) * hue), c[1] * l, c[2] * l * (1 + (rng.next() - 0.5) * hue)];
}

function pick<T>(rng: RNG, items: [T, number][]): T {
  let r = rng.next() * items.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of items) { if ((r -= w) <= 0) return v; }
  return items[0][0];
}

// ---------------------------------------------------------------- layers
function grassLayer(): Layer {
  const L = new Layer();
  const rng = new RNG(101);
  L.fill((u, v, i) => {
    const n = pfbm(u, v, 16, 3, 7);
    // shaded ground under the sward reads as dark green, not bare soil
    L.set(i, [0.035, 0.07, 0.02], 0.8 + n * 0.4, n * 0.08, 1);
  });
  // clover and small round-leaved weeds sitting between the blades
  for (let k = 0; k < 50; k++) {
    const cx = rng.next() * S, cy = rng.next() * S;
    const n = 4 + Math.floor(rng.next() * 12);
    for (let j = 0; j < n; j++) {
      const x = cx + (rng.next() - 0.5) * 34, y = cy + (rng.next() - 0.5) * 34;
      const r = 2.2 + rng.next() * 1.6;
      const col = jitter(rng, [0.09, 0.24, 0.05], 0.18);
      const a0 = rng.next() * 6.28;
      for (let l = 0; l < 3; l++) {
        const a = a0 + (l / 3) * 6.283;
        L.blob(x + Math.cos(a) * r, y + Math.sin(a) * r, r, r * 0.9, a, col, 0.35 + rng.next() * 0.3, 0.12, 0.9, 'dome', 0.1, k + l);
      }
    }
  }
  // blades: a dense sward in close shades of green, hardly any straw
  const cols: [RGB, number][] = [
    [[0.12, 0.3, 0.045], 46], [[0.16, 0.34, 0.05], 22], [[0.085, 0.24, 0.045], 20], [[0.21, 0.33, 0.07], 9], [[0.3, 0.32, 0.11], 3],
  ];
  for (let k = 0; k < 56000; k++) {
    const x = rng.next() * S, y = rng.next() * S;
    const depth = rng.next();
    const len = 7 + rng.next() * 13;
    const a = rng.next() * 6.283;
    const bend = (rng.next() - 0.5) * 0.9;
    const w = 1.2 + rng.next() * 1.4;
    const col = jitter(rng, pick(rng, cols), 0.15);
    const k2 = 0.55 + depth * 0.45; // blades deep in the sward are in shadow
    const c: RGB = [col[0] * k2, col[1] * k2, col[2] * k2];
    const mx = x + Math.cos(a) * len * 0.55, my = y + Math.sin(a) * len * 0.55;
    const tx = mx + Math.cos(a + bend) * len * 0.45, ty = my + Math.sin(a + bend) * len * 0.45;
    const z0 = 0.1 + depth * 0.55;
    L.stroke(x, y, mx, my, w, w * 0.7, c, z0, z0 + 0.12, 0.95);
    L.stroke(mx, my, tx, ty, w * 0.7, 0.35, c, z0 + 0.12, z0 + 0.2, 0.95);
  }
  return L;
}

function forestLayer(): Layer {
  const L = new Layer();
  const rng = new RNG(202);
  const moss = new Float32Array(N);
  L.fill((u, v, i) => {
    const n = pfbm(u, v, 8, 4, 31);
    const m = pfbm(u, v, 4, 4, 77);
    moss[i] = m;
    const fine = pnoise(u * 256, v * 256, 256, 5);
    const mk = Math.min(1, Math.max(0, (m - 0.45) * 5));
    const soil: RGB = [0.07, 0.05, 0.028];
    const mc: RGB = [0.07 + fine * 0.05, 0.15 + fine * 0.08, 0.03];
    const c: RGB = [soil[0] + (mc[0] - soil[0]) * mk, soil[1] + (mc[1] - soil[1]) * mk, soil[2] + (mc[2] - soil[2]) * mk];
    L.set(i, c, 0.8 + n * 0.4, n * 0.12 + mk * (0.25 + fine * 0.15), 1);
  });
  // low grass and moss tufts
  for (let k = 0; k < 9000; k++) {
    const x = rng.next() * S, y = rng.next() * S;
    if (moss[wrap(x | 0, y | 0)] < 0.4 && rng.next() < 0.6) continue;
    const a = rng.next() * 6.283, len = 5 + rng.next() * 8, d = rng.next();
    const col = jitter(rng, [0.08, 0.2, 0.04], 0.25);
    L.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.6, 0.4, col, 0.2 + d * 0.3, 0.35 + d * 0.3, 0.95);
  }
  // fallen leaves
  const leafCols: [RGB, number][] = [
    [[0.26, 0.12, 0.035], 30], [[0.4, 0.24, 0.05], 18], [[0.13, 0.075, 0.03], 20], [[0.2, 0.19, 0.05], 14], [[0.33, 0.09, 0.03], 8],
  ];
  for (let k = 0; k < 2300; k++) {
    const x = rng.next() * S, y = rng.next() * S;
    if (moss[wrap(x | 0, y | 0)] > 0.6 && rng.next() < 0.7) continue;
    const len = 6 + rng.next() * 8;
    const col = jitter(rng, pick(rng, leafCols), 0.2);
    const z = 0.3 + rng.next() * 0.5;
    L.blob(x, y, len, len * (0.38 + rng.next() * 0.18), rng.next() * 6.283, col, z, 0.12, 0.85, 'leaf');
  }
  // pine needles
  for (let k = 0; k < 2600; k++) {
    const x = rng.next() * S, y = rng.next() * S, a = rng.next() * 6.283, len = 7 + rng.next() * 7;
    const col = jitter(rng, [0.3, 0.14, 0.05], 0.25);
    const z = 0.35 + rng.next() * 0.45;
    L.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.1, 0.8, col, z, z + 0.03, 0.8, 0.05);
  }
  // twigs
  for (let k = 0; k < 70; k++) {
    let x = rng.next() * S, y = rng.next() * S, a = rng.next() * 6.283;
    const col = jitter(rng, [0.14, 0.1, 0.065], 0.2);
    const w = 1.8 + rng.next() * 1.8;
    const segs = 2 + Math.floor(rng.next() * 3);
    for (let s = 0; s < segs; s++) {
      const len = 10 + rng.next() * 16;
      const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
      L.stroke(x, y, nx, ny, w, w * 0.85, col, 0.62, 0.64, 0.9, 0);
      if (rng.next() < 0.5) {
        const b = a + (rng.next() < 0.5 ? -0.8 : 0.8);
        L.stroke(nx, ny, nx + Math.cos(b) * len * 0.5, ny + Math.sin(b) * len * 0.5, w * 0.6, w * 0.3, col, 0.62, 0.63, 0.9, 0);
      }
      x = nx; y = ny; a += (rng.next() - 0.5) * 0.7;
    }
  }
  return L;
}

function dirtLayer(): Layer {
  const L = new Layer();
  const rng = new RNG(303);
  L.fill((u, v, i) => {
    const n = pfbm(u, v, 8, 4, 12);
    const n2 = pfbm(u, v, 32, 3, 4);
    const lump = pfbm(u, v, 20, 3, 71);
    const wu = u + (pfbm(u, v, 6, 2, 81) - 0.5) * 0.05, wv = v + (pfbm(u, v, 6, 2, 82) - 0.5) * 0.05;
    const [, id, edge] = pworley(wu, wv, 16, 91);
    const crackMask = Math.max(0, (pfbm(u, v, 4, 3, 55) - 0.6) * 6);
    const crack = edge < 0.022 ? (1 - edge / 0.022) * Math.min(1, crackMask) : 0;
    const grit = pnoise(u * 512, v * 512, 512, 9);
    const tone = 0.8 + n * 0.3 + (n2 - 0.5) * 0.22 + (grit - 0.5) * 0.16 + (lump - 0.5) * 0.18 - crack * 0.35;
    const warm = 0.96 + id * 0.08;
    L.set(i, [0.2 * warm, 0.13, 0.07 / warm], tone, n * 0.12 + lump * 0.2 + n2 * 0.08 + grit * 0.03 - crack * 0.12, 1);
  });
  // straw and root bits
  for (let k = 0; k < 160; k++) {
    const x = rng.next() * S, y = rng.next() * S, a = rng.next() * 6.283, len = 5 + rng.next() * 9;
    L.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.2, 0.8, jitter(rng, [0.38, 0.3, 0.14], 0.2), 0.42, 0.44, 0.9, 0);
  }
  // pebbles
  const pc: [RGB, number][] = [
    [[0.3, 0.28, 0.25], 30], [[0.4, 0.34, 0.26], 22], [[0.2, 0.19, 0.18], 18], [[0.5, 0.46, 0.4], 12], [[0.34, 0.22, 0.14], 10],
  ];
  for (let k = 0; k < 520; k++) {
    const x = rng.next() * S, y = rng.next() * S;
    const big = rng.next() < 0.08;
    const r = big ? 6 + rng.next() * 5 : 1.6 + rng.next() * 3.4;
    const col = jitter(rng, pick(rng, pc), 0.18);
    L.blob(x, y, r, r * (0.6 + rng.next() * 0.4), rng.next() * 6.283, col, 0.3, big ? 0.45 : 0.3, 0.55, 'dome', 0.18, k);
  }
  return L;
}

function sandLayer(): Layer {
  const L = new Layer();
  const rng = new RNG(404);
  L.fill((u, v, i) => {
    const n = pfbm(u, v, 8, 3, 21);
    const grain = pnoise(u * 512, v * 512, 512, 13);
    const g2 = pnoise(u * 256, v * 256, 256, 17);
    const x = Math.floor(u * S), y = Math.floor(v * S);
    const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const sp = (hsh % 1000) / 1000;
    let c: RGB = [0.62, 0.5, 0.3];
    if (sp > 0.975) c = [0.22, 0.19, 0.16];
    else if (sp > 0.955) c = [0.85, 0.82, 0.74];
    else if (sp > 0.94) c = [0.55, 0.3, 0.16];
    L.set(i, c, 0.86 + n * 0.16 + (grain - 0.5) * 0.18 + (g2 - 0.5) * 0.1, n * 0.05 + grain * 0.05 + g2 * 0.05, 1);
  });
  // shell fragments and small stones
  for (let k = 0; k < 90; k++) {
    const x = rng.next() * S, y = rng.next() * S, r = 1.4 + rng.next() * 2.6;
    const col = jitter(rng, rng.next() < 0.5 ? [0.78, 0.72, 0.64] : [0.38, 0.34, 0.3], 0.15);
    L.blob(x, y, r, r * (0.5 + rng.next() * 0.4), rng.next() * 6.283, col, 0.25, 0.2, 0.5, 'dome', 0.2, k);
  }
  return L;
}

function rockLayer(): Layer {
  const L = new Layer();
  const rng = new RNG(505);
  L.fill((u, v, i) => {
    const wu = u + (pfbm(u, v, 4, 3, 91) - 0.5) * 0.09, wv = v + (pfbm(u, v, 4, 3, 92) - 0.5) * 0.09;
    // chipped facets: every (warped) worley cell is a slightly tilted plane
    const cells = 7;
    const x = wu * cells, y = wv * cells;
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, best = 0, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
      const px = cx + hashf(wx, wy, 1), py = cy + hashf(wx, wy, 2);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; best = wy * cells + wx; bx = px; by = py; }
      else if (d < f2) f2 = d;
    }
    const ga = (hashf(best, 0, 3) - 0.5) * 0.22, gb = (hashf(best, 0, 4) - 0.5) * 0.22;
    const facet = hashf(best, 0, 5) * 0.08 + ga * (x - bx) + gb * (y - by);
    const [, , e2] = pworley(wu, wv, 19, 97);
    const mask = pfbm(u, v, 5, 3, 93);
    const big = f2 - f1 < 0.022 && mask > 0.56 ? (1 - (f2 - f1) / 0.022) * Math.min(1, (mask - 0.56) * 12) : 0;
    const small = e2 < 0.018 && mask > 0.68 ? (1 - e2 / 0.018) * 0.5 : 0;
    const crack = Math.max(big, small);
    const n = pfbm(u, v, 8, 5, 41);
    const ridge = 1 - Math.abs(pfbm(u, v, 12, 4, 44) * 2 - 1);
    const fine = pnoise(u * 256, v * 256, 256, 3);
    const pit = pnoise(u * 128, v * 128, 128, 7) > 0.86 ? 0.5 : 0;
    const tone = 0.84 + (hashf(best, 0, 6) - 0.5) * 0.12 + (n - 0.5) * 0.4 + (fine - 0.5) * 0.14 + ridge * 0.08 - crack * 0.4 - pit * 0.2;
    const warm = 0.96 + hashf(best, 0, 7) * 0.08;
    const spk = hashf(Math.floor(u * S), Math.floor(v * S), 8);
    const c: RGB = spk > 0.985 ? [0.5, 0.49, 0.47] : spk < 0.015 ? [0.08, 0.08, 0.08] : [0.28 * warm, 0.27, 0.25 / warm];
    L.set(i, c, tone, facet + n * 0.5 + ridge * 0.16 + fine * 0.05 - crack * 0.22 - pit * 0.05, 1);
  });
  // lichen
  const lc: [RGB, number][] = [[[0.34, 0.37, 0.2], 40], [[0.42, 0.42, 0.38], 35], [[0.45, 0.3, 0.12], 6], [[0.2, 0.25, 0.11], 19]];
  for (let k = 0; k < 45; k++) {
    const x = rng.next() * S, y = rng.next() * S, r = 2.5 + rng.next() * 7;
    const col = jitter(rng, pick(rng, lc), 0.15);
    const n = 1 + Math.floor(rng.next() * 4);
    for (let j = 0; j < n; j++) {
      L.blob(x + (rng.next() - 0.5) * r * 1.5, y + (rng.next() - 0.5) * r * 1.5, r * (0.5 + rng.next() * 0.5), r * (0.4 + rng.next() * 0.5), rng.next() * 6.283,
        col, 0, 0.02, 1, 'flat', 0.35, k * 7 + j);
    }
  }
  return L;
}

function mudLayer(): Layer {
  const L = new Layer();
  const rng = new RNG(606);
  L.fill((u, v, i) => {
    const n = pfbm(u, v, 6, 4, 61);
    const n2 = pfbm(u, v, 24, 3, 62);
    const [, , edge] = pworley(u + (n2 - 0.5) * 0.04, v + (n - 0.5) * 0.04, 14, 63);
    const dry = Math.max(0, Math.min(1, (n - 0.55) * 5));
    const crack = edge < 0.025 ? (1 - edge / 0.025) * dry : 0;
    const wet = 1 - dry;
    L.set(i, [0.13, 0.11, 0.065], (0.7 + n2 * 0.3) * (1 - wet * 0.35) * (1 - crack * 0.4), n * 0.5 + n2 * 0.1 - crack * 0.12, 1 - wet * 0.7);
  });
  // reeds and grass stubble
  for (let k = 0; k < 700; k++) {
    const x = rng.next() * S, y = rng.next() * S, a = rng.next() * 6.283, len = 5 + rng.next() * 9;
    L.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 2, 0.5, jitter(rng, [0.2, 0.25, 0.07], 0.3), 0.45, 0.5, 0.95);
  }
  return L;
}


// ---------------------------------------------------------------- packing
function blurWrap(src: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(N), out = new Float32Array(N);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < S; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[wrap(x, y)];
    for (let x = 0; x < S; x++) {
      tmp[y * S + x] = acc * k;
      acc += src[wrap(x + r + 1, y)] - src[wrap(x - r, y)];
    }
  }
  for (let x = 0; x < S; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[wrap(x, y)];
    for (let y = 0; y < S; y++) {
      out[y * S + x] = acc * k;
      acc += tmp[wrap(x, y + r + 1)] - tmp[wrap(x, y - r)];
    }
  }
  return out;
}

function pack(L: Layer, layer: number, alb: Uint8Array, nrm: Uint8Array, strength: number, cavity: number) {
  let mr = 0, mg = 0, mb = 0, hmin = 1e9, hmax = -1e9, rmean = 0;
  for (let i = 0; i < N; i++) {
    mr += L.r[i]; mg += L.g[i]; mb += L.b[i];
    rmean += L.rough[i];
    if (L.h[i] < hmin) hmin = L.h[i];
    if (L.h[i] > hmax) hmax = L.h[i];
  }
  mr = N / mr; mg = N / mg; mb = N / mb; rmean = N / rmean;
  const hs = 1 / Math.max(1e-4, hmax - hmin);
  const blur = blurWrap(L.h, 3);
  const o = layer * N * 4;
  const b8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, j = o + i * 4;
      alb[j] = b8(L.r[i] * mr * 0.4);
      alb[j + 1] = b8(L.g[i] * mg * 0.4);
      alb[j + 2] = b8(L.b[i] * mb * 0.4);
      alb[j + 3] = b8((L.h[i] - hmin) * hs);
      const dx = (L.h[wrap(x + 1, y)] - L.h[wrap(x - 1, y)]) * strength;
      const dy = (L.h[wrap(x, y + 1)] - L.h[wrap(x, y - 1)]) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      nrm[j] = b8(-dx * inv * 0.5 + 0.5);
      nrm[j + 1] = b8(-dy * inv * 0.5 + 0.5);
      nrm[j + 2] = b8(1 - Math.max(0, blur[i] - L.h[i]) * cavity);
      nrm[j + 3] = b8(L.rough[i] * rmean * 0.5);
    }
  }
}

let cache: { albedo: THREE.DataArrayTexture; normal: THREE.DataArrayTexture } | null = null;

function arrayTex(data: Uint8Array): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, S, S, LAYERS);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** The detail arrays. They start neutral (modulation 1, flat, no cavity), which renders
 *  exactly like the far-away look, and the layers are painted one per tick after startup so
 *  they never delay the first frame. `immediate` paints everything before returning. */
export function getTerrainDetail(immediate = false) {
  if (cache) return cache;
  const alb = new Uint8Array(N * 4 * LAYERS), nrm = new Uint8Array(N * 4 * LAYERS);
  for (let i = 0; i < N * LAYERS; i++) {
    alb[i * 4] = alb[i * 4 + 1] = alb[i * 4 + 2] = 102;
    alb[i * 4 + 3] = 128;
    nrm[i * 4] = nrm[i * 4 + 1] = nrm[i * 4 + 3] = 128;
    nrm[i * 4 + 2] = 255;
  }
  const c = (cache = { albedo: arrayTex(alb), normal: arrayTex(nrm) });
  // [layer, generator, normal strength, cavity strength] in order of how often they are seen
  const gens: [number, () => Layer, number, number][] = [
    [DETAIL.grass, grassLayer, 9, 2.2], [DETAIL.dirt, dirtLayer, 14, 2.6], [DETAIL.forest, forestLayer, 9, 2.4],
    [DETAIL.rock, rockLayer, 10, 2.6], [DETAIL.sand, sandLayer, 10, 1.5], [DETAIL.mud, mudLayer, 9, 1.8],
  ];
  // Once an array is on the GPU only the painted layer goes up (six full uploads of both, 12 MB
  // each time, stalled the first second of play by ~80 ms). Until then the whole array must go:
  // a partial update on a texture's first upload would leave the other layers uninitialised.
  const onGpu = new Set<THREE.Texture>();
  for (const t of [c.albedo, c.normal]) t.onUpdate = () => onGpu.add(t);
  const paint = ([layer, g, str, cav]: (typeof gens)[number]) => {
    pack(g(), layer, alb, nrm, str, cav);
    for (const t of [c.albedo, c.normal]) {
      if (onGpu.has(t)) t.addLayerUpdate(layer);
      t.needsUpdate = true;
    }
  };
  if (immediate) gens.forEach(paint);
  else {
    let k = 0;
    const next = () => {
      paint(gens[k]);
      if (++k < gens.length) setTimeout(next, 16);
    };
    setTimeout(next, 250);
  }
  return c;
}
