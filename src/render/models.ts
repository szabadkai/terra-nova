// Procedural geometry for trees, rocks, crops, grass, settlers, animals and goods.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/rng';
import type { Good } from '../game/defs';

function colorize(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => [number, number, number]) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const [r, gg, b] = fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function prep(g: THREE.BufferGeometry) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') out.deleteAttribute(k);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

function merge(gs: THREE.BufferGeometry[]) {
  return mergeGeometries(gs.map(prep), false)!;
}

const lin = (hex: number): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/** Displace sphere-ish blob and give it soft outward normals. */
function blob(r: number, cx: number, cy: number, cz: number, seed: number, detail = 1, sy = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.22 * (hash2(Math.round(x * 40), Math.round(y * 40) + Math.round(z * 40) * 7, seed) - 0.5) + 0.1 * Math.sin(x * 9 + seed) * Math.cos(z * 8);
    p.setXYZ(i, x * n + cx, y * n * sy + cy, z * n + cz);
  }
  g.computeVertexNormals();
  return g;
}

function softNormals(g: THREE.BufferGeometry, center: THREE.Vector3, amount = 0.7) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(center).normalize();
    nn.set(n.getX(i), n.getY(i), n.getZ(i)).lerp(v, amount).normalize();
    n.setXYZ(i, nn.x, nn.y, nn.z);
  }
}

// ------------------------------------------------------------------ trees
export interface TreeGeo { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry; cards?: THREE.BufferGeometry; needles?: boolean; }

function trunkGeo(h: number, r: number, bark: number, bend = 0, marks = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.65, r, h, 7, 4, true);
  g.translate(0, h / 2, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 2.2) * bend);
  }
  g.computeVertexNormals();
  const base = lin(bark);
  return colorize(g, (x, y, z) => {
    let k = 0.75 + 0.35 * hash2(Math.round(x * 50), Math.round(y * 20), 3);
    if (marks && Math.sin(y * 23 + x * 5) > 0.7) k *= 0.25;
    return [base[0] * k, base[1] * k, base[2] * k];
  });
}

function crownColor(g: THREE.BufferGeometry, cols: number[], center: THREE.Vector3, seed: number) {
  const cs = cols.map(lin);
  return colorize(g, (x, y, z) => {
    const h = hash2(Math.round(x * 6 + seed), Math.round(z * 6), Math.round(y * 6));
    const c = cs[Math.floor(h * cs.length) % cs.length];
    const dy = (y - center.y);
    const ao = THREE.MathUtils.clamp(0.62 + dy * 0.5, 0.45, 1.15);
    const d = Math.hypot(x - center.x, z - center.z);
    const rim = 0.85 + d * 0.25;
    return [c[0] * ao * rim, c[1] * ao * rim, c[2] * ao * rim];
  });
}

/** Leaf cards scattered over an ellipsoidal crown, with outward normals and AO colours. */
function leafCards(center: THREE.Vector3, rx: number, ry: number, rz: number, n: number, size: number, seed: number, tint: number[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [];
  const tc = tint.map(lin);
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < n; k++) {
    // fibonacci-ish distribution over the sphere, biased upwards
    const t = (k + 0.5) / n;
    const phi = Math.acos(1 - 2 * Math.pow(t, 0.85));
    const theta = k * 2.39996 + seed;
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    const rr = 0.72 + hash2(k, seed, 3) * 0.32;
    const c = new THREE.Vector3(center.x + dir.x * rx * rr, center.y + dir.y * ry * rr, center.z + dir.z * rz * rr);
    // card plane: perpendicular-ish to the outward direction, randomly rolled
    const nrmDir = dir.clone().lerp(new THREE.Vector3(hash2(k, 1, seed) - 0.5, hash2(k, 2, seed) - 0.5, hash2(k, 3, seed) - 0.5), 0.5).normalize();
    let tan = new THREE.Vector3().crossVectors(nrmDir, up);
    if (tan.lengthSq() < 0.01) tan.set(1, 0, 0);
    tan.normalize();
    const bit = new THREE.Vector3().crossVectors(tan, nrmDir).normalize();
    const roll = hash2(k, 4, seed) * Math.PI * 2;
    const t2 = tan.clone().multiplyScalar(Math.cos(roll)).addScaledVector(bit, Math.sin(roll));
    const b2 = new THREE.Vector3().crossVectors(t2, nrmDir);
    const s = size * (0.8 + hash2(k, 5, seed) * 0.45);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const quad = corners.map(([a, b]) => c.clone().addScaledVector(t2, a * s * 0.5).addScaledVector(b2, b * s * 0.5));
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const shade = THREE.MathUtils.clamp(0.55 + dir.y * 0.35 + (rr - 0.7) * 0.6, 0.35, 1.1);
    const base = tc[k % tc.length];
    for (const idx of [0, 1, 2, 0, 2, 3]) {
      const q = quad[idx];
      pos.push(q.x, q.y, q.z);
      // soft outward normal from crown centre
      const on = q.clone().sub(center).normalize();
      nrm.push(on.x, on.y, on.z);
      uv.push(uvs[idx][0], uvs[idx][1]);
      col.push(base[0] * shade, base[1] * shade, base[2] * shade);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Drooping skirt of needle cards around a conifer trunk. */
function pineCards(tiers: number, seed: number): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [];
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = 0.5 + t * 0.42;
    const r = 0.78 - f * 0.55;
    const drop = 0.42 - f * 0.12;
    const n = Math.max(5, Math.round(10 - f * 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + t * 0.7 + hash2(k, t, seed) * 0.4;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const w = (Math.PI * 2 * r) / n * 1.7;
      const top = new THREE.Vector3(0, y + 0.12, 0).addScaledVector(out, 0.04);
      const bot = new THREE.Vector3(0, y - drop, 0).addScaledVector(out, r * (0.9 + hash2(k, t, seed + 1) * 0.25));
      const q = [
        top.clone().addScaledVector(tan, -w * 0.18), top.clone().addScaledVector(tan, w * 0.18),
        bot.clone().addScaledVector(tan, w * 0.5), bot.clone().addScaledVector(tan, -w * 0.5),
      ];
      const uvs = [[0.2, 1], [0.8, 1], [1, 0], [0, 0]];
      const shade = 0.55 + f * 0.45;
      const nn = out.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.8, 0)).normalize();
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        pos.push(q[idx].x, q[idx].y, q[idx].z);
        nrm.push(nn.x, nn.y, nn.z);
        uv.push(uvs[idx][0], uvs[idx][1]);
        const edge = idx >= 2 ? 1.15 : 0.7;
        col.push(0.2 * shade * edge, 0.42 * shade * edge, 0.2 * shade * edge);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function buildTreeGeos(): TreeGeo[] {
  const out: TreeGeo[] = [];
  // 0 oak / broadleaf
  {
    const parts: THREE.BufferGeometry[] = [];
    const c = new THREE.Vector3(0, 1.55, 0);
    parts.push(blob(0.62, 0, 1.55, 0, 1));
    parts.push(blob(0.48, 0.42, 1.35, 0.15, 2));
    parts.push(blob(0.46, -0.38, 1.38, -0.12, 3));
    parts.push(blob(0.44, 0.05, 1.95, -0.2, 4));
    parts.push(blob(0.4, -0.1, 1.3, 0.42, 5));
    const crown = merge(parts);
    crown.scale(0.72, 0.72, 0.72);
    crown.translate(0, 1.55 * 0.28, 0);
    softNormals(crown, c, 0.75);
    crownColor(crown, [0x223c12, 0x284416, 0x1e3610], c, 1);
    const cards = leafCards(c, 0.84, 0.74, 0.84, 64, 0.72, 1, [0x9ac860, 0x8aba54, 0xa8d06a, 0x86b04e]);
    const trunk = merge([trunkGeo(1.3, 0.1, 0x5a4230, 0.03), (() => { const b = trunkGeo(0.55, 0.05, 0x5a4230); b.rotateZ(0.8); b.translate(0.05, 0.85, 0); return b; })(), (() => { const b = trunkGeo(0.5, 0.045, 0x5a4230); b.rotateZ(-0.9); b.rotateY(1.2); b.translate(-0.02, 1.0, 0.02); return b; })()]);
    out.push({ trunk, crown, cards });
  }
  // 1 pine
  {
    const parts: THREE.BufferGeometry[] = [];
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const r = 0.62 - t * 0.12, h = 0.85 - t * 0.08, y = 0.55 + t * 0.48;
      const g = new THREE.ConeGeometry(r, h, 11, 2, false).toNonIndexed();
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const vy = p.getY(i);
        if (vy < -h / 2 + 0.01) {
          const a = Math.atan2(p.getZ(i), p.getX(i));
          const j = 1 + 0.18 * Math.sin(a * 5 + t);
          p.setX(i, p.getX(i) * j);
          p.setZ(i, p.getZ(i) * j);
          p.setY(i, vy - 0.08 * Math.abs(Math.sin(a * 5 + t)));
        }
      }
      g.translate(0, y + h / 2, 0);
      g.computeVertexNormals();
      parts.push(g);
    }
    const crown = merge(parts);
    crown.scale(0.72, 0.95, 0.72);
    const c = new THREE.Vector3(0, 1.4, 0);
    softNormals(crown, c, 0.35);
    crownColor(crown, [0x1a3818, 0x1e3e1a, 0x183416], c, 7);
    out.push({ trunk: trunkGeo(1.9, 0.09, 0x4a3426), crown, cards: pineCards(5, 3), needles: true });
  }
  // 2 birch
  {
    const c = new THREE.Vector3(0, 1.7, 0);
    const parts = [blob(0.4, 0, 1.75, 0, 11, 1, 1.35), blob(0.34, 0.25, 1.5, 0.1, 12, 1, 1.3), blob(0.32, -0.22, 1.55, -0.1, 13, 1, 1.3), blob(0.28, 0.02, 2.15, 0.05, 14, 1, 1.2)];
    const crown = merge(parts);
    crown.scale(0.7, 0.75, 0.7);
    crown.translate(0, 1.7 * 0.25, 0);
    softNormals(crown, c, 0.75);
    crownColor(crown, [0x345a1c, 0x3a6220], c, 3);
    const cards = leafCards(c, 0.58, 0.8, 0.58, 46, 0.52, 7, [0xc0e070, 0xb0d466, 0xd0e880]);
    out.push({ trunk: trunkGeo(1.5, 0.065, 0xe8e2d6, 0.02, true), crown, cards });
  }
  // 3 palm
  {
    const trunkParts: THREE.BufferGeometry[] = [];
    let x = 0, y = 0;
    for (let s = 0; s < 6; s++) {
      const g = trunkGeo(0.32, 0.075 - s * 0.006, 0x8a6a48);
      g.rotateZ(-0.06 * s);
      g.translate(x, y, 0);
      trunkParts.push(g);
      x += Math.sin(0.06 * s) * 0.32;
      y += 0.3;
    }
    const top = new THREE.Vector3(x, y, 0);
    const fronds: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const g = new THREE.PlaneGeometry(0.9, 0.2, 6, 1);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const fx = p.getX(i) + 0.45;
        const w = Math.sin((fx / 0.9) * Math.PI) * 1.1;
        p.setXYZ(i, fx, -fx * fx * 0.45, p.getY(i) * w);
      }
      g.rotateY(a);
      g.translate(top.x, top.y, top.z);
      g.computeVertexNormals();
      fronds.push(g);
    }
    const crown = merge(fronds);
    crownColor(crown, [0x5e8a30, 0x6a9838], top, 5);
    out.push({ trunk: merge(trunkParts), crown });
  }
  // 4 fruit tree
  {
    const c = new THREE.Vector3(0, 1.15, 0);
    const parts = [blob(0.5, 0, 1.2, 0, 21), blob(0.38, 0.32, 1.05, 0.1, 22), blob(0.36, -0.3, 1.1, -0.1, 23)];
    const crown = merge(parts);
    crown.scale(0.75, 0.75, 0.75);
    crown.translate(0, 1.15 * 0.25, 0);
    softNormals(crown, c, 0.75);
    crownColor(crown, [0x2a4a18, 0x30521c], c, 9);
    const fruits: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4, yy = 0.95 + (k % 3) * 0.2;
      const f = new THREE.IcosahedronGeometry(0.05, 0);
      f.translate(Math.cos(a) * 0.6, yy, Math.sin(a) * 0.6);
      colorize(f, () => lin(k % 2 ? 0xd83a2a : 0xe8a020));
      fruits.push(f);
    }
    const cards = leafCards(c, 0.64, 0.54, 0.64, 44, 0.56, 13, [0xa0cc60, 0x94c058]);
    out.push({ trunk: trunkGeo(0.95, 0.08, 0x5a4230, 0.04), crown: merge([crown, ...fruits]), cards });
  }
  return out;
}

// ------------------------------------------------------------------ rocks / stones
export function buildRockGeos(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let v = 0; v < 3; v++) {
    const parts: THREE.BufferGeometry[] = [];
    const n = 3 + v;
    for (let k = 0; k < n; k++) {
      const r = 0.26 + hash2(k, v, 3) * 0.24;
      // indexed icosphere, randomly displaced; normals are a blend of flat + smooth
      let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 2);
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      g = mergeVertices(g);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const sx = 0.8 + hash2(k, v, 11) * 0.5, sz = 0.8 + hash2(k, v, 12) * 0.5;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const q = (a: number) => Math.round(a * 60);
        const rnd = hash2(q(x) + q(z) * 7, q(y) + k * 31, v * 13 + 5);
        const low = Math.sin(x * 7 + k * 3) * Math.cos(z * 6 + y * 3 + v) * 0.1;
        let m = 1 + (rnd - 0.5) * 0.28 + low;
        let yy = y * m * 0.72;
        if (yy > r * 0.45) yy = r * 0.45 + (yy - r * 0.45) * 0.35; // flattened top
        p.setXYZ(i, x * m * sx, yy, z * m * sz);
      }
      g.computeVertexNormals();
      const smooth = g.getAttribute('normal').clone() as THREE.BufferAttribute;
      const flat = g.toNonIndexed();
      flat.computeVertexNormals();
      // blend flat face normals with the smooth ones for chiselled but natural stone
      const idx = g.index!.array;
      const fn = flat.getAttribute('normal') as THREE.BufferAttribute;
      for (let t = 0; t < idx.length; t++) {
        const si = idx[t];
        const nx = fn.getX(t) * 0.55 + smooth.getX(si) * 0.45, ny = fn.getY(t) * 0.55 + smooth.getY(si) * 0.45, nz = fn.getZ(t) * 0.55 + smooth.getZ(si) * 0.45;
        const l = Math.hypot(nx, ny, nz);
        fn.setXYZ(t, nx / l, ny / l, nz / l);
      }
      g = flat;
      const a = (k / n) * Math.PI * 2 + v;
      const d = k === 0 ? 0 : 0.34;
      g.translate(Math.cos(a) * d, r * 0.4, Math.sin(a) * d);
      parts.push(g);
    }
    const geo = merge(parts);
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    let vi = 0;
    colorize(geo, (x, y, z) => {
      const ny = nrm.getY(vi++);
      const h = hash2(Math.round(x * 14), Math.round(z * 14) + Math.round(y * 14) * 3, v);
      const base = 0.13 + h * 0.05 + Math.max(0, y) * 0.05;
      const warm = hash2(Math.round(x * 5), Math.round(z * 5), v + 9);
      // crevices (downward facing / low) darker, lichen on upward facing tops
      const crev = THREE.MathUtils.clamp(0.65 + ny * 0.35 + y * 0.4, 0.45, 1.05);
      const lichen = ny > 0.75 && h > 0.62 ? 1 : 0;
      if (lichen) return [0.09 * crev, 0.11 * crev, 0.05 * crev];
      return [base * (1.0 + warm * 0.15) * crev, base * 0.97 * crev, base * (0.9 - warm * 0.08) * crev];
    });
    out.push(geo);
  }
  return out;
}

/** Make thin foliage double-sided with upward normals so both faces light like the ground. */
function twoSidedUp(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position').array as ArrayLike<number>;
  const c = src.getAttribute('color')?.array as ArrayLike<number> | undefined;
  const n = p.length / 9;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  for (let t = 0; t < n; t++) {
    for (const order of [[0, 1, 2], [0, 2, 1]]) {
      for (const v of order) {
        const i = t * 3 + v;
        pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        nrm.push(0, 1, 0);
        if (c) col.push(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (c) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// ------------------------------------------------------------------ wheat field patch (1x1)
export function buildWheatGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 42; k++) {
    const x = (hash2(k, 1, 5) - 0.5) * 0.9, z = (hash2(k, 2, 5) - 0.5) * 0.9;
    const h = 0.34 + hash2(k, 3, 5) * 0.12;
    const g = new THREE.PlaneGeometry(0.035, h, 1, 2);
    g.translate(0, h / 2, 0);
    g.rotateY(hash2(k, 4, 5) * Math.PI);
    g.translate(x, 0, z);
    parts.push(g);
    const ear = new THREE.BoxGeometry(0.03, 0.08, 0.03);
    ear.translate(x, h + 0.02, z);
    parts.push(ear);
  }
  const geo = merge(parts);
  colorize(geo, (_x, y) => {
    const k = 0.6 + y * 1.2;
    return [k, k, k];
  });
  return twoSidedUp(geo);
}

export function buildGrassTuft(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const h = 0.14 + hash2(k, 7, 1) * 0.12;
    const g = new THREE.BufferGeometry();
    const w = 0.035;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0, h, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.rotateZ((hash2(k, 8, 1) - 0.5) * 0.7);
    g.rotateY(hash2(k, 9, 1) * Math.PI * 2);
    g.translate((hash2(k, 10, 1) - 0.5) * 0.22, 0, (hash2(k, 11, 1) - 0.5) * 0.22);
    parts.push(g);
  }
  const geo = mergeGeometries(parts, false)!;
  colorize(geo, (_x, y) => {
    const k = 0.85 + y * 2.2;
    return [k, k, k];
  });
  return twoSidedUp(geo);
}

// ------------------------------------------------------------------ settlers
export interface SettlerGeos {
  leg: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  hats: THREE.BufferGeometry[]; // 0 cap, 1 helmet, 2 wide hat, 3 hood, 4 hair
  shield: THREE.BufferGeometry;
}

export function buildSettlerGeos(): SettlerGeos {
  const leg = new THREE.BoxGeometry(0.075, 0.27, 0.085);
  leg.translate(0, -0.135, 0);
  // boot
  const boot = new THREE.BoxGeometry(0.08, 0.06, 0.12);
  boot.translate(0, -0.25, 0.015);
  const legG = merge([leg, boot]);
  colorize(legG, (_x, y) => (y < -0.22 ? [0.12, 0.08, 0.05] : [1, 1, 1]));

  const torso = new THREE.CylinderGeometry(0.095, 0.115, 0.27, 8);
  torso.translate(0, 0.39, 0);
  const belt = new THREE.CylinderGeometry(0.118, 0.118, 0.035, 8);
  belt.translate(0, 0.29, 0);
  const torsoG = merge([torso, belt]);
  colorize(torsoG, (_x, y) => (y < 0.31 && y > 0.27 ? [0.25, 0.16, 0.08] : [1, 1, 1]));

  const arm = new THREE.BoxGeometry(0.058, 0.24, 0.062);
  arm.translate(0, -0.11, 0);
  const hand = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  hand.translate(0, -0.245, 0);
  const armG = merge([arm, hand]);
  colorize(armG, (_x, y) => (y < -0.22 ? [1.0, 0.78, 0.62] : [1, 1, 1]));

  const head = new THREE.IcosahedronGeometry(0.078, 1);
  head.translate(0, 0.6, 0);
  const nose = new THREE.BoxGeometry(0.02, 0.025, 0.03);
  nose.translate(0, 0.595, 0.078);
  const headG = merge([head, nose]);
  colorize(headG, () => [1, 1, 1]);

  const cap = new THREE.ConeGeometry(0.085, 0.12, 8);
  cap.translate(0, 0.69, -0.005);
  const helmet = new THREE.SphereGeometry(0.088, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  helmet.translate(0, 0.615, 0);
  const crest = new THREE.BoxGeometry(0.02, 0.06, 0.14);
  crest.translate(0, 0.71, 0);
  const wideBrim = new THREE.CylinderGeometry(0.14, 0.14, 0.015, 10);
  wideBrim.translate(0, 0.65, 0);
  const wideTop = new THREE.CylinderGeometry(0.06, 0.075, 0.07, 10);
  wideTop.translate(0, 0.69, 0);
  const hood = new THREE.SphereGeometry(0.092, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hood.translate(0, 0.6, -0.008);
  const hair = new THREE.SphereGeometry(0.083, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45);
  hair.translate(0, 0.607, -0.006);
  const hats = [merge([cap]), merge([helmet, crest]), merge([wideBrim, wideTop]), merge([hood]), merge([hair])];
  for (const h of hats) colorize(h, () => [1, 1, 1]);

  const shield = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10);
  shield.rotateX(Math.PI / 2);
  const boss = new THREE.SphereGeometry(0.03, 6, 4);
  boss.translate(0, 0, 0.012);
  const shieldG = merge([shield, boss]);
  colorize(shieldG, (x, y, z) => (z > 0.011 ? [0.8, 0.8, 0.8] : [1, 1, 1]));
  return { leg: legG, torso: torsoG, arm: armG, head: headG, hats, shield: shieldG };
}

// ------------------------------------------------------------------ deer
export function buildDeerGeos() {
  const body = new THREE.SphereGeometry(0.16, 10, 8);
  body.scale(0.75, 0.7, 1.4);
  body.translate(0, 0.4, 0);
  const neck = new THREE.CylinderGeometry(0.045, 0.06, 0.22, 6);
  neck.rotateX(-0.6);
  neck.translate(0, 0.52, 0.2);
  const head = new THREE.SphereGeometry(0.06, 8, 6);
  head.scale(0.8, 0.8, 1.4);
  head.translate(0, 0.62, 0.3);
  const tail = new THREE.SphereGeometry(0.03, 6, 4);
  tail.translate(0, 0.44, -0.23);
  const antl: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const a = new THREE.CylinderGeometry(0.008, 0.01, 0.16, 4);
    a.rotateZ(s * 0.4);
    a.translate(s * 0.04, 0.72, 0.28);
    antl.push(a);
    const b = new THREE.CylinderGeometry(0.006, 0.008, 0.08, 4);
    b.rotateZ(s * 1.1);
    b.translate(s * 0.08, 0.76, 0.28);
    antl.push(b);
  }
  const bodyG = merge([body, neck, head, tail, ...antl]);
  colorize(bodyG, (x, y, z) => {
    if (y > 0.66) return [0.75, 0.66, 0.5];
    if (z < -0.2) return [0.95, 0.92, 0.85];
    const under = y < 0.33 ? 0.85 : 1;
    return [0.55 * under, 0.36 * under, 0.2 * under];
  });
  const leg = new THREE.BoxGeometry(0.035, 0.3, 0.035);
  leg.translate(0, -0.15, 0);
  colorize(leg, (_x, y) => (y < -0.26 ? [0.1, 0.08, 0.06] : [0.5, 0.34, 0.2]));
  return { body: prep(bodyG), leg: prep(leg) };
}

// ------------------------------------------------------------------ goods
export function buildGoodGeos(): Record<Good, THREE.BufferGeometry> {
  const c = (g: THREE.BufferGeometry, hex: number, v = 0.12) => colorize(g, (x, y, z) => {
    const b = lin(hex);
    const k = 1 - v + hash2(Math.round(x * 90), Math.round(y * 90) + Math.round(z * 90) * 3, 1) * v * 2;
    return [b[0] * k, b[1] * k, b[2] * k];
  });
  const sack = (hex: number) => {
    const g = new THREE.SphereGeometry(0.09, 8, 6);
    g.scale(1, 1.25, 0.8);
    g.translate(0, 0.1, 0);
    const tie = new THREE.CylinderGeometry(0.025, 0.035, 0.05, 6);
    tie.translate(0, 0.21, 0);
    return merge([c(g, hex), c(tie, 0x8a6a40)]);
  };
  const lump = (hex: number, seed: number) => {
    const g = new THREE.DodecahedronGeometry(0.085, 0);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.75);
    g.translate(0, 0.07, 0);
    g.computeVertexNormals();
    return c(g, hex, 0.25 + seed * 0);
  };
  const handle = (len: number) => { const g = new THREE.BoxGeometry(0.022, len, 0.022); g.translate(0, len / 2, 0); return c(g, 0x7a5a38); };
  const metal = (w: number, h: number, d: number, x: number, y: number, z: number, hex = 0x9aa0a6) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return c(g, hex, 0.05); };

  const log = new THREE.CylinderGeometry(0.055, 0.06, 0.42, 8);
  log.rotateZ(Math.PI / 2);
  log.translate(0, 0.06, 0);
  const logG = colorize(prep(log), (x) => (Math.abs(x) > 0.2 ? [0.78, 0.62, 0.4] : [0.36, 0.25, 0.16]));
  const board = new THREE.BoxGeometry(0.44, 0.03, 0.1);
  board.translate(0, 0.015, 0);
  const stone = new THREE.BoxGeometry(0.16, 0.12, 0.13, 2, 2, 2);
  {
    const sp = stone.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const j = 0.9 + hash2(Math.round(sp.getX(i) * 200), Math.round(sp.getY(i) * 200) + Math.round(sp.getZ(i) * 200) * 3, 5) * 0.2;
      sp.setXYZ(i, sp.getX(i) * j, sp.getY(i) * j, sp.getZ(i) * j);
    }
    stone.computeVertexNormals();
  }
  stone.translate(0, 0.06, 0);
  const bread = new THREE.SphereGeometry(0.075, 8, 6);
  bread.scale(1.4, 0.7, 0.9);
  bread.translate(0, 0.05, 0);
  const fish = new THREE.SphereGeometry(0.05, 8, 6);
  fish.scale(2.6, 0.7, 0.9);
  fish.translate(0, 0.04, 0);
  const fishTail = new THREE.ConeGeometry(0.04, 0.06, 4);
  fishTail.rotateZ(Math.PI / 2);
  fishTail.translate(-0.15, 0.04, 0);
  const meat = new THREE.SphereGeometry(0.07, 8, 6);
  meat.scale(1.2, 0.9, 1);
  meat.translate(0, 0.06, 0);
  const bone = new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5);
  bone.rotateZ(Math.PI / 2);
  bone.translate(0.1, 0.06, 0);
  const pig = new THREE.SphereGeometry(0.09, 8, 6);
  pig.scale(0.9, 0.8, 1.3);
  pig.translate(0, 0.09, 0);
  const pigHead = new THREE.SphereGeometry(0.055, 8, 6);
  pigHead.translate(0, 0.1, 0.12);
  const bucket = new THREE.CylinderGeometry(0.07, 0.055, 0.12, 10);
  bucket.translate(0, 0.06, 0);
  const waterTop = new THREE.CircleGeometry(0.065, 10);
  waterTop.rotateX(-Math.PI / 2);
  waterTop.translate(0, 0.11, 0);
  const bar = (hex: number) => { const g = new THREE.BoxGeometry(0.16, 0.05, 0.07); g.translate(0, 0.025, 0); return c(g, hex, 0.04); };
  const sword = merge([metal(0.025, 0.36, 0.008, 0, 0.26, 0, 0xc8ccd0), metal(0.1, 0.02, 0.02, 0, 0.08, 0, 0x8a6a30), handle(0.08)]);
  const bowArc: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const a0 = -0.9 + (k / 6) * 1.8;
    const seg = new THREE.BoxGeometry(0.018, 0.08, 0.018);
    seg.rotateZ(-a0 * 0.8);
    seg.translate(Math.cos(a0) * 0.2 - 0.2, Math.sin(a0) * 0.2 + 0.2, 0);
    bowArc.push(c(seg, 0x8a5a30));
  }
  const str = new THREE.BoxGeometry(0.004, 0.31, 0.004);
  str.translate(-0.07, 0.2, 0);
  const bow = merge([...bowArc, c(str, 0xeeeeee)]);

  const axe = merge([handle(0.34), metal(0.09, 0.07, 0.015, 0.04, 0.3, 0)]);
  const pickaxe = merge([handle(0.34), metal(0.2, 0.025, 0.02, 0, 0.32, 0)]);
  const saw = merge([metal(0.3, 0.07, 0.006, 0.12, 0.05, 0), handle(0.1)]);
  const hammer = merge([handle(0.26), metal(0.08, 0.05, 0.05, 0, 0.27, 0, 0x606468)]);
  const shovel = merge([handle(0.36), metal(0.08, 0.1, 0.012, 0, 0.4, 0)]);
  const scythe = merge([handle(0.42), metal(0.2, 0.02, 0.012, 0.09, 0.42, 0)]);
  const rod = merge([(() => { const g = new THREE.CylinderGeometry(0.006, 0.012, 0.6, 4); g.translate(0, 0.3, 0); return c(g, 0x9a7a50); })()]);

  return {
    log: logG, board: c(prep(board), 0xc8a070), stone: c(prep(stone), 0x8a867e, 0.2),
    grain: sack(0xd8c070), flour: sack(0xf0ece0), bread: c(prep(bread), 0xb07030),
    fish: merge([c(fish, 0xa8b8c0), c(fishTail, 0x8898a0)]), meat: merge([c(meat, 0xb03a30), c(bone, 0xf0e8d8)]),
    pig: merge([c(pig, 0xe8a898), c(pigHead, 0xe8a090)]), water: merge([c(bucket, 0x8a6a48), c(waterTop, 0x4a8ab0, 0.02)]),
    coal: lump(0x222224, 0), ironore: lump(0x8a4a30, 1), goldore: lump(0xc8a040, 2),
    iron: bar(0x5a5e64), gold: bar(0xe8b840), sword, bow,
    axe, pickaxe, saw, hammer, shovel, scythe, rod,
  };
}
