(() => {
  'use strict';
  // Shared private-workspace confirmation. An unconfirmed response keeps the
  // original version and operation key so a retry cannot delete newer data.
  function create({ api, onChange, onDeleted }) {
    let operation = null;
    let running = false;
    let uncertain = false;
    const el = (tag, text, className) => {
      const element = document.createElement(tag);
      if (text) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const dialog = el('dialog', '', 'deletion-dialog');
    dialog.setAttribute('aria-labelledby', 'delete-confirm-title');
    dialog.setAttribute('aria-describedby', 'delete-confirm-description');
    const title = el('h2'); title.id = 'delete-confirm-title';
    const description = el('p'); description.id = 'delete-confirm-description';
    const retention = el('p', 'Older encrypted backups may still contain this record. Contact restrictions and a deletion receipt remain. This action cannot be undone in the workspace.', 'muted small-text');
    const label = el('label', 'Type DELETE to confirm'); label.htmlFor = 'delete-confirm-input';
    const input = el('input'); input.id = 'delete-confirm-input'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 6;
    const field = el('div', '', 'form-field'); field.append(label, input);
    const error = el('p', '', 'notice error'); error.id = 'delete-confirm-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    const status = el('p', '', 'form-status'); status.setAttribute('role', 'status');
    const actions = el('div', '', 'button-row');
    const cancel = el('button', 'Cancel', 'button button-secondary'); cancel.type = 'button';
    const confirm = el('button', 'Delete', 'button button-danger'); confirm.type = 'button'; confirm.disabled = true;
    actions.append(cancel, confirm);
    dialog.append(title, description, retention, field, error, status, actions);
    document.body.append(dialog);
    function update() {
      input.disabled = running || uncertain;
      cancel.disabled = running || uncertain;
      confirm.disabled = running || (!uncertain && input.value !== 'DELETE');
      confirm.textContent = running ? 'Deleting…' : uncertain ? 'Retry same deletion' : 'Delete';
      onChange?.();
    }
    function close() {
      if (running || uncertain) return;
      operation = null; input.value = ''; description.textContent = ''; error.textContent = ''; error.hidden = true;
      dialog.close(); update();
    }
    input.addEventListener('input', update);
    cancel.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    confirm.addEventListener('click', async () => {
      if (!operation || running || (!uncertain && input.value !== 'DELETE')) return;
      running = true; error.hidden = true; error.textContent = ''; status.textContent = 'Waiting for the workspace to confirm deletion…'; update();
      const current = operation;
      let receipt;
      try {
        const result = await api(current.url, { method: 'DELETE', key: current.key, body: { version: current.version, confirmation: 'DELETE' } });
        receipt = result?.receipt;
        if (!receipt || receipt.deleted !== true || receipt.kind !== current.kind || receipt.id !== current.id || receipt.version !== current.version + 1 || (current.parentId && receipt.parentId !== current.parentId) || typeof receipt.deletedAt !== 'string' || !Number.isFinite(Date.parse(receipt.deletedAt))) {
          throw new Error('The deletion response was incomplete. Retry the same deletion to confirm its result.');
        }
      } catch (cause) {
        if (operation !== current) return; // Session expiry cleared the view.
        running = false;
        // A first-attempt 4xx rejection proves that attempt did not commit.
        // Once a response is lost, a later rejection cannot settle the earlier
        // attempt. Only the matching receipt resolves that uncertainty.
        uncertain = uncertain || !(cause.status >= 400 && cause.status < 500 && cause.status !== 408);
        status.textContent = uncertain ? 'Deletion is unconfirmed. Retry with the same operation before leaving.' : 'The workspace did not accept this deletion. Cancel and reload the saved record before trying again.';
        error.textContent = cause.message || 'Deletion could not be confirmed.'; error.hidden = false;
        update(); return;
      }
      if (operation !== current) return;
      running = false; uncertain = false; close();
      // The caller handles refresh errors separately from the confirmed delete.
      await onDeleted(current, receipt);
    });
    return {
      isOpen: () => dialog.open,
      isPending: () => running || uncertain,
      request(value) {
        if (dialog.open) return;
        operation = { ...value, key: crypto.randomUUID() };
        title.textContent = value.title; description.textContent = value.description;
        status.textContent = ''; input.value = ''; uncertain = false;
        dialog.showModal(); update(); cancel.focus();
      },
      expire() {
        operation = null; running = false; uncertain = false;
        title.textContent = ''; description.textContent = ''; status.textContent = ''; input.value = ''; error.textContent = ''; error.hidden = true;
        dialog.close(); update();
      }
    };
  }
  window.PanelReplyDeletion = Object.freeze({ create });
})();
