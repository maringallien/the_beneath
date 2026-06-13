import type { NavGraph } from './NavGraph';

/**
 * NavPathfinder — plain, dependency-free A* over a NavGraph.
 *
 * Open set is a binary min-heap with lazy deletion (a node may be re-pushed at an
 * improving priority; a closed set drops the stale pops). The heuristic is the
 * Euclidean distance in world px — admissible because it never overestimates the
 * walk distance and jump edges only cost MORE. A hard expansion cap makes a
 * hopeless query (no route, or a goal walled off) bail in bounded time rather
 * than scan the whole world.
 *
 * Inputs:  a built NavGraph plus start/goal node ids and an expansion budget.
 * Outputs: the inclusive node-id path, or null when unreachable within budget.
 * @calledby the enemy navigation layer, when a chaser needs a route around walls.
 * @calls    only the graph's node and edge accessors.
 */

// Min-heap with parallel id/priority arrays; lazy deletion — stale pops are skipped by the closed set.
class MinHeap {
  private readonly ids: number[] = [];
  private readonly prio: number[] = [];

  // Number of entries currently in the heap.
  size(): number {
    return this.ids.length;
  }

  // Inserts id at priority p and sifts up to restore heap order.
  push(id: number, p: number): void {
    this.ids.push(id);
    this.prio.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  // Removes and returns the lowest-priority id; caller must guard size() > 0.
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop() as number;
    const lastP = this.prio.pop() as number;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.prio[0] = lastP;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < n && this.prio[l] < this.prio[s]) s = l;
        if (r < n && this.prio[r] < this.prio[s]) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }

  // Swaps the id+priority pair at index `a` with the pair at index `b`.
  private swap(a: number, b: number): void {
    const ti = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = ti;
    const tp = this.prio[a];
    this.prio[a] = this.prio[b];
    this.prio[b] = tp;
  }
}

// Admissible A* heuristic: straight-line world-px distance from node `id` to the goal.
function heuristic(graph: NavGraph, id: number, goalX: number, goalY: number): number {
  const n = graph.node(id);
  return Math.hypot(n.x - goalX, n.y - goalY);
}

// Walks the came-from chain and returns the start→end node-id path.
function reconstruct(cameFrom: Map<number, number>, end: number): number[] {
  const path = [end];
  let c = end;
  for (;;) {
    const prev = cameFrom.get(c);
    if (prev === undefined) break;
    path.push(prev);
    c = prev;
  }
  path.reverse();
  return path;
}

// A* from start to goal; returns the inclusive node-id path or null if unreachable within the expansion budget.
export function findPath(
  graph: NavGraph,
  start: number,
  goal: number,
  maxExpansions: number,
): number[] | null {
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [start];
  const goalNode = graph.node(goal);
  const open = new MinHeap();
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  gScore.set(start, 0);
  open.push(start, heuristic(graph, start, goalNode.x, goalNode.y));
  let expansions = 0;
  while (open.size() > 0) {
    const current = open.pop();
    if (current === goal) return reconstruct(cameFrom, current);
    if (closed.has(current)) continue;
    closed.add(current);
    if (++expansions > maxExpansions) return null;
    const gCur = gScore.get(current) as number;
    for (const e of graph.getEdges(current)) {
      if (closed.has(e.to)) continue;
      const tentative = gCur + e.cost;
      const known = gScore.get(e.to);
      if (known === undefined || tentative < known) {
        gScore.set(e.to, tentative);
        cameFrom.set(e.to, current);
        open.push(e.to, tentative + heuristic(graph, e.to, goalNode.x, goalNode.y));
      }
    }
  }
  return null;
}
