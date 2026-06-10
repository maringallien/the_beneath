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
  FINAL_BOSS_IDENTIFIER,
  VICTORY_DELAY_MS,
  VICTORY_FREEZE_MARGIN_MS,
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
  allBossesDefeated,
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
import { NavDebugOverlay } from '../level/navDebugOverlay';
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
import { entityAnimFullKey } from '../entities/entityRegistryLoader';
import {
  restorePlayer,
  snapshotPlayer,
  type PlayerSnapshot,
} from './playerSnapshot';

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

// Hive-tethered swarmer wiring. At spawn each wasp is anchored to the nearest
// hive's position, so it loiters around — and leashes its chase to — the hive
// (see Enemy.setHomeAnchor / behavior.homeLeashRange) instead of drifting
// around the player. A wasp whose world has no hive (e.g. boss-wave
// reinforcements) falls back to its own spawn point.
const HIVE_ANCHORED_IDENTIFIER = 'Wasp_spawn';
const HIVE_BEACON_IDENTIFIER = 'The_hive_spawn';


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
  // Enemy navigation graph (A* pathfinding over the IntGrid collision) + its
  // developer overlay (toggled with N). Built in buildWorld, rebuilt on hot
  // reload. null until the world is built.
  private navGraph: NavGraph | null = null;
  private navOverlay: NavDebugOverlay | null = null;
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
  // Trap triggering + trap damage handlers (src/scenes/trapSystem.ts). Built
  // per world in buildWorld (it holds the per-build player/enemies/traps
  // references); nulled by tearDownWorld alongside `spawned`.
  private trapSystem: TrapSystem | null = null;
  // Phaser doesn't auto-destroy colliders when their bodies vanish — leaked
  // colliders hold references to dead bodies and can throw nullrefs on the
  // next collision check. Track every collider so tearDownWorld can dispose
  // them explicitly.
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  private hotReloadUnsub: (() => void) | null = null;
  // The gameplay overlays (player HUD, boss HUD, escape warning, detection
  // corners) and their per-frame drivers, owned by GameHud
  // (src/scenes/gameHud.ts). attach() is called in create()/beginGameplay()
  // after buildWorld so this.player exists; the rig survives HMR untouched
  // and is destroyed explicitly on Quit-to-title / scene shutdown.
  private readonly gameHud = new GameHud(this, this);
  // Boss round-fight orchestration (convergence, reinforcement waves,
  // self-copy splits, summoned minions, arena-escape countdown), owned by
  // BossEncounterController (src/level/BossEncounterController.ts). Per-scene
  // like the HUD rig; teardown() resets its per-world state.
  private readonly bossController = new BossEncounterController(
    this,
    this,
    this.gameHud,
  );
  // The round-fight boss the player is currently engaged with (encountered and
  // alive), resolved each frame in updateEnemies. null when none — drives the
  // BossHud's visibility and which boss's HP/round it reflects.
  private activeBoss: Enemy | null = null;
  // True while any boss is engaged (encountered + alive) anywhere in the world,
  // recomputed each frame in updateEnemies. Drives isStealthDisabled(): during
  // a boss fight stealth is off for every enemy. Distinct from activeBoss, which
  // only tracks round-fight bosses — this also covers plain bosses
  // (The_blood_king, The_hive) so their arenas disable stealth too.
  private bossEngaged = false;
  // Aggregate detection level across all enemies this frame (0 normal,
  // 1 investigating, 2 conflict), resolved in updateEnemies and pushed to the
  // HUD corner brackets on the next render. Highest-wins.
  private maxAlertLevel = 0;
  // Active "you must find the key" message, or null when none is showing.
  // Reused (its fade restarted) rather than stacked when retriggered, so
  // repeated locked-door attempts don't pile up overlapping text.
  private keyDoorMessageText: Phaser.GameObjects.Text | null = null;
  // Latched true when the victory flow fires so the all-bosses-defeated check
  // can't launch VictoryScene twice. Reset on restartRun / scene shutdown.
  private victoryShown = false;
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
  // null = no save has been taken yet → death returns to the title/home screen.
  private saveSlot: PlayerSnapshot | null = null;
  // Last LDtk level identifier we applied ambience for. Cached on the scene
  // instance (cleared on scene.restart) so updateAmbience can skip the rect
  // test on frames where the player hasn't moved between levels.
  private lastAmbienceLevelId: string | null = null;
  // Tracks killed non-boss enemies waiting to respawn at their original LDtk
  // position once both gates clear: ENEMY_RESPAWN_MIN_TIME_MS has elapsed since
  // death AND the player has moved ENEMY_RESPAWN_MIN_DISTANCE_PX from the spawn
  // point. Owned by the buildWorld/tearDownWorld lifecycle: instantiated
  // alongside the enemies group, cleared on teardown so HMR/respawn-from-save
  // rebuild from a clean slate.
  private respawnManager: EnemyRespawnManager | null = null;
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
    // Start the looping soundtrack as the home screen comes up. It's owned by
    // the game-global sound manager (so it rides through the landing→gameplay
    // handoff, level changes, and respawns without restarting) and gated only
    // by the music preference. Idempotent, so a respawn re-running create()
    // never restarts it. Audio is still locked here on first boot, so the
    // MusicPlayer defers actual playback to the first user gesture.
    playMusic(this, MUSIC_MAIN_THEME_SOUND_ID);

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
      this.gameHud.attach();
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
    // N toggles the navigation-graph developer overlay (nodes/edges/paths).
    this.input.keyboard?.on('keydown-N', this.toggleNavDebug, this);
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

  // Called the instant LandingScene's fade-out lands at full black. Performs the
  // deferred setup create() skipped on the landing path, then — after a beat of
  // darkness — reveals the world. Idempotent: a stray second call (e.g. a queued
  // FADE_OUT_COMPLETE from a double-click) is a no-op.
  //
  // The HUD is a DOM overlay the camera fade can't touch, so it's built hidden
  // here and faded in alongside the camera at reveal time — otherwise it would
  // float over the black canvas for the whole hold, popping in before the world.
  // Ambience starts now (under the black) so sound rises through the darkness
  // before the visual reveal. Camera follow, world fade-in, HUD fade-in, and
  // control hand-off are grouped into the post-hold reveal so they land together
  // (the follow lerp from the landing framing then reads as a gentle settle as
  // the world appears). The delayedCall rides this scene's clock — only
  // LandingScene stops after the handoff; GameScene stays alive.
  beginGameplay(): void {
    if (!this.landingActive) return;
    this.landingActive = false;
    if (!this.gameHud.isAttached()) {
      this.gameHud.attach();
    }
    // Hidden synchronously before the browser paints, so it never flashes during
    // the hold; the gameHud.fadeIn() below reveals it with the world.
    this.gameHud.hideForLanding();
    setLevelAmbience(this, this.getCurrentLevelId());

    this.time.delayedCall(LANDING_BLACK_HOLD_MS, () => {
      // Re-enable the follow camera using the same parameters buildWorld() would
      // have applied. From the locked landing framing the camera lerps to the
      // centered-on-player position as the world fades in — a gentle settle.
      this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
      this.cameras.main.setFollowOffset(0, CAMERA_VERTICAL_OFFSET_PX);
      this.cameras.main.fadeIn(LANDING_FADE_IN_MS, 0, 0, 0);
      this.gameHud.fadeIn(LANDING_FADE_IN_MS);
      this.player.setControlsEnabled(true);
    });
  }

  // Public entry point for the pause menu's New Game and Quit. Abandons the
  // current run and rebuilds the world IN PLACE — the same tearDownWorld() +
  // buildWorld() the respawn path uses — rather than scene.restart(). Phaser
  // reuses the scene instance across a restart, so its fields keep the previous
  // world's state; buildWorld is explicitly NOT idempotent and would stack a
  // second world on top of the stale one, freezing the scene. PauseScene calls
  // this across the pause boundary (the instance is alive while paused), then
  // resumes this scene and stops itself.
  //
  // showLanding=true returns to the title/home framing (Quit); false starts a
  // fresh run straight into gameplay (New Game).
  //
  // fadeIn (only meaningful with showLanding) fades the rebuilt title screen up
  // from black instead of snapping it on — used by the no-save death path, which
  // fades the dying world OUT first, then hands here to fade the home screen
  // back IN. Both the world (this scene's camera) and the title overlay
  // (LandingScene's camera) fade together, mirroring the START transition.
  restartRun(showLanding: boolean, fadeIn = false): void {
    // PauseScene froze the global animation manager when the menu opened;
    // resume it so the rebuilt world's sprites animate.
    this.anims.resumeAll();

    this.tearDownWorld();
    // Boss engagement state isn't world-owned, so tearDownWorld leaves it.
    // Reset it here (mirrors onSceneShutdown) so the fresh run starts boss-free
    // without a dangling reference to the just-destroyed boss.
    this.activeBoss = null;
    this.gameHud.clearBossRound();
    this.bossController.clearEscape();
    // New Game / Quit / Return-to-Title all abandon the current run, so wipe the
    // persistent boss-key progress and re-arm the victory latch. This is the
    // ONLY place run progress is cleared — death/respawn and HMR deliberately
    // keep it (the boss-key store survives those so a key can't be lost).
    resetRunProgress();
    this.victoryShown = false;

    // The HUD survives tearDownWorld and re-binds to the new player through its
    // per-frame update(), so a fresh run reuses it. The title screen shows no
    // HUD though, so drop it when returning there — beginGameplay recreates it
    // when the player presses START.
    if (showLanding) {
      this.gameHud.destroy();
    }

    this.shouldShowLanding = showLanding;
    this.buildWorld(parseLdtkProject(ldtkRaw));

    if (showLanding) {
      // Title/home framing — identical to the first-boot landing path.
      this.landingActive = true;
      this.cameras.main.stopFollow();
      this.positionCameraForLanding();
      this.player.setControlsEnabled(false);
      if (fadeIn) {
        // Camera is sitting on full black from the death fade-out. Fade the
        // world back up; LandingScene fades its own camera (title + button) in
        // on create via the matching flag, so the two reveal together.
        this.cameras.main.fadeIn(LANDING_FADE_IN_MS, 0, 0, 0);
      }
      this.scene.launch(SCENE_KEYS.LANDING, { fadeIn });
    } else {
      // Straight into gameplay. buildWorld already started the follow camera,
      // so just (re)attach the HUD + ambience and hand the player control.
      this.landingActive = false;
      if (!this.gameHud.isAttached()) {
        this.gameHud.attach();
      }
      setLevelAmbience(this, this.getCurrentLevelId());
      this.player.setControlsEnabled(true);
    }
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
      levelId: this.getCurrentLevelId(),
      player: this.player,
      onClose: () => {
        this.anims.resumeAll();
        this.scene.resume();
      },
    });
    this.scene.pause();
  }

  update(): void {
    this.player.update();
    this.updateEnemies();
    // After updateEnemies has resolved this.activeBoss: drive round-fight
    // convergence (pull every arena enemy onto the player) and spawn each
    // round's reinforcement wave. Placed here, not in updateBossHud (a render
    // callback), so enemy spawns happen on the update tick after the AI loop.
    this.bossController.update();
    // After convergence/reinforcements: if the player has fled the arena, run
    // the escape countdown (warning + break-off pursuit) and reset the fight
    // when it lapses.
    this.bossController.updateLeash();
    this.trapSystem?.update();
    this.updateDoors();
    // Respawn scan runs after the per-entity ticks so any enemy that died
    // this frame (DESTROY fired during updateEnemies → recordDeath enqueued)
    // is in the registry before we scan. Internal throttle gates the scan
    // to ENEMY_RESPAWN_CHECK_INTERVAL_MS regardless of frame rate.
    this.respawnManager?.tick(
      this.player.x,
      this.player.y,
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
    updateEntitySounds(this.player.x, this.player.y);
    if (this.navOverlay?.isVisible()) {
      this.navOverlay.render(this.collectNavDebugPaths());
    }
  }

  // Toggles the navigation-graph developer overlay (bound to N).
  private toggleNavDebug(): void {
    this.navOverlay?.toggle();
  }

  // Gathers every live enemy's current nav path for the debug overlay. Only
  // called while the overlay is visible.
  private collectNavDebugPaths(): ReadonlyArray<
    ReadonlyArray<{ x: number; y: number }>
  > {
    const paths: ReadonlyArray<{ x: number; y: number }>[] = [];
    this.forEachEnemy((enemy) => {
      const p = enemy.getNavPathForDebug();
      if (p && p.length >= 2) paths.push(p);
    });
    return paths;
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

  // ── GameHudHost contract ──────────────────────────────────────────────────
  // Live state the HUD rig reads each render frame. The player getter hands
  // out the CURRENT instance — world rebuilds replace it while the HUD
  // survives.
  getPlayer(): Player {
    return this.player;
  }

  getActiveBoss(): Enemy | null {
    return this.activeBoss;
  }

  getEscapeDeadline(): number | null {
    return this.bossController.getEscapeDeadline();
  }

  // BossEncounterHost hook: resetBossFight clears the engagement so
  // updateEnemies won't re-select the boss until the player re-enters.
  clearActiveBoss(): void {
    this.activeBoss = null;
  }

  // EnemyHelperScene hook Enemy 'summon' attacks call — delegates to the
  // boss-encounter controller, which owns minion spawning/tracking.
  summonEnemyAt(identifier: string, x: number, y: number): Enemy | null {
    return this.bossController.summonEnemyAt(identifier, x, y);
  }

  getMaxAlertLevel(): number {
    return this.maxAlertLevel;
  }

  // Returns the LDtk identifier of the level whose rect contains the player's
  // current world position, or null if the player is between levels (mid-jump
  // across a seam). Public: also part of the TrapSystemHost contract.
  getCurrentLevelId(): string | null {
    return this.findLevelIdAt(this.player.x, this.player.y);
  }

  // Returns the LDtk identifier of the level whose rect contains (x, y), or
  // null if the point lies in inter-level whitespace. Iteration order matches
  // build order; LDtk levels do not overlap so the first hit is unambiguous.
  // Public: also part of the TrapSystemHost contract.
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

  // Per-frame AI tick for every spawned enemy. Group.getChildren() returns
  // the live array (mutations during destroy() are safe because Enemy's own
  // dead/hurt early-return prevents reentrant state changes here). The
  // instanceof guard keeps the loop tolerant of mixed groups in case a
  // future change adds non-Enemy children.
  private updateEnemies(): void {
    if (!this.enemies) {
      this.activeBoss = null;
      this.bossEngaged = false;
      this.maxAlertLevel = 0;
      return;
    }
    const children = this.enemies.getChildren();
    // Resolve the engaged round-fight boss in the same pass that ticks AI.
    // First encountered, still-living round-fight boss wins (only one is
    // engageable at a time in practice). update() can destroy an enemy
    // (off-world cleanup / death-anim complete), so we skip destroyed ones
    // before reading their flags. The same pass also resolves the fight-wide
    // stealth-off flag (any engaged boss) and the highest per-enemy detection
    // level (for the HUD corner brackets) so detection costs one loop, not three.
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
      // Stealth disables during any boss fight — round-fight or not. A boss
      // counts as engaged once the player has entered its encounter zone
      // (hasEncountered) or traded blows with it (isInConflict), covering
      // bosses that carry no encounter sting (e.g. The_hive, The_blood_king).
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
      const layers = slot.rendered.layers;
      if (layers.length === 0) continue;
      const visible =
        right > slot.worldX &&
        left < slot.worldX + slot.pxWid &&
        bottom > slot.worldY &&
        top < slot.worldY + slot.pxHei;
      // A level's layers always toggle together, so the first layer's current
      // visibility is the level's last-applied state. Skip levels whose state
      // hasn't changed — this also gates the tween pause/resume below to
      // genuine on/off transitions rather than every frame.
      if (layers[0].container.visible === visible) continue;
      for (const layer of layers) {
        layer.container.setVisible(visible);
      }
      // Pause looping glow-flicker tweens while the level is off-camera. An
      // invisible container is skipped at render, but its tweens otherwise
      // keep ticking on the CPU every frame across all 19 levels.
      for (const tween of slot.rendered.animations.tweens) {
        if (visible) tween.resume();
        else tween.pause();
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

  // Enemy navigation: A* a grounded route from a start foot point to a goal foot
  // point over the nav graph, returned as world-px waypoints (node foot centers)
  // the enemy follows with its existing hop/leap/mount locomotion. Returns null
  // when there's no graph, either endpoint can't snap to a standable node, or no
  // route exists within the expansion budget — the caller then falls back to
  // reactive steering. Part of the EnemyHelperScene contract.
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

  // Returns the body-center position of the nearest VALID teleport target to
  // (x, y), or null if none qualify. Beyond "alive and not blocklisted" a
  // target must clear two gates: (1) same level as (x, y) — enemies from every
  // level share the one `enemies` group, so without scoping the teleport could
  // blink the player into a different level; (2) clear line of sight — the
  // isLineBlocked raycast (the same test the chase AI uses) must find no solid
  // tile between (x, y) and the target, so an enemy behind a wall is skipped.
  // Used by the sword_master teleport attack to drop the player above their
  // nearest target on the 'appear' frame. Body center (not sprite center) is
  // the reliable reference because tall sprites anchored at frame-bottom (e.g.
  // The_tarnished_widow: 188×90 sprite with 48×45 body anchored at frame
  // bottom) have their sprite.y sitting at body.top — placing the player
  // relative to sprite.y leaves the slash hitbox entirely above the body.
  // body.center.y normalizes across all enemy sizes/anchors. Dead enemies
  // (mid-death-anim corpses still in the group) are filtered so the move homes
  // in on something actually fightable. Wasps and the_hive are also skipped —
  // wasps are swarm minions where homing onto a single one feels arbitrary,
  // and the_hive is a stationary spawner the player isn't meant to dive-bomb.
  getNearestEnemy(x: number, y: number): { x: number; y: number } | null {
    if (!this.enemies) return null;
    // Scope to the player's current level. getLevelBoundsAt returns the slot
    // containing (x, y); a null means the point lies outside every level, so
    // there's no current level to target within and we bail.
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
      // Same-level gate: the target's body center must lie inside the player's
      // level slot, else it belongs to a different level.
      if (
        targetX < bounds.worldX ||
        targetX >= bounds.worldX + bounds.pxWid ||
        targetY < bounds.worldY ||
        targetY >= bounds.worldY + bounds.pxHei
      ) {
        continue;
      }
      // Line-of-sight gate: skip a target with a solid tile on the straight
      // line from (x, y) — the player can't blink to an enemy behind a wall.
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

  // Invokes `cb` once for every live Enemy in the world, including any caller
  // that is itself an enemy. Dead enemies (corpses mid-death-anim still in the
  // group) are skipped so callers only ever see active characters. Backs the
  // EnemyHelperScene hook the wander greeting uses to find a nearby same-group
  // partner; callers filter and throttle, so this stays a plain linear scan.
  forEachEnemy(cb: (enemy: Enemy) => void): void {
    if (!this.enemies) return;
    for (const obj of this.enemies.getChildren()) {
      if (!(obj instanceof Enemy)) continue;
      if (obj.isDead()) continue;
      cb(obj);
    }
  }

  // Coarse line-of-sight test: samples points along the segment (x1,y1)→(x2,y2)
  // and returns true if any sample lands on a solid collision tile. Sample
  // spacing is one tile (16 px in this project) so a 1-tile wall directly on
  // the line is always caught — finer spacing would only matter for sub-tile
  // geometry, which doesn't exist on the collision grid. False positives are
  // possible when the line clips a floor/ceiling tile (e.g. enemy on a ledge
  // above the player); a target on a ledge can be rejected even though a
  // curved approach exists. Acceptable for the coarse teleport/chase checks.
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

  // True while a boss fight is active anywhere in the world — stealth is then
  // disabled for every enemy (Enemy.isStealthEnabled reads this through the
  // EnemyHelperScene interface). Resolved once per frame in updateEnemies, so
  // this is a cheap field read with one-frame latency.
  isStealthDisabled(): boolean {
    return this.bossEngaged;
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

  // The player's gun is loud: alert every stealth-enabled enemy within
  // ENEMY_GUNSHOT_HEARING_RADIUS_PX of (x, y) so it investigates the exact spot
  // the shot was fired from (no line of sight needed — sound carries through
  // walls). Called from Player when a gun projectile is fired; the silent
  // sword/magic don't call it. Skipped during boss fights, where stealth is off
  // and enemies are already always-aggro (Enemy.hearGunshot also guards this).
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
  // called a second time for the same scene instance. Each step below is a
  // private method; they run in this exact order and the locals they share
  // (world bounds, nav levels, spawned entities) are threaded through
  // explicitly.
  private buildWorld(project: LdtkProject): void {
    const bounds = this.setWorldBoundsFromLevels(project);
    const navLevels = this.renderAllLevels(project);
    this.buildNavGraph(navLevels);
    this.createEntityGroups();
    const allEntities = this.collectWorldEntities(project);
    const spawned = this.spawnAndWireEntities(project, allEntities);
    // Trap triggering + damage handling, built once the player exists (the
    // per-frame trigger scan reads the player's body). wireColliders takes
    // its overlap callbacks; the damage-frame listeners ride the trap
    // sprites and die with them.
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

  // Computes the union of all level rects so physics/camera bounds cover the
  // full traversable world rather than a single level's box.
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

  private renderAllLevels(project: LdtkProject): NavLevel[] {
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

  // Navigation graph for enemy pathfinding, built from the same IntGrid
  // collision. The node pass is eager (cheap O(1)-per-cell); edges compute
  // lazily as A* expands, so the costly ballistic edge probing is paid only for
  // nodes actually searched.
  private buildNavGraph(navLevels: NavLevel[]): void {
    this.navGraph = new NavGraph(navLevels);
    this.navGraph.buildNodes();
    this.navOverlay = new NavDebugOverlay(this, this.navGraph);
  }

  private createEntityGroups(): void {
    this.projectiles = this.add.group();
    this.enemies = this.add.group();
    this.enemyProjectiles = this.add.group();
    this.traps = this.add.group();
    this.staticEntities = this.add.group();
    this.ammoDrops = this.add.group();
  }

  private collectWorldEntities(project: LdtkProject): LdtkEntityInstance[] {
    // Spawn entities from every level so enemies/items in other levels exist
    // when the player walks into them. The player factory fires for the single
    // PLAYER_SPAWN_IDENTIFIER marker selected by STARTING_LEVEL_IDENTIFIER — the
    // filter below drops player-spawn markers in any other level, so leftover
    // test spawns don't trip the "multiple players" guard in spawnEntities.
    // Bosses already defeated this run are filtered out at the source so a downed
    // boss is absent from EVERY downstream pass — its sprite never re-spawns AND
    // its spatial ambient-sound anchor (e.g. the Heart Hoarder's cloth flap)
    // doesn't keep looping at an empty spawn point after a rebuild (death/
    // respawn, HMR). The defeat persists in run-progress; non-boss identifiers
    // are never in the set, so only downed bosses are removed. New Game clears
    // the set (resetRunProgress) before this runs, so a fresh run re-spawns
    // every boss.
    const allEntities = project.levels
      .flatMap(getEntities)
      .filter((e) => !isBossDefeated(e.__identifier))
      .filter(
        (e) =>
          e.__identifier !== PLAYER_SPAWN_IDENTIFIER ||
          e.__levelId === STARTING_LEVEL_IDENTIFIER,
      );
    // Collect reinforcement spawn-site markers (General_enemy_spawn). They
    // carry no factory — the round-fight system reads their world positions
    // to place reinforcement waves, and LevelRenderer skips drawing them.
    this.bossController.setSpawnSites(
      allEntities
        .filter((e) => e.__identifier === GENERAL_ENEMY_SPAWN_IDENTIFIER)
        .map((e) => pivotCenter(e)),
    );
    // Audio-anchor pass: decoration entities (House2/House6/etc.) bound to
    // a spatial sound in soundRegistry get a per-instance looping audio
    // source at their world position. This is independent of spawnEntities
    // because the bound entities have no factory — they're rendered as
    // static tiles by LevelRenderer, but still emit sound.
    for (const instance of allEntities) {
      const { x, y } = pivotCenter(instance);
      registerEntitySound(this, instance.__identifier, instance.iid, x, y);
    }
    return allEntities;
  }

  // Spawns every entity, wires per-entity hookups (audio, trap damage-frame
  // listeners, terrain-settling groups), assigns the player, and registers
  // the hold-E interactables.
  private spawnAndWireEntities(
    project: LdtkProject,
    allEntities: LdtkEntityInstance[],
  ): SpawnedEntities {
    this.respawnManager = new EnemyRespawnManager();
    const spawned = spawnEntities(this, allEntities);
    for (const enemy of spawned.enemies) {
      this.attachEnemyToWorld(enemy);
    }
    // Tether each hive-anchored swarmer (wasp) to its nearest hive now that
    // every enemy — wasps and hives alike — is constructed and in the group.
    for (const enemy of spawned.enemies) {
      this.anchorSwarmerToHome(enemy);
    }
    for (const trap of spawned.traps) {
      trap.setDepth(ENTITY_DEPTH);
      this.traps.add(trap);
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
    // Key-locked doors are the only interactable doors — plain proximity doors
    // return canInteract() === false. Register just the locked ones so the
    // manager's per-frame scan stays small.
    this.interactions.registerAll(
      spawned.doors.filter((door) => door.isKeyLocked()),
    );
    return spawned;
  }

  // Scene-bus subscriptions, wired per buildWorld so HMR rebuilds attach to
  // the fresh event bus; tearDownWorld removes them so duplicates can't
  // accumulate across rebuilds.
  private wireWorldEvents(): void {
    // Save crystals fire SAVE_REQUESTED_EVENT on commit; takeSave reads the
    // current player state into this.saveSlot and pops a "Game Saved" toast.
    this.events.on(SAVE_REQUESTED_EVENT, this.takeSave, this);
    // Merchants fire SHOP_REQUESTED_EVENT on commit; openShop launches the
    // ShopScene overlay paused on top of GameScene. Same per-buildWorld /
    // per-tearDownWorld subscribe/unsubscribe shape as the save listener so
    // HMR can't double-register the handler.
    this.events.on(SHOP_REQUESTED_EVENT, this.openShop, this);
    // A key-locked door with no matching key fires KEY_DOOR_LOCKED_EVENT on a
    // completed hold-E; a boss fires BOSS_DEFEATED_EVENT on death. Same
    // per-build subscribe / per-teardown unsubscribe shape as the handlers
    // above so HMR and respawn rebuilds don't accumulate duplicate listeners.
    this.events.on(KEY_DOOR_LOCKED_EVENT, this.showKeyDoorMessage, this);
    this.events.on(BOSS_DEFEATED_EVENT, this.onBossDefeated, this);
  }

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
      // Enemies obey the same closed-door wall as the player: a shut (or
      // still-locked) door is solid, so a pursuing enemy is shoved back instead
      // of phasing through to the player's side. The shared isPassable() process
      // gate drops the collision the instant the door swings open — the same
      // frame the player can walk through — so enemies only ever follow through
      // a door the player has already opened. Group collider, so enemies the
      // respawn manager adds later are covered without re-wiring.
      this.colliders.push(
        this.physics.add.collider(
          this.enemies,
          doors,
          undefined,
          (_enemy, door) => !(door as Door).isPassable(),
          this,
        ),
      );
      // A closed (still-locked, or mid-swing) door is solid to gunfire the same
      // way it is to the player: bullets burst against it like they would
      // against terrain instead of phasing through to whatever's behind. The
      // shared isPassable() process gate lets shots pass only once the door has
      // swung open — exactly the frame the player can walk through.
      this.colliders.push(
        this.physics.add.collider(
          this.projectiles,
          doors,
          this.onProjectilePlatformImpact,
          (_projectile, door) => !(door as Door).isPassable(),
          this,
        ),
      );
      // Enemy gunfire obeys the same closed-door wall so an enemy or boss can't
      // shoot the player through a shut door.
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
    // Player projectiles impact on traps but do NOT destroy them — traps are
    // indestructible hazards. The projectile bursts against the trap just like
    // it would against terrain, so shots can't clear a hazard or punch through
    // one to hit something behind it.
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
        trapSystem.onPlayerHitsTrap,
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
        trapSystem.onEnemyHitsTrap,
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
  }

  private setupCameraAndBounds(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): void {
    this.cameras.main.setZoom(CAMERA_ZOOM);
    // Lerp values < 1 smooth the follow toward the target each frame. 0.08 on
    // both axes feels buttery and stops the camera snapping during jumps —
    // small bobs damp out before they're visible while sustained motion still
    // tracks. No deadzone: a deadzone pins the player at its edge instead of
    // returning to the follow offset, so a long fall would leave them stuck
    // at the bottom of the screen.
    //
    // roundPixels (2nd arg) = true: in Phaser's WebGL batch, sprites are only
    // snapped to whole pixels when the *camera's* roundPixels is on, so this
    // is what keeps the pixel-art crisp. Leave it on.
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
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    );
  }

  // PLAYER_DIED_EVENT → either rewind to the last save (if one exists) or,
  // when the player never saved, abandon the run and return to the title/home
  // screen (restartRun(true) — the same path as Quit / Return to Title). The
  // captured `diedPlayer` lets the delayed callback ignore the trigger when
  // HMR or an earlier respawn has since rebuilt the world — comparing against
  // the current this.player avoids re-entering the rebuild for a stale death.
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
  // Public: also part of the BossEncounterHost contract (reinforcement /
  // copy / minion spawns wire in through the same hookups).
  attachEnemyToWorld(enemy: Enemy, trackForRespawn = true): void {
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
    // Round-fight reinforcements pass trackForRespawn=false: they're spawned
    // wave-by-wave by the encounter system, so they must not re-enter the
    // distance-based respawn loop and slowly flood the arena after death.
    if (trackForRespawn) {
      enemy.once(Phaser.GameObjects.Events.DESTROY, () => {
        if (!enemy.isDead()) return;
        this.respawnManager?.recordDeath(enemy, this.time.now);
      });
    }
  }

  // Anchors a hive-tethered swarmer (wasp) to the nearest hive's spawn point so
  // it loiters around — and leashes its chase to — the hive instead of the
  // player. Scans the live enemy group for hives; falls back to the wasp's own
  // spawn point when none exist (e.g. boss-wave reinforcement wasps, or a level
  // authored without a hive). Nearest-by-distance naturally picks the same
  // level's hive since wasps are placed alongside theirs. Called from
  // buildWorld's post-spawn pass and from handleRespawn, so a rebuilt wasp
  // re-links. No-op for every non-wasp enemy identifier.
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

  // Turns a hive's whole swarm on the player: every wasp anchored to `hive`
  // drops its home leash and chases immediately. Triggered when the player
  // shoots the hive (onProjectileHitsEnemy). Matches wasps by their stored home
  // anchor — set to this hive's exact spawn point in anchorSwarmerToHome — so a
  // multi-hive level only rouses the swarm of the hive that was hit.
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

  // Respawn callback fired by EnemyRespawnManager.tick() once a queued entry
  // has cleared both its time and distance gates. Rebuilds the Enemy via the shared
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
    this.anchorSwarmerToHome(enemy);
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

    // Navigation graph + overlay are rebuilt by the next buildWorld (HMR /
    // restart), so dispose the current ones — the overlay owns a Graphics object
    // that would otherwise leak and keep drawing the stale graph.
    this.navOverlay?.destroy();
    this.navOverlay = null;
    this.navGraph = null;

    for (const slot of this.levelSlots) {
      destroyRenderedLevel(slot.rendered);
    }
    this.levelSlots = [];

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

    // Round-fight reinforcements + summoned minions live in the enemies group
    // but outside `spawned.enemies`, so destroyEntities(spawned) below won't
    // catch them — the controller's teardown destroys them, resets the
    // round-spawn state, and clears any in-flight escape countdown.
    this.bossController.teardown();

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
    // The trap system holds the destroyed world's player/enemies/traps
    // references — drop it so the next buildWorld constructs a fresh one.
    this.trapSystem = null;

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
    this.events.off(KEY_DOOR_LOCKED_EVENT, this.showKeyDoorMessage, this);
    this.events.off(BOSS_DEFEATED_EVENT, this.onBossDefeated, this);

    // Drop any in-flight locked-door message + its tweens so they don't outlive
    // the world the message was triggered in (HMR/respawn keep the scene alive).
    if (this.keyDoorMessageText) {
      this.tweens.killTweensOf(this.keyDoorMessageText);
      this.keyDoorMessageText.destroy();
      this.keyDoorMessageText = null;
    }
  }

  // Applies a snapshot through the shared restorePlayer, first checking the
  // position still lands inside the (possibly rebuilt) world.
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

  // SAVE_REQUESTED_EVENT handler. Snapshots the player into saveSlot and
  // pops a floating "Game Saved" text above the crystal that triggered the
  // save. Multi-save semantics: every successful interaction overwrites the
  // single slot, so the most recent crystal wins.
  private takeSave(crystal: Save): void {
    const snapshot = snapshotPlayer(this.player);
    if (!snapshot) return;
    this.saveSlot = snapshot;
    this.showSaveToastAt(crystal.x, crystal.body.top - SAVE_TOAST_OFFSET_Y_PX);
  }

  // Auto-save with no Save crystal involved — used by the boss-defeat
  // checkpoint. Snapshots the player into the single save slot and pops the
  // same "Game Saved" toast above the player. No-op when the player/body isn't
  // available (snapshotPlayer guards that).
  private autoSave(): void {
    const snapshot = snapshotPlayer(this.player);
    if (!snapshot || !this.player) return;
    this.saveSlot = snapshot;
    this.showSaveToastAt(
      this.player.x,
      this.player.body.top - SAVE_TOAST_OFFSET_Y_PX,
    );
  }

  // Floating "Game Saved" text that rises and fades over SAVE_TOAST_DURATION_MS
  // then destroys itself, anchored at the given world position — above the Save
  // crystal for a manual save, above the player for a boss-defeat auto-save.
  // Source-pixel font + setResolution(CAMERA_ZOOM) matches the HUD's smoothing
  // pattern so the text reads crisply at zoom.
  private showSaveToastAt(startX: number, startY: number): void {
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

  // KEY_DOOR_LOCKED_EVENT handler. Shows (or refreshes) a brief centered line
  // near the bottom of the screen telling the player they need the key. The
  // text is world-anchored to the camera's current worldView (same idiom as the
  // save toast) and rendered at CAMERA_ZOOM resolution so it stays crisp under
  // the 3× zoom. A single text object is reused — a repeat trigger restarts the
  // fade in place rather than stacking overlapping copies.
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
      // Same LINEAR-filter trick as the save toast — the global pixelArt:true
      // config would otherwise nearest-sample the text into jagged edges.
      created.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      created.once(Phaser.GameObjects.Events.DESTROY, () => {
        if (this.keyDoorMessageText === created) this.keyDoorMessageText = null;
      });
      this.keyDoorMessageText = created;
    }

    const text = this.keyDoorMessageText;
    // Re-anchor to the current view (the camera may have drifted) and restart
    // the fade from invisible. killTweensOf cancels any in-flight fade so the
    // refresh doesn't fight a pending fade-out's destroy.
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

  // BOSS_DEFEATED_EVENT handler. Records the defeat in the persistent run store,
  // grants the boss's key, clears the boss's arena (every other enemy in its
  // level dies too), auto-saves, then fires the victory flow when the final boss
  // falls. recordBossDefeated is idempotent (backed by a Set), so a re-killed
  // boss is harmless; the victoryShown latch keeps the win from launching twice.
  // bossX/bossY are the dying boss's world position (carried on the event) used
  // to resolve which level's enemies to clear.
  private onBossDefeated(
    identifier: string,
    bossX: number,
    bossY: number,
  ): void {
    recordBossDefeated(identifier);
    // Grant this boss's key directly — defeated bosses no longer respawn, so a
    // player who dies before collecting the dropped key would otherwise lose the
    // only copy and soft-lock the matching door. Idempotent, and the physical
    // key still drops. Bosses without a key (Heart Hoarder) map to undefined.
    const grantedKey = BOSS_KEYS[identifier];
    if (grantedKey) recordKeyCollected(grantedKey);
    // A boss kill clears its arena: every other live enemy in the boss's level
    // dies too (its reinforcements, swarm, and any self-copies), so the room is
    // left empty rather than holding leftover adds.
    this.killEnemiesInLevel(bossX, bossY);
    // Auto-save: a boss kill is a major checkpoint. Snapshot the player into the
    // save slot so a later death respawns them post-fight — and, with the defeat
    // persisted and the boss filtered from the rebuild, into a boss-free world —
    // rather than replaying the encounter.
    this.autoSave();
    // The Heart Hoarder is the final boss: its death ends the run on its own.
    // (allBossesDefeated stays as a fallback in case the win gate ever changes.)
    if (
      !this.victoryShown &&
      (identifier === FINAL_BOSS_IDENTIFIER || allBossesDefeated())
    ) {
      // Latch now (not in triggerVictory) so a second BOSS_DEFEATED_EVENT inside
      // the delay window can't schedule a second victory. Hold the world live
      // long enough for the boss's full death animation (and the arena clear
      // above — every other enemy dying at once) to play out before the victory
      // flow freezes everything to black. The hold is the death clip's own
      // length minus a small margin, so it scales with the animation and freezes
      // a hair before the boss reaps its own corpse (see VICTORY_FREEZE_MARGIN_MS).
      this.victoryShown = true;
      // The Phaser animation registered for the boss's death clip knows its own
      // total duration (frameCount / fps); read it straight off the anim manager
      // so the hold tracks the real clip length. Falls back to a fixed beat if
      // the boss uses a non-default death anim key that doesn't resolve.
      const deathKey = entityAnimFullKey(identifier, 'death');
      const deathMs = this.anims.get(deathKey)?.duration ?? null;
      const holdMs =
        deathMs !== null
          ? Math.max(0, deathMs - VICTORY_FREEZE_MARGIN_MS)
          : VICTORY_DELAY_MS;
      this.time.delayedCall(holdMs, () => {
        // If the run was abandoned during the hold (restartRun re-arms the latch
        // to false and rebuilds the world), this stale timer must not launch the
        // win screen over the fresh world.
        if (this.victoryShown) this.triggerVictory();
      });
    }
  }

  // Kills every live enemy in the level containing (worldX, worldY) by routing
  // each through takeDamage, so they play their normal death animation and drop
  // loot rather than vanishing. The source coords are the enemy's own position
  // with knockback suppressed (a corpse shouldn't be flung), and sourceIsPlayer
  // is false so this environmental wipe doesn't flip combat state. Already-dead
  // enemies and the just-killed boss (which is in the 'dead' state by now) are
  // skipped. The children list is snapshotted because enterDeadState can mutate
  // the group as corpses are reaped.
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

  // Freezes the world and launches the full-screen VictoryScene on top — the
  // same launch-then-pause idiom openPauseMenu uses. VictoryScene fades to black
  // with "YOU WON", holds, then calls back into restartRun(true), which rebuilds
  // the world, resets run progress, and re-shows the landing/home page.
  private triggerVictory(): void {
    this.victoryShown = true;
    this.anims.pauseAll();
    this.scene.launch(SCENE_KEYS.VICTORY);
    this.scene.pause();
  }

  // Death-recovery path when NO save exists: the run is over, so fade the dying
  // world out to black and return to the title/home screen — the same fade
  // language as the START transition, just reversed. At full black, restartRun
  // rebuilds the world into the landing framing and fades both the world and the
  // title overlay back in together (fadeIn=true). Driven off the main camera's
  // FADE_OUT_COMPLETE so the swap happens only once the screen is fully black.
  private returnToHomeScreen(): void {
    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.restartRun(true, true);
    });
    cam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);
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
    this.restorePlayerSnapshot(snapshot, project);
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
    const playerSnapshot = snapshotPlayer(this.player);

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
      this.restorePlayerSnapshot(playerSnapshot, project);
    }
  };

  private onSceneShutdown(): void {
    if (this.hotReloadUnsub) {
      this.hotReloadUnsub();
      this.hotReloadUnsub = null;
    }
    // Drop entity-anchored sounds on a full scene stop. These live on the
    // game-global SoundManager (not the scene), so without this they outlive
    // the scene and the next create()→buildWorld would register a second set
    // on top — the world getting progressively louder on each restart. The
    // primary respawn path clears them in tearDownWorld instead (no shutdown
    // fires there); this covers the quit / new-game restart and the
    // scene.restart() respawn fallback, both of which do fire SHUTDOWN.
    clearEntitySounds();
    this.input.keyboard?.off('keydown-ESC', this.openPauseMenu, this);
    this.input.keyboard?.off('keydown-N', this.toggleNavDebug, this);
    this.navOverlay?.destroy();
    this.navOverlay = null;
    this.navGraph = null;
    // Tear down the boss-fight overlays explicitly so the banner tween +
    // graphics don't outlive the scene (the DOM player HUD deliberately
    // survives scene.restart); reset the engagement trackers for a clean
    // restart.
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

  private onProjectilePlatformImpact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectile) => {
      if (projectile instanceof Projectile) {
        playOneShot(this, 'bullet_impact_rock');
        projectile.onImpact();
      }
    };

  // Overlap order follows registration: (projectile, trap). Traps are
  // indestructible: the projectile bursts against the trap (rock-impact SFX +
  // onImpact explosion, same as hitting terrain) but the trap is left intact.
  // The hasExploded/active guards prevent re-firing — overlap callbacks can be
  // queued from a previous tick after the projectile's body was disabled in
  // onImpact.
  private onProjectileHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (projectileObj, trapObj) => {
      if (!(projectileObj instanceof Projectile)) return;
      if (!(trapObj instanceof Trap)) return;
      if (projectileObj.hasExploded()) return;
      if (!trapObj.active) return;
      playOneShot(this, 'bullet_impact_rock');
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
      // Likewise during a round-transition freeze: the boss is invulnerable
      // for the cinematic "Round N" beat, so shots pass through rather than
      // popping harmless impacts against an unhittable target (takeDamage
      // would ignore the damage anyway — this just suppresses the VFX/sound).
      if (enemyObj.isInRoundBreak()) return;
      playOneShot(this, 'bullet_impact_flesh');
      enemyObj.takeDamage(projectileObj.getDamage(), projectileObj.x);
      // Shooting the hive turns its whole swarm on the player: every wasp
      // anchored to this hive drops its leash and gives chase immediately.
      if (enemyObj.getIdentifier() === HIVE_BEACON_IDENTIFIER) {
        this.alarmHiveSwarm(enemyObj);
      }
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

  // Player picks up a drop (ammo, magic shard, or healing heart) on body
  // overlap. Ammo and hearts are left on the ground when the player is already
  // at max for that resource (canPickUp) — overlap keeps firing each frame, so
  // the drop is collected the instant a shot or heal frees a slot. Other kinds
  // (magic, coins, keys) are always consumed; Player.addPickup clamps them.
  //
  // TODO: playOneShot(this, 'pickup') once the audio registry has a pickup
  // entry — symmetric with Chest's chest_open TODO.
  private onPlayerPicksUpAmmo: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback =
    (playerObj, ammoObj) => {
      if (!(playerObj instanceof Player)) return;
      if (!(ammoObj instanceof AmmoDrop)) return;
      if (playerObj.isDead()) return;
      if (!playerObj.canPickUp(ammoObj.getKind())) return;
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

}
