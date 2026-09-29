// Paths worn by traffic. Settlers 3 had no roads, so the ground remembers where people walk: every
// settler, donkey and catapult outside a building wears the grass along its way, and a way walked
// often enough turns into a dirt track. Render-only: the map is read from positions the game has
// already worked out and never draws on the game's random numbers (the game's own `world.wear`, which
// its path costs and tree planting read, is left alone).
//
// The map has TRAIL_RES texels a node and two channels. `acc` counts passes (a straight walk along a line
// adds about one at its middle) and halves every HALF game seconds, a game day, so a path left alone
// fades over a few days; the texture holds 1 - exp(-acc / A0), and the terrain shader turns that into
// bare earth where it is high and worn grass beside it, so a busier way is also a wider one. `fresh`
// is the last few seconds' footfall along the walkers' true lines: grass pressed flat, prints in snow.
//
// The worn channel follows a smoothed walking point that trails each walker by about LAG: the game
// walks node to node in eight directions, and the lag rounds off the staircase that makes, the way
// people cut corners. Each walker keeps a little to one side of its line (by a hash of its id), so a
// way walked both ways is wider than one walked one way.
import * as THREE from 'three';
import type { Game } from '../game/game';

/** texels a node */
export const TRAIL_RES = 4;
/** a worn path halves in this many game seconds (a game day, sky.ts) */
const HALF = 600;
/** fresh tracks fade with this time constant (s) */
const FRESH = 10;
/** passes that bring a path to 1 - 1/e of full wear. A 25-minute town on the 160 map has half its
 * walked-over ground under 5 passes, a tenth over 45 and its busiest ways at 180-630 (the HQ's square
 * averages 50-115), so only about the busiest tenth goes to bare earth. */
const A0 = 80;
/** spread of a walker's wear across its line (nodes) */
const SIGMA = 0.24;
/** how far the smoothed walking point trails the walker (nodes) */
const LAG = 0.6;
/** how far to one side of its line a walker keeps, at most (nodes) */
const SIDE = 0.22;
/** wear is laid every STEP nodes of the smoothed line */
const STEP = 0.1;
/** each row is decayed and re-encoded once in this many game seconds */
const SWEEP = 1;
/** a walker that moves further than this between two looks was carried or loaded: no track */
const JUMP = 3;
/** while the camera is nearer than this, what changes around the middle of the view goes up at once
 * (pressed grass and prints only show close up; the rest waits for the sweep, at most SWEEP) */
const PROMPT_DIST = 32;

interface Walker {
  /** last seen position */
  x: number; z: number;
  /** smoothed walking point */
  ex: number; ez: number;
  /** distance of smoothed line (and of the true line) not yet laid down */
  carry: number; fcarry: number;
  /** which side of its line it keeps, -1..1 */
  side: number;
  away: boolean;
  seen: number;
}

/** 1 - exp(-x) for x = acc / A0 in [0, LUT_MAX), LUT_N steps a unit */
const LUT_N = 256, LUT_MAX = 8;
const LUT = new Uint8Array(LUT_N * LUT_MAX + 1);
for (let i = 0; i < LUT.length; i++) LUT[i] = Math.round(255 * (1 - Math.exp(-i / LUT_N)));

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** What a save keeps of the map: passes at 1/64 a step, up to 1024. */
export interface TrailSave { res: number; w: number; h: number; acc: Uint16Array }

/** The map itself, with no GPU in it (headless checks drive it directly). */
export class TrailMap {
  readonly W: number;
  readonly H: number;
  readonly acc: Float32Array;
  readonly fresh: Float32Array;
  /** what the texture holds: worn (R) and fresh (G), two bytes a texel */
  readonly bytes: Uint8Array;
  /** the part of each row changed since it was last uploaded ([x0, x1] in texels, x0 > x1 = none) */
  readonly dirty0: Int32Array;
  readonly dirty1: Int32Array;
  /** game time each row was last swept */
  private rowT: Float32Array;
  private sweepAt = 0;
  /** game seconds seen */
  time = 0;
  private walkers = new Map<number, Walker>();
  private look = 0;
  private wx = new Float32Array(5);
  private wz = new Float32Array(5);
  /** rows the last sweep went over, for the upload: [first, count] twice (the sweep wraps) */
  readonly swept = [0, 0, 0, 0];

  constructor(nodesW: number, nodesH: number) {
    this.W = nodesW * TRAIL_RES;
    this.H = nodesH * TRAIL_RES;
    const n = this.W * this.H;
    this.acc = new Float32Array(n);
    this.fresh = new Float32Array(n);
    this.bytes = new Uint8Array(n * 2);
    this.dirty0 = new Int32Array(this.H).fill(this.W);
    this.dirty1 = new Int32Array(this.H).fill(-1);
    this.rowT = new Float32Array(this.H);
  }

  /** Wear worn at world position (x, z), a stamp `len` nodes of line long, and fresh footfall. */
  private stamp(x: number, z: number, len: number, fresh: boolean) {
    const R = TRAIL_RES;
    const tx = (x + 0.5) * R - 0.5, tz = (z + 0.5) * R - 0.5;
    const ix = Math.round(tx), iz = Math.round(tz);
    // fresh prints are narrow (one texel either side), wear is spread by SIGMA
    const s = fresh ? 0.55 : SIGMA * R;
    const k = -1 / (2 * s * s);
    for (let j = 0; j < 5; j++) {
      const dx = ix + j - 2 - tx, dz = iz + j - 2 - tz;
      this.wx[j] = Math.exp(dx * dx * k);
      this.wz[j] = Math.exp(dz * dz * k);
    }
    // a line of stamps adds 1 a pass at its middle: the gaussian's integral across the line
    const amt = fresh ? 1 : len / (SIGMA * Math.sqrt(2 * Math.PI));
    const W = this.W, H = this.H;
    const x0 = Math.max(0, ix - 2), x1 = Math.min(W - 1, ix + 2);
    if (x0 > x1) return;
    for (let j = 0; j < 5; j++) {
      const y = iz + j - 2;
      if (y < 0 || y >= H) continue;
      const wz = this.wz[j];
      if (wz < 0.004) continue;
      const row = y * W;
      for (let i = x0; i <= x1; i++) {
        const t = row + i;
        const wv = wz * this.wx[i - ix + 2];
        if (fresh) {
          if (wv > this.fresh[t]) this.fresh[t] = wv;
        } else this.acc[t] += amt * wv;
        this.encode(t);
      }
      if (x0 < this.dirty0[y]) this.dirty0[y] = x0;
      if (x1 > this.dirty1[y]) this.dirty1[y] = x1;
    }
  }

  private encode(t: number) {
    const a = this.acc[t] * (LUT_N / A0);
    this.bytes[t * 2] = LUT[a < LUT_N * LUT_MAX ? a | 0 : LUT_N * LUT_MAX];
    const f = this.fresh[t];
    this.bytes[t * 2 + 1] = f >= 1 ? 255 : (f * 255) | 0;
  }

  /** Stamps every STEP along the move (mx, mz) of length `len` from (x, z), `side` across it (a
   * factor of the move), so a long move between two looks (a slow frame at speed) still wears a line;
   * returns the distance left over for the next look. */
  private lay(x: number, z: number, mx: number, mz: number, len: number, carry: number, side: number, fresh: boolean): number {
    let at = STEP - carry;
    for (; at <= len; at += STEP) {
      const f = at / len;
      this.stamp(x + mx * f - mz * side, z + mz * f + mx * side, STEP, fresh);
    }
    return len - (at - STEP);
  }

  /** Look at every walker once: `dt` game seconds passed since the last look. */
  observe(g: Game, dt: number) {
    this.time += dt;
    const look = ++this.look;
    for (const s of g.settlers.values()) {
      let k = this.walkers.get(s.id);
      if (!k) {
        k = { x: s.x, z: s.z, ex: s.x, ez: s.z, carry: 0, fcarry: 0, side: hash(s.id) * 2 - 1, away: false, seen: look };
        this.walkers.set(s.id, k);
        continue;
      }
      k.seen = look;
      if (s.inside || s.hidden || s.aboard || s.dead) { k.away = true; continue; }
      const dx = s.x - k.x, dz = s.z - k.z;
      const d = Math.hypot(dx, dz);
      if (k.away || d > JUMP) {
        k.away = false;
        k.x = k.ex = s.x; k.z = k.ez = s.z;
        k.carry = k.fcarry = 0;
        continue;
      }
      // fresh footfall along the true line
      if (d > 1e-5) k.fcarry = this.lay(k.x, k.z, dx, dz, d, k.fcarry, (k.side * SIDE * 0.5) / d, true);
      k.x = s.x; k.z = s.z;
      // the smoothed point follows by the distance walked, and closes up on a walker standing still
      const a = 1 - Math.exp(-(d > 1e-5 ? d : dt * 2) / LAG);
      const mx = (s.x - k.ex) * a, mz = (s.z - k.ez) * a;
      const md = Math.hypot(mx, mz);
      if (md > 1e-5) k.carry = this.lay(k.ex, k.ez, mx, mz, md, k.carry, (k.side * SIDE) / md, false);
      k.ex += mx; k.ez += mz;
    }
    if ((look & 127) === 0) for (const [id, k] of this.walkers) if (k.seen !== look) this.walkers.delete(id);
    this.sweep(dt);
  }

  /** Decay and re-encode the next rows, so every row is gone over once in SWEEP game seconds. */
  sweep(dt: number) {
    const H = this.H, W = this.W;
    const from = Math.floor(this.sweepAt);
    this.sweepAt += (H * dt) / SWEEP;
    let to = Math.floor(this.sweepAt);
    if (to - from > H) to = from + H;
    this.sweepAt %= H;
    const n = to - from;
    const a = from % H;
    this.swept[0] = a; this.swept[1] = Math.min(n, H - a);
    this.swept[2] = 0; this.swept[3] = n - this.swept[1];
    for (let r = from; r < to; r++) {
      const y = r % H;
      const age = this.time - this.rowT[y];
      this.rowT[y] = this.time;
      if (age <= 0) continue;
      const f = Math.pow(0.5, age / HALF), gf = Math.exp(-age / FRESH);
      const row = y * W;
      for (let t = row; t < row + W; t++) {
        const v = this.acc[t];
        const u = this.fresh[t];
        if (v === 0 && u === 0) continue;
        this.acc[t] = v > 0.01 ? v * f : 0;
        this.fresh[t] = u > 0.02 ? u * gf : 0;
        this.encode(t);
      }
      // the whole row goes up with the sweep
      this.dirty0[y] = W;
      this.dirty1[y] = -1;
    }
  }

  /** How worn the ground is (0..1, as the terrain sees it) at world position x, z. */
  wornAt(x: number, z: number): number {
    const tx = Math.round((x + 0.5) * TRAIL_RES - 0.5), tz = Math.round((z + 0.5) * TRAIL_RES - 0.5);
    if (tx < 0 || tz < 0 || tx >= this.W || tz >= this.H) return 0;
    return this.bytes[(tz * this.W + tx) * 2] / 255;
  }

  save(): TrailSave {
    const acc = new Uint16Array(this.acc.length);
    for (let i = 0; i < acc.length; i++) acc[i] = Math.min(65535, Math.round(this.acc[i] * 64));
    return { res: TRAIL_RES, w: this.W, h: this.H, acc };
  }

  /** Take a saved map; without one (a save from before paths, or a new game) start from the game's own wear. */
  load(g: Game, d?: Partial<TrailSave> | null) {
    this.acc.fill(0);
    this.fresh.fill(0);
    this.walkers.clear();
    if (d && d.res === TRAIL_RES && d.w === this.W && d.h === this.H && d.acc instanceof Uint16Array && d.acc.length === this.acc.length) {
      for (let i = 0; i < this.acc.length; i++) this.acc[i] = d.acc[i] / 64;
    } else {
      // the game's wear only remembers the last minutes' footfall at each node (it gains 0.0035 a
      // step onto the node and loses 0.7% a second, so it holds about half the steps a second): at
      // that rate a way gathers about 1700 x wear passes in the time a path takes to fade, enough to
      // start the busiest ways off again rather than from bare grass
      const w = g.world, R = TRAIL_RES;
      for (let ty = 0; ty < this.H; ty++) {
        const z = (ty + 0.5) / R - 0.5;
        const y0 = Math.max(0, Math.min(w.H - 2, Math.floor(z))), fz = Math.max(0, Math.min(1, z - y0));
        for (let tx = 0; tx < this.W; tx++) {
          const x = (tx + 0.5) / R - 0.5;
          const x0 = Math.max(0, Math.min(w.W - 2, Math.floor(x))), fx = Math.max(0, Math.min(1, x - x0));
          const i = y0 * w.W + x0;
          const v = (w.wear[i] * (1 - fx) + w.wear[i + 1] * fx) * (1 - fz) + (w.wear[i + w.W] * (1 - fx) + w.wear[i + w.W + 1] * fx) * fz;
          if (v > 0.01) this.acc[ty * this.W + tx] = Math.min(400, v * 1700);
        }
      }
    }
    for (let t = 0; t < this.acc.length; t++) this.encode(t);
    this.dirty0.fill(this.W);
    this.dirty1.fill(-1);
  }
}

/** The map on the GPU: `tex` (RG8, TRAIL_RES texels a node, the same extent as the terrain's node textures). */
export class Trails {
  readonly map: TrailMap;
  readonly tex: THREE.DataTexture;
  /** texSubImage2D calls and texels sent, for checks */
  uploads = 0;
  texels = 0;

  constructor(private game: Game) {
    const w = game.world;
    this.map = new TrailMap(w.W, w.H);
    this.map.load(game, null);
    this.tex = new THREE.DataTexture(this.map.bytes, this.map.W, this.map.H, THREE.RGFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.generateMipmaps = false;
    this.tex.unpackAlignment = 1;
    this.tex.needsUpdate = true;
  }

  save(): TrailSave {
    return this.map.save();
  }

  load(d: unknown) {
    this.map.load(this.game, d as Partial<TrailSave> | null);
    this.tex.needsUpdate = true;
  }

  /** Look at the walkers and send what changed to the GPU: the rows the sweep went over, and near the
   * camera, the changed part of the rows in view (so grass goes down underfoot and prints show at once). */
  update(renderer: THREE.WebGLRenderer, gameDt: number, cx: number, cz: number, reach: number, dist: number) {
    const m = this.map;
    if (gameDt > 0) m.observe(this.game, Math.min(gameDt, 1));
    const p = renderer.properties.get(this.tex) as { __webglTexture?: WebGLTexture; __version?: number };
    // not on the GPU yet, or a whole upload is waiting: that takes everything
    if (!p.__webglTexture || p.__version !== this.tex.version) return;
    const s = m.swept;
    if (s[1] > 0) this.upload(renderer, p.__webglTexture, 0, s[0], m.W, s[1]);
    if (s[3] > 0) this.upload(renderer, p.__webglTexture, 0, s[2], m.W, s[3]);
    s[1] = s[3] = 0;
    if (dist > PROMPT_DIST) return;
    const R = TRAIL_RES;
    reach = Math.min(reach, dist * 1.3);
    const y0 = Math.max(0, Math.floor((cz - reach + 0.5) * R)), y1 = Math.min(m.H - 1, Math.ceil((cz + reach + 0.5) * R));
    const vx0 = Math.max(0, Math.floor((cx - reach + 0.5) * R)), vx1 = Math.min(m.W - 1, Math.ceil((cx + reach + 0.5) * R));
    let bx0 = m.W, bx1 = -1, by0 = -1, by1 = -1;
    for (let y = y0; y <= y1; y++) {
      const a = Math.max(vx0, m.dirty0[y]), b = Math.min(vx1, m.dirty1[y]);
      if (a > b) continue;
      if (by0 < 0) by0 = y;
      by1 = y;
      if (a < bx0) bx0 = a;
      if (b > bx1) bx1 = b;
      // what is left of the row outside the view waits for the sweep
      if (a <= m.dirty0[y] && b >= m.dirty1[y]) { m.dirty0[y] = m.W; m.dirty1[y] = -1; }
    }
    if (by0 >= 0) this.upload(renderer, p.__webglTexture, bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1);
  }

  /** One sub-rectangle of the map to the GPU in a single call, through three's state cache. */
  private upload(renderer: THREE.WebGLRenderer, handle: WebGLTexture, x: number, y: number, w: number, h: number) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const st = renderer.state;
    st.bindTexture(gl.TEXTURE_2D, handle);
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    st.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    st.pixelStorei(gl.UNPACK_ROW_LENGTH, this.map.W);
    st.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
    st.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
    st.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RG, gl.UNSIGNED_BYTE, this.map.bytes);
    st.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    st.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    st.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    this.uploads++;
    this.texels += w * h;
  }
}
