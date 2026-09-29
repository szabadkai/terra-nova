// The campaign's screens: the mission list on the title screen, the briefing before a mission and the
// debrief after it, and the quaestor's face on his toasts. Reads the game, never writes it.
import { BUILDINGS, GOODS, type BuildingType } from '../game/defs';
import type { Game } from '../game/game';
import { MISSIONS } from '../game/missions';
import { missionIndex, numeralOf, toolUnlockedIn, unlockedIn, type Mission, type Tool } from '../game/campaign';
import type { CampaignProgress } from './campaignStore';
import { glyph } from './glyphs';
import { buildingIcons } from './icons';
import type { MenuPage } from './menu';
import { playTime } from './saveStore';

/** A laurel wreath round a scroll, in the interface's gold: the quaestor's seal on his toasts. */
export const QUAESTOR_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<circle cx="32" cy="32" r="30" fill="#2a1c0c" stroke="#e2b857" stroke-width="2"/>
<g fill="none" stroke="#e2b857" stroke-width="2.4" stroke-linecap="round">
<path d="M14 40c-2-8 0-16 6-22"/><path d="M50 40c2-8 0-16-6-22"/>
<path d="M16 36l-5 1M17 30l-5-1M19 25l-4-3M22 21l-2-4"/><path d="M48 36l5 1M47 30l5-1M45 25l4-3M42 21l2-4"/>
</g>
<rect x="22" y="22" width="20" height="22" rx="2" fill="#f3e8d2"/>
<path d="M22 22h20M22 44h20" stroke="#b58a3c" stroke-width="3" stroke-linecap="round"/>
<path d="M26 29h12M26 33h12M26 37h8" stroke="#7a4e08" stroke-width="1.6" stroke-linecap="round"/>
</svg>`);

const h = (tag: string, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (m: Mission) => `Mission ${numeralOf(missionIndex(m.id))}`;

/** What a locked card says: the mission that grants it, if any does ("Mission IV"); `inSentence` for "…grants it in a later mission". */
export function lockNote(t: BuildingType, inSentence = false): string {
  const m = unlockedIn(t);
  return m ? label(m) : inSentence ? 'a later mission' : 'Later in the campaign';
}
export function toolLockNote(tool: Tool, inSentence = false): string {
  const m = toolUnlockedIn(tool);
  return m ? label(m) : inSentence ? 'a later mission' : 'Later in the campaign';
}

/** The quaestor's briefing before a mission; the game waits until Begin. */
export function briefingOverlay(m: Mission, o: { onBegin: () => void; onReplay?: () => void }): HTMLElement {
  const ov = h('div', 'overlay brief-ov');
  ov.innerHTML = `<div class="panel dialog brief" role="dialog" aria-labelledby="brief-title">
    <div class="num">${label(m)}</div>
    <h1 id="brief-title">${esc(m.title)}</h1>
    <div class="sub">${esc(m.subtitle)}</div>
    ${m.briefing.map((p) => `<p>${esc(p)}</p>`).join('')}
    <div class="goalhead">The Senate asks</div>
    <ol class="goals">${m.goals.map((g) => `<li>${esc(g.text)}${g.optional ? ' <small>(optional)</small>' : ''}</li>`).join('')}</ol>
    <div class="row">${o.onReplay ? `<button class="tm-btn" data-act="voice" title="Hear the quaestor again">${glyph('sound', 16)}Again</button>` : ''}<button class="tm-btn primary" data-act="begin">${glyph('play', 16)}Begin</button></div>
  </div>`;
  ov.querySelector<HTMLElement>('[data-act=begin]')!.onclick = () => { ov.remove(); o.onBegin(); };
  const again = ov.querySelector<HTMLElement>('[data-act=voice]');
  if (again && o.onReplay) again.onclick = () => o.onReplay!();
  return ov;
}

/** The quaestor's word after a mission, with the figures he counted. */
export function debriefOverlay(m: Mission, g: Game, o: { next?: () => void; keep: () => void; menu: () => void }): HTMLElement {
  const ov = h('div', 'overlay brief-ov');
  const p = g.players[g.local];
  let produced = 0;
  for (const gd of GOODS) produced += p.produced[gd];
  const last = missionIndex(m.id) === MISSIONS.length - 1;
  ov.innerHTML = `<div class="panel dialog brief" role="dialog" aria-labelledby="debrief-title">
    <div class="num">${label(m)} · ${esc(m.title)}</div>
    <h1 id="debrief-title">${last ? 'The province is yours' : 'Mission accomplished'}</h1>
    <p>${esc(m.debrief)}</p>
    <p class="hook">${esc(m.hook)}</p>
    <div class="kv"><span>Time</span><b>${playTime(g.time)}</b></div>
    <div class="kv"><span>Goods produced</span><b>${produced}</b></div>
    <div class="kv"><span>Population</span><b>${g.population(g.local).total}</b></div>
    <div class="row"><button class="tm-btn" data-act="keep">Keep playing</button><button class="tm-btn" data-act="menu">Campaign</button>${o.next && !last ? `<button class="tm-btn primary" data-act="next">Next mission${glyph('next', 16)}</button>` : ''}</div>
  </div>`;
  ov.querySelector<HTMLElement>('[data-act=keep]')!.onclick = () => { ov.remove(); o.keep(); };
  ov.querySelector<HTMLElement>('[data-act=menu]')!.onclick = () => { ov.remove(); o.menu(); };
  const next = ov.querySelector<HTMLElement>('[data-act=next]');
  if (next && o.next) next.onclick = () => { ov.remove(); o.next!(); };
  return ov;
}

/** The autosave, when it holds a mission still being played: its id and its line ("12 min played · saved 5 min ago"). */
export interface SavedMission { id: string; line: string }

const TOOL_NAMES: Record<Tool, string> = { geologist: 'Geologist', pioneer: 'Pioneer', spells: 'Spells', warships: 'Warships' };
const MAP_NAMES: Record<number, string> = { 128: 'Small map', 160: 'Medium map', 208: 'Large map' };

/** Who a mission is played against, in a few words. */
function rivalsOf(m: Mission): string {
  if (m.map.players < 2) return 'No rivals';
  return Array.from({ length: m.map.players - 1 }, (_, i) => {
    const r = m.rules?.rivals?.[i];
    return r?.mode === 'dormant' ? `Rebels · ${r.name ?? 'an outpost'}` : `Rival · ${r?.name ?? 'a computer kingdom'}`;
  }).join(', ');
}

/**
 * The campaign's page of the title screen: the fifteen missions down the left (won, next, sealed), the
 * one picked on the right - the quaestor's opening word, the Senate's goals, what it grants - and the
 * way into it. ↑/↓ pick, Enter goes in.
 */
export function campaignPage(progress: CampaignProgress, o: { saved?: SavedMission; start: (id: string) => Promise<void>; resume: () => Promise<void> }): MenuPage {
  const firstOpen = MISSIONS.findIndex((m) => !progress.done[m.id]);
  const allDone = firstOpen < 0;
  const won = MISSIONS.filter((m) => progress.done[m.id]).length;
  const open = (i: number) => !!progress.done[MISSIONS[i].id] || i === firstOpen;
  const saved = o.saved && missionIndex(o.saved.id) >= 0 && open(missionIndex(o.saved.id)) ? o.saved : undefined;
  let sel = saved ? missionIndex(saved.id) : allDone ? MISSIONS.length - 1 : firstOpen;

  const body = h('div', 'cp');
  body.innerHTML = `<ol class="cp-list" role="listbox" aria-label="Missions">${MISSIONS.map((m, i) => {
    const done = progress.done[m.id];
    const state = done ? 'done' : i === firstOpen ? 'cur' : 'locked';
    const mark = done ? `<span class="cp-mark" title="Won in ${playTime(done.time)}">${glyph('check', 18)}</span>`
      : state === 'cur' ? '<span class="cp-mark"><i>Next</i></span>' : `<span class="cp-mark" title="Sealed">${glyph('lock', 16)}</span>`;
    return `<li role="option"><button class="cp-row ${state}" data-i="${i}"><span class="cp-num">${numeralOf(i)}</span><span class="cp-name"><b>${esc(m.title)}</b><small>${esc(m.subtitle)}</small></span>${mark}</button></li>`;
  }).join('')}</ol><section class="cp-detail" data-err aria-live="polite"></section>`;
  const rows = [...body.querySelectorAll<HTMLButtonElement>('.cp-row')];
  const detail = body.querySelector<HTMLElement>('.cp-detail')!;
  /** Once a mission is being entered, nothing else on the page answers - unless it could not be (a save that would not load), and the page is still up. */
  let going = false;
  const go = (f: () => Promise<void>) => {
    if (going) return;
    going = true;
    const buttons = [...body.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((b) => (b.disabled = true));
    void f().catch(() => undefined).finally(() => {
      if (!body.isConnected) return;
      going = false;
      buttons.forEach((b) => (b.disabled = false));
    });
  };

  const show = (i: number, focusRow = false) => {
    sel = i;
    rows.forEach((r, k) => { r.classList.toggle('sel', k === i); r.setAttribute('aria-selected', String(k === i)); });
    if (focusRow) rows[i].focus({ preventScroll: true });
    rows[i].scrollIntoView({ block: 'nearest' });
    const m = MISSIONS[i];
    const done = progress.done[m.id];
    const grants = [
      ...m.unlocks.map((t) => {
        const src = buildingIcons.get(t);
        return `<span class="cp-grant${src ? '' : ' tool'}">${src ? `<img src="${src}" alt="">` : ''}${esc(BUILDINGS[t].name)}</span>`;
      }),
      ...(m.tools ?? []).map((t) => `<span class="cp-grant tool">${esc(TOOL_NAMES[t])}</span>`),
    ].join('');
    const meta = `<div class="cp-meta"><span>${glyph('map', 16)}${MAP_NAMES[m.map.size] ?? `${m.map.size}² map`}</span><span>${glyph('shield', 16)}${esc(rivalsOf(m))}</span>${done ? `<span class="won">${glyph('clock', 16)}Won in ${playTime(done.time)}</span>` : ''}</div>`;
    const head = `<div class="cp-kicker">${label(m)}</div><h3 class="cp-title">${esc(m.title)}</h3><div class="cp-sub">${esc(m.subtitle)}</div>`;
    if (!open(i)) {
      detail.innerHTML = `<div class="cp-scroll">${head}${meta}
        <div class="cp-sealed">${glyph('lock', 28)}<p>Sealed until ${label(MISSIONS[i - 1])}, <i>${esc(MISSIONS[i - 1].title)}</i>, is won.</p></div>
        ${grants ? `<div class="cp-sect">It will grant</div><div class="cp-grants">${grants}</div>` : ''}</div>`;
      return;
    }
    const resumable = saved?.id === m.id;
    const actions = resumable
      ? `<button class="tm-btn" data-act="restart" title="Begin the mission again from the start">${glyph('redo', 16)}Start over</button><button class="tm-btn primary" data-act="resume" title="${esc(saved!.line)}" autofocus>${glyph('play', 16)}Continue</button>`
      : done ? `<button class="tm-btn primary" data-act="restart" autofocus>${glyph('redo', 16)}Play again</button>`
      : `<button class="tm-btn primary" data-act="restart" autofocus>${glyph('play', 16)}Begin</button>`;
    detail.innerHTML = `<div class="cp-scroll">${head}${meta}
      <blockquote class="cp-quote">${esc(m.briefing[0])}<cite>Gaius Sestius, quaestor</cite></blockquote>
      <div class="cp-sect">The Senate asks</div>
      <ol class="cp-goals">${m.goals.map((g) => `<li>${esc(g.text)}${g.optional ? ' <small>optional</small>' : ''}</li>`).join('')}</ol>
      ${grants ? `<div class="cp-sect">New in this mission</div><div class="cp-grants">${grants}</div>` : ''}</div>
      <footer class="cp-actions">${resumable ? `<small class="cp-saved">${esc(saved!.line)}</small>` : ''}${actions}</footer>`;
    detail.querySelector<HTMLElement>('[data-act=resume]')?.addEventListener('click', () => go(o.resume));
    detail.querySelector<HTMLElement>('[data-act=restart]')!.addEventListener('click', () => go(() => o.start(m.id)));
  };
  rows.forEach((r, i) => { r.onclick = () => show(i); });
  show(sel);

  const aside = h('div', 'cp-prog');
  aside.innerHTML = `<span><b>${won}</b> of ${MISSIONS.length} won</span><div class="cp-ticks">${MISSIONS.map((m, i) => `<i class="${progress.done[m.id] ? 'on' : i === firstOpen ? 'cur' : ''}"></i>`).join('')}</div>`;
  return {
    title: 'The Province',
    sub: allDone ? 'Terra Nova is a province of Rome. Every mission stands open to be played again.' : 'Fifteen missions raise a Roman province, one lesson at a time.',
    body, aside, wide: true,
    onKey: (e) => {
      if (going) return e.key === 'Escape' || e.key === 'Enter';
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { show(Math.max(0, Math.min(MISSIONS.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))), true); return true; }
      // (Enter on the list goes in; on a button it is that button's own click)
      if (e.key === 'Enter' && (e.target as HTMLElement)?.classList?.contains('cp-row')) { detail.querySelector<HTMLElement>('.cp-actions .primary')?.click(); return true; }
      return false;
    },
  };
}
