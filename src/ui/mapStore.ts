// The player's own maps, in the browser (IndexedDB, its own database beside the saved games').
// Summaries and map data sit in separate stores so the library never reads whole maps to list them.
import { T_DIRT, T_FOREST, T_MEADOW, T_ROCK, T_SAND, T_SNOW, T_SWAMP } from '../game/defs';
import { mapMeta, type MapData, type MapMeta } from '../game/map';
import { WATER_LEVEL } from '../game/world';

const DB = 'terra-nova-maps';
const META = 'meta';
const DATA = 'data';

export interface MapSummary {
  id: string;
  meta: MapMeta;
}

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(DATA)) d.createObjectStore(DATA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => { dbp = null; reject(new Error('The map library is busy in another tab')); };
  });
  return dbp;
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Saving was cancelled'));
});
const result = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Newest first. */
export async function listMaps(): Promise<MapSummary[]> {
  const d = await db();
  const all = await result(d.transaction(META).objectStore(META).getAll()) as MapSummary[];
  return all.sort((a, b) => b.meta.savedAt - a.meta.savedAt);
}

export async function getMap(id: string): Promise<MapData | null> {
  const d = await db();
  return (await result(d.transaction(DATA).objectStore(DATA).get(id)) as MapData | undefined) ?? null;
}

export async function getMapSummary(id: string): Promise<MapSummary | null> {
  const d = await db();
  return (await result(d.transaction(META).objectStore(META).get(id)) as MapSummary | undefined) ?? null;
}

/** Write a map under `id` (a new one, or the one it was opened from), with its picture. */
export async function putMap(id: string, data: MapData): Promise<MapSummary> {
  const meta = mapMeta(data);
  meta.thumb = mapThumb(data, 96);
  const d = await db();
  const tx = d.transaction([META, DATA], 'readwrite');
  const sum: MapSummary = { id, meta };
  tx.objectStore(META).put(sum);
  tx.objectStore(DATA).put(data, id);
  await done(tx);
  return sum;
}

export async function deleteMap(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([META, DATA], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  return done(tx);
}

export const newMapId = () => `map-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

// ------------------------------------------------------------------ pictures
const COLOURS: Record<number, [number, number, number]> = {
  0: [92, 128, 58], [T_MEADOW]: [128, 150, 70], [T_FOREST]: [58, 96, 44], [T_DIRT]: [120, 96, 62],
  [T_SAND]: [196, 176, 120], [T_ROCK]: [118, 112, 104], [T_SNOW]: [232, 236, 240], [T_SWAMP]: [86, 108, 70],
};

/** Paint a map onto a canvas, the way the minimap shows it: water by depth, land by its material, lit from the north-west, the starts as dots. */
export function paintMap(ctx: CanvasRenderingContext2D, d: MapData, px: number) {
  const S = d.size, img = ctx.createImageData(px, px), out = img.data;
  const treeAt = new Uint8Array(S * S);
  for (const t of d.trees) if (t.node >= 0 && t.node < S * S) treeAt[t.node] = 1;
  for (let py = 0; py < px; py++) {
    for (let pxx = 0; pxx < px; pxx++) {
      const x = Math.min(S - 1, Math.floor((pxx / px) * S)), y = Math.min(S - 1, Math.floor((py / px) * S));
      const i = y * S + x, h = d.h[i];
      let r: number, g: number, b: number;
      if (h < WATER_LEVEL - 0.02) {
        const deep = Math.min(1, (WATER_LEVEL - h) / 4);
        r = 40 - deep * 20; g = 90 - deep * 40; b = 150 - deep * 60;
        if (d.fish[i]) { g += 10; b += 10; }
      } else {
        [r, g, b] = COLOURS[d.terrain[i]] ?? COLOURS[0];
        if (treeAt[i]) { r = (r + 40) / 2; g = (g + 80) / 2; b = (b + 30) / 2; }
        // light from the north-west
        const hl = d.h[y * S + Math.max(0, x - 1)], hu = d.h[Math.max(0, y - 1) * S + x];
        const shade = 1 + Math.max(-0.35, Math.min(0.35, ((h - hl) + (h - hu)) * 0.18));
        r *= shade; g *= shade; b *= shade;
        if (d.ore[i]) { r += 30; g += 20; }
      }
      const o = (py * px + pxx) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const cols = ['#c8342a', '#2f6fd0', '#e0b020', '#8a3fd0'];
  d.starts.forEach((s, p) => {
    ctx.beginPath();
    ctx.arc(((s.x + 0.5) / S) * px, ((s.y + 0.5) / S) * px, Math.max(2, px / 48), 0, Math.PI * 2);
    ctx.fillStyle = cols[p] ?? '#fff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  });
}

/** A small picture of a map as a data URL, for the library. */
export function mapThumb(d: MapData, px = 96): string | undefined {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    paintMap(c.getContext('2d', { willReadFrequently: true })!, d, px);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return undefined;
  }
}
