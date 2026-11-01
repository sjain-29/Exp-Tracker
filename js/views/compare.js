// Dashboard section: compare two days, weeks, months, years or salary cycles in one chart.
// Read-only: it only reads the transactions already loaded; nothing is written anywhere.
import { el, icon, clear, money, todayISO, addDays, addMonths, monthStart, monthEnd, weekStart, daysBetween, shortDay, formatDate, isISODate } from '../utils.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import * as cycle from '../cycle.js';

const UNITS = [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months'], ['year', 'Years'], ['cycle', 'Salary cycles']];
const VIEWS = [['totals', 'Totals'], ['categories', 'By category'], ['time', 'Over time']];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Kept across re-renders so live data updates don't reset the user's choice.
const cmp = { unit: 'month', view: 'totals', a: null, b: null };

/* ---------------- Period keys per unit ---------------- */

function rangeOf(unit, key) {
  switch (unit) {
    case 'day': return { from: key, to: key };
    case 'week': return { from: key, to: addDays(key, 6) };
    case 'year': return { from: `${key}-01-01`, to: `${key}-12-31` };
    case 'cycle': { const c = cycle.cycleFor(key); return { from: c.from, to: c.to }; }
    default: return { from: key, to: monthEnd(key) };
  }
}
function labelOf(unit, key) {
  switch (unit) {
    case 'day': return formatDate(key);
    case 'week': return `${shortDay(key)} – ${shortDay(addDays(key, 6))} ’${addDays(key, 6).slice(2, 4)}`;
    case 'year': return key;
    case 'cycle': return cycle.cycleLabel(rangeOf('cycle', key));
    default: return `${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  }
}
function normalise(unit, iso) {
  switch (unit) {
    case 'day': return iso;
    case 'week': return weekStart(iso);
    case 'year': return iso.slice(0, 4);
    case 'cycle': return cycle.cycleFor(iso).from;
    default: return monthStart(iso);
  }
}
function defaults(unit) {
  const t = todayISO();
  const b = normalise(unit, t);
  let a;
  if (unit === 'day') a = addDays(t, -1);
  else if (unit === 'week') a = addDays(b, -7);
  else if (unit === 'year') a = String(Number(b) - 1);
  else if (unit === 'cycle') a = cycle.prevCycle(cycle.cycleFor(t)).from;
  else a = addMonths(b, -1);
  return { a, b };
}
function earliestDate() { const l = store.txList(); return l.length ? l[l.length - 1].date : todayISO(); }

/** Options for the select-based units (newest first). */
function optionsFor(unit) {
  const t = todayISO();
  const first = earliestDate();
  const out = [];
  if (unit === 'month') {
    let m = monthStart(t);
    const stop = addMonths(monthStart(first < addMonths(t, -24) ? first : addMonths(t, -24)), 0);
    for (let i = 0; m >= stop && i < 240; i++, m = addMonths(m, -1)) out.push(m);
  } else if (unit === 'year') {
    for (let y = Number(t.slice(0, 4)); y >= Math.min(Number(first.slice(0, 4)), Number(t.slice(0, 4)) - 2); y--) out.push(String(y));
  } else if (unit === 'cycle') {
    for (const c of cycle.recentCycles(48)) out.push(c.from);
  }
  return out;
}

/* ---------------- Aggregation ---------------- */

function summarise(r) {
  const s = { exp: 0, inc: 0, count: 0, byCat: new Map() };
  for (const t of store.txList()) {
    if (t.date < r.from || t.date > r.to || t.type === 'transfer') continue;
    s.count++;
    if (t.type === 'income') s.inc += t.amount;
    else if (t.type === 'expense') {
      s.exp += t.amount;
      const k = t.categoryId || 'none';
      const cur = s.byCat.get(k) || { label: store.categoryName(t), value: 0 };
      cur.value += t.amount; s.byCat.set(k, cur);
    }
  }
  const t = todayISO();
  const end = r.to > t && r.from <= t ? t : r.to; // in-progress periods: average over days so far
  s.days = Math.max(1, daysBetween(r.from, end) + 1);
  return s;
}

/** Cumulative spending per aligned step; steps after today are null so in-progress periods don't flatline. */
function cumulative(unit, r) {
  const t = todayISO();
  const steps = [];
  if (unit === 'year') for (let m = 0; m < 12; m++) { const ms = `${r.from.slice(0, 4)}-${String(m + 1).padStart(2, '0')}-01`; steps.push({ from: ms, to: monthEnd(ms) }); }
  else for (let d = r.from; d <= r.to; d = addDays(d, 1)) steps.push({ from: d, to: d });
  const idx = new Map();
  steps.forEach((s, i) => { for (let d = s.from; d <= s.to; d = addDays(d, 1)) idx.set(d, i); if (unit === 'year') idx.set(s.from.slice(0, 7), i); });
  const per = steps.map(() => 0);
  for (const x of store.txList()) {
    if (x.type !== 'expense' || x.date < r.from || x.date > r.to) continue;
    const i = unit === 'year' ? idx.get(x.date.slice(0, 7)) : idx.get(x.date);
    if (i !== undefined) per[i] += x.amount;
  }
  let run = 0;
  return per.map((v, i) => { if (steps[i].from > t) return null; run += v; return run; });
}

/* ---------------- Section ---------------- */

export function compareSection() {
  const node = el('section', { class: 'compare', 'aria-label': 'Compare two periods' });
  let chart = null;

  function ensureState() {
    if (cmp.unit === 'cycle' && !cycle.isActive()) cmp.unit = 'month';
    if (!cmp.a || !cmp.b) Object.assign(cmp, defaults(cmp.unit));
  }

  function setUnit(u) { cmp.unit = u; Object.assign(cmp, defaults(u)); if (u === 'day' && cmp.view === 'time') cmp.view = 'totals'; render(); }

  function picker(which) {
    const unit = cmp.unit;
    const onPick = (v) => { cmp[which] = v; render(); };
    const tag = el('span', { class: `cmp-tag cmp-tag-${which}`, text: which === 'a' ? 'A' : 'B' });
    let control, note = null;
    if (unit === 'day' || unit === 'week') {
      control = el('input', { type: 'date', class: 'input', value: cmp[which], max: '2100-12-31', 'aria-label': `Period ${which.toUpperCase()}` });
      control.addEventListener('change', () => { if (isISODate(control.value)) onPick(normalise(unit, control.value)); });
      if (unit === 'week') note = el('span', { class: 'hint', text: `Mon–Sun: ${labelOf('week', cmp[which])}` });
    } else {
      const opts = optionsFor(unit);
      if (!opts.includes(cmp[which])) opts.push(cmp[which]);
      control = el('select', { class: 'input', 'aria-label': `Period ${which.toUpperCase()}` },
        ...opts.map((k) => el('option', { value: k, text: labelOf(unit, k), selected: k === cmp[which] })));
      control.addEventListener('change', () => onPick(control.value));
    }
    return el('label', { class: 'field cmp-pick' }, el('span', { class: 'label' }, tag, el('span', { text: which === 'a' ? 'Compare' : 'With' })), control, note);
  }

  function render() {
    ensureState();
    charts.destroy(chart); chart = null;
    const units = UNITS.filter(([k]) => k !== 'cycle' || cycle.isActive());
    const unitSeg = el('div', { class: 'chips cmp-units', role: 'radiogroup', 'aria-label': 'Compare by' },
      ...units.map(([k, l]) => el('button', { type: 'button', role: 'radio', class: 'chip' + (k === cmp.unit ? ' on' : ''), 'aria-checked': String(k === cmp.unit), text: l, onclick: () => setUnit(k) })));
    const views = VIEWS.filter(([k]) => k !== 'time' || cmp.unit !== 'day');
    const viewSeg = el('div', { class: 'seg seg-sm', role: 'radiogroup', 'aria-label': 'Chart' },
      ...views.map(([k, l]) => el('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(k === cmp.view), text: l, onclick: () => { cmp.view = k; render(); } })));
    const swap = el('button', { type: 'button', class: 'icon-btn cmp-swap', 'aria-label': 'Swap A and B', title: 'Swap A and B', onclick: () => { [cmp.a, cmp.b] = [cmp.b, cmp.a]; render(); } }, icon('arrow-left-right', 18));

    const ra = rangeOf(cmp.unit, cmp.a), rb = rangeOf(cmp.unit, cmp.b);
    const la = labelOf(cmp.unit, cmp.a), lb = labelOf(cmp.unit, cmp.b);
    const A = summarise(ra), B = summarise(rb);

    const card = el('article', { class: 'chart-card cmp-card' });
    const head = el('header', {}, el('h3', { text: VIEWS.find(([k]) => k === cmp.view)[1] }),
      el('span', { class: 'chart-sub', text: cmp.view === 'time' ? (cmp.unit === 'year' ? 'Spending, cumulative by month' : 'Spending, cumulative by day') : cmp.view === 'categories' ? 'Spending per category' : 'Spent, earned and saved' }));
    card.append(head);
    let draw = null, height = null, empty = false;
    if (cmp.view === 'categories') {
      const keys = new Set([...A.byCat.keys(), ...B.byCat.keys()]);
      let rows = [...keys].map((k) => ({ label: (B.byCat.get(k) || A.byCat.get(k)).label, a: A.byCat.get(k)?.value || 0, b: B.byCat.get(k)?.value || 0 }))
        .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
      if (rows.length > 9) { const rest = rows.splice(8); rows.push({ label: 'Everything else', a: rest.reduce((s, r) => s + r.a, 0), b: rest.reduce((s, r) => s + r.b, 0) }); }
      empty = !rows.length;
      height = 70 + rows.length * 46;
      draw = (cv) => charts.compareBars(cv, rows.map((r) => r.label), rows.map((r) => r.a), rows.map((r) => r.b), la, lb, { horizontal: true });
    } else if (cmp.view === 'time') {
      const ca = cumulative(cmp.unit, ra), cb = cumulative(cmp.unit, rb);
      const n = Math.max(ca.length, cb.length);
      const pad = (arr) => [...arr, ...Array(n - arr.length).fill(null)];
      const labels = Array.from({ length: n }, (_, i) => cmp.unit === 'year' ? MON[i] : cmp.unit === 'week' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] : `Day ${i + 1}`);
      empty = !A.exp && !B.exp;
      draw = (cv) => charts.compareLines(cv, labels, pad(ca), pad(cb), la, lb);
    } else {
      empty = !A.count && !B.count;
      draw = (cv) => charts.compareBars(cv, ['Spent', 'Earned', 'Saved'], [A.exp, A.inc, A.inc - A.exp], [B.exp, B.inc, B.inc - B.exp], la, lb);
    }
    if (empty) {
      card.append(el('div', { class: 'chart-empty' }, icon('trending-up', 22), el('span', { text: 'Nothing recorded in either period' })));
    } else {
      const cv = el('canvas', { role: 'img', 'aria-label': `${la} compared with ${lb}` });
      card.append(el('div', { class: 'chart-wrap', style: height ? { height: height + 'px' } : null }, cv));
      requestAnimationFrame(() => { if (cv.isConnected) chart = draw(cv); });
    }

    clear(node).append(
      el('div', { class: 'section-head' }, el('h2', { text: 'Compare two periods' })),
      unitSeg,
      el('div', { class: 'cmp-pickers' }, picker('a'), swap, picker('b')),
      viewSeg,
      card,
      table(A, B, la, lb));
  }

  return { node, render, destroy: () => { charts.destroy(chart); chart = null; } };
}

/* ---------------- Summary table ---------------- */

function change(a, b, goodWhenUp) {
  if (a === b) return { text: 'Same', cls: 'flat' };
  const up = b > a;
  const cls = up === goodWhenUp ? 'good' : 'bad';
  if (!a) return { text: b > 0 ? 'New' : `▼ ${rupees(-b)}`, cls };
  // When one side is negative (e.g. savings turned into overspending) a % is misleading: show the difference.
  if (a < 0 || b < 0) return { text: `${up ? '▲' : '▼'} ${rupees(Math.abs(b - a))}`, cls };
  return { text: `${up ? '▲' : '▼'} ${fmtPct(Math.abs(((b - a) / a) * 100))}`, cls };
}
/** Whole rupees for the compact table, e.g. ₹66,872 */
const rupees = (p) => money(Math.round(p / 100) * 100).replace(/\.00$/, '');
function fmtPct(p) { return p >= 100 ? `${Math.round(p)}%` : p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1).replace(/\.0$/, '')}%`; }

function table(A, B, la, lb) {
  const pctOf = (s) => (s.inc ? (s.exp / s.inc) * 100 : null);
  const pa = pctOf(A), pb = pctOf(B);
  const pp = pa === null || pb === null ? { text: '—', cls: 'flat' }
    : Math.abs(pb - pa) < 0.05 ? { text: 'No change', cls: 'flat' }
      : { text: `${pb > pa ? '▲' : '▼'} ${Math.abs(pb - pa).toFixed(1).replace(/\.0$/, '')} pts`, cls: pb > pa ? 'bad' : 'good' };
  const rows = [
    ['Spent', rupees(A.exp), rupees(B.exp), change(A.exp, B.exp, false)],
    ['Earned', rupees(A.inc), rupees(B.inc), change(A.inc, B.inc, true)],
    ['Saved', rupees(A.inc - A.exp), rupees(B.inc - B.exp), change(A.inc - A.exp, B.inc - B.exp, true)],
    ['% of income spent', pa === null ? '—' : `${Math.round(pa)}%`, pb === null ? '—' : `${Math.round(pb)}%`, pp],
    ['Avg spend per day', rupees(A.exp / A.days), rupees(B.exp / B.days), change(Math.round(A.exp / A.days), Math.round(B.exp / B.days), false)],
    ['Transactions', String(A.count), String(B.count), { text: A.count === B.count ? 'Same' : `${B.count > A.count ? '+' : '−'}${Math.abs(B.count - A.count)}`, cls: 'flat' }]
  ];
  return el('div', { class: 'cmp-table-wrap' },
    el('table', { class: 'cmp-table' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: '' }),
        el('th', { scope: 'col' }, el('span', { class: 'cmp-tag cmp-tag-a', text: 'A' }), el('span', { class: 'cmp-th-label', text: la })),
        el('th', { scope: 'col' }, el('span', { class: 'cmp-tag cmp-tag-b', text: 'B' }), el('span', { class: 'cmp-th-label', text: lb })),
        el('th', { scope: 'col', text: 'B vs A' }))),
      el('tbody', {}, ...rows.map(([k, a, b, c]) => el('tr', {},
        el('th', { scope: 'row', text: k }),
        el('td', { class: 'amt', text: a }), el('td', { class: 'amt', text: b }),
        el('td', {}, el('span', { class: `delta delta-${c.cls}`, text: c.text })))))));
}
