// Headless check of the frame pacing (src/render/framePace.ts) against a simulated display: the
// refresh rate is read off the animation-frame timestamps, a frame cap renders every Nth display
// frame at even spacing, and the automatic resolution steps down while frames keep missing their
// display frame, ignores one-off spikes and pauses, comes back once frames are on time again, and
// does not thrash when the full resolution is only just too slow. Nothing here touches the game.
// Usage: npx tsx scripts/framepace.ts
import { AUTO_STEPS, FramePace, type FrameCap } from '../src/render/framePace';

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

interface Run {
  renders: number;
  /** ms between rendered frames */
  gaps: number[];
  /** (time s, level) at every level change */
  changes: [number, number][];
  /** rendered frames that took more display frames than the cap gives them */
  late: number;
  /** share of the run's frames that were rendered at each level */
  share: number[];
}

/**
 * Drives `pace` for `secs` on a display with the given period; the render of a frame costs
 * `cost(t, scale)` ms and the next callback comes at the first display frame after it is done
 * (a cost above one period skips display frames, as the GPU would). Timestamps carry a little jitter.
 */
function run(pace: FramePace, secs: number, period: number, cost: (t: number, scale: number) => number, from = 0): Run {
  const out: Run = { renders: 0, gaps: [], changes: [], late: 0, share: AUTO_STEPS.map(() => 0) };
  let t = Math.ceil(from / period) * period;
  const end = t + secs * 1000;
  let lastRender = -1, lastLevel = pace.level, k = 0;
  while (t < end) {
    const jitter = ((k++ * 7919) % 13) / 13 * 0.25;
    if (pace.due(t + jitter)) {
      out.renders++;
      out.share[pace.level]++;
      if (lastRender >= 0) {
        out.gaps.push(t - lastRender);
        if (t - lastRender > pace.every() * period + period * 0.5) out.late++;
      }
      lastRender = t;
      if (pace.level !== lastLevel) { out.changes.push([(t - from) / 1000, pace.level]); lastLevel = pace.level; }
      const c = cost(t, pace.scale);
      t = (Math.floor((t + c) / period + 1e-6) + 1) * period;
    } else t += period;
  }
  const total = out.share.reduce((a, b) => a + b, 0) || 1;
  out.share = out.share.map((v) => v / total);
  return out;
}

const fresh = (opts: Partial<Pick<FramePace, 'cap' | 'auto' | 'period'>> = {}) => Object.assign(new FramePace(), opts);
const fmt = (r: Run) => `${r.renders} frames, changes ${r.changes.map(([t, l]) => `${t.toFixed(1)}s→${Math.round(AUTO_STEPS[l] * 100)}%`).join(' ') || 'none'}, share ${r.share.map((s) => Math.round(s * 100)).join('/')}%`;

// --- refresh rate from the callbacks
{
  const p = fresh({ period: 1000 / 60 });
  run(p, 4, 1000 / 175, () => 2);
  check(p.hz === 175, `a 175 Hz display is read off cheap frames within 4 s (got ${p.hz} Hz)`);
  run(p, 4, 1000 / 60, () => 2, 4000);
  check(p.hz === 175, `moving to a 60 Hz display is not believed at once (still ${p.hz} Hz after 4 s)`);
  run(p, 10, 1000 / 60, () => 2, 8000);
  check(p.hz === 60, `but it is after ten seconds more (got ${p.hz} Hz)`);
  run(p, 3, 1000 / 175, () => 2, 18000);
  check(p.hz === 175, `and a faster display is taken at once (got ${p.hz} Hz)`);
  const q = fresh({ period: 1000 / 60 });
  run(q, 4, 1000 / 143.9, () => 2);
  check(q.hz === 144, `a measured 143.9 Hz snaps to 144 (got ${q.hz})`);
}

// --- frame cap: rate and spacing
{
  const want: Record<FrameCap, [number, number]> = { off: [175, 60], half: [87.5, 30], third: [58.3, 20], '60': [58.3, 60], '30': [29.2, 30] };
  for (const [hz, col] of [[175, 0], [60, 1]] as const) {
    for (const cap of Object.keys(want) as FrameCap[]) {
      const p = fresh({ cap, period: 1000 / hz });
      const r = run(p, 10, 1000 / hz, () => 2);
      const fps = r.renders / 10;
      const gaps = new Set(r.gaps.map((g) => Math.round(g / (1000 / hz))));
      check(Math.abs(fps - want[cap][col]) < 1 && gaps.size === 1, `cap '${cap}' on ${hz} Hz: ${fps.toFixed(1)} fps (want ${want[cap][col]}), every rendered frame ${[...gaps][0]} display frames apart`);
      check(p.capFps(cap) === Math.round(want[cap][col]), `  and the menu would say ${p.capFps(cap)} fps`);
    }
  }
  // a heavy frame under the cap: the next frame is not brought forward to make up for it
  const p = fresh({ cap: 'half', period: 1000 / 175 });
  const r = run(p, 5, 1000 / 175, (t) => (Math.floor(t / 1000) % 2 === 1 ? 14 : 2));
  const kinds = new Set(r.gaps.map((g) => Math.round(g / (1000 / 175))));
  check(!kinds.has(1), `a heavy stretch under 'half' never renders two display frames in a row (gaps seen: ${[...kinds].sort().join(',')})`);
}

// --- automatic resolution
const P175 = 1000 / 175;
{
  const p = fresh({ auto: true, period: P175 });
  const calm = run(p, 5, P175, () => 3);
  check(calm.changes.length === 0 && p.level === 0, `frames that fit (3 ms at 175 Hz) keep full resolution: ${fmt(calm)}`);
  // 7.5 ms at full: too slow for a display frame even at 92%, fits at 85%
  const busy = run(p, 6, P175, (_t, s) => 7.5 * s * s, 5000);
  const at85 = busy.changes.find(([, l]) => l === 2);
  check(!!at85 && at85[0] < 1.5, `a busy stretch (7.5 ms at full) reaches 85% within 1.5 s: ${fmt(busy)}`);
  check(p.level === 2 && busy.share[2] > 0.85, `  and stays there while it lasts, apart from a short try upwards after a quiet spell`);
  const tail = busy.late;
  check(tail < busy.renders * 0.2, `  with ${tail} of ${busy.renders} frames late in all (the settling)`);
  const calm2 = run(p, 9, P175, () => 3, 11000);
  check(p.level === 0 && calm2.changes.length === 2, `frames that fit again bring it back to full in two quiet steps: ${fmt(calm2)}`);
  const back = calm2.changes[calm2.changes.length - 1];
  check(!!back && back[0] < 9, `  the last one by ${back?.[0].toFixed(1)} s`);
}
{
  // one-off spikes (a 40 ms frame every 2 s) do not move it
  const p = fresh({ auto: true, period: P175 });
  const r = run(p, 12, P175, (t) => (t % 2000 < P175 ? 40 : 3));
  check(r.changes.length === 0, `a 40 ms spike every 2 s is ignored: ${fmt(r)}`);
  // a pause (the tab hidden for a second) neither
  const before = p.rendered;
  p.due(12000 + 1000);
  const r2 = run(p, 3, P175, () => 3, 13000);
  check(r2.changes.length === 0 && p.rendered > before + 3 * 170, `a one-second pause is not a late frame either: ${fmt(r2)}`);
}
{
  // full is only just too slow (6 ms), 92% fits: it must not thrash between the two
  const p = fresh({ auto: true, period: P175 });
  const r = run(p, 60, P175, (_t, s) => 6 * s * s);
  // it tries full again after 3, 6, 12 and 24 quiet seconds (then every 30): four short tries in the first minute
  check(r.changes.length <= 9, `full just too slow, 92% fits: ${r.changes.length} changes in a minute (at most 9): ${fmt(r)}`);
  check(r.share[1] > 0.8, `  and over 80% of the frames were drawn at 92%`);
}
{
  // under a cap, lateness is judged against the cap: 9 ms fits 'half' at 175 Hz
  const p = fresh({ auto: true, cap: 'half', period: P175 });
  const r = run(p, 6, P175, () => 9);
  check(r.changes.length === 0 && r.late === 0, `9 ms frames under 'half' at 175 Hz are on time: ${fmt(r)}`);
  const r2 = run(p, 6, P175, (_t, s) => 14 * s * s, 6000);
  check(p.level === 2, `14 ms frames are not (11.9 ms at 92%, 10.1 at 85%), and it steps down: ${fmt(r2)}`);
}
{
  // no cap and every frame heavy: after ten seconds the display is taken to be half as fast, and the
  // resolution then settles back at full at that even rate rather than sitting at 85% for ever
  const p = fresh({ auto: true, period: P175 });
  const r = run(p, 40, P175, (_t, s) => 8 * s * s);
  check(p.hz >= 87 && p.hz <= 88 && p.level === 0, `always-heavy frames without a cap end at full resolution on a ${p.hz} Hz footing: ${fmt(r)}`);
  check(r.changes.length <= 6, `  without thrashing (${r.changes.length} changes in 40 s)`);
}
{
  // auto off: the level never moves, and switching it on starts from full
  const p = fresh({ auto: false, period: P175 });
  run(p, 5, P175, () => 12);
  check(p.level === 0, `with the automatic resolution off, late frames leave the level at full`);
}
{
  // the probe without requestAnimationFrame (headless) keeps the period it has
  const p = fresh({ period: P175 });
  p.probe().then((v) => check(v === P175 && p.hz === 175, `probe without animation frames keeps the period (${p.hz} Hz)`)).then(() => {
    console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
    process.exit(fails ? 1 : 0);
  });
}
