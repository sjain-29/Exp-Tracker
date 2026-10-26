// PaisaPilot entry point: boot, auth gate, routing, launch modal, app lock, PWA registration.
import { initFirebase, configProblems, auth, onAuthStateChanged } from './firebase.js';
import { el, icon, clear, $, hydrateIcons, setCurrency, setDateFormat } from './utils.js';
import { toast, emptyState } from './ui.js';
import * as store from './store.js';
import * as modal from './modal.js';
import { renderAuth, reauthenticate, logout } from './auth.js';
import { logo } from './brand.js';
import * as dashboard from './views/dashboard.js';
import * as transactions from './views/transactions.js';
import * as accounts from './views/accounts.js';
import * as categories from './views/categories.js';
import * as settings from './views/settings.js';
import { editAccountDialog } from './views/accounts.js';

const ROUTES = {
  dashboard: { label: 'Dashboard', icon: 'layout-dashboard', mod: dashboard },
  transactions: { label: 'Transactions', icon: 'list', mod: transactions },
  accounts: { label: 'Accounts', icon: 'wallet', mod: accounts },
  categories: { label: 'Categories', icon: 'tags', mod: categories },
  settings: { label: 'Settings', icon: 'settings', mod: settings }
};

const app = {
  route: null, view: null,
  launchModalDone: false,      // the modal auto-opens once per page load (= fresh app launch)
  locked: false, hiddenAt: null, lockDlg: null,
  userUid: null
};

/* ---------------- Theme (preference only is cached locally; never financial data) ---------------- */

function applyTheme(pref) {
  const p = ['light', 'dark', 'system'].includes(pref) ? pref : 'dark';
  const dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#03050B' : '#E6ECF8');
  try { localStorage.setItem('pp-theme', p); } catch { /* storage unavailable */ }
  return dark;
}
let themePref = (() => { try { return localStorage.getItem('pp-theme') || 'dark'; } catch { return 'dark'; } })();
applyTheme(themePref);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themePref === 'system') { applyTheme('system'); rerender(); } });

/* ---------------- Screens ---------------- */

const screens = {
  boot: $('#boot'), auth: $('#auth-root'), shell: $('#shell'), setup: $('#setup-root')
};
function show(name) { for (const [k, n] of Object.entries(screens)) n.hidden = k !== name; }

function buildShell() {
  const brand = () => el('a', { class: 'brand', href: '#/dashboard', 'aria-label': 'PaisaPilot dashboard' }, logo(30), el('span', { class: 'brand-name', text: 'PaisaPilot' }));
  const side = $('#sidebar'), bottom = $('#bottom-nav');
  clear(side).append(brand(), el('p', { class: 'side-tag', text: 'Every Rupee, Under Control.' }));
  const sideNav = el('nav', { class: 'side-nav', 'aria-label': 'Main' });
  for (const [key, r] of Object.entries(ROUTES)) {
    sideNav.append(el('a', { href: `#/${key}`, class: 'nav-item', dataset: { route: key } }, icon(r.icon, 20), el('span', { text: r.label })));
    bottom.append(el('a', { href: `#/${key}`, class: 'tab-item', dataset: { route: key } }, icon(r.icon, 22), el('span', { text: r.label === 'Transactions' ? 'History' : r.label })));
  }
  side.append(sideNav,
    el('button', { type: 'button', class: 'btn btn-primary btn-block side-add', onclick: () => modal.openAdd() }, icon('plus', 20), el('span', { text: 'Add Transaction' })),
    el('p', { class: 'credit', text: 'Developed by Reconense' }));
  clear($('#topbar-brand')).append(brand());
  $('#fab').addEventListener('click', () => modal.openAdd());
  hydrateIcons($('#shell'));
}

/* ---------------- Routing (hash-based: works under any GitHub Pages sub-path) ---------------- */

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return ROUTES[h] ? h : 'dashboard';
}

function navigate(route, preset) {
  if (route === 'transactions' && preset) transactions.preset(preset);
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
  else mountRoute(true);
}

function mountRoute(force = false) {
  if (!store.isLoaded() || app.locked) return;
  const r = currentRoute();
  // No accounts yet: dashboard and history show the welcome step; Accounts, Categories and Settings stay reachable.
  if (!store.accountsList().length && (r === 'dashboard' || r === 'transactions')) { renderWelcome(); markNav(r); return; }
  if (r === app.route && app.view && !force) { app.view.update(); return; }
  app.view?.destroy?.();
  app.route = r;
  const root = clear($('#view'));
  root.dataset.view = r;
  app.view = ROUTES[r].mod.render(root, { navigate });
  app.view.update();
  markNav(r);
  document.title = `${ROUTES[r].label} | PaisaPilot`;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => mountRoute());

function markNav(r) {
  for (const a of document.querySelectorAll('[data-route]')) {
    if (a.dataset.route === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function rerender() { if (app.view && store.isLoaded()) mountRoute(true); }

function renderWelcome() {
  app.view?.destroy?.(); app.view = null; app.route = 'welcome';
  const root = clear($('#view'));
  root.append(el('section', { class: 'welcome' },
    logo(56),
    el('h1', { text: 'Welcome aboard' }),
    el('p', { class: 'muted', text: 'Start by adding the account you spend from most, such as your savings account or cash. It becomes your primary account and is pre-selected on every entry.' }),
    el('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => editAccountDialog(null) }, icon('plus', 20), el('span', { text: 'Add your first account' })),
    el('p', { class: 'hint', text: '14 expense and 8 income categories are ready. You can rename them or add your own any time under Categories.' }),
    el('button', { type: 'button', class: 'link-btn', onclick: () => logout() }, 'Sign out'),
    el('p', { class: 'credit', text: 'Developed by Reconense' })));
}

/* ---------------- Status bar: offline + pending sync ---------------- */

function renderStatus() {
  const chip = $('#status-chip');
  const banner = $('#banner');
  const n = store.pending.size;
  clear(chip);
  chip.hidden = store.state.connected && !n;
  if (!store.state.connected) chip.append(icon('cloud-off', 14), el('span', { text: n ? `Offline, ${n} waiting` : 'Offline' }));
  else if (n) chip.append(icon('refresh-cw', 14, 'spin'), el('span', { text: `Syncing ${n}` }));
  chip.className = `status-chip ${store.state.connected ? 'syncing' : 'offline'}`;
  banner.hidden = store.state.connected || !store.isLoaded();
  clear(banner);
  if (!banner.hidden) banner.append(icon('cloud-off', 16), el('span', { text: 'You are offline. New entries are kept on this device and marked "Pending sync" until the server confirms them. Keep the app open until they sync.' }));
}

window.addEventListener('beforeunload', (e) => {
  if (store.pending.size) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------------- Data changes ---------------- */

store.subscribe(() => {
  if (!app.userUid) return;
  renderStatus();
  if (!store.isLoaded()) return;
  const st = store.state.settings || {};
  setCurrency(st.currency || 'INR');
  setDateFormat(st.dateFormat || 'DD MMM YYYY');
  if ((st.theme || 'dark') !== themePref) { themePref = st.theme || 'dark'; applyTheme(themePref); app.view && mountRoute(true); }
  if (screens.shell.hidden) show('shell');

  if (!app.launchModalDone && st.lockEnabled === true && !app.locked && app.lockCheckedLaunch !== true) {
    app.lockCheckedLaunch = true;
    lockApp();
    return;
  }
  app.lockCheckedLaunch = true;
  mountRoute();
  modal.refresh();
  maybeLaunchModal();
});

function maybeLaunchModal() {
  if (app.launchModalDone || app.locked || !store.activeAccounts().length) return;
  app.launchModalDone = true;
  // Fresh launch: Expense tab, today's date, primary account. X leads to the dashboard.
  modal.openAdd({ fresh: true });
}
// X on the quick-entry modal always reveals the dashboard (edit and transfer sheets return to where you were).
modal.setAddCloseHandler(() => { if (app.userUid && !app.locked && currentRoute() !== 'dashboard') navigate('dashboard'); });

store.setAuthProblemHandler(async (message, err) => {
  if (message) {
    toast(message, 'error', { duration: 8000 });
    modal.close();
    try { await logout(); } catch { /* ignore */ }
  } else {
    store.reportError(err);
    toast('Could not load your data. Check your connection, then reopen the app.', 'error', { duration: 8000 });
  }
});

/* ---------------- App lock (convenience screen lock, not a security boundary) ---------------- */

function lockApp() {
  if (app.locked) return;
  app.locked = true;
  modal.close();
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('#view').hidden = true;
  const dlg = el('dialog', { class: 'lock-screen', 'aria-label': 'PaisaPilot is locked' });
  const unlockBtn = el('button', { type: 'button', class: 'btn btn-primary btn-lg' }, icon('lock', 18), el('span', { text: 'Unlock with password' }));
  unlockBtn.addEventListener('click', async () => {
    // The password sheet opens on top of the lock screen (stacked top-layer dialogs).
    const ok = await reauthenticate('Unlock PaisaPilot', `Enter the password for ${auth.currentUser?.email || 'your account'}.`);
    if (ok) unlock();
  });
  dlg.append(el('div', { class: 'lock-inner' }, logo(64), el('h1', { text: 'PaisaPilot is locked' }),
    el('p', { class: 'muted', text: 'Your session is still signed in. Enter your password to continue.' }), unlockBtn,
    el('button', { type: 'button', class: 'link-btn', onclick: async () => { unlock(true); await logout(); } }, 'Sign out instead')));
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  // If the browser force-closes it (e.g. repeated Android back), put it straight back.
  dlg.addEventListener('close', () => { if (app.locked) requestAnimationFrame(() => { if (app.locked && !dlg.open) dlg.showModal(); }); });
  document.body.appendChild(dlg);
  app.lockDlg = dlg;
  dlg.showModal();
}

function unlock(silent = false) {
  app.locked = false;
  const d = app.lockDlg; app.lockDlg = null;
  if (d) { d.close(); d.remove(); }
  $('#view').hidden = false;
  if (silent) return;
  mountRoute(true);
  maybeLaunchModal();
}

document.addEventListener('visibilitychange', () => {
  const st = store.state.settings || {};
  if (document.visibilityState === 'hidden') { app.hiddenAt = Date.now(); return; }
  if (!app.userUid || !st.lockEnabled || app.locked || !app.hiddenAt) return;
  const mins = Number(st.lockAfterMin ?? 5);
  if (mins === 0 || Date.now() - app.hiddenAt >= mins * 60000) lockApp();
});

/* ---------------- Setup screen (missing Firebase config) ---------------- */

function renderSetup(missing) {
  const root = clear(screens.setup);
  root.append(el('div', { class: 'auth-screen' },
    el('div', { class: 'auth-brand' }, logo(64), el('h1', { text: 'PaisaPilot' }), el('p', { class: 'tagline', text: 'Every Rupee, Under Control.' })),
    el('div', { class: 'auth-card setup-card' },
      el('h2', { text: 'One step left: connect Firebase' }),
      el('p', { text: 'Open firebase-config.js and paste the values from Firebase Console, Project settings, Your apps, Web app config. These fields still need values:' }),
      el('ul', { class: 'setup-list' }, ...missing.map((m) => el('li', {}, el('code', { text: m })))),
      el('p', { class: 'hint', text: 'See README.md, section "Firebase setup", for the full walkthrough.' }))));
  show('setup');
}

/* ---------------- Boot ---------------- */

function boot() {
  hydrateIcons();
  const missing = configProblems();
  if (missing.length || !initFirebase()) { renderSetup(missing); return; }
  buildShell();
  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (app.userUid === user.uid) return;
      app.userUid = user.uid;
      app.route = null;
      clear($('#view')).append(el('div', { class: 'loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text: 'Loading your accounts' })));
      show('shell');
      store.start(user);
      clearTimeout(app.slowTimer);
      app.slowTimer = setTimeout(() => {
        if (app.userUid && !store.isLoaded()) {
          const v = clear($('#view'));
          v.append(emptyState('cloud-off', 'Still connecting to Firebase', 'Check your internet connection. Your data will appear as soon as the connection is back.',
            el('button', { type: 'button', class: 'btn btn-soft', onclick: () => location.reload() }, icon('refresh-cw', 18), el('span', { text: 'Retry' }))));
        }
      }, 12000);
    } else {
      app.userUid = null;
      app.view?.destroy?.(); app.view = null; app.route = null;
      if (app.locked) unlock(true);
      modal.close();
      store.stop();
      clear($('#view'));
      renderAuth(clear(screens.auth));
      show('auth');
    }
  });
  registerSW();
}

/* ---------------- Service worker ---------------- */

function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      const notify = (w) => toast('A new version of PaisaPilot is ready.', 'info', {
        duration: 15000, action: { label: 'Update', run: () => w.postMessage('SKIP_WAITING') }
      });
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) notify(w); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || store.pending.size) return; reloaded = true; location.reload();
      });
    } catch { /* offline support unavailable; app still works online */ }
  });
}

boot();
