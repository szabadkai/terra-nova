// The campaign's screens: the mission list on the title screen, the briefing before a mission and the
// debrief after it, and the quaestor's face on his toasts. Reads the game, never writes it.
import { GOODS, type BuildingType } from '../game/defs';
import type { Game } from '../game/game';
import { MISSIONS } from '../game/missions';
import { missionIndex, numeralOf, toolUnlockedIn, unlockedIn, type Mission, type Tool } from '../game/campaign';
import type { CampaignProgress } from './campaignStore';
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
    <div class="row">${o.onReplay ? '<button class="wide" data-act="voice" title="Hear the quaestor again">🔊 Again</button>' : ''}<button class="wide primary" data-act="begin">Begin</button></div>
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
    <div class="row"><button class="wide" data-act="keep">Keep playing</button><button class="wide" data-act="menu">Campaign</button>${o.next && !last ? '<button class="wide primary" data-act="next">Next mission</button>' : ''}</div>
  </div>`;
  ov.querySelector<HTMLElement>('[data-act=keep]')!.onclick = () => { ov.remove(); o.keep(); };
  ov.querySelector<HTMLElement>('[data-act=menu]')!.onclick = () => { ov.remove(); o.menu(); };
  const next = ov.querySelector<HTMLElement>('[data-act=next]');
  if (next && o.next) next.onclick = () => { ov.remove(); o.next!(); };
  return ov;
}

/** The mission list over the title screen: what is done, what is next, what is still to come. */
export function showCampaignPage(parent: HTMLElement, progress: CampaignProgress, onStart: (id: string) => void): HTMLElement {
  parent.querySelector('#campbox')?.remove();
  const box = h('div', 'panel help campaign');
  box.id = 'campbox';
  const firstOpen = MISSIONS.findIndex((m) => !progress.done[m.id]);
  const allDone = firstOpen < 0;
  const rows = MISSIONS.map((m, i) => {
    const done = progress.done[m.id];
    const cur = i === firstOpen;
    const locked = !done && !cur;
    const state = done ? `✓ ${playTime(done.time)}` : cur ? 'Next' : 'Locked';
    const brief = cur ? `<div class="mbrief">${esc(m.briefing[0])}</div>` : '';
    const btn = locked ? '' : `<button class="wide" data-id="${m.id}">${done ? 'Play again' : cur && progress.current === m.id ? 'Continue' : 'Start'}</button>`;
    return `<li class="mission ${done ? 'done' : cur ? 'cur' : 'locked'}"><div class="num">${numeralOf(i)}</div><div class="mtext"><b>${esc(m.title)}</b> <span class="sub">${esc(m.subtitle)}</span>${brief}</div><div class="mside"><div class="mstate">${state}</div>${btn}</div></li>`;
  }).join('');
  box.innerHTML = `<h2>The Province</h2>
    <p>${allDone ? 'Terra Nova is a province of Rome. Every mission stands open to be played again.' : 'Fifteen missions raise a Roman province one lesson at a time, told by Gaius Sestius, quaestor. Each opens a few more buildings; the last opens them all against a rival colony.'}</p>
    <ol class="missions">${rows}</ol>
    <button class="wide" id="campclose">Close</button>`;
  parent.appendChild(box);
  box.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) => { b.onclick = () => { b.disabled = true; onStart(b.dataset.id!); }; });
  box.querySelector<HTMLButtonElement>('#campclose')!.onclick = () => box.remove();
  box.querySelector<HTMLElement>('.mission.cur')?.scrollIntoView({ block: 'center' });
  return box;
}
