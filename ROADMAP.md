# Terra Nova roadmap

What's still to build, ordered by impact (re-prioritised 2026-09-28). Pick from the top unless told otherwise. When an item (or one of its slices) lands, delete it here in the same commit.

Rules that apply to every item:
- **Render-only work stays render-only.** Never draw from the game RNG in render code (use `Math.random` or a hash, as `pigs.ts` and `idle.ts` do). The headless baselines must stay bit-identical: `npx tsx scripts/baseline.ts passive 199 1 1`.
- **Anything with a new material** must be compiled in `GameRenderer.warmUp()`, or the first time it appears the game freezes for a frame.
- **Instanced meshes** finish their writes with `commitInstances` / `uploadFirst`. Meshes that call `setColorAt` need `withInstanceColor()` when they're created (`src/render/instancing.ts`).
- **Each gameplay feature gets a headless check** in `scripts/`.

---

## 1. Economy at a glance: no more clicking round for the stall

This was the biggest frustration in Settlers 3, and Terra Nova still has it. The game knows about 30 reasons a building has stopped ("Missing tool: pickaxe", "Waiting for coal", "No fish in range", "Output storage full", "Deposit exhausted"...). But `b.status` is a string, and it only shows inside that building's panel (`src/ui/hud.ts` `status` div, around line 1220). Ship it in slices, in this order:

- **a. Structured statuses, stall badges, warning counter.** Replace the strings with data such as `{ kind: 'input', good: 'coal' }` or `{ kind: 'tool', good: 'pickaxe' }` (keep the text for the panel). Stall badges: the icon of the missing good, tool or worker floats over the roof; buildings that are working show nothing; zoomed out, the badge shrinks to a small tinted marker. A warning counter in the top bar (⚠ 4): a click or a hotkey moves the camera from one stalled building to the next, like the idle-worker button in an RTS. This slice is most of the value, and item 2's "waiting shows the stall" reads these statuses.
- **b. Messages for silent failures, as clickable toasts.** A mine running dry only sets its status (`src/game/economy.ts:152`) and sends no message. It should raise one, with a jump to the mine and a hint to send a geologist. Also cover "no free settlers" (the residence cap) and a toolsmith with no iron. Messages slide in as toasts that jump the camera to their source when clicked.
- **c. Cause chain.** With structured statuses the game can walk upstream: *weaponsmith waiting for iron → smelter waiting for coal → coal mine waiting for food → both fishers: no fish in range*. Show it in the building panel. The same walk lets the headless balance runs report AI stalls (residence cap, worked-out mines) instead of finding them by hand.
- **d. Goods flow.** The Economy tab shows how much of each good is made and used per 10 minutes, with a trend, next to the stock counts. The Statistics tab currently only charts population and soldiers.

## 2. Workers at work in their workshops

In Settlers 3 you could watch the smelter at the furnace and the toolsmith hammering out a tool. Terra Nova's workshop models already have the stations in the yard, as in the original: the toolsmith's hearth, anvil and water barrel (`hearth()` in `src/render/buildingModels.ts`), and the smelter's furnace, cauldron and ore heaps. But the worker disappears for the whole production cycle. `workerThink` in `src/game/work.ts` says "indoor workers simply stay inside", `enter()` sets `s.hidden`, and production is just a timer (`updateProduction` in `economy.ts`: `b.working`, `b.workT` running up to `def.cycle`).

Build a render-only work director, in the style of `pigs.ts` and `idle.ts`. While `b.working` is set, it draws the building's worker at the yard stations, timing a scripted scene against `b.workT / def.cycle`. The last part of each scene is carrying the finished good to the pile, landing just as `b.stock` goes up. The simulation stays exactly as it is.

- **Toolsmith** (cycle 10 s): fetches an iron bar, heats it in the hearth (the metal glows orange, the coals flare), then hammers it on the anvil with sparks and the existing `anvil`/`clang` sounds. The hammer strikes line up with the clangs. The piece takes the shape of the tool actually being made (`curOut`: axe, pickaxe, saw, hammer, shovel, scythe or rod) and is quenched in the barrel with a puff of steam. The smith holds it up, then puts it on the pile.
- **Iron and gold smelters** (8 s): shovel ore and coal into the furnace mouth, work the bellows so the fire brightens, then tip the glowing crucible so a molten stream fills a mould. The bar cools from orange to grey or gold and goes on the stack.
- **Weaponsmith** (10 s): heats and hammers a blade, sharpens it on a grinding wheel with a spray of sparks, then tries a swing. Bows: shapes the stave, strings it, tests the draw.
- **Sawmill** (6 s): a log on the trestle, sawn with a two-handed saw, sawdust falling and boards stacking up. The original showed this too (`R_Carpenter_Work*` in the reference animation data).
- **Bakery** (7 s): kneads dough at a table, slides loaves into the oven on a peel, the oven glows.
- **Mines**: a tub rolls out along the existing rails (`railway()`), the miner tips the ore onto the heap and throws spoil aside. On an exhausted deposit he comes out and shrugs (the reference has `R_Miner*_Fail`).
- **Also**: the mill (miller carrying sacks), the slaughterhouse (a cleaver at the block, kept cartoonish), the temple (the priest pours wine at the altar), the barracks (sparring with a dummy) and the siege workshop (the catapult frame gets parts added one by one as `shipProgress` rises).
- **Waiting shows the stall** (needs item 1a): when a workshop is waiting for an input, the worker sits on the step, looks at the empty pile or down the road. When the output pile is full, he stands beside it with arms folded. You can see the stall without clicking.
- **Keep it cheap**: only buildings in view and close enough (`lodView.cull` / `px`), and a few posed joints on the existing chibi rig (`Pose` in `idle.ts`). Held pieces reuse the carried-goods geometry (`models.ts`) and props (`settlerModels.buildPropGeos`). Add `?work=toolsmith,ironsmelter` to `tools/settler-preview` or `tools/building-preview` to tune scenes in a loop.
- **Pilot**: the toolsmith and the iron smelter first, then the other smiths and the sawmill, then the rest.

## 3. Cheaper terrain shader (performance)

The terrain shader reads 30–40 textures per pixel, 3–4 ms of GPU time. Store only the top two or three ground types per node (a type index plus a weight texture), so each pixel blends two or three layers instead of all of them. Check against screenshots from before the change with `imgdiff.mjs`.

Why this comes before batching the buildings: at 3440×1440 the GPU looks like the limit. Render CPU is 5.6 ms of a ~10 ms frame, yet dropping to 70% resolution saves 31% of the frame, which only happens when pixel work dominates. Confirm with one interleaved `perf-bench/` run before starting.

## 4. Smoother frames (performance)

Small jobs that pay off straight away on a 175 Hz screen; do them alongside item 3.

- **Automatic resolution**: the Resolution setting and sharpening already exist. Let frame time drive them, dropping towards 85% only in busy moments.
- **Water reflection** rendered at half the rate or half the size.
- **Frame cap option**, for example 87 fps (half of 175 Hz), so frames arrive evenly.

## 5. Batch the buildings (performance)

Building draw calls are the biggest CPU render cost. The last profile showed about 1,900 draws, taking 3.6 ms of the 5.6 ms the CPU spends rendering, in a 30-minute town at 3440×1440. The cost grows with the size of the town, so this is what keeps late-game towns fast, and item 10 needs it. Buildings don't move, so use one `BatchedMesh` per material, with near and far models as separate geometry ranges. Sites and burning buildings can stay separate. Watch the per-player `rekey`, the clip variants and the LOD switch. Measure with `perf-bench/` (see the performance memory), always comparing interleaved runs.

The simulation isn't the bottleneck. A 50 ms tick costs 0.05–0.08 ms on average (0.25 ms at the 95th percentile) at 10–45 minutes of AI-vs-AI, so moving it into a Web Worker gains nothing.

## 6. Paths worn by traffic

Settlers 3 had no roads, so let the ground remember where people walk. Build a render-only traffic map at node resolution from settler positions, fading over a few game days. Where traffic is heavy, grass turns into dirt tracks through the terrain splat, and grass chunks lying on a path are flattened. Paths form on their own between the HQ, the woodcutters and the quarry, so your supply lines become visible. The same map can make grass part around walkers and leave footprints in snow. Do it after item 3, which rewrites the same terrain blending.

## 7. A livelier UI

- Small icons pop out of a building as each good is made ("+1 plank"), using the existing `produced` event.
- Panels animate in and out, and numbers count up and down.

(The clickable toasts moved into item 1b; the ring build menu was dropped.)

## 8. Morning mist and sun shafts

Height fog pools in valleys and over water at dawn and burns off by mid-morning, driven by the existing day cycle in `sky.ts`. Add sun shafts as a cheap screen-space pass (a radial blur of what blocks the sun, from depth), folded into the single final pass in `postfx.ts`. There's nothing like either yet. It costs GPU time, so it comes after the performance items.

## 9. Ambient occlusion on by default for High

`GTAOPass` is already wired in `postfx.ts` but off by default. Switch it on for High once items 3 and 5 free up the time.

## 10. Bigger maps

After item 5, since the simulation has plenty of headroom. Today towns peak around 290 settlers and 90 buildings on the 160 map. Recheck the AI deadlocks listed in the balance notes on larger maps.

## 11. Photo mode

Hide the UI and use a free camera. Scrub the time of day and the season, and set the focus distance for the tilt-shift blur. It's cheap given what already exists.

## 12. More for warships

- **Landing troops on an enemy coast** first: it is what lets island wars be won.
- Boarding enemy ships.
- Deck archers shooting at soldiers on the shore.

## 13. A smarter AI army and economy

- **Formations**: the AI uses the formations players have (`planFormation` in `src/game/orders.ts`) for its attacks and defence.
- **More trade outposts**: `AIController.tradeStep` sets up only one far outpost (storehouse plus market). Let it add a second as its realm grows.

Either change will move the baselines on purpose. Record the new medians.
