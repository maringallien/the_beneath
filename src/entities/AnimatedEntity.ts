import Phaser from 'phaser';
import { ENTITY_DEPTH } from '../constants';
import { getSpriteAnchor } from '../sprites/characterLoader';
import {
  entityAnimFullKey,
  getEntityRegistryEntry,
} from './entityRegistryLoader';
import type { AnimatedEntityConfig } from './entityRegistryTypes';

/**
 * AnimatedEntity — the registry-driven base sprite for every animated entity.
 *
 * Turns "this LDtk identifier is animated" into "a Phaser sprite running an
 * animation" by reading the entityRegistry JSON, so per-entity behavior lives
 * in data instead of N hand-written subclasses. The baseline just plays an
 * animation in place at the LDtk-placed position (no input, combat, or overlays
 * of its own); Door, Enemy, and friends subclass it for behavior. Owns the
 * anchor-and-body wiring — on every ANIMATION_START it re-derives origin, scale,
 * and physics-body size/offset from the sprite's per-anim anchor, the invariant
 * that keeps the body aligned to the art across anim swaps and facing flips.
 *
 * Inputs:  scene, spawn x/y, an LDtk identifier resolved against the registry
 *          (config: animations, physicsBody, gravity, defaultAnimation).
 * Outputs: a depth-sorted animated sprite with a correctly anchored body.
 * @calledby the entity factory at level load, and subclass constructors via super.
 * @calls    the entity-registry lookup, the per-anim sprite-anchor resolver, and
 *           Phaser's animation/physics systems.
 */
export class AnimatedEntity extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  private readonly identifier: string;
  protected readonly config: AnimatedEntityConfig;

  // looks up the registry entry, sets up physics/animation, and starts the default anim at a random phase
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

  // plays a logical (un-namespaced) anim key; returns false and no-ops if absent
  playLogical(animKey: string): boolean {
    if (!(animKey in this.config.animations)) return false;
    const fullKey = entityAnimFullKey(this.identifier, animKey);
    this.play(fullKey);
    return true;
  }

  // This entity's LDtk identifier (its registry key).
  getIdentifier(): string {
    return this.identifier;
  }

  // flips the sprite and re-applies the body anchor so it stays correct after a facing change
  setFacing(faceLeft: boolean): void {
    if (this.flipX === faceLeft) return;
    this.setFlipX(faceLeft);
    const currentAnim = this.anims.currentAnim;
    if (currentAnim) {
      this.applyAnimationAnchor(currentAnim);
    }
  }

  // re-derives origin, scale, and body offset from the new anim's anchor data — must run on every anim swap and flip
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
