// A* pathfinding on the 8-connected node grid.
import { MinHeap } from '../core/heap';
import { DX8, DY8, World } from './world';

const SQRT2 = Math.SQRT2;

export class PathFinder {
  private g: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap = new MinHeap(4096);
  expansions = 0;
  /**
   * Which walkable nodes reach one another: one label for each area of them joined side by side (a
   * diagonal step needs both of its corners walkable, so the 8-way search keeps to these areas), 0
   * where nothing can stand. A walk to a target in another area fails at once instead of flooding
   * the whole of its own (a tree or a hare walled in by rocks). Worked out again on the first search
   * after the world's walkVersion moves.
   */
  private reach: Int32Array;
  private reachVersion = -1;
  private reachStack: number[] = [];

  constructor(private world: World) {
    const N = world.N;
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.reach = new Int32Array(N);
  }

  private labels() {
    const w = this.world;
    if (this.reachVersion === w.walkVersion) return this.reach;
    this.reachVersion = w.walkVersion;
    const W = w.W, H = w.H, N = w.N, out = this.reach, stack = this.reachStack;
    out.fill(0);
    let id = 0;
    for (let i = 0; i < N; i++) {
      if (out[i] || !w.walkable(i)) continue;
      out[i] = ++id;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % W, cy = (c / W) | 0;
        if (cx > 0 && !out[c - 1] && w.walkable(c - 1)) { out[c - 1] = id; stack.push(c - 1); }
        if (cx < W - 1 && !out[c + 1] && w.walkable(c + 1)) { out[c + 1] = id; stack.push(c + 1); }
        if (cy > 0 && !out[c - W] && w.walkable(c - W)) { out[c - W] = id; stack.push(c - W); }
        if (cy < H - 1 && !out[c + W] && w.walkable(c + W)) { out[c + W] = id; stack.push(c + W); }
      }
    }
    return out;
  }

  /**
   * Find path from start to goal. If adj is true, any walkable 8-neighbour of goal
   * (or the goal itself if walkable) counts as reaching it.
   * Returns list of nodes excluding start, or null.
   */
  find(start: number, goal: number, adj = false, maxExpand = 40000, walkFn?: (i: number) => boolean): number[] | null {
    const w = this.world;
    const W = w.W, H = w.H;
    if (start === goal) return [];
    // a settler trapped inside a footprint may walk out through that same footprint
    const startB = w.blocked[start] ? w.building[start] : 0;
    const walk = walkFn ?? (startB
      ? (i: number) => w.walkable(i) || (w.building[i] === startB && !w.isWater(i))
      : (i: number) => w.walkable(i));
    const gx = w.nx(goal), gy = w.ny(goal);

    // goal test
    const isGoal = (i: number) => {
      if (i === goal) return true;
      if (!adj) return false;
      const dx = Math.abs(w.nx(i) - gx), dy = Math.abs(w.ny(i) - gy);
      return dx <= 1 && dy <= 1;
    };
    if (adj && isGoal(start)) return [];
    // no land route between two landmasses: fail fast instead of flooding the whole island
    if (!walkFn) {
      const rs = w.region[start], rg = adj ? w.regionAt(goal) : w.region[goal];
      if (rs && rg && rs !== rg) return null;
    }
    if (!adj && !walk(goal)) {
      // allow walking into non walkable goal only if it's a building door etc: treat as adj fallback
      return null;
    }
    // (from a walkable node the search keeps to its area: no node of it at or beside the goal, no path)
    if (!walkFn && !startB && w.walkable(start)) {
      const lab = this.labels(), ls = lab[start];
      if (!adj) { if (lab[goal] !== ls) return null; }
      else {
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx, y = gy + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === ls) { near = true; break; }
        }
        if (!near) return null;
      }
    }
    // An adjacent walk may target a cell covered by a building. With no legal
    // endpoint, searching the entire island only proves what these nine cells already tell
    // us. Use the same footprint-escape rule as the search; custom walkers keep their own
    // evaluation order. Check afresh each time so removing the obstruction works at once.
    if (adj && !walkFn && !walk(goal)) {
      let open = false;
      for (let d = 0; d < 8; d++) {
        const x = gx + DX8[d], y = gy + DY8[d];
        if (x >= 0 && y >= 0 && x < W && y < H && walk(y * W + x)) { open = true; break; }
      }
      if (!open) return null;
    }

    const gen = ++this.gen;
    if (gen > 0xfffffff0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const g = this.g, from = this.from, seen = this.seen, closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const hfun = (i: number) => {
      const dx = Math.abs(w.nx(i) - gx), dy = Math.abs(w.ny(i) - gy);
      const mn = dx < dy ? dx : dy, mx = dx < dy ? dy : dx;
      return mn * SQRT2 + (mx - mn);
    };
    g[start] = 0;
    seen[start] = gen;
    from[start] = -1;
    heap.push(start, hfun(start));
    let expanded = 0;
    const hh = w.h;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (isGoal(cur)) {
        const path: number[] = [];
        let c = cur;
        while (c !== start) {
          path.push(c);
          c = from[c];
        }
        path.reverse();
        this.expansions += expanded;
        return path;
      }
      if (++expanded > maxExpand) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const gc = g[cur];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        if (!walk(ni)) continue;
        if (d >= 4) {
          // no corner cutting
          if (!walk(cy * W + nx) || !walk(ny * W + cx)) continue;
        }
        const dh = hh[ni] - hh[cur];
        const cost = (d >= 4 ? SQRT2 : 1) * (1 + (dh > 0 ? dh * 0.9 : -dh * 0.25)) + w.wear[ni] * -0.08;
        const ng = gc + Math.max(0.5, cost);
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          from[ni] = cur;
          heap.push(ni, ng + hfun(ni) * 1.001);
        }
      }
    }
    this.expansions += expanded;
    return null;
  }

  /**
   * Sea route over navigable water. Ships prefer open water: nodes close to the shore cost more.
   * Returns the node path including start, or null.
   */
  findSea(start: number, goal: number, maxExpand = 60000): number[] | null {
    const w = this.world;
    const W = w.W, H = w.H;
    if (!w.navigable(start) || !w.navigable(goal) || w.sea[start] !== w.sea[goal]) return null;
    if (start === goal) return [start];
    const gen = ++this.gen;
    const g = this.g, from = this.from, seen = this.seen, closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const gx = w.nx(goal), gy = w.ny(goal);
    const hfun = (i: number) => {
      const dx = Math.abs(w.nx(i) - gx), dy = Math.abs(w.ny(i) - gy);
      const mn = dx < dy ? dx : dy, mx = dx < dy ? dy : dx;
      return mn * SQRT2 + (mx - mn);
    };
    g[start] = 0;
    seen[start] = gen;
    from[start] = -1;
    heap.push(start, hfun(start));
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) {
        const path: number[] = [];
        for (let c = cur; c !== -1; c = from[c]) path.push(c);
        path.reverse();
        return path;
      }
      if (++expanded > maxExpand) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen || !w.navigable(ni)) continue;
        if (d >= 4 && (!w.navigable(cy * W + nx) || !w.navigable(ny * W + cx))) continue;
        const sd = w.shoreDist[ni];
        const shore = sd <= 1 ? 2.5 : sd === 2 ? 0.9 : sd === 3 ? 0.3 : 0;
        const ng = g[cur] + (d >= 4 ? SQRT2 : 1) * (1 + shore);
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          from[ni] = cur;
          heap.push(ni, ng + hfun(ni));
        }
      }
    }
    return null;
  }
}
