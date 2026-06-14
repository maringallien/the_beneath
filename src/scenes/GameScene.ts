import Phaser from 'phaser';
import {
  clearEntitySounds,
  playMusic,
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
  BOSS_DEFEATED_EVENT,
  BOSS_KEYS,
  CAMERA_ZOOM,
  ENEMY_GUNSHOT_HEARING_RADIUS_PX,
  NAV_MAX_EXPANSIONS,
  ENTITY_DEPTH,
  GENERAL_ENEMY_SPAWN_IDENTIFIER,
  PLAYER_SPAWN_IDENTIFIER,
  KEY_DOOR_LOCKED_EVENT,
  KEY_DOOR_MESSAGE_BOTTOM_MARGIN_PX,
  KEY_DOOR_MESSAGE_COLOR,
  KEY_DOOR_MESSAGE_DEPTH,
  KEY_DOOR_MESSAGE_FADE_IN_MS,
  KEY_DOOR_MESSAGE_FADE_OUT_MS,
  KEY_DOOR_MESSAGE_FONT_FAMILY,
  KEY_DOOR_MESSAGE_FONT_SIZE_PX,
  KEY_DOOR_MESSAGE_HOLD_MS,
  KEY_DOOR_MESSAGE_TEXT,
  LANDING_CAMERA_Y_OFFSET_PX,
  LANDING_PLAYER_VIEWPORT_FRACTION_X,
  LANDING_BLACK_HOLD_MS,
  LANDING_FADE_IN_MS,
  LANDING_FADE_OUT_MS,
  MUSIC_MAIN_THEME_SOUND_ID,
  PLAYER_DEPTH,
  RESPAWN_DELAY_MS,
  PORTAL_WARP_COMPLETE_EVENT,
  PORTAL_WARP_STARTED_EVENT,
  PORTAL_WARP_VANISH_EVENT,
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
import {
  isBossDefeated,
  recordBossDefeated,
  recordKeyCollected,
  resetRunProgress,
} from '../state/runProgress';
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
} from '../entities/Trap';
import { TrapSystem } from './trapSystem';
import { GameHud } from './gameHud';
import {
  BossEncounterController,
  isWithinBounds,
} from '../level/BossEncounterController';
import { ldtkRaw } from '../ldtk/ldtkData';
import {
  getEntities,
  getIntGrid,
  getLevel,
  parseLdtkProject,
} from '../ldtk/parseLdtk';
import type { LdtkEntityInstance, LdtkProject } from '../ldtk/types';
import { subscribeLdtkUpdate } from '../level/HotReloadBus';
import { EnemyRespawnManager, type PendingRespawn } from '../level/EnemyRespawnManager';
import { buildIntGridCollision } from '../level/LevelCollision';
import { NavGraph, type NavLevel } from '../level/NavGraph';
import { findPath } from '../level/NavPathfinder';
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
import {
  restorePlayer,
  snapshotPlayer,
  type PlayerSnapshot,
} from './playerSnapshot';

/**
 * @file scenes/GameScene.ts
 * @description Main gameplay scene and world orchestrator — builds the multi-level world from the parsed LDtk project (every level rendered at its world coords, one collision tilemap per level, the A* nav graph, all entities and colliders), ticks player/enemies/doors/traps/interactions each frame, and routes the scene-bus events for saving, shopping, locked doors, boss defeat, and the portal victory warp. The world is rebuilt IN PLACE (teardown then build) for HMR LDtk edits, respawn-from-save, and New Game/Quit; the build is NOT idempotent (teardown must precede a second build), and since Phaser reuses the scene instance across rebuilds, state that must survive a rebuild (saveSlot, boss-key run progress, the HUD rig) is held outside the world lifecycle. Heavy subsystems delegate to per-scene collaborators (GameHud, BossEncounterController, TrapSystem, InteractionManager, EnemyRespawnManager, NavGraph) that this scene wires together.
 * @module scenes
 */

interface LevelSlot {
  // LDtk identifier used to pick per-level ambience.
  identifier: string;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  rendered: RenderedLevel;
}

// ── World constants ────────────────────────────────────────────────────────
// Level-culling padding and the wasp/hive identifiers used to scope teleport targeting and swarm tethering.

// Generous padding so adjacent levels are visible before fast falls reach them.
const LEVEL_VISIBILITY_PADDING_PX = 512;

// Wasps and hive excluded from teleport targeting — arbitrary swarm pick and stationary spawner.
const TELEPORT_TARGET_BLOCKLIST: ReadonlySet<string> = new Set([
  'Wasp_spawn',
  'The_hive_spawn',
]);

const HIVE_ANCHORED_IDENTIFIER = 'Wasp_spawn';
const HIVE_BEACON_IDENTIFIER = 'The_hive_spawn';

export class GameScene extends Phaser.Scene implements AmmoDropSpawnerScene {
  private player!: Player;
  // One collision tilemap per level; wired against all player/projectile colliders for seamless transitions.
  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  // Per-level visual data for visibility culling — toggling container visibility skips all tile children.
  private levelSlots: LevelSlot[] = [];
  // A* nav graph over the IntGrid collision. null until built.
  private navGraph: NavGraph | null = null;
  // Plain group (not physics group) — Arcade.Group's createCallback would clobber per-body setup.
  private projectiles!: Phaser.GameObjects.Group;
  // Plain group (not physics group) — same reason as projectiles; Enemy creates its own body.
  private enemies!: Phaser.GameObjects.Group;
  // Enemy-fired projectiles — separate group so collider wiring stays per-faction.
  private enemyProjectiles!: Phaser.GameObjects.Group;
  // Passive damage sources (spikes, swords, ejectors); player invuln window gates re-ticks.
  private traps!: Phaser.GameObjects.Group;
  // Gravity-enabled decoration entities (Save, Merchant) that need terrain collisions to settle on the floor.
  private staticEntities!: Phaser.GameObjects.Group;
  // Ammo drops with self-created gravity bodies; terrain collider lands them, player overlap consumes them.
  private ammoDrops!: Phaser.GameObjects.Group;
  // Entity record from the last spawnEntities call — used by teardown to destroy everything at once.
  private spawned: SpawnedEntities | null = null;
  // Trap triggering and damage handlers; rebuilt each world (holds live player/enemies/traps refs).
  private trapSystem: TrapSystem | null = null;
  // All active colliders; teardown disposes them explicitly since Phaser doesn't auto-clean leaked ones.
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  private hotReloadUnsub: (() => void) | null = null;
  // HUD rig (player HP, boss, escape warning, detection corners) — survives HMR, destroyed on quit/shutdown.
  private readonly gameHud = new GameHud(this, this);
  // Boss round-fight orchestration (waves, copies, minions, escape countdown) — teardown() resets per-world state.
  private readonly bossController = new BossEncounterController(
    this,
    this,
    this.gameHud,
  );
  // The round-fight boss currently engaged (encountered + alive); drives the boss HUD.
  private activeBoss: Enemy | null = null;
  // True while any boss is engaged — disables stealth globally, covers plain bosses too (not just round-fight).
  private bossEngaged = false;
  // Highest enemy alert level this frame (0/1/2) — drives the HUD corner brackets.
  private maxAlertLevel = 0;
  // The "find the key" message; reused on retrigger rather than stacked.
  private keyDoorMessageText: Phaser.GameObjects.Text | null = null;
  // Latch to prevent launching VictoryScene twice.
  private victoryShown = false;
  // Hold-E interaction manager; rebuilt each world so HMR gets fresh target references.
  private interactions: InteractionManager | null = null;
  // Merchant shop overlay; created lazily, destroyed on world teardown so HMR gets a fresh one.
  private shopOverlay: ShopOverlay | null = null;
  // Last save checkpoint; survives HMR/rebuilds; null means no save taken → death goes to title.
  private saveSlot: PlayerSnapshot | null = null;
  // Last level ambience was applied for; cached to skip no-op frames.
  private lastAmbienceLevelId: string | null = null;
  // Queues killed enemies for respawn once the time and distance gates clear; rebuilt each world.
  private respawnManager: EnemyRespawnManager | null = null;
  // Set by init() on first boot; routes create() through the landing page path.
  private shouldShowLanding = false;
  // True while the landing page is active — suppresses camera-lag clamping so it doesn't fight the framing.
  private landingActive = false;

  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  /** Records whether to show the landing page — skipped on HMR and scene.restart(). */
  init(data: { startLanding?: boolean } = {}): void {
    this.shouldShowLanding = data.startLanding ?? false;
  }

  /**
   * @function    create
   * @description Build the world, start music, and route to the landing page or straight into gameplay; also wires the HMR subscription and the ESC/shutdown bindings.
   * @calledby Phaser world-build (create) — first boot and scene.restart
   * @calls    src/scenes/GameScene.ts → buildWorld, positionCameraForLanding; the music player; src/scenes/gameHud.ts → attach
   */
  create(): void {
    this.buildWorld(parseLdtkProject(ldtkRaw));
    // Idempotent — a respawn won't restart it; deferred past the first-boot audio lock.
    playMusic(this, MUSIC_MAIN_THEME_SOUND_ID);

    if (this.shouldShowLanding) {
      this.landingActive = true;
      this.cameras.main.stopFollow();
      this.positionCameraForLanding();
      this.player.setControlsEnabled(false);
      this.scene.launch(SCENE_KEYS.LANDING);
    } else {
      this.gameHud.attach();
      setLevelAmbience(this, this.getCurrentLevelId());
    }
    this.hotReloadUnsub = subscribeLdtkUpdate(this.onLdtkChange);
    // Event-based so Phaser's scene-pause naturally disables this when PauseScene is active.
    this.input.keyboard?.on('keydown-ESC', this.openPauseMenu, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onSceneShutdown, this);
  }

  /**
   * @function    positionCameraForLanding
   * @description Frame the camera for the title screen — player on the left third, START button on the right, behind the title overlay.
   * @calledby src/scenes/GameScene.ts → create, restartRun (the landing-page setup)
   * @calls    src/scenes/GameScene.ts → getLevelBoundsAt and the camera's centerOn
   */
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

  /**
   * @function    beginGameplay
   * @description Hand the player control after START fades to black — clear the landing flag, attach/hide then fade the HUD, set ambience, and after a black-hold re-arm the follow camera and re-enable controls. No-op unless the landing overlay is active.
   * @calledby src/scenes/LandingScene.ts → the START commit, at full black
   * @calls    src/scenes/gameHud.ts → attach/hideForLanding/fadeIn, the ambience setter, and the camera/player after a delayed black-hold
   */
  beginGameplay(): void {
    if (!this.landingActive) return;
    this.landingActive = false;
    if (!this.gameHud.isAttached()) {
      this.gameHud.attach();
    }
    // Hidden synchronously before the browser paints so it never flashes during
    // the hold; the gameHud.fadeIn() below reveals it with the world.
    this.gameHud.hideForLanding();
    setLevelAmbience(this, this.getCurrentLevelId());

    this.time.delayedCall(LANDING_BLACK_HOLD_MS, () => {
      this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
      this.cameras.main.setFollowOffset(0, CAMERA_VERTICAL_OFFSET_PX);
      this.cameras.main.fadeIn(LANDING_FADE_IN_MS, 0, 0, 0);
      this.gameHud.fadeIn(LANDING_FADE_IN_MS);
      this.player.setControlsEnabled(true);
    });
  }

  /**
   * @function    restartRun
   * @description Wipe the run, rebuild the world, and route to the title or straight into gameplay — resets boss engagement, run progress, and the victory latch; the HUD is dropped only when returning to the title.
   * @param   showLanding  True routes back to the title overlay; false drops into gameplay.
   * @param   fadeIn       True fades the camera up from a death fade-out (LandingScene fades in simultaneously).
   * @calledby src/scenes/PauseScene.ts → New Game/Quit, src/scenes/VictoryScene.ts → the victory return, src/scenes/GameScene.ts → returnToHomeScreen (no-save death)
   * @calls    src/scenes/GameScene.ts → tearDownWorld, buildWorld, positionCameraForLanding; the run-progress reset; src/scenes/gameHud.ts → the HUD teardown/attach
   */
  restartRun(showLanding: boolean, fadeIn = false): void {
    this.anims.resumeAll();

    this.tearDownWorld();
    // Reset boss engagement (not world-owned, so tearDownWorld leaves it).
    this.activeBoss = null;
    this.gameHud.clearBossRound();
    this.bossController.clearEscape();
    resetRunProgress();
    this.victoryShown = false;

    // HUD survives rebuilds but not the title screen — beginGameplay recreates it on START.
    if (showLanding) {
      this.gameHud.destroy();
    }

    this.shouldShowLanding = showLanding;
    this.buildWorld(parseLdtkProject(ldtkRaw));

    if (showLanding) {
      this.landingActive = true;
      this.cameras.main.stopFollow();
      this.positionCameraForLanding();
      this.player.setControlsEnabled(false);
      if (fadeIn) {
        // Fade up from the death fade-out; LandingScene fades its own camera in simultaneously.
        this.cameras.main.fadeIn(LANDING_FADE_IN_MS, 0, 0, 0);
      }
      this.scene.launch(SCENE_KEYS.LANDING, { fadeIn });
    } else {
      this.landingActive = false;
      if (!this.gameHud.isAttached()) {
        this.gameHud.attach();
      }
      setLevelAmbience(this, this.getCurrentLevelId());
      this.player.setControlsEnabled(true);
    }
  }

  /**
   * @function    openPauseMenu
   * @description Pause animations, launch the pause scene, and pause this scene; no-op during the landing overlay.
   * @calledby Phaser keydown-ESC event (registered in create during gameplay)
   * @calls    the animation system and Phaser scene launch/pause
   */
  private openPauseMenu(): void {
    if (this.landingActive) return;
    this.anims.pauseAll();
    this.scene.launch(SCENE_KEYS.PAUSE);
    this.scene.pause();
  }

  /**
   * @function    openShop
   * @description Lazily build the merchant shop overlay, open it for the current level/player, and pause the scene; no-op during landing or if already open.
   * @param   payload  Which merchant inventory to show ({ kind }).
   * @calledby SHOP_REQUESTED scene-bus event (registered in wireWorldEvents), fired from a merchant interaction
   * @calls    src/ui/ShopOverlay.ts → the shop DOM overlay; its onClose resumes animations and the scene
   */
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
      levelId: this.getCurrentLevelId(),
      player: this.player,
      onClose: () => {
        this.anims.resumeAll();
        this.scene.resume();
      },
    });
    this.scene.pause();
  }

  /**
   * @function    update
   * @description Per-frame tick in fixed order — player, enemies, boss, traps, doors, respawn, interactions, then camera/cull/ambience/spatial-audio; camera-lag clamping is skipped during the landing overlay.
   * @calledby Phaser per-frame update loop
   * @calls    each subsystem's per-frame tick (player/enemy/boss/trap/door/respawn/interaction) and the camera/cull/ambience/audio updates
   */
  update(): void {
    this.player.update();
    this.updateEnemies();
    this.bossController.update();
    this.bossController.updateLeash();
    this.trapSystem?.update();
    this.updateDoors();
    this.respawnManager?.tick(
      this.player.x,
      this.player.y,
      this.time.now,
      this.handleRespawn,
    );
    this.interactions?.update(
      this.player.x,
      this.player.y,
      this.game.loop.delta,
    );
    if (!this.landingActive) {
      this.clampCameraLag();
    }
    this.cullOffscreenLevels();
    this.updateAmbience();
    updateEntitySounds(this.player.x, this.player.y);
  }

  /**
   * @function    updateAmbience
   * @description Crossfade ambience when the player enters a new level, guarded by the cached last level so unchanged frames are no-ops.
   * @calledby src/scenes/GameScene.ts → update (per-frame update loop)
   * @calls    src/scenes/GameScene.ts → getCurrentLevelId and the ambience setter
   */
  private updateAmbience(): void {
    const levelId = this.getCurrentLevelId();
    if (levelId === null) return;
    if (levelId === this.lastAmbienceLevelId) return;
    this.lastAmbienceLevelId = levelId;
    setLevelAmbience(this, levelId);
  }

  // ── Host-contract accessors (GameHudHost / BossEncounterHost / EnemyHelperScene / TrapSystemHost) ───

  /** The live player; consumed by the HUD and boss controller. */
  getPlayer(): Player {
    return this.player;
  }

  /** The round-fight boss the player is currently engaged with, or null. */
  getActiveBoss(): Enemy | null {
    return this.activeBoss;
  }

  /** Timestamp the arena-escape countdown lapses at, or null when not escaping. */
  getEscapeDeadline(): number | null {
    return this.bossController.getEscapeDeadline();
  }

  /** BossEncounterHost hook: the controller's fight-reset clears the engagement so the enemy pass won't re-select the boss until the player re-enters. */
  clearActiveBoss(): void {
    this.activeBoss = null;
  }

  /** EnemyHelperScene hook for enemy 'summon' attacks — delegates to the boss controller, which owns minion spawning/tracking. */
  summonEnemyAt(identifier: string, x: number, y: number): Enemy | null {
    return this.bossController.summonEnemyAt(identifier, x, y);
  }

  /** Highest per-enemy detection level this frame (drives the HUD corners). */
  getMaxAlertLevel(): number {
    return this.maxAlertLevel;
  }

  /** LDtk identifier of the level containing the player, or null between levels (mid-jump across a seam); part of the TrapSystemHost contract. */
  getCurrentLevelId(): string | null {
    return this.findLevelIdAt(this.player.x, this.player.y);
  }

  /**
   * @function    findLevelIdAt
   * @description LDtk identifier of the level containing world point (x, y), or null when the point lands in no level (a seam) — scans the cached level slots and returns the first rect to contain it.
   * @param   x, y  A world-pixel point.
   * @returns the containing level's LDtk identifier, or null.
   * @calledby src/scenes/GameScene.ts → getCurrentLevelId, src/scenes/trapSystem.ts → update (the TrapSystemHost contract)
   * @calls    —
   */
  findLevelIdAt(x: number, y: number): string | null {
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

  /**
   * @function    updateEnemies
   * @description Tick every enemy's AI and, in one pass, refresh activeBoss (first encountered round-fight boss alive), bossEngaged (any boss in play), and maxAlertLevel for this frame; all three clear when no enemies group exists yet.
   * @calledby src/scenes/GameScene.ts → update (per-frame update loop)
   * @calls    each enemy's update and its boss/alert state queries
   */
  private updateEnemies(): void {
    if (!this.enemies) {
      this.activeBoss = null;
      this.bossEngaged = false;
      this.maxAlertLevel = 0;
      return;
    }
    const children = this.enemies.getChildren();
    let active: Enemy | null = null;
    let bossEngaged = false;
    let maxAlert = 0;
    for (const obj of children) {
      if (!(obj instanceof Enemy)) continue;
      obj.update(this.player);
      if (!obj.active) continue;
      if (
        active === null &&
        obj.isRoundFight() &&
        obj.hasEncountered() &&
        !obj.isDead()
      ) {
        active = obj;
      }
      // Engaged = encountered OR in conflict (covers stingless bosses).
      if (
        obj.isBoss() &&
        !obj.isDead() &&
        (obj.hasEncountered() || obj.isInConflict())
      ) {
        bossEngaged = true;
      }
      const level = obj.getAlertLevel();
      if (level > maxAlert) maxAlert = level;
    }
    this.activeBoss = active;
    this.bossEngaged = bossEngaged;
    this.maxAlertLevel = maxAlert;
  }


  /**
   * @function    updateDoors
   * @description Advance every door's proximity open/close state machine so collider passability is current; no-op before the world is spawned.
   * @calledby src/scenes/GameScene.ts → update (per-frame update loop)
   * @calls    src/entities/Door.ts → update with the player position
   */
  private updateDoors(): void {
    if (!this.spawned) return;
    const px = this.player.x;
    const py = this.player.y;
    for (const door of this.spawned.doors) {
      door.update(px, py);
    }
  }

  /**
   * @function    clampCameraLag
   * @description Cap vertical camera lag so fast falls can't push the player off screen — clamps scrollY to within the max vertical lag of the ideal follow position (raw pixels, matching Phaser's own follow math).
   * @calledby src/scenes/GameScene.ts → update (per-frame update loop), except while the landing overlay frames the camera
   * @calls    —
   */
  private clampCameraLag(): void {
    const cam = this.cameras.main;
    // RAW pixels, not zoom-divided — matches Phaser's own follow target calculation.
    const idealScrollY =
      this.player.y - CAMERA_VERTICAL_OFFSET_PX - cam.height / 2;
    cam.scrollY = Phaser.Math.Clamp(
      cam.scrollY,
      idealScrollY - CAMERA_MAX_VERTICAL_LAG_PX,
      idealScrollY + CAMERA_MAX_VERTICAL_LAG_PX,
    );
  }

  /**
   * @function    cullOffscreenLevels
   * @description Hide off-screen level containers so Phaser skips their tiles, and pause/resume their glow-flicker tweens — uses midPoint and display size, not scrollX/zoom (which undershoots at zoom 3); the unchanged-visibility early-out also gates the tween pause/resume to real transitions.
   * @calledby src/scenes/GameScene.ts → update (per-frame update loop)
   * @calls    each level slot's container visibility and its tweens
   */
  private cullOffscreenLevels(): void {
    const cam = this.cameras.main;
    const halfDispW = cam.displayWidth * 0.5;
    const halfDispH = cam.displayHeight * 0.5;
    const left = cam.midPoint.x - halfDispW - LEVEL_VISIBILITY_PADDING_PX;
    const top = cam.midPoint.y - halfDispH - LEVEL_VISIBILITY_PADDING_PX;
    const right = cam.midPoint.x + halfDispW + LEVEL_VISIBILITY_PADDING_PX;
    const bottom = cam.midPoint.y + halfDispH + LEVEL_VISIBILITY_PADDING_PX;

    for (const slot of this.levelSlots) {
      const layers = slot.rendered.layers;
      if (layers.length === 0) continue;
      const visible =
        right > slot.worldX &&
        left < slot.worldX + slot.pxWid &&
        bottom > slot.worldY &&
        top < slot.worldY + slot.pxHei;
      // Skip if already at the right visibility — also gates tween pause/resume to real transitions.
      if (layers[0].container.visible === visible) continue;
      for (const layer of layers) {
        layer.container.setVisible(visible);
      }
      // Pause glow-flicker tweens off-camera — they'd tick on the CPU even when invisible.
      for (const tween of slot.rendered.animations.tweens) {
        if (visible) tween.resume();
        else tween.pause();
      }
    }
  }

  /**
   * @function    isTileSolidAt
   * @description True if any level's collision layer has a colliding tile at world (x, y).
   * @param   x, y  A world-pixel point.
   * @returns whether a solid collision tile exists there.
   * @calledby src/scenes/trapSystem.ts → update (TrapSystemHost) and src/entities/enemyLeapProbes.ts → the leap probes (EnemyHelperScene)
   * @calls    each collision layer's getTileAtWorldXY
   */
  isTileSolidAt(x: number, y: number): boolean {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) return true;
    }
    return false;
  }

  /**
   * @function    findEnemyPath
   * @description A* path from a foot-point to a goal, mapping node ids back to world points; null if the nav graph is missing, either endpoint lands off-graph, or no path exists within the expansion budget.
   * @param   startX, startY  The enemy foot point.
   * @param   goalX, goalY    The target world point.
   * @returns an array of world-pixel waypoints, or null.
   * @calledby src/entities/EnemyNavFollower.ts → grounded enemy navigation routing around walls (EnemyHelperScene)
   * @calls    src/level/NavGraph.ts → nodeAt and src/level/NavPathfinder.ts → findPath
   */
  findEnemyPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
  ): ReadonlyArray<{ x: number; y: number }> | null {
    const graph = this.navGraph;
    if (!graph) return null;
    const startId = graph.nodeAt(startX, startY);
    if (startId < 0) return null;
    const goalId = graph.nodeAt(goalX, goalY);
    if (goalId < 0) return null;
    const ids = findPath(graph, startId, goalId, NAV_MAX_EXPANSIONS);
    if (!ids) return null;
    return ids.map((id) => {
      const n = graph.node(id);
      return { x: n.x, y: n.y };
    });
  }

  /**
   * @function    getLevelBoundsAt
   * @description World rect of the level containing (x, y), or null at a seam — scans the cached level slots for the first rect to contain the point.
   * @param   x, y  A world-pixel point.
   * @returns the containing level's { worldX, worldY, pxWid, pxHei }, or null.
   * @calledby src/scenes/GameScene.ts → positionCameraForLanding, getNearestEnemy, killEnemiesInLevel; src/level/BossEncounterController.ts → arena bounds; src/entities/enemyLeapProbes.ts (EnemyHelperScene)
   * @calls    —
   */
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

  /**
   * @function    getIntGridValueAt
   * @description Raw IntGrid tile index at world (x, y), or 0 when no tile is present — drives surface footstep sounds.
   * @param   x, y  A world-pixel point.
   * @returns the tile index there, or 0.
   * @calledby src/entities/Player.ts and src/entities/Enemy.ts → the footstep-surface audio path (EnemyHelperScene)
   * @calls    each collision layer's getTileAtWorldXY
   */
  getIntGridValueAt(x: number, y: number): number {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile) return tile.index;
    }
    return 0;
  }

  /**
   * @function    getNearestEnemy
   * @description Body-center of the nearest valid teleport target — same level, in line of sight, not blocklisted; skips dead, off-level, and blocklisted (wasp/hive) targets. Null if the searcher is between levels or nothing qualifies.
   * @param   x, y  The searcher's world point.
   * @returns the nearest qualifying enemy's body center, or null.
   * @calledby src/entities/Player.ts → resolving a teleport-blink target
   * @calls    src/scenes/GameScene.ts → getLevelBoundsAt, isLineBlocked; each enemy's body center
   */
  getNearestEnemy(x: number, y: number): { x: number; y: number } | null {
    if (!this.enemies) return null;
    // Scope to the player's level; bail if they're between levels.
    const bounds = this.getLevelBoundsAt(x, y);
    if (!bounds) return null;
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
      // Skip if the target's body center is in a different level.
      if (
        targetX < bounds.worldX ||
        targetX >= bounds.worldX + bounds.pxWid ||
        targetY < bounds.worldY ||
        targetY >= bounds.worldY + bounds.pxHei
      ) {
        continue;
      }
      if (this.isLineBlocked(x, y, targetX, targetY)) continue;
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

  /**
   * @function    forEachEnemy
   * @description Run cb for every live (non-dead) enemy in the world; no-op before the world is built.
   * @param   cb  Callback run per live enemy.
   * @calledby src/scenes/GameScene.ts → alertEnemiesToGunshot; src/level/BossEncounterController.ts → enemy-wide sweeps (EnemyHelperScene)
   * @calls    cb per non-dead enemy in the group
   */
  forEachEnemy(cb: (enemy: Enemy) => void): void {
    if (!this.enemies) return;
    for (const obj of this.enemies.getChildren()) {
      if (!(obj instanceof Enemy)) continue;
      if (obj.isDead()) continue;
      cb(obj);
    }
  }

  /**
   * @function    isLineBlocked
   * @description Coarse LOS test — samples the segment at tile-width intervals; true if any interior sample lands on a colliding tile, false for a zero-length segment.
   * @param   x1, y1, x2, y2  The two world-point endpoints.
   * @returns whether the line of sight is blocked.
   * @calledby src/scenes/GameScene.ts → getNearestEnemy; src/entities/Enemy.ts → its line-of-sight gates (EnemyHelperScene)
   * @calls    each collision layer's getTileAtWorldXY at the sampled points
   */
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

  /** True while any boss fight is active (resolved each frame in the enemy pass); every enemy reads this to drop stealth — cheap field read, one-frame latency. */
  isStealthDisabled(): boolean {
    return this.bossEngaged;
  }

  /**
   * @function    spawnProjectile
   * @description Spawn a depth-set player projectile into the player projectile group and tell every enemy where it fired so dodge-reactive ones can respond.
   * @param   options  The projectile spawn parameters.
   * @calledby src/entities/Player.ts → the player's ranged attack
   * @calls    the Projectile constructor and each enemy's notifyPlayerProjectileFired
   */
  spawnProjectile(options: ProjectileSpawnOptions): void {
    const projectile = new Projectile(this, options);
    projectile.setDepth(ENTITY_DEPTH);
    this.projectiles.add(projectile);
    if (this.enemies) {
      for (const obj of this.enemies.getChildren()) {
        if (obj instanceof Enemy) {
          obj.notifyPlayerProjectileFired(projectile.x, projectile.y);
        }
      }
    }
  }

  /**
   * @function    alertEnemiesToGunshot
   * @description Call hearGunshot on every enemy within the hearing radius (squared-distance test, no LOS — sound carries through walls); no-op while stealth is disabled.
   * @param   x, y  The gunshot world point.
   * @calledby src/entities/Player.ts → the player firing a gun
   * @calls    src/scenes/GameScene.ts → forEachEnemy and each enemy's hearGunshot
   */
  alertEnemiesToGunshot(x: number, y: number): void {
    if (this.isStealthDisabled()) return;
    const radiusSq =
      ENEMY_GUNSHOT_HEARING_RADIUS_PX * ENEMY_GUNSHOT_HEARING_RADIUS_PX;
    this.forEachEnemy((enemy) => {
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      if (dx * dx + dy * dy <= radiusSq) enemy.hearGunshot(x, y);
    });
  }

  /**
   * @function    spawnEnemyProjectile
   * @description Spawn a depth-set enemy-fired projectile into the separate enemy-projectile group.
   * @param   options  The enemy-projectile spawn parameters.
   * @calledby src/entities/Enemy.ts → an enemy's ranged attack (EnemyHelperScene)
   * @calls    the EnemyProjectile constructor
   */
  spawnEnemyProjectile(options: EnemyProjectileSpawnOptions): void {
    const projectile = new EnemyProjectile(this, options);
    projectile.setDepth(ENTITY_DEPTH);
    this.enemyProjectiles.add(projectile);
  }

  /**
   * @function    buildWorld
   * @description Build the entire world from LDtk in order — world bounds, levels, nav graph, entity groups, spawned entities, trap system, wired world events and colliders, the follow camera/bounds, and the armed death handler. NOT idempotent; teardown must precede a second build.
   * @param   project  The parsed LDtk project.
   * @calledby src/scenes/GameScene.ts → create, restartRun, respawnFromSave, onLdtkChange (always after teardown)
   * @calls    src/scenes/GameScene.ts → setWorldBoundsFromLevels, renderAllLevels, buildNavGraph, createEntityGroups, collectWorldEntities, spawnAndWireEntities, wireWorldEvents, wireColliders, setupCameraAndBounds, armPlayerDeathHandler
   */
  private buildWorld(project: LdtkProject): void {
    const bounds = this.setWorldBoundsFromLevels(project);
    const navLevels = this.renderAllLevels(project);
    this.buildNavGraph(navLevels);
    this.createEntityGroups();
    const allEntities = this.collectWorldEntities(project);
    const spawned = this.spawnAndWireEntities(project, allEntities);
    const trapSystem = new TrapSystem(
      this,
      this.player,
      this.enemies,
      spawned.traps,
    );
    this.trapSystem = trapSystem;
    trapSystem.attachDamageFrameListeners(TRAP_DAMAGE_FRAME_EVENT);
    this.wireWorldEvents();
    this.wireColliders(spawned, trapSystem);
    this.setupCameraAndBounds(bounds);
    this.armPlayerDeathHandler();
  }

  /**
   * @function    setWorldBoundsFromLevels
   * @description Set the physics world bounds to the union of all level rects and return that union for camera setup.
   * @param   project  The parsed LDtk project.
   * @returns the bounding union as { minX, minY, maxX, maxY }.
   * @calledby src/scenes/GameScene.ts → buildWorld (its first step)
   * @calls    the physics world's setBounds
   */
  private setWorldBoundsFromLevels(project: LdtkProject): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
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
    return { minX, minY, maxX, maxY };
  }

  /**
   * @function    renderAllLevels
   * @description Render every level, push a LevelSlot and a collision layer per level, and return the per-level NavLevel data for the nav graph; throws if no tileset has a loadable path to back the invisible collision tilemap.
   * @param   project  The parsed LDtk project.
   * @returns the per-level NavLevel data.
   * @calledby src/scenes/GameScene.ts → buildWorld (after the world bounds are set)
   * @calls    src/level/LevelRenderer.ts → renderLevel, the IntGrid reader, and src/level/LevelCollision.ts → buildIntGridCollision
   */
  private renderAllLevels(project: LdtkProject): NavLevel[] {
    const tilesetUid = project.defs.tilesets.find((ts) => ts.relPath != null)?.uid;
    if (tilesetUid == null) {
      throw new Error(
        'No tileset with a loadable relPath — cannot back the invisible collision tilemap',
      );
    }
    const collisionTextureKey = tilesetTextureKey(tilesetUid);

    const navLevels: NavLevel[] = [];
    for (const lvl of project.levels) {
      const rendered = renderLevel(this, project, lvl);
      const intGrid = getIntGrid(lvl);
      this.levelSlots.push({
        identifier: lvl.identifier,
        worldX: lvl.worldX,
        worldY: lvl.worldY,
        pxWid: lvl.pxWid,
        pxHei: lvl.pxHei,
        rendered,
      });

      if (intGrid) {
        const collisionLayer = buildIntGridCollision(
          this,
          intGrid,
          collisionTextureKey,
          lvl.worldX,
          lvl.worldY,
        );
        this.collisionLayers.push(collisionLayer);
        navLevels.push({
          worldX: lvl.worldX,
          worldY: lvl.worldY,
          cWid: intGrid.cWid,
          cHei: intGrid.cHei,
          gridSize: intGrid.gridSize,
          csv: intGrid.csv,
        });
      }
    }
    return navLevels;
  }

  /** Build the A* nav graph from the per-level IntGrid data. */
  private buildNavGraph(navLevels: NavLevel[]): void {
    this.navGraph = new NavGraph(navLevels);
    this.navGraph.buildNodes();
  }

  /**
   * @function    createEntityGroups
   * @description Allocate the fresh plain projectile/enemy/enemy-projectile/trap/static/ammo groups every entity kind is added to (plain, not physics — see the field declarations for why a physics group's createCallback would clobber per-body setup).
   * @calledby src/scenes/GameScene.ts → buildWorld (before entities are spawned)
   * @calls    the scene's group factory
   */
  private createEntityGroups(): void {
    this.projectiles = this.add.group();
    this.enemies = this.add.group();
    this.enemyProjectiles = this.add.group();
    this.traps = this.add.group();
    this.staticEntities = this.add.group();
    this.ammoDrops = this.add.group();
  }

  /**
   * @function    collectWorldEntities
   * @description Collect the spawnable LDtk entity list (filtering out defeated bosses and off-level player markers), seed the boss controller's spawn sites, and register spatial-audio anchors for sound-emitting decorations.
   * @param   project  The parsed LDtk project.
   * @returns the spawnable entity list.
   * @calledby src/scenes/GameScene.ts → buildWorld (before the entities are spawned)
   * @calls    the LDtk entity reader, the run-progress defeated-boss check, the boss controller's setSpawnSites, and registerEntitySound
   */
  private collectWorldEntities(project: LdtkProject): LdtkEntityInstance[] {
    const allEntities = project.levels
      .flatMap(getEntities)
      .filter((e) => !isBossDefeated(e.__identifier))
      .filter(
        (e) =>
          e.__identifier !== PLAYER_SPAWN_IDENTIFIER ||
          e.__levelId === STARTING_LEVEL_IDENTIFIER,
      );
    // Spawn-site markers have no factory; the boss controller reads their positions for wave placement.
    this.bossController.setSpawnSites(
      allEntities
        .filter((e) => e.__identifier === GENERAL_ENEMY_SPAWN_IDENTIFIER)
        .map((e) => pivotCenter(e)),
    );
    // Register spatial audio anchors for decoration entities that emit sound but have no factory.
    for (const instance of allEntities) {
      const { x, y } = pivotCenter(instance);
      registerEntitySound(this, instance.__identifier, instance.iid, x, y);
    }
    return allEntities;
  }

  /**
   * @function    spawnAndWireEntities
   * @description Spawn all entities, add enemies/traps/statics to their groups, resolve and depth-set the player, and register interactables (only key-locked doors interact); throws if no player spawned.
   * @param   project      The parsed LDtk project.
   * @param   allEntities  The collected spawnable instances.
   * @returns the spawned-entities record.
   * @calledby src/scenes/GameScene.ts → buildWorld (after the entity groups exist)
   * @calls    src/entities/EntityFactory.ts → spawnEntities; src/scenes/GameScene.ts → attachEnemyToWorld, anchorSwarmerToHome; src/entities/InteractionManager.ts → registerAll
   */
  private spawnAndWireEntities(
    project: LdtkProject,
    allEntities: LdtkEntityInstance[],
  ): SpawnedEntities {
    this.respawnManager = new EnemyRespawnManager();
    const spawned = spawnEntities(this, allEntities);
    for (const enemy of spawned.enemies) {
      this.attachEnemyToWorld(enemy);
    }
    // Tether wasps to their hives now that all enemies are constructed.
    for (const enemy of spawned.enemies) {
      this.anchorSwarmerToHome(enemy);
    }
    for (const trap of spawned.traps) {
      trap.setDepth(ENTITY_DEPTH);
      this.traps.add(trap);
    }
    // staticEntities gets the terrain collider — gravity:true ones settle; gravity:false is a no-op.
    for (const other of spawned.others) {
      this.staticEntities.add(other);
    }
    for (const save of spawned.saves) {
      this.staticEntities.add(save);
    }
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

    this.interactions = new InteractionManager(this, this.player);
    this.interactions.registerAll(spawned.chests);
    this.interactions.registerAll(spawned.saves);
    this.interactions.registerAll(spawned.merchants);
    // Only key-locked doors interact; plain doors return canInteract() false.
    this.interactions.registerAll(
      spawned.doors.filter((door) => door.isKeyLocked()),
    );
    this.interactions.registerAll(spawned.portals);
    return spawned;
  }

  /**
   * @function    wireWorldEvents
   * @description Subscribe this scene's handlers to the world-lifetime scene-bus events (save, shop, locked door, boss defeat, portal warp); tearDownWorld removes the symmetric off() bindings.
   * @calledby src/scenes/GameScene.ts → buildWorld
   * @calls    the scene event emitter's on() for each world event
   */
  private wireWorldEvents(): void {
    this.events.on(SAVE_REQUESTED_EVENT, this.takeSave, this);
    this.events.on(SHOP_REQUESTED_EVENT, this.openShop, this);
    this.events.on(KEY_DOOR_LOCKED_EVENT, this.showKeyDoorMessage, this);
    this.events.on(BOSS_DEFEATED_EVENT, this.onBossDefeated, this);
    this.events.on(PORTAL_WARP_STARTED_EVENT, this.onPortalWarpStarted, this);
    this.events.on(PORTAL_WARP_VANISH_EVENT, this.onPortalWarpVanish, this);
    this.events.on(PORTAL_WARP_COMPLETE_EVENT, this.onPortalWarpComplete, this);
  }

  /**
   * @function    wireColliders
   * @description Register every terrain/door/projectile/trap/ammo collider and overlap and push each onto the tracked list so teardown can dispose them; door colliders use group colliders so respawn-added enemies are covered without re-wiring.
   * @param   spawned     The spawned entities (for the door list).
   * @param   trapSystem  The trap system, for its overlap callbacks.
   * @calledby src/scenes/GameScene.ts → buildWorld (after the trap system is constructed)
   * @calls    the Arcade physics collider/overlap factory and the trap system's overlap callbacks
   */
  private wireColliders(
    spawned: SpawnedEntities,
    trapSystem: TrapSystem,
  ): void {
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
      this.colliders.push(this.physics.add.collider(this.enemies, layer));
      this.colliders.push(this.physics.add.collider(this.staticEntities, layer));
      // The swaying sword flips to gravity-on when triggered; static traps make this a no-op.
      this.colliders.push(this.physics.add.collider(this.traps, layer));
      this.colliders.push(
        this.physics.add.collider(
          this.enemyProjectiles,
          layer,
          this.onEnemyProjectilePlatformImpact,
          undefined,
          this,
        ),
      );
      this.colliders.push(
        this.physics.add.collider(this.ammoDrops, layer),
      );
    }

    if (spawned.doors.length > 0) {
      const doors = spawned.doors as Door[];
      this.colliders.push(
        this.physics.add.collider(
          this.player,
          doors,
          undefined,
          (_player, door) => !(door as Door).isPassable(),
          this,
        ),
      );
      // Group collider — respawn-added enemies are covered without re-wiring.
      this.colliders.push(
        this.physics.add.collider(
          this.enemies,
          doors,
          undefined,
          (_enemy, door) => !(door as Door).isPassable(),
          this,
        ),
      );
      this.colliders.push(
        this.physics.add.collider(
          this.projectiles,
          doors,
          this.onProjectilePlatformImpact,
          (_projectile, door) => !(door as Door).isPassable(),
          this,
        ),
      );
      this.colliders.push(
        this.physics.add.collider(
          this.enemyProjectiles,
          doors,
          this.onEnemyProjectilePlatformImpact,
          (_projectile, door) => !(door as Door).isPassable(),
          this,
        ),
      );
    }

    this.colliders.push(
      this.physics.add.overlap(
        this.projectiles,
        this.enemies,
        this.onProjectileHitsEnemy,
        undefined,
        this,
      ),
    );
    this.colliders.push(
      this.physics.add.overlap(
        this.projectiles,
        this.traps,
        this.onProjectileHitsTrap,
        undefined,
        this,
      ),
    );
    this.colliders.push(
      this.physics.add.overlap(
        this.enemyProjectiles,
        this.player,
        this.onEnemyProjectileHitsPlayer,
        undefined,
        this,
      ),
    );
    this.colliders.push(
      this.physics.add.overlap(
        this.player,
        this.traps,
        trapSystem.onPlayerHitsTrap,
        undefined,
        this,
      ),
    );
    this.colliders.push(
      this.physics.add.overlap(
        this.enemies,
        this.traps,
        trapSystem.onEnemyHitsTrap,
        undefined,
        this,
      ),
    );
    this.colliders.push(
      this.physics.add.overlap(
        this.player,
        this.ammoDrops,
        this.onPlayerPicksUpAmmo,
        undefined,
        this,
      ),
    );
  }

  /**
   * @function    setupCameraAndBounds
   * @description Configure the main camera — zoom, player-follow with lerp, vertical offset, and world bounds (roundPixels keeps pixel art crisp).
   * @param   bounds  The world-rect union from the level pass.
   * @calledby src/scenes/GameScene.ts → buildWorld (after colliders are wired)
   * @calls    the camera's zoom/follow/offset/bounds setters
   */
  private setupCameraAndBounds(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): void {
    this.cameras.main.setZoom(CAMERA_ZOOM);
    // roundPixels=true snaps sprites to whole pixels in the WebGL batch — keeps pixel-art crisp.
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    // Positive Y offset pulls camera up, giving headroom above the player.
    this.cameras.main.setFollowOffset(0, CAMERA_VERTICAL_OFFSET_PX);
    this.cameras.main.setBounds(
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    );
  }

  /**
   * @function    armPlayerDeathHandler
   * @description On player death, schedule a delayed respawn-from-save or, with no save, a return to the home screen; captures the current player so a rebuilt one can't fire the stale handler.
   * @calledby src/scenes/GameScene.ts → buildWorld (its final step)
   * @calls    the player's one-time PLAYER_DIED_EVENT, then src/scenes/GameScene.ts → respawnFromSave or returnToHomeScreen
   */
  private armPlayerDeathHandler(): void {
    const diedPlayer = this.player;
    this.player.once(PLAYER_DIED_EVENT, () => {
      this.time.delayedCall(RESPAWN_DELAY_MS, () => {
        if (this.player !== diedPlayer) return;
        if (this.saveSlot) {
          this.respawnFromSave();
        } else {
          this.returnToHomeScreen();
        }
      });
    });
  }

  /**
   * @function    attachEnemyToWorld
   * @description Add a new enemy to the world — depth, the enemy group, its sound registrations, and (optionally) a respawn enqueue when it later dies; the already-dead guard prevents enqueuing an enemy destroyed by HMR teardown.
   * @param   enemy            The enemy to attach.
   * @param   trackForRespawn  False to skip the respawn enqueue (e.g. minions).
   * @calledby src/scenes/GameScene.ts → spawnAndWireEntities, handleRespawn; src/level/BossEncounterController.ts → reinforcements/copies
   * @calls    the moving/walk/periodic/sequence sound registrars and the respawn manager
   */
  attachEnemyToWorld(enemy: Enemy, trackForRespawn = true): void {
    enemy.setDepth(ENTITY_DEPTH);
    this.enemies.add(enemy);
    registerMovingEntitySound(this, enemy.getIdentifier(), enemy);
    registerEnemyWalkSound(this, enemy.getIdentifier(), enemy);
    registerEntityPeriodicSound(this, enemy.getIdentifier(), enemy);
    registerEntitySoundSequence(this, enemy.getIdentifier(), enemy);
    // isDead() guard prevents enqueuing an enemy destroyed by HMR teardown as a pending respawn.
    if (trackForRespawn) {
      enemy.once(Phaser.GameObjects.Events.DESTROY, () => {
        if (!enemy.isDead()) return;
        this.respawnManager?.recordDeath(enemy, this.time.now);
      });
    }
  }

  /**
   * @function    anchorSwarmerToHome
   * @description Tether a wasp to its nearest hive spawn (or its own spawn if none) so it loiters there instead of roaming freely; non-wasps are ignored.
   * @param   enemy  Only wasps are anchored; others are ignored.
   * @calledby src/scenes/GameScene.ts → spawnAndWireEntities, handleRespawn (after all enemies exist)
   * @calls    the enemy spawn-point getters and setHomeAnchor
   */
  private anchorSwarmerToHome(enemy: Enemy): void {
    if (enemy.getIdentifier() !== HIVE_ANCHORED_IDENTIFIER) return;
    const spawn = enemy.getSpawnPoint();
    let bestX = spawn.x;
    let bestY = spawn.y;
    let bestDistSq = Infinity;
    for (const obj of this.enemies.getChildren()) {
      if (!(obj instanceof Enemy)) continue;
      if (obj.getIdentifier() !== HIVE_BEACON_IDENTIFIER) continue;
      const hive = obj.getSpawnPoint();
      const dx = hive.x - spawn.x;
      const dy = hive.y - spawn.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestX = hive.x;
        bestY = hive.y;
      }
    }
    enemy.setHomeAnchor(bestX, bestY);
  }

  /**
   * @function    alarmHiveSwarm
   * @description Raise the home alarm on every wasp anchored to the struck hive's spawn point — only that hive's swarm, matched by anchor position, not all wasps.
   * @param   hive  The struck hive whose anchor identifies its swarm.
   * @calledby src/scenes/GameScene.ts → onProjectileHitsEnemy, when a projectile hits a hive
   * @calls    each matching wasp's raiseHomeAlarm
   */
  private alarmHiveSwarm(hive: Enemy): void {
    const anchor = hive.getSpawnPoint();
    for (const obj of this.enemies.getChildren()) {
      if (!(obj instanceof Enemy)) continue;
      if (obj.getIdentifier() !== HIVE_ANCHORED_IDENTIFIER) continue;
      const home = obj.getHomeAnchor();
      if (home && home.x === anchor.x && home.y === anchor.y) {
        obj.raiseHomeAlarm();
      }
    }
  }

  /**
   * @function    handleRespawn
   * @description Rebuild and re-wire a queued enemy once its respawn clears the time and distance gates — re-registers sound, world-attaches, and hive-anchors it; no-op if the factory yields nothing.
   * @param   entry  The pending respawn (identifier, spawn point, iid, loiter path).
   * @calledby src/level/EnemyRespawnManager.ts → tick (passed as the respawn callback from update)
   * @calls    src/entities/EntityFactory.ts → respawnEnemyAt; registerEntitySound; src/scenes/GameScene.ts → attachEnemyToWorld, anchorSwarmerToHome
   */
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
    this.anchorSwarmerToHome(enemy);
  };

  /**
   * @function    tearDownWorld
   * @description Tear down the world in safe dependency order (order matters so callbacks can't fire on dead sprites) — stop the camera follow, clear audio anchors, dispose every collider/layer/level/group/entity, reset the nav graph and per-world collaborators, unsubscribe the world events, and kill any in-flight locked-door message. Must precede every world build except the first.
   * @calledby src/scenes/GameScene.ts → restartRun, respawnFromSave, onLdtkChange (before each rebuild)
   * @calls    each collider/layer/group destroy, the boss-controller/interaction/shop teardown, and the symmetric event off() bindings
   */
  private tearDownWorld(): void {
    this.cameras.main.stopFollow();

    // Clear audio anchors before rebuild — otherwise the next buildWorld double-registers them.
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

    this.navGraph = null;

    for (const slot of this.levelSlots) {
      destroyRenderedLevel(slot.rendered);
    }
    this.levelSlots = [];

    // Clear pending respawns — the fresh world already spawns all enemies from LDtk.
    if (this.respawnManager) {
      this.respawnManager.clear();
      this.respawnManager = null;
    }

    if (this.projectiles) {
      this.projectiles.clear(true, true);
      this.projectiles.destroy();
    }

    if (this.enemyProjectiles) {
      // Destroy each EnemyProjectile first so its DESTROY handler unsubscribes WORLD_BOUNDS.
      this.enemyProjectiles.clear(true, true);
      this.enemyProjectiles.destroy();
    }

    // Boss controller destroys reinforcements/minions not in spawned.enemies, then resets state.
    this.bossController.teardown();

    // destroyEntities handles the children; clear(false,false) just empties the group shell.
    if (this.enemies) {
      this.enemies.clear(false, false);
      this.enemies.destroy();
    }

    if (this.traps) {
      this.traps.clear(false, false);
      this.traps.destroy();
    }

    if (this.staticEntities) {
      this.staticEntities.clear(false, false);
      this.staticEntities.destroy();
    }

    if (this.ammoDrops) {
      // AmmoDrops are dynamic (not in SpawnedEntities) so clear(true,true) destroys them.
      this.ammoDrops.clear(true, true);
      this.ammoDrops.destroy();
    }

    if (this.spawned) {
      destroyEntities(this.spawned);
      this.spawned = null;
    }
    this.trapSystem = null;

    // Destroy interactions after destroyEntities so canInteract() can't fire on dead sprites.
    if (this.interactions) {
      this.interactions.destroy();
      this.interactions = null;
    }

    // Force-close without onClose — calling it would resume a half-torn-down scene.
    if (this.shopOverlay) {
      this.shopOverlay.destroy();
      this.shopOverlay = null;
    }

    this.events.off(SAVE_REQUESTED_EVENT, this.takeSave, this);
    this.events.off(SHOP_REQUESTED_EVENT, this.openShop, this);
    this.events.off(KEY_DOOR_LOCKED_EVENT, this.showKeyDoorMessage, this);
    this.events.off(BOSS_DEFEATED_EVENT, this.onBossDefeated, this);
    this.events.off(PORTAL_WARP_STARTED_EVENT, this.onPortalWarpStarted, this);
    this.events.off(PORTAL_WARP_VANISH_EVENT, this.onPortalWarpVanish, this);
    this.events.off(PORTAL_WARP_COMPLETE_EVENT, this.onPortalWarpComplete, this);

    // Kill any in-flight locked-door message so it doesn't outlive this world.
    if (this.keyDoorMessageText) {
      this.tweens.killTweensOf(this.keyDoorMessageText);
      this.keyDoorMessageText.destroy();
      this.keyDoorMessageText = null;
    }
  }

  /**
   * @function    restorePlayerSnapshot
   * @description Restore the player and recenter the camera from a saved snapshot, or leave the fresh LDtk spawn standing if the saved position is outside the (possibly rebuilt) world.
   * @param   snapshot  The captured player state.
   * @param   project   The parsed LDtk project, for the in-world check.
   * @calledby src/scenes/GameScene.ts → respawnFromSave, onLdtkChange (after the world is rebuilt)
   * @calls    src/scenes/playerSnapshot.ts → restorePlayer, gated by isInsideAnyLevel
   */
  private restorePlayerSnapshot(
    snapshot: PlayerSnapshot,
    project: LdtkProject,
  ): void {
    restorePlayer(
      this.player,
      this.cameras.main,
      snapshot,
      this.isInsideAnyLevel(snapshot.x, snapshot.y, project),
    );
  }

  /**
   * @function    takeSave
   * @description Store a player snapshot as the save slot and float a "Game Saved" toast above the crystal; no-op if the snapshot fails.
   * @param   crystal  The save crystal that was activated.
   * @calledby SAVE_REQUESTED scene-bus event (registered in wireWorldEvents), fired from a save crystal
   * @calls    src/scenes/playerSnapshot.ts → snapshotPlayer and src/scenes/GameScene.ts → showSaveToastAt
   */
  private takeSave(crystal: Save): void {
    const snapshot = snapshotPlayer(this.player);
    if (!snapshot) return;
    this.saveSlot = snapshot;
    this.showSaveToastAt(crystal.x, crystal.body.top - SAVE_TOAST_OFFSET_Y_PX);
  }

  /**
   * @function    autoSave
   * @description Auto-save the player state (no crystal) as a checkpoint after a boss kill — stores the snapshot and floats a toast above the player; no-op if the snapshot fails.
   * @calledby src/scenes/GameScene.ts → onBossDefeated
   * @calls    src/scenes/playerSnapshot.ts → snapshotPlayer and src/scenes/GameScene.ts → showSaveToastAt
   */
  private autoSave(): void {
    const snapshot = snapshotPlayer(this.player);
    if (!snapshot || !this.player) return;
    this.saveSlot = snapshot;
    this.showSaveToastAt(
      this.player.x,
      this.player.body.top - SAVE_TOAST_OFFSET_Y_PX,
    );
  }

  /**
   * @function    showSaveToastAt
   * @description Float a LINEAR-filtered "Game Saved" text that rises and fades from the given world position, then destroys itself (LINEAR filtering avoids the global pixel-art jag).
   * @param   startX, startY  The toast's starting world position.
   * @calledby src/scenes/GameScene.ts → takeSave, autoSave
   * @calls    the text factory and the tween system
   */
  private showSaveToastAt(startX: number, startY: number): void {
    const toast = this.add.text(startX, startY, SAVE_TOAST_TEXT, {
      fontFamily: SAVE_TOAST_FONT_FAMILY,
      fontSize: `${SAVE_TOAST_FONT_SIZE_PX}px`,
      color: SAVE_TOAST_COLOR,
    });
    toast.setOrigin(0.5, 1);
    toast.setResolution(CAMERA_ZOOM);
    toast.setDepth(SAVE_TOAST_DEPTH);
    // LINEAR filter prevents the global pixelArt nearest-sample from jagging the text.
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

  /**
   * @function    showKeyDoorMessage
   * @description Show (or re-trigger) the screen-bottom "find the key" message that fades in, holds, then fades out and destroys — reuses one text object so a re-trigger refreshes it rather than stacking, killing any in-flight fade first.
   * @calledby KEY_DOOR_LOCKED scene-bus event (registered in wireWorldEvents), fired from a key-locked door
   * @calls    the text factory and the tween system
   */
  private showKeyDoorMessage(): void {
    const view = this.cameras.main.worldView;
    const x = view.centerX;
    const y = view.bottom - KEY_DOOR_MESSAGE_BOTTOM_MARGIN_PX;

    if (!this.keyDoorMessageText) {
      const created = this.add.text(x, y, KEY_DOOR_MESSAGE_TEXT, {
        fontFamily: KEY_DOOR_MESSAGE_FONT_FAMILY,
        fontSize: `${KEY_DOOR_MESSAGE_FONT_SIZE_PX}px`,
        color: KEY_DOOR_MESSAGE_COLOR,
      });
      created.setOrigin(0.5, 1);
      created.setResolution(CAMERA_ZOOM);
      created.setDepth(KEY_DOOR_MESSAGE_DEPTH);
      created.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      created.once(Phaser.GameObjects.Events.DESTROY, () => {
        if (this.keyDoorMessageText === created) this.keyDoorMessageText = null;
      });
      this.keyDoorMessageText = created;
    }

    const text = this.keyDoorMessageText;
    // Kill any in-flight fade so the refresh doesn't fight a pending fade-out.
    this.tweens.killTweensOf(text);
    text.setPosition(x, y);
    text.setAlpha(0);
    this.tweens.add({
      targets: text,
      alpha: 1,
      duration: KEY_DOOR_MESSAGE_FADE_IN_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: text,
          alpha: 0,
          delay: KEY_DOOR_MESSAGE_HOLD_MS,
          duration: KEY_DOOR_MESSAGE_FADE_OUT_MS,
          ease: 'Sine.easeIn',
          onComplete: () => text.destroy(),
        });
      },
    });
  }

  /**
   * @function    onBossDefeated
   * @description Persist the boss defeat and grant its key directly (so dying before pickup can't soft-lock the door), kill the rest of that level's enemies, and auto-save a checkpoint.
   * @param   identifier    The defeated boss.
   * @param   bossX, bossY  Its world position, for the level sweep.
   * @calledby BOSS_DEFEATED scene-bus event (registered in wireWorldEvents)
   * @calls    the run-progress recorders, src/scenes/GameScene.ts → killEnemiesInLevel, autoSave
   */
  private onBossDefeated(
    identifier: string,
    bossX: number,
    bossY: number,
  ): void {
    recordBossDefeated(identifier);
    const grantedKey = BOSS_KEYS[identifier];
    if (grantedKey) recordKeyCollected(grantedKey);
    this.killEnemiesInLevel(bossX, bossY);
    this.autoSave();
  }

  /**
   * @function    killEnemiesInLevel
   * @description Deal lethal, knockback-skipped, environmental damage (via takeDamage, so they animate and drop loot) to every live enemy within the bounds of the level at (worldX, worldY).
   * @param   worldX, worldY  A point in the target level.
   * @calledby src/scenes/GameScene.ts → onBossDefeated, to clear the arena
   * @calls    src/scenes/GameScene.ts → getLevelBoundsAt and each enemy's takeDamage
   */
  private killEnemiesInLevel(worldX: number, worldY: number): void {
    if (!this.enemies) return;
    const bounds = this.getLevelBoundsAt(worldX, worldY);
    for (const obj of [...this.enemies.getChildren()]) {
      if (!(obj instanceof Enemy)) continue;
      if (!obj.active || obj.isDead()) continue;
      if (bounds && !isWithinBounds(obj.x, obj.y, bounds)) continue;
      obj.takeDamage(Number.MAX_SAFE_INTEGER, obj.x, {
        skipKnockback: true,
        sourceIsPlayer: false,
      });
    }
  }

  /**
   * @function    triggerVictory
   * @description Set the victory latch, freeze the world (pause all animations), launch the victory overlay, and pause this scene; the latch keeps it from firing twice.
   * @calledby src/scenes/GameScene.ts → onPortalWarpComplete
   * @calls    the animation system and Phaser scene launch/pause
   */
  private triggerVictory(): void {
    this.victoryShown = true;
    this.anims.pauseAll();
    this.scene.launch(SCENE_KEYS.VICTORY);
    this.scene.pause();
  }

  /**
   * @function    onPortalWarpStarted
   * @description Lock player controls while the portal warp clip plays.
   * @calledby PORTAL_WARP_STARTED scene-bus event (registered in wireWorldEvents)
   * @calls    the player's setControlsEnabled
   */
  private onPortalWarpStarted(): void {
    this.player.setControlsEnabled(false);
  }

  /**
   * @function    onPortalWarpVanish
   * @description Hide the player sprite and body once the portal swallows them.
   * @calledby PORTAL_WARP_VANISH scene-bus event (registered in wireWorldEvents)
   * @calls    the player's vanishForWarp
   */
  private onPortalWarpVanish(): void {
    this.player.vanishForWarp();
  }

  /**
   * @function    onPortalWarpComplete
   * @description Launch the victory flow once the warp clip ends; the victory latch prevents a double-launch.
   * @calledby PORTAL_WARP_COMPLETE scene-bus event (registered in wireWorldEvents)
   * @calls    src/scenes/GameScene.ts → triggerVictory
   */
  private onPortalWarpComplete(): void {
    if (this.victoryShown) return;
    this.triggerVictory();
  }

  /**
   * @function    returnToHomeScreen
   * @description No-save death path — fade the camera out and, at full black, rebuild the run to the title with a fade-in.
   * @calledby src/scenes/GameScene.ts → armPlayerDeathHandler, when there is no save slot
   * @calls    the camera fade-out and, on completion, src/scenes/GameScene.ts → restartRun
   */
  private returnToHomeScreen(): void {
    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.restartRun(true, true);
    });
    cam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);
  }

  /**
   * @function    respawnFromSave
   * @description Rebuild-from-save death path — reparse LDtk, teardown, rebuild, then restore the snapshot at full HP; falls back to scene.restart if the slot is missing or the reparse/rebuild throws.
   * @calledby src/scenes/GameScene.ts → armPlayerDeathHandler, when a save slot exists
   * @calls    the LDtk reparse, src/scenes/GameScene.ts → tearDownWorld, buildWorld, restorePlayerSnapshot
   */
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
    // Override to full HP — don't respawn wounded.
    this.restorePlayerSnapshot(
      { ...snapshot, health: this.player.getMaxHealth() },
      project,
    );
  }

  /**
   * @function    isInsideAnyLevel
   * @description True if (x, y) lands inside any level's rect — scans the project's level rects.
   * @param   x, y     A world-pixel point.
   * @param   project  The parsed LDtk project to test against.
   * @returns whether the point falls within any level.
   * @calledby src/scenes/GameScene.ts → restorePlayerSnapshot, deciding whether a saved position still fits the (possibly rebuilt) world
   * @calls    —
   */
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

  /**
   * @function    onLdtkChange
   * @description HMR handler — snapshot the player, load new tilesets, teardown, rebuild, restore; on a parse/load failure the old world keeps running, while a post-teardown build failure leaves a logged partial state. Mid-write truncated reads are skipped silently.
   * @param   rawJson  The freshly written LDtk project JSON.
   * @calledby src/level/HotReloadBus.ts → the LDtk hot-reload subscription (registered in create), when the project file changes in dev
   * @calls    the LDtk parse, src/level/TilesetRegistry.ts → loadTilesetsAtRuntime, src/scenes/GameScene.ts → tearDownWorld, buildWorld, restorePlayerSnapshot
   */
  private onLdtkChange = async (rawJson: string): Promise<void> => {
    let project: LdtkProject;
    try {
      project = parseLdtkProject(rawJson);
    } catch (error) {
      // LDtk doesn't save atomically — skip truncated mid-write reads silently.
      if (import.meta.env.DEV) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        console.warn(
          `[HMR] Skipping reload — LDtk JSON not yet valid: ${message}`,
        );
      }
      return;
    }

    const playerSnapshot = snapshotPlayer(this.player);

    // Failed tileset load aborts without teardown — old world keeps running.
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
      this.restorePlayerSnapshot(playerSnapshot, project);
    }
  };

  /**
   * @function    onSceneShutdown
   * @description Full teardown for state outside the world lifecycle — unsubscribe hot-reload, remove the ESC handler, clear audio anchors and nav, tear down the HUD/boss/escape state, and kill any in-flight locked-door message.
   * @calledby Phaser SHUTDOWN event (registered once in create)
   * @calls    the hot-reload unsub, src/scenes/gameHud.ts → destroyForSceneShutdown, the boss-controller teardown, and the tween/text destroy
   */
  private onSceneShutdown(): void {
    if (this.hotReloadUnsub) {
      this.hotReloadUnsub();
      this.hotReloadUnsub = null;
    }
    clearEntitySounds();
    this.input.keyboard?.off('keydown-ESC', this.openPauseMenu, this);
    this.navGraph = null;
    this.gameHud.destroyForSceneShutdown();
    this.activeBoss = null;
    this.bossController.clearEscape();
    this.victoryShown = false;
    if (this.keyDoorMessageText) {
      this.tweens.killTweensOf(this.keyDoorMessageText);
      this.keyDoorMessageText.destroy();
      this.keyDoorMessageText = null;
    }
  }

  /**
   * @function    onProjectilePlatformImpact
   * @description Burst a player projectile against terrain with rock-impact SFX.
   * @param   projectile  The Arcade collision object; acted on only if a Projectile.
   * @calledby Phaser physics collide (registered as the player-projectile / terrain and impassable-door collider in wireColliders)
   * @calls    the one-shot audio player and the projectile's onImpact
   */
  private onProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof Projectile) {
        playOneShot(this, 'bullet_impact_rock');
        projectile.onImpact();
      }
    };

  /**
   * @function    onProjectileHitsTrap
   * @description Burst a player projectile against a trap like terrain — the trap takes no damage; already-exploded projectiles are skipped.
   * @param   projectileObj, trapObj  The Arcade overlap pair; ignored unless a live Projectile and Trap.
   * @calledby Phaser physics overlap (registered as the player-projectile / trap overlap in wireColliders)
   * @calls    the one-shot audio player and the projectile's onImpact
   */
  private onProjectileHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectileObj, trapObj) => {
      if (!(projectileObj instanceof Projectile)) return;
      if (!(trapObj instanceof Trap)) return;
      if (projectileObj.hasExploded()) return;
      if (!trapObj.active) return;
      playOneShot(this, 'bullet_impact_rock');
      projectileObj.onImpact();
    };

  /**
   * @function    onProjectileHitsEnemy
   * @description Damage an enemy hit by a player projectile, alarm the hive swarm on a hive hit, and burst the projectile; dead/teleport-blinking/round-break enemies are passed through.
   * @param   projectileObj, enemyObj  The Arcade overlap pair; ignored unless a live Projectile and Enemy.
   * @calledby Phaser physics overlap (registered as the player-projectile / enemy overlap in wireColliders)
   * @calls    the audio player, the enemy's takeDamage, src/scenes/GameScene.ts → alarmHiveSwarm, and the projectile's onImpact
   */
  private onProjectileHitsEnemy: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectileObj, enemyObj) => {
      if (!(projectileObj instanceof Projectile)) return;
      if (!(enemyObj instanceof Enemy)) return;
      if (projectileObj.hasExploded()) return;
      if (enemyObj.isDead()) return;
      if (enemyObj.isInTeleportBlink()) return; // boss isn't visually there
      if (enemyObj.isInRoundBreak()) return; // invulnerable "Round N" beat
      playOneShot(this, 'bullet_impact_flesh');
      enemyObj.takeDamage(projectileObj.getDamage(), projectileObj.x);
      if (enemyObj.getIdentifier() === HIVE_BEACON_IDENTIFIER) {
        this.alarmHiveSwarm(enemyObj);
      }
      projectileObj.onImpact();
    };

  /**
   * @function    onEnemyProjectilePlatformImpact
   * @description Burst an enemy projectile against terrain (no SFX).
   * @param   projectile  The Arcade collision object; acted on only if an EnemyProjectile.
   * @calledby Phaser physics collide (registered as the enemy-projectile / terrain and impassable-door collider in wireColliders)
   * @calls    the projectile's onImpact
   */
  private onEnemyProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof EnemyProjectile) {
        projectile.onImpact();
      }
    };

  /**
   * @function    onEnemyProjectileHitsPlayer
   * @description Hurt the player (flagged as a projectile source) on enemy projectile contact, then burst the projectile; already-exploded projectiles are skipped.
   * @param   projectileObj, playerObj  The Arcade overlap pair; ignored unless a live EnemyProjectile and Player.
   * @calledby Phaser physics overlap (registered as the enemy-projectile / player overlap in wireColliders)
   * @calls    the player's hurt and the projectile's onImpact
   */
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

  /**
   * @function    onPlayerPicksUpAmmo
   * @description Apply a drop and destroy it — leaves it in place when at capacity (ammo/heart full); other kinds are consumed immediately.
   * @param   playerObj, ammoObj  The Arcade overlap pair; ignored unless a live Player and AmmoDrop.
   * @calledby Phaser physics overlap (registered as the player / ammo-drop overlap in wireColliders)
   * @calls    the player's canPickUp gate and addPickup, then the drop's destroy
   */
  // TODO: playOneShot(this, 'pickup') once the audio registry has a pickup entry.
  private onPlayerPicksUpAmmo: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (playerObj, ammoObj) => {
      if (!(playerObj instanceof Player)) return;
      if (!(ammoObj instanceof AmmoDrop)) return;
      if (playerObj.isDead()) return;
      if (!playerObj.canPickUp(ammoObj.getKind())) return;
      playerObj.addPickup(ammoObj.getKind(), ammoObj.getAmount());
      ammoObj.destroy();
    };

  /**
   * @function    spawnAmmoDrop
   * @description Add a new AmmoDrop to the ammo-drops group at (x, y) — implements AmmoDropSpawnerScene structurally; keep the signature in sync with that interface.
   * @param   kind  The pickup kind.
   * @param   x, y  The spawn world position.
   * @calledby src/entities/Chest.ts and src/entities/Enemy.ts → loot drops (the AmmoDropSpawnerScene contract)
   * @calls    the AmmoDrop constructor
   */
  spawnAmmoDrop(kind: PickupKind, x: number, y: number): void {
    const drop = new AmmoDrop(this, x, y, kind);
    this.ammoDrops.add(drop);
  }

}
