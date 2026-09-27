// Procedural building models for every building type.
import * as THREE from 'three';
import type { BuildingType } from '../game/defs';
import { ModelBuilder, box, cone, cyl, gableRoof, pyramidRoof, sphere } from './geom';

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
  mb.add('timber', box(w + 0.06, 0.045, 0.05), x + nx * 0.02, y - h / 2 - 0.02, z + nz * 0.02, ry);
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
  const top = base + o.wallH;
  if (o.hip) {
    mb.add(roof, pyramidRoof(o.w, o.d, o.roofH, o.over ?? 0.12, 1.2, Math.max(0, o.w - o.d)), x, top, z);
  } else {
    const r = gableRoof(o.w, o.d, o.roofH, o.over ?? 0.13, 1.2);
    mb.add(roof, r.roof, x, top, z);
    mb.add(wall, r.gable, x, top, z);
    // ridge cap
    mb.add(roof, cyl(0.045, 0.045, o.w + (o.over ?? 0.13) * 2 + 0.02, 6), x - o.w / 2 - (o.over ?? 0.13) - 0.01, top + o.roofH - 0.01, z, 0, 0, -Math.PI / 2);
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
  mb.add('stone', cyl(r * 0.92, r, h, 14, 1.2), x, 0, z);
  mb.add('stoneDark', cyl(r + 0.04, r + 0.06, 0.25, 14, 1.2), x, -0.12, z);
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
    mb.add(roof, cone(r + 0.1, roofH, 14, 1.3), x, h, z);
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
    mb.add('stone', cyl(0.5, 0.66, 1.9, 16, 1.2), 0, 0.1, -0.1);
    mb.add(`roof${owner}`, cone(0.62, 0.7, 16, 1.4), 0, 2.0, -0.1);
    mb.add('timber', cyl(0.62, 0.62, 0.08, 16), 0, 1.96, -0.1);
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
