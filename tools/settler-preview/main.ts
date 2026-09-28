// Throwaway close-up viewer for settler models (not part of the game build).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SettlersRenderer } from '../../src/render/settlers';
import { buildGoodGeos } from '../../src/render/models';
import { G } from '../../src/render/shaderPatch';
import type { Job } from '../../src/game/defs';

G.uFogOn.value = 0;
G.uCloud.value = 0;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true });
r.toneMapping = THREE.ACESFilmicToneMapping;
r.outputColorSpace = THREE.SRGBColorSpace;
r.shadowMap.enabled = true;
r.setPixelRatio(2);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb0d0);
const pm = new THREE.PMREMGenerator(r);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const sun = new THREE.DirectionalLight(0xfff4e8, 3.2);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x8cb2ff, 0x5a4a30, 0.95));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x4f7a2a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const params = new URLSearchParams(location.search);
const jobs = (params.get('jobs') ?? 'carrier,carrier,carrier,carrier,builder,woodcutter,farmer,baker,miner,butcher,hunter,swordsman').split(',') as Job[];
const anim = params.get('anim') ?? 'idle';
// ?idle=violin,flute,.. (pastimes in src/render/idle.ts, one per settler in turn) or ?idle=auto to let them choose
const idle = params.get('idle');
const zs = (params.get('zs') ?? '').split(',').map(Number);
const settlers = new Map<number, any>();
jobs.forEach((job, i) => {
  const id = Number(params.get('id0') ?? 1) + i;
  settlers.set(id, {
    id, owner: Number(params.get('owner') ?? 0), job, x: (i - (jobs.length - 1) / 2) * Number(params.get('sp') ?? 0.55), z: zs[i] || 0, heading: Number(params.get('heading') ?? 0),
    hidden: false, next: anim === 'walk' ? 1 : -1, stepDur: 0.6, anim, animT: 0, carrying: params.get('carry') || null,
    dead: false, deadT: 0, seed: ((id * 0.6180339) % 1), level: 0,
    idle: !!idle, actions: [], sstate: 'idle', engaged: 0, home: 0, aboard: 0, wanderT: 1e9,
  });
});
const game: any = {
  settlers, local: 0, players: [{ id: 0, color: 0xc8342a }, { id: 1, color: 0x2f6fd0 }, { id: 2 }, { id: 3 }],
  world: { heightAt: () => 0, explored: [1], idx: () => 0 },
  time: 0,
};
const sr = new SettlersRenderer(game, buildGoodGeos());
scene.add(sr.group);
if (idle && idle !== 'auto') {
  const acts = idle.split(',');
  const ids = [...settlers.keys()];
  sr.idle.force = (s) => acts[ids.indexOf(s.id) % acts.length] as never;
}
sr.idle.rain = Number(params.get('rain') ?? 0);
G.uSnow.value = Number(params.get('snow') ?? 0);
G.uNight.value = Number(params.get('night') ?? 0);
(window as any).sr = sr;
(window as any).game = game;

const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
const view = { yaw: 0, pitch: 0.25, dist: 3.5, tx: 0, ty: 0.38, tz: 0 };
(window as any).view = (o: Partial<typeof view>) => Object.assign(view, o);
for (const k of Object.keys(view)) if (params.has(k)) (view as any)[k] = Number(params.get(k));
let time = 0, last = performance.now();
(window as any).freeze = false;
function draw(dt: number) {
  time += dt;
  game.time += dt;
  for (const s of settlers.values()) s.animT += dt;
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  r.setSize(w, h, false);
  cam.aspect = w / h;
  cam.position.set(view.tx + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.ty + Math.sin(view.pitch) * view.dist, view.tz + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
  cam.lookAt(view.tx, view.ty, view.tz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  sr.update(dt, time, cam);
  sr.idle.setScale((h * 2) / (2 * Math.tan((cam.fov * Math.PI) / 360)));
  r.render(scene, cam);
}
/** step(seconds, dt): advance the preview by hand (a hidden pane never fires requestAnimationFrame) */
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
  const rows = Math.ceil(n / cols);
  ov.width = canvas.width;
  ov.height = canvas.height;
  const cw = ov.width / cols, ch = ov.height / rows, x = ov.getContext('2d')!;
  for (let k = 0; k < n; k++) {
    (window as any).step(every);
    x.drawImage(canvas, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch);
    x.fillStyle = '#fff';
    x.font = `${Math.round(ch / 14)}px sans-serif`;
    x.fillText(game.time.toFixed(2), (k % cols) * cw + 8, Math.floor(k / cols) * ch + ch / 12);
  }
  return game.time;
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
