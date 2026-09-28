// Idle pastimes: what a settler with nothing to do gets up to while it stands about.
// It fiddles or pipes a tune (little notes float up) and the others dance a jig, twirl or clap
// along to the beat; it hops for joy, does star jumps, stretches, kicks a ball about, juggles,
// throws a ball to a neighbour, turns back flips and cartwheels, stands on its hands, waves at
// the camera, sits down or naps (Zzz). In the rain it dances, jumps in puddles and turns its
// face up to catch the drops; on snow it makes snow angels, pelts a neighbour with snowballs and
// shivers; at night it serenades, stargazes and dozes; soldiers drill, do push-ups and star jumps.
// Render-only: which pastime comes from a hash of the settler and the moment it stood still, and
// how long it lasts from the time left before it wanders off, so the simulation never notices.
import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Settler } from '../game/types';
import { clamp, hash2, smoothstep as sm } from '../core/rng';
import type { Particles } from './particles';
import { G } from './shaderPatch';
import { RIG, buildPropGeos } from './settlerModels';
import { uploadFirst } from './instancing';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ pose
/** Joint angles for one settler. Angles in radians; bob in world units, shiftX and pivot in settler units. */
export interface Pose {
  legL: number; legR: number; legSpL: number; legSpR: number;
  armL: number; armR: number; splayL: number; splayR: number; reachL: number; reachR: number;
  lean: number; roll: number; twist: number; bob: number; squash: number;
  lie: number; prone: number; spin: number; flip: number; wheel: number; pivot: number; shiftX: number;
  nod: number; yaw: number; tilt: number; eyes: number;
  toolRot: number;
}

const KEYS: (keyof Pose)[] = [
  'legL', 'legR', 'legSpL', 'legSpR', 'armL', 'armR', 'splayL', 'splayR', 'reachL', 'reachR',
  'lean', 'roll', 'twist', 'bob', 'squash', 'lie', 'prone', 'spin', 'flip', 'wheel', 'pivot', 'shiftX',
  'nod', 'yaw', 'tilt', 'eyes', 'toolRot',
];
const TURNS = new Set<keyof Pose>(['spin', 'flip', 'wheel']);

export function resetPose(p: Pose): Pose {
  p.legL = p.legR = p.legSpL = p.legSpR = 0;
  p.armL = p.armR = 0;
  p.splayL = p.splayR = 0.2;
  p.reachL = p.reachR = 1;
  p.lean = p.roll = p.twist = p.bob = p.squash = p.lie = p.prone = 0;
  p.spin = p.flip = p.wheel = p.shiftX = 0;
  p.pivot = 0.3;
  p.nod = p.yaw = p.tilt = 0;
  p.eyes = 1;
  p.toolRot = 0;
  return p;
}

/** Whole turns count for nothing, so blending a spin or a flip in or out takes the short way round. */
const wrap = (a: number) => a - Math.round(a / TAU) * TAU;

function blendPose(p: Pose, a: Pose, e: number) {
  for (const k of KEYS) {
    const v = TURNS.has(k) ? wrap(a[k]) : a[k];
    p[k] += (v - p[k]) * e;
  }
}

const ARM = -RIG.handY;

/** Point an arm at a spot in body space (settler units), stretching it a little when it falls short. */
function reach(p: Pose, side: -1 | 1, x: number, y: number, z: number) {
  const dx = x - side * RIG.shoulderX, dy = y - RIG.shoulderY;
  const d = Math.hypot(dx, dy, z) || 1e-6;
  const g = Math.asin(clamp(dx / d, -1, 1));
  const cg = Math.max(1e-4, Math.cos(g));
  const a = Math.atan2(-z / d / cg, -dy / d / cg);
  const k = clamp(d / ARM, 0.8, 1.4);
  if (side < 0) { p.armL = a; p.splayL = -g; p.reachL = k; } else { p.armR = a; p.splayR = g; p.reachR = k; }
}

/** Piecewise smooth keyframes: v[i] at t[i], eased in between, held outside. */
function kf(x: number, t: readonly number[], v: readonly number[]) {
  if (x <= t[0]) return v[0];
  for (let i = 1; i < t.length; i++) if (x < t[i]) return v[i - 1] + (v[i] - v[i - 1]) * sm(t[i - 1], t[i], x);
  return v[v.length - 1];
}

/** 1 inside [a, b], easing over r at both ends. */
const win = (x: number, a: number, b: number, r: number) => sm(a - r, a, x) * (1 - sm(b, b + r, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A spin that winds up, turns at about `rate` and slows to a stop after whole turns when the act ends. */
function spinTo(u: number, dur: number, rate: number) {
  const x = clamp(u / Math.max(0.1, dur), 0, 1);
  const turns = Math.max(1, Math.round((rate * dur * 0.5) / TAU));
  return turns * TAU * (x - Math.sin(TAU * x) / TAU);
}

// ------------------------------------------------------------------ props in body space
// The fiddle rests on the left collarbone under the chin (the settler's left is +x), its neck
// out to the front-left, and the bow crosses the strings from the right hand.
const VS = 1.4, BS = 1.25; // fiddle and bow drawn a size up, like the heads
const V_N = new THREE.Vector3(0.72, 0.1, 1).normalize();
const V_T = (() => {
  const t = new THREE.Vector3(-0.35, 1, 0);
  return t.addScaledVector(V_N, -t.dot(V_N)).normalize();
})();
const V_X = new THREE.Vector3().crossVectors(V_N, V_T);
const V_B = V_X.clone().multiplyScalar(V_X.x < 0 ? -1 : 1); // frog to tip: over to the left and back
const V_O = new THREE.Vector3(0.05, 0.42, 0.05).addScaledVector(V_N, 0.066 * VS);
const VIOLIN_M = new THREE.Matrix4().makeBasis(V_X, V_N, V_T).scale(new THREE.Vector3(VS, VS, VS)).setPosition(V_O);
const V_HAND = V_O.clone().addScaledVector(V_N, 0.09 * VS).addScaledVector(V_T, -0.02 * VS);
const V_STR = V_O.clone().addScaledVector(V_N, -0.004 * VS).addScaledVector(V_T, 0.021 * VS);
const BOW_Z = V_T.clone().negate();
const BOW_X = new THREE.Vector3().crossVectors(V_B, BOW_Z);
// the fife is blown just under the lip and held out to the right
const F_D = new THREE.Vector3(-1, -0.16, 0.28).normalize();
const F_Y = (() => {
  const y = new THREE.Vector3(0, 1, 0);
  return y.addScaledVector(F_D, -y.dot(F_D)).normalize();
})();
const F_M = new THREE.Vector3(0.006, 0.504, 0.128);
const FLUTE_M = new THREE.Matrix4().makeBasis(F_D, F_Y, new THREE.Vector3().crossVectors(F_D, F_Y)).setPosition(F_M);
const F_H1 = F_M.clone().addScaledVector(F_D, 0.08).addScaledVector(F_Y, -0.014);
const F_H2 = F_M.clone().addScaledVector(F_D, 0.17).addScaledVector(F_Y, -0.014);

// ------------------------------------------------------------------ pastimes
type Act =
  | 'violin' | 'flute' | 'jig' | 'twirl' | 'clap' | 'hop' | 'jacks' | 'stretch' | 'kick' | 'juggle' | 'toss'
  | 'flip' | 'cartwheel' | 'headstand' | 'wave' | 'sit' | 'nap' | 'stargaze'
  | 'rainDance' | 'puddle' | 'catchRain' | 'snowAngel' | 'snowball' | 'shiver' | 'pushups' | 'drill';

interface St {
  seen: number; // frame last drawn
  since: number; // game time it came to stand free, -1 while busy
  act: Act | null;
  t0: number; end: number; next: number;
  leave: number; // game time it was called away mid-act (blending out), -1
  partner: number; lead: boolean;
  face: number; // heading to turn to during the act, NaN for none
  head: number; // heading drawn last frame
  x: number; y: number; z: number;
  v: number; // variant
  sync: boolean; // dances to the band's beat
  picks: number;
  fxT: number;
  tau: number; // last phase, to catch the moment a ball lands or a foot splashes
  k: number; // act scratch (bow stroke)
  hold: boolean; // has the ball (toss, snowball)
  hy: number; hz: number; // where its hands hold the ball, settler space
  ball: boolean; bx: number; by: number; bz: number;
  jb: Float32Array;
}

interface Ctx { rain: number; snow: number; night: number; music: boolean; soldier: boolean; cam: boolean }

interface ActDef {
  min: number; max: number;
  w: (c: Ctx) => number;
  pose: (A: Pose, u: number, left: number, st: St, d: IdleDirector) => void;
  /** a game for two; the solo act to fall back on when nobody is free to play */
  pair?: Act;
  /** keeps the tool in hand */
  tool?: boolean;
}

const dry = (c: Ctx) => (c.rain > 0.3 ? 0.3 : 1);
const warm = (c: Ctx) => (c.snow > 0.35 ? 0.5 : 1);
const people = (c: Ctx, w: number) => (c.soldier ? 0 : w);

const ACTS: Record<Act, ActDef> = {
  violin: {
    min: 3, max: 14, w: (c) => people(c, 2 * (c.music ? 0.35 : 1) * dry(c)),
    pose: (A, u, _l, st) => {
      const t = u * (0.9 + st.v * 0.3);
      st.k = 0.15 + 0.1 * Math.sin(t * 3.3 + Math.sin(t * 1.3) * 0.9); // long strokes, now quick, now slow
      const sw = Math.sin(t * 1.7);
      A.roll = sw * 0.06;
      A.twist = 0.1 + sw * 0.06;
      A.lean = 0.04 + Math.sin(t * 0.9) * 0.03;
      A.tilt = -0.24; A.yaw = 0.14; A.nod = 0.14 + Math.sin(t * 3.3) * 0.02;
      A.eyes = t % 6 > 3.8 ? 0.12 : 1;
      A.legL = -Math.max(0, Math.sin(t * 6.8)) * 0.16; // tapping a foot
      reach(A, 1, V_HAND.x, V_HAND.y, V_HAND.z);
      const f = bowFrog(st.k);
      reach(A, -1, f.x + V_B.x * 0.012 - V_T.x * 0.014, f.y + V_B.y * 0.012 - V_T.y * 0.014, f.z + V_B.z * 0.012 - V_T.z * 0.014);
    },
  },
  flute: {
    min: 3, max: 14, w: (c) => people(c, 1.8 * (c.music ? 0.35 : 1) * dry(c)),
    pose: (A, u, _l, st) => {
      const t = u * (0.85 + st.v * 0.3);
      const sw = Math.sin(t * 1.9);
      A.roll = sw * 0.05; A.twist = -0.1 + Math.sin(t * 0.8) * 0.05;
      A.lean = 0.03 + Math.sin(t * 1.2) * 0.02;
      A.tilt = 0.14; A.yaw = -0.08; A.nod = 0.04 + Math.sin(t * 3.8) * 0.012;
      A.eyes = t % 5 > 3.2 ? 0.12 : 1;
      A.bob = Math.abs(Math.sin(t * 3.8)) * 0.006;
      A.legR = -Math.max(0, Math.sin(t * 7.6)) * 0.14;
      const fl = Math.sin(t * 11) * 0.004; // fingers at work
      reach(A, 1, F_H1.x, F_H1.y + fl, F_H1.z);
      reach(A, -1, F_H2.x, F_H2.y - fl, F_H2.z);
    },
  },
  jig: {
    min: 2.5, max: 10, w: (c) => people(c, (1.1 + (c.music ? 3.5 : 0)) * warm(c)),
    pose: (A, u, _l, st, d) => {
      const t = (st.sync ? d.now : u + st.v * 7) / 0.42;
      const k = Math.floor(t), f = t - k, side = k & 1 ? 1 : -1;
      const up = Math.sin(f * Math.PI);
      A.bob = up * 0.06;
      A.squash = f < 0.14 ? (0.14 - f) * 0.45 : 0;
      const kick = -0.8 * up;
      if (side < 0) { A.legL = kick; A.legR = 0.14; } else { A.legR = kick; A.legL = 0.14; }
      if (st.v < 0.5) {
        // hands on hips
        A.armL = A.armR = 0.5; A.splayL = A.splayR = 0.85;
      } else {
        A.armL = -2.55 + side * 0.3; A.armR = -2.55 - side * 0.3;
        A.splayL = A.splayR = 0.45;
      }
      A.roll = side * 0.1 * up; A.twist = side * 0.24;
      A.nod = -0.14 + up * 0.05; A.tilt = -side * 0.12;
    },
  },
  twirl: {
    min: 2.5, max: 8, w: (c) => people(c, (0.9 + (c.music ? 2.2 : 0)) * warm(c)),
    pose: (A, u, left, st) => {
      A.spin = (st.v < 0.5 ? 1 : -1) * spinTo(u, u + left, 5 * (0.8 + 0.4 * st.v));
      A.armL = A.armR = -0.25;
      A.splayL = A.splayR = 1.35 + Math.sin(u * 5) * 0.08;
      A.nod = -0.25; A.tilt = 0.1; A.roll = 0.06;
      A.eyes = u % 3 > 1.5 ? 0.12 : 1;
      A.bob = Math.abs(Math.sin(u * 5.2)) * 0.035;
      A.legL = Math.sin(u * 10.4) * 0.16; A.legR = -A.legL;
    },
  },
  clap: {
    min: 2.5, max: 10, w: (c) => people(c, 0.6 + (c.music ? 2.6 : 0)),
    pose: (A, u, _l, st, d) => {
      const t = (st.sync ? d.now : u + st.v * 5) / 0.42;
      const f = t - Math.floor(t);
      const open = Math.sin(f * Math.PI);
      // clapping in front of the chest, bobbing at the knees and swaying from side to side
      A.armL = A.armR = -1.25 - 0.15 * open;
      A.splayL = A.splayR = -0.62 + 0.72 * open;
      const s2 = Math.sin(t * Math.PI * 0.5);
      A.roll = s2 * 0.1; A.tilt = s2 * 0.14; A.nod = -0.18;
      A.bob = -(1 - open) * 0.02;
      A.squash = (1 - open) * 0.03;
      A.legL = -Math.max(0, s2) * 0.25; A.legR = -Math.max(0, -s2) * 0.25;
    },
  },
  hop: {
    min: 1.6, max: 3.5, w: () => 0.9,
    pose: (A, u) => {
      const f = (u / 0.55) % 1, air = Math.sin(f * Math.PI);
      A.bob = air * 0.16;
      A.squash = f < 0.15 ? (0.15 - f) * 0.6 : 0;
      A.armL = A.armR = -2.8 + Math.sin(u * 14) * 0.15;
      A.splayL = A.splayR = 0.5;
      A.legL = A.legR = -0.35 * air;
      A.nod = -0.22;
      A.eyes = air > 0.7 ? 0.12 : 1;
    },
  },
  jacks: {
    min: 2.5, max: 6, w: (c) => (c.soldier ? 1.6 : 0.6),
    pose: (A, u) => {
      const f = (u / 0.8) % 1;
      const open = 0.5 - 0.5 * Math.cos(TAU * f);
      A.splayL = A.splayR = 0.12 + 2.6 * open;
      A.armL = A.armR = -0.15 * open;
      A.legSpL = A.legSpR = 0.32 * open;
      A.bob = Math.abs(Math.sin(TAU * f)) * 0.045;
      A.nod = -0.05;
    },
  },
  stretch: {
    min: 3.5, max: 5.2, w: (c) => (c.soldier ? 1.4 : 0.9) * (1 + c.night * 0.6),
    pose: (A, u) => {
      const t = u % 4.8;
      const up = win(t, 0.4, 2.9, 0.4);
      const bend = win(t, 3.4, 4.2, 0.35);
      const side = win(t, 1.5, 2.7, 0.3) * Math.sin(((t - 1.5) / 1.2) * TAU);
      A.armL = A.armR = -2.95 * up - 1.3 * bend;
      A.splayL = A.splayR = 0.12;
      A.lean = 1.05 * bend - 0.12 * up;
      A.roll = 0.32 * side;
      A.bob = 0.025 * up * (1 - Math.abs(side));
      A.squash = -0.03 * up;
      A.nod = -0.35 * up + 0.3 * bend;
      A.eyes = up > 0.5 && Math.abs(side) < 0.3 ? 0.12 : 1;
    },
  },
  kick: {
    min: 3, max: 12, w: (c) => people(c, 1.2 * dry(c) * warm(c) * (1 - c.night * 0.7)),
    pose: (A, u, _l, st) => {
      const t = u / 0.72, k = Math.floor(t), f = t - k, side = k & 1 ? 1 : -1;
      const x0 = side * 0.052;
      st.ball = true;
      st.bx = x0 - 2 * x0 * f; st.by = 0.09 + 0.46 * 4 * f * (1 - f); st.bz = 0.16;
      const out = Math.max(0, 1 - f / 0.3), meet = sm(0.72, 1, f);
      if (side < 0) { A.legL = -0.85 * out; A.legR = -0.85 * meet; } else { A.legR = -0.85 * out; A.legL = -0.85 * meet; }
      A.armL = A.armR = -0.35;
      A.splayL = 0.6 + Math.sin(u * 3) * 0.1; A.splayR = 0.6 - Math.sin(u * 3) * 0.1;
      A.nod = 0.45 - 0.55 * ((st.by - 0.09) / 0.46);
      A.lean = 0.08; A.roll = side * 0.05;
    },
  },
  juggle: {
    min: 3, max: 12, w: (c) => people(c, 1 * dry(c) * (1 - c.night * 0.5)),
    pose: (A, u, _l, st) => {
      const P = 1.35;
      st.ball = true;
      for (let i = 0; i < 3; i++) {
        const ph = (u / P + i / 3) % 1;
        const hi = ph < 0.5, g = (hi ? ph : ph - 0.5) / 0.5;
        const fl = sm(0, 1, clamp((g - 0.18) / 0.82, 0, 1));
        const xa = hi ? -0.072 : 0.072;
        const scoop = g < 0.18 ? Math.sin((g / 0.18) * Math.PI) * 0.03 : 0;
        st.jb[i * 3] = lerp(xa, -xa, fl) + (g < 0.18 ? (hi ? 0.02 : -0.02) * (g / 0.18) : 0);
        st.jb[i * 3 + 1] = 0.31 - scoop + (hi ? 0.34 : 0.15) * 4 * fl * (1 - fl);
        st.jb[i * 3 + 2] = 0.22;
      }
      const ph = (u / P) * 3;
      reach(A, -1, -0.075, 0.3 + Math.sin(ph * Math.PI) * 0.025, 0.2);
      reach(A, 1, 0.075, 0.3 - Math.sin(ph * Math.PI) * 0.025, 0.2);
      A.nod = -0.18 + Math.sin(ph * TAU) * 0.03;
      A.bob = Math.abs(Math.sin(ph * Math.PI)) * 0.006;
    },
  },
  toss: {
    min: 4, max: 14, pair: 'kick', w: (c) => people(c, 1.6 * dry(c) * (c.snow > 0.35 ? 0 : 1) * (1 - c.night * 0.7)),
    pose: (A, u, _l, st) => {
      const tau = (u + (st.lead ? 0 : TOSS_P / 2)) % TOSS_P;
      const a = kf(tau, [0, 0.4, 1.9, 2.3, 2.45, 2.8, 3.0], [-1.9, -0.5, -0.5, -1.3, -1.3, -0.35, -1.9]);
      A.armL = A.armR = a;
      A.splayL = A.splayR = 0.06;
      A.lean = win(tau, 2.4, 2.9, 0.1) * 0.12;
      A.squash = win(tau, 2.7, 2.85, 0.08) * 0.04;
      A.nod = tau < 1.9 ? 0.04 : 0.1;
      st.hold = tau >= 2.4;
      st.hy = RIG.shoulderY - ARM * Math.cos(a) + 0.01;
      st.hz = -ARM * Math.sin(a) + 0.035;
    },
  },
  flip: {
    min: 2.2, max: 8, w: (c) => (c.soldier ? 0.3 : 0.7) * dry(c) * warm(c) * (1 - c.night * 0.7),
    pose: (A, u, left) => {
      const C = 2.7, t = u % C;
      const go = left + t > 2.0; // only jump if there is time to land
      const crouch = go ? win(t, 0.12, 0.3, 0.12) : 0, land = go ? win(t, 1.1, 1.25, 0.1) : 0;
      const f = clamp((t - 0.35) / 0.7, 0, 1), air = go && t > 0.35 && t < 1.05;
      A.pivot = RIG.hipY + 0.12;
      A.bob = (air ? 0.55 * 4 * f * (1 - f) : 0) - 0.06 * (crouch + land);
      A.squash = 0.12 * (crouch + land);
      A.flip = air ? -TAU * (f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f)) : 0;
      const tuck = air ? Math.sin(f * Math.PI) : 0;
      const tada = go ? win(t, 1.4, 2.35, 0.2) : 0;
      A.legL = A.legR = -1.35 * tuck;
      A.armL = A.armR = 0.7 * crouch - 1.4 * tuck - 2.6 * tada;
      A.splayL = A.splayR = 0.2 + 0.55 * tada;
      A.nod = -0.2 * tada + 0.3 * tuck;
      A.eyes = tuck > 0.3 ? 0.12 : 1;
    },
  },
  cartwheel: {
    min: 3, max: 9, w: (c) => people(c, 0.6 * dry(c) * warm(c) * (1 - c.night * 0.7)),
    pose: (A, u, left, st) => {
      const C = 3.6, t = u % C, dir = st.v < 0.5 ? 1 : -1;
      const go = left + t > 3.1;
      const e = (x: number) => x * x * (3 - 2 * x);
      const w1 = go ? clamp((t - 0.3) / 0.8, 0, 1) : 0, w2 = go ? clamp((t - 1.9) / 0.8, 0, 1) : 0;
      const out = t < 1.9;
      // an aerial: short arms never reach the ground past that big head
      A.wheel = out ? -dir * TAU * e(w1) : dir * TAU * e(w2);
      A.shiftX = out ? dir * 0.36 * e(w1) : dir * 0.36 * (1 - e(w2));
      A.pivot = 0.36;
      const wf = out ? w1 : w2, turning = wf > 0 && wf < 1;
      A.bob = turning ? Math.sin(Math.PI * wf) * 0.16 : 0;
      const v = go ? win(t, 0.12, 2.95, 0.2) : 0;
      A.armL = A.armR = -0.1 * v;
      A.splayL = A.splayR = 0.2 + 2.35 * v;
      A.legSpL = A.legSpR = turning ? 0.5 : 0.12 * v;
      A.nod = -0.12 * v;
    },
  },
  headstand: {
    min: 3.5, max: 7, w: (c) => people(c, 0.5 * dry(c) * warm(c) * (1 - c.night * 0.7)),
    pose: (A, u, left) => {
      const up = sm(0.15, 0.75, u);
      const down = left < 0.95 ? 1 - sm(0.25, 0.95, left) : 0;
      const ang = Math.PI * (up + down);
      const inv = Math.sin(ang / 2);
      A.flip = ang + (up >= 1 && !down ? Math.sin(u * 2.4) * 0.06 : 0);
      A.pivot = 0.35; // the crown of the head just touches the ground
      A.armL = A.armR = -2.95 * clamp(inv * 1.6, 0, 1);
      A.splayL = A.splayR = 0.18 + 0.3 * inv; // hands out beside the head
      A.legL = (0.3 + Math.sin(u * 1.8) * 0.15) * inv;
      A.legR = (-0.3 - Math.sin(u * 1.8) * 0.15) * inv;
      A.nod = -0.35 * inv;
      A.squash = -0.02 * inv;
    },
  },
  wave: {
    min: 2, max: 4.5, w: (c) => (c.cam ? 1.4 : 0),
    pose: (A, u, _l, st, d) => {
      st.face = Math.atan2(d.camPos.x - st.x, d.camPos.z - st.z);
      A.armL = -2.75; A.splayL = 0.45 + 0.4 * Math.sin(u * 13);
      A.armR = 0.35; A.splayR = 0.8;
      A.nod = -0.3; A.tilt = Math.sin(u * 3) * 0.12;
      A.bob = Math.abs(Math.sin(u * 6)) * 0.02;
    },
  },
  sit: {
    min: 4, max: 14, w: (c) => (c.soldier ? 1 : 0.8) * (1 + c.night * 2) * dry(c) * warm(c),
    pose: (A, u, left, st, d) => {
      const k = sm(0.1, 0.7, u) * sm(0.1, 0.7, left);
      A.bob = -0.2 * k;
      A.legL = A.legR = -1.45 * k;
      A.legSpL = A.legSpR = 0.08 * k;
      if (st.v < 0.55) {
        // leaning back on the hands, looking about (up at the moon by night)
        A.lean = -0.28 * k;
        A.armL = A.armR = 0.62 * k;
        A.splayL = A.splayR = 0.35;
        A.nod = (-0.15 - 0.3 * d.night) * k;
        A.yaw = Math.sin(u * 0.4 + st.v * 9) * 0.5 * k;
      } else {
        // hugging the knees
        A.lean = 0.25 * k;
        A.armL = A.armR = -1.25 * k;
        A.splayL = A.splayR = 0.2 - 0.45 * k;
        A.nod = 0.1 * k;
        A.tilt = Math.sin(u * 0.5) * 0.15 * k;
      }
      A.squash = Math.sin(u * 1.6) * 0.008;
    },
  },
  nap: {
    min: 6, max: 20, w: (c) => (c.night > 0.55 ? 2.4 : 0.15) * dry(c) * warm(c),
    pose: (A, u, left) => {
      const k = liedown(u, left);
      A.lie = k; A.bob = 0.13 * k;
      A.squash = Math.sin(u * 1.5) * 0.015 * k + bounce(u);
      A.armL = A.armR = -2.9 * k;
      A.splayL = A.splayR = 0.2 + 0.75 * k;
      A.legR = -0.12 * k; A.legSpR = -0.12 * k; A.legSpL = 0.05 * k;
      A.eyes = k > 0.6 ? 0.12 : 1;
      A.tilt = 0.25 * k;
    },
  },
  stargaze: {
    min: 6, max: 16, w: (c) => (c.night > 0.55 && c.rain < 0.1 ? 1.5 : 0) * warm(c),
    pose: (A, u, left, st) => {
      const k = liedown(u, left);
      const point = win((u + st.v * 6) % 7, 3, 4.3, 0.35) * k;
      A.lie = k; A.bob = 0.13 * k;
      A.squash = Math.sin(u * 1.4) * 0.012 * k + bounce(u);
      A.armR = -2.9 * k; A.splayR = 0.2 + 0.75 * k;
      A.armL = lerp(-2.9, -1.45, point) * k; A.splayL = lerp(0.2 + 0.75 * k, 0.12, point);
      A.legR = -0.12 * k; A.legSpR = -0.12 * k;
      A.yaw = Math.sin(u * 0.3 + st.v * 7) * 0.5 * k;
    },
  },
  rainDance: {
    min: 2.5, max: 10, w: (c) => people(c, c.rain > 0.3 ? 4 : 0),
    pose: (A, u, left, st) => {
      A.spin = (st.v < 0.5 ? 1 : -1) * spinTo(u, u + left, 3.4);
      const t = u / 0.5, f = t % 1, side = Math.floor(t) & 1 ? 1 : -1, up = Math.sin(f * Math.PI);
      A.bob = up * 0.07;
      A.legL = side < 0 ? -0.7 * up : 0.1; A.legR = side > 0 ? -0.7 * up : 0.1;
      A.armL = A.armR = -0.7 - 0.6 * Math.sin(u * 2.2);
      A.splayL = A.splayR = 1.3;
      A.nod = -0.5; A.eyes = 0.12;
    },
  },
  puddle: {
    min: 2, max: 8, w: (c) => people(c, c.rain > 0.3 || G.uWet.value > 0.5 ? 3 : 0),
    pose: (A, u) => {
      const t = u % 1.05;
      const crouch = win(t, 0.08, 0.22, 0.08), land = win(t, 0.68, 0.78, 0.08);
      const f = clamp((t - 0.25) / 0.42, 0, 1), air = t > 0.25 && t < 0.67 ? Math.sin(f * Math.PI) : 0;
      A.bob = 0.22 * air - 0.05 * (crouch + land);
      A.squash = 0.1 * crouch + 0.14 * land;
      A.legL = A.legR = -0.4 * air;
      A.armL = A.armR = -2.4 * air + 0.5 * crouch;
      A.splayL = A.splayR = 0.4;
      A.nod = 0.25 * land - 0.2 * air;
    },
  },
  catchRain: {
    min: 2.5, max: 7, w: (c) => people(c, c.rain > 0.3 ? 2 : 0),
    pose: (A, u, left, st) => {
      A.spin = (st.v < 0.5 ? 1 : -1) * spinTo(u, u + left, 1.4);
      A.nod = -0.6; A.eyes = 0.12;
      A.armL = A.armR = -1.25; A.splayL = A.splayR = 0.55;
      A.bob = Math.sin(u * 3) ** 2 * 0.015;
      A.tilt = Math.sin(u * 0.9) * 0.15;
    },
  },
  snowAngel: {
    min: 5, max: 8, w: (c) => people(c, c.snow > 0.35 ? 2.5 : 0),
    pose: (A, u, left) => {
      const k = liedown(u, left);
      const fl = (0.5 - 0.5 * Math.cos((u - 1) * TAU / 1.3)) * sm(0.95, 1, k);
      A.lie = k; A.bob = 0.13 * k;
      A.squash = bounce(u);
      A.armL = A.armR = 0;
      A.splayL = A.splayR = 0.25 + 2.3 * fl;
      A.legSpL = A.legSpR = 0.45 * fl;
      A.nod = -0.1 * k;
    },
  },
  snowball: {
    min: 5, max: 16, pair: 'shiver', w: (c) => people(c, c.snow > 0.35 ? 3 : 0),
    pose: (A, u, _l, st) => {
      const tau = (u + (st.lead ? 0 : SNOW_P / 2)) % SNOW_P;
      // throwing arm: follow through, rest, guard the face, scoop, wind up behind the head, let fly
      A.armL = kf(tau, [0, 0.12, 0.6, 2.35, 2.55, 3.2, 3.35, 3.9, 4.15, 4.6], [-3.05, -1.0, -0.3, -0.3, -2.3, -2.3, -1.15, -1.15, -1.3, -3.05]);
      A.armR = kf(tau, [0, 0.3, 2.35, 2.55, 3.2, 3.35, 3.9, 4.2, 4.6], [-1.3, -0.3, -0.3, -2.1, -2.1, -1.15, -1.15, -1.5, -1.5]);
      A.splayL = kf(tau, [0, 0.3, 4.15, 4.4], [0.35, 0.2, 0.2, 0.35]);
      A.splayR = kf(tau, [2.35, 2.55, 3.2, 3.35], [0.2, -0.1, -0.1, 0.2]);
      const laugh = win(tau, 0.6, 1.2, 0.1), flinch = win(tau, 2.8, 3.1, 0.06), scoop = win(tau, 3.35, 3.9, 0.15);
      A.lean = kf(tau, [0, 0.15, 0.5], [0.3, 0.25, 0]) - 0.35 * flinch + 0.8 * scoop;
      A.roll = 0.15 * flinch;
      A.twist = kf(tau, [0, 0.2, 3.9, 4.2, 4.5, 4.6], [0.25, 0, 0, -0.35, -0.35, 0.25]);
      A.bob = Math.abs(Math.sin(tau * 18)) * 0.03 * laugh - 0.03 * scoop;
      A.squash = 0.06 * scoop;
      A.nod = 0.3 * scoop - 0.15 * laugh + 0.2 * flinch;
      A.eyes = flinch > 0.3 || laugh > 0.5 ? 0.12 : 1;
      A.legL = 0.25 * win(tau, 4.1, 4.6, 0.1);
      st.hold = tau >= 3.75;
    },
  },
  shiver: {
    min: 2, max: 5, w: (c) => people(c, c.snow > 0.35 ? 1 : 0),
    pose: (A, u) => {
      A.armL = A.armR = -1.3; A.splayL = A.splayR = -0.72;
      A.roll = Math.sin(u * 45) * 0.03; A.twist = Math.sin(u * 37) * 0.04;
      A.squash = 0.03; A.nod = 0.15;
      A.legL = -Math.max(0, Math.sin(u * 8)) * 0.2; A.legR = -Math.max(0, -Math.sin(u * 8)) * 0.2;
    },
  },
  pushups: {
    min: 3.5, max: 8, w: (c) => (c.soldier ? 2 : 0.25 * (1 - c.night)) * dry(c) * warm(c),
    pose: (A, u, left) => {
      const k = sm(0, 0.7, u) * sm(0.15, 0.85, left);
      const rep = (0.5 - 0.5 * Math.cos(Math.max(0, u - 0.7) * TAU / 1.2)) * sm(0.6, 0.95, k);
      const th = (1.0 + 0.22 * rep) * k;
      const h = RIG.shoulderY * Math.cos(th);
      const beta = Math.acos(clamp(h / 0.215, 0, 1)) * k;
      A.prone = th;
      A.armL = A.armR = -th - beta;
      A.splayL = A.splayR = 0.28;
      A.nod = -0.55 * k;
    },
  },
  drill: {
    min: 3, max: 10, tool: true, w: (c) => (c.soldier ? 3 : 0),
    pose: (A, u, _l, st, d) => {
      if (d.cur?.job === 'bowman') {
        const t = u % 2.2;
        const draw = sm(0.2, 1.1, t) * (1 - sm(1.45, 1.55, t));
        A.armL = -1.9; A.splayL = 0.1;
        A.armR = -1.75; A.splayR = 0.3 + 0.6 * draw;
        A.twist = -0.3; A.yaw = 0.3; A.nod = -0.3;
        A.lean = -0.1 * win(t, 1.5, 1.7, 0.08);
        return;
      }
      const t = (u + st.v * 2) % 2.6;
      A.legL = 0.32; A.legR = -0.22 - 0.15 * win(t, 0.9, 1.1, 0.08);
      A.armL = -1.15; A.splayL = 0.15;
      A.armR = kf(t, [0, 0.35, 0.5, 0.9, 1.0, 1.1, 1.5, 1.6, 1.75, 2.0], [-1.2, -2.8, -0.5, -1.2, -1.55, -1.55, -1.2, -1.5, -1.5, -1.2]);
      A.splayR = kf(t, [1.45, 1.6, 1.75, 2.0], [0.2, 1.3, -0.3, 0.2]);
      A.twist = kf(t, [0.35, 0.5, 0.9, 1.5, 1.6, 1.75, 2.1], [0, 0.35, 0, 0, -0.5, 0.4, 0]);
      A.lean = 0.25 * win(t, 0.45, 0.6, 0.1) + 0.3 * win(t, 0.95, 1.1, 0.06);
      A.bob = -0.02 * win(t, 0.95, 1.1, 0.06);
      A.toolRot = 1.45;
      A.nod = 0.05;
    },
  },
};
const ACT_LIST = Object.keys(ACTS) as Act[];
const TOSS_P = 3.0, TOSS_F = 0.9;
const SNOW_P = 4.6, SNOW_F = 0.5;
const MUSIC: ReadonlySet<Act> = new Set(['violin', 'flute']);
/** lying on the ground or in its arms: no shield */
const DOWN: ReadonlySet<Act> = new Set(['pushups', 'sit', 'nap', 'stargaze', 'snowAngel']);
/** lie down on their backs, head away from where they stand (push-ups reach forward instead) */
const LIE_BACK: ReadonlySet<Act> = new Set(['nap', 'stargaze', 'snowAngel']);

/** Flop onto the back (a quick fall), get up again at the end. */
function liedown(u: number, left: number) {
  const f = clamp(u / 0.75, 0, 1);
  return Math.min(f * f, sm(0.15, 1.0, left));
}
const bounce = (u: number) => (u > 0.75 && u < 1.05 ? Math.sin(((u - 0.75) / 0.3) * Math.PI) * 0.06 : 0);

const bowV = new THREE.Vector3();
/** Where the frog of the bow is when `s` of it lies between the hand and the strings. */
function bowFrog(s: number) {
  return bowV.copy(V_STR).addScaledVector(V_T, 0.009 * BS).addScaledVector(V_B, -s);
}

// ------------------------------------------------------------------ floating notes and Zzz
/** Glyph atlas cells: a quaver, two beamed quavers, a Z and a drop of sweat. Red = ink, alpha = ink + outline. */
function glyphAtlas() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const x = c.getContext('2d')!;
  x.lineJoin = x.lineCap = 'round';
  const cells: ((ink: boolean) => void)[] = [
    (ink) => {
      x.beginPath(); x.ellipse(24, 46, 10, 7.5, -0.45, 0, TAU);
      ink ? x.fill() : x.stroke();
      x.beginPath(); x.moveTo(32.5, 44); x.lineTo(32.5, 11); x.bezierCurveTo(36, 20, 47, 22, 44, 36);
      x.lineWidth = ink ? 4.5 : 12; x.stroke(); x.lineWidth = 9;
    },
    (ink) => {
      for (const [hx, hy] of [[17, 48], [44, 42]]) { x.beginPath(); x.ellipse(hx, hy, 9, 7, -0.45, 0, TAU); ink ? x.fill() : x.stroke(); }
      x.beginPath(); x.moveTo(24.5, 46); x.lineTo(24.5, 15); x.lineTo(51.5, 9); x.lineTo(51.5, 40);
      x.lineWidth = ink ? 4.5 : 12; x.stroke();
      x.beginPath(); x.moveTo(24.5, 17); x.lineTo(51.5, 11);
      x.lineWidth = ink ? 8 : 15; x.stroke(); x.lineWidth = 9;
    },
    (ink) => {
      x.font = 'bold 50px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      ink ? x.fillText('Z', 32, 34) : x.strokeText('Z', 32, 34);
    },
    (ink) => {
      x.beginPath(); x.moveTo(32, 9); x.bezierCurveTo(36, 22, 46, 30, 46, 40); x.arc(32, 40, 14, 0, Math.PI); x.bezierCurveTo(18, 30, 28, 22, 32, 9);
      ink ? x.fill() : x.stroke();
    },
  ];
  cells.forEach((draw, i) => {
    x.save();
    x.translate((i % 2) * S, Math.floor(i / 2) * S);
    x.strokeStyle = '#000'; x.fillStyle = '#000'; x.lineWidth = 9;
    draw(false);
    x.strokeStyle = '#f00'; x.fillStyle = '#f00'; x.lineWidth = 9;
    draw(true);
    x.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

class Glyphs {
  readonly max = 320;
  n = 0;
  private pos = new Float32Array(this.max * 3);
  private vel = new Float32Array(this.max * 3);
  private col = new Float32Array(this.max * 3);
  private age = new Float32Array(this.max);
  private life = new Float32Array(this.max);
  private size = new Float32Array(this.max);
  private grow = new Float32Array(this.max);
  private cell = new Float32Array(this.max);
  private ph = new Float32Array(this.max);
  private geo = new THREE.BufferGeometry();
  private aPos: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private aCell: THREE.BufferAttribute;
  private aRot: THREE.BufferAttribute;
  points: THREE.Points;

  constructor() {
    const dyn = (n: number, k: number) => new THREE.BufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage);
    this.aPos = dyn(this.max, 3); this.aCol = dyn(this.max, 3);
    this.aSize = dyn(this.max, 1); this.aAlpha = dyn(this.max, 1); this.aCell = dyn(this.max, 1); this.aRot = dyn(this.max, 1);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('gcolor', this.aCol);
    this.geo.setAttribute('gsize', this.aSize);
    this.geo.setAttribute('galpha', this.aAlpha);
    this.geo.setAttribute('gcell', this.aCell);
    this.geo.setAttribute('grot', this.aRot);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uScale: { value: 800 },
        tAtlas: { value: glyphAtlas() },
        uNight: G.uNight,
        tFog: G.tFog,
        uMapSize: G.uMapSize,
        uFogOn: G.uFogOn,
      },
      vertexShader: /* glsl */ `
        attribute vec3 gcolor; attribute float gsize; attribute float galpha; attribute float gcell; attribute float grot;
        varying vec3 vCol; varying float vAlpha; varying float vCell; varying float vRot; varying float vFog;
        uniform float uScale; uniform sampler2D tFog; uniform vec2 uMapSize; uniform float uFogOn;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = gsize * uScale / max(0.5, -mv.z);
          vCol = gcolor; vAlpha = galpha; vCell = gcell; vRot = grot;
          vFog = mix(1.0, smoothstep(0.1, 0.6, texture2D(tFog, (position.xz + 0.5) / uMapSize).r), uFogOn);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vAlpha; varying float vCell; varying float vRot; varying float vFog;
        uniform sampler2D tAtlas; uniform float uNight;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          uv = mat2(c, -s, s, c) * uv + 0.5;
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
          vec2 cell = vec2(mod(vCell, 2.0), floor(vCell / 2.0));
          vec4 t = texture2D(tAtlas, vec2((cell.x + uv.x) * 0.5, 1.0 - (cell.y + uv.y) * 0.5));
          float a = t.a * vAlpha * vFog;
          if (a < 0.01) discard;
          // light glyphs get a dark rim, dark ones a light rim
          vec3 rim = dot(vCol, vec3(0.3, 0.59, 0.11)) > 0.45 ? vec3(0.08, 0.1, 0.18) : vec3(1.0, 0.97, 0.9);
          vec3 col = mix(rim, vCol, clamp(t.r / max(t.a, 0.001), 0.0, 1.0)) * mix(1.0, 0.72, uNight);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  setScale(px: number) {
    ((this.points.material as THREE.ShaderMaterial).uniforms.uScale as { value: number }).value = px;
  }

  emit(x: number, y: number, z: number, cell: number, col: readonly number[], size: number, vx: number, vy: number, vz: number, life = 1.7, grow = 0) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = col[0]; this.col[i * 3 + 1] = col[1]; this.col[i * 3 + 2] = col[2];
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.grow[i] = grow; this.cell[i] = cell;
    this.ph[i] = Math.random() * TAU;
  }

  update(dt: number) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] < this.life[i]) continue;
      n--;
      if (i !== n) {
        for (let k = 0; k < 3; k++) {
          this.pos[i * 3 + k] = this.pos[n * 3 + k]; this.vel[i * 3 + k] = this.vel[n * 3 + k]; this.col[i * 3 + k] = this.col[n * 3 + k];
        }
        this.age[i] = this.age[n]; this.life[i] = this.life[n]; this.size[i] = this.size[n];
        this.grow[i] = this.grow[n]; this.cell[i] = this.cell[n]; this.ph[i] = this.ph[n];
      }
      i--;
    }
    this.n = n;
    const ap = this.aPos.array as Float32Array, ac = this.aCol.array as Float32Array;
    const as = this.aSize.array as Float32Array, aa = this.aAlpha.array as Float32Array;
    const ak = this.aCell.array as Float32Array, ar = this.aRot.array as Float32Array;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      const t = this.age[i] / this.life[i], a = this.age[i];
      const wob = Math.sin(a * 4.2 + this.ph[i]);
      ap[i * 3] = this.pos[i * 3] + wob * 0.06; ap[i * 3 + 1] = this.pos[i * 3 + 1]; ap[i * 3 + 2] = this.pos[i * 3 + 2];
      ac[i * 3] = this.col[i * 3]; ac[i * 3 + 1] = this.col[i * 3 + 1]; ac[i * 3 + 2] = this.col[i * 3 + 2];
      as[i] = this.size[i] * (1 + this.grow[i] * t) * (0.6 + 0.4 * sm(0, 0.15, t));
      aa[i] = sm(0, 0.1, t) * (1 - sm(0.6, 1, t));
      ak[i] = this.cell[i];
      ar[i] = wob * 0.25;
    }
    for (const a of [this.aPos, this.aCol, this.aSize, this.aAlpha, this.aCell, this.aRot]) uploadFirst(a, n);
    this.geo.setDrawRange(0, n);
  }
}

// ------------------------------------------------------------------ director
export interface PropBatch {
  mesh: THREE.InstancedMesh;
  add(m: THREE.Matrix4, c1?: THREE.Color, c2?: THREE.Color): void;
  finish(): void;
}
type BatchMaker = (geo: THREE.BufferGeometry, cap: number, tinted: boolean) => PropBatch;

const INK = [[0.1, 0.07, 0.05], [0.16, 0.08, 0.2], [0.06, 0.1, 0.22], [0.25, 0.06, 0.05]] as const;
const ZZZ = [0.86, 0.9, 1.0] as const;
const SWEAT = [0.62, 0.86, 1.0] as const;
const JUGGLE = [new THREE.Color(0xd8322a), new THREE.Color(0xf0c02a), new THREE.Color(0x2a6ad8)];

function newSt(): St {
  return {
    seen: -10, since: -1, act: null, t0: 0, end: 0, next: 0, leave: -1, partner: 0, lead: false,
    face: NaN, head: 0, x: 0, y: 0, z: 0, v: 0, sync: false, picks: 0, fxT: 0, tau: 0, k: 0,
    hold: false, hy: 0, hz: 0, ball: false, bx: 0, by: 0, bz: 0, jb: new Float32Array(9),
  };
}

function isSoldier(s: Settler) {
  return s.job === 'swordsman' || s.job === 'bowman';
}

export class IdleDirector {
  group = new THREE.Group();
  /** particle effects (puddle splashes, snow puffs, breath); set by the renderer */
  fx: Particles | null = null;
  /** falling rain 0..1 (not snow); set by the renderer */
  rain = 0;
  /** preview tool: the pastime each free settler takes up */
  force: ((s: Settler) => Act) | null = null;
  now = 0;
  night = 0;
  camPos = new THREE.Vector3();
  /** the settler being drawn, between apply() and props() */
  cur: Settler | null = null;
  private st: St | null = null;
  private e = 0;
  private frame = 0;
  private lastNow = -1;
  private states = new Map<number, St>();
  private pool: { id: number; st: St; owner: number }[] = [];
  private poolNext: { id: number; st: St; owner: number }[] = [];
  private band: St[] = [];
  private bandNext: St[] = [];
  private A = resetPose({} as Pose);
  private glyphs = new Glyphs();
  private violin: PropBatch;
  private bow: PropBatch;
  private flute: PropBatch;
  private ball: PropBatch;
  private jball: PropBatch;
  private snowball: PropBatch;
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private eul = new THREE.Euler();

  constructor(private game: Game, private scale: number, batch: BatchMaker) {
    const g = buildPropGeos();
    this.violin = batch(g.violin, 300, false);
    this.bow = batch(g.bow, 300, false);
    this.flute = batch(g.flute, 300, false);
    this.ball = batch(g.ball, 300, false);
    this.jball = batch(g.jball, 600, true);
    this.snowball = batch(g.snowball, 400, false);
    for (const b of [this.violin, this.bow, this.flute, this.ball, this.jball, this.snowball]) this.group.add(b.mesh);
    this.group.add(this.glyphs.points);
  }

  setScale(px: number) {
    this.glyphs.setScale(px);
  }

  begin(camera: THREE.Camera) {
    this.now = this.game.time;
    this.frame++;
    this.night = G.uNight.value;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    [this.pool, this.poolNext] = [this.poolNext, this.pool];
    this.poolNext.length = 0;
    [this.band, this.bandNext] = [this.bandNext, this.band];
    this.bandNext.length = 0;
  }

  /** Free to play: standing idle with nothing in hand and nowhere to go. */
  private free(s: Settler, moving: boolean) {
    if (moving || s.dead || s.hidden || s.aboard || s.carrying || s.anim !== 'idle' || s.actions.length) return false;
    if (isSoldier(s)) return s.sstate === 'idle' && !s.engaged && !s.home;
    return s.idle;
  }

  /** Poses a free settler for its pastime on top of the plain idle pose; returns the heading to draw it at. */
  apply(s: Settler, P: Pose, moving: boolean, y0: number): number {
    const now = this.now;
    let st = this.states.get(s.id);
    if (!st) { st = newSt(); this.states.set(s.id, st); }
    this.cur = s;
    this.st = st;
    this.e = 0;
    if (st.seen < this.frame - 1) this.stop(st, true); // off screen for a while: start afresh
    st.seen = this.frame;
    st.x = s.x; st.y = y0; st.z = s.z;
    let e: number;
    if (!this.free(s, moving)) {
      st.since = -1;
      if (!st.act) return (st.head = s.heading);
      if (st.leave < 0) st.leave = now;
      e = 1 - (now - st.leave) / 0.25; // called away: drop it quickly
      if (e <= 0) { this.stop(st); return (st.head = s.heading); }
    } else {
      if (st.leave >= 0) this.stop(st);
      if (st.since < 0) { st.since = now; st.next = now + 0.5 + hash2(s.id, st.picks, 17) * 1.2; }
      if (st.act && now >= st.end) { this.stop(st); st.next = now + 0.4 + hash2(s.id, st.picks, 29); }
      if (!st.act && now >= st.next) this.choose(s, st);
      if (!st.act) {
        this.poolNext.push({ id: s.id, st, owner: s.owner });
        return (st.head = s.heading);
      }
      e = 1;
    }
    if (st.partner && !this.partnerOk(s.id, st)) {
      st.partner = 0;
      st.end = Math.min(st.end, now + 0.4);
    }
    const act = st.act!;
    e *= sm(0, 0.4, now - st.t0) * sm(0, 0.4, st.end - now);
    const A = resetPose(this.A);
    st.ball = false;
    ACTS[act].pose(A, now - st.t0, st.end - now, st, this);
    blendPose(P, A, e);
    this.e = e;
    if (MUSIC.has(act)) this.bandNext.push(st);
    let head = s.heading;
    if (st.partner) {
      const p = this.states.get(st.partner)!;
      st.face = Math.atan2(p.x - st.x, p.z - st.z);
    }
    if (!Number.isNaN(st.face)) head += wrap(st.face - s.heading) * e;
    return (st.head = head);
  }

  /** Hands busy: put the tool away (and the shield, when down on the ground). */
  get hidesTool() {
    return !!this.st?.act && this.e > 0.3 && !ACTS[this.st.act].tool;
  }
  get hidesShield() {
    return !!this.st?.act && this.e > 0.3 && DOWN.has(this.st.act);
  }

  private partnerOk(id: number, st: St) {
    const p = this.states.get(st.partner);
    return !!p && p.partner === id && p.act === st.act && p.seen >= this.frame - 1 && p.leave < 0;
  }

  private stop(st: St, silent = false) {
    if (st.partner && !silent) {
      const p = this.states.get(st.partner);
      if (p && p.partner && p.act === st.act) p.end = Math.min(p.end, this.now + 0.4);
    }
    st.act = null;
    st.partner = 0;
    st.leave = -1;
    st.face = NaN;
    st.ball = st.hold = false;
    if (silent) st.since = -1;
  }

  private ctx(s: Settler, st: St, soldier: boolean): Ctx {
    let music = false;
    for (const b of this.band) if (b !== st && (b.x - s.x) ** 2 + (b.z - s.z) ** 2 < 49) { music = true; break; }
    return {
      rain: this.rain, snow: G.uSnow.value, night: this.night, music, soldier,
      cam: this.camPos.distanceToSquared(this.v.set(s.x, st.y, s.z)) < 26 * 26,
    };
  }

  private choose(s: Settler, st: St) {
    const now = this.now;
    const soldier = isSoldier(s);
    const h = (k: number) => hash2(s.id, st.picks * 8 + k, 4099);
    st.picks++;
    const left = soldier || this.force ? 1e9 : s.wanderT;
    if (left < 1.8) { st.next = now + left + 0.5; return; } // not worth starting anything
    const c = this.ctx(s, st, soldier);
    let act: Act | null = this.force?.(s) ?? null;
    if (!act) {
      let total = 1.4; // weight of just standing about for a bit
      for (const a of ACT_LIST) total += left >= ACTS[a].min ? ACTS[a].w(c) : 0;
      let r = h(1) * total - 1.4;
      if (r >= 0) {
        for (const a of ACT_LIST) {
          const w = left >= ACTS[a].min ? ACTS[a].w(c) : 0;
          if (w > 0 && (r -= w) < 0) { act = a; break; }
        }
      }
    }
    if (!act) { st.next = now + Math.min(left, 1.5 + 2.5 * h(2)); return; }
    let def = ACTS[act];
    const dur = Math.min(left, def.max * (soldier ? 0.5 + 0.5 * h(3) : 0.6 + 0.4 * h(3)));
    st.act = act;
    st.t0 = now;
    st.end = now + dur;
    st.v = h(4);
    st.sync = c.music;
    st.fxT = now + 0.2;
    st.tau = 0;
    st.face = NaN;
    st.leave = -1;
    if (LIE_BACK.has(act) || act === 'pushups') {
      // lie down into the open, not across a neighbour
      const n = this.nearest(s.id, st, 2.2);
      if (n) st.face = Math.atan2(n.x - st.x, n.z - st.z) + (act === 'pushups' ? Math.PI : 0);
    }
    if (def.pair) {
      const p = this.findPartner(s, st, def.min);
      if (p) {
        const end = Math.min(st.end, now + (isSoldier(p.s) || this.force ? 1e9 : p.s.wanderT));
        Object.assign(p.st, { act, t0: now, end, v: st.v, sync: false, fxT: now + 0.2, tau: 0, leave: -1, partner: s.id, lead: false });
        st.end = end;
        st.partner = p.s.id;
        st.lead = true;
      } else {
        act = def.pair;
        def = ACTS[act];
        if (left < def.min) { st.act = null; st.next = now + 1; return; }
        st.act = act;
      }
    }
  }

  private nearest(id: number, st: St, r: number) {
    let best: St | null = null, bd = r * r;
    for (const [oid, o] of this.states) {
      if (oid === id || o.seen < this.frame - 1) continue;
      const d = (o.x - st.x) ** 2 + (o.z - st.z) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private findPartner(s: Settler, st: St, min: number) {
    let best: { s: Settler; st: St } | null = null, bd = Infinity;
    for (const c of this.pool) {
      if (c.id === s.id || c.owner !== s.owner || c.st.act || c.st.since < 0 || c.st.seen < this.frame - 1) continue;
      const d = (c.st.x - st.x) ** 2 + (c.st.z - st.z) ** 2;
      if (d < 0.8 * 0.8 || d > 3.2 * 3.2 || d >= bd) continue;
      const o = this.game.settlers.get(c.id);
      if (!o || (!this.force && !isSoldier(o) && o.wanderT < min)) continue;
      best = { s: o, st: c.st };
      bd = d;
    }
    return best;
  }

  /** settler space → world, for a settler standing at its st position and drawn heading */
  private toWorld(st: St, x: number, y: number, z: number, out: THREE.Vector3) {
    const c = Math.cos(st.head), sn = Math.sin(st.head), k = this.scale;
    return out.set(st.x + (x * c + z * sn) * k, st.y + y * k, st.z + (-x * sn + z * c) * k);
  }

  private ballAt(b: PropBatch, p: THREE.Vector3, spin: number) {
    this.q.setFromEuler(this.eul.set(spin, spin * 0.7, 0));
    b.add(this.m.compose(p, this.q, this.v2.setScalar(this.scale)));
  }

  /** Draws the pastime's props and lets off its notes, Zzz and splashes. */
  props(s: Settler, body: THREE.Matrix4, armL: THREE.Matrix4) {
    const st = this.st;
    if (!st || !st.act || this.e < 0.5 || this.cur !== s) return;
    const now = this.now, u = now - st.t0;
    const W = this.v;
    switch (st.act) {
      case 'violin': {
        this.violin.add(this.m.multiplyMatrices(body, VIOLIN_M));
        this.m2.makeBasis(BOW_X, V_B, BOW_Z).scale(this.v2.setScalar(BS)).setPosition(bowFrog(st.k));
        this.bow.add(this.m.multiplyMatrices(body, this.m2));
        break;
      }
      case 'flute':
        this.flute.add(this.m.multiplyMatrices(body, FLUTE_M));
        break;
      case 'kick':
        if (st.ball) this.ballAt(this.ball, this.toWorld(st, st.bx, st.by, st.bz, W), u * 7);
        break;
      case 'juggle':
        for (let i = 0; i < 3; i++) {
          this.toWorld(st, st.jb[i * 3], st.jb[i * 3 + 1], st.jb[i * 3 + 2], W);
          this.jball.add(this.m.compose(W, this.q.identity(), this.v2.setScalar(this.scale)), JUGGLE[i]);
        }
        break;
      case 'toss': {
        const p = st.partner ? this.states.get(st.partner) : null;
        if (!p || !st.lead) break;
        const t = u % TOSS_P, half = TOSS_P / 2;
        const from = t < half ? st : p, to = t < half ? p : st, f = (t < half ? t : t - half) / TOSS_F;
        if (f < 1) {
          this.toWorld(from, 0, RIG.shoulderY + ARM * 0.32 + 0.01, ARM * 0.95 + 0.035, W);
          this.toWorld(to, 0, to.hy, to.hz, this.v2);
          W.lerp(this.v2, f);
          W.y += 4 * f * (1 - f) * (0.35 + 0.08 * Math.hypot(p.x - st.x, p.z - st.z));
        } else this.toWorld(to, 0, to.hy, to.hz, W);
        this.ballAt(this.ball, W, u * 5);
        break;
      }
      case 'snowball': {
        if (st.hold) {
          W.set(0, RIG.handY, 0.02).applyMatrix4(armL);
          this.snowball.add(this.m.compose(W, this.q.identity(), this.v2.setScalar(this.scale)));
        }
        const p = st.partner ? this.states.get(st.partner) : null;
        if (!p || !st.lead) break;
        const t = u % SNOW_P, half = SNOW_P / 2;
        const from = t < half ? st : p, to = t < half ? p : st, f = (t < half ? t : t - half) / SNOW_F;
        if (f >= 1) break;
        this.toWorld(from, -0.13, 0.56, 0.1, W);
        this.toWorld(to, 0, 0.5, 0.06, this.v2);
        W.lerp(this.v2, f);
        W.y += 4 * f * (1 - f) * 0.14;
        this.snowball.add(this.m.compose(W, this.q.identity(), this.v2.setScalar(this.scale)));
        break;
      }
    }
    this.effects(s, st, u);
  }

  private effects(s: Settler, st: St, u: number) {
    const now = this.now, P = this.fx, W = this.v;
    const h = (k: number) => hash2(s.id, Math.floor(now * 10) + k, 991);
    switch (st.act) {
      case 'violin': case 'flute':
        if (now >= st.fxT) {
          st.fxT = now + 0.38 + h(1) * 0.4;
          this.toWorld(st, (h(2) - 0.5) * 0.3 + (st.act === 'violin' ? 0.1 : -0.12), 0.86, 0.12, W);
          this.glyphs.emit(W.x, W.y, W.z, h(3) < 0.6 ? 0 : 1, INK[Math.floor(h(4) * INK.length)], 0.2 + h(5) * 0.06,
            (h(6) - 0.5) * 0.25, 0.42 + h(7) * 0.15, (h(8) - 0.5) * 0.25);
        }
        break;
      case 'nap':
        if (now >= st.fxT && u > 1.4 && st.end - now > 1) {
          st.fxT = now + 1.05;
          this.toWorld(st, 0.05, 0.3, -0.5, W);
          this.glyphs.emit(W.x, W.y, W.z, 2, ZZZ, 0.12, 0.12, 0.3, 0, 2.2, 1.6);
        }
        break;
      case 'pushups':
        if (now >= st.fxT && u > 2) {
          st.fxT = now + 1.6 + h(1);
          this.toWorld(st, 0.1, 0.42, 0.42, W);
          this.glyphs.emit(W.x, W.y, W.z, 3, SWEAT, 0.12, 0.2, 0.25, 0, 0.9);
        }
        break;
      case 'puddle': {
        const t = u % 1.05;
        if (P && st.tau < 0.7 && t >= 0.7) {
          P.emit({ x: s.x, y: st.y + 0.04, z: s.z, vy: 1.9, spread: 1.8, vspread: 0.6, life: 0.6, size: 0.06, color: [0.78, 0.86, 0.95], alpha: 0.95, gravity: 7, drag: 0.3, count: 16, kind: 1 });
          P.emit({ x: s.x, y: st.y + 0.02, z: s.z, life: 0.8, size: 0.45, grow: 2.2, color: [0.85, 0.9, 0.97], alpha: 0.45, drag: 3 });
        }
        st.tau = t;
        break;
      }
      case 'rainDance': {
        const t = (u / 0.5) % 1;
        if (P && t < st.tau && h(1) < 0.6) P.emit({ x: s.x, y: st.y + 0.03, z: s.z, vy: 1.1, spread: 1.0, vspread: 0.4, life: 0.4, size: 0.035, color: [0.72, 0.82, 0.92], alpha: 0.8, gravity: 7, drag: 0.4, count: 5, kind: 1 });
        st.tau = t;
        break;
      }
      case 'snowball': {
        const tau = (u + (st.lead ? 0 : SNOW_P / 2)) % SNOW_P;
        if (P && st.tau < 2.8 && tau >= 2.8) {
          this.toWorld(st, 0, 0.5, 0.08, W);
          P.emit({ x: W.x, y: W.y, z: W.z, vy: 0.6, spread: 1.6, vspread: 0.8, life: 0.55, size: 0.05, color: [0.95, 0.97, 1], alpha: 0.95, gravity: 4, drag: 0.8, count: 10, kind: 1 });
          P.emit({ x: W.x, y: W.y, z: W.z, life: 0.6, size: 0.22, grow: 1.5, color: [0.95, 0.97, 1], alpha: 0.4, drag: 2 });
        }
        st.tau = tau;
        break;
      }
      case 'snowAngel':
        if (P && now >= st.fxT && u > 1.1) {
          st.fxT = now + 0.32;
          const side = h(1) < 0.5 ? -1 : 1;
          this.toWorld(st, side * 0.3, 0.06, -0.3, W);
          P.emit({ x: W.x, y: W.y, z: W.z, vy: 0.4, spread: 0.6, life: 0.5, size: 0.04, color: [0.95, 0.97, 1], alpha: 0.8, gravity: 3, count: 3, kind: 1 });
        }
        break;
      case 'shiver':
        if (P && now >= st.fxT) {
          st.fxT = now + 1.1 + h(1) * 0.4;
          this.toWorld(st, 0, 0.52, 0.2, W);
          this.toWorld(st, 0, 0.52, 0.5, this.v2).sub(W);
          P.emit({ x: W.x, y: W.y, z: W.z, vx: this.v2.x, vy: 0.12, vz: this.v2.z, life: 1.0, size: 0.07, grow: 2.5, color: [0.92, 0.94, 0.98], alpha: 0.28, drag: 1.2 });
        }
        break;
    }
  }

  end() {
    const gdt = this.lastNow < 0 ? 0 : clamp(this.now - this.lastNow, 0, 0.1);
    this.lastNow = this.now;
    for (const b of [this.violin, this.bow, this.flute, this.ball, this.jball, this.snowball]) b.finish();
    this.glyphs.update(gdt);
    this.cur = null;
    this.st = null;
    if (this.states.size > this.game.settlers.size + 500) {
      for (const id of this.states.keys()) if (!this.game.settlers.has(id)) this.states.delete(id);
    }
  }
}
