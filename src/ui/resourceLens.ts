// A quiet, temporary view of one good: buildings that make or use it, stores that hold it,
// and the routes of carriers moving it right now. This only reads the game.
import * as THREE from 'three';
import { GOOD_NAMES, TOOLS, type Good } from '../game/defs';
import type { Game } from '../game/game';
import type { Building } from '../game/types';
import type { GameRenderer } from '../render/renderer';

const food: Good[] = ['bread', 'fish', 'meat'];
const related = (good: Good): Good[] => good === 'bread' ? food : good === 'hammer' ? [...TOOLS] : [good];
const v = new THREE.Vector3();

export class ResourceLens {
  good: Good | null = null;
  private layer: HTMLElement;
  private routes: SVGSVGElement;
  private pins: HTMLElement;
  private title: HTMLElement;
  private timer = 0;

  constructor(private game: Game, private gr: GameRenderer, parent: HTMLElement, private open: (b: Building) => void) {
    this.layer = document.createElement('div');
    this.layer.className = 'resource-lens hidden';
    this.layer.innerHTML = '<svg class="resource-routes" aria-hidden="true"></svg><div class="resource-pins"></div><div class="resource-legend panel"><span></span><button aria-label="Close resource view" title="Close resource view">✕</button></div>';
    this.routes = this.layer.querySelector('svg')!;
    this.pins = this.layer.querySelector('.resource-pins')!;
    this.title = this.layer.querySelector('.resource-legend span')!;
    this.layer.querySelector('button')!.onclick = () => this.toggle(null);
    parent.appendChild(this.layer);
  }

  toggle(good: Good | null) {
    this.good = good === this.good ? null : good;
    this.layer.classList.toggle('hidden', !this.good);
    this.timer = 0;
    if (!this.good) { this.routes.replaceChildren(); this.pins.replaceChildren(); }
  }

  update(dt: number) {
    if (!this.good) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const goods = related(this.good);
    const w = this.game.world;
    const cam = this.gr.cam.camera;
    const width = this.layer.clientWidth, height = this.layer.clientHeight;
    const point = (x: number, z: number, above = 1) => {
      v.set(x, w.heightAt(x, z) + above, z).project(cam);
      return v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1 ? null
        : [(v.x * 0.5 + 0.5) * width, (0.5 - v.y * 0.5) * height] as const;
    };
    this.routes.setAttribute('viewBox', `0 0 ${width} ${height}`);
    let sources = 0, users = 0, stores = 0, carrying = 0;
    const pins = document.createDocumentFragment();
    for (const b of this.game.buildings.values()) {
      if (b.owner !== this.game.local || b.state === 'burning') continue;
      const i = w.idx(Math.round(b.cx), Math.round(b.cz));
      if (!w.explored[i]) continue;
      const makes = b.state === 'done' && !!b.def.outputs?.some((g) => goods.includes(g));
      const siteNeeds = b.state !== 'done' && (goods.includes('board') && b.delivered.board < b.def.cost.board || goods.includes('stone') && b.delivered.stone < b.def.cost.stone);
      const uses = siteNeeds || b.state === 'done' && !!b.def.inputs?.some((input) => input.goods.some((g) => goods.includes(g)));
      const holds = !!b.def.storage && goods.some((g) => b.stock[g] > 0);
      if (!makes && !uses && !holds) continue;
      if (makes) sources++;
      if (uses) users++;
      if (holds) stores++;
      const p = point(b.cx, b.cz, 1.7);
      if (!p) continue;
      const role = makes && uses ? 'Makes and uses' : makes ? 'Makes' : siteNeeds ? 'Needs for construction' : uses ? 'Uses' : 'Stores';
      const pin = document.createElement('button');
      pin.className = `resource-pin ${makes ? 'source' : uses ? 'user' : 'store'}`;
      pin.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
      pin.textContent = makes ? '↑' : uses ? '↓' : '■';
      pin.title = `${b.def.name} · ${role.toLowerCase()} ${this.good === 'bread' ? 'food' : this.good === 'hammer' ? 'tools' : GOOD_NAMES[this.good].toLowerCase()}${b.status ? ` · ${b.status}` : ''}`;
      pin.setAttribute('aria-label', pin.title);
      pin.onclick = () => this.open(b);
      pins.appendChild(pin);
    }
    this.pins.replaceChildren(pins);
    const paths: string[] = [];
    for (const s of this.game.settlers.values()) {
      if (s.owner !== this.game.local || s.job !== 'carrier' && s.job !== 'donkey' || !goods.some((g) => g === s.carrying || g === s.pack) || s.dead || s.hidden) continue;
      carrying++;
      const pts: string[] = [];
      const at = point(s.x, s.z, 0.45);
      if (!at) continue;
      pts.push(`${at[0].toFixed(1)},${at[1].toFixed(1)}`);
      for (const node of s.path?.slice(s.pathI, s.pathI + 24) ?? []) {
        const p = point(w.nx(node), w.ny(node), 0.3);
        if (p) pts.push(`${p[0].toFixed(1)},${p[1].toFixed(1)}`);
      }
      if (pts.length > 1) paths.push(`<polyline points="${pts.join(' ')}"/>`);
    }
    this.routes.innerHTML = paths.join('');
    this.title.textContent = `${this.good === 'bread' ? 'Food' : this.good === 'hammer' ? 'Tools' : GOOD_NAMES[this.good]} · ↑ ${sources} making · ↓ ${users} using · ■ ${stores} storing · ${carrying} carriers en route`;
  }
}
