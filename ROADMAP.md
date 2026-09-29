# Terra Nova roadmap

What's still to build, ordered by impact (re-prioritised 2026-09-28). Pick from the top unless told otherwise. When an item (or one of its slices) lands, delete it here in the same commit.

Rules that apply to every item:
- **Render-only work stays render-only.** Never draw from the game RNG in render code (use `Math.random` or a hash, as `pigs.ts` and `idle.ts` do). The headless baselines must stay bit-identical: `npx tsx scripts/baseline.ts passive 199 1 1`.
- **Anything with a new material** must be compiled in `GameRenderer.warmUp()`, or the first time it appears the game freezes for a frame. A material made per object and disposed when it is done with (sites, scorch marks) takes its shader with it: keep a sample alive (`warmKeep`, or a hidden prototype like the demolition's scorch mark).
- **Finished buildings are drawn in batches** (`src/render/buildingBatches.ts`, one draw per material): while batched, a building's own static meshes are hidden. Anything that changes a finished building's meshes or materials must take it out of the batches first, as burning does; moving parts (named movers), flags and sites stay separate meshes.
- **Instanced meshes** finish their writes with `commitInstances` / `uploadFirst`. Meshes that call `setColorAt` need `withInstanceColor()` when they're created (`src/render/instancing.ts`).
- **The sun's shadow map covers only what the view shows** (`src/render/shadowFit.ts`, checked by `scripts/shadowfit.ts`): the ground in view within 1.1 view sizes of the target, and things up to `TALL` (8) above it. Anything taller that should take a shadow at the edge of the view needs `TALL` raised.
- **Every player action is a command** (`src/game/commands.ts`): the interface never calls into the game or writes it; it issues a command and hears how it went through a `cmd` event (the HUD's `issue()`). A game with a friend replays the same commands on both machines (`src/net/lockstep.ts`), so anything the interface did to the game directly would drift them apart. Game logic reads each player's own fog from `world.seen` (a bit per player); `world.explored` is only this machine's view. `npx tsx scripts/lockstep.ts` fails on a direct call or write from `src/ui`, `src/render` or `src/main.ts`, and plays a jittery three-machine game to catch a drift.
- **The game's arithmetic is the same in every browser**: no `Math.sin/cos/atan2/hypot/pow` and no `**` in `src/game` (the engines round them differently in the last bit); use `sin`, `cos`, `atan2`, `hypot` and `sq` from `src/core/fmath.ts`. Render code may use `Math.*` freely. `scripts/lockstep.ts` checks.
- **Each gameplay feature gets a headless check** in `scripts/`.
- **A new heavy effect gets its switch in each detection level** (`PRESETS` in `src/render/hardware.ts`, checked by `scripts/hardware.ts`): new players get the level their machine was timed to hold, so an effect that is on everywhere by default lands on machines that were never timed with it.

---

## 1. Cheaper frames at high resolution (performance)

At 3440×1440 the GPU is the limit: a 25-minute town at High with AO takes about 10.1 ms near, 10.2 in the middle distance and 9.3 far out (the buildings are batched, the reflection draws only what the water shows, and the shadow map only what the view needs). Measured by switching one thing off at a time: the terrain's own draw is the biggest part (about 4–5 ms), then the trees in the main pass (about 1.7 ms close up), 4× MSAA 0.9–1.6 ms, the ambient occlusion 1.3–2 ms, the post chain 1.5–1.8 ms (the MSAA resolve and the final pass about 1 ms, the bloom about 0.45, the tilt-shift blur 0.02–0.25), the shadow map's lookups 0.7–0.9 ms (five filtered taps in every lit pixel) and its own pass 0.40–0.48 ms. Dropping to 70% resolution saves about 30%.

- **MSAA** is a fixed cost of the four-sample HDR target, not its bandwidth: an R11G11B10F target saved only 0.1–0.45 ms (and has no alpha, which the occlusion's opt-out uses), invalidating its depth saved nothing measurable and skipping the depth resolve the occlusion needs at most 0.25 ms, and it cost the same with the grass, the trees or the terrain hidden; 2× saves nothing close up and 0.5 ms far out. What is left is fewer samples or a post-process AA (FXAA/SMAA) on High, a quality call for the user.
- **The terrain** is the next big one (its flat floor of PBR, environment, shadows and fog is about 2 ms of it; a baked far-terrain colour would take most of that far out).
- Passes are cheap only on an idle GPU: with other pages drawing on it the bloom's 12 small passes took 1.4–1.7 ms instead of 0.45, about 0.1 ms each however small. Folding passes together (as the bloom's bright pass now is, into its first blur) pays more on a busy machine than quiet measurements show.

## 2. A livelier UI

- Small icons pop out of a building as each good is made ("+1 plank"), using the existing `produced` event.
- Panels animate in and out, and numbers count up and down.

(The ring build menu was dropped.)

## 3. Morning mist and sun shafts

Height fog pools in valleys and over water at dawn and burns off by mid-morning, driven by the existing day cycle in `sky.ts`. Add sun shafts as a cheap screen-space pass (a radial blur of what blocks the sun, from depth), folded into the single final pass in `postfx.ts`. There's nothing like either yet. It costs GPU time, so it comes after the performance items.

## 4. Bigger maps

Buildings are batched (`buildingBatches.ts`), so a bigger town adds instances rather than draw calls, and the simulation has plenty of headroom: a 50 ms tick costs 0.05–0.08 ms on average (0.25 ms at the 95th percentile) at 10–45 minutes of AI-vs-AI, so it never needs a Web Worker. Today towns peak around 290 settlers and 90 buildings on the 160 map. Recheck the AI deadlocks listed in the balance notes on larger maps. The worn paths (`src/render/trails.ts`, four texels a node) are tuned on towns of the 160 map (`A0`: about the busiest tenth of the walked-over ground goes bare), so a much busier town wears more of itself bare: look at them again there.

## 5. Photo mode

Hide the UI and use a free camera. Scrub the time of day and the season, and set the focus distance for the tilt-shift blur. It's cheap given what already exists.

## 6. More for warships

- **Landing troops on an enemy coast** first: it is what lets island wars be won.
- Boarding enemy ships.
- Deck archers shooting at soldiers on the shore.

## 7. A smarter AI army and economy

- **Formations**: the AI uses the formations players have (`planFormation` in `src/game/orders.ts`) for its attacks and defence.
- **More trade outposts**: `AIController.tradeStep` sets up only one far outpost (storehouse plus market). Let it add a second as its realm grows.

Either change will move the baselines on purpose. Record the new medians.

## 8. Playing with a friend: what's left

Two people can play over the internet with no server (title screen → Play with a friend: WebRTC between the browsers, found through Trystero over public Nostr relays by a six-letter room code; deterministic lockstep at sixty ticks a second, turns of 100 ms, the input delay set by the host from the measured round trip, a state hash compared every turn). Left for later:

- **Three or four people.** The protocol is symmetric (`scripts/lockstep.ts` already plays three seats); the lobby seats only the first friend, and a leaver's realm needs handing to an AI at a turn everyone agrees on (the lowest remaining seat decides and sends it as a command), where today the game simply stands still.
- **Mending a drift.** A desync freezes the game with a dialog. The host could send a snapshot (`save.ts`) that every machine, host included, restores at the same turn: two restores of one save run identically (`scripts/saveload.ts`), a live game and its restore do not.
- **Saving a game with a friend**, to pick up together later (the autosave and Save page are off in one).
- **A TURN relay** for the pairs of NATs that STUN cannot cross (about one in ten): `turnConfig` in `src/net/room.ts` is the slot. Two tabs on one machine only meet on the dev server, where mDNS host candidates are rewritten to loopback (`_test_only_mdnsHostFallbackToLoopback`, localhost only); an embedded browser does not resolve them and one NAT rarely hairpins.
- **An input delay that follows the connection** during play (it is fixed at the start), and a word from the host when the game is paused.
- Chat, and names of the players' own choosing (the realms' names stand in).
