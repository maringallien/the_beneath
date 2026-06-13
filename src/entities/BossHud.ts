import Phaser from 'phaser';
import {
  BOSS_BANNER_COLOR,
  BOSS_BANNER_DEPTH,
  BOSS_BANNER_FADE_IN_MS,
  BOSS_BANNER_FADE_OUT_MS,
  BOSS_BANNER_FONT_FAMILY,
  BOSS_BANNER_FONT_SIZE_PX,
  BOSS_BANNER_FONT_WEIGHT,
  BOSS_BANNER_HOLD_MS,
  BOSS_BANNER_STROKE_COLOR,
  BOSS_BANNER_STROKE_PX,
  BOSS_BANNER_VIEWPORT_FRACTION_Y,
  BOSS_BAR_BG_ALPHA,
  BOSS_BAR_BG_COLOR,
  BOSS_BAR_DIVIDER_COLOR,
  BOSS_BAR_DIVIDER_WIDTH_PX,
  BOSS_BAR_FRAME_COLOR,
  BOSS_BAR_FRAME_STROKE_PX,
  BOSS_BAR_HEIGHT_PX,
  BOSS_BAR_NAME_COLOR,
  BOSS_BAR_NAME_FONT_FAMILY,
  BOSS_BAR_NAME_FONT_SIZE_PX,
  BOSS_BAR_NAME_GAP_PX,
  BOSS_BAR_ROUND_COLORS,
  BOSS_BAR_TOP_MARGIN_PX,
  BOSS_BAR_WIDTH_FRACTION,
  BOSS_HUD_DEPTH,
  CAMERA_ZOOM,
} from '../constants';

/**
 * BossHud — the screen-pinned boss-fight overlay (segmented bar + name + banner).
 *
 * Draws a segmented health bar with the boss name across the top of the
 * viewport plus a transient "Round N" banner. Owned by the game scene and
 * driven from the main camera's PRE_RENDER event like the player HUD: positions
 * are authored in screen pixels and converted to world space at the camera's
 * zoom each frame, so they stay pinned under camera scroll and render crisply
 * at zoom (text resolution is set to CAMERA_ZOOM). Kept separate from the player
 * HUD because it has its own lifecycle (visible only mid-boss-fight) and the
 * banner concern. The bar starts hidden; setVisible toggles it.
 *
 * Inputs:  a BossHudState + the main camera each frame (name, HP ratio, round).
 * Outputs: the bar graphics, the name text, and the round-banner tween.
 * @calledby the boss-fight HUD driver, each render frame while a boss is engaged.
 * @calls    Phaser graphics/text + tween primitives for the bar and banner.
 */
export interface BossHudState {
  // Display name shown above the bar.
  readonly name: string;
  // Remaining HP as a fraction in [0, 1].
  readonly ratio: number;
  // Current 1-based round; selects the fill color.
  readonly round: number;
  // Number of equal sections (== round count); drives the dividers.
  readonly sections: number;
}

export class BossHud {
  private readonly scene: Phaser.Scene;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  // recreated per showRound; torn down on complete, supersede, or hide
  private banner: Phaser.GameObjects.Text | null = null;
  private bannerTween: Phaser.Tweens.TweenChain | null = null;
  private visible = false;
  // dedup to avoid re-rasterizing glyphs every tick
  private lastName = '';

  // create bar graphics and name text hidden; banner is created on demand per round
  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.bar = scene.add.graphics();
    this.bar.setDepth(BOSS_HUD_DEPTH);
    this.bar.setVisible(false);

    this.nameText = scene.add.text(0, 0, '', {
      fontFamily: BOSS_BAR_NAME_FONT_FAMILY,
      fontSize: `${BOSS_BAR_NAME_FONT_SIZE_PX}px`,
      color: BOSS_BAR_NAME_COLOR,
    });
    this.nameText.setOrigin(0.5, 0);
    this.nameText.setDepth(BOSS_HUD_DEPTH);
    this.nameText.setResolution(CAMERA_ZOOM);
    this.nameText.setVisible(false);
  }

  // show/hide the bar and name; hiding also clears graphics and tears down any live banner
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.bar.setVisible(visible);
    this.nameText.setVisible(visible);
    if (!visible) {
      this.bar.clear();
      this.clearBanner();
    }
  }

  // show the "Round N" banner with a fade-in→hold→fade-out tween; replaces any live banner
  showRound(round: number): void {
    this.clearBanner();

    const banner = this.scene.add.text(0, 0, `Round ${round}`, {
      fontFamily: BOSS_BANNER_FONT_FAMILY,
      fontSize: `${BOSS_BANNER_FONT_SIZE_PX}px`,
      fontStyle: BOSS_BANNER_FONT_WEIGHT,
      color: BOSS_BANNER_COLOR,
      stroke: BOSS_BANNER_STROKE_COLOR,
      strokeThickness: BOSS_BANNER_STROKE_PX,
    });
    banner.setOrigin(0.5, 0.5);
    banner.setDepth(BOSS_BANNER_DEPTH);
    banner.setResolution(CAMERA_ZOOM);
    banner.setAlpha(0);
    banner.setScale(0.85);
    this.banner = banner;

    this.bannerTween = this.scene.tweens.chain({
      targets: banner,
      tweens: [
        {
          alpha: 1,
          scale: 1,
          duration: BOSS_BANNER_FADE_IN_MS,
          ease: 'Back.easeOut',
        },
        { alpha: 1, duration: BOSS_BANNER_HOLD_MS },
        {
          alpha: 0,
          scale: 1.08,
          duration: BOSS_BANNER_FADE_OUT_MS,
          ease: 'Sine.easeIn',
        },
      ],
      onComplete: () => this.clearBanner(),
    });
  }

  // reposition and redraw the overlay each frame, pinned to screen coords via the camera
  update(state: BossHudState, camera: Phaser.Cameras.Scene2D.Camera): void {
    if (!this.visible) return;

    const halfW = camera.width * 0.5;
    const halfH = camera.height * 0.5;
    const zoom = camera.zoom;
    const midX = camera.midPoint.x;
    const midY = camera.midPoint.y;
    const toWorldX = (screenX: number): number => midX + (screenX - halfW) / zoom;
    const toWorldY = (screenY: number): number => midY + (screenY - halfH) / zoom;
    const worldLen = (screenPx: number): number => screenPx / zoom;
    const centerScreenX = camera.width * 0.5;

    if (state.name !== this.lastName) {
      this.nameText.setText(state.name);
      this.lastName = state.name;
    }
    this.nameText.setPosition(
      toWorldX(centerScreenX),
      toWorldY(BOSS_BAR_TOP_MARGIN_PX),
    );

    const nameScreenHeight = this.nameText.displayHeight * zoom;
    const barTopScreen =
      BOSS_BAR_TOP_MARGIN_PX + nameScreenHeight + BOSS_BAR_NAME_GAP_PX;
    const barWidthScreen = camera.width * BOSS_BAR_WIDTH_FRACTION;
    const barLeftScreen = (camera.width - barWidthScreen) * 0.5;

    const x = toWorldX(barLeftScreen);
    const y = toWorldY(barTopScreen);
    const w = worldLen(barWidthScreen);
    const h = worldLen(BOSS_BAR_HEIGHT_PX);

    this.drawBar(x, y, w, h, state, zoom);

    if (this.banner) {
      this.banner.setPosition(
        toWorldX(centerScreenX),
        toWorldY(camera.height * BOSS_BANNER_VIEWPORT_FRACTION_Y),
      );
    }
  }

  // Tear down the banner, bar, and name text (scene shutdown / HUD teardown).
  destroy(): void {
    this.clearBanner();
    this.bar.destroy();
    this.nameText.destroy();
  }

  // draw the segmented bar: grey bg, round-colored fill, dividers, outer frame
  private drawBar(
    x: number,
    y: number,
    w: number,
    h: number,
    state: BossHudState,
    zoom: number,
  ): void {
    const g = this.bar;
    g.clear();

    g.fillStyle(BOSS_BAR_BG_COLOR, BOSS_BAR_BG_ALPHA);
    g.fillRect(x, y, w, h);

    const ratio = state.ratio < 0 ? 0 : state.ratio > 1 ? 1 : state.ratio;
    const colors = BOSS_BAR_ROUND_COLORS;
    const colorIdx = Math.min(Math.max(state.round - 1, 0), colors.length - 1);
    const fillWidth = w * ratio;
    if (fillWidth > 0) {
      g.fillStyle(colors[colorIdx], 1);
      g.fillRect(x, y, fillWidth, h);
    }

    // stroke widths are ÷zoom so they render at ~constant screen thickness
    if (state.sections > 1) {
      g.lineStyle(BOSS_BAR_DIVIDER_WIDTH_PX / zoom, BOSS_BAR_DIVIDER_COLOR, 1);
      for (let i = 1; i < state.sections; i += 1) {
        const dividerX = x + (w * i) / state.sections;
        g.lineBetween(dividerX, y, dividerX, y + h);
      }
    }

    g.lineStyle(BOSS_BAR_FRAME_STROKE_PX / zoom, BOSS_BAR_FRAME_COLOR, 1);
    g.strokeRect(x, y, w, h);
  }

  // Stop + destroy the live banner tween and text, if any (idempotent).
  private clearBanner(): void {
    if (this.bannerTween) {
      this.bannerTween.stop();
      this.bannerTween.destroy();
      this.bannerTween = null;
    }
    if (this.banner) {
      this.banner.destroy();
      this.banner = null;
    }
  }
}
