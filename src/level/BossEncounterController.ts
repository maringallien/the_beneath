import Phaser from 'phaser';
import { registerEntitySound } from '../audio';
import {
  BOSS_ESCAPE_GRACE_MS,
  BOSS_ROUND_FIRST_REINFORCED_ROUND,
  BOSS_SELF_COPY_CHASE_STANDOFF_PX,
  BOSS_SELF_COPY_SPAWN_OFFSET_PX,
  REINFORCEMENT_SITE_STAGGER_MS,
  REINFORCEMENT_SPAWN_LIFT_PX,
  REINFORCEMENT_SPAWN_SPACING_PX,
} from '../constants';
import {
  selfCopiesFor,
  type BossSelfCopySpec,
} from '../entities/bossSelfCopies';
import { reinforcementsFor } from '../entities/bossWaves';
import type { Enemy } from '../entities/Enemy';
import { respawnEnemyAt } from '../entities/EntityFactory';
import type { Player } from '../entities/Player';
import { TeleportCoordinator } from '../entities/teleportCoordinator';
import type { GameHud } from '../scenes/gameHud';

/**
 * @file level/BossEncounterController.ts
 * @description Turns a plain boss into an arena fight — forces every other enemy in the boss's level to converge on the player once conflict is truly joined (isInConflict, not merely spotted), spawns per-round reinforcement waves and boss self-copy splits at the level's General_enemy_spawn markers, backs 'summon' minions, and runs the flee-the-arena escape countdown that breaks off pursuit and resets the fight if the player stays out past the grace window; the active boss is resolved scene-side each frame (this controller only consumes it); one instance per GameScene; teardown resets per-world state but the iid counter survives rebuilds so synthesized iids never collide.
 * @module level
 */
type LevelBounds = {
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
};

/**
 * @function    isWithinBounds
 * @description True when (x, y) lies inside the level rect b (right/bottom edges exclusive).
 * @param   x  World-px x to test.
 * @param   y  World-px y to test.
 * @param   b  Level rect: worldX/worldY origin plus pxWid/pxHei extent.
 * @returns whether the point lies inside the rect.
 * @calledby arena-bounds checks throughout BossEncounterController (player/boss/enemy inside the fight arena)
 * @calls    pure arithmetic comparisons only; no delegation
 */
export function isWithinBounds(
  x: number,
  y: number,
  b: LevelBounds,
): boolean {
  return (
    x >= b.worldX &&
    x < b.worldX + b.pxWid &&
    y >= b.worldY &&
    y < b.worldY + b.pxHei
  );
}

// Scene services the controller depends on; GameScene implements these structurally.
export interface BossEncounterHost {
  getPlayer(): Player;
  getActiveBoss(): Enemy | null;
  forEachEnemy(cb: (enemy: Enemy) => void): void;
  getLevelBoundsAt(x: number, y: number): LevelBounds | null;
  isTileSolidAt(x: number, y: number): boolean;
  attachEnemyToWorld(enemy: Enemy, trackForRespawn: boolean): void;
  clearActiveBoss(): void;
}

export class BossEncounterController {
  private readonly scene: Phaser.Scene;
  private readonly host: BossEncounterHost;
  private readonly hud: GameHud;

  // Countdown deadline for when an escaped player triggers a fight reset; null when not active.
  private escapeDeadline: number | null = null;
  // General_enemy_spawn marker positions collected at world-build time.
  private enemySpawnSites: ReadonlyArray<{ x: number; y: number }> = [];
  // Highest round that has already spawned a reinforcement wave; reset when the fight ends.
  private lastReinforcedRound = 0;
  // Live reinforcements + boss self-copies; each splices itself out on DESTROY.
  private reinforcements: Enemy[] = [];
  // Monotonic iid counter so synthesized enemy ids never collide.
  private reinforcementCounter = 0;
  // Summoned minions from 'summon' attacks — tracked separately so escape resets don't despawn them.
  private summonedMinions: Enemy[] = [];

  /** Wires the scene, host services, and HUD. */
  constructor(scene: Phaser.Scene, host: BossEncounterHost, hud: GameHud) {
    this.scene = scene;
    this.host = host;
    this.hud = hud;
  }

  /** Scene-time of the active escape countdown, or null when none is running. */
  getEscapeDeadline(): number | null {
    return this.escapeDeadline;
  }

  /** Store the General_enemy_spawn marker positions from the freshly built world. */
  setSpawnSites(sites: ReadonlyArray<{ x: number; y: number }>): void {
    this.enemySpawnSites = sites;
  }

  /**
   * @function    update
   * @description Per-frame convergence + wave driver: forces arena enemies to chase while in conflict, spawns reinforcement waves and self-copy splits as the boss's round climbs; resets the round tracker when no boss is alive.
   * @calledby src/scenes/GameScene.ts → per-frame update tick (while a boss is active)
   * @calls    spawnRoundReinforcements, spawnBossSelfCopies, selfCopiesFor (src/entities/bossSelfCopies.ts), and forceConverge on each in-arena enemy
   */
  update(): void {
    const boss = this.host.getActiveBoss();
    if (!boss || !boss.active || boss.isDead()) {
      this.lastReinforcedRound = 0;
      return;
    }
    const bounds = this.host.getLevelBoundsAt(boss.x, boss.y);

    // Only converge once the boss has actually traded blows (isInConflict), not just been spotted —
    // and only while the player is still in the arena so this doesn't fight updateLeash's break-off.
    const player = this.host.getPlayer();
    const playerInArena =
      bounds !== null && isWithinBounds(player.x, player.y, bounds);
    if (boss.isInConflict() && playerInArena) {
      this.host.forEachEnemy((enemy) => {
        if (enemy === boss) return;
        if (!enemy.active) return;
        if (bounds && !isWithinBounds(enemy.x, enemy.y, bounds)) return;
        enemy.forceConverge();
      });
    }

    const round = boss.getRound();
    if (round > this.lastReinforcedRound) {
      // Spawn a wave for each newly-reached round so a multi-round jump doesn't skip any.
      for (let r = this.lastReinforcedRound + 1; r <= round; r += 1) {
        if (r >= BOSS_ROUND_FIRST_REINFORCED_ROUND) {
          this.spawnRoundReinforcements(bounds, boss.getIdentifier(), r);
        }
        // Some bosses also split into harmless copies on certain rounds; latched by the same tracker.
        const split = selfCopiesFor(boss.getIdentifier(), r);
        if (split) this.spawnBossSelfCopies(boss, split, bounds);
      }
      this.lastReinforcedRound = round;
    }
  }

  /**
   * @function    updateLeash
   * @description Per-frame escape guard: arms the countdown when the player leaves the arena, breaks off pursuit every frame they're out, and resets the fight if they stay gone.
   * @calledby src/scenes/GameScene.ts → per-frame update tick, alongside the convergence driver
   * @calls    the arena pursuit break-off, escape-countdown clearing, and the full boss-fight reset on timeout
   */
  updateLeash(): void {
    const boss = this.host.getActiveBoss();
    if (!boss || !boss.active || boss.isDead()) {
      this.clearEscape();
      return;
    }
    const arena = this.host.getLevelBoundsAt(boss.getSpawnX(), boss.getSpawnY());
    const player = this.host.getPlayer();
    if (!arena || isWithinBounds(player.x, player.y, arena)) {
      this.clearEscape();
      return;
    }
    // Arm the countdown on the first frame out and show the warning.
    if (this.escapeDeadline === null) {
      this.escapeDeadline = this.scene.time.now + BOSS_ESCAPE_GRACE_MS;
      this.hud.setEscapeWarningVisible(true);
    }
    this.breakOffArena(boss, arena);
    if (this.scene.time.now >= this.escapeDeadline) {
      this.resetBossFight(boss);
    }
  }

  /**
   * @function    breakOffArena
   * @description Drops pursuit on the boss, all reinforcements, and any arena enemy so none follow the player out.
   * @param   boss   The active boss.
   * @param   arena  The level rect to confine the break-off to.
   * @calledby src/level/BossEncounterController.ts → updateLeash, resetBossFight
   * @calls    each enemy's drop-pursuit, gated by the in-bounds test
   */
  private breakOffArena(boss: Enemy, arena: LevelBounds): void {
    boss.dropPursuit();
    for (const enemy of this.reinforcements) {
      if (enemy.active) enemy.dropPursuit();
    }
    this.host.forEachEnemy((enemy) => {
      if (enemy === boss) return;
      if (!enemy.active) return;
      if (!isWithinBounds(enemy.x, enemy.y, arena)) return;
      enemy.dropPursuit();
    });
  }

  /**
   * @function    clearEscape
   * @description Cancels any in-progress escape countdown and hides the HUD warning. Idempotent — no-op when no countdown is armed.
   * @calledby src/level/BossEncounterController.ts → updateLeash, resetBossFight
   * @calls    hiding the HUD escape-warning banner
   */
  clearEscape(): void {
    if (this.escapeDeadline === null) return;
    this.escapeDeadline = null;
    this.hud.setEscapeWarningVisible(false);
  }

  /**
   * @function    resetBossFight
   * @description Full boss-fight reset when the player escapes: breaks pursuit, despawns reinforcements, and restores the boss to its pre-encounter state.
   * @param   boss  The active boss being reset.
   * @calledby src/level/BossEncounterController.ts → updateLeash, once the grace window expires with the player still gone
   * @calls    breakOffArena, each reinforcement's destroy, the boss's encounter reset, the host's active-boss clear, and HUD round reset
   */
  private resetBossFight(boss: Enemy): void {
    const arena = this.host.getLevelBoundsAt(boss.getSpawnX(), boss.getSpawnY());
    if (arena) this.breakOffArena(boss, arena);
    // Iterate a copy since each DESTROY splices the live list.
    for (const enemy of [...this.reinforcements]) {
      if (enemy.active) enemy.destroy();
    }
    this.reinforcements = [];
    this.lastReinforcedRound = 0;
    boss.resetEncounter();
    this.host.clearActiveBoss();
    this.hud.resetBossRound();
    this.clearEscape();
  }

  /**
   * @function    spawnRoundReinforcements
   * @description Spawns one reinforcement wave for the given round: one group per spawn marker inside the boss's level, staggered between sites; no-op when the roster yields no units.
   * @param   bounds  The boss's level rect, or null to allow any site.
   * @param   bossId  Roster key for the boss.
   * @param   round   The round number to draw the wave for.
   * @calledby src/level/BossEncounterController.ts → update, once for each newly-reached round at or past the first reinforced round
   * @calls    reinforcementsFor (src/entities/bossWaves.ts), then spawnSiteWave per marker on a stagger
   */
  private spawnRoundReinforcements(
    bounds: LevelBounds | null,
    bossId: string,
    round: number,
  ): void {
    // Flatten the roster to one identifier per unit so a mixed group spreads evenly across sites.
    const units: string[] = [];
    for (const spawn of reinforcementsFor(bossId, round)) {
      for (let i = 0; i < spawn.count; i += 1) units.push(spawn.enemy);
    }
    if (units.length === 0) return;
    // Stagger successive sites so reinforcements don't all appear in one frame; first site fires immediately.
    const sites = this.enemySpawnSites.filter(
      (site) => !bounds || isWithinBounds(site.x, site.y, bounds),
    );
    sites.forEach((site, order) => {
      const fire = () => this.spawnSiteWave(units, site.x, site.y);
      if (order === 0) fire();
      else this.scene.time.delayedCall(order * REINFORCEMENT_SITE_STAGGER_MS, fire);
    });
  }

  /**
   * @function    spawnSiteWave
   * @description Spawns the whole unit group at one site, spread symmetrically around the marker so they don't stack.
   * @param   units  One identifier per unit to spawn.
   * @param   siteX  Marker x (world px).
   * @param   siteY  Marker y (world px).
   * @calledby src/level/BossEncounterController.ts → spawnRoundReinforcements, immediately for the first site and after a stagger delay for the rest
   * @calls    spawnReinforcement per unit
   */
  private spawnSiteWave(units: string[], siteX: number, siteY: number): void {
    for (let i = 0; i < units.length; i += 1) {
      const offsetX =
        (i - (units.length - 1) / 2) * REINFORCEMENT_SPAWN_SPACING_PX;
      this.spawnReinforcement(units[i], siteX + offsetX, siteY);
    }
  }

  /**
   * @function    spawnReinforcement
   * @description Spawns one reinforcement at the floor below the marker, wires it in without respawn tracking, and immediately forces convergence; no-op if the rebuild fails.
   * @param   identifier  Enemy roster key.
   * @param   x           World-px column to spawn at.
   * @param   markerY     World-px y the floor is probed below.
   * @calledby src/level/BossEncounterController.ts → spawnSiteWave, once per unit in the group
   * @calls    groundYBelow, respawnEnemyAt (src/entities/EntityFactory.ts), registerEntitySound (src/audio), the host's attachEnemyToWorld, and forceConverge
   */
  private spawnReinforcement(identifier: string, x: number, markerY: number): void {
    const groundY = this.groundYBelow(x, markerY);
    const spawnY = groundY - REINFORCEMENT_SPAWN_LIFT_PX;
    const iid = `reinforcement-${this.reinforcementCounter}`;
    this.reinforcementCounter += 1;
    const enemy = respawnEnemyAt(
      this.scene,
      identifier,
      x,
      spawnY,
      iid,
      null,
    );
    if (!enemy) return;
    registerEntitySound(this.scene, identifier, iid, x, spawnY);
    this.host.attachEnemyToWorld(enemy, false);
    // Not hive-anchored: reinforcement wasps are arena swarmers, not hive defenders.
    this.reinforcements.push(enemy);
    enemy.once(Phaser.GameObjects.Events.DESTROY, () => {
      const idx = this.reinforcements.indexOf(enemy);
      if (idx >= 0) this.reinforcements.splice(idx, 1);
    });
    enemy.forceConverge();
  }

  /**
   * @function    summonEnemyAt
   * @description Spawns a summoned minion at the floor below (x, y), wired in without respawn tracking and forced into pursuit; tracked separately so escape resets don't despawn it.
   * @param   identifier  Enemy roster key.
   * @param   x           World-px column to spawn at.
   * @param   y           World-px y the floor is probed below.
   * @returns the spawned Enemy, or null if the rebuild fails.
   * @calledby src/scenes/GameScene.ts → summonEnemyAt (a boss 'summon' attack resolving its minions, via Enemy.ts)
   * @calls    groundYBelow, respawnEnemyAt (src/entities/EntityFactory.ts), registerEntitySound (src/audio), the host's attachEnemyToWorld, and forcePursue
   */
  summonEnemyAt(identifier: string, x: number, y: number): Enemy | null {
    const groundY = this.groundYBelow(x, y);
    const spawnY = groundY - REINFORCEMENT_SPAWN_LIFT_PX;
    const iid = `summon-${this.reinforcementCounter}`;
    this.reinforcementCounter += 1;
    const enemy = respawnEnemyAt(this.scene, identifier, x, spawnY, iid, null);
    if (!enemy) return null;
    registerEntitySound(this.scene, identifier, iid, x, spawnY);
    this.host.attachEnemyToWorld(enemy, false);
    this.summonedMinions.push(enemy);
    enemy.once(Phaser.GameObjects.Events.DESTROY, () => {
      const idx = this.summonedMinions.indexOf(enemy);
      if (idx >= 0) this.summonedMinions.splice(idx, 1);
    });
    enemy.forcePursue();
    return enemy;
  }

  /**
   * @function    spawnBossSelfCopies
   * @description Spawns harmless boss self-copies flanking the boss's position, sharing a teleport coordinator to avoid stacking; alternates copies left/right and forces each to converge.
   * @param   boss    The original being cloned.
   * @param   spec    Copy count, max health, and the harmless-copy config.
   * @param   bounds  Level rect to clamp spawn x into, or null.
   * @calledby src/level/BossEncounterController.ts → update, for bosses whose round triggers a self-copy split
   * @calls    the TeleportCoordinator and respawnEnemyAt with harmless-copy options, registerEntitySound (src/audio), the host's attachEnemyToWorld, and forceConverge
   */
  private spawnBossSelfCopies(
    boss: Enemy,
    spec: BossSelfCopySpec,
    bounds: LevelBounds | null,
  ): void {
    const identifier = boss.getIdentifier();
    // One coordinator for the whole split so teleports are gated and copies stay laterally spread.
    const coordinator = new TeleportCoordinator();
    boss.setTeleportCoordinator(coordinator);
    boss.once(Phaser.GameObjects.Events.DESTROY, () => {
      coordinator.unregister(boss);
    });
    for (let i = 0; i < spec.count; i += 1) {
      // Alternate sides so copies flank the boss without overlapping.
      const rank = Math.floor(i / 2) + 1;
      const sign = i % 2 === 0 ? -1 : 1;
      let x = boss.x + sign * rank * BOSS_SELF_COPY_SPAWN_OFFSET_PX;
      if (bounds) {
        const minX = bounds.worldX + BOSS_SELF_COPY_SPAWN_OFFSET_PX;
        const maxX =
          bounds.worldX + bounds.pxWid - BOSS_SELF_COPY_SPAWN_OFFSET_PX;
        x = Math.max(minX, Math.min(maxX, x));
      }
      const iid = `boss-copy-${this.reinforcementCounter}`;
      this.reinforcementCounter += 1;
      // Chase standoff matches spawn side so copies don't all home to the same player.x and stack.
      const chaseStandoffX = sign * rank * BOSS_SELF_COPY_CHASE_STANDOFF_PX;
      const copy = respawnEnemyAt(this.scene, identifier, x, boss.y, iid, null, {
        harmless: true,
        maxHealth: spec.maxHealth,
        chaseStandoffX,
        attackCoordinator: coordinator,
      });
      if (!copy) continue;
      registerEntitySound(this.scene, identifier, iid, x, boss.y);
      this.host.attachEnemyToWorld(copy, false);
      this.reinforcements.push(copy);
      copy.once(Phaser.GameObjects.Events.DESTROY, () => {
        const idx = this.reinforcements.indexOf(copy);
        if (idx >= 0) this.reinforcements.splice(idx, 1);
        // Unregister so the teleport lock and separation pass stop tracking this copy.
        coordinator.unregister(copy);
      });
      copy.forceConverge();
    }
  }

  /**
   * @function    groundYBelow
   * @description Probes down from startY to find the first solid floor tile and returns its top edge.
   * @param   x       World-px column to probe.
   * @param   startY  World-px y to begin the downward scan.
   * @returns world-px y of the first solid tile's top edge, or startY if none is found within the probe budget.
   * @calledby src/level/BossEncounterController.ts → spawnReinforcement, summonEnemyAt
   * @calls    the host's isTileSolidAt, stepping downward tile by tile
   */
  private groundYBelow(x: number, startY: number): number {
    const TILE_SIZE = 16;
    const startTileY = Math.floor(startY / TILE_SIZE);
    const maxTiles = 48;
    for (let i = 0; i < maxTiles; i += 1) {
      const probeY = (startTileY + i) * TILE_SIZE + TILE_SIZE / 2;
      if (this.host.isTileSolidAt(x, probeY)) {
        return (startTileY + i) * TILE_SIZE;
      }
    }
    return startY;
  }

  /**
   * @function    teardown
   * @description Destroys any lingering reinforcements/minions and resets all round-fight state so a rebuilt world starts fresh — clears spawn sites, round tracker, and escape state, and hides the HUD warning; the iid counter deliberately survives.
   * @calledby src/scenes/GameScene.ts → world teardown, before the scene rebuilds its levels
   * @calls    each tracked enemy's destroy and hiding the HUD escape warning
   */
  teardown(): void {
    for (const enemy of [...this.reinforcements]) {
      if (enemy.active) enemy.destroy();
    }
    this.reinforcements = [];
    for (const enemy of [...this.summonedMinions]) {
      if (enemy.active) enemy.destroy();
    }
    this.summonedMinions = [];
    this.lastReinforcedRound = 0;
    this.enemySpawnSites = [];
    this.escapeDeadline = null;
    this.hud.setEscapeWarningVisible(false);
  }
}
