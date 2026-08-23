/* ── Language select — show custom input when "custom" chosen ── */
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

/* ── Password visibility toggle (global, called from inline onclick) ── */
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  btn.querySelector('svg').innerHTML = show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}
(function () {
'use strict';

/* ════════════════════════════════════════════
   ANTI-INSPECT
════════════════════════════════════════════ */
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
  const blocked =
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && ['I','J','C','K'].includes(e.key.toUpperCase())) ||
    (e.ctrlKey && e.key.toUpperCase() === 'U') ||
    (e.metaKey && e.altKey && ['I','J','C'].includes(e.key.toUpperCase()));
  if (blocked) { e.preventDefault(); e.stopPropagation(); }
});
function checkDevTools() {
  const show = window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160;
  document.getElementById('devtoolsOverlay').classList.toggle('show', show);
}
setInterval(checkDevTools, 1000);
window.addEventListener('resize', checkDevTools);

/* ════════════════════════════════════════════
   CONFIG  — replace with your Supabase project
════════════════════════════════════════════ */
const _c = 'https://sdliegtdpqjtpfkvsqrr.supabase.co';
const _k = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkbGllZ3RkcHFqdHBma3ZzcXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2OTI5OTksImV4cCI6MjA4NzI2ODk5OX0.BIsvIPB02ydNwh36hmwKSrf9MwfXwJjvIo3BLH8UDpU';
// Admin passphrase is verified server-side by /api/admin/login — never shipped to the client.

/* ════════════════════════════════════════════
   RATE LIMITING
════════════════════════════════════════════ */
const RATE_LIMIT = { max: 5 };

function getRateData() {
  try { const r = sessionStorage.getItem('_rl'); return r ? JSON.parse(r) : { attempts: 0, lockedUntil: 0 }; }
  catch { return { attempts: 0, lockedUntil: 0 }; }
}
function saveRateData(d) { try { sessionStorage.setItem('_rl', JSON.stringify(d)); } catch {} }
function recordFailedAttempt() { const d = getRateData(); d.attempts = (d.attempts || 0) + 1; saveRateData(d); updateRateLimitUI(); }
function resetRateLimit()      { saveRateData({ attempts: 0, lockedUntil: 0 }); updateRateLimitUI(); }
function isRateLimited()       { const d = getRateData(); return d.lockedUntil && Date.now() < d.lockedUntil ? d.lockedUntil : false; }

function updateRateLimitUI() {
  const d = getRateData();
  const bar = document.getElementById('rateLimitBar');
  const label = document.getElementById('rateLimitLabel');
  const dots  = document.getElementById('rateLimitDots');
  if (!bar) return;
  const attempts = d.attempts || 0;
  if (attempts > 0) {
    bar.classList.add('show');
    label.textContent = '⚠ Failed attempts: ' + attempts + '/' + RATE_LIMIT.max;
    dots.innerHTML = Array(RATE_LIMIT.max).fill(0).map((_,i) => '<div class="rate-dot' + (i < attempts ? ' used' : '') + '"></div>').join('');
  } else {
    bar.classList.remove('show');
  }
}

/* ════════════════════════════════════════════
   INPUT SECURITY
════════════════════════════════════════════ */
function sanitizeInput(el) { el.value = el.value.replace(/[<>"'`]/g, ''); }
function validateEmail(e)   { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validatePassword(p){ return p.length >= 8; }

/* ════════════════════════════════════════════
   INACTIVITY TIMEOUT
════════════════════════════════════════════ */
let _inactivityTimer = null;
const INACTIVITY_MS = 30 * 60 * 1000;
function resetInactivityTimer() {
  clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    if (_session) { showToast('⏱ Session expired', 'warning'); signOut(); }
  }, INACTIVITY_MS);
}
['click','keydown','mousemove','touchstart'].forEach(ev =>
  document.addEventListener(ev, resetInactivityTimer, { passive: true })
);

/* ════════════════════════════════════════════
   STATE
════════════════════════════════════════════ */
let _session      = null;
let _userProfile  = null;
let _authMode     = 'login';
let _siteUnlocked = false;
let _allUsers     = [];
let _currentFilter= 'pending';
let snippets      = [];
let _guestNotes      = false;   // set from site_settings.guest_notes
let _guestAddSnippet = false;   // set from site_settings.guest_add_snippet
// FIX 2: Track the newest snippet's timestamp so auto-refresh only
// downloads rows that didn't exist on the last fetch — not the full DB.
let _lastSyncTime = null;
// Edit mode: holds the id of the snippet currently being edited, or null.
let _editingId    = null;

/* ════════════════════════════════════════════
   SCREEN MANAGER
════════════════════════════════════════════ */
function showScreen(id) {
  ['authScreen','pendingScreen'].forEach(sid => {
    document.getElementById(sid).classList.toggle('active', sid === id);
  });
  document.getElementById('adminPortal').classList.toggle('active',   id === 'adminPortal');
  document.getElementById('appContainer').classList.toggle('visible', id === 'app');
  // Show fixed logo only on auth/pending screens
  const isAuthScreen = (id === 'authScreen' || id === 'pendingScreen');
  document.getElementById('authFixedLogo').classList.toggle('visible', isAuthScreen);
}

/* ════════════════════════════════════════════
   INIT — check site lock on load
════════════════════════════════════════════ */
async function init() {
  // Check if this is a public snippet URL first
  const isPublic = await checkPublicView();
  if (isPublic) return;

  showScreen('authScreen');
  document.getElementById('authFixedLogo').classList.add('visible');
  updateRateLimitUI();
  try {
    const res = await fetch(_c + '/rest/v1/site_settings?id=eq.1&select=locked,guest_notes,guest_add_snippet', {
      headers: { 'apikey': _k, 'Authorization': 'Bearer ' + _k }
    });
    if (res.ok) {
      const [row] = await res.json();
      if (row && row.locked === false) {
        _siteUnlocked = true;
        _guestNotes      = row.guest_notes      === true;
        _guestAddSnippet = row.guest_add_snippet === true;
        showApp(null);
        return;
      }
    }
  } catch {}
  showScreen('authScreen');
}
init();

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function _headers(token) {
  return {
    'apikey': _k,
    'Authorization': 'Bearer ' + (token || _k),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

// Headers for our own /api/admin/* routes — no anon key needed, the server holds that.
function _adminHeaders(token) {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

/* ════════════════════════════════════════════
   AUTH TAB SWITCHING
════════════════════════════════════════════ */
function switchTab(mode) {
  _authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active',  mode === 'login');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('tabAdmin').classList.toggle('active',  mode === 'admin');

  const authBtn       = document.getElementById('authBtn');
  const confirmField  = document.getElementById('confirmField');
  const adminKeyField = document.getElementById('adminKeyField');
  const notice        = document.getElementById('authNotice');
  const headline      = document.getElementById('authHeadline');
  const subline       = document.getElementById('authSubline');

  document.getElementById('authError').classList.remove('show');
  notice.style.display = 'none';
  confirmField.style.display  = 'none';
  adminKeyField.style.display = 'none';
  authBtn.classList.remove('admin-btn');
  subline.className = 'auth-sub';

  if (mode === 'login') {
    headline.textContent = 'Welcome back.';
    subline.textContent  = 'Sign in to access your personal snippet library.';
    authBtn.innerHTML    = 'Sign In <svg width="13" height="13"><use href="#icon-arrow"/></svg>';
  } else if (mode === 'signup') {
    headline.textContent   = 'Create an account.';
    subline.textContent    = 'New accounts require admin approval before you can log in.';
    subline.className      = 'auth-sub red';
    confirmField.style.display = 'block';
    authBtn.innerHTML      = 'Request Access <svg width="13" height="13"><use href="#icon-arrow"/></svg>';
  } else if (mode === 'admin') {
    headline.textContent        = 'Admin access.';
    subline.textContent         = 'Sign in with your admin credentials and passphrase.';
    authBtn.classList.add('admin-btn');
    authBtn.innerHTML           = 'Admin Sign In <svg width="13" height="13"><use href="#icon-arrow"/></svg>';
    adminKeyField.style.display = 'block';
  }
}

/* ════════════════════════════════════════════
   AUTH HANDLER
════════════════════════════════════════════ */
async function handleAuth() {
  const lockUntil = isRateLimited();
  if (lockUntil) {
    const mins = Math.ceil((lockUntil - Date.now()) / 60000);
    showAuthError('Too many failed attempts. Try again in ' + mins + ' minute(s).');
    return;
  }

  const email    = (document.getElementById('authEmail').value || '').trim().toLowerCase();
  const password = document.getElementById('authPassword').value || '';
  const btn      = document.getElementById('authBtn');

  if (!email || !password) { showAuthError('Please fill in all fields.'); return; }
  if (!validateEmail(email)) { showAuthError('Please enter a valid email.'); return; }

  if (_authMode === 'signup') {
    const confirm = document.getElementById('authConfirm').value || '';
    if (!validatePassword(password)) { showAuthError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { showAuthError('Passwords do not match.'); return; }
  }

  const modeAtSubmit = _authMode;
  const adminKey = modeAtSubmit === 'admin' ? (document.getElementById('adminKey').value || '') : '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ' +
    (modeAtSubmit === 'signup' ? 'Requesting...' : modeAtSubmit === 'admin' ? 'Authenticating...' : 'Signing in...');

  try {
    if (modeAtSubmit === 'admin') {
      const res  = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password, passphrase: adminKey }) });
      const data = await res.json();
      if (!res.ok) { recordFailedAttempt(); showAuthError(data.error || 'Authentication failed.'); return; }
      _session = data.session;
      _userProfile = data.profile;
      resetRateLimit();
      showAdminPortal();
      return;
    }

    const url  = modeAtSubmit === 'signup' ? _c + '/auth/v1/signup' : _c + '/auth/v1/token?grant_type=password';
    const res  = await fetch(url, { method:'POST', headers:{'apikey':_k,'Content-Type':'application/json'}, body: JSON.stringify({email,password}) });
    const data = await res.json();

    if (!res.ok) { recordFailedAttempt(); showAuthError(data.error_description || data.msg || 'Authentication failed.'); return; }

    if (modeAtSubmit === 'signup') {
      if (data.user && data.user.id) await createProfile(data.user.id, email, 'user', 'pending', data.access_token || null);
      switchTab('login');
      const notice = document.getElementById('authNotice');
      notice.style.display = 'block';
      notice.textContent   = '✓ Account created! Awaiting admin approval.';
      document.getElementById('authEmail').value   = email;
      document.getElementById('authConfirm').value = '';
      resetRateLimit();
      return;
    }

    _session = data;
    resetRateLimit();
    const profile = await fetchProfile(data.user.id, data.access_token);

    if (!profile) { await createProfile(data.user.id, email, 'user', 'pending', data.access_token); showPendingScreen(email); return; }
    if (profile.status === 'pending')  { showPendingScreen(email); return; }
    if (profile.status === 'rejected') { _session = null; showAuthError('Your account access has been rejected. Contact the administrator.'); return; }
    if (profile.status === 'approved') { _userProfile = profile; showApp(data); }
  } catch {
    showAuthError('Network error. Check your connection.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = (modeAtSubmit === 'login' ? 'Sign In' : modeAtSubmit === 'signup' ? 'Request Access' : 'Admin Sign In') +
      ' <svg width="13" height="13"><use href="#icon-arrow"/></svg>';
  }
}

/* ════════════════════════════════════════════
   PROFILE HELPERS
════════════════════════════════════════════ */
async function fetchProfile(userId, token) {
  try {
    const res = await fetch(_c + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&limit=1', { headers: _headers(token) });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch { return null; }
}
async function createProfile(userId, email, role, status, token) {
  try {
    await fetch(_c + '/rest/v1/profiles', {
      method: 'POST',
      headers: { ..._headers(token), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ id: userId, email, role, status })
    });
  } catch {}
}

/* ════════════════════════════════════════════
   SCREENS: APP / PENDING / ADMIN
════════════════════════════════════════════ */
function showApp(session) {
  _session = session;
  const isGuest = !session;
  const email    = session ? session.user.email : 'Guest';
  const initials = session ? email.slice(0, 2).toUpperCase() : '?';

  document.getElementById('userAvatar').textContent    = initials;
  document.getElementById('dropdownAvatar').textContent = initials;
  document.getElementById('dropdownEmail').textContent  = isGuest ? 'Not signed in' : email;
  const rawName = isGuest ? 'Guest' : (email.split('@')[0] || 'there').split(/[.\d]/)[0] || 'there';
  const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  document.getElementById('dropdownName').textContent = isGuest ? 'Browsing as Guest' : 'Hi, ' + displayName + '!';

  // Hide write actions from guests — respect admin guest permissions
  document.getElementById('addPanel').style.display = (isGuest && !_guestAddSnippet) ? 'none' : '';

  // Hide Quick Notes from guests unless admin has enabled it
  const navNotes   = document.getElementById('navNotes');
  const notesPanel = document.getElementById('notesPanel');
  if (navNotes) navNotes.style.display = (isGuest && !_guestNotes) ? 'none' : '';
  if (notesPanel && isGuest && !_guestNotes) {
    notesPanel.classList.remove('visible');
    // If they were on the notes panel, redirect to snippets
    if (navNotes && navNotes.classList.contains('active')) {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.getElementById('navSnippets').classList.add('active');
      document.getElementById('snippetsPanel').style.display = '';
      document.querySelector('.topbar-page-title').innerHTML = 'Snippets <span>/ Library</span>';
    }
  }

  showScreen('app');
  fetchSnippets();
  resetInactivityTimer();
}

function showPendingScreen(email) {
  document.getElementById('pendingEmail').textContent = email || '';
  showScreen('pendingScreen');
  resetInactivityTimer();
}

async function showAdminPortal() {
  document.getElementById('adminEmail').textContent = _session.user.email;
  showScreen('adminPortal');
  loadAdminData();
  resetInactivityTimer();
}

/* ════════════════════════════════════════════
   ADMIN — LOCK / UNLOCK
════════════════════════════════════════════ */
async function loadAdminData() {
  await Promise.all([loadSiteLock(), loadAllUsers()]);
}

async function loadSiteLock() {
  try {
    const res = await fetch('/api/admin/site-settings', { headers: _adminHeaders(_session.access_token) });
    const [row] = await res.json();
    const unlocked = row ? !row.locked : false;
    updateLockUI(unlocked);
    updateGuestFeaturesUI(unlocked, row ? !!row.guest_notes : false, row ? !!row.guest_add_snippet : false);
  } catch { updateLockUI(false); updateGuestFeaturesUI(false, false, false); }
}

function updateLockUI(unlocked) {
  const toggle = document.getElementById('siteUnlocked');
  const dot    = document.getElementById('lockStatusDot');
  const text   = document.getElementById('lockStatusText');
  const label  = document.getElementById('toggleLabel');
  const title  = document.getElementById('lockTitle');
  const desc   = document.getElementById('lockDesc');
  toggle.checked = unlocked;
  if (unlocked) {
    dot.className     = 'lock-status-dot unlocked';
    text.textContent  = 'Public Access';
    label.textContent = 'Open';
    title.textContent = '🔓 Site Unlocked';
    desc.textContent  = 'The site is publicly accessible — no login required.';
  } else {
    dot.className     = 'lock-status-dot locked';
    text.textContent  = 'Login Required';
    label.textContent = 'Locked';
    title.textContent = '🔒 Site Locked';
    desc.textContent  = 'The site requires login. Only approved users can access it.';
  }
  // Sync guest features section dimming
  updateGuestFeaturesUI(unlocked,
    document.getElementById('guestNotes')      ? document.getElementById('guestNotes').checked      : false,
    document.getElementById('guestAddSnippet') ? document.getElementById('guestAddSnippet').checked : false
  );
}

function updateGuestFeaturesUI(siteUnlocked, guestNotes, guestAddSnippet) {
  const noteToggle    = document.getElementById('guestNotes');
  const snippetToggle = document.getElementById('guestAddSnippet');
  const noteLabel     = document.getElementById('guestNotesLabel');
  const snippetLabel  = document.getElementById('guestAddSnippetLabel');
  const noteCard      = document.getElementById('gfCardNotes');
  const snippetCard   = document.getElementById('gfCardSnippet');
  const warningNote   = document.getElementById('guestFeaturesNote');

  if (noteToggle)    noteToggle.checked    = guestNotes;
  if (snippetToggle) snippetToggle.checked = guestAddSnippet;
  if (noteLabel)     noteLabel.textContent    = guestNotes      ? 'On'  : 'Off';
  if (snippetLabel)  snippetLabel.textContent = guestAddSnippet ? 'On'  : 'Off';

  // Dim cards and show warning if site is locked (settings are irrelevant when locked)
  const locked = !siteUnlocked;
  if (noteCard)    noteCard.classList.toggle('disabled-card', locked);
  if (snippetCard) snippetCard.classList.toggle('disabled-card', locked);
  if (warningNote) warningNote.classList.toggle('show', locked);
}

async function toggleGuestFeature(field, value) {
  const labelId = field === 'guest_notes' ? 'guestNotesLabel' : 'guestAddSnippetLabel';
  document.getElementById(labelId).textContent = value ? 'On' : 'Off';
  try {
    const body = {};
    body[field] = value;
    const res = await fetch('/api/admin/site-settings', {
      method: 'PATCH',
      headers: _adminHeaders(_session.access_token),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error();
    const label = field === 'guest_notes' ? 'Quick Notes' : 'Add Snippet';
    showToast((value ? '✓ ' : '✗ ') + label + (value ? ' enabled for guests' : ' disabled for guests'), 'success');
  } catch {
    // revert on failure
    const el = document.getElementById(field === 'guest_notes' ? 'guestNotes' : 'guestAddSnippet');
    if (el) { el.checked = !value; document.getElementById(labelId).textContent = !value ? 'On' : 'Off'; }
    showToast('✗ Failed to update guest permissions', 'error');
  }
}

async function toggleSiteLock() {
  const unlocked = document.getElementById('siteUnlocked').checked;
  updateLockUI(unlocked);
  try {
    const res = await fetch('/api/admin/site-settings', {
      method: 'PATCH',
      headers: _adminHeaders(_session.access_token),
      body: JSON.stringify({ locked: !unlocked })
    });
    if (!res.ok) throw new Error();
    showToast(unlocked ? '🔓 Site unlocked — now public' : '🔒 Site locked — login required', 'success');
  } catch {
    updateLockUI(!unlocked);
    showToast('✗ Failed to update site settings', 'error');
  }
}

/* ════════════════════════════════════════════
   ADMIN — USER MANAGEMENT
════════════════════════════════════════════ */
async function loadAllUsers() {
  const queueEl = document.getElementById('userQueue');
  queueEl.innerHTML = '<div class="empty-queue"><div class="eq-icon">⏳</div><p>Loading users...</p></div>';
  try {
    const res = await fetch('/api/admin/users', { headers: _adminHeaders(_session.access_token) });
    if (!res.ok) throw new Error();
    _allUsers = await res.json();
    updateStats();
    renderUsers(_currentFilter);
  } catch {
    queueEl.innerHTML = '<div class="empty-queue"><div class="eq-icon">⚠</div><p>Failed to load users.</p></div>';
  }
}

function updateStats() {
  document.getElementById('statPending').textContent  = _allUsers.filter(u => u.status === 'pending').length;
  document.getElementById('statApproved').textContent = _allUsers.filter(u => u.status === 'approved').length;
  document.getElementById('statRejected').textContent = _allUsers.filter(u => u.status === 'rejected').length;
}

function filterUsers(f) {
  _currentFilter = f;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === f));
  renderUsers(f);
}

function renderUsers(filter) {
  const list = filter === 'all' ? _allUsers : _allUsers.filter(u => u.status === filter);
  const queueEl = document.getElementById('userQueue');
  if (!list.length) {
    const msgs = { pending:'No pending approvals.', approved:'No approved users.', rejected:'No rejected users.', all:'No users found.' };
    queueEl.innerHTML = '<div class="empty-queue"><div class="eq-icon">✓</div><p>' + (msgs[filter]||'No users.') + '</p></div>';
    return;
  }
  queueEl.innerHTML = list.map(u => {
    const actions = u.status === 'pending'
      ? `<button class="btn-approve" data-uid="${u.id}" data-action="approve">✓ Approve</button>
         <button class="btn-reject"  data-uid="${u.id}" data-action="reject">✗ Reject</button>`
      : u.status === 'approved'
      ? `<button class="btn-revoke"  data-uid="${u.id}" data-action="reject">Revoke</button>`
      : `<button class="btn-approve" data-uid="${u.id}" data-action="approve">Restore</button>`;
    return `<div class="user-card">
      <div class="user-info">
        <div class="user-email">${escHtml(u.email)}</div>
        <div class="user-meta">Joined ${relTime(u.created_at)}</div>
      </div>
      <span class="user-status-badge ${u.status}">${u.status}</span>
      <div class="user-actions">${actions}</div>
    </div>`;
  }).join('');
}

async function updateUserStatus(userId, status) {
  try {
    const res = await fetch('/api/admin/users/' + encodeURIComponent(userId), {
      method: 'PATCH',
      headers: _adminHeaders(_session.access_token),
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error();
    const u = _allUsers.find(x => x.id === userId);
    if (u) u.status = status;
    updateStats();
    renderUsers(_currentFilter);
    showToast(status === 'approved' ? '✓ User approved' : '✗ User ' + status, status === 'approved' ? 'success' : '');
  } catch { showToast('✗ Failed to update user', 'error'); }
}

/* ════════════════════════════════════════════
   SIGN OUT
════════════════════════════════════════════ */
function signOut() {
  _session = _userProfile = null;
  _siteUnlocked = false;
  snippets = [];
  // Reset delta-fetch cursor so the next login fetches all snippets from scratch,
  // not just rows newer than the previous session's last sync.
  _lastSyncTime = null;
  clearTimeout(_inactivityTimer);
  closeDropdown();
  document.getElementById('appContainer').classList.remove('visible');
  document.getElementById('adminPortal').classList.remove('active');
  document.getElementById('authEmail').value    = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authConfirm').value  = '';
  document.getElementById('adminKey').value     = '';
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authNotice').style.display = 'none';
  switchTab('login');
  showScreen('authScreen');
}

function adminSignOut() {
  _session = _userProfile = null;
  _allUsers = [];
  document.getElementById('adminPortal').classList.remove('active');
  showScreen('authScreen');
  switchTab('admin');
}

/* ════════════════════════════════════════════
   SNIPPETS — FETCH / SAVE / DELETE
════════════════════════════════════════════ */
async function fetchSnippets() {
  try {
    const token = _session ? _session.access_token : _k;

    // When no session (site unlocked / public mode) only fetch publicly shared snippets.
    // Authenticated users fetch their own snippets via RLS as normal.
    const publicFilter = !_session ? '&is_public=eq.true' : '';
    const deltaFilter  = _lastSyncTime ? `&created_at=gt.${encodeURIComponent(_lastSyncTime)}` : '';

    const res = await fetch(
      _c + '/rest/v1/snippets?order=created_at.desc' + publicFilter + deltaFilter,
      { headers: _headers(token) }
    );

    if (_session && res.status === 401) { signOut(); return; }
    if (!res.ok) throw new Error();

    const fresh = await res.json();
    fresh.forEach(s => { s.lineCount = s.code.split('\n').length; });

    if (_lastSyncTime && fresh.length > 0) {
      snippets = [...fresh, ...snippets];
    } else if (!_lastSyncTime) {
      snippets = fresh;
    }

    if (snippets.length > 0) _lastSyncTime = snippets[0].created_at;

    setStatus('synced', 'connected');
    renderSnippets();
  } catch { setStatus('connection error', 'error'); }
}

async function saveSnippet() {
  const name     = document.getElementById('snippetName').value.trim();
  const langSelect = document.getElementById('snippetLang');
  const customLangInput = document.getElementById('customLangInput');
  const language = langSelect.value === 'custom'
    ? (customLangInput.value.trim() || 'Custom')
    : langSelect.value;
  const code     = document.getElementById('snippetCode').value.trim();
  if (!name)    { showToast('⚠ Give your snippet a name', 'error'); return; }
  if (!code)    { showToast('⚠ Code cannot be empty', 'error'); return; }
  if (!_session){ showToast('⚠ Sign in to save snippets', 'error'); return; }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;

  // ── EDIT MODE — PATCH existing row ──────────────────────────────────────
  if (_editingId) {
    btn.innerHTML = '<span class="spinner" style="border-top-color:#0a0a0a"></span> Updating...';
    try {
      const res = await fetch(_c + '/rest/v1/snippets?id=eq.' + _editingId, {
        method: 'PATCH',
        headers: _headers(_session.access_token),
        body: JSON.stringify({ name, language, code, tags: _currentTags })
      });
      if (!res.ok) throw new Error();
      // Update the in-memory record so the grid reflects changes instantly.
      const idx = snippets.findIndex(s => s.id === _editingId);
      if (idx !== -1) {
        snippets[idx] = { ...snippets[idx], name, language, code, tags: _currentTags,
                          lineCount: code.split('\n').length };
      }
      renderSnippets();
      showToast('✓ Snippet updated!', 'success');
      cancelEdit();
    } catch { showToast('✗ Failed to update', 'error'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="13" height="13"><use href="#icon-save"/></svg> Update Snippet';
    }
    return;
  }

  // ── CREATE MODE — POST new row ───────────────────────────────────────────
  btn.innerHTML = '<span class="spinner" style="border-top-color:#0a0a0a"></span> Saving...';
  try {
    const res = await fetch(_c + '/rest/v1/snippets', {
      method: 'POST',
      headers: _headers(_session.access_token),
      body: JSON.stringify({ name, language, code, user_id: _session.user.id, tags: _currentTags })
    });
    if (!res.ok) throw new Error();
    const [saved] = await res.json();
    // Pre-calculate lineCount so renderSnippets never has to split on keystrokes.
    saved.lineCount = saved.code.split('\n').length;
    // Advance the delta-fetch cursor so auto-refresh won't re-download this row.
    _lastSyncTime = saved.created_at;
    snippets.unshift(saved);
    renderSnippets();
    document.getElementById('snippetName').value = '';
    document.getElementById('snippetCode').value = '';
    _currentTags = [];
    renderTagChips();
    showToast('✓ Snippet saved!', 'success');
  } catch { showToast('✗ Failed to save', 'error'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="13" height="13"><use href="#icon-save"/></svg> Save Snippet';
  }
}

async function deleteSnippet(id) {
  if (!_session) { showToast('⚠ Sign in to delete snippets', 'error'); return; }
  try {
    await fetch(_c + '/rest/v1/snippets?id=eq.' + id, { method:'DELETE', headers: _headers(_session.access_token) });
    snippets = snippets.filter(s => s.id !== id);
    // If the deleted snippet was being edited, reset the panel.
    if (_editingId === id) cancelEdit();
    renderSnippets();
    showToast('Snippet deleted', '');
  } catch { showToast('✗ Delete failed', 'error'); }
}

function editSnippet(id) {
  const s = snippets.find(x => x.id === id);
  if (!s) return;

  // Populate the panel fields with the snippet's current data.
  document.getElementById('snippetName').value = s.name;
  document.getElementById('snippetCode').value = s.code;
  const langSelect = document.getElementById('snippetLang');
  // Match the stored language value; fall back to 'other' if not in list.
  const opt = [...langSelect.options].find(o => o.value === s.language);
  langSelect.value = opt ? s.language : 'other';

  // Populate tags
  _currentTags = Array.isArray(s.tags) ? [...s.tags] : [];
  renderTagChips();
  _editingId = id;
  const panel = document.getElementById('addPanel');
  panel.classList.add('editing');
  document.getElementById('panelLabel').textContent = '✏ Editing — ' + s.name;
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.innerHTML = '<svg width="13" height="13"><use href="#icon-edit"/></svg> Update Snippet';

  // Scroll the panel into view and focus the name field.
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('snippetName').focus(), 350);
}

function cancelEdit() {
  _editingId = null;
  _currentTags = [];
  renderTagChips();
  document.getElementById('addPanel').classList.remove('editing');
  document.getElementById('panelLabel').textContent = 'New Snippet';
  document.getElementById('snippetName').value = '';
  document.getElementById('snippetCode').value = '';
  document.getElementById('snippetLang').value = 'python';
  const customLangInput = document.getElementById('customLangInput');
  customLangInput.value = '';
  customLangInput.style.display = 'none';
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = false;
  saveBtn.innerHTML = '<svg width="13" height="13"><use href="#icon-save"/></svg> Save Snippet';
}

/* ════════════════════════════════════════════
   TAG SYSTEM
════════════════════════════════════════════ */
let _currentTags   = [];   // tags being typed in the add/edit panel
let _activeTagFilter = null; // currently filtered tag

const TAG_COLORS = ['tag-0','tag-1','tag-2','tag-3','tag-4','tag-5'];
function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

function renderTagChips() {
  const container = document.getElementById('tagChipsContainer');
  container.innerHTML = '';
  _currentTags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip ' + tagColor(t);
    chip.innerHTML = t + '<button class="tag-chip-remove" onclick="removeTag(' + i + ')">×</button>';
    container.appendChild(chip);
  });
}

window.removeTag = function(idx) {
  _currentTags.splice(idx, 1);
  renderTagChips();
};

function addTag(val) {
  const t = val.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 20);
  if (!t || _currentTags.includes(t) || _currentTags.length >= 6) return;
  _currentTags.push(t);
  renderTagChips();
}

// Tag input key handling
document.getElementById('tagTextField').addEventListener('keydown', e => {
  const v = e.target.value;
  if ((e.key === 'Enter' || e.key === ',') && v.trim()) {
    e.preventDefault();
    addTag(v);
    e.target.value = '';
  }
  if (e.key === 'Backspace' && !v && _currentTags.length) {
    _currentTags.pop();
    renderTagChips();
  }
});
document.getElementById('tagTextField').addEventListener('blur', e => {
  if (e.target.value.trim()) { addTag(e.target.value); e.target.value = ''; }
});

function renderTagFilterBar() {
  // Collect all unique tags across all snippets
  const allTags = [...new Set(snippets.flatMap(s => s.tags || []))];
  const bar = document.getElementById('tagFilterBar');
  if (!allTags.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'tag-filter-chip tf-all' + (_activeTagFilter ? '' : ' active');
  allBtn.textContent = 'All';
  allBtn.onclick = () => { _activeTagFilter = null; renderTagFilterBar(); renderSnippets(); };
  bar.appendChild(allBtn);

  allTags.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tag-filter-chip ' + tagColor(t) + (_activeTagFilter === t ? ' active' : '');
    btn.textContent = t;
    btn.onclick = () => { _activeTagFilter = t; renderTagFilterBar(); renderSnippets(); };
    bar.appendChild(btn);
  });

  if (_activeTagFilter) {
    const clr = document.createElement('button');
    clr.className = 'tag-filter-clear';
    clr.textContent = '✕ Clear filter';
    clr.onclick = () => { _activeTagFilter = null; renderTagFilterBar(); renderSnippets(); };
    bar.appendChild(clr);
  }
}

/* ════════════════════════════════════════════
   SHARE MODAL
════════════════════════════════════════════ */
let _shareSnippetId = null;

window.openShareModal = function(id) {
  _shareSnippetId = id;
  const s = snippets.find(x => x.id === id);
  if (!s) return;
  document.getElementById('sharePublicToggle').checked = !!s.is_public;
  updateShareUI(s);
  document.getElementById('shareModalOverlay').classList.add('open');
};

window.closeShareModal = function() {
  document.getElementById('shareModalOverlay').classList.remove('open');
  _shareSnippetId = null;
};

function updateShareUI(s) {
  const isPublic = !!s.is_public;
  document.getElementById('shareToggleSub').textContent = isPublic
    ? 'Public — anyone with the link can view this snippet'
    : 'Toggle on to generate a shareable link';
  const linkRow = document.getElementById('shareLinkRow');
  if (isPublic && s.public_id) {
    linkRow.style.display = '';
    document.getElementById('shareLinkUrl').textContent = location.origin + location.pathname + '?s=' + s.public_id;
  } else {
    linkRow.style.display = 'none';
  }
}

window.handleShareToggle = async function() {
  const s = snippets.find(x => x.id === _shareSnippetId);
  if (!s || !_session) return;
  const isPublic = document.getElementById('sharePublicToggle').checked;
  try {
    const res = await fetch(_c + '/rest/v1/snippets?id=eq.' + s.id, {
      method: 'PATCH',
      headers: _headers(_session.access_token),
      body: JSON.stringify({ is_public: isPublic })
    });
    if (!res.ok) throw new Error();
    s.is_public = isPublic;
    updateShareUI(s);
    renderSnippets();
    showToast(isPublic ? '🔗 Snippet is now public' : '🔒 Snippet is now private', 'success');
  } catch { showToast('✗ Failed to update sharing', 'error'); }
};

window.copyShareLink = function() {
  const url = document.getElementById('shareLinkUrl').textContent;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('shareLinkCopyBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
};

// Close share modal on overlay click
document.getElementById('shareModalOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeShareModal();
});

/* ════════════════════════════════════════════
   PUBLIC VIEW — check URL on load
════════════════════════════════════════════ */
async function checkPublicView() {
  const params = new URLSearchParams(location.search);
  const publicId = params.get('s');
  if (!publicId) return false;

  document.getElementById('publicViewScreen').classList.add('active');
  try {
    const res = await fetch(
      _c + '/rest/v1/snippets?public_id=eq.' + encodeURIComponent(publicId) + '&is_public=eq.true&limit=1',
      { headers: { 'apikey': _k, 'Authorization': 'Bearer ' + _k } }
    );
    const rows = await res.json();
    if (!rows.length) {
      document.getElementById('pubName').textContent = 'Snippet not found';
      document.getElementById('pubCode').textContent = 'This snippet may have been made private or does not exist.';
      return true;
    }
    const s = rows[0];
    document.getElementById('pubName').textContent = s.name;
    document.getElementById('pubCode').textContent  = s.code;

    const meta = document.getElementById('pubMeta');
    meta.innerHTML = '';
    [s.language, relTime(s.created_at)].forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'pub-meta-chip'; chip.textContent = t;
      meta.appendChild(chip);
    });
    if (s.tags && s.tags.length) {
      s.tags.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'pub-meta-chip card-tag-chip ' + tagColor(t);
        chip.textContent = t; meta.appendChild(chip);
      });
    }
    document.getElementById('pubCopyBtn').onclick = () => {
      navigator.clipboard.writeText(s.code).then(() => {
        document.getElementById('pubCopyBtn').textContent = '✓ Copied!';
        setTimeout(() => {
          document.getElementById('pubCopyBtn').innerHTML =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Code';
        }, 2000);
      });
    };
  } catch {
    document.getElementById('pubName').textContent = 'Error loading snippet';
  }
  return true;
}

/* ════════════════════════════════════════════
   SNIPPETS — RENDER (pins, tags, share)
════════════════════════════════════════════ */
function renderSnippets() {
  const query = (document.getElementById('searchInput').value || '').toLowerCase();
  let filtered = snippets.filter(s =>
    (s.name.toLowerCase().includes(query) || s.language.toLowerCase().includes(query) ||
    (s.tags || []).some(t => t.includes(query)))
  );
  if (_activeTagFilter) filtered = filtered.filter(s => (s.tags || []).includes(_activeTagFilter));

  // Pinned first
  filtered.sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));

  document.getElementById('countBadge').textContent = snippets.length + (snippets.length === 1 ? ' snippet' : ' snippets');
  const list = document.getElementById('snippetsList');

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>${snippets.length ? 'No matches found.' : 'No snippets yet.<br>Save your first code snippet above.'}</p>
    </div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  filtered.forEach(s => {
    const card = document.createElement('div');
    card.className = 'snippet-card' + (s.is_pinned ? ' pinned' : '');
    card.dataset.id = s.id;

    // --- Card header ---
    const header = document.createElement('div');
    header.className = 'card-header';

    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'display:flex;align-items:center;gap:7px;overflow:hidden;';
    if (s.is_pinned) {
      const dot = document.createElement('div');
      dot.className = 'pin-indicator';
      nameWrap.appendChild(dot);
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'snippet-name';
    nameEl.textContent = s.name;
    nameWrap.appendChild(nameEl);

    const headerRight = document.createElement('div');
    headerRight.className = 'card-header-right';

    const langBadge = document.createElement('div');
    langBadge.className = 'lang-badge';
    langBadge.textContent = s.language;

    // Public badge
    if (s.is_public) {
      const pubBadge = document.createElement('span');
      pubBadge.className = 'share-public-badge';
      pubBadge.textContent = '🔗';
      pubBadge.title = 'Publicly shared';
      headerRight.appendChild(pubBadge);
    }

    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn js-expand';
    expandBtn.setAttribute('aria-label', 'Expand snippet');
    expandBtn.innerHTML = '<svg><use href="#icon-chevron"/></svg>';

    headerRight.append(langBadge, expandBtn);
    header.append(nameWrap, headerRight);

    // --- Tags row ---
    const tagsRow = document.createElement('div');
    tagsRow.className = 'card-tags';
    if (s.tags && s.tags.length) {
      s.tags.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'card-tag-chip ' + tagColor(t);
        chip.textContent = t;
        chip.onclick = (e) => { e.stopPropagation(); _activeTagFilter = t; renderTagFilterBar(); renderSnippets(); };
        chip.style.cursor = 'pointer';
        tagsRow.appendChild(chip);
      });
    }

    // --- Code preview ---
    const codePreview = document.createElement('div');
    codePreview.className = 'code-preview';
    codePreview.textContent = s.code;

    // --- Expanded meta ---
    const expandedBody = document.createElement('div');
    expandedBody.className = 'card-expanded-body';
    const expandedMeta = document.createElement('div');
    expandedMeta.className = 'expanded-meta';
    [s.language, s.lineCount + ' lines', relTime(s.created_at)].forEach(txt => {
      const chip = document.createElement('div');
      chip.className = 'meta-chip';
      chip.textContent = txt;
      expandedMeta.appendChild(chip);
    });
    expandedBody.appendChild(expandedMeta);

    // --- Card footer ---
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const timeEl = document.createElement('span');
    timeEl.className = 'card-time';
    timeEl.textContent = relTime(s.created_at);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-icon js-copy';
    copyBtn.dataset.id = s.id;
    copyBtn.setAttribute('aria-label', 'Copy snippet');
    copyBtn.innerHTML = '<svg><use href="#icon-copy"/></svg>';
    actions.appendChild(copyBtn);

    if (_session) {
      // Pin
      const pinBtn = document.createElement('button');
      pinBtn.className = 'btn-icon js-pin' + (s.is_pinned ? ' pinned' : '');
      pinBtn.dataset.id = s.id;
      pinBtn.setAttribute('aria-label', s.is_pinned ? 'Unpin snippet' : 'Pin snippet');
      pinBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v3.76z"/></svg>';
      actions.appendChild(pinBtn);

      // Share
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn-icon js-share';
      shareBtn.dataset.id = s.id;
      shareBtn.setAttribute('aria-label', 'Share snippet');
      shareBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
      actions.appendChild(shareBtn);

      // Edit
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-icon js-edit';
      editBtn.dataset.id = s.id;
      editBtn.setAttribute('aria-label', 'Edit snippet');
      editBtn.innerHTML = '<svg><use href="#icon-edit"/></svg>';
      actions.appendChild(editBtn);

      // Delete
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon del js-delete';
      delBtn.dataset.id = s.id;
      delBtn.setAttribute('aria-label', 'Delete snippet');
      delBtn.innerHTML = '<svg><use href="#icon-trash"/></svg>';
      actions.appendChild(delBtn);
    }

    footer.append(timeEl, actions);
    card.append(header, tagsRow, codePreview, expandedBody, footer);
    frag.appendChild(card);
  });

  list.replaceChildren(frag);
  renderTagFilterBar();
}

function copySnippet(id) {
  const s = snippets.find(x => x.id === id);
  if (!s) return;
  navigator.clipboard.writeText(s.code).then(() => {
    const btn = document.querySelector(`.js-copy[data-id="${id}"]`);
    if (!btn) return;
    btn.classList.add('copy-ok');
    btn.innerHTML = '<svg><use href="#icon-check"/></svg>';
    setTimeout(() => {
      btn.classList.remove('copy-ok');
      btn.innerHTML = '<svg><use href="#icon-copy"/></svg>';
    }, 2000);
  }).catch(() => showToast('✗ Copy failed', 'error'));
}

async function pinSnippet(id) {
  if (!_session) return;
  const s = snippets.find(x => x.id === id);
  if (!s) return;
  const newVal = !s.is_pinned;
  try {
    const res = await fetch(_c + '/rest/v1/snippets?id=eq.' + id, {
      method: 'PATCH',
      headers: _headers(_session.access_token),
      body: JSON.stringify({ is_pinned: newVal })
    });
    if (!res.ok) throw new Error();
    s.is_pinned = newVal;
    renderSnippets();
    showToast(newVal ? '📌 Snippet pinned' : 'Snippet unpinned', 'success');
  } catch { showToast('✗ Failed to pin snippet', 'error'); }
}

/* ════════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
function setStatus(text, type) {
  const el  = document.getElementById('statusText');
  const dot = document.getElementById('statusDot');
  if (el)  el.textContent = text;
  if (dot) dot.className  = 'synced-dot ' + (type || '');
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (type || '') + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function relTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff/60)   + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600)  + 'h ago';
  if (diff < 604800)return Math.floor(diff/86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}

/* ════════════════════════════════════════════
   EVENT DELEGATION — all interactions
════════════════════════════════════════════ */

// Auth tabs
document.querySelector('.tab-switcher').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  if (btn.id === 'tabLogin')  switchTab('login');
  if (btn.id === 'tabSignup') switchTab('signup');
  if (btn.id === 'tabAdmin')  switchTab('admin');
});

// Auth form — Enter key
['authEmail','authPassword','authConfirm','adminKey'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
    if (id === 'authEmail') el.addEventListener('input', () => sanitizeInput(el));
  }
});

// Auth button
document.getElementById('authBtn').addEventListener('click', handleAuth);

// Pending back
document.getElementById('pendingBack').addEventListener('click', signOut);

// Admin toggle lock
document.getElementById('siteUnlocked').addEventListener('change', toggleSiteLock);
document.getElementById('guestNotes').addEventListener('change', e => toggleGuestFeature('guest_notes', e.target.checked));
document.getElementById('guestAddSnippet').addEventListener('change', e => toggleGuestFeature('guest_add_snippet', e.target.checked));

// Admin filter tabs (event delegation)
document.getElementById('filterTabs').addEventListener('click', e => {
  const btn = e.target.closest('.filter-tab');
  if (btn) filterUsers(btn.dataset.filter);
});

// Admin user queue — approve / reject / revoke (event delegation)
document.getElementById('userQueue').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const uid    = btn.dataset.uid;
  const action = btn.dataset.action;
  if (action === 'approve') updateUserStatus(uid, 'approved');
  if (action === 'reject')  updateUserStatus(uid, 'rejected');
});

// Admin sign out
document.getElementById('adminSignOutBtn').addEventListener('click', adminSignOut);

// Save snippet
document.getElementById('saveBtn').addEventListener('click', saveSnippet);

// Cancel edit
document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);

// Search
document.getElementById('searchInput').addEventListener('input', renderSnippets);

// Tab key in code area → insert spaces
document.getElementById('snippetCode').addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target, s = ta.selectionStart;
    ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = s + 2;
  }
});

// Snippet grid — expand / copy / pin / share / edit / delete (event delegation)
document.getElementById('snippetsList').addEventListener('click', e => {
  const copyBtn   = e.target.closest('.js-copy');
  const deleteBtn = e.target.closest('.js-delete');
  const editBtn   = e.target.closest('.js-edit');
  const expandBtn = e.target.closest('.js-expand');
  const pinBtn    = e.target.closest('.js-pin');
  const shareBtn  = e.target.closest('.js-share');
  const card      = e.target.closest('.snippet-card');
  if (!card) return;

  if (copyBtn)   { e.stopPropagation(); copySnippet(copyBtn.dataset.id); return; }
  if (deleteBtn) { e.stopPropagation(); deleteSnippet(deleteBtn.dataset.id); return; }
  if (editBtn)   { e.stopPropagation(); editSnippet(editBtn.dataset.id); return; }
  if (expandBtn) { e.stopPropagation(); card.classList.toggle('expanded'); return; }
  if (pinBtn)    { e.stopPropagation(); pinSnippet(pinBtn.dataset.id); return; }
  if (shareBtn)  { e.stopPropagation(); openShareModal(shareBtn.dataset.id); return; }
  card.classList.toggle('expanded');
});

/* ════════════════════════════════════════════
   MOBILE SIDEBAR
════════════════════════════════════════════ */
function toggleMobileSidebar() {
  document.querySelector('.sidebar').classList.toggle('mob-open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}
window.toggleMobileSidebar = toggleMobileSidebar;
function closeMobileSidebar() {
  document.querySelector('.sidebar').classList.remove('mob-open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}
window.closeMobileSidebar = closeMobileSidebar;

// Sidebar nav active state + panel switching
document.querySelector('.sidebar').addEventListener('click', e => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  e.preventDefault();
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  closeMobileSidebar(); // close drawer on mobile after selection

  const snippetsPanel  = document.getElementById('snippetsPanel');
  const clipboardPanel = document.getElementById('clipboardPanel');
  const notesPanel     = document.getElementById('notesPanel');
  const pageTitle      = document.querySelector('.topbar-page-title');

  // Hide all panels first
  snippetsPanel.style.display = 'none';
  clipboardPanel.classList.remove('visible');
  notesPanel.classList.remove('visible');

  if (item.id === 'navClipboard') {
    clipboardPanel.classList.add('visible');
    pageTitle.innerHTML = 'Online Clipboard <span>/ Share & Retrieve</span>';
  } else if (item.id === 'navNotes') {
    notesPanel.classList.add('visible');
    pageTitle.innerHTML = 'Quick Notes <span>/ Scratchpad</span>';
  } else {
    snippetsPanel.style.display = '';
    pageTitle.innerHTML = 'Snippets <span>/ Library</span>';
  }
});

// Account dropdown
const userBtn         = document.getElementById('userBtn');
const accountDropdown = document.getElementById('accountDropdown');
const overlay         = document.getElementById('overlay');

function openDropdown()  { accountDropdown.classList.add('open'); userBtn.setAttribute('aria-expanded','true'); }
function closeDropdown() { accountDropdown.classList.remove('open'); userBtn.setAttribute('aria-expanded','false'); }

userBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  accountDropdown.classList.contains('open') ? closeDropdown() : openDropdown();
});

// Close when clicking anywhere outside
document.addEventListener('click', (e) => {
  if (!userBtn.contains(e.target)) closeDropdown();
});

// Sign out
document.getElementById('dropdownSignOut').addEventListener('click', (e) => {
  e.stopPropagation();
  signOut();
});

/* ════════════════════════════════════════════
   AUTO-REFRESH (every 30s while logged in)
════════════════════════════════════════════ */
setInterval(() => {
  if (_session && document.getElementById('appContainer').classList.contains('visible')) fetchSnippets();
}, 30000);
setInterval(() => {
  if (document.getElementById('adminPortal').classList.contains('active')) loadAdminData();
}, 30000);

})();

/* ════════════════════════════════════════════
   ONLINE CLIPBOARD — Separate Supabase project
════════════════════════════════════════════ */
(function() {
'use strict';

const CB_URL = 'https://lcdawmpqybejybfetmpq.supabase.co';
const CB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZGF3bXBxeWJlanliZmV0bXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTc5ODEsImV4cCI6MjA4NzI5Mzk4MX0.k6gt-eEf69EIDKwtGSAZHalGWpeTf9v6k3J4rb-uvWc';

function cbHeaders() {
  return {
    'apikey': CB_KEY,
    'Authorization': 'Bearer ' + CB_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

/* ── OTP Generation — easy-to-type patterns ── */
const OTP_GENERATORS = [
  // Sequential: 1234, 8765, 3456
  () => { const s = Math.floor(Math.random()*6)+1; const d = Math.random()>0.5?1:-1; return [0,1,2,3].map(i=>((s+i*d+10)%10)).join(''); },
  // Pairs: 1122, 3344, 9900
  () => { const a=Math.floor(Math.random()*10), b=Math.floor(Math.random()*10); return `${a}${a}${b}${b}`; },
  // Mirror: 1221, 3443, 7887
  () => { const a=Math.floor(Math.random()*10), b=Math.floor(Math.random()*10); return `${a}${b}${b}${a}`; },
  // Alternating odd: 1357, 9753, 3179
  () => { const p=[1,3,5,7,9].sort(()=>Math.random()-0.5).slice(0,4); return p.join(''); },
  // Alternating even: 2468, 8642, 0246
  () => { const p=[0,2,4,6,8].sort(()=>Math.random()-0.5).slice(0,4); return p.join(''); },
  // Repeated quad: 1111, 4444, 7777 (rare, very memorable)
  () => { const d=Math.floor(Math.random()*10); return `${d}${d}${d}${d}`; },
];

async function generateOTP() {
  let otp, tries = 0;
  do {
    const gen = OTP_GENERATORS[Math.floor(Math.random()*OTP_GENERATORS.length)];
    otp = gen();
    // Check uniqueness among active (non-expired) entries
    try {
      const res = await fetch(
        CB_URL + '/rest/v1/clipboard_entries?otp=eq.' + otp +
        '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&select=otp&limit=1',
        { headers: cbHeaders() }
      );
      const rows = await res.json();
      if (!rows.length) break; // OTP is free
    } catch { break; }
    tries++;
  } while (tries < 10);
  return otp;
}

/* ── State ── */
let _cbMode       = 'text'; // 'text' | 'file'
let _cbFile       = null;
let _cbCurrentOtp = null;

/* ── Upload mode switching ── */
window.cbSwitchUploadMode = function(mode) {
  _cbMode = mode;
  document.getElementById('cbTabText').classList.toggle('active', mode === 'text');
  document.getElementById('cbTabFile').classList.toggle('active', mode === 'file');
  document.getElementById('cbTextMode').style.display = mode === 'text' ? '' : 'none';
  document.getElementById('cbFileMode').style.display = mode === 'file' ? '' : 'none';
  cbHideUploadError();
};

/* ── File input + drag-drop ── */
const dropZone = document.getElementById('cbDropZone');
const fileInput = document.getElementById('cbFileInput');

fileInput.addEventListener('change', () => { if (fileInput.files[0]) cbSetFile(fileInput.files[0]); });

dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) cbSetFile(e.dataTransfer.files[0]);
});

function cbSetFile(f) {
  if (f.size > 15 * 1024 * 1024) { cbShowUploadError('File must be under 15 MB.'); return; }
  _cbFile = f;
  document.getElementById('cbFileName').textContent = f.name;
  document.getElementById('cbFileChosen').classList.add('show');
  cbHideUploadError();
}

window.cbClearFile = function() {
  _cbFile = null;
  fileInput.value = '';
  document.getElementById('cbFileChosen').classList.remove('show');
};

/* ── Main upload handler ── */
window.cbUpload = async function() {
  cbHideUploadError();
  const btn = document.getElementById('cbUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-top-color:#0a0a0a"></span> Generating...';

  try {
    const otp = await generateOTP();

    if (_cbMode === 'text') {
      const text = document.getElementById('cbTextarea').value.trim();
      if (!text) { cbShowUploadError('Please paste some text first.'); return; }

      const res = await fetch(CB_URL + '/rest/v1/clipboard_entries', {
        method: 'POST',
        headers: cbHeaders(),
        body: JSON.stringify({ otp, content: text, type: 'text' })
      });
      if (!res.ok) throw new Error('Upload failed');
      cbShowOtp(otp);

    } else {
      if (!_cbFile) { cbShowUploadError('Please select a file first.'); return; }
      // Upload file to Supabase Storage
      cbShowProgress(0);
      const filePath = otp + '_' + Date.now() + '_' + _cbFile.name;
      const uploadRes = await fetch(
        CB_URL + '/storage/v1/object/clipboard-files/' + encodeURIComponent(filePath),
        {
          method: 'POST',
          headers: { 'apikey': CB_KEY, 'Authorization': 'Bearer ' + CB_KEY, 'Content-Type': _cbFile.type || 'application/octet-stream' },
          body: _cbFile
        }
      );
      cbShowProgress(70);
      if (!uploadRes.ok) throw new Error('File upload failed');
      const fileUrl = CB_URL + '/storage/v1/object/public/clipboard-files/' + encodeURIComponent(filePath);
      cbShowProgress(90);

      const dbRes = await fetch(CB_URL + '/rest/v1/clipboard_entries', {
        method: 'POST',
        headers: cbHeaders(),
        body: JSON.stringify({ otp, file_url: fileUrl, file_name: _cbFile.name, file_type: _cbFile.type, type: 'file' })
      });
      if (!dbRes.ok) throw new Error('DB insert failed');
      cbShowProgress(100);
      setTimeout(() => document.getElementById('cbProgress').classList.remove('show'), 600);
      cbShowOtp(otp);
    }
  } catch(e) {
    cbShowUploadError('Something went wrong. Please try again.');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M5 19h14"/></svg> Generate Code';
  }
};

function cbShowProgress(pct) {
  const bar = document.getElementById('cbProgress');
  bar.classList.add('show');
  document.getElementById('cbProgressBar').style.width  = pct + '%';
  document.getElementById('cbProgressText').textContent = pct + '%';
}

function cbShowOtp(otp) {
  _cbCurrentOtp = otp;
  const digitsEl = document.getElementById('cbOtpDigits');
  digitsEl.innerHTML = '';
  otp.split('').forEach(d => {
    const box = document.createElement('div');
    box.className = 'cb-otp-digit';
    box.textContent = d;
    digitsEl.appendChild(box);
  });
  const exp = new Date(Date.now() + 24*60*60*1000);
  document.getElementById('cbOtpExpiry').textContent =
    '⏱ Expires ' + exp.toLocaleString(undefined, { hour:'2-digit', minute:'2-digit', month:'short', day:'numeric' });

  // Generate QR code — encodes the retrieve page URL with the OTP prefilled
  const qrBox = document.getElementById('cbQrBox');
  qrBox.innerHTML = '';
  const qrUrl = location.origin + location.pathname + '?clip=' + otp;
  try {
    new QRCode(qrBox, {
      text: qrUrl,
      width: 128, height: 128,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch(e) {
    qrBox.style.display = 'none';
  }

  document.getElementById('cbOtpResult').classList.add('show');
  document.getElementById('cbUploadBtn').style.display = 'none';
}

window.cbCopyOtp = function() {
  if (!_cbCurrentOtp) return;
  navigator.clipboard.writeText(_cbCurrentOtp).then(() => {
    const btn = document.querySelector('.cb-btn-copy-otp');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Copied!';
    setTimeout(() => btn.innerHTML = orig, 2000);
  });
};

window.cbReset = function() {
  _cbCurrentOtp = null;
  _cbFile = null;
  document.getElementById('cbTextarea').value = '';
  document.getElementById('cbOtpResult').classList.remove('show');
  document.getElementById('cbUploadBtn').style.display = '';
  document.getElementById('cbFileChosen').classList.remove('show');
  document.getElementById('cbProgress').classList.remove('show');
  cbHideUploadError();
  cbSwitchUploadMode('text');
};

function cbShowUploadError(msg) {
  const el = document.getElementById('cbUploadError');
  el.textContent = msg; el.classList.add('show');
}
function cbHideUploadError() {
  document.getElementById('cbUploadError').classList.remove('show');
}

/* ── OTP Input boxes (retrieve side) ── */
window.cbOtpNext = function(el, idx) {
  // Keep only digits
  const val = el.value.replace(/\D/g,'');
  el.value  = val ? val[val.length-1] : '';
  el.classList.toggle('filled', !!el.value);
  cbHideRetrieveError();
  document.getElementById('cbRetrievedBox').classList.remove('show');
  if (el.value && idx < 3) document.getElementById('cbIn' + (idx+1)).focus();
};

window.cbOtpKey = function(e, idx) {
  if (e.key === 'Backspace' && !e.target.value && idx > 0) {
    document.getElementById('cbIn' + (idx-1)).focus();
  }
  if (e.key === 'Enter') cbRetrieve();
};

/* ── Retrieve handler ── */
window.cbRetrieve = async function() {
  const digits = [0,1,2,3].map(i => document.getElementById('cbIn'+i).value).join('');
  if (digits.length < 4) { cbShowRetrieveError('Please enter all 4 digits.'); return; }

  cbHideRetrieveError();
  document.getElementById('cbRetrievedBox').classList.remove('show');
  const btn = document.getElementById('cbRetrieveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-top-color:#0a0a0a"></span> Retrieving...';

  try {
    const now = new Date().toISOString();
    const res = await fetch(
      CB_URL + '/rest/v1/clipboard_entries?otp=eq.' + digits +
      '&expires_at=gt.' + encodeURIComponent(now) + '&limit=1',
      { headers: cbHeaders() }
    );
    if (!res.ok) throw new Error();
    const rows = await res.json();
    if (!rows.length) { cbShowRetrieveError('Code not found or expired. Double-check the digits.'); return; }

    const row = rows[0];
    const exp = new Date(row.expires_at);
    const expiresIn = Math.max(0, Math.round((exp - Date.now()) / 60000));
    const expiresStr = expiresIn > 60
      ? Math.round(expiresIn/60) + 'h remaining'
      : expiresIn + 'm remaining';

    document.getElementById('cbRetrievedExpiry').textContent = '⏱ ' + expiresStr;
    document.getElementById('cbRetrievedType').textContent   = row.type === 'file' ? 'FILE' : 'TEXT';

    const contentEl  = document.getElementById('cbRetrievedContent');
    const actionsEl  = document.getElementById('cbRetrievedActions');
    actionsEl.innerHTML = '';

    if (row.type === 'text') {
      contentEl.style.display = '';
      contentEl.textContent   = row.content;
      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'cb-btn-copy-content';
      copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Text';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(row.content).then(() => {
          copyBtn.innerHTML = '✓ Copied!';
          setTimeout(() => copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Text', 2000);
        });
      };
      actionsEl.appendChild(copyBtn);

    } else {
      contentEl.style.display = 'none';
      // Download link
      const dlBtn = document.createElement('a');
      dlBtn.className = 'cb-btn-dl';
      dlBtn.href      = row.file_url;
      dlBtn.download  = row.file_name || 'download';
      dlBtn.target    = '_blank';
      dlBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download ' + (row.file_name || 'File');
      actionsEl.appendChild(dlBtn);

      // File info
      const infoEl = document.createElement('div');
      infoEl.style.cssText = 'font-size:0.75rem;color:var(--muted);align-self:center;';
      infoEl.textContent = row.file_name || '';
      actionsEl.appendChild(infoEl);
    }

    document.getElementById('cbRetrievedBox').classList.add('show');

  } catch {
    cbShowRetrieveError('Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Retrieve Content';
  }
};

function cbShowRetrieveError(msg) {
  const el = document.getElementById('cbRetrieveError');
  el.textContent = msg; el.classList.add('show');
}
function cbHideRetrieveError() {
  document.getElementById('cbRetrieveError').classList.remove('show');
}

// Auto-fill retrieve OTP from QR code URL param ?clip=XXXX
(function() {
  const p = new URLSearchParams(location.search).get('clip');
  if (p && /^\d{4}$/.test(p)) {
    // Switch to clipboard panel and fill OTP boxes
    setTimeout(() => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.getElementById('navClipboard').classList.add('active');
      document.getElementById('snippetsPanel').style.display = 'none';
      document.getElementById('clipboardPanel').classList.add('visible');
      p.split('').forEach((d, i) => {
        const el = document.getElementById('cbIn' + i);
        if (el) { el.value = d; el.classList.add('filled'); }
      });
    }, 300);
  }
})();

/* ══════════════════════════════════════════
   QUICK NOTES — full logic
══════════════════════════════════════════ */
(function () {
  // ── State ────────────────────────────────
  const MAX_NOTES = 4;
  const notes = Array.from({ length: MAX_NOTES }, (_, i) => ({
    label: `Note ${i + 1}`,
    content: ''
  }));
  let activeNote = 0;
  let isFullscreen = false;

  // ── DOM refs ─────────────────────────────
  const textarea      = document.getElementById('notesTextarea');
  const statPill      = document.getElementById('notesStatPill');
  const editorWrap    = document.getElementById('notesEditorWrap');
  const tabs          = document.querySelectorAll('.notes-tab');
  const renameBtn     = document.getElementById('notesRenameBtn');
  const renameWrap    = document.getElementById('notesRenameWrap');
  const renameInput   = document.getElementById('notesRenameInput');
  const renameConfirm = document.getElementById('notesRenameConfirm');
  const renameCancel  = document.getElementById('notesRenameCancel');
  const copyBtn       = document.getElementById('notesCopyBtn');
  const downloadBtn   = document.getElementById('notesDownloadBtn');
  const clearBtn      = document.getElementById('notesClearBtn');
  const expandBtn     = document.getElementById('notesExpandBtn');

  // ── Helpers ──────────────────────────────
  function updateStats() {
    const text  = textarea.value;
    const chars = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    statPill.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
    // update corner counter via data attr on wrapper
    editorWrap.dataset.count = chars > 0 ? `${chars} chars` : '';
  }

  function switchToNote(idx) {
    // Save current
    notes[activeNote].content = textarea.value;
    // Switch
    activeNote = idx;
    textarea.value = notes[activeNote].content;
    tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
    updateStats();
    textarea.focus();
  }

  function refreshTabLabels() {
    tabs.forEach((t, i) => { t.textContent = notes[i].label; });
    // Re-mark active tab (textContent wipes class via loop — actually no, classList is separate)
    tabs[activeNote].classList.add('active');
  }

  // ── Tab switching ────────────────────────
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => switchToNote(i));
  });

  // ── Textarea input ───────────────────────
  textarea.addEventListener('input', () => {
    notes[activeNote].content = textarea.value;
    updateStats();
  });

  // ── Rename ───────────────────────────────
  renameBtn.addEventListener('click', () => {
    renameInput.value = notes[activeNote].label;
    renameWrap.style.display = 'flex';
    renameInput.focus();
    renameInput.select();
  });

  function confirmRename() {
    const val = renameInput.value.trim();
    if (val) {
      notes[activeNote].label = val;
      refreshTabLabels();
    }
    renameWrap.style.display = 'none';
  }

  renameConfirm.addEventListener('click', confirmRename);
  renameCancel.addEventListener('click', () => { renameWrap.style.display = 'none'; });
  renameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') renameWrap.style.display = 'none';
  });

  // ── Toolbar helpers ──────────────────────
  function insertAtCursor(before, after = '', placeholder = '') {
    const start = textarea.selectionStart;
    const end   = textarea.selectionEnd;
    const sel   = textarea.value.substring(start, end) || placeholder;
    const replacement = before + sel + after;
    textarea.setRangeText(replacement, start, end, 'select');
    if (!textarea.value.substring(start, end)) {
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd   = start + before.length + placeholder.length;
    }
    textarea.focus();
    notes[activeNote].content = textarea.value;
    updateStats();
  }

  function insertLine(prefix) {
    const start = textarea.selectionStart;
    const val   = textarea.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const before = val.substring(0, lineStart);
    const after  = val.substring(lineStart);
    textarea.value = before + prefix + after;
    const newPos = lineStart + prefix.length + (start - lineStart);
    textarea.selectionStart = textarea.selectionEnd = newPos;
    textarea.focus();
    notes[activeNote].content = textarea.value;
    updateStats();
  }

  document.getElementById('notesBoldBtn').addEventListener('click',   () => insertAtCursor('**', '**', 'bold text'));
  document.getElementById('notesItalicBtn').addEventListener('click', () => insertAtCursor('_', '_', 'italic text'));
  document.getElementById('notesUlBtn').addEventListener('click',     () => insertLine('• '));
  document.getElementById('notesHrBtn').addEventListener('click',     () => insertAtCursor('\n──────────────────\n'));
  document.getElementById('notesTsBtn').addEventListener('click', () => {
    const now = new Date();
    const ts  = now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    insertAtCursor(`[${ts}] `);
  });

  // Keyboard shortcuts inside textarea
  textarea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); insertAtCursor('**', '**', 'bold text'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); insertAtCursor('_', '_', 'italic text'); }
    // Tab key → insert 2 spaces instead of focus-jumping
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    }
  });

  // ── Fullscreen ───────────────────────────
  expandBtn.addEventListener('click', () => {
    isFullscreen = !isFullscreen;
    editorWrap.classList.toggle('fullscreen', isFullscreen);
    expandBtn.title = isFullscreen ? 'Exit fullscreen (Esc)' : 'Toggle fullscreen';
    expandBtn.innerHTML = isFullscreen
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    if (isFullscreen) textarea.focus();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isFullscreen) {
      isFullscreen = false;
      editorWrap.classList.remove('fullscreen');
      expandBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    }
  });

  // ── Copy ─────────────────────────────────
  copyBtn.addEventListener('click', () => {
    const text = textarea.value;
    if (!text.trim()) return;
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
      copyBtn.classList.add('success');
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Note`;
        copyBtn.classList.remove('success');
      }, 2000);
    });
  });

  // ── Download as .txt ─────────────────────
  downloadBtn.addEventListener('click', () => {
    const text = textarea.value;
    if (!text.trim()) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${notes[activeNote].label.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Clear ────────────────────────────────
  clearBtn.addEventListener('click', () => {
    if (!textarea.value.trim()) return;
    if (!confirm(`Clear "${notes[activeNote].label}"? This can't be undone.`)) return;
    textarea.value = '';
    notes[activeNote].content = '';
    updateStats();
    textarea.focus();
  });

  // ── Init ─────────────────────────────────
  updateStats();
})();

})();
