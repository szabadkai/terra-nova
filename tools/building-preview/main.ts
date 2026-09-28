// Throwaway viewer for building models (not part of the game build).
// ?types=woodcutter,sawmill  &cols=4  &sp=4.2  &dist=14  &yaw=0.6  &pitch=0.8  &owner=0
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildingBuilder } from '../../src/render/buildingModels';
import { getMaterial } from '../../src/render/materials';
import { G } from '../../src/render/shaderPatch';
import { BUILDINGS, type BuildingType } from '../../src/game/defs';

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
const types = (params.get('types')?.split(',') as BuildingType[] | undefined) ?? all;
const cols = num('cols', Math.ceil(Math.sqrt(types.length)));
const sp = num('sp', 4.4);
const owner = num('owner', 0);
const rows = Math.ceil(types.length / cols);
types.forEach((t, i) => {
  const g = buildingBuilder(t, owner).build((k) => getMaterial(k));
  g.position.set((i % cols - (cols - 1) / 2) * sp, 0, (Math.floor(i / cols) - (rows - 1) / 2) * sp);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
});
const ext = Math.max(cols, rows) * sp;
Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 200 });
sun.position.set(ext * 0.5, ext * 1.1, ext * 0.7);

const cam = new THREE.PerspectiveCamera(num('fov', 36), 1, 0.1, 400);
const view = { yaw: num('yaw', 0.5), pitch: num('pitch', 0.8), dist: num('dist', ext * 1.35), tx: num('tx', 0), ty: num('ty', 0.6), tz: num('tz', 0) };
(window as any).view = (o: Partial<typeof view>) => Object.assign(view, o);
function frame() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  r.setSize(w, h, false);
  cam.aspect = w / h;
  cam.position.set(view.tx + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.ty + Math.sin(view.pitch) * view.dist, view.tz + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
  cam.lookAt(view.tx, view.ty, view.tz);
  cam.updateProjectionMatrix();
  r.render(scene, cam);
  requestAnimationFrame(frame);
}
frame();
