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

interface LevelSlot {
  // LDtk identifier used to pick per-level ambience.
  identifier: string;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  rendered: RenderedLevel;
}

// Generous padding so adjacent levels are visible before fast falls reach them.
const LEVEL_VISIBILITY_PADDING_PX = 512;

// Wasps and hive excluded from teleport targeting — arbitrary swarm pick and stationary spawner.
const TELEPORT_TARGET_BLOCKLIST: ReadonlySet<string> = new Set([
  'Wasp_spawn',
  'The_hive_spawn',
]);

const HIVE_ANCHORED_IDENTIFIER = 'Wasp_spawn';
const HIVE_BEACON_IDENTIFIER = 'The_hive_spawn';


/**
 * GameScene — the main gameplay scene and world orchestrator.
 *
 * Owns the entire run: it builds the multi-level world from the parsed LDtk
 * project (every level rendered at its world coords, one collision tilemap per
 * level, the A* nav graph, all entities and their colliders), ticks the player /
 * enemies / doors / traps / interactions each frame, and routes the scene-bus
 * events that drive saving, shopping, locked doors, boss defeat, and the portal
 * victory warp. The world is rebuilt IN PLACE — tearDownWorld() then buildWorld()
 * — for HMR LDtk edits, respawn-from-save, and New Game/Quit; buildWorld is NOT
 * idempotent (teardown must precede a second build) and Phaser reuses the scene
 * instance across these rebuilds, so per-scene state that must survive a rebuild
 * (saveSlot, boss-key run progress, the HUD rig) is deliberately held outside the
 * world lifecycle. Heavy subsystems are delegated to per-scene collaborators
 * (GameHud, BossEncounterController, TrapSystem, InteractionManager,
 * EnemyRespawnManager, NavGraph) and this scene wires them together.
 *
 * Inputs:  the parsed LDtk project, PreloadScene's landing flag, player input
 *          (ESC key), scene-bus events from entities, and the persistent
 *          run-progress / save state.
 * Outputs: the live world (sprites, colliders, physics/camera bounds), music and
 *          per-level ambience, floating save/locked-door text, and the
 *          pause/shop/landing/victory sub-scenes it launches.
 * @calledby the Phaser scene manager (lifecycle hooks) and the pause menu, which
 *           reaches across the pause boundary to abandon or restart the run.
 * @calls    the audio module, the LDtk parse/render/collision/nav pipeline, the
 *           entity factory, and its delegated HUD / boss / trap / interaction
 *           collaborators.
 */
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

  // Stores whether to show the landing page — skipped on HMR and scene.restart().
  init(data: { startLanding?: boolean } = {}): void {
    this.shouldShowLanding = data.startLanding ?? false;
  }

  // Builds the world, starts music, and routes to landing or straight gameplay.
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

  // Frames the camera for the title screen — player left, START button right.
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

  // Hands the player control after START fades to black: attaches HUD, starts ambience, then fades the world back in.
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

  // Wipes the run, rebuilds the world, and goes to title or straight gameplay.
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

  // Opens the pause menu and freezes animations; no-op during the landing overlay.
  private openPauseMenu(): void {
    if (this.landingActive) return;
    this.anims.pauseAll();
    this.scene.launch(SCENE_KEYS.PAUSE);
    this.scene.pause();
  }

  // Opens the merchant shop overlay and pauses the scene while the player shops.
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

  // Per-frame tick: player → enemies → boss → traps → doors → respawn → interactions → camera → cull → ambience → sounds.
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

  // Crossfades ambience when the player enters a new level; cached to skip no-op frames.
  private updateAmbience(): void {
    const levelId = this.getCurrentLevelId();
    if (levelId === null) return;
    if (levelId === this.lastAmbienceLevelId) return;
    this.lastAmbienceLevelId = levelId;
    setLevelAmbience(this, levelId);
  }

  // ── GameHudHost contract ──────────────────────────────────────────────────
  getPlayer(): Player {
    return this.player;
  }

  // The round-fight boss the player is currently engaged with, or null.
  getActiveBoss(): Enemy | null {
    return this.activeBoss;
  }

  // Timestamp the arena-escape countdown lapses at, or null when not escaping.
  getEscapeDeadline(): number | null {
    return this.bossController.getEscapeDeadline();
  }

  // BossEncounterHost hook: the controller's fight-reset clears the engagement so
  // the enemy pass won't re-select the boss until the player re-enters.
  clearActiveBoss(): void {
    this.activeBoss = null;
  }

  // EnemyHelperScene hook for enemy 'summon' attacks — delegates to the boss
  // controller, which owns minion spawning/tracking.
  summonEnemyAt(identifier: string, x: number, y: number): Enemy | null {
    return this.bossController.summonEnemyAt(identifier, x, y);
  }

  // Highest per-enemy detection level this frame (drives the HUD corners).
  getMaxAlertLevel(): number {
    return this.maxAlertLevel;
  }

  // LDtk identifier of the level containing the player, or null between levels
  // (mid-jump across a seam). Public: part of the TrapSystemHost contract.
  getCurrentLevelId(): string | null {
    return this.findLevelIdAt(this.player.x, this.player.y);
  }

  // Level identifier containing world point (x, y), or null if between levels.
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

  // Ticks every enemy's AI and resolves active boss, stealth-off flag, and max alert level in one pass.
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


  // Ticks every door's proximity state machine so collider passability is current.
  private updateDoors(): void {
    if (!this.spawned) return;
    const px = this.player.x;
    const py = this.player.y;
    for (const door of this.spawned.doors) {
      door.update(px, py);
    }
  }

  // Caps vertical camera lag so fast falls can't push the player off screen.
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

  // Hides off-screen level containers so Phaser skips their tiles; uses midPoint+displaySize, not scrollX/zoom (which undershoots at zoom 3).
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

  // Returns true if a solid collision tile exists at world (x, y).
  isTileSolidAt(x: number, y: number): boolean {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) return true;
    }
    return false;
  }

  // A* path from foot-point to goal; returns world-px waypoints or null if unreachable.
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

  // World rect of the level containing (x, y), or null if between levels.
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

  // Raw IntGrid tile index at world (x, y), or 0 if empty — drives surface footstep sounds.
  getIntGridValueAt(x: number, y: number): number {
    for (const layer of this.collisionLayers) {
      const tile = layer.getTileAtWorldXY(x, y);
      if (tile) return tile.index;
    }
    return 0;
  }

  // Body-center of the nearest valid teleport target — same level, line of sight, not blocklisted.
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

  // Calls cb for every live (non-dead) enemy in the world.
  forEachEnemy(cb: (enemy: Enemy) => void): void {
    if (!this.enemies) return;
    for (const obj of this.enemies.getChildren()) {
      if (!(obj instanceof Enemy)) continue;
      if (obj.isDead()) continue;
      cb(obj);
    }
  }

  // Coarse LOS test: samples the segment at tile-width intervals, returns true if any sample hits solid.
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

  // True while any boss fight is active (resolved each frame in the enemy pass);
  // every enemy reads this to drop stealth. Cheap field read, one-frame latency.
  isStealthDisabled(): boolean {
    return this.bossEngaged;
  }

  // Spawns a player projectile and notifies all enemies so dodge-reactive ones can respond.
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

  // Alerts nearby stealth enemies to the gunshot position — sound carries through walls.
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

  // Spawns an enemy-fired projectile into the scene's tracked group.
  spawnEnemyProjectile(options: EnemyProjectileSpawnOptions): void {
    const projectile = new EnemyProjectile(this, options);
    projectile.setDepth(ENTITY_DEPTH);
    this.enemyProjectiles.add(projectile);
  }

  // Builds the entire world from LDtk — levels, nav, entities, colliders, camera. NOT idempotent; teardown first.
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

  // Union of all level rects → physics world bounds; returns the union for camera setup.
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

  // Renders every level, builds per-level collision tilemaps, and returns IntGrid data for the nav graph.
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

  // Builds the A* nav graph from IntGrid data.
  private buildNavGraph(navLevels: NavLevel[]): void {
    this.navGraph = new NavGraph(navLevels);
    this.navGraph.buildNodes();
  }

  // Allocates the plain GameObjects.Groups every entity kind is added to (see the
  // field declarations for why none are physics groups).
  private createEntityGroups(): void {
    this.projectiles = this.add.group();
    this.enemies = this.add.group();
    this.enemyProjectiles = this.add.group();
    this.traps = this.add.group();
    this.staticEntities = this.add.group();
    this.ammoDrops = this.add.group();
  }

  // Collects all LDtk entity instances for spawning — filters out defeated bosses and off-level player markers.
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

  // Spawns all entities, wires enemies/traps/statics into their groups, and registers interactables.
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

  // Subscribes all world-lifetime scene events (save, shop, locked door, boss defeat, portal warp).
  private wireWorldEvents(): void {
    this.events.on(SAVE_REQUESTED_EVENT, this.takeSave, this);
    this.events.on(SHOP_REQUESTED_EVENT, this.openShop, this);
    this.events.on(KEY_DOOR_LOCKED_EVENT, this.showKeyDoorMessage, this);
    this.events.on(BOSS_DEFEATED_EVENT, this.onBossDefeated, this);
    this.events.on(PORTAL_WARP_STARTED_EVENT, this.onPortalWarpStarted, this);
    this.events.on(PORTAL_WARP_VANISH_EVENT, this.onPortalWarpVanish, this);
    this.events.on(PORTAL_WARP_COMPLETE_EVENT, this.onPortalWarpComplete, this);
  }

  // Wires all terrain/door/projectile/trap/ammo colliders and overlaps, tracking each for teardown.
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

  // Sets up the follow camera: zoom, lerp, vertical offset, and world bounds.
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

  // Arms the death handler: after a delay, respawns from save or returns to title.
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

  // Adds a new enemy to the world: depth, group, audio bindings, and optional respawn tracking.
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

  // Tethers a wasp to its nearest hive so it loiters there instead of roaming freely.
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

  // Rouses every wasp anchored to this hive — only the struck hive's swarm, not all wasps.
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

  // Fires when a queued respawn clears its time+distance gates — rebuilds and re-wires the enemy.
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

  // Tears down the world in safe dependency order — must precede every buildWorld call except the first.
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

  // Restores a saved player snapshot; falls back to spawn if the saved position is outside the world.
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

  // Snapshots the player into the save slot and shows a "Game Saved" toast above the crystal.
  private takeSave(crystal: Save): void {
    const snapshot = snapshotPlayer(this.player);
    if (!snapshot) return;
    this.saveSlot = snapshot;
    this.showSaveToastAt(crystal.x, crystal.body.top - SAVE_TOAST_OFFSET_Y_PX);
  }

  // Auto-saves the player state (no crystal) — called after boss kills as a checkpoint.
  private autoSave(): void {
    const snapshot = snapshotPlayer(this.player);
    if (!snapshot || !this.player) return;
    this.saveSlot = snapshot;
    this.showSaveToastAt(
      this.player.x,
      this.player.body.top - SAVE_TOAST_OFFSET_Y_PX,
    );
  }

  // Shows a "Game Saved" text that rises and fades at the given world position.
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

  // Shows (or re-triggers) the "find the key" message; reuses one text object to avoid stacking.
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

  // Records the boss kill, grants its key directly (so dying before pickup can't soft-lock the door), clears the arena, and auto-saves.
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

  // Kills every live enemy in the level at (worldX, worldY) via takeDamage so they animate and drop loot.
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

  // Freezes the world and launches VictoryScene; latched so it can't fire twice.
  private triggerVictory(): void {
    this.victoryShown = true;
    this.anims.pauseAll();
    this.scene.launch(SCENE_KEYS.VICTORY);
    this.scene.pause();
  }

  // Disables player input while the portal warp clip plays.
  private onPortalWarpStarted(): void {
    this.player.setControlsEnabled(false);
  }

  // Hides the player sprite and body once the portal swallows them.
  private onPortalWarpVanish(): void {
    this.player.vanishForWarp();
  }

  // Triggers victory when the warp clip ends; latch prevents double-launch.
  private onPortalWarpComplete(): void {
    if (this.victoryShown) return;
    this.triggerVictory();
  }

  // No-save death path: fades the world to black then rebuilds to the landing screen.
  private returnToHomeScreen(): void {
    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.restartRun(true, true);
    });
    cam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);
  }

  // Rebuild-from-save death path: teardown → rebuild → restore snapshot at full HP.
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

  // True if (x, y) lands inside any level's rect — the restore path uses it to
  // decide whether a saved position still fits the (possibly rebuilt) world.
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

  // HMR handler: snapshots player, loads new tilesets, tears down, rebuilds, restores — aborts if parse or load fails.
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

  // Full teardown for state outside the world lifecycle: hot-reload unsub, keys, nav, sounds, HUD, boss.
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

  // Bursts a player projectile against terrain with rock-impact SFX.
  private onProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof Projectile) {
        playOneShot(this, 'bullet_impact_rock');
        projectile.onImpact();
      }
    };

  // Bursts a player projectile against a trap like terrain — trap stays intact.
  private onProjectileHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectileObj, trapObj) => {
      if (!(projectileObj instanceof Projectile)) return;
      if (!(trapObj instanceof Trap)) return;
      if (projectileObj.hasExploded()) return;
      if (!trapObj.active) return;
      playOneShot(this, 'bullet_impact_rock');
      projectileObj.onImpact();
    };

  // Damages an enemy hit by a player projectile; passes through during teleport-blink or round-break; alarms hive swarm.
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

  // Bursts an enemy projectile against terrain (no SFX).
  private onEnemyProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof EnemyProjectile) {
        projectile.onImpact();
      }
    };

  // Hurts the player on enemy projectile contact, then bursts the projectile.
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

  // Player picks up a drop — waits for capacity if ammo/heart is full; other kinds consumed immediately.
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

  // Spawns a pickup drop at (x, y) — implements AmmoDropSpawnerScene structurally; keep signature in sync.
  spawnAmmoDrop(kind: PickupKind, x: number, y: number): void {
    const drop = new AmmoDrop(this, x, y, kind);
    this.ammoDrops.add(drop);
  }

}
