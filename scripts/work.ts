// Headless check of the workers at work (src/render/work.ts): while a workshop produces, its worker
// is out in the yard in his scene; he walks rather than jumps; he is at the goods pile putting the
// good down when the stock goes up; a workshop waiting for an input has him sitting on its step, and
// a barracks recruit trains in the yard. The same game run without the director drawn must come
// out exactly the same: the director may never touch the game's numbers.
// Usage: npx tsx scripts/work.ts [seed] [minutes]
import * as THREE from 'three';
import { Game } from '../src/game/game';
import type { BuildingType, Good } from '../src/game/defs';
import type { Building, Settler } from '../src/game/types';
import { WorkDirector, WORK_TYPES, pileOf, type WorkView } from '../src/render/work';
import { buildGoodGeos } from '../src/render/models';
import { buildingBuilder } from '../src/render/buildingModels';
import { resetPose, type Pose } from '../src/render/idle';

const seed = Number(process.argv[2] ?? 7);
const MIN = Number(process.argv[3] ?? 6);
const P = 0;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

function put(g: Game, type: BuildingType, x: number, z: number): Building | null {
  const w = g.world;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  w.forRadius(x, z, 12, (_i, nx, ny, d2) => {
    if (d2 >= bd) return;
    const a = g.anchorFor(type, nx, ny);
    if (!g.canPlace(type, P, a.x, a.y)) return;
    bd = d2;
    best = a;
  });
  if (!best) return null;
  const a = best as { x: number; y: number };
  return g.addBuilding(type, P, a.x, a.y, true);
}

const TYPES: BuildingType[] = ['toolsmith', 'ironsmelter', 'goldsmelter', 'weaponsmith', 'sawmill', 'bakery', 'mill', 'slaughter', 'temple', 'siegeworks', 'barracks'];
function setup() {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
  g.ai.length = 0;
  const hq = g.buildings.get(g.players[P].hq)!;
  const placed: Building[] = [];
  const spots = [[7, 2], [-7, 3], [2, 8], [-3, -8], [8, -6], [-8, -5], [9, 7], [-9, 8], [0, 12], [12, 0], [-12, 0]];
  TYPES.forEach((t, i) => {
    const [dx, dz] = spots[i % spots.length];
    const b = put(g, t, hq.cx + dx, hq.cz + dz);
    if (b) placed.push(b);
  });
  const add: Partial<Record<Good, number>> = {
    iron: 30, coal: 40, ironore: 20, goldore: 20, log: 30, board: 30, flour: 20, water: 30, grain: 30, pig: 10, wine: 20,
    sword: 6, bow: 6, hammer: 12, saw: 4, pickaxe: 4, shovel: 4, bread: 20,
  };
  for (const [gd, n] of Object.entries(add)) hq.stock[gd as Good] += n!;
  // enough hands that the barracks may take recruits
  for (let k = 0; k < 14; k++) g.addSettler(P, 'carrier', hq.door);
  return { g, hq, placed };
}

const { g, placed } = setup();
const control = setup();

// stand-ins for the building renderer: the real anchors and moving parts of each design
const views = new Map<number, WorkView>();
const host = {
  workView(id: number): WorkView | null {
    const b = g.buildings.get(id);
    if (!b) return null;
    let v = views.get(id);
    if (!v) {
      const mb = buildingBuilder(b.type, b.owner);
      const movers: THREE.Object3D[] = [];
      for (const m of mb.movers) { const o = new THREE.Object3D(); o.name = m.name; o.position.copy(m.pos); movers.push(o); }
      views.set(id, (v = { y: b.targetH, anchors: mb.anchors, movers, visible: true }));
    }
    return v;
  },
};
const dir = new WorkDirector(g, 1.3, buildGoodGeos());
dir.host = host;
dir.force = true;
let sounds = 0;
dir.sound = () => { sounds++; };
const pose = resetPose({} as Pose);
const I = new THREE.Matrix4();

interface Track { frames: number; shown: number; lastX: number; lastZ: number; jumps: number; maxSpeed: number; nan: number; atPile: number; produced: number; far: number }
const track = new Map<number, Track>();
const tr = (b: Building) => {
  let t = track.get(b.id);
  if (!t) track.set(b.id, (t = { frames: 0, shown: 0, lastX: NaN, lastZ: NaN, jumps: 0, maxSpeed: 0, nan: 0, atPile: 0, produced: 0, far: 0 }));
  return t;
};
const pace = new Map<string, number>();
let recruitFrames = 0, recruitShown = 0, waitFrames = 0, waitSitting = 0;

const DT = 0.1;
const states = (dir as any).states as Map<number, any>;
for (let t = 0; t < MIN * 60; t += DT) {
  g.update(DT);
  // stock rises at the end of a cycle: the worker must be at the pile, finishing his last beat
  for (const e of g.events) {
    if (e.type !== 'produced' || e.b === undefined) continue;
    const b = g.buildings.get(e.b);
    if (!b || !WORK_TYPES.includes(b.type) || !e.good) continue;
    const st = states.get(b.id), v = host.workView(b.id);
    if (!st || !v) continue;
    const k = tr(b);
    k.produced++;
    const p = pileOf(b, v.anchors.piles[0], e.good);
    if (Math.hypot(st.x - p.x, st.z - p.z) < 0.45) k.atPile++;
  }
  g.events.length = 0;
  control.g.update(DT);
  control.g.events.length = 0;
  dir.begin();
  for (const s of g.settlers.values()) {
    if (!s.hidden || !s.inside) continue;
    const b = g.buildings.get(s.inside);
    if (!b || !WORK_TYPES.includes(b.type)) continue;
    const recruit = b.type === 'barracks';
    if (!recruit && b.worker !== s.id) continue;
    const shot = dir.shot(s as Settler, pose);
    if (shot) dir.props(I, I, I);
    if (recruit) {
      const a = s.actions[0];
      if (a && a.k === 'wait') { recruitFrames++; if (shot) recruitShown++; }
      continue;
    }
    const k = tr(b);
    const st = states.get(b.id);
    if (b.working) {
      k.frames++;
      // indoors on purpose counts too: the miller up in his tower, the butcher at his work inside
      if (shot || (st?.hidden && st.mode === 'scene')) k.shown++;
      if (shot && st.beat >= 0) {
        const key = `${b.type} beat ${st.beat}`;
        if (Number.isFinite(k.lastX)) pace.set(key, Math.max(pace.get(key) ?? 0, Math.hypot(shot.x - b.cx - k.lastX, shot.z - b.cz - k.lastZ) / DT));
      }
    }
    if (b.stall?.kind === 'input' && g.time - b.stallT > 4) {
      waitFrames++;
      if (shot && st.mode === 'wait') waitSitting++;
    }
    if (!shot) { k.lastX = NaN; continue; }
    const x = shot.x - b.cx, z = shot.z - b.cz;
    if (!Number.isFinite(shot.x + shot.y + shot.z + shot.heading)) k.nan++;
    if (Math.abs(x) > b.size / 2 + 0.9 || Math.abs(z) > b.size / 2 + 1.2) k.far++;
    if (Number.isFinite(k.lastX)) {
      const sp = Math.hypot(x - k.lastX, z - k.lastZ) / DT;
      k.maxSpeed = Math.max(k.maxSpeed, sp);
      if (sp > 4) k.jumps++;
    }
    k.lastX = x; k.lastZ = z;
  }
  dir.end();
}

const name = (id: number) => g.buildings.get(id)?.type ?? `#${id}`;
console.log(`seed ${seed}, ${MIN} min, ${placed.length} workshops placed: ${placed.map((b) => b.type).join(', ')}`);
for (const [id, k] of track) {
  console.log(`  ${name(id).padEnd(12)} working ${(k.frames * DT).toFixed(0).padStart(4)} s, out in the yard ${(100 * k.shown / Math.max(1, k.frames)).toFixed(0)}%, ` +
    `goods ${k.produced} (at the pile ${k.atPile}), fastest ${k.maxSpeed.toFixed(2)}/s, jumps ${k.jumps}, strays ${k.far}`);
}
console.log('  fastest beats:', [...pace].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
const worked = [...track.values()].filter((k) => k.frames > 100);
check(worked.length >= 6, `at least six kinds of workshop were at work (${worked.length})`);
check(worked.every((k) => k.shown >= k.frames * 0.9), 'a working workshop has its worker out in the yard (the odd frame indoors aside)');
check([...track.values()].every((k) => k.nan === 0), 'no NaN positions or headings');
check([...track.values()].every((k) => k.jumps === 0 && k.maxSpeed < 3.2), 'workers walk from spot to spot at a walking pace, they never jump');
check([...track.values()].every((k) => k.far === 0), 'workers stay in their own yard');
const prod = [...track.values()].reduce((a, k) => a + k.produced, 0), at = [...track.values()].reduce((a, k) => a + k.atPile, 0);
check(prod > 20 && at >= prod * 0.95, `the worker is at the pile when the good lands on it (${at}/${prod})`);
check(recruitFrames === 0 || recruitShown >= recruitFrames * 0.9, `recruits train in the barracks yard (${recruitShown}/${recruitFrames} frames)`);
check(waitFrames === 0 || waitSitting >= waitFrames * 0.95, `a workshop waiting for an input has its worker sitting on the step (${waitSitting}/${waitFrames} frames)`);
check(sounds > 50, `the work makes its noises (${sounds})`);

// the same game without the director: every number must match
const sig = (gm: Game) => JSON.stringify({
  t: gm.time.toFixed(3),
  s: [...gm.settlers.values()].map((s) => [s.id, s.node, s.x.toFixed(4), s.z.toFixed(4), s.carrying, s.hidden]),
  b: [...gm.buildings.values()].map((b) => [b.id, b.workT.toFixed(4), b.working, b.prodCount, Object.values(b.stock).join()]),
  r: gm.rng.next(),
});
check(sig(g) === sig(control.g), 'the game runs exactly the same with the workers drawn');

// out of view: moving parts go back to rest
dir.begin();
dir.end();
dir.begin();
dir.end();
let restless = 0;
for (const v of views.values()) for (const o of v.movers) { const r = o.userData.rest; if (r && (o.position.distanceTo(r.p) > 1e-6 || Math.abs(o.rotation.x - r.r.x) + Math.abs(o.rotation.z - r.r.z) > 1e-6 || !o.visible)) restless++; }
check(restless === 0, 'moving parts are put back at rest when their workshop leaves the view');
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
