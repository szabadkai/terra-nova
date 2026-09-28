// Shared material library for buildings and props. Every material is shader-patched.
import * as THREE from 'three';
import { patchMaterial, patchedDepthMaterial } from './shaderPatch';
import { brickTex, clothTex, cobbleTex, marbleTex, planksTex, plasterTex, roofTex, rubbleTex, shingleTex, stoneTex, thatchTex, timberTex } from './textures';

export const ROOF_COLORS = [0xb8553a, 0x4d6f9e, 0xc49a3c, 0x7c4f8e];
export const BANNER_COLORS = [0xc8342a, 0x2f6fd0, 0xe0b020, 0x8a3fd0];

type Factory = () => THREE.Material;

const factories: Record<string, Factory> = {};
const base = new Map<string, THREE.Material>();

function std(params: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(params);
}

function def(key: string, f: Factory) {
  factories[key] = f;
}

def('plaster', () => { const t = plasterTex(); return std({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92 }); });
def('plasterWarm', () => { const t = plasterTex(); return std({ map: t.map, normalMap: t.normal, color: 0xf0d8b0, roughness: 0.92 }); });
def('sandstone', () => { const t = stoneTex(); return std({ map: t.map, normalMap: t.normal, color: 0xe8cc98, roughness: 0.9 }); });
def('timber', () => { const t = timberTex(); return std({ map: t.map, normalMap: t.normal, roughness: 0.8 }); });
// rubble masonry is the common building stone; dressed ashlar is kept for quoins, arches and plinths
def('stone', () => { const t = rubbleTex(); return std({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.88 }); });
def('stoneDark', () => { const t = rubbleTex(); return std({ map: t.map, normalMap: t.normal, color: 0xa09a90, roughness: 0.9 }); });
def('ashlar', () => { const t = stoneTex(); return std({ map: t.map, normalMap: t.normal, color: 0xf2eadc, roughness: 0.86 }); });
def('brick', () => { const t = brickTex(); return std({ map: t.map, normalMap: t.normal, roughness: 0.84 }); });
def('planks', () => { const t = planksTex(); return std({ map: t.map, normalMap: t.normal, roughness: 0.82 }); });
def('doorRed', () => { const t = planksTex(); return std({ map: t.map, normalMap: t.normal, color: 0xd05a3c, roughness: 0.7 }); });
// round logs for cabins and piles, with the pale end grain showing where they cross
def('log', () => { const t = timberTex(); return std({ map: t.map, normalMap: t.normal, color: 0xf0c490, roughness: 0.86 }); });
def('endgrain', () => std({ color: 0xc89c68, roughness: 0.9 }));
def('shingle', () => { const t = shingleTex(); return std({ map: t.map, normalMap: t.normal, roughness: 0.9, side: THREE.DoubleSide }); });
def('thatch', () => { const t = thatchTex(); return std({ map: t.map, normalMap: t.normal, color: 0xf4d488, roughness: 0.95, side: THREE.DoubleSide }); });
def('cobble', () => { const t = cobbleTex(); return std({ map: t.map, normalMap: t.normal, roughness: 0.9 }); });
def('dark', () => std({ color: 0x241810, roughness: 0.9 }));
def('wood', () => { const t = planksTex(); return std({ map: t.map, color: 0xb08860, roughness: 0.85 }); });
def('metal', () => std({ color: 0x8a8e94, roughness: 0.35, metalness: 0.85 }));
def('iron', () => std({ color: 0x505458, roughness: 0.5, metalness: 0.7 }));
def('gold', () => std({ color: 0xe0b040, roughness: 0.25, metalness: 1.0 }));
def('canvas', () => { const t = clothTex(); return std({ map: t.map, color: 0xf0e6d0, roughness: 0.9, side: THREE.DoubleSide }); });
def('hay', () => { const t = thatchTex(); return std({ map: t.map, color: 0xe8c870, roughness: 1 }); });
def('leaf', () => std({ color: 0x4f7a2c, roughness: 0.9 }));
def('water', () => std({ color: 0x3a7a9a, roughness: 0.05, metalness: 0.1 }));
def('rock', () => { const t = stoneTex(); return std({ map: t.map, normalMap: t.normal, color: 0x9a9690, roughness: 0.9 }); });
def('soil', () => std({ color: 0x5a4028, roughness: 1 }));
def('pig', () => std({ color: 0xe8a898, roughness: 0.8 }));
def('donkey', () => std({ color: 0x8a7c70, roughness: 0.9 }));
def('donkeyPale', () => std({ color: 0xd8d0c4, roughness: 0.9 }));
def('meat', () => std({ color: 0xa83a30, roughness: 0.6 }));
def('coal', () => std({ color: 0x1c1c1e, roughness: 0.7 }));
def('ironore', () => std({ color: 0x8a4a30, roughness: 0.8 }));
def('goldore', () => std({ color: 0xc8a040, roughness: 0.5, metalness: 0.4 }));
def('window', () => std({ color: 0x28405a, roughness: 0.16, metalness: 0.2, emissive: new THREE.Color(1.0, 0.62, 0.28), emissiveIntensity: 0 }));
def('glowFire', () => std({ color: 0x331100, emissive: new THREE.Color(1.0, 0.45, 0.12), emissiveIntensity: 3.5, roughness: 1 }));
def('glowGold', () => std({ color: 0x331100, emissive: new THREE.Color(1.0, 0.75, 0.2), emissiveIntensity: 2.5, roughness: 1 }));
def('glowHoly', () => std({ color: 0x332a10, emissive: new THREE.Color(1.0, 0.72, 0.38), emissiveIntensity: 2.2, roughness: 1 }));
def('marble', () => { const t = marbleTex(); return std({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.4, 0.4), color: 0xfff9ee, roughness: 0.34 }); });
def('marbleDark', () => { const t = stoneTex(); return std({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.6, 0.6), color: 0xd6cec0, roughness: 0.7 }); });
def('grape', () => std({ color: 0x4a1a4c, roughness: 0.3 }));
def('wine', () => std({ color: 0x4a0c24, roughness: 0.12 }));
def('terracotta', () => std({ color: 0xb4643a, roughness: 0.8 }));
// tarred clinker planking and hemp rope for ships
def('hull', () => { const t = planksTex(); return std({ map: t.map, normalMap: t.normal, color: 0x8a6a4c, roughness: 0.7, side: THREE.DoubleSide }); });
def('rope', () => std({ color: 0x5c4a34, roughness: 0.95 }));
for (let p = 0; p < 4; p++) {
  def(`roof${p}`, () => { const t = roofTex(); return std({ map: t.map, normalMap: t.normal, color: ROOF_COLORS[p], roughness: 0.72, side: THREE.DoubleSide }); });
  def(`banner${p}`, () => { const t = clothTex(); return std({ map: t.map, color: BANNER_COLORS[p], roughness: 0.85, side: THREE.DoubleSide }); });
  def(`trim${p}`, () => std({ color: BANNER_COLORS[p], roughness: 0.6 }));
}

const WIND_MATS = new Set(['banner0', 'banner1', 'banner2', 'banner3', 'canvasFlag']);

const NO_SNOW = new Set(['window', 'glowFire', 'glowGold', 'glowHoly', 'water', 'wine', 'metal', 'iron', 'gold']);
const GRIME = new Set(['plaster', 'plasterWarm', 'sandstone', 'timber', 'stone', 'stoneDark', 'ashlar', 'brick', 'log', 'doorRed', 'planks', 'marble', 'marbleDark', 'wood']);
// ships float: no snow on the hull sides, no ground grime
function patchOpts(key: string, clip: boolean) {
  const snow = NO_SNOW.has(key) || WIND_MATS.has(key) ? 0 : 1;
  const grime = GRIME.has(key) ? (key.startsWith('marble') ? 0.6 : 1) : 0;
  return { clip, wind: WIND_MATS.has(key) ? ('flag' as const) : ('none' as const), key: `bld_${key}`, snow, grime };
}

export function getMaterial(key: string): THREE.Material {
  let m = base.get(key);
  if (!m) {
    const f = factories[key] ?? factories.plaster;
    m = f();
    patchMaterial(m, patchOpts(key, false));
    base.set(key, m);
  }
  return m;
}

/** A fresh clipped copy for construction sites. */
export function getClipMaterial(key: string): THREE.Material {
  const f = factories[key] ?? factories.plaster;
  const m = f();
  patchMaterial(m, patchOpts(key, true));
  return m;
}

/** A fresh copy for a burning building, so its charring and ember glow can be animated on their own. */
export function getBurnMaterial(key: string): THREE.MeshStandardMaterial {
  const f = factories[key] ?? factories.plaster;
  const m = f() as THREE.MeshStandardMaterial;
  patchMaterial(m, patchOpts(key, false));
  return m;
}

export const flagDepth = patchedDepthMaterial({ wind: 'none' });

/** Night window glow intensity for all window materials. */
export function setWindowGlow(v: number) {
  const m = base.get('window') as THREE.MeshStandardMaterial | undefined;
  if (m) m.emissiveIntensity = v;
}
