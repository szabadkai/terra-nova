// Main renderer: owns the three.js scene and all visual subsystems.
import * as THREE from 'three';
import { BUILDINGS, BuildingType, PLAYER_COLORS } from '../game/defs';
import type { Game } from '../game/game';
import type { Building, GameEvent, Settler } from '../game/types';
import { WATER_LEVEL } from '../game/world';
import { hash2 } from '../core/rng';
import { RTSCamera } from './camera';
import { Sky } from './sky';
import { fitShadow } from './shadowFit';
import { TerrainRenderer } from './terrain';
import { WaterRenderer } from './water';
import { AnimalsRenderer, FieldsRenderer, GrassRenderer, PilesRenderer, ProjectilesRenderer, StonesRenderer, TreesRenderer, VinesRenderer, buildGoodGeos } from './entities';
import { SettlersRenderer } from './settlers';
import { DonkeysRenderer } from './donkeys';
import { CatapultsRenderer } from './catapults';
import { PigsRenderer } from './pigs';
import { BuildingsRenderer } from './buildings';
import { Particles } from './particles';
import { RAIN_FALL, Rain } from './rain';
import { Seasons } from './seasons';
import { PostFX } from './postfx';
import { G, MAX_LIGHTS, cacheSharedUniforms, cutOrder, noteLights, patchMaterial, patchedDepthMaterial, uniformCache } from './shaderPatch';
import { buildingBuilder } from './buildingModels';
import { getClipMaterial, getMaterial, setWindowGlow } from './materials';
import { PlanarReflection, WaterCells, reflectionReach } from './reflection';
import { BordersRenderer } from './borders';
import { SpellFX } from './spells';
import { SPELLS, SpellId, castError } from '../game/faith';
import { ShipsRenderer } from './ships';
import { findDock } from '../game/sea';
import { SignsRenderer } from './signs';
import { PROBE_RADIUS, knownOre, prospectError } from '../game/geology';
import { PIONEER_RADIUS, pioneerError } from '../game/pioneers';
import { OrdersFX } from './orders';
import { Birds } from './birds';
import { Demolition } from './demolition';
import { PriorityMarker } from './priority';
import { LanternsRenderer } from './lanterns';
import { commitInstances, ownDepth, withInstanceColor } from './instancing';
import { ScreenLod, lodSetPass, lodView } from './lod';
import { framePace, type FrameCap } from './framePace';
import { COARSE_DIST } from './geom';
import { QUIET_PR, QUIET_SCALE } from './hardware';
import { Trails } from './trails';
import { perf, perfBaseline } from './perf';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
/** Share of the screen's resolution the world renders at before it is scaled up ('auto': full, stepped down while frames run late). */
export type Resolution = 'auto' | 'full' | '85' | '70' | '50';
const RES_SCALE: Record<Resolution, number> = { auto: 1, full: 1, '85': 0.85, '70': 0.7, '50': 0.5 };

export interface RenderSettings {
  quality: Quality;
  resolution: Resolution;
  /** render every Nth display frame, so that the frames shown arrive evenly */
  frameCap: FrameCap;
  bloom: boolean;
  dof: boolean;
  grass: boolean;
  ao: boolean;
  grade: boolean;
  dayCycle: boolean;
  weather: 'auto' | 'clear' | 'drizzle' | 'rain' | 'storm' | 'snow';
  borders: boolean;
  reflections: boolean;
  /** quiet (laptop) mode: at most QUIET_PR device pixels per CSS pixel however dense the screen, and
   * the frames slow to about 30 a second while the player touches nothing (see framePace.rest) */
  quiet: boolean;
}

/** Bloom and the tilt-shift blur are off by default, and the frames are capped at about 60: a laptop's fans notice both, the eye hardly. */
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  quality: 'high', resolution: 'auto', frameCap: '60', bloom: false, dof: false, grass: true, ao: false, grade: true, dayCycle: true, weather: 'auto', borders: true, reflections: true, quiet: true,
};

/** Falling-leaf colours of the deciduous species (oak, birch, fruit tree). */
const LEAF_FALL: Record<number, [number, number, number][]> = {
  0: [[0.72, 0.38, 0.07], [0.58, 0.2, 0.05], [0.42, 0.25, 0.1]],
  2: [[0.85, 0.66, 0.1], [0.74, 0.52, 0.08], [0.6, 0.44, 0.12]],
  4: [[0.72, 0.16, 0.05], [0.8, 0.4, 0.08], [0.5, 0.2, 0.08]],
};

/** the shadow map draws buildings on their coarse model from the distance the view shows it: the
 * shadow then matches what is seen, and the fitted map's texel (about 4e-4 of a unit per unit of
 * distance, shadowFit) has grown to a few centimetres, so the model's error spans only a few texels */
const SHADOW_COARSE_DIST = COARSE_DIST;
/** at Low, settlers, animals, lanterns and other small things cast shadows only in a view closer than this */
const LOW_SMALL_SHADOWS = 20;
const NO_SKIP: THREE.Object3D[] = [];

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  cam: RTSCamera;
  sky: Sky;
  terrain: TerrainRenderer;
  /** paths worn by traffic, read by the terrain and the grass */
  trails: Trails;
  water: WaterRenderer;
  trees: TreesRenderer;
  stones: StonesRenderer;
  fields: FieldsRenderer;
  vines: VinesRenderer;
  grass: GrassRenderer;
  settlers: SettlersRenderer;
  donkeys: DonkeysRenderer;
  catapults: CatapultsRenderer;
  /** the herds in the pig farms' pens and the pigs waiting at the slaughterhouses */
  pigs: PigsRenderer;
  animals: AnimalsRenderer;
  arrows: ProjectilesRenderer;
  piles: PilesRenderer;
  buildings: BuildingsRenderer;
  ships: ShipsRenderer;
  signs: SignsRenderer;
  particles: Particles;
  rain: Rain;
  fx: PostFX;
  birds: Birds;
  time = 0;
  settings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS };
  /** the frame cap and automatic resolution (shared with the main loop and the menu) */
  readonly pace = framePace;
  reflection: PlanarReflection;
  private waterCells: WaterCells;
  /** the uv rectangle of the reflection the water in view samples, and what the reflection leaves out */
  private reflRect = new THREE.Vector4();
  private reflHide: THREE.Object3D[] = [];
  /** off: the reflection draws everything over the whole texture (for comparisons) */
  reflectionCull = true;
  borders: BordersRenderer;
  spells: SpellFX;
  demolition: Demolition;
  /** soldiers the player has picked, and where his orders land */
  orders: OrdersFX;
  /** door lanterns that light up after dusk */
  lanterns: LanternsRenderer;
  /** the star over the building the player put first in line */
  priority: PriorityMarker;
  /** a Move or Attack order waiting for its target (from the soldiers' panel) */
  commanding: 'move' | 'attack' | null = null;
  // interaction state
  placing: BuildingType | null = null;
  casting: SpellId | null = null;
  /** Harbour an expedition is being planned from (target picking mode), 0 when off. */
  expedition = 0;
  /** Picking a mountain to send a geologist to. */
  prospecting = false;
  private prospectOk = true;
  /** Picking free land beside the border to send a pioneer to. */
  pioneering = false;
  private castCheckT = 0;
  private castOk = true;
  hoverNode = -1;
  hoverPoint: THREE.Vector3 | null = null;
  selected: { kind: 'building' | 'settler' | 'ship'; id: number } | null = null;
  /** a "Show me" ring on the ground (the campaign's), drawn where nothing is selected until `until` (render seconds) */
  teach: { x: number; z: number; r: number; until: number } | null = null;
  /** the map editor's brush: a ring on the ground where it would land, in its tool's colour */
  brush: { x: number; z: number; r: number; color: number } | null = null;
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
  private rainStrength = 0; // strength of the current spell: drizzle ~0.3 .. downpour 1
  private boltT = 20;
  seasons = new Seasons();
  /** level-of-detail picking and instance culling (lod.ts) */
  readonly lod = lodView;
  onEvent: ((e: GameEvent) => void) | null = null;
  private sound: ((name: string, x?: number, z?: number, vol?: number) => void) | null = null;
  private fogBase = new THREE.Color(0x0e3558);
  private ambient = new THREE.Color();
  private nightAmbient = new THREE.Color(0.35, 0.4, 0.6);
  private cameraRight = new THREE.Vector3();
  private pickVector = new THREE.Vector3();
  private pickNdc = { x: 0, y: 0 };
  private pickRay = new THREE.Raycaster();
  private pickNdcVector = new THREE.Vector2();
  private staticUpdateT = 0;
  /** what casts no shadow at Low (hidden while its shadow map is drawn), and whether each was visible */
  private lowShadowSkip: THREE.Object3D[] = [];
  private lowShadowWas: boolean[] = [];

  constructor(private canvas: HTMLCanvasElement, private game: Game, powerPreference: WebGLPowerPreference = 'default') {
    // (the world draws into targets of its own: the canvas only takes the final full-screen pass, so it
    // needs neither depth nor stencil)
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference, depth: false, stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    const props = r.properties;
    const program = (m: THREE.Material) => (props.get(m) as { currentProgram?: { id: number } }).currentProgram?.id ?? 0;
    r.setOpaqueSort((a, b) => cutOrder(a, b, program));
    this.renderer = r;
    // the shadow map draws every building on its far model: at shadow-map resolution nobody can tell
    // (and the instanced pairs show what they have for it: lodSetPass)
    const drawShadows = r.shadowMap.render.bind(r.shadowMap);
    r.shadowMap.render = (lights, scene, camera) => {
      const sm = r.shadowMap;
      if (!lights.length || !sm.enabled || !(sm.autoUpdate || sm.needsUpdate)) return drawShadows(lights, scene, camera);
      lodSetPass('shadow');
      // Low's map is too coarse for the shadows of small things (a settler's is a few blurred texels):
      // they stay out of its pass, which drew more triangles than the view itself, unless the view is so
      // close that there are few of them and they are big
      const low = this.settings?.quality === 'low';
      const skip = low && this.cam.dist >= LOW_SMALL_SHADOWS ? this.lowShadowSkip : NO_SKIP, was = this.lowShadowWas;
      for (let i = 0; i < skip.length; i++) { was[i] = skip[i].visible; skip[i].visible = false; }
      try {
        // (the coarse model once the view is out far enough that its error stays under the map's
        // texels, and always on Low's small map)
        if (this.buildings) this.buildings.withFar(() => drawShadows(lights, scene, camera), low || this.cam.dist >= SHADOW_COARSE_DIST ? 2 : 1);
        else drawShadows(lights, scene, camera);
      } finally {
        lodSetPass('main');
        for (let i = 0; i < skip.length; i++) skip[i].visible = was[i];
      }
    };
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(w, h, false);

    this.cam = new RTSCamera(game.world, w / h);
    this.cam.attach(canvas);
    this.scene.background = new THREE.Color(0x0b2a44);
    this.scene.fog = new THREE.Fog(0x9fb8d0, 80, 260);

    this.sky = new Sky(r, this.scene);
    this.trails = new Trails(game);
    G.tTrail.value = this.trails.tex;
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
    this.vines = new VinesRenderer(game);
    this.scene.add(this.vines.group);
    this.grass = new GrassRenderer(game);
    this.scene.add(this.grass.mesh);
    this.settlers = new SettlersRenderer(game, goodGeos);
    this.scene.add(this.settlers.group);
    this.donkeys = new DonkeysRenderer(game, goodGeos);
    this.scene.add(this.donkeys.group);
    this.catapults = new CatapultsRenderer(game);
    this.scene.add(this.catapults.group);
    this.orders = new OrdersFX(game);
    this.scene.add(this.orders.group);
    this.priority = new PriorityMarker(game);
    this.scene.add(this.priority.group);
    this.animals = new AnimalsRenderer(game);
    this.scene.add(this.animals.group);
    this.arrows = new ProjectilesRenderer(game);
    this.scene.add(this.arrows.mesh, this.arrows.stones);
    this.piles = new PilesRenderer(goodGeos);
    this.scene.add(this.piles.group);
    this.buildings = new BuildingsRenderer(game, this.piles);
    this.scene.add(this.buildings.group);
    this.scene.add(this.buildings.batches.group);
    this.lanterns = new LanternsRenderer(game, this.buildings);
    this.scene.add(this.lanterns.group);
    this.pigs = new PigsRenderer(game, this.buildings, (n, x, z, v) => this.sound?.(n, x, z, v));
    this.scene.add(this.pigs.group);
    this.particles = new Particles();
    this.scene.add(this.particles.group);
    this.settlers.idle.fx = this.particles;
    this.settlers.work.fx = this.particles;
    this.settlers.work.host = this.buildings;
    this.settlers.work.sound = (n, x, z, v) => this.sound?.(n, x, z, v);
    this.ships = new ShipsRenderer(game, this.piles, this.particles);
    this.scene.add(this.ships.group);
    this.signs = new SignsRenderer(game);
    this.scene.add(this.signs.group);
    this.rain = new Rain(game.world.W, game.world.H);
    this.scene.add(this.rain.mesh);
    this.birds = new Birds(game.world);
    this.scene.add(this.birds.group);
    this.borders = new BordersRenderer(game);
    this.scene.add(this.borders.posts, this.borders.caps);

    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0x66ff88, transparent: true, opacity: 0.55, emissive: new THREE.Color(0x114422), roughness: 0.6, depthWrite: false });
    const mg = new THREE.CylinderGeometry(0.13, 0.17, 0.05, 8);
    const mm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: true });
    this.markers = withInstanceColor(new THREE.InstancedMesh(mg, mm, 4000));
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);

    this.fx = new PostFX(r, this.scene, this.cam.camera, w, h);
    this.spells = new SpellFX(game, this.particles, this.terrain.uniforms, (flash, shake) => {
      this.fx.flash(flash);
      this.cam.shake = Math.max(this.cam.shake, shake);
    });
    this.scene.add(this.spells.group);
    this.demolition = new Demolition(game, this.particles, this.buildings, (x, y, z, flash, shake) => {
      if (flash > 0) {
        this.fx.flash(flash);
        this.spells.flashAt(x, y, z, 4, new THREE.Color(1.0, 0.45, 0.12));
      }
      this.cam.shake = Math.max(this.cam.shake, shake);
    }, (n, x, z, v) => this.sound?.(n, x, z, v));
    this.scene.add(this.demolition.group);
    this.lowShadowSkip = [this.settlers.group, this.donkeys.group, this.catapults.group, this.animals.group, this.pigs.group, this.birds.group,
      this.lanterns.group, this.signs.group, this.borders.posts, this.fields.mesh, this.vines.group, this.piles.group, this.arrows.mesh, this.arrows.stones, this.demolition.group];
    this.reflection = new PlanarReflection(WATER_LEVEL, w / 2, h / 2);
    this.water.uniforms.tReflect.value = this.reflection.rt.texture;
    this.waterCells = new WaterCells(game.world, WATER_LEVEL);
    // (the editor's world has no players: the view starts over its middle)
    const hq = game.buildings.get(game.players[game.local]?.hq ?? 0);
    if (hq) {
      this.cam.jumpTo(hq.cx, hq.cz + 4, true);
      this.cam.zoomTo(30, true);
    }
    this.giveDepths();
    this.applyQuality();
    window.addEventListener('resize', this.onResize);
  }

  /** Every instanced and batched mesh in the scene without a depth material of its own gets its kind's (ownDepth). */
  private giveDepths() {
    this.scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if ((m.isInstancedMesh || (o as THREE.BatchedMesh).isBatchedMesh) && !m.customDepthMaterial) ownDepth(m);
    });
  }

  private onResize = () => this.resize();
  /** materials kept only so that their shaders stay compiled (see warmUp) */
  private warmKeep: THREE.Material[] = [];
  /** set by dispose: work spread over frames for this world stops there */
  disposed = false;
  /** while warmUp waits on the compiler with its samples in the scene, which are not for the eye: frames are let by (the canvas keeps the last one) */
  private holding = false;

  /** Compile the shaders for the scene as it stands (the title screen's view, or a game's start), without blocking where the browser can compile in parallel. */
  async warmScene(maxMs = 5000) {
    const rt = this.renderer.getRenderTarget();
    // compiled for the target the world really renders into (linear, not tone mapped)
    this.renderer.setRenderTarget(this.fx.sceneRT);
    const ready = this.renderer.compileAsync(this.scene, this.cam.camera);
    this.renderer.setRenderTarget(rt);
    await Promise.race([ready, new Promise((r) => setTimeout(r, maxMs))]);
  }

  /**
   * Compile every shader the world can need before it is played: each kind of building for every
   * player (and as a construction site), and everything that is hidden for now. Otherwise the first
   * building of a new kind stalls the game for a tenth of a second or more while its shaders compile.
   * One kind of building at a time with a `pause` after each, so it can run behind the title screen;
   * it stops if the renderer is disposed meanwhile. Gives up waiting on the compiler after `maxMs`
   * (the programs keep compiling in the background).
   */
  async warmUp(pause: () => Promise<void> = () => Promise.resolve(), maxMs = 5000) {
    const extra = new THREE.Group();
    const t = this.cam.target;
    extra.position.set(t.x, t.y, t.z);
    const clip = new Map<string, THREE.Material>();
    // sites draw their shadow through this too (buildings.ts setClip)
    const clipDepth = patchedDepthMaterial({ clip: true });
    const finished: THREE.Group[] = [];
    const rt = this.renderer.getRenderTarget();
    for (const type of Object.keys(BUILDINGS) as BuildingType[]) {
      const kind = new THREE.Group();
      for (const p of this.game.players) {
        const mb = buildingBuilder(type, p.id);
        const g = mb.build((k) => getMaterial(k));
        finished.push(g);
        kind.add(g);
        const site = mb.build((k) => { let m = clip.get(k); if (!m) { m = getClipMaterial(k); clip.set(k, m); } return m; });
        site.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).customDepthMaterial = clipDepth; });
        kind.add(site);
      }
      // (lit by the world's lights, for the target it renders into)
      this.renderer.setRenderTarget(this.fx.sceneRT);
      try { this.renderer.compile(kind, this.cam.camera, this.scene); } finally { this.renderer.setRenderTarget(rt); }
      extra.add(kind);
      await pause();
      if (this.disposed) return;
    }
    // Every site has materials of its own, disposed when it is finished, and a shader goes with the
    // last material using it: keeping these samples keeps the shaders, or the first site after a
    // while without any compiled a dozen of them in the middle of the game (~150 ms).
    this.warmKeep.push(...clip.values(), clipDepth);
    const ships = this.ships.samples(this.game.players.map((p) => p.id));
    // (and both sides of the trees' full-leaf switch)
    const trees = this.trees.samples();
    for (const o of [ships, trees]) {
      this.renderer.setRenderTarget(this.fx.sceneRT);
      try { this.renderer.compile(o, this.cam.camera, this.scene); } finally { this.renderer.setRenderTarget(rt); }
      extra.add(o);
      await pause();
      if (this.disposed) return;
    }
    this.scene.add(extra);
    // and each finished one in the batches, as it will be drawn
    const batched = finished.map((g) => this.buildings.batches.add(g, (g.children.find((o) => o instanceof ScreenLod) as ScreenLod | undefined) ?? null));
    this.demolition.makePools();
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try {
      this.holding = true;
      try { await this.warmScene(maxMs); } finally { this.holding = false; }
      if (this.disposed) return;
      // one frame with it all in view compiles the shadow-map variants too
      this.frame(0, 0);
      // frame() hides what has nothing to draw yet (empty rubble pools): once more with everything shown
      for (const o of hidden) o.visible = true;
      this.renderer.setRenderTarget(this.fx.sceneRT);
      this.renderer.render(this.scene, this.cam.camera);
      this.renderer.setRenderTarget(rt);
    } finally {
      for (const o of hidden) o.visible = false;
      for (const b of batched) this.buildings.batches.remove(b);
      this.scene.remove(extra);
      // (the sails' own cloth geometry; everything else is shared)
      ships.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.userData.sail) (o as THREE.Mesh).geometry.dispose(); });
      // (their instance buffers; the geometry is the trees' own)
      for (const o of trees.children) (o as THREE.InstancedMesh).dispose();
    }
    // the view as it is over the one with every sample in it, before the page shows it (behind the title screen)
    this.giveDepths();
    if (!this.disposed) this.frame(0, 0);
  }

  /** Release GPU resources and listeners so a new world can be created on a fresh canvas. */
  dispose() {
    this.disposed = true;
    this.orders.dispose();
    this.priority.dispose();
    window.removeEventListener('resize', this.onResize);
    this.cam.detach();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.fx.dispose();
    this.buildings.batches.dispose();
    this.trails.tex.dispose();
    for (const m of this.warmKeep) m.dispose();
    this.reflection.rt.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  setSound(fn: (name: string, x?: number, z?: number, vol?: number) => void) {
    this.sound = fn;
  }

  applyQuality() {
    const s = this.settings;
    // (a dense laptop screen at 2x is four times the pixels of 1x: quiet mode draws no more than QUIET_PR)
    const dpr = Math.min(window.devicePixelRatio, s.quiet ? QUIET_PR : Infinity);
    const pr = s.quality === 'low' ? 1 : s.quality === 'medium' ? Math.min(dpr, 1.25) : s.quality === 'high' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(pr);
    this.grass.enabled = s.grass && s.quality !== 'low';
    this.fx.settings.bloom = s.bloom;
    this.fx.settings.dof = s.dof;
    this.fx.settings.grade = s.grade;
    this.fx.enableAO(s.ao);
    // Four samples on a dense laptop target spend bandwidth for very little visible gain. Ultra
    // keeps 4x; Quiet uses 2x (and Low none) while the final pass still sharpens scaled output.
    this.fx.setSamples(perfBaseline ? 4 : s.quality === 'low' ? 0 : s.quality === 'ultra' && !s.quiet ? 4 : s.quiet ? 2 : 4);
    framePace.auto = s.resolution === 'auto';
    if (!framePace.auto) framePace.level = 0;
    framePace.cap = s.frameCap;
    this.fx.scale = this.worldScale();
    // Reflections and shadows are deliberately temporal in quiet mode. At 60 fps they update at
    // 15 and 30 fps respectively; at the idle 30 fps they halve again without spending power on
    // differences which are almost impossible to see in an RTS view. Out of quiet mode the water keeps
    // each reflection for two frames at every level (at Ultra too: a fresh one every frame cost
    // 1.1-2.9 ms in a town and the ripples hide the difference).
    this.reflEvery = perfBaseline ? (s.quality === 'ultra' ? 1 : 2) : s.quiet ? 4 : 2;
    this.shadowEvery = perfBaseline ? 1 : s.quality === 'ultra' && !s.quiet ? 1 : 2;
    this.sky.cycle = s.dayCycle;
    this.terrain.uniforms.uBorderOn.value = s.borders ? 1 : 0;
    if (this.borders) { this.borders.posts.visible = s.borders; this.borders.caps.visible = s.borders; }
    this.resize();
  }

  /**
   * The sun's shadow map: its height by quality, and wider on a wide screen, where the view's footprint
   * is (fitShadow draws only the part of it the view needs).
   */
  private sizeShadowMap() {
    const q = this.settings.quality;
    // Ultra owns the very large map. High + Quiet has one quarter of the old shadow texels; the
    // tightly fitted camera keeps its on-screen texel density convincing.
    const h = perfBaseline ? (q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096)
      : q === 'low' ? 1024 : q === 'medium' ? 1536 : q === 'high' ? (this.settings.quiet ? 1536 : 2560) : 4096;
    const w = Math.round((h * THREE.MathUtils.clamp(this.cam.camera.aspect / 1.6, 1, 1.4)) / 256) * 256;
    const sh = this.sky.shadow;
    if (sh.mapSize.x === w && sh.mapSize.y === h) return;
    sh.mapSize.set(w, h);
    sh.map?.dispose();
    sh.map = null as any;
  }

  private lastW = 0;
  private lastH = 0;
  /** the water's reflection is drawn every this many frames; the water keeps the last picture between */
  reflEvery = 2;
  private reflectionScale = 0.5;
  private shadowEvery = 1;
  private shadowStale = true;
  /** the kept reflection is gone (target resized, or no water was in view): draw a fresh one */
  private reflStale = true;
  private frameNo = 0;
  /** Pixels per CSS pixel of the world's render target. */
  get renderPixelRatio() {
    return this.renderer.getPixelRatio() * this.fx.scale;
  }
  /** Effective world-resolution scale, including Quiet's deliberate headroom. */
  get renderScale() {
    return this.fx.scale;
  }
  private worldScale() {
    const scale = framePace.auto ? framePace.scale : RES_SCALE[this.settings.resolution] ?? 1;
    return scale * (!perfBaseline && framePace.auto && this.settings.quiet ? QUIET_SCALE : 1);
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.lastW = w;
    this.lastH = h;
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.sizeShadowMap();
    this.fx.setSize(w, h);
    // the world renders at the resolution scale (the final pass scales it up to the canvas)
    const pr = this.renderPixelRatio;
    this.reflectionScale = perfBaseline ? 0.5 : this.settings.quiet ? 0.4 : 0.5;
    this.reflection?.setSize(w * pr * this.reflectionScale, h * pr * this.reflectionScale);
    this.reflStale = true;
    this.shadowStale = true;
    framePace.resized();
    const pxScale = (h * pr) / (2 * Math.tan((this.cam.camera.fov * Math.PI) / 360));
    this.particles.setScale(pxScale);
    this.settlers.idle.setScale(pxScale);
    this.rain.setScale(w * pr, h * pr, pxScale, pr);
  }

  // ------------------------------------------------------------ picking
  ndc(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    this.pickNdc.x = ((clientX - r.left) / r.width) * 2 - 1;
    this.pickNdc.y = -((clientY - r.top) / r.height) * 2 + 1;
    return this.pickNdc;
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
    const v = this.pickVector;
    const scan = (list: { s: Settler; x: number; y: number; z: number }[]) => {
      for (const it of list) {
        v.set(it.x, it.y + 0.45, it.z).project(this.cam.camera);
        const sx = (v.x * 0.5 + 0.5) * r.width + r.left, sy = (-v.y * 0.5 + 0.5) * r.height + r.top;
        const d = (sx - clientX) ** 2 + (sy - clientY) ** 2;
        if (d < bd) { bd = d; best = it.s; }
      }
    };
    scan(this.settlers.visibleList); scan(this.donkeys.visibleList); scan(this.catapults.visibleList);
    return best;
  }

  pickShip(clientX: number, clientY: number): number {
    const n = this.ndc(clientX, clientY);
    const ray = this.pickRay;
    ray.setFromCamera(this.pickNdcVector.set(n.x, n.y), this.cam.camera);
    return this.ships.pick(ray);
  }

  pickBuilding(clientX: number, clientY: number): Building | null {
    // raycast building meshes first (tall models), fall back to ground footprint
    const n = this.ndc(clientX, clientY);
    const ray = this.pickRay;
    ray.setFromCamera(this.pickNdcVector.set(n.x, n.y), this.cam.camera);
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
    if (!this.placing && this.expedition) { this.updateExpedition(dt); return; }
    if (!this.placing && this.pioneering) { if (this.ghost) this.ghost.visible = false; this.updatePioneering(dt); return; }
    if (!this.placing) {
      if (this.ghost) this.ghost.visible = false;
      commitInstances(this.markers, 0);
      if (!this.casting && !this.prospecting) U.uRange.value.w = 0;
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
      if (def.mine) {
        // mines: what our geologists found here — rich green, poor red, unknown grey
        const k = knownOre(g, g.local, def.mine, a.x + (def.size - 1) / 2, a.y + (def.size - 1) / 2);
        if (k.known < 4) col.setRGB(0.55, 0.58, 0.62);
        else if (k.amount >= 12) col.setRGB(0.15, 0.9, 0.2);
        else if (k.amount > 0) col.setRGB(0.95, 0.75, 0.1);
        else col.setRGB(0.9, 0.2, 0.12);
        this.markers.setColorAt(n, col);
        n++;
        return;
      }
      // quality: flatter spots are greener
      let hmin = Infinity, hmax = -Infinity;
      for (const j of g.footprint(def.size, a.x, a.y)) { hmin = Math.min(hmin, w.h[j]); hmax = Math.max(hmax, w.h[j]); }
      const flat = 1 - Math.min(1, (hmax - hmin) / 1.2);
      col.setRGB(0.9 - flat * 0.75, 0.55 + flat * 0.35, 0.08);
      this.markers.setColorAt(n, col);
      n++;
    });
    commitInstances(this.markers, n);
  }

  /** Expedition targeting: free coasts get markers, the harbour ghost follows the cursor to the nearest one. */
  private updateExpedition(dt: number) {
    const g = this.game;
    const w = g.world;
    const from = g.buildings.get(this.expedition);
    if (!from || from.dock < 0) { this.expedition = 0; return; }
    const sea = w.sea[from.dock];
    this.ensureGhost('harbour');
    const ghost = this.ghost!;
    const size = BUILDINGS.harbour.size;
    const ok = (x: number, y: number) => {
      const a = g.anchorFor('harbour', x, y);
      if (g.placeError('harbour', g.local, a.x, a.y, true)) return null;
      const d = findDock(g, size, a.x, a.y);
      return d >= 0 && w.sea[d] === sea ? a : null;
    };
    ghost.visible = false;
    if (this.hoverNode >= 0) {
      const hx = w.nx(this.hoverNode), hy = w.ny(this.hoverNode);
      let best: { x: number; y: number } | null = null, bd = Infinity;
      w.forRadius(hx, hy, 4, (_i, x, y, d2) => { if (d2 < bd && (x + y) % 2 === 0) { const a = ok(x, y); if (a) { bd = d2; best = a; } } });
      if (best) {
        const a = best as { x: number; y: number };
        let hs = 0;
        for (const i of g.footprint(size, a.x, a.y)) hs += w.h[i];
        ghost.position.set(a.x + (size - 1) / 2, hs / (size * size), a.y + (size - 1) / 2);
        ghost.visible = true;
        this.ghostMat.color.set(0x70d0ff);
        this.ghostMat.emissive.set(0x103050);
      }
    }
    this.markerT -= dt;
    if (this.markerT > 0) return;
    this.markerT = 0.4;
    const t = this.cam.target;
    const R = Math.min(40, this.cam.viewSize * 1.0);
    let n = 0;
    const m = new THREE.Matrix4();
    const col = new THREE.Color(0.35, 0.8, 1.0);
    const taken = new Set<number>();
    w.forRadius(t.x, t.z, R, (i, x, y) => {
      if (n >= 4000) return;
      if (w.owner[i] >= 0 || w.isWater(i) || !w.explored[i] || w.shoreDist[i] > 0) return;
      // only coastal nodes can host a harbour; one marker per 3x3 cell
      if (w.region[i] && x > 4 && y > 4 && x < w.W - 5 && y < w.H - 5) {
        let coast = false;
        for (let d = -4; d <= 4 && !coast; d += 2) coast = w.isWater(i + d) || w.isWater(i + d * w.W);
        if (!coast) return;
      }
      const cell = Math.floor(x / 3) * 1000 + Math.floor(y / 3);
      if (taken.has(cell)) return;
      if (!ok(x, y)) return;
      taken.add(cell);
      m.makeTranslation(x, w.h[i] + 0.05, y);
      this.markers.setMatrixAt(n, m);
      this.markers.setColorAt(n, col);
      n++;
    });
    commitInstances(this.markers, n);
  }

  /** Pioneer targeting: the circle they would claim, with markers on the free land inside it. */
  private updatePioneering(dt: number) {
    const g = this.game;
    const w = g.world;
    const U = this.terrain.uniforms;
    const p = this.hoverPoint;
    if (!p) { U.uRange.value.w = 0; commitInstances(this.markers, 0); return; }
    (U.uRange.value as THREE.Vector4).set(p.x, 0, p.z, PIONEER_RADIUS);
    this.markerT -= dt;
    if (this.markerT > 0) return;
    this.markerT = 0.15;
    const ok = pioneerError(g, g.local, p.x, p.z) === null;
    (U.uRangeCol.value as THREE.Color).setRGB(...(ok ? [1.0, 0.62, 0.25] : [1, 0.3, 0.2]) as [number, number, number]);
    let n = 0;
    const m = new THREE.Matrix4();
    const col = new THREE.Color(1.0, 0.6, 0.2);
    if (ok) {
      w.forRadius(p.x, p.z, PIONEER_RADIUS, (i, x, y) => {
        if ((x + y) & 1 || w.owner[i] >= 0 || w.isWater(i) || !w.explored[i]) return;
        m.makeTranslation(x, w.h[i] + 0.04, y);
        this.markers.setMatrixAt(n, m);
        this.markers.setColorAt(n, col);
        n++;
      });
    }
    commitInstances(this.markers, n);
  }

  private updateCasting(dt: number) {
    const U = this.terrain.uniforms;
    if (this.pioneering && !this.placing) return;
    if (this.prospecting && this.hoverPoint && !this.placing && !this.casting) {
      const p = this.hoverPoint;
      this.castCheckT -= dt;
      if (this.castCheckT <= 0) {
        this.castCheckT = 0.2;
        this.prospectOk = prospectError(this.game, this.game.local, p.x, p.z) === null;
      }
      (U.uRangeCol.value as THREE.Color).setRGB(...(this.prospectOk ? [1.0, 0.72, 0.3] : [1, 0.3, 0.2]) as [number, number, number]);
      (U.uRange.value as THREE.Vector4).set(p.x, 0, p.z, PROBE_RADIUS);
      return;
    }
    if (!this.casting || !this.hoverPoint) {
      this.spells.preview = null;
      if (!this.placing) (U.uRangeCol.value as THREE.Color).setRGB(0.45, 0.85, 1.0);
      return;
    }
    const def = SPELLS[this.casting];
    const p = this.hoverPoint;
    this.castCheckT -= dt;
    if (this.castCheckT <= 0) {
      this.castCheckT = 0.2;
      this.castOk = castError(this.game, this.game.local, this.casting, p.x, p.z) === null;
    }
    this.spells.preview = { x: p.x, z: p.z, r: def.radius, col: new THREE.Color(...def.color), ok: this.castOk };
    (U.uRangeCol.value as THREE.Color).setRGB(...(this.castOk ? def.color : [1, 0.3, 0.2] as [number, number, number]));
    (U.uRange.value as THREE.Vector4).set(p.x, 0, p.z, def.radius);
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
      const snd = (n: string, v = 1) => this.sound?.(n, x, z, v);
      this.spells.onEvent(e, snd);
      this.orders.onEvent(e);
      if (!near(e.x, e.z)) continue;
      switch (e.type) {
        case 'chop': P.chips(x, y, z); snd('chop'); break;
        case 'treefall': {
          // leaves in the colour of the season (evergreens stay green, bare trees shed only twigs)
          const tr = this.game.trees.get(this.game.world.tree[this.game.world.idx(Math.round(e.x!), Math.round(e.z!))]);
          const SA = G.uSeasonA.value;
          const dec = !!tr && !!LEAF_FALL[tr.species];
          if (dec && SA.x < 0.15) P.leaves(x, y, z, 6, [0.22, 0.16, 0.1], [0.18, 0.13, 0.09]);
          else if (dec && SA.y > 0.4) P.leaves(x, y, z, 18, LEAF_FALL[tr!.species][0], LEAF_FALL[tr!.species][1]);
          else P.leaves(x, y, z, 18);
          setTimeout(() => P.dust(x, y, z, 10, [0.5, 0.45, 0.35]), 1100);
          snd('treefall');
          break;
        }
        case 'stonehit': P.sparks(x, y + 0.3, z, 4); P.dust(x, y + 0.2, z, 3, [0.62, 0.6, 0.58]); snd('pick'); break;
        case 'dig': P.dust(x, y, z, 5); snd('dig', 0.6); break;
        case 'staked': {
          const c = new THREE.Color(PLAYER_COLORS[e.owner ?? 0]);
          P.dust(x, y, z, 8, [0.5, 0.4, 0.3]);
          P.sparkle(x, y + 0.5, z, 12, [c.r * 1.8, c.g * 1.8, c.b * 1.8]);
          snd('hammer', 0.5);
          break;
        }
        case 'dirt': P.dust(x, y, z, 4); break;
        case 'hammer': snd('hammer', 0.7); P.dust(x, y + 0.3, z, 1, [0.6, 0.55, 0.45]); break;
        case 'buildstep': P.dust(x, y + 0.3, z, 6, [0.62, 0.55, 0.45]); break;
        case 'built': P.sparkle(x, y + 1.2, z, 40); P.dust(x, y, z, 12); snd('built'); break;
        case 'placed': P.dust(x, y, z, 8); snd('place'); break;
        case 'burn': snd('fire'); snd('creak', 0.6); P.smoke(x, y + 1, z, 0.9, 1.6); this.cam.shake = 0.2; break;
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
        case 'priority': P.sparkle(x, y + 1.6, z, 24, [2.2, 1.7, 0.6]); break;
        case 'spawn': P.sparkle(x, y + 0.5, z, 8, [1.2, 1.4, 1.8]); break;
        case 'soldier': P.sparkle(x, y + 0.6, z, 16, [1.8, 1.2, 0.6]); snd('horn', 0.5); break;
        case 'equip': P.sparkle(x, y + 0.6, z, 6); break;
        case 'donkey': P.sparkle(x, y + 0.6, z, 10, [1.3, 1.2, 0.9]); P.dust(x, y, z, 4); snd('pop', 0.5); break;
        case 'machine': P.sparkle(x, y + 0.9, z, 24, [1.6, 1.3, 0.7]); P.dust(x, y, z, 8); snd('built', 0.7); snd('creak', 0.7); break;
        case 'catapult': P.dust(x, y + 0.3, z, 3, [0.6, 0.55, 0.45]); snd('thump'); break;
        case 'stonefall':
          if (y < WATER_LEVEL) { this.waterColumn(x, z, 0.8); snd('splash', 0.8); break; }
          P.dust(x, y, z, 10, [0.5, 0.45, 0.38]); snd('crash', 0.55); break;
        case 'siegehit': P.dust(x, y + 0.6, z, 18, [0.58, 0.54, 0.48]); P.sparks(x, y + 0.7, z, 8); P.smoke(x, y + 1, z, 0.4, 0.8); snd('crash'); this.cam.shake = Math.max(this.cam.shake, 0.35); break;
        case 'razed': P.dust(x, y + 0.5, z, 30, [0.55, 0.5, 0.45]); P.sparks(x, y + 1, z, 12); snd('crash'); snd('horn', 0.5); this.cam.shake = Math.max(this.cam.shake, 0.6); break;
        case 'caravan': P.dust(x, y, z, 3, [0.6, 0.55, 0.45]); snd('pop', 0.35); break;
        case 'produced': if (Math.random() < 0.3) snd('pop', 0.3); break;
        case 'attack': snd('horn'); break;
        case 'launch': P.splash(x, WATER_LEVEL, z); P.splash(x + 0.6, WATER_LEVEL, z); P.sparkle(x, WATER_LEVEL + 1.4, z, 30); snd('splash'); snd('bell'); snd('horn', 0.6); break;
        case 'setsail': snd('bell', 0.7); break;
        case 'moor': P.splash(x, WATER_LEVEL, z); snd('creak', 0.6); break;
        case 'landed': P.sparkle(x, y + 1.5, z, 50, [0.8, 1.4, 2.0]); snd('fanfare'); break;
        case 'ashore': P.splash(x, WATER_LEVEL, z); break;
        case 'sign': {
          if (e.owner !== this.game.local) break;
          const oc: [number, number, number][] = [[0.8, 0.75, 0.65], [0.3, 0.3, 0.32], [1.4, 0.6, 0.3], [2.2, 1.7, 0.5], [1.2, 1.2, 1.15]];
          P.dust(x, y, z, 6, [0.6, 0.58, 0.55]);
          if (e.s) P.sparkle(x, y + 0.5, z, e.s === 3 ? 26 : 10, oc[e.s ?? 0]);
          snd(e.s === 3 ? 'chime' : 'pop', e.s ? 0.8 : 0.5);
          break;
        }
        case 'sink': for (let k = 0; k < 4; k++) P.splash(x + (Math.random() - 0.5), WATER_LEVEL, z + (Math.random() - 0.5)); snd('splash'); break;
        // ---- naval warfare
        case 'broadside': P.dust(x, WATER_LEVEL + 0.9, z, 3, [0.62, 0.58, 0.5]); snd('thump'); snd('creak', 0.5); break;
        case 'shiphit':
          if (e.kind === 'arrow') { P.hit(x, WATER_LEVEL + 0.6, z); snd('hit', 0.35); break; }
          P.chips(x, WATER_LEVEL + 0.1, z); P.chips(x + 0.2, WATER_LEVEL + 0.2, z - 0.2);
          P.sparks(x, WATER_LEVEL + 0.5, z, 5); P.smoke(x, WATER_LEVEL + 0.5, z, 0.5, 0.6); P.splash(x + 0.4, WATER_LEVEL, z + 0.3);
          snd('crash', 0.8); snd('creak', 0.6);
          this.cam.shake = Math.max(this.cam.shake, 0.15);
          break;
        case 'seamiss': this.waterColumn(x, z, 1); snd('splash', 0.9); break;
        case 'arrowsplash': P.emit({ x, y: WATER_LEVEL + 0.02, z, vy: 0.9, spread: 0.3, life: 0.4, size: 0.04, color: [0.85, 0.92, 1], alpha: 0.8, gravity: 6, count: 4, kind: 1 }); break;
        case 'sinking':
          this.waterColumn(x, z, 0.8); P.smoke(x, WATER_LEVEL + 0.8, z, 0.8, 1.2); P.sparks(x, WATER_LEVEL + 0.8, z, 12);
          snd('crash'); snd('creak'); snd('splash');
          this.cam.shake = Math.max(this.cam.shake, 0.3);
          break;
        case 'wreck':
          for (let k = 0; k < 6; k++) P.splash(x + (Math.random() - 0.5) * 2, WATER_LEVEL, z + (Math.random() - 0.5) * 2);
          P.emit({ x, y: WATER_LEVEL + 0.02, z, spread: 1.6, life: 6, size: 0.09, color: [0.4, 0.3, 0.2], alpha: 0.9, drag: 3, count: 14, kind: 1 });
          snd('splash', 0.7);
          break;
      }
    }
  }

  /** A stone plunging into the sea throws up a column of spray. */
  private waterColumn(x: number, z: number, s: number) {
    const P = this.particles;
    P.emit({ x, y: WATER_LEVEL + 0.05, z, vy: 3.6 * s, spread: 0.25, vspread: 1.2, life: 1.1, size: 0.09, color: [0.9, 0.95, 1], alpha: 0.9, gravity: 7, drag: 0.3, count: 22, kind: 1 });
    P.emit({ x, y: WATER_LEVEL + 0.4, z, vy: 1.4 * s, spread: 0.2, life: 1.4, size: 0.35, grow: 2.2, color: [0.92, 0.96, 1], alpha: 0.4, gravity: 1.5, drag: 1.5, count: 4 });
    P.splash(x, WATER_LEVEL, z);
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
      if (b.state !== 'done' || !tick) continue;
      if (b.def.mana) {
        // holy fire burns in the braziers while a priest serves
        if (b.worker) for (const f of v.anchors.fires) {
          if (Math.random() < 0.6) P.emit({ x: b.cx + f.x, y: by + f.y, z: b.cz + f.z, vy: 0.9, spread: 0.12, life: 0.6, size: 0.18, grow: -0.5, color: [2.2, 1.5, 0.6], color2: [1.2, 0.45, 0.1], alpha: 0.8, drag: 1.2, jitter: 0.12, additive: true, kind: 3 });
          if (b.working && Math.random() < 0.25) P.emit({ x: b.cx + f.x, y: by + f.y + 0.2, z: b.cz + f.z, vy: 0.8, spread: 0.3, life: 1.6, size: 0.04, color: [2.2, 1.9, 1.0], alpha: 1, gravity: -0.2, drag: 0.5, additive: true, kind: 1 });
        }
        continue;
      }
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
        // a worker out in the yard makes his own sparks and noise, in time with his hammer (work.ts)
        const atWork = this.settlers.work.shown.has(b.id);
        for (const f of v.anchors.fires) {
          if (Math.random() < 0.35) P.fire(b.cx + f.x, by + f.y, b.cz + f.z, 0.25);
          if ((b.type === 'toolsmith' || b.type === 'weaponsmith') && !atWork && Math.random() < 0.25) {
            P.sparks(b.cx + 0.6, by + 0.35, b.cz + 0.2, 5);
            this.sound?.('anvil', b.cx, b.cz, 0.5);
          }
        }
        if (b.type === 'sawmill' && !atWork && Math.random() < 0.4) P.emit({ x: b.cx + 0.97, y: by + 0.4, z: b.cz + 0.15, vy: 0.5, spread: 0.8, life: 0.8, size: 0.04, color: [0.9, 0.78, 0.55], gravity: 2, count: 3, kind: 1 });
        if (b.type === 'sawmill' && Math.random() < 0.07) this.sound?.('saw', b.cx, b.cz, 0.5);
      }
    }
    // blessed soldiers shimmer
    if (tick) {
      for (const s of g.settlers.values()) {
        if (s.hidden || s.dead || g.time >= s.blessUntil) continue;
        if (Math.abs(s.x - t.x) > R || Math.abs(s.z - t.z) > R || Math.random() > 0.35) continue;
        P.emit({ x: s.x, y: w.heightAt(s.x, s.z) + 0.95, z: s.z, vy: 0.3, spread: 0.35, life: 0.8, size: 0.05, color: [2.0, 1.8, 0.9], alpha: 1, drag: 1, additive: true, kind: 1 });
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
    // autumn leaves and spring blossom petals drifting down from deciduous trees
    const SA = G.uSeasonA.value;
    const shed = SA.y > 0.3 && SA.x > 0.02 && SA.x < 0.98 ? 4 * SA.x * (1 - SA.x) : 0;
    if (tick && (shed > 0 || SA.w > 0.3)) {
      const wind = G.uWind.value;
      for (let k = 0; k < 10; k++) {
        const x = Math.round(t.x + (Math.random() - 0.5) * R * 1.4), z = Math.round(t.z + (Math.random() - 0.5) * R * 1.2);
        if (!w.inBounds(x, z)) continue;
        const i = w.idx(x, z);
        const tr = w.tree[i] ? g.trees.get(w.tree[i]) : undefined;
        if (!tr || tr.state === 'falling' || !w.explored[i] || !LEAF_FALL[tr.species]) continue;
        const petal = tr.species === 4 && SA.w > 0.3;
        if (!petal && Math.random() > shed) continue;
        const sc = tr.scale * (0.18 + 0.82 * Math.min(1, tr.growth));
        const cols = LEAF_FALL[tr.species];
        P.emit({
          x: x + (Math.random() - 0.5) * sc, y: w.h[i] + (1.1 + Math.random() * 0.8) * sc, z: z + (Math.random() - 0.5) * sc,
          vx: wind.x * 0.5, vz: wind.y * 0.5, vy: 0, spread: 0.35, vspread: 0.1, life: 4.5, size: petal ? 0.035 : 0.05,
          color: petal ? [1.0, 0.8, 0.86] : cols[Math.floor(Math.random() * cols.length)], alpha: 1, gravity: 0.9, drag: 1.8, kind: 1,
        });
      }
    }
  }

  private updateWeather(dt: number) {
    const mode = this.settings.weather;
    const cold = this.seasons.cold;
    const forced: Partial<Record<RenderSettings['weather'], number>> = { clear: 0, drizzle: 0.35, rain: 0.62, storm: 1, snow: 1 };
    if (mode in forced) {
      this.rainStrength = forced[mode]!;
      if (mode !== 'clear') this.precip = mode === 'snow' ? 'snow' : 'rain';
    } else {
      this.weatherT -= dt;
      // the first proper snowfall comes soon after winter sets in
      if (cold > 0.8 && G.uSnow.value < 0.15 && this.rainStrength === 0 && this.rainAmount < 0.05) this.weatherT = Math.min(this.weatherT, 10);
      if (this.weatherT <= 0) {
        if (this.rainStrength > 0) this.rainStrength = 0;
        else if (Math.random() < 0.4 + cold * 0.25) {
          // mostly showers, sometimes steady rain, now and then a downpour
          const p = Math.random();
          this.rainStrength = p < 0.4 ? 0.3 + Math.random() * 0.15 : p < 0.82 ? 0.5 + Math.random() * 0.25 : 0.88 + Math.random() * 0.12;
          // snow in winter, rain the rest of the year
          if (this.rainAmount < 0.05) this.precip = cold > 0.5 ? 'snow' : 'rain';
        }
        this.weatherT = this.rainStrength > 0 ? (60 + Math.random() * 70) * (1.3 - this.rainStrength * 0.5) : (120 + Math.random() * 180) * (1 - cold * 0.5);
      }
    }
    // gusts and lulls within a spell
    const gust = 0.82 + 0.18 * Math.sin(this.time * 0.11) * Math.sin(this.time * 0.043 + 1);
    this.targetRain = this.rainStrength * gust;
    this.rainAmount += (this.targetRain - this.rainAmount) * (1 - Math.exp(-dt * 0.25));
    const snowing = this.precip === 'snow';
    // the sky closes over well before the rain gets heavy
    this.sky.weather = Math.min(1, this.rainAmount * (snowing ? 0.8 : 1.6));
    // snow cover builds up while it snows; winter snow lies until the thaw, which leaves the ground wet
    const sn = G.uSnow.value;
    if (snowing && this.rainAmount > 0.3) G.uSnow.value = Math.min(1, sn + dt / 70 * this.rainAmount);
    else G.uSnow.value = Math.max(0, sn - (dt * (this.seasons.lapsing ? 40 : 1)) / (140 + cold * 2400));
    const thaw = snowing ? 0 : Math.min(1, sn * 2) * (1 - cold);
    G.uWet.value = snowing ? 0 : Math.min(1, Math.max(this.rainAmount * 1.3, thaw * 0.7));
    G.uWindStrength.value = 1 + this.rainAmount * (snowing ? 0.5 : 1.2);
    // thunder in heavy rain: mostly distant flashes, now and then a strike in view
    if (!snowing && this.rainAmount > 0.55) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = (18 + Math.random() * 40) / (this.rainAmount * this.rainAmount);
        const t = this.cam.target, R = this.cam.viewSize, w = this.game.world;
        const near = Math.random() < 0.3;
        const a = Math.random() * Math.PI * 2, d = near ? Math.random() * R * 0.7 : R * 2 + Math.random() * 40;
        const x = THREE.MathUtils.clamp(t.x + Math.cos(a) * d, 1, w.W - 2), z = THREE.MathUtils.clamp(t.z + Math.sin(a) * d, 1, w.H - 2);
        this.spells.lightning(x, z, near);
        const delay = near ? 200 + Math.random() * 500 : 1200 + Math.random() * 2500;
        setTimeout(() => this.sound?.('thunder', near ? x : undefined, near ? z : undefined, near ? 1 : 0.25 + Math.random() * 0.25), delay);
      }
    } else this.boltT = Math.max(this.boltT, 8);
    const wind = G.uWind.value;
    const a = this.time * 0.01;
    wind.set(Math.cos(a) * 0.9, Math.sin(a) * 0.4 + 0.2);
  }

  get raining() {
    return this.rainAmount;
  }

  // ------------------------------------------------------------ frame
  frame(dt: number, gameDt: number) {
    if (this.holding) return;
    perf.beginFrame(this.renderer);
    const frameGpu = perf.beginGpu(this.renderer.getContext(), 'frame');
    const updateT = perf.begin();
    if (this.canvas.clientWidth !== this.lastW || this.canvas.clientHeight !== this.lastH) this.resize();
    // the automatic resolution has moved a step: the world's targets follow
    const worldScale = this.worldScale();
    if (framePace.auto && worldScale !== this.fx.scale) { this.fx.scale = worldScale; this.resize(); }
    this.time += dt;
    this.frameNo++;
    G.uTime.value = this.time;
    const g = this.game;
    this.cam.update(dt);
    this.seasons.length = this.sky.dayLength * 1.5;
    this.seasons.update(dt, gameDt, G.uSnow.value);
    this.updateWeather(dt);
    const zoom01 = (this.cam.dist - this.cam.minDist) / (this.cam.maxDist - this.cam.minDist);
    this.sky.update(gameDt, this.cam.target, this.cam.viewSize);
    const shadowEvery = this.settings.quiet && this.cam.settled ? this.shadowEvery * 2 : this.shadowEvery;
    const shadowDue = this.shadowsLive && (this.shadowStale || this.frameNo % shadowEvery === 0);
    if (shadowDue) fitShadow(this.sky.sun, this.sky.shadow, this.cam.camera, this.cam.target, this.cam.viewSize, this.sky.sunDir, g.world);
    // Do not recompute the light's shadow matrix on a reuse frame: the kept texture and its matrix
    // must remain a pair. Shadow-only instances are needed only on frames which draw that pass.
    lodView.update(this.cam.camera, this.lastH * this.renderPixelRatio, shadowDue ? this.sky.sun : null);
    // fresh snow throws the moonlight back; hold the exposure down so a winter night still reads as night
    this.renderer.toneMappingExposure = this.sky.exposure * (1 - G.uSnow.value * G.uNight.value * 0.32);
    this.terrain.uniforms.uSunI.value = this.sky.sunIntensity / 3;
    (this.water.uniforms.uSkyCol.value as THREE.Color).copy(this.sky.horizon);
    (this.water.uniforms.uSunCol.value as THREE.Color).copy(this.sky.sun.color).multiplyScalar(this.sky.sunIntensity / 3);
    const fogC = this.sky.fogColor;
    (this.scene.fog as THREE.Fog).color.copy(fogC);
    // rain hangs a veil over the distance
    const haze = 1 - this.rainAmount * (this.precip === 'rain' ? 0.45 : 0.25);
    (this.scene.fog as THREE.Fog).near = (60 + this.cam.dist) * haze;
    (this.scene.fog as THREE.Fog).far = (200 + this.cam.dist * 2) * haze;
    (this.scene.background as THREE.Color).copy(this.fogBase).lerp(fogC, 0.3);
    const night = G.uNight.value;
    setWindowGlow(night * 2.2);
    const ambient = this.ambient.setRGB(1, 1, 1).lerp(this.nightAmbient, night);
    this.particles.setAmbient(ambient);
    this.rain.setAmbient(ambient);

    this.terrain.update(dt);
    this.trails.update(this.renderer, gameDt, this.cam.target.x, this.cam.target.z, this.cam.viewSize, this.cam.dist);
    this.borders.update();
    // Static-world visibility has no reason to be rebuilt 30 times a second after the camera has
    // settled. Changes still appear within 120 ms; camera motion immediately returns it to 60 Hz.
    this.staticUpdateT -= dt;
    if (!this.cam.settled || this.staticUpdateT <= 0) {
      this.staticUpdateT = 0.12;
      this.trees.update(this.time);
      this.stones.update();
      this.fields.update();
      this.vines.update();
    }
    this.grass.update(dt);
    this.piles.begin();
    this.buildings.update(dt, this.time);
    this.lanterns.update(dt);
    const hl = this.ships.highlight;
    hl.clear();
    for (const id of this.orders.ships) hl.add(id);
    if (this.selected?.kind === 'ship') hl.add(this.selected.id);
    this.ships.update(dt, this.time, this.cam.target.x, this.cam.target.z, this.cam.camera);
    this.signs.update(this.time);
    this.piles.end();
    const WU = this.water.uniforms;
    WU.uWakeN.value = this.ships.wakeCount;
    for (let k = 0; k < this.ships.wakeCount; k++) (WU.uWakes.value as THREE.Vector4[])[k].copy(this.ships.wakes[k]);
    this.settlers.idle.rain = this.precip === 'rain' ? this.rainAmount : 0;
    this.settlers.update(dt, this.time, this.cam.camera);
    this.donkeys.update(dt, this.time, this.cam.camera);
    this.catapults.update(dt, this.time, this.cam.camera);
    this.pigs.update(dt, this.time, this.cam.camera);
    this.animals.update(dt, this.time);
    this.arrows.update();
    this.birds.update(dt, night);
    this.updatePlacement(dt);
    this.updateCasting(dt);
    this.spells.update(dt);
    this.continuousEffects(dt);
    this.demolition.update(dt, this.cam.target.x, this.cam.target.z, this.cam.viewSize);
    this.particles.update(dt, G.uWind.value);
    this.rain.update(dt, this.precip === 'rain' ? this.rainAmount : 0, this.cam.camera, this.cam.target, this.cam.viewSize, this.cam.dist, G.uWind.value);

    // night lights: the shaders only read them after dusk or in the gloom of rain (uNight)
    const lights = G.uLights.value;
    let n = 0;
    if (night > 0.001) {
      n = this.buildings.lightSources(lights, this.cam.target.x, this.cam.target.z, this.cam.viewSize * 1.5 + 10, night);
      n = this.ships.lightSources(lights, n, this.cam.target.x, this.cam.target.z, this.cam.viewSize * 1.5 + 10, night);
    }
    G.uLightCount.value = n;
    noteLights(n);
    void MAX_LIGHTS;

    this.orders.update(dt);
    {
      const pb = g.priorityOf(g.local);
      const pv = pb ? this.buildings.views.get(pb.id) : undefined;
      this.priority.update(this.time, this.cam.camera, pv?.height ?? 1.5, pv ? pv.group.position.y : pb ? g.world.heightAt(pb.cx, pb.cz) : 0);
    }
    // selection ring
    const U = this.terrain.uniforms;
    if (this.selected) {
      if (this.selected.kind === 'building') {
        const b = g.buildings.get(this.selected.id);
        if (b) U.uSel.value.set(b.cx, 0, b.cz, b.size * 0.75 + 0.3); else { this.selected = null; U.uSel.value.w = 0; }
      } else if (this.selected.kind === 'ship') {
        if (!g.ships.has(this.selected.id)) this.selected = null;
        U.uSel.value.w = 0;
      } else {
        const s = g.settlers.get(this.selected.id);
        if (s && !s.hidden) U.uSel.value.set(s.x, 0, s.z, 0.45); else if (!s) { this.selected = null; U.uSel.value.w = 0; } else U.uSel.value.w = 0;
      }
    } else if (this.teach && this.time < this.teach.until) U.uSel.value.set(this.teach.x, 0, this.teach.z, this.teach.r);
    else { this.teach = null; U.uSel.value.w = 0; }
    const hov = this.brush ?? this.orders.hoverRing(this.selected?.kind === 'building' ? this.selected.id : 0);
    if (hov) {
      U.uHov.value.set(hov.x, 0, hov.z, hov.r);
      const c = U.uHovCol.value as THREE.Color;
      if ('color' in hov) c.setHex(hov.color).multiplyScalar(1.2);
      else if (hov.foe) c.setRGB(1.2, 0.1, 0.05); else c.setRGB(0.8, 0.78, 0.65);
    } else U.uHov.value.w = 0;

    // (programs compiled since the last frame get the lamps' send-on-change)
    cacheSharedUniforms(this.renderer);
    // one matrix update serves the reflection and the view (and its shadow map)
    this.scene.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    this.renderer.shadowMap.autoUpdate = shadowDue;
    perf.end('update', updateT);

    // planar water reflections: only the part of the texture the water in view samples, and only
    // what stands close enough to the water to show in it; between two draws the water keeps the
    // last picture with the matrix and rectangle it was drawn by, so it stays put in the world while
    // the view moves
    const U2 = this.water.uniforms;
    this.waterInView();
    let reflOn = false;
    if (this.settings.reflections) {
      this.reflection.setup(this.cam.camera);
      reflOn = this.waterCells.rect(this.cam.camera, lodView.frustum, this.reflection.textureMatrix, dt, this.reflRect);
      if (reflOn && !this.reflectionCull) this.reflRect.set(0, 0, 1, 1);
    }
    if (reflOn) {
      if (this.reflStale || this.frameNo % this.reflEvery === 0) {
        const reflectionT = perf.begin();
        const reflectionGpu = perf.beginGpu(this.renderer.getContext(), 'reflection');
        const hide = this.reflHide;
        hide.length = 0;
        hide.push(this.water.mesh, this.grass.mesh, this.particles.group, this.rain.mesh, this.markers, this.arrows.mesh, this.arrows.stones);
        // specks in a reflection, and a third of its triangles: settlers, animals, birds, lanterns, border posts
        hide.push(this.settlers.group, this.animals.group, this.pigs.group, this.birds.group, this.lanterns.group, this.borders.posts, this.borders.caps);
        if (this.reflectionCull) this.buildings.dry(hide, reflectionReach(this.cam.camera));
        this.reflection.render(this.renderer, this.scene, hide, this.reflRect);
        perf.endGpu(reflectionGpu);
        perf.end('reflection', reflectionT);
        (U2.uReflMat.value as THREE.Matrix4).copy(this.reflection.textureMatrix);
        // half a texel in, so the filtering never reaches texels that weren't drawn this frame
        const d = this.reflection.drawn, rt = this.reflection.rt;
        (U2.uReflRect.value as THREE.Vector4).set(d.x + 0.5 / rt.width, d.y + 0.5 / rt.height, d.z - 0.5 / rt.width, d.w - 0.5 / rt.height);
        this.reflStale = false;
      }
      U2.uReflOn.value = 1;
    } else { U2.uReflOn.value = 0; this.reflStale = true; }

    const rainI = this.precip === 'rain' ? this.rainAmount : 0;
    const right = this.cameraRight.setFromMatrixColumn(this.cam.camera.matrixWorld, 0);
    const postT = perf.begin();
    this.fx.render(this.time, zoom01, night, rainI, (this.rain.drift.x * right.x + this.rain.drift.y * right.z) / RAIN_FALL);
    if (shadowDue) this.shadowStale = false;
    perf.endGpu(frameGpu);
    perf.end('scene+post', postT);
    this.scene.matrixWorldAutoUpdate = true;
    perf.endFrame(this.renderer, {
      scene: this.scene,
      settings: this.settings,
      resolution: `${this.fx.sceneRT.width}x${this.fx.sceneRT.height}`,
      shadow: `${this.sky.shadow.mapSize.x}x${this.sky.shadow.mapSize.y}`,
      reflection: `${this.reflection.rt.width}x${this.reflection.rt.height} / every ${this.reflEvery} frames`,
      entities: {
        settlers: this.game.settlers.size,
        visibleActors: this.settlers.visibleList.length + this.donkeys.visibleList.length + this.catapults.visibleList.length,
        buildings: this.game.buildings.size, animals: this.game.animals.size, ships: this.game.ships.size, trees: this.game.trees.size,
      },
    });
  }

  /** off: the shadow map keeps its last picture (for comparisons) */
  shadowsLive = true;
  /** the lamps' send-on-change (shaderPatch.ts), switchable for comparisons */
  readonly uniformCache = uniformCache;

  private waterCheckT = 0;
  private waterVisible = false;
  /** Share of the view that is water (drives coastal ambience). */
  waterFrac = 0;
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
    this.waterFrac = n / 169;
    return this.waterVisible;
  }
}

void hash2;
