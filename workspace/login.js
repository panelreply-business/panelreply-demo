(() => {
  'use strict';
  const form = document.getElementById('login-form');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const button = document.getElementById('sign-in');
  const error = document.getElementById('login-error');
  const status = document.getElementById('login-status');
  let pending = false;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    pending = true;
    error.hidden = true;
    error.textContent = '';
    status.textContent = 'Signing in…';
    button.disabled = true;
    username.disabled = true;
    password.disabled = true;
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username: username.value.trim(), password: password.value })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const fallback = response.status === 429
          ? 'Too many sign-in attempts. Please wait before trying again.'
          : 'Sign-in failed. Check your username and password and try again.';
        throw new Error(data?.error?.message || fallback);
      }
      if (!data?.user || typeof data.csrfToken !== 'string') throw new Error('The sign-in response was incomplete. Please try again.');
      const selectedProduct = document.body?.dataset?.productId;
      const homes = { callback: '/', spreadsheet: '/panels' };
      let home = '/';
      if (selectedProduct || data.product !== undefined) {
        if (!data.product || !Object.hasOwn(homes, data.product.id)
            || data.product.homePath !== homes[data.product.id]
            || (selectedProduct && data.product.id !== selectedProduct)) {
          throw new Error('The signed-in program could not be confirmed. Reload this page and try again.');
        }
        home = homes[data.product.id];
      }
      password.value = '';
      status.textContent = 'Signed in. Opening your workspace…';
      window.location.replace(home);
    } catch (cause) {
      error.textContent = cause instanceof TypeError
        ? 'Could not reach the workspace. Check your connection and try again.'
        : cause.message || 'Could not sign in. Please try again.';
      error.hidden = false;
      status.textContent = '';
      password.value = '';
      pending = false;
      button.disabled = false;
      username.disabled = false;
      password.disabled = false;
      password.focus();
    }
  });
})();
