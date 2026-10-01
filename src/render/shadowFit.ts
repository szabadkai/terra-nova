// The sun's shadow map covers what the view shows rather than a square around the view's centre.
// The ground the view sees (the frustum between the lowest and highest surfaces in it, out to a reach
// around the target) is projected along the light and fitted by a rectangle turned with the view, and
// only that rectangle of the map is drawn. A square centred on the target spent about half of its
// texels behind the camera and beside the view, and on a wide screen still left the far corners
// without shadows; the casters it drew there (trees, mostly) were most of the shadow map's cost.
//
// The texel size follows the zoom alone (as it did: the square's side over the map's), so panning
// keeps it and the rectangle's corner is snapped to whole texels in light space, which keeps the
// shadows' edges still while the view moves. It only grows where the typical footprint would not fit
// in the map, which is a turn of the view and the sun's height, never the ground under the view.
import * as THREE from 'three';
import { WATER_LEVEL, type World } from '../game/world';

/**
 * A directional light's shadow (three's DirectionalLightShadow, which it does not export) drawn into a
 * corner of its map: `fit` is the share of the map in use.
 */
export class FitShadow extends THREE.LightShadow<THREE.OrthographicCamera> {
  readonly isDirectionalLightShadow = true;
  /** the rectangle drawn, as a share of the map (exact: the shadow matrix maps onto it) */
  readonly fit = new THREE.Vector4(0, 0, 1, 1);
  /** the same padded by half a texel, for the viewport (WebGL truncates it to whole texels) */
  private vp = new THREE.Vector4(0, 0, 1, 1);

  constructor() {
    super(new THREE.OrthographicCamera(-5, 5, 5, -5, 0.5, 500));
  }

  getViewport(): THREE.Vector4 {
    return this.vp;
  }

  setFit(w: number, h: number) {
    const W = this.mapSize.x, H = this.mapSize.y;
    this.fit.set(0, 0, w / W, h / H);
    this.vp.set(0, 0, (w + 0.5) / W, (h + 0.5) / H);
  }

  updateMatrices(light: THREE.DirectionalLight) {
    const cam = this.camera;
    cam.position.setFromMatrixPosition(light.matrixWorld);
    tmp.setFromMatrixPosition(light.target.matrixWorld);
    cam.lookAt(tmp);
    cam.updateMatrixWorld();
    // (LightShadow's own, with the viewport's scale: texture lookups land in the rectangle drawn)
    (this as unknown as { _updateMatrix(c: THREE.Camera, m: THREE.Matrix4, f: THREE.Frustum, v: THREE.Vector4): void })._updateMatrix(cam, this.matrix, this.getFrustum(), this.fit);
  }
}

const tmp = new THREE.Vector3();

// three's soft shadow lookup turns its five Vogel-disk taps by a per-pixel angle with a sine and a
// cosine each; the same taps turned by one rotation take one of each (every lit pixel does this). Its
// radius is also measured in texels across the map on both axes: on a wider map that made the
// filter narrower up the map than across it.
{
  const GOLDEN = 2.399963229728653;
  const tap = (i: number) => {
    const r = Math.sqrt((i + 0.5) / 5), a = i * GOLDEN;
    return `vec2( ${(Math.cos(a) * r).toFixed(8)}, ${(Math.sin(a) * r).toFixed(8)} )`;
  };
  const taps = /shadow = \(\s*(texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( \d, 5, phi \) \* radius, shadowCoord\.z \) \)\s*\+?\s*){5}\) \* 0\.2;/;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (taps.test(src))
    THREE.ShaderChunk.shadowmap_pars_fragment = src.replace(taps, `vec2 rad = shadowRadius * texelSize;
				mat2 R = mat2( cos( phi ), sin( phi ), - sin( phi ), cos( phi ) );
				shadow = (${[0, 1, 2, 3, 4].map((i) => `\n					texture( shadowMap, vec3( shadowCoord.xy + ( R * ${tap(i)} ) * rad, shadowCoord.z ) )`).join(' +')}
				) * 0.2;`);
  else console.warn('shadowFit: three\'s shadow lookup has changed, its taps are left as they are');
}

// A pixel that faces away from the sun takes none of its direct light (RE_Direct scales it by the
// clamped N.L of the same normal), so the five taps of the sun's shadow are not looked up there: the
// sunless sides of walls, roofs and slopes. The picture is the same to the bit. (Every lit material
// here is a MeshStandardMaterial without clearcoat or sheen, the only extras that light past N.L.)
{
  const line = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ],';
  const src = THREE.ShaderChunk.lights_fragment_begin;
  if (src.includes(line))
    THREE.ShaderChunk.lights_fragment_begin = src.replace(line, 'directLight.color *= ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.0 ) ? getShadow( directionalShadowMap[ i ],');
  else console.warn('shadowFit: three\'s directional light code has changed, its shadow is looked up on every pixel');
}

/** How far from the target shadows are drawn, in view sizes (the square reached 0.75-1.06). */
const REACH = 1.1;
/** Texels of room around the footprint: the soft filter's radius and the normal offset. */
const PAD = 5;
/** Tallest things that take a shadow above the ground (roofs, crowns). */
const TALL = 8;
/** The shadows' depth bias in world units (it was -0.0004 of a 219-unit range). */
const BIAS = -0.0876;
/** Farthest the shadow camera stands back from the view, towards the light. */
const MAX_BACK = 260;
/** Corners of the polygon round the reach, and points along where the frustum's sides cross it. */
const NC = 96, NS = 256;

const X = new THREE.Vector3();
const Y = new THREE.Vector3();
const Lv = new THREE.Vector3();
const C = new THREE.Vector3();
const frustum = new THREE.Frustum();
const m4 = new THREE.Matrix4();
const nearC = [0, 1, 2, 3].map(() => new THREE.Vector3());
const farC = [0, 1, 2, 3].map(() => new THREE.Vector3());
// (a convex polygon cut by a plane gains one corner at most)
let ax = new Float64Array(NC + 8), az = new Float64Array(NC + 8), bx = new Float64Array(NC + 8), bz = new Float64Array(NC + 8);

/**
 * Light-space bounds of what the view can show between heights lo and hi within `reach` of the
 * target: [x0, x1, y0, y1]. That part of the view (the frustum between two levels, inside an upright
 * cylinder) is convex, so its bounds are where its surfaces meet: its cross-sections at the two
 * levels (a polygon round the reach, so that the circle is inside it, cut by the frustum's planes),
 * the curves along which the frustum's sides cut the cylinder, and the corners of the near plane
 * (close up the eye is below the tallest roofs).
 */
function footprint(target: THREE.Vector3, reach: number, lo: number, hi: number, out: number[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const add = (x: number, y: number, z: number) => {
    const u = x * X.x + y * X.y + z * X.z, v = x * Y.x + y * Y.y + z * Y.z, d = x * Lv.x + y * Lv.y + z * Lv.z;
    if (u < x0) x0 = u;
    if (u > x1) x1 = u;
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
    if (d < z0) z0 = d;
    if (d > z1) z1 = d;
  };
  const rim = reach / Math.cos(Math.PI / NC);
  const inside = (x: number, y: number, z: number, skip: number) => {
    for (let k = 0; k < 6; k++) {
      if (k === skip) continue;
      const pl = frustum.planes[k];
      if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -1e-6) return false;
    }
    return true;
  };
  for (const p of nearC)
    if (p.y >= lo && p.y <= hi && (p.x - target.x) ** 2 + (p.z - target.z) ** 2 <= reach * reach) add(p.x, p.y, p.z);
  for (const h of [lo, hi]) {
    let n = NC;
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * Math.PI * 2;
      ax[i] = target.x + Math.cos(a) * rim;
      az[i] = target.z + Math.sin(a) * rim;
    }
    for (const pl of frustum.planes) {
      const nx = pl.normal.x, nz = pl.normal.z, c = pl.normal.y * h + pl.constant;
      let m = 0;
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const di = nx * ax[i] + nz * az[i] + c, dj = nx * ax[j] + nz * az[j] + c;
        if (di >= 0) { bx[m] = ax[i]; bz[m++] = az[i]; }
        if (di >= 0 !== dj >= 0) {
          const t = di / (di - dj);
          bx[m] = ax[i] + (ax[j] - ax[i]) * t;
          bz[m++] = az[i] + (az[j] - az[i]) * t;
        }
      }
      [ax, bx] = [bx, ax];
      [az, bz] = [bz, az];
      n = m;
      if (!n) break;
    }
    for (let i = 0; i < n; i++) add(ax[i], h, az[i]);
  }
  // each edge of the frustum where it leaves the cylinder (its own corners), between the two levels
  for (let i = 0; i < 4; i++) {
    const o = nearC[i], f = farC[i];
    const dx = f.x - o.x, dy = f.y - o.y, dz = f.z - o.z, ox = o.x - target.x, oz = o.z - target.z;
    const qa = dx * dx + dz * dz, qb = ox * dx + oz * dz, qc = ox * ox + oz * oz - rim * rim;
    const disc = qb * qb - qa * qc;
    if (qa < 1e-12 || disc < 0) continue;
    const t = (-qb + Math.sqrt(disc)) / qa;
    if (t < 0 || t > 1) continue;
    const y = o.y + dy * t;
    if (y >= lo && y <= hi) add(o.x + dx * t, y, o.z + dz * t);
  }
  // each side of the frustum where it crosses the cylinder, between the two levels
  for (let k = 0; k < 4; k++) {
    const pl = frustum.planes[k];
    if (Math.abs(pl.normal.y) < 1e-6) continue;
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * Math.PI * 2;
      const x = target.x + Math.cos(a) * rim, z = target.z + Math.sin(a) * rim;
      const y = -(pl.normal.x * x + pl.normal.z * z + pl.constant) / pl.normal.y;
      if (y >= lo && y <= hi && inside(x, y, z, k)) add(x, y, z);
    }
  }
  out[0] = x0; out[1] = x1; out[2] = y0; out[3] = y1; out[4] = z0; out[5] = z1;
  return x0 <= x1;
}

/** Lowest and highest surface (ground or water) in cells of CELL x CELL nodes, rebuilt every few seconds. */
const CELL = 4;
const relief = { world: null as World | null, lo: new Float32Array(0), hi: new Float32Array(0), cw: 0, ch: 0, age: 0 };
function heightRange(world: World, x0: number, z0: number, x1: number, z1: number): [number, number] {
  const R = relief;
  if (R.world !== world || R.age-- <= 0) {
    // (builders level the ground a little at a time: a few seconds late is soon enough)
    R.world = world;
    R.age = 150;
    R.cw = Math.ceil(world.W / CELL);
    R.ch = Math.ceil(world.H / CELL);
    if (R.lo.length !== R.cw * R.ch) { R.lo = new Float32Array(R.cw * R.ch); R.hi = new Float32Array(R.cw * R.ch); }
    R.lo.fill(Infinity);
    R.hi.fill(-Infinity);
    for (let z = 0; z < world.H; z++)
      for (let x = 0; x < world.W; x++) {
        const c = ((z / CELL) | 0) * R.cw + ((x / CELL) | 0), h = Math.max(WATER_LEVEL, world.h[z * world.W + x]);
        if (h < R.lo[c]) R.lo[c] = h;
        if (h > R.hi[c]) R.hi[c] = h;
      }
  }
  let lo = Infinity, hi = -Infinity;
  const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
  // (beyond the map is the sea)
  if (cx0 < 0 || cz0 < 0 || cx1 >= R.cw || cz1 >= R.ch) lo = WATER_LEVEL;
  for (let cz = Math.max(0, cz0); cz <= Math.min(R.ch - 1, cz1); cz++)
    for (let cx = Math.max(0, cx0); cx <= Math.min(R.cw - 1, cx1); cx++) {
      const c = cz * R.cw + cx;
      if (R.lo[c] < lo) lo = R.lo[c];
      if (R.hi[c] > hi) hi = R.hi[c];
    }
  if (!(hi >= lo)) hi = lo = WATER_LEVEL;
  return [lo, hi];
}

const box = [0, 0, 0, 0, 0, 0];
const std = [0, 0, 0, 0, 0, 0];

/**
 * Place the sun's shadow camera over what `view` shows: its orientation, extents and the part of the
 * map it draws into. `lightDir` points towards the light; `viewSize` is the camera's reach.
 */
export function fitShadow(sun: THREE.DirectionalLight, shadow: FitShadow, view: THREE.PerspectiveCamera, target: THREE.Vector3,
  viewSize: number, lightDir: THREE.Vector3, world: World) {
  const L = Lv.copy(lightDir);
  view.updateMatrixWorld();
  // light space: x along the view's right (flattened), so the footprint's near and far edges lie along it
  X.setFromMatrixColumn(view.matrixWorld, 0);
  X.y = 0;
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0);
  X.normalize().addScaledVector(L, -X.dot(L)).normalize();
  Y.crossVectors(L, X);
  frustum.setFromProjectionMatrix(m4.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse));
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], i) => { nearC[i].set(x, y, -1).unproject(view); farC[i].set(x, y, 1).unproject(view); });
  const reach = Math.max(20, viewSize * REACH);
  const S = shadow.mapSize;
  // texel size: the zoom's (the old square's) unless the usual footprint needs more room; worked out
  // around the target's own height, so moving over hills leaves it alone
  let T = (2 * Math.max(18, viewSize * 0.75)) / S.y;
  if (footprint(target, reach, target.y - 4, target.y + TALL, std))
    T = Math.max(T, (std[1] - std[0]) / (S.x - 2 * PAD), (std[3] - std[2]) / (S.y - 2 * PAD));
  // the heights really in view: the ground within the reach, the water, and what stands on them
  const [lo, hi] = heightRange(world, target.x - reach, target.z - reach, target.x + reach, target.z + reach);
  if (!footprint(target, reach, lo - 0.5, hi + TALL, box)) box.splice(0, 6, ...std);
  // whole texels, anchored in light space; too big for the map, the part around the target is kept
  const snap = (a: number, b: number, n: number, at: number): [number, number] => {
    let s0 = Math.floor(a / T) - PAD, cnt = Math.ceil(b / T) + PAD - s0;
    if (cnt > n) {
      s0 = Math.min(Math.max(Math.round(at / T - n / 2), s0), s0 + cnt - n);
      cnt = n;
    }
    return [s0, cnt];
  };
  const [sx, w] = snap(box[0], box[1], S.x, target.dot(X));
  const [sy, h] = snap(box[2], box[3], S.y, target.dot(Y));
  shadow.setFit(w, h);
  // the camera over the rectangle's middle, at the target's depth; up is light space's y. It stands
  // back far enough for what can shade the nearest of it, the view's highest point seen from its
  // lowest along the light (a low sun throws hills' shadows a long way), and reaches past the farthest
  const zc = target.dot(L);
  const back = Math.min(MAX_BACK, Math.max(90, box[5] - zc + (hi + TALL - lo) / Math.max(L.y, 0.1) + 2));
  C.copy(X).multiplyScalar((sx + w / 2) * T).addScaledVector(Y, (sy + h / 2) * T).addScaledVector(L, zc);
  sun.target.position.copy(C);
  sun.position.copy(C).addScaledVector(L, back);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
  const cam = shadow.camera;
  cam.up.copy(Y);
  cam.left = (-w / 2) * T; cam.right = (w / 2) * T;
  cam.bottom = (-h / 2) * T; cam.top = (h / 2) * T;
  cam.near = 1;
  cam.far = back + Math.max(130, zc - box[4] + 2);
  cam.updateProjectionMatrix();
  // (the bias is a share of the depth range: the same distance in the world whatever the range)
  shadow.bias = BIAS / (cam.far - cam.near);
}
