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
  // a legion's standard: the pole, the cross-bar and the banner hanging from it
  standard: '<path d="M12 20.5V4.8"/><circle cx="12" cy="3.6" r="1.2"/><path d="M6.5 6.8h11"/><path d="M7.5 6.8v8.4l2.2-1.5 2.3 1.5 2.3-1.5 2.2 1.5V6.8"/><path d="M9.8 10.2h4.4"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  check: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3.2"/>' +
    [[9, 9], [15, 9], [12, 12], [9, 15], [15, 15]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25" fill="currentColor" stroke="none"/>`).join(''),
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l2.9 1.9"/>',
  sound: '<path d="M4.5 9.5h3L12 6v12l-4.5-3.5h-3z"/><path d="M15.5 9.3a3.8 3.8 0 0 1 0 5.4M17.9 6.9a7.2 7.2 0 0 1 0 10.2"/>',
  redo: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.8v4.4h4.4"/>',
  shield: '<path d="M12 3.8 19 6.3v5.2c0 4.2-2.9 7.3-7 8.7-4.1-1.4-7-4.5-7-8.7V6.3z"/>',
  // the province's regions
  peak: '<path d="M2.5 19.5 9.2 7.5l3.4 5.6 2.3-3.4 6.6 9.8z"/><path d="m7.5 10.6 1.7 1.7 1.7-1.7"/>',
  pick: '<path d="M4 9.8C7.6 5.2 14 4.2 19.8 7.2"/><path d="M12.4 6.2 7.2 20.6"/>',
  ship: '<path d="M3.5 16h17l-2.3 4.3H5.8z"/><path d="M12 2.8V16"/><path d="M12 4.2 18 13.2h-6"/><path d="m12 6.5-4.8 6.7H12"/>',
  temple: '<path d="M3 9 12 3.8 21 9z"/><path d="M5.5 9.5v7.8M9.2 9.5v7.8M14.8 9.5v7.8M18.5 9.5v7.8"/><path d="M3 20h18M4 17.5h16"/>',
  tower: '<path d="M7 21V9.5h10V21"/><path d="M6 9.5V4.5h2.4v2h2.2v-2h2.8v2h2.2v-2H18v5z"/><path d="M10.4 21v-3.8a1.6 1.6 0 0 1 3.2 0V21"/>',
  // how to play, step by step
  axe: '<path d="M13.5 11.5 5 20a1.6 1.6 0 0 1-2.3-2.3l8.6-8.5"/><path d="M14.8 12.8 9.9 7.9l3.6-3.6 5.1 5.1H21a7.6 7.6 0 0 1-6.2 6.2z"/>',
  sack: '<path d="M9.5 6.5h5M10 6.5 8.8 4.2h6.4L14 6.5"/><path d="M9.6 6.5C6.4 8.6 5 11.6 5 14.8 5 18 7.6 20 12 20s7-2 7-5.2c0-3.2-1.4-6.2-4.6-8.3"/>',
  flag: '<path d="M6 20.5V4"/><path d="M6 4.8h11.5l-2.4 3.6 2.4 3.6H6"/>',
  wheat: '<path d="M12 20.5V8"/>' + [8.8, 12.4, 16].map((y) => `<path d="M12 ${y}c-2.6 0-3.9-1.5-3.9-3.4 2.4 0 3.9 1.2 3.9 3.4zM12 ${y}c2.6 0 3.9-1.5 3.9-3.4-2.4 0-3.9 1.2-3.9 3.4z"/>`).join('') + '<path d="M12 5.4c-.9-.6-1.2-1.4-1.1-2.3.9.3 1.2 1.2 1.1 2.3z"/>',
  sword: '<path d="M9.5 17.5 20 7V4h-3L6.5 14.5"/><path d="M5 13l6 6M8 16l-4 4M3 19l2 2"/>',
  anchor: '<circle cx="12" cy="5.6" r="1.9"/><path d="M12 7.5v13M8.5 10.5h7"/><path d="M4.5 13.5c.4 4 3.5 7 7.5 7s7.1-3 7.5-7"/>',
  crown: '<path d="M4.5 17.5 3.5 8l5 4 3.5-6.5 3.5 6.5 5-4-1 9.5z"/><path d="M5 20.5h14"/>',
  // the map editor's
  brush: '<path d="M13.5 4.5 19.5 10.5 10 20H4v-6z"/><path d="M4 14l6 6"/>',
  undo: '<path d="M19 12a7 7 0 1 0-2.1 5"/><path d="M19 19.2v-4.4h-4.4"/>',
  mountain: '<path d="M3.5 19.5 9.5 8l3.5 5.5 2-3 5.5 9z"/><path d="M8 11l1.5 1.5L11 11"/>',
  tree: '<path d="M12 3.8 6.8 11h2.7l-3.2 5h11.4l-3.2-5h2.7z"/><path d="M12 16v4.5"/>',
  water: '<path d="M3.5 9c2 0 2.5-1.5 4.5-1.5S10.5 9 12.5 9s2.5-1.5 4.5-1.5S19.5 9 21 9"/><path d="M3.5 15c2 0 2.5-1.5 4.5-1.5s2.5 1.5 4.5 1.5 2.5-1.5 4.5-1.5 2.5 1.5 4 1.5"/>',
  save: '<path d="M5 4.5h11l3.5 3.5v11.5H5z"/><path d="M8 4.5v5h7v-5M8 19.5v-6h8v6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 19.5h15"/>',
  trash: '<path d="M5 7h14M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  code: '<path d="m8 8-4.5 4L8 16M16 8l4.5 4L16 16M13.5 5l-3 14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pin: '<path d="M12 21s-6-6.3-6-11a6 6 0 0 1 12 0c0 4.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  new: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M12 10v7M8.5 13.5h7"/>',
  wand: '<path d="M4 20 15 9"/><path d="M15 3.5v2M18.5 5.5 17 7M20.5 9h-2M15 9l1.5 1.5M11.5 5.5 13 7"/>',
  ore: '<path d="M12 3.5 20 9l-3 10H7L4 9z"/><path d="M12 3.5 9.5 9 12 19l2.5-10z"/>',
  deer: '<path d="M8 20v-6l-1.5-4 3-1h5l3 1L16 14v6"/><path d="M9.5 9V5.5M9.5 7H7M14.5 9V5.5M14.5 7h2.5"/>',
  fish: '<path d="M3.5 12c2.5-3.5 5.5-5 9-5s6 2 8 5c-2 3-4.5 5-8 5s-6.5-1.5-9-5z"/><path d="M17 12h3.5M20.5 8.5 17 12l3.5 3.5"/><circle cx="8.5" cy="11" r=".8" fill="currentColor" stroke="none"/>',
  rock: '<path d="M5.5 18.5 4 13l4-5 6-2 5.5 4.5 1 8z"/><path d="M8 8l3.5 5.5 4.5-3"/>',
  spade: '<path d="M12 3.5v7"/><path d="M8 10.5h8l-1.5 5.5c-.5 2-1.5 3-2.5 3s-2-1-2.5-3z"/>',
  level: '<path d="M4 17.5h16M6 13h12M8 8.5h8"/>',
  stairs: '<path d="M4 19.5h4v-4h4v-4h4v-4h4"/>',
  wave: '<path d="M4 12c2.5-4 5.5-4 8 0s5.5 4 8 0"/><path d="M4 17c2.5-4 5.5-4 8 0s5.5 4 8 0" opacity=".5"/>',
  eye: '<path d="M2.5 12c2.6-4 5.8-6 9.5-6s6.9 2 9.5 6c-2.6 4-5.8 6-9.5 6s-6.9-2-9.5-6z"/><circle cx="12" cy="12" r="3"/>',
} as const;

export type GlyphName = keyof typeof P;

/** An icon as markup, `size` pixels square. */
export function glyph(name: GlyphName, size = 20, cls = 'gl'): string {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

/** Every icon, for a look at them side by side. */
export const GLYPHS = Object.keys(P) as GlyphName[];
