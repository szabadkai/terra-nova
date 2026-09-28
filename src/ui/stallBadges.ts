// Stall badges: over the roof of each of the player's buildings that has stopped, the icon of what it
// lacks — the input, the tool, a settler, the pile that is full, the ground round it that has nothing
// left — so a stuck economy shows without clicking round. Close up a bubble with the icon, far out a
// small tinted dot; a click opens the building. HTML over the canvas, so the tilt-shift blur and the
// tone mapping leave it alone.
import * as THREE from 'three';
import type { Game } from '../game/game';
import { stallGoods, stalledBuildings } from '../game/status';
import { topStalls } from '../game/causes';
import { prefs } from './prefs';
import type { Building } from '../game/types';
import type { GameRenderer } from '../render/renderer';
import { buildingIcons, goodIcons } from './icons';

/** Zoomed out past this many screen pixels per world unit (at the view's centre), badges shrink to dots. */
const DOT_PPU = 22;
/** what the ground round a gatherer has none of, where no good's icon says it */
const LACK_GLYPH: Record<string, string> = { trees: '🌲', game: '🦌', space: '🌱' };
/** How long each good shows when a stall is about several (food: bread, fish, meat). */
const CYCLE = 1.1;
/** Badges shown when only the most important are (prefs.stallBadges 'top'). */
export const TOP_BADGES = 3;

interface Badge {
  el: HTMLElement;
  img: HTMLImageElement;
  glyph: HTMLElement;
  tag: HTMLElement;
  key: string;
}

const v = new THREE.Vector3();

export class StallBadges {
  readonly layer: HTMLElement;
  private badges = new Map<number, Badge>();
  private list: Building[] = [];
  /** the ones with a badge: all of them, the few that matter most, or none */
  private shown: Building[] = [];
  private t = 0;
  private rankT = 0;
  private mode = prefs.stallBadges;
  private clock = 0;

  constructor(private game: Game, private gr: GameRenderer, private open: (b: Building) => void) {
    this.layer = document.createElement('div');
    this.layer.className = 'stall-layer';
  }

  /** The player's stalled buildings as last counted (by id). */
  get stalled(): readonly Building[] {
    return this.list;
  }

  update(dt: number) {
    this.clock += dt;
    this.t -= dt;
    if (this.mode !== prefs.stallBadges) { this.mode = prefs.stallBadges; this.t = this.rankT = 0; }
    if (this.t <= 0) {
      this.t = 0.25;
      this.list = stalledBuildings(this.game, this.game.local);
      // ranking walks every chain, so it is redone once a second
      this.rankT -= 0.25;
      if (this.mode === 'top' && this.rankT <= 0) { this.rankT = 1; this.shown = topStalls(this.game, this.game.local, TOP_BADGES, this.list); }
      if (this.mode === 'all') this.shown = this.list;
      else if (this.mode === 'off') this.shown = [];
      else this.shown = this.shown.filter((b) => this.list.includes(b));
      const keep = new Set(this.shown.map((b) => b.id));
      for (const [id, bd] of this.badges) if (!keep.has(id)) { bd.el.remove(); this.badges.delete(id); }
    }
    const cam = this.gr.cam.camera;
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    // one size for all: by the zoom, not each building's depth, or near and far ones would mix
    const dot = H / (2 * Math.tan((cam.fov * Math.PI) / 360)) / this.gr.cam.dist < DOT_PPU;
    for (const b of this.shown) {
      // the list is a quarter of a second old: at speed a stall can clear (or the building go) in between
      if (!b.stall || !this.game.buildings.has(b.id)) { const bd = this.badges.get(b.id); if (bd) bd.el.style.display = 'none'; continue; }
      const view = this.gr.buildings.views.get(b.id);
      const baseY = view ? view.group.position.y : this.game.world.heightAt(b.cx, b.cz);
      v.set(b.cx, baseY + (view?.height ?? 1.5) + 0.35, b.cz);
      v.project(cam);
      let bd = this.badges.get(b.id);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { if (bd) bd.el.style.display = 'none'; continue; }
      if (!bd) bd = this.make(b);
      this.fill(b, bd);
      const x = (v.x * 0.5 + 0.5) * W, y = (0.5 - v.y * 0.5) * H;
      bd.el.style.display = '';
      bd.el.classList.toggle('dot', dot);
      bd.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  private make(b: Building): Badge {
    const el = document.createElement('div');
    el.className = 'stall';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const img = document.createElement('img');
    img.alt = '';
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    const tag = document.createElement('i');
    bubble.append(img, glyph, tag);
    el.append(bubble);
    el.onclick = (e) => { e.stopPropagation(); const cur = this.game.buildings.get(b.id); if (cur) this.open(cur); };
    // small as it is, it sits over the view: the wheel still zooms there, and a right-click brings no browser menu
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.gr.renderer.domElement.dispatchEvent(new WheelEvent('wheel', e)); }, { passive: false });
    el.oncontextmenu = (e) => e.preventDefault();
    this.layer.append(el);
    const bd: Badge = { el, img, glyph, tag, key: '' };
    this.badges.set(b.id, bd);
    return bd;
  }

  /** Point the badge at what the building lacks (only touches the DOM when that changes). */
  private fill(b: Building, bd: Badge) {
    const st = b.stall!;
    const goods = stallGoods(b);
    const good = goods.length ? goods[Math.floor(this.clock / CYCLE) % goods.length] : null;
    const pic = good ? goodIcons.get(good) : st.kind === 'market' ? buildingIcons.get('market') : undefined;
    const glyph = pic ? '' : st.kind === 'settlers' ? '👤' : st.kind === 'range' ? LACK_GLYPH[st.lack] ?? '!' : '!';
    const mild = st.kind === 'full';
    const tag = st.kind === 'full' ? 'full' : st.kind === 'range' || st.kind === 'exhausted' ? '✕' : st.kind === 'tool' ? 'tool' : '';
    const key = `${pic ?? ''}|${glyph}|${tag}|${b.status}`;
    if (key === bd.key) return;
    bd.key = key;
    if (pic) bd.img.src = pic;
    bd.img.style.display = pic ? '' : 'none';
    bd.glyph.textContent = glyph;
    bd.tag.textContent = tag;
    bd.tag.style.display = tag ? '' : 'none';
    bd.el.classList.toggle('mild', mild);
    bd.el.title = `${b.def.name}: ${b.status}`;
  }

  dispose() {
    this.layer.remove();
    this.badges.clear();
  }
}
