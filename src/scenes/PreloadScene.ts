import Phaser from 'phaser';
import { preloadAll as preloadAllSounds } from '../audio';
import {
  COIN_FILL_COLOR,
  COIN_HIGHLIGHT_COLOR,
  COIN_TEXTURE_KEY,
  COIN_TEXTURE_SIZE_PX,
  DISPLAY_FONT_NAME,
  FONT_BOOT_TIMEOUT_MS,
  FOREGROUND_GLOW_ENABLED,
  HEAL_CROSS_COLOR,
  HEAL_CROSS_TEXTURE_KEY,
  HEAL_CROSS_TEXTURE_SIZE_PX,
  KEY_FILL_COLOR,
  KEY_HIGHLIGHT_COLOR,
  KEY_TEXTURE_KEY,
  KEY_TEXTURE_SIZE_PX,
  LANDING_CREDITS_ASSET_PATH,
  LANDING_CREDITS_TEXTURE_KEY,
  LANDING_START_ASSET_PATH,
  LANDING_START_TEXTURE_KEY,
  LANDING_TITLE_FONT_SIZE_PX,
  MAGIC_ORB_FILL_COLOR,
  MAGIC_ORB_TEXTURE_KEY,
  MAGIC_ORB_TEXTURE_SIZE_PX,
  MIST_PARTICLE_COLOR,
  MIST_PARTICLE_TEXTURE_KEY,
  MIST_PARTICLE_TEXTURE_SIZE_PX,
  PAUSE_CONTINUE_ASSET_PATH,
  PAUSE_CONTINUE_TEXTURE_KEY,
  PAUSE_NEW_GAME_ASSET_PATH,
  PAUSE_NEW_GAME_TEXTURE_KEY,
  PAUSE_OPTIONS_ASSET_PATH,
  PAUSE_OPTIONS_TEXTURE_KEY,
  PAUSE_QUIT_ASSET_PATH,
  PAUSE_QUIT_TEXTURE_KEY,
  SCENE_KEYS,
  TILESET_BRIGHTNESS_FACTORS,
} from '../constants';
import { ldtkRaw } from '../ldtk/ldtkData';
import { parseLdtkProject } from '../ldtk/parseLdtk';
import type { LdtkTilesetDef } from '../ldtk/types';
import { bakeGlowAtlasForTileset } from '../level/GlowAtlasBaker';
import { brightenTilesetTexture } from '../level/TilesetBrightnessPass';
import {
  collectTilesetsForAllLevels,
  preloadTilesets,
} from '../level/TilesetRegistry';
import {
  preloadAllCharacters,
  preloadAllEntities,
  registerAllCharacterAnimations,
  registerAllEntityAnimations,
} from '../sprites/characterLoader';

export class PreloadScene extends Phaser.Scene {
  // Captured in preload() and consumed in create() to bake foreground glow
  // atlases once the tileset textures have finished loading. Stored on the
  // instance rather than re-derived because parseLdtkProject is the heaviest
  // line in preload() and we already paid for it once.
  private tilesetsForGlowBake: ReadonlyArray<LdtkTilesetDef> = [];

  constructor() {
    super({ key: SCENE_KEYS.PRELOAD });
  }

  preload(): void {
    this.createLoadingBar();
    preloadAllCharacters(this);
    preloadAllEntities(this);
    preloadAllSounds(this);

    // Load every level's tilesets up front: GameScene renders all levels in
    // the same world so the player can walk between them, so partial loading
    // would leave gaps when the player crosses a level boundary.
    const project = parseLdtkProject(ldtkRaw);
    const tilesets = collectTilesetsForAllLevels(project);
    preloadTilesets(this, tilesets);
    this.tilesetsForGlowBake = tilesets;

    // Player HUD assets. sliders.png is a 15×3 grid of 33×16 cells with a
    // 1-pixel outer margin and 2-pixel inter-cell spacing; row 0 (frames
    // 0-9) is a 10-step segmented fill animation used for the HP bar.
    // The stamina and magic textures are single 336×272 images with the
    // visible content packed into the top-left; we register tight custom
    // frames against them in create() so the rest of the texture's empty
    // space never reaches the renderer.
    this.load.spritesheet(
      'hud_sliders',
      '/DarkSpriteLib/general/ui/sliders/sliders.png',
      {
        frameWidth: 33,
        frameHeight: 16,
        margin: 1,
        spacing: 2,
      },
    );
    this.load.image(
      'hud_stamina',
      '/DarkSpriteLib/general/ui/borders_and_hp/ui_stamina_bar.png',
    );
    this.load.image(
      'hud_magic',
      '/DarkSpriteLib/general/ui/borders_and_hp/ui_magic_bar.png',
    );
    // Ammo icons: 6×3 grid of 16×16 tiles. Row 0 = pistol/rifle bullets,
    // row 2 = shotgun shells. PlayerHud picks one frame per gun.
    this.load.spritesheet(
      'hud_ammo',
      '/DarkSpriteLib/general/ui/ammo/ui_-_ammo.png',
      {
        frameWidth: 16,
        frameHeight: 16,
      },
    );
    // Pause-menu word banners. Each is a small black-background PNG with the
    // word ("CONTINUE", "NEW GAME", "OPTIONS", "QUIT") rendered in white.
    // Loaded as plain images and displayed in a row by PauseScene.
    this.load.image(PAUSE_CONTINUE_TEXTURE_KEY, PAUSE_CONTINUE_ASSET_PATH);
    this.load.image(PAUSE_NEW_GAME_TEXTURE_KEY, PAUSE_NEW_GAME_ASSET_PATH);
    this.load.image(PAUSE_OPTIONS_TEXTURE_KEY, PAUSE_OPTIONS_ASSET_PATH);
    this.load.image(PAUSE_QUIT_TEXTURE_KEY, PAUSE_QUIT_ASSET_PATH);
    // Landing-screen START + CREDITS banners. Same pattern as the pause-menu
    // words — plain PNG, LINEAR-filtered in create() so the scaled-up letters
    // stay smooth at any viewport size. (The home-screen OPTIONS button reuses
    // the pause menu's PAUSE_OPTIONS texture, loaded just above.)
    this.load.image(LANDING_START_TEXTURE_KEY, LANDING_START_ASSET_PATH);
    this.load.image(LANDING_CREDITS_TEXTURE_KEY, LANDING_CREDITS_ASSET_PATH);
  }

  create(): void {
    registerAllCharacterAnimations(this);
    registerAllEntityAnimations(this);
    // Register tight content frames for the HUD textures whose source files
    // have lots of empty space. PlayerHud references these frames by name.
    // Coords were measured from the source PNGs by pixel inspection; if the
    // assets are updated upstream, re-derive with `python -c "from PIL ..."`.
    //
    // STA and MAG strips are each composed of three 7×3 segments separated by
    // 1-pixel gaps, so the full strip spans 23 px (7+1+7+1+7). We register
    // each segment as its own frame so PlayerHud can render them as three
    // independent image sprites and toggle their visibility based on the
    // current value (each resource maxes at 3, so segment-index = value − 1).
    const staminaTex = this.textures.get('hud_stamina');
    staminaTex.add('seg0', 0, 18, 21, 7, 3);
    staminaTex.add('seg1', 0, 26, 21, 7, 3);
    staminaTex.add('seg2', 0, 34, 21, 7, 3);
    const magicTex = this.textures.get('hud_magic');
    magicTex.add('seg0', 0, 13, 19, 7, 3);
    magicTex.add('seg1', 0, 21, 19, 7, 3);
    magicTex.add('seg2', 0, 29, 19, 7, 3);
    this.generateMagicOrbTexture();
    this.generateMistParticleTexture();
    this.generateCoinTexture();
    this.generateHealCrossTexture();
    this.generateKeyTexture();
    // Force LINEAR sampling on the pause word banners so the scaled-up
    // letters render smoothly. The global pixelArt:true config would
    // otherwise nearest-sample them into jagged stair-stepped edges. Same
    // override pattern used for magic_orb and InteractionIcon's letter.
    for (const key of [
      PAUSE_CONTINUE_TEXTURE_KEY,
      PAUSE_NEW_GAME_TEXTURE_KEY,
      PAUSE_OPTIONS_TEXTURE_KEY,
      PAUSE_QUIT_TEXTURE_KEY,
    ]) {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    for (const key of [LANDING_START_TEXTURE_KEY, LANDING_CREDITS_TEXTURE_KEY]) {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    this.applyTilesetBrightnessLifts();
    this.bakeForegroundGlowAtlases();
    // Gate the boot on the self-hosted display font being ready. Phaser
    // rasterizes canvas Text to a GPU texture synchronously at creation, so if
    // Nosifer is still downloading when LandingScene paints "THE BENEATH" the
    // title bakes in the fallback face — and the WebGL texture cache means it
    // often never updates even after a later re-render. Waiting here so the
    // title's FIRST paint already has the real glyphs is the reliable fix.
    this.bootGameWhenFontReady();
  }

  // Starts the GAME scene (landing overlay) once DISPLAY_FONT_NAME has loaded,
  // or after FONT_BOOT_TIMEOUT_MS if the Font Loading API is unavailable or the
  // download stalls/fails — a missing font must never block startup; the title
  // just falls back to its fallback stack in that case. The `booted` guard makes
  // the timeout and the load-promise mutually exclusive so GAME starts once.
  private bootGameWhenFontReady(): void {
    const boot = (): void => {
      // startLanding:true triggers the landing-page overlay on first boot.
      // PauseScene's Quit also routes back through this scene, so the
      // landing re-shows on every fresh start of the run.
      this.scene.start(SCENE_KEYS.GAME, { startLanding: true });
    };

    const fonts = document.fonts;
    if (!fonts) {
      boot();
      return;
    }

    let booted = false;
    const bootOnce = (): void => {
      if (booted) return;
      booted = true;
      boot();
    };

    const timeout = this.time.delayedCall(FONT_BOOT_TIMEOUT_MS, bootOnce);
    fonts
      .load(`${LANDING_TITLE_FONT_SIZE_PX}px "${DISPLAY_FONT_NAME}"`)
      .then(() => {
        timeout.remove(false);
        bootOnce();
      })
      .catch(() => {
        timeout.remove(false);
        bootOnce();
      });
  }

  // Lifts the RGB channels of any tileset listed in TILESET_BRIGHTNESS_FACTORS
  // so visually-darker source art reads at comparable brightness to its peers
  // in the same level. Runs BEFORE the glow bake so the glow pass detects
  // bright pixels on the already-lifted source — keeping the two passes in
  // sync would otherwise require threading the factor into GlowAtlasBaker too.
  private applyTilesetBrightnessLifts(): void {
    for (const def of this.tilesetsForGlowBake) {
      const factor = TILESET_BRIGHTNESS_FACTORS[def.uid];
      if (factor === undefined) continue;
      brightenTilesetTexture(this, def, factor);
    }
  }

  // Pre-bakes a sibling "glow" atlas for every tileset that backs a level, so
  // LevelRenderer can stamp soft halos over bright pixels in Foreground*
  // layers (see GlowAtlasBaker). Gated on FOREGROUND_GLOW_ENABLED — when off,
  // no atlases are registered and LevelRenderer's textures.exists check makes
  // foreground rendering a no-op for the second image-per-tile.
  private bakeForegroundGlowAtlases(): void {
    if (!FOREGROUND_GLOW_ENABLED) return;
    for (const def of this.tilesetsForGlowBake) {
      bakeGlowAtlasForTileset(this, def);
    }
  }

  // Procedural placeholder for the magic ("mana crystal") pickup: a small
  // faceted gem — a flat table, out to the girdle, down to a pointed culet —
  // matching the HUD magic glyph (hudIcons.ts) and kept small so it never reads
  // as the larger Save crystal. Authored at MAGIC_ORB_TEXTURE_SIZE_PX (12) and
  // LINEAR-filtered so its straight edges stay smooth despite the global
  // pixelArt:true config (which would otherwise stair-step them). Internal "orb"
  // naming is retained — the resource is still "orbs" in code; only the shape
  // changed. Swap for a real PNG by loading at MAGIC_ORB_TEXTURE_KEY in preload().
  private generateMagicOrbTexture(): void {
    const size = MAGIC_ORB_TEXTURE_SIZE_PX;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(MAGIC_ORB_FILL_COLOR, 1);
    // Gem outline as fractions of `size`, inset ~1px from the edges so the AA
    // ring fades cleanly inside the texture bounds.
    g.fillPoints(
      [
        { x: size * 0.29, y: size * 0.2 }, // table left
        { x: size * 0.71, y: size * 0.2 }, // table right
        { x: size * 0.88, y: size * 0.42 }, // right girdle
        { x: size * 0.5, y: size * 0.86 }, // culet (bottom point)
        { x: size * 0.12, y: size * 0.42 }, // left girdle
      ],
      true,
    );
    g.generateTexture(MAGIC_ORB_TEXTURE_KEY, size, size);
    g.destroy();
    this.textures
      .get(MAGIC_ORB_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // Procedural placeholder for the gold coin pickup: a small warm-gold disc
  // with a brighter highlight ring inset off-center to give the disc a faint
  // 3D read at small sizes. LINEAR filter (same as the orb) keeps the edge
  // smooth instead of pixelating at CAMERA_ZOOM. Swap for a real PNG by
  // loading at COIN_TEXTURE_KEY in preload() and removing this call.
  private generateCoinTexture(): void {
    const size = COIN_TEXTURE_SIZE_PX;
    const cx = size / 2;
    const cy = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(COIN_FILL_COLOR, 1);
    // 1px margin so the AA edge fades cleanly inside the texture bounds.
    g.fillCircle(cx, cy, cx - 1);
    // Highlight: a smaller filled disc inset toward the upper-left so the
    // coin reads as catching a light source from above. Radius and offset
    // scale with size — at the 8px default this yields a ~2px highlight.
    g.fillStyle(COIN_HIGHLIGHT_COLOR, 1);
    g.fillCircle(cx - size * 0.15, cy - size * 0.15, Math.max(1, size * 0.2));
    g.generateTexture(COIN_TEXTURE_KEY, size, size);
    g.destroy();
    this.textures
      .get(COIN_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // Procedural heal-item pickup: a flat white "+" cross matching the player HUD's
  // heal glyph (hudIcons.ts PLUS_D). Two overlapping bars — one vertical, one
  // horizontal — each 1/6 of the texture thick and inset 1/6 from every edge, so
  // the world/shop pickup reads the same as the interface counter. LINEAR-
  // filtered (like the coin/orb) so the arms stay smooth at CAMERA_ZOOM and in
  // the DOM shop. Swap for a real PNG by loading at HEAL_CROSS_TEXTURE_KEY in
  // preload() and removing this call.
  private generateHealCrossTexture(): void {
    const size = HEAL_CROSS_TEXTURE_SIZE_PX;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(HEAL_CROSS_COLOR, 1);
    const arm = size / 6; // bar thickness
    const inset = size / 6; // gap from each edge to the arm tip
    const span = size - inset * 2; // bar length
    const center = (size - arm) / 2; // offset that centres each bar
    g.fillRect(center, inset, arm, span); // vertical bar
    g.fillRect(inset, center, span, arm); // horizontal bar
    g.generateTexture(HEAL_CROSS_TEXTURE_KEY, size, size);
    g.destroy();
    this.textures
      .get(HEAL_CROSS_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // Procedural placeholder for the boss-key pickup: a small gold key built from
  // a ring bow (outer disc with a punched-out center), a vertical shaft, and two
  // teeth jutting off the lower shaft — plus an off-center highlight on the bow
  // (same faux-3D idiom as the coin/heart). Shared by both boss keys; they're
  // visually identical and matched to doors by pickup kind, not appearance.
  // LINEAR-filtered like the orb/coin/heart so the bow's curve stays smooth at
  // CAMERA_ZOOM. Swap for a real PNG by loading at KEY_TEXTURE_KEY in preload()
  // and removing this call.
  private generateKeyTexture(): void {
    const size = KEY_TEXTURE_SIZE_PX;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const cx = size * 0.5;
    g.fillStyle(KEY_FILL_COLOR, 1);
    // Bow (the round grip) at the top: outer disc with a punched-out hole so it
    // reads as a ring rather than a lollipop. The hole is "punched" by redrawing
    // a transparent disc — graphics fills are opaque, so instead draw the ring
    // as the outer disc then overlay a smaller disc in the background color is
    // not possible on a transparent texture; use an annulus via two arcs.
    const bowCy = size * 0.3;
    const bowOuterR = size * 0.22;
    g.fillCircle(cx, bowCy, bowOuterR);
    // Shaft: a thin vertical bar from just under the bow down to near the base.
    const shaftW = Math.max(1, size * 0.1);
    const shaftTop = bowCy + bowOuterR * 0.6;
    const shaftBottom = size * 0.92;
    g.fillRect(cx - shaftW / 2, shaftTop, shaftW, shaftBottom - shaftTop);
    // Teeth: two short horizontal nubs off the right side of the lower shaft.
    const toothW = size * 0.2;
    const toothH = Math.max(1, size * 0.09);
    g.fillRect(cx + shaftW / 2, shaftBottom - toothH, toothW, toothH);
    g.fillRect(cx + shaftW / 2, shaftBottom - toothH * 3, toothW * 0.7, toothH);
    // Punch the bow hole by stamping a background-transparent disc. generateTexture
    // captures alpha, and erasing via a destination-out blend isn't exposed on
    // Graphics, so approximate the ring look with a smaller highlight-colored
    // disc instead — reads as a lit bevel on the bow at this size.
    g.fillStyle(KEY_HIGHLIGHT_COLOR, 1);
    g.fillCircle(cx, bowCy, bowOuterR * 0.5);
    g.fillStyle(KEY_FILL_COLOR, 1);
    g.fillCircle(cx, bowCy, bowOuterR * 0.28);
    g.generateTexture(KEY_TEXTURE_KEY, size, size);
    g.destroy();
    this.textures
      .get(KEY_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // Small soft black puff used by the magic orb's mist particle emitter. Same
  // LINEAR filter trick as the orb so the circle's edge stays smooth instead
  // of pixelating at zoom.
  private generateMistParticleTexture(): void {
    const size = MIST_PARTICLE_TEXTURE_SIZE_PX;
    const cx = size / 2;
    const cy = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(MIST_PARTICLE_COLOR, 1);
    g.fillCircle(cx, cy, cx - 1);
    g.generateTexture(MIST_PARTICLE_TEXTURE_KEY, size, size);
    g.destroy();
    this.textures
      .get(MIST_PARTICLE_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  private createLoadingBar(): void {
    const { width, height } = this.cameras.main;

    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

    const progressBar = this.add.graphics();

    const loadingText = this.add
      .text(width / 2, height / 2 - 50, 'Loading...', {
        fontSize: '20px',
        color: '#ffffff'
      })
      .setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });
  }
}
