// The year: a purely visual season clock that drives foliage, ground colour and what falls from the sky.
import { G } from './shaderPatch';

export type SeasonMode = 'auto' | 'spring' | 'summer' | 'autumn' | 'winter';

const NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
// where a fixed season settles (phase 0 = first day of spring)
const TARGET: Record<Exclude<SeasonMode, 'auto'>, number> = { spring: 0.1, summer: 0.37, autumn: 0.62, winter: 0.87 };

type Keys = [number, number][];
// deciduous leaves bud in early spring and are gone by the end of autumn
const LEAF: Keys = [[0.02, 0], [0.14, 1], [0.6, 1], [0.73, 0]];
// autumn colour turn; it only resets while the trees are bare
const TURN: Keys = [[0.0, 0], [0.5, 0], [0.6, 0.5], [0.7, 0.85], [0.74, 1], [0.99, 1]];
const FRESH: Keys = [[0.0, 0], [0.06, 1], [0.16, 1], [0.32, 0]];
const BLOSSOM: Keys = [[0.02, 0], [0.06, 1], [0.12, 1], [0.18, 0]];
// grass: dormant in winter, lush in spring, straw-tinged by late summer
const DRY: Keys = [[0.0, 0.8], [0.12, 0], [0.38, 0], [0.5, 0.3], [0.72, 0.65], [0.8, 0.85], [0.97, 0.85]];
const LITTER: Keys = [[0.08, 0.15], [0.2, 0], [0.58, 0], [0.74, 1], [0.95, 0.55]];
const FLOWERS: Keys = [[0.0, 0], [0.1, 1.35], [0.3, 1], [0.5, 1], [0.65, 0.3], [0.75, 0], [0.97, 0]];
const COLD: Keys = [[0.06, 0], [0.66, 0], [0.78, 1], [0.96, 1]];

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smoothly interpolated keyframes over a wrapping year. */
function curve(p: number, k: Keys): number {
  const n = k.length;
  for (let i = 0; i < n; i++) {
    const [p0, v0] = k[i];
    const [p1, v1] = i + 1 < n ? k[i + 1] : [k[0][0] + 1, k[0][1]];
    let q = p;
    if (q < p0) q += 1;
    if (q >= p0 && q <= p1) return v0 + (v1 - v0) * smooth((q - p0) / Math.max(1e-6, p1 - p0));
  }
  return k[0][1];
}

export class Seasons {
  /** 0..1 through the year, 0 = start of spring */
  phase = 0.3;
  mode: SeasonMode = 'auto';
  /** seconds per season at 1x game speed */
  length = 900;
  /** 0 mild .. 1 deep winter: precipitation falls as snow and snow cover stops melting */
  cold = 0;
  leaf = 1;
  /** true while time-lapsing to a picked season (snow melts along with it) */
  lapsing = false;

  get index() {
    return Math.floor(this.phase * 4) % 4;
  }
  get name() {
    return NAMES[this.index];
  }
  /** 1-based day within the season, given the day length */
  day(dayLength: number) {
    const within = (this.phase * 4) % 1;
    return Math.floor((within * this.length) / dayLength) + 1;
  }

  update(dt: number, gameDt: number, snow: number) {
    this.lapsing = false;
    if (this.mode === 'auto') this.phase = (this.phase + gameDt / (this.length * 4)) % 1;
    else {
      // picking a season time-lapses forward through the year to it
      const ahead = (TARGET[this.mode] - this.phase + 1) % 1;
      if (ahead > 1e-4 && ahead < 0.9999) {
        this.phase = (this.phase + Math.min(ahead, dt * 0.12)) % 1;
        this.lapsing = true;
      }
    }
    const p = this.phase;
    let leaf = curve(p, LEAF);
    let turn = p >= 0.5 ? curve(p, TURN) : 0;
    // never green leaves under snow, whatever brought the snow: they brown and drop, and in
    // spring they wait for the thaw
    leaf = Math.min(leaf, 1 - Math.min(1, Math.max(0, (snow - 0.05) / 0.3)));
    if (p >= 0.2) turn = Math.max(turn, Math.min(1, snow * 4));
    this.leaf = leaf;
    this.cold = curve(p, COLD);
    G.uSeasonA.value.set(leaf, turn, curve(p, FRESH), curve(p, BLOSSOM));
    G.uSeasonB.value.set(curve(p, DRY), curve(p, LITTER), curve(p, FLOWERS), this.cold);
  }
}
