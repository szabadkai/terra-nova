// Throwaway viewer for building models (not part of the game build).
// ?types=woodcutter,sawmill  &cols=4  &sp=4.2  &dist=14  &yaw=0.6  &pitch=0.8  &owner=0
// ?work=toolsmith,ironsmelter: the workshop's worker at work in the yard (src/render/work.ts), looping
//   its production cycle; &stall=input|full|exhausted shows him waiting instead; &speed=0.5 slows it.
//   step(secs) and sheet(n, every, cols) drive it by hand (a hidden pane never fires rAF).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildingBuilder } from '../../src/render/buildingModels';
import { getMaterial } from '../../src/render/materials';
import { G } from '../../src/render/shaderPatch';
import { BUILDINGS, emptyStock, type BuildingType, type Job } from '../../src/game/defs';
import { SettlersRenderer } from '../../src/render/settlers';
import { buildGoodGeos } from '../../src/render/models';
import { Particles } from '../../src/render/particles';
import type { WorkView } from '../../src/render/work';
import { lodReady, lodView } from '../../src/render/lod';

G.uFogOn.value = 0;
G.uCloud.value = 0;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.toneMapping = THREE.ACESFilmicToneMapping;
r.outputColorSpace = THREE.SRGBColorSpace;
r.shadowMap.enabled = true;
r.shadowMap.type = THREE.PCFSoftShadowMap;
r.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb0d0);
const pm = new THREE.PMREMGenerator(r);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const sun = new THREE.DirectionalLight(0xfff0e0, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x8cb2ff, 0x5a4a30, 0.95));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x4a7228, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const all = Object.keys(BUILDINGS) as BuildingType[];
const work = params.get('work')?.split(',') as BuildingType[] | undefined;
const types = work ?? (params.get('types')?.split(',') as BuildingType[] | undefined) ?? all;
const cols = num('cols', Math.ceil(Math.sqrt(types.length)));
const sp = num('sp', 4.4);
const owner = num('owner', 0);
const rows = Math.ceil(types.length / cols);
const views = new Map<number, WorkView>();
const buildings = new Map<number, any>();
const settlers = new Map<number, any>();
types.forEach((t, i) => {
  const mb = buildingBuilder(t, owner);
  const g = mb.build((k) => getMaterial(k));
  const x = (i % cols - (cols - 1) / 2) * sp, z = (Math.floor(i / cols) - (rows - 1) / 2) * sp;
  g.position.set(x, 0, z);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  if (!work) return;
  const id = i + 1, sid = 100 + i;
  const movers: THREE.Object3D[] = [];
  g.traverse((o) => { if (o.name) movers.push(o); });
  views.set(id, { y: 0, anchors: mb.anchors, movers, visible: true });
  const def = BUILDINGS[t];
  const recruit = t === 'barracks';
  buildings.set(id, {
    id, type: t, def, owner, cx: x, cz: z, size: def.size, state: 'done', worker: recruit ? 0 : sid, workerIncoming: recruit ? sid : 0,
    working: !recruit, workT: (i * 1.7) % (def.cycle ?? 6),
    stock: emptyStock(), stall: null, stallT: 0, curOut: def.outputs?.[i % (def.outputs?.length ?? 1)], shipProgress: 0,
  });
  settlers.set(sid, {
    id: sid, owner, job: (def.worker ?? 'carrier') as Job, x, z, heading: 0, hidden: true, inside: id, aboard: 0, next: -1, stepDur: 0.6,
    anim: 'idle', animT: 0, carrying: recruit ? 'sword' : null, dead: false, deadT: 0, seed: (sid * 0.6180339) % 1, level: 0,
    idle: false, actions: recruit ? [{ k: 'wait', dur: def.cycle ?? 6, t: 0 }] : [], sstate: 'idle', engaged: 0, home: id, wanderT: 0,
  });
});
const ext = Math.max(cols, rows) * sp;
Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 200 });
sun.position.set(ext * 0.5, ext * 1.1, ext * 0.7);

const game: any = {
  settlers, buildings, local: 0, time: 0,
  players: [{ id: 0, color: 0xc8342a }, { id: 1, color: 0x2f6fd0 }, { id: 2 }, { id: 3 }],
  world: { heightAt: () => 0, explored: [1], idx: () => 0 },
};
let sr: SettlersRenderer | null = null;
const particles = new Particles();
const stall = params.get('stall');
const speed = num('speed', 1);
if (work) {
  await lodReady;
  sr = new SettlersRenderer(game, buildGoodGeos());
  sr.work.force = true;
  sr.work.host = { workView: (id) => views.get(id) ?? null };
  sr.work.fx = particles;
  scene.add(sr.group, particles.group);
  if (stall) for (const b of buildings.values()) { b.working = false; b.stall = stall === 'input' ? { kind: 'input', goods: b.def.inputs?.[0]?.goods ?? ['iron'] } : { kind: stall }; b.stallT = -10; }
  (window as any).sr = sr;
}
(window as any).game = game;

/** one production tick of the fake workshops: the cycle loops, the pile takes the good, a carrier takes one away now and then */
function tick(dt: number) {
  game.time += dt;
  for (const b of buildings.values()) {
    if (b.type === 'barracks') {
      // a recruit trains, then the next one comes in (swords and bows by turns)
      const s = settlers.get(b.workerIncoming), a = s?.actions[0];
      if (a) { a.t += dt; if (a.t >= a.dur) { a.t -= a.dur; s.carrying = s.carrying === 'sword' ? 'bow' : 'sword'; } }
      continue;
    }
    if (!b.working) continue;
    b.workT += dt;
    if (b.workT >= b.def.cycle) {
      b.workT -= b.def.cycle;
      if (b.type === 'siegeworks') b.shipProgress = (Math.round(b.shipProgress * 4) + 1) % 4 / 4;
      const out = b.curOut ?? b.def.outputs?.[0];
      if (out) b.stock[out] = (b.stock[out] + 1) % 5;
      const outs = b.def.outputs ?? [];
      b.curOut = outs[(outs.indexOf(out) + 1) % Math.max(1, outs.length)];
    }
  }
}

const cam = new THREE.PerspectiveCamera(num('fov', 36), 1, 0.1, 400);
const view = { yaw: num('yaw', 0.5), pitch: num('pitch', 0.8), dist: num('dist', ext * 1.35), tx: num('tx', 0), ty: num('ty', 0.6), tz: num('tz', 0) };
(window as any).view = (o: Partial<typeof view>) => Object.assign(view, o);
/** at(i, dist, dz): look at the i-th building from `dist` away, dz in front of its middle */
(window as any).at = (i: number, dist = 3, dz = 0.7) => Object.assign(view, { dist, tx: (i % cols - (cols - 1) / 2) * sp, tz: (Math.floor(i / cols) - (rows - 1) / 2) * sp + dz, ty: 0.3 });
let time = 0, last = performance.now();
(window as any).freeze = false;
function draw(dt: number) {
  time += dt;
  G.uTime.value = time;
  tick(dt * speed);
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  r.setSize(w, h, false);
  cam.aspect = w / h;
  cam.position.set(view.tx + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.ty + Math.sin(view.pitch) * view.dist, view.tz + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
  cam.lookAt(view.tx, view.ty, view.tz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  lodView.update(cam, h * r.getPixelRatio(), null);
  if (sr) {
    sr.update(dt, time, cam);
    particles.setScale((h * r.getPixelRatio()) / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    particles.update(dt * speed, new THREE.Vector2(0.3, 0.1));
  }
  r.render(scene, cam);
}
/** step(seconds, dt): advance by hand */
(window as any).step = (secs: number, dt = 1 / 30) => {
  for (let t = 0; t < secs - 1e-6; t += dt) draw(dt);
  draw(0);
  return game.time;
};
/** sheet(n, every, cols): a contact sheet of n frames `every` seconds apart over the canvas; unsheet() hides it */
(window as any).sheet = (n: number, every: number, cols = 2) => {
  let ov = document.getElementById('sheet') as HTMLCanvasElement | null;
  if (!ov) {
    ov = document.createElement('canvas');
    ov.id = 'sheet';
    ov.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;background:#000';
    document.body.appendChild(ov);
  }
  ov.style.display = 'block';
  const rws = Math.ceil(n / cols);
  ov.width = canvas.width;
  ov.height = canvas.height;
  const cw = ov.width / cols, ch = ov.height / rws, x = ov.getContext('2d')!;
  for (let k = 0; k < n; k++) {
    (window as any).step(every);
    x.drawImage(canvas, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch);
    x.fillStyle = '#fff';
    x.font = `${Math.round(ch / 14)}px sans-serif`;
    x.fillText(game.time.toFixed(2), (k % cols) * cw + 8, Math.floor(k / cols) * ch + ch / 12);
  }
  return game.time;
};
/** snap(name): POST the canvas (or the contact sheet) as a JPEG to a dev server's /__snap receiver, if it has one */
(window as any).snap = async (name: string) => {
  const sh = document.getElementById('sheet') as HTMLCanvasElement | null;
  const c = sh && sh.style.display === 'block' ? sh : canvas;
  await fetch('/__snap?name=' + name, { method: 'POST', body: c.toDataURL('image/jpeg', 0.85) });
  return name;
};
(window as any).unsheet = () => { const ov = document.getElementById('sheet'); if (ov) ov.style.display = 'none'; };
function frame() {
  const now = performance.now();
  const dt = (window as any).freeze ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  draw(dt);
  requestAnimationFrame(frame);
}
frame();
