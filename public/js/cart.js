'use strict';
(function () {
  const { API, escapeHtml, money, toast, emptyState, chrome } = window.Studio;
  const cart = window.Studio.cart;

  const NOTE_KEY = 'studio.cart.note.v1';
  let busy = false;

  async function boot() {
    chrome.renderHeader('/cart');
    const settings = await chrome.loadSettings();
    chrome.renderFooter(settings);
    render(settings);
    document.addEventListener('cart:change', () => render(settings));
  }

  function render(settings) {
    const root = document.getElementById('cart-root');
    const items = cart.read();

    if (items.length === 0) {
      root.innerHTML = emptyState(
        'Your cart is empty',
        'Browse the galleries and press add to cart on any design you like. Your picks stay here until you send them.',
        '<a class="btn btn--thread btn--sm" href="/embroidery">Browse computer embroidery</a>'
      );
      return;
    }

    const total = cart.total();
    const hasPrice = items.some((i) => i.price > 0);

    root.innerHTML = `
      <div class="cart">
        <div class="lines">
          ${items.map(lineHtml).join('')}
        </div>
        <aside class="summary">
          <h3>Order summary</h3>
          ${items.map((i) => `
            <div class="summary__row">
              <span>${escapeHtml(i.title)} × ${i.qty}</span>
              <span>${i.price > 0 ? money(i.price * i.qty) : 'On request'}</span>
            </div>`).join('')}
          <div class="summary__row summary__row--total">
            <span>${hasPrice ? 'Estimated total' : 'Total'}</span>
            <span>${hasPrice ? money(total) : 'On request'}</span>
          </div>

          <div class="field" style="margin-top:18px">
            <label for="cart-note">Note for the studio</label>
            <textarea id="cart-note" placeholder="Measurements, fabric colour, delivery date…" maxlength="500"></textarea>
          </div>

          <button class="btn btn--wa btn--block" type="button" id="buy">Buy — send on WhatsApp</button>
          <button class="btn btn--ghost btn--block" type="button" id="clear" style="margin-top:9px">Empty cart</button>
          <p class="summary__hint" id="wa-hint"></p>
        </aside>
      </div>`;

    const noteEl = document.getElementById('cart-note');
    noteEl.value = localStorage.getItem(NOTE_KEY) || '';
    noteEl.addEventListener('input', () => localStorage.setItem(NOTE_KEY, noteEl.value));

    wireLines();
    document.getElementById('buy').addEventListener('click', () => checkout(settings));
    document.getElementById('clear').addEventListener('click', () => {
      if (!window.confirm('Remove every design from your cart?')) return;
      cart.clear();
      toast('Cart emptied');
    });

    if (!settings.whatsappConfigured) {
      const hint = document.getElementById('wa-hint');
      hint.textContent = 'The studio has not set a WhatsApp number yet. Set it in the admin console under Settings.';
      hint.style.color = 'var(--thread)';
    }
  }

  function lineHtml(item) {
    return `
      <div class="line" data-id="${item.id}">
        <a class="line__thumb" href="/design?id=${item.id}">
          <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">
        </a>
        <div>
          <h3 class="line__title"><a href="/design?id=${item.id}" style="text-decoration:none">${escapeHtml(item.title)}</a></h3>
          <span class="line__sub">${escapeHtml(item.categoryName || '')}${item.price > 0 ? ` · ${money(item.price)} each` : ' · price on request'}</span>
        </div>
        <div class="line__controls">
          <div class="qty">
            <button type="button" data-step="-1" data-qty-id="${item.id}" aria-label="Decrease quantity of ${escapeHtml(item.title)}">−</button>
            <span>${item.qty}</span>
            <button type="button" data-step="1" data-qty-id="${item.id}" aria-label="Increase quantity of ${escapeHtml(item.title)}">+</button>
          </div>
          <button class="line__remove" type="button" data-remove="${item.id}">Remove</button>
        </div>
      </div>`;
  }

  function wireLines() {
    document.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.qtyId);
        const current = cart.read().find((i) => i.id === id);
        if (!current) return;
        cart.setQty(id, current.qty + Number(btn.dataset.step));
      });
    });
    document.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        cart.remove(btn.dataset.remove);
        toast('Design removed from cart');
      });
    });
  }

  async function checkout(settings) {
    if (busy) return;
    const items = cart.read();
    if (items.length === 0) return;

    const btn = document.getElementById('buy');
    const note = (document.getElementById('cart-note') || {}).value || '';
    busy = true;
    btn.setAttribute('aria-disabled', 'true');
    const label = btn.textContent;
    btn.textContent = 'Preparing WhatsApp…';

    try {
      const result = await API.post('/api/orders/checkout', {
        items: items.map((i) => ({ id: i.id, qty: i.qty })),
        note,
      });
      window.open(result.whatsappUrl, '_blank', 'noopener');
      toast(`Order #${result.orderId} ready in WhatsApp`);
      // Keep the cart so the customer can re-send if WhatsApp did not open.
      btn.textContent = 'Open WhatsApp again';
    } catch (err) {
      toast(err.message);
      btn.textContent = label;
    } finally {
      busy = false;
      btn.removeAttribute('aria-disabled');
    }
  }

  boot();
})();
