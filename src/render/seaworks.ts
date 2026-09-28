// Per-site harbour works that depend on where the sea is: a jetty out to the dock for harbours,
// a slipway with a hull taking shape plank by plank for shipyards.
import * as THREE from 'three';
import { SHIP_BOARDS } from '../game/defs';
import type { Game } from '../game/game';
import type { Building } from '../game/types';
import { WATER_LEVEL } from '../game/world';
import { ModelBuilder, box, cyl } from './geom';
import { getMaterial } from './materials';
import { hullRibs, hullStrake } from './shipModels';

export interface Seaworks {
  group: THREE.Group;
  fires: THREE.Vector3[];
  strakes: THREE.Object3D[];
  hull: THREE.Object3D | null;
}

const strakeGeos: THREE.BufferGeometry[][] = [];
function strakeGeo(k: number) {
  if (!strakeGeos[k]) strakeGeos[k] = hullStrake(k, SHIP_BOARDS);
  return strakeGeos[k];
}
let ribsModel: ModelBuilder | null = null;

/** A squared timber from a to b. */
function beam(mb: ModelBuilder, mat: string, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const len = a.distanceTo(b);
  const g = box(w, h, len + 0.02, 2);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  mb.add(mat, g, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** Build in the building group's local space (origin at centre, y = base height). */
export function buildSeaworks(g: Game, b: Building, baseY: number): Seaworks | null {
  if (b.dock < 0 || (b.type !== 'harbour' && b.type !== 'shipyard')) return null;
  const w = g.world;
  const dx = w.nx(b.dock) - b.cx, dz = w.ny(b.dock) - b.cz;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const ang = Math.atan2(ux, uz);
  const start = b.size * 0.42;
  const end = len + (b.type === 'harbour' ? -0.45 : 0.2);
  const ground = (t: number) => w.heightAt(b.cx + ux * t, b.cz + uz * t);
  const L = (x: number, z: number): [number, number] => [x, z]; // local coords are world offsets
  const mb = new ModelBuilder();
  const fires: THREE.Vector3[] = [];
  const out: Seaworks = { group: new THREE.Group(), fires, strakes: [], hull: null };
  const at = (t: number, side: number) => L(ux * t + uz * side, uz * t - ux * side);

  if (b.type === 'harbour') {
    const deck = WATER_LEVEL + 0.3 - baseY;
    // boards lie on the beach until the jetty leaves the shore
    const deckAt = (t: number) => Math.max(deck, ground(t) - baseY + 0.04);
    // planking across the jetty
    for (let t = start; t < end; t += 0.16) {
      const [x, z] = at(t, 0);
      mb.add('planks', box(0.78, 0.035, 0.14, 3), x, deckAt(t), z, ang + (Math.sin(t * 13) * 0.02));
    }
    // stringers and piles down to the seabed
    for (const side of [-0.34, 0.34]) {
      for (let t = start; t < end; t += 0.5) {
        const [x, z] = at(t, side);
        const top = deckAt(t) - 0.02;
        mb.add('timber', box(0.05, 0.05, 0.52, 2), x, top, z, ang);
        const bed = ground(t) - baseY - 0.15;
        if (top - bed > 0.08) mb.add('timber', cyl(0.045, 0.05, top - bed, 8, 2), x, bed, z);
      }
    }
    // bollards and a lantern at the head of the jetty
    for (const side of [-0.3, 0.3]) {
      const [x, z] = at(end - 0.25, side);
      mb.add('timber', cyl(0.05, 0.06, 0.16, 8, 2), x, deck, z);
      mb.add('timber', cyl(0.065, 0.065, 0.03, 8), x, deck + 0.16, z);
    }
    const [lx, lz] = at(end - 0.08, -0.36);
    mb.add('timber', box(0.05, 0.62, 0.05, 2), lx, deck + 0.31, lz);
    mb.add('timber', box(0.2, 0.04, 0.04), lx + uz * 0.08, deck + 0.6, lz - ux * 0.08, ang + Math.PI / 2);
    mb.add('glowFire', box(0.07, 0.09, 0.07), lx + uz * 0.16, deck + 0.52, lz - ux * 0.16);
    fires.push(new THREE.Vector3(lx + uz * 0.16, deck + 0.55, lz - ux * 0.16));
    // mooring ring and a coil of rope
    const [cx, cz] = at(end - 0.6, 0.18);
    mb.add('rope', new THREE.TorusGeometry(0.07, 0.022, 5, 12), cx, deck + 0.03, cz, 0, Math.PI / 2, 0);
  } else {
    // slipway: two greased ways running down into the water
    const top = ground(start) - baseY + 0.02;
    const bottom = WATER_LEVEL - 0.45 - baseY;
    const slope = (t: number) => top + (bottom - top) * Math.max(0, Math.min(1, (t - start) / (end - start)));
    for (const side of [-0.26, 0.26]) {
      const [x1, z1] = at(start, side), [x2, z2] = at(end, side);
      beam(mb, 'timber', new THREE.Vector3(x1, slope(start), z1), new THREE.Vector3(x2, slope(end), z2), 0.07, 0.06);
    }
    for (let t = start; t < end; t += 0.32) {
      const [x, z] = at(t, 0);
      mb.add('timber', box(0.7, 0.05, 0.08, 2), x, slope(t) - 0.04, z, ang);
    }
    // the hull on its cradle, bow to the sea
    const ht = start + Math.min(1.25, (end - start) * 0.42);
    const [hx, hz] = at(ht, 0);
    const hy = Math.max(slope(ht), WATER_LEVEL - baseY - 0.05) + 0.3;
    for (const t of [-0.7, 0, 0.7]) for (const side of [-0.2, 0.2]) {
      const [px, pz] = at(ht + t, side);
      const foot = slope(ht + t);
      const hh = Math.max(0.04, hy - 0.18 - foot);
      mb.add('timber', box(0.05, hh, 0.05), px, foot + hh / 2, pz);
    }
    const hull = new THREE.Group();
    hull.position.set(hx, hy, hz);
    hull.rotation.set(Math.atan2(top - bottom, end - start) * 0.25, ang, 0, 'YXZ');
    if (!ribsModel) { ribsModel = new ModelBuilder(); hullRibs(ribsModel, 'timber'); }
    const ribs = ribsModel.build((k) => getMaterial(k));
    hull.add(ribs);
    const mat = getMaterial('hull');
    for (let k = 0; k < SHIP_BOARDS; k++) {
      const sg = new THREE.Group();
      for (const geo of strakeGeo(SHIP_BOARDS - 1 - k)) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.matKey = 'hull';
        sg.add(m);
      }
      sg.visible = false;
      hull.add(sg);
      out.strakes.push(sg);
    }
    out.hull = hull;
    out.group.add(hull);
  }
  const built = mb.build((k) => getMaterial(k));
  built.userData.own = true; // per-site geometry: dispose with the building
  out.group.add(built);
  return out;
}

/** Show the strakes laid so far: keel upwards, one per board. */
export function showHullProgress(sw: Seaworks, progress: number, active: boolean) {
  if (!sw.hull) return;
  sw.hull.visible = active;
  const n = Math.round(progress * SHIP_BOARDS);
  sw.strakes.forEach((s, k) => { s.visible = k < n; });
}
