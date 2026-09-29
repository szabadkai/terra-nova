// Headless check of the graphics detection (src/render/hardware.ts): made-up machines map to the
// expected level and effect switches, GPU names from each browser are read the same way, the timed
// sample only ever steps down (and not too far for a known GPU), and the low frame rate message
// comes once, only after a long slow spell with nothing left for the automatic resolution to give.
// Nothing here touches the game.
// Usage: npx tsx scripts/hardware.ts
import { LEVELS, LowFpsWatch, PRESETS, confirmLevel, frameMs, gpuLabel, gpuPower, guessLevel, lowFpsAdvice, type Signals } from '../src/render/hardware';
import type { Quality } from '../src/render/renderer';

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

const BUDGET = 1000 / 60;
const sig = (o: Partial<Signals>): Signals => ({ gpu: '', width: 1920, height: 1080, dpr: 1, cores: 8, memory: 8, touch: false, ...o });

// --- GPU names as the browsers give them
{
  const labels: [string, string][] = [
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)', 'Apple M5 Pro'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 3080'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel UHD Graphics 620'],
    ['ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)', 'Intel Iris Plus Graphics 655'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon Graphics'],
    ['NVIDIA GeForce GTX 980, or similar', 'NVIDIA GeForce GTX 980'],
    ['Apple M1, or similar', 'Apple M1'],
    ['Adreno (TM) 740', 'Adreno 740'],
  ];
  for (const [raw, want] of labels) check(gpuLabel(raw) === want, `"${raw}" reads as "${want}" (got "${gpuLabel(raw)}")`);
  const order: [string, string][] = [
    ['Apple M1', 'Apple M5 Pro'], ['Apple M5 Pro', 'Apple M5 Max'], ['Intel UHD Graphics 620', 'Intel Iris Xe Graphics'],
    ['NVIDIA GeForce GTX 1060', 'NVIDIA GeForce RTX 3060'], ['NVIDIA GeForce RTX 3060', 'NVIDIA GeForce RTX 4090'],
    ['AMD Radeon RX 6600', 'AMD Radeon RX 7900 XTX'], ['Adreno 650', 'Adreno 740'], ['Intel Iris Xe Graphics', 'Apple M1'],
    ['NVIDIA GeForce RTX 4070 Laptop GPU', 'NVIDIA GeForce RTX 4070'],
  ];
  for (const [a, b] of order) check(gpuPower(a).power < gpuPower(b).power, `${a} (${gpuPower(a).power.toFixed(2)}) is weaker than ${b} (${gpuPower(b).power.toFixed(2)})`);
  const m5 = gpuPower('ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)').power;
  check(Math.abs(m5 - 1) < 0.05, `the reference GPU (Apple M5 Pro) has power 1 (got ${m5.toFixed(2)})`);
  check(gpuPower('Apple GPU').power === 0, "Safari's masked \"Apple GPU\" is not known");
  check(!!gpuPower('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)').software, 'SwiftShader is software drawing');
  check(!!gpuPower('llvmpipe (LLVM 15.0.7, 256 bits)').software, 'llvmpipe is software drawing');
}

// --- made-up machines -> level and effect switches
{
  interface Case { name: string; s: Signals; level: Quality }
  const cases: Case[] = [
    { name: 'M1 laptop at 2x', s: sig({ gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', width: 1440, height: 900, dpr: 2 }), level: 'medium' },
    { name: '4K desktop with a GeForce RTX 3080 (150% scaling)', s: sig({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)', width: 2560, height: 1440, dpr: 1.5, cores: 16 }), level: 'ultra' },
    { name: 'phone (iPhone, Safari)', s: sig({ gpu: 'Apple GPU', width: 393, height: 852, dpr: 3, cores: 6, memory: 0, touch: true }), level: 'low' },
    { name: 'phone (Android, Adreno 740)', s: sig({ gpu: 'Adreno (TM) 740', width: 412, height: 915, dpr: 2.625, touch: true }), level: 'low' },
    { name: 'tablet (iPad, Safari)', s: sig({ gpu: 'Apple GPU', width: 1024, height: 1366, dpr: 2, memory: 0, touch: true }), level: 'medium' },
    { name: 'office laptop, Intel UHD 620 at 1080p', s: sig({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', cores: 4 }), level: 'low' },
    { name: 'thin laptop, Iris Xe at 125%', s: sig({ gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', width: 1536, height: 864, dpr: 1.25 }), level: 'low' },
    { name: 'M5 Pro on a 3440x1440 ultrawide', s: sig({ gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)', width: 3440, height: 1440, cores: 15, memory: 8 }), level: 'ultra' },
    { name: 'gaming PC, RX 6800 XT at 1440p', s: sig({ gpu: 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', width: 2560, height: 1440, cores: 16 }), level: 'ultra' },
    { name: 'GTX 1060 on a 4K screen', s: sig({ gpu: 'NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2', width: 3840, height: 2160 }), level: 'low' },
    { name: 'RTX 3060 at 1080p', s: sig({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), level: 'ultra' },
    { name: 'Mac with Safari (GPU hidden)', s: sig({ gpu: 'Apple GPU', width: 1512, height: 982, dpr: 2, memory: 0 }), level: 'high' },
    { name: 'no GPU (SwiftShader)', s: sig({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' }), level: 'low' },
    { name: 'a Chromebook with 2 GB', s: sig({ gpu: 'Mali-G72', width: 1366, height: 768, memory: 2, cores: 4 }), level: 'low' },
    { name: 'a strong GPU with 4 GB of memory', s: sig({ gpu: 'NVIDIA GeForce RTX 4080', memory: 4 }), level: 'medium' },
  ];
  for (const c of cases) {
    const g = guessLevel(c.s, BUDGET);
    const p = PRESETS[g.level];
    const fx = `bloom ${p.bloom ? 'on' : 'off'}, AO ${p.ao ? 'on' : 'off'}, tilt-shift ${p.dof ? 'on' : 'off'}, resolution ${p.resolution}`;
    const ms = g.gpu.power ? LEVELS.map((q) => `${q[0]} ${frameMs(q, c.s, g.gpu.power).toFixed(1)}`).join(' ') : 'unknown GPU';
    check(g.level === c.level, `${c.name}: ${g.level} (${fx}; ${ms} ms${g.capWhy ? `; capped: ${g.capWhy}` : ''}) — expected ${c.level}`);
  }
  // what each level switches
  check(!PRESETS.low.bloom && !PRESETS.low.dof && !PRESETS.low.ao && PRESETS.low.resolution !== 'auto', 'Low: bloom, AO and tilt-shift off, a fixed lower resolution');
  check(!PRESETS.medium.bloom && !PRESETS.medium.dof && !PRESETS.medium.ao && PRESETS.medium.resolution !== 'auto', 'Medium: bloom, AO and tilt-shift off, a fixed lower resolution');
  check(PRESETS.high.bloom && PRESETS.high.dof && PRESETS.high.resolution === 'auto', 'High: bloom and tilt-shift on, automatic resolution');
  check(PRESETS.ultra.bloom && PRESETS.ultra.dof && PRESETS.ultra.resolution === 'auto', 'Ultra: bloom and tilt-shift on, automatic resolution');
  check(!PRESETS.low.grass, 'Low: no grass');
}

// --- the timed sample
{
  const known = guessLevel(sig({ gpu: 'NVIDIA GeForce RTX 4090', width: 2560, height: 1440 }), BUDGET);
  check(known.level === 'ultra', `the RTX 4090 guess is Ultra (${known.level})`);
  const tried = (d: ReturnType<typeof confirmLevel>) => d.timed.map(([q, ms]) => `${q} ${ms}`).join(', ');
  let d = confirmLevel(known, (q) => ({ ultra: 12, high: 10, medium: 8, low: 6 }[q]), BUDGET);
  check(d.level === 'ultra' && d.timed.length === 1, `in budget at once: kept, timed once (${tried(d)})`);
  d = confirmLevel(known, (q) => ({ ultra: 22, high: 19, medium: 14, low: 9 }[q]), BUDGET);
  check(d.level === 'medium', `steps down to the first level that holds (${d.level}: ${tried(d)})`);
  d = confirmLevel(known, () => 80, BUDGET);
  check(d.level === 'medium' && d.timed.length === 3, `a known GPU goes at most two levels below its guess, however slow the moment (${d.level}: ${tried(d)})`);
  const unknown = guessLevel(sig({ gpu: 'Apple GPU', memory: 0 }), BUDGET);
  d = confirmLevel(unknown, () => 80, BUDGET);
  check(d.level === 'low' && d.resolution === '50', `an unknown GPU goes all the way to Low, and to half resolution when even that is far too slow (${d.level} ${d.resolution}: ${tried(d)})`);
  d = confirmLevel(unknown, (q) => (q === 'low' ? 18 : 40), BUDGET);
  check(d.level === 'low' && !d.resolution, `Low only just over the budget keeps its resolution (${d.resolution ?? 'kept'})`);
  const med = guessLevel(sig({ gpu: 'Apple M1', width: 1440, height: 900, dpr: 2 }), BUDGET);
  d = confirmLevel(med, () => 3, BUDGET);
  check(d.level === med.level && d.timed.length === 1, `never steps up, however fast (${d.level})`);
  check(guessLevel(sig({ gpu: 'Apple GPU', memory: 0, touch: true, width: 1024, height: 1366, dpr: 2 }), BUDGET).level === 'medium', 'an unknown GPU starts no higher than its device allows');
  // a slower display gives a bigger budget, a faster one no smaller than 60 fps
  const slow = sig({ gpu: 'Apple M1', width: 1440, height: 900, dpr: 2 });
  check(LEVELS.indexOf(guessLevel(slow, 1000 / 30).level) > LEVELS.indexOf(guessLevel(slow, BUDGET).level), `a 30 Hz display allows a higher level (${guessLevel(slow, 1000 / 30).level})`);
}

// --- the low frame rate message
{
  const w = new LowFpsWatch();
  let said = -1;
  for (let t = 0; t < 19; t++) if (w.feed(30, 60, true)) said = t;
  check(said < 0, 'nothing after 19 slow seconds');
  check(w.feed(30, 60, true), 'the message comes on the 20th slow second in a row');
  let again = false;
  for (let t = 0; t < 200; t++) again ||= w.feed(20, 60, true);
  check(!again, 'and never again in the same session');
  const v = new LowFpsWatch();
  let early = false;
  for (let t = 0; t < 100; t++) early ||= v.feed(t % 15 === 14 ? 58 : 30, 60, true);
  check(!early, 'a good second now and then starts the count again');
  const a = new LowFpsWatch();
  let floor = false;
  for (let t = 0; t < 100; t++) floor ||= a.feed(30, 60, false);
  check(!floor, 'nothing while the automatic resolution still has a step to give');
  const c = new LowFpsWatch();
  let capped = false;
  for (let t = 0; t < 100; t++) capped ||= c.feed(29, 30, true);
  check(!capped, 'a frame cap of 30 that is met is not a low frame rate');
  const all = lowFpsAdvice({ bloom: true, ao: true, dof: true, quality: 'high', resolution: 'auto' });
  check(all === 'Turning off bloom, ambient occlusion or the tilt-shift blur in the menu helps most.', `the advice names the effects that are on: "${all}"`);
  check(lowFpsAdvice({ bloom: false, ao: false, dof: true, quality: 'high', resolution: 'auto' })!.includes('the tilt-shift blur') === true, 'just the one that is on');
  check(/detail level/.test(lowFpsAdvice({ bloom: false, ao: false, dof: false, quality: 'medium', resolution: '85' }) ?? ''), 'with the effects off it points at the detail level');
  check(lowFpsAdvice({ bloom: false, ao: false, dof: false, quality: 'low', resolution: '50' }) === null, 'and says nothing when everything is already down');
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
