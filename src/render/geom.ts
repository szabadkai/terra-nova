// Geometry helpers with world-scaled UVs, plus a model builder that merges parts per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Materials whose texture grain should run along the longest axis of a box. */
const GRAIN_MATS = new Set(['timber', 'wood']);

/** Box with world-scaled UVs. Boxes thicker than a few centimetres get a small chamfer whose
 *  normals blend into the neighbouring faces, so every edge catches a soft highlight instead
 *  of meeting at a razor-sharp CG corner. `grain` runs v along the longest face dimension. */
export function box(w: number, h: number, d: number, uvs = 1, grain = false): THREE.BufferGeometry {
  const m = Math.min(w, h, d);
  const bev = m < 0.05 ? 0 : Math.min(0.02, m * 0.14);
  const g = bev > 0 ? chamferBox(w, h, d, bev, uvs, grain) : plainBox(w, h, d, uvs, grain);
  g.userData.boxArgs = [w, h, d, uvs];
  return g;
}

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

export type RoofStyle = 'tile' | 'thatch' | 'flat';

/** Per style: texture rows per repeat, how far each row's lower edge stands proud, thickness. */
const ROOF: Record<RoofStyle, { rows: number; lift: number; thick: number }> = {
  tile: { rows: 8, lift: 0.017, thick: 0.05 },
  thatch: { rows: 6, lift: 0.02, thick: 0.09 },
  flat: { rows: 0, lift: 0, thick: 0.05 },
};

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

/** Gable roof: ridge along X, ridge height h above the wall top. The slope passes
 *  exactly through the wall line so the gable triangles close the gap. Tiled and thatched
 *  slopes are built as stepped rows (one per texture row) so every course casts a real
 *  shadow line on the one below. */
export function gableRoof(w: number, d: number, h: number, over = 0.12, uvs = 1, style: RoofStyle = 'tile') {
  const gw = w / 2, gd = d / 2;
  const hw = gw + over, hd = gd + over;
  const eave = -over * h / gd;
  const slopeLen = Math.hypot(hd, h - eave);
  const S = ROOF[style];
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], e: number[], uA: number[], uB: number[], uC: number[], uE: number[]) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...e);
    uv.push(...uA, ...uB, ...uC, ...uA, ...uC, ...uE);
  };
  const tri = (a: number[], b: number[], c: number[]) => {
    pos.push(...a, ...b, ...c);
    uv.push(0, 0, 0.02, 0, 0.01, 0.02);
  };
  const t = S.thick;
  const W = (w + over * 2) * uvs;
  const n = S.rows ? Math.max(2, Math.round(slopeLen * uvs * S.rows)) : 1;
  for (const side of [1, -1]) {
    const ny = hd / slopeLen, nz = side * (h - eave) / slopeLen;
    const P = (x: number, s: number) => [x, eave + (h - eave) * s, side * hd * (1 - s)];
    const L = (p: number[]) => [p[0], p[1] + ny * S.lift, p[2] + nz * S.lift];
    const xl = side * -hw, xr = side * hw;
    for (let k = 0; k < n; k++) {
      const s0 = k / n, s1 = (k + 1) / n;
      const v0 = S.rows ? k / S.rows : 0, v1 = S.rows ? (k + 1) / S.rows : slopeLen * uvs;
      quad(L(P(xl, s0)), L(P(xr, s0)), P(xr, s1), P(xl, s1), [0, v0], [W, v0], [W, v1], [0, v1]);
      if (S.lift > 0) {
        quad(P(xl, s0), P(xr, s0), L(P(xr, s0)), L(P(xl, s0)), [0, v0 + 0.004], [W, v0 + 0.004], [W, v0 + 0.02], [0, v0 + 0.02]);
        // close the little wedge at both gable ends
        tri(P(xl, s1), L(P(xl, s0)), P(xl, s0));
        tri(P(xr, s0), L(P(xr, s0)), P(xr, s1));
      }
    }
  }
  // eave thickness
  quad([-hw, eave - t, hd], [hw, eave - t, hd], [hw, eave, hd], [-hw, eave, hd], [0, 0], [W, 0], [W, 0.05], [0, 0.05]);
  quad([hw, eave - t, -hd], [-hw, eave - t, -hd], [-hw, eave, -hd], [hw, eave, -hd], [0, 0], [W, 0], [W, 0.05], [0, 0.05]);
  // verge thickness at the gable ends
  quad([hw, eave - t, hd], [hw, eave - t, -hd], [hw, h - t, 0], [hw, h - t, 0], [0, 0], [1, 0], [0.5, 0.5], [0.5, 0.5]);
  quad([hw, eave, hd], [hw, eave - t, hd], [hw, h - t, 0], [hw, h, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  quad([hw, eave - t, -hd], [hw, eave, -hd], [hw, h, 0], [hw, h - t, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  quad([-hw, eave - t, -hd], [-hw, eave, -hd], [-hw, h, 0], [-hw, h - t, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  quad([-hw, eave, hd], [-hw, eave - t, hd], [-hw, h - t, 0], [-hw, h, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  // underside
  quad([-hw, eave - t, hd], [-hw, h - t, 0], [hw, h - t, 0], [hw, eave - t, hd], [0, 0], [0, 1], [1, 1], [1, 0]);
  quad([hw, eave - t, -hd], [hw, h - t, 0], [-hw, h - t, 0], [-hw, eave - t, -hd], [0, 0], [0, 1], [1, 1], [1, 0]);
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roof.computeVertexNormals();
  const gp: number[] = [], gu: number[] = [];
  const gtri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) => {
    gp.push(...a, ...b, ...c);
    gu.push(...ua, ...ub, ...uc);
  };
  gtri([gw, 0, gd], [gw, 0, -gd], [gw, h, 0], [0, 0], [d * uvs, 0], [gd * uvs, h * uvs]);
  gtri([-gw, 0, -gd], [-gw, 0, gd], [-gw, h, 0], [0, 0], [d * uvs, 0], [gd * uvs, h * uvs]);
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  gable.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
  gable.computeVertexNormals();
  return { roof, gable, gableH: h, eave, slopeLen, hw, hd };
}

/** Pyramid / hip roof over w x d with apex height h above the wall top, in stepped rows
 *  with rounded hip (and ridge) caps covering the seams. */
export function pyramidRoof(w: number, d: number, h: number, over = 0.1, uvs = 1, ridge = 0, style: RoofStyle = 'tile') {
  const gw = w / 2, gd = d / 2;
  const hw = gw + over, hd = gd + over;
  const eave = -over * h / Math.min(gw, gd);
  const r = ridge / 2;
  const S = ROOF[style];
  const pos: number[] = [], uv: number[] = [];
  const faces: number[][][] = [
    [[-hw, eave, hd], [hw, eave, hd], [r, h, 0], [-r, h, 0]],
    [[hw, eave, -hd], [-hw, eave, -hd], [-r, h, 0], [r, h, 0]],
    [[hw, eave, hd], [hw, eave, -hd], [r, h, 0], [r, h, 0]],
    [[-hw, eave, -hd], [-hw, eave, hd], [-r, h, 0], [-r, h, 0]],
  ];
  const lerp = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  faces.forEach((f, k) => {
    const base = Math.hypot(f[1][0] - f[0][0], f[1][2] - f[0][2]);
    const top = Math.hypot(f[2][0] - f[3][0], f[2][2] - f[3][2]);
    const sl = Math.hypot(h - eave, k < 2 ? hd : hw);
    const e1 = [f[1][0] - f[0][0], f[1][1] - f[0][1], f[1][2] - f[0][2]];
    const e2 = [f[3][0] - f[0][0], f[3][1] - f[0][1], f[3][2] - f[0][2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) * (ny < 0 ? -1 : 1);
    nx /= nl; ny /= nl; nz /= nl;
    const L = (p: number[]) => [p[0] + nx * S.lift, p[1] + ny * S.lift, p[2] + nz * S.lift];
    const n = S.rows ? Math.max(2, Math.round(sl * uvs * S.rows)) : 1;
    const U = (s: number, side: number) => (base / 2 + side * (base / 2 + (top / 2 - base / 2) * s)) * uvs;
    for (let j = 0; j < n; j++) {
      const s0 = j / n, s1 = (j + 1) / n;
      const v0 = S.rows ? j / S.rows : 0, v1 = S.rows ? (j + 1) / S.rows : sl * uvs;
      const A0 = lerp(f[0], f[3], s0), B0 = lerp(f[1], f[2], s0), A1 = lerp(f[0], f[3], s1), B1 = lerp(f[1], f[2], s1);
      pos.push(...L(A0), ...L(B0), ...B1, ...L(A0), ...B1, ...A1);
      uv.push(U(s0, -1), v0, U(s0, 1), v0, U(s1, 1), v1, U(s0, -1), v0, U(s1, 1), v1, U(s1, -1), v1);
      if (S.lift > 0) {
        pos.push(...A0, ...B0, ...L(B0), ...A0, ...L(B0), ...L(A0));
        uv.push(U(s0, -1), v0 + 0.004, U(s0, 1), v0 + 0.004, U(s0, 1), v0 + 0.02, U(s0, -1), v0 + 0.004, U(s0, 1), v0 + 0.02, U(s0, -1), v0 + 0.02);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  if (!S.rows) return g;
  const capR = style === 'thatch' ? 0.05 : 0.03;
  const caps: THREE.BufferGeometry[] = [g];
  const up = S.lift * 0.6;
  for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
    caps.push(rod(new THREE.Vector3(sx * hw, eave + up, sz * hd), new THREE.Vector3(sx * r, h + up, 0), capR));
  }
  if (r > 0.01) caps.push(rod(new THREE.Vector3(-r - capR, h + up, 0), new THREE.Vector3(r + capR, h + up, 0), capR * 1.2, 8));
  return mergeGeometries(caps, false) ?? g;
}

/** Conical roof in stepped rings (towers, windmill), smooth-shaded around the axis. */
export function coneRoof(r: number, h: number, seg = 24, uvs = 1, style: RoofStyle = 'tile') {
  const S = ROOF[style];
  const slant = Math.hypot(r, h);
  const n = Math.max(3, Math.round(slant * uvs * S.rows));
  const cols = Math.max(4, Math.round(Math.PI * 2 * r * uvs));
  const cr = h / slant, cy = r / slant; // outward cone normal (radial, up)
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const push = (rad: number, y: number, a: number, nr: number, ny: number, u: number, v: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * rad, y, s * rad);
    nrm.push(c * nr, ny, s * nr);
    uv.push(u, v);
  };
  for (let k = 0; k < n; k++) {
    const s0 = k / n, s1 = (k + 1) / n;
    const r0 = r * (1 - s0) + cr * S.lift, y0 = h * s0 + cy * S.lift;
    const r1 = r * (1 - s1), y1 = h * s1;
    // the row surface is a little steeper than the cone
    const tr = r1 - r0, ty = y1 - y0, tl = Math.hypot(tr, ty);
    const nr = ty / tl, ny = -tr / tl;
    const v0 = k / S.rows, v1 = (k + 1) / S.rows;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      const u0 = (j / seg) * cols, u1 = ((j + 1) / seg) * cols;
      // winding: outward facing (counter-clockwise seen from outside)
      push(r0, y0, a0, nr, ny, u0, v0); push(r1, y1, a1, nr, ny, u1, v1); push(r0, y0, a1, nr, ny, u1, v0);
      push(r0, y0, a0, nr, ny, u0, v0); push(r1, y1, a0, nr, ny, u0, v1); push(r1, y1, a1, nr, ny, u1, v1);
      // lip under the lifted edge
      const br = r * (1 - s0), by = h * s0;
      push(br, by, a0, cy, -cr, u0, v0 + 0.004); push(r0, y0, a1, cy, -cr, u1, v0 + 0.02); push(br, by, a1, cy, -cr, u1, v0 + 0.004);
      push(br, by, a0, cy, -cr, u0, v0 + 0.004); push(r0, y0, a0, cy, -cr, u0, v0 + 0.02); push(r0, y0, a1, cy, -cr, u1, v0 + 0.02);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Ridge covering along X centred at the origin: overlapping half-round tiles, or a fat
 *  bound roll for thatch. */
export function ridgeCap(len: number, style: RoofStyle = 'tile') {
  const parts: THREE.BufferGeometry[] = [];
  if (style === 'thatch') {
    // straw folded over the ridge: strands run around the roll, courses along it
    const r = 0.075;
    const g = new THREE.CylinderGeometry(r, r, len, 14, 1, false).toNonIndexed();
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * len * 1.2, uv.getX(i) * Math.PI * 2 * r * 1.2);
    g.rotateZ(Math.PI / 2);
    parts.push(g);
  } else {
    const pieces = Math.max(2, Math.round(len / 0.17));
    const pl = len / pieces;
    for (let i = 0; i < pieces; i++) {
      const g = new THREE.CylinderGeometry(0.05, 0.043, pl * 1.08, 10, 1, false).toNonIndexed();
      g.rotateZ(Math.PI / 2);
      g.translate(-len / 2 + pl * (i + 0.5), 0, 0);
      parts.push(g);
    }
  }
  return mergeGeometries(parts, false)!;
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
  let out = g.index ? g.toNonIndexed() : g;
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

export class ModelBuilder {
  parts = new Map<string, THREE.BufferGeometry[]>();
  movers: { name: string; builder: ModelBuilder; pos: THREE.Vector3; axis: 'x' | 'y' | 'z' }[] = [];
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
    const geo = normalizeGeo(g.clone());
    geo.applyMatrix4(this.tmpM);
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push(geo);
    this.merged = null;
    return this;
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

  /** Meshes for this model; the merged geometry is shared by every instance built from it. */
  build(materials: (key: string) => THREE.Material): THREE.Group {
    if (!this.merged) {
      this.merged = new Map();
      for (const [key, geos] of this.parts) {
        const merged = mergeGeometries(geos, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        this.merged.set(key, merged);
      }
    }
    const group = new THREE.Group();
    for (const [key, merged] of this.merged) {
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
