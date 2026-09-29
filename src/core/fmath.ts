// Trigonometry that comes out the same on every machine. JavaScript's +, -, *, / and Math.sqrt are
// exactly rounded everywhere, but Math.sin, Math.cos, Math.atan2, Math.hypot and ** are each engine's
// own approximation and differ in the last bit between browsers - enough to send two machines playing
// one game in lockstep (src/net/lockstep.ts) down different paths. The game code uses these instead:
// fdlibm's kernels on plain arithmetic, within an ulp or two of the true value.

const PIO2_1 = 1.57079632673412561417e+00; // the first 33 bits of pi/2
const PIO2_1T = 6.07710050650619224932e-11; // pi/2 - PIO2_1
const TWO_OVER_PI = 6.36619772367581382433e-01;

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

/** sin on [-pi/4, pi/4] */
function kSin(x: number): number {
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}
/** cos on [-pi/4, pi/4] */
function kCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - (z * r));
}
/** the quarter turn `x` falls in (as an integer) and how far into it */
let quad = 0;
function reduce(x: number): number {
  const j = Math.floor(x * TWO_OVER_PI + 0.5);
  quad = j & 3;
  return (x - j * PIO2_1) - j * PIO2_1T;
}

export function sin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const r = reduce(x);
  switch (quad) {
    case 0: return kSin(r);
    case 1: return kCos(r);
    case 2: return -kSin(r);
    default: return -kCos(r);
  }
}

export function cos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const r = reduce(x);
  switch (quad) {
    case 0: return kCos(r);
    case 1: return -kSin(r);
    case 2: return -kCos(r);
    default: return kSin(r);
  }
}

const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];
const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];

export function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let ax = neg ? -x : x;
  let id: number;
  if (ax < 0.4375) id = -1;
  else if (ax < 1.1875) {
    if (ax < 0.6875) { id = 0; ax = (2 * ax - 1) / (2 + ax); }
    else { id = 1; ax = (ax - 1) / (ax + 1); }
  } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); }
  else if (ax < 1e300) { id = 3; ax = -1 / ax; }
  else return neg ? -ATAN_HI[3] : ATAN_HI[3];
  const z = ax * ax, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id] - ((ax * (s1 + s2) - ATAN_LO[id]) - ax);
  return neg ? -r : r;
}

/** the angle of (x, y) from the positive x axis, in (-pi, pi]; atan2(dx, dz) is a heading as the game uses it */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + Math.PI : atan(y / x) - Math.PI;
  return y > 0 ? Math.PI / 2 : y < 0 ? -Math.PI / 2 : 0;
}

/** the distance (a, b) spans; sqrt is exactly rounded, so this is the same everywhere */
export function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

/** x squared, as x * x (x ** 2 is not the same in every engine) */
export function sq(x: number): number {
  return x * x;
}
