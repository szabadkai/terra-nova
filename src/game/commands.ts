// Player commands: everything a player can do to the game, as plain data that can be queued, sent over
// the wire and applied on every machine alike (src/net/lockstep.ts). The user interface never touches
// the simulation directly: it issues one of these and hears how it went through a `cmd` event, which
// carries the command's sequence number back.
import type { Game } from './game';
import { BUILDINGS, GOODS, TOOLS, type BuildingType, type Good } from './defs';
import type { Building, Formation } from './types';
import { callOut, orderAttack, orderGarrison, orderMove, orderReturn, setDrill, setFirm } from './orders';
import { launchAttack } from './military';
import { orderShipAttack, orderShipBombard, orderShipHome, orderShipMove } from './naval';
import { SPELLS, castError, castSpell, type SpellId } from './faith';
import { sendGeologist } from './geology';
import { recallPioneer, sendPioneer } from './pioneers';
import { bookPassengers, cancelExpedition, cancelShipOrder, colonySite, harbourDestinations, placeShipOrder, scoutSeas, startExpedition, type PassengerRole } from './sea';
import { destinationsOf, placeOrder } from './trade';

/** A building's settings a player can change from its panel. */
export type SetKey = 'paused' | 'seaAuto' | 'desiredSoldiers' | 'tradeTo' | 'toolChoice' | 'shipKind';

export type Cmd = { seq?: number } & (
  | { t: 'speed'; s: number }
  | { t: 'place'; b: BuildingType; x: number; y: number }
  | { t: 'destroy'; id: number }
  | { t: 'prio'; id: number; on: boolean }
  | { t: 'set'; id: number; k: SetKey; v: boolean | number | string }
  | { t: 'pset'; k: 'swordRatio' | 'toolPrio'; tool?: string; v: number }
  | { t: 'move'; ids: number[]; x: number; z: number; shape?: Formation; face?: number }
  | { t: 'drill'; ids: number[]; shape: Formation }
  | { t: 'firm'; ids: number[]; firm: boolean }
  | { t: 'storm'; ids: number[]; b: number }
  | { t: 'garrison'; ids: number[]; b: number }
  | { t: 'return'; ids: number[] }
  | { t: 'callout'; b: number; keep: number }
  | { t: 'launch'; b: number; n: number }
  | { t: 'sail'; ids: number[]; x: number; z: number }
  | { t: 'hunt'; ids: number[]; ship: number }
  | { t: 'bombard'; ids: number[]; b: number }
  | { t: 'moor'; ids: number[]; b?: number }
  | { t: 'cast'; id: SpellId; x: number; z: number }
  | { t: 'geologist'; x: number; z: number }
  | { t: 'pioneer'; x: number; z: number }
  | { t: 'recall'; s: number }
  | { t: 'expedition'; from: number; x: number; z: number }
  | { t: 'exCancel'; from: number }
  | { t: 'scout'; from: number }
  | { t: 'shipOrder'; from: number; to: number; good: Good; n: number }
  | { t: 'shipOrderCancel'; id: number }
  | { t: 'pax'; from: number; to: number; role: PassengerRole; n: number }
  | { t: 'order'; from: number; to: number; good: Good; n: number }
);

/** How a command went: `n` what it moved or sent, `ids` who answered it, `text` why it did not. */
export interface CmdResult { ok: boolean; n?: number; ids?: number[]; text?: string }

const FORMATIONS: Formation[] = ['line', 'block', 'wedge', 'ring'];
const ROLES: PassengerRole[] = ['carrier', 'soldier', 'builder'];
const SET_KEYS: SetKey[] = ['paused', 'seaAuto', 'desiredSoldiers', 'tradeTo', 'toolChoice', 'shipKind'];

type Field = 'int' | 'num' | 'bool' | 'str' | 'ids' | 'any' | 'int?' | 'num?' | 'str?';
/** The fields each command carries, for checking what comes in off the wire. */
const SHAPE: Record<Cmd['t'], Record<string, Field>> = {
  speed: { s: 'int' },
  place: { b: 'str', x: 'int', y: 'int' },
  destroy: { id: 'int' },
  prio: { id: 'int', on: 'bool' },
  set: { id: 'int', k: 'str', v: 'any' },
  pset: { k: 'str', tool: 'str?', v: 'num' },
  move: { ids: 'ids', x: 'num', z: 'num', shape: 'str?', face: 'num?' },
  drill: { ids: 'ids', shape: 'str' },
  firm: { ids: 'ids', firm: 'bool' },
  storm: { ids: 'ids', b: 'int' },
  garrison: { ids: 'ids', b: 'int' },
  return: { ids: 'ids' },
  callout: { b: 'int', keep: 'int' },
  launch: { b: 'int', n: 'int' },
  sail: { ids: 'ids', x: 'num', z: 'num' },
  hunt: { ids: 'ids', ship: 'int' },
  bombard: { ids: 'ids', b: 'int' },
  moor: { ids: 'ids', b: 'int?' },
  cast: { id: 'str', x: 'num', z: 'num' },
  geologist: { x: 'num', z: 'num' },
  pioneer: { x: 'num', z: 'num' },
  recall: { s: 'int' },
  expedition: { from: 'int', x: 'num', z: 'num' },
  exCancel: { from: 'int' },
  scout: { from: 'int' },
  shipOrder: { from: 'int', to: 'int', good: 'str', n: 'int' },
  shipOrderCancel: { id: 'int' },
  pax: { from: 'int', to: 'int', role: 'str', n: 'int' },
  order: { from: 'int', to: 'int', good: 'str', n: 'int' },
};

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 32;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether `c` has the shape of a command: the right fields, finite numbers, short strings. Values are checked again as it is applied. */
export function validCmd(c: unknown): c is Cmd {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  const shape = typeof o.t === 'string' ? SHAPE[o.t as Cmd['t']] : undefined;
  if (!shape) return false;
  if (o.seq !== undefined && !Number.isInteger(o.seq)) return false;
  for (const [k, f] of Object.entries(shape)) {
    const v = o[k];
    if (v === undefined) { if (f.endsWith('?')) continue; return false; }
    switch (f.replace('?', '')) {
      case 'int': if (!Number.isInteger(v)) return false; break;
      case 'num': if (!isNum(v)) return false; break;
      case 'bool': if (typeof v !== 'boolean') return false; break;
      case 'str': if (!isStr(v)) return false; break;
      case 'ids': if (!Array.isArray(v) || v.length > 500 || !v.every((x) => Number.isInteger(x))) return false; break;
      case 'any': if (!(typeof v === 'boolean' || isNum(v) || isStr(v))) return false; break;
    }
  }
  return true;
}

/** Carry out a player's command and tell the world how it went (a `cmd` event with the command's `seq`). */
export function applyCommand(g: Game, owner: number, c: Cmd): CmdResult {
  const r = run(g, owner, c);
  g.emit({ type: 'cmd', owner, seq: c.seq, ok: r.ok, n: r.n, ids: r.ids, text: r.text });
  return r;
}

const count = (n: number): CmdResult => ({ ok: n > 0, n });
const said = (err: string | null): CmdResult => (err ? { ok: false, text: err } : { ok: true });
const clampInt = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(v)));
const no: CmdResult = { ok: false };

function run(g: Game, owner: number, c: Cmd): CmdResult {
  const p = g.players[owner];
  if (!p || !p.alive) return no;
  /** one of the player's own buildings, by id */
  const mine = (id: number): Building | null => {
    const b = g.buildings.get(id);
    return b && b.owner === owner ? b : null;
  };
  switch (c.t) {
    case 'speed': return { ok: true }; // the lockstep driver's, not the game's
    case 'place': {
      if (!(c.b in BUILDINGS)) return no;
      const err = g.placeError(c.b, owner, c.x, c.y);
      if (err) return { ok: false, text: err };
      const b = g.placeBuilding(c.b, owner, c.x, c.y);
      return b ? { ok: true, ids: [b.id] } : { ok: false, text: 'That ground is taken' };
    }
    case 'destroy': {
      const b = mine(c.id);
      if (!b || b.type === 'hq' || b.state === 'burning') return no;
      g.destroyBuilding(b, true);
      return { ok: true };
    }
    case 'prio': {
      const b = mine(c.id);
      if (!b) return no;
      return g.setPriority(b, c.on) ? { ok: true } : { ok: false, text: 'Only a building that still needs goods can be prioritised' };
    }
    case 'set': {
      const b = mine(c.id);
      if (!b || !SET_KEYS.includes(c.k)) return no;
      const v = c.v;
      switch (c.k) {
        case 'paused': if (typeof v !== 'boolean') return no; b.paused = v; break;
        case 'seaAuto': if (typeof v !== 'boolean') return no; b.seaAuto = v; break;
        case 'desiredSoldiers': if (!isNum(v) || !b.def.military) return no; b.desiredSoldiers = clampInt(v, 1, b.def.military.capacity); break;
        case 'tradeTo': {
          if (!Number.isInteger(v)) return no;
          const dests = b.type === 'harbour' ? harbourDestinations(g, b) : destinationsOf(g, b);
          if (v !== 0 && !dests.some((d) => d.id === v)) return no;
          b.tradeTo = v as number;
          break;
        }
        case 'toolChoice': if (v !== 'auto' && !TOOLS.includes(v as Good)) return no; b.toolChoice = v as Good | 'auto'; break;
        case 'shipKind': if (v !== 'war' && v !== 'trade') return no; b.shipKind = v; break;
      }
      return { ok: true };
    }
    case 'pset': {
      if (c.k === 'swordRatio') p.swordRatio = Math.max(0, Math.min(1, c.v));
      else if (c.tool && TOOLS.includes(c.tool as Good)) p.toolPrio[c.tool] = clampInt(c.v, 0, 10);
      else return no;
      return { ok: true };
    }
    case 'move': return count(orderMove(g, owner, c.ids, c.x, c.z, c.shape && FORMATIONS.includes(c.shape) ? c.shape : undefined, c.face));
    case 'drill': return FORMATIONS.includes(c.shape) ? count(setDrill(g, owner, c.ids, c.shape)) : no;
    case 'firm': return count(setFirm(g, owner, c.ids, c.firm));
    case 'storm': {
      const b = g.buildings.get(c.b);
      if (!b || b.owner === owner || !b.def.military || b.state !== 'done') return no;
      return count(orderAttack(g, owner, c.ids, b));
    }
    case 'garrison': {
      const b = mine(c.b);
      if (!b || !b.def.military || b.state !== 'done') return no;
      return count(orderGarrison(g, owner, c.ids, b));
    }
    case 'return': return count(orderReturn(g, owner, c.ids));
    case 'callout': {
      const b = mine(c.b);
      if (!b) return no;
      const men = callOut(g, owner, b, clampInt(c.keep, 0, 99));
      return { ok: men.length > 0, n: men.length, ids: men.map((s) => s.id) };
    }
    case 'launch': {
      const b = g.buildings.get(c.b);
      if (!b || b.owner === owner) return no;
      return count(launchAttack(g, owner, b, clampInt(c.n, 1, 999)));
    }
    case 'sail': return count(orderShipMove(g, owner, c.ids, c.x, c.z));
    case 'hunt': {
      const s = g.ships.get(c.ship);
      if (!s || s.owner === owner) return no;
      return count(orderShipAttack(g, owner, c.ids, s));
    }
    case 'bombard': {
      const b = g.buildings.get(c.b);
      if (!b || b.owner === owner) return no;
      return count(orderShipBombard(g, owner, c.ids, b));
    }
    case 'moor': {
      let to: Building | undefined;
      if (c.b !== undefined) {
        const h = mine(c.b);
        if (!h) return no;
        to = h;
      }
      return count(orderShipHome(g, owner, c.ids, to));
    }
    case 'cast': {
      if (!(c.id in SPELLS)) return no;
      const err = castError(g, owner, c.id, c.x, c.z);
      if (err) return { ok: false, text: err };
      castSpell(g, owner, c.id, c.x, c.z);
      return { ok: true };
    }
    case 'geologist': return said(sendGeologist(g, owner, c.x, c.z));
    case 'pioneer': return said(sendPioneer(g, owner, c.x, c.z));
    case 'recall': {
      const s = g.settlers.get(c.s);
      if (!s || s.owner !== owner || s.job !== 'pioneer') return no;
      recallPioneer(g, s);
      return { ok: true };
    }
    case 'expedition': {
      const from = mine(c.from);
      if (!from) return no;
      const site = colonySite(g, owner, from, c.x, c.z);
      if (typeof site === 'string') return { ok: false, text: site };
      startExpedition(g, owner, from, site);
      return { ok: true };
    }
    case 'exCancel': {
      const ex = g.expeditions.find((e) => e.from === c.from && e.owner === owner);
      if (!ex) return no;
      cancelExpedition(g, ex);
      return { ok: true };
    }
    case 'scout': {
      const from = mine(c.from);
      return from ? said(scoutSeas(g, owner, from)) : no;
    }
    case 'shipOrder': {
      const from = mine(c.from);
      if (!from || !GOODS.includes(c.good)) return no;
      return said(placeShipOrder(g, from, c.to, c.good, clampInt(c.n, -50, 50)));
    }
    case 'shipOrderCancel': {
      const o = g.seaOrders.find((x) => x.id === c.id && x.owner === owner);
      if (!o) return no;
      cancelShipOrder(o);
      return { ok: true };
    }
    case 'pax': {
      const from = mine(c.from);
      if (!from || !ROLES.includes(c.role)) return no;
      const r = bookPassengers(g, from, c.to, c.role, clampInt(c.n, -50, 50));
      return typeof r === 'string' ? { ok: false, text: r } : { ok: r > 0, n: r };
    }
    case 'order': {
      const from = mine(c.from);
      if (!from || !GOODS.includes(c.good)) return no;
      return said(placeOrder(g, from, c.to, c.good, clampInt(c.n, -50, 50)));
    }
  }
  return no;
}
