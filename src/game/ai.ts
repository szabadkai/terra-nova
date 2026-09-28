// Computer opponent: builds an economy by priority rules and attacks when strong.
import { BUILDINGS, BuildingType, MINE_ORE } from './defs';
import type { Game } from './game';
import { attackableSoldiers, launchAttack } from './military';
import { SPELLS, castSpell, faithStatus } from './faith';
import { colonySite, startExpedition } from './sea';
import { PROBE_RADIUS, geologistsAtWork, prospectError, sendGeologist } from './geology';
import { pioneerError, pioneersAtWork, sendPioneer } from './pioneers';
import { DX8, DY8 } from './world';
import type { Building } from './types';

interface Want { type: BuildingType; n: number; cond?: () => boolean; }

export class AIController {
  private t: number;
  private attackT: number;
  private expandT = 0;
  private aggressive = false;
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
  private geoT = 30;
  private pioneerT = 240;
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
      { type: 'greattemple', n: 1, cond: () => this.level > 0 && t > 1800 && c('temple') > 0 && stock.stone > 20 },
      { type: 'vineyard', n: 2, cond: () => t > 1900 && c('greattemple') > 0 },
    ];
    // expansion pressure (towards the enemy once an army exists)
    if (this.expandT <= 0 && stock.board >= 4 && stock.stone >= 2) {
      const army = this.enemyPressure();
      this.aggressive = army >= [16, 12, 8][this.level];
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
    let ships = 0;
    for (const sh of g.ships.values()) if (sh.owner === this.p) ships++;
    if (!yard) {
      if (harbour.state === 'done' && sites < 3 && stock.board >= 10) this.tryPlace('shipyard');
      return;
    }
    yard.paused = ships >= 2;
    if (!ships || harbour.state !== 'done' || g.expeditions.some((e) => e.owner === this.p)) return;
    // nearest free island coast
    let best: { x: number; y: number; landing: number; shore: number } | null = null, bd = Infinity;
    for (const I of g.isles) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const px = I.x + Math.cos(a) * I.r * 0.75, pz = I.y + Math.sin(a) * I.r * 0.75;
        const d = Math.hypot(px - harbour.cx, pz - harbour.cz);
        if (d >= bd) continue;
        const cs = colonySite(g, this.p, harbour, px, pz);
        if (typeof cs === 'string' || settled.has(g.world.region[cs.shore])) continue;
        bd = d;
        best = cs;
      }
    }
    if (best && stock.board >= 10 && stock.stone >= 8) startExpedition(g, this.p, harbour, best);
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
      const sc = n - Math.hypot(w.nx(i) - hq.cx, w.ny(i) - hq.cz) * 0.4;
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
    for (const b of g.buildings.values()) {
      if (b.owner !== this.p || !b.def.military || b.type === 'hq' || b.state !== 'done') continue;
      let d = Infinity;
      for (const e of enemyMil) d = Math.min(d, Math.hypot(e.x - b.cx, e.z - b.cz));
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

  private tryPlace(type: BuildingType, bias?: 'mountain' | 'water' | 'enemy' | 'stone'): boolean {
    const g = this.g;
    if (BUILDINGS[type].military && !this.canExpand()) return false;
    const w = g.world;
    const def = BUILDINGS[type];
    const nodes = this.territoryNodes();
    if (!nodes.length) return false;
    const hq = g.buildings.get(g.players[this.p].hq);
    const hx = hq ? hq.cx : w.nx(nodes[0]), hz = hq ? hq.cz : w.ny(nodes[0]);
    // enemy direction
    let ex = hx, ez = hz, ed = Infinity;
    for (const b of g.buildings.values()) {
      if (b.owner === this.p || !b.def.military) continue;
      const d = (b.cx - hx) ** 2 + (b.cz - hz) ** 2;
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
      const dHQ = Math.hypot(cx - hx, cz - hz);
      let score = -dHQ * 0.6;
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
        case 'hunter': score = -dHQ * 0.2 + g.rng.next() * 5; break;
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
          const towards = ed < Infinity ? -Math.hypot(cx - ex, cz - ez) * 0.4 : 0;
          const milNear = this.countMilitaryNear(cx, cz, def.military!.radius * 0.8);
          score = -border * 3 + dHQ * 0.5 + towards - milNear * 15;
          if (bias === 'enemy' && ed < Infinity) score = -Math.hypot(cx - ex, cz - ez) * 1.6 - border * 1.5 - milNear * 12;
          if (bias === 'mountain') score += this.countMountain(cx, cz, 10) * 0.5;
          if (bias === 'water') score += this.countWater(cx, cz, 10, false) * 0.3;
          if (bias === 'stone') score += this.countStones(cx, cz, 14) * 0.6;
          break;
        }
        case 'farm': case 'pigfarm': case 'vineyard': score = -dHQ * 0.4 + this.freeLand(cx, cz, 5) * 0.4 - this.countTrees(cx, cz, 5); break;
        case 'harbour': case 'shipyard': {
          // a sheltered spot close to home, the yard next to the harbour
          const hb = [...g.buildings.values()].find((o) => o.owner === this.p && o.type === 'harbour');
          score = -dHQ * 0.5 + (type === 'shipyard' && hb ? -Math.hypot(cx - hb.cx, cz - hb.cz) * 2 : 0);
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
    for (const b of this.g.buildings.values()) if (b.owner === this.p && b.type === type && Math.hypot(b.cx - x, b.cz - z) < r) n++;
    return n;
  }
  private countMilitaryNear(x: number, z: number, r: number) {
    let n = 0;
    for (const b of this.g.buildings.values()) if (b.owner === this.p && b.def.military && Math.hypot(b.cx - x, b.cz - z) < r) n++;
    return n;
  }
  private borderDist(i: number) {
    const w = this.g.world;
    const x = w.nx(i), y = w.ny(i);
    for (let r = 1; r < 16; r++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const xx = Math.round(x + Math.cos(a) * r), yy = Math.round(y + Math.sin(a) * r);
        if (!w.inBounds(xx, yy)) return r;
        if (w.owner[w.idx(xx, yy)] !== this.p) return r;
      }
    }
    return 16;
  }

  /** Priests at work: smite attackers, heal the wounded, speed up the forests. */
  private castStep() {
    const g = this.g;
    const p = g.players[this.p];
    if (p.mana < SPELLS.harvest.cost || p.spellCd > 0) return;
    const st = faithStatus(g, this.p);
    if (!st.priests) return;
    if (st.great && this.level > 0) {
      const foe = this.enemyCluster();
      if (foe) {
        if (this.level >= 2 && foe.n >= 3 && castSpell(g, this.p, 'convert', foe.x, foe.z)) return;
        if (foe.n >= (this.level >= 2 ? 2 : 3) && castSpell(g, this.p, 'wrath', foe.x, foe.z)) return;
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
    // spare mana: ripen a forest when wood runs low
    const reserve = st.great ? SPELLS.wrath.cost + SPELLS.harvest.cost : SPELLS.heal.cost + SPELLS.harvest.cost;
    const stock = g.totalStock(this.p);
    if (p.mana >= reserve && stock.log + stock.board < 12) {
      for (const b of g.buildings.values()) {
        if (b.owner === this.p && b.type === 'forester' && b.state === 'done' && castSpell(g, this.p, 'harvest', b.cx, b.cz)) return;
      }
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
      for (const b of foes) if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 16) { n++; sx += b.x; sz += b.z; }
      if (!best || n > best.n) best = { x: sx / n, z: sz / n, n };
    }
    return best;
  }

  private attackStep() {
    const g = this.g;
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
  }
}
