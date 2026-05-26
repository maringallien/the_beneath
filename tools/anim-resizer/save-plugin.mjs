import { readFile, writeFile } from 'node:fs/promises';
import { resolve as pathResolve, join as pathJoin } from 'node:path';

// Allow-list of registry → on-disk JSON file (path relative to project
// root). Path traversal is impossible because the registry parameter is
// checked against this map's keys before any filesystem access; the file
// path is constructed, not received.
const REGISTRY_FILES = {
  swordMaster: 'src/sprites/swordMaster.json',
  swordMasterMagic: 'src/sprites/swordMasterMagic.json',
  gunslingerBody: 'src/sprites/gunslingerBody.json',
  gunslingerGun1: 'src/sprites/gunslingerGun1.json',
  gunslingerGun2: 'src/sprites/gunslingerGun2.json',
  gun1Overlay: 'src/sprites/gun1Overlay.json',
  gun2Overlay: 'src/sprites/gun2Overlay.json',
  // Shared file holding every animated-entity LDtk identifier. The save
  // request must include `identifier` so the merge addresses the right
  // entry inside the file.
  entityRegistry: 'src/entities/entityRegistry.json',
};

// Permitted base directories for any resolved REGISTRY_FILES path. Any
// resolved file path must start with one of these after normalization;
// this is the belt-and-suspenders defense against path traversal.
const ALLOWED_BASE_DIRS = ['src/sprites', 'src/entities'];
const ENDPOINT = '/__anim-resizer/save';

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolveBody(Buffer.concat(chunks).toString('utf8'));
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on('error', rejectBody);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Validates the request payload. Returns { ok: true, payload } or
// { ok: false, message }. Strict — rejects unknown keys to prevent silent
// drift between the tool's edit shape and what gets persisted on disk.
// `identifier` is required when registry === 'entityRegistry' so the merge
// knows which LDtk identifier inside the shared file to update; it must
// be absent for every other registry.
function validate(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'Body must be a JSON object.' };
  }
  const { registry, animations, identifier, physicsBody, attackHitboxes, newAttacks } = raw;
  if (typeof registry !== 'string') {
    return { ok: false, message: 'registry must be a string.' };
  }
  if (!Object.prototype.hasOwnProperty.call(REGISTRY_FILES, registry)) {
    return { ok: false, message: `Unknown registry "${registry}".` };
  }
  if (registry === 'entityRegistry') {
    if (typeof identifier !== 'string' || identifier.length === 0) {
      return {
        ok: false,
        message: 'entityRegistry saves require a non-empty `identifier`.',
      };
    }
    // The LDtk identifier is used as a JSON property name lookup against
    // pre-existing keys in the shared file — never written as a new key —
    // so injection is structurally impossible. The format check below is
    // defense in depth against malformed clients.
    if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
      return {
        ok: false,
        message: 'identifier must match /^[A-Za-z0-9_]+$/.',
      };
    }
  } else if (identifier !== undefined) {
    return {
      ok: false,
      message: '`identifier` is only allowed for the entityRegistry save.',
    };
  }
  if (!animations || typeof animations !== 'object') {
    return { ok: false, message: 'animations must be an object.' };
  }
  for (const [animKey, edit] of Object.entries(animations)) {
    if (!edit || typeof edit !== 'object') {
      return { ok: false, message: `Edit for "${animKey}" must be an object.` };
    }
    for (const key of Object.keys(edit)) {
      if (key !== 'displayScale' && key !== 'anchorX' && key !== 'anchorY') {
        return { ok: false, message: `Unexpected field "${key}" on "${animKey}".` };
      }
    }
    if (edit.displayScale !== undefined) {
      if (!isFiniteNumber(edit.displayScale) || edit.displayScale <= 0) {
        return { ok: false, message: `displayScale on "${animKey}" must be > 0.` };
      }
    }
    if (edit.anchorX !== undefined) {
      if (!Number.isInteger(edit.anchorX) || edit.anchorX < 0) {
        return { ok: false, message: `anchorX on "${animKey}" must be a non-negative integer.` };
      }
    }
    if (edit.anchorY !== undefined) {
      if (!Number.isInteger(edit.anchorY) || edit.anchorY < 0) {
        return { ok: false, message: `anchorY on "${animKey}" must be a non-negative integer.` };
      }
    }
  }
  // physicsBody is optional and only valid on entityRegistry saves. Each
  // field must be a positive integer; unknown keys are rejected.
  if (physicsBody !== undefined) {
    if (registry !== 'entityRegistry') {
      return {
        ok: false,
        message: '`physicsBody` is only allowed for the entityRegistry save.',
      };
    }
    if (!physicsBody || typeof physicsBody !== 'object') {
      return { ok: false, message: 'physicsBody must be an object.' };
    }
    for (const key of Object.keys(physicsBody)) {
      if (key !== 'width' && key !== 'height') {
        return { ok: false, message: `Unexpected physicsBody field "${key}".` };
      }
    }
    if (physicsBody.width !== undefined) {
      if (!Number.isInteger(physicsBody.width) || physicsBody.width <= 0) {
        return { ok: false, message: 'physicsBody.width must be a positive integer.' };
      }
    }
    if (physicsBody.height !== undefined) {
      if (!Number.isInteger(physicsBody.height) || physicsBody.height <= 0) {
        return { ok: false, message: 'physicsBody.height must be a positive integer.' };
      }
    }
  }
  // attackHitboxes is an optional list of per-hitbox patches, entity-only.
  // Each entry: { attackIndex: integer, hitboxIndex: integer ≥ 0,
  //               patch: { offsetX?, offsetY?, width?, height?,
  //                        frame?, create?, delete? } }.
  // Strict: unknown keys rejected, width/height must be ≥ 1.
  // `create` and `delete` are mutually exclusive. `create` requires `frame`.
  if (attackHitboxes !== undefined) {
    if (registry !== 'entityRegistry') {
      return {
        ok: false,
        message: '`attackHitboxes` is only allowed for the entityRegistry save.',
      };
    }
    if (!Array.isArray(attackHitboxes)) {
      return { ok: false, message: '`attackHitboxes` must be an array.' };
    }
    for (let i = 0; i < attackHitboxes.length; i++) {
      const entry = attackHitboxes[i];
      if (!entry || typeof entry !== 'object') {
        return { ok: false, message: `attackHitboxes[${i}] must be an object.` };
      }
      for (const key of Object.keys(entry)) {
        if (key !== 'attackIndex' && key !== 'hitboxIndex' && key !== 'patch') {
          return { ok: false, message: `Unexpected field "${key}" on attackHitboxes[${i}].` };
        }
      }
      if (!Number.isInteger(entry.attackIndex) || entry.attackIndex < -1) {
        return {
          ok: false,
          message: `attackHitboxes[${i}].attackIndex must be an integer ≥ -1.`,
        };
      }
      if (!Number.isInteger(entry.hitboxIndex) || entry.hitboxIndex < 0) {
        return {
          ok: false,
          message: `attackHitboxes[${i}].hitboxIndex must be a non-negative integer.`,
        };
      }
      const patch = entry.patch;
      if (!patch || typeof patch !== 'object') {
        return { ok: false, message: `attackHitboxes[${i}].patch must be an object.` };
      }
      for (const key of Object.keys(patch)) {
        if (
          key !== 'offsetX' &&
          key !== 'offsetY' &&
          key !== 'width' &&
          key !== 'height' &&
          key !== 'frame' &&
          key !== 'create' &&
          key !== 'delete'
        ) {
          return {
            ok: false,
            message: `Unexpected field "${key}" on attackHitboxes[${i}].patch.`,
          };
        }
      }
      if (patch.create && patch.delete) {
        return {
          ok: false,
          message: `attackHitboxes[${i}].patch: create and delete are mutually exclusive.`,
        };
      }
      if (patch.create !== undefined && typeof patch.create !== 'boolean') {
        return { ok: false, message: `attackHitboxes[${i}].patch.create must be a boolean.` };
      }
      if (patch.delete !== undefined && typeof patch.delete !== 'boolean') {
        return { ok: false, message: `attackHitboxes[${i}].patch.delete must be a boolean.` };
      }
      if (patch.create && !Number.isInteger(patch.frame)) {
        return {
          ok: false,
          message: `attackHitboxes[${i}].patch.frame is required (integer) when create=true.`,
        };
      }
      if (patch.frame !== undefined && (!Number.isInteger(patch.frame) || patch.frame < 0)) {
        return { ok: false, message: `attackHitboxes[${i}].patch.frame must be a non-negative integer.` };
      }
      if (patch.offsetX !== undefined && !Number.isInteger(patch.offsetX)) {
        return { ok: false, message: `attackHitboxes[${i}].patch.offsetX must be an integer.` };
      }
      if (patch.offsetY !== undefined && !Number.isInteger(patch.offsetY)) {
        return { ok: false, message: `attackHitboxes[${i}].patch.offsetY must be an integer.` };
      }
      if (patch.width !== undefined && (!Number.isInteger(patch.width) || patch.width < 1)) {
        return {
          ok: false,
          message: `attackHitboxes[${i}].patch.width must be a positive integer.`,
        };
      }
      if (patch.height !== undefined && (!Number.isInteger(patch.height) || patch.height < 1)) {
        return {
          ok: false,
          message: `attackHitboxes[${i}].patch.height must be a positive integer.`,
        };
      }
    }
  }
  // newAttacks: entity-only. Each entry is a brand-new melee attack to
  // append to behavior.attackPool with server-side defaults.
  if (newAttacks !== undefined) {
    if (registry !== 'entityRegistry') {
      return {
        ok: false,
        message: '`newAttacks` is only allowed for the entityRegistry save.',
      };
    }
    if (!Array.isArray(newAttacks)) {
      return { ok: false, message: '`newAttacks` must be an array.' };
    }
    for (let i = 0; i < newAttacks.length; i++) {
      const entry = newAttacks[i];
      if (!entry || typeof entry !== 'object') {
        return { ok: false, message: `newAttacks[${i}] must be an object.` };
      }
      for (const key of Object.keys(entry)) {
        if (key !== 'animation' && key !== 'frame' && key !== 'hitbox') {
          return { ok: false, message: `Unexpected field "${key}" on newAttacks[${i}].` };
        }
      }
      if (typeof entry.animation !== 'string' || entry.animation.length === 0) {
        return { ok: false, message: `newAttacks[${i}].animation must be a non-empty string.` };
      }
      if (!Number.isInteger(entry.frame) || entry.frame < 0) {
        return { ok: false, message: `newAttacks[${i}].frame must be a non-negative integer.` };
      }
      if (!entry.hitbox || typeof entry.hitbox !== 'object') {
        return { ok: false, message: `newAttacks[${i}].hitbox must be an object.` };
      }
      for (const key of Object.keys(entry.hitbox)) {
        if (key !== 'offsetX' && key !== 'offsetY' && key !== 'width' && key !== 'height') {
          return {
            ok: false,
            message: `Unexpected field "${key}" on newAttacks[${i}].hitbox.`,
          };
        }
      }
      if (!Number.isInteger(entry.hitbox.offsetX) || !Number.isInteger(entry.hitbox.offsetY)) {
        return {
          ok: false,
          message: `newAttacks[${i}].hitbox.offsetX/offsetY must be integers.`,
        };
      }
      if (!Number.isInteger(entry.hitbox.width) || entry.hitbox.width < 1) {
        return { ok: false, message: `newAttacks[${i}].hitbox.width must be a positive integer.` };
      }
      if (!Number.isInteger(entry.hitbox.height) || entry.hitbox.height < 1) {
        return { ok: false, message: `newAttacks[${i}].hitbox.height must be a positive integer.` };
      }
    }
  }
  return {
    ok: true,
    payload: {
      registry,
      animations,
      ...(identifier !== undefined ? { identifier } : {}),
      ...(physicsBody !== undefined ? { physicsBody } : {}),
      ...(attackHitboxes !== undefined ? { attackHitboxes } : {}),
      ...(newAttacks !== undefined ? { newAttacks } : {}),
    },
  };
}

// Deep-merges ONLY the displayScale/anchorX/anchorY fields into each
// animation's `frames` block. Every other field on the animation object is
// preserved as-is, so stages, originalName, etc. survive untouched.
// Used for the per-character player registries where the top-level object
// IS the registry: { animations: {[animKey]: { frames: {...}, ... }} }.
function applyPlayerRegistryEdits(original, edits) {
  const out = { ...original, animations: { ...original.animations } };
  for (const [animKey, edit] of Object.entries(edits)) {
    const existing = original.animations?.[animKey];
    if (!existing) {
      throw new Error(`Animation "${animKey}" not found in registry.`);
    }
    const nextFrames = { ...existing.frames };
    if (edit.displayScale !== undefined) nextFrames.displayScale = edit.displayScale;
    if (edit.anchorX !== undefined) nextFrames.anchorX = edit.anchorX;
    if (edit.anchorY !== undefined) nextFrames.anchorY = edit.anchorY;
    out.animations[animKey] = { ...existing, frames: nextFrames };
  }
  return out;
}

// Entity registry shape: top-level object is a map of LDtk identifier →
// AnimatedEntityConfig, where each anim entry has frame fields directly on
// it (no nested `frames` wrapper). Edits address out[identifier].animations
// [animKey].{displayScale,anchorX,anchorY}.
function applyEntityRegistryEdits(original, identifier, edits, physicsBody, attackHitboxes, newAttacks) {
  const entry = original[identifier];
  if (!entry || typeof entry !== 'object') {
    throw new Error(
      `Identifier "${identifier}" not found in entityRegistry.json.`,
    );
  }
  if (!entry.animations || typeof entry.animations !== 'object') {
    throw new Error(
      `Identifier "${identifier}" has no animations to edit.`,
    );
  }
  const nextAnimations = { ...entry.animations };
  for (const [animKey, edit] of Object.entries(edits)) {
    const existing = entry.animations[animKey];
    if (!existing) {
      throw new Error(
        `Animation "${animKey}" not found on identifier "${identifier}".`,
      );
    }
    const next = { ...existing };
    if (edit.displayScale !== undefined) next.displayScale = edit.displayScale;
    if (edit.anchorX !== undefined) next.anchorX = edit.anchorX;
    if (edit.anchorY !== undefined) next.anchorY = edit.anchorY;
    nextAnimations[animKey] = next;
  }
  let nextPhysicsBody = entry.physicsBody;
  if (physicsBody) {
    if (!nextPhysicsBody || typeof nextPhysicsBody !== 'object') {
      throw new Error(
        `Identifier "${identifier}" has no physicsBody to edit.`,
      );
    }
    nextPhysicsBody = { ...nextPhysicsBody };
    if (physicsBody.width !== undefined) nextPhysicsBody.width = physicsBody.width;
    if (physicsBody.height !== undefined) nextPhysicsBody.height = physicsBody.height;
  }
  let nextBehavior = entry.behavior;
  if (attackHitboxes && attackHitboxes.length > 0) {
    nextBehavior = applyAttackHitboxEdits(identifier, entry.behavior, attackHitboxes);
  }
  if (newAttacks && newAttacks.length > 0) {
    nextBehavior = appendNewAttacks(identifier, nextBehavior, newAttacks, entry.animations);
  }
  return {
    ...original,
    [identifier]: {
      ...entry,
      ...(nextPhysicsBody !== undefined ? { physicsBody: nextPhysicsBody } : {}),
      ...(nextBehavior !== undefined ? { behavior: nextBehavior } : {}),
      animations: nextAnimations,
    },
  };
}

// Appends each newAttack entry to behavior.attackPool, promoting the single
// `attack` shorthand to an array if needed. Refuses if the entity has no
// behavior block (the user would also need to author health, etc., which
// we don't synthesize here).
function appendNewAttacks(identifier, behavior, newAttacks, animations) {
  if (!behavior || typeof behavior !== 'object') {
    throw new Error(
      `Identifier "${identifier}" has no behavior block — cannot attach a new attack. ` +
        `Add a "behavior" stanza (with health, hurtAnimation, etc.) to entityRegistry.json first.`,
    );
  }
  let nextBehavior = { ...behavior };
  // Promote shorthand → array so we can append.
  if (
    nextBehavior.attack !== undefined &&
    !Array.isArray(nextBehavior.attackPool)
  ) {
    nextBehavior.attackPool = [nextBehavior.attack];
    delete nextBehavior.attack;
  } else if (!Array.isArray(nextBehavior.attackPool)) {
    nextBehavior.attackPool = [];
  }
  const pool = nextBehavior.attackPool.slice();
  for (const entry of newAttacks) {
    // Validate the animation key exists on the entity and the frame is in
    // range. Mirrors the registry parser's checks so the saved JSON
    // re-validates at next boot.
    if (!animations || typeof animations !== 'object' || !animations[entry.animation]) {
      throw new Error(
        `Identifier "${identifier}".animations["${entry.animation}"] not found — cannot create a new attack on a missing animation.`,
      );
    }
    const anim = animations[entry.animation];
    if (typeof anim.frameCount !== 'number' || entry.frame >= anim.frameCount) {
      throw new Error(
        `Identifier "${identifier}" new attack: frame ${entry.frame} out of range for "${entry.animation}" (frameCount=${anim.frameCount}).`,
      );
    }
    // Refuse to create a new attack on a looping animation — the registry
    // parser will reject the saved JSON otherwise (melee attacks must be
    // one-shot so the entity returns to recover state).
    if (anim.loops !== false) {
      throw new Error(
        `Identifier "${identifier}" new attack: animation "${entry.animation}" must have "loops": false ` +
          `for a melee attack (one-shot is required so the entity returns to recover state).`,
      );
    }
    pool.push({
      type: 'melee',
      animation: entry.animation,
      frame: entry.frame,
      damage: 10,
      range: 60,
      cooldownMs: 2000,
      aggressive: true,
      hitbox: {
        offsetX: entry.hitbox.offsetX,
        offsetY: entry.hitbox.offsetY,
        width: entry.hitbox.width,
        height: entry.hitbox.height,
      },
    });
  }
  nextBehavior.attackPool = pool;
  return nextBehavior;
}

// Merges per-hitbox patches into the behavior block. Preserves the original
// `hitbox` (singular) vs `hitboxes` (array) form — never silently promotes
// or demotes between the two for normal edits.
//
// attackIndex semantics:
//   -1 → behavior.attack (single-attack entities)
//   >= 0 → behavior.attackPool[attackIndex]
function applyAttackHitboxEdits(identifier, behavior, patches) {
  if (!behavior || typeof behavior !== 'object') {
    throw new Error(`Identifier "${identifier}" has no behavior to edit.`);
  }
  const nextBehavior = { ...behavior };
  // Group patches by attackIndex so each attack object is rebuilt at most
  // once; mutations within a single attack run in patch-arrival order.
  const byAttackIndex = new Map();
  for (const entry of patches) {
    let list = byAttackIndex.get(entry.attackIndex);
    if (!list) {
      list = [];
      byAttackIndex.set(entry.attackIndex, list);
    }
    list.push(entry);
  }
  for (const [attackIndex, entries] of byAttackIndex) {
    if (attackIndex === -1) {
      if (!nextBehavior.attack || typeof nextBehavior.attack !== 'object') {
        throw new Error(
          `Identifier "${identifier}".behavior.attack not found; attackIndex=-1 invalid.`,
        );
      }
      nextBehavior.attack = applyHitboxEntriesToAttack(
        `${identifier}.behavior.attack`,
        nextBehavior.attack,
        entries,
      );
    } else {
      if (!Array.isArray(nextBehavior.attackPool) || !nextBehavior.attackPool[attackIndex]) {
        throw new Error(
          `Identifier "${identifier}".behavior.attackPool[${attackIndex}] not found.`,
        );
      }
      const nextPool = nextBehavior.attackPool.slice();
      nextPool[attackIndex] = applyHitboxEntriesToAttack(
        `${identifier}.behavior.attackPool[${attackIndex}]`,
        nextPool[attackIndex],
        entries,
      );
      nextBehavior.attackPool = nextPool;
    }
  }
  return nextBehavior;
}

function applyHitboxEntriesToAttack(ctx, attack, entries) {
  const wasSingular = attack.hitbox !== undefined && attack.hitboxes === undefined;
  // Normalize to an array regardless of authored form so the merge logic
  // is uniform. We'll restore the singular form at the end if appropriate.
  // Attacks may originally have neither field if they're being seeded with
  // their very first create — start with empty in that case.
  let arr;
  if (Array.isArray(attack.hitboxes)) {
    arr = attack.hitboxes.slice();
  } else if (attack.hitbox && typeof attack.hitbox === 'object') {
    arr = [attack.hitbox];
  } else {
    arr = [];
  }
  // Process order: patches first (so they apply to the *original* indices
  // the client sent), then deletes (descending — no shift between them and
  // no shift to patch indices since patches already ran), then creates
  // (appended in arrival order). This lets the client freely delete any
  // hitbox without invalidating other pending patches on the same attack.
  const deletes = [];
  const patches = [];
  const creates = [];
  for (const entry of entries) {
    if (entry.patch.delete) deletes.push(entry);
    else if (entry.patch.create) creates.push(entry);
    else patches.push(entry);
  }
  for (const entry of patches) {
    const idx = entry.hitboxIndex;
    if (idx < 0 || idx >= arr.length) {
      throw new Error(
        `${ctx} patch: hitboxIndex ${idx} out of range (have ${arr.length} hitbox(es)).`,
      );
    }
    const existing = arr[idx];
    if (!existing || typeof existing !== 'object') {
      throw new Error(`${ctx} hitbox at index ${idx} is not an object.`);
    }
    const patch = entry.patch;
    const merged = { ...existing };
    if (patch.offsetX !== undefined) merged.offsetX = patch.offsetX;
    if (patch.offsetY !== undefined) merged.offsetY = patch.offsetY;
    if (patch.width !== undefined) merged.width = patch.width;
    if (patch.height !== undefined) merged.height = patch.height;
    if (patch.frame !== undefined) merged.frame = patch.frame;
    arr[idx] = merged;
  }
  deletes.sort((a, b) => b.hitboxIndex - a.hitboxIndex);
  for (const entry of deletes) {
    if (entry.hitboxIndex < 0 || entry.hitboxIndex >= arr.length) {
      throw new Error(
        `${ctx} delete: hitboxIndex ${entry.hitboxIndex} out of range (have ${arr.length} hitbox(es)).`,
      );
    }
    arr.splice(entry.hitboxIndex, 1);
  }
  // Creates always appended in arrival order. The hitboxIndex on the patch
  // is informational (client uses it as a stable key); the server appends
  // at the end regardless. Default geometry comes from the patch — validate
  // we have all four fields plus a frame (required when create=true).
  for (const entry of creates) {
    const p = entry.patch;
    const newHitbox = {
      offsetX: p.offsetX ?? 0,
      offsetY: p.offsetY ?? 0,
      width: p.width ?? 30,
      height: p.height ?? 20,
      frame: p.frame,
    };
    arr.push(newHitbox);
  }

  const next = { ...attack };
  if (arr.length === 0) {
    // Empty hitbox array would fail the registry's parser — guard against it.
    throw new Error(
      `${ctx} would have zero hitboxes after merge — refusing to save (the registry parser requires at least one hitbox on melee/teleport attacks).`,
    );
  }
  if (wasSingular && arr.length === 1) {
    next.hitbox = arr[0];
    delete next.hitboxes;
  } else {
    next.hitboxes = arr;
    delete next.hitbox;
  }
  return next;
}

export function animResizerSavePlugin() {
  return {
    name: 'anim-resizer-save',
    // Conditional registration: the dev server only — never in production
    // builds. Avoids any chance of shipping a write endpoint with the game.
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use(ENDPOINT, async (req, res) => {
        if (req.method !== 'POST') {
          send(res, 405, { error: 'Method not allowed' });
          return;
        }
        let payload;
        try {
          const body = await readRequestBody(req);
          payload = JSON.parse(body);
        } catch (err) {
          send(res, 400, { error: 'Invalid JSON', detail: String(err) });
          return;
        }
        const validation = validate(payload);
        if (!validation.ok) {
          send(res, 400, { error: validation.message });
          return;
        }
        const { registry, animations, identifier, physicsBody, attackHitboxes, newAttacks } = validation.payload;
        const relPath = REGISTRY_FILES[registry];
        const filePath = pathResolve(pathJoin(root, relPath));
        // Belt + suspenders: confirm the resolved path lives under one of
        // the allow-listed base directories after normalization.
        const inAllowedDir = ALLOWED_BASE_DIRS.some((baseDir) =>
          filePath.startsWith(pathResolve(pathJoin(root, baseDir))),
        );
        if (!inAllowedDir) {
          send(res, 400, {
            error: 'Resolved path escapes allowed save directories.',
          });
          return;
        }
        try {
          const raw = await readFile(filePath, 'utf8');
          const original = JSON.parse(raw);
          const merged =
            registry === 'entityRegistry'
              ? applyEntityRegistryEdits(original, identifier, animations, physicsBody, attackHitboxes, newAttacks)
              : applyPlayerRegistryEdits(original, animations);
          await writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
          send(res, 200, {
            ok: true,
            registry,
            ...(identifier !== undefined ? { identifier } : {}),
            count: Object.keys(animations).length,
            ...(attackHitboxes !== undefined ? { hitboxCount: attackHitboxes.length } : {}),
            ...(newAttacks !== undefined ? { newAttackCount: newAttacks.length } : {}),
          });
        } catch (err) {
          send(res, 500, { error: 'Save failed', detail: String(err) });
        }
      });
    },
  };
}
