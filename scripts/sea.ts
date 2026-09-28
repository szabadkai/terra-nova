// Headless check of seafaring: harbour + shipyard on the coast, a ship, an expedition to an island,
// then overseas supply of the new colony. Usage: npx tsx scripts/sea.ts [seed] [size]
import { Game } from '../src/game/game';
import { BUILDINGS } from '../src/game/defs';
import { colonySite, startExpedition, cargoCount } from '../src/game/sea';

const seed = Number(process.argv[2] ?? 7), size = Number(process.argv[3] ?? 160);
const g = new Game({ size, seed, players: 2, aiLevel: 1 });
const w = g.world;
const P = 0;
const hq = g.buildings.get(g.players[P].hq)!;
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);

// nearest coastal harbour site to the HQ (on unclaimed or own land)
let site: { x: number; y: number } | null = null, bd = Infinity;
for (let y = 3; y < w.H - 6; y++) for (let x = 3; x < w.W - 6; x++) {
  if (w.region[w.idx(x, y)] !== w.region[hq.door]) continue;
  const d = Math.hypot(x - hq.cx, y - hq.cz);
  if (d >= bd) continue;
  if (g.placeError('harbour', P, x, y, true) && g.placeError('harbour', P, x, y)) continue;
  site = { x, y }; bd = d;
}
if (!site) throw new Error('no coast');
log('coast site', site, 'dist', bd.toFixed(1));
// claim it with an instant, manned tower next to it
const t = g.addBuilding('tower_l', P, site.x - 4, site.y - 4, true);
const sol = [...g.settlers.values()].find((s) => s.owner === P && s.job === 'swordsman')!;
hq.garrison = hq.garrison.filter((id) => id !== sol.id);
sol.inside = t.id; sol.sstate = 'garrison'; sol.home = t.id; t.garrison.push(sol.id); t.occupied = true;
g.territoryDirty = true;
g.update(0.1);
const err = g.placeError('harbour', P, site.x, site.y);
log('harbour placeable?', err ?? 'yes');
const hb = g.addBuilding('harbour', P, site.x, site.y, true);
log('harbour dock', hb.dock, 'sea', w.sea[hb.dock], 'region', w.region[hb.door]);
// shipyard next to it
let yard = null as any;
for (let r = 3; r < 14 && !yard; r++) for (let a = 0; a < 24 && !yard; a++) {
  const x = Math.round(site.x + Math.cos(a / 24 * Math.PI * 2) * r), y = Math.round(site.y + Math.sin(a / 24 * Math.PI * 2) * r);
  if (!g.placeError('shipyard', P, x, y)) yard = g.addBuilding('shipyard', P, x, y, true);
}
log('shipyard', yard ? `at ${yard.x},${yard.y} dock ${yard.dock}` : 'none');
hq.stock.board += 60; hq.stock.stone += 30;

let launched = false, exStarted = false, colonyDone = false, supplied = false;
for (let s = 0; s < 40 * 60; s++) {
  g.update(1);
  const ships = [...g.ships.values()].filter((x) => x.owner === P);
  if (!launched && ships.length) { launched = true; log('ship launched:', ships[0].name, 'state', ships[0].state); }
  if (launched && !exStarted && ships[0].state === 'idle' && !ships[0].route) {
    // nearest island colony site
    let best: any = null, bd2 = Infinity;
    for (const I of g.isles) {
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        const px = I.x + Math.cos(a) * I.r * 0.8, pz = I.y + Math.sin(a) * I.r * 0.8;
        const cs = colonySite(g, P, hb, px, pz);
        if (typeof cs === 'string') continue;
        const d = Math.hypot(px - hb.cx, pz - hb.cz);
        if (d < bd2) { bd2 = d; best = cs; }
      }
    }
    if (!best) { log('no colony site found'); break; }
    startExpedition(g, P, hb, best);
    exStarted = true;
    log('expedition to', best.x, best.y, 'dist', bd2.toFixed(0));
  }
  if (s % 60 === 0) {
    const ex = g.expeditions[0];
    const sh = ships[0];
    const col = [...g.buildings.values()].find((b) => b.owner === P && b.colony);
    const colR = col ? w.region[col.door] : -1;
    const onIsle = [...g.settlers.values()].filter((x) => x.owner === P && !x.dead && colR > 0 && w.region[x.node] === colR && !x.aboard);
    log(`ship=${sh ? `${sh.state}${sh.route ? ' sailing' : ''} cargo=${cargoCount(sh)} pax=${sh.passengers.length}` : '-'}`,
      ex ? `ex=${ex.state}` : '', col ? `colony=${col.state} ${Math.round(col.buildWork / col.buildTotal * 100)}% occ=${col.occupied} gar=${col.garrison.length}` : '',
      `onIsle=${onIsle.length} [${[...new Set(onIsle.map((x) => x.job))].join(',')}]`,
      `orders=${g.seaOrders.map((o) => `${o.good}:${o.delivered}/${o.n}`).join(' ')}`,
      `waiting=${[...g.settlers.values()].filter((x) => x.voyage && !x.aboard).map((x) => x.job + (x.inside ? "@in" : "@walk")).join(",")}`, `yard=${yard?.status}`);
    if (col && col.state === 'done' && col.occupied && !colonyDone) {
      colonyDone = true;
      log('colony established; placing a woodcutter and a stonecutter on the island');
      const want: any[] = ['woodcutter', 'forester', 'residence_s'];
      for (const type of want) {
        let placed = false;
        w.forRadius(col.cx, col.cz, 9, (i, x, y) => {
          if (placed || w.region[i] !== colR) return;
          const a = g.anchorFor(type, x, y);
          if (g.placeBuilding(type, P, a.x, a.y)) placed = true;
        });
        log(' ', type, placed ? 'placed' : 'no spot');
      }
    }
    if (colonyDone && !supplied) {
      const isleB = [...g.buildings.values()].filter((b) => b.owner === P && w.region[b.door] === colR && b.type !== 'harbour');
      if (isleB.length && isleB.every((b) => b.state === 'done')) { supplied = true; log('island buildings complete:', isleB.map((b) => `${b.type}(${b.worker ? 'manned' : 'no worker'})`).join(' ')); }
    }
  }
}
log('expansions', g.path.expansions);
