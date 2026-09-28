// 2D minimap: shaded terrain, territories, buildings, units and the camera view.
import { PLAYER_COLORS, T_DIRT, T_FOREST, T_GRASS, T_MEADOW, T_ROCK, T_SAND, T_SNOW, T_SWAMP } from '../game/defs';
import type { Game } from '../game/game';
import { WATER_LEVEL } from '../game/world';
import type { RTSCamera } from '../render/camera';
import * as THREE from 'three';
import { G } from '../render/shaderPatch';

const TCOL: Record<number, [number, number, number]> = {
  [T_GRASS]: [96, 146, 52], [T_MEADOW]: [128, 160, 62], [T_FOREST]: [64, 104, 44], [T_DIRT]: [140, 110, 76],
  [T_SAND]: [214, 194, 140], [T_ROCK]: [128, 122, 114], [T_SNOW]: [236, 240, 246], [T_SWAMP]: [80, 90, 56],
};

export class Minimap {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: ImageData;
  private t = 0;
  private baseT = 0;
  constructor(private game: Game, private cam: RTSCamera, parent: HTMLElement) {
    const w = game.world;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w.W;
    this.canvas.height = w.H;
    this.canvas.className = 'minimap';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.base = this.ctx.createImageData(w.W, w.H);
    this.buildBase();
    const jump = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * w.W, z = ((e.clientY - r.top) / r.height) * w.H;
      this.cam.jumpTo(x, z);
    };
    let down = false;
    this.canvas.addEventListener('pointerdown', (e) => { down = true; jump(e); this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => { if (down) jump(e); });
    this.canvas.addEventListener('pointerup', () => { down = false; });
  }

  buildBase() {
    const g = this.game;
    const w = g.world;
    const d = this.base.data;
    // follow the season: straw-coloured grass, autumn and bare woods, snow cover
    const [leaf, turn] = G.uSeasonA.value.toArray();
    const [dry, , , cold] = G.uSeasonB.value.toArray();
    const snow = Math.min(1, G.uSnow.value * 1.4);
    const straw = [150 - cold * 30, 136 - cold * 24, 70 + cold * 10];
    const bare = 1 - leaf;
    for (let y = 0; y < w.H; y++)
      for (let x = 0; x < w.W; x++) {
        const i = y * w.W + x;
        const h = w.h[i];
        let c: [number, number, number];
        if (h < WATER_LEVEL - 0.02) {
          const dep = Math.min(1, (WATER_LEVEL - h) / 4);
          c = [40 - dep * 25, 120 - dep * 60, 150 - dep * 50];
        } else {
          const t = w.terrain[i];
          c = TCOL[t] ?? [100, 140, 60];
          if (t === T_GRASS || t === T_MEADOW || t === T_FOREST || t === T_SWAMP) {
            const k = dry * 0.6;
            c = [c[0] + (straw[0] - c[0]) * k, c[1] + (straw[1] - c[1]) * k, c[2] + (straw[2] - c[2]) * k];
          }
        }
        // hillshade
        const hl = x > 0 ? w.h[i - 1] : h, hu = y > 0 ? w.h[i - w.W] : h;
        const shade = 1 + Math.max(-0.35, Math.min(0.35, (hl - h) * 0.25 + (hu - h) * 0.25));
        let r = c[0] * shade, gg = c[1] * shade, b = c[2] * shade;
        if (w.tree[i] && h >= WATER_LEVEL) {
          const sp = g.trees.get(w.tree[i])?.species;
          if ((sp === 0 || sp === 2 || sp === 4) && (turn > 0 || bare > 0)) {
            // deciduous: autumn gold, then bare grey-brown
            const au = Math.min(1, turn * 1.5) * leaf;
            r *= 0.65 + au * 0.55 + bare * 0.1; gg *= 0.78 - au * 0.1 - bare * 0.12; b *= 0.6 - au * 0.25 + bare * 0.12;
          } else { r *= 0.65; gg *= 0.78; b *= 0.6; }
        }
        if (w.stone[i]) { r = 150; gg = 148; b = 140; }
        if (snow > 0 && h >= WATER_LEVEL - 0.02) {
          const k = snow * (w.tree[i] ? 0.6 : 0.85);
          r += (232 - r) * k; gg += (236 - gg) * k; b += (242 - b) * k;
        }
        d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
  }

  update(dt: number) {
    this.t -= dt;
    this.baseT -= dt;
    if (this.t > 0) return;
    this.t = 0.4;
    if (this.baseT <= 0) { this.baseT = 5; this.buildBase(); }
    const g = this.game;
    const w = g.world;
    const img = this.ctx.createImageData(w.W, w.H);
    const d = img.data, b = this.base.data;
    const pc = PLAYER_COLORS.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
    for (let i = 0; i < w.N; i++) {
      let r = b[i * 4], gg = b[i * 4 + 1], bb = b[i * 4 + 2];
      const o = w.owner[i];
      if (o >= 0) {
        const c = pc[o];
        const x = i % w.W, y = (i / w.W) | 0;
        const edge = (x > 0 && w.owner[i - 1] !== o) || (x < w.W - 1 && w.owner[i + 1] !== o) || (y > 0 && w.owner[i - w.W] !== o) || (y < w.H - 1 && w.owner[i + w.W] !== o);
        const k = edge ? 0.85 : 0.22;
        r = r * (1 - k) + c[0] * k; gg = gg * (1 - k) + c[1] * k; bb = bb * (1 - k) + c[2] * k;
      }
      if (!w.explored[i]) { r *= 0.08; gg *= 0.09; bb *= 0.12; }
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = bb; d[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(img, 0, 0);
    // buildings
    for (const bd of g.buildings.values()) {
      if (!w.explored[w.idx(Math.round(bd.cx), Math.round(bd.cz))]) continue;
      const c = pc[bd.owner];
      this.ctx.fillStyle = bd.state === 'done' ? `rgb(${c[0] * 0.6 + 100},${c[1] * 0.6 + 100},${c[2] * 0.6 + 100})` : 'rgba(255,255,255,0.6)';
      const s = bd.size + (bd.def.military ? 1 : 0);
      this.ctx.fillRect(bd.cx - s / 2, bd.cz - s / 2, s, s);
    }
    // soldiers of all players (visible)
    for (const s of g.settlers.values()) {
      if (s.hidden || s.dead || (s.job !== 'swordsman' && s.job !== 'bowman' && s.job !== 'catapult')) continue;
      if (!w.explored[w.idx(Math.round(s.x), Math.round(s.z))]) continue;
      const c = pc[s.owner];
      this.ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      const r = s.job === 'catapult' ? 1.2 : 0.8;
      this.ctx.fillRect(s.x - r, s.z - r, r * 2, r * 2);
    }
    // ships: a pale hull with the owner's sail
    for (const sh of g.ships.values()) {
      const xi = Math.max(0, Math.min(w.W - 1, Math.round(sh.x))), zi = Math.max(0, Math.min(w.H - 1, Math.round(sh.z)));
      if (sh.owner !== g.local && !w.explored[w.idx(xi, zi)]) continue;
      const c = pc[sh.owner];
      this.ctx.save();
      this.ctx.translate(sh.x, sh.z);
      this.ctx.rotate(-sh.heading);
      this.ctx.fillStyle = '#f4ead4';
      this.ctx.fillRect(-1.1, -2.2, 2.2, 4.4);
      this.ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      this.ctx.fillRect(-1.6, -0.6, 3.2, 1.2);
      this.ctx.restore();
    }
    // camera frustum footprint
    const cam = this.cam.camera;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const p = this.cam.pick(x * 0.98, y * 0.98);
      if (p) return p;
      // fallback: intersect ground plane
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x, y), cam);
      const t = (WATER_LEVEL - ray.ray.origin.y) / ray.ray.direction.y;
      return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t > 0 ? t : 60);
    });
    this.ctx.strokeStyle = 'rgba(255,240,200,0.9)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    corners.forEach((p, k) => (k ? this.ctx.lineTo(p.x, p.z) : this.ctx.moveTo(p.x, p.z)));
    this.ctx.closePath();
    this.ctx.stroke();
  }
}
