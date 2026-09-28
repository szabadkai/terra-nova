// Procedural geometry for trees, rocks, crops, grass, animals and goods (settlers: settlerModels.ts).
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
export interface TreeGeo {
  trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry; cards?: THREE.BufferGeometry; needles?: boolean;
  /** deciduous only: bare limbs, drawn while the leaves are thin */
  branches?: THREE.BufferGeometry;
}

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
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], rnd: number[] = [];
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
    // order in which this card drops its leaves in autumn (low bottom cards go first)
    const fall = THREE.MathUtils.clamp(hash2(k, seed, 9) * 0.8 + (0.5 - dir.y * 0.5) * 0.2, 0, 1);
    for (const idx of [0, 1, 2, 0, 2, 3]) {
      const q = quad[idx];
      pos.push(q.x, q.y, q.z);
      // soft outward normal from crown centre
      const on = q.clone().sub(center).normalize();
      nrm.push(on.x, on.y, on.z);
      uv.push(uvs[idx][0], uvs[idx][1]);
      col.push(base[0] * shade, base[1] * shade, base[2] * shade);
      rnd.push(fall);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 1));
  return g;
}

const UPV = new THREE.Vector3(0, 1, 0);

/** Tapered open cylinder from a to b. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, bark: [number, number, number], radial = 5, seed = 0): THREE.BufferGeometry {
  const d = b.clone().sub(a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UPV, d.normalize()));
  g.translate(a.x, a.y, a.z);
  return colorize(g, (x, y, z) => {
    const k = 0.75 + 0.35 * hash2(Math.round(x * 40), Math.round(y * 40) + Math.round(z * 40) * 5, seed);
    return [bark[0] * k, bark[1] * k, bark[2] * k];
  });
}

/** Distance from p along unit dir d to the far side of an ellipsoid (centre c, radii r); 0 if it misses. */
function rayEllipsoid(p: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: THREE.Vector3): number {
  const P = p.clone().sub(c).divide(r), D = d.clone().divide(r);
  const a = D.dot(D), b = 2 * P.dot(D), cc = P.dot(P) - 1;
  const disc = b * b - 4 * a * cc;
  return disc < 0 ? 0 : Math.max(0, (-b + Math.sqrt(disc)) / (2 * a));
}

/**
 * Bare limbs of a deciduous crown: a leader continuing the trunk plus spiralling limbs with side
 * branches, all ending inside the leaf-card shell (whose cards show twigs once the leaves are gone).
 */
function branchSkeleton(seed: number, trunkTop: number, trunkR: number, c: THREE.Vector3, shell: THREE.Vector3, limbs: number, bark: number, lean: number): THREE.BufferGeometry {
  const col = lin(bark);
  const parts: THREE.BufferGeometry[] = [];
  const top = new THREE.Vector3(0, c.y + shell.y * 0.7, 0);
  const lead0 = new THREE.Vector3(0, trunkTop - 0.06, 0);
  const leadMid = new THREE.Vector3((hash2(seed, 1, 5) - 0.5) * 0.08, (lead0.y + top.y) / 2, (hash2(seed, 2, 5) - 0.5) * 0.08);
  parts.push(limb(lead0, leadMid, trunkR * 0.66, trunkR * 0.42, col, 6, seed), limb(leadMid, top, trunkR * 0.42, trunkR * 0.12, col, 5, seed));
  for (let k = 0; k < limbs; k++) {
    const t = (k + 0.5) / limbs;
    const y0 = trunkTop * 0.7 + (c.y + shell.y * 0.25 - trunkTop * 0.7) * t;
    const a = k * 2.39996 + seed + (hash2(k, seed, 1) - 0.5) * 0.7;
    const dir = new THREE.Vector3(Math.cos(a), lean + hash2(k, seed, 2) * 0.45 + t * 0.35, Math.sin(a)).normalize();
    // start on the leader, so limbs higher up branch off a thinner stem
    const start = y0 <= leadMid.y
      ? lead0.clone().lerp(leadMid, Math.max(0, (y0 - lead0.y) / (leadMid.y - lead0.y)))
      : leadMid.clone().lerp(top, (y0 - leadMid.y) / (top.y - leadMid.y));
    const L = Math.max(0.25, rayEllipsoid(start, dir, c, shell) * (0.8 + hash2(k, seed, 3) * 0.12));
    const bend = new THREE.Vector3(hash2(k, seed, 4) - 0.5, 0.35 + hash2(k, seed, 6) * 0.2, hash2(k, seed, 7) - 0.5).multiplyScalar(L * 0.18);
    const mid = start.clone().addScaledVector(dir, L * 0.5).add(bend);
    const end = start.clone().addScaledVector(dir, L);
    const r0 = trunkR * (0.55 - t * 0.2), rm = r0 * 0.62, r1 = r0 * 0.28;
    parts.push(limb(start, mid, r0, rm, col, 5, seed + k), limb(mid, end, rm, r1, col, 4, seed + k));
    // side branches fork off towards the shell
    for (let sI = 0; sI < 3; sI++) {
      const f = 0.3 + sI * 0.24 + (hash2(k, sI, seed + 11) - 0.5) * 0.1;
      const p = f < 0.5 ? start.clone().lerp(mid, f / 0.5) : mid.clone().lerp(end, (f - 0.5) / 0.5);
      const sa = a + (sI % 2 ? 1 : -1) * (0.7 + hash2(k, sI, seed + 12) * 0.6);
      const d2 = new THREE.Vector3(Math.cos(sa), lean * 0.8 + hash2(k, sI, seed + 13) * 0.6, Math.sin(sa)).normalize();
      const L2 = Math.min(L * 0.55, Math.max(0.12, rayEllipsoid(p, d2, c, shell) * 0.85));
      const rr = THREE.MathUtils.lerp(r0, r1, f) * 0.6;
      parts.push(limb(p, p.clone().addScaledVector(d2, L2), rr, rr * 0.3, col, 3, seed + k * 7 + sI));
    }
  }
  return merge(parts);
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
    const branches = branchSkeleton(1, 1.3, 0.1, c, new THREE.Vector3(0.74, 0.66, 0.74), 6, 0x5a4230, 0.35);
    out.push({ trunk, crown, cards, branches });
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
    const branches = branchSkeleton(7, 1.5, 0.065, c, new THREE.Vector3(0.5, 0.72, 0.5), 6, 0x4a3a34, 0.9);
    out.push({ trunk: trunkGeo(1.5, 0.065, 0xe8e2d6, 0.02, true), crown, cards, branches });
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
    const branches = branchSkeleton(13, 0.95, 0.08, c, new THREE.Vector3(0.58, 0.48, 0.58), 5, 0x5a4230, 0.25);
    out.push({ trunk: trunkGeo(0.95, 0.08, 0x5a4230, 0.04), crown: merge([crown, ...fruits]), cards, branches });
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
      const seed = v * 17 + k;
      // indexed icosphere, randomly displaced, then split along cleavage planes
      let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 3);
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
        const m = 1 + (rnd - 0.5) * 0.16 + low;
        p.setXYZ(i, x * m * sx, y * m * 0.78, z * m * sz);
      }
      // cleavage planes, mostly facing up and sideways (the bottom is buried): every vertex
      // beyond one is pushed onto it, leaving flat faces with sharp edges
      const plane = new Int8Array(p.count).fill(-1);
      const cuts = 7 + Math.floor(hash2(k, v, 21) * 4);
      for (let c = 0; c < cuts; c++) {
        const th = hash2(c, seed, 22) * Math.PI * 2;
        const ny = c === 0 ? 0.92 : -0.15 + hash2(c, seed, 23) * 0.95;
        const hr = Math.sqrt(1 - ny * ny);
        const nx = Math.cos(th) * hr, nz = Math.sin(th) * hr;
        const reach = r * Math.hypot(nx * sx, ny * 0.78, nz * sz);
        const d = reach * (c === 0 ? 0.55 : 0.64 + hash2(c, seed, 24) * 0.24);
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const s = x * nx + y * ny + z * nz - d;
          if (s <= 0) continue;
          p.setXYZ(i, x - nx * s, y - ny * s, z - nz * s);
          plane[i] = c;
        }
      }
      g.computeVertexNormals();
      const smooth = g.getAttribute('normal').clone() as THREE.BufferAttribute;
      const flat = g.toNonIndexed();
      flat.computeVertexNormals();
      // cut faces keep their flat normal (crisp edges); elsewhere flat blends with smooth
      // for chiselled but natural stone
      const idx = g.index!.array;
      const fn = flat.getAttribute('normal') as THREE.BufferAttribute;
      for (let t = 0; t < idx.length; t++) {
        const si = idx[t];
        const f0 = t - (t % 3);
        const pl = plane[idx[f0]];
        if (pl >= 0 && plane[idx[f0 + 1]] === pl && plane[idx[f0 + 2]] === pl) continue;
        const nx = fn.getX(t) * 0.4 + smooth.getX(si) * 0.6, ny = fn.getY(t) * 0.4 + smooth.getY(si) * 0.6, nz = fn.getZ(t) * 0.4 + smooth.getZ(si) * 0.6;
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
    // a multiplier on the shader's rock colour: crevices (downward facing / low) darker,
    // each boulder a slightly different tone
    colorize(geo, (x, y, z) => {
      const ny = nrm.getY(vi++);
      const h = hash2(Math.round(x * 14), Math.round(z * 14) + Math.round(y * 14) * 3, v);
      const warm = hash2(Math.round(x * 5), Math.round(z * 5), v + 9);
      const crev = THREE.MathUtils.clamp(0.8 + ny * 0.22 + y * 0.4, 0.55, 1.1) * (0.94 + h * 0.1);
      return [crev * (1 + warm * 0.06), crev, crev * (1 - warm * 0.06)];
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

// ------------------------------------------------------------------ vines (one stake per node, rows run along z)
export function buildVineGeos(): { plant: THREE.BufferGeometry; grapes: THREE.BufferGeometry } {
  const wood = lin(0x6a4a2c), leafA = lin(0x4a7a26), leafB = lin(0x6e9a30);
  const parts: THREE.BufferGeometry[] = [];
  const stake = new THREE.BoxGeometry(0.035, 0.64, 0.035);
  stake.translate(0, 0.32, 0);
  parts.push(colorize(prep(stake), () => wood));
  const wire = new THREE.BoxGeometry(0.01, 0.01, 1.0);
  wire.translate(0, 0.52, 0);
  parts.push(colorize(prep(wire), () => [0.28, 0.27, 0.25]));
  const trunk = new THREE.CylinderGeometry(0.016, 0.03, 0.46, 5);
  trunk.rotateZ(0.14);
  trunk.translate(0.035, 0.23, 0.02);
  parts.push(colorize(prep(trunk), () => wood));
  for (let k = 0; k < 5; k++) {
    const z = -0.4 + k * 0.2 + (hash2(k, 1, 33) - 0.5) * 0.06;
    const y = 0.44 + hash2(k, 2, 33) * 0.1;
    const b = blob(0.1 + hash2(k, 3, 33) * 0.04, (hash2(k, 4, 33) - 0.5) * 0.07, y, z, k + 3, 1, 0.85);
    colorize(b, (x, yy, zz) => {
      const c = hash2(Math.round(x * 50), Math.round(yy * 50) + Math.round(zz * 50) * 3, 7) < 0.5 ? leafA : leafB;
      const kk = 0.7 + (yy - 0.34) * 1.4;
      return [c[0] * kk, c[1] * kk, c[2] * kk];
    });
    parts.push(b);
  }
  const plant = merge(parts);
  const gp: THREE.BufferGeometry[] = [];
  for (let c = 0; c < 5; c++) {
    const cz = -0.36 + c * 0.18 + (hash2(c, 5, 34) - 0.5) * 0.06;
    const cx = (hash2(c, 6, 34) > 0.5 ? 1 : -1) * (0.11 + hash2(c, 7, 34) * 0.03);
    for (let k = 0; k < 8; k++) {
      const row = k < 3 ? 0 : k < 6 ? 1 : 2;
      const sp = new THREE.IcosahedronGeometry(0.029, 0);
      sp.translate(cx + (hash2(c, k, 35) - 0.5) * (0.07 - row * 0.016), 0.41 - row * 0.045, cz + (hash2(c, k, 37) - 0.5) * (0.07 - row * 0.016));
      gp.push(colorize(prep(sp), () => [0.9, 0.9, 0.9]));
    }
  }
  return { plant, grapes: merge(gp) };
}

export function buildGrassTuft(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // slender blades fanning out from a common root, darker at the base
  for (let k = 0; k < 9; k++) {
    const h = 0.11 + hash2(k, 7, 1) * 0.17;
    const g = new THREE.BufferGeometry();
    const w = 0.012 + hash2(k, 12, 1) * 0.01;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0, h, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const a = (k / 9) * Math.PI * 2 + hash2(k, 9, 1) * 0.8;
    const r = hash2(k, 10, 1) * 0.07;
    g.rotateX(0.15 + hash2(k, 8, 1) * 0.45);
    g.rotateY(a);
    g.translate(Math.sin(a) * r, 0, Math.cos(a) * r);
    parts.push(g);
  }
  const geo = mergeGeometries(parts, false)!;
  colorize(geo, (_x, y) => {
    const k = 0.5 + y * 3.4;
    return [k * (1 + y * 0.5), k, k * (1 - y * 0.8)];
  });
  return twoSidedUp(geo);
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

// ------------------------------------------------------------------ pigs
/** Where the head pivots on the body, and where the legs hang from it (x, z at PIG_HIP_Y). */
export const PIG_NECK: [number, number, number] = [0, 0.2, 0.15];
export const PIG_HIP_Y = 0.14;
export const PIG_HIPS: [number, number][] = [[-0.07, 0.105], [0.07, 0.105], [-0.07, -0.11], [0.07, -0.11]];

/**
 * A farm pig facing +z at full size, the ground at y 0. `body` is the barrel with its curly tail
 * and mud splashed up the belly, `spotted` the same barrel with the black patches of an Old Spot;
 * `head` pivots at PIG_NECK (its origin) with the jowls, the snout and the flaps of ears; `leg`
 * hangs from the hip at its origin down to a muddy trotter. `good` is a whole pig in one piece
 * for carriers' shoulders and ships' decks.
 */
export function buildPigGeos() {
  const skin = lin(0xeaa597), belly = lin(0xdc988a), snout = lin(0xe28c86), mud = lin(0x5a4230);
  const spot = lin(0x2c2527), hoof = lin(0x3a2f29), dark = lin(0x151011);
  const mix = (a: number[], b: number[], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const ramp = (e0: number, e1: number, v: number) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const skinAt = (x: number, y: number, z: number, spotted: boolean): [number, number, number] => {
    let c = mix(skin, belly, ramp(0.19, 0.1, y));
    if (spotted) c = mix(c, spot, 0.92 * ramp(0.22, 0.55, Math.sin(x * 24 + 1.7) * Math.sin(y * 21 + 0.4) * Math.sin(z * 17 + 2.3) + 0.45 * Math.sin(z * 9 + x * 6 + 0.5)));
    c = mix(c, mud, ramp(0.12, 0.065, y) * 0.6);
    const k = 0.95 + hash2(Math.round(x * 70), Math.round(y * 70) + Math.round(z * 70) * 3, 3) * 0.1;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  const flat = (g: THREE.BufferGeometry, c: [number, number, number]) => colorize(g, () => c);

  // the barrel, turned along z: a big round ham, a deep belly, shoulders narrowing to the neck
  const key = [[0, -0.232], [0.06, -0.224], [0.098, -0.2], [0.122, -0.16], [0.134, -0.105], [0.137, -0.04],
    [0.134, 0.03], [0.126, 0.09], [0.112, 0.14], [0.092, 0.178], [0.066, 0.2], [0, 0.212]];
  const prof = new THREE.SplineCurve(key.map(([r, a]) => new THREE.Vector2(r, a))).getPoints(22);
  for (const v of prof) v.x = Math.max(0, v.x);
  const barrel = () => {
    let g: THREE.BufferGeometry = new THREE.LatheGeometry(prof, 24);
    g.rotateX(Math.PI / 2);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-5);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i);
      // flatter along the back and a little raised over the ham, deeper in the belly, narrower in the flanks
      const ny = y > 0 ? y * 0.9 + 0.012 * Math.max(0, Math.cos((z + 0.12) * 9)) * (y / 0.14) : y * 1.06;
      p.setXYZ(i, p.getX(i) * 0.88, ny, z);
    }
    g.computeVertexNormals();
    g.translate(0, 0.205, 0);
    return g;
  };
  const tail = () => {
    const g = new THREE.TorusGeometry(0.024, 0.0078, 5, 12, Math.PI * 1.6);
    g.rotateZ(0.6);
    g.translate(0, 0.258, -0.228);
    return g;
  };
  const skinned = (g: THREE.BufferGeometry, spotted = false) => colorize(g, (x, y, z) => skinAt(x, y, z, spotted));
  const body = merge([skinned(barrel()), skinned(tail())]);
  const spotted = merge([skinned(barrel(), true), skinned(tail())]);

  const headParts = () => {
    const N = PIG_NECK;
    const skinHead = (g: THREE.BufferGeometry, k = 1) => colorize(g, (x, y, z) => {
      const c = skinAt(x + N[0], y + N[1], z + N[2], false);
      return [c[0] * k, c[1] * k * 0.98, c[2] * k * 0.98];
    });
    const skull = new THREE.SphereGeometry(0.095, 16, 12);
    skull.scale(1, 0.92, 1.12);
    skull.translate(0, 0.012, 0.075);
    const jowl = new THREE.SphereGeometry(0.072, 12, 9);
    jowl.scale(1.12, 0.8, 1);
    jowl.translate(0, -0.036, 0.078);
    const muzzle = new THREE.CylinderGeometry(0.045, 0.052, 0.07, 16);
    muzzle.rotateX(Math.PI / 2);
    muzzle.translate(0, -0.012, 0.19);
    const disc = new THREE.CircleGeometry(0.045, 16);
    disc.translate(0, -0.012, 0.2255);
    const parts = [skinHead(skull), skinHead(jowl), skinHead(muzzle), flat(disc, snout)];
    for (const s of [-1, 1]) {
      const nostril = new THREE.CircleGeometry(0.009, 8);
      nostril.translate(s * 0.017, -0.014, 0.2265);
      const eye = new THREE.SphereGeometry(0.012, 8, 6);
      eye.translate(s * 0.058, 0.045, 0.15);
      // a thin rounded flap hinged on the crown, pricked forward, up and out
      const ear = new THREE.SphereGeometry(0.045, 12, 6);
      ear.scale(0.8, 0.22, 1.3);
      ear.translate(0, 0, 0.052);
      ear.rotateX(-0.55);
      ear.rotateY(s * 0.35);
      ear.rotateZ(-s * 0.3);
      ear.translate(s * 0.05, 0.075, 0.035);
      parts.push(flat(nostril, dark), flat(eye, dark), skinHead(ear, 0.94));
    }
    return parts;
  };
  const head = merge(headParts());

  const legParts = () => {
    const g = new THREE.CylinderGeometry(0.036, 0.03, PIG_HIP_Y, 8);
    g.translate(0, -PIG_HIP_Y / 2, 0);
    return colorize(g, (x, y, z) => (y < -PIG_HIP_Y + 0.024 ? hoof : mix(skinAt(x, y + PIG_HIP_Y, z, false), mud, ramp(-0.04, -0.105, y) * 0.8)));
  };
  const leg = prep(legParts());

  // one piece: legs hanging straight, a little smaller than the herd's pigs
  const whole: THREE.BufferGeometry[] = [skinned(barrel()), skinned(tail())];
  for (const hp of headParts()) whole.push(hp.translate(PIG_NECK[0], PIG_NECK[1], PIG_NECK[2]));
  for (const [hx, hz] of PIG_HIPS) whole.push(legParts().translate(hx, PIG_HIP_Y, hz));
  const good = merge(whole);
  good.scale(0.55, 0.55, 0.55);
  return { body, spotted, head, leg, good };
}

// ------------------------------------------------------------------ donkeys
/** A pack donkey facing +z: barrel body with head, ears, mane and tail; legs pivot at the hip
 *  (y = 0.34); the pack saddle is drawn on top only while it carries something. */
export function buildDonkeyGeos() {
  const coat: [number, number, number] = [0.34, 0.3, 0.27], pale: [number, number, number] = [0.6, 0.55, 0.49], dark: [number, number, number] = [0.13, 0.11, 0.09];
  const tint = (g: THREE.BufferGeometry, c: [number, number, number], v = 0.08) => colorize(g, (x, y, z) => {
    const k = 1 - v + hash2(Math.round(x * 60), Math.round(y * 60) + Math.round(z * 60) * 3, 5) * v * 2;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
  const body = new THREE.SphereGeometry(0.19, 12, 9);
  body.scale(0.85, 0.8, 1.5);
  body.translate(0, 0.47, 0);
  colorize(body, (_x, y) => (y < 0.4 ? [pale[0] * 0.85, pale[1] * 0.85, pale[2] * 0.85] : coat));
  const neck = new THREE.CylinderGeometry(0.065, 0.09, 0.32, 8);
  neck.rotateX(-0.8);
  neck.translate(0, 0.62, 0.25);
  const head = new THREE.SphereGeometry(0.085, 10, 8);
  head.scale(0.8, 0.85, 1.55);
  head.translate(0, 0.745, 0.41);
  const muzzle = new THREE.SphereGeometry(0.058, 8, 6);
  muzzle.scale(0.85, 0.72, 1);
  muzzle.translate(0, 0.725, 0.53);
  const mane = new THREE.BoxGeometry(0.035, 0.07, 0.3);
  mane.rotateX(-0.8);
  mane.translate(0, 0.72, 0.23);
  const tail = new THREE.CylinderGeometry(0.012, 0.018, 0.22, 5);
  tail.rotateX(0.25);
  tail.translate(0, 0.4, -0.3);
  const tuft = new THREE.SphereGeometry(0.032, 6, 5);
  tuft.translate(0, 0.29, -0.325);
  const ears: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.03, 0.17, 6);
    ear.rotateX(-0.3);
    ear.rotateZ(s * 0.4);
    ear.translate(s * 0.055, 0.87, 0.35);
    ears.push(tint(ear, coat));
  }
  const eyes: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.014, 6, 5);
    eye.translate(s * 0.058, 0.775, 0.47);
    eyes.push(tint(eye, [0.05, 0.04, 0.03], 0));
  }
  const bodyG = merge([body, tint(neck, coat), tint(head, coat), tint(muzzle, pale), tint(mane, dark), tint(tail, coat), tint(tuft, dark), ...ears, ...eyes]);
  const leg = new THREE.BoxGeometry(0.048, 0.34, 0.048);
  leg.translate(0, -0.17, 0);
  colorize(leg, (_x, y) => (y < -0.3 ? dark : y < -0.2 ? pale : coat));
  // pack saddle: a striped blanket over the back with a girth strap
  const blanket = new THREE.BoxGeometry(0.4, 0.035, 0.3);
  blanket.translate(0, 0.615, 0.0);
  colorize(blanket, (x) => (Math.sin(x * 40) > 0 ? [0.5, 0.14, 0.11] : [0.7, 0.62, 0.45]));
  const strap = new THREE.TorusGeometry(0.175, 0.012, 5, 16);
  strap.rotateY(Math.PI / 2);
  strap.scale(1, 0.85, 1);
  strap.translate(0, 0.47, 0.02);
  const pack = merge([blanket, tint(strap, [0.35, 0.25, 0.16], 0)]);
  return { body: prep(bodyG), leg: prep(leg), pack: prep(pack) };
}

// ------------------------------------------------------------------ catapult
/**
 * A torsion catapult on four wheels, facing +z. `frame` is the chassis with the A-frame and the
 * windlass; `wheel` is one wheel centred on its axle (placed four times); `arm` is the throwing
 * arm pivoting about the x axis at its origin, beam along +y with the cup at the far end and the
 * counterweight past the pivot; `stone` sits in the cup (arm space); `flag` is a white pennant
 * tinted per instance with the owner's colour. Axle centres: x ±0.36, y 0.22, z ±0.38.
 */
export function buildCatapultGeos() {
  const wood = lin(0x8a6640), woodD = lin(0x5a4028), iron = lin(0x3a3c42), rope = lin(0x9a8862), stone = lin(0x6e6a64);
  const tint = (g: THREE.BufferGeometry, c: [number, number, number], v = 0.1) => colorize(g, (x, y, z) => {
    const k = 1 - v + hash2(Math.round(x * 50), Math.round(y * 50) + Math.round(z * 50) * 3, 9) * v * 2;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
  const B = (w: number, h: number, d: number, x: number, y: number, z: number, c = wood, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return tint(g, c);
  };
  const C = (r: number, h: number, x: number, y: number, z: number, c = wood, axis: 'x' | 'y' | 'z' = 'x', seg = 8) => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    return tint(g, c);
  };
  const frame: THREE.BufferGeometry[] = [];
  // chassis rails and cross beams
  for (const sx of [-1, 1]) frame.push(B(0.09, 0.1, 1.12, sx * 0.3, 0.3, 0));
  for (const z of [-0.48, 0, 0.48]) frame.push(B(0.7, 0.08, 0.09, 0, 0.3, z, woodD));
  // axles
  for (const z of [-0.38, 0.38]) frame.push(C(0.025, 0.82, 0, 0.22, z, iron));
  // A-frame: posts, braces and the padded stop bar
  for (const sx of [-1, 1]) {
    frame.push(B(0.07, 0.62, 0.07, sx * 0.3, 0.64, 0.14));
    frame.push(B(0.06, 0.62, 0.06, sx * 0.3, 0.6, 0.36, wood, -0.62));
    frame.push(B(0.06, 0.5, 0.06, sx * 0.3, 0.52, -0.1, wood, 0.55));
  }
  frame.push(B(0.76, 0.08, 0.1, 0, 0.95, 0.14, woodD));
  frame.push(B(0.5, 0.11, 0.15, 0, 0.955, 0.14, rope, 0, 0, 0));
  // torsion skein at the pivot and the windlass at the back
  frame.push(C(0.065, 0.62, 0, 0.45, 0.12, rope, 'x', 10));
  frame.push(C(0.045, 0.74, 0, 0.42, -0.44, woodD));
  for (const sx of [-1, 1]) for (const a of [0, Math.PI / 2]) frame.push(B(0.03, 0.26, 0.03, sx * 0.4, 0.42, -0.44, woodD, a));
  // pennant pole on the rear left post
  frame.push(B(0.022, 0.55, 0.022, -0.34, 1.2, 0.14, woodD));
  const wheel: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(0.15, 0.028, 6, 14);
  rim.rotateY(Math.PI / 2);
  wheel.push(tint(rim, woodD));
  wheel.push(C(0.045, 0.09, 0, 0, 0, iron));
  for (let k = 0; k < 4; k++) wheel.push(B(0.022, 0.3, 0.025, 0, 0, 0, wood, (k * Math.PI) / 4));
  const arm: THREE.BufferGeometry[] = [];
  arm.push(B(0.065, 1.22, 0.065, 0, 0.36, 0));
  arm.push(B(0.2, 0.17, 0.17, 0, -0.2, 0, stone));
  arm.push(tint(new THREE.TorusGeometry(0.105, 0.022, 6, 12).rotateX(Math.PI / 2).translate(0, 0.99, 0), iron, 0.04));
  arm.push(C(0.1, 0.05, 0, 0.955, 0, woodD, 'y', 10));
  arm.push(B(0.03, 0.4, 0.03, 0, 0.75, 0.05, iron));
  const st = new THREE.DodecahedronGeometry(0.1, 0);
  st.translate(0, 1.07, 0);
  const pennant = new THREE.BoxGeometry(0.26, 0.13, 0.012);
  pennant.translate(-0.34 + 0.14, 1.4, 0.14);
  colorize(pennant, () => [1, 1, 1]);
  return { frame: merge(frame), wheel: merge(wheel), arm: merge(arm), stone: prep(tint(st, stone, 0.18)), flag: prep(pennant) };
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
  const amphora = (() => {
    const prof = [[0.0, 0.0], [0.035, 0.012], [0.07, 0.06], [0.085, 0.12], [0.078, 0.18], [0.05, 0.23], [0.03, 0.26], [0.032, 0.29], [0.042, 0.3]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const body = new THREE.LatheGeometry(prof, 12);
    const bc = lin(0xb4643a), band = lin(0x3a1c14);
    colorize(body, (_x, y) => (y > 0.13 && y < 0.16 ? band : [bc[0] * (0.85 + y), bc[1] * (0.85 + y), bc[2] * (0.85 + y)]));
    const hs: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const hdl = new THREE.TorusGeometry(0.035, 0.009, 5, 8, Math.PI);
      hdl.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      hdl.translate(sx * 0.045, 0.235, 0);
      hs.push(c(hdl, 0xa85a34));
    }
    return merge([body, ...hs]);
  })();
  const rod = merge([(() => { const g = new THREE.CylinderGeometry(0.006, 0.012, 0.6, 4); g.translate(0, 0.3, 0); return c(g, 0x9a7a50); })()]);

  return {
    log: logG, board: c(prep(board), 0xc8a070), stone: c(prep(stone), 0x8a867e, 0.2),
    grain: sack(0xd8c070), flour: sack(0xf0ece0), bread: c(prep(bread), 0xb07030),
    fish: merge([c(fish, 0xa8b8c0), c(fishTail, 0x8898a0)]), meat: merge([c(meat, 0xb03a30), c(bone, 0xf0e8d8)]),
    pig: buildPigGeos().good, water: merge([c(bucket, 0x8a6a48), c(waterTop, 0x4a8ab0, 0.02)]),
    coal: lump(0x222224, 0), ironore: lump(0x8a4a30, 1), goldore: lump(0xc8a040, 2),
    iron: bar(0x5a5e64), gold: bar(0xe8b840), sword, bow, wine: amphora,
    axe, pickaxe, saw, hammer, shovel, scythe, rod,
  };
}
