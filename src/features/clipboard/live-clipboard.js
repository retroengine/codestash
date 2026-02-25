/* ═══════════════════════════════════════════
   MODULE: AppLiveClipboard
   Real-time shared clipboard via 6-digit session code.

   Architecture:
   ┌─────────────────────────────────────────────┐
   │  Typing → Broadcast (WebSocket, ~50ms)       │  instant sync
   │         → Debounced DB write (800ms)         │  persistence
   │  Race condition → optimistic locking         │  version column
   │  Presence → track connected devices          │  who's online
   └─────────────────────────────────────────────┘

   Depends on:
   - supabase.js (SUPABASE_CLIPBOARD_KEY)
   - @supabase/supabase-js loaded via CDN (window.supabase)
════════════════════════════════════════════ */

const AppLiveClipboard = (function () {
'use strict';

/* ── Config ──────────────────────────────────────────────────── */
// Direct Supabase URL needed for Realtime WebSocket.
// Vercel proxy cannot forward WebSocket connections.
const SB_URL = 'https://vbtzptvgbzsvrustnwiz.supabase.co';
const SB_KEY = SUPABASE_CLIPBOARD_KEY;

// REST calls still go through Vercel proxy (keeps URL hidden in Network tab)
const REST   = SUPABASE_CLIPBOARD_URL;

/* ── State ───────────────────────────────────────────────────── */
let _sb          = null;   // Supabase client instance
let _channel     = null;   // Realtime broadcast channel
let _code        = null;   // Active session code
let _version     = 0;      // DB version for optimistic locking
let _debounce    = null;   // Timer for debounced DB write
let _fromRemote  = false;  // Flag to ignore echoed remote updates
let _deviceId    = 'lcb_' + Math.random().toString(36).slice(2, 10);

/* ── Supabase Client ─────────────────────────────────────────── */
function getClient() {
  if (_sb) return _sb;
  if (!window.supabase) {
    console.error('AppLiveClipboard: @supabase/supabase-js not loaded');
    return null;
  }
  _sb = window.supabase.createClient(SB_URL, SB_KEY, {
    realtime: {
      params: { eventsPerSecond: 20 }
    },
    auth: { persistSession: false }
  });
  return _sb;
}

/* ── REST Helpers ────────────────────────────────────────────── */
function headers() {
  return {
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  };
}

/* ── Session Code Generation ─────────────────────────────────── */
// Avoids ambiguous chars: 0/O, 1/I, 5/S
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

/* ── Create Session (host) ───────────────────────────────────── */
async function createSession() {
  const code = generateCode();
  const res = await fetch(REST + '/rest/v1/live_sessions', {
    method:  'POST',
    headers: { ...headers(), 'Prefer': 'return=representation' },
    body: JSON.stringify({
      code,
      content:    '',
      version:    0,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Create failed: ' + err);
  }
  return code;
}

/* ── Fetch Session (guest join) ──────────────────────────────── */
async function fetchSession(code) {
  const res = await fetch(
    REST + '/rest/v1/live_sessions?code=eq.' + encodeURIComponent(code),
    { headers: headers() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

/* ── Persist to DB with Optimistic Locking ───────────────────── */
// Only writes if the version in DB matches what we last read.
// If someone else wrote in the meantime, PATCH affects 0 rows → we re-fetch.
async function persistContent(content, expectedVersion) {
  if (!_code) return;
  try {
    const res = await fetch(
      REST + '/rest/v1/live_sessions?code=eq.' + _code +
      '&version=eq.' + expectedVersion,
      {
        method:  'PATCH',
        headers: headers(),
        body: JSON.stringify({
          content,
          version:    expectedVersion + 1,
          updated_at: new Date().toISOString()
        })
      }
    );
    if (!res.ok) return;
    const rows = await res.json();

    if (rows.length === 0) {
      // ── Race condition detected ──────────────────────────────
      // Another device updated between our last read and now.
      // Fetch the latest version so future writes use correct base.
      const latest = await fetchSession(_code);
      if (latest) {
        _version = latest.version;
        // Note: we intentionally do NOT overwrite the user's textarea —
        // their local broadcast already went to peers. The next keystroke
        // will trigger another write attempt with the refreshed version.
      }
    } else {
      // Write succeeded — advance our version counter
      _version = expectedVersion + 1;
    }
  } catch { /* network errors are silent — next keystroke retries */ }
}

/* ── Realtime Channel ────────────────────────────────────────── */
function connectChannel(code) {
  const sb = getClient();
  if (!sb) return;

  // Clean up any previous channel
  if (_channel) {
    sb.removeChannel(_channel);
    _channel = null;
  }

  _channel = sb.channel('lcb:' + code, {
    config: {
      broadcast: { self: false },  // don't echo back to sender
      presence:  { key: _deviceId }
    }
  });

  // ── Content broadcast ──────────────────────────────────────
  _channel.on('broadcast', { event: 'content' }, ({ payload }) => {
    if (!payload || payload.deviceId === _deviceId) return;

    // Prevent the textarea's 'input' handler from re-broadcasting
    _fromRemote = true;
    const ta = el('lcbTextarea');
    if (ta) {
      // Preserve cursor position as best we can
      const cursor = ta.selectionStart;
      ta.value = payload.content;
      const newCursor = Math.min(cursor, payload.content.length);
      ta.selectionStart = ta.selectionEnd = newCursor;
    }
    _fromRemote = false;
    updateStats(payload.content || '');
  });

  // ── Presence: sync ────────────────────────────────────────
  _channel.on('presence', { event: 'sync' }, () => {
    const count = Object.keys(_channel.presenceState()).length;
    updatePresence(count);
  });

  // ── Presence: join ────────────────────────────────────────
  _channel.on('presence', { event: 'join' }, () => {
    const count = Object.keys(_channel.presenceState()).length;
    updatePresence(count);
    if (count > 1) toast('📱 Device joined the session');
  });

  // ── Presence: leave ───────────────────────────────────────
  _channel.on('presence', { event: 'leave' }, () => {
    const count = Object.keys(_channel.presenceState()).length;
    updatePresence(count);
    toast('📴 Device left the session');
  });

  // ── Subscribe ─────────────────────────────────────────────
  _channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await _channel.track({
        deviceId: _deviceId,
        joinedAt: Date.now()
      });
      setStatus('live');
    } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
      setStatus('disconnected');
    } else {
      setStatus('connecting');
    }
  });
}

/* ── Broadcast to Peers ──────────────────────────────────────── */
function broadcastContent(content) {
  if (!_channel) return;
  _channel.send({
    type:    'broadcast',
    event:   'content',
    payload: { content, deviceId: _deviceId, ts: Date.now() }
  });
}

/* ── UI Helpers ──────────────────────────────────────────────── */
function el(id) { return document.getElementById(id); }

function setStatus(status) {
  const dot  = el('lcbStatusDot');
  const text = el('lcbStatusText');
  if (dot)  dot.className   = 'lcb-dot ' + status;
  if (text) text.textContent =
    status === 'live'         ? 'live' :
    status === 'connecting'   ? 'connecting…' : 'disconnected';
}

function updatePresence(count) {
  const p = el('lcbPresence');
  if (p) p.textContent = count + ' device' + (count !== 1 ? 's' : '') + ' connected';
}

function updateStats(text) {
  const s = el('lcbStats');
  if (!s) return;
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  s.textContent = words + ' words · ' + chars + ' chars';
}

function toast(msg) {
  if (typeof showToast === 'function') showToast(msg, '');
}

function showCodeDigits(code) {
  const wrap = el('lcbCodeDigits');
  if (!wrap) return;
  wrap.innerHTML = code.split('').map(c =>
    `<span class="lcb-digit">${c}</span>`
  ).join('');
}

function showJoinScreen() {
  const join    = el('lcbJoinScreen');
  const session = el('lcbSessionScreen');
  if (join)    join.style.display    = 'flex';
  if (session) session.style.display = 'none';
  el('lcbCodeInput') && (el('lcbCodeInput').value = '');
}

function showSessionScreen(code, content) {
  const join    = el('lcbJoinScreen');
  const session = el('lcbSessionScreen');
  if (join)    join.style.display    = 'none';
  if (session) session.style.display = 'flex';

  showCodeDigits(code);
  const ta = el('lcbTextarea');
  if (ta) ta.value = content || '';
  updateStats(content || '');
  setStatus('connecting');
}

/* ── Public: Host a Session ──────────────────────────────────── */
async function hostSession() {
  const btn = el('lcbHostBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…'; }
  try {
    const code = await createSession();
    _code    = code;
    _version = 0;
    showSessionScreen(code, '');
    connectChannel(code);
  } catch (e) {
    toast('✗ Failed to create session');
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '＋ New Session'; }
  }
}

/* ── Public: Join a Session ──────────────────────────────────── */
async function joinSession() {
  const input = el('lcbCodeInput');
  const raw   = (input ? input.value : '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 6) { toast('⚠ Enter a 6-character code'); return; }

  const btn = el('lcbJoinBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Joining…'; }
  try {
    const session = await fetchSession(raw);
    if (!session) { toast('✗ Session not found or expired'); return; }
    _code    = raw;
    _version = session.version;
    showSessionScreen(raw, session.content);
    connectChannel(raw);
  } catch {
    toast('✗ Failed to join session');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Join →'; }
  }
}

/* ── Public: Leave Session ───────────────────────────────────── */
async function leaveSession() {
  clearTimeout(_debounce);
  if (_channel) {
    const sb = getClient();
    await _channel.untrack();
    if (sb) sb.removeChannel(_channel);
    _channel = null;
  }
  _code    = null;
  _version = 0;
  showJoinScreen();
  setStatus('disconnected');
}

/* ── Public: Copy Code ───────────────────────────────────────── */
function copyCode() {
  if (!_code) return;
  navigator.clipboard.writeText(_code).then(() => {
    const btn = el('lcbCopyCodeBtn');
    if (!btn) return;
    const prev = btn.innerHTML;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => { btn.innerHTML = prev; }, 2000);
  });
}

/* ── Public: Copy Content ────────────────────────────────────── */
function copyContent() {
  const ta = el('lcbTextarea');
  if (!ta || !ta.value.trim()) return;
  navigator.clipboard.writeText(ta.value).then(() => toast('✓ Copied to clipboard'));
}

/* ── Public: Clear Content ───────────────────────────────────── */
function clearContent() {
  const ta = el('lcbTextarea');
  if (!ta || !ta.value.trim()) return;
  if (!confirm('Clear live clipboard? This affects all connected devices.')) return;
  ta.value = '';
  updateStats('');
  broadcastContent('');
  persistContent('', _version);
}

/* ── Textarea Input Handler ──────────────────────────────────── */
function onInput() {
  if (_fromRemote) return;
  const ta = el('lcbTextarea');
  if (!ta || !_code) return;
  const content = ta.value;

  updateStats(content);

  // 1. Broadcast immediately (instant peer update)
  broadcastContent(content);

  // 2. Write to DB after 800ms of inactivity
  clearTimeout(_debounce);
  const capturedVersion = _version;
  _debounce = setTimeout(() => {
    persistContent(content, capturedVersion);
  }, 800);
}

/* ── Code Input Formatter ────────────────────────────────────── */
function onCodeInput(e) {
  const inp = e.target;
  const val = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  inp.value = val;
  if (val.length === 6) el('lcbJoinBtn').focus();
}

/* ── Init — wire up events ───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const ta   = el('lcbTextarea');
  const code = el('lcbCodeInput');

  if (ta)   ta.addEventListener('input', onInput);
  if (code) code.addEventListener('input', onCodeInput);
  if (code) code.addEventListener('keydown', e => { if (e.key === 'Enter') joinSession(); });

  el('lcbHostBtn')     && el('lcbHostBtn').addEventListener('click', hostSession);
  el('lcbJoinBtn')     && el('lcbJoinBtn').addEventListener('click', joinSession);
  el('lcbLeaveBtn')    && el('lcbLeaveBtn').addEventListener('click', leaveSession);
  el('lcbCopyCodeBtn') && el('lcbCopyCodeBtn').addEventListener('click', copyCode);
  el('lcbCopyBtn')     && el('lcbCopyBtn').addEventListener('click', copyContent);
  el('lcbClearBtn')    && el('lcbClearBtn').addEventListener('click', clearContent);
});

return { hostSession, joinSession, leaveSession };

})(); /* end AppLiveClipboard */
