// Building meshes: construction reveal, scaffolding, animated parts, goods piles.
import * as THREE from 'three';
import { GOODS, Good } from '../game/defs';
import type { Game } from '../game/game';
import type { Building } from '../game/types';
import { buildingBuilder } from './buildingModels';
import type { Anchors } from './geom';
import { getClipMaterial, getMaterial } from './materials';
import type { PilesRenderer } from './entities';
import { patchedDepthMaterial } from './shaderPatch';
import { Seaworks, buildSeaworks, showHullProgress } from './seaworks';

interface BView {
  id: number;
  type: string;
  owner: number;
  group: THREE.Group;
  anchors: Anchors;
  height: number;
  state: string;
  clipMats: Map<string, THREE.Material> | null;
  clipDepth: THREE.MeshDepthMaterial | null;
  scaffold: THREE.Group | null;
  stakes: THREE.Group | null;
  baseY: number;
  movers: THREE.Object3D[];
  shownProgress: number;
  burnT: number;
  sea: Seaworks | null;
}

export class BuildingsRenderer {
  group = new THREE.Group();
  views = new Map<number, BView>();
  private scaffoldMat: THREE.Material;
  private ropeMat: THREE.Material;

  constructor(private game: Game, private piles: PilesRenderer) {
    this.scaffoldMat = getMaterial('timber');
    this.ropeMat = getMaterial('canvas');
  }

  private create(b: Building): BView {
    const mb = buildingBuilder(b.type, b.owner);
    const group = mb.build((k) => getMaterial(k));
    const y = b.def.mine ? this.game.world.heightAt(b.cx, b.cz) : b.targetH;
    group.position.set(b.cx, y, b.cz);
    group.userData.buildingId = b.id;
    this.group.add(group);
    const movers: THREE.Object3D[] = [];
    group.traverse((o) => { if (o.name) movers.push(o); });
    const box = new THREE.Box3().setFromObject(group);
    // jetty or slipway out to this site's own stretch of sea
    const sea = buildSeaworks(this.game, b, y);
    let anchors = mb.anchors;
    if (sea) {
      group.add(sea.group);
      anchors = { ...mb.anchors, fires: [...mb.anchors.fires, ...sea.fires] };
    }
    const v: BView = {
      id: b.id, type: b.type, owner: b.owner, group, anchors, height: Math.max(0.8, box.max.y - y),
      state: '', clipMats: null, clipDepth: null, scaffold: null, stakes: null, baseY: y, movers, shownProgress: 0, burnT: 0, sea,
    };
    this.views.set(b.id, v);
    return v;
  }

  private dispose(v: BView) {
    this.group.remove(v.group);
    v.sea?.group.traverse((o) => { if (o.parent?.userData.own) (o as THREE.Mesh).geometry?.dispose(); });
    if (v.clipMats) for (const m of v.clipMats.values()) m.dispose();
    v.clipDepth?.dispose();
    this.views.delete(v.id);
  }

  private setClip(v: BView, on: boolean) {
    if (on && !v.clipMats) {
      v.clipMats = new Map();
      v.clipDepth = patchedDepthMaterial({ clip: true });
      v.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const key = m.userData.matKey as string;
        let cm = v.clipMats!.get(key);
        if (!cm) { cm = getClipMaterial(key); v.clipMats!.set(key, cm); }
        m.material = cm;
        m.customDepthMaterial = v.clipDepth!;
      });
    } else if (!on && v.clipMats) {
      v.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = getMaterial(m.userData.matKey);
        m.customDepthMaterial = undefined;
      });
      for (const m of v.clipMats.values()) m.dispose();
      v.clipDepth?.dispose();
      v.clipMats = null;
      v.clipDepth = null;
    }
  }

  private setClipY(v: BView, y: number) {
    if (!v.clipMats) return;
    for (const m of v.clipMats.values()) (m.userData.uClip as { value: number }).value = y;
    if (v.clipDepth) (v.clipDepth.userData.uClip as { value: number }).value = y;
  }

  private makeScaffold(b: Building, v: BView) {
    const g = new THREE.Group();
    const s = b.size * 0.5 + 0.05;
    const h = Math.min(v.height * 0.9, 2.6);
    const pole = new THREE.CylinderGeometry(0.025, 0.025, h, 5);
    pole.translate(0, h / 2, 0);
    const pts: [number, number][] = [];
    const n = b.size + 1;
    for (let i = 0; i < n; i++) {
      const t = -s + (i / (n - 1)) * s * 2;
      pts.push([t, s], [t, -s]);
      if (i > 0 && i < n - 1) pts.push([s, t], [-s, t]);
    }
    for (const [x, z] of pts) {
      const m = new THREE.Mesh(pole, this.scaffoldMat);
      m.position.set(x, 0, z);
      m.castShadow = true;
      g.add(m);
    }
    const levels = Math.max(1, Math.floor(h / 0.7));
    for (let l = 1; l <= levels; l++) {
      const y = (l / (levels + 0.3)) * h;
      for (const [len, x, z, ry] of [[s * 2, 0, s, 0], [s * 2, 0, -s, 0], [s * 2, s, 0, Math.PI / 2], [s * 2, -s, 0, Math.PI / 2]] as number[][]) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.12), getMaterial('planks'));
        plank.position.set(x, y, z);
        plank.rotation.y = ry;
        plank.castShadow = true;
        g.add(plank);
      }
    }
    v.group.add(g);
    return g;
  }

  private makeStakes(b: Building, v: BView) {
    const g = new THREE.Group();
    const s = b.size * 0.5;
    const stake = new THREE.CylinderGeometry(0.02, 0.03, 0.4, 5);
    stake.translate(0, 0.2, 0);
    const corners: [number, number][] = [[-s, -s], [s, -s], [s, s], [-s, s]];
    for (const [x, z] of corners) {
      const m = new THREE.Mesh(stake, this.scaffoldMat);
      m.position.set(x, 0, z);
      m.castShadow = true;
      g.add(m);
    }
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const rope = new THREE.Mesh(new THREE.BoxGeometry(len, 0.01, 0.01), this.ropeMat);
      rope.position.set((ax + bx) / 2, 0.33, (az + bz) / 2);
      rope.rotation.y = -Math.atan2(bz - az, bx - ax);
      g.add(rope);
    }
    v.group.add(g);
    return g;
  }

  update(dt: number, time: number) {
    const g = this.game;
    // remove stale
    for (const v of [...this.views.values()]) {
      const b = g.buildings.get(v.id);
      if (!b || b.owner !== v.owner) this.dispose(v);
    }
    for (const b of g.buildings.values()) {
      let v = this.views.get(b.id);
      if (!v) v = this.create(b);
      const w = g.world;
      if (!w.explored[w.idx(Math.round(b.cx), Math.round(b.cz))]) { v.group.visible = false; continue; }
      v.group.visible = true;
      // keep base height synced with levelled terrain
      const y = b.def.mine ? v.baseY : b.targetH;
      v.group.position.y = y;
      const site = b.state === 'leveling' || b.state === 'building';
      if (site) {
        this.setClip(v, true);
        const progress = b.state === 'leveling' ? 0 : b.buildWork / Math.max(1, b.buildTotal);
        // smooth progress between build steps
        v.shownProgress += (progress - v.shownProgress) * (1 - Math.exp(-dt * 2));
        const clipY = y - 0.3 + (v.height + 0.35) * Math.max(0.0, v.shownProgress);
        this.setClipY(v, clipY);
        if (b.state === 'leveling') {
          if (!v.stakes) v.stakes = this.makeStakes(b, v);
          if (v.scaffold) v.scaffold.visible = false;
        } else {
          if (v.stakes) { v.group.remove(v.stakes); v.stakes = null; }
          if (!v.scaffold) v.scaffold = this.makeScaffold(b, v);
          v.scaffold.visible = true;
        }
        // delivered materials pile
        const rem = { board: b.delivered.board - Math.min(b.used, b.delivered.board), stone: 0 };
        const usedStone = Math.max(0, b.used - b.delivered.board);
        rem.stone = Math.max(0, b.delivered.stone - usedStone);
        const px = b.cx + b.size * 0.5 + 0.35, pz = b.cz + b.size * 0.5 + 0.1;
        const py = w.heightAt(px, pz);
        this.piles.pile('board', Math.min(12, rem.board), px, py, pz, Math.PI / 2);
        const sx = b.cx - b.size * 0.5 - 0.3, sz = b.cz + b.size * 0.5 + 0.1;
        this.piles.pile('stone', Math.min(12, rem.stone), sx, w.heightAt(sx, sz), sz);
      } else {
        if (v.clipMats) this.setClip(v, false);
        if (v.scaffold) { v.group.remove(v.scaffold); v.scaffold = null; }
        if (v.stakes) { v.group.remove(v.stakes); v.stakes = null; }
      }
      // burning: sink and char
      if (b.state === 'burning') {
        v.burnT += dt;
        const k = Math.min(1, b.burnT / 12);
        v.group.position.y = y - k * k * v.height * 0.8;
        v.group.rotation.z = Math.sin(time * 3) * 0.01 * k;
        continue;
      }
      // animated parts
      const working = b.working || (b.state === 'done' && b.type === 'mill' && b.worker !== 0);
      for (const m of v.movers) {
        const axis = m.userData.axis;
        if (m.name === 'blades') m.rotation.z += dt * (b.working ? 1.6 : 0.25);
        else if (m.name === 'saw') { if (b.working) m.rotation.x += dt * 18; }
        else if (m.name === 'winch') { if (b.worker && time % 6 < 2) m.rotation.x += dt * 4; }
        else if (m.name === 'pigs') { m.position.y = Math.abs(Math.sin(time * 2 + b.id)) * 0.01; m.visible = b.stock.pig > 0 || b.working; }
        else if (m.name === 'crane') {
          // swings to and fro while a ship is loaded or unloaded here
          let busy = false;
          for (const sh of g.ships.values()) if (sh.at === b.id && (sh.state === 'loading' || sh.state === 'unloading')) { busy = true; break; }
          const target = busy ? Math.sin(time * 0.7 + b.id) * 1.1 - 0.4 : -0.2;
          m.rotation.y += (target - m.rotation.y) * Math.min(1, dt * 1.5);
        }
        void axis; void working;
      }
      if (v.sea) showHullProgress(v.sea, b.shipProgress, b.state === 'done' && b.worker !== 0);
      // output / storage piles
      if (b.state === 'done') {
        const anchor = v.anchors.piles[0];
        if (b.def.storage) {
          // show a few representative piles in front of storage
          let k = 0;
          const shown: Good[] = ['board', 'stone', 'log', 'grain', 'coal', 'iron'];
          for (const gd of shown) {
            const n = Math.min(8, b.stock[gd]);
            if (!n) continue;
            const px = b.cx - b.size * 0.5 - 0.35 + (k % 2) * 0.0, pz = b.cz - b.size * 0.3 + k * 0.42;
            if (k >= 5) break;
            this.piles.pile(gd, Math.min(6, n), px, w.heightAt(px, pz), pz, Math.PI / 2);
            k++;
          }
        } else if (anchor) {
          let k = 0;
          for (const gd of GOODS) {
            const n = b.stock[gd];
            if (!n) continue;
            const isOut = b.def.outputs?.includes(gd);
            const off = isOut ? 0 : 1;
            const px = b.cx + anchor.x - off * 0.35 * (anchor.x > 0 ? 1 : -1) - k * 0.05;
            const pz = b.cz + anchor.z - k * 0.3;
            this.piles.pile(gd, Math.min(8, n), px, w.heightAt(px, pz), pz, Math.PI / 2 * (k % 2));
            k++;
            if (k > 3) break;
          }
        }
      }
    }
  }

  /** World-space anchor positions of lit windows / fires for night lights. */
  lightSources(out: THREE.Vector4[], camX: number, camZ: number, maxDist: number, night: number): number {
    const cands: { d: number; x: number; y: number; z: number; w: number }[] = [];
    const g = this.game;
    for (const v of this.views.values()) {
      const b = g.buildings.get(v.id);
      if (!b || b.state !== 'done' || !v.group.visible) continue;
      const dx = b.cx - camX, dz = b.cz - camZ;
      const d = Math.hypot(dx, dz);
      if (d > maxDist) continue;
      const inhabited = b.worker || b.def.military || b.def.residence || b.def.storage;
      if (!inhabited && !b.working) continue;
      for (const a of v.anchors.fires) cands.push({ d, x: b.cx + a.x, y: v.group.position.y + a.y, z: b.cz + a.z, w: b.working ? 1.6 : 0.8 });
      const wins = v.anchors.windows;
      if (wins.length && night > 0.05) {
        // one light per building for windows (at the front)
        let sx = 0, sy = 0, sz = 0;
        for (const a of wins) { sx += a.x; sy += a.y; sz += a.z; }
        sx /= wins.length; sy /= wins.length; sz /= wins.length;
        cands.push({ d, x: b.cx + sx, y: v.group.position.y + sy, z: b.cz + sz + 0.4, w: 0.9 + Math.min(0.8, wins.length * 0.1) });
      }
      if (b.state === 'done' && b.def.military) {
        for (const a of v.anchors.flags.slice(0, 1)) cands.push({ d, x: b.cx + a.x, y: v.group.position.y + a.y - 0.4, z: b.cz + a.z + 0.3, w: 1.2 });
      }
    }
    for (const b of g.buildings.values()) {
      if (b.state !== 'burning') continue;
      cands.push({ d: 0, x: b.cx, y: b.targetH + 1, z: b.cz, w: 4 });
    }
    cands.sort((a, b) => a.d - b.d);
    const n = Math.min(out.length, cands.length);
    for (let i = 0; i < n; i++) out[i].set(cands[i].x, cands[i].y, cands[i].z, cands[i].w);
    return n;
  }
}
