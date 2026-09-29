// Audio: ambience, positional sound effects and music. Effects that have an original
// Settlers III sample use it; everything else is synthesised. Music is the recorded
// soundtrack when it can be loaded, otherwise a generative lute.

// The original samples are served by the Vite dev server straight from the local reference
// extraction. It is gitignored and never bundled, so builds fall back to the synth versions.
const SAMPLE_DIR = '/reference/s3-demo-1998-05-12/extracted/sounds/';
const SAMPLES: Record<string, { files: string[]; gain: number }> = {
  chop: { files: ['00_axe_0', '00_axe_1'], gain: 0.4 },
  hammer: { files: ['01_buildhammer_0', '01_buildhammer_1'], gain: 0.35 },
  anvil: { files: ['01_buildhammer_0', '01_buildhammer_1'], gain: 0.25 },
  dig: { files: ['02_dig_0'], gain: 0.25 },
  pick: { files: ['03_pickaxe_0', '03_pickaxe_1'], gain: 0.8 },
  clang: { files: ['03_pickaxe_0', '03_pickaxe_1'], gain: 0.7 },
  plant: { files: ['04_plant_0'], gain: 0.4 },
  saw: { files: ['05_saw_0'], gain: 0.3 },
  treefall: { files: ['08_treefall_0'], gain: 0.7 },
  harvest: { files: ['09_gras_0', '09_gras_1'], gain: 0.4 },
  bird: { files: ['11_bird_0', '11_bird_1', '11_bird_2', '11_bird_3', '11_bird_4'], gain: 0.2 },
};

// The soundtrack streams from public/music, served next to the page. Loudness is each track's
// measured gated RMS in dBFS; playback pulls tracks most of the way towards a common level so
// quiet pieces stay quieter without dropping out. If the first track will not load (a build
// without the files, or no AAC decoder) the generative lute plays instead.
const MUSIC_DIR = 'music/';
// The campaign's narration (the quaestor's lines, voice/SCRIPT.md), served next to the page like the
// music; a missing recording leaves the line to the text on screen.
const VOICE_DIR = 'voice/';
const VOICE_EXT = '.mp3';
const TRACKS: { file: string; loudness: number }[] = [
  { file: '01.m4a', loudness: -22.4 },
  { file: '02.m4a', loudness: -22.8 },
  { file: '03.m4a', loudness: -25.8 },
  { file: '04.m4a', loudness: -24.7 },
  { file: '05.m4a', loudness: -24.7 },
  { file: '06.m4a', loudness: -22.3 },
  { file: '07.m4a', loudness: -22.6 },
  { file: '08.m4a', loudness: -27.8 },
  { file: '09.m4a', loudness: -19.8 },
  { file: '10.m4a', loudness: -30.1 },
  { file: '11.m4a', loudness: -28.8 },
  { file: '12.m4a', loudness: -24.3 },
];
type Track = (typeof TRACKS)[number];
/** a track at -24 dBFS plays at this gain, under the effects */
const TRACK_LEVEL = 0.5;
const trackLevel = (tr: Track) => TRACK_LEVEL * 10 ** (((-24 - tr.loudness) * 0.6) / 20);

// Level-match samples: scale to a common short-term loudness (loudest 50 ms RMS) without clipping.
function normalize(buf: AudioBuffer) {
  const d = buf.getChannelData(0);
  const win = Math.max(1, Math.floor(buf.sampleRate * 0.05));
  let peak = 0, loud = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let s = 0; s + win <= d.length; s += win >> 2) {
    let sum = 0;
    for (let i = s; i < s + win; i++) sum += d[i] * d[i];
    loud = Math.max(loud, Math.sqrt(sum / win));
  }
  if (peak === 0 || loud === 0) return;
  const k = Math.min(0.3 / loud, 1 / peak);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) ch[i] *= k;
  }
}

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private musicGain!: GainNode;
  private synthGain!: GainNode;
  private trackGain!: GainNode;
  private track: HTMLAudioElement | null = null;
  /** tracks believed playable; empty once the soundtrack failed to load */
  private tracks = TRACKS.slice();
  /** index into TRACKS of the track loaded now */
  private trackIdx = -1;
  private trackOk = false;
  /** the browser refused play() without a gesture: retry on the next one */
  private trackBlocked = false;
  private trackTimer = 0;
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private listener = { x: 0, z: 0, zoom: 30 };
  volume = 0.7;
  musicOn = true;
  /** channel levels 0..1, on top of each channel's base mix */
  musicVol = 1;
  sfxVol = 1;
  ambVol = 1;
  /** a menu is open: ambience is ducked and the birds fall silent */
  private paused = false;
  // the campaign's narration: recorded lines served from public/voice, one at a time, over ducked music
  private voiceGain!: GainNode;
  voiceVol = 1;
  private voiceEl: HTMLAudioElement | null = null;
  /** a line is playing: the music stands back */
  private speaking = false;
  /** lines whose recording is not there: asked for once, silent after */
  private missingVoice = new Set<string>();
  private musicT = 0;
  private birdT = 2;
  private recent = new Map<string, number>();
  private buffers = new Map<string, AudioBuffer>();
  started = false;

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.8 * this.sfxVol;
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = this.ambLevel();
    this.amb.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicLevel();
    this.musicGain.connect(this.master);
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = this.voiceVol;
    this.voiceGain.connect(this.master);
    // the generative lute, with a simple reverb
    this.synthGain = ctx.createGain();
    this.synthGain.gain.value = 0.22;
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.synthGain.connect(this.musicGain);
    this.synthGain.connect(conv).connect(wet).connect(this.musicGain);
    this.startSoundtrack();
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // wind bed
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(wf.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.12;
    wind.connect(wf).connect(this.windGain).connect(this.amb);
    wind.start();
    lfo.start();
    // rain bed
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 900;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rf).connect(this.rainGain).connect(this.amb);
    rain.start();
    if (import.meta.env.DEV) void this.loadSamples();
  }

  private startSoundtrack() {
    const ctx = this.ctx!;
    const el = document.createElement('audio');
    el.preload = 'auto';
    this.trackGain = ctx.createGain();
    ctx.createMediaElementSource(el).connect(this.trackGain).connect(this.musicGain);
    el.onplaying = () => { this.trackOk = true; };
    // a short breath of ambience between tracks
    el.onended = () => { this.trackTimer = window.setTimeout(() => this.nextTrack(), 4000 + Math.random() * 8000); };
    el.onerror = () => {
      // the first track failing means this build has no soundtrack; later ones are just skipped
      this.tracks = this.trackOk ? this.tracks.filter((tr) => tr !== TRACKS[this.trackIdx]) : [];
      this.nextTrack();
    };
    this.track = el;
    this.nextTrack();
  }

  /** Jump to the next (1) or previous (-1) track. Returns its number, or 0 without a soundtrack. */
  skipTrack(dir: 1 | -1) {
    if (!this.track || !this.soundtrack) return 0;
    this.nextTrack(dir);
    return this.trackIdx + 1;
  }
  get trackCount() {
    return TRACKS.length;
  }

  private nextTrack(dir: 1 | -1 = 1) {
    clearTimeout(this.trackTimer);
    const el = this.track;
    if (!el || !this.tracks.length) return;
    // in numerical order, skipping any that failed, and round again after the last
    const n = TRACKS.length;
    do this.trackIdx = (this.trackIdx + dir + n) % n;
    while (!this.tracks.includes(TRACKS[this.trackIdx]));
    const tr = TRACKS[this.trackIdx];
    this.trackGain.gain.value = trackLevel(tr);
    el.src = MUSIC_DIR + tr.file;
    if (this.musicOn) this.playTrack();
  }

  private playTrack() {
    this.trackBlocked = false;
    this.track?.play().catch((e: DOMException) => {
      if (e.name === 'NotAllowedError') this.trackBlocked = true;
    });
  }

  private async loadSamples() {
    const ctx = this.ctx!;
    const files = new Set(Object.values(SAMPLES).flatMap((s) => s.files));
    await Promise.all([...files].map(async (f) => {
      try {
        const res = await fetch(`${SAMPLE_DIR}${f}.wav`);
        if (!res.ok) return;
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        normalize(buf);
        this.buffers.set(f, buf);
      } catch { /* not available: keep the synth version */ }
    }));
  }

  private sample(name: string) {
    const s = SAMPLES[name];
    if (!s) return null;
    const buf = this.buffers.get(s.files[Math.floor(Math.random() * s.files.length)]);
    return buf ? { buf, gain: s.gain } : null;
  }

  private playBuffer(t: number, buf: AudioBuffer, gain: number, out: AudioNode, rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(t);
  }

  private impulse(sec: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    return b;
  }

  private musicLevel() {
    return this.musicOn ? this.musicVol * (this.speaking ? 0.35 : 1) : 0;
  }
  private ambLevel() {
    return 0.5 * this.ambVol * (this.paused ? 0.3 : 1) * (this.speaking ? 0.5 : 1);
  }

  /**
   * Speak a line of the campaign's narration (public/voice/<id>.mp3). Resolves true once it plays;
   * false when the recording is not there, another line is speaking (unless `interrupt`), or the
   * browser wants a click first (call again from one).
   */
  say(id: string, o: { interrupt?: boolean } = {}): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx || this.voiceVol <= 0 || this.missingVoice.has(id)) return Promise.resolve(false);
    if (this.voiceEl) { if (!o.interrupt) return Promise.resolve(false); this.stopVoice(); }
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.src = `${VOICE_DIR}${id}${VOICE_EXT}`;
    const src = ctx.createMediaElementSource(el);
    src.connect(this.voiceGain);
    const done = () => {
      if (this.voiceEl !== el) return;
      this.voiceEl = null;
      this.speaking = false;
      this.ramp(this.musicGain, this.musicLevel());
      this.ramp(this.amb, this.ambLevel());
      src.disconnect();
    };
    el.onplaying = () => { this.speaking = true; this.ramp(this.musicGain, this.musicLevel()); this.ramp(this.amb, this.ambLevel()); };
    el.onended = done;
    el.onerror = () => { this.missingVoice.add(id); done(); };
    this.voiceEl = el;
    if (ctx.state === 'suspended') void ctx.resume();
    return el.play().then(() => true, () => { done(); return false; });
  }
  /** Cut the narration short (a new mission, the title screen). */
  stopVoice() {
    const el = this.voiceEl;
    if (!el) return;
    this.voiceEl = null;
    this.speaking = false;
    el.pause();
    el.src = '';
    this.ramp(this.musicGain, this.musicLevel());
    this.ramp(this.amb, this.ambLevel());
  }
  setVoice(v: number) {
    this.voiceVol = v;
    this.ramp(this.voiceGain, v);
    if (v <= 0) this.stopVoice();
  }
  private ramp(g: GainNode | undefined, v: number) {
    if (this.ctx && g) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number) {
    this.volume = v;
    this.ramp(this.master, v);
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    this.ramp(this.musicGain, this.musicLevel());
    const el = this.track;
    if (!el) return;
    // stop streaming once faded out; pick up where it left off (not mid-gap between tracks)
    if (!on) setTimeout(() => { if (!this.musicOn) el.pause(); }, 300);
    else if (el.paused && !el.ended && el.src) this.playTrack();
  }
  /** a user gesture: wake a suspended context and any music the browser held back */
  unlock() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    if (this.trackBlocked && this.musicOn) this.playTrack();
  }
  /** whether music is the recorded soundtrack (false once it failed and the lute took over) */
  get soundtrack() {
    return this.tracks.length > 0;
  }
  setMix(music: number, sfx: number, ambience: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.ambVol = ambience;
    this.ramp(this.musicGain, this.musicLevel());
    this.ramp(this.sfx, 0.8 * sfx);
    this.ramp(this.amb, this.ambLevel());
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.ramp(this.amb, this.ambLevel());
  }

  setListener(x: number, z: number, zoom: number) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.zoom = zoom;
  }

  private gainFor(x?: number, z?: number) {
    if (x === undefined || z === undefined) return 1;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    const range = 8 + this.listener.zoom * 0.7;
    const zoomAtt = Math.max(0.25, 1 - (this.listener.zoom - 10) / 110);
    return Math.max(0, 1 - d / range) * zoomAtt;
  }

  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, out: AudioNode, sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.004, peak, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, peak: number, out: AudioNode, slideTo?: number, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + attack + 0.05);
  }

  private pluck(t: number, freq: number, dur: number, peak: number, out: AudioNode) {
    // Plucked string: a sawtooth whose lowpass closes as it decays. No feedback loop, so it can't
    // run away (the old comb-filter version had a loop gain above 1 and screamed at ~2.2 kHz).
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = -3; // Butterworth: no resonant peak
    lp.frequency.setValueAtTime(Math.min(freq * 6, 2500), t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.2, t + dur * 0.6);
    const g = ctx.createGain();
    this.env(g, t, 0.004, peak * 0.5, dur);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name: string, x?: number, z?: number, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const gpos = this.gainFor(x, z) * vol;
    if (gpos < 0.02) return;
    // rate limit identical sounds
    const now = this.ctx.currentTime;
    const last = this.recent.get(name) ?? 0;
    if (now - last < 0.06) return;
    this.recent.set(name, now);
    const t = now + 0.005;
    const out = this.ctx.createGain();
    out.gain.value = gpos;
    // stereo pan by x offset
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = x === undefined ? 0 : Math.max(-0.8, Math.min(0.8, (x - this.listener.x) / (10 + this.listener.zoom * 0.4)));
    out.connect(pan).connect(this.sfx);
    let life = 3;
    const smp = this.sample(name);
    if (smp) {
      const rate = 0.96 + Math.random() * 0.08;
      this.playBuffer(t, smp.buf, smp.gain, out, rate);
      life = Math.max(life, smp.buf.duration / rate + 0.2);
    } else switch (name) {
      case 'chop':
        this.noise(t, 0.09, 'bandpass', 900, 1.5, 0.5, out);
        this.tone(t, 180, 0.08, 'triangle', 0.35, out, 90);
        break;
      case 'treefall':
        this.tone(t, 90, 0.9, 'sawtooth', 0.06, out, 60, 0.3);
        this.noise(t + 1.1, 0.5, 'lowpass', 300, 1, 0.7, out);
        this.tone(t + 1.1, 70, 0.4, 'sine', 0.5, out, 40);
        break;
      case 'pick': case 'anvil': case 'clang': {
        const f = name === 'anvil' ? 1800 : name === 'clang' ? 1400 : 2200;
        this.tone(t, f, 0.25, 'sine', 0.18, out);
        this.tone(t, f * 2.7, 0.12, 'sine', 0.08, out);
        this.noise(t, 0.03, 'highpass', 3000, 1, 0.2, out);
        break;
      }
      case 'hammer':
        this.noise(t, 0.04, 'bandpass', 1400, 3, 0.35, out);
        this.tone(t, 420, 0.06, 'square', 0.06, out, 300);
        break;
      case 'dig':
        this.noise(t, 0.18, 'bandpass', 600, 0.8, 0.3, out, 300);
        break;
      case 'built': {
        const notes = [523.3, 659.3, 784, 1046.5];
        notes.forEach((f, k) => this.tone(t + k * 0.09, f, 0.6, 'triangle', 0.13, out));
        break;
      }
      case 'place':
        this.tone(t, 140, 0.15, 'sine', 0.35, out, 80);
        this.noise(t, 0.1, 'lowpass', 500, 1, 0.3, out);
        break;
      case 'fire':
        for (let k = 0; k < 8; k++) this.noise(t + Math.random() * 1.5, 0.05, 'highpass', 2000, 1, 0.25, out);
        this.noise(t, 1.8, 'lowpass', 400, 1, 0.3, out);
        break;
      case 'splash':
        this.noise(t, 0.3, 'bandpass', 1500, 1, 0.3, out, 500);
        break;
      case 'hiss':
        // hot iron in the water: a sharp sizzle that dies away
        this.noise(t, 0.9, 'highpass', 5000, 0.7, 0.22, out, 2500);
        this.noise(t, 0.35, 'bandpass', 3200, 1.5, 0.12, out);
        break;
      case 'bellows':
        // a breath of air through the nozzle
        this.noise(t, 0.3, 'bandpass', 380, 1.2, 0.3, out, 180);
        break;
      case 'grind':
        // steel on a turning whetstone
        this.noise(t, 0.4, 'bandpass', 4200, 4, 0.14, out, 3600);
        this.tone(t, 2600, 0.35, 'sawtooth', 0.012, out, 2300);
        break;
      case 'rumble':
        // an ore tub rolling on its rails
        this.noise(t, 0.9, 'lowpass', 260, 1, 0.3, out);
        this.tone(t, 70, 0.9, 'triangle', 0.08, out, 60, 0.2);
        break;
      case 'harvest':
        this.noise(t, 0.25, 'bandpass', 3000, 2, 0.15, out, 1500);
        break;
      case 'swing':
        this.noise(t, 0.18, 'bandpass', 700, 2, 0.22, out, 2500);
        break;
      case 'hit':
        this.tone(t, 160, 0.12, 'sine', 0.4, out, 70);
        this.noise(t, 0.07, 'lowpass', 1200, 1, 0.3, out);
        break;
      case 'death':
        this.tone(t, 220, 0.5, 'sawtooth', 0.06, out, 90, 0.02);
        this.noise(t + 0.2, 0.25, 'lowpass', 300, 1, 0.4, out);
        break;
      case 'bow':
        this.pluck(t, 196, 0.4, 0.5, out);
        this.noise(t, 0.12, 'bandpass', 2400, 3, 0.1, out, 800);
        break;
      case 'thump':
        // a catapult lets fly: the arm slams the stop bar, the stone whistles away
        this.noise(t, 0.05, 'bandpass', 500, 1.5, 0.4, out, 200);
        this.tone(t, 110, 0.18, 'triangle', 0.35, out, 55);
        this.noise(t + 0.08, 0.35, 'bandpass', 1800, 1.2, 0.09, out, 700);
        break;
      case 'grunt': {
        // a pig: one to three short snorts, a buzzing low voice through a narrow snout
        const ctx = this.ctx;
        const n = 1 + Math.floor(Math.random() * 3);
        const f0 = 90 + Math.random() * 50;
        for (let k = 0; k < n; k++) {
          const t0 = t + k * (0.15 + Math.random() * 0.07);
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(f0 * 1.3, t0);
          o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t0 + 0.13);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 480 + Math.random() * 220;
          bp.Q.value = 2.4;
          const gn = ctx.createGain();
          this.env(gn, t0, 0.012, 0.55, 0.12);
          o.connect(bp).connect(gn).connect(out);
          o.start(t0);
          o.stop(t0 + 0.2);
          this.noise(t0, 0.09, 'bandpass', 380, 1.5, 0.12, out);
        }
        break;
      }
      case 'crash':
        // a stone comes down on masonry
        this.noise(t, 0.4, 'lowpass', 340, 1, 0.65, out, 110);
        this.tone(t, 68, 0.32, 'sine', 0.55, out, 38);
        this.noise(t + 0.02, 0.1, 'bandpass', 2000, 2, 0.22, out, 900);
        this.noise(t + 0.15, 0.3, 'bandpass', 600, 1, 0.12, out, 250);
        break;
      case 'horn': {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t);
        o.frequency.linearRampToValueAtTime(233, t + 0.08);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(400, t);
        f.frequency.linearRampToValueAtTime(1400, t + 0.3);
        const g = this.ctx.createGain();
        this.env(g, t, 0.12, 0.18, 1.1);
        o.connect(f).connect(g).connect(out);
        o.start(t);
        o.stop(t + 1.4);
        break;
      }
      case 'fanfare': {
        const notes = [392, 392, 523.3, 659.3, 784];
        notes.forEach((f, k) => this.tone(t + k * 0.13, f, 0.35, 'sawtooth', 0.07, out));
        break;
      }
      case 'pop':
        this.tone(t, 900, 0.05, 'sine', 0.08, out, 1400);
        break;
      case 'click':
        this.tone(t, 1200, 0.03, 'triangle', 0.12, out);
        break;
      case 'ui':
        this.tone(t, 660, 0.06, 'triangle', 0.1, out, 880);
        break;
      case 'chant': {
        // a soft choir chord: detuned voices through a vowel-ish lowpass with vibrato
        const ctx = this.ctx;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1100;
        lp.Q.value = 0.7;
        lp.connect(out);
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.2;
        const vibG = ctx.createGain();
        vibG.gain.value = 3;
        vib.connect(vibG);
        vib.start(t);
        vib.stop(t + 3.6);
        for (const f of [220, 277.2, 329.6, 440, 554.4]) {
          for (const det of [-6, 5]) {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = f;
            o.detune.value = det;
            vibG.connect(o.frequency);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.018, t + 0.7);
            g.gain.setValueAtTime(0.018, t + 1.8);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
            o.connect(g).connect(lp);
            o.start(t);
            o.stop(t + 3.5);
          }
        }
        life = 4;
        break;
      }
      case 'collapse': {
        // the roof gives: a crack, a rush of splintering timber, the boom of the walls hitting the ground, and stone rattling down
        this.noise(t, 0.08, 'highpass', 1500, 0.8, 0.6, out);
        for (let k = 0; k < 5; k++) this.noise(t + 0.05 + k * 0.07 + Math.random() * 0.05, 0.12, 'bandpass', 500 + Math.random() * 900, 4, 0.35, out);
        this.noise(t + 0.18, 1.9, 'lowpass', 320, 0.9, 1.0, out, 60);
        this.tone(t + 0.18, 52, 1.3, 'sine', 0.6, out, 28, 0.03);
        this.noise(t + 0.5, 1.1, 'bandpass', 1100, 1.2, 0.3, out, 350);
        life = 3.5;
        break;
      }
      case 'thunder':
        this.noise(t, 0.09, 'highpass', 1800, 0.8, 0.7, out);
        this.noise(t + 0.02, 0.35, 'bandpass', 700, 0.6, 0.5, out, 200);
        this.noise(t + 0.05, 2.6, 'lowpass', 260, 0.9, 0.9, out, 50);
        this.tone(t + 0.03, 55, 1.1, 'sine', 0.55, out, 32, 0.02);
        life = 3.5;
        break;
      case 'warn':
        // two soft falling notes: something has stopped
        [659.3, 523.3].forEach((f, k) => {
          this.tone(t + k * 0.16, f, 0.7, 'triangle', 0.07, out);
          this.tone(t + k * 0.16, f * 2, 0.35, 'sine', 0.02, out);
        });
        life = 1.5;
        break;
      case 'chime':
        [880, 1318.5, 1760].forEach((f, k) => {
          this.tone(t + k * 0.09, f, 1.4, 'sine', 0.09, out);
          this.tone(t + k * 0.09, f * 2.76, 0.6, 'sine', 0.03, out);
        });
        life = 2.5;
        break;
      case 'bell': {
        // ship's bell: inharmonic partials with a long ring
        const f = 740;
        for (const [m, a, d] of [[1, 0.14, 2.2], [2.76, 0.06, 1.2], [5.4, 0.03, 0.6], [0.5, 0.05, 1.6]] as const) this.tone(t, f * m, d, 'sine', a, out);
        this.tone(t + 0.45, f, 1.8, 'sine', 0.09, out);
        this.tone(t + 0.45, f * 2.76, 0.9, 'sine', 0.04, out);
        life = 3;
        break;
      }
      case 'creak': {
        // timber and rope taking the strain
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(95, t);
        o.frequency.linearRampToValueAtTime(140, t + 0.35);
        o.frequency.linearRampToValueAtTime(110, t + 0.6);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 6;
        const g = this.ctx.createGain();
        this.env(g, t, 0.08, 0.12, 0.55);
        o.connect(f).connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.8);
        break;
      }
      case 'heal':
        this.tone(t, 523.3, 0.9, 'triangle', 0.1, out, 1046.5, 0.05);
        [659.3, 784, 1046.5, 1318.5].forEach((f, k) => this.tone(t + 0.15 + k * 0.08, f, 1.1, 'sine', 0.06, out));
        life = 2.5;
        break;
    }
    setTimeout(() => { try { out.disconnect(); pan.disconnect(); } catch { /* */ } }, life * 1000);
  }

  // ------------------------------------------------------------ ambience & music
  private gullT = 4;
  private surfT = 2;
  private scale = [146.8, 164.8, 174.6, 196, 220, 246.9, 261.6, 293.7, 329.6, 349.2, 392, 440];
  private chord = 0;
  private step = 0;

  update(dt: number, night: number, rain: number, nearWater: number) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.windGain.gain.value = 0.08 + rain * 0.1;
    this.rainGain.gain.value = rain * 0.18;
    const t = this.ctx.currentTime;
    // birds by day
    this.birdT -= dt;
    if (this.birdT <= 0 && night < 0.5 && rain < 0.5 && !this.paused) {
      const bird = this.sample('bird');
      this.birdT = bird ? 3 + Math.random() * 6 : 1.5 + Math.random() * 4;
      const out = this.ctx.createGain();
      out.gain.value = (bird ? bird.gain : 0.05) * (1 - night);
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      out.connect(pan).connect(this.amb);
      if (bird) this.playBuffer(t, bird.buf, 1, out);
      else {
        const base = 2000 + Math.random() * 2200;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) this.tone(t + k * 0.11, base * (1 + Math.random() * 0.2), 0.08, 'sine', 0.6, out, base * (0.7 + Math.random() * 0.6));
      }
    }
    // gulls and the wash of the surf along the coast
    this.gullT -= dt;
    if (this.gullT <= 0 && nearWater > 0.12 && night < 0.5) {
      this.gullT = 2.5 + Math.random() * 7 / Math.max(0.3, nearWater);
      const out = this.ctx.createGain();
      out.gain.value = 0.05 * Math.min(1, nearWater * 1.5) * (1 - night);
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      out.connect(pan).connect(this.amb);
      const calls = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < calls; k++) {
        const t0 = t + k * (0.28 + Math.random() * 0.1);
        const base = 1500 + Math.random() * 500;
        this.tone(t0, base, 0.22, 'triangle', 0.7, out, base * 0.62, 0.03);
        this.tone(t0, base * 2.01, 0.16, 'sine', 0.18, out, base * 1.3, 0.02);
      }
      setTimeout(() => { try { out.disconnect(); pan.disconnect(); } catch { /* */ } }, 3000);
    }
    this.surfT -= dt;
    if (this.surfT <= 0 && nearWater > 0.08) {
      this.surfT = 3.2 + Math.random() * 3;
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(300, t);
      f.frequency.linearRampToValueAtTime(900, t + 1.2);
      f.frequency.linearRampToValueAtTime(250, t + 3.0);
      const g = ctx.createGain();
      const peak = 0.05 * Math.min(1, nearWater * 1.4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      src.connect(f).connect(g).connect(this.amb);
      src.start(t, Math.random() * 1.5);
      src.stop(t + 3.3);
    }
    // generative music: lute arpeggios over a drone, dorian mode, when there is no soundtrack
    if (!this.musicOn || this.soundtrack) return;
    this.musicT -= dt;
    if (this.musicT <= 0) {
      const beat = 0.36;
      this.musicT = beat;
      const prog = [[0, 2, 4], [3, 5, 7], [1, 3, 5], [4, 6, 8]];
      if (this.step % 16 === 0) {
        this.chord = (this.chord + 1) % prog.length;
        // drone
        this.tone(t, this.scale[prog[this.chord][0]] / 2, beat * 16, 'triangle', 0.08, this.synthGain, undefined, 1.2);
      }
      const ch = prog[this.chord];
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      if (Math.random() < 0.85) {
        const deg = ch[pattern[this.step % 8]] + (this.step % 16 >= 8 && Math.random() < 0.3 ? 2 : 0);
        const f = this.scale[deg % this.scale.length] * (Math.random() < 0.15 ? 2 : 1);
        this.pluck(t, f, 1.6, 0.5, this.synthGain);
      }
      if (this.step % 4 === 2 && Math.random() < 0.3) {
        this.tone(t, this.scale[ch[2] % this.scale.length] * 2, beat * 2, 'sine', 0.05, this.synthGain, undefined, 0.1);
      }
      this.step++;
    }
  }
}
