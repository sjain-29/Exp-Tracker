// Chart.js wrappers. Chart.js is loaded locally from vendor/chart.umd.min.js (global `Chart`).
import { money } from './utils.js';

const live = new Set();

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function base() {
  const C = window.Chart;
  if (!C) return null;
  C.defaults.font.family = css('--font') || 'system-ui, sans-serif';
  C.defaults.font.size = 11;
  C.defaults.color = css('--text-2');
  C.defaults.borderColor = css('--line');
  return C;
}

const moneyTick = (v) => money(v * 100, { compact: true });
const tooltip = (labelFn) => ({
  backgroundColor: css('--tooltip-bg'), titleColor: '#fff', bodyColor: '#E6EEF5', padding: 10, cornerRadius: 10,
  displayColors: true, boxPadding: 4, callbacks: { label: labelFn }
});

function make(canvas, config) {
  const C = base();
  if (!C) return null;
  config.options = {
    responsive: true, maintainAspectRatio: false,
    animation: reducedMotion() ? false : { duration: 450 },
    ...config.options
  };
  const chart = new C(canvas, config);
  live.add(chart);
  return chart;
}

export function destroyAll() { live.forEach((c) => c.destroy()); live.clear(); }

/** rows: [{label, value(paise), color}] */
export function doughnut(canvas, rows) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return make(canvas, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.label),
      datasets: [{ data: rows.map((r) => r.value / 100), backgroundColor: rows.map((r) => r.color), borderColor: css('--chart-gap'), borderWidth: 2, hoverOffset: 6 }]
    },
    options: {
      cutout: '64%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', padding: 10 } },
        tooltip: tooltip((ctx) => ` ${ctx.label}: ${money(ctx.raw * 100)} (${total ? Math.round((ctx.raw * 100 / total) * 100) : 0}%)`)
      }
    }
  });
}

/** labels[], income[], expense[] (paise) */
export function incomeVsExpense(canvas, labels, income, expense) {
  return make(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: income.map((v) => v / 100), backgroundColor: css('--income'), borderRadius: 4, maxBarThickness: 18 },
        { label: 'Expenses', data: expense.map((v) => v / 100), backgroundColor: css('--expense'), borderRadius: 4, maxBarThickness: 18 }
      ]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } }, y: { beginAtZero: true, ticks: { callback: moneyTick, maxTicksLimit: 5 } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: tooltip((ctx) => ` ${ctx.dataset.label}: ${money(ctx.raw * 100)}`) }
    }
  });
}

export function dailyLine(canvas, labels, values) {
  const accent = css('--expense');
  return make(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Spent', data: values.map((v) => v / 100), borderColor: accent, backgroundColor: accent + '22', fill: true, tension: 0.3, pointRadius: values.length > 40 ? 0 : 2, pointHoverRadius: 4, borderWidth: 2 }] },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } }, y: { beginAtZero: true, ticks: { callback: moneyTick, maxTicksLimit: 5 } } },
      plugins: { legend: { display: false }, tooltip: tooltip((ctx) => ` Spent: ${money(ctx.raw * 100)}`) }
    }
  });
}

export function monthlyBars(canvas, labels, values) {
  return make(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Expenses', data: values.map((v) => v / 100), backgroundColor: css('--expense'), borderRadius: 6, maxBarThickness: 28 }] },
    options: {
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 6 } }, y: { beginAtZero: true, ticks: { callback: moneyTick, maxTicksLimit: 5 } } },
      plugins: { legend: { display: false }, tooltip: tooltip((ctx) => ` Expenses: ${money(ctx.raw * 100)}`) }
    }
  });
}

/** rows: [{label, value(paise, signed), color}] */
export function accountBars(canvas, rows) {
  return make(canvas, {
    type: 'bar',
    data: { labels: rows.map((r) => r.label), datasets: [{ label: 'Balance', data: rows.map((r) => r.value / 100), backgroundColor: rows.map((r) => r.color), borderRadius: 6, maxBarThickness: 22 }] },
    options: {
      indexAxis: 'y',
      scales: { x: { ticks: { callback: moneyTick, maxTicksLimit: 4 } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: tooltip((ctx) => ` ${ctx.raw < 0 ? 'Owed' : 'Balance'}: ${money(Math.abs(ctx.raw) * 100)}`) }
    }
  });
}
