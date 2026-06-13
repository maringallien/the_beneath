// Derives the bestiary from the live entityRegistry.json so the manual's enemy /
// boss / trap tables never drift from gameplay. Pure data: the generator decides
// presentation and merges in curated location/role notes from content.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// src/constants/enemies.ts — global non-boss HP scaler. Bosses are exempt.
export const ENEMY_HEALTH_MULTIPLIER = 1.5;

export function loadRegistry() {
  const path = resolve(__dirname, '../../src/entities/entityRegistry.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function prettyName(id) {
  return id
    .replace(/_spawn$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\w)(\d)$/, '$1 $2'); // "Spirit Walker1" -> "Spirit Walker 1"
}

function attackList(behavior) {
  const atks = [];
  if (behavior.attack) atks.push(behavior.attack);
  if (Array.isArray(behavior.attackPool)) atks.push(...behavior.attackPool);
  return atks;
}

function effectiveHp(behavior) {
  return behavior.isBoss
    ? behavior.health
    : Math.round(behavior.health * ENEMY_HEALTH_MULTIPLIER);
}

// Compact damage string across all of an entity's attacks, e.g. "10", "8–12",
// "10 (ranged)", or "—" for a passive. Type label reflects the primary mode.
function damageSummary(behavior) {
  const atks = attackList(behavior);
  const dmgs = atks.map((a) => a.damage).filter((d) => typeof d === 'number');
  if (atks.length === 0) return { value: '—', kinds: 'Passive' };
  const kinds = [...new Set(atks.map((a) => a.type))];
  let value = '—';
  if (dmgs.length > 0) {
    const lo = Math.min(...dmgs);
    const hi = Math.max(...dmgs);
    value = lo === hi ? `${lo}` : `${lo}–${hi}`;
  }
  const label = kinds
    .map((k) => ({ melee: 'Melee', ranged: 'Ranged', magic: 'Magic', contact: 'Contact', dive: 'Dive', aoe: 'AoE', teleport: 'Teleport', summon: 'Summon', heal: 'Heal' }[k] ?? k))
    .join(' / ');
  return { value, kinds: label };
}

function dropsSummary(cfg) {
  if (!Array.isArray(cfg.drops) || cfg.drops.length === 0) return '—';
  let coins = 0;
  const others = [];
  for (const ev of cfg.drops) {
    const onlyCoin = ev.kinds.length === 1 && ev.kinds[0].kind === 'coin';
    if (onlyCoin && ev.chancePct === 100) {
      coins += 1;
      continue;
    }
    const label = ev.kinds.map((k) => k.kind).join('/');
    others.push(`${label} ${ev.chancePct}%`);
  }
  const parts = [];
  if (coins > 0) parts.push(`${coins} coin${coins > 1 ? 's' : ''}`);
  parts.push(...others);
  return parts.join(', ');
}

function flags(behavior, cfg) {
  const f = [];
  if (behavior.dormant) f.push('Dormant until it sees you');
  if (behavior.ignoresStealth) f.push('Ignores stealth (always aggressive)');
  if (behavior.immovable) f.push('Immovable');
  if (behavior.summon || attackList(behavior).some((a) => a.type === 'summon')) {
    const s = attackList(behavior).find((a) => a.type === 'summon');
    if (s) f.push(`Summons ${(s.summonKinds ?? []).map(prettyName).join(' / ')} (${s.summonCount}/cast, ${s.summonMaxAlive ?? '∞'} max)`);
  }
  if (attackList(behavior).some((a) => a.type === 'heal')) f.push('Heals itself when wounded');
  if (behavior.deathExplosion) f.push(`Explodes on death (${behavior.deathExplosion.damage} dmg, ${behavior.deathExplosion.radius}px)`);
  return f;
}

// Returns { bosses, enemies, passives, traps, chests } — each an array of rows.
export function categorize() {
  const registry = loadRegistry();
  const bosses = [];
  const enemies = [];
  const passives = [];
  const traps = [];
  const chests = [];

  for (const [id, cfg] of Object.entries(registry)) {
    const b = cfg.behavior;
    if (b) {
      const dmg = damageSummary(b);
      const atks = attackList(b);
      const row = {
        id,
        name: b.displayName ?? prettyName(id),
        rawName: prettyName(id),
        hp: effectiveHp(b),
        hpAuthored: b.health,
        isBoss: !!b.isBoss,
        roundFight: !!b.roundFight,
        damage: dmg.value,
        damageType: dmg.kinds,
        attackCount: atks.length,
        drops: dropsSummary(cfg),
        flags: flags(b, cfg),
        moveSpeed: b.moveSpeed,
      };
      if (b.isBoss) bosses.push(row);
      else if (atks.length === 0) passives.push(row);
      else enemies.push(row);
    } else if (cfg.trap) {
      traps.push({ id, name: prettyName(id), damage: cfg.trap.damage });
    } else if (Array.isArray(cfg.drops) && cfg.drops.length > 0) {
      chests.push({ id, name: prettyName(id), drops: dropsSummary(cfg) });
    }
  }

  bosses.sort((a, b) => b.hp - a.hp);
  enemies.sort((a, b) => b.hp - a.hp);
  passives.sort((a, b) => b.hp - a.hp);
  traps.sort((a, b) => b.damage - a.damage || a.name.localeCompare(b.name));
  return { bosses, enemies, passives, traps, chests };
}

// CLI debug: `node tools/manual/registry.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const data = categorize();
  console.log(JSON.stringify(data, null, 2));
}
