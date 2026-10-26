// Transactions: search, filters (type, account, category, dates), grouped list, edit/delete.
import { el, icon, clear, money, friendlyDate, debounce } from '../utils.js';
import { emptyState } from '../ui.js';
import * as store from '../store.js';
import { txRow, viewHeader, iconButton, credit } from './common.js';
import { openEdit, openAdd } from '../modal.js';
import { exportTransactionsCSV } from './settings.js';

const PAGE = 120;
const f = { q: '', type: 'all', account: '', category: '', from: '', to: '' };

/** Called by the router when arriving from the dashboard's "See all". */
export function preset(range) {
  Object.assign(f, { q: '', type: 'all', account: '', category: '', from: range?.from || '', to: range?.to || '' });
}

export function render(root) {
  let limit = PAGE;
  const search = el('input', { type: 'search', class: 'input search-input', placeholder: 'Search description, category, account', 'aria-label': 'Search transactions', value: f.q, enterkeyhint: 'search' });
  search.addEventListener('input', debounce(() => { f.q = search.value; limit = PAGE; update(); }, 150));

  const typeChips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Type' });
  for (const [k, label] of [['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers']]) {
    typeChips.append(el('button', { type: 'button', role: 'radio', class: 'chip', dataset: { key: k }, text: label, onclick: () => { f.type = k; limit = PAGE; update(); } }));
  }
  const accSel = el('select', { class: 'input', 'aria-label': 'Account' });
  const catSel = el('select', { class: 'input', 'aria-label': 'Category' });
  const fromIn = el('input', { type: 'date', class: 'input', 'aria-label': 'From date', value: f.from });
  const toIn = el('input', { type: 'date', class: 'input', 'aria-label': 'To date', value: f.to });
  accSel.addEventListener('change', () => { f.account = accSel.value; limit = PAGE; update(); });
  catSel.addEventListener('change', () => { f.category = catSel.value; limit = PAGE; update(); });
  fromIn.addEventListener('change', () => { f.from = fromIn.value; limit = PAGE; update(); });
  toIn.addEventListener('change', () => { f.to = toIn.value; limit = PAGE; update(); });

  const filterCount = el('span', { class: 'count-badge', hidden: true });
  const filters = el('details', { class: 'filters' },
    el('summary', {}, icon('sliders-horizontal', 16), el('span', { text: 'Filters' }), filterCount, icon('chevron-down', 16, 'chev')),
    el('div', { class: 'filter-grid' },
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'Account' }), accSel),
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'Category' }), catSel),
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'From' }), fromIn),
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'To' }), toIn)),
    el('button', { type: 'button', class: 'link-btn', onclick: () => {
      Object.assign(f, { q: '', type: 'all', account: '', category: '', from: '', to: '' });
      search.value = ''; fromIn.value = ''; toIn.value = ''; limit = PAGE; update();
    } }, 'Clear all filters'));
  if (f.from || f.to) filters.open = true;

  const summary = el('p', { class: 'list-summary', 'aria-live': 'polite' });
  const list = el('div', { class: 'tx-groups' });
  const more = el('button', { type: 'button', class: 'btn btn-soft more-btn', hidden: true, onclick: () => { limit += PAGE; update(); } }, 'Show more');

  root.append(
    viewHeader('Transactions', null, iconButton('download', 'CSV', () => exportTransactionsCSV(filtered()), 'btn btn-soft')),
    el('div', { class: 'search-wrap' }, icon('search', 18, 'search-ic'), search),
    typeChips, filters, summary, list, more, credit());

  function fillSelects() {
    const keepA = f.account, keepC = f.category;
    clear(accSel).append(el('option', { value: '', text: 'All accounts' }));
    for (const a of store.accountsList()) accSel.append(el('option', { value: a.id, text: a.name + (a.active === false ? ' (inactive)' : '') }));
    accSel.value = store.state.accounts[keepA] ? keepA : '';
    clear(catSel).append(el('option', { value: '', text: 'All categories' }));
    for (const [type, label] of [['expense', 'Expense'], ['income', 'Income']]) {
      const g = el('optgroup', { label });
      for (const c of store.categoriesOf(type, { includeArchived: true })) g.append(el('option', { value: c.id, text: c.name + (c.archived ? ' (archived)' : '') }));
      catSel.append(g);
    }
    catSel.value = store.state.categories[keepC] ? keepC : '';
  }

  function filtered() {
    const q = f.q.trim().toLowerCase();
    return store.txList().filter((t) => {
      if (f.type !== 'all' && t.type !== f.type) return false;
      if (f.account && t.accountId !== f.account && t.toAccountId !== f.account) return false;
      if (f.category && t.categoryId !== f.category) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (q) {
        const hay = [t.description, t.reference, t.notes, t.type === 'transfer' ? 'transfer' : store.categoryName(t),
          store.accountName(t.accountId), t.toAccountId ? store.accountName(t.toAccountId) : ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function update() {
    fillSelects();
    for (const c of typeChips.children) { const on = c.dataset.key === f.type; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); }
    const n = [f.account, f.category, f.from, f.to].filter(Boolean).length;
    filterCount.hidden = !n; filterCount.textContent = String(n);
    const rows = filtered();
    let out = 0, inn = 0;
    for (const t of rows) { if (t.type === 'expense') out += t.amount; else if (t.type === 'income') inn += t.amount; }
    summary.textContent = rows.length
      ? `${rows.length} transaction${rows.length === 1 ? '' : 's'}. Spent ${money(out)}, received ${money(inn)}.`
      : '';
    clear(list);
    if (!rows.length) {
      const any = store.txList().length;
      list.append(emptyState(any ? 'search' : 'receipt', any ? 'No matches' : 'No transactions yet',
        any ? 'Try a different search or clear the filters.' : 'Your expenses, income and transfers will appear here.',
        any ? null : el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openAdd() }, icon('plus', 18), el('span', { text: 'Add Transaction' }))));
    }
    let curDate = null, ul = null, dayNet = 0, dayNode = null;
    const flush = () => { if (dayNode) dayNode.textContent = dayNet ? (dayNet > 0 ? '+' : '') + money(dayNet) : ''; };
    for (const t of rows.slice(0, limit)) {
      if (t.date !== curDate) {
        flush();
        curDate = t.date; dayNet = 0;
        dayNode = el('span', { class: 'day-net amt' });
        ul = el('ul', { class: 'tx-list' });
        list.append(el('section', { class: 'day-group' }, el('h3', { class: 'day-head' }, el('span', { text: friendlyDate(t.date) }), dayNode), ul));
      }
      if (t.type === 'income') dayNet += t.amount; else if (t.type === 'expense') dayNet -= t.amount;
      ul.append(txRow(t, { onOpen: openEdit, showDate: false }));
    }
    flush();
    more.hidden = rows.length <= limit;
  }
  return { update };
}
