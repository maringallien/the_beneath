import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { CharacterModeId } from '../sprites/characterTypes';

/**
 * playerSnapshot — captures and restores player state across world rebuilds.
 *
 * A plain data snapshot plus its capture/apply pair, used to carry the player
 * through an LDtk hot-reload AND a save→death→respawn. Only persistent state
 * (position, velocity, mode, facing, resources) is preserved; transient action
 * state (locked attacks, combo counter, dash duration) is intentionally dropped,
 * since restoring mid-attack into a freshly-built world reads worse than dropping
 * to idle for one frame. Restore is skipped when the snapshot position no longer
 * lands inside any level, leaving the fresh spawn to stand.
 *
 * Inputs:  a live (or null) Player to snapshot; a snapshot + camera to restore.
 * Outputs: a PlayerSnapshot, or mutations to the rebuilt player + camera.
 * @calledby the world-rebuild path (HMR reload and respawn), around the teardown.
 * @calls    the player's resource/position/mode/facing setters and the camera.
 */

// Persistent player state carried across a world rebuild; add fields here + in both fns to extend.
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

// Captures the current player into a snapshot; returns null if the player or its body isn't ready.
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

// Applies a snapshot to the freshly rebuilt player; skipped if the position no longer lands in a level.
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
  // Flip after mode switch so the fresh idle anchors to the correct facing.
  player.setFacing(snapshot.flipX);
  // Resources after mode switch so any mode-dependent cap reads the right max.
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
