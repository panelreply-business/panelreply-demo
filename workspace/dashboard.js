(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let csrfToken = '';
  let loading = false;
  let expired = false;
  function node(tag, text) { const result = document.createElement(tag); result.textContent = text; return result; }
  function expire() {
    expired = true;
    csrfToken = '';
    for (const id of ['dashboard-request-list', 'dashboard-project-list']) $(id).replaceChildren();
    for (const id of ['account-name', 'account-business', 'sidebar-business-name', 'signed-in-name']) $(id).textContent = '';
    window.location.replace('/login');
  }
  async function api(path, method = 'GET') {
    const headers = { Accept: 'application/json' };
    if (csrfToken) headers['X-Workspace-Session'] = csrfToken;
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) { expire(); throw new Error('Your session ended. Please sign in again.'); }
    const result = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok || (response.status !== 204 && !result)) throw new Error(result?.error?.message || 'The workspace could not be loaded. Try again.');
    return result;
  }
  function date(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
  function list(id, records, type) {
    const target = $(id);
    target.replaceChildren();
    if (!records.length) { const li = node('li', ''); li.append(node('p', type === 'project' ? 'No saved projects yet. Start in the panel workspace.' : 'No requests yet. Use the private customer preview with test details.')); target.append(li); return; }
    for (const record of [...records].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 4)) {
      const li = node('li', '');
      const link = node('a', '');
      link.href = type === 'project' ? `/panels?project=${encodeURIComponent(record.id)}` : `/?lead=${encodeURIComponent(record.id)}`;
      link.append(node('strong', type === 'project' ? record.name : record.customerName));
      link.append(node('span', type === 'project' ? `${record.rowCount} parts · ${record.unreviewedCount} to review` : record.job));
      link.append(node('span', `Updated ${date(record.updatedAt)}`));
      li.append(link);
      target.append(li);
    }
  }
  async function load() {
    if (loading) return;
    loading = true;
    $('retry-dashboard').disabled = true;
    $('dashboard-error').hidden = true;
    $('dashboard-status').textContent = 'Loading your workspace…';
    try {
      const session = await api('/api/session');
      if (expired) return;
      if (!session.user || typeof session.csrfToken !== 'string') throw new Error('Sign-in could not be confirmed. Reload the workspace.');
      if (csrfToken && csrfToken !== session.csrfToken) { expire(); return; }
      csrfToken = session.csrfToken;
      $('signed-in-name').textContent = session.user.username;
      $('account-name').textContent = session.user.username;
      const responses = await Promise.allSettled([api('/api/profile'), api('/api/leads'), api('/api/panel-projects')]);
      if (expired) return;
      const errors = [];
      const profile = responses[0];
      if (profile.status === 'fulfilled' && profile.value.business?.name) {
        $('sidebar-business-name').textContent = profile.value.business.name;
        $('account-business').textContent = profile.value.business.name;
      } else { errors.push('Business information could not be loaded.'); $('account-business').textContent = 'Unavailable'; $('sidebar-business-name').textContent = 'Business unavailable'; }
      const requests = responses[1];
      if (requests.status === 'fulfilled' && Array.isArray(requests.value.leads)) {
        $('dashboard-requests').textContent = requests.value.leads.filter(x => ['new', 'needs_review'].includes(x.status)).length;
        list('dashboard-request-list', requests.value.leads, 'request');
      } else { errors.push('Customer requests could not be loaded.'); $('dashboard-requests').textContent = '—'; $('dashboard-request-list').replaceChildren(node('li', 'Requests unavailable. Try again.')); }
      const projects = responses[2];
      if (projects.status === 'fulfilled' && Array.isArray(projects.value.projects)) {
        $('dashboard-projects').textContent = projects.value.projects.length;
        $('dashboard-unreviewed').textContent = projects.value.projects.reduce((n, project) => n + project.unreviewedCount, 0);
        list('dashboard-project-list', projects.value.projects, 'project');
      } else { errors.push('Panel projects could not be loaded.'); $('dashboard-projects').textContent = '—'; $('dashboard-unreviewed').textContent = '—'; $('dashboard-project-list').replaceChildren(node('li', 'Projects unavailable. Try again.')); }
      if (errors.length) throw new Error(errors.join(' '));
      $('dashboard-status').textContent = 'Workspace loaded.';
    } catch (error) {
      if (!expired) { $('dashboard-error-text').textContent = error.message || 'Could not reach the workspace. Try again.'; $('dashboard-error').hidden = false; $('dashboard-status').textContent = 'Some workspace information is unavailable.'; }
    } finally { loading = false; if (!expired) $('retry-dashboard').disabled = false; }
  }
  $('retry-dashboard').addEventListener('click', load);
  window.addEventListener('focus', () => { if (csrfToken && !expired) api('/api/session').catch(() => {}); });
  $('sign-out').addEventListener('click', async () => {
    $('sign-out').disabled = true;
    try { await api('/api/logout', 'POST'); expire(); }
    catch (error) { if (!expired) { $('dashboard-error-text').textContent = 'Sign-out could not be confirmed. Try again.'; $('dashboard-error').hidden = false; $('sign-out').disabled = false; } }
  });
  load();
})();
