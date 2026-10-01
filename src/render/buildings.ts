// Building meshes: construction reveal, scaffolding, animated parts, goods piles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GOODS, Good } from '../game/defs';
import type { Game } from '../game/game';
import type { Building } from '../game/types';
import { buildingBuilder } from './buildingModels';
import type { Anchors } from './geom';
import { getClipMaterial, getMaterial } from './materials';
import type { PilesRenderer } from './entities';
import { lampReach, patchedDepthMaterial } from './shaderPatch';
import { Seaworks, buildSeaworks, showHullProgress } from './seaworks';
import { lanternLit, lanternSpot } from './lanterns';
import { hash2 } from '../core/rng';
import { burnPose, collapseAt } from './demolition';
import { getBurnMaterial } from './materials';
import { ScreenLod } from './lod';
import { BuildingBatches, type Batched } from './buildingBatches';
import type { WorkView } from './work';

/** charred wood and soot, and the ember glow that shows through a burning wall */
const CHAR = new THREE.Color(0.09, 0.075, 0.065);
const EMBER = new THREE.Color(1.0, 0.3, 0.05);

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
  /** per-building material copies while it burns: animated char and glow */
  burnMats: Map<string, { m: THREE.MeshStandardMaterial; base: THREE.Color }> | null;
  sea: Seaworks | null;
  /** near and far models, when the design has a far one */
  lod: ScreenLod | null;
  /** how far past its footprint the nearest water is (Infinity: none close by), for the reflection */
  waterGap: number;
  /** its pieces in the batches, while it stands finished */
  batched: Batched | null;
}

/** Water further than this from a building never needs checking: the reflection reach is capped here. */
const WATER_SCAN = 24;

/**
 * A building's model stands still but for its named moving parts: every other piece gets its matrix
 * composed once and is left out of the per-frame recomposing (a 30-minute town holds some 4,000
 * pieces, which three would otherwise recompose and multiply out every frame). The root's matrix is
 * kept by the renderer, which calls `updateMatrix` whenever it moves the building; a moving part
 * still recomposes itself, and what hangs from it follows.
 */
/** One mesh of several pieces of a site's rig, merged (each piece already placed). */
function rigMesh(parts: THREE.BufferGeometry[], mat: THREE.Material, matKey: string, shadow: boolean) {
  const m = new THREE.Mesh(mergeGeometries(parts)!, mat);
  for (const p of parts) p.dispose();
  m.userData.matKey = matKey;
  m.castShadow = shadow;
  return m;
}

function freeze(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o !== root && o.name) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
}

export class BuildingsRenderer {
  group = new THREE.Group();
  views = new Map<number, BView>();
  /** finished buildings, three draws a pass (buildingBatches.ts); the renderer adds its group to the scene */
  readonly batches = new BuildingBatches();
  /** off: every building draws its own meshes (for comparisons); takes effect as buildings update */
  batching = true;

  /** Batch every finished building again, in families or a batch per material (for comparisons). */
  setFamilies(on: boolean) {
    this.batches.families = on;
    for (const v of this.views.values()) if (v.batched) { this.batches.remove(v.batched); v.batched = this.batches.add(v.group, v.lod); }
  }
  private scaffoldMat: THREE.Material;
  private ropeMat: THREE.Material;

  private shown: boolean[] = [];
  /** Run fn (the shadow map) with every building on `level` (1 far, 2 coarse), then put back the levels the view picked. */
  withFar(fn: () => void, level = 1) {
    const shown = this.shown;
    shown.length = 0;
    for (const v of this.views.values()) if (v.lod) { for (const l of v.lod.levels) shown.push(l.object.visible); v.lod.showLevel(level); }
    try { fn(); } finally {
      let k = 0;
      for (const v of this.views.values()) if (v.lod) for (const l of v.lod.levels) l.object.visible = shown[k++];
    }
  }

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
    freeze(group);
    const v: BView = {
      id: b.id, type: b.type, owner: b.owner, group, anchors, height: Math.max(0.8, box.max.y - y),
      state: '', clipMats: null, clipDepth: null, scaffold: null, stakes: null, baseY: y, movers, shownProgress: 0, burnMats: null, sea,
      lod: (group.children.find((o) => o instanceof ScreenLod) as ScreenLod | undefined) ?? null,
      waterGap: this.waterGap(b, box),
      batched: null,
    };
    this.views.set(b.id, v);
    return v;
  }

  /** Distance from the edge of the building (its model's box, jetty included) to the nearest water or the map's edge. */
  private waterGap(b: Building, box: THREE.Box3): number {
    const w = this.game.world;
    const r = Math.max(box.max.x - b.cx, b.cx - box.min.x, box.max.z - b.cz, b.cz - box.min.z, 0.5);
    const R = Math.ceil(r + WATER_SCAN);
    const x0 = Math.round(b.cx), z0 = Math.round(b.cz);
    let best = Infinity;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const x = x0 + dx, z = z0 + dz;
        const d = Math.hypot(x - b.cx, z - b.cz);
        if (d >= best) continue;
        if (!w.inBounds(x, z) || w.isWater(w.idx(x, z))) best = d;
      }
    return Math.max(0, best - r - 1);
  }

  /**
   * Buildings that can't show in the water: further from it than their height times `reach`
   * (see reflectionReach). Adds their groups to `out`, for the reflection to leave out.
   */
  dry(out: THREE.Object3D[], reach: number) {
    if (!Number.isFinite(reach)) return;
    for (const v of this.views.values()) {
      if (!v.group.visible) continue;
      if (v.waterGap > Math.min(WATER_SCAN, v.height * reach)) out.push(v.group);
    }
  }

  private dispose(v: BView) {
    if (v.batched) this.batches.remove(v.batched);
    this.removeSitePart(v, 'scaffold');
    this.removeSitePart(v, 'stakes');
    this.group.remove(v.group);
    v.sea?.group.traverse((o) => { if (o.parent?.userData.own) (o as THREE.Mesh).geometry?.dispose(); });
    if (v.clipMats) for (const m of v.clipMats.values()) m.dispose();
    v.clipDepth?.dispose();
    if (v.burnMats) for (const bm of v.burnMats.values()) bm.m.dispose();
    this.views.delete(v.id);
  }

  /** Site geometry belongs to this building; its materials belong to the shared library. */
  private removeSitePart(v: BView, key: 'scaffold' | 'stakes') {
    const part = v[key];
    if (!part) return;
    v.group.remove(part);
    const geometries = new Set<THREE.BufferGeometry>();
    part.traverse((o) => {
      if (o instanceof THREE.Mesh) geometries.add(o.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    v[key] = null;
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
        m.customDepthMaterial = m.material.userData.depth;
      });
      for (const m of v.clipMats.values()) m.dispose();
      v.clipDepth?.dispose();
      v.clipMats = null;
      v.clipDepth = null;
    }
  }

  /** Swap in material copies that can char and glow without touching the shared library. */
  private setBurn(v: BView) {
    const mats = (v.burnMats = new Map<string, { m: THREE.MeshStandardMaterial; base: THREE.Color }>());
    v.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const key = m.userData.matKey as string | undefined;
      if (!key) return;
      let bm = mats.get(key);
      if (!bm) {
        const mat = getBurnMaterial(key);
        bm = { m: mat, base: mat.color.clone() };
        mats.set(key, bm);
      }
      m.material = bm.m;
    });
    return mats;
  }

  private setClipY(v: BView, y: number) {
    if (!v.clipMats) return;
    for (const m of v.clipMats.values()) (m.userData.uClip as { value: number }).value = y;
    if (v.clipDepth) (v.clipDepth.userData.uClip as { value: number }).value = y;
  }

  /**
   * The scaffolding round a site: poles and planks, each merged into one mesh (a site is two draws
   * a pass, not twenty); its geometry is its own and goes with it (removeSitePart).
   */
  private makeScaffold(b: Building, v: BView) {
    const g = new THREE.Group();
    const s = b.size * 0.5 + 0.05;
    const h = Math.min(v.height * 0.9, 2.6);
    const pts: [number, number][] = [];
    const n = b.size + 1;
    for (let i = 0; i < n; i++) {
      const t = -s + (i / (n - 1)) * s * 2;
      pts.push([t, s], [t, -s]);
      if (i > 0 && i < n - 1) pts.push([s, t], [-s, t]);
    }
    const poles = pts.map(([x, z]) => new THREE.CylinderGeometry(0.025, 0.025, h, 5).translate(x, h / 2, z));
    const planks: THREE.BufferGeometry[] = [];
    const levels = Math.max(1, Math.floor(h / 0.7));
    for (let l = 1; l <= levels; l++) {
      const y = (l / (levels + 0.3)) * h;
      for (const [len, x, z, ry] of [[s * 2, 0, s, 0], [s * 2, 0, -s, 0], [s * 2, s, 0, Math.PI / 2], [s * 2, -s, 0, Math.PI / 2]] as number[][]) {
        planks.push(new THREE.BoxGeometry(len, 0.03, 0.12).rotateY(ry).translate(x, y, z));
      }
    }
    g.add(rigMesh(poles, this.scaffoldMat, 'timber', true), rigMesh(planks, getMaterial('planks'), 'planks', true));
    v.group.add(g);
    freeze(g);
    return g;
  }

  /** The stakes and rope round ground being levelled (one mesh each, like the scaffolding). */
  private makeStakes(b: Building, v: BView) {
    const g = new THREE.Group();
    const s = b.size * 0.5;
    const corners: [number, number][] = [[-s, -s], [s, -s], [s, s], [-s, s]];
    const stakes = corners.map(([x, z]) => new THREE.CylinderGeometry(0.02, 0.03, 0.4, 5).translate(x, 0.2, z));
    const ropes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      ropes.push(new THREE.BoxGeometry(len, 0.01, 0.01).rotateY(-Math.atan2(bz - az, bx - ax)).translate((ax + bx) / 2, 0.33, (az + bz) / 2));
    }
    g.add(rigMesh(stakes, this.scaffoldMat, 'timber', true), rigMesh(ropes, this.ropeMat, 'canvas', false));
    v.group.add(g);
    freeze(g);
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
      if (v.group.position.y !== y) { v.group.position.y = y; v.group.updateMatrix(); }
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
          this.removeSitePart(v, 'stakes');
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
        this.removeSitePart(v, 'scaffold');
        this.removeSitePart(v, 'stakes');
      }
      // a finished building is drawn in the batches; burning, it takes its own meshes back to char them
      const batch = this.batching && b.state === 'done';
      if (batch && !v.batched) v.batched = this.batches.add(v.group, v.lod);
      else if (!batch && v.batched) { this.batches.remove(v.batched); v.batched = null; }
      else if (v.batched) this.batches.move(v.group, v.batched);
      // burning: the walls char and glow from within, the frame trembles, then the roof comes down,
      // the walls crumple outwards and the wreck settles into the ground (timeline in demolition.ts)
      if (b.state === 'burning') {
        const mats = v.burnMats ?? this.setBurn(v);
        const p = burnPose(b.burnT, collapseAt(b.id));
        const dir = hash2(b.id, 5) * Math.PI * 2;
        const tremor = p.shudder * 0.02;
        const tilt = p.drop * (0.12 + hash2(b.id, 6) * 0.1) + Math.sin(time * 41 + b.id) * tremor * 0.5;
        v.group.rotation.set(Math.cos(dir) * tilt, 0, Math.sin(dir) * tilt);
        v.group.scale.set(1 + 0.1 * p.drop, 1 - 0.55 * p.drop, 1 + 0.1 * p.drop);
        v.group.position.set(b.cx + Math.sin(time * 53 + b.id) * tremor, y - (p.drop * 0.2 + p.sink * 0.6) * v.height, b.cz + Math.cos(time * 47 + b.id * 1.7) * tremor);
        v.group.updateMatrix();
        const flick = 0.55 + 0.45 * Math.sin(time * 17 + b.id) * Math.sin(time * 6.3 + b.id * 0.7);
        for (const [key, bm] of mats) {
          bm.m.color.copy(bm.base).lerp(CHAR, p.char * 0.92);
          if (key.startsWith('glow')) continue;
          bm.m.emissive.copy(EMBER);
          bm.m.emissiveIntensity = p.glow * (key === 'window' ? 4.5 : 0.2) * flick;
        }
        continue;
      }
      // animated parts
      const working = b.working || (b.state === 'done' && b.type === 'mill' && b.worker !== 0);
      for (const m of v.movers) {
        const axis = m.userData.axis;
        if (m.name === 'blades') m.rotation.z += dt * (b.working ? 1.6 : 0.25);
        else if (m.name === 'saw') { if (b.working) m.rotation.x += dt * 18; }
        else if (m.name === 'winch') { if (b.worker && time % 6 < 2) m.rotation.x += dt * 4; }
        else if (m.name.startsWith('cat') || m.name === 'arm0') {
          // the catapult taking shape in the siege workshop: one part per cycle
          const parts = Math.round(b.shipProgress * 4);
          m.visible = m.name === 'arm0' ? parts < 3 : parts >= Number(m.name[3]);
        }
        else if (m.name === 'donkeys') { m.rotation.y = Math.sin(time * 0.6 + b.id) * 0.04; m.visible = b.working || b.prodCount > 0; }
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
            if (!n || gd === 'pig') continue; // pigs stand about on their own feet (pigs.ts)
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

  /** What the work director needs of a finished building: its height, anchors and moving parts. */
  workView(id: number): WorkView | null {
    const v = this.views.get(id);
    if (!v) return null;
    this.wv.y = v.group.position.y;
    this.wv.anchors = v.anchors;
    this.wv.movers = v.movers;
    this.wv.visible = v.group.visible && !v.clipMats;
    return this.wv;
  }
  private wv: WorkView = { y: 0, anchors: null!, movers: [], visible: false };

  /**
   * World-space anchor positions of lit windows / fires for night lights, nearest the view's target
   * first. With `view`, a lamp whose light cannot reach anything inside it is left out, so it takes
   * none of the shader's few slots and none of every lit pixel's time.
   */
  lightSources(out: THREE.Vector4[], camX: number, camZ: number, maxDist: number, night: number, view: THREE.Frustum | null = null): number {
    const g = this.game;
    const spot = this.lampSpot;
    this.lampView = view;
    this.nLamps = 0;
    for (const v of this.views.values()) {
      const b = g.buildings.get(v.id);
      if (!b || b.state !== 'done' || !v.group.visible) continue;
      const dx = b.cx - camX, dz = b.cz - camZ;
      const d = Math.hypot(dx, dz);
      if (d > maxDist) continue;
      const inhabited = b.worker || b.def.military || b.def.residence || b.def.storage;
      if (!inhabited && !b.working) continue;
      for (const a of v.anchors.fires) this.lamp(d, b.cx + a.x, v.group.position.y + a.y, b.cz + a.z, b.working ? 1.6 : 0.8);
      const wins = v.anchors.windows;
      if (night > 0.05 && lanternLit(b) && lanternSpot(g, b, spot)) {
        // the door lantern lights the path, the facade and its windows
        this.lamp(d, spot.x, spot.y, spot.z, 1.25);
      } else if (wins.length && night > 0.05) {
        // one light per building for windows (at the front)
        let sx = 0, sy = 0, sz = 0;
        for (const a of wins) { sx += a.x; sy += a.y; sz += a.z; }
        sx /= wins.length; sy /= wins.length; sz /= wins.length;
        this.lamp(d, b.cx + sx, v.group.position.y + sy, b.cz + sz + 0.4, 0.9 + Math.min(0.8, wins.length * 0.1));
      }
      if (b.state === 'done' && b.def.military && v.anchors.flags.length) {
        const a = v.anchors.flags[0];
        this.lamp(d, b.cx + a.x, v.group.position.y + a.y - 0.4, b.cz + a.z + 0.3, 1.2);
      }
    }
    for (const b of g.buildings.values()) {
      if (b.state !== 'burning') continue;
      // firelight: brightest at the height of the blaze, lower and dimmer once the roof is down
      const p = burnPose(b.burnT, collapseAt(b.id));
      const h = this.views.get(b.id)?.height ?? 1.5;
      const flick = 0.85 + 0.15 * Math.sin(b.burnT * 23 + b.id);
      this.lamp(0, b.cx, b.targetH + 0.6 + h * 0.4 * (1 - p.drop), b.cz, (1 + 4.5 * p.fire) * flick);
    }
    const sorted = this.lampOrder;
    sorted.length = 0;
    for (let i = 0; i < this.nLamps; i++) sorted.push(this.lamps[i]);
    sorted.sort((a, b) => a.d - b.d);
    const n = Math.min(out.length, sorted.length);
    for (let i = 0; i < n; i++) out[i].set(sorted[i].x, sorted[i].y, sorted[i].z, sorted[i].w);
    return n;
  }
  /** the night lights' candidates this frame (reused records: lamps[0 .. nLamps)) and their order */
  private lamps: Lamp[] = [];
  private nLamps = 0;
  private lampOrder: Lamp[] = [];
  private lampView: THREE.Frustum | null = null;
  private lampSpot = new THREE.Vector3();
  private lamp(d: number, x: number, y: number, z: number, w: number) {
    if (this.lampView) {
      lampSphere.center.set(x, y, z);
      lampSphere.radius = lampReach(w);
      if (!this.lampView.intersectsSphere(lampSphere)) return;
    }
    const l = this.lamps[this.nLamps] ?? (this.lamps[this.nLamps] = { d: 0, x: 0, y: 0, z: 0, w: 0 });
    l.d = d; l.x = x; l.y = y; l.z = z; l.w = w;
    this.nLamps++;
  }
}

interface Lamp { d: number; x: number; y: number; z: number; w: number }
const lampSphere = new THREE.Sphere();
