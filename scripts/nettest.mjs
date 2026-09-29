// Two real browsers play a game with a friend over the real signalling relays, and the test reports how
// they connected (directly, through the NATs by STUN, or through a TURN relay), the round trip, and
// whether the two games stayed in step. Runs on this machine with Chrome (both roles in two Chrome
// profiles) or inside the NAT lab's containers (one role each, see scripts/nettest/).
//
//   node scripts/nettest.mjs [--url http://127.0.0.1:5173/] [--role both|host|guest] [--code ABCDEF] [--minutes 2]
//                            [--exe <browser>] [--ice stun:...,turn:u:p@...] [--policy relay] [--drop host|srflx]
//                            [--seed 199] [--size 128] [--json out.json] [--verbose]
//   --drop host   the pages throw away every remote host candidate, so the connection must go through the
//                 NATs (or the relay) as it would between two networks; --drop srflx also drops STUN ones.
import { launch } from 'puppeteer-core';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] ?? d; };
const has = (k) => process.argv.includes(`--${k}`);
const URL0 = arg('url', 'http://127.0.0.1:5173/');
const role = arg('role', 'both');
const code = (arg('code', '') || Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('')).toUpperCase();
const minutes = Number(arg('minutes', 2));
const connectLimit = Number(arg('connect', 90)); // seconds allowed for the two to meet and start
const exe = arg('exe', process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium-browser');
const ice = arg('ice', ''), policy = arg('policy', ''), drop = arg('drop', '');
const seed = arg('seed', '199'), size = arg('size', '128');
const verbose = has('verbose');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const query = (extra) => {
  const q = new URLSearchParams({ seed, size, ...extra });
  if (has('norender')) q.set('norender', '1'); // no drawing: for a browser without a GPU, where software rendering would starve the game
  if (ice) q.set('ice', ice);
  if (policy) q.set('icepolicy', policy);
  return `${URL0}${URL0.includes('?') ? '&' : '?'}${q}`;
};

/** In the page before it loads: candidates of the given kinds from the other side are dropped, as if unreachable. */
const dropScript = (kinds) => `(() => {
  const kinds = ${JSON.stringify(kinds)};
  const add = RTCPeerConnection.prototype.addIceCandidate;
  RTCPeerConnection.prototype.addIceCandidate = function (c, ...rest) {
    const s = c && c.candidate;
    if (typeof s === 'string' && kinds.some((k) => s.includes(' typ ' + k + ' '))) return Promise.resolve();
    return add.call(this, c, ...rest);
  };
  const desc = RTCPeerConnection.prototype.setRemoteDescription;
  RTCPeerConnection.prototype.setRemoteDescription = function (d, ...rest) {
    if (d && typeof d.sdp === 'string') d = { type: d.type, sdp: d.sdp.split('\\n').filter((l) => !kinds.some((k) => l.startsWith('a=candidate') && l.includes(' typ ' + k + ' '))).join('\\n') };
    return desc.call(this, d, ...rest);
  };
})();`;

/** In the page before it loads: every connection's candidates and states go to the console (--trace). */
const traceScript = `(() => {
  const P = RTCPeerConnection;
  window.RTCPeerConnection = function (...a) {
    const pc = new P(...a);
    console.log('ice: config ' + JSON.stringify((pc.getConfiguration().iceServers ?? []).map((s) => s.urls)) + ' policy ' + pc.getConfiguration().iceTransportPolicy);
    pc.addEventListener('icecandidate', (e) => console.log('ice: local ' + (e.candidate ? e.candidate.candidate.replace(/^candidate:\\S+ \\d+ /, '') : 'done')));
    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('ice: state ' + pc.iceConnectionState);
      // while checking: every pair being tried, and how many checks went out and came back
      if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'disconnected') setTimeout(async () => {
        const by = new Map(); (await pc.getStats()).forEach((r) => by.set(r.id, r));
        for (const r of by.values()) if (r.type === 'candidate-pair') {
          const l = by.get(r.localCandidateId), m = by.get(r.remoteCandidateId);
          console.log('ice: pair ' + r.state + ' ' + (l ? l.candidateType + ' ' + l.address + ':' + l.port : '?') + ' -> ' + (m ? m.candidateType + ' ' + m.address + ':' + m.port : '?') + ' sent ' + r.requestsSent + ' got ' + r.responsesReceived + ' recv ' + r.requestsReceived);
        }
        for (const r of by.values()) if (r.type === 'local-candidate') console.log('ice: mine ' + r.candidateType + ' ' + r.address + ':' + r.port + ' via ' + (r.networkType ?? '?') + ' ' + (r.relatedAddress ?? ''));
      }, pc.iceConnectionState === 'checking' ? 4000 : 0);
    });
    pc.addEventListener('icegatheringstatechange', () => console.log('ice: gathering ' + pc.iceGatheringState));
    const srd = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = (d, ...r) => { for (const l of String(d?.sdp ?? '').split('\\n')) if (l.startsWith('a=candidate')) console.log('ice: remote ' + l.replace(/^a=candidate:\\S+ \\d+ /, '').trim()); return srd(d, ...r); };
    const aic = pc.addIceCandidate.bind(pc);
    pc.addIceCandidate = (c, ...r) => { if (c?.candidate) console.log('ice: remote ' + c.candidate.replace(/^candidate:\\S+ \\d+ /, '')); return aic(c, ...r); };
    return pc;
  };
  window.RTCPeerConnection.prototype = P.prototype;
})();`;

async function openPage(browser, kind) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => log(`[${kind}] page error:`, e.message));
  page.on('console', (m) => { if (verbose || m.type() === 'error' || /Connected to|Hosting:|^ice:/.test(m.text())) log(`[${kind}] ${m.text()}`); });
  if (has('trace')) await page.evaluateOnNewDocument(traceScript);
  if (drop) await page.evaluateOnNewDocument(dropScript(drop === 'srflx' ? ['host', 'srflx', 'prflx'] : ['host']));
  const url = kind === 'host' ? query({ host: code, autostart: '1' }) : query({ join: code });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

const inGame = (page) => page.evaluate(() => !!(window.driver && !window.driver.solo && window.game && window.driver.turn > 2 && window.driver.ticks > 30 && document.querySelector('.netbar')?.classList.contains('hidden')));
const sample = (page) => page.evaluate(() => {
  const d = window.driver, g = window.game;
  const agreed = [...d.hashes.values()].filter((r) => r.local !== undefined && r.remote.size);
  return {
    turn: d.turn, ticks: d.ticks, speed: d.speed, frozen: d.frozen, delay: d.delay, time: g.time, local: g.local,
    compared: agreed.length, disagree: agreed.filter((r) => [...r.remote.values()].some((h) => h !== r.local)).length,
    buildings: g.buildings.size, dialog: document.querySelector('.overlay.net h1')?.textContent ?? null,
    waiting: !document.querySelector('.netbar')?.classList.contains('hidden'),
  };
});
const stats = (page) => page.evaluate(async () => (window.netStats ? await window.netStats() : []));
/** place a woodcutter near the player's headquarters; returns its id when the game answers */
const build = (page) => page.evaluate(() => new Promise((resolve) => {
  const g = window.game, hq = g.buildings.get(g.players[g.local].hq);
  let spot = null;
  for (let r = 3; r < 16 && !spot; r++) for (let dx = -r; dx <= r && !spot; dx++) for (let dz = -r; dz <= r && !spot; dz++) {
    const a = g.anchorFor('woodcutter', Math.round(hq.cx + dx), Math.round(hq.cz + dz));
    if (!g.placeError('woodcutter', g.local, a.x, a.y)) spot = a;
  }
  if (!spot) return resolve(null);
  const seq = window.driver.issue({ t: 'place', b: 'woodcutter', x: spot.x, y: spot.y });
  const orig = window.hud.onEvent.bind(window.hud);
  const t0 = performance.now();
  const timer = setTimeout(() => { window.hud.onEvent = orig; resolve({ seq, timeout: true }); }, 5000);
  window.hud.onEvent = (e) => { if (e.type === 'cmd' && e.seq === seq) { clearTimeout(timer); window.hud.onEvent = orig; resolve({ seq, ok: e.ok, id: e.ids?.[0], ms: Math.round(performance.now() - t0) }); } return orig(e); };
}));
const hasBuilding = (page, id) => page.evaluate((id) => window.game.buildings.has(id), id);

const roles = role === 'both' ? ['host', 'guest'] : [role];
const out = { code, url: URL0, roles, ice, policy, drop, connectSeconds: null, path: null, commands: [], samples: [], ok: false, errors: [] };
const browsers = [], pages = {};
try {
  for (const kind of roles) {
    // (no --disable-gpu: the game needs WebGL 2; --gl swiftshader draws in software where there is no GPU, as in a container)
    const gl = arg('gl', '') === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] : [];
    // a page over plain http from anywhere but localhost is no secure context, and without one there is no crypto.subtle for the signalling
    const origin = new URL(URL0).origin;
    const secure = /^https:|^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin) ? [] : [`--unsafely-treat-insecure-origin-as-secure=${origin}`];
    const b = await launch({ executablePath: exe, headless: true, protocolTimeout: 300000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--user-data-dir=${mkdtempSync(join(tmpdir(), `tn-${kind}-`))}`, ...gl, ...secure, ...(has('no-mdns') ? ['--disable-features=WebRtcHideLocalIpsWithMdns'] : [])] });
    browsers.push(b);
    if (kind === 'guest' && roles.length > 1) await new Promise((r) => setTimeout(r, 1500)); // the host announces first
    pages[kind] = await openPage(b, kind);
    log(`[${kind}] opened room ${code}`);
  }
  // wait for the game(s) to be under way
  const t0 = Date.now();
  for (;;) {
    const ready = await Promise.all(Object.values(pages).map(inGame));
    if (ready.every(Boolean)) break;
    if (Date.now() - t0 > connectLimit * 1000) throw new Error(`no game after ${connectLimit} s (${JSON.stringify(await Promise.all(Object.entries(pages).map(async ([k, p]) => [k, await p.evaluate(() => document.querySelector('.lstatus')?.textContent ?? document.querySelector('.netbar')?.textContent ?? '?')])))})`);
    await new Promise((r) => setTimeout(r, 500));
  }
  out.connectSeconds = (Date.now() - t0) / 1000;
  log(`in the game after ${out.connectSeconds.toFixed(1)} s`);
  await new Promise((r) => setTimeout(r, 4500));
  const first = pages[roles[0]];
  out.path = await stats(first);
  for (const p of out.path) log(`path: ${p.local} ↔ ${p.remote}${p.rtt !== null ? `, rtt ${p.rtt} ms` : ''} (${p.state})`);

  // play: a building from each side now and then, and a look at both games every 2 s
  const end = Date.now() + minutes * 60000;
  let k = 0;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000));
    const kinds = Object.keys(pages);
    const s = {};
    for (const kind of kinds) s[kind] = await sample(pages[kind]);
    out.samples.push({ at: Date.now() - t0, ...s });
    if (verbose) log(kinds.map((kind) => `[${kind}] turn ${s[kind].turn} ticks ${s[kind].ticks} cmp ${s[kind].compared}/${s[kind].disagree}${s[kind].waiting ? ' waiting' : ''}${s[kind].frozen ? ' FROZEN' : ''}`).join('  '));
    if (kinds.some((kind) => s[kind].frozen || s[kind].dialog)) {
      const why = kinds.map((kind) => s[kind].dialog).filter(Boolean).join('; ') || 'frozen';
      if (end - Date.now() < 12000 && /left the game|not answering/.test(why)) { log(`the other side finished first (${why})`); break; }
      out.errors.push(`stopped: ${why}`);
      break;
    }
    // (no commands in the window's last seconds: the other side may have finished its run and cannot answer)
    if (k++ % 3 === 0 && end - Date.now() > 12000) {
      const from = kinds[k % kinds.length], other = kinds.find((x) => x !== from);
      const r = await build(pages[from]);
      if (r && !r.timeout && r.ok && other) {
        await new Promise((x) => setTimeout(x, 400));
        r.seenByOther = await hasBuilding(pages[other], r.id);
      }
      out.commands.push({ from, ...r });
      if (r?.timeout) out.errors.push(`a command from the ${from} went unanswered for 5 s`);
    }
  }
  const last = out.samples[out.samples.length - 1];
  const disagree = Object.values(last ?? {}).some((v) => v && typeof v === 'object' && v.disagree);
  out.ok = out.errors.length === 0 && !disagree && out.commands.every((c) => c.timeout !== true && (c.seenByOther !== false));
  const answered = out.commands.filter((c) => c.ms).map((c) => c.ms);
  log(`${minutes} min: ${roles.map((r) => `${r} turn ${last?.[r]?.turn}`).join(', ')}; ${last?.[roles[0]]?.compared ?? 0} turns compared, ${Object.values(last ?? {}).reduce((n, v) => n + (v?.disagree ?? 0), 0)} disagree; ${out.commands.length} commands, answered in ${answered.length ? `${Math.min(...answered)}-${Math.max(...answered)} ms` : 'n/a'}${out.commands.some((c) => c.seenByOther === false) ? ', SOME NOT SEEN BY THE OTHER' : ''}`);
} catch (e) {
  out.errors.push(String(e.message ?? e));
  log('FAILED:', e.message ?? e);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(out, null, 2));
console.log(out.ok ? 'PASS' : `FAIL${out.errors.length ? `: ${out.errors.join('; ')}` : ''}`);
process.exit(out.ok ? 0 : 1);
