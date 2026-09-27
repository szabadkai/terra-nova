import './style.css';
import { Game } from './game/game';
import { GameRenderer } from './render/renderer';
import { HUD } from './ui/hud';
import { generateIcons } from './ui/icons';
import { showLoading, showMenu, MenuOptions } from './ui/menu';
import { Audio } from './audio/audio';
import { G } from './render/shaderPatch';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const params = new URLSearchParams(location.search);

const opts: MenuOptions = {
  seed: Number(params.get('seed') ?? Math.floor(Math.random() * 99999) + 1),
  size: Number(params.get('size') ?? 160),
  players: Number(params.get('players') ?? 2),
  ai: Number(params.get('ai') ?? 1),
};

const audio = new Audio();
let game: Game;
let gr: GameRenderer;
let hud: HUD | null = null;
let state: 'menu' | 'play' = 'menu';
let speed = 1;
let pausedSpeed = 1;

function reloadWith(o: MenuOptions, play = false) {
  const p = new URLSearchParams({ seed: String(o.seed), size: String(o.size), players: String(o.players), ai: String(o.ai) });
  if (play) p.set('play', '1');
  location.search = p.toString();
}

async function boot() {
  const loading = showLoading(uiRoot, 'Shaping the land…');
  await new Promise((r) => setTimeout(r, 30));
  game = new Game({ size: opts.size, seed: opts.seed, players: opts.players, aiLevel: opts.ai });
  gr = new GameRenderer(canvas, game);
  gr.setSound((n, x, z, v) => audio.play(n, x, z, v));
  generateIcons(game.local);
  (window as any).game = game;
  (window as any).gr = gr;
  loading.remove();
  setupInput();
  if (params.get('tod')) { gr.sky.timeOfDay = Number(params.get('tod')); }
  if (params.get('play') === '1') startGame();
  else {
    G.uFogOn.value = 0;
    gr.cam.cinematic = true;
    gr.cam.zoomTo(46, true);
    gr.sky.timeOfDay = params.get('tod') ? Number(params.get('tod')) : 0.62;
    showMenu(uiRoot, opts, startGame, (o) => reloadWith(o));
  }
  requestAnimationFrame(loop);
}

function startGame() {
  state = 'play';
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
    restart: () => reloadWith({ ...opts, seed: Math.floor(Math.random() * 99999) + 1 }),
  }, uiRoot);
  gr.onEvent = (e) => hud?.onEvent(e);
  (window as any).hud = hud;
  hud.message('Welcome, my liege! Build woodcutters, a sawmill and a stonecutter to begin.', undefined, undefined, 'good');
  try { audio.start(); } catch { /* needs a gesture */ }
}

// ---------------------------------------------------------------- input
function setupInput() {
  let downX = 0, downY = 0, downBtn = -1;
  const startAudio = () => { if (!audio.started) audio.start(); else if (audio.ctx?.state === 'suspended') audio.ctx.resume(); };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);
  canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; downBtn = e.button; });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    const p = gr.pickGround(e.clientX, e.clientY);
    gr.hoverNode = gr.pickNode(p);
    gr.hoverPoint = p;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (state !== 'play' || !hud) return;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 6;
    if (moved || e.button !== downBtn) return;
    if (e.button === 0) onClick(e);
    else if (e.button === 2) {
      if (gr.placing) hud.startPlacing(null);
      else hud.select(null);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (state !== 'play' || !hud) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    const k = e.key;
    if (k === 'Escape') { if (gr.placing) hud.startPlacing(null); else hud.select(null); }
    else if (k === ' ') { e.preventDefault(); speed = speed === 0 ? pausedSpeed : 0; }
    else if (k === '1') speed = pausedSpeed = 1;
    else if (k === '2') speed = pausedSpeed = 2;
    else if (k === '3') speed = pausedSpeed = 3;
    else if (k === '4') speed = pausedSpeed = 4;
    else if (k === 'h' || k === 'H') {
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

function onClick(e: PointerEvent) {
  if (!hud) return;
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
  if (s) hud.select({ kind: 'settler', id: s.id });
  else if (b) hud.select({ kind: 'building', id: b.id });
  else hud.select(null);
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state === 'play') {
    game.update(dt * speed);
    gr.handleEvents(game.events.splice(0));
    gr.frame(dt, dt * speed);
    hud?.update(dt);
  } else {
    game.events.length = 0;
    gr.frame(dt, dt * 0.3);
  }
  audio.setListener(gr.cam.target.x, gr.cam.target.z, gr.cam.dist);
  audio.update(dt, gr.sky.night, gr.raining, 0);
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

boot();
