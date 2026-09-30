// Browser regressions for terrain workers and construction-resource lifetime.
// Run against Vite: node scripts/renderChecks.mjs [http://127.0.0.1:5173] [Chrome executable]
import assert from 'node:assert/strict';
import { launch } from 'puppeteer-core';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const executablePath = process.argv[3] ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
const browser = await launch({ executablePath, headless: true, args: ['--disable-background-timer-throttling'] });
async function blank() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => r.isNavigationRequest() && r.frame() === page.mainFrame()
    ? r.respond({ contentType: 'text/html', body: '<!doctype html><title>Renderer checks</title>' }) : r.continue());
  await page.goto(`${base}/__render_checks`);
  return page;
}
try {
  let reference;
  for (const mode of ['immediate', 'worker', 'unavailable', 'blocked', 'interrupted']) {
    const page = await blank();
    const result = await page.evaluate(async (mode) => {
      const NativeWorker = window.Worker;
      let workers = 0, terminated = 0;
      if (mode === 'unavailable') window.Worker = undefined;
      else if (mode === 'blocked') window.Worker = class { constructor() { throw new Error('Workers blocked'); } };
      else window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); workers++; }
        terminate() { terminated++; super.terminate(); }
        postMessage(...args) {
          // Fail after the first transferred layer; fallback must resume the remaining five.
          this.requests = (this.requests ?? 0) + 1;
          if (mode === 'interrupted' && this.requests === 2) {
            queueMicrotask(() => this.dispatchEvent(new Event('error', { cancelable: true })));
          } else super.postMessage(...args);
        }
      };
      const { getTerrainDetail } = await import('/src/render/terrainDetail.ts');
      const start = performance.now(), textures = getTerrainDetail(mode === 'immediate');
      const initialMs = performance.now() - start;
      const initialVersion = textures.albedo.version;
      // 1 initial upload plus six accepted layers. Includes the immediate/tool path.
      const deadline = performance.now() + 30000;
      while (textures.albedo.version < 7) {
        if (performance.now() > deadline) throw new Error(`Terrain detail timed out (${mode})`);
        await new Promise((r) => setTimeout(r, 20));
      }
      const hash = async (data) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
        .map((x) => x.toString(16).padStart(2, '0')).join('');
      return { mode, initialMs, initialVersion, workers, terminated,
        albedo: await hash(textures.albedo.image.data), normal: await hash(textures.normal.image.data) };
    }, mode);
    const hashes = { albedo: result.albedo, normal: result.normal };
    if (!reference) reference = hashes;
    else assert.deepEqual(hashes, reference, `${mode} must produce the synchronous textures`);
    if (mode === 'worker') {
      assert.equal(result.workers, 1);
      assert.equal(result.terminated, 1);
      assert.equal(result.initialVersion, 1, 'the first call must return neutral textures without painting');
    }
    if (mode === 'interrupted') assert.equal(result.terminated, 1);
    console.log(`${mode}: identical textures; initial call ${result.initialMs.toFixed(1)} ms`);
    await page.close();
  }

  const page = await blank();
  const memory = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { Game } = await import('/src/game/game.ts');
    const { BuildingsRenderer } = await import('/src/render/buildings.ts');
    const { lodReady } = await import('/src/render/lod.ts');
    await lodReady;
    const g = new Game({ size: 32, seed: 1, players: 1, aiLevel: 0 }, false);
    g.world.h.fill(3); g.world.explored.fill(1);
    const br = new BuildingsRenderer(g, { pile() {} });
    br.batching = false;
    const scene = new THREE.Scene(); scene.add(br.group);
    // This check tests uploaded geometry lifetime without depending on world shader uniforms.
    scene.overrideMaterial = new THREE.MeshBasicMaterial();
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256);
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
    camera.position.set(21, 15, 21); camera.lookAt(11, 3, 11);
    const render = () => { br.update(1 / 60, 0); renderer.render(scene, camera); };
    const counts = [], disposed = [], tracked = new Set();
    const watch = (part) => part.traverse((o) => {
      if (!o.geometry || tracked.has(o.geometry)) return;
      tracked.add(o.geometry);
      const record = { count: 0 }; disposed.push(record);
      o.geometry.addEventListener('dispose', () => record.count++);
    });
    let sharedDisposals = 0;
    for (const m of [br.scaffoldMat, br.ropeMat]) m.addEventListener('dispose', () => sharedDisposals++);
    // Complete sites, demolish during leveling, and demolish during construction.
    for (let cycle = 0; cycle < 12; cycle++) {
      const b = g.newBuilding(g.id(), 'hq', 0, 10, 10);
      b.targetH = 3; g.buildings.set(b.id, b);
      render(); const v = br.views.get(b.id); watch(v.stakes);
      if (cycle % 3 !== 1) {
        b.state = 'building'; render(); watch(v.scaffold);
        if (cycle % 3 === 0) { b.state = 'done'; render(); }
      }
      g.buildings.delete(b.id); render(); counts.push(renderer.info.memory.geometries);
    }
    renderer.dispose(); renderer.forceContextLoss();
    return { counts, disposed: disposed.map((x) => x.count), sharedDisposals };
  });
  assert.ok(memory.disposed.length > 0);
  assert.ok(memory.disposed.every((n) => n === 1), 'every owned geometry must be disposed exactly once');
  assert.equal(new Set(memory.counts).size, 1, 'GPU geometry count must stay flat over repeated construction');
  assert.equal(memory.sharedDisposals, 0, 'shared materials must remain usable');
  console.log(`construction: ${memory.disposed.length} geometries released; GPU counts ${memory.counts.join(', ')}`);
} finally {
  await browser.close();
}
