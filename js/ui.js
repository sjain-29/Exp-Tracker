// Toasts, dialogs and sheets built on the native <dialog> element.
import { el, icon, clear } from './utils.js';

/* ---------------- Toasts ---------------- */

let host = null;
const canPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
function toastHost() {
  if (!host) {
    host = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    if (canPopover) host.setAttribute('popover', 'manual');
    document.body.appendChild(host);
  }
  // With a sheet open on a phone, show toasts just above its Save button so they never cover the title or X.
  const sheetOpen = !!document.querySelector('dialog[open]:not(.lock-screen)');
  host.classList.toggle('over-sheet', sheetOpen && window.innerWidth < 640);
  if (canPopover) {
    // Re-showing moves the host to the top of the top layer, above any modal dialog.
    try { if (host.matches(':popover-open')) host.hidePopover(); host.showPopover(); } catch { /* ignore */ }
  }
  return host;
}

/** Re-evaluate toast placement after a dialog opens or closes. */
export function rehomeToasts() { if (host && host.children.length) toastHost(); }

/**
 * @param {string} message
 * @param {'success'|'error'|'info'|'warn'} kind
 * @param {{action?: {label:string, run:Function}, duration?: number}} opts
 */
export function toast(message, kind = 'info', opts = {}) {
  const h = toastHost();
  const ic = { success: 'circle-check', error: 'triangle-alert', warn: 'cloud-off', info: 'info' }[kind] || 'info';
  const t = el('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : null },
    icon(ic, 18), el('span', { class: 'toast-msg', text: message }));
  if (opts.action) {
    t.append(el('button', {
      class: 'toast-action', type: 'button', text: opts.action.label,
      onclick: () => { dismiss(); opts.action.run(); }
    }));
  }
  // Over a sheet, show one toast at a time so form fields stay visible; elsewhere at most two.
  const max = h.classList.contains('over-sheet') ? 0 : 1;
  while (h.children.length > max) h.firstChild.remove();
  h.appendChild(t);
  let gone = false;
  function dismiss() {
    if (gone) return; gone = true;
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 220);
  }
  setTimeout(dismiss, opts.duration ?? (kind === 'error' ? 6000 : opts.action ? 7000 : 2200));
  return dismiss;
}

/* ---------------- Dialog primitives ---------------- */

/**
 * Open a modal sheet. `build(body, close)` fills the body. Resolves with the value passed to close().
 */
export function openSheet({ title, build, className = '', wide = false, closeLabel = 'Close' }) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'sheet-body' });
    const dlg = el('dialog', { class: `sheet ${wide ? 'sheet-wide' : ''} ${className}`, 'aria-labelledby': 'sheet-title-' + Date.now() });
    const titleId = dlg.getAttribute('aria-labelledby');
    let result;
    const close = (value) => { result = value; dlg.close(); };
    dlg.append(
      el('div', { class: 'sheet-panel' },
        el('header', { class: 'sheet-head' },
          el('h2', { id: titleId, text: title }),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': closeLabel, onclick: () => close(undefined) }, icon('x', 22))),
        body)
    );
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(undefined); });
    dlg.addEventListener('close', () => { dlg.remove(); rehomeToasts(); resolve(result); });
    document.body.appendChild(dlg);
    build(body, close, dlg);
    dlg.showModal();
    rehomeToasts();
  });
}

export function confirmDialog({ title, message, details, confirmText = 'Confirm', danger = false, typeToConfirm = null }) {
  return openSheet({
    title,
    className: 'sheet-confirm',
    build(body, close) {
      body.append(el('p', { class: 'confirm-msg', text: message }));
      if (details) body.append(el('p', { class: 'confirm-details muted', text: details }));
      let input = null;
      if (typeToConfirm) {
        const id = 'ttc-' + Date.now();
        input = el('input', { id, class: 'input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
        body.append(el('label', { class: 'field' },
          el('span', { class: 'label', text: `Type ${typeToConfirm} to confirm` }), input));
      }
      const ok = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: confirmText,
        disabled: !!typeToConfirm, onclick: () => close(true) });
      if (input) input.addEventListener('input', () => { ok.disabled = input.value.trim() !== typeToConfirm; });
      body.append(el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(false) }), ok));
      setTimeout(() => (input || ok).focus(), 50);
    }
  }).then((v) => v === true);
}

/** Small form dialog. `fields` build themselves; `submit(values)` may throw to keep the dialog open. */
export function formDialog({ title, build, submitText = 'Save', danger = false, onSubmit }) {
  return openSheet({
    title,
    build(body, close) {
      const form = el('form', { class: 'form', novalidate: true });
      const errorBox = el('p', { class: 'form-error', role: 'alert', hidden: true });
      const getValues = build(form);
      const submit = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit', text: submitText });
      form.append(errorBox, el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(undefined) }), submit));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        errorBox.hidden = true;
        submit.disabled = true;
        setBusy(submit, true);
        try {
          const values = getValues();
          const r = onSubmit ? await onSubmit(values) : values;
          close(r === undefined ? values : r);
        } catch (err) {
          errorBox.textContent = err && err.userMessage ? err.userMessage : (err?.message || 'Something went wrong.');
          errorBox.hidden = false;
        } finally {
          submit.disabled = false;
          setBusy(submit, false);
        }
      });
      body.append(form);
      setTimeout(() => form.querySelector('input,select,textarea')?.focus(), 50);
    }
  });
}

export function setBusy(button, busy) {
  button.classList.toggle('is-busy', busy);
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

/** A user-facing error carrying a readable message. */
export class UserError extends Error {
  constructor(msg) { super(msg); this.userMessage = msg; }
}

export function field(labelText, control, hint) {
  const wrap = el('label', { class: 'field' }, el('span', { class: 'label', text: labelText }), control);
  if (hint) wrap.append(el('span', { class: 'hint', text: hint }));
  return wrap;
}

export function selectEl(options, value, attrs = {}) {
  const s = el('select', { class: 'input', ...attrs });
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label, disabled: o.disabled });
    if (o.value === value) opt.selected = true;
    s.append(opt);
  }
  return s;
}

export function emptyState(iconName, title, text, action) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-icon' }, icon(iconName, 26)),
    el('p', { class: 'empty-title', text: title }),
    text ? el('p', { class: 'empty-text', text }) : null,
    action || null);
}

export function swatchPicker(colors, value, name) {
  const wrap = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  colors.forEach((c, i) => {
    const id = `${name}-${i}`;
    const input = el('input', { type: 'radio', name, id, value: c, checked: c === value, class: 'sr-only' });
    wrap.append(input, el('label', { for: id, class: 'swatch', style: { '--sw': c }, title: c }, el('span', { class: 'sr-only', text: c })));
  });
  return wrap;
}

export function iconPicker(icons, value, name) {
  const wrap = el('div', { class: 'icon-grid', role: 'radiogroup', 'aria-label': 'Icon' });
  icons.forEach((n, i) => {
    const id = `${name}-${i}`;
    wrap.append(el('input', { type: 'radio', name, id, value: n, checked: n === value, class: 'sr-only' }),
      el('label', { for: id, class: 'icon-choice', title: n.replace(/-/g, ' ') }, icon(n, 20), el('span', { class: 'sr-only', text: n })));
  });
  return wrap;
}

export function radioValue(root, name) {
  const r = root.querySelector(`input[name="${name}"]:checked`);
  return r ? r.value : null;
}

export { clear };
