// Player preferences (graphics, sound, controls). Kept in localStorage so they survive
// reloads and carry over to every new world.
import { DEFAULT_RENDER_SETTINGS, type GameRenderer, type RenderSettings } from '../render/renderer';
import type { SeasonMode } from '../render/seasons';
import type { Audio } from '../audio/audio';

export interface Prefs {
  render: RenderSettings;
  season: SeasonMode;
  dayLength: number;
  volume: number;
  music: number;
  musicOn: boolean;
  sfx: number;
  ambience: number;
  edgeScroll: boolean;
  scrollSpeed: number;
  showFps: boolean;
}

const KEY = 'terra-nova.prefs.v1';

export const defaultPrefs = (): Prefs => ({
  render: { ...DEFAULT_RENDER_SETTINGS },
  season: 'auto',
  dayLength: 600,
  volume: 0.7,
  music: 1,
  musicOn: true,
  sfx: 1,
  ambience: 1,
  edgeScroll: true,
  scrollSpeed: 1,
  showFps: true,
});

/** Copy saved values over the defaults, skipping anything of the wrong type (old or hand-edited saves). */
function merge(into: Record<string, unknown>, from: unknown) {
  if (!from || typeof from !== 'object') return;
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (cur && typeof cur === 'object') merge(cur as Record<string, unknown>, v);
    else if (k in into && typeof v === typeof cur) into[k] = v;
  }
}

function load(): Prefs {
  const p = defaultPrefs();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) merge(p as unknown as Record<string, unknown>, JSON.parse(raw));
  } catch { /* storage blocked or corrupt: keep the defaults */ }
  return p;
}

export const prefs = load();

export function savePrefs() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* not persisted this time */ }
}

/** Push graphics, world and camera preferences into a (freshly created) renderer. */
export function applyRenderPrefs(gr: GameRenderer) {
  Object.assign(gr.settings, prefs.render);
  gr.seasons.mode = prefs.season;
  gr.sky.dayLength = prefs.dayLength;
  gr.cam.edgeScroll = prefs.edgeScroll;
  gr.cam.scrollSpeed = prefs.scrollSpeed;
  gr.applyQuality();
}

export function applyAudioPrefs(audio: Audio) {
  audio.setVolume(prefs.volume);
  audio.setMusic(prefs.musicOn);
  audio.setMix(prefs.music, prefs.sfx, prefs.ambience);
}
