import './style.css';
import { Game } from './game/game';
import { GameRenderer } from './render/renderer';
import { HUD } from './ui/hud';
import { generateIcons } from './ui/icons';
import { showLoading, showMenu, MenuOptions } from './ui/menu';
import { GameMenu } from './ui/gameMenu';
import { applyAudioPrefs, applyRenderPrefs } from './ui/prefs';
import { Audio } from './audio/audio';
import { G } from './render/shaderPatch';

let canvas = document.getElementById('c') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(params.get(k));
  return params.has(k) && Number.isFinite(v) ? v : d;
};

const opts: MenuOptions = {
  seed: num('seed', Math.floor(Math.random() * 99999) + 1),
  size: num('size', 160),
  players: num('players', 2),
  ai: num('ai', 1),
};

const audio = new Audio();
applyAudioPrefs(audio);
let game: Game;
let gr: GameRenderer;
let hud: HUD | null = null;
let menuEl: HTMLElement | null = null;
/** the Esc menu in a game, or the options modal on the title screen; the game is paused while it is open */
let gameMenu: GameMenu | null = null;
let state: 'menu' | 'play' = 'menu';
let speed = 1;
let pausedSpeed = 1;
let iconsReady = false;

/** Create (or re-create) the world in place — no page reloads, so it also works inside sandboxed frames. */
async function buildWorld() {
  const loading = showLoading(uiRoot, 'Shaping the land…');
  await new Promise((r) => setTimeout(r, 30));
  gameMenu?.close();
  if (gr) {
    gr.dispose();
    const fresh = document.createElement('canvas');
    fresh.id = 'c';
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  if (hud) { hud.root.remove(); hud = null; }
  state = 'menu';
  speed = pausedSpeed = 1;
  game = new Game({ size: opts.size, seed: opts.seed, players: opts.players, aiLevel: opts.ai, islands: params.get('islands') !== '0' });
  gr = new GameRenderer(canvas, game);
  applyRenderPrefs(gr);
  gr.setSound((n, x, z, v) => audio.play(n, x, z, v));
  bindCanvas(canvas);
  if (!iconsReady) { generateIcons(game.local); iconsReady = true; }
  (window as any).game = game;
  (window as any).gr = gr;
  loading.remove();
}

function showMainMenu() {
  G.uFogOn.value = 0;
  gr.cam.cinematic = true;
  gr.cam.zoomTo(46, true);
  gr.sky.timeOfDay = params.has('tod') ? num('tod', 0.62) : 0.62;
  menuEl?.remove();
  menuEl = showMenu(uiRoot, opts, startGame, async (o) => {
    Object.assign(opts, o);
    menuEl?.remove();
    menuEl = null;
    await buildWorld();
    showMainMenu();
  }, openOptions).el;
}

/** Settings modal over the title screen. */
function openOptions() {
  if (gameMenu) return;
  gameMenu = new GameMenu(uiRoot, { game, gr, audio, inGame: false, onClose: () => { gameMenu = null; } });
}

/** The Esc menu: pauses the game until it is closed. */
function openGameMenu() {
  if (gameMenu || state !== 'play') return;
  hud?.hideTip();
  gr.cam.inputEnabled = false;
  audio.setPaused(true);
  gameMenu = new GameMenu(uiRoot, {
    game, gr, audio, inGame: true, objectives: hud?.objectives,
    onClose: () => { gameMenu = null; gr.cam.inputEnabled = true; audio.setPaused(false); },
    onRestart: () => { void restartMap(); },
    onQuit: () => { void restart(); },
  });
}

/** Play the same map again from the start. */
async function restartMap() {
  await buildWorld();
  startGame();
}

async function restart() {
  opts.seed = Math.floor(Math.random() * 99999) + 1;
  await buildWorld();
  showMainMenu();
}

async function boot() {
  await buildWorld();
  setupGlobalInput();
  if (params.has('tod')) gr.sky.timeOfDay = num('tod', 0.4);
  if (params.has('season')) gr.seasons.phase = num('season', 0.3) % 1;
  if (params.get('play') === '1') startGame();
  else showMainMenu();
  requestAnimationFrame(loop);
}

function startGame() {
  state = 'play';
  menuEl = null;
  G.uFogOn.value = 1;
  gr.cam.cinematic = false;
  game.ai.forEach((a) => (a.level = opts.ai));
  const hq = game.buildings.get(game.players[game.local].hq);
  if (hq) {
    gr.cam.jumpTo(hq.cx, hq.cz + 3);
    gr.cam.zoomTo(28);
  }
  hud = new HUD(game, gr, audio, {
    getSpeed: () => speed,
    setSpeed: (s) => { speed = s; if (s > 0) pausedSpeed = s; },
    restart: () => { void restart(); },
    openMenu: openGameMenu,
  }, uiRoot);
  gr.onEvent = (e) => hud?.onEvent(e);
  (window as any).hud = hud;
  hud.message('Welcome, my liege! Build woodcutters, a sawmill and a stonecutter to begin.', undefined, undefined, 'good');
  try { audio.start(); } catch { /* needs a gesture */ }
}

// ---------------------------------------------------------------- input
function setupGlobalInput() {
  const startAudio = () => {
    try {
      if (!audio.started) audio.start();
      else audio.unlock();
    } catch { /* audio unavailable */ }
  };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (gameMenu) {
      // the open menu takes every key; Esc steps back, F10 closes
      if (k === 'Escape') { e.preventDefault(); gameMenu.back(); }
      else if (k === 'F10') { e.preventDefault(); gameMenu.close(); }
      return;
    }
    if (state !== 'play' || !hud) return;
    if (k === 'F10') { e.preventDefault(); openGameMenu(); return; }
    if (k === 'Escape') {
      if (hud.cancelMode()) { /* left the targeting mode */ }
      else if (gr.orders.chosen.length) hud.selectSoldiers([]);
      else if (gr.selected) hud.select(null);
      else openGameMenu();
      return;
    }
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (k === ' ') { e.preventDefault(); speed = speed === 0 ? pausedSpeed : 0; }
    else if (k === '1') speed = pausedSpeed = 1;
    else if (k === '2') speed = pausedSpeed = 2;
    else if (k === '3') speed = pausedSpeed = 3;
    else if (k === '4') speed = pausedSpeed = 4;
    else if ((k === 'r' || k === 'R') && gr.orders.chosen.length) hud.returnToDuty();
    else if (k === 'n' || k === 'N') {
      const n = audio.skipTrack(e.shiftKey ? -1 : 1);
      if (n) hud.message(`Music: track ${n} of ${audio.trackCount}`);
    } else if (k === 'h' || k === 'H') {
      const hq = game.buildings.get(game.players[game.local].hq);
      if (hq) gr.cam.jumpTo(hq.cx, hq.cz + 3);
    } else if (k === 'Delete' || k === 'Backspace') {
      const sel = gr.selected;
      if (sel?.kind === 'building') {
        const b = game.buildings.get(sel.id);
        if (b && b.owner === game.local && b.type !== 'hq') { game.destroyBuilding(b, true); hud.select(null); }
      }
    }
  });
}

function bindCanvas(c: HTMLCanvasElement) {
  let downX = 0, downY = 0, downBtn = -1, multiTouch = false;
  const active = new Set<number>();
  // left-drag with the mouse draws a box around soldiers to pick
  let box: HTMLElement | null = null;
  const boxEnd = () => { box?.remove(); box = null; };
  c.addEventListener('pointerdown', (e) => {
    boxEnd();
    active.add(e.pointerId);
    if (active.size > 1) multiTouch = true;
    if (active.size === 1) { downX = e.clientX; downY = e.clientY; downBtn = e.button; multiTouch = false; }
    if (e.pointerType === 'touch' && state === 'play') {
      // update hover so taps place buildings where the finger is
      const p = gr.pickGround(e.clientX, e.clientY);
      gr.hoverNode = gr.pickNode(p);
    }
  });
  let tipT = 0;
  c.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    if (e.pointerType === 'mouse' && (e.buttons & 1) && downBtn === 0 && hud && !gr.placing && !gr.casting && !gr.expedition && !gr.prospecting && !gr.pioneering
      && (box || Math.hypot(e.clientX - downX, e.clientY - downY) > 8)) {
      if (!box) { box = document.createElement('div'); box.className = 'selbox'; uiRoot.appendChild(box); }
      box.style.left = `${Math.min(downX, e.clientX)}px`;
      box.style.top = `${Math.min(downY, e.clientY)}px`;
      box.style.width = `${Math.abs(e.clientX - downX)}px`;
      box.style.height = `${Math.abs(e.clientY - downY)}px`;
      hud.hideTip();
      return;
    }
    const p = gr.pickGround(e.clientX, e.clientY);
    gr.hoverNode = gr.pickNode(p);
    gr.hoverPoint = p;
    if (e.pointerType === 'touch') return;
    // hover tooltip for buildings (throttled)
    const now = performance.now();
    if (!hud || gr.placing || gr.casting || gr.expedition || gr.prospecting || gr.pioneering || e.buttons) { hud?.hideTip(); return; }
    if (now - tipT < 90) { hud.moveTip(e.clientX, e.clientY); return; }
    tipT = now;
    const shipId = gr.pickShip(e.clientX, e.clientY);
    const sh = shipId ? game.ships.get(shipId) : undefined;
    if (sh) {
      hud.showTip(e, `<b>⛵ ${sh.name}</b><br><span class="muted">${game.players[sh.owner].name}</span>`);
      c.style.cursor = 'pointer';
      return;
    }
    const b = gr.pickBuilding(e.clientX, e.clientY);
    const w = game.world;
    if (b && w.explored[w.idx(Math.round(b.cx), Math.round(b.cz))]) {
      const owner = game.players[b.owner];
      const st = b.state === 'done' ? (b.def.military ? `Garrison ${b.garrison.length}` : b.status) : b.state === 'burning' ? 'Burning' : 'Under construction';
      // with soldiers picked: what a right-click would have them do
      const n = gr.orders.chosen.length;
      const act = n && b.def.military && b.state === 'done' ? (b.owner !== game.local ? `<br><b class="bad">Right-click: storm it with ${n}</b>` : '<br><b>Right-click: man it</b>') : '';
      hud.showTip(e, `<b>${b.def.name}</b><br><span class="muted">${owner.name}</span>${st ? `<br>${st}` : ''}${act}`);
      c.style.cursor = 'pointer';
    } else {
      hud.hideTip();
      c.style.cursor = '';
    }
  });
  c.addEventListener('pointerleave', () => hud?.hideTip());
  const up = (e: PointerEvent) => {
    active.delete(e.pointerId);
    if (box) {
      const r = box.getBoundingClientRect();
      boxEnd();
      if (hud && state === 'play') hud.selectSoldiers(gr.orders.inRect(gr.cam.camera, c, r.left, r.top, r.right, r.bottom), e.shiftKey);
      return;
    }
    if (state !== 'play' || !hud) return;
    if (multiTouch) { if (active.size === 0) multiTouch = false; return; }
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > (e.pointerType === 'touch' ? 12 : 6);
    if (moved || e.button !== downBtn) return;
    if (e.button === 0) onClick(e);
    else if (e.button === 2) {
      if (hud.cancelMode()) return;
      // with soldiers picked, a right-click gives them their orders
      if (gr.orders.chosen.length) hud.commandAt(e.clientX, e.clientY);
      else hud.select(null);
    }
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', (e) => { active.delete(e.pointerId); boxEnd(); });
  // double-click a soldier: every one of his kind in view
  c.addEventListener('dblclick', (e) => {
    if (state !== 'play' || !hud || gr.placing || gr.casting || gr.expedition || gr.prospecting || gr.pioneering || gr.commanding) return;
    const s = gr.pickSettler(e.clientX, e.clientY, 26);
    if (!s || !gr.orders.chosen.includes(s.id)) return;
    const r = c.getBoundingClientRect();
    hud.selectSoldiers(gr.orders.inRect(gr.cam.camera, c, r.left, r.top, r.right, r.bottom, s.job), e.shiftKey);
  });
}

function onClick(e: PointerEvent) {
  if (!hud) return;
  if (gr.commanding) {
    if (hud.commandAt(e.clientX, e.clientY, gr.commanding) && !e.shiftKey) hud.startCommanding(null);
    return;
  }
  if (gr.casting) {
    const p = gr.pickGround(e.clientX, e.clientY);
    if (p) hud.castAt(p.x, p.z, e.shiftKey);
    return;
  }
  if (gr.expedition) {
    const p = gr.pickGround(e.clientX, e.clientY);
    if (p) hud.expeditionAt(p.x, p.z);
    return;
  }
  if (gr.prospecting) {
    const p = gr.pickGround(e.clientX, e.clientY);
    if (p) hud.prospectAt(p.x, p.z, e.shiftKey);
    return;
  }
  if (gr.pioneering) {
    const p = gr.pickGround(e.clientX, e.clientY);
    if (p) hud.pioneerAt(p.x, p.z, e.shiftKey);
    return;
  }
  if (gr.placing) {
    const node = gr.hoverNode;
    if (node < 0) return;
    const w = game.world;
    const a = game.anchorFor(gr.placing, w.nx(node), w.ny(node));
    const err = game.placeError(gr.placing, game.local, a.x, a.y);
    if (err) { hud.message(err, undefined, undefined, 'bad'); audio.play('click'); return; }
    game.placeBuilding(gr.placing, game.local, a.x, a.y);
    if (!e.shiftKey) hud.startPlacing(null);
    return;
  }
  const b = gr.pickBuilding(e.clientX, e.clientY);
  // settlers win when the click is right on them (or no building was hit)
  const s = gr.pickSettler(e.clientX, e.clientY, b ? 12 : 26);
  const ship = s ? 0 : gr.pickShip(e.clientX, e.clientY);
  if (s) hud.select({ kind: 'settler', id: s.id }, e.shiftKey);
  else if (ship) hud.select({ kind: 'ship', id: ship });
  else if (b) hud.select({ kind: 'building', id: b.id });
  else hud.select(null);
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && gr) {
    if (state === 'play') {
      const gdt = gameMenu ? 0 : dt * speed;
      game.update(gdt);
      gr.handleEvents(game.events.splice(0));
      gr.frame(dt, gdt);
      if (!gameMenu) hud?.update(dt);
    } else {
      game.events.length = 0;
      gr.frame(dt, dt * 0.3);
    }
    audio.setListener(gr.cam.target.x, gr.cam.target.z, gr.cam.dist);
    audio.update(dt, gr.sky.night, gr.raining, gr.waterFrac);
  }
  requestAnimationFrame(loop);
}

// debug helper: advance the game manually (used when the tab is not animating)
(window as any).step = (n = 1, dt = 0.05) => {
  for (let i = 0; i < n; i++) {
    game.update(dt * speed);
    gr.handleEvents(game.events.splice(0));
    hud?.update(dt);
  }
  gr.frame(dt, dt * speed);
};

boot().catch((err) => {
  console.error(err);
  uiRoot.innerHTML = `<div class="loading"><div>Could not start the game.</div><div class="muted" style="font-family:var(--font);letter-spacing:0">${String(err?.message ?? err)}. A browser with WebGL 2 is required.</div></div>`;
});
