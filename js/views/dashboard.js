// Dashboard: live balances (not filtered), this-month / salary-cycle figures (fixed), category trends,
// period-filtered stats + charts, and a two-period comparison. Everything here only READS data.
import { el, icon, clear, money, todayISO, monthStart, monthEnd, addDays, addMonths, daysBetween, shortDay, monthLabel, SVG_NS } from '../utils.js';
import { emptyState } from '../ui.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import { periodList, rangeFor, rangeLabel, inRange } from '../periods.js';
import * as cycle from '../cycle.js';
import { compareSection } from './compare.js';
import { txRow, viewHeader, credit } from './common.js';
import { isLiability } from '../defaults.js';
import { openAdd, openTransfer, openEdit } from '../modal.js';

// period starts unset so it can default to the salary cycle when one is active.
const ui = { period: null, custom: { from: '', to: '' }, trendBasis: 'same', trendAll: false };

export function render(root, { navigate }) {
  const hero = el('section', { class: 'hero', 'aria-label': 'Current balances' });
  const quick = el('div', { class: 'quick' },
    el('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => openAdd() }, icon('plus', 20), el('span', { text: 'Add Transaction' })),
    el('button', { type: 'button', class: 'btn btn-soft btn-lg', onclick: () => openTransfer() }, icon('arrow-left-right', 18), el('span', { text: 'Transfer' })));

  const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Period' });
  let chipKeys = '';
  function buildChips() {
    const list = periodList();
    const keys = list.map(([k]) => k).join();
    if (keys === chipKeys) return;
    chipKeys = keys;
    clear(chips);
    for (const [key, label] of list) {
      chips.append(el('button', { type: 'button', role: 'radio', class: 'chip', dataset: { key }, text: label, onclick: () => { ui.period = key; update(); } }));
    }
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
  const ratio = el('div', { class: 'ratio-card' });
  const grid = el('div', { class: 'chart-grid' });
  const recent = el('ul', { class: 'tx-list' });
  const trends = el('section', { class: 'trends', 'aria-label': 'Category spending compared with last month' });
  const compare = compareSection();

  root.append(
    viewHeader('Dashboard', null),
    hero, quick, trends,
    el('section', { class: 'period', 'aria-label': 'Selected period' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Period overview' })),
      chips, customBox, caption, stats, ratio, grid,
      el('div', { class: 'section-head' }, el('h2', { text: 'Recent in this period' }),
        el('button', { type: 'button', class: 'link-btn', onclick: () => navigate('transactions', rangeFor(ui.period, ui.custom)) }, 'See all'))),
    recent,
    compare.node,
    credit());

  function update() {
    if (!store.isLoaded()) return;
    renderHero(hero);
    renderTrends(trends);
    buildChips();
    const valid = periodList().some(([k]) => k === ui.period);
    if (!valid) ui.period = cycle.isActive() ? 'cycle' : 'month';
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
      statCard('Total expenses', money(exp), 'expense', 'arrow-up-right', inc ? `${pctText(exp, inc)} of income` : null),
      statCard('Total income', money(inc), 'income', 'arrow-down-left'),
      statCard('Net cash flow', (net > 0 ? '+' : '') + money(net), net < 0 ? 'expense' : 'saving', net < 0 ? 'trending-down' : 'trending-up',
        inc ? `${Math.round((Math.abs(net) / inc) * 100)}% of income ${net < 0 ? 'overspent' : 'saved'}` : null));
    renderRatio(ratio, inc, exp, r);

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
    compare.render();
  }

  /* ---------------- Category trends: this month (or cycle) so far vs last ---------------- */

  function renderTrends(box) {
    const cur = cycle.currentSpan();
    const prev = cycle.previousSpan(cur);
    const t = todayISO();
    const curTo = t < cur.to ? t : cur.to;
    const elapsed = daysBetween(cur.from, curTo);
    let prevTo = prev.to;
    if (ui.trendBasis === 'same') { const p = addDays(prev.from, elapsed); prevTo = p < prev.to ? p : prev.to; }
    const a = sumByCat(prev.from, prevTo), b = sumByCat(cur.from, curTo);
    const keys = new Set([...a.keys(), ...b.keys()]);
    keys.delete('__total');
    const rows = [...keys].map((k) => ({ k, ...(b.get(k) || a.get(k)), now: b.get(k)?.value || 0, then: a.get(k)?.value || 0 }))
      .sort((x, y) => y.now - x.now || y.then - x.then);
    const max = Math.max(1, ...rows.map((r) => Math.max(r.now, r.then)));
    const word = cur.kind === 'cycle' ? 'cycle' : 'month';
    const totNow = b.get('__total')?.value || 0, totThen = a.get('__total')?.value || 0;

    const basisSeg = el('div', { class: 'seg seg-sm', role: 'radiogroup', 'aria-label': 'Compare against' },
      ...[['same', `Same days last ${word}`], ['full', `All of last ${word}`]].map(([k, l]) =>
        el('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(ui.trendBasis === k), text: l, onclick: () => { ui.trendBasis = k; renderTrends(box); } })));
    const list = el('ul', { class: 'trend-list' });
    const shown = ui.trendAll ? rows : rows.slice(0, 5);
    for (const r of shown) list.append(trendRow(r, max));
    const more = rows.length > 5 ? el('button', { type: 'button', class: 'link-btn trend-more', onclick: () => { ui.trendAll = !ui.trendAll; renderTrends(box); } },
      ui.trendAll ? 'Show fewer' : `Show all ${rows.length} categories`) : null;
    const d = delta(totThen, totNow);
    clear(box).append(
      el('div', { class: 'section-head' }, el('h2', { text: `This ${word} vs last ${word}` })),
      el('p', { class: 'period-caption' }, icon('calendar', 14),
        el('span', { text: `${shortDay(cur.from)} – ${shortDay(curTo)} compared with ${shortDay(prev.from)} – ${shortDay(prevTo)}` })),
      basisSeg,
      el('div', { class: 'trend-card' },
        el('div', { class: 'trend-total' },
          el('div', {}, el('span', { class: 'stat-label', text: `Spent this ${word} so far` }),
            el('span', { class: 'trend-total-val amt', text: money(totNow) }),
            el('span', { class: 'stat-note', text: `vs ${money(totThen)} ${ui.trendBasis === 'same' ? `by this point last ${word}` : `in all of last ${word}`}` })),
          el('span', { class: `delta delta-lg delta-${d.cls}`, text: d.text })),
        rows.length ? list : el('div', { class: 'chart-empty' }, icon('trending-up', 22), el('span', { text: `No spending this ${word} or last ${word} yet` })),
        more));
  }

  return { update, destroy: () => { compare.destroy(); charts.destroyAll(); } };
}

/* ---------------- Hero (live balances + this month) ---------------- */

function renderHero(hero) {
  const tot = store.totals();
  const t = todayISO();
  const span = cycle.currentSpan();
  const ms = span.from, me = span.to;
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
        el('p', { class: 'hm-title', text: span.kind === 'cycle' ? `Salary cycle (${shortDay(ms)} – ${shortDay(me)})` : `This month (${monthLabel(t, false)})` }),
        span.kind === 'cycle' ? el('p', { class: 'hm-day', text: `Day ${daysBetween(ms, t) + 1} of ${daysBetween(ms, me) + 1}` }) : null,
        el('p', { class: 'hm-row' }, el('span', { class: 'dot dot-exp' }), el('span', { text: 'Spent' }), el('span', { class: 'amt', text: money(mExp) })),
        el('p', { class: 'hm-row' }, el('span', { class: 'dot dot-inc' }), el('span', { text: 'Earned' }), el('span', { class: 'amt', text: money(mInc) })))));
}

/** A cockpit-style arc: how much of this month's income has been spent. */
function gauge(ratio, over, noIncome, opts = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'gauge');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label || (noIncome ? 'No income recorded this month' : `${Math.round(ratio * 100)}% of this month's income spent`));
  const r = 48, c = 2 * Math.PI * r, arc = 0.75; // 270° dial
  const mk = (tag, attrs) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.appendChild(n); return n; };
  for (let i = 0; i <= 10; i++) { // tick marks
    const a = (135 + i * 27) * Math.PI / 180;
    mk('line', { x1: 60 + Math.cos(a) * 57, y1: 60 + Math.sin(a) * 57, x2: 60 + Math.cos(a) * (i % 5 ? 54 : 52), y2: 60 + Math.sin(a) * (i % 5 ? 54 : 52), class: 'gauge-tick' });
  }
  mk('circle', { cx: 60, cy: 60, r, class: 'gauge-track', 'stroke-dasharray': `${c * arc} ${c}`, transform: 'rotate(135 60 60)' });
  mk('circle', { cx: 60, cy: 60, r, class: `gauge-fill ${over ? 'over' : ''}`, 'stroke-dasharray': `${c * arc * ratio} ${c}`, transform: 'rotate(135 60 60)' });
  const txt = mk('text', { x: 60, y: 62, class: 'gauge-num', 'text-anchor': 'middle' });
  txt.textContent = opts.num || (noIncome ? '—' : `${Math.round(ratio * 100)}%`);
  const sub = mk('text', { x: 60, y: 78, class: 'gauge-sub', 'text-anchor': 'middle' });
  sub.textContent = opts.sub || (noIncome ? 'no income yet' : 'of income spent');
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

function pctText(part, whole) {
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/** Spent vs earned for the selected period (follows the period filter). */
function renderRatio(box, inc, exp, r) {
  const over = exp > inc;
  const left = inc - exp;
  const pct = inc ? (exp / inc) * 100 : 0;
  const g = gauge(inc ? Math.min(exp / inc, 1) : (exp ? 1 : 0), over, !inc, {
    num: inc ? pctText(exp, inc) : '—', sub: inc ? 'of income spent' : 'no income', label: inc ? `${Math.round(pct)}% of income spent in this period` : 'No income in this period' });
  g.classList.add('gauge-period');
  let headline, detail;
  if (!inc && !exp) { headline = 'Nothing recorded in this period'; detail = 'Pick another period or add a transaction.'; }
  else if (!inc) { headline = `${money(exp)} spent, no income recorded`; detail = cycle.isActive() ? 'No income falls in these dates. The salary-cycle periods line spending up with your pay day.' : 'Tip: turn on a salary cycle in Settings so spending before pay day counts against the previous salary.'; }
  else if (over) { headline = `Spent ${pctText(exp, inc)} of what you earned`; detail = `Overspent by ${money(-left)}`; }
  else { headline = `Spent ${pctText(exp, inc)} of what you earned`; detail = `${money(left)} left (${pctText(left, inc)} saved)`; }
  clear(box).append(g,
    el('div', { class: 'ratio-text' },
      el('p', { class: 'ratio-head', text: headline }),
      el('p', { class: `ratio-detail ${over && inc ? 'is-over' : ''}`, text: detail }),
      el('div', { class: 'ratio-bar', role: 'presentation' }, el('span', { style: { width: `${inc ? Math.min(pct, 100) : (exp ? 100 : 0)}%` }, class: over ? 'over' : '' })),
      el('p', { class: 'ratio-legend' },
        el('span', {}, el('span', { class: 'dot dot-exp' }), el('span', { text: `Spent ${money(exp)}` })),
        el('span', {}, el('span', { class: 'dot dot-inc' }), el('span', { text: `Earned ${money(inc)}` })))));
}

function sumByCat(from, to) {
  const m = new Map();
  let total = 0;
  for (const t of store.txList()) {
    if (t.type !== 'expense' || t.date < from || t.date > to) continue;
    total += t.amount;
    const k = t.categoryId || 'none';
    const c = store.categoryOf(t);
    const cur = m.get(k) || { label: store.categoryName(t), color: c?.color || '#94A3B8', icon: c?.icon || 'tag', value: 0 };
    cur.value += t.amount; m.set(k, cur);
  }
  m.set('__total', { value: total });
  return m;
}

/** "▲ 23% above" / "▼ 12% below" — spending up is shown as bad, down as good. */
function delta(then, now) {
  if (then === now) return { text: now ? 'Same as before' : 'No spending', cls: 'flat' };
  if (!then) return { text: 'New this period', cls: 'bad' };
  const p = ((now - then) / then) * 100;
  const n = Math.abs(p);
  const s = n >= 10 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '');
  return now > then ? { text: `▲ ${s}% above`, cls: 'bad' } : { text: `▼ ${s}% below`, cls: 'good' };
}

function trendRow(r, max) {
  const d = delta(r.then, r.now);
  return el('li', { class: 'trend-row' },
    el('span', { class: 'tx-ic', style: { '--c': r.color } }, icon(r.icon, 18)),
    el('div', { class: 'trend-main' },
      el('div', { class: 'trend-top' },
        el('span', { class: 'trend-name', text: r.label }),
        el('span', { class: `delta delta-${d.cls}`, text: d.text })),
      el('div', { class: 'trend-bars', 'aria-hidden': 'true' },
        el('span', { class: 'tb tb-now', style: { width: `${(r.now / max) * 100}%` } }),
        el('span', { class: 'tb tb-then', style: { width: `${(r.then / max) * 100}%` } })),
      el('div', { class: 'trend-amts' },
        el('span', { class: 'amt', text: `Now ${money(r.now)}` }),
        el('span', { class: 'amt muted', text: `Last ${money(r.then)}` }))));
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
