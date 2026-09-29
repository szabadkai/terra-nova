// Campaign progress: which missions are done and how long each took, kept in this browser under
// its own key (the settings' loader drops record keys it does not know, so this lives apart from prefs).
export interface CampaignProgress {
  /** by mission id: the best time in game seconds, and when it was first done (Date.now()) */
  done: Record<string, { time: number; at: number }>;
  /** the mission last started */
  current?: string;
}

const KEY = 'terra-nova.campaign.v1';

function load(): CampaignProgress {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<CampaignProgress>) : null;
    const done: CampaignProgress['done'] = {};
    if (p && p.done && typeof p.done === 'object') {
      for (const [id, v] of Object.entries(p.done)) {
        if (v && typeof v.time === 'number' && typeof v.at === 'number') done[id] = { time: v.time, at: v.at };
      }
    }
    return { done, current: typeof p?.current === 'string' ? p.current : undefined };
  } catch {
    return { done: {} };
  }
}

export const progress: CampaignProgress = load();

export function saveProgress() {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* storage blocked */ }
}

/** A mission won: kept with its best time. */
export function markDone(id: string, time: number) {
  const was = progress.done[id];
  progress.done[id] = { time: was ? Math.min(was.time, time) : time, at: was?.at ?? Date.now() };
  saveProgress();
}

/** Start the campaign over (the missions stay playable; the ticks go). */
export function resetProgress() {
  progress.done = {};
  progress.current = undefined;
  saveProgress();
}
