// The province's chart (provinceMap.ts) takes a fifth of a second to make: the title screen starts it
// in a worker, and the campaign's page finds it made (or makes its own, if it is opened first).
import { adoptGeography, geographyMade, type Geography } from './provinceMap';

let started = false;
export function warmGeography() {
  if (started || geographyMade() || typeof Worker === 'undefined') return;
  started = true;
  void import('./provinceMap.worker?worker&inline').then(({ default: MapWorker }) => {
    if (geographyMade()) return;
    const w = new MapWorker();
    w.onmessage = (e: MessageEvent<Geography>) => { adoptGeography(e.data); w.terminate(); };
    w.onerror = () => w.terminate();
  }).catch(() => undefined);
}
