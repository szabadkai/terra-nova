# Performance on low-end hardware

An analysis written on 2026-09-30 on branch `szabadkai/low-end-hardware-performance-f5362b` (2111f6a), then carried out on the same branch over main (6ac5fd9). The bench scripts are in the memory folder, under `perf-bench/lowend/`. Absolute times come from an Apple M5 Pro and only stand in for a weak machine. The shares, ratios and counts are what carry over.

## Where it stands (2026-09-30, evening)

**Before work started, main already had:**

- the power branch's cheaper frames;
- a separate performance pass (a7ad020) that turned MSAA off at Low and drew the shadow map every other frame below Ultra.

**What this branch did, one commit each:**

| Commit | Change | Measured (M5; fill-bound at Low's own proportions unless said) |
|---|---|---|
| a5c73a4 | Low's shadow pass: buildings on the coarse model at any distance; settlers, animals, birds, lanterns, signs, posts, fields, vines, piles, arrows and debris cast nothing beyond 20 units | Shadow pass 427 k → 123 k triangles, 189 → 90 draws, 769 → 499 GL calls at the play zoom. At 4× throttled CPU, JS 9.6 → 8.3 ms a frame |
| f8f4c33 | Low draws the ground and stones without the close-up detail layers (`DETAIL_LOW`), and never builds them | −21% at the play zoom, −17% at 60 units. 17 MB GPU and 13 MB CPU memory freed |
| c566563 | Low lights the world with the sky's spherical harmonics (a `LightProbe` worked out on the CPU) instead of the environment map | −9% / −11%. The frame keeps 92–95% of its brightness by day; the sky's sheen on leaves and still water is lost |
| 4d6afe9 | Low's canvas is drawn at the world's size and the browser enlarges it | −10% / −9% |
| f7bbf20 | Low's resolution is automatic: 70% → 60% → 50% and back (`LOW_STEPS`) | The 70 → 50 step is about 30% of a frame |
| 1d6b860 | The exploration pass skips discs it has already revealed (exact: `seen`/`explored` only grow) | Baselines unchanged. 150-minute AI game 24.9 → 19.0 s. Ticks at 20–30 min: 9.4–12.0 → 5.2–8.5 ms a game-second, p99 2.3–4.1 → 1.0–1.8 ms |
| 6fa3af8 | Low's building textures at half size (256²), anisotropy 2 | Boot at 4× throttle: game up 8.0 → 6.5 s |
| 4487cd8 | The UI icons are cached in IndexedDB by build, colours and texture size | Reload at 4× throttle: game up 5.2 → 3.9 s, one WebGL context instead of two |
| 5be51d7 → db8bf87 | Sky drawn after everything solid (every GPU); ground drawn after the solid things only on Intel, AMD and NVIDIA (`immediateMode`) | Sky last: High 17.3 → 16.7 ms on the M5. Ground last made the M5 ~10% slower at High, hence the gating. Its early-Z gain on Intel is unmeasured |
| a402a7b | The detection's cost model for Low refitted (`COST.low` 0.65 / 1.0) | UHD 620 at 1080p: now ~29 ms at Low's 50% floor, was 58 ms at 70% |
| 5cb2463 | The reveal caches stay out of saves | No more warning on every autosave |

**Net result.** A fill-bound Low frame, main against this branch, alternated twice, same town:

| Zoom | Main | This branch | Change |
|---|---|---|---|
| Play (30) | 9.1–9.2 ms | 5.7–5.8 ms | −37% |
| 60 | 8.8–9.0 ms | 5.9 ms | −34% |
| 95 | 6.5–6.6 ms | 5.0–5.1 ms | −23% |

High is unchanged (−3% at the play zoom, from the sky). Per-frame JavaScript in the real loop at Low is about the same: 5.1–5.3 ms at 1×, 12–13 ms at 4×, inside Low's 33 ms. The gains are GPU fill and boot.

**Measured and dropped:**

- Particles: 218 live in a clear town, 0.06 ms at 4×. Snow fills the 6,000 cap for 0.5 ms either way.
- The trees' periodic rebuild: 0.5–1.3 ms at 4×, every ~13 frames.
- The HUD: about 0.4 ms a frame at 4×, a third of it the top bar, a third the minimap.
- R11G11B10F instead of RGBA16F: no difference.
- Removing chromatic aberration, grain and sharpening from the final pass: no difference on the M5.

**Left** (the research of 2026-10-01 in `PERFPLAN.md` supersedes the GL-call items here: the families are done, and settlers as one batched mesh would be dearer, not cheaper):

- **Confirm on a real Intel UHD 6xx / Iris Xe laptop:**
  - the ground-last early-Z gain;
  - MSAA-free Low;
  - the refitted model;
  - boot on D3D11.
- **Fewer GL calls at every level:** pick the buildings' material in the shader (texture arrays, a few batches instead of about 45), and one rigged mesh for the settlers (ROADMAP item 1, the GPU-offload survey's first two). This is not needed for Low's 30 fps on a 4× slower CPU any more.
- **Staggered simulation timers:** they would change the game, so the baselines would have to move.
- **Keeping one WebGL context across worlds:** probably small, since Chrome caches compiled programs across contexts.
- **The per-frame CPU items in the table below:** small alone.

The rest of this file is the analysis as it was written that afternoon. Its figures are from 2111f6a, before main's performance pass.

## In short

**Low only draws fewer pixels.** It sets pixel ratio 1, a 70% render scale, a 1024 shadow map, a 30 fps cap, and turns off grass, reflections and ambient occlusion. Everything else is the same as on Ultra:

- every shader;
- the 4× MSAA half-float scene target;
- every shadow caster, redrawn every frame;
- all CPU work;
- the simulation's periodic spikes;
- the whole boot.

**Today's Low can't hold 30 fps on the most common weak GPU.** The cost model in `src/render/hardware.ts` puts an Intel UHD 620 (power 0.04) at about **58 ms a Low frame at 1080p**. At the 50% resolution the detection falls back to, it is still about 40 ms. At 50% the fixed part of the frame (shadow pass, vertices, draws) is half the cost: 0.8 / 0.04 = 20 ms.

Two things have to shrink for the weakest machines:

1. the per-pixel cost of the shaders;
2. the fixed cost of the shadow pass and the number of draws.

These are the best buys, ranked by value for effort:

| # | Change | Buys (M5 measurements unless marked *est.*) | Effort |
|---|---|---|---|
| 0 | **Land the power branch** `szabadkai/game-rendering-optimization-8fcf6c`: 5 commits, one conflict, in `renderer.ts`. | GL calls a frame at Low: 3,190–4,240 → 2,550–2,860. Programs: 244 → 98. Game up at 1× CPU: 3.6 → 2.3 s. At 4× throttled CPU: 9.2 → 6.7 s. | S |
| 1 | **A lean Low shader**: no close-up terrain detail and no image-based light (IBL). | Terrain detail: 16–18% of a Low GPU frame. IBL: 8–10%. Both: 25% at the play zoom. Also 17 MB of GPU memory, 13 MB of CPU memory and the detail layers' boot painting. | M |
| 2 | **A lighter shadow pass at Low**: the coarse building model, no small casters, half rate while the view is still. | *est.* 559 k triangles / 163 draws / 678 GL calls → about 130 k / 70 / 300. *est.* 2.3 ms of JS at 4× throttled CPU → about 1 ms. Today the shadow pass draws **more triangles than the view itself**. | M |
| 3 | **Draw order**: sky last, terrain after the solid things. | Nothing on Apple GPUs (tile-based, they shade only the front pixel). *est.* 10–20% of a frame on Intel, AMD and NVIDIA GPUs. It removes a full-screen sky pass and the terrain shading under the 27–43% of the screen that objects cover. | S |
| 4 | **No MSAA at Low**, optionally with FXAA in the final pass. | 0–14% on the M5 (noisy). More on bandwidth-starved integrated GPUs. Scene targets 57 → 12 MB. | S |
| 5 | **The canvas at the render size at Low**, with the compositor scaling it up. | About 8%: the final pass writes 1 Mpx instead of 2. | S |
| 6 | **Automatic resolution on Low**, moving between 70% and 50%. | The 50% step is about 30% of a frame, for battles and zoomed-out views. | S |
| 7 | **Fewer GL calls and draws**: settlers in fewer draws, building batches with fewer bindings. | Chrome's GPU process spends about 1 µs a call on the M5: 2.4–3.1 ms a frame. On a slow CPU that is 3–4× as much. | M–L |
| 8 | **Per-frame CPU at Low**: particles, trees, piles, lights, picking, minimap, HUD. | *est.* 2–4 ms of the 15–18 ms a 4× slower CPU spends on a frame. | S each |
| 9 | **Simulation spikes**: stagger the half-second timers, incremental exploration, AI caches. | Tick p99 at 4× throttled CPU is 10–13 ms today (mean 0.75–2.3). *est.* a third of that. | S–M |
| 10 | **Boot**: one WebGL context across worlds, icons from the main renderer or cached. | Every world load recompiles every program, which is slow on Windows / D3D11. Long tasks reach 1.3 s. | M |

Items 1, 2, 4, 5 and 6 together are "a Low that is really low". The measured per-pixel items (1 and 5) add up to about a third of a Low frame at the play zoom. Item 2 takes most of the fixed part off. Item 3 comes on top on the machines that matter here.

*est.* together they might bring a UHD 620 at 1080p from "misses 30 fps even at 50%" to "about 30 at 50–70%". Only a real machine can confirm that (see "Checking on real hardware").

## How this was measured

- **Machine.** Headless Chrome on the M5 Pro (ANGLE on Metal), the game at `?play=1&seed=199` on the Low preset, window 1920×1080. The town was grown for 30 minutes by the AI (195–361 settlers, 74–141 buildings, about 1,360 trees). The browser game isn't reproducible run to run, so each table says which town it is.
- **CPU.** CDP `Emulation.setCPUThrottlingRate` at 4× stands in for a dual-core laptop CPU. It slows only the page's main thread. Chrome's GPU process, which runs the WebGL command stream, is measured at 1× and scaled by hand.
- **GPU.** On the M5, Low at 1080p is CPU-bound, so hiding things mostly measured JavaScript. To make the GPU the limit, the same frame was drawn at a pixel ratio of 3:
  - a 4032×2268 scene (70%) under a 5760×3240 final pass, the exact proportions of Low at 1080p;
  - LOD chosen as for a 756 px tall target (`gr.lod.update` wrapped).
  The shares of that frame are what a fill-bound weak GPU sees.
  Throughput is k frames back to back with one `readPixels`. Each variant is compared with the minimum of the base frames interleaved with it.
- **Shader variants** (a bench build with `window.__THREE`):
  - Each material's fragment source was edited in `onBeforeCompile`, under a cache key of its own.
  - The 1-tap shadow used a patched `ShaderChunk`.
  - Final-pass edits went through `fragmentShader` and `needsUpdate`.
- **Simulation.** Headless in Node (`simcost.ts`: AI against AI, hard, the 160 map, 60 ticks a second) and in the page with the throttle.
- **Load.** The machine's load average went from 4 to 33 during the day. Numbers that moved between runs are given as ranges, and runs a CPU-bound pipeline spoiled were thrown away.

**Caveat.** The M5 is a tile-based GPU with hidden-surface removal and huge bandwidth. An Intel UHD 6xx or Iris Xe:

- shades every fragment that passes the depth test in draw order, so overdraw and draw order matter;
- shares DDR4 with the CPU, so MSAA and HDR targets cost more;
- on Windows, runs ANGLE on D3D11, where compiling a program is much slower.

Where the M5 can't show an effect, the text says so.

## What Low changes today

`PRESETS.low` (`src/render/hardware.ts:31`) and `GameRenderer.applyQuality` (`src/render/renderer.ts:414`) set pixel ratio 1, resolution 70, no grass, reflections, AO, bloom or tilt-shift, and a shadow map 1024 tall (`sizeShadowMap`, `renderer.ts:444`). The detection sets a 30 fps cap.

Nothing below depends on the level:

- **Shaders.**
  - The terrain's detail arrays: 6 layers × 512² albedo and normal, anisotropy 8.
  - The terrain's triplanar rock.
  - PBR with an environment map.
  - Five-tap soft shadows (`shadowFit.ts:57`).
  - Cloud shadows.
  - The snow noise, which on this branch runs with no snow (`shaderPatch.ts:340`).
  - The 32-lamp loop at night.
- **The scene target**: 4× MSAA RGBA16F (`postfx.ts:703`). `setSamples` exists but nothing calls it.
- **The final pass**: full canvas size, 7 half-float fetches a pixel with the sharpening Low turns on at 70%.
- **The shadow pass**: every caster, every frame, buildings on their far model below 64 units.
- **CPU**: particles up to 10,000 (`particles.ts:192`), every renderer's update, the HUD, the minimap.
- **The simulation, boot and memory.**

## Where a Low frame goes

### GPU (fill-bound, Low's proportions)

Town (195 settlers, 74 buildings), savings against the full frame:

| Knob | Play zoom (30) | Mid zoom (60) |
|---|---|---|
| Base frame (M5, at 3× the pixel ratio) | 10.0 ms | 12.1 ms |
| Post chain alone (empty scene: resolve, final pass, clears) | 2.5 ms, **21–25%** of the frame | same |
| Terrain hidden (what its visible pixels cost over the sky's) | 22% | 34% |
| **Terrain close-up detail off** (`detK = 0`, `terrain.ts:163`) | **18%** | **16%** |
| **No environment map (IBL)** | **8%** | **10%** |
| Detail off and no IBL, together (second run, 361 settlers) | 25% | 16% |
| No MSAA (three runs) | 0 / −2 / 12% | 7 / 14 / 6% |
| 2× MSAA instead of 4× | ≤ 4% | ≤ 4% |
| No shadow map at all | 0–8% | 5–6% |
| 1 shadow tap instead of 5 | 0% | 2% |
| Canvas at the scene's size (compositor upscales) | 8% | noisy |
| R11G11B10F scene target instead of RGBA16F | 0 | noisy |
| No cloud shadow, no snow noise, final pass without chromatic aberration, grain or sharpening | within noise (≤ 2%) | within noise |
| Scene at 100% → 70% (earlier run, same size) | 37% | 32% |

On a fill-bound GPU, then:

- About a third of a Low frame is the terrain's own shading.
- About a quarter is the post chain: the MSAA resolve and a full-size final pass over twice the scene's pixels.
- Half of the terrain's cost is its close-up detail and its image-based light.

The cheap-looking ALU trims (cloud shadow, snow noise, final-pass taps) don't show on the M5. The detail textures do: with anisotropy 8 on an oblique view they are costly to filter.

### Geometry and passes

Low at 1080p, town of 359 settlers and 140 buildings:

| | Play zoom (30) | Mid zoom (60) |
|---|---|---|
| All passes | 1.01 M tris, 337 draws | 1.22 M tris, 539 draws |
| View (main pass) | 454 k tris, 174 draws | 480 k, 268 |
| **Shadow pass** | **559 k tris, 163 draws** | **736 k, 271** |
| LOD switching 3× sooner | −11% of all triangles | −3% |

Shadow casters by triangles at the play zoom (mid zoom in brackets):

| Caster | Triangles |
|---|---|
| Buildings | 259 k (348 k) |
| Settlers | 104 k (145 k) |
| Terrain | 51 k |
| Wheat fields | 44 k |
| Birds | 24 k |
| Trees | 21 k (42 k) |
| Vines | 13 k |
| Pigs | 12 k |
| Lanterns | 10 k |
| Deer and hares | 10 k (29 k) |
| Border posts | 5.5 k |
| Signs | 3 k |

The shadow map covers more ground than the view and draws the buildings on their far model up to 64 units (`renderer.ts:188`, `SHADOW_COARSE_DIST`). **Tighter LOD would barely help. The shadow pass is the geometry lever.**

### Draw order and overdraw

The main pass draws in this order:

```
sky > terrain > trees > stones > fields > vines > settlers > animals > buildings > … > water* > settlers* > spells*
```

three sorts solid draws by `renderOrder`, then by material id (`WebGLRenderLists` `painterSortStable`). The sky dome has `renderOrder = -10` (`sky.ts:154`), and the terrain's material is made early.

Objects cover **43%** of the screen in front of the terrain at the play zoom and **27%** at 60 units. At the play zoom the sky isn't seen at all.

- **On the M5** only the front pixel is shaded, so none of this costs anything.
- **On an immediate-mode GPU** it all costs:
  - the full-screen sky shader (3 noise fetches and three `pow`s) is thrown away wherever something covers it;
  - the terrain's roughly 30-fetch shader runs under every roof and tree.
  Drawn last, early-Z would reject both. The terrain doesn't discard.

### CPU: the page's main thread

`gr.frame` alone (GPU drained before each frame), HEAD, Low 1080p:

| | 1× | 4× throttle |
|---|---|---|
| Start of a game | 1.1 ms | 4.5–5.3 ms |
| Town (285 settlers, 119 buildings), play zoom | 3.3–3.7 ms | 15.1–16.5 ms |
| Town, zoom 70 | 4.0–4.2 ms | 16.2–17.9 ms |

At 4× the time goes to:

| Part | ms a frame |
|---|---|
| three's render of the view (traversal, sorting, uniforms, GL calls) | 10.7–12.5 |
| Shadow map | 2.3–2.4 |
| Settlers' update | 1.0–1.1 |
| Buildings | 0.4 |
| Trees | 0.1–0.4 |

On the power branch (230 settlers) the throttled frame is 14.7–16.2 ms.

The real game loop (`rloop.mjs`, Chrome trace, 30 fps cap) at 1× (361 settlers):

| Thread | ms a rendered frame |
|---|---|
| Page main thread (simulation, HUD, render and DOM) | 5.1 |
| Of that, style + layout + pre-paint | 0.3 |
| Chrome's GPU process | 3.1 |

At 4× (195 settlers) the main thread takes 14.4 ms (12.8 of it JavaScript, 0.9 style and layout). **The DOM is not the problem; the render JavaScript is.**

`hud.update` averages 0.15–0.4 ms at 4×, with a p99 of 2.6–6 ms (the top bar's `innerHTML` every 0.5 s and the tabs).

### CPU: Chrome's GPU process

GL calls a frame at Low, HEAD:

| View | GL calls | Draws | Most frequent |
|---|---|---|---|
| Start | 1,357 | 136 | |
| Town, play zoom | 3,188 | 417 | uniformMatrix4fv 441, bindTexture / activeTexture 454, bindVertexArray 402 |
| Town, zoom 70 | 4,237 | 595 | uniformMatrix4fv 732 |

The play-zoom split: 2,096 in the view, 678 in the shadow pass, 21 in the post chain.

The power branch brings these to 991 / 2,547 / 2,858. The GPU process spent 2.4–3.1 ms a frame on them on the M5, about 1 µs a call. On a CPU 3–4× slower that is 8–12 ms a frame on a thread that does nothing else, and on Windows the D3D11 backend is no cheaper.

**On a machine with a weak CPU, the count of GL calls sets the frame rate as much as the GPU does.**

### The simulation

**Node** (M5, seed 199, hard AI against hard AI, 160 map; it ended at 33 minutes):

| | |
|---|---|
| Mean per tick | 0.034–0.050 ms (2–3 ms per game-second) |
| p99 | 0.4–1.0 ms |
| p99.9 | 1.0–2.0 ms |
| Max | 6.3 ms, in the first minute |

**In the page at 4×**, towns of 230–285 settlers:

| | |
|---|---|
| Mean | 0.75–2.3 ms |
| p99 | 10.6–13.3 ms |

A light town (195 settlers) had a mean of 0.04 ms and a p99 of 0.4 ms at 1×. The page's ticks in a busy town ran 3–10× Node's for a similar game. That is not explained yet and is worth a profile of its own.

What spikes:

- The half-second timers coincide on one tick (`game.ts:739–790`): `updateNature`, `updateMilitary` and `updateExplored` all fire every 0.5 s, and `updateEconomy` every 0.3 s.
- `updateExplored` (`game.ts:866`) reveals a disc around every building and settler of every player twice a second, moved or not, with a closure per node. It was a third of the sampled tick time in the page's profile.
- The AI's `buildStep`: an O(map) `territoryNodes()` scan per `tryPlace`, 420 scored samples, several tries per step (`ai.ts:574–664`).
- A* that can't reach its goal floods up to 40,000 nodes, with retries (`path.ts`, `settlers.ts:144`).
- `updateBarracks`: O(settlers) every tick while it waits (`economy.ts:224`).

The lockstep driver caps catch-up at 0.25 s a frame: up to 15 ticks at 1×, 60 at 4× (`lockstep.ts:84`). A slow frame is followed by a burst.

### Boot

Low, prefs already saved, `?play=1`:

| | Game up, 1× | Game up, 4× | Long tasks, 4× | Programs |
|---|---|---|---|---|
| HEAD | 3.6 s | 9.2 s | 27 tasks, 6.9 s total, worst 1.29 s | 244 |
| Power branch | 2.3 s | 6.7 s | 19 tasks, 5.2 s total, worst 0.90 s | 98 |

The throttle doesn't slow shader compilation, which happens in the GPU process. On Windows each program goes through HLSL and the D3D compiler. There the program count is the boot cost, and it is paid again for every world:

- `shapeWorld` replaces the canvas and `dispose()` calls `forceContextLoss` (`main.ts:250`, `renderer.ts:407`).
- `generateIcons` compiles the building materials once more in a WebGL context of its own (`icons.ts:21`), every page load.

### Memory

**GPU memory**, Low at 1080p, estimated from the code: about 190–220 MB in all.

| Resource | MB |
|---|---|
| Scene target: MSAA colour 32.5, MSAA depth 16.3, resolve 8.1 | 57 |
| Instance buffers | 30–45 |
| Building textures | about 23 |
| Terrain detail arrays | 16.8 |
| PMREM environment | 12.6 |

Nothing needs some of these at Low:

- the MSAA targets;
- the detail arrays;
- grass instance buffers, which `warmUp` uploads even with grass off;
- the half-size and blur targets made on the warm-up frame;
- the canvas's depth buffer (gone on the power branch).

**The JavaScript heap** is 105 MB in the town. The settlers' instance buffers are sized for 3,000 settlers (about 34 MB CPU, `settlers.ts:356`). The trees' are at least 20 MB.

On an integrated GPU, all of this is system RAM, and a 4 GB machine is capped at Medium by the detection anyway.

## The opportunities in detail

### 0. Land the power branch first

The branch (worktree `game-map-editor-api-68272d`) includes:

- shroud early exit;
- frozen building pieces;
- lamp uniforms sent only when they change;
- empty LOD passes skipped;
- one depth material per kind, so there are no program flips;
- programs keyed by their code (248 → 101);
- the camera coming to rest, and AO at half rate while it does;
- instances not resent while nothing moves;
- the snow gated on `uSnow`;
- no depth buffer on the canvas.

Everything in it helps a low-end machine more than the M5. `git merge-tree` shows one conflict, in `renderer.ts`. The rest of this list assumes it is in.

### 1. A lean Low shader

The terrain's close-up detail is 16–18% of a Low frame at the zooms people play at. The image-based light is another 8–10%.

For Low:

- Give `patchMaterial` (or the terrain alone) a `LOW` define that is part of `codeKey`, so the variant gets its own program.
- Force `detK = 0`. That leaves no detail arrays, no `textureGrad`, no flowers and no triplanar detail.
- Set `scene.environment = null`. The hemisphere light already gives the ambient; its intensity may need raising to keep the look.
- Skip the environment refresh too: a cube render and a PMREM filter every 1.5 game-seconds (`sky.ts:228`).
- Water keeps its sky colour from uniforms.

With detail off, the detail arrays needn't be painted or uploaded at Low:

- 6 layers painted on the main thread, one per 16 ms. The same day's GPU-offload survey (branch `szabadkai/gpu-offload-opportunities-d71ec6`) timed this at 2.0 s of JavaScript on the M5 in Node, in blocks of about 340 ms on the title screen. That is several seconds on a slow CPU.
- the 80 ms upload stall `terrainDetail.ts:448` records;
- 17 MB of GPU memory and 13 MB of CPU memory.

The same define can carry the trims that are free on the M5 but save fetches or ALU on an integrated GPU:

- 1 shadow tap instead of 5 (`shadowFit.ts:57`);
- no cloud shadow;
- no chromatic aberration or grain in the final pass;
- the rock's triplanar on its dominant axis only;
- anisotropy 1–2 instead of 8 on the building maps.

Screenshots at 30 and 60 units, with and without, should decide how much of the look survives. The detail only shows under about 66 units anyway.

### 2. A lighter shadow pass at Low

At the play zoom the shadow pass draws 559 k triangles in 163 draws with 678 GL calls, more triangles than the view. Its JavaScript costs 2.3–2.4 ms a frame at 4×.

A 1024 map at Low blurs small casters into nothing, so:

- **Buildings on the coarse model at every distance** at Low. Change `withFar(..., level)` at `renderer.ts:188`. It is about a fifth of the far model's triangles: 259 k → *est.* 50 k.
- **No shadows from small things** at Low: settlers, birds, deer and hares, pigs, wheat fields, vines, lanterns, signs, border posts. That is about 230 k triangles and about 80–90 draws.
  - The earlier finding that "settlers without shadows saved nothing" was on the M5 at High, where the pass is not triangle-bound. On a weak GPU and CPU the draws and vertices are the cost.
  - A blob or contact shadow in the settler shader would keep them grounded.
- **Half rate while the view is still.** Draw the shadow map every other frame while the camera matrices and the sun direction are unchanged, as `aoHalfRate` does for AO. Moving settlers' shadows lag a frame at 30 fps. At Low with settler shadows off, nothing moving casts anyway, except fields and trees in the wind.
- *est.* 559 k → about 130 k triangles, 163 → about 70 draws, and half of that on still frames.

### 3. Draw order (every level; pays off only on immediate-mode GPUs)

- **Sky last.** Draw the sky dome after the solid things with depth test on, like a standard skybox: a `renderOrder` above the opaques, depth write off. At the play zoom it covers nothing, so all its fragments are rejected early.
- **Terrain after the objects that stand on it.** Give the terrain a `renderOrder` after trees, buildings and settlers but before the cut-outs and water. Early-Z then skips its shader under the 27–43% of the screen they cover. The terrain writes depth and doesn't discard, so nothing else changes.

Neither can be measured on the M5: its tile-based GPU already shades only the front pixel. The expected gain on an Intel iGPU is the sky's full-screen pass plus 27–43% of the terrain's shading, *est.* 10–20% of a Low frame. It costs nothing where it doesn't help. The only risk is ordering bugs with things that depend on the terrain's depth (decals, rings), which draw after solid things anyway.

### 4. No MSAA at Low

The 4× RGBA16F target is 57 MB with its depth and resolve. On the M5 its cost moved between 0 and 14% of a Low frame from run to run. On a shared-memory iGPU, MSAA and its resolve are bandwidth, which is the scarcest thing it has.

Call `fx.setSamples(0)` from `applyQuality` for Low. At 70% the upscale softens edges anyway.

An FXAA or SMAA pass folded into the final pass would win back edges for about 0.3–0.5 ms on a weak GPU. That is a quality call; try it without first.

Measured, and not worth it: an R11G11B10F target made no difference on the M5.

### 5. The canvas at the render size at Low

At Low the final pass runs over the full canvas (2 Mpx at 1080p) while the scene is 1 Mpx, and it does the upscale and sharpening itself. Letting the canvas's drawing buffer be the render size (pixel ratio × scale, `fx.scale` 1) and the compositor stretch it saved about 8% at the play zoom.

The HUD is DOM and stays sharp. The sharpening would then work before the upscale rather than after, a small loss. Look at it side by side before deciding.

### 6. Automatic resolution on Low

Low is fixed at 70%; `framePace.auto` works only for High and Ultra (`AUTO_STEPS` 1 / 0.92 / 0.85). A Low that steps between 70% and 50% when the frame misses 30 fps covers the heavy moments: battles, the zoom-out, rain, weather particles. The 70 → 50 step is about 30% of a fill-bound frame.

Keep the detection's "stays on 50" for machines that miss even that.

### 7. Fewer GL calls and draws (every level)

After the power branch, a town frame at Low still makes 2,550–2,860 GL calls. The biggest remaining producers are:

- **Settlers**: about 37–41 draws in the view and as many in the shadow pass (`settlers.ts`, part batches per body part, near and far). A single instanced settler mesh with the pose in a bone or animation texture would make it a handful. That is large work but it scales with population. Item 2 already takes the shadow half away at Low.
- **Building batches**: 45 BatchedMeshes × passes. On the power branch it is about 12 calls a draw (map, normal map, matrix and index textures).
  - The GPU-offload survey measured buildings at 57–62% of all GL calls at High: 2,100–2,700 of 3,700–4,300.
  - It ranks the fix first: pick the building material in the shader (texture arrays, a material table, an index per vertex), so a few BatchedMeshes replace about 45.
  - That serves every level, and Low most.
- **Uniforms**: `uniformMatrix4fv` (441–732 a frame on HEAD) and the per-material textures. three has no UBOs for its own materials. The power branch's shared-uniform caching is the pattern to extend.

### 8. Per-frame CPU at Low

These are small alone and add up on a 4× slower CPU. None of them changes the look at Low.

| What | Where | Idea |
|---|---|---|
| Particles: up to 6,000 + 4,000, CPU-integrated, 6 attributes uploaded every frame | `particles.ts:133–193` | Cap at about 1,500 at Low, halve the emit rates, upload only what changes. |
| Trees: every tree culled and copied every frame. A full `rebuild()` of all trees whenever `treesVersion` moves, which is every 0.5 game-seconds while any tree grows. | `entities.ts:264–354`, `game.ts:804` | Rebuild only the growing trees; cull by chunks; skip the cull while the view is still. |
| Buildings: piles and lights built for every explored building, on screen or not | `buildings.ts:257–436` | Cull by the view rectangle; piles and lights at 4–10 Hz; no window lights by day. |
| Signs, donkeys, catapults: new `Matrix4`, `Quaternion` and `Map` objects every frame | `signs.ts:95–111`, `donkeys.ts:66`, `catapults.ts:103` | Reuse scratch objects; rebuild signs only when they change. |
| Deer not frustum-culled | `entities.ts:760` | Cull like the hares. |
| Hover picking: a new `Raycaster` per pick, a ground ray-march of up to 1,500 steps, `intersectObjects` over every building group (three ignores `visible`), repeated every 120 ms while the pointer rests | `camera.ts:460`, `renderer.ts:503–523`, `main.ts:1298` | Cache per pointer position and camera; march from the map's box; skip the resting refresh when nothing moved. |
| Minimap: a fresh full-map `ImageData` and a per-node blend every 0.4 s, 4 ground picks for the frame | `minimap.ts:125–203` | Reuse the buffer; every 1–2 s at Low; intersect the view with a plane. |
| HUD: the top bar's `innerHTML` rebuilt every 0.5 s; `clipMessages` reads layout after writing; stall badges read `clientWidth` every frame | `hud.ts:225–270`, `hud.ts:1789`, `stallBadges.ts:72` | Update only the numbers that changed; read layout before writing. |
| Autosave: a snapshot with `structuredClone`, IndexedDB's clone, and a JPEG thumbnail every 30 s on the main thread | `main.ts:96–151`, `save.ts:87` | `requestIdleCallback`; every 60–120 s at Low; the thumbnail only when leaving. |

### 9. Simulation spikes (lockstep-safe)

Anything in `src/game/` must stay deterministic, so budgets must be counts, not milliseconds.

- **Stagger the timers.** Give `natureT`, `militaryT`, `exploreT`, `checkT` and each player's `dispatchT` different phases, so that no tick carries them all. This is the cheapest fix, and a behaviour change only by a fraction of a second. Rerun the baselines with it.
- **Incremental exploration.** Reveal only for settlers that moved to a new node since the last pass, and for buildings when they change state.
- **The AI**: cache `territoryNodes()` and the ore and water counts per `ownerVersion`.
- **Pathfinding**: remember unreachable goals for a while, and lower `maxExpand` for settlers' walks.
- **`updateBarracks`**: on a timer like the economy's dispatch, not every tick.

Separately, find out why the page's ticks in a busy town ran 3–10× Node's.

### 10. Boot and loading

- **Keep one WebGL context across worlds.** Dispose the scene's objects but not the renderer, and don't `forceContextLoss`. Every load, restart and campaign region then reuses the compiled programs. On D3D11 this is seconds.
- **Icons**: draw them with the main renderer into a render target, or cache the PNGs in IndexedDB by build (`__BUILD__`). Today they compile the building materials in a second context on every page load.
- **Procedural textures and detail layers** (`textures.ts`, `terrainDetail.ts`): generate them in a worker or cache them in IndexedDB by build; use 256² at Low. The GPU-offload survey timed them at 1.4 s (building textures) and 2.0 s (detail layers) of main-thread JavaScript on the M5.
- **Tree and settler geometry and their meshopt simplification** are rebuilt for every `GameRenderer`, and `weld()` keys every vertex by a string (`lod.ts:22`). Cache them at module level like the building templates.

## A plan

1. **Merge the power branch** into this one and resolve `renderer.ts`. Rerun `cpu.mjs` and `probe2.mjs` as the new baseline.
2. **Low-only, one commit each**, each with before and after screenshots at 30, 60 and 95 units:
   - the shadow pass (coarse buildings, small casters off, half rate while still);
   - MSAA off;
   - canvas at the render size;
   - auto resolution 70 ↔ 50;
   - the lean shader (`LOW` define: detail off, no IBL, detail arrays not built; then the free trims);
   - particle caps.
3. **Every level:**
   - draw order (sky last, terrain after solid objects);
   - the per-frame CPU items in the table;
   - staggered simulation timers and incremental exploration, rechecked against `scripts/baseline.ts` and `scripts/lockstep.ts`.
4. **Refit the model.** Refit `COST.low` in `hardware.ts` to the new Low. Check that a UHD 620 at 1080p is guessed Low at 70% rather than sent straight to 50%.
5. **Boot**: one context across worlds, cached icons, worker textures.

## Checking on real hardware

The M5 can stand in for shares and counts but not for an immediate-mode GPU, D3D11 compile times or a hot laptop's sustained clocks.

The cheapest real test is an Intel UHD 620 / 630 laptop on Windows, the most common weak GPU in the target group. Iris Xe is a good second.

A `?bench=1` switch would let a tester report without tools. It could:

- grow the standard town;
- run the three zooms;
- print frame ms, the level chosen, GL calls, draws and programs;
- print boot times.

Measure first on such a machine:

- whether draw order (item 3) is worth what it should be;
- MSAA at Low;
- the time to the first frame on a cold shader cache.

## Appendix: the tools

The tools are in `perf-bench/lowend/` in the memory folder. They run with `cdp-driver.mjs` from that folder:

```
PRE="$(cat pre-low.js)" WIN=1920,1167 node cdp-driver.mjs "file://<build>/index.html?play=1&seed=199" <abs path>/<scenario>.mjs <outdir>
```

| Tool | What it does |
|---|---|
| `common.js` | In-page helpers: presets, a GL call counter over every WebGL2 method and `WEBGL_multi_draw`, scene owners (buildings first, see the trap below), tick and HUD quantiles. |
| `cpu.mjs` | JS per frame at 1× and 4×, subsystems, simulation ticks, HUD, GL calls. |
| `probe2.mjs` | Triangles and draws per pass, shadow casters, GL calls by phase, heap. |
| `order.mjs` | The main pass's draw order and how much of the screen objects cover. |
| `fill2.mjs` / `shade.mjs` / `shade2.mjs` | Fill-bound Low proportions with `PR=3 LODH=756`. `shade*` need a build with `window.__THREE` and `shadevar.js`. |
| `rloop.mjs` + `rsum.mjs` | Chrome trace of the real loop: ms per frame on each thread. |
| `boot.mjs` (+ `pre-boot.js`) | Boot times and long tasks under throttling. |
| `simcost.ts` | Node tick quantiles over an AI game. Copy it into the repo to run. |
| `simprof.mjs` + `profsum.mjs` | The page's tick profile. |

Traps:

- At Low sizes the M5 is CPU-bound, so throughput differences are JavaScript. Make it fill-bound with the pixel ratio first.
- `profile2.mjs`'s owner walk counts the building batches under `settlers`, because the settlers renderer reaches them first. `common.js` walks `buildings` first.
- A loaded machine (load 20+) made the pipeline CPU-bound and turned GPU deltas into noise.
