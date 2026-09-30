// Checks recordings against the script: each mp3 is transcribed with ElevenLabs Scribe and compared
// with voice/lines.json by the words of the script it contains. Reports the lowest matches (digits
// and homophones such as "hare"/"hair" account for most of a low one), any word of the accent/pace
// tag read aloud, and the pace of each clip in words a minute.
// Usage: ELEVENLABS_API_KEY=... npx tsx scripts/voiceverify.ts [DIR] [id ...]   (DIR defaults to public/voice)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }
const args = process.argv.slice(2);
const dir = args[0] && !/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(args[0]) ? args[0] : 'public/voice';
const only = args.filter((a) => a !== dir);
const lines: Record<string, string> = JSON.parse(readFileSync('voice/lines.json', 'utf8'));
const norm = (t: string) => t.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const TAG_WORDS = ['italian', 'accent', 'measured', 'pause', 'patrician', 'courteous', 'precise'];
const ids = readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)).filter((id) => id in lines && (!only.length || only.some((o) => id === o || id.startsWith(`${o}.`)))).sort();
const seconds = (id: string) => +(execFileSync('afinfo', [`${dir}/${id}.mp3`]).toString().match(/estimated duration: ([\d.]+)/)?.[1] ?? 0);

interface Row { id: string; hit: number; extra: number; n: number; tags: string[]; wpm: number; text: string }
const rows: Row[] = [];
let errors = 0, next = 0;
async function work() {
  for (let i = next++; i < ids.length; i = next++) {
    const id = ids[i];
    const fd = new FormData();
    fd.append('model_id', 'scribe_v1');
    fd.append('tag_audio_events', 'false');
    fd.append('file', new Blob([readFileSync(`${dir}/${id}.mp3`)], { type: 'audio/mpeg' }), `${id}.mp3`);
    let text: string | undefined;
    for (let a = 0; a < 4 && text == null; a++) {
      const j = await (await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key! }, body: fd })).json() as { text?: string };
      text = j.text; if (text == null) await new Promise((r) => setTimeout(r, 2000));
    }
    if (text == null) { errors++; console.log(`ERR  ${id}: no transcript`); continue; }
    const exp = norm(lines[id]), got = norm(text), gs = new Set(got), es = new Set(exp);
    rows.push({ id, hit: exp.filter((w) => gs.has(w)).length / exp.length, extra: got.filter((w) => !es.has(w)).length, n: exp.length, tags: got.filter((w) => TAG_WORDS.includes(w) && !es.has(w)), wpm: Math.round(exp.length / (seconds(id) / 60)), text });
  }
}
await Promise.all([work(), work(), work(), work()]);
rows.sort((a, b) => a.hit - b.hit);
writeFileSync('voice/.verify.json', JSON.stringify(rows, null, 1));
console.log(`${rows.length} clips in ${dir}; transcripts in voice/.verify.json`);
console.log('lowest word match:');
for (const r of rows.slice(0, 10)) console.log(`  ${r.id.padEnd(30)} ${r.hit.toFixed(2)}  (${r.extra} extra of ${r.n})`);
const tagged = rows.filter((r) => r.tags.length);
console.log(tagged.length ? `TAG WORDS SPOKEN: ${tagged.map((r) => `${r.id} (${r.tags.join(' ')})`).join(', ')}` : 'no tag words spoken');
const long = rows.filter((r) => r.n >= 8).sort((a, b) => a.wpm - b.wpm);
console.log(`pace (lines of 8+ words): ${long[0]?.wpm}–${long[long.length - 1]?.wpm} wpm; slowest ${long.slice(0, 2).map((r) => r.id).join(', ')}, fastest ${long.slice(-2).map((r) => r.id).join(', ')}`);
console.log(`mean word match ${(rows.reduce((n, r) => n + r.hit, 0) / (rows.length || 1)).toFixed(3)}`);
process.exit(errors ? 1 : 0);
