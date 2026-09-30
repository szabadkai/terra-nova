// The script: every line the tutorial and the campaign speak, generated from the missions so the words
// recorded are the words shown. Writes voice/SCRIPT.md (for whoever records or synthesises them),
// voice/lines.json (id -> text, for batch synthesis) and voice/speakers.json (id -> speaker, for the
// lines not in the quaestor's voice); the recordings go to public/voice/<id>.mp3.
// Usage: npx tsx scripts/voicelines.ts [--check]   (--check: list the lines whose recording is missing)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MISSIONS } from '../src/game/missions';
import { REGIONS } from '../src/game/regions';
import { missionById, type Mission, type Speaker } from '../src/game/campaign';
import { REGION_INFO, REGION_IDS, allDispatches } from '../src/game/province';
import { EPILOGUE } from '../src/ui/province';
import { numeralOf } from '../src/game/campaign';

const GENERIC: [string, string, string][] = [
  ['quaestor.noted.1', 'A goal met', 'Noted.'],
  ['quaestor.noted.2', 'A goal met', 'Counted.'],
  ['quaestor.noted.3', 'A goal met', 'Good. Next.'],
  ['quaestor.noted.4', 'A goal met', 'I have written it down.'],
  ['campaign.defeat', 'The colony has fallen', 'The Senate will want a report. I will write that the province was well begun and the legate learned quickly. Try again; the coast is still there.'],
];

interface Line { id: string; when: string; text: string; who?: Speaker }
const lines: Line[] = [];
const byMission: { title: string; lines: Line[] }[] = [];
for (const [end, e] of Object.entries(EPILOGUE)) GENERIC.push([`province.end.${end}`, `The Province's end: ${e.title}`, e.text]);
for (const [id, when, text] of GENERIC) lines.push({ id, when, text });
const linesOf = (m: Mission, title: string) => {
  const mine: Line[] = [];
  const add = (id: string, when: string, text: string, who?: Speaker) => { const l = { id: `${m.id}.${id}`, when, text, who }; mine.push(l); lines.push(l); };
  add('brief', 'The briefing, as the mission opens (pause at each paragraph break)', m.briefing.join('\n\n'));
  add('debrief', 'The mission won', `${m.debrief} ${m.hook}`);
  for (const t of m.tips ?? []) add(`tip.${t.id}`, `A tip, the first time: ${t.on === 'time' ? 'after a while' : `on "${t.on}"`}`, `${t.title} ${t.detail}`);
  for (const [k, text] of Object.entries(m.voice ?? {})) add(k, `On "${k}"`, text);
  // the script's lines, in whoever's voice says them
  for (const tr of m.rules?.script ?? []) for (const act of tr.do) {
    if (act.a !== 'say') continue;
    add(tr.id, `${act.who === 'varro' ? 'VARRO' : 'The quaestor'}, when the script's "${tr.id}" comes`, act.text ? `${act.title}${/[.!?…]$/.test(act.title) ? '' : '.'} ${act.text}` : act.title, act.who === 'varro' ? 'varro' : undefined);
  }
  byMission.push({ title, lines: mine });
};
MISSIONS.forEach((m, i) => linesOf(m, `Mission ${numeralOf(i)} · ${m.title} — ${m.subtitle}`));
REGIONS.forEach((m) => linesOf(m, `The Province · ${m.title} — ${m.subtitle}`));
// the defences of the regions that can be held: the capital, and every region whose conquest is drawn
for (const r of REGION_IDS) { const d = missionById(`defence.${r}`); if (d) linesOf(d, `The Province · the defence of ${REGION_INFO[r].name}`); }
// the province page's dispatches (the log a turn of the war writes): one line for each region and kind
{
  const mine: Line[] = [];
  for (const d of allDispatches()) { const l = { id: d.voice, when: `A dispatch on the province page (${d.who === 'varro' ? 'VARRO' : 'the quaestor'})`, text: d.text, who: d.who === 'varro' ? 'varro' as const : undefined }; mine.push(l); lines.push(l); }
  byMission.push({ title: 'The Province · the dispatches', lines: mine });
}

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const ids = new Set<string>();
for (const l of lines) { check(!ids.has(l.id), `line id ${l.id} is unique`); ids.add(l.id); }
check(lines.every((l) => l.text.trim().length > 0), 'every line has words');
check(lines.every((l) => /^[a-z0-9.]+$/.test(l.id)), 'every id is a plain file name');

const words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
const md = `# The script

Gaius Sestius, quaestor of the province of Terra Nova, speaks the tutorial and most of the campaign: a
dry, exact man in his fifties who counts things and is faintly amused by everything else; unhurried
and measured, with a slight Italian accent, never stage-Roman. He pauses a beat at every paragraph
break and never raises his voice, not even for the Senate.

Quintus Varro, the Senate's governor, speaks only in the campaign, and only in his letters (the lines
marked VARRO): a patrician of sixty with a perfect Latin education and no doubts, courteous the way a
closing door is courteous; slower than the quaestor, every consonant in its place. He is never angry;
he is disappointed on the Senate's behalf.

Latin titles are said the classical way: Castra (KAS-tra), Domus (DOH-moos), Piscis et Venatio
(PIS-kis et weh-NAH-tee-oh), Panem (PAH-nem), Fines (FEE-nace), Metalla (meh-TAL-la), Ferrum (FER-room),
Arma (AR-ma), Prima Pugna (PREE-ma POOG-na), Dei (DAY-ee), Mercatura (mer-ka-TOO-ra), Mare Nostrum
(MAH-reh NOS-troom), Machinae (MA-ki-nye), Classis (KLAS-sis), Provincia (pro-WIN-ki-a), Saltus (SAL-toos),
Silva (SIL-wa), Vallis (WAL-lis), Collis (KOL-lis), Ara (AH-ra), Aestuarium (ai-stoo-AH-ree-oom), Insulae
(IN-soo-lye), Litus (LEE-toos). Varro is VAR-roh; Nova Ostia is NOH-wa OS-tee-a; the ships Corvus (KOR-woos),
Aquila (AH-kwi-la) and Lupa (LOO-pa).

Each line below is one recording, saved as \`public/voice/<id>.mp3\` (mono, 128 kbps; \`scripts/voicesynth.ts\` makes them with ElevenLabs). The
game plays whichever recordings are there and leaves the rest to the text on screen, so the lines can
arrive in any order. This file is generated from \`src/game/missions.ts\` by \`scripts/voicelines.ts\`;
edit the missions, not this file. ${lines.length} lines, about ${words} words.

## Everywhere

${GENERIC.map(([id, when, text]) => `- \`${id}\` — *${when}*\n\n  ${text}\n`).join('\n')}
${byMission.map((m) => `## ${m.title}\n\n${m.lines.map((l) => `- \`${l.id}\` — *${l.when}*\n\n${l.text.split('\n\n').map((p) => `  ${p}`).join('\n\n')}\n`).join('\n')}`).join('\n')}`;

mkdirSync('voice', { recursive: true });
const json = JSON.stringify(Object.fromEntries(lines.map((l) => [l.id, l.text])), null, 2) + '\n';
const speakers = JSON.stringify(Object.fromEntries(lines.filter((l) => l.who).map((l) => [l.id, l.who])), null, 2) + '\n';
const same = (path: string, text: string) => existsSync(path) && readFileSync(path, 'utf8') === text;
const unchanged = same('voice/SCRIPT.md', md) && same('voice/lines.json', json) && same('voice/speakers.json', speakers);
writeFileSync('voice/SCRIPT.md', md);
writeFileSync('voice/lines.json', json);
writeFileSync('voice/speakers.json', speakers);
console.log(`     voice/SCRIPT.md and voice/lines.json ${unchanged ? 'unchanged' : 'written'}: ${lines.length} lines, ${words} words`);

if (process.argv.includes('--check')) {
  const missing = lines.filter((l) => !existsSync(`public/voice/${l.id}.mp3`));
  console.log(`     recordings: ${lines.length - missing.length} of ${lines.length} in public/voice${missing.length ? `; missing: ${missing.map((l) => l.id).join(', ')}` : ''}`);
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
