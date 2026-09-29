// Frame pacing, all of it about time and none of it about the game: the display's refresh period
// measured from requestAnimationFrame, a frame cap that renders every Nth display frame so the frames
// that are shown arrive evenly, and the automatic resolution that takes the world's render scale
// down a step while frames keep missing their display frame and brings it back once they don't.
// One instance (`framePace`) is shared by the main loop, the renderer, the menu and the counter.

/** off, half or a third of the display's rate, or about 60 / 30 frames a second */
export type FrameCap = 'off' | 'half' | 'third' | '60' | '30';

/** Render scales the automatic resolution steps through, from full down. */
export const AUTO_STEPS = [1, 0.92, 0.85];

/** Refresh rates a measured period snaps to when it is within 2% of one (Hz). */
const RATES = [24, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 175, 180, 200, 240, 360];
const MIN_PERIOD = 1000 / 360, MAX_PERIOD = 1000 / 24;
/** a longer pause between frames is the tab hidden or a load, and says nothing about the render */
const GAP = 250;
/** rendered frames the lateness is judged over, and how many late ones in them drop a step */
const WINDOW = 30, DROP_LATE = 8;
/** ms between two drops, and of quiet before a step back up; one stray late frame in that spell
 * (a garbage collection, another tab) does not hold it back */
const DROP_EVERY = 400, RAISE_QUIET = 3000, RAISE_TOLERATE = 1;
/** a raise that is undone within RAISE_SETTLE doubles the wait before the next try, up to RAISE_MAX */
const RAISE_SETTLE = 4000, RAISE_MAX = 30000;
/** frames after a scale change or a resize that are not judged: the targets are being rebuilt */
const SETTLE_FRAMES = 3;
/** a slower display is adopted only after the shortest frame has been this much longer for SLOW_FOR ms */
const SLOW_RATIO = 1.8, SLOW_FOR = 10000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function snap(period: number) {
  const hz = 1000 / period;
  let best = period, off = 0.02;
  for (const r of RATES) {
    const d = Math.abs(hz - r) / r;
    if (d < off) { off = d; best = 1000 / r; }
  }
  return best;
}

export class FramePace {
  cap: FrameCap = 'off';
  /** the automatic resolution is steering (off: the level stays at full) */
  auto = false;
  /** the display's refresh period in ms; from `probe` at boot, then followed while running */
  period = 1000 / 60;
  /** the period as seen with light frames (the probe at boot, or a faster display since): frames
   * that are always heavy can make `period` settle on a slower rate, this never */
  lightPeriod = 1000 / 60;
  /** frames rendered and display frames they missed, since the start (for the counter and tests) */
  rendered = 0;
  missed = 0;
  /** the current automatic step (index into AUTO_STEPS) */
  level = 0;

  private lastTick = -1;
  private lastRender = -1;
  private deltas: number[] = [];
  private prevMed = Infinity;
  private bucketT = -1;
  private slowSince = -1;
  private win: boolean[] = [];
  private lateCount = 0;
  /** when the late frames of the last RAISE_MAX ms were */
  private lates: number[] = [];
  private lastChange = -1;
  private lastRaise = -1;
  private raiseWait = RAISE_QUIET;
  private settle = 0;

  get hz() {
    return Math.round(1000 / this.period);
  }

  /** the render scale the automatic resolution asks for now */
  get scale() {
    return AUTO_STEPS[this.level];
  }

  /** how many display frames each rendered frame is given under the cap */
  every(period = this.period) {
    switch (this.cap) {
      case 'half': return 2;
      case 'third': return 3;
      case '60': return Math.max(1, Math.round(1000 / period / 60));
      case '30': return Math.max(1, Math.round(1000 / period / 30));
      default: return 1;
    }
  }

  /** the frame rate frames that are on time give under the cap, at most 60 (for the low frame rate message) */
  aimFps() {
    return Math.min(60, Math.round(10000 / this.lightPeriod / this.every(this.lightPeriod)) / 10);
  }

  /** frames have been heavy for so long that the period settled on a slower rate than the display's */
  get slowed() {
    return this.period > this.lightPeriod * 1.5;
  }

  /** frames a second the cap gives on this display */
  capFps(cap: FrameCap) {
    const was = this.cap;
    this.cap = cap;
    const n = this.every();
    this.cap = was;
    return Math.round(1000 / this.period / n);
  }

  /**
   * Called at the top of every animation frame with its timestamp: says whether this one is to be
   * rendered. Tracks the display's period from all the callbacks and judges each rendered frame by
   * how many display frames it took.
   */
  due(now: number): boolean {
    const dt = this.lastTick < 0 ? 0 : now - this.lastTick;
    this.lastTick = now;
    if (dt > 0 && dt < GAP) this.track(dt, now);
    const n = this.every();
    const interval = n * this.period;
    if (this.lastRender >= 0) {
      const since = now - this.lastRender;
      // half a display frame of tolerance: a timestamp that comes a touch early still counts
      if (n > 1 && since < interval - this.period * 0.5) return false;
      if (since < GAP) this.judge(since > interval + this.period * 0.5, since, now);
      else this.forget();
    }
    this.lastRender = now;
    this.rendered++;
    return true;
  }

  /** The render targets were rebuilt (a resize or a scale change): the next frames are not judged. */
  resized() {
    this.settle = SETTLE_FRAMES;
  }

  /** Measure the display's refresh period over a few animation frames (before anything heavy runs). */
  probe(frames = 12, timeout = 400): Promise<number> {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'function') return resolve(this.period);
      const ts: number[] = [];
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const d = ts.slice(1).map((t, i) => t - ts[i]).filter((v) => v > 0 && v < GAP).sort((a, b) => a - b);
        if (d.length >= 4) this.period = this.lightPeriod = snap(clamp(d[d.length >> 1], MIN_PERIOD, MAX_PERIOD));
        resolve(this.period);
      };
      const tick = (t: number) => {
        ts.push(t);
        if (ts.length > frames) finish(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(finish, timeout);
    });
  }

  private track(dt: number, now: number) {
    this.deltas.push(dt);
    if (this.bucketT < 0) this.bucketT = now;
    if (now - this.bucketT < 1000) return;
    this.bucketT = now;
    // the usual gap between two callbacks (the median of a second's worth, which the timestamps'
    // jitter does not bias) is the display's period, unless most frames of that second were heavy:
    // then it is a multiple, so the shorter of two seconds counts and a longer period is trusted only slowly
    const d = this.deltas.sort((a, b) => a - b);
    const med = d.length >= 8 ? d[d.length >> 1] : Infinity;
    this.deltas = [];
    const est = Math.min(med, this.prevMed);
    this.prevMed = med;
    if (!isFinite(est)) return;
    const p = snap(clamp(est, MIN_PERIOD, MAX_PERIOD));
    if (p < this.period * 0.9) {
      this.period = p;
      if (p < this.lightPeriod * 0.9) this.lightPeriod = p;
      this.slowSince = -1;
    } else if (p > this.period * SLOW_RATIO) {
      if (this.slowSince < 0) this.slowSince = now;
      else if (now - this.slowSince >= SLOW_FOR) { this.period = p; this.slowSince = -1; }
    } else this.slowSince = -1;
  }

  private judge(late: boolean, took: number, now: number) {
    if (late) this.missed += Math.max(0, Math.round(took / this.period) - this.every());
    if (this.settle > 0) { this.settle--; return; }
    if (!this.auto) { this.level = 0; return; }
    this.win.push(late);
    if (late) { this.lateCount++; this.lates.push(now); }
    if (this.win.length > WINDOW && this.win.shift()) this.lateCount--;
    while (this.lates.length && now - this.lates[0] > RAISE_MAX) this.lates.shift();
    this.steer(now);
  }

  private steer(now: number) {
    if (this.lateCount >= DROP_LATE && this.level < AUTO_STEPS.length - 1 && now - this.lastChange >= DROP_EVERY) {
      // a raise that did not hold: wait longer before trying again
      if (this.lastRaise >= 0 && now - this.lastRaise < RAISE_SETTLE) this.raiseWait = Math.min(RAISE_MAX, this.raiseWait * 2);
      this.lastRaise = -1;
      this.level++;
      this.changed(now);
      return;
    }
    if (this.level > 0 && now - this.lastChange >= this.raiseWait && this.lates.filter((t) => now - t < this.raiseWait).length <= RAISE_TOLERATE) {
      this.level--;
      this.lastRaise = now;
      this.changed(now);
      return;
    }
    // a raise that held is forgiven: the next one waits the usual time again
    if (this.lastRaise >= 0 && now - this.lastRaise >= RAISE_SETTLE) { this.lastRaise = -1; this.raiseWait = RAISE_QUIET; }
  }

  private changed(now: number) {
    this.lastChange = now;
    this.lates.length = 0;
    this.forget();
    this.settle = SETTLE_FRAMES;
  }

  private forget() {
    this.win.length = 0;
    this.lateCount = 0;
  }
}

export const framePace = new FramePace();
