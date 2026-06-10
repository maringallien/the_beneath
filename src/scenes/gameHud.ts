import Phaser from 'phaser';
import { BOSS_ROUND_COUNT } from '../entities/bossRounds';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { BossHud } from '../entities/BossHud';
import { CombatZoneWarning } from '../ui/CombatZoneWarning';
import { DetectionCorners } from '../ui/DetectionCorners';
import { PlayerHudOverlay } from '../ui/PlayerHudOverlay';

// The live game state the HUD renders from each frame — GameScene implements
// these structurally (the EnemyHelperScene pattern). The player reference is
// fetched per frame because the world rebuild (death/respawn, HMR) replaces
// the Player instance while the HUD survives.
export interface GameHudHost {
  getPlayer(): Player;
  getActiveBoss(): Enemy | null;
  getEscapeDeadline(): number | null;
  getMaxAlertLevel(): number;
}

// Owns the four gameplay overlays — player HUD (DOM), boss HUD (canvas),
// combat-zone escape warning (canvas), and detection corners (DOM) — plus
// the camera PRE_RENDER drivers that update them and the PAUSE/RESUME
// visibility handlers. One instance per GameScene instance; attach() builds
// the overlays (and is safe to run again after a destroy — Quit to title
// then START does exactly that).
export class GameHud {
  private readonly scene: Phaser.Scene;
  private readonly host: GameHudHost;

  private hud: PlayerHudOverlay | null = null;
  private bossHud: BossHud | null = null;
  private combatWarning: CombatZoneWarning | null = null;
  private detectionCorners: DetectionCorners | null = null;
  // Latched round shown by the boss bar. 0 = bar hidden / no active boss.
  // Lets updateBossHud fire the Round 1 banner on first engagement and a
  // fresh banner each time the boss's round climbs.
  private bossRoundShown = 0;

  constructor(scene: Phaser.Scene, host: GameHudHost) {
    this.scene = scene;
    this.host = host;
  }

  isAttached(): boolean {
    return this.hud !== null;
  }

  // Player HUD (DOM overlay) + boss HUD (canvas). The player HUD is HTML in the
  // #game parent (same as the shop/options overlays), so it's pinned by CSS
  // rather than per-frame world-space math; the boss HUD stays canvas-rendered.
  attach(): void {
    const parent = this.scene.game.canvas.parentElement ?? document.body;
    this.hud = new PlayerHudOverlay(parent);
    this.bossHud = new BossHud(this.scene);
    this.combatWarning = new CombatZoneWarning(this.scene);
    this.detectionCorners = new DetectionCorners(parent);
    // Drive HUD position+ratio updates from the main camera's PRE_RENDER
    // event. That fires after Camera.preRender() rebuilds the camera matrix
    // and refreshes midPoint, so the HUD positions are in sync with the
    // *current* frame's camera scroll — eliminating the one-frame drift
    // that subscribing to scene PRE_UPDATE introduces (PRE_UPDATE fires
    // before the camera follow lerp this frame, so positions trail the
    // visible camera by one tick). PRE_RENDER fires during the render
    // phase, which runs regardless of any throws in the UPDATE phase. The
    // boss HUD rides the same event for the same reason; activeBoss is
    // resolved in updateEnemies (UPDATE phase) so it's current by render.
    //
    // Detach before re-attaching so the subscription stays single even when
    // attach runs more than once per scene lifetime: Quit to the title screen
    // destroys the HUD, then START rebuilds it, and the main camera survives the
    // in-place world rebuild — so without this the drivers would accumulate.
    const cam = this.scene.cameras.main;
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateHud, this);
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateBossHud, this);
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateCombatWarning, this);
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateDetectionCorners, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateHud, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateBossHud, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateCombatWarning, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateDetectionCorners, this);

    // The DOM HUD renders above the canvas, so it would otherwise float over the
    // pause/shop/options dim instead of being covered by it. Hide it whenever
    // the scene pauses (PauseScene and the shop both pause GameScene) and
    // restore it on resume. off() before on() keeps the subscription single
    // across repeated attach calls — Quit→START rebuilds the HUD while the
    // scene's event emitter persists.
    this.scene.events.off(Phaser.Scenes.Events.PAUSE, this.hideHud, this);
    this.scene.events.off(Phaser.Scenes.Events.RESUME, this.showHud, this);
    this.scene.events.on(Phaser.Scenes.Events.PAUSE, this.hideHud, this);
    this.scene.events.on(Phaser.Scenes.Events.RESUME, this.showHud, this);
  }

  // Hides only the player HUD, synchronously, while the landing page is up —
  // beginGameplay reveals it with fadeIn as the world appears.
  hideForLanding(): void {
    this.hud?.setVisible(false);
  }

  fadeIn(durationMs: number): void {
    this.hud?.fadeIn(durationMs);
  }

  // Shows/hides the escape-warning overlay; updateBossLeash drives it from
  // the UPDATE phase while the per-frame text refresh rides PRE_RENDER.
  setEscapeWarningVisible(visible: boolean): void {
    this.combatWarning?.setVisible(visible);
  }

  // Drops the latched round counter WITHOUT touching the bar's visibility —
  // the restartRun path; the bar (if any) dies with the world teardown that
  // follows.
  clearBossRound(): void {
    this.bossRoundShown = 0;
  }

  // Re-arms the round tracker and hides the bar — the abandoned-fight reset.
  resetBossRound(): void {
    this.bossRoundShown = 0;
    this.bossHud?.setVisible(false);
  }

  // Full teardown (Quit / Return-to-Title): the title screen shows no HUD, so
  // every overlay goes; attach() recreates them when the player presses START.
  destroy(): void {
    this.hud?.destroy();
    this.hud = null;
    this.bossHud?.destroy();
    this.bossHud = null;
    this.combatWarning?.destroy();
    this.combatWarning = null;
    this.detectionCorners?.destroy();
    this.detectionCorners = null;
  }

  // Scene-shutdown teardown: the boss HUD's banner tween + graphics and the
  // other canvas/corner overlays must not outlive the scene, but the DOM
  // player HUD deliberately survives scene.restart() (the respawn fallback)
  // and re-binds to the new player through its per-frame update().
  destroyForSceneShutdown(): void {
    this.bossHud?.destroy();
    this.bossHud = null;
    this.combatWarning?.destroy();
    this.combatWarning = null;
    this.detectionCorners?.destroy();
    this.detectionCorners = null;
    this.bossRoundShown = 0;
  }

  private hideHud(): void {
    this.hud?.setVisible(false);
    this.detectionCorners?.setVisible(false);
  }

  private showHud(): void {
    this.hud?.setVisible(true);
    this.detectionCorners?.setVisible(true);
  }

  private updateHud(): void {
    if (!this.hud) return;
    const player = this.host.getPlayer();
    this.hud.update({
      health: player.getHealth(),
      maxHealth: player.getMaxHealth(),
      stamina: player.getStamina(),
      maxStamina: player.getMaxStamina(),
      magic: player.getMagic(),
      maxMagic: player.getMaxMagic(),
      gun1Ammo: player.getGun1Ammo(),
      maxGun1Ammo: player.getMaxGun1Ammo(),
      gun2Ammo: player.getGun2Ammo(),
      maxGun2Ammo: player.getMaxGun2Ammo(),
      coins: player.getCoins(),
      maxCoins: player.getMaxCoins(),
      healItems: player.getHealItems(),
      maxHealItems: player.getMaxHealItems(),
      mode: player.getCurrentMode(),
      magicSelected: player.isMagicMode(),
    });
  }

  // Boss round-fight HUD driver, resolved each render frame off the host's
  // active boss (set in updateEnemies). Shows the bar + "Round 1" banner when
  // a round-fight boss is first engaged, fires a fresh banner each time its
  // latched round climbs, refreshes the bar's fill + per-round color, and
  // hides everything once the boss dies or there's no engaged boss.
  private updateBossHud(): void {
    if (!this.bossHud) return;
    const boss = this.host.getActiveBoss();
    if (!boss || !boss.active || boss.isDead()) {
      if (this.bossRoundShown !== 0) {
        this.bossHud.setVisible(false);
        this.bossRoundShown = 0;
      }
      return;
    }
    const round = boss.getRound();
    if (this.bossRoundShown === 0) {
      this.bossHud.setVisible(true);
    }
    if (round > this.bossRoundShown) {
      this.bossHud.showRound(round);
      this.bossRoundShown = round;
    }
    const maxHealth = boss.getMaxHealth();
    this.bossHud.update(
      {
        name: boss.getDisplayName(),
        ratio: maxHealth > 0 ? boss.getHealth() / maxHealth : 0,
        round,
        sections: BOSS_ROUND_COUNT,
      },
      this.scene.cameras.main,
    );
  }

  // Escape-warning driver, on the same camera PRE_RENDER event as the HUDs so
  // its screen-pinned text stays in sync with this frame's scroll. The overlay
  // is shown/hidden by updateBossLeash (UPDATE phase); here we just feed it the
  // live seconds-remaining while a countdown is armed. ceil so the counter reads
  // the grace seconds (e.g. 3 → 2 → 1) and only hits 0 at the deadline.
  private updateCombatWarning(): void {
    const escapeDeadline = this.host.getEscapeDeadline();
    if (!this.combatWarning || escapeDeadline === null) return;
    const secondsLeft = Math.max(
      0,
      Math.ceil((escapeDeadline - this.scene.time.now) / 1000),
    );
    this.combatWarning.update(secondsLeft, this.scene.cameras.main);
  }

  // Recolours the detection corner brackets from the highest enemy alert level
  // resolved this frame in updateEnemies (0 normal → faint white, 1 investigating
  // → yellow, 2 conflict → red). On the camera PRE_RENDER event with the other
  // HUDs; setLevel dedups so a steady state touches no DOM.
  private updateDetectionCorners(): void {
    if (!this.detectionCorners) return;
    const maxAlertLevel = this.host.getMaxAlertLevel();
    const level =
      maxAlertLevel >= 2
        ? 'conflict'
        : maxAlertLevel >= 1
          ? 'investigating'
          : 'clear';
    this.detectionCorners.setLevel(level);
  }
}
