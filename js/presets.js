// presets.js — プリセット管理・コーデック・エクスポート/インポート

import { state, _animColors, PRESET_KEY, setPresetsReady,
  _calcOverflows } from './state.js';
import {
  canvas,
  vid, img, mediaType, loaded, visHidden,
  _loadedFileName, _loadedPageUrl, _loadedSrcUrl, _currentHandle,
  _stopBitmapCapture,
  _IDB, _missingFiles, _resolvedFiles, _pendingFiles,
  elBorderW, elBorderColor, elBorderOpacity, elBorderAnim,
  elBorderAnimSpeed, elBorderAnimBright, elFrameBlur, elFrameTint,
  elVol0, elVol1, elOffset0, elOffset1,
  elFgPinX, elFgPinY, elFgPinLerp, elFgPinOpacity,
  elFilterBlur, elFilterBrightness, elFilterContrast, elFilterSaturation,
  elFilterHue, elFilterVignette, elFilterCA, elFilterTemp, elFilterTint,
  elFilterHighlight, elFilterShadow, elFilterSharpness, elFilterMatte,
  elFilterGrain, elMaskPixel, elMaskBlur, elFilterFlare, elFilterBars,
  elFilterFps, elFilterRain, elRainSpeed, elRainRefraction, elRainShadow,
  elMaskZoom, elMaskW, elMaskH,
  elPhoneUiRow, elGlassesUiRow, elGlassesStyleBtns,
  elSpectrumUiRow,
  elPhoneUiBtnRoT, elPhoneUiBtnRec, elPhoneUiBtnDot, elPhoneUiBtnRot90,
  updateSliderFill, _syncMaskSliders,
  _activePresetIdx, setActivePresetIdx,
  _showDelPopup, _f2Target, setF2Target,
  _isDraggingPreset,
  _applyMaskFromPm,
  _pendingMask, setPendingMask,
  _bufferSynced, setCanvasAspectRatio,
  _maskBorderFadeStart, setMaskBorderFadeStart,
  setFgFadeStart,
  setModalOpen,
  _shiftHeld, _setDelBtnIcon,
  _updateFgFixedBtn, _updateArLockBtn, _updateZoomLockBtn,
} from './canvas.js';
import {
  _applyBorderAnim, _syncAnimColors,
} from './controls.js';
import { _setRenderPresets, applyLang } from './lang.js';
import { syncStop, _applyCompositeT } from './playback.js';
import { loadVideoFromHandle, loadVideoFromURL } from './media.js';
import {
  updateCanvasFilter, updateBarsOverlay,
  _startRainOverlay, _stopRainOverlay,
} from './render.js';

// ============================================================
//  プリセット CRUD
// ============================================================
export function loadPresets() { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); }
export function savePresets(list) { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); }

// ============================================================
//  設定収集 / 適用
// ============================================================
export function collectSettings() {
  return {
    vol0:          elVol0.value,
    offset0:       elOffset0.value,
    vol1:          elVol1.value,
    offset1:       elOffset1.value,
    maskX:         state.mask.x,
    maskY:         state.mask.y,
    maskW:         state.mask.w,
    maskH:         state.mask.h,
    bufW:          canvas.width,
    bufH:          canvas.height,
    maskShape:     state.mask.shape,
    arLock:        state.arLock,
    borderW:       elBorderW.value,
    borderOpacity: elBorderOpacity.value,
    borderColor:   elBorderColor.value,
    borderAnim:    elBorderAnim.value,
    borderInvert:  state.borderInvert,
    borderAnimSpeed:  elBorderAnimSpeed.value,
    borderAnimBright: elBorderAnimBright.value,
    borderAnimColors: JSON.stringify(_animColors),
    maskBlur:    elMaskBlur.value,
    maskPixel: elMaskPixel.value,
    maskZoom:      elMaskZoom.value,
    fgFixed:       state.fgFixed,
    zoomLock:      state.zoomLock,
    fgPinX:        elFgPinX.value,
    fgPinY:        elFgPinY.value,
    fgPinLerp:     elFgPinLerp.value,
    fgPinOpacity:  elFgPinOpacity.value,
    filterBrightness: elFilterBrightness.value,
    filterContrast:   elFilterContrast.value,
    filterHighlight:  elFilterHighlight.value,
    filterShadow:     elFilterShadow.value,
    filterSaturation: elFilterSaturation.value,
    filterHue:        elFilterHue.value,
    filterTemp:       elFilterTemp.value,
    filterTint:       elFilterTint.value,
    filterSharpness:  elFilterSharpness.value,
    filterCA:         elFilterCA.value,
    filterVignette:   elFilterVignette.value,
    filterMatte:      elFilterMatte.value,
    filterGrain:      elFilterGrain.value,
    filterFlare:      elFilterFlare.value,
    filterBars:       elFilterBars.value,
    filterFps:        elFilterFps.value,
    filterBlur:       elFilterBlur.value,
    filterRain:       elFilterRain.value,
    rainSpeed:        elRainSpeed.value,
    rainRefraction:   elRainRefraction.value,
    rainShadow:       elRainShadow.value,
    frameBlur:        elFrameBlur.value,
    frameTint:        elFrameTint.value,
    glassesStyle:     state.mask.glassesStyle,
    specShape:        state.mask.specShape || 'bars',
    specSym:          state.mask.specSym   || 'none',
    specRotate:       state.mask.specRotate || 0,
    specBars:         document.getElementById('specBars')?.value ?? '32',
    specAmp:          document.getElementById('specAmp')?.value  ?? '100',
    specGap:          document.getElementById('specGap')?.value  ?? '15',
    vid0Name:      _loadedFileName[0],
    vid1Name:      _loadedFileName[1],
    vid0Url:       _loadedSrcUrl[0] || _loadedPageUrl[0],
    vid1Url:       _loadedSrcUrl[1] || _loadedPageUrl[1],
    phoneLandscape: state.phoneLandscape,
    phoneShowRoT:   state.phoneShowRoT,
    phoneShowRec:   state.phoneShowRec,
    phoneShowDot:   state.phoneShowDot,
  };
}

export function applySettings(d) {
  const sliders = [
    ['vol0','vol0Val'],['offset0','offset0Val'],
    ['vol1','vol1Val'],['offset1','offset1Val'],
    ['maskW','maskWVal'],['maskH','maskHVal'],
    ['borderW','borderWVal'],['borderOpacity','borderOpacityVal'],['maskBlur','maskBlurVal'],
    ['maskPixel','maskPixelVal'],['filterBlur','filterBlurVal'],
    ['filterBrightness','filterBrightnessVal'],['filterContrast','filterContrastVal'],
    ['filterHighlight','filterHighlightVal'],['filterShadow','filterShadowVal'],
    ['filterSaturation','filterSaturationVal'],['filterHue','filterHueVal'],
    ['filterTemp','filterTempVal'],['filterTint','filterTintVal'],['filterSharpness','filterSharpnessVal'],
    ['filterCA','filterCAVal'],['filterVignette','filterVignetteVal'],
    ['filterMatte','filterMatteVal'],['filterGrain','filterGrainVal'],
    ['filterFlare','filterFlareVal'],
    ['filterBars','filterBarsVal'],
    ['filterFps','filterFpsVal'],
    ['filterRain','filterRainVal'],
    ['rainSpeed','rainSpeedVal'],
    ['rainRefraction','rainRefractionVal'],
    ['rainShadow','rainShadowVal'],
    ['frameBlur','frameBlurVal'],
    ['frameTint','frameTintVal'],
    ['maskZoom','maskZoomVal'],
    ['fgPinX','fgPinXVal'],
    ['fgPinY','fgPinYVal'],
    ['fgPinLerp','fgPinLerpVal'],
    ['fgPinOpacity','fgPinOpacityVal'],
    ['specBars','specBarsVal'],
    ['specAmp','specAmpVal'],
    ['specGap','specGapVal'],
  ];
  const vals = {
    vol0:             d.vol0             ?? '25',
    offset0:          d.offset0          ?? '0',
    vol1:             d.vol1             ?? '25',
    offset1:          d.offset1          ?? '0',
    maskW:            d.maskW            ?? '400',
    maskH:            d.maskH            ?? '400',
    borderW:          d.borderW          ?? '1',
    borderOpacity:    d.borderOpacity    ?? '100',
    maskBlur:         d.maskBlur         ?? '0',
    maskPixel:        d.maskPixel        ?? '0',
    filterBlur:       d.filterBlur       ?? '0',
    filterBrightness: d.filterBrightness ?? '100',
    filterContrast:   d.filterContrast   ?? '100',
    filterHighlight:  d.filterHighlight  ?? '0',
    filterShadow:     d.filterShadow     ?? '0',
    filterSaturation: d.filterSaturation ?? '100',
    filterHue:        d.filterHue        ?? '0',
    filterTemp:       d.filterTemp       ?? '0',
    filterTint:       d.filterTint       ?? '0',
    filterSharpness:  d.filterSharpness  ?? '0',
    filterCA:         d.filterCA         ?? '0',
    filterVignette:   d.filterVignette   ?? '0',
    filterMatte:      d.filterMatte      ?? '0',
    filterGrain:      d.filterGrain      ?? '0',
    filterFlare:      d.filterFlare      ?? '0',
    filterBars:       d.filterBars       ?? '0',
    filterFps:        d.filterFps        ?? '0',
    filterRain:       d.filterRain       ?? '0',
    rainSpeed:        d.rainSpeed        ?? '1',
    rainRefraction:   d.rainRefraction   ?? '200',
    rainShadow:       d.rainShadow       ?? '0',
    frameBlur:        d.frameBlur        ?? '0',
    frameTint:        d.frameTint        ?? '0',
    maskZoom:         d.maskZoom         ?? '1',
    fgPinX:           d.fgPinX           ?? '0',
    fgPinY:           d.fgPinY           ?? '0',
    fgPinLerp:        d.fgPinLerp        ?? '50',
    fgPinOpacity:     d.fgPinOpacity     ?? '100',
    specBars:         d.specBars         ?? '32',
    specAmp:          d.specAmp          ?? '100',
    specGap:          d.specGap          ?? '0',
  };
  sliders.forEach(([id]) => {
    if (vals[id] == null) return;
    const el = document.getElementById(id);
    el.value = vals[id];
    el.dispatchEvent(new Event('input'));
  });
  if (d.borderColor) {
    document.getElementById('borderColor').value = d.borderColor;
    document.getElementById('borderColorSwatch').style.background = d.borderColor;
  }
  if (d.borderAnim != null) {
    const animSpeed  = document.getElementById('borderAnimSpeed');
    const animBright = document.getElementById('borderAnimBright');
    if (d.borderAnimSpeed  != null) { animSpeed.value  = d.borderAnimSpeed;  animSpeed.dispatchEvent(new Event('input')); }
    if (d.borderAnimBright != null) { animBright.value = d.borderAnimBright; animBright.dispatchEvent(new Event('input')); }
    if (d.borderAnimColors != null) {
      try {
        const parsed = JSON.parse(d.borderAnimColors);
        Object.keys(_animColors).forEach(k => { if (parsed[k]) _animColors[k] = parsed[k]; });
      } catch (_) {}
    }
    Object.keys(_animColors).forEach(_syncAnimColors);
    _applyBorderAnim(d.borderAnim);
    if (d.borderInvert) {
      state.borderInvert = true;
      document.querySelector('.bcp-chip--invert')?.classList.add('active');
      _syncBorderSwatch?.();
    }
  }
  if (d.maskShape) {
    const loadShape = d.maskShape;
    state.mask.shape = loadShape;
    const isGlasses = loadShape === 'glasses';
    document.querySelectorAll('.shape-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.shape === loadShape);
    });
    elPhoneUiRow.style.display = loadShape === 'phone' ? '' : 'none';
    elGlassesUiRow.style.display = isGlasses ? '' : 'none';
    const _isFrameShape3 = loadShape === 'phone' || isGlasses;
    document.getElementById('frameBlurRow').style.display = _isFrameShape3 ? '' : 'none';
    document.getElementById('frameTintRow').style.display = _isFrameShape3 ? '' : 'none';
    if (isGlasses) {
      if (d.glassesStyle != null) state.mask.glassesStyle = d.glassesStyle;
      const gsi = state.mask.glassesStyle || 0;
      elGlassesStyleBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.gstyle) === gsi));
    }
    if (loadShape === 'spectrum') {
      // 新フィールド
      if (d.specShape  != null) state.mask.specShape  = d.specShape;
      if (d.specSym    != null) state.mask.specSym    = d.specSym;
      if (d.specRotate != null) state.mask.specRotate = parseInt(d.specRotate) || 0;
      // 旧 specStyle から移行
      if (d.specStyle && d.specShape == null) {
        const _s = d.specStyle.startsWith('radial') ? 'radial' : d.specStyle;
        const _map = { bars: ['bars','none'], mirror: ['bars','ud'], radial: ['radial','none'], symwave: ['radial','lr'] };
        const [sh, sy] = _map[_s] || ['bars','none'];
        state.mask.specShape = sh; state.mask.specSym = sy;
      }
      document.querySelectorAll('.spec-shape-btn[data-specshape]').forEach(b =>
        b.classList.toggle('active', b.dataset.specshape === (state.mask.specShape || 'bars')));
      document.querySelectorAll('.spec-sym-btn[data-specsym]').forEach(b =>
        b.classList.toggle('active', b.dataset.specsym === (state.mask.specSym || 'none')));
      const _srEl = document.getElementById('specRotate');
      if (_srEl) { _srEl.value = state.mask.specRotate || 0; document.getElementById('specRotateVal').value = `${state.mask.specRotate || 0}°`; }
    }
    elSpectrumUiRow.style.display = loadShape === 'spectrum' ? '' : 'none';
    document.getElementById('specBarsRow').style.display    = loadShape === 'spectrum' ? '' : 'none';
    document.getElementById('specAmpRow').style.display     = loadShape === 'spectrum' ? '' : 'none';
    document.getElementById('specGapRow').style.display     = loadShape === 'spectrum' ? '' : 'none';
    document.getElementById('specSymRow').style.display     = loadShape === 'spectrum' ? '' : 'none';
    document.getElementById('specRotateRow').style.display  = loadShape === 'spectrum' ? '' : 'none';
    _updateFgFixedBtn();
  }
  if (d.phoneLandscape != null) {
    state.phoneLandscape = !!d.phoneLandscape;
    elPhoneUiBtnRot90.classList.toggle('active', state.phoneLandscape);
  }
  if (d.phoneShowRoT != null) {
    state.phoneShowRoT = !!d.phoneShowRoT;
    elPhoneUiBtnRoT.classList.toggle('active', state.phoneShowRoT);
  }
  if (d.phoneShowRec != null) {
    state.phoneShowRec = !!d.phoneShowRec;
    elPhoneUiBtnRec.classList.toggle('active', state.phoneShowRec);
  }
  if (d.phoneShowDot != null) {
    state.phoneShowDot = !!d.phoneShowDot;
    elPhoneUiBtnDot.classList.toggle('active', state.phoneShowDot);
  }
  if (d.maskW != null) {
    setPendingMask({
      w: +d.maskW,
      h: +d.maskH,
      x: d.maskX != null ? +d.maskX : null,
      y: d.maskY != null ? +d.maskY : null,
      srcW: d.bufW ? +d.bufW : null,
      srcH: d.bufH ? +d.bufH : null,
    });
    if (_bufferSynced && d.bufW && d.bufH) {
      setCanvasAspectRatio(+d.bufW, +d.bufH);
    }
  }
  if (d.arLock != null) {
    state.arLock = !!d.arLock;
    _updateArLockBtn();
  }
  if (d.zoomLock != null) {
    state.zoomLock = !!d.zoomLock;
    _updateZoomLockBtn();
  }
  if (d.fgFixed != null) {
    state.fgFixed = !!d.fgFixed;
    _updateFgFixedBtn();
  }
  if (d.borderW != null && parseFloat(d.borderW) > 0) {
    setMaskBorderFadeStart(loaded[1] ? performance.now() : 0);
  }
  updateCanvasFilter();
  updateBarsOverlay();
  const rAmt = parseInt(elFilterRain.value, 10);
  const _eff = document.getElementById('filterVisBtn');
  const effectsHidden = _eff?.dataset.hidden === 'true';
  if (rAmt > 0 && !effectsHidden) _startRainOverlay(); else _stopRainOverlay();
}

// ============================================================
//  XSSエスケープ
// ============================================================
function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
//  ファイル再リンクダイアログ
// ============================================================
async function _tryFromFolder(dirHandle, filename) {
  try {
    const fh = await dirHandle.getFileHandle(filename);
    const perm = await fh.queryPermission({ mode: 'read' });
    if (perm === 'granted' || await fh.requestPermission({ mode: 'read' }) === 'granted') return fh;
  } catch {}
  return null;
}

function _showFileResolveDialog(slots, slotNames, startHint, preResolvedMap = new Map()) {
  return new Promise(resolve => {
    setModalOpen(true);
    const pickedMap = new Map();
    let _hint = startHint;
    const overlay = document.createElement('div');
    overlay.className = 'gf-resolve-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'gf-resolve-dialog';
    const h = document.createElement('h3'); h.textContent = t('file-resolve-title');
    const desc = document.createElement('p'); desc.className = 'gf-resolve-desc'; desc.textContent = t('file-resolve-desc');
    const note = document.createElement('p'); note.className = 'gf-resolve-note'; note.textContent = t('file-resolve-note');
    const header = document.createElement('div'); header.className = 'gf-resolve-header';
    header.append(h, desc, note);
    const slotsWrap = document.createElement('div'); slotsWrap.className = 'gf-resolve-slots';
    dialog.append(header, slotsWrap);

    const _ACCEPT = [{ description: '動画 / 画像', accept: { 'video/*': ['.mp4','.webm','.mov','.mkv'], 'image/*': ['.jpg','.jpeg','.png','.gif','.webp','.avif'] } }];
    const slotState = {};

    const _setResolvedFinal = (si, fh, fileName) => {
      pickedMap.set(si, { fh, name: fileName });
      const { zone } = slotState[si];
      zone.querySelector('.gf-rzone-mismatch')?.remove();
      zone.classList.add('loaded');
      const lbl = zone.querySelector('.gf-rzone-label');
      const hint = zone.querySelector('.gf-rzone-hint');
      const icon = zone.querySelector('.gf-rzone-icon');
      lbl.textContent = fileName;
      lbl.style.color = '';
      hint.style.display = 'none';
      if (icon) { icon.setAttribute('data-lucide', 'check'); lucide.createIcons({ nodes: [icon] }); }
      zone.querySelector('.gf-rzone-delete').style.display = 'flex';
      zone.querySelector('.gf-rzone-folder').style.display = 'none';
    };
    const _showMismatch = (si, fh, fileName) => {
      const { zone } = slotState[si];
      zone.querySelector('.gf-rzone-mismatch')?.remove();
      const mismatchEl = document.createElement('div');
      mismatchEl.className = 'gf-rzone-mismatch';
      const warnLine = document.createElement('div');
      warnLine.className = 'gf-rzone-mismatch-warn';
      warnLine.textContent = t('file-resolve-name-warn');
      const expLine = document.createElement('div');
      expLine.className = 'gf-rzone-mismatch-table';
      expLine.innerHTML =
        `<span class="gf-rzone-mismatch-key">${t('file-mismatch-expected')}</span><span class="gf-rzone-mismatch-val">${slotNames[si] ?? ''}</span>` +
        `<span class="gf-rzone-mismatch-key">${t('file-mismatch-picked')}</span><span class="gf-rzone-mismatch-val">${fileName}</span>`;
      const btnRow = document.createElement('div');
      btnRow.className = 'gf-rzone-mismatch-btns';
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'gf-rzone-mismatch-accept';
      acceptBtn.textContent = t('file-resolve-mismatch-accept');
      acceptBtn.addEventListener('click', e => { e.stopPropagation(); _setResolvedFinal(si, fh, fileName); });
      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'gf-rzone-mismatch-reject';
      rejectBtn.textContent = t('file-resolve-mismatch-reject');
      rejectBtn.addEventListener('click', e => { e.stopPropagation(); mismatchEl.remove(); });
      btnRow.append(rejectBtn, acceptBtn);
      mismatchEl.append(warnLine, expLine, btnRow);
      zone.querySelector('.drop-text').appendChild(mismatchEl);
    };
    const _setResolved = (si, fh, fileName) => {
      const expected = (slotNames[si] ?? '').toLowerCase();
      const mismatch = !!fileName && !!expected && fileName.toLowerCase() !== expected;
      if (mismatch) { _showMismatch(si, fh, fileName); return; }
      _setResolvedFinal(si, fh, fileName);
    };
    const _clearResolved = (si) => {
      pickedMap.delete(si);
      const { zone, expectedName } = slotState[si];
      zone.querySelector('.gf-rzone-mismatch')?.remove();
      zone.classList.remove('loaded');
      const lbl = zone.querySelector('.gf-rzone-label');
      const hint = zone.querySelector('.gf-rzone-hint');
      const icon = zone.querySelector('.gf-rzone-icon');
      lbl.textContent = expectedName;
      lbl.style.color = '';
      hint.style.display = '';
      if (icon) { icon.setAttribute('data-lucide', 'upload'); lucide.createIcons({ nodes: [icon] }); }
      zone.querySelector('.gf-rzone-delete').style.display = 'none';
      zone.querySelector('.gf-rzone-folder').style.display = '';
    };

    for (const si of slots) {
      const expectedName = slotNames[si] ?? '';
      const lbl = document.createElement('div');
      lbl.className = 'gf-slot-label';
      lbl.textContent = t(si === 0 ? 'bg-title' : 'fg-title');

      const zone = document.createElement('div');
      zone.className = 'gf-slot-dropzone';
      zone.setAttribute('role', 'button');

      const iconEl = document.createElement('div');
      iconEl.className = 'gf-rzone-icon drop-icon';
      iconEl.innerHTML = '<i data-lucide="upload"></i>';

      const textWrap = document.createElement('div');
      textWrap.className = 'drop-text';
      const labelEl = document.createElement('div');
      labelEl.className = 'gf-rzone-label';
      labelEl.textContent = expectedName;
      const hintEl = document.createElement('div');
      hintEl.className = 'gf-rzone-hint drop-hint';
      hintEl.textContent = t('file-resolve-slot-drop');
      textWrap.append(labelEl, hintEl);

      const folderBtn = document.createElement('button');
      folderBtn.className = 'gf-rzone-folder drop-delete';
      folderBtn.style.cssText = 'display:flex;width:auto;padding:0 6px;border-radius:4px;font-size:10px;right:5px;top:5px;background:rgba(0,0,0,0.08);color:var(--text-muted);border:none;cursor:pointer;align-items:center;gap:3px;height:18px;white-space:nowrap';
      folderBtn.textContent = t('file-resolve-folder-btn');

      const delBtn = document.createElement('button');
      delBtn.className = 'gf-rzone-delete drop-delete';
      delBtn.style.cssText = 'display:none;right:5px;top:5px';
      delBtn.textContent = '✕';

      zone.append(iconEl, textWrap, folderBtn, delBtn);

      folderBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          const dirHandle = await window.showDirectoryPicker({ ...(_hint ? { startIn: _hint } : {}) });
          _IDB.set('gf_folder_handle', dirHandle).catch(() => {});
          const fh = await _tryFromFolder(dirHandle, expectedName);
          if (fh) { _hint = fh; _IDB.set('gf_folder_hint', fh).catch(() => {}); _setResolved(si, fh, expectedName); }
          for (const otherSi of slots) {
            if (otherSi === si) continue;
            if (pickedMap.has(otherSi)) continue;
            const otherName = slotNames[otherSi] ?? '';
            if (!otherName) continue;
            const otherFh = await _tryFromFolder(dirHandle, otherName);
            if (otherFh) { _IDB.set('gf_folder_hint', otherFh).catch(() => {}); _setResolved(otherSi, otherFh, otherName); }
          }
        } catch {}
      });
      delBtn.addEventListener('click', e => { e.stopPropagation(); _clearResolved(si); });

      let _dc = 0;
      zone.addEventListener('dragenter', e => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault(); _dc++; zone.classList.add('drag-over');
      });
      zone.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
      zone.addEventListener('dragleave', () => { if (--_dc <= 0) { _dc = 0; zone.classList.remove('drag-over'); } });
      zone.addEventListener('drop', async e => {
        e.preventDefault(); _dc = 0; zone.classList.remove('drag-over');
        const item = e.dataTransfer.items?.[0];
        const file = e.dataTransfer.files[0];
        if (!file) return;
        let fh = null;
        if (item?.getAsFileSystemHandle) fh = await item.getAsFileSystemHandle().catch(() => null);
        if (fh?.kind === 'file') { _hint = fh; _IDB.set('gf_folder_hint', fh).catch(() => {}); _setResolved(si, fh, file.name); }
      });
      zone.addEventListener('click', async () => {
        if (zone.querySelector('.gf-rzone-mismatch')) return;
        try {
          const [fh] = await window.showOpenFilePicker({ types: _ACCEPT, multiple: false, ...(_hint ? { startIn: _hint } : {}) });
          const file = await fh.getFile();
          _hint = fh; _IDB.set('gf_folder_hint', fh).catch(() => {});
          _setResolved(si, fh, file.name);
        } catch {}
      });

      lucide.createIcons({ nodes: [iconEl] });
      slotState[si] = { zone, expectedName };
      if (preResolvedMap.has(si)) {
        const { fh, name } = preResolvedMap.get(si);
        _setResolvedFinal(si, fh, name);
      }
      const section = document.createElement('div');
      section.className = 'gf-resolve-section';
      section.append(lbl, zone);
      slotsWrap.appendChild(section);
    }

    const footer = document.createElement('div');
    footer.className = 'gf-resolve-footer';
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'gf-resolve-cancel'; cancelBtn.textContent = t('file-resolve-cancel');
    const okBtn = document.createElement('button'); okBtn.className = 'gf-resolve-cancel gf-resolve-ok'; okBtn.textContent = t('file-resolve-ok');
    footer.append(cancelBtn, okBtn);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });

    const _close = res => { overlay.remove(); document.removeEventListener('keydown', _onKey); setModalOpen(false); resolve(res); };
    cancelBtn.addEventListener('click', () => _close(null));
    okBtn.addEventListener('click', () => _close(pickedMap));
    overlay.addEventListener('click', e => { if (e.target === overlay) _close(null); });
    const _onKey = e => { if (e.key === 'Escape') _close(null); };
    document.addEventListener('keydown', _onKey);
  });
}

// ============================================================
//  ステータスメッセージ (トースト)
// ============================================================
function _presetStatusMsg(msg, ok = true) {
  const container = document.getElementById('gf-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'gf-toast ' + (ok ? 'ok' : 'err');
  toast.textContent = msg;
  container.appendChild(toast);
  const remove = () => { toast.classList.add('out'); setTimeout(() => toast.remove(), 320); };
  setTimeout(remove, ok ? 3000 : 5000);
}

// ============================================================
//  renderPresets
// ============================================================
export function renderPresets() {
  const list = loadPresets();
  const el = document.getElementById('presetList');

  function _startRename(nameEl, idx, maxLen = 50) {
    const prev = nameEl.textContent;
    nameEl.contentEditable = 'plaintext-only';
    nameEl.focus();
    const sel = window.getSelection(), range = document.createRange();
    range.selectNodeContents(nameEl); sel.removeAllRanges(); sel.addRange(range);
    const commit = () => {
      nameEl.contentEditable = 'false';
      const next = nameEl.textContent.trim().slice(0, maxLen) || prev;
      nameEl.textContent = next;
      const l = loadPresets(); if (l[idx]) { l[idx].name = next; savePresets(l); }
    };
    nameEl.addEventListener('blur', commit, { once: true });
    nameEl.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
      if (ev.key === 'Escape') { nameEl.textContent = prev; nameEl.blur(); }
    });
  }

  if (list.length === 0) {
    el.innerHTML = `<div class="preset-empty">${t('preset-empty')}</div>`;
    _bindPresetAddBtn();
    return;
  }

  const rootItems = [];
  const folderSections = [];
  let curSection = null;
  list.forEach((p, i) => {
    if (p.type === 'folder') {
      curSection = { folder: p, folderIdx: i, children: [] };
      folderSections.push(curSection);
    } else if (curSection) {
      curSection.children.push({ item: p, idx: i });
    } else {
      rootItems.push({ item: p, idx: i });
    }
  });
  const firstFolderIdx = folderSections.length > 0 ? folderSections[0].folderIdx : -1;
  const rootInsertIdx = firstFolderIdx !== -1 ? firstFolderIdx : list.length;

  const presetItemHTML = (p, i, isChild) => {
    const _urlBase = url => { try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || url); } catch { return url; } };
    const _isIwara = url => /iwara\.(?:tv|ai)\/video\//.test(url || '');
    const n0 = p.data.vid0Name || (p.data.vid0Url && !_isIwara(p.data.vid0Url) ? _urlBase(p.data.vid0Url) : '');
    const n1 = p.data.vid1Name || (p.data.vid1Url && !_isIwara(p.data.vid1Url) ? _urlBase(p.data.vid1Url) : '');
    let fileHint = '';
    if (n0 || n1) {
      const lines = [[n0, 0], [n1, 1]].filter(([n]) => n)
        .map(([n, si]) => {
          const mkey    = p.data.presetId ? `${p.data.presetId}_${si}` : null;
          const missing  = mkey && _missingFiles.has(mkey);
          const unlinked = !p.data.presetId && !p.data[`vid${si}Url`];
          const pending  = mkey && _pendingFiles.has(mkey);
          return `<span class="preset-file-line${missing ? ' preset-file-missing' : unlinked || pending ? ' preset-file-unlinked' : ''}" data-slot="${si}"><span class="pname-inner">${_esc(n)}</span></span>`;
        })
        .join('');
      fileHint = `<span class="preset-item-files">${lines}</span>`;
    } else if (!p.data.presetId) {
      fileHint = `<span class="preset-item-files"><span class="preset-file-line"><span class="pname-inner">${t('preset-no-video')}</span></span></span>`;
    }
    const isActive = i === _activePresetIdx;
    return `<div class="preset-item${isChild ? ' preset-item-child' : ''}${isActive ? ' preset-item--active' : ''}" data-idx="${i}" tabindex="0">
        <span class="preset-drag-handle"><i data-lucide="grip-vertical"></i></span>
        <div class="preset-item-info" data-idx="${i}">
          <span class="preset-item-name"><span class="pname-inner">${_esc(p.name)}</span></span>
          ${fileHint}
        </div>
        <div class="preset-item-actions">
          ${isActive ? `<button class="preset-item-del preset-item-save" data-idx="${i}" title="${t('preset-save-title')}"><i data-lucide="save"></i></button>` : ''}
          <button class="preset-item-del preset-item-rename" data-idx="${i}" title="${t('preset-rename-title')}"><i data-lucide="pencil"></i></button>
          <button class="preset-item-del preset-item-share" data-idx="${i}" title="${t('preset-copy-title')}"><i data-lucide="copy"></i></button>
          <button class="preset-item-del preset-item-delete" data-idx="${i}" title="${t('preset-del-title')}"><i data-lucide="x"></i></button>
        </div>
      </div>`;
  };
  const dz = (insertIdx) => `<div class="preset-dropzone" data-insert="${insertIdx}"></div>`;
  const rootDz = () => `<div class="preset-dropzone preset-dropzone-eject" data-insert="${rootInsertIdx}" data-root="true"></div>`;

  let html = '';

  folderSections.forEach(({ folder, folderIdx, children }) => {
    html += dz(folderIdx);
    html += `<div class="preset-folder" data-idx="${folderIdx}">
      <div class="preset-folder-header" data-idx="${folderIdx}">
        <span class="preset-drag-handle"><i data-lucide="grip-vertical"></i></span>
        <span class="preset-folder-toggle"><i data-lucide="${folder.open !== false ? 'chevron-down' : 'chevron-right'}"></i></span>
        <span class="preset-folder-name"><span class="pname-inner">${_esc(folder.name)}</span></span>
        <div class="preset-item-actions">
          <button class="preset-item-del preset-item-rename" data-idx="${folderIdx}" title="${t('folder-rename-title')}"><i data-lucide="pencil"></i></button>
          <button class="preset-item-del preset-item-share" data-idx="${folderIdx}" title="${t('folder-copy-title')}"><i data-lucide="copy"></i></button>
          <button class="preset-item-del preset-item-delete" data-idx="${folderIdx}" title="${t('folder-del-title')}"><i data-lucide="x"></i></button>
        </div>
      </div>
      <div class="preset-folder-children${folder.open === false ? ' collapsed' : ''}">`;
    children.forEach(({ item, idx }) => {
      html += dz(idx);
      html += presetItemHTML(item, idx, true);
    });
    const lastChildIdx = children.length > 0 ? children[children.length - 1].idx + 1 : folderIdx + 1;
    html += dz(lastChildIdx);
    html += `</div></div>`;
  });

  if (folderSections.length > 0 && rootItems.length > 0) {
    html += '<hr class="preset-root-separator ctrl-mini-sep" aria-hidden="true">';
  }
  rootItems.forEach(({ item, idx }) => {
    html += dz(idx);
    html += presetItemHTML(item, idx, false);
  });
  if (folderSections.length > 0) {
    html += rootDz();
  }

  el.innerHTML = html;
  lucide.createIcons();

  setTimeout(() => {
    requestAnimationFrame(() => {
      el.querySelectorAll('.preset-item, .preset-folder-header').forEach(item => {
        _calcOverflows(item);
        item.addEventListener('mouseenter', () => _calcOverflows(item));
      });
    });
  }, 0);

  el.querySelectorAll('.preset-folder-header').forEach(header => {
    header.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (e.target.closest('[contenteditable]:not([contenteditable="false"])')) return;
      const idx = +header.dataset.idx;
      const children = header.nextElementSibling;
      const isCollapsed = children.classList.toggle('collapsed');
      const icon = header.querySelector('.preset-folder-toggle i');
      if (icon) { icon.setAttribute('data-lucide', isCollapsed ? 'chevron-right' : 'chevron-down'); lucide.createIcons(); }
      const list2 = loadPresets();
      if (list2[idx]) { list2[idx].open = !isCollapsed; savePresets(list2); }
    });
  });

  el.querySelectorAll('.preset-item-info').forEach(info => {
    info.addEventListener('click', async e => {
      if (e.target.closest('[contenteditable]:not([contenteditable="false"])')) return;
      const idx = +info.dataset.idx;
      const p = loadPresets()[idx];
      if (!p || p.type === 'folder') return;
      syncStop();
      applySettings(p.data);
      setActivePresetIdx(idx);
      setF2Target({ type: 'preset', idx });
      renderPresets();
      loaded[0] = false; loaded[1] = false;
      _stopBitmapCapture(0); _stopBitmapCapture(1);
      setMaskBorderFadeStart(0);
      setFgFadeStart(0);
      let needsRender = false;
      let vid1HasSource = false;

      const [_idbHandles, _startHint, _folderHandle] = await Promise.all([
        Promise.all([0, 1].map(si =>
          p.data.presetId ? _IDB.get(`preset_${p.data.presetId}_${si}`).catch(() => null) : Promise.resolve(null)
        )),
        _IDB.get('gf_folder_hint').catch(() => null),
        _IDB.get('gf_folder_handle').catch(() => null),
      ]);
      const _slotsLocal    = [0, 1].filter(si => !p.data[`vid${si}Url`] && !!p.data[`vid${si}Name`]);
      const _slotsNeedPick = _slotsLocal.filter(si => !_idbHandles[si]);
      const _prePickedHandles = new Map();
      let _dialogShown = false;

      if (_slotsLocal.length > 0 && !p.data.presetId) {
        const list2 = loadPresets();
        if (list2[idx] && !list2[idx].data?.presetId) {
          const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          list2[idx].data.presetId = newId;
          savePresets(list2);
          p.data.presetId = newId;
        } else if (list2[idx]?.data?.presetId) {
          p.data.presetId = list2[idx].data.presetId;
        }
      }

      const _preLoadOk = new Map();
      for (const si of _slotsLocal) {
        if (_idbHandles[si]) {
          const ok = await loadVideoFromHandle(si, _idbHandles[si]);
          _preLoadOk.set(si, ok);
          if (ok && si === 1) vid1HasSource = true;
        }
      }

      if (_slotsLocal.length > 0 && _slotsNeedPick.length > 0 && window.showOpenFilePicker) {
        _dialogShown = true;
        const _slotNames = {};
        for (const si of _slotsLocal) _slotNames[si] = p.data[`vid${si}Name`] ?? '';
        const _preResolved = new Map();
        for (const si of _slotsLocal) {
          if (_preLoadOk.get(si)) {
            _preResolved.set(si, { fh: _idbHandles[si], name: _loadedFileName[si] || p.data[`vid${si}Name`] || '' });
          }
        }
        const _resolvedMap = await _showFileResolveDialog(_slotsLocal, _slotNames, _startHint, _preResolved);
        if (_resolvedMap) {
          for (const [si, { fh }] of _resolvedMap) _prePickedHandles.set(si, fh);
          const _list2 = loadPresets();
          let _nameChanged = false;
          for (const [si, { name }] of _resolvedMap) {
            const _expected = p.data[`vid${si}Name`];
            if (name && _expected && name !== _expected && _list2[idx]?.data) {
              _list2[idx].data[`vid${si}Name`] = name;
              _nameChanged = true;
            }
          }
          if (_nameChanged) { savePresets(_list2); needsRender = true; }
          const _pid = p.data.presetId;
          for (const si of _slotsNeedPick) {
            const mk = _pid ? `${_pid}_${si}` : null;
            if (!_resolvedMap.has(si) && mk) { _pendingFiles.add(mk); needsRender = true; }
            else if (mk) _pendingFiles.delete(mk);
          }
        }
        const _itemEl = document.querySelector(`.preset-item[data-idx="${idx}"]`);
        if (_itemEl) setTimeout(() => requestAnimationFrame(() => _calcOverflows(_itemEl)), 0);
      }

      for (const i of [0, 1]) {
        const handle = _idbHandles[i];
        let loaded_ok = false;
        const _mkey = p.data.presetId ? `${p.data.presetId}_${i}` : null;
        if (_preLoadOk.has(i)) {
          loaded_ok = _preLoadOk.get(i);
          if (loaded_ok && _mkey) _resolvedFiles.add(_mkey);
        } else if (handle) {
          loaded_ok = await loadVideoFromHandle(i, handle);
          if (loaded_ok && _mkey) _resolvedFiles.add(_mkey);
        }
        if (!loaded_ok) {
          const savedUrl = p.data[`vid${i}Url`];
          if (savedUrl) {
            if (i === 1) vid1HasSource = true;
            loaded_ok = true;
            if (_mkey && _missingFiles.delete(_mkey)) needsRender = true;
            if (_mkey) { _resolvedFiles.add(_mkey); needsRender = true; }
            const urlInput = document.getElementById(`urlInput${i}`);
            if (urlInput) urlInput.value = savedUrl;
            await loadVideoFromURL(i, savedUrl);
            const resolved = _loadedFileName[i];
            if (resolved && resolved !== p.data[`vid${i}Name`]) {
              const list2 = loadPresets();
              if (list2[idx]) { list2[idx].data[`vid${i}Name`] = resolved; savePresets(list2); needsRender = true; }
            }
          } else if (p.data[`vid${i}Name`]) {
            const newHandle = _prePickedHandles.get(i);
            if (newHandle) {
              const list2 = loadPresets();
              if (!list2[idx]?.data?.presetId) {
                const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                if (list2[idx]) { list2[idx].data.presetId = newId; savePresets(list2); }
                p.data.presetId = list2[idx]?.data?.presetId;
              }
              if (p.data.presetId) {
                await _IDB.set(`preset_${p.data.presetId}_${i}`, newHandle).catch(() => {});
                if (_mkey) _missingFiles.delete(_mkey);
              }
              loaded_ok = await loadVideoFromHandle(i, newHandle);
              if (loaded_ok) { needsRender = true; if (_mkey) { _resolvedFiles.add(_mkey); _pendingFiles.delete(_mkey); } }
            } else if (!window.showOpenFilePicker) {
              if (_mkey && !_missingFiles.has(_mkey)) { _missingFiles.add(_mkey); needsRender = true; }
              _presetStatusMsg(t('preset-file-missing'), false);
            } else if (!_dialogShown) {
              if (_mkey && !_missingFiles.has(_mkey)) { _missingFiles.add(_mkey); needsRender = true; }
            }
          }
        } else if (handle || _preLoadOk.has(i)) {
          if (_mkey && _missingFiles.delete(_mkey)) needsRender = true;
          if (i === 1) vid1HasSource = true;
        }
        if (loaded_ok && i === 1) vid1HasSource = true;
      }
      if (!vid1HasSource && _maskBorderFadeStart === 0) setMaskBorderFadeStart(performance.now());
      if (!vid1HasSource) setFgFadeStart(-1);
      if (needsRender) renderPresets();
    });
  });

  el.querySelectorAll('.preset-item-save').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const list2 = loadPresets();
      const p = list2[idx];
      if (!p || p.type === 'folder') return;
      _showDelPopup(btn, t('preset-overwrite-confirm').replace('{name}', p.name), async () => {
        const newData = { ...collectSettings(), presetId: p.data.presetId };
        for (const i of [0, 1]) {
          if (_currentHandle[i] && p.data.presetId) {
            await _IDB.set(`preset_${p.data.presetId}_${i}`, _currentHandle[i]).catch(() => {});
          }
        }
        list2[idx].data = newData;
        savePresets(list2);
        renderPresets();
      }, 'preset-del-popup-ok--save');
    });
  });

  el.querySelectorAll('.preset-item-rename').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const isFolder = !!btn.closest('.preset-folder-header');
      const nameEl = isFolder
        ? btn.closest('.preset-folder-header').querySelector('.preset-folder-name')
        : btn.closest('.preset-item').querySelector('.preset-item-name');
      _startRename(nameEl, idx);
    });
  });

  el.querySelectorAll('.preset-item-share').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const allList = loadPresets();
      const p = allList[idx];
      if (!p) return;
      let code;
      if (p.type === 'folder') {
        let end = idx + 1;
        while (end < allList.length && allList[end].type !== 'folder') end++;
        const children = allList.slice(idx + 1, end);
        if (!children.length) return;
        const folderHeader = 'gff~' + encodeURIComponent(p.name || 'フォルダ');
        code = [folderHeader, ...(await Promise.all(children.map(c => _presetEncodeOne(c))))].join('\n');
      } else {
        code = await _presetEncodeOne(p);
      }
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      _presetStatusMsg(t('preset-copied').replace('{n}', code.length));
    });
  });

  el.querySelectorAll('.preset-item-delete').forEach(btn => {
    btn.addEventListener('mouseenter', () => { if (_shiftHeld) _setDelBtnIcon(btn, 'trash-2'); });
    btn.addEventListener('mouseleave', () => { _setDelBtnIcon(btn, 'x'); });
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const list2 = loadPresets();
      const p = list2[idx];
      const doDelete = async () => {
        if (p.type === 'folder') {
          let end = idx + 1;
          while (end < list2.length && list2[end].type !== 'folder') end++;
          for (let k = idx + 1; k < end; k++) {
            const pid = list2[k].data?.presetId;
            if (pid) {
              await _IDB.del(`preset_${pid}_0`).catch(() => {});
              await _IDB.del(`preset_${pid}_1`).catch(() => {});
            }
          }
          list2.splice(idx, end - idx);
        } else {
          if (p?.data?.presetId) {
            await _IDB.del(`preset_${p.data.presetId}_0`).catch(() => {});
            await _IDB.del(`preset_${p.data.presetId}_1`).catch(() => {});
          }
          list2.splice(idx, 1);
        }
        if (_activePresetIdx === idx || (_activePresetIdx != null && _activePresetIdx > idx)) {
          setActivePresetIdx(null);
        }
        savePresets(list2);
        renderPresets();
      };
      if (e.shiftKey) {
        await doDelete();
      } else {
        const msgKey = p.type === 'folder' ? 'del-confirm-folder' : 'del-confirm';
        _showDelPopup(btn, t(msgKey).replace('{name}', p.name), doDelete);
      }
    });
  });

  _bindPresetAddBtn();
}

// ============================================================
//  プリセット追加・F2・フォルダ追加
// ============================================================
const _doPresetAdd = async () => {
  const presetId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const data = { ...collectSettings(), presetId };
  for (const i of [0, 1]) {
    if (_currentHandle[i]) {
      await _IDB.set(`preset_${presetId}_${i}`, _currentHandle[i]).catch(() => {});
    }
  }
  const list = loadPresets();
  const presetCount = list.filter(p => p.type !== 'folder').length;
  const name = `${t('preset-default')} ${presetCount + 1}`;
  const firstFolderIdx = list.findIndex(p => p.type === 'folder');
  if (firstFolderIdx === -1) {
    list.push({ name, data });
  } else {
    list.splice(firstFolderIdx, 0, { name, data });
  }
  savePresets(list);
  renderPresets();
  requestAnimationFrame(() => {
    const addedIdx = firstFolderIdx === -1 ? list.length - 1 : firstFolderIdx;
    const nameEl = document.querySelector(`.preset-item-rename[data-idx="${addedIdx}"]`)
      ?.closest('.preset-item')?.querySelector('.preset-item-name');
    if (nameEl) {
      const prev = nameEl.textContent;
      nameEl.contentEditable = 'plaintext-only';
      nameEl.focus();
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(nameEl); sel.removeAllRanges(); sel.addRange(range);
      const commit = () => {
        nameEl.contentEditable = 'false';
        const next = nameEl.textContent.trim().slice(0, 50) || prev;
        nameEl.textContent = next;
        const l = loadPresets(); if (l[addedIdx]) { l[addedIdx].name = next; savePresets(l); }
      };
      nameEl.addEventListener('blur', commit, { once: true });
      nameEl.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
        if (ev.key === 'Escape') { nameEl.textContent = prev; nameEl.blur(); }
      });
    }
  });
};

const _bindPresetAddBtn = () => {};
document.getElementById('presetAddBtn').addEventListener('click', () => _doPresetAdd());

document.getElementById('presetList').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return;
  const header = e.target.closest('.preset-folder-header');
  const item   = e.target.closest('.preset-item');
  if (header) setF2Target({ type: 'folder', idx: +header.dataset.idx });
  else if (item) setF2Target({ type: 'preset', idx: +item.dataset.idx });
}, true);

document.addEventListener('keydown', e => {
  if (e.key !== 'F2') return;
  const el = document.getElementById('presetList');
  if (!el) return;
  e.preventDefault();
  const focused = document.activeElement;
  const focusedHeader = focused?.closest('.preset-folder-header');
  const focusedItem   = focused?.closest('.preset-item');
  let type, idx;
  if (focusedHeader) {
    type = 'folder'; idx = +focusedHeader.dataset.idx;
  } else if (focusedItem) {
    type = 'preset'; idx = +focusedItem.dataset.idx;
  } else if (_f2Target) {
    type = _f2Target.type; idx = _f2Target.idx;
  } else if (_activePresetIdx != null) {
    type = 'preset'; idx = _activePresetIdx;
  } else return;
  if (type === 'folder') {
    el.querySelector(`.preset-folder-header .preset-item-rename[data-idx="${idx}"]`)?.click();
  } else {
    el.querySelector(`.preset-item-rename[data-idx="${idx}"]`)?.click();
  }
});

document.getElementById('presetAddFolderBtn').addEventListener('click', () => {
  const list = loadPresets();
  list.push({ type: 'folder', name: t('folder-new'), open: true });
  savePresets(list);
  renderPresets();
  requestAnimationFrame(() => {
    const headers = document.querySelectorAll('.preset-folder-header');
    const last = headers[headers.length - 1];
    if (last) {
      const nameEl = last.querySelector('.preset-folder-name');
      if (nameEl) {
        const idx = +last.dataset.idx;
        nameEl.contentEditable = 'plaintext-only';
        nameEl.focus();
        const sel = window.getSelection(), range = document.createRange();
        range.selectNodeContents(nameEl); sel.removeAllRanges(); sel.addRange(range);
        const commit = () => {
          nameEl.contentEditable = 'false';
          const next = nameEl.textContent.trim().slice(0, 50) || t('folder-new');
          nameEl.textContent = next;
          const l = loadPresets(); if (l[idx]) { l[idx].name = next; savePresets(l); }
        };
        nameEl.addEventListener('blur', commit, { once: true });
        nameEl.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
          if (ev.key === 'Escape') { nameEl.textContent = t('folder-new'); nameEl.blur(); }
        });
      }
    }
  });
});

// ============================================================
//  インラインインポート
// ============================================================
const _doInlineImport = async (rawOverride) => {
  const inp = document.getElementById('presetCodeInput');
  const raw = (typeof rawOverride === 'string' ? rawOverride : inp.value)
    .replace(/[\uFF5E\u301C\u02DC\u2053\u223C\u3030\uFE4B\uFE4F]/g, '~').trim();
  if (!raw) return;
  let arr;
  try {
    const _isGfCode = l => l.startsWith('gf~');
    const gfIdx = raw.indexOf('gf~');
    const gffIdx = raw.indexOf('gff~');
    if (gffIdx !== -1) {
      const allLines = raw.split(/\s+(?=gff~|gf~)/).map(l => l.trim()).filter(l => l);
      const gffLine = allLines.find(l => l.startsWith('gff~'));
      if (gffLine) {
        let folderName;
        try { folderName = decodeURIComponent(gffLine.slice(4)); } catch { folderName = gffLine.slice(4); }
        folderName = folderName || 'フォルダ';
        const presetLines = allLines.filter(_isGfCode);
        const decoded = [];
        for (const l of presetLines) {
          try { decoded.push(await _presetDecodeOne(l)); } catch (e) { console.error('[folder import] skip line:', JSON.stringify(l), e); }
        }
        arr = [{ type: 'folder', name: folderName, open: true }, ...decoded];
      } else {
        const lines = allLines.filter(_isGfCode);
        arr = lines.length > 1 ? await Promise.all(lines.map(l => _presetDecodeOne(l))) : [await _presetDecodeOne(raw.slice(gfIdx))];
      }
    } else if (gfIdx !== -1) {
      const lines = raw.split(/\s+(?=gf~)/).map(l => l.trim()).filter(_isGfCode);
      if (lines.length > 1) {
        arr = await Promise.all(lines.map(l => _presetDecodeOne(l)));
      } else {
        arr = [await _presetDecodeOne(raw.slice(gfIdx))];
      }
    } else {
      try { arr = JSON.parse(raw); }
      catch { arr = await _presetDecodeMulti(raw); }
      if (!Array.isArray(arr)) arr = [arr];
    }
    const existing = loadPresets();
    let added = 0;
    const toInsert = [];
    const hasFolder = arr.some(p => p.type === 'folder');
    arr.forEach(p => {
      if (p.type === 'folder') {
        toInsert.push({ type: 'folder', name: p.name || 'フォルダ', open: p.open !== false });
        added++;
        return;
      }
      if (!p?.data) return;
      toInsert.push({ name: p.name || `インポート ${toInsert.length + 1}`, data: p.data });
      added++;
    });
    if (!added) { _presetStatusMsg(t('preset-import-empty'), false); return; }
    const firstFolderIdx = existing.findIndex(p => p.type === 'folder');
    const insertAt = hasFolder || firstFolderIdx === -1 ? existing.length : firstFolderIdx;
    existing.splice(insertAt, 0, ...toInsert);
    savePresets(existing); renderPresets();
    inp.value = ''; inp.classList.remove('error');
    _presetStatusMsg(t('preset-imported').replace('{n}', added));
    requestAnimationFrame(() => {
      const items = document.querySelectorAll('#presetList .preset-item');
      for (let i = insertAt; i < insertAt + added; i++) {
        if (items[i]) items[i].classList.add('preset-item-flash');
      }
    });
  } catch(e) { console.error('[preset import]', e); if (rawOverride == null) inp.classList.add('error'); _presetStatusMsg(t('preset-import-err'), false); }
};

document.getElementById('presetImportBtn').addEventListener('click', _doInlineImport);
document.getElementById('presetCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) _doInlineImport(); });
document.getElementById('presetCodeInput').addEventListener('input', () => { document.getElementById('presetCodeInput').classList.remove('error'); });

// 入力フィールドへの D&D
((() => {
  const inp = document.getElementById('presetCodeInput');
  inp.addEventListener('dragover', e => { e.preventDefault(); inp.classList.add('dnd-over'); });
  inp.addEventListener('dragleave', () => inp.classList.remove('dnd-over'));
  inp.addEventListener('drop', async e => {
    e.preventDefault();
    inp.classList.remove('dnd-over');
    const files = [...e.dataTransfer.files].filter(f => f.type === 'application/json' || f.name.endsWith('.json'));
    if (files.length) {
      inp.classList.remove('dnd-over');
      inp.classList.remove('error');
      await _doInlineImport(await files[0].text());
      return;
    }
    const text = e.dataTransfer.getData('text/plain').trim();
    if (text) { inp.classList.remove('dnd-over'); inp.classList.remove('error'); await _doInlineImport(text); }
  });
})());

// ---- JSON / gf~ コード D&D → プリセットカード全体で受付 ----
((() => {
  const card = document.getElementById('presetCard');
  const list = document.getElementById('presetList');
  if (!card) return;

  const _isJsonDrag = e => {
    if (!e.dataTransfer) return false;
    if (e.dataTransfer.types.includes('text/plain')) return true;
    if (e.dataTransfer.items) {
      return [...e.dataTransfer.items].some(item =>
        item.kind === 'file' &&
        (item.type === 'application/json' || item.type === 'text/plain' || item.type === '')
      );
    }
    return false;
  };

  const _doImportRaw = async (raw) => {
    raw = (raw || '').trim();
    if (!raw) return;
    await _doInlineImport(raw);
  };

  let _dndActive = false;
  const _enter = () => {
    if (_isDraggingPreset) return;
    _dndActive = true;
    list.classList.add('dnd-over');
  };
  const _leave = () => {
    _dndActive = false;
    list.classList.remove('dnd-over');
  };

  card.addEventListener('dragenter', e => {
    if (_isDraggingPreset || !_isJsonDrag(e)) return;
    e.preventDefault();
    _enter();
  });
  card.addEventListener('dragleave', e => {
    if (!_dndActive) return;
    if (!card.contains(e.relatedTarget)) _leave();
  });
  card.addEventListener('drop', async e => {
    if (_isDraggingPreset) return;
    const files = [...(e.dataTransfer.files || [])].filter(f =>
      f.type === 'application/json' || f.type === 'text/plain' || f.name.endsWith('.json'));
    const hasText = e.dataTransfer.types.includes('text/plain');
    if (!files.length && !hasText) return;
    e.preventDefault();
    e.stopPropagation();
    _leave();
    if (files.length) {
      for (const f of files) {
        await _doImportRaw(await f.text());
      }
    } else {
      await _doImportRaw(e.dataTransfer.getData('text/plain'));
    }
  });
})());

document.getElementById('presetImportToggleBtn').addEventListener('click', () => {
  const row = document.getElementById('presetInputRow');
  const open = row.style.display === 'none';
  row.style.display = open ? '' : 'none';
  if (open) document.getElementById('presetCodeInput').focus();
});

// ============================================================
//  プリセット圧縮コーデック
// ============================================================
const _B64U = b => {
  const arr = new Uint8Array(b);
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < arr.length; i += CHUNK) bin += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};
const _B64D = s => { const b64 = s.replace(/-/g,'+').replace(/_/g,'/'); return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length/4)*4,'=')), c => c.charCodeAt(0)); };

const _iwaraId = url => url?.match(/iwara\.(?:tv|ai)\/video\/([^/?#]+)/)?.[1] ?? '';

async function _presetEncodeOne(p) {
  const {presetId, vid0Name, vid1Name, ...d} = p.data;
  const id0 = _iwaraId(d.vid0Url) || d.vid0Id || '';
  const id1 = _iwaraId(d.vid1Url) || d.vid1Id || '';
  const data = {...d};
  if (id0) { delete data.vid0Url; delete data.vid0Id; }
  if (id1) { delete data.vid1Url; delete data.vid1Id; }
  if (!id0 && vid0Name) data.vid0Name = vid0Name;
  if (!id1 && vid1Name) data.vid1Name = vid1Name;
  const name = (p.name || '').replace(/~/g, '');
  const cs = new CompressionStream('deflate-raw');
  const cw = cs.writable.getWriter();
  cw.write(new TextEncoder().encode(JSON.stringify(data))); cw.close();
  const chunks = []; const cr = cs.readable.getReader();
  for (;;) { const {done, value} = await cr.read(); if (done) break; chunks.push(value); }
  const buf = new Uint8Array(chunks.reduce((n,c) => n+c.length, 0));
  let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
  return `gf~${name}~${id0}~${id1}~${_B64U(buf)}`;
}

async function _presetDecodeOne(code) {
  const parts = code.split('~');
  if (parts[0] !== 'gf' || parts.length < 5) throw new Error('invalid gf code');
  const [, name, id0, id1, payload] = parts;
  const bytes = _B64D(payload);
  const ds = new DecompressionStream('deflate-raw');
  const dw = ds.writable.getWriter(); dw.write(bytes); dw.close();
  const chunks = []; const dr = ds.readable.getReader();
  for (;;) { const {done, value} = await dr.read(); if (done) break; chunks.push(value); }
  const buf = new Uint8Array(chunks.reduce((n,c) => n+c.length, 0));
  let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
  const data = JSON.parse(new TextDecoder().decode(buf));
  if (id0) { data.vid0Url = `https://www.iwara.tv/video/${id0}`; data.vid0Name = data.vid0Name || id0; }
  if (id1) { data.vid1Url = `https://www.iwara.tv/video/${id1}`; data.vid1Name = data.vid1Name || id1; }
  return {name: name || 'インポート', data};
}

const _iwaraUrl = id => `https://www.iwara.tv/video/${id}`;

async function _presetEncode(arr) {
  const data=arr.map(p=>{
    if (p.type === 'folder') return { type: 'folder', name: p.name, open: p.open !== false };
    const {presetId,vid0Name,vid1Name,...d}=p.data;
    const id0=_iwaraId(d.vid0Url); if(id0){d.vid0Id=id0;delete d.vid0Url;}
    const id1=_iwaraId(d.vid1Url); if(id1){d.vid1Id=id1;delete d.vid1Url;}
    if (!id0 && vid0Name) d.vid0Name = vid0Name;
    if (!id1 && vid1Name) d.vid1Name = vid1Name;
    return {name:p.name,data:d};
  });
  const cs=new CompressionStream('deflate-raw');
  const w=cs.writable.getWriter(); w.write(new TextEncoder().encode(JSON.stringify(data))); w.close();
  const chunks=[]; const rd=cs.readable.getReader();
  for(;;){const{done,value}=await rd.read();if(done)break;chunks.push(value);}
  const buf=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
  let off=0; for(const c of chunks){buf.set(c,off);off+=c.length;}
  return _B64U(buf);
}

async function _presetDecodeMulti(code) {
  const bytes=_B64D(code);
  const ds=new DecompressionStream('deflate-raw');
  const w=ds.writable.getWriter(); w.write(bytes); w.close();
  const chunks=[]; const rd=ds.readable.getReader();
  for(;;){const{done,value}=await rd.read();if(done)break;chunks.push(value);}
  const buf=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
  let off=0; for(const c of chunks){buf.set(c,off);off+=c.length;}
  const arr=JSON.parse(new TextDecoder().decode(buf));
  return arr.map(p=>{
    if (p.type === 'folder') return { type: 'folder', name: p.name || 'フォルダ', open: p.open !== false };
    const d={...p.data};
    if(d.vid0Id){d.vid0Url=_iwaraUrl(d.vid0Id);d.vid0Name=d.vid0Name||d.vid0Id;delete d.vid0Id;}
    if(d.vid1Id){d.vid1Url=_iwaraUrl(d.vid1Id);d.vid1Name=d.vid1Name||d.vid1Id;delete d.vid1Id;}
    return {name:p.name,data:d};
  });
}

// ============================================================
//  エクスポート / インポート UI
// ============================================================
document.getElementById('presetJsonExportBtn').addEventListener('click', () => {
  const list = loadPresets();
  if (!list.length) { _presetStatusMsg(t('no-presets'), false); return; }
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const _d = new Date();
  const ts = _d.getFullYear().toString()
    + String(_d.getMonth()+1).padStart(2,'0')
    + String(_d.getDate()).padStart(2,'0')
    + String(_d.getHours()).padStart(2,'0')
    + String(_d.getMinutes()).padStart(2,'0')
    + String(_d.getSeconds()).padStart(2,'0');
  a.download = `gf_presets_${ts}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('presetCopyAllBtn').addEventListener('click', async () => {
  try {
    const list = loadPresets();
    if (!list.filter(p => p.type !== 'folder').length) { _presetStatusMsg(t('no-presets'), false); return; }
    const code = await _presetEncode(list);
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    _presetStatusMsg(t('all-copied').replace('{n}', list.length));
  } catch (err) {
    _presetStatusMsg(t('preset-import-err'), false);
  }
});

// ============================================================
//  初期化
// ============================================================
setPresetsReady(true);
renderPresets();
_setRenderPresets(renderPresets);

// 起動時に欠損スロットを事前検出
(async () => {
  const _allPresets = loadPresets();
  const _checks = [];
  for (const _pp of _allPresets) {
    if (!_pp || _pp.type === 'folder' || !_pp.data?.presetId) continue;
    for (const _si of [0, 1]) {
      const _name = _pp.data[`vid${_si}Name`];
      const _url  = _pp.data[`vid${_si}Url`];
      if (!_name || _url) continue;
      const _mk = `${_pp.data.presetId}_${_si}`;
      if (_missingFiles.has(_mk) || _resolvedFiles.has(_mk)) continue;
      _checks.push({ mk: _mk, key: `preset_${_pp.data.presetId}_${_si}` });
    }
  }
  if (!_checks.length) return;
  const _results = await Promise.all(_checks.map(c => _IDB.get(c.key).catch(() => null)));
  let _initNeedsRender = false;
  _results.forEach((h, i) => { if (!h) { _missingFiles.add(_checks[i].mk); _initNeedsRender = true; } });
  if (_initNeedsRender) renderPresets();
})();
