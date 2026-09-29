# Terra Nova roadmap

What's still to build, ordered by impact (re-prioritised 2026-09-28). Pick from the top unless told otherwise. When an item (or one of its slices) lands, delete it here in the same commit.

Rules that apply to every item:
- **Render-only work stays render-only.** Never draw from the game RNG in render code (use `Math.random` or a hash, as `pigs.ts` and `idle.ts` do). The headless baselines must stay bit-identical: `npx tsx scripts/baseline.ts passive 199 1 1`.
- **Anything with a new material** must be compiled in `GameRenderer.warmUp()`, or the first time it appears the game freezes for a frame. A material made per object and disposed when it is done with (sites, scorch marks) takes its shader with it: keep a sample alive (`warmKeep`, or a hidden prototype like the demolition's scorch mark).
- **Finished buildings are drawn in batches** (`src/render/buildingBatches.ts`, one draw per material): while batched, a building's own static meshes are hidden. Anything that changes a finished building's meshes or materials must take it out of the batches first, as burning does; moving parts (named movers), flags and sites stay separate meshes.
- **Instanced meshes** finish their writes with `commitInstances` / `uploadFirst`. Meshes that call `setColorAt` need `withInstanceColor()` when they're created (`src/render/instancing.ts`).
- **Each gameplay feature gets a headless check** in `scripts/`.
- **A new heavy effect gets its switch in each detection level** (`PRESETS` in `src/render/hardware.ts`, checked by `scripts/hardware.ts`): new players get the level their machine was timed to hold, so an effect that is on everywhere by default lands on machines that were never timed with it.

---

## 1. Cheaper frames at high resolution (performance)

At 3440×1440 the GPU is the limit: a 30-minute town takes about 10.5–11 ms of GPU time against 4–4.5 ms of CPU (the buildings are batched and the reflection draws only what the water shows, about 420–590 draws a frame). Measured by switching one thing off at a time: the shadow map costs 1.2–1.6 ms, 4× MSAA 0.8–1.7 ms and what is left of the reflection about 0.5 ms, and dropping to 70% resolution saves about 30%. The post chain in `postfx.ts` without AO (timed with the scene swapped for an empty one) is about 1.5–1.8 ms: the MSAA resolve and the final pass about 1 ms, the bloom about 0.45 ms and the tilt-shift blur 0.02–0.25 ms (0.07–0.53 ms before its wide part moved to half size). Ambient occlusion (on for High and Ultra) works at half size from the scene's own depth and takes 0.13–0.26 of what the old full-size pass did: a frame 1.04–1.21 times as long with it, where it was 1.4–1.9 (about +2–3 ms at 3440×1440 on a busy machine against +9–16 for the old pass; its occlusion pass is the biggest part, then the denoise).

- The shadow map and MSAA each cost more than the bloom and the blur together, so they come next.
- Passes are cheap only on an idle GPU: with other pages drawing on it the bloom's 12 small passes took 1.4–1.7 ms instead of 0.45, about 0.1 ms each however small. Folding passes together (as the bloom's bright pass now is, into its first blur) pays more on a busy machine than quiet measurements show.

## 2. Paths worn by traffic

Settlers 3 had no roads, so let the ground remember where people walk. Build a render-only traffic map at node resolution from settler positions, fading over a few game days. Where traffic is heavy, grass turns into dirt tracks through the terrain splat, and grass chunks lying on a path are flattened. Paths form on their own between the HQ, the woodcutters and the quarry, so your supply lines become visible. The same map can make grass part around walkers and leave footprints in snow. The terrain blending now works out only the few layers that can show at each pixel (`keep` in terrain.ts): a path layer has to take part in that choice.

## 3. A livelier UI

- Small icons pop out of a building as each good is made ("+1 plank"), using the existing `produced` event.
- Panels animate in and out, and numbers count up and down.

(The ring build menu was dropped.)

## 4. Morning mist and sun shafts

Height fog pools in valleys and over water at dawn and burns off by mid-morning, driven by the existing day cycle in `sky.ts`. Add sun shafts as a cheap screen-space pass (a radial blur of what blocks the sun, from depth), folded into the single final pass in `postfx.ts`. There's nothing like either yet. It costs GPU time, so it comes after the performance items.

## 5. Bigger maps

Buildings are batched (`buildingBatches.ts`), so a bigger town adds instances rather than draw calls, and the simulation has plenty of headroom: a 50 ms tick costs 0.05–0.08 ms on average (0.25 ms at the 95th percentile) at 10–45 minutes of AI-vs-AI, so it never needs a Web Worker. Today towns peak around 290 settlers and 90 buildings on the 160 map. Recheck the AI deadlocks listed in the balance notes on larger maps.

## 6. Photo mode

Hide the UI and use a free camera. Scrub the time of day and the season, and set the focus distance for the tilt-shift blur. It's cheap given what already exists.

## 7. More for warships

- **Landing troops on an enemy coast** first: it is what lets island wars be won.
- Boarding enemy ships.
- Deck archers shooting at soldiers on the shore.

## 8. A smarter AI army and economy

- **Formations**: the AI uses the formations players have (`planFormation` in `src/game/orders.ts`) for its attacks and defence.
- **More trade outposts**: `AIController.tradeStep` sets up only one far outpost (storehouse plus market). Let it add a second as its realm grows.

Either change will move the baselines on purpose. Record the new medians.
