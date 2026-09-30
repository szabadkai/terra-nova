// The province of Terra Nova as an old chart: a coast with its depth lines, the twelve regions as
// territories washed in their holder's colour, their borders, rivers, and each region's own ground
// drawn as a mapmaker would (the pass through its wall, the valley between two ridges, the cliffs of
// the gold plateau, the tribes' hills, the forest, the estuary, the islands), the sea with a compass
// rose and its rhumb lines. Made once from a fixed seed on a 4 px lattice (marching squares for the
// coast and the territories, the cells' edges for the borders) and kept: the page only recolours it.
// Interface code: Math.* is fine here, nothing of it reaches the game.
import { Simplex } from '../core/noise';
import { REGION_IDS, REGION_INFO, type RegionId } from '../game/province';

export const MAP_W = 1000, MAP_H = 620;
const C = 4;                          // lattice step
const NX = MAP_W / C + 1, NY = Math.ceil(MAP_H / C) + 1;   // corner samples
const CX = NX - 1, CY = NY - 1;       // cells

type P = [number, number];

// ------------------------------------------------------------------ the land, as designed
/** The coast before the noise: clockwise from the north-west. */
const COAST: P[] = [
  // the north-west cape (Silva), the north coast (Collis), the deep bay under Metalla, the north-east promontory
  [118, 150], [96, 118], [104, 84], [140, 70], [176, 58], [214, 64], [244, 44], [292, 38], [340, 50], [372, 34],
  [420, 30], [462, 42], [488, 64], [506, 98], [532, 72], [552, 42], [600, 32], [650, 44], [700, 34], [748, 42],
  [790, 62], [836, 50], [872, 26], [906, 16], [930, 40], [920, 76], [944, 112], [962, 168], [950, 220], [972, 270],
  // Nova Ostia's bay, the Ara peninsula, the southern gulf, the pirate coast, the estuary, the western bay
  [978, 318], [958, 344], [930, 352], [924, 372], [946, 390], [978, 406], [968, 452], [934, 490], [896, 510], [852, 520],
  [818, 548], [792, 588], [760, 596], [740, 566], [720, 530], [694, 498], [668, 474], [642, 458], [622, 470], [612, 500],
  [594, 532], [570, 552], [540, 560], [500, 572], [456, 576], [408, 568], [360, 574], [318, 560], [286, 574], [228, 574], [198, 556],
  [176, 530], [166, 500], [138, 486], [150, 446], [172, 430], [150, 408], [128, 396], [118, 360], [132, 330], [112, 296],
  [122, 256], [104, 222], [116, 188],
];
/** Islands: the archipelago of Insulae, the pirates' isle off Litus, and a few rocks. */
const ISLES: [number, number, number][] = [
  [70, 470, 22], [114, 528, 27], [50, 552, 16], [160, 586, 14], [92, 596, 11], [32, 500, 8], [140, 470, 6], [22, 590, 7],
  [518, 604, 13],
  [984, 470, 7], [70, 140, 6], [990, 250, 5], [640, 596, 5],
];
const PIRATE_ISLE = 8;
/** The estuary: a channel from the sea up into Aestuarium, wide at its mouth. */
const ESTUARY: P[] = [[256, 612], [253, 574], [243, 538], [251, 508], [246, 484]];
/** Lakes: the valley's, the forest's spring. */
const LAKES: [number, number, number, number][] = [[556, 342, 15, 8], [322, 204, 8, 6]];

// ------------------------------------------------------------------ what the regions hold
/** Ranges as a mapmaker would ink them: a line of peaks (size 1 = big), with gaps where roads go through. */
const RANGES: { path: P[]; size: number; rows?: number }[] = [
  // Saltus: the wall, north and south of the pass
  { path: [[428, 118], [420, 186], [426, 262]], size: 1.1, rows: 2 },
  { path: [[422, 338], [428, 404], [418, 474]], size: 1.1, rows: 2 },
  // Vallis: the two walls of the valley
  { path: [[476, 286], [540, 272], [604, 280], [660, 294]], size: 0.9, rows: 2 },
  { path: [[478, 392], [540, 402], [604, 396], [660, 384]], size: 0.9, rows: 2 },
  // the wall before Nova Ostia, with its two passes
  { path: [[842, 120], [848, 196], [838, 262]], size: 1, rows: 2 },
  { path: [[842, 318], [836, 368]], size: 1 },
  { path: [[834, 420], [842, 470], [836, 506]], size: 1 },
  // the north coast's highlands behind Collis and Metalla, the south-west's behind Castra
  { path: [[330, 64], [372, 56]], size: 0.8 },
  { path: [[690, 70], [740, 78], [786, 92]], size: 0.85 },
  { path: [[180, 380], [196, 404]], size: 0.7 },
];
/** Metalla's table mountain: cliffs all round, gold on top, one path up from the south-west. */
const PLATEAU = { x: 600, y: 150, rx: 66, ry: 38 };
/** Hills: the tribes' three forts, Ara's sacred hill, Castellum's. */
const HILLS: [number, number, number][] = [[378, 96, 1.2], [442, 72, 1.3], [494, 110, 1.2], [700, 452, 1.5], [770, 282, 1.4]];
/** Rivers, from their springs to the sea. */
const RIVERS: P[][] = [
  [[392, 122], [352, 150], [318, 196], [270, 214], [214, 236], [168, 244], [118, 250], [96, 252]],
  [[404, 316], [352, 336], [300, 344], [246, 366], [196, 388], [150, 404], [118, 404]],
  [[598, 196], [586, 252], [572, 300], [558, 340], [566, 372], [582, 410], [608, 440], [628, 458], [638, 474]],
  [[848, 290], [880, 318], [906, 346], [930, 366]],
  [[742, 400], [760, 450], [784, 500], [808, 540], [830, 562]],
];

// ------------------------------------------------------------------ helpers
function catmull(pts: P[], closed: boolean, per = 8): P[] {
  const out: P[] = [], n = pts.length;
  const at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
/** Distance from a point to a polyline, and how far along it (0..1) the nearest point is. */
function toLine(pts: P[], x: number, y: number): { d: number; t: number } {
  let best = Infinity, bt = 0, total = 0;
  const lens: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  let run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(x - ax - dx * u, y - ay - dy * u);
    if (d < best) { best = d; bt = (run + lens[i] * u) / (total || 1); }
    run += lens[i];
  }
  return { d: best, t: bt };
}
function inside(poly: P[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Corner-cutting: a staircase or a polyline rounded off (open lines keep their ends). */
function chaikin(pts: P[], closed: boolean, iter = 2): P[] {
  let p = pts;
  for (let k = 0; k < iter; k++) {
    const out: P[] = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
/** Douglas-Peucker: the points a line needs to stay within `tol` of itself. */
function simplify(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l; if (d > fd) { fd = d; far = i; } }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function pathOf(lines: P[][], closed: boolean): string {
  return lines.map((l) => `M${l.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L')}${closed ? 'Z' : ''}`).join('');
}

/** Marching squares on a lattice of values (w × h, spaced `step`, from `ox`,`oy`): the closed loops where v = level. */
function contours(v: Float32Array, w: number, h: number, level: number, step: number, ox = 0, oy = 0): P[][] {
  // an edge's point: horizontal edges (i,j)-(i+1,j) get id 2*(j*w+i), vertical (i,j)-(i,j+1) id 2*(j*w+i)+1
  const pt = new Map<number, P>();
  const next = new Map<number, number>();
  const at = (i: number, j: number) => v[j * w + i];
  const edgePt = (id: number): P => {
    let p = pt.get(id);
    if (p) return p;
    const k = id >> 1, i = k % w, j = (k / w) | 0;
    const a = at(i, j), b = id & 1 ? at(i, j + 1) : at(i + 1, j);
    const t = Math.max(0, Math.min(1, (level - a) / (b - a || 1e-9)));
    p = id & 1 ? [ox + i * step, oy + (j + t) * step] : [ox + (i + t) * step, oy + j * step];
    pt.set(id, p);
    return p;
  };
  const link = (a: number, b: number) => { next.set(a, b); edgePt(a); edgePt(b); };
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const tl = at(i, j) > level ? 1 : 0, tr = at(i + 1, j) > level ? 1 : 0, br = at(i + 1, j + 1) > level ? 1 : 0, bl = at(i, j + 1) > level ? 1 : 0;
    const c = tl * 8 + tr * 4 + br * 2 + bl;
    if (c === 0 || c === 15) continue;
    const T = 2 * (j * w + i), B = 2 * ((j + 1) * w + i), L = 2 * (j * w + i) + 1, R = 2 * (j * w + i + 1) + 1;
    // the inside kept on the left of each segment's direction, so loops chain one way round
    switch (c) {
      case 1: link(L, B); break;
      case 2: link(B, R); break;
      case 3: link(L, R); break;
      case 4: link(R, T); break;
      case 5: link(L, T); link(R, B); break;
      case 6: link(B, T); break;
      case 7: link(L, T); break;
      case 8: link(T, L); break;
      case 9: link(T, B); break;
      case 10: link(T, R); link(B, L); break;
      case 11: link(T, R); break;
      case 12: link(R, L); break;
      case 13: link(R, B); break;
      case 14: link(B, L); break;
    }
  }
  const loops: P[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: P[] = [];
    let e: number | undefined = start;
    while (e !== undefined && !used.has(e)) { used.add(e); loop.push(pt.get(e)!); e = next.get(e); }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

// ------------------------------------------------------------------ the geography, made once
export interface Geography {
  land: string;
  ripples: string[];
  lakes: string;
  regions: Record<RegionId, string>;
  borders: string;
  rivers: string[];
  features: string;
  /** where each region's name goes */
  labels: Record<RegionId, P>;
}

let made: Geography | null = null;

/** A chart made elsewhere (the worker the title screen starts, ui/provinceWarm.ts), if none is made here yet. */
export function adoptGeography(g: Geography) { made ??= g; }
export const geographyMade = () => !!made;

export function geography(): Geography {
  if (made) return made;
  const nz = new Simplex(4127), wx = new Simplex(911), wy = new Simplex(3301), fz = new Simplex(77), hz = new Simplex(1553);
  const coast = catmull(COAST, true, 6);
  const estuary = catmull(ESTUARY, false, 6);

  // the land field at the lattice's corners: > 0 on land (the distance to the coast only matters within 70)
  const L = new Float32Array(NX * NY);
  // (each coast segment filed in the 20-pace bins within 70 of it, so a point looks only at its bin's)
  const BIN = 20, BW = Math.ceil(MAP_W / BIN) + 1, BH = Math.ceil(MAP_H / BIN) + 1;
  const bins: number[][] = Array.from({ length: BW * BH }, () => []);
  coast.forEach((a, k) => {
    const b = coast[(k + 1) % coast.length];
    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - 70) / BIN)), x1 = Math.min(BW - 1, Math.floor((Math.max(a[0], b[0]) + 70) / BIN));
    const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - 70) / BIN)), y1 = Math.min(BH - 1, Math.floor((Math.max(a[1], b[1]) + 70) / BIN));
    for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) bins[by * BW + bx].push(k);
  });
  const eBox = [Math.min(...estuary.map((p) => p[0])) - 24, Math.max(...estuary.map((p) => p[0])) + 24, Math.min(...estuary.map((p) => p[1])) - 24, Math.max(...estuary.map((p) => p[1])) + 24];
  let crossings: number[] = [], row = -1;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = i * C, y = j * C;
    // (inside the coast: from where this row crosses it, worked out once a row)
    if (row !== j) {
      row = j;
      crossings = [];
      for (let k = 0; k < coast.length; k++) {
        const [xi, yi] = coast[k], [xj, yj] = coast[(k + 1) % coast.length];
        if ((yi > y) !== (yj > y)) crossings.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    let dm = 70;
    for (const k of bins[Math.min(BH - 1, Math.floor(y / BIN)) * BW + Math.min(BW - 1, Math.floor(x / BIN))]) {
      const a = coast[k], b = coast[(k + 1) % coast.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      dm = Math.min(dm, Math.hypot(x - a[0] - dx * u, y - a[1] - dy * u));
    }
    let v = crossings.reduce((n, cx) => n + (x < cx ? 1 : 0), 0) % 2 ? dm : -dm;
    // (the designed shape holds at the large scale; the noise makes it ragged, not different)
    v += nz.fbm(x * 0.011, y * 0.011, 2) * 8 + nz.fbm(x * 0.032 + 40, y * 0.032, 3) * 7 + nz.fbm(x * 0.09 + 7, y * 0.09, 2) * 2.5;
    for (const [ix, iy, r] of ISLES) { const d = Math.hypot(x - ix, y - iy); if (d < r * 1.9 + 4) v = Math.max(v, r - d + nz.fbm(x * 0.045 + ix, y * 0.045, 4) * r * 0.75); }
    if (x > eBox[0] && x < eBox[1] && y > eBox[2] && y < eBox[3]) {
      const e = toLine(estuary, x, y);
      v = Math.min(v, e.d - (3.5 + 13 * (1 - e.t) ** 1.4) + nz.noise(x * 0.08, y * 0.08) * 1.8);
    }
    for (const [lx, ly, rx, ry] of LAKES) v = Math.min(v, (Math.hypot((x - lx) / rx, (y - ly) / ry) - 1) * Math.min(rx, ry) + nz.noise(x * 0.1, y * 0.1) * 1.2);
    // a margin of sea round the sheet
    v = Math.min(v, x - 8, MAP_W - 8 - x, y - 8, MAP_H - 8 - y);
    L[j * NX + i] = v;
  }
  const landAt = (x: number, y: number) => {
    const fx = Math.max(0, Math.min(NX - 1.001, x / C)), fy = Math.max(0, Math.min(NY - 1.001, y / C));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, t = fy - j;
    const a = L[j * NX + i], b = L[j * NX + i + 1], c = L[(j + 1) * NX + i], d = L[(j + 1) * NX + i + 1];
    return a * (1 - u) * (1 - t) + b * u * (1 - t) + c * (1 - u) * t + d * u * t;
  };
  const landLoops = contours(L, NX, NY, 0, C).map((l) => simplify(l, 0.25));
  const ripples = [-5, -12, -21].map((lv) => pathOf(contours(L, NX, NY, lv, C).filter((l) => l.length > 14).map((l) => simplify(l, 0.4)), true));

  // the cells: land or sea (at their centres), the landmasses, and who each belongs to
  const cellLand = new Uint8Array(CX * CY);
  for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) cellLand[j * CX + i] = landAt(i * C + C / 2, j * C + C / 2) > 0 ? 1 : 0;
  const mass = new Int32Array(CX * CY).fill(-1);
  const massSize: number[] = [];
  for (let s = 0; s < CX * CY; s++) {
    if (!cellLand[s] || mass[s] >= 0) continue;
    const id = massSize.length, q = [s];
    mass[s] = id;
    let n = 0;
    while (q.length) {
      const c = q.pop()!; n++;
      const i = c % CX, j = (c / CX) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= CX || b >= CY) continue;
        const k = b * CX + a;
        if (cellLand[k] && mass[k] < 0) { mass[k] = id; q.push(k); }
      }
    }
    massSize.push(n);
  }
  const main = massSize.indexOf(Math.max(...massSize));
  const WEIGHT: Partial<Record<RegionId, number>> = { silva: 1.12, collis: 1.08, novaostia: 1.12, castra: 1.04, vallis: 1.05, ara: 1.05, saltus: 0.94, aestuarium: 0.92, litus: 0.98 };
  const mainland = REGION_IDS.filter((r) => r !== 'insulae');
  const rid = new Int8Array(CX * CY);
  for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
    const x = i * C + C / 2, y = j * C + C / 2, k = j * CX + i;
    const qx = x + wx.fbm(x * 0.006, y * 0.006, 3) * 48, qy = y + wy.fbm(x * 0.006, y * 0.006, 3) * 48;
    if (cellLand[k] && mass[k] !== main) {
      // an island: the pirates' own off Litus, the rest the archipelago's (the rocks by the far coasts their neighbours')
      const [px, py, pr] = ISLES[PIRATE_ISLE];
      const far = Math.hypot(x - 95, y - 530) > 140;
      rid[k] = Math.hypot(x - px, y - py) < pr + 12 ? REGION_IDS.indexOf('litus') : !far ? REGION_IDS.indexOf('insulae') : -1;
      if (rid[k] >= 0) continue;
    }
    let best = 0, bd = Infinity;
    for (const r of mainland) {
      const [sx, sy] = REGION_INFO[r].at;
      const d = Math.hypot(qx - sx, qy - sy) / (WEIGHT[r] ?? 1);
      if (d < bd) { bd = d; best = REGION_IDS.indexOf(r); }
    }
    rid[k] = best;
  }
  // each region one piece on the mainland: the cells of it not joined to its seat go to their neighbours
  for (const r of mainland) {
    const ri = REGION_IDS.indexOf(r), [sx, sy] = REGION_INFO[r].at;
    const seed = Math.floor(sy / C) * CX + Math.floor(sx / C);
    const keep = new Uint8Array(CX * CY), q = [seed];
    keep[seed] = 1;
    while (q.length) {
      const c = q.pop()!, i = c % CX, j = (c / CX) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj, k = b * CX + a;
        if (a < 0 || b < 0 || a >= CX || b >= CY || keep[k] || rid[k] !== ri || (cellLand[k] && mass[k] !== main)) continue;
        keep[k] = 1; q.push(k);
      }
    }
    for (let k = 0; k < CX * CY; k++) if (rid[k] === ri && !keep[k] && (!cellLand[k] || mass[k] === main)) rid[k] = -2;
  }
  for (let pass = 0; pass < 60; pass++) {
    let left = 0;
    for (let k = 0; k < CX * CY; k++) {
      if (rid[k] !== -2) continue;
      const i = k % CX, j = (k / CX) | 0, votes = new Map<number, number>();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= CX || b >= CY) continue; const v = rid[b * CX + a]; if (v >= 0) votes.set(v, (votes.get(v) ?? 0) + 1); }
      if (votes.size) rid[k] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]; else left++;
    }
    if (!left) break;
  }

  // the territories: each region's cells (blurred a little, so the washes round off) as loops, clipped to the land by the page
  const regions = {} as Record<RegionId, string>;
  const labels = {} as Record<RegionId, P>;
  REGION_IDS.forEach((r, ri) => {
    const ind = new Float32Array((CX + 2) * (CY + 2));
    let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
      const k = j * CX + i;
      let v = rid[k] === ri ? 1 : 0;
      // (the islands' territory reaches a little into the sea round them, for the land's clip to cut)
      if (!v && (r === 'insulae' || r === 'litus') && !cellLand[k]) {
        for (let dj = -3; dj <= 3 && !v; dj++) for (let di = -3; di <= 3 && !v; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < CX && b < CY && cellLand[b * CX + a] && mass[b * CX + a] !== main && rid[b * CX + a] === ri) v = 1;
        }
      }
      ind[(j + 1) * (CX + 2) + i + 1] = v;
      if (v && cellLand[k]) { sx += i; sy += j; n++; }
    }
    const blur = new Float32Array(ind.length);
    for (let j = 1; j <= CY; j++) for (let i = 1; i <= CX; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += ind[(j + dj) * (CX + 2) + i + di];
      blur[j * (CX + 2) + i] = s / 9;
    }
    regions[r] = pathOf(contours(blur, CX + 2, CY + 2, 0.5, C, -C / 2, -C / 2).map((l) => simplify(chaikin(l, true, 1), 0.3)), true);
    labels[r] = n ? [sx / n * C + C / 2, sy / n * C + C / 2] : REGION_INFO[r].at;
  });

  // the borders: the cells' edges where two regions meet on land, chained and rounded off
  const segs: [number, number][] = [];   // lattice corner keys
  const key = (i: number, j: number) => j * NX + i;
  for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
    const k = j * CX + i;
    if (!cellLand[k]) continue;
    if (i + 1 < CX && cellLand[k + 1] && rid[k + 1] !== rid[k]) segs.push([key(i + 1, j), key(i + 1, j + 1)]);
    if (j + 1 < CY && cellLand[k + CX] && rid[k + CX] !== rid[k]) segs.push([key(i, j + 1), key(i + 1, j + 1)]);
  }
  const byPt = new Map<number, number[]>();
  segs.forEach(([a, b], s) => { for (const p of [a, b]) { const l = byPt.get(p); if (l) l.push(s); else byPt.set(p, [s]); } });
  const usedSeg = new Uint8Array(segs.length);
  const chains: P[][] = [];
  const walk = (s: number, from: number) => {
    const line: number[] = [from];
    let cur = s, at = from;
    while (true) {
      usedSeg[cur] = 1;
      const [a, b] = segs[cur];
      at = a === at ? b : a;
      line.push(at);
      const nb = byPt.get(at)!;
      if (nb.length !== 2) break;
      const nx = nb[0] === cur ? nb[1] : nb[0];
      if (usedSeg[nx]) break;
      cur = nx;
    }
    chains.push(line.map((p) => [(p % NX) * C, Math.floor(p / NX) * C] as P));
  };
  for (const [p, l] of byPt) if (l.length !== 2) for (const s of l) if (!usedSeg[s]) walk(s, p);
  segs.forEach(([a], s) => { if (!usedSeg[s]) walk(s, a); });
  const borders = pathOf(chains.filter((c) => c.length > 2).map((c) => simplify(chaikin(c, false, 3), 0.35)), false);

  // rivers: a meander on the designed lines, only where there is land under them
  const rivers = RIVERS.map((r, k) => {
    const pts = catmull(r, false, 10).map(([x, y], i, a) => {
      const t = i / (a.length - 1), wob = nz.noise(x * 0.04 + k * 9, y * 0.04) * 4.5 * Math.sin(Math.PI * Math.min(1, t * 1.4));
      return [x + wob, y - wob * 0.6] as P;
    });
    return pathOf([pts.filter(([x, y]) => landAt(x, y) > -2)], false);
  });

  // ------------------------------------------------------------ the ground's marks, back to front
  const marks: { y: number; svg: string }[] = [];
  const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
  const regionAt = (x: number, y: number): RegionId | null => { const i = Math.floor(x / C), j = Math.floor(y / C); if (i < 0 || j < 0 || i >= CX || j >= CY) return null; const v = rid[j * CX + i]; return v >= 0 ? REGION_IDS[v] : null; };
  // where the seals and names go, nothing is drawn
  const clear = (x: number, y: number, pad = 0) => REGION_IDS.every((r) => {
    const [sx, sy] = REGION_INFO[r].at;
    if (Math.hypot(x - sx, y - sy) < 30 + pad) return false;
    return !(Math.abs(x - sx) < 54 + pad && y > sy + 14 && y < sy + 50 + pad);
  });
  const nearRiver = (x: number, y: number, d: number) => RIVERS.some((r) => toLine(r, x, y).d < d);
  const nearRange = (x: number, y: number, d: number) => RANGES.some((r) => toLine(r.path, x, y).d < d);
  const put = (x: number, y: number, svg: string) => marks.push({ y, svg });
  const peak = (x: number, y: number, s: number) => put(x, y, `<use href="#pvm-peak${Math.floor(rnd() * 3)}" transform="translate(${f1(x)},${f1(y)}) scale(${f1(s * (0.85 + rnd() * 0.3))})"/>`);
  for (const r of RANGES) {
    const line = catmull(r.path, false, 12);
    let run = 0, stepN = 0;
    for (let i = 1; i < line.length; i++) {
      run += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const [x, y] = line[i], [px, py] = line[i - 1], l = Math.hypot(x - px, y - py) || 1, nx = -(y - py) / l, ny = (x - px) / l;
      // (peaks are wider than tall: down a north-south line they stand further apart and to either side)
      const steep = Math.abs(y - py) / l;
      if (run < (9 + 7 * steep) * r.size) continue;
      run = 0;
      stepN++;
      for (let row = 0; row < (r.rows ?? 1); row++) {
        const off = (r.rows ?? 1) > 1 ? (row - 0.5) * (12 + 6 * steep) * r.size + (stepN % 2 ? 3 : -3) * steep : (stepN % 2 ? 4 : -4) * steep;
        const X = x + nx * off + (rnd() - 0.5) * (4 + 4 * steep), Y = y + ny * off + (rnd() - 0.5) * 3;
        if (landAt(X, Y) > 5 && clear(X, Y, -8)) peak(X, Y, r.size * (row ? 0.95 : 1.2) * (0.8 + rnd() * 0.4));
      }
    }
  }
  // the plateau: cliffs all round (drawn as its own path below), peaks and gold on top
  for (const [dx, dy, s] of [[-26, -8, 0.9], [-4, -16, 1.05], [20, -6, 0.85], [34, 10, 0.7]] as const) peak(PLATEAU.x + dx, PLATEAU.y + dy, s);
  // the tribes' hill forts, Ara's hill, Castellum's four castles round the hall, the fort beyond the pass, the gold
  for (const [x, y, s] of HILLS.slice(0, 3)) { put(x - 22, y + 4, `<use href="#pvm-hillfort" transform="translate(${x - 22},${y + 4}) scale(${s})"/>`); }
  put(700 + 26, 452 + 4, `<use href="#pvm-mound" transform="translate(726,456) scale(1.1)"/>`);
  for (const [dx, dy] of [[-17, -27], [17, -27], [33, -2], [-33, -2]]) put(770 + dx, 285 + dy, `<use href="#pvm-castle" transform="translate(${770 + dx},${285 + dy})"/>`);
  put(452, 294, `<use href="#pvm-castle" transform="translate(452,294) scale(.85)"/>`);
  for (const [dx, dy] of [[-12, 10], [8, 14], [22, 2]]) put(PLATEAU.x + dx, PLATEAU.y + dy, `<use href="#pvm-gold" transform="translate(${PLATEAU.x + dx},${PLATEAU.y + dy})"/>`);
  // forests, hills and fields, by region and by the noise
  const FOREST: Partial<Record<RegionId, number>> = { silva: 0.95, castra: 0.4, aestuarium: 0.45, litus: 0.42, ara: 0.45, vallis: 0.28, collis: 0.3, novaostia: 0.4, castellum: 0.38, saltus: 0.36, metalla: 0.26, insulae: 0.6 };
  const HILLY: Partial<Record<RegionId, number>> = { collis: 0.8, saltus: 0.45, metalla: 0.45, ara: 0.45, castellum: 0.5, castra: 0.22, novaostia: 0.25, litus: 0.3, aestuarium: 0.18, vallis: 0.15 };
  for (let y = 16; y < MAP_H - 12; y += 9) for (let x = 14 + ((y / 9) % 2) * 4.5; x < MAP_W - 12; x += 9) {
    const X = x + (rnd() - 0.5) * 6, Y = y + (rnd() - 0.5) * 6;
    const r = regionAt(X, Y);
    if (!r || landAt(X, Y) < 4 || !clear(X, Y)) continue;
    if (Math.hypot((X - PLATEAU.x) / (PLATEAU.rx + 8), (Y - PLATEAU.y) / (PLATEAU.ry + 8)) < 1) continue;
    if (nearRange(X, Y, 14) || nearRiver(X, Y, 5) || HILLS.some(([hx, hy]) => Math.hypot(X - hx, Y - hy) < 36)) continue;
    const wood = (fz.fbm(X * 0.018, Y * 0.018, 3) + 1) / 2;   // 0..1
    const fr = FOREST[r] ?? 0.2;
    if (wood > 0.5 + (0.6 - fr) * 0.5 && rnd() < 0.55 + fr * 0.45) {
      const conifer = r === 'silva' ? rnd() < 0.35 : r === 'collis' || r === 'saltus' ? rnd() < 0.6 : rnd() < 0.15;
      put(X, Y, `<use href="#pvm-${conifer ? 'fir' : 'tree'}${Math.floor(rnd() * 2)}" transform="translate(${f1(X)},${f1(Y)}) scale(${f1(0.85 + rnd() * 0.35)})"/>`);
      continue;
    }
    const hill = (hz.fbm(X * 0.02, Y * 0.02, 3) + 1) / 2, hr = HILLY[r] ?? 0.06;
    if (hill > 0.5 + (0.6 - hr) * 0.45 && rnd() < 0.18 + hr * 0.3) { put(X, Y, `<use href="#pvm-hill" transform="translate(${f1(X)},${f1(Y)}) scale(${f1(0.8 + rnd() * 0.5)})"/>`); continue; }
    if ((r === 'vallis' || r === 'castra' || r === 'novaostia' || r === 'aestuarium') && wood < 0.42 && rnd() < (r === 'vallis' ? 0.16 : 0.05)) put(X, Y, `<use href="#pvm-field${Math.floor(rnd() * 2)}" transform="translate(${f1(X)},${f1(Y)}) rotate(${Math.floor(rnd() * 40 - 20)})"/>`);
    if (r === 'aestuarium' && toLine(ESTUARY, X, Y).d < 18 && rnd() < 0.5) put(X, Y, `<use href="#pvm-reed" transform="translate(${f1(X)},${f1(Y)})"/>`);
  }
  // the sea's own marks: waves in the open water
  for (let y = -238; y < MAP_H + 240; y += 26) for (let x = -380 + ((y / 26) % 2) * 13; x < MAP_W + 380; x += 26) {
    const X = x + (rnd() - 0.5) * 12, Y = y + (rnd() - 0.5) * 8;
    if (landAt(X, Y) > -16 || rnd() < 0.45 || Math.hypot(X - 50, Y - 52) < 50) continue;
    put(X, Y, `<use href="#pvm-wave" transform="translate(${f1(X)},${f1(Y)})" class="pvm-sea"/>`);
  }
  put(548, 604, '<use href="#pvm-galley" transform="translate(548,604) scale(1.1)" class="pvm-sea pvm-ship"/>');
  put(40, 390, '<use href="#pvm-cog" transform="translate(40,392) scale(-1,1)" class="pvm-sea pvm-ship"/>');
  marks.sort((a, b) => a.y - b.y);

  made = {
    land: pathOf(landLoops, true),
    ripples,
    lakes: '',
    regions,
    borders,
    rivers,
    features: marks.map((m) => m.svg).join(''),
    labels,
  };
  return made;
}

// ------------------------------------------------------------------ the sheet's fixed layers
/** The symbols the marks use, the paper, the frame and the compass rose (drawn once per page). */
export function sheetDefs(): string {
  const ink = '#4b3520';
  const peak = (d: string, shade: string, hatch: string) => `<path d="${d}" fill="#f1e4c3" stroke="${ink}" stroke-width="1.15" stroke-linejoin="round"/><path d="${shade}" fill="#7d5f3a" opacity=".5"/><path d="${hatch}" fill="none" stroke="${ink}" stroke-width=".6" opacity=".55"/>`;
  return `
    <symbol id="pvm-peak0" overflow="visible">${peak('M-15,6 L-4,-14 L0,-8 L4,-11 L14,6 Z', 'M-4,-14 L0,-8 L4,-11 L14,6 L3,6 L0,-3 Z', 'M5,2 l3,-4 M8,4 l3,-4 M-9,2 l2,-3')}</symbol>
    <symbol id="pvm-peak1" overflow="visible">${peak('M-13,6 L0,-16 L13,6 Z', 'M0,-16 L13,6 L4,6 L1,-6 Z', 'M4,1 l3,-4 M7,4 l3,-4 M-7,2 l2,-3')}</symbol>
    <symbol id="pvm-peak2" overflow="visible">${peak('M-16,6 L-7,-7 L-3,-3 L3,-15 L15,6 Z', 'M3,-15 L15,6 L5,6 L2,-5 Z', 'M6,1 l3,-4 M9,4 l3,-4 M-11,3 l2,-3')}</symbol>
    <symbol id="pvm-mound" overflow="visible"><path d="M-18,6 C-14,-2 -8,-11 0,-11 C8,-11 14,-2 18,6 Z" fill="#eadbb4" stroke="${ink}" stroke-width="1.1"/><path d="M0,-11 C8,-11 14,-2 18,6 L6,6 C6,-1 4,-7 0,-11 Z" fill="#7d5f3a" opacity=".45"/><path d="M8,-4 l3,4 M11,-1 l3,4 M5,-7 l2,4" stroke="${ink}" stroke-width=".6" opacity=".55"/></symbol>
    <symbol id="pvm-hillfort" overflow="visible"><path d="M-15,6 C-12,-1 -7,-8 0,-8 C7,-8 12,-1 15,6 Z" fill="#eadbb4" stroke="${ink}" stroke-width="1.1"/><path d="M0,-8 C7,-8 12,-1 15,6 L5,6 C5,0 3,-5 0,-8 Z" fill="#7d5f3a" opacity=".45"/><path d="M-6,-6 V-11 M-3,-7 V-12 M0,-8 V-13 M3,-7 V-12 M6,-6 V-11" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"/><path d="M-6,-9 H6" stroke="${ink}" stroke-width=".7"/><path d="M0,-13 V-19 L5,-17 L0,-15" fill="#b0742e" stroke="${ink}" stroke-width=".7"/></symbol>
    <symbol id="pvm-castle" overflow="visible"><path d="M-6,5 V-4 H-7 V-8 H-4.5 V-6 H-2 V-8 H2 V-6 H4.5 V-8 H7 V-4 H6 V5 Z" fill="#e7d6ad" stroke="${ink}" stroke-width=".9" stroke-linejoin="round"/><path d="M-1.6,5 V1.5 a1.6,1.6 0 0 1 3.2,0 V5" fill="${ink}"/><path d="M6,-4 V5 H2 V-4 Z" fill="#7d5f3a" opacity=".35"/></symbol>
    <symbol id="pvm-gold" overflow="visible"><path d="M-2.5,1 L0,-2.2 L2.5,1 L0,2.4 Z" fill="#e3b53e" stroke="${ink}" stroke-width=".6"/></symbol>
    <symbol id="pvm-galley" overflow="visible"><path d="M-12,1 C-8,5 8,5 13,0 L10,0 L-9,0 Z" fill="#5a3f24" stroke="${ink}" stroke-width=".8"/><path d="M0,0 V-15" stroke="${ink}" stroke-width=".9"/><path d="M-6,-13 C-2,-9 2,-9 6,-13 L6,-3 C2,-6 -2,-6 -6,-3 Z" fill="#9c2a1c" stroke="${ink}" stroke-width=".7"/><path d="M-9,2 l-2,4 M-5,3 l-2,4 M-1,3 l-2,4 M3,3 l-2,4 M7,2 l-2,4" stroke="${ink}" stroke-width=".6"/></symbol>
    <symbol id="pvm-cog" overflow="visible"><path d="M-10,0 C-7,5 7,5 10,0 Z" fill="#6a4a2a" stroke="${ink}" stroke-width=".8"/><path d="M0,0 V-16" stroke="${ink}" stroke-width=".9"/><path d="M-6,-14 C-3,-11 3,-11 6,-14 L6,-3 C3,-5 -3,-5 -6,-3 Z" fill="#efe3c4" stroke="${ink}" stroke-width=".7"/></symbol>
    <symbol id="pvm-hill" overflow="visible"><path d="M-7,3 C-4,-4 4,-4 7,3" fill="none" stroke="${ink}" stroke-width="1" opacity=".75"/><path d="M1,-2 C4,-1 6,1 7,3" fill="none" stroke="${ink}" stroke-width="2" opacity=".25"/></symbol>
    <symbol id="pvm-tree0" overflow="visible"><path d="M0,4 V1" stroke="${ink}" stroke-width="1"/><path d="M-4,1 C-6,-2 -3,-6 0,-5 C3,-6 6,-2 4,1 Z" fill="#9aa06a" stroke="${ink}" stroke-width=".8"/></symbol>
    <symbol id="pvm-tree1" overflow="visible"><path d="M0,4 V1" stroke="${ink}" stroke-width="1"/><path d="M-3.5,1.5 C-5.5,-1 -3,-5.5 0,-4.5 C3,-5.5 5.5,-1 3.5,1.5 Z" fill="#8c965e" stroke="${ink}" stroke-width=".8"/></symbol>
    <symbol id="pvm-fir0" overflow="visible"><path d="M0,4.5 V2" stroke="${ink}" stroke-width="1"/><path d="M0,-7 L4,2 L-4,2 Z" fill="#7c8a58" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/></symbol>
    <symbol id="pvm-fir1" overflow="visible"><path d="M0,4.5 V2" stroke="${ink}" stroke-width="1"/><path d="M0,-8 L3,-2 L2,-2 L4.5,2.5 L-4.5,2.5 L-2,-2 L-3,-2 Z" fill="#74845a" stroke="${ink}" stroke-width=".8" stroke-linejoin="round"/></symbol>
    <symbol id="pvm-field0" overflow="visible"><path d="M-9,-4 H0 V0 H-9 Z" fill="#d9c27f" opacity=".75"/><path d="M0,-4 H8 V1 H0 Z" fill="#c9b36d" opacity=".7"/><path d="M-7,0 H3 V4 H-7 Z" fill="#dcc98f" opacity=".7"/><path d="M-9,-2 H0 M0,-1.5 H8 M-7,2 H3" stroke="${ink}" stroke-width=".35" opacity=".5"/></symbol>
    <symbol id="pvm-field1" overflow="visible"><path d="M-7,-5 H4 V-1 H-7 Z" fill="#cfb772" opacity=".75"/><path d="M-4,-1 H7 V4 H-4 Z" fill="#dcc88c" opacity=".7"/><path d="M-7,-3 H4 M-4,1.5 H7" stroke="${ink}" stroke-width=".35" opacity=".5"/></symbol>
    <symbol id="pvm-reed" overflow="visible"><path d="M-3,2 L-4,-3 M0,2 V-4 M3,2 L4,-3" stroke="${ink}" stroke-width=".7" opacity=".7"/></symbol>
    <symbol id="pvm-wave" overflow="visible"><path d="M-7,0 C-5,-2.5 -2,-2.5 0,0 C2,2.5 5,2.5 7,0" fill="none" stroke-width="1"/></symbol>
    <pattern id="pvm-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><rect width="7" height="7" fill="#a92c1e" opacity=".13"/><path d="M0,0 V7" stroke="#8a2418" stroke-width="1.1" opacity=".3"/></pattern>
    <pattern id="pvm-dots" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#b77a2c" opacity=".16"/><circle cx="2" cy="2" r=".9" fill="#8a5a1c" opacity=".45"/></pattern>
    <filter id="pvm-paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="3" seed="8"/><feColorMatrix values="0 0 0 0 .32  0 0 0 0 .22  0 0 0 0 .1  0 0 0 .22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <filter id="pvm-stain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".006" numOctaves="4" seed="21"/><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .3  0 0 0 0 .12  0 0 0 -1.6 .75"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <radialGradient id="pvm-vignette" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#3a2410" stop-opacity="0"/><stop offset="1" stop-color="#3a2410" stop-opacity=".42"/></radialGradient>
    <linearGradient id="pvm-seawash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c4b4"/><stop offset="1" stop-color="#a9b7aa"/></linearGradient>`;
}

/** The compass rose: a sixteen-point star with its rhumb lines out across the sheet. */
export function compass(x: number, y: number, r: number): string {
  const lines = Array.from({ length: 16 }, (_, k) => { const a = (k / 16) * Math.PI * 2; return `M${x},${y}L${f1(x + Math.cos(a) * 1400)},${f1(y + Math.sin(a) * 1400)}`; }).join('');
  const star = (n: number, ro: number, ri: number, off: number) => Array.from({ length: n }, (_, k) => {
    const a = off + (k / n) * Math.PI * 2, b = a + Math.PI / n, c = a - Math.PI / n;
    return `M${x},${y}L${f1(x + Math.cos(c) * ri)},${f1(y + Math.sin(c) * ri)}L${f1(x + Math.cos(a) * ro)},${f1(y + Math.sin(a) * ro)}L${f1(x + Math.cos(b) * ri)},${f1(y + Math.sin(b) * ri)}Z`;
  }).join('');
  return `<path class="pvm-rhumb" d="${lines}"/>
    <g class="pvm-rose"><circle cx="${x}" cy="${y}" r="${r * 0.62}" class="pvm-rose-ring"/><circle cx="${x}" cy="${y}" r="${r * 0.56}" class="pvm-rose-ring thin"/>
    <path d="${star(8, r * 0.72, r * 0.16, Math.PI / 8)}" class="pvm-rose-minor"/><path d="${star(4, r, r * 0.2, -Math.PI / 2)}" class="pvm-rose-major"/>
    <text x="${x}" y="${y - r - 5}" class="pvm-rose-n">N</text></g>`;
}

/** The plateau's cliffs: a rim with the hachures of a scarp pointing down its sides. */
export function plateauRim(): string {
  const { x, y, rx, ry } = PLATEAU;
  const ticks = Array.from({ length: 56 }, (_, k) => {
    const a = (k / 56) * Math.PI * 2, cx = x + Math.cos(a) * rx, cy = y + Math.sin(a) * ry;
    const l = 5 + (Math.sin(a) > 0 ? 3 : 0);
    return `M${f1(cx)},${f1(cy)}l${f1(Math.cos(a) * l)},${f1(Math.sin(a) * l * 0.8)}`;
  }).join('');
  return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" class="pvm-plateau"/><path d="${ticks}" class="pvm-scarp"/><path d="M${x - rx * 0.78},${y + ry * 0.62} q-14,18 -34,26" class="pvm-trail"/>`;
}
