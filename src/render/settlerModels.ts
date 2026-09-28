// Chunky, big-headed settler parts in the spirit of the Settlers III sprites.
// Every vertex carries an `aTint` code telling the settler shader how to colour it:
// tint 0 keeps the vertex colour, 1 multiplies by instanceColor, 2 by instanceColor2.
// Adding METAL or GLOSS switches the surface to shiny metal or glossy (eyes, lamp glass).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const RAW = 0, T1 = 1, T2 = 2, METAL = 3, GLOSS = 6;

type RGB = [number, number, number];
type ColorFn = (x: number, y: number, z: number) => RGB;

const lin = (hex: number): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const WHITE: RGB = [1, 1, 1];
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Rig pivots in settler space: feet on y = 0, facing +z. The renderer poses parts around these. */
export const RIG = {
  hipY: 0.2, hipX: 0.048,
  shoulderY: 0.382, shoulderX: 0.118,
  handY: -0.178,
  neckY: 0.445,
  headY: 0.565,
  eyeY: 0.577,
};

// head ellipsoid radii; hair and hats are built as shells around the same centre
const HR = 0.125, HSY = 0.94, HSZ = 0.95;

/** Round out the lower half of the head into chubby cheeks (applied to head and hair alike). */
function cheeks(x: number, y: number, z: number): [number, number, number] {
  const k = THREE.MathUtils.clamp((RIG.headY - y) / (HR * HSY), 0, 1);
  const s = Math.sin(k * Math.PI);
  return [x * (1 + 0.07 * s), y, z * (1 + 0.03 * s)];
}

/** Attach colour and tint attributes, dropping uvs so every part merges cleanly. */
function part(g: THREE.BufferGeometry, tint: number, col: RGB | ColorFn = WHITE): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = typeof col === 'function' ? col(p.getX(i), p.getY(i), p.getZ(i)) : col;
    c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(p.count).fill(tint), 1));
  return g;
}

const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs, false)!;

function ell(rx: number, ry: number, rz: number, x: number, y: number, z: number, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.rotateY(-Math.PI / 2); // move the uv seam to the back
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

function capsule(r: number, len: number, y: number) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, y, 0);
  return g;
}

function lathe(pts: [number, number][], seg = 20, phiStart = 0, phiLen = Math.PI * 2) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
}

/** Azimuth profile: value at the front (phi = 0), the sides and the back. */
function around(front: number, side: number, back: number) {
  return (phi: number) => {
    const a = Math.abs(phi);
    return a < Math.PI / 2
      ? THREE.MathUtils.lerp(front, side, smooth(0, 1, a / (Math.PI / 2)))
      : THREE.MathUtils.lerp(side, back, smooth(0, 1, (a - Math.PI / 2) / (Math.PI / 2)));
  };
}

interface ShellOpts {
  r: number;
  tMax: (phi: number) => number;
  tMin?: (phi: number) => number;
  bump?: (phi: number, theta: number) => number;
  phiStart?: number;
  phiLen?: number;
  ws?: number;
  hs?: number;
}

/** A cap-like patch of the head ellipsoid, from polar angle tMin to tMax per azimuth (0 = front). */
function shell(o: ShellOpts): THREE.BufferGeometry {
  const ws = o.ws ?? 28, hs = o.hs ?? 10;
  const p0 = o.phiStart ?? -Math.PI, pl = o.phiLen ?? Math.PI * 2;
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let j = 0; j <= hs; j++) {
    for (let i = 0; i <= ws; i++) {
      const phi = p0 + (i / ws) * pl;
      const t0 = o.tMin ? o.tMin(phi) : 0, t1 = o.tMax(phi);
      const th = t0 + (t1 - t0) * (j / hs);
      const r = o.r + (o.bump ? o.bump(phi, th) : 0);
      const dx = Math.sin(th) * Math.sin(phi), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(phi);
      const [x, y, z] = cheeks(dx * r, RIG.headY + dy * r * HSY, dz * r * HSZ);
      pos.push(x, y, z);
      const n = new THREE.Vector3(dx, dy / HSY, dz / HSZ).normalize();
      nrm.push(n.x, n.y, n.z);
    }
  }
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < ws; i++) {
      const a = j * (ws + 1) + i, b = a + 1, c = a + ws + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** A thicker rim band along a shell's lower edge (hat bands, helmet rims, hood edges). */
function rimBand(r: number, tMax: (phi: number) => number, width = 0.05) {
  return shell({ r, tMin: (p) => tMax(p) - width, tMax: (p) => tMax(p) + 0.012, hs: 3 });
}

const PI = Math.PI;

// ------------------------------------------------------------------ body parts
function buildLeg() {
  const leg = part(capsule(0.04, 0.11, -0.085), T1, (_x, y) => {
    const k = 0.85 + (y + 0.15) * 0.8;
    return [k, k, k];
  });
  const leather = lin(0x6b4424), sole = lin(0x2e1c10);
  const boot = ell(0.05, 0.042, 0.078, 0, -0.166, 0.02, 14, 8);
  const bp = boot.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) if (bp.getY(i) < -0.2) bp.setY(i, -0.2);
  part(boot, RAW, (_x, y) => (y < -0.193 ? sole : [leather[0] * (0.8 + (y + 0.2) * 4), leather[1] * (0.8 + (y + 0.2) * 4), leather[2] * (0.8 + (y + 0.2) * 4)]));
  const cuff = part(ell(0.047, 0.02, 0.05, 0, -0.132, 0.0, 12, 6), RAW, lin(0x8a5a34));
  return merge([leg, boot, cuff]);
}

function buildTorso() {
  const tunic = lathe([
    [0.001, 0.148], [0.114, 0.146], [0.121, 0.16], [0.113, 0.2], [0.104, 0.24], [0.109, 0.29],
    [0.112, 0.33], [0.102, 0.372], [0.078, 0.41], [0.046, 0.438], [0.001, 0.444],
  ], 22);
  tunic.scale(1, 1, 0.86);
  part(tunic, T1, (_x, y) => {
    if (y < 0.168) return [0.72, 0.72, 0.72]; // darker hem trim
    const k = 0.88 + (y - 0.17) * 0.5;
    return [k, k, k];
  });
  const belt = lathe([[0.1, 0.221], [0.111, 0.223], [0.111, 0.255], [0.1, 0.257]], 22);
  belt.scale(1, 1, 0.86);
  part(belt, RAW, lin(0x4a2e18));
  const buckle = new THREE.BoxGeometry(0.032, 0.026, 0.01);
  buckle.translate(0, 0.239, 0.098);
  part(buckle, RAW + METAL, lin(0xd8b050));
  return merge([tunic, belt, buckle]);
}

function buildArm() {
  const sleeve = part(ell(0.05, 0.056, 0.05, 0, -0.015, 0, 12, 8), T1, [0.92, 0.92, 0.92]);
  const arm = part(capsule(0.029, 0.1, -0.095), T2);
  const hand = part(ell(0.037, 0.039, 0.036, 0, RIG.handY, 0.004, 12, 8), T2, [1, 0.95, 0.92]);
  return merge([sleeve, arm, hand]);
}

function buildApron() {
  const g = lathe([[0.123, 0.13], [0.12, 0.2], [0.112, 0.24], [0.117, 0.29], [0.117, 0.336]], 12, -1.15, 2.3);
  g.scale(1, 1, 0.86);
  return part(g, T1, (_x, y) => {
    const k = y < 0.145 ? 0.8 : 1;
    return [k, k, k];
  });
}

function buildShield() {
  const g = lathe([[0.001, -0.012], [0.1, -0.008], [0.114, 0.0], [0.1, 0.012], [0.001, 0.02]], 20);
  g.rotateX(PI / 2);
  // player-coloured face with a metal rim
  const face = part(g, T1);
  const rimTint = new Float32Array((face.getAttribute('aTint') as THREE.BufferAttribute).array);
  const p = face.getAttribute('position') as THREE.BufferAttribute;
  const col = face.getAttribute('color') as THREE.BufferAttribute;
  const steel = lin(0xa8acb0);
  for (let i = 0; i < p.count; i++) {
    if (Math.hypot(p.getX(i), p.getY(i)) > 0.094) {
      rimTint[i] = RAW + METAL;
      col.setXYZ(i, steel[0], steel[1], steel[2]);
    }
  }
  face.setAttribute('aTint', new THREE.BufferAttribute(rimTint, 1));
  const boss = part(ell(0.03, 0.03, 0.02, 0, 0, 0.02, 10, 6), RAW + METAL, lin(0xc8ccd0));
  return merge([face, boss]);
}

// ------------------------------------------------------------------ heads, faces and hair
function buildHeadBase(): THREE.BufferGeometry[] {
  const head = ell(HR, HR * HSY, HR * HSZ, 0, RIG.headY, 0, 22, 16);
  const hp = head.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    const [x, y, z] = cheeks(hp.getX(i), hp.getY(i), hp.getZ(i));
    hp.setXYZ(i, x, y, z);
  }
  const blush: RGB = [1.0, 0.62, 0.6];
  part(head, T1, (x, y, z) => {
    let w = 0;
    for (const s of [-1, 1]) {
      const d2 = (x - s * 0.07) ** 2 + ((y - 0.528) * 1.2) ** 2;
      w = Math.max(w, Math.exp(-d2 / 0.0007) * smooth(0.03, 0.08, z));
    }
    const ao = 0.86 + 0.14 * smooth(0.45, 0.52, y);
    return [ao * (1 + (blush[0] - 1) * w * 0.55), ao * (1 + (blush[1] - 1) * w * 0.55), ao * (1 + (blush[2] - 1) * w * 0.55)];
  });
  const nose = part(ell(0.025, 0.021, 0.02, 0, 0.542, 0.114, 10, 8), T1, [1, 0.84, 0.78]);
  const ears = [-1, 1].map((s) => part(ell(0.017, 0.03, 0.024, s * 0.128, 0.552, -0.008, 10, 8), T1, [1, 0.86, 0.8]));
  // smile
  const mouth = new THREE.TorusGeometry(0.019, 0.0048, 4, 10, PI);
  mouth.rotateZ(PI);
  mouth.rotateX(0.45);
  mouth.translate(0, 0.516, 0.106);
  part(mouth, RAW, lin(0x5a2418));
  // eyebrows in hair colour, slightly raised at the inner end for a friendly look
  const brows = [-1, 1].map((s) => {
    const b = new THREE.CapsuleGeometry(0.0062, 0.022, 2, 6);
    b.rotateZ(PI / 2 - s * 0.2);
    b.rotateX(-0.42);
    b.translate(s * 0.047, 0.617, 0.1);
    return part(b, T2);
  });
  return [head, nose, ...ears, mouth, ...brows];
}

function tousled(): THREE.BufferGeometry[] {
  const tMax = around(0.33 * PI, 0.5 * PI, 0.6 * PI);
  const hair = shell({
    r: HR + 0.011,
    tMax: (p) => tMax(p) + 0.05 * (Math.abs(Math.sin(p * 6.5)) - 0.5),
    bump: (p, t) => 0.006 * Math.sin(p * 5 + t * 9) + 0.004 * Math.sin(p * 11),
    ws: 40,
  });
  return [part(hair, T2, (_x, y) => {
    const k = 0.82 + 0.25 * smooth(0.55, 0.69, y);
    return [k, k, k];
  })];
}

/** A little cowlick for tousled hair; separate so hats can hide it. */
function buildTuft() {
  const tuft = new THREE.ConeGeometry(0.022, 0.06, 6);
  tuft.rotateX(0.7);
  tuft.translate(0.01, RIG.headY + HR * HSY + 0.018, 0.015);
  return part(tuft, T1);
}

function bowl(): THREE.BufferGeometry[] {
  const tMax = around(0.37 * PI, 0.52 * PI, 0.56 * PI);
  const hair = shell({ r: HR + 0.014, tMax, bump: (p, t) => 0.009 * Math.pow(t / tMax(p), 5), ws: 32 });
  return [part(hair, T2, (_x, y) => {
    const k = 0.8 + 0.3 * smooth(0.56, 0.7, y);
    return [k, k, k];
  })];
}

function longHair(): THREE.BufferGeometry[] {
  const tMax = (p: number) => {
    const a = Math.abs(p);
    return THREE.MathUtils.lerp(0.34 * PI, 0.72 * PI, smooth(0.55, 1.25, a));
  };
  const hair = shell({
    r: HR + 0.012,
    tMax,
    bump: (p, t) => Math.max(0, t - 0.5 * PI) * 0.06 - 0.006 * Math.exp(-((p / 0.12) ** 2)) * (t < 0.3 * PI ? 1 : 0),
    ws: 36,
  });
  const back = ell(0.11, 0.1, 0.07, 0, 0.47, -0.072, 14, 10);
  return [part(hair, T2, (_x, y) => {
    const k = 0.8 + 0.28 * smooth(0.5, 0.7, y);
    return [k, k, k];
  }), part(back, T2, [0.82, 0.82, 0.82])];
}

function bun(): THREE.BufferGeometry[] {
  const tMax = around(0.36 * PI, 0.5 * PI, 0.58 * PI);
  const hair = shell({ r: HR + 0.009, tMax, bump: (p) => 0.003 * Math.sin(p * 14), ws: 32 });
  const knot = ell(0.05, 0.048, 0.048, 0, 0.66, -0.098, 12, 8);
  const tie = new THREE.TorusGeometry(0.03, 0.008, 5, 12);
  tie.rotateX(-0.9);
  tie.translate(0, 0.645, -0.08);
  return [part(hair, T2, (_x, y) => {
    const k = 0.84 + 0.24 * smooth(0.55, 0.69, y);
    return [k, k, k];
  }), part(knot, T2), part(tie, RAW, lin(0xc03a3a))];
}

function beard(): THREE.BufferGeometry[] {
  const b = ell(0.106, 0.076, 0.086, 0, 0.487, 0.036, 16, 10);
  const stache = [-1, 1].map((s) => {
    const m = ell(0.027, 0.012, 0.014, 0, 0, 0, 10, 6);
    m.rotateZ(-s * 0.35);
    m.translate(s * 0.024, 0.525, 0.117);
    return part(m, T2);
  });
  return [part(b, T2, (_x, y) => {
    const k = 0.72 + 0.3 * smooth(0.42, 0.53, y);
    return [k, k, k];
  }), ...stache];
}

function baldFringe(): THREE.BufferGeometry[] {
  const g = shell({ r: HR + 0.008, tMin: () => 0.36 * PI, tMax: () => 0.58 * PI, phiStart: 1.1, phiLen: 2 * PI - 2.2, ws: 20, hs: 4 });
  return [part(g, T2, [0.85, 0.85, 0.85])];
}

export const HAIR_STYLES = ['tousled', 'bowl', 'long', 'bun', 'bald', 'bearded'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

function buildHead(style: HairStyle) {
  const parts = buildHeadBase();
  if (style === 'tousled') parts.push(...tousled());
  else if (style === 'bowl') parts.push(...bowl());
  else if (style === 'long') parts.push(...longHair());
  else if (style === 'bun') parts.push(...bun());
  else if (style === 'bald') parts.push(...baldFringe(), ...beard());
  else parts.push(...tousled(), ...beard());
  return merge(parts);
}

/** Big glossy eyes with a catch-light; separate so the renderer can make them blink. */
function buildEyes() {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const e = ell(0.0165, 0.022, 0.011, 0, 0, 0, 10, 8);
    e.rotateY(s * 0.36);
    e.translate(s * 0.044, RIG.eyeY, 0.106);
    parts.push(part(e, RAW + GLOSS, lin(0x1a120e)));
    const h = ell(0.0056, 0.0056, 0.004, s * 0.044 + 0.006, RIG.eyeY + 0.008, 0.1165, 6, 4);
    parts.push(part(h, RAW, [1, 1, 1]));
  }
  return merge(parts);
}

// ------------------------------------------------------------------ hats
export const HATS = ['cap', 'helmet', 'straw', 'hood', 'toque', 'miner', 'bandana'] as const;
export type Hat = (typeof HATS)[number];

const shade = (lo: number, hi: number, y0: number, y1: number): ColorFn => (_x, y) => {
  const k = lo + (hi - lo) * smooth(y0, y1, y);
  return [k, k, k];
};

function buildHat(hat: Hat): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (hat === 'cap') {
    const tMax = around(0.33 * PI, 0.37 * PI, 0.43 * PI);
    parts.push(part(shell({ r: HR + 0.021, tMax }), T1, shade(0.85, 1.05, 0.6, 0.7)));
    parts.push(part(rimBand(HR + 0.028, tMax, 0.13), T2, [0.9, 0.9, 0.9]));
    const slouch = ell(0.078, 0.05, 0.088, 0, 0, 0, 14, 8);
    slouch.rotateX(0.55);
    slouch.translate(0, 0.688, -0.05);
    parts.push(part(slouch, T1, [0.95, 0.95, 0.95]));
  } else if (hat === 'helmet') {
    const tMax = around(0.34 * PI, 0.46 * PI, 0.5 * PI);
    parts.push(part(shell({ r: HR + 0.022, tMax }), T1 + METAL, shade(0.85, 1.1, 0.6, 0.7)));
    parts.push(part(rimBand(HR + 0.03, tMax, 0.05), T1 + METAL, [0.78, 0.78, 0.78]));
    parts.push(part(ell(0.018, 0.055, 0.1, 0, 0.716, -0.012, 10, 8), T2, (_x, _y, z) => {
      const k = 0.85 + 0.15 * Math.sin(z * 140);
      return [k, k, k];
    }));
    parts.push(part(ell(0.016, 0.016, 0.016, 0, 0.705, 0.08, 8, 6), T1 + METAL));
  } else if (hat === 'straw') {
    const g = lathe([
      [0.001, 0.625], [0.125, 0.62], [0.2, 0.612], [0.216, 0.621], [0.21, 0.63], [0.17, 0.628],
      [0.135, 0.632], [0.132, 0.66], [0.125, 0.7], [0.105, 0.728], [0.06, 0.74], [0.001, 0.742],
    ], 24);
    part(g, T1, (x, _y, z) => {
      const k = 0.86 + 0.14 * Math.sin(Math.hypot(x, z) * 190);
      return [k, k, k];
    });
    const band = lathe([[0.133, 0.636], [0.136, 0.638], [0.135, 0.662], [0.132, 0.664]], 24);
    part(band, T2);
    for (const p of [g, band]) {
      p.translate(0, -RIG.headY, 0);
      p.rotateX(-0.12);
      p.translate(0, RIG.headY, 0);
      parts.push(p);
    }
  } else if (hat === 'hood') {
    const tMax = (p: number) => 0.3 * PI + 0.5 * PI * smooth(0.55, 1.6, Math.abs(p));
    parts.push(part(shell({ r: HR + 0.026, tMax, ws: 32 }), T1, shade(0.85, 1.05, 0.5, 0.7)));
    parts.push(part(rimBand(HR + 0.031, tMax, 0.04), T1, [0.8, 0.8, 0.8]));
    const tip = ell(0.046, 0.046, 0.085, 0, 0, 0, 10, 8);
    tip.rotateX(0.75);
    tip.translate(0, 0.63, -0.135);
    parts.push(part(tip, T1, [0.9, 0.9, 0.9]));
    const cape = lathe([[0.001, 0.352], [0.158, 0.345], [0.155, 0.368], [0.1, 0.44], [0.001, 0.452]], 20);
    cape.scale(1, 1, 0.88);
    parts.push(part(cape, T1, shade(0.75, 0.95, 0.35, 0.44)));
  } else if (hat === 'toque') {
    const g = lathe([
      [0.001, 0.618], [0.13, 0.615], [0.134, 0.668], [0.15, 0.69], [0.158, 0.73], [0.14, 0.772],
      [0.08, 0.792], [0.001, 0.795],
    ], 32);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0.675) continue;
      const a = Math.atan2(p.getX(i), p.getZ(i));
      const k = 1 + 0.06 * Math.sin(a * 8);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    parts.push(part(g, T1, (_x, y) => (y < 0.67 ? [0.9, 0.9, 0.9] : [1, 1, 1])));
  } else if (hat === 'miner') {
    const tMax = around(0.36 * PI, 0.46 * PI, 0.5 * PI);
    parts.push(part(shell({ r: HR + 0.021, tMax }), T1, shade(0.8, 1.05, 0.6, 0.7)));
    parts.push(part(rimBand(HR + 0.028, tMax, 0.05), T1, [0.7, 0.7, 0.7]));
    parts.push(part(ell(0.085, 0.011, 0.06, 0, 0.624, 0.118, 12, 6), T1, [0.7, 0.7, 0.7]));
    const lamp = new THREE.CylinderGeometry(0.026, 0.028, 0.035, 10);
    lamp.rotateX(PI / 2);
    lamp.translate(0, 0.668, 0.115);
    parts.push(part(lamp, RAW + METAL, lin(0xc09040)));
    const lens = new THREE.CylinderGeometry(0.02, 0.02, 0.006, 10);
    lens.rotateX(PI / 2);
    lens.translate(0, 0.668, 0.134);
    parts.push(part(lens, RAW + GLOSS, [2.2, 2.0, 1.2]));
  } else {
    // bandana with a knot and two tails at the back, dotted
    const dots: ColorFn = (x, y, z) => {
      const d = Math.sin(x * 170) * Math.sin(y * 170) * Math.sin(z * 170) > 0.35 ? 1.5 : 1;
      return [d, d, d];
    };
    const band = new THREE.TorusGeometry(0.133, 0.017, 8, 30);
    band.rotateX(PI / 2);
    band.scale(1, 1, 0.96);
    band.rotateX(-0.2);
    band.translate(0, 0.6, -0.004);
    parts.push(part(band, T1, dots));
    parts.push(part(ell(0.028, 0.024, 0.02, 0, 0.588, -0.136, 10, 6), T1, [0.9, 0.9, 0.9]));
    for (const s of [-1, 1]) {
      const t = ell(0.018, 0.045, 0.01, 0, 0, 0, 8, 6);
      t.rotateZ(s * 0.35);
      t.rotateX(0.3);
      t.translate(s * 0.02, 0.55, -0.138);
      parts.push(part(t, T1, [0.9, 0.9, 0.9]));
    }
  }
  return merge(parts);
}

// ------------------------------------------------------------------ pastime props (see idle.ts)
function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** A fiddle lying along +y (scroll up), its top facing +z, the body centred on the origin. */
function buildViolin() {
  // one side of the outline: lower bout, waist, upper bout
  const half: [number, number][] = [
    [0, -0.066], [0.026, -0.062], [0.041, -0.044], [0.04, -0.02], [0.027, -0.004], [0.025, 0.01],
    [0.033, 0.029], [0.03, 0.047], [0.013, 0.056], [0, 0.058],
  ];
  const pts = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  shape.splineThru(pts.slice(1).concat([pts[0]]).map(([x, y]) => new THREE.Vector2(x, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2, curveSegments: 6 });
  body.translate(0, 0, -0.008);
  const varnish = lin(0xb4561a), edge = lin(0x6a2a0c);
  part(body, RAW + GLOSS, (x, y, z) => {
    const k = Math.abs(z) > 0.009 ? 1 : 0.7; // ribs a shade darker than the plates
    const r = Math.min(1, Math.hypot(x / 0.042, y / 0.066));
    const c = r > 0.86 ? edge : varnish;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
  body.clearGroups();
  const plates = mergeVertices(body); // extrusions come unindexed; the other parts are indexed
  const ebony = lin(0x1c1410), wood = lin(0x8a4a1c);
  const neck = part(box(0.012, 0.068, 0.011, 0, 0.09, 0.002), RAW, wood);
  const board = part(box(0.014, 0.1, 0.005, 0, 0.056, 0.0148), RAW + GLOSS, ebony);
  const pegbox = part(box(0.011, 0.024, 0.012, 0, 0.135, 0.001), RAW, wood);
  const scroll = part(ell(0.009, 0.009, 0.01, 0, 0.152, 0.002, 8, 6), RAW, wood);
  const pegs = part(box(0.034, 0.004, 0.004, 0, 0.133, 0.002), RAW, ebony);
  const bridge = part(box(0.022, 0.004, 0.009, 0, -0.012, 0.016), RAW, lin(0xe0c89a));
  const tail = part(box(0.016, 0.03, 0.004, 0, -0.045, 0.0138), RAW + GLOSS, ebony);
  const chin = part(ell(0.018, 0.012, 0.005, 0.012, -0.056, 0.013, 8, 5), RAW, ebony);
  const strings = part(box(0.007, 0.16, 0.0014, 0, 0.042, 0.019), RAW + METAL, lin(0xd8d4c8));
  return merge([plates, neck, board, pegbox, scroll, pegs, bridge, tail, chin, strings]);
}

/** A fiddle bow along +y from the frog (origin) to the tip, its hair on the +z side. */
function buildBow() {
  const stick = part(new THREE.CylinderGeometry(0.0032, 0.0042, 0.3, 5).translate(0, 0.15, 0), RAW, lin(0x5a2a10));
  const hair = part(box(0.006, 0.28, 0.0016, 0, 0.152, 0.009), RAW, lin(0xf2ecdc));
  const frog = part(box(0.008, 0.024, 0.012, 0, 0.018, 0.005), RAW + GLOSS, lin(0x1c1410));
  const tip = part(box(0.006, 0.01, 0.011, 0, 0.297, 0.005), RAW, lin(0xf0ece0));
  return merge([stick, hair, frog, tip]);
}

/** A wooden fife along +x, blown at the origin, finger holes on top (+y). */
function buildFlute() {
  const tube = new THREE.CylinderGeometry(0.0078, 0.0072, 0.27, 8);
  tube.rotateZ(-PI / 2);
  tube.translate(0.1, 0, 0);
  const wood = lin(0xc89452), band = lin(0x5a3418);
  part(tube, RAW, (x) => (x < -0.022 || x > 0.222 || Math.abs(x - 0.06) < 0.006 ? band : wood));
  const holes = [0.012, 0.085, 0.105, 0.125, 0.15, 0.17, 0.19].map((x, i) =>
    part(ell(i ? 0.0034 : 0.0048, 0.0014, i ? 0.0034 : 0.0034, x, 0.0072, 0, 6, 4), RAW, lin(0x1a100a)));
  return merge([tube, ...holes]);
}

/** A leather ball stitched from red and cream panels. */
function buildBall() {
  const g = ell(0.05, 0.05, 0.05, 0, 0, 0, 14, 10);
  const red = lin(0xc4382a), cream = lin(0xeee0bc);
  return part(g, RAW, (x, y, z) => ((Math.floor((Math.atan2(x, z) / PI + 1) * 3) + (y > 0 ? 1 : 0)) & 1 ? red : cream));
}

function buildJuggleBall() {
  return part(ell(0.034, 0.034, 0.034, 0, 0, 0, 10, 8), T1, (_x, y) => {
    const k = 0.85 + 0.2 * smooth(-0.02, 0.02, y);
    return [k, k, k];
  });
}

function buildSnowball() {
  const g = ell(0.033, 0.033, 0.033, 0, 0, 0, 10, 8);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.12 * Math.sin(p.getX(i) * 160 + p.getY(i) * 90) * Math.sin(p.getZ(i) * 130);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return part(g, RAW, [0.94, 0.97, 1.0]);
}

export interface PropGeos {
  violin: THREE.BufferGeometry;
  bow: THREE.BufferGeometry;
  flute: THREE.BufferGeometry;
  ball: THREE.BufferGeometry;
  jball: THREE.BufferGeometry;
  snowball: THREE.BufferGeometry;
}

export function buildPropGeos(): PropGeos {
  return {
    violin: buildViolin(), bow: buildBow(), flute: buildFlute(), ball: buildBall(),
    jball: buildJuggleBall(), snowball: buildSnowball(),
  };
}

export interface SettlerGeos {
  leg: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  apron: THREE.BufferGeometry;
  shield: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  tuft: THREE.BufferGeometry;
  heads: Record<HairStyle, THREE.BufferGeometry>;
  hats: Record<Hat, THREE.BufferGeometry>;
}

export function buildSettlerGeos(): SettlerGeos {
  const heads = {} as Record<HairStyle, THREE.BufferGeometry>;
  for (const s of HAIR_STYLES) heads[s] = buildHead(s);
  const hats = {} as Record<Hat, THREE.BufferGeometry>;
  for (const h of HATS) hats[h] = buildHat(h);
  return {
    leg: buildLeg(), torso: buildTorso(), arm: buildArm(), apron: buildApron(), shield: buildShield(),
    eyes: buildEyes(), tuft: buildTuft(), heads, hats,
  };
}
