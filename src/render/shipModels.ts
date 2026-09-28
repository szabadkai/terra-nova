// Procedural sailing ship: a lofted clinker hull, decks and castles, mast, yard, square sail and rigging.
// Ship space: +z is the bow, y = 0 the waterline, x to starboard.
import * as THREE from 'three';
import { ModelBuilder, box, cyl, sphere } from './geom';

export const HULL_L = 2.3;
const HULL_B = 0.8;

/** Half beam of the hull at t (0 stern .. 1 bow): a full stern with a transom, a fine bow. */
export function halfBeam(t: number) {
  if (t < 0.5) {
    const u = 1 - 2 * t;
    return (HULL_B / 2) * (0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - u * u * u)));
  }
  const u = 2 * t - 1;
  return (HULL_B / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.1)));
}
/** Gunwale height: a sweeping sheer rising to both castles. */
export function sheer(t: number) {
  return 0.27 + 0.36 * Math.max(0, 1 - 2 * t) ** 2 + 0.3 * Math.max(0, 2 * t - 1) ** 2.2;
}
export function keelDepth(t: number) {
  return 0.24 * (1 - 0.55 * Math.max(0, 2 * t - 1) ** 3 - 0.25 * Math.max(0, 1 - 2 * t) ** 4);
}
const SE = 0.78; // superellipse exponent of the sections (2/n)

/** Point on a hull section: s in [-1, 1] runs port gunwale -> keel -> starboard gunwale. */
function sectionPoint(t: number, s: number, out: THREE.Vector3) {
  const hw = halfBeam(t), top = sheer(t), kd = keelDepth(t);
  const phi = Math.abs(s) * Math.PI / 2; // 0 at the gunwale, pi/2 at the keel
  const x = hw * Math.pow(Math.cos(phi), SE) * (s < 0 ? -1 : 1);
  const y = top - (top + kd) * Math.pow(Math.sin(phi), SE);
  return out.set(x, y, -HULL_L / 2 + t * HULL_L);
}

function gridGeometry(nu: number, nv: number, pt: (u: number, v: number, out: THREE.Vector3) => void, uvScale: [number, number], flip = false, swap = false) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      pt(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
      if (swap) uv.push((j / nv) * uvScale[1], (i / nu) * uvScale[0]);
      else uv.push((i / nu) * uvScale[0], (j / nv) * uvScale[1]);
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Outer hull skin between two section parameters (|s| from sFrom to sTo on both sides), used whole for
 * ships and strake by strake for hulls on the slipway. Clinker planking: each strake overlaps the next.
 */
export function hullSkin(sFrom = 0, sTo = 1, strakes = 7) {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < strakes; k++) {
      const a = sFrom + ((sTo - sFrom) * k) / strakes, b = sFrom + ((sTo - sFrom) * (k + 1)) / strakes;
      const g = gridGeometry(28, 2, (u, v, out) => {
        sectionPoint(0.001 + u * 0.998, side * (a + (b - a) * v), out);
        // clinker lap: the lower edge of each strake stands a hair proud
        const lap = (1 - v) * 0.012;
        out.x += Math.sign(out.x) * lap;
      }, [HULL_L * 0.9, 0.35], side > 0, true);
      parts.push(g);
    }
  }
  return parts;
}

export function hullStrake(k: number, strakes: number) {
  const out: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const a = k / strakes, b = (k + 1) / strakes;
    out.push(gridGeometry(28, 2, (u, v, o) => {
      sectionPoint(0.001 + u * 0.998, side * (a + (b - a) * v), o);
      o.x += Math.sign(o.x) * (1 - v) * 0.012;
    }, [HULL_L * 0.9, 0.35], side > 0, true));
  }
  return out;
}

/** Ribs (frames) of a hull on the slipway. */
export function hullRibs(mb: ModelBuilder, mat: string, n = 9) {
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let k = 1; k < n; k++) {
    const t = k / n;
    for (let j = -8; j < 8; j++) {
      sectionPoint(t, j / 8, p);
      sectionPoint(t, (j + 1) / 8, q);
      const len = p.distanceTo(q);
      const g = box(0.03, len + 0.01, 0.04);
      const ang = Math.atan2(q.x - p.x, q.y - p.y);
      mb.add(mat, g, (p.x + q.x) / 2, (p.y + q.y) / 2, p.z, 0, 0, -ang);
    }
  }
  // keel and stem
  for (let k = 0; k < 16; k++) {
    sectionPoint(k / 16, 1, p);
    sectionPoint((k + 1) / 16, 1, q);
    const len = p.distanceTo(q);
    mb.add(mat, box(0.05, 0.06, len + 0.02), (p.x + q.x) / 2, (p.y + q.y) / 2 - 0.02, (p.z + q.z) / 2, 0, -Math.atan2(q.y - p.y, q.z - p.z), 0);
  }
  mb.add(mat, box(0.05, sheer(1) + keelDepth(1) + 0.1, 0.05), 0, (sheer(1) - keelDepth(1)) / 2, HULL_L / 2 - 0.02, 0, -0.35, 0);
}

export function deckGeometry() {
  return gridGeometry(2, 24, (u, v, out) => {
    const t = 0.02 + v * 0.95;
    const hw = halfBeam(t) * 0.95;
    out.set((u * 2 - 1) * hw, Math.min(sheer(t), 0.3) - 0.07, -HULL_L / 2 + t * HULL_L);
  }, [0.8, HULL_L * 1.1], false, false);
}

export function bulwark(inner: boolean) {
  return [-1, 1].map((side) => gridGeometry(28, 1, (u, v, out) => {
    const t = 0.001 + u * 0.998;
    const hw = halfBeam(t) * (inner ? 0.955 : 1.0);
    const deck = Math.min(sheer(t), 0.3) - 0.07;
    out.set(side * hw, deck + (sheer(t) - deck) * v, -HULL_L / 2 + t * HULL_L);
  }, [HULL_L * 0.9, 0.2], inner ? side > 0 : side < 0, true));
}

export function rim() {
  return [-1, 1].map((side) => gridGeometry(28, 1, (u, v, out) => {
    const t = 0.001 + u * 0.998;
    const hw = halfBeam(t);
    out.set(side * hw * (0.95 + 0.07 * v), sheer(t) + 0.012, -HULL_L / 2 + t * HULL_L);
  }, [HULL_L, 0.1], side > 0, true));
}

/** Painted wale in the owner's colour just below the gunwale. */
export function wale() {
  return [-1, 1].map((side) => gridGeometry(28, 1, (u, v, out) => {
    const t = 0.001 + u * 0.998;
    const s = 0.12 + v * 0.07;
    sectionPoint(t, side * s, out);
    out.x += side * 0.018;
  }, [HULL_L, 0.1], side > 0));
}

export function transom() {
  // flat stern board closing the full stern
  const shape = new THREE.Shape();
  const p = new THREE.Vector3();
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) {
    sectionPoint(0.001, -1 + (k / 16) * 2, p);
    pts.push(new THREE.Vector2(p.x, p.y));
  }
  shape.setFromPoints(pts);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateY(Math.PI);
  g.translate(0, 0, -HULL_L / 2 + 0.002);
  return g;
}

export interface ShipParts {
  mb: ModelBuilder;
  mastTop: number;
  yardY: number;
  sailW: number;
  sailH: number;
  lantern: THREE.Vector3;
  flagPos: THREE.Vector3;
}

const cache = new Map<number, ShipParts>();

/** Static parts of a ship (everything except the sail and pennant, which move). */
export function shipParts(owner: number): ShipParts {
  const hit = cache.get(owner);
  if (hit) return hit;
  const mb = new ModelBuilder();
  for (const g of hullSkin()) mb.add('hull', g);
  mb.add('hull', transom());
  for (const g of bulwark(true)) mb.add('planks', g);
  for (const g of rim()) mb.add('timber', g);
  for (const g of wale()) mb.add(`trim${owner}`, g);
  mb.add('planks', deckGeometry());
  // stern castle with a cabin
  const sz = -HULL_L / 2 + 0.36;
  const deckY = 0.23;
  const castleY = sheer(0.12) - 0.02;
  mb.add('planks', box(0.62, 0.05, 0.58, 2), 0, castleY, sz);
  mb.add('timber', box(0.5, castleY - deckY, 0.46, 2), 0, (castleY + deckY) / 2, sz + 0.02);
  mb.add('dark', box(0.12, 0.17, 0.02), 0, deckY + 0.085, sz + 0.255);
  mb.add('window', box(0.07, 0.05, 0.02), -0.16, deckY + 0.14, sz + 0.255);
  mb.add('window', box(0.07, 0.05, 0.02), 0.16, deckY + 0.14, sz + 0.255);
  mb.anchors.windows.push(new THREE.Vector3(0, deckY + 0.14, sz + 0.4));
  for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) mb.add('timber', box(0.02, 0.1, 0.02), sx * 0.29, sheer(0.12) + 0.05, sz - 0.26 + k * 0.13);
  mb.add('timber', box(0.6, 0.02, 0.02), 0, sheer(0.12) + 0.1, sz - 0.28);
  for (const sx of [-1, 1]) mb.add('timber', box(0.02, 0.02, 0.56), sx * 0.29, sheer(0.12) + 0.1, sz);
  // forecastle
  const fz = HULL_L / 2 - 0.42;
  mb.add('planks', box(0.4, 0.04, 0.34, 2), 0, sheer(0.84) - 0.02, fz);
  for (const sx of [-1, 1]) mb.add('timber', box(0.02, 0.02, 0.34), sx * 0.19, sheer(0.84) + 0.08, fz);
  // mast with a crow's nest, yard, bowsprit
  const mz = 0.08, mastTop = 2.25, yardY = 1.95;
  mb.add('timber', cyl(0.028, 0.042, mastTop - deckY, 10, 2), 0, deckY, mz);
  mb.add('planks', cyl(0.1, 0.085, 0.08, 12, 1, true), 0, 1.74, mz);
  mb.add('timber', cyl(0.1, 0.1, 0.015, 12), 0, 1.74, mz);
  mb.add('timber', new THREE.CylinderGeometry(0.018, 0.018, 1.42, 8), 0, yardY, mz + 0.05, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) mb.add('timber', sphere(0.026, 6, 4), sx * 0.71, yardY, mz + 0.05);
  mb.add('timber', cyl(0.018, 0.03, 0.8, 8, 2), 0, sheer(1) - 0.05, HULL_L / 2 - 0.08, 0, Math.PI / 2 - 0.35, 0);
  mb.add('gold', sphere(0.03, 8, 6), 0, mastTop + 0.02, mz);
  // rigging: stays and shrouds as thin ropes
  const rope = (a: THREE.Vector3, b: THREE.Vector3, r = 0.006) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true);
    g.translate(0, len / 2, 0);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    mb.add('rope', g);
  };
  const top = new THREE.Vector3(0, mastTop - 0.12, mz);
  const sprit = new THREE.Vector3(0, sheer(1) + 0.22, HULL_L / 2 + 0.28);
  rope(top, sprit);
  rope(top, new THREE.Vector3(0, sheer(0.02) + 0.35, -HULL_L / 2 + 0.1));
  for (const sx of [-1, 1]) for (const dz of [-0.2, 0, 0.2]) {
    const t = (mz + dz + HULL_L / 2) / HULL_L;
    rope(new THREE.Vector3(0, 1.72, mz), new THREE.Vector3(sx * halfBeam(t) * 0.98, sheer(t), mz + dz), 0.005);
  }
  for (const sx of [-1, 1]) rope(new THREE.Vector3(sx * 0.68, yardY, mz + 0.05), new THREE.Vector3(sx * halfBeam(0.25) * 0.9, sheer(0.25), -0.45), 0.004);
  // cargo hatch, capstan, barrels, lantern
  mb.add('timber', box(0.36, 0.05, 0.42, 2), 0, deckY + 0.02, -0.36);
  mb.add('dark', box(0.3, 0.02, 0.36), 0, deckY + 0.05, -0.36);
  mb.add('wood', cyl(0.05, 0.06, 0.12, 8), 0, deckY, 0.55);
  const lantern = new THREE.Vector3(0, sheer(0.02) + 0.3, -HULL_L / 2 + 0.06);
  mb.add('iron', box(0.015, 0.3, 0.015), 0, sheer(0.02), -HULL_L / 2 + 0.06);
  mb.add('glowFire', box(0.06, 0.08, 0.06), lantern.x, lantern.y, lantern.z);
  mb.anchors.fires.push(lantern.clone());
  // rudder
  mb.add('timber', box(0.04, 0.45, 0.16, 2), 0, 0.02, -HULL_L / 2 - 0.05, 0, 0, 0);
  const parts: ShipParts = { mb, mastTop, yardY, sailW: 1.3, sailH: 1.12, lantern, flagPos: new THREE.Vector3(0, mastTop + 0.02, mz) };
  cache.set(owner, parts);
  return parts;
}

/** A square sail hung from the yard; rebuilt each frame from its billow and how far it is set. */
export class Sail {
  mesh: THREE.Mesh;
  private base: Float32Array;
  constructor(material: THREE.Material, private p: ShipParts) {
    const g = new THREE.PlaneGeometry(p.sailW, p.sailH, 10, 10);
    g.translate(0, -p.sailH / 2, 0);
    this.base = (g.getAttribute('position').array as Float32Array).slice();
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.position.set(0, p.yardY - 0.03, 0.14);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }
  /** open 0 (furled on the yard) .. 1 (set); belly: how full the wind fills it. */
  shape(open: number, belly: number, flutter: number) {
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const b = this.base;
    const W = this.p.sailW, H = this.p.sailH;
    for (let i = 0; i < a.length; i += 3) {
      const u = b[i] / W + 0.5, v = -b[i + 1] / H; // v: 0 at the yard, 1 at the foot
      const vv = v * (0.08 + 0.92 * open);
      const bulge = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, vv * 0.85 + 0.12)) * belly * open;
      a[i] = b[i] * (1 - 0.08 * vv * open);
      a[i + 1] = -vv * H;
      a[i + 2] = bulge + Math.sin(flutter + u * 9 + v * 5) * 0.01 * (1 - belly * 3) * open + (1 - open) * 0.04 * Math.sin(u * 30);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

/** Canvas for the sail: weathered linen with the owner's colours. */
const sailTex = new Map<number, THREE.CanvasTexture>();
export function sailTexture(owner: number, color: number): THREE.CanvasTexture {
  const hit = sailTex.get(owner);
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ece2cc';
  ctx.fillRect(0, 0, S, S);
  const c = new THREE.Color(color);
  const col = (k: number) => `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`;
  // vertical cloths with seams, the middle ones dyed
  for (let k = 0; k < 8; k++) {
    const x = (k * S) / 8;
    if (k === 3 || k === 4) { ctx.fillStyle = col(0.95); ctx.fillRect(x, 0, S / 8, S); }
    if (k === 1 || k === 6) { ctx.fillStyle = col(0.8); ctx.fillRect(x + S / 32, 0, S / 16, S); }
    ctx.fillStyle = 'rgba(80,60,40,0.25)';
    ctx.fillRect(x, 0, 1.5, S);
  }
  // reef points and a crest
  ctx.fillStyle = 'rgba(70,50,30,0.5)';
  for (let k = 0; k < 16; k++) ctx.fillRect(8 + k * 15.5, 40, 2, 5);
  ctx.beginPath();
  ctx.arc(S / 2, S * 0.56, S * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = '#f4ecd8';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = col(0.6);
  ctx.stroke();
  ctx.fillStyle = col(0.7);
  ctx.font = `bold ${Math.round(S * 0.16)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚜', S / 2, S * 0.57);
  // grime and weathering
  let seed = 99 + owner;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = `rgba(90,70,40,${rnd() * 0.05})`;
    const r = 2 + rnd() * 10;
    ctx.fillRect(rnd() * S, rnd() * S * 1.2 - r, r, r * (1 + rnd() * 2));
  }
  const grad = ctx.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, 'rgba(60,40,20,0.0)');
  grad.addColorStop(1, 'rgba(60,40,20,0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  sailTex.set(owner, t);
  return t;
}
