// Sign in / create account / reset password screens and re-authentication helpers.
import {
  auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, updateProfile, reauthenticateWithCredential, EmailAuthProvider, signOut
} from './firebase.js';
import { el, icon, clear } from './utils.js';
import { setBusy, formDialog, UserError } from './ui.js';
import { friendlyError } from './store.js';
import { logo } from './brand.js';

export function renderAuth(root) {
  let mode = 'signin';
  clear(root);
  const msg = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const info = el('p', { class: 'form-info', role: 'status', hidden: true });
  const email = el('input', { class: 'input', type: 'email', autocomplete: 'username', inputmode: 'email', required: true, id: 'auth-email', autocapitalize: 'off', spellcheck: 'false' });
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, id: 'auth-pass', minlength: '8' });
  const pass2 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', id: 'auth-pass2' });
  const name = el('input', { class: 'input', type: 'text', autocomplete: 'name', id: 'auth-name', maxlength: '60' });
  const eye = el('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show password', 'aria-pressed': 'false' }, icon('eye', 18));
  eye.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password'; pass2.type = pass.type;
    eye.setAttribute('aria-pressed', String(show)); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    eye.replaceChildren(icon(show ? 'eye-off' : 'eye', 18));
  });
  const nameField = el('label', { class: 'field', for: 'auth-name' }, el('span', { class: 'label', text: 'Your name (optional)' }), name);
  const pass2Field = el('label', { class: 'field', for: 'auth-pass2' }, el('span', { class: 'label', text: 'Confirm password' }), pass2);
  const passLabel = el('span', { class: 'label', text: 'Password' });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, el('span', { class: 'btn-label', text: 'Sign in' }));
  const forgot = el('button', { type: 'button', class: 'link-btn', text: 'Forgot password?' });
  const tabIn = el('button', { type: 'button', role: 'tab', class: 'seg-btn', text: 'Sign in' });
  const tabUp = el('button', { type: 'button', role: 'tab', class: 'seg-btn', text: 'Create account' });
  const form = el('form', { class: 'auth-form', novalidate: true },
    el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Sign in or create account' }, tabIn, tabUp),
    nameField,
    el('label', { class: 'field', for: 'auth-email' }, el('span', { class: 'label', text: 'Email' }), email),
    el('div', { class: 'field' }, el('label', { for: 'auth-pass' }, passLabel), el('div', { class: 'pass-wrap' }, pass, eye)),
    pass2Field, msg, info, submit, forgot);

  function setMode(m) {
    mode = m;
    tabIn.setAttribute('aria-selected', String(m === 'signin'));
    tabUp.setAttribute('aria-selected', String(m === 'signup'));
    nameField.hidden = m !== 'signup';
    pass2Field.hidden = m !== 'signup';
    forgot.hidden = m !== 'signin';
    pass.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    passLabel.textContent = m === 'signup' ? 'Password (at least 8 characters)' : 'Password';
    submit.querySelector('.btn-label').textContent = m === 'signup' ? 'Create account' : 'Sign in';
    msg.hidden = true; info.hidden = true;
  }
  tabIn.addEventListener('click', () => setMode('signin'));
  tabUp.addEventListener('click', () => setMode('signup'));

  const fail = (t) => { msg.textContent = t; msg.hidden = false; info.hidden = true; };
  const note = (t) => { info.textContent = t; info.hidden = false; msg.hidden = true; };

  forgot.addEventListener('click', async () => {
    const e = email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) { fail('Enter your email above, then tap Forgot password.'); email.focus(); return; }
    forgot.disabled = true;
    try { await sendPasswordResetEmail(auth, e); } catch (err) {
      if (err?.code === 'auth/network-request-failed' || err?.code === 'auth/too-many-requests') { fail(friendlyError(err)); forgot.disabled = false; return; }
    }
    // Same message whether or not the account exists, so emails can't be probed.
    note('If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.');
    forgot.disabled = false;
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    const e = email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) { fail('Enter a valid email address.'); email.focus(); return; }
    if (!pass.value) { fail('Enter your password.'); pass.focus(); return; }
    if (mode === 'signup') {
      if (pass.value.length < 8) { fail('Use at least 8 characters for your password.'); pass.focus(); return; }
      if (pass.value !== pass2.value) { fail('The two passwords do not match.'); pass2.focus(); return; }
    }
    submit.disabled = true; setBusy(submit, true); msg.hidden = true;
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, e, pass.value);
        if (name.value.trim()) await updateProfile(cred.user, { displayName: name.value.trim().slice(0, 60) }).catch(() => {});
        sendEmailVerification(cred.user).catch(() => {});
      } else {
        await signInWithEmailAndPassword(auth, e, pass.value);
      }
      pass.value = ''; pass2.value = '';
      // onAuthStateChanged in app.js takes it from here.
    } catch (err) {
      fail(friendlyError(err));
    } finally {
      submit.disabled = false; setBusy(submit, false);
    }
  });

  root.append(el('div', { class: 'auth-screen' },
    el('div', { class: 'auth-brand' }, logo(64), el('h1', { text: 'PaisaPilot' }), el('p', { class: 'tagline', text: 'Every Rupee, Under Control.' })),
    el('div', { class: 'auth-card' }, form),
    el('p', { class: 'auth-foot' }, icon('shield-check', 14), el('span', { text: 'Your data is stored in your own Firebase project and only your signed-in account can read it.' })),
    el('p', { class: 'credit', text: 'Developed by Reconense' })));
  setMode('signin');
  setTimeout(() => email.focus(), 50);
}

/** Ask for the password again. Resolves true when Firebase confirms it. */
export async function reauthenticate(title = 'Confirm it\'s you', message = 'Enter your password to continue.') {
  const user = auth.currentUser;
  if (!user || !user.email) return false;
  const r = await formDialog({
    title, submitText: 'Confirm',
    build(form) {
      const p = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
      form.append(el('p', { class: 'muted', text: message }),
        el('input', { type: 'email', autocomplete: 'username', value: user.email, hidden: true, readOnly: true }),
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Password' }), p));
      return () => p.value;
    },
    async onSubmit(pw) {
      if (!pw) throw new UserError('Enter your password.');
      try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw)); }
      catch (err) { throw new UserError(friendlyError(err)); }
      return true;
    }
  });
  return r === true;
}

export function logout() { return signOut(auth); }
export { sendEmailVerification };
