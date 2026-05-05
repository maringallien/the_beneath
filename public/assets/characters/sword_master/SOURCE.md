# sword_master sprite sheets

PNG sprite sheets copied from the DarkSpriteLib animation library.

## regular_animations/

18 PNGs (attack1..6, block, dash, death, fall1, idle, jog, ledge_climb, ledge_slide, roll, run, sprint, take_hit) copied on 2026-05-02.

- **Source path**: `/home/marin/Documents/DarkSpriteLib/playable_character/sword_master_animations/regular_animations/`
- **Authoritative metadata**: `/home/marin/Documents/DarkSpriteLib/registry/playable_character/sword_master.json`
- **In-project metadata**: `src/sprites/swordMaster.json` (paths rewritten to `assets/characters/sword_master/regular_animations/...`)

## magic_attacks/

5 PNGs (attack1..5) copied on 2026-05-03.

- **Source path**: `/home/marin/Documents/DarkSpriteLib/playable_character/sword_master_animations/magic_attacks/`
- **Authoritative metadata**: `/home/marin/Documents/DarkSpriteLib/registry/playable_character/sword_master_magic.json`
- **In-project metadata**: `src/sprites/swordMasterMagic.json` (paths rewritten to `assets/characters/sword_master/magic_attacks/...`)

## Workflow

Do not edit these PNGs in place. If the upstream sprites change, re-copy from DarkSpriteLib and re-copy the registry JSON (rewriting `file` paths again) so the game stays self-contained and exportable.
