// Accounts: list with derived balances, add/edit, primary, deactivate, safe delete, transfers.
import { el, icon, clear, money, parseSignedAmount, paiseToInput, currencySymbol } from '../utils.js';
import { toast, formDialog, openSheet, confirmDialog, field, selectEl, swatchPicker, iconPicker, radioValue, emptyState, UserError } from '../ui.js';
import * as store from '../store.js';
import { ACCOUNT_TYPES, ACCOUNT_ICONS, COLORS, accountType, isLiability } from '../defaults.js';
import { balanceText, accountSub, viewHeader, iconButton, credit } from './common.js';
import { openTransfer } from '../modal.js';

export function render(root) {
  const summary = el('div', { class: 'acc-summary' });
  const list = el('ul', { class: 'acc-list', 'aria-label': 'Active accounts' });
  const inactive = el('details', { class: 'inactive-box' });
  root.append(
    viewHeader('Accounts', 'Balances are calculated from your opening balance and every transaction.',
      iconButton('arrow-left-right', 'Transfer', () => openTransfer(), 'btn btn-soft'),
      iconButton('plus', 'Add account', () => editAccountDialog(null), 'btn btn-primary')),
    summary, list, inactive, credit());

  function update() {
    const t = store.totals();
    clear(summary).append(
      stat('Cash & bank', money(t.cashBank), t.cashBank < 0 ? 'amt-neg' : 'amt-pos'),
      stat('Card dues', money(t.cardDues), t.cardDues ? 'amt-due' : 'amt-neutral'),
      stat('Net balance', money(t.net), t.net < 0 ? 'amt-neg' : ''));
    const bal = store.balances();
    const p = store.primaryId();
    const active = store.activeAccounts();
    clear(list);
    if (!active.length) {
      list.append(el('li', {}, emptyState('landmark', 'No accounts yet', 'Add your bank account, cash or card to start tracking.',
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => editAccountDialog(null) }, icon('plus', 18), el('span', { text: 'Add account' })))));
    }
    for (const a of active) list.append(accountRow(a, bal.get(a.id) || 0, a.id === p));
    const off = store.accountsList().filter((a) => a.active === false);
    clear(inactive);
    inactive.hidden = !off.length;
    if (off.length) {
      inactive.append(el('summary', {}, el('span', { text: `Inactive accounts (${off.length})` }), icon('chevron-down', 16, 'chev')));
      const ul = el('ul', { class: 'acc-list' });
      for (const a of off) ul.append(accountRow(a, bal.get(a.id) || 0, false));
      inactive.append(ul);
    }
  }
  return { update };
}

function stat(label, value, cls) {
  return el('div', { class: 'mini-stat' }, el('span', { class: 'mini-label', text: label }), el('span', { class: `mini-value amt ${cls}`, text: value }));
}

function accountRow(a, bal, isPrimary) {
  const b = balanceText(a, bal);
  return el('li', { class: `acc-row ${a.active === false ? 'is-inactive' : ''}` },
    el('button', { type: 'button', class: 'acc-row-btn', onclick: () => accountDetail(a.id), 'aria-label': `${a.name}, ${b.label} ${b.value}. Details` },
      el('span', { class: 'acc-ic', style: { '--c': a.color || '#0EA5A0' } }, icon(a.icon || accountType(a.type).icon, 20)),
      el('span', { class: 'acc-main' },
        el('span', { class: 'acc-name' }, el('span', { text: a.name }),
          isPrimary ? el('span', { class: 'badge badge-primary' }, icon('star', 12), 'Primary') : null,
          a.active === false ? el('span', { class: 'badge', text: 'Inactive' }) : null),
        el('span', { class: 'acc-sub', text: accountSub(a) })),
      el('span', { class: 'acc-bal' }, el('span', { class: 'acc-bal-label', text: b.label }), el('span', { class: `amt ${b.cls}`, text: b.value }))));
}

/* ---------------- Detail sheet ---------------- */

function accountDetail(id) {
  const a = store.state.accounts[id];
  if (!a) return;
  const bal = store.balances().get(id) || 0;
  const b = balanceText(a, bal);
  const count = store.txCountFor({ accountId: id });
  const isPrimary = store.primaryId() === id;
  const active = a.active !== false;
  openSheet({
    title: a.name,
    build(body, close) {
      const opening = Number(a.openingBalance) || 0;
      body.append(
        el('div', { class: 'detail-hero' },
          el('span', { class: 'acc-ic acc-ic-lg', style: { '--c': a.color || '#0EA5A0' } }, icon(a.icon || accountType(a.type).icon, 24)),
          el('div', {}, el('p', { class: 'detail-label', text: b.label }), el('p', { class: `detail-value amt ${b.cls}`, text: b.value }))),
        el('dl', { class: 'detail-list' },
          dt('Type', accountType(a.type).label),
          a.bankName ? dt('Bank', a.bankName) : null,
          a.nickname ? dt('Nickname', a.nickname) : null,
          dt(isLiability(a) ? 'Opening outstanding' : 'Opening balance', isLiability(a) ? money(-opening) : money(opening)),
          dt('Transactions', String(count)),
          dt('Status', active ? (isPrimary ? 'Active, primary' : 'Active') : 'Inactive')),
        isLiability(a) ? el('p', { class: 'hint-box' }, icon('info', 16),
          el('span', { text: 'Card spends increase the outstanding amount. To record a bill payment, use Transfer from your bank account to this card.' })) : null,
        el('div', { class: 'detail-actions' },
          act('pencil', 'Edit', () => { close(); editAccountDialog(id); }),
          active && !isPrimary ? act('star', 'Make primary', async () => {
            try { await store.setPrimary(id); toast(`${a.name} is now your primary account`, 'success'); close(); }
            catch (e) { toast(store.friendlyError(e), 'error'); }
          }) : null,
          active ? act('arrow-left-right', 'Transfer from here', () => { close(); openTransfer({ fromId: id }); }) : null,
          act(active ? 'archive' : 'archive-restore', active ? 'Deactivate' : 'Reactivate', () => { close(); toggleActive(id); }),
          act('trash-2', 'Delete', () => { close(); deleteFlow(id); }, 'danger')));
    }
  });
}
const dt = (k, v) => [el('dt', { text: k }), el('dd', { text: v })];
const act = (ic, label, onclick, cls = '') => el('button', { type: 'button', class: `detail-act ${cls}`, onclick }, icon(ic, 18), el('span', { text: label }));

/* ---------------- Editor ---------------- */

export function editAccountDialog(id) {
  const a = id ? store.state.accounts[id] : null;
  const isPrimary = id && store.primaryId() === id;
  const firstAccount = !store.accountsList().length;
  return formDialog({
    title: a ? 'Edit account' : 'Add account',
    submitText: a ? 'Save changes' : 'Add account',
    build(form) {
      const name = el('input', { class: 'input', maxlength: '60', required: true, value: a?.name || '', placeholder: 'HDFC Savings', autocomplete: 'off' });
      const type = selectEl(ACCOUNT_TYPES.map((t) => ({ value: t.id, label: t.label })), a?.type || 'savings');
      const bank = el('input', { class: 'input', maxlength: '60', value: a?.bankName || '', placeholder: 'HDFC Bank', autocomplete: 'off' });
      const nick = el('input', { class: 'input', maxlength: '40', value: a?.nickname || '', placeholder: 'Daily spends', autocomplete: 'off' });
      const ob = Number(a?.openingBalance) || 0;
      const openIn = el('input', { class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: '0',
        value: ob ? paiseToInput(a?.type === 'credit_card' ? -ob : ob) : '' });
      const openLabel = el('span', { class: 'label' });
      const openHint = el('span', { class: 'hint' });
      const syncType = () => {
        const cc = type.value === 'credit_card';
        openLabel.textContent = cc ? `Amount owed now (${currencySymbol()})` : `Opening balance (${currencySymbol()})`;
        openHint.textContent = cc
          ? 'Enter today\'s outstanding on the card as a positive number. It is tracked as a due, separate from your bank balances.'
          : 'Balance on the day you start tracking. Use a minus sign for an overdraft.';
        const ic = form.querySelector(`input[name="acc-icon"][value="${accountType(type.value).icon}"]`);
        if (!a && ic) ic.checked = true;
      };
      type.addEventListener('change', syncType);
      const primary = el('input', { type: 'checkbox', class: 'switch', checked: isPrimary || firstAccount, disabled: isPrimary || firstAccount });
      form.append(
        field('Account name', name),
        el('div', { class: 'grid-2' }, field('Type', type), field('Bank (optional)', bank)),
        field('Nickname (optional)', nick),
        el('label', { class: 'field' }, openLabel, openIn, openHint),
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Icon' }), iconPicker(ACCOUNT_ICONS, a?.icon || 'landmark', 'acc-icon')),
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Colour' }), swatchPicker(COLORS, a?.color || COLORS[0], 'acc-color')),
        el('label', { class: 'switch-row' }, el('span', {},
          el('span', { class: 'label', text: 'Primary account' }),
          el('span', { class: 'hint', text: firstAccount ? 'Your first account becomes primary.' : isPrimary ? 'To change, make another account primary.' : 'Selected by default in new transactions.' })), primary));
      syncType();
      return () => {
        const r = parseSignedAmount(openIn.value);
        if (!r.ok) throw new UserError(`Opening balance: ${r.error}`);
        return {
          name: name.value.trim(), type: type.value, bankName: bank.value, nickname: nick.value,
          openingBalance: type.value === 'credit_card' ? -r.paise : r.paise,
          icon: radioValue(form, 'acc-icon'), color: radioValue(form, 'acc-color'),
          active: a ? a.active !== false : true, makePrimary: primary.checked && !isPrimary
        };
      };
    },
    async onSubmit(v) {
      if (a && a.active === false && v.makePrimary) throw new UserError('Reactivate this account before making it primary.');
      const newId = await store.saveAccount(id, v, { makePrimary: v.makePrimary });
      toast(a ? 'Account updated' : `${v.name} added`, 'success');
      return newId;
    }
  });
}

/* ---------------- Deactivate / delete ---------------- */

async function choosePrimary(excludeId, title, message) {
  const others = store.activeAccounts().filter((x) => x.id !== excludeId);
  if (!others.length) return null;
  return formDialog({
    title,
    submitText: 'Continue',
    build(form) {
      const sel = selectEl(others.map((o) => ({ value: o.id, label: o.name })), others[0].id);
      form.append(el('p', { class: 'muted', text: message }), field('New primary account', sel));
      return () => sel.value;
    }
  });
}

async function toggleActive(id) {
  const a = store.state.accounts[id];
  if (!a) return;
  try {
    if (a.active === false) {
      await store.setAccountActive(id, true);
      toast(`${a.name} reactivated`, 'success');
      return;
    }
    let np = null;
    if (store.primaryId() === id) {
      if (store.activeAccounts().length < 2) { toast('Add or reactivate another account first. You need one active primary account.', 'error'); return; }
      np = await choosePrimary(id, 'Choose a new primary account', `${a.name} is your primary account. Pick another active account to be primary.`);
      if (!np) return;
    } else {
      const ok = await confirmDialog({ title: `Deactivate ${a.name}?`, message: 'It will be hidden from new transactions. Its history and balance stay intact, and you can reactivate it any time.', confirmText: 'Deactivate' });
      if (!ok) return;
    }
    await store.setAccountActive(id, false, np);
    toast(`${a.name} deactivated`, 'success');
  } catch (e) { toast(store.friendlyError(e), 'error'); }
}

async function deleteFlow(id) {
  const a = store.state.accounts[id];
  if (!a) return;
  const count = store.txCountFor({ accountId: id });
  const isPrimary = store.primaryId() === id;
  try {
    if (!count) {
      let np = null;
      if (isPrimary && store.activeAccounts().filter((x) => x.id !== id).length) {
        np = await choosePrimary(id, 'Choose a new primary account', `${a.name} is your primary account. Pick a new primary before deleting it.`);
        if (!np) return;
      }
      const ok = await confirmDialog({ title: `Delete ${a.name}?`, message: 'This account has no transactions. It will be permanently removed.', confirmText: 'Delete account', danger: true });
      if (!ok) return;
      await store.deleteAccount(id, { newPrimaryId: np });
      toast('Account deleted', 'success');
      return;
    }
    const targets = store.accountsList().filter((x) => x.id !== id);
    const res = await formDialog({
      title: `${a.name} has ${count} transaction${count === 1 ? '' : 's'}`,
      submitText: 'Continue',
      build(form) {
        const opt1 = el('input', { type: 'radio', name: 'del-mode', value: 'deactivate', checked: true });
        const opt2 = el('input', { type: 'radio', name: 'del-mode', value: 'move', disabled: !targets.length });
        const sel = selectEl(targets.map((o) => ({ value: o.id, label: o.name + (o.active === false ? ' (inactive)' : '') })), targets[0]?.id);
        form.append(
          el('p', { class: 'muted', text: 'Deleting it outright would orphan your history, so choose one:' }),
          el('label', { class: 'radio-card' }, opt1, el('span', {}, el('strong', { text: 'Deactivate (recommended)' }), el('span', { class: 'hint', text: 'Hide it from new entries and keep its history.' }))),
          el('label', { class: 'radio-card' }, opt2, el('span', {}, el('strong', { text: 'Move transactions, then delete' }),
            el('span', { class: 'hint', text: 'All its transactions and its opening balance move to the account you choose. This cannot be undone.' }))),
          field('Move to', sel));
        return () => ({ mode: radioValue(form, 'del-mode'), moveTo: sel.value });
      }
    });
    if (!res) return;
    if (res.mode === 'deactivate') { await toggleActive(id); return; }
    const target = store.state.accounts[res.moveTo];
    const ok = await confirmDialog({
      title: 'Move and delete?', danger: true, confirmText: 'Move and delete', typeToConfirm: 'DELETE',
      message: `${count} transaction${count === 1 ? '' : 's'} will move from ${a.name} to ${target?.name}, then ${a.name} will be deleted.`
    });
    if (!ok) return;
    let np = null;
    if (isPrimary && target?.active === false) {
      np = await choosePrimary(id, 'Choose a new primary account', 'Pick a new primary account.');
      if (!np) return;
    }
    await store.deleteAccount(id, { moveTo: res.moveTo, newPrimaryId: np });
    toast('Transactions moved and account deleted', 'success');
  } catch (e) { toast(store.friendlyError(e), 'error'); }
}

