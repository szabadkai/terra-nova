// Synthesises the quaestor's lines (voice/lines.json, written by scripts/voicelines.ts) with ElevenLabs
// into public/voice/<id>.mp3, the voice of Gaius Sestius throughout. Skips the recordings already
// there, so a run after a script change only pays for the new lines. Eleven v3 takes no SSML and no
// speed setting: the accent and the pace go in as an audio tag ahead of the words, and a paragraph
// break becomes a [pause] tag.
// Usage: ELEVENLABS_API_KEY=... npx tsx scripts/voicesynth.ts [--force] [--out DIR] [id ...]
//   ids: only those lines (or those starting with an id followed by a dot, e.g. `castra`); --force: redo them
//   --out: write there instead of public/voice (render to a scratch folder, check, then copy over)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const VOICE = '9Po0MT5ARCjcSMymzKvp'; // Gaius Sestius
// the other speakers (voice/speakers.json): their ElevenLabs voice from the environment, their lines skipped until it is set
const VOICES: Record<string, string | undefined> = { varro: process.env.VARRO_VOICE };
const MODEL = 'eleven_v3';
const FORMAT = 'mp3_44100_128';
const SETTINGS = { stability: 0.5 }; // v3: 0 creative, 0.5 natural, 1 robust
const STYLE = '[slight Italian accent, slow and measured]';
const PARALLEL = 2;

const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outDir = oi >= 0 ? args[oi + 1] : 'public/voice';
const force = args.includes('--force');
const only = args.filter((a, i) => !a.startsWith('--') && (oi < 0 || (i !== oi + 1)));
const lines: Record<string, string> = JSON.parse(readFileSync('voice/lines.json', 'utf8'));
const speakers: Record<string, string> = existsSync('voice/speakers.json') ? JSON.parse(readFileSync('voice/speakers.json', 'utf8')) : {};
const voiceOf = (id: string) => (speakers[id] ? VOICES[speakers[id]] : VOICE);
const unvoiced = Object.keys(lines).filter((id) => !voiceOf(id));
if (unvoiced.length) console.log(`skipping ${unvoiced.length} line(s) with no voice set (${[...new Set(unvoiced.map((id) => speakers[id]))].map((w) => `${w.toUpperCase()}_VOICE`).join(', ')}): ${unvoiced.join(', ')}`);
const want = Object.keys(lines).filter((id) => voiceOf(id) && (!only.length || only.some((o) => id === o || id.startsWith(`${o}.`))));
const todo = want.filter((id) => force || !existsSync(`${outDir}/${id}.mp3`));
console.log(`${todo.length} of ${want.length} lines to synthesise into ${outDir} (${todo.reduce((n, id) => n + lines[id].length, 0)} characters)`);
mkdirSync(outDir, { recursive: true });

const spoken = (text: string) => `${STYLE} ${text.split(/\n\n+/).join('\n\n[pause] ')}`;

async function synth(id: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceOf(id)}?output_format=${FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': key!, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: spoken(lines[id]), model_id: MODEL, voice_settings: SETTINGS }),
    });
    if (res.ok) {
      const mp3 = Buffer.from(await res.arrayBuffer());
      writeFileSync(`${outDir}/${id}.mp3`, mp3);
      console.log(`ok   ${id} (${(mp3.length / 1024).toFixed(0)} KB)`);
      return;
    }
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    throw new Error(`${id}: ${res.status} ${body}`);
  }
}

const queue = [...todo];
let fails = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  for (let id = queue.shift(); id; id = queue.shift()) {
    try { await synth(id); } catch (e) { fails++; console.log(`FAIL ${(e as Error).message}`); if (/quota|credits|unauthori[sz]ed|permission/i.test((e as Error).message)) queue.length = 0; }
  }
}));
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
