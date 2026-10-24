'use strict';
(function () {
  const { API, escapeHtml, money, toast, emptyState, chrome } = window.Studio;

  const card = document.querySelector('.card');

  async function boot() {
    const settings = await chrome.loadSettings();
    document.querySelectorAll('[data-brand-name]').forEach((el) => {
      if (settings.businessName) el.textContent = settings.businessName;
    });

    const user = await chrome.getSession(true);
    if (!user) return wireLogin();
    if (user.role === 'admin') {
      window.location.replace('/admin');
      return;
    }
    renderAccount(user);
  }

  function showError(message) {
    const box = document.getElementById('err');
    box.textContent = message;
    box.hidden = !message;
  }

  function wireLogin() {
    const form = document.getElementById('login-form');
    const submit = document.getElementById('submit');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showError('');
      const email = form.email.value.trim();
      const password = form.password.value;
      if (!email || !password) return showError('Enter your email and password.');

      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        const data = await API.post('/api/auth/login', { email, password });
        if (data.user.role === 'admin') {
          window.location.href = '/admin';
        } else {
          window.location.href = '/account';
        }
      } catch (err) {
        showError(err.message);
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    });
  }

  async function renderAccount(user) {
    card.innerHTML = `
      <p class="eyebrow">Signed in</p>
      <h1 style="font-size:1.6rem;margin-bottom:.2em">${escapeHtml(user.name || user.email)}</h1>
      <p class="muted tiny" style="margin-bottom:1.6em">${escapeHtml(user.email)}</p>

      <div class="alert alert--ok" id="ok" hidden></div>
      <div class="alert alert--err" id="err" hidden></div>

      <h3 style="font-size:1.05rem">Your details</h3>
      <form id="profile-form">
        <div class="field">
          <label for="name">Name</label>
          <input type="text" id="name" value="${escapeHtml(user.name)}" maxlength="80" placeholder="Your name">
        </div>
        <div class="field">
          <label for="phone">Phone / WhatsApp</label>
          <input type="tel" id="phone" value="${escapeHtml(user.phone)}" maxlength="30" placeholder="+91…">
          <p class="field__hint">We use this only to reach you about an order.</p>
        </div>
        <button class="btn btn--thread btn--sm" type="submit">Save details</button>
      </form>

      <hr style="border:none;border-top:1px solid var(--line-soft);margin:2em 0">

      <h3 style="font-size:1.05rem">Change password</h3>
      <form id="password-form">
        <div class="field">
          <label for="newPassword">New password</label>
          <input type="password" id="newPassword" minlength="8" autocomplete="new-password" placeholder="At least 8 characters">
        </div>
        <button class="btn btn--ghost btn--sm" type="submit">Update password</button>
      </form>

      <hr style="border:none;border-top:1px solid var(--line-soft);margin:2em 0">

      <h3 style="font-size:1.05rem">Your sent orders</h3>
      <div id="orders"><p class="tiny muted">Loading…</p></div>

      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:2em">
        <a class="btn btn--ghost btn--sm" href="/cart">Open cart</a>
        <button class="btn btn--ghost btn--sm" type="button" id="signout">Sign out</button>
      </div>`;

    document.getElementById('profile-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await API.post('/api/auth/profile', {
          name: document.getElementById('name').value,
          phone: document.getElementById('phone').value,
        });
        toast('Details saved');
        flash('ok', `Saved. We will use ${data.user.phone || 'your email'} to reach you.`);
      } catch (err) {
        flash('err', err.message);
      }
    });

    document.getElementById('password-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const next = document.getElementById('newPassword').value;
      if (next.length < 8) return flash('err', 'Use at least 8 characters.');
      try {
        await API.post('/api/auth/password', { newPassword: next });
        flash('ok', 'Password updated. You are still signed in on this device.');
        document.getElementById('newPassword').value = '';
      } catch (err) {
        flash('err', err.message);
      }
    });

    document.getElementById('signout').addEventListener('click', async () => {
      await API.post('/api/auth/logout');
      window.location.href = '/';
    });

    loadOrders();
  }

  function flash(kind, message) {
    const ok = document.getElementById('ok');
    const err = document.getElementById('err');
    ok.hidden = true;
    err.hidden = true;
    const box = kind === 'ok' ? ok : err;
    box.textContent = message;
    box.hidden = false;
  }

  async function loadOrders() {
    const host = document.getElementById('orders');
    try {
      const data = await API.get('/api/orders/mine');
      if (data.orders.length === 0) {
        host.innerHTML = '<p class="tiny muted">You have not sent an order yet. Add designs to your cart and press buy.</p>';
        return;
      }
      host.innerHTML = data.orders.map((o) => `
        <div style="border:1px solid var(--line);border-radius:3px;padding:12px 14px;margin-bottom:10px;background:var(--paper)">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <strong>Order #${o.id}</strong>
            <span class="tiny muted">${escapeHtml(o.createdAt)}</span>
          </div>
          <div class="tiny" style="margin-top:6px">${o.items.map((i) => `${escapeHtml(i.title)} × ${i.qty}`).join(' · ')}</div>
          <div class="tiny" style="margin-top:4px;color:var(--teal);font-weight:700">${o.total > 0 ? money(o.total) : 'Quoted on WhatsApp'}</div>
        </div>`).join('');
    } catch (err) {
      host.innerHTML = `<p class="tiny muted">${escapeHtml(err.message)}</p>`;
    }
  }

  boot();
})();
