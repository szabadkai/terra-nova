// Line icons for the title screen and the campaign's pages: 24-unit strokes in the text's colour, so
// they take the colour of the button they sit in.
const f2 = (v: number) => v.toFixed(2);
/** A pointed leaf from its stem at (x, y) along the unit direction (dx, dy). */
function leaf(x: number, y: number, dx: number, dy: number, len: number) {
  const w = len * 0.34, mx = x + dx * len * 0.5, my = y + dy * len * 0.5;
  return `<path d="M${f2(x)} ${f2(y)}Q${f2(mx - dy * w)} ${f2(my + dx * w)} ${f2(x + dx * len)} ${f2(y + dy * len)}Q${f2(mx + dy * w)} ${f2(my - dx * w)} ${f2(x)} ${f2(y)}z" fill="currentColor" stroke="none"/>`;
}
/** A laurel wreath open at the top: two boughs round a circle, three pairs of leaves on each and one at its tip. */
function wreath() {
  const r = 7.8, cy = 12.4, rad = Math.PI / 180, lean = 30 * rad;
  let out = '';
  for (const side of [-1, 1]) {
    // (th: 90 at the bottom, 180 at the side, 270 at the top; mirrored for the right bough)
    const at = (th: number) => [12 + side * -Math.cos(th) * r, cy + Math.sin(th) * r];
    const [ax, ay] = at(98 * rad), [bx, by] = at(222 * rad);
    out += `<path d="M${f2(ax)} ${f2(ay)}A${r} ${r} 0 0 ${side < 0 ? 1 : 0} ${f2(bx)} ${f2(by)}"/>`;
    for (const d of [122, 156, 190]) {
      const th = d * rad, [x, y] = at(th);
      // along the bough towards its tip, and away from the middle
      const tx = side * Math.sin(th), ty = Math.cos(th), nx = side * -Math.cos(th), ny = Math.sin(th);
      const c = Math.cos(lean), s = Math.sin(lean);
      out += leaf(x, y, tx * c + nx * s, ty * c + ny * s, 5.2) + leaf(x, y, tx * c - nx * s, ty * c - ny * s, 3.6);
    }
    out += leaf(bx, by, side * Math.sin(222 * rad), Math.cos(222 * rad), 4.9);
  }
  return out;
}

const P = {
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  play: '<path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.9-6.2a.8.8 0 0 0 0-1.4L9.2 5.1a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
  laurel: wreath(),
  map: '<path d="M3.5 6.8 9 4.5l6 2.5 5.5-2.3v12.5L15 19.5l-6-2.5-5.5 2.3z"/><path d="M9 4.5V17M15 7v12.5"/>',
  friends: '<circle cx="9" cy="8.2" r="3.2"/><path d="M3.2 19.5c.4-3.3 2.8-5.6 5.8-5.6s5.4 2.3 5.8 5.6"/><circle cx="16.6" cy="9.2" r="2.5"/><path d="M16.6 14c2.3.1 3.9 2 4.2 4.6"/>',
  book: '<path d="M12 6.6C10 5.2 7.1 4.7 3.8 5v12.8c3.3-.3 6.2.2 8.2 1.6 2-1.4 4.9-1.9 8.2-1.6V5c-3.3-.3-6.2.2-8.2 1.6z"/><path d="M12 6.6v12.8"/>',
  folder: '<path d="M3.5 7.2c0-.9.7-1.7 1.7-1.7h3.9l2 2.2h7.7c.9 0 1.7.8 1.7 1.7v7.9c0 .9-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7z"/><path d="M3.5 10.2h17"/>',
  sliders: '<path d="M4 7h9.5M18.5 7H20M4 17h2.5M11.5 17H20"/><circle cx="16" cy="7" r="2.3"/><circle cx="9" cy="17" r="2.3"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  check: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.2"/>' +
    [[9, 9], [15, 9], [12, 12], [9, 15], [15, 15]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25" fill="currentColor" stroke="none"/>`).join(''),
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l2.9 1.9"/>',
  sound: '<path d="M4.5 9.5h3L12 6v12l-4.5-3.5h-3z"/><path d="M15.5 9.3a3.8 3.8 0 0 1 0 5.4M17.9 6.9a7.2 7.2 0 0 1 0 10.2"/>',
  redo: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.8v4.4h4.4"/>',
  shield: '<path d="M12 3.8 19 6.3v5.2c0 4.2-2.9 7.3-7 8.7-4.1-1.4-7-4.5-7-8.7V6.3z"/>',
  // how to play, step by step
  axe: '<path d="M13.5 11.5 5 20a1.6 1.6 0 0 1-2.3-2.3l8.6-8.5"/><path d="M14.8 12.8 9.9 7.9l3.6-3.6 5.1 5.1H21a7.6 7.6 0 0 1-6.2 6.2z"/>',
  sack: '<path d="M9.5 6.5h5M10 6.5 8.8 4.2h6.4L14 6.5"/><path d="M9.6 6.5C6.4 8.6 5 11.6 5 14.8 5 18 7.6 20 12 20s7-2 7-5.2c0-3.2-1.4-6.2-4.6-8.3"/>',
  flag: '<path d="M6 20.5V4"/><path d="M6 4.8h11.5l-2.4 3.6 2.4 3.6H6"/>',
  wheat: '<path d="M12 20.5V8"/>' + [8.8, 12.4, 16].map((y) => `<path d="M12 ${y}c-2.6 0-3.9-1.5-3.9-3.4 2.4 0 3.9 1.2 3.9 3.4zM12 ${y}c2.6 0 3.9-1.5 3.9-3.4-2.4 0-3.9 1.2-3.9 3.4z"/>`).join('') + '<path d="M12 5.4c-.9-.6-1.2-1.4-1.1-2.3.9.3 1.2 1.2 1.1 2.3z"/>',
  sword: '<path d="M9.5 17.5 20 7V4h-3L6.5 14.5"/><path d="M5 13l6 6M8 16l-4 4M3 19l2 2"/>',
  anchor: '<circle cx="12" cy="5.6" r="1.9"/><path d="M12 7.5v13M8.5 10.5h7"/><path d="M4.5 13.5c.4 4 3.5 7 7.5 7s7.1-3 7.5-7"/>',
  crown: '<path d="M4.5 17.5 3.5 8l5 4 3.5-6.5 3.5 6.5 5-4-1 9.5z"/><path d="M5 20.5h14"/>',
} as const;

export type GlyphName = keyof typeof P;

/** An icon as markup, `size` pixels square. */
export function glyph(name: GlyphName, size = 20, cls = 'gl'): string {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

/** Every icon, for a look at them side by side. */
export const GLYPHS = Object.keys(P) as GlyphName[];
