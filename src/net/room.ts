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

/** How the way to the other machines is to be found (all optional; the defaults are public STUN servers and Nostr relays). */
export interface RoomOptions {
  /** STUN and TURN servers in place of the defaults */
  ice?: RTCIceServer[];
  /** 'relay': only through a TURN server (a test of that path, or the last resort behind a NAT STUN can't cross) */
  policy?: RTCIceTransportPolicy;
  /** Nostr relays in place of the defaults */
  relays?: string[];
}

/** What carries the game to one machine: the kinds of the two ends of the chosen path (host, srflx = through the NAT by STUN, relay = TURN) and the round trip. */
export interface PathStats { peer: string; local: string; remote: string; rtt: number | null; state: string }

/** `?ice=stun:host:3478,turn:user:pass@host:3478,turns:...` as ICE servers */
export function parseIce(s: string): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(turns?|stuns?):(?:([^:@]+):([^@]+)@)?(.+)$/.exec(part);
    if (!m) continue;
    const [, kind, user, pass, host] = m;
    out.push(user ? { urls: `${kind}:${host}`, username: user, credential: pass } : { urls: `${kind}:${host}` });
  }
  return out;
}

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

  constructor(public code: string, o: RoomOptions = {}) {
    // two tabs on one machine (the dev server) only meet over loopback: browsers hide their local addresses
    // behind mDNS names, which an embedded browser may not resolve, and one NAT rarely hairpins to itself
    const dev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const rtcConfig: RTCConfiguration | undefined = o.ice || o.policy ? { iceServers: o.ice, iceTransportPolicy: o.policy } : undefined;
    this.room = joinRoom({
      appId: APP, password: `${APP}:${code}`, rtcConfig, relayConfig: o.relays?.length ? { urls: o.relays } : undefined,
      _test_only_mdnsHostFallbackToLoopback: dev,
    }, `${APP}:${code}`, { onJoinError: (e) => this.onError(e.error) });
    // every action before anyone can connect: a message for an action not yet made would be dropped
    this.hello = this.room.makeAction<DataPayload>('hello');
    this.lobby = this.room.makeAction<DataPayload>('lobby');
    this.start = this.room.makeAction<DataPayload>('start');
    this.turn = this.room.makeAction<DataPayload>('turn');
    this.hello.onMessage = (d, { peerId }) => { const x = d as { build?: string }; this.onHello(peerId, String(x?.build ?? '')); };
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

  /** The path the data takes to each connected machine, from the connection's own statistics. */
  async stats(): Promise<PathStats[]> {
    const out: PathStats[] = [];
    for (const [peer, pc] of Object.entries(this.room.getPeers())) {
      const st: PathStats = { peer, local: '?', remote: '?', rtt: null, state: pc.iceConnectionState };
      try {
        const reports = await pc.getStats();
        const by = new Map<string, Record<string, unknown>>();
        reports.forEach((r) => by.set(r.id, r as unknown as Record<string, unknown>));
        for (const r of by.values()) {
          if (r.type !== 'candidate-pair' || r.state !== 'succeeded' || !(r.nominated ?? true)) continue;
          const l = by.get(r.localCandidateId as string), m = by.get(r.remoteCandidateId as string);
          st.local = String(l?.candidateType ?? '?');
          st.remote = String(m?.candidateType ?? '?');
          st.rtt = typeof r.currentRoundTripTime === 'number' ? Math.round(r.currentRoundTripTime * 1000) : null;
        }
      } catch { /* stats unavailable */ }
      out.push(st);
    }
    return out;
  }
}
