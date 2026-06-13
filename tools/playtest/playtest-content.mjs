// Curated content for the Manual Playtest Checklist (docs/The-Beneath-Playtest-Plan.docx).
// Data-only; generate-playtest.mjs renders it, and pulls the live enemy/trap roster
// from entityRegistry.json (via ../manual/registry.mjs) so those lists never drift.
// Testing is MANUAL only — there is no automated suite. Every entry is one line:
// a [check, expected] pair a human runs and ticks Pass/Fail.

export const TITLE = 'THE BENEATH';
export const SUBTITLE = 'Manual Playtest Checklist';
export const TAGLINE = 'A short, by-hand checklist for testing the descent — no automated tests.';
export const META = '2D Action-Adventure  ·  Browser (HTML5 / Phaser, TypeScript)  ·  Single-player';

// How to run and how to use this checklist — kept to a handful of bullets.
export const SETUP = [
  'Run "npm run dev" and open http://localhost:3000 in Chrome or Firefox. Keep the browser dev-console open to catch errors.',
  'Hard-reload (Ctrl+Shift+R) between sessions — hot-reload leaves stale enemies behind and can make behaviour tests lie.',
  'The save is in-memory only; reloading the page wipes it. Do progression and save tests in one uninterrupted session.',
  'Work top to bottom. Run the Smoke Test first; if it fails, stop and report before going further.',
  'Tick Pass or Fail in the Result column and note anything odd. A "~" value is approximate — judge it by feel.',
  'Debug keys: N toggles the enemy navigation overlay; G toggles fly mode (no gravity/collision).',
];

// Compact controls reference [input, action].
export const CONTROLS = [
  ['A / D', 'Move left / right'],
  ['W', 'Jump (release early for a short hop)'],
  ['S  /  Shift', 'Roll  /  Dash (1 stamina)'],
  ['Left-Click', 'Attack / fire (aimed at cursor)'],
  ['Right-Click', 'Block frontal hits (sword)'],
  ['Mouse Wheel', 'Switch weapon: Sword / Rifle / Laser Blaster'],
  ['F  /  Space', 'Magic stance  /  Teleport-strike (sword)'],
  ['Q  /  E (hold)', 'Heal (+25 HP)  /  Interact'],
  ['Esc', 'Pause'],
];

// Boss -> key -> gate (boss.ts LOCKED_DOOR_KEYS). Used in the Levels section.
export const KEY_GATES = [
  ['Shadow of Storms', 'key_storms', 'Gate into Level 6'],
  ['The Tarnished Widow', 'key_widow', 'Gate into Level 12'],
  ['The Heart Hoarder (final)', 'key_heart', 'Gate into Level 13 (portal room)'],
];

// Shop prices (shopTypes.ts). Used in the Shops section.
export const SHOP_PRICES = [
  ['Rifle ammo', '10 coins', '+3'],
  ['Laser Blaster ammo', '15 coins', '+1'],
  ['Mana Crystal', '25 coins', '+1 orb'],
  ['Med Kit', '20 coins', '+25 HP'],
  ['Ammo Storage (x3)', '30 / 45 / 60', 'Rifle 12->30, Blaster 8->20'],
  ['Orb Pouch (x3)', '30 / 45 / 60', 'Magic 3 -> 6 -> 8 -> 10'],
];

// ── Test sections ──────────────────────────────────────────────────────────────
// Each section: { title, intro?, inject?: 'enemies'|'traps', table?, checks: [[check, expected], ...] }
export const SECTIONS = [
  {
    title: 'Smoke Test',
    intro: 'A two-minute gate. Run this first on every build.',
    checks: [
      ['Open the game URL.', 'Title screen appears (START / OPTIONS / CREDITS); no console errors.'],
      ['Click START.', 'Fades into gameplay; the player spawns and the HUD appears.'],
      ['Move (A/D) and jump (W).', 'Player runs both ways and jumps with correct animation.'],
      ['Sword-attack a basic enemy.', 'Hits connect and kill it.'],
      ['Switch to a gun and fire.', 'Weapon indicator updates; a projectile fires toward the cursor.'],
      ['Take one hit from an enemy.', 'A heart depletes on the HUD; brief knockback.'],
      ['Pause (Esc), then Continue.', 'Game freezes and resumes where you left off.'],
      ['Play ~5 minutes.', 'No crash, freeze, console errors, or audio loss.'],
    ],
  },
  {
    title: 'Movement & Traversal',
    checks: [
      ['Run left and right.', 'Smooth movement with correct facing.'],
      ['Jump; then jump and release W early.', 'Full jump vs a noticeably shorter hop.'],
      ['Roll (S) while moving.', 'A short directional dodge; direction locks for the roll.'],
      ['Dash (Shift) three times, then a fourth.', 'Each dash spends 1 stamina; the 4th fails when empty; stamina refills over time.'],
      ['Jump into a wall and hold toward it while falling.', 'Descent slows to a wall-slide; landing from it does no fall damage.'],
      ['Jump into a ledge at head height.', 'Player climbs onto the ledge.'],
      ['Fall from a small ledge, then a very tall one.', 'Small drop is safe; a tall drop deals damage on landing.'],
      ['Run into the outer edge of the level.', 'Player is stopped by the world bounds.'],
    ],
  },
  {
    title: 'Combat — Sword & Guns',
    checks: [
      ['Left-Click repeatedly with the sword.', 'Swings chain into a multi-hit combo (~15 dmg each).'],
      ['Press F (orb available), then swing.', 'Double-damage magic swing, spends one orb; reverts to normal at zero orbs.'],
      ['Hold Right-Click facing an attacker, then take a hit from behind.', 'Frontal hits are blocked; hits from behind still land.'],
      ['Press Space with, then without, an enemy in range.', 'Blinks to the nearest enemy and strikes; does nothing when none is in range.'],
      ['Swing the sword near unaware enemies behind a wall.', 'Silent — it does not alert them.'],
      ['Wheel through Sword / Rifle / Laser Blaster.', 'Stance cycles in order and the weapon indicator updates.'],
      ['Fire the Rifle, then the Laser Blaster.', 'Rifle is fast/light (~10 dmg); Blaster is slow/heavy (~15 dmg); each shot spends 1 ammo; no fire at zero ammo.'],
      ['Fire one shot near unaware enemies.', 'Loud — nearby enemies (even past walls) converge on the spot.'],
      ['Aim and fire to the left.', 'Projectile is mirrored correctly (never upside-down).'],
    ],
  },
  {
    title: 'Health, Resources & Death',
    checks: [
      ['Read the HUD.', 'Five hearts (100 HP), three stamina pips, plus ammo / magic / coins / heals.'],
      ['Take a hit, then stay in contact.', 'A brief invulnerability window prevents instant re-hits.'],
      ['Press Q below full health.', '+25 HP and one heal item spent; refused at full HP, when empty, or mid-action.'],
      ['Collect coins.', 'Coin count rises.'],
      ['Take lethal damage with no save made.', 'Run ends and returns to the title screen.'],
    ],
  },
  {
    title: 'Stealth & Enemies',
    intro: 'Enemies start unaware and see within a ~110 degree forward cone with line of sight. Corner brackets show exposure: white (unseen), yellow "?" (investigating), red "!" (detected). Spot-check each enemy below.',
    inject: 'enemies',
    checks: [
      ['Approach an enemy from outside its cone / behind cover.', 'Corner brackets stay white; it stays unaware.'],
      ['Step into an enemy\'s front cone with clear line of sight.', 'Yellow "?"; it pauses briefly, then rushes your last-seen spot and searches.'],
      ['Stand in its cone but behind a wall.', 'No detection while the wall blocks line of sight.'],
      ['Trade blows in melee.', 'Brackets turn red with "!" while engaged.'],
      ['Fire a gun near unaware enemies.', 'They hear it and move to the shot.'],
      ['Enter a wasp\'s range from any angle.', 'Wasps always attack — they ignore stealth.'],
      ['Lead a chaser around a wall (press N to watch).', 'It routes around the wall instead of pushing into it.'],
      ['Lure a chaser across a gap or low obstacle.', 'It jumps or leaps to keep following.'],
      ['Damage an enemy, then disengage for ~20s.', 'A health bar shows on damage, then resets and hides after the timeout.'],
    ],
  },
  {
    title: 'Bosses',
    intro: 'Three bosses fight in three rounds, breaking at 67% and 33% health, then drop a key and never respawn.',
    checks: [
      ['Approach a boss arena.', 'The fight begins and the boss health bar appears.'],
      ['Damage the boss past 67%, then past 33%.', 'A "Round" banner each time (boss briefly invulnerable); a reinforcement wave spawns.'],
      ['Bring the Heart Hoarder below 33%.', 'It splits into two harmless copies.'],
      ['Leave the arena mid-fight, then step back in.', '"Leaving combat zone" countdown; the fight resets if it expires, and re-entering cancels it.'],
      ['Defeat a boss.', 'Drops its key plus loot, and auto-saves.'],
      ['Return to a defeated boss\'s arena.', 'It does not respawn.'],
    ],
  },
  {
    title: 'Levels, Doors & Progression',
    intro: 'The world is one connected space (no level select); three boss-key gates force the descent order.',
    table: { headers: ['Boss', 'Key', 'Opens'], rows: 'KEY_GATES', widths: [34, 22, 44] },
    checks: [
      ['Walk toward a normal door, then away.', 'It opens on approach and closes once you leave.'],
      ['Hold E on a locked gate without the key.', '"Find the key" message; it stays locked.'],
      ['Hold E on a locked gate holding the matching key.', 'It unlocks, opens, and stays unlocked.'],
      ['Try to descend past a gate you have not earned.', 'Blocked until you have the boss key.'],
      ['Cross several level boundaries.', 'Seamless — no loading screen.'],
    ],
  },
  {
    title: 'Shops, Pickups & Economy',
    intro: 'Two merchants recur three times (upgrade stops at Levels 23, 21, 16). Hold E to open; navigate with arrows / W-S, buy with Enter, close with Esc.',
    table: { headers: ['Item', 'Price', 'Grants'], rows: 'SHOP_PRICES', widths: [34, 30, 36] },
    checks: [
      ['Hold E at a merchant.', 'Shop opens and the game pauses behind it.'],
      ['Buy a restock item with enough coins.', 'Coins deducted; the resource increases.'],
      ['Try to buy with too few coins.', '"Need more"; no coins spent.'],
      ['Try to buy a maxed resource.', '"Max"; purchase blocked.'],
      ['Buy a capacity upgrade, then die.', 'The raised cap persists after respawn.'],
      ['Walk over ammo, magic, heal, and coin pickups.', 'Each grants its amount (capped at max).'],
      ['Hold E on a chest, then die and return.', 'It opens and drops loot, and stays open afterward.'],
      ['Leave a drop on the ground for ~30s.', 'It times out and disappears.'],
    ],
  },
  {
    title: 'Save & Load',
    checks: [
      ['Hold E at a save beacon.', '"Game saved" toast; the beacon is reusable.'],
      ['Defeat a boss.', 'Auto-saves without any manual action.'],
      ['Save, then reload the page (F5).', 'The save is gone (in-memory only) — flag if it should persist.'],
      ['Die after saving.', 'Respawn at the save with resources intact.'],
      ['Die while holding a boss key.', 'The key is kept after respawn.'],
    ],
  },
  {
    title: 'Traps',
    intro: 'Traps hurt on contact and need no prompt; many defer damage to a mid-animation frame, leaving an escape window.',
    inject: 'traps',
    checks: [
      ['Step on spikes.', 'Instant damage on contact.'],
      ['Trigger a bear trap, then leap clear before it snaps.', 'Leaving in time avoids damage; it re-arms after a short delay.'],
      ['Stand under an overhead ejector, then move away.', 'It fires while you are underneath and stops when you leave.'],
      ['Walk under a swaying sword, then leave and return.', 'It falls, hits below, and embeds; it resets when you re-enter the level.'],
      ['Lure an enemy onto a trap.', 'The trap damages enemies too.'],
    ],
  },
  {
    title: 'Audio, HUD & Menus',
    checks: [
      ['Enter gameplay.', 'The main theme plays and loops.'],
      ['Change the OPTIONS music slider, then reload the page.', 'Volume changes and the setting persists.'],
      ['Press M.', 'Music mutes and unmutes.'],
      ['Move between two areas.', 'Ambience crossfades; spatial sounds fade with distance.'],
      ['Open the pause menu (Esc).', 'Continue / New Game / Options / Quit; keyboard and mouse both work; HUD hidden behind it.'],
      ['Open the Options / manual tabs.', 'All tabs render and close cleanly (Esc).'],
      ['Approach an interactable.', 'An "E" prompt appears and the hold ring fills over ~0.5s.'],
      ['Open a chest and listen.', 'Note the known silent chest-open (and any missing alert sound).'],
    ],
  },
  {
    title: 'Victory',
    intro: 'The win is the Level 13 portal warp, not the final boss kill.',
    checks: [
      ['Stand on the Level 13 portal.', 'An "E" prompt appears.'],
      ['Hold E on the portal.', 'Warp plays, the player vanishes, and the "YOU WON" screen appears.'],
      ['Defeat the final boss but do not use the portal.', 'That alone does not win the game.'],
      ['Try the portal before all bosses are defeated.', 'Record what happens and confirm the intended behaviour (open question).'],
      ['Dismiss the victory screen.', 'Returns cleanly, ready for a new run.'],
    ],
  },
];

// Closing note on filing defects — kept short.
export const REPORTING = [
  'For each failure note: what you did, what you expected, what happened, and how often (always / sometimes / once).',
  'Include the commit hash, your browser, and a screenshot or short clip; paste any console errors.',
  'Re-test from a known state (save beacon or fresh run) before filing, to confirm it reproduces.',
];
