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
const settlers = new Map<number, any>();
jobs.forEach((job, i) => {
  const id = Number(params.get('id0') ?? 1) + i;
  settlers.set(id, {
    id, owner: Number(params.get('owner') ?? 0), job, x: (i - (jobs.length - 1) / 2) * Number(params.get('sp') ?? 0.55), z: 0, heading: Number(params.get('heading') ?? 0),
    hidden: false, next: anim === 'walk' ? 1 : -1, stepDur: 0.6, anim, animT: 0, carrying: params.get('carry') || null,
    dead: false, deadT: 0, seed: ((id * 0.6180339) % 1), level: 0,
  });
});
const game: any = {
  settlers, local: 0, players: [{ id: 0, color: 0xc8342a }, { id: 1, color: 0x2f6fd0 }, { id: 2 }, { id: 3 }],
  world: { heightAt: () => 0, explored: [1], idx: () => 0 },
};
const sr = new SettlersRenderer(game, buildGoodGeos());
scene.add(sr.group);
(window as any).sr = sr;

const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
const view = { yaw: 0, pitch: 0.25, dist: 3.5, tx: 0, ty: 0.38, tz: 0 };
(window as any).view = (o: Partial<typeof view>) => Object.assign(view, o);
for (const k of Object.keys(view)) if (params.has(k)) (view as any)[k] = Number(params.get(k));
let time = 0, last = performance.now();
(window as any).freeze = false;
function frame() {
  const now = performance.now();
  const dt = (window as any).freeze ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  for (const s of settlers.values()) s.animT += dt;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  r.setSize(w, h, false);
  cam.aspect = w / h;
  cam.position.set(view.tx + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.ty + Math.sin(view.pitch) * view.dist, view.tz + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
  cam.lookAt(view.tx, view.ty, view.tz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  sr.update(dt, time, cam);
  r.render(scene, cam);
  requestAnimationFrame(frame);
}
frame();
