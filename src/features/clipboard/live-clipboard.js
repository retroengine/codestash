/* ═══════════════════════════════════════════════════════════════
   AppLiveClipboard  —  Real-time shared clipboard
   ─────────────────────────────────────────────────────────────
   SYNC MODEL  (dual-mode, like Google Sheets offline/reconnect)
   ┌──────────────────────────────────────────────────────────┐
   │  FAST LANE  WebSocket broadcast  (~50 ms)                │
   │    • instant keystroke delivery to all peers             │
   │    • fire-and-forget, no guarantee                       │
   │                                                          │
   │  SAFE LANE  DB poll every 2 s  (fallback)               │
   │    • always running — catches missed WS messages         │
   │    • also the recovery path after reconnect              │
   │    • pauses for 3 s after local write to avoid echo      │
   └──────────────────────────────────────────────────────────┘
   RACE CONDITION HANDLING (optimistic locking)
     • Every PATCH includes &version=eq.N
     • If another device wrote first → 0 rows updated
     • We re-fetch the winner's version, then retry once
     • Debounce (800 ms) ensures only one write per "burst"

   REQUIRES in index.html CSP:
     connect-src 'self'
       https://vbtzptvgbzsvrustnwiz.supabase.co
       wss://vbtzptvgbzsvrustnwiz.supabase.co;

   REQUIRES supabase.js to define:
     SUPABASE_CLIPBOARD_KEY   (anon key)
     SUPABASE_CLIPBOARD_URL   (Vercel proxy base, e.g. /api/sb-clipboard)

   SCRIPT ORDER in index.html:
     1. supabase CDN  (@supabase/supabase-js v2)
     2. supabase.js   (defines the two constants above)
     3. this file
═══════════════════════════════════════════════════════════════ */

const AppLiveClipboard = (function () {
'use strict';

/* ─── CONFIG ────────────────────────────────────────────────── */
// WS must use the direct Supabase URL — Vercel cannot proxy WebSockets
const SB_WS_URL  = 'https://vbtzptvgbzsvrustnwiz.supabase.co';
const SB_KEY     = typeof SUPABASE_CLIPBOARD_KEY !== 'undefined'
                     ? SUPABASE_CLIPBOARD_KEY
                     : null;
const REST_BASE  = typeof SUPABASE_CLIPBOARD_URL !== 'undefined'
                     ? SUPABASE_CLIPBOARD_URL
                     : SB_WS_URL;   // graceful fallback to direct URL

const DEBOUNCE_MS      = 800;   // keystroke → DB write delay
const POLL_MS          = 2000;  // how often to check DB when WS is down
const POLL_PAUSE_MS    = 3000;  // pause polling after our own write
const HEARTBEAT_MS     = 30000; // how often to refresh our presence row in DB
const PRESENCE_TTL_MS  = 65000; // rows older than this are considered gone
const MAX_RECONNECT    = 4;
const RECONNECT_BASE   = 2500;

/* ─── STATE ─────────────────────────────────────────────────── */
let _sb             = null;
let _channel        = null;
let _code           = null;
let _version        = 0;
let _debounce       = null;
let _reconnectTimer = null;
let _reconnectN     = 0;
let _pollTimer      = null;
let _pollPaused     = false;     // true for POLL_PAUSE_MS after our own write
let _heartbeatTimer = null;      // DB presence heartbeat
let _applying       = false;     // true while updating textarea from remote
let _wsAlive        = false;     // true when Realtime is SUBSCRIBED
let _deviceId       = 'lcb_' + Math.random().toString(36).slice(2, 10);

/* ─── DIAGNOSTICS ───────────────────────────────────────────── */
function dbg(...args) {
  console.log('[LiveClip]', ...args);
}

/* ─── SUPABASE CLIENT (lazy) ────────────────────────────────── */
function getClient() {
  if (_sb) return _sb;
  if (!window.supabase?.createClient) {
    console.error('[LiveClip] FATAL: window.supabase.createClient not found. ' +
      'Check that @supabase/supabase-js v2 CDN script loaded before this file.');
    return null;
  }
  _sb = window.supabase.createClient(SB_WS_URL, SB_KEY, {
    auth:     { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } }
  });
  dbg('Supabase client created. WS URL:', SB_WS_URL);
  return _sb;
}

/* ─── REST HELPERS ──────────────────────────────────────────── */
function restHeaders() {
  return {
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  };
}

async function restGet(code) {
  const url = REST_BASE + '/rest/v1/live_sessions?code=eq.' + encodeURIComponent(code);
  dbg('GET', url);
  const res = await fetch(url, { headers: restHeaders() });
  if (!res.ok) { dbg('GET failed', res.status, await res.text()); return null; }
  const rows = await res.json();
  dbg('GET result:', rows);
  return rows[0] ?? null;
}

async function restPost(code) {
  const url = REST_BASE + '/rest/v1/live_sessions';
  dbg('POST', url, code);
  const res = await fetch(url, {
    method:  'POST',
    headers: restHeaders(),
    body: JSON.stringify({
      code,
      content:    '',
      version:    0,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    })
  });
  if (!res.ok) {
    const err = await res.text();
    dbg('POST failed', res.status, err);
    throw new Error('Create session failed: ' + err);
  }
  dbg('POST ok');
}

/* ─── DB PRESENCE ───────────────────────────────────────────────
   Tracks connected devices in live_presence table.
   Works regardless of WebSocket status — pure REST.
   Each device upserts a row on join and every 30 s.
   Rows older than PRESENCE_TTL_MS are treated as gone.
   On leave we DELETE our row immediately for instant count drop.  */

async function presenceUpsert() {
  if (!_code) return;
  try {
    await fetch(REST_BASE + '/rest/v1/live_presence', {
      method:  'POST',
      headers: { ...restHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        session_code: _code,
        device_id:    _deviceId,
        last_seen:    new Date().toISOString()
      })
    });
  } catch (e) { dbg('presenceUpsert error:', e); }
}

async function presenceDelete() {
  if (!_code) return;
  try {
    await fetch(
      REST_BASE + '/rest/v1/live_presence' +
        '?session_code=eq.' + _code +
        '&device_id=eq.'    + _deviceId,
      { method: 'DELETE', headers: restHeaders() }
    );
  } catch (e) { dbg('presenceDelete error:', e); }
}

async function presenceCount() {
  if (!_code) return 1;
  try {
    const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
    const res = await fetch(
      REST_BASE + '/rest/v1/live_presence' +
        '?session_code=eq.' + _code +
        '&last_seen=gte.'   + encodeURIComponent(cutoff) +
        '&select=device_id',
      { headers: { ...restHeaders(), 'Prefer': 'count=exact' } }
    );
    if (!res.ok) return 1;
    // PostgREST returns count in Content-Range: 0-N/TOTAL
    const range = res.headers.get('Content-Range') ?? '';
    const total = parseInt(range.split('/')[1] ?? '1', 10);
    dbg('presenceCount from DB:', total);
    return isNaN(total) ? 1 : total;
  } catch (e) { dbg('presenceCount error:', e); return 1; }
}

function startHeartbeat() {
  stopHeartbeat();
  presenceUpsert();                         // immediate on join
  _heartbeatTimer = setInterval(presenceUpsert, HEARTBEAT_MS);
  dbg('Heartbeat started every', HEARTBEAT_MS, 'ms');
}

function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}


// Only succeeds if DB version still matches _version.
// On race-loss: re-fetch winner's version, retry once.
async function persistContent(content, isRetry = false) {
  if (!_code) return;
  const expected = _version;

  const url = REST_BASE + '/rest/v1/live_sessions' +
    '?code=eq.'    + _code +
    '&version=eq.' + expected;
  dbg('PATCH version', expected, '→', expected + 1);

  try {
    const res = await fetch(url, {
      method:  'PATCH',
      headers: restHeaders(),
      body: JSON.stringify({
        content,
        version:    expected + 1,
        updated_at: new Date().toISOString()
      })
    });
    if (!res.ok) { dbg('PATCH http error', res.status); return; }

    const rows = await res.json();
    if (rows.length === 0) {
      dbg('PATCH: race lost (version mismatch). Re-fetching…');
      const latest = await restGet(_code);
      if (!latest) return;
      _version = latest.version;
      if (!isRetry) {
        dbg('PATCH: retry with new version', _version);
        await persistContent(content, true);
      }
    } else {
      _version = expected + 1;
      dbg('PATCH: success. New version:', _version);
    }

    // Pause polling briefly so we don't echo our own write back
    _pollPaused = true;
    setTimeout(() => { _pollPaused = false; }, POLL_PAUSE_MS);

  } catch (err) {
    dbg('PATCH error:', err);
  }
}

/* ─── POLLING FALLBACK ──────────────────────────────────────── */
// Always running while in a session. Acts as safety net:
// - catches messages missed while WS was down
// - primary sync mechanism if WS never connects (e.g. CSP still wrong)
function startPolling() {
  stopPolling();
  dbg('Polling started every', POLL_MS, 'ms');
  _pollTimer = setInterval(async () => {
    if (!_code || _pollPaused) return;
    try {
      // Fetch content + presence count in parallel
      const [row, count] = await Promise.all([
        restGet(_code),
        presenceCount()
      ]);
      updatePresence(count);
      if (!row) return;
      if (row.version > _version) {
        dbg('Poll: new version', row.version, '(had', _version + ')');
        _version = row.version;
        applyRemoteContent(row.content);
      }
    } catch (e) {
      dbg('Poll error:', e);
    }
  }, POLL_MS);
}

function stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    dbg('Polling stopped');
  }
}

/* ─── REALTIME CHANNEL ──────────────────────────────────────── */
async function connectChannel(code) {
  const sb = getClient();
  if (!sb) {
    dbg('No Supabase client — staying on polling-only mode');
    setStatus('polling');
    return;
  }

  // Tear down old channel cleanly
  if (_channel) {
    dbg('Removing old channel');
    try { await _channel.untrack(); } catch { /* ignore */ }
    await sb.removeChannel(_channel);
    _channel = null;
    _wsAlive  = false;
  }

  setStatus('connecting');
  dbg('Creating channel lcb:' + code);

  _channel = sb
    .channel('lcb:' + code, {
      config: {
        broadcast: { self: false },   // don't echo our own sends back
        presence:  { key: _deviceId }
      }
    })

    /* ── Instant peer content updates via WS ── */
    .on('broadcast', { event: 'content' }, ({ payload }) => {
      if (!payload || payload.deviceId === _deviceId) return;
      dbg('Broadcast received from', payload.deviceId,
          '| content len:', (payload.content ?? '').length);

      // Merge version: accept broadcast only if it's ahead of us.
      // If behind (we just wrote), ignore — our DB write already won.
      if (typeof payload.version === 'number' && payload.version <= _version) {
        dbg('Broadcast ignored (stale version', payload.version, '<= ours', _version + ')');
        return;
      }
      if (typeof payload.version === 'number') _version = payload.version;
      applyRemoteContent(payload.content ?? '');
    })

    /* ── Presence ── */
    .on('presence', { event: 'sync' }, () => {
      const count = Object.keys(_channel.presenceState()).length;
      dbg('Presence sync:', count, 'devices');
      updatePresence(count);
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      if (newPresences.some(p => p.deviceId !== _deviceId)) toast('📱 Device joined');
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      if (leftPresences.some(p => p.deviceId !== _deviceId)) toast('📴 Device left');
    })

    /* ── Connection lifecycle ── */
    .subscribe(async (status, err) => {
      dbg('Channel status:', status, err ?? '');

      if (status === 'SUBSCRIBED') {
        _wsAlive        = true;
        _reconnectN     = 0;
        clearTimeout(_reconnectTimer);
        try {
          await _channel.track({ deviceId: _deviceId, joinedAt: Date.now() });
          dbg('Presence tracked');
        } catch (e) {
          dbg('Presence track failed (broadcast still works):', e);
        }
        setStatus('live');
        // Do one immediate poll to sync any content we missed while connecting
        const row = await restGet(code).catch(() => null);
        if (row && row.version > _version) {
          _version = row.version;
          applyRemoteContent(row.content);
        }

      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        _wsAlive = false;
        setStatus('reconnecting');
        dbg('WS lost. Polling is fallback. Scheduling reconnect…');
        scheduleReconnect(code);
      }
    });
}

function scheduleReconnect(code) {
  if (!_code) return;
  if (_reconnectN >= MAX_RECONNECT) {
    dbg('Max reconnect attempts reached. Polling-only from here.');
    setStatus('polling');
    return;
  }
  _reconnectN++;
  const delay = RECONNECT_BASE * _reconnectN;
  dbg(`Reconnect attempt ${_reconnectN}/${MAX_RECONNECT} in ${delay}ms`);
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => connectChannel(code), delay);
}

/* ─── APPLY REMOTE CONTENT WITHOUT DISRUPTING CURSOR ────────── */
// Preserves cursor position proportionally through the new text,
// so the local user's reading spot doesn't jump on every remote update.
function applyRemoteContent(content) {
  const ta = el('lcbTextarea');
  if (!ta) return;

  // Don't clobber active typing — if the user is mid-keystroke,
  // skip this update; the next poll or broadcast will catch up.
  if (document.activeElement === ta && !_applying) {
    const timeSinceDebounce = _debounce ? 0 : Infinity;
    if (timeSinceDebounce === 0) {
      dbg('Skipping remote update: user is actively typing');
      return;
    }
  }

  const ratio     = ta.value.length > 0 ? ta.selectionStart / ta.value.length : 0;
  const newCursor = Math.round(ratio * content.length);

  _applying = true;
  ta.value = content;
  ta.selectionStart = ta.selectionEnd = Math.min(newCursor, content.length);
  _applying = false;

  updateStats(content);
}

/* ─── BROADCAST ─────────────────────────────────────────────── */
function broadcastContent(content) {
  if (!_channel || !_wsAlive) return;
  _channel.send({
    type:    'broadcast',
    event:   'content',
    payload: { content, version: _version, deviceId: _deviceId, ts: Date.now() }
  }).catch(e => dbg('Broadcast send error:', e));
}

/* ─── UI HELPERS ────────────────────────────────────────────── */
function el(id) { return document.getElementById(id); }

function setStatus(status) {
  const dot  = el('lcbStatusDot');
  const text = el('lcbStatusText');
  const map  = {
    live:         ['live',         'live'],
    connecting:   ['connecting',   'connecting…'],
    reconnecting: ['connecting',   'reconnecting…'],
    polling:      ['connecting',   'polling (WS down)'],
    disconnected: ['disconnected', 'disconnected']
  };
  const [cls, label] = map[status] ?? ['disconnected', status];
  if (dot)  dot.className    = 'lcb-dot ' + cls;
  if (text) text.textContent = label;
  dbg('Status →', label);
}

function updatePresence(count) {
  const p = el('lcbPresence');
  if (p) p.textContent = count + ' device' + (count !== 1 ? 's' : '') + ' connected';
}

function updateStats(text) {
  const s = el('lcbStats');
  if (!s) return;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  s.textContent = words + ' words · ' + text.length + ' chars';
}

function toast(msg) {
  if (typeof showToast === 'function') showToast(msg, '');
  else dbg('TOAST:', msg);
}

function showCodeDigits(code) {
  const wrap = el('lcbCodeDigits');
  if (!wrap) return;
  wrap.innerHTML = [...code].map(c => `<span class="lcb-digit">${c}</span>`).join('');
}

function showJoinScreen() {
  const j = el('lcbJoinScreen');
  const s = el('lcbSessionScreen');
  if (j) j.style.display = 'flex';
  if (s) s.style.display = 'none';
  const inp = el('lcbCodeInput');
  if (inp) inp.value = '';
}

function showSessionScreen(code, content) {
  const j = el('lcbJoinScreen');
  const s = el('lcbSessionScreen');
  if (j) j.style.display = 'none';
  if (s) s.style.display = 'flex';
  showCodeDigits(code);
  const ta = el('lcbTextarea');
  if (ta) ta.value = content ?? '';
  updateStats(content ?? '');
  setStatus('connecting');
}

/* ─── PUBLIC: HOST ──────────────────────────────────────────── */
async function hostSession() {
  const btn = el('lcbHostBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…'; }
  try {
    if (!SB_KEY) throw new Error('SUPABASE_CLIPBOARD_KEY is not defined — check supabase.js');
    const code = generateCode();
    dbg('Hosting session', code);
    await restPost(code);
    _code           = code;
    _version        = 0;
    _reconnectN     = 0;
    showSessionScreen(code, '');
    startPolling();
    startHeartbeat();
    connectChannel(code);
  } catch (e) {
    console.error('[LiveClip] hostSession error:', e);
    toast('✗ ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '＋ New Session'; }
  }
}

/* ─── PUBLIC: JOIN ──────────────────────────────────────────── */
async function joinSession() {
  const input = el('lcbCodeInput');
  const raw   = (input?.value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 6) { toast('⚠ Enter a 6-character code'); return; }

  const btn = el('lcbJoinBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Joining…'; }
  try {
    if (!SB_KEY) throw new Error('SUPABASE_CLIPBOARD_KEY is not defined — check supabase.js');
    dbg('Joining session', raw);
    const session = await restGet(raw);
    if (!session) { toast('✗ Session not found or expired'); return; }
    _code       = raw;
    _version    = session.version;
    _reconnectN = 0;
    showSessionScreen(raw, session.content);
    startPolling();
    startHeartbeat();
    connectChannel(raw);
  } catch (e) {
    console.error('[LiveClip] joinSession error:', e);
    toast('✗ ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Join →'; }
  }
}

/* ─── PUBLIC: LEAVE ─────────────────────────────────────────── */
async function leaveSession() {
  dbg('Leaving session');
  clearTimeout(_debounce);
  clearTimeout(_reconnectTimer);
  stopPolling();
  stopHeartbeat();
  await presenceDelete();                  // instant count drop for other devices
  _reconnectN = MAX_RECONNECT + 1;

  if (_channel) {
    const sb = getClient();
    try { await _channel.untrack(); } catch { /* ignore */ }
    if (sb) await sb.removeChannel(_channel);
    _channel = null;
    _wsAlive  = false;
  }
  _code    = null;
  _version = 0;
  showJoinScreen();
  setStatus('disconnected');
}

/* ─── PUBLIC: COPY CODE ─────────────────────────────────────── */
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

/* ─── PUBLIC: COPY CONTENT ──────────────────────────────────── */
function copyContent() {
  const ta = el('lcbTextarea');
  if (!ta?.value.trim()) return;
  navigator.clipboard.writeText(ta.value).then(() => toast('✓ Copied to clipboard'));
}

/* ─── PUBLIC: CLEAR CONTENT ─────────────────────────────────── */
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

/* ─── SESSION CODE GENERATOR ────────────────────────────────── */
// Excludes ambiguous characters: 0/O, 1/I, 5/S
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/* ─── INPUT HANDLER ─────────────────────────────────────────── */
function onInput() {
  if (_applying || !_code) return;
  const ta = el('lcbTextarea');
  if (!ta) return;
  const content = ta.value;

  updateStats(content);
  broadcastContent(content);         // 1. Instant WS delivery to peers

  clearTimeout(_debounce);           // 2. DB write 800ms after last keystroke
  _debounce = setTimeout(() => {
    _debounce = null;
    persistContent(content);
  }, DEBOUNCE_MS);
}

/* ─── CODE INPUT FORMATTER ──────────────────────────────────── */
function onCodeInput(e) {
  const inp = e.target;
  inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (inp.value.length === 6) el('lcbJoinBtn')?.focus();
}

/* ─── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Validate constants loaded correctly
  if (!SB_KEY) {
    console.error('[LiveClip] SUPABASE_CLIPBOARD_KEY is not defined. ' +
      'Make sure supabase.js is loaded BEFORE live-clipboard.js in index.html.');
  }
  dbg('Init complete. Device ID:', _deviceId);
  dbg('REST base:', REST_BASE);
  dbg('WS URL:', SB_WS_URL);

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
