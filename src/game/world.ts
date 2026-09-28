// Grid world data. Nodes live on an integer lattice; node (x, y) sits at world (x, h, y).
import { T_ROCK, T_SNOW } from './defs';

export const WATER_LEVEL = 2.0;

export const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
export const DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

export class World {
  W: number;
  H: number;
  N: number;
  h: Float32Array;
  terrain: Uint8Array; // dominant terrain material
  owner: Int8Array;
  building: Int32Array; // building id occupying (footprint), 0 none
  blocked: Uint8Array; // 1 if impassable because of a building/stone
  tree: Int32Array; // tree id at node
  stone: Int32Array; // stone id at node
  field: Int32Array; // field id at node
  reserve: Int32Array; // building id that reserved this node (construction clearance)
  ore: Uint8Array;
  oreAmt: Uint8Array;
  fish: Uint8Array;
  wear: Float32Array;
  explored: Uint8Array; // for the local player
  region: Int32Array; // connected landmass id (1..), 0 on water
  sea: Int32Array; // connected navigable water body id (1..), 0 elsewhere
  seaSize: number[] = [0];
  regionSize: number[] = [0];
  shoreDist: Uint8Array; // water nodes: steps to the nearest land (capped)
  prospected: Uint8Array; // bit p set once player p's geologists have probed near the node
  oreDirty = true;
  // dirty regions for renderer
  heightDirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  splatDirty = true;
  ownerDirty = true;
  exploredDirty = true;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.N = W * H;
    const N = this.N;
    this.h = new Float32Array(N);
    this.terrain = new Uint8Array(N);
    this.owner = new Int8Array(N).fill(-1);
    this.building = new Int32Array(N);
    this.blocked = new Uint8Array(N);
    this.tree = new Int32Array(N);
    this.stone = new Int32Array(N);
    this.field = new Int32Array(N);
    this.reserve = new Int32Array(N);
    this.ore = new Uint8Array(N);
    this.oreAmt = new Uint8Array(N);
    this.fish = new Uint8Array(N);
    this.wear = new Float32Array(N);
    this.explored = new Uint8Array(N);
    this.region = new Int32Array(N);
    this.sea = new Int32Array(N);
    this.shoreDist = new Uint8Array(N);
    this.prospected = new Uint8Array(N);
  }

  /** Does player p know what ore lies at node i? */
  known(i: number, p: number) {
    return (this.prospected[i] & (1 << p)) !== 0;
  }

  /** Ships need a little depth under the keel. */
  deep(i: number) {
    return this.h[i] < WATER_LEVEL - 0.3;
  }
  /** Deep water that belongs to a sea big enough to sail (not a pond). */
  navigable(i: number) {
    const s = this.sea[i];
    return s > 0 && this.seaSize[s] >= 300;
  }

  /**
   * Label landmasses and water bodies. Land uses 4-connectivity, matching the pathfinder,
   * which never cuts a corner between two water nodes.
   */
  computeRegions() {
    const { W, H, N } = this;
    this.region.fill(0);
    this.sea.fill(0);
    this.regionSize = [0];
    this.seaSize = [0];
    const stack: number[] = [];
    const flood = (seed: number, id: number, out: Int32Array, ok: (i: number) => boolean, diag: boolean) => {
      let n = 0;
      out[seed] = id;
      stack.push(seed);
      while (stack.length) {
        const c = stack.pop()!;
        n++;
        const cx = c % W, cy = (c / W) | 0;
        for (let d = 0; d < (diag ? 8 : 4); d++) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (out[ni] || !ok(ni)) continue;
          if (d >= 4 && (!ok(cy * W + nx) || !ok(ny * W + cx))) continue;
          out[ni] = id;
          stack.push(ni);
        }
      }
      return n;
    };
    for (let i = 0; i < N; i++) {
      if (!this.region[i] && !this.isWater(i)) this.regionSize.push(flood(i, this.regionSize.length, this.region, (j) => !this.isWater(j), false));
      if (!this.sea[i] && this.deep(i)) this.seaSize.push(flood(i, this.seaSize.length, this.sea, (j) => this.deep(j), true));
    }
    // distance from land for water, so ships keep off the beaches
    const q: number[] = [];
    this.shoreDist.fill(255);
    for (let i = 0; i < N; i++) if (!this.isWater(i)) { this.shoreDist[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      const d = this.shoreDist[c];
      if (d >= 12) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (let dd = 0; dd < 4; dd++) {
        const nx = cx + DX8[dd], ny = cy + DY8[dd];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (this.shoreDist[ni] <= d + 1) continue;
        this.shoreDist[ni] = d + 1;
        q.push(ni);
      }
    }
  }

  /** Landmass of a node; a water node borrows the region of an adjacent shore. */
  regionAt(i: number) {
    const r = this.region[i];
    if (r) return r;
    const x = this.nx(i), y = this.ny(i);
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (!this.inBounds(nx, ny)) continue;
      const rr = this.region[ny * this.W + nx];
      if (rr) return rr;
    }
    return 0;
  }

  idx(x: number, y: number) {
    return y * this.W + x;
  }
  nx(i: number) {
    return i % this.W;
  }
  ny(i: number) {
    return (i / this.W) | 0;
  }
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }
  isWater(i: number) {
    return this.h[i] < WATER_LEVEL - 0.02;
  }
  isMountain(i: number) {
    const t = this.terrain[i];
    return t === T_ROCK || t === T_SNOW;
  }
  walkable(i: number) {
    return !this.isWater(i) && this.blocked[i] === 0;
  }

  heightAt(x: number, z: number): number {
    const W = this.W, H = this.H;
    if (x < 0) x = 0;
    if (z < 0) z = 0;
    if (x > W - 1.001) x = W - 1.001;
    if (z > H - 1.001) z = H - 1.001;
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const i = iz * W + ix;
    const h00 = this.h[i], h10 = this.h[i + 1], h01 = this.h[i + W], h11 = this.h[i + W + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  // Ground height or water surface (whichever is higher)
  surfaceAt(x: number, z: number): number {
    return Math.max(this.heightAt(x, z), WATER_LEVEL);
  }

  slopeAt(i: number): number {
    const x = this.nx(i), y = this.ny(i);
    const W = this.W;
    const hl = x > 0 ? this.h[i - 1] : this.h[i];
    const hr = x < W - 1 ? this.h[i + 1] : this.h[i];
    const hu = y > 0 ? this.h[i - W] : this.h[i];
    const hd = y < this.H - 1 ? this.h[i + W] : this.h[i];
    return Math.max(Math.abs(hr - hl), Math.abs(hd - hu)) * 0.5;
  }

  markHeightDirty(x0: number, y0: number, x1: number, y1: number) {
    const d = this.heightDirty;
    if (!d) this.heightDirty = { x0, y0, x1, y1 };
    else {
      d.x0 = Math.min(d.x0, x0);
      d.y0 = Math.min(d.y0, y0);
      d.x1 = Math.max(d.x1, x1);
      d.y1 = Math.max(d.y1, y1);
    }
  }

  dist(a: number, b: number) {
    const dx = this.nx(a) - this.nx(b), dy = this.ny(a) - this.ny(b);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Iterate nodes within a radius of (cx, cy)
  forRadius(cx: number, cy: number, r: number, fn: (i: number, x: number, y: number, d2: number) => void) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) fn(y * this.W + x, x, y, d2);
      }
    }
  }
}
