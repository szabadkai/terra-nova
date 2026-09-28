// Birds over the land. A few flocks wander the map: rooks over the fields and woods, gulls about
// the shores, small finches low over the meadows. Each bird has a body, head, beak and fanned
// tail and two wings, pale or dark beneath as the kind has them, that flap in the vertex shader
// with the tips trailing the shoulders. They glide now and then with the wings held in a shallow
// V, bank into their turns, raise the nose to climb, and the flocks sometimes wheel in circles.
// They go to roost at night. Render-only.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WATER_LEVEL, type World } from '../game/world';
import { patchMaterial, patchedDepthMaterial } from './shaderPatch';
import { uploadFirst } from './instancing';

/** Wing layout, at full size: the shoulder sits SHOULDER out from the middle, the tip SPAN beyond. */
const SHOULDER = 0.02, SPAN = 0.25;

interface Kind {
  name: string;
  /** size, cruising speed, height band above the ground, wingbeats a second, stroke, how often it glides */
  scale: number; speed: number; alt: [number, number]; rate: number; amp: number; glide: number;
  flocks: number; birds: [number, number];
  /** colours: back, belly, wing top, wing underside, wing tip, beak */
  back: number; belly: number; wing: number; under: number; tip: number; beak: number;
  /** wing shape: chord at the shoulder, how far the tip sweeps back, spread primaries at the tip */
  chord: number; sweep: number; fingers: boolean;
}
const KINDS: Kind[] = [
  { name: 'rook', scale: 1, speed: 3.2, alt: [5.5, 8], rate: 3.1, amp: 0.55, glide: 0.3, flocks: 2, birds: [7, 13],
    back: 0x1d1d24, belly: 0x26262c, wing: 0x1a1a21, under: 0x2c2c32, tip: 0x121216, beak: 0x6a6560, chord: 0.1, sweep: 0.02, fingers: true },
  { name: 'gull', scale: 1.25, speed: 2.6, alt: [6, 9], rate: 2.0, amp: 0.45, glide: 0.65, flocks: 2, birds: [3, 6],
    back: 0xf2f2ee, belly: 0xf6f6f2, wing: 0x9ca4ac, under: 0xe8eaea, tip: 0x1c1c20, beak: 0xe0b030, chord: 0.08, sweep: 0.075, fingers: false },
  { name: 'finch', scale: 0.55, speed: 4.2, alt: [2.6, 4], rate: 7, amp: 0.8, glide: 0.12, flocks: 1, birds: [10, 16],
    back: 0x86664a, belly: 0xcdb592, wing: 0x5c4332, under: 0xb8a080, tip: 0x3a2a20, beak: 0x3a302a, chord: 0.095, sweep: 0.03, fingers: false },
];
const MAX = 64;

interface Flock {
  kind: number;
  /** y is its height above the ground, g the ground below it (eased, so hills lift it gently) */
  x: number; y: number; z: number; g: number;
  tx: number; tz: number;
  /** wheeling round (cx, cz) at radius cr, angle ca, until modeT runs out */
  circle: boolean; cx: number; cz: number; cr: number; ca: number; modeT: number;
}
interface Bird {
  flock: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  /** where it keeps in the flock, and its own wobble */
  ox: number; oy: number; oz: number; seed: number;
  heading: number; bank: number; pitch: number;
  ph: number; glide: number; gliding: boolean; glideT: number;
}

const lin = (hex: number) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b] as const; };
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A flat strip across the span from shoulder to tip: leading and trailing edge z as functions of s (0..1). */
function strip(side: number, y: number, lead: (s: number) => number, trail: (s: number) => number, up: boolean, n = 24) {
  const pos: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, x = side * (SHOULDER + s * SPAN);
    pos.push(x, y, lead(s), x, y, trail(s));
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // wind it to face up (or down)
  if ((g.getAttribute('normal').getY(0) > 0) !== up) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

function paint(g: THREE.BufferGeometry, wing: number, fn: (x: number, y: number, z: number) => readonly number[]) {
  const out = g.index ? g.toNonIndexed() : g;
  if (out.getAttribute('uv')) out.deleteAttribute('uv');
  const p = out.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i));
    col.set([c[0], c[1], c[2]], i * 3);
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aWing', new THREE.BufferAttribute(new Float32Array(p.count).fill(wing), 1));
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

/** One kind of bird facing +z, the wings spread flat along x. */
function birdGeo(k: Kind) {
  const back = lin(k.back), belly = lin(k.belly), wing = lin(k.wing), under = lin(k.under), tip = lin(k.tip), beak = lin(k.beak);
  const mix = (a: readonly number[], b: readonly number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const parts: THREE.BufferGeometry[] = [];
  // a spindle of a body with a round head and a short pointed beak
  const prof = [[0, -0.1], [0.018, -0.086], [0.026, -0.05], [0.029, 0], [0.026, 0.045], [0.02, 0.075], [0, 0.088]].map(([r, a]) => new THREE.Vector2(r, a));
  const body = new THREE.LatheGeometry(prof, 10);
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.85, 1);
  parts.push(paint(body, 0, (_x, y) => mix(back, belly, y < 0 ? Math.min(1, -y / 0.02) : 0)));
  const head = new THREE.SphereGeometry(0.021, 10, 8);
  head.translate(0, 0.008, 0.094);
  parts.push(paint(head, 0, () => back));
  const bill = new THREE.ConeGeometry(0.0075, 0.034, 6);
  bill.rotateX(Math.PI / 2);
  bill.translate(0, 0.004, 0.126);
  parts.push(paint(bill, 0, () => beak));
  for (const [e, c] of [[-1, 0.0045], [1, 0.0045]] as const) {
    const eye = new THREE.SphereGeometry(c, 5, 4);
    eye.translate(e * 0.017, 0.013, 0.104);
    parts.push(paint(eye, 0, () => [0.02, 0.02, 0.02]));
  }
  // a fanned tail, dark above and pale below
  const tailLead = (s: number) => -0.085 - s * 0, tailTrail = () => -0.165;
  for (const up of [true, false]) {
    const t = new THREE.BufferGeometry();
    const y = up ? 0.004 : 0.001;
    t.setAttribute('position', new THREE.Float32BufferAttribute([-0.012, y, tailLead(0), 0.012, y, tailLead(0), 0.036, y, tailTrail(), -0.036, y, tailTrail()], 3));
    t.setIndex(up ? [0, 2, 3, 0, 1, 2] : [0, 3, 2, 0, 2, 1]);
    t.computeVertexNormals();
    parts.push(paint(t, 0, () => (up ? back : mix(back, belly, 0.5))));
  }
  // wings: broad at the shoulder, swept back to a rounded or pointed tip, the primaries darker;
  // a rook's spread out like fingers
  const lead = (s: number) => 0.035 - s * s * k.sweep;
  const trail = (s: number) => {
    let c = k.fingers ? k.chord * (1 - 0.2 * s) : k.chord * (1 - 0.55 * s);
    c *= Math.sqrt(Math.max(0, 1 - Math.pow(s, k.fingers ? 8 : 4)));
    if (k.fingers && s > 0.68) c *= 0.55 + 0.45 * Math.abs(Math.sin((s - 0.68) * Math.PI * 7));
    return lead(s) - Math.max(0.002, c);
  };
  for (const side of [-1, 1]) {
    parts.push(paint(strip(side, 0.012, lead, trail, true), 1, (x) => mix(wing, tip, Math.max(0, (Math.abs(x) - SHOULDER) / SPAN - 0.72) / 0.28)));
    parts.push(paint(strip(side, 0.009, lead, trail, false), 1, (x) => mix(under, tip, Math.max(0, (Math.abs(x) - SHOULDER) / SPAN - 0.8) / 0.2 * 0.8)));
  }
  return mergeGeometries(parts, false)!;
}

// The wing bends about its shoulder by aFlap.x, the outer wing further by aFlap.y towards the tip.
const FLAP_HEAD = /* glsl */ `
attribute vec2 aFlap;
attribute float aWing;
float flapAngle(float r) {
  float s = clamp(r / ${SPAN.toFixed(3)}, 0.0, 1.0);
  return aFlap.x + aFlap.y * s * s;
}
`;
const FLAP_BEGIN = /* glsl */ `
  if (aWing > 0.5) {
    float side = sign(transformed.x);
    float r = abs(transformed.x) - ${SHOULDER.toFixed(3)};
    float ang = flapAngle(r);
    transformed = vec3(side * (${SHOULDER.toFixed(3)} + cos(ang) * r), transformed.y + sin(ang) * r, transformed.z);
  }
`;
const FLAP_NORMAL = /* glsl */ `
  if (aWing > 0.5) {
    float side = sign(position.x);
    // the surface's own slope: the shoulder angle plus three times the bend (the arc steepens outwards)
    float s = clamp((abs(position.x) - ${SHOULDER.toFixed(3)}) / ${SPAN.toFixed(3)}, 0.0, 1.0);
    float ang = aFlap.x + 3.0 * aFlap.y * s * s;
    float c = cos(ang), sn = sin(ang);
    objectNormal = vec3(objectNormal.x * c - side * objectNormal.y * sn, side * objectNormal.x * sn + objectNormal.y * c, objectNormal.z);
  }
`;

export class Birds {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private flaps: THREE.InstancedBufferAttribute[] = [];
  private flocks: Flock[] = [];
  private birds: Bird[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private world: World) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    patchMaterial(mat, { key: 'birds', fog: true, vertexHead: FLAP_HEAD, vertexBegin: FLAP_BEGIN });
    const patched = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      patched.call(mat, sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${FLAP_NORMAL}`);
    };
    const depth = patchedDepthMaterial({ key: 'birds', vertexHead: FLAP_HEAD, vertexBegin: FLAP_BEGIN });
    KINDS.forEach((k, ki) => {
      const geo = birdGeo(k);
      const flap = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
      flap.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFlap', flap);
      const mesh = new THREE.InstancedMesh(geo, mat, MAX);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.customDepthMaterial = depth;
      this.meshes.push(mesh);
      this.flaps.push(flap);
      this.group.add(mesh);
      for (let f = 0; f < k.flocks; f++) {
        const [x, z] = this.spot(ki);
        const fl: Flock = { kind: ki, x, z, y: rand(k.alt[0], k.alt[1]), g: this.ground(x, z), tx: x, tz: z, circle: false, cx: x, cz: z, cr: 5, ca: 0, modeT: 0 };
        [fl.tx, fl.tz] = this.spot(ki);
        this.flocks.push(fl);
        const n = Math.floor(rand(k.birds[0], k.birds[1] + 1));
        for (let i = 0; i < n; i++) {
          const ox = rand(-2.2, 2.2) * k.scale, oz = rand(-2.2, 2.2) * k.scale;
          this.birds.push({
            flock: this.flocks.length - 1, x: x + ox, y: fl.g + fl.y, z: z + oz, vx: 0, vy: 0, vz: 0, ox, oy: rand(-0.8, 0.8), oz, seed: Math.random() * 100,
            heading: 0, bank: 0, pitch: 0, ph: Math.random() * 6, glide: 0, gliding: false, glideT: rand(0, 3),
          });
        }
      }
    });
  }

  /** The land (or the sea) below a point, the highest nearby so a flock clears the hilltops. */
  private ground(x: number, z: number) {
    const w = this.world;
    let g = WATER_LEVEL;
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const ix = Math.max(0, Math.min(w.W - 1, Math.floor(x + dx))), iz = Math.max(0, Math.min(w.H - 1, Math.floor(z + dz)));
      g = Math.max(g, w.h[w.idx(ix, iz)]);
    }
    return g;
  }

  /** Somewhere for a flock of this kind to make for: gulls keep near the water's edge. */
  private spot(kind: number): [number, number] {
    const w = this.world;
    for (let k = 0; k < 30; k++) {
      const x = rand(4, w.W - 4), z = rand(4, w.H - 4);
      if (KINDS[kind].name !== 'gull') return [x, z];
      const h = w.h[w.idx(Math.floor(x), Math.floor(z))];
      if (h < WATER_LEVEL + 0.6 && h > WATER_LEVEL - 3) return [x, z];
    }
    return [rand(4, w.W - 4), rand(4, w.H - 4)];
  }

  update(dt: number, night: number) {
    dt = Math.min(dt, 0.1);
    const hide = night > 0.6;
    for (const f of this.flocks) {
      const k = KINDS[f.kind];
      f.modeT -= dt;
      if (f.circle) {
        // wheel round the spot
        f.ca += (k.speed * 0.8 / f.cr) * dt;
        f.x = f.cx + Math.cos(f.ca) * f.cr;
        f.z = f.cz + Math.sin(f.ca) * f.cr;
        if (f.modeT <= 0) { f.circle = false; [f.tx, f.tz] = this.spot(f.kind); }
      } else {
        const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz);
        if (d < 4) {
          if (k.name !== 'finch' && Math.random() < 0.45) {
            f.circle = true; f.cr = rand(4, 8); f.cx = f.x - f.cr; f.cz = f.z; f.ca = 0; f.modeT = rand(12, 26);
          } else [f.tx, f.tz] = this.spot(f.kind);
        } else {
          f.x += (dx / d) * k.speed * dt;
          f.z += (dz / d) * k.speed * dt;
        }
      }
      // drift up and down within the kind's band, rising over the hills
      f.y += Math.sin(performance.now() * 0.00013 + f.kind * 2 + f.cx) * dt * 0.25;
      f.y = Math.max(k.alt[0], Math.min(k.alt[1], f.y));
      const g = this.ground(f.x, f.z);
      f.g += (g - f.g) * Math.min(1, dt * (g > f.g ? 1.2 : 0.4));
    }
    const t = performance.now() * 0.001;
    const counts = this.meshes.map(() => 0);
    for (const b of this.birds) {
      const f = this.flocks[b.flock];
      const k = KINDS[f.kind];
      // keep station in the flock, each with a slow wobble of its own
      const wx = f.x + b.ox + Math.sin(t * 0.31 + b.seed) * 1.6 * k.scale;
      const wy = f.g + f.y + b.oy + Math.sin(t * 0.47 + b.seed * 1.3) * 0.5;
      const wz = f.z + b.oz + Math.cos(t * 0.27 + b.seed * 0.7) * 1.6 * k.scale;
      b.vx += ((wx - b.x) * 1.4 - b.vx) * dt * 1.6;
      b.vy += ((wy - b.y) * 1.2 - b.vy) * dt * 1.6;
      b.vz += ((wz - b.z) * 1.4 - b.vz) * dt * 1.6;
      // never slower than a bird can fly: carry on along the heading
      const vh = Math.hypot(b.vx, b.vz), min = k.speed * 0.7;
      if (vh < min) { b.vx += Math.sin(b.heading) * (min - vh); b.vz += Math.cos(b.heading) * (min - vh); }
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      // and never into the ground
      const floor = this.ground(b.x, b.z) + 1.2 * k.scale;
      if (b.y < floor) { b.y = floor; b.vy = Math.max(b.vy, 0.5); }
      const h = Math.atan2(b.vx, b.vz);
      const turn = wrap(h - b.heading);
      b.heading = wrap(b.heading + turn * Math.min(1, dt * 5));
      // lean into the turn, nose up to climb
      const bankTo = Math.max(-0.75, Math.min(0.75, -turn / Math.max(dt, 1e-3) * 0.08));
      b.bank += (bankTo - b.bank) * Math.min(1, dt * 3);
      const pitchTo = -Math.atan2(b.vy, Math.max(0.5, Math.hypot(b.vx, b.vz))) * 0.9;
      b.pitch += (pitchTo - b.pitch) * Math.min(1, dt * 3);
      // flap or glide: climbing always takes work
      b.glideT -= dt;
      if (b.glideT <= 0) { b.gliding = Math.random() < k.glide; b.glideT = b.gliding ? rand(1.5, 4) : rand(1, 3); }
      const glide = b.gliding && b.vy < 0.4 ? 1 : 0;
      b.glide += (glide - b.glide) * Math.min(1, dt * 2.5);
      b.ph += dt * Math.PI * 2 * k.rate * (1 - b.glide * 0.95);
      if (hide) continue;
      const mi = f.kind, n = counts[mi]++;
      const amp = k.amp * (1 - b.glide);
      const bob = -Math.cos(b.ph) * 0.012 * amp * k.scale;
      this.q.setFromEuler(this.e.set(b.pitch, b.heading, b.bank, 'YXZ'));
      this.m.compose(this.p.set(b.x, b.y + bob, b.z), this.q, this.s.setScalar(k.scale));
      this.meshes[mi].setMatrixAt(n, this.m);
      // the shoulders swing through the stroke, the tips follow a moment later; gliding, the wings
      // rest in a shallow V
      const dihedral = 0.12 * b.glide + 0.05;
      this.flaps[mi].setXY(n, Math.sin(b.ph) * amp + dihedral, Math.sin(b.ph - 1.1) * amp * 0.7 - 0.06 * b.glide);
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      uploadFirst(m.instanceMatrix, counts[i]);
      uploadFirst(this.flaps[i], counts[i]);
    });
  }
}
