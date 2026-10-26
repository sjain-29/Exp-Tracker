// Dashboard: live balances (not filtered), this-month figures (fixed), and period-filtered stats + charts.
import { el, icon, clear, money, todayISO, monthStart, monthEnd, addDays, addMonths, daysBetween, shortDay, monthLabel, SVG_NS } from '../utils.js';
import { emptyState } from '../ui.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import { PERIODS, rangeFor, rangeLabel, inRange } from '../periods.js';
import { txRow, viewHeader, credit } from './common.js';
import { isLiability } from '../defaults.js';
import { openAdd, openTransfer, openEdit } from '../modal.js';

const ui = { period: 'month', custom: { from: '', to: '' } };

export function render(root, { navigate }) {
  const hero = el('section', { class: 'hero', 'aria-label': 'Current balances' });
  const quick = el('div', { class: 'quick' },
    el('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => openAdd() }, icon('plus', 20), el('span', { text: 'Add Transaction' })),
    el('button', { type: 'button', class: 'btn btn-soft btn-lg', onclick: () => openTransfer() }, icon('arrow-left-right', 18), el('span', { text: 'Transfer' })));

  const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Period' });
  for (const [key, label] of PERIODS) {
    chips.append(el('button', { type: 'button', role: 'radio', class: 'chip', dataset: { key }, text: label, onclick: () => { ui.period = key; update(); } }));
  }
  const fromIn = el('input', { type: 'date', class: 'input', 'aria-label': 'From date' });
  const toIn = el('input', { type: 'date', class: 'input', 'aria-label': 'To date' });
  const onCustom = () => { ui.custom = { from: fromIn.value, to: toIn.value }; update(); };
  fromIn.addEventListener('change', onCustom); toIn.addEventListener('change', onCustom);
  const customBox = el('div', { class: 'custom-range', hidden: true },
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'From' }), fromIn),
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'To' }), toIn));
  const caption = el('p', { class: 'period-caption' });
  const stats = el('div', { class: 'stats' });
  const grid = el('div', { class: 'chart-grid' });
  const recent = el('ul', { class: 'tx-list' });

  root.append(
    viewHeader('Dashboard', null),
    hero, quick,
    el('section', { class: 'period', 'aria-label': 'Selected period' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Period overview' })),
      chips, customBox, caption, stats, grid,
      el('div', { class: 'section-head' }, el('h2', { text: 'Recent in this period' }),
        el('button', { type: 'button', class: 'link-btn', onclick: () => navigate('transactions', rangeFor(ui.period, ui.custom)) }, 'See all'))),
    recent,
    credit());

  function update() {
    if (!store.isLoaded()) return;
    renderHero(hero);
    const r = rangeFor(ui.period, ui.custom);
    for (const c of chips.children) {
      const on = c.dataset.key === ui.period;
      c.setAttribute('aria-checked', String(on)); c.classList.toggle('on', on);
    }
    customBox.hidden = ui.period !== 'custom';
    if (ui.period === 'custom') { fromIn.value = r.from; toIn.value = r.to; }
    clear(caption).append(icon('calendar', 14), el('span', { text: `${rangeLabel(r)}. Figures below follow this filter.` }));

    const txs = store.txList().filter((t) => inRange(t, r));
    let inc = 0, exp = 0;
    for (const t of txs) { if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') exp += t.amount; }
    const net = inc - exp;
    clear(stats).append(
      statCard('Total expenses', money(exp), 'expense', 'arrow-up-right'),
      statCard('Total income', money(inc), 'income', 'arrow-down-left'),
      statCard('Net cash flow', (net > 0 ? '+' : '') + money(net), net < 0 ? 'expense' : 'saving', net < 0 ? 'trending-down' : 'trending-up',
        inc ? `${Math.round((net / inc) * 100)}% of income ${net < 0 ? 'overspent' : 'saved'}` : null));

    charts.destroyAll();
    clear(grid);
    const noTx = !txs.some((t) => t.type !== 'transfer');
    grid.append(
      chartCard('Expenses by category', null, (cv) => charts.doughnut(cv, byCategory(txs, 'expense')), !exp, 'No expenses in this period'),
      chartCard('Income by category', null, (cv) => charts.doughnut(cv, byCategory(txs, 'income')), !inc, 'No income in this period'),
      (() => { const s = series(txs, r); return chartCard('Income vs expenses', s.unit === 'day' ? 'Per day' : 'Per month', (cv) => charts.incomeVsExpense(cv, s.labels, s.income, s.expense), noTx, 'Nothing recorded in this period'); })(),
      (() => { const d = daily(txs, r); return chartCard('Daily spending', d.note, (cv) => charts.dailyLine(cv, d.labels, d.values), !exp, 'No spending to chart yet'); })(),
      (() => { const m = monthly(r); return chartCard('Monthly expenses', m.note, (cv) => charts.monthlyBars(cv, m.labels, m.values), !m.values.some(Boolean), 'No expenses in these months'); })(),
      (() => { const a = accountRows(); return chartCard('Account balances', 'Current, not filtered', (cv) => charts.accountBars(cv, a), !a.length, 'Add an account to compare balances', a.length > 4 ? 60 + a.length * 34 : null); })());

    clear(recent);
    if (!txs.length) {
      recent.append(el('li', {}, emptyState('receipt', store.txList().length ? 'Nothing in this period' : 'No transactions yet',
        store.txList().length ? 'Try another period, or add a transaction.' : 'Tap Add Transaction to record your first expense or income.')));
    }
    for (const t of txs.slice(0, 8)) recent.append(txRow(t, { onOpen: openEdit }));
  }

  return { update, destroy: () => charts.destroyAll() };
}

/* ---------------- Hero (live balances + this month) ---------------- */

function renderHero(hero) {
  const tot = store.totals();
  const t = todayISO();
  const ms = monthStart(t), me = monthEnd(t);
  let mInc = 0, mExp = 0;
  for (const x of store.txList()) {
    if (x.date < ms || x.date > me) continue;
    if (x.type === 'income') mInc += x.amount; else if (x.type === 'expense') mExp += x.amount;
  }
  const ratio = mInc ? Math.min(mExp / mInc, 1) : (mExp ? 1 : 0);
  const hasCards = store.accountsList().some(isLiability);
  clear(hero).append(
    el('div', { class: 'hero-main' },
      el('p', { class: 'hero-label' }, el('span', { text: 'Total balance across accounts' })),
      el('p', { class: 'hero-value amt', text: money(tot.net) }),
      el('p', { class: 'hero-note' }, icon('refresh-cw', 12), el('span', { text: 'Live. Not affected by the period filter.' })),
      el('div', { class: 'hero-split' },
        el('div', {}, el('span', { class: 'hs-label', text: 'Cash & bank' }), el('span', { class: 'hs-value amt', text: money(tot.cashBank) })),
        hasCards ? el('div', {}, el('span', { class: 'hs-label', text: 'Card dues' }), el('span', { class: 'hs-value amt due', text: money(tot.cardDues) })) : null)),
    el('div', { class: 'hero-month' },
      gauge(ratio, mExp > mInc, mInc === 0),
      el('div', { class: 'hm-text' },
        el('p', { class: 'hm-title', text: `This month (${monthLabel(t, false)})` }),
        el('p', { class: 'hm-row' }, el('span', { class: 'dot dot-exp' }), el('span', { text: 'Spent' }), el('span', { class: 'amt', text: money(mExp) })),
        el('p', { class: 'hm-row' }, el('span', { class: 'dot dot-inc' }), el('span', { text: 'Earned' }), el('span', { class: 'amt', text: money(mInc) })))));
}

/** A cockpit-style arc: how much of this month's income has been spent. */
function gauge(ratio, over, noIncome) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'gauge');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', noIncome ? 'No income recorded this month' : `${Math.round(ratio * 100)}% of this month's income spent`);
  const r = 48, c = 2 * Math.PI * r, arc = 0.75; // 270° dial
  const mk = (tag, attrs) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.appendChild(n); return n; };
  for (let i = 0; i <= 10; i++) { // tick marks
    const a = (135 + i * 27) * Math.PI / 180;
    mk('line', { x1: 60 + Math.cos(a) * 57, y1: 60 + Math.sin(a) * 57, x2: 60 + Math.cos(a) * (i % 5 ? 54 : 52), y2: 60 + Math.sin(a) * (i % 5 ? 54 : 52), class: 'gauge-tick' });
  }
  mk('circle', { cx: 60, cy: 60, r, class: 'gauge-track', 'stroke-dasharray': `${c * arc} ${c}`, transform: 'rotate(135 60 60)' });
  mk('circle', { cx: 60, cy: 60, r, class: `gauge-fill ${over ? 'over' : ''}`, 'stroke-dasharray': `${c * arc * ratio} ${c}`, transform: 'rotate(135 60 60)' });
  const txt = mk('text', { x: 60, y: 62, class: 'gauge-num', 'text-anchor': 'middle' });
  txt.textContent = noIncome ? '—' : `${Math.round(ratio * 100)}%`;
  const sub = mk('text', { x: 60, y: 78, class: 'gauge-sub', 'text-anchor': 'middle' });
  sub.textContent = noIncome ? 'no income yet' : 'of income spent';
  return svg;
}

function statCard(label, value, kind, ic, note) {
  return el('div', { class: `stat stat-${kind}` },
    el('span', { class: 'stat-ic' }, icon(ic, 16)),
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value amt', text: value }),
    note ? el('span', { class: 'stat-note', text: note }) : null);
}

function chartCard(title, sub, draw, isEmpty, emptyText, height = null) {
  const card = el('article', { class: 'chart-card' },
    el('header', {}, el('h3', { text: title }), sub ? el('span', { class: 'chart-sub', text: sub }) : null));
  if (isEmpty) {
    card.append(el('div', { class: 'chart-empty' }, icon('trending-up', 22), el('span', { text: emptyText })));
  } else {
    const cv = el('canvas', { role: 'img', 'aria-label': title });
    const wrap = el('div', { class: 'chart-wrap', style: height ? { height: height + 'px' } : null }, cv);
    card.append(wrap);
    requestAnimationFrame(() => { if (cv.isConnected) draw(cv); });
  }
  return card;
}

/* ---------------- Aggregations ---------------- */

function byCategory(txs, type) {
  const m = new Map();
  for (const t of txs) {
    if (t.type !== type) continue;
    const c = store.categoryOf(t);
    const key = t.categoryId || 'none';
    const cur = m.get(key) || { label: store.categoryName(t), value: 0, color: c?.color || '#94A3B8' };
    cur.value += t.amount; m.set(key, cur);
  }
  const rows = [...m.values()].sort((a, b) => b.value - a.value);
  if (rows.length > 8) {
    const rest = rows.splice(7);
    rows.push({ label: 'Everything else', value: rest.reduce((s, r) => s + r.value, 0), color: '#94A3B8' });
  }
  return rows;
}

function series(txs, r) {
  const span = daysBetween(r.from, r.to) + 1;
  const unit = span <= 45 ? 'day' : 'month';
  const labels = [], keys = [];
  if (unit === 'day') {
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) { keys.push(d); labels.push(shortDay(d)); }
  } else {
    for (let m = monthStart(r.from); m <= r.to; m = addMonths(m, 1)) { keys.push(m.slice(0, 7)); labels.push(monthLabel(m)); }
  }
  const idx = new Map(keys.map((k, i) => [k, i]));
  const income = keys.map(() => 0), expense = keys.map(() => 0);
  for (const t of txs) {
    const i = idx.get(unit === 'day' ? t.date : t.date.slice(0, 7));
    if (i === undefined) continue;
    if (t.type === 'income') income[i] += t.amount; else if (t.type === 'expense') expense[i] += t.amount;
  }
  return { unit, labels, income, expense };
}

function daily(txs, r) {
  const MAX = 92;
  let from = r.from;
  let note = 'Per day';
  if (daysBetween(from, r.to) + 1 > MAX) { from = addDays(r.to, -(MAX - 1)); note = `Last ${MAX} days of the period`; }
  const labels = [], keys = [];
  for (let d = from; d <= r.to; d = addDays(d, 1)) { keys.push(d); labels.push(shortDay(d)); }
  const idx = new Map(keys.map((k, i) => [k, i]));
  const values = keys.map(() => 0);
  for (const t of txs) if (t.type === 'expense' && idx.has(t.date)) values[idx.get(t.date)] += t.amount;
  return { labels, values, note };
}

function monthly(r) {
  // Months covered by the period, but at least the 6 months ending with it (max 24) so a trend is visible.
  let start = monthStart(r.from);
  const end = monthStart(r.to);
  const minStart = addMonths(end, -5);
  if (start > minStart) start = minStart;
  const maxStart = addMonths(end, -23);
  if (start < maxStart) start = maxStart;
  const keys = [], labels = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) { keys.push(m.slice(0, 7)); labels.push(monthLabel(m)); }
  const idx = new Map(keys.map((k, i) => [k, i]));
  const values = keys.map(() => 0);
  for (const t of store.txList()) if (t.type === 'expense' && idx.has(t.date.slice(0, 7))) values[idx.get(t.date.slice(0, 7))] += t.amount;
  return { labels, values, note: `${labels[0]} to ${labels[labels.length - 1]}` };
}

function accountRows() {
  const b = store.balances();
  return store.activeAccounts().map((a) => ({ label: a.name, value: b.get(a.id) || 0, color: a.color || '#0EA5A0' }));
}
