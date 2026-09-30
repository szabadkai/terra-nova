// Lightweight, query-gated renderer instrumentation. Nothing is created, timed or traversed in a
// normal game: add ?perf=1 to a production build to get a rolling benchmark in #perf-stats.
import * as THREE from 'three';

type TimerExt = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

interface PendingQuery {
  query: WebGLQuery;
  label: string;
}

const percentile = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};

class PerfProbe {
  readonly enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';
  private panel: HTMLPreElement | null = null;
  private frameStart = 0;
  private frame = 0;
  private cpu: number[] = [];
  private section = new Map<string, number[]>();
  private gpu = new Map<string, number[]>();
  private pending: PendingQuery[] = [];
  private active: { gl: WebGL2RenderingContext; query: WebGLQuery; label: string } | null = null;
  private ext: TimerExt | null | undefined;
  private reportAt = 0;
  private lastReportT = 0;
  private lastReportFrame = 0;
  private profileKey = '';
  private syncPixel = new Uint8Array(4);
  private calls: number[] = [];
  private triangles: number[] = [];

  beginFrame(renderer: THREE.WebGLRenderer) {
    if (!this.enabled) return;
    this.frameStart = performance.now();
    this.frame++;
    renderer.info.autoReset = false;
    renderer.info.reset();
    this.pollGpu(renderer.getContext());
  }

  begin() { return this.enabled ? performance.now() : 0; }

  end(label: string, started: number) {
    if (!this.enabled) return;
    this.push(this.section, label, performance.now() - started);
  }

  /** GPU queries are sampled, not run every frame: profiling must not become the workload. */
  beginGpu(gl: WebGLRenderingContext | WebGL2RenderingContext, label: string) {
    const sample = label === 'frame' ? this.frame % 24 === 0 : this.frame % 24 === 12;
    if (!this.enabled || !sample || this.active || !(gl instanceof WebGL2RenderingContext)) return false;
    if (this.ext === undefined) this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    if (!this.ext) return false;
    const query = gl.createQuery();
    if (!query) return false;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { gl, query, label };
    return true;
  }

  endGpu(started: boolean) {
    if (!started) return;
    const a = this.active;
    if (!a || !this.ext) return;
    a.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ query: a.query, label: a.label });
    this.active = null;
  }

  endFrame(renderer: THREE.WebGLRenderer, meta: Record<string, unknown>) {
    if (!this.enabled) return;
    const key = JSON.stringify([meta.settings, meta.resolution, meta.shadow, meta.reflection]);
    if (key !== this.profileKey) {
      this.profileKey = key;
      this.cpu.length = 0;
      this.section.clear();
      this.gpu.clear();
      this.calls.length = 0;
      this.triangles.length = 0;
      const gl = renderer.getContext();
      if (gl instanceof WebGL2RenderingContext) for (const p of this.pending) gl.deleteQuery(p.query);
      this.pending.length = 0;
      this.lastReportT = 0;
      this.lastReportFrame = this.frame;
    }
    // A sparse readback is a portable end-to-end GPU proxy when timer queries are missing or a
    // tiled driver attributes work to surprising sub-passes. It is intentionally profiling-only.
    if (this.frame % 120 === 0) {
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncPixel);
      this.push(this.gpu, 'frameSyncProxy', performance.now() - this.frameStart);
    }
    this.cpu.push(performance.now() - this.frameStart);
    if (this.cpu.length > 300) this.cpu.shift();
    const frameInfo = renderer.info.render;
    this.calls.push(frameInfo.calls);
    this.triangles.push(frameInfo.triangles);
    if (this.calls.length > 300) { this.calls.shift(); this.triangles.shift(); }
    const now = performance.now();
    if (now < this.reportAt) return;
    this.reportAt = now + 1000;
    const renderFps = this.lastReportT ? ((this.frame - this.lastReportFrame) * 1000) / (now - this.lastReportT) : 0;
    this.lastReportT = now;
    this.lastReportFrame = this.frame;
    if (!this.panel) {
      const p = document.createElement('pre');
      p.id = 'perf-stats';
      p.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:100000;margin:0;padding:8px 10px;max-width:46vw;max-height:42vh;overflow:auto;pointer-events:none;background:#071019dd;color:#bfe8cf;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap';
      document.body.appendChild(p);
      this.panel = p;
    }
    let visibleObjects = 0, meshes = 0, instances = 0;
    renderer.domElement;
    const scene = meta.scene as THREE.Scene | undefined;
    scene?.traverseVisible((o) => {
      visibleObjects++;
      if (o instanceof THREE.Mesh) meshes++;
      if (o instanceof THREE.InstancedMesh) instances += o.count;
    });
    const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
    const sections = Object.fromEntries([...this.section].map(([k, v]) => [k, +avg(v).toFixed(2)]));
    const gpu = Object.fromEntries([...this.gpu].map(([k, v]) => [k, +avg(v).toFixed(2)]));
    const ri = renderer.info.render;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const { scene: _scene, ...reportMeta } = meta;
    const out = {
      sampleFrames: this.cpu.length,
      renderFps: +renderFps.toFixed(1),
      cpuMs: { avg: +avg(this.cpu).toFixed(2), p95: +percentile(this.cpu, 0.95).toFixed(2) },
      cpuSectionsMs: sections,
      gpuMs: Object.keys(gpu).length ? gpu : 'timer query unavailable',
      render: {
        callsAvg: +avg(this.calls).toFixed(1), trianglesAvg: Math.round(avg(this.triangles)),
        callsLast: ri.calls, trianglesLast: ri.triangles, pointsLast: ri.points, linesLast: ri.lines,
      },
      scene: { visibleObjects, meshes, instances },
      memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, usedJSHeapMB: heap ? +(heap.usedJSHeapSize / 1048576).toFixed(1) : 'unavailable' },
      ...reportMeta,
    };
    this.panel.textContent = JSON.stringify(out, null, 2);
    this.panel.dataset.report = JSON.stringify(out);
  }

  private pollGpu(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!this.ext || !(gl instanceof WebGL2RenderingContext) || gl.getParameter(this.ext.GPU_DISJOINT_EXT)) return;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      const ns = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(p.query);
      this.pending.splice(i, 1);
      this.push(this.gpu, p.label, ns / 1e6);
    }
  }

  private push(map: Map<string, number[]>, key: string, value: number) {
    let a = map.get(key);
    if (!a) { a = []; map.set(key, a); }
    a.push(value);
    if (a.length > 120) a.shift();
  }
}

export const perf = new PerfProbe();
/** Reproduce the pre-optimization render policy while profiling, for like-for-like A/B runs. */
export const perfBaseline = perf.enabled && new URLSearchParams(location.search).has('perfBaseline');
