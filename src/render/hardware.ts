// Picking the graphics level for the machine: once, on the first run, and again only when the
// player asks for it in the menu. A guess from what the browser tells about the hardware (the GPU's
// name matched against a table of known classes, the pixels the canvas would render, the cores, the
// memory, a touch screen), confirmed by timing a few frames of the world at that level and stepping
// down while they would miss the frame budget. After that the settings are the player's; while
// playing, the most that happens is one message when the frame rate stays low. Render and prefs
// only: nothing here touches the game.
//
// The levels are steps on a ladder of settings ("rungs", RUNGS). Ambient occlusion is reserved for
// Ultra by default; High is the cool-laptop target and leaves the effect as an explicit choice.
//
// A low machine (one the ladder takes down to Low) aims at LOW_FPS (30) frames a second instead of
// 60: Low is judged against that budget and the frame cap is set to match, so the card idles half
// of every frame rather than straining for 60, and Low drops to half resolution only when it misses
// even that.
//
// A machine that runs on a battery (a laptop, a tablet, a phone: `Signals.portable`) is fitted for
// quiet rather than for the last frame: quiet mode (RenderSettings.quiet, which caps the device
// pixels drawn at QUIET_PR and rests the frames while nothing is touched) and half the frame budget,
// so the graphics card idles most of every frame and the fans stay off.
import type { GameRenderer, Quality, RenderSettings } from './renderer';
import { AUTO_STEPS, LOW_STEPS, framePace } from './framePace';

export const LEVELS: Quality[] = ['low', 'medium', 'high', 'ultra'];

/** The settings a level stands for. Ambient occlusion is the heaviest single effect and the first
 * to go; bloom and the tilt-shift blur (6-16% of a frame between them) are off at every level and
 * left to the player, since the fans of a laptop notice them more than the eye does. */
export const PRESETS: Record<Quality, Pick<RenderSettings, 'quality' | 'resolution' | 'bloom' | 'dof' | 'ao' | 'grass' | 'reflections'>> = {
  low: { quality: 'low', resolution: 'auto', bloom: false, dof: false, ao: false, grass: false, reflections: false },
  medium: { quality: 'medium', resolution: '85', bloom: false, dof: false, ao: false, grass: true, reflections: true },
  high: { quality: 'high', resolution: 'auto', bloom: false, dof: false, ao: false, grass: true, reflections: true },
  ultra: { quality: 'ultra', resolution: 'auto', bloom: false, dof: false, ao: true, grass: true, reflections: true },
};
/** the most device pixels per CSS pixel quiet mode draws (a 2x laptop screen is four times the pixels of 1x) */
export const QUIET_PR = 1.25;
/** Quiet Auto starts one small resolution step below full to leave deliberate GPU headroom. */
export const QUIET_SCALE = 0.92;
/** the share of the frame budget a portable machine is fitted to: the card idles the rest of each frame */
export const QUIET_SHARE = 0.5;
/** frames a second a low machine aims at (a level above Low aims at 60) */
export const LOW_FPS = 30;

/** frames a second the detection aims at on a level */
export const fpsFor = (level: Quality) => (level === 'low' ? LOW_FPS : 60);
/** the budget a level is judged against: Low's is for LOW_FPS */
const budgetFor = (level: Quality, budget: number) => budget * (60 / fpsFor(level));
export const LEVEL_NAMES: Record<Quality, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/** A level with or without the ambient occlusion its preset carries: one step of the ladder. */
export interface Rung { level: Quality; ao: boolean }
/** Everything the detection can land on, best first: a level with its occlusion, then without. */
export const RUNGS: Rung[] = [...LEVELS].reverse().flatMap((level): Rung[] => PRESETS[level].ao ? [{ level, ao: true }, { level, ao: false }] : [{ level, ao: false }]);

/** A level's name, and what the detection had to leave off ("High without ambient occlusion"); Low says its frame rate. */
export function levelText(level: Quality, ao: boolean) {
  return LEVEL_NAMES[level] + (PRESETS[level].ao && !ao ? ' without ambient occlusion' : '') + (fpsFor(level) !== 60 ? ` at ${fpsFor(level)} frames a second` : '');
}

/** the most device pixels per CSS pixel each level draws (as `GameRenderer.applyQuality` sets it) */
const PR_CAP: Record<Quality, number> = { low: 1, medium: 1.25, high: 1.5, ultra: 2 };
/** share of the screen a level's resolution draws: a fixed setting, or the lowest automatic step
 * (a level holds when it holds there: that is what the automatic resolution is for) */
const AUTO_FLOOR = AUTO_STEPS[AUTO_STEPS.length - 1];
const RES: Record<Quality, number> = { low: LOW_STEPS[LOW_STEPS.length - 1], medium: 0.85, high: AUTO_FLOOR, ultra: AUTO_FLOOR };

/**
 * GPU ms of a frame of the world as a new game shows it, at each level on the reference GPU (an
 * Apple M5 Pro, power 1): a part that does not grow with the pixels (the shadow map, vertices,
 * draws) and one per million pixels drawn. Fitted to headless runs at 1280x720 to 3440x1440 and 2x
 * (interleaved, so the levels' ratios hold: Low about half of High, Medium 0.7) and anchored to the
 * 10.5 ms a 30-minute town takes at 3440x1440 on High.
 */
const COST: Record<Quality, [number, number]> = { low: [0.8, 1.5], medium: [1.0, 1.6], high: [1.2, 1.65], ultra: [1.3, 1.75] };
/**
 * What ambient occlusion adds, in the same terms. It works at half size from the depth the scene
 * leaves (postfx.ts), so almost all of it grows with the pixels: timed against no occlusion and
 * against the old full-size pass that drew the scene a second time (interleaved, High, a 25-minute
 * town at 1280x720 to 3440x1440 and 2x), it costs 0.13 to 0.26 of what that did, a frame 1.04 to
 * 1.21 times as long; that old pass (+3 ms at 1600x900 and +8 ms at 3440x1440 on an idle machine)
 * is what these are scaled from.
 */
const AO_COST: [number, number] = [0.05, 0.35];
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
  /** runs on a battery (a laptop, a tablet or a phone), as far as the browser lets on: see portable() */
  portable: boolean;
}

/** what the Battery API said at boot (Chrome and Edge; nothing elsewhere) */
let battery: { charging: boolean; level: number } | null = null;

/** Ask the browser about a battery once, early, so that readSignals can answer at once. */
export function probeBattery(): Promise<void> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> };
  if (typeof nav.getBattery !== 'function') return Promise.resolve();
  return nav.getBattery().then((b) => { battery = { charging: b.charging, level: b.level }; }, () => undefined);
}

/**
 * Whether this machine runs on a battery. Sure signs: a battery that is not full or is discharging
 * (a desktop's, when the browser reports one at all, is always full and charging), a touch screen,
 * a GPU with a laptop's name. A likely one: a dense screen (1.25x and up) no larger than a laptop's,
 * up to 1800 CSS pixels wide (a 16-inch MacBook Pro is 1728, a 4K desktop monitor at 150% is 2560).
 */
export function portable(s: Pick<Signals, 'gpu' | 'width' | 'height' | 'dpr' | 'touch'>, bat = battery): boolean {
  if (bat && (!bat.charging || bat.level < 1)) return true;
  if (s.touch) return true;
  if (/laptop|mobile|max-q|\biris\b|xe graphics|\d{3,4}m\b/i.test(gpuLabel(s.gpu))) return true;
  return s.dpr >= 1.25 && Math.max(s.width, s.height) <= 1800;
}

/** A GPU that shades every fragment in the order drawn (desktop and laptop Intel, AMD and NVIDIA
 * graphics), as against a tile-based one that shades only the frontmost (Apple's, and the phones'). */
export function immediateMode(name: string): boolean {
  const n = gpuLabel(name).toLowerCase();
  if (/apple|mali|adreno|powervr|immortalis|xclipse|videocore|tegra|swiftshader|llvmpipe/.test(n)) return false;
  return /intel|\biris\b|\barc\b|nvidia|geforce|quadro|\brtx\b|\bgtx\b|radeon|\bamd\b|\bati\b/.test(n);
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

/** Million pixels a level draws on this screen (in quiet mode, at most QUIET_PR device pixels per CSS pixel). */
export function pixelsAt(level: Quality, s: Pick<Signals, 'width' | 'height' | 'dpr'>, quiet = false) {
  const pr = Math.min(s.dpr, PR_CAP[level], quiet ? QUIET_PR : Infinity);
  const scale = RES[level] * (quiet && (level === 'high' || level === 'ultra') ? QUIET_SCALE : 1);
  return (s.width * pr * scale) * (s.height * pr * scale) / 1e6;
}

/** ms a frame of a new game's world takes at `level` (with or without its occlusion) on a GPU of `power` (1 = the reference). */
export function frameMs(level: Quality, s: Pick<Signals, 'width' | 'height' | 'dpr'>, power: number, ao = PRESETS[level].ao, quiet = false) {
  const [f, k] = COST[level];
  const [af, ak] = ao ? AO_COST : [0, 0];
  return (f + af + (k + ak) * pixelsAt(level, s, quiet)) / Math.max(power, 1e-3);
}

/** The frame budget: the display's period, but 60 frames a second at most (nothing needs 175 fps). */
export const budgetMs = (period = framePace.period) => Math.max(period, 1000 / 60);

export interface Guess {
  level: Quality;
  /** with the level's ambient occlusion (only levels that have one) */
  ao: boolean;
  /** fitted for quiet: a portable machine (QUIET_SHARE of the budget, quiet mode's pixel cap) */
  quiet: boolean;
  gpu: GpuGuess;
  /** the highest level the device allows (a phone, a tablet, little memory, few cores) and why */
  cap: Quality;
  capWhy: string;
}

/** The level the signals point to, before any timing. */
export function guessLevel(s: Signals, budget = budgetMs()): Guess {
  const gpu = gpuPower(s.gpu);
  const quiet = s.portable;
  if (quiet) budget *= QUIET_SHARE;
  let cap: Quality = 'ultra', capWhy = '';
  const lower = (q: Quality, why: string) => { if (LEVELS.indexOf(q) < LEVELS.indexOf(cap)) { cap = q; capWhy = why; } };
  if (s.touch) lower(Math.min(s.width, s.height) < 600 ? 'low' : 'medium', Math.min(s.width, s.height) < 600 ? 'a phone' : 'a tablet');
  // (Safari rounds the cores to 4 or 8 and keeps the memory to itself)
  if ((s.memory && s.memory <= 2) || (s.cores && s.cores <= 2)) lower('low', 'little memory or few cores');
  else if (s.memory && s.memory <= 4) lower('medium', 'little memory');
  if (gpu.software) lower('low', 'no graphics card (software drawing)');
  const top = LEVELS.indexOf(cap);
  // an unknown GPU starts as high as the device allows (but not Ultra): the timing decides
  const start = !gpu.power ? RUNGS.find((r) => LEVELS.indexOf(r.level) <= Math.min(top, LEVELS.indexOf('high'))) : RUNGS.find((r) => LEVELS.indexOf(r.level) <= top && frameMs(r.level, s, gpu.power, r.ao, quiet) * LATE <= budgetFor(r.level, budget));
  const { level, ao } = start ?? RUNGS[RUNGS.length - 1];
  return { level, ao, quiet, gpu, cap, capWhy };
}

export interface Detected {
  level: Quality;
  /** frames a second the level aims at (fpsFor): the frame cap to set */
  fps: number;
  /** the level's ambient occlusion is on (false where the machine can't hold it, or the level has none) */
  ao: boolean;
  /** quiet mode: a portable machine (the guess's `quiet`) */
  quiet: boolean;
  /** Low that still misses the budget drops to half resolution */
  resolution?: RenderSettings['resolution'];
  guess: Guess;
  /** [level, ms a frame, with occlusion, as timed and scaled to a grown town on the whole screen] in the order tried */
  timed: [Quality, number, boolean][];
}

/** a known GPU is timed down at most this many levels below the guess: a strong machine that is
 * busy at that moment should not end up on Low for ever */
const MAX_STEPS = 2;

/**
 * Confirm a guess by timing: `timeAt(level, ao)` gives the ms a frame would take in a grown town on
 * the whole screen; step down the ladder (the occlusion of a level first, then the level) while it
 * misses the budget. Never steps up (the new game's world is the lightest the machine will draw).
 */
export function confirmLevel(guess: Guess, timeAt: (q: Quality, ao: boolean) => number, budget = budgetMs()): Detected {
  const timed: [Quality, number, boolean][] = [];
  const quiet = guess.quiet;
  if (quiet) budget *= QUIET_SHARE;
  let i = RUNGS.findIndex((r) => r.level === guess.level && r.ao === guess.ao);
  // a known GPU is timed down to this level, every step of it included
  const floor = guess.gpu.power ? Math.max(0, LEVELS.indexOf(guess.level) - MAX_STEPS) : 0;
  for (;;) {
    const { level, ao } = RUNGS[i];
    const ms = timeAt(level, ao);
    timed.push([level, ms, ao]);
    const b = budgetFor(level, budget);
    if (ms <= b) return { level, fps: fpsFor(level), ao, quiet, guess, timed };
    const next = RUNGS[i + 1];
    if (!next || LEVELS.indexOf(next.level) < floor) return { level, fps: fpsFor(level), ao, quiet, resolution: level === 'low' && ms > b * 1.3 ? '50' : undefined, guess, timed };
    i++;
  }
}

// ------------------------------------------------------------------ browser side

/** What the browser tells about the machine. */
/** The GPU's name as the browser gives it. */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  let gpu = String(gl.getParameter(gl.RENDERER) ?? '');
  // Chrome and Safari hide the name behind the extension; Firefox gives it here and warns about the extension
  if (!gpu || /^webkit webgl$|^mozilla$/i.test(gpu)) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? gpu);
  }
  return gpu;
}

export function readSignals(gl: WebGLRenderingContext | WebGL2RenderingContext): Signals {
  const gpu = gpuName(gl);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const s = {
    gpu,
    width: Math.max(screen.width || 0, innerWidth),
    height: Math.max(screen.height || 0, innerHeight),
    dpr: window.devicePixelRatio || 1,
    cores: nav.hardwareConcurrency || 0,
    memory: nav.deviceMemory || 0,
    touch: matchMedia('(pointer: coarse)').matches && nav.maxTouchPoints > 0,
  };
  return { ...s, portable: portable(s) };
}

/**
 * ms a frame of the world behind takes at `level`: a few frames back to back and one wait for the
 * GPU, the best of three runs, so that a stray hitch elsewhere doesn't count. Leaves the renderer
 * on `level` (over `base` for everything the level doesn't set) with or without its occlusion.
 */
export function timeLevel(gr: GameRenderer, level: Quality, ao: boolean, base: RenderSettings, budget = budgetMs()): number {
  Object.assign(gr.settings, base, PRESETS[level], { ao });
  framePace.level = 0;
  gr.applyQuality();
  const gl = gr.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // the first frames after a change rebuild targets and the shadow map (and compile the occlusion's shaders)
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
  const quiet = guess.quiet;
  // (the levels are timed as quiet mode would draw them)
  base = { ...base, quiet };
  if (!timed) return { level: guess.level, fps: fpsFor(guess.level), ao: guess.ao, quiet, guess, timed: [] };
  // the canvas may be smaller than the screen it will fill
  const el = gr.renderer.domElement;
  const canvas = { width: el.clientWidth || innerWidth, height: el.clientHeight || innerHeight, dpr: sig.dpr };
  const late = LATE + (1 - LATE) * Math.min(1, Math.max(0, grown));
  return confirmLevel(guess, (q, ao) => {
    const ms = timeLevel(gr, q, ao, base, budgetFor(q, budget));
    return ms * late * (frameMs(q, sig, 1, ao, quiet) / frameMs(q, canvas, 1, ao, quiet));
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
  // (the costliest first)
  const on = [s.ao && 'ambient occlusion', s.bloom && 'bloom', s.dof && 'the tilt-shift blur'].filter(Boolean) as string[];
  if (on.length) return `Turning off ${on.length > 1 ? `${on.slice(0, -1).join(', ')} or ${on[on.length - 1]}` : on[0]} in the menu helps most.`;
  if (s.quality !== 'low') return 'A lower detail level in the menu helps most.';
  // (Low's automatic resolution is at half by the time the message comes)
  if (s.resolution !== '50' && !(s.quality === 'low' && s.resolution === 'auto')) return 'A lower resolution in the menu helps most.';
  return null;
}
