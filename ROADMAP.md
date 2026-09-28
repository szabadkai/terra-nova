# Terra Nova roadmap

What's still to build, ordered by impact (re-prioritised 2026-09-28). Pick from the top unless told otherwise. When an item (or one of its slices) lands, delete it here in the same commit.

Rules that apply to every item:
- **Render-only work stays render-only.** Never draw from the game RNG in render code (use `Math.random` or a hash, as `pigs.ts` and `idle.ts` do). The headless baselines must stay bit-identical: `npx tsx scripts/baseline.ts passive 199 1 1`.
- **Anything with a new material** must be compiled in `GameRenderer.warmUp()`, or the first time it appears the game freezes for a frame.
- **Instanced meshes** finish their writes with `commitInstances` / `uploadFirst`. Meshes that call `setColorAt` need `withInstanceColor()` when they're created (`src/render/instancing.ts`).
- **Each gameplay feature gets a headless check** in `scripts/`.

---

## 1. Cheaper terrain shader (performance)

The terrain shader reads 30–40 textures per pixel, 3–4 ms of GPU time. Store only the top two or three ground types per node (a type index plus a weight texture), so each pixel blends two or three layers instead of all of them. Check against screenshots from before the change with `imgdiff.mjs`.

Why this comes before batching the buildings: at 3440×1440 the GPU looks like the limit. Render CPU is 5.6 ms of a ~10 ms frame, yet dropping to 70% resolution saves 31% of the frame, which only happens when pixel work dominates. Confirm with one interleaved `perf-bench/` run before starting.

## 2. Smoother frames (performance)

Small jobs that pay off straight away on a 175 Hz screen; do them alongside item 1.

- **Automatic resolution**: the Resolution setting and sharpening already exist. Let frame time drive them, dropping towards 85% only in busy moments.
- **Water reflection** rendered at half the rate or half the size.
- **Frame cap option**, for example 87 fps (half of 175 Hz), so frames arrive evenly.

## 3. Batch the buildings (performance)

Building draw calls are the biggest CPU render cost. The last profile showed about 1,900 draws, taking 3.6 ms of the 5.6 ms the CPU spends rendering, in a 30-minute town at 3440×1440. The cost grows with the size of the town, so this is what keeps late-game towns fast, and item 8 needs it. Buildings don't move, so use one `BatchedMesh` per material, with near and far models as separate geometry ranges. Sites and burning buildings can stay separate. Watch the per-player `rekey`, the clip variants and the LOD switch. Measure with `perf-bench/` (see the performance memory), always comparing interleaved runs.

The simulation isn't the bottleneck. A 50 ms tick costs 0.05–0.08 ms on average (0.25 ms at the 95th percentile) at 10–45 minutes of AI-vs-AI, so moving it into a Web Worker gains nothing.

## 4. Paths worn by traffic

Settlers 3 had no roads, so let the ground remember where people walk. Build a render-only traffic map at node resolution from settler positions, fading over a few game days. Where traffic is heavy, grass turns into dirt tracks through the terrain splat, and grass chunks lying on a path are flattened. Paths form on their own between the HQ, the woodcutters and the quarry, so your supply lines become visible. The same map can make grass part around walkers and leave footprints in snow. Do it after item 1, which rewrites the same terrain blending.

## 5. A livelier UI

- Small icons pop out of a building as each good is made ("+1 plank"), using the existing `produced` event.
- Panels animate in and out, and numbers count up and down.

(The ring build menu was dropped.)

## 6. Morning mist and sun shafts

Height fog pools in valleys and over water at dawn and burns off by mid-morning, driven by the existing day cycle in `sky.ts`. Add sun shafts as a cheap screen-space pass (a radial blur of what blocks the sun, from depth), folded into the single final pass in `postfx.ts`. There's nothing like either yet. It costs GPU time, so it comes after the performance items.

## 7. Ambient occlusion on by default for High

`GTAOPass` is already wired in `postfx.ts` but off by default. Switch it on for High once items 1 and 3 free up the time.

## 8. Bigger maps

After item 3, since the simulation has plenty of headroom. Today towns peak around 290 settlers and 90 buildings on the 160 map. Recheck the AI deadlocks listed in the balance notes on larger maps.

## 9. Photo mode

Hide the UI and use a free camera. Scrub the time of day and the season, and set the focus distance for the tilt-shift blur. It's cheap given what already exists.

## 10. More for warships

- **Landing troops on an enemy coast** first: it is what lets island wars be won.
- Boarding enemy ships.
- Deck archers shooting at soldiers on the shore.

## 11. A smarter AI army and economy

- **Formations**: the AI uses the formations players have (`planFormation` in `src/game/orders.ts`) for its attacks and defence.
- **More trade outposts**: `AIController.tradeStep` sets up only one far outpost (storehouse plus market). Let it add a second as its realm grows.

Either change will move the baselines on purpose. Record the new medians.
