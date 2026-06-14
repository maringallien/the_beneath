import type Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { CharacterModeId } from '../sprites/characterTypes';

/**
 * @file scenes/playerSnapshot.ts
 * @description Captures and restores player state across world rebuilds — a plain data snapshot plus its capture/apply pair, used to carry the player through an LDtk hot-reload AND a save/death/respawn. Only persistent state (position, velocity, mode, facing, resources) is preserved; transient action state (locked attacks, combo counter, dash duration) is intentionally dropped, since restoring mid-attack into a freshly-built world reads worse than dropping to idle for one frame. Restore is skipped when the snapshot position no longer lands inside any level, leaving the fresh spawn to stand.
 * @module scenes
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

/**
 * @function    snapshotPlayer
 * @description Captures the current player into a snapshot of persistent state.
 * @param   player  A live Player, or null/undefined when none exists yet.
 * @returns a PlayerSnapshot, or null if the player or its physics body isn't ready.
 * @calledby src/scenes/GameScene.ts → the world-rebuild path just before teardown (HMR reload and respawn) and the save crystal
 * @calls    the player's position/velocity/mode/facing and resource getters
 */
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

/**
 * @function    restorePlayer
 * @description Applies a snapshot to the freshly rebuilt player and recentres the camera; a no-op when the position falls outside every level (the fresh LDtk spawn stands). Facing and resources are set after the mode switch so caps and the idle anchor read correctly.
 * @param   player          The rebuilt Player.
 * @param   camera          Camera to recentre on the restored position.
 * @param   snapshot        The captured state to apply.
 * @param   insideAnyLevel  false when the saved position no longer fits the world — keeps the LDtk spawn.
 * @calledby src/scenes/GameScene.ts → restorePlayerSnapshot on the world-rebuild path, after the fresh world is built (HMR reload and respawn)
 * @calls    the player's position/velocity/mode/facing setters, the restored-state applier, and the camera
 */
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
