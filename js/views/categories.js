// Categories: built-in + custom, rename, icon/colour, archive, safe delete with reassignment.
import { el, icon, clear } from '../utils.js';
import { toast, formDialog, openSheet, confirmDialog, field, selectEl, swatchPicker, iconPicker, radioValue, emptyState, UserError } from '../ui.js';
import * as store from '../store.js';
import { CATEGORY_ICONS, COLORS } from '../defaults.js';
import { viewHeader, iconButton, credit } from './common.js';

let currentType = 'expense';

export function render(root) {
  const segBtns = {};
  const seg = el('div', { class: 'seg seg-sm', role: 'tablist', 'aria-label': 'Category type' });
  for (const [t, label] of [['expense', 'Expense'], ['income', 'Income']]) {
    segBtns[t] = el('button', { type: 'button', role: 'tab', class: `seg-btn seg-${t}`, onclick: () => { currentType = t; update(); } }, el('span', { text: label }));
    seg.append(segBtns[t]);
  }
  const list = el('ul', { class: 'cat-list' });
  const archived = el('details', { class: 'inactive-box' });
  root.append(
    viewHeader('Categories', 'Rename, recolour or add your own. Categories in use can be archived or merged, never silently lost.',
      iconButton('plus', 'Add category', async () => { await editCategoryDialog(null, currentType); }, 'btn btn-primary')),
    seg, list, archived, credit());

  function update() {
    for (const t of ['expense', 'income']) segBtns[t].setAttribute('aria-selected', String(t === currentType));
    const counts = new Map();
    for (const t of store.txList()) if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
    clear(list);
    const active = store.categoriesOf(currentType);
    if (!active.length) list.append(el('li', {}, emptyState('tags', 'No categories', 'Add one to start recording.')));
    for (const c of active) list.append(catRow(c, counts.get(c.id) || 0));
    const arch = store.categoriesOf(currentType, { includeArchived: true }).filter((c) => c.archived);
    clear(archived);
    archived.hidden = !arch.length;
    if (arch.length) {
      archived.append(el('summary', {}, el('span', { text: `Archived (${arch.length})` }), icon('chevron-down', 16, 'chev')));
      const ul = el('ul', { class: 'cat-list' });
      for (const c of arch) ul.append(catRow(c, counts.get(c.id) || 0));
      archived.append(ul);
    }
  }
  return { update };
}

function catRow(c, count) {
  return el('li', { class: `cat-row ${c.archived ? 'is-inactive' : ''}` },
    el('button', { type: 'button', class: 'cat-row-btn', onclick: () => catDetail(c.id), 'aria-label': `${c.name}, used ${count} times. Options` },
      el('span', { class: 'cat-dot cat-dot-lg', style: { '--c': c.color || '#94A3B8' } }, icon(c.icon || 'tag', 18)),
      el('span', { class: 'cat-row-main' },
        el('span', { class: 'cat-row-name', text: c.name }),
        el('span', { class: 'cat-row-sub', text: `${count ? `${count} transaction${count === 1 ? '' : 's'}` : 'Not used yet'}${c.builtIn ? '' : ', custom'}` })),
      icon('chevron-right', 18, 'muted')));
}

function catDetail(id) {
  const c = store.state.categories[id];
  if (!c) return;
  openSheet({
    title: c.name,
    build(body, close) {
      body.append(el('div', { class: 'detail-actions' },
        btn('pencil', 'Rename or restyle', () => { close(); editCategoryDialog(id, c.type); }),
        btn(c.archived ? 'archive-restore' : 'archive', c.archived ? 'Unarchive' : 'Archive', async () => {
          close();
          if (!c.archived && store.categoriesOf(c.type).length <= 1) { toast('Keep at least one active category of each type.', 'error'); return; }
          try { await store.setCategoryArchived(id, !c.archived); toast(c.archived ? 'Category restored' : 'Category archived. Its history is kept.', 'success'); }
          catch (e) { toast(store.friendlyError(e), 'error'); }
        }),
        btn('trash-2', 'Delete', () => { close(); deleteFlow(id); }, 'danger')),
      el('p', { class: 'hint-box' }, icon('info', 16), el('span', { text: 'Archived categories disappear from the Add Transaction form but stay on past transactions and in charts.' })));
    }
  });
}
const btn = (ic, label, onclick, cls = '') => el('button', { type: 'button', class: `detail-act ${cls}`, onclick }, icon(ic, 18), el('span', { text: label }));

export function editCategoryDialog(id, type = 'expense') {
  const c = id ? store.state.categories[id] : null;
  return formDialog({
    title: c ? 'Edit category' : 'New category',
    submitText: c ? 'Save changes' : 'Add category',
    build(form) {
      const name = el('input', { class: 'input', maxlength: '40', value: c?.name || '', placeholder: 'e.g. Fuel', autocomplete: 'off', required: true });
      const t = selectEl([{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }], c?.type || type);
      form.append(
        field('Name', name),
        field('Type', t),
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Icon' }), iconPicker(CATEGORY_ICONS, c?.icon || 'tag', 'cat-icon')),
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'Colour' }), swatchPicker(COLORS, c?.color || COLORS[0], 'cat-color')));
      return () => ({ name: name.value, type: t.value, icon: radioValue(form, 'cat-icon'), color: radioValue(form, 'cat-color') });
    },
    async onSubmit(v) {
      const newId = await store.saveCategory(id, v);
      toast(c ? 'Category updated' : `${v.name.trim()} added`, 'success');
      return newId;
    }
  });
}

async function deleteFlow(id) {
  const c = store.state.categories[id];
  if (!c) return;
  const count = store.txCountFor({ categoryId: id });
  const others = store.categoriesOf(c.type, { includeArchived: true }).filter((x) => x.id !== id);
  try {
    if (!count) {
      if (!others.filter((x) => !x.archived).length && !c.archived) { toast('Keep at least one active category of each type.', 'error'); return; }
      const ok = await confirmDialog({ title: `Delete ${c.name}?`, message: 'No transactions use this category. It will be permanently removed.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      await store.deleteCategory(id);
      toast('Category deleted', 'success');
      return;
    }
    const res = await formDialog({
      title: `${c.name} is used ${count} time${count === 1 ? '' : 's'}`,
      submitText: 'Continue',
      build(form) {
        const o1 = el('input', { type: 'radio', name: 'cdel', value: 'archive', checked: true });
        const o2 = el('input', { type: 'radio', name: 'cdel', value: 'move', disabled: !others.length });
        const sel = selectEl(others.map((o) => ({ value: o.id, label: o.name + (o.archived ? ' (archived)' : '') })), others[0]?.id);
        form.append(
          el('p', { class: 'muted', text: 'Deleting it outright would break those records, so choose one:' }),
          el('label', { class: 'radio-card' }, o1, el('span', {}, el('strong', { text: 'Archive (recommended)' }), el('span', { class: 'hint', text: 'Hide it from new entries and keep history as it is.' }))),
          el('label', { class: 'radio-card' }, o2, el('span', {}, el('strong', { text: 'Move transactions, then delete' }), el('span', { class: 'hint', text: 'Re-categorise every transaction, then remove this category.' }))),
          field('Move to', sel));
        return () => ({ mode: radioValue(form, 'cdel'), moveTo: sel.value });
      }
    });
    if (!res) return;
    if (res.mode === 'archive') {
      if (store.categoriesOf(c.type).length <= 1 && !c.archived) throw new UserError('Keep at least one active category of each type.');
      await store.setCategoryArchived(id, true);
      toast('Category archived', 'success');
      return;
    }
    const target = store.state.categories[res.moveTo];
    const ok = await confirmDialog({ title: 'Move and delete?', danger: true, confirmText: 'Move and delete',
      message: `${count} transaction${count === 1 ? '' : 's'} will move from ${c.name} to ${target?.name}, then ${c.name} will be deleted.` });
    if (!ok) return;
    await store.deleteCategory(id, res.moveTo);
    toast('Transactions moved and category deleted', 'success');
  } catch (e) { toast(store.friendlyError(e), 'error'); }
}
