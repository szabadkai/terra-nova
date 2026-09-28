// Goods flow: how much of each good a realm makes and uses up, per ten minutes, and which way it is
// going. `PlayerState.produced` counts what workshops and gatherers turn out; `used` counts what goes
// into them (inputs taken, food for the mines, materials built into sites, tools and weapons handed
// out). Once a minute both totals are sampled, so the Economy tab can tell the last ten minutes from
// the ten before. Counting only: no random numbers, so the game plays out exactly as before.
import { GOODS, type Good } from './defs';
import type { Game } from './game';

/** Seconds between samples, and the window the rates are counted over. */
export const FLOW_EVERY = 60;
export const FLOW_WINDOW = 600;
/** Samples kept: two hours, then every other one of the oldest half is dropped, so a long game still charts. */
const FLOW_KEEP = 120;

/** Totals so far, by index into GOODS (arrays keep the saves small). */
export interface FlowSample { t: number; made: number[]; used: number[] }

/** Something of `gd` was used up. */
export function consume(g: Game, owner: number, gd: Good, n = 1) {
  g.players[owner].used[gd] += n;
}

/** Called with the history: a fresh sample once a minute. */
export function sampleFlow(g: Game) {
  for (const p of g.players) {
    const last = p.flow[p.flow.length - 1];
    if (last && g.time - last.t < FLOW_EVERY) continue;
    p.flow.push({ t: g.time, made: GOODS.map((gd) => p.produced[gd]), used: GOODS.map((gd) => p.used[gd]) });
    if (p.flow.length > FLOW_KEEP) {
      const half = p.flow.length >> 1;
      p.flow = [...p.flow.slice(0, half).filter((_s, k) => k % 2 === 0), ...p.flow.slice(half)];
    }
  }
}

/** Totals at time `t`: the latest sample at or before it (the first one, if the game is younger). */
function at(g: Game, owner: number, t: number): FlowSample | null {
  const f = g.players[owner].flow;
  if (!f.length) return null;
  let best = f[0];
  for (const s of f) if (s.t <= t + 1e-6) best = s; else break;
  return best;
}

export interface GoodFlow {
  good: Good;
  /** made and used over the last window (or since the first sample, in a younger game) */
  made: number;
  used: number;
  /** the same over the window before, when there was one */
  prevMade: number | null;
  prevUsed: number | null;
  /** made and used per bucket, oldest first, for a sparkline */
  madeSeries: number[];
  usedSeries: number[];
}

export interface FlowReport {
  /** seconds the rates are counted over: FLOW_WINDOW, or less early in the game */
  span: number;
  goods: Record<Good, GoodFlow>;
}

/** Made and used per good over the last ten minutes, the ten before, and in buckets of `bucket` seconds over the last `buckets` of them. */
export function flowReport(g: Game, owner: number, bucket = 120, buckets = 10): FlowReport {
  const p = g.players[owner];
  const now = g.time;
  const cur: FlowSample = { t: now, made: GOODS.map((gd) => p.produced[gd]), used: GOODS.map((gd) => p.used[gd]) };
  const base = at(g, owner, now - FLOW_WINDOW) ?? cur;
  const prev = p.flow.length && p.flow[0].t <= now - 2 * FLOW_WINDOW + FLOW_EVERY ? at(g, owner, now - 2 * FLOW_WINDOW) : null;
  const marks: FlowSample[] = [];
  for (let k = buckets; k >= 0; k--) marks.push(k ? at(g, owner, now - k * bucket) ?? cur : cur);
  const goods = {} as Record<Good, GoodFlow>;
  GOODS.forEach((gd, i) => {
    const madeSeries: number[] = [], usedSeries: number[] = [];
    for (let k = 1; k < marks.length; k++) {
      madeSeries.push(marks[k].made[i] - marks[k - 1].made[i]);
      usedSeries.push(marks[k].used[i] - marks[k - 1].used[i]);
    }
    goods[gd] = {
      good: gd,
      made: cur.made[i] - base.made[i],
      used: cur.used[i] - base.used[i],
      prevMade: prev && prev !== base ? base.made[i] - prev.made[i] : null,
      prevUsed: prev && prev !== base ? base.used[i] - prev.used[i] : null,
      madeSeries, usedSeries,
    };
  });
  return { span: now - base.t, goods };
}

/** Made and used per `every` seconds over the whole game, for the Statistics chart. */
export function flowHistory(g: Game, owner: number, gd: Good, every = 300): { t: number; made: number; used: number }[] {
  const p = g.players[owner];
  const i = GOODS.indexOf(gd);
  const out: { t: number; made: number; used: number }[] = [];
  if (!p.flow.length) return out;
  const t0 = p.flow[0].t;
  let prev = p.flow[0];
  for (let t = t0 + every; t <= g.time + 1e-6; t += every) {
    const s = at(g, owner, t) ?? prev;
    out.push({ t, made: s.made[i] - prev.made[i], used: s.used[i] - prev.used[i] });
    prev = s;
  }
  return out;
}

/** Which way it is going over the last window against the one before: 1 up, -1 down, 0 about the same (or too soon to say). */
export function trend(now: number, before: number | null): -1 | 0 | 1 {
  if (before === null) return 0;
  const d = now - before;
  if (Math.abs(d) < 2 || Math.abs(d) < 0.15 * Math.max(now, before)) return 0;
  return d > 0 ? 1 : -1;
}
