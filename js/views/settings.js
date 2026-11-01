// Settings: profile, preferences, security/app lock, export/import, deletion.
import { el, icon, clear, todayISO, DATE_FORMATS, formatDate } from '../utils.js';
import { toast, confirmDialog, formDialog, selectEl, field, radioValue } from '../ui.js';
import * as store from '../store.js';
import { auth, deleteUser } from '../firebase.js';
import { reauthenticate, logout, sendEmailVerification } from '../auth.js';
import { accountType, isLiability } from '../defaults.js';
import { viewHeader, credit } from './common.js';
import { APP_VERSION } from '../version.js';

const CURRENCIES = [['INR', 'Indian Rupee (₹)'], ['USD', 'US Dollar ($)'], ['EUR', 'Euro (€)'], ['GBP', 'British Pound (£)'], ['AED', 'UAE Dirham'], ['SGD', 'Singapore Dollar']];

export function render(root) {
  const body = el('div', { class: 'settings' });
  root.append(viewHeader('Settings', null), body, credit());
  let built = false;
  let refs = {};

  function build() {
    clear(body);
    const user = auth.currentUser;
    const nameIn = el('input', { class: 'input', maxlength: '60', autocomplete: 'name' });
    const saveName = el('button', { type: 'button', class: 'btn btn-soft' }, 'Save');
    saveName.addEventListener('click', async () => {
      const v = nameIn.value.trim();
      if (!v) { toast('Enter a name.', 'error'); return; }
      saveName.disabled = true;
      try { await store.updateProfileName(v); toast('Name updated', 'success'); } catch (e) { toast(store.friendlyError(e), 'error'); }
      saveName.disabled = false;
    });
    const verify = el('div', { class: 'verify-row' });
    if (user && !user.emailVerified) {
      verify.append(el('span', { class: 'badge badge-warn', text: 'Email not verified' }),
        el('button', { type: 'button', class: 'link-btn', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await sendEmailVerification(user); toast('Verification email sent', 'success'); } catch (err) { toast(store.friendlyError(err), 'error'); }
        } }, 'Send verification email'));
    } else if (user) verify.append(el('span', { class: 'badge badge-ok' }, icon('circle-check', 12), 'Verified'));

    const currency = selectEl(CURRENCIES.map(([v, l]) => ({ value: v, label: l })), 'INR');
    currency.addEventListener('change', () => save({ currency: currency.value }, 'Currency updated'));
    const dateFmt = selectEl(DATE_FORMATS.map((f) => ({ value: f, label: `${f} (${formatDate(todayISO(), f)})` })), 'DD MMM YYYY');
    dateFmt.addEventListener('change', () => save({ dateFormat: dateFmt.value }, 'Date format updated'));
    const themeSeg = el('div', { class: 'seg seg-sm', role: 'radiogroup', 'aria-label': 'Theme' });
    for (const [k, l, ic] of [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]) {
      themeSeg.append(el('button', { type: 'button', role: 'radio', class: 'seg-btn', dataset: { key: k }, onclick: () => save({ theme: k }) }, icon(ic, 16), el('span', { text: l })));
    }
    const primary = el('select', { class: 'input' });
    primary.addEventListener('change', async () => {
      try { await store.setPrimary(primary.value); toast('Primary account updated', 'success'); } catch (e) { toast(store.friendlyError(e), 'error'); }
    });

    const lock = el('input', { type: 'checkbox', class: 'switch', 'aria-label': 'App lock' });
    const lockAfter = selectEl([{ value: '0', label: 'Every time the app opens' }, { value: '1', label: 'After 1 minute away' }, { value: '5', label: 'After 5 minutes away' }, { value: '15', label: 'After 15 minutes away' }], '5');
    lock.addEventListener('change', async () => {
      if (lock.checked && !(await reauthenticate('Turn on app lock', 'Enter your password. You will use it to unlock PaisaPilot.'))) { lock.checked = false; return; }
      save({ lockEnabled: lock.checked }, lock.checked ? 'App lock on' : 'App lock off');
    });
    lockAfter.addEventListener('change', () => save({ lockAfterMin: Number(lockAfter.value) }, 'Saved'));

    const importIn = el('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'import-file' });
    importIn.addEventListener('change', () => { const file = importIn.files[0]; importIn.value = ''; if (file) importFlow(file); });

    body.append(
      section('Profile', 'user',
        el('div', { class: 'profile-row' },
          el('div', { class: 'avatar', 'aria-hidden': 'true', text: ((user?.displayName || user?.email || '?')[0] || '?').toUpperCase() }),
          el('div', {}, el('p', { class: 'p-email', text: user?.email || '' }), verify)),
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Display name' }), el('div', { class: 'inline-row' }, nameIn, saveName))),
      section('Preferences', 'sliders-horizontal',
        field('Default currency', currency, 'Display only. Amounts are not converted. INR uses Indian digit grouping (₹1,25,000.00).'),
        field('Primary account', primary, 'Pre-selected in every new expense and income.'),
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Theme' }), themeSeg),
        field('Date display', dateFmt)),
      section('Security', 'shield-check',
        el('label', { class: 'switch-row' }, el('span', {}, el('span', { class: 'label', text: 'App lock' }),
          el('span', { class: 'hint', text: 'Ask for your password when you come back to the app. This is a screen lock on this device; your data is protected by Firebase sign-in and database rules either way.' })), lock),
        field('Lock', lockAfter),
        el('button', { type: 'button', class: 'btn btn-soft btn-block', onclick: async () => {
          if (store.pending.size && !(await confirmDialog({ title: 'Sign out with unsynced entries?', message: `${store.pending.size} entr${store.pending.size === 1 ? 'y has' : 'ies have'} not reached the server yet and will be lost if you sign out now.`, confirmText: 'Sign out anyway', danger: true }))) return;
          await logout(); toast('Signed out', 'info');
        } }, icon('log-out', 18), el('span', { text: 'Sign out' }))),
      section('Your data', 'download',
        el('div', { class: 'btn-stack' },
          el('button', { type: 'button', class: 'btn btn-soft', onclick: () => exportTransactionsCSV(store.txList()) }, icon('download', 18), el('span', { text: 'Transactions (CSV)' })),
          el('button', { type: 'button', class: 'btn btn-soft', onclick: exportAccountsCSV }, icon('download', 18), el('span', { text: 'Accounts (CSV)' })),
          el('button', { type: 'button', class: 'btn btn-soft', onclick: exportJSON }, icon('download', 18), el('span', { text: 'Full backup (JSON)' })),
          el('label', { class: 'btn btn-soft', for: 'import-file', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); importIn.click(); } } },
            icon('upload', 18), el('span', { text: 'Restore from backup (JSON)' })), importIn),
        el('p', { class: 'hint', text: 'Exports are created on this device and saved to your Downloads. Keep them private: they contain your financial records.' })),
      section('Delete data', 'trash-2',
        el('div', { class: 'hint-box' }, icon('info', 16), el('span', { text: 'Removing PaisaPilot from your home screen or clearing browser data only removes the app from this phone. Your records stay safely in Firebase until you delete them here.' })),
        el('button', { type: 'button', class: 'btn btn-danger-soft btn-block', onclick: deleteDataFlow }, icon('trash-2', 18), el('span', { text: 'Delete all my cloud data' })),
        el('button', { type: 'button', class: 'btn btn-danger-soft btn-block', onclick: deleteAccountFlow }, icon('user', 18), el('span', { text: 'Delete my account and all data' }))),
      section('About', 'info',
        el('p', { class: 'about' }, el('strong', { text: 'PaisaPilot' }), ` version ${APP_VERSION}. Every Rupee, Under Control.`),
        el('p', { class: 'hint', text: 'The app files are hosted publicly on GitHub Pages; your financial records live only in your Firebase database, readable solely by your signed-in account.' })));
    refs = { nameIn, currency, dateFmt, themeSeg, primary, lock, lockAfter };
    built = true;
  }

  function update() {
    if (!built) build();
    const st = store.state.settings || {};
    const r = refs;
    if (document.activeElement !== r.nameIn) r.nameIn.value = store.state.profile?.displayName || auth.currentUser?.displayName || '';
    r.currency.value = st.currency || 'INR';
    r.dateFmt.value = st.dateFormat || 'DD MMM YYYY';
    for (const b of r.themeSeg.children) b.setAttribute('aria-checked', String(b.dataset.key === (st.theme || 'dark')));
    clear(r.primary);
    const p = store.primaryId();
    if (!p) r.primary.append(el('option', { value: '', text: 'No primary account', disabled: true, selected: true }));
    for (const a of store.activeAccounts()) r.primary.append(el('option', { value: a.id, text: a.name, selected: a.id === p }));
    r.lock.checked = st.lockEnabled === true;
    r.lockAfter.value = String(st.lockAfterMin ?? 5);
    r.lockAfter.disabled = !r.lock.checked;
  }
  return { update };
}

function section(title, ic, ...children) {
  return el('section', { class: 'set-section' }, el('h2', {}, icon(ic, 18), el('span', { text: title })), ...children);
}

async function save(patch, msg) {
  try { await store.updateSettings(patch); if (msg) toast(msg, 'success'); } catch (e) { toast(store.friendlyError(e), 'error'); }
}

/* ---------------- Export ---------------- */

/** Quote a CSV cell; neutralise spreadsheet formulas in user text (CSV injection). */
function cell(v, isText = true) {
  let s = v === null || v === undefined ? '' : String(v);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const amt = (p) => (p / 100).toFixed(2);

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name, hidden: true });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportTransactionsCSV(rows) {
  if (!rows.length) { toast('No transactions to export.', 'info'); return; }
  const head = ['Date', 'Type', 'Amount', 'Category', 'Account', 'To Account', 'Description', 'Reference', 'Notes', 'Created At'];
  const lines = [head.join(',')];
  for (const t of rows) {
    lines.push([
      cell(t.date, false), cell(t.type, false), cell(amt(t.amount), false),
      cell(t.type === 'transfer' ? '' : store.categoryName(t)), cell(store.accountName(t.accountId)),
      cell(t.toAccountId ? store.accountName(t.toAccountId) : ''), cell(t.description), cell(t.reference), cell(t.notes),
      cell(typeof t.createdAt === 'number' ? new Date(t.createdAt).toISOString() : '', false)
    ].join(','));
  }
  download(`paisapilot-transactions-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast(`Exported ${rows.length} transaction${rows.length === 1 ? '' : 's'}`, 'success');
}

function exportAccountsCSV() {
  const list = store.accountsList();
  if (!list.length) { toast('No accounts to export.', 'info'); return; }
  const b = store.balances(); const p = store.primaryId();
  const lines = ['Name,Type,Bank,Nickname,Opening Balance,Current Balance,Balance Convention,Primary,Active'];
  for (const a of list) {
    lines.push([cell(a.name), cell(accountType(a.type).label), cell(a.bankName), cell(a.nickname), cell(amt(Number(a.openingBalance) || 0), false),
      cell(amt(b.get(a.id) || 0), false), cell(isLiability(a) ? 'negative = amount owed' : 'positive = money held', false),
      a.id === p ? 'Yes' : 'No', a.active === false ? 'No' : 'Yes'].join(','));
  }
  download(`paisapilot-accounts-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('Accounts exported', 'success');
}

function exportJSON() {
  const data = store.buildBackup();
  download(`paisapilot-backup-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Backup downloaded', 'success');
}

/* ---------------- Import ---------------- */

async function importFlow(file) {
  if (file.size > 25 * 1024 * 1024) { toast('That file is too large to be a PaisaPilot backup.', 'error'); return; }
  let raw;
  try { raw = JSON.parse(await file.text()); } catch { toast('That file is not valid JSON.', 'error'); return; }
  const mode = await formDialog({
    title: 'Restore from backup', submitText: 'Check file',
    build(form) {
      form.append(
        el('p', { class: 'muted', text: `File: ${file.name}` }),
        el('label', { class: 'radio-card' }, el('input', { type: 'radio', name: 'imp', value: 'merge', checked: true }),
          el('span', {}, el('strong', { text: 'Merge' }), el('span', { class: 'hint', text: 'Add records from the file that are not already here. Nothing existing is changed.' }))),
        el('label', { class: 'radio-card' }, el('input', { type: 'radio', name: 'imp', value: 'replace' }),
          el('span', {}, el('strong', { text: 'Replace everything' }), el('span', { class: 'hint', text: 'Delete all current accounts, categories and transactions, then load the file.' }))));
      return () => radioValue(form, 'imp');
    }
  });
  if (!mode) return;
  const v = store.validateBackup(raw, mode);
  if (!v.ok) { toast(`Import stopped: ${v.error}`, 'error', { duration: 9000 }); return; }
  const c = v.counts;
  const ok = await confirmDialog({
    title: mode === 'replace' ? 'Replace all data?' : 'Merge this backup?',
    message: `The file has ${c.accounts} accounts, ${c.categories} categories and ${c.transactions} transactions.`,
    details: mode === 'replace' ? 'Everything currently in your cloud data will be overwritten. Download a backup first if unsure.' : 'Records whose IDs already exist will be skipped.',
    confirmText: mode === 'replace' ? 'Replace data' : 'Merge', danger: mode === 'replace', typeToConfirm: mode === 'replace' ? 'REPLACE' : null
  });
  if (!ok) return;
  try {
    const added = await store.importBackup(v, mode);
    toast(mode === 'replace' ? 'Backup restored' : `Merged ${added.accounts} accounts, ${added.categories} categories, ${added.transactions} transactions`, 'success', { duration: 5000 });
  } catch (e) { toast(`Import failed, nothing was changed. ${store.friendlyError(e)}`, 'error', { duration: 9000 }); }
}

/* ---------------- Deletion ---------------- */

async function deleteDataFlow() {
  const ok = await confirmDialog({
    title: 'Delete all cloud data?', danger: true, confirmText: 'Continue', typeToConfirm: 'DELETE',
    message: 'This permanently deletes every account, category, transaction and setting stored for you in Firebase. Your sign-in stays, so you can start fresh.',
    details: 'This cannot be undone. Download a JSON backup first if you might need it.'
  });
  if (!ok || !(await reauthenticate())) return;
  try { await store.deleteAllCloudData(); toast('All cloud data deleted', 'success'); }
  catch (e) { toast(store.friendlyError(e), 'error'); }
}

async function deleteAccountFlow() {
  const ok = await confirmDialog({
    title: 'Delete your account?', danger: true, confirmText: 'Continue', typeToConfirm: 'DELETE',
    message: 'Your login and all your financial data will be permanently deleted from Firebase.',
    details: 'This cannot be undone.'
  });
  if (!ok || !(await reauthenticate())) return;
  const user = auth.currentUser;
  try {
    await store.deleteAllCloudData();
    await deleteUser(user);
    toast('Your account and data were deleted', 'success');
  } catch (e) {
    toast(`Could not finish deleting your account. ${store.friendlyError(e)}`, 'error', { duration: 9000 });
  }
}

