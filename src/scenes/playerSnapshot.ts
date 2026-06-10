import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { CharacterModeId } from '../sprites/characterTypes';

// Player state preserved across LDtk hot-reloads AND across save→death→
// respawn. Transient action state (locked attacks, combo counter, dash
// duration) is intentionally NOT preserved — restoring mid-attack into a
// freshly-built world is more confusing than letting the player drop back
// to idle for one frame.
//
// To extend: add the field here, capture it in snapshotPlayer(), apply it in
// restorePlayer(). Resource fields (HP/ammo/magic) round-trip through
// Player.applyRestoredState(); position/velocity/mode/facing have dedicated
// setters in restorePlayer().
export interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flipX: boolean;
  mode: CharacterModeId;
  health: number;
  gun1Ammo: number;
  gun2Ammo: number;
  magic: number;
  stamina: number;
  coins: number;
  healItems: number;
}

export function snapshotPlayer(
  player: Player | null | undefined,
): PlayerSnapshot | null {
  if (!player || !player.body) return null;
  return {
    x: player.x,
    y: player.y,
    vx: player.body.velocity.x,
    vy: player.body.velocity.y,
    flipX: player.flipX,
    mode: player.getCurrentMode(),
    health: player.getHealth(),
    gun1Ammo: player.getGun1Ammo(),
    gun2Ammo: player.getGun2Ammo(),
    magic: player.getMagic(),
    stamina: player.getStamina(),
    coins: player.getCoins(),
    healItems: player.getHealItems(),
  };
}

// Applies a snapshot to the (freshly rebuilt) player. `insideAnyLevel` is the
// caller's check that the snapshot position still lands inside the new world
// — when an LDtk edit moved/removed the level under the player, the restore
// is skipped and the fresh spawn position stands.
export function restorePlayer(
  player: Player,
  camera: Phaser.Cameras.Scene2D.Camera,
  snapshot: PlayerSnapshot,
  insideAnyLevel: boolean,
): void {
  if (!insideAnyLevel) {
    if (import.meta.env.DEV) {
      console.info(
        '[HMR] Restored position outside the new world — keeping the LDtk spawn position.',
      );
    }
    return;
  }
  player.setPosition(snapshot.x, snapshot.y);
  player.setVelocity(snapshot.vx, snapshot.vy);
  player.setCurrentMode(snapshot.mode);
  // setFacing must come after setCurrentMode: switching mode plays a fresh
  // idle animation that re-anchors with the *current* flipX. Setting flip
  // last guarantees the final anchor matches the restored facing.
  player.setFacing(snapshot.flipX);
  // Resource fields go through applyRestoredState so Player owns the
  // clamping. Done after the mode switch so any future mode-dependent
  // resource cap can read the right max.
  player.applyRestoredState({
    health: snapshot.health,
    gun1Ammo: snapshot.gun1Ammo,
    gun2Ammo: snapshot.gun2Ammo,
    magic: snapshot.magic,
    stamina: snapshot.stamina,
    coins: snapshot.coins,
    healItems: snapshot.healItems,
  });
  camera.centerOn(snapshot.x, snapshot.y);
}
