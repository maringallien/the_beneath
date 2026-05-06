import Phaser from 'phaser';
import {
  CAMERA_ZOOM,
  CURRENT_LEVEL_IDENTIFIER,
  ENTITY_DEPTH,
  SCENE_KEYS,
} from '../constants';
import {
  destroyEntities,
  spawnEntities,
  type SpawnedEntities,
} from '../entities/EntityFactory';
import { Player } from '../entities/Player';
import {
  Projectile,
  type ProjectileSpawnOptions,
} from '../entities/Projectile';
import { ldtkRaw } from '../ldtk/ldtkData';
import {
  getEntities,
  getIntGrid,
  getLevel,
  parseLdtkProject,
} from '../ldtk/parseLdtk';
import type { LdtkProject } from '../ldtk/types';
import { subscribeLdtkUpdate } from '../level/HotReloadBus';
import { buildIntGridCollision } from '../level/LevelCollision';
import {
  destroyRenderedLevel,
  renderLevel,
  type RenderedLevel,
} from '../level/LevelRenderer';
import {
  collectTilesetsForAllLevels,
  loadTilesetsAtRuntime,
  tilesetTextureKey,
} from '../level/TilesetRegistry';
import type { CharacterModeId } from '../sprites/characterTypes';

interface LevelSlot {
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  rendered: RenderedLevel;
}

// Player state preserved across LDtk hot-reloads. Transient action state
// (locked attacks, combo counter, dash duration) is intentionally NOT
// preserved — restoring mid-attack into a freshly-built world is more
// confusing than letting the player drop back to idle for one frame.
interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flipX: boolean;
  mode: CharacterModeId;
}

// Pixels of camera-viewport padding when deciding whether a level is visible.
// One tile (16px) of slack stops sprites from popping in/out at the seam
// between levels when the camera scrolls one pixel past a boundary.
const LEVEL_VISIBILITY_PADDING_PX = 16;

export class GameScene extends Phaser.Scene {
  private player!: Player;
  // One collision tilemap per level (positioned at the level's worldX/Y).
  // Kept as a list so player and projectile colliders can be wired against
  // every level's geometry — letting the player fall from one level into
  // the next without seams.
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  // Per-level visual data, used by update() to cull off-screen levels.
  // Without this culling the scene processes all ~74k tile sprites every
  // frame; toggling whole levels' container visibility lets Phaser skip the
  // children entirely, dropping per-frame work to just the visible levels.
  private levelSlots: LevelSlot[] = [];
  // Plain GameObjects.Group, not a physics group: Phaser.Physics.Arcade.Group's
  // createCallback re-applies its `defaults` to every added child's body —
  // including allowGravity:true and velocityX/Y:0 — clobbering the projectile's
  // own setup. Projectile creates its own dynamic body, so the group only needs
  // to be a collider container.
  private projectiles!: Phaser.GameObjects.Group;
  // Tracks the entities returned by spawnEntities so HMR teardown can destroy
  // them in one call. Player is held separately on this.player for ergonomic
  // access; both reference the same instance.
  private spawned: SpawnedEntities | null = null;
  // Phaser doesn't auto-destroy colliders when their bodies vanish — leaked
  // colliders hold references to dead bodies and can throw nullrefs on the
  // next collision check. Track every collider so tearDownWorld can dispose
  // them explicitly.
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  private hotReloadUnsub: (() => void) | null = null;

  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  create(): void {
    this.buildWorld(parseLdtkProject(ldtkRaw));
    this.hotReloadUnsub = subscribeLdtkUpdate(this.onLdtkChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onSceneShutdown, this);
  }

  update(): void {
    this.player.update();
    this.cullOffscreenLevels();
  }

  // Camera-viewport culling: hide whole levels whose world rect doesn't
  // intersect the visible camera area. Phaser's renderer skips a Container's
  // children entirely when the container is invisible, so this drops per-frame
  // work from "all 19 levels' tiles" to "just the levels on screen". Collision
  // layers are left active because there are far fewer of them and toggling
  // them risks the player tunneling through a level on the boundary.
  private cullOffscreenLevels(): void {
    const cam = this.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const left = cam.scrollX - LEVEL_VISIBILITY_PADDING_PX;
    const top = cam.scrollY - LEVEL_VISIBILITY_PADDING_PX;
    const right = cam.scrollX + viewW + LEVEL_VISIBILITY_PADDING_PX;
    const bottom = cam.scrollY + viewH + LEVEL_VISIBILITY_PADDING_PX;

    for (const slot of this.levelSlots) {
      const visible =
        right > slot.worldX &&
        left < slot.worldX + slot.pxWid &&
        bottom > slot.worldY &&
        top < slot.worldY + slot.pxHei;
      for (const layer of slot.rendered.layers) {
        if (layer.container.visible !== visible) {
          layer.container.setVisible(visible);
        }
      }
    }
  }

  spawnProjectile(options: ProjectileSpawnOptions): void {
    const projectile = new Projectile(this, options);
    projectile.setDepth(ENTITY_DEPTH);
    this.projectiles.add(projectile);
  }

  // Constructs every level, collision tilemap, entity, and collider from a
  // parsed LDtk project. Idempotent: tearDownWorld() must run before this is
  // called a second time for the same scene instance.
  private buildWorld(project: LdtkProject): void {
    // Compute the union of all level rects so physics/camera bounds cover the
    // full traversable world rather than a single level's box.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const lvl of project.levels) {
      if (lvl.worldX < minX) minX = lvl.worldX;
      if (lvl.worldY < minY) minY = lvl.worldY;
      if (lvl.worldX + lvl.pxWid > maxX) maxX = lvl.worldX + lvl.pxWid;
      if (lvl.worldY + lvl.pxHei > maxY) maxY = lvl.worldY + lvl.pxHei;
    }
    this.physics.world.setBounds(minX, minY, maxX - minX, maxY - minY);

    // Pick any tileset with a real image to back the invisible collision
    // tilemap (Phaser's Tilemap API requires a tileset image even when the
    // layer is never drawn). Reused across all per-level collision maps.
    const tilesetUid = project.defs.tilesets.find((ts) => ts.relPath != null)?.uid;
    if (tilesetUid == null) {
      throw new Error(
        'No tileset with a loadable relPath — cannot back the invisible collision tilemap',
      );
    }
    const collisionTextureKey = tilesetTextureKey(tilesetUid);

    // Render every level at its world coords. LevelRenderer offsets its
    // containers by level.worldX/Y so the multi-level world lines up.
    for (const lvl of project.levels) {
      const rendered = renderLevel(this, project, lvl);
      this.levelSlots.push({
        worldX: lvl.worldX,
        worldY: lvl.worldY,
        pxWid: lvl.pxWid,
        pxHei: lvl.pxHei,
        rendered,
      });

      const intGrid = getIntGrid(lvl);
      if (intGrid) {
        const collisionLayer = buildIntGridCollision(
          this,
          intGrid,
          collisionTextureKey,
          lvl.worldX,
          lvl.worldY,
        );
        this.collisionLayers.push(collisionLayer);
      }
    }

    this.projectiles = this.add.group();

    // Spawn entities from every level so enemies/items in other levels exist
    // when the player walks into them. The player factory only fires for the
    // single Sword_master_spawn entity (currently in Level_3).
    const allEntities = project.levels.flatMap(getEntities);
    const spawned = spawnEntities(this, allEntities);
    const spawnLevel = getLevel(project, CURRENT_LEVEL_IDENTIFIER);
    if (!spawned.player) {
      throw new Error(
        `Level "${spawnLevel.identifier}" did not spawn a Player — register a Player factory or place a player spawn entity`,
      );
    }
    this.spawned = spawned;
    this.player = spawned.player;
    this.player.setDepth(ENTITY_DEPTH);

    for (const layer of this.collisionLayers) {
      this.colliders.push(this.physics.add.collider(this.player, layer));
      this.colliders.push(
        this.physics.add.collider(
          this.projectiles,
          layer,
          this.onProjectilePlatformImpact,
          undefined,
          this,
        ),
      );
    }

    this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }

  // Reverses buildWorld in dependency order. Stops camera follow first to
  // avoid the camera holding a reference to a destroyed player; destroys
  // colliders before the bodies they reference; destroys tilemaps via both
  // the layer AND the parent tilemap (the layer-only destroy leaves the map
  // in scene's tilemap registry).
  private tearDownWorld(): void {
    this.cameras.main.stopFollow();

    for (const collider of this.colliders) {
      collider.destroy();
    }
    this.colliders = [];

    for (const layer of this.collisionLayers) {
      const map = layer.tilemap;
      layer.destroy();
      map.destroy();
    }
    this.collisionLayers = [];

    for (const slot of this.levelSlots) {
      destroyRenderedLevel(slot.rendered);
    }
    this.levelSlots = [];

    if (this.projectiles) {
      // clear(true, true) removes from group and destroys child Projectiles;
      // then destroy() disposes the now-empty group itself.
      this.projectiles.clear(true, true);
      this.projectiles.destroy();
    }

    if (this.spawned) {
      destroyEntities(this.spawned);
      this.spawned = null;
    }
  }

  private snapshotPlayer(): PlayerSnapshot | null {
    if (!this.player || !this.player.body) return null;
    return {
      x: this.player.x,
      y: this.player.y,
      vx: this.player.body.velocity.x,
      vy: this.player.body.velocity.y,
      flipX: this.player.flipX,
      mode: this.player.getCurrentMode(),
    };
  }

  private restorePlayer(
    snapshot: PlayerSnapshot,
    project: LdtkProject,
  ): void {
    if (!this.isInsideAnyLevel(snapshot.x, snapshot.y, project)) {
      if (import.meta.env.DEV) {
        console.info(
          '[HMR] Restored position outside the new world — keeping the LDtk spawn position.',
        );
      }
      return;
    }
    this.player.setPosition(snapshot.x, snapshot.y);
    this.player.setVelocity(snapshot.vx, snapshot.vy);
    this.player.setCurrentMode(snapshot.mode);
    // setFacing must come after setCurrentMode: switching mode plays a fresh
    // idle animation that re-anchors with the *current* flipX. Setting flip
    // last guarantees the final anchor matches the restored facing.
    this.player.setFacing(snapshot.flipX);
    this.cameras.main.centerOn(snapshot.x, snapshot.y);
  }

  private isInsideAnyLevel(
    x: number,
    y: number,
    project: LdtkProject,
  ): boolean {
    for (const lvl of project.levels) {
      if (
        x >= lvl.worldX &&
        x < lvl.worldX + lvl.pxWid &&
        y >= lvl.worldY &&
        y < lvl.worldY + lvl.pxHei
      ) {
        return true;
      }
    }
    return false;
  }

  // Arrow function so subscribeLdtkUpdate can store it directly without a
  // separate .bind(this) — and so the same reference is held across the
  // scene's lifetime (important for unsubscribe on shutdown).
  private onLdtkChange = async (rawJson: string): Promise<void> => {
    let project: LdtkProject;
    try {
      project = parseLdtkProject(rawJson);
    } catch (error) {
      // LDtk doesn't always save atomically; mid-write reads can yield
      // truncated JSON. Skip the reload silently — the next save (or the
      // debounce-coalesced trailing event) will deliver complete content.
      if (import.meta.env.DEV) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        console.warn(
          `[HMR] Skipping reload — LDtk JSON not yet valid: ${message}`,
        );
      }
      return;
    }

    // Snapshot before any teardown; the player still belongs to the old world
    // here. Capturing position now reflects what the user was doing when they
    // hit Save, even if the async tileset load below takes a frame or two.
    const playerSnapshot = this.snapshotPlayer();

    // Load any new tilesets BEFORE teardown so the existing world stays
    // visible during the async wait. If loading fails (e.g. user added a
    // layer referencing a PNG that isn't under public/), abort without
    // tearing anything down — the old world keeps running.
    try {
      const tilesets = collectTilesetsForAllLevels(project);
      await loadTilesetsAtRuntime(this, tilesets);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          '[HMR] Tileset load failed; keeping the existing world.',
          error,
        );
      }
      return;
    }

    this.tearDownWorld();
    try {
      this.buildWorld(project);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(
          '[HMR] buildWorld failed after teardown — game is now in a partial state. Reload the page to recover.',
          error,
        );
      }
      return;
    }

    if (playerSnapshot) {
      this.restorePlayer(playerSnapshot, project);
    }
  };

  private onSceneShutdown(): void {
    if (this.hotReloadUnsub) {
      this.hotReloadUnsub();
      this.hotReloadUnsub = null;
    }
  }

  private onProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof Projectile) {
        projectile.onImpact();
      }
    };
}
