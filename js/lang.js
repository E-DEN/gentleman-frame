// lang.js — 言語・テーマ・言語インポートダイアログ

import { _presetsReady } from './state.js';
import { loaded, _readCssVars, _updateArLockBtn } from './canvas.js';
import { resetHintState, _updateCanvasHints } from './render.js';

// presets.js はこのコールバックを注入して循環依存を実行時に解決する
let _renderPresets = null;
export function _setRenderPresets(fn) { _renderPresets = fn; }

// ---- 言語 ----
export function applyLang(lang) {
  _lang = lang;
  localStorage.setItem('gf-lang', lang);
  document.documentElement.lang = lang;
  rebuildLangDialog();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (el.classList.contains('drop-label0') && loaded[0]) return;
    if (el.classList.contains('drop-label1') && loaded[1]) return;
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  const isNowDark = document.documentElement.dataset.theme === 'dark';
  document.getElementById('themeBtn').innerHTML =
    `<i data-lucide="${isNowDark ? 'moon' : 'sun'}"></i>`;
  document.getElementById('themeBtn').title = t(isNowDark ? 'mode-dark' : 'mode-light');
  const isTheater = document.querySelector('.app-body').classList.contains('theater');
  document.getElementById('theaterBtn').title = t(isTheater ? 'theater-close' : 'theater-open');
  const isFs = !!document.fullscreenElement;
  document.getElementById('fullscreenBtn').title = t(isFs ? 'fs-close' : 'fs-open');
  _updateArLockBtn();
  resetHintState();
  _updateCanvasHints();
  if (_presetsReady && _renderPresets) _renderPresets();
  lucide.createIcons();
}

// ---- テーマ切り替え ----
document.getElementById('themeBtn').addEventListener('click', () => {
  const html = document.documentElement;
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  _readCssVars();
  document.getElementById('themeBtn').innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
  document.getElementById('themeBtn').title = t(isDark ? 'mode-light' : 'mode-dark');
  const bc = document.getElementById('borderColor');
  if (bc.value === '#ffffff' || bc.value === '#5c6370') {
    bc.value = '#ffffff';
  }
  lucide.createIcons();
});

// ---- 言語ダイアログ構築 ----
export function rebuildLangDialog() {
  const list = document.getElementById('langOptionList');
  list.innerHTML = '';
  let extCodes = [];
  try { extCodes = JSON.parse(localStorage.getItem('gf-ext-langs') || '[]').map(x => x.code); } catch (e) {}

  getRegisteredLangs().forEach(({ code, label }) => {
    const isExt = extCodes.includes(code);
    const btn = document.createElement('button');
    btn.className = 'lang-option-item' + (code === _lang ? ' active' : '');
    btn.innerHTML =
      `<span class="lang-option-check">${code === _lang ? '✓' : ''}</span>` +
      `<span style="flex:1">${label}</span>` +
      (isExt ? `<span class="lang-option-del" title="削除" data-code="${code}" style="margin-left:4px;opacity:0.5;font-size:12px;padding:0 4px;line-height:1">✕</span>` : '');
    btn.addEventListener('click', e => {
      if (e.target.closest('.lang-option-del')) {
        e.stopPropagation();
        const delCode = e.target.closest('.lang-option-del').dataset.code;
        try {
          const saved = JSON.parse(localStorage.getItem('gf-ext-langs') || '[]').filter(x => x.code !== delCode);
          localStorage.setItem('gf-ext-langs', JSON.stringify(saved));
        } catch (err) {}
        unregisterLang(delCode);
        if (_lang === delCode) applyLang('ja');
        rebuildLangDialog();
        return;
      }
      applyLang(code);
      document.getElementById('langAddSection').hidden = true;
      document.getElementById('langImportDialog').hidden = true;
    });
    list.appendChild(btn);
  });
  const addBtn = document.createElement('button');
  addBtn.id = 'langAddToggle';
  addBtn.className = 'lang-option-item lang-option-add';
  const _sec = document.getElementById('langAddSection');
  const _addLabel = () => _sec.hidden ? t('lang-add') : t('lang-cancel');
  addBtn.innerHTML = `<span class="lang-option-check"></span><span>${_addLabel()}</span>`;
  addBtn.addEventListener('click', () => {
    const wasOpen = !_sec.hidden;
    _sec.hidden = !_sec.hidden;
    addBtn.querySelector('span:last-child').textContent = _addLabel();
    if (!_sec.hidden) {
      document.getElementById('langImportText').value = '';
      document.getElementById('langImportDrop').classList.remove('hover');
    } else if (wasOpen) {
      document.getElementById('langImportDialog').hidden = true;
    }
  });
  list.appendChild(addBtn);
}
rebuildLangDialog();

lucide.createIcons();
applyLang(_lang);

// ---- 言語インポートダイアログ ----
(function () {
  const dialog   = document.getElementById('langImportDialog');
  const dropEl   = document.getElementById('langImportDrop');
  const textEl   = document.getElementById('langImportText');
  const applyBtn = document.getElementById('langImportApply');

  function _syncAddToggle() {
    const toggle = document.getElementById('langAddToggle');
    if (toggle) toggle.querySelector('span:last-child').textContent = t('lang-add');
  }

  function resetDialog() {
    textEl.value = '';
    dropEl.classList.remove('hover');
    document.getElementById('langAddSection').hidden = true;
    _syncAddToggle();
  }

  function openPopover()  { rebuildLangDialog(); dialog.hidden = false; }
  function closePopover() { dialog.hidden = true; resetDialog(); }

  document.getElementById('langImportBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!dialog.hidden) { closePopover(); return; }
    resetDialog();
    openPopover();
  });

  document.addEventListener('click', (e) => {
    if (dialog.hidden) return;
    if (dialog.contains(e.target)) return;
    closePopover();
  });
  dialog.addEventListener('click', (e) => e.stopPropagation());

  function _langDialogEscape(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    const addSec = document.getElementById('langAddSection');
    if (addSec && !addSec.hidden) {
      addSec.hidden = true;
      const toggle = document.getElementById('langAddToggle');
      if (toggle) toggle.querySelector('span:last-child').textContent = t('lang-add');
    } else {
      closePopover();
    }
  }
  dialog.addEventListener('keydown', _langDialogEscape);
  textEl.addEventListener('keydown', _langDialogEscape);

  function applyJSONText(text) {
    try {
      const { code, label } = loadLangJSON(text);
      rebuildLangDialog();
      applyLang(code);
      document.getElementById('langAddSection').hidden = true;
      _syncAddToggle();
      closePopover();
    } catch (e) {
      alert(t('lang-import-err'));
    }
  }

  applyBtn.addEventListener('click', () => {
    const text = textEl.value.trim();
    if (text) applyJSONText(text);
  });

  document.getElementById('langTemplateDownload').addEventListener('click', () => {
    downloadLangTemplate();
  });

  function _isVideoTransfer(e) {
    return [...(e.dataTransfer.items || [])].some(i => i.kind === 'file' && i.type.startsWith('video/'));
  }
  dropEl.addEventListener('dragover', e => {
    if (_isVideoTransfer(e)) return;
    e.preventDefault();
    dropEl.classList.add('hover');
  });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('hover'));
  dropEl.addEventListener('drop', e => {
    if (_isVideoTransfer(e)) return;
    e.preventDefault();
    dropEl.classList.remove('hover');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => applyJSONText(ev.target.result);
    reader.readAsText(file, 'utf-8');
  });

  dropEl.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => {
      if (!inp.files[0]) return;
      const reader = new FileReader();
      reader.onload = ev => applyJSONText(ev.target.result);
      reader.readAsText(inp.files[0], 'utf-8');
    };
    inp.click();
  });
})();
