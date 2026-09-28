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

/**
 * Set an instanced mesh's count and upload the instances written this time (matrices, colours and
 * any extra per-instance attributes). An empty mesh is hidden, so no pass sets up its program at all.
 */
export function commitInstances(mesh: THREE.InstancedMesh, n: number, ...extra: (THREE.BufferAttribute | null | undefined)[]) {
  mesh.count = n;
  mesh.visible = n > 0;
  uploadFirst(mesh.instanceMatrix, n);
  uploadFirst(mesh.instanceColor, n);
  for (const a of extra) uploadFirst(a, n);
}
