import './style.css';
import { Game, TICK } from './game/game';
import { Lockstep, SPEEDS, TURN_S, type TurnPacket } from './net/lockstep';
import { BUILD, GameRoom, cleanCode, newCode, type Seat, type StartMsg } from './net/room';
import { Lobby } from './ui/lobby';
import { GameRenderer } from './render/renderer';
import { HUD } from './ui/hud';
import { generateIcons } from './ui/icons';
import { showLoading, showMenu, MenuOptions } from './ui/menu';
import { GameMenu } from './ui/gameMenu';
import { applyAudioPrefs, applyRenderPrefs, detectGraphics, firstRun, prefs, savePrefs } from './ui/prefs';
import { levelText } from './render/hardware';
import { enterImmersive, onImmersiveChange, toggleImmersive } from './ui/immersive';
import { Audio } from './audio/audio';
import { CursorSetter, type CursorKind } from './ui/cursors';
import { JOB_NAMES } from './game/defs';
import { isCombatant } from './game/military';
import { commandable, planFormation } from './game/orders';
import { afloat, canBombard } from './game/naval';
import type { Settler } from './game/types';
import { G } from './render/shaderPatch';
import { lodReady } from './render/lod';
import { framePace } from './render/framePace';
import { decodeSave, describe, encodeSave, restore, snapshot, type SaveData, type SaveMeta } from './game/save';
import { AUTO, deleteSave, getSave, getSummary, listSaves, playTime, putSave, warmUp } from './ui/saveStore';
import { missionById, missionIndex, nextMission, numeralOf } from './game/campaign';
import { markDone, progress, saveProgress } from './ui/campaignStore';
import { showCampaignPage } from './ui/campaign';

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
/** the free-play settings while a campaign mission's own are in `opts`, to go back to */
let freeOpts: MenuOptions = { ...opts };

const audio = new Audio();
applyAudioPrefs(audio);
let game: Game;
let gr: GameRenderer;
let hud: HUD | null = null;
let menuEl: HTMLElement | null = null;
/** the Esc menu in a game, or the options modal on the title screen; the game is paused while it is open */
let gameMenu: GameMenu | null = null;
let state: 'menu' | 'play' = 'menu';
/** steps the game: alone, or in lockstep with the other players of a networked game */
let driver: Lockstep;
/** the room of a game with a friend, from its lobby on */
let room: GameRoom | null = null;
/** the game with a friend being played: who sits where, this machine's seat, the input delay in turns */
let net: { seats: Seat[]; local: number; delay: number } | null = null;
/** the other player's turn packets that came before this machine's game was built */
let earlyTurns: { slot: number; pkt: TurnPacket }[] = [];
let lobby: Lobby | null = null;
/** the player the building and goods icons were drawn for (their banner colour), -1 none yet */
let iconsFor = -1;
let islands = params.get('islands') !== '0';

// ---------------------------------------------------------------- saving
/** Set while a game is being played, so reloading the page picks it up again. */
const RESUME_KEY = 'terra-nova.resume.v1';
const AUTOSAVE_EVERY = 30; // seconds of real time
let autosaveT = AUTOSAVE_EVERY;
let autosavedAt = -1; // game time of the last autosave

function setResume(on: boolean) {
  try {
    if (on) localStorage.setItem(RESUME_KEY, '1');
    else localStorage.removeItem(RESUME_KEY);
  } catch { /* storage blocked */ }
}
function wantsResume() {
  try { return localStorage.getItem(RESUME_KEY) === '1'; } catch { return false; }
}

/** The running game as a save, with the view and chronicle so it looks the same when loaded. */
function capture(): { data: SaveData; meta: SaveMeta } {
  const ui = {
    cam: { x: gr.cam.target.x, z: gr.cam.target.z, dist: gr.cam.dist, yaw: gr.cam.yaw, tilt: gr.cam.tilt },
    tod: gr.sky.timeOfDay,
    season: gr.seasons.phase,
    speed: driver.pausedSpeed,
    objective: hud?.objectives.index ?? 0,
    groups: hud?.saveGroups(),
    tips: hud?.saveTips(),
    trails: gr.trails.save(),
  };
  const meta = describe(game);
  meta.thumb = thumbnail();
  return { data: snapshot(game, ui), meta };
}

/** The explored part of the minimap, squared up, as a small picture for the save list. */
function thumbnail(): string | undefined {
  const mm = hud?.minimap.canvas;
  if (!mm) return undefined;
  try {
    const w = game.world;
    let x0 = w.W, y0 = w.H, x1 = 0, y1 = 0;
    for (let i = 0; i < w.N; i++) {
      if (!w.explored[i]) continue;
      const x = i % w.W, y = (i / w.W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < x0) return undefined;
    const side = Math.min(w.W, Math.max(x1 - x0, y1 - y0, 24) + 6);
    const sx = Math.max(0, Math.min(w.W - side, (x0 + x1 - side) / 2)), sy = Math.max(0, Math.min(w.H - side, (y0 + y1 - side) / 2));
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    // (a CPU canvas, like the minimap, so the thumbnail never waits on the GPU)
    c.getContext('2d', { willReadFrequently: true })!.drawImage(mm, sx * mm.width / w.W, sy * mm.height / w.H, side * mm.width / w.W, side * mm.height / w.H, 0, 0, 96, 96);
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return undefined;
  }
}

/** Keep the autosave slot up to date. `now` commits at once, for a page that is going away. */
function autosave(now = false) {
  // (a game with a friend is not saved: it cannot be picked up alone)
  if (net || state !== 'play' || !game || game.time === autosavedAt) return;
  try {
    const { data, meta } = capture();
    autosavedAt = game.time;
    putSave(AUTO, 'Autosave', meta, data, now).catch((e) => console.warn('Autosave failed:', e));
  } catch (e) {
    console.warn('Autosave failed:', e);
  }
}

async function saveGame(name: string, id = `save-${Date.now()}`) {
  const { data, meta } = capture();
  await putSave(id, name, meta, data);
}

async function loadSave(id: string) {
  const data = await getSave(id);
  if (!data) throw new Error('That saved game is gone');
  await loadGame(data);
}

async function loadGame(data: SaveData) {
  await buildWorld(data);
  startGame(data.ui ?? {});
}

async function exportSave() {
  const { data } = capture();
  const bytes = await encodeSave(data);
  const a = document.createElement('a');
  const mins = Math.floor(game.time / 60);
  a.download = `terra-nova-seed${game.opts.seed}-${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}.tnsave`;
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importSave(file: File) {
  const data = await decodeSave(new Uint8Array(await file.arrayBuffer()));
  await loadGame(data);
}

const saveHooks = {
  list: listSaves,
  save: saveGame,
  load: loadSave,
  remove: deleteSave,
  exportFile: exportSave,
  importFile: importSave,
};

/** Create (or re-create) the world in place — no page reloads, so it also works inside sandboxed frames. */
async function buildWorld(from?: SaveData) {
  const loading = showLoading(uiRoot, from ? 'Unrolling the map…' : 'Shaping the land…');
  await new Promise((r) => setTimeout(r, 30));
  let loaded: Game | null = null;
  if (from) {
    // a save that fails to load leaves the current world as it was
    try { loaded = restore(from); } catch (e) { loading.remove(); throw e; }
  }
  gameMenu?.close();
  menuEl?.remove();
  menuEl = null;
  if (gr) {
    gr.dispose();
    const fresh = document.createElement('canvas');
    fresh.id = 'c';
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  if (hud) { hud.root.remove(); hud = null; }
  state = 'menu';
  if (loaded) {
    game = loaded;
    // (the mission too, or "Restart" after loading a mission's save would play its map as free play)
    Object.assign(opts, { seed: game.opts.seed, size: game.opts.size, players: game.opts.players, ai: game.ai[0]?.level ?? game.opts.aiLevel, mission: game.opts.mission });
    if (!opts.mission) delete opts.mission;
    islands = game.opts.islands !== false;
  } else {
    game = new Game({ size: opts.size, seed: opts.seed, players: opts.players, aiLevel: opts.ai, islands, humans: net ? net.seats.length : 1, local: net?.local ?? 0, mission: net ? undefined : opts.mission });
  }
  driver = new Lockstep(game, net ? net.seats.map((s) => s.slot).sort((a, b) => a - b) : [game.local], net?.delay ?? 0);
  if (net && room) {
    const r = room;
    driver.send = (pkt) => r.sendTurn(pkt);
    driver.start();
    for (const e of earlyTurns.splice(0)) driver.onPacket(e.slot, e.pkt);
  }
  gr = new GameRenderer(canvas, game);
  applyRenderPrefs(gr);
  gr.setSound((n, x, z, v) => audio.play(n, x, z, v));
  bindCanvas(canvas);
  if (iconsFor !== game.local) { generateIcons(game.local); iconsFor = game.local; }
  (window as any).game = game;
  (window as any).gr = gr;
  (window as any).driver = driver;
  await gr.warmUp();
  // the first run in this browser: the graphics are picked for the machine, once
  if (firstRun && !prefs.hw.level) {
    const text = loading.lastElementChild;
    if (text) text.textContent = 'Fitting the graphics to this machine…';
    await new Promise((r) => setTimeout(r, 30));
    const d = detectGraphics(gr, game);
    prefs.hw.told = false;
    savePrefs();
    console.info(`Graphics: ${levelText(d.level, d.ao).toLowerCase()} for ${d.guess.gpu.label}${d.timed.length ? ` (timed ${d.timed.map(([q, ms, ao]) => `${q}${ao ? ' + AO' : ''} ${ms.toFixed(1)} ms`).join(', ')})` : ''}`);
  }
  loading.remove();
}

/** Tell the player once what the detection chose: on the title screen, or in the first game. */
function graphicsChosen() {
  if (!prefs.hw.level || prefs.hw.told) return null;
  prefs.hw.told = true;
  savePrefs();
  return `Graphics set to ${levelText(prefs.hw.level, prefs.hw.ao)} for this machine`;
}

function showMainMenu() {
  G.uFogOn.value = 0;
  gr.cam.cinematic = true;
  gr.cam.zoomTo(46, true);
  gr.sky.timeOfDay = params.has('tod') ? num('tod', 0.62) : 0.62;
  menuEl?.remove();
  const menu = showMenu(uiRoot, opts, () => startGame(), async (o) => {
    Object.assign(opts, o);
    menuEl?.remove();
    menuEl = null;
    await buildWorld();
    showMainMenu();
  }, () => openOptions(), () => openOptions('load'), () => openLobby(), () => openCampaign());
  menuEl = menu.el;
  const next = nextMission(progress.done);
  menu.setCampaignSub(next ? `Next: ${numeralOf(missionIndex(next.id))} · ${next.title}` : 'The province is yours');
  const chosen = graphicsChosen();
  if (chosen) menu.note(`${chosen}.`, 'Change', () => openOptions());
  // the last game, if there is one, can be picked up where it was left (a mission already won is not offered again)
  getSummary(AUTO).then((sum) => {
    if (sum && menuEl === menu.el && !(sum.meta.mission && sum.meta.won)) menu.offerContinue(sum.meta, () => { void resumeAuto(menu.el); });
  }).catch(() => { /* no saves */ });
}

async function resumeAuto(from: HTMLElement) {
  try {
    await loadSave(AUTO);
  } catch (e) {
    if (from.isConnected) showMenuError(from, e);
  }
}

function showMenuError(menu: HTMLElement, e: unknown) {
  const card = menu.querySelector('.menu-card');
  card?.querySelector('.menu-err')?.remove();
  const p = document.createElement('p');
  p.className = 'menu-err';
  p.textContent = `Could not load the game: ${(e as Error)?.message ?? e}`;
  card?.prepend(p);
}

/** Settings (and saved games) over the title screen. */
function openOptions(page?: 'load') {
  if (gameMenu) return;
  gameMenu = new GameMenu(uiRoot, { game, gr, audio, inGame: false, page, saves: saveHooks, onClose: () => { gameMenu = null; } });
}

/** The Esc menu: pauses the game until it is closed. */
function openGameMenu(page?: 'graphics') {
  if (gameMenu || state !== 'play') return;
  hud?.hideTip();
  gr.cam.inputEnabled = false;
  audio.setPaused(true);
  gameMenu = new GameMenu(uiRoot, {
    game, gr, audio, inGame: true, net: !!net, objectives: hud?.objectives, saves: saveHooks, page,
    onClose: () => { gameMenu = null; gr.cam.inputEnabled = true; audio.setPaused(false); },
    onRestart: () => { void restartMap(); },
    onQuit: () => { void restart(); },
  });
}

/** Play the same map again from the start (the same mission, in the campaign). */
async function restartMap() {
  audio.stopVoice();
  await buildWorld();
  startGame();
}

/** Back to the title screen. The game stays in the autosave slot, to be continued from there. */
async function restart() {
  autosave();
  setResume(false);
  leaveRoom();
  audio.stopVoice();
  // a mission's settings give way to the free-play ones again
  if (opts.mission) { Object.assign(opts, freeOpts); delete opts.mission; islands = params.get('islands') !== '0'; }
  opts.seed = Math.floor(Math.random() * 99999) + 1;
  await buildWorld();
  showMainMenu();
}

// ---------------------------------------------------------------- the campaign
/** The mission's map and rules take the place of the menu's settings. */
function applyMissionOpts(id: string) {
  const m = missionById(id);
  if (!m) return false;
  if (!opts.mission) freeOpts = { ...opts };
  Object.assign(opts, { seed: m.map.seed, size: m.map.size, players: m.map.players, ai: m.map.aiLevel, mission: id });
  islands = m.map.islands !== false;
  progress.current = id;
  saveProgress();
  return true;
}

async function startMission(id: string) {
  if (!applyMissionOpts(id)) return;
  audio.stopVoice();
  leaveRoom();
  uiRoot.querySelector('#campbox')?.remove();
  menuEl?.remove();
  menuEl = null;
  await buildWorld();
  startGame();
}

/** The mission list over the title screen. Its current mission picks up the autosave when that is where it was left. */
function openCampaign() {
  showCampaignPage(uiRoot, progress, (id) => {
    void (async () => {
      const sum = await getSummary(AUTO).catch(() => null);
      if (sum?.meta.mission === id && !sum.meta.won && !progress.done[id] && menuEl) return resumeAuto(menuEl);
      await startMission(id);
    })();
  });
}

function markMissionDone() {
  if (!game.opts.mission) return;
  markDone(game.opts.mission, game.time);
  autosave();
}

// ---------------------------------------------------------------- playing with a friend
function leaveRoom() {
  room?.leave();
  room = null;
  net = null;
  earlyTurns = [];
  lobby?.remove();
  lobby = null;
}

function openLobby() {
  menuEl?.remove();
  menuEl = null;
  lobby = new Lobby(uiRoot, opts, {
    host: () => hostGame(),
    join: (code) => joinGame(code),
    start: () => { void startHosted(); },
    back: () => { leaveRoom(); showMainMenu(); },
  });
}

/** The game's options as the host has them set on the title screen (at least two kingdoms, for the two people). */
const hostedOpts = () => ({ size: opts.size, seed: opts.seed, players: Math.max(2, opts.players), aiLevel: opts.ai, islands });

/** Join the room `code` names: the turn packets go to the driver once this machine's game is built, and wait until then. */
function openRoom(code: string): GameRoom {
  const r = new GameRoom(code);
  room = r;
  r.onError = (text) => lobby?.status(`The relays could not be reached: ${text}`, true);
  r.onTurn = (peer, pkt) => {
    const slot = net?.seats.find((s) => s.peer === peer)?.slot;
    if (slot === undefined) return;
    if (driver && driver.humans.length > 1) driver.onPacket(slot, pkt);
    else earlyTurns.push({ slot, pkt });
  };
  return r;
}

/** A player has gone from a game under way: it stands still. */
function peerLeft(slot: number) {
  driver.frozen = true;
  hud?.netLeft(slot);
}

/** the seats of the game this machine hosts: the host first, the first friend to arrive second */
let seats: Seat[] = [];
function hostGame() {
  const r = openRoom(newCode());
  seats = [{ peer: r.me, slot: 0 }];
  lobby?.showRoom(r.code, true);
  const publish = () => {
    lobby?.setSeats(seats.map((s) => ({ slot: s.slot, who: s.peer === r.me ? 'you, the host' : 'your friend' })), hostedOpts().players, opts.ai);
    lobby?.canStart(seats.length >= 2);
    lobby?.status(seats.length >= 2 ? 'Your friend is here. Start when you are ready.' : 'Waiting for your friend to join with the code…');
    r.sendLobby({ opts: hostedOpts(), seats, host: r.me, build: BUILD });
  };
  publish();
  r.onHello = (peer, build) => {
    if (build !== BUILD) { lobby?.status('Your friend runs another version of the game: reload the page on both machines', true); return; }
    if (!seats.some((s) => s.peer === peer) && seats.length < 2) seats.push({ peer, slot: 1 });
    publish();
  };
  r.onPeers = (peers) => {
    const gone = seats.filter((s) => s.peer !== r.me && !peers.includes(s.peer));
    if (!gone.length) return;
    if (net) peerLeft(gone[0].slot);
    else { seats = seats.filter((s) => !gone.includes(s)); publish(); }
  };
}

/** The host starts: the input delay is set from the round trip to the friend, then everyone builds the same game. */
async function startHosted() {
  const r = room;
  if (!r || seats.length < 2) return;
  lobby?.canStart(false);
  lobby?.status('Measuring the way to your friend…');
  let rtt = 120;
  try { rtt = await r.ping(seats[1].peer); } catch { /* keep the guess */ }
  const delay = Math.max(2, Math.min(5, Math.ceil((rtt * 1.5) / (TURN_S * 1000)) + 1));
  const msg: StartMsg = { opts: { ...hostedOpts(), humans: 2 }, seats, delay, build: BUILD };
  r.sendStart(msg);
  console.info(`Hosting: round trip ${Math.round(rtt)} ms, input delay ${delay} turns`);
  await startNetGame(msg);
}

function joinGame(codeIn: string) {
  const code = cleanCode(codeIn);
  if (code.length !== 6) { lobby?.status('A room code has six letters', true); return; }
  const r = openRoom(code);
  lobby?.showRoom(code, false);
  lobby?.status('Looking for the host…');
  r.onPeers = (peers) => {
    if (net) { if (!peers.includes(net.seats[0].peer)) peerLeft(net.seats[0].slot); return; }
    if (peers.length) r.sayHello();
    else lobby?.status('Looking for the host…');
  };
  r.onLobby = (l) => {
    if (l.build !== BUILD) { lobby?.status('The host runs another version of the game: reload the page on both machines', true); return; }
    const mine = l.seats.find((s) => s.peer === r.me);
    lobby?.setSeats(l.seats.map((s) => ({ slot: s.slot, who: s.peer === r.me ? 'you' : s.peer === l.host ? 'your friend, the host' : 'another player' })), Math.max(2, l.opts.players), l.opts.aiLevel);
    lobby?.status(mine ? 'Waiting for the host to start the game…' : 'The room is full', !mine);
  };
  r.onStart = (s) => { if (s.build === BUILD) void startNetGame(s); };
}

/** Both machines build the same game from the host's options, each in its own seat. */
async function startNetGame(s: StartMsg) {
  const r = room;
  if (!r) return;
  const mine = s.seats.find((x) => x.peer === r.me);
  if (!mine) { lobby?.status('There is no seat for you in this game', true); return; }
  net = { seats: s.seats, local: mine.slot, delay: s.delay };
  Object.assign(opts, { seed: s.opts.seed, size: s.opts.size, players: s.opts.players, ai: s.opts.aiLevel });
  islands = s.opts.islands !== false;
  lobby?.remove();
  lobby = null;
  await buildWorld();
  startGame();
}

async function boot() {
  // the display's refresh rate, read off a few empty animation frames before anything heavy runs
  await framePace.probe();
  void warmUp();
  // models are simplified for the distance as the world is built
  await lodReady;
  // a game that was being played when the page went away carries on (unless the URL asks for a new one)
  let resumed: SaveData | null = null;
  // ?mission=<id> goes straight into a campaign mission (handy while working on one)
  const devMission = params.has('mission') && applyMissionOpts(params.get('mission')!);
  if (wantsResume() && !params.has('play') && !params.has('seed') && !devMission) {
    try {
      resumed = await getSave(AUTO);
      if (resumed) await buildWorld(resumed);
    } catch (e) {
      console.warn('Could not resume the last game:', e);
      resumed = null;
      setResume(false);
    }
  }
  if (!resumed) await buildWorld();
  setupGlobalInput();
  if (params.has('tod')) gr.sky.timeOfDay = num('tod', 0.4);
  if (params.has('season')) gr.seasons.phase = num('season', 0.3) % 1;
  if (resumed) startGame(resumed.ui ?? {});
  else if (params.get('play') === '1' || devMission) startGame();
  else showMainMenu();
  requestAnimationFrame(loop);
}

/** Start playing the world that was built, fresh or (with `resumed`) from a save's view. */
function startGame(resumed?: Record<string, unknown>) {
  state = 'play';
  menuEl = null;
  G.uFogOn.value = 1;
  gr.cam.cinematic = false;
  // (a mission sets its rivals' levels itself)
  if (!game.mission) game.ai.forEach((a) => (a.level = opts.ai));
  const view = resumed as { cam?: { x: number; z: number; dist: number; yaw: number; tilt?: number }; tod?: number; season?: number; speed?: number; objective?: number } | undefined;
  const hq = game.buildings.get(game.players[game.local].hq);
  if (view?.cam) {
    gr.cam.jumpTo(view.cam.x, view.cam.z, true);
    gr.cam.zoomTo(view.cam.dist, true);
    gr.cam.setYaw(view.cam.yaw);
    if (typeof view.cam.tilt === 'number') gr.cam.setTilt(view.cam.tilt);
  } else if (hq) {
    gr.cam.jumpTo(hq.cx, hq.cz + 3);
    gr.cam.zoomTo(28);
  }
  if (typeof view?.tod === 'number') gr.sky.timeOfDay = view.tod;
  if (typeof view?.season === 'number') gr.seasons.phase = view.season;
  // the paths worn so far (a save from before them starts from the game's own wear)
  if (view) gr.trails.load((resumed as { trails?: unknown }).trails);
  driver.speed = driver.pausedSpeed = SPEEDS.includes(view?.speed ?? 1) && view?.speed ? view.speed : 1;
  hud = new HUD(game, gr, audio, {
    getSpeed: () => driver.speed,
    issue: (c) => driver.issue(c),
    isHost: () => !net || driver.humans[0] === game.local,
    restart: () => { void restart(); },
    restartMap: () => { void restartMap(); },
    nextMission: () => { const n = nextMission(progress.done); if (n) void startMission(n.id); else void restart(); },
    openMenu: (page) => openGameMenu(page),
  }, uiRoot);
  gr.onEvent = (e) => { if (e.type === 'missionwon') markMissionDone(); hud?.onEvent(e); };
  (window as any).hud = hud;
  if (view) {
    hud.loadGroups((resumed as { groups?: unknown }).groups);
    hud.loadTips((resumed as { tips?: unknown }).tips);
    hud.objectives.index = view.objective ?? 0;
    hud.objectives.render();
    if (game.mission) { if (game.time >= 1) hud.message(`Welcome back, legate — ${playTime(game.time)} into the mission.`, undefined, undefined, 'good'); }
    else hud.message(`Welcome back, my liege — ${playTime(game.time)} into your reign.`, undefined, undefined, 'good');
  } else if (net) {
    driver.onEvent = (e) => hud?.netEvent(e);
    const others = net.seats.filter((s) => s.slot !== game.local).map((s) => game.players[s.slot].name);
    hud.message(`${others.join(' and ')} ${others.length > 1 ? 'are' : 'is'} in the game with you${net.local === 0 ? '; you set its pace' : '; the host sets its pace'}.`, undefined, undefined, 'good');
  } else if (!game.mission) {
    hud.message('Welcome, my liege! Build woodcutters, a sawmill and a stonecutter to begin.', undefined, undefined, 'good');
  }
  // a mission opens with the quaestor's briefing; the clock waits for Begin (a reload during it hears it again)
  if (game.mission && !net && (!view || game.time < 1)) hud.showBriefing(() => { /* the clock runs once the briefing is gone (hud.modal holds it) */ });
  const chosen = graphicsChosen();
  if (chosen) hud.toast({ title: chosen, detail: 'Change them in the menu: Esc → Graphics.', action: { label: '🖼 Graphics', run: () => openGameMenu('graphics') }, ttl: 12 });
  try { audio.start(); } catch { /* needs a gesture */ }
  // fills the screen when the game was started by a click; a resumed page has no gesture to spend
  if (prefs.immersive) void enterImmersive();
  setResume(!net);
  autosaveT = AUTOSAVE_EVERY;
  // a new game replaces the autosave at once, so reloading can never bring back the previous one
  autosavedAt = resumed ? game.time : -1;
  if (!resumed) autosave();
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
  onImmersiveChange((on) => hud?.immersiveChanged(on));
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (gameMenu) {
      // the open menu takes every key; Esc steps back, F10 closes
      if (k === 'Escape') { e.preventDefault(); gameMenu.back(); }
      else if (k === 'F10') { e.preventDefault(); gameMenu.close(); }
      return;
    }
    const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT';
    // F fills the screen on the title screen as well as in a game (never Cmd/Ctrl+F: that is find)
    if ((k === 'f' || k === 'F') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { void toggleImmersive(); return; }
    if (state !== 'play' || !hud) return;
    if (hud.modal) {
      // a briefing or debrief is up: Enter takes its main button, nothing else reaches the game
      if (k === 'Enter' || k === ' ') { e.preventDefault(); hud.modal.querySelector<HTMLElement>('button.primary')?.click(); }
      else if (k === 'Escape' || k === 'F10') e.preventDefault();
      return;
    }
    if (k === 'F10') { e.preventDefault(); openGameMenu(); return; }
    if (k === 'Escape') {
      if (hud.cancelMode()) { /* left the targeting mode */ }
      else if (gr.orders.chosen.length) hud.selectSoldiers([]);
      else if (gr.orders.ships.length) hud.selectShips([]);
      else if (gr.selected) hud.select(null);
      else openGameMenu();
      return;
    }
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    // number keys: control groups — Ctrl (or Alt/Option) + number keeps the picked ones, the number
    // picks them again (twice: go there), Shift adds to the picked ones or to the group
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (digit && !e.metaKey) {
      e.preventDefault();
      const slot = Number(digit[1]);
      if (e.ctrlKey || e.altKey) hud.assignGroup(slot, e.shiftKey);
      else hud.recallGroup(slot, e.shiftKey);
      return;
    }
    if ((k === ' ' || k === '[' || k === ']') && net && driver.humans[0] !== game.local) { e.preventDefault(); hud.message('The host sets the pace of the game'); return; }
    if (k === ' ') { e.preventDefault(); driver.issue({ t: 'speed', s: driver.speed === 0 ? driver.pausedSpeed : 0 }); }
    else if (k === '[' || k === ']') {
      const s = Math.max(1, Math.min(SPEEDS[SPEEDS.length - 1], (driver.speed || driver.pausedSpeed) + (k === ']' ? 1 : -1)));
      driver.issue({ t: 'speed', s });
      hud.message(`Game speed ${s}×`);
    } else if ((k === 'r' || k === 'R') && gr.orders.chosen.length) hud.returnToDuty();
    else if ((k === 'r' || k === 'R') && gr.orders.ships.length) hud.shipsHome();
    else if (k === 'n' || k === 'N') {
      const n = audio.skipTrack(e.shiftKey ? -1 : 1);
      if (n) hud.message(`Music: track ${n} of ${audio.trackCount}`);
    } else if (e.code === 'Period' || k === '.') {
      hud.nextStall(e.shiftKey);
    } else if ((k === 'b' || k === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      hud.cycleStallBadges();
    } else if (k === 'h' || k === 'H') {
      const hq = game.buildings.get(game.players[game.local].hq);
      if (hq) gr.cam.jumpTo(hq.cx, hq.cz + 3);
    } else if (k === 'p' || k === 'P') {
      const sel = gr.selected;
      if (sel?.kind === 'building') {
        const b = game.buildings.get(sel.id);
        if (b && b.owner === game.local) hud.togglePriority(b);
      }
    } else if (k === 'Delete' || k === 'Backspace') {
      const sel = gr.selected;
      if (sel?.kind === 'building') {
        const b = game.buildings.get(sel.id);
        if (b && b.owner === game.local && b.type !== 'hq') { driver.issue({ t: 'destroy', id: b.id }); hud.select(null); }
      }
    }
  });
}

/** The mouse over the game view, for hover highlights and cursors that follow the world moving under it. */
const pointer = { x: 0, y: 0, inside: false, buttons: 0, at: 0 };
let cursor: CursorSetter | null = null;
let hoverCursor: CursorKind = 'default';
/** the selection box being drawn, if any */
let box: HTMLElement | null = null;

const targeting = () => !!(gr.placing || gr.casting || gr.expedition || gr.prospecting || gr.pioneering);
const seenAt = (x: number, z: number) => {
  const w = game.world, xi = Math.round(x), zi = Math.round(z);
  return w.inBounds(xi, zi) && !!w.explored[w.idx(xi, zi)];
};

/** Find what the pointer is over: ring it, pick the cursor a click would earn and show its tooltip. */
function refreshHover() {
  pointer.at = performance.now();
  const o = gr.orders;
  o.ghost = null;
  if (!hud || gameMenu || state !== 'play' || !pointer.inside || pointer.buttons || box || gr.cam.drag) {
    o.hover = null;
    if (!pointer.inside || gameMenu) hud?.hideTip();
    return;
  }
  const ev = { clientX: pointer.x, clientY: pointer.y } as MouseEvent;
  if (targeting()) {
    o.hover = null;
    hud.hideTip();
    hoverCursor = gr.placing ? 'default' : 'target';
    return;
  }
  const g = game, w = g.world, me = g.local;
  let b = gr.pickBuilding(pointer.x, pointer.y);
  if (b && !seenAt(b.cx, b.cz)) b = null;
  const s = gr.pickSettler(pointer.x, pointer.y, b ? 12 : 22);
  const shipId = s ? 0 : gr.pickShip(pointer.x, pointer.y);
  const sh = shipId ? g.ships.get(shipId) : undefined;
  o.hover = s ? { kind: 'settler', id: s.id, foe: s.owner !== me } : sh ? { kind: 'ship', id: sh.id, foe: sh.owner !== me } : b ? { kind: 'building', id: b.id, foe: b.owner !== me } : null;

  // with soldiers picked, the cursor tells what a right-click (or the pending order's click) would do
  const chosen = o.chosen.map((id) => g.settlers.get(id)).filter((x): x is Settler => !!x);
  const cmd = gr.commanding;
  hoverCursor = cmd ? 'target' : 'default';
  if (chosen.length) {
    const fort = b && b.def.military && b.state === 'done' ? b : null;
    const foeFort = fort && fort.owner !== me;
    const regionOf = (x: Settler) => w.region[x.inside ? g.buildings.get(x.inside)?.door ?? x.node : x.node];
    if (cmd === 'attack') hoverCursor = foeFort ? 'attack' : 'nogo';
    else if (foeFort && !cmd) hoverCursor = 'attack';
    else if (fort && !cmd && chosen.some((x) => x.job !== 'catapult')) hoverCursor = 'garrison';
    else if (s && s.owner !== me && isCombatant(s) && !cmd) hoverCursor = 'attack';
    else {
      const node = gr.hoverNode;
      const reg = node >= 0 ? w.regionAt(node) : 0;
      if (!reg || !chosen.some((x) => regionOf(x) === reg)) hoverCursor = 'nogo';
      // show where they would form up
      else if (gr.hoverPoint) o.ghost = planFormation(g, me, o.chosen, gr.hoverPoint.x, gr.hoverPoint.z);
    }
  }

  // with warships picked: hunt a ship, bombard a stronghold by the sea, moor at a harbour, sail on open water
  const fleet = o.ships.map((id) => g.ships.get(id)).filter((x): x is NonNullable<typeof x> => !!x && afloat(x));
  if (fleet.length) {
    const foeShip = sh && sh.owner !== me && afloat(sh);
    const fort = b && b.def.military && b.state === 'done' ? b : null;
    const node = gr.hoverNode;
    if (cmd === 'attack') hoverCursor = foeShip || (fort && fort.owner !== me && fleet.some((x) => canBombard(g, x, fort))) ? 'attack' : 'nogo';
    else if (foeShip && !cmd) hoverCursor = 'attack';
    else if (fort && fort.owner !== me && !cmd) hoverCursor = fleet.some((x) => canBombard(g, x, fort)) ? 'attack' : 'nogo';
    else if (b && b.owner === me && b.type === 'harbour' && b.state === 'done' && !cmd) hoverCursor = 'garrison';
    else if (node < 0 || !w.isWater(node)) hoverCursor = 'nogo';
  }

  // tooltips
  if (sh) {
    const hp = Math.max(0, Math.round((sh.hp / sh.maxHp) * 100));
    const act = fleet.length && sh.owner !== me && afloat(sh) ? '<br><b class="bad">Right-click: hunt her</b>' : '';
    hud.showTip(ev, `<b>${sh.kind === 'war' ? '⚓' : '⛵'} ${sh.name}</b><br><span class="muted">${sh.kind === 'war' ? 'Warship · ' : ''}${g.players[sh.owner].name}</span>${hp < 100 ? `<br>Hull ${hp}%` : ''}${act}`);
  } else if (s && isCombatant(s)) {
    const act = chosen.length && s.owner !== me ? '<br><b class="bad">Right-click: march on him</b>' : '';
    hud.showTip(ev, `<b>${JOB_NAMES[s.job]}</b><br><span class="muted">${g.players[s.owner].name}</span><br>Health ${Math.ceil(s.hp)} / ${s.maxHp}${act}`);
  } else if (b) {
    const owner = g.players[b.owner];
    const st = b.state === 'done' ? (b.def.military ? `Garrison ${b.garrison.length}` : b.status) : b.state === 'burning' ? 'Burning' : 'Under construction';
    // with soldiers picked: what a right-click would have them do
    const n = chosen.length;
    let act = n && b.def.military && b.state === 'done' ? (b.owner !== me ? `<br><b class="bad">Right-click: storm it with ${n}</b>` : '<br><b>Right-click: man it</b>') : '';
    if (fleet.length && b.state === 'done') {
      if (b.def.military && b.owner !== me) act = fleet.some((x) => canBombard(g, x, b!)) ? '<br><b class="bad">Right-click: bombard it</b>' : '<br><span class="muted">Out of the warships\' reach</span>';
      else if (b.type === 'harbour' && b.owner === me) act = '<br><b>Right-click: moor here and mend</b>';
    }
    hud.showTip(ev, `<b>${b.def.name}</b><br><span class="muted">${owner.name}</span>${st ? `<br>${st}` : ''}${act}`);
  } else hud.hideTip();
}

/** The cursor for this frame: a drag of the view wins over whatever the pointer is over. */
function updateCursor() {
  if (!cursor) return;
  const d = gr.cam.drag;
  cursor.set(d === 'pan' ? 'grab' : d === 'orbit' ? 'orbit' : state === 'play' ? hoverCursor : 'default');
}

function bindCanvas(c: HTMLCanvasElement) {
  let downX = 0, downY = 0, downBtn = -1, multiTouch = false;
  const active = new Set<number>();
  cursor = new CursorSetter(c);
  hoverCursor = 'default';
  // left-drag with the mouse draws a box around soldiers to pick
  const boxEnd = () => { box?.remove(); box = null; gr.orders.preview = []; gr.orders.shipPreview = []; };
  c.addEventListener('pointerdown', (e) => {
    boxEnd();
    active.add(e.pointerId);
    if (active.size > 1) multiTouch = true;
    if (active.size === 1) { downX = e.clientX; downY = e.clientY; downBtn = e.button; multiTouch = false; }
    if (e.pointerType === 'mouse') { pointer.buttons = e.buttons; gr.orders.hover = null; hud?.hideTip(); }
    if (e.pointerType === 'touch' && state === 'play') {
      // update hover so taps place buildings where the finger is
      const p = gr.pickGround(e.clientX, e.clientY);
      gr.hoverNode = gr.pickNode(p);
    }
  });
  c.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    if (e.pointerType === 'mouse') {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; pointer.buttons = e.buttons;
    }
    if (e.pointerType === 'mouse' && (e.buttons & 1) && downBtn === 0 && hud && !targeting() && !gr.cam.drag
      && (box || Math.hypot(e.clientX - downX, e.clientY - downY) > 8)) {
      if (!box) { box = document.createElement('div'); box.className = 'selbox'; uiRoot.appendChild(box); }
      const x0 = Math.min(downX, e.clientX), y0 = Math.min(downY, e.clientY), x1 = Math.max(downX, e.clientX), y1 = Math.max(downY, e.clientY);
      box.style.left = `${x0}px`;
      box.style.top = `${y0}px`;
      box.style.width = `${x1 - x0}px`;
      box.style.height = `${y1 - y0}px`;
      // the men the box would take get a faint ring as it is drawn (or the warships, if it holds no men)
      gr.orders.preview = gr.orders.inRect(gr.cam.camera, c, x0, y0, x1, y1);
      gr.orders.shipPreview = gr.orders.preview.length ? [] : gr.orders.shipsInRect(gr.cam.camera, c, x0, y0, x1, y1);
      hud.hideTip();
      return;
    }
    const p = gr.pickGround(e.clientX, e.clientY);
    gr.hoverNode = gr.pickNode(p);
    gr.hoverPoint = p;
    if (e.pointerType === 'touch') return;
    if (performance.now() - pointer.at > 50) refreshHover();
    else if (hud && !e.buttons) hud.moveTip(e.clientX, e.clientY);
  });
  c.addEventListener('pointerleave', () => { pointer.inside = false; gr.orders.hover = null; hud?.hideTip(); });
  const up = (e: PointerEvent) => {
    active.delete(e.pointerId);
    if (e.pointerType === 'mouse') pointer.buttons = e.buttons;
    if (box) {
      const r = box.getBoundingClientRect();
      boxEnd();
      if (hud && state === 'play') {
        const men = gr.orders.inRect(gr.cam.camera, c, r.left, r.top, r.right, r.bottom);
        const ships = men.length ? [] : gr.orders.shipsInRect(gr.cam.camera, c, r.left, r.top, r.right, r.bottom);
        if (ships.length) hud.selectShips(ships, e.shiftKey);
        else hud.selectSoldiers(men, e.shiftKey);
      }
      return;
    }
    if (state !== 'play' || !hud) return;
    if (multiTouch) { if (active.size === 0) multiTouch = false; return; }
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > (e.pointerType === 'touch' ? 12 : 6);
    if (moved || e.button !== downBtn) return;
    if (e.button === 0) onClick(e);
    else if (e.button === 2 && !e.altKey) {
      if (hud.cancelMode()) return;
      // with soldiers picked, a right-click gives them their orders
      if (gr.orders.chosen.length || gr.orders.ships.length) hud.commandAt(e.clientX, e.clientY);
      else hud.select(null);
    }
    refreshHover();
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', (e) => { active.delete(e.pointerId); pointer.buttons = 0; boxEnd(); });
  // double-click a soldier: every one of his kind in view
  c.addEventListener('dblclick', (e) => {
    if (state !== 'play' || !hud || targeting() || gr.commanding) return;
    const s = gr.pickSettler(e.clientX, e.clientY, 26);
    if (!s || !gr.orders.chosen.includes(s.id)) return;
    selectKindInView(s, e.shiftKey);
  });
}

/** Pick every soldier of `s`'s kind on screen. */
function selectKindInView(s: Settler, add: boolean) {
  const r = canvas.getBoundingClientRect();
  hud?.selectSoldiers(gr.orders.inRect(gr.cam.camera, canvas, r.left, r.top, r.right, r.bottom, s.job), add);
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
    driver.issue({ t: 'place', b: gr.placing, x: a.x, y: a.y });
    if (!e.shiftKey) hud.startPlacing(null);
    return;
  }
  const b = gr.pickBuilding(e.clientX, e.clientY);
  // settlers win when the click is right on them (or no building was hit)
  const s = gr.pickSettler(e.clientX, e.clientY, b ? 12 : 26);
  const ship = s ? 0 : gr.pickShip(e.clientX, e.clientY);
  // Ctrl/Cmd + click one of your soldiers: all of his kind on screen
  if (s && (e.ctrlKey || e.metaKey) && commandable(game, game.local, s) && !s.inside) selectKindInView(s, e.shiftKey);
  else if (s) hud.select({ kind: 'settler', id: s.id }, e.shiftKey);
  else if (ship) hud.select({ kind: 'ship', id: ship }, e.shiftKey);
  else if (b) hud.select({ kind: 'building', id: b.id });
  else hud.select(null);
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function loop() {
  const now = performance.now();
  // under a frame cap most display frames are let by; the time they took goes into the next one
  if (!framePace.due(now)) { requestAnimationFrame(loop); return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && gr) {
    if (state === 'play') {
      // the Esc menu and a mission's briefing hold the game (alone; with a friend it goes on)
      driver.hold = !!gameMenu || !!hud?.modal;
      const gdt = driver.pump(now) * TICK;
      gr.handleEvents(game.events.splice(0));
      gr.frame(dt, gdt);
      if (!gameMenu) hud?.update(dt);
      // the world moves under a resting pointer too: soldiers walk by, the view scrolls
      if (pointer.inside && performance.now() - pointer.at > 120) refreshHover();
      autosaveT -= dt;
      if (autosaveT <= 0) {
        autosaveT = AUTOSAVE_EVERY;
        autosave();
      }
    } else {
      game.events.length = 0;
      gr.frame(dt, dt * 0.3);
    }
    updateCursor();
    audio.setListener(gr.cam.target.x, gr.cam.target.z, gr.cam.dist);
    audio.update(dt, gr.sky.night, gr.raining, gr.waterFrac);
  }
  requestAnimationFrame(loop);
}

// the running game is saved whenever the page is hidden or closed, so a reload picks it up again
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave(true); });
window.addEventListener('pagehide', () => autosave(true));

// a hidden tab gets no animation frames; in a networked game a worker's timer steps it instead, so the
// others never wait on someone who looked away (the page's own timers are throttled in a hidden tab)
try {
  const pumper = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
  pumper.onmessage = () => {
    if (!document.hidden || state !== 'play' || !driver || driver.solo) return;
    driver.pump(performance.now());
    gr.handleEvents(game.events.splice(0));
  };
} catch (e) {
  console.warn('No worker for hidden tabs:', e);
}

// debug helper: advance the game manually (used when the tab is not animating)
(window as any).step = (n = 1, dt = TICK) => {
  for (let i = 0; i < n; i++) {
    game.update(dt);
    gr.handleEvents(game.events.splice(0));
    hud?.update(dt);
  }
  gr.frame(dt, dt);
};

boot().catch((err) => {
  console.error(err);
  uiRoot.innerHTML = `<div class="loading"><div>Could not start the game.</div><div class="muted" style="font-family:var(--font);letter-spacing:0">${String(err?.message ?? err)}. A browser with WebGL 2 is required.</div></div>`;
});
