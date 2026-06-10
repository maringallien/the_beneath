// Platformer navigation graph built from the LDtk IntGrid collision. Nodes are
// "standable" tile cells (an empty cell with a floor below and body headroom);
// edges are the moves a grounded enemy can make between them — WALK (same-row or
// a one-tile step, cross-level aware) and JUMP (ballistic arcs found by the same
// physics probe the live enemy uses, so a planned jump is always one the body can
// land). A* (NavPathfinder) searches this graph; the enemy then follows the node
// path with its existing hop/leap/mount locomotion.
//
// Build strategy: the NODE pass is eager and cheap (a few O(1) csv lookups per
// cell across every level). EDGES are computed lazily per node and memoized, so
// the expensive ballistic edge probing is paid only for nodes A* actually
// expands, and cross-level walk edges work because every node already exists
// before any edge is computed.

import { GRAVITY_Y, PLAYER_JUMP_VELOCITY, PLAYER_RUN_SPEED } from '../constants';
import {
  type ArcContext,
  type LevelBounds,
  type SolidAt,
  TILE_PX,
  collectLeapLandings,
} from './navProbe';

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

// Canonical body the graph is built for. The executing enemy re-validates every
// jump with its OWN body via Enemy.findLeapLanding, so this only needs to be a
// reasonable representative — a slightly-off body just means the occasional
// waypoint the real enemy re-solves locally or falls back from.
const NAV_BODY_W = 14;
const NAV_BODY_H = 26;
// Jump edges cost more than the equivalent-distance walk, so A* prefers walking
// and only routes a jump when it genuinely shortcuts the path.
const NAV_JUMP_COST_MULT = 2.5;
// Horizontal launch speed used when probing jump arcs for edges — matches the
// enemy's leap-speed floor (ENEMY_LEAP_HORIZONTAL_SPEED = PLAYER_RUN_SPEED).
const NAV_LEAP_VX = PLAYER_RUN_SPEED;
// Radius (tiles) nodeAt() searches outward when an arbitrary world point (an
// enemy or the player mid-air / off-grid) doesn't sit exactly on a node cell.
const NAV_SNAP_RADIUS_TILES = 3;

// World grid coords pack into one number; ±32768 covers a ~0.5M px world / 16.
function packCell(gx: number, gy: number): number {
  return (gx + 32768) * 65536 + (gy + 32768);
}

// A level-local solidity predicate straight off the IntGrid csv — O(1), no
// per-call scan of every collision layer. Out-of-level samples read as empty,
// which also confines ballistic arcs to their launching level (cross-level
// travel is walk-only, matching the live enemy whose arc is clamped to its
// current level bounds).
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

  // Eager, cheap pass: register a node for every standable cell across all levels.
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

  // A cell is standable when it's empty, has a solid floor directly below, and
  // has clear headroom for the canonical body.
  private standable(solid: SolidAt, wx: number, wy: number): boolean {
    if (solid(wx, wy)) return false;
    if (!solid(wx, wy + TILE_PX)) return false;
    for (let up = TILE_PX; up < NAV_BODY_H; up += TILE_PX) {
      if (solid(wx, wy - up)) return false;
    }
    return true;
  }

  nodeCount(): number {
    this.buildNodes();
    return this.nodes.length;
  }

  node(id: number): NavNode {
    return this.nodes[id];
  }

  getNodes(): ReadonlyArray<NavNode> {
    this.buildNodes();
    return this.nodes;
  }

  // Lazily compute + memoize a node's outgoing edges.
  getEdges(id: number): ReadonlyArray<NavEdge> {
    const cached = this.edgeCache[id];
    if (cached) return cached;
    const edges = this.computeEdges(id);
    this.edgeCache[id] = edges;
    return edges;
  }

  private computeEdges(id: number): NavEdge[] {
    const node = this.nodes[id];
    const li = this.nodeLevel[id];
    const edges: NavEdge[] = [];
    const seen = new Set<number>();
    const gx = Math.floor(node.x / TILE_PX);
    const gyFoot = Math.floor((node.y - TILE_PX / 2) / TILE_PX);

    // Walk edges: a neighbor node one cell left/right on the same row or a single
    // step up/down. cellToNode spans every level, so a node at a level's edge
    // links to the adjacent level's border node automatically.
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

    // Jump edges: every distinct ballistic landing off each side, found with the
    // same arc physics the live enemy executes (level-local solidity + bounds).
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

  private nodeForFoot(footX: number, footY: number): number | undefined {
    return this.cellToNode.get(
      packCell(
        Math.floor(footX / TILE_PX),
        Math.floor((footY - TILE_PX / 2) / TILE_PX),
      ),
    );
  }

  // Snap an arbitrary world point (an enemy's or the player's foot) to the nearest
  // standable node, searching the foot cell first then expanding ring by ring.
  // Returns -1 when nothing standable is within NAV_SNAP_RADIUS_TILES.
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
