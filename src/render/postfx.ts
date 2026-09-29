// Post-processing: the scene renders once into a multisampled HDR target, which is resolved once;
// optional GTAO, then bloom blurs the bright parts at reduced resolution, and a single final pass
// to the screen does the tilt-shift blur, adds the bloom, tone maps and grades. The wide part of
// the tilt-shift blur is worked out at half size beforehand, from a half-size copy of the scene
// that also stands in for the bloom's own bright pass.
// (Each pass of a composer chain rewrote a full-screen multisampled target; at 3440x1440 that
// alone cost more than the whole bloom.)
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { G } from './shaderPatch';

const FinalShader = {
  uniforms: {
    tScene: { value: null as THREE.Texture | null },
    tBloom: { value: null as THREE.Texture | null },
    tBlur: { value: null as THREE.Texture | null },
    uHalfOn: { value: 0 },
    uBloom: { value: 0 },
    uSharpen: { value: 0 },
    toneMappingExposure: { value: 1 },
    // tilt-shift
    uRes: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 1.0 },
    uFocus: { value: 0.55 },
    uBand: { value: 0.18 },
    // grade
    uTime: { value: 0 },
    uSat: { value: 1.12 },
    uContrast: { value: 1.06 },
    uVignette: { value: 0.35 },
    uWarm: { value: new THREE.Color(1.03, 1.0, 0.95) },
    uCool: { value: new THREE.Color(0.95, 0.98, 1.05) },
    uGrain: { value: 0.025 },
    uCA: { value: 0.0015 },
    uFlash: { value: 0 },
    uRain: { value: 0 },
    uRainSlant: { value: 0 },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBlur; uniform float uHalfOn; uniform float uBloom; uniform float uSharpen;
    uniform vec2 uRes; uniform float uAmount; uniform float uFocus; uniform float uBand;
    uniform float uTime; uniform float uSat; uniform float uContrast; uniform float uVignette;
    uniform vec3 uWarm; uniform vec3 uCool; uniform float uGrain; uniform float uCA; uniform float uFlash;
    uniform float uRain; uniform float uRainSlant; uniform float uNight;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // tilt-shift: the miniature look blurs the top and bottom of the view
      float blur = smoothstep(uBand, uBand + 0.35, abs(vUv.y - uFocus)) * uAmount;
      float r = blur * 7.0;
      vec3 col = vec3(0.0);
      if (r < 0.35) {
        // sharp: just a subtle chromatic aberration towards the edges
        vec2 off = c * r2 * uCA * 5.0;
        col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
        if (uSharpen > 0.0) {
          // unsharp mask on the upscaled image (clamped, so bright edges do not ring)
          vec2 px = 1.0 / uRes;
          vec3 nb = texture2D(tScene, vUv + vec2(px.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(px.x, 0.0)).rgb
                  + texture2D(tScene, vUv + vec2(0.0, px.y)).rgb + texture2D(tScene, vUv - vec2(0.0, px.y)).rgb;
          vec3 sh = col + (col - nb * 0.25) * uSharpen * 2.0;
          col = clamp(sh, min(col, nb * 0.25) * 0.8, max(col, nb * 0.25) * 1.25);
        }
      } else {
        // up to a couple of pixels a few taps at full size; wider, the blur worked out at half size
        float wh = smoothstep(HALF_FROM, HALF_FULL, r) * uHalfOn;
        if (wh < 1.0) {
          vec2 px = 1.0 / uRes;
          vec3 acc = texture2D(tScene, vUv).rgb; float wsum = 1.0;
          for (int i = 0; i < NEAR_TAPS; i++) {
            float fi = float(i);
            float a = fi * 2.39996;
            float rr = sqrt((fi + 0.5) / float(NEAR_TAPS)) * r;
            vec3 s = texture2D(tScene, vUv + vec2(cos(a), sin(a)) * rr * px).rgb;
            float w = 1.0 + dot(s, vec3(0.3)) * 0.4; // slight bokeh emphasis on bright spots
            acc += s * w; wsum += w;
          }
          col = acc / wsum;
        }
        if (wh > 0.0) col = mix(col, texture2D(tBlur, vUv).rgb, wh);
      }
      if (uBloom > 0.5) col += texture2D(tBloom, vUv).rgb;
      col = ACESFilmicToneMapping(col);
      col = sRGBTransferOETF(vec4(col, 1.0)).rgb;

      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      if (uNight > 0.001) {
        // moonlight: the land turns cool silver-blue and a little paler, while lamp- and firelit
        // surfaces keep their warmth; blacks lift into deep blue so nothing drowns in the dark
        float warm = smoothstep(0.0, 0.12, col.r - max(col.g * 0.85, col.b)) * smoothstep(0.1, 0.4, l);
        vec3 moon = mix(vec3(l), col, 0.6) * vec3(0.84, 0.96, 1.2);
        col = mix(col, mix(moon, col, warm), uNight);
        col += vec3(0.012, 0.02, 0.042) * uNight * (1.0 - smoothstep(0.0, 0.28, l));
        l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      }
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

const QUAD_VS = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Half-size copy of the scene: one filtered tap between four texels averages them. */
const HalfShader = {
  uniforms: { tScene: { value: null as THREE.Texture | null } },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene;
    varying vec2 vUv;
    void main() { gl_FragColor = vec4(texture2D(tScene, vUv).rgb, 1.0); }`,
};

/** The tilt-shift blur at half size: a golden-angle disc of taps, wider towards the top and bottom. */
const BlurShader = {
  uniforms: {
    tHalf: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 1.0 },
    uFocus: { value: 0.55 },
    uBand: { value: 0.18 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tHalf; uniform vec2 uRes; uniform float uAmount; uniform float uFocus; uniform float uBand;
    varying vec2 vUv;
    const int TAPS = 16;
    void main(){
      float blur = smoothstep(uBand, uBand + 0.35, abs(vUv.y - uFocus)) * uAmount;
      // the radius in full-size pixels, less the blur the half size brings of its own, then in half-size pixels
      float r7 = blur * 7.0;
      float r = sqrt(max(r7 * r7 - HALF_OWN, 0.0)) * 0.5;
      vec3 acc = texture2D(tHalf, vUv).rgb;
      if (r > 0.1) {
        vec2 px = 1.0 / uRes;
        float wsum = 1.0;
        for (int i = 0; i < TAPS; i++) {
          float fi = float(i);
          float a = fi * 2.39996;
          float rr = sqrt((fi + 0.5) / float(TAPS)) * r;
          vec3 s = texture2D(tHalf, vUv + vec2(cos(a), sin(a)) * rr * px).rgb;
          float w = 1.0 + dot(s, vec3(0.3)) * 0.4; // slight bokeh emphasis on bright spots
          acc += s * w; wsum += w;
        }
        acc /= wsum;
      }
      gl_FragColor = vec4(acc, 1.0);
    }`,
};

const rawPass = (name: string, sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }, defines = {}) =>
  new THREE.RawShaderMaterial({
    name,
    defines,
    uniforms: THREE.UniformsUtils.clone(sh.uniforms),
    vertexShader: sh.vertexShader,
    fragmentShader: sh.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });

/**
 * Blur radius (in pixels of the scene) where the half-size blur starts to take over from the few
 * full-size taps, and where it has. The half-size copy and its bilinear scaling up blur by about
 * as much as a disc of 1.9 pixels on their own (a variance of 0.92 px^2 per axis: 0.25 for the
 * two-texel average, 2^2/6 for the tent), so below that the full-size taps are the only way.
 */
const HALF_FROM = 1.9;
const HALF_FULL = 2.5;
const HALF_OWN = 0.92 * 4; // (a disc of radius R has a variance of R^2/4 per axis)

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

/**
 * The first mip's horizontal blur, which also keeps only the bright parts, reading a half-size copy
 * of the scene: the bright pass then needs no pass of its own. Its taps sit on whole texels, as the
 * threshold is taken of each texel before the blur (blurring the bright pass exactly as before).
 * `first` is UnrealBloomPass's own blur for that mip: its centre weight 0.39894 / sigma gives the
 * kernel (sigma = kernel / 3), and the weights are worked out as it does.
 */
const brightBlurMaterial = (first: THREE.ShaderMaterial) => {
  const sigma = 0.39894 / (first.uniforms['centerWeight'].value as number);
  const kernel = Math.round(sigma * 3);
  const weights = Array.from({ length: kernel }, (_, i) => (0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
  return new THREE.ShaderMaterial({
    name: 'BloomBrightBlur',
    defines: { KERNEL: kernel },
    uniforms: {
      colorTexture: { value: null },
      invSize: { value: new THREE.Vector2(1, 1) },
      direction: { value: new THREE.Vector2(1, 0) },
      threshold: { value: 1 },
      smoothWidth: { value: 0.01 },
      weights: { value: weights },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      #include <common>
      varying vec2 vUv;
      uniform sampler2D colorTexture; uniform vec2 invSize; uniform vec2 direction;
      uniform float threshold; uniform float smoothWidth; uniform float weights[KERNEL];
      vec3 bright(vec2 uv) {
        vec3 c = texture2D(colorTexture, uv).rgb;
        return c * smoothstep(threshold, threshold + smoothWidth, luminance(c));
      }
      void main() {
        vec3 sum = bright(vUv) * weights[0];
        for (int i = 1; i < KERNEL; i++) {
          vec2 o = direction * invSize * float(i);
          sum += (bright(vUv + o) + bright(vUv - o)) * weights[i];
        }
        gl_FragColor = vec4(sum, 1.0);
      }`,
  });
};

/** Unreal-style bloom that leaves its result in `output` instead of blending it back over the scene. */
class Bloom extends UnrealBloomPass {
  private brightBlur = brightBlurMaterial(this.separableBlurMaterials[0] as THREE.ShaderMaterial);

  get output(): THREE.Texture {
    return this.renderTargetsHorizontal[0].texture;
  }

  /** `half`: a half-size copy of the scene, the size of the first mip (the bright pass is then folded into its blur) */
  renderFrom(renderer: THREE.WebGLRenderer, src: THREE.Texture, half: THREE.Texture | null = null) {
    const quad = (this as any)._fsQuad as FullScreenQuad;
    const oldClear = renderer.getClearColor(new THREE.Color());
    const oldAlpha = renderer.getClearAlpha();
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    // bright parts
    const hp = this.highPassUniforms as Record<string, THREE.IUniform>;
    if (!half) {
      hp['tDiffuse'].value = src;
      hp['luminosityThreshold'].value = this.threshold;
      quad.material = this.materialHighPassFilter;
      renderer.setRenderTarget(this.renderTargetBright);
      renderer.clear();
      quad.render(renderer);
    }
    // blur down the mips
    let input = this.renderTargetBright.texture;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i] as THREE.ShaderMaterial;
      if (i === 0 && half) {
        const b = this.brightBlur.uniforms;
        b.colorTexture.value = half;
        b.invSize.value = m.uniforms['invSize'].value;
        b.threshold.value = this.threshold;
        b.smoothWidth.value = hp['smoothWidth'].value;
        quad.material = this.brightBlur;
      } else {
        quad.material = m;
        m.uniforms['colorTexture'].value = input;
      }
      m.uniforms['direction'].value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      quad.render(renderer);
      quad.material = m;
      m.uniforms['colorTexture'].value = this.renderTargetsHorizontal[i].texture;
      m.uniforms['direction'].value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      quad.render(renderer);
      input = this.renderTargetsVertical[i].texture;
    }
    // and add them up
    const cm = this.compositeMaterial as THREE.ShaderMaterial;
    quad.material = cm;
    cm.uniforms['bloomStrength'].value = this.strength;
    cm.uniforms['bloomRadius'].value = this.radius;
    cm.uniforms['bloomTintColors'].value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    quad.render(renderer);
    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = oldAuto;
  }

  dispose() {
    super.dispose();
    this.brightBlur.dispose();
  }
}

/**
 * What GTAOPass multiplies the scene by, with the darkening faded out over ground that is still
 * unexplored. The world's own shaders paint everything there the colour of the fog, trees and rocks
 * included, but their geometry is still in the normal pass, and the occlusion it makes would show
 * through as dark rings on the black. The explored share is read from the same texture as theirs,
 * at the world position of each pixel (rebuilt from the depth).
 */
const AO_BLEND_FRAGMENT = /* glsl */ `
  uniform float intensity;
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tFog;
  uniform mat4 cameraProjectionMatrixInverse;
  uniform mat4 cameraWorldMatrix;
  uniform vec2 uMapSize;
  uniform float uFogOn;
  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    float k = intensity;
    if (uFogOn > 0.5) {
      float d = texture2D(tDepth, vUv).x;
      vec4 v = cameraProjectionMatrixInverse * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec3 wp = (cameraWorldMatrix * (v / v.w)).xyz;
      k *= smoothstep(0.2, 0.85, texture2D(tFog, (wp.xz + 0.5) / uMapSize).r);
    }
    gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, k), texel.a);
  }
`;

export interface FxSettings {
  bloom: boolean;
  dof: boolean;
  ao: boolean;
  grade: boolean;
}

export class PostFX {
  /** the scene, multisampled; resolved into its texture once it is drawn */
  readonly sceneRT: THREE.WebGLRenderTarget;
  private aoRT: THREE.WebGLRenderTarget | null = null;
  /** half-size copy of the scene (for the bloom and the blur) and the tilt-shift blur worked out from it */
  private halfRT: THREE.WebGLRenderTarget;
  private blurRT: THREE.WebGLRenderTarget;
  private halfMat: THREE.RawShaderMaterial;
  private blurMat: THREE.RawShaderMaterial;
  bloom: Bloom;
  gtao: GTAOPass | null = null;
  private quad: FullScreenQuad;
  private final: THREE.RawShaderMaterial;
  settings: FxSettings = { bloom: true, dof: true, ao: false, grade: true };
  /** resolution scale of the world (1 = the canvas's own); takes effect on setSize */
  scale = 1;
  private w = 1;
  private h = 1;
  /** the first frame (behind the loading screen) runs the bloom and half-size passes both ways, compiling them */
  private warm = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, w: number, h: number, samples = 4) {
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.sceneRT.texture.generateMipmaps = false;
    const halfTarget = () => {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.halfRT = halfTarget();
    this.blurRT = halfTarget();
    this.halfMat = rawPass('HalfCopy', HalfShader);
    this.blurMat = rawPass('TiltShiftBlur', BlurShader, { HALF_OWN: HALF_OWN.toFixed(3) });
    this.bloom = new Bloom(new THREE.Vector2(w, h), 0.35, 0.55, 0.92);
    this.final = new THREE.RawShaderMaterial({
      name: 'FinalShader',
      uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms),
      vertexShader: FinalShader.vertexShader,
      fragmentShader: FinalShader.fragmentShader,
      defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '', HALF_FROM: HALF_FROM.toFixed(2), HALF_FULL: HALF_FULL.toFixed(2), NEAR_TAPS: '8' },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.final);
    this.setSize(w, h);
  }

  get samples() {
    return this.sceneRT.samples;
  }

  /** Multisampling of the scene (0 = off); the target is rebuilt on the next frame. */
  setSamples(n: number) {
    if (this.sceneRT.samples === n) return;
    this.sceneRT.samples = n;
    this.sceneRT.dispose();
  }

  enableAO(on: boolean) {
    this.settings.ao = on;
    if (on && !this.gtao) {
      const pr = this.renderer.getPixelRatio() * this.scale;
      this.gtao = new GTAOPass(this.scene, this.camera, this.w * pr, this.h * pr);
      this.gtao.blendIntensity = 0.8;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
      const blend = this.gtao.blendMaterial;
      blend.fragmentShader = AO_BLEND_FRAGMENT;
      Object.assign(blend.uniforms, {
        tDepth: { value: this.gtao.depthTexture },
        tFog: G.tFog, uMapSize: G.uMapSize, uFogOn: G.uFogOn,
        cameraProjectionMatrixInverse: { value: new THREE.Matrix4() },
        cameraWorldMatrix: { value: new THREE.Matrix4() },
      });
      blend.needsUpdate = true;
      this.aoRT = new THREE.WebGLRenderTarget(this.w * pr, this.h * pr, { type: THREE.HalfFloatType });
    }
  }

  setSize(w: number, h: number) {
    this.w = w;
    this.h = h;
    const pr = this.renderer.getPixelRatio() * this.scale;
    const W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
    this.sceneRT.setSize(W, H);
    this.aoRT?.setSize(W, H);
    (this.final.uniforms.uRes.value as THREE.Vector2).set(W, H);
    // the same size as the bloom's bright pass, so it can read this copy instead of the scene
    const hw = Math.max(1, Math.round(W / 2)), hh = Math.max(1, Math.round(H / 2));
    this.halfRT.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    (this.blurMat.uniforms.uRes.value as THREE.Vector2).set(hw, hh);
    // a little sharpening wins back some of the crispness lost by scaling up
    this.final.uniforms.uSharpen.value = this.scale < 0.99 ? 0.35 * Math.min(1, (1 - this.scale) / 0.3) : 0;
    this.bloom.setSize(W, H);
    this.gtao?.setSize(W, H);
  }

  render(time: number, zoom01: number, night: number, rain = 0, rainSlant = 0) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, this.camera);
    let src = this.sceneRT;
    if (this.settings.ao && this.gtao && this.aoRT) {
      const bu = this.gtao.blendMaterial.uniforms;
      bu.cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);
      bu.cameraWorldMatrix.value.copy(this.camera.matrixWorld);
      this.hideNonSolid();
      this.gtao.render(r, this.aoRT, this.sceneRT, 0, false);
      for (const o of this.hidden) o.visible = true;
      this.hidden.length = 0;
      src = this.aoRT;
    }
    const u = this.final.uniforms;
    // the miniature look belongs to the overview; close up the blur would only smear detail
    const tz = THREE.MathUtils.smoothstep(zoom01, 0.0, 0.55);
    const amount = this.settings.dof ? THREE.MathUtils.lerp(0.18, 1.0, tz) : 0;
    const band = THREE.MathUtils.lerp(0.34, 0.15, tz);
    const focus = u.uFocus.value as number;
    // (the most blur anywhere on the screen, at the edge farthest from the band in focus)
    const rMax = amount * THREE.MathUtils.smoothstep(Math.max(focus, 1 - focus), band, band + 0.35) * 7;
    // (no pixel blurs past HALF_FROM while warming up, so the half-size blur is still not seen then)
    const blurred = rMax > HALF_FROM || this.warm;
    let half: THREE.Texture | null = null;
    if (blurred) {
      this.halfMat.uniforms.tScene.value = src.texture;
      this.pass(this.halfMat, this.halfRT);
      half = this.halfRT.texture;
    }
    // lamps and windows bloom at night, the moonlit land does not
    if (this.settings.bloom) {
      this.bloom.strength = 0.28 + night * 0.32;
      this.bloom.threshold = 0.9 - night * 0.16;
      // (and its own bright pass, which it takes while there is no half-size copy)
      if (this.warm) this.bloom.renderFrom(r, src.texture);
      this.bloom.renderFrom(r, src.texture, half);
      u.tBloom.value = this.bloom.output;
    }
    if (blurred) {
      const b = this.blurMat.uniforms;
      b.tHalf.value = half;
      b.uAmount.value = amount;
      b.uFocus.value = focus;
      b.uBand.value = band;
      this.pass(this.blurMat, this.blurRT);
      u.tBlur.value = this.blurRT.texture;
    }
    u.uBloom.value = this.settings.bloom ? 1 : 0;
    u.tScene.value = src.texture;
    u.toneMappingExposure.value = r.toneMappingExposure;
    u.uAmount.value = amount;
    u.uHalfOn.value = blurred ? 1 : 0;
    this.warm = false;
    u.uBand.value = band;
    u.uTime.value = time;
    u.uRain.value = rain;
    u.uRainSlant.value = rainSlant;
    u.uNight.value = night;
    if (this.settings.grade) {
      u.uSat.value = 1.1 - night * 0.08;
      u.uContrast.value = 1.05;
      u.uVignette.value = 0.32 + night * 0.2;
      u.uGrain.value = 0.008 + night * 0.012;
      u.uCA.value = 0.0012;
      (u.uCool.value as THREE.Color).setRGB(0.95 - night * 0.1, 0.98 - night * 0.03, 1.05 + night * 0.12);
      (u.uWarm.value as THREE.Color).setRGB(1.03, 1.0, 0.95);
    } else {
      u.uSat.value = 1; u.uContrast.value = 1; u.uVignette.value = 0; u.uGrain.value = 0; u.uCA.value = 0;
      (u.uCool.value as THREE.Color).setRGB(1, 1, 1);
      (u.uWarm.value as THREE.Color).setRGB(1, 1, 1);
    }
    u.uFlash.value *= 0.9;
    r.setRenderTarget(null);
    this.quad.material = this.final;
    this.quad.render(r);
  }

  private pass(m: THREE.Material, rt: THREE.WebGLRenderTarget) {
    this.quad.material = m;
    this.renderer.setRenderTarget(rt);
    this.quad.render(this.renderer);
  }

  private hidden: THREE.Object3D[] = [];

  /**
   * Keep what does not write depth in the scene out of GTAO's normal and depth pass, which draws
   * every mesh solid: rain, the sky domes, spell glows, order rings and health bars would each
   * leave a dark halo on the ground around them. The water opts back in (`userData.solidAO`): its
   * surface is what the eye sees, so it is the surface that gets the occlusion at a cliff's foot.
   */
  private hideNonSolid() {
    const hide = (o: THREE.Object3D) => {
      if (!o.visible) return;
      const m = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).material : null;
      if (m && !Array.isArray(m) && !m.depthWrite && !m.userData.solidAO) {
        o.visible = false;
        this.hidden.push(o);
        return;
      }
      for (const c of o.children) hide(c);
    };
    hide(this.scene);
  }

  flash(v: number) {
    this.final.uniforms.uFlash.value = v;
  }

  dispose() {
    this.sceneRT.dispose();
    this.aoRT?.dispose();
    this.halfRT.dispose();
    this.blurRT.dispose();
    this.halfMat.dispose();
    this.blurMat.dispose();
    this.bloom.dispose();
    this.gtao?.dispose();
    this.final.dispose();
    this.quad.dispose();
  }
}
