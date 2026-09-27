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

  constructor(private world: World) {
    const N = world.N;
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
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
    if (!adj && !walk(goal)) {
      // allow walking into non walkable goal only if it's a building door etc: treat as adj fallback
      return null;
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
}
