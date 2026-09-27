// Computer opponent: builds an economy by priority rules and attacks when strong.
import { BUILDINGS, BuildingType, MINE_ORE } from './defs';
import type { Game } from './game';
import { attackableSoldiers, launchAttack } from './military';
import type { Building } from './types';

interface Want { type: BuildingType; n: number; cond?: () => boolean; }

export class AIController {
  private t: number;
  private attackT: number;
  private expandT = 0;
  constructor(private g: Game, public p: number, public level: number) {
    this.t = 2 + p;
    this.attackT = [600, 420, 280][level] ?? 420;
  }

  private get interval() {
    return [6, 4, 2.6][this.level] ?? 4;
  }

  update(dt: number) {
    const g = this.g;
    if (!g.players[this.p].alive) return;
    this.t -= dt;
    this.attackT -= dt;
    this.expandT -= dt;
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
      { type: 'goldmine', n: 1, cond: () => hasOre('gold') },
      { type: 'goldsmelter', n: 1, cond: () => c('goldmine') > 0 },
      { type: 'sawmill', n: 2 },
      { type: 'stonemine', n: 1, cond: () => this.stonesInTerritory() < 3 && hasOre('stone') },
      { type: 'residence_s', n: 3, cond: () => pop.idle < 5 },
      { type: 'tower_s', n: 6, cond: () => t > 500 },
      { type: 'tower_l', n: 3, cond: () => t > 800 },
      { type: 'ironmine', n: 2, cond: () => hasOre('iron') },
      { type: 'weaponsmith', n: 2, cond: () => t > 900 },
      { type: 'castle', n: 1, cond: () => t > 1200 },
    ];
    // expansion pressure
    if (this.expandT <= 0 && stock.board > 6 && stock.stone > 4) {
      this.expandT = [240, 160, 100][this.level] ?? 160;
      if (this.tryPlace(g.time > 700 && g.rng.chance(0.4) ? 'tower_l' : 'tower_s')) return;
    }
    // residences when out of carriers
    if (pop.idle < 2 && c('residence_s') + c('residence_m') < 8 && sites < maxSites) {
      if (this.tryPlace(pop.total > 60 ? 'residence_m' : 'residence_s')) return;
    }
    for (const w of wants) {
      if (c(w.type) >= w.n) continue;
      if (w.cond && !w.cond()) continue;
      const def = BUILDINGS[w.type];
      if (stock.board < def.cost.board * 0.5 && w.type !== 'sawmill' && w.type !== 'woodcutter') continue;
      if (this.tryPlace(w.type)) return;
      // could not place: if it's a mine or water building, try expanding instead
      if (def.mine || w.type === 'fisher') {
        if (this.expandT <= 60) { this.expandT = 60; if (this.tryPlace('tower_s', def.mine ? 'mountain' : 'water')) return; }
        continue;
      }
    }
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
  private oreInTerritory(ore: string) {
    const w = this.g.world;
    const o = MINE_ORE[ore];
    let n = 0;
    for (let i = 0; i < w.N; i++) if (w.owner[i] === this.p && w.ore[i] === o) n += w.oreAmt[i];
    return n;
  }

  /** Only expand when a soldier can actually man the new tower. */
  private canExpand(): boolean {
    const g = this.g;
    let unmanned = 0, reserve = 0;
    for (const b of g.buildings.values()) {
      if (b.owner !== this.p || !b.def.military) continue;
      if (b.state !== 'done') { unmanned++; continue; }
      if (!b.occupied) unmanned++;
      if (b.type === 'hq') reserve += Math.max(0, b.garrison.length - 2);
    }
    for (const s of g.settlers.values()) if (s.owner === this.p && s.sstate === 'idle' && (s.job === 'swordsman' || s.job === 'bowman') && !s.dead) reserve++;
    return unmanned === 0 && reserve > 0;
  }

  private tryPlace(type: BuildingType, bias?: 'mountain' | 'water'): boolean {
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
          w.forRadius(cx, cz, 3.5, (j) => { if (w.ore[j] === ore) n += w.oreAmt[j]; });
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
          if (bias === 'mountain') score += this.countMountain(cx, cz, 10) * 0.5;
          if (bias === 'water') score += this.countWater(cx, cz, 10, false) * 0.3;
          break;
        }
        case 'farm': case 'pigfarm': score = -dHQ * 0.4 + this.freeLand(cx, cz, 5) * 0.4 - this.countTrees(cx, cz, 5); break;
      }
      if (score > bs) { bs = score; best = a; }
    }
    if (!best) return false;
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
