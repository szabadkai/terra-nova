// Deterministic lockstep: every machine in a game runs the whole simulation, and only the players'
// commands cross the wire. Real time is cut into turns of TURN_S; the commands a player gives during
// turn T go out at once and everyone applies them before the first tick of turn T + delay, so nobody
// waits for anyone as long as the network delivers within `delay` turns. Each turn ends with a hash
// of the game, which the machines compare to catch a drift. A game with one human runs through the
// same driver with no delay, so the game has one path however many play.
import { TICK, type Game } from '../game/game';
import { applyCommand, type Cmd } from '../game/commands';
import { stateHash } from '../game/hash';

/** the speeds a player can pick; 0 is paused */
export const SPEEDS = [0, 1, 2, 3, 4];
/** a turn's length in real seconds: at speed s it holds TURN_TICKS * s ticks */
export const TURN_S = 0.1;
const TURN_TICKS = Math.round(TURN_S / TICK);

export interface TurnPacket {
  turn: number;
  cmds: Cmd[];
  /** the sender's hash of the game after turn `hashTurn` (-1: none yet), for the others to check theirs against */
  hashTurn: number;
  hash: number;
}

export type DriverEvent =
  | { type: 'waiting'; slot: number } // a player's commands for the next turn have not come
  | { type: 'ready' } // ...and now they have
  | { type: 'desync'; turn: number }
  | { type: 'lost'; slot: number }; // a player has not been heard from for too long

export class Lockstep {
  speed = 1;
  /** the last speed above 0, for the pause key to come back to */
  pausedSpeed = 1;
  turn = 0;
  ticks = 0;
  /** alone: the Esc menu holds the game (with others it goes on; only the host's pause stops it) */
  hold = false;
  /** stopped for good: a desync or a lost player */
  frozen = false;
  onEvent: (e: DriverEvent) => void = () => {};
  send: (pkt: TurnPacket) => void = () => {};
  /** each turn as it ends, for the checks (the game is exactly at the turn's boundary) */
  onTurnEnd: (turn: number) => void = () => {};
  private tickInTurn = -1; // -1: the turn has not begun
  private turnTicks = 0;
  private acc = 0;
  private last = -1;
  private seq = 0;
  private outbox: Cmd[] = [];
  private inbox = new Map<number, Map<number, Cmd[]>>();
  private hashes = new Map<number, { local?: number; remote: Map<number, number> }>();
  private waitingSince = -1;
  private waiting = false;
  /** the seats heard from at least once: only those can be given up for lost (a friend still building the world is not) */
  private heard = new Set<number>();

  /** `humans`: the players' slots, the host first; `delay` in turns (0 alone). */
  constructor(public g: Game, public humans: number[], public delay: number) {}

  get solo() {
    return this.humans.length <= 1;
  }
  get local() {
    return this.g.local;
  }

  /** With others: the first `delay` turns need nobody's commands, so everyone can start at once. */
  start() {
    for (let t = 0; t < this.delay; t++) for (const s of this.humans) this.slotCmds(t).set(s, []);
  }

  /** A command from the local player: done now when alone, sent for the turn `delay` turns on otherwise. Returns its sequence number. */
  issue(c: Cmd): number {
    c.seq = ++this.seq;
    if (this.solo) this.apply(this.local, c);
    else this.outbox.push(c);
    return c.seq;
  }

  /** Advance the game as far as the real time since the last call allows; returns the ticks run. */
  pump(now: number): number {
    if (this.last < 0) this.last = now;
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.frozen) return 0;
    if (this.solo && this.hold) { this.acc = 0; return 0; }
    this.acc = Math.min(0.25, this.acc + dt);
    let ran = 0;
    for (;;) {
      if (this.tickInTurn < 0) {
        if (!this.ready(this.turn)) {
          // hold the game until the missing commands come, and don't rush to catch up afterwards
          this.acc = Math.min(this.acc, TURN_S);
          if (this.waitingSince < 0) this.waitingSince = now;
          else if (!this.waiting && now - this.waitingSince > 500) { this.waiting = true; this.onEvent({ type: 'waiting', slot: this.missing(this.turn) }); }
          else if (now - this.waitingSince > 15000 && this.heard.has(this.missing(this.turn))) { this.frozen = true; this.onEvent({ type: 'lost', slot: this.missing(this.turn) }); }
          break;
        }
        if (this.waiting) { this.waiting = false; this.onEvent({ type: 'ready' }); }
        this.waitingSince = -1;
        this.beginTurn();
      }
      if (this.turnTicks === 0) {
        // paused: the turn takes its real time all the same, so the commands (the unpause) keep flowing
        if (this.acc < TURN_S) break;
        this.acc -= TURN_S;
        this.endTurn();
        continue;
      }
      const per = TICK / this.speed;
      if (this.acc < per) break;
      this.acc -= per;
      this.g.tick();
      this.ticks++;
      ran++;
      if (++this.tickInTurn >= this.turnTicks) this.endTurn();
    }
    return ran;
  }

  /** Another player's commands for a turn (and their hash of an earlier one). False: not a packet we can take. */
  onPacket(slot: number, pkt: TurnPacket): boolean {
    if (!this.humans.includes(slot) || slot === this.local) return false;
    // not for a turn already begun (a repeat of one that came in time), nor further ahead than anyone can be
    if (!Number.isInteger(pkt.turn) || pkt.turn < this.turn || (pkt.turn === this.turn && this.tickInTurn >= 0) || pkt.turn > this.turn + 2 * this.delay) return false;
    this.heard.add(slot);
    const by = this.slotCmds(pkt.turn);
    if (by.has(slot)) return false;
    by.set(slot, Array.isArray(pkt.cmds) ? pkt.cmds : []);
    if (Number.isInteger(pkt.hashTurn) && pkt.hashTurn >= 0) {
      this.hashRec(pkt.hashTurn).remote.set(slot, pkt.hash >>> 0);
      this.compare(pkt.hashTurn);
    }
    return true;
  }

  /** The player whose commands for turn `t` are missing, if any. */
  missing(t: number): number {
    const by = this.inbox.get(t);
    for (const s of this.humans) if (s !== this.local && !by?.has(s)) return s;
    return -1;
  }

  private ready(t: number) {
    return this.missing(t) < 0;
  }

  private slotCmds(t: number) {
    let by = this.inbox.get(t);
    if (!by) this.inbox.set(t, (by = new Map()));
    return by;
  }

  private hashRec(t: number) {
    let r = this.hashes.get(t);
    if (!r) this.hashes.set(t, (r = { remote: new Map() }));
    return r;
  }

  private beginTurn() {
    const T = this.turn;
    if (!this.solo) {
      const cmds = this.outbox.splice(0);
      this.slotCmds(T + this.delay).set(this.local, cmds);
      this.send({ turn: T + this.delay, cmds, hashTurn: T - 1, hash: this.hashes.get(T - 1)?.local ?? 0 });
    }
    const by = this.inbox.get(T);
    if (by) {
      // everyone's commands in the same order: by seat, then as given
      for (const s of this.humans) for (const c of by.get(s) ?? []) this.apply(s, c);
      this.inbox.delete(T);
    }
    this.turnTicks = TURN_TICKS * this.speed;
    this.tickInTurn = 0;
  }

  private endTurn() {
    const T = this.turn;
    if (!this.solo) {
      this.hashRec(T).local = stateHash(this.g);
      this.compare(T);
      this.hashes.delete(T - 2 * this.delay - 2);
    }
    this.turn = T + 1;
    this.tickInTurn = -1;
    this.onTurnEnd(T);
  }

  private compare(t: number) {
    const rec = this.hashes.get(t);
    if (!rec || rec.local === undefined || this.frozen) return;
    for (const h of rec.remote.values()) {
      if (h !== rec.local) {
        this.frozen = true;
        this.onEvent({ type: 'desync', turn: t });
        return;
      }
    }
  }

  private apply(slot: number, c: Cmd) {
    if (c.t === 'speed') {
      // the game's pace is the host's to set; alone, the player is the host
      if (slot !== this.humans[0] || !SPEEDS.includes(c.s)) return;
      this.speed = c.s;
      if (c.s > 0) this.pausedSpeed = c.s;
      // alone it takes effect at once, in the turn under way
      if (this.tickInTurn >= 0) this.turnTicks = TURN_TICKS * c.s;
      return;
    }
    applyCommand(this.g, slot, c);
  }
}
