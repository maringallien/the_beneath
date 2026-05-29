import Phaser from 'phaser';
import {
  LANDING_BUTTON_HOVER_SCALE_MULTIPLIER,
  LANDING_BUTTON_HOVER_TINT,
  LANDING_BUTTON_PRESS_SCALE_MULTIPLIER,
  LANDING_BUTTON_TWEEN_MS,
  LANDING_BUTTON_VIEWPORT_FRACTION_X,
  LANDING_BUTTON_VIEWPORT_FRACTION_Y,
  LANDING_FADE_IN_MS,
  LANDING_FADE_OUT_MS,
  LANDING_SCREEN_BRACKET_LENGTH_PX,
  LANDING_SCREEN_FRAME_COLOR,
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
  SCENE_KEYS,
} from '../constants';
import type { GameScene } from './GameScene';

// First-boot landing overlay launched on top of GameScene. Renders the
// START word sprite inside a white bounding box at the right side of the
// viewport; the GameScene side of the same flow holds its camera so the
// player sits on the left. Clicking the button (or pressing Enter/Space)
// fades both scene cameras to black, calls GameScene.beginGameplay() at
// the midpoint, then fades back in and stops this scene.
export class LandingScene extends Phaser.Scene {
  private startImage!: Phaser.GameObjects.Image;
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

  constructor() {
    super({ key: SCENE_KEYS.LANDING });
  }

  create(): void {
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

    this.startImage = this.add
      .image(0, 0, LANDING_START_TEXTURE_KEY)
      .setOrigin(0.5, 0.5)
      .setScale(LANDING_START_DISPLAY_SCALE);
    this.startImage.setInteractive({ useHandCursor: true });
    this.startImage.on('pointerdown', () => this.onStart());
    this.startImage.on('pointerover', () => this.onHoverIn());
    this.startImage.on('pointerout', () => this.onHoverOut());

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
  }

  private onResize(): void {
    this.layout();
  }

  private onShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }

  // Positions the START sprite at LANDING_BUTTON_VIEWPORT_FRACTION_X across
  // the viewport (canvas pixels — this scene's camera has no zoom applied),
  // then re-draws the bounding-box frame around the new bounds.
  private layout(): void {
    const { width, height } = this.cameras.main;
    this.startImage.setPosition(
      width * LANDING_BUTTON_VIEWPORT_FRACTION_X,
      height * LANDING_BUTTON_VIEWPORT_FRACTION_Y,
    );
    // Title shares the START button's X column so they stack visually.
    this.titleText.setPosition(
      width * LANDING_BUTTON_VIEWPORT_FRACTION_X,
      height * LANDING_TITLE_VIEWPORT_FRACTION_Y,
    );
    this.drawVignette();
    this.drawScreenFrame();
  }

  // Hover-in: tint + ease the sprite slightly outward. killTweensOf
  // clears any in-flight hover-out so rapid pointer movements don't pile
  // up conflicting scale tweens on the same target.
  private onHoverIn(): void {
    this.startImage.setTint(LANDING_BUTTON_HOVER_TINT);
    this.tweens.killTweensOf(this.startImage);
    this.tweens.add({
      targets: this.startImage,
      scaleX: LANDING_START_DISPLAY_SCALE * LANDING_BUTTON_HOVER_SCALE_MULTIPLIER,
      scaleY: LANDING_START_DISPLAY_SCALE * LANDING_BUTTON_HOVER_SCALE_MULTIPLIER,
      duration: LANDING_BUTTON_TWEEN_MS,
      ease: 'Sine.easeOut',
    });
  }

  // Hover-out: clear tint + ease the sprite back to its base scale.
  private onHoverOut(): void {
    this.startImage.clearTint();
    this.tweens.killTweensOf(this.startImage);
    this.tweens.add({
      targets: this.startImage,
      scaleX: LANDING_START_DISPLAY_SCALE,
      scaleY: LANDING_START_DISPLAY_SCALE,
      duration: LANDING_BUTTON_TWEEN_MS,
      ease: 'Sine.easeOut',
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

  // Click / Enter / Space → fade out (both cameras) → hand off to GameScene
  // → fade in → stop self. Both cameras must fade together: the GameScene
  // camera carries the world, this scene's camera carries the START button
  // and frame. Driving from a single FADE_OUT_COMPLETE listener on the
  // landing camera keeps the two fades synchronized — they share a duration
  // so the other camera completes its fade by the same frame.
  private onStart(): void {
    if (!this.accepting) return;
    this.accepting = false;
    this.startImage.disableInteractive();

    // Press pulse — brief inward dip then back, runs concurrently with
    // the fade so the click feels physical even before the fade begins.
    // Triggered for keyboard activations too so Enter/Space confirm
    // gets the same kinetic feedback as a mouse click.
    this.tweens.killTweensOf(this.startImage);
    this.tweens.add({
      targets: this.startImage,
      scaleX: LANDING_START_DISPLAY_SCALE * LANDING_BUTTON_PRESS_SCALE_MULTIPLIER,
      scaleY: LANDING_START_DISPLAY_SCALE * LANDING_BUTTON_PRESS_SCALE_MULTIPLIER,
      duration: LANDING_BUTTON_TWEEN_MS,
      yoyo: true,
      ease: 'Sine.easeInOut',
    });

    const gameScene = this.scene.get(SCENE_KEYS.GAME) as GameScene;
    const gameCam = gameScene.cameras.main;
    const landingCam = this.cameras.main;

    gameCam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);
    landingCam.fadeOut(LANDING_FADE_OUT_MS, 0, 0, 0);

    landingCam.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => {
        // Under the black, switch the GameScene from the landing-page
        // freeze to live gameplay: HUD appears, ambience kicks in, camera
        // follow resumes, controls re-enable. The user sees none of this
        // because the fade-out has just landed at full black.
        gameScene.beginGameplay();
        // Stop the landing scene before fading the game in — otherwise
        // the landing camera's fade-in would re-reveal the START button,
        // title, and frame while the game world is also fading in.
        this.scene.stop();
        gameCam.fadeIn(LANDING_FADE_IN_MS, 0, 0, 0);
      },
    );
  }
}
