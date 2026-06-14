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
 * @file ui/ShopOverlay.ts
 * @description HTML/CSS merchant shop panel over the Phaser canvas, opened by GameScene (which pauses itself); the item list comes from the merchant kind + level, rows navigate by keyboard or mouse, every purchase routes through Player.tryPurchase, and refresh reconciles the whole list to live Player state after any change.
 * @module ui
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

  /**
   * @function    open
   * @description Open the shop for this merchant kind + level — load the catalog, arm the close callback, build + mount the DOM, and refresh to live state. No-op if already open.
   * @param   options  Merchant kind, LDtk levelId or null, the Player, and the onClose callback.
   * @calledby src/scenes/GameScene.ts → openShop, when the player triggers a merchant shop
   * @calls    src/entities/shop/shopTypes.ts → shopItemsFor, src/ui/DomOverlay.ts → openShell/attachKeyboard, and src/ui/ShopOverlay.ts → buildDom/refresh
   */
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

  /**
   * @function    onTeardown
   * @description Reset the balance ref, item elements, catalog, player, and selection back to closed.
   * @calledby src/ui/DomOverlay.ts → teardown, while closing the shop
   * @calls    —
   */
  protected onTeardown(): void {
    this.balanceTextEl = null;
    this.itemEls = [];
    this.items = [];
    this.player = null;
    this.selectedIndex = 0;
  }

  /**
   * @function    buildDom
   * @description Assemble and mount the backdrop + window (header, items list, footer) for this kind.
   * @param   kind  Merchant kind, which themes the window.
   * @calledby src/ui/ShopOverlay.ts → open
   * @calls    src/ui/DomOverlay.ts → createBackdrop/mount and src/ui/ShopOverlay.ts → buildHeader/buildItemsList/buildFooter
   */
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

  /**
   * @function    buildHeader
   * @description Build the header — the merchant title plus the live coin balance (refresh updates the count) — recording the balance-text ref.
   * @param   kind  Merchant kind, selects the title.
   * @returns a detached header div.
   * @calledby src/ui/ShopOverlay.ts → buildDom
   * @calls    src/entities/shop/shopTypes.ts → shopTitleFor, src/ui/ShopOverlay.ts → buildCoinIcon, and DOM creation
   */
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

  /**
   * @function    buildItemsList
   * @description Build one row per catalog item (status pill created hidden up front so revealing it doesn't reflow), recording the per-row element refs.
   * @returns a detached items-list div.
   * @calledby src/ui/ShopOverlay.ts → buildDom
   * @calls    src/ui/ShopOverlay.ts → buildItemIcon; row hover calls setSelection, a click calls setSelection then attemptPurchase
   */
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

  /**
   * @function    buildFooter
   * @description Build the footer row of keyboard hints (Select / Buy / Close), each as kbd glyphs + label.
   * @returns a detached footer div of hint chips.
   * @calledby src/ui/ShopOverlay.ts → buildDom
   * @calls    DOM element-create/append only
   */
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

  /**
   * @function    buildItemIcon
   * @description Render an item's icon frame to a canvas, adding the smooth-sampling class for non-pixel-art textures.
   * @param   item  Catalog item whose icon texture/frame to draw.
   * @returns a canvas with the item icon.
   * @calledby src/ui/ShopOverlay.ts → buildItemsList, per row
   * @calls    src/ui/textureCanvas.ts → frameCanvas
   */
  private buildItemIcon(item: ShopItem): HTMLCanvasElement {
    const canvas = frameCanvas(this.scene, item.iconTextureKey, item.iconFrame);
    canvas.className = 'shop-item-icon';
    if (!PIXEL_ART_TEXTURE_KEYS.has(item.iconTextureKey)) {
      canvas.classList.add('shop-item-icon--smooth');
    }
    return canvas;
  }

  /** A small coin glyph canvas, reused in the header balance and each price column. */
  private buildCoinIcon(): HTMLCanvasElement {
    const canvas = frameCanvas(this.scene, COIN_TEXTURE_KEY);
    canvas.className = 'shop-coin';
    return canvas;
  }

  /**
   * @function    onKeydown
   * @description Dispatch ESC (close), up/W and down/S (move selection), and Enter/Space (buy), swallowing the default for handled keys; no stopPropagation needed since GameScene is paused.
   * @param   e  Keyboard event from the window-level capture listener.
   * @calledby src/ui/DomOverlay.ts → the capture-phase keydown listener, on any keypress while open
   * @calls    src/ui/DomOverlay.ts → close and src/ui/ShopOverlay.ts → selectPrevious/selectNext/attemptPurchase
   */
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

  /**
   * @function    setSelection
   * @description Select a row (clamped to the valid range); a real change triggers refresh. No-op when empty or unchanged.
   * @param   index  Desired selection.
   * @calledby src/ui/ShopOverlay.ts → row hover/click handlers, selectPrevious, and selectNext
   * @calls    src/ui/ShopOverlay.ts → refresh
   */
  private setSelection(index: number): void {
    if (this.itemEls.length === 0) return;
    const clamped = Math.max(0, Math.min(this.itemEls.length - 1, index));
    if (clamped === this.selectedIndex) return;
    this.selectedIndex = clamped;
    this.refresh();
  }

  /**
   * @function    selectPrevious
   * @description Move the selection up one row, wrapping from the top to the bottom; no-op if empty.
   * @calledby src/ui/ShopOverlay.ts → onKeydown, on the up-arrow / W keypress
   * @calls    src/ui/ShopOverlay.ts → setSelection
   */
  private selectPrevious(): void {
    if (this.itemEls.length === 0) return;
    const next =
      this.selectedIndex === 0 ? this.itemEls.length - 1 : this.selectedIndex - 1;
    this.setSelection(next);
  }

  /**
   * @function    selectNext
   * @description Move the selection down one row, wrapping from the bottom to the top; no-op if empty.
   * @calledby src/ui/ShopOverlay.ts → onKeydown, on the down-arrow / S keypress
   * @calls    src/ui/ShopOverlay.ts → setSelection
   */
  private selectNext(): void {
    if (this.itemEls.length === 0) return;
    const next =
      this.selectedIndex === this.itemEls.length - 1 ? 0 : this.selectedIndex + 1;
    this.setSelection(next);
  }

  /**
   * @function    attemptPurchase
   * @description Route the currently selected item's buy through the Player, refresh, and restart a success/fail flash animation on the row.
   * @calledby src/ui/ShopOverlay.ts → onKeydown (Enter/Space) and a row click
   * @calls    src/entities/Player.ts → tryPurchase and src/ui/ShopOverlay.ts → refresh
   */
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

  /**
   * @function    refresh
   * @description Reconcile the balance and every row's selected/disabled/can't-afford classes and status pills to live Player state; no-op if not open.
   * @calledby src/ui/ShopOverlay.ts → open, setSelection, and attemptPurchase
   * @calls    src/entities/Player.ts → getCoins/getResourceValue/getResourceMax/ownsUpgrade and DOM class/text writes
   */
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
