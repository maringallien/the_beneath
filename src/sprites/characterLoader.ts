import Phaser from 'phaser';
import swordMasterRaw from './swordMaster.json';
import swordMasterMagicRaw from './swordMasterMagic.json';
import gunslingerGun1Raw from './gunslingerGun1.json';
import gunslingerGun2Raw from './gunslingerGun2.json';
import type {
  AnimationStage,
  CharacterModeId,
  CharacterModeRegistry,
  LogicalAnimationKey,
  ResolvedAnimation,
  SimpleAnimation,
} from './characterTypes';

const REGULAR_REGISTRY = swordMasterRaw as CharacterModeRegistry;
const MAGIC_REGISTRY = swordMasterMagicRaw as CharacterModeRegistry;
const GUN1_REGISTRY = gunslingerGun1Raw as CharacterModeRegistry;
const GUN2_REGISTRY = gunslingerGun2Raw as CharacterModeRegistry;

const REGISTRIES: ReadonlyArray<CharacterModeRegistry> = [
  REGULAR_REGISTRY,
  MAGIC_REGISTRY,
  GUN1_REGISTRY,
  GUN2_REGISTRY,
];

export const SWORD_MASTER_MODE: CharacterModeId = 'sword_master';
export const SWORD_MASTER_MAGIC_PREFIX = 'sword_master_magic';
export const DEFAULT_CHARACTER_FPS = 12;

// Wheel-cycled mode order. sword_master_magic is intentionally absent — it's
// a sub-stance of sword_master toggled by F.
export const MODE_ORDER: ReadonlyArray<CharacterModeId> = [
  'sword_master',
  'gunslinger_gun1',
  'gunslinger_gun2',
];

// Per-mode mapping of logical action keys to underlying registry animations.
// `null` = action disabled in this mode (gating in Player.ts must early-return).
// `pauseOnFrame` = freeze on a specific frame after play (turns a multi-frame
// anim into a static pose, e.g., gunslinger uses run frame 0 if idle missing).
type ModeResolverTable = Partial<
  Record<LogicalAnimationKey, ResolvedAnimation | null>
>;

const MODE_RESOLVERS: Record<CharacterModeId, ModeResolverTable> = {
  sword_master: {
    idle: { registryKey: 'idle' },
    walk: { registryKey: 'jog' },
    run: { registryKey: 'run' },
    sprint: { registryKey: 'sprint' },
    fall: { registryKey: 'fall1' },
    wall_slide: { registryKey: 'ledge_slide' },
    attack1: { registryKey: 'attack1' },
    attack2: { registryKey: 'attack2' },
    attack3: { registryKey: 'attack3' },
    attack4: { registryKey: 'attack4' },
    attack5: { registryKey: 'attack5' },
    attack6: { registryKey: 'attack6' },
    dash: { registryKey: 'dash' },
    roll: { registryKey: 'roll' },
    block: { registryKey: 'block' },
    ledge_climb: { registryKey: 'ledge_climb' },
    jump: null,
    death: { registryKey: 'death' },
    take_hit: { registryKey: 'take_hit' },
  },
  gunslinger_gun1: {
    idle: { registryKey: 'idle' },
    walk: { registryKey: 'run' },
    run: { registryKey: 'run' },
    sprint: { registryKey: 'run' },
    fall: { registryKey: 'fall' },
    wall_slide: { registryKey: 'fall' },
    attack1: { registryKey: 'attack1' },
    attack2: null,
    attack3: null,
    attack4: null,
    attack5: null,
    attack6: null,
    dash: null,
    roll: { registryKey: 'roll' },
    block: null,
    ledge_climb: null,
    jump: { registryKey: 'jump' },
    death: { registryKey: 'death' },
    take_hit: { registryKey: 'take_hit' },
  },
  gunslinger_gun2: {
    idle: { registryKey: 'idle' },
    walk: { registryKey: 'run' },
    run: { registryKey: 'run' },
    sprint: { registryKey: 'run' },
    fall: { registryKey: 'fall' },
    wall_slide: { registryKey: 'fall' },
    attack1: { registryKey: 'attack1' },
    attack2: null,
    attack3: null,
    attack4: null,
    attack5: null,
    attack6: null,
    dash: null,
    roll: { registryKey: 'roll' },
    block: null,
    ledge_climb: null,
    jump: { registryKey: 'jump' },
    death: { registryKey: 'death' },
    take_hit: { registryKey: 'take_hit' },
  },
};

// Magic attack chain (sub-stance of sword_master). Index = combo step.
// step 1 = roll-attack (magic 'attack1'); steps 2-5 follow the user's spec.
const MAGIC_ATTACK_KEY_BY_STEP: ReadonlyArray<string | null> = [
  null,
  'attack1',
  'attack3',
  'attack4',
  'attack2',
  'attack5',
];

function registryPrefix(registry: CharacterModeRegistry): string {
  return registry.mode ?? 'sword_master';
}

function fullKeyFor(registry: CharacterModeRegistry, localKey: string): string {
  return `${registryPrefix(registry)}_${localKey}`;
}

const animationByFullKey: ReadonlyMap<string, SimpleAnimation> = (() => {
  const map = new Map<string, SimpleAnimation>();
  for (const registry of REGISTRIES) {
    for (const anim of Object.values(registry.animations)) {
      map.set(fullKeyFor(registry, anim.key), anim);
    }
  }
  return map;
})();

export function animKey(
  mode: CharacterModeId,
  logical: LogicalAnimationKey,
): string | null {
  const resolved = MODE_RESOLVERS[mode][logical];
  if (!resolved) return null;
  return `${mode}_${resolved.registryKey}`;
}

export function isActionAvailable(
  mode: CharacterModeId,
  logical: LogicalAnimationKey,
): boolean {
  return MODE_RESOLVERS[mode][logical] != null;
}

export function magicAttackAnimKey(step: number): string {
  const localKey = MAGIC_ATTACK_KEY_BY_STEP[step];
  if (!localKey) {
    throw new Error(`No magic attack defined for step ${step}`);
  }
  return `${SWORD_MASTER_MAGIC_PREFIX}_${localKey}`;
}

// Convenience: build a Set of full anim keys for any animations matching
// a logical key across all modes. Used in Player.ts to identify attack/dash/
// roll/block/climb keys arriving at onAnimationComplete without per-mode
// branching.
export function fullKeysForLogical(
  logical: LogicalAnimationKey,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const mode of Object.keys(MODE_RESOLVERS) as CharacterModeId[]) {
    const key = animKey(mode, logical);
    if (key) keys.add(key);
  }
  return keys;
}

export function magicAttackKeySet(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const localKey of MAGIC_ATTACK_KEY_BY_STEP) {
    if (localKey) {
      keys.add(`${SWORD_MASTER_MAGIC_PREFIX}_${localKey}`);
    }
  }
  return keys;
}

export function preloadAllCharacters(scene: Phaser.Scene): void {
  for (const [fullKey, anim] of animationByFullKey) {
    scene.load.spritesheet(fullKey, `/${anim.file}`, {
      frameWidth: anim.frames.frameWidth,
      frameHeight: anim.frames.frameHeight,
    });
  }
}

export interface RegisterAnimationsOptions {
  defaultFps?: number;
}

export interface SpriteAnchor {
  originX: number;
  originY: number;
  bodyOffsetX: number;
  bodyOffsetY: number;
}

const DEFAULT_ANCHOR: SpriteAnchor = {
  originX: 0.5,
  originY: 0.5,
  bodyOffsetX: 0,
  bodyOffsetY: 0,
};

export function getAnimationStage(
  fullAnimKey: string,
  stageName: string,
): AnimationStage | undefined {
  return animationByFullKey.get(fullAnimKey)?.stages?.[stageName];
}

export function getSpriteAnchor(
  fullAnimKey: string,
  bodyWidth: number,
  bodyHeight: number,
  flipX: boolean = false,
): SpriteAnchor {
  const anim = animationByFullKey.get(fullAnimKey);
  if (!anim) {
    return DEFAULT_ANCHOR;
  }
  const { frameWidth, frameHeight, anchorX, anchorY } = anim.frames;
  const ax = anchorX ?? frameWidth / 2;
  const ay = anchorY ?? frameHeight;
  const effectiveAx = flipX ? frameWidth - ax : ax;
  return {
    originX: effectiveAx / frameWidth,
    originY: 0.5,
    bodyOffsetX: effectiveAx - bodyWidth / 2,
    bodyOffsetY: ay - bodyHeight,
  };
}

export function registerAllCharacterAnimations(
  scene: Phaser.Scene,
  options: RegisterAnimationsOptions = {},
): void {
  const fps = options.defaultFps ?? DEFAULT_CHARACTER_FPS;
  for (const [fullKey, anim] of animationByFullKey) {
    if (scene.anims.exists(fullKey)) continue;
    scene.anims.create({
      key: fullKey,
      frames: scene.anims.generateFrameNumbers(fullKey, {
        start: 0,
        end: anim.frames.frameCount - 1,
      }),
      frameRate: fps,
      repeat: anim.loops ? -1 : 0,
    });
  }
}

export type GunslingerProjectileMode = 'gunslinger_gun1' | 'gunslinger_gun2';
export type ProjectileAnimKind = 'idle' | 'explode';

export function projectileAnimKey(
  mode: GunslingerProjectileMode,
  kind: ProjectileAnimKind,
): string {
  return `${mode}_projectile_${kind}`;
}
