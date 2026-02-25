/* ═══════════════════════════════════════════
   MODULE: AppNotes
   Quick notes scratchpad — local only, no server.
   4 named tabs, formatting toolbar, fullscreen mode.
════════════════════════════════════════════ */

const AppNotes = (function () {
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

  return {}; // AppNotes has no public API
})(); /* end AppNotes */

  return {}; // AppClipboard has no public API
})(); /* end AppClipboard */
</script>
