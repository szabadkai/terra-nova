// Headless check of the sun's shadow placement (src/render/shadowFit.ts), with the game's own camera
// over a real map, at every zoom, tilted both ways, a turn of the view every 30 degrees, four heights
// of the sun and three screen shapes: whatever the view shows within the shadows' reach (the ground
// and up to the tallest roofs over it) lands inside the part of the map drawn, and whatever could
// shade it from the sun inside the depth the shadow camera sees; where the rectangle is cut to fit
// the map it keeps the middle of the view; the texels are no coarser than the old square's (by more
// than an eighth) wherever the square covered the view; the bias stays the same in world units;
// panning keeps the texel grid where it was; the viewport WebGL gets truncates to exactly the
// rectangle the shadow matrix maps onto; and the rotated taps of the patched soft-shadow lookup are
// three's own Vogel-disk taps. Also prints how many texels are drawn against the old square.
// Nothing here touches the game.
// Usage: npx tsx scripts/shadowfit.ts
import * as THREE from 'three';
import { Game } from '../src/game/game';
import { RTSCamera } from '../src/render/camera';
import { FitShadow, fitShadow } from '../src/render/shadowFit';

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

const game = new Game({ size: 160, seed: 199, players: 2, aiLevel: 1, islands: true });
const w = game.world;
const hq = game.buildings.get(game.players[0].hq)!;
const sun = new THREE.DirectionalLight();
// (its target sits in the scene, not under the light, as in the game)
const shadow = new FitShadow();
(sun as { shadow: unknown }).shadow = shadow;

/** The old square: its texel size for this view. */
const oldTexel = (viewSize: number, S: number) => (2 * Math.max(18, viewSize * 0.75)) / S;

const place = (cam: RTSCamera, x: number, z: number, dist: number, yaw: number, tilt: number) => {
  cam.jumpTo(x, z, true);
  cam.target.y = w.heightAt(x, z);
  cam.zoomTo(dist, true);
  cam.setYaw(yaw);
  cam.setTilt(tilt);
  (cam as unknown as { place(): void }).place();
};

const uv = new THREE.Vector4();
const project = (p: THREE.Vector3) => uv.set(p.x, p.y, p.z, 1).applyMatrix4(shadow.matrix);

// (map widths as the renderer picks them: sizeShadowMap)
const mapWidth = (aspect: number) => Math.round((4096 * Math.min(1.4, Math.max(1, aspect / 1.6))) / 256) * 256;
const shapes: [string, number, number][] = [['16:9', 16 / 9, mapWidth(16 / 9)], ['21:9', 3440 / 1440, mapWidth(3440 / 1440)], ['4:3', 4 / 3, mapWidth(4 / 3)]];
let dbg = 0;
const q = new THREE.Vector3();
let shadeCut = 0, biasOff = 0;
let configs = 0, uncovered = 0, clipped = 0, coarser = 0, worstCoarse = 1, areaSum = 0, areaMax = 0, clipMissInCore = 0;
const coarseAt: string[] = [];
for (const [shape, aspect, mapW] of shapes) {
  const cam = new RTSCamera(w, aspect);
  shadow.mapSize.set(mapW, 4096);
  for (const dist of [9, 15, 22, 30, 45, 60, 80, 95])
    for (const tilt of [0, -0.25, 0.25])
      for (let a = 0; a < 12; a++)
        for (const elev of [0.15, 0.35, 0.6, 0.9]) {
          const yaw = (a / 12) * Math.PI * 2;
          place(cam, hq.cx, hq.cz + 4, dist, yaw, tilt);
          const az = a * 0.7 + elev * 3;
          const L = new THREE.Vector3(Math.cos(az) * Math.cos(Math.asin(elev)), elev, Math.sin(az) * Math.cos(Math.asin(elev))).normalize();
          fitShadow(sun, shadow, cam.camera, cam.target, cam.viewSize, L, w);
          shadow.updateMatrices(sun);
          configs++;
          const S = shadow.mapSize, f = shadow.fit;
          const wT = Math.round(f.z * S.x), hT = Math.round(f.w * S.y);
          const T = (shadow.camera.right - shadow.camera.left) / wT;
          const ratio = T / oldTexel(cam.viewSize, S.y);
          const isClipped = wT >= S.x || hT >= S.y;
          if (isClipped) clipped++;
          const area = (wT * hT) / (4096 * 4096);
          areaSum += area;
          areaMax = Math.max(areaMax, area);
          // what the view shows: screen rays against the ground, and the stretch of each ray up to the
          // tallest things above it, within the reach
          const reach = Math.max(20, cam.viewSize * 1.1);
          // (a texel in: its shadow is drawn, though the soft filter's edge may reach past the rectangle)
          const mx = 1 / S.x, my = 1 / S.y;
          let miss = 0, oldMiss = 0;
          let topH = -Infinity;
          for (let z = Math.max(0, Math.floor(cam.target.z - reach)); z < Math.min(w.H, cam.target.z + reach); z++)
            for (let x = Math.max(0, Math.floor(cam.target.x - reach)); x < Math.min(w.W, cam.target.x + reach); x++) topH = Math.max(topH, w.h[z * w.W + x]);
          const biasW = shadow.bias * (shadow.camera.far - shadow.camera.near);
          if (Math.abs(biasW + 0.0876) > 1e-6) biasOff++;
          const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.camera.projectionMatrix, cam.camera.matrixWorldInverse));
          const halfOld = Math.max(18, cam.viewSize * 0.75);
          const X0 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), L).normalize(), Y0 = new THREE.Vector3().crossVectors(L, X0);
          for (let j = 0; j <= 12; j++)
            for (let i = 0; i <= 16; i++) {
              const hit = cam.pick((i / 16) * 2 - 1, (j / 12) * 2 - 1);
              if (!hit) continue;
              const dir = hit.clone().sub(cam.camera.position).normalize();
              for (let k = 0; k <= 4; k++) {
                // up the ray to 8 above the ground where it hits
                const up = (k / 4) * 8;
                const back = dir.y < -1e-3 ? -up / dir.y : 0;
                const p = hit.clone().addScaledVector(dir, -back);
                // (in view only: close up the eye is lower than the tallest roofs)
                if (!view.containsPoint(p)) continue;
                const hd = Math.hypot(p.x - cam.target.x, p.z - cam.target.z);
                if (hd > reach) continue;
                const rel = p.clone().sub(cam.target);
                if (Math.abs(rel.dot(X0)) > halfOld || Math.abs(rel.dot(Y0)) > halfOld) oldMiss++;
                // what could shade it: up the light to the tallest thing within the reach
                const s2 = (topH + 8 - p.y) / L.y;
                if (s2 > 0 && s2 < 250) {
                  project(q.copy(p).addScaledVector(L, s2));
                  if (uv.z < 0) shadeCut++;
                }
                project(p);
                const inside = uv.x >= mx && uv.x <= f.z - mx && uv.y >= my && uv.y <= f.w - my && uv.z >= 0 && uv.z <= 1;
                if (!inside) {
                  if (process.env.DEBUG && dbg++ < 400) {
                    const ox = Math.max(mx - uv.x, uv.x - (f.z - mx), 0) * S.x, oy = Math.max(my - uv.y, uv.y - (f.w - my), 0) * S.y;
                    console.log(`  miss ${shape} d ${dist} t ${tilt} yaw ${a * 30} sun ${elev}: out ${ox.toFixed(1)} x ${oy.toFixed(1)} texels, z ${uv.z.toFixed(3)}, up ${up}, ground ${hit.y.toFixed(1)} hd/reach ${(hd / reach).toFixed(2)} clipped ${isClipped}`);
                  }
                  miss++;
                  // even a rectangle cut down to fit the map keeps what is near the target
                  if (isClipped && hd < cam.viewSize * 0.75) clipMissInCore++;
                }
              }
            }
          if (miss && !isClipped) uncovered++;
          if (miss && process.env.DEBUG) console.log(`  (${shape} d ${dist} t ${tilt} yaw ${a * 30} sun ${elev}: ${miss} missed, the old square ${oldMiss})`);
          // coarser texels than the square's only buy shadows where the square left the view without them
          if (ratio > 1.0001) {
            if (oldMiss === 0 && ratio > 1.125) coarser++;
            if (ratio > worstCoarse) worstCoarse = ratio;
            if (oldMiss === 0 && process.env.DEBUG) console.log(`  coarse ${shape} d ${dist} t ${tilt} yaw ${a * 30} sun ${elev}: ${ratio.toFixed(4)}`);
            if (oldMiss === 0 && ratio > 1.125 && coarseAt.length < 4) coarseAt.push(`${shape} d ${dist} tilt ${tilt} yaw ${(a * 30)}° sun ${elev}: ${ratio.toFixed(2)}`);
          }
          // the viewport WebGL is given truncates to exactly the rectangle
          const vp = shadow.getViewport();
          if (Math.trunc(vp.z * S.x) !== wT || Math.trunc(vp.w * S.y) !== hT) { check(false, `viewport ${vp.z * S.x} x ${vp.w * S.y} for ${wT} x ${hT}`); }
        }
}
check(uncovered === 0, `every point in view within the reach is inside the drawn rectangle (${configs} views, ${uncovered} with misses)`);
check(shadeCut === 0, `whatever could shade a point in view lies inside the shadow camera's depth (${shadeCut} cut off)`);
check(biasOff === 0, `the depth bias is ${(0.0876).toFixed(4)} world units in every view (${biasOff} off)`);
check(clipMissInCore === 0, `where the rectangle was cut to fit the map (${clipped} views), nothing within 0.75 view sizes of the target was cut off`);
check(coarser === 0, `texels within an eighth of the old square's wherever it covered the view (coarser in ${coarser} such views${coarseAt.length ? ': ' + coarseAt.join('; ') : ''})`);
check(worstCoarse < 1.35, `never more than 1.35x the old texel (${worstCoarse.toFixed(2)}x)`);
console.log(`     texels drawn against the old 4096 x 4096 square: mean ${(areaSum / configs * 100).toFixed(0)}%, most ${(areaMax * 100).toFixed(0)}%`);

// panning keeps the grid: a fixed point's texel position moves by whole texels
{
  const cam = new RTSCamera(w, 16 / 9);
  shadow.mapSize.set(4096, 4096);
  const L = new THREE.Vector3(0.65, 0.51, 0.57).normalize();
  const q = new THREE.Vector3(hq.cx + 1.3, w.heightAt(hq.cx + 1.3, hq.cz + 2.1), hq.cz + 2.1);
  let worst = 0, sameT = true;
  for (const dist of [12, 30, 70]) {
    place(cam, hq.cx, hq.cz + 4, dist, 0.8, 0);
    fitShadow(sun, shadow, cam.camera, cam.target, cam.viewSize, L, w);
    shadow.updateMatrices(sun);
    const T0 = (shadow.camera.right - shadow.camera.left) / Math.round(shadow.fit.z * 4096);
    project(q);
    const a = [uv.x * 4096, uv.y * 4096];
    for (const [dx, dz] of [[0.37, 0.61], [-2.2, 1.7], [5.3, -4.1]]) {
      place(cam, hq.cx + dx, hq.cz + 4 + dz, dist, 0.8, 0);
      fitShadow(sun, shadow, cam.camera, cam.target, cam.viewSize, L, w);
      shadow.updateMatrices(sun);
      const T1 = (shadow.camera.right - shadow.camera.left) / Math.round(shadow.fit.z * 4096);
      if (Math.abs(T1 - T0) > 1e-9) sameT = false;
      project(q);
      const b = [uv.x * 4096, uv.y * 4096];
      for (let k = 0; k < 2; k++) { const d = b[k] - a[k]; worst = Math.max(worst, Math.abs(d - Math.round(d))); }
    }
  }
  check(sameT, 'panning keeps the texel size');
  check(worst < 1e-3, `panning moves a fixed point by whole texels (off by at most ${worst.toExponential(1)} of a texel)`);
}

// the patched lookup: the same five taps as three's Vogel disk, turned by the pixel's angle
{
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const at = src.indexOf('mat2 R');
  check(at > 0 && !src.slice(0, src.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )')).includes('vogelDiskSample( 0, 5, phi ) * radius'), 'the 2D soft-shadow lookup is patched');
  const taps = [...src.slice(at, at + 1200).matchAll(/R \* vec2\( (-?[\d.]+), (-?[\d.]+) \)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  let worst = 0;
  for (const phi of [0, 0.7, 2.9, 5.1]) {
    const c = Math.cos(phi), s = Math.sin(phi);
    taps.forEach(([x, y], i) => {
      const r = Math.sqrt((i + 0.5) / 5), th = i * 2.399963229728653 + phi;
      const want = [Math.cos(th) * r, Math.sin(th) * r], got = [c * x - s * y, s * x + c * y];
      worst = Math.max(worst, Math.abs(want[0] - got[0]), Math.abs(want[1] - got[1]));
    });
  }
  check(taps.length === 5 && worst < 1e-7, `five taps, each where three's Vogel disk puts it (off by at most ${worst.toExponential(1)})`);
  check(src.includes('( R * vec2(') && src.includes('* rad'), 'the filter radius is in texels along each axis of the map');
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
