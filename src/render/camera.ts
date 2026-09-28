// RTS camera: smooth pan / zoom / rotate, zoom-dependent pitch.
import * as THREE from 'three';
import type { World } from '../game/world';

const NO_KEYS = new Set<string>();

export class RTSCamera {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  dist = 30;
  private goalDist = 30;
  yaw = 0;
  private goalYaw = 0;
  minDist = 9;
  maxDist = 95;
  keys = new Set<string>();
  edgeScroll = true;
  /** multiplier on keyboard and edge scrolling */
  scrollSpeed = 1;
  /** false while a menu is open: held keys and the screen edge stop moving the view */
  inputEnabled = true;
  mouse = { x: 0.5, y: 0.5, inside: false };
  private dragging = false;
  private dragButton = -1;
  private lastX = 0;
  private lastY = 0;
  shake = 0;
  cinematic = false;

  constructor(private world: World, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.5, 600);
  }

  get pitch() {
    const z = (this.dist - this.minDist) / (this.maxDist - this.minDist);
    return THREE.MathUtils.lerp(0.72, 1.08, Math.pow(z, 0.7));
  }

  jumpTo(x: number, z: number, instant = false) {
    this.goal.set(x, 0, z);
    if (instant) this.target.copy(this.goal);
  }

  zoomTo(d: number, instant = false) {
    this.goalDist = THREE.MathUtils.clamp(d, this.minDist, this.maxDist);
    if (instant) this.dist = this.goalDist;
  }

  get viewSize() {
    return this.dist * 1.1;
  }

  private abort: AbortController | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  attach(el: HTMLElement) {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    const o = { signal: ac.signal };
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      this.keys.add(e.key.toLowerCase());
    }, o);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), o);
    window.addEventListener('blur', () => this.keys.clear(), o);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0012);
      this.goalDist = THREE.MathUtils.clamp(this.goalDist * f, this.minDist, this.maxDist);
    }, { passive: false, signal: ac.signal });
    const pan = (dx: number, dy: number) => {
      const s = this.dist * 0.0022;
      const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      this.goal.x -= (dx * c + dy * sn) * s;
      this.goal.z -= (-dx * sn + dy * c) * s;
      this.target.copy(this.goal);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        el.setPointerCapture(e.pointerId);
        if (this.touches.size === 2) {
          const [a, b] = [...this.touches.values()];
          this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
        return;
      }
      if (e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.dragButton = e.button;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
      }
    }, o);
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        const prev = this.touches.get(e.pointerId);
        if (!prev) return;
        if (this.touches.size === 1) pan(e.clientX - prev.x, e.clientY - prev.y);
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 2) {
          const [a, b] = [...this.touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinchDist > 0) this.goalDist = THREE.MathUtils.clamp(this.goalDist * (this.pinchDist / d), this.minDist, this.maxDist);
          this.pinchDist = d;
        }
        return;
      }
      const r = el.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = (e.clientY - r.top) / r.height;
      this.mouse.inside = true;
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.dragButton === 1 && e.altKey) {
        this.goalYaw += dx * 0.005;
        return;
      }
      pan(dx, dy);
    }, o);
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touches.delete(e.pointerId);
        this.pinchDist = 0;
        return;
      }
      if (e.button === this.dragButton) this.dragging = false;
    };
    el.addEventListener('pointerup', up, o);
    el.addEventListener('pointercancel', up, o);
    el.addEventListener('pointerleave', () => { this.mouse.inside = false; }, o);
    el.addEventListener('contextmenu', (e) => e.preventDefault(), o);
  }

  detach() {
    this.abort?.abort();
    this.abort = null;
    this.keys.clear();
  }

  get isDragging() {
    return this.dragging;
  }

  update(dt: number) {
    const k = this.inputEnabled ? this.keys : NO_KEYS;
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) mz -= 1;
    if (k.has('s') || k.has('arrowdown')) mz += 1;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    const mIn = this.mouse.x >= 0 && this.mouse.x <= 1 && this.mouse.y >= 0 && this.mouse.y <= 1;
    if (this.inputEnabled && this.edgeScroll && this.mouse.inside && mIn && !this.dragging && document.hasFocus()) {
      const m = 0.012;
      if (this.mouse.x < m) mx -= 1;
      if (this.mouse.x > 1 - m) mx += 1;
      if (this.mouse.y < m) mz -= 1;
      if (this.mouse.y > 1 - m) mz += 1;
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

    const p = this.pitch;
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(p), Math.sin(p), Math.cos(this.yaw) * Math.cos(p)).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(off);
    // keep camera above terrain
    const ch = this.world.surfaceAt(this.camera.position.x, this.camera.position.z) + 2;
    if (this.camera.position.y < ch) this.camera.position.y = ch;
    const look = this.target.clone();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      look.x += (Math.random() - 0.5) * this.shake * 0.3;
      look.y += (Math.random() - 0.5) * this.shake * 0.3;
    }
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
