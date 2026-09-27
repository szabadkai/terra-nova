// Procedural map generation: island continent with hills, mountains, lakes,
// forests, rock outcrops, ore veins and fish.
import { Simplex } from '../core/noise';
import { RNG, clamp, smoothstep } from '../core/rng';
import {
  ORE_COAL, ORE_GOLD, ORE_IRON, ORE_STONE,
  T_DIRT, T_FOREST, T_GRASS, T_MEADOW, T_ROCK, T_SAND, T_SNOW, T_SWAMP,
} from './defs';
import { DX8, DY8, WATER_LEVEL, World } from './world';

export interface MapGenResult {
  starts: { x: number; y: number }[];
  trees: { node: number; species: number; growth: number }[];
  stones: { node: number; amount: number }[];
  deer: { node: number; herd: number }[];
}

export interface MapOptions {
  size: number;
  seed: number;
  players: number;
}

export function generateMap(world: World, opt: MapOptions): MapGenResult {
  const { W, H } = world;
  const S = W;
  const rng = new RNG(opt.seed);
  const nBase = new Simplex(opt.seed * 7 + 1);
  const nMount = new Simplex(opt.seed * 7 + 2);
  const nMoist = new Simplex(opt.seed * 7 + 3);
  const nDetail = new Simplex(opt.seed * 7 + 4);
  const nOre = new Simplex(opt.seed * 7 + 5);
  const nLake = new Simplex(opt.seed * 7 + 6);

  // ---- start positions around a circle
  const starts: { x: number; y: number }[] = [];
  const baseAng = rng.range(0, Math.PI * 2);
  const R = S * (opt.players > 2 ? 0.3 : 0.31);
  for (let p = 0; p < opt.players; p++) {
    const a = baseAng + (p / opt.players) * Math.PI * 2 + rng.range(-0.15, 0.15);
    starts.push({
      x: Math.round(S / 2 + Math.cos(a) * R),
      y: Math.round(S / 2 + Math.sin(a) * R * 0.92),
    });
  }

  // Resource "anchors" near each start so every player has a fair economy
  interface Blob { x: number; y: number; r: number; }
  const mountains: Blob[] = [];
  const forests: Blob[] = [];
  const rocks: Blob[] = [];
  const lakes: Blob[] = [];
  for (const s of starts) {
    const toCenter = Math.atan2(S / 2 - s.y, S / 2 - s.x);
    const aM = toCenter + Math.PI + rng.range(-1.2, 1.2); // mountain behind player (towards edge-ish)
    mountains.push({ x: s.x + Math.cos(aM) * 22, y: s.y + Math.sin(aM) * 22, r: 8.5 });
    const aF = aM + rng.range(1.4, 2.0);
    forests.push({ x: s.x + Math.cos(aF) * 13, y: s.y + Math.sin(aF) * 13, r: 6.5 });
    const aF2 = aM - rng.range(1.4, 2.2);
    forests.push({ x: s.x + Math.cos(aF2) * 17, y: s.y + Math.sin(aF2) * 17, r: 5.5 });
    const aR = aF + rng.range(1.0, 1.6);
    rocks.push({ x: s.x + Math.cos(aR) * 11, y: s.y + Math.sin(aR) * 11, r: 2.6 });
    const aL = aF2 - rng.range(0.9, 1.4);
    lakes.push({ x: s.x + Math.cos(aL) * 19, y: s.y + Math.sin(aL) * 19, r: 5.5 });
  }

  const blobF = (b: Blob, x: number, y: number, jitter: Simplex) => {
    const dx = x - b.x, dy = y - b.y;
    const d = Math.sqrt(dx * dx + dy * dy) / b.r;
    const n = jitter.noise(x * 0.15, y * 0.15) * 0.3;
    return 1 - smoothstep(0.55, 1.0, d + n);
  };

  const startInfluence = (x: number, y: number, r0: number, r1: number) => {
    let m = 0;
    for (const s of starts) {
      const d = Math.hypot(x - s.x, y - s.y);
      m = Math.max(m, 1 - smoothstep(r0, r1, d));
    }
    return m;
  };

  const mountainness = new Float32Array(world.N);
  const moist = new Float32Array(world.N);

  // ---- height field
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / S, v = y / S;
      const dx = u - 0.5, dy = v - 0.5;
      let d = Math.sqrt(dx * dx + dy * dy) * 2;
      d += nBase.fbm(u * 3, v * 3, 4) * 0.22;
      const mask = 1 - smoothstep(0.7, 0.98, d);
      const e = 0.5 + 0.5 * nBase.fbm(u * 4.5 + 10, v * 4.5 + 10, 5);
      let c = mask * (0.55 + 0.45 * e) - 0.32;

      // lakes
      const lk = nLake.fbm(u * 5, v * 5, 3);
      const lakeCarve = smoothstep(0.32, 0.55, lk) * 0.55;
      c -= lakeCarve * (1 - startInfluence(x, y, 10, 18));
      for (const L of lakes) c -= blobF(L, x, y, nDetail) * 0.6;

      let h: number;
      if (c > 0) h = WATER_LEVEL + 0.05 + c * 4.5;
      else h = WATER_LEVEL + c * 9;

      // rolling hills
      h += nDetail.fbm(u * 14, v * 14, 3) * 0.55 * mask;

      // mountains
      const mm = smoothstep(0.18, 0.42, nMount.fbm(u * 2.6 + 3.3, v * 2.6 + 7.1, 3));
      let mt = mm * (1 - startInfluence(x, y, 13, 24));
      for (const M of mountains) mt = Math.max(mt, blobF(M, x, y, nMount));
      mt *= mask;
      const ridge = nMount.ridged(u * 7, v * 7, 5);
      const mh = mt * (1.5 + ridge * 7.5 + nDetail.noise(u * 20, v * 20) * 0.6);
      h += mh;
      mountainness[i] = mt * (0.4 + ridge);

      // flatten around starts
      const fl = startInfluence(x, y, 9, 15);
      h = h * (1 - fl) + (WATER_LEVEL + 1.3 + nDetail.noise(u * 20, v * 20) * 0.15) * fl;

      world.h[i] = h;
      moist[i] = nMoist.fbm(u * 6, v * 6, 4);
    }
  }

  // Ensure land connectivity between starts: carve land bridges if needed
  ensureConnectivity(world, starts);

  // ---- slight smoothing pass to remove single-node spikes
  const tmp = new Float32Array(world.h);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let s = 0;
      for (let d = 0; d < 8; d++) s += world.h[i + DX8[d] + DY8[d] * W];
      tmp[i] = world.h[i] * 0.5 + (s / 8) * 0.5;
    }
  }
  world.h.set(tmp);

  // ---- terrain materials
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = world.h[i];
      const hh = h - WATER_LEVEL;
      const slope = world.slopeAt(i);
      const m = moist[i];
      const mnt = mountainness[i];
      let t = T_GRASS;
      if (hh < -0.02) t = hh < -1.2 ? T_SAND : T_SAND;
      else if (hh < 0.3) t = m > 0.35 && slope < 0.15 && startInfluence(x, y, 12, 16) < 0.5 ? T_SWAMP : T_SAND;
      else if (mnt > 0.55 || slope > 0.85) t = hh > 8.2 + nDetail.noise(x * 0.1, y * 0.1) * 0.8 ? T_SNOW : T_ROCK;
      else if (mnt > 0.35 && slope > 0.4) t = T_ROCK;
      else if (m > 0.22) t = T_FOREST;
      else if (m < -0.28) t = T_MEADOW;
      else t = T_GRASS;
      // desert patches in dry lowlands far from starts
      const dry = nMoist.fbm(x / S * 2.2 + 40, y / S * 2.2 + 40, 3);
      if (t !== T_ROCK && t !== T_SNOW && hh > 0 && dry > 0.42 && startInfluence(x, y, 22, 32) < 0.1) t = T_SAND;
      for (const F of forests) if (blobF(F, x, y, nMoist) > 0.3 && hh > 0.3 && t !== T_ROCK) t = T_FOREST;
      world.terrain[i] = t;
    }
  }

  // ---- ores in mountains
  for (let i = 0; i < world.N; i++) {
    const t = world.terrain[i];
    if (t !== T_ROCK && t !== T_SNOW) continue;
    const x = world.nx(i), y = world.ny(i);
    const u = x / S, v = y / S;
    const coal = nOre.noise(u * 18, v * 18) + 0.15;
    const iron = nOre.noise(u * 18 + 50, v * 18 + 50);
    const gold = nOre.noise(u * 22 + 90, v * 22 + 90) - 0.25;
    const stone = nOre.noise(u * 16 + 130, v * 16 + 130) - 0.05;
    let best = 0, bv = 0.12;
    if (coal > bv) { bv = coal; best = ORE_COAL; }
    if (iron > bv) { bv = iron; best = ORE_IRON; }
    if (gold > bv) { bv = gold; best = ORE_GOLD; }
    if (stone > bv) { bv = stone; best = ORE_STONE; }
    if (best) {
      world.ore[i] = best;
      world.oreAmt[i] = clamp(Math.round(4 + (bv - 0.12) * 40 + rng.range(0, 4)), 2, 22);
    }
  }
  // guaranteed deposits on each start mountain
  for (const M of mountains) {
    const kinds = [ORE_COAL, ORE_IRON, ORE_COAL, ORE_GOLD, ORE_STONE];
    for (let k = 0; k < kinds.length; k++) {
      const a = (k / kinds.length) * Math.PI * 2 + rng.range(0, 0.6);
      const cx = M.x + Math.cos(a) * M.r * 0.45, cy = M.y + Math.sin(a) * M.r * 0.45;
      world.forRadius(cx, cy, 3.2, (i) => {
        if (world.terrain[i] === T_ROCK || world.terrain[i] === T_SNOW) {
          world.ore[i] = kinds[k];
          world.oreAmt[i] = rng.int(10, 20);
        }
      });
    }
  }

  // ---- fish
  for (let i = 0; i < world.N; i++) {
    const hh = world.h[i] - WATER_LEVEL;
    if (hh < -0.2 && hh > -4.5) world.fish[i] = rng.chance(0.6) ? rng.int(2, 8) : 0;
  }

  // ---- trees
  const trees: MapGenResult['trees'] = [];
  const stones: MapGenResult['stones'] = [];
  const occupied = new Uint8Array(world.N);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      const t = world.terrain[i];
      const hh = world.h[i] - WATER_LEVEL;
      if (hh < 0.15) continue;
      const nearStart = startInfluence(x, y, 6.5, 8.5);
      if (nearStart > 0.01) continue;
      let p = 0;
      if (t === T_FOREST) p = 0.36 + moist[i] * 0.35;
      else if (t === T_GRASS) p = 0.035;
      else if (t === T_MEADOW) p = 0.012;
      else if (t === T_SAND) p = hh < 1.0 ? 0.03 : 0.006;
      else if (t === T_SWAMP) p = 0.05;
      else if (t === T_ROCK) p = world.slopeAt(i) < 0.6 && hh < 6 ? 0.03 : 0;
      for (const F of forests) if (blobF(F, x, y, nMoist) > 0.2) p = Math.max(p, 0.5);
      if (!rng.chance(p)) continue;
      let species: number;
      if (t === T_SAND) species = 3; // palm
      else if (t === T_ROCK || hh > 3.4) species = 1; // pine
      else if (t === T_MEADOW && rng.chance(0.4)) species = 4; // fruit tree
      else {
        const r = rng.next();
        species = r < 0.48 ? 0 : r < 0.75 ? 1 : 2;
      }
      trees.push({ node: i, species, growth: rng.chance(0.12) ? rng.range(0.3, 0.9) : 1 });
      occupied[i] = 1;
    }
  }

  // ---- stones (rock outcrops)
  const nStone = new Simplex(opt.seed * 7 + 9);
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const i = y * W + x;
      if (occupied[i]) continue;
      const hh = world.h[i] - WATER_LEVEL;
      if (hh < 0.3) continue;
      if (startInfluence(x, y, 6.5, 8.5) > 0.01) continue;
      const t = world.terrain[i];
      let p = 0;
      const sn = nStone.noise(x * 0.09, y * 0.09);
      if (sn > 0.66 && t !== T_SWAMP) p = 0.24;
      if ((t === T_ROCK) && world.slopeAt(i) < 0.7 && sn > 0.3) p = Math.max(p, 0.05);
      for (const Rk of rocks) if (Math.hypot(x - Rk.x, y - Rk.y) < Rk.r) p = 0.55;
      if (!rng.chance(p)) continue;
      stones.push({ node: i, amount: rng.int(6, 11) });
      occupied[i] = 1;
    }
  }

  // ---- deer herds
  const deer: MapGenResult['deer'] = [];
  const herds = Math.round((S * S) / 2600);
  let herdId = 1;
  for (let k = 0; k < herds * 4 && deer.length < herds * 4; k++) {
    const x = rng.int(8, W - 8), y = rng.int(8, H - 8);
    const i = y * W + x;
    const t = world.terrain[i];
    if (world.isWater(i) || (t !== T_GRASS && t !== T_FOREST && t !== T_MEADOW)) continue;
    if (startInfluence(x, y, 14, 18) > 0) continue;
    const n = rng.int(2, 5);
    for (let j = 0; j < n; j++) {
      const xx = x + rng.int(-2, 3), yy = y + rng.int(-2, 3);
      if (!world.inBounds(xx, yy)) continue;
      const ii = yy * W + xx;
      if (world.isWater(ii) || occupied[ii]) continue;
      deer.push({ node: ii, herd: herdId });
    }
    herdId++;
  }

  // yard around each start HQ is bare earth
  for (const s of starts) {
    world.forRadius(s.x + 0.5, s.y + 0.5, 3.2, (i) => {
      world.terrain[i] = T_DIRT;
    });
  }

  return { starts, trees, stones, deer };
}

function ensureConnectivity(world: World, starts: { x: number; y: number }[]) {
  const { W, H } = world;
  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = new Uint8Array(world.N);
    const q: number[] = [];
    const s0 = world.idx(starts[0].x, starts[0].y);
    q.push(s0);
    seen[s0] = 1;
    while (q.length) {
      const c = q.pop()!;
      const cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (seen[ni] || world.h[ni] < WATER_LEVEL + 0.1) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    let ok = true;
    for (let p = 1; p < starts.length; p++) {
      if (!seen[world.idx(starts[p].x, starts[p].y)]) {
        ok = false;
        // raise a land bridge between start 0 and p
        const a = starts[0], b = starts[p];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = a.x + (b.x - a.x) * t + Math.sin(t * Math.PI * 2) * 6;
          const y = a.y + (b.y - a.y) * t + Math.cos(t * Math.PI * 3) * 4;
          world.forRadius(x, y, 3.5, (i, _x, _y, d2) => {
            const target = WATER_LEVEL + 0.6 - d2 * 0.02;
            if (world.h[i] < target) world.h[i] = target;
          });
        }
      }
    }
    if (ok) return;
  }
}
