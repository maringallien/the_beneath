import Phaser from 'phaser';
import { BOSS_ROUND_COUNT } from '../entities/bossRounds';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { BossHud } from '../entities/BossHud';
import { CombatZoneWarning } from '../ui/CombatZoneWarning';
import { DetectionCorners } from '../ui/DetectionCorners';
import { PlayerHudOverlay } from '../ui/PlayerHudOverlay';

/**
 * gameHud — the in-game HUD rig that owns and drives the four gameplay overlays.
 *
 * Bundles the player HUD (DOM), boss HUD (canvas), combat-zone escape warning
 * (canvas), and detection corners (DOM), wiring each to the main camera's
 * PRE_RENDER event so their screen-pinned positions track this frame's scroll,
 * plus the scene PAUSE/RESUME handlers that hide/show the DOM overlays under a
 * dim. One instance per game-scene instance; attach() (re)builds the overlays
 * and re-binds the drivers, and is safe to run again after a destroy — Quit to
 * title then START does exactly that, with the camera and scene emitter
 * surviving the in-place world rebuild, so every subscription is detached
 * before it is re-added to keep it single.
 *
 * Inputs:  the host's live game state (player, active boss, escape deadline,
 *          alert level), read each render frame.
 * Outputs: the four overlays and their per-frame position/value updates.
 * @calledby the game scene — built at gameplay start, torn down on quit/shutdown.
 * @calls    the four overlay widgets and the player's per-frame stat getters.
 */

// Live game state the HUD reads each frame; player is fetched fresh because world rebuilds swap the instance.
export interface GameHudHost {
  getPlayer(): Player;
  getActiveBoss(): Enemy | null;
  getEscapeDeadline(): number | null;
  getMaxAlertLevel(): number;
}

export class GameHud {
  private readonly scene: Phaser.Scene;
  private readonly host: GameHudHost;

  private hud: PlayerHudOverlay | null = null;
  private bossHud: BossHud | null = null;
  private combatWarning: CombatZoneWarning | null = null;
  private detectionCorners: DetectionCorners | null = null;
  // Last boss round shown; 0 = no bar; lets us detect when to fire a new round banner.
  private bossRoundShown = 0;

  constructor(scene: Phaser.Scene, host: GameHudHost) {
    this.scene = scene;
    this.host = host;
  }

  // True once the overlays exist (used as the "HUD is live" guard).
  isAttached(): boolean {
    return this.hud !== null;
  }

  // Creates the four overlays and hooks their per-frame updates to PRE_RENDER; safe to call again after destroy.
  attach(): void {
    const parent = this.scene.game.canvas.parentElement ?? document.body;
    this.hud = new PlayerHudOverlay(parent);
    this.bossHud = new BossHud(this.scene);
    this.combatWarning = new CombatZoneWarning(this.scene);
    this.detectionCorners = new DetectionCorners(parent);
    // PRE_RENDER keeps HUD in sync with this frame's scroll; off() before on() avoids duplicate listeners.
    const cam = this.scene.cameras.main;
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateHud, this);
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateBossHud, this);
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateCombatWarning, this);
    cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateDetectionCorners, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateHud, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateBossHud, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateCombatWarning, this);
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.updateDetectionCorners, this);

    // Hide DOM overlays on pause so they don't float over the dim; off() before on() keeps each single.
    this.scene.events.off(Phaser.Scenes.Events.PAUSE, this.hideHud, this);
    this.scene.events.off(Phaser.Scenes.Events.RESUME, this.showHud, this);
    this.scene.events.on(Phaser.Scenes.Events.PAUSE, this.hideHud, this);
    this.scene.events.on(Phaser.Scenes.Events.RESUME, this.showHud, this);
  }

  // Hides the player HUD immediately while the landing page is shown.
  hideForLanding(): void {
    this.hud?.setVisible(false);
  }

  // Fades the player HUD in (the world-reveal at gameplay start).
  fadeIn(durationMs: number): void {
    this.hud?.fadeIn(durationMs);
  }

  // Shows or hides the escape-warning overlay.
  setEscapeWarningVisible(visible: boolean): void {
    this.combatWarning?.setVisible(visible);
  }

  // Resets the round counter without touching the bar (bar dies in the world teardown that follows).
  clearBossRound(): void {
    this.bossRoundShown = 0;
  }

  // Re-arms the round tracker and hides the bar — the abandoned-fight reset.
  resetBossRound(): void {
    this.bossRoundShown = 0;
    this.bossHud?.setVisible(false);
  }

  // Full teardown — destroys all overlays; attach() recreates them on the next START.
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

  // Tears down the canvas/corner overlays on scene shutdown; the DOM player HUD deliberately survives restart.
  destroyForSceneShutdown(): void {
    this.bossHud?.destroy();
    this.bossHud = null;
    this.combatWarning?.destroy();
    this.combatWarning = null;
    this.detectionCorners?.destroy();
    this.detectionCorners = null;
    this.bossRoundShown = 0;
  }

  // PAUSE handler: hide the DOM overlays so they don't float over the dim.
  private hideHud(): void {
    this.hud?.setVisible(false);
    this.detectionCorners?.setVisible(false);
  }

  // RESUME handler: restore the DOM overlays hidden on pause.
  private showHud(): void {
    this.hud?.setVisible(true);
    this.detectionCorners?.setVisible(true);
  }

  // Pushes current player stats into the DOM HUD each frame.
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

  // Drives the boss bar each frame — shows it on engagement, fires round banners, hides it on death.
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

  // Refreshes the escape-warning countdown text each frame (ceil so it reads 3→2→1 and hits 0 at the deadline).
  private updateCombatWarning(): void {
    const escapeDeadline = this.host.getEscapeDeadline();
    if (!this.combatWarning || escapeDeadline === null) return;
    const secondsLeft = Math.max(
      0,
      Math.ceil((escapeDeadline - this.scene.time.now) / 1000),
    );
    this.combatWarning.update(secondsLeft, this.scene.cameras.main);
  }

  // Colours the corner brackets from the highest alert level this frame (clear/investigating/conflict).
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
