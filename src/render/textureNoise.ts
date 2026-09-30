// Tileable noise for texture generation, shared by the page and terrain worker.
import { hash2 } from '../core/rng';

// ---------------------------------------------------------------- tileable noise helpers
export function fade(t: number) {
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
