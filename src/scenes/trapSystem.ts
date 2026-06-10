import type Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { Trap, type TrapDamageSide } from '../entities/Trap';

// World-grid tile size in pixels. Used by the spike-ejector's "player on the
// same tile as me" check. Matches the tile spacing assumed by isLineBlocked's
// sample stride and the project's LDtk collision grid.
const TILE_SIZE_PX = 16;

// The scene services the trap system needs — GameScene implements these
// structurally (the EnemyHelperScene pattern).
export interface TrapSystemHost {
  readonly physics: Phaser.Physics.Arcade.ArcadePhysics;
  getCurrentLevelId(): string | null;
  findLevelIdAt(x: number, y: number): string | null;
  isTileSolidAt(x: number, y: number): boolean;
}

// Per-frame trap triggering plus the trap overlap/damage handlers, built per
// world (the references it holds — player, enemies group, trap list — are
// per-build objects). The collider callbacks are arrow properties so GameScene
// can pass them straight to physics.add.overlap with unchanged `this`
// semantics.
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

  // Snap and ejector traps emit TRAP_DAMAGE_FRAME at the midpoint of their
  // damaging animation; onTrapDamageFrame re-checks current overlap then and
  // applies damage to anything still in the danger zone. The listener is
  // bound on the trap sprite, so Phaser's auto-destroy pass tears it down
  // with the sprite — no manual cleanup needed.
  attachDamageFrameListeners(damageFrameEvent: string): void {
    for (const trap of this.traps) {
      if (trap.hasDeferredDamage()) {
        trap.on(damageFrameEvent, this.onTrapDamageFrame);
      }
    }
  }

  // Drives every trap's trigger state from the player's position once per
  // frame. Two trigger semantics:
  //   - 'overhead' (smoke/flame ejector): player's body center is above the
  //     trap's and their X spans overlap — i.e., in the column directly over
  //     the ejector. Center comparison (not bottom ≤ top) makes the check
  //     fire when the player walks across the trap at the same floor level
  //     too, not just when jumping clean over it.
  //   - 'attached-ground' (spike ejector): player is grounded AND their foot
  //     tile is the exact tile directly beneath the trap's body — i.e.,
  //     they're standing on the ground tile the trap is mounted to.
  // Non-ejector traps return null from getEjectorKind() and are skipped.
  update(): void {
    const pb = this.player.body;
    const grounded = pb.blocked.down || pb.touching.down;
    const playerFootTileX = Math.floor(pb.center.x / TILE_SIZE_PX);
    const playerFootTileY = Math.floor((pb.bottom + 1) / TILE_SIZE_PX);
    const playerLevelId = this.host.getCurrentLevelId();
    for (const trap of this.traps) {
      // Traps are indestructible hazards — neither sword nor projectile can
      // break one, and the trap list is never pruned mid-play. The !active
      // guard is therefore defensive: it keeps this loop from touching .body or
      // calling .play() on a sprite the group teardown has destroyed (a dead
      // sprite throws and stalls the scene update loop).
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
  // (driven by update) is what gets the ejection cycle running, and
  // the midpoint event then decides whether to hurt the player.
  onPlayerHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    playerObj,
    trapObj,
  ) => {
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
  onEnemyHitsTrap: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    enemyObj,
    trapObj,
  ) => {
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

  // Fired by Trap at the midpoint of its damaging animation. Re-checks
  // current body overlap with the trap so a victim who has been knocked
  // out of the danger zone (or has jumped off) takes nothing — that's
  // the whole point of deferring damage: the trap telegraphs the hit
  // and the victim can react. Both player and enemies are checked so
  // a single midpoint can damage either or both.
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
      // sourceIsPlayer:false — trap damage is environmental and should not
      // flip the enemy into combat (i.e., shouldn't reveal the HP bar). The
      // player engaging combat with traps as the only hit doesn't track.
      child.takeDamage(damage, trap.x, { sourceIsPlayer: false });
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
  // condition that triggers the cycle in update), since the player
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
      vb.center.y < tb.center.y && this.host.physics.world.overlap(victim, trap)
    );
  }
}
