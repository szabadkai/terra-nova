// A room for one game over the public internet with no server of ours: WebRTC data channels straight
// between the players' browsers, which find each other through Trystero over public Nostr relays. The
// room code is the secret: it names the room and encrypts the handshake. Once connected, the host runs
// the lobby (who sits where, the map) and says when to start; then only turn packets cross the wire.
import { joinRoom, selfId, type Room, type DataPayload } from 'trystero';
import type { TurnPacket } from './lockstep';
import type { GameOptions } from '../game/game';

/** the build this page is from; two machines must match to play the same game */
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
const APP = 'terra-nova';
/** letters that can't be misread for one another */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);

/** who holds which seat (player slot) in the game */
export interface Seat { peer: string; slot: number }
export interface LobbyMsg { opts: GameOptions; seats: Seat[]; host: string; build: string }
export interface StartMsg { opts: GameOptions; seats: Seat[]; delay: number; build: string }

export class GameRoom {
  readonly me = selfId;
  peers: string[] = [];
  onPeers: (peers: string[]) => void = () => {};
  onHello: (peer: string, build: string) => void = () => {};
  onLobby: (l: LobbyMsg, from: string) => void = () => {};
  onStart: (s: StartMsg, from: string) => void = () => {};
  onTurn: (peer: string, pkt: TurnPacket) => void = () => {};
  onError: (text: string) => void = () => {};
  private room: Room;
  private hello; private lobby; private start; private turn;

  constructor(public code: string) {
    // two tabs on one machine (the dev server) only meet over loopback: browsers hide their local addresses
    // behind mDNS names, which an embedded browser may not resolve, and one NAT rarely hairpins to itself
    const dev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    this.room = joinRoom({ appId: APP, password: `${APP}:${code}`, _test_only_mdnsHostFallbackToLoopback: dev }, `${APP}:${code}`, {
      onJoinError: (e) => this.onError(e.error),
    });
    // every action before anyone can connect: a message for an action not yet made would be dropped
    this.hello = this.room.makeAction<DataPayload>('hello');
    this.lobby = this.room.makeAction<DataPayload>('lobby');
    this.start = this.room.makeAction<DataPayload>('start');
    this.turn = this.room.makeAction<DataPayload>('turn');
    this.hello.onMessage = (d, { peerId }) => { const o = d as { build?: string }; this.onHello(peerId, String(o?.build ?? '')); };
    this.lobby.onMessage = (d, { peerId }) => this.onLobby(d as unknown as LobbyMsg, peerId);
    this.start.onMessage = (d, { peerId }) => this.onStart(d as unknown as StartMsg, peerId);
    this.turn.onMessage = (d, { peerId }) => this.onTurn(peerId, d as unknown as TurnPacket);
    this.room.onPeerJoin = (id) => { if (!this.peers.includes(id)) this.peers.push(id); this.onPeers(this.peers); };
    this.room.onPeerLeave = (id) => { this.peers = this.peers.filter((p) => p !== id); this.onPeers(this.peers); };
  }

  sayHello(to?: string) { void this.hello.send({ build: BUILD }, to ? { target: to } : undefined).catch(() => {}); }
  sendLobby(l: LobbyMsg) { void this.lobby.send(l as unknown as DataPayload).catch(() => {}); }
  sendStart(s: StartMsg) { void this.start.send(s as unknown as DataPayload).catch(() => {}); }
  sendTurn(pkt: TurnPacket) { void this.turn.send(pkt as unknown as DataPayload).catch(() => {}); }
  /** round trip to a peer in milliseconds */
  ping(peer: string): Promise<number> { return this.room.ping(peer); }
  leave() { void this.room.leave().catch(() => {}); }
}
