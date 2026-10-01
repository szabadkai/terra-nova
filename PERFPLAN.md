# Where the next performance comes from

Research done on 2026-10-01 on branch `szabadkai/performance-improvement-research-4ee94e`, over main 6caccbd. The first phase was carried out on the same branch the same day. The bench scripts are in the memory folder, under `perf-bench/` and `perf-bench/lowend/`. Times come from an Apple M5 Pro. Nothing here has been measured on an Intel or AMD machine.

## Where it stands (2026-10-01)

**What this branch did.** Measured at 3440x1440, High with ambient occlusion, a 25-minute town (seed 199), with the view standing still. Each figure is the minimum of in-page interleaved samples (`abmin.mjs`'s method), with both builds alternated twice.

| Change | Measured |
|---|---|
| The night lights through a grid of the lamps' reach (`lightGrid` in `src/render/shaderPatch.ts`): a pixel works out only the lamps whose light reaches its cell, a bit for each of the 32 in one texel | Night frame 9.8 → 8.6 ms at the play zoom (−13%), 8.4 → 7.5 ms at 14 units, 5.9 → 5.0-5.2 ms at 95. The lamps cost 2.0 ms of the frame before, 0.9 after. Pixel-identical at Low |
| The ambient occlusion is held four frames instead of two while the view stands still (`PostFX.aoHold`) | −0.21 to −0.27 ms on a still view. One working-out costs about 1 ms |
| The half-size copy of the scene is no longer drawn when nothing reads it (occlusion on, bloom and blur off: the Ultra preset) | About −0.1 to −0.15 ms (the day frame is −0.35 to −0.45 ms with the hold above) |
| The water's reflection is drawn three times less often once the view has come to rest, twice less in quiet mode, unless a ship is in view | Only 0.11-0.14 ms in all at the shore measured, −0.07 to −0.12 ms of it. The pass is ~700 GL calls, so a still shore view makes about a third fewer calls a frame (2,500 → 1,800 on most frames) |
| The sun's shadow taps are skipped where a pixel faces away from the sun (`shadowFit.ts`) | Within 0.05 ms on the M5. The output is the same to the bit |
| The stones' close-up detail lookups are skipped past the distance that fades them out | Not measurable alone. Exact |
| A paused game rests at about 30 frames a second once the player has touched nothing for 3 s; a game alone under the Esc menu at about 10 (the graphics page keeps 30); the map editor at 30 when nothing is touched (`Rest` 'idle', `IDLE_FPS`) | Paused: 60 → 30 fps; menu: 30 → 10 fps. At Low the menu was no rest at all before (its cap is 30) |
| The stall badges' bob and the tutorial's glow pause while the frames rest (`#ui.resting`) | No compositor frames at the display rate while resting with a badge in view (not measured: needs a headed browser) |
| With the sound off the audio context is suspended (after its fade); the hidden-tab pump worker runs only in a game with a friend | One audio thread and one worker fewer for every solo player with the sound off |
| The autosave copies the game once instead of twice when the database writes at once | Not measured (one deep copy of ~50k properties less every 30 s) |
| Low lays out no grass patches (they were built and uploaded although Low never draws them) | 7.8 MB of instance buffers and their upload not made at Low |
| A world built while the terrain-detail worker still paints gets the whole arrays on its new context (`detailContextLost`) | A bug fix: before, the layers painted before the switch stayed empty on the new GPU |
| The lamps whose reach misses the view are left out of the 32 the shaders get | No speed: in a town the 32 left are all in view. A small fix: lamps at the far end of the view were missing before when nearer off-screen ones took their places |

**Tried and taken back.** A per-lamp early-out in the old 32-lamp loop (`if (dist2 >= r*r) continue`) made the loop half as dear again on the M5 (2.0 → 3.4 ms): the branch stopped the compiler from scheduling the loop. The grid takes the same lamps out without a branch per pixel.

**Checks.** `tsc`; `scripts/baseline.ts passive 199 1 1` identical; `framepace.ts` (with the new rest), `hardware.ts`, `shadowfit.ts`, `camera.ts`, `saveload.ts`, `path.ts`, `wildlife.ts`, `lockstep.ts` pass. Pixel parity against main in 24 views (High+AO and Low, the HQ and a shore, zooms 14/30/95, noon and midnight): Low identical but for one close night view, where lamps at the far end are now lit (brighter only); High within the noise of recompiled shaders under 4x MSAA (single pixels on leaf edges, by day as at night).

## How this was researched

Nine readers took one area each:

- the main-pass shaders;
- the post chain and render targets;
- the shadow map and the reflection;
- draw submission and GL calls;
- per-frame render JavaScript and the HUD;
- the simulation;
- boot, loading and memory;
- frame pacing, idle and power;
- architecture-level options.

They made 79 findings. Each was then checked by skeptics against the code and the measured numbers: what the code really does, whether it was already built or measured and rejected, and whether the gain survives. They refuted the value of 24 and put about 15 more under 1% of a frame on every machine. A completeness pass looked for files and angles nobody had read.

The recurring correction: JavaScript saved on the main thread was counted as frame time on the M5, whose frame is GPU-bound. It is power, or a hitch, not frame time there.

The machines it was judged for:

| | Machine | Bound by | A gain is |
|---|---|---|---|
| A | M5 Pro, 3440x1440, 175 Hz | the GPU (~10 ms); the GPU process ~4 ms for ~3,250 GL calls; JS ~4.6 ms | GPU ms |
| B | laptops on battery, quiet mode | heat | work per second, wakeups |
| C | Intel UHD 620 / Iris Xe, 1080p, Windows | GPU fill; a slow CPU; slow compiles | Low at 30 fps at 70%; boot; no spike above 33 ms |

## What is left, ranked

### The GPU frame (A, and C at night)

| Item | Expected | Effort |
|---|---|---|
| FXAA (or SMAA) as an anti-aliasing mode instead of 4x MSAA on High: the final pass into an LDR target, the AA pass after it, grain and sharpening after that | MSAA's measured ceiling is 0.77-0.95 ms (12-21% of a day frame), so FXAA should net about 0.3-0.6 ms; thin masts and posts shimmer, textures soften. A player's option | M |
| Skip the reflection where only the sky can show (open sea, bare shores), with the clouds and the moon added to the water's sky term | 0.4-1 ms on such views; how often they occur is unmeasured | M-L |
| Accumulate the occlusion over frames while the view moves (reprojected history, 4 samples instead of 12, 8 denoise taps) | 0.35-0.6 ms while moving | M |
| Spherical-harmonics light on the rough materials at High, the environment map kept for the glossy ones | The environment map's measured ceiling is 0.67-0.71 ms near, 0.33-0.36 far (twice the estimate); keeping it on the glossy set, perhaps 0.4-0.5 ms | M-L |
| The occlusion at 0.4 of the scene instead of 0.5 under the automatic resolution and in quiet mode | 0.2-0.3 ms on quiet Ultra laptops | S-M |
| Indexed building pieces (all three models and the batches together) | ≤1% on A, 1-3% as heat, est. 1-2% on Intel | M |
| Temporal AA with upscaling | Most of its gain is fewer pixels, which the resolution setting gives already; a net cost on Intel | XL, after FXAA |

### Heat and GL calls (B, C)

| Item | Expected | Effort |
|---|---|---|
| Merge a finished building's pieces into one sub-draw per level and family at batch-add time (today one per material piece: 500-900 emulated draws a frame) | −0.1..−0.65 ms of GPU-process CPU on the M5; on D3D11 perhaps −1..−5 ms if a draw costs the usual 2-8 µs. Measure the cost of one sub-draw first | M |
| Small casters out of the shadow pass by screen size at every level (as Low does under 20 units) | ~0.35-0.4 ms of CPU a frame zoomed out, no GPU change; shadows of settlers far out: a call by eye | S |
| Timer-led animation frames in the rests (on a 175 Hz screen the page wakes 175 times a second to draw 30) | ~120 fewer wakeups a second at rest; the pacer's `track` must learn the period from `dt / every()` | S-M |
| An opaque canvas (`alpha: false` through a context made for three) | 0 on macOS; 0.3-0.5 ms of compositor time a frame on Windows laptops (unmeasured) | S |

### Spikes and boot (C)

| Item | Expected | Effort |
|---|---|---|
| A `?bench=1` report page (frame ms per level and zoom, GL calls, boot times, the GPU) to get the first Intel numbers | Decides every tier-C figure here | M |
| The AI's `buildStep` caches (`waterInTerritory`, ores, `territoryNodes`, exact on `ownerVersion` and a new `oreVersion`) | A 256/4p buildStep 3-24 → 2-12 ms at 4x CPU | S |
| The terrain's dirty paths: any dig forces a whole AO bake, every field or mined ore a whole-map pass and upload (found by the completeness pass, not yet verified) | est. 3-4 ms at 4x per dig | M |
| A battle order starts A* for every soldier in one tick (found by the completeness pass, not yet verified) | tens of ms in one tick on A; a hitch | M, moves the baselines |
| Reach labels on the path finder, so a target walled in by rocks fails at once instead of flooding the landmass | 0 in steady state; the rare case 26 ms a search | S-M |
| The building textures painted in a worker, like the terrain detail | 0.45 s of main thread at Low at 4x, ~1.8 s at Medium | M |
| The procedural geometry and its ~70 simplifications kept between worlds; a numeric key in `weld` | −0.4..1 s a world switch at 4x | S-M |
| The first frame's programs compiled in parallel (post passes, depth twins, the HQ) | count them first; the "44" is stale | M-L |
| Icons on a cache miss in one compile and encoded off the main thread; the fonts self-hosted | first runs only | S each |

## Dropped (so nobody proposes them again)

- **Settlers or goods piles as BatchedMeshes.** three r186 has no instanced multi-draw, so each settler would become ~10 sub-draws: 800-2,000 emulated draws a pass against ~45 instanced draws today.
- **A kept static-caster shadow map.** The fitted map follows the view, the sun moves a tall caster's shadow a texel every 3-13 frames, the trees sway in their depth shader, and a depth copy costs more than it saves.
- **A baked far-terrain colour.** No ground lies past 66 units at the play zoom; 2-5% at zoom 95 for L-XL work.
- **The families' table row in one texel.** The four fetches load one 64-byte row in parallel: ~0.01-0.04 ms.
- **Per-fragment constants** (cloud shadow, view-space sun, wake sin/cos, season colours). Measured within noise on the M5.
- **A leaner terrain in the reflection.** The mirrored camera sees only steep slopes: under 0.2%.
- **Staggering the simulation's timers.** There is no all-timers tick: in doubles the timers fire every 31/19/91/121 ticks and only the half-second group coincides, ~0.13-0.2 ms at 1x. Not worth moving the baselines.
- **Under 1% of a frame everywhere:** UBOs for the shared uniforms, fixed texture units, flags as one instanced mesh, culling building groups, the deer cull, hover picking, the opaque sort's lookups, render allocations, combat and economy scan lists, the state hash cache, simulation allocations, an atan2 table, code-splitting, particles interleaved, bloom from a quarter-size start, a viewport sub-rectangle for the resolution steps, a GPU-load signal for quiet mode, the canvas at the world's size in quiet mode.

## Corrections to the earlier notes

- The "lights 0.6 ms" terrain share in the notes was not the lamp loop (`terr.mjs`'s `lights:false` hid the sun at a daytime hour). The loop was 2 ms of a night frame.
- The "44 programs on the first frame" is from before code-keyed programs.
- The shadow pass's 0.41-0.48 ms was timed on the old 4096 map.
- The reflection's "1.3-3 ms GPU + 1.65 ms CPU a draw" is from before the specks left it; at the shore measured it was 0.11-0.14 ms in all.
- LOWEND's page tick figures are from before the trapped-hare fix and the reveal cache; its HUD p99 was measured with the Build tab open.
- WEBGL_multisampled_render_to_texture: three r186 uses it for any multisampled target when Chrome exposes it. The measured resolve blit means Chrome did not, on the M5.

## Measured so far in the first round of "measure first"

At 3440x1440, High with AO, by day, still view, `ab2.mjs`, two runs:

| Taken away | Play zoom (30) | Far (95) | Close (14) |
|---|---|---|---|
| MSAA (samples 0) | −0.87..−0.93 ms | −0.95 ms | −0.77..−0.84 ms |
| The environment map (the light probe alone, as Low) | −0.67..−0.70 ms | −0.33..−0.36 ms | −0.67..−0.71 ms |
| Resolution 85% | −1.25 ms | −0.62..−0.65 ms | −1.15 ms |
| The night lamps (before the grid) | −2.0 ms | −0.85..−0.92 ms | −1.67 ms |
| One working-out of the occlusion | about 1 ms | | |

Chrome on the M5 (ANGLE Metal) exposes neither `WEBGL_multisampled_render_to_texture` (so MSAA's store and resolve cannot be had for free) nor `WEBGL_multi_draw_instanced_base_vertex_base_instance` (so the settlers cannot be one instanced multi-draw). It has 16 texture units a fragment shader; a patched terrain program uses about 14.

## Measure first (before the items it gates)

| Measurement | Tool and scenario | Decides |
|---|---|---|
| The MSAA ceiling and an FXAA pass | `abmin.mjs`, base vs `gr.fx.setSamples(0)` (re-apply after `applyQuality`), then an in-page FXAA quad; `fxshots.mjs` crops of masts, posts, shorelines | FXAA vs TAA |
| How often only the sky shows in the reflection | a camera tour drawing the reflection with the sky dome hidden and counting non-clear texels | the reflection skip |
| The occlusion's moving cost | `abmin.mjs` with `gr.fx.aoHalfRate = false`, then 4 samples and 8 taps in a bench build | temporal occlusion |
| One emulated sub-draw's cost | `trace.mjs` (GPU-process ms a frame) with each family's draw list padded by ~2,500 one-triangle sub-draws; then on Intel | the sub-draw merge |
| The simulation on current main | `lowend/simprof.mjs` at 1x and 4x over ≥3,600 ticks; `simcost.ts` on seed 7 (4p/256) with `buildStep` wrapped | the AI caches, reach labels |
| Hitches | `hitchloop.mjs` 3 minutes at 1x and 4x with the autosave, `structuredClone` and `put` wrapped; a scripted 200-soldier order; heavy levelling | the terrain paths, battle orders |
| Boot | `lowend/boot.mjs` at 1x and 4x, programs compiled in the first frame counted | the boot items |
| Intel | the `?bench=1` page on a UHD 620 and an Iris Xe laptop | every tier-C number |

**A cross-build pixel check that holds** (used for this branch): seed `Math.random` and stub `requestAnimationFrame` in the page's PRE script, grow the same town, then before each view set `gr.time` to a fixed value and hide the particles, pigs, birds and settlers (warm-up frames differ in number between builds, and those draw from `Math.random` or the render clock), and end with 8 frames at `dt` 0. The scripts (`parity.mjs`, `pre-parity.js`, `signed.cjs`, and `ab2.mjs` for the timings) are in the memory folder's `perf-bench/perfplan/`.

## Continue here: decided on 2026-10-01, built the same day

The user answered the six open questions on 2026-10-01. The designs below are what the code reading came to; each item says what was built and measured (branch `szabadkai/perfplan-six-items-5ddafd`, one commit each).

**1. FXAA as an anti-aliasing mode: yes.** Off by default (MSAA stays the default look).

- `RenderSettings.antialias: 'msaa' | 'fxaa' | 'off'` (default `'msaa'`; missing in old saved prefs, so `merge` gives the default). `applyQuality` sets `fx.setSamples(0)` for `'fxaa'` and `'off'`, else today's samples per level.
- `PostFX`: with FXAA the final pass renders into an RGBA8 target of the canvas's size (it writes sRGB bytes itself, so the target needs no colour-space conversion), then an FXAA pass draws that to the canvas. Port the fragment of three's `examples/jsm/shaders/FXAAShader.js` (Catlike Coding's FXAA: 9 taps, then up to 12 along the edge) to a `rawPass` with `QUAD_VS`; it uses GLSL3 syntax (`texture`, a `float[]` constant), so either set `glslVersion: THREE.GLSL3` on it or rewrite those lines in the GLSL1 style of the other passes. Grain (0.008) stays under FXAA's 0.0312 contrast threshold, so it can stay in the final pass.
- Compile the FXAA pass in `PostFX.warm`'s first frame, whether it is on or not, so switching it on compiles nothing.
- Menu: a segmented control on the graphics page, after Resolution ("Smooth edges: Multisampling / FXAA / Off", with the costs in its description).
- Check: `ab2.mjs` at 3440x1440 High+AO, `frame` vs `antialias = 'fxaa'` (expected 0.3-0.6 ms net of the 0.8-0.95 ms MSAA ceiling); `fxshots.mjs` + `pngdiff.mjs` crops of masts, lantern posts and a shoreline, and a half-pixel camera slide for shimmer.
- **Built** (`FxaaShader` in `postfx.ts`, the final pass into `ldrRT`; compiled on the first frame through the blur's target: 95 programs before and after switching it on). `ab2.mjs` at 3440x1440 High+AO, 12 interleaved rounds on a quiet machine, against Multisampling (4x): FXAA −0.39 ms at the play zoom (7.29 → 6.90), −0.83 far (4.52 → 3.69), −0.34 close (6.27 → 5.93), −0.67 at night (8.63 → 7.96); Off −0.83..−0.95. So the FXAA pass itself costs 0.12-0.5 ms, more in a close view full of edges. By eye (2x crops at 14 units): roof and post edges as smooth as under MSAA where Off shows stairs, the tiles and the stone a little softer. The half-pixel slide did not measure shimmer: the whole picture shifts, so FXAA's softer picture differs less (17-20% of pixels vs 20-23%); judge the shimmer in a real browser. Switching works at High and Low (Low's canvas is the world's size, which `ldrRT` follows).
- Trap found on the way: `Page.captureScreenshot`, and an eval returning a ~5 MB data URL, can hang the CDP driver for good at 1720x1000; return crops drawn into a small 2D canvas instead.

**2. Small things' shadows by their size on screen, at every level: yes.**

- In the wrapped `shadowMap.render` (`renderer.ts`, the `const skip = low && this.cam.dist >= LOW_SMALL_SHADOWS ? ...` line) skip the small casters when `lodView.K * 0.9 / this.cam.dist < SMALL_SHADOW_PX[quality]`, the height in pixels of a settler at the view's target (`lodView.K` = the target's height in pixels / (2 tan(fov / 2)), fov 36°).
- Thresholds: Low 52 px (exactly Low's 20 units at 1080p and 70%), Medium 35, High 25, Ultra 20. At 3440x1440 High the shadows then go beyond ~80 units, on a quiet laptop beyond ~63, at Medium 1080p beyond ~36.
- Rename `lowShadowSkip` to `smallCasters` and drop `LOW_SMALL_SHADOWS`; the Rules' paragraph on the three models names both.
- Check: `glowner.mjs` calls per pass at zooms 60 and 95 before and after; screenshots across the threshold by eye.
- **Built.** At 3440x1440 High+AO (25-minute town, seed 199; K 2216, so the threshold is at 80 units): zoom 60 and 75 unchanged; at 85 and 95 a frame with the shadow map drawn makes 172 fewer GL calls (2,143 → 1,971 and 2,173 → 2,001), 78 fewer draws and 0.24 M fewer triangles. In-page A/B on the same frames: the frame's JavaScript −0.2 ms (median, shadow map every frame), the GPU-bound frame time unchanged within 0.1 ms (the triangles were cheap for the M5). By eye at a laptop's 900 pixels (a settler 15 px tall): no visible difference, 0.26% of the pixels differ by more than 24 levels.

**3. The rests can go lower than 30 (paused) and 10 (Esc menu).** Proposed:

- A paused game and the editor, both after 3 s untouched: 15 frames a second. This needs a new rest, `'pause'` with `PAUSE_FPS` 15, in `framePace.every()`.
- A game alone under the Esc menu: 5 (`IDLE_FPS` 10 → 5). The graphics page keeps 30.
- `scripts/framepace.ts` gets the new cases; the Rules' "Frames nobody needs are not drawn" names the rates.
- **Built.** `rest.mjs` (headless, 1600x900, a 60 Hz display): paused and idle 3 s 30 → 15 fps, the Esc menu 10 → 5 fps, its graphics page 30 as before. A rest's frame may take up to 0.25 s of render time (it was clamped at 0.1), so water, smoke and clouds keep their pace at 5 a second. On a 175 Hz display the pause is every 12th frame (14.6 fps), the menu every 35th.

**4. Suspend the audio in a hidden tab with the sound on: yes**, for the title screen and solo games. Not in a game with a friend: an audible tab is exempt from Chrome's tab freezing, which the hidden-tab pump relies on.

- `Audio.setHidden(hidden)`: on hide, suspend the context and pause the soundtrack element. Its `onpause` marks `trackBlocked`, so `unlock()` (called on `visibilitychange` to visible) plays it again.
- In `main.ts`'s `visibilitychange` handler: `audio.setHidden(hidden && !(state === 'play' && net))`, keeping `recoverAudio()` on visible. Only resume the context if the volume is above 0 (the mute rule).
- Check: `rest.mjs` (its PRE wraps `AudioContext`) with a CDP `Page.setWebLifecycleState` or a second tab brought to the front.
- **Built.** Checked headless with the sound on and the soundtrack playing, the page's visibility faked in-page (`document.hidden` and a `visibilitychange`): hidden 1.5 s, the context goes from running to suspended and the track pauses (on main both kept running); shown again, both run. A track or a narration line that comes due while hidden waits for the page to show. With the sound off the context stays asleep when shown.

**5. Changes that move the simulation baselines: allowed.** Measure first, then re-record the baselines (`scripts/baseline.ts` passive and aivai) in the same commit:

- **Battle orders.** A group order re-targets the whole army at once (`orders.ts` ~288-306), and every standing soldier then runs A* in the same tick (`military.ts` ~532-538 → `settlers.ts` ~136-146). Measure with `hitchloop.mjs` and a scripted 200-soldier order. If it is a hitch, spread the walks with a per-tick path budget, a count rather than milliseconds.
- **Walled-in targets.** `world.region` ignores `blocked`, so a walk to a tree, stone or hare walled in by rocks floods the whole landmass, and the worker keeps re-picking it. Fix in two steps:
  - Exact, keeps the baselines: reach labels on `PathFinder` (not on World, whose arrays are saved), relabelled lazily on a `blockedVersion` bump; `find` returns null at once when the labels differ.
  - Moves the baselines: target choice that skips walled-in targets.
  - First count `find` failures over 5,000 expansions in `simcost.ts` over 10 seeds.
- The timer stagger stays dropped (under 1%, see Dropped).
- **Built: reach labels** (`PathFinder.labels`, 4-connected areas of walkable nodes, which is exactly what the 8-way search with no corner cutting reaches; relabelled on the first search after `World.walkVersion` moves, which every writer of `blocked`, a footprint's levelling and a dig that turns land into water bump; a loaded game starts fresh). Exact: the state hash every 5 minutes of 30-minute AI games is identical to main on seeds 1-10 (160/2p, level 2), and `baseline.ts` passive and aivai give the same result on seeds 99-499. Measured first with the find wrapped: on seeds 4 and 6, 99.4-99.5% of all path expansions went into failed floods to two targets each, 10-12k times a game (290 M and 256 M expansions in 30 minutes). Simulation time for those 30 minutes: seed 4 91.7 → 10.4 s, seed 6 69.3 → 10.1 s, seed 7 14.0 → 10.6 s, the rest unchanged; aivai 299 41.7 → 15.0 s, 499 33.2 → 20.7 s.
- What the walled-in targets were: not trees or hares but construction sites cut off by other buildings and stones (carriers bringing boards to it, its builders, diggers shut inside, a soldier sent there). They now fail at once, but the workers still pick them again: choosing a reachable site instead is a gameplay change in four jobs (carriers, builders, diggers, soldiers), left for later. It would move the baselines.
- **Built: a path budget for soldiers** (`SOLDIER_PATH_BUDGET`, 12,000 expansions a step in `runAction`: a soldier starts a new walk only while the step has searched fewer nodes than that). Measured first (`order200.ts`, 200 or 400 soldiers ordered 100-120 units away, 256/2p): the walks did not all start in one tick but bunched into a few, 46 and 67 searches (51k and 84k expansions) in single ticks. Worst tick after the order, three interleaved rounds on a loaded machine: main 19.5-52.7 ms, now 7.0-14.0 ms. The AI's own attacks never reach the budget: the hashes and baselines above are unchanged with it, so nothing needed re-recording.
- Left: the order itself (`planFormation`) takes 6-23 ms for 200-400 men in the click that gives it.

**6. Autosave every 30 s is fine; expose it as a setting.**

- `prefs.autosave`, seconds of real time: 30 (default), 60, 120, 300, or 0 = only when leaving. `main.ts` reads it in place of `AUTOSAVE_EVERY`, clamping `autosaveT` when the interval is shortened.
- The save on `pagehide` and on hiding the page stays in every case (the resume feature needs it).
- The control: a select on the Save page of the Esc menu (`renderSave` in `gameMenu.ts`).
- **Built.** Checked headless over 65 s of real play (IndexedDB `put`s counted, two to a save): 30 s → 2 saves on main and here, 60 s → 1, the Save page lists "Every 30 s | Every 1 min | Every 2 min | Every 5 min | Only when leaving". A value that is not one of `AUTOSAVE_CHOICES` loads as 30.

After these, the order stays as above: the remaining measurements (the sub-draw cost, the simulation, hitches, boot), then the GPU items, heat, spikes and boot in the ranked tables, and the `?bench=1` page for the first Intel numbers.
