'use strict';
(function () {
  const { API, escapeHtml, money, qs, designCard, emptyState, toast, chrome } = window.Studio;
  const cart = window.Studio.cart;

  const id = Number(qs('id'));
  let current = null;

  async function boot() {
    chrome.renderHeader('');
    const settings = await chrome.loadSettings();
    chrome.renderFooter(settings);

    if (!Number.isFinite(id) || id <= 0) {
      renderError('No design selected', 'Open a design from the home page or a section gallery.');
      return;
    }

    try {
      const data = await API.get(`/api/designs/${id}`);
      current = data.design;
      renderDetail(current, settings);
      renderRelated(data.related);
      document.title = `${current.title} — ${settings.businessName || 'Studio'}`;
    } catch (err) {
      renderError('Design unavailable', err.message);
    }
  }

  function renderError(title, body) {
    document.getElementById('detail-root').innerHTML = emptyState(
      title,
      body,
      '<a class="btn btn--ghost btn--sm" href="/">Back to home</a>'
    );
  }

  function renderDetail(d, settings) {
    document.getElementById('crumbs').innerHTML =
      `<a href="/">Home</a><span>/</span><a href="/${escapeHtml(d.section)}">${escapeHtml(sectionLabel(d.section, settings))}</a><span>/</span><a href="/${escapeHtml(d.section)}?category=${encodeURIComponent(d.categorySlug || '')}">${escapeHtml(d.categoryName)}</a><span>/</span><span>${escapeHtml(d.title)}</span>`;

    const priceBlock = d.price > 0
      ? `<span class="detail__price">${money(d.price)}</span> <span class="tiny muted">per piece</span>`
      : '<span class="detail__price">On request</span> <span class="tiny muted">— we will quote on WhatsApp</span>';

    document.getElementById('detail-root').innerHTML = `
      <div class="detail">
        <div>
          <div class="detail__frame">
            <img src="${escapeHtml(d.imageUrl)}" alt="${escapeHtml(d.title)}" data-lightbox="${escapeHtml(d.imageUrl)}" data-lightbox-alt="${escapeHtml(d.title)}" style="cursor:zoom-in">
            <button class="detail__zoom" type="button" data-lightbox="${escapeHtml(d.imageUrl)}" data-lightbox-alt="${escapeHtml(d.title)}">View full size</button>
          </div>
        </div>
        <div>
          <p class="eyebrow">${escapeHtml(sectionLabel(d.section, settings))}</p>
          <h1 style="font-size:clamp(1.8rem,4vw,2.6rem);margin-bottom:.25em">${escapeHtml(d.title)}</h1>
          <p class="muted" style="margin-bottom:1em">${escapeHtml(d.categoryName)}</p>
          <div>${priceBlock}</div>

          <dl class="detail__meta">
            <div><dt>Category</dt><dd>${escapeHtml(d.categoryName)}</dd></div>
            <div><dt>Section</dt><dd>${escapeHtml(sectionLabel(d.section, settings))}</dd></div>
            <div><dt>Reference</dt><dd>Design #${d.id}</dd></div>
            ${d.description ? `<div><dt>Notes</dt><dd>${escapeHtml(d.description)}</dd></div>` : ''}
          </dl>

          <div class="field" style="max-width:170px">
            <label for="qty">Quantity</label>
            <div class="qty" style="width:100%">
              <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
              <span id="qty" data-qty>1</span>
              <button type="button" data-step="1" aria-label="Increase quantity">+</button>
            </div>
          </div>

          <div class="detail__actions">
            <button class="btn btn--thread" type="button" id="add-btn">Add to cart</button>
            <a class="btn btn--wa" href="#" id="buy-now">Order on WhatsApp</a>
            <a class="btn btn--ghost" href="/cart">Go to cart</a>
          </div>

          <div class="detail__note">
            Colours and stitch density can be matched to your fabric. Send the design with a note about your measurement or garment and we will confirm on WhatsApp before starting.
          </div>
        </div>
      </div>`;

    wireDetail(d);
  }

  function sectionLabel(slug, settings) {
    const found = (settings.sections || []).find((s) => s.slug === slug);
    if (found) return found.name;
    return slug === 'embroidery' ? 'Computer Embroidery' : slug === 'maggam' ? 'Maggam Work' : slug;
  }

  function wireDetail(d) {
    let qty = 1;
    const qtyEl = document.querySelector('[data-qty]');
    document.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        qty = Math.min(Math.max(qty + Number(btn.dataset.step), 1), 99);
        qtyEl.textContent = String(qty);
      });
    });

    document.getElementById('add-btn').addEventListener('click', () => {
      cart.add(d, qty);
      toast(`${qty} × ${d.title} added to your cart`);
      const btn = document.getElementById('add-btn');
      const original = btn.textContent;
      btn.textContent = 'Added ✓';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
    });

    document.getElementById('buy-now').addEventListener('click', async (event) => {
      event.preventDefault();
      const btn = event.currentTarget;
      btn.setAttribute('aria-disabled', 'true');
      try {
        const result = await API.post('/api/orders/checkout', { items: [{ id: d.id, qty }] });
        window.open(result.whatsappUrl, '_blank', 'noopener');
      } catch (err) {
        toast(err.message);
      } finally {
        btn.removeAttribute('aria-disabled');
      }
    });
  }

  function renderRelated(related) {
    if (!related || related.length === 0) return;
    document.getElementById('related-band').hidden = false;
    document.getElementById('related-grid').innerHTML = related.map((d, i) => designCard(d, { index: i })).join('');
  }

  boot();
})();
