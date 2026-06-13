// Curated content for the Game Design Document (docs/The-Beneath-GDD.docx).
// Data-only; generate-gdd.mjs renders it. Prose is adapted from the game's own
// in-game manual / tools/manual/content.mjs; every number is transcribed from the
// cited constants. Per the author's direction the two guns are named "Rifle"
// (Gun 1 — fast/accurate) and "Laser Blaster" (Gun 2 — slow/heavy), the world is
// framed as three boss-gated regions spanning 23 connected areas, and the document
// uses no images (the world map / flow is rendered as text). Content is kept tight
// to hold the document to the assignment's 3–4 page limit.

export const TITLE = 'THE BENEATH';
export const TAGLINE =
  'Descend through the dark, fight or evade what lives there, and gather what you need to press deeper.';
export const META =
  'Game Design Document  ·  2D Action-Adventure  ·  Browser game (HTML5 / Phaser, TypeScript)  ·  Single-player';

// ── 2 · Backstory ────────────────────────────────────────────────────────────
export const BACKSTORY = [
  'Generations ago, the surface died. Wars, droughts, and poisoned skies drove the last of humanity underground, into the only caves that could still keep them alive. Centuries passed with no word from above. Radiation, sickness, and strange subterranean plants slowly reshaped those who lingered too long in the dark — and some were lost entirely, twisted into the cave monsters that now haunt the tunnels.',
  'The passages back to the surface collapsed long ago, but old legends speak of portals — gateways the first generations hid deep in the rock, still able to reach the world above. Now the Beneath itself is failing, caving in around the last survivors. You descend to find a portal and escape, carrying humanity’s last hope that the surface can sustain life once more.',
];

// ── 3 · Characters ───────────────────────────────────────────────────────────
export const MAIN_CHARACTER =
  'You play a lone survivor of the Beneath — a blade master who descends alone into the collapsing deep. You carry three weapons at once and swap between them on the fly: a silent sword that can be charged with arcane magic, a rapid-fire rifle, and a heavy laser blaster. You can run, dash, roll, wall-slide, climb ledges, block, and even teleport-strike to the nearest foe. With 100 HP and only the ammo and magic you can scavenge, every descent balances aggression and restraint.';

export const ENEMIES_INTRO =
  'The Beneath is full of things that want you dead, sorted loosely into three worlds: the monsters of the caves, the guardians of the ruined cities, and the bandits of the hidden lairs.';

// [name, type, threat] — threats kept to one line
export const ENEMIES = [
  ['Ghoul', 'Cave monster', 'Basic shambling melee; fills the tunnels in numbers.'],
  ['Spitter', 'Cave monster', 'Hangs back and spits ranged shots from afar.'],
  ['Summoner', 'Cave monster', 'Harmless itself, but conjures Ghouls and Spitters.'],
  ['Dark Warden', 'Cave bruiser', 'A heavy melee monster of the deep tunnels.'],
  ['Wasp + Hive', 'Swarm', 'Fast, ignores stealth; a struck hive looses the whole swarm.'],
  ['Bandits (Dagger / Archer)', 'Bandit', 'Guard the lairs — daggers up close, arrows from above.'],
  ['Guardians (Assassin, Hell Bot, Flame Dude)', 'City guardian', 'Patrol the cities; a gunshot brings them all.'],
  ['Orb Mage', 'Caster', 'Lobs AoE spells from range and heals itself — kill it first.'],
];

// [name, lair, style, key]
export const BOSSES = [
  ['Shadow of Storms', 'Region I — Level 5', 'Melee blows and a wide ground shockwave; heals itself when badly hurt.', 'key_storms'],
  ['The Tarnished Widow', 'Region II — Level 10', 'Melee, ranged spit, and a teleport strike — she closes distance fast.', 'key_widow'],
  ['The Heart Hoarder', 'Region III — Level 13 (final)', 'Teleporting AoE bruiser that splits into copies. The toughest fight.', 'key_heart'],
];

export const BOSS_NOTE =
  'Each guardian boss fights in three escalating rounds, dropping its key plus coins, ammo, and magic orbs, and never respawns. (A fourth boss, the Blood King, is built into the game but hidden off the normal route.)';

export const NPCS =
  'Not everything is hostile. Spirit Walkers — former humans shrunk and glowing from a diet of phosphorescent food — wander the cities in seven varieties and even greet one another as they pass; none want you dead. The Tech Shop and Mushroom Merchant trade with you, and ambient wildlife (crows, deer, and trap-warning spark-bugs) fills out the world.';

// ── 4 · Gameplay ─────────────────────────────────────────────────────────────
// Controls [input, action]
export const CONTROLS = [
  ['A / D', 'Move left / right'],
  ['W', 'Jump (tap for a short hop, hold for full height)'],
  ['S  /  Shift', 'Roll (dodge)  /  Dash (costs 1 stamina)'],
  ['Left-Click', 'Attack / fire the active weapon'],
  ['Right-Click', 'Block — negates frontal hits (sword only)'],
  ['Mouse Wheel', 'Switch weapon: Sword ↔ Rifle ↔ Laser Blaster'],
  ['F  /  Space + Click', 'Magic stance  /  Teleport Strike (sword only)'],
  ['Q', 'Use a heal item (restore 25 HP)'],
  ['E (hold)', 'Interact — chests, save beacons, doors, merchants, portal'],
];

export const MECHANICS = [
  ['Three weapons, one wheel',
    'The sword is free, silent, and chains a five-hit combo (15 dmg); press F to charge it with magic for double damage (30) at one orb per swing. The rifle is fast and accurate (10 dmg); the laser blaster is slower but heavier (15 dmg). Both guns burn scarce ammo, so blades stay your default and guns are an emergency burst.'],
  ['Noise, stealth & alertness',
    'Guns are loud — a shot carries ~700px through walls and pulls enemies straight to the spot, so firing in a city brings the guardians down on you; blades are silent. Foes start unaware and see only within a ~110° forward cone with line of sight, making backs and corners blind spots. Screen-corner brackets show your exposure in three states: white “unseen”, yellow “?” investigating, red “!” detected.'],
  ['Loot & upgrades',
    'Coins, ammo, orbs, and heals drop from foes and chests. Two merchants recur three times as you descend: the Tech Shop (ammo plus permanent Ammo Storage — rifle 12→30, blaster 8→20) and the Mushroom Merchant (orbs, heals, and Orb Pouch — magic 3→10). Capacity upgrades are permanent and survive death, so buy them first.'],
  ['Interaction, saving & traps',
    'Hold E at the “E” prompt to open chests, trade, unlock key doors, or save at a beacon (which sets your respawn and banks progress). Traps — spikes, bear traps, swinging blades, ejectors — need no prompt and simply hurt on contact; the spark-bugs that hover above them are your warning.'],
];

// Game flow [step, what it means]
export const FLOW = [
  ['Descend', 'Travel deeper through the connected levels — there is no menu; you move through the world itself.'],
  ['Sneak or fight', 'Slip behind unaware foes, or take them head-on. Stay quiet near cities.'],
  ['Collect', 'Gather coins, ammo, magic orbs, and heal items from fallen foes and chests.'],
  ['Beat the boss', 'Defeat the guardian boss of the region to claim its key.'],
  ['Unlock & upgrade', 'Open the locked gate with the key; spend coins at the city’s two shops.'],
  ['Repeat, deeper', 'Press on through the next region until you reach the portal.'],
];

export const VICTORY =
  'You win by reaching the portal in the deepest level (Level 13) and holding E to warp out — the warp completing is the victory, and the screen reads YOU WON. The portal sits behind the Heart Hoarder’s key_heart door, so the final boss (and the two before it) must fall to reach it. Killing the final boss does not by itself win — stepping through the portal does.';

export const DEFEAT =
  'Losing all 100 HP ends the run. If you have used a save beacon, you respawn there — health, ammo, magic, coins, and run progress (keys, bosses, chests, upgrades) intact. If you have not saved yet, death sends you back to the title screen.';

export const RULES = [
  'Three regions, three locked gates, in order: each opens only for the matching boss key (hold E against the door).',
  'Three bosses, three keys — Shadow of Storms → key_storms, Tarnished Widow → key_widow, Heart Hoarder → key_heart.',
  'Sword and magic are silent; guns are loud and draw enemies through walls. Save often — an unsaved death costs the whole run.',
];

// ── 5 · Game World ───────────────────────────────────────────────────────────
export const WORLD_INTRO =
  'The Beneath is one continuous, hand-built world of 23 interconnected areas, descending from the near-surface ruins down into the deepest dark. You never pick a level from a menu — you physically travel between areas, and locked doors force the order. Those 23 areas form three boss-gated regions, each deeper, stranger, and deadlier than the last. In each, the rhythm is the same: explore, gear up at the city’s shops, raid the bandit lair, defeat the guardian boss, take its key, open the gate, and descend.';

// [name, description] — one line each
export const BIOMES = [
  ['Caverns', 'Claustrophobic tunnels, jagged walkways over deep pits, and vertical shafts to climb and drop. Home to the cave monsters.'],
  ['Ruined Cities', 'Alcoves carved like underground skyscrapers, lit by flickering neon and phosphorescent growth. Glowing Spirit Walkers throng them; guardians patrol — never fire a gun here.'],
  ['Bandit Lairs', 'Hidden at the end of narrow tunnels or in quiet city corners: the best loot in a region, and the most heavily guarded.'],
];

// Vertical text "flow chart" of world navigation (no images, per direction).
export const NAV_FLOW = [
  'SURFACE RUINS  ·  the descent begins',
  'REGION I — Caverns & First City   →   Shadow of Storms   ⇒   key_storms   →   Gate to Level 6',
  'REGION II — Deep Caves & Ruined City   →   The Tarnished Widow   ⇒   key_widow   →   Gate to Level 12',
  'REGION III — The Deepest Dark   →   The Heart Hoarder   ⇒   key_heart   →   Gate to Level 13',
  'THE PORTAL   —   hold E to warp   →   ESCAPE TO THE SURFACE  ·  YOU WON',
];

// Region overview table [region, depth, what's there, boss, key → gate]
export const REGIONS = [
  ['I — Upper Beneath', 'Near the surface', 'Caverns, the first city, a lair', 'Shadow of Storms', 'key_storms → Level 6'],
  ['II — Mid Beneath', 'Deeper', 'Darker caves, a ruined city, a lair', 'The Tarnished Widow', 'key_widow → Level 12'],
  ['III — Deep Beneath', 'The lowest levels', 'The deepest dark, the final arena', 'The Heart Hoarder', 'key_heart → L13 → Portal'],
];

// ── 6 · Bonus Materials ──────────────────────────────────────────────────────
export const ACHIEVEMENTS_INTRO =
  'A run can be played many ways — silent and unseen, guns blazing, or magic-forward — and the world rewards a second look. These designed achievements pull players back for another descent:';

// [name, how to earn]
export const ACHIEVEMENTS = [
  ['Ghost', 'Pass through a city without ever being detected.'],
  ['Blade Purist', 'Defeat a boss using only sword and magic — no guns.'],
  ['Untouchable', 'Beat any boss without taking a single hit.'],
  ['Treasure Hunter', 'Open every chest in a region.'],
  ['Loaded for the Deep', 'Buy every Ammo Storage and Orb Pouch upgrade.'],
  ['The Forgotten King', 'Discover and defeat the hidden Blood King.'],
];

export const REPLAY = [
  'Distinct playstyles: a silent blade run plays nothing like a loud gun run — the alert system makes each a different game.',
  'Scarce resources force real choices: permanent capacity now, or ammo for the fight ahead?',
  'Hidden corners and the secret Blood King reward going off the beaten path; no-save and no-damage runs challenge veterans.',
];
