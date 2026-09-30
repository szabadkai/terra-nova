// RTS camera: smooth pan / zoom / rotate / tilt, zoom-dependent pitch.
// Mouse: the wheel zooms towards the spot under the pointer; right-drag grabs the ground and the
// grabbed spot stays under the pointer; middle-drag, or Alt/Option + drag with either button (for
// mice without a middle button), turns and tilts the view, Shift + wheel or a sideways wheel
// turns it, and a middle click faces north again. Right-drag can be set to turn instead of pan.
// Trackpad: a pinch zooms; once one has been seen, two-finger swipes pan. Safari's twist turns.
// Touch: one finger pans, two pinch, twist and pan together.
import * as THREE from 'three';
import type { World } from '../game/world';

const NO_KEYS = new Set<string>();
const FOV = 36;
const HALF_FOV = (FOV / 2) * (Math.PI / 180);
/** one notch of a mouse wheel as macOS reports it (Chromium and WebKit) */
const MAC_NOTCH = 4.000244140625;
/** the screen border (px) where edge scrolling starts; it runs faster towards the very edge */
const EDGE = 18;

/** What the scroll wheel or a two-finger swipe does; a pinch always zooms. */
export type WheelMode = 'auto' | 'zoom' | 'pan';

/** Set by the first pinch: the pointer device is a trackpad, so in 'auto' its swipes pan
 * (a Magic Mouse sends the same smooth deltas but cannot pinch, so it keeps zooming). */
let pinched = false;

/** A spot of ground held under a screen point (NDC) while the view moves. */
interface Pin { p: THREE.Vector3; x: number; y: number }

export class RTSCamera {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  dist = 30;
  private goalDist = 30;
  yaw = 0;
  private goalYaw = 0;
  /** offset on the zoom-driven pitch: below 0 looks towards the horizon, above 0 straight down */
  tilt = 0;
  private goalTilt = 0;
  minDist = 9;
  maxDist = 95;
  keys = new Set<string>();
  edgeScroll = true;
  /** multiplier on keyboard and edge scrolling */
  scrollSpeed = 1;
  /** the wheel zooms towards the pointer rather than the middle of the screen */
  zoomToPointer = true;
  wheelMode: WheelMode = 'auto';
  /** what a plain right-drag does; Alt/Option + right-drag does the other */
  rightDrag: 'pan' | 'orbit' = 'pan';
  /** false while a menu is open: held keys and the screen edge stop moving the view */
  inputEnabled = true;
  mouse = { x: 0.5, y: 0.5, inside: false };
  /** what a held mouse button is doing to the view */
  drag: 'pan' | 'orbit' | null = null;
  private dragButton = -1;
  private lastX = 0;
  private lastY = 0;
  private travel = 0;
  /** ground held under the pointer by a drag, or under the wheel's spot while a zoom plays out */
  private grab: Pin | null = null;
  private anchor: Pin | null = null;
  private lastPinch = 0;
  shake = 0;
  cinematic = false;
  /** the view is where it is going: nothing is moving it, and nothing would be missed drawing it less often */
  get settled() {
    return !this.drag && !this.grab && !this.anchor && this.shake <= 0 && !this.cinematic
      && Math.abs(this.goal.x - this.target.x) + Math.abs(this.goal.z - this.target.z) < 0.02
      && Math.abs(this.goalDist - this.dist) < this.dist * 0.002 && Math.abs(this.goalYaw - this.yaw) < 0.002 && Math.abs(this.goalTilt - this.tilt) < 0.002;
  }
  private el: HTMLElement | null = null;
  private raycaster = new THREE.Raycaster();
  private v2 = new THREE.Vector2();
  private tmp = new THREE.Vector3();

  constructor(private world: World, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.5, 600);
  }

  /** How far the view is tipped down, from the zoom (closer looks flatter) and the player's tilt. */
  get pitch() {
    const z = (this.dist - this.minDist) / (this.maxDist - this.minDist);
    return THREE.MathUtils.lerp(0.72, 1.08, Math.pow(z, 0.7)) + this.tilt;
  }

  /** Tilt range at the current zoom: close up the view may sink towards the horizon, far out only a little. */
  private tiltRange(dist: number): [number, number] {
    const z = THREE.MathUtils.clamp((dist - this.minDist) / (this.maxDist - this.minDist), 0, 1);
    return [-THREE.MathUtils.lerp(0.3, 0.1, z), 0.3];
  }

  jumpTo(x: number, z: number, instant = false) {
    this.goal.set(x, 0, z);
    this.anchor = null;
    if (instant) this.target.copy(this.goal);
  }

  /** Face the view along `yaw` straight away (restoring a saved game). */
  setYaw(yaw: number) {
    this.yaw = this.goalYaw = yaw;
  }

  setTilt(tilt: number) {
    const [lo, hi] = this.tiltRange(this.goalDist);
    this.tilt = this.goalTilt = THREE.MathUtils.clamp(tilt, lo, hi);
  }

  zoomTo(d: number, instant = false) {
    this.goalDist = THREE.MathUtils.clamp(d, this.minDist, this.maxDist);
    this.anchor = null;
    if (instant) this.dist = this.goalDist;
  }

  /** Turn the view by `a` radians (positive turns the world clockwise on screen). */
  turnBy(a: number) {
    this.goalYaw += a;
  }

  /** Face north with the usual pitch again. */
  resetView() {
    this.goalYaw = Math.round(this.goalYaw / (Math.PI * 2)) * Math.PI * 2;
    this.goalTilt = 0;
  }

  /** Radius around the target that the view can see (culling, effects, shadows). Tilting towards the horizon widens it. */
  get viewSize() {
    const p = this.pitch;
    const low = p - HALF_FOV; // the top edge of the screen looks this far below the horizon
    const reach = low > 0.06 ? Math.sin(p) / Math.tan(low) - Math.cos(p) : 4;
    return this.dist * Math.max(1.1, Math.min(4, reach * 1.25));
  }

  private abort: AbortController | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchAng = 0;

  private ndc(clientX: number, clientY: number) {
    const r = this.el!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 2 - 1, y: -((clientY - r.top) / r.height) * 2 + 1 };
  }

  /** Where the ray through a screen point (NDC) crosses height `level`, or null towards the sky. */
  private onLevel(x: number, y: number, level: number, out: THREE.Vector3): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.v2.set(x, y), this.camera);
    const r = this.raycaster.ray;
    if (r.direction.y > -0.03) return null;
    const t = (level - r.origin.y) / r.direction.y;
    if (t <= 0) return null;
    return out.copy(r.origin).addScaledVector(r.direction, t);
  }

  /** The ground under a client point, held there by `grab` or `anchor`. */
  private pinAt(clientX: number, clientY: number): Pin | null {
    const n = this.ndc(clientX, clientY);
    const p = this.pick(n.x, n.y) ?? this.onLevel(n.x, n.y, this.target.y, new THREE.Vector3());
    return p ? { p, x: n.x, y: n.y } : null;
  }

  /** Slide the view so the pinned spot of ground sits under its screen point again. */
  private hold(pin: Pin) {
    const q = this.onLevel(pin.x, pin.y, pin.p.y, this.tmp);
    if (!q) return;
    const dx = pin.p.x - q.x, dz = pin.p.z - q.z;
    // a ray that grazes the ground near the horizon would fling the view across the map
    if (dx * dx + dz * dz > this.dist * this.dist * 4) return;
    this.target.x += dx; this.target.z += dz;
    this.goal.x += dx; this.goal.z += dz;
  }

  /** Zoom by factor `f` (above 1 moves out), towards the ground under a client point when given. */
  zoomBy(f: number, clientX?: number, clientY?: number) {
    this.goalDist = THREE.MathUtils.clamp(this.goalDist * f, this.minDist, this.maxDist);
    if (clientX === undefined || clientY === undefined || !this.zoomToPointer || this.grab) return;
    // the next notch of a spin keeps the spot the first one took, as long as the pointer stays put
    const a = this.anchor, n = this.ndc(clientX, clientY);
    const r = this.el!.getBoundingClientRect();
    if (a && Math.abs(a.x - n.x) * r.width < 3 && Math.abs(a.y - n.y) * r.height < 3) return;
    this.anchor = this.pinAt(clientX, clientY);
  }

  /** Move the view by a screen distance in pixels (a two-finger swipe), the ground following the fingers. */
  private panPixels(dx: number, dy: number) {
    const h = this.el?.clientHeight || window.innerHeight;
    const s = (2 * this.dist * Math.tan(HALF_FOV)) / h;
    const mx = dx * s, mz = (dy * s) / Math.max(0.55, Math.sin(this.pitch));
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const ox = mx * c + mz * sn, oz = -mx * sn + mz * c;
    this.goal.x += ox; this.goal.z += oz;
    this.target.x += ox; this.target.z += oz;
    this.anchor = null;
  }

  /** A two-finger swipe on a trackpad rather than a mouse wheel. */
  private isTrackpad(e: WheelEvent) {
    if (e.deltaMode !== 0) return false; // lines or pages: a wheel
    const d = e.deltaY || e.deltaX;
    if (d !== 0 && Math.abs(d) % MAC_NOTCH === 0) return false; // whole notches on a Mac
    // Chromium and WebKit report wheelDelta as exactly -3× the pixel delta for trackpads only
    const wy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    const wx = (e as WheelEvent & { wheelDeltaX?: number }).wheelDeltaX;
    if (typeof wy === 'number' && wy) return Math.abs(wy + 3 * e.deltaY) < 1;
    if (typeof wx === 'number' && wx) return Math.abs(wx + 3 * e.deltaX) < 1;
    return e.deltaX !== 0 || !Number.isInteger(e.deltaY);
  }

  private onWheel(e: WheelEvent) {
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey) {
      // a pinch on the trackpad (or Ctrl + wheel)
      pinched = true;
      this.lastPinch = performance.now();
      this.zoomBy(Math.exp(THREE.MathUtils.clamp(dy * 0.01, -0.3, 0.3)), e.clientX, e.clientY);
      return;
    }
    // wheel notches: 100 px on most systems, 4.0002 on a Mac; a steady step per notch either way
    const notches = (d: number) => (Math.abs(d) % MAC_NOTCH === 0 ? d / MAC_NOTCH : d / 100);
    const smooth = this.isTrackpad(e);
    // Shift + wheel (which most systems turn into a sideways scroll) turns the view
    if (e.shiftKey) {
      const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      this.turnBy(smooth ? d * 0.006 : THREE.MathUtils.clamp(notches(d), -3, 3) * (Math.PI / 12));
      return;
    }
    const pan = this.wheelMode === 'pan' || (this.wheelMode === 'auto' && pinched && smooth);
    if (pan) { this.panPixels(dx, dy); return; }
    // a sideways wheel or swipe that is not panning turns the view
    if (Math.abs(dx) > Math.abs(dy)) {
      this.turnBy(smooth ? dx * 0.006 : THREE.MathUtils.clamp(notches(dx), -3, 3) * (Math.PI / 12));
      return;
    }
    this.zoomBy(Math.exp(THREE.MathUtils.clamp(notches(dy) * 0.14, -0.45, 0.45)), e.clientX, e.clientY);
  }

  attach(el: HTMLElement) {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    this.el = el;
    const o = { signal: ac.signal };
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      this.keys.add(e.key.toLowerCase());
    }, o);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), o);
    window.addEventListener('blur', () => { this.keys.clear(); this.endDrag(); }, o);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.onWheel(e); }, { passive: false, signal: ac.signal });
    // Safari pinches and twists with gesture events instead of Ctrl + wheel
    let gScale = 1, gRot = 0;
    type GestureEv = Event & { scale: number; rotation: number; clientX: number; clientY: number };
    el.addEventListener('gesturestart', (e) => { e.preventDefault(); gScale = (e as GestureEv).scale; gRot = (e as GestureEv).rotation; pinched = true; }, o);
    el.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const g = e as GestureEv;
      if (performance.now() - this.lastPinch > 200 && g.scale > 0) this.zoomBy(gScale / g.scale, g.clientX, g.clientY);
      this.turnBy(((g.rotation - gRot) * Math.PI) / 180);
      gScale = g.scale;
      gRot = g.rotation;
    }, o);
    el.addEventListener('gestureend', (e) => e.preventDefault(), o);
    // no autoscroll on a middle press
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }, o);
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        el.setPointerCapture(e.pointerId);
        this.touchPin();
        return;
      }
      if (this.drag) return;
      // right: pan (or turn, as set), Alt/Option swaps it; middle: the other one; Alt/Option + left: turn
      const other = this.rightDrag === 'pan' ? 'orbit' : 'pan';
      const mode = e.button === 2 ? (e.altKey ? other : this.rightDrag) : e.button === 1 ? other : e.button === 0 && e.altKey ? 'orbit' : null;
      if (!mode) return;
      this.drag = mode;
      this.dragButton = e.button;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.travel = 0;
      this.anchor = null;
      if (this.drag === 'pan') {
        this.goal.copy(this.target);
        this.grab = this.pinAt(e.clientX, e.clientY);
      }
      el.setPointerCapture(e.pointerId);
    }, o);
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (!this.touches.has(e.pointerId)) return;
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.touchMove();
        return;
      }
      const r = el.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = (e.clientY - r.top) / r.height;
      this.mouse.inside = true;
      if (!this.drag) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.travel += Math.abs(dx) + Math.abs(dy);
      if (this.drag === 'orbit') {
        // grab the world and turn it: dragging right turns it right, dragging up tips it towards the horizon
        this.goalYaw -= dx * 0.006;
        this.goalTilt += dy * 0.004;
      } else if (this.grab) {
        const n = this.ndc(e.clientX, e.clientY);
        this.grab.x = n.x;
        this.grab.y = n.y;
      }
    }, o);
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touches.delete(e.pointerId);
        this.touchPin();
        return;
      }
      if (e.type === 'pointercancel') { this.endDrag(); return; }
      if (e.button !== this.dragButton) return;
      // a middle click without a drag turns the view back to north
      if (this.dragButton === 1 && this.travel < 4) this.resetView();
      this.endDrag();
    };
    el.addEventListener('pointerup', up, o);
    el.addEventListener('pointercancel', up, o);
    el.addEventListener('pointerleave', () => { this.mouse.inside = false; }, o);
    el.addEventListener('contextmenu', (e) => e.preventDefault(), o);
  }

  private endDrag() {
    this.drag = null;
    this.dragButton = -1;
    this.grab = null;
  }

  /** (Re)hold the ground under the fingers' midpoint whenever a finger lands or lifts. */
  private touchPin() {
    const pts = [...this.touches.values()];
    if (!pts.length) { this.grab = null; this.pinchDist = 0; return; }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    this.goal.copy(this.target);
    this.anchor = null;
    this.grab = this.pinAt(cx, cy);
    if (pts.length >= 2) {
      this.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchAng = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    } else this.pinchDist = 0;
  }

  private touchMove() {
    const pts = [...this.touches.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    if (this.grab) {
      const n = this.ndc(cx, cy);
      this.grab.x = n.x;
      this.grab.y = n.y;
    }
    if (pts.length >= 2 && this.pinchDist > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      if (d > 0) this.goalDist = THREE.MathUtils.clamp(this.goalDist * (this.pinchDist / d), this.minDist, this.maxDist);
      let da = ang - this.pinchAng;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.goalYaw += da;
      this.pinchDist = d;
      this.pinchAng = ang;
    }
  }

  detach() {
    this.abort?.abort();
    this.abort = null;
    this.keys.clear();
    this.endDrag();
    this.touches.clear();
  }

  get isDragging() {
    return this.drag !== null;
  }

  update(dt: number) {
    const k = this.inputEnabled ? this.keys : NO_KEYS;
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) mz -= 1;
    if (k.has('s') || k.has('arrowdown')) mz += 1;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    const mIn = this.mouse.x >= 0 && this.mouse.x <= 1 && this.mouse.y >= 0 && this.mouse.y <= 1;
    if (this.inputEnabled && this.edgeScroll && this.mouse.inside && mIn && !this.drag && document.hasFocus() && this.el) {
      // faster the nearer the pointer is to the very edge
      const W = this.el.clientWidth, H = this.el.clientHeight;
      const px = this.mouse.x * W, py = this.mouse.y * H;
      const ramp = (d: number) => (d < EDGE ? 0.35 + 0.65 * (1 - d / EDGE) : 0);
      mx += ramp(W - px) - ramp(px);
      mz += ramp(H - py) - ramp(py);
    }
    if (k.has('q')) this.goalYaw -= dt * 1.6;
    if (k.has('e')) this.goalYaw += dt * 1.6;
    if (k.has('+') || k.has('=')) this.goalDist = Math.max(this.minDist, this.goalDist * (1 - dt * 1.5));
    if (k.has('-') || k.has('_')) this.goalDist = Math.min(this.maxDist, this.goalDist * (1 + dt * 1.5));
    if (mx || mz) {
      const speed = this.dist * 1.25 * dt * this.scrollSpeed * (k.has('shift') ? 2.2 : 1);
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      this.goal.x += (mx * c + mz * s) * speed;
      this.goal.z += (-mx * s + mz * c) * speed;
    }
    if (this.cinematic) this.goalYaw += dt * 0.05;
    const W = this.world.W, H = this.world.H;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, 4, W - 4);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, 4, H - 4);
    const a = 1 - Math.exp(-dt * 10);
    this.target.x += (this.goal.x - this.target.x) * a;
    this.target.z += (this.goal.z - this.target.z) * a;
    const gy = this.world.surfaceAt(this.target.x, this.target.z);
    this.target.y += (gy - this.target.y) * (1 - Math.exp(-dt * 4));
    this.dist += (this.goalDist - this.dist) * (1 - Math.exp(-dt * 8));
    this.yaw += (this.goalYaw - this.yaw) * (1 - Math.exp(-dt * 8));
    const [lo, hi] = this.tiltRange(this.dist);
    this.goalTilt = THREE.MathUtils.clamp(this.goalTilt, lo, hi);
    this.tilt += (this.goalTilt - this.tilt) * (1 - Math.exp(-dt * 10));
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      this.shakeOff.set((Math.random() - 0.5) * this.shake * 0.3, (Math.random() - 0.5) * this.shake * 0.3);
    } else this.shakeOff.set(0, 0);
    this.place();
    // the grabbed ground follows the pointer; a wheel zoom keeps its spot under the pointer as it plays out
    const pin = this.grab ?? this.anchor;
    if (pin) {
      this.hold(pin);
      this.target.x = THREE.MathUtils.clamp(this.target.x, 4, W - 4);
      this.target.z = THREE.MathUtils.clamp(this.target.z, 4, H - 4);
      this.place();
      if (!this.grab && Math.abs(this.goalDist - this.dist) < this.dist * 0.002) this.anchor = null;
    }
  }

  private shakeOff = new THREE.Vector2();
  /** Put the camera where target, distance, yaw and pitch say. */
  private place() {
    const p = this.pitch;
    const off = this.tmp.set(Math.sin(this.yaw) * Math.cos(p), Math.sin(p), Math.cos(this.yaw) * Math.cos(p)).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(off);
    // keep camera above terrain
    const ch = this.world.surfaceAt(this.camera.position.x, this.camera.position.z) + 2;
    if (this.camera.position.y < ch) this.camera.position.y = ch;
    const look = this.tmp.copy(this.target);
    look.x += this.shakeOff.x;
    look.y += this.shakeOff.y;
    this.camera.lookAt(look);
    this.camera.updateMatrixWorld();
  }

  /** Ray-march the height field to find the ground point under screen coords (NDC). */
  pick(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const w = this.world;
    let t = 0;
    let prevT = 0;
    const step = 0.4;
    for (let i = 0; i < 1500; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (x < -5 || z < -5 || x > w.W + 5 || z > w.H + 5) {
        if (d.y >= 0) return null;
      }
      const h = w.surfaceAt(x, z);
      if (y <= h) {
        // bisection refine
        let a = prevT, b = t;
        for (let j = 0; j < 12; j++) {
          const m = (a + b) / 2;
          const yy = o.y + d.y * m;
          const hh = w.surfaceAt(o.x + d.x * m, o.z + d.z * m);
          if (yy <= hh) b = m; else a = m;
        }
        return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
      prevT = t;
      t += step;
    }
    return null;
  }
}
