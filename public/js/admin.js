'use strict';
(function () {
  const { API, escapeHtml, money, toast, emptyState, chrome, debounce } = window.Studio;

  let settings = {};
  let categories = [];
  let designs = [];
  let users = [];
  let files = [];
  let editId = null;

  /* ---------------- boot ---------------- */

  async function boot() {
    settings = await chrome.loadSettings();
    document.querySelectorAll('[data-brand-name]').forEach((el) => {
      if (settings.businessName) el.textContent = settings.businessName;
    });

    const user = await chrome.getSession(true);
    if (!user) return showSignin();
    if (user.role !== 'admin') {
      document.getElementById('signin').hidden = false;
      showSigninError('That account is a customer login, not an admin.');
      return;
    }
    await showConsole();
  }

  function showSigninError(message) {
    const box = document.getElementById('signin-err');
    box.textContent = message;
    box.hidden = !message;
  }

  function showSignin() {
    document.getElementById('signin').hidden = false;
    document.getElementById('admin-shell').hidden = true;
    const form = document.getElementById('signin-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showSigninError('');
      const btn = document.getElementById('signin-submit');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const data = await API.post('/api/auth/login', {
          email: document.getElementById('admin-email').value.trim(),
          password: document.getElementById('admin-password').value,
        });
        if (data.user.role !== 'admin') throw new Error('That account is a customer login, not an admin.');
        await showConsole();
      } catch (err) {
        showSigninError(err.message);
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
  }

  async function showConsole() {
    document.getElementById('signin').hidden = true;
    document.getElementById('admin-shell').hidden = false;
    chrome.renderAdminBar('Studio console');

    document.getElementById('signout').addEventListener('click', async () => {
      await API.post('/api/auth/logout');
      window.location.href = '/';
    });

    wireTabs();
    wireUpload();
    wireCategoryForm();
    wireUserForm();
    wireSettings();
    wireFilters();

    if (window.location.hash === '#settings') selectTab('settings');

    await refreshAll();
  }

  async function refreshAll() {
    await Promise.all([loadOverview(), loadCategories(), loadDesigns(), loadUsers(), loadOrders()]);
  }

  /* ---------------- tabs ---------------- */

  function selectTab(name) {
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.hidden = panel.id !== `panel-${name}`;
    });
  }

  function wireTabs() {
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    });
  }

  /* ---------------- overview ---------------- */

  async function loadOverview() {
    try {
      const data = await API.get('/api/admin/overview');
      const host = document.getElementById('stats');
      const cards = [
        ['Designs', data.counts.designs],
        ['Featured', data.counts.featured],
        ['Categories', data.counts.categories],
        ['Customer logins', data.counts.users],
        ['Orders', data.counts.orders],
      ];
      host.innerHTML = cards.map(([label, value]) => `
        <div class="statcard"><b>${value}</b><span>${escapeHtml(label)}</span></div>`).join('');
      if (!data.whatsappNumber) {
        host.insertAdjacentHTML('beforeend', `
          <div class="statcard" style="border-color:var(--thread);background:rgba(184,58,36,.06)">
            <b style="font-size:1rem;font-family:var(--font-body);font-weight:700">WhatsApp not set</b>
            <span>Customers cannot buy yet</span>
            <button class="linkbtn" type="button" id="go-settings" style="margin-top:8px">Open settings</button>
          </div>`);
        document.getElementById('go-settings').addEventListener('click', () => selectTab('settings'));
      }
      document.getElementById('set-name').value = data.businessName || '';
      document.getElementById('set-tagline').value = data.tagline || '';
      document.getElementById('set-whatsapp').value = data.whatsappNumber || '';
      paintLogoPreview(data.logoUrl || '');
    } catch (err) {
      toast(err.message);
    }
  }

  /* ---------------- upload ---------------- */

  function sectionOptions() {
    return (settings.sections || [
      { slug: 'embroidery', name: 'Computer Embroidery' },
      { slug: 'maggam', name: 'Maggam Work' },
    ]);
  }

  function fillSectionSelect(select, includeAll) {
    const opts = sectionOptions().map((s) => `<option value="${s.slug}">${escapeHtml(s.name)}</option>`).join('');
    select.innerHTML = (includeAll ? '<option value="">All sections</option>' : '') + opts;
  }

  function fillCategorySelect(select, section, includeAll) {
    const list = section ? categories.filter((c) => c.section === section) : categories;
    const opts = list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    select.innerHTML = (includeAll ? '<option value="">All categories</option>' : '') +
      (opts || '<option value="" disabled>No categories yet</option>');
  }

  function wireUpload() {
    const sectionSel = document.getElementById('up-section');
    const catSel = document.getElementById('up-category');
    fillSectionSelect(sectionSel, false);
    syncUploadCategories();

    sectionSel.addEventListener('change', syncUploadCategories);

    const drop = document.getElementById('drop');
    const input = document.getElementById('up-files');

    const openPicker = () => input.click();
    drop.addEventListener('click', openPicker);
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });

    ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
    }));
    drop.addEventListener('drop', (e) => {
      addFiles(Array.from(e.dataTransfer.files || []));
    });

    input.addEventListener('change', () => {
      addFiles(Array.from(input.files || []));
      input.value = '';
    });

    document.getElementById('upload-form').addEventListener('submit', submitUpload);
  }

  function syncUploadCategories() {
    fillCategorySelect(document.getElementById('up-category'), document.getElementById('up-section').value, false);
  }

  function addFiles(incoming) {
    const images = incoming.filter((f) => f.type.startsWith('image/'));
    const rejected = incoming.length - images.length;
    const tooBig = images.filter((f) => f.size > 8 * 1024 * 1024);
    files = files.concat(images.filter((f) => f.size <= 8 * 1024 * 1024));
    if (rejected) toast(`${rejected} file(s) skipped — images only`);
    if (tooBig.length) toast(`${tooBig.length} file(s) skipped — over 8 MB`);
    paintPreviews();
  }

  function paintPreviews() {
    const host = document.getElementById('previews');
    host.innerHTML = files.map((f, i) => `
      <div class="preview">
        <img src="${URL.createObjectURL(f)}" alt="">
        <button type="button" class="lightbox__close" style="position:absolute;top:2px;right:2px;width:22px;height:22px;font-size:.8rem;background:rgba(29,27,38,.75)" data-drop-file="${i}" aria-label="Remove">×</button>
      </div>`).join('');
    host.querySelectorAll('[data-drop-file]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        files.splice(Number(btn.dataset.dropFile), 1);
        paintPreviews();
      });
    });
  }

  async function submitUpload(event) {
    event.preventDefault();
    const ok = document.getElementById('upload-ok');
    const err = document.getElementById('upload-err');
    ok.hidden = true;
    err.hidden = true;

    if (files.length === 0) {
      err.textContent = 'Add at least one photo.';
      err.hidden = false;
      return;
    }

    const form = new FormData();
    form.append('categoryId', document.getElementById('up-category').value);
    form.append('title', document.getElementById('up-title').value);
    form.append('description', document.getElementById('up-description').value);
    form.append('price', document.getElementById('up-price').value || '0');
    form.append('featured', document.getElementById('up-featured').checked ? '1' : '0');
    files.forEach((f) => form.append('images', f, f.name));

    const btn = document.getElementById('upload-submit');
    btn.disabled = true;
    btn.textContent = `Uploading ${files.length}…`;

    try {
      const data = await API.upload('/api/admin/designs', form);
      ok.textContent = `${data.count} design${data.count === 1 ? '' : 's'} published.`;
      ok.hidden = false;
      files = [];
      paintPreviews();
      document.getElementById('upload-form').reset();
      syncUploadCategories();
      await Promise.all([loadDesigns(), loadOverview(), loadCategories()]);
      toast(`${data.count} design${data.count === 1 ? '' : 's'} uploaded`);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload designs';
    }
  }

  /* ---------------- designs ---------------- */

  async function loadDesigns() {
    try {
      const data = await API.get('/api/admin/designs');
      designs = data.designs;
      renderDesigns();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderDesigns() {
    const host = document.getElementById('designs-table');
    const sectionFilter = document.getElementById('filter-section').value;
    const catFilter = document.getElementById('filter-category').value;

    let list = designs;
    if (sectionFilter) list = list.filter((d) => d.section === sectionFilter);
    if (catFilter) list = list.filter((d) => String(d.categoryId) === String(catFilter));

    if (list.length === 0) {
      host.innerHTML = `<tbody><tr><td colspan="6" style="padding:30px;text-align:center" class="muted">No designs match this filter.</td></tr></tbody>`;
      return;
    }

    host.innerHTML = `
      <thead><tr><th></th><th>Title</th><th>Category</th><th>Price</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((d) => `
        <tr>
          <td><img class="table__thumb" src="${escapeHtml(d.imageUrl)}" alt=""></td>
          <td>
            <strong>${escapeHtml(d.title)}</strong>
            <div class="tiny muted">#${d.id}${d.featured ? ' · featured' : ''}</div>
          </td>
          <td class="tiny">${escapeHtml(d.categoryName)}<div class="muted">${escapeHtml(sectionLabel(d.section))}</div></td>
          <td class="tiny">${d.price > 0 ? money(d.price) : '<span class="muted">On request</span>'}</td>
          <td class="tiny">${d.active ? '<span style="color:var(--teal);font-weight:700">Live</span>' : '<span class="muted">Hidden</span>'}</td>
          <td>
            <div class="row-actions">
              <button class="linkbtn" type="button" data-edit="${d.id}">Edit</button>
              <button class="linkbtn" type="button" data-toggle="${d.id}">${d.active ? 'Hide' : 'Show'}</button>
              <button class="linkbtn linkbtn--danger" type="button" data-del="${d.id}">Delete</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>`;

    host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(Number(b.dataset.edit))));
    host.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleDesign(Number(b.dataset.toggle))));
    host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteDesign(Number(b.dataset.del))));
  }

  function sectionLabel(slug) {
    const found = sectionOptions().find((s) => s.slug === slug);
    return found ? found.name : slug;
  }

  function wireFilters() {
    fillSectionSelect(document.getElementById('filter-section'), true);
    fillCategorySelect(document.getElementById('filter-category'), '', true);
    document.getElementById('filter-section').addEventListener('change', () => {
      fillCategorySelect(document.getElementById('filter-category'), document.getElementById('filter-section').value, true);
      renderDesigns();
    });
    document.getElementById('filter-category').addEventListener('change', renderDesigns);
  }

  function openEdit(id) {
    const d = designs.find((x) => x.id === id);
    if (!d) return;
    editId = id;
    let panel = document.getElementById('edit-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'edit-panel';
      panel.className = 'card';
      panel.style.marginBottom = '22px';
      const table = document.getElementById('designs-table');
      table.parentElement.parentElement.insertBefore(panel, table.parentElement);
    }
    panel.hidden = false;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:16px">
        <div>
          <p class="eyebrow" style="margin-bottom:.4em">Editing design #${d.id}</p>
          <h3 style="margin:0">${escapeHtml(d.title)}</h3>
        </div>
        <button class="linkbtn" type="button" id="edit-cancel">Close</button>
      </div>
      <div class="alert alert--err" id="edit-err" hidden></div>
      <form id="edit-form">
        <div style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:22px;align-items:start" id="edit-grid">
          <div>
            <img src="${escapeHtml(d.imageUrl)}" alt="" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:3px;border:1px solid var(--line)">
            <div class="field" style="margin-top:10px">
              <label for="edit-image">Replace photo</label>
              <input type="file" id="edit-image" accept="image/*" style="font-size:.78rem">
            </div>
          </div>
          <div>
            <div class="field--row">
              <div class="field">
                <label for="edit-section">Section</label>
                <select id="edit-section">${sectionOptions().map((s) => `<option value="${s.slug}"${s.slug === d.section ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
              </div>
              <div class="field">
                <label for="edit-category">Category</label>
                <select id="edit-category"></select>
              </div>
            </div>
            <div class="field">
              <label for="edit-title">Title</label>
              <input type="text" id="edit-title" maxlength="90" value="${escapeHtml(d.title)}">
            </div>
            <div class="field">
              <label for="edit-description">Description</label>
              <textarea id="edit-description" maxlength="600">${escapeHtml(d.description || '')}</textarea>
            </div>
            <div class="field--row">
              <div class="field">
                <label for="edit-price">Price (₹)</label>
                <input type="number" id="edit-price" min="0" step="1" value="${d.price || 0}">
              </div>
              <div class="field" style="display:flex;align-items:flex-end;padding-bottom:14px;gap:18px;flex-wrap:wrap">
                <label class="check"><input type="checkbox" id="edit-featured"${d.featured ? ' checked' : ''}> Featured</label>
                <label class="check"><input type="checkbox" id="edit-active"${d.active ? ' checked' : ''}> Visible</label>
              </div>
            </div>
            <button class="btn btn--thread btn--sm" type="submit" id="edit-save">Save changes</button>
          </div>
        </div>
      </form>`;

    const fillEditCats = () => fillCategorySelect(document.getElementById('edit-category'), document.getElementById('edit-section').value, false);
    fillEditCats();
    document.getElementById('edit-category').value = String(d.categoryId);
    document.getElementById('edit-section').addEventListener('change', fillEditCats);
    document.getElementById('edit-cancel').addEventListener('click', () => { panel.hidden = true; editId = null; });

    document.getElementById('edit-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const err = document.getElementById('edit-err');
      err.hidden = true;
      const form = new FormData();
      form.append('categoryId', document.getElementById('edit-category').value);
      form.append('title', document.getElementById('edit-title').value);
      form.append('description', document.getElementById('edit-description').value);
      form.append('price', document.getElementById('edit-price').value || '0');
      form.append('featured', document.getElementById('edit-featured').checked ? '1' : '0');
      form.append('active', document.getElementById('edit-active').checked ? '1' : '0');
      const img = document.getElementById('edit-image').files[0];
      if (img) form.append('images', img, img.name);

      const save = document.getElementById('edit-save');
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        await API.upload(`/api/admin/designs/${d.id}`, form);
        panel.hidden = true;
        editId = null;
        await Promise.all([loadDesigns(), loadOverview(), loadCategories()]);
        toast('Design updated');
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      } finally {
        save.disabled = false;
        save.textContent = 'Save changes';
      }
    });

    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function toggleDesign(id) {
    const d = designs.find((x) => x.id === id);
    if (!d) return;
    const form = new FormData();
    form.append('active', d.active ? '0' : '1');
    try {
      await API.upload(`/api/admin/designs/${id}`, form);
      await loadDesigns();
      toast(d.active ? 'Design hidden from the shop' : 'Design is live again');
    } catch (err) {
      toast(err.message);
    }
  }

  async function deleteDesign(id) {
    const d = designs.find((x) => x.id === id);
    if (!window.confirm(`Delete “${d ? d.title : 'this design'}”? The photo is removed too. This cannot be undone.`)) return;
    try {
      await API.del(`/api/admin/designs/${id}`);
      if (editId === id) {
        const panel = document.getElementById('edit-panel');
        if (panel) panel.hidden = true;
        editId = null;
      }
      await Promise.all([loadDesigns(), loadOverview(), loadCategories()]);
      toast('Design deleted');
    } catch (err) {
      toast(err.message);
    }
  }

  /* ---------------- categories ---------------- */

  async function loadCategories() {
    try {
      const data = await API.get('/api/admin/categories');
      categories = data.categories;
      renderCategories();
      syncUploadCategories();
      fillCategorySelect(document.getElementById('filter-category'), document.getElementById('filter-section').value, true);
      if (document.getElementById('cat-section').options.length === 0) {
        fillSectionSelect(document.getElementById('cat-section'), false);
      }
    } catch (err) {
      toast(err.message);
    }
  }

  function renderCategories() {
    sectionOptions().forEach((section) => {
      const host = document.getElementById(`cats-${section.slug}`);
      if (!host) return;
      const list = categories.filter((c) => c.section === section.slug);
      host.innerHTML = `
        <h3 style="font-size:1.1rem">${escapeHtml(section.name)} <span class="muted tiny" style="font-weight:400">${list.length} categor${list.length === 1 ? 'y' : 'ies'}</span></h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Description</th><th>Designs</th><th></th></tr></thead>
            <tbody>${list.map((c) => `
              <tr>
                <td><input type="text" value="${escapeHtml(c.name)}" data-cat-name="${c.id}" maxlength="60" style="padding:7px 9px;border:1px solid var(--line);border-radius:3px;background:var(--paper);font-family:var(--font-body);width:100%"></td>
                <td><input type="text" value="${escapeHtml(c.blurb || '')}" data-cat-blurb="${c.id}" maxlength="240" style="padding:7px 9px;border:1px solid var(--line);border-radius:3px;background:var(--paper);font-family:var(--font-body);width:100%"></td>
                <td class="tiny">${c.designCount}</td>
                <td>
                  <div class="row-actions">
                    <button class="linkbtn" type="button" data-cat-save="${c.id}">Save</button>
                    <button class="linkbtn linkbtn--danger" type="button" data-cat-del="${c.id}">Delete</button>
                  </div>
                </td>
              </tr>`).join('') || '<tr><td colspan="4" class="muted tiny" style="padding:16px">No categories in this section yet.</td></tr>'}
            </tbody>
          </table>
        </div>`;

      host.querySelectorAll('[data-cat-save]').forEach((b) => b.addEventListener('click', () => saveCategory(Number(b.dataset.catSave))));
      host.querySelectorAll('[data-cat-del]').forEach((b) => b.addEventListener('click', () => deleteCategory(Number(b.dataset.catDel))));
    });
  }

  async function saveCategory(id) {
    const name = document.querySelector(`[data-cat-name="${id}"]`).value;
    const blurb = document.querySelector(`[data-cat-blurb="${id}"]`).value;
    try {
      await API.post(`/api/admin/categories/${id}`, { name, blurb });
      await Promise.all([loadCategories(), loadDesigns()]);
      toast('Category updated');
    } catch (err) {
      toast(err.message);
    }
  }

  async function deleteCategory(id) {
    const cat = categories.find((c) => c.id === id);
    const count = cat ? cat.designCount : 0;
    const warning = count > 0
      ? `“${cat.name}” has ${count} design${count === 1 ? '' : 's'}. Deleting it removes those designs and their photos. Continue?`
      : `Delete the category “${cat ? cat.name : id}”?`;
    if (!window.confirm(warning)) return;
    try {
      await API.del(`/api/admin/categories/${id}`);
      await Promise.all([loadCategories(), loadDesigns(), loadOverview()]);
      toast('Category deleted');
    } catch (err) {
      toast(err.message);
    }
  }

  function wireCategoryForm() {
    document.getElementById('cat-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = document.getElementById('cat-ok');
      const err = document.getElementById('cat-err');
      ok.hidden = true;
      err.hidden = true;
      try {
        await API.post('/api/admin/categories', {
          name: document.getElementById('cat-name').value,
          section: document.getElementById('cat-section').value,
          blurb: document.getElementById('cat-blurb').value,
        });
        document.getElementById('cat-form').reset();
        fillSectionSelect(document.getElementById('cat-section'), false);
        await loadCategories();
        ok.textContent = 'Category added.';
        ok.hidden = false;
        toast('Category added');
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });
  }

  /* ---------------- users ---------------- */

  async function loadUsers() {
    try {
      const data = await API.get('/api/admin/users');
      users = data.users;
      renderUsers();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderUsers() {
    const host = document.getElementById('users-table');
    if (users.length === 0) {
      host.innerHTML = '<tbody><tr><td class="muted" style="padding:20px">No customer logins yet. Create the first one on the right.</td></tr></tbody>';
      return;
    }
    host.innerHTML = `
      <thead><tr><th>Email</th><th>Name</th><th>Phone</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map((u) => `
        <tr>
          <td class="tiny">${escapeHtml(u.email)}</td>
          <td class="tiny">${escapeHtml(u.name || '—')}</td>
          <td class="tiny">${escapeHtml(u.phone || '—')}</td>
          <td class="tiny">${u.active ? '<span style="color:var(--teal);font-weight:700">Active</span>' : '<span class="muted">Disabled</span>'}</td>
          <td>
            <div class="row-actions">
              <button class="linkbtn" type="button" data-user-toggle="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>
              <button class="linkbtn" type="button" data-user-pw="${u.id}">Reset password</button>
              <button class="linkbtn linkbtn--danger" type="button" data-user-del="${u.id}">Delete</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>`;

    host.querySelectorAll('[data-user-toggle]').forEach((b) => b.addEventListener('click', () => toggleUser(Number(b.dataset.userToggle))));
    host.querySelectorAll('[data-user-pw]').forEach((b) => b.addEventListener('click', () => resetUserPassword(Number(b.dataset.userPw))));
    host.querySelectorAll('[data-user-del]').forEach((b) => b.addEventListener('click', () => deleteUser(Number(b.dataset.userDel))));
  }

  async function toggleUser(id) {
    const u = users.find((x) => x.id === id);
    try {
      await API.post(`/api/admin/users/${id}`, { active: u.active ? '0' : '1' });
      await loadUsers();
      toast(u.active ? 'Login disabled' : 'Login enabled');
    } catch (err) {
      toast(err.message);
    }
  }

  async function resetUserPassword(id) {
    const u = users.find((x) => x.id === id);
    const next = generatePassword();
    if (!window.confirm(`Set a new password for ${u.email}?\n\nNew password: ${next}\n\nCopy it now — it is shown once.`)) return;
    try {
      await API.post(`/api/admin/users/${id}`, { password: next });
      await loadUsers();
      window.prompt('New password — copy and share with the customer:', next);
      toast('Password reset');
    } catch (err) {
      toast(err.message);
    }
  }

  async function deleteUser(id) {
    const u = users.find((x) => x.id === id);
    if (!window.confirm(`Delete the login for ${u.email}? Their past orders stay in your records.`)) return;
    try {
      await API.del(`/api/admin/users/${id}`);
      await Promise.all([loadUsers(), loadOverview()]);
      toast('Login deleted');
    } catch (err) {
      toast(err.message);
    }
  }

  function generatePassword() {
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint32Array(16);
    crypto.getRandomValues(bytes);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
    return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12), chars.slice(12, 16)]
      .map((g) => g.join('')).join('-');
  }

  function wireUserForm() {
    document.getElementById('gen-password').addEventListener('click', () => {
      document.getElementById('user-password').value = generatePassword();
    });

    document.getElementById('user-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = document.getElementById('user-ok');
      const err = document.getElementById('user-err');
      ok.hidden = true;
      err.hidden = true;
      const email = document.getElementById('user-email').value.trim();
      const password = document.getElementById('user-password').value;
      try {
        await API.post('/api/admin/users', {
          email,
          name: document.getElementById('user-name').value,
          phone: document.getElementById('user-phone').value,
          password,
        });
        document.getElementById('user-form').reset();
        await Promise.all([loadUsers(), loadOverview()]);
        ok.innerHTML = `Login created for <strong>${escapeHtml(email)}</strong>. Share this password: <code>${escapeHtml(password)}</code>`;
        ok.hidden = false;
        toast('Customer login created');
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });
  }

  /* ---------------- orders ---------------- */

  async function loadOrders() {
    const host = document.getElementById('orders-table');
    try {
      const data = await API.get('/api/admin/orders');
      if (data.orders.length === 0) {
        host.innerHTML = '<tbody><tr><td class="muted" style="padding:20px">No orders yet. When a customer presses buy, it appears here.</td></tr></tbody>';
        return;
      }
      host.innerHTML = `
        <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Note</th></tr></thead>
        <tbody>${data.orders.map((o) => `
          <tr>
            <td class="tiny"><strong>#${o.id}</strong><div class="muted">${escapeHtml(o.createdAt)}</div></td>
            <td class="tiny">${escapeHtml(o.userEmail)}</td>
            <td class="tiny">${o.items.map((i) => `${escapeHtml(i.title)} × ${i.qty}`).join('<br>')}</td>
            <td class="tiny">${o.total > 0 ? money(o.total) : '<span class="muted">On request</span>'}</td>
            <td class="tiny">${escapeHtml(o.note || '—')}</td>
          </tr>`).join('')}
        </tbody>`;
    } catch (err) {
      host.innerHTML = `<tbody><tr><td class="muted" style="padding:20px">${escapeHtml(err.message)}</td></tr></tbody>`;
    }
  }

  /* ---------------- settings ---------------- */

  function paintLogoPreview(url) {
    const host = document.getElementById('logo-preview');
    host.innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="Current logo" style="width:72px;height:72px;object-fit:contain;border:1px solid var(--line);border-radius:50%;background:var(--paper);padding:4px">`
      : '<p class="tiny muted" style="margin:0">No logo uploaded — the site uses the default monogram.</p>';
  }

  function wireSettings() {
    document.getElementById('logo-save').addEventListener('click', async () => {
      const ok = document.getElementById('logo-ok');
      const err = document.getElementById('logo-err');
      ok.hidden = true;
      err.hidden = true;
      const input = document.getElementById('logo-file');
      const file = input.files[0];
      if (!file) {
        err.textContent = 'Choose a logo image first.';
        err.hidden = false;
        return;
      }
      const form = new FormData();
      form.append('logo', file, file.name);
      try {
        const data = await API.upload('/api/admin/logo', form);
        paintLogoPreview(data.logoUrl);
        settings = { ...settings, logoUrl: data.logoUrl };
        input.value = '';
        ok.textContent = 'Logo updated across the site.';
        ok.hidden = false;
        toast('Logo updated');
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });

    document.getElementById('logo-clear').addEventListener('click', async () => {
      const ok = document.getElementById('logo-ok');
      const err = document.getElementById('logo-err');
      ok.hidden = true;
      err.hidden = true;
      if (!window.confirm('Remove the logo and go back to the default monogram?')) return;
      try {
        await API.del('/api/admin/logo');
        paintLogoPreview('');
        settings = { ...settings, logoUrl: '' };
        ok.textContent = 'Logo removed.';
        ok.hidden = false;
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });

    document.getElementById('settings-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = document.getElementById('set-ok');
      const err = document.getElementById('set-err');
      ok.hidden = true;
      err.hidden = true;
      try {
        const data = await API.post('/api/admin/settings', {
          businessName: document.getElementById('set-name').value,
          tagline: document.getElementById('set-tagline').value,
          whatsappNumber: document.getElementById('set-whatsapp').value,
        });
        settings = { ...settings, businessName: data.businessName, tagline: data.tagline, whatsappConfigured: Boolean(data.whatsappNumber) };
        ok.textContent = data.whatsappNumber
          ? 'Saved. Customers can now send carts to WhatsApp.'
          : 'Saved, but the WhatsApp number is still empty so buying is disabled.';
        ok.hidden = false;
        await loadOverview();
        toast('Settings saved');
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });

    document.getElementById('admin-pw-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = document.getElementById('pw-ok');
      const err = document.getElementById('pw-err');
      ok.hidden = true;
      err.hidden = true;
      const next = document.getElementById('admin-new-pw').value;
      if (next.length < 8) {
        err.textContent = 'Use at least 8 characters.';
        err.hidden = false;
        return;
      }
      try {
        await API.post('/api/auth/password', { newPassword: next });
        document.getElementById('admin-new-pw').value = '';
        ok.textContent = 'Admin password updated.';
        ok.hidden = false;
        toast('Password updated');
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });
  }

  boot();
})();
