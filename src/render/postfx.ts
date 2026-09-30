// Post-processing: the scene renders once into a multisampled HDR target, which is resolved once;
// optional ambient occlusion at half size from the depth the scene leaves, then bloom blurs the
// bright parts at reduced resolution, and a single final pass to the screen scales the occlusion
// up, does the tilt-shift blur, adds the bloom, tone maps and grades. The wide part of the
// tilt-shift blur is worked out at half size beforehand, from a half-size copy of the scene (with
// its occlusion) that also stands in for the bloom's own bright pass.
// (Each pass of a composer chain rewrote a full-screen multisampled target; at 3440x1440 that
// alone cost more than the whole bloom.)
import * as THREE from 'three';
import { perf } from './perf';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOShader, generateMagicSquareNoise } from 'three/examples/jsm/shaders/GTAOShader.js';
import { generatePdSamplePointInitializer } from 'three/examples/jsm/shaders/PoissonDenoiseShader.js';
import { G } from './shaderPatch';
import { WATER_LEVEL } from '../game/world';
import { WATER_MARGIN } from './water';

/** GLSL: where a view ray (`ray`, world offset per unit of view depth from `cam`) meets the water, in view depth (or `far`) */
const WATER_HIT = /* glsl */ `
  uniform float uWater;
  uniform vec4 uWaterBox;
  float waterDepth(vec3 cam, vec3 ray, float far) {
    if (ray.y >= 0.0 || cam.y <= uWater) return far;
    float t = (uWater - cam.y) / ray.y;
    vec2 h = cam.xz + ray.xz * t;
    return all(greaterThan(h, uWaterBox.xy)) && all(lessThan(h, uWaterBox.zw)) ? t : far;
  }
`;

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
    // ambient occlusion (HalfAO), scaled up to the pixel
    tDepth: { value: null as THREE.Texture | null },
    tAO: { value: null as THREE.Texture | null },
    uAO: { value: 0 },
    uAORes: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.5 },
    cameraFar: { value: 600 },
    uCamPos: { value: new THREE.Vector3() },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uWater: { value: WATER_LEVEL },
    uWaterBox: { value: new THREE.Vector4() },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform mat4 uProjInv;
    uniform mat4 uCamWorld;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    varying vec3 vRay;
    void main() {
      vUv = uv;
      // the view ray through the pixel, as a world offset per unit of view depth
      vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
      vec3 d = v.xyz / v.w;
      vRay = mat3(uCamWorld) * (d / -d.z);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBlur; uniform float uHalfOn; uniform float uBloom; uniform float uSharpen;
    uniform vec2 uRes; uniform float uAmount; uniform float uFocus; uniform float uBand;
    uniform float uTime; uniform float uSat; uniform float uContrast; uniform float uVignette;
    uniform vec3 uWarm; uniform vec3 uCool; uniform float uGrain; uniform float uCA; uniform float uFlash;
    uniform float uRain; uniform float uRainSlant; uniform float uNight;
    uniform highp sampler2D tDepth; uniform highp sampler2D tAO; uniform float uAO; uniform vec2 uAORes;
    uniform float cameraNear; uniform float cameraFar; uniform vec3 uCamPos;
    ${WATER_HIT}
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    varying vec3 vRay;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    // the half-size occlusion at this pixel: of the four nearest texels, those whose depth is close
    // to the pixel's own count the most, so it doesn't bleed across the edges of things
    float occlusion() {
      float lz = cameraNear * cameraFar / (cameraFar - (cameraFar - cameraNear) * texture2D(tDepth, vUv).x);
      lz = min(lz, waterDepth(uCamPos, vRay, cameraFar));
      vec2 hp = vUv * uAORes - 0.5;
      vec2 f = fract(hp);
      vec2 px = 1.0 / uAORes;
      vec2 b = (floor(hp) + 0.5) * px;
      vec4 a0 = texture2D(tAO, b), a1 = texture2D(tAO, b + vec2(px.x, 0.0));
      vec4 a2 = texture2D(tAO, b + vec2(0.0, px.y)), a3 = texture2D(tAO, b + px);
      vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
      w /= 0.002 * lz + abs(vec4(a0.g, a1.g, a2.g, a3.g) - lz);
      return dot(w, vec4(a0.r, a1.r, a2.r, a3.r)) / dot(w, vec4(1.0));
    }
    void main(){
      // (the scene's alpha says how much of it shows: see PatchOpts.ao)
      float ao = uAO > 0.0 ? mix(1.0, occlusion(), uAO * texture2D(tScene, vUv).a) : 1.0;
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // tilt-shift: the miniature look blurs the top and bottom of the view
      float blur = smoothstep(uBand, uBand + 0.35, abs(vUv.y - uFocus)) * uAmount;
      float r = blur * 7.0;
      vec3 col = vec3(0.0);
      if (r < 0.35) {
        // sharp: just a subtle chromatic aberration towards the edges
        vec2 off = c * r2 * uCA * 5.0;
        col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b) * ao;
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
          col = acc / wsum * ao;
        }
        // (the half-size copy has its occlusion already)
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

/** Half-size copy of the scene: one filtered tap between four texels averages them. The occlusion is the same size. */
const HalfShader = {
  uniforms: { tScene: { value: null as THREE.Texture | null }, tAO: { value: null as THREE.Texture | null }, uAO: { value: 0 } },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene; uniform sampler2D tAO; uniform float uAO;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tScene, vUv);
      if (uAO > 0.0) c.rgb *= mix(1.0, texture2D(tAO, vUv).r, uAO * c.a);
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
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
 * The depth the occlusion works from, at half size: the nearest of each 2x2 block of the scene's
 * depth, so thin things in front (poles, people) keep samples of their own. (Nearest and farthest
 * in a checkerboard would keep both sides of an edge, but zig-zag on every slope, and the normals
 * rebuilt from the depth would pick that up.)
 * The water writes no depth, but its surface is what the eye sees (and what should be darkened at
 * a cliff's foot), so where the ray meets it first the depth is moved up to it.
 */
const AODepthShader = {
  uniforms: {
    tDepth: { value: null as THREE.Texture | null },
    cameraNear: { value: 0.5 },
    cameraFar: { value: 600 },
    uCamPos: { value: new THREE.Vector3() },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uWater: { value: WATER_LEVEL },
    uWaterBox: { value: new THREE.Vector4() },
  },
  vertexShader: /* glsl */ `
    uniform mat4 uProjInv;
    uniform mat4 uCamWorld;
    varying vec2 vUv;
    varying vec3 vRay;
    void main() {
      vUv = uv;
      vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
      vec3 d = v.xyz / v.w;
      vRay = mat3(uCamWorld) * (d / -d.z);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform highp sampler2D tDepth;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform vec3 uCamPos;
    ${WATER_HIT}
    varying vec2 vUv;
    varying vec3 vRay;
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      ivec2 q = min(p * 2, textureSize(tDepth, 0) - 2);
      float a = texelFetch(tDepth, q, 0).x, b = texelFetch(tDepth, q + ivec2(1, 0), 0).x;
      float c = texelFetch(tDepth, q + ivec2(0, 1), 0).x, d = texelFetch(tDepth, q + ivec2(1, 1), 0).x;
      float z = min(min(a, b), min(c, d));
      float w = waterDepth(uCamPos, vRay, cameraFar);
      if (w < cameraFar) z = min(z, viewZToPerspectiveDepth(-w, cameraNear, cameraFar));
      gl_FragColor = vec4(z, 0.0, 0.0, 1.0);
    }`,
};

/**
 * Smooths the half-size occlusion with 16 taps on a Poisson disc, each weighted by how well its
 * surface lines up with the pixel's own (normal and distance from its plane), as three's
 * PoissonDenoiseShader does; the normals come packed with the occlusion. Writes the occlusion and
 * the view depth, which the full-size upsampling compares its own depth with.
 */
const AODenoiseShader = {
  uniforms: {
    tAO: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tNoise: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2() },
    cameraNear: { value: 0.5 },
    cameraFar: { value: 600 },
    cameraProjectionMatrixInverse: { value: new THREE.Matrix4() },
    normalPhi: { value: 3 },
    depthPhi: { value: 2 },
    radius: { value: 4 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <packing>
    uniform sampler2D tAO;
    uniform highp sampler2D tDepth;
    uniform sampler2D tNoise;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform mat4 cameraProjectionMatrixInverse;
    uniform float normalPhi;
    uniform float depthPhi;
    uniform float radius;
    varying vec2 vUv;
    const vec3 disk[SAMPLES] = SAMPLE_VECTORS;
    vec3 viewPos(vec2 uv, float depth) {
      vec4 v = cameraProjectionMatrixInverse * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
      return v.xyz / v.w;
    }
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      float depth = texelFetch(tDepth, p, 0).x;
      float lz = -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
      vec4 c = texelFetch(tAO, p, 0);
      if (depth >= 1.0) { gl_FragColor = vec4(1.0, lz, 0.0, 1.0); return; }
      vec3 n = normalize(c.gba * 2.0 - 1.0);
      vec3 vp = viewPos(vUv, depth);
      vec4 nz = textureLod(tNoise, vUv * resolution / vec2(textureSize(tNoise, 0)), 0.0);
      vec2 rv = vec2(sin(nz.x * 2.0 * PI), cos(nz.x * 2.0 * PI));
      mat2 rot = mat2(rv.x, -rv.y, rv.x, rv.y);
      float sum = c.r, wsum = 1.0;
      for (int i = 0; i < SAMPLES; i++) {
        vec2 uv = vUv + rot * (disk[i].xy * (1.0 + disk[i].z * (radius - 1.0)) / resolution);
        float sd = textureLod(tDepth, uv, 0.0).x;
        vec4 s = textureLod(tAO, uv, 0.0);
        float w = pow(max(dot(n, normalize(s.gba * 2.0 - 1.0)), 0.0), normalPhi)
                * max(1.0 - abs(dot(vp - viewPos(uv, sd), n)) / depthPhi, 0.0)
                * step(sd, 0.99999);
        sum += s.r * w; wsum += w;
      }
      gl_FragColor = vec4(sum / wsum, lz, 0.0, 1.0);
    }`,
};

/**
 * Ground-truth ambient occlusion (three's GTAOShader) worked out at half size from the depth the
 * scene itself leaves, so the scene is drawn once: the half-size depth (with the water in it), then
 * the occlusion (its normals rebuilt from that depth, packed next to it for the denoise, and faded
 * out over ground still unexplored: the world's own shaders paint everything there the colour of
 * the fog, trees and rocks included, whose depth would otherwise show as dark rings on the black),
 * then the denoise. The final pass scales it up, weighting the four nearest texels by how close
 * their depth is to the pixel's own so the darkening doesn't bleed across edges.
 */
class HalfAO {
  private depthRT: THREE.WebGLRenderTarget;
  private aoRT: THREE.WebGLRenderTarget;
  readonly outRT: THREE.WebGLRenderTarget;
  private depthMat: THREE.ShaderMaterial;
  private gtaoMat: THREE.ShaderMaterial;
  private denoiseMat: THREE.ShaderMaterial;
  private noise = generateMagicSquareNoise();
  private pdNoise: THREE.DataTexture;
  private quad = new FullScreenQuad();

  constructor() {
    const target = (type: THREE.TextureDataType, format: THREE.PixelFormat) => {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type, format, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.depthRT = target(THREE.FloatType, THREE.RedFormat);
    this.aoRT = target(THREE.HalfFloatType, THREE.RGBAFormat);
    this.outRT = target(THREE.HalfFloatType, THREE.RGBAFormat);
    const quadMat = (sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }, defines = {}) =>
      new THREE.ShaderMaterial({ defines, uniforms: THREE.UniformsUtils.clone(sh.uniforms), vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.depthMat = quadMat(AODepthShader);
    this.depthMat.name = 'AODepth';
    const gtao = {
      ...GTAOShader,
      uniforms: { ...GTAOShader.uniforms, tFog: { value: null }, uMapSize: { value: null }, uFogOn: { value: 0 } },
      // the sky is written unoccluded (so the target needs no clear), and the occlusion leaves with
      // the fog fade applied and the normal packed next to it
      fragmentShader: GTAOShader.fragmentShader
        .replace(/discard;/g, 'gl_FragColor = vec4(1.0); return;')
        .replace('void main() {', /* glsl */ `
          uniform sampler2D tFog;
          uniform vec2 uMapSize;
          uniform float uFogOn;
          float explored(vec3 viewPos) {
            if (uFogOn < 0.5) return 1.0;
            vec3 wp = (cameraWorldMatrix * vec4(viewPos, 1.0)).xyz;
            return smoothstep(0.2, 0.85, texture2D(tFog, (wp.xz + 0.5) / uMapSize).r);
          }
          void main() {`),
    };
    this.gtaoMat = quadMat(gtao, {
      ...GTAOShader.defines,
      SAMPLES: 12,
      NORMAL_VECTOR_TYPE: 0,
      DEPTH_SWIZZLING: 'x',
      FRAGMENT_OUTPUT: 'vec4(mix(1.0, ao, explored(viewPos)), viewNormal * 0.5 + 0.5)',
    });
    this.gtaoMat.name = 'GTAOHalf';
    const gu = this.gtaoMat.uniforms;
    gu.tDepth.value = this.depthRT.texture;
    gu.tNoise.value = this.noise;
    gu.radius.value = 0.6;
    gu.distanceExponent.value = 1.5;
    gu.thickness.value = 1.2;
    gu.scale.value = 1.0;
    gu.tFog = G.tFog;
    gu.uMapSize = G.uMapSize;
    gu.uFogOn = G.uFogOn;
    this.pdNoise = randomNoise(64);
    this.denoiseMat = quadMat(AODenoiseShader, { SAMPLES: 16, SAMPLE_VECTORS: generatePdSamplePointInitializer(16, 2, 1) });
    this.denoiseMat.name = 'AODenoise';
    const du = this.denoiseMat.uniforms;
    du.tAO.value = this.aoRT.texture;
    du.tDepth.value = this.depthRT.texture;
    du.tNoise.value = this.pdNoise;
  }

  setSize(w: number, h: number) {
    this.depthRT.setSize(w, h);
    this.aoRT.setSize(w, h);
    this.outRT.setSize(w, h);
    (this.gtaoMat.uniforms.resolution.value as THREE.Vector2).set(w, h);
    (this.denoiseMat.uniforms.resolution.value as THREE.Vector2).set(w, h);
  }

  render(r: THREE.WebGLRenderer, depth: THREE.Texture, cam: THREE.PerspectiveCamera) {
    const d = this.depthMat.uniforms;
    d.tDepth.value = depth;
    d.cameraNear.value = cam.near;
    d.cameraFar.value = cam.far;
    (d.uCamPos.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    d.uProjInv.value.copy(cam.projectionMatrixInverse);
    d.uCamWorld.value.copy(cam.matrixWorld);
    waterBox(d.uWaterBox.value);
    this.pass(r, this.depthMat, this.depthRT);
    const g = this.gtaoMat.uniforms;
    g.cameraNear.value = cam.near;
    g.cameraFar.value = cam.far;
    g.cameraProjectionMatrix.value.copy(cam.projectionMatrix);
    g.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
    g.cameraWorldMatrix.value.copy(cam.matrixWorld);
    this.pass(r, this.gtaoMat, this.aoRT);
    const n = this.denoiseMat.uniforms;
    n.cameraNear.value = cam.near;
    n.cameraFar.value = cam.far;
    n.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
    this.pass(r, this.denoiseMat, this.outRT);
  }

  private pass(r: THREE.WebGLRenderer, m: THREE.Material, rt: THREE.WebGLRenderTarget) {
    this.quad.material = m;
    r.setRenderTarget(rt);
    this.quad.render(r);
  }

  dispose() {
    this.depthRT.dispose();
    this.aoRT.dispose();
    this.outRT.dispose();
    this.depthMat.dispose();
    this.gtaoMat.dispose();
    this.denoiseMat.dispose();
    this.noise.dispose();
    this.pdNoise.dispose();
    this.quad.dispose();
  }
}

/** The water's surface in x and z: the map and a margin on each side. */
function waterBox(v: THREE.Vector4) {
  const m = G.uMapSize.value as THREE.Vector2;
  return v.set(-WATER_MARGIN, -WATER_MARGIN, m.x + WATER_MARGIN, m.y + WATER_MARGIN);
}

function randomNoise(size: number) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256);
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export interface FxSettings {
  bloom: boolean;
  dof: boolean;
  ao: boolean;
  grade: boolean;
}

/** how much of the occlusion shows */
const AO_STRENGTH = 0.8;
const _view = new THREE.Matrix4();

export class PostFX {
  /** the scene, multisampled; resolved into its texture once it is drawn */
  readonly sceneRT: THREE.WebGLRenderTarget;
  /** half-size copy of the scene (for the bloom and the blur) and the tilt-shift blur worked out from it */
  private halfRT: THREE.WebGLRenderTarget;
  private blurRT: THREE.WebGLRenderTarget;
  private halfMat: THREE.RawShaderMaterial;
  private blurMat: THREE.RawShaderMaterial;
  bloom: Bloom;
  /** ambient occlusion, once it has been on (kept, so switching it back on compiles nothing) */
  private ao: HalfAO | null = null;
  private quad: FullScreenQuad;
  private final: THREE.RawShaderMaterial;
  settings: FxSettings = { bloom: true, dof: true, ao: false, grade: true };
  /** resolution scale of the world (1 = the canvas's own); takes effect on setSize */
  scale = 1;
  private w = 1;
  private h = 1;
  /** the first frame (behind the loading screen) runs the bloom and half-size passes both ways, compiling them */
  private warm = true;
  /**
   * The occlusion is worked out every other frame while the view stands still (the camera's matrices
   * equal to those it was last worked out with): the ground and the buildings keep theirs, and a
   * settler walking on is a pixel or two ahead of his for one frame. Off: every frame (for comparisons).
   */
  aoHalfRate = true;
  private aoView = new THREE.Matrix4();
  private aoHeld = false;
  private aoValid = false;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, w: number, h: number, samples = 4) {
    // (its depth is resolved only while the occlusion reads it: sceneDepth)
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, resolveDepthBuffer: false });
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
    // (the half-size depth is a 32-bit float target: without them there is no occlusion)
    on &&= this.renderer.extensions.has('EXT_color_buffer_float');
    this.settings.ao = on;
    if (on && !this.ao) {
      this.ao = new HalfAO();
      this.setSize(this.w, this.h);
    }
    this.sceneDepth(on);
  }

  /**
   * Whether the scene leaves its depth in a texture (resolved from the multisampled one along with the
   * colours). Without the occlusion nothing reads it, and the depth is not resolved at all.
   */
  private sceneDepth(on: boolean) {
    const rt = this.sceneRT;
    if (!!rt.depthTexture === on) return;
    const old = rt.depthTexture;
    rt.depthTexture = on ? new THREE.DepthTexture(1, 1) : null;
    rt.resolveDepthBuffer = on;
    rt.dispose();
    old?.dispose();
  }

  setSize(w: number, h: number) {
    this.w = w;
    this.h = h;
    const pr = this.renderer.getPixelRatio() * this.scale;
    const W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
    this.sceneRT.setSize(W, H);
    (this.final.uniforms.uRes.value as THREE.Vector2).set(W, H);
    // the same size as the bloom's bright pass, so it can read this copy instead of the scene
    const hw = Math.max(1, Math.round(W / 2)), hh = Math.max(1, Math.round(H / 2));
    this.halfRT.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    (this.blurMat.uniforms.uRes.value as THREE.Vector2).set(hw, hh);
    // a little sharpening wins back some of the crispness lost by scaling up
    this.final.uniforms.uSharpen.value = this.scale < 0.99 ? 0.35 * Math.min(1, (1 - this.scale) / 0.3) : 0;
    this.bloom.setSize(W, H);
    this.ao?.setSize(hw, hh);
    this.aoValid = false;
    (this.final.uniforms.uAORes.value as THREE.Vector2).set(hw, hh);
  }

  render(time: number, zoom01: number, night: number, rain = 0, rainSlant = 0) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    const sceneGpu = perf.beginGpu(r.getContext(), 'scene+shadow');
    r.render(this.scene, this.camera);
    perf.endGpu(sceneGpu);
    const src = this.sceneRT;
    const u = this.final.uniforms;
    const ao = this.settings.ao && this.sceneRT.depthTexture ? this.ao : null;
    if (!ao) this.aoValid = false;
    if (ao) {
      const view = _view.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      if (this.aoHalfRate && this.aoValid && !this.aoHeld && view.equals(this.aoView)) this.aoHeld = true;
      else {
        const aoGpu = perf.beginGpu(r.getContext(), 'ao');
        ao.render(r, this.sceneRT.depthTexture!, this.camera);
        perf.endGpu(aoGpu);
        this.aoView.copy(view);
        this.aoValid = true;
        this.aoHeld = false;
      }
      u.tDepth.value = this.sceneRT.depthTexture;
      u.tAO.value = ao.outRT.texture;
      u.cameraNear.value = this.camera.near;
      u.cameraFar.value = this.camera.far;
      (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(this.camera.matrixWorld);
      u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(this.camera.matrixWorld);
      waterBox(u.uWaterBox.value);
      this.halfMat.uniforms.tAO.value = ao.outRT.texture;
    }
    u.uAO.value = this.halfMat.uniforms.uAO.value = ao ? AO_STRENGTH : 0;
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
    // (with the occlusion the bloom always takes its bright parts from the copy, which has it)
    if (blurred || ao) {
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
    const finalGpu = perf.beginGpu(r.getContext(), 'final');
    this.quad.render(r);
    perf.endGpu(finalGpu);
  }

  private pass(m: THREE.Material, rt: THREE.WebGLRenderTarget) {
    this.quad.material = m;
    this.renderer.setRenderTarget(rt);
    this.quad.render(this.renderer);
  }

  flash(v: number) {
    this.final.uniforms.uFlash.value = v;
  }

  dispose() {
    this.sceneRT.dispose();
    this.halfRT.dispose();
    this.blurRT.dispose();
    this.halfMat.dispose();
    this.blurMat.dispose();
    this.bloom.dispose();
    this.ao?.dispose();
    this.final.dispose();
    this.quad.dispose();
  }
}
