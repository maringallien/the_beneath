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
import { DomOverlay } from './DomOverlay';
import './shop.css';

/**
 * ShopOverlay — the HTML/CSS merchant shop panel over the Phaser canvas.
 *
 * Renders a styled DOM panel above the game inside the same #game parent.
 * GameScene opens it (pausing itself) when a shop is requested and resumes the
 * game once the overlay calls onClose. The item list comes from the merchant
 * kind + level; rows can be navigated by keyboard or mouse, and every purchase
 * routes through Player.tryPurchase so the validation (enough coins? at cap?)
 * lives in one place. refresh() reconciles the whole list (balance, selection,
 * disabled/sold-out pills) to live Player state after any change.
 *
 * Why DOM over a Phaser scene: HTML+CSS gives gradients, transitions, hover, and
 * themed layouts for ~30 lines of CSS that would be much heavier in Phaser
 * Graphics + Image + Text.
 *
 * Inputs:  the scene + parent host, an open() request (kind, levelId, player),
 *          and keyboard/mouse while open; reads live Player resource counts.
 * Outputs: the shop DOM tree, purchase attempts against the Player, and the
 *          caller's onClose when it finishes closing.
 * @calledby the gameplay scene, when the player triggers a merchant shop.
 * @calls    the shop catalog lookups, the Player's purchase + resource queries,
 *           and the frame-canvas icon renderer.
 */
// Pixel-art textures that need nearest-neighbor scaling in the DOM (smooth procedural textures are not listed).
const PIXEL_ART_TEXTURE_KEYS: ReadonlySet<string> = new Set(['hud_ammo']);

interface OpenOptions {
  readonly kind: ShopKind;
  // LDtk level id — selects the capacity upgrade for that merchant; null yields just restock items.
  readonly levelId: string | null;
  readonly player: Player;
  // Called once the panel closes so GameScene can resume.
  readonly onClose: () => void;
}

export class ShopOverlay extends DomOverlay {
  private readonly scene: Phaser.Scene;

  private balanceTextEl: HTMLSpanElement | null = null;
  private itemEls: HTMLDivElement[] = [];

  private items: ReadonlyArray<ShopItem> = [];
  private player: Player | null = null;
  private selectedIndex = 0;

  constructor(scene: Phaser.Scene, parent: HTMLElement) {
    super(parent);
    this.scene = scene;
  }

  // Opens the shop for this merchant kind + level; no-op if already open.
  open(options: OpenOptions): void {
    if (this.isOpen()) return;
    this.items = shopItemsFor(options.kind, options.levelId);
    this.player = options.player;
    this.openShell(options.onClose);
    this.selectedIndex = 0;
    this.buildDom(options.kind);
    this.attachKeyboard();
    this.refresh();
  }

  // Clears element refs + cached state back to closed; the base shell calls this on close.
  protected onTeardown(): void {
    this.balanceTextEl = null;
    this.itemEls = [];
    this.items = [];
    this.player = null;
    this.selectedIndex = 0;
  }

  // Builds and mounts the backdrop + window (header, items list, footer) for this kind.
  private buildDom(kind: ShopKind): void {
    const { overlay, win } = this.createBackdrop(
      `shop-window shop-window--${kind}`,
    );

    win.appendChild(this.buildHeader(kind));
    win.appendChild(this.buildItemsList());
    win.appendChild(this.buildFooter());

    overlay.appendChild(win);
    this.mount(overlay);
  }

  // Header: the merchant title plus the live coin balance (refresh() updates the count).
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

  // Builds one row per catalog item; status pill created hidden up front so revealing it doesn't reflow.
  private buildItemsList(): HTMLDivElement {
    const list = document.createElement('div');
    list.className = 'shop-items';

    this.itemEls = this.items.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.setAttribute('role', 'button');
      row.setAttribute('data-item-id', item.id);

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

      // Status pill hidden until refresh() shows it.
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

  // Footer row of keyboard hints (Select / Buy / Close), each as kbd glyphs + label.
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

  // Renders an item's icon frame to a canvas; non-pixel-art keys get smooth sampling.
  private buildItemIcon(item: ShopItem): HTMLCanvasElement {
    const canvas = frameCanvas(this.scene, item.iconTextureKey, item.iconFrame);
    canvas.className = 'shop-item-icon';
    if (!PIXEL_ART_TEXTURE_KEYS.has(item.iconTextureKey)) {
      canvas.classList.add('shop-item-icon--smooth');
    }
    return canvas;
  }

  // A small coin glyph canvas, reused in the header balance and each price column.
  private buildCoinIcon(): HTMLCanvasElement {
    const canvas = frameCanvas(this.scene, COIN_TEXTURE_KEY);
    canvas.className = 'shop-coin';
    return canvas;
  }

  // ESC closes, ↑/W and ↓/S move selection, Enter/Space buys; no stopPropagation needed (GameScene is paused).
  protected onKeydown(e: KeyboardEvent): void {
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
  }

  // Selects a row (clamped in range), skipping a no-op; a real change triggers refresh().
  private setSelection(index: number): void {
    if (this.itemEls.length === 0) return;
    const clamped = Math.max(0, Math.min(this.itemEls.length - 1, index));
    if (clamped === this.selectedIndex) return;
    this.selectedIndex = clamped;
    this.refresh();
  }

  // Moves the selection up one row, wrapping from the top to the bottom.
  private selectPrevious(): void {
    if (this.itemEls.length === 0) return;
    const next =
      this.selectedIndex === 0 ? this.itemEls.length - 1 : this.selectedIndex - 1;
    this.setSelection(next);
  }

  // Moves the selection down one row, wrapping from the bottom to the top.
  private selectNext(): void {
    if (this.itemEls.length === 0) return;
    const next =
      this.selectedIndex === this.itemEls.length - 1 ? 0 : this.selectedIndex + 1;
    this.setSelection(next);
  }

  // Tries to buy through the Player, refreshes the panel, and flashes the row green or red.
  private attemptPurchase(): void {
    if (!this.player) return;
    const item = this.items[this.selectedIndex];
    const row = this.itemEls[this.selectedIndex];
    if (!item || !row) return;
    const ok = this.player.tryPurchase(item);
    this.refresh();
    const successClass = 'shop-item--just-purchased';
    const failClass = 'shop-item--purchase-failed';
    row.classList.remove(successClass, failClass);
    void row.offsetWidth; // forced reflow to restart the CSS flash animation
    row.classList.add(ok ? successClass : failClass);
  }

  // Reconciles balance, selection, disabled/can't-afford classes, and status pills to live Player state.
  private refresh(): void {
    if (!this.player || !this.balanceTextEl) return;
    this.balanceTextEl.textContent = String(this.player.getCoins());

    for (let i = 0; i < this.itemEls.length; i += 1) {
      const row = this.itemEls[i];
      const item = this.items[i];
      const selected = i === this.selectedIndex;
      row.classList.toggle('shop-item--selected', selected);

      // Sold out = at resource cap (MAX) or upgrade already owned (OWNED).
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
