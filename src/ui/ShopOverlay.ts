import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import {
  shopItemsFor,
  shopTitleFor,
  type ShopItem,
  type ShopKind,
} from '../entities/shop/shopTypes';
import { COIN_TEXTURE_KEY } from '../constants';
import { frameCanvas } from './textureCanvas';
import './shop.css';

// Icon texture keys that ship as pixel art (spritesheets loaded as PNGs) and
// should render with nearest-neighbor scaling in the DOM. Procedural textures
// (the gold coin, the magic orb) are LINEAR-filtered at generation time, so
// they sample smoothly without the pixelated CSS rule.
const PIXEL_ART_TEXTURE_KEYS: ReadonlySet<string> = new Set(['hud_ammo']);

interface OpenOptions {
  readonly kind: ShopKind;
  // LDtk identifier of the level the merchant stands in. Selects which capacity
  // upgrade (if any) this shop offers — only the Level_9/11/18 merchants sell
  // one. null (player in inter-level whitespace) yields just the restock items.
  readonly levelId: string | null;
  readonly player: Player;
  // Invoked once the overlay finishes closing (after the user pressed ESC,
  // clicked the dim backdrop, or triggered a programmatic close). GameScene
  // uses this to call scene.resume() on the paused game.
  readonly onClose: () => void;
}

// HTML/CSS-based merchant shop overlay. Renders a styled DOM panel above the
// Phaser canvas inside the same #game parent element. GameScene calls open()
// when SHOP_REQUESTED_EVENT fires and pauses itself; the overlay invokes
// onClose() to trigger GameScene.resume() once the user dismisses it.
//
// Why DOM over a Phaser scene: HTML+CSS gives gradients, transitions, hover
// effects, and themed layouts for ~30 lines of CSS — equivalents in Phaser
// Graphics + Image + Text would be much heavier and less flexible to tune.
// All transactions still route through Player.tryPurchase so the validation
// (enough coins? at max?) lives in one place.
export class ShopOverlay {
  private readonly scene: Phaser.Scene;
  private readonly parent: HTMLElement;

  private overlayEl: HTMLDivElement | null = null;
  private balanceTextEl: HTMLSpanElement | null = null;
  private itemEls: HTMLDivElement[] = [];

  private items: ReadonlyArray<ShopItem> = [];
  private player: Player | null = null;
  private onClose: (() => void) | null = null;
  private selectedIndex = 0;

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(scene: Phaser.Scene, parent: HTMLElement) {
    this.scene = scene;
    this.parent = parent;
  }

  isOpen(): boolean {
    return this.overlayEl !== null;
  }

  open(options: OpenOptions): void {
    if (this.isOpen()) return;
    this.items = shopItemsFor(options.kind, options.levelId);
    this.player = options.player;
    this.onClose = options.onClose;
    this.selectedIndex = 0;
    this.buildDom(options.kind);
    this.attachKeyboard();
    this.refresh();
  }

  // Public-facing close: called by the user (ESC, backdrop click) and by the
  // user-initiated purchase flow. Invokes the onClose callback so GameScene
  // resumes.
  close(): void {
    if (!this.isOpen()) return;
    const cb = this.onClose;
    this.teardown();
    if (cb) cb();
  }

  // Force-close path used by GameScene.tearDownWorld during HMR. Drops the DOM
  // and listeners without invoking onClose — the GameScene is being rebuilt,
  // so resuming a torn-down scene would crash.
  destroy(): void {
    if (!this.isOpen()) return;
    this.teardown();
  }

  private teardown(): void {
    this.detachKeyboard();
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.balanceTextEl = null;
    this.itemEls = [];
    this.items = [];
    this.player = null;
    this.onClose = null;
    this.selectedIndex = 0;
  }

  private buildDom(kind: ShopKind): void {
    const overlay = document.createElement('div');
    overlay.className = 'shop-overlay';

    // Clicking the dim backdrop (outside the window) closes the shop —
    // matches the conventional "click outside to dismiss" overlay idiom.
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    const win = document.createElement('div');
    win.className = `shop-window shop-window--${kind}`;

    win.appendChild(this.buildHeader(kind));
    win.appendChild(this.buildItemsList());
    win.appendChild(this.buildFooter());

    overlay.appendChild(win);
    this.parent.appendChild(overlay);

    this.overlayEl = overlay;
  }

  private buildHeader(kind: ShopKind): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'shop-header';

    const title = document.createElement('h2');
    title.className = 'shop-title';
    title.textContent = shopTitleFor(kind);
    header.appendChild(title);

    const balance = document.createElement('div');
    balance.className = 'shop-balance';
    balance.appendChild(this.buildCoinIcon());
    const balanceText = document.createElement('span');
    balanceText.textContent = '0';
    balance.appendChild(balanceText);
    this.balanceTextEl = balanceText;
    header.appendChild(balance);

    return header;
  }

  private buildItemsList(): HTMLDivElement {
    const list = document.createElement('div');
    list.className = 'shop-items';

    this.itemEls = this.items.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.setAttribute('role', 'button');
      row.setAttribute('data-item-id', item.id);

      // Icon column. Pixel-art icons (hud_ammo frames) get nearest-neighbor
      // rendering; smooth procedural textures (magic orb) get default sampling.
      const icon = this.buildItemIcon(item);
      row.appendChild(icon);

      // Body column: label + small detail line ("+5 ammo" etc).
      const body = document.createElement('div');
      body.className = 'shop-item-body';

      const label = document.createElement('div');
      label.className = 'shop-item-label';
      label.textContent = item.label;
      body.appendChild(label);

      const detail = document.createElement('div');
      detail.className = 'shop-item-detail';
      detail.textContent =
        item.kind === 'upgrade' ? item.detail : `+${item.grantAmount}`;
      body.appendChild(detail);

      row.appendChild(body);

      // Status pill ("MAX" / "POOR"). Hidden by default; refresh() toggles
      // visibility based on Player state. Created up-front so its presence
      // doesn't reflow the layout when it appears.
      const status = document.createElement('div');
      status.className = 'shop-item-status';
      status.style.display = 'none';
      row.appendChild(status);

      // Price column: number + coin icon.
      const price = document.createElement('div');
      price.className = 'shop-item-price';
      const priceText = document.createElement('span');
      priceText.textContent = String(item.price);
      price.appendChild(priceText);
      price.appendChild(this.buildCoinIcon());
      row.appendChild(price);

      row.addEventListener('mouseenter', () => this.setSelection(index));
      row.addEventListener('click', () => {
        this.setSelection(index);
        this.attemptPurchase();
      });

      return row;
    });

    for (const row of this.itemEls) list.appendChild(row);

    return list;
  }

  private buildFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.className = 'shop-footer';

    const hints: ReadonlyArray<{ keys: string[]; label: string }> = [
      { keys: ['↑', '↓'], label: 'Select' },
      { keys: ['Enter'], label: 'Buy' },
      { keys: ['Esc'], label: 'Close' },
    ];

    for (const hint of hints) {
      const span = document.createElement('div');
      span.className = 'shop-footer-hint';
      for (const k of hint.keys) {
        const kbd = document.createElement('kbd');
        kbd.className = 'shop-key';
        kbd.textContent = k;
        span.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.textContent = hint.label;
      span.appendChild(label);
      footer.appendChild(span);
    }

    return footer;
  }

  private buildItemIcon(item: ShopItem): HTMLCanvasElement {
    const canvas = frameCanvas(this.scene, item.iconTextureKey, item.iconFrame);
    canvas.className = 'shop-item-icon';
    if (!PIXEL_ART_TEXTURE_KEYS.has(item.iconTextureKey)) {
      canvas.classList.add('shop-item-icon--smooth');
    }
    return canvas;
  }

  private buildCoinIcon(): HTMLCanvasElement {
    const canvas = frameCanvas(this.scene, COIN_TEXTURE_KEY);
    canvas.className = 'shop-coin';
    return canvas;
  }

  private attachKeyboard(): void {
    const handler = (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          this.selectPrevious();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          this.selectNext();
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          this.attemptPurchase();
          break;
        default:
          break;
      }
    };
    // Capture phase + window-level so the listener catches keys regardless of
    // whether focus is on the canvas (most common while playing) or somewhere
    // else in the document. Phaser's own keyboard handlers run on the canvas
    // and are paused along with GameScene, so there's no risk of duplicate
    // dispatch.
    window.addEventListener('keydown', handler, true);
    this.keydownHandler = handler;
  }

  private detachKeyboard(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  private setSelection(index: number): void {
    if (this.itemEls.length === 0) return;
    const clamped = Math.max(0, Math.min(this.itemEls.length - 1, index));
    if (clamped === this.selectedIndex) return;
    this.selectedIndex = clamped;
    this.refresh();
  }

  private selectPrevious(): void {
    if (this.itemEls.length === 0) return;
    const next =
      this.selectedIndex === 0 ? this.itemEls.length - 1 : this.selectedIndex - 1;
    this.setSelection(next);
  }

  private selectNext(): void {
    if (this.itemEls.length === 0) return;
    const next =
      this.selectedIndex === this.itemEls.length - 1 ? 0 : this.selectedIndex + 1;
    this.setSelection(next);
  }

  private attemptPurchase(): void {
    if (!this.player) return;
    const item = this.items[this.selectedIndex];
    const row = this.itemEls[this.selectedIndex];
    if (!item || !row) return;
    const ok = this.player.tryPurchase(item);
    this.refresh();
    // Replay-animate the row to give the buyer feedback. CSS animations
    // restart by toggling the class off/on across a layout flush.
    const successClass = 'shop-item--just-purchased';
    const failClass = 'shop-item--purchase-failed';
    row.classList.remove(successClass, failClass);
    // Force reflow so the next class addition re-triggers the animation.
    void row.offsetWidth;
    row.classList.add(ok ? successClass : failClass);
  }

  // Sync displayed values + selection/disabled state to the current Player
  // resource counts. Called after every selection change AND after every
  // purchase attempt (success or failure) so the visible state never lags
  // the Player.
  private refresh(): void {
    if (!this.player || !this.balanceTextEl) return;
    this.balanceTextEl.textContent = String(this.player.getCoins());

    for (let i = 0; i < this.itemEls.length; i += 1) {
      const row = this.itemEls[i];
      const item = this.items[i];
      const selected = i === this.selectedIndex;
      row.classList.toggle('shop-item--selected', selected);

      // "Sold out" means there's no point selling: a resource already at its
      // cap (MAX) or a one-time upgrade already owned (OWNED). Both disable the
      // row; the label/color differ so the buyer knows which case it is.
      const soldOut =
        item.kind === 'upgrade'
          ? this.player.ownsUpgrade(item.id)
          : this.player.getResourceValue(item.pickupKind) >=
            this.player.getResourceMax(item.pickupKind);
      const cantAfford = this.player.getCoins() < item.price;
      const disabled = soldOut || cantAfford;

      row.classList.toggle('shop-item--disabled', disabled);
      row.classList.toggle('shop-item--cant-afford', cantAfford && !soldOut);

      const status = row.querySelector<HTMLDivElement>('.shop-item-status');
      if (status) {
        status.classList.remove(
          'shop-item-status--max',
          'shop-item-status--poor',
          'shop-item-status--owned',
        );
        if (soldOut) {
          const isUpgrade = item.kind === 'upgrade';
          status.textContent = isUpgrade ? 'OWNED' : 'MAX';
          status.classList.add(
            isUpgrade ? 'shop-item-status--owned' : 'shop-item-status--max',
          );
          status.style.display = '';
        } else if (cantAfford) {
          status.textContent = 'NEED MORE';
          status.classList.add('shop-item-status--poor');
          status.style.display = '';
        } else {
          status.style.display = 'none';
        }
      }
    }
  }
}
