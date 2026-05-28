import Phaser from 'phaser';
import {
  CAMERA_ZOOM,
  PLAYER_HUD_DEPTH,
  PLAYER_HUD_LABEL_COLOR,
  PLAYER_HUD_LABEL_CONTENT_GAP_WORLD_UNITS,
  PLAYER_HUD_LABEL_FONT_FAMILY,
  PLAYER_HUD_LABEL_FONT_SIZE_PX,
  PLAYER_HUD_LEFT_BAR_INDENT_WORLD_UNITS,
  PLAYER_HUD_ORIGIN_X_PX,
  PLAYER_HUD_ORIGIN_Y_PX,
  PLAYER_HUD_ROW_PITCH_PX,
  PLAYER_HUD_SMALL_LABEL_FONT_SIZE_PX,
  PLAYER_HUD_STA_MAG_PITCH_PX,
} from '../constants';

export interface PlayerHudValues {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly magic: number;
  readonly maxMagic: number;
  readonly gun1Ammo: number;
  readonly maxGun1Ammo: number;
  readonly gun2Ammo: number;
  readonly maxGun2Ammo: number;
}

// sliders.png row 0 frame indices (0..9). Phaser's spritesheet flattens the
// 15×3 cell grid into a single frame array; row 0 starts at frame 0 and the
// useful cells are 0..9 (cells 10..14 are blank in the source PNG).
const HP_SLIDER_FRAME_COUNT = 10;
// HP sprite source dims (33x16) are bigger than the visible bar inside the
// frame; this scale lands it at a readable HUD size and is 30% larger than
// the previous 0.6 baseline per user request.
const HP_SLIDER_SCALE = 0.78;
// Stamina and magic are both authored as 23×3 segmented strips. Native scale
// keeps them compact in the horizontal layout (previously stamina was 2x
// stretched vertically; per user the bars should display at half the size).
const STA_SPRITE_SCALE = 1;
const MAG_SPRITE_SCALE = 1;

// Ammo icons: hud_ammo spritesheet is a 6×3 grid of 16×16 tiles.
// Frame 0 (top-left) = pistol bullet for G1; frame 12 (row 2, col 0) =
// shotgun shell for G2. Scaled to match HP row visual height.
const AMMO_ICON_SCALE = 0.6;
const GUN1_ICON_FRAME = 0;
const GUN2_ICON_FRAME = 12;
// World-unit gap between the icon's right edge and the count text. With
// CAMERA_ZOOM=3 this renders as ~3 canvas pixels.
const AMMO_COUNT_GAP_WORLD_UNITS = 1;
// Icon alpha when the player is out of ammo for that gun. Dims rather than
// hides so the player still knows which slot is which.
const AMMO_EMPTY_ICON_ALPHA = 0.35;
const AMMO_FULL_ICON_ALPHA = 1;

// Bounding-frame style. Stroke width and padding are in world units; with
// CAMERA_ZOOM=3 a stroke of 1 renders as 3 canvas pixels. Corner accents are
// small filled squares sitting just outside each corner of the outer stroke —
// same visual idiom as the pause menu's bounding box.
const FRAME_COLOR = 0xffffff;
const FRAME_STROKE_WORLD = 1;
const FRAME_PADDING_WORLD = 2;
const FRAME_CORNER_ACCENT_SIZE_WORLD = 1.5;
// Distance from the outer rect's corner to the center of the corner accent
// square (world units). Slightly larger than the accent's half-size so a
// gap separates the accent from the outer stroke.
const FRAME_CORNER_ACCENT_OFFSET_WORLD = 1.5;

interface AssetBarRow {
  readonly kind: 'asset';
  readonly sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
}

interface IconCountRow {
  readonly kind: 'iconcount';
  readonly icon: Phaser.GameObjects.Sprite;
  readonly count: Phaser.GameObjects.Text;
  readonly label: Phaser.GameObjects.Text;
  lastCount: number;
}

type BarRow = AssetBarRow | IconCountRow;

function safeRatio(current: number, max: number): number {
  if (max <= 0) return 0;
  return Phaser.Math.Clamp(current / max, 0, 1);
}

function makeText(
  scene: Phaser.Scene,
  text: string,
  fontSizePx: number = PLAYER_HUD_LABEL_FONT_SIZE_PX,
): Phaser.GameObjects.Text {
  const obj = scene.add.text(0, 0, text, {
    fontFamily: PLAYER_HUD_LABEL_FONT_FAMILY,
    fontSize: `${fontSizePx}px`,
    color: PLAYER_HUD_LABEL_COLOR,
  });
  obj.setOrigin(0, 0);
  obj.setDepth(PLAYER_HUD_DEPTH + 1);
  // Render at CAMERA_ZOOM resolution so the text texture maps 1:1 to canvas
  // pixels after the main camera's zoom and reads crisply instead of blurry.
  obj.setResolution(CAMERA_ZOOM);
  return obj;
}

// Camera-pinned HUD. Each row's sprite is anchored at
// (camera.midPoint + (screenOffset - halfViewport) / zoom) every frame so the
// HUD renders at fixed canvas pixels regardless of camera scroll. HP / STA /
// MAG use art assets; G1 / G2 are an ammo icon + count from hud_ammo.
export class PlayerHud {
  private readonly rows: ReadonlyArray<BarRow>;
  private readonly leftFrame: Phaser.GameObjects.Graphics;
  private readonly rightFrame: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    const rows: BarRow[] = [];

    // Frames draw behind the row content so the stroke is never clipped by
    // sprites at the same depth.
    this.leftFrame = scene.add.graphics();
    this.leftFrame.setDepth(PLAYER_HUD_DEPTH - 1);
    this.rightFrame = scene.add.graphics();
    this.rightFrame.setDepth(PLAYER_HUD_DEPTH - 1);

    // Row 0 — HP. sliders.png row 0; frame 9 = full slider. HP gets a small
    // right-shift on its content so its visible bar sits a few canvas pixels
    // away from the label, distinct from the STA/MAG rows.
    const hpSprite = scene.add.sprite(0, 0, 'hud_sliders', HP_SLIDER_FRAME_COUNT - 1);
    hpSprite.setOrigin(0, 0);
    hpSprite.setDepth(PLAYER_HUD_DEPTH);
    hpSprite.setScale(HP_SLIDER_SCALE);
    rows.push({
      kind: 'asset',
      sprite: hpSprite,
      label: makeText(scene, 'HP'),
    });

    // Row 1 — STA. Teal 3-segment 23×3 strip from ui_stamina_bar.png 'content'.
    const staSprite = scene.add.image(0, 0, 'hud_stamina', 'content');
    staSprite.setOrigin(0, 0);
    staSprite.setDepth(PLAYER_HUD_DEPTH);
    staSprite.setScale(STA_SPRITE_SCALE);
    rows.push({
      kind: 'asset',
      sprite: staSprite,
      label: makeText(scene, 'STA', PLAYER_HUD_SMALL_LABEL_FONT_SIZE_PX),
    });

    // Row 2 — MAG. Dark-red 23×3 strip from updated ui_magic_bar.png 'content'.
    const magSprite = scene.add.image(0, 0, 'hud_magic', 'content');
    magSprite.setOrigin(0, 0);
    magSprite.setDepth(PLAYER_HUD_DEPTH);
    magSprite.setScale(MAG_SPRITE_SCALE);
    rows.push({
      kind: 'asset',
      sprite: magSprite,
      label: makeText(scene, 'MAG', PLAYER_HUD_SMALL_LABEL_FONT_SIZE_PX),
    });

    // Rows 3, 4 — G1 / G2 ammo as [icon] x [count].
    rows.push(this.buildIconCountRow(scene, 'G1', GUN1_ICON_FRAME));
    rows.push(this.buildIconCountRow(scene, 'G2', GUN2_ICON_FRAME));

    this.rows = rows;
  }

  update(
    values: PlayerHudValues,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    const halfW = camera.width * 0.5;
    const halfH = camera.height * 0.5;
    const zoom = camera.zoom;
    const midX = camera.midPoint.x;
    const midY = camera.midPoint.y;

    // Drive the HP slider's frame off the current HP ratio BEFORE measuring
    // widths so the displayWidth used in the layout chain reflects the
    // current frame. Other asset rows are static (no per-state frames in the
    // supplied art).
    const hpRow = this.rows[0];
    if (hpRow.kind === 'asset' && hpRow.sprite instanceof Phaser.GameObjects.Sprite) {
      const ratio = safeRatio(values.health, values.maxHealth);
      const frame = Phaser.Math.Clamp(
        Math.floor(ratio * HP_SLIDER_FRAME_COUNT),
        0,
        HP_SLIDER_FRAME_COUNT - 1,
      );
      hpRow.sprite.setFrame(frame);
    }

    // Update ammo counts first so each count Text has its final width before
    // we compute the horizontal chain.
    this.applyCount(3, values.gun1Ammo);
    this.applyCount(4, values.gun2Ammo);

    // Two stacked groups. Indices 0..2 (HP, STA, MAG) anchor top-left;
    // indices 3..4 (G1, G2) anchor top-right so the row's right edge sits
    // PLAYER_HUD_ORIGIN_X_PX inside the viewport's right margin. The left
    // group uses a wider HP→STA pitch (HP slider is tall) and a tighter
    // STA→MAG pitch since those bars are short. Per-row screen-Y values are
    // the row's TOP edge; layoutRowAt vertically centers each row's
    // elements around that top + half-row-height.
    const leftRowScreenTopYs = [
      PLAYER_HUD_ORIGIN_Y_PX,
      PLAYER_HUD_ORIGIN_Y_PX + PLAYER_HUD_ROW_PITCH_PX,
      PLAYER_HUD_ORIGIN_Y_PX +
        PLAYER_HUD_ROW_PITCH_PX +
        PLAYER_HUD_STA_MAG_PITCH_PX,
    ];
    const worldX = midX + (PLAYER_HUD_ORIGIN_X_PX - halfW) / zoom;
    // Pin the HP/STA/MAG bars to the same X column by sizing the indent off
    // the widest left-group label. Per-row label widths differ (HP uses the
    // big font, STA/MAG use the small one) so anchoring to max-width keeps
    // every bar's left edge aligned regardless of which label is widest.
    let maxLeftLabelWidth = 0;
    for (let i = 0; i < 3; i += 1) {
      const w = this.rows[i].label.displayWidth;
      if (w > maxLeftLabelWidth) maxLeftLabelWidth = w;
    }
    const leftContentX =
      worldX + maxLeftLabelWidth + PLAYER_HUD_LEFT_BAR_INDENT_WORLD_UNITS;
    for (let i = 0; i < 3; i += 1) {
      const row = this.rows[i];
      const screenTopY = leftRowScreenTopYs[i];
      const worldTopY = midY + (screenTopY - halfH) / zoom;
      const worldCenterY = worldTopY + this.measureRowHeight(row) / 2;
      this.layoutRowAt(row, worldX, worldCenterY, leftContentX);
    }

    for (let i = 3; i < this.rows.length; i += 1) {
      const row = this.rows[i];
      const screenTopY = PLAYER_HUD_ORIGIN_Y_PX + (i - 3) * PLAYER_HUD_ROW_PITCH_PX;
      const worldTopY = midY + (screenTopY - halfH) / zoom;
      const screenRightX = camera.width - PLAYER_HUD_ORIGIN_X_PX;
      const worldRightX = midX + (screenRightX - halfW) / zoom;
      const rowWidth = this.measureRowWidth(row);
      const worldCenterY = worldTopY + this.measureRowHeight(row) / 2;
      const leftX = worldRightX - rowWidth;
      // Right group sizes each row to its own label, so contentX trails the
      // label width directly. Counts widening with digit count is OK — the
      // whole row stays right-aligned via the rowWidth measurement above.
      const contentX =
        leftX +
        row.label.displayWidth +
        PLAYER_HUD_LABEL_CONTENT_GAP_WORLD_UNITS;
      this.layoutRowAt(row, leftX, worldCenterY, contentX);
    }

    this.drawGroupFrame(this.leftFrame, 0, 3);
    this.drawGroupFrame(this.rightFrame, 3, this.rows.length);
  }

  private drawGroupFrame(
    graphics: Phaser.GameObjects.Graphics,
    fromIdx: number,
    toIdx: number,
  ): void {
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    const include = (x: number, y: number, w: number, h: number): void => {
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + w > right) right = x + w;
      if (y + h > bottom) bottom = y + h;
    };

    for (let i = fromIdx; i < toIdx; i += 1) {
      const row = this.rows[i];
      include(row.label.x, row.label.y, row.label.displayWidth, row.label.displayHeight);
      if (row.kind === 'asset') {
        include(row.sprite.x, row.sprite.y, row.sprite.displayWidth, row.sprite.displayHeight);
      } else {
        include(row.icon.x, row.icon.y, row.icon.displayWidth, row.icon.displayHeight);
        include(row.count.x, row.count.y, row.count.displayWidth, row.count.displayHeight);
      }
    }

    const rectX = left - FRAME_PADDING_WORLD;
    const rectY = top - FRAME_PADDING_WORLD;
    const rectW = right - left + FRAME_PADDING_WORLD * 2;
    const rectH = bottom - top + FRAME_PADDING_WORLD * 2;

    graphics.clear();
    graphics.lineStyle(FRAME_STROKE_WORLD, FRAME_COLOR, 1);
    graphics.strokeRect(rectX, rectY, rectW, rectH);

    // Corner accents — four small filled squares sitting just outside each
    // corner of the outer stroke. Mirrors the pause menu's bounding-box
    // decoration: each accent is centered FRAME_CORNER_ACCENT_OFFSET_WORLD
    // away from the rect corner along both axes.
    const accentSize = FRAME_CORNER_ACCENT_SIZE_WORLD;
    const accentOffset = FRAME_CORNER_ACCENT_OFFSET_WORLD;
    const accentHalf = accentSize / 2;
    graphics.fillStyle(FRAME_COLOR, 1);
    const corners: ReadonlyArray<[number, number]> = [
      [rectX - accentOffset, rectY - accentOffset],
      [rectX + rectW + accentOffset, rectY - accentOffset],
      [rectX - accentOffset, rectY + rectH + accentOffset],
      [rectX + rectW + accentOffset, rectY + rectH + accentOffset],
    ];
    for (const [x, y] of corners) {
      graphics.fillRect(x - accentHalf, y - accentHalf, accentSize, accentSize);
    }
  }

  // worldCenterY is the row's vertical centerline; every element is placed
  // so its own midpoint sits on it. Origin of each element is (0, 0), so we
  // subtract half the element's displayHeight from the centerline. contentX
  // is the absolute world-X for the row's bar/icon — callers pick it to
  // pin a column (left group) or trail the label (right group).
  private layoutRowAt(
    row: BarRow,
    worldX: number,
    worldCenterY: number,
    contentX: number,
  ): void {
    row.label.setPosition(worldX, worldCenterY - row.label.displayHeight / 2);
    if (row.kind === 'asset') {
      row.sprite.setPosition(
        contentX,
        worldCenterY - row.sprite.displayHeight / 2,
      );
    } else {
      row.icon.setPosition(
        contentX,
        worldCenterY - row.icon.displayHeight / 2,
      );
      row.count.setPosition(
        contentX + row.icon.displayWidth + AMMO_COUNT_GAP_WORLD_UNITS,
        worldCenterY - row.count.displayHeight / 2,
      );
    }
  }

  private measureRowWidth(row: BarRow): number {
    const base =
      row.label.displayWidth + PLAYER_HUD_LABEL_CONTENT_GAP_WORLD_UNITS;
    if (row.kind === 'asset') {
      return base + row.sprite.displayWidth;
    }
    return (
      base +
      row.icon.displayWidth +
      AMMO_COUNT_GAP_WORLD_UNITS +
      row.count.displayWidth
    );
  }

  private measureRowHeight(row: BarRow): number {
    let h = row.label.displayHeight;
    if (row.kind === 'asset') {
      if (row.sprite.displayHeight > h) h = row.sprite.displayHeight;
    } else {
      if (row.icon.displayHeight > h) h = row.icon.displayHeight;
      if (row.count.displayHeight > h) h = row.count.displayHeight;
    }
    return h;
  }

  destroy(): void {
    for (const row of this.rows) {
      if (row.kind === 'asset') {
        row.sprite.destroy();
      } else {
        row.icon.destroy();
        row.count.destroy();
      }
      row.label.destroy();
    }
    this.leftFrame.destroy();
    this.rightFrame.destroy();
  }

  private buildIconCountRow(
    scene: Phaser.Scene,
    label: string,
    iconFrame: number,
  ): IconCountRow {
    const icon = scene.add.sprite(0, 0, 'hud_ammo', iconFrame);
    icon.setOrigin(0, 0);
    icon.setDepth(PLAYER_HUD_DEPTH);
    icon.setScale(AMMO_ICON_SCALE);

    const count = makeText(scene, 'x 0');

    return {
      kind: 'iconcount',
      icon,
      count,
      label: makeText(scene, label),
      lastCount: -1,
    };
  }

  private applyCount(rowIndex: number, current: number): void {
    const row = this.rows[rowIndex];
    if (!row || row.kind !== 'iconcount') return;
    if (row.lastCount === current) return;
    row.lastCount = current;
    row.count.text = `x ${current}`;
    row.icon.setAlpha(current > 0 ? AMMO_FULL_ICON_ALPHA : AMMO_EMPTY_ICON_ALPHA);
  }
}
