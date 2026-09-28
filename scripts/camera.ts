// Headless check of the camera's mouse handling: a wheel zoom keeps the ground under the pointer
// where it is, a right-drag keeps the grabbed spot under the pointer, tilt stays in range and
// widens the view radius, wheel notches zoom by a steady step, Shift + wheel and sideways wheels
// turn the view, and trackpad swipes are told apart from mouse wheels.
// Usage: npx tsx scripts/camera.ts [seed]
import * as THREE from 'three';
import { Game } from '../src/game/game';
import { RTSCamera } from '../src/render/camera';

const seed = Number(process.argv[2] ?? 199);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
const W = 1280, H = 800;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

const cam = new RTSCamera(g.world, W / H);
// the parts of attach() the maths needs: the element's size and place
const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }), clientWidth: W, clientHeight: H };
const c = cam as unknown as Record<string, any>;
c.el = el;
const run = (sec: number) => { for (let k = 0; k < sec * 60; k++) cam.update(1 / 60); };
const hq = g.buildings.get(g.players[0].hq)!;
cam.jumpTo(hq.cx, hq.cz + 3, true);
cam.zoomTo(30, true);
run(1);

const toScreen = (p: THREE.Vector3) => {
  const v = p.clone().project(cam.camera);
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
};
const ground = (x: number, y: number) => cam.pick((x / W) * 2 - 1, -(y / H) * 2 + 1)!;
const off = (p: THREE.Vector3, x: number, y: number) => { const s = toScreen(p); return Math.hypot(s.x - x, s.y - y); };

// 1. zooming in and out towards the pointer
for (const [f, x, y] of [[0.55, 950, 250], [1.8, 300, 600], [0.7, 640, 400]] as const) {
  const p = ground(x, y);
  const d0 = cam.dist;
  cam.zoomBy(f, x, y);
  run(1.5);
  const e = off(p, x, y);
  check(Math.abs(cam.dist / d0 - f) < 0.02 && e < 1.5, `zoom ×${f} at (${x}, ${y}): the spot stays under the pointer (${e.toFixed(2)} px, dist ${d0.toFixed(1)} → ${cam.dist.toFixed(1)})`);
}
cam.zoomToPointer = false;
{
  const mid = ground(W / 2, H / 2), side = ground(1000, 200);
  cam.zoomBy(0.7, 1000, 200);
  run(1.5);
  check(off(mid, W / 2, H / 2) < 3 && off(side, 1000, 200) > 20, 'with zoom-to-pointer off the wheel zooms on the middle of the screen');
  cam.zoomBy(1 / 0.7);
  run(1.5);
}
cam.zoomToPointer = true;

// 2. right-drag: the grabbed spot follows the pointer
{
  const start = { x: 700, y: 420 }, path = [[640, 380], [520, 300], [300, 180], [260, 560], [900, 650]];
  const p = ground(start.x, start.y);
  c.grab = c.pinAt(start.x, start.y);
  let worst = 0;
  for (const [x, y] of path) {
    const n = c.ndc(x, y);
    c.grab.x = n.x; c.grab.y = n.y;
    run(0.25);
    worst = Math.max(worst, off(p, x, y));
  }
  c.grab = null;
  check(worst < 1.5, `a right-drag keeps the grabbed ground under the pointer (worst ${worst.toFixed(2)} px over ${path.length} moves)`);
}

// 3. tilt: clamped by zoom, and a view towards the horizon sees further
{
  const flat = cam.viewSize / cam.dist;
  check(Math.abs(flat - 1.1) < 1e-6, `untilted view radius is unchanged (${flat.toFixed(3)} × dist)`);
  c.goalTilt = -5;
  run(1);
  const [lo] = c.tiltRange(cam.dist);
  check(Math.abs(cam.tilt - lo) < 0.01 && cam.viewSize > cam.dist * 1.3, `tilt stops at ${lo.toFixed(2)} and widens the view radius (${(cam.viewSize / cam.dist).toFixed(2)} × dist)`);
  const p = ground(640, 150);
  check(!!p && Number.isFinite(p.x), 'the ground near the top of a tilted view can still be picked');
  cam.zoomTo(90);
  run(2);
  check(cam.tilt >= c.tiltRange(cam.dist)[0] - 1e-6, `zooming out narrows the tilt range (tilt ${cam.tilt.toFixed(2)})`);
  c.goalYaw = 7.5;
  cam.resetView();
  run(2);
  check(Math.abs(cam.tilt) < 0.01 && Math.abs(cam.yaw - Math.PI * 2) < 0.01, `a middle click faces north again the short way round (yaw ${cam.yaw.toFixed(2)})`);
  const pos = cam.camera.position;
  check(Number.isFinite(pos.x + pos.y + pos.z), 'the camera position stays finite');
  cam.zoomTo(30, true);
  run(1);
}

// 4. wheel events
const wheel = (o: Partial<WheelEvent> & { wheelDeltaY?: number; wheelDeltaX?: number }) =>
  ({ deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, shiftKey: false, clientX: 640, clientY: 400, ...o }) as unknown as WheelEvent;
const kinds: [string, WheelEvent, boolean][] = [
  ['macOS mouse notch', wheel({ deltaY: 4.000244140625, wheelDeltaY: -12 }), false],
  ['macOS mouse, fast spin', wheel({ deltaY: 4.000244140625 * 7, wheelDeltaY: -84 }), false],
  ['Windows mouse notch', wheel({ deltaY: 100, wheelDeltaY: -120 }), false],
  ['Firefox mouse (lines)', wheel({ deltaMode: 1, deltaY: 3 }), false],
  ['Chromium trackpad swipe', wheel({ deltaY: -2, wheelDeltaY: 6 }), true],
  ['Chromium trackpad sideways', wheel({ deltaX: 5, wheelDeltaX: -15, wheelDeltaY: 0 }), true],
  ['Firefox trackpad', wheel({ deltaY: 1.5 }), true],
];
for (const [name, e, tp] of kinds) check(c.isTrackpad(e) === tp, `${name}: ${tp ? 'trackpad' : 'mouse wheel'}`);
{
  const step = (e: WheelEvent) => { const d = c.goalDist; c.onWheel(e); const r = c.goalDist / d; c.goalDist = d; c.anchor = null; return r; };
  const mac = step(kinds[0][1]), win = step(kinds[2][1]), ff = step(kinds[3][1]);
  check(Math.abs(mac - win) < 0.01 && Math.abs(win - ff) < 0.02 && mac > 1.1, `one notch zooms the same everywhere (${mac.toFixed(3)} / ${win.toFixed(3)} / ${ff.toFixed(3)})`);
  {
    const t0 = cam.target.clone();
    const z = step(wheel({ deltaY: 30, wheelDeltaY: -90 }));
    check(z > 1 && cam.target.distanceTo(t0) < 1e-9, 'before any pinch a smooth swipe (a Magic Mouse) still zooms');
    const y0 = c.goalYaw;
    step(wheel({ deltaY: 100, wheelDeltaY: -120, shiftKey: true } as Partial<WheelEvent>));
    const y1 = c.goalYaw;
    step(wheel({ deltaX: 4.000244140625, deltaY: 0, wheelDeltaX: -12, wheelDeltaY: 0 }));
    const y2 = c.goalYaw;
    step(wheel({ deltaX: 20, wheelDeltaX: -60, wheelDeltaY: 0 }));
    check(Math.abs(y1 - y0 - Math.PI / 12) < 1e-6 && Math.abs(y2 - y1 - Math.PI / 12) < 1e-6 && c.goalYaw > y2,
      `Shift + wheel, a sideways notch and a sideways swipe turn the view (${[y1 - y0, y2 - y1, c.goalYaw - y2].map((v) => v.toFixed(3)).join(' / ')} rad)`);
    c.goalYaw = y0;
  }
  const pinch = step(wheel({ ctrlKey: true, deltaY: -6 }));
  check(pinch < 1 && pinch > 0.9, `a pinch zooms in smoothly (×${pinch.toFixed(3)})`);
  const before = cam.target.clone();
  step(kinds[2][1]);
  check(cam.target.distanceTo(before) < 1e-9, 'a mouse wheel does not pan');
  c.onWheel(wheel({ deltaY: 30, wheelDeltaY: -90 }));
  const moved = cam.target.clone().sub(before);
  check(moved.z > 0.5 && Math.abs(moved.x) < 0.2, `a trackpad swipe pans the view (${moved.x.toFixed(2)}, ${moved.z.toFixed(2)})`);
  cam.wheelMode = 'zoom';
  const z = step(wheel({ deltaY: 30, wheelDeltaY: -90 }));
  check(z > 1, 'with the wheel set to zoom, a swipe zooms');
  cam.wheelMode = 'auto';
}

console.log(fails ? `${fails} check(s) failed` : 'all camera checks passed');
process.exit(fails ? 1 : 0);
