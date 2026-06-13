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
 * BossEncounterController — orchestrates a round-fight boss encounter.
 *
 * Owns everything that turns a plain boss into an arena fight: forcing every
 * other enemy in the boss's level to converge on the player once conflict is
 * truly joined, spawning per-round reinforcement waves and boss self-copy splits
 * at the level's General_enemy_spawn markers, backing 'summon' minions, and
 * running the flee-the-arena escape countdown that breaks off pursuit and resets
 * the fight if the player stays out past the grace window. The active boss is
 * resolved scene-side each frame; this controller only consumes it. One instance
 * per GameScene; teardown() resets per-world state but the iid counter survives
 * rebuilds so synthesized iids never collide across respawns.
 *
 * Inputs:  the BossEncounterHost (player, active boss, enemy iteration, level
 *          bounds, tile solidity, world attach), the GameHud, spawn markers, and
 *          boss-wave / self-copy / reinforcement tuning + rosters.
 * Outputs: spawned reinforcement/copy/minion Enemies wired into the world, forced
 *          convergence/pursuit drops on arena enemies, HUD escape-warning + round
 *          state, and a full boss-fight reset.
 * @calledby the scene's per-frame update (convergence + escape leash), world
 *           build (spawn sites), 'summon' attacks, and world teardown.
 * @calls    the enemy rebuild primitive, entity-sound registration, the host's
 *           world-attach/iteration hooks, and the HUD.
 */
type LevelBounds = {
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
};

// True when (x, y) lies inside the level rect b (right/bottom edges exclusive).
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

  constructor(scene: Phaser.Scene, host: BossEncounterHost, hud: GameHud) {
    this.scene = scene;
    this.host = host;
    this.hud = hud;
  }

  // Scene-time of the active escape countdown, or null when none is running.
  getEscapeDeadline(): number | null {
    return this.escapeDeadline;
  }

  // Store the General_enemy_spawn marker positions from the freshly built world.
  setSpawnSites(sites: ReadonlyArray<{ x: number; y: number }>): void {
    this.enemySpawnSites = sites;
  }

  // Per-frame convergence + wave driver: forces arena enemies to chase while in conflict, spawns reinforcement waves and self-copy splits as the boss's round climbs.
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

  // Per-frame escape guard: arms the countdown when the player leaves the arena, breaks off pursuit every frame they're out, and resets the fight if they stay gone.
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

  // Drops pursuit on the boss, all reinforcements, and any arena enemy so none follow the player out.
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

  // Cancels any in-progress escape countdown and hides the HUD warning. Idempotent.
  clearEscape(): void {
    if (this.escapeDeadline === null) return;
    this.escapeDeadline = null;
    this.hud.setEscapeWarningVisible(false);
  }

  // Full boss-fight reset when the player escapes: breaks pursuit, despawns reinforcements, and restores the boss to its pre-encounter state.
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

  // Spawns one reinforcement wave for the given round: one group per spawn marker inside the boss's level, staggered between sites.
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

  // Spawns the whole unit group at one site, spread symmetrically around the marker so they don't stack.
  private spawnSiteWave(units: string[], siteX: number, siteY: number): void {
    for (let i = 0; i < units.length; i += 1) {
      const offsetX =
        (i - (units.length - 1) / 2) * REINFORCEMENT_SPAWN_SPACING_PX;
      this.spawnReinforcement(units[i], siteX + offsetX, siteY);
    }
  }

  // Spawns one reinforcement at the floor below the marker, wires it in without respawn tracking, and immediately forces pursuit.
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

  // Spawns a summoned minion at the floor below (x, y), wired in without respawn tracking and forced into pursuit.
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

  // Spawns harmless boss self-copies flanking the boss's position, sharing a teleport coordinator to avoid stacking.
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

  // Probes down from startY to find the first solid floor tile and returns its top edge.
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

  // Destroys any lingering reinforcements/minions and resets all round-fight state so a rebuilt world starts fresh.
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
