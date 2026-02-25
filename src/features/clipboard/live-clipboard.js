/* ═══════════════════════════════════════════
   MODULE: AppLiveClipboard
   Real-time shared clipboard via 6-character session code.

   Architecture:
   ┌─────────────────────────────────────────────┐
   │  Typing → Broadcast (WebSocket, ~50ms)       │  instant peer sync
   │         → Debounced DB write (800ms)         │  persistence
   │  Race condition → optimistic locking         │  version column
   │  Disconnect → auto-reconnect (3 attempts)    │  resilience
   │  Presence → track connected devices          │  who's online
   └─────────────────────────────────────────────┘

   Depends on:
   - supabase.js  (SUPABASE_CLIPBOARD_KEY, SUPABASE_CLIPBOARD_URL)
   - @supabase/supabase-js v2 loaded via CDN (window.supabase)

   CRITICAL — why this file uses two URLs:
   - REST  → SUPABASE_CLIPBOARD_URL  (Vercel proxy, hides raw URL)
   - WS    → SB_URL direct           (Vercel cannot proxy WebSockets)
   The CSP in index.html must allow:
     connect-src ... https://vbtzptvgbzsvrustnwiz.supabase.co
                     wss://vbtzptvgbzsvrustnwiz.supabase.co
════════════════════════════════════════════ */

const AppLiveClipboard = (function () {
'use strict';

/* ── Config ──────────────────────────────────────────────────── */
const SB_URL = 'https://vbtzptvgbzsvrustnwiz.supabase.co';
const SB_KEY = SUPABASE_CLIPBOARD_KEY;           // from supabase.js
const REST   = SUPABASE_CLIPBOARD_URL;           // Vercel proxy base

const DEBOUNCE_MS   = 800;   // ms after last keystroke before DB write
const MAX_RECONNECT = 3;     // attempts before giving up
const RECONNECT_MS  = 3000;  // ms between reconnect attempts

/* ── State ───────────────────────────────────────────────────── */
let _sb             = null;   // Supabase JS client
let _channel        = null;   // Realtime broadcast + presence channel
let _code           = null;   // Active 6-char session code
let _version        = 0;      // DB version for optimistic locking
let _debounce       = null;   // Keystroke debounce timer
let _reconnectTimer = null;   // Reconnect backoff timer
let _reconnectCount = 0;      // Attempts since last clean connect
let _applying       = false;  // True while applying a remote update
let _deviceId       = 'lcb_' + Math.random().toString(36).slice(2, 10);

/* ── Supabase Client (lazy singleton) ───────────────────────── */
function getClient() {
  if (_sb) return _sb;
  if (!window.supabase?.createClient) {
    console.error('[LiveClip] @supabase/supabase-js v2 not loaded');
    return null;
  }
  _sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth:     { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } }
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

async function restGet(code) {
  const res = await fetch(
    REST + '/rest/v1/live_sessions?code=eq.' + encodeURIComponent(code),
    { headers: headers() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

async function restPost(code) {
  const res = await fetch(REST + '/rest/v1/live_sessions', {
    method:  'POST',
    headers: headers(),
    body: JSON.stringify({
      code,
      content:    '',
      version:    0,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    })
  });
  if (!res.ok) throw new Error('Create failed: ' + await res.text());
}

/* ── Optimistic-locked DB Write ─────────────────────────────────
   Sends PATCH only if DB version still matches _version.
   If another device wrote first (0 rows updated = race lost),
   re-fetch to sync our version pointer then retry once.
   isRetry flag prevents infinite loops.                        ── */
async function persistContent(content, isRetry = false) {
  if (!_code) return;
  const expected = _version;

  try {
    const res = await fetch(
      REST + '/rest/v1/live_sessions' +
        '?code=eq.'    + _code +
        '&version=eq.' + expected,
      {
        method:  'PATCH',
        headers: headers(),
        body: JSON.stringify({
          content,
          version:    expected + 1,
          updated_at: new Date().toISOString()
        })
      }
    );
    if (!res.ok) return;

    const rows = await res.json();
    if (rows.length === 0) {
      // Race lost — re-sync version, retry once so our content isn't dropped
      const latest = await restGet(_code);
      if (!latest) return;
      _version = latest.version;
      if (!isRetry) await persistContent(content, true);
    } else {
      _version = expected + 1;
    }
  } catch (err) {
    console.warn('[LiveClip] persistContent error:', err);
  }
}

/* ── Session Code Generator ──────────────────────────────────── */
// Excludes ambiguous characters: 0/O, 1/I, 5/S
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  return Array.from({ length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

/* ── Realtime Channel ────────────────────────────────────────── */
async function connectChannel(code) {
  const sb = getClient();
  if (!sb) { setStatus('disconnected'); return; }

  // Cleanly tear down any existing channel first
  if (_channel) {
    try { await _channel.untrack(); } catch { /* ignore */ }
    await sb.removeChannel(_channel);
    _channel = null;
  }

  setStatus('connecting');
  console.log('[LiveClip] Connecting to channel lcb:' + code);

  _channel = sb
    .channel('lcb:' + code, {
      config: {
        broadcast: { self: false },        // never echo our own sends
        presence:  { key: _deviceId }
      }
    })

    // ── Peer content updates ──────────────────────────────────
    .on('broadcast', { event: 'content' }, ({ payload }) => {
      if (!payload || payload.deviceId === _deviceId) return;
      applyRemoteContent(payload.content ?? '');
    })

    // ── Presence ──────────────────────────────────────────────
    .on('presence', { event: 'sync' }, () => {
      const count = Object.keys(_channel.presenceState()).length;
      updatePresence(count);
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      if (newPresences.some(p => p.deviceId !== _deviceId))
        toast('📱 Device joined the session');
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      if (leftPresences.some(p => p.deviceId !== _deviceId))
        toast('📴 Device left the session');
    })

    // ── Connection lifecycle ──────────────────────────────────
    .subscribe(async (status, err) => {
      console.log('[LiveClip] Channel status:', status, err ?? '');

      if (status === 'SUBSCRIBED') {
        _reconnectCount = 0;
        clearTimeout(_reconnectTimer);
        try {
          await _channel.track({ deviceId: _deviceId, joinedAt: Date.now() });
        } catch (e) {
          console.warn('[LiveClip] Presence track failed (broadcast still active):', e);
        }
        setStatus('live');

      } else if (
        status === 'TIMED_OUT' ||
        status === 'CHANNEL_ERROR' ||
        status === 'CLOSED'
      ) {
        setStatus('disconnected');
        scheduleReconnect(code);
      }
    });
}

/* ── Auto-reconnect with linear backoff ──────────────────────── */
function scheduleReconnect(code) {
  if (!_code) return;                          // user already left cleanly
  if (_reconnectCount >= MAX_RECONNECT) {
    toast('⚠ Connection lost — please refresh to reconnect');
    return;
  }
  _reconnectCount++;
  const delay = RECONNECT_MS * _reconnectCount;
  console.log(`[LiveClip] Reconnecting in ${delay}ms (attempt ${_reconnectCount}/${MAX_RECONNECT})`);
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => connectChannel(code), delay);
}

/* ── Apply Remote Content Without Disrupting Cursor ─────────────
   Calculates where the cursor would proportionally land in the
   new content so the user's reading position doesn't jump.    ── */
function applyRemoteContent(content) {
  const ta = el('lcbTextarea');
  if (!ta) return;

  const ratio     = ta.value.length > 0 ? ta.selectionStart / ta.value.length : 0;
  const newCursor = Math.round(ratio * content.length);

  _applying = true;
  ta.value = content;
  ta.selectionStart = ta.selectionEnd = Math.min(newCursor, content.length);
  _applying = false;

  updateStats(content);
}

/* ── Broadcast to Peers ──────────────────────────────────────── */
function broadcastContent(content) {
  if (!_channel) return;
  _channel.send({
    type:    'broadcast',
    event:   'content',
    payload: { content, deviceId: _deviceId, ts: Date.now() }
  }).catch(() => { /* next keystroke will retry */ });
}

/* ── UI Helpers ──────────────────────────────────────────────── */
function el(id) { return document.getElementById(id); }

function setStatus(status) {
  const dot  = el('lcbStatusDot');
  const text = el('lcbStatusText');
  if (dot)  dot.className    = 'lcb-dot ' + status;
  if (text) text.textContent =
    status === 'live'       ? 'live'        :
    status === 'connecting' ? 'connecting…' : 'disconnected';
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
  wrap.innerHTML = [...code].map(c =>
    `<span class="lcb-digit">${c}</span>`
  ).join('');
}

function showJoinScreen() {
  const join    = el('lcbJoinScreen');
  const session = el('lcbSessionScreen');
  if (join)    join.style.display    = 'flex';
  if (session) session.style.display = 'none';
  const inp = el('lcbCodeInput');
  if (inp) inp.value = '';
}

function showSessionScreen(code, content) {
  const join    = el('lcbJoinScreen');
  const session = el('lcbSessionScreen');
  if (join)    join.style.display    = 'none';
  if (session) session.style.display = 'flex';

  showCodeDigits(code);
  const ta = el('lcbTextarea');
  if (ta) ta.value = content ?? '';
  updateStats(content ?? '');
  setStatus('connecting');
}

/* ── Public: Host ────────────────────────────────────────────── */
async function hostSession() {
  const btn = el('lcbHostBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…'; }
  try {
    const code = generateCode();
    await restPost(code);
    _code    = code;
    _version = 0;
    _reconnectCount = 0;
    showSessionScreen(code, '');
    await connectChannel(code);
  } catch (e) {
    console.error('[LiveClip] hostSession failed:', e);
    toast('✗ Failed to create session');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '＋ New Session'; }
  }
}

/* ── Public: Join ────────────────────────────────────────────── */
async function joinSession() {
  const input = el('lcbCodeInput');
  const raw   = (input?.value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 6) { toast('⚠ Enter a 6-character code'); return; }

  const btn = el('lcbJoinBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Joining…'; }
  try {
    const session = await restGet(raw);
    if (!session) { toast('✗ Session not found or expired'); return; }
    _code    = raw;
    _version = session.version;
    _reconnectCount = 0;
    showSessionScreen(raw, session.content);
    await connectChannel(raw);
  } catch (e) {
    console.error('[LiveClip] joinSession failed:', e);
    toast('✗ Failed to join session');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Join →'; }
  }
}

/* ── Public: Leave ───────────────────────────────────────────── */
async function leaveSession() {
  clearTimeout(_debounce);
  clearTimeout(_reconnectTimer);
  _reconnectCount = MAX_RECONNECT;     // block auto-reconnect after intentional leave

  if (_channel) {
    const sb = getClient();
    try { await _channel.untrack(); } catch { /* ignore */ }
    if (sb) await sb.removeChannel(_channel);
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
  if (!ta?.value.trim()) return;
  navigator.clipboard.writeText(ta.value).then(() => toast('✓ Copied to clipboard'));
}

/* ── Public: Clear Content ───────────────────────────────────── */
function clearContent() {
  const ta = el('lcbTextarea');
  if (!ta?.value.trim()) return;
  if (!confirm('Clear live clipboard? This affects all connected devices.')) return;

  clearTimeout(_debounce);
  ta.value = '';
  updateStats('');
  broadcastContent('');
  persistContent('');
}

/* ── Textarea Input Handler ──────────────────────────────────── */
function onInput() {
  if (_applying || !_code) return;
  const ta = el('lcbTextarea');
  if (!ta) return;
  const content = ta.value;

  updateStats(content);
  broadcastContent(content);          // 1. Instant peer update via WebSocket

  clearTimeout(_debounce);            // 2. Persist to DB after 800ms of silence
  _debounce = setTimeout(() => persistContent(content), DEBOUNCE_MS);
}

/* ── Code Input Formatter ────────────────────────────────────── */
function onCodeInput(e) {
  const inp = e.target;
  const val = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  inp.value = val;
  if (val.length === 6) el('lcbJoinBtn')?.focus();
}

/* ── Init ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  el('lcbTextarea')   ?.addEventListener('input',   onInput);
  el('lcbCodeInput')  ?.addEventListener('input',   onCodeInput);
  el('lcbCodeInput')  ?.addEventListener('keydown', e => { if (e.key === 'Enter') joinSession(); });
  el('lcbHostBtn')    ?.addEventListener('click',   hostSession);
  el('lcbJoinBtn')    ?.addEventListener('click',   joinSession);
  el('lcbLeaveBtn')   ?.addEventListener('click',   leaveSession);
  el('lcbCopyCodeBtn')?.addEventListener('click',   copyCode);
  el('lcbCopyBtn')    ?.addEventListener('click',   copyContent);
  el('lcbClearBtn')   ?.addEventListener('click',   clearContent);
});

return { hostSession, joinSession, leaveSession };

})(); /* end AppLiveClipboard */
