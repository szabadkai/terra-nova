// The lobby of a game with a friend: host a room and pass on its code, or join one by code. The seats
// fill as people arrive; the host starts the game. Over the title screen's orbiting preview, like the menu.
import { PLAYER_COLORS, PLAYER_NAMES } from '../game/defs';
import type { MenuOptions } from './menu';

export interface LobbyHooks {
  host(): void;
  join(code: string): void;
  start(): void;
  back(): void;
}

const SIZE_NAMES: Record<number, string> = { 128: 'Small', 160: 'Medium', 208: 'Large' };
const AI_LEVELS = ['easy', 'normal', 'hard'];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Lobby {
  el: HTMLElement;
  private card: HTMLElement;

  constructor(parent: HTMLElement, private opts: MenuOptions, private hooks: LobbyHooks) {
    this.el = document.createElement('div');
    this.el.className = 'menu lobby';
    this.el.innerHTML = `
      <div class="menu-inner">
        <div class="title"><div class="crest">⚜</div><h1>Terra Nova</h1><div class="sub">Play with a friend</div></div>
        <div class="panel menu-card"></div>
        <div class="menu-foot">The two games talk to each other directly; the room code is all that passes through the public relays.</div>
      </div>`;
    this.card = this.el.querySelector('.menu-card')!;
    parent.appendChild(this.el);
    this.showChoice();
  }

  /** Host or join. */
  showChoice() {
    this.card.innerHTML = `
      <p class="note">One of you hosts and tells the other the room code. The host's map settings (${SIZE_NAMES[this.opts.size] ?? this.opts.size} map, ${this.opts.players} kingdoms, seed ${this.opts.seed}) are the game's; change them on the title screen first.</p>
      <button class="wide primary big" id="host">Host a game</button>
      <div class="field" style="margin-top:14px"><label>Or join with a code</label>
        <div class="seedrow"><input id="code" maxlength="6" placeholder="ABCDEF" autocomplete="off" spellcheck="false"><button id="join">Join</button></div></div>
      <p class="lstatus"></p>
      <button class="wide" id="back">Back</button>`;
    this.card.querySelector<HTMLButtonElement>('#host')!.onclick = () => this.hooks.host();
    const input = this.card.querySelector<HTMLInputElement>('#code')!;
    const join = () => this.hooks.join(input.value);
    this.card.querySelector<HTMLButtonElement>('#join')!.onclick = join;
    input.onkeydown = (e) => { if (e.key === 'Enter') join(); };
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z]/g, ''); };
    this.card.querySelector<HTMLButtonElement>('#back')!.onclick = () => this.hooks.back();
    input.focus();
  }

  /** In a room: its code, the seats, and for the host the start button. */
  showRoom(code: string, hosting: boolean) {
    this.card.innerHTML = `
      <div class="field"><label>Room code</label><div class="code" title="Select and copy">${code}</div>
        <p class="note">${hosting ? 'Tell your friend this code; they enter it under “Play with a friend”.' : 'You are in the room; the host starts the game.'}</p></div>
      <div class="field"><label>Kingdoms</label><div class="seats"></div></div>
      <p class="lstatus"></p>
      ${hosting ? '<button class="wide primary big" id="start" disabled>Start the game</button>' : ''}
      <button class="wide" id="back">Leave</button>`;
    const start = this.card.querySelector<HTMLButtonElement>('#start');
    if (start) start.onclick = () => this.hooks.start();
    this.card.querySelector<HTMLButtonElement>('#back')!.onclick = () => this.hooks.back();
  }

  /** Who sits where: the people by seat, computer kingdoms for the rest of `players`, an empty seat for a friend still to come. */
  setSeats(people: { slot: number; who: string }[], players: number, aiLevel: number, humans = 2) {
    const box = this.card.querySelector('.seats');
    if (!box) return;
    box.innerHTML = '';
    for (let slot = 0; slot < Math.max(players, humans); slot++) {
      const p = people.find((x) => x.slot === slot);
      const who = p ? p.who : slot < humans ? 'waiting for a friend…' : `computer, ${AI_LEVELS[aiLevel] ?? 'normal'}`;
      const seat = document.createElement('div');
      seat.className = `seat${!p && slot < humans ? ' open' : ''}`;
      seat.innerHTML = `<span class="sw" style="background:${hex(PLAYER_COLORS[slot])}"></span><span>${PLAYER_NAMES[slot]}</span><span class="who">${who}</span>`;
      box.appendChild(seat);
    }
  }

  status(text: string, bad = false) {
    const el = this.card.querySelector('.lstatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('bad', bad);
  }

  canStart(on: boolean) {
    const b = this.card.querySelector<HTMLButtonElement>('#start');
    if (b) b.disabled = !on;
  }

  remove() {
    this.el.remove();
  }
}
