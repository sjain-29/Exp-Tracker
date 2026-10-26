// The instant "Add Transaction" modal — the app's primary entry experience.
import { el, icon, clear, money, parseAmount, paiseToInput, todayISO, currencySymbol, friendlyDate } from './utils.js';
import { toast, confirmDialog, setBusy, rehomeToasts } from './ui.js';
import * as store from './store.js';
import { accountType } from './defaults.js';
import { editCategoryDialog } from './views/categories.js';
import { editAccountDialog } from './views/accounts.js';

const SLOW_MS = 8000;        // after this long without server confirmation, treat as queued
const OFFLINE_MS = 700;      // when we already know we're offline

let dlg, form, titleEl, tabs, tabBtns, amountIn, catBtn, catPanel, dateIn, accSel, accLabel, toSel, toWrap,
  catWrap, descIn, refIn, notesIn, moreBox, errBox, saveBtn, delBtn, noAccBox, fieldsBox, pendingNote;

const s = {
  mode: 'add',            // 'add' | 'edit'
  type: 'expense',        // 'expense' | 'income' | 'transfer'
  editId: null,
  pendingId: null,        // pre-generated id reused on retry → no duplicates
  saving: false,
  catByType: { expense: '', income: '' },
  addDraft: null,
  onClose: null
};

/** App-level hook: where to go when the quick-entry modal is dismissed with X (the dashboard). */
let addCloseHandler = null;
export function setAddCloseHandler(fn) { addCloseHandler = fn; }

export function isOpen() { return !!dlg && dlg.open; }

function build() {
  if (dlg) return;
  titleEl = el('h2', { id: 'tx-title', text: 'Add Transaction' });
  tabBtns = {
    expense: el('button', { type: 'button', role: 'tab', class: 'seg-btn seg-expense', id: 'tab-expense', 'aria-controls': 'tx-fields' },
      icon('arrow-up-right', 18), el('span', { text: 'Expense' })),
    income: el('button', { type: 'button', role: 'tab', class: 'seg-btn seg-income', id: 'tab-income', 'aria-controls': 'tx-fields' },
      icon('arrow-down-left', 18), el('span', { text: 'Income' }))
  };
  tabs = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Transaction type' }, tabBtns.expense, tabBtns.income);
  tabBtns.expense.addEventListener('click', () => switchType('expense'));
  tabBtns.income.addEventListener('click', () => switchType('income'));
  tabs.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = s.type === 'expense' ? 'income' : 'expense';
      switchType(next); tabBtns[next].focus();
    }
  });

  amountIn = el('input', {
    id: 'tx-amount', class: 'amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
    enterkeyhint: 'done', placeholder: '0', 'aria-describedby': 'tx-amount-err', 'aria-label': 'Amount', maxlength: '16'
  });
  amountIn.addEventListener('input', () => {
    const cleaned = amountIn.value.replace(/[^\d.,]/g, '');
    if (cleaned !== amountIn.value) amountIn.value = cleaned;
    fieldError('amount', null);
  });

  catBtn = el('button', { type: 'button', class: 'input cat-btn', id: 'tx-category', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-describedby': 'tx-category-err' });
  catPanel = el('div', { class: 'cat-panel', role: 'listbox', id: 'tx-cat-list', 'aria-label': 'Categories', hidden: true, tabindex: '-1' });
  catBtn.addEventListener('click', () => (catPanel.hidden ? openPicker() : closePicker()));
  catPanel.addEventListener('keydown', pickerKeys);
  catWrap = el('div', { class: 'field cat-field' },
    el('span', { class: 'label', id: 'tx-category-label', text: 'Category' }), catBtn, catPanel, errNode('category'));
  catBtn.setAttribute('aria-labelledby', 'tx-category-label tx-category');

  dateIn = el('input', { id: 'tx-date', class: 'input', type: 'date', required: true, min: '2000-01-01', max: '2100-12-31' });
  dateIn.addEventListener('change', () => { fieldError('date', null); updateDateHint(); });
  accSel = el('select', { id: 'tx-account', class: 'input', required: true });
  accSel.addEventListener('change', () => {
    fieldError('account', null);
    if (s.type === 'transfer') accountOptions(toSel, toSel.value, { excludeId: accSel.value });
  });
  accLabel = el('span', { class: 'label', text: 'Payment Account' });
  toSel = el('select', { id: 'tx-to', class: 'input' });
  toSel.addEventListener('change', () => fieldError('to', null));
  toWrap = el('label', { class: 'field', for: 'tx-to' }, el('span', { class: 'label', text: 'To account' }), toSel, errNode('to'));

  descIn = el('input', { id: 'tx-desc', class: 'input', type: 'text', maxlength: String(store.LIMITS.desc), autocomplete: 'off', placeholder: 'What was it for?', enterkeyhint: 'done' });
  refIn = el('input', { id: 'tx-ref', class: 'input', type: 'text', maxlength: String(store.LIMITS.ref), autocomplete: 'off', placeholder: 'UPI ref, cheque no., bill no.' });
  notesIn = el('textarea', { id: 'tx-notes', class: 'input', rows: '2', maxlength: String(store.LIMITS.notes), placeholder: 'Anything else to remember' });
  moreBox = el('details', { class: 'more' },
    el('summary', {}, el('span', { text: 'Reference & notes' }), icon('chevron-down', 16, 'chev')),
    el('label', { class: 'field', for: 'tx-ref' }, el('span', { class: 'label', text: 'Reference (optional)' }), refIn),
    el('label', { class: 'field', for: 'tx-notes' }, el('span', { class: 'label', text: 'Notes (optional)' }), notesIn));

  errBox = el('p', { class: 'form-error', role: 'alert', hidden: true });
  saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-save', id: 'tx-save' }, el('span', { class: 'btn-label', text: 'Save Expense' }));
  delBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-del', hidden: true, 'aria-label': 'Delete transaction' }, icon('trash-2', 18), el('span', { text: 'Delete' }));
  delBtn.addEventListener('click', onDelete);
  pendingNote = el('p', { class: 'pending-note', hidden: true });

  noAccBox = el('div', { class: 'no-acc', hidden: true },
    el('p', { text: 'Add an account first, so PaisaPilot knows where the money moves.' }),
    el('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { await editAccountDialog(null); fill(); } }, icon('plus', 18), el('span', { text: 'Add account' })));

  fieldsBox = el('div', { class: 'tx-fields', id: 'tx-fields', role: 'tabpanel' },
    el('div', { class: 'amount-wrap' },
      el('span', { class: 'amount-cur', 'aria-hidden': 'true', text: currencySymbol() }), amountIn),
    errNode('amount'),
    el('div', { class: 'grid-2' },
      catWrap,
      el('label', { class: 'field', for: 'tx-date' }, el('span', { class: 'label' }, 'Date ', el('span', { class: 'date-hint', id: 'tx-date-hint' })), dateIn, errNode('date'))),
    el('label', { class: 'field', for: 'tx-account' }, accLabel, accSel, errNode('account')),
    toWrap,
    el('label', { class: 'field', for: 'tx-desc' }, el('span', { class: 'label', text: 'Description (optional)' }), descIn),
    moreBox);

  form = el('form', { class: 'tx-form', novalidate: true },
    noAccBox, fieldsBox, errBox, pendingNote,
    el('div', { class: 'tx-actions' }, delBtn, saveBtn));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  dlg = el('dialog', { class: 'tx-modal', id: 'txModal', 'aria-labelledby': 'tx-title' },
    el('div', { class: 'tx-panel' },
      el('header', { class: 'tx-head' },
        titleEl,
        el('button', { type: 'button', class: 'icon-btn tx-close', 'aria-label': 'Close and go to dashboard', onclick: () => dismiss() }, icon('x', 24))),
      tabs, form));
  dlg.addEventListener('cancel', (e) => {
    if (!catPanel.hidden) { e.preventDefault(); closePicker(true); }
    // Otherwise let Esc / Android back close the dialog; cleanup runs in onClosed().
  });
  dlg.addEventListener('close', onClosed);
  dlg.addEventListener('click', (e) => {
    if (!catPanel.hidden && !catWrap.contains(e.target)) closePicker();
  });
  document.body.appendChild(dlg);
}

function errNode(name) { return el('span', { class: 'field-error', id: `tx-${name}-err`, 'aria-live': 'polite' }); }
function fieldError(name, msg) {
  const n = dlg.querySelector(`#tx-${name}-err`);
  if (n) n.textContent = msg || '';
  const ctl = { amount: amountIn, category: catBtn, date: dateIn, account: accSel, to: toSel }[name];
  if (ctl) ctl.setAttribute('aria-invalid', msg ? 'true' : 'false');
}
function clearErrors() { ['amount', 'category', 'date', 'account', 'to'].forEach((n) => fieldError(n, null)); errBox.hidden = true; }
function updateDateHint() {
  const h = dlg.querySelector('#tx-date-hint');
  h.textContent = dateIn.value === todayISO() ? '(today)' : '';
}

/* ---------------- Category picker ---------------- */

function renderCatButton() {
  clear(catBtn);
  const c = store.state.categories[s.catByType[s.type]];
  if (c && c.type === s.type) {
    catBtn.append(el('span', { class: 'cat-dot', style: { '--c': c.color || '#94A3B8' } }, icon(c.icon || 'tag', 16)),
      el('span', { class: 'cat-name', text: c.name }));
  } else {
    catBtn.append(el('span', { class: 'cat-name muted', text: 'Choose' }));
  }
  catBtn.append(icon('chevron-down', 16, 'chev'));
}

function openPicker() {
  clear(catPanel);
  const list = store.categoriesOf(s.type);
  for (const c of list) {
    const selected = c.id === s.catByType[s.type];
    const opt = el('button', {
      type: 'button', role: 'option', class: 'cat-opt', 'aria-selected': selected ? 'true' : 'false', dataset: { id: c.id },
      tabindex: selected ? '0' : '-1', onclick: () => { pickCategory(c.id); }
    }, el('span', { class: 'cat-dot', style: { '--c': c.color || '#94A3B8' } }, icon(c.icon || 'tag', 18)), el('span', { class: 'cat-opt-name', text: c.name }));
    catPanel.append(opt);
  }
  catPanel.append(el('button', {
    type: 'button', class: 'cat-opt cat-new', tabindex: '-1',
    onclick: async () => {
      closePicker();
      const id = await editCategoryDialog(null, s.type);
      if (id) pickCategory(id);
    }
  }, el('span', { class: 'cat-dot' }, icon('plus', 18)), el('span', { class: 'cat-opt-name', text: 'New category' })));
  catPanel.hidden = false;
  catBtn.setAttribute('aria-expanded', 'true');
  const focusTarget = catPanel.querySelector('[aria-selected="true"]') || catPanel.querySelector('.cat-opt');
  focusTarget?.focus();
  focusTarget?.scrollIntoView({ block: 'nearest' });
}
function closePicker(returnFocus = false) {
  catPanel.hidden = true;
  catBtn.setAttribute('aria-expanded', 'false');
  if (returnFocus) catBtn.focus();
}
function pickCategory(id) {
  s.catByType[s.type] = id;
  renderCatButton();
  fieldError('category', null);
  closePicker(true);
}
function pickerKeys(e) {
  const opts = [...catPanel.querySelectorAll('.cat-opt')];
  const i = opts.indexOf(document.activeElement);
  const cols = getComputedStyle(catPanel).gridTemplateColumns.split(' ').length || 1;
  let n = null;
  if (e.key === 'ArrowRight') n = i + 1;
  else if (e.key === 'ArrowLeft') n = i - 1;
  else if (e.key === 'ArrowDown') n = i + cols;
  else if (e.key === 'ArrowUp') n = i - cols;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = opts.length - 1;
  else if (e.key === 'Tab') { closePicker(); return; }
  if (n !== null) { e.preventDefault(); opts[Math.max(0, Math.min(opts.length - 1, n))].focus(); }
}

/* ---------------- Fill / mode switching ---------------- */

function accountOptions(select, selectedId, { excludeId = null, includeId = null } = {}) {
  clear(select);
  const p = store.primaryId();
  const list = store.accountsList().filter((a) => (a.active !== false || a.id === includeId || a.id === selectedId) && a.id !== excludeId);
  if (!selectedId || !list.some((a) => a.id === selectedId)) {
    select.append(el('option', { value: '', text: 'Choose account', disabled: true, selected: true }));
  }
  for (const a of list) {
    let label = a.name;
    if (a.id === p) label += ' (primary)';
    else if (a.active === false) label += ' (inactive)';
    else if (a.type === 'credit_card') label += ` (${accountType(a.type).label})`;
    const o = el('option', { value: a.id, text: label });
    if (a.id === selectedId) o.selected = true;
    select.append(o);
  }
}

function fill() {
  const hasAccounts = store.activeAccounts().length > 0 || (s.mode === 'edit');
  noAccBox.hidden = hasAccounts;
  fieldsBox.hidden = !hasAccounts;
  saveBtn.hidden = !hasAccounts;
  const isTransfer = s.type === 'transfer';
  tabs.hidden = isTransfer;
  catWrap.hidden = isTransfer;
  toWrap.hidden = !isTransfer;
  for (const t of ['expense', 'income']) {
    const on = s.type === t;
    tabBtns[t].setAttribute('aria-selected', on ? 'true' : 'false');
    tabBtns[t].tabIndex = on ? 0 : -1;
  }
  dlg.dataset.type = s.type;
  fieldsBox.setAttribute('aria-labelledby', isTransfer ? 'tx-title' : `tab-${s.type}`);
  accLabel.textContent = isTransfer ? 'From account' : s.type === 'income' ? 'Received In Account' : 'Payment Account';
  titleEl.textContent = s.mode === 'edit'
    ? (isTransfer ? 'Edit Transfer' : 'Edit Transaction')
    : (isTransfer ? 'Transfer Money' : 'Add Transaction');
  saveBtn.querySelector('.btn-label').textContent = s.mode === 'edit'
    ? (isTransfer ? 'Update Transfer' : `Update ${s.type === 'income' ? 'Income' : 'Expense'}`)
    : (isTransfer ? 'Save Transfer' : s.type === 'income' ? 'Save Income' : 'Save Expense');
  delBtn.hidden = s.mode !== 'edit';
  if (!isTransfer) {
    const cur = s.catByType[s.type];
    if (!cur || !store.state.categories[cur] || store.state.categories[cur].type !== s.type) s.catByType[s.type] = store.defaultCategoryId(s.type);
    renderCatButton();
  }
  const acc = accSel.value || s._acc;
  accountOptions(accSel, acc);
  if (isTransfer) accountOptions(toSel, toSel.value || s._to, { excludeId: accSel.value || acc });
  updateDateHint();
}

function switchType(type) {
  if (type === s.type || s.saving) return;
  // Amount, description, date and account carry over; each tab remembers its own category.
  s.type = type;
  clearErrors();
  fill();
}

function snapshot() {
  return {
    type: s.type, amount: amountIn.value, cat: { ...s.catByType }, date: dateIn.value, acc: accSel.value,
    desc: descIn.value, ref: refIn.value, notes: notesIn.value, pendingId: s.pendingId
  };
}
function restore(d) {
  s.type = d.type; s.catByType = { ...d.cat }; s.pendingId = d.pendingId || null;
  amountIn.value = d.amount; dateIn.value = d.date; descIn.value = d.desc; refIn.value = d.ref; notesIn.value = d.notes;
  s._acc = d.acc;
  accSel.value = '';
}

function defaultAccount() {
  const p = store.primaryId();
  if (p && store.state.accounts[p]?.active !== false) return p;
  return store.activeAccounts()[0]?.id || '';
}

/* ---------------- Public API ---------------- */

/**
 * Quick-entry mode. `fresh` resets to launch defaults (Expense, today, primary account).
 */
export function openAdd({ fresh = false, type = null, onClose = null, restorePayload = null } = {}) {
  build();
  if (s.mode === 'edit') { s.mode = 'add'; if (s.addDraft) restore(s.addDraft); else fresh = true; }
  s.onClose = onClose;
  s.editId = null;
  if (fresh || !dateIn.value) {
    s.type = 'expense';
    s.pendingId = null;
    amountIn.value = ''; descIn.value = ''; refIn.value = ''; notesIn.value = '';
    dateIn.value = todayISO();
    s._acc = defaultAccount();
    accSel.value = '';
    s.catByType = { expense: store.defaultCategoryId('expense'), income: store.defaultCategoryId('income') };
    moreBox.open = false;
  }
  if (type) s.type = type;
  if (restorePayload) { s.pendingId = null; applyPayload(restorePayload); }
  if (s.type === 'transfer' && !type) s.type = 'expense';
  clearErrors();
  fill();
  show();
}

function applyPayload(p) {
  s.type = p.type;
  amountIn.value = paiseToInput(p.amount);
  dateIn.value = p.date;
  s._acc = p.accountId; accSel.value = '';
  s._to = p.toAccountId || '';
  if (p.categoryId) s.catByType[p.type] = p.categoryId;
  descIn.value = p.description || ''; refIn.value = p.reference || ''; notesIn.value = p.notes || '';
  moreBox.open = !!(p.reference || p.notes);
}

export function openTransfer({ fromId = null, toId = null } = {}) {
  build();
  if (s.mode === 'add' && s.type !== 'transfer' && dateIn.value) s.addDraft = snapshot();
  s.mode = 'add';
  s.type = 'transfer';
  s.editId = null; s.pendingId = null;
  amountIn.value = ''; descIn.value = ''; refIn.value = ''; notesIn.value = '';
  dateIn.value = todayISO();
  s._acc = fromId || defaultAccount(); accSel.value = '';
  s._to = toId || ''; toSel.value = '';
  s.transferOnly = true;
  clearErrors(); fill(); show();
}

export function openEdit(id) {
  const t = store.state.transactions[id];
  if (!t) { toast('That transaction no longer exists.', 'error'); return; }
  build();
  if (s.mode === 'add' && !s.transferOnly) s.addDraft = snapshot();
  s.mode = 'edit';
  s.editId = id;
  s.pendingId = null;
  s.catByType = { expense: store.defaultCategoryId('expense'), income: store.defaultCategoryId('income') };
  applyPayload(t);
  clearErrors(); fill(); show();
}

function show() {
  if (!dlg.open) { dlg.showModal(); rehomeToasts(); }
  dlg.classList.remove('closing');
  setTimeout(() => {
    if (!fieldsBox.hidden) { amountIn.focus({ preventScroll: true }); }
  }, 60);
}

export function close() {
  if (dlg && dlg.open) dlg.close();
}

/** X button: reveal the dashboard right away (the dialog 'close' event fires asynchronously). */
function dismiss() {
  const isQuickEntry = s.mode !== 'edit' && s.type !== 'transfer';
  if (isQuickEntry && !s.onClose && addCloseHandler) { s.navHandled = true; addCloseHandler(); }
  close();
}

function onClosed() {
  closePicker();
  rehomeToasts();
  const wasEdit = s.mode === 'edit' || s.type === 'transfer';
  if (wasEdit) {
    // Return quick-entry to its draft for the next open.
    s.mode = 'add'; s.transferOnly = false;
    if (s.addDraft) { restore(s.addDraft); s.addDraft = null; } else { s.type = 'expense'; dateIn.value = ''; }
  }
  const cb = s.onClose; s.onClose = null;
  if (cb) cb();
  else if (!wasEdit && addCloseHandler && !s.navHandled) addCloseHandler();
  s.navHandled = false;
}

/** Called when data changes while the modal is open (e.g. accounts loaded or renamed). */
export function refresh() {
  if (dlg && dlg.open && !s.saving) {
    if (!accSel.value) s._acc = s._acc || defaultAccount();
    fill();
  }
}

/* ---------------- Save / delete ---------------- */

function readForm() {
  const errors = {};
  const amt = parseAmount(amountIn.value);
  if (!amt.ok) errors.amount = amt.error;
  if (!dateIn.value) errors.date = 'Choose a date.';
  else if (dateIn.value < '2000-01-01' || dateIn.value > '2100-12-31') errors.date = 'Choose a date between 2000 and 2100.';
  if (!accSel.value || !store.state.accounts[accSel.value]) errors.account = 'Choose an account.';
  const t = {
    type: s.type, amount: amt.paise, date: dateIn.value, accountId: accSel.value,
    description: descIn.value.trim(), reference: refIn.value.trim(), notes: notesIn.value.trim()
  };
  if (s.type === 'transfer') {
    t.toAccountId = toSel.value;
    if (!t.toAccountId) errors.to = 'Choose the account to transfer to.';
    else if (t.toAccountId === t.accountId) errors.to = 'Choose a different account.';
  } else {
    t.categoryId = s.catByType[s.type];
    const c = store.state.categories[t.categoryId];
    if (!c || c.type !== s.type) errors.category = 'Choose a category.';
    else t.categoryName = c.name;
  }
  return { t, errors };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function save() {
  if (s.saving) return; // duplicate tap guard
  clearErrors();
  const { t, errors } = readForm();
  const keys = Object.keys(errors);
  if (keys.length) {
    keys.forEach((k) => fieldError(k, errors[k]));
    const first = { amount: amountIn, category: catBtn, date: dateIn, account: accSel, to: toSel }[keys[0]];
    first?.focus();
    return;
  }
  s.saving = true;
  saveBtn.disabled = true; setBusy(saveBtn, true);
  tabBtns.expense.disabled = tabBtns.income.disabled = true;
  const isEdit = s.mode === 'edit';
  const id = isEdit ? s.editId : (s.pendingId ||= store.newId());
  const kind = t.type === 'transfer' ? 'Transfer' : t.type === 'income' ? 'Income' : 'Expense';

  let p;
  try { p = store.saveTransaction(id, t); } catch (e) { p = Promise.reject(e); }
  const outcome = await Promise.race([
    p.then(() => 'ok', (err) => ({ err })),
    wait(store.state.connected ? SLOW_MS : OFFLINE_MS).then(() => 'slow')
  ]);

  s.saving = false;
  saveBtn.disabled = false; setBusy(saveBtn, false);
  tabBtns.expense.disabled = tabBtns.income.disabled = false;

  if (outcome === 'ok') {
    if (isEdit) {
      toast(`${kind} updated`, 'success');
      close();
    } else if (t.type === 'transfer') {
      toast(`Transfer saved: ${money(t.amount)}`, 'success');
      close();
    } else {
      toast(`${kind} saved: ${money(t.amount)}`, 'success');
      afterQuickSave();
    }
    return;
  }

  if (outcome !== 'slow') {
    // Failed: keep everything the user typed. Keep the same id so a retry overwrites, never duplicates.
    const msg = store.friendlyError(outcome.err);
    errBox.textContent = `Not saved. ${msg}`;
    errBox.hidden = false;
    store.reportError(outcome.err);
    if (store.isPermissionError(outcome.err)) store.touch();
    return;
  }

  // No confirmation yet (offline or slow network). The SDK has queued the write locally.
  store.pending.set(id, { payload: { ...t }, kind });
  store.touch();
  toast(`${kind} queued on this device. It will sync when you're online. Keep the app open until it does.`, 'warn', { duration: 6000 });
  if (isEdit || t.type === 'transfer') close(); else afterQuickSave();
  p.then(() => {
    store.pending.delete(id); store.touch();
    toast(`${kind} synced to the cloud`, 'success');
  }, (err) => {
    store.pending.delete(id); store.touch();
    store.reportError(err);
    toast(`A queued ${kind.toLowerCase()} could not be saved. ${store.friendlyError(err)}`, 'error', {
      duration: 15000,
      action: { label: 'Restore', run: () => openAdd({ restorePayload: t }) }
    });
  });
}

function afterQuickSave() {
  // Keep tab, date and account. Clear amount + description. Reset category to the type's default.
  s.pendingId = null;
  amountIn.value = '';
  descIn.value = ''; refIn.value = ''; notesIn.value = '';
  moreBox.open = false;
  s.catByType[s.type] = store.defaultCategoryId(s.type);
  renderCatButton();
  dlg.querySelector('.tx-panel').scrollTop = 0;
  amountIn.focus({ preventScroll: true });
  saveBtn.classList.remove('flash'); void saveBtn.offsetWidth; saveBtn.classList.add('flash');
}

async function onDelete() {
  const t = store.state.transactions[s.editId];
  if (!t) return;
  const ok = await confirmDialog({
    title: 'Delete this transaction?',
    message: `${t.type === 'transfer' ? 'Transfer' : store.categoryName(t)} of ${money(t.amount)} on ${friendlyDate(t.date)} will be removed and balances recalculated.`,
    confirmText: 'Delete', danger: true
  });
  if (!ok) return;
  delBtn.disabled = true;
  try {
    await store.deleteTransaction(s.editId);
    toast('Transaction deleted', 'success');
    close();
  } catch (err) {
    errBox.textContent = `Not deleted. ${store.friendlyError(err)}`;
    errBox.hidden = false;
  } finally { delBtn.disabled = false; }
}
