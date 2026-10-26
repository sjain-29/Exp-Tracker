// Firebase bootstrap. The SDK (modular v13) is bundled locally in vendor/firebase.js
// so the app works offline as an installed PWA and has no runtime CDN dependency.
import { firebaseConfig } from '../firebase-config.js';
import {
  initializeApp, getAuth, getDatabase, setPersistence, browserLocalPersistence
} from '../vendor/firebase.js';

export * from '../vendor/firebase.js';

const REQUIRED = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];

export function configProblems() {
  return REQUIRED.filter((k) => {
    const v = firebaseConfig[k];
    return typeof v !== 'string' || !v.trim() || v.startsWith('REPLACE_WITH');
  });
}

export let app = null;
export let auth = null;
export let db = null;

export function initFirebase() {
  if (app) return true;
  if (configProblems().length) return false;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Keep the user signed in on this device until they sign out (Firebase manages the token).
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  db = getDatabase(app);
  return true;
}
