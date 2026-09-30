// Day / night cycle, sun & moon light, sky colours and image-based lighting.
import * as THREE from 'three';
import { G } from './shaderPatch';
import { FitShadow } from './shadowFit';

interface Key {
  e: number; // sun elevation (sin)
  sun: [number, number, number];
  sunI: number;
  sky: [number, number, number];
  ground: [number, number, number];
  hemiI: number;
  fog: [number, number, number];
  zenith: [number, number, number];
  horizon: [number, number, number];
  exposure: number;
}

const KEYS: Key[] = [
  // night is moonlit rather than black: a silver-blue key light that still casts shadows, a brighter
  // blue sky fill and a little bounce, so fields, woods, water and people stay easy to tell apart
  { e: -0.35, sun: [0.58, 0.7, 1.0], sunI: 1.0, sky: [0.26, 0.33, 0.58], ground: [0.08, 0.085, 0.1], hemiI: 1.0, fog: [0.06, 0.085, 0.14], zenith: [0.025, 0.04, 0.1], horizon: [0.085, 0.12, 0.22], exposure: 1.2 },
  // twilight and sunset are lifted too, so the land never gets brighter as the night deepens
  { e: -0.08, sun: [0.62, 0.64, 0.96], sunI: 0.6, sky: [0.32, 0.32, 0.52], ground: [0.11, 0.09, 0.09], hemiI: 0.95, fog: [0.22, 0.2, 0.3], zenith: [0.08, 0.1, 0.22], horizon: [0.55, 0.35, 0.35], exposure: 1.26 },
  { e: 0.04, sun: [1.0, 0.5, 0.25], sunI: 1.3, sky: [0.55, 0.5, 0.6], ground: [0.28, 0.2, 0.14], hemiI: 0.85, fog: [0.75, 0.5, 0.38], zenith: [0.25, 0.35, 0.6], horizon: [1.0, 0.6, 0.35], exposure: 1.08 },
  { e: 0.22, sun: [1.0, 0.8, 0.58], sunI: 2.6, sky: [0.58, 0.68, 0.9], ground: [0.33, 0.28, 0.18], hemiI: 0.9, fog: [0.72, 0.75, 0.8], zenith: [0.3, 0.5, 0.85], horizon: [0.85, 0.8, 0.75], exposure: 0.95 },
  { e: 0.6, sun: [1.0, 0.95, 0.88], sunI: 3.2, sky: [0.55, 0.7, 1.0], ground: [0.35, 0.3, 0.2], hemiI: 0.95, fog: [0.7, 0.8, 0.92], zenith: [0.25, 0.48, 0.9], horizon: [0.72, 0.82, 0.95], exposure: 0.92 },
  { e: 1.0, sun: [1.0, 0.97, 0.92], sunI: 3.4, sky: [0.55, 0.72, 1.0], ground: [0.36, 0.3, 0.2], hemiI: 0.95, fog: [0.7, 0.8, 0.94], zenith: [0.22, 0.46, 0.9], horizon: [0.7, 0.82, 0.96], exposure: 0.9 },
];

function lerp3(a: number[], b: number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export class Sky {
  sun: THREE.DirectionalLight;
  /** the sun's shadow, placed over the view each frame (fitShadow) */
  readonly shadow = new FitShadow();
  hemi: THREE.HemisphereLight;
  timeOfDay = 0.36; // 0..1 (0.25 sunrise, 0.5 noon, 0.75 sunset)
  dayLength = 600; // seconds per full day at 1x
  cycle = true;
  sunDir = new THREE.Vector3();
  sunElev = 0;
  fogColor = new THREE.Color();
  zenith = new THREE.Color();
  horizon = new THREE.Color();
  exposure = 1;
  sunIntensity = 1;
  private skyScene: THREE.Scene;
  private skyMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  // the sky is drawn into a cube once per refresh and filtered into the same environment texture,
  // so no target is reallocated and no material has to re-check its program for a new texture
  private cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  private cubeCam = new THREE.CubeCamera(0.1, 100, this.cubeRT);
  private envT = 0;
  private lastEnvTod = -1;
  weather = 0; // 0 clear .. 1 overcast/rain
  dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow = this.shadow as unknown as THREE.DirectionalLightShadow;
    this.sun.shadow.mapSize.set(4096, 4096);
    // (its camera, depth range and bias are set over the view each frame by fitShadow)
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x99bbff, 0x554433, 0.9);
    scene.add(this.hemi);

    // sky dome used for IBL
    this.skyScene = new THREE.Scene();
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunCol: { value: new THREE.Color() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.6));
          col = mix(col, uGround, (1.0 - smoothstep(-0.25, 0.0, h)));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(s, 600.0) * 30.0 + pow(s, 12.0) * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat);
    this.skyScene.add(dome);
    // visible sky dome with drifting clouds (seen at the horizon and in water reflections)
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunCol: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoon: { value: 0 },
        uTime: G.uTime,
        tNoise: G.tNoise,
        uCloud: G.uCloud,
        uCloudSpeed: G.uCloudSpeed,
        uNight: G.uNight,
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uZenith, uHorizon, uSunDir, uSunCol; uniform float uTime; uniform sampler2D tNoise;
        uniform float uCloud; uniform vec2 uCloudSpeed; uniform float uNight;
        uniform vec3 uMoonDir; uniform float uMoon;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(s, 900.0) * 40.0 + pow(s, 16.0) * 0.35);
          // the moon, where the night light comes from: a pale disc in a wide silver halo
          float md = max(dot(d, uMoonDir), 0.0);
          col += (vec3(0.9, 0.94, 1.0) * smoothstep(0.99955, 0.9997, md) * 2.2 + vec3(0.22, 0.3, 0.5) * pow(md, 40.0) * 0.4) * uMoon;
          // clouds projected on a flat layer
          vec2 cp = d.xz / max(0.08, d.y) * 0.6 + uCloudSpeed * uTime * 0.004;
          float n = texture2D(tNoise, cp * 0.35).r * 0.65 + texture2D(tNoise, cp * 0.9 + 0.3).g * 0.35;
          float cl = smoothstep(0.42, 0.7, n) * smoothstep(0.0, 0.25, d.y) * (0.6 + uCloud);
          vec3 cloudCol = mix(uHorizon * 1.15 + uSunCol * 0.25, vec3(0.08, 0.1, 0.16), uNight * 0.8);
          col = mix(col, cloudCol, clamp(cl, 0.0, 0.85));
          // stars at night
          float st = step(0.9985, texture2D(tNoise, d.xz / max(0.1, d.y) * 3.0).a) * uNight * h;
          col += vec3(st) * 2.0;
          // below the horizon fade to deep sea colour
          col = mix(col, uHorizon * 0.35 + vec3(0.02, 0.06, 0.1), smoothstep(0.0, -0.15, d.y) * 0.0 + (1.0 - smoothstep(-0.12, 0.0, d.y)));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.domeMat);
    this.dome.frustumCulled = false;
    // behind everything, so drawn after every solid thing and the ground (cutOrder): its fragments are
    // then tested away wherever the land covers it, which at the play zoom is the whole screen
    this.domeMat.userData.drawLate = 2;
    scene.add(this.dome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.update(0, new THREE.Vector3(), 40);
  }

  get night() {
    return G.uNight.value;
  }

  update(dt: number, target: THREE.Vector3, viewSize: number) {
    if (this.cycle) this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    const t = this.timeOfDay;
    const ang = (t - 0.25) * Math.PI * 2; // 0 at sunrise
    const elev = Math.sin(ang);
    this.sunElev = elev;
    // sun path: rises in the east (+x), culminates in the south (+z, towards the camera), sets in the west
    const az = ang;
    const sunVec = new THREE.Vector3(Math.cos(az), Math.max(elev, -1) * 0.95, 0.55 + Math.sin(az) * 0.2).normalize();
    // key frame blending
    let k0 = KEYS[0], k1 = KEYS[KEYS.length - 1], f = 0;
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (elev >= KEYS[i].e && elev <= KEYS[i + 1].e) {
        k0 = KEYS[i]; k1 = KEYS[i + 1];
        f = (elev - k0.e) / (k1.e - k0.e);
        break;
      }
    }
    if (elev < KEYS[0].e) { k0 = k1 = KEYS[0]; f = 0; }
    const lerp = (a: number, b: number) => a + (b - a) * f;
    const isNight = elev < -0.02;
    // light direction: sun by day, moon by night (kept fairly low so shapes and shadows stay readable)
    const lightDir = isNight
      ? new THREE.Vector3(-sunVec.x * 0.6 + 0.2, 0.3 + 0.4 * Math.min(1, -elev), 0.6).normalize()
      : new THREE.Vector3(sunVec.x, Math.max(0.12, sunVec.y), sunVec.z).normalize();
    // soften the transition around the horizon
    const horizonDip = 1 - Math.exp(-Math.abs(elev) * 18);
    const sunC = lerp3(k0.sun, k1.sun, f);
    const overcast = this.weather;
    let sunI = lerp(k0.sunI, k1.sunI) * (0.25 + 0.75 * horizonDip) * (1 - overcast * 0.7);
    this.sunIntensity = sunI;
    this.sun.color.setRGB(sunC[0], sunC[1], sunC[2]);
    this.sun.intensity = sunI;
    this.sunDir.copy(lightDir);
    G.uSunDir.value.copy(lightDir);
    const sky = lerp3(k0.sky, k1.sky, f), ground = lerp3(k0.ground, k1.ground, f);
    const grey = (c: number[]) => { const m = (c[0] + c[1] + c[2]) / 3; return [c[0] + (m - c[0]) * overcast * 0.7, c[1] + (m - c[1]) * overcast * 0.7, c[2] + (m - c[2]) * overcast * 0.7]; };
    const s2 = grey(sky);
    this.hemi.color.setRGB(s2[0], s2[1], s2[2]);
    this.hemi.groundColor.setRGB(ground[0], ground[1], ground[2]);
    this.hemi.intensity = lerp(k0.hemiI, k1.hemiI) * (1 + overcast * 0.25);
    const fog = grey(lerp3(k0.fog, k1.fog, f));
    this.fogColor.setRGB(fog[0], fog[1], fog[2]);
    const z = grey(lerp3(k0.zenith, k1.zenith, f)), hz = grey(lerp3(k0.horizon, k1.horizon, f));
    this.zenith.setRGB(z[0], z[1], z[2]);
    this.horizon.setRGB(hz[0], hz[1], hz[2]);
    this.exposure = lerp(k0.exposure, k1.exposure);
    G.uNight.value = THREE.MathUtils.smoothstep(-elev, -0.02, 0.18) * 0.9 + overcast * 0.15;
    G.uCloud.value = 0.3 + overcast * 0.5;

    // (the shadow camera is placed over the view by fitShadow, from sunDir)
    void viewSize;

    // visible dome follows the camera target
    const du = this.domeMat.uniforms;
    (du.uZenith.value as THREE.Color).copy(this.zenith);
    (du.uHorizon.value as THREE.Color).copy(this.horizon);
    (du.uSunDir.value as THREE.Vector3).copy(sunVec);
    (du.uSunCol.value as THREE.Color).setRGB(sunC[0], sunC[1], sunC[2]).multiplyScalar(isNight ? 0 : horizonDip);
    (du.uMoonDir.value as THREE.Vector3).copy(lightDir);
    du.uMoon.value = isNight ? horizonDip * (1 - overcast * 0.8) : 0;
    this.dome.position.set(target.x, 0, target.z);

    // environment map refresh
    this.envT -= dt;
    if (this.envRT === null || (this.envT <= 0 && Math.abs(this.timeOfDay - this.lastEnvTod) > 0.004)) {
      this.envT = 1.5;
      this.lastEnvTod = this.timeOfDay;
      const u = this.skyMat.uniforms;
      (u.uZenith.value as THREE.Color).copy(this.zenith);
      (u.uHorizon.value as THREE.Color).copy(this.horizon);
      (u.uGround.value as THREE.Color).setRGB(ground[0] * 0.8, ground[1] * 0.8, ground[2] * 0.8);
      (u.uSunDir.value as THREE.Vector3).copy(sunVec);
      (u.uSunCol.value as THREE.Color).setRGB(sunC[0], sunC[1], sunC[2]).multiplyScalar(isNight ? 0 : horizonDip);
      this.cubeCam.update(this.renderer, this.skyScene);
      this.envRT = this.envRT ? this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT) : this.pmrem.fromCubemap(this.cubeRT.texture);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.55 * (isNight ? 0.6 : 1);
    }
  }
}
