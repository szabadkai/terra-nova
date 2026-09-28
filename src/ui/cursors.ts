// Context cursors over the game view: a gilded arrow, crossed swords where a right-click would
// storm, a shield where it would man a stronghold, a barred circle where the men cannot go, a
// reticle while a click picks a target, and turning arrows while the view is being turned.

export type CursorKind = 'default' | 'attack' | 'garrison' | 'nogo' | 'target' | 'orbit' | 'grab';

const INK = '#1d1208';
const GOLD = '#f1d58a';

const ARROW = `
  <path d="M4.5 4 L4.5 25 L10 19.7 L13.6 28.1 L17.4 26.5 L13.9 18.3 L21.5 18.3 Z" fill="#000" opacity=".35"/>
  <path d="M3.5 2.5 L3.5 23.5 L9 18.2 L12.6 26.6 L16.4 25 L12.9 16.8 L20.5 16.8 Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M5.4 7 L5.4 18.6" stroke="#fff7dc" stroke-width="1.1" stroke-linecap="round" opacity=".75"/>`;

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`;
const url = (body: string, x: number, y: number, fallback: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(svg(body))}") ${x} ${y}, ${fallback}`;

const SHIELD = `
  <circle cx="24" cy="24" r="7.2" fill="#15283f" stroke="#cfe6ff" stroke-width="1.4"/>
  <path d="M24 19.4 L28 20.9 L28 23.8 C28 26.4 26.2 28.1 24 28.8 C21.8 28.1 20 26.4 20 23.8 L20 20.9 Z" fill="#7ac8ff" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/>`;

const BARRED = `
  <circle cx="24" cy="24" r="6.4" fill="rgba(0,0,0,.35)" stroke="${INK}" stroke-width="4"/>
  <circle cx="24" cy="24" r="6.4" fill="none" stroke="#ff5a40" stroke-width="2.2"/>
  <path d="M19.6 28.4 L28.4 19.6" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  <path d="M19.6 28.4 L28.4 19.6" stroke="#ff5a40" stroke-width="2.2" stroke-linecap="round"/>`;

/** One sword from the blade tip (x0, y0) to the pommel, drawn with a dark outline. */
const sword = (x0: number, y0: number, sx: number, sy: number) => {
  const p = (t: number) => `${x0 + sx * t} ${y0 + sy * t}`;
  const g0 = `${x0 + sx * 15 - sy * 3} ${y0 + sy * 15 + sx * 3}`, g1 = `${x0 + sx * 15 + sy * 3} ${y0 + sy * 15 - sx * 3}`;
  return `
    <path d="M${p(0)} L${p(15)}" stroke="${INK}" stroke-width="4.6" stroke-linecap="round"/>
    <path d="M${g0} L${g1}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M${p(15)} L${p(20.5)}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M${p(0)} L${p(15)}" stroke="#eef0f4" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M${g0} L${g1}" stroke="#e2b857" stroke-width="2" stroke-linecap="round"/>
    <path d="M${p(15.5)} L${p(20.5)}" stroke="#8a5a2c" stroke-width="2" stroke-linecap="round"/>`;
};

const SWORDS = `
  <circle cx="16" cy="16" r="13.5" fill="rgba(255,70,40,.12)" stroke="#ff5a40" stroke-width="1.4" opacity=".9"/>
  ${sword(4.5, 4.5, 1, 1)}${sword(27.5, 4.5, -1, 1)}`;

const RETICLE = `
  <circle cx="16" cy="16" r="9" fill="none" stroke="${INK}" stroke-width="3.6"/>
  <circle cx="16" cy="16" r="9" fill="none" stroke="${GOLD}" stroke-width="1.8"/>
  <path d="M16 2.5 V9 M16 23 V29.5 M2.5 16 H9 M23 16 H29.5" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M16 3 V9 M16 23 V29 M3 16 H9 M23 16 H29" stroke="${GOLD}" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="1.6" fill="${GOLD}" stroke="${INK}" stroke-width=".8"/>`;

const TURN = `
  <path d="M6.5 13 A10 10 0 0 1 25.5 13" fill="none" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M25.5 19 A10 10 0 0 1 6.5 19" fill="none" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M6.5 13 A10 10 0 0 1 25.5 13" fill="none" stroke="${GOLD}" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M25.5 19 A10 10 0 0 1 6.5 19" fill="none" stroke="${GOLD}" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M29.5 10.5 L26 15.8 L21.5 11.6 Z M2.5 21.5 L6 16.2 L10.5 20.4 Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
  <circle cx="16" cy="16" r="2" fill="${GOLD}" stroke="${INK}" stroke-width="1"/>`;

const CSS: Record<CursorKind, string> = {
  default: url(ARROW, 3, 2, 'default'),
  attack: url(SWORDS, 16, 16, 'crosshair'),
  garrison: url(ARROW + SHIELD, 3, 2, 'pointer'),
  nogo: url(ARROW + BARRED, 3, 2, 'not-allowed'),
  target: url(RETICLE, 16, 16, 'crosshair'),
  orbit: url(TURN, 16, 16, 'move'),
  grab: 'grabbing',
};

/** Keeps an element's cursor in step with the kind asked for, touching the style only on a change. */
export class CursorSetter {
  private cur: CursorKind | null = null;
  constructor(private el: HTMLElement) {}
  set(kind: CursorKind) {
    if (kind === this.cur) return;
    this.cur = kind;
    this.el.style.cursor = CSS[kind];
  }
  get kind() {
    return this.cur;
  }
}
