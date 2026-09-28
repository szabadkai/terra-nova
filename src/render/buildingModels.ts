// Procedural building models for every building type, after the Settlers III Roman look:
// rubble walls with rounded corners standing on a plinth, deep barrel-tile roofs, rolled thatch,
// log cabins and plank sheds, red doors in arched stone surrounds, brick furnaces and round
// towers, and a silhouette of its own for every building.
import * as THREE from 'three';
import type { BuildingType } from '../game/defs';
import { ModelBuilder, RoofOpts, RoofStyle, WallOpts, box, cone, coneRoof, cyl, gableRoof, getDetail, hipRoof, leanToRoof, setDetail, sphere, wallPrism } from './geom';

type MB = ModelBuilder;
type Face = 'z' | '-z' | 'x' | '-x';
const FACE_RY: Record<Face, number> = { z: 0, x: Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2 };

/** Copy every part and anchor of a sub-model into `mb`, turned by `ry` about y and moved to (x, y, z). */
function put(mb: MB, sub: MB, x: number, y: number, z: number, ry = 0) {
  const m = new THREE.Matrix4().makeRotationY(ry);
  m.setPosition(x, y, z);
  for (const [key, geos] of sub.parts) for (const g of geos) mb.addRaw(key, g.clone().applyMatrix4(m));
  const tf = (v: THREE.Vector3) => v.clone().applyMatrix4(m);
  const A = sub.anchors, B = mb.anchors;
  B.windows.push(...A.windows.map(tf));
  B.chimneys.push(...A.chimneys.map(tf));
  B.fires.push(...A.fires.map(tf));
  B.flags.push(...A.flags.map(tf));
  B.top = Math.max(B.top, A.top + y);
}

/** Point on a wall face: `u` to the right seen from outside, `n` outwards from the face plane. */
function onFace(face: Face, x: number, z: number, hw: number, hd: number, u: number): [number, number] {
  switch (face) {
    case 'z': return [x + u, z + hd];
    case '-z': return [x - u, z - hd];
    case 'x': return [x + hw, z - u];
    case '-x': return [x - hw, z + u];
  }
}

// ------------------------------------------------------------------ small parts
/** The upper half of a disc of radius r and thickness t, facing +z, centred on the origin. */
function halfDisc(r: number, t: number, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, t, seg, 1, false, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Horizontal round log along x, centred, bark in `log` and pale end grain on the ends. */
function logAlongX(mb: MB, len: number, r: number, x: number, y: number, z: number, ry = 0, mat = 'log') {
  const g = new THREE.CylinderGeometry(r, r * 0.94, len, 8, 1, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.35, uv.getY(i) * len);
  g.rotateZ(Math.PI / 2);
  mb.add(mat, g, x, y, z, ry);
  const c = Math.cos(ry), s = Math.sin(ry);
  for (const e of [-1, 1]) {
    const cap = new THREE.CircleGeometry(r * (e > 0 ? 0.94 : 1), 8);
    cap.rotateY(e * Math.PI / 2);
    mb.add('endgrain', cap, x + c * e * len / 2, y, z - s * e * len / 2, ry);
  }
}

/** Stone plinth the walls stand on, sunk into the ground so it covers uneven sites. */
function plinth(mb: MB, w: number, d: number, x = 0, z = 0, h = 0.12, mat = 'stoneDark', r = 0.1) {
  mb.add(mat, wallPrism(w, d, h + 0.4, { r, batter: 0.02, wobble: 0.004, uvs: 1.2, seed: x * 3 + z, cap: true }), x, -0.4, z);
}

/** Red planked door with a round head in a surround of dressed jamb stones and voussoirs, over
 *  a step. Local frame: wall face at z = 0, facing +z, sill at y = 0. */
function archDoor(w = 0.32, h = 0.52, surround: string | null = 'ashlar', leaf = 'doorRed'): MB {
  const s = new ModelBuilder();
  const r = w / 2, hs = h - r;
  s.add('dark', box(w + 0.03, hs, 0.05), 0, hs / 2, -0.012);
  s.add('dark', halfDisc(r + 0.015, 0.05), 0, hs, -0.012);
  s.add(leaf, box(w, hs, 0.03, 3), 0, hs / 2, 0.0);
  s.add(leaf, halfDisc(r, 0.03), 0, hs, 0.0);
  for (const yy of [hs * 0.25, hs * 0.75]) s.add('iron', box(w * 0.9, 0.025, 0.012), 0, yy, 0.02);
  s.add('iron', new THREE.TorusGeometry(0.022, 0.006, 4, 8), w * 0.28, hs * 0.55, 0.026);
  if (surround) {
    const R = r + 0.045;
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) / n * Math.PI;
      s.add(surround, box((Math.PI * R) / n * 0.86, 0.09, 0.065, 3), Math.cos(a) * R, hs + Math.sin(a) * R, 0.012, 0, 0, a - Math.PI / 2);
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
      const bw = k % 2 ? 0.075 : 0.1;
      s.add(surround, box(bw, hs / 3 - 0.012, 0.065, 3), sx * (R + (bw - 0.09) / 2), (hs / 3) * (k + 0.5), 0.012);
    }
    s.add(surround, box(w + 0.22, 0.05, 0.16, 3), 0, 0.025, 0.07);
  } else {
    // timber frame and a plank step for wooden buildings
    for (const sx of [-1, 1]) s.add('timber', box(0.055, h + 0.03, 0.06), sx * (r + 0.03), (h + 0.03) / 2, 0.012);
    s.add('timber', box(w + 0.14, 0.07, 0.07), 0, h + 0.03, 0.015);
    s.add('planks', box(w + 0.16, 0.04, 0.14, 3), 0, 0.02, 0.07);
  }
  return s;
}

/** Square-headed plank door in a timber frame, for barns and sheds. */
function barnDoor(w: number, h: number, leaf = 'doorRed'): MB {
  const s = new ModelBuilder();
  s.add('dark', box(w + 0.02, h, 0.05), 0, h / 2, -0.015);
  s.add(leaf, box(w, h, 0.03, 3), 0, h / 2, 0);
  s.add('timber', box(0.04, h, 0.02), 0, h / 2, 0.02);
  for (const sgn of [-1, 1]) s.add('timber', box(Math.hypot(w / 2, h) * 0.95, 0.035, 0.018), sgn * w / 4, h / 2, 0.022, 0, 0, sgn * Math.atan2(h, w / 2));
  for (const sx of [-1, 1]) s.add('timber', box(0.06, h + 0.04, 0.065), sx * (w / 2 + 0.03), (h + 0.04) / 2, 0.012);
  s.add('timber', box(w + 0.16, 0.07, 0.075), 0, h + 0.04, 0.015);
  return s;
}

/** Small window: blue glass behind a timber cross, a stone sill and lintel (or a timber frame,
 *  or a dark round-headed opening for towers). Local: wall face at z = 0, centre at y = 0. */
function windowPart(w = 0.17, h = 0.2, kind: 'stone' | 'timber' | 'arch' | 'slit' = 'stone'): MB {
  const s = new ModelBuilder();
  if (kind === 'slit' || kind === 'arch') {
    const r = w / 2;
    s.add('dark', box(w, h - r, 0.05), 0, -r / 2, -0.012);
    s.add('dark', halfDisc(r, 0.05), 0, h / 2 - r, -0.012);
    if (kind === 'arch') {
      const R = r + 0.035;
      for (let k = 0; k < 5; k++) {
        const a = (k + 0.5) / 5 * Math.PI;
        s.add('ashlar', box((Math.PI * R) / 5 * 0.85, 0.06, 0.05, 3), Math.cos(a) * R, h / 2 - r + Math.sin(a) * R, 0.01, 0, 0, a - Math.PI / 2);
      }
      s.add('ashlar', box(w + 0.1, 0.035, 0.07, 3), 0, -h / 2 - 0.015, 0.02);
    }
    s.anchors.windows.push(new THREE.Vector3(0, 0, 0.3));
    return s;
  }
  s.add('window', box(w, h, 0.02), 0, 0, -0.006);
  const fr = kind === 'timber' ? 0.035 : 0.028;
  s.add('timber', box(w + fr * 2, fr, 0.04), 0, h / 2 + fr / 2, 0.006);
  s.add('timber', box(w + fr * 2, fr, 0.04), 0, -h / 2 - fr / 2, 0.006);
  for (const sx of [-1, 1]) s.add('timber', box(fr, h, 0.04), sx * (w / 2 + fr / 2), 0, 0.006);
  s.add('timber', box(0.02, h, 0.03), 0, 0, 0.004);
  s.add('timber', box(w, 0.02, 0.03), 0, h * 0.12, 0.004);
  if (kind === 'stone') {
    s.add('ashlar', box(w + 0.12, 0.04, 0.08, 3), 0, -h / 2 - fr - 0.02, 0.025);
    s.add('ashlar', box(w + 0.1, 0.05, 0.05, 3), 0, h / 2 + fr + 0.025, 0.012);
  }
  s.anchors.windows.push(new THREE.Vector3(0, 0, 0.3));
  return s;
}

function win(mb: MB, x: number, y: number, z: number, face: Face, w = 0.17, h = 0.2, kind: 'stone' | 'timber' | 'arch' | 'slit' = 'stone') {
  put(mb, windowPart(w, h, kind), x, y, z, FACE_RY[face]);
}

/** Rubble chimney stack with a dressed cap and a sooty pot, standing from y. */
function chimney(mb: MB, x: number, y: number, z: number, h = 0.55, w = 0.17) {
  mb.add('stone', wallPrism(w, w, h, { r: 0.03, batter: 0.008, wobble: 0.003, uvs: 1.3, seed: x * 5 + z * 3 }), x, y, z);
  mb.add('ashlar', box(w + 0.06, 0.045, w + 0.06, 3), x, y + h + 0.022, z);
  mb.add('stoneDark', cyl(w * 0.3, w * 0.34, 0.07, 8, 2), x, y + h + 0.045, z);
  mb.add('dark', new THREE.CircleGeometry(w * 0.24, 8), x, y + h + 0.117, z, 0, -Math.PI / 2, 0);
  mb.anchors.chimneys.push(new THREE.Vector3(x, y + h + 0.13, z));
}

/** Diagonal timber frame on a plastered wall block: posts, rails and braces on all four faces. */
function timberFrame(mb: MB, w: number, d: number, h: number, x: number, y: number, z: number) {
  const t = 0.055, o = 0.012;
  const hw = w / 2 + o, hd = d / 2 + o;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.add('timber', box(t, h, t, 2), x + sx * (hw - t / 2), y + h / 2, z + sz * (hd - t / 2));
  for (const yy of [t / 2, h - t / 2]) {
    for (const sz of [-1, 1]) mb.add('timber', box(w + o * 2, t, t, 2), x, y + yy, z + sz * (hd - t / 2 + 0.004));
    for (const sx of [-1, 1]) mb.add('timber', box(t, t, d + o * 2, 2), x + sx * (hw - t / 2 + 0.004), y + yy, z);
  }
  // studs and braces on the long faces
  const nS = Math.max(1, Math.round(w / 0.42));
  for (const sz of [-1, 1]) {
    for (let k = 1; k < nS; k++) mb.add('timber', box(t * 0.8, h - t, t * 0.8, 2), x - w / 2 + (w * k) / nS, y + h / 2, z + sz * (hd - t / 2 + 0.006));
    const bw = w / nS, ang = Math.atan2(h - t * 2, bw);
    for (const e of [0, nS - 1]) {
      const cx = x - w / 2 + bw * (e + 0.5);
      mb.add('timber', box(Math.hypot(bw, h - t * 2) * 0.96, t * 0.7, t * 0.7, 2), cx, y + h / 2, z + sz * (hd - t / 2 + 0.008), 0, 0, (e === 0 ? 1 : -1) * ang);
    }
  }
  for (const sx of [-1, 1]) {
    const ang = Math.atan2(h - t * 2, d / 2);
    mb.add('timber', box(t * 0.7, t * 0.7, Math.hypot(d / 2, h - t * 2) * 0.96, 2), x + sx * (hw - t / 2 + 0.008), y + h / 2, z - d / 4, sx * ang, 0, 0);
  }
}

/** Log cabin walls: round logs in alternating courses, crossing and sticking out at the corners. */
function logWalls(mb: MB, w: number, d: number, h: number, x: number, y: number, z: number) {
  const r = 0.046, step = r * 1.72;
  mb.add('planks', box(w - r * 1.4, h, d - r * 1.4, 2), x, y + h / 2, z);
  const n = Math.max(2, Math.floor((h - r) / step));
  for (let k = 0; k <= n; k++) {
    const yy = y + r + k * step;
    for (const sz of [-1, 1]) logAlongX(mb, w + 0.18 + ((k * 7) % 3) * 0.02, r, x, yy, z + sz * (d / 2 - r * 0.7));
    if (yy + step / 2 < y + h) for (const sx of [-1, 1]) logAlongX(mb, d + 0.18 + ((k * 5) % 3) * 0.02, r, x + sx * (w / 2 - r * 0.7), yy + step / 2, z, Math.PI / 2);
  }
}

/** Vertical plank walls with corner posts, a sill and a head beam. */
function plankWalls(mb: MB, w: number, d: number, h: number, x: number, y: number, z: number) {
  mb.add('planks', wallPrism(w, d, h, { r: 0.012, batter: 0, wobble: 0.002, uvs: 1.4 }), x, y, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.add('timber', box(0.065, h + 0.02, 0.065, 2), x + sx * (w / 2 - 0.02), y + h / 2, z + sz * (d / 2 - 0.02));
  for (const sz of [-1, 1]) for (const yy of [0.03, h - 0.03]) mb.add('timber', box(w + 0.03, 0.05, 0.05, 2), x, y + yy, z + sz * (d / 2 + 0.008));
  for (const sx of [-1, 1]) for (const yy of [0.03, h - 0.03]) mb.add('timber', box(0.05, 0.05, d + 0.03, 2), x + sx * (w / 2 + 0.008), y + yy, z);
}

const styleOf = (roof: string): RoofStyle => roof === 'thatch' ? 'thatch' : roof === 'shingle' ? 'shingle' : 'tile';

interface RoofPlace extends RoofOpts {
  over?: number;
  overEnd?: number;
  /** ridge along z instead of x */
  rot?: boolean;
  gableMat?: string;
  hip?: boolean;
}

/** A roof of material `mat` over a w x d wall top at (x, top, z): gable (default) or hipped. */
function roof(mb: MB, mat: string, w: number, d: number, h: number, x: number, top: number, z: number, o: RoofPlace = {}) {
  const style = styleOf(mat);
  // thatch is laid in a few fat courses, so its texture (and courses) are stretched
  const ropts: RoofOpts = { style, uvs: style === 'thatch' ? 0.62 : 1, sag: o.sag ?? (style === 'thatch' ? 0.035 : 0.02), bulge: o.bulge ?? (style === 'thatch' ? 0.05 : 0.012), seed: o.seed ?? Math.round(x * 13 + z * 7) };
  const ry = o.rot ? Math.PI / 2 : 0;
  const [W, D] = o.rot ? [d, w] : [w, d];
  const over = o.over ?? (style === 'thatch' ? 0.2 : 0.16);
  if (o.hip) {
    mb.add(mat, hipRoof(W, D, h, over, ropts), x, top, z, ry);
    return;
  }
  const r = gableRoof(W, D, h, over, { ...ropts, overEnd: o.overEnd ?? (style === 'thatch' ? 0.16 : 0.12) });
  mb.add(mat, r.roof, x, top, z, ry);
  mb.add(style === 'shingle' ? 'timber' : mat, r.ridge, x, top, z, ry);
  if (o.gableMat) mb.add(o.gableMat, r.gable, x, top, z, ry);
  if (style !== 'thatch') {
    // ridge beam ends under the verges
    for (const sx of [-1, 1]) {
      const px = sx * (r.hw - 0.03);
      const [bx, bz] = o.rot ? [0, -px] : [px, 0];
      mb.add('timber', box(0.12, 0.06, 0.06, 2), x + bx, top + h - 0.09, z + bz, ry);
    }
  }
}

interface HouseOpts {
  w: number; d: number; wallH: number; roofH: number;
  x?: number; z?: number; y?: number;
  /** stone | stoneDark | sandstone | plaster | plasterWarm | planks | log */
  wall?: string;
  /** a timber-framed plastered storey on top of the walls, standing out by `jetty` */
  upper?: { h: number; jetty?: number; mat?: string };
  /** roofX (player tiles) | thatch | shingle | roof{n} */
  roofMat?: string;
  over?: number; overEnd?: number; rot?: boolean; hip?: boolean; sag?: number; bulge?: number;
  gableMat?: string;
  /** door x offset on the front face, null for none */
  door?: number | null; doorW?: number; doorH?: number;
  /** front window x offsets; windows on the upper storey too when there is one */
  wins?: number[];
  sideWin?: boolean;
  backWin?: boolean;
  /** chimney position in house space, null for none */
  chim?: [number, number] | null;
  chimH?: number;
  /** corner radius of the walls */
  r?: number;
  noPlinth?: boolean;
  /** x offset of a dormer on the front slope */
  dormer?: number;
  seed?: number;
}

interface HouseInfo { base: number; top: number; ridge: number; eave: number }

const WOODEN = new Set(['planks', 'log']);

/** A Settlers house: plinth, walls, an optional jettied upper storey, a deep roof, a door,
 *  windows, a chimney and perhaps a dormer. Front (door side) is +z. */
function house(mb: MB, o: HouseOpts): HouseInfo {
  const x = o.x ?? 0, z = o.z ?? 0, y = o.y ?? 0;
  const wall = o.wall ?? 'stone';
  const wooden = WOODEN.has(wall);
  const seed = o.seed ?? Math.round(x * 17 + z * 11 + o.w * 5);
  const base = y + (o.noPlinth ? 0.02 : 0.1);
  if (!o.noPlinth) plinth(mb, o.w + 0.08, o.d + 0.08, x, z, 0.1, wooden ? 'stone' : 'stoneDark', (o.r ?? 0.08) + 0.04);
  if (wall === 'log') logWalls(mb, o.w, o.d, o.wallH, x, base, z);
  else if (wall === 'planks') plankWalls(mb, o.w, o.d, o.wallH, x, base, z);
  else {
    const wo: WallOpts = { r: o.r ?? 0.08, batter: 0.02, wobble: 0.007, seed };
    mb.add(wall, wallPrism(o.w, o.d, o.wallH, wo), x, base, z);
    if (wall.startsWith('plaster')) timberFrame(mb, o.w, o.d, o.wallH, x, base, z);
  }
  let top = base + o.wallH;
  let W = o.w, D = o.d;
  if (o.upper) {
    const j = o.upper.jetty ?? 0.05;
    W = o.w + j * 2 * (o.rot ? 1 : 0.3);
    D = o.d + j * 2;
    // floor beam band
    mb.add('timber', box(W + 0.03, 0.07, D + 0.03, 2), x, top + 0.035, z);
    for (let k = 0; k < Math.round(W / 0.2); k++) mb.add('timber', box(0.05, 0.05, 0.06), x - W / 2 + 0.1 + k * 0.2, top - 0.02, z + D / 2 - 0.01);
    const um = o.upper.mat ?? 'plaster';
    mb.add(um, wallPrism(W, D, o.upper.h, { r: 0.02, batter: 0, wobble: 0.004, seed: seed + 3 }), x, top + 0.07, z);
    if (um.startsWith('plaster')) timberFrame(mb, W, D, o.upper.h, x, top + 0.07, z);
    top += 0.07 + o.upper.h;
  }
  const roofMat = o.roofMat ?? 'roofX';
  const gableMat = o.gableMat ?? (o.upper ? (o.upper.mat ?? 'plaster') : wall === 'log' ? 'planks' : wall);
  roof(mb, roofMat, W, D, o.roofH, x, top, z, { over: o.over, overEnd: o.overEnd, rot: o.rot, hip: o.hip, sag: o.sag, bulge: o.bulge, gableMat, seed });
  // door
  const doorX = o.door === undefined ? 0 : o.door;
  if (doorX !== null) {
    const dh = o.doorH ?? Math.min(0.56, o.wallH - 0.08);
    put(mb, wooden ? archDoor(o.doorW ?? 0.3, dh, null) : archDoor(o.doorW ?? 0.32, dh), x + doorX, base, z + o.d / 2);
  }
  // windows
  const kind = wooden ? 'timber' : 'stone';
  const floors: number[] = [];
  if (o.upper) { floors.push(base + o.wallH * 0.55); floors.push(base + o.wallH + 0.07 + o.upper.h * 0.52); }
  else floors.push(base + o.wallH * 0.6);
  floors.forEach((wy, f) => {
    const onUpper = f === 1;
    const zf = z + (onUpper ? D : o.d) / 2;
    const k = onUpper ? 'timber' : kind;
    for (const wx of o.wins ?? []) {
      if (!onUpper && doorX !== null && Math.abs(wx - doorX) < 0.3) continue;
      win(mb, x + wx, wy, zf, 'z', 0.16, 0.19, k);
    }
    if (onUpper && doorX !== null && (o.wins ?? []).length) win(mb, x + doorX, wy, zf, 'z', 0.16, 0.19, k);
    if ((o.sideWin ?? true) && o.d > 0.7) {
      const xf = (onUpper ? W : o.w) / 2;
      win(mb, x + xf, wy, z, 'x', 0.15, 0.18, k);
      win(mb, x - xf, wy, z, '-x', 0.15, 0.18, k);
    }
    if (o.backWin) win(mb, x, wy, z - (onUpper ? D : o.d) / 2, '-z', 0.16, 0.19, k);
  });
  // chimney: rises from inside the roof, clear of the ridge
  if (o.chim) {
    const [cx, cz] = o.chim;
    chimney(mb, x + cx, top + o.roofH * 0.2, z + cz, o.chimH ?? o.roofH * 0.95, 0.16);
  }
  if (o.dormer !== undefined) dormer(mb, x + o.dormer, top, z, o.rot ? W : D, o.roofH, roofMat);
  const eave = top - ((o.over ?? 0.2) * o.roofH) / ((o.rot ? W : D) / 2);
  mb.anchors.top = Math.max(mb.anchors.top, top + o.roofH);
  return { base, top, ridge: top + o.roofH, eave };
}

/** A small gabled dormer with a window on the front slope of a roof whose ridge runs along x at
 *  `top + roofH` over walls `d` deep; its ridge meets the main ridge. */
function dormer(mb: MB, x: number, top: number, z: number, d: number, roofH: number, roofMat: string, w = 0.38) {
  const k = 0.68;
  const fz = z + (k * d) / 2; // dormer front wall
  const yb = top + roofH * (1 - k); // main roof surface under it
  const ridgeH = 0.15;
  const h = Math.min(0.36, roofH * k - 0.05 - ridgeH);
  const back = z + 0.02;
  const dep = fz - back, cz = (fz + back) / 2;
  mb.add('stone', wallPrism(w, dep, h + 0.14, { r: 0.02, wobble: 0.002, batter: 0 }), x, yb - 0.14, cz);
  const r = gableRoof(dep, w, ridgeH, 0.07, { style: 'tile', seed: Math.round(x * 10) + 5, overEnd: 0.07 });
  mb.add(roofMat, r.roof, x, yb + h, cz, Math.PI / 2);
  mb.add(roofMat, r.ridge, x, yb + h, cz, Math.PI / 2);
  mb.add('stone', r.gable, x, yb + h, cz, Math.PI / 2);
  win(mb, x, yb + h * 0.5 + 0.01, fz, 'z', 0.14, Math.min(0.17, h - 0.1), 'timber');
}

/** Lean-to on posts: a single-pitch roof `w` along its eave and `d` deep, eave at `low` and top
 *  at `high`, the eave facing `face`. */
function shed(mb: MB, x: number, z: number, w: number, d: number, low: number, high: number, mat = 'shingle', face: Face = 'z', backPosts = false) {
  const ry = FACE_RY[face];
  const s = new ModelBuilder();
  s.add(mat, leanToRoof(w + 0.12, d + 0.14, low, high, { style: styleOf(mat), seed: Math.round(x * 9 + z * 5), bulge: 0.005 }), 0, 0, 0);
  for (const sx of [-1, 1]) {
    s.add('timber', box(0.07, low, 0.07, 2), sx * (w / 2 - 0.04), low / 2, d / 2 - 0.04);
    if (backPosts) s.add('timber', box(0.07, high, 0.07, 2), sx * (w / 2 - 0.04), high / 2, -d / 2 + 0.04);
    // knee braces
    s.add('timber', box(0.04, 0.22, 0.04, 2), sx * (w / 2 - 0.1), low - 0.1, d / 2 - 0.04, 0, 0, sx * 0.7);
  }
  s.add('timber', box(w + 0.02, 0.07, 0.07, 2), 0, low - 0.035, d / 2 - 0.04);
  put(mb, s, x, 0, z, ry);
}

function barrel(mb: MB, x: number, y: number, z: number, s = 1) {
  const prof = [[0.085, 0], [0.1, 0.06], [0.106, 0.12], [0.1, 0.18], [0.085, 0.24]].map(([r, yy]) => new THREE.Vector2(r * s, yy * s));
  mb.add('wood', new THREE.LatheGeometry(prof, 12), x, y, z);
  mb.add('wood', new THREE.CircleGeometry(0.085 * s, 12), x, y + 0.24 * s, z, 0, -Math.PI / 2, 0);
  mb.add('iron', cyl(0.104 * s, 0.1 * s, 0.022 * s, 12), x, y + 0.045 * s, z);
  mb.add('iron', cyl(0.1 * s, 0.104 * s, 0.022 * s, 12), x, y + 0.175 * s, z);
}

function crate(mb: MB, x: number, y: number, z: number, s = 0.22, ry = 0) {
  mb.add('planks', box(s, s, s, 4), x, y + s / 2, z, ry);
  mb.add('timber', box(s + 0.012, 0.03, s + 0.012), x, y + s - 0.02, z, ry);
  mb.add('timber', box(s + 0.012, 0.03, s + 0.012), x, y + 0.02, z, ry);
}

function sack(mb: MB, x: number, y: number, z: number, s = 1, ry = 0) {
  const g = sphere(0.1 * s, 9, 7);
  g.scale(1, 1.15, 0.8);
  mb.add('canvas', g, x, y + 0.1 * s, z, ry);
  mb.add('rope', cyl(0.025 * s, 0.035 * s, 0.05 * s, 6), x, y + 0.2 * s, z);
}

function logPile(mb: MB, x: number, y: number, z: number, n = 3, len = 0.7, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  for (let row = 0; row < n; row++) {
    for (let i = 0; i < n - row; i++) {
      const off = (i - (n - row - 1) / 2) * 0.13;
      logAlongX(mb, len - ((i + row) % 2) * 0.05, 0.06, x - s * off, y + 0.06 + row * 0.11, z - c * off, ry + Math.PI / 2);
    }
  }
}

function fence(mb: MB, pts: [number, number][], y = 0, h = 0.3) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bz - az, bx - ax);
    const posts = Math.max(1, Math.round(len / 0.4));
    for (let p = 0; p <= posts; p++) {
      const t = p / posts;
      mb.add('timber', cyl(0.022, 0.026, h + 0.03, 6), ax + (bx - ax) * t, y, az + (bz - az) * t);
    }
    // split rails, a little crooked
    for (const [yy, k] of [[h * 0.45, 0], [h * 0.9, 1]]) {
      mb.add('wood', box(len + 0.04, 0.035, 0.03), (ax + bx) / 2, y + yy, (az + bz) / 2, -ang, 0, (k ? 0.02 : -0.015) * Math.sign(len));
    }
  }
}

function flag(mb: MB, x: number, y: number, z: number, h = 1.0, owner = 0) {
  mb.add('timber', cyl(0.02, 0.026, h, 6), x, y, z);
  mb.add('gold', sphere(0.035, 8, 6), x, y + h + 0.02, z);
  // the size is the banner cloth's in materials.ts; the shader bends it in the wind (coarser from afar)
  const fg = getDetail() ? new THREE.PlaneGeometry(0.46, 0.3, 14, 5) : new THREE.PlaneGeometry(0.46, 0.3, 6, 2);
  fg.translate(0.23, 0, 0);
  mb.add(`banner${owner}`, fg, x + 0.02, y + h - 0.17, z);
  mb.anchors.flags.push(new THREE.Vector3(x, y + h, z));
}

/** Merlons along the rim of a w x d wall top at y. */
function crenels(mb: MB, w: number, d: number, y: number, x = 0, z = 0, mat = 'stone', size = 0.13) {
  const hw = w / 2, hd = d / 2;
  const nX = Math.max(2, Math.round(w / (size * 2))), nZ = Math.max(2, Math.round(d / (size * 2)));
  const m = (px: number, pz: number, sw: number, sd: number) => mb.add(mat, box(sw, size * 1.15, sd, 1.3), px, y + size * 0.575, pz);
  for (let i = 0; i < nX; i++) {
    const px = x - hw + (i + 0.5) * (w / nX);
    m(px, z + hd - size * 0.45, size, size * 0.9);
    m(px, z - hd + size * 0.45, size, size * 0.9);
  }
  for (let i = 1; i < nZ - 1; i++) {
    const pz = z - hd + (i + 0.5) * (d / nZ);
    m(x + hw - size * 0.45, pz, size * 0.9, size);
    m(x - hw + size * 0.45, pz, size * 0.9, size);
  }
}

/** Parapet of a square tower: a projecting band on corbels, a brick course and merlons. */
function parapet(mb: MB, w: number, d: number, y: number, x = 0, z = 0) {
  const W = w + 0.12, D = d + 0.12;
  const nX = Math.round(w / 0.2), nZ = Math.round(d / 0.2);
  for (let i = 0; i < nX; i++) for (const sz of [-1, 1]) mb.add('ashlar', box(0.07, 0.1, 0.1, 3), x - w / 2 + (i + 0.5) * (w / nX), y - 0.05, z + sz * (d / 2 + 0.03));
  for (let i = 0; i < nZ; i++) for (const sx of [-1, 1]) mb.add('ashlar', box(0.1, 0.1, 0.07, 3), x + sx * (w / 2 + 0.03), y - 0.05, z - d / 2 + (i + 0.5) * (d / nZ));
  mb.add('stone', wallPrism(W, D, 0.14, { r: 0.04, batter: 0, wobble: 0.003, cap: true }), x, y, z);
  mb.add('brick', wallPrism(W + 0.01, D + 0.01, 0.07, { r: 0.045, batter: 0, wobble: 0.001, uvs: 1.2 }), x, y + 0.14, z);
  crenels(mb, W, D, y + 0.21, x, z, 'stone', 0.14);
}

/** Round tower of radius r and height h standing at (x, y, z). */
function roundTower(mb: MB, x: number, y: number, z: number, r: number, h: number, mat = 'stone', cap = false) {
  mb.add(mat, wallPrism(r * 2, r * 2, h, { r, batter: r * 0.08, wobble: 0.008, seed: x * 7 + z * 3, cap }), x, y, z);
  mb.add('stoneDark', wallPrism(r * 2 + 0.12, r * 2 + 0.12, 0.5, { r: r + 0.06, batter: 0.03, wobble: 0.004 }), x, y - 0.38, z);
}

/** Open top of a round tower: corbels, a brick band and a ring of merlons round a platform. */
function roundBattlement(mb: MB, x: number, y: number, z: number, r: number) {
  const R = r + 0.06;
  const n = Math.max(8, Math.round((Math.PI * 2 * R) / 0.19));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    mb.add('ashlar', box(0.07, 0.1, 0.1, 3), x + Math.sin(a) * (r + 0.02), y - 0.05, z + Math.cos(a) * (r + 0.02), a);
  }
  mb.add('stone', wallPrism(R * 2, R * 2, 0.14, { r: R, batter: 0, wobble: 0.003, cap: true }), x, y, z);
  mb.add('brick', wallPrism(R * 2 + 0.01, R * 2 + 0.01, 0.07, { r: R + 0.005, batter: 0, wobble: 0.001 }), x, y + 0.14, z);
  const m = Math.max(6, Math.round((Math.PI * 2 * R) / 0.26));
  for (let k = 0; k < m; k++) {
    const a = (k / m) * Math.PI * 2;
    mb.add('stone', box(0.13, 0.16, 0.1, 1.3), x + Math.sin(a) * (R - 0.05), y + 0.29, z + Math.cos(a) * (R - 0.05), a);
  }
  mb.add('cobble', new THREE.CircleGeometry(R - 0.08, 20), x, y + 0.215, z, 0, -Math.PI / 2, 0);
}

/** Round stone kerb of a well or basin: outer wall, inner face and a dressed coping ring. */
function kerb(mb: MB, x: number, y: number, z: number, r: number, h: number, mat = 'stone') {
  mb.add(mat, wallPrism(r * 2, r * 2, h, { r, batter: 0.01, wobble: 0.004 }), x, y, z);
  const inner = new THREE.CylinderGeometry(r - 0.06, r - 0.06, h, 16, 1, true);
  const idx = inner.index!;
  for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
  const n = inner.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  mb.add(mat, inner, x, y + h / 2, z);
  mb.add('ashlar', new THREE.RingGeometry(r - 0.075, r + 0.01, 16, 1), x, y + h + 0.002, z, 0, -Math.PI / 2, 0);
}

function stoneBlocks(mb: MB, x: number, y: number, z: number) {
  mb.add('ashlar', box(0.22, 0.16, 0.18, 4), x, y + 0.08, z, 0.2);
  mb.add('ashlar', box(0.2, 0.15, 0.2, 4), x + 0.24, y + 0.075, z + 0.02, -0.1);
  mb.add('ashlar', box(0.2, 0.14, 0.18, 4), x + 0.12, y + 0.23, z + 0.01, 0.4);
}

function boulder(mb: MB, x: number, y: number, z: number, r: number, seed = 1, mat = 'rock') {
  const g = new THREE.DodecahedronGeometry(r, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = 0.8 + 0.35 * Math.abs(Math.sin(vx * 7 + seed) * Math.cos(vz * 5 + vy * 3));
    p.setXYZ(i, vx * n, vy * n * 0.8, vz * n);
  }
  g.computeVertexNormals();
  mb.add(mat, g, x, y, z);
}

/** Windmill sails: a hub and n lattice sails with canvas, turning about z. */
function sailBlades(b: MB, n = 4, len = 1.35) {
  b.add('timber', cyl(0.08, 0.08, 0.18, 10), 0, 0, -0.02, 0, Math.PI / 2, 0);
  b.add('iron', sphere(0.05, 8, 6), 0, 0, 0.17);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const sub = new ModelBuilder();
    sub.add('timber', box(0.055, len, 0.045, 2), 0, len / 2 + 0.05, 0.1);
    // lattice: rails across and two stiles, canvas stretched on the trailing side
    sub.add('timber', box(0.022, len * 0.8, 0.022, 2), 0.3, len * 0.58, 0.11);
    for (let r = 0; r < 7; r++) sub.add('timber', box(0.33, 0.02, 0.02), 0.155, len * 0.2 + r * len * 0.126, 0.11);
    sub.add('canvas', box(0.27, len * 0.76, 0.008), 0.165, len * 0.58, 0.118);
    for (const [key, geos] of sub.parts) for (const g of geos) b.add(key, g.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ(a)));
  }
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

function amphora(mb: MB, x: number, y: number, z: number, s = 1, tilt = 0) {
  const prof = [[0.0, 0.0], [0.05, 0.02], [0.1, 0.09], [0.12, 0.18], [0.11, 0.27], [0.07, 0.34], [0.045, 0.38], [0.048, 0.43], [0.06, 0.44]]
    .map(([r, yy]) => new THREE.Vector2(r * s, yy * s));
  mb.add('terracotta', new THREE.LatheGeometry(prof, 12), x, y, z, 0, 0, tilt);
  for (const sx of [-1, 1]) mb.add('terracotta', new THREE.TorusGeometry(0.05 * s, 0.012 * s, 5, 8, Math.PI), x + sx * 0.065 * s, y + 0.34 * s, z, 0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
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
  if (k === 0) {
    for (const [px, pz] of [[-0.3, 0.14], [-0.12, 0.2], [0.06, 0.12]]) sub.add('hay', sphere(0.075, 8, 6), px, 0.5, pz);
    sub.add('hay', sphere(0.075, 8, 6), -0.2, 0.62, 0.17);
    amphora(sub, 0.3, 0.44, 0.18, 0.55);
    sack(sub, -0.55, 0, 0.5, 0.9);
    sack(sub, -0.3, 0, 0.58, 0.8, 0.6);
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
    logAlongX(sub, 0.26, 0.11, -0.62, 0.11, 0.55);
  }
  return sub;
}

function column(mb: MB, x: number, y: number, z: number, h: number, r = 0.06, mat = 'marble') {
  mb.add(mat, box(r * 2.9, 0.05, r * 2.9, 3), x, y + 0.025, z);
  const prof = [[r * 1.12, 0], [r * 1.0, 0.06], [r * 1.0, h * 0.35], [r * 0.9, h - 0.14], [r * 0.95, h - 0.11], [r * 1.25, h - 0.06]]
    .map(([rr, yy]) => new THREE.Vector2(rr, yy));
  mb.add(mat, new THREE.LatheGeometry(prof, 12), x, y + 0.05, z);
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

/** Round brick furnace with a firing mouth and a tall round brick stack beside it. */
function furnace(mb: MB, x: number, z: number, r = 0.3, stackH = 1.9, glow = 'glowFire') {
  mb.add('brick', wallPrism(r * 2, r * 2, 0.55, { r, batter: 0.05, wobble: 0.004, cap: true, uvs: 1.2 }), x, 0.02, z);
  mb.add('brick', sphere(r * 0.86, 14, 8, Math.PI * 2, Math.PI / 2), x, 0.57, z);
  // firing mouth, facing +z
  mb.add('ashlar', box(0.28, 0.06, 0.1, 3), x, 0.36, z + r * 0.92);
  mb.add('dark', box(0.22, 0.2, 0.06), x, 0.24, z + r * 0.9);
  mb.add(glow, box(0.18, 0.12, 0.02), x, 0.21, z + r * 0.93);
  mb.anchors.fires.push(new THREE.Vector3(x, 0.3, z + r + 0.1));
  // the stack stands behind
  const sz = z - r * 0.7;
  mb.add('brick', wallPrism(0.3, 0.3, stackH, { r: 0.15, batter: 0.035, wobble: 0.004, uvs: 1.2 }), x + r * 0.45, 0.02, sz);
  mb.add('stoneDark', wallPrism(0.3, 0.3, 0.08, { r: 0.15, batter: 0, wobble: 0 }), x + r * 0.45, stackH, sz);
  mb.add('dark', new THREE.CircleGeometry(0.1, 10), x + r * 0.45, stackH + 0.081, sz, 0, -Math.PI / 2, 0);
  mb.anchors.chimneys.push(new THREE.Vector3(x + r * 0.45, stackH + 0.12, sz));
}

/** Smelter's yard kit: a pair of bellows on a stand blowing into the furnace's right flank (the top
 *  board is the 'bellows' mover, hinged at the nozzle, that work.ts pumps), and a clay ingot mould
 *  in front of the furnace mouth. */
function smeltYard(mb: MB, fx: number, fz: number) {
  const bx = fx + 0.31, bz = fz + 0.15;
  for (const px of [0.05, 0.17]) mb.add('timber', box(0.05, 0.18, 0.18), bx + px, 0.09, bz);
  mb.add('planks', box(0.22, 0.025, 0.18, 3), bx + 0.1, 0.19, bz);
  mb.add('iron', cone(0.028, 0.1, 6), bx - 0.03, 0.21, bz, 0, 0, Math.PI / 2);
  const top = mb.mover('bellows', bx, 0.2, bz, 'z');
  top.add('dark', box(0.2, 0.045, 0.16), 0.1, 0.022, 0);
  top.add('planks', box(0.22, 0.02, 0.18, 3), 0.11, 0.05, 0);
  top.add('timber', box(0.11, 0.025, 0.025), 0.26, 0.05, 0);
  // the mould: a block of fired clay with an ingot-shaped hollow
  mb.add('stoneDark', box(0.3, 0.07, 0.17, 3), fx, 0.035, fz + 0.82);
  mb.add('dark', box(0.2, 0.012, 0.09), fx, 0.066, fz + 0.82);
}

/** Open hearth on a brick base with a grill and glowing coals, and an anvil on a stump nearby. */
function hearth(mb: MB, x: number, z: number) {
  mb.add('brick', wallPrism(0.5, 0.42, 0.32, { r: 0.12, batter: 0.03, wobble: 0.004, cap: true }), x, 0.02, z);
  mb.add('glowFire', new THREE.CircleGeometry(0.14, 10), x, 0.345, z, 0, -Math.PI / 2, 0);
  for (let k = 0; k < 5; k++) mb.add('iron', box(0.36, 0.012, 0.012), x, 0.36, z - 0.12 + k * 0.06);
  mb.anchors.fires.push(new THREE.Vector3(x, 0.45, z));
  mb.add('wood', cyl(0.075, 0.09, 0.2, 9, 2), x + 0.42, 0, z + 0.25);
  mb.add('iron', box(0.22, 0.07, 0.09), x + 0.42, 0.235, z + 0.25);
  mb.add('iron', cone(0.035, 0.1, 6), x + 0.56, 0.235, z + 0.25, 0, 0, -Math.PI / 2);
}

/** Rocky mound for mines: a lumpy dome of rock with boulders round its foot. */
function mound(mb: MB, seed: number, r = 1.3) {
  const g = new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.84 + 0.22 * Math.sin(x * 4.1 + z * 2.3 + seed) * Math.cos(z * 3.7 - y * 2) + 0.06 * Math.sin(x * 11 + z * 9 + seed);
    p.setXYZ(i, x * n, y * 0.7 * n, z * n * 0.85);
  }
  g.computeVertexNormals();
  mb.add('rock', g, 0, -0.3, -0.45);
  boulder(mb, -1.0, 0.0, 0.2, 0.3, seed + 7);
  boulder(mb, 1.05, 0.0, -0.1, 0.34, seed + 3);
  boulder(mb, 0.75, 0.0, 0.55, 0.18, seed + 5);
  boulder(mb, -0.7, 0.0, 0.7, 0.14, seed + 9);
}

/** Mine railway: sleepers, rails and a tub of ore at the end of them, out of the entrance at z0.
 *  The tub ('tub', pivot on its front axle) and its load ('tubore') are movers: work.ts rolls the
 *  tub in and out of the adit and tips it. */
function railway(mb: MB, z0: number, ore: string) {
  for (const s of [-1, 1]) mb.add('iron', box(0.022, 0.022, 0.95), s * 0.12, 0.03, z0 + 0.45);
  for (let k = 0; k < 5; k++) mb.add('timber', box(0.36, 0.025, 0.06), 0, 0.012, z0 + 0.05 + k * 0.2);
  const ax = z0 + 0.84;
  const tub = mb.mover('tub', 0, 0.06, ax, 'x');
  tub.add('planks', box(0.3, 0.16, 0.36, 3), 0, 0.09, -0.12);
  for (const s of [-1, 1]) for (const zz of [-0.24, 0]) tub.add('iron', new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8), s * 0.16, 0, zz, 0, 0, Math.PI / 2);
  mb.mover('tubore', 0, 0.06, ax, 'x').add(ore, sphere(0.14, 8, 6, Math.PI * 2, Math.PI / 2), 0, 0.16, -0.12);
}

// ------------------------------------------------------------------ building designs
type Design = (mb: MB, owner: number) => void;

/** The castle; the headquarters is the same with a roof over the keep. */
function castleDesign(mb: MB, owner: number, roofedKeep: boolean) {
  const S = 3.3, T = 0.3, H = 1.1;
  const hs = S / 2;
  plinth(mb, S + 0.3, S + 0.3, 0, 0, 0.1, 'stoneDark', 0.3);
  // curtain walls with a battlement walk
  const wall = (w: number, d: number, x: number, z: number) => {
    mb.add('stone', wallPrism(w, d, H, { r: 0.03, batter: 0.03, wobble: 0.007, seed: x * 3 + z }), x, 0.1, z);
    crenels(mb, w, d, H + 0.1, x, z, 'stone', 0.13);
    mb.add('cobble', box(w - 0.08, 0.02, d - 0.08, 1.2), x, H + 0.1, z);
  };
  wall(S, T, 0, -hs);
  wall(T, S, -hs, 0);
  wall(T, S, hs, 0);
  wall(S * 0.34, T, -S * 0.33, hs);
  wall(S * 0.34, T, S * 0.33, hs);
  // gatehouse with a round arch, red doors and a portcullis
  mb.add('stone', wallPrism(1.1, 0.62, 1.55, { r: 0.05, batter: 0.03, wobble: 0.006, seed: 3 }), 0, 0.1, hs);
  parapet(mb, 1.1, 0.62, 1.65, 0, hs);
  put(mb, archDoor(0.46, 0.78), 0, 0.1, hs + 0.31);
  for (let k = 0; k < 5; k++) mb.add('iron', box(0.018, 0.5, 0.018), -0.16 + k * 0.08, 0.7, hs + 0.33);
  win(mb, 0, 1.3, hs + 0.31, 'z', 0.09, 0.22, 'slit');
  // corner towers with open battlements
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    roundTower(mb, sx * hs, 0.1, sz * hs, 0.5, 1.6);
    roundBattlement(mb, sx * hs, 1.7, sz * hs, 0.5 - 0.04);
    for (const a of [0.8, 2.4]) win(mb, sx * hs + Math.sin(a * sx) * 0.47, 1.0, sz * hs + Math.cos(a * sz) * 0.47, 'z', 0.08, 0.2, 'slit');
  }
  // the keep at the back, and a great hall along the left wall
  mb.add('stone', wallPrism(1.4, 1.3, 2.25, { r: 0.06, batter: 0.05, wobble: 0.008, seed: 12 }), 0.35, 0.1, -0.7);
  parapet(mb, 1.4, 1.3, 2.35, 0.35, -0.7);
  for (const y of [1.3, 1.85]) for (const px of [0.0, 0.7]) win(mb, px, y, -0.05, 'z', 0.12, 0.22, 'arch');
  put(mb, archDoor(0.3, 0.5), 0.35, 0.1, -0.05);
  house(mb, { w: 0.9, d: 1.8, wallH: 0.9, roofH: 0.55, x: -0.95, z: 0.1, door: null, wins: [], chim: [0.2, 0.3], rot: true, noPlinth: true, sideWin: false, over: 0.14 });
  win(mb, -0.5, 0.7, -0.2, 'x', 0.14, 0.18);
  win(mb, -0.5, 0.7, 0.4, 'x', 0.14, 0.18);
  put(mb, archDoor(0.26, 0.46), -0.95, 0.12, 1.0);
  if (roofedKeep) {
    // the headquarters: a tiled roof over the keep's battlement on four corner posts, the flag on its peak
    mb.add(`roof${owner}`, hipRoof(1.34, 1.24, 0.85, 0.12, { style: 'tile', seed: 19 }), 0.35, 2.9, -0.7);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.add('timber', box(0.07, 0.36, 0.07, 2), 0.35 + sx * 0.6, 2.72, -0.7 + sz * 0.55);
    flag(mb, 0.35, 3.7, -0.7, 0.65, owner);
  } else flag(mb, 0.35, 2.76, -0.7, 1.0, owner);
  flag(mb, -hs, 1.92, -hs, 0.6, owner);
  flag(mb, hs, 1.92, -hs, 0.6, owner);
  mb.add('cobble', box(S - T * 2, 0.02, S - T * 2, 1), 0, 0.11, 0);
  mb.anchors.soldiers.push(new THREE.Vector3(-0.5, 1.22, hs), new THREE.Vector3(0.5, 1.22, hs), new THREE.Vector3(-hs, 1.22, 0.3), new THREE.Vector3(hs, 1.22, 0.3));
  mb.anchors.top = 3.8;
}

const designs: Partial<Record<BuildingType, Design>> = {
  woodcutter(mb) {
    // log cabin under thick thatch, a shingled lean-to full of logs, the chopping block out front
    house(mb, { w: 1.2, d: 0.95, wallH: 0.72, roofH: 0.62, x: -0.25, z: -0.2, wall: 'log', roofMat: 'thatch', door: 0.22, wins: [-0.3], chim: [-0.38, -0.2], sideWin: false });
    shed(mb, 0.68, -0.22, 0.95, 0.5, 0.46, 0.7, 'shingle', 'x');
    logPile(mb, 0.66, 0, -0.22, 3, 0.8, 0);
    logAlongX(mb, 0.28, 0.1, -0.7, 0.1, 0.6, 0.4);
    mb.add('wood', cyl(0.11, 0.12, 0.18, 10, 3), -0.62, 0, 0.62);
    mb.add('endgrain', new THREE.CircleGeometry(0.11, 10), -0.62, 0.181, 0.62, 0, -Math.PI / 2, 0);
    mb.add('timber', box(0.03, 0.3, 0.03), -0.62, 0.3, 0.62, 0, 0.3, 0.3);
    mb.add('metal', box(0.1, 0.07, 0.02), -0.575, 0.43, 0.63, 0, 0.3, 0.3);
    for (const [px, pz, ry] of [[-0.4, 0.72, 0.3], [-0.32, 0.66, 1.4]]) mb.add('wood', box(0.16, 0.05, 0.06), px, 0.03, pz, ry);
    mb.anchors.piles.push(new THREE.Vector3(0.55, 0, 0.65));
  },
  forester(mb) {
    // small stone cottage under thatch, with a fenced nursery of saplings
    house(mb, { w: 1.05, d: 0.9, wallH: 0.7, roofH: 0.6, x: -0.35, z: -0.3, roofMat: 'thatch', door: 0.15, wins: [-0.25], chim: null, rot: true });
    fence(mb, [[0.2, 0.2], [0.9, 0.2], [0.9, 0.9], [0.2, 0.9], [0.2, 0.45]], 0, 0.24);
    mb.add('soil', box(0.62, 0.05, 0.62), 0.55, 0.02, 0.55);
    for (const [px, pz] of [[0.35, 0.36], [0.55, 0.4], [0.75, 0.35], [0.38, 0.62], [0.6, 0.66], [0.78, 0.6], [0.48, 0.8], [0.72, 0.8]]) {
      mb.add('timber', cyl(0.01, 0.014, 0.12, 5), px, 0.04, pz);
      mb.add('leaf', cone(0.065, 0.17, 7), px, 0.11, pz);
    }
    // spade in the ground and a watering can
    mb.add('timber', box(0.025, 0.36, 0.025), 0.1, 0.18, 0.72, 0, 0, 0.2);
    mb.add('metal', box(0.09, 0.11, 0.015), 0.07, 0.03, 0.72, 0, 0, 0.2);
    mb.add('iron', cyl(0.06, 0.07, 0.12, 9), -0.75, 0, 0.45);
    mb.add('iron', cyl(0.012, 0.015, 0.16, 5), -0.66, 0.06, 0.45, 0, 0, -1.0);
    mb.anchors.piles.push(new THREE.Vector3(-0.7, 0, 0.7));
  },
  stonecutter(mb) {
    // rubble hut with a tile roof, dressed blocks, a rough boulder and a timber tripod crane
    house(mb, { w: 1.15, d: 0.95, wallH: 0.72, roofH: 0.55, x: -0.28, z: -0.25, door: 0.25, wins: [-0.3], chim: [-0.35, -0.18] });
    stoneBlocks(mb, 0.35, 0, 0.5);
    boulder(mb, 0.68, 0.05, -0.35, 0.24, 3, 'stone');
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      mb.add('timber', box(0.04, 0.9, 0.04), 0.66 + Math.sin(a) * 0.2, 0.43, -0.35 + Math.cos(a) * 0.2, a, 0.22, 0);
    }
    mb.add('rope', box(0.012, 0.36, 0.012), 0.66, 0.66, -0.35);
    mb.add('planks', box(0.42, 0.05, 0.26, 3), -0.62, 0.28, 0.58);
    for (const px of [-0.78, -0.46]) mb.add('timber', box(0.04, 0.28, 0.2), px, 0.14, 0.58);
    mb.add('metal', box(0.03, 0.03, 0.2), -0.62, 0.32, 0.58, 0.6);
    mb.anchors.piles.push(new THREE.Vector3(0.62, 0, 0.72));
  },
  sawmill(mb) {
    // long rubble mill house, an open saw shed on its right with the blade turning under it
    house(mb, { w: 1.75, d: 1.2, wallH: 0.9, roofH: 0.68, x: -0.4, z: -0.4, door: 0.1, wins: [-0.55, 0.45], chim: [-0.55, -0.25], dormer: -0.45 });
    shed(mb, 0.9, -0.35, 1.1, 0.72, 0.62, 0.86, 'roofX', 'x', true);
    mb.add('planks', box(0.55, 0.3, 0.3, 3), 0.95, 0.15, -0.3);
    const saw = mb.mover('saw', 0.95, 0.36, -0.3, 'x');
    saw.add('metal', new THREE.CylinderGeometry(0.17, 0.17, 0.012, 20), 0, 0, 0, 0, 0, Math.PI / 2);
    saw.add('iron', cyl(0.03, 0.03, 0.03, 8), -0.015, 0, 0, 0, 0, Math.PI / 2);
    // sawhorses
    for (const [px, pz] of [[-0.8, 0.62], [-0.45, 0.66]]) {
      for (const s of [-1, 1]) mb.add('timber', box(0.035, 0.34, 0.035), px, 0.15, pz, 0, 0, s * 0.5);
      logAlongX(mb, 0.24, 0.03, px, 0.26, pz, Math.PI / 2, 'timber');
    }
    logAlongX(mb, 0.9, 0.06, -0.6, 0.31, 0.64, 0);
    logPile(mb, 1.0, 0, 0.72, 3, 0.75, Math.PI / 2);
    for (let k = 0; k < 4; k++) mb.add('planks', box(0.7, 0.028, 0.12, 3), 0.25, 0.015 + k * 0.03, 0.8 - (k % 2) * 0.1);
    mb.anchors.piles.push(new THREE.Vector3(0.3, 0, 1.1));
  },
  storehouse(mb, owner) {
    // big rubble warehouse: broad red doors under a timber lintel, a hoist in the gable dormer
    const h = house(mb, { w: 2.3, d: 1.45, wallH: 1.03, roofH: 0.85, x: 0, z: -0.35, door: null, wins: [-0.8, 0.8], chim: null, over: 0.22 });
    put(mb, barnDoor(0.6, 0.66), 0, h.base, -0.35 + 0.725);
    dormer(mb, -0.55, h.top, -0.35, 1.45, 0.85, `roof${owner}`, 0.44);
    dormer(mb, 0.55, h.top, -0.35, 1.45, 0.85, `roof${owner}`, 0.44);
    // ramp and goods
    mb.add('planks', box(0.8, 0.05, 0.3, 3), 0, 0.08, 0.5, 0, -0.15, 0);
    for (const [px, pz] of [[-1.05, 0.72], [-0.82, 0.8], [1.08, 0.72]]) barrel(mb, px, 0, pz);
    crate(mb, 0.75, 0, 0.72, 0.24, 0.3);
    crate(mb, 0.75, 0.24, 0.72, 0.19, -0.2);
    sack(mb, -0.55, 0, 0.85);
    sack(mb, -0.4, 0, 0.95, 0.9, 1);
    mb.anchors.top = 2.2;
  },
  residence_s(mb) {
    // stone ground floor, a jettied half-timbered storey, window boxes
    house(mb, { w: 1.1, d: 0.95, wallH: 0.6, roofH: 0.6, x: -0.12, z: -0.2, upper: { h: 0.52, jetty: 0.05 }, door: 0.22, wins: [-0.25], chim: [0.28, -0.1], rot: true });
    for (const px of [-0.37, -0.12 + 0.22]) {
      mb.add('planks', box(0.22, 0.06, 0.07), px, 0.9, 0.34);
      for (let k = 0; k < 3; k++) mb.add(`trim${k % 2}`, sphere(0.028, 6, 4), px - 0.07 + k * 0.07, 0.95, 0.35);
    }
    barrel(mb, 0.62, 0, 0.55, 0.9);
    mb.add('planks', box(0.5, 0.04, 0.14, 3), -0.62, 0.2, 0.55);
    for (const px of [-0.82, -0.42]) mb.add('timber', box(0.04, 0.2, 0.12), px, 0.1, 0.55);
    mb.anchors.piles.push(new THREE.Vector3(0.6, 0, 0.85));
  },
  residence_m(mb) {
    // an L: two-storey main house and a lower wing with its own roof, a well in the yard
    house(mb, { w: 1.55, d: 1.05, wallH: 0.66, roofH: 0.64, x: -0.35, z: -0.55, upper: { h: 0.52, jetty: 0.05 }, door: 0.3, wins: [-0.45], chim: [-0.5, -0.15] });
    house(mb, { w: 0.85, d: 1.1, wallH: 0.84, roofH: 0.55, x: 0.95, z: 0.05, door: null, wins: [], chim: [0.1, 0.25], rot: true, backWin: false });
    win(mb, 0.95, 0.52, 0.6, 'z', 0.16, 0.2);
    put(mb, archDoor(0.28, 0.48), 0.52, 0.1, 0.25, FACE_RY['-x']);
    // well
    kerb(mb, -0.75, 0, 0.72, 0.21, 0.3);
    mb.add('water', new THREE.CircleGeometry(0.17, 12), -0.75, 0.22, 0.72, 0, -Math.PI / 2, 0);
    for (const s of [-1, 1]) mb.add('timber', box(0.045, 0.62, 0.045), -0.75 + s * 0.2, 0.31, 0.72);
    logAlongX(mb, 0.44, 0.03, -0.75, 0.56, 0.72, 0, 'timber');
    shed(mb, -0.75, 0.72, 0.5, 0.46, 0.7, 0.84, 'roofX', 'z', true);
    mb.anchors.piles.push(new THREE.Vector3(0.2, 0, 1.2));
  },
  residence_l(mb, owner) {
    // a villa: two storeys under a hipped roof, a square tower, an arcade along the front
    const h = house(mb, { w: 2.4, d: 1.35, wallH: 0.72, roofH: 0.72, x: 0.1, z: -0.6, wall: 'stone', upper: { h: 0.6, jetty: 0.0, mat: 'plasterWarm' }, door: 0.45, wins: [-0.75, 0.0, 0.95], chim: [-0.55, -0.2], hip: true });
    // tower
    const tx = -1.3, tz = 0.35;
    plinth(mb, 0.84, 0.84, tx, tz, 0.1, 'stoneDark', 0.06);
    mb.add('stone', wallPrism(0.76, 0.76, 2.1, { r: 0.05, batter: 0.03, wobble: 0.006, seed: 9 }), tx, 0.1, tz);
    mb.add('ashlar', box(0.86, 0.06, 0.86, 2), tx, 1.45, tz);
    mb.add(`roof${owner}`, hipRoof(0.76, 0.76, 0.62, 0.14, { style: 'tile', seed: 4 }), tx, 2.2, tz);
    win(mb, tx, 1.75, tz + 0.37, 'z', 0.14, 0.2, 'arch');
    win(mb, tx, 1.05, tz + 0.38, 'z');
    win(mb, tx + 0.38, 1.75, tz, 'x', 0.14, 0.2, 'arch');
    flag(mb, tx, 2.82, tz, 0.45, owner);
    // arcade: columns carrying a tiled lean-to
    for (let k = 0; k < 5; k++) column(mb, -0.75 + k * 0.42, 0.1, 0.36, 0.72, 0.05, 'ashlar');
    mb.add(`roof${owner}`, leanToRoof(2.0, 0.55, h.base + 0.72, h.base + 0.95, { style: 'tile', seed: 6 }), 0.1, 0, 0.26);
    mb.add('cobble', box(2.2, 0.03, 0.6, 1.3), 0.1, 0.1, 0.3);
    fence(mb, [[0.6, 1.5], [1.6, 1.5], [1.6, 0.7]], 0, 0.22);
    for (const [px, pz] of [[0.95, 1.1], [1.3, 1.2], [1.2, 0.9]]) mb.add('leaf', sphere(0.14, 8, 6), px, 0.12, pz, 0, 0, 0, 1);
    mb.anchors.piles.push(new THREE.Vector3(-0.3, 0, 1.4));
    mb.anchors.top = 3.4;
  },
  fisher(mb) {
    // board hut under a shingle roof, gable to the front; fish drying on a rack, a net and a boat
    house(mb, { w: 0.95, d: 1.05, wallH: 0.74, roofH: 0.6, x: -0.35, z: -0.25, wall: 'planks', roofMat: 'shingle', door: 0.0, wins: [], chim: null, rot: true, gableMat: 'planks' });
    win(mb, -0.35 - 0.475, 0.45, -0.25, '-x', 0.15, 0.17, 'timber');
    for (const px of [0.3, 0.95]) mb.add('timber', box(0.04, 0.6, 0.04), px, 0.3, 0.35);
    mb.add('timber', box(0.7, 0.03, 0.03), 0.62, 0.57, 0.35);
    for (let k = 0; k < 5; k++) {
      mb.add('rope', box(0.006, 0.06, 0.006), 0.38 + k * 0.12, 0.53, 0.35);
      mb.add('metal', box(0.04, 0.15, 0.015), 0.38 + k * 0.12, 0.43, 0.35);
    }
    // net on poles
    for (const px of [0.3, 0.9]) mb.add('timber', box(0.035, 0.46, 0.035), px, 0.23, -0.5);
    for (let k = 0; k < 7; k++) mb.add('dark', box(0.005, 0.36, 0.005), 0.33 + k * 0.09, 0.24, -0.5);
    for (let k = 0; k < 4; k++) mb.add('dark', box(0.58, 0.005, 0.005), 0.6, 0.1 + k * 0.09, -0.5);
    // upturned boat
    const hull = new THREE.CylinderGeometry(0.17, 0.17, 0.85, 10, 1, true, 0, Math.PI);
    mb.add('hull', hull, -0.45, 0.02, 0.62, Math.PI / 2 + 0.2, 0, Math.PI / 2);
    barrel(mb, 0.15, 0, 0.75, 0.85);
    mb.anchors.piles.push(new THREE.Vector3(0.62, 0, 0.8));
  },
  hunter(mb) {
    // log hut with a shingle roof, antlers over the door, a hide stretched on a frame
    house(mb, { w: 1.1, d: 0.92, wallH: 0.7, roofH: 0.55, x: -0.25, z: -0.2, wall: 'log', roofMat: 'shingle', door: 0.2, wins: [-0.28], chim: [-0.35, -0.15], sideWin: false });
    for (const s of [-1, 1]) {
      mb.add('endgrain', box(0.022, 0.18, 0.022), -0.05 + s * 0.07, 0.86, 0.33, 0, 0, s * 0.5);
      mb.add('endgrain', box(0.018, 0.1, 0.018), -0.05 + s * 0.13, 0.93, 0.33, 0, 0, s * 1.1);
      mb.add('endgrain', box(0.018, 0.08, 0.018), -0.05 + s * 0.1, 0.96, 0.33, 0, 0, s * 0.2);
    }
    for (const px of [0.5, 0.92]) mb.add('timber', box(0.04, 0.6, 0.04), px, 0.3, 0.55);
    for (const yy of [0.12, 0.58]) mb.add('timber', box(0.46, 0.035, 0.035), 0.71, yy, 0.55);
    mb.add('soil', box(0.34, 0.38, 0.012), 0.71, 0.35, 0.55);
    for (let k = 0; k < 4; k++) mb.add('rope', box(0.004, 0.06, 0.004), 0.56 + k * 0.1, 0.52, 0.556);
    mb.add('timber', box(0.02, 0.5, 0.02), -0.7, 0.25, 0.55, 0, 0, 0.18);
    mb.anchors.piles.push(new THREE.Vector3(-0.6, 0, 0.72));
  },
  farm(mb) {
    // long farmhouse and barn under heavy thatch, an open cart shed, a rick, a fenced garden
    house(mb, { w: 1.5, d: 1.05, wallH: 0.78, roofH: 0.72, x: -0.95, z: -0.85, roofMat: 'thatch', door: 0.3, wins: [-0.35], chim: [-0.45, -0.2] });
    const b = house(mb, { w: 1.3, d: 1.5, wallH: 0.98, roofH: 0.85, x: 0.85, z: -0.65, roofMat: 'thatch', door: null, wins: [], chim: null, rot: true, sideWin: false });
    put(mb, barnDoor(0.55, 0.7), 0.85, b.base, -0.65 + 0.75);
    mb.add('dark', box(0.26, 0.24, 0.03), 0.85, b.top + 0.22, 0.12);
    shed(mb, -0.15, -0.55, 0.55, 0.8, 0.62, 0.82, 'thatch', '-x', true);
    // cart under the shed
    mb.add('planks', box(0.4, 0.12, 0.34, 3), -0.15, 0.22, -0.5);
    for (const s of [-1, 1]) mb.add('wood', new THREE.CylinderGeometry(0.11, 0.11, 0.035, 12), -0.15 + s * 0.2, 0.12, -0.5, 0, 0, Math.PI / 2);
    // rick and sheaves
    mb.add('hay', sphere(0.32, 10, 8, Math.PI * 2, Math.PI / 2), -1.3, 0, 0.7);
    mb.add('hay', cone(0.3, 0.32, 10), -1.3, 0.2, 0.7);
    for (const [px, pz] of [[-0.85, 0.75], [-0.7, 0.6]]) mb.add('hay', cone(0.07, 0.24, 7), px, 0, pz);
    fence(mb, [[0.1, 0.45], [1.6, 0.45], [1.6, 1.4]], 0, 0.26);
    mb.add('planks', box(0.5, 0.12, 0.34, 3), 0.9, 0.2, 0.95);
    for (const sx of [-1, 1]) mb.add('wood', new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), 0.9, 0.12, 0.95 + sx * 0.18, 0, Math.PI / 2, 0);
    mb.anchors.piles.push(new THREE.Vector3(0.2, 0, 1.2));
  },
  mill(mb, owner) {
    // tapering octagonal stone tower with a timber cap storey and a pyramid of tiles, big lattice
    // sails, and a low annex for the sacks
    plinth(mb, 1.25, 1.25, 0, -0.1, 0.12, 'stoneDark', 0.5);
    mb.add('stone', wallPrism(1.12, 1.12, 1.65, { r: 0.3, batter: 0.12, wobble: 0.008, seed: 3 }), 0, 0.1, -0.1);
    mb.add('timber', box(1.0, 0.08, 1.0, 2), 0, 1.78, -0.1);
    mb.add('planks', wallPrism(0.98, 0.98, 0.38, { r: 0.04, batter: 0, wobble: 0.002 }), 0, 1.8, -0.1);
    mb.add(`roof${owner}`, hipRoof(0.98, 0.98, 0.75, 0.16, { style: 'tile', seed: 11 }), 0, 2.18, -0.1);
    put(mb, archDoor(0.3, 0.5), 0, 0.1, 0.43);
    win(mb, 0, 1.1, 0.43, 'z', 0.14, 0.18);
    win(mb, 0.5, 0.8, -0.1, 'x', 0.14, 0.18);
    win(mb, -0.5, 1.3, -0.1, '-x', 0.14, 0.18);
    mb.add('timber', box(0.14, 0.14, 0.55), 0, 2.02, 0.4);
    const blades = mb.mover('blades', 0, 2.02, 0.7, 'z');
    sailBlades(blades, 4, 1.35);
    // annex
    house(mb, { w: 0.7, d: 0.7, wallH: 0.62, roofH: 0.35, x: 0.85, z: 0.35, door: null, wins: [], chim: null, rot: true, noPlinth: false, sideWin: false });
    put(mb, archDoor(0.24, 0.4), 0.85, 0.1, 0.7);
    sack(mb, 0.55, 0, 0.85);
    sack(mb, 0.4, 0, 0.8, 0.85, 0.8);
    mb.anchors.piles.push(new THREE.Vector3(-0.8, 0, 0.8));
    mb.anchors.top = 3.5;
  },
  bakery(mb) {
    // stone house with a round brick oven built on its side, its own chimney, a bread sign
    house(mb, { w: 1.55, d: 1.15, wallH: 0.84, roofH: 0.66, x: -0.4, z: -0.4, door: 0.15, wins: [-0.45], chim: [0.4, -0.2], dormer: -0.35 });
    mb.add('brick', wallPrism(0.8, 0.8, 0.42, { r: 0.4, batter: 0.03, wobble: 0.004 }), 0.85, 0.02, 0.0);
    mb.add('brick', sphere(0.39, 14, 8, Math.PI * 2, Math.PI / 2), 0.85, 0.43, 0.0);
    mb.add('ashlar', box(0.3, 0.05, 0.12, 3), 0.85, 0.34, 0.38);
    mb.add('dark', halfDisc(0.12, 0.06), 0.85, 0.14, 0.37);
    mb.add('dark', box(0.24, 0.12, 0.06), 0.85, 0.08, 0.37);
    mb.add('glowFire', halfDisc(0.09, 0.02), 0.85, 0.12, 0.4);
    mb.anchors.fires.push(new THREE.Vector3(0.85, 0.2, 0.52));
    chimney(mb, 0.85, 0.55, -0.12, 0.45, 0.14);
    // the kneading table
    mb.add('planks', box(0.42, 0.03, 0.22, 3), 0.2, 0.27, 0.64);
    for (const [lx, lz] of [[-0.18, -0.08], [0.18, -0.08], [-0.18, 0.08], [0.18, 0.08]]) mb.add('timber', box(0.03, 0.26, 0.03), 0.2 + lx, 0.13, 0.64 + lz);
    mb.add('canvas', box(0.16, 0.005, 0.12), 0.14, 0.287, 0.63);
    // peel and firewood
    mb.add('timber', box(0.025, 0.02, 0.7), 1.3, 0.3, 0.3, 0.3, 0.3, 0);
    logPile(mb, 1.25, 0, -0.55, 2, 0.5, Math.PI / 2);
    // bread sign on a bracket
    mb.add('iron', box(0.02, 0.02, 0.26), -0.1, 0.72, 0.28);
    mb.add('wood', box(0.2, 0.14, 0.02), -0.1, 0.62, 0.4);
    mb.add('hay', sphere(0.05, 8, 6), -0.1, 0.62, 0.42, 0, 0, 0, 1);
    sack(mb, -1.05, 0, 0.45);
    mb.anchors.piles.push(new THREE.Vector3(-1.0, 0, 0.8));
  },
  waterworks(mb) {
    // rubble pump house under a big roof, a round basin with a winch and a trough in front
    house(mb, { w: 1.0, d: 0.9, wallH: 0.72, roofH: 0.58, x: -0.35, z: -0.35, door: 0.1, wins: [-0.25], chim: null, rot: true, over: 0.22 });
    const px = 0.5, pz = 0.35;
    kerb(mb, px, 0, pz, 0.27, 0.32);
    mb.add('water', new THREE.CircleGeometry(0.21, 14), px, 0.26, pz, 0, -Math.PI / 2, 0);
    for (const s of [-1, 1]) mb.add('timber', box(0.05, 0.62, 0.05), px + s * 0.26, 0.31, pz);
    mb.add('roofX', gableRoof(0.6, 0.36, 0.22, 0.07, { style: 'tile', seed: 2 }).roof, px, 0.64, pz);
    const winch = mb.mover('winch', px, 0.5, pz, 'x');
    winch.add('wood', cyl(0.05, 0.05, 0.46, 8), -0.23, 0, 0, 0, 0, -Math.PI / 2);
    winch.add('iron', box(0.02, 0.12, 0.02), 0.24, -0.05, 0);
    mb.add('rope', box(0.01, 0.2, 0.01), px, 0.38, pz);
    mb.add('wood', cyl(0.06, 0.05, 0.1, 8), px, 0.22, pz);
    // trough
    mb.add('stone', box(0.55, 0.18, 0.2, 3), 0.1, 0.09, 0.78);
    mb.add('water', box(0.48, 0.01, 0.13), 0.1, 0.17, 0.78);
    barrel(mb, 0.85, 0, -0.2);
    barrel(mb, 0.72, 0, -0.45, 0.9);
    mb.anchors.piles.push(new THREE.Vector3(-0.75, 0, 0.62));
  },
  pigfarm(mb) {
    // long thatched sty with a lean-to, a round wattle pen and a trough; the herd in it is drawn
    // live by pigs.ts, which keeps its pigs inside this pen and feeds them at this trough
    house(mb, { w: 1.9, d: 0.95, wallH: 0.72, roofH: 0.62, x: -0.25, z: -1.05, roofMat: 'thatch', door: -0.45, wins: [0.3], chim: [0.55, -0.1] });
    shed(mb, 1.2, -1.05, 0.95, 0.55, 0.5, 0.72, 'thatch', 'x');
    const pen: [number, number][] = [];
    for (let k = 0; k <= 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      if (k === 4) continue;
      pen.push([0.05 + Math.cos(a) * 1.3, 0.55 + Math.sin(a) * 0.82]);
    }
    fence(mb, pen, 0, 0.3);
    mb.add('soil', new THREE.CircleGeometry(1.25, 20).scale(1, 0.63, 1), 0.05, 0.015, 0.55, 0, -Math.PI / 2, 0);
    mb.add('wood', box(0.7, 0.1, 0.16, 3), -0.7, 0.05, 0.2, 0.3);
    mb.add('hay', sphere(0.2, 8, 6, Math.PI * 2, Math.PI / 2), 0.8, 0, 0.1);
    mb.anchors.piles.push(new THREE.Vector3(1.55, 0, 1.3));
  },
  slaughter(mb) {
    // butcher's house under a deep roof, a gallows with hooks, a round fenced yard and a block
    house(mb, { w: 1.45, d: 1.1, wallH: 0.84, roofH: 0.66, x: -0.4, z: -0.45, door: 0.2, wins: [-0.35], chim: [0.3, -0.2] });
    const gx = 0.75, gz = -0.35;
    mb.add('timber', box(0.07, 0.95, 0.07, 2), gx, 0.47, gz);
    mb.add('timber', box(0.6, 0.06, 0.06, 2), gx - 0.26, 0.92, gz);
    mb.add('timber', box(0.04, 0.3, 0.04, 2), gx - 0.1, 0.8, gz, 0, 0, 0.75);
    for (let k = 0; k < 2; k++) {
      mb.add('iron', box(0.008, 0.12, 0.008), gx - 0.2 - k * 0.2, 0.84, gz);
      mb.add('meat', sphere(0.07, 8, 6), gx - 0.2 - k * 0.2, 0.72, gz, 0, 0, 0, 1);
    }
    const pen: [number, number][] = [];
    for (let k = 0; k <= 12; k++) {
      const a = -0.4 + (k / 12) * Math.PI * 1.35;
      pen.push([0.72 + Math.cos(a) * 0.62, 0.55 + Math.sin(a) * 0.55]);
    }
    fence(mb, pen, 0, 0.28); // pigs waiting for the butcher stand in here (pigs.ts)
    mb.add('wood', cyl(0.14, 0.15, 0.24, 10, 3), -0.9, 0, 0.62);
    mb.add('metal', box(0.14, 0.08, 0.015), -0.85, 0.3, 0.62, 0.4, 0, 0.3);
    barrel(mb, -0.55, 0, 0.72, 0.85);
    mb.anchors.piles.push(new THREE.Vector3(0.1, 0, 1.0));
  },
  ironsmelter(mb, owner) {
    // rubble smelting house with a dormer, a round brick furnace and tall stack, bellows, mould and ore
    house(mb, { w: 1.4, d: 1.1, wallH: 0.84, roofH: 0.62, x: -0.5, z: -0.45, roofMat: `roof${owner}`, door: 0.2, wins: [-0.35], chim: null, dormer: -0.4 });
    furnace(mb, 0.72, 0.15, 0.3, 1.95);
    smeltYard(mb, 0.72, 0.15);
    mb.add('ironore', sphere(0.2, 8, 6, Math.PI * 2, Math.PI / 2), -1.05, 0, 0.62);
    mb.add('coal', sphere(0.17, 8, 6, Math.PI * 2, Math.PI / 2), -0.72, 0, 0.72);
    barrel(mb, 1.1, 0, 0.75, 0.9);
    mb.anchors.piles.push(new THREE.Vector3(0.15, 0, 1.05));
  },
  goldsmelter(mb, owner) {
    // sandstone house, a brick furnace glowing gold, bellows, a mould and a basket of ore
    house(mb, { w: 1.4, d: 1.1, wallH: 0.84, roofH: 0.62, x: -0.5, z: -0.45, wall: 'sandstone', roofMat: `roof${owner}`, door: 0.2, wins: [-0.35], chim: null, dormer: -0.4 });
    furnace(mb, 0.72, 0.15, 0.3, 1.8, 'glowGold');
    smeltYard(mb, 0.72, 0.15);
    const basket = new THREE.LatheGeometry([[0.08, 0], [0.14, 0.04], [0.16, 0.12]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
    mb.add('wood', basket, -0.9, 0.0, 0.7);
    mb.add('goldore', sphere(0.14, 8, 6, Math.PI * 2, Math.PI / 2), -0.9, 0.06, 0.7);
    mb.add('coal', sphere(0.16, 8, 6, Math.PI * 2, Math.PI / 2), -0.6, 0, 0.78);
    barrel(mb, 1.1, 0, 0.75, 0.9);
    mb.add('gold', box(0.12, 0.04, 0.06), 0.1, 0.02, 0.9);
    mb.add('gold', box(0.12, 0.04, 0.06), 0.13, 0.06, 0.9, 0.3);
    mb.anchors.piles.push(new THREE.Vector3(0.15, 0, 1.05));
  },
  toolsmith(mb) {
    // two roof wings, an open brick hearth with a grill, an anvil and a rack of tools
    house(mb, { w: 1.5, d: 1.05, wallH: 0.82, roofH: 0.64, x: -0.45, z: -0.55, door: -0.2, wins: [0.3], chim: [-0.55, -0.15] });
    house(mb, { w: 0.75, d: 0.8, wallH: 0.72, roofH: 0.5, x: 0.45, z: 0.12, door: null, wins: [], chim: null, rot: true, noPlinth: false, sideWin: false });
    win(mb, 0.45, 0.45, 0.52, 'z', 0.15, 0.17);
    hearth(mb, -0.35, 0.62);
    barrel(mb, 0.95, 0, 0.7, 0.85);
    mb.add('water', new THREE.CircleGeometry(0.075, 10), 0.95, 0.205, 0.7, 0, -Math.PI / 2, 0);
    mb.add('timber', box(0.5, 0.04, 0.04), 1.02, 0.5, -0.3, Math.PI / 2);
    for (let k = 0; k < 4; k++) mb.add('metal', box(0.02, 0.22, 0.02), 1.03, 0.36, -0.48 + k * 0.12);
    mb.anchors.piles.push(new THREE.Vector3(-1.0, 0, 0.75));
  },
  weaponsmith(mb, owner) {
    // rubble forge with a brick-vaulted gateway, a hearth, an anvil and the smith's shields
    house(mb, { w: 1.55, d: 1.1, wallH: 0.86, roofH: 0.66, x: -0.4, z: -0.5, roofMat: `roof${owner}`, door: null, wins: [-0.5, 0.4], chim: [0.5, -0.2] });
    // barrel vault gateway on the right
    const vx = 0.75, vz = -0.35;
    mb.add('brick', wallPrism(0.5, 0.95, 0.4, { r: 0.04, batter: 0.02, wobble: 0.004 }), vx, 0.02, vz);
    const vault = new THREE.CylinderGeometry(0.25, 0.25, 0.95, 14, 1, false, -Math.PI / 2, Math.PI);
    vault.rotateX(-Math.PI / 2);
    mb.add('brick', vault, vx, 0.42, vz);
    put(mb, archDoor(0.34, 0.6, 'brick'), vx, 0.02, vz + 0.475);
    put(mb, archDoor(0.3, 0.52), -0.4, 0.1, 0.05);
    hearth(mb, -0.8, 0.6);
    for (const px of [-0.95, -0.05]) {
      mb.add(`trim${owner}`, new THREE.CylinderGeometry(0.11, 0.11, 0.025, 12), px, 0.55, 0.07, 0, Math.PI / 2, 0);
      mb.add('metal', sphere(0.03, 6, 4), px, 0.55, 0.09);
    }
    for (let k = 0; k < 3; k++) mb.add('metal', box(0.025, 0.36, 0.01), 0.3 + k * 0.08, 0.19, 0.62, 0, 0, 0.1);
    mb.add('timber', box(0.36, 0.04, 0.04), 0.38, 0.32, 0.64);
    // a grindstone in a trough, turned by a crank ('grind' spins while the smith sharpens a blade)
    const gx = 0.86, gz = 0.76;
    mb.add('wood', box(0.22, 0.1, 0.12, 3), gx, 0.05, gz);
    mb.add('water', box(0.18, 0.01, 0.08), gx, 0.1, gz);
    for (const s of [-1, 1]) mb.add('timber', box(0.04, 0.26, 0.04), gx, 0.13, gz + s * 0.07);
    const wheel = mb.mover('grind', gx, 0.22, gz, 'z');
    wheel.add('stone', new THREE.CylinderGeometry(0.12, 0.12, 0.045, 16), 0, 0, 0, Math.PI / 2, 0, 0);
    wheel.add('iron', box(0.012, 0.012, 0.2), 0, 0, 0);
    wheel.add('iron', box(0.07, 0.012, 0.012), 0.035, 0, 0.1);
    mb.anchors.piles.push(new THREE.Vector3(0.1, 0, 1.0));
  },
  vineyard(mb, owner) {
    // a round rubble press house under a cone of tiles beside the vintner's house, vines and amphorae
    house(mb, { w: 1.25, d: 0.95, wallH: 0.78, roofH: 0.58, x: -0.6, z: -0.7, wall: 'plasterWarm', roofMat: `roof${owner}`, door: 0.2, wins: [-0.25], chim: [-0.3, -0.15] });
    const rx = 0.7, rz = -0.45;
    roundTower(mb, rx, 0.02, rz, 0.5, 0.78);
    mb.add(`roof${owner}`, coneRoof(0.5, 0.62, 0.16, { style: 'tile', seed: 8 }), rx, 0.8, rz);
    mb.add('gold', sphere(0.04, 8, 6), rx, 1.44, rz);
    put(mb, archDoor(0.28, 0.5), rx, 0.02, rz + 0.49);
    win(mb, rx + 0.35, 0.55, rz + 0.35, 'z', 0.12, 0.15, 'arch');
    // cellar hatch
    mb.add('stoneDark', box(0.4, 0.2, 0.3, 3), -1.35, 0.1, -0.45, 0, 0, 0.35);
    mb.add('doorRed', box(0.36, 0.02, 0.26, 3), -1.32, 0.2, -0.45, 0, 0, 0.35);
    // press
    const px = 0.25, pz = 0.55;
    mb.add('wood', cyl(0.24, 0.27, 0.22, 14, 3), px, 0, pz);
    for (const yy of [0.04, 0.16]) mb.add('iron', cyl(0.255, 0.275, 0.022, 14), px, yy, pz);
    mb.add('wine', cyl(0.22, 0.22, 0.01, 14), px, 0.2, pz);
    mb.add('timber', cyl(0.21, 0.21, 0.05, 12), px, 0.27, pz);
    mb.add('iron', cyl(0.03, 0.03, 0.55, 8), px, 0.27, pz);
    for (const sx of [-1, 1]) mb.add('timber', box(0.07, 0.9, 0.07), px + sx * 0.33, 0.45, pz);
    mb.add('timber', box(0.78, 0.08, 0.09), px, 0.88, pz);
    barrel(mb, 1.2, 0, 0.35, 1.1);
    logAlongX(mb, 0.26, 0.11, 1.0, 0.11, 0.85, 0, 'wood');
    vineRow(mb, -1.3, 0.3, -1.3, 1.25, 1);
    vineRow(mb, -0.85, 0.35, -0.85, 1.25, 2);
    amphora(mb, -0.35, 0, 0.95, 0.9);
    amphora(mb, -0.52, 0, 1.1, 0.85, 0.2);
    mb.anchors.piles.push(new THREE.Vector3(0.6, 0, 1.2));
  },
  temple(mb, owner) {
    plinth(mb, 2.36, 1.96, 0, -0.15, 0.14, 'marbleDark', 0.04);
    mb.add('marble', box(2.2, 0.12, 1.8, 1.2), 0, 0.2, -0.15);
    [[0.26, 0.85], [0.17, 1.05], [0.09, 1.25]].forEach(([hh, zz]) => mb.add('marbleDark', box(1.25, hh, 0.2, 1.5), 0, hh / 2, zz));
    const y0 = 0.26;
    mb.add('marble', wallPrism(1.25, 1.1, 1.0, { r: 0.03, batter: 0, wobble: 0.002, uvs: 1.2 }), 0, y0, -0.3);
    mb.add('dark', box(0.38, 0.64, 0.03), 0, y0 + 0.32, 0.26);
    mb.add('dark', halfDisc(0.19, 0.03), 0, y0 + 0.64, 0.26);
    mb.add('gold', box(0.46, 0.04, 0.05), 0, y0 + 0.86, 0.27);
    const ch = 1.05;
    for (const cx of [-0.95, -0.57, -0.19, 0.19, 0.57, 0.95]) { column(mb, cx, y0, 0.58, ch); column(mb, cx, y0, -0.95, ch); }
    for (const cz of [-0.57, -0.19, 0.2]) { column(mb, -0.95, y0, cz, ch); column(mb, 0.95, y0, cz, ch); }
    const y1 = y0 + ch;
    mb.add('marble', box(2.14, 0.1, 1.74, 1.2), 0, y1 + 0.05, -0.19);
    mb.add(`trim${owner}`, box(2.16, 0.06, 1.76), 0, y1 + 0.13, -0.19);
    mb.add('marble', box(2.2, 0.04, 1.8, 1.2), 0, y1 + 0.18, -0.19);
    const r = gableRoof(1.8, 2.2, 0.42, 0.06, { style: 'tile', seed: 21, overEnd: 0.04 });
    mb.add(`roof${owner}`, r.roof, 0, y1 + 0.2, -0.19, Math.PI / 2);
    mb.add(`roof${owner}`, r.ridge, 0, y1 + 0.2, -0.19, Math.PI / 2);
    mb.add('marble', r.gable, 0, y1 + 0.2, -0.19, Math.PI / 2);
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
    mb.add('marble', box(1.7, 0.86, 1.0, 1.2), 0, y0 - 0.43, 1.25);
    [[0.27, 1.85], [0.18, 2.03], [0.09, 2.21]].forEach(([hh, zz]) => mb.add('marbleDark', box(1.3, hh, 0.19, 1.5), 0, hh / 2, zz));
    mb.add('marble', cyl(0.95, 0.95, 1.36, 28, 1.2), 0, y0, cz);
    mb.add('dark', box(0.42, 0.78, 0.03), 0, y0 + 0.39, cz + 0.955);
    mb.add('dark', halfDisc(0.21, 0.03), 0, y0 + 0.78, cz + 0.955);
    const ch = 1.22;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (Math.cos(a) > 0.8) continue;
      column(mb, Math.sin(a) * 1.3, y0, cz + Math.cos(a) * 1.3, ch, 0.065);
    }
    mb.add('marble', cyl(1.43, 1.43, 0.12, 32, 1.2), 0, y0 + ch, cz);
    mb.add(`trim${owner}`, cyl(1.44, 1.44, 0.05, 32), 0, y0 + ch + 0.12, cz);
    mb.add('marble', cyl(1.46, 1.46, 0.04, 32, 1.2), 0, y0 + ch + 0.17, cz);
    const yd = y0 + ch + 0.2;
    mb.add('marble', cyl(1.0, 1.0, 0.42, 28, 1.2), 0, yd, cz);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      mb.add('window', box(0.1, 0.2, 0.03), Math.sin(a) * 1.005, yd + 0.21, cz + Math.cos(a) * 1.005, a);
      mb.anchors.windows.push(new THREE.Vector3(Math.sin(a) * 1.2, yd + 0.21, cz + Math.cos(a) * 1.2));
    }
    const yDome = yd + 0.42;
    const dome = sphere(1.02, 28, 14, Math.PI * 2, Math.PI / 2);
    const duv = dome.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < duv.count; i++) duv.setXY(i, duv.getX(i) * 6.4 * 1.2, duv.getY(i) * 3.2 * 1.2);
    mb.add(`roof${owner}`, dome, 0, yDome, cz);
    for (let k = 0; k < 8; k++) mb.add('gold', new THREE.TorusGeometry(1.035, 0.022, 4, 18, Math.PI / 2), 0, yDome, cz, (k / 8) * Math.PI * 2, 0, 0);
    mb.add('gold', cyl(1.04, 1.04, 0.05, 28), 0, yDome - 0.02, cz);
    const yl = yDome + 0.98;
    mb.add('marble', cyl(0.22, 0.24, 0.06, 12), 0, yl, cz);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      mb.add('marble', cyl(0.02, 0.02, 0.28, 6), Math.sin(a) * 0.17, yl + 0.06, cz + Math.cos(a) * 0.17);
    }
    mb.add('glowHoly', new THREE.OctahedronGeometry(0.09, 0), 0, yl + 0.2, cz);
    mb.add(`roof${owner}`, coneRoof(0.18, 0.28, 0.08, { style: 'tile', seed: 3 }), 0, yl + 0.34, cz);
    mb.add('gold', sphere(0.05, 8, 6), 0, yl + 0.63, cz);
    for (const px of [-0.6, -0.2, 0.2, 0.6]) column(mb, px, y0, 1.6, ch, 0.06);
    mb.add('marble', box(1.56, 0.12, 0.95, 1.2), 0, y0 + ch + 0.06, 1.28);
    mb.add(`trim${owner}`, box(1.58, 0.05, 0.97), 0, y0 + ch + 0.14, 1.28);
    const r = gableRoof(1.0, 1.62, 0.4, 0.05, { style: 'tile', seed: 17, overEnd: 0.04 });
    mb.add(`roof${owner}`, r.roof, 0, y0 + ch + 0.17, 1.28, Math.PI / 2);
    mb.add(`roof${owner}`, r.ridge, 0, y0 + ch + 0.17, 1.28, Math.PI / 2);
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
    // two-storey rubble warehouse with a loft hoist, a round beacon tower, a crane on the quay
    const h = house(mb, { w: 1.85, d: 1.15, wallH: 0.72, roofH: 0.7, x: -0.3, z: -0.5, upper: { h: 0.5, jetty: 0.04, mat: 'planks' }, roofMat: `roof${owner}`, door: 0.1, wins: [-0.55, 0.55], chim: [-0.55, -0.2] });
    mb.add('dark', box(0.34, 0.36, 0.03), 0.35, h.base + 0.72 + 0.3, 0.12);
    mb.add('timber', box(0.06, 0.06, 0.5), 0.35, h.top + 0.2, 0.28);
    mb.add('rope', box(0.01, 0.45, 0.01), 0.35, h.top - 0.04, 0.5);
    crate(mb, 0.35, h.top - 0.44, 0.5, 0.15, 0.2);
    // beacon tower
    const tx = 1.0, tz = -0.75, th = 2.0;
    roundTower(mb, tx, 0.02, tz, 0.3, th);
    win(mb, tx, 1.2, tz + 0.3, 'z', 0.08, 0.2, 'slit');
    mb.add('ashlar', wallPrism(0.74, 0.74, 0.08, { r: 0.37, batter: 0, wobble: 0.002, cap: true }), tx, th, tz);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      mb.add('iron', box(0.025, 0.3, 0.025), tx + Math.sin(a) * 0.26, th + 0.23, tz + Math.cos(a) * 0.26);
    }
    mb.add('glowGold', cyl(0.14, 0.14, 0.22, 12), tx, th + 0.1, tz);
    mb.anchors.fires.push(new THREE.Vector3(tx, th + 0.24, tz));
    mb.add(`roof${owner}`, coneRoof(0.28, 0.36, 0.1, { style: 'tile', seed: 5 }), tx, th + 0.38, tz);
    flag(mb, tx, th + 0.72, tz, 0.5, owner);
    mb.anchors.soldiers.push(new THREE.Vector3(tx, th + 0.1, tz + 0.3));
    // crane on the quay
    const crane = mb.mover('crane', -1.12, 0, 0.72, 'y');
    crane.add('timber', box(0.09, 1.3, 0.09, 2), 0, 0.65, 0);
    crane.add('timber', box(0.07, 0.07, 1.0, 2), 0, 1.28, 0.38, 0, -0.35, 0);
    crane.add('timber', box(0.05, 0.05, 0.62, 2), 0, 0.98, 0.2, 0, 0.55, 0);
    crane.add('rope', box(0.012, 0.6, 0.012), 0, 1.15, 0.84);
    crane.add('planks', box(0.18, 0.14, 0.18, 4), 0, 0.8, 0.84);
    crane.add('wood', cyl(0.13, 0.13, 0.08, 10), 0, 0.16, 0, 0, 0, Math.PI / 2);
    for (const [px, pz] of [[0.75, 0.55], [0.95, 0.35], [0.6, 0.85]]) barrel(mb, px, 0, pz);
    crate(mb, -0.55, 0, 0.75, 0.24, 0.3);
    crate(mb, -0.7, 0.24, 0.72, 0.18, -0.2);
    crate(mb, -0.35, 0, 0.95, 0.2, 0.9);
    mb.add('rope', new THREE.TorusGeometry(0.1, 0.03, 6, 14), 1.25, 0.03, 0.9, 0, Math.PI / 2, 0);
    mb.add('iron', box(0.035, 0.46, 0.035), -1.25, 0.25, -0.05, 0, 0, 0.12);
    mb.add('iron', new THREE.TorusGeometry(0.14, 0.02, 5, 12, Math.PI), -1.22, 0.08, -0.05, 0, 0, Math.PI);
    mb.anchors.piles.push(new THREE.Vector3(-1.0, 0, 1.1));
    mb.anchors.top = th + 1.2;
  },
  shipyard(mb) {
    // a half-timbered workshop, a big open shed on posts under thatch, planks and steamed ribs
    house(mb, { w: 1.1, d: 0.95, wallH: 0.74, roofH: 0.55, x: -0.8, z: -0.8, wall: 'plaster', door: 0.2, wins: [-0.25], chim: [-0.3, -0.15], rot: true });
    for (const [px, pz] of [[0.25, -0.2], [1.2, -0.2], [0.25, -1.05], [1.2, -1.05]]) mb.add('timber', box(0.08, 0.9, 0.08, 2), px, 0.45, pz);
    roof(mb, 'thatch', 0.95, 0.85, 0.42, 0.72, 0.9, -0.62, { over: 0.14, overEnd: 0.12 });
    for (let k = 0; k < 6; k++) mb.add('planks', box(0.8, 0.03, 0.12, 3), 0.72, 0.05 + k * 0.032, -0.75 + (k % 2) * 0.13);
    logPile(mb, 0.72, 0, -0.35, 2, 0.8, 0);
    for (const sx of [-1, 1]) mb.add('timber', box(0.04, 0.26, 0.2), -0.1 + sx * 0.3, 0.13, 0.55);
    mb.add('planks', box(0.9, 0.035, 0.14, 3), -0.1, 0.28, 0.55);
    mb.add('stoneDark', cyl(0.16, 0.18, 0.1, 10), -1.05, 0, 0.55);
    mb.add('iron', cyl(0.12, 0.1, 0.16, 12), -1.05, 0.12, 0.55);
    mb.add('dark', cyl(0.11, 0.11, 0.01, 12), -1.05, 0.275, 0.55);
    mb.add('glowFire', box(0.12, 0.05, 0.12), -1.05, 0.1, 0.55);
    mb.anchors.fires.push(new THREE.Vector3(-1.05, 0.2, 0.55));
    mb.anchors.chimneys.push(new THREE.Vector3(-1.05, 0.3, 0.55));
    for (let k = 0; k < 3; k++) mb.add('timber', new THREE.TorusGeometry(0.34, 0.02, 4, 10, Math.PI * 0.7), -0.25 + k * 0.1, 0.05, -0.28, 0, 0.2, Math.PI * 0.62);
    mb.anchors.piles.push(new THREE.Vector3(0.9, 0, 0.75));
    mb.anchors.top = 1.6;
  },
  market(mb, owner) {
    // a cobbled square ringed by stalls, with the market cross and the weighing scales in the middle
    mb.add('cobble', box(2.8, 0.07, 2.8, 1), 0, 0.035, 0);
    mb.add('stoneDark', box(2.9, 0.05, 2.9, 1.2), 0, 0.0, 0);
    put(mb, marketStall(owner, 0), -0.05, 0, -0.95, 0);
    put(mb, marketStall(owner, 1), -1.0, 0, 0.05, Math.PI / 2);
    put(mb, marketStall(owner, 2), 1.0, 0, -0.05, -Math.PI / 2);
    mb.add('ashlar', box(0.5, 0.14, 0.5, 3), 0.1, 0.14, 0.2);
    mb.add('stone', wallPrism(0.32, 0.32, 0.12, { r: 0.04, batter: 0.02, wobble: 0.002, cap: true }), 0.1, 0.21, 0.2);
    flag(mb, 0.1, 0.33, 0.2, 1.35, owner);
    mb.add('gold', sphere(0.05, 8, 6), 0.1, 1.72, 0.2);
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
    mb.add('planks', box(0.55, 0.14, 0.36, 3), 0.85, 0.24, 0.85, 0.3);
    for (const s of [-1, 1]) mb.add('wood', new THREE.CylinderGeometry(0.11, 0.11, 0.035, 10), 0.85 + Math.sin(0.3) * s * 0.2, 0.13, 0.85 + Math.cos(0.3) * s * 0.2, 0.3, Math.PI / 2, 0);
    mb.add('timber', box(0.04, 0.04, 0.5), 0.85 - Math.sin(0.3) * 0.45, 0.2, 0.85 - Math.cos(0.3) * 0.45, 0.3, 0, -0.35);
    for (const [px, pz] of [[0.78, 0.8], [0.92, 0.9]]) sack(mb, px, 0.3, pz, 0.8);
    crate(mb, -1.05, 0, 1.0, 0.22, 0.2);
    crate(mb, -1.05, 0.22, 1.0, 0.17, -0.4);
    barrel(mb, -0.75, 0, 1.12, 0.9);
    mb.anchors.piles.push(new THREE.Vector3(0.45, 0, 1.15));
    mb.anchors.top = 1.9;
  },
  donkeyfarm(mb) {
    // a log stable under thatch with a hay loft, a fenced paddock with a trough, hay and the herd
    const h = house(mb, { w: 1.5, d: 1.0, wallH: 0.78, roofH: 0.64, x: -0.65, z: -0.8, wall: 'log', roofMat: 'thatch', door: null, wins: [0.4], chim: null, sideWin: false });
    put(mb, barnDoor(0.42, 0.52), -0.9, h.base, -0.3);
    mb.add('dark', box(0.3, 0.24, 0.03), -0.65, h.top + 0.2, -0.3 + 0.12);
    fence(mb, [[-1.35, -0.1], [-1.35, 1.35], [1.35, 1.35], [1.35, -1.35], [0.35, -1.35]], 0, 0.3);
    fence(mb, [[0.2, -0.15], [1.35, -0.15]], 0, 0.3);
    mb.add('soil', box(2.6, 0.03, 1.3), 0, 0.015, 0.7);
    mb.add('soil', box(1.1, 0.03, 1.2), 0.8, 0.015, -0.7);
    mb.add('wood', box(0.7, 0.16, 0.24, 3), 0.5, 0.08, 1.05);
    mb.add('water', box(0.62, 0.02, 0.17), 0.5, 0.15, 1.05);
    mb.add('iron', cyl(0.08, 0.07, 0.14, 8), 1.05, 0, 0.95);
    mb.add('water', new THREE.CircleGeometry(0.07, 8), 1.05, 0.13, 0.95, 0, -Math.PI / 2, 0);
    mb.add('hay', sphere(0.28, 10, 8, Math.PI * 2, Math.PI / 2), -0.95, 0, 0.9);
    mb.add('hay', cone(0.26, 0.26, 10), -0.95, 0.18, 0.9);
    for (const [px, pz] of [[-0.5, 0.45], [-0.3, 0.55]]) mb.add('hay', sphere(0.09, 8, 6), px, 0.07, pz);
    sack(mb, -0.2, 0, -0.18, 0.9);
    sack(mb, -0.05, 0, -0.24, 0.85, 1);
    const herd = mb.mover('donkeys', 0, 0, 0, 'y');
    donkeyModel(herd, 0.55, 0.45, 2.4);
    donkeyModel(herd, 0.95, -0.75, 0.6);
    donkeyModel(herd, -0.15, 0.95, 4.2);
    mb.anchors.piles.push(new THREE.Vector3(1.05, 0, -1.15));
    mb.anchors.top = 1.8;
  },
  siegeworks(mb, owner) {
    // a big timbered shed with the engineer's forge, a catapult taking shape under a lean-to,
    // wheels against the wall and a stack of stones waiting to be thrown
    house(mb, { w: 1.65, d: 1.1, wallH: 0.88, roofH: 0.64, x: -0.55, z: -0.6, wall: 'planks', roofMat: `roof${owner}`, door: 0.25, wins: [-0.4], chim: [0.5, -0.2], gableMat: 'planks' });
    shed(mb, 0.82, -0.55, 1.4, 1.1, 0.95, 1.2, 'shingle', 'x', true);
    mb.add('soil', box(1.3, 0.03, 1.5), 0.82, 0.015, -0.5);
    mb.add('timber', box(0.07, 0.08, 0.85), 0.62, 0.34, -0.55);
    mb.add('timber', box(0.07, 0.08, 0.85), 1.02, 0.34, -0.55);
    for (const pz of [-0.9, -0.2]) mb.add('timber', box(0.5, 0.06, 0.07), 0.82, 0.34, pz);
    for (const pz of [-0.85, -0.25]) { mb.add('dark', box(0.05, 0.3, 0.05), 0.62, 0.15, pz); mb.add('dark', box(0.05, 0.3, 0.05), 1.02, 0.15, pz); }
    // the catapult on the stocks gains a part with every cycle (buildings.ts shows 'cat1'..'cat3'
    // as b.shipProgress rises): the uprights, then the cross beam and the skein, then the arm,
    // which lies on the ground in front ('arm0') until it is fitted
    const c1 = mb.mover('cat1', 0, 0, 0, 'y'), c2 = mb.mover('cat2', 0, 0, 0, 'y'), c3 = mb.mover('cat3', 0, 0, 0, 'y');
    for (const px of [0.62, 1.02]) { c1.add('timber', box(0.06, 0.5, 0.06), px, 0.6, -0.45); c1.add('timber', box(0.05, 0.45, 0.05), px, 0.58, -0.25, 0, -0.55, 0); }
    c2.add('timber', box(0.52, 0.06, 0.08), 0.82, 0.86, -0.45);
    c2.add('rope', cyl(0.05, 0.05, 0.42, 8), 0.82, 0.48, -0.5, 0, 0, Math.PI / 2);
    c3.add('timber', box(0.06, 0.06, 0.62), 0.82, 0.66, -0.34, -0.95, 0, 0);
    c3.add('wood', cyl(0.07, 0.05, 0.05, 8), 0.82, 0.93, -0.12);
    mb.mover('arm0', 0, 0, 0, 'y').add('timber', box(0.06, 0.06, 0.95), 0.82, 0.05, 0.55);
    for (const [px, pz, ry] of [[-0.1, 0.25, 0.25], [0.12, 0.3, -0.2]]) mb.add('dark', new THREE.TorusGeometry(0.16, 0.03, 6, 14), px, 0.19, pz, ry, 0, 0.35);
    mb.add('planks', box(0.7, 0.06, 0.4, 2), -0.6, 0.5, 0.65);
    for (const px of [-0.9, -0.3]) mb.add('timber', box(0.05, 0.5, 0.05), px, 0.25, 0.65);
    mb.add('dark', new THREE.TorusGeometry(0.16, 0.03, 6, 14), -0.6, 0.56, 0.65, 0, Math.PI / 2, 0);
    mb.add('iron', box(0.16, 0.12, 0.3), -0.85, 0.56, 0.75);
    for (const [px, pz, r] of [[1.25, 0.75, 0.13], [1.0, 0.85, 0.12], [1.15, 1.0, 0.11], [0.85, 1.05, 0.1], [1.12, 0.88, 0.1]]) {
      mb.add('ashlar', new THREE.DodecahedronGeometry(r, 0), px, r * 0.85 + (px === 1.12 ? 0.2 : 0), pz, px * 3, pz * 2, 0);
    }
    // tall enough that the flag flies over the roof when the wind blows across it
    flag(mb, -1.3, 0, -1.25, 2.0, owner);
    mb.anchors.fires.push(new THREE.Vector3(-1.0, 0.45, -0.3));
    mb.anchors.piles.push(new THREE.Vector3(-0.2, 0, 1.15));
    mb.anchors.top = 1.9;
  },
  barracks(mb, owner) {
    // long two-storey rubble barracks with a stair tower, a yard with dummies and a weapon rack
    house(mb, { w: 2.3, d: 1.15, wallH: 0.78, roofH: 0.7, x: -0.1, z: -0.5, upper: { h: 0.5, jetty: 0, mat: 'stone' }, roofMat: `roof${owner}`, door: 0.1, wins: [-0.75, 0.75], chim: [0.75, -0.2], dormer: -0.4 });
    const tx = -1.2, tz = 0.15;
    roundTower(mb, tx, 0.02, tz, 0.3, 1.6);
    mb.add(`roof${owner}`, coneRoof(0.3, 0.55, 0.12, { style: 'tile', seed: 14 }), tx, 1.62, tz);
    win(mb, tx, 1.1, tz + 0.3, 'z', 0.08, 0.2, 'slit');
    flag(mb, tx, 2.2, tz, 0.5, owner);
    // a tall pole clear of the eaves, so the flag can stream whichever way the wind blows
    flag(mb, 1.4, 0, 0.6, 1.95, owner);
    for (const px of [-0.6, 0.6]) {
      mb.add('timber', box(0.04, 0.5, 0.04), px, 0.25, 0.75);
      mb.add('timber', box(0.3, 0.04, 0.04), px, 0.4, 0.75);
      mb.add('hay', sphere(0.08, 8, 6), px, 0.56, 0.75);
    }
    mb.add('timber', box(0.5, 0.04, 0.04), 0.1, 0.45, 0.95);
    for (const px of [-0.12, 0.32]) mb.add('timber', box(0.04, 0.45, 0.04), px, 0.22, 0.95);
    for (let k = 0; k < 4; k++) mb.add('metal', box(0.02, 0.42, 0.02), -0.05 + k * 0.1, 0.25, 0.97, 0, 0, 0.08);
  },
  tower_s(mb, owner) {
    // guard tower: a square rubble tower rising out of a hipped skirt roof over its base, with a
    // brick-banded battlement on top
    plinth(mb, 1.3, 1.3, 0, -0.05, 0.12, 'stoneDark', 0.08);
    mb.add('stone', wallPrism(1.22, 1.22, 0.62, { r: 0.08, batter: 0.02, wobble: 0.006, seed: 2 }), 0, 0.12, -0.05);
    mb.add(`roof${owner}`, hipRoof(1.22, 1.22, 0.42, 0.2, { style: 'tile', seed: 7 }), 0, 0.74, -0.05);
    mb.add('stone', wallPrism(0.78, 0.78, 1.75, { r: 0.05, batter: 0.03, wobble: 0.006, seed: 5 }), 0, 0.5, -0.05);
    parapet(mb, 0.78, 0.78, 2.25, 0, -0.05);
    put(mb, archDoor(0.3, 0.5), 0.1, 0.12, 0.56);
    win(mb, 0, 1.55, 0.34, 'z', 0.1, 0.24, 'arch');
    win(mb, 0.39, 1.75, -0.05, 'x', 0.1, 0.24, 'arch');
    win(mb, -0.39, 1.4, -0.05, '-x', 0.08, 0.2, 'slit');
    flag(mb, 0.24, 2.46, -0.3, 0.8, owner);
    mb.anchors.soldiers.push(new THREE.Vector3(-0.15, 2.46, 0.15));
    mb.anchors.top = 3.3;
  },
  tower_l(mb, owner) {
    // watchtower: a tall battered rubble tower with a timber-framed watch storey overhanging on
    // brackets and a pyramid of tiles, over a stone forebuilding
    plinth(mb, 1.45, 1.45, 0, -0.15, 0.12, 'stoneDark', 0.1);
    mb.add('stone', wallPrism(1.35, 1.35, 2.35, { r: 0.08, batter: 0.08, wobble: 0.008, seed: 4 }), 0, 0.12, -0.15);
    const y = 2.47;
    for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
      const along = -0.45 + k * 0.3;
      mb.add('timber', box(0.06, 0.2, 0.12), along, y - 0.08, -0.15 + s * 0.66, 0, 0, 0);
      mb.add('timber', box(0.12, 0.2, 0.06), s * 0.66, y - 0.08, -0.15 + along, 0, 0, 0);
    }
    mb.add('timber', box(1.55, 0.07, 1.55, 2), 0, y + 0.03, -0.15);
    mb.add('plaster', wallPrism(1.45, 1.45, 0.62, { r: 0.02, batter: 0, wobble: 0.003 }), 0, y + 0.06, -0.15);
    timberFrame(mb, 1.45, 1.45, 0.62, 0, y + 0.06, -0.15);
    for (const f of ['z', 'x', '-z', '-x'] as Face[]) for (const u of [-0.3, 0.3]) {
      const [px, pz] = onFace(f, 0, -0.15, 0.725, 0.725, u);
      win(mb, px, y + 0.38, pz, f, 0.16, 0.2, 'timber');
    }
    mb.add(`roof${owner}`, hipRoof(1.45, 1.45, 0.8, 0.2, { style: 'tile', seed: 9 }), 0, y + 0.68, -0.15);
    flag(mb, 0, y + 1.5, -0.15, 0.6, owner);
    // forebuilding with the door
    house(mb, { w: 0.9, d: 0.5, wallH: 0.62, roofH: 0.3, x: 0, z: 0.7, door: 0, wins: [], chim: null, sideWin: false, rot: false, over: 0.12 });
    win(mb, -0.3, 1.5, 0.52, 'z', 0.1, 0.24, 'arch');
    win(mb, 0.3, 1.8, 0.52, 'z', 0.1, 0.24, 'arch');
    win(mb, 0.66, 1.3, -0.15, 'x', 0.08, 0.2, 'slit');
    mb.anchors.soldiers.push(new THREE.Vector3(0.4, y + 0.1, 0.4), new THREE.Vector3(-0.4, y + 0.1, 0.4));
    mb.anchors.top = 4.8;
  },
  castle(mb, owner) {
    castleDesign(mb, owner, false);
  },
  hq(mb, owner) {
    castleDesign(mb, owner, true);
    // stores in the yard
    for (const [px, pz] of [[0.2, 0.6], [0.45, 0.72], [1.0, 0.65]]) barrel(mb, px, 0.12, pz);
    crate(mb, 0.75, 0.12, 0.35, 0.26, 0.3);
    sack(mb, -0.2, 0.12, 0.8);
    mb.anchors.top = 4.0;
  },
};

type MineKind = 'coal' | 'iron' | 'gold' | 'stone';

function mineDesign(kind: MineKind): Design {
  const ore = kind === 'coal' ? 'coal' : kind === 'iron' ? 'ironore' : kind === 'gold' ? 'goldore' : 'ashlar';
  return (mb) => {
    mound(mb, kind.length * 3);
    // the adit: a timbered portal into the rock
    mb.add('dark', box(0.5, 0.66, 0.5), 0, 0.33, 0.35);
    for (const s of [-1, 1]) mb.add('timber', box(0.09, 0.78, 0.09, 2), s * 0.3, 0.39, 0.6);
    mb.add('timber', box(0.8, 0.1, 0.12, 2), 0, 0.8, 0.6);
    railway(mb, 0.6, ore);
    mb.add('timber', box(0.03, 0.5, 0.03), 0.48, 0.25, 0.75);
    mb.add('glowFire', box(0.07, 0.09, 0.07), 0.48, 0.52, 0.75);
    mb.anchors.fires.push(new THREE.Vector3(0.48, 0.55, 0.8));
    mb.anchors.windows.push(new THREE.Vector3(0.48, 0.55, 0.9));
    if (kind === 'coal') {
      // a timber headframe shed on stilts over the adit, tiled
      for (const [px, pz] of [[-0.4, 0.75], [0.4, 0.75], [-0.4, 0.05], [0.4, 0.05]]) {
        mb.add('timber', box(0.08, 1.1, 0.08, 2), px, 0.55, pz);
        mb.add('timber', box(0.05, 0.4, 0.05, 2), px, 0.3, pz + (pz > 0.4 ? -0.15 : 0.15), 0.6 * (pz > 0.4 ? 1 : -1), 0, 0);
      }
      plankWalls(mb, 0.9, 0.8, 0.5, 0, 1.0, 0.4);
      roof(mb, 'roofX', 0.9, 0.8, 0.45, 0, 1.5, 0.4, { over: 0.16, rot: true, gableMat: 'planks' });
      win(mb, 0, 1.28, 0.8, 'z', 0.14, 0.16, 'timber');
      mb.add('coal', sphere(0.28, 9, 7, Math.PI * 2, Math.PI / 2), -0.85, 0, 0.75);
      mb.anchors.top = 2.2;
    } else if (kind === 'iron') {
      // a tall timber headframe with a winding wheel, a plank lean-to over the adit
      for (const s of [-1, 1]) {
        mb.add('timber', box(0.07, 1.75, 0.07, 2), s * 0.3, 0.87, 0.2, 0, 0, s * 0.08);
        mb.add('timber', box(0.06, 1.2, 0.06, 2), s * 0.3, 0.6, 0.62, 0.5, 0, 0);
      }
      for (const yy of [0.9, 1.4]) mb.add('timber', box(0.64, 0.06, 0.06, 2), 0, yy, 0.2);
      mb.add('wood', new THREE.TorusGeometry(0.22, 0.03, 6, 16), 0, 1.72, 0.2, Math.PI / 2);
      for (let k = 0; k < 4; k++) mb.add('timber', box(0.02, 0.42, 0.02), 0, 1.72, 0.2, Math.PI / 2, 0, (k / 4) * Math.PI);
      mb.add('rope', box(0.012, 1.2, 0.012), 0, 1.1, 0.42);
      shed(mb, 0, 0.62, 0.95, 0.4, 0.62, 0.88, 'shingle', 'z');
      mb.add('ironore', sphere(0.26, 9, 7, Math.PI * 2, Math.PI / 2), 0.85, 0, 0.7);
      mb.anchors.top = 2.2;
    } else if (kind === 'gold') {
      // a small stone house set into the hillside above the adit, reached by a timber stair
      house(mb, { w: 0.95, d: 0.72, wallH: 0.6, roofH: 0.46, x: 0.0, z: -0.42, y: 0.5, door: 0.28, wins: [-0.2], chim: [-0.25, -0.1], sideWin: false });
      // a timber stair from the tub track up to the door, and a landing
      for (let k = 0; k < 4; k++) mb.add('planks', box(0.3, 0.04, 0.14, 3), 0.62, 0.12 + k * 0.13, 0.62 - k * 0.14);
      for (const s of [-1, 1]) mb.add('timber', box(0.04, 0.62, 0.04), 0.62 + s * 0.16, 0.31, 0.3);
      mb.add('planks', box(0.62, 0.05, 0.36, 3), 0.42, 0.58, 0.1);
      for (const [px, pz] of [[0.72, 0.26], [0.72, -0.06]]) mb.add('timber', box(0.05, 0.58, 0.05), px, 0.29, pz);
      mb.add('goldore', sphere(0.2, 9, 7, Math.PI * 2, Math.PI / 2), -0.85, 0, 0.75);
      mb.anchors.top = 2.0;
    } else {
      // a dressed stone portal with a red door, blocks stacked by the quarry face
      mb.add('ashlar', wallPrism(1.0, 0.3, 0.9, { r: 0.04, batter: 0.03, wobble: 0.004 }), 0, 0, 0.55);
      put(mb, archDoor(0.42, 0.72), 0, 0.02, 0.7);
      mb.add('roofX', leanToRoof(1.1, 0.4, 0.9, 1.05, { style: 'tile', seed: 3 }), 0, 0, 0.6);
      stoneBlocks(mb, -0.85, 0, 0.7);
      stoneBlocks(mb, 0.65, 0, 0.3);
      mb.anchors.top = 1.6;
    }
    mb.anchors.piles.push(new THREE.Vector3(-0.7, 0, 1.05));
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

/** Designs are built once for this stand-in owner; each player's copy renames its colours. */
const TOKEN = 9;
const templates = new Map<BuildingType, ModelBuilder>();
const cache = new Map<string, ModelBuilder>();

function template(type: BuildingType): ModelBuilder {
  let t = templates.get(type);
  if (t) return t;
  const d = designs[type] ?? designs.woodcutter!;
  const make = () => {
    const mb = new ModelBuilder();
    d(mb, TOKEN);
    // roofX -> player roof
    const rx = mb.parts.get('roofX');
    if (rx) {
      mb.parts.delete('roofX');
      const arr = mb.parts.get(`roof${TOKEN}`) ?? [];
      arr.push(...rx);
      mb.parts.set(`roof${TOKEN}`, arr);
    }
    for (const m of mb.movers) {
      const r = m.builder.parts.get('roofX');
      if (r) { m.builder.parts.delete('roofX'); m.builder.parts.set(`roof${TOKEN}`, r); }
    }
    return mb;
  };
  t = make();
  setDetail(0);
  try { t.far = make(); } finally { setDetail(1); }
  templates.set(type, t);
  return t;
}

export function buildingBuilder(type: BuildingType, owner: number): ModelBuilder {
  const key = `${type}:${owner}`;
  let mb = cache.get(key);
  if (!mb) {
    const own: Record<string, string> = { [`roof${TOKEN}`]: `roof${owner}`, [`banner${TOKEN}`]: `banner${owner}`, [`trim${TOKEN}`]: `trim${owner}` };
    mb = template(type).rekey((k) => own[k] ?? k);
    cache.set(key, mb);
  }
  return mb;
}
