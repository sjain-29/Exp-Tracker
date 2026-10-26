// PaisaPilot — Firebase client configuration
// ------------------------------------------------------------------
// Copy these values from: Firebase Console → Project settings (gear icon)
// → General → "Your apps" → your Web app (</>) → "SDK setup and configuration" → Config.
//
// These values identify your Firebase project to the browser. They are NOT
// secrets and they will be visible to anyone who opens your GitHub Pages site.
// Your data is protected by Firebase Authentication + database.rules.json,
// not by hiding this file. NEVER put service-account JSON, Admin SDK keys,
// private keys or passwords here.
//
// Values marked "VERIFY" were inferred from your database URL; confirm them
// against the Console. Values marked "REQUIRED" must be filled in by you.

export const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_WEB_API_KEY",                 // REQUIRED
  authDomain: "exp-track-suyash.firebaseapp.com",           // VERIFY
  databaseURL: "https://exp-track-suyash-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "exp-track-suyash",                            // VERIFY
  storageBucket: "exp-track-suyash.firebasestorage.app",    // VERIFY (not used by the app)
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",         // REQUIRED
  appId: "REPLACE_WITH_YOUR_APP_ID"                         // REQUIRED
};
