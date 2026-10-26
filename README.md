# PaisaPilot

**Every Rupee, Under Control.** A private, mobile-first personal finance PWA. Developed by Reconense.

Open the app from your home screen and you land straight in **Add Transaction** (Expense tab, today's date, your primary account). Save, type the next one, save again. Close it with **X** to see your dashboard.

- Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no server.
- Firebase Authentication (email + password) and Firebase Realtime Database (modular Web SDK v13, bundled in `vendor/firebase.js`).
- Chart.js 4 (bundled in `vendor/`), Lucide icon geometry (in `js/icon-data.js`).
- Installable PWA with offline app shell. Hosted on GitHub Pages.
- Frosted-glass interface on a black-blue night sky (a frosted light theme is available in Settings).

---

## 1. What's in the folder

```
index.html              App shell (static markup, CSP, manifest link)
styles.css              All styling, light + dark themes, safe-area support
firebase-config.js      ← YOU EDIT THIS: your Firebase web config
manifest.webmanifest    PWA manifest (standalone, theme colour, icons)
service-worker.js       Caches the static app shell only. Never caches Firebase traffic.
database.rules.json     Realtime Database security rules (deploy these!)
firebase.json           Firebase CLI config (rules deployment + emulator)
.nojekyll               Tells GitHub Pages to serve files as-is
assets/icons/           App icons (192, 512, maskable, Apple touch, SVG favicon)
vendor/                 Firebase SDK bundle, Chart.js, licences
js/
  app.js                Boot, sign-in gate, routing, launch modal, app lock, SW registration
  firebase.js           Firebase initialisation
  store.js              Data layer: listeners, derived balances, validated writes, import/export
  modal.js              The Add Transaction / Edit / Transfer sheet
  auth.js               Sign in, create account, reset password, re-authentication
  views/                dashboard, transactions, accounts, categories, settings
  charts.js periods.js utils.js ui.js defaults.js brand.js icon-data.js theme-boot.js version.js
tests/rules.test.mjs    Security-rules tests (run against the Firebase Emulator)
package.json            Only for the optional rules tests; the app itself needs no npm
```

---

## 2. Firebase setup (one time, about 10 minutes)

Your database URL is already configured:
`https://exp-track-suyash-default-rtdb.europe-west1.firebasedatabase.app`

### 2.1 Get your web config
1. Open <https://console.firebase.google.com> and choose the project **exp-track-suyash**.
2. Click the gear icon → **Project settings** → **General**.
3. Under **Your apps**, if there is no Web app yet, click the **</>** icon, give it a nickname (e.g. *PaisaPilot*), and **do not** tick Firebase Hosting. Click **Register app**.
4. Copy the `firebaseConfig` values into `firebase-config.js`:

| Field | Where it comes from | Status in the file |
|---|---|---|
| `apiKey` | Web app config | **Required – replace** |
| `authDomain` | Web app config (usually `exp-track-suyash.firebaseapp.com`) | Pre-filled, verify |
| `databaseURL` | Your RTDB URL | Pre-filled |
| `projectId` | Web app config | Pre-filled, verify |
| `storageBucket` | Web app config | Pre-filled, not used |
| `messagingSenderId` | Web app config | **Required – replace** |
| `appId` | Web app config | **Required – replace** |

Until the required values are filled in, the app shows a "connect Firebase" screen instead of crashing.

### 2.2 Turn on email/password sign-in
Console → **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**

### 2.3 Authorise your GitHub Pages domain
Console → **Authentication → Settings → Authorized domains → Add domain** → add `YOUR-USERNAME.github.io` (no `https://`, no path). `localhost` is already there for local testing.

### 2.4 Deploy the security rules (do this before entering real data)
**Option A, Console (easiest):** Console → **Build → Realtime Database → Rules** tab → replace everything with the contents of `database.rules.json` → **Publish**.

**Option B, CLI:**
```bash
npm install -g firebase-tools
firebase login
firebase use exp-track-suyash
firebase deploy --only database
```

### 2.5 Restrict your API key (recommended)
Google Cloud Console → **APIs & Services → Credentials** → your *Browser key* →
- **Application restrictions:** Websites → add `https://YOUR-USERNAME.github.io/*` and `http://localhost:*/*`.
- **API restrictions:** restrict to *Identity Toolkit API*, *Token Service API* and *Firebase Realtime Database API* (plus *Firebase Installations API* if listed).

### 2.6 After you've created your own account (optional but recommended)
Stop strangers from creating accounts in your project: Console → **Authentication → Settings → User actions** → untick **Enable create (sign-up)**. (Other people could only ever see their own empty data anyway, but this keeps your project tidy.)

---

## 3. Deploy to GitHub Pages

1. Create a repository, e.g. `paisapilot` (public is fine — see Security below for why).
2. Upload **the contents** of this folder to the repository root (so `index.html` is at the top level, not inside a subfolder). Include `.nojekyll`.
3. Repository → **Settings → Pages** → *Build and deployment* → **Source: Deploy from a branch** → Branch **main**, folder **/ (root)** → **Save**.
4. Wait 1–2 minutes. The Pages settings page shows **"Your site is live at …"**.

**Repository URL vs website URL.** These are different:
- Repository (source code): `https://github.com/YOUR-USERNAME/paisapilot` — this shows files, it does **not** run the app.
- Published website: `https://YOUR-USERNAME.github.io/paisapilot/` — this is the URL you open on your phone. Use exactly what the Pages settings page shows.

The app uses relative paths and hash-based routes (`#/dashboard`), so it works under the `/paisapilot/` sub-path without any configuration. If you rename the repository, nothing in the code needs changing.

**Updating the app later:** upload the changed files, and bump `VERSION` in `service-worker.js` (and `APP_VERSION` in `js/version.js`). Installed phones will show *"A new version of PaisaPilot is ready — Update"*.

---

## 4. Install on Android (Chrome)

1. Open the **deployed GitHub Pages URL** (the `github.io` one) in Chrome.
2. Tap Chrome's **⋮** menu.
3. Tap **Install app** (or **Add to Home screen**, depending on your Chrome version).
4. Launch **PaisaPilot** from the new icon. It opens full-screen, without the browser bar, straight into Add Transaction.

---

## 5. First run

1. **Create account** with your email and a password (8+ characters). A verification email is sent; verifying is recommended.
2. 14 expense and 8 income categories are created for you.
3. Add your first account (e.g. *HDFC Savings*, opening balance). It becomes your **primary** account.
4. The Add Transaction sheet opens. You're ready.

---

## 6. How the app behaves

### Add Transaction sheet
- Opens automatically **once per fresh launch** (each time you start the app from the icon). Closing it with **X** reveals the dashboard; it won't pop up again until the next launch. Reopen any time with the **+** button or **Add Transaction**.
- Defaults: **Expense** tab, **today** (Asia/Kolkata), **primary account**. Everything is changeable per entry.
- After **Save Expense / Save Income** the sheet stays open, shows a short confirmation, clears amount, description, reference and notes, keeps tab, date and account, and resets category to that type's first category (Food / Salary).
- Switching Expense ↔ Income keeps amount, description, date and account; each tab remembers its own category.
- The Save button is locked while saving. Each new entry gets its ID before the write, and retries reuse it, so a double tap or a retry after an error **cannot** create a duplicate.
- If saving fails, nothing you typed is cleared and the error is shown.
- **Offline:** the entry is queued on the device and marked **Pending sync**; a chip in the header shows the count. It's only reported as synced when Firebase confirms. If the server later rejects it you get a **Restore** button that puts it back in the form. Keep the app open until queued entries sync (the web SDK keeps the queue in memory, not on disk).

### Accounts and balances
- Balances are **always calculated** from `opening balance + income − expenses − transfers out + transfers in`. No running balance is stored, so balances can't drift.
- **Credit card convention:** every account uses *positive = money you have, negative = money you owe*. For a card, enter today's outstanding as a positive number when you create it; it's stored as a due. Card spends increase the outstanding; paying the bill is a **Transfer** from your bank to the card. Card dues are shown separately from *Cash & bank*, and *Total balance* = cash & bank + card credit − card dues.
- Exactly one **primary** account (stored once, in settings). Deactivating the primary forces you to pick another active account.
- Accounts with history can't be deleted silently: you can **deactivate** (recommended) or **move all transactions** (and the opening balance) to another account and then delete — done in one atomic update.

### Transfers
Recorded as `type: "transfer"`, excluded from income/expense totals and charts, editable and deletable from History like any entry.

### Categories
Rename, recolour, change icon, archive. A category in use can't be deleted outright: archive it (hidden from the form, kept on history) or move its transactions to another category and then delete. Renaming updates how history displays (each transaction also keeps a name snapshot as a fallback).

### Dashboard
- **Live balances** (hero card) are clearly labelled as *not affected by the period filter*, along with *This month* spent/earned.
- The **period filter** (Today, This week (Mon–Sun), This month, Previous month, This year, All time, Custom) drives Total expenses, Total income, Net cash flow, all charts and the recent list. Account balance chart always shows current balances.

### Settings
Profile name, email verification, currency (display only, Indian digit grouping), primary account, theme (Dark black-blue glass by default, frosted Light, or follow System), date format, **app lock**, CSV export (transactions, accounts), JSON backup and restore (merge or replace), sign out, delete cloud data, delete account.

**Deleting the app vs deleting your data:** uninstalling PaisaPilot or clearing Chrome data removes only the app from your phone — your records stay in Firebase. *Delete all my cloud data* and *Delete my account* (both require typing DELETE and your password) are the only ways to erase them.

---

## 7. Data model (Realtime Database)

```
users/{uid}/
  profile/        displayName, email, createdAt
  settings/       currency, theme, dateFormat, primaryAccountId, lockEnabled, lockAfterMin, seeded
  accounts/{id}/  name, type, bankName, nickname, openingBalance (paise, signed), color, icon, active, createdAt, updatedAt
  categories/{id} name, type (expense|income), icon, color, builtIn, archived, sortOrder, createdAt, updatedAt
  transactions/{id}/
                  type (expense|income|transfer), amount (paise, integer > 0), date ("YYYY-MM-DD", IST),
                  accountId, toAccountId (transfers), categoryId + categoryName snapshot (expense/income),
                  description, reference, notes, createdAt (server time), updatedAt (server time)
```
- Money is stored as **integer paise** (₹250.50 → `25050`) to avoid floating-point errors; parsing is done on the string, not with floats.
- `date` is the transaction date you pick; `createdAt`/`updatedAt` are server timestamps. Back-dated entries therefore work correctly.
- No derived totals are stored anywhere.
- Only `users/{your uid}` is ever listened to; listeners are removed on sign-out.

---

## 8. Security & privacy

**How your data is protected.** GitHub Pages hosts only the app's *code*. Your financial records live in *your* Firebase Realtime Database. The database rules (`database.rules.json`) deny everything by default and allow a signed-in, non-anonymous user to read and write **only** `users/{their own uid}`. Rules also validate every write: allowed transaction types, positive whole-paise amounts up to ₹1,00,00,00,000, date format, referenced accounts/categories must exist, category type must match, text length limits, and unknown fields are rejected.

**Your Firebase config is public, and that's expected.** Anyone can view the JavaScript and `firebase-config.js` on GitHub Pages. A Firebase *Web API key* only identifies your project to Google; it is **not** a password or a service-account credential and grants no access by itself. Protection comes from Authentication + the rules (+ the API-key restrictions in 2.5), not from hiding the config. Never put Admin SDK credentials, service-account JSON, private keys or passwords in this repository — the app doesn't need any.

**Additional protections in the app**
- All user text is rendered with `textContent` / DOM nodes; the app uses no `innerHTML` at all.
- A Content-Security-Policy in `index.html` limits scripts to the app's own files.
- No financial data in `localStorage`, `sessionStorage`, URLs or the service-worker cache (only the theme preference is stored locally). The service worker refuses to touch Firebase/Google API traffic.
- No amounts, descriptions or credentials are written to the console.
- Destructive actions need confirmation; deleting data needs typed confirmation **and** your password.
- CSV exports neutralise spreadsheet formulas in text cells.
- Password reset shows the same message whether or not an email exists.

**App lock** (Settings → Security) asks for your password on launch and/or after time away. It's a convenience screen lock for a shared phone; it does not replace Firebase authorisation, which protects your data regardless.

**When would you need a backend?** Only if you wanted things a browser must not be trusted with, such as sharing data between users with server-enforced roles, scheduled jobs, or third-party API secrets. For a personal tracker, Auth + rules are the right security boundary.

**Don't publish real data:** keep real records out of the repo, screenshots, sample JSON and issues. Backups you download contain your real data — store them privately.

---

## 9. Testing

### 9.1 Test the rules before using real money data
**Rules Playground (Console → Realtime Database → Rules → Rules Playground):**
1. *Read* `/users/SOME_UID` with **Authenticated** off → **Denied**.
2. Authenticated, provider `password`, UID `alice`: *read* `/users/alice` → **Allowed**; `/users/bob` → **Denied**.
3. As `alice`, *set* `/users/alice/transactions/t1` with `{"type":"expense","amount":-5,"date":"2026-10-26","accountId":"x","categoryId":"y","categoryName":"Food","createdAt":1,"updatedAt":1}` → **Denied** (negative amount).

**Emulator (automated):** requires Node 20+ and Java 21+.
```bash
npm install
npm run test:rules
```
This starts the Realtime Database emulator with project `demo-paisapilot` (never your real project) and runs `tests/rules.test.mjs`: signed-out access, cross-user access, anonymous access, amount limits, field validation, and unknown fields.

### 9.2 Run locally
Service workers and ES modules need a web server (not `file://`):
```bash
npx http-server -c-1 -p 8080 .      # or: python3 -m http.server 8080
```
Open <http://localhost:8080>. `localhost` is an authorised domain by default.

### 9.3 Acceptance checklist

**Transaction entry**
- [ ] Fresh launch (from the icon) opens Add Transaction with Expense, today's date and the primary account.
- [ ] You can change amount, category, date, account and description before saving.
- [ ] Save Expense → toast, sheet stays open, amount + description cleared, tab/date/account kept, category reset.
- [ ] Switch to Income, Save Income works; amount/description survive the switch.
- [ ] Empty amount, `0`, `12.345` show clear errors.
- [ ] Double-tapping Save creates one transaction.
- [ ] Turn on airplane mode, save → "queued", Pending sync badge; turn it off → "synced".
- [ ] X reveals the dashboard; moving around the app doesn't reopen the sheet; + reopens it.

**Calculations**
- [ ] Account balance = opening + income − expenses ± transfers.
- [ ] A transfer changes both balances but not income/expense totals.
- [ ] Credit card spend increases Card dues; transfer bank → card reduces it.
- [ ] Editing or deleting a transaction updates balances, stats and charts immediately.
- [ ] Period filters change stats/charts/list; the hero balance does not change.

**Accounts & categories**
- [ ] Only one primary; deactivating it asks for a replacement.
- [ ] Deleting an account/category with history offers deactivate/archive or move.

**Security**
- [ ] Rules Playground / emulator tests above pass.
- [ ] Signed out, `https://…firebasedatabase.app/users.json` in a browser returns *Permission denied*.
- [ ] A second test account cannot see the first account's data.
- [ ] Description `<b>hi</b>` shows literally, not bold.

**Mobile & PWA**
- [ ] Installs from Chrome; opens standalone; icon looks right.
- [ ] X and Save are fully visible on a small phone (360×640), with notch and gesture bar.
- [ ] Works in light and dark themes; charts readable.
- [ ] With no network, the installed app still opens (shell cached) and shows the offline banner.

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| "One step left: connect Firebase" screen | Fill `apiKey`, `messagingSenderId`, `appId` in `firebase-config.js`. |
| Sign-in error about the domain / `auth/unauthorized-domain` | Add `YOUR-USERNAME.github.io` to Authentication → Authorized domains. |
| "Email/password sign-in is not enabled" | Enable it (section 2.2). |
| "Permission denied" after signing in | Rules not deployed, or deployed to a different database. Publish `database.rules.json` (2.4). |
| Old version keeps loading | Bump `VERSION` in `service-worker.js`, redeploy, reopen the app and tap **Update**. |
| 404 on the github.io URL | Check `index.html` is at the repository root and Pages is set to `main` / `(root)`. |

---

## Licences
Chart.js (MIT) and Lucide icons (ISC) — see `vendor/`. Firebase JS SDK (Apache-2.0), licence notices retained at the end of `vendor/firebase.js`.

Developed by Reconense.
