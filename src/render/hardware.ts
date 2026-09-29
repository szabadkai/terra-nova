// Picking the graphics level for the machine: once, on the first run, and again only when the
// player asks for it in the menu. A guess from what the browser tells about the hardware (the GPU's
// name matched against a table of known classes, the pixels the canvas would render, the cores, the
// memory, a touch screen), confirmed by timing a few frames of the world at that level and stepping
// down while they would miss the frame budget. After that the settings are the player's; while
// playing, the most that happens is one message when the frame rate stays low. Render and prefs
// only: nothing here touches the game.
import type { GameRenderer, Quality, RenderSettings } from './renderer';
import { AUTO_STEPS, framePace } from './framePace';

export const LEVELS: Quality[] = ['low', 'medium', 'high', 'ultra'];

/** The settings a level stands for. The three post effects (bloom, ambient occlusion and the
 * tilt-shift blur) are the heaviest single costs, so they are the first to go. */
export const PRESETS: Record<Quality, Pick<RenderSettings, 'quality' | 'resolution' | 'bloom' | 'dof' | 'ao' | 'grass' | 'reflections'>> = {
  low: { quality: 'low', resolution: '70', bloom: false, dof: false, ao: false, grass: false, reflections: false },
  medium: { quality: 'medium', resolution: '85', bloom: false, dof: false, ao: false, grass: true, reflections: true },
  high: { quality: 'high', resolution: 'auto', bloom: true, dof: true, ao: false, grass: true, reflections: true },
  ultra: { quality: 'ultra', resolution: 'auto', bloom: true, dof: true, ao: false, grass: true, reflections: true },
};
export const LEVEL_NAMES: Record<Quality, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/** the most device pixels per CSS pixel each level draws (as `GameRenderer.applyQuality` sets it) */
const PR_CAP: Record<Quality, number> = { low: 1, medium: 1.25, high: 1.5, ultra: 2 };
/** share of the screen a level's resolution draws: a fixed setting, or the lowest automatic step
 * (a level holds when it holds there: that is what the automatic resolution is for) */
const AUTO_FLOOR = AUTO_STEPS[AUTO_STEPS.length - 1];
const RES: Record<Quality, number> = { low: 0.7, medium: 0.85, high: AUTO_FLOOR, ultra: AUTO_FLOOR };

/**
 * GPU ms of a frame of the world as a new game shows it, at each level on the reference GPU (an
 * Apple M5 Pro, power 1): a part that does not grow with the pixels (the shadow map, vertices,
 * draws) and one per million pixels drawn. Fitted to headless runs at 1280x720 to 3440x1440 and 2x
 * (interleaved, so the levels' ratios hold: Low about half of High, Medium 0.7) and anchored to the
 * 10.5 ms a 30-minute town takes at 3440x1440 on High.
 */
const COST: Record<Quality, [number, number]> = { low: [0.8, 1.5], medium: [1.0, 1.6], high: [1.2, 1.65], ultra: [1.3, 1.75] };
/** a grown town costs this much more than the world of a new game (from 1.1x on big screens to 1.8x on small ones) */
export const LATE = 1.25;

export interface Signals {
  /** the GPU's name as the browser gives it (unmasked where it can) */
  gpu: string;
  /** CSS pixels of the screen, or of the window where that is larger: the most the canvas covers */
  width: number;
  height: number;
  dpr: number;
  /** logical cores, 0 when the browser doesn't say */
  cores: number;
  /** GB of memory (Chrome says 0.25 to 8), 0 when the browser doesn't say */
  memory: number;
  /** a touch screen is the main input (a phone or a tablet) */
  touch: boolean;
}

export interface GpuGuess {
  /** the name, cleaned of the browser's wrapping */
  label: string;
  /** frame rate against the reference GPU; 0 = not known */
  power: number;
  software?: boolean;
}

/** Strip ANGLE's wrapping and the trademark noise: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 3080". */
export function gpuLabel(name: string): string {
  let s = name.trim();
  const angle = /^ANGLE \((?:[^,]*), (.*)\)$/.exec(s);
  if (angle) s = angle[1].replace(/, [^,]*$/, '');
  return s.replace(/ANGLE Metal Renderer: /, '').replace(/ Direct3D.*$| vs_\d.*$| \(0x[0-9a-f]+\)/gi, '').replace(/\((?:R|TM)\)/gi, '')
    .replace(/, or similar$/, '').replace(/\s+/g, ' ').trim() || 'Unknown GPU';
}

const num = (m: RegExpExecArray | null, i = 1) => (m ? Number(m[i]) : 0);

/** How fast a GPU is against the reference, from its name; power 0 when the name says nothing (Safari's "Apple GPU"). */
export function gpuPower(name: string): GpuGuess {
  const label = gpuLabel(name);
  const n = label.toLowerCase();
  const g = (power: number, software = false): GpuGuess => ({ label, power, software });
  if (/swiftshader|llvmpipe|softpipe|basic render|software/.test(n)) return g(0.02, true);
  // Apple silicon: base chips by generation, then Pro / Max / Ultra
  let m = /apple m(\d+)(?: (pro|max|ultra))?/.exec(n);
  if (m) {
    const gen = Number(m[1]);
    const base = [0.26, 0.32, 0.38, 0.46, 0.55][gen - 1] ?? 0.55 + (gen - 5) * 0.1;
    return g(base * ({ pro: 1.8, max: 3.3, ultra: 6 }[m[2] ?? ''] ?? 1));
  }
  if (/^apple gpu$|^apple$/.test(n)) return g(0);
  // NVIDIA: RTX by generation and tier, GTX by model
  m = /rtx ?(20|30|40|50)(\d0)(?: ?(ti|super))?/.exec(n);
  if (m) {
    const gen = { 20: 0.7, 30: 1, 40: 1.35, 50: 1.6 }[Number(m[1])] ?? 1;
    const tier = { 50: 0.45, 60: 0.9, 70: 1.3, 80: 1.7, 90: 2.4 }[Number(m[2])] ?? 0.9;
    return g(gen * tier * (m[3] ? 1.12 : 1) * (/laptop|mobile|max-q/.test(n) ? 0.65 : 1));
  }
  m = /gtx ?(\d{3,4})/.exec(n);
  if (m) {
    const k = Number(m[1]);
    const p = k >= 1600 ? (k >= 1660 ? 0.45 : 0.3) : k >= 1000 ? ({ 1080: 0.6, 1070: 0.5, 1060: 0.4, 1050: 0.2 }[Math.floor(k / 10) * 10] ?? 0.1) : k >= 980 ? 0.42 : k >= 970 ? 0.35 : k >= 960 ? 0.22 : 0.12;
    return g(p);
  }
  if (/\bmx ?\d{3}|\bgt ?\d{3,4}/.test(n)) return g(0.08);
  if (/quadro|rtx a\d{4}|titan|tesla/.test(n)) return g(0.8);
  if (/nvidia|geforce/.test(n)) return g(0.3);
  // AMD: RX by model, integrated Radeon by chip
  m = /rx ?(\d{4})/.exec(n);
  if (m) {
    const k = Number(m[1]);
    const gen = Math.floor(k / 1000), tier = Math.floor((k % 1000) / 100);
    const base = { 5: 0.7, 6: 0.9, 7: 1, 9: 1.3 }[gen] ?? 0.7;
    return g(base * [0.3, 0.3, 0.3, 0.3, 0.35, 0.45, 1, 1.4, 1.8, 2.4][tier] * (/\d{4}m\b|mobile|laptop/.test(n) ? 0.65 : 1));
  }
  m = /rx ?(\d{3})\b/.exec(n);
  if (m) return g(num(m) >= 580 ? 0.42 : num(m) >= 570 ? 0.35 : 0.18);
  if (/radeon.*80[56]0s/.test(n)) return g(0.7);
  if (/radeon.*(890m|880m)/.test(n)) return g(0.28);
  if (/radeon.*(780m|760m|680m)/.test(n)) return g(0.2);
  if (/radeon.*(740m|660m|610m)/.test(n)) return g(0.1);
  if (/radeon pro/.test(n)) return g(0.35);
  if (/radeon.*vega/.test(n)) return g(0.08);
  // the name many Ryzen chips give, from the Vega 3 up to the 780M
  if (/radeon graphics|amd radeon$/.test(n)) return g(0.15);
  if (/radeon|amd/.test(n)) return g(0.25);
  // Intel
  if (/arc.*a7\d\d/.test(n)) return g(0.8);
  if (/arc.*a[35]\d\d/.test(n)) return g(0.4);
  if (/arc.*b\d{3}/.test(n)) return g(0.9);
  if (/intel.*arc|arc graphics/.test(n)) return g(0.22);
  if (/iris.*xe|xe graphics/.test(n)) return g(0.12);
  if (/iris/.test(n)) return g(0.07);
  if (/intel/.test(n)) return g(0.04);
  // phones and tablets
  m = /adreno[^\d]*(\d{3})/.exec(n);
  if (m) { const k = num(m); return g(k >= 740 ? 0.2 : k >= 700 ? 0.15 : k >= 640 ? 0.1 : k >= 600 ? 0.06 : 0.03); }
  if (/immortalis/.test(n)) return g(0.18);
  m = /mali-g(\d+)/.exec(n);
  if (m) { const k = num(m); return g(k >= 700 ? 0.12 : k >= 76 ? 0.08 : 0.04); }
  if (/mali|powervr|img |tegra|videocore/.test(n)) return g(0.03);
  if (/xclipse/.test(n)) return g(0.14);
  return g(0);
}

/** Million pixels a level draws on this screen. */
export function pixelsAt(level: Quality, s: Pick<Signals, 'width' | 'height' | 'dpr'>) {
  const pr = Math.min(s.dpr, PR_CAP[level]);
  return (s.width * pr * RES[level]) * (s.height * pr * RES[level]) / 1e6;
}

/** ms a frame of a new game's world takes at `level` on a GPU of `power` (1 = the reference). */
export function frameMs(level: Quality, s: Pick<Signals, 'width' | 'height' | 'dpr'>, power: number) {
  const [f, k] = COST[level];
  return (f + k * pixelsAt(level, s)) / Math.max(power, 1e-3);
}

/** The frame budget: the display's period, but 60 frames a second at most (nothing needs 175 fps). */
export const budgetMs = (period = framePace.period) => Math.max(period, 1000 / 60);

export interface Guess {
  level: Quality;
  gpu: GpuGuess;
  /** the highest level the device allows (a phone, a tablet, little memory, few cores) and why */
  cap: Quality;
  capWhy: string;
}

/** The level the signals point to, before any timing. */
export function guessLevel(s: Signals, budget = budgetMs()): Guess {
  const gpu = gpuPower(s.gpu);
  let cap: Quality = 'ultra', capWhy = '';
  const lower = (q: Quality, why: string) => { if (LEVELS.indexOf(q) < LEVELS.indexOf(cap)) { cap = q; capWhy = why; } };
  if (s.touch) lower(Math.min(s.width, s.height) < 600 ? 'low' : 'medium', Math.min(s.width, s.height) < 600 ? 'a phone' : 'a tablet');
  // (Safari rounds the cores to 4 or 8 and keeps the memory to itself)
  if ((s.memory && s.memory <= 2) || (s.cores && s.cores <= 2)) lower('low', 'little memory or few cores');
  else if (s.memory && s.memory <= 4) lower('medium', 'little memory');
  if (gpu.software) lower('low', 'no graphics card (software drawing)');
  let level: Quality = 'low';
  // an unknown GPU starts as high as the device allows (but not Ultra): the timing decides
  if (!gpu.power) level = LEVELS.indexOf(cap) < LEVELS.indexOf('high') ? cap : 'high';
  else for (const q of LEVELS) if (LEVELS.indexOf(q) <= LEVELS.indexOf(cap) && frameMs(q, s, gpu.power) * LATE <= budget) level = q;
  return { level, gpu, cap, capWhy };
}

export interface Detected {
  level: Quality;
  /** Low that still misses the budget drops to half resolution */
  resolution?: RenderSettings['resolution'];
  guess: Guess;
  /** [level, ms a frame, as timed and scaled to a grown town on the whole screen] in the order tried */
  timed: [Quality, number][];
}

/** a known GPU is timed down at most this many levels below the guess: a strong machine that is
 * busy at that moment should not end up on Low for ever */
const MAX_STEPS = 2;

/**
 * Confirm a guess by timing: `timeAt(level)` gives the ms a frame would take in a grown town on
 * the whole screen; step down while it misses the budget. Never steps up (the new game's world is
 * the lightest the machine will draw).
 */
export function confirmLevel(guess: Guess, timeAt: (q: Quality) => number, budget = budgetMs()): Detected {
  const timed: [Quality, number][] = [];
  let i = LEVELS.indexOf(guess.level);
  const floor = guess.gpu.power ? Math.max(0, i - MAX_STEPS) : 0;
  for (;;) {
    const q = LEVELS[i];
    const ms = timeAt(q);
    timed.push([q, ms]);
    if (ms <= budget) return { level: q, guess, timed };
    if (i <= floor) return { level: q, resolution: q === 'low' && ms > budget * 1.3 ? '50' : undefined, guess, timed };
    i--;
  }
}

// ------------------------------------------------------------------ browser side

/** What the browser tells about the machine. */
export function readSignals(gl: WebGLRenderingContext | WebGL2RenderingContext): Signals {
  let gpu = String(gl.getParameter(gl.RENDERER) ?? '');
  // Chrome and Safari hide the name behind the extension; Firefox gives it here and warns about the extension
  if (!gpu || /^webkit webgl$|^mozilla$/i.test(gpu)) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? gpu);
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    gpu,
    width: Math.max(screen.width || 0, innerWidth),
    height: Math.max(screen.height || 0, innerHeight),
    dpr: window.devicePixelRatio || 1,
    cores: nav.hardwareConcurrency || 0,
    memory: nav.deviceMemory || 0,
    touch: matchMedia('(pointer: coarse)').matches && nav.maxTouchPoints > 0,
  };
}

/**
 * ms a frame of the world behind takes at `level`: a few frames back to back and one wait for the
 * GPU, the best of three runs, so that a stray hitch elsewhere doesn't count. Leaves the renderer
 * on `level` (over `base` for everything the level doesn't set).
 */
export function timeLevel(gr: GameRenderer, level: Quality, base: RenderSettings, budget = budgetMs()): number {
  Object.assign(gr.settings, base, PRESETS[level]);
  framePace.level = 0;
  gr.applyQuality();
  const gl = gr.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // the first frames after a change rebuild targets and the shadow map
  gr.frame(0, 0);
  gr.frame(0, 0);
  sync();
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const t = performance.now();
    for (let i = 0; i < 4; i++) gr.frame(0, 0);
    sync();
    best = Math.min(best, (performance.now() - t) / 4);
    // far over: no need to make sure
    if (best > budget * 3) break;
  }
  return best;
}

/**
 * The whole detection against a live renderer: guess from the signals, then (unless `timed` is
 * off or the page can't draw) time the world behind at that level and below. `grown` is how far
 * the world in view is from a new game towards a grown town (0 to 1), which the timing allows for.
 * Leaves the renderer on whatever it was last timed at: the caller applies the result.
 */
export function detect(gr: GameRenderer, base: RenderSettings, timed = true, grown = 0): Detected {
  const sig = readSignals(gr.renderer.getContext());
  const budget = budgetMs();
  const guess = guessLevel(sig, budget);
  if (!timed) return { level: guess.level, guess, timed: [] };
  // the canvas may be smaller than the screen it will fill
  const el = gr.renderer.domElement;
  const canvas = { width: el.clientWidth || innerWidth, height: el.clientHeight || innerHeight, dpr: sig.dpr };
  const late = LATE + (1 - LATE) * Math.min(1, Math.max(0, grown));
  return confirmLevel(guess, (q) => {
    const ms = timeLevel(gr, q, base, budget);
    return ms * late * (frameMs(q, sig, 1) / frameMs(q, canvas, 1));
  }, budget);
}

// ------------------------------------------------------------------ while playing

/** a second counts as slow below this share of the frame rate aimed at... */
const LOW_SHARE = 0.75;
/** ...and the message comes after this many slow seconds in a row */
const LOW_FOR = 20;

/**
 * Watches the frame rate while playing, for the one message that says what helps. It speaks at most
 * once (one watch per page), after LOW_FOR seconds in a row below LOW_SHARE of the rate aimed at,
 * and only while the automatic resolution (if it is on) has nothing left to give.
 */
export class LowFpsWatch {
  slow = 0;
  said = false;
  /** Fed once a second; true when the message is due. */
  feed(fps: number, target: number, atFloor: boolean): boolean {
    if (this.said) return false;
    this.slow = atFloor && fps < target * LOW_SHARE ? this.slow + 1 : 0;
    if (this.slow < LOW_FOR) return false;
    this.said = true;
    return true;
  }
}

/** What the low frame rate message suggests, from what is on now; null when nothing is left to turn down. */
export function lowFpsAdvice(s: Pick<RenderSettings, 'bloom' | 'ao' | 'dof' | 'quality' | 'resolution'>): string | null {
  const on = [s.bloom && 'bloom', s.ao && 'ambient occlusion', s.dof && 'the tilt-shift blur'].filter(Boolean) as string[];
  if (on.length) return `Turning off ${on.length > 1 ? `${on.slice(0, -1).join(', ')} or ${on[on.length - 1]}` : on[0]} in the menu helps most.`;
  if (s.quality !== 'low') return 'A lower detail level in the menu helps most.';
  if (s.resolution !== '50') return 'A lower resolution in the menu helps most.';
  return null;
}
