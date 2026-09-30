// Instance buffer uploads. Flagging an attribute with needsUpdate alone makes three send the
// whole array — the full capacity of the mesh, thousands of slots — every time, so every
// per-frame writer goes through here and sends only the instances it wrote.
import * as THREE from 'three';

/** Queue the first n items of an attribute for upload (nothing when n is 0: nothing is drawn). */
export function uploadFirst(attr: THREE.BufferAttribute | null | undefined, n: number) {
  if (!attr || n <= 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.min(attr.array.length, n * attr.itemSize));
  attr.needsUpdate = true;
}

/** what went up last time, per attribute, for uploadChanged */
const sent = new WeakMap<THREE.BufferAttribute, { data: Float32Array; len: number }>();

/**
 * Like uploadFirst, for an attribute that mostly holds what it held last frame (per-instance colours):
 * the first n items go up only if they differ from what was sent last time.
 */
export function uploadChanged(attr: THREE.BufferAttribute | null | undefined, n: number) {
  if (!attr || n <= 0) return;
  const len = Math.min(attr.array.length, n * attr.itemSize);
  const a = attr.array as Float32Array;
  let s = sent.get(attr);
  if (s && s.len === len) {
    const d = s.data;
    let i = 0;
    while (i < len && d[i] === a[i]) i++;
    if (i === len) return;
  }
  if (!s || s.data.length < len) { s = { data: new Float32Array(a.length), len: 0 }; sent.set(attr, s); }
  s.data.set(a.subarray(0, len));
  s.len = len;
  uploadFirst(attr, n);
}

/**
 * Set an instanced mesh's count and upload the instances written this time (matrices, colours and
 * any extra per-instance attributes). An empty mesh is hidden, so no pass sets up its program at all.
 */
export function commitInstances(mesh: THREE.InstancedMesh, n: number, ...extra: (THREE.BufferAttribute | null | undefined)[]) {
  if (!mesh.customDepthMaterial) ownDepth(mesh);
  mesh.count = n;
  mesh.visible = n > 0;
  uploadFirst(mesh.instanceMatrix, n);
  uploadFirst(mesh.instanceColor, n);
  for (const a of extra) uploadFirst(a, n);
}

/**
 * Give a mesh its per-instance colours from the start. three adds them on the first setColorAt,
 * which changes the shader: the program would compile then, in the middle of play.
 */
export function withInstanceColor<T extends THREE.InstancedMesh>(mesh: T): T {
  if (!mesh.instanceColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  return mesh;
}

const depthMats = new Map<string, THREE.MeshDepthMaterial>();

/**
 * Give an instanced or batched mesh with no depth material of its own one shared by its kind. three
 * draws every such object into the shadow map with a single depth material, whose program it has to
 * look up again each time the pass goes from an instanced mesh to a plain one, or from one with
 * per-instance colours to one without: some twenty times a frame. (Only these change the program:
 * three copies the object's map, alpha test and side onto whichever depth material it draws with.)
 */
export function ownDepth(mesh: THREE.Mesh | THREE.InstancedMesh | THREE.BatchedMesh) {
  if (mesh.customDepthMaterial) return;
  const o = mesh as THREE.Mesh & { isInstancedMesh?: boolean; isBatchedMesh?: boolean; instanceColor?: unknown; _colorsTexture?: unknown };
  const key = (o.isBatchedMesh ? 'b' : o.isInstancedMesh ? 'i' : 'm') + (o.instanceColor || o._colorsTexture ? 'c' : '');
  let d = depthMats.get(key);
  if (!d) { d = new THREE.MeshDepthMaterial(); depthMats.set(key, d); }
  mesh.customDepthMaterial = d;
}
