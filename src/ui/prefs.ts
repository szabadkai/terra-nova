// Player preferences (graphics, sound, controls). Kept in localStorage so they survive
// reloads and carry over to every new world.
import { DEFAULT_RENDER_SETTINGS, type GameRenderer, type Quality, type RenderSettings } from '../render/renderer';
import { PRESETS, detect, type Detected } from '../render/hardware';
import type { SeasonMode } from '../render/seasons';
import type { Audio } from '../audio/audio';
import type { WheelMode } from '../render/camera';
import type { Game } from '../game/game';

export interface Prefs {
  render: RenderSettings;
  season: SeasonMode;
  dayLength: number;
  /** master switch; off by default on the dev server so the game stays quiet while working on it */
  soundOn: boolean;
  volume: number;
  music: number;
  musicOn: boolean;
  sfx: number;
  ambience: number;
  edgeScroll: boolean;
  scrollSpeed: number;
  /** the wheel zooms towards the pointer rather than the middle of the screen */
  zoomToPointer: boolean;
  /** what the scroll wheel or a two-finger swipe does */
  wheel: WheelMode;
  /** what a plain right-drag does to the view */
  rightDrag: 'pan' | 'orbit';
  /** fill the screen (fullscreen) whenever a game starts; follows what the user last chose */
  immersive: boolean;
  showFps: boolean;
  /** badges over stalled buildings: only the few that hold up the most, all of them, or none */
  stallBadges: 'top' | 'all' | 'off';
  /** a toast when a mine runs dry, nobody is free for a job or a tool is missing */
  stallAlerts: boolean;
  /** what the graphics detection found: the level it recommends ('' = it never ran), the
   * resolution it went with, the GPU it saw, the ms a frame it timed, and whether the player has
   * been told what it chose */
  hw: { level: '' | Quality; /** with the level's ambient occlusion */ ao: boolean; res: string; gpu: string; ms: number; told: boolean };
}

const KEY = 'terra-nova.prefs.v1';

export const defaultPrefs = (): Prefs => ({
  render: { ...DEFAULT_RENDER_SETTINGS },
  season: 'auto',
  dayLength: 600,
  soundOn: !import.meta.env.DEV,
  volume: 0.7,
  music: 1,
  musicOn: true,
  sfx: 1,
  ambience: 1,
  edgeScroll: true,
  scrollSpeed: 1,
  zoomToPointer: true,
  wheel: 'auto',
  rightDrag: 'pan',
  immersive: false,
  showFps: true,
  stallBadges: 'top',
  stallAlerts: true,
  hw: { level: '', ao: false, res: '', gpu: '', ms: 0, told: true },
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

/** No graphics settings were saved: the first run in this browser, when the detection picks them. */
export let firstRun = true;

function load(): Prefs {
  const p = defaultPrefs();
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved) merge(p as unknown as Record<string, unknown>, saved);
    if (!(p.hw.level in PRESETS)) p.hw.level = '';
    firstRun = !saved?.render;
  } catch { /* storage blocked or corrupt: keep the defaults */ }
  return p;
}

export const prefs = load();

export function savePrefs() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* not persisted this time */ }
}

/** The graphics settings a reset goes back to: the defaults, at the level picked for this machine. */
export function defaultRender(): RenderSettings {
  const hw = prefs.hw;
  const r: RenderSettings = { ...DEFAULT_RENDER_SETTINGS, ...(hw.level ? PRESETS[hw.level] : {}) };
  if (hw.level) r.ao = hw.ao;
  if (hw.level && hw.res) r.resolution = hw.res as RenderSettings['resolution'];
  return r;
}

/**
 * Pick the graphics for this machine (src/render/hardware.ts) and make them the player's: the
 * detail level, resolution and effects; the world and interface settings stay. `timed` renders a
 * few frames of the world behind at each level tried (skipped while the page is hidden).
 */
export function detectGraphics(gr: GameRenderer, game: Game, timed = true): Detected {
  const base = { ...prefs.render };
  // a grown town is heavier than a new game's world: the timing allows for what is still to come
  const grown = Math.min(1, game.buildings.size / 120);
  const d = detect(gr, base, timed && document.visibilityState === 'visible', grown);
  prefs.render = { ...base, ...PRESETS[d.level], ao: d.ao };
  if (d.resolution) prefs.render.resolution = d.resolution;
  const ms = d.timed.find(([q, , ao]) => q === d.level && ao === d.ao)?.[1] ?? 0;
  prefs.hw = { level: d.level, ao: d.ao, res: prefs.render.resolution, gpu: d.guess.gpu.label, ms: Math.round(ms * 10) / 10, told: prefs.hw.told };
  savePrefs();
  applyRenderPrefs(gr);
  return d;
}

/** Push graphics, world and camera preferences into a (freshly created) renderer. */
export function applyRenderPrefs(gr: GameRenderer) {
  Object.assign(gr.settings, prefs.render);
  gr.seasons.mode = prefs.season;
  gr.sky.dayLength = prefs.dayLength;
  applyControlPrefs(gr);
  gr.applyQuality();
}

export function applyControlPrefs(gr: GameRenderer) {
  gr.cam.edgeScroll = prefs.edgeScroll;
  gr.cam.scrollSpeed = prefs.scrollSpeed;
  gr.cam.zoomToPointer = prefs.zoomToPointer;
  gr.cam.wheelMode = prefs.wheel;
  gr.cam.rightDrag = prefs.rightDrag;
}

export function applyAudioPrefs(audio: Audio) {
  audio.setVolume(prefs.soundOn ? prefs.volume : 0);
  // music off as well, so the soundtrack stops streaming rather than playing silently
  audio.setMusic(prefs.soundOn && prefs.musicOn);
  audio.setMix(prefs.music, prefs.sfx, prefs.ambience);
}
