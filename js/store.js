// Data layer: per-user Realtime Database listeners, derived figures and all writes.
// Balances are ALWAYS derived from opening balance + transaction history; no stored totals.
import {
  db, ref, set, update, remove, onValue, push, get, serverTimestamp
} from './firebase.js';
import { defaultCategoryRecords, isLiability } from './defaults.js';
import { MAX_PAISE, isISODate, HEX_RE, cleanText, todayISO } from './utils.js';
import { UserError } from './ui.js';

export const TX_TYPES = ['expense', 'income', 'transfer'];
export const LIMITS = { desc: 200, ref: 100, notes: 500, accName: 60, bank: 60, nick: 40, catName: 40 };

const empty = () => ({
  uid: null, email: '', profile: null, settings: null,
  accounts: {}, categories: {}, transactions: {},
  loaded: { profile: false, settings: false, accounts: false, categories: false, transactions: false },
  connected: true
});

export const state = empty();
let unsubs = [];
let listeners = new Set();
let version = 0;
let scheduled = false;
let onAuthProblem = () => {};

/** Transactions written locally but not yet acknowledged by the server: id → {payload} */
export const pending = new Map();

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() {
  version++;
  memo.clear();
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; listeners.forEach((fn) => { try { fn(state); } catch (e) { reportError(e); } }); });
}
export function touch() { notify(); }
export function isLoaded() { return Object.values(state.loaded).every(Boolean); }
export function setAuthProblemHandler(fn) { onAuthProblem = fn; }

const userPath = (p = '') => `users/${state.uid}${p ? '/' + p : ''}`;
const uref = (p) => ref(db, userPath(p));

/* ---------------- Lifecycle ---------------- */

export function start(user) {
  stop();
  state.uid = user.uid;
  state.email = user.email || '';
  const watch = (key, path) => {
    const u = onValue(uref(path), (snap) => {
      state[key] = snap.val() || (key === 'profile' || key === 'settings' ? null : {});
      state.loaded[key] = true;
      if (key === 'settings') maybeSeed(user);
      notify();
    }, (err) => handleListenerError(err));
    unsubs.push(u);
  };
  watch('profile', 'profile');
  watch('settings', 'settings');
  watch('accounts', 'accounts');
  watch('categories', 'categories');
  watch('transactions', 'transactions');
  unsubs.push(onValue(ref(db, '.info/connected'), (snap) => {
    state.connected = snap.val() === true;
    notify();
  }));
}

export function stop() {
  unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
  unsubs = [];
  pending.clear();
  Object.assign(state, empty());
  notify();
}

function handleListenerError(err) {
  if (isPermissionError(err)) onAuthProblem('Your session has expired or access was denied. Please sign in again.');
  else onAuthProblem(null, err);
}

let seeding = false;
async function maybeSeed(user) {
  if (seeding || (state.settings && state.settings.seeded)) return;
  seeding = true;
  const now = serverTimestamp();
  const patch = {
    'settings/seeded': true,
    'settings/currency': 'INR',
    'settings/theme': 'dark',
    'settings/dateFormat': 'DD MMM YYYY',
    'settings/lockEnabled': false,
    'settings/lockAfterMin': 5,
    'profile/email': cleanText(user.email, 120),
    'profile/displayName': cleanText(user.displayName || (user.email || '').split('@')[0], 60),
    'profile/createdAt': now
  };
  for (const [id, rec] of Object.entries(defaultCategoryRecords(now))) patch['categories/' + id] = rec;
  try { await update(uref(''), patch); } catch (e) { handleListenerError(e); } finally { seeding = false; }
}

/* ---------------- Derived data (memoised per data version) ---------------- */

const memo = new Map();
function cached(key, fn) { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); }

export const primaryId = () => {
  const id = state.settings && state.settings.primaryAccountId;
  return id && state.accounts[id] ? id : null;
};

export function accountsList({ includeInactive = true } = {}) {
  return cached('acc' + includeInactive, () => {
    const p = primaryId();
    return Object.entries(state.accounts)
      .map(([id, a]) => ({ id, ...a }))
      .filter((a) => includeInactive || a.active !== false)
      .sort((a, b) => (b.id === p) - (a.id === p) || (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name));
  });
}
export const activeAccounts = () => accountsList({ includeInactive: false });

export function categoriesOf(type, { includeArchived = false } = {}) {
  return cached(`cat${type}${includeArchived}`, () => Object.entries(state.categories)
    .map(([id, c]) => ({ id, ...c }))
    .filter((c) => c.type === type && (includeArchived || !c.archived))
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name)));
}
export function defaultCategoryId(type) { const l = categoriesOf(type); return l.length ? l[0].id : ''; }

export function categoryName(tx) {
  const c = state.categories[tx.categoryId];
  return c ? c.name : (tx.categoryName || 'Uncategorised');
}
export function categoryOf(tx) { return state.categories[tx.categoryId] || null; }
export function accountName(id) { const a = state.accounts[id]; return a ? a.name : 'Unknown account'; }

export function txList() {
  return cached('tx', () => Object.entries(state.transactions)
    .map(([id, t]) => ({ id, ...t }))
    .filter((t) => TX_TYPES.includes(t.type) && Number.isFinite(t.amount))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0))));
}

/**
 * Balance convention (all account types): positive = money you hold, negative = money you owe.
 * balance = openingBalance + income − expenses − transfers out + transfers in
 * Credit cards start negative (outstanding dues); card spends make them more negative;
 * paying the bill is a Transfer from a bank account to the card.
 */
export function balances() {
  return cached('bal', () => {
    const b = new Map();
    for (const [id, a] of Object.entries(state.accounts)) b.set(id, Number(a.openingBalance) || 0);
    for (const t of txList()) {
      if (t.type === 'income' && b.has(t.accountId)) b.set(t.accountId, b.get(t.accountId) + t.amount);
      else if (t.type === 'expense' && b.has(t.accountId)) b.set(t.accountId, b.get(t.accountId) - t.amount);
      else if (t.type === 'transfer') {
        if (b.has(t.accountId)) b.set(t.accountId, b.get(t.accountId) - t.amount);
        if (b.has(t.toAccountId)) b.set(t.toAccountId, b.get(t.toAccountId) + t.amount);
      }
    }
    return b;
  });
}

export function totals() {
  return cached('tot', () => {
    const b = balances();
    let cashBank = 0, cardDues = 0, cardCredit = 0;
    for (const [id, a] of Object.entries(state.accounts)) {
      const v = b.get(id) || 0;
      if (isLiability(a)) { if (v < 0) cardDues += -v; else cardCredit += v; }
      else cashBank += v;
    }
    return { cashBank, cardDues, net: cashBank + cardCredit - cardDues };
  });
}

export function txCountFor({ accountId, categoryId }) {
  return txList().filter((t) => (accountId && (t.accountId === accountId || t.toAccountId === accountId)) ||
    (categoryId && t.categoryId === categoryId)).length;
}

/* ---------------- Validation (mirrors database.rules.json) ---------------- */

export function validateTransaction(t, accounts = state.accounts, categories = state.categories) {
  if (!t || typeof t !== 'object') return 'Invalid transaction.';
  if (!TX_TYPES.includes(t.type)) return 'Unknown transaction type.';
  if (!Number.isSafeInteger(t.amount) || t.amount <= 0 || t.amount > MAX_PAISE) return 'Amount must be a positive number up to ₹1,00,00,00,000.';
  if (!isISODate(t.date)) return 'Choose a valid date.';
  if (t.date < '1970-01-01' || t.date > '2100-12-31') return 'Date is out of range.';
  if (!t.accountId || !accounts[t.accountId]) return 'Choose an account.';
  if (t.type === 'transfer') {
    if (!t.toAccountId || !accounts[t.toAccountId]) return 'Choose the account to transfer to.';
    if (t.toAccountId === t.accountId) return 'Choose two different accounts.';
  } else {
    if (!t.categoryId) return 'Choose a category.';
    const c = categories[t.categoryId];
    if (!c && !t.categoryName) return 'Choose a category.';
    if (c && c.type !== t.type) return 'That category does not match the transaction type.';
  }
  for (const [k, max] of [['description', LIMITS.desc], ['reference', LIMITS.ref], ['notes', LIMITS.notes]]) {
    if (t[k] !== undefined && (typeof t[k] !== 'string' || t[k].length > max)) return `${k} is too long (max ${max} characters).`;
  }
  return null;
}

/** Build the exact record written to the database. */
function txRecord(t, existing) {
  const rec = {
    type: t.type,
    amount: t.amount,
    date: t.date,
    accountId: t.accountId,
    description: cleanText(t.description, LIMITS.desc),
    reference: cleanText(t.reference, LIMITS.ref),
    createdAt: existing && typeof existing.createdAt === 'number' ? existing.createdAt : serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (t.type === 'transfer') {
    rec.toAccountId = t.toAccountId;
  } else {
    rec.categoryId = t.categoryId;
    rec.categoryName = cleanText(state.categories[t.categoryId]?.name || t.categoryName, LIMITS.catName);
  }
  if (t.notes) rec.notes = cleanText(t.notes, LIMITS.notes);
  return rec;
}

/* ---------------- Transactions ---------------- */

/** Generate a database key locally (no network). Reusing it on retry makes saves idempotent. */
export function newId(collection = 'transactions') { return push(uref(collection)).key; }

/**
 * Writes with set() on a pre-generated id: retrying the same id can never create a duplicate.
 * Returns the promise that resolves only when the server confirms.
 */
export function saveTransaction(id, t) {
  const err = validateTransaction(t);
  if (err) return Promise.reject(new UserError(err));
  const existing = state.transactions[id];
  return set(uref('transactions/' + id), txRecord(t, existing));
}

export function deleteTransaction(id) { return remove(uref('transactions/' + id)); }

/* ---------------- Accounts ---------------- */

export function validateAccount(a) {
  if (!a.name || a.name.length > LIMITS.accName) return 'Enter an account name (up to 60 characters).';
  if (!['savings', 'current', 'salary', 'cash', 'credit_card', 'wallet', 'other'].includes(a.type)) return 'Choose an account type.';
  if (!Number.isSafeInteger(a.openingBalance) || Math.abs(a.openingBalance) > MAX_PAISE) return 'Opening balance is out of range.';
  if (a.color && !HEX_RE.test(a.color)) return 'Invalid colour.';
  return null;
}

export async function saveAccount(id, a, { makePrimary = false } = {}) {
  const err = validateAccount(a);
  if (err) throw new UserError(err);
  const isNew = !id;
  id = id || newId('accounts');
  const existing = state.accounts[id];
  const rec = {
    name: cleanText(a.name, LIMITS.accName),
    type: a.type,
    bankName: cleanText(a.bankName, LIMITS.bank),
    nickname: cleanText(a.nickname, LIMITS.nick),
    openingBalance: a.openingBalance,
    color: a.color || '#3B82F6',
    icon: a.icon || 'landmark',
    active: a.active !== false,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const patch = { ['accounts/' + id]: rec };
  // Exactly one primary: the first account, or when explicitly requested.
  if (makePrimary || (isNew && !primaryId())) {
    if (!rec.active) throw new UserError('An inactive account cannot be primary.');
    patch['settings/primaryAccountId'] = id;
  }
  await update(uref(''), patch);
  return id;
}

export function setPrimary(id) {
  const a = state.accounts[id];
  if (!a || a.active === false) return Promise.reject(new UserError('Choose an active account.'));
  return update(uref('settings'), { primaryAccountId: id });
}

export async function setAccountActive(id, active, newPrimaryId) {
  const patch = { [`accounts/${id}/active`]: active, [`accounts/${id}/updatedAt`]: serverTimestamp() };
  if (!active && primaryId() === id) {
    if (!newPrimaryId || newPrimaryId === id || state.accounts[newPrimaryId]?.active === false) {
      throw new UserError('Choose another active account as primary first.');
    }
    patch['settings/primaryAccountId'] = newPrimaryId;
  }
  await update(uref(''), patch);
}

/** Delete an account only if nothing references it, or after moving its transactions. */
export async function deleteAccount(id, { moveTo = null, newPrimaryId = null } = {}) {
  const linked = txList().filter((t) => t.accountId === id || t.toAccountId === id);
  const patch = { ['accounts/' + id]: null };
  if (linked.length) {
    if (!moveTo || !state.accounts[moveTo] || moveTo === id) throw new UserError('Choose an account to move the transactions to.');
    for (const t of linked) {
      const from = t.accountId === id ? moveTo : t.accountId;
      const to = t.toAccountId === id ? moveTo : t.toAccountId;
      if (t.type === 'transfer' && from === to) {
        throw new UserError(`A transfer on ${t.date} is between these two accounts. Delete or edit it first.`);
      }
      if (t.accountId === id) patch[`transactions/${t.id}/accountId`] = moveTo;
      if (t.toAccountId === id) patch[`transactions/${t.id}/toAccountId`] = moveTo;
      patch[`transactions/${t.id}/updatedAt`] = serverTimestamp();
    }
    // Keep the moved account's opening balance so totals stay correct.
    const ob = Number(state.accounts[id].openingBalance) || 0;
    if (ob) patch[`accounts/${moveTo}/openingBalance`] = (Number(state.accounts[moveTo].openingBalance) || 0) + ob;
  }
  if (primaryId() === id) {
    const np = newPrimaryId || (moveTo && state.accounts[moveTo]?.active !== false ? moveTo : null);
    const others = activeAccounts().filter((x) => x.id !== id);
    if (np && state.accounts[np] && np !== id) patch['settings/primaryAccountId'] = np;
    else if (others.length) throw new UserError('Choose a new primary account first.');
    else patch['settings/primaryAccountId'] = null;
  }
  await update(uref(''), patch);
}

/* ---------------- Categories ---------------- */

export async function saveCategory(id, c) {
  const name = cleanText(c.name, LIMITS.catName);
  if (!name) throw new UserError('Enter a category name.');
  if (!['expense', 'income'].includes(c.type)) throw new UserError('Choose a category type.');
  const dupe = categoriesOf(c.type, { includeArchived: true }).find((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
  if (dupe) throw new UserError(`A ${c.type} category called "${dupe.name}" already exists.`);
  const existing = id ? state.categories[id] : null;
  if (existing && existing.type !== c.type && txCountFor({ categoryId: id })) {
    throw new UserError('This category is used by transactions, so its type cannot change.');
  }
  id = id || newId('categories');
  const rec = {
    name, type: c.type, icon: c.icon || 'tag', color: c.color || '#0EA5A0',
    builtIn: existing?.builtIn === true, archived: existing?.archived === true,
    sortOrder: existing?.sortOrder ?? 100 + categoriesOf(c.type, { includeArchived: true }).length,
    createdAt: existing?.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp()
  };
  await set(uref('categories/' + id), rec);
  return id;
}

export function setCategoryArchived(id, archived) {
  return update(uref('categories/' + id), { archived, updatedAt: serverTimestamp() });
}

/** Delete a category. If transactions use it they are moved (atomically) to `moveTo` first. */
export async function deleteCategory(id, moveTo = null) {
  const used = txList().filter((t) => t.categoryId === id);
  const patch = { ['categories/' + id]: null };
  if (used.length) {
    const target = state.categories[moveTo];
    if (!target || moveTo === id) throw new UserError('Choose a category to move the transactions to.');
    if (target.type !== state.categories[id]?.type) throw new UserError('Choose a category of the same type.');
    for (const t of used) {
      patch[`transactions/${t.id}/categoryId`] = moveTo;
      patch[`transactions/${t.id}/categoryName`] = target.name;
      patch[`transactions/${t.id}/updatedAt`] = serverTimestamp();
    }
  }
  await update(uref(''), patch);
}

/* ---------------- Settings / profile ---------------- */

export function updateSettings(patch) { return update(uref('settings'), patch); }
export function updateProfileName(name) { return update(uref('profile'), { displayName: cleanText(name, 60) }); }

/* ---------------- Backup / restore ---------------- */

export function buildBackup() {
  return {
    app: 'PaisaPilot', schemaVersion: 1, exportedAt: new Date().toISOString(), exportedDate: todayISO(),
    settings: state.settings || {}, accounts: state.accounts, categories: state.categories, transactions: state.transactions
  };
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Validate a parsed backup file. Returns { ok, error?, data?, counts? } — never trusts the file. */
export function validateBackup(raw, mode) {
  if (!raw || typeof raw !== 'object' || raw.app !== 'PaisaPilot' || raw.schemaVersion !== 1) {
    return { ok: false, error: 'This is not a PaisaPilot backup file (schema version 1).' };
  }
  const out = { accounts: {}, categories: {}, transactions: {} };
  const sections = ['accounts', 'categories', 'transactions'];
  for (const s of sections) {
    if (raw[s] !== undefined && (typeof raw[s] !== 'object' || Array.isArray(raw[s]) || raw[s] === null)) {
      return { ok: false, error: `The "${s}" section is malformed.` };
    }
  }
  const now = Date.now();
  const ts = (v) => (Number.isSafeInteger(v) && v > 0 && v <= now ? v : now);
  for (const [id, a] of Object.entries(raw.accounts || {})) {
    if (!ID_RE.test(id)) return { ok: false, error: 'An account has an invalid id.' };
    const rec = {
      name: cleanText(a?.name, LIMITS.accName), type: a?.type, bankName: cleanText(a?.bankName, LIMITS.bank),
      nickname: cleanText(a?.nickname, LIMITS.nick), openingBalance: a?.openingBalance ?? 0,
      color: HEX_RE.test(a?.color || '') ? a.color : '#0EA5A0', icon: typeof a?.icon === 'string' ? a.icon.slice(0, 32) : 'landmark',
      active: a?.active !== false, createdAt: ts(a?.createdAt), updatedAt: ts(a?.updatedAt)
    };
    const e = validateAccount(rec);
    if (e) return { ok: false, error: `Account "${rec.name || id}": ${e}` };
    out.accounts[id] = rec;
  }
  for (const [id, c] of Object.entries(raw.categories || {})) {
    if (!ID_RE.test(id)) return { ok: false, error: 'A category has an invalid id.' };
    const name = cleanText(c?.name, LIMITS.catName);
    if (!name || !['expense', 'income'].includes(c?.type)) return { ok: false, error: `Category "${name || id}" is invalid.` };
    out.categories[id] = {
      name, type: c.type, icon: typeof c.icon === 'string' ? c.icon.slice(0, 32) : 'tag',
      color: HEX_RE.test(c.color || '') ? c.color : '#0EA5A0', builtIn: c.builtIn === true, archived: c.archived === true,
      sortOrder: Number.isFinite(c.sortOrder) ? c.sortOrder : 100, createdAt: ts(c.createdAt), updatedAt: ts(c.updatedAt)
    };
  }
  // References may point at records in the file or (when merging) records already in the cloud.
  const accPool = mode === 'merge' ? { ...state.accounts, ...out.accounts } : out.accounts;
  const catPool = mode === 'merge' ? { ...state.categories, ...out.categories } : out.categories;
  for (const [id, t] of Object.entries(raw.transactions || {})) {
    if (!ID_RE.test(id)) return { ok: false, error: 'A transaction has an invalid id.' };
    const rec = {
      type: t?.type, amount: t?.amount, date: t?.date, accountId: t?.accountId,
      description: cleanText(t?.description, LIMITS.desc), reference: cleanText(t?.reference, LIMITS.ref),
      createdAt: ts(t?.createdAt), updatedAt: ts(t?.updatedAt)
    };
    if (t?.type === 'transfer') rec.toAccountId = t.toAccountId;
    else { rec.categoryId = t?.categoryId; rec.categoryName = cleanText(t?.categoryName || catPool[t?.categoryId]?.name, LIMITS.catName); }
    if (t?.notes) rec.notes = cleanText(t.notes, LIMITS.notes);
    const e = validateTransaction(rec, accPool, catPool);
    if (e) return { ok: false, error: `Transaction dated ${t?.date || '?'}: ${e}` };
    if (rec.type !== 'transfer' && !catPool[rec.categoryId]) return { ok: false, error: `Transaction dated ${rec.date}: its category is missing from the backup.` };
    out.transactions[id] = rec;
  }
  let primary = raw.settings?.primaryAccountId;
  if (!primary || !accPool[primary] || accPool[primary].active === false) {
    primary = mode === 'merge' && primaryId() ? primaryId() : Object.keys(accPool).find((k) => accPool[k].active !== false) || null;
  }
  return {
    ok: true, data: out, primary,
    counts: { accounts: Object.keys(out.accounts).length, categories: Object.keys(out.categories).length, transactions: Object.keys(out.transactions).length }
  };
}

/** mode 'merge' adds records whose ids don't exist yet; 'replace' swaps all financial data atomically. */
export async function importBackup(v, mode) {
  const patch = {};
  if (mode === 'replace') {
    patch.accounts = v.data.accounts;
    patch.categories = v.data.categories;
    patch.transactions = v.data.transactions;
    patch['settings/primaryAccountId'] = v.primary;
    await update(uref(''), patch);
    return v.counts;
  }
  const added = { accounts: 0, categories: 0, transactions: 0 };
  for (const s of ['accounts', 'categories', 'transactions']) {
    for (const [id, rec] of Object.entries(v.data[s])) {
      if (state[s][id]) continue; // never overwrite existing records when merging
      patch[`${s}/${id}`] = rec; added[s]++;
    }
  }
  if (!primaryId() && v.primary) patch['settings/primaryAccountId'] = v.primary;
  if (Object.keys(patch).length) await update(uref(''), patch);
  return added;
}

/** Permanently delete every record under users/{uid}. */
export function deleteAllCloudData() { return remove(uref('')); }

/** One-shot read used to double-check the server copy (e.g. before destructive actions). */
export function readOnce(path) { return get(uref(path)).then((s) => s.val()); }

/* ---------------- Errors ---------------- */

export function isPermissionError(err) {
  const s = String(err?.code || err?.message || '').toLowerCase();
  return s.includes('permission_denied') || s.includes('permission-denied') || s.includes('permission denied');
}

export function friendlyError(err) {
  if (!err) return 'Something went wrong.';
  if (err.userMessage) return err.userMessage;
  const code = String(err.code || '');
  const map = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/weak-password': 'Use a stronger password (at least 8 characters).',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No connection to Firebase. Check your internet and try again.',
    'auth/requires-recent-login': 'For your security, enter your password again to continue.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled in your Firebase project.',
    'auth/admin-restricted-operation': 'New sign-ups are disabled for this app.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-api-key': 'The Firebase API key in firebase-config.js is invalid.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The Firebase API key in firebase-config.js is invalid.'
  };
  if (map[code]) return map[code];
  if (isPermissionError(err)) return 'Permission denied. Your session may have expired — sign in again. If this keeps happening, check that database.rules.json is deployed.';
  if (/network|offline|disconnect/i.test(String(err.message))) return 'Connection lost. Check your internet and try again.';
  return 'Something went wrong. Please try again.';
}

/** Log without leaking amounts, descriptions or credentials. */
export function reportError(err) {
  console.warn('[PaisaPilot]', err?.code || err?.name || 'error');
}
