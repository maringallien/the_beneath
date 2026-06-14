import Phaser from 'phaser';
import { INTERACTION_RANGE_SQ } from '../constants';
import { rollDrop } from './AmmoDrop';
import type { AmmoDropSpawnerScene } from './AmmoDropSpawnerScene';
import { AnimatedEntity } from './AnimatedEntity';
import { entityAnimFullKey } from './entityRegistryLoader';
import type { Interactable } from './Interactable';
import { isChestOpened, recordChestOpened } from '../state/runProgress';

// gap so the icon floats just above the lid silhouette rather than flush against it
const ICON_ANCHOR_GAP_PX = 2;

/**
 * @file entities/Chest.ts
 * @description Interactable treasure chest: sits frozen on frame 0 until the player completes a hold-E (driven by the interaction manager), then plays its open clip once, becomes permanently non-interactable, and rolls any configured drops on completion. The base constructor's random-phase default is overridden to a fixed closed pose so the open clip replays cleanly from the start. The opened state is persisted in the run-progress store keyed by LDtk iid, so it survives the world rebuilds that death/respawn and HMR perform: a looted chest stays open (on its final frame) for the rest of the run and resets only on New Game / Quit.
 * @module entities
 */
export class Chest extends AnimatedEntity implements Interactable {
  private readonly iid: string;
  private opened = false;
  private opening = false;

  /**
   * @function    constructor
   * @description Build the chest, overriding the base random-phase idle so a fresh chest rests on frame 0 and a previously-looted chest (per the persisted opened-set) restores to its open frame.
   * @param   x, y         Spawn position (world px).
   * @param   identifier   Registry identifier (Chest1_spawn / Chest2_spawn).
   * @param   iid          LDtk iid, the persistence key for the opened state.
   * @calledby src/entities/EntityFactory.ts → the Chest1_spawn / Chest2_spawn factories during a level's spawn walk
   * @calls    the AnimatedEntity base setup and src/state/runProgress.ts → isChestOpened
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    identifier: string,
    iid: string,
  ) {
    super(scene, x, y, identifier);
    this.iid = iid;
    this.anims.stop();
    if (isChestOpened(iid)) {
      this.opened = true;
      this.setFrame(this.openedFrameIndex());
    } else {
      this.setFrame(0);
    }
  }

  /** Last frame of the open clip — the pose a pre-opened chest rests on without replaying. */
  private openedFrameIndex(): number {
    const anim = this.config.animations[this.config.defaultAnimation];
    return Math.max(0, anim.frameCount - 1);
  }

  /** Where the hold-E prompt icon floats: centered just above the chest's top. */
  getInteractionAnchor(): { x: number; y: number } {
    return { x: this.x, y: this.body.top - ICON_ANCHOR_GAP_PX };
  }

  /** Squared player-distance within which the E prompt is offered. */
  getInteractionRangeSq(): number {
    return INTERACTION_RANGE_SQ;
  }

  /** Offer the prompt only while closed and not mid-open; an opened chest is done. */
  canInteract(): boolean {
    return !this.opened && !this.opening;
  }

  /**
   * @function    onInteract
   * @description On a completed hold, and only while still openable, start the open sequence.
   * @calledby src/entities/InteractionManager.ts → update, when the player completes a hold on this chest
   * @calls    src/entities/Chest.ts → canInteract and playChestOpen
   */
  onInteract(): void {
    if (!this.canInteract()) return;
    this.playChestOpen();
  }

  // TODO: playOneShot(this.scene, 'chest_open') once the audio registry has
  // a chest_open entry. The audio system already supports playOneShot; only asset+registry wiring is missing.
  /**
   * @function    playChestOpen
   * @description Play the open clip once; on completion mark the chest opened, persist that to run-progress, and roll any configured drops.
   * @calledby src/entities/Chest.ts → onInteract, on a completed hold-E on an openable chest
   * @calls    entityAnimFullKey, the Phaser play/once hooks, src/state/runProgress.ts → recordChestOpened, and maybeSpawnAmmoDrop on completion
   */
  private playChestOpen(): void {
    this.opening = true;
    const animKey = entityAnimFullKey(
      this.getIdentifier(),
      this.config.defaultAnimation,
    );
    this.play(animKey);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.opening = false;
      this.opened = true;
      recordChestOpened(this.iid);
      this.maybeSpawnAmmoDrop();
    });
  }

  /**
   * @function    maybeSpawnAmmoDrop
   * @description Roll each configured drop and spawn any successful results at the chest's top edge.
   * @calledby src/entities/Chest.ts → playChestOpen, on the open animation's completion after the chest is marked open
   * @calls    src/entities/AmmoDrop.ts → rollDrop and the scene's spawnAmmoDrop
   */
  private maybeSpawnAmmoDrop(): void {
    const drops = this.config.drops;
    if (!drops || drops.length === 0) return;
    const spawner = this.scene as unknown as AmmoDropSpawnerScene;
    for (const dropConfig of drops) {
      const kind = rollDrop(dropConfig);
      if (!kind) continue;
      spawner.spawnAmmoDrop(kind, this.x, this.body.top);
    }
  }
}
