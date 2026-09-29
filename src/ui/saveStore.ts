// Saved games in the browser (IndexedDB). Summaries and game data sit in separate stores so the
// load list never has to read whole games. The `auto` slot holds the running game: it is written
// every little while and whenever the page is hidden or closed, so a session outlives a reload.
import type { SaveData, SaveMeta } from '../game/save';
import { missionById, missionIndex, numeralOf } from '../game/campaign';

export const AUTO = 'auto';
const DB = 'terra-nova';
const META = 'meta';
const DATA = 'data';

export interface SaveSummary {
  id: string;
  name: string;
  meta: SaveMeta;
}

const MAP_SIZES: Record<number, string> = { 128: 'Small', 160: 'Medium', 208: 'Large' };

export function playTime(sec: number) {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function timeAgo(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Medium map · 1 h 12 min played · saved 5 min ago" */
export function saveSubtitle(m: SaveMeta) {
  const mi = m.mission ? missionById(m.mission) : undefined;
  const mission = mi ? `Mission ${numeralOf(missionIndex(mi.id))} · ${mi.title} · ` : '';
  return `${mission}${MAP_SIZES[m.size] ?? `${m.size}²`} map · ${playTime(m.time)} played · saved ${timeAgo(m.savedAt)}`;
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
    req.onblocked = () => { dbp = null; reject(new Error('The save database is busy in another tab')); };
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

/** Newest first, the autosave ahead of the rest. */
export async function listSaves(): Promise<SaveSummary[]> {
  const d = await db();
  const all = await result(d.transaction(META).objectStore(META).getAll()) as SaveSummary[];
  return all.sort((a, b) => Number(b.id === AUTO) - Number(a.id === AUTO) || b.meta.savedAt - a.meta.savedAt);
}

export async function getSummary(id: string): Promise<SaveSummary | null> {
  const d = await db();
  return (await result(d.transaction(META).objectStore(META).get(id)) as SaveSummary | undefined) ?? null;
}

export async function getSave(id: string): Promise<SaveData | null> {
  const d = await db();
  return (await result(d.transaction(DATA).objectStore(DATA).get(id)) as SaveData | undefined) ?? null;
}

/**
 * Write a save. The data is copied when this is called, so the game may run on at once. With `now`
 * the transaction is committed straight away — for a page that is being hidden or closed.
 */
export function putSave(id: string, name: string, meta: SaveMeta, data: SaveData, now = false): Promise<void> {
  const write = (d: IDBDatabase) => {
    const tx = d.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).put({ id, name, meta } satisfies SaveSummary);
    tx.objectStore(DATA).put(data, id);
    if (now) tx.commit?.();
    return done(tx);
  };
  // once the database is open, write synchronously: the page may be gone after this task
  const open = openDb;
  return open ? write(open) : db().then((d) => { openDb = d; return write(d); });
}
let openDb: IDBDatabase | null = null;

export async function deleteSave(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([META, DATA], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  return done(tx);
}

/** Open the database ahead of time, so a save from `pagehide` can be written in the same task. */
export async function warmUp() {
  try { openDb = await db(); } catch { /* storage blocked: saving will report it */ }
}
