// Geometry helpers with world-scaled UVs, plus a model builder that merges parts per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/rng';
import { ROOF_TILE, SHINGLE_ROWS } from './textures';
import { ScreenLod } from './lod';

/** Materials whose texture grain should run along the longest axis of a box. */
const GRAIN_MATS = new Set(['timber', 'wood']);

/** Box with world-scaled UVs. Boxes thicker than a few centimetres get a small chamfer whose
 *  normals blend into the neighbouring faces, so every edge catches a soft highlight instead
 *  of meeting at a razor-sharp CG corner. `grain` runs v along the longest face dimension. */
export function box(w: number, h: number, d: number, uvs = 1, grain = false): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}|${uvs}|${grain ? 1 : 0}`;
  let g = boxCache.get(key);
  if (!g) {
    const m = Math.min(w, h, d);
    const bev = m < 0.05 ? 0 : Math.min(0.02, m * 0.14);
    g = bev > 0 ? chamferBox(w, h, d, bev, uvs, grain) : plainBox(w, h, d, uvs, grain);
    g.userData.boxArgs = [w, h, d, uvs];
    boxCache.set(key, g);
  }
  return g.clone();
}
/** the same few boxes are asked for over and over; callers get their own copy */
const boxCache = new Map<string, THREE.BufferGeometry>();

function plainBox(w: number, h: number, d: number, uvs: number, grain: boolean) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const swap = grain && dims[f][0] > dims[f][1];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const a = uv.getX(i) * dims[f][0] * uvs, b = uv.getY(i) * dims[f][1] * uvs;
      if (swap) uv.setXY(i, b, a);
      else uv.setXY(i, a, b);
    }
  }
  return g;
}

function chamferBox(w: number, h: number, d: number, bev: number, uvs: number, grain: boolean) {
  const H = [w / 2, h / 2, d / 2];
  const dims = [w, h, d];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  // (u axis, v axis) for faces whose normal lies along axis a
  const axes = (a: number): [number, number] => {
    const [b, c] = a === 0 ? [2, 1] : a === 1 ? [0, 2] : [0, 1];
    return grain && dims[b] > dims[c] ? [c, b] : [b, c];
  };
  type V = [number[], number, number]; // position, normal axis, normal sign
  const put = ([p, a, s]: V) => {
    pos.push(p[0], p[1], p[2]);
    nrm.push(a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0);
    const [ua, va] = axes(a);
    uv.push((p[ua] + H[ua]) * uvs, (p[va] + H[va]) * uvs);
  };
  const tri = (A: V, B: V, C: V) => {
    const ab = [B[0][0] - A[0][0], B[0][1] - A[0][1], B[0][2] - A[0][2]];
    const ac = [C[0][0] - A[0][0], C[0][1] - A[0][1], C[0][2] - A[0][2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const avg = [0, 0, 0];
    for (const v of [A, B, C]) avg[v[1]] += v[2];
    if (cr[0] * avg[0] + cr[1] * avg[1] + cr[2] * avg[2] < 0) { put(A); put(C); put(B); }
    else { put(A); put(B); put(C); }
  };
  const pt = (a: number, va: number, b: number, vb: number, c: number, vc: number) => {
    const p = [0, 0, 0];
    p[a] = va; p[b] = vb; p[c] = vc;
    return p;
  };
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const ib = H[b] - bev, ic = H[c] - bev;
    for (const s of [-1, 1]) {
      // flat face
      const q = [[-ib, -ic], [ib, -ic], [ib, ic], [-ib, ic]].map(([x, y]) => [pt(a, s * H[a], b, x, c, y), a, s] as V);
      tri(q[0], q[1], q[2]);
      tri(q[0], q[2], q[3]);
    }
    // edge strips between face a and face b, running along c
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const P1 = (t: number): V => [pt(a, sa * H[a], b, sb * ib, c, t), a, sa];
      const P2 = (t: number): V => [pt(a, sa * (H[a] - bev), b, sb * H[b], c, t), b, sb];
      tri(P1(-ic), P2(-ic), P2(ic));
      tri(P1(-ic), P2(ic), P1(ic));
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    tri(
      [[sx * H[0], sy * (H[1] - bev), sz * (H[2] - bev)], 0, sx],
      [[sx * (H[0] - bev), sy * H[1], sz * (H[2] - bev)], 1, sy],
      [[sx * (H[0] - bev), sy * (H[1] - bev), sz * H[2]], 2, sz],
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Round rod between two points (hip and ridge caps). Non-indexed with normals and uvs. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 7) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true).toNonIndexed();
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// ---------------------------------------------------------------- detail
/** 1 builds close-up geometry (barrel channels, finely subdivided uneven walls); 0 builds the
 *  cheap model shown from afar, whose silhouette and textures are the same. */
let detail = 1;
export function setDetail(d: 0 | 1) { detail = d; }

// ---------------------------------------------------------------- walls
export interface WallOpts {
  /** corner radius; w = d = 2r makes a round tower */
  r?: number;
  /** how far the walls lean in at the top */
  batter?: number;
  /** amplitude of the gentle unevenness of hand-laid walls */
  wobble?: number;
  uvs?: number;
  seed?: number;
  /** close the top (towers); off under a roof */
  cap?: boolean;
}

/** Wall block from y = 0 to h over w x d with rounded corners, battered and gently uneven, so
 *  nothing meets at a hard CG corner. Uvs are world scaled and run on round the corners. */
export function wallPrism(w: number, d: number, h: number, o: WallOpts = {}): THREE.BufferGeometry {
  const r = Math.max(0, Math.min(o.r ?? 0.07, w / 2, d / 2));
  const batter = o.batter ?? 0.015, wob = o.wobble ?? 0.006, uvs = o.uvs ?? 1, seed = o.seed ?? 1;
  const hw = w / 2 - r, hd = d / 2 - r;
  const pts: { x: number; z: number; nx: number; nz: number }[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-4) return;
    const n = Math.max(1, Math.ceil(len / (detail ? 0.16 : 0.5)));
    for (let i = 0; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, nx, nz });
  };
  const arc = (cx: number, cz: number, a0: number) => {
    const n = r > 1e-3 ? Math.max(detail ? 3 : 2, Math.ceil(Math.sqrt(r) * (detail ? 12 : 7))) : 1;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, nx: Math.cos(a), nz: Math.sin(a) });
    }
  };
  line(0, -d / 2, hw, -d / 2, 0, -1);
  arc(hw, -hd, -Math.PI / 2);
  line(w / 2, -hd, w / 2, hd, 1, 0);
  arc(hw, hd, 0);
  line(hw, d / 2, -hw, d / 2, 0, 1);
  arc(-hw, hd, Math.PI / 2);
  line(-w / 2, hd, -w / 2, -hd, -1, 0);
  arc(-hw, -hd, Math.PI);
  line(-hw, -d / 2, 0, -d / 2, 0, -1);
  pts.push({ ...pts[0] });
  const arcLen = [0];
  for (let i = 1; i < pts.length; i++) arcLen.push(arcLen[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const L = arcLen[arcLen.length - 1];
  const kA = Math.max(1, Math.round(L * 1.3)), kB = Math.max(2, Math.round(L * 3.1));
  const ny = detail ? Math.max(2, Math.ceil(h / 0.2)) : 1;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const at = (i: number, y: number) => {
    const p = pts[i];
    const ph = (arcLen[i] / L) * Math.PI * 2;
    const n = wob * (0.6 * Math.sin(kA * ph + seed) * Math.cos(y * 4.7 + seed * 1.3) + 0.4 * Math.sin(kB * ph + seed * 2.1 + y * 3.1));
    const off = -batter * (y / h) + n;
    return [p.x + p.nx * off, y, p.z + p.nz * off];
  };
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j <= ny; j++) {
      const y = (h * j) / ny;
      pos.push(...at(i, y));
      uv.push(arcLen[i] * uvs, y * uvs);
    }
  }
  const R = ny + 1;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < ny; j++) {
      const a = i * R + j, b = (i + 1) * R + j, c = b + 1, e = a + 1;
      idx.push(a, e, b, e, c, b);
    }
  }
  if (o.cap) {
    const c0 = pos.length / 3;
    pos.push(0, h, 0);
    uv.push(0, 0);
    for (let i = 0; i < pts.length; i++) {
      const p = at(i, h);
      pos.push(...p);
      uv.push(p[0] * uvs, p[2] * uvs);
    }
    for (let i = 0; i < pts.length - 1; i++) idx.push(c0, c0 + 2 + i, c0 + 1 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- roofs
export type RoofStyle = 'tile' | 'thatch' | 'shingle' | 'flat';

interface RoofSpec {
  /** courses per texture unit (matches the texture) */
  rows: number;
  /** barrel channels per texture unit; 0 = a plain course */
  cols: number;
  /** how far each course's lower edge stands proud */
  lift: number;
  /** hump height of a barrel channel */
  amp: number;
  /** thickness of the slab under the courses, seen at the eaves and verges */
  thick: number;
  /** course cross-section: (t along the course from its lower edge, fraction of `lift`) */
  prof: [number, number][];
  /** lumpiness of thatch bundles */
  wave: number;
  /** the course cross-section of the far model */
  far: [number, number][];
}

/** samples across each barrel channel: a valley and two on the crown, smoothed by the normals */
const CH_SAMPLES = 3;

const ROOF: Record<RoofStyle, RoofSpec> = {
  tile: { rows: ROOF_TILE.rows, cols: ROOF_TILE.cols, lift: 0.026, amp: 0.026, thick: 0.05, prof: [[0, 0], [0.01, 1], [1, 0]], wave: 0, far: [[0, 0], [0.01, 1], [1, 0]] },
  thatch: { rows: 6, cols: 0, lift: 0.075, amp: 0, thick: 0.12, prof: [[0, 0], [0.03, 0.45], [0.09, 0.8], [0.2, 0.97], [0.34, 1], [0.62, 0.7], [1, 0]], wave: 0.02, far: [[0, 0], [0.08, 0.75], [0.3, 1], [1, 0]] },
  shingle: { rows: SHINGLE_ROWS, cols: 0, lift: 0.018, amp: 0, thick: 0.04, prof: [[0, 0], [0.004, 1], [1, 0]], wave: 0, far: [[0, 0], [0.004, 1], [1, 0]] },
  flat: { rows: 0, cols: 0, lift: 0, amp: 0, thick: 0.05, prof: [[0, 0], [1, 0]], wave: 0, far: [[0, 0], [1, 0]] },
};

export interface RoofOpts {
  style?: RoofStyle;
  uvs?: number;
  /** slopes swell outwards by this much at mid height */
  bulge?: number;
  /** the middle of the ridge (and the eave) droops by this much */
  sag?: number;
  seed?: number;
}

type V3 = THREE.Vector3;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface FaceOpts extends RoofOpts {
  verge?: [boolean, boolean];
  fascia?: boolean;
  /** keep the edges of the face still (hips, cones) so neighbouring faces stay closed */
  pinEdges?: boolean;
  channels?: number;
}

/** Quad strip between two polylines; wound so its normal faces `out`. Non-indexed, flat. */
function strip(top: V3[], bot: V3[], out: V3, uTop: number[], vTop: number, vBot: number) {
  const pos: number[] = [], uv: number[] = [];
  let flip = false;
  for (let i = 0; i < top.length - 1; i++) {
    const e1 = new THREE.Vector3().subVectors(top[i + 1], top[i]);
    const e2 = new THREE.Vector3().subVectors(bot[i], top[i]);
    const n = new THREE.Vector3().crossVectors(e1, e2);
    if (n.lengthSq() > 1e-10) { flip = n.dot(out) < 0; break; }
  }
  const put = (p: V3, u: number, v: number) => { pos.push(p.x, p.y, p.z); uv.push(u, v); };
  for (let i = 0; i < top.length - 1; i++) {
    const a = top[i], b = top[i + 1], c = bot[i + 1], d = bot[i];
    const ua = uTop[i], ub = uTop[i + 1];
    if (!flip) { put(a, ua, vTop); put(b, ub, vTop); put(c, ub, vBot); put(a, ua, vTop); put(c, ub, vBot); put(d, ua, vBot); }
    else { put(a, ua, vTop); put(c, ub, vBot); put(b, ub, vTop); put(a, ua, vTop); put(d, ua, vBot); put(c, ub, vBot); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** One roof face between eave corners A0 B0 (left to right seen from outside) and top corners
 *  A1 B1, laid in stepped courses; tiles also get barrel channels running from eave to ridge,
 *  whose rounded ends scallop the eave. Adds the slab's underside, fascia and verges. */
function roofFace(A0: V3, B0: V3, B1: V3, A1: V3, o: FaceOpts): THREE.BufferGeometry[] {
  const S = ROOF[o.style ?? 'tile'];
  const uvs = o.uvs ?? 1, seed = o.seed ?? 1, bulge = o.bulge ?? 0, sag = o.sag ?? 0;
  const N0 = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(B0, A0), new THREE.Vector3().subVectors(A1, A0)).normalize();
  const W0 = A0.distanceTo(B0), W1 = A1.distanceTo(B1);
  const L = new THREE.Vector3().addVectors(A1, B1).multiplyScalar(0.5).distanceTo(new THREE.Vector3().addVectors(A0, B0).multiplyScalar(0.5));
  const nRows = S.rows ? Math.max(1, Math.round(L * uvs * S.rows)) : 1;
  // the far model keeps the texture's channels but not the humps
  const chTex = o.channels ?? (S.cols ? Math.max(2, Math.round(W0 * uvs * S.cols)) : 0);
  const nCh = detail ? chTex : 0;
  const nA = nCh ? nCh * CH_SAMPLES : Math.max(2, Math.ceil(W0 / (detail ? 0.12 : 0.4)));
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const base = (a: number, s: number, out: V3) => {
    tmp.lerpVectors(A0, B0, a);
    tmp2.lerpVectors(A1, B1, a);
    out.lerpVectors(tmp, tmp2, s);
    const mid = 4 * a * (1 - a);
    out.y -= sag * mid * (0.3 + 0.7 * s);
    const pin = o.pinEdges ? Math.min(1, a * 6, (1 - a) * 6) : 1;
    out.addScaledVector(N0, bulge * Math.sin(Math.PI * s) * pin);
    return out;
  };
  const hump = (a: number, s: number) => {
    if (!nCh) return 0;
    const ws = W0 > 1e-6 ? (W0 + (W1 - W0) * s) / W0 : 1;
    return S.amp * (0.3 + 0.7 * ws) * Math.pow(Math.abs(Math.sin(Math.PI * a * nCh)), 0.7);
  };
  const liftOf = (j: number) => S.lift * (1 + (hash2(j, 3, seed) - 0.5) * 0.35) * (j === 0 && o.style === 'thatch' ? 1.35 : 1);
  const wave = (a: number, j: number) => S.wave ? S.wave * (0.65 * Math.sin(Math.PI * 2 * ((a * W0) / 0.34) + j * 1.9 + seed) + 0.35 * Math.sin(Math.PI * 2 * ((a * W0) / 0.13) + j * 3.1)) : 0;
  const surf = (a: number, j: number, t: number, p: number) => {
    const s = (j + t) / nRows;
    const q = base(a, s, new THREE.Vector3());
    return q.addScaledVector(N0, hump(a, s) + (liftOf(j) + wave(a, j)) * p);
  };
  const U = (a: number, s: number) => chTex ? (a * chTex) / S.cols : (a - 0.5) * (W0 + (W1 - W0) * s) * uvs;
  const out: THREE.BufferGeometry[] = [];
  // courses
  const P = detail ? S.prof : S.far;
  for (let j = 0; j < nRows; j++) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= nA; i++) {
      const a = i / nA;
      for (const [t, p] of P) {
        const q = surf(a, j, t, p);
        pos.push(q.x, q.y, q.z);
        uv.push(U(a, (j + t) / nRows), S.rows ? (j + t) / S.rows : ((j + t) / nRows) * L * uvs);
      }
    }
    const R = P.length;
    for (let i = 0; i < nA; i++) for (let k = 0; k < R - 1; k++) {
      const a = i * R + k, b = (i + 1) * R + k, c = b + 1, e = a + 1;
      idx.push(a, b, c, a, c, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    out.push(g.toNonIndexed());
  }
  const under = (a: number, s: number) => base(a, s, new THREE.Vector3()).addScaledVector(N0, -S.thick);
  // underside
  {
    const nu = Math.min(nA, 8);
    const top: V3[][] = [];
    for (let j = 0; j <= nRows; j++) top.push(Array.from({ length: nu + 1 }, (_, i) => under(i / nu, j / nRows)));
    for (let j = 0; j < nRows; j++) out.push(strip(top[j], top[j + 1], N0.clone().negate(), top[j].map((_, i) => i / nu), j / nRows, (j + 1) / nRows));
  }
  const down = new THREE.Vector3().addVectors(A0, B0).sub(A1).sub(B1).normalize();
  if (o.fascia ?? true) {
    const top: V3[] = [], bot: V3[] = [], u: number[] = [];
    for (let i = 0; i <= nA; i++) {
      const a = i / nA;
      top.push(surf(a, 0, 0, 0));
      bot.push(under(a, 0));
      u.push(U(a, 0));
    }
    out.push(strip(top, bot, down, u, 0.002, 0.02));
  }
  const verge = o.verge ?? [false, false];
  for (const side of [0, 1]) {
    if (!verge[side]) continue;
    const a = side;
    const top: V3[] = [], bot: V3[] = [], u: number[] = [];
    for (let j = 0; j < nRows; j++) for (const [t, p] of P) {
      const s = (j + t) / nRows;
      top.push(surf(a, j, t, p));
      bot.push(under(a, s));
      u.push(s * L * uvs);
    }
    const outDir = new THREE.Vector3().subVectors(side ? B0 : A0, side ? A0 : B0).normalize();
    out.push(strip(top, bot, outDir, u, 0.002, 0.03));
  }
  return out;
}

function mergeAll(gs: THREE.BufferGeometry[]) {
  return mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
}

/** Ridge covering following y(x) from x0 to x1 at z = 0: overlapping half-round ridge tiles, a
 *  fat bound roll of straw, or a pair of ridge boards. */
function ridgeAlong(x0: number, x1: number, y: (x: number) => number, style: RoofStyle) {
  const parts: THREE.BufferGeometry[] = [];
  if (style === 'thatch') {
    const n = Math.max(2, Math.ceil((x1 - x0) / 0.25));
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n;
      const g = rod(v3(a - 0.01, y(a), 0), v3(b + 0.01, y(b), 0), 0.085, 12);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k) * (b - a) * 1.2, uv.getX(k) * 0.6);
      parts.push(g);
    }
  } else if (style === 'shingle') {
    for (const s of [-1, 1]) {
      const g = box(x1 - x0, 0.1, 0.022, 3);
      g.rotateX(s * 0.75);
      g.translate((x0 + x1) / 2, y((x0 + x1) / 2) - 0.01, s * 0.03);
      parts.push(g);
    }
  } else {
    const pieces = Math.max(2, Math.round((x1 - x0) / 0.16));
    const pl = (x1 - x0) / pieces;
    for (let i = 0; i < pieces; i++) {
      const xa = x0 + pl * i, xb = xa + pl;
      const g = new THREE.CylinderGeometry(0.058, 0.05, pl * 1.1, 10, 1, false).toNonIndexed();
      g.rotateZ(Math.PI / 2 + Math.atan2(y(xb) - y(xa), pl));
      g.translate((xa + xb) / 2, (y(xa) + y(xb)) / 2, 0);
      parts.push(g);
    }
  }
  return mergeAll(parts);
}

export interface GableRoof {
  roof: THREE.BufferGeometry;
  /** the two wall triangles closing the ends, in the wall material */
  gable: THREE.BufferGeometry;
  /** ridge tiles / straw roll */
  ridge: THREE.BufferGeometry;
  eave: number;
  hw: number;
  hd: number;
  slopeLen: number;
}

/** Gable roof over w x d walls: ridge along x, h above the wall top, eaves `over` beyond the
 *  side walls and `overEnd` beyond the gables. The slopes pass through the wall line, so the
 *  gable triangles close them. */
export function gableRoof(w: number, d: number, h: number, over = 0.2, o: RoofOpts & { overEnd?: number } = {}): GableRoof {
  const style = o.style ?? 'tile';
  const S = ROOF[style];
  const gw = w / 2, gd = d / 2;
  const hw = gw + (o.overEnd ?? over), hd = gd + over;
  const eave = (-over * h) / gd;
  const fo: FaceOpts = { ...o, style, verge: [true, true], fascia: true };
  const parts = [
    ...roofFace(v3(-hw, eave, hd), v3(hw, eave, hd), v3(hw, h, 0), v3(-hw, h, 0), fo),
    ...roofFace(v3(hw, eave, -hd), v3(-hw, eave, -hd), v3(-hw, h, 0), v3(hw, h, 0), fo),
  ];
  const sag = o.sag ?? 0;
  const ridgeY = (x: number) => { const a = (x + hw) / (2 * hw); return h - sag * 4 * a * (1 - a) + S.lift * 0.4; };
  const ridge = ridgeAlong(-hw - 0.02, hw + 0.02, ridgeY, style);
  // gable triangles, a little inside the roof slab so the sag can't lift a slope clear of them
  const aw = (hw - gw) / (2 * hw);
  const dip = S.thick * 0.45 + sag * 4 * aw * (1 - aw);
  const gp: number[] = [], gu: number[] = [];
  for (const sx of [1, -1]) {
    const tri = [[gd, 0], [-gd, 0], [0, h - dip]];
    const ordered = sx > 0 ? tri : [tri[1], tri[0], tri[2]];
    for (const [z, y] of ordered) { gp.push(sx * gw, y, z); gu.push(z, y); }
  }
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  gable.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
  gable.computeVertexNormals();
  return { roof: mergeAll(parts), gable, ridge, eave, hw, hd, slopeLen: Math.hypot(hd, h - eave) };
}

/** Hipped roof over w x d walls (a pyramid when square), eaves `over` beyond every wall, with
 *  hip and ridge caps. */
export function hipRoof(w: number, d: number, h: number, over = 0.18, o: RoofOpts = {}): THREE.BufferGeometry {
  if (d > w) {
    const g = hipRoof(d, w, h, over, o);
    g.rotateY(Math.PI / 2);
    return g;
  }
  const style = o.style ?? 'tile';
  const S = ROOF[style];
  const gw = w / 2, gd = d / 2;
  const hw = gw + over, hd = gd + over;
  const r = gw - gd;
  const e = (-over * h) / gd;
  const fo: FaceOpts = { ...o, style, fascia: true, pinEdges: true };
  const parts = [
    ...roofFace(v3(-hw, e, hd), v3(hw, e, hd), v3(r, h, 0), v3(-r, h, 0), fo),
    ...roofFace(v3(hw, e, -hd), v3(-hw, e, -hd), v3(-r, h, 0), v3(r, h, 0), fo),
    ...roofFace(v3(hw, e, hd), v3(hw, e, -hd), v3(r, h, 0), v3(r, h, 0), fo),
    ...roofFace(v3(-hw, e, -hd), v3(-hw, e, hd), v3(-r, h, 0), v3(-r, h, 0), fo),
  ];
  const capR = style === 'thatch' ? 0.07 : style === 'shingle' ? 0.025 : 0.045;
  const up = S.lift * 0.7 + S.amp * 0.5;
  for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
    parts.push(rod(v3(sx * hw, e + up, sz * hd), v3(sx * r, h + up, 0), capR, 8));
  }
  if (r > 0.01) parts.push(ridgeAlong(-r - capR, r + capR, () => h + up * 0.6, style));
  else parts.push(new THREE.SphereGeometry(capR * 1.5, 8, 6).toNonIndexed().translate(0, h + up, 0));
  return mergeAll(parts);
}

/** Single-pitch roof for lean-tos and sheds: eave along +z at y = low, top edge at y = high,
 *  w wide and d deep (plan), with verges at both ends. */
export function leanToRoof(w: number, d: number, low: number, high: number, o: RoofOpts = {}): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  return mergeAll(roofFace(v3(-hw, low, hd), v3(hw, low, hd), v3(hw, high, -hd), v3(-hw, high, -hd), { ...o, verge: [true, true], fascia: true }));
}

/** Conical roof over a round wall of radius rw: eaves `over` beyond it, apex h above the wall
 *  top, laid in stepped rings; tiles get barrel channels converging on the apex. */
export function coneRoof(rw: number, h: number, over = 0.14, o: RoofOpts = {}): THREE.BufferGeometry {
  const style = o.style ?? 'tile';
  const S = ROOF[style];
  const uvs = o.uvs ?? 1, seed = o.seed ?? 1, bulge = o.bulge ?? 0;
  const R = rw + over;
  const e = (-over * h) / rw;
  const slant = Math.hypot(R, h - e);
  const nRows = S.rows ? Math.max(2, Math.round(slant * uvs * S.rows)) : 1;
  const chTex = S.cols ? Math.max(6, Math.round(Math.PI * 2 * R * uvs * S.cols)) : 0;
  const nCh = detail ? chTex : 0;
  const nA = nCh ? nCh * CH_SAMPLES : Math.max(12, Math.ceil((Math.PI * 2 * R) / (detail ? 0.09 : 0.2)));
  const nr = (h - e) / slant, ny = R / slant; // outward cone normal: radial, up
  const liftOf = (j: number) => S.lift * (1 + (hash2(j, 3, seed) - 0.5) * 0.35) * (j === 0 && style === 'thatch' ? 1.35 : 1);
  const P = detail ? S.prof : S.far;
  const pt = (a: number, s: number, off: number) => {
    const th = a * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    const rad = R * (1 - s) + nr * (off + bulge * Math.sin(Math.PI * s));
    return [c * rad, e + (h - e) * s + ny * (off + bulge * Math.sin(Math.PI * s)), sn * rad];
  };
  const hump = (a: number, s: number) => nCh ? S.amp * (0.25 + 0.75 * (1 - s)) * Math.pow(Math.abs(Math.sin(Math.PI * a * nCh)), 0.7) : 0;
  const wave = (a: number, j: number) => S.wave ? S.wave * Math.sin(Math.PI * 2 * a * Math.max(3, Math.round((Math.PI * 2 * R) / 0.21)) + j * 1.9 + seed) : 0;
  const out: THREE.BufferGeometry[] = [];
  for (let j = 0; j < nRows; j++) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= nA; i++) {
      const a = i / nA;
      for (const [t, p] of P) {
        const s = (j + t) / nRows;
        pos.push(...pt(a, s, hump(a, s) + (liftOf(j) + wave(a, j)) * p));
        uv.push(chTex ? (a * chTex) / S.cols : a * Math.PI * 2 * R * (1 - s) * uvs, S.rows ? (j + t) / S.rows : s * slant * uvs);
      }
    }
    const K = P.length;
    // counter-clockwise from outside: angle increases to the left seen from outside
    for (let i = 0; i < nA; i++) for (let k = 0; k < K - 1; k++) {
      const a = i * K + k, b = (i + 1) * K + k, c = b + 1, d2 = a + 1;
      idx.push(a, c, b, a, d2, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    out.push(g.toNonIndexed());
  }
  // underside and eave fascia
  const ring = (s: number, off: number) => Array.from({ length: 33 }, (_, i) => { const q = pt(i / 32, s, off); return v3(q[0], q[1], q[2]); });
  const lo = ring(0, -S.thick), top = ring(0, 0), apex = ring(1, -S.thick);
  out.push(strip(top, lo, v3(0, -1, 0), top.map((_, i) => i / 32), 0.002, 0.02));
  out.push(strip(lo, apex, v3(0, -1, 0), lo.map((_, i) => i / 32), 0, 1));
  return mergeAll(out);
}


export function cyl(rTop: number, rBot: number, h: number, seg = 16, uvs = 1, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ * uvs, uv.getY(i) * h * uvs);
  g.translate(0, h / 2, 0);
  return g;
}

export function cone(r: number, h: number, seg = 16, uvs = 1) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const sl = Math.hypot(r, h);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r * uvs, uv.getY(i) * sl * uvs);
  g.translate(0, h / 2, 0);
  return g;
}

export function sphere(r: number, ws = 12, hs = 8, phiLen = Math.PI * 2, thetaLen = Math.PI) {
  return new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen);
}

function normalizeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.userData = {};
  if (!out.getAttribute('uv')) {
    const n = out.getAttribute('position').count;
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  return out;
}

export interface Anchors {
  chimneys: THREE.Vector3[];
  windows: THREE.Vector3[];
  fires: THREE.Vector3[];
  flags: THREE.Vector3[];
  door: THREE.Vector3;
  top: number;
  piles: THREE.Vector3[];
  soldiers: THREE.Vector3[];
}

/** camera distance beyond which buildings switch to their far model */
export const FAR_DIST = 36;

export class ModelBuilder {
  parts = new Map<string, THREE.BufferGeometry[]>();
  movers: { name: string; builder: ModelBuilder; pos: THREE.Vector3; axis: 'x' | 'y' | 'z' }[] = [];
  /** a cheaper copy shown beyond FAR_DIST from the camera */
  far: ModelBuilder | null = null;
  anchors: Anchors = { chimneys: [], windows: [], fires: [], flags: [], door: new THREE.Vector3(), top: 1, piles: [], soldiers: [] };
  private tmpM = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private merged: Map<string, THREE.BufferGeometry> | null = null;

  add(mat: string, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1): this {
    const ba = g.userData.boxArgs as number[] | undefined;
    if (ba && GRAIN_MATS.has(mat)) g = box(ba[0], ba[1], ba[2], ba[3], true);
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.tmpM.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(s, s, s));
    const geo = normalizeGeo(g);
    geo.applyMatrix4(this.tmpM);
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push(geo);
    this.merged = null;
    return this;
  }

  /** Push an already normalised geometry as is (parts copied over from another builder). */
  addRaw(mat: string, g: THREE.BufferGeometry): this {
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push(g);
    this.merged = null;
    return this;
  }

  /** The same model for another player: material keys renamed by `rename`, the merged geometry
   *  shared with this one. */
  rekey(rename: (key: string) => string): ModelBuilder {
    const out = new ModelBuilder();
    const merged = this.mergeParts();
    for (const [k, geos] of this.parts) out.parts.set(rename(k), geos);
    out.merged = new Map([...merged].map(([k, g]) => [rename(k), g]));
    out.movers = this.movers.map((m) => ({ ...m, builder: m.builder.rekey(rename) }));
    out.anchors = this.anchors;
    out.far = this.far?.rekey(rename) ?? null;
    return out;
  }

  private mergeParts() {
    if (!this.merged) {
      this.merged = new Map();
      for (const [key, geos] of this.parts) {
        const merged = mergeGeometries(geos, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        this.merged.set(key, merged);
      }
    }
    return this.merged;
  }

  /** Box resting on y (bottom at y). */
  block(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, uvs = 1) {
    return this.add(mat, box(w, h, d, uvs), x, y + h / 2, z, ry);
  }

  mover(name: string, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z'): ModelBuilder {
    const b = new ModelBuilder();
    this.movers.push({ name, builder: b, pos: new THREE.Vector3(x, y, z), axis });
    return b;
  }

  /** Meshes for this model; the merged geometry is shared by every instance built from it. With a
   *  far copy, the group holds a THREE.LOD that swaps between the two by camera distance. */
  build(materials: (key: string) => THREE.Material): THREE.Group {
    const near = this.buildLevel(materials);
    if (!this.far) return near;
    const lod = new ScreenLod();
    lod.addLevel(near, 0);
    lod.addLevel(this.far.buildLevel(materials), FAR_DIST, 0.1);
    const group = new THREE.Group();
    group.add(lod);
    return group;
  }

  private buildLevel(materials: (key: string) => THREE.Material): THREE.Group {
    const group = new THREE.Group();
    for (const [key, merged] of this.mergeParts()) {
      const mesh = new THREE.Mesh(merged, materials(key));
      mesh.castShadow = !key.startsWith('glow') && key !== 'window';
      mesh.receiveShadow = true;
      mesh.userData.matKey = key;
      group.add(mesh);
    }
    for (const m of this.movers) {
      const sub = m.builder.build(materials);
      sub.position.copy(m.pos);
      sub.name = m.name;
      sub.userData.axis = m.axis;
      group.add(sub);
    }
    return group;
  }

  bounds(): THREE.Box3 {
    const b = new THREE.Box3();
    for (const geos of this.parts.values()) for (const g of geos) {
      g.computeBoundingBox();
      b.union(g.boundingBox!);
    }
    return b;
  }
}
