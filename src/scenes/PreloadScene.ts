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

/**
 * PreloadScene — the boot scene that loads every asset before gameplay starts.
 *
 * Queues all character/entity/sound assets, every level's tilesets (loaded up
 * front because GameScene streams the whole world and partial loads would gap at
 * level seams), and the HUD/menu/landing images during preload(); then in
 * create() registers animations, carves tight HUD sub-frames, generates the
 * procedural pickup textures, applies tileset brightness + glow bakes, and hands
 * off to GAME — but only once the display font is ready (or a timeout elapses),
 * so the title's first paint uses the real glyphs.
 *
 * Inputs:  the LDtk project data, the sprite/sound registries, and asset-path
 *          constants; the browser Font Loading API.
 * Outputs: a fully populated Phaser texture/animation/audio cache, procedurally
 *          baked textures, and the scene transition into GAME.
 * @calledby the Phaser scene manager at startup (and re-entered when Quit routes
 *           back through the boot).
 * @calls    the character/sound preloaders, the tileset/glow bake passes, and
 *           the scene-start into the gameplay scene's landing overlay.
 */
export class PreloadScene extends Phaser.Scene {
  // Stashed from preload() so create() can bake glow atlases without re-parsing the LDtk project.
  private tilesetsForGlowBake: ReadonlyArray<LdtkTilesetDef> = [];

  // Registers under the PRELOAD scene key.
  constructor() {
    super({ key: SCENE_KEYS.PRELOAD });
  }

  // Queues all game assets — characters, sounds, all tilesets, HUD/menu/landing images.
  preload(): void {
    this.createLoadingBar();
    preloadAllCharacters(this);
    preloadAllEntities(this);
    preloadAllSounds(this);

    // All levels upfront — partial loading would gap at level boundaries as the player walks through.
    const project = parseLdtkProject(ldtkRaw);
    const tilesets = collectTilesetsForAllLevels(project);
    preloadTilesets(this, tilesets);
    this.tilesetsForGlowBake = tilesets;

    // sliders.png: 15×3 grid of 33×16 cells; row 0 is the 10-step HP fill animation.
    // Stamina/magic textures have tight custom frames registered in create() to trim empty space.
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
    // Ammo icons: 6×3 grid of 16×16 tiles; row 0 = bullets, row 2 = shotgun shells.
    this.load.spritesheet(
      'hud_ammo',
      '/DarkSpriteLib/general/ui/ammo/ui_-_ammo.png',
      {
        frameWidth: 16,
        frameHeight: 16,
      },
    );
    // Pause-menu word banners (plain white-on-black PNGs displayed by PauseScene).
    this.load.image(PAUSE_CONTINUE_TEXTURE_KEY, PAUSE_CONTINUE_ASSET_PATH);
    this.load.image(PAUSE_NEW_GAME_TEXTURE_KEY, PAUSE_NEW_GAME_ASSET_PATH);
    this.load.image(PAUSE_OPTIONS_TEXTURE_KEY, PAUSE_OPTIONS_ASSET_PATH);
    this.load.image(PAUSE_QUIT_TEXTURE_KEY, PAUSE_QUIT_ASSET_PATH);
    // Landing START + CREDITS banners; LINEAR-filtered in create() for smooth scaling.
    this.load.image(LANDING_START_TEXTURE_KEY, LANDING_START_ASSET_PATH);
    this.load.image(LANDING_CREDITS_TEXTURE_KEY, LANDING_CREDITS_ASSET_PATH);
  }

  // Registers animations, carves HUD frames, bakes procedural textures/glow, then boots GAME once the font is ready.
  create(): void {
    registerAllCharacterAnimations(this);
    registerAllEntityAnimations(this);
    // Tight HUD sub-frames measured by pixel inspection; re-derive if assets change.
    // STA/MAG strips are three 7×3 segments (1px gaps); each segment is one bar pip.
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
    // LINEAR sampling on word banners so letters stay smooth (overrides global pixelArt config).
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
    // Wait for the display font before booting so the title's first paint already has real glyphs.
    this.bootGameWhenFontReady();
  }

  // Boots GAME once the display font loads, or after a timeout — font must never block startup.
  private bootGameWhenFontReady(): void {
    const boot = (): void => {
      // startLanding:true shows the title overlay; set on every fresh run start (including post-Quit).
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

  // Brightens dark tilesets before the glow bake so the glow pass sees the lifted source.
  private applyTilesetBrightnessLifts(): void {
    for (const def of this.tilesetsForGlowBake) {
      const factor = TILESET_BRIGHTNESS_FACTORS[def.uid];
      if (factor === undefined) continue;
      brightenTilesetTexture(this, def, factor);
    }
  }

  // Pre-bakes a glow atlas for each tileset so LevelRenderer can stamp halos over bright Foreground pixels.
  private bakeForegroundGlowAtlases(): void {
    if (!FOREGROUND_GLOW_ENABLED) return;
    for (const def of this.tilesetsForGlowBake) {
      bakeGlowAtlasForTileset(this, def);
    }
  }

  // Procedural magic-pickup gem (faceted pentagon shape); swap for a real PNG at MAGIC_ORB_TEXTURE_KEY.
  private generateMagicOrbTexture(): void {
    const size = MAGIC_ORB_TEXTURE_SIZE_PX;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(MAGIC_ORB_FILL_COLOR, 1);
    // Gem outline inset ~1px so AA fades cleanly inside the texture bounds.
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

  // Procedural gold coin disc with an off-center highlight; swap for a real PNG at COIN_TEXTURE_KEY.
  private generateCoinTexture(): void {
    const size = COIN_TEXTURE_SIZE_PX;
    const cx = size / 2;
    const cy = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(COIN_FILL_COLOR, 1);
    g.fillCircle(cx, cy, cx - 1);
    // Highlight disc inset upper-left so the coin reads as lit from above (~2px at default size).
    g.fillStyle(COIN_HIGHLIGHT_COLOR, 1);
    g.fillCircle(cx - size * 0.15, cy - size * 0.15, Math.max(1, size * 0.2));
    g.generateTexture(COIN_TEXTURE_KEY, size, size);
    g.destroy();
    this.textures
      .get(COIN_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // Procedural "+" cross pickup matching the HUD heal glyph; swap for a real PNG at HEAL_CROSS_TEXTURE_KEY.
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

  // Procedural gold key pickup (bow + shaft + two teeth); swap for a real PNG at KEY_TEXTURE_KEY.
  private generateKeyTexture(): void {
    const size = KEY_TEXTURE_SIZE_PX;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const cx = size * 0.5;
    g.fillStyle(KEY_FILL_COLOR, 1);
    // Bow at the top: outer disc, then a highlight approximates the ring look (no blend-erase on Graphics).
    const bowCy = size * 0.3;
    const bowOuterR = size * 0.22;
    g.fillCircle(cx, bowCy, bowOuterR);
    const shaftW = Math.max(1, size * 0.1);
    const shaftTop = bowCy + bowOuterR * 0.6;
    const shaftBottom = size * 0.92;
    g.fillRect(cx - shaftW / 2, shaftTop, shaftW, shaftBottom - shaftTop);
    const toothW = size * 0.2;
    const toothH = Math.max(1, size * 0.09);
    g.fillRect(cx + shaftW / 2, shaftBottom - toothH, toothW, toothH);
    g.fillRect(cx + shaftW / 2, shaftBottom - toothH * 3, toothW * 0.7, toothH);
    // Approximate the bow hole with a highlight disc — destination-out blend isn't exposed on Graphics.
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

  // Small black puff for the magic orb's mist particle emitter.
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

  // Creates the Loading... progress bar; tears itself down when the loader finishes.
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
