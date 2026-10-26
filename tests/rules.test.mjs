// Security-rules tests for database.rules.json, run against the local Firebase Emulator.
//   npm install
//   npm run test:rules
// No real project or real data is touched (project id "demo-paisapilot").
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

let env;
const TS = { '.sv': 'timestamp' };
const account = (o = {}) => ({ name: 'HDFC Savings', type: 'savings', openingBalance: 500000, active: true, color: '#0EA5A0', icon: 'landmark', createdAt: TS, updatedAt: TS, ...o });
const category = (o = {}) => ({ name: 'Food', type: 'expense', icon: 'utensils', color: '#F97316', builtIn: true, archived: false, sortOrder: 0, createdAt: TS, updatedAt: TS, ...o });
const tx = (o = {}) => ({ type: 'expense', amount: 25050, date: '2026-10-26', accountId: 'acc1', categoryId: 'cat1', categoryName: 'Food', description: 'Lunch', reference: '', createdAt: TS, updatedAt: TS, ...o });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-paisapilot',
    database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9000 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref('users/alice').set({
      accounts: { acc1: account(), acc2: account({ name: 'Cash', type: 'cash' }) },
      categories: { cat1: category(), inc1: category({ name: 'Salary', type: 'income' }) }
    });
  });
});
const alice = () => env.authenticatedContext('alice', { firebase: { sign_in_provider: 'password' } }).database();

test('signed-out users cannot read or write anything', async () => {
  const db = env.unauthenticatedContext().database();
  await assertFails(db.ref('users/alice').get());
  await assertFails(db.ref('users/alice/transactions/t1').set(tx()));
  await assertFails(db.ref('/').get());
});

test('a user cannot read or write another user\'s data', async () => {
  const bob = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'password' } }).database();
  await assertFails(bob.ref('users/alice').get());
  await assertFails(bob.ref('users/alice/transactions/t1').set(tx()));
  await assertFails(bob.ref('users').get());
});

test('anonymous sign-in is rejected', async () => {
  const anon = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous' } }).database();
  await assertFails(anon.ref('users/alice').get());
});

test('owner can read and write valid records', async () => {
  await assertSucceeds(alice().ref('users/alice').get());
  await assertSucceeds(alice().ref('users/alice/transactions/t1').set(tx()));
  await assertSucceeds(alice().ref('users/alice/transactions/t2').set(tx({ type: 'income', categoryId: 'inc1', categoryName: 'Salary' })));
  await assertSucceeds(alice().ref('users/alice/transactions/t3').set(tx({ type: 'transfer', categoryId: null, categoryName: null, toAccountId: 'acc2' })));
  await assertSucceeds(alice().ref('users/alice/settings/primaryAccountId').set('acc1'));
});

test('amounts must be positive whole paise within the limit', async () => {
  for (const amount of [0, -100, 12.5, 100000000001, '500']) {
    await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ amount })));
  }
});

test('transaction shape is enforced', async () => {
  await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ type: 'loan' })));
  await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ accountId: 'missing' })));
  await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ categoryId: 'inc1' })));          // income category on an expense
  await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ date: '26/10/2026' })));
  await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ description: 'x'.repeat(201) })));
  await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ isAdmin: true })));                // unknown field
  await assertFails(alice().ref('users/alice/transactions/t1').set(tx({ type: 'transfer', categoryId: null, categoryName: null, toAccountId: 'acc1' }))); // same account
});

test('accounts, categories and settings are validated', async () => {
  await assertFails(alice().ref('users/alice/accounts/acc3').set(account({ type: 'crypto' })));
  await assertFails(alice().ref('users/alice/accounts/acc3').set(account({ name: '' })));
  await assertFails(alice().ref('users/alice/categories/c9').set(category({ type: 'transfer' })));
  await assertFails(alice().ref('users/alice/settings/primaryAccountId').set('missing'));
  await assertFails(alice().ref('users/alice/settings/theme').set('neon'));
  await assertFails(alice().ref('users/alice/secrets').set({ a: 1 }));
});
