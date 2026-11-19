(function () {
  'use strict';

  const core = window.PanelReplyDemo;
  const $ = id => document.getElementById(id);
  const MAX_SAMPLE_RECORDS = 25;
  const requestFields = { job: $('job'), zip: $('zip'), callback: $('callback'), workDate: $('requested-date') };
  const partFieldLabels = { partNumber: 'Part number', manufacturer: 'Manufacturer', description: 'Description', quantity: 'Quantity' };
  const routeInfo = {
    home: ['Less paperwork. More work done.', 'home-heading'],
    demo: ['Interactive product demo', 'demo-page-heading'],
    'customer-intake': ['Customer intake', 'intake-heading'],
    'panel-scanning': ['Panel scanning & parts review', 'panels-heading'],
    features: ['Features & product scope', 'features-heading'],
    pricing: ['Pricing', 'pricing-heading'],
    login: ['Workspace access', 'login-heading'],
    contact: ['Pilot preparation', 'contact-heading'],
    privacy: ['Privacy — draft for review', 'privacy-heading'],
    terms: ['Terms — draft for review', 'terms-heading']
  };
  const mobileNavigation = window.matchMedia('(max-width: 680px)');
  const horizontalTabs = window.matchMedia('(max-width: 960px)');
  let requests = core.freshRequests();
  let parts = core.freshParts();
  let selectedRequest = requests[0].id;
  let requestSequence = 1043;
  let partSequence = 4;
  let currentTab = 'intake';
  let exporting = false;
  let partValidationShown = false;
  const requiredReviewRows = new Set();

  function text(node, value) {
    if (node.textContent !== String(value)) node.textContent = String(value);
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function announce(id, message, error = false) {
    const node = $(id);
    text(node, message);
    node.classList.toggle('is-error', error);
  }

  function statusClass(status) {
    return ({ New: 'tag-new', 'In review': 'tag-review', 'Ready for follow-up': 'tag-ready', Closed: 'tag-closed' })[status] || 'tag-muted';
  }

  function closeNavigation(returnFocus = false) {
    $('site-navigation').classList.remove('is-open');
    $('menu-toggle').setAttribute('aria-expanded', 'false');
    $('menu-toggle').setAttribute('aria-label', 'Open navigation');
    if (returnFocus) $('menu-toggle').focus();
  }

  $('menu-toggle').addEventListener('click', () => {
    const open = $('menu-toggle').getAttribute('aria-expanded') !== 'true';
    $('site-navigation').classList.toggle('is-open', open);
    $('menu-toggle').setAttribute('aria-expanded', String(open));
    $('menu-toggle').setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('menu-toggle').getAttribute('aria-expanded') === 'true') closeNavigation(true);
  });
  mobileNavigation.addEventListener('change', () => closeNavigation());

  function switchTab(which, focus = false) {
    if (!['intake', 'parts'].includes(which)) return;
    currentTab = which;
    for (const name of ['intake', 'parts']) {
      const active = name === which;
      $(name + '-tab').setAttribute('aria-selected', String(active));
      $(name + '-tab').tabIndex = active ? 0 : -1;
      $(name + '-panel').hidden = !active;
    }
    text($('workspace-location'), which === 'intake' ? 'Customer requests' : 'Panel parts review');
    announce('demo-status', which === 'intake' ? 'Customer requests demo selected.' : 'Panel parts review demo selected. Prepared sample data, no live OCR.');
    if (focus) $(which + '-tab').focus();
  }

  function setTabOrientation() {
    document.querySelector('.product-tabs').setAttribute('aria-orientation', horizontalTabs.matches ? 'horizontal' : 'vertical');
  }
  setTabOrientation();
  horizontalTabs.addEventListener('change', setTabOrientation);
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
    button.addEventListener('keydown', event => {
      let target;
      if (event.key === 'Home') target = 'intake';
      else if (event.key === 'End') target = 'parts';
      else if (['ArrowLeft', 'ArrowRight'].includes(event.key) || (!horizontalTabs.matches && ['ArrowUp', 'ArrowDown'].includes(event.key))) target = currentTab === 'intake' ? 'parts' : 'intake';
      if (target) {
        event.preventDefault();
        switchTab(target, true);
      }
    });
  });

  function applyRoute(focus = true) {
    const hash = window.location.hash.slice(1);
    const anchorTarget = ['products', 'workflow'].includes(hash) ? hash : null;
    const route = Object.hasOwn(routeInfo, hash) ? hash : 'home';
    for (const section of document.querySelectorAll('[data-route]')) section.hidden = !section.dataset.route.split(' ').includes(route);
    document.body.dataset.currentRoute = route;
    document.title = 'PanelReply — ' + routeInfo[route][0];
    if (route === 'customer-intake') switchTab('intake');
    if (route === 'panel-scanning') switchTab('parts');
    for (const link of document.querySelectorAll('.site-navigation a')) {
      const linkRoute = link.getAttribute('href').slice(1);
      const active = linkRoute === route || (linkRoute === 'products' && (anchorTarget === 'products' || ['customer-intake', 'panel-scanning'].includes(route)));
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    closeNavigation();
    if (!focus) return;
    const heading = anchorTarget ? $(anchorTarget + '-heading') : $(routeInfo[route][1]);
    heading.focus({ preventScroll: true });
    if (anchorTarget) $(anchorTarget).scrollIntoView({ block: 'start', behavior: 'auto' });
    else window.scrollTo({ top: 0, behavior: 'auto' });
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const hash = link.getAttribute('href');
    event.preventDefault();
    if (hash === '#main-content') {
      $('main-content').focus();
      $('main-content').scrollIntoView({ block: 'start', behavior: 'auto' });
      return;
    }
    if (link.dataset.open) switchTab(link.dataset.open);
    if (window.location.hash === hash) applyRoute();
    else window.location.hash = hash;
  });
  window.addEventListener('hashchange', () => applyRoute());

  function clearRequestErrors() {
    for (const [name, input] of Object.entries(requestFields)) {
      input.removeAttribute('aria-invalid');
      text($(name + '-error'), '');
    }
    text($('request-form-error'), '');
  }

  function renderRequestDetail() {
    const request = requests.find(item => item.id === selectedRequest);
    $('request-detail').hidden = !request;
    if (!request) return;
    text($('detail-id'), request.id);
    text($('detail-badge'), request.status);
    $('detail-badge').className = 'tag ' + statusClass(request.status);
    text($('detail-heading'), request.job);
    text($('detail-customer'), request.customer);
    text($('detail-zip'), request.zip);
    text($('detail-callback'), request.callback);
    text($('detail-date'), request.workDate || 'Not requested');
    $('detail-status').value = request.status;
    $('request-note').value = request.notes;
    $('request-note').removeAttribute('aria-invalid');
    text($('note-error'), '');
    $('request-history').replaceChildren(...request.history.map(entry => element('li', '', entry)));
  }

  function renderRequests(options = {}) {
    const counts = core.requestCounts(requests);
    text($('req-count'), counts.total);
    text($('sidebar-count'), counts.total);
    text($('review-count'), counts.awaitingReview);
    text($('in-review-count'), counts.inReview);
    const visible = core.filterRequests(requests, $('request-search').value, $('request-filter').value);
    const selectionVisible = visible.some(request => request.id === selectedRequest);
    if (!selectionVisible) selectedRequest = visible[0] ? visible[0].id : null;
    const items = visible.map(request => {
      const li = element('li');
      const button = element('button', 'request-item');
      button.type = 'button';
      button.dataset.requestId = request.id;
      button.setAttribute('aria-pressed', String(request.id === selectedRequest));
      button.setAttribute('aria-controls', 'request-detail');
      const top = element('span', 'request-item-topline');
      top.append(element('span', '', request.id), element('span', 'tag ' + statusClass(request.status), request.status));
      button.append(top, element('span', 'request-item-title', request.job), element('span', 'request-item-meta', `${request.customer} · ZIP ${request.zip} · ${request.callback}`), element('span', 'request-item-time', request.createdLabel));
      button.addEventListener('click', () => {
        selectedRequest = request.id;
        for (const item of document.querySelectorAll('.request-item')) item.setAttribute('aria-pressed', String(item.dataset.requestId === selectedRequest));
        renderRequestDetail();
        announce('request-status', `${request.id} selected. Review its details and choose the next action.`);
      });
      li.append(button);
      return li;
    });
    $('request-list').replaceChildren(...items);
    $('request-empty').hidden = visible.length > 0;
    text($('request-results'), visible.length + ' shown');
    $('add-request').disabled = requests.length >= MAX_SAMPLE_RECORDS;
    if (!options.keepDetail || !selectionVisible) renderRequestDetail();
  }

  $('request-search').addEventListener('input', () => renderRequests({ keepDetail: true }));
  $('request-filter').addEventListener('change', () => renderRequests({ keepDetail: true }));
  $('clear-request-filters').addEventListener('click', () => {
    $('request-search').value = '';
    $('request-filter').value = 'All';
    renderRequests();
    $('request-search').focus();
    announce('request-status', 'Search and status filters cleared. All sample requests are shown.');
  });
  $('new-request-button').addEventListener('click', () => {
    $('new-request').open = true;
    $('job').focus();
  });
  $('request-form').addEventListener('submit', event => {
    event.preventDefault();
    clearRequestErrors();
    if (requests.length >= MAX_SAMPLE_RECORDS) {
      text($('request-form-error'), 'This demonstration holds up to 25 sample requests. Reset requests to start again.');
      return;
    }
    const result = core.validateRequest(Object.fromEntries(Object.entries(requestFields).map(([name, input]) => [name, input.value])));
    if (!result.valid) {
      for (const [name, message] of Object.entries(result.errors)) {
        requestFields[name].setAttribute('aria-invalid', 'true');
        text($(name + '-error'), message);
      }
      text($('request-form-error'), 'Check the highlighted fields. No sample request has been added.');
      requestFields[Object.keys(result.errors)[0]].focus();
      return;
    }
    const id = 'REQ-' + requestSequence++;
    requests.unshift({ id, customer: 'Taylor Sample', ...result.value, status: 'New', notes: '', createdLabel: 'Sample · Added just now', history: ['Sample request added on this page. No communication sent.'] });
    selectedRequest = id;
    $('request-search').value = '';
    $('request-filter').value = 'All';
    $('request-form').reset();
    renderRequests();
    announce('request-status', `${id} added for review. No message was sent and no appointment was booked.`);
    if (requests.length >= MAX_SAMPLE_RECORDS) text($('request-form-error'), 'The sample request limit is reached. Reset requests to start again.');
  });
  for (const [name, input] of Object.entries(requestFields)) input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') {
      input.removeAttribute('aria-invalid');
      text($(name + '-error'), '');
    }
  });
  $('save-request').addEventListener('click', () => {
    const request = requests.find(item => item.id === selectedRequest);
    if (!request) return;
    const result = core.validateNote($('request-note').value);
    if (!result.valid) {
      text($('note-error'), result.error);
      $('request-note').setAttribute('aria-invalid', 'true');
      $('request-note').focus();
      return;
    }
    const nextStatus = $('detail-status').value;
    if (!core.REQUEST_STATUSES.includes(nextStatus)) {
      announce('request-status', 'Choose one of the available request statuses.', true);
      return;
    }
    const changed = request.notes !== result.value || request.status !== nextStatus;
    request.notes = result.value;
    request.status = nextStatus;
    if (changed) request.history.push('Sample record updated to ' + nextStatus + '. No communication sent.');
    renderRequests();
    announce('request-status', changed ? 'Sample changes saved on this page. No message was sent or appointment booked.' : 'No changes to save. The sample record is unchanged.');
  });
  $('reset-requests').addEventListener('click', () => {
    requests = core.freshRequests();
    requestSequence = 1043;
    selectedRequest = requests[0].id;
    $('request-search').value = '';
    $('request-filter').value = 'All';
    $('request-form').reset();
    clearRequestErrors();
    $('new-request').open = false;
    renderRequests();
    announce('request-status', 'The original 3 sample requests are restored. Your sample changes were cleared.');
  });

  function partInputId(part, field) {
    return part.id + '-' + field;
  }

  function updatePartSummary() {
    const reviewed = parts.filter(part => part.reviewed).length;
    text($('part-count'), parts.length);
    text($('review-progress-text'), `${reviewed} of ${parts.length} rows reviewed`);
    $('review-progress').max = Math.max(parts.length, 1);
    $('review-progress').value = reviewed;
    text($('review-progress'), `${reviewed} of ${parts.length}`);
    $('parts-empty').hidden = parts.length > 0;
    document.querySelector('.table-scroll').hidden = parts.length === 0;
    $('export').disabled = parts.length === 0 || exporting;
    $('add-part').disabled = parts.length >= MAX_SAMPLE_RECORDS || exporting;
  }

  function updateReviewButton(part) {
    const button = $(part.id + '-review');
    if (!button) return;
    const index = parts.findIndex(item => item.id === part.id) + 1;
    button.setAttribute('aria-pressed', String(part.reviewed));
    button.setAttribute('aria-label', `Mark row ${index} ${part.reviewed ? 'unreviewed' : 'reviewed'}`);
    text(button, part.reviewed ? '✓ Reviewed' : '○ Unreviewed');
  }

  function clearPartErrors() {
    $('parts-errors').hidden = true;
    $('parts-errors').replaceChildren();
    document.querySelectorAll('.parts-table input').forEach(input => input.removeAttribute('aria-invalid'));
    document.querySelectorAll('.parts-table .field-error').forEach(error => text(error, ''));
  }

  function paintPartErrors(focus = false) {
    clearPartErrors();
    const failures = [];
    for (const [index, part] of parts.entries()) {
      const result = core.validatePart(part, { requireComplete: requiredReviewRows.has(part.id) });
      if (result.valid) continue;
      for (const [field, message] of Object.entries(result.errors)) {
        const targetField = field === 'row' ? 'partNumber' : field;
        const input = $(partInputId(part, targetField));
        input.setAttribute('aria-invalid', 'true');
        text($(partInputId(part, targetField) + '-error'), message);
        failures.push({ input, message: `Row ${index + 1}: ${field === 'row' ? '' : partFieldLabels[field] + ' — '}${message}` });
      }
    }
    if (failures.length) {
      $('parts-errors').hidden = false;
      $('parts-errors').replaceChildren(...failures.map(failure => element('p', '', failure.message)));
      if (focus) failures[0].input.focus();
    }
    return failures.length === 0;
  }

  function removeIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7');
    svg.append(path);
    return svg;
  }

  function renderParts() {
    $('parts-body').replaceChildren(...parts.map((part, index) => {
      const row = element('tr');
      row.dataset.partId = part.id;
      for (const field of core.PART_FIELDS) {
        const cell = element('td');
        const input = element('input');
        input.id = partInputId(part, field);
        input.dataset.field = field;
        input.dataset.partId = part.id;
        input.value = part[field];
        input.maxLength = core.PART_LIMITS[field] || 4;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', partFieldLabels[field] + ' row ' + (index + 1));
        input.setAttribute('aria-describedby', input.id + '-error');
        if (field === 'quantity') input.inputMode = 'numeric';
        input.addEventListener('input', () => {
          const position = parts.findIndex(item => item.id === part.id);
          if (position < 0) return;
          parts[position] = core.editPart(parts[position], field, input.value);
          updateReviewButton(parts[position]);
          updatePartSummary();
          if (partValidationShown) paintPartErrors();
          announce('parts-status', `Row ${position + 1} changed. Review the corrected values before export.`);
        });
        input.addEventListener('blur', () => {
          const current = parts.find(item => item.id === part.id);
          if (current && !core.validatePart(current).valid) {
            partValidationShown = true;
            paintPartErrors();
          }
        });
        const error = element('span', 'field-error');
        error.id = input.id + '-error';
        cell.append(input, error);
        row.append(cell);
      }
      const reviewCell = element('td');
      const reviewButton = element('button', 'review-button');
      reviewButton.id = part.id + '-review';
      reviewButton.type = 'button';
      reviewButton.dataset.reviewPart = part.id;
      reviewButton.addEventListener('click', () => {
        const current = parts.find(item => item.id === part.id);
        if (!current) return;
        if (!current.reviewed) {
          requiredReviewRows.add(part.id);
          const result = core.validatePart(current, { requireComplete: true });
          if (!result.valid) {
            partValidationShown = true;
            paintPartErrors(true);
            announce('parts-status', 'Complete the core fields before marking a row reviewed. Leave unknown details blank and unreviewed.', true);
            return;
          }
        }
        current.reviewed = !current.reviewed;
        requiredReviewRows.delete(part.id);
        updateReviewButton(current);
        updatePartSummary();
        if (partValidationShown) paintPartErrors();
        announce('parts-status', current.reviewed ? 'Row marked reviewed in the sample. This does not verify electrical specifications or compatibility.' : 'Row returned to Unreviewed.');
      });
      reviewCell.append(reviewButton);
      const removeCell = element('td');
      const remove = element('button', 'row-remove');
      remove.type = 'button';
      remove.dataset.removePart = part.id;
      remove.setAttribute('aria-label', 'Remove part row ' + (index + 1));
      remove.append(removeIcon());
      remove.addEventListener('click', () => {
        parts = parts.filter(item => item.id !== part.id);
        requiredReviewRows.delete(part.id);
        renderParts();
        const nextRow = parts[Math.min(index, parts.length - 1)];
        if (nextRow) $(partInputId(nextRow, 'partNumber')).focus();
        else $('empty-add-part').focus();
        announce('parts-status', 'Sample row removed. ' + parts.length + ' rows remain.');
      });
      removeCell.append(remove);
      row.append(reviewCell, removeCell);
      return row;
    }));
    for (const part of parts) updateReviewButton(part);
    updatePartSummary();
    if (partValidationShown) paintPartErrors();
    else clearPartErrors();
  }

  function addPart() {
    if (parts.length >= MAX_SAMPLE_RECORDS || exporting) return;
    const part = core.newPart('sample-part-' + partSequence++);
    parts.push(part);
    renderParts();
    $(partInputId(part, 'partNumber')).focus();
    announce('parts-status', parts.length >= MAX_SAMPLE_RECORDS ? 'The sample limit of 25 rows is reached. Remove a row or reset to continue.' : 'Empty row added. Enter known details and leave uncertain values unreviewed.');
  }
  $('add-part').addEventListener('click', addPart);
  $('empty-add-part').addEventListener('click', addPart);
  $('reset-parts').addEventListener('click', () => {
    parts = core.freshParts();
    partSequence = 4;
    partValidationShown = false;
    requiredReviewRows.clear();
    renderParts();
    announce('parts-status', 'The original 3 sample parts are restored. Your corrections and review marks were cleared.');
  });

  $('export').addEventListener('click', async () => {
    if (exporting) return;
    const result = core.exportParts(parts);
    if (!result.valid) {
      partValidationShown = true;
      paintPartErrors(true);
      announce('parts-status', result.error, true);
      return;
    }
    exporting = true;
    $('export').setAttribute('aria-busy', 'true');
    text($('export-label'), 'Preparing CSV…');
    updatePartSummary();
    announce('parts-status', 'Preparing a CSV of the values currently shown.');
    let url;
    try {
      await new Promise(resolve => window.requestAnimationFrame(resolve));
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const download = element('a', 'sr-only');
      download.href = url;
      download.download = 'panelreply-sample-parts.csv';
      document.body.append(download);
      download.click();
      download.remove();
      announce('parts-status', `CSV prepared with ${result.count} rows. ${result.unreviewed} ${result.unreviewed === 1 ? 'row remains' : 'rows remain'} unreviewed. Check your browser downloads.`);
    } catch {
      announce('parts-status', 'The sample CSV could not be prepared. Your edits remain on this page. Try the download again.', true);
    } finally {
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      exporting = false;
      $('export').removeAttribute('aria-busy');
      text($('export-label'), 'Download CSV');
      updatePartSummary();
    }
  });

  renderRequests();
  renderParts();
  applyRoute(Boolean(window.location.hash));
  document.body.dataset.demoReady = 'true';
})();
