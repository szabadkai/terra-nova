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
edit the missions, not this file. 14 lines, about 273 words.

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
