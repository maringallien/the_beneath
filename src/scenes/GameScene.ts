import Phaser from 'phaser';
import {
  clearEntitySounds,
  playOneShot,
  registerEnemyWalkSound,
  registerEntityPeriodicSound,
  registerEntitySound,
  registerEntitySoundSequence,
  registerMovingEntitySound,
  setLevelAmbience,
  updateEntitySounds,
} from '../audio';
import {
  CAMERA_MAX_VERTICAL_LAG_PX,
  CAMERA_VERTICAL_OFFSET_PX,
  CAMERA_ZOOM,
  ENTITY_DEPTH,
  LANDING_CAMERA_Y_OFFSET_PX,
  LANDING_PLAYER_VIEWPORT_FRACTION_X,
  PLAYER_DEPTH,
  RESPAWN_DELAY_MS,
  SAVE_REQUESTED_EVENT,
  SHOP_REQUESTED_EVENT,
  SAVE_TOAST_COLOR,
  SAVE_TOAST_DEPTH,
  SAVE_TOAST_DURATION_MS,
  SAVE_TOAST_FONT_FAMILY,
  SAVE_TOAST_FONT_SIZE_PX,
  SAVE_TOAST_OFFSET_Y_PX,
  SAVE_TOAST_RISE_PX,
  SAVE_TOAST_TEXT,
  SCENE_KEYS,
  STARTING_LEVEL_IDENTIFIER,
  LIGHTING_DEBUG_HUD,
  LIGHTING_ENABLED,
  LIGHTING_LERP_RATE_PER_SEC,
  WORLD_DIM_ALPHA,
  WORLD_DIM_ALPHA_ENCLOSED,
  WORLD_DIM_ALPHA_OPEN,
} from '../constants';
import { AmmoDrop } from '../entities/AmmoDrop';
import type { AmmoDropSpawnerScene } from '../entities/AmmoDropSpawnerScene';
import { Enemy } from '../entities/Enemy';
import {
  EnemyProjectile,
  type EnemyProjectileSpawnOptions,
} from '../entities/EnemyProjectile';
import {
  destroyEntities,
  pivotCenter,
  respawnEnemyAt,
  spawnEntities,
  type SpawnedEntities,
} from '../entities/EntityFactory';
import { Door } from '../entities/Door';
import { InteractionManager } from '../entities/InteractionManager';
import { PLAYER_DIED_EVENT, Player, type PickupKind } from '../entities/Player';
import { PlayerHud } from '../entities/PlayerHud';
import { Save } from '../entities/Save';
import type { ShopKind } from '../entities/shop/shopTypes';
import { ShopOverlay } from '../ui/ShopOverlay';
import {
  Projectile,
  type ProjectileSpawnOptions,
} from '../entities/Projectile';
import {
  Trap,
  TRAP_DAMAGE_FRAME_EVENT,
  type TrapDamageSide,
} from '../entities/Trap';
import { ldtkRaw } from '../ldtk/ldtkData';
import {
  getEntities,
  getIntGrid,
  getLevel,
  parseLdtkProject,
} from '../ldtk/parseLdtk';
import type { LdtkProject } from '../ldtk/types';
import { subscribeLdtkUpdate } from '../level/HotReloadBus';
import { EnemyRespawnManager, type PendingRespawn } from '../level/EnemyRespawnManager';
import { buildIntGridCollision } from '../level/LevelCollision';
import {
  destroyRenderedLevel,
  renderLevel,
  type RenderedLevel,
} from '../level/LevelRenderer';
import { computeOpennessGrid } from '../level/OpennessGrid';
import { OpennessLookup } from '../level/OpennessLookup';
import {
  collectTilesetsForAllLevels,
  loadTilesetsAtRuntime,
  tilesetTextureKey,
} from '../level/TilesetRegistry';
import {
  computeWorldDimDepth,
  WorldDimOverlay,
} from '../level/WorldDimOverlay';
import type { CharacterModeId } from '../sprites/characterTypes';

interface LevelSlot {
  // LDtk identifier ("Level_0", "Level_3", ...). Used by SoundManager to
  // pick per-level ambience when the player crosses into a slot.
  identifier: string;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  rendered: RenderedLevel;
}

// Player state preserved across LDtk hot-reloads AND across save→death→
// respawn. Transient action state (locked attacks, combo counter, dash
// duration) is intentionally NOT preserved — restoring mid-attack into a
// freshly-built world is more confusing than letting the player drop back
// to idle for one frame.
//
// To extend: add the field here, capture it in snapshotPlayer(), apply it in
// restorePlayer(). Resource fields (HP/ammo/magic) round-trip through
// Player.applyRestoredState(); position/velocity/mode/facing have dedicated
// setters in restorePlayer().
interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flipX: boolean;
  mode: CharacterModeId;
  health: number;
  gun1Ammo: number;
  gun2Ammo: number;
  magic: number;
  stamina: number;
  coins: number;
}

// Pixels of camera-viewport padding when deciding whether a level is visible.
// Generous padding (roughly one viewport) ensures adjacent levels are already
// rendered by the time the camera reaches them — important during fast falls
// where the camera follow lags slightly behind the player and the cull would
// otherwise mark the destination level invisible until the camera catches up.
const LEVEL_VISIBILITY_PADDING_PX = 512;

// LDtk identifiers excluded from getNearestEnemy. Wasps swarm and feel
// arbitrary as teleport targets; the_hive is a stationary spawner the
// player shouldn't dive-bomb directly.
const TELEPORT_TARGET_BLOCKLIST: ReadonlySet<string> = new Set([
  'Wasp_spawn',
  'The_hive_spawn',
]);

// World-grid tile size in pixels. Used by updateTraps for the spike-ejector's
// "player on the same tile as me" check. Matches the tile spacing assumed by
// isLineBlocked's sample stride and the project's LDtk collision grid.
const TILE_SIZE_PX = 16;

// Maps a [0, 1] openness sample to the corresponding screen-wide dim alpha.
// Linear interpolation between WORLD_DIM_ALPHA_ENCLOSED (at openness=0) and
// WORLD_DIM_ALPHA_OPEN (at openness=1). Pure helper extracted so the
// initial-seed call at world build and the per-frame call in updateLighting
// share one definition; tune the dim curve by editing the two constants
// without searching for inline math.
function openness01ToDimAlpha(openness: number): number {
  return (
    WORLD_DIM_ALPHA_ENCLOSED +
    (WORLD_DIM_ALPHA_OPEN - WORLD_DIM_ALPHA_ENCLOSED) * openness
  );
}

export class GameScene extends Phaser.Scene implements AmmoDropSpawnerScene {
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
  // Plain group, not a physics group — same reason as `projectiles` above:
  // Phaser.Physics.Arcade.Group's createCallback clobbers per-body settings,
  // and Enemy creates its own dynamic body via AnimatedEntity's constructor.
  private enemies!: Phaser.GameObjects.Group;
  // Enemy-fired projectiles. Separate from player `projectiles` so the
  // collider/overlap wiring stays per-faction: enemy projectiles damage the
  // player and pass through other enemies; player projectiles do the inverse.
  private enemyProjectiles!: Phaser.GameObjects.Group;
  // Passive damage sources (spikes, swords, ejectors). Plain group: the
  // overlap fires `onPlayerHitsTrap` and Player.hurt's own invuln window
  // gates re-ticks — no per-trap state needed in the group.
  private traps!: Phaser.GameObjects.Group;
  // Decoration entities that need terrain collisions (currently Save and
  // Mushroom_merchant — both opt into gravity so they settle on the floor
  // rather than floating at the LDtk pivot point). Plain group; the
  // collider is wired against every collision layer in buildWorld.
  private staticEntities!: Phaser.GameObjects.Group;
  // Ammo pickups dropped by chests and enemies. Plain group; AmmoDrop creates
  // its own dynamic body with gravity-on, so a physics group's createCallback
  // would clobber that. The terrain collider lets them land on floors; the
  // player↔ammoDrops overlap consumes them on contact.
  private ammoDrops!: Phaser.GameObjects.Group;
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
  // Camera-pinned HUD. Created in create() (after buildWorld so this.player
  // exists), survives HMR untouched (tearDownWorld never touches HUD display
  // objects), and is auto-destroyed by Phaser on scene shutdown/restart. The
  // HUD itself owns its repaint dedup, so no lastRendered* field is needed
  // here.
  private hud: PlayerHud | null = null;
  // Hold-E interaction system. Built in buildWorld after entities spawn so
  // the registry has live targets; destroyed in tearDownWorld so HMR rebuilds
  // the icon and re-registers fresh chest references rather than holding on
  // to destroyed sprites.
  private interactions: InteractionManager | null = null;
  // DOM-based merchant shop overlay. Created lazily on first openShop, then
  // reused for every subsequent merchant interaction within the same world.
  // tearDownWorld force-closes any open shop and nulls the reference so HMR
  // rebuilds get a fresh overlay tied to the new Player instance.
  private shopOverlay: ShopOverlay | null = null;
  // Most recent player checkpoint, set by takeSave() when the player commits
  // a Save crystal interaction. Survives tearDownWorld/buildWorld so the
  // respawn-from-save path can read it after the world rebuild, and survives
  // HMR for the same reason (a hot-reload during a run shouldn't wipe the
  // checkpoint). Cleared on full scene.restart() because the field lives on
  // the scene instance and a restart re-instantiates the scene.
  // null = no save has been taken yet → death falls back to scene.restart().
  private saveSlot: PlayerSnapshot | null = null;
  // Last LDtk level identifier we applied ambience for. Cached on the scene
  // instance (cleared on scene.restart) so updateAmbience can skip the rect
  // test on frames where the player hasn't moved between levels.
  private lastAmbienceLevelId: string | null = null;
  // Camera-pinned dark overlay drawn between non-foreground tile layers and
  // the foreground glow pass. Owned by the world build/teardown lifecycle:
  // created in buildWorld once levels exist (so the foreground depths are
  // known), destroyed in tearDownWorld. Null while no world is built and
  // when WORLD_DIM_ALPHA is 0 (overlay skipped to avoid a no-op draw call).
  private worldDim: WorldDimOverlay | null = null;

  // Per-level openness scores indexed for spatial lookup. Populated during
  // buildWorld; queried each frame in update() with the player's world coords
  // to drive WorldDimOverlay's alpha. Cleared in tearDownWorld so HMR/respawn
  // rebuild from fresh IntGrid data.
  private opennessLookup: OpennessLookup | null = null;
  // Tracks killed non-boss enemies waiting to respawn at their original LDtk
  // position once ENEMY_RESPAWN_DELAY_MS has elapsed AND the spawn point is
  // off-camera. Owned by the buildWorld/tearDownWorld lifecycle: instantiated
  // alongside the enemies group, cleared on teardown so HMR/respawn-from-save
  // rebuild from a clean slate.
  private respawnManager: EnemyRespawnManager | null = null;
  // Smoothed dim alpha. Tracks the per-frame lerp toward the openness-derived
  // target so screen brightness eases across region boundaries instead of
  // snapping cell-by-cell. Initialized to the static WORLD_DIM_ALPHA at
  // buildWorld so the first frame doesn't pop. Reset on world teardown.
  private currentDimAlpha = WORLD_DIM_ALPHA;
  // Last openness value sampled at a valid in-level position. Held across
  // frames where the player sits in inter-level whitespace (mid-jump across
  // a seam) so the screen doesn't flash dark while crossing the gap.
  private lastOpennessSample = 0.5;
  // Optional debug HUD showing live lighting state (sampled openness,
  // target/current dim alpha). Enabled by LIGHTING_DEBUG_HUD; created in
  // buildWorld alongside worldDim; destroyed in tearDownWorld.
  private lightingDebugText: Phaser.GameObjects.Text | null = null;
  // First-boot flag forwarded from PreloadScene via the init() launch data.
  // True → create() routes through the landing-page path (camera locked,
  // player frozen, LandingScene overlay launched). Respawn-from-save and
  // HMR rebuilds never set this, so they go straight to gameplay.
  private shouldShowLanding = false;
  // Mirror of shouldShowLanding kept live across the landing-page lifetime.
  // update() gates clampCameraLag on this so the manual camera scroll set
  // by positionCameraForLanding() isn't fought by the follow-clamp math
  // every frame. beginGameplay() flips this to false when the player
  // takes control.
  private landingActive = false;

  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  // Phaser lifecycle hook fired before create(). Captures the launch-data
  // payload passed in scene.start(GAME, data). Without an explicit value
  // (HMR, scene.restart(), or any other entry path that doesn't pass data)
  // shouldShowLanding stays false and the landing page is bypassed.
  init(data: { startLanding?: boolean } = {}): void {
    this.shouldShowLanding = data.startLanding ?? false;
  }

  create(): void {
    this.buildWorld(parseLdtkProject(ldtkRaw));
    if (this.shouldShowLanding) {
      // Landing path: freeze the player, snap the camera to the landing
      // framing, and launch LandingScene on top. HUD + ambience are deferred
      // to beginGameplay() so neither appears during the start screen.
      this.landingActive = true;
      this.cameras.main.stopFollow();
      this.positionCameraForLanding();
      this.player.setControlsEnabled(false);
      this.scene.launch(SCENE_KEYS.LANDING);
    } else {
      this.setupHud();
      // Drive ambience from whichever level the player spawned in. State lives
      // in the SoundManager module so this survives scene.restart() (respawn)
      // without resetting tracks. Non-override levels resolve to the global
      // ambience set; override levels (Level_0/6/17/19) crossfade to their own.
      setLevelAmbience(this, this.getCurrentLevelId());
    }
    this.hotReloadUnsub = subscribeLdtkUpdate(this.onLdtkChange);
    // ESC opens the pause menu. Event-based (not JustDown-polled) so the
    // listener is naturally scoped: Phaser disables a scene's keyboard
    // listeners while the scene is paused, so ESC inside PauseScene goes to
    // PauseScene's own handler without double-firing here.
    this.input.keyboard?.on('keydown-ESC', this.openPauseMenu, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onSceneShutdown, this);
  }

  // Anchors the camera so the player sits at LANDING_PLAYER_VIEWPORT_FRACTION_X
  // from the LEFT of the viewport, leaving the right side clear for the
  // START button rendered by LandingScene. centerOn(cx, cy) centers the
  // worldView on (cx, cy) in world space, so offsetting cx by half the
  // display width minus the desired fraction shifts the player to the
  // target column. Y centers on the SPAWN LEVEL'S vertical midpoint
  // (rather than the player's y) so the framing reads as a deliberate
  // composition of the level rather than wherever the spawn entity sits;
  // falls back to player.y if the player isn't inside any level rect on
  // the first frame.
  private positionCameraForLanding(): void {
    const cam = this.cameras.main;
    const centerX =
      this.player.x +
      cam.displayWidth * (0.5 - LANDING_PLAYER_VIEWPORT_FRACTION_X);
    const levelBounds = this.getLevelBoundsAt(this.player.x, this.player.y);
    const baseCenterY = levelBounds
      ? levelBounds.worldY + levelBounds.pxHei * 0.5
      : this.player.y;
    cam.centerOn(centerX, baseCenterY + LANDING_CAMERA_Y_OFFSET_PX);
  }

  // Hands control to the player after the landing fade-out completes.
  // Idempotent: a stray second call (e.g. queued FADE_OUT_COMPLETE from a
  // double-click) is a no-op. Performs the deferred setup that create()
  // skipped on the landing path — HUD construction, ambience kickoff,
  // camera follow — and unfreezes the player so they can move.
  beginGameplay(): void {
    if (!this.landingActive) return;
    this.landingActive = false;
    if (!this.hud) {
      this.setupHud();
    }
    setLevelAmbience(this, this.getCurrentLevelId());
    // Re-enable the follow camera using the same parameters as buildWorld()
    // would have applied. From the locked landing position the camera will
    // smoothly lerp back to the centered-on-player position during the
    // fade-in — a nice incidental flourish, not a problem.
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setFollowOffset(0, CAMERA_VERTICAL_OFFSET_PX);
    this.player.setControlsEnabled(true);
  }

  // Launches PauseScene on top of this scene, then pauses this scene. Order
  // matters: launch first so PauseScene is in the active scenes list before
  // this scene's update loop stops. Also freezes the global animation
  // manager so background sprites (idle loops, traps, etc.) visually halt
  // behind the dim — scene.pause halts update/physics/tweens/timers but
  // leaves the animation manager running.
  private openPauseMenu(): void {
    // Ignore ESC while the landing-page overlay is active so the menu can't
    // stack on top of the start screen.
    if (this.landingActive) return;
    this.anims.pauseAll();
    this.scene.launch(SCENE_KEYS.PAUSE);
    this.scene.pause();
  }

  // SHOP_REQUESTED_EVENT handler. Opens the DOM-based ShopOverlay (the shop
  // lives as styled HTML over the Phaser canvas rather than a Phaser scene)
  // and pauses GameScene so physics/timers/update halt while the buyer
  // shops. The overlay calls onClose when the user dismisses it, which
  // resumes the scene and the global animation manager symmetrically.
  // Player.tryPurchase is invoked directly by the overlay across the pause
  // boundary — the Player instance is still alive in memory while paused.
  private openShop(payload: { kind: ShopKind }): void {
    if (this.landingActive) return;
    if (!this.shopOverlay) {
      const parent =
        this.game.canvas.parentElement ?? document.body;
      this.shopOverlay = new ShopOverlay(this, parent);
    }
    if (this.shopOverlay.isOpen()) return;
    this.anims.pauseAll();
    this.shopOverlay.open({
      kind: payload.kind,
      player: this.player,
      onClose: () => {
        this.anims.resumeAll();
        this.scene.resume();
      },
    });
    this.scene.pause();
  }

  // 5-bar player HUD pinned to the top-left of the screen. The HUD object
  // applies setScrollFactor(0) and a high depth on its display children so
  // they stay anchored to the camera viewport above all gameplay sprites.
  // Camera zoom still applies, so source-pixel dimensions render at
  // PLAYER_HUD_* × CAMERA_ZOOM on screen.
  private setupHud(): void {
    this.hud = new PlayerHud(this);
    // Drive HUD position+ratio updates from the main camera's PRE_RENDER
    // event. That fires after Camera.preRender() rebuilds the camera matrix
    // and refreshes midPoint, so the HUD positions are in sync with the
    // *current* frame's camera scroll — eliminating the one-frame drift
    // that subscribing to scene PRE_UPDATE introduces (PRE_UPDATE fires
    // before the camera follow lerp this frame, so positions trail the
    // visible camera by one tick). PRE_RENDER fires during the render
    // phase, which runs regardless of any throws in the UPDATE phase.
    this.cameras.main.on(
      Phaser.Cameras.Scene2D.Events.PRE_RENDER,
      this.updateHud,
      this,
    );
  }

  private updateHud(): void {
    if (!this.hud) return;
    this.hud.update(
      {
        health: this.player.getHealth(),
        maxHealth: this.player.getMaxHealth(),
        stamina: this.player.getStamina(),
        maxStamina: this.player.getMaxStamina(),
        magic: this.player.getMagic(),
        maxMagic: this.player.getMaxMagic(),
        gun1Ammo: this.player.getGun1Ammo(),
        maxGun1Ammo: this.player.getMaxGun1Ammo(),
        gun2Ammo: this.player.getGun2Ammo(),
        maxGun2Ammo: this.player.getMaxGun2Ammo(),
        coins: this.player.getCoins(),
        maxCoins: this.player.getMaxCoins(),
      },
      this.cameras.main,
    );
  }

  update(): void {
    this.player.update();
    this.updateEnemies();
    this.updateTraps();
    this.updateDoors();
    // Respawn scan runs after the per-entity ticks so any enemy that died
    // this frame (DESTROY fired during updateEnemies → recordDeath enqueued)
    // is in the registry before we scan. Internal throttle gates the scan
    // to ENEMY_RESPAWN_CHECK_INTERVAL_MS regardless of frame rate.
    this.respawnManager?.tick(
      this.cameras.main,
      this.time.now,
      this.handleRespawn,
    );
    // Interaction tick after the player and per-entity updates so the
    // closest-target scan reads this frame's resolved positions (the player
    // may have moved during update(), and Chest.canInteract() can flip from
    // true to false mid-animation).
    this.interactions?.update(
      this.player.x,
      this.player.y,
      this.game.loop.delta,
    );
    // HUD position is driven by the camera PRE_RENDER event (see setupHud)
    // so it stays in sync with the current frame's scroll. Skipped while
    // the landing page holds the camera at a fixed scroll — the clamp
    // would otherwise fight positionCameraForLanding() every frame.
    if (!this.landingActive) {
      this.clampCameraLag();
    }
    this.cullOffscreenLevels();
    this.updateAmbience();
    this.updateLighting();
    updateEntitySounds(this.player.x, this.player.y);
  }

  // Drives the screen-wide dim alpha from the player's local IntGrid
  // openness. The lookup returns null when the player is between levels
  // (mid-jump across a seam), in which case the previous valid sample
  // sticks — without that, the screen would flash dark across every gap.
  // Time-based lerp keeps the visible transition smooth across the
  // cell-level discreteness of the openness grid and across frame rate
  // variation (delta-aware factor).
  private updateLighting(): void {
    if (!LIGHTING_ENABLED || !this.opennessLookup || !this.worldDim) return;
    const sample = this.opennessLookup.sample(this.player.x, this.player.y);
    if (sample !== null) {
      this.lastOpennessSample = sample;
    }
    const target = openness01ToDimAlpha(this.lastOpennessSample);
    const dtSec = this.game.loop.delta * 0.001;
    const factor = Math.min(1, LIGHTING_LERP_RATE_PER_SEC * dtSec);
    this.currentDimAlpha += (target - this.currentDimAlpha) * factor;
    this.worldDim.setAlpha(this.currentDimAlpha);
    if (this.lightingDebugText) {
      const sampleStr = sample === null ? 'null' : sample.toFixed(3);
      const levelId = this.findLevelIdAt(this.player.x, this.player.y);
      this.lightingDebugText.setText(
        `level: ${levelId ?? '-'}\n` +
          `openness: ${sampleStr} (held: ${this.lastOpennessSample.toFixed(3)})\n` +
          `dim α  target: ${target.toFixed(3)}  now: ${this.currentDimAlpha.toFixed(3)}`,
      );
    }
  }

  // Per-frame proximity tick for ejector traps. Trigger condition depends on
  // the trap's ejector kind:
  //   - 'overhead' (smoke/flame): player body horizontally overlaps the trap
  //     body and the player's body center sits above the trap's center —
  //     i.e., in the column directly over the ejector. Center comparison
  //     (not bottom ≤ top) makes the check fire when the player walks across
  //     the trap at the same floor level too, not just when jumping clean
  //     over it.
  //   - 'attached-ground' (spike ejector): player is grounded AND their foot
  //     tile is the exact tile directly beneath the trap's body — i.e.,
  //     they're standing on the ground tile the trap is mounted to.
  // Non-ejector traps return null from getEjectorKind() and are skipped.
  private updateTraps(): void {
    if (!this.spawned) return;
    const pb = this.player.body;
    const grounded = pb.blocked.down || pb.touching.down;
    const playerFootTileX = Math.floor(pb.center.x / TILE_SIZE_PX);
    const playerFootTileY = Math.floor((pb.bottom + 1) / TILE_SIZE_PX);
    const playerLevelId = this.getCurrentLevelId();
    for (const trap of this.spawned.traps) {
      // Traps can be destroyed mid-play by a sword swing or projectile
      // (onProjectileHitsTrap / applySwordHits). spawned.traps is never
      // pruned, so the reference lingers — skip destroyed instances here
      // before touching .body or calling methods that would .play() on a
      // dead sprite (which throws and stalls the scene update loop).
      if (!trap.active) continue;
      // Swaying-sword fires on a different trigger semantic (player passes
      // UNDER the ceiling-hung blade) and runs its own state machine, so it
      // lives outside the ejector branch. tickSwayingSwordFall is a no-op
      // when not in 'falling', so calling it unconditionally is cheap.
      const swayingState = trap.getSwayingSwordState();
      if (swayingState !== null) {
        // Spent swords (snapped/falling/embedded) stay that way for as long
        // as the player is in the trap's level — the embedded blade is a
        // permanent visual reminder. Once the player crosses into a different
        // level the trap re-arms off-screen so a returning player meets a
        // fresh sword. Null playerLevelId (mid-jump between levels) holds
        // the current state to avoid resetting on inter-level seams.
        if (swayingState !== 'idle' && playerLevelId !== null) {
          const trapLevelId = this.findLevelIdAt(
            trap.getSpawnX(),
            trap.getSpawnY(),
          );
          if (trapLevelId !== null && trapLevelId !== playerLevelId) {
            trap.resetSwayingSword();
          }
        }
        if (trap.getSwayingSwordState() === 'idle') {
          const tb = trap.body;
          const xOverlap = pb.right > tb.left && pb.left < tb.right;
          // Trigger zone is "anywhere directly under the sword" — player's
          // top edge must sit below the trap's body so we don't fire when
          // the player is alongside or above (e.g. on an upper platform).
          if (xOverlap && pb.top > tb.bottom) {
            trap.triggerSwayingSword();
          }
        }
        // Probe the tile immediately below the blade's body. Going through
        // the tilemap directly avoids spurious embeds when the falling blade
        // brushes a flying enemy (their body could nudge `touching.down`).
        const tb = trap.body;
        const onSolidTerrain = this.isTileSolidAt(tb.center.x, tb.bottom + 1);
        trap.tickSwayingSwordFall(onSolidTerrain);
        continue;
      }
      const kind = trap.getEjectorKind();
      if (kind === null) continue;
      const tb = trap.body;
      let active = false;
      if (kind === 'overhead') {
        // Prefer the configured damage zone over the physics body so the
        // trigger area can extend further than the tight bullet/sword
        // hitbox (shocker has a small body but a large shock column).
        const zone = trap.getDamageZoneBounds();
        if (zone !== null) {
          const xOverlap = pb.right > zone.left && pb.left < zone.right;
          active = xOverlap && pb.center.y < zone.centerY;
        } else {
          const xOverlap = pb.right > tb.left && pb.left < tb.right;
          active = xOverlap && pb.center.y < tb.center.y;
        }
      } else {
        const trapTileX = Math.floor(tb.center.x / TILE_SIZE_PX);
        const trapTileY = Math.floor((tb.bottom + 1) / TILE_SIZE_PX);
        active =
          grounded &&
          playerFootTileX === trapTileX &&
          playerFootTileY === trapTileY;
      }
      trap.setTriggered(active);
    }
  }

  // Re-applies the level ambience set whenever the player crosses into a new
  // LDtk level. SoundManager.setLevelAmbience is idempotent, so calling
  // with an unchanged id is cheap — but we cache the last-applied id to skip
  // the rect test on most frames. `null` (player between levels mid-jump)
  // is held over from the last known id so we don't crossfade in and out
  // repeatedly along the seam between adjacent levels.
  private updateAmbience(): void {
    const levelId = this.getCurrentLevelId();
    if (levelId === null) return;
    if (levelId === this.lastAmbienceLevelId) return;
    this.lastAmbienceLevelId = levelId;
    setLevelAmbience(this, levelId);
  }

  // Returns the LDtk identifier of the level whose rect contains the player's
  // current world position, or null if the player is between levels (mid-jump
  // across a seam).
  private getCurrentLevelId(): string | null {
    return this.findLevelIdAt(this.player.x, this.player.y);
  }

  // Returns the LDtk identifier of the level whose rect contains (x, y), or
  // null if the point lies in inter-level whitespace. Iteration order matches
  // build order; LDtk levels do not overlap so the first hit is unambiguous.
  private findLevelIdAt(x: number, y: number): string | null {
    for (const slot of this.levelSlots) {
      if (
        x >= slot.worldX &&
        x < slot.worldX + slot.pxWid &&
        y >= slot.worldY &&
        y < slot.worldY + slot.pxHei
      ) {
        return slot.identifier;
      }
    }
    return null;
  }

  // Per-frame AI tick for every spawned enemy. Group.getChildren() returns
  // the live array (mutations during destroy() are safe because Enemy's own
  // dead/hurt early-return prevents reentrant state changes here). The
  // instanceof guard keeps the loop tolerant of mixed groups in case a
  // future change adds non-Enemy children.
  private updateEnemies(): void {
    if (!this.enemies) return;
    const children = this.enemies.getChildren();
    for (const obj of children) {
      if (obj instanceof Enemy) {
        obj.update(this.player);
      }
    }
  }

  // Per-frame proximity tick for doors. Drives the closed↔opening↔open state
  // machine in Door.update(); the player↔doors collider's process callback
  // reads the resulting isPassable() to gate collision.
  private updateDoors(): void {
    if (!this.spawned) return;
    const px = this.player.x;
    const py = this.player.y;
    for (const door of this.spawned.doors) {
      door.update(px, py);
    }
  }

  // The buttery 0.08 lerp can't keep up with terminal-velocity falls — left
  // alone, the steady-state lag is large enough to push the player off
  // screen. Clamp scrollY each frame so the camera can never sit more than
  // CAMERA_MAX_VERTICAL_LAG_PX above or below its ideal follow position.
  // Phaser's camera lerp re-runs after this and pulls back toward ideal, so
  // normal motion still feels smooth — the clamp only kicks in when the
  // player out-runs the lerp. Note: Phaser's own follow math targets
  // `(follow.y - offset.y) - height/2` using the raw pixel height (its
  // source explicitly states "values are in pixels and not impacted by
  // zooming"), so we mirror that — dividing by zoom here would put the clamp
  // band hundreds of pixels away from Phaser's lerp target and the two would
  // fight every frame.
  private clampCameraLag(): void {
    const cam = this.cameras.main;
    const idealScrollY =
      this.player.y - CAMERA_VERTICAL_OFFSET_PX - cam.height / 2;
    cam.scrollY = Phaser.Math.Clamp(
      cam.scrollY,
      idealScrollY - CAMERA_MAX_VERTICAL_LAG_PX,
      idealScrollY + CAMERA_MAX_VERTICAL_LAG_PX,
    );
  }

  // Camera-viewport culling: hide whole levels whose world rect doesn't
  // intersect the visible camera area. Phaser's renderer skips a Container's
  // children entirely when the container is invisible, so this drops per-frame
  // work from "all 19 levels' tiles" to "just the levels on screen". Collision
  // layers are left active because there are far fewer of them and toggling
  // them risks the player tunneling through a level on the boundary.
  //
  // Viewport is derived from cam.midPoint + displayWidth/Height, NOT from
  // scrollX/Y + width/zoom. Phaser stores scrollX as `follow.x - cam.width/2`
  // (canvas-pixel half-width, not zoom-adjusted), so `scrollX + cam.width/zoom`
  // undershoots the actual visible right edge by `(cam.width/2)(1 - 1/zoom)`
  // — at zoom 3 with a 1280 px canvas that's ~427 px, which silently consumed
  // almost all of the intended 512 px of padding and let neighboring levels
  // pop in only after the camera had already reached them.
  private cullOffscreenLevels(): void {
    const cam = this.cameras.main;
    const halfDispW = cam.displayWidth * 0.5;
    const halfDispH = cam.displayHeight * 0.5;
    const left = cam.midPoint.x - halfDispW - LEVEL_VISIBILITY_PADDING_PX;
    const top = cam.midPoint.y - halfDispH - LEVEL_VISIBILITY_PADDING_PX;
    const right = cam.midPoint.x + halfDispW + LEVEL_VISIBILITY_PADDING_PX;
    const bottom = cam.midPoint.y + halfDispH + LEVEL_VISIBILITY_PADDING_PX;

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

  // True iff a solid collision tile exists at the given world coords. Iterates
  // collision layers because the world has one tilemap per level — most layers
  // return null instantly for out-of-bounds points, so the per-call cost is
  // dominated by the one layer that owns the sample point.
  isTileSolidAt(x: number, y: number): boolean {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) return true;
    }
    return false;
  }

  // Returns the world-space rect of the LDtk level containing (x, y), or
  // null if the point lies in inter-level whitespace. Used by arena-bound
  // bosses (e.g. The_heart_hoarder) to capture their spawn level at
  // construction so the AI can clamp movement/teleport destinations to the
  // arena instead of chasing the player into adjacent levels. Shares its
  // hit-test with findLevelIdAt — LDtk levels do not overlap so the first
  // containing slot is unambiguous.
  getLevelBoundsAt(
    x: number,
    y: number,
  ): { worldX: number; worldY: number; pxWid: number; pxHei: number } | null {
    for (const slot of this.levelSlots) {
      if (
        x >= slot.worldX &&
        x < slot.worldX + slot.pxWid &&
        y >= slot.worldY &&
        y < slot.worldY + slot.pxHei
      ) {
        return {
          worldX: slot.worldX,
          worldY: slot.worldY,
          pxWid: slot.pxWid,
          pxHei: slot.pxHei,
        };
      }
    }
    return null;
  }

  // Raw IntGrid value at the given world coords (1=ground, 2=bridge, ...).
  // Returns 0 for empty cells, out-of-bounds, or non-tile positions. Used by
  // Player to drive surface-specific sounds (e.g. pebble footsteps gated on
  // value 1). Same per-call cost shape as isTileSolidAt — bounded by the one
  // layer that contains the sample point.
  getIntGridValueAt(x: number, y: number): number {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile) return tile.index;
    }
    return 0;
  }

  // Coarse line-of-sight test: samples points along the segment (x1,y1)→(x2,y2)
  // and returns true if any sample lands on a solid collision tile. Sample
  // spacing is one tile (16 px in this project) so a 1-tile wall directly on
  // the line is always caught — finer spacing would only matter for sub-tile
  // geometry, which doesn't exist on the collision grid. False positives are
  // possible when the line clips a floor/ceiling tile (e.g. enemy on a ledge
  // above the player); chase will reject the path even though a curved walk
  // could close the gap. Acceptable for the current AI model.
  // Returns the body-center position of the nearest live enemy to (x, y),
  // or null if none exist. Used by the sword_master teleport attack to drop
  // the player above their nearest target on the 'appear' frame. Body center
  // (not sprite center) is the reliable reference because tall sprites
  // anchored at frame-bottom (e.g. The_tarnished_widow: 188×90 sprite with
  // 48×45 body anchored at frame bottom) have their sprite.y sitting at
  // body.top — placing the player relative to sprite.y leaves the slash
  // hitbox entirely above the body. body.center.y normalizes across all
  // enemy sizes/anchors. Dead enemies (mid-death-anim corpses still in the
  // group) are filtered so the move homes in on something actually fightable.
  // Wasps and the_hive are also skipped — wasps are swarm minions where
  // homing onto a single one feels arbitrary, and the_hive is a stationary
  // spawner the player isn't meant to dive-bomb directly.
  getNearestEnemy(x: number, y: number): { x: number; y: number } | null {
    if (!this.enemies) return null;
    let nearestX = 0;
    let nearestY = 0;
    let nearestDistSq = Infinity;
    let found = false;
    for (const obj of this.enemies.getChildren()) {
      if (!(obj instanceof Enemy)) continue;
      if (obj.isDead()) continue;
      if (TELEPORT_TARGET_BLOCKLIST.has(obj.getIdentifier())) continue;
      const targetX = obj.body.center.x;
      const targetY = obj.body.center.y;
      const dx = targetX - x;
      const dy = targetY - y;
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestX = targetX;
        nearestY = targetY;
        found = true;
      }
    }
    return found ? { x: nearestX, y: nearestY } : null;
  }

  isLineBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return false;
    const stepPx = 16;
    const steps = Math.ceil(distance / stepPx);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = x1 + dx * t;
      const sy = y1 + dy * t;
      for (const layer of this.collisionLayers) {
        const tile = layer.getTileAtWorldXY(sx, sy);
        if (tile && tile.collides) return true;
      }
    }
    return false;
  }

  spawnProjectile(options: ProjectileSpawnOptions): void {
    const projectile = new Projectile(this, options);
    projectile.setDepth(ENTITY_DEPTH);
    this.projectiles.add(projectile);
    // Notify every live Enemy so any with behavior.dodgeOnProjectile can
    // react. Enemy itself filters by range, cooldown, and current state, so
    // this is a cheap broadcast — no per-enemy hit-test here.
    if (this.enemies) {
      for (const obj of this.enemies.getChildren()) {
        if (obj instanceof Enemy) {
          obj.notifyPlayerProjectileFired(projectile.x, projectile.y);
        }
      }
    }
  }

  // Structural entry point used by Enemy.fireProjectileAttack — kept here
  // (rather than on Enemy itself) so the collider/overlap wiring lives next
  // to the rest of the projectile setup and HMR teardown finds the group.
  spawnEnemyProjectile(options: EnemyProjectileSpawnOptions): void {
    const projectile = new EnemyProjectile(this, options);
    projectile.setDepth(ENTITY_DEPTH);
    this.enemyProjectiles.add(projectile);
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
    // Per-level openness grids are computed alongside the collision build so
    // both consume the same IntGrid pass — see opennessLookup below.
    const opennessLookup = LIGHTING_ENABLED ? new OpennessLookup() : null;
    for (const lvl of project.levels) {
      const rendered = renderLevel(this, project, lvl);
      this.levelSlots.push({
        identifier: lvl.identifier,
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
        if (opennessLookup) {
          // Skip levels whose IntGrid yields no usable grid (zero-sized,
          // pure-solid, or sentinel rows). The level still renders and still
          // collides; lighting just falls back to the inter-level default
          // (last known openness sample) when the player crosses it.
          const opennessGrid = computeOpennessGrid(intGrid);
          if (opennessGrid) {
            opennessLookup.add({
              identifier: lvl.identifier,
              worldX: lvl.worldX,
              worldY: lvl.worldY,
              pxWid: lvl.pxWid,
              pxHei: lvl.pxHei,
              gridSize: intGrid.gridSize,
              grid: opennessGrid,
            });
          }
        }
      }
    }
    this.opennessLookup = opennessLookup;

    this.projectiles = this.add.group();
    this.enemies = this.add.group();
    this.enemyProjectiles = this.add.group();
    this.traps = this.add.group();
    this.staticEntities = this.add.group();
    this.ammoDrops = this.add.group();

    // Spawn entities from every level so enemies/items in other levels exist
    // when the player walks into them. The player factory only fires for the
    // single Sword_master_spawn entity (currently in STARTING_LEVEL_IDENTIFIER).
    const allEntities = project.levels.flatMap(getEntities);
    // Audio-anchor pass: decoration entities (House2/House6/etc.) bound to
    // a spatial sound in soundRegistry get a per-instance looping audio
    // source at their world position. This is independent of spawnEntities
    // because the bound entities have no factory — they're rendered as
    // static tiles by LevelRenderer, but still emit sound.
    for (const instance of allEntities) {
      const { x, y } = pivotCenter(instance);
      registerEntitySound(this, instance.__identifier, instance.iid, x, y);
    }
    this.respawnManager = new EnemyRespawnManager();
    const spawned = spawnEntities(this, allEntities);
    for (const enemy of spawned.enemies) {
      this.attachEnemyToWorld(enemy);
    }
    for (const trap of spawned.traps) {
      trap.setDepth(ENTITY_DEPTH);
      this.traps.add(trap);
      // Snap and ejector traps emit TRAP_DAMAGE_FRAME at the midpoint of
      // their damaging animation; GameScene re-checks current overlap then
      // and applies damage to anything still in the danger zone. The
      // listener is bound on the trap sprite, so Phaser's auto-destroy
      // pass tears it down with the sprite — no manual cleanup needed.
      if (trap.hasDeferredDamage()) {
        trap.on(TRAP_DAMAGE_FRAME_EVENT, this.onTrapDamageFrame, this);
      }
    }
    // Decoration entities that have gravity:true in the registry
    // (Mushroom_merchant) need a terrain collider so they settle on the
    // floor rather than falling forever. Other AnimatedEntity instances
    // with gravity:false get added too — the collider is a no-op for
    // bodies whose physics aren't moving, so the wiring stays uniform.
    for (const other of spawned.others) {
      this.staticEntities.add(other);
    }
    // Save crystals graduated out of `others` into their own typed list (so
    // InteractionManager can register them without a type guard), but they
    // still have gravity:true in the registry — add them to staticEntities
    // explicitly so the terrain collider applies and they rest on the floor
    // rather than falling forever.
    for (const save of spawned.saves) {
      this.staticEntities.add(save);
    }
    // Merchants also graduated out of `others`. Tech shop has gravity:false
    // (the collider is a no-op for it); mushroom merchant has gravity:true
    // and needs the terrain collider to settle on the floor. Uniform add is
    // simpler than branching on the entity kind here.
    for (const merchant of spawned.merchants) {
      this.staticEntities.add(merchant);
    }
    const spawnLevel = getLevel(project, STARTING_LEVEL_IDENTIFIER);
    if (!spawned.player) {
      throw new Error(
        `Level "${spawnLevel.identifier}" did not spawn a Player — register a Player factory or place a player spawn entity`,
      );
    }
    this.spawned = spawned;
    this.player = spawned.player;
    this.player.setDepth(PLAYER_DEPTH);

    // Hold-E interactions. Built after the player exists (the manager needs
    // it as a query source for lockedAction) and after entities spawn (so
    // chests/saves are registered with live references). Future interactables
    // get added here too — register them after their own pre-filtered list
    // lands in SpawnedEntities, mirroring how chests are wired.
    this.interactions = new InteractionManager(this, this.player);
    this.interactions.registerAll(spawned.chests);
    this.interactions.registerAll(spawned.saves);
    this.interactions.registerAll(spawned.merchants);

    // Save crystals fire SAVE_REQUESTED_EVENT on commit; takeSave reads the
    // current player state into this.saveSlot and pops a "Game Saved" toast.
    // Subscribed here (per buildWorld) so HMR rebuilds wire to the fresh
    // event bus; tearDownWorld removes the listener so duplicates can't
    // accumulate across rebuilds.
    this.events.on(SAVE_REQUESTED_EVENT, this.takeSave, this);
    // Merchants fire SHOP_REQUESTED_EVENT on commit; openShop launches the
    // ShopScene overlay paused on top of GameScene. Same per-buildWorld /
    // per-tearDownWorld subscribe/unsubscribe shape as the save listener so
    // HMR can't double-register the handler.
    this.events.on(SHOP_REQUESTED_EVENT, this.openShop, this);

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
      // Enemies collide with terrain so gravity-enabled enemies (e.g. dogs)
      // rest on platforms instead of tunnelling, and airborne enemies
      // (crows, wasps) can't phase through walls or the ground. Airborne
      // chase is already gated on line-of-sight in Enemy.update(), so the
      // body won't be commanded into a wall during pursuit; loiter targets
      // refresh on a short timer, so any momentary push against terrain
      // resolves itself.
      this.colliders.push(this.physics.add.collider(this.enemies, layer));
      // Static decoration entities (Save, Mushroom_merchant) also collide so
      // any registry entry with gravity:true settles on the floor rather
      // than floating at its LDtk pivot point.
      this.colliders.push(this.physics.add.collider(this.staticEntities, layer));
      // Traps collide with terrain so the swaying sword, which flips its body
      // to gravity-on when triggered, stops on the floor instead of falling
      // through. Stationary traps (gravity:false) have no velocity, so this
      // collider is a no-op for them and the wiring stays uniform.
      this.colliders.push(this.physics.add.collider(this.traps, layer));
      // Enemy projectiles explode on terrain — same treatment as the player's.
      this.colliders.push(
        this.physics.add.collider(
          this.enemyProjectiles,
          layer,
          this.onEnemyProjectilePlatformImpact,
          undefined,
          this,
        ),
      );
      // Ammo drops settle on floors and ride moving platforms via the same
      // collider as everything else. No process/callback: a drop just bounces
      // on the floor under default Arcade rules until the player picks it up
      // or its lifetime expires.
      this.colliders.push(
        this.physics.add.collider(this.ammoDrops, layer),
      );
    }

    // Doors are static walls. Immovable bodies on the Door side mean the
    // default Arcade collision response just pushes the player back.
    if (spawned.doors.length > 0) {
      this.colliders.push(
        this.physics.add.collider(
          this.player,
          spawned.doors as Door[],
          undefined,
          (_player, door) => !(door as Door).isPassable(),
          this,
        ),
      );
    }

    // Player projectiles damage enemies. Both groups already exist; the
    // overlap is registered after collider wiring so any ordering concerns
    // are explicit at the call site.
    this.colliders.push(
      this.physics.add.overlap(
        this.projectiles,
        this.enemies,
        this.onProjectileHitsEnemy,
        undefined,
        this,
      ),
    );
    // Player projectiles destroy traps on contact. One-shot kill — traps
    // have no HP — and the projectile explodes against the trap just like
    // it would against terrain. Gives the player a way to neutralise
    // hazards from a safe distance.
    this.colliders.push(
      this.physics.add.overlap(
        this.projectiles,
        this.traps,
        this.onProjectileHitsTrap,
        undefined,
        this,
      ),
    );
    // Enemy projectiles damage the player.
    this.colliders.push(
      this.physics.add.overlap(
        this.enemyProjectiles,
        this.player,
        this.onEnemyProjectileHitsPlayer,
        undefined,
        this,
      ),
    );
    // Traps damage the player on body overlap. Bounding-box overlap implements
    // "directly above/under" naturally: a player approaching from the side
    // doesn't take damage until they actually step into the trap's hitbox.
    this.colliders.push(
      this.physics.add.overlap(
        this.player,
        this.traps,
        this.onPlayerHitsTrap,
        undefined,
        this,
      ),
    );
    // Enemies are vulnerable to the same traps as the player. Reuses the
    // "directly above" gate so enemies walking past a side-mounted trap
    // don't bleed health; per-enemy hurt-state acts as the natural
    // re-tick cooldown so a trap doesn't drain an enemy per-frame.
    this.colliders.push(
      this.physics.add.overlap(
        this.enemies,
        this.traps,
        this.onEnemyHitsTrap,
        undefined,
        this,
      ),
    );
    // Player picks up ammo drops on body overlap. No proximity prompt — the
    // pickup is automatic. The callback addAmmo-and-destroy is small enough
    // that we don't bother with a process callback to gate it.
    this.colliders.push(
      this.physics.add.overlap(
        this.player,
        this.ammoDrops,
        this.onPlayerPicksUpAmmo,
        undefined,
        this,
      ),
    );

    this.cameras.main.setZoom(CAMERA_ZOOM);
    // Lerp values < 1 smooth the follow toward the target each frame. 0.08 on
    // both axes feels buttery and stops the camera snapping during jumps —
    // small bobs damp out before they're visible while sustained motion still
    // tracks. No deadzone: a deadzone pins the player at its edge instead of
    // returning to the follow offset, so a long fall would leave them stuck
    // at the bottom of the screen.
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    // Phaser subtracts followOffset from the follow target's position when
    // setting scroll — a positive Y offset pulls the camera up so the player
    // renders in the lower half of the viewport, giving headroom to see
    // upcoming jumps and platforms.
    this.cameras.main.setFollowOffset(0, CAMERA_VERTICAL_OFFSET_PX);
    // Camera bounds = union of every level's rect. The viewport may scroll
    // through inter-level gaps and show the scene's clear color there; the
    // tradeoff is that approaching any level boundary lets the player see
    // the next level coming, instead of a hard clamp at the seam.
    this.cameras.main.setBounds(
      minX,
      minY,
      maxX - minX,
      maxY - minY,
    );

    // World dim overlay: a camera-pinned dark rectangle slotted just under
    // the lowest IntGrid/Foreground* layer depth. Background/parallax tile
    // layers and the per-level masks sit below it and get darkened; IntGrid
    // ground, foreground tiles, the foreground glow pass, and entities
    // (ENTITY_DEPTH=100) sit above and render at full brightness. IntGrid is
    // grouped with the foregrounds so Foreground1 decorations painted on top
    // of ground tiles don't read brighter than their substrate. Skipped at
    // ALPHA=0 so the constant doubles as a kill switch without changing the
    // wiring.
    if (WORLD_DIM_ALPHA > 0) {
      const renderedLevels = this.levelSlots.map((slot) => slot.rendered);
      const dimDepth = computeWorldDimDepth(renderedLevels);
      if (dimDepth !== null) {
        this.worldDim = new WorldDimOverlay(this, dimDepth);
        // Seed the dynamic-alpha state from the player's spawn openness so
        // frame 0 already shows the correct brightness for the spawn region
        // — otherwise a player spawning in a tight corridor sees a brief
        // flash at WORLD_DIM_ALPHA before the lerp eases down to the
        // enclosed target.
        if (LIGHTING_ENABLED && this.opennessLookup) {
          const spawnSample = this.opennessLookup.sample(
            this.player.x,
            this.player.y,
          );
          if (spawnSample !== null) {
            this.lastOpennessSample = spawnSample;
          }
          this.currentDimAlpha = openness01ToDimAlpha(
            this.lastOpennessSample,
          );
          this.worldDim.setAlpha(this.currentDimAlpha);
        }

        if (LIGHTING_DEBUG_HUD) {
          // Camera-pinned diagnostic readout: each frame shows the raw
          // openness sample at the player's tile, the openness-mapped
          // target alpha, and the smoothed current alpha actually being
          // drawn. Letting the user watch these change (or not) as they
          // walk around is the fastest way to spot whether the lighting
          // system is producing variation or collapsing to a uniform value.
          this.lightingDebugText = this.add
            .text(8, 8, '', {
              fontFamily: 'monospace',
              fontSize: '10px',
              color: '#ffffff',
              backgroundColor: 'rgba(0,0,0,0.6)',
              padding: { x: 4, y: 2 },
            })
            .setScrollFactor(0, 0)
            .setDepth(100_000);
        }
      }
    }

    // PLAYER_DIED_EVENT → either rewind to the last save (if one exists) or
    // fall back to a full scene restart. The captured `diedPlayer` lets the
    // delayed callback ignore the trigger when HMR or an earlier respawn
    // has since rebuilt the world — comparing against the current
    // this.player avoids re-entering the rebuild for a stale death.
    const diedPlayer = this.player;
    this.player.once(PLAYER_DIED_EVENT, () => {
      this.time.delayedCall(RESPAWN_DELAY_MS, () => {
        if (this.player !== diedPlayer) return;
        if (this.saveSlot) {
          this.respawnFromSave();
        } else {
          this.scene.restart();
        }
      });
    });
  }

  // Wires a freshly-constructed Enemy into the world: depth, group, audio
  // anchors, and the DESTROY-time death record for the respawn system.
  // Shared by buildWorld's initial pass AND handleRespawn so a rebuilt
  // enemy gets every hookup the original had — including a fresh DESTROY
  // listener for its next death, enabling unlimited respawn cycles.
  //
  // The DESTROY handler is gated on isDead() so HMR teardown
  // (destroyEntities() destroys live enemies) does NOT enqueue them: the
  // teardown path also clears the manager, but the gate is the primary
  // guard so the order of operations between tearDownWorld and the DESTROY
  // event can't accidentally queue ghosts.
  private attachEnemyToWorld(enemy: Enemy): void {
    enemy.setDepth(ENTITY_DEPTH);
    this.enemies.add(enemy);
    // Moving creatures (wasps, evil crows, spark bugs) carry their own
    // spatial loops and periodic-call schedulers. The bindings live in
    // soundRegistry.json keyed by LDtk identifier; the manager no-ops
    // for unbound enemies, so a single call covers every enemy class.
    registerMovingEntitySound(this, enemy.getIdentifier(), enemy);
    registerEnemyWalkSound(this, enemy.getIdentifier(), enemy);
    registerEntityPeriodicSound(this, enemy.getIdentifier(), enemy);
    registerEntitySoundSequence(this, enemy.getIdentifier(), enemy);
    enemy.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (!enemy.isDead()) return;
      this.respawnManager?.recordDeath(enemy, this.time.now);
    });
  }

  // Respawn callback fired by EnemyRespawnManager.tick() when a queued entry
  // is past its delay AND off-camera. Rebuilds the Enemy via the shared
  // EntityFactory helper, then runs the same buildWorld post-spawn pass via
  // attachEnemyToWorld so the new instance is indistinguishable from one
  // that spawned at world build. Also re-registers the iid-keyed static
  // audio anchor (e.g. the hive's bee buzz) that enterDeadState tore down
  // — registerEntitySound is no-op for entities without a binding, so the
  // call is safe for every enemy.
  private handleRespawn = (entry: PendingRespawn): void => {
    const enemy = respawnEnemyAt(
      this,
      entry.identifier,
      entry.spawnX,
      entry.spawnY,
      entry.iid,
      entry.loiterPath,
    );
    if (!enemy) return;
    registerEntitySound(this, entry.identifier, entry.iid, entry.spawnX, entry.spawnY);
    this.attachEnemyToWorld(enemy);
  };

  // Reverses buildWorld in dependency order. Stops camera follow first to
  // avoid the camera holding a reference to a destroyed player; destroys
  // colliders before the bodies they reference; destroys tilemaps via both
  // the layer AND the parent tilemap (the layer-only destroy leaves the map
  // in scene's tilemap registry).
  private tearDownWorld(): void {
    this.cameras.main.stopFollow();

    // Entity-anchored audio is bound to LDtk entity instances that are
    // about to be re-derived from a freshly parsed project (HMR path) or
    // rebuilt for the same scene on restart. Drop the existing anchors
    // first so the next buildWorld doesn't double-register and cause the
    // world to get progressively louder on each reload.
    clearEntitySounds();

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

    if (this.worldDim) {
      this.worldDim.destroy(this);
      this.worldDim = null;
    }

    if (this.lightingDebugText) {
      this.lightingDebugText.destroy();
      this.lightingDebugText = null;
    }

    this.opennessLookup = null;
    this.currentDimAlpha = WORLD_DIM_ALPHA;
    this.lastOpennessSample = 0.5;

    // Drop every pending respawn — the rebuilt world will contain every
    // non-boss enemy alive (LDtk spawn pass runs fresh), so any stale entry
    // would queue a duplicate respawn on top of the live one.
    if (this.respawnManager) {
      this.respawnManager.clear();
      this.respawnManager = null;
    }

    if (this.projectiles) {
      // clear(true, true) removes from group and destroys child Projectiles;
      // then destroy() disposes the now-empty group itself.
      this.projectiles.clear(true, true);
      this.projectiles.destroy();
    }

    if (this.enemyProjectiles) {
      // Same teardown shape as `projectiles` — destroy each EnemyProjectile
      // first (so its DESTROY handler unsubscribes WORLD_BOUNDS), then dispose
      // the empty group.
      this.enemyProjectiles.clear(true, true);
      this.enemyProjectiles.destroy();
    }

    if (this.enemies) {
      // Enemies are destroyed via destroyEntities below; clear(false, false)
      // empties the group without re-destroying its children (double-destroy
      // throws on the second call). Then destroy() disposes the empty group.
      this.enemies.clear(false, false);
      this.enemies.destroy();
    }

    if (this.traps) {
      // Same teardown shape as `enemies` — destroyEntities below disposes the
      // children, so just empty the group and dispose the shell here.
      this.traps.clear(false, false);
      this.traps.destroy();
    }

    if (this.staticEntities) {
      // Same teardown shape as `traps` — children are disposed by
      // destroyEntities below, so just empty + drop the group shell.
      this.staticEntities.clear(false, false);
      this.staticEntities.destroy();
    }

    if (this.ammoDrops) {
      // Same teardown shape as `projectiles`: AmmoDrops are dynamic (not in
      // SpawnedEntities), so clear(true, true) destroys each drop. Player
      // ammo state lives on the Player instance and is preserved across HMR
      // by destroyEntities({ preservePlayer: true }) at the call sites.
      this.ammoDrops.clear(true, true);
      this.ammoDrops.destroy();
    }

    if (this.spawned) {
      destroyEntities(this.spawned);
      this.spawned = null;
    }

    // Drop the interaction system AFTER destroyEntities so canInteract() on
    // any in-flight target can't be called on a destroyed sprite during the
    // manager's own teardown (the icon Container's destroy() is independent
    // of the registry, but the registry holds references the manager null
    // out here for symmetry).
    if (this.interactions) {
      this.interactions.destroy();
      this.interactions = null;
    }

    // Force-close the shop overlay (if open) without invoking its onClose —
    // the GameScene is being rebuilt, so resuming via onClose would re-enter
    // a half-torn-down scene. Drop the reference so the next buildWorld
    // constructs a fresh overlay tied to the new Player instance.
    if (this.shopOverlay) {
      this.shopOverlay.destroy();
      this.shopOverlay = null;
    }

    // Unsubscribe the save-request handler so a subsequent buildWorld's
    // .on() doesn't accumulate duplicate listeners across HMR or respawn.
    this.events.off(SAVE_REQUESTED_EVENT, this.takeSave, this);
    this.events.off(SHOP_REQUESTED_EVENT, this.openShop, this);
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
      health: this.player.getHealth(),
      gun1Ammo: this.player.getGun1Ammo(),
      gun2Ammo: this.player.getGun2Ammo(),
      magic: this.player.getMagic(),
      stamina: this.player.getStamina(),
      coins: this.player.getCoins(),
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
    // Resource fields go through applyRestoredState so Player owns the
    // clamping. Done after the mode switch so any future mode-dependent
    // resource cap can read the right max.
    this.player.applyRestoredState({
      health: snapshot.health,
      gun1Ammo: snapshot.gun1Ammo,
      gun2Ammo: snapshot.gun2Ammo,
      magic: snapshot.magic,
      stamina: snapshot.stamina,
      coins: snapshot.coins,
    });
    this.cameras.main.centerOn(snapshot.x, snapshot.y);
  }

  // SAVE_REQUESTED_EVENT handler. Snapshots the player into saveSlot and
  // pops a floating "Game Saved" text above the crystal that triggered the
  // save. Multi-save semantics: every successful interaction overwrites the
  // single slot, so the most recent crystal wins.
  private takeSave(crystal: Save): void {
    const snapshot = this.snapshotPlayer();
    if (!snapshot) return;
    this.saveSlot = snapshot;
    this.showSaveToast(crystal);
  }

  // Floating "Game Saved" text that rises and fades over SAVE_TOAST_DURATION_MS
  // then destroys itself. Source-pixel font + setResolution(CAMERA_ZOOM)
  // matches the HUD's smoothing pattern so the text reads crisply at zoom.
  // Anchored to the crystal's body.top so it always appears above the
  // silhouette regardless of which crystal was used.
  private showSaveToast(crystal: Save): void {
    const startX = crystal.x;
    const startY = crystal.body.top - SAVE_TOAST_OFFSET_Y_PX;
    const toast = this.add.text(startX, startY, SAVE_TOAST_TEXT, {
      fontFamily: SAVE_TOAST_FONT_FAMILY,
      fontSize: `${SAVE_TOAST_FONT_SIZE_PX}px`,
      color: SAVE_TOAST_COLOR,
    });
    toast.setOrigin(0.5, 1);
    toast.setResolution(CAMERA_ZOOM);
    toast.setDepth(SAVE_TOAST_DEPTH);
    // Same LINEAR-filter trick used elsewhere (magic orb, interaction E):
    // the global pixelArt:true config nearest-samples text textures by
    // default, which would make the toast look jagged.
    toast.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.tweens.add({
      targets: toast,
      y: startY - SAVE_TOAST_RISE_PX,
      alpha: 0,
      duration: SAVE_TOAST_DURATION_MS,
      ease: 'Sine.easeOut',
      onComplete: () => toast.destroy(),
    });
  }

  // Death-recovery path when a save exists. Mirrors the HMR rebuild flow
  // (tearDownWorld → buildWorld → restorePlayer) so the respawn re-enters
  // a freshly built world with the player's saved state re-applied. The
  // LDtk source is re-parsed each time rather than cached so any LDtk edits
  // made during the same session are reflected on respawn.
  private respawnFromSave(): void {
    const snapshot = this.saveSlot;
    if (!snapshot) {
      this.scene.restart();
      return;
    }
    let project: LdtkProject;
    try {
      project = parseLdtkProject(ldtkRaw);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          '[respawn] Failed to reparse LDtk on respawn — falling back to scene.restart.',
          error,
        );
      }
      this.scene.restart();
      return;
    }
    this.tearDownWorld();
    try {
      this.buildWorld(project);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(
          '[respawn] buildWorld failed after teardown — falling back to scene.restart.',
          error,
        );
      }
      this.scene.restart();
      return;
    }
    this.restorePlayer(snapshot, project);
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
    this.input.keyboard?.off('keydown-ESC', this.openPauseMenu, this);
  }

  private onProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof Projectile) {
        playOneShot(this, 'bullet_impact_rock');
        projectile.onImpact();
      }
    };

  // Overlap order follows registration: (projectile, trap). The hasExploded
  // and active guards prevent re-firing — overlap callbacks can be queued
  // from a previous tick after the projectile's body was disabled in
  // onImpact, or after the trap was destroyed by an earlier shot in the
  // same tick. Trap.destroy() auto-removes the sprite from the traps group
  // and tears down its listeners (rearm timer, anim events, damage-frame
  // subscription) via the DESTROY hook set up in the Trap constructor.
  private onProjectileHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectileObj, trapObj) => {
      if (!(projectileObj instanceof Projectile)) return;
      if (!(trapObj instanceof Trap)) return;
      if (projectileObj.hasExploded()) return;
      if (!trapObj.active) return;
      playOneShot(this, 'bullet_impact_rock');
      trapObj.destroy();
      projectileObj.onImpact();
    };

  // Order of the (object1, object2) params follows the overlap registration:
  // physics.add.overlap(projectiles, enemies, ...) → (projectile, enemy).
  private onProjectileHitsEnemy: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectileObj, enemyObj) => {
      if (!(projectileObj instanceof Projectile)) return;
      if (!(enemyObj instanceof Enemy)) return;
      // Defense-in-depth: Projectile.onImpact disables the body so this
      // callback shouldn't re-fire after the first hit. Re-check in case the
      // overlap is queued from before the body was disabled in the same tick.
      if (projectileObj.hasExploded()) return;
      if (enemyObj.isDead()) return;
      // Bullets pass through cleanly during a teleport blink (disappear /
      // appear phases): no damage, no impact effect, projectile keeps
      // flying. The boss visually isn't there during the blink.
      if (enemyObj.isInTeleportBlink()) return;
      playOneShot(this, 'bullet_impact_flesh');
      enemyObj.takeDamage(
        projectileObj.getDamage(),
        projectileObj.x,
        projectileObj.y,
      );
      projectileObj.onImpact();
    };

  private onEnemyProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof EnemyProjectile) {
        projectile.onImpact();
      }
    };

  // Overlap order follows the registration: (enemyProjectile, player). The
  // hasExploded guard mirrors onProjectileHitsEnemy — overlap callbacks can
  // be queued from a previous tick before the body was disabled in onImpact.
  // Player.hurt also gates on its own invuln window, so double-call here is
  // harmless, but exploding once keeps the projectile sprite from re-firing
  // damage if invuln expires while the explode animation is still playing.
  private onEnemyProjectileHitsPlayer: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectileObj, playerObj) => {
      if (!(projectileObj instanceof EnemyProjectile)) return;
      if (!(playerObj instanceof Player)) return;
      if (projectileObj.hasExploded()) return;
      if (playerObj.isDead()) return;
      playerObj.hurt(
        projectileObj.getDamage(),
        projectileObj.x,
        projectileObj.y,
        { source: 'projectile' },
      );
      projectileObj.onImpact();
    };

  // Overlap order follows the registration: (player, trap). Player.hurt's own
  // invuln window prevents per-frame ticking, so this fires once per invuln
  // cycle while the player stays in the trap. No need to disable or destroy
  // the trap — re-overlap after invuln expires is the intended re-hit.
  //
  // Traps only fire when the victim is "above" the trap: the victim's body
  // center must sit above the trap's body center. That excludes side-to-side
  // overlaps (walking past a wall-mounted trap at the same elevation) while
  // still catching the natural "step on spikes / drop onto bear trap" cases.
  //
  // Snap traps (`hasDirectContactAnimation`, e.g. the bear trap) trigger
  // when the player is grounded inside the trap's column. The damage
  // itself is deferred to the snap animation's midpoint (see
  // onTrapDamageFrame), so jumping off the trap before the midpoint
  // escapes the bite even though the snap visibly fires. The trap has to
  // be re-armed (isArmed) — a spent snap trap is visually closed and
  // inert until the re-arm timer fires inside Trap. The center-above
  // check filters out under-trap brushes; "grounded" makes sure the
  // player has actually landed on the surface rather than just clipping.
  //
  // Ejector traps (smoke/flame) also delegate damage to the midpoint
  // event — overlap here is a no-op for them; the trap's setPlayerAbove
  // (driven by updateTraps) is what gets the ejection cycle running, and
  // the midpoint event then decides whether to hurt the player.
  private onPlayerHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (playerObj, trapObj) => {
      if (!(playerObj instanceof Player)) return;
      if (!(trapObj instanceof Trap)) return;
      if (playerObj.isDead()) return;

      // Falling sword: inverts the usual "victim above trap" gate. The blade
      // is falling onto the player, so any body overlap is a hit. Other
      // swaying-sword states (idle, snapping, embedded) are inert — the
      // string-snap and the embedded blade don't damage, only the fall does.
      if (trapObj.isFallingSword()) {
        playerObj.hurt(trapObj.getDamage(), trapObj.x, trapObj.y);
        return;
      }
      if (trapObj.getSwayingSwordState() !== null) return;

      if (playerObj.body.center.y >= trapObj.body.center.y) return;

      if (trapObj.hasDirectContactAnimation()) {
        if (!trapObj.isArmed()) return;
        const groundedOnTrap =
          playerObj.body.blocked.down || playerObj.body.touching.down;
        if (!groundedOnTrap) return;
        trapObj.triggerDirectContact();
        return;
      }

      if (trapObj.hasDeferredDamage()) return;

      playerObj.hurt(trapObj.getDamage(), trapObj.x, trapObj.y);
    };

  // Player picks up a drop (ammo or magic shard). Always consumes (clamp
  // behavior lives in Player.addPickup): walking into a drop at max still
  // destroys it, which matches genre convention and keeps the callback
  // branchless.
  //
  // TODO: playOneShot(this, 'pickup') once the audio registry has a pickup
  // entry — symmetric with Chest's chest_open TODO.
  private onPlayerPicksUpAmmo: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (playerObj, ammoObj) => {
      if (!(playerObj instanceof Player)) return;
      if (!(ammoObj instanceof AmmoDrop)) return;
      if (playerObj.isDead()) return;
      playerObj.addPickup(ammoObj.getKind(), ammoObj.getAmount());
      ammoObj.destroy();
    };

  // Implements AmmoDropSpawnerScene structurally. Called by Chest/Enemy via
  // the structural interface, not by name elsewhere — keep the signature in
  // sync with AmmoDropSpawnerScene.spawnAmmoDrop or the structural assertion
  // in those classes will silently break.
  spawnAmmoDrop(kind: PickupKind, x: number, y: number): void {
    const drop = new AmmoDrop(this, x, y, kind);
    this.ammoDrops.add(drop);
  }

  // Mirror of onPlayerHitsTrap for enemies. Enemy.takeDamage doesn't have a
  // built-in invuln window like Player.hurt does, so use the enemy's own
  // 'hurt' state as the re-tick gate: an enemy already in 'hurt' has just
  // been hit and shouldn't take another tick this frame. The hurt state
  // expires in HURT_DURATION_MS (250 ms by default), which is the natural
  // re-tick cadence for an enemy standing on spikes.
  //
  // Snap traps apply the same "fully landed" gate to enemies as to the
  // player, so a bear trap can catch a chasing dog or ghoul but only when
  // they actually step on it.
  private onEnemyHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (enemyObj, trapObj) => {
      if (!(enemyObj instanceof Enemy)) return;
      if (!(trapObj instanceof Trap)) return;
      if (enemyObj.isDead()) return;
      if (enemyObj.getState() === 'hurt') return;

      // Same inverted-gate handling as the player path — a falling sword
      // damages whatever is below it on contact. Other swaying-sword states
      // are inert for enemies too. sourceIsPlayer:false so a trap-only kill
      // doesn't reveal the floating HP bar — combat is meant to track the
      // player's engagement, not collateral environmental hits.
      if (trapObj.isFallingSword()) {
        enemyObj.takeDamage(trapObj.getDamage(), trapObj.x, trapObj.y, {
          sourceIsPlayer: false,
        });
        return;
      }
      if (trapObj.getSwayingSwordState() !== null) return;

      if (enemyObj.body.center.y >= trapObj.body.center.y) return;

      if (trapObj.hasDirectContactAnimation()) {
        if (!trapObj.isArmed()) return;
        const groundedOnTrap =
          enemyObj.body.blocked.down || enemyObj.body.touching.down;
        if (!groundedOnTrap) return;
        trapObj.triggerDirectContact();
        return;
      }

      if (trapObj.hasDeferredDamage()) return;

      enemyObj.takeDamage(trapObj.getDamage(), trapObj.x, trapObj.y, {
        sourceIsPlayer: false,
      });
    };

  // Fired by Trap at the midpoint of its damaging animation. Re-checks
  // current body overlap with the trap so a victim who has been knocked
  // out of the danger zone (or has jumped off) takes nothing — that's
  // the whole point of deferring damage: the trap telegraphs the hit
  // and the victim can react. Both player and enemies are checked so
  // a single midpoint can damage either or both.
  private onTrapDamageFrame = (trap: Trap, side?: TrapDamageSide): void => {
    const damage = trap.getDamage();
    if (
      !this.player.isDead() &&
      this.isInTrapDamageZone(this.player, trap) &&
      this.matchesTrapSide(this.player, trap, side)
    ) {
      this.player.hurt(damage, trap.x, trap.y);
    }
    for (const child of this.enemies.getChildren()) {
      if (!(child instanceof Enemy)) continue;
      if (child.isDead()) continue;
      if (child.getState() === 'hurt') continue;
      if (!this.isInTrapDamageZone(child, trap)) continue;
      if (!this.matchesTrapSide(child, trap, side)) continue;
      // sourceIsPlayer:false — trap damage is environmental and should not
      // flip the enemy into combat (i.e., shouldn't reveal the HP bar). The
      // player engaging combat with traps as the only hit doesn't track.
      child.takeDamage(damage, trap.x, trap.y, { sourceIsPlayer: false });
    }
  };

  // Directional gate for traps that fire one side at a time (e.g. shocker).
  // No-op when `side` is omitted — non-directional traps already gate damage
  // by zone alone. 'left' means the trap's left-side hit; the victim must be
  // to the left of the trap (victim center.x < trap center.x) to be hurt.
  private matchesTrapSide(
    victim: Phaser.Physics.Arcade.Sprite,
    trap: Trap,
    side: TrapDamageSide | undefined,
  ): boolean {
    if (!side) return true;
    const vCenterX = (victim.body as Phaser.Physics.Arcade.Body).center.x;
    const tCenterX = trap.body.center.x;
    return side === 'left' ? vCenterX < tCenterX : vCenterX > tCenterX;
  }

  // Per-kind danger-zone check at the damage-frame instant. Bear-trap snap
  // and overhead ejector both fire from above the body — victim must be
  // overlapping the body AND with its center above the trap's center.
  // Attached-ground ejector (spike) fires from the floor under the trap —
  // victim must be grounded on the trap's anchor tile (same tile-equality
  // condition that triggers the cycle in updateTraps), since the player
  // standing on that tile has center.y at or below the trap's center.
  private isInTrapDamageZone(
    victim: Phaser.Physics.Arcade.Sprite,
    trap: Trap,
  ): boolean {
    const vb = victim.body as Phaser.Physics.Arcade.Body;
    const tb = trap.body;
    if (trap.getEjectorKind() === 'attached-ground') {
      const grounded = vb.blocked.down || vb.touching.down;
      if (!grounded) return false;
      const trapTileX = Math.floor(tb.center.x / TILE_SIZE_PX);
      const trapTileY = Math.floor((tb.bottom + 1) / TILE_SIZE_PX);
      const victimTileX = Math.floor(vb.center.x / TILE_SIZE_PX);
      const victimTileY = Math.floor((vb.bottom + 1) / TILE_SIZE_PX);
      return trapTileX === victimTileX && trapTileY === victimTileY;
    }
    // Overhead (snap + ejector). Prefer the configured damage zone so the
    // hazard area can be larger than the physics body — the body stays
    // tight for bullet/sword hits while the shock column still reaches
    // the player who's standing nearby.
    const zone = trap.getDamageZoneBounds();
    if (zone !== null) {
      if (vb.center.y >= zone.centerY) return false;
      return (
        vb.right > zone.left &&
        vb.left < zone.right &&
        vb.bottom > zone.top &&
        vb.top < zone.bottom
      );
    }
    return (
      vb.center.y < tb.center.y && this.physics.world.overlap(victim, trap)
    );
  }
}
