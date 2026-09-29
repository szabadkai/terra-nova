// The quaestor's script: every line the campaign speaks, generated from the missions so the words
// recorded are the words shown. Writes voice/SCRIPT.md (for whoever records or synthesises them)
// and voice/lines.json (id -> text, for batch synthesis); the recordings go to public/voice/<id>.mp3.
// Usage: npx tsx scripts/voicelines.ts [--check]   (--check: list the lines whose recording is missing)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MISSIONS } from '../src/game/missions';
import { numeralOf } from '../src/game/campaign';

const GENERIC: [string, string, string][] = [
  ['quaestor.noted.1', 'A goal met', 'Noted.'],
  ['quaestor.noted.2', 'A goal met', 'Counted.'],
  ['quaestor.noted.3', 'A goal met', 'Good. Next.'],
  ['quaestor.noted.4', 'A goal met', 'I have written it down.'],
  ['campaign.defeat', 'The colony has fallen', 'The Senate will want a report. I will write that the province was well begun and the legate learned quickly. Try again; the coast is still there.'],
];

interface Line { id: string; when: string; text: string }
const lines: Line[] = [];
const byMission: { title: string; lines: Line[] }[] = [];
for (const [id, when, text] of GENERIC) lines.push({ id, when, text });
MISSIONS.forEach((m, i) => {
  const mine: Line[] = [];
  const add = (id: string, when: string, text: string) => { const l = { id: `${m.id}.${id}`, when, text }; mine.push(l); lines.push(l); };
  add('brief', 'The briefing, as the mission opens (pause at each paragraph break)', m.briefing.join('\n\n'));
  add('debrief', 'The mission won', `${m.debrief} ${m.hook}`);
  for (const t of m.tips ?? []) add(`tip.${t.id}`, `A tip, the first time: ${t.on === 'time' ? 'after a while' : `on "${t.on}"`}`, `${t.title} ${t.detail}`);
  for (const [k, text] of Object.entries(m.voice ?? {})) add(k, `On "${k}"`, text);
  byMission.push({ title: `Mission ${numeralOf(i)} · ${m.title} — ${m.subtitle}`, lines: mine });
});

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const ids = new Set<string>();
for (const l of lines) { check(!ids.has(l.id), `line id ${l.id} is unique`); ids.add(l.id); }
check(lines.every((l) => l.text.trim().length > 0), 'every line has words');
check(lines.every((l) => /^[a-z0-9.]+$/.test(l.id)), 'every id is a plain file name');

const words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
const md = `# The quaestor's script

Gaius Sestius, quaestor of the province of Terra Nova, speaks every line of the campaign. One voice
throughout: a dry, exact man in his fifties who counts things and is faintly amused by everything
else; unhurried and measured, with a slight Italian accent, never stage-Roman. He pauses a beat at every paragraph
break and never raises his voice, not even for the Senate.

Latin titles are said the classical way: Castra (KAS-tra), Domus (DOH-moos), Piscis et Venatio
(PIS-kis et weh-NAH-tee-oh), Panem (PAH-nem), Fines (FEE-nace), Metalla (meh-TAL-la), Ferrum (FER-room),
Arma (AR-ma), Prima Pugna (PREE-ma POOG-na), Dei (DAY-ee), Mercatura (mer-ka-TOO-ra), Mare Nostrum
(MAH-reh NOS-troom), Machinae (MA-ki-nye), Classis (KLAS-sis), Provincia (pro-WIN-ki-a). Varro is VAR-roh.

Each line below is one recording, saved as \`public/voice/<id>.mp3\` (mono, 128 kbps; \`scripts/voicesynth.ts\` makes them with ElevenLabs). The
game plays whichever recordings are there and leaves the rest to the text on screen, so the lines can
arrive in any order. This file is generated from \`src/game/missions.ts\` by \`scripts/voicelines.ts\`;
edit the missions, not this file. ${lines.length} lines, about ${words} words.

## Everywhere

${GENERIC.map(([id, when, text]) => `- \`${id}\` — *${when}*\n\n  ${text}\n`).join('\n')}
${byMission.map((m) => `## ${m.title}\n\n${m.lines.map((l) => `- \`${l.id}\` — *${l.when}*\n\n${l.text.split('\n\n').map((p) => `  ${p}`).join('\n\n')}\n`).join('\n')}`).join('\n')}`;

mkdirSync('voice', { recursive: true });
const json = JSON.stringify(Object.fromEntries(lines.map((l) => [l.id, l.text])), null, 2) + '\n';
const same = (path: string, text: string) => existsSync(path) && readFileSync(path, 'utf8') === text;
const unchanged = same('voice/SCRIPT.md', md) && same('voice/lines.json', json);
writeFileSync('voice/SCRIPT.md', md);
writeFileSync('voice/lines.json', json);
console.log(`     voice/SCRIPT.md and voice/lines.json ${unchanged ? 'unchanged' : 'written'}: ${lines.length} lines, ${words} words`);

if (process.argv.includes('--check')) {
  const missing = lines.filter((l) => !existsSync(`public/voice/${l.id}.mp3`));
  console.log(`     recordings: ${lines.length - missing.length} of ${lines.length} in public/voice${missing.length ? `; missing: ${missing.map((l) => l.id).join(', ')}` : ''}`);
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
