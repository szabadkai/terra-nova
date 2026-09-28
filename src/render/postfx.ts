// Post-processing chain: MSAA scene -> (GTAO) -> bloom -> tilt-shift DOF -> tonemap -> grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 1.0 },
    uFocus: { value: 0.55 },
    uBand: { value: 0.18 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uAmount; uniform float uFocus; uniform float uBand;
    varying vec2 vUv;
    const int TAPS = 16;
    void main(){
      float d = abs(vUv.y - uFocus);
      float blur = smoothstep(uBand, uBand + 0.35, d) * uAmount;
      vec4 base = texture2D(tDiffuse, vUv);
      if (blur < 0.01) { gl_FragColor = base; return; }
      vec2 px = 1.0 / uRes;
      vec3 acc = base.rgb; float wsum = 1.0;
      float r = blur * 7.0;
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i);
        float a = fi * 2.39996;
        float rr = sqrt((fi + 0.5) / float(TAPS)) * r;
        vec2 o = vec2(cos(a), sin(a)) * rr * px;
        vec3 s = texture2D(tDiffuse, vUv + o).rgb;
        float w = 1.0 + dot(s, vec3(0.3)) * 0.4; // slight bokeh emphasis on bright spots
        acc += s * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSat: { value: 1.12 },
    uContrast: { value: 1.06 },
    uVignette: { value: 0.35 },
    uWarm: { value: new THREE.Color(1.03, 1.0, 0.95) },
    uCool: { value: new THREE.Color(0.95, 0.98, 1.05) },
    uGrain: { value: 0.025 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0.0015 },
    uFlash: { value: 0 },
    uRain: { value: 0 },
    uRainSlant: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uSat; uniform float uContrast; uniform float uVignette;
    uniform vec3 uWarm; uniform vec3 uCool; uniform float uGrain; uniform vec2 uRes; uniform float uCA; uniform float uFlash;
    uniform float uRain; uniform float uRainSlant;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // subtle chromatic aberration at the edges
      vec2 off = c * r2 * uCA * 5.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // split toning
      col *= mix(uCool, uWarm, smoothstep(0.1, 0.7, l));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      // vignette
      col *= 1.0 - uVignette * smoothstep(0.1, 0.55, r2 * 1.4);
      col += (hash(vUv * uRes + uTime) - 0.5) * uGrain;
      if (uRain > 0.001) {
        // rain right in front of the lens: two sheets of short thin streaks, slanted with the wind
        vec2 q = vec2(vUv.x * uRes.x / uRes.y - (1.0 - vUv.y) * uRainSlant, vUv.y);
        float sheet = 0.0;
        for (int k = 0; k < 2; k++) {
          float fk = float(k);
          float cx = q.x * mix(96.0, 60.0, fk) + fk * 31.7;
          float colId = floor(cx);
          float h = hash(vec2(colId, 3.1 + fk));
          float cyc = q.y * (1.6 + fk * 0.9) + uTime * (2.4 + fk * 1.1 + h * 0.6) + h * 9.0;
          float v = fract(cyc);
          float gate = step(0.62 - uRain * 0.42, hash(vec2(colId + fk * 7.0, floor(cyc))));
          float len = 0.05 + hash(vec2(colId, floor(cyc) + 0.5)) * 0.07;
          float seg = smoothstep(0.0, 0.015, v) * (1.0 - smoothstep(len * 0.5, len, v));
          float across = 1.0 - abs(fract(cx) - 0.5) * 2.0;
          sheet += smoothstep(0.82, 1.0, across) * seg * gate * (0.5 + 0.5 * h) * (1.0 - fk * 0.35);
        }
        // and a faint grey veil over everything
        col = mix(col, vec3(l) * vec3(0.9, 0.95, 1.05) + 0.03, uRain * 0.1);
        col += sheet * uRain * 0.16 * vec3(0.8, 0.86, 0.96);
      }
      col += uFlash;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export interface FxSettings {
  bloom: boolean;
  dof: boolean;
  ao: boolean;
  grade: boolean;
}

export class PostFX {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  tilt: ShaderPass;
  output: OutputPass;
  grade: ShaderPass;
  gtao: GTAOPass | null = null;
  settings: FxSettings = { bloom: true, dof: true, ao: false, grade: true };

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, w: number, h: number) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.tilt = new ShaderPass(TiltShiftShader);
    this.composer.addPass(this.tilt);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setSize(w, h);
  }

  enableAO(on: boolean) {
    this.settings.ao = on;
    if (on && !this.gtao) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.gtao.blendIntensity = 0.8;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
      this.composer.insertPass(this.gtao, 1);
    }
    if (this.gtao) this.gtao.enabled = on;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    (this.tilt.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
    (this.grade.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
    this.bloom.setSize(w * pr, h * pr);
    this.gtao?.setSize(w * pr, h * pr);
  }

  render(time: number, zoom01: number, night: number, rain = 0, rainSlant = 0) {
    this.bloom.enabled = this.settings.bloom;
    this.bloom.strength = 0.28 + night * 0.55;
    this.bloom.threshold = 0.9 - night * 0.35;
    this.tilt.enabled = this.settings.dof;
    // the miniature look belongs to the overview; close up the blur would only smear detail
    const tz = THREE.MathUtils.smoothstep(zoom01, 0.0, 0.55);
    this.tilt.uniforms.uAmount.value = THREE.MathUtils.lerp(0.18, 1.0, tz);
    this.tilt.uniforms.uBand.value = THREE.MathUtils.lerp(0.34, 0.15, tz);
    this.grade.enabled = true;
    const u = this.grade.uniforms;
    u.uTime.value = time;
    u.uRain.value = rain;
    u.uRainSlant.value = rainSlant;
    if (this.settings.grade) {
      u.uSat.value = 1.1 - night * 0.25;
      u.uContrast.value = 1.05;
      u.uVignette.value = 0.32 + night * 0.2;
      u.uGrain.value = 0.008 + night * 0.012;
      u.uCA.value = 0.0012;
      (u.uCool.value as THREE.Color).setRGB(0.95 - night * 0.1, 0.98 - night * 0.03, 1.05 + night * 0.12);
    } else {
      u.uSat.value = 1; u.uContrast.value = 1; u.uVignette.value = 0; u.uGrain.value = 0; u.uCA.value = 0;
      (u.uCool.value as THREE.Color).setRGB(1, 1, 1);
      (u.uWarm.value as THREE.Color).setRGB(1, 1, 1);
    }
    u.uFlash.value *= 0.9;
    this.composer.render();
  }

  flash(v: number) {
    this.grade.uniforms.uFlash.value = v;
  }
}
