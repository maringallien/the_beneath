import Phaser from 'phaser';
import { playOneShot } from '../audio';
import {
  LANDING_BUTTON_HOVER_SCALE_MULTIPLIER,
  LANDING_BUTTON_HOVER_TINT,
  LANDING_BUTTON_PRESS_SCALE_MULTIPLIER,
  LANDING_BUTTON_TWEEN_MS,
  LANDING_BUTTON_VIEWPORT_FRACTION_X,
  LANDING_BUTTON_VIEWPORT_FRACTION_Y,
  LANDING_CREDITS_TEXTURE_KEY,
  LANDING_FADE_IN_MS,
  LANDING_FADE_OUT_MS,
  LANDING_MENU_BUTTON_DISPLAY_SCALE,
  LANDING_MENU_BUTTON_GAP_PX,
  LANDING_SCREEN_BRACKET_LENGTH_PX,
  LANDING_SCREEN_FRAME_COLOR,
  DISPLAY_FONT_NAME,
  LANDING_SCREEN_FRAME_MARGIN_PX,
  LANDING_SCREEN_FRAME_STROKE_PX,
  LANDING_START_DISPLAY_SCALE,
  LANDING_START_TEXTURE_KEY,
  LANDING_TITLE_COLOR,
  LANDING_TITLE_FONT_FAMILY,
  LANDING_TITLE_FONT_SIZE_PX,
  LANDING_TITLE_FONT_WEIGHT,
  LANDING_TITLE_TEXT,
  LANDING_TITLE_VIEWPORT_FRACTION_Y,
  LANDING_VIGNETTE_COLOR,
  LANDING_VIGNETTE_EDGE_ALPHA,
  LANDING_VIGNETTE_THICKNESS_PX,
  PAUSE_OPTIONS_TEXTURE_KEY,
  SCENE_KEYS,
  UI_BOOM_SOUND_ID,
  UI_BUTTON_HOVER_SOUND_ID,
} from '../constants';
import { CreditsOverlay } from '../ui/CreditsOverlay';
import { ManualOverlay } from '../ui/ManualOverlay';
import type { GameScene } from './GameScene';

/**
 * LandingScene — the first-boot title overlay, launched on top of GameScene.
 *
 * Renders the START word sprite at the right of the viewport with OPTIONS and
 * CREDITS banners stacked beneath, framed by a vignette + corner brackets; the
 * GameScene side of the same flow holds its camera so the player sits on the
 * left behind it. Committing START (click or Enter/Space) fades both scene
 * cameras to black, then at full black hands off to gameplay and stops this
 * scene — GameScene owns the subsequent black-hold and world/HUD fade-in.
 * OPTIONS opens the shared How-to-Play manual (the same ManualOverlay the pause
 * menu uses) and CREDITS opens a short title/author panel. The scene instance
 * is reused across runs (Quit relaunches it), so create() re-arms the
 * activation guard each time. An optional `fadeIn` launch flag (set on a no-save
 * death relaunch) reveals the title from black in lockstep with the world.
 *
 * Inputs:  optional `{ fadeIn }` launch data; pointer/keyboard input; the live
 *          GameScene (looked up by key) to fade and hand off to.
 * Outputs: the title/menu display objects, hover/press sounds, the two DOM
 *          overlays, and the camera fade chain that starts gameplay.
 * @calledby the boot flow (launched over GameScene at startup) and the death/
 *           Quit paths that return the player to the home screen.
 * @calls    Phaser's scene/camera/tween/input systems, the shared one-shot
 *           audio player, and the manual / credits DOM overlays.
 */
export class LandingScene extends Phaser.Scene {
  private startImage!: Phaser.GameObjects.Image;
  // OPTIONS and CREDITS banners stacked under START.
  private optionsImage!: Phaser.GameObjects.Image;
  private creditsImage!: Phaser.GameObjects.Image;
  // DOM overlays created lazily on first open; destroyed on scene shutdown if still open.
  private manualOverlay: ManualOverlay | null = null;
  private creditsOverlay: CreditsOverlay | null = null;
  private titleText!: Phaser.GameObjects.Text;
  // Soft black gradient strips along each viewport edge.
  private vignette!: Phaser.GameObjects.Graphics;
  // Corner bracket frame drawn on top of the vignette.
  private screenFrame!: Phaser.GameObjects.Graphics;
  // Prevents a double-click or mash-Enter from racing two fade chains.
  private accepting = true;
  // When true (no-save death relaunch), create() fades this camera up from black.
  private fadeInOnCreate = false;

  // Registers the scene under its stable key (SCENE_KEYS.LANDING).
  constructor() {
    super({ key: SCENE_KEYS.LANDING });
  }

  // Records the optional fadeIn launch flag (true only on a no-save-death relaunch).
  init(data: { fadeIn?: boolean } = {}): void {
    this.fadeInOnCreate = data.fadeIn ?? false;
  }

  // Builds the full title screen — vignette, title, START + secondary banners, frame, inputs.
  create(): void {
    // Phaser reuses the scene instance, so without this re-arm a Quit→relaunch
    // would inherit onStart's `false` and START would silently no-op.
    this.accepting = true;

    // Added first → renders behind everything else in the scene.
    this.vignette = this.add.graphics();

    // LINEAR-filtered so glyphs stay smooth at any window size (overrides global pixelArt config).
    this.titleText = this.add
      .text(0, 0, LANDING_TITLE_TEXT, {
        fontFamily: LANDING_TITLE_FONT_FAMILY,
        fontSize: `${LANDING_TITLE_FONT_SIZE_PX}px`,
        fontStyle: LANDING_TITLE_FONT_WEIGHT,
        color: LANDING_TITLE_COLOR,
      })
      .setOrigin(0.5, 0.5);
    this.titleText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    // Re-render once the real display font is ready in case it baked in the fallback.
    this.refreshTitleFontWhenReady();

    // START word sprite; centered origin so layout positions are its visual center.
    this.startImage = this.add
      .image(0, 0, LANDING_START_TEXTURE_KEY)
      .setOrigin(0.5, 0.5)
      .setScale(LANDING_START_DISPLAY_SCALE);
    this.startImage.setInteractive({ useHandCursor: true });
    this.startImage.on('pointerdown', () => this.onStart());
    this.startImage.on('pointerover', () =>
      this.hoverIn(this.startImage, LANDING_START_DISPLAY_SCALE),
    );
    this.startImage.on('pointerout', () =>
      this.hoverOut(this.startImage, LANDING_START_DISPLAY_SCALE),
    );

    // OPTIONS reuses the pause-menu texture; CREDITS opens the author panel.
    this.optionsImage = this.createMenuButton(PAUSE_OPTIONS_TEXTURE_KEY, () =>
      this.openManual(),
    );
    this.creditsImage = this.createMenuButton(LANDING_CREDITS_TEXTURE_KEY, () =>
      this.openCredits(),
    );

    // Added last → corner brackets render above the vignette and START.
    this.screenFrame = this.add.graphics();
    this.layout();

    // Enter/Space confirm START; scene-scoped so they auto-detach on stop.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', this.onStart, this);
      kb.on('keydown-SPACE', this.onStart, this);
    }

    // Re-layout on resize; the canvas follows the window so START would drift without it.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // No-save-death relaunch: fade the title camera up from black in lockstep with the world.
    if (this.fadeInOnCreate) {
      this.cameras.main.fadeIn(LANDING_FADE_IN_MS, 0, 0, 0);
    }
  }

  // Re-runs layout when the window/canvas resizes.
  private onResize(): void {
    this.layout();
  }

  // Cleans up the resize listener and destroys any open DOM overlays on scene stop.
  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.manualOverlay?.destroy();
    this.manualOverlay = null;
    this.creditsOverlay?.destroy();
    this.creditsOverlay = null;
  }

  // Re-rasterizes the title when the display font loads, in case it baked in the fallback face.
  private refreshTitleFontWhenReady(): void {
    if (!document.fonts) return;
    document.fonts
      .load(`${LANDING_TITLE_FONT_SIZE_PX}px "${DISPLAY_FONT_NAME}"`)
      .then(() => {
        if (!this.titleText || !this.titleText.active) return;
        this.titleText.updateText();
        this.titleText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        this.layout();
      })
      .catch(() => {
        /* Font unavailable (offline first paint, etc.) — keep the fallback. */
      });
  }

  // Positions all display objects against the live viewport and redraws the vignette and frame.
  private layout(): void {
    const { width, height } = this.cameras.main;
    const x = width * LANDING_BUTTON_VIEWPORT_FRACTION_X;
    const startY = height * LANDING_BUTTON_VIEWPORT_FRACTION_Y;
    this.startImage.setPosition(x, startY);
    this.titleText.setPosition(x, height * LANDING_TITLE_VIEWPORT_FRACTION_Y);

    // Use source height × scale (not displayHeight) so hover tween wobble can't perturb spacing.
    const gap = LANDING_MENU_BUTTON_GAP_PX;
    const scale = LANDING_MENU_BUTTON_DISPLAY_SCALE;
    const startHalf = (this.startImage.height * LANDING_START_DISPLAY_SCALE) / 2;
    const optionsHalf = (this.optionsImage.height * scale) / 2;
    const creditsHalf = (this.creditsImage.height * scale) / 2;
    const optionsY = startY + startHalf + gap + optionsHalf;
    this.optionsImage.setPosition(x, optionsY);
    this.creditsImage.setPosition(x, optionsY + optionsHalf + gap + creditsHalf);

    this.drawVignette();
    this.drawScreenFrame();
  }

  // Creates a secondary menu banner (OPTIONS/CREDITS) with hover/press feedback.
  private createMenuButton(
    textureKey: string,
    onActivate: () => void,
  ): Phaser.GameObjects.Image {
    const scale = LANDING_MENU_BUTTON_DISPLAY_SCALE;
    const image = this.add
      .image(0, 0, textureKey)
      .setOrigin(0.5, 0.5)
      .setScale(scale);
    image.setInteractive({ useHandCursor: true });
    image.on('pointerdown', () => {
      this.pressPulse(image, scale);
      onActivate();
    });
    image.on('pointerover', () => this.hoverIn(image, scale));
    image.on('pointerout', () => this.hoverOut(image, scale));
    return image;
  }

  // Plays the hover blip, tints, and eases the sprite up to hover scale.
  private hoverIn(image: Phaser.GameObjects.Image, baseScale: number): void {
    playOneShot(this, UI_BUTTON_HOVER_SOUND_ID);
    image.setTint(LANDING_BUTTON_HOVER_TINT);
    this.tweens.killTweensOf(image);
    this.tweens.add({
      targets: image,
      scaleX: baseScale * LANDING_BUTTON_HOVER_SCALE_MULTIPLIER,
      scaleY: baseScale * LANDING_BUTTON_HOVER_SCALE_MULTIPLIER,
      duration: LANDING_BUTTON_TWEEN_MS,
      ease: 'Sine.easeOut',
    });
  }

  // Clears the tint and eases the sprite back to its base scale.
  private hoverOut(image: Phaser.GameObjects.Image, baseScale: number): void {
    image.clearTint();
    this.tweens.killTweensOf(image);
    this.tweens.add({
      targets: image,
      scaleX: baseScale,
      scaleY: baseScale,
      duration: LANDING_BUTTON_TWEEN_MS,
      ease: 'Sine.easeOut',
    });
  }

  // Brief scale-dip-and-back yoyo so a click reads as physical.
  private pressPulse(image: Phaser.GameObjects.Image, baseScale: number): void {
    this.tweens.killTweensOf(image);
    this.tweens.add({
      targets: image,
      scaleX: baseScale * LANDING_BUTTON_PRESS_SCALE_MULTIPLIER,
      scaleY: baseScale * LANDING_BUTTON_PRESS_SCALE_MULTIPLIER,
      duration: LANDING_BUTTON_TWEEN_MS,
      yoyo: true,
      ease: 'Sine.easeInOut',
    });
  }

  // Draws four gradient black strips along the viewport edges to form the vignette.
  private drawVignette(): void {
    const { width, height } = this.cameras.main;
    const thickness = LANDING_VIGNETTE_THICKNESS_PX;
    const color = LANDING_VIGNETTE_COLOR;
    const a = LANDING_VIGNETTE_EDGE_ALPHA;

    this.vignette.clear();

    // Top: opaque at top edge → transparent at the inner edge.
    this.vignette.fillGradientStyle(color, color, color, color, a, a, 0, 0);
    this.vignette.fillRect(0, 0, width, thickness);

    // Bottom: transparent at the inner edge → opaque at the bottom edge.
    this.vignette.fillGradientStyle(color, color, color, color, 0, 0, a, a);
    this.vignette.fillRect(0, height - thickness, width, thickness);

    // Left: opaque at the left edge → transparent at the inner edge.
    this.vignette.fillGradientStyle(color, color, color, color, a, 0, a, 0);
    this.vignette.fillRect(0, 0, thickness, height);

    // Right: transparent at the inner edge → opaque at the right edge.
    this.vignette.fillGradientStyle(color, color, color, color, 0, a, 0, a);
    this.vignette.fillRect(width - thickness, 0, thickness, height);
  }

  // Draws an L-shaped bracket at each viewport corner (no connecting runs between them).
  private drawScreenFrame(): void {
    const { width, height } = this.cameras.main;
    const margin = LANDING_SCREEN_FRAME_MARGIN_PX;
    const len = LANDING_SCREEN_BRACKET_LENGTH_PX;
    const left = margin;
    const top = margin;
    const right = width - margin;
    const bottom = height - margin;

    this.screenFrame.clear();
    this.screenFrame.lineStyle(
      LANDING_SCREEN_FRAME_STROKE_PX,
      LANDING_SCREEN_FRAME_COLOR,
      1,
    );

    // Top-left: rightward leg + downward leg.
    this.screenFrame.lineBetween(left, top, left + len, top);
    this.screenFrame.lineBetween(left, top, left, top + len);

    // Top-right: leftward leg + downward leg.
    this.screenFrame.lineBetween(right - len, top, right, top);
    this.screenFrame.lineBetween(right, top, right, top + len);

    // Bottom-left: rightward leg + upward leg.
    this.screenFrame.lineBetween(left, bottom, left + len, bottom);
    this.screenFrame.lineBetween(left, bottom - len, left, bottom);

    // Bottom-right: leftward leg + upward leg.
    this.screenFrame.lineBetween(right - len, bottom, right, bottom);
    this.screenFrame.lineBetween(right, bottom - len, right, bottom);
  }

  // Commits START: locks input, fades both cameras to black, then hands off to gameplay.
  private onStart(): void {
    if (!this.accepting) return;
    this.accepting = false;
    // Lock every button so no panel can open over the transition.
    this.startImage.disableInteractive();
    this.optionsImage.disableInteractive();
    this.creditsImage.disableInteractive();

    playOneShot(this, UI_BOOM_SOUND_ID);

    // Press pulse plays concurrently with the fade; fired for keyboard confirms too.
    this.pressPulse(this.startImage, LANDING_START_DISPLAY_SCALE);

    const gameScene = this.scene.get(SCENE_KEYS.GAME) as GameScene;
    const gameCam = gameScene.cameras.main;
    const landingCam = this.cameras.main;

    gameCam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);
    landingCam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);

    landingCam.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => {
        // At full black: stop this scene before GameScene fades its world in so the title can't re-reveal.
        gameScene.beginGameplay();
        this.scene.stop();
      },
    );
  }

  // Opens the How-to-Play manual; disables this scene's keyboard while the panel is up.
  private openManual(): void {
    if (!this.accepting) return;
    if (this.manualOverlay?.isOpen() || this.creditsOverlay?.isOpen()) return;
    if (!this.manualOverlay) {
      this.manualOverlay = new ManualOverlay(this.overlayParent(), this);
    }
    this.setKeyboardEnabled(false);
    this.manualOverlay.open({ onClose: () => this.reenableKeyboardNextTick() });
  }

  // Opens the credits panel; same guards and keyboard handling as openManual.
  private openCredits(): void {
    if (!this.accepting) return;
    if (this.manualOverlay?.isOpen() || this.creditsOverlay?.isOpen()) return;
    if (!this.creditsOverlay) {
      this.creditsOverlay = new CreditsOverlay(this.overlayParent());
    }
    this.setKeyboardEnabled(false);
    this.creditsOverlay.open({ onClose: () => this.reenableKeyboardNextTick() });
  }

  // Returns the canvas parent for overlay attachment, falling back to body.
  private overlayParent(): HTMLElement {
    return this.game.canvas.parentElement ?? document.body;
  }

  // Enables/disables this scene's keyboard input (no-op if there is no keyboard).
  private setKeyboardEnabled(enabled: boolean): void {
    if (this.input.keyboard) this.input.keyboard.enabled = enabled;
  }

  // Re-enable on the next tick so the same ESC/click that closed the panel
  // isn't also handled by this scene's Start binding this frame.
  private reenableKeyboardNextTick(): void {
    this.time.delayedCall(0, () => this.setKeyboardEnabled(true));
  }
}
