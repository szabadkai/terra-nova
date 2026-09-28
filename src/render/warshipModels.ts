// Procedural war galley: the merchantman's lofted hull drawn out long and low, tarred black, with a
// bronze ram at the waterline, a row of painted shields along each side, oars out of ports beneath
// them, a crenellated fighting deck at the stern, a fighting top on the mast, a striped sail and a
// catapult on a turntable on the foredeck. Ship space: +z is the bow, y = 0 the waterline.
import * as THREE from 'three';
import { ModelBuilder, box, cyl, sphere } from './geom';
import {
  HULL_L, ShipParts, bulwark, deckGeometry, halfBeam, hullSkin, rim, sheer, transom, wale,
} from './shipModels';

const LS = 1.3; // drawn out
const BS = 1.04; // a touch beamier
const SY = 0.85; // lower freeboard

export const WAR_L = HULL_L * LS;
const zAt = (t: number) => (-HULL_L / 2 + t * HULL_L) * LS;
const gun = (t: number) => sheer(t) * SY;
const beam = (t: number) => halfBeam(t) * BS;
const deckAt = (t: number) => (Math.min(sheer(t), 0.3) - 0.07) * SY;

/** Stretch a merchant-hull part into the galley's lines. */
function warp(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * BS, y > 0 ? y * SY : y, p.getZ(i) * LS);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export interface WarshipParts extends ShipParts {
  /** the catapult's frame turns on its turntable at `turretPos` (ship space) */
  turret: ModelBuilder;
  turretPos: THREE.Vector3;
  /** its throwing arm swings about the axle at `armPivot` (turret space); it stands upright at angle 0 */
  arm: ModelBuilder;
  armPivot: THREE.Vector3;
  /** the stone in the cup, at the arm's tip (arm space) */
  cupPos: THREE.Vector3;
  /** oar pivots: ports along each side (side -1 port, +1 starboard) */
  oars: { x: number; y: number; z: number; side: number }[];
  oarGeo: THREE.BufferGeometry;
  sternFlag: THREE.Vector3;
  /** spots on deck that smoke and burn when the ship is badly holed */
  fires: THREE.Vector3[];
}

const cache = new Map<number, WarshipParts>();

export function warshipParts(owner: number): WarshipParts {
  const hit = cache.get(owner);
  if (hit) return hit;
  const mb = new ModelBuilder();
  for (const g of hullSkin()) mb.add('hullTar', warp(g));
  mb.add('hullTar', warp(transom()));
  for (const g of bulwark(true)) mb.add('planks', warp(g));
  for (const g of rim()) mb.add('timber', warp(g));
  for (const g of wale()) mb.add(`trim${owner}`, warp(g));
  mb.add('planks', warp(deckGeometry()));

  // bronze ram at the waterline, with a gilded knob on the stem
  const bowZ = zAt(1);
  const ram = new THREE.ConeGeometry(0.075, 0.46, 8);
  ram.rotateX(Math.PI / 2);
  mb.add('bronze', ram, 0, 0.03, bowZ + 0.16);
  mb.add('bronze', box(0.1, 0.07, 0.12), 0, 0.04, bowZ - 0.02);
  mb.add('bronze', box(0.12, 0.025, 0.2), 0, 0.1, bowZ - 0.06);
  mb.add('gold', sphere(0.035, 8, 6), 0, gun(1) + 0.05, bowZ - 0.03);

  // oar ports and shields along both sides
  const oars: WarshipParts['oars'] = [];
  const NOARS = 6;
  for (let k = 0; k < NOARS; k++) {
    const t = 0.27 + (k / (NOARS - 1)) * 0.44;
    for (const side of [-1, 1]) {
      const x = side * (beam(t) + 0.004), y = gun(t) - 0.075;
      mb.add('dark', box(0.02, 0.035, 0.05), x, y, zAt(t));
      oars.push({ x, y, z: zAt(t), side });
    }
  }
  const NSH = 7;
  for (let k = 0; k < NSH; k++) {
    const t = 0.23 + (k / (NSH - 1)) * 0.52;
    const ang = Math.atan2(beam(t + 0.01) - beam(t - 0.01), zAt(t + 0.01) - zAt(t - 0.01));
    for (const side of [-1, 1]) {
      const x = side * (beam(t) + 0.018), y = gun(t) - 0.018, z = zAt(t);
      const sh = cyl(0.078, 0.078, 0.016, 14);
      sh.rotateZ(Math.PI / 2);
      mb.add(k % 2 === 0 ? `trim${owner}` : 'wood', sh, x, y, z, side * ang);
      mb.add('iron', sphere(0.022, 8, 5, Math.PI * 2, Math.PI / 2), x + side * 0.009, y, z, 0, 0, -side * Math.PI / 2);
      mb.add('iron', cyl(0.079, 0.079, 0.006, 14, 1, true).rotateZ(Math.PI / 2), x + side * 0.004, y, z, side * ang);
    }
  }

  // fighting deck at the stern: raised, walled with merlons
  const st = 0.11, sz = zAt(st), sw = beam(st) * 1.9, sd = 0.52;
  const sy = gun(0.12) + 0.02;
  mb.add('planks', box(sw, 0.04, sd, 2), 0, sy, sz);
  mb.add('timber', box(sw * 0.92, sy - deckAt(0.2), sd * 0.9, 2), 0, (sy + deckAt(0.2)) / 2, sz);
  mb.add('dark', box(0.13, 0.15, 0.02), 0, deckAt(0.2) + 0.08, sz + sd * 0.45 + 0.002);
  for (const sx of [-1, 1]) mb.add('timber', box(0.03, 0.09, sd, 2), sx * (sw / 2 - 0.015), sy + 0.065, sz);
  mb.add('timber', box(sw, 0.09, 0.03, 2), 0, sy + 0.065, sz - sd / 2 + 0.015);
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) mb.add(k % 2 ? 'timber' : `trim${owner}`, box(0.045, 0.07, 0.07), sx * (sw / 2 - 0.015), sy + 0.14, sz - sd / 2 + 0.07 + k * 0.125);
  for (let k = 0; k < 3; k++) mb.add(k % 2 ? `trim${owner}` : 'timber', box(0.07, 0.07, 0.045), -sw / 2 + 0.1 + k * ((sw - 0.2) / 2), sy + 0.14, sz - sd / 2 + 0.015);
  // steps up to it
  for (let k = 0; k < 3; k++) mb.add('planks', box(0.18, 0.02, 0.06), 0, deckAt(0.22) + 0.03 + k * 0.05, sz + sd / 2 + 0.05 - k * 0.05);
  // stern post with the banner, lantern, rudder
  const sternFlag = new THREE.Vector3(0, sy + 0.72, sz - sd / 2 + 0.05);
  mb.add('timber', cyl(0.014, 0.018, 0.72, 6), sternFlag.x, sy, sternFlag.z);
  const lantern = new THREE.Vector3(0, gun(0.02) + 0.3, zAt(0) + 0.02);
  mb.add('iron', box(0.015, 0.3, 0.015), 0, gun(0.02), zAt(0) + 0.02);
  mb.add('glowFire', box(0.06, 0.08, 0.06), lantern.x, lantern.y, lantern.z);
  mb.anchors.fires.push(lantern.clone());
  mb.add('timber', box(0.045, 0.5, 0.18, 2), 0, 0.0, zAt(0) - 0.06);

  // mast with a fighting top, yard, forestay and shrouds
  const mz = 0.02 * LS, deckY = deckAt(0.5), mastTop = 2.4, yardY = 2.02, topY = 1.78;
  mb.add('timber', cyl(0.03, 0.046, mastTop - deckY, 10, 2), 0, deckY, mz);
  mb.add('planks', cyl(0.13, 0.11, 0.1, 12, 1, true), 0, topY, mz);
  mb.add('timber', cyl(0.13, 0.13, 0.016, 12), 0, topY, mz);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    mb.add(k % 2 ? 'timber' : `trim${owner}`, box(0.05, 0.06, 0.03), Math.sin(a) * 0.125, topY + 0.13, mz + Math.cos(a) * 0.125, a);
  }
  mb.add('timber', new THREE.CylinderGeometry(0.019, 0.019, 1.52, 8), 0, yardY, mz + 0.05, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) mb.add('timber', sphere(0.026, 6, 4), sx * 0.76, yardY, mz + 0.05);
  mb.add('gold', sphere(0.03, 8, 6), 0, mastTop + 0.02, mz);
  const rope = (a: THREE.Vector3, b: THREE.Vector3, r = 0.006) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate(a.x, a.y, a.z);
    mb.add('rope', g);
  };
  rope(new THREE.Vector3(0, mastTop - 0.12, mz), new THREE.Vector3(0, gun(1) + 0.05, bowZ - 0.05));
  rope(new THREE.Vector3(0, mastTop - 0.12, mz), new THREE.Vector3(0, sternFlag.y - 0.1, sternFlag.z));
  for (const sx of [-1, 1]) for (const dz of [-0.24, 0, 0.24]) {
    const t = (mz + dz) / (HULL_L * LS) + 0.5;
    rope(new THREE.Vector3(0, topY - 0.02, mz), new THREE.Vector3(sx * beam(t) * 0.97, gun(t), mz + dz), 0.005);
  }
  for (const sx of [-1, 1]) rope(new THREE.Vector3(sx * 0.72, yardY, mz + 0.05), new THREE.Vector3(sx * beam(0.3) * 0.9, gun(0.3), zAt(0.3)), 0.004);

  // the catapult: a turntable on the foredeck, stones ready beside it
  const ct = 0.79, cz = zAt(ct), cy = deckAt(ct);
  mb.add('timber', cyl(0.2, 0.22, 0.05, 16), 0, cy, cz);
  mb.add('iron', cyl(0.205, 0.205, 0.012, 16, 1, true), 0, cy + 0.04, cz);
  for (const [sx, szz] of [[-0.2, -0.28], [0.2, -0.3], [0.22, -0.2]] as const) {
    mb.add('rock', sphere(0.05, 6, 4), sx, cy + 0.04, cz + szz);
  }
  mb.add('wood', cyl(0.05, 0.055, 0.12, 8), -0.24, cy, cz - 0.16);
  const turretPos = new THREE.Vector3(0, cy + 0.05, cz);
  const turret = new ModelBuilder();
  for (const sx of [-1, 1]) {
    turret.add('timber', box(0.04, 0.045, 0.5, 2), sx * 0.1, 0.022, -0.02);
    turret.add('timber', box(0.035, 0.3, 0.035), sx * 0.1, 0.15, 0.12);
    turret.add('timber', box(0.03, 0.03, 0.2), sx * 0.1, 0.16, 0.03, 0, 0.9);
    turret.add('iron', sphere(0.02, 6, 4), sx * 0.125, 0.085, -0.05);
  }
  turret.add('timber', box(0.26, 0.045, 0.045), 0, 0.3, 0.12);
  turret.add('canvas', box(0.12, 0.05, 0.03), 0, 0.3, 0.1);
  turret.add('iron', new THREE.CylinderGeometry(0.018, 0.018, 0.24, 8), 0, 0.085, -0.05, 0, 0, Math.PI / 2);
  turret.add('wood', new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10), 0, 0.06, -0.22, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) turret.add('timber', box(0.014, 0.14, 0.014), sx * 0.115, 0.06, -0.22);
  turret.add('rope', new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), 0, 0.075, -0.14, 0, Math.PI / 2 - 0.3, 0);
  const armPivot = new THREE.Vector3(0, 0.085, -0.05);
  const arm = new ModelBuilder();
  arm.add('timber', box(0.035, 0.42, 0.035), 0, 0.2, 0);
  arm.add('iron', box(0.04, 0.02, 0.04), 0, 0.12, 0);
  arm.add('wood', cyl(0.05, 0.035, 0.035, 10, 1, true).rotateX(Math.PI / 2), 0, 0.42, -0.02);
  arm.add('dark', cyl(0.045, 0.045, 0.01, 10).rotateX(Math.PI / 2), 0, 0.42, -0.035);
  const cupPos = new THREE.Vector3(0, 0.43, -0.03);

  // oar: a long loom out through the port, blade at the end (outboard along +x)
  const oar = new THREE.CylinderGeometry(0.012, 0.012, 0.82, 5);
  oar.rotateZ(Math.PI / 2);
  oar.translate(0.31, 0, 0);
  const blade = new THREE.BoxGeometry(0.17, 0.012, 0.07);
  blade.translate(0.64, 0, 0);
  const oarGeo = mergeSimple([oar, blade]);

  const fires = [new THREE.Vector3(0.1, deckAt(0.35) + 0.05, zAt(0.35)), new THREE.Vector3(-0.12, deckAt(0.6) + 0.05, zAt(0.6)), new THREE.Vector3(0, sy + 0.05, sz)];
  const parts: WarshipParts = {
    mb, mastTop, yardY, sailW: 1.38, sailH: 1.2, lantern, flagPos: new THREE.Vector3(0, mastTop + 0.02, mz),
    turret, turretPos, arm, armPivot, cupPos, oars, oarGeo, sternFlag, fires,
  };
  cache.set(owner, parts);
  return parts;
}

function mergeSimple(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    nrm.push(...(ng.getAttribute('normal').array as Float32Array));
    uv.push(...(ng.getAttribute('uv').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

/** The war sail: broad stripes in the owner's colour and a shield with crossed swords. */
const warSails = new Map<number, THREE.CanvasTexture>();
export function warSailTexture(owner: number, color: number): THREE.CanvasTexture {
  const hit = warSails.get(owner);
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const c = new THREE.Color(color);
  const col = (k: number) => `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`;
  ctx.fillStyle = '#e8dcc2';
  ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 7; k++) {
    if (k % 2 === 0) { ctx.fillStyle = col(0.9); ctx.fillRect((k * S) / 7, 0, S / 7 + 1, S); }
    ctx.fillStyle = 'rgba(70,50,30,0.28)';
    ctx.fillRect((k * S) / 7, 0, 1.5, S);
  }
  ctx.fillStyle = 'rgba(70,50,30,0.5)';
  for (let k = 0; k < 16; k++) ctx.fillRect(8 + k * 15.5, 36, 2, 5);
  // shield and crossed swords
  const cx = S / 2, cy = S * 0.56, r = S * 0.17;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r * 0.9);
  ctx.lineTo(cx + r, cy - r * 0.9);
  ctx.quadraticCurveTo(cx + r, cy + r * 0.5, cx, cy + r * 1.15);
  ctx.quadraticCurveTo(cx - r, cy + r * 0.5, cx - r, cy - r * 0.9);
  ctx.fillStyle = '#f2e8d2';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#3a2a1c';
  ctx.stroke();
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.strokeStyle = '#4a4a50';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - s * r * 0.62, cy - r * 0.62);
    ctx.lineTo(cx + s * r * 0.55, cy + r * 0.62);
    ctx.stroke();
    ctx.strokeStyle = col(0.55);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.3, cy + r * 0.3);
    ctx.lineTo(cx + s * r * 0.72, cy + r * 0.12);
    ctx.stroke();
  }
  let seed = 311 + owner;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = `rgba(90,70,40,${rnd() * 0.05})`;
    const rr = 2 + rnd() * 10;
    ctx.fillRect(rnd() * S, rnd() * S * 1.2 - rr, rr, rr * (1 + rnd() * 2));
  }
  const grad = ctx.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, 'rgba(60,40,20,0.0)');
  grad.addColorStop(1, 'rgba(60,40,20,0.2)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  warSails.set(owner, t);
  return t;
}
