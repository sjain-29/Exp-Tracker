// Shared view pieces: transaction rows, account rows, section headers.
import { el, icon, money, friendlyDate } from '../utils.js';
import * as store from '../store.js';
import { accountType, isLiability } from '../defaults.js';

export function txVisual(t) {
  if (t.type === 'transfer') return { icon: 'arrow-left-right', color: 'var(--transfer)' };
  const c = store.categoryOf(t);
  return { icon: c?.icon || 'tag', color: c?.color || '#94A3B8' };
}

export function txRow(t, { onOpen, showDate = true } = {}) {
  const v = txVisual(t);
  const isTransfer = t.type === 'transfer';
  const title = isTransfer ? 'Transfer' : store.categoryName(t);
  const accountText = isTransfer
    ? `${store.accountName(t.accountId)} to ${store.accountName(t.toAccountId)}`
    : store.accountName(t.accountId);
  const amountText = isTransfer ? money(t.amount) : t.type === 'income' ? '+' + money(t.amount) : '−' + money(t.amount);
  const meta = [accountText];
  if (showDate) meta.unshift(friendlyDate(t.date));
  const pending = store.pending.has(t.id);
  return el('li', { class: `tx-row tx-${t.type}` },
    el('button', {
      type: 'button', class: 'tx-row-btn',
      'aria-label': `${title}, ${t.type}, ${money(t.amount)}, ${friendlyDate(t.date)}. Edit`,
      onclick: () => onOpen && onOpen(t.id)
    },
    el('span', { class: 'tx-ic', style: { '--c': v.color } }, icon(v.icon, 18)),
    el('span', { class: 'tx-main' },
      el('span', { class: 'tx-title' }, el('span', { text: title }),
        pending ? el('span', { class: 'badge badge-pending', title: 'Waiting for the server to confirm' }, icon('cloud-off', 12), 'Pending sync') : null),
      t.description ? el('span', { class: 'tx-desc', text: t.description }) : null,
      el('span', { class: 'tx-meta', text: meta.join(', ') })),
    el('span', { class: 'tx-amt' }, el('span', { class: 'amt', text: amountText }))));
}

export function balanceText(acc, bal) {
  if (isLiability(acc)) {
    if (bal < 0) return { label: 'Outstanding', value: money(-bal), cls: 'amt-due' };
    return { label: bal > 0 ? 'Credit balance' : 'No dues', value: money(bal), cls: 'amt-neutral' };
  }
  return { label: 'Balance', value: money(bal), cls: bal < 0 ? 'amt-neg' : 'amt-pos' };
}

export function accountSub(a) {
  const parts = [accountType(a.type).label];
  if (a.bankName) parts.push(a.bankName);
  if (a.nickname) parts.push(`"${a.nickname}"`);
  return parts.join(', ');
}

export function viewHeader(title, subtitle, ...actions) {
  return el('header', { class: 'view-head' },
    el('div', {}, el('h1', { text: title }), subtitle ? el('p', { class: 'view-sub', text: subtitle }) : null),
    actions.length ? el('div', { class: 'view-actions' }, ...actions) : null);
}

export function iconButton(iconName, label, onclick, cls = 'btn btn-soft') {
  return el('button', { type: 'button', class: cls, onclick }, icon(iconName, 18), el('span', { text: label }));
}

export function credit() {
  return el('p', { class: 'credit', text: 'Developed by Reconense' });
}
