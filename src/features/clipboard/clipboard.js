/* ═══════════════════════════════════════════
   MODULE: AppClipboard
   Online clipboard — upload text/files, retrieve by code.
   Uses a separate Supabase project for ephemeral data.
   Depends on: supabase.js loaded first.
════════════════════════════════════════════ */


/* ════════════════════════════════════════════
   MODULE: AppClipboard — online clipboard upload/retrieve
   Separate Supabase project for ephemeral clipboard data.
════════════════════════════════════════════ */
const AppClipboard = (function() {
'use strict';

const CB_URL = SUPABASE_CLIPBOARD_URL;  /* from shared/lib/supabase.js */
const CB_KEY = SUPABASE_CLIPBOARD_KEY;  /* from shared/lib/supabase.js */
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
  // Strict guard: must be exactly 4 digits (defence against injection via URL params etc.)
  if (!/^\d{4}$/.test(digits)) { cbShowRetrieveError('Invalid code format.'); return; }

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
      // Validate file_url is a trusted Supabase storage URL before using as href
      const trustedUrl = (typeof row.file_url === 'string' && row.file_url.startsWith(CB_URL + '/storage/'))
        ? row.file_url : '#';
      dlBtn.href     = trustedUrl;
      dlBtn.download = row.file_name || 'download';
      dlBtn.target   = '_blank';
      dlBtn.rel      = 'noopener noreferrer';
      // Use textContent for dynamic content — never innerHTML with DB values
      const dlIcon = document.createElementNS('http://www.w3.org/2000/svg','svg');
      dlIcon.setAttribute('width','13'); dlIcon.setAttribute('height','13');
      dlIcon.setAttribute('viewBox','0 0 24 24'); dlIcon.setAttribute('fill','none');
      dlIcon.setAttribute('stroke','currentColor'); dlIcon.setAttribute('stroke-width','2');
      dlIcon.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
      dlBtn.appendChild(dlIcon);
      dlBtn.appendChild(document.createTextNode(' Download ' + (row.file_name || 'File')));
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
   MODULE: AppNotes — quick notes scratchpad
══════════════════════════════════════════ */
