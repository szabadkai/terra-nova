# Terra Nova renderer performance

This pass targets sustained power use, not uncapped throughput. High + Quiet remains a visually rich preset, but now deliberately leaves GPU headroom and stops treating every visual subsystem as a 60 Hz workload.

## Reproducing the measurements

Run the production A/B benchmark:

```sh
npm run benchmark
```

It launches an isolated Chrome profile against the production Vite preview, creates a deterministic large four-player world (`seed=8176`, size `192`), advances every player under AI control for 20 simulated minutes, and samples both an interacting camera and a settled Quiet view. Set `CHROME=/path/to/chrome` if Chrome is not in a standard location; set `HEADLESS=0` for a visible hardware-composited run.

For manual profiling, open a production build with `?perf=1`. The overlay reports rolling CPU average/p95, sampled WebGL timer queries where supported, a sparse readback proxy, draw calls, triangles, visible objects/instances, target sizes, renderer memory, and total/visible entity counts. Add `&perfBaseline=1` to reproduce the old shadow, reflection, MSAA, resolution, and GPU-preference policy on the same code and scene.

The main comparison below is the final `npm run benchmark` result from isolated Chrome at a 1280×720 CSS viewport, 2× device scale, High + Quiet, AO off, grass/reflections on, and the deterministic 20-minute benchmark scene. The developed scene contained 334 settlers, 148 buildings, about 2,400 trees, and 52–53 visible actors. Measurements are rolling 300-render-frame samples during a rotating camera.

## Before and after

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Interacting render rate | 59.9 fps | 60.0 fps | stable |
| CPU frame time, average | 5.86 ms | 4.45 ms | **-24%** |
| CPU frame time, p95 | 8.9 ms | 5.7 ms | **-36%** |
| Sampled GPU frame query | 16.77 ms | 13.24 ms | **-21%** |
| GPU readback proxy | 29.87 ms | 22.47 ms | **-25%** |
| Draw calls, average | 409.7 | 294.6 | **-28%** |
| Triangles, average | 1.56M | 1.16M | **-26%** |
| Main render target | 1600×900 | 1472×828 | **-15% pixels** |
| Shadow target | 4608×4096 | 1792×1536 | **-85% texels** |
| Reflection target | 800×450 | 588×331 | **-46% texels** |
| Reflection cadence at 60 fps | 30 Hz | 15 Hz | **-50% updates** |
| Settled render rate | 30.1 fps | 30.0 fps | preserved |
| Settled CPU frame time | 5.29 ms | 4.88 ms | **-8%** |
| Hidden render rate | 0 fps | 0 fps | preserved |

WebGL timer queries can include deferred work differently across Metal/ANGLE versions, so the draw workload, target dimensions, CPU times, and sustained system utilization should be considered alongside the GPU number. A separate hardware-composited in-app Chromium A/B run showed the same direction: GPU frame query -35%, readback proxy -26%, draw calls -31%, and triangles -38%.

## Initial bottlenecks

- High used a 4096-pixel-tall shadow map, widened to 4608 pixels at this aspect ratio: 18.9 million shadow texels, refreshed every rendered frame.
- Quiet reflections were half-resolution and refreshed every other frame. They were already well culled, but still represented a frequent second scene view.
- High auto-enabled the three-pass, half-resolution GTAO pipeline despite AO being the most expensive optional effect.
- Every renderer requested `powerPreference: 'high-performance'`, including Quiet on hybrid-GPU laptops.
- Quiet Auto began at full scale, using dynamic resolution only after missed frames rather than reserving power headroom proactively.
- The multisampled scene target stayed at 4× in Quiet.
- Static visibility/instance maintenance continued every render frame after the camera settled.
- Hot paths still created vectors, matrices, quaternions, arrays, maps, closures, and visible-actor records repeatedly.

## Changes made

### Shadows

- High now uses a 2560 map normally and 1536 in Quiet; the existing tightly fitted shadow camera preserves useful on-screen density. Ultra retains 4096.
- High/Quiet shadow rendering updates at 30 Hz while navigating and 15 Hz after the camera settles. Texture and light matrix are reused together so cached shadows do not swim.
- Existing coarse shadow LOD, fitted-frustum culling, and static/dynamic batching remain intact.
- At the measured aspect ratio this cuts a shadow update from 18.9M to 2.75M texels. Including cadence, active shadow texel work is about 7% of the old policy and settled work about 4%.

### Reflections

- Quiet reflections use 40% linear resolution (then follow Quiet render scale) and update every fourth rendered frame; non-Quiet High remains every second frame and Ultra can remain every frame.
- Existing water visibility rejection, projected-water scissoring, reflection-specific coarse LOD, dry-building rejection, and exclusion of grass/particles/rain/tiny projectiles are preserved.
- The measured reflection target fell 46%; combined with the halved cadence, approximate reflection pixel work per second fell 73%.

### Post-processing and render policy

- AO is now Ultra-only by preset. It remains available as an explicit user toggle on High.
- Quiet scene MSAA is 2× instead of 4×. Ultra keeps 4×.
- Quiet Auto starts at 92% scale instead of waiting for missed frames, while retaining the existing 92%/85% dynamic steps beneath that base.
- Quiet asks WebGL for the `low-power` adapter when a renderer is created. Ultra requests `high-performance`; other modes use `default`. The menu explains that a power-preference change applies to the next game because WebGL adapter selection is a context-creation decision.

### CPU and allocation work

- Static tree/stone/field/vine visibility maintenance drops to roughly 8 Hz once the camera settles and immediately returns to render frequency on movement.
- Reused reflection projection matrices, hidden-object visibility storage, reflection-reach vectors, frame colors/vectors, projectile vectors/quaternion, catapult/donkey matrices, picking ray/vector state, and donkey goods counters.
- Visible settler/donkey/catapult records now come from stable arrays rather than allocating records every frame.
- Removed a per-projectile closure and temporary quaternion, per-pick concatenated actor array, and repeated civilian-ship fire-point vectors.
- Simulation frequency and deterministic state are unchanged; only renderer maintenance and pass cadence changed.

## Pass and memory observations

- Base High without optional effects is one scene pass plus the final composite. Shadow rendering is part of the scene render when due; reflection is a second scene view only when visible and due.
- AO, when explicitly enabled, adds three half-resolution fullscreen passes (depth reduction, GTAO, denoise) and requires multisampled depth resolve. This is why it no longer belongs in automatic High.
- Bloom and tilt-shift remain fully skipped when disabled; their half-resolution targets are retained rather than recreated during play.
- Reflection and post-processing targets are resized only when settings, DPR, viewport, or dynamic scale change.
- The benchmark reported stable renderer resource counts across A/B (about 950 geometries and 154 textures in the developed scene). Scratch reuse removes known hot-loop garbage; Chrome's exposed heap number includes procedurally generated source data and profiler overhead, so it is recorded but not treated as a GPU-memory figure.

## Regression tooling

- `?perf=1` is query-gated and does no traversal, query creation, sorting, or reporting in ordinary play.
- `?perfBaseline=1` keeps a reproducible old-policy comparison path available only while profiling.
- `npm run benchmark` emits machine-readable JSON containing workload identity, active/idle CPU and GPU proxies, draw workload, targets, resources, settings, and entity counts.
- Existing frame-pacing, hardware-selection, and fitted-shadow tests continue to cover their respective policies.

## Remaining expensive areas

- A developed view still submits roughly 30k instances, primarily environmental detail. Grass is spatially chunked and trees use per-instance frustum/LOD culling already, so a further large reduction needs a more aggressive screen-size density policy rather than naïve Object3D splitting.
- The animated actor rig remains CPU-heavy when hundreds of settlers are simultaneously visible. A future pass could update far animation poses at 15–20 Hz while interpolating root motion, but that needs careful visual testing.
- AO is intentionally still expensive when manually enabled. Temporal reuse or quarter-resolution AO would be the next step if it must become a default effect again.
- GPU timer-query attribution varies by driver. Hardware power telemetry and package-level energy measurements would be useful final validation on a representative Intel/Apple laptop over a 20–30 minute thermal soak.
