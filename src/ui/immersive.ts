// Immersive mode: the game fills the screen through the Fullscreen API, so the pointer can no
// longer slip out of the window into the browser's tabs or address bar while scrolling at the
// top edge. Where the browser allows it (Chromium's keyboard lock) the Escape key stays with
// the game too: a tap of Esc still cancels and opens the menu, and holding it leaves fullscreen.
import { prefs, savePrefs } from './prefs';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type KeyboardLock = { lock?(keys?: string[]): Promise<void>; unlock?(): void };

const doc = document as FsDocument;
const root = document.documentElement as FsElement;
const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

/** Whether this browser can put the page in fullscreen at all (iPhones cannot). */
export const immersiveAvailable = !!(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled) && !!(root.requestFullscreen || root.webkitRequestFullscreen);

/** Whether Esc can be kept for the game; elsewhere a tap of Esc leaves fullscreen. */
export const keepsEscape = !!keyboard?.lock;

/** How to get out, for hints: browsers with keyboard lock make the user hold Esc. */
export const leaveHint = keepsEscape ? 'hold Esc to leave' : 'Esc leaves';

export const isImmersive = () => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);

/** Fullscreen needs a recent click or key press; without one the browser refuses (and logs). */
const hasGesture = () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true;

/** Fill the screen. Resolves false when the browser would not allow it (no gesture, unsupported). */
export async function enterImmersive(): Promise<boolean> {
  if (isImmersive()) return true;
  if (!immersiveAvailable || !hasGesture()) return false;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else await root.webkitRequestFullscreen!();
  } catch {
    return false;
  }
  return isImmersive();
}

export async function leaveImmersive() {
  if (!isImmersive()) return;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else await doc.webkitExitFullscreen?.();
  } catch { /* already out */ }
}

export const toggleImmersive = () => (isImmersive() ? leaveImmersive() : enterImmersive());

const listeners = new Set<(on: boolean) => void>();
let last = isImmersive();

/** Fullscreen started or ended, by us, by Esc or by the browser's own controls. */
function changed() {
  const on = isImmersive();
  if (on === last) return;
  last = on;
  // keep Esc for the game while we fill the screen; the promise rejects where the lock is refused
  if (on) keyboard?.lock?.(['Escape']).catch(() => { /* Esc leaves fullscreen as usual */ });
  else keyboard?.unlock?.();
  // the preference follows what the user last chose, so the next game starts the same way
  if (prefs.immersive !== on) {
    prefs.immersive = on;
    savePrefs();
  }
  for (const cb of listeners) cb(on);
}
document.addEventListener('fullscreenchange', changed);
document.addEventListener('webkitfullscreenchange', changed);

export function onImmersiveChange(cb: (on: boolean) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
