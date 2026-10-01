// GPU texture arrays, filled one layer at a time by the terrain-detail worker.
import * as THREE from 'three';
import { DETAIL_SIZE, DETAIL_LAYERS, DETAIL_ORDER, generateDetailLayer, type DetailLayer } from './terrainDetailData';
export { DETAIL_SIZE, DETAIL } from './terrainDetailData';

const S = DETAIL_SIZE, N = S * S, LAYERS = DETAIL_LAYERS;

let cache: { albedo: THREE.DataArrayTexture; normal: THREE.DataArrayTexture } | null = null;
/** the arrays whose whole data the current WebGL context has: later layers go up one at a time */
const onGpu = new Set<THREE.Texture>();

/**
 * The WebGL context the arrays were uploaded to is gone (a new world's renderer): the next one must
 * take them whole. Without this a world built while the worker still paints got only the layers
 * painted since, and the rest of each array stayed empty on its GPU.
 */
export function detailContextLost() {
  onGpu.clear();
  if (!cache) return;
  for (const t of [cache.albedo, cache.normal]) {
    t.clearLayerUpdates();
    t.needsUpdate = true;
  }
}

function arrayTex(data: Uint8Array): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, S, S, LAYERS);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Neutral arrays are available immediately. A worker paints their detail without blocking
 * input or frames. `immediate` is for tools that need the finished textures synchronously. */
export function getTerrainDetail(immediate = false) {
  if (cache) return cache;
  const alb = new Uint8Array(N * 4 * LAYERS), nrm = new Uint8Array(N * 4 * LAYERS);
  for (let i = 0; i < N * LAYERS; i++) {
    alb[i * 4] = alb[i * 4 + 1] = alb[i * 4 + 2] = 102;
    alb[i * 4 + 3] = 128;
    nrm[i * 4] = nrm[i * 4 + 1] = nrm[i * 4 + 3] = 128;
    nrm[i * 4 + 2] = 255;
  }
  const c = (cache = { albedo: arrayTex(alb), normal: arrayTex(nrm) });
  // Keep uploads limited to the new layer once the initial neutral arrays are on the GPU.
  for (const t of [c.albedo, c.normal]) t.onUpdate = () => onGpu.add(t);
  const accept = ({ layer, albedo, normal }: DetailLayer) => {
    alb.set(albedo, layer * N * 4);
    nrm.set(normal, layer * N * 4);
    for (const t of [c.albedo, c.normal]) {
      if (onGpu.has(t)) t.addLayerUpdate(layer);
      t.needsUpdate = true;
    }
  };
  if (immediate) {
    for (const layer of DETAIL_ORDER) accept(generateDetailLayer(layer));
    return c;
  }

  let next = 0;
  let worker: Worker | null = null;
  let fallingBack = false;
  // Workers may be unavailable or blocked. Resume at the first unfinished layer, with the
  // old one-layer-per-task schedule, so these browsers still get all their terrain detail.
  const fallback = () => {
    if (fallingBack) return;
    fallingBack = true;
    worker?.terminate();
    worker = null;
    const paint = () => {
      if (next >= DETAIL_ORDER.length) return;
      accept(generateDetailLayer(DETAIL_ORDER[next++]));
      if (next < DETAIL_ORDER.length) setTimeout(paint, 16);
    };
    setTimeout(paint, 250);
  };
  if (typeof Worker === 'undefined') fallback();
  else void import('./terrainDetail.worker?worker&inline').then(({ default: DetailWorker }) => {
    worker = new DetailWorker();
    worker.onerror = (e) => { e.preventDefault(); fallback(); };
    worker.onmessageerror = fallback;
    worker.onmessage = (e: MessageEvent<DetailLayer>) => {
      if (fallingBack) return;
      accept(e.data);
      if (++next < DETAIL_ORDER.length) worker!.postMessage(DETAIL_ORDER[next]);
      else { worker!.terminate(); worker = null; }
    };
    worker.postMessage(DETAIL_ORDER[next]);
  }).catch(fallback);
  return c;
}

/**
 * The materials that read the detail arrays (the ground's, the stones'). Low compiles them without
 * (DETAIL_LOW: their close-up detail was a sixth of a Low frame on a GPU short of fill), and the
 * arrays are only built once a frame is drawn with them, so a machine that plays at Low never paints
 * nor uploads them.
 */
export class DetailUsers {
  private on = true;
  private built = false;
  constructor(private mats: THREE.Material[], private uniforms: Record<string, THREE.IUniform>[]) {}
  /** with the detail layers (every level but Low) or without */
  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    for (const m of this.mats) {
      const d = ((m as THREE.Material & { defines?: Record<string, string> }).defines ??= {});
      if (on) delete d.DETAIL_LOW; else d.DETAIL_LOW = '';
      m.needsUpdate = true;
    }
  }
  /** before a frame: the arrays, the first time a frame draws them */
  frame() {
    if (!this.on || this.built) return;
    this.built = true;
    const d = getTerrainDetail();
    for (const u of this.uniforms) { u.tDetail.value = d.albedo; u.tDetailN.value = d.normal; }
  }
}
