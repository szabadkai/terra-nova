// Lantern posts beside every finished building's door. By day they are a small prop; after dusk
// the lantern of an inhabited building is lit, flickers a little and throws a warm pool of light,
// so the settlement reads at a glance through the night.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../game/game';
import type { Building } from '../game/types';
import type { BuildingsRenderer } from './buildings';
import { patchMaterial } from './shaderPatch';
import { commitInstances } from './instancing';

const MAX = 600;
/** height of the lantern glass above the ground, and how far it hangs out from the post */
const GLASS_Y = 0.535, ARM = 0.17;
/** drawn a little larger than life, like the settlers */
const SCALE = 1.25;

function part(geo: THREE.BufferGeometry, hex: number, x: number, y: number, z: number, ry = 0) {
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function frameGeo() {
  const WOOD = 0x4a3526, IRON = 0x2b2a2e, STONE = 0x7a756c;
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const parts = [
    part(box(0.11, 0.05, 0.11), STONE, 0, 0.02, 0),
    part(box(0.045, 0.72, 0.045), WOOD, 0, 0.37, 0),
    part(box(0.21, 0.03, 0.032), WOOD, 0.085, 0.69, 0),
    // brace under the arm
    part(box(0.12, 0.022, 0.024), WOOD, 0.045, 0.64, 0),
    part(box(0.012, 0.05, 0.012), IRON, ARM, 0.655, 0),
    part(new THREE.ConeGeometry(0.056, 0.05, 4), IRON, ARM, 0.615, 0, Math.PI / 4),
    part(box(0.078, 0.014, 0.078), IRON, ARM, 0.587, 0),
    part(box(0.078, 0.014, 0.078), IRON, ARM, GLASS_Y - 0.05, 0),
  ];
  // the brace runs diagonally from the post up to the arm
  const brace = parts[3];
  brace.translate(-0.045, -0.64, 0);
  brace.rotateZ(0.6);
  brace.translate(0.045, 0.64, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push(part(box(0.01, 0.09, 0.01), IRON, ARM + sx * 0.032, GLASS_Y, sz * 0.032));
  return mergeGeometries(parts)!;
}

/** Where a building's lantern hangs (world space), or null when it has none. */
export function lanternSpot(g: Game, b: Building, out = new THREE.Vector3()): THREE.Vector3 | null {
  const w = g.world;
  // just beside the path to the door, on the side away from the stock piles
  const x = b.x + (b.size >> 1) - 0.6, z = b.y + b.size - (b.size >= 4 ? 0.1 : 0.3);
  const ix = Math.round(x), iz = Math.round(z);
  if (ix < 0 || iz < 0 || ix >= w.W || iz >= w.H || w.isWater(w.idx(ix, iz))) return null;
  return out.set(x + ARM * SCALE, w.heightAt(x, z) + GLASS_Y * SCALE, z);
}

/** Lit once someone lives or works there: an empty hut stays dark. */
export function lanternLit(b: Building) {
  if (b.def.military) return b.garrison.length > 0;
  return !!(b.worker || b.working || b.def.residence || b.def.storage);
}

export class LanternsRenderer {
  group = new THREE.Group();
  private frames: THREE.InstancedMesh;
  private glass: THREE.InstancedMesh;
  private t = 0;

  constructor(private game: Game, private buildings: BuildingsRenderer) {
    const fm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    patchMaterial(fm, { key: 'lanternpost', snow: 1 });
    this.frames = new THREE.InstancedMesh(frameGeo(), fm, MAX);
    this.frames.castShadow = true;
    this.frames.receiveShadow = true;
    const gm = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.25, emissive: new THREE.Color(1, 1, 1) });
    patchMaterial(gm, {
      key: 'lanternglass',
      // instance colour: white = lit, grey = dark; the flame wavers a little
      fragEmissive: `{
    float fl = 0.86 + 0.14 * sin(uTime * 8.3 + vWPos.x * 7.1 + vWPos.z * 3.3) * sin(uTime * 5.1 + vWPos.z * 5.7);
    float lit = 1.0;
    #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
      lit = step(0.9, vColor.r);
    #endif
    totalEmissiveRadiance = vec3(1.0, 0.6, 0.26) * lit * fl * (0.04 + smoothstep(0.12, 0.55, uNight) * 3.6);
  }`,
    });
    const gg = new THREE.BoxGeometry(0.058, 0.086, 0.058);
    gg.translate(ARM, GLASS_Y, 0);
    this.glass = new THREE.InstancedMesh(gg, gm, MAX);
    for (const m of [this.frames, this.glass]) {
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    this.glass.castShadow = false;
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const g = this.game;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const lit = new THREE.Color(1, 1, 1), dark = new THREE.Color(0.35, 0.35, 0.35);
    let n = 0;
    for (const v of this.buildings.views.values()) {
      if (n >= MAX) break;
      const b = g.buildings.get(v.id);
      if (!b || b.state !== 'done' || !v.group.visible) continue;
      if (!lanternSpot(g, b, p)) continue;
      m.makeScale(SCALE, SCALE, SCALE).setPosition(p.x - ARM * SCALE, p.y - GLASS_Y * SCALE, p.z);
      this.frames.setMatrixAt(n, m);
      this.glass.setMatrixAt(n, m);
      this.glass.setColorAt(n, lanternLit(b) ? lit : dark);
      n++;
    }
    commitInstances(this.frames, n);
    commitInstances(this.glass, n);
  }
}
