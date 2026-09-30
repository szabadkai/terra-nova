// The campaign's run (CAMPAIGN.md, the rules in game/province.ts): what the province stands at between
// regions - the season, what is held and fortified, Varro's strike, the dispatches, the column that
// marches on - kept in this browser under its own key. None until a campaign is begun.
import type { Carry } from '../game/campaign';
import type { Good } from '../game/defs';
import { REGION_INFO, newProvince, regionWon, strikeHeld, strikeLost, type Difficulty, type ProvinceState, type RegionId } from '../game/province';

const KEY = 'terra-nova.province.v1';

const isRegion = (x: unknown): x is RegionId => typeof x === 'string' && x in REGION_INFO;

function column(c: unknown): Carry | null {
  const v = c as Partial<Carry> | null;
  if (!v || !Array.isArray(v.veterans) || !v.goods || typeof v.goods !== 'object') return null;
  const veterans = v.veterans
    .filter((x) => (x?.job === 'swordsman' || x?.job === 'bowman') && typeof x.level === 'number')
    .map((x) => ({ job: x.job, level: Math.max(0, Math.min(3, Math.floor(x.level))) }));
  const goods: Partial<Record<Good, number>> = {};
  for (const [k, n] of Object.entries(v.goods)) if (typeof n === 'number' && n > 0) goods[k as Good] = Math.floor(n);
  return { veterans, goods };
}

function load(): ProvinceState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<ProvinceState>) : null;
    if (!p || typeof p.seed !== 'number') return null;
    const held = Array.isArray(p.held) ? p.held.filter(isRegion) : [];
    if (!held.includes('castra') && p.end !== 'recalled') held.unshift('castra');
    const fortified: ProvinceState['fortified'] = {};
    for (const [k, n] of Object.entries(p.fortified ?? {})) if (isRegion(k) && typeof n === 'number') fortified[k] = Math.max(0, Math.floor(n));
    return {
      seed: p.seed,
      season: typeof p.season === 'number' ? Math.max(1, Math.floor(p.season)) : 1,
      difficulty: p.difficulty === 0 || p.difficulty === 2 ? p.difficulty : 1,
      held, fortified,
      strike: isRegion(p.strike) ? p.strike : null,
      log: Array.isArray(p.log) ? p.log.filter((l) => l && typeof l.text === 'string').slice(-40).map((l) => ({ season: Number(l.season) || 1, text: l.text, who: l.who === 'varro' ? 'varro' : 'quaestor', ...(typeof l.voice === 'string' ? { voice: l.voice } : {}) })) : [],
      column: column(p.column),
      end: p.end === 'won' || p.end === 'recalled' ? p.end : undefined,
      ledger: { won: Math.max(0, Math.floor(Number(p.ledger?.won) || 0)), held: Math.max(0, Math.floor(Number(p.ledger?.held) || 0)), lost: Math.max(0, Math.floor(Number(p.ledger?.lost) || 0)) },
    };
  } catch {
    return null;
  }
}

/** The campaign under way in this browser, or none. */
export let province: ProvinceState | null = load();

function save() {
  try {
    if (province) localStorage.setItem(KEY, JSON.stringify(province));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
}

/** A campaign begun (over any that was under way). */
export function beginProvince(difficulty: Difficulty) {
  province = newProvince(Math.floor(Math.random() * 1e9) + 1, difficulty);
  save();
  return province;
}

/** The mission a region's campaign is fought in, and the one its defence is. */
export const regionOfMission = (id: string): { region: RegionId; defence: boolean } | null => {
  if (id.startsWith('defence.')) { const r = id.slice(8); return isRegion(r) ? { region: r, defence: true } : null; }
  const r = (Object.keys(REGION_INFO) as RegionId[]).find((x) => REGION_INFO[x].mission === id);
  return r ? { region: r, defence: false } : null;
};

/** A campaign mission won: the region is ours (or kept), the column marches on, Varro moves. */
export function provinceWon(missionId: string, col: Carry) {
  const at = regionOfMission(missionId);
  if (!province || !at) return;
  if (at.defence) { if (province.strike === at.region) strikeHeld(province, col); }
  else regionWon(province, at.region, col);
  save();
}

/** A defence lost, or given up: the region is his again. */
export function provinceLost(missionId?: string) {
  if (!province?.strike) return;
  if (missionId && regionOfMission(missionId)?.region !== province.strike) return;
  strikeLost(province);
  save();
}

/** The dispatches the player has read up to (the newest shown as new until then). */
const SEEN = 'terra-nova.province.seen.v1';
export function dispatchesSeen(): number {
  try { return Number(localStorage.getItem(SEEN) ?? 0) || 0; } catch { return 0; }
}
export function markDispatchesSeen(n: number) {
  try { localStorage.setItem(SEEN, String(n)); } catch { /* storage blocked */ }
}
