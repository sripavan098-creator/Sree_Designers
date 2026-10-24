/* Static-catalogue shim.
 *
 * The full app is a Node server backed by SQLite. On a static host (Vercel)
 * there is no server, so this file answers the handful of read-only API calls
 * the shop front makes, using a catalogue snapshot built at deploy time.
 *
 * It works by replacing window.fetch rather than window.Studio.API, because
 * app.js calls the API from module-scoped closures that a later override of
 * Studio.API would not reach. Intercepting at the network layer means every
 * code path sees the snapshot, with no changes to the page scripts.
 *
 * Scope: the customer-facing shop only. The admin console, sign-in, uploads and
 * the orders table all need the real server and are deliberately unsupported
 * here — they fail loudly rather than appearing to work.
 */
(function () {
  'use strict';

  var SNAPSHOT = null;
  var loading = null;
  var nativeFetch = window.fetch.bind(window);

  function load() {
    if (SNAPSHOT) return Promise.resolve(SNAPSHOT);
    if (!loading) {
      loading = nativeFetch('/catalogue.json', { cache: 'no-cache' })
        .then(function (r) {
          if (!r.ok) throw new Error('catalogue.json missing');
          return r.json();
        })
        .then(function (data) { SNAPSHOT = data; return data; })
        .catch(function (err) { loading = null; throw err; });
    }
    return loading;
  }

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function fail(message, status) {
    return json({ error: message }, status || 501);
  }

  function sectionName(snapshot, slug) {
    var found = (snapshot.sections || []).filter(function (s) { return s.slug === slug; })[0];
    return found ? found.name : slug;
  }

  /* Mirrors the server's design serialiser so page scripts need no changes. */
  function shape(snapshot, d) {
    var cat = (snapshot.categories || []).filter(function (c) { return c.id === d.categoryId; })[0] || {};
    return {
      id: d.id,
      title: d.title,
      description: d.description || '',
      price: d.price || 0,
      imageUrl: d.imageUrl,
      featured: !!d.featured,
      categoryId: d.categoryId,
      categoryName: cat.name || '',
      categorySlug: cat.slug || '',
      section: cat.section || '',
      createdAt: d.createdAt || null,
    };
  }

  function filterDesigns(snapshot, params) {
    var list = snapshot.designs.slice();

    var section = params.get('section');
    if (section) {
      list = list.filter(function (d) {
        var cat = (snapshot.categories || []).filter(function (c) { return c.id === d.categoryId; })[0];
        return cat && cat.section === section;
      });
    }

    var category = params.get('category');
    if (category) {
      var match = (snapshot.categories || []).filter(function (c) { return c.slug === category; })[0];
      if (match) list = list.filter(function (d) { return d.categoryId === match.id; });
    }

    if (params.get('featured') === '1') {
      list = list.filter(function (d) { return !!d.featured; });
    }

    if (params.get('q')) {
      var q = params.get('q').toLowerCase();
      list = list.filter(function (d) { return String(d.title).toLowerCase().indexOf(q) !== -1; });
    }

    var limit = Number(params.get('limit'));
    if (limit > 0) list = list.slice(0, limit);

    return list.map(function (d) { return shape(snapshot, d); });
  }

  function buildWhatsAppUrl(snapshot, rawItems, note) {
    var digits = String((snapshot.settings && snapshot.settings.whatsappNumber) || '').replace(/[^\d]/g, '');
    if (!digits) return null;

    var lines = [];
    lines.push('*New order from ' + (snapshot.settings.businessName || 'the studio') + '*');
    lines.push('');

    var total = 0;
    var count = 0;

    rawItems.slice(0, 50).forEach(function (raw) {
      var design = snapshot.designs.filter(function (d) { return d.id === Number(raw && raw.id); })[0];
      if (!design) return;
      var cat = (snapshot.categories || []).filter(function (c) { return c.id === design.categoryId; })[0] || {};
      var qty = Math.min(Math.max(Number(raw && raw.qty) || 1, 1), 99);
      count += 1;

      lines.push(count + '. ' + design.title);
      lines.push('   Category: ' + (cat.name || '') + ' (' + sectionName(snapshot, cat.section) + ')');
      if (design.price > 0) {
        lines.push('   Price: INR ' + Number(design.price).toFixed(2));
        total += design.price * qty;
      }
      lines.push('   Qty: ' + qty);
      lines.push('   Photo: ' + window.location.origin + design.imageUrl);
      lines.push('');
    });

    if (count === 0) return null;
    if (total > 0) { lines.push('Estimated total: INR ' + total.toFixed(2), ''); }
    if (note) lines.push('Notes: ' + note, '');
    lines.push('Please confirm availability and share payment details.');

    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  function handle(url, init) {
    var path = url.pathname;
    var params = url.searchParams;
    var method = ((init && init.method) || 'GET').toUpperCase();

    return load().then(function (snapshot) {
      /* ---- reads the shop front needs ---- */
      if (path === '/api/settings') {
        return json({
          businessName: snapshot.settings.businessName,
          tagline: snapshot.settings.tagline,
          logoUrl: snapshot.settings.logoUrl || '',
          whatsappConfigured: !!String(snapshot.settings.whatsappNumber || '').replace(/[^\d]/g, ''),
          sections: snapshot.sections || [],
        });
      }

      if (path === '/api/categories') {
        var cats = snapshot.categories.slice();
        var section = params.get('section');
        if (section) cats = cats.filter(function (c) { return c.section === section; });
        return json({
          categories: cats.map(function (c) {
            return {
              id: c.id,
              name: c.name,
              slug: c.slug,
              section: c.section,
              blurb: c.blurb || '',
              designCount: snapshot.designs.filter(function (d) { return d.categoryId === c.id; }).length,
            };
          }),
        });
      }

      if (path === '/api/designs') {
        return json({ designs: filterDesigns(snapshot, params) });
      }

      var detail = path.match(/^\/api\/designs\/(\d+)$/);
      if (detail) {
        var id = Number(detail[1]);
        var found = snapshot.designs.filter(function (d) { return d.id === id; })[0];
        if (!found) return fail('That design is no longer available.', 404);
        var design = shape(snapshot, found);
        var related = snapshot.designs
          .filter(function (d) { return d.categoryId === found.categoryId && d.id !== id; })
          .slice(0, 4)
          .map(function (d) { return shape(snapshot, d); });
        return json({ design: design, related: related });
      }

      /* ---- no accounts on a static host ---- */
      if (path === '/api/auth/me') return json({ user: null });

      /* ---- checkout: built in the browser from the snapshot ---- */
      if (path === '/api/orders/checkout' && method === 'POST') {
        var body = {};
        try { body = JSON.parse((init && init.body) || '{}'); } catch (e) { body = {}; }
        var waUrl = buildWhatsAppUrl(snapshot, body.items || [], String(body.note || '').slice(0, 500));
        if (!waUrl) {
          return fail('The studio WhatsApp number has not been set yet. Please try again shortly.', 503);
        }
        return json({ orderId: 0, whatsappUrl: waUrl });
      }

      /* ---- everything else needs the real server ---- */
      return fail(
        'This is the static shop preview. Sign-in, the admin console and order history need the full server.',
        501
      );
    });
  }

  window.fetch = function (input, init) {
    var url;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
    } catch (e) {
      return nativeFetch(input, init);
    }
    if (url.origin === window.location.origin && url.pathname.indexOf('/api/') === 0) {
      return handle(url, init).catch(function (err) {
        return fail('Could not load the catalogue: ' + err.message, 500);
      });
    }
    return nativeFetch(input, init);
  };
})();
