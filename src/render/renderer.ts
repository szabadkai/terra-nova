// Main renderer: owns the three.js scene and all visual subsystems.
import * as THREE from 'three';
import { BUILDINGS, BuildingType } from '../game/defs';
import type { Game } from '../game/game';
import type { Building, GameEvent, Settler } from '../game/types';
import { WATER_LEVEL } from '../game/world';
import { hash2 } from '../core/rng';
import { RTSCamera } from './camera';
import { Sky } from './sky';
import { TerrainRenderer } from './terrain';
import { WaterRenderer } from './water';
import { AnimalsRenderer, FieldsRenderer, GrassRenderer, PilesRenderer, ProjectilesRenderer, StonesRenderer, TreesRenderer, buildGoodGeos } from './entities';
import { SettlersRenderer } from './settlers';
import { BuildingsRenderer } from './buildings';
import { Particles } from './particles';
import { PostFX } from './postfx';
import { G, MAX_LIGHTS, patchMaterial } from './shaderPatch';
import { buildingBuilder } from './buildingModels';
import { setWindowGlow } from './materials';
import { PlanarReflection } from './reflection';
import { BordersRenderer } from './borders';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface RenderSettings {
  quality: Quality;
  bloom: boolean;
  dof: boolean;
  grass: boolean;
  ao: boolean;
  grade: boolean;
  dayCycle: boolean;
  weather: 'auto' | 'clear' | 'rain' | 'snow';
  borders: boolean;
  reflections: boolean;
}

class Birds {
  mesh: THREE.InstancedMesh;
  birds: { x: number; y: number; z: number; vx: number; vz: number; ph: number; flock: number }[] = [];
  flocks: { x: number; z: number; tx: number; tz: number }[] = [];
  constructor(private W: number, private H: number) {
    const geo = new THREE.BufferGeometry();
    // simple V bird: body + two wings (wing verts tagged by x for vertex flap)
    const v = [
      0, 0, 0.12, -0.26, 0.0, -0.04, 0, 0, -0.06,
      0, 0, 0.12, 0, 0, -0.06, 0.26, 0.0, -0.04,
    ];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9, side: THREE.DoubleSide });
    patchMaterial(mat, {
      key: 'bird', fog: true,
      vertexBegin: `
        #ifdef USE_INSTANCING
        float ph = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 1.3;
        #else
        float ph = 0.0;
        #endif
        transformed.y += abs(transformed.x) * sin(uTime * 11.0 + ph) * 0.9;
      `,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, 120);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let f = 0; f < 4; f++) {
      const x = Math.random() * W, z = Math.random() * H;
      this.flocks.push({ x, z, tx: Math.random() * W, tz: Math.random() * H });
      const n = 8 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) this.birds.push({ x: x + Math.random() * 4, y: 9 + Math.random() * 3, z: z + Math.random() * 4, vx: 0, vz: 0, ph: Math.random() * 6, flock: f });
    }
  }
  update(dt: number, night: number) {
    for (const f of this.flocks) {
      const dx = f.tx - f.x, dz = f.tz - f.z;
      const d = Math.hypot(dx, dz);
      if (d < 5) { f.tx = Math.random() * this.W; f.tz = Math.random() * this.H; }
      f.x += (dx / d) * dt * 3.2;
      f.z += (dz / d) * dt * 3.2;
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let n = 0;
    for (const b of this.birds) {
      const f = this.flocks[b.flock];
      const ox = Math.sin(b.ph + performance.now() * 0.0003) * 2.5, oz = Math.cos(b.ph * 1.3 + performance.now() * 0.00025) * 2.5;
      const ax = (f.x + ox - b.x) * 1.5 - b.vx, az = (f.z + oz - b.z) * 1.5 - b.vz;
      b.vx += ax * dt; b.vz += az * dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(b.vx, b.vz));
      m.compose(p.set(b.x, b.y + Math.sin(b.ph + b.x * 0.3) * 0.3, b.z), q, s);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = night > 0.6 ? 0 : n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  cam: RTSCamera;
  sky: Sky;
  terrain: TerrainRenderer;
  water: WaterRenderer;
  trees: TreesRenderer;
  stones: StonesRenderer;
  fields: FieldsRenderer;
  grass: GrassRenderer;
  settlers: SettlersRenderer;
  animals: AnimalsRenderer;
  arrows: ProjectilesRenderer;
  piles: PilesRenderer;
  buildings: BuildingsRenderer;
  particles: Particles;
  fx: PostFX;
  birds: Birds;
  time = 0;
  settings: RenderSettings = {
    quality: 'high', bloom: true, dof: true, grass: true, ao: false, grade: true, dayCycle: true, weather: 'auto', borders: true, reflections: true,
  };
  reflection: PlanarReflection;
  borders: BordersRenderer;
  // interaction state
  placing: BuildingType | null = null;
  hoverNode = -1;
  hoverPoint: THREE.Vector3 | null = null;
  selected: { kind: 'building' | 'settler'; id: number } | null = null;
  private ghost: THREE.Group | null = null;
  private ghostType: BuildingType | null = null;
  private ghostMat: THREE.MeshStandardMaterial;
  private markers: THREE.InstancedMesh;
  private markerT = 0;
  private emitT = 0;
  private weatherT = 60;
  private rainAmount = 0;
  private targetRain = 0;
  private precip: 'rain' | 'snow' = 'rain';
  onEvent: ((e: GameEvent) => void) | null = null;
  private sound: ((name: string, x?: number, z?: number, vol?: number) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private game: Game) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(w, h, false);

    this.cam = new RTSCamera(game.world, w / h);
    this.cam.attach(canvas);
    this.scene.background = new THREE.Color(0x0b2a44);
    this.scene.fog = new THREE.Fog(0x9fb8d0, 80, 260);

    this.sky = new Sky(r, this.scene);
    this.terrain = new TerrainRenderer(game);
    this.scene.add(this.terrain.mesh);
    this.water = new WaterRenderer(game.world.W, game.world.H, this.terrain.heightTex);
    this.scene.add(this.water.mesh);
    const goodGeos = buildGoodGeos();
    this.trees = new TreesRenderer(game);
    this.scene.add(this.trees.group);
    this.stones = new StonesRenderer(game);
    this.scene.add(this.stones.group);
    this.fields = new FieldsRenderer(game);
    this.scene.add(this.fields.mesh);
    this.grass = new GrassRenderer(game);
    this.scene.add(this.grass.mesh);
    this.settlers = new SettlersRenderer(game, goodGeos);
    this.scene.add(this.settlers.group);
    this.animals = new AnimalsRenderer(game);
    this.scene.add(this.animals.group);
    this.arrows = new ProjectilesRenderer(game);
    this.scene.add(this.arrows.mesh);
    this.piles = new PilesRenderer(goodGeos);
    this.scene.add(this.piles.group);
    this.buildings = new BuildingsRenderer(game, this.piles);
    this.scene.add(this.buildings.group);
    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.birds = new Birds(game.world.W, game.world.H);
    this.scene.add(this.birds.mesh);
    this.borders = new BordersRenderer(game);
    this.scene.add(this.borders.posts, this.borders.caps);

    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0x66ff88, transparent: true, opacity: 0.55, emissive: new THREE.Color(0x114422), roughness: 0.6, depthWrite: false });
    const mg = new THREE.CylinderGeometry(0.13, 0.17, 0.05, 8);
    const mm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: true });
    this.markers = new THREE.InstancedMesh(mg, mm, 4000);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);

    this.fx = new PostFX(r, this.scene, this.cam.camera, w, h);
    this.reflection = new PlanarReflection(WATER_LEVEL, w / 2, h / 2);
    this.water.uniforms.tReflect.value = this.reflection.rt.texture;
    const hq = game.buildings.get(game.players[game.local].hq);
    if (hq) {
      this.cam.jumpTo(hq.cx, hq.cz + 4, true);
      this.cam.zoomTo(30, true);
    }
    this.applyQuality();
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => this.resize();

  /** Release GPU resources and listeners so a new world can be created on a fresh canvas. */
  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.cam.detach();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.fx.composer.dispose();
    this.reflection.rt.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  setSound(fn: (name: string, x?: number, z?: number, vol?: number) => void) {
    this.sound = fn;
  }

  applyQuality() {
    const s = this.settings;
    const dpr = window.devicePixelRatio;
    const pr = s.quality === 'low' ? 1 : s.quality === 'medium' ? Math.min(dpr, 1.25) : s.quality === 'high' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(pr);
    const sm = s.quality === 'low' ? 1024 : s.quality === 'medium' ? 2048 : 4096;
    if (this.sky.sun.shadow.mapSize.x !== sm) {
      this.sky.sun.shadow.mapSize.set(sm, sm);
      this.sky.sun.shadow.map?.dispose();
      this.sky.sun.shadow.map = null as any;
    }
    this.grass.enabled = s.grass && s.quality !== 'low';
    this.fx.settings.bloom = s.bloom;
    this.fx.settings.dof = s.dof;
    this.fx.settings.grade = s.grade;
    this.fx.enableAO(s.ao);
    this.sky.cycle = s.dayCycle;
    this.terrain.uniforms.uBorderOn.value = s.borders ? 1 : 0;
    if (this.borders) { this.borders.posts.visible = s.borders; this.borders.caps.visible = s.borders; }
    this.resize();
  }

  private lastW = 0;
  private lastH = 0;
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.lastW = w;
    this.lastH = h;
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.fx.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.reflection?.setSize((w * pr) / 2, (h * pr) / 2);
    this.particles.setScale((h * pr) / (2 * Math.tan((this.cam.camera.fov * Math.PI) / 360)));
  }

  // ------------------------------------------------------------ picking
  ndc(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 2 - 1, y: -((clientY - r.top) / r.height) * 2 + 1 };
  }

  pickGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const n = this.ndc(clientX, clientY);
    return this.cam.pick(n.x, n.y);
  }

  pickNode(p: THREE.Vector3 | null): number {
    if (!p) return -1;
    const w = this.game.world;
    const x = Math.round(p.x), z = Math.round(p.z);
    if (!w.inBounds(x, z)) return -1;
    return w.idx(x, z);
  }

  pickSettler(clientX: number, clientY: number, maxPx = 24): Settler | null {
    const r = this.canvas.getBoundingClientRect();
    let best: Settler | null = null, bd = maxPx * maxPx;
    const v = new THREE.Vector3();
    for (const it of this.settlers.visibleList) {
      v.set(it.x, it.y + 0.45, it.z).project(this.cam.camera);
      const sx = (v.x * 0.5 + 0.5) * r.width + r.left, sy = (-v.y * 0.5 + 0.5) * r.height + r.top;
      const d = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      if (d < bd) { bd = d; best = it.s; }
    }
    return best;
  }

  pickBuilding(clientX: number, clientY: number): Building | null {
    // raycast building meshes first (tall models), fall back to ground footprint
    const n = this.ndc(clientX, clientY);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(n.x, n.y), this.cam.camera);
    const hits = ray.intersectObjects(this.buildings.group.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.buildingId === undefined) o = o.parent;
      if (o) {
        const b = this.game.buildings.get(o.userData.buildingId);
        if (b) return b;
      }
    }
    const p = this.pickGround(clientX, clientY);
    const node = this.pickNode(p);
    if (node < 0) return null;
    const w = this.game.world;
    const id = w.building[node] || w.reserve[node];
    return id ? this.game.buildings.get(id) ?? null : null;
  }

  // ------------------------------------------------------------ placement ghost + markers
  private ensureGhost(type: BuildingType) {
    if (this.ghostType === type && this.ghost) return;
    if (this.ghost) this.scene.remove(this.ghost);
    const mb = buildingBuilder(type, this.game.local);
    this.ghost = mb.build(() => this.ghostMat);
    this.ghost.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
    this.ghostType = type;
    this.scene.add(this.ghost);
  }

  private updatePlacement(dt: number) {
    const g = this.game;
    const w = g.world;
    const U = this.terrain.uniforms;
    if (!this.placing) {
      if (this.ghost) this.ghost.visible = false;
      this.markers.count = 0;
      U.uRange.value.w = 0;
      return;
    }
    const type = this.placing;
    const def = BUILDINGS[type];
    this.ensureGhost(type);
    const ghost = this.ghost!;
    if (this.hoverNode >= 0) {
      const hx = w.nx(this.hoverNode), hy = w.ny(this.hoverNode);
      const a = g.anchorFor(type, hx, hy);
      const ok = g.canPlace(type, g.local, a.x, a.y);
      const cx = a.x + (def.size - 1) / 2, cz = a.y + (def.size - 1) / 2;
      let hs = 0;
      for (const i of g.footprint(def.size, a.x, a.y)) hs += w.h[i];
      ghost.position.set(cx, hs / (def.size * def.size), cz);
      ghost.visible = true;
      this.ghostMat.color.set(ok ? 0x70ff90 : 0xff5040);
      this.ghostMat.emissive.set(ok ? 0x184a20 : 0x4a1010);
      const R = def.radius ?? def.military?.radius ?? 0;
      if (R) U.uRange.value.set(cx, 0, cz, R); else U.uRange.value.w = 0;
    } else ghost.visible = false;

    this.markerT -= dt;
    if (this.markerT > 0) return;
    this.markerT = 0.25;
    const t = this.cam.target;
    const R = Math.min(34, this.cam.viewSize * 0.9);
    let n = 0;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    w.forRadius(t.x, t.z, R, (i, x, y) => {
      if (n >= 4000) return;
      if (w.owner[i] !== g.local) return;
      if ((x + y) % 1 !== 0) return;
      const a = g.anchorFor(type, x, y);
      if (!g.canPlace(type, g.local, a.x, a.y)) return;
      const h = w.h[i];
      m.makeTranslation(x, h + 0.04, y);
      this.markers.setMatrixAt(n, m);
      // quality: flatter spots are greener
      let hmin = Infinity, hmax = -Infinity;
      for (const j of g.footprint(def.size, a.x, a.y)) { hmin = Math.min(hmin, w.h[j]); hmax = Math.max(hmax, w.h[j]); }
      const flat = 1 - Math.min(1, (hmax - hmin) / 1.2);
      col.setRGB(0.9 - flat * 0.75, 0.55 + flat * 0.35, 0.08);
      this.markers.setColorAt(n, col);
      n++;
    });
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------ events -> effects
  handleEvents(events: GameEvent[]) {
    const w = this.game.world;
    const cx = this.cam.target.x, cz = this.cam.target.z;
    const near = (x?: number, z?: number) => x === undefined || z === undefined || Math.hypot(x - cx, z - cz) < this.cam.viewSize * 1.4;
    const P = this.particles;
    for (const e of events) {
      const x = e.x ?? 0, z = e.z ?? 0;
      const y = e.x !== undefined ? w.heightAt(x, z) : 0;
      if (this.onEvent) this.onEvent(e);
      if (!near(e.x, e.z)) continue;
      const snd = (n: string, v = 1) => this.sound?.(n, x, z, v);
      switch (e.type) {
        case 'chop': P.chips(x, y, z); snd('chop'); break;
        case 'treefall': P.leaves(x, y, z, 18); setTimeout(() => P.dust(x, y, z, 10, [0.5, 0.45, 0.35]), 1100); snd('treefall'); break;
        case 'stonehit': P.sparks(x, y + 0.3, z, 4); P.dust(x, y + 0.2, z, 3, [0.62, 0.6, 0.58]); snd('pick'); break;
        case 'dig': P.dust(x, y, z, 5); snd('dig', 0.6); break;
        case 'dirt': P.dust(x, y, z, 4); break;
        case 'hammer': snd('hammer', 0.7); P.dust(x, y + 0.3, z, 1, [0.6, 0.55, 0.45]); break;
        case 'buildstep': P.dust(x, y + 0.3, z, 6, [0.62, 0.55, 0.45]); break;
        case 'built': P.sparkle(x, y + 1.2, z, 40); P.dust(x, y, z, 12); snd('built'); break;
        case 'placed': P.dust(x, y, z, 8); snd('place'); break;
        case 'burn': snd('fire'); this.cam.shake = 0.3; break;
        case 'splash': P.splash(x, WATER_LEVEL, z); snd('splash', 0.6); break;
        case 'cast': P.splash(x, WATER_LEVEL, z); break;
        case 'harvest': P.emit({ x, y: y + 0.3, z, vy: 0.6, spread: 1, life: 1.2, size: 0.05, color: [0.95, 0.8, 0.4], gravity: 1.5, count: 10, kind: 1 }); snd('harvest', 0.6); break;
        case 'plant': P.dust(x, y, z, 4, [0.45, 0.35, 0.25]); snd('plant', 0.6); break;
        case 'swing': snd('swing', 0.7); break;
        case 'hit': P.hit(x, y + 0.4, z); snd('hit'); break;
        case 'parry': P.sparks(x, y + 0.45, z, 5); snd('clang', 0.6); break;
        case 'death': P.dust(x, y, z, 8, [0.4, 0.35, 0.3]); snd('death'); break;
        case 'bow': snd('bow', 0.6); break;
        case 'captured': P.sparkle(x, y + 2, z, 70, [0.6, 1.2, 2.0]); snd('fanfare'); this.cam.shake = 0.5; this.fx.flash(0.05); break;
        case 'occupied': P.sparkle(x, y + 2.5, z, 30, [1.6, 1.4, 0.8]); snd('horn'); break;
        case 'spawn': P.sparkle(x, y + 0.5, z, 8, [1.2, 1.4, 1.8]); break;
        case 'soldier': P.sparkle(x, y + 0.6, z, 16, [1.8, 1.2, 0.6]); snd('horn', 0.5); break;
        case 'equip': P.sparkle(x, y + 0.6, z, 6); break;
        case 'produced': if (Math.random() < 0.3) snd('pop', 0.3); break;
        case 'attack': snd('horn'); break;
      }
    }
  }

  private continuousEffects(dt: number) {
    const g = this.game;
    const w = g.world;
    const t = this.cam.target;
    const R = this.cam.viewSize * 1.3;
    this.emitT -= dt;
    const tick = this.emitT <= 0;
    if (tick) this.emitT = 0.12;
    const P = this.particles;
    for (const v of this.buildings.views.values()) {
      const b = g.buildings.get(v.id);
      if (!b || !v.group.visible) continue;
      if (Math.abs(b.cx - t.x) > R || Math.abs(b.cz - t.z) > R) continue;
      const by = v.group.position.y;
      if (b.state === 'burning') {
        const k = 1 - Math.min(1, b.burnT / 12);
        for (let i = 0; i < 3; i++) P.fire(b.cx + (Math.random() - 0.5) * b.size * 0.8, by + Math.random() * v.height * 0.8 * k + 0.2, b.cz + (Math.random() - 0.5) * b.size * 0.8, 1.2);
        if (tick) P.smoke(b.cx, by + v.height * k + 0.5, b.cz, 0.85, 2.2);
        if (Math.random() < 0.2) P.sparks(b.cx, by + 1, b.cz, 3);
        continue;
      }
      if (b.state !== 'done' || !tick) continue;
      const active = b.working || (b.def.residence && b.spawned > 0) || b.type === 'hq' || (b.def.military && b.occupied && Math.random() < 0.3);
      if (active) {
        for (const c of v.anchors.chimneys) {
          if (Math.random() < (b.working ? 0.55 : 0.2)) {
            const heavy = b.type === 'ironsmelter' || b.type === 'goldsmelter';
            P.smoke(b.cx + c.x, by + c.y, b.cz + c.z, heavy ? 0.6 : 0.1, heavy ? 1.4 : 1);
          }
        }
      }
      if (b.working) {
        for (const f of v.anchors.fires) {
          if (Math.random() < 0.35) P.fire(b.cx + f.x, by + f.y, b.cz + f.z, 0.25);
          if ((b.type === 'toolsmith' || b.type === 'weaponsmith') && Math.random() < 0.25) {
            P.sparks(b.cx + 0.6, by + 0.35, b.cz + 0.2, 5);
            this.sound?.('anvil', b.cx, b.cz, 0.5);
          }
        }
        if (b.type === 'sawmill' && Math.random() < 0.4) P.emit({ x: b.cx + 0.97, y: by + 0.4, z: b.cz + 0.15, vy: 0.5, spread: 0.8, life: 0.8, size: 0.04, color: [0.9, 0.78, 0.55], gravity: 2, count: 3, kind: 1 });
        if (b.type === 'sawmill' && Math.random() < 0.07) this.sound?.('saw', b.cx, b.cz, 0.5);
      }
    }
    // fireflies near forests at night & butterflies by day
    const night = G.uNight.value;
    if (tick) {
      for (let k = 0; k < 3; k++) {
        const x = t.x + (Math.random() - 0.5) * R * 1.4, z = t.z + (Math.random() - 0.5) * R * 1.4;
        if (!w.inBounds(Math.round(x), Math.round(z))) continue;
        const i = w.idx(Math.round(x), Math.round(z));
        if (w.isWater(i) || !w.explored[i]) continue;
        if (night > 0.5 && (w.tree[i] || w.terrain[i] === 2 || w.terrain[i] === 1)) P.firefly(x, w.h[i] + 0.3 + Math.random() * 0.8, z);
      }
    }
    // fish jumping out of lakes now and then
    if (tick && Math.random() < 0.06) {
      const x = Math.round(t.x + (Math.random() - 0.5) * R * 1.4), z = Math.round(t.z + (Math.random() - 0.5) * R * 1.2);
      if (w.inBounds(x, z)) {
        const i = w.idx(x, z);
        if (w.isWater(i) && w.fish[i] > 0 && w.h[i] < WATER_LEVEL - 0.5 && w.explored[i]) {
          const dir = Math.random() * Math.PI * 2;
          P.splash(x, WATER_LEVEL, z);
          P.emit({ x, y: WATER_LEVEL + 0.05, z, vx: Math.cos(dir) * 0.9, vz: Math.sin(dir) * 0.9, vy: 2.6, life: 0.62, size: 0.09, color: [0.85, 0.9, 0.95], alpha: 1, gravity: 8.2, drag: 0, kind: 1 });
          const ex = x + Math.cos(dir) * 0.55, ez = z + Math.sin(dir) * 0.55;
          setTimeout(() => P.splash(ex, WATER_LEVEL, ez), 600);
          this.sound?.('splash', x, z, 0.35);
        }
      }
    }
    // snow flakes
    if (this.rainAmount > 0.02 && this.precip === 'snow') {
      const n = Math.floor(this.rainAmount * 30 * dt * 60);
      for (let k = 0; k < n; k++) {
        const x = t.x + (Math.random() - 0.5) * R * 1.6, z = t.z + (Math.random() - 0.5) * R * 1.6;
        P.emit({ x, y: t.y + 6 + Math.random() * 8, z, vx: -0.4 + Math.random() * 0.3, vy: -1.3, vz: (Math.random() - 0.5) * 0.4, spread: 0.5, life: 7, size: 0.06, color: [0.95, 0.97, 1.0], alpha: 0.9, drag: 0.2, kind: 1 });
      }
    }
    // rain
    if (this.rainAmount > 0.02 && this.precip === 'rain') {
      const n = Math.floor(this.rainAmount * 60 * dt * 60);
      for (let k = 0; k < n; k++) {
        const x = t.x + (Math.random() - 0.5) * R * 1.6, z = t.z + (Math.random() - 0.5) * R * 1.6;
        P.rainDrop(x, t.y + 8 + Math.random() * 6, z);
        if (Math.random() < 0.15) {
          const gx = t.x + (Math.random() - 0.5) * R, gz = t.z + (Math.random() - 0.5) * R;
          P.ripple(gx, w.surfaceAt(gx, gz) + 0.02, gz);
        }
      }
    }
  }

  private updateWeather(dt: number) {
    const mode = this.settings.weather;
    if (mode === 'clear') this.targetRain = 0;
    else if (mode === 'rain') { this.targetRain = 1; this.precip = 'rain'; }
    else if (mode === 'snow') { this.targetRain = 1; this.precip = 'snow'; }
    else {
      this.weatherT -= dt;
      if (this.weatherT <= 0) {
        const raining = this.targetRain > 0.5;
        this.targetRain = raining ? 0 : Math.random() < 0.4 ? 1 : 0;
        if (this.targetRain > 0.5 && this.rainAmount < 0.05) this.precip = Math.random() < 0.3 ? 'snow' : 'rain';
        this.weatherT = this.targetRain > 0.5 ? 60 + Math.random() * 70 : 120 + Math.random() * 180;
      }
    }
    // switching precipitation type waits until the current one has faded
    if (this.rainAmount < 0.03 && mode === 'rain') this.precip = 'rain';
    this.rainAmount += (this.targetRain - this.rainAmount) * (1 - Math.exp(-dt * 0.25));
    const snowing = this.precip === 'snow';
    this.sky.weather = this.rainAmount * (snowing ? 0.8 : 1);
    G.uWet.value = snowing ? 0 : Math.min(1, this.rainAmount * 1.3);
    // snow cover builds up while it snows and melts slowly afterwards
    const sn = G.uSnow.value;
    if (snowing && this.rainAmount > 0.3) G.uSnow.value = Math.min(1, sn + dt / 70 * this.rainAmount);
    else G.uSnow.value = Math.max(0, sn - dt / 140);
    G.uWindStrength.value = 1 + this.rainAmount * (snowing ? 0.5 : 1.2);
    const wind = G.uWind.value;
    const a = this.time * 0.01;
    wind.set(Math.cos(a) * 0.9, Math.sin(a) * 0.4 + 0.2);
  }

  get raining() {
    return this.rainAmount;
  }

  // ------------------------------------------------------------ frame
  frame(dt: number, gameDt: number) {
    if (this.canvas.clientWidth !== this.lastW || this.canvas.clientHeight !== this.lastH) this.resize();
    this.time += dt;
    G.uTime.value = this.time;
    const g = this.game;
    this.cam.update(dt);
    this.updateWeather(dt);
    const zoom01 = (this.cam.dist - this.cam.minDist) / (this.cam.maxDist - this.cam.minDist);
    this.sky.update(gameDt, this.cam.target, this.cam.viewSize);
    this.renderer.toneMappingExposure = this.sky.exposure;
    this.terrain.uniforms.uSunI.value = this.sky.sunIntensity / 3;
    (this.water.uniforms.uSkyCol.value as THREE.Color).copy(this.sky.horizon);
    (this.water.uniforms.uSunCol.value as THREE.Color).copy(this.sky.sun.color).multiplyScalar(this.sky.sunIntensity / 3);
    const fogC = this.sky.fogColor;
    (this.scene.fog as THREE.Fog).color.copy(fogC);
    (this.scene.fog as THREE.Fog).near = 60 + this.cam.dist;
    (this.scene.fog as THREE.Fog).far = 200 + this.cam.dist * 2;
    (this.scene.background as THREE.Color).copy(new THREE.Color(0x0e3558).lerp(fogC, 0.3));
    const night = G.uNight.value;
    setWindowGlow(night * 2.2);
    this.particles.setAmbient(new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.35, 0.4, 0.6), night));

    this.terrain.update(dt);
    this.borders.update();
    this.trees.update(this.time);
    this.stones.update();
    this.fields.update();
    this.grass.update(dt);
    this.buildings.update(dt, this.time);
    this.settlers.update(dt, this.time, this.cam.camera);
    this.animals.update(dt, this.time);
    this.arrows.update();
    this.birds.update(dt, night);
    this.updatePlacement(dt);
    this.continuousEffects(dt);
    this.particles.update(dt, G.uWind.value);

    // night lights
    const lights = G.uLights.value;
    const n = this.buildings.lightSources(lights, this.cam.target.x, this.cam.target.z, this.cam.viewSize * 1.5 + 10, night);
    G.uLightCount.value = n;
    void MAX_LIGHTS;

    // selection ring
    const U = this.terrain.uniforms;
    if (this.selected) {
      if (this.selected.kind === 'building') {
        const b = g.buildings.get(this.selected.id);
        if (b) U.uSel.value.set(b.cx, 0, b.cz, b.size * 0.75 + 0.3); else { this.selected = null; U.uSel.value.w = 0; }
      } else {
        const s = g.settlers.get(this.selected.id);
        if (s && !s.hidden) U.uSel.value.set(s.x, 0, s.z, 0.45); else if (!s) { this.selected = null; U.uSel.value.w = 0; } else U.uSel.value.w = 0;
      }
    } else U.uSel.value.w = 0;

    // planar water reflections (only when water is on screen)
    const U2 = this.water.uniforms;
    if (this.settings.reflections && this.waterInView()) {
      this.reflection.render(this.renderer, this.scene, this.cam.camera, [this.water.mesh, this.grass.mesh, this.particles.group, this.markers, this.arrows.mesh]);
      (U2.uReflMat.value as THREE.Matrix4).copy(this.reflection.textureMatrix);
      U2.uReflOn.value = 1;
    } else U2.uReflOn.value = 0;

    this.fx.render(this.time, zoom01, night);
  }

  private waterCheckT = 0;
  private waterVisible = false;
  private waterInView() {
    this.waterCheckT -= 1;
    if (this.waterCheckT > 0) return this.waterVisible;
    this.waterCheckT = 10;
    const w = this.game.world;
    const t = this.cam.target, R = this.cam.viewSize * 1.2;
    let n = 0;
    for (let gy = -6; gy <= 6; gy++)
      for (let gx = -6; gx <= 6; gx++) {
        const x = Math.round(t.x + (gx / 6) * R), z = Math.round(t.z + (gy / 6) * R);
        if (x < 0 || z < 0 || x >= w.W || z >= w.H) { n++; continue; }
        if (w.isWater(w.idx(x, z))) n++;
      }
    this.waterVisible = n > 0;
    return this.waterVisible;
  }
}

void hash2;
