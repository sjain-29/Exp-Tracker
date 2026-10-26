// Runs before first paint to avoid a light/dark flash. Reads only the theme preference.
(function () {
  var p = 'dark';
  try { p = localStorage.getItem('pp-theme') || 'dark'; } catch (e) { /* ignore */ }
  var dark = p === 'dark' || (p === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
