// Headless check of the AI's overland trade: in a spread-out realm the computer builds a storehouse
// out by its far workshops, a market beside it and one by its headquarters, and a donkey ranch, then
// keeps a trade route between the markets stocked with what each side lacks. Goods must actually
// arrive, orders must stay small, and a saved game must carry on trading after it is loaded.
// Usage: npx tsx scripts/aitrade.ts [seed] [level] [minutes] [aivai|passive]
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
import { GOOD_NAMES } from '../src/game/defs';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import { donkeysOf, marketsOf } from '../src/game/trade';

const seed = Number(process.argv[2] ?? 402), level = Number(process.argv[3] ?? 2);
const minutes = Number(process.argv[4] ?? 70), mode = process.argv[5] ?? 'aivai';
let g = new Game({ size: 160, seed, players: 2, aiLevel: level, islands: true });
if (mode === 'aivai') g.ai.push(new AIController(g, 0, level));
const ais = () => g.ai.map((a) => a.p);
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);

const seen = new Map<string, number>();
const note = (p: number, what: string) => {
  const k = `${p}:${what}`;
  if (seen.has(k)) return;
  seen.set(k, g.time);
  log(`P${p} ${what}`);
};
let biggest = 0, restored = false, tradedAtSave = 0, saveAt = -1;
for (let t = 0; t < minutes * 60 && !g.over; t++) {
  g.update(1);
  g.events.length = 0;
  if (t % 10) continue;
  for (const p of ais()) {
    for (const b of g.buildings.values()) {
      if (b.owner !== p) continue;
      if (b.type === 'storehouse') note(p, `storehouse ${b.state === 'done' ? 'done' : 'placed'}`);
      if (b.type === 'donkeyfarm') note(p, `donkey ranch ${b.state === 'done' ? 'done' : 'placed'}`);
      if (b.type === 'market') note(p, `market ${b.state === 'done' ? 'done' : 'placed'}${marketsOf(g, p).length > 1 ? ' (second)' : ''}`);
    }
    if (donkeysOf(g, p) > 0) note(p, 'first donkey');
    if (g.players[p].traded > 0) note(p, 'first goods delivered by donkey');
    for (const o of g.tradeOrders) if (o.owner === p) biggest = Math.max(biggest, o.n - o.delivered);
  }
  // save and load once the donkeys are at work, and carry on with the copy
  if (!restored && ais().some((p) => g.players[p].traded >= 6)) {
    restored = true;
    const p = ais().find((q) => g.players[q].traded >= 6)!;
    tradedAtSave = g.players[p].traded;
    saveAt = p;
    g = restore(await decodeSave(await encodeSave(snapshot(g))));
    log(`saved and loaded with P${p} trading (${tradedAtSave} goods so far)`);
  }
  if (t % 600 === 0) {
    const rows = ais().map((p) => {
      const orders = g.tradeOrders.filter((o) => o.owner === p && o.n - o.delivered > 0);
      return `P${p} markets ${marketsOf(g, p).length} donkeys ${donkeysOf(g, p)} traded ${g.players[p].traded} orders ${orders.map((o) => `${GOOD_NAMES[o.good]} ${o.delivered}/${o.n}`).join(', ') || '-'}`;
    });
    log(rows.join(' | '));
  }
}
const traders = ais().filter((p) => g.players[p].traded > 0);
log('end', ais().map((p) => `P${p} traded ${g.players[p].traded}, donkeys ${donkeysOf(g, p)}, markets ${marketsOf(g, p).length}`).join(' | '), g.over ? `(over, winner P${g.winner})` : '');
check(traders.length > 0, `an AI trades overland (${traders.map((p) => `P${p}: ${g.players[p].traded}`).join(', ') || 'none'})`);
check(biggest <= 16, `its orders stay small (largest open ${biggest})`);
if (restored) check(g.players[saveAt].traded > tradedAtSave, `the loaded game goes on trading (${tradedAtSave} → ${g.players[saveAt].traded})`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
