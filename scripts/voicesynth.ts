// Synthesises the campaign's lines (voice/lines.json, written by scripts/voicelines.ts; the speaker of
// each line not in the quaestor's voice is in voice/speakers.json) with ElevenLabs into
// public/voice/<id>.mp3. Skips the recordings already there, so a run after a script change only pays
// for the new lines. Eleven v3 takes no SSML and no speed setting: the accent and the pace go in as an
// audio tag ahead of the words, and a paragraph break becomes a [pause] tag.
// Usage: ELEVENLABS_API_KEY=... npx tsx scripts/voicesynth.ts [--force] [--out DIR] [--speaker quaestor|varro] [id ...]
//   ids: only those lines (or those starting with an id followed by a dot, e.g. `castra`); --force: redo them
//   --out: write there instead of public/voice (render to a scratch folder, check, then copy over)
//   --speaker: only that speaker's lines
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Profile { voice: string; model: string; settings: Record<string, number | boolean>; style: string }
const PROFILES: Record<string, Profile> = {
  // Gaius Sestius: v3 has stability only (0 creative, 0.5 natural, 1 robust); chosen by ear against v2 and v4
  quaestor: { voice: '9Po0MT5ARCjcSMymzKvp', model: 'eleven_v3', settings: { stability: 0.5 }, style: '[slight Italian accent, slow and measured]' },
  // Quintus Varro: the voice's own sliders are stability 50 % and similarity 75 %
  varro: { voice: process.env.VARRO_VOICE ?? 'vXy0wv6sr1IDly0GrX1U', model: 'eleven_v3', settings: { stability: 0.5, similarity_boost: 0.75 }, style: '[cold, courteous patrician, slow and precise]' },
};
const FORMAT = 'mp3_44100_128';
const PARALLEL = 2;

const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outDir = flag('--out') ?? 'public/voice';
const speaker = flag('--speaker');
const force = args.includes('--force');
const only = args.filter((a, i) => !a.startsWith('--') && !['--out', '--speaker'].includes(args[i - 1]));
const lines: Record<string, string> = JSON.parse(readFileSync('voice/lines.json', 'utf8'));
const speakers: Record<string, string> = existsSync('voice/speakers.json') ? JSON.parse(readFileSync('voice/speakers.json', 'utf8')) : {};
const whoIs = (id: string) => speakers[id] ?? 'quaestor';
const want = Object.keys(lines).filter((id) => (!speaker || whoIs(id) === speaker) && (!only.length || only.some((o) => id === o || id.startsWith(`${o}.`))));
// done already: in the output folder, or (rendering to a scratch folder) in public/voice
const todo = want.filter((id) => force || !(existsSync(`${outDir}/${id}.mp3`) || existsSync(`public/voice/${id}.mp3`)));
console.log(`${todo.length} of ${want.length} lines to synthesise into ${outDir} (${todo.reduce((n, id) => n + lines[id].length, 0)} characters)`);
mkdirSync(outDir, { recursive: true });

// what is said: the accent/pace tag, the paragraph breaks as pauses, and a letter's signature said in full ("Q." is not "cue")
const spoken = (id: string) => {
  const text = lines[id].replace(/\s*—\s*Q\. Varro/g, '\n\n[pause] Quintus Varro').replace(/\bQ\. Varro/g, 'Quintus Varro');
  return `${PROFILES[whoIs(id)].style} ${text.split(/\n\n+/).join('\n\n[pause] ').replace(/\[pause\] \[pause\]/g, '[pause]')}`;
};

async function synth(id: string): Promise<void> {
  const p = PROFILES[whoIs(id)];
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${p.voice}?output_format=${FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': key!, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: spoken(id), model_id: p.model, voice_settings: p.settings }),
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
