import Phaser from 'phaser';
import {
  FOREGROUND_GLOW_LAYER_PREFIX,
  WORLD_DIM_ALPHA,
  WORLD_DIM_COLOR,
} from '../constants';
import type { RenderedLevel } from './LevelRenderer';

// Camera-pinned dark Rectangle that darkens the parallax/background layers
// without touching the ground (IntGrid auto-tiles), the foregrounds, or
// entities (which sit at ENTITY_DEPTH=100, well above any tile-layer depth).
// IntGrid joins the foreground class for dim purposes because the user paints
// decorative Foreground1 tiles on top of IntGrid ground tiles using the same
// tileset — splitting them across the dim makes the same source pixel render
// at two different brightnesses. The depth is computed from the rendered
// levels rather than hardcoded so the overlay stays correctly sandwiched
// regardless of how many layers any given LDtk level has.
//
// Alpha is dynamic: GameScene calls setAlpha() every frame with a value
// driven by the player's local IntGrid openness (see OpennessLookup). Wide
// open caves → low alpha → brighter screen. Tight tunnels → high alpha →
// darker screen. The static WORLD_DIM_ALPHA constant is used as the
// construct-time default and as the fallback when LIGHTING_ENABLED is off.
export class WorldDimOverlay {
  private readonly rect: Phaser.GameObjects.Rectangle;
  private readonly resizeHandler: (gameSize: Phaser.Structs.Size) => void;

  constructor(scene: Phaser.Scene, depth: number) {
    const cam = scene.cameras.main;
    // Fill alpha = 1.0 so the rect's visible alpha is governed entirely by
    // setAlpha() — visible = fill × display, and pinning fill at 1.0 lets
    // setAlpha drive the full [0, 1] range. WORLD_DIM_ALPHA is then applied
    // via setAlpha so the static-dim case (LIGHTING_ENABLED=false) still
    // renders at the established 0.15 baseline.
    this.rect = scene.add.rectangle(
      0,
      0,
      cam.width,
      cam.height,
      WORLD_DIM_COLOR,
      1.0,
    );
    this.rect.setAlpha(WORLD_DIM_ALPHA);
    this.rect.setOrigin(0, 0);
    // Pin to the camera viewport — the rect's world position doesn't track
    // camera scroll, so a scroll factor of 0 keeps it covering the visible
    // area at all times regardless of where the player walks.
    this.rect.setScrollFactor(0, 0);
    this.rect.setDepth(depth);
    this.resizeHandler = (gameSize): void => {
      // Game resize feeds through cam dimensions (Phaser propagates the new
      // size to the main camera before this event fires for the scene), so
      // re-syncing to cam.width/height covers fullscreen toggles and
      // arbitrary window resizes alike.
      this.rect.setSize(scene.cameras.main.width, scene.cameras.main.height);
      void gameSize;
    };
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.resizeHandler);
  }

  // Set the current dim opacity. Values outside [0, 1] are clamped — Phaser
  // would render alpha > 1 as if it were 1 anyway, but clamping here makes
  // the per-frame update from openness sampling explicit and predictable.
  setAlpha(alpha: number): void {
    const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    this.rect.setAlpha(clamped);
  }

  destroy(scene: Phaser.Scene): void {
    scene.scale.off(Phaser.Scale.Events.RESIZE, this.resizeHandler);
    this.rect.destroy();
  }
}

// Picks the dim depth such that the overlay sits below every Foreground*
// layer AND every IntGrid layer's container, but above background/parallax.
// IntGrid is included so collision-ground tiles share brightness with the
// Foreground1 decorative tiles painted on top of them (same tileset, so any
// brightness split between them is visible as a mismatched-shade artifact).
// Uses (min selected depth - 0.5) so it slots cleanly below the lowest of
// those layers. Phaser supports float depths and resolves ties by display-
// list insertion order, so the half-step is safe and unambiguous. Returns
// null if no qualifying layers were found — caller should skip instantiating
// the overlay in that case (nothing to sit "below").
export function computeWorldDimDepth(
  levels: ReadonlyArray<RenderedLevel>,
): number | null {
  let minDepth = Infinity;
  for (const rendered of levels) {
    for (const layer of rendered.layers) {
      const isForeground = layer.identifier.startsWith(
        FOREGROUND_GLOW_LAYER_PREFIX,
      );
      const isIntGrid = layer.type === 'IntGrid';
      if (!isForeground && !isIntGrid) continue;
      const d = layer.container.depth;
      if (d < minDepth) minDepth = d;
    }
  }
  return Number.isFinite(minDepth) ? minDepth - 0.5 : null;
}
