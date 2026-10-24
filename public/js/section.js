'use strict';
(function () {
  const { API, escapeHtml, designCard, emptyState, skeletonGrid, chrome, qs, debounce } = window.Studio;

  const section = document.body.dataset.section;
  const SECTION_COPY = {
    embroidery: {
      eyebrow: 'Machine work',
      blurb: 'Digitised files, multi-head runs and clean satin borders. Choose a category to narrow the gallery, then open any photo for the full-size view.',
    },
    maggam: {
      eyebrow: 'Hand-set stones & aari work',
      blurb: 'Maggam work built on blouses — bridal sets, necklines and sleeves. Send your measurement with the cart note and we will confirm before starting.',
    },
  };

  let allDesigns = [];
  let categories = [];
  let activeCategory = qs('category') || '';

  async function boot() {
    chrome.renderHeader(`/${section}`);
    const settings = await chrome.loadSettings();
    chrome.renderFooter(settings);

    const sectionMeta = (settings.sections || []).find((s) => s.slug === section);
    if (sectionMeta) {
      document.querySelector('[data-section-title]').textContent = sectionMeta.name;
      document.querySelector('[data-crumb-current]').textContent = sectionMeta.name;
      document.title = `${sectionMeta.name} — ${settings.businessName || 'Studio'}`;
    }
    const copy = SECTION_COPY[section] || {};
    document.querySelector('[data-section-eyebrow]').textContent = copy.eyebrow || '';
    document.querySelector('[data-section-blurb]').textContent = copy.blurb || '';

    const grid = document.getElementById('design-grid');
    grid.innerHTML = skeletonGrid(8);

    try {
      const [designRes, catRes] = await Promise.all([
        API.get(`/api/designs?section=${encodeURIComponent(section)}&limit=300`),
        API.get(`/api/categories?section=${encodeURIComponent(section)}`),
      ]);
      allDesigns = designRes.designs;
      categories = catRes.categories;
      renderChips();
      renderGrid();
      renderTiles();
    } catch (err) {
      grid.innerHTML = emptyState('Could not load designs', err.message);
    }
  }

  function renderChips() {
    const host = document.getElementById('category-chips');
    const total = allDesigns.length;
    const chips = [
      `<button class="chip" type="button" data-cat="" aria-pressed="${activeCategory === ''}">All<span class="chip__n">${total}</span></button>`,
      ...categories.map((c) => {
        const n = allDesigns.filter((d) => d.categorySlug === c.slug).length;
        return `<button class="chip" type="button" data-cat="${escapeHtml(c.slug)}" aria-pressed="${activeCategory === c.slug}">${escapeHtml(c.name)}<span class="chip__n">${n}</span></button>`;
      }),
    ];
    host.innerHTML = chips.join('');

    host.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-cat]');
      if (!chip) return;
      activeCategory = chip.dataset.cat;
      host.querySelectorAll('[data-cat]').forEach((el) => {
        el.setAttribute('aria-pressed', String(el.dataset.cat === activeCategory));
      });
      const url = new URL(window.location.href);
      if (activeCategory) url.searchParams.set('category', activeCategory);
      else url.searchParams.delete('category');
      window.history.replaceState({}, '', url);
      renderGrid();
    });
  }

  function renderGrid() {
    const grid = document.getElementById('design-grid');
    const list = activeCategory ? allDesigns.filter((d) => d.categorySlug === activeCategory) : allDesigns;

    if (list.length === 0) {
      const label = activeCategory
        ? (categories.find((c) => c.slug === activeCategory) || {}).name || 'this category'
        : 'this section';
      grid.innerHTML = emptyState(
        'No designs here yet',
        `The studio has not published any photos under ${label} yet. Please check back soon.`,
        activeCategory ? '<button class="btn btn--ghost btn--sm" type="button" data-clear>Show all categories</button>' : ''
      );
      const clear = grid.querySelector('[data-clear]');
      if (clear) {
        clear.addEventListener('click', () => {
          activeCategory = '';
          const url = new URL(window.location.href);
          url.searchParams.delete('category');
          window.history.replaceState({}, '', url);
          document.querySelectorAll('[data-cat]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.cat === '')));
          renderGrid();
        });
      }
      return;
    }
    grid.innerHTML = list.map((d, i) => designCard(d, { index: i })).join('');
  }

  function renderTiles() {
    const host = document.getElementById('category-tiles');
    if (categories.length === 0) {
      host.innerHTML = emptyState('No categories yet', 'Categories appear here once the studio creates them.');
      return;
    }
    host.innerHTML = categories.map((c, i) => `
      <a class="cat reveal" href="/${section}?category=${encodeURIComponent(c.slug)}" data-goto-cat="${escapeHtml(c.slug)}" style="animation-delay:${i * 70}ms">
        <span class="eyebrow" style="margin-bottom:.6em">${c.designCount} design${c.designCount === 1 ? '' : 's'}</span>
        <h3 class="cat__name">${escapeHtml(c.name)}</h3>
        <p class="cat__blurb">${escapeHtml(c.blurb || '')}</p>
        <span class="cat__meta">Filter gallery</span>
      </a>`).join('');

    host.addEventListener('click', (event) => {
      const tile = event.target.closest('[data-goto-cat]');
      if (!tile) return;
      event.preventDefault();
      activeCategory = tile.dataset.gotoCat;
      document.querySelectorAll('[data-cat]').forEach((el) => {
        el.setAttribute('aria-pressed', String(el.dataset.cat === activeCategory));
      });
      const url = new URL(window.location.href);
      url.searchParams.set('category', activeCategory);
      window.history.replaceState({}, '', url);
      renderGrid();
      document.getElementById('design-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  boot();
})();
