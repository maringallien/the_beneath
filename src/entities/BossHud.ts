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

// Screen-pinned boss-fight overlay: a segmented health bar with the boss name
// across the top of the viewport, plus a transient "Round N" banner. Owned by
// GameScene and driven from the main camera's PRE_RENDER event, exactly like
// PlayerHud — positions are authored in screen pixels and converted to world
// space at CAMERA_ZOOM each frame so they stay pinned under camera scroll and
// render crisply at zoom. Kept separate from PlayerHud because it has its own
// lifecycle (only visible mid-boss-fight) and its own banner concern.
export class BossHud {
  private readonly scene: Phaser.Scene;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  // Live banner + its animation. Recreated per showRound and torn down when it
  // finishes, when a new round supersedes it, or when the HUD hides.
  private banner: Phaser.GameObjects.Text | null = null;
  private bannerTween: Phaser.Tweens.TweenChain | null = null;
  private visible = false;
  // Dedup so we only rewrite the name texture when it actually changes (a
  // per-frame setText would re-rasterize the glyphs every tick).
  private lastName = '';

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
    // Top-center anchor: the name's top sits at the screen margin and it
    // centers over the bar.
    this.nameText.setOrigin(0.5, 0);
    this.nameText.setDepth(BOSS_HUD_DEPTH);
    this.nameText.setResolution(CAMERA_ZOOM);
    this.nameText.setVisible(false);
  }

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

  // Spawns (or replaces) the "Round N" banner and runs its fade-in → hold →
  // fade-out animation. Position is set by update() each frame so the banner
  // stays screen-centered while the camera follows the player. The animation
  // length matches BOSS_ROUND_BREAK_MS so it clears as the boss un-freezes.
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

    // Name — top-center at the screen margin.
    if (state.name !== this.lastName) {
      this.nameText.setText(state.name);
      this.lastName = state.name;
    }
    this.nameText.setPosition(
      toWorldX(centerScreenX),
      toWorldY(BOSS_BAR_TOP_MARGIN_PX),
    );

    // Bar — centered, sitting just below the name. The name's world height
    // scaled by zoom gives its screen footprint, so the bar trails it by a
    // fixed screen gap regardless of zoom.
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

    // Keep the banner centered while it animates (the tween drives alpha +
    // scale, not position, so there's no conflict).
    if (this.banner) {
      this.banner.setPosition(
        toWorldX(centerScreenX),
        toWorldY(camera.height * BOSS_BANNER_VIEWPORT_FRACTION_Y),
      );
    }
  }

  destroy(): void {
    this.clearBanner();
    this.bar.destroy();
    this.nameText.destroy();
  }

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

    // Background (the drained portion stays visible behind the fill).
    g.fillStyle(BOSS_BAR_BG_COLOR, BOSS_BAR_BG_ALPHA);
    g.fillRect(x, y, w, h);

    // Fill — anchored left, shrinking from the right as HP drops. Color is
    // selected by the current round so the bar visibly shifts each section.
    const ratio = state.ratio < 0 ? 0 : state.ratio > 1 ? 1 : state.ratio;
    const colors = BOSS_BAR_ROUND_COLORS;
    const colorIdx = Math.min(Math.max(state.round - 1, 0), colors.length - 1);
    const fillWidth = w * ratio;
    if (fillWidth > 0) {
      g.fillStyle(colors[colorIdx], 1);
      g.fillRect(x, y, fillWidth, h);
    }

    // Section dividers at each 1/sections mark. Stroke widths are converted
    // from screen px to world units (÷zoom) so they render ~constant on screen.
    if (state.sections > 1) {
      g.lineStyle(BOSS_BAR_DIVIDER_WIDTH_PX / zoom, BOSS_BAR_DIVIDER_COLOR, 1);
      for (let i = 1; i < state.sections; i += 1) {
        const dividerX = x + (w * i) / state.sections;
        g.lineBetween(dividerX, y, dividerX, y + h);
      }
    }

    // Outer frame.
    g.lineStyle(BOSS_BAR_FRAME_STROKE_PX / zoom, BOSS_BAR_FRAME_COLOR, 1);
    g.strokeRect(x, y, w, h);
  }

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
