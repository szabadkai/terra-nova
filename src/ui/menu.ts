// The title screen, over a live, slowly orbiting preview of the generated map: one card that turns its
// pages - the start (continue, the campaign, free play, a game with a friend), free play's settings,
// how to play, and pages lent to it (the campaign's missions, campaign.ts). Every page but the start
// has a way back, and Esc takes it.
import { PLAYER_COLORS } from '../game/defs';
import type { SaveMeta } from '../game/save';
import { glyph, type GlyphName } from './glyphs';
import { missionById } from '../game/campaign';
import { playTime, saveSubtitle, timeAgo } from './saveStore';

export interface MenuOptions {
  seed: number;
  size: number;
  players: number;
  ai: number;
  /** the campaign mission being played (missions.ts), none in free play */
  mission?: string;
}

/** A page of the title screen's card. */
export interface MenuPage {
  title: string;
  /** a line under the heading */
  sub?: string;
  body: HTMLElement;
  /** on the right of the heading (the campaign's progress) */
  aside?: HTMLElement;
  /** the wide card, for a page with two columns */
  wide?: boolean;
  /** keys while the page is up: true when taken (Esc goes back unless the page takes it) */
  onKey?: (e: KeyboardEvent) => boolean;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const MAP_NAMES: Record<number, string> = { 128: 'Small map', 160: 'Medium map', 208: 'Large map' };
/** The last game in one line under Continue: "Domus · 12 min played · saved 5 min ago" (the full line is its tooltip). */
const continueLine = (m: SaveMeta) =>
  `${(m.mission && missionById(m.mission)?.title) || MAP_NAMES[m.size] || `${m.size}² map`} · ${playTime(m.time)} played · saved ${timeAgo(m.savedAt)}`;
const RIVALS = ['One rival', 'Two rivals', 'Three rivals'];

const tile = (id: string, icon: GlyphName, title: string, sub: string, tip = '') =>
  `<button class="tm-tile" id="${id}"${tip ? ` title="${tip}"` : ''}><span class="tm-medal">${glyph(icon, 22)}</span>` +
  `<span class="tm-t"><b>${title}</b><small>${sub}</small></span>${glyph('next', 18, 'gl tm-chev')}</button>`;
const tool = (id: string, icon: GlyphName, text: string, tip: string) =>
  `<button class="tm-tool" id="${id}" title="${tip}">${glyph(icon, 20)}<span>${text}</span></button>`;

/** How to play, a step at a time. */
const STEPS: [GlyphName, string, string][] = [
  ['axe', 'Wood and stone first', 'Build Woodcutters near forests, a Forester to replant, a Sawmill to turn logs into boards, and a Stonecutter next to rocks.'],
  ['sack', 'Settlers carry everything', 'There are no roads — carriers walk goods between buildings. Build Residences to grow your population.'],
  ['flag', 'Expand', 'Guard towers, Watchtowers and Castles claim land once a soldier moves in. Pioneers (Military tab) stake out free land beside your border with nothing but a shovel — though an enemy stronghold’s borders take it back.'],
  ['wheat', 'Feed the mines', 'Fishers, Hunters and Bakeries (Farm → Windmill → Bakery + Waterworks) supply food for mines on the mountains. Send a Geologist (Industry tab) to your mountains: his signs and the glittering specks he uncovers reveal coal, iron and gold.'],
  ['sword', 'Arm yourself', 'Iron Smelter + Coal → Iron → Weaponsmith → swords and bows → Barracks trains soldiers. Gold in storage raises morale.'],
  ['anchor', 'Take to the sea', 'A Harbour and a Shipyard on the coast give you ships. They carry goods and settlers between your harbours, and a harbour can send an expedition to found a colony on the rich islands offshore.'],
  ['crown', 'Conquer', 'Select an enemy military building in reach and press Attack — or take command yourself: drag a box around your soldiers (or Call out a tower’s garrison) and right-click where they should go, or the stronghold they should storm. Capture them all to win.'],
];
const CONTROLS: [string, string][] = [
  ['Move the view', '<kbd>Right-drag</kbd> <kbd>WASD</kbd> <kbd>Arrows</kbd> or the screen edge'],
  ['Zoom', '<kbd>Wheel</kbd> towards the pointer'],
  ['Turn and tilt', '<kbd>Option</kbd>/<kbd>Alt</kbd> + drag, <kbd>Middle-drag</kbd>, <kbd>Shift</kbd> + wheel, <kbd>Q</kbd> <kbd>E</kbd> or the buttons under the minimap'],
  ['Pause', '<kbd>Space</kbd>'],
  ['Everything else', '<kbd>Esc</kbd> → Controls'],
];

export function showMenu(parent: HTMLElement, opts: MenuOptions, onStart: () => void, onRegenerate: (o: MenuOptions) => void, onOptions?: () => void, onLoad?: () => void, onFriend?: () => void, onCampaign?: () => void) {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `
    <div class="menu-inner">
      <div class="title">
        <div class="crest">⚜</div>
        <h1>Terra Nova</h1>
        <div class="sub">A tribute to <i>The Settlers III</i></div>
      </div>
      <div class="menu-stage">
        <div class="panel menu-card tm-home">
          <div class="tm-tiles">
            ${tile('campaign', 'laurel', 'Campaign', '<span class="camp-sub">Fifteen missions, one lesson each</span>', 'Fifteen missions that teach the game one lesson at a time, told by your quaestor')}
            ${tile('free', 'map', 'Free play', 'Your own map against the computer')}
            ${tile('friend', 'friends', 'With a friend', 'Host a game or join one by its code', 'Two players over the internet: one hosts, the other joins with a code')}
          </div>
          <div class="tm-tools">
            ${tool('help', 'book', 'How to play', 'The first steps and the controls')}
            ${tool('load', 'folder', 'Load', 'Saved games')}
            ${tool('options', 'sliders', 'Options', 'Graphics, sound and controls')}
          </div>
        </div>
      </div>
      <div class="menu-foot">All graphics and most sounds are generated procedurally in your browser.</div>
    </div>`;
  parent.appendChild(el);
  const stage = el.querySelector<HTMLElement>('.menu-stage')!;
  const homeCard = el.querySelector<HTMLElement>('.tm-home')!;
  const cur = { ...opts };

  // ------------------------------------------------------------ pages
  let page: { card: HTMLElement; spec: MenuPage; from: HTMLElement | null } | null = null;
  /** Turn to a page (in place of any other page that is up). */
  const open = (spec: MenuPage) => {
    const from = page ? page.from : document.activeElement instanceof HTMLElement && homeCard.contains(document.activeElement) ? document.activeElement : null;
    page?.card.remove();
    const card = document.createElement('div');
    card.className = `panel menu-card tm-page${spec.wide ? ' tm-wide' : ''}`;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', spec.title);
    card.innerHTML = `<header class="tm-head">
        <button class="tm-back" title="Back (Esc)" aria-label="Back">${glyph('back', 20)}</button>
        <div class="tm-htext"><h2></h2>${spec.sub ? '<p></p>' : ''}</div>
      </header>`;
    card.querySelector('h2')!.textContent = spec.title;
    if (spec.sub) card.querySelector('.tm-htext p')!.textContent = spec.sub;
    if (spec.aside) card.querySelector('.tm-head')!.appendChild(spec.aside);
    spec.body.classList.add('tm-body');
    card.appendChild(spec.body);
    card.querySelector<HTMLButtonElement>('.tm-back')!.onclick = () => home();
    homeCard.hidden = true;
    stage.appendChild(card);
    el.classList.add('sub');
    el.classList.toggle('sub-wide', !!spec.wide);
    page = { card, spec, from };
    // (the page's own first choice takes the focus if it has one, else the way back)
    (card.querySelector<HTMLElement>('[autofocus]') ?? card.querySelector<HTMLElement>('.tm-back'))?.focus({ preventScroll: true });
  };
  /** Back to the start. */
  const home = () => {
    if (!page) return;
    const from = page.from;
    page.card.remove();
    page = null;
    homeCard.hidden = false;
    el.classList.remove('sub', 'sub-wide');
    from?.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) { window.removeEventListener('keydown', onKey); return; }
    // (the options over the title screen take their own keys)
    if (!page || el.classList.contains('leaving') || parent.querySelector('.gmenu')) return;
    if (page.spec.onKey?.(e)) { e.preventDefault(); return; }
    if (e.key === 'Escape') { e.preventDefault(); home(); }
  };
  window.addEventListener('keydown', onKey);

  // ------------------------------------------------------------ free play
  const freePage = (): MenuPage => {
    const body = document.createElement('div');
    const shields = (n: number) => Array.from({ length: n }, (_, i) =>
      `<span class="tm-shield" style="--c:${hex(PLAYER_COLORS[i + 1])}">${glyph('shield', 18)}</span>`).join('');
    body.innerHTML = `
      <div class="tm-form">
        <label>Map</label>
        <div class="seg" data-k="size"><button data-v="128">Small</button><button data-v="160">Medium</button><button data-v="208">Large</button></div>
        <label>Rivals</label>
        <div class="seg" data-k="players">${[2, 3, 4].map((v) => `<button data-v="${v}" title="${RIVALS[v - 2]}" aria-label="${RIVALS[v - 2]}">${shields(v - 1)}</button>`).join('')}</div>
        <label>Difficulty</label>
        <div class="seg" data-k="ai"><button data-v="0">Easy</button><button data-v="1">Normal</button><button data-v="2">Hard</button></div>
        <label for="seed">World</label>
        <div class="tm-seed"><input type="number" id="seed" min="1" value="${cur.seed}" aria-label="World seed" title="The world's seed: the same number makes the same map"><button id="dice" title="A random world" aria-label="A random world">${glyph('dice', 20)}</button></div>
      </div>
      <p class="tm-note">The map behind is the one you will play: change a setting and it is shaped anew.</p>
      <button class="tm-btn primary tm-go" id="start" autofocus>${glyph('play', 18)}Found your colony</button>`;
    body.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const k = seg.dataset.k as 'size' | 'players' | 'ai';
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.classList.toggle('on', Number(b.dataset.v) === cur[k]);
        b.onclick = () => {
          if (cur[k] === Number(b.dataset.v)) return;
          cur[k] = Number(b.dataset.v);
          seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          if (k === 'size' || k === 'players') onRegenerate(cur);
        };
      });
    });
    const seedIn = body.querySelector<HTMLInputElement>('#seed')!;
    seedIn.onchange = () => { cur.seed = Math.max(1, Math.floor(Number(seedIn.value)) || 1); seedIn.value = String(cur.seed); onRegenerate(cur); };
    body.querySelector<HTMLButtonElement>('#dice')!.onclick = () => { cur.seed = Math.floor(Math.random() * 99999) + 1; seedIn.value = String(cur.seed); onRegenerate(cur); };
    body.querySelector<HTMLButtonElement>('#start')!.onclick = () => {
      opts.ai = cur.ai;
      delete opts.mission;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 700);
      onStart();
    };
    return {
      title: 'Free play', sub: 'Your own kingdom on a map of your choosing', body,
      // Enter in the seed box takes the new world first, not the start
      onKey: (e) => e.key === 'Enter' && e.target === seedIn ? (seedIn.blur(), true) : false,
    };
  };

  // ------------------------------------------------------------ how to play
  const helpPage = (): MenuPage => {
    const body = document.createElement('div');
    body.innerHTML = `
      <ol class="tm-steps">${STEPS.map(([ic, t, d]) => `<li><span class="tm-medal">${glyph(ic, 20)}</span><div><b>${t}</b><p>${d}</p></div></li>`).join('')}</ol>
      <div class="tm-sect">Controls</div>
      <dl class="tm-keys">${CONTROLS.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>`;
    return { title: 'How to play', sub: 'Grow an economy, push your borders out, and conquer your rivals — just like the classic.', body, wide: true };
  };

  el.querySelector<HTMLButtonElement>('#free')!.onclick = () => open(freePage());
  el.querySelector<HTMLButtonElement>('#campaign')!.onclick = () => onCampaign?.();
  el.querySelector<HTMLButtonElement>('#help')!.onclick = () => open(helpPage());
  el.querySelector<HTMLButtonElement>('#options')!.onclick = () => onOptions?.();
  el.querySelector<HTMLButtonElement>('#load')!.onclick = () => onLoad?.();
  el.querySelector<HTMLButtonElement>('#friend')!.onclick = () => { opts.ai = cur.ai; onFriend?.(); };
  // with no game to continue, the campaign leads (see offerContinue)
  el.querySelector('#campaign')!.classList.add('hero');

  /** Put the last game at the top of the card as the main action. */
  const offerContinue = (meta: SaveMeta, go: () => void) => {
    if (el.querySelector('.continue')) return;
    const b = document.createElement('button');
    b.className = 'tm-tile hero continue';
    b.innerHTML = `<span class="tm-medal${meta.thumb ? ' thumb' : ''}">${meta.thumb ? '<img alt="">' : glyph('play', 20)}</span>` +
      `<span class="tm-t"><b>${meta.mission ? 'Continue the campaign' : 'Continue your reign'}</b><small></small></span>${glyph('play', 18, 'gl tm-chev')}`;
    if (meta.thumb) b.querySelector('img')!.src = meta.thumb;
    b.querySelector('small')!.textContent = continueLine(meta);
    b.title = saveSubtitle(meta);
    b.onclick = () => { b.disabled = true; go(); };
    homeCard.querySelector('.tm-tiles')!.prepend(b);
    el.querySelector('#campaign')!.classList.remove('hero');
  };
  /** The line under the Campaign tile: what comes next. */
  const setCampaignSub = (text: string) => {
    const s = el.querySelector<HTMLElement>('#campaign .camp-sub');
    if (s) s.textContent = text;
  };
  /** A line at the foot of the start, with a link-like button. */
  const note = (text: string, link: string, go: () => void) => {
    const p = document.createElement('p');
    p.className = 'menu-note';
    p.textContent = `${text} `;
    const b = document.createElement('button');
    b.className = 'linkish';
    b.textContent = link;
    b.onclick = () => { p.remove(); go(); };
    p.appendChild(b);
    homeCard.appendChild(p);
  };
  return { el, cur, offerContinue, note, setCampaignSub, open, home };
}

export function showLoading(parent: HTMLElement, text: string) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="crest spin">⚜</div><div>${text}</div>`;
  parent.appendChild(el);
  return el;
}
