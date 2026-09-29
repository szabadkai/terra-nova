// Renders 3D models of buildings and goods to small images for the UI.
import * as THREE from 'three';
import { BUILDINGS, BuildingType, GOODS, Good } from '../game/defs';
import { buildingBuilder } from '../render/buildingModels';
import { getMaterial } from '../render/materials';
import { buildGoodGeos } from '../render/models';
import { G } from '../render/shaderPatch';

export const buildingIcons = new Map<string, string>();
export const goodIcons = new Map<Good, string>();

/**
 * Draw the icons in `owner`'s colours, one at a time with a `pause` after each (the first drawing of
 * each building builds its model too, which takes a while), until they are all done or `cancelled`.
 */
export async function generateIcons(owner: number, pause: () => Promise<void> = () => Promise.resolve(), cancelled: () => boolean = () => false) {
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

  const shoot = async (obj: THREE.Object3D, key: string, map: Map<any, string>, dist = 1) => {
    // (its shaders first, compiled in parallel where the browser can, so the drawing does not wait on them)
    await r.compileAsync(obj, cam, scene);
    if (cancelled()) return;
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const rad = Math.max(s.x, s.y * 1.1, s.z) * 0.62 * dist;
    const d = rad / Math.tan((cam.fov * Math.PI) / 360) * 1.05;
    cam.position.set(c.x + d * 0.42, c.y + d * 0.55, c.z + d * 0.72);
    cam.lookAt(c);
    // no fog, grime, lamps or night on the icons; the uniforms are shared with the world, which is
    // drawn between two icons, so they are put back at once
    const was = [G.uFogOn.value, G.uGrime.value, G.uLightCount.value, G.uNight.value];
    G.uFogOn.value = 0;
    G.uGrime.value = 0;
    G.uLightCount.value = 0;
    G.uNight.value = 0;
    try {
      r.render(scene, cam);
    } finally {
      [G.uFogOn.value, G.uGrime.value, G.uLightCount.value, G.uNight.value] = was;
    }
    map.set(key, canvas.toDataURL('image/png'));
    scene.remove(obj);
  };

  try {
    for (const t of Object.keys(BUILDINGS) as BuildingType[]) {
      if (cancelled()) return;
      const g = buildingBuilder(t, owner).build((k) => getMaterial(k));
      await shoot(g, t, buildingIcons);
      await pause();
    }
    const geos = buildGoodGeos();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    for (const gd of GOODS) {
      if (cancelled()) return;
      const m = new THREE.Mesh(geos[gd], mat);
      if (gd === 'log' || gd === 'board') m.rotation.y = 0.6;
      await shoot(m, gd, goodIcons, 1.0);
      await pause();
    }
  } finally {
    r.dispose();
    r.forceContextLoss();
  }
}
