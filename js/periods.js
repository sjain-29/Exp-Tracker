// Date-range presets used by the dashboard filter (all in Asia/Kolkata local dates).
import { todayISO, addDays, addMonths, monthStart, monthEnd, weekStart, formatDate, isISODate } from './utils.js';
import { txList } from './store.js';
import * as cycle from './cycle.js';

export const PERIODS = [
  ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['prev', 'Previous month'],
  ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom']
];
const CYCLE_PERIODS = [['cycle', 'This salary cycle'], ['prevcycle', 'Last salary cycle']];

/** The chips to show: salary-cycle presets appear first when a salary cycle is active. */
export function periodList() {
  if (!cycle.isActive()) return PERIODS;
  return [PERIODS[0], PERIODS[1], ...CYCLE_PERIODS, ...PERIODS.slice(2)];
}

export function rangeFor(key, custom = {}) {
  const t = todayISO();
  switch (key) {
    case 'today': return { from: t, to: t };
    case 'week': { const s = weekStart(t); return { from: s, to: addDays(s, 6) }; }
    case 'cycle': if (cycle.isActive()) { const c = cycle.cycleFor(t); return { from: c.from, to: c.to }; } break;
    case 'prevcycle': if (cycle.isActive()) { const c = cycle.prevCycle(cycle.cycleFor(t)); return { from: c.from, to: c.to }; } break;
    case 'prev': { const p = addMonths(t, -1); return { from: monthStart(p), to: monthEnd(p) }; }
    case 'year': return { from: t.slice(0, 4) + '-01-01', to: t.slice(0, 4) + '-12-31' };
    case 'all': {
      const list = txList();
      if (!list.length) return { from: monthStart(t), to: t };
      const min = list[list.length - 1].date; const max = list[0].date;
      return { from: min < t ? min : t, to: max > t ? max : t };
    }
    case 'custom': {
      let { from, to } = custom;
      if (!isISODate(from)) from = monthStart(t);
      if (!isISODate(to)) to = t;
      if (from > to) [from, to] = [to, from];
      return { from, to };
    }
    default: break;
  }
  return { from: monthStart(t), to: monthEnd(t) };
}

export function rangeLabel(r) {
  if (r.from === r.to) return formatDate(r.from);
  return `${formatDate(r.from)} to ${formatDate(r.to)}`;
}

export const inRange = (t, r) => t.date >= r.from && t.date <= r.to;
