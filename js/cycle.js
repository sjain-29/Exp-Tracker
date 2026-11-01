// Salary cycle: lets a "month" run from pay day to the day before the next pay day,
// so expenses paid before the salary arrives are counted against the previous salary.
//
// The preference is stored ONLY on this device (localStorage key "pp-cycle"), exactly like
// the theme preference. It is not financial data and nothing is ever written to Firebase.
import { addDays, addMonths, monthStart, monthEnd, todayISO, daysBetween, shortDay } from './utils.js';
import * as store from './store.js';

const KEY = 'pp-cycle';
export const MODES = ['auto', 'day', 'calendar'];
const DEFAULT = { mode: 'auto', day: 1, categoryId: '' };
const SALARY_RE = /salary|salaries|stipend|pay ?check|payroll/i;
const MERGE_DAYS = 15; // salary credits closer than this (e.g. salary + bonus) belong to one cycle

/* ---------------- Preference (device only) ---------------- */

let prefCache = null;
export function getPref() {
  if (prefCache) return prefCache;
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { p = {}; }
  prefCache = {
    mode: MODES.includes(p.mode) ? p.mode : DEFAULT.mode,
    day: Number.isInteger(p.day) && p.day >= 1 && p.day <= 28 ? p.day : DEFAULT.day,
    categoryId: typeof p.categoryId === 'string' ? p.categoryId.slice(0, 64) : ''
  };
  return prefCache;
}

export function setPref(patch) {
  prefCache = { ...getPref(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefCache)); } catch { /* storage unavailable: keep for this session */ }
  memo.key = null;
  store.touch(); // re-render views; this does not write anything to the database
}

/* ---------------- Salary credits ---------------- */

/** Income categories treated as salary: the chosen one, else any income category named like "Salary". */
export function salaryCategoryIds() {
  const p = getPref();
  if (p.categoryId && store.state.categories[p.categoryId]?.type === 'income') return [p.categoryId];
  return store.categoriesOf('income', { includeArchived: true }).filter((c) => SALARY_RE.test(c.name)).map((c) => c.id);
}

const memo = { list: null, key: null, anchors: [] };

/** Sorted start dates of salary cycles (one per salary credit, nearby credits merged). */
export function anchors() {
  const list = store.txList();
  const ids = salaryCategoryIds();
  const key = ids.join(',');
  if (memo.list === list && memo.key === key) return memo.anchors;
  const set = new Set(ids);
  const dates = [...new Set(list.filter((t) => t.type === 'income' &&
    (set.has(t.categoryId) || (!store.state.categories[t.categoryId] && SALARY_RE.test(t.categoryName || '')))).map((t) => t.date))].sort();
  const out = [];
  for (const d of dates) if (!out.length || daysBetween(out[out.length - 1], d) >= MERGE_DAYS) out.push(d);
  Object.assign(memo, { list, key, anchors: out });
  return out;
}

/* ---------------- Cycles ---------------- */

/** Is a salary cycle (rather than the calendar month) in use right now? */
export function isActive() {
  const p = getPref();
  if (p.mode === 'day') return p.day !== 1;
  if (p.mode === 'auto') return anchors().length > 0;
  return false;
}

/** Day `day` of the month containing `iso`, clamped to the month's length. */
function dayIn(iso, day) {
  const last = Number(monthEnd(iso).slice(8));
  return iso.slice(0, 8) + String(Math.min(day, last)).padStart(2, '0');
}

function fixedCycle(date, day) {
  let from = dayIn(monthStart(date), day);
  if (date < from) from = dayIn(addMonths(date, -1), day);
  return { from, to: addDays(dayIn(addMonths(from, 1), day), -1) };
}

/** The cycle that contains `date`: { from, to, estimated? } */
export function cycleFor(date) {
  const p = getPref();
  if (p.mode === 'day') return fixedCycle(date, p.day);
  if (p.mode === 'auto') {
    const a = anchors();
    if (a.length) {
      let i = -1;
      for (let k = a.length - 1; k >= 0; k--) if (a[k] <= date) { i = k; break; }
      if (i === -1) {
        // Before the first recorded salary: assume the same pay day in earlier months.
        const c = fixedCycle(date, Number(a[0].slice(8)));
        if (c.to >= a[0]) c.to = addDays(a[0], -1);
        return { ...c, estimated: true };
      }
      const from = a[i];
      if (i + 1 < a.length) return { from, to: addDays(a[i + 1], -1) };
      // Latest salary: the cycle runs until the day before the same date next month.
      const payDay = Number(from.slice(8));
      const expectedTo = addDays(dayIn(addMonths(from, 1), payDay), -1);
      if (date <= expectedTo) return { from, to: expectedTo, estimated: true };
      // Salary is late: keep the current cycle open (up to 12 days) instead of starting one with no salary.
      const t = todayISO();
      if (date <= t && daysBetween(expectedTo, t) <= 12) return { from, to: t, estimated: true, late: true };
      return { ...fixedCycle(date, payDay), estimated: true };
    }
  }
  return { from: monthStart(date), to: monthEnd(date) };
}

export const prevCycle = (c) => cycleFor(addDays(c.from, -1));

/** "This month" for the dashboard: the current salary cycle when one is active, else the calendar month. */
export function currentSpan() {
  const t = todayISO();
  if (isActive()) return { ...cycleFor(t), kind: 'cycle' };
  return { from: monthStart(t), to: monthEnd(t), kind: 'month' };
}
export function previousSpan(span = currentSpan()) {
  if (span.kind === 'cycle') return { ...prevCycle(span), kind: 'cycle' };
  const p = addMonths(span.from, -1);
  return { from: monthStart(p), to: monthEnd(p), kind: 'month' };
}

export function cycleLabel(c) {
  const y = c.to.slice(2, 4);
  return `${shortDay(c.from)} – ${shortDay(c.to)} ’${y}`;
}

/** Most recent cycles first (current one included), going back to the first transaction. */
export function recentCycles(max = 36) {
  const list = store.txList();
  const earliest = list.length ? list[list.length - 1].date : todayISO();
  const out = [];
  let c = cycleFor(todayISO());
  while (out.length < max) {
    out.push(c);
    if (c.from <= earliest) break;
    c = prevCycle(c);
  }
  return out;
}
