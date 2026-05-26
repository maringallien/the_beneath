import {
  entityAnimFullKey,
  listEntityRegistryEntries,
} from '../../src/entities/entityRegistryLoader';
import type {
  AnimatedEntityAttackConfig,
  AnimatedEntityHitboxConfig,
} from '../../src/entities/entityRegistryTypes';

// One hitbox within an attack, normalized so consumers don't have to keep
// re-resolving "did the author write `hitbox` singular or `hitboxes`?" and
// "does this hitbox override the attack's default frame?". `frame` is the
// fully-resolved damage frame (per-hitbox override else attack.frame else 0
// — though valid configs always have attack.frame on melee/teleport).
export interface NormalizedHitbox {
  readonly hitboxIndex: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly matchBody: boolean;
}

// One attack on one entity that can carry hitboxes (melee or teleport). One
// AttackBinding per (identifier, attackIndex). attackIndex = -1 means the
// single-attack `behavior.attack` shorthand; attackIndex >= 0 means
// `behavior.attackPool[attackIndex]`.
export interface AttackBinding {
  readonly identifier: string;
  readonly attackIndex: number;
  readonly attack: AnimatedEntityAttackConfig;
  readonly hitboxes: ReadonlyArray<NormalizedHitbox>;
}

// `entityAnimFullKey(identifier, animation)` → bindings that use that
// animation as their strike clip. Multiple bindings can share an animation
// (rare, but possible if two attacks on the same entity reuse the same clip).
export type AttackBindingsMap = ReadonlyMap<string, ReadonlyArray<AttackBinding>>;

// Collects every distinct frame index across all hitboxes bound to the
// given animation. Used by the frame strip to highlight which frames carry
// damage, so the user can scrub straight to them.
export function hitboxFramesForAnimation(
  bindings: AttackBindingsMap,
  fullKey: string,
): ReadonlyArray<number> {
  const list = bindings.get(fullKey);
  if (!list) return [];
  const out = new Set<number>();
  for (const binding of list) {
    for (const hb of binding.hitboxes) {
      out.add(hb.frame);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function normalizeHitboxes(
  attack: AnimatedEntityAttackConfig,
): ReadonlyArray<NormalizedHitbox> {
  const defaultFrame = attack.frame ?? 0;
  if (!attack.hitboxes || attack.hitboxes.length === 0) return [];
  return attack.hitboxes.map((hb, index) => normalize(hb, index, defaultFrame));
}

function normalize(
  hb: AnimatedEntityHitboxConfig,
  hitboxIndex: number,
  defaultFrame: number,
): NormalizedHitbox {
  return {
    hitboxIndex,
    offsetX: hb.offsetX,
    offsetY: hb.offsetY,
    width: hb.width,
    height: hb.height,
    frame: hb.frame ?? defaultFrame,
    matchBody: hb.matchBody === true,
  };
}

// Only melee and teleport carry editable rect hitboxes. AoE uses
// damageHalfWidth/Height stamped at the player's snapshotted position; that
// geometry is conceptually different and not edited here. Contact/dive/heal
// have no rect at all.
function attackCarriesHitboxes(attack: AnimatedEntityAttackConfig): boolean {
  return attack.type === 'melee' || attack.type === 'teleport';
}

export function buildAttackBindings(): AttackBindingsMap {
  const map = new Map<string, AttackBinding[]>();
  const push = (fullKey: string, binding: AttackBinding) => {
    const list = map.get(fullKey);
    if (list) list.push(binding);
    else map.set(fullKey, [binding]);
  };
  for (const { identifier, config } of listEntityRegistryEntries()) {
    const behavior = config.behavior;
    if (!behavior) continue;
    if (behavior.attack && attackCarriesHitboxes(behavior.attack)) {
      const animation = behavior.attack.animation;
      if (animation) {
        push(entityAnimFullKey(identifier, animation), {
          identifier,
          attackIndex: -1,
          attack: behavior.attack,
          hitboxes: normalizeHitboxes(behavior.attack),
        });
      }
    }
    if (behavior.attackPool) {
      for (let i = 0; i < behavior.attackPool.length; i++) {
        const attack = behavior.attackPool[i];
        if (!attackCarriesHitboxes(attack)) continue;
        const animation = attack.animation;
        if (!animation) continue;
        push(entityAnimFullKey(identifier, animation), {
          identifier,
          attackIndex: i,
          attack,
          hitboxes: normalizeHitboxes(attack),
        });
      }
    }
  }
  return map;
}
