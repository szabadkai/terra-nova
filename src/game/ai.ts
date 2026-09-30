// Computer opponent: builds an economy by priority rules and attacks when strong.
import { BUILDINGS, BuildingType, GOODS, Good, MINE_ORE, emptyStock } from './defs';
import type { Game } from './game';
import { attackableSoldiers, launchAttack } from './military';
import { MANA_MAX, SPELLS, castSpell, faithStatus } from './faith';
import { colonySite, startExpedition } from './sea';
import { PROBE_RADIUS, geologistsAtWork, prospectError, sendGeologist } from './geology';
import { pioneerError, pioneersAtWork, sendPioneer } from './pioneers';
import { orderAttack } from './orders';
import { afloat, bombardSpot, orderShipBombard, orderShipHome, tradeShipsOf, warshipsOf } from './naval';
import { ORDER_STEP, placeOrder } from './trade';
import { availableAt } from './economy';
import { DX8, DY8 } from './world';
import { truced } from './campaign';
import type { Building } from './types';
import { cos, hypot, sin, sq } from '../core/fmath';

/** Overland trade starts once the realm is this old… */
const TRADE_FROM = 1300;
/** …and has workshops this far from any storehouse… */
const FAR = 24;
/** …at least this many of them close together. */
const OUTPOST_MIN = 4;
/** The outpost's storehouse and market stand this close to the far workshops… */
const OUTPOST_R = 16;
/** …and the market at home this close to the headquarters (the ground right round it is often built up),
 *  nearer to it than the far market is and at least ROUTE_MIN from that. */
const HOME_R = 30;
const ROUTE_MIN = 16;
/** The most of a good a route keeps on order at once. */
const ROUTE_MAX = 12;
/** What the home side keeps back of a good before it sends any away. */
const KEEP: Partial<Record<Good, number>> = { board: 14, stone: 12, bread: 4, fish: 4, meat: 4, grain: 4, water: 4, iron: 4, coal: 4 };

interface Want { type: BuildingType; n: number; cond?: () => boolean; }

export class AIController {
  private t: number;
  attackT: number;
  private expandT = 0;
  private aggressive = false;
  /** builder: a campaign rival that raises its realm and defends it but never marches (campaign.ts) */
  mode: 'ai' | 'builder' = 'ai';
  constructor(private g: Game, public p: number, public level: number) {
    this.t = 2 + p;
    this.attackT = [600, 420, 280][level] ?? 420;
  }

  private get interval() {
    return [6, 4, 2.6][this.level] ?? 4;
  }

  private garrisonT = 5;
  private castT = 8;
  private seaT = 60;
  private navalT = 45;
  private geoT = 30;
  private pioneerT = 240;
  private tradeT = 90;
  /** where the far workshops cluster: the storehouse and market out there are built by it */
  private outpost: { x: number; z: number } | null = null;
  private outpostFails = 0;
  private unmannedSince = new Map<number, number>();

  update(dt: number) {
    const g = this.g;
    if (!g.players[this.p].alive) return;
    this.t -= dt;
    this.attackT -= dt;
    this.expandT -= dt;
    this.garrisonT -= dt;
    if (this.garrisonT <= 0) {
      this.garrisonT = 10;
      this.manageGarrisons();
    }
    this.castT -= dt;
    if (this.castT <= 0) {
      this.castT = [6, 3, 2][this.level] ?? 3;
      this.castStep();
    }
    this.seaT -= dt;
    if (this.seaT <= 0) {
      this.seaT = 20;
      this.seaStep();
    }
    this.navalT -= dt;
    if (this.navalT <= 0) {
      this.navalT = 15;
      this.navalStep();
    }
    this.geoT -= dt;
    if (this.geoT <= 0) {
      this.geoT = [60, 40, 30][this.level] ?? 40;
      this.prospectStep();
    }
    this.pioneerT -= dt;
    if (this.pioneerT <= 0) {
      this.pioneerT = [120, 75, 50][this.level] ?? 75;
      this.pioneerStep();
    }
    this.tradeT -= dt;
    if (this.tradeT <= 0) {
      this.tradeT = 30;
      this.tradeStep();
    }
    if (this.t > 0) return;
    this.t = this.interval;
    this.buildStep();
    if (this.attackT <= 0) {
      this.attackT = [150, 100, 60][this.level] ?? 100;
      this.attackStep();
    }
  }

  private count(type: BuildingType) {
    return this.g.countBuildings(this.p, type, true);
  }

  private buildStep() {
    const g = this.g;
    let sites = 0;
    for (const b of g.buildings.values()) if (b.owner === this.p && (b.state === 'leveling' || b.state === 'building')) sites++;
    const maxSites = [2, 3, 5][this.level] ?? 3;
    if (sites >= maxSites) return;
    const stock = g.totalStock(this.p);
    const pop = g.population(this.p);
    const c = (t: BuildingType) => this.count(t);
    const hasOre = (ore: string) => this.oreInTerritory(ore) > 10;
    const t = g.time;
    // worked-out mines make way for new ones; count the ones starving for food
    let hungry = 0;
    for (const b of g.buildings.values()) {
      if (b.owner !== this.p || !b.def.mine || b.state !== 'done') continue;
      if (g.mineOreLeft(b) <= 0) { g.destroyBuilding(b, false); continue; }
      if (b.status === 'Waiting for food') hungry++;
    }
    const water = this.waterInTerritory();

    const wants: Want[] = [
      { type: 'woodcutter', n: 2 },
      { type: 'sawmill', n: 1 },
      { type: 'forester', n: 1 },
      { type: 'stonecutter', n: 1, cond: () => this.stonesInTerritory() > 3 },
      { type: 'tower_s', n: 2 },
      { type: 'woodcutter', n: 3 },
      { type: 'forester', n: 2 },
      { type: 'residence_s', n: 1, cond: () => pop.idle < 6 },
      { type: 'fisher', n: 1, cond: () => this.waterInTerritory() > 8 },
      { type: 'hunter', n: 1 },
      { type: 'tower_s', n: 3, cond: () => t > 200 },
      { type: 'stonecutter', n: 2, cond: () => t > 400 && this.stonesInTerritory() > 8 },
      { type: 'weaponsmith', n: 1 },
      { type: 'barracks', n: 1 },
      { type: 'farm', n: 1 },
      { type: 'waterworks', n: 1, cond: () => this.waterInTerritory() > 4 },
      { type: 'coalmine', n: 1, cond: () => hasOre('coal') },
      { type: 'ironmine', n: 1, cond: () => hasOre('iron') },
      { type: 'mill', n: 1 },
      { type: 'bakery', n: 1 },
      { type: 'ironsmelter', n: 1 },
      { type: 'toolsmith', n: 1 },
      { type: 'residence_m', n: 1, cond: () => pop.idle < 5 },
      { type: 'tower_l', n: 1, cond: () => t > 400 },
      { type: 'farm', n: 2 },
      { type: 'pigfarm', n: 1 },
      { type: 'slaughter', n: 1 },
      { type: 'fisher', n: 2, cond: () => this.waterInTerritory() > 20 },
      { type: 'coalmine', n: 2, cond: () => hasOre('coal') },
      // mines idle for want of food: more kitchens
      { type: 'fisher', n: 3, cond: () => hungry >= 2 && water > 20 },
      { type: 'hunter', n: 2, cond: () => hungry >= 2 },
      { type: 'farm', n: 3, cond: () => hungry >= 2 },
      { type: 'waterworks', n: 2, cond: () => hungry >= 2 && water > 4 },
      { type: 'mill', n: 2, cond: () => hungry >= 2 && c('farm') >= 3 },
      { type: 'bakery', n: 2, cond: () => hungry >= 2 && c('mill') >= 2 },
      { type: 'goldmine', n: 1, cond: () => hasOre('gold') },
      { type: 'goldsmelter', n: 1, cond: () => c('goldmine') > 0 },
      { type: 'vineyard', n: 1, cond: () => t > 1100 && c('weaponsmith') > 0 && stock.stone > 6 },
      { type: 'temple', n: 1, cond: () => t > 1250 && c('vineyard') > 0 && stock.stone > 12 },
      { type: 'sawmill', n: 2 },
      { type: 'stonemine', n: 1, cond: () => (this.stonesInTerritory() < 3 || (t > 1200 && stock.stone < 10)) && hasOre('stone') },
      { type: 'stonecutter', n: 3, cond: () => t > 1200 && stock.stone < 12 && this.stonesInTerritory() > 12 },
      { type: 'residence_s', n: 3, cond: () => pop.idle < 5 },
      { type: 'tower_s', n: 6, cond: () => t > 500 },
      { type: 'tower_l', n: 3, cond: () => t > 800 },
      { type: 'ironmine', n: 2, cond: () => hasOre('iron') },
      { type: 'weaponsmith', n: 2, cond: () => t > 900 },
      { type: 'castle', n: 1, cond: () => t > 1200 },
      // war machines once the army is up and iron flows
      { type: 'siegeworks', n: 1, cond: () => this.level > 0 && t > 1500 && c('weaponsmith') > 0 && c('ironsmelter') > 0 && stock.iron >= 2 && this.enemyPressure() >= 10 },
      { type: 'greattemple', n: 1, cond: () => this.level > 0 && t > 1800 && c('temple') > 0 && stock.stone > 20 },
      { type: 'vineyard', n: 2, cond: () => t > 1900 && c('greattemple') > 0 },
    ];
    // expansion pressure (towards the enemy once an army exists)
    if (this.expandT <= 0 && stock.board >= 4 && stock.stone >= 2) {
      const army = this.enemyPressure();
      this.aggressive = this.mode === 'ai' && army >= [16, 12, 8][this.level];
      this.expandT = (this.aggressive ? [150, 90, 60] : [240, 160, 100])[this.level] ?? 160;
      // out of rocks and no quarry possible: grow towards the nearest outcrops first
      const stoneStarved = stock.stone < 8 && this.stonesInTerritory() < 3;
      const big = g.time > 700 && stock.stone >= 10 && g.rng.chance(0.4);
      if (this.tryPlace(big ? 'tower_l' : 'tower_s', stoneStarved ? 'stone' : this.aggressive ? 'enemy' : undefined)) return;
    }
    // residences when out of carriers; a growing realm keeps needing more hands
    const homes = c('residence_s') * 8 + c('residence_m') * 18 + c('residence_l') * 32;
    if (pop.idle < 2 && homes < Math.min(200, 64 + t / 15) && sites < maxSites) {
      const big = stock.board >= 20 && stock.stone >= 14 && t > 1500;
      if (this.tryPlace(big ? 'residence_l' : pop.total > 60 ? 'residence_m' : 'residence_s')) return;
    }
    for (const w of wants) {
      if (c(w.type) >= w.n) continue;
      if (w.cond && !w.cond()) continue;
      const def = BUILDINGS[w.type];
      if (stock.board < def.cost.board * 0.5 && w.type !== 'sawmill' && w.type !== 'woodcutter') continue;
      // keep a little stone back so the border can always move
      if (!def.military && def.cost.stone > 0 && t > 600 && stock.stone - def.cost.stone < 3) continue;
      if (this.tryPlace(w.type)) return;
      // could not place: if it's a mine or water building, try expanding instead
      if (def.mine || w.type === 'fisher') {
        if (this.expandT <= 60) { this.expandT = 60; if (this.tryPlace('tower_s', def.mine ? 'mountain' : 'water')) return; }
        continue;
      }
    }
  }

  /** Mid-game: a harbour, a shipyard, a couple of ships, then colonies on free islands. */
  private seaStep() {
    const g = this.g;
    if (this.level === 0 || g.time < 1100 || !g.isles.length) return;
    const stock = g.totalStock(this.p);
    const hq = g.buildings.get(g.players[this.p].hq);
    if (!hq) return;
    const mine = [...g.buildings.values()].filter((b) => b.owner === this.p);
    const home = g.world.region[hq.door];
    const harbour = mine.find((b) => b.type === 'harbour' && g.world.region[b.door] === home);
    let colonies = 0, founding = false;
    const settled = new Set<number>();
    for (const b of mine) {
      if (b.type !== 'harbour' || g.world.region[b.door] === home) continue;
      colonies++;
      settled.add(g.world.region[b.door]);
      if (b.state !== 'done') founding = true;
    }
    if (colonies >= 2 || founding) return;
    let sites = 0;
    for (const b of mine) if (b.state === 'leveling' || b.state === 'building') sites++;
    if (!harbour) {
      if (sites < 3 && stock.board >= 12 && stock.stone >= 8) this.tryPlace('harbour');
      return;
    }
    const yard = mine.find((b) => b.type === 'shipyard');
    const ships = tradeShipsOf(g, this.p);
    if (!yard) {
      if (harbour.state === 'done' && sites < 3 && stock.board >= 10) this.tryPlace('shipyard');
      return;
    }
    yard.paused = yard.shipKind !== 'war' && ships >= 2;
    if (!ships || harbour.state !== 'done' || g.expeditions.some((e) => e.owner === this.p)) return;
    // nearest free island coast
    let best: { x: number; y: number; landing: number; shore: number } | null = null, bd = Infinity;
    for (const I of g.isles) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const px = I.x + cos(a) * I.r * 0.75, pz = I.y + sin(a) * I.r * 0.75;
        const d = hypot(px - harbour.cx, pz - harbour.cz);
        if (d >= bd) continue;
        const cs = colonySite(g, this.p, harbour, px, pz);
        if (typeof cs === 'string' || settled.has(g.world.region[cs.shore])) continue;
        bd = d;
        best = cs;
      }
    }
    if (best && stock.board >= 10 && stock.stone >= 8) startExpedition(g, this.p, harbour, best);
  }

  /**
   * A spread-out realm trades overland: a storehouse out by the far workshops, a market beside it
   * and one by the headquarters, a donkey ranch, and a route between the markets that carries each
   * side what its workshops and building sites lack and the other side has to spare.
   */
  private tradeStep() {
    const g = this.g, w = g.world;
    if (this.level === 0 || g.time < TRADE_FROM) return;
    const hq = g.buildings.get(g.players[this.p].hq);
    if (!hq) return;
    const home = w.region[hq.door];
    const mine = [...g.buildings.values()].filter((b) => b.owner === this.p && b.state !== 'burning' && w.region[b.door] === home);
    const stores = mine.filter((b) => b.def.storage && b.state === 'done');
    if (!this.outpost) {
      // workshops far from every storehouse, and the thickest knot of them
      const far = mine.filter((b) => b.state === 'done' && !b.def.military && !b.def.storage && b.def.category !== 'trade'
        && stores.every((st) => hypot(st.cx - b.cx, st.cz - b.cz) > FAR));
      let best: Building[] = [];
      for (const a of far) {
        const knot = far.filter((b) => hypot(a.cx - b.cx, a.cz - b.cz) < 12);
        if (knot.length > best.length) best = knot;
      }
      if (best.length < OUTPOST_MIN) return;
      this.outpost = { x: best.reduce((q, b) => q + b.cx, 0) / best.length, z: best.reduce((q, b) => q + b.cz, 0) / best.length };
    }
    const near = (b: Building, x: number, z: number, r: number) => hypot(b.cx - x, b.cz - z) < r;
    const op = this.outpost;
    let sites = 0;
    for (const b of mine) if (b.state === 'leveling' || b.state === 'building') sites++;
    const stock = g.totalStock(this.p);
    const room = sites < ([2, 3, 5][this.level] ?? 3) && stock.board >= 10 && stock.stone >= 8;
    // no room out there after all: give it up for a while
    const place = (type: BuildingType, at: { x: number; z: number }) => {
      if (this.tryPlace(type, undefined, at)) { this.outpostFails = 0; return; }
      if (++this.outpostFails > 10) { this.outpost = null; this.outpostFails = 0; this.tradeT = 600; }
    };
    // the buildings, one at a time: the storehouse, the market beside it, the ranch, the market at home
    const store = mine.find((b) => b.def.storage && b.type !== 'hq' && near(b, op.x, op.z, OUTPOST_R));
    if (!store) { if (room) place('storehouse', op); return; }
    const farM = mine.find((b) => b.type === 'market' && near(b, store.cx, store.cz, OUTPOST_R));
    if (!farM) { if (room) place('market', { x: store.cx, z: store.cz }); return; }
    if (!mine.some((b) => b.type === 'donkeyfarm')) {
      if (room && this.count('farm') >= 2 && this.count('waterworks') >= 1) this.tryPlace('donkeyfarm');
      return;
    }
    const farOut = hypot(farM.cx - hq.cx, farM.cz - hq.cz);
    const homeSide = (x: number, z: number) => hypot(x - hq.cx, z - hq.cz) < farOut && hypot(x - farM.cx, z - farM.cz) >= ROUTE_MIN;
    const homeM = mine.find((b) => b.type === 'market' && b.id !== farM.id && near(b, hq.cx, hq.cz, HOME_R) && homeSide(b.cx, b.cz));
    if (!homeM) { if (room) this.tryPlace('market', undefined, { x: hq.cx, z: hq.cz, r: HOME_R, ok: homeSide }); return; }
    if (homeM.state !== 'done' || farM.state !== 'done') return;
    this.planRoutes(mine, homeM, farM);
  }

  /**
   * Keep each route stocked: goods only one side makes go to the other as far as its workshops and
   * building sites are short of them, and stock one side can spare goes where the other lacks it.
   */
  private planRoutes(mine: Building[], homeM: Building, farM: Building) {
    const g = this.g;
    const d = (b: Building, m: Building) => hypot(b.cx - m.cx, b.cz - m.cz);
    const want = [emptyStock(), emptyStock()], have = [emptyStock(), emptyStock()], makes = [emptyStock(), emptyStock()];
    for (const b of mine) {
      const side = d(b, farM) < d(b, homeM) ? 1 : 0;
      if (b.state === 'done' && !b.paused && !b.def.storage) for (const gd of b.def.outputs ?? []) makes[side][gd]++;
      // what the carriers could fetch from here: a store's goods, a workshop's wares, what came in by donkey
      if (b.state === 'done') for (const gd of b.def.storage || b.type === 'market' ? GOODS : b.def.outputs ?? []) have[side][gd] += Math.max(0, availableAt(b, gd));
      if (b.def.storage) continue;
      if (b.state === 'leveling' || b.state === 'building') {
        want[side].board += Math.max(0, b.def.cost.board - b.delivered.board - b.incoming.board);
        want[side].stone += Math.max(0, b.def.cost.stone - b.delivered.stone - b.incoming.stone);
        continue;
      }
      if (b.state !== 'done' || b.paused || !b.def.inputs) continue;
      // what a workshop is short of, shared out between the goods it can use
      for (const inp of b.def.inputs) {
        let got = 0;
        for (const gd of inp.goods) got += b.stock[gd] + b.incoming[gd];
        const short = Math.max(0, inp.cap - got);
        for (const gd of inp.goods) want[side][gd] += short / inp.goods.length;
      }
    }
    const routes: [Building, Building, number][] = [[homeM, farM, 1], [farM, homeM, 0]];
    for (const [from, to, side] of routes) {
      const other = 1 - side;
      for (const gd of GOODS) {
        const open = g.tradeOrders.find((o) => o.owner === this.p && o.from === from.id && o.to === to.id && o.good === gd && o.n - o.delivered > 0);
        const onWay = open ? open.n - open.delivered : 0;
        const lack = Math.ceil(want[side][gd] - have[side][gd]);
        let n: number;
        // made only over there: whatever this side is short of comes by donkey, not on a carrier's back all the way
        if (makes[other][gd] && !makes[side][gd]) n = Math.min(Math.ceil(want[side][gd]), ROUTE_MAX);
        else {
          // a side never sends what its own workshops want, and home keeps a little back besides
          const spare = have[other][gd] - Math.max(want[other][gd], other === 0 ? KEEP[gd] ?? 2 : 0);
          n = Math.min(lack, spare, ROUTE_MAX);
        }
        const more = n - onWay;
        if (more >= ORDER_STEP / 2) placeOrder(g, from, to.id, gd, Math.floor(more / 2) * 2);
        // nothing wanted any more: stop gathering it (what donkeys carry is delivered all the same)
        else if (open && n <= 0 && open.n - open.loaded - open.delivered > 0) placeOrder(g, from, to.id, gd, -(open.n - open.loaded - open.delivered));
      }
    }
  }

  /** A navy once a rival takes to the sea: warships from the yard stand guard off the harbour, go for
   *  enemy ships that come near and, late in the game, shell enemy strongholds by the water. */
  private navalStep() {
    const g = this.g;
    if (this.level === 0) return;
    const yard = [...g.buildings.values()].find((b) => b.owner === this.p && b.type === 'shipyard' && b.state === 'done');
    const navy = [...g.ships.values()].filter((sh) => sh.owner === this.p && sh.kind === 'war' && afloat(sh));
    if (yard) {
      let rivals = false;
      for (const sh of g.ships.values()) if (sh.owner !== this.p && afloat(sh) && g.players[sh.owner]?.alive) { rivals = true; break; }
      if (!rivals) for (const b of g.buildings.values()) if (b.owner !== this.p && b.type === 'harbour' && g.players[b.owner]?.alive) { rivals = true; break; }
      const want = rivals ? this.level : 0;
      const stock = g.totalStock(this.p);
      if (warshipsOf(g, this.p) < want && stock.iron >= 2 && stock.board >= 8) { yard.shipKind = 'war'; yard.paused = false; }
      else if (yard.shipKind === 'war' && yard.shipProgress <= 0) yard.shipKind = 'trade';
    }
    if (!navy.length) return;
    // battered ships go home to mend
    for (const sh of navy) if (sh.hp < sh.maxHp * 0.4 && sh.state !== 'guard') orderShipHome(g, this.p, [sh.id]);
    if (g.time < 1800 || this.mode === 'builder' || truced(g)) return;
    const idle = navy.filter((sh) => sh.state === 'guard' && !sh.target && sh.hp > sh.maxHp * 0.75);
    if (!idle.length || navy.some((sh) => sh.state === 'bombard')) return;
    // the weakest enemy stronghold by the water, nearest first
    let best: Building | null = null, bs = Infinity;
    for (const b of g.buildings.values()) {
      if (b.owner === this.p || !b.def.military || b.state !== 'done' || !g.players[b.owner]?.alive) continue;
      const d = hypot(b.cx - idle[0].x, b.cz - idle[0].z);
      if (d > 70) continue;
      const score = d + b.garrison.length * 6 + (b.type === 'hq' ? 30 : 0);
      if (score >= bs || !bombardSpot(g, idle[0], b)) continue;
      bs = score;
      best = b;
    }
    if (best) orderShipBombard(g, this.p, (this.level >= 2 ? idle : idle.slice(0, 1)).map((sh) => sh.id), best);
  }

  private territoryNodes(): number[] {
    const w = this.g.world;
    const out: number[] = [];
    for (let i = 0; i < w.N; i += 1) if (w.owner[i] === this.p) out.push(i);
    return out;
  }

  private stonesInTerritory() {
    let n = 0;
    for (const s of this.g.stones.values()) if (this.g.world.owner[s.node] === this.p) n++;
    return n;
  }
  private waterInTerritory() {
    const w = this.g.world;
    let n = 0;
    for (let i = 0; i < w.N; i++) {
      if (!w.isWater(i)) continue;
      const x = w.nx(i), y = w.ny(i);
      // water adjacent to own land
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (w.inBounds(xx, yy) && w.owner[w.idx(xx, yy)] === this.p && !w.isWater(w.idx(xx, yy))) { n++; break; }
      }
    }
    return n;
  }
  /** Ore our geologists have found inside our borders. */
  private oreInTerritory(ore: string) {
    const w = this.g.world;
    const o = MINE_ORE[ore];
    let n = 0;
    for (let i = 0; i < w.N; i++) if (w.owner[i] === this.p && w.ore[i] === o && w.known(i, this.p)) n += w.oreAmt[i];
    return n;
  }

  /** Send a geologist to the nearest rock inside our borders that nobody has probed. */
  private prospectStep() {
    const g = this.g, w = g.world;
    if (geologistsAtWork(g, this.p) > 0) return;
    const hq = g.buildings.get(g.players[this.p].hq);
    if (!hq) return;
    const cands: number[] = [];
    for (let i = 0; i < w.N; i++) {
      if (w.owner[i] !== this.p || !w.isMountain(i) || w.known(i, this.p) || !w.walkable(i)) continue;
      cands.push(i);
    }
    if (cands.length < 8) return;
    // the heart of a stretch of unprobed rock, not a lone crag; closer to home is better
    let best = -1, bs = -Infinity;
    for (let k = 0; k < 40; k++) {
      const i = cands[g.rng.int(0, cands.length)];
      let n = 0;
      w.forRadius(w.nx(i), w.ny(i), PROBE_RADIUS, (j) => { if (w.isMountain(j) && !w.known(j, this.p)) n++; });
      const sc = n - hypot(w.nx(i) - hq.cx, w.ny(i) - hq.cz) * 0.4;
      if (sc > bs && prospectError(g, this.p, w.nx(i), w.ny(i)) === null) { bs = sc; best = i; }
    }
    if (best < 0) return;
    sendGeologist(g, this.p, w.nx(best), w.ny(best));
  }

  /** Pioneers stake out free land beside the border where it holds what the realm is short of. */
  private pioneerStep() {
    const g = this.g, w = g.world;
    if (this.level === 0 || pioneersAtWork(g, this.p) >= 2) return;
    const pop = g.population(this.p);
    const shovels = g.totalStock(this.p).shovel;
    if (shovels < 1 || (shovels < 2 && pop.diggers < 3)) return; // diggers come first
    if (pop.idle < 8) return;
    const coal = this.oreInTerritory('coal'), iron = this.oreInTerritory('iron');
    const wantRock = coal < 10 || iron < 10;
    const wantStone = this.stonesInTerritory() < 4;
    let trees = 0;
    for (const t of g.trees.values()) if (w.owner[t.node] === this.p) trees++;
    const wantTrees = trees < 30;
    if (!wantRock && !wantStone && !wantTrees) return;
    // free land touching the border
    const front: number[] = [];
    for (let i = 0; i < w.N; i++) {
      if (w.owner[i] >= 0 || w.isWater(i)) continue;
      const x = w.nx(i), y = w.ny(i);
      if (x < 4 || y < 4 || x >= w.W - 4 || y >= w.H - 4) continue;
      for (let d = 0; d < 4; d++) if (w.owner[w.idx(x + DX8[d], y + DY8[d])] === this.p) { front.push(i); break; }
    }
    if (!front.length) return;
    let best = -1, bs = 8;
    for (let k = 0; k < 40; k++) {
      const i = front[g.rng.int(0, front.length)];
      // step a little outwards from the border
      let sc = 0, foreign = false;
      w.forRadius(w.nx(i), w.ny(i), 10, (j, _x, _y, d2) => {
        if (w.owner[j] >= 0 && w.owner[j] !== this.p) foreign = true;
        if (d2 > 25 || w.owner[j] >= 0) return;
        if (wantRock && w.isMountain(j) && !w.known(j, this.p)) sc += 1;
        if (wantStone && w.stone[j]) sc += 3;
        if (wantTrees && w.tree[j]) sc += 0.6;
      });
      if (foreign || sc <= bs) continue;
      if (pioneerError(g, this.p, w.nx(i), w.ny(i))) continue;
      bs = sc;
      best = i;
    }
    if (best < 0) return;
    for (let k = 0; k < Math.min(2, shovels); k++) if (sendPioneer(g, this.p, w.nx(best), w.ny(best))) break;
  }

  /** Interior towers keep a single guard; towers facing an enemy get a full garrison. */
  private manageGarrisons() {
    const g = this.g;
    const enemyMil: { x: number; z: number }[] = [];
    for (const b of g.buildings.values()) if (b.owner !== this.p && b.def.military && b.state === 'done') enemyMil.push({ x: b.cx, z: b.cz });
    // (a campaign mission's forts keep the garrison it gave them, far from the border or not)
    const kept = g.ms?.forts;
    for (const b of g.buildings.values()) {
      if (b.owner !== this.p || !b.def.military || b.type === 'hq' || b.state !== 'done') continue;
      if (kept?.includes(b.id)) continue;
      let d = Infinity;
      for (const e of enemyMil) d = Math.min(d, hypot(e.x - b.cx, e.z - b.cz));
      const cap = b.def.military.capacity;
      b.desiredSoldiers = d < 40 ? cap : d < 60 ? Math.max(1, Math.ceil(cap / 2)) : 1;
    }
  }

  private enemyPressure(): number {
    const g = this.g;
    let mySoldiers = 0;
    for (const s of g.settlers.values()) if (s.owner === this.p && (s.job === 'swordsman' || s.job === 'bowman') && !s.dead) mySoldiers++;
    return mySoldiers;
  }

  /** Only expand when a soldier can actually man the new tower. */
  private canExpand(): boolean {
    const g = this.g;
    let unmanned = 0, reserve = 0;
    const hq = g.buildings.get(g.players[this.p].hq);
    const home = hq ? g.world.region[hq.door] : 0;
    for (const b of g.buildings.values()) {
      if (b.owner !== this.p || !b.def.military) continue;
      // colonies overseas wait for ships; they don't hold up the border at home
      if (g.world.region[b.door] !== home && !b.occupied) continue;
      if (b.state !== 'done') { unmanned++; continue; }
      if (!b.occupied) {
        // a tower nobody can reach would block expansion forever: give up on it
        const since = this.unmannedSince.get(b.id) ?? g.time;
        this.unmannedSince.set(b.id, since);
        // (overseas towers wait for a ship to bring their soldier)
        const home = g.buildings.get(g.players[this.p].hq);
        const overseas = home && g.world.region[home.door] !== g.world.region[b.door];
        if (g.time - since > (overseas ? 600 : 150) && !b.soldiersIncoming) { g.destroyBuilding(b, true); this.unmannedSince.delete(b.id); continue; }
        unmanned++;
      } else this.unmannedSince.delete(b.id);
      if (b.type === 'hq') reserve += Math.max(0, b.garrison.length - 2);
      else reserve += Math.max(0, b.garrison.length - b.desiredSoldiers);
    }
    for (const s of g.settlers.values()) if (s.owner === this.p && s.sstate === 'idle' && (s.job === 'swordsman' || s.job === 'bowman') && !s.dead) reserve++;
    return unmanned === 0 && reserve > 0;
  }

  /** `near`: build it as close as it will go to that spot, within `r` of it (and where `ok` allows). */
  private tryPlace(type: BuildingType, bias?: 'mountain' | 'water' | 'enemy' | 'stone', near?: { x: number; z: number; r?: number; ok?: (x: number, z: number) => boolean }): boolean {
    const g = this.g;
    if (BUILDINGS[type].military && !this.canExpand()) return false;
    const w = g.world;
    const def = BUILDINGS[type];
    // for a building wanted by a spot, only the ground around that spot
    const nodes = near ? this.territoryNodes().filter((i) => hypot(w.nx(i) - near.x, w.ny(i) - near.z) <= (near.r ?? OUTPOST_R)) : this.territoryNodes();
    if (!nodes.length) return false;
    const hq = g.buildings.get(g.players[this.p].hq);
    const hx = hq ? hq.cx : w.nx(nodes[0]), hz = hq ? hq.cz : w.ny(nodes[0]);
    // enemy direction
    let ex = hx, ez = hz, ed = Infinity;
    for (const b of g.buildings.values()) {
      if (b.owner === this.p || !b.def.military) continue;
      const d = sq(b.cx - hx) + sq(b.cz - hz);
      if (d < ed) { ed = d; ex = b.cx; ez = b.cz; }
    }
    let best: { x: number; y: number } | null = null, bs = -Infinity;
    const samples = Math.min(nodes.length, 420);
    for (let k = 0; k < samples; k++) {
      const i = nodes[g.rng.int(0, nodes.length)];
      const hxN = w.nx(i), hyN = w.ny(i);
      const a = g.anchorFor(type, hxN, hyN);
      if (!g.canPlace(type, this.p, a.x, a.y)) continue;
      const cx = a.x + (def.size - 1) / 2, cz = a.y + (def.size - 1) / 2;
      const dHQ = hypot(cx - hx, cz - hz);
      let score = -dHQ * 0.6;
      if (near) {
        // as close to the spot as it will go
        const dn = hypot(cx - near.x, cz - near.z);
        if (dn > (near.r ?? OUTPOST_R) || (near.ok && !near.ok(cx, cz))) continue;
        score = -dn;
      }
      switch (type) {
        case 'woodcutter': score = this.countTrees(cx, cz, 9) * 2 - dHQ * 0.3; break;
        case 'forester': score = this.countBuildingsNear(cx, cz, 8, 'woodcutter') * 10 - dHQ * 0.2 - this.countTrees(cx, cz, 5); break;
        case 'stonecutter': score = this.countStones(cx, cz, 10) * 3 - dHQ * 0.3; break;
        case 'fisher': {
          const n = this.countWater(cx, cz, 7, true);
          if (n < 6) continue;
          score = n - dHQ * 0.2;
          break;
        }
        case 'waterworks': {
          const n = this.countWater(cx, cz, 6, false);
          if (n < 3) continue;
          score = Math.min(10, n) - dHQ * 0.5;
          break;
        }
        // game lives in the woods
        case 'hunter': score = this.countTrees(cx, cz, 10) * 0.3 - dHQ * 0.2 + g.rng.next() * 2; break;
        case 'coalmine': case 'ironmine': case 'goldmine': case 'stonemine': {
          const ore = MINE_ORE[def.mine!];
          let n = 0;
          w.forRadius(cx, cz, 3.5, (j) => { if (w.ore[j] === ore && w.known(j, this.p)) n += w.oreAmt[j]; });
          if (n < 12) continue;
          score = n - dHQ * 0.2;
          break;
        }
        case 'tower_s': case 'tower_l': case 'castle': {
          // close to border, far from HQ, slightly towards the enemy
          const border = this.borderDist(i);
          const towards = ed < Infinity ? -hypot(cx - ex, cz - ez) * 0.4 : 0;
          const milNear = this.countMilitaryNear(cx, cz, def.military!.radius * 0.8);
          score = -border * 3 + dHQ * 0.5 + towards - milNear * 15;
          if (bias === 'enemy' && ed < Infinity) score = -hypot(cx - ex, cz - ez) * 1.6 - border * 1.5 - milNear * 12;
          if (bias === 'mountain') score += this.countMountain(cx, cz, 10) * 0.5;
          if (bias === 'water') score += this.countWater(cx, cz, 10, false) * 0.3;
          if (bias === 'stone') score += this.countStones(cx, cz, 14) * 0.6;
          break;
        }
        case 'farm': case 'pigfarm': case 'vineyard': score = -dHQ * 0.4 + this.freeLand(cx, cz, 5) * 0.4 - this.countTrees(cx, cz, 5); break;
        case 'harbour': case 'shipyard': {
          // a sheltered spot close to home, the yard next to the harbour
          const hb = [...g.buildings.values()].find((o) => o.owner === this.p && o.type === 'harbour');
          score = -dHQ * 0.5 + (type === 'shipyard' && hb ? -hypot(cx - hb.cx, cz - hb.cz) * 2 : 0);
          break;
        }
      }
      if (score > bs) { bs = score; best = a; }
    }
    if (!best) return false;
    // settlers must be able to walk there from a storehouse on the same landmass
    if (def.military) {
      const door = g.doorOf(def.size, best.x, best.y);
      const st = g.nearestStorage(this.p, w.nx(door), w.ny(door), w.region[door]);
      if (!st || !g.path.find(st.door, door, false, 12000)) return false;
    }
    const b = g.placeBuilding(type, this.p, best.x, best.y);
    return !!b;
  }

  private countTrees(x: number, z: number, r: number) {
    const w = this.g.world;
    let n = 0;
    w.forRadius(x, z, r, (i) => { if (w.tree[i]) n++; });
    return n;
  }
  private countStones(x: number, z: number, r: number) {
    const w = this.g.world;
    let n = 0;
    w.forRadius(x, z, r, (i) => { if (w.stone[i]) { const s = this.g.stones.get(w.stone[i]); n += s ? s.amount : 0; } });
    return n;
  }
  private countWater(x: number, z: number, r: number, fish: boolean) {
    const w = this.g.world;
    let n = 0;
    w.forRadius(x, z, r, (i) => { if (w.isWater(i) && (!fish || w.fish[i] > 0)) n++; });
    return n;
  }
  private countMountain(x: number, z: number, r: number) {
    const w = this.g.world;
    let n = 0;
    w.forRadius(x, z, r, (i) => { if (w.isMountain(i)) n++; });
    return n;
  }
  private freeLand(x: number, z: number, r: number) {
    const w = this.g.world;
    let n = 0;
    w.forRadius(x, z, r, (i) => { if (w.walkable(i) && !w.tree[i] && !w.building[i] && !w.isMountain(i)) n++; });
    return n;
  }
  private countBuildingsNear(x: number, z: number, r: number, type: BuildingType) {
    let n = 0;
    for (const b of this.g.buildings.values()) if (b.owner === this.p && b.type === type && hypot(b.cx - x, b.cz - z) < r) n++;
    return n;
  }
  private countMilitaryNear(x: number, z: number, r: number) {
    let n = 0;
    for (const b of this.g.buildings.values()) if (b.owner === this.p && b.def.military && hypot(b.cx - x, b.cz - z) < r) n++;
    return n;
  }
  private borderDist(i: number) {
    const w = this.g.world;
    const x = w.nx(i), y = w.ny(i);
    for (let r = 1; r < 16; r++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const xx = Math.round(x + cos(a) * r), yy = Math.round(y + sin(a) * r);
        if (!w.inBounds(xx, yy)) return r;
        if (w.owner[w.idx(xx, yy)] !== this.p) return r;
      }
    }
    return 16;
  }

  /** Priests at work: smite attackers, heal the wounded, speed up the forests, fill the waters. */
  private castStep() {
    const g = this.g;
    const p = g.players[this.p];
    if (p.mana < SPELLS.fish.cost || p.spellCd > 0) return;
    const st = faithStatus(g, this.p);
    if (!st.priests) return;
    if (st.great && this.level > 0) {
      const foe = this.enemyCluster();
      if (foe) {
        if (this.level >= 2 && foe.n >= 3 && castSpell(g, this.p, 'convert', foe.x, foe.z)) return;
        if (foe.n >= (this.level >= 2 ? 2 : 3) && castSpell(g, this.p, 'wrath', foe.x, foe.z)) return;
        // too little mana for the storm: hold them fast for the garrisons instead
        if (foe.n >= 3 && castSpell(g, this.p, 'freeze', foe.x, foe.z)) return;
      }
    }
    // heal wounded soldiers fighting in the field
    let wx = 0, wz = 0, wn = 0;
    for (const s of g.settlers.values()) {
      if (s.owner !== this.p || s.hidden || s.dead || (s.job !== 'swordsman' && s.job !== 'bowman')) continue;
      if (s.hp > s.maxHp * 0.6 || !s.engaged) continue;
      wx += s.x; wz += s.z; wn++;
    }
    if (wn >= 2 && castSpell(g, this.p, 'heal', wx / wn, wz / wn)) return;
    // spare mana: ripen a forest when wood runs low (or plant one where the forester's ground is bare)
    const reserve = st.great ? SPELLS.wrath.cost + SPELLS.harvest.cost : SPELLS.heal.cost + SPELLS.harvest.cost;
    const stock = g.totalStock(this.p);
    const w = g.world;
    if (p.mana >= reserve && stock.log + stock.board < 12) {
      for (const b of g.buildings.values()) {
        if (b.owner !== this.p || b.type !== 'forester' || b.state !== 'done') continue;
        let trees = 0;
        w.forRadius(b.cx, b.cz, SPELLS.forest.radius, (i) => { if (w.tree[i]) trees++; });
        if (castSpell(g, this.p, trees < 8 ? 'forest' : 'harvest', b.cx, b.cz)) return;
      }
    }
    if (p.mana >= reserve) {
      // a fisher whose waters are fished out
      for (const b of g.buildings.values()) {
        if (b.owner !== this.p || b.type !== 'fisher' || b.state !== 'done') continue;
        let fish = 0, wx = 0, wz = 0, wn = 0;
        w.forRadius(b.cx, b.cz, b.def.radius!, (i, x, y) => { if (w.isWater(i)) { fish += w.fish[i]; wx += x; wz += y; wn++; } });
        if (wn && fish < wn * 0.5 && castSpell(g, this.p, 'fish', wx / wn, wz / wn)) return;
      }
      // iron piling up while the soldiers go without gold
      if (stock.iron >= 12 && stock.gold < 4) {
        for (const b of g.storages(this.p)) if (b.stock.iron >= 6 && castSpell(g, this.p, 'midas', b.cx, b.cz)) return;
      }
    }
    // the offerings would go to waste at the brim: ask for a gift instead
    if (p.mana >= MANA_MAX - 10) {
      const hq = g.buildings.get(p.hq);
      if (hq && hq.owner === this.p) castSpell(g, this.p, 'gift', hq.cx, hq.cz);
    }
  }

  /** The densest group of enemy soldiers marching on (or standing in) our land. */
  private enemyCluster(): { x: number; z: number; n: number } | null {
    const g = this.g;
    const w = g.world;
    const foes = [];
    for (const s of g.settlers.values()) {
      if (s.owner === this.p || s.hidden || s.dead || (s.job !== 'swordsman' && s.job !== 'bowman')) continue;
      const i = w.idx(Math.round(s.x), Math.round(s.z));
      if (w.owner[i] !== this.p && s.sstate !== 'attack') continue;
      foes.push(s);
    }
    let best: { x: number; z: number; n: number } | null = null;
    for (const a of foes) {
      let n = 0, sx = 0, sz = 0;
      for (const b of foes) if (sq(a.x - b.x) + sq(a.z - b.z) < 16) { n++; sx += b.x; sz += b.z; }
      if (!best || n > best.n) best = { x: sx / n, z: sz / n, n };
    }
    return best;
  }

  private attackStep() {
    const g = this.g;
    // a campaign's builder never marches; a truce holds every computer kingdom back for a while
    if (this.mode === 'builder' || truced(g)) return;
    let best: Building | null = null, bs = -Infinity;
    for (const b of g.buildings.values()) {
      if (b.owner === this.p || !b.def.military || b.state !== 'done' || !b.occupied) continue;
      if (!g.players[b.owner].alive) continue;
      const avail = attackableSoldiers(g, this.p, b).length;
      if (avail < 2) continue;
      const score = avail - b.garrison.length * 1.5 - (b.type === 'hq' ? 4 : 0);
      if (score > bs) { bs = score; best = b; }
    }
    if (!best) return;
    const avail = attackableSoldiers(g, this.p, best).length;
    const need = best.garrison.length + ([3, 2, 1][this.level] ?? 2);
    if (avail < need && avail < 6) return;
    launchAttack(g, this.p, best, Math.min(avail, need + 2));
    // the catapults roll along behind the assault
    const w = g.world;
    const cats: number[] = [];
    for (const s of g.settlers.values()) {
      if (s.owner !== this.p || s.job !== 'catapult' || s.dead || s.engaged) continue;
      if ((s.sstate === 'idle' || s.sstate === 'hold') && w.region[s.node] === w.region[best.door]) cats.push(s.id);
    }
    if (cats.length) orderAttack(g, this.p, cats, best);
  }
}
