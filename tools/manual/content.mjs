// Curated, player-facing manual content. Prose is ported from the game's own
// in-game manual (src/ui/manual/sections/*); every number is transcribed from
// the cited constants file and is also cross-checked by the generator against
// the live registry where possible. Data-only — generate-manual.mjs renders it.

export const TITLE = 'THE BENEATH';
export const SUBTITLE = 'Player’s Manual';
export const TAGLINE =
  'Descend into the dark, fight or evade what lives there, and gather what you need to go deeper.';

// ── Overview / core loop (src/ui/manual/sections/basicsSection.ts) ──────────
export const OVERVIEW = {
  lead:
    'You start near the surface and descend through connected caverns, ruined cities, and bandit lairs. Locked doors block the way down, and the boss guarding each region holds the key. Sneak past what you can, fight what you must, and keep descending to the portal that ends the run.',
  loop: [
    ['Descend', 'Travel deeper through the levels.'],
    ['Fight & sneak', 'Sneak behind enemies, or take them head on.'],
    ['Collect', 'Take coins, ammo, orbs, and heals from foes and chests.'],
    ['Unlock the way', 'Beat a region’s boss for its key, then open the locked door.'],
    ['Upgrade', 'Spend coins at merchants to expand ammo, magic, and healing.'],
    ['Survive', 'Manage your meters. Run out of health and the run ends.'],
  ],
};

// ── Controls (src/ui/manual/sections/controlsSection.ts — player-facing set;
// debug keys G/fly and N/nav-overlay are intentionally omitted) ─────────────
export const CONTROLS = [
  {
    group: 'Movement',
    rows: [
      ['A / D', 'Move left / right'],
      ['W', 'Jump (tap = short hop, hold = full height)'],
      ['S', 'Roll (quick dodge in the way you face)'],
      ['Shift', 'Dash (burst of speed; 1 stamina)'],
    ],
  },
  {
    group: 'Actions',
    rows: [
      ['E (hold)', 'Interact — chests, saves, merchants, key doors, portal'],
      ['F', 'Toggle magic stance (sword only)'],
      ['Q', 'Use a heal item'],
    ],
  },
  {
    group: 'Mouse',
    rows: [
      ['Left-Click', 'Attack / fire'],
      ['Right-Click', 'Block (sword only)'],
      ['Mouse Wheel', 'Switch weapon (Sword ↔ Pistol ↔ Shotgun)'],
      ['Space + Left-Click', 'Teleport Strike (sword only)'],
    ],
  },
];

// ── Combat (src/constants/combat.ts, player.ts; src/ui/manual/combatClips.ts) ─
export const COMBAT = {
  intro:
    'You carry three weapons — a sword and two guns — and swap with the mouse wheel. The sword is free; guns and magic spend limited resources, so save them for trouble.',
  moves: [
    {
      name: 'Sword',
      keys: 'Left-Click',
      damage: '15 per hit',
      cost: 'Free',
      blurb:
        'Your free starting weapon. Click to swing; keep clicking for a five-hit combo. Silent — it never gives away your position.',
    },
    {
      name: 'Teleport Strike',
      keys: 'Space + Left-Click',
      damage: '15 (sword)',
      cost: 'Free',
      blurb:
        'Vanish and reappear with a strike — a quick gap-closer or escape. Sword only.',
    },
    {
      name: 'Magic',
      keys: 'F, then Left-Click',
      damage: '30 per hit (2× sword)',
      cost: '1 magic orb per swing',
      blurb:
        'Press F to toggle the magic stance. While on, your sword casts hit twice as hard. Each cast spends one orb; with none left, the swing drops to a normal 15-damage hit. Refill orbs from drops and merchants.',
    },
    {
      name: 'Gun 1 — Pistol',
      keys: 'Wheel to draw, Left-Click',
      damage: '10 per shot',
      cost: '1 pistol ammo per shot',
      blurb:
        'Fast, accurate shots — quicker than the shotgun, and you can move and jump while firing. But gunfire is loud and carries through walls.',
    },
    {
      name: 'Gun 2 — Shotgun',
      keys: 'Wheel to draw, Left-Click',
      damage: '15 per shot',
      cost: '1 shotgun ammo per shot',
      blurb:
        'A slow, heavy close-range hitter. Loud like the pistol, and shells are scarce — make them count.',
    },
  ],
};

// ── Survival resources (src/constants/player.ts, combat.ts) ─────────────────
export const RESOURCES = [
  ['Health', '100 HP', 'Hearts, top-left. Lose it all and the run ends. A hit grants 0.5s of invulnerability, so you can’t be chain-stunned.'],
  ['Stamina', '3 pips', 'Each dash spends one pip; regenerates one pip every 2s while not dashing.'],
  ['Magic orbs', 'Start 3 · cap 3→10', 'One per cast. Never regenerates — gather from drops/chests or buy. Cap rises to 10 with Orb Pouch upgrades.'],
  ['Pistol ammo', 'Start 8 · cap 12→30', 'Drops and shop packs add +3 at a time. Cap rises to 30 with Ammo Storage upgrades.'],
  ['Shotgun ammo', 'Start 3 · cap 8→20', 'Scarcer — drops and buys add +1 at a time. Cap rises to 20 with Ammo Storage upgrades.'],
  ['Heal items', 'Carry up to 5', 'Press Q to restore 25 HP. From drops or mushroom merchants.'],
  ['Coins', '—', 'From enemies and chests. Spend at the merchants.'],
];

export const FALL_DAMAGE =
  'Falling only hurts past about a ten-tile drop. Below that it’s harmless; beyond it you take 1 HP per unit of excess impact, capped at 50 HP — so even a terminal-velocity fall is survivable from full health. Sliding down a wall always lands soft.';

// ── Stealth & detection (src/constants/enemies.ts; enemiesSection.ts) ───────
export const STEALTH = {
  intro:
    'Most foes start unaware, so how you approach matters. Enemies see in a forward cone (~110° wide, ~220px) plus a small point-blank radius — a turned back is a blind spot, and walls block sight. The corner brackets at the screen edges track your exposure.',
  states: [
    ['(faint white)', 'Unseen', 'Nothing has noticed you. Strike for a decisive opening.'],
    ['?  (yellow)', 'Investigating', 'Something caught their eye. Break line of sight or back off and they settle.'],
    ['!  (red)', 'Detected', 'Spotted. The enemy rushes you, hunting faster than it walks.'],
  ],
  facts: [
    'Gunfire is loud: any enemy within ~700px is alerted to the exact spot, even through walls. Sword and magic are silent.',
    'Wasps and bosses ignore stealth entirely and are always aggressive.',
    'Cleared areas stay clear: enemies only return after you travel ~8 screens away and several minutes pass. Bosses never respawn.',
  ],
};

// ── Items, pickups & world features (src/constants/pickups.ts, player.ts;
// itemsSection.ts) ──────────────────────────────────────────────────────────
export const PICKUPS = [
  ['Coins', 'Spend at the merchants. Almost every foe drops at least one.'],
  ['Magic orbs', 'Refill magic (+1 each). They hover in place instead of falling.'],
  ['Heal items', 'Stored for later; press Q to restore 25 HP (+1 each).'],
  ['Pistol ammo', '+3 pistol rounds.'],
  ['Shotgun ammo', '+1 shotgun shell.'],
  ['Boss keys', 'Dropped by a boss; carry it to the locked door it opens.'],
];

export const WORLD_FEATURES = [
  ['Chests', 'Hold E to open. Coins and items.'],
  ['Save beacons', 'Hold E to save. Your respawn point if you die.'],
  ['Doors', 'Most open as you approach; some need the matching boss key.'],
  ['Portal', 'The exit, in the deepest level. Hold E to warp out and win.'],
];

export const DROP_ODDS =
  'Most enemies have a 25% chance to drop gun ammo and ~12–15% to drop a heal; every kill drops coins. Small chests: 4 coins (35% a heal). Large chests: 8 coins, a heal (50%), and two magic orbs.';

// ── Shops & upgrades (src/constants/shop.ts, player.ts) ─────────────────────
export const SHOPS = {
  intro:
    'A tech shop and a mushroom merchant sit together at each of three stops on the descent. Browse with the arrow keys, buy with Enter, close with Esc. Restocks are used up; capacity upgrades are permanent and survive death.',
  techShop: {
    name: 'Tech Shop',
    sells: [
      ['Pistol ammo (+3)', '10 coins'],
      ['Shotgun ammo (+1)', '15 coins'],
      ['Ammo Storage upgrade', '30 / 45 / 60 coins'],
    ],
    upgrade:
      'Ammo Storage sells one tier per shop (three total). Each tier widens both gun caps: pistol 12→30 (+6/tier), shotgun 8→20 (+4/tier).',
  },
  mushroomMerchant: {
    name: 'Mushroom Merchant',
    sells: [
      ['Magic orb (+1)', '25 coins'],
      ['Heal item (+1)', '20 coins'],
      ['Orb Pouch upgrade', '30 / 45 / 60 coins'],
    ],
    upgrade:
      'Orb Pouch sells one tier per merchant (three total), raising the magic cap in uneven steps (+3, +2, +2) from 3 to 10.',
  },
  coinValues: [
    ['Weakest foe (Ghoul, Wheel Bot, Summoner)', '1 coin'],
    ['Most enemies & bandits', '2 coins'],
    ['Small chest', '4 coins'],
    ['Large chest', '8 coins'],
    ['Boss', '20 coins'],
  ],
};

// ── Boss compendium. HP / damage / drops are pulled from the registry by id in
// the generator; this supplies location, round waves, and what each unlocks.
// Rounds & rosters: src/entities/bossWaves.ts, bossRounds.ts, constants/boss.ts.
export const BOSS_SYSTEM =
  'Each of the three guardian bosses fights in three rounds — its health bar splits into thirds. Breaking a third triggers a brief “Round N” banner (boss frozen and invulnerable), then reinforcements spawn in (rounds 2 and 3 only). Leave the arena mid-fight and a “LEAVING COMBAT ZONE” timer counts down 3 seconds; don’t return in time and the fight resets to full health.';

export const BOSSES = [
  {
    id: 'Shadow_of_storms_spawn',
    location: 'Level 5',
    style: 'Trades melee blows and slams the ground with a wide shockwave; heals itself when badly wounded.',
    rounds: [
      'Round 2: each spawn point releases 2 Evil Crows + 1 Caged Shocker.',
      'Round 3: each spawn point releases 3 Dagger Bandits.',
    ],
    drops: 'key_storms',
    unlocks: 'Opens the locked door in the Level 6 region.',
  },
  {
    id: 'The_tarnished_widow_spawn',
    location: 'Level 10',
    style: 'Mixes melee, ranged spit, and a teleport strike — she closes distance fast.',
    rounds: [
      'Round 2: each spawn point releases 5 Caged Spiders.',
      'Round 3: each spawn point releases 7 Wasps.',
    ],
    drops: 'key_widow',
    unlocks: 'Opens the locked door in the Level 12 region.',
  },
  {
    id: 'The_heart_hoarder_spawn',
    location: 'Level 13 (final)',
    style: 'Teleports around the arena between heavy AoE and melee. The toughest fight in the game.',
    rounds: [
      'Round 2: each spawn point releases 3 Ghouls.',
      'Round 3: instead of a wave, the boss splits into two or three harmless 40-HP copies — clear them to finish.',
    ],
    drops: 'key_heart',
    unlocks: 'Opens the Level 13 door to the victory portal.',
  },
];

export const BOSS_NOTE_BLOOD_KING =
  'A fourth boss, The Blood King, exists in the game but isn’t placed in the current descent — you won’t meet him on a normal run. (He’s a single-phase fight, not a round fight.)';

export const BOSS_COMMON_DROPS =
  'Every guardian boss also drops 20 coins, both kinds of gun ammo, and three magic orbs.';

// ── Levels & progression (the_beneath.ldtk; constants/boss.ts LOCKED_DOOR_KEYS) ─
export const PROGRESSION = {
  intro:
    'The world is 23 connected levels descending from the surface. You don’t pick from a menu — you travel through the world, and locked doors set the order.',
  gates: [
    ['key_storms (Shadow of Storms)', 'unlocks the Level 6 gate'],
    ['key_widow (The Tarnished Widow)', 'unlocks the Level 12 gate'],
    ['key_heart (The Heart Hoarder)', 'unlocks the Level 13 gate to the portal'],
  ],
  notes: [
    'Hold E against a locked door while carrying its key. Without the key: “You must find the key to open this door.”',
    'Save beacons are scattered throughout; the three shop stops sit deeper down.',
  ],
};

// ── Victory & defeat (src/scenes/GameScene.ts portal handlers; constants/portal.ts;
// constants/boss.ts; state/runProgress.ts) ──────────────────────────────────
export const VICTORY =
  'Reach the portal in the deepest level (Level 13) and hold E to warp out — the warp completing wins, and the screen reads YOU WON. The portal sits behind the key_heart door, so you must beat the Heart Hoarder to reach it (and the other two bosses to open the gates before it). Killing the final boss doesn’t win on its own — the portal does.';

export const DEFEAT =
  'Health reaching zero ends the run. If you’ve used a save beacon, you respawn there fully restored, and your run progress (keys, defeated bosses, upgrades, opened chests) carries over. If you haven’t saved, death returns you to the title screen.';

export const SETTINGS =
  'Press Esc for the pause menu: Continue, New Game, Options, or Quit. Options holds the How-to-Play guide, a music-volume slider, and a mute toggle. Move with the arrow keys (or W/S) and confirm with Enter or Space.';

// ── Per-enemy role / where-you-meet-them notes, keyed by registry id. Roles
// from src/ui/manual/sections/enemiesSection.ts; stats merged from the registry.
export const ENEMY_ROLES = {
  Assassin_spawn: ['City guardian', 'Fast melee; chains a four-hit combo. Guards the cities.'],
  Orb_mage_spawn: ['Caster', 'Lobs AoE spells from range and self-heals. A priority kill.'],
  Dark_warden_spawn: ['Cave monster', 'Heavy melee bruiser of the underground.'],
  Hell_bot_spawn: ['City guardian', 'Melees up close and fires ranged shots.'],
  Caged_shocker_spawn: ['Cave monster', 'Two-hit melee attacker.'],
  Flame_dude_spawn: ['City guardian', 'Fire thrower; bursts on death — don’t finish it point-blank.'],
  Wheel_bot_spawn: ['City guardian', 'Ambush turret: dormant until it has line of sight, then fires.'],
  Summoner_spawn: ['Cave monster', 'Harmless itself, but conjures Ghouls and Spitters. Kill it fast.'],
  Archer_bandit_spawn: ['Bandit', 'Rains arrows from above; shelter under a ceiling.'],
  Dagger_bandit_spawn: ['Bandit', 'Short-range melee; guards stashed treasure.'],
  Doberman_spawn: ['Guard dog', 'Quick melee; runs you down.'],
  Ghoul_spawn: ['Cave monster', 'The basic shambling cave melee.'],
  Caged_spider_spawn: ['Cave monster', 'Small, fragile biter — often in numbers.'],
  Evil_crow_spawn: ['Cave monster', 'Flier; commits to a diving lunge from a distance.'],
  Spitter_spawn: ['Cave monster', 'Ranged spit from afar.'],
  Wasp_spawn: ['Swarm', 'Tiny, fast, relentless; stings on contact, ignores stealth, swarms from hives.'],
};

export const PASSIVE_ROLES = {
  The_hive_spawn: ['Wasp nest', 'Immovable. Bursts in a large explosion when destroyed — can catch its own swarm.'],
  Spirit_walker_spawn: ['NPC', 'Harmless spirits that wander the cities; none want you dead.'],
  Crow_spawn: ['Animal', 'Ambient wildlife.'],
  Spark_bug_spawn: ['Warning sign', 'Hovers above hidden traps — a tell that the floor ahead is dangerous.'],
};

export const TRAPS_INTRO =
  'Stationary hazards line the deeper routes; they have no health and hurt on contact (your invulnerability window limits repeat ticks). A hovering Spark Bug often marks one.';
