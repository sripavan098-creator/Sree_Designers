'use strict';
(function () {
  const { API, escapeHtml, designCard, emptyState, skeletonGrid, chrome } = window.Studio;

  const STEPS = [
    { name: 'Open a design', blurb: 'Every photo opens full size so you can judge the stitch detail before you decide.' },
    { name: 'Add to cart', blurb: 'One button on every card and every design page. The cart follows you across the site.' },
    { name: 'Review the cart', blurb: 'Change quantities, drop what you do not want, and add a note about measurements.' },
    { name: 'Send on WhatsApp', blurb: 'One tap opens our chat with each design photo and your note already attached.' },
  ];

  async function boot() {
    chrome.renderHeader('/');
    const settings = await chrome.loadSettings();
    chrome.renderFooter(settings);

    renderSteps();

    try {
      const [featured, categories] = await Promise.all([
        API.get('/api/designs?featured=1&limit=8'),
        API.get('/api/categories'),
      ]);

      let designs = featured.designs;
      if (designs.length === 0) {
        const fallback = await API.get('/api/designs?limit=8');
        designs = fallback.designs;
      }

      renderStats(categories.categories, designs);
      renderHeroCollage(designs);
      renderFeatured(designs);
      renderSectionTiles(categories.categories, settings);
    } catch (err) {
      renderFeatured([], err.message);
      document.getElementById('hero-collage').innerHTML = '';
    }
  }

  function renderSteps() {
    document.getElementById('how-steps').innerHTML = STEPS.map((step, i) => `
      <article class="cat reveal" style="animation-delay:${i * 70}ms;min-height:170px">
        <span class="eyebrow" style="margin-bottom:.6em">Step ${i + 1}</span>
        <h3 class="cat__name">${escapeHtml(step.name)}</h3>
        <p class="cat__blurb">${escapeHtml(step.blurb)}</p>
      </article>`).join('');
  }

  function renderStats(categories, designs) {
    const featuredCount = designs.filter((d) => d.featured).length;
    const set = (key, value) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = String(value);
    };
    set('designs', designs.length);
    set('categories', categories.length);
    set('featured', featuredCount);
  }

  function renderHeroCollage(designs) {
    const host = document.getElementById('hero-collage');
    const picks = designs.slice(0, 3);
    if (picks.length === 0) {
      host.innerHTML = '<div class="skel skel-card" style="grid-column:1/-1"></div>';
      return;
    }
    host.innerHTML = picks.map((d) => `
      <figure><img src="${escapeHtml(d.imageUrl)}" alt="${escapeHtml(d.title)}" loading="eager"></figure>`).join('');
  }

  function renderFeatured(designs, error) {
    const host = document.getElementById('featured-grid');
    if (error) {
      host.innerHTML = emptyState('Nothing on display yet', 'Designs will appear here as soon as the studio uploads them.', '<a class="btn btn--ghost btn--sm" href="/account">Studio sign in</a>');
      return;
    }
    if (designs.length === 0) {
      host.innerHTML = emptyState('The gallery is being prepared', 'The studio is uploading photos right now. Please check back shortly.');
      return;
    }
    host.innerHTML = designs.map((d, i) => designCard(d, { index: i })).join('');
  }

  function renderSectionTiles(categories, settings) {
    const host = document.getElementById('section-tiles');
    const sections = (settings.sections || [
      { slug: 'embroidery', name: 'Computer Embroidery' },
      { slug: 'maggam', name: 'Maggam Work' },
    ]);

    host.innerHTML = sections.map((section, i) => {
      const cats = categories.filter((c) => c.section === section.slug);
      const count = cats.reduce((n, c) => n + c.designCount, 0);
      const names = cats.map((c) => c.name).join(' · ');
      return `
        <a class="cat reveal" href="/${section.slug}" style="animation-delay:${i * 80}ms">
          <span class="eyebrow" style="margin-bottom:.6em">${count} design${count === 1 ? '' : 's'}</span>
          <h3 class="cat__name">${escapeHtml(section.name)}</h3>
          <p class="cat__blurb">${escapeHtml(names || 'Categories coming soon.')}</p>
          <span class="cat__meta">Open section</span>
        </a>`;
    }).join('');
  }

  boot();
})();
