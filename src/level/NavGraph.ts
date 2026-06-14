import { GRAVITY_Y, PLAYER_JUMP_VELOCITY, PLAYER_RUN_SPEED } from '../constants';
import {
  type ArcContext,
  type LevelBounds,
  type SolidAt,
  TILE_PX,
  collectLeapLandings,
} from './navProbe';

/**
 * @file level/NavGraph.ts
 * @description Platformer navigation graph from the LDtk IntGrid collision: nodes are standable tile cells (empty cell, floor below, body headroom); edges are WALK (same-row or a one-tile step, cross-level aware) and JUMP (ballistic arcs from the same physics probe the live enemy uses, so a planned jump is always one the body can land); A* (NavPathfinder) searches it and the enemy follows the node path with its hop/leap/mount locomotion; the NODE pass is eager and cheap (a few O(1) csv lookups per cell across every level) while EDGES are computed lazily per node and memoized, paying the expensive ballistic probing only for nodes A* actually expands (cross-level walk edges work because every node exists before any edge is computed).
 * @module level
 */

// One LDtk level's collision grid, positioned in world space.
export interface NavLevel {
  readonly worldX: number;
  readonly worldY: number;
  readonly cWid: number;
  readonly cHei: number;
  readonly gridSize: number;
  readonly csv: ReadonlyArray<number>;
}

export interface NavNode {
  readonly id: number;
  readonly x: number; // world px — cell center x (a foot's horizontal position)
  readonly y: number; // world px — foot y (top of the floor tile below the cell)
}

export interface NavEdge {
  readonly to: number;
  readonly cost: number;
  readonly kind: 'walk' | 'jump';
}

// ── Graph build tuning ─────────────────────────────────────────────────────
// Canonical body, jump-cost bias, leap launch speed, and snap radius used when planning edges and
// resolving a world point to a node; the executing enemy re-validates every jump with its own body.
const NAV_BODY_W = 14;
const NAV_BODY_H = 26;
// Jump edges cost more than walking so A* only routes a jump when it genuinely shortcuts the path.
const NAV_JUMP_COST_MULT = 2.5;
// Horizontal launch speed for jump-edge probing; matches the enemy's leap-speed floor.
const NAV_LEAP_VX = PLAYER_RUN_SPEED;
// Tile radius nodeAt() searches outward when the world point doesn't sit on a node cell.
const NAV_SNAP_RADIUS_TILES = 3;

/** Packs world grid coords into one number; ±32768 offset covers a ~0.5M px world. */
function packCell(gx: number, gy: number): number {
  return (gx + 32768) * 65536 + (gy + 32768);
}

/**
 * @function    makeLevelSolid
 * @description Builds a solidity predicate for one level's IntGrid csv; out-of-level samples return false so arcs stay within the level.
 * @param   lvl  One NavLevel: world origin, cell dims, grid size, IntGrid csv.
 * @returns a SolidAt closure mapping a world (x, y) to true when the covering cell is non-zero, false outside the level.
 * @calledby src/level/NavGraph.ts → the NavGraph constructor, once per level to capture its collision lookup
 * @calls    pure csv indexing inside the returned closure; no delegation
 */
function makeLevelSolid(lvl: NavLevel): SolidAt {
  const { worldX, worldY, cWid, cHei, gridSize, csv } = lvl;
  return (x: number, y: number): boolean => {
    const gx = Math.floor((x - worldX) / gridSize);
    const gy = Math.floor((y - worldY) / gridSize);
    if (gx < 0 || gy < 0 || gx >= cWid || gy >= cHei) return false;
    return csv[gy * cWid + gx] !== 0;
  };
}

export class NavGraph {
  private readonly nodes: NavNode[] = [];
  private readonly nodeLevel: number[] = []; // level index per node (for edge gen)
  private readonly cellToNode = new Map<number, number>();
  private readonly edgeCache: (NavEdge[] | undefined)[] = [];
  private readonly levelSolid: SolidAt[] = [];
  private readonly levelBounds: LevelBounds[] = [];
  private builtNodes = false;

  /**
   * @function    constructor
   * @description Precomputes per-level bounds and solidity predicates; node/edge caches stay empty and build lazily on first query.
   * @param   levels  The per-level collision grids, positioned in world space.
   * @calledby src/scenes/GameScene.ts → buildNavGraph (new NavGraph at level load, when the world's collision is ready)
   * @calls    the per-level solidity-predicate builder
   */
  constructor(private readonly levels: ReadonlyArray<NavLevel>) {
    for (const lvl of levels) {
      this.levelBounds.push({
        worldX: lvl.worldX,
        worldY: lvl.worldY,
        pxWid: lvl.cWid * lvl.gridSize,
        pxHei: lvl.cHei * lvl.gridSize,
      });
      this.levelSolid.push(makeLevelSolid(lvl));
    }
  }

  /**
   * @function    buildNodes
   * @description Eager pass registering a node for every standable cell across all levels; idempotent (no-op after the first call).
   * @calledby src/level/NavGraph.ts → nodeCount / getNodes / nodeAt, on the first query against the graph
   * @calls    src/level/NavGraph.ts → standable per cell and the cell-packing key
   */
  buildNodes(): void {
    if (this.builtNodes) return;
    this.builtNodes = true;
    for (let li = 0; li < this.levels.length; li++) {
      const lvl = this.levels[li];
      const solid = this.levelSolid[li];
      for (let cy = 0; cy < lvl.cHei; cy++) {
        for (let cx = 0; cx < lvl.cWid; cx++) {
          const wx = lvl.worldX + (cx + 0.5) * lvl.gridSize;
          const wy = lvl.worldY + (cy + 0.5) * lvl.gridSize;
          if (!this.standable(solid, wx, wy)) continue;
          const key = packCell(Math.floor(wx / TILE_PX), Math.floor(wy / TILE_PX));
          if (this.cellToNode.has(key)) continue;
          const id = this.nodes.length;
          this.nodes.push({
            id,
            x: wx,
            y: lvl.worldY + (cy + 1) * lvl.gridSize,
          });
          this.nodeLevel.push(li);
          this.cellToNode.set(key, id);
        }
      }
    }
  }

  /**
   * @function    standable
   * @description True if the cell is empty, has a solid floor one tile below, and clear headroom for the body.
   * @param   solid   The level's solidity predicate.
   * @param   wx, wy  World-px cell center.
   * @returns whether a body can stand in this cell.
   * @calledby src/level/NavGraph.ts → buildNodes, filtering cells down to standable ones
   * @calls    the solidity predicate at the cell, the floor below, and up the body's height
   */
  private standable(solid: SolidAt, wx: number, wy: number): boolean {
    if (solid(wx, wy)) return false;
    if (!solid(wx, wy + TILE_PX)) return false;
    for (let up = TILE_PX; up < NAV_BODY_H; up += TILE_PX) {
      if (solid(wx, wy - up)) return false;
    }
    return true;
  }

  // Total standable node count (builds the node pass on first call).
  nodeCount(): number {
    this.buildNodes();
    return this.nodes.length;
  }

  // The node with this id (assumes a valid, already-built id).
  node(id: number): NavNode {
    return this.nodes[id];
  }

  // All nodes (builds the node pass on first call).
  getNodes(): ReadonlyArray<NavNode> {
    this.buildNodes();
    return this.nodes;
  }

  /**
   * @function    getEdges
   * @description Returns a node's outgoing edges, computing and memoizing them on the first request.
   * @param   id  Node id (assumed valid).
   * @returns the node's outgoing edges.
   * @calledby src/level/NavPathfinder.ts → A* search, each time it expands a node
   * @calls    src/level/NavGraph.ts → computeEdges, on a cache miss
   */
  getEdges(id: number): ReadonlyArray<NavEdge> {
    const cached = this.edgeCache[id];
    if (cached) return cached;
    const edges = this.computeEdges(id);
    this.edgeCache[id] = edges;
    return edges;
  }

  /**
   * @function    computeEdges
   * @description Walk edges to left/right/step neighbours (cross-level aware) plus jump edges to distinct ballistic landings off each side, deduplicated.
   * @param   id  Node id to expand.
   * @returns the node's outgoing walk + jump edges.
   * @calledby src/level/NavGraph.ts → getEdges, on the first request for a node
   * @calls    the cell-to-node index for walk neighbours and src/level/navProbe.ts → collectLeapLandings for jump landings
   */
  private computeEdges(id: number): NavEdge[] {
    const node = this.nodes[id];
    const li = this.nodeLevel[id];
    const edges: NavEdge[] = [];
    const seen = new Set<number>();
    const gx = Math.floor(node.x / TILE_PX);
    const gyFoot = Math.floor((node.y - TILE_PX / 2) / TILE_PX);

    // Walk edges: neighbors one cell left/right on the same row or a step up/down; cross-level automatically.
    for (const ndir of [-1, 1] as const) {
      for (const dgy of [0, -1, 1] as const) {
        const to = this.cellToNode.get(packCell(gx + ndir, gyFoot + dgy));
        if (to === undefined || to === id || seen.has(to)) continue;
        seen.add(to);
        const t = this.nodes[to];
        const dist = Math.hypot(t.x - node.x, t.y - node.y);
        edges.push({ to, cost: dist + (dgy !== 0 ? TILE_PX : 0), kind: 'walk' });
      }
    }

    // Jump edges: all distinct ballistic landings off each side using level-local solidity.
    const ctx: ArcContext = {
      solidAt: this.levelSolid[li],
      bounds: this.levelBounds[li],
      gravityY: GRAVITY_Y,
      bodyW: NAV_BODY_W,
      bodyH: NAV_BODY_H,
    };
    const centerY = node.y - NAV_BODY_H / 2;
    for (const dir of [-1, 1] as const) {
      const landings = collectLeapLandings(
        ctx,
        node.x,
        centerY,
        dir,
        NAV_LEAP_VX,
        PLAYER_JUMP_VELOCITY,
      );
      for (const lp of landings) {
        const to = this.nodeForFoot(lp.x, lp.y);
        if (to === undefined || to === id || seen.has(to)) continue;
        seen.add(to);
        const t = this.nodes[to];
        const dist = Math.hypot(t.x - node.x, t.y - node.y);
        edges.push({
          to,
          cost: dist * NAV_JUMP_COST_MULT + TILE_PX,
          kind: 'jump',
        });
      }
    }
    return edges;
  }

  /**
   * @function    nodeForFoot
   * @description Node whose cell covers a landing foot point (nudges y up half a tile to find the cell), or undefined if none.
   * @param   footX, footY  World px of a landing foot point.
   * @returns the covering node id, or undefined when no node sits there.
   * @calledby src/level/NavGraph.ts → computeEdges, mapping each ballistic landing back to a node
   * @calls    the cell-packing key and the cell-to-node index
   */
  private nodeForFoot(footX: number, footY: number): number | undefined {
    return this.cellToNode.get(
      packCell(
        Math.floor(footX / TILE_PX),
        Math.floor((footY - TILE_PX / 2) / TILE_PX),
      ),
    );
  }

  /**
   * @function    nodeAt
   * @description Snaps a world point to the nearest standable node, searching outward ring by ring; -1 if none within the snap radius.
   * @param   worldX, worldY  World px to snap.
   * @returns the nearest node id within the snap radius, or -1.
   * @calledby src/scenes/GameScene.ts → findEnemyPath, resolving an enemy/target position to a node
   * @calls    src/level/NavGraph.ts → buildNodes, then the cell-to-node index over expanding tile rings
   */
  nodeAt(worldX: number, worldY: number): number {
    this.buildNodes();
    const gx0 = Math.floor(worldX / TILE_PX);
    const gy0 = Math.floor(worldY / TILE_PX);
    for (let r = 0; r <= NAV_SNAP_RADIUS_TILES; r++) {
      let best = -1;
      let bestDist = Infinity;
      for (let dgy = -r; dgy <= r; dgy++) {
        for (let dgx = -r; dgx <= r; dgx++) {
          if (Math.max(Math.abs(dgx), Math.abs(dgy)) !== r) continue; // ring only
          const to = this.cellToNode.get(packCell(gx0 + dgx, gy0 + dgy));
          if (to === undefined) continue;
          const n = this.nodes[to];
          const d = Math.hypot(n.x - worldX, n.y - worldY);
          if (d < bestDist) {
            bestDist = d;
            best = to;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
}
