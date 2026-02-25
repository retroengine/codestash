/* ═══════════════════════════════════════════════════════════════
   AppLiveClipboard  —  Real-time shared clipboard + file share
   ─────────────────────────────────────────────────────────────
   SYNC:      WebSocket broadcast (~50ms) + DB poll every 2s
   PRESENCE:  DB heartbeat 10s, TTL 25s
   FILE:      One file per session via Supabase Storage (max 15MB)
              path stored in live_sessions.file_path

   CDN (index.html):
     https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js

   CSP connect-src must include:
     https://vbtzptvgbzsvrustnwiz.supabase.co
     wss://vbtzptvgbzsvrustnwiz.supabase.co
═══════════════════════════════════════════════════════════════ */

const AppLiveClipboard = (function () {
'use strict';

/* ─── CONFIG ────────────────────────────────────────────────── */
const SB_URL         = 'https://vbtzptvgbzsvrustnwiz.supabase.co';
const SB_KEY         = typeof SUPABASE_CLIPBOARD_KEY !== 'undefined' ? SUPABASE_CLIPBOARD_KEY : null;
const REST_BASE      = typeof SUPABASE_CLIPBOARD_URL !== 'undefined' ? SUPABASE_CLIPBOARD_URL : SB_URL;
const STORAGE_BUCKET = 'live-clipboard-files';
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const DEBOUNCE_MS    = 800;
const POLL_MS        = 2000;
const POLL_PAUSE_MS  = 3000;
const HEARTBEAT_MS   = 10000;
const PRESENCE_TTL   = 25000;
const MAX_RECONNECT  = 4;
const RECONNECT_BASE = 2500;

/* ─── STATE ─────────────────────────────────────────────────── */
let _sb             = null;
let _channel        = null;
let _code           = null;
let _version        = 0;
let _debounce       = null;
let _reconnectTimer = null;
let _reconnectN     = 0;
let _pollTimer      = null;
let _pollPaused     = false;
let _heartbeatTimer = null;
let _applying       = false;
let _wsAlive        = false;
let _file           = null;  // { name, size, type, path } | null
let _deviceId       = 'lcb_' + Math.random().toString(36).slice(2, 10);

/* ─── UTILS ─────────────────────────────────────────────────── */
function dbg(...a) { console.log('[LiveClip]', ...a); }
function el(id)    { return document.getElementById(id); }
function toast(m)  { if (typeof showToast === 'function') showToast(m, ''); }

function fmtBytes(b) {
  if (b < 1024)        return b + ' B';
  if (b < 1048576)     return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function fileIcon(type = '') {
  if (type.startsWith('image/'))  return '🖼️';
  if (type.startsWith('video/'))  return '🎬';
  if (type.startsWith('audio/'))  return '🎵';
  if (type.includes('pdf'))       return '📕';
  if (type.includes('zip') || type.includes('tar')) return '🗜️';
  if (type.includes('spreadsheet') || type.includes('excel')) return '📊';
  if (type.includes('document') || type.includes('word'))     return '📝';
  return '📄';
}

/* ─── SUPABASE CLIENT ───────────────────────────────────────── */
function getClient() {
  if (_sb) return _sb;
  if (!window.supabase?.createClient) {
    console.error('[LiveClip] FATAL: window.supabase.createClient not found.\n' +
      'Use: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
    return null;
  }
  _sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth:     { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } }
  });
  dbg('Supabase client ready');
  return _sb;
}

/* ─── REST HELPERS ──────────────────────────────────────────── */
function rh(extra) {
  return Object.assign({
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  }, extra);
}

async function restGet(code) {
  const res = await fetch(REST_BASE + '/rest/v1/live_sessions?code=eq.' + encodeURIComponent(code), { headers: rh() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

async function restPost(code) {
  const res = await fetch(REST_BASE + '/rest/v1/live_sessions', {
    method: 'POST', headers: rh(),
    body: JSON.stringify({ code, content: '', version: 0, expires_at: new Date(Date.now() + 86400000).toISOString() })
  });
  if (!res.ok) throw new Error('Create failed: ' + await res.text());
}

/* ─── OPTIMISTIC-LOCK CONTENT PATCH ────────────────────────── */
async function persistContent(content, isRetry) {
  if (!_code) return;
  const expected = _version;
  try {
    const res = await fetch(
      REST_BASE + '/rest/v1/live_sessions?code=eq.' + _code + '&version=eq.' + expected,
      { method: 'PATCH', headers: rh(), body: JSON.stringify({ content, version: expected + 1, updated_at: new Date().toISOString() }) }
    );
    if (!res.ok) return;
    const rows = await res.json();
    if (rows.length === 0) {
      const latest = await restGet(_code);
      if (latest) { _version = latest.version; if (!isRetry) persistContent(content, true); }
    } else {
      _version = expected + 1;
    }
    _pollPaused = true;
    setTimeout(() => { _pollPaused = false; }, POLL_PAUSE_MS);
  } catch (e) { dbg('persistContent error:', e); }
}

/* ─── PRESENCE ──────────────────────────────────────────────── */
async function presenceUpsert() {
  if (!_code) return;
  try {
    const res = await fetch(REST_BASE + '/rest/v1/live_presence', {
      method: 'POST',
      headers: rh({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ session_code: _code, device_id: _deviceId, last_seen: new Date().toISOString() })
    });
    if (!res.ok) dbg('presenceUpsert error', res.status, await res.text());
  } catch (e) { dbg('presenceUpsert error:', e); }
}

async function presenceDelete(code) {
  const c = code || _code;
  if (!c) return;
  try {
    await fetch(REST_BASE + '/rest/v1/live_presence?session_code=eq.' + c + '&device_id=eq.' + _deviceId,
      { method: 'DELETE', headers: rh() }
    );
  } catch { /* ignore on leave */ }
}

async function presenceCount() {
  if (!_code) return 1;
  try {
    const cutoff = new Date(Date.now() - PRESENCE_TTL).toISOString();
    const res = await fetch(
      REST_BASE + '/rest/v1/live_presence?session_code=eq.' + _code + '&last_seen=gte.' + encodeURIComponent(cutoff) + '&select=device_id',
      { headers: rh() }
    );
    if (!res.ok) return 1;
    const rows = await res.json();
    dbg('presenceCount from DB:', Array.isArray(rows) ? rows.length : '?');
    return Array.isArray(rows) ? rows.length : 1;
  } catch { return 1; }
}

function startHeartbeat() { stopHeartbeat(); presenceUpsert(); _heartbeatTimer = setInterval(presenceUpsert, HEARTBEAT_MS); }
function stopHeartbeat()  { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }

/* ─── POLLING FALLBACK ──────────────────────────────────────── */
function startPolling() {
  stopPolling();
  _pollTimer = setInterval(async () => {
    if (!_code || _pollPaused) return;
    try {
      const [row, count] = await Promise.all([ restGet(_code), presenceCount() ]);
      updatePresence(count);
      if (!row) return;
      if (row.version > _version) { _version = row.version; applyRemoteContent(row.content); }
      syncFileFromRow(row);
    } catch (e) { dbg('Poll error:', e); }
  }, POLL_MS);
}
function stopPolling() { clearInterval(_pollTimer); _pollTimer = null; }

/* ─── REALTIME CHANNEL ──────────────────────────────────────── */
async function connectChannel(code) {
  const sb = getClient();
  if (!sb) { setStatus('connected'); return; }

  if (_channel) {
    try { await _channel.untrack(); } catch { /* ignore */ }
    await sb.removeChannel(_channel);
    _channel = null; _wsAlive = false;
  }
  setStatus('connecting');

  _channel = sb.channel('lcb:' + code, { config: { broadcast: { self: false }, presence: { key: _deviceId } } })
    .on('broadcast', { event: 'content' }, ({ payload }) => {
      if (!payload || payload.deviceId === _deviceId) return;
      if (typeof payload.version === 'number' && payload.version <= _version) return;
      if (typeof payload.version === 'number') _version = payload.version;
      applyRemoteContent(payload.content ?? '');
    })
    .on('presence', { event: 'sync'  }, () => { updatePresence(Object.keys(_channel.presenceState()).length); })
    .on('presence', { event: 'join'  }, ({ newPresences }) => { if (newPresences.some(p => p.deviceId !== _deviceId)) toast('📱 Device joined'); })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => { if (leftPresences.some(p => p.deviceId !== _deviceId)) toast('📴 Device left'); })
    .subscribe(async (status, err) => {
      dbg('Channel status:', status, err || '');
      if (status === 'SUBSCRIBED') {
        _wsAlive = true; _reconnectN = 0; clearTimeout(_reconnectTimer);
        try { await _channel.track({ deviceId: _deviceId, joinedAt: Date.now() }); } catch { /* ok */ }
        setStatus('connected');
        const row = await restGet(code).catch(() => null);
        if (row) { if (row.version > _version) { _version = row.version; applyRemoteContent(row.content); } syncFileFromRow(row); }
      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        _wsAlive = false; setStatus('connected');
        if (!_reconnectN) dbg('WS down — polling covers sync');
        scheduleReconnect(code);
      }
    });
}

function scheduleReconnect(code) {
  if (!_code || _reconnectN >= MAX_RECONNECT) return;
  _reconnectN++;
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => connectChannel(code), RECONNECT_BASE * _reconnectN);
}

/* ─── APPLY REMOTE CONTENT ──────────────────────────────────── */
function applyRemoteContent(content) {
  const ta = el('lcbTextarea');
  if (!ta) return;
  if (document.activeElement === ta && _debounce) return;
  const ratio = ta.value.length > 0 ? ta.selectionStart / ta.value.length : 0;
  _applying = true;
  ta.value = content;
  ta.selectionStart = ta.selectionEnd = Math.min(Math.round(ratio * content.length), content.length);
  _applying = false;
  updateStats(content);
}

function broadcastContent(content) {
  if (!_channel || !_wsAlive) return;
  _channel.send({ type: 'broadcast', event: 'content', payload: { content, version: _version, deviceId: _deviceId, ts: Date.now() } }).catch(() => {});
}

/* ─── FILE: DB SYNC ─────────────────────────────────────────── */
function syncFileFromRow(row) {
  const remotePath = row.file_path ?? null;
  const localPath  = _file?.path ?? null;
  if (remotePath === localPath) return;
  _file = remotePath ? { name: row.file_name, size: row.file_size, type: row.file_type, path: row.file_path } : null;
  renderFileCard(_file, false);
}

async function persistFileMeta(meta) {
  if (!_code) return;
  try {
    await fetch(REST_BASE + '/rest/v1/live_sessions?code=eq.' + _code, {
      method: 'PATCH', headers: rh(),
      body: JSON.stringify(meta ? { file_name: meta.name, file_size: meta.size, file_type: meta.type, file_path: meta.path }
                                : { file_name: null, file_size: null, file_type: null, file_path: null })
    });
  } catch (e) { dbg('persistFileMeta error:', e); }
}

/* ─── FILE: UPLOAD ──────────────────────────────────────────── */
async function uploadFile(file) {
  if (file.size > MAX_FILE_BYTES) { toast('✗ File too large — max 15 MB'); return; }
  if (_file?.path) await deleteStorageFile(_file.path);

  const path = _code + '/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  showFileProgress(true); setFileProgress(0, 'Uploading…');

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', SB_URL + '/storage/v1/object/' + STORAGE_BUCKET + '/' + path);
      xhr.setRequestHeader('apikey', SB_KEY);
      xhr.setRequestHeader('Authorization', 'Bearer ' + SB_KEY);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.upload.onprogress = e => { if (e.lengthComputable) setFileProgress(e.loaded / e.total * 100, 'Uploading…'); };
      xhr.onload  = () => xhr.status < 300 ? resolve() : reject(new Error('HTTP ' + xhr.status));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(file);
    });

    setFileProgress(100, 'Done');
    const meta = { name: file.name, size: file.size, type: file.type || 'application/octet-stream', path };
    _file = meta;
    await persistFileMeta(meta);
    showFileProgress(false);
    renderFileCard(meta, true);
    toast('✓ File attached to session');
  } catch (e) {
    dbg('uploadFile error:', e);
    showFileProgress(false);
    renderFileCard(null, true);
    toast('✗ Upload failed — ' + e.message);
  }
}

async function deleteStorageFile(path) {
  if (!path) return;
  try {
    await fetch(SB_URL + '/storage/v1/object/' + STORAGE_BUCKET + '/' + path,
      { method: 'DELETE', headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
  } catch { /* ignore */ }
}

async function removeFile() {
  if (!_file) return;
  if (!confirm('Remove file from session? All connected devices will lose access.')) return;
  const path = _file.path;
  _file = null;
  renderFileCard(null, true);
  await Promise.allSettled([ deleteStorageFile(path), persistFileMeta(null) ]);
  toast('✓ File removed');
}

async function downloadFile() {
  if (!_file?.path) return;
  try {
    const res = await fetch(SB_URL + '/storage/v1/object/' + STORAGE_BUCKET + '/' + _file.path,
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    if (!res.ok) { toast('✗ Download failed'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = _file.name;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('✗ ' + e.message); }
}

/* ─── FILE UI ───────────────────────────────────────────────── */
function renderFileCard(meta, _isOwner) {
  const drop = el('lcbFileDrop');
  const card = el('lcbFileCard');
  if (!meta) {
    if (drop) drop.style.display = '';
    if (card) card.style.display = 'none';
    return;
  }
  if (drop) drop.style.display = 'none';
  if (card) card.style.display = '';
  const n = el('lcbFileName'); if (n) n.textContent = meta.name;
  const s = el('lcbFileSize'); if (s) s.textContent = fmtBytes(meta.size);
  const i = el('lcbFileIcon'); if (i) i.textContent = fileIcon(meta.type);
  const d = el('lcbFileDownloadBtn'); if (d) d.style.display = '';
  const r = el('lcbFileRemoveBtn');   if (r) r.style.display = '';
}

function showFileProgress(show) {
  const prog = el('lcbFileProgress'); if (prog) prog.style.display = show ? '' : 'none';
  const drop = el('lcbFileDrop');
  const card = el('lcbFileCard');
  if (show) { if (drop) drop.style.display = 'none'; if (card) card.style.display = 'none'; }
}

function setFileProgress(pct, label) {
  const bar = el('lcbFileProgressBar'); if (bar) bar.style.width = pct + '%';
  const txt = el('lcbFileProgressText'); if (txt) txt.textContent = label;
}

function initFileDropZone() {
  const drop  = el('lcbFileDrop');
  const input = el('lcbFileInput');
  if (!drop || !input) return;
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) uploadFile(input.files[0]); input.value = ''; });
  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', ()  => drop.classList.remove('dragover'));
  drop.addEventListener('drop',      e  => { e.preventDefault(); drop.classList.remove('dragover'); if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });
}

/* ─── UI HELPERS ────────────────────────────────────────────── */
function setStatus(status) {
  const dot  = el('lcbStatusDot');
  const text = el('lcbStatusText');
  const map  = { connected: ['live', 'connected'], connecting: ['connecting', 'connecting'], reconnecting: ['connecting', 'reconnecting'], disconnected: ['disconnected', 'disconnected'] };
  const [cls, label] = map[status] || ['disconnected', status];
  if (dot)  dot.className    = 'lcb-dot ' + cls;
  if (text) text.textContent = label;
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

function showCodeDigits(code) {
  const wrap = el('lcbCodeDigits');
  if (!wrap) return;
  wrap.innerHTML = [...code].map(c => '<span class="lcb-digit">' + c + '</span>').join('');
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function showJoinScreen() {
  const j = el('lcbJoinScreen'); const s = el('lcbSessionScreen');
  if (j) j.style.display = 'flex';
  if (s) s.style.display = 'none';
  const i = el('lcbCodeInput'); if (i) i.value = '';
}

function showSessionScreen(code, content, row) {
  const j = el('lcbJoinScreen'); const s = el('lcbSessionScreen');
  if (j) j.style.display = 'none';
  if (s) s.style.display = 'flex';
  showCodeDigits(code);
  const ta = el('lcbTextarea'); if (ta) ta.value = content || '';
  updateStats(content || '');
  setStatus('connecting');
  _file = null; renderFileCard(null, false); showFileProgress(false);
  if (row) syncFileFromRow(row);
}

/* ─── PUBLIC: HOST ──────────────────────────────────────────── */
async function hostSession() {
  const btn = el('lcbHostBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…'; }
  try {
    if (!SB_KEY) throw new Error('SUPABASE_CLIPBOARD_KEY not defined');
    const code = generateCode();
    await restPost(code);
    _code = code; _version = 0; _reconnectN = 0;
    showSessionScreen(code, '', null);
    startPolling(); startHeartbeat(); connectChannel(code);
  } catch (e) { console.error('[LiveClip]', e); toast('✗ ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = '＋ New Session'; } }
}

/* ─── PUBLIC: JOIN ──────────────────────────────────────────── */
async function joinSession() {
  const input = el('lcbCodeInput');
  const raw   = (input ? input.value : '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 6) { toast('⚠ Enter a 6-character code'); return; }
  const btn = el('lcbJoinBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Joining…'; }
  try {
    if (!SB_KEY) throw new Error('SUPABASE_CLIPBOARD_KEY not defined');
    const session = await restGet(raw);
    if (!session) { toast('✗ Session not found or expired'); return; }
    _code = raw; _version = session.version; _reconnectN = 0;
    showSessionScreen(raw, session.content, session);
    startPolling(); startHeartbeat(); connectChannel(raw);
  } catch (e) { console.error('[LiveClip]', e); toast('✗ ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = 'Join →'; } }
}

/* ─── PUBLIC: LEAVE — instant UI, background cleanup ────────── */
function leaveSession() {
  clearTimeout(_debounce); clearTimeout(_reconnectTimer);
  stopPolling(); stopHeartbeat();
  _reconnectN = MAX_RECONNECT + 1;

  const ch   = _channel;
  const code = _code;
  const sb   = getClient();

  // Instant UI — user never waits
  _channel = null; _wsAlive = false; _code = null; _version = 0; _file = null;
  showJoinScreen(); setStatus('disconnected');

  // Async cleanup in background
  Promise.allSettled([
    ch   && sb ? sb.removeChannel(ch) : Promise.resolve(),
    code       ? presenceDelete(code) : Promise.resolve()
  ]);
}

/* ─── INPUT ─────────────────────────────────────────────────── */
function onInput() {
  if (_applying || !_code) return;
  const ta = el('lcbTextarea'); if (!ta) return;
  const content = ta.value;
  updateStats(content);
  broadcastContent(content);
  clearTimeout(_debounce);
  _debounce = setTimeout(() => { _debounce = null; persistContent(content); }, DEBOUNCE_MS);
}

function onCodeInput(e) {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (e.target.value.length === 6) { const b = el('lcbJoinBtn'); if (b) b.focus(); }
}

/* ─── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!SB_KEY) console.error('[LiveClip] SUPABASE_CLIPBOARD_KEY not defined — check supabase.js loads before this file');
  dbg('Init. Device:', _deviceId, '| REST:', REST_BASE);

  el('lcbTextarea')       && el('lcbTextarea').addEventListener('input', onInput);
  el('lcbCodeInput')      && el('lcbCodeInput').addEventListener('input', onCodeInput);
  el('lcbCodeInput')      && el('lcbCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinSession(); });
  el('lcbHostBtn')        && el('lcbHostBtn').addEventListener('click', hostSession);
  el('lcbJoinBtn')        && el('lcbJoinBtn').addEventListener('click', joinSession);
  el('lcbLeaveBtn')       && el('lcbLeaveBtn').addEventListener('click', leaveSession);
  el('lcbCopyCodeBtn')    && el('lcbCopyCodeBtn').addEventListener('click', () => {
    if (!_code) return;
    navigator.clipboard.writeText(_code).then(() => {
      const btn = el('lcbCopyCodeBtn'); if (!btn) return;
      const prev = btn.innerHTML;
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => { btn.innerHTML = prev; }, 2000);
    });
  });
  el('lcbCopyBtn')        && el('lcbCopyBtn').addEventListener('click', () => {
    const ta = el('lcbTextarea');
    if (ta && ta.value.trim()) navigator.clipboard.writeText(ta.value).then(() => toast('✓ Copied to clipboard'));
  });
  el('lcbClearBtn')       && el('lcbClearBtn').addEventListener('click', () => {
    const ta = el('lcbTextarea');
    if (!ta || !ta.value.trim()) return;
    if (!confirm('Clear text? This affects all connected devices.')) return;
    clearTimeout(_debounce); ta.value = ''; updateStats(''); broadcastContent(''); persistContent('');
  });
  el('lcbFileDownloadBtn') && el('lcbFileDownloadBtn').addEventListener('click', downloadFile);
  el('lcbFileRemoveBtn')   && el('lcbFileRemoveBtn').addEventListener('click', removeFile);

  initFileDropZone();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _code) presenceUpsert();
  });

  window.addEventListener('beforeunload', () => {
    if (!_code) return;
    fetch(REST_BASE + '/rest/v1/live_presence?session_code=eq.' + _code + '&device_id=eq.' + _deviceId,
      { method: 'DELETE', headers: rh(), keepalive: true }
    ).catch(() => {});
  });
});

return { hostSession, joinSession, leaveSession };
})();
