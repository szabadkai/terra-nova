# The quaestor's script

Gaius Sestius, quaestor of the province of Terra Nova, speaks every line of the campaign. One voice
throughout: a dry, exact man in his fifties who counts things and is faintly amused by everything
else; unhurried, about 140 words a minute, no stage-Roman accent. He pauses a beat at every paragraph
break and never raises his voice, not even for the Senate.

Latin titles are said the classical way: Castra (KAS-tra), Domus (DOH-moos), Piscis et Venatio
(PIS-kis et weh-NAH-tee-oh), Panem (PAH-nem), Fines (FEE-nace), Metalla (meh-TAL-la), Ferrum (FER-room),
Arma (AR-ma), Prima Pugna (PREE-ma POOG-na), Dei (DAY-ee), Mercatura (mer-ka-TOO-ra), Mare Nostrum
(MAH-reh NOS-troom), Machinae (MA-ki-nye), Classis (KLAS-sis), Provincia (pro-WIN-ki-a). Varro is VAR-roh.

Each line below is one recording, saved as `public/voice/<id>.mp3` (mono, 64–96 kbps is plenty). The
game plays whichever recordings are there and leaves the rest to the text on screen, so the lines can
arrive in any order. This file is generated from `src/game/missions.ts` by `scripts/voicelines.ts`;
edit the missions, not this file. 91 lines, about 2719 words.

## Everywhere

- `quaestor.noted.1` — *A goal met*

  Noted.

- `quaestor.noted.2` — *A goal met*

  Counted.

- `quaestor.noted.3` — *A goal met*

  Good. Next.

- `quaestor.noted.4` — *A goal met*

  I have written it down.

- `campaign.defeat` — *The colony has fallen*

  The Senate will want a report. I will write that the province was well begun and the legate learned quickly. Try again; the coast is still there.

## Mission I · Castra — The Camp

- `castra.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Legate. The Senate has given you a legion’s worth of tools and a coastline nobody wanted. This is Terra Nova; that hill is your camp.

  Rome was not built in a day, but it was built of boards and stone. So: a woodcutter for logs, a sawmill to make boards of them, a stonecutter for the rocks, and a forester, because woodcutters are thorough.

  I am Gaius Sestius, your quaestor. I count things. Give me something to count.

- `castra.debrief` — *The mission won*

  Fifty boards, forty stone. The Senate would call it a start. I call it a camp that will not run out of nails. Next: the men are sleeping under carts.

- `castra.tip.site` — *A tip, the first time: on "placed"*

  A site. Diggers level it, carriers bring boards and stone, builders raise it. Click it to watch.

- `castra.tip.tool` — *A tip, the first time: on "equip"*

  He took an axe from the store. Every trade needs its tool. The store has a few of each; a toolsmith makes more, later.

- `castra.tip.log` — *A tip, the first time: on "produced"*

  A log on the pile. A carrier will fetch it to the sawmill. Nobody needs a road.

- `castra.tip.board` — *A tip, the first time: on "produced"*

  Boards. Now you can build anything the Senate allows.

- `castra.tip.panel` — *A tip, the first time: on "built"*

  Click a building to see what it is doing. Its panel shows the worker, the goods and why it might be waiting.

- `castra.tip.camera` — *A tip, the first time: after a while*

  Getting your bearings? The wheel zooms, right-drag moves the view, Option-drag or Shift + wheel turns it. Esc → Controls has the rest.

- `castra.tip.speed` — *A tip, the first time: after a while*

  Waiting is for senators. The 2× button in the top bar speeds the sun. Nothing else changes.

## Mission II · Domus — Homes

- `domus.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Twenty-two carriers marched in with you; sixteen are still with us, and the Senate’s letter is very clear that no more are coming.

  A Small Residence brings eight settlers to the camp, a Medium one eighteen. Each new man carries until a building needs him for something better. Build homes.

  And a storehouse near the huts: your men carry everything from the headquarters, and every step they save is a board sawn sooner.

- `domus.debrief` — *The mission won*

  Forty-eight mouths, forty-eight pairs of hands. I have written down both figures; you will want the second. Next: the mouths.

- `domus.tip.spawn` — *A tip, the first time: on "spawn"*

  A settler moved in. He is a carrier until someone needs him. The top bar counts the idle ones.

- `domus.tip.store` — *A tip, the first time: on "built"*

  Goods now go to the nearest store. A hut beside it never waits long for its carrier.

- `domus.tip.badge` — *A tip, the first time: after a while*

  A badge over a roof says why it has stopped. Press . to go to the next one. B changes how many you see.

## Mission III · Piscis et Venatio — Fish and Game

- `piscis.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Men eat. At present they eat what we brought, which is twenty meals in a pile.

  A Fisher’s Hut on the lake shore feeds us from the water; a Hunter’s Hut by the woods lives off the hares, and the woods keep the hares, so keep the woods.

  Each hut works within a circle; the ground shows it while you choose the spot. Mines, when we have them, will not turn a wheel without food.

- `piscis.debrief` — *The mission won*

  Fish and hare. Not Rome’s table, but the men have stopped looking at the mules. Next: bread, which is a longer story.

- `piscis.tip.fish` — *A tip, the first time: on "produced"*

  A fish. They come back slowly; two fishers on one pond starve each other.

- `piscis.tip.meat` — *A tip, the first time: on "produced"*

  Meat. Hares live off grown trees. Fell the wood and they leave.

- `piscis.tip.range` — *A tip, the first time: on "placed"*

  The circle you saw is where he works. Water, game or trees outside it might as well be in Rome.

## Mission IV · Panem — Bread

- `panem.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Fish and hare feed a camp; bread feeds a province. It takes four buildings, and I will not pretend otherwise.

  A Grain Farm sows fields around itself and reaps them in a minute and a half. A Windmill grinds the grain. A Waterworks by the water fills buckets. A Bakery takes flour and water and gives us loaves.

  When something stands idle, the Economy tab says what is short. Read it before you build a second of anything.

- `panem.debrief` — *The mission won*

  Bread. Now the mines can be fed, when there are mines. Next: the border, which is closer than you think.

- `panem.tip.farm` — *A tip, the first time: on "built"*

  Grain takes ninety seconds to ripen. The farmer sows first and reaps later; the mill waits meanwhile.

- `panem.tip.flour` — *A tip, the first time: on "produced"*

  Flour. Flour and water make bread; the bakery’s panel shows both piles.

- `panem.tip.prio` — *A tip, the first time: on "priority"*

  The starred building comes first. Goods and crews go there before anywhere else. Only one at a time.

- `panem.tip.economy` — *A tip, the first time: after a while*

  The Economy tab. What is made and used each minute, and which tools are short. Read it before building a second of anything.

## Mission V · Fines — The Border

- `fines.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Your land ends where the headquarters’ reach ends: a circle, and everything of ours inside it. The mountain to the north-east is outside it, and the mountain is where the iron is.

  A Guard Tower claims a smaller circle of its own once a soldier walks into it; a Watchtower a larger one. The headquarters sends the soldier by itself and keeps two back.

  Build on land that is not yours and the building burns. Build at the edge and the edge moves. Pioneers, if you have a shovel and a spare man, stake out land with nothing but their feet.

- `fines.debrief` — *The mission won*

  A tower, and the hill inside it. The Senate likes a border it can see. Next: what the hill is made of.

- `fines.tip.manned` — *A tip, the first time: on "occupied"*

  A soldier walked out of the headquarters by himself. It keeps two back. The border moved with him: look at the minimap.

- `fines.tip.staked` — *A tip, the first time: on "staked"*

  Staked. Pioneers claim a patch each; a foreign tower takes it back for good.

- `fines.tip.burn` — *A tip, the first time: on "razed"*

  On land that turns foreign a building burns. Build behind your towers, not beside them.

## Mission VI · Metalla — The Mines

- `metalla.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  The mountain is inside the border. What is inside the mountain, nobody knows, and I will not have the men digging at random.

  Send a geologist. Any free carrier will take the trade; pick the card in the Industry tab and click the mountain. He probes eight spots and leaves a sign at each: black lumps for coal, rust for iron, gold for gold, a cross for nothing.

  A mine goes on a sign, or where the rock has begun to glitter. Its marker glows green over a rich vein. And a mine eats: one meal a cart. The larder is full for now.

- `metalla.debrief` — *The mission won*

  Coal and iron ore, in carts. The smiths will want both, and the miners will want dinner. Next: bars, and tools.

- `metalla.tip.sign` — *A tip, the first time: on "sign"*

  A sign. What lies beneath and how much. It fades after eight minutes; the ore stays known, and the rock glitters.

- `metalla.tip.mine` — *A tip, the first time: on "built"*

  A mine. It eats one meal a cart: bread, fish or meat. Watch its food pile.

- `metalla.tip.geologist` — *A tip, the first time: on "equip"*

  He set out with a hammer. Geologists work only inside your border, and need a store on this land to come home to.

## Mission VII · Ferrum — Iron

- `ferrum.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Ore is a rock with ambitions. An Iron Smelter turns it into bars with coal; a Toolsmith turns bars into tools with more coal. Two coal mines for one smelter is the rule of thumb.

  You will have noticed the second sawmill standing idle. It wants a saw, and the store had one. The toolsmith forges whatever idle buildings lack; the sliders in the Economy tab tell him what to stockpile.

  Iron feeds tools, weapons, warships and engines. Everything from here on begins at that furnace.

- `ferrum.debrief` — *The mission won*

  Every man has his tool again. I have stopped hearing about it. Next: arms.

- `ferrum.tip.iron` — *A tip, the first time: on "produced"*

  A bar of iron. Tools, weapons, warships and engines all begin here.

- `ferrum.tip.tool` — *A tip, the first time: on "produced"*

  A tool. The toolsmith forges what idle buildings lack; a slider in the Economy tab makes him stockpile one.

- `ferrum.tip.saw` — *A tip, the first time: after a while*

  The second sawmill wants a saw. The store had one. Until the toolsmith forges another, it stands.

## Mission VIII · Arma — Arms

- `arma.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Seven soldiers hold this province, and two of them are the headquarters’ own. The Senate does not call that a garrison; it calls it a rumour.

  A Weaponsmith beats bars into swords and bows; the slider on its panel says which. Barracks take one weapon and one idle carrier and give back a soldier, and they leave four carriers free however many weapons wait, so homes come before recruits.

  Gold, if the mountain has any, does nothing but sit in the store; it happens to make every soldier fight harder while it does.

- `arma.debrief` — *The mission won*

  Twelve soldiers. The Ninth had four thousand, and look where that got them. Next: the road, and who is on it.

- `arma.tip.recruit` — *A tip, the first time: on "soldier"*

  A recruit. One weapon and one idle carrier. He walks to the headquarters and waits for a tower to need him.

- `arma.tip.weapon` — *A tip, the first time: on "produced"*

  A weapon. Swordsmen hold a line; bowmen shoot over it. The weaponsmith’s slider sets the mix.

- `arma.tip.gold` — *A tip, the first time: on "produced"*

  Gold. In the store it raises morale: up to sixty percent harder blows at twenty-five bars.

- `arma.tip.idle` — *A tip, the first time: after a while*

  The barracks keep four carriers free. Build homes for more men, or they train nobody.

## Mission IX · Prima Pugna — First Blood

- `pugna.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Deserters of the Ninth Legion hold two towers on the road east and call themselves free men. The Senate calls them something shorter.

  Select a tower of theirs and press Attack, and your men march by themselves. Or command them: drag a box around your soldiers, right-click where they should go or what they should storm, and a number key with Ctrl keeps a group under it. A captured tower keeps its land and its walls.

  They will not take it kindly. When they come, select a tower of yours, call out its garrison to meet them, and R sends the men back to their posts.

- `pugna.debrief` — *The mission won*

  The road is ours. The deserters were not many, and are fewer. Next: the gods, who have been patient.

- `pugna.tip.march` — *A tip, the first time: on "attack"*

  They march. Swordsmen in front, bowmen behind. The tower’s garrison comes out to meet them.

- `pugna.tip.taken` — *A tip, the first time: on "captured"*

  Captured. A taken tower keeps its land. One man of yours mans it now; it wants more.

- `pugna.tip.raid` — *A tip, the first time: on "raid"*

  The deserters come for their tower. Select a tower of yours and Call out its garrison to meet them. R sends the men back.

- `pugna.tip.group` — *A tip, the first time: after a while*

  Groups. Box-select soldiers, then Ctrl (or Option) and a number key keeps them under it. The number picks them again; twice takes you there.

- `pugna.raid` — *On "raid"*

  They are coming for it. Call out the garrison, legate; a tower is worth a fight.

## Mission X · Dei — The Gods

- `dei.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  The priests have written to the Senate, and the Senate has written to me. A province without a temple is a camp, they say, whatever its walls.

  A Vineyard grows the wine; carriers take it to a Temple, where the priest offers it and the gods answer in mana. The Faith tab holds what you can ask of them.

  Blessed Harvest ripens every field and vine in its circle at once. Healing Light mends your soldiers and puts iron in their arms for a minute. Both reach only so far from your strongholds. Ask for both; I want to see the priests earn their keep.

- `dei.debrief` — *The mission won*

  The priests are content and the fields are early. I distrust both, but I will take the grain. Next: donkeys.

- `dei.tip.wine` — *A tip, the first time: on "produced"*

  Wine. Carriers take it to the temple; the priest offers it. Nobody drinks it, which I find hard to believe.

- `dei.tip.offering` — *A tip, the first time: on "offering"*

  An offering. Three mana a cycle, up to a hundred and fifty. Spells need a temple, a priest at his post and reach from a stronghold.

- `dei.tip.cast` — *A tip, the first time: on "spell"*

  The gods answered. Four seconds, and the priests can ask again.

## Mission XI · Mercatura — Trade

- `mercatura.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  The far side of the mountain has the better veins, so the mines are there, with a storehouse and a watchtower, and the food is here. The miners are eating the walk.

  A Market Place is the end of a road. Build one here and one there; in one, choose the other as destination and click + on the goods to send, and carriers stock them. A Donkey Ranch breeds the donkeys that carry them, two goods a trip, fed on grain and water.

  Twelve goods delivered up the road, and the miners will stop writing to me.

- `mercatura.debrief` — *The mission won*

  The mines are fed and the donkeys are not consulted. That is trade. Next: the sea.

- `mercatura.tip.market` — *A tip, the first time: on "built"*

  A market. The end of a road. Its panel: choose the other market, then + on the goods to send.

- `mercatura.tip.donkey` — *A tip, the first time: on "donkey"*

  A donkey. It waits at a market with goods to carry; two a trip.

- `mercatura.tip.caravan` — *A tip, the first time: on "caravan"*

  Delivered. Carriers at the far end take it on to whoever needs it.

## Mission XII · Mare Nostrum — Our Sea

- `mare.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  There is an island off this coast, and the fishermen say it glitters. The Senate has heard the fishermen.

  A Harbour goes on the shore beside deep water; a Shipyard likewise, and it builds a ship from ten boards. A harbour can send an expedition: a builder, a digger, a soldier, two carriers and the makings of a second harbour, by ship, to found a colony where you point.

  Once the colony stands and a soldier mans it, ships carry goods between your harbours by themselves, or as you order.

- `mare.debrief` — *The mission won*

  A harbour, a ship, a colony. Rome began smaller, though it did not have to swim. Next: engines.

- `mare.tip.launch` — *A tip, the first time: on "launch"*

  A ship. Twenty goods or twelve settlers. It waits at your harbour for orders.

- `mare.tip.expedition` — *A tip, the first time: on "expedition"*

  An expedition gathers. Five people and a harbour’s worth of boards and stone at the dock; the ship takes them over.

- `mare.tip.landed` — *A tip, the first time: on "landed"*

  Landed. The colony’s harbour holds the shore until its soldier mans it.

- `mare.tip.unloaded` — *A tip, the first time: on "unloaded"*

  Unloaded. Ships keep a colony supplied by themselves; Shipping orders send what you choose.

## Mission XIII · Machinae — Engines

- `machinae.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  The Ninth again: a watchtower and two guard towers on the hill road, and this time they have bowmen on the walls. Men at the door of a manned watchtower die at the door.

  A Siege Workshop builds catapults from boards and iron. Select one and right-click a stronghold: its stones kill the garrison first, then bring the walls down. It cannot fight, so send swordsmen with it, formed up in front, and tell them to stand firm.

  Their tower is out of the catapult’s range from your land, so it must roll out beyond the border. Escort it.

- `machinae.debrief` — *The mission won*

  The tower fell without a man of ours at its door. Engineers are worth their iron. Next: the fleet.

- `machinae.tip.machine` — *A tip, the first time: on "machine"*

  A catapult. Select it and right-click a stronghold. It cannot fight back: send swordsmen along.

- `machinae.tip.hit` — *A tip, the first time: on "siegehit"*

  A stone through the roof. One of the garrison falls with each hit; an empty tower loses its walls.

- `machinae.tip.razed` — *A tip, the first time: on "razed"*

  Walls down. A ruined tower gives its land back.

- `machinae.tip.firm` — *A tip, the first time: after a while*

  Stand firm. Select the escort and set a formation and Stand firm in their panel: they hold their line instead of chasing.

## Mission XIV · Classis — The Fleet

- `classis.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  The Ninth have taken to the water: a tower on the shore north of the harbour and a ship that stops ours. Land is my business; this is yours.

  The shipyard’s panel has a switch: Warship. Twelve boards and three iron fittings, and a catapult on the foredeck. Select the warship and right-click an enemy ship to hunt it, or a stronghold by the water to shell it; it stands off beyond the archers’ reach where the coast allows.

  A battered ship mends at its harbour. Bring it home between fights.

- `classis.debrief` — *The mission won*

  A warship of our own. Varro will have heard the news by now. Next: Varro.

- `classis.tip.warship` — *A tip, the first time: on "warship"*

  A warship. Right-click a ship to hunt it, a shore tower to shell it. It keeps beyond the archers where it can.

- `classis.tip.broadside` — *A tip, the first time: on "broadside"*

  A stone from the foredeck. Twenty of a ship’s hundred and twenty; a tower’s garrison falls a man a hit.

- `classis.tip.sinking` — *A tip, the first time: on "sinking"*

  She goes down. Everyone aboard is lost with a ship. Mend yours at a harbour between fights.

## Mission XV · Provincia — The Province

- `provincia.brief` — *The briefing, as the mission opens (pause at each paragraph break)*

  Quintus Varro, legate of Nova Ostia, has declared his colony independent of the Senate, and therefore of us. He has a headquarters, towers, a harbour and ambitions.

  You have everything this province has taught you, and the Senate has opened its last doors: the Castle, and the Great Temple with the Wrath of the Heavens in it.

  Take or raze his strongholds one after another until the last lays down its arms. A colony whose headquarters falls cannot hide its towers, and one down to its last three will yield. The sea gives you ten minutes’ truce. Use them.

- `provincia.debrief` — *The mission won*

  The last of Varro’s towers strikes its colours. Terra Nova is a province of Rome, and you are its governor. I have counted everything. It comes to: enough. The maps beyond are yours to draw: Free play, any size, any rivals.

- `provincia.tip.truce` — *A tip, the first time: on "truceover"*

  The truce is over. Varro may march at any time. Towers on the road towards him, manned.

- `provincia.tip.fallen` — *A tip, the first time: after a while*

  His headquarters is down. His towers show through the fog now. Three left and no castle: he yields.

- `provincia.tip.castle` — *A tip, the first time: on "built"*

  A castle. Ten men and the widest circle a stronghold claims. A realm with a castle never yields.

- `provincia.truceover` — *On "truceover"*

  The truce is over. Varro may march at any time. I would have towers on the road by now.
