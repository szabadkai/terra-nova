// Renders 3D models of buildings and goods to small images for the UI.
import * as THREE from 'three';
import { BUILDINGS, BuildingType, GOODS, Good } from '../game/defs';
import { buildingBuilder } from '../render/buildingModels';
import { getMaterial } from '../render/materials';
import { buildGoodGeos } from '../render/models';
import { G } from '../render/shaderPatch';

export const buildingIcons = new Map<string, string>();
export const goodIcons = new Map<Good, string>();

export function generateIcons(owner: number) {
  const size = 144;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x6a5a40, 1.3));
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const fogWas = G.uFogOn.value, lightsWas = G.uLightCount.value, nightWas = G.uNight.value;
  G.uFogOn.value = 0;
  G.uLightCount.value = 0;
  G.uNight.value = 0;

  const shoot = (obj: THREE.Object3D, key: string, map: Map<any, string>, dist = 1) => {
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const rad = Math.max(s.x, s.y * 1.1, s.z) * 0.62 * dist;
    const d = rad / Math.tan((cam.fov * Math.PI) / 360) * 1.05;
    cam.position.set(c.x + d * 0.42, c.y + d * 0.55, c.z + d * 0.72);
    cam.lookAt(c);
    r.render(scene, cam);
    map.set(key, canvas.toDataURL('image/png'));
    scene.remove(obj);
  };

  for (const t of Object.keys(BUILDINGS) as BuildingType[]) {
    const g = buildingBuilder(t, owner).build((k) => getMaterial(k));
    shoot(g, t, buildingIcons);
  }
  const geos = buildGoodGeos();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
  for (const gd of GOODS) {
    const m = new THREE.Mesh(geos[gd], mat);
    if (gd === 'log' || gd === 'board') m.rotation.y = 0.6;
    shoot(m, gd, goodIcons, 1.0);
  }
  G.uFogOn.value = fogWas;
  G.uLightCount.value = lightsWas;
  G.uNight.value = nightWas;
  r.dispose();
  r.forceContextLoss();
}
