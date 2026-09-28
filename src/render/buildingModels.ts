// Procedural building models for every building type.
import * as THREE from 'three';
import type { BuildingType } from '../game/defs';
import { ModelBuilder, RoofStyle, box, cone, coneRoof, cyl, gableRoof, pyramidRoof, ridgeCap, sphere } from './geom';

type MB = ModelBuilder;

// ------------------------------------------------------------------ components
function foundation(mb: MB, w: number, d: number, x = 0, z = 0, h = 0.12, mat = 'stone') {
  mb.add(mat, box(w + 0.12, h + 0.5, d + 0.12, 1.2), x, h / 2 - 0.25, z);
}

function timberFrame(mb: MB, w: number, d: number, h: number, x: number, y: number, z: number, braces = true) {
  const t = 0.06, o = 0.012;
  const hw = w / 2, hd = d / 2;
  // corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.add('timber', box(t, h, t, 2), x + sx * (hw - t / 2 + o), y + h / 2, z + sz * (hd - t / 2 + o));
  // horizontal beams: top, mid
  for (const yy of [h - t / 2, h * 0.4]) {
    mb.add('timber', box(w + o * 2, t, t, 2), x, y + yy, z + hd + o - t / 2 + 0.01);
    mb.add('timber', box(w + o * 2, t, t, 2), x, y + yy, z - hd - o + t / 2 - 0.01);
    mb.add('timber', box(t, t, d + o * 2, 2), x + hw + o - t / 2 + 0.01, y + yy, z);
    mb.add('timber', box(t, t, d + o * 2, 2), x - hw - o + t / 2 - 0.01, y + yy, z);
  }
  // sill beam
  mb.add('timber', box(w + o * 2, t, t, 2), x, y + t / 2, z + hd + o - t / 2 + 0.01);
  if (braces) {
    // diagonal braces on the front upper half
    const bh = h * 0.58 - t;
    const len = Math.hypot(bh, 0.32);
    const ang = Math.atan2(bh, 0.32);
    for (const sx of [-1, 1]) {
      mb.add('timber', box(len, t * 0.8, t * 0.8, 2), x + sx * (hw - 0.2), y + h * 0.4 + bh / 2 + t / 2, z + hd + 0.015, 0, 0, sx * ang);
      mb.add('timber', box(len, t * 0.8, t * 0.8, 2), x + sx * (hw - 0.2), y + h * 0.4 + bh / 2 + t / 2, z - hd - 0.015, 0, 0, -sx * ang);
    }
    // side braces
    const sl = Math.hypot(bh, 0.3);
    const sa = Math.atan2(bh, 0.3);
    for (const sx of [-1, 1]) mb.add('timber', box(t * 0.8, t * 0.8, sl, 2), x + sx * (hw + 0.015), y + h * 0.4 + bh / 2 + t / 2, z, sa * sx, 0, 0);
  }
}

function door(mb: MB, x: number, y: number, z: number, w = 0.34, h = 0.56, face: 'z' | 'x' = 'z', arch = false) {
  const ry = face === 'z' ? 0 : Math.PI / 2;
  const off = (dx: number, dz: number): [number, number] => face === 'z' ? [x + dx, z + dz] : [x + dz, z - dx];
  let [px, pz] = off(0, 0.012);
  mb.add('planks', box(w, h, 0.04, 2.5), px, y + h / 2, pz, ry);
  // frame
  [px, pz] = off(-w / 2 - 0.03, 0.02);
  mb.add('timber', box(0.06, h + 0.05, 0.06), px, y + h / 2, pz, ry);
  [px, pz] = off(w / 2 + 0.03, 0.02);
  mb.add('timber', box(0.06, h + 0.05, 0.06), px, y + h / 2, pz, ry);
  [px, pz] = off(0, 0.02);
  mb.add('timber', box(w + 0.12, 0.07, 0.07), px, y + h + 0.03, pz, ry);
  if (arch) {
    [px, pz] = off(0, 0.012);
    mb.add('dark', new THREE.CylinderGeometry(w / 2, w / 2, 0.045, 12, 1, false, 0, Math.PI), px, y + h, pz, ry, Math.PI / 2, 0);
  }
  // handle
  [px, pz] = off(w * 0.3, 0.04);
  mb.add('iron', box(0.03, 0.03, 0.03), px, y + h * 0.5, pz, ry);
}

function win(mb: MB, x: number, y: number, z: number, face: 'z' | '-z' | 'x' | '-x', w = 0.2, h = 0.24) {
  const ry = face === 'z' ? 0 : face === '-z' ? Math.PI : face === 'x' ? Math.PI / 2 : -Math.PI / 2;
  const nx = face === 'x' ? 1 : face === '-x' ? -1 : 0, nz = face === 'z' ? 1 : face === '-z' ? -1 : 0;
  mb.add('window', box(w, h, 0.03), x + nx * 0.008, y, z + nz * 0.008, ry);
  // frame + cross
  mb.add('timber', box(w + 0.1, 0.04, 0.085), x + nx * 0.035, y - h / 2 - 0.022, z + nz * 0.035, ry);
  mb.add('timber', box(w + 0.06, 0.04, 0.05), x + nx * 0.02, y + h / 2 + 0.02, z + nz * 0.02, ry);
  mb.add('timber', box(0.022, h, 0.04), x + nx * 0.02, y, z + nz * 0.02, ry);
  mb.add('timber', box(w, 0.022, 0.04), x + nx * 0.02, y + h * 0.1, z + nz * 0.02, ry);
  // shutters
  const sx = face === 'z' || face === '-z' ? 1 : 0, sz = 1 - sx;
  mb.add('planks', box(w * 0.45, h + 0.02, 0.025, 3), x + sx * (w / 2 + w * 0.26) + nx * 0.02, y, z + sz * (w / 2 + w * 0.26) + nz * 0.02, ry);
  mb.add('planks', box(w * 0.45, h + 0.02, 0.025, 3), x - sx * (w / 2 + w * 0.26) + nx * 0.02, y, z - sz * (w / 2 + w * 0.26) + nz * 0.02, ry);
  mb.anchors.windows.push(new THREE.Vector3(x + nx * 0.3, y, z + nz * 0.3));
}

function chimney(mb: MB, x: number, y: number, z: number, h = 0.5, w = 0.17) {
  mb.add('stone', box(w, h, w, 3), x, y + h / 2, z);
  mb.add('stoneDark', box(w + 0.05, 0.05, w + 0.05), x, y + h, z);
  mb.anchors.chimneys.push(new THREE.Vector3(x, y + h + 0.05, z));
}

/** Dressed corner stones alternating between the two faces of each wall corner. */
function quoins(mb: MB, w: number, d: number, h: number, x: number, y: number, z: number, mat: string) {
  const n = Math.max(3, Math.round(h / 0.13));
  const bh = h / n;
  const p = 0.014; // how far they stand proud of the wall
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let k = 0; k < n; k++) {
      const long = (k + (sx * sz > 0 ? 0 : 1)) % 2 === 0;
      const lx = long ? 0.15 : 0.085, lz = long ? 0.085 : 0.15;
      const jit = (Math.sin(k * 12.9 + sx * 3.1 + sz * 7.7) * 0.5 + 0.5) * 0.02;
      mb.add(mat, box(lx + jit, bh - 0.012, lz + jit, 2.2),
        x + sx * (w / 2 - (lx + jit) / 2 + p), y + bh * (k + 0.5), z + sz * (d / 2 - (lz + jit) / 2 + p));
    }
  }
}

/** Timber bargeboards along the sloping verges of a tiled gable roof. */
function bargeboards(mb: MB, r: ReturnType<typeof gableRoof>, x: number, top: number, z: number) {
  const h = r.gableH, e = r.eave;
  const ang = Math.atan2(h - e, r.hd);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    mb.add('timber', box(0.035, 0.075, r.slopeLen + 0.03, 2), x + sx * (r.hw + 0.012), top + (h + e) / 2 - 0.02, z + sz * r.hd / 2, 0, sz * ang, 0);
  }
}

interface HouseOpts {
  w: number; d: number; wallH: number; roofH: number;
  x?: number; z?: number; y?: number;
  wall?: string; roof?: string; timber?: boolean; over?: number;
  doorX?: number | null; win?: number; sideWin?: boolean; chim?: number | null; floors?: number;
  hip?: boolean; braces?: boolean; noFoundation?: boolean;
}

function house(mb: MB, o: HouseOpts) {
  const x = o.x ?? 0, z = o.z ?? 0, y = o.y ?? 0;
  const wall = o.wall ?? 'plaster';
  const roof = o.roof ?? 'roofX';
  if (!o.noFoundation) foundation(mb, o.w, o.d, x, z);
  const base = y + 0.12;
  mb.add(wall, box(o.w, o.wallH, o.d, 1), x, base + o.wallH / 2, z);
  if (o.timber) timberFrame(mb, o.w, o.d, o.wallH, x, base, z, o.braces ?? true);
  else if (wall !== 'planks') quoins(mb, o.w, o.d, o.wallH, x, base, z, wall === 'stone' ? 'stoneDark' : 'stone');
  const top = base + o.wallH;
  const style: RoofStyle = roof === 'thatch' ? 'thatch' : 'tile';
  if (o.hip) {
    mb.add(roof, pyramidRoof(o.w, o.d, o.roofH, o.over ?? 0.12, 1.2, Math.max(0, o.w - o.d), style), x, top, z);
  } else {
    const over = o.over ?? 0.13;
    const r = gableRoof(o.w, o.d, o.roofH, over, 1.2, style);
    mb.add(roof, r.roof, x, top, z);
    mb.add(wall, r.gable, x, top, z);
    mb.add(roof, ridgeCap(o.w + over * 2 + 0.04, style), x, top + o.roofH + (style === 'thatch' ? 0.0 : 0.005), z);
    if (style === 'tile') bargeboards(mb, r, x, top, z);
    if (o.timber) {
      mb.add('timber', box(0.05, o.roofH * 0.9, 0.05), x + o.w / 2 + 0.012, top + o.roofH * 0.45, z);
      mb.add('timber', box(0.05, o.roofH * 0.9, 0.05), x - o.w / 2 - 0.012, top + o.roofH * 0.45, z);
    }
  }
  const floors = o.floors ?? 1;
  const doorX = o.doorX === undefined ? 0 : o.doorX;
  if (doorX !== null) door(mb, x + doorX, base, z + o.d / 2);
  const nWin = o.win ?? 1;
  for (let f = 0; f < floors; f++) {
    const wy = base + (floors === 1 ? o.wallH * 0.62 : f === 0 ? o.wallH * 0.3 : o.wallH * 0.74);
    // distribute windows across the facade, keeping clear of the door
    const slots: number[] = [];
    const n = f === 0 && doorX !== null ? nWin : Math.max(1, nWin);
    const span = o.w - 0.36;
    for (let k = 0; k < n; k++) slots.push(n === 1 ? 0 : -span / 2 + (span / (n - 1)) * k);
    for (let sx of slots) {
      if (f === 0 && doorX !== null && Math.abs(sx - doorX) < 0.34) {
        // push the window away from the door
        sx = doorX + (sx <= doorX ? -0.4 : 0.4);
        if (Math.abs(sx) > o.w / 2 - 0.16) continue;
      }
      win(mb, x + sx, wy, z + o.d / 2, 'z');
    }
    if (o.sideWin ?? true) {
      win(mb, x + o.w / 2, wy, z, 'x');
      win(mb, x - o.w / 2, wy, z, '-x');
    }
  }
  if (o.chim !== null && o.chim !== undefined) chimney(mb, x + o.chim, top + o.roofH * 0.35, z - o.d * 0.15);
  mb.anchors.top = Math.max(mb.anchors.top, top + o.roofH);
  return top;
}

function barrel(mb: MB, x: number, y: number, z: number, s = 1) {
  mb.add('wood', cyl(0.1 * s, 0.1 * s, 0.24 * s, 10, 3), x, y, z);
  mb.add('iron', cyl(0.105 * s, 0.105 * s, 0.025 * s, 10), x, y + 0.04 * s, z);
  mb.add('iron', cyl(0.105 * s, 0.105 * s, 0.025 * s, 10), x, y + 0.18 * s, z);
}

function crate(mb: MB, x: number, y: number, z: number, s = 0.22, ry = 0) {
  mb.add('planks', box(s, s, s, 4), x, y + s / 2, z, ry);
}

function logPile(mb: MB, x: number, y: number, z: number, n = 3, len = 0.7, ry = 0) {
  let k = 0;
  for (let row = 0; row < n; row++) {
    for (let i = 0; i < n - row; i++) {
      const off = (i - (n - row - 1) / 2) * 0.14;
      const c = Math.cos(ry), s = Math.sin(ry);
      mb.add('timber', cyl(0.065, 0.065, len, 8, 2), x + c * off - s * 0, y + 0.065 + row * 0.12, z - s * off, ry + Math.PI / 2, 0, Math.PI / 2);
      k++;
    }
  }
  void k;
}

function fence(mb: MB, pts: [number, number][], y = 0, h = 0.3) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bz - az, bx - ax);
    const posts = Math.max(1, Math.round(len / 0.35));
    for (let p = 0; p <= posts; p++) {
      const t = p / posts;
      mb.add('timber', box(0.04, h, 0.04), ax + (bx - ax) * t, y + h / 2, az + (bz - az) * t);
    }
    for (const yy of [h * 0.4, h * 0.85]) mb.add('wood', box(len, 0.03, 0.025), (ax + bx) / 2, y + yy, (az + bz) / 2, -ang);
  }
}

function flag(mb: MB, x: number, y: number, z: number, h = 1.0, owner = 0) {
  mb.add('timber', cyl(0.022, 0.028, h, 6), x, y, z);
  mb.add('gold', sphere(0.035, 8, 6), x, y + h + 0.02, z);
  const fg = new THREE.PlaneGeometry(0.46, 0.3, 8, 4);
  fg.translate(0.23, 0, 0);
  mb.add(`banner${owner}`, fg, x + 0.02, y + h - 0.17, z);
  mb.anchors.flags.push(new THREE.Vector3(x, y + h, z));
}

function crenels(mb: MB, w: number, d: number, y: number, x = 0, z = 0, mat = 'stone', size = 0.14) {
  const hw = w / 2, hd = d / 2;
  const nX = Math.max(2, Math.round(w / (size * 2))), nZ = Math.max(2, Math.round(d / (size * 2)));
  for (let i = 0; i < nX; i++) {
    const px = x - hw + (i + 0.5) * (w / nX);
    mb.add(mat, box(size, size * 1.2, size * 0.9, 3), px, y + size * 0.6, z + hd - size * 0.45);
    mb.add(mat, box(size, size * 1.2, size * 0.9, 3), px, y + size * 0.6, z - hd + size * 0.45);
  }
  for (let i = 0; i < nZ; i++) {
    const pz = z - hd + (i + 0.5) * (d / nZ);
    mb.add(mat, box(size * 0.9, size * 1.2, size, 3), x + hw - size * 0.45, y + size * 0.6, pz);
    mb.add(mat, box(size * 0.9, size * 1.2, size, 3), x - hw + size * 0.45, y + size * 0.6, pz);
  }
}

function roundTower(mb: MB, x: number, z: number, r: number, h: number, roofH: number, roof: string, crenel = false) {
  mb.add('stone', cyl(r * 0.92, r, h, 28, 1.2), x, 0, z);
  mb.add('stoneDark', cyl(r + 0.04, r + 0.06, 0.25, 28, 1.2), x, -0.12, z);
  // arrow slits
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    mb.add('dark', box(0.05, 0.22, 0.05), x + Math.sin(a) * r * 0.93, h * 0.6, z + Math.cos(a) * r * 0.93, a);
  }
  if (crenel) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      mb.add('stone', box(0.12, 0.14, 0.1, 3), x + Math.sin(a) * r * 0.9, h + 0.07, z + Math.cos(a) * r * 0.9, a);
    }
  }
  if (roofH > 0) {
    mb.add('stoneDark', cyl(r * 0.95, r * 0.93, 0.07, 28, 2), x, h - 0.07, z);
    mb.add(roof, coneRoof(r + 0.1, roofH, 28, 1.3), x, h, z);
    mb.add('gold', sphere(0.04, 8, 6), x, h + roofH, z);
  }
  mb.anchors.top = Math.max(mb.anchors.top, h + roofH);
}

function stoneBlocks(mb: MB, x: number, y: number, z: number) {
  mb.add('stone', box(0.22, 0.16, 0.18, 4), x, y + 0.08, z, 0.2);
  mb.add('stone', box(0.2, 0.15, 0.2, 4), x + 0.24, y + 0.075, z + 0.02, -0.1);
  mb.add('stone', box(0.2, 0.14, 0.18, 4), x + 0.12, y + 0.23, z + 0.01, 0.4);
}

function boulder(mb: MB, x: number, y: number, z: number, r: number, seed = 1) {
  const g = new THREE.DodecahedronGeometry(r, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = 0.8 + 0.35 * Math.abs(Math.sin(vx * 7 + seed) * Math.cos(vz * 5 + vy * 3));
    p.setXYZ(i, vx * n, vy * n * 0.8, vz * n);
  }
  g.computeVertexNormals();
  mb.add('rock', g, x, y, z);
}

function sailBlades(b: MB, n = 4, len = 1.35) {
  // hub
  b.add('timber', cyl(0.07, 0.07, 0.16, 8), 0, 0, 0.0, 0, Math.PI / 2, 0);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const sub = new ModelBuilder();
    sub.add('timber', box(0.05, len, 0.04), 0, len / 2, 0.08);
    // lattice sail
    sub.add('canvas', box(0.26, len * 0.78, 0.01), 0.15, len * 0.56, 0.1);
    for (let r = 0; r < 5; r++) sub.add('timber', box(0.3, 0.02, 0.02), 0.13, len * 0.2 + r * len * 0.18, 0.1);
    for (const [key, geos] of sub.parts) for (const g of geos) {
      const m = new THREE.Matrix4().makeRotationZ(a);
      b.add(key, g.clone().applyMatrix4(m));
    }
  }
}

function pigModel(b: MB, x: number, z: number, ry: number) {
  b.add('pig', sphere(0.11, 10, 8), x, 0.12, z, ry, 0, 0, 1);
  b.add('pig', sphere(0.07, 8, 6), x + Math.sin(ry) * 0.12, 0.13, z + Math.cos(ry) * 0.12);
  for (const [dx, dz] of [[-0.05, -0.06], [0.05, -0.06], [-0.05, 0.06], [0.05, 0.06]]) b.add('pig', box(0.03, 0.08, 0.03), x + dx, 0.04, z + dz);
}

/** A donkey standing in a paddock, facing `ry`. */
function donkeyModel(b: MB, x: number, z: number, ry: number) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + c * dx + s * dz, z - s * dx + c * dz];
  const body = sphere(0.15, 10, 8);
  body.scale(0.8, 0.75, 1.4);
  b.add('donkey', body, x, 0.36, z, ry);
  let [px, pz] = at(0, 0.2);
  b.add('donkey', cyl(0.05, 0.07, 0.26, 6), px, 0.4, pz, ry, -0.8, 0);
  [px, pz] = at(0, 0.34);
  const head = sphere(0.068, 8, 6);
  head.scale(0.8, 0.85, 1.5);
  b.add('donkey', head, px, 0.58, pz, ry);
  [px, pz] = at(0, 0.44);
  b.add('donkeyPale', sphere(0.045, 8, 6), px, 0.565, pz, ry);
  for (const sx of [-1, 1]) {
    [px, pz] = at(sx * 0.045, 0.29);
    b.add('donkey', cone(0.025, 0.13, 5), px, 0.63, pz, ry, -0.3, sx * 0.4);
  }
  [px, pz] = at(0, 0.18);
  b.add('dark', box(0.03, 0.05, 0.24), px, 0.58, pz, ry, -0.8, 0);
  [px, pz] = at(0, -0.24);
  b.add('dark', cyl(0.012, 0.016, 0.18, 5), px, 0.16, pz, ry);
  for (const [dx, dz] of [[-0.07, 0.12], [0.07, 0.12], [-0.07, -0.13], [0.07, -0.13]]) {
    [px, pz] = at(dx, dz);
    b.add('donkey', box(0.04, 0.3, 0.04), px, 0.15, pz, ry);
  }
}

/** Copy every part of a sub-model into `mb`, turned by `ry` and moved to (x, z). */
function placeSub(mb: MB, sub: MB, x: number, z: number, ry: number) {
  const m = new THREE.Matrix4().makeRotationY(ry);
  m.setPosition(x, 0, z);
  for (const [key, geos] of sub.parts) for (const g of geos) mb.add(key, g.clone().applyMatrix4(m));
}

/** A market stall: a counter under a striped awning, facing +z, with wares of kind `k`. */
function marketStall(owner: number, k: number): MB {
  const sub = new ModelBuilder();
  sub.add('planks', box(0.9, 0.42, 0.34, 3), 0, 0.21, 0.18);
  sub.add('timber', box(0.96, 0.04, 0.4, 2), 0, 0.44, 0.18);
  for (const [px, pz] of [[-0.44, 0.34], [0.44, 0.34], [-0.44, -0.3], [0.44, -0.3]]) sub.add('timber', box(0.05, pz > 0 ? 0.95 : 1.12, 0.05), px, pz > 0 ? 0.475 : 0.56, pz);
  // awning: alternating cloth strips sloping down towards the front, with a scalloped hem
  for (let i = 0; i < 5; i++) {
    const strip = box(0.196, 0.018, 0.78, 2);
    sub.add(i % 2 ? `trim${owner}` : 'canvas', strip, -0.392 + i * 0.196, 1.05, 0.03, 0, 0.26, 0);
    sub.add(i % 2 ? `trim${owner}` : 'canvas', new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8, 1, false, 0, Math.PI), -0.392 + i * 0.196, 0.94, 0.41, 0, 0, Math.PI);
  }
  sub.add('timber', box(1.0, 0.04, 0.04), 0, 0.96, 0.42);
  sub.add('timber', box(1.0, 0.04, 0.04), 0, 1.16, -0.32);
  // wares
  if (k === 0) {
    for (const [px, pz] of [[-0.3, 0.14], [-0.12, 0.2], [0.06, 0.12]]) sub.add('hay', sphere(0.075, 8, 6), px, 0.5, pz);
    sub.add('hay', sphere(0.075, 8, 6), -0.2, 0.62, 0.17);
    amphora(sub, 0.3, 0.44, 0.18, 0.55);
    for (const [px, pz] of [[-0.55, 0.5], [-0.3, 0.55]]) sub.add('hay', sphere(0.1, 8, 6), px, 0.08, pz);
  } else if (k === 1) {
    crate(sub, -0.28, 0.44, 0.16, 0.16, 0.2);
    crate(sub, -0.28, 0.6, 0.16, 0.13, -0.3);
    barrel(sub, 0.25, 0.44, 0.18, 0.7);
    for (let i = 0; i < 3; i++) sub.add('meat', sphere(0.05, 7, 5), -0.2 + i * 0.2, 0.86, 0.36, 0, 0, 0, 1);
    barrel(sub, 0.62, 0, 0.5, 0.9);
  } else {
    for (let i = 0; i < 4; i++) sub.add('planks', box(0.5, 0.03, 0.1, 3), 0.15, 0.455 + i * 0.032, 0.1 + (i % 2) * 0.1);
    for (const [px, pz] of [[-0.32, 0.14], [-0.18, 0.22], [-0.3, 0.26]]) sub.add('wood', sphere(0.045, 7, 5), px, 0.485, pz);
    for (let i = 0; i < 3; i++) sub.add('metal', box(0.04, 0.16, 0.015), -0.3 + i * 0.12, 0.84, 0.37);
    sub.add('wood', cyl(0.11, 0.11, 0.26, 10, 3), -0.62, 0.11, 0.55, 0, 0, Math.PI / 2);
  }
  return sub;
}

function amphora(mb: MB, x: number, y: number, z: number, s = 1, tilt = 0) {
  const prof = [[0.0, 0.0], [0.05, 0.02], [0.1, 0.09], [0.12, 0.18], [0.11, 0.27], [0.07, 0.34], [0.045, 0.38], [0.048, 0.43], [0.06, 0.44]]
    .map(([r, yy]) => new THREE.Vector2(r * s, yy * s));
  mb.add('terracotta', new THREE.LatheGeometry(prof, 12), x, y, z, 0, 0, tilt);
  for (const sx of [-1, 1]) mb.add('terracotta', new THREE.TorusGeometry(0.05 * s, 0.012 * s, 5, 8, Math.PI), x + sx * 0.065 * s, y + 0.34 * s, z, 0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
}

function column(mb: MB, x: number, y: number, z: number, h: number, r = 0.06, mat = 'marble') {
  mb.add(mat, box(r * 2.9, 0.05, r * 2.9, 3), x, y + 0.025, z);
  mb.add(mat, cyl(r * 0.88, r * 1.1, h - 0.11, 10, 2), x, y + 0.05, z);
  mb.add(mat, box(r * 3.1, 0.06, r * 3.1, 3), x, y + h - 0.03, z);
}

function brazier(mb: MB, x: number, z: number, h = 0.5) {
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    mb.add('iron', box(0.022, h, 0.022), x + Math.sin(a) * 0.06, h / 2, z + Math.cos(a) * 0.06, a, 0, 0.12 * (k === 0 ? 1 : -1));
  }
  mb.add('iron', cyl(0.11, 0.06, 0.08, 10), x, h, z);
  mb.add('glowHoly', cyl(0.09, 0.09, 0.02, 10), x, h + 0.065, z);
  mb.anchors.fires.push(new THREE.Vector3(x, h + 0.12, z));
}

function vineRow(mb: MB, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
  const posts = Math.max(2, Math.round(len / 0.45) + 1);
  for (let p = 0; p < posts; p++) {
    const t = p / (posts - 1);
    mb.add('timber', box(0.035, 0.5, 0.035), x0 + (x1 - x0) * t, 0.25, z0 + (z1 - z0) * t);
  }
  mb.add('iron', box(len, 0.008, 0.008), (x0 + x1) / 2, 0.42, (z0 + z1) / 2, -ang);
  const n = Math.round(len / 0.16);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
    const r = 0.085 + 0.03 * Math.abs(Math.sin(k * 3.7 + seed));
    mb.add('leaf', sphere(r, 7, 5), px, 0.36 + 0.04 * Math.sin(k * 2.3 + seed), pz, 0, 0, 0, 1);
    if ((k + seed) % 2 === 0) mb.add('grape', sphere(0.04, 6, 4), px + 0.06 * Math.sin(ang + 1.57), 0.3, pz + 0.06 * Math.cos(ang + 1.57));
  }
}

// ------------------------------------------------------------------ building designs
type Design = (mb: MB, owner: number) => void;

const designs: Partial<Record<BuildingType, Design>> = {
  woodcutter(mb) {
    house(mb, { w: 1.25, d: 1.0, wallH: 0.78, roofH: 0.55, x: -0.2, z: -0.12, timber: true, doorX: 0.3, win: 1, chim: -0.35 });
    // wood shed lean-to
    for (const [px, pz] of [[0.5, 0.1], [0.85, 0.1], [0.5, -0.5], [0.85, -0.5]]) mb.add('timber', box(0.05, 0.62, 0.05), px, 0.31, pz);
    mb.add('planks', box(0.46, 0.04, 0.78, 3), 0.67, 0.64, -0.2, 0, 0, -0.25);
    logPile(mb, 0.67, 0, -0.2, 3, 0.62, Math.PI / 2);
    // chopping block + axe
    mb.add('wood', cyl(0.1, 0.11, 0.16, 10, 3), -0.62, 0, 0.55);
    mb.add('timber', box(0.03, 0.3, 0.03), -0.62, 0.26, 0.55, 0, 0.3, 0.2);
    mb.add('metal', box(0.1, 0.07, 0.02), -0.58, 0.4, 0.58, 0, 0.3, 0.2);
    mb.anchors.piles.push(new THREE.Vector3(0.62, 0, 0.62));
  },
  forester(mb) {
    house(mb, { w: 1.15, d: 0.95, wallH: 0.7, roofH: 0.62, x: -0.25, z: -0.15, wall: 'planks', roof: 'thatch', timber: false, doorX: 0.25, win: 1, chim: null, over: 0.16 });
    fence(mb, [[0.2, 0.25], [0.85, 0.25], [0.85, 0.85], [0.2, 0.85]], 0, 0.22);
    mb.add('soil', box(0.6, 0.05, 0.55), 0.52, 0.02, 0.55);
    for (const [px, pz] of [[0.35, 0.4], [0.55, 0.45], [0.72, 0.4], [0.4, 0.7], [0.62, 0.72]]) {
      mb.add('timber', cyl(0.012, 0.015, 0.12, 5), px, 0.04, pz);
      mb.add('leaf', cone(0.07, 0.18, 7), px, 0.1, pz);
    }
    mb.add('metal', box(0.03, 0.34, 0.03), -0.72, 0.17, 0.5, 0, 0, 0.25);
    mb.add('metal', box(0.1, 0.12, 0.02), -0.78, 0.04, 0.5, 0, 0, 0.25);
  },
  stonecutter(mb) {
    house(mb, { w: 1.2, d: 1.0, wallH: 0.72, roofH: 0.52, x: -0.22, z: -0.15, wall: 'stone', doorX: 0.3, win: 1, chim: -0.3 });
    stoneBlocks(mb, 0.45, 0, 0.45);
    boulder(mb, 0.7, 0.05, -0.35, 0.22, 3);
    mb.add('planks', box(0.4, 0.05, 0.25, 3), -0.6, 0.3, 0.6);
    for (const px of [-0.76, -0.44]) mb.add('timber', box(0.04, 0.3, 0.2), px, 0.15, 0.6);
    mb.anchors.piles.push(new THREE.Vector3(0.62, 0, 0.62));
  },
  sawmill(mb) {
    house(mb, { w: 1.8, d: 1.3, wallH: 0.92, roofH: 0.7, x: -0.35, z: -0.35, timber: true, doorX: 0.0, win: 2, chim: -0.5 });
    // open saw shed
    for (const [px, pz] of [[0.72, 0.5], [1.22, 0.5], [0.72, -0.2], [1.22, -0.2]]) mb.add('timber', box(0.06, 0.8, 0.06), px, 0.4, pz);
    const r = gableRoof(0.6, 0.8, 0.3, 0.08, 1.2);
    mb.add('roofX', r.roof, 0.97, 0.8, 0.15, Math.PI / 2);
    mb.add('planks', box(0.5, 0.3, 0.3, 3), 0.97, 0.15, 0.15);
    const saw = mb.mover('saw', 0.97, 0.36, 0.15, 'x');
    saw.add('metal', new THREE.CylinderGeometry(0.17, 0.17, 0.012, 20), 0, 0, 0, 0, 0, Math.PI / 2);
    saw.add('iron', cyl(0.03, 0.03, 0.03, 8), -0.015, 0, 0, 0, 0, Math.PI / 2);
    logPile(mb, -0.3, 0, 0.7, 3, 0.8, 0);
    mb.anchors.piles.push(new THREE.Vector3(1.0, 0, 0.9));
  },
  storehouse(mb, owner) {
    foundation(mb, 2.4, 1.5, 0, -0.3);
    mb.add('stone', box(2.4, 0.45, 1.5, 1), 0, 0.12 + 0.225, -0.3);
    mb.add('plaster', box(2.36, 0.6, 1.46, 1), 0, 0.57 + 0.3, -0.3);
    timberFrame(mb, 2.36, 1.46, 0.6, 0, 0.57, -0.3, false);
    const r = gableRoof(2.4, 1.5, 0.8, 0.15, 1.2);
    mb.add(`roof${owner}`, r.roof, 0, 1.17, -0.3);
    mb.add('plaster', r.gable, 0, 1.17, -0.3);
    mb.add('planks', box(0.62, 0.72, 0.05, 2), 0, 0.12 + 0.36, 0.46);
    mb.add('timber', box(0.72, 0.08, 0.08), 0, 0.88, 0.47);
    mb.add('timber', box(0.04, 0.72, 0.03), 0, 0.48, 0.49);
    for (const sx of [-0.8, 0.8]) win(mb, sx, 0.85, 0.45, 'z', 0.24, 0.22);
    // hoist beam
    mb.add('timber', box(0.06, 0.06, 0.5), 1.28, 1.25, -0.3, 0, 0, 0);
    mb.add('iron', box(0.01, 0.4, 0.01), 1.28, 1.05, -0.08);
    for (const [px, pz] of [[-1.05, 0.7], [-0.8, 0.75], [1.0, 0.72]]) barrel(mb, px, 0, pz);
    crate(mb, 0.72, 0, 0.72, 0.24, 0.3);
    crate(mb, 0.72, 0.24, 0.72, 0.2, -0.2);
    mb.anchors.top = 2.1;
  },
  residence_s(mb) {
    house(mb, { w: 1.15, d: 1.05, wallH: 1.25, roofH: 0.6, x: -0.1, z: -0.15, timber: true, doorX: 0.3, win: 2, floors: 2, chim: 0.3 });
    for (const px of [-0.5, 0.22]) {
      mb.add('planks', box(0.24, 0.06, 0.07), px - 0.1 + 0.02, 0.98, 0.42);
      for (let k = 0; k < 3; k++) mb.add('trim0', sphere(0.028, 6, 4), px - 0.18 + k * 0.07, 1.03, 0.43);
    }
    barrel(mb, 0.6, 0, 0.6, 0.9);
  },
  residence_m(mb) {
    house(mb, { w: 1.6, d: 1.15, wallH: 1.25, roofH: 0.66, x: -0.4, z: -0.4, timber: true, doorX: 0.35, win: 2, floors: 2, chim: -0.5 });
    house(mb, { w: 0.95, d: 1.0, wallH: 0.9, roofH: 0.5, x: 0.85, z: 0.25, wall: 'plasterWarm', doorX: null, win: 1, chim: null });
    // well
    mb.add('stone', cyl(0.18, 0.2, 0.25, 12, 3, true), -0.7, 0, 0.75);
    mb.add('water', new THREE.CircleGeometry(0.17, 12), -0.7, 0.2, 0.75, 0, -Math.PI / 2, 0);
    mb.add('timber', box(0.04, 0.45, 0.04), -0.88, 0.22, 0.75);
    mb.add('timber', box(0.04, 0.45, 0.04), -0.52, 0.22, 0.75);
    mb.add('timber', box(0.44, 0.04, 0.04), -0.7, 0.45, 0.75);
  },
  residence_l(mb, owner) {
    house(mb, { w: 2.6, d: 1.4, wallH: 1.35, roofH: 0.75, x: -0.1, z: -0.55, timber: false, wall: 'plasterWarm', doorX: 0.5, win: 4, floors: 2, chim: -0.7, hip: true });
    // tower
    mb.add('plasterWarm', box(0.75, 2.2, 0.75, 1), -1.25, 0.12 + 1.1, 0.45);
    mb.add(`roof${owner}`, pyramidRoof(0.75, 0.75, 0.6, 0.1, 1.2), -1.25, 2.32, 0.45);
    win(mb, -1.25, 1.7, 0.83, 'z');
    win(mb, -1.25, 0.9, 0.83, 'z');
    foundation(mb, 0.75, 0.75, -1.25, 0.45);
    // arcade
    for (let k = 0; k < 5; k++) mb.add('plaster', cyl(0.05, 0.06, 0.7, 8), -0.6 + k * 0.45, 0.12, 0.35);
    mb.add(`roof${owner}`, box(2.1, 0.06, 0.5), 0.3, 0.86, 0.3, 0, 0.18, 0);
    fence(mb, [[0.6, 1.4], [1.5, 1.4], [1.5, 0.6]], 0, 0.2);
    for (const [px, pz] of [[0.9, 1.0], [1.2, 1.1]]) { mb.add('leaf', sphere(0.14, 8, 6), px, 0.14, pz); }
    flag(mb, -1.25, 2.9, 0.45, 0.5, owner);
    mb.anchors.top = 3.4;
  },
  fisher(mb) {
    house(mb, { w: 1.05, d: 0.95, wallH: 0.68, roofH: 0.55, x: -0.3, z: -0.2, wall: 'planks', roof: 'thatch', doorX: 0.2, win: 1, chim: null, over: 0.15 });
    // drying rack
    for (const px of [0.35, 0.95]) mb.add('timber', box(0.04, 0.55, 0.04), px, 0.27, 0.35);
    mb.add('timber', box(0.66, 0.03, 0.03), 0.65, 0.52, 0.35);
    for (let k = 0; k < 4; k++) mb.add('metal', box(0.04, 0.14, 0.015), 0.44 + k * 0.14, 0.42, 0.35);
    // net
    for (let k = 0; k < 5; k++) mb.add('dark', box(0.005, 0.35, 0.005), 0.4 + k * 0.1, 0.25, -0.4);
    for (let k = 0; k < 4; k++) mb.add('dark', box(0.45, 0.005, 0.005), 0.6, 0.1 + k * 0.09, -0.4);
    // upturned boat
    const hull = new THREE.CylinderGeometry(0.16, 0.16, 0.8, 10, 1, true, 0, Math.PI);
    mb.add('planks', hull, -0.5, 0.02, 0.62, Math.PI / 2, 0, Math.PI / 2);
    mb.anchors.piles.push(new THREE.Vector3(0.6, 0, 0.75));
  },
  hunter(mb) {
    house(mb, { w: 1.15, d: 0.95, wallH: 0.72, roofH: 0.55, x: -0.2, z: -0.15, wall: 'planks', timber: false, doorX: 0.3, win: 1, chim: -0.3 });
    // antlers on gable
    for (const s of [-1, 1]) {
      mb.add('plasterWarm', box(0.02, 0.18, 0.02), -0.2 + s * 0.07, 1.15, 0.36, 0, 0, s * 0.5);
      mb.add('plasterWarm', box(0.02, 0.1, 0.02), -0.2 + s * 0.13, 1.21, 0.36, 0, 0, s * 1.1);
    }
    // pelt frame
    mb.add('timber', box(0.04, 0.5, 0.04), 0.55, 0.25, 0.55);
    mb.add('timber', box(0.04, 0.5, 0.04), 0.95, 0.25, 0.55);
    mb.add('timber', box(0.44, 0.04, 0.04), 0.75, 0.5, 0.55);
    mb.add('soil', box(0.34, 0.32, 0.01), 0.75, 0.32, 0.55);
    mb.anchors.piles.push(new THREE.Vector3(-0.6, 0, 0.65));
  },
  farm(mb, owner) {
    house(mb, { w: 1.5, d: 1.1, wallH: 0.9, roofH: 0.6, x: -0.9, z: -0.8, timber: true, doorX: 0.3, win: 2, chim: -0.4 });
    // barn
    foundation(mb, 1.7, 1.4, 0.75, -0.6);
    mb.add('planks', box(1.7, 1.0, 1.4, 1), 0.75, 0.12 + 0.5, -0.6);
    const r = gableRoof(1.4, 1.7, 0.85, 0.12, 1.2);
    mb.add(`roof${owner}`, r.roof, 0.75, 1.12, -0.6, Math.PI / 2);
    mb.add('planks', r.gable, 0.75, 1.12, -0.6, Math.PI / 2);
    mb.add('dark', box(0.6, 0.7, 0.03), 0.75, 0.47, 0.11);
    mb.add('timber', box(0.04, 0.7, 0.04), 0.75, 0.47, 0.125);
    mb.add('timber', box(0.6, 0.04, 0.04), 0.75, 0.47, 0.13, 0, 0, 0.9);
    mb.add('timber', box(0.6, 0.04, 0.04), 0.75, 0.47, 0.13, 0, 0, -0.9);
    // hay stack & cart
    mb.add('hay', sphere(0.32, 10, 8, Math.PI * 2, Math.PI / 2), -1.2, 0, 0.7);
    mb.add('hay', cone(0.3, 0.3, 10), -1.2, 0.2, 0.7);
    mb.add('planks', box(0.5, 0.12, 0.34, 3), 0.9, 0.2, 0.9);
    for (const sx of [-1, 1]) mb.add('timber', new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), 0.9, 0.12, 0.9 + sx * 0.18, 0, Math.PI / 2, 0);
    mb.anchors.piles.push(new THREE.Vector3(0.2, 0, 1.2));
  },
  mill(mb, owner) {
    foundation(mb, 1.3, 1.3, 0, -0.1, 0.12);
    mb.add('stone', cyl(0.5, 0.66, 1.9, 32, 1.2), 0, 0.1, -0.1);
    mb.add(`roof${owner}`, coneRoof(0.62, 0.7, 32, 1.4), 0, 2.0, -0.1);
    mb.add('timber', cyl(0.62, 0.62, 0.08, 32), 0, 1.96, -0.1);
    door(mb, 0, 0.12, 0.52, 0.32, 0.55, 'z', true);
    win(mb, 0, 1.1, 0.46, 'z', 0.16, 0.2);
    win(mb, 0.5, 0.8, -0.1, 'x', 0.16, 0.2);
    win(mb, -0.5, 1.3, -0.1, '-x', 0.16, 0.2);
    mb.add('timber', box(0.12, 0.12, 0.5), 0, 2.2, 0.35);
    const blades = mb.mover('blades', 0, 2.2, 0.62, 'z');
    sailBlades(blades, 4, 1.25);
    // sacks
    for (const [px, pz] of [[0.75, 0.65], [0.95, 0.55]]) mb.add('hay', sphere(0.12, 8, 6), px, 0.1, pz);
    mb.anchors.piles.push(new THREE.Vector3(-0.8, 0, 0.8));
    mb.anchors.top = 3.4;
  },
  bakery(mb) {
    house(mb, { w: 1.6, d: 1.2, wallH: 0.9, roofH: 0.62, x: -0.45, z: -0.35, wall: 'plasterWarm', timber: true, doorX: 0.2, win: 2, chim: 0.5 });
    // oven
    mb.add('stone', sphere(0.46, 14, 10, Math.PI * 2, Math.PI / 2), 0.85, 0.1, -0.1);
    mb.add('stone', box(0.9, 0.12, 0.9, 2), 0.85, 0.06, -0.1);
    mb.add('glowFire', new THREE.CircleGeometry(0.13, 10, 0, Math.PI), 0.85, 0.12, 0.345, 0, 0, 0);
    mb.anchors.fires.push(new THREE.Vector3(0.85, 0.2, 0.5));
    chimney(mb, 0.85, 0.4, -0.35, 0.55, 0.14);
    // bread sign
    mb.add('timber', box(0.03, 0.03, 0.26), -0.25, 0.95, 0.4);
    mb.add('wood', box(0.2, 0.14, 0.02), -0.25, 0.85, 0.5);
    mb.add('hay', sphere(0.05, 8, 6), -0.25, 0.85, 0.52, 0, 0, 0, 1);
    mb.anchors.piles.push(new THREE.Vector3(-1.0, 0, 0.8));
  },
  waterworks(mb) {
    house(mb, { w: 0.95, d: 0.85, wallH: 0.66, roofH: 0.5, x: -0.4, z: -0.35, wall: 'stone', doorX: 0.15, win: 1, chim: null });
    mb.add('stone', cyl(0.22, 0.25, 0.3, 14, 3, true), 0.5, 0, 0.3);
    mb.add('stone', new THREE.RingGeometry(0.16, 0.24, 14), 0.5, 0.3, 0.3, 0, -Math.PI / 2, 0);
    mb.add('water', new THREE.CircleGeometry(0.19, 14), 0.5, 0.25, 0.3, 0, -Math.PI / 2, 0);
    for (const s of [-1, 1]) mb.add('timber', box(0.05, 0.6, 0.05), 0.5 + s * 0.25, 0.3, 0.3);
    const r = gableRoof(0.6, 0.35, 0.22, 0.06, 1.2);
    mb.add('roofX', r.roof, 0.5, 0.62, 0.3);
    const winch = mb.mover('winch', 0.5, 0.5, 0.3, 'x');
    winch.add('wood', cyl(0.05, 0.05, 0.46, 8), -0.23, 0, 0, 0, 0, -Math.PI / 2);
    winch.add('iron', box(0.02, 0.12, 0.02), 0.24, -0.05, 0);
    barrel(mb, 0.85, 0, -0.2);
    mb.anchors.piles.push(new THREE.Vector3(-0.8, 0, 0.6));
  },
  pigfarm(mb, owner) {
    house(mb, { w: 1.8, d: 1.0, wallH: 0.8, roofH: 0.55, x: -0.2, z: -1.0, wall: 'planks', timber: true, doorX: -0.4, win: 2, chim: 0.5, roof: `roof${owner}` });
    fence(mb, [[-1.5, -0.3], [1.5, -0.3], [1.5, 1.3], [0.7, 1.3]], 0, 0.28);
    fence(mb, [[0.3, 1.3], [-1.5, 1.3], [-1.5, -0.3]], 0, 0.28);
    mb.add('soil', box(2.9, 0.03, 1.5), 0, 0.015, 0.5);
    mb.add('wood', box(0.7, 0.1, 0.16, 3), -0.9, 0.05, 0.1);
    const pigs = mb.mover('pigs', 0, 0, 0, 'y');
    pigModel(pigs, 0.5, 0.5, 0.6);
    pigModel(pigs, -0.4, 0.8, 2.4);
    pigModel(pigs, 0.9, 0.2, 4.0);
    pigModel(pigs, -0.9, 0.4, 1.2);
    mb.anchors.piles.push(new THREE.Vector3(1.4, 0, 1.55));
  },
  slaughter(mb) {
    house(mb, { w: 1.6, d: 1.2, wallH: 0.9, roofH: 0.6, x: -0.35, z: -0.35, timber: true, doorX: 0.2, win: 2, chim: -0.5 });
    for (const px of [0.7, 1.2]) mb.add('timber', box(0.05, 0.7, 0.05), px, 0.35, 0.45);
    mb.add('timber', box(0.6, 0.04, 0.04), 0.95, 0.68, 0.45);
    for (let k = 0; k < 3; k++) mb.add('meat', sphere(0.07, 8, 6), 0.8 + k * 0.15, 0.52, 0.45, 0, 0, 0, 1);
    mb.add('wood', box(0.4, 0.3, 0.3, 3), -0.9, 0.15, 0.6);
    mb.anchors.piles.push(new THREE.Vector3(1.0, 0, 1.0));
  },
  ironsmelter(mb, owner) {
    house(mb, { w: 1.5, d: 1.2, wallH: 0.9, roofH: 0.55, x: -0.45, z: -0.35, wall: 'stone', doorX: 0.2, win: 1, chim: null, roof: `roof${owner}` });
    chimney(mb, 0.65, 0.1, -0.5, 2.2, 0.3);
    mb.add('stoneDark', box(0.75, 0.75, 0.75, 2), 0.72, 0.12 + 0.37, 0.15);
    mb.add('glowFire', box(0.25, 0.2, 0.02), 0.72, 0.35, 0.53);
    mb.anchors.fires.push(new THREE.Vector3(0.72, 0.35, 0.65));
    mb.add('ironore', sphere(0.2, 8, 6, Math.PI * 2, Math.PI / 2), -1.0, 0, 0.7);
    mb.anchors.piles.push(new THREE.Vector3(0.1, 0, 0.95));
  },
  goldsmelter(mb, owner) {
    house(mb, { w: 1.5, d: 1.2, wallH: 0.9, roofH: 0.55, x: -0.45, z: -0.35, wall: 'sandstone', doorX: 0.2, win: 1, chim: null, roof: `roof${owner}` });
    chimney(mb, 0.65, 0.1, -0.5, 2.0, 0.26);
    mb.add('stone', box(0.7, 0.6, 0.7, 2), 0.72, 0.12 + 0.3, 0.15);
    mb.add('glowGold', box(0.24, 0.18, 0.02), 0.72, 0.3, 0.51);
    mb.add('gold', box(0.3, 0.04, 0.02), -0.45, 1.0, 0.27);
    mb.anchors.fires.push(new THREE.Vector3(0.72, 0.3, 0.62));
    mb.anchors.piles.push(new THREE.Vector3(0.1, 0, 0.95));
  },
  toolsmith(mb) {
    house(mb, { w: 1.6, d: 1.15, wallH: 0.88, roofH: 0.6, x: -0.45, z: -0.4, timber: true, doorX: -0.1, win: 1, chim: -0.7 });
    // forge lean-to
    for (const [px, pz] of [[0.5, 0.45], [1.2, 0.45]]) mb.add('timber', box(0.06, 0.75, 0.06), px, 0.37, pz);
    mb.add('roofX', box(0.8, 0.05, 1.0, 1.2), 0.85, 0.76, 0.0, 0, 0, -0.2);
    mb.add('stone', box(0.45, 0.4, 0.4, 2), 1.0, 0.2, -0.2);
    mb.add('glowFire', box(0.3, 0.02, 0.28), 1.0, 0.41, -0.2);
    mb.anchors.fires.push(new THREE.Vector3(1.0, 0.45, -0.2));
    chimney(mb, 1.0, 0.4, -0.3, 0.9, 0.16);
    // anvil
    mb.add('wood', cyl(0.08, 0.09, 0.2, 8), 0.6, 0, 0.2);
    mb.add('iron', box(0.24, 0.08, 0.1), 0.6, 0.24, 0.2);
    // tool rack
    mb.add('timber', box(0.5, 0.04, 0.04), -0.45, 0.75, 0.2);
    for (let k = 0; k < 4; k++) mb.add('metal', box(0.02, 0.24, 0.02), -0.62 + k * 0.12, 0.6, 0.21);
    mb.anchors.piles.push(new THREE.Vector3(-0.9, 0, 0.75));
  },
  weaponsmith(mb, owner) {
    house(mb, { w: 1.6, d: 1.15, wallH: 0.88, roofH: 0.6, x: -0.45, z: -0.4, wall: 'stone', timber: false, doorX: -0.1, win: 1, chim: -0.7, roof: `roof${owner}` });
    for (const [px, pz] of [[0.5, 0.45], [1.2, 0.45]]) mb.add('timber', box(0.06, 0.75, 0.06), px, 0.37, pz);
    mb.add('roofX', box(0.8, 0.05, 1.0, 1.2), 0.85, 0.76, 0.0, 0, 0, -0.2);
    mb.add('stone', box(0.45, 0.4, 0.4, 2), 1.0, 0.2, -0.2);
    mb.add('glowFire', box(0.3, 0.02, 0.28), 1.0, 0.41, -0.2);
    mb.anchors.fires.push(new THREE.Vector3(1.0, 0.45, -0.2));
    chimney(mb, 1.0, 0.4, -0.3, 0.9, 0.16);
    mb.add('iron', box(0.24, 0.08, 0.1), 0.6, 0.24, 0.2);
    mb.add('wood', cyl(0.08, 0.09, 0.2, 8), 0.6, 0, 0.2);
    // shields on wall
    for (const px of [-0.8, -0.1]) {
      mb.add(`trim${owner}`, new THREE.CylinderGeometry(0.12, 0.12, 0.03, 12), px, 0.62, 0.2, 0, Math.PI / 2, 0);
      mb.add('metal', sphere(0.03, 6, 4), px, 0.62, 0.22);
    }
    // swords rack
    for (let k = 0; k < 3; k++) mb.add('metal', box(0.025, 0.36, 0.01), 0.35 + k * 0.08, 0.2, 0.62, 0, 0, 0.1);
    mb.anchors.piles.push(new THREE.Vector3(-0.9, 0, 0.75));
  },
  vineyard(mb, owner) {
    house(mb, { w: 1.5, d: 1.1, wallH: 0.85, roofH: 0.55, x: -0.5, z: -0.55, wall: 'plasterWarm', timber: true, doorX: 0.25, win: 2, chim: null, roof: `roof${owner}` });
    // cellar door on the side
    mb.add('stoneDark', box(0.4, 0.2, 0.3, 3), -1.42, 0.1, -0.4, 0, 0, 0.35);
    mb.add('planks', box(0.36, 0.02, 0.26, 3), -1.39, 0.2, -0.4, 0, 0, 0.35);
    // wine press
    const px = 0.72, pz = 0.5;
    mb.add('wood', cyl(0.27, 0.3, 0.24, 14, 3), px, 0, pz);
    for (const yy of [0.05, 0.18]) mb.add('iron', cyl(0.285, 0.305, 0.025, 14), px, yy, pz);
    mb.add('wine', cyl(0.25, 0.25, 0.01, 14), px, 0.22, pz);
    mb.add('timber', cyl(0.24, 0.24, 0.05, 12), px, 0.3, pz);
    mb.add('iron', cyl(0.035, 0.035, 0.6, 8), px, 0.3, pz);
    for (const sx of [-1, 1]) mb.add('timber', box(0.07, 0.95, 0.07), px + sx * 0.36, 0.47, pz);
    mb.add('timber', box(0.84, 0.08, 0.09), px, 0.92, pz);
    mb.add('timber', box(0.04, 0.04, 0.5), px, 0.72, pz, 0.4);
    // barrels
    barrel(mb, 1.15, 0, -0.05, 1.1);
    barrel(mb, 1.15, 0, -0.35, 1.1);
    mb.add('wood', cyl(0.11, 0.11, 0.26, 10, 3), 1.05, 0.11, 0.9, 0, 0, Math.PI / 2);
    mb.add('wood', cyl(0.11, 0.11, 0.26, 10, 3), 1.05, 0.11, 1.14, 0, 0, Math.PI / 2);
    // a few showcase vines
    vineRow(mb, -1.3, 0.35, -1.3, 1.25, 1);
    vineRow(mb, -0.85, 0.45, -0.85, 1.25, 2);
    amphora(mb, 0.3, 0, 0.95, 0.9);
    amphora(mb, 0.1, 0, 1.08, 0.85, 0.2);
    mb.anchors.piles.push(new THREE.Vector3(0.45, 0, 1.25));
  },
  temple(mb, owner) {
    foundation(mb, 2.36, 1.96, 0, -0.15, 0.14, 'marbleDark');
    mb.add('marble', box(2.2, 0.12, 1.8, 1.2), 0, 0.2, -0.15);
    // steps
    [[0.26, 0.85], [0.17, 1.05], [0.09, 1.25]].forEach(([hh, zz]) => mb.add('marbleDark', box(1.25, hh, 0.2, 1.5), 0, hh / 2, zz));
    const y0 = 0.26;
    // cella
    mb.add('marble', box(1.25, 1.0, 1.1, 1.2), 0, y0 + 0.5, -0.3);
    mb.add('dark', box(0.38, 0.64, 0.03), 0, y0 + 0.32, 0.26);
    mb.add('dark', new THREE.CylinderGeometry(0.19, 0.19, 0.03, 12, 1, false, 0, Math.PI), 0, y0 + 0.64, 0.26, 0, Math.PI / 2, 0);
    mb.add('gold', box(0.46, 0.04, 0.05), 0, y0 + 0.86, 0.27);
    // peristyle
    const ch = 1.05;
    for (const cx of [-0.95, -0.57, -0.19, 0.19, 0.57, 0.95]) { column(mb, cx, y0, 0.58, ch); column(mb, cx, y0, -0.95, ch); }
    for (const cz of [-0.57, -0.19, 0.2]) { column(mb, -0.95, y0, cz, ch); column(mb, 0.95, y0, cz, ch); }
    const y1 = y0 + ch;
    mb.add('marble', box(2.14, 0.1, 1.74, 1.2), 0, y1 + 0.05, -0.19);
    mb.add(`trim${owner}`, box(2.16, 0.06, 1.76), 0, y1 + 0.13, -0.19);
    mb.add('marble', box(2.2, 0.04, 1.8, 1.2), 0, y1 + 0.18, -0.19);
    const r = gableRoof(1.8, 2.2, 0.42, 0.05, 1.2);
    mb.add(`roof${owner}`, r.roof, 0, y1 + 0.2, -0.19, Math.PI / 2);
    mb.add('marble', r.gable, 0, y1 + 0.2, -0.19, Math.PI / 2);
    // golden sun on the pediment and acroteria
    mb.add('glowHoly', new THREE.CircleGeometry(0.09, 16), 0, y1 + 0.34, 0.715);
    for (const zz of [0.74, -1.12]) {
      mb.add('gold', cone(0.06, 0.16, 8), 0, y1 + 0.6, zz);
      for (const sx of [-1, 1]) mb.add('gold', sphere(0.045, 8, 6), sx * 1.08, y1 + 0.24, zz);
    }
    brazier(mb, -0.78, 1.1, 0.46);
    brazier(mb, 0.78, 1.1, 0.46);
    amphora(mb, -1.25, 0, 0.95, 0.8);
    amphora(mb, -1.12, 0, 1.18, 0.75, -0.15);
    mb.anchors.piles.push(new THREE.Vector3(1.2, 0, 1.2));
    mb.anchors.top = y1 + 0.8;
  },
  greattemple(mb, owner) {
    mb.add('marbleDark', cyl(1.9, 1.95, 0.5, 32, 1.2), 0, -0.36, -0.15);
    mb.add('marble', cyl(1.7, 1.75, 0.12, 32, 1.2), 0, 0.14, -0.15);
    mb.add('marble', cyl(1.5, 1.55, 0.1, 32, 1.2), 0, 0.26, -0.15);
    const y0 = 0.36, cz = -0.15;
    // portico platform and steps
    mb.add('marble', box(1.7, 0.86, 1.0, 1.2), 0, y0 - 0.43, 1.25);
    [[0.27, 1.85], [0.18, 2.03], [0.09, 2.21]].forEach(([hh, zz]) => mb.add('marbleDark', box(1.3, hh, 0.19, 1.5), 0, hh / 2, zz));
    // drum
    mb.add('marble', cyl(0.95, 0.95, 1.36, 28, 1.2), 0, y0, cz);
    mb.add('dark', box(0.42, 0.78, 0.03), 0, y0 + 0.39, cz + 0.955);
    mb.add('dark', new THREE.CylinderGeometry(0.21, 0.21, 0.03, 12, 1, false, 0, Math.PI), 0, y0 + 0.78, cz + 0.955, 0, Math.PI / 2, 0);
    // colonnade
    const ch = 1.22;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (Math.cos(a) > 0.8) continue; // the portico takes the front
      column(mb, Math.sin(a) * 1.3, y0, cz + Math.cos(a) * 1.3, ch, 0.065);
    }
    mb.add('marble', cyl(1.43, 1.43, 0.12, 32, 1.2), 0, y0 + ch, cz);
    mb.add(`trim${owner}`, cyl(1.44, 1.44, 0.05, 32), 0, y0 + ch + 0.12, cz);
    mb.add('marble', cyl(1.46, 1.46, 0.04, 32, 1.2), 0, y0 + ch + 0.17, cz);
    // upper drum with clerestory windows
    const yd = y0 + ch + 0.2;
    mb.add('marble', cyl(1.0, 1.0, 0.42, 28, 1.2), 0, yd, cz);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      mb.add('window', box(0.1, 0.2, 0.03), Math.sin(a) * 1.005, yd + 0.21, cz + Math.cos(a) * 1.005, a);
      mb.anchors.windows.push(new THREE.Vector3(Math.sin(a) * 1.2, yd + 0.21, cz + Math.cos(a) * 1.2));
    }
    // dome with golden ribs
    const yDome = yd + 0.42;
    const dome = sphere(1.02, 28, 14, Math.PI * 2, Math.PI / 2);
    const duv = dome.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < duv.count; i++) duv.setXY(i, duv.getX(i) * 6.4 * 1.2, duv.getY(i) * 3.2 * 1.2);
    mb.add(`roof${owner}`, dome, 0, yDome, cz);
    for (let k = 0; k < 8; k++) {
      const rib = new THREE.TorusGeometry(1.035, 0.022, 4, 18, Math.PI / 2);
      mb.add('gold', rib, 0, yDome, cz, (k / 8) * Math.PI * 2, 0, 0);
    }
    mb.add('gold', cyl(1.04, 1.04, 0.05, 28), 0, yDome - 0.02, cz);
    // lantern with a glowing crystal
    const yl = yDome + 0.98;
    mb.add('marble', cyl(0.22, 0.24, 0.06, 12), 0, yl, cz);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      mb.add('marble', cyl(0.02, 0.02, 0.28, 6), Math.sin(a) * 0.17, yl + 0.06, cz + Math.cos(a) * 0.17);
    }
    mb.add('glowHoly', new THREE.OctahedronGeometry(0.09, 0), 0, yl + 0.2, cz);
    mb.add(`roof${owner}`, coneRoof(0.25, 0.26, 16, 1.2), 0, yl + 0.34, cz);
    mb.add('gold', sphere(0.05, 8, 6), 0, yl + 0.63, cz);
    // portico
    for (const px of [-0.6, -0.2, 0.2, 0.6]) column(mb, px, y0, 1.6, ch, 0.06);
    mb.add('marble', box(1.56, 0.12, 0.95, 1.2), 0, y0 + ch + 0.06, 1.28);
    mb.add(`trim${owner}`, box(1.58, 0.05, 0.97), 0, y0 + ch + 0.14, 1.28);
    const r = gableRoof(1.0, 1.62, 0.4, 0.04, 1.2);
    mb.add(`roof${owner}`, r.roof, 0, y0 + ch + 0.17, 1.28, Math.PI / 2);
    mb.add('marble', r.gable, 0, y0 + ch + 0.17, 1.28, Math.PI / 2);
    mb.add('glowHoly', new THREE.CircleGeometry(0.09, 16), 0, y0 + ch + 0.3, 1.79);
    mb.add('gold', cone(0.06, 0.16, 8), 0, y0 + ch + 0.57, 1.8);
    brazier(mb, -0.95, 1.9, 0.5);
    brazier(mb, 0.95, 1.9, 0.5);
    brazier(mb, -1.62, -1.25, 0.5);
    brazier(mb, 1.62, -1.25, 0.5);
    amphora(mb, 1.45, 0, 1.2, 0.85);
    amphora(mb, 1.62, 0, 0.98, 0.8, 0.2);
    mb.anchors.piles.push(new THREE.Vector3(-1.5, 0, 1.4));
    mb.anchors.top = yl + 0.7;
  },
  harbour(mb, owner) {
    // warehouse: stone ground floor, timbered loft with a hoist
    house(mb, { w: 1.9, d: 1.2, wallH: 1.25, roofH: 0.7, x: -0.3, z: -0.45, wall: 'stone', timber: false, doorX: 0.1, win: 2, floors: 2, chim: -0.55, roof: `roof${owner}` });
    mb.add('planks', box(0.5, 0.42, 0.05, 2), 0.35, 1.02, 0.17);
    mb.add('timber', box(0.06, 0.06, 0.55), 0.35, 1.5, 0.3);
    mb.add('rope', box(0.01, 0.42, 0.01), 0.35, 1.26, 0.55);
    crate(mb, 0.28, 0.82, 0.5, 0.16, 0.2);
    // beacon tower
    const tx = 1.0, tz = -0.75, th = 2.1;
    foundation(mb, 0.62, 0.62, tx, tz);
    mb.add('stone', cyl(0.25, 0.3, th, 16, 1.2), tx, 0.1, tz);
    mb.add('stoneDark', cyl(0.33, 0.33, 0.08, 16, 1.2), tx, th + 0.05, tz);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      mb.add('iron', box(0.025, 0.28, 0.025), tx + Math.sin(a) * 0.22, th + 0.27, tz + Math.cos(a) * 0.22);
    }
    mb.add('glowGold', cyl(0.14, 0.14, 0.22, 12), tx, th + 0.14, tz);
    mb.anchors.fires.push(new THREE.Vector3(tx, th + 0.26, tz));
    mb.add(`roof${owner}`, coneRoof(0.3, 0.32, 16, 1.2), tx, th + 0.42, tz);
    mb.add('dark', box(0.05, 0.2, 0.05), tx, 1.2, tz + 0.29);
    flag(mb, tx, th + 0.74, tz, 0.5, owner);
    mb.anchors.soldiers.push(new THREE.Vector3(tx, th + 0.1, tz + 0.3));
    // crane on the quay
    const crane = mb.mover('crane', -1.12, 0, 0.72, 'y');
    crane.add('timber', box(0.09, 1.3, 0.09, 2), 0, 0.65, 0);
    crane.add('timber', box(0.07, 0.07, 1.0, 2), 0, 1.28, 0.38, 0, -0.35, 0);
    crane.add('timber', box(0.05, 0.05, 0.62, 2), 0, 0.98, 0.2, 0, 0.55, 0);
    crane.add('rope', box(0.012, 0.6, 0.012), 0, 1.15, 0.84);
    crane.add('planks', box(0.18, 0.14, 0.18, 4), 0, 0.8, 0.84);
    crane.add('wood', cyl(0.13, 0.13, 0.08, 10), 0, 0.16, 0, 0, 0, Math.PI / 2);
    // cargo waiting on the quay
    for (const [px, pz] of [[0.75, 0.55], [0.95, 0.35], [0.6, 0.85]]) barrel(mb, px, 0, pz);
    crate(mb, -0.55, 0, 0.75, 0.24, 0.3);
    crate(mb, -0.7, 0.24, 0.72, 0.18, -0.2);
    crate(mb, -0.35, 0, 0.95, 0.2, 0.9);
    mb.add('rope', new THREE.TorusGeometry(0.1, 0.03, 6, 14), 1.25, 0.03, 0.9, 0, Math.PI / 2, 0);
    // an anchor leaning on the wall
    mb.add('iron', box(0.035, 0.46, 0.035), -1.28, 0.25, -0.05, 0, 0, 0.12);
    mb.add('iron', new THREE.TorusGeometry(0.14, 0.02, 5, 12, Math.PI), -1.25, 0.08, -0.05, 0, 0, Math.PI);
    mb.anchors.piles.push(new THREE.Vector3(-1.0, 0, 1.1));
    mb.anchors.top = th + 1.2;
  },
  shipyard(mb) {
    house(mb, { w: 1.15, d: 0.95, wallH: 0.8, roofH: 0.55, x: -0.8, z: -0.8, timber: true, doorX: 0.2, win: 1, chim: -0.3 });
    // open timber shed with boards stacked under it
    for (const [px, pz] of [[0.25, -0.2], [1.2, -0.2], [0.25, -1.05], [1.2, -1.05]]) mb.add('timber', box(0.07, 0.9, 0.07), px, 0.45, pz);
    const r = gableRoof(1.1, 1.0, 0.35, 0.1, 1.2, 'thatch');
    mb.add('thatch', r.roof, 0.72, 0.9, -0.62);
    mb.add('thatch', ridgeCap(1.3, 'thatch'), 0.72, 1.25, -0.62);
    for (let k = 0; k < 6; k++) mb.add('planks', box(0.8, 0.03, 0.12, 3), 0.72, 0.05 + k * 0.032, -0.75 + (k % 2) * 0.13);
    logPile(mb, 0.72, 0, -0.35, 2, 0.8, 0);
    // sawhorse with a plank
    for (const sx of [-1, 1]) mb.add('timber', box(0.04, 0.26, 0.2), -0.1 + sx * 0.3, 0.13, 0.55);
    mb.add('planks', box(0.9, 0.035, 0.14, 3), -0.1, 0.28, 0.55);
    // tar pot over a fire
    mb.add('stoneDark', cyl(0.16, 0.18, 0.1, 10), -1.05, 0, 0.55);
    mb.add('iron', cyl(0.12, 0.1, 0.16, 12), -1.05, 0.12, 0.55);
    mb.add('dark', cyl(0.11, 0.11, 0.01, 12), -1.05, 0.275, 0.55);
    mb.add('glowFire', box(0.12, 0.05, 0.12), -1.05, 0.1, 0.55);
    mb.anchors.fires.push(new THREE.Vector3(-1.05, 0.2, 0.55));
    mb.anchors.chimneys.push(new THREE.Vector3(-1.05, 0.3, 0.55));
    // steamed ribs leaning against the workshop
    for (let k = 0; k < 3; k++) mb.add('timber', new THREE.TorusGeometry(0.34, 0.02, 4, 10, Math.PI * 0.7), -0.25 + k * 0.1, 0.05, -0.28, 0, 0.2, Math.PI * 0.62);
    mb.anchors.piles.push(new THREE.Vector3(0.9, 0, 0.75));
    mb.anchors.top = 1.6;
  },
  market(mb, owner) {
    // a cobbled square ringed by stalls, with the market cross and the weighing scales in the middle
    mb.add('cobble', box(2.8, 0.07, 2.8, 1), 0, 0.035, 0);
    mb.add('stoneDark', box(2.9, 0.05, 2.9, 1.2), 0, 0.0, 0);
    placeSub(mb, marketStall(owner, 0), -0.05, -0.95, 0);
    placeSub(mb, marketStall(owner, 1), -1.0, 0.05, Math.PI / 2);
    placeSub(mb, marketStall(owner, 2), 1.0, -0.05, -Math.PI / 2);
    // market cross
    mb.add('stone', box(0.5, 0.14, 0.5, 3), 0.1, 0.14, 0.2);
    mb.add('stoneDark', box(0.32, 0.12, 0.32, 3), 0.1, 0.27, 0.2);
    flag(mb, 0.1, 0.33, 0.2, 1.35, owner);
    mb.add('gold', sphere(0.05, 8, 6), 0.1, 1.72, 0.2);
    // scales: a post, a beam and two pans on chains
    const sx = -0.45, sz = 0.7;
    mb.add('iron', cyl(0.05, 0.07, 0.04, 8), sx, 0.07, sz);
    mb.add('iron', cyl(0.02, 0.025, 0.62, 6), sx, 0.1, sz);
    mb.add('iron', box(0.56, 0.025, 0.025), sx, 0.72, sz, 0, 0, 0.06);
    for (const s of [-1, 1]) {
      mb.add('iron', box(0.006, 0.22, 0.006), sx + s * 0.26, 0.6 + s * 0.017, sz + 0.03);
      mb.add('iron', box(0.006, 0.22, 0.006), sx + s * 0.26, 0.6 + s * 0.017, sz - 0.03);
      mb.add('metal', cyl(0.075, 0.05, 0.03, 10), sx + s * 0.26, 0.47 + s * 0.017, sz);
    }
    mb.add('hay', sphere(0.05, 7, 5), sx + 0.26, 0.52, sz);
    // goods waiting at the gate: a cart of sacks, crates and barrels
    mb.add('planks', box(0.55, 0.14, 0.36, 3), 0.85, 0.24, 0.85, 0.3);
    for (const s of [-1, 1]) mb.add('timber', new THREE.CylinderGeometry(0.11, 0.11, 0.035, 10), 0.85 + Math.sin(0.3) * s * 0.2, 0.13, 0.85 + Math.cos(0.3) * s * 0.2, 0.3, Math.PI / 2, 0);
    mb.add('timber', box(0.04, 0.04, 0.5), 0.85 - Math.sin(0.3) * 0.45, 0.2, 0.85 - Math.cos(0.3) * 0.45, 0.3, 0, -0.35);
    for (const [px, pz] of [[0.78, 0.8], [0.92, 0.9], [0.85, 0.72]]) mb.add('hay', sphere(0.08, 8, 6), px, 0.36, pz);
    crate(mb, -1.05, 0, 1.0, 0.22, 0.2);
    crate(mb, -1.05, 0.22, 1.0, 0.17, -0.4);
    barrel(mb, -0.75, 0, 1.12, 0.9);
    mb.anchors.piles.push(new THREE.Vector3(0.45, 0, 1.15));
    mb.anchors.top = 1.9;
  },
  donkeyfarm(mb, owner) {
    // a thatched stable and a fenced paddock with a trough, hay and the herd
    house(mb, { w: 1.5, d: 1.05, wallH: 0.85, roofH: 0.62, x: -0.65, z: -0.75, wall: 'planks', roof: 'thatch', timber: true, doorX: 0.3, win: 1, chim: null, over: 0.16 });
    // hay loft door and a hoist beam on the gable
    mb.add('dark', box(0.3, 0.26, 0.03), -0.65, 1.1, -0.22);
    mb.add('timber', box(0.05, 0.05, 0.36), -0.65, 1.3, -0.1);
    mb.add('rope', box(0.01, 0.28, 0.01), -0.65, 1.15, 0.07);
    fence(mb, [[-1.35, -0.1], [-1.35, 1.35], [1.35, 1.35], [1.35, -1.35], [0.35, -1.35]], 0, 0.3);
    fence(mb, [[0.2, -0.15], [1.35, -0.15]], 0, 0.3);
    mb.add('soil', box(2.6, 0.03, 1.3), 0, 0.015, 0.7);
    mb.add('soil', box(1.1, 0.03, 1.2), 0.8, 0.015, -0.7);
    // trough and a water pail
    mb.add('wood', box(0.7, 0.16, 0.24, 3), 0.5, 0.08, 1.05);
    mb.add('water', box(0.62, 0.02, 0.17), 0.5, 0.15, 1.05);
    mb.add('iron', cyl(0.08, 0.07, 0.14, 8), 1.05, 0, 0.95);
    mb.add('water', new THREE.CircleGeometry(0.07, 8), 1.05, 0.13, 0.95, 0, -Math.PI / 2, 0);
    // hay: a rick and loose bundles
    mb.add('hay', sphere(0.28, 10, 8, Math.PI * 2, Math.PI / 2), -0.95, 0, 0.9);
    mb.add('hay', cone(0.26, 0.26, 10), -0.95, 0.18, 0.9);
    for (const [px, pz] of [[-0.5, 0.45], [-0.3, 0.55]]) mb.add('hay', sphere(0.09, 8, 6), px, 0.07, pz);
    // sacks of grain by the door
    for (const [px, pz] of [[-0.2, -0.2], [-0.05, -0.28]]) mb.add('hay', sphere(0.09, 8, 6), px, 0.08, pz);
    const herd = mb.mover('donkeys', 0, 0, 0, 'y');
    donkeyModel(herd, 0.55, 0.45, 2.4);
    donkeyModel(herd, 0.95, -0.75, 0.6);
    donkeyModel(herd, -0.15, 0.95, 4.2);
    mb.anchors.piles.push(new THREE.Vector3(1.05, 0, -1.15));
    mb.anchors.top = 1.8;
  },
  siegeworks(mb, owner) {
    // a timber shed with the engineer's forge, a catapult taking shape in the yard, wheels against
    // the wall and a stack of stones waiting to be thrown
    house(mb, { w: 1.7, d: 1.15, wallH: 0.95, roofH: 0.6, x: -0.55, z: -0.6, wall: 'planks', roof: `roof${owner}`, timber: true, doorX: 0.25, win: 1, chim: 0.55, over: 0.18 });
    // lean-to over the yard
    for (const [px, pz] of [[0.35, -1.2], [1.3, -1.2], [1.3, 0.1]]) mb.add('timber', box(0.07, 1.05, 0.07), px, 0.525, pz);
    mb.add('planks', box(1.15, 0.05, 1.45, 2), 0.82, 1.2, -0.55, 0, 0.12, 0);
    mb.add('timber', box(1.2, 0.06, 0.06), 0.82, 1.08, -1.2);
    mb.add('timber', box(1.2, 0.06, 0.06), 0.82, 1.24, 0.1);
    mb.add('soil', box(1.3, 0.03, 1.5), 0.82, 0.015, -0.5);
    // the catapult under construction: chassis on trestles, A-frame up, arm still on the ground
    mb.add('timber', box(0.07, 0.08, 0.85), 0.62, 0.34, -0.55);
    mb.add('timber', box(0.07, 0.08, 0.85), 1.02, 0.34, -0.55);
    for (const pz of [-0.9, -0.2]) mb.add('timber', box(0.5, 0.06, 0.07), 0.82, 0.34, pz);
    for (const pz of [-0.85, -0.25]) { mb.add('dark', box(0.05, 0.3, 0.05), 0.62, 0.15, pz); mb.add('dark', box(0.05, 0.3, 0.05), 1.02, 0.15, pz); }
    for (const px of [0.62, 1.02]) { mb.add('timber', box(0.06, 0.5, 0.06), px, 0.6, -0.45); mb.add('timber', box(0.05, 0.45, 0.05), px, 0.58, -0.25, 0, -0.55, 0); }
    mb.add('timber', box(0.52, 0.06, 0.08), 0.82, 0.86, -0.45);
    mb.add('timber', box(0.06, 0.06, 0.95), 0.82, 0.05, 0.55, 0, 0, 0.0);
    mb.add('rope', cyl(0.05, 0.05, 0.42, 8), 0.82, 0.48, -0.5, 0, 0, Math.PI / 2);
    // wheels leaning on the shed, one on the bench
    for (const [px, pz, ry] of [[-0.1, 0.25, 0.25], [0.12, 0.3, -0.2]]) mb.add('dark', new THREE.TorusGeometry(0.16, 0.03, 6, 14), px, 0.19, pz, ry, 0, 0.35);
    mb.add('planks', box(0.7, 0.06, 0.4, 2), -0.6, 0.5, 0.65);
    for (const px of [-0.9, -0.3]) mb.add('timber', box(0.05, 0.5, 0.05), px, 0.25, 0.65);
    mb.add('dark', new THREE.TorusGeometry(0.16, 0.03, 6, 14), -0.6, 0.56, 0.65, 0, Math.PI / 2, 0);
    mb.add('iron', box(0.16, 0.12, 0.3), -0.85, 0.56, 0.75);
    // stones stacked for the machines
    for (const [px, pz, r] of [[1.25, 0.75, 0.13], [1.0, 0.85, 0.12], [1.15, 1.0, 0.11], [0.85, 1.05, 0.1], [1.12, 0.88, 0.1]]) {
      mb.add('stone', new THREE.DodecahedronGeometry(r, 0), px, r * 0.85 + (px === 1.12 ? 0.2 : 0), pz, px * 3, pz * 2, 0);
    }
    fence(mb, [[0.35, -1.35], [1.4, -1.35], [1.4, 0.4]], 0, 0.28);
    flag(mb, -1.3, 0, -1.25, 1.3, owner);
    mb.anchors.fires.push(new THREE.Vector3(-1.0, 0.45, -0.3));
    mb.anchors.piles.push(new THREE.Vector3(-0.2, 0, 1.15));
    mb.anchors.top = 1.9;
  },
  barracks(mb, owner) {
    house(mb, { w: 2.3, d: 1.2, wallH: 0.95, roofH: 0.6, x: -0.1, z: -0.45, wall: 'stone', doorX: 0.0, win: 3, chim: 0.8, roof: `roof${owner}` });
    flag(mb, -1.35, 0, 0.35, 1.5, owner);
    flag(mb, 1.15, 0, 0.35, 1.5, owner);
    // training dummies
    for (const px of [-0.8, 0.8]) {
      mb.add('timber', box(0.04, 0.5, 0.04), px, 0.25, 0.75);
      mb.add('timber', box(0.3, 0.04, 0.04), px, 0.4, 0.75);
      mb.add('hay', sphere(0.08, 8, 6), px, 0.56, 0.75);
    }
  },
  tower_s(mb, owner) {
    foundation(mb, 1.15, 1.15, 0, -0.05, 0.12);
    mb.add('stone', box(1.05, 1.9, 1.05, 1.2), 0, 0.12 + 0.95, -0.05);
    mb.add('stoneDark', box(1.15, 0.1, 1.15, 1.2), 0, 2.07, -0.05);
    crenels(mb, 1.15, 1.15, 2.12, 0, -0.05);
    door(mb, 0.1, 0.12, 0.475, 0.3, 0.55, 'z', true);
    for (const y of [1.0, 1.6]) mb.add('dark', box(0.06, 0.2, 0.03), -0.25, y, 0.48);
    mb.add('dark', box(0.03, 0.2, 0.06), 0.53, 1.4, -0.05);
    flag(mb, 0.35, 2.12, -0.35, 0.8, owner);
    mb.anchors.soldiers.push(new THREE.Vector3(-0.2, 2.14, 0.2));
    mb.anchors.top = 2.9;
  },
  tower_l(mb, owner) {
    foundation(mb, 1.8, 1.8, 0, -0.1, 0.12);
    mb.add('stone', box(1.7, 1.1, 1.7, 1.2), 0, 0.12 + 0.55, -0.1);
    mb.add('stone', box(1.3, 1.5, 1.3, 1.2), 0, 1.22 + 0.75, -0.1);
    // timber gallery
    mb.add('planks', box(1.6, 0.08, 1.6, 2), 0, 2.76, -0.1);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.add('timber', box(0.06, 0.5, 0.06), sx * 0.75, 3.02, -0.1 + sz * 0.75);
    fence(mb, [[-0.78, 0.68], [0.78, 0.68], [0.78, -0.88], [-0.78, -0.88], [-0.78, 0.68]], 2.8, 0.22);
    mb.add(`roof${owner}`, pyramidRoof(1.5, 1.5, 0.75, 0.12, 1.2), 0, 3.27, -0.1);
    mb.add('timber', box(1.64, 0.06, 1.64, 1), 0, 3.25, -0.1);
    crenels(mb, 1.72, 1.72, 1.22, 0, -0.1);
    door(mb, 0, 0.12, 0.75, 0.34, 0.6, 'z', true);
    for (const y of [1.6, 2.2]) { mb.add('dark', box(0.07, 0.22, 0.03), -0.3, y, 0.56); mb.add('dark', box(0.07, 0.22, 0.03), 0.3, y, 0.56); }
    flag(mb, 0, 4.0, -0.1, 0.7, owner);
    mb.anchors.soldiers.push(new THREE.Vector3(0.4, 2.8, 0.4), new THREE.Vector3(-0.4, 2.8, 0.4));
    mb.anchors.top = 4.8;
  },
  castle(mb, owner) {
    const S = 3.4, T = 0.28, H = 1.15;
    const hs = S / 2;
    // curtain walls
    mb.add('stone', box(S, H, T, 1.2), 0, 0.12 + H / 2, -hs);
    mb.add('stone', box(T, H, S, 1.2), -hs, 0.12 + H / 2, 0);
    mb.add('stone', box(T, H, S, 1.2), hs, 0.12 + H / 2, 0);
    mb.add('stone', box(S * 0.36, H, T, 1.2), -S * 0.32, 0.12 + H / 2, hs);
    mb.add('stone', box(S * 0.36, H, T, 1.2), S * 0.32, 0.12 + H / 2, hs);
    foundation(mb, S, S, 0, 0, 0.12, 'stoneDark');
    crenels(mb, S, S, H + 0.12, 0, 0, 'stone', 0.13);
    // gatehouse
    mb.add('stone', box(1.05, 1.5, 0.5, 1.2), 0, 0.12 + 0.75, hs);
    mb.add('dark', box(0.5, 0.7, 0.52), 0, 0.12 + 0.35, hs);
    mb.add('dark', new THREE.CylinderGeometry(0.25, 0.25, 0.52, 12, 1, false, 0, Math.PI), 0, 0.82, hs, 0, Math.PI / 2, Math.PI / 2);
    for (let k = 0; k < 5; k++) mb.add('iron', box(0.02, 0.62, 0.02), -0.2 + k * 0.1, 0.5, hs + 0.26);
    crenels(mb, 1.05, 0.5, 1.62, 0, hs);
    // corner towers
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) roundTower(mb, sx * hs, sz * hs, 0.46, 1.75, 0.8, `roof${owner}`);
    // keep
    mb.add('stone', box(1.5, 2.4, 1.4, 1.2), 0, 0.12 + 1.2, -0.55);
    crenels(mb, 1.5, 1.4, 2.52, 0, -0.55);
    for (const y of [1.4, 2.0]) for (const px of [-0.4, 0.4]) win(mb, px, y, 0.155, 'z', 0.16, 0.22);
    flag(mb, 0, 2.6, -0.55, 1.0, owner);
    flag(mb, -hs, 2.55, -hs, 0.6, owner);
    flag(mb, hs, 2.55, -hs, 0.6, owner);
    // courtyard
    mb.add('cobble', box(S - T * 2, 0.02, S - T * 2, 1), 0, 0.13, 0);
    mb.anchors.soldiers.push(new THREE.Vector3(-0.5, 1.28, hs), new THREE.Vector3(0.5, 1.28, hs), new THREE.Vector3(-hs, 1.28, 0.3), new THREE.Vector3(hs, 1.28, 0.3));
    mb.anchors.top = 3.8;
  },
  hq(mb, owner) {
    designs.castle!(mb, owner);
    // grand hall roof on keep
    mb.add(`roof${owner}`, pyramidRoof(1.3, 1.2, 0.9, 0.1, 1.2), 0, 2.6, -0.55);
    for (const [px, pz] of [[-1.0, 0.6], [-0.7, 0.8], [1.0, 0.7]]) barrel(mb, px, 0.12, pz);
    crate(mb, 0.75, 0.12, 0.4, 0.26, 0.3);
    mb.anchors.top = 4.0;
  },
};

function mineDesign(kind: 'coal' | 'iron' | 'gold' | 'stone'): Design {
  const oreMat = kind === 'coal' ? 'coal' : kind === 'iron' ? 'ironore' : kind === 'gold' ? 'goldore' : 'stone';
  return (mb) => {
    // rocky mound
    const g = new THREE.SphereGeometry(1.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.85 + 0.25 * Math.sin(x * 4.1 + z * 2.3) * Math.cos(z * 3.7 - y * 2);
      p.setXYZ(i, x * n, y * 0.75 * n, z * n * 0.9);
    }
    g.computeVertexNormals();
    mb.add('rock', g, 0, -0.35, -0.35);
    boulder(mb, -0.95, 0.0, 0.25, 0.28, 7);
    boulder(mb, 1.0, 0.0, -0.1, 0.32, 3);
    // portal
    for (const s of [-1, 1]) mb.add('timber', box(0.09, 0.8, 0.09), s * 0.3, 0.4, 0.62);
    mb.add('timber', box(0.8, 0.1, 0.12), 0, 0.82, 0.62);
    mb.add('timber', box(0.7, 0.07, 0.1), 0, 0.72, 0.64, 0, 0, 0.05);
    mb.add('dark', box(0.52, 0.72, 0.5), 0, 0.36, 0.42);
    mb.add('planks', box(0.9, 0.05, 0.7, 2), 0, 0.88, 0.45, 0, 0.25, 0);
    // rails + cart
    for (const s of [-1, 1]) mb.add('iron', box(0.02, 0.02, 1.0), s * 0.12, 0.02, 1.0);
    for (let k = 0; k < 5; k++) mb.add('timber', box(0.36, 0.02, 0.05), 0, 0.01, 0.6 + k * 0.2);
    mb.add('planks', box(0.3, 0.16, 0.36, 3), 0, 0.14, 1.15);
    mb.add(oreMat, sphere(0.14, 8, 6, Math.PI * 2, Math.PI / 2), 0, 0.2, 1.15);
    for (const s of [-1, 1]) for (const zz of [1.02, 1.28]) mb.add('iron', new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8), s * 0.16, 0.05, zz, 0, 0, Math.PI / 2);
    // lamp
    mb.add('timber', box(0.03, 0.5, 0.03), 0.45, 0.25, 0.75);
    mb.add('glowFire', box(0.07, 0.09, 0.07), 0.45, 0.52, 0.75);
    mb.anchors.fires.push(new THREE.Vector3(0.45, 0.55, 0.8));
    mb.anchors.windows.push(new THREE.Vector3(0.45, 0.55, 0.9));
    mb.anchors.piles.push(new THREE.Vector3(-0.7, 0, 1.0));
    mb.anchors.top = 1.2;
  };
}
designs.coalmine = mineDesign('coal');
designs.ironmine = mineDesign('iron');
designs.goldmine = mineDesign('gold');
designs.stonemine = mineDesign('stone');

export interface BuiltModel {
  group: THREE.Group;
  anchors: ModelBuilder['anchors'];
  height: number;
  parts: Map<string, THREE.BufferGeometry[]>;
}

const cache = new Map<string, { mb: ModelBuilder }>();

export function buildingBuilder(type: BuildingType, owner: number): ModelBuilder {
  const key = `${type}:${owner}`;
  let c = cache.get(key);
  if (!c) {
    const mb = new ModelBuilder();
    const d = designs[type] ?? designs.woodcutter!;
    d(mb, owner);
    // roofX -> player roof
    const rx = mb.parts.get('roofX');
    if (rx) {
      mb.parts.delete('roofX');
      const arr = mb.parts.get(`roof${owner}`) ?? [];
      arr.push(...rx);
      mb.parts.set(`roof${owner}`, arr);
    }
    for (const m of mb.movers) {
      const r = m.builder.parts.get('roofX');
      if (r) { m.builder.parts.delete('roofX'); m.builder.parts.set(`roof${owner}`, r); }
    }
    c = { mb };
    cache.set(key, c);
  }
  return c.mb;
}
