// Account statement: opening balance, money in, money out, closing balance and a running-balance
// ledger for one account over a week, month, year, all time or a custom range.
// Read-only: it only reads data already loaded in the app. Nothing is written to the database.
import { el, icon, clear, money, todayISO, addDays, addMonths, monthStart, monthEnd, weekStart, formatDate, shortDay, isISODate } from '../utils.js';
import { openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { isLiability } from '../defaults.js';
import { txVisual } from './common.js';
import { openEdit } from '../modal.js';
import { cell as csvCell, download as downloadFile } from './settings.js';

export const STATEMENT_UNITS = [['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly'], ['all', 'All time'], ['custom', 'Custom']];
const PAGE = 150;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WORD = { week: 'week', month: 'month', year: 'year' };

/* ---------------- Periods ---------------- */

function periodOf(unit, anchor) {
  if (unit === 'week') { const f = weekStart(anchor); return { from: f, to: addDays(f, 6) }; }
  if (unit === 'year') return { from: anchor.slice(0, 4) + '-01-01', to: anchor.slice(0, 4) + '-12-31' };
  return { from: monthStart(anchor), to: monthEnd(anchor) };
}

function stepPeriod(unit, from, dir) {
  if (unit === 'week') return addDays(from, 7 * dir);
  if (unit === 'year') return `${Number(from.slice(0, 4)) + dir}-01-01`;
  return addMonths(from, dir);
}

function periodTitle(unit, r) {
  if (unit === 'month') return `${MONTHS[Number(r.from.slice(5, 7)) - 1]} ${r.from.slice(0, 4)}`;
  if (unit === 'year') return r.from.slice(0, 4);
  if (unit === 'week') {
    return r.from.slice(0, 4) === r.to.slice(0, 4)
      ? `${shortDay(r.from)} – ${shortDay(r.to)} ${r.to.slice(0, 4)}`
      : `${shortDay(r.from)} ${r.from.slice(0, 4)} – ${shortDay(r.to)} ${r.to.slice(0, 4)}`;
  }
  if (unit === 'all') return 'All time';
  return 'Custom dates';
}

/** "This month", "Last week"… or '' for older periods. */
function relativeTag(unit, r) {
  if (!WORD[unit]) return '';
  const now = periodOf(unit, todayISO());
  if (now.from === r.from) return `This ${WORD[unit]}`;
  if (periodOf(unit, stepPeriod(unit, now.from, -1)).from === r.from) return `Last ${WORD[unit]}`;
  return '';
}

/* ---------------- Figures ---------------- */

/** Transactions that touch this account, oldest first (same order the balance is built in). */
function accountTxs(id) {
  return store.txList().filter((t) => t.accountId === id || (t.type === 'transfer' && t.toAccountId === id)).reverse();
}

/** Signed effect of a transaction on this account: + money in, − money out. Mirrors store.balances(). */
function effect(t, id) {
  if (t.type === 'income') return t.accountId === id ? t.amount : 0;
  if (t.type === 'expense') return t.accountId === id ? -t.amount : 0;
  let v = 0;
  if (t.accountId === id) v -= t.amount;
  if (t.toAccountId === id) v += t.amount;
  return v;
}

function rangeFor(st, list) {
  const t = todayISO();
  if (st.unit === 'custom') {
    let { from, to } = st.custom;
    if (!isISODate(from)) from = monthStart(t);
    if (!isISODate(to)) to = t;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }
  if (st.unit === 'all') {
    const first = list.length ? list[0].date : t;
    const last = list.length ? list[list.length - 1].date : t;
    return { from: first < t ? first : t, to: last > t ? last : t };
  }
  return periodOf(st.unit, st.anchor);
}

/**
 * opening = account opening balance + every transaction dated before `from`
 * closing = opening + money in − money out (transactions from `from` to `to`, inclusive)
 */
function compute(a, id, list, r) {
  let opening = Number(a.openingBalance) || 0;
  const s = { income: 0, transferIn: 0, expense: 0, transferOut: 0, rows: [] };
  let bal = 0;
  let started = false;
  for (const t of list) {
    const v = effect(t, id);
    if (t.date < r.from) { opening += v; continue; }
    if (t.date > r.to) break;
    if (!started) { bal = opening; started = true; }
    bal += v;
    if (t.type === 'income') s.income += t.amount;
    else if (t.type === 'expense') s.expense += t.amount;
    else if (v > 0) s.transferIn += v;
    else if (v < 0) s.transferOut += -v;
    s.rows.push({ t, v, bal });
  }
  s.opening = opening;
  s.moneyIn = s.income + s.transferIn;
  s.moneyOut = s.expense + s.transferOut;
  s.closing = opening + s.moneyIn - s.moneyOut;
  return s;
}

/* ---------------- Display helpers ---------------- */

/** Cards: positive = credit, negative = amount owed (shown as a positive due). */
function balShow(a, v) {
  if (!isLiability(a)) return { text: money(v), cls: v < 0 ? 'amt-neg' : '' };
  if (v < 0) return { text: money(-v), cls: 'amt-due' };
  if (v > 0) return { text: `${money(v)} credit`, cls: 'amt-neutral' };
  return { text: money(0), cls: 'amt-neutral' };
}
function balShort(a, v) {
  if (!isLiability(a)) return `Bal ${money(v)}`;
  return v < 0 ? `Due ${money(-v)}` : v > 0 ? `Credit ${money(v)}` : 'No dues';
}
function rowTitle(t, id) {
  if (t.type !== 'transfer') return store.categoryName(t);
  return t.accountId === id ? `Transfer to ${store.accountName(t.toAccountId)}` : `Transfer from ${store.accountName(t.accountId)}`;
}
const parts = (list) => list.filter(([, v]) => v).map(([k, v]) => `${k} ${money(v)}`).join(' · ');

/* ---------------- Sheet ---------------- */

/** Open the statement for an account. Resolves when the sheet closes. */
export function openStatement(id, unit = 'month') {
  const a0 = store.state.accounts[id];
  if (!a0) return Promise.resolve();
  const t = todayISO();
  const st = {
    unit: STATEMENT_UNITS.some(([k]) => k === unit) ? unit : 'month',
    anchor: t, custom: { from: monthStart(t), to: t }, limit: PAGE, newestFirst: false
  };
  return openSheet({
    title: `${a0.name} statement`,
    className: 'sheet-statement',
    build(body, close, dlg) {
      const draw = () => {
        const a = store.state.accounts[id];
        if (!a) { close(); return; }
        render(body, a, id, st, draw);
      };
      // Live: edits made from this sheet (tap a row) or on another device show up straight away.
      const unsub = store.subscribe(() => { if (dlg.open) draw(); });
      dlg.addEventListener('close', unsub);
      draw();
    }
  });
}

function render(body, a, id, st, redraw) {
  const list = accountTxs(id);
  const r = rangeFor(st, list);
  const s = compute(a, id, list, r);
  const liab = isLiability(a);
  const today = todayISO();

  const go = (patch) => { Object.assign(st, patch, { limit: PAGE }); redraw(); };

  /* Period type */
  const units = el('div', { class: 'chips stmt-units', role: 'radiogroup', 'aria-label': 'Statement period' },
    ...STATEMENT_UNITS.map(([k, l]) => el('button', {
      type: 'button', role: 'radio', class: `chip${k === st.unit ? ' on' : ''}`, 'aria-checked': String(k === st.unit), text: l,
      onclick: () => go({ unit: k, anchor: today })
    })));

  /* Period picker */
  let picker;
  const caption = `${formatDate(r.from)} to ${formatDate(r.to)}`;
  if (st.unit === 'custom') {
    const fromIn = el('input', { type: 'date', class: 'input', value: r.from, max: '2100-12-31', 'aria-label': 'From date' });
    const toIn = el('input', { type: 'date', class: 'input', value: r.to, max: '2100-12-31', 'aria-label': 'To date' });
    const onChange = () => go({ custom: { from: fromIn.value, to: toIn.value } });
    fromIn.addEventListener('change', onChange);
    toIn.addEventListener('change', onChange);
    picker = el('div', { class: 'custom-range' },
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'From' }), fromIn),
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'To' }), toIn));
  } else {
    const first = list.length ? list[0].date : today;
    const last = list.length ? list[list.length - 1].date : today;
    const lo = first < today ? first : today;
    const hi = last > today ? last : today;
    const stepper = st.unit !== 'all';
    const word = WORD[st.unit];
    const tag = relativeTag(st.unit, r);
    picker = el('div', { class: `stmt-nav${stepper ? '' : ' no-step'}` },
      stepper ? el('button', {
        type: 'button', class: 'icon-btn stmt-step', 'aria-label': `Previous ${word}`, disabled: r.from <= lo,
        onclick: () => go({ anchor: stepPeriod(st.unit, r.from, -1) })
      }, icon('chevron-right', 22, 'flip-x')) : null,
      el('div', { class: 'stmt-period', 'aria-live': 'polite' },
        el('p', { class: 'stmt-period-title', text: periodTitle(st.unit, r) }),
        el('p', { class: 'stmt-period-sub', text: tag ? `${tag} · ${caption}` : caption })),
      stepper ? el('button', {
        type: 'button', class: 'icon-btn stmt-step', 'aria-label': `Next ${word}`, disabled: r.to >= hi,
        onclick: () => go({ anchor: stepPeriod(st.unit, r.from, 1) })
      }, icon('chevron-right', 22)) : null);
  }

  /* Summary */
  const open = balShow(a, s.opening), closeB = balShow(a, s.closing);
  const running = r.to > today && r.from <= today;
  const line = (k, sub, v, vcls = '', extra = '') => el('div', { class: `stmt-line ${extra}` },
    el('div', {}, el('span', { class: 'stmt-k', text: k }), sub ? el('span', { class: 'stmt-sub', text: sub }) : null),
    el('span', { class: `stmt-v amt ${vcls}`, text: v }));
  const summary = el('div', { class: 'stmt-summary' },
    line(liab ? 'Outstanding at start' : 'Opening balance', `Start of ${formatDate(r.from)}`, open.text, open.cls),
    line(liab ? 'Payments & credits' : 'Money in',
      (liab ? parts([['Payments', s.transferIn], ['Refunds & income', s.income]]) : parts([['Income', s.income], ['Transfers in', s.transferIn]])) || 'Nothing received',
      `+${money(s.moneyIn)}`, 'is-in'),
    line(liab ? 'Spends & charges' : 'Money out',
      (liab ? parts([['Spends', s.expense], ['Transfers out', s.transferOut]]) : parts([['Expenses', s.expense], ['Transfers out', s.transferOut]])) || 'Nothing spent',
      `−${money(s.moneyOut)}`, 'is-out'),
    line(liab ? 'Outstanding at end' : 'Closing balance',
      running ? `So far, as on ${formatDate(today)}` : `End of ${formatDate(r.to)}`, closeB.text, closeB.cls, 'stmt-total'));

  /* Ledger */
  const n = s.rows.length;
  const head = el('div', { class: 'stmt-head' },
    el('h3', { text: n ? `${n} transaction${n === 1 ? '' : 's'}` : 'Transactions' }),
    el('div', { class: 'stmt-head-actions' },
      n > 1 ? el('button', {
        type: 'button', class: 'link-btn stmt-sort', 'aria-label': `Sorted ${st.newestFirst ? 'newest' : 'oldest'} first. Change order`,
        onclick: () => go({ newestFirst: !st.newestFirst })
      }, st.newestFirst ? 'Newest first' : 'Oldest first') : null,
      el('button', { type: 'button', class: 'btn btn-soft btn-sm', onclick: () => downloadCSV(a, id, r, s) },
        icon('download', 16), el('span', { text: 'CSV' }))));

  let ledger;
  if (!n) {
    ledger = el('div', { class: 'chart-empty' }, icon('receipt', 22),
      el('span', { text: 'No transactions in this period. Opening and closing balance are the same.' }));
  } else {
    const ordered = st.newestFirst ? [...s.rows].reverse() : s.rows;
    ledger = el('ul', { class: 'tx-list stmt-list' }, ...ordered.slice(0, st.limit).map((row) => ledgerRow(a, id, row)));
  }
  const more = n > st.limit
    ? el('button', { type: 'button', class: 'btn btn-soft more-btn', onclick: () => { st.limit += PAGE; redraw(); } }, `Show more (${n - st.limit} left)`)
    : null;

  clear(body).append(units, picker, summary, head, ledger);
  if (more) body.append(more);
  body.append(el('p', { class: 'hint stmt-foot', text: 'Tap a transaction to edit it. Balances follow the same rule as the Accounts tab: opening balance plus every transaction up to that day.' }));
}

function ledgerRow(a, id, { t, v, bal }) {
  const vis = txVisual(t);
  const title = rowTitle(t, id);
  const meta = [formatDate(t.date)];
  if (t.reference) meta.push(`Ref ${t.reference}`);
  const pending = store.pending.has(t.id);
  const amountText = `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
  return el('li', { class: 'tx-row' },
    el('button', {
      type: 'button', class: 'tx-row-btn', onclick: () => openEdit(t.id),
      'aria-label': `${title}, ${amountText}, ${formatDate(t.date)}, ${balShort(a, bal)}. Edit`
    },
    el('span', { class: 'tx-ic', style: { '--c': vis.color } }, icon(vis.icon, 18)),
    el('span', { class: 'tx-main' },
      el('span', { class: 'tx-title' }, el('span', { text: title }),
        pending ? el('span', { class: 'badge badge-pending', title: 'Waiting for the server to confirm' }, icon('cloud-off', 12), 'Pending sync') : null),
      t.description ? el('span', { class: 'tx-desc', text: t.description }) : null,
      el('span', { class: 'tx-meta', text: meta.join(', ') })),
    el('span', { class: 'stmt-amts' },
      el('span', { class: `amt stmt-amt ${v >= 0 ? 'is-in' : 'is-out'}`, text: amountText }),
      el('span', { class: 'amt stmt-bal', text: balShort(a, bal) }))));
}

/* ---------------- CSV ---------------- */

const amt = (p) => (p / 100).toFixed(2);

function downloadCSV(a, id, r, s) {
  const liab = isLiability(a);
  const lines = [['Date', 'Details', 'Category', 'Description', 'Reference', 'Money In', 'Money Out', liab ? 'Balance (negative = owed)' : 'Balance'].join(',')];
  lines.push([csvCell(r.from, false), csvCell('Opening balance'), '', '', '', '', '', csvCell(amt(s.opening), false)].join(','));
  for (const { t, v, bal } of s.rows) {
    lines.push([
      csvCell(t.date, false), csvCell(rowTitle(t, id)), csvCell(t.type === 'transfer' ? '' : store.categoryName(t)),
      csvCell(t.description), csvCell(t.reference),
      v > 0 ? csvCell(amt(v), false) : '', v < 0 ? csvCell(amt(-v), false) : '', csvCell(amt(bal), false)
    ].join(','));
  }
  lines.push([csvCell(r.to, false), csvCell('Closing balance'), '', '', '', csvCell(amt(s.moneyIn), false), csvCell(amt(s.moneyOut), false), csvCell(amt(s.closing), false)].join(','));
  const slug = String(a.name || 'account').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'account';
  downloadFile(`paisapilot-statement-${slug}-${r.from}-to-${r.to}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('Statement downloaded', 'success');
}
