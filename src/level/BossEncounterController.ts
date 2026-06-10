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

type LevelBounds = {
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
};

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

// The scene services the boss-encounter system needs — GameScene implements
// these structurally (the EnemyHelperScene pattern). The active boss is
// resolved each frame in updateEnemies and stays scene-owned; this controller
// only consumes it (and asks the scene to clear it on a fight reset).
export interface BossEncounterHost {
  getPlayer(): Player;
  getActiveBoss(): Enemy | null;
  forEachEnemy(cb: (enemy: Enemy) => void): void;
  getLevelBoundsAt(x: number, y: number): LevelBounds | null;
  isTileSolidAt(x: number, y: number): boolean;
  attachEnemyToWorld(enemy: Enemy, trackForRespawn: boolean): void;
  clearActiveBoss(): void;
}

// Boss round-fight orchestration: arena-wide convergence, per-round
// reinforcement waves and self-copy splits, summoned minions, and the
// flee-the-arena escape countdown/reset. One instance per GameScene
// instance (like GameHud); teardown() resets the per-world state while the
// monotonic iid counter deliberately survives rebuilds so synthesized iids
// never collide across respawns.
export class BossEncounterController {
  private readonly scene: Phaser.Scene;
  private readonly host: BossEncounterHost;
  private readonly hud: GameHud;

  // Wall-clock deadline (scene time) at which the current boss fight resets
  // because the player left the arena, or null when the player is inside the
  // arena or no boss is engaged. Armed the frame the player first crosses out
  // (see updateLeash); cleared on return or on reset.
  private escapeDeadline: number | null = null;
  // World positions of the General_enemy_spawn markers, collected once at
  // world-build time (setSpawnSites). Reinforcement waves spawn at the subset
  // that falls inside the engaged boss's level.
  private enemySpawnSites: ReadonlyArray<{ x: number; y: number }> = [];
  // Highest round for which a reinforcement wave has fired for the active
  // boss. Latched so each wave spawns once; re-armed when the fight ends.
  private lastReinforcedRound = 0;
  // Live round-fight reinforcements + boss self-copies. Each entry splices
  // itself out on DESTROY so the list only ever holds live reinforcements.
  private reinforcements: Enemy[] = [];
  // Monotonic counter for synthesizing unique iids for spawned
  // reinforcements / copies / minions.
  private reinforcementCounter = 0;
  // Summoned minions ('summon' attacks). Like reinforcements they live in
  // the enemies group but outside spawned.enemies; tracked separately from
  // `reinforcements` so the boss-arena escape system (breakOffArena /
  // resetBossFight) doesn't drop or despawn a summoner's minions, which
  // aren't part of any round fight.
  private summonedMinions: Enemy[] = [];

  constructor(scene: Phaser.Scene, host: BossEncounterHost, hud: GameHud) {
    this.scene = scene;
    this.host = host;
    this.hud = hud;
  }

  getEscapeDeadline(): number | null {
    return this.escapeDeadline;
  }

  // Reinforcement spawn markers for the freshly built world.
  setSpawnSites(sites: ReadonlyArray<{ x: number; y: number }>): void {
    this.enemySpawnSites = sites;
  }

  // Round-fight convergence + reinforcement driver. Runs each frame after
  // updateEnemies resolves the active boss.
  //
  // Convergence: once the boss is in active conflict (isInConflict — blows
  // traded or an attack committed, not merely the player entering the room),
  // every other live enemy inside the boss's level is forced to converge each
  // frame, abandoning their loiter paths and closing on the player regardless
  // of distance OR line of sight (the per-frame refresh means pursuit never
  // lapses mid-fight). Enemies in other levels are left alone — they can't
  // reach the player and shouldn't trudge into walls.
  //
  // Reinforcements: each time the boss's latched round climbs to a wave round
  // (>= BOSS_ROUND_FIRST_REINFORCED_ROUND), a fresh wave spawns at every
  // General_enemy_spawn marker in the boss's level. The round tracker is
  // latched so a wave fires once per round and re-arms when the fight ends.
  update(): void {
    const boss = this.host.getActiveBoss();
    if (!boss || !boss.active || boss.isDead()) {
      this.lastReinforcedRound = 0;
      return;
    }
    const bounds = this.host.getLevelBoundsAt(boss.x, boss.y);

    // Convergence is gated on actual conflict, NOT mere room entry. activeBoss
    // resolves the moment the player crosses into the arena (hasEncountered —
    // which also shows the HUD and plays the encounter sting), but the arena
    // enemies must not swarm until the fight is truly joined: the boss has
    // traded blows or committed an attack (isInConflict). Before that, every
    // enemy keeps its normal LOS-gated behavior, so walking into the room
    // doesn't instantly yank every spider and wasp onto the player. Also gated
    // on the player being inside the arena: once they flee, updateLeash
    // breaks off pursuit each frame, and re-converging here would fight it.
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
      // Spawn a wave for every newly-reached wave round (covers a multi-round
      // jump from one big hit, so no wave is skipped).
      for (let r = this.lastReinforcedRound + 1; r <= round; r += 1) {
        if (r >= BOSS_ROUND_FIRST_REINFORCED_ROUND) {
          this.spawnRoundReinforcements(bounds, boss.getIdentifier(), r);
        }
        // Some bosses also "split" into harmless copies of themselves on a
        // given round (e.g. the Heart Hoarder's round 3). Independent of the
        // reinforcement roster above and latched by the same lastReinforcedRound
        // tracker, so a multi-round jump still fires each round's split once.
        const split = selfCopiesFor(boss.getIdentifier(), r);
        if (split) this.spawnBossSelfCopies(boss, split, bounds);
      }
      this.lastReinforcedRound = round;
    }
  }

  // Boss-fight escape guard, run each frame after update(). While a
  // round-fight boss is engaged, watches whether the player has left its arena —
  // the boss's HOME level rect (getLevelBoundsAt at its spawn point), so the
  // test is robust to a roaming boss and to the inter-level seams where
  // getCurrentLevelId is null. Inside the arena: cancel any countdown. Outside:
  // arm the BOSS_ESCAPE_GRACE_MS countdown, show the warning, and break off
  // every arena enemy each frame so none trail the player out. Past the
  // deadline: reset the fight.
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
    // Player is outside the arena while engaged. Arm the countdown on the first
    // frame out and reveal the warning.
    if (this.escapeDeadline === null) {
      this.escapeDeadline = this.scene.time.now + BOSS_ESCAPE_GRACE_MS;
      this.hud.setEscapeWarningVisible(true);
    }
    this.breakOffArena(boss, arena);
    if (this.scene.time.now >= this.escapeDeadline) {
      this.resetBossFight(boss);
    }
  }

  // Drops pursuit on every enemy tied to the fight so none follow the player out
  // of the arena: all reinforcements/self-copies (wherever they are — they must
  // never trail the player) plus the boss and any native arena enemy currently
  // inside `arena`. Reverts each to its loiter/home/idle behavior instead of a
  // through-walls chase. Called each frame while the player is outside (hold
  // them at the room) and once more at reset.
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

  // Cancels any in-progress escape countdown and hides the warning. Idempotent:
  // early-returns when no countdown is armed, so the per-frame calls (player
  // inside the arena, or no boss engaged) are cheap. Also invoked by
  // restartRun / scene shutdown so a stale countdown can't survive a reset.
  clearEscape(): void {
    if (this.escapeDeadline === null) return;
    this.escapeDeadline = null;
    this.hud.setEscapeWarningVisible(false);
  }

  // Ends and resets an abandoned boss fight (player stayed out past the grace
  // window). Breaks off lingering arena pursuit, despawns every reinforcement +
  // self-copy, re-arms the wave/HUD trackers, resets the boss to its
  // pre-encounter state (full HP, round 1, home position, encounter sting
  // re-armed), and clears the boss HUD + escape warning. Because resetEncounter
  // clears the boss's encounter latch, updateEnemies won't re-select it as the
  // active boss until the player physically re-enters the arena.
  private resetBossFight(boss: Enemy): void {
    const arena = this.host.getLevelBoundsAt(boss.getSpawnX(), boss.getSpawnY());
    if (arena) this.breakOffArena(boss, arena);
    // Destroy reinforcements + self-copies (each DESTROY handler splices the
    // live list, so iterate a copy).
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

  // Spawns one reinforcement wave for `round` of boss `bossId`: the roster from
  // reinforcementsFor(bossId, round) at each General_enemy_spawn marker inside
  // `bounds` (the boss's level). No-op when the level has no markers — the
  // feature stays dormant until sites are placed.
  private spawnRoundReinforcements(
    bounds: LevelBounds | null,
    bossId: string,
    round: number,
  ): void {
    // Flatten the roster to one identifier per unit (e.g. 2 crows + 2 shockers
    // -> [crow, crow, shocker, shocker]) so the whole per-site group spreads
    // evenly regardless of how many enemy types it mixes.
    const units: string[] = [];
    for (const spawn of reinforcementsFor(bossId, round)) {
      for (let i = 0; i < spawn.count; i += 1) units.push(spawn.enemy);
    }
    if (units.length === 0) return;
    // Stagger the sites so a round doesn't dump the whole arena's
    // reinforcements in one frame: each site's whole group still appears
    // together, but successive sites fire one REINFORCEMENT_SITE_STAGGER_MS
    // apart. The first eligible site spawns immediately (delay 0).
    const sites = this.enemySpawnSites.filter(
      (site) => !bounds || isWithinBounds(site.x, site.y, bounds),
    );
    sites.forEach((site, order) => {
      const fire = () => this.spawnSiteWave(units, site.x, site.y);
      if (order === 0) fire();
      else this.scene.time.delayedCall(order * REINFORCEMENT_SITE_STAGGER_MS, fire);
    });
  }

  // Spawns one site's whole reinforcement group simultaneously, spreading the
  // units symmetrically around the marker so they don't materialize stacked on
  // the exact same pixel.
  private spawnSiteWave(units: string[], siteX: number, siteY: number): void {
    for (let i = 0; i < units.length; i += 1) {
      const offsetX =
        (i - (units.length - 1) / 2) * REINFORCEMENT_SPAWN_SPACING_PX;
      this.spawnReinforcement(units[i], siteX + offsetX, siteY);
    }
  }

  // Builds a single reinforcement enemy of `identifier` at (x, marker y), drops
  // it onto the floor beneath the marker (so a high-placed marker doesn't
  // free-fall it into fall damage), wires it into the world WITHOUT respawn
  // tracking (waves are owned by the round system, not the 120s respawn loop),
  // and forces it straight into pursuit.
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
    // Deliberately NOT anchored to a hive: round-fight reinforcement wasps are
    // arena swarmers owned by the encounter system, not hive defenders. They
    // forceConverge onto the player below (which overrides any leash), and with
    // no home anchor they keep the legacy player-anchored loiter if the fight
    // outlasts the converge window — the correct behavior for arena spawns.
    this.reinforcements.push(enemy);
    enemy.once(Phaser.GameObjects.Events.DESTROY, () => {
      const idx = this.reinforcements.indexOf(enemy);
      if (idx >= 0) this.reinforcements.splice(idx, 1);
    });
    enemy.forceConverge();
  }

  // Spawns a single summoned minion of `identifier` beside a 'summon' caster,
  // drops it onto the floor beneath (x, y) so it doesn't free-fall into fall
  // damage, wires it into the world WITHOUT respawn tracking, and forces it
  // into pursuit. Tracked in `summonedMinions` (not `reinforcements`) so the
  // boss-arena escape system never drops/despawns a summoner's minions, while
  // teardown still cleans them up. Returns the new Enemy, or null when
  // `identifier` isn't a behavior-bearing registry entry. Backs the
  // EnemyHelperScene hook Enemy 'summon' attacks call (GameScene delegates).
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

  // Spawns the boss's round "split": spec.count harmless copies of the boss
  // itself, flanking its current position. Each copy is built from the boss's
  // own registry identifier — inheriting every animation, attack, and AI
  // behavior — but spawned harmless (deals no damage, never counts as a boss or
  // round-fight entity, drops nothing) with spec.maxHealth low HP. Copies are
  // wired in WITHOUT respawn tracking (like reinforcements) and forced straight
  // into pursuit. Spawn X is clamped to the arena so a copy can't land inside a
  // wall when the boss splits near an edge; the boss floats (gravity off), so
  // copies spawn at its Y rather than being dropped to the floor.
  private spawnBossSelfCopies(
    boss: Enemy,
    spec: BossSelfCopySpec,
    bounds: LevelBounds | null,
  ): void {
    const identifier = boss.getIdentifier();
    // One coordinator for the whole split. The boss joins immediately (it was
    // built long before this round); each copy joins via its spawn overrides.
    // Gates teleports to one member at a time and feeds the lateral-separation
    // pass so the family never stacks into a single sprite.
    const coordinator = new TeleportCoordinator();
    boss.setTeleportCoordinator(coordinator);
    boss.once(Phaser.GameObjects.Events.DESTROY, () => {
      coordinator.unregister(boss);
    });
    for (let i = 0; i < spec.count; i += 1) {
      // Alternate sides so copies flank the boss and never overlap it:
      // 1st left, 2nd right, 3rd further left, 4th further right, ...
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
      // Same alternating sign/rank as the spawn position, so each copy holds a
      // stand-off slot on the side it spawned: without it every copy (the boss
      // is horizontalMovementOnly) homes to the exact same player.x during the
      // round-fight convergence and the trio stacks into a single entity.
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
        // Leave the group so the teleport lock can't strand on a dead copy and
        // the separation pass stops scanning it.
        coordinator.unregister(copy);
      });
      copy.forceConverge();
    }
  }

  // Walks down from (x, startY) tile-by-tile to the first solid collision tile
  // and returns that tile's top edge (the surface a body rests on). Falls back
  // to startY when nothing solid is found within the probe range. Mirrors
  // Enemy.findGroundY so reinforcement spawns land on the floor.
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

  // World-teardown reset, run from tearDownWorld at the same point the inline
  // block used to sit. Round-fight reinforcements and summoned minions live
  // in the enemies group but outside spawned.enemies, so destroyEntities
  // won't catch them — destroy any still alive here (iterating a copy
  // because each destroy splices the live list), then reset the round-spawn
  // state so a rebuilt world starts the encounter fresh. Clears any
  // in-flight escape countdown so a rebuilt world (HMR / respawn) never
  // carries a stale warning; the overlay itself survives the rebuild, so
  // just hide it.
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
