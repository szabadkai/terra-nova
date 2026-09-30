// The campaign's page of the title screen: the province of Terra Nova as an old chart (provinceMap.ts
// draws it: coast, territories, the ground of each region), its twelve regions washed in their holder's
// colour (gold ours, crimson Varro's, ochre the tribes'), joined by their roads, Varro's fortifications
// and his strike marked; beside it the region picked, what holding it gives, and the way in. A region
// is picked by its seal or anywhere on its ground. Reads the run (ui/provinceStore.ts), never writes it:
// the hooks do.
import { missionById } from '../game/campaign';
import {
  REGION_INFO, REGION_IDS, TO_THE_FINALE, beyond, frontier, holds, startOf,
  type Difficulty, type ProvinceState, type RegionId,
} from '../game/province';
import { QUAESTOR_ICON, VARRO_ICON, columnChips, type SavedMission } from './campaign';
import { glyph, type GlyphName } from './glyphs';
import { MAP_H, MAP_W, compass, geography, plateauRim, sheetDefs } from './provinceMap';
import type { MenuPage } from './menu';
import { numeralOf } from '../game/campaign';

const ICON: Record<RegionId, GlyphName> = {
  castra: 'standard', silva: 'tree', saltus: 'peak', aestuarium: 'anchor', vallis: 'wheat', metalla: 'pick',
  collis: 'flag', insulae: 'ship', litus: 'sword', ara: 'temple', castellum: 'tower', novaostia: 'crown',
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const h = (tag: string, cls = '', html = '') => { const el = document.createElement(tag); if (cls) el.className = cls; if (html) el.innerHTML = html; return el; };
const DIFFICULTY = [
  { name: 'Easy', line: 'Smaller raids, a slower governor.' },
  { name: 'Normal', line: 'The campaign as it is written.' },
  { name: 'Hard', line: 'Bigger raids, a sharper governor, and he strikes more often.' },
];

// ------------------------------------------------------------------ the chart
/** The sheet itself, made once (provinceMap.ts): paper, sea, coast, territories, ground, borders; the dynamic layer is `chartMarks`. */
function chartSheet(): string {
  const G = geography();
  const defs = REGION_IDS.map((r) => `<path id="pvr-${r}" d="${G.regions[r]}"/><clipPath id="pvc-${r}"><use href="#pvr-${r}"/></clipPath>`).join('');
  const regions = REGION_IDS.map((r) => `<g class="pv-reg" data-r="${r}"><use href="#pvr-${r}" class="pv-fill"/><use href="#pvr-${r}" class="pv-band" clip-path="url(#pvc-${r})"/></g>`).join('');
  return `<svg class="pv-chart" viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="The province of Terra Nova">
    <defs>${sheetDefs()}<clipPath id="pvm-landclip"><path d="${G.land}" clip-rule="evenodd"/></clipPath>${defs}
      <marker id="pv-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#a8261c"/></marker></defs>
    <rect class="pvm-sea pvm-fit" width="${MAP_W}" height="${MAP_H}"/>
    ${compass(50, 52, 30)}
    ${G.ripples.map((d, k) => `<path class="pvm-ripple r${k}" d="${d}"/>`).join('')}
    <g class="pvm-marks-sea">${G.features.split('<use').filter((u) => u.includes('pvm-sea')).map((u) => `<use${u}`).join('')}</g>
    <path class="pvm-land" d="${G.land}" fill-rule="evenodd"/>
    <g clip-path="url(#pvm-landclip)">
      <g class="pv-regs">${regions}</g>
      <path class="pvm-coastshade" d="${G.land}"/>
      ${G.rivers.map((d) => `<path class="pvm-river-under" d="${d}"/><path class="pvm-river" d="${d}"/>`).join('')}
      <path class="pvm-border-under" d="${G.borders}"/><path class="pvm-border" d="${G.borders}"/>
      ${plateauRim()}
      <g class="pvm-marks">${G.features.split('<use').filter((u) => u && !u.includes('pvm-sea')).map((u) => `<use${u}`).join('')}</g>
    </g>
    <path class="pvm-coast" d="${G.land}" fill-rule="evenodd"/>
    <g class="pv-lines"></g>
    <rect class="pvm-grain pvm-fit" width="${MAP_W}" height="${MAP_H}" filter="url(#pvm-paper)"/>
    <rect class="pvm-grain pvm-fit" width="${MAP_W}" height="${MAP_H}" filter="url(#pvm-stain)"/>
    <rect class="pvm-fit" width="${MAP_W}" height="${MAP_H}" fill="url(#pvm-vignette)" pointer-events="none"/>
    <text class="pvm-seaname" transform="translate(40 330) rotate(-90)">Mare Occidentale</text>
    <text class="pvm-seaname" x="390" y="604">Mare Australe</text>
    <text class="pvm-seaname" x="560" y="16">Mare Septentrionale</text>
    <g class="pvm-cartouche" transform="translate(910 572)"><rect x="-72" y="-31" width="144" height="62" rx="3"/><rect x="-68" y="-27" width="136" height="54" rx="2" class="in"/>
      <text x="1.2" y="-15" class="k">Provincia</text><text x="1" y="2" class="t">Terra Nova</text><path d="M-30,10 h60" class="bar"/><path d="M-30,7 v6 M-15,8 v4 M0,7 v6 M15,8 v4 M30,7 v6" class="bar"/><text y="22" class="s">XX milia</text></g>
    <rect class="pvm-frame pvm-fit" data-inset="3" width="${MAP_W}" height="${MAP_H}"/><rect class="pvm-frame in pvm-fit" data-inset="8" width="${MAP_W}" height="${MAP_H}"/>
    <g class="pv-dyn"></g>
  </svg>`;
}

/** The sheet widened (or heightened) into open sea until it fills its panel, the chart itself kept whole in the middle. */
function fitSheet(box: HTMLElement) {
  const svg = box.querySelector('svg');
  const w = box.clientWidth, h = box.clientHeight;
  if (!svg || !w || !h) return;
  let vx = 0, vy = 0, vw = MAP_W, vh = MAP_H;
  if (h / w > MAP_H / MAP_W) { vh = MAP_W * (h / w); vy = -(vh - MAP_H) / 2; } else { vw = MAP_H * (w / h); vx = -(vw - MAP_W) / 2; }
  svg.setAttribute('viewBox', `${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);
  svg.querySelectorAll<SVGRectElement>('.pvm-fit').forEach((r) => {
    const k = Number(r.dataset.inset ?? 0);
    r.setAttribute('x', (vx + k).toFixed(1)); r.setAttribute('y', (vy + k).toFixed(1));
    r.setAttribute('width', (vw - 2 * k).toFixed(1)); r.setAttribute('height', (vh - 2 * k).toFixed(1));
  });
}

/** The chart's changing part: who holds what, the roads, Varro's strike, the seals. */
function chartMarks(svg: SVGSVGElement, s: ProvinceState | null, sel: RegionId, open: Set<RegionId>, drawnIds: Set<RegionId>) {
  const held = (r: RegionId) => (s ? holds(s, r) : r === 'castra');
  const colour = (r: RegionId) => held(r) ? 'you' : !drawnIds.has(r) && r !== 'castra' ? 'drawn' : REGION_INFO[r].holder;
  svg.querySelectorAll<SVGGElement>('.pv-reg').forEach((g) => {
    const r = g.dataset.r as RegionId;
    g.setAttribute('class', `pv-reg ${colour(r)}${r === sel ? ' sel' : ''}${open.has(r) ? ' open' : ''}${s?.strike === r ? ' struck' : ''}`);
  });
  // the outlines over the ground: the region picked, the ones a campaign can go to, the one he strikes
  const line = (r: RegionId, cls: string) => `<use href="#pvr-${r}" class="${cls}" clip-path="url(#pvm-landclip)"/>`;
  svg.querySelector('.pv-lines')!.innerHTML = [...open].filter((r) => r !== sel).map((r) => line(r, 'pv-openline')).join('')
    + (s?.strike && s.strike !== sel ? line(s.strike, 'pv-struckline') : '') + line(sel, 'pv-selline');
  const roads: string[] = [];
  const seen = new Set<string>();
  for (const a of REGION_IDS) for (const b of REGION_INFO[a].roads) {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const [x1, y1] = REGION_INFO[a].at, [x2, y2] = REGION_INFO[b].at;
    const ours = held(a) && held(b), live = (held(a) && open.has(b)) || (held(b) && open.has(a));
    roads.push(`<path class="pv-road${ours ? ' ours' : live ? ' live' : ''}" d="M${x1},${y1} Q${(x1 + x2) / 2 + (y2 - y1) * 0.08},${(y1 + y2) / 2 - (x2 - x1) * 0.08} ${x2},${y2}"/>`);
  }
  // Varro's strike: an arrow from his nearest region to ours
  let strike = '';
  if (s?.strike) {
    const to = REGION_INFO[s.strike];
    // (from his region nearest by road, the nearer on the chart of two as near)
    const hops = new Map<RegionId, number>([[s.strike, 0]]);
    for (const q: RegionId[] = [s.strike]; q.length;) { const c = q.shift()!; for (const n of REGION_INFO[c].roads) if (!hops.has(n)) { hops.set(n, hops.get(c)! + 1); q.push(n); } }
    const from = REGION_IDS.filter((r) => !holds(s, r) && REGION_INFO[r].holder === 'varro')
      .sort((a, b) => (hops.get(a) ?? 99) - (hops.get(b) ?? 99) || dist2(REGION_INFO[a].at, to.at) - dist2(REGION_INFO[b].at, to.at))[0];
    if (from) {
      const [x1, y1] = REGION_INFO[from].at, [x2, y2] = to.at;
      const d = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / d, uy = (y2 - y1) / d;
      const ax = x1 + ux * 30, ay = y1 + uy * 30, bx = x2 - ux * 32, by = y2 - uy * 32;
      strike = `<path class="pv-strike" d="M${ax},${ay} Q${(ax + bx) / 2 - uy * 30},${(ay + by) / 2 + ux * 30} ${bx},${by}" marker-end="url(#pv-arrow)"/>`;
    }
  }
  const nodes = REGION_IDS.map((r) => {
    const R = REGION_INFO[r], [x, y] = R.at, c = colour(r);
    const f = s?.fortified[r] ?? 0;
    // Varro's fortifying: a crimson badge at the seal's shoulder, a tower and how many times
    const towers = f ? `<g class="pv-fort" transform="translate(15,-17)"><circle r="9"/><g transform="translate(-5.5,-6)">${glyph('tower', 11, 'gl')}</g>${f > 1 ? `<text x="8" y="10">${f}</text>` : ''}</g>` : '';
    const cls = `pv-node ${c}${r === sel ? ' sel' : ''}${open.has(r) ? ' open' : ''}${s?.strike === r ? ' struck' : ''}`;
    return `<g class="${cls}" data-r="${r}" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="${esc(R.name)}, ${esc(R.kind)}">
      <circle class="pv-halo" r="25"/><circle class="pv-disc" r="17"/><circle class="pv-ring" r="17"/>
      <g transform="translate(-10,-10)">${glyph(ICON[r], 20, 'gl')}</g>${towers}
      <text class="pv-name" y="33">${esc(R.name)}</text><text class="pv-kind" y="45">${esc(R.kind)}</text></g>`;
  }).join('');
  svg.querySelector('.pv-dyn')!.innerHTML = roads.join('') + strike + nodes;
}
const dist2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// ------------------------------------------------------------------ the page
export interface ProvinceHooks {
  /** the run, or none before a campaign is begun */
  state: ProvinceState | null;
  /** the autosave, when it holds one of the campaign's missions still being played */
  saved?: SavedMission;
  /** dispatches read so far, to mark the newer ones */
  seen: number;
  begin: (d: Difficulty) => void;
  start: (missionId: string) => Promise<void>;
  resume: () => Promise<void>;
  giveUp: () => void;
  read: (n: number) => void;
  /** a recording of the quaestor's to play (the epilogue), if there is one */
  say?: (voiceId: string) => void;
}

/** The quaestor's last count, spoken as `province.end.<end>` (the figures go in the table under it, not in the recording). */
export const EPILOGUE: Record<'won' | 'recalled', { title: string; text: string }> = {
  won: {
    title: 'Terra Nova is yours',
    text: 'My last count, legate, and then I shall stop counting. Varro sailed for Rome on the Senate’s ship, to account for the province. He took his accounts with him; I have kept a copy. The towns we built stand from the coast to Nova Ostia, and the men who built them are still in the column, older and harder to impress. The province is yours. So, I am told, am I.',
  },
  recalled: {
    title: 'Recalled to Rome',
    text: 'My last count, legate. Castra has fallen, and with it the Senate’s patience. We sail for Rome on the Senate’s ship, which Varro has kindly lent us, and he stays to govern what we built. I have packed the accounts. They are in order, which will surprise him, and they say what we did here, which will not.',
  },
};

export function provincePage(o: ProvinceHooks): MenuPage {
  const s = o.state;
  const drawn = (id: string) => !!missionById(id);
  const drawnIds = new Set(REGION_IDS.filter((r) => { const m = REGION_INFO[r].mission; return !!m && drawn(m); }));
  const open = new Set(s ? frontier(s, drawn) : []);
  const sealed = new Set(s ? beyond(s, drawn) : []);
  let sel: RegionId = s?.strike ?? [...open][0] ?? 'castra';

  const body = h('div', 'pv');
  const map = h('div', 'pv-map');
  const side = h('section', 'pv-side');
  side.setAttribute('aria-live', 'polite');
  side.dataset.err = '';
  body.append(map, side);

  let going = false;
  const go = (f: () => Promise<void>) => {
    if (going) return;
    going = true;
    const buttons = [...body.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((b) => (b.disabled = true));
    void f().catch(() => undefined).finally(() => { if (!body.isConnected) return; going = false; buttons.forEach((b) => (b.disabled = false)); });
  };

  // the sheet once, and a click anywhere in a region (its seal or its ground) picks it
  const pickAt = (e: Event) => { const t = (e.target as Element).closest<SVGElement>('[data-r]'); if (!t) return null; sel = t.dataset.r as RegionId; drawMap(); drawSide(); return t; };
  map.addEventListener('click', pickAt);
  map.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).closest('.pv-node')) { e.preventDefault(); pickAt(e); (map.querySelector(`.pv-node[data-r="${sel}"]`) as SVGGElement | null)?.focus(); } });
  const fit = new ResizeObserver(() => fitSheet(map));
  const drawMap = () => {
    if (!map.querySelector('svg')) {
      const undrawn = REGION_IDS.some((r) => r !== 'castra' && !drawnIds.has(r));
      map.innerHTML = chartSheet() + `<div class="pv-legend"><span class="you">Ours</span><span class="varro">Varro’s</span><span class="tribes">The tribes’</span>${undrawn ? '<span class="drawn">Still to be drawn</span>' : ''}</div>`;
      fit.observe(map);
      fitSheet(map);
    }
    chartMarks(map.querySelector('svg')!, s, sel, open, drawnIds);
  };

  const dispatch = (l: ProvinceState['log'][number], fresh: boolean) =>
    `<div class="pv-dispatch${fresh ? ' fresh' : ''}"><img src="${l.who === 'varro' ? VARRO_ICON : QUAESTOR_ICON}" alt=""><div><small>${l.who === 'varro' ? 'Varro, governor' : 'The quaestor'} · Season ${numeralOf(l.season - 1)}</small><p>${esc(l.text)}</p></div></div>`;

  const drawSide = () => {
    const R = REGION_INFO[sel];
    // before the campaign: its opening, and the choice of difficulty
    if (!s) {
      let d: Difficulty = 1;
      side.innerHTML = `<div class="pv-scroll">
        <div class="cp-kicker">The Province</div><h3 class="cp-title">The war for Terra Nova</h3>
        <blockquote class="cp-quote">The Senate has read my report and appointed a governor of senatorial rank: Quintus Varro. He lands at Nova Ostia with two legions, a fleet and the Senate’s seal, and you are to hand him the coast. I counted his towers, legate. I did not count his friends in Rome.<cite>Gaius Sestius, quaestor</cite></blockquote>
        <p class="pv-p">Take the province a region at a time: each is a designed map and an hour of play. Between seasons Varro moves: he fortifies what he holds, and he strikes at what you hold. Your best men march on from one region to the next, and every region held gives something to every start after it.</p>
        <div class="cp-sect">Difficulty</div>
        <div class="seg pv-diff">${DIFFICULTY.map((x, i) => `<button data-d="${i}" class="${i === d ? 'on' : ''}">${x.name}</button>`).join('')}</div>
        <p class="pv-note">${DIFFICULTY[d].line}</p></div>
        <footer class="cp-actions"><button class="tm-btn primary" data-act="begin" autofocus>${glyph('standard', 16)}Begin the campaign</button></footer>`;
      side.querySelectorAll<HTMLButtonElement>('.pv-diff button').forEach((b) => b.addEventListener('click', () => {
        d = Number(b.dataset.d) as Difficulty;
        side.querySelectorAll('.pv-diff button').forEach((x) => x.classList.toggle('on', x === b));
        side.querySelector('.pv-note')!.textContent = DIFFICULTY[d].line;
      }));
      side.querySelector('[data-act=begin]')!.addEventListener('click', () => o.begin(d));
      return;
    }
    const fresh = s.log.slice(o.seen);
    const news = fresh.length ? `<div class="cp-sect">Dispatches</div>${fresh.slice(-3).map((l) => dispatch(l, true)).join('')}` : '';
    // the end of the campaign
    if (s.end) {
      const e = EPILOGUE[s.end], L = s.ledger ?? { won: 0, held: 0, lost: 0 };
      const vets = s.column?.veterans ?? [];
      const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
      const ledger = [
        row('Seasons', `${s.season}`),
        row('Regions held', `${s.held.length} of ${REGION_IDS.length}`),
        row('Regions taken', `${L.won}`),
        row('His strikes beaten off', `${L.held}`),
        ...(L.lost ? [row('Regions lost to him', `${L.lost}`)] : []),
        row('The column', vets.length ? `${vets.length} men, ${vets.filter((v) => v.level >= 3).length} of them veterans of the third rank` : 'nobody left to march'),
        row('Difficulty', DIFFICULTY[s.difficulty].name),
      ].join('');
      side.innerHTML = `<div class="pv-scroll"><div class="cp-kicker">The end of the war · Season ${numeralOf(s.season - 1)}</div><h3 class="cp-title">${e.title}</h3>
        ${news || dispatch(s.log[s.log.length - 1], false)}
        <blockquote class="cp-quote">${esc(e.text)}<cite>Gaius Sestius, quaestor</cite></blockquote>
        <div class="cp-sect">The quaestor’s count</div><table class="pv-ledger">${ledger}</table></div>
        <footer class="cp-actions"><button class="tm-btn" data-act="hear">${glyph('play', 16)}Hear it</button><button class="tm-btn primary" data-act="new">${glyph('redo', 16)}Begin a new campaign</button></footer>`;
      side.querySelector('[data-act=new]')!.addEventListener('click', () => { s.end = undefined; o.begin(s.difficulty); });
      side.querySelector('[data-act=hear]')!.addEventListener('click', () => o.say?.(`province.end.${s.end}`));
      // (said once, when the page first shows the end)
      if (o.seen < s.log.length) o.say?.(`province.end.${s.end}`);
      o.read(s.log.length);
      return;
    }
    const status = holds(s, sel) ? '<span class="pv-chip you">Ours</span>'
      : !drawnIds.has(sel) && sel !== 'castra' ? '<span class="pv-chip drawn">Still to be drawn</span>'
      : R.holder === 'tribes' ? '<span class="pv-chip tribes">The tribes’</span>' : '<span class="pv-chip varro">Varro’s</span>';
    const fort = s.fortified[sel] ? `<span class="pv-chip varro">${glyph('tower', 14)}Fortified ×${s.fortified[sel]}</span>` : '';
    const head = `<div class="cp-kicker">${esc(R.kind)}</div><h3 class="cp-title">${esc(R.name)}</h3><div class="pv-chips">${status}${fort}</div><p class="pv-line">${esc(R.line)}</p>`;
    const boon = `<div class="cp-sect">${holds(s, sel) ? 'It gives us' : 'Holding it gives'}</div><p class="pv-p">${esc(R.boon.text)}.</p>`;
    let actions = '', more = '';
    const savedHere = (id: string) => o.saved?.id === id;
    // Varro's strike: the defence first
    if (s.strike === sel) {
      const id = `defence.${sel}`;
      const letter = [...s.log].reverse().find((l) => l.who === 'varro');
      more = `${letter ? `<blockquote class="cp-quote varro">${esc(letter.text)}<cite>Quintus Varro, governor</cite></blockquote>` : ''}
        <p class="pv-p">His legion is on the road. Beat it off and ${esc(R.name)} stays ours; lose, or give it up, and it is his again${sel === 'castra' ? ', and the campaign with it' : ''}.</p>`;
      actions = savedHere(id)
        ? `<button class="tm-btn" data-act="restart">${glyph('redo', 16)}Start over</button><button class="tm-btn primary" data-act="resume" autofocus>${glyph('play', 16)}Continue the defence</button>`
        : `${sel === 'castra' ? '' : `<button class="tm-btn" data-act="giveup">Give it up</button>`}<button class="tm-btn primary" data-act="restart" autofocus>${glyph('shield', 16)}Defend ${esc(R.name)}</button>`;
      side.innerHTML = `<div class="pv-scroll">${news}${head.replace(esc(R.kind), 'Varro strikes')}${more}${boon}</div><footer class="cp-actions">${savedHere(id) ? `<small class="cp-saved">${esc(o.saved!.line)}</small>` : ''}${actions}</footer>`;
      side.querySelector('[data-act=giveup]')?.addEventListener('click', (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        if (b.dataset.sure) { o.giveUp(); return; }
        b.dataset.sure = '1';
        b.textContent = `Give up ${R.name}?`;
        b.classList.add('danger');
      });
      side.querySelector('[data-act=restart]')?.addEventListener('click', () => go(() => o.start(id)));
      side.querySelector('[data-act=resume]')?.addEventListener('click', () => go(o.resume));
      o.read(s.log.length);
      return;
    }
    if (open.has(sel)) {
      const m = missionById(R.mission!)!;
      more = `<blockquote class="cp-quote">${esc(m.briefing[0])}<cite>Gaius Sestius, quaestor</cite></blockquote>
        <div class="cp-sect">The Senate asks</div><ol class="cp-goals">${m.goals.map((g) => `<li>${esc(g.text)}${g.optional ? ' <small>optional</small>' : ''}</li>`).join('')}</ol>`;
      actions = savedHere(m.id)
        ? `<button class="tm-btn" data-act="restart">${glyph('redo', 16)}Start over</button><button class="tm-btn primary" data-act="resume" autofocus>${glyph('play', 16)}Continue</button>`
        : `<button class="tm-btn primary" data-act="restart" autofocus>${glyph('standard', 16)}March on ${esc(R.name)}</button>`;
    } else if (holds(s, sel)) {
      more = sel === 'castra' ? '<p class="pv-p">The capital. Every campaign sets out from here, and the column rests here between seasons.</p>' : '';
    } else if (sealed.has(sel)) {
      more = '<p class="pv-p">A road reaches it, but this region of the campaign is still being drawn.</p>';
    } else if (sel === 'novaostia' && s.held.length < TO_THE_FINALE) {
      more = `<p class="pv-p">The governor’s seat opens to a campaign once ${TO_THE_FINALE} regions are held (${s.held.length} so far).</p>`;
    } else {
      const via = R.roads.map((r) => REGION_INFO[r].name);
      more = `<p class="pv-p">No road of ours reaches it yet: it lies beyond ${esc(via.slice(0, -1).join(', '))}${via.length > 1 ? ' and ' : ''}${esc(via[via.length - 1])}.</p>`;
    }
    const start = startOf(s);
    const col = start && (open.has(sel)) ? `<div class="cp-sect">Marching with you</div>${columnChips(start)}` : '';
    side.innerHTML = `<div class="pv-scroll">${news}${head}${more}${boon}${col}</div>${actions ? `<footer class="cp-actions">${savedHere(R.mission ?? '') ? `<small class="cp-saved">${esc(o.saved!.line)}</small>` : ''}${actions}</footer>` : ''}`;
    side.querySelector('[data-act=restart]')?.addEventListener('click', () => go(() => o.start(R.mission!)));
    side.querySelector('[data-act=resume]')?.addEventListener('click', () => go(o.resume));
    o.read(s.log.length);
  };

  drawMap();
  drawSide();
  const aside = h('div', 'cp-prog');
  if (s) aside.innerHTML = `<span>Season <b>${numeralOf(s.season - 1)}</b> · <b>${s.held.length}</b> of ${REGION_IDS.length} held</span><div class="cp-ticks">${REGION_IDS.map((r) => `<i class="${holds(s, r) ? 'on' : s.strike === r ? 'cur' : ''}"></i>`).join('')}</div>`;
  return {
    title: 'The Province',
    sub: s ? (s.end ? (s.end === 'won' ? 'The war is over, and the province is yours.' : 'The war is over. Castra has fallen.') : s.strike ? `Varro marches on ${REGION_INFO[s.strike].name}.` : 'Pick a region on the border to campaign in this season.') : 'The war for Terra Nova against the Senate’s governor, a region at a time.',
    body, aside, wide: true,
    onKey: (e) => {
      if (going) return e.key === 'Escape' || e.key === 'Enter';
      // ←/→ walk the regions that can be picked: the border, the strike, what is ours
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const ring = REGION_IDS.filter((r) => open.has(r) || (s && holds(s, r)) || s?.strike === r);
        if (!ring.length) return false;
        const i = ring.indexOf(sel);
        sel = ring[(i + (e.key === 'ArrowRight' ? 1 : ring.length - 1)) % ring.length];
        drawMap(); drawSide();
        (map.querySelector(`.pv-node[data-r="${sel}"]`) as SVGGElement | null)?.focus();
        return true;
      }
      return false;
    },
  };
}
