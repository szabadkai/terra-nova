// Geometry helpers with world-scaled UVs, plus a model builder that merges parts per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function box(w: number, h: number, d: number, uvs = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] * uvs, uv.getY(i) * dims[f][1] * uvs);
    }
  }
  return g;
}

/** Gable roof: ridge along X, ridge height h above the wall top. The slope passes
 * exactly through the wall line so the gable triangles close the gap. */
export function gableRoof(w: number, d: number, h: number, over = 0.12, uvs = 1) {
  const gw = w / 2, gd = d / 2;
  const hw = gw + over, hd = gd + over;
  const eave = -over * h / gd;
  const slopeLen = Math.hypot(hd, h - eave);
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], e: number[], uA: number[], uB: number[], uC: number[], uE: number[]) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...e);
    uv.push(...uA, ...uB, ...uC, ...uA, ...uC, ...uE);
  };
  const t = 0.05;
  const W = (w + over * 2) * uvs;
  quad([-hw, eave, hd], [hw, eave, hd], [hw, h, 0], [-hw, h, 0], [0, 0], [W, 0], [W, slopeLen * uvs], [0, slopeLen * uvs]);
  quad([hw, eave, -hd], [-hw, eave, -hd], [-hw, h, 0], [hw, h, 0], [0, 0], [W, 0], [W, slopeLen * uvs], [0, slopeLen * uvs]);
  // eave thickness
  quad([-hw, eave - t, hd], [hw, eave - t, hd], [hw, eave, hd], [-hw, eave, hd], [0, 0], [W, 0], [W, 0.05], [0, 0.05]);
  quad([hw, eave - t, -hd], [-hw, eave - t, -hd], [-hw, eave, -hd], [hw, eave, -hd], [0, 0], [W, 0], [W, 0.05], [0, 0.05]);
  // verge thickness at the gable ends
  quad([hw, eave - t, hd], [hw, eave - t, -hd], [hw, h - t, 0], [hw, h - t, 0], [0, 0], [1, 0], [0.5, 0.5], [0.5, 0.5]);
  quad([hw, eave, hd], [hw, eave - t, hd], [hw, h - t, 0], [hw, h, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  quad([hw, eave - t, -hd], [hw, eave, -hd], [hw, h, 0], [hw, h - t, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  quad([-hw, eave - t, -hd], [-hw, eave, -hd], [-hw, h, 0], [-hw, h - t, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  quad([-hw, eave, hd], [-hw, eave - t, hd], [-hw, h - t, 0], [-hw, h, 0], [0, 0], [0.05, 0], [0.05, 1], [0, 1]);
  // underside
  quad([-hw, eave - t, hd], [-hw, h - t, 0], [hw, h - t, 0], [hw, eave - t, hd], [0, 0], [0, 1], [1, 1], [1, 0]);
  quad([hw, eave - t, -hd], [hw, h - t, 0], [-hw, h - t, 0], [-hw, eave - t, -hd], [0, 0], [0, 1], [1, 1], [1, 0]);
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roof.computeVertexNormals();
  const gp: number[] = [], gu: number[] = [];
  const tri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) => {
    gp.push(...a, ...b, ...c);
    gu.push(...ua, ...ub, ...uc);
  };
  tri([gw, 0, gd], [gw, 0, -gd], [gw, h, 0], [0, 0], [d * uvs, 0], [gd * uvs, h * uvs]);
  tri([-gw, 0, -gd], [-gw, 0, gd], [-gw, h, 0], [0, 0], [d * uvs, 0], [gd * uvs, h * uvs]);
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  gable.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
  gable.computeVertexNormals();
  return { roof, gable, gableH: h };
}

/** Pyramid / hip roof over w x d with apex height h above the wall top. */
export function pyramidRoof(w: number, d: number, h: number, over = 0.1, uvs = 1, ridge = 0) {
  const gw = w / 2, gd = d / 2;
  const hw = gw + over, hd = gd + over;
  const eave = -over * h / Math.min(gw, gd);
  const r = ridge / 2;
  const pos: number[] = [], uv: number[] = [];
  const faces: number[][][] = [
    [[-hw, eave, hd], [hw, eave, hd], [r, h, 0], [-r, h, 0]],
    [[hw, eave, -hd], [-hw, eave, -hd], [-r, h, 0], [r, h, 0]],
    [[hw, eave, hd], [hw, eave, -hd], [r, h, 0], [r, h, 0]],
    [[-hw, eave, -hd], [-hw, eave, hd], [-r, h, 0], [-r, h, 0]],
  ];
  faces.forEach((f, k) => {
    const base = Math.hypot(f[1][0] - f[0][0], f[1][2] - f[0][2]);
    const sl = Math.hypot(h - eave, k < 2 ? hd : hw);
    const uvq = [[0, 0], [base * uvs, 0], [(base / 2 + r) * uvs, sl * uvs], [(base / 2 - r) * uvs, sl * uvs]];
    pos.push(...f[0], ...f[1], ...f[2], ...f[0], ...f[2], ...f[3]);
    uv.push(...uvq[0], ...uvq[1], ...uvq[2], ...uvq[0], ...uvq[2], ...uvq[3]);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function cyl(rTop: number, rBot: number, h: number, seg = 12, uvs = 1, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ * uvs, uv.getY(i) * h * uvs);
  g.translate(0, h / 2, 0);
  return g;
}

export function cone(r: number, h: number, seg = 12, uvs = 1) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const sl = Math.hypot(r, h);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r * uvs, uv.getY(i) * sl * uvs);
  g.translate(0, h / 2, 0);
  return g;
}

export function sphere(r: number, ws = 12, hs = 8, phiLen = Math.PI * 2, thetaLen = Math.PI) {
  return new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen);
}

function normalizeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (!out.getAttribute('uv')) {
    const n = out.getAttribute('position').count;
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  return out;
}

export interface Anchors {
  chimneys: THREE.Vector3[];
  windows: THREE.Vector3[];
  fires: THREE.Vector3[];
  flags: THREE.Vector3[];
  door: THREE.Vector3;
  top: number;
  piles: THREE.Vector3[];
  soldiers: THREE.Vector3[];
}

export class ModelBuilder {
  parts = new Map<string, THREE.BufferGeometry[]>();
  movers: { name: string; builder: ModelBuilder; pos: THREE.Vector3; axis: 'x' | 'y' | 'z' }[] = [];
  anchors: Anchors = { chimneys: [], windows: [], fires: [], flags: [], door: new THREE.Vector3(), top: 1, piles: [], soldiers: [] };
  private tmpM = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(mat: string, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1): this {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.tmpM.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(s, s, s));
    const geo = normalizeGeo(g.clone());
    geo.applyMatrix4(this.tmpM);
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push(geo);
    return this;
  }

  /** Box resting on y (bottom at y). */
  block(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, uvs = 1) {
    return this.add(mat, box(w, h, d, uvs), x, y + h / 2, z, ry);
  }

  mover(name: string, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z'): ModelBuilder {
    const b = new ModelBuilder();
    this.movers.push({ name, builder: b, pos: new THREE.Vector3(x, y, z), axis });
    return b;
  }

  build(materials: (key: string) => THREE.Material): THREE.Group {
    const group = new THREE.Group();
    for (const [key, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials(key));
      mesh.castShadow = !key.startsWith('glow') && key !== 'window';
      mesh.receiveShadow = true;
      mesh.userData.matKey = key;
      group.add(mesh);
    }
    for (const m of this.movers) {
      const sub = m.builder.build(materials);
      sub.position.copy(m.pos);
      sub.name = m.name;
      sub.userData.axis = m.axis;
      group.add(sub);
    }
    return group;
  }

  bounds(): THREE.Box3 {
    const b = new THREE.Box3();
    for (const geos of this.parts.values()) for (const g of geos) {
      g.computeBoundingBox();
      b.union(g.boundingBox!);
    }
    return b;
  }
}
