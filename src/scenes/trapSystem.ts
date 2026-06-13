import type Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { Trap, type TrapDamageSide } from '../entities/Trap';

/**
 * trapSystem — per-world trap triggering and the trap damage handlers.
 *
 * Owns the per-frame pass that arms/disarms each Trap from the player's
 * position and the Arcade overlap callbacks that turn trap contact into damage.
 * Two damage timings coexist: instant traps hurt on overlap, while snap and
 * ejector traps DEFER damage to a midpoint animation event (the telegraph), so a
 * victim who jumps clear before the midpoint escapes. The shared "victim above
 * the trap" gate excludes side-by-side overlaps so only step-on / drop-onto hits
 * land. Extracted from GameScene; the references it holds are per-build, so it is
 * rebuilt with each world.
 *
 * Inputs:  the host scene services, the player, the enemies group, and the
 *          world's trap list; per-frame player position and trap animation events.
 * Outputs: drives each Trap's trigger state and applies damage to the player and
 *          enemies (environmental hits flagged sourceIsPlayer:false).
 * @calledby the gameplay scene — built at world load, ticked each frame, and
 *           wired into the player/enemy↔trap overlaps and the damage-frame event.
 * @calls    each Trap's trigger/state API and the player/enemy damage paths.
 */

// World tile size in px; used for the spike-ejector's same-tile check.
const TILE_SIZE_PX = 16;

// Scene services the trap system needs; GameScene implements these structurally.
export interface TrapSystemHost {
  readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  getCurrentLevelId(): string | null;
  findLevelIdAt(x: number, y: number): string | null;
  isTileSolidAt(x: number, y: number): boolean;
}

// Per-world trap triggering and damage handlers; rebuilt with each world.
export class TrapSystem {
  private readonly host: TrapSystemHost;
  private readonly player: Player;
  private readonly enemies: Phaser.GameObjects.Group;
  private readonly traps: ReadonlyArray<Trap>;

  constructor(
    host: TrapSystemHost,
    player: Player,
    enemies: Phaser.GameObjects.Group,
    traps: ReadonlyArray<Trap>,
  ) {
    this.host = host;
    this.player = player;
    this.enemies = enemies;
    this.traps = traps;
  }

  // Binds the midpoint damage-frame event on every deferred-damage trap (snap + ejector).
  attachDamageFrameListeners(damageFrameEvent: string): void {
    for (const trap of this.traps) {
      if (trap.hasDeferredDamage()) {
        trap.on(damageFrameEvent, this.onTrapDamageFrame);
      }
    }
  }

  // Arms or disarms every trap each frame based on player position.
  update(): void {
    const pb = this.player.body;
    const grounded = pb.blocked.down || pb.touching.down;
    const playerFootTileX = Math.floor(pb.center.x / TILE_SIZE_PX);
    const playerFootTileY = Math.floor((pb.bottom + 1) / TILE_SIZE_PX);
    const playerLevelId = this.host.getCurrentLevelId();
    for (const trap of this.traps) {
      // Defensive guard: a destroyed sprite throws if we touch .body or call .play() on it.
      if (!trap.active) continue;
      // Swaying-sword has its own trigger + state machine; tickSwayingSwordFall is a no-op outside 'falling'.
      const swayingState = trap.getSwayingSwordState();
      if (swayingState !== null) {
        // Spent swords re-arm when the player leaves the level; null playerLevelId holds state on seams.
        if (swayingState !== 'idle' && playerLevelId !== null) {
          const trapLevelId = this.host.findLevelIdAt(
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
          // Player must be directly under the sword (top below trap body), not alongside or above.
          if (xOverlap && pb.top > tb.bottom) {
            trap.triggerSwayingSword();
          }
        }
        // Tilemap probe avoids spurious embeds from flying enemies nudging touching.down.
        const tb = trap.body;
        const onSolidTerrain = this.host.isTileSolidAt(
          tb.center.x,
          tb.bottom + 1,
        );
        trap.tickSwayingSwordFall(onSolidTerrain);
        continue;
      }
      const kind = trap.getEjectorKind();
      if (kind === null) continue;
      const tb = trap.body;
      let active = false;
      if (kind === 'overhead') {
        // Prefer the configured damage zone so the trigger can extend past the physics body (e.g. shocker).
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

  // Player↔trap overlap: instant hurts for falling sword; snap traps arm here but bite at the midpoint.
  onPlayerHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    playerObj,
    trapObj,
  ) => {
    if (!(playerObj instanceof Player)) return;
    if (!(trapObj instanceof Trap)) return;
    if (playerObj.isDead()) return;

    // Falling sword inverts the usual "victim above trap" gate — any overlap is a hit.
    if (trapObj.isFallingSword()) {
      playerObj.hurt(trapObj.getDamage(), trapObj.x, trapObj.y);
      return;
    }
    if (trapObj.getSwayingSwordState() !== null) return;

    // Center-above gate: filters out side-by-side overlaps; only step-on / drop-onto land.
    if (playerObj.body.center.y >= trapObj.body.center.y) return;

    if (trapObj.hasDirectContactAnimation()) {
      // Spent snap trap is inert until re-armed; grounded ensures actual landing, not just column clip.
      if (!trapObj.isArmed()) return;
      const groundedOnTrap =
        playerObj.body.blocked.down || playerObj.body.touching.down;
      if (!groundedOnTrap) return;
      trapObj.triggerDirectContact();
      return;
    }

    // Ejector traps are a no-op here; the midpoint event decides whether to hurt.
    if (trapObj.hasDeferredDamage()) return;

    playerObj.hurt(trapObj.getDamage(), trapObj.x, trapObj.y);
  };

  // Enemy↔trap overlap: mirrors onPlayerHitsTrap; hits flagged environmental so trap kills don't show the HP bar.
  onEnemyHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    enemyObj,
    trapObj,
  ) => {
    if (!(enemyObj instanceof Enemy)) return;
    if (!(trapObj instanceof Trap)) return;
    if (enemyObj.isDead()) return;
    if (enemyObj.getState() === 'hurt') return;

    // Falling sword: same inverted gate as the player path; sourceIsPlayer:false keeps the HP bar hidden.
    if (trapObj.isFallingSword()) {
      enemyObj.takeDamage(trapObj.getDamage(), trapObj.x, {
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

    enemyObj.takeDamage(trapObj.getDamage(), trapObj.x, {
      sourceIsPlayer: false,
    });
  };

  // Applies deferred trap damage at the animation midpoint, re-checking overlap so escapers take nothing.
  onTrapDamageFrame = (trap: Trap, side?: TrapDamageSide): void => {
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
      // Environmental hit — keeps the HP bar hidden so trap-only kills don't look like player combat.
      child.takeDamage(damage, trap.x, { sourceIsPlayer: false });
    }
  };

  // Returns true if the victim is on the firing side, or if the trap is non-directional.
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

  // Returns true if the victim is inside this trap's kind-specific danger zone at the damage frame.
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
    // Prefer the configured damage zone so the hazard can extend past the physics body (e.g. shocker).
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
      vb.center.y < tb.center.y && this.host.physics.world.overlap(victim, trap)
    );
  }
}
