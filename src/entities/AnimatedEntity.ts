import Phaser from 'phaser';
import { ENTITY_DEPTH } from '../constants';
import { getSpriteAnchor } from '../sprites/characterLoader';
import {
  entityAnimFullKey,
  getEntityRegistryEntry,
} from './entityRegistryLoader';
import type { AnimatedEntityConfig } from './entityRegistryTypes';

/**
 * @file entities/AnimatedEntity.ts
 * @description Registry-driven base sprite: turns "this LDtk identifier is animated" into a Phaser sprite running an animation by reading the entityRegistry JSON, so per-entity behavior lives in data instead of N hand-written subclasses. The baseline just plays an anim in place at the LDtk position (no input, combat, or overlays); Door, Enemy, Chest, Trap subclass it. Owns the anchor-and-body wiring — on every ANIMATION_START it re-derives origin, scale, and physics-body size/offset from the sprite's per-anim anchor, the invariant that keeps the body aligned to the art across anim swaps and facing flips.
 * @module entities
 */
export class AnimatedEntity extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private readonly identifier: string;
  protected readonly config: AnimatedEntityConfig;

  /**
   * @function    constructor
   * @description Look up the registry entry, wire physics/animation, and start the default anim at a random phase so identical entities (e.g. a row of crows) don't animate in lockstep; throws if the entry or its texture is missing.
   * @param   scene       Owning Phaser scene.
   * @param   x, y        Spawn position (world px).
   * @param   identifier  LDtk identifier resolved against the registry.
   * @calledby src/entities/EntityFactory.ts → the auto-generated decoration factory, and subclass constructors via super
   * @calls    src/entities/entityRegistryLoader.ts → getEntityRegistryEntry / entityAnimFullKey, and Phaser's add/physics/animation systems
   */
  constructor(scene: Phaser.Scene, x: number, y: number, identifier: string) {
    const config = getEntityRegistryEntry(identifier);
    if (!config) {
      throw new Error(
        `AnimatedEntity: no registry entry for identifier "${identifier}"`,
      );
    }
    const initialKey = entityAnimFullKey(identifier, config.defaultAnimation);
    if (!scene.textures.exists(initialKey)) {
      throw new Error(
        `AnimatedEntity textures not loaded — expected key "${initialKey}". ` +
          'Did PreloadScene run preloadAllEntities before constructing?',
      );
    }
    super(scene, x, y, initialKey);
    this.identifier = identifier;
    this.config = config;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    // above tile layers; depth 0 would hide entities under LDtk foreground layers
    this.setDepth(ENTITY_DEPTH);

    // applyAnimationAnchor overwrites this on the first ANIMATION_START; just a safety net
    this.body.setSize(config.physicsBody.width, config.physicsBody.height);
    // gravity off by default; config.gravity lets ground-bound enemies opt in
    this.body.setAllowGravity(config.gravity === true);
    this.body.setImmovable(false);

    this.on(
      Phaser.Animations.Events.ANIMATION_START,
      this.applyAnimationAnchor,
      this,
    );

    this.play(initialKey);
    // random phase so identical entities (e.g. a row of crows) don't animate in lockstep
    this.anims.setProgress(Math.random());
  }

  /**
   * @function    playLogical
   * @description Play a logical (un-namespaced) anim key, resolving it to the entity-prefixed full key; no-ops if the key isn't in config.
   * @param   animKey  Logical animation name from the registry entry.
   * @returns true if the anim existed and was played, false otherwise.
   * @calledby widely used — Door, Enemy, Trap, Save, Portal, Player driving their own animation state transitions
   * @calls    src/entities/entityRegistryLoader.ts → entityAnimFullKey, then the Phaser sprite animation play
   */
  playLogical(animKey: string): boolean {
    if (!(animKey in this.config.animations)) return false;
    const fullKey = entityAnimFullKey(this.identifier, animKey);
    this.play(fullKey);
    return true;
  }

  /** This entity's LDtk identifier (its registry key). */
  getIdentifier(): string {
    return this.identifier;
  }

  /**
   * @function    setFacing
   * @description Flip the sprite and re-apply the body anchor so it stays correct after a facing change; no-ops if already facing that way.
   * @param   faceLeft  True to face left / mirror the sprite.
   * @calledby src/entities/Enemy.ts, src/entities/Player.ts, src/scenes/playerSnapshot.ts → turning the entity to track a target or movement
   * @calls    src/entities/AnimatedEntity.ts → applyAnimationAnchor for the current animation
   */
  setFacing(faceLeft: boolean): void {
    if (this.flipX === faceLeft) return;
    this.setFlipX(faceLeft);
    const currentAnim = this.anims.currentAnim;
    if (currentAnim) {
      this.applyAnimationAnchor(currentAnim);
    }
  }

  /**
   * @function    applyAnimationAnchor
   * @description Re-derive origin, scale, and body size/offset from the new anim's anchor data — the invariant that keeps the physics body aligned to the art; must run on every anim swap and facing flip.
   * @param   animation  The Phaser animation whose anchor data to apply.
   * @calledby Phaser ANIMATION_START event (registered in the constructor), and setFacing on a flip
   * @calls    src/sprites/characterLoader.ts → getSpriteAnchor, then the sprite/body setters
   */
  private applyAnimationAnchor(animation: Phaser.Animations.Animation): void {
    const { width: bodyW, height: bodyH } = this.config.physicsBody;
    const {
      originX,
      originY,
      bodySourceWidth,
      bodySourceHeight,
      bodyOffsetX,
      bodyOffsetY,
      displayScale,
    } = getSpriteAnchor(animation.key, bodyW, bodyH, this.flipX);
    this.setOrigin(originX, originY);
    this.setScale(displayScale);
    this.body.setSize(bodySourceWidth, bodySourceHeight);
    this.body.setOffset(bodyOffsetX, bodyOffsetY);
  }
}
