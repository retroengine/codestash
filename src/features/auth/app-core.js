/* ===========================================
   MODULE: AppCore
   Handles: auth, snippets, admin panel,
            navigation, UI state, AppUI.
   Depends on: supabase.js loaded first.
============================================ */

/* ============================================
   MODULE: AppCore — auth, snippets, admin, UI state
   Main application logic for CodeStash.
============================================ */
(function () {
'use strict';

/* ============================================
   NOTE: DevTools blocking has been removed.
   It was bypassable in one console command, broke
   screen readers and keyboard accessibility, and
   gave a false sense of security. Real protection
   lives in Supabase RLS and server-side validation.
============================================ */

/* ============================================
   CONFIG  — replace with your Supabase project
============================================ */
const _c = SUPABASE_SNIPPETS_URL;  /* from shared/lib/supabase.js */
const _k = SUPABASE_SNIPPETS_KEY;  /* from shared/lib/supabase.js */

/* ============================================
   ADMIN PASSPHRASE — stored as SHA-256 hash only.
   The real passphrase is NEVER in this file.
   To change it: run this in your browser console:
     crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourNewPassphrase'))
       .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
   Then paste the output hash below.
============================================ */
const _adminPhraseHash = '<YOUR_ADMIN_PASSPHRASE_HASH>';
// ↑ Replace this hash with the hash of YOUR chosen passphrase (see instructions above)
// Ensure you change this before deploying!

async function _hashPhrase(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('');
}

/* ============================================
   RATE LIMITING
============================================ */
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

/* ============================================
   INPUT SECURITY
============================================ */
function sanitizeInput(el) { el.value = el.value.replace(/[<>"'`]/g, ''); }
function validateEmail(e)   { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validatePassword(p){ return p.length >= 8; }

/* ============================================
   INACTIVITY TIMEOUT
============================================ */
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

/* ============================================
   STATE
============================================ */
let _session      = null;
let _siteUnlocked    = false;
let _guestNotes      = false;   // always forced true — Notes are permanently unlocked
let _guestAddSnippet = false;
let _userProfile  = null;
let _authMode     = 'login';
let _allUsers     = [];
let _currentFilter= 'pending';
let snippets      = [];
let _lastSyncTime = null;
// Edit mode: holds the id of the snippet currently being edited, or null.
let _editingId    = null;

/* ============================================
   SCREEN MANAGER
============================================ */
function showScreen(id) {
  // #authScreen no longer exists as a full-screen — auth is inline in snippets panel
  const pendingEl = document.getElementById('pendingScreen');
  if (pendingEl) pendingEl.classList.toggle('active', id === 'pendingScreen');
  document.getElementById('adminPortal').classList.toggle('active',   id === 'adminPortal');
  document.getElementById('appContainer').classList.toggle('visible', id === 'app' || id === 'authScreen');
  // Fixed logo only on pending screen
  document.getElementById('authFixedLogo').classList.toggle('visible', id === 'pendingScreen');
}

/* ============================================
   INIT
============================================ */
async function init() {
  const isPublic = await checkPublicView();
  if (isPublic) return;
  showApp(null);
  updateRateLimitUI();
}
init();

/* ============================================
   HELPERS
============================================ */
function _headers(token) {
  return {
    'apikey': _k,
    'Authorization': 'Bearer ' + (token || _k),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

/* ============================================
   AUTH TAB SWITCHING
============================================ */
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
    subline.textContent    = 'New accounts require admin approval.';
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

/* ============================================
   AUTH HANDLER
============================================ */
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
  if (_authMode === 'admin') {
    const key = document.getElementById('adminKey').value || '';
    if (key.length < 1) { showAuthError('Please enter the admin passphrase.'); return; }
    // Compare hash of what was typed — never compare plaintext
    const typedHash = await _hashPhrase(key);
    if (typedHash !== _adminPhraseHash) {
      recordFailedAttempt();
      showAuthError('Invalid admin passphrase.');
      return;
    }
  }

  const modeAtSubmit = _authMode;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ' +
    (modeAtSubmit === 'signup' ? 'Requesting...' : modeAtSubmit === 'admin' ? 'Authenticating...' : 'Signing in...');

  try {
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

    if (modeAtSubmit === 'admin') {
      if (!profile || profile.role !== 'admin') {
        recordFailedAttempt(); _session = null;
        showAuthError('Access denied. This account does not have admin privileges.');
        return;
      }
      _userProfile = profile;
      showAdminPortal();
    } else {
      if (!profile) { await createProfile(data.user.id, email, 'user', 'pending', data.access_token); showPendingScreen(email); return; }
      if (profile.status === 'pending')  { showPendingScreen(email); return; }
      if (profile.status === 'rejected') { _session = null; showAuthError('Your account access has been rejected. Contact the administrator.'); return; }
      if (profile.status === 'approved') { _userProfile = profile; showApp(data); }
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    showAuthError('Network error: ' + msg + ' | URL: ' + _c);
  } finally {
    btn.disabled = false;
    btn.innerHTML = (modeAtSubmit === 'login' ? 'Sign In' : modeAtSubmit === 'signup' ? 'Request Access' : 'Admin Sign In') +
      ' <svg width="13" height="13"><use href="#icon-arrow"/></svg>';
  }
}

/* ============================================
   PROFILE HELPERS
============================================ */
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

/* ============================================
   SCREENS: APP / PENDING / ADMIN
============================================ */
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
  document.getElementById('dropdownName').textContent = isGuest ? 'Sign in to continue' : 'Hi, ' + displayName + '!';

  // Toggle inline auth card vs actual snippet content
  const inlineAuth        = document.getElementById('inlineAuthWrap');
  const addPanel          = document.getElementById('addPanel');
  const snippetListHeader = document.querySelector('#snippetsPanel .row');
  const searchWrap        = document.querySelector('#snippetsPanel .search-wrap');
  const tagFilterBar      = document.getElementById('tagFilterBar');
  const snippetsList      = document.getElementById('snippetsList');

  if (isGuest) {
    if (inlineAuth)        inlineAuth.style.display        = '';
    if (addPanel)          addPanel.style.display          = 'none';
    if (snippetListHeader) snippetListHeader.style.display = 'none';
    if (searchWrap)        searchWrap.style.display        = 'none';
    if (tagFilterBar)      tagFilterBar.style.display      = 'none';
    if (snippetsList)      snippetsList.style.display      = 'none';
    setStatus('connected', 'connected');
  } else {
    if (inlineAuth)        inlineAuth.style.display        = 'none';
    if (addPanel)          addPanel.style.display          = '';
    if (snippetListHeader) snippetListHeader.style.display = '';
    if (searchWrap)        searchWrap.style.display        = '';
    if (snippetsList)      snippetsList.style.display      = '';
  }

  // Notes — always visible for signed-in users, hidden for guests
  const navNotes = document.getElementById('navNotes');
  if (navNotes) navNotes.style.display = ''; // Notes always visible

  // -- Lock icon on Snippets nav item --
  AppUI.updateSnippetsLock(!isGuest);

  showScreen('app');
  if (!isGuest) {
    fetchSnippets();
    resetInactivityTimer();
  }
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

/* ============================================
   ADMIN — LOCK / UNLOCK + USER MANAGEMENT
============================================ */
async function loadAdminData() {
  await Promise.all([loadSiteLock(), loadAllUsers()]);
}

async function loadSiteLock() {
  try {
    const res = await fetch(_c + '/rest/v1/site_settings?id=eq.1&select=locked,guest_notes,guest_add_snippet', { headers: _headers(_session.access_token) });
    const [row] = await res.json();
    const unlocked = row ? !row.locked : false;
    _siteUnlocked    = unlocked;
    _guestNotes      = true; // Notes always unlocked regardless of DB value
    _guestAddSnippet = row ? !!row.guest_add_snippet : false;
    updateLockUI(unlocked);
    updateGuestFeaturesUI(unlocked, true, _guestAddSnippet);
  } catch { updateLockUI(false); updateGuestFeaturesUI(false, true, false); }
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
  updateGuestFeaturesUI(unlocked,
    true, // Notes always on
    document.getElementById('guestAddSnippet') ? document.getElementById('guestAddSnippet').checked : false
  );
}

function updateGuestFeaturesUI(siteUnlocked, guestNotes, guestAddSnippet) {
  const snippetToggle = document.getElementById('guestAddSnippet');
  const snippetLabel  = document.getElementById('guestAddSnippetLabel');
  const snippetCard   = document.getElementById('gfCardSnippet');
  const noteCard      = document.getElementById('gfCardNotes');
  const warningNote   = document.getElementById('guestFeaturesNote');
  const noteToggle    = document.getElementById('guestNotes');
  const noteLabel     = document.getElementById('guestNotesLabel');

  if (snippetToggle) snippetToggle.checked  = guestAddSnippet;
  if (snippetLabel)  snippetLabel.textContent = guestAddSnippet ? 'On' : 'Off';
  // Notes are always on — lock the toggle visually
  if (noteToggle) { noteToggle.checked = true; noteToggle.disabled = true; }
  if (noteLabel)  noteLabel.textContent = 'Always On';

  const locked = !siteUnlocked;
  if (snippetCard) snippetCard.classList.toggle('disabled-card', locked);
  if (noteCard)    noteCard.classList.toggle('disabled-card', false); // Notes never dimmed
  if (warningNote) warningNote.classList.toggle('show', locked);
}

async function toggleGuestFeature(field, value) {
  const labelId = 'guestAddSnippetLabel';
  document.getElementById(labelId).textContent = value ? 'On' : 'Off';
  try {
    const body = {};
    body[field] = value;
    const res = await fetch(_c + '/rest/v1/site_settings?id=eq.1', {
      method: 'PATCH',
      headers: _headers(_session.access_token),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error();
    if (field === 'guest_add_snippet') _guestAddSnippet = value;
    applyLiveGuestRestrictions();
    showToast((value ? '✓ ' : '✗ ') + 'Add Snippet' + (value ? ' enabled for guests' : ' disabled for guests'), 'success');
  } catch {
    const el = document.getElementById('guestAddSnippet');
    if (el) { el.checked = !value; document.getElementById(labelId).textContent = !value ? 'On' : 'Off'; }
    showToast('✗ Failed to update guest permissions', 'error');
  }
}

async function toggleSiteLock() {
  const unlocked = document.getElementById('siteUnlocked').checked;
  updateLockUI(unlocked);
  try {
    const res = await fetch(_c + '/rest/v1/site_settings?id=eq.1', {
      method: 'PATCH',
      headers: _headers(_session.access_token),
      body: JSON.stringify({ locked: !unlocked })
    });
    if (!res.ok) throw new Error();
    _siteUnlocked = unlocked;
    applyLiveGuestRestrictions();
    showToast(unlocked ? '🔓 Site unlocked — now public' : '🔒 Site locked — login required', 'success');
  } catch {
    updateLockUI(!unlocked);
    showToast('✗ Failed to update site settings', 'error');
  }
}

/**
 * applyLiveGuestRestrictions — re-applies _siteUnlocked / _guestAddSnippet
 * to the live UI instantly. Notes are always visible for everyone.
 */
function applyLiveGuestRestrictions() {
  const isGuest = !_session;
  const addPanel = document.getElementById('addPanel');
  if (addPanel) addPanel.style.display = (isGuest && !_guestAddSnippet) ? 'none' : '';

  // Notes are always unlocked — always show navNotes
  const navNotes = document.getElementById('navNotes');
  if (navNotes) navNotes.style.display = '';
}
async function loadAllUsers() {
  const queueEl = document.getElementById('userQueue');
  queueEl.innerHTML = '<div class="empty-queue"><div class="eq-icon">⏳</div><p>Loading users...</p></div>';
  try {
    const res = await fetch(_c + '/rest/v1/profiles?role=eq.user&order=created_at.asc', { headers: _headers(_session.access_token) });
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
    // Allowlist status to prevent CSS class injection
    const safeStatus = ['pending','approved','rejected'].includes(u.status) ? u.status : 'pending';
    const actions = safeStatus === 'pending'
      ? `<button class="btn-approve" data-uid="${escHtml(u.id)}" data-action="approve">✓ Approve</button>
         <button class="btn-reject"  data-uid="${escHtml(u.id)}" data-action="reject">✗ Reject</button>`
      : safeStatus === 'approved'
      ? `<button class="btn-revoke"  data-uid="${escHtml(u.id)}" data-action="reject">Revoke</button>`
      : `<button class="btn-approve" data-uid="${escHtml(u.id)}" data-action="approve">Restore</button>`;
    return `<div class="user-card">
      <div class="user-info">
        <div class="user-email">${escHtml(u.email)}</div>
        <div class="user-meta">Joined ${relTime(u.created_at)}</div>
      </div>
      <span class="user-status-badge ${safeStatus}">${safeStatus}</span>
      <div class="user-actions">${actions}</div>
    </div>`;
  }).join('');
}

async function updateUserStatus(userId, status) {
  try {
    const res = await fetch(_c + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId), {
      method: 'PATCH',
      headers: _headers(_session.access_token),
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

/* ============================================
   SIGN OUT
============================================ */
function signOut() {
  _session = _userProfile = null;
  snippets = [];
  _lastSyncTime = null;
  clearTimeout(_inactivityTimer);
  closeDropdown();
  document.getElementById('adminPortal').classList.remove('active');
  document.getElementById('authEmail').value    = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authConfirm').value  = '';
  document.getElementById('adminKey').value     = '';
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authNotice').style.display = 'none';
  switchTab('login');
  showApp(null); // back to inline auth in snippets panel
}

function adminSignOut() {
  _session = _userProfile = null;
  _allUsers = [];
  switchTab('login');
  showApp(null); // back to inline auth
}

/* ============================================
   SNIPPETS — FETCH / SAVE / DELETE
============================================ */
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

  // -- EDIT MODE — PATCH existing row --------------------------------------
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

  // -- CREATE MODE — POST new row -------------------------------------------
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

/* ============================================
   TAG SYSTEM
============================================ */
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
    // Use textContent for the tag label — never innerHTML with user data
    chip.textContent = t;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'tag-chip-remove';
    removeBtn.setAttribute('aria-label', 'Remove tag ' + t);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeTag(i));
    chip.appendChild(removeBtn);
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

/* ============================================
   SHARE MODAL
============================================ */
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

/* ============================================
   PUBLIC VIEW — check URL on load
============================================ */
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
    // Syntax highlight the public view code
    const pubCodeEl = document.getElementById('pubCode');
    if (window.hljs) {
      const langMap = { javascript:'javascript', python:'python', java:'java', cpp:'cpp', css:'css', html:'xml', sql:'sql', note:'plaintext' };
      const hlLang = langMap[(s.language||'').toLowerCase()] || 'plaintext';
      const highlighted = window.hljs.highlight(s.code, { language: hlLang, ignoreIllegals: true });
      pubCodeEl.innerHTML = `<code class="hljs language-${hlLang}">${highlighted.value}</code>`;
    } else {
      pubCodeEl.textContent = s.code;
    }

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

/* ============================================
   SNIPPETS — RENDER (pins, tags, share)
============================================ */
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

    // Apply syntax highlighting
    const langMap = {
      javascript:'javascript', python:'python', java:'java', cpp:'cpp',
      css:'css', html:'xml', sql:'sql', note:'plaintext'
    };
    const hlLang = langMap[s.language.toLowerCase()] || 'plaintext';
    if (window.hljs) {
      const highlighted = window.hljs.highlight(s.code, { language: hlLang, ignoreIllegals: true });
      codePreview.innerHTML = `<code class="hljs language-${hlLang}">${highlighted.value}</code>`;
    } else {
      codePreview.textContent = s.code;
    }

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

/* ============================================
   UTILS
============================================ */
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

/* ============================================
   EVENT DELEGATION — all interactions
============================================ */

// Auth tabs
document.querySelector('.tab-switcher').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  if (btn.id === 'tabLogin')  switchTab('login');
  if (btn.id === 'tabSignup') switchTab('signup');
  if (btn.id === 'tabAdmin')  switchTab('admin');
});

// Auth form — Enter key + sanitization
['authEmail','authPassword','authConfirm','adminKey'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
    // Sanitize email and passphrase fields (passwords intentionally allow all chars)
    if (id === 'authEmail' || id === 'adminKey') el.addEventListener('input', () => sanitizeInput(el));
  }
});

// Snippet name — sanitize on input
const _snippetNameEl = document.getElementById('snippetName');
if (_snippetNameEl) _snippetNameEl.addEventListener('input', () => sanitizeInput(_snippetNameEl));

// Auth button
document.getElementById('authBtn').addEventListener('click', handleAuth);

// Pending back
document.getElementById('pendingBack').addEventListener('click', () => {
  _session = null;
  showApp(null);
  switchTab('login');
});

// Admin toggle lock
document.getElementById('siteUnlocked').addEventListener('change', toggleSiteLock);
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
  const copyBtn    = e.target.closest('.js-copy');
  const deleteBtn  = e.target.closest('.js-delete');
  const editBtn    = e.target.closest('.js-edit');
  const expandBtn  = e.target.closest('.js-expand');
  const pinBtn     = e.target.closest('.js-pin');
  const shareBtn   = e.target.closest('.js-share');
  const card       = e.target.closest('.snippet-card');
  if (!card) return;

  if (copyBtn)    { e.stopPropagation(); copySnippet(copyBtn.dataset.id); return; }
  if (deleteBtn)  { e.stopPropagation(); deleteSnippet(deleteBtn.dataset.id); return; }
  if (editBtn)    { e.stopPropagation(); editSnippet(editBtn.dataset.id); return; }
  if (expandBtn)  { e.stopPropagation(); card.classList.toggle('expanded'); return; }
  if (pinBtn)     { e.stopPropagation(); pinSnippet(pinBtn.dataset.id); return; }
  if (shareBtn)   { e.stopPropagation(); openShareModal(shareBtn.dataset.id); return; }
  card.classList.toggle('expanded');
});

/* ============================================
   MOBILE SIDEBAR
============================================ */
window.toggleMobileSidebar = function() {
  document.querySelector('.sidebar').classList.toggle('mob-open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
};

window.closeMobileSidebar = function() {
  document.querySelector('.sidebar').classList.remove('mob-open');
  document.getElementById('sidebarOverlay').classList.remove('open');
};

// Sidebar nav active state + panel switching
document.querySelector('.sidebar').addEventListener('click', e => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  e.preventDefault();
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  closeMobileSidebar(); // close drawer on mobile after selection

  AppUI.switchPanel(item.id);
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

/* ============================================
   AUTO-REFRESH (every 30s while logged in)
============================================ */
setInterval(() => {
  if (_session && document.getElementById('appContainer').classList.contains('visible')) fetchSnippets();
}, 30000);
setInterval(() => {
  if (document.getElementById('adminPortal').classList.contains('active')) loadAdminData();
}, 30000);

/* ============================================
   LIGHT / DARK MODE TOGGLE
============================================ */
(function initTheme() {
  // Persist in localStorage; default to light
  const saved = localStorage.getItem('cs_theme') || 'light';
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

/* ============================================
   MODULE: AppUI — panel switching + lock icon
============================================ */
const AppUI = (() => {
  const PANELS = {
    navClipboard: { panel: 'clipboardPanel', title: 'Clipboard', type: 'class' },
    navNotes:     { panel: 'notesPanel',     title: 'Notes',     type: 'class' },
    navSnippets:  { panel: 'snippetsPanel',  title: 'Snippets',  type: 'style' },
  };

  function switchPanel(navId) {
    const pageTitle = document.querySelector('.topbar-page-title');
    // Hide all panels
    document.getElementById('snippetsPanel').style.display = 'none';
    document.getElementById('clipboardPanel').classList.remove('visible');
    document.getElementById('notesPanel').classList.remove('visible');

    const cfg = PANELS[navId] || PANELS.navClipboard;
    if (cfg.type === 'style') {
      document.getElementById(cfg.panel).style.display = '';
    } else {
      document.getElementById(cfg.panel).classList.add('visible');
    }
    pageTitle.textContent = cfg.title;
  }

  function updateSnippetsLock(isSignedIn) {
    const lockEl = document.getElementById('navSnippetsLock');
    if (!lockEl) return;
    // Swap between locked and unlocked SVG
    const lockedSVG   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    const unlockedSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
    lockEl.innerHTML = isSignedIn ? unlockedSVG : lockedSVG;
    lockEl.classList.toggle('unlocked', isSignedIn);
    lockEl.title = isSignedIn ? 'Snippets unlocked' : 'Sign in to access snippets';
  }

  return { switchPanel, updateSnippetsLock };
})();

})(); /* end main app IIFE */
