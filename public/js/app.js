/* Shared runtime: API client, cart, chrome, small UI helpers. */
(function () {
  'use strict';

  /* ---------------- API ---------------- */

  async function request(path, options = {}) {
    const opts = { credentials: 'same-origin', headers: {}, ...options };
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const API = {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    put: (p, body) => request(p, { method: 'PUT', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    upload: (p, formData) => request(p, { method: 'POST', body: formData }),
  };

  /* ---------------- helpers ---------------- */

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function money(value) {
    const n = Number(value) || 0;
    if (n <= 0) return 'On request';
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  /* ---------------- toast ---------------- */

  let toastEl = null;
  let toastTimer = null;
  function toast(message, ms = 2600) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.dataset.show = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.dataset.show = 'false'; }, ms);
  }

  /* ---------------- cart ---------------- */

  const CART_KEY = 'studio.cart.v1';

  function readCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((i) => i && Number.isFinite(Number(i.id)))
        .map((i) => ({
          id: Number(i.id),
          qty: Math.min(Math.max(Number(i.qty) || 1, 1), 99),
          title: String(i.title || ''),
          price: Number(i.price) || 0,
          imageUrl: String(i.imageUrl || ''),
          categoryName: String(i.categoryName || ''),
          section: String(i.section || ''),
        }));
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    document.dispatchEvent(new CustomEvent('cart:change', { detail: { items } }));
    paintCartCount();
  }

  function cartCount() {
    return readCart().reduce((n, i) => n + i.qty, 0);
  }

  function addToCart(item, qty = 1) {
    const items = readCart();
    const existing = items.find((i) => i.id === Number(item.id));
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, 99);
      // Refresh snapshot fields in case the studio edited the design.
      existing.title = item.title || existing.title;
      existing.price = Number(item.price) || existing.price;
      existing.imageUrl = item.imageUrl || existing.imageUrl;
    } else {
      items.push({
        id: Number(item.id),
        qty: Math.min(Math.max(qty, 1), 99),
        title: item.title || '',
        price: Number(item.price) || 0,
        imageUrl: item.imageUrl || '',
        categoryName: item.categoryName || '',
        section: item.section || '',
      });
    }
    writeCart(items);
    return items;
  }

  function setQty(id, qty) {
    const items = readCart();
    const found = items.find((i) => i.id === Number(id));
    if (!found) return;
    found.qty = Math.min(Math.max(qty, 1), 99);
    writeCart(items);
  }

  function removeFromCart(id) {
    writeCart(readCart().filter((i) => i.id !== Number(id)));
  }

  function clearCart() {
    writeCart([]);
  }

  function cartTotal() {
    return readCart().reduce((sum, i) => sum + i.price * i.qty, 0);
  }

  function paintCartCount() {
    const n = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  }

  /* ---------------- chrome ---------------- */

  const NAV = [
    { href: '/', label: 'Home' },
    { href: '/embroidery', label: 'Computer Embroidery' },
    { href: '/maggam', label: 'Maggam Work' },
    { href: '/cart', label: 'Cart', cart: true },
  ];

  let sessionCache = undefined;
  async function getSession(force = false) {
    if (sessionCache !== undefined && !force) return sessionCache;
    try {
      const data = await API.get('/api/auth/me');
      sessionCache = data.user;
    } catch {
      sessionCache = null;
    }
    return sessionCache;
  }

  let brandLogoUrl = '/img/logo-mark.png';

  function brandMark() {
    if (brandLogoUrl) {
      return `<span class="brand__mark brand__mark--img"><img src="${escapeHtml(brandLogoUrl)}" alt=""></span>`;
    }
    return '<span class="brand__mark" aria-hidden="true">S</span>';
  }

  function renderHeader(activePath, opts = {}) {
    const host = document.getElementById('site-header');
    if (!host) return;

    const tabs = NAV.map((item) => {
      const isActive = item.href === activePath;
      const count = item.cart ? '<span class="tab__count" data-cart-count hidden>0</span>' : '';
      return `<a class="tab" href="${item.href}"${isActive ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}${count}</a>`;
    }).join('');

    host.innerHTML = `
      <header class="masthead">
        <div class="wrap masthead__inner">
          <a class="brand" href="/">
            ${brandMark()}
            <span>
              <span class="brand__name" data-brand-name>Sree Designers</span>
              <span class="brand__sub">Embroidery · Maggam</span>
            </span>
          </a>
          <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-tabs" aria-label="Menu">
            <span></span><span></span><span></span>
          </button>
          <nav class="tabs" id="primary-tabs" data-open="false" aria-label="Primary">${tabs}</nav>
          <div class="masthead__actions" data-session-slot></div>
        </div>
      </header>`;

    const toggle = host.querySelector('.menu-toggle');
    const nav = host.querySelector('.tabs');
    toggle.addEventListener('click', () => {
      const open = nav.dataset.open === 'true';
      nav.dataset.open = String(!open);
      toggle.setAttribute('aria-expanded', String(!open));
    });

    if (opts.adminBar) renderAdminBar(opts.adminBar);

    paintCartCount();
    paintSessionSlot();
  }

  async function paintSessionSlot() {
    const slot = document.querySelector('[data-session-slot]');
    if (!slot) return;
    // Static builds have no server, so there is nothing to sign in to.
    if (document.body.dataset.static) { slot.innerHTML = ''; return; }
    const user = await getSession();

    if (user) {
      const first = (user.name || user.email).split(/[\s@]/)[0];
      slot.innerHTML = `
        <a class="btn btn--ghost btn--sm" href="${user.role === 'admin' ? '/admin' : '/account'}">${escapeHtml(first)}</a>
        <button class="btn btn--ghost btn--sm" type="button" data-logout>Sign out</button>`;
      slot.querySelector('[data-logout]').addEventListener('click', async () => {
        await API.post('/api/auth/logout');
        sessionCache = null;
        window.location.href = '/';
      });
    } else {
      slot.innerHTML = '<a class="btn btn--ghost btn--sm" href="/account">Sign in</a>';
    }
  }

  function renderAdminBar(label = 'Admin') {
    const host = document.getElementById('admin-bar');
    if (!host) return;
    host.className = 'adminbar';
    host.innerHTML = `
      <div class="wrap adminbar__inner">
        <span class="adminbar__tag">${escapeHtml(label)}</span>
        <a href="/admin">Studio console</a>
        <a href="/" target="_blank" rel="noopener">View shop</a>
        <span class="adminbar__spacer"></span>
        <a href="/admin#settings">Settings</a>
      </div>`;
  }

  function renderFooter(settings = {}) {
    const host = document.getElementById('site-footer');
    if (!host) return;
    const name = settings.businessName || 'Sree Designers';
    const year = new Date().getFullYear();
    // No accounts on a static host, so that column would be a dead end.
    const accountLink = document.body.dataset.static
      ? ''
      : '<li><a href="/account">Your account</a></li>';
    host.innerHTML = `
      <footer class="footer">
        <div class="wrap">
          <div class="footer__grid">
            <div>
              <a class="brand" href="/" style="margin-bottom:14px">
                ${brandMark()}
                <span><span class="brand__name">${escapeHtml(name)}</span>
                <span class="brand__sub">Since ${year}</span></span>
              </a>
              <p class="tiny muted" style="max-width:38ch">${escapeHtml(settings.tagline || '')}</p>
            </div>
            <div>
              <h4>Browse</h4>
              <ul>
                <li><a href="/">Home</a></li>
                <li><a href="/embroidery">Computer Embroidery</a></li>
                <li><a href="/maggam">Maggam Work</a></li>
                <li><a href="/cart">Cart</a></li>
              </ul>
            </div>
            <div>
              <h4>Ordering</h4>
              <ul>
                <li><a href="/cart">Send cart on WhatsApp</a></li>
                ${accountLink}
              </ul>
            </div>
          </div>
          <div class="footer__base">
            <span>© ${year} ${escapeHtml(name)}. All designs are studio originals.</span>
            <span>Photos are indicative; final stitching may vary slightly.</span>
          </div>
        </div>
      </footer>`;
  }

  function paintBrandMarks() {
    const html = brandMark();
    document.querySelectorAll('.brand__mark').forEach((el) => {
      el.outerHTML = html;
    });
  }

  async function loadSettings() {
    try {
      const s = await API.get('/api/settings');
      brandLogoUrl = s.logoUrl || '/img/logo-mark.png';
      paintBrandMarks();
      document.querySelectorAll('[data-brand-logo-full]').forEach((el) => {
        el.src = s.logoUrl || '/img/logo.png';
      });
      const nameEl = document.querySelector('[data-brand-name]');
      if (nameEl && s.businessName) nameEl.textContent = s.businessName;
      document.querySelectorAll('[data-business-name]').forEach((el) => { el.textContent = s.businessName; });
      document.querySelectorAll('[data-tagline]').forEach((el) => { el.textContent = s.tagline || ''; });
      return s;
    } catch {
      return {};
    }
  }

  /* ---------------- design card ---------------- */

  function designCard(design, opts = {}) {
    const href = `/design?id=${design.id}`;
    const badge = design.featured
      ? '<span class="swatch__badge swatch__badge--thread">Featured</span>'
      : (design.categoryName ? `<span class="swatch__badge">${escapeHtml(design.categoryName)}</span>` : '');
    const delay = Math.min(opts.index || 0, 12) * 45;
    return `
      <article class="swatch" style="animation-delay:${delay}ms">
        <a class="swatch__media" href="${href}" aria-label="Open ${escapeHtml(design.title)}">
          ${badge}
          <img src="${escapeHtml(design.imageUrl)}" alt="${escapeHtml(design.title)}" loading="lazy" decoding="async">
        </a>
        <div class="swatch__body">
          <span class="swatch__cat">${escapeHtml(design.categoryName || '')}</span>
          <h3 class="swatch__title"><a href="${href}" style="text-decoration:none">${escapeHtml(design.title)}</a></h3>
          <div class="swatch__foot">
            <span class="swatch__price">${money(design.price)}${design.price > 0 ? ' <small>/ pc</small>' : ''}</span>
            <button class="swatch__add" type="button"
              data-add-to-cart
              data-id="${design.id}"
              data-title="${escapeHtml(design.title)}"
              data-price="${Number(design.price) || 0}"
              data-image="${escapeHtml(design.imageUrl)}"
              data-category="${escapeHtml(design.categoryName || '')}"
              data-section="${escapeHtml(design.section || '')}">Add to cart</button>
          </div>
        </div>
      </article>`;
  }

  // One delegated listener so any card, anywhere, can add to the cart.
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-add-to-cart]');
    if (!btn) return;
    event.preventDefault();
    addToCart({
      id: btn.dataset.id,
      title: btn.dataset.title,
      price: btn.dataset.price,
      imageUrl: btn.dataset.image,
      categoryName: btn.dataset.category,
      section: btn.dataset.section,
    });
    const original = btn.textContent;
    btn.dataset.added = '1';
    btn.textContent = 'Added ✓';
    setTimeout(() => { btn.dataset.added = '0'; btn.textContent = original; }, 1400);
    toast(`${btn.dataset.title} added to your cart`);
  });

  document.addEventListener('cart:change', paintCartCount);

  /* ---------------- lightbox ---------------- */

  function initLightbox() {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.dataset.open = 'false';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Design photo');
    box.innerHTML = `
      <button class="lightbox__close" type="button" aria-label="Close">×</button>
      <img alt="">`;
    document.body.appendChild(box);

    const img = box.querySelector('img');
    const close = () => { box.dataset.open = 'false'; document.body.style.overflow = ''; };

    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.lightbox__close')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-lightbox]');
      if (!trigger) return;
      e.preventDefault();
      img.src = trigger.dataset.lightbox;
      img.alt = trigger.dataset.lightboxAlt || '';
      box.dataset.open = 'true';
      document.body.style.overflow = 'hidden';
    });
  }

  /* ---------------- reveal on scroll ---------------- */

  function initReveal() {
    const targets = document.querySelectorAll('.reveal');
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach((el) => io.observe(el));
  }

  function emptyState(title, body, actionHtml = '') {
    return `<div class="empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>${actionHtml}</div>`;
  }

  function skeletonGrid(n = 8) {
    return Array.from({ length: n }, () => '<div class="skel skel-card"></div>').join('');
  }

  window.Studio = {
    API, toast, escapeHtml, money, qs, debounce,
    cart: { read: readCart, add: addToCart, setQty, remove: removeFromCart, clear: clearCart, count: cartCount, total: cartTotal },
    chrome: { renderHeader, renderFooter, renderAdminBar, loadSettings, getSession },
    designCard, initLightbox, initReveal, emptyState, skeletonGrid,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initLightbox();
    initReveal();
    paintCartCount();
  });
})();
