/* ═══════════════════════════════════════════
   THEME — Light / Dark mode toggle
   Persists preference to localStorage.
   Syncs highlight.js stylesheet on change.
════════════════════════════════════════════ */

   LIGHT / DARK MODE TOGGLE
════════════════════════════════════════════ */
(function initTheme() {
  // Persist in localStorage; default to dark
  const saved = localStorage.getItem('cs_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  // Sync highlight.js themes
  syncHljsTheme(saved);
})();

function syncHljsTheme(theme) {
  const dark  = document.getElementById('hljs-theme-dark');
  const light = document.getElementById('hljs-theme-light');
  if (!dark || !light) return;
  if (theme === 'light') {
    dark.disabled  = true;
    light.disabled = false;
  } else {
    dark.disabled  = false;
    light.disabled = true;
  }
}

document.getElementById('themeToggleBtn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cs_theme', next);
  syncHljsTheme(next);
  // Re-render snippets so highlight.js picks up new theme colours
  if (typeof renderSnippets === 'function') renderSnippets();
});

