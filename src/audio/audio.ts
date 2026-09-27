// Audio: ambience, positional sound effects and generative music. Effects that have an
// original Settlers III sample use it; everything else is synthesised.

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
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private listener = { x: 0, z: 0, zoom: 30 };
  volume = 0.7;
  musicOn = true;
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
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.22;
    // simple reverb for music
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.musicGain.connect(this.master);
    this.musicGain.connect(conv).connect(wet).connect(this.master);
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

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.22 : 0;
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
    // Karplus-Strong-ish pluck via short noise burst into a resonant comb
    const ctx = this.ctx!;
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 1 / freq;
    const fb = ctx.createGain();
    fb.gain.value = 0.96;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    delay.connect(lp).connect(fb).connect(delay);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(peak, t);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    const outG = ctx.createGain();
    outG.gain.setValueAtTime(1, t);
    outG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(eg).connect(delay);
    delay.connect(outG).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.03);
    setTimeout(() => { try { delay.disconnect(); fb.disconnect(); lp.disconnect(); outG.disconnect(); } catch { /* */ } }, (dur + 0.5) * 1000);
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
    }
    setTimeout(() => { try { out.disconnect(); pan.disconnect(); } catch { /* */ } }, life * 1000);
  }

  // ------------------------------------------------------------ ambience & music
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
    if (this.birdT <= 0 && night < 0.5 && rain < 0.5) {
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
    void nearWater;
    // generative music: lute arpeggios over a drone, dorian mode
    if (!this.musicOn) return;
    this.musicT -= dt;
    if (this.musicT <= 0) {
      const beat = 0.36;
      this.musicT = beat;
      const prog = [[0, 2, 4], [3, 5, 7], [1, 3, 5], [4, 6, 8]];
      if (this.step % 16 === 0) {
        this.chord = (this.chord + 1) % prog.length;
        // drone
        this.tone(t, this.scale[prog[this.chord][0]] / 2, beat * 16, 'triangle', 0.08, this.musicGain, undefined, 1.2);
      }
      const ch = prog[this.chord];
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      if (Math.random() < 0.85) {
        const deg = ch[pattern[this.step % 8]] + (this.step % 16 >= 8 && Math.random() < 0.3 ? 2 : 0);
        const f = this.scale[deg % this.scale.length] * (Math.random() < 0.15 ? 2 : 1);
        this.pluck(t, f, 1.6, 0.5, this.musicGain);
      }
      if (this.step % 4 === 2 && Math.random() < 0.3) {
        this.tone(t, this.scale[ch[2] % this.scale.length] * 2, beat * 2, 'sine', 0.05, this.musicGain, undefined, 0.1);
      }
      this.step++;
    }
  }
}
