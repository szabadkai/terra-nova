# The Province — the campaign

The fifteen missions of Castra to Provincia are the **Tutorial** now (renamed 2026-09-29): one lesson each, five to ten minutes, the quaestor at your elbow. This is the plan for the thing above it: a campaign in the old sense, where every mission is a designed map, a working enemy and an hour of play, and where what you win carries on to the next.

Everything below is grounded in what the engine has today (file references point at it) and says what has to be built. Phases at the end; each lands something playable.

## Where it stands (2026-09-29)

Built and checked (`npx tsx scripts/campaign.ts`, `scripts/mapprint.ts`, `scripts/lockstep.ts`, the passive baseline bit-identical):

- **Phase 1, ground.** `generateMap` in phases with recipe hooks (`MapRecipe` in `src/game/mapgen.ts`: explicit starts, anchors, carve ops `range`/`gap`/`road`/`plateau`/`water`/`channel`/`land`/`flat`, designed veins, cleared patches), sheer rock (`World.cliff`: not walked, not built on, parts landmasses), recipes in `src/game/recipes.ts`, `scripts/mapshot.ts` to draw one, `scripts/mapprint.ts` holding free play's 240 maps to their fingerprints.
- **Phase 2, the director and the column.** `MissionRules.script` (triggers on time, tallies and predicates; actions `say`, `raid` from a spot with veterans, `attack`, `reinforce`, `mode`, `reveal`, `cast`, `fleet`, `flip` via `turnCoat`, `join`, `goods`, `do`), named bands, Varro's letters under his own seal; the column (`columnOf`/`applyCarry`: twelve men, a rank up each, capped wagons) carried in `opts.carry`.
- **Phase 3, the province.** `src/game/province.ts` (twelve regions, roads, boons, `varrosTurn`, `regionWon`/`strikeHeld`/`strikeLost`, the recall), the run in `src/ui/provinceStore.ts`, the chart page in `src/ui/province.ts`, dispatches, difficulty and fortifying applied to a region's rivals and raids (`opts.difficulty`, `opts.fortified`), generated defence missions (`defence.<region>`) with the town standing and four waves.
- **Phase 4, the sea and the hills.** Sacred buildings (a holy place changes hands with its ground instead of burning), missions that can be lost (`MissionRules.fail`, the lost dialog), the `ramp` carve (the one way up a plateau), fleets that keep at their order (`fleet` with `order`: `shell` the coast then the ships, `hunt` the other way round, `prey` on ships only and home between kills, `guard`; kept in `MissionState.fleets`, re-ordered every two seconds when idle, struck off when sunk), a recipe's own `isles` (so colonies and the computer's expeditions find designed islands), cargo counted by the harbour it lands at, sinkings by the sunk ship's owner, and ships as boons (`Carry.ships`: the estuary's trade ship, the pirates' two warships, waiting off whatever coast the next region has).
- **Regions drawn (ten):** Saltus (the pass: raids, the goat path, the frost, the counterattack), Silva (the grove, the Ninth won over with bread or the sword, the timber company's stockade), Vallis (the race for the valley, the harvest war), Metalla (the plateau's one path, the tribes on it), Collis (three hill forts, stormed or feasted, the third yields), Ara (the temple taken standing, or the mission is lost), Aestuarium (a colony across the water, nine cargoes, three pirate flotillas that prey on ships and go home between kills), Insulae (three islands, a race with Varro's colonists from his naval base, the pirates' towers shelled, his squadrons after our landings), Litus (a fleet war: raiders every ten minutes while their harbour stands, the Corvus at 360 timbers, the harbour burnt); and the defence of each and of Castra (a sea region's by four squadrons of his fleet instead of four waves on foot).

- **Phase 5, the siege and the finale.** Castellum (four castles round a cliff-rimmed hill, two ramps, the priests' frost at every gate and lightning on a crowd, the castles reinforced every twenty minutes while the hall stands, sorties, the garrison waking at the first breach; holding it ends Varro's fortifying and halves his strikes, `strikeWeight`) and Nova Ostia (a large map, a wall with two passes and a castle at each, Varro's seat on a bay with its fleet, his two client colonies on our flanks - his own towns, `rivalTown`, since the engine has no alliances - a ten-minute truce, squadrons from the bay while his harbour stands, and the Senate's ship as the clock: it docks at 1 h 40 as written, 2 h 10 on Easy, 1 h 20 on Hard, and finds whoever holds the seat). The epilogue on the province's page: the quaestor's last count for either ending (`EPILOGUE` in `ui/province.ts`, spoken as `province.end.<end>`) over the ledger the run keeps (regions taken, strikes beaten off, regions lost, the column). Found on the way and fixed for every region: the computer thinned a mission's forts to one man when they stood far from us (`manageGarrisons` now leaves `ms.forts` as the mission manned them), and a scripted spell cast before the priest reached the temple was spent for nothing (a `cast` that cannot be cast yet waits for the next check).
- **Peace.** The tribes (Collis held) and the pirates (Litus held) stay home in every later region: `RivalRule.people`, `Carry.peace`, triggers `by` a rival pass over.

- **The chart** (2026-09-30): the province's page draws Terra Nova as an old map made once from a fixed seed (`ui/provinceMap.ts`, in a worker the title screen starts, `ui/provinceWarm.ts`): a designed coast made ragged by noise (bays, the north-east promontory, Nova Ostia's bay, the Ara peninsula and its gulf, the estuary, the archipelago, the pirates' isle), the twelve regions as territories (a warped Voronoi of their seats, one piece each, washed and banded in the holder's colour and clickable), their borders, rivers, and each region's ground: the wall and pass of Saltus, the two walls of Vallis, Metalla's cliffs, the tribes' hill forts, Silva's forest, Castellum's four castles, the wall before Nova Ostia; a compass rose with its rhumb lines, depth lines off the coast, ships, a cartouche, paper and frame. The sheet widens into open sea to fill its panel.
- **Balance, first readings** (`scripts/campaign.ts time <region> [late]`, a level-1 computer as the legate for an hour; `late` gives it a late campaign's start, every other region's boon and twelve veterans of the second rank): it is still standing after an hour everywhere it was run, the floor the plan asks for; in the finale with nothing carried (only `?region=` allows that) its headquarters falls at 17 minutes, with a late start it holds thirteen strongholds and wears Varro down to nine; in Castellum with a late start it takes a castle standing at 46 minutes. It never takes to the sea where there is no island to settle (Aestuarium, Litus: its `seaStep` looks for islands), so the sea regions need a human, or a naval player of the headless kind, to time. The coal on the designed maps was 18-56 paces from the start against free play's 14-15; the sea, siege and finale maps now have theirs at 21-32, Collis (56) and Vallis (38) are still far.

Next: phase 6 - Varro's recordings (the quaestor's new lines too: `npx tsx scripts/voicelines.ts --check`), balance with AI runs (`scripts/campaign.ts time <region>`), and alliances in the engine (the finale's colonies as rivals of their own, and a campaign with a friend).

## The story

The tutorial ends with the legate governor of Terra Nova and Varro's colony broken. The campaign opens with the Senate's reply.

> The Senate has read my report. It has decided the province needs a governor of senatorial rank, and it has chosen Quintus Varro. He lands at Nova Ostia in the spring with two legions, a fleet and the Senate's seal. You are to hand over the coast. — I counted his towers, legate. I did not count his friends in Rome.

The campaign is the war for the province: the legate (you, with the camp you built and the men who built it) against the governor (Varro, with Rome's money and the Senate's paper). Gaius Sestius stays your narrator, dry as ever; Varro gets a voice of his own, letters that arrive between missions and lines during them. Around the two of them: the **Ninth** (the deserters of the tutorial, who can be won over), the **hill tribes** of the upland (raiders who can be broken or bought), **pirates** on the outer coast (Varro pays them, then can't stop them), and Varro's **client colonies** (computer kingdoms that fight for him).

Two endings: Varro's capital falls and the Senate's verdict arrives a season too late (the quaestor's last count); or Varro takes Castra and you are recalled.

## The shape: a province map, not a list

Between missions you are on a map of Terra Nova drawn as a parchment: twelve regions, yours in gold, Varro's in crimson, the tribes' in ochre, the sea around. Each **season** you choose a region on your border to campaign in — that is the mission. Varro moves too: each season he **fortifies** one region he holds (its mission gets harder: more towers, a temple, a shorter truce) and, from time to time, **strikes** a region you hold (a defence mission you must fight next, or lose the region and what it gives). Regions you hold give a lasting **boon** that comes into every later mission. The finale (Nova Ostia) opens when you hold eight regions.

This is a small, deterministic state machine (seed + season + what is held → Varro's move), so a headless script can play whole campaigns.

### The regions

| # | Region | The place | The mission in one line | Boon while held |
|---|---|---|---|---|
| 1 | **Castra** | the tutorial's coast; home | held from the start; the map Varro's strikes come to last | the capital: veterans heal between seasons |
| 2 | **Silva** | a great forest, a river of trees | Varro's timber concession is felling it; hold the forest's heart, and win over the Ninth's camp inside it | +40 boards, +20 logs to the wagons; the Ninth's centurion joins with 6 veterans |
| 3 | **Saltus** | a mountain pass, a fort on the far side | hold the pass against raids that grow each wave while you build iron, then storm the fort; Varro's priests freeze your line | +iron, +coal; the pass is the only road east |
| 4 | **Vallis** | a broad fertile valley | a race: Varro's colony (a fast builder) expands from the other end; hold more than half the valley's farmland when the season ends, then break him | +bread, +meat; farms start with fields sown |
| 5 | **Aestuarium** | an estuary cut into the coast | a harbour and a trade route up the water; pirates hunt your ships; land nine cargoes and sink the hunters | +fish; a trade ship at the start of every mission |
| 6 | **Insulae** | an archipelago | found colonies on three islands while Varro's fleet bombards them; raze the pirate towers by sea (no landing troops yet, see below) | a warship at the start; the outer coast opens |
| 7 | **Metalla** | a high plateau, gold under it, one path up | food must come up the path; the tribes raid it; take Varro's fort on the plateau and its mines | +gold: morale from the first minute |
| 8 | **Ara** | a sacred hill, a great temple on it | Varro's priests hold the temple and cast Wrath, Frost and Conversion at anything that climbs; take it standing (a razed temple fails the mission) | a temple and 60 mana at the start |
| 9 | **Collis** | the tribes' upland | three hill forts; take two and the third yields, or feed them and they come over | no tribal raids anywhere; a tribal war band in the finale |
| 10 | **Litus** | the pirate coast | a fleet war: the pirates' flagship, the *Corvus* of the tutorial grown up; sink it and burn the harbour it hides in | pirates stop hunting; +2 warships |
| 11 | **Castellum** | Varro's fortress: a ring of castles round a hill | the siege: engines, the Wrath of the Heavens, castles that never yield | Varro fortifies no further; his strikes weaken |
| 12 | **Nova Ostia** | Varro's seat, a large map, his capital, two client colonies and his fleet | the finale: everything you carry, everything you hold; a short truce; the Senate's ship on the horizon | — |

Each region has a **defence** variant too (played when Varro strikes it): a pre-built town of yours from the region's recipe, an invasion by land and sea in waves, a beachhead fort to break. Twenty-five minutes; lose it and the region turns crimson.

### The column: what carries over

- **Soldiers.** Every soldier alive at the end marches on, with his hp and his **level**. Surviving a mission raises a soldier's level by one, to three. The engine already has `level` on soldiers (`types.ts`), reads it in `strength()` (`military.ts:296`, +25% a level) and draws a gold helm for it (`render/settlers.ts:539`); nothing raises it today. Veterans are a visible, meaningful thing at no rendering cost.
- **The wagons.** A capped share of what is in your stores at the end (up to 30 of each material, 12 of each weapon, the tools), added to the next start.
- **The boons** of held regions (the table above): goods, a ship, a temple, mana, allies.
- **Nothing else.** A thin column still gets the standard start (`setupStart`, `game.ts:219`): carry-over only adds, so a bad mission never makes the next impossible.

Extracted when `missionwon` fires (`main.ts markMissionDone`), kept in the run store, injected through a new `opts.carry` that `beginMission` applies after the mission's own setup. `opts` is saved with the game and `setup` never re-runs on a load (`campaign.ts:105`), so a carried start is as reproducible as any other.

## What has to be built

### 1. Designed maps: recipes on top of the generator

`generateMap` (`src/game/mapgen.ts`, 430 lines, one function) builds everything from the seed: starts on a circle, resource blobs round each start, the height field, islands, connectivity, smoothing, then terrain types, ore, fish, trees, stones and deer from the heights. Nothing shapes a map by hand; the tutorial hunts seeds that fit (`scripts/campaign.ts seeds`).

The plan is not to replace it but to **layer a recipe on it**:

- **Split `generateMap` into phases** — `starts`, `anchors`, `heightField`, `islands`, `connectivity`, `smooth`, `classify`, `ore`, `fish`, `trees`, `stones`, `wildlife`, `yards`, `regions` — with the RNG drawn in exactly the same order, so free play stays bit-identical (`scripts/baseline.ts passive 199 1 1`). A pure refactor, checked before anything else lands.
- **`MapRecipe`** (`src/game/recipes.ts`), applied between `heightField` and `islands`: explicit `starts` (instead of the circle), named `anchors` (a forest of radius 14 here, a rock field there, a mountain, a lake), and **carve ops** on the height field: `ridge(a, b, width, height)`, `pass(at, width)`, `plateau(centre, r, height)`, `bay` / `basin` (below water level), `channel(a, b, width)` (an estuary: the generator has no rivers, but a channel below water level joins the sea and is navigable once its sea is ≥ 300 nodes), `island(centre, r)`, `flatten`. Classification, ore, fish and trees then follow the carved heights for free.
- **Pre-built towns**: a `town(g, owner, plan)` helper over `prebuilt`/`fort`/`garrison` (`campaign.ts:277-400`) so Varro's fortress is a working colony with a temple, farms and a harbour, not four towers.
- **A map tool**: `scripts/mapshot.ts <recipe>` writes the minimap as a PNG (the CPU minimap in `ui/minimap.ts buildBase` reads `h` and `terrain` directly), and the same PNGs, checked in under `public/province/`, are the region thumbnails on the map page. Iterating a recipe is: edit, run, look.

### 2. The director: scripted missions

The framework has `Raid.t/after`, a truce, goals polled every 2 s and the quaestor's tips (`campaign.ts missionStep`, `hud.ts` tips). A campaign mission needs a general **trigger** list in `MissionRules.script`:

```
{ when: { t?, after?: tallyKey, tally?: [key, n], done?: (g) => boolean }, once?: true, do: Action[] }
```

with actions the engine can already perform for any owner: `raid` (`fireRaid`), `fleet` (ships by `ship()` with `orderShipAttack`/`orderShipBombard`), `reinforce` (a garrison), `flip` (a building changes hands — a proper helper built from `capture()`'s cleanup, `military.ts:551`, which `handOver` is only a headless shortcut for), `mode` (a builder rival turns hostile; `AIController.mode`), `truce` (off), `reveal`, `goal` (add or complete a goal: mid-mission twists), `cast` (a rival's priests cast a named spell at a spot), `say` (a voice line and a message: the quaestor's or Varro's). Fired triggers are kept in `MissionState` so a save mid-mission is exact, and `scripts/campaign.ts` runs every script with a save half way, as it does raids now.

Rivals get a few more knobs in `RivalRule`: an explicit `hq`, a `town` plan, `fleet`, `temple`, aggression overrides for the AI's level tables (first attack, repeat, men needed — `ai.ts:46/110/808`), `focus` (prefer one player's strongholds in `attackStep`'s scoring), `castAt: 'attackers' | 'towers'` (today the AI casts only at attackers on its own land, `ai.ts:774`). Pirates are triggers plus a naval-only rival with no land economy.

### 3. The run: the strategic layer

- **`CampaignRun`** in its own store (`terra-nova.province.v1`, alongside `campaignStore.ts`): seed, season, difficulty, regions held / fortified / lost, the column, the ledger (what the quaestor has counted), the mission under way and each region's best time.
- **Varro's turn**: a pure function of (seed, season, held, fortified) → fortify X or strike Y. Escalation instead of a turn limit: from season 8 he strikes every other season; if you hold fewer than four regions by then, he marches on Castra.
- **Difficulty** (Easy / Normal / Hard) sets his AI level, raid sizes and how often he strikes.
- The tutorial's `?mission=` becomes `?region=<id>[&defence]` for working on one.

### 4. The interface

- **The map page** (a wide page of the title card, like the tutorial's): the parchment map as SVG (twelve region paths, authored once), coloured by holder, tower marks where Varro has fortified, invasion arrows when he strikes, thumbnails from `public/province/`, the season and the column's strength in a corner. Hover a region for its type, boon and difficulty; click a reachable one for its briefing (the tutorial page's right-hand column, reused) and Begin.
- **Dispatches** between seasons: the quaestor's report and Varro's letter, with their voice lines, over the map, with the region flipping colour.
- **The column** in the debrief: who marches on (men, veterans, the wagons), and in the briefing what came with you.
- In a game, everything the tutorial built serves as is: objectives with Show me, tips, the briefing that holds the clock, the debrief.

### 5. Voice

`scripts/voicelines.ts` already writes the script from the missions; it grows a second character. Varro's lines: a letter a season, a line when his fleet appears, when a fort falls, when he strikes. The quaestor keeps briefings, debriefs, tips and the dispatches. Recorded the same way (`scripts/voicesynth.ts`, a second voice).

### 6. Checks (`scripts/campaign.ts` grows a `province` mode)

Every region recipe generates (no NaN, all starts on land, connected, the pass is a pass), its probe holds, every goal is reached through `satisfy`, its script fires in order with a save round trip half way, and a level-1 AI as the player survives the first fifteen minutes of every conquest and every defence at Normal (the floor for "not impossible"). The strategic layer is played end to end headlessly: regions taken greedily, Varro's moves, carry-over round-tripped through the store, the finale unlocking at eight. Free play's passive baseline stays bit-identical through the generator refactor.

## What is out of reach today, and designed around

- **Landing troops on an enemy coast** (roadmap 7): warships carry nobody (`sea.ts:327`) and attacks stay on one landmass (`military.ts:206`). Insulae and Litus are therefore won by bombardment and colonies, not by storming island forts. When landing lands, they get a second, better version.
- **Rivers**: there are none; the estuary is a carved channel.
- **One people**: every kingdom builds Roman buildings; Varro's, the tribes' and the pirates' differ by name, colour, town plan and behaviour, not by architecture.

## Phases

1. **Ground.** The generator split into phases (bit-identical), `MapRecipe` with carve ops, explicit starts and anchors, `scripts/mapshot.ts`. One region designed and playable on its own through `?region=saltus`: the pass, the fort, the raids the framework already has. *This is the enabling technology; nothing else starts before it holds.*
2. **The director and the column.** Triggers and actions, `flip`, fleets, rival knobs, mid-mission goals, Varro's voice channel; `opts.carry`, extraction, veterancy. Saltus gets its full script; Silva and Vallis are built on the tools.
3. **The province.** The run store, Varro's turn, the map page, dispatches, the column screens, defence missions. Castra, Silva, Saltus and Vallis live end to end: a campaign you can play for four hours.
4. **The sea and the hills.** Aestuarium, Insulae, Litus (pirates, fleets), Collis (the tribes and their cross-mission effect), Metalla, Ara (the casting rival).
5. **The siege and the finale.** Castellum, Nova Ostia, the two endings.
6. **Voice and balance.** Varro recorded, the dispatches recorded, three difficulties tuned with AI runs, the ledger.

Stretch, after: landing troops (island conquest), a named centurion who levels with the column, a second province.
