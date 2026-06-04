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
import { OptionsOverlay } from '../ui/OptionsOverlay';
import type { GameScene } from './GameScene';

// First-boot landing overlay launched on top of GameScene. Renders the
// START word sprite inside a white bounding box at the right side of the
// viewport, with OPTIONS and CREDITS banners stacked beneath it; the GameScene
// side of the same flow holds its camera so the player sits on the left.
// Clicking START (or pressing Enter/Space) fades both scene cameras to black,
// then at full black hands off to GameScene.beginGameplay() and stops this
// scene; GameScene holds the black for a beat and fades the world + HUD back
// in. OPTIONS opens the shared controls/audio panel (OptionsOverlay, same as
// the pause menu) and CREDITS opens a short title + author panel.
export class LandingScene extends Phaser.Scene {
  private startImage!: Phaser.GameObjects.Image;
  // Secondary menu banners stacked under START, positioned in layout().
  private optionsImage!: Phaser.GameObjects.Image;
  private creditsImage!: Phaser.GameObjects.Image;
  // DOM overlays, created lazily on first open and reused thereafter. Destroyed
  // in onShutdown if either is still open when the scene stops.
  private optionsOverlay: OptionsOverlay | null = null;
  private creditsOverlay: CreditsOverlay | null = null;
  private titleText!: Phaser.GameObjects.Text;
  // Soft black gradient strips along each viewport edge, drawn beneath
  // the START button and screen frame so it darkens the world only.
  private vignette!: Phaser.GameObjects.Graphics;
  // Decorated rectangle that wraps the whole viewport, drawn on top of
  // the vignette so its stroke and corner accents stay legible.
  private screenFrame!: Phaser.GameObjects.Graphics;
  // Guards against a double-click / mash-enter racing two fade chains.
  // Cleared by onStart on the first activation; the scene stops shortly
  // after the fade-in completes so resetting it is unnecessary.
  private accepting = true;
  // Set from launch data by init(). When the home screen is reached via a
  // no-save death (GameScene fades the dying world out, then relaunches this
  // scene), create() fades this camera up from black so the title reveals in
  // lockstep with the world behind it. First boot and Quit pass nothing, so it
  // stays false and the title snaps on as before.
  private fadeInOnCreate = false;

  constructor() {
    super({ key: SCENE_KEYS.LANDING });
  }

  // Captures the launch-data payload from scene.launch(LANDING, data). Defaults
  // keep the title snapping on instantly when no data is passed (first boot,
  // Quit / Return to Title).
  init(data: { fadeIn?: boolean } = {}): void {
    this.fadeInOnCreate = data.fadeIn ?? false;
  }

  create(): void {
    // Reset the activation guard on every create(). Phaser reuses the scene
    // instance, so when Quit relaunches LandingScene this field still holds the
    // `false` left by the previous run's onStart — without this reset the START
    // button would silently no-op the second time the home screen is shown.
    this.accepting = true;

    // Vignette goes in first so it sits behind everything else added in
    // this scene. Phaser draws scene display-list entries in insertion
    // order, so the START button + screen frame added below render on top.
    this.vignette = this.add.graphics();

    // Word sprite sized via setScale so the source pixel grid scales
    // uniformly. Origin centered for easier layout math — positions are
    // the visual center of the START banner.
    // Game title above the START button. LINEAR-filtered so the
    // rasterized glyphs stay smooth at any window size instead of being
    // nearest-sampled by the global pixelArt:true config.
    this.titleText = this.add
      .text(0, 0, LANDING_TITLE_TEXT, {
        fontFamily: LANDING_TITLE_FONT_FAMILY,
        fontSize: `${LANDING_TITLE_FONT_SIZE_PX}px`,
        fontStyle: LANDING_TITLE_FONT_WEIGHT,
        color: LANDING_TITLE_COLOR,
      })
      .setOrigin(0.5, 0.5);
    this.titleText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    // Phaser rasterizes the title to a texture at creation, so if the
    // (self-hosted) display font hasn't finished loading yet the title bakes in
    // the fallback face. Re-apply the family once the font is ready to force a
    // re-render with the real glyphs.
    this.refreshTitleFontWhenReady();

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

    // OPTIONS + CREDITS stacked beneath START (positioned in layout()). They
    // share START's hover/press feedback at a smaller base scale so the primary
    // action stays dominant. OPTIONS reuses the pause menu's word texture and
    // its OptionsOverlay; CREDITS opens the title/author panel.
    this.optionsImage = this.createMenuButton(PAUSE_OPTIONS_TEXTURE_KEY, () =>
      this.openOptions(),
    );
    this.creditsImage = this.createMenuButton(LANDING_CREDITS_TEXTURE_KEY, () =>
      this.openCredits(),
    );

    // Screen-edge corner brackets added last so they render above the
    // vignette and the START button.
    this.screenFrame = this.add.graphics();
    this.layout();

    // Keyboard accessibility mirrors PauseScene — Enter or Space confirms
    // the only action on screen. Scene-scoped listeners auto-detach on
    // scene.stop(), no manual cleanup needed.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ENTER', this.onStart, this);
      kb.on('keydown-SPACE', this.onStart, this);
    }

    // Re-layout on window resize so the button stays anchored to the right
    // edge of the viewport. gameConfig uses Phaser.Scale.RESIZE, so the
    // canvas dimensions follow window size; without this the START button
    // drifts off its target column on a window stretch.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // Reached via a no-save death: fade this camera (title + button + frame) up
    // from black so it reveals together with the world GameScene is fading in.
    // Set here on the freshly-booted scene so the camera definitely exists and
    // the first rendered frame is already black — no pop of the title.
    if (this.fadeInOnCreate) {
      this.cameras.main.fadeIn(LANDING_FADE_IN_MS, 0, 0, 0);
    }
  }

  private onResize(): void {
    this.layout();
  }

  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    // Drop either DOM panel + its window listener if it's still open when the
    // scene stops (e.g. Start committed while a panel was up), so it can't
    // outlive the scene.
    this.optionsOverlay?.destroy();
    this.optionsOverlay = null;
    this.creditsOverlay?.destroy();
    this.creditsOverlay = null;
  }

  // Safety net for the case where the title was rasterized before Nosifer
  // finished loading (PreloadScene's boot gate normally prevents this, but a
  // load that misses the FONT_BOOT_TIMEOUT_MS window can still slip through).
  // Once the font is ready we force a re-rasterization with the real glyphs and
  // re-center, since the metrics change.
  //
  // We canNOT just re-call setFontFamily(LANDING_TITLE_FONT_FAMILY): Phaser's
  // TextStyle.setFontFamily short-circuits when the family string is unchanged
  // (it was already set at creation), so that path never redraws. updateText()
  // re-syncs the font and redraws the texture unconditionally.
  //
  // No-op if the Font Loading API is unavailable or the font fails to load —
  // the fallback render already shown then just stays.
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

  // Positions the START sprite at LANDING_BUTTON_VIEWPORT_FRACTION_X across
  // the viewport (canvas pixels — this scene's camera has no zoom applied),
  // stacks OPTIONS then CREDITS beneath it, then re-draws the frame.
  private layout(): void {
    const { width, height } = this.cameras.main;
    const x = width * LANDING_BUTTON_VIEWPORT_FRACTION_X;
    const startY = height * LANDING_BUTTON_VIEWPORT_FRACTION_Y;
    this.startImage.setPosition(x, startY);
    // Title shares the START button's X column so they stack visually.
    this.titleText.setPosition(x, height * LANDING_TITLE_VIEWPORT_FRACTION_Y);

    // Stack OPTIONS then CREDITS below START, each centered on the same column.
    // Heights are derived from the source frame height × base scale rather than
    // displayHeight so an in-flight hover tween (which momentarily changes the
    // live scale) can't perturb the stacked spacing.
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

  // Builds one of the secondary menu banners (OPTIONS / CREDITS): a smaller
  // word sprite that shares START's hover/press feedback. onActivate fires on
  // click alongside a press pulse for the same kinetic confirm START gets.
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

  // Hover-in: tint + ease the sprite slightly outward from its base scale.
  // killTweensOf clears any in-flight hover-out so rapid pointer movements
  // don't pile up conflicting scale tweens on the same target.
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

  // Hover-out: clear tint + ease the sprite back to its base scale.
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

  // Press pulse — a brief inward dip then back to base scale, so a click feels
  // physical. Shared by START (on commit) and the OPTIONS/CREDITS buttons.
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

  // Four black gradient strips along the viewport edges, each fading from
  // LANDING_VIGNETTE_EDGE_ALPHA at the outside edge to 0 at THICKNESS_PX
  // inward. Corners get a double dose where adjacent strips overlap, which
  // reads naturally as a slightly stronger vignette in the corners.
  // Uses fillGradientStyle's per-corner alpha overload (Phaser WebGL).
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

  // L-shaped brackets at each viewport corner — two perpendicular line
  // segments meeting at the corner vertex, no connecting strokes between
  // corners. Frames the shot without imposing a full rectangle.
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

  // Click / Enter / Space → fade out (both cameras) → at full black hand off to
  // GameScene → stop self (GameScene owns the black hold + world/HUD fade-in).
  // Both cameras must fade together: the GameScene camera carries the world,
  // this scene's camera carries the START button and frame. Driving from a
  // single FADE_OUT_COMPLETE listener on the landing camera keeps the two fades
  // synchronized — they share a duration so the other camera completes its fade
  // by the same frame.
  private onStart(): void {
    if (!this.accepting) return;
    this.accepting = false;
    // Lock out every button for the fade-out: START hands off to gameplay, and
    // the secondary banners must not open a panel over the transition.
    this.startImage.disableInteractive();
    this.optionsImage.disableInteractive();
    this.creditsImage.disableInteractive();

    // Heavy impact stinger the moment Start is committed (click or
    // Enter/Space). playOneShot uses the game-global sound manager, so it
    // carries through this scene's stop() and the fade-out into gameplay.
    playOneShot(this, UI_BOOM_SOUND_ID);

    // Press pulse — brief inward dip then back, runs concurrently with
    // the fade so the click feels physical even before the fade begins.
    // Triggered for keyboard activations too so Enter/Space confirm
    // gets the same kinetic feedback as a mouse click.
    this.pressPulse(this.startImage, LANDING_START_DISPLAY_SCALE);

    const gameScene = this.scene.get(SCENE_KEYS.GAME) as GameScene;
    const gameCam = gameScene.cameras.main;
    const landingCam = this.cameras.main;

    gameCam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);
    landingCam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);

    landingCam.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => {
        // Now at full black. Hand off to GameScene, which performs the deferred
        // gameplay setup under the black, holds the darkness for a dramatic
        // beat, then fades the world and HUD in together. Stop this scene first
        // so its camera's frame + START button can't re-reveal during that
        // fade-in — only GameScene's camera should come back up.
        gameScene.beginGameplay();
        this.scene.stop();
      },
    );
  }

  // OPTIONS → open the shared controls/audio panel (same OptionsOverlay the
  // pause menu uses). Mirrors PauseScene.openOptions: while the panel is up this
  // scene's keyboard is disabled so its Enter/Space → Start binding can't fire
  // underneath, and the full-viewport backdrop blocks clicks to the buttons.
  private openOptions(): void {
    if (!this.accepting) return;
    if (this.optionsOverlay?.isOpen() || this.creditsOverlay?.isOpen()) return;
    if (!this.optionsOverlay) {
      this.optionsOverlay = new OptionsOverlay(this.overlayParent());
    }
    this.setKeyboardEnabled(false);
    this.optionsOverlay.open({ onClose: () => this.reenableKeyboardNextTick() });
  }

  // CREDITS → open the title/author panel (CreditsOverlay). Same input handling
  // as openOptions.
  private openCredits(): void {
    if (!this.accepting) return;
    if (this.optionsOverlay?.isOpen() || this.creditsOverlay?.isOpen()) return;
    if (!this.creditsOverlay) {
      this.creditsOverlay = new CreditsOverlay(this.overlayParent());
    }
    this.setKeyboardEnabled(false);
    this.creditsOverlay.open({ onClose: () => this.reenableKeyboardNextTick() });
  }

  // The DOM node the overlays attach to: the canvas's parent (the #game
  // container) so they layer directly over the rendered scene, falling back to
  // <body> if the canvas isn't parented for some reason.
  private overlayParent(): HTMLElement {
    return this.game.canvas.parentElement ?? document.body;
  }

  private setKeyboardEnabled(enabled: boolean): void {
    if (this.input.keyboard) this.input.keyboard.enabled = enabled;
  }

  // Re-enable on the next tick so the same ESC/click that closed the panel
  // isn't also handled by this scene's Start binding this frame.
  private reenableKeyboardNextTick(): void {
    this.time.delayedCall(0, () => this.setKeyboardEnabled(true));
  }
}
