// A fingerprint of the game's state, cheap enough to take ten times a second: the machines in a
// lockstep game compare theirs turn by turn, and the headless checks compare two games. It covers what
// the players' commands and the game's own course change; not the fog, which each player sees their own of.
import type { Game } from './game';
import { GOODS, TOOLS } from './defs';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
let h = 0;
/** FNV-1a over 32-bit words */
const mix = (v: number) => { h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0; };
const int = (v: number) => mix(v | 0);
const num = (v: number) => { f64[0] = v; mix(u32[0]); mix(u32[1]); };
const str = (s: string) => { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); mix(0xff); };
const finish = () => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; return h >>> 0; };

/** The hash in sections, so a mismatch names what drifted first. */
export function stateHashParts(g: Game): Record<string, number> {
  const out: Record<string, number> = {};
  const section = (name: string, fill: () => void) => { h = 0x811c9dc5; fill(); out[name] = finish(); };
  section('core', () => { int(g.rng.state); num(g.time); int(g.nextId); int(g.over ? 1 : 0); int(g.winner); num(g.seaT); num(g.tradeT); });
  section('players', () => {
    for (const p of g.players) {
      int(p.alive ? 1 : 0); int(p.fallen ? 1 : 0); int(p.hq); num(p.mana); num(p.spellCd); num(p.morale); num(p.swordRatio); num(p.dispatchT); num(p.militaryT);
      for (const t of TOOLS) int(p.toolPrio[t]);
    }
  });
  section('settlers', () => {
    for (const s of g.settlers.values()) { int(s.id); int(s.owner); str(s.job); int(s.node); int(s.next); num(s.t); num(s.hp); str(s.anim); int(s.inside); int(s.dead ? 1 : 0); }
  });
  section('buildings', () => {
    for (const b of g.buildings.values()) {
      int(b.id); int(b.owner); str(b.state); num(b.workT); num(b.buildWork); int(b.worker); int(b.garrison.length); int(b.paused ? 1 : 0);
      int(b.desiredSoldiers); int(b.tradeTo); int(b.priority ? 1 : 0); num(b.damage); str(b.toolChoice); str(b.shipKind); int(b.seaAuto ? 1 : 0);
      for (const gd of GOODS) int(b.stock[gd]);
    }
  });
  section('ships', () => {
    for (const s of g.ships.values()) { int(s.id); int(s.owner); str(s.state); num(s.x); num(s.z); num(s.heading); num(s.hp); int(s.at); int(s.to); int(s.target); }
  });
  section('orders', () => {
    for (const o of g.seaOrders) { int(o.id); int(o.owner); int(o.from); int(o.to); str(o.good); int(o.n); int(o.loaded); int(o.delivered); }
    for (const o of g.tradeOrders) { int(o.owner); int(o.from); int(o.to); str(o.good); int(o.n); int(o.delivered); }
    for (const e of g.expeditions) { int(e.id); int(e.owner); int(e.from); str(e.state); }
    int(g.projectiles.length); int(g.hits.length);
  });
  section('nature', () => {
    for (const t of g.trees.values()) { int(t.id); num(t.growth); str(t.state); }
    for (const a of g.animals.values()) { int(a.id); int(a.node); int(a.next); num(a.t); }
    int(g.stones.size); int(g.fields.size);
  });
  section('world', () => {
    const w = g.world;
    for (let i = 0; i < w.N; i++) mix(w.owner[i] + (w.seen[i] << 8) + (w.claim[i] << 16));
  });
  return out;
}

/** One number for the whole state. */
export function stateHash(g: Game): number {
  const parts = stateHashParts(g);
  h = 0x811c9dc5;
  for (const k in parts) mix(parts[k]);
  return finish();
}
