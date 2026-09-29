# Terra Nova roadmap

What's still to build, ordered by impact (re-prioritised 2026-09-28). Pick from the top unless told otherwise. When an item (or one of its slices) lands, delete it here in the same commit.

Rules that apply to every item:
- **Render-only work stays render-only.** Never draw from the game RNG in render code (use `Math.random` or a hash, as `pigs.ts` and `idle.ts` do). The headless baselines must stay bit-identical: `npx tsx scripts/baseline.ts passive 199 1 1`.
- **Anything with a new material** must be compiled in `GameRenderer.warmUp()`, or the first time it appears the game freezes for a frame.
- **Instanced meshes** finish their writes with `commitInstances` / `uploadFirst`. Meshes that call `setColorAt` need `withInstanceColor()` when they're created (`src/render/instancing.ts`).
- **Each gameplay feature gets a headless check** in `scripts/`.

---

## 1. Batch the buildings (performance)

Building draw calls are the biggest CPU render cost. The last profile showed about 1,900 draws, taking 3.6 ms of the 5.6 ms the CPU spends rendering, in a 30-minute town at 3440×1440. The cost grows with the size of the town, so this is what keeps late-game towns fast, and item 7 needs it. Buildings don't move, so use one `BatchedMesh` per material, with near and far models as separate geometry ranges. Sites and burning buildings can stay separate. Watch the per-player `rekey`, the clip variants and the LOD switch. Measure with `perf-bench/` (see the performance memory), always comparing interleaved runs.

The simulation isn't the bottleneck. A 50 ms tick costs 0.05–0.08 ms on average (0.25 ms at the 95th percentile) at 10–45 minutes of AI-vs-AI, so moving it into a Web Worker gains nothing.

## 2. Pick the graphics level from the hardware (performance)

Everyone starts on High at their screen's full pixel ratio with bloom, the tilt-shift blur and (once item 6 lands) ambient occlusion on (`DEFAULT_RENDER_SETTINGS` in `renderer.ts`), whatever the machine: a laptop with an integrated GPU on a 4K screen crawls until the player finds the Quality setting, and a desktop with a big GPU never sees Ultra. The automatic resolution (`framePace.ts`) only trims the render scale to 85%, which is not enough to rescue weak hardware. Aim every machine at a level it can hold at its display's rate, once, and after that leave the settings to the player:

- **Detect once, on the first run** (no saved `prefs.render`), from the signals the browser gives: the GPU name from `WEBGL_debug_renderer_info` matched against a short table of known classes (Apple M-series, Intel Iris/UHD, Radeon/GeForce tiers, Adreno/Mali), the number of pixels the canvas would render at (`screen` × `devicePixelRatio`), `navigator.hardwareConcurrency`, `navigator.deviceMemory` and whether it is a touch device. Then confirm with a short **timed sample**: the warm-up scene already draws every material in `GameRenderer.warmUp()`, so time a few frames of it at the candidate level and step down if they miss the frame budget.
- **What each level sets.** The three post effects are the heaviest single costs measured so far, so they are the first to go: on a lower-end machine the defaults are **bloom off, ambient occlusion off and the tilt-shift blur (`dof`) off**, together with Low or Medium detail (pixel ratio 1, 1024 or 2048 shadow map, grass off on Low) and a fixed lower resolution setting. Mid-range machines get High with the effects on and Auto resolution; strong ones Ultra.
- **Say what was chosen**: a toast on the first run ("Set to Medium for this machine; change it in the menu"), and the menu's Detail level gets a "Recommended" mark on the detected level and a button to detect again.
- **Never change settings behind the player's back after that.** While playing, when frames keep running late (the frame pacer and the counter already know, and the automatic resolution is sitting on its lowest step), show one message: "The frame rate is low. Turning off bloom, ambient occlusion or the tilt-shift blur in the menu helps most", with a button that opens the Quality section. The message repeats no sooner than once a session, and nothing in the settings moves unless the player moves it.
- The detection must not touch the game: it is render and prefs only, and the headless baselines stay bit-identical. Give it a unit check that maps a table of fake signal sets (M1 laptop at 2×, 4K desktop with a GeForce, phone) to the expected level and effect switches.

Item 6 depends on this: ambient occlusion goes on by default only for the machines the detection puts on High or Ultra.

## 3. Paths worn by traffic

Settlers 3 had no roads, so let the ground remember where people walk. Build a render-only traffic map at node resolution from settler positions, fading over a few game days. Where traffic is heavy, grass turns into dirt tracks through the terrain splat, and grass chunks lying on a path are flattened. Paths form on their own between the HQ, the woodcutters and the quarry, so your supply lines become visible. The same map can make grass part around walkers and leave footprints in snow. The terrain blending now works out only the few layers that can show at each pixel (`keep` in terrain.ts): a path layer has to take part in that choice.

## 4. A livelier UI

- Small icons pop out of a building as each good is made ("+1 plank"), using the existing `produced` event.
- Panels animate in and out, and numbers count up and down.

(The ring build menu was dropped.)

## 5. Morning mist and sun shafts

Height fog pools in valleys and over water at dawn and burns off by mid-morning, driven by the existing day cycle in `sky.ts`. Add sun shafts as a cheap screen-space pass (a radial blur of what blocks the sun, from depth), folded into the single final pass in `postfx.ts`. There's nothing like either yet. It costs GPU time, so it comes after the performance items.

## 6. Ambient occlusion on by default for High

`GTAOPass` is already wired in `postfx.ts` but off by default. Switch it on for High once item 1 frees up the time (the terrain shader is already cheaper), and only where item 2 has found the machine can afford it.

## 7. Bigger maps

After item 1, since the simulation has plenty of headroom. Today towns peak around 290 settlers and 90 buildings on the 160 map. Recheck the AI deadlocks listed in the balance notes on larger maps.

## 8. Photo mode

Hide the UI and use a free camera. Scrub the time of day and the season, and set the focus distance for the tilt-shift blur. It's cheap given what already exists.

## 9. More for warships

- **Landing troops on an enemy coast** first: it is what lets island wars be won.
- Boarding enemy ships.
- Deck archers shooting at soldiers on the shore.

## 10. A smarter AI army and economy

- **Formations**: the AI uses the formations players have (`planFormation` in `src/game/orders.ts`) for its attacks and defence.
- **More trade outposts**: `AIController.tradeStep` sets up only one far outpost (storehouse plus market). Let it add a second as its realm grows.

Either change will move the baselines on purpose. Record the new medians.
