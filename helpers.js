/* ═══════════════════════════════════════════
   SHARED HELPERS — global utilities
   These must be loaded BEFORE app-core.js
════════════════════════════════════════════ */

/* Language select — show custom input when "custom" chosen */
function handleLangChange(sel) {
  const customInput = document.getElementById('customLangInput');
  if (sel.value === 'custom') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
    customInput.value = '';
  }
}

/* Password visibility toggle (called from inline onclick) */
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  btn.querySelector('svg').innerHTML = show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1=\"1\" y1=\"1\" x2=\"23\" y2=\"23\"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}
