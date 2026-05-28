import Phaser from 'phaser';
import { preloadAll as preloadAllSounds } from '../audio';
import {
  FOREGROUND_GLOW_ENABLED,
  MAGIC_ORB_FILL_COLOR,
  MAGIC_ORB_TEXTURE_KEY,
  MAGIC_ORB_TEXTURE_SIZE_PX,
  MIST_PARTICLE_COLOR,
  MIST_PARTICLE_TEXTURE_KEY,
  MIST_PARTICLE_TEXTURE_SIZE_PX,
  PAUSE_CONTINUE_ASSET_PATH,
  PAUSE_CONTINUE_TEXTURE_KEY,
  PAUSE_QUIT_ASSET_PATH,
  PAUSE_QUIT_TEXTURE_KEY,
  SCENE_KEYS,
} from '../constants';
import { ldtkRaw } from '../ldtk/ldtkData';
import { parseLdtkProject } from '../ldtk/parseLdtk';
import type { LdtkTilesetDef } from '../ldtk/types';
import { bakeGlowAtlasForTileset } from '../level/GlowAtlasBaker';
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
    // word "CONTINUE" / "QUIT" rendered in white. Loaded as plain images and
    // displayed side-by-side by PauseScene.
    this.load.image(PAUSE_CONTINUE_TEXTURE_KEY, PAUSE_CONTINUE_ASSET_PATH);
    this.load.image(PAUSE_QUIT_TEXTURE_KEY, PAUSE_QUIT_ASSET_PATH);
  }

  create(): void {
    registerAllCharacterAnimations(this);
    registerAllEntityAnimations(this);
    // Register tight content frames for the HUD textures whose source files
    // have lots of empty space. PlayerHud references these frames by name.
    // Coords were measured from the source PNGs by pixel inspection; if the
    // assets are updated upstream, re-derive with `python -c "from PIL ..."`.
    this.textures.get('hud_stamina').add('content', 0, 18, 21, 23, 3);
    this.textures.get('hud_magic').add('content', 0, 13, 19, 23, 3);
    this.generateMagicOrbTexture();
    this.generateMistParticleTexture();
    // Force LINEAR sampling on the pause word banners so the scaled-up
    // letters render smoothly. The global pixelArt:true config would
    // otherwise nearest-sample them into jagged stair-stepped edges. Same
    // override pattern used for magic_orb and InteractionIcon's letter.
    this.textures
      .get(PAUSE_CONTINUE_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.textures
      .get(PAUSE_QUIT_TEXTURE_KEY)
      .setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.bakeForegroundGlowAtlases();
    this.scene.start(SCENE_KEYS.GAME);
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

  // Procedural placeholder for the magic orb pickup: a small pure-black smooth
  // circle. Authored at MAGIC_ORB_TEXTURE_SIZE_PX (12) so a 0.5× display scale
  // at zoom 3 has enough source pixels to anti-alias. LINEAR filter is forced
  // on this texture because the global pixelArt:true config would otherwise
  // nearest-sample the smooth circle into a stepped silhouette. Swap for a
  // real PNG by loading at MAGIC_ORB_TEXTURE_KEY in preload() and removing
  // this call.
  private generateMagicOrbTexture(): void {
    const size = MAGIC_ORB_TEXTURE_SIZE_PX;
    const cx = size / 2;
    const cy = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(MAGIC_ORB_FILL_COLOR, 1);
    // 1px margin so the AA edge has room to fade to transparent without
    // getting clipped by texture bounds.
    g.fillCircle(cx, cy, cx - 1);
    g.generateTexture(MAGIC_ORB_TEXTURE_KEY, size, size);
    g.destroy();
    this.textures
      .get(MAGIC_ORB_TEXTURE_KEY)
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
