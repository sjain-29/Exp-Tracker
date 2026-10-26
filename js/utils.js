// Shared helpers: safe DOM building, icons, money and date handling (Asia/Kolkata).
import { ICONS } from './icon-data.js';

export const TZ = 'Asia/Kolkata';
export const LOCALE = 'en-IN';
export const MAX_PAISE = 100_000_000_000; // ₹1,00,00,00,000.00 per transaction / balance
export const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------------- DOM ---------------- */

/** Build an element. Strings/numbers become text nodes — never parsed as HTML. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) node.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), sv);
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function icon(name, size = 20, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', ('icon ' + cls).trim());
  for (const [tag, attrs] of ICONS[name] || ICONS['circle-help']) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v);
    svg.appendChild(child);
  }
  return svg;
}

/** Replace <i data-icon="name"> placeholders in static markup with SVG icons. */
export function hydrateIcons(root = document) {
  for (const i of $$('i[data-icon]', root)) {
    const svg = icon(i.dataset.icon, Number(i.dataset.size) || 20, i.className);
    i.replaceWith(svg);
  }
}

export function hasIcon(name) { return Object.prototype.hasOwnProperty.call(ICONS, name); }

/* ---------------- Money (stored as integer paise) ---------------- */

const fmtCache = new Map();
let currency = 'INR';
export function setCurrency(c) { currency = /^[A-Z]{3}$/.test(c || '') ? c : 'INR'; }
export function getCurrency() { return currency; }

function nf(cur, compact) {
  const key = cur + (compact ? 'c' : '');
  if (!fmtCache.has(key)) {
    fmtCache.set(key, new Intl.NumberFormat(LOCALE, compact
      ? { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }
      : { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  return fmtCache.get(key);
}

/** 12500000 paise → "₹1,25,000.00" */
export function money(paise, opts = {}) {
  const v = (Number(paise) || 0) / 100;
  const s = nf(currency, opts.compact).format(Math.abs(v));
  if (opts.sign && v > 0) return '+' + s;
  if (v < 0) return '−' + s;
  return s;
}

export function currencySymbol() {
  const part = nf(currency).formatToParts(0).find((p) => p.type === 'currency');
  return part ? part.value : '₹';
}

/** Parse user input like "1,250.5" into integer paise without float rounding errors. */
export function parseAmount(raw) {
  const s = String(raw ?? '').replace(/[,\s₹]/g, '').trim();
  if (!s) return { ok: false, error: 'Enter an amount.' };
  if (!/^\d+(\.\d{0,2})?$/.test(s)) {
    return { ok: false, error: /^\d*\.\d{3,}$/.test(s) ? 'Use at most 2 decimal places.' : 'Enter a valid amount, like 250 or 99.50.' };
  }
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise <= 0) return { ok: false, error: 'Amount must be more than zero.' };
  if (paise > MAX_PAISE) return { ok: false, error: 'Amount is too large.' };
  return { ok: true, paise };
}

/** Signed variant for opening balances (may be negative or zero). */
export function parseSignedAmount(raw) {
  const s = String(raw ?? '').replace(/[,\s₹]/g, '').replace('−', '-').trim();
  if (!s || s === '-' ) return { ok: true, paise: 0 };
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  if (/^0*(\.0*)?$/.test(body)) return { ok: true, paise: 0 };
  const r = parseAmount(body);
  return r.ok ? { ok: true, paise: neg ? -r.paise : r.paise } : r;
}

/** Integer paise → plain editable string, e.g. 12550 → "125.50" */
export function paiseToInput(paise) {
  const n = Math.abs(Number(paise) || 0);
  const s = `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`.replace(/\.00$/, '');
  return (paise < 0 ? '-' : '') + s;
}

/* ---------------- Dates (ISO "YYYY-MM-DD", Indian local time) ---------------- */

const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export function todayISO(d = new Date()) { return isoFmt.format(d); }
export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const toUTC = (iso) => new Date(iso + 'T00:00:00Z');
const fromUTC = (d) => d.toISOString().slice(0, 10);
export function addDays(iso, n) { const d = toUTC(iso); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); }
export function addMonths(iso, n) { const d = toUTC(iso.slice(0, 7) + '-01'); d.setUTCMonth(d.getUTCMonth() + n); return fromUTC(d); }
export function monthStart(iso) { return iso.slice(0, 7) + '-01'; }
export function monthEnd(iso) { return addDays(addMonths(monthStart(iso), 1), -1); }
export function weekStart(iso) { const dow = (toUTC(iso).getUTCDay() + 6) % 7; return addDays(iso, -dow); } // Monday
export function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let dateFormat = 'DD MMM YYYY';
export const DATE_FORMATS = ['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
export function setDateFormat(f) { dateFormat = DATE_FORMATS.includes(f) ? f : 'DD MMM YYYY'; }

export function formatDate(iso, fmt = dateFormat) {
  if (!isISODate(iso)) return '';
  const [y, m, d] = iso.split('-');
  if (fmt === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  if (fmt === 'YYYY-MM-DD') return iso;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
export function friendlyDate(iso) {
  const t = todayISO();
  if (iso === t) return 'Today';
  if (iso === addDays(t, -1)) return 'Yesterday';
  return formatDate(iso);
}
export function monthLabel(iso, withYear = true) {
  const [y, m] = iso.split('-');
  return MONTHS[Number(m) - 1] + (withYear ? ` ${y.slice(2)}` : '');
}
export function shortDay(iso) { const [, m, d] = iso.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1]}`; }
export function formatTimestamp(ms) {
  if (typeof ms !== 'number') return '';
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

/* ---------------- Misc ---------------- */

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export function cleanText(s, max) { return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
