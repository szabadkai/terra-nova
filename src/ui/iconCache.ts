// The UI's rendered icons, kept in the browser (IndexedDB, a database of their own) between page loads:
// drawing them takes a WebGL context of its own, every building's model and some seconds of a slow
// machine's boot, and they come out the same for one build, one player's colours and one texture size.
// Not on the dev server, where the models change without the build changing.
const DB = 'terra-nova-icons';
const STORE = 'icons';

export interface IconSet { buildings: [string, string][]; goods: [string, string][] }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => { dbp = null; reject(new Error('The icon cache is busy in another tab')); };
  });
  return dbp;
}

const on = () => !import.meta.env.DEV && typeof indexedDB !== 'undefined';

/** The icons drawn for `key`, or null (none kept, or no IndexedDB). */
export async function loadIcons(key: string): Promise<IconSet | null> {
  if (!on()) return null;
  try {
    const d = await db();
    return await new Promise<IconSet | null>((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as IconSet | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

/** Keep the icons drawn for `key`, and forget those of other builds (`build` is the key's first part). */
export async function saveIcons(key: string, build: string, set: IconSet): Promise<void> {
  if (!on()) return;
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
      const keys = st.getAllKeys();
      keys.onsuccess = () => { for (const k of keys.result) if (typeof k === 'string' && !k.startsWith(build + '|')) st.delete(k); st.put(set, key); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* the next boot draws them again */ }
}
