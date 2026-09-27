// Day / night cycle, sun & moon light, sky colours and image-based lighting.
import * as THREE from 'three';
import { G } from './shaderPatch';

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
  { e: -0.35, sun: [0.55, 0.66, 1.0], sunI: 0.55, sky: [0.16, 0.22, 0.42], ground: [0.05, 0.06, 0.08], hemiI: 0.85, fog: [0.05, 0.07, 0.12], zenith: [0.02, 0.03, 0.08], horizon: [0.07, 0.1, 0.18], exposure: 1.25 },
  { e: -0.08, sun: [0.6, 0.62, 0.95], sunI: 0.35, sky: [0.3, 0.3, 0.5], ground: [0.1, 0.08, 0.08], hemiI: 0.8, fog: [0.22, 0.2, 0.3], zenith: [0.08, 0.1, 0.22], horizon: [0.55, 0.35, 0.35], exposure: 1.15 },
  { e: 0.04, sun: [1.0, 0.5, 0.25], sunI: 1.3, sky: [0.55, 0.5, 0.6], ground: [0.28, 0.2, 0.14], hemiI: 0.85, fog: [0.75, 0.5, 0.38], zenith: [0.25, 0.35, 0.6], horizon: [1.0, 0.6, 0.35], exposure: 1.0 },
  { e: 0.22, sun: [1.0, 0.8, 0.58], sunI: 2.6, sky: [0.58, 0.68, 0.9], ground: [0.33, 0.28, 0.18], hemiI: 0.9, fog: [0.72, 0.75, 0.8], zenith: [0.3, 0.5, 0.85], horizon: [0.85, 0.8, 0.75], exposure: 0.95 },
  { e: 0.6, sun: [1.0, 0.95, 0.88], sunI: 3.2, sky: [0.55, 0.7, 1.0], ground: [0.35, 0.3, 0.2], hemiI: 0.95, fog: [0.7, 0.8, 0.92], zenith: [0.25, 0.48, 0.9], horizon: [0.72, 0.82, 0.95], exposure: 0.92 },
  { e: 1.0, sun: [1.0, 0.97, 0.92], sunI: 3.4, sky: [0.55, 0.72, 1.0], ground: [0.36, 0.3, 0.2], hemiI: 0.95, fog: [0.7, 0.8, 0.94], zenith: [0.22, 0.46, 0.9], horizon: [0.7, 0.82, 0.96], exposure: 0.9 },
];

function lerp3(a: number[], b: number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export class Sky {
  sun: THREE.DirectionalLight;
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
  private envT = 0;
  private lastEnvTod = -1;
  weather = 0; // 0 clear .. 1 overcast/rain

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2.5;
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 220;
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
          col = mix(col, uGround, smoothstep(0.0, -0.25, h));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(s, 600.0) * 30.0 + pow(s, 12.0) * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat);
    this.skyScene.add(dome);
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
    // light direction: sun by day, moon by night
    const lightDir = isNight
      ? new THREE.Vector3(-sunVec.x * 0.6 + 0.2, Math.max(0.35, -elev), 0.6).normalize()
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

    // shadow camera follows the view
    const half = Math.max(18, viewSize * 0.75);
    const cam = this.sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.updateProjectionMatrix();
    // snap to shadow texel grid to avoid shimmering
    const texel = (half * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(tx + lightDir.x * 90, target.y + lightDir.y * 90, tz + lightDir.z * 90);
    this.sun.target.updateMatrixWorld();

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
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.skyScene, 0, 0.1, 100);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.55 * (isNight ? 0.6 : 1);
      if (old) old.dispose();
    }
  }
}
