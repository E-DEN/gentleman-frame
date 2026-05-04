// controls.js — UIコントロール・スライダー・ボーダーカラー・FQP・シェイプ・スワップ

import { state, _animColors, _ANIM_DEFAULTS } from './state.js';
import {
  canvas, canvasWrap, effectsWrap,
  renderCvs,
  vid, img, mediaType, loaded, visHidden, maskHidden, effectsHidden,
  _vidBitmap, _vidBitmapPending, _startBitmapCapture, _stopBitmapCapture,
  _currentHandle, _loadedFileName, _loadedPageUrl, _loadedSrcUrl,
  _compositeT,
  setCompositeT,
  _syncMaskSliders, _syncOffsetSliders,
  _shiftHeld, _setDelBtnIcon,
  elBorderW, elBorderColor, elBorderOpacity,
  elBorderAnim, elBorderAnimSpeed, elBorderAnimBright,
  elFrameBlur, elFrameTint,
  elPhoneUiRow, elGlassesUiRow, elSpectrumUiRow, elSpecBars, elSpecAmp, elSpecSmooth, elGlassesStyleBtns,
  elPhoneUiBtnRoT, elPhoneUiBtnRec, elPhoneUiBtnDot, elPhoneUiBtnRot90,
  elVol0, elVol1, elOffset0, elOffset1,
  elFgPinX, elFgPinY, elFgPinLerp, elFgPinOpacity,
  elFilterBlur, elFilterBrightness, elFilterContrast, elFilterSaturation,
  elFilterHue, elFilterVignette, elFilterCA, elFilterTemp, elFilterTint,
  elFilterHighlight, elFilterShadow, elFilterSharpness, elFilterMatte,
  elFilterGrain, elMaskPixel, elMaskBlur, elFilterFlare, elFilterBars,
  elFilterBloom,
  elFilterPencil, elFilterEmboss, elFilterChalkboard, elFilterNightVision, elFilterAirbrush,
  elFilterFps, elFilterRain, elRainSpeed, elRainRefraction, elRainShadow,
  elProgressFill, elProgressThumb, elTimeLabel, elPlayBtn,
  elMaskZoom, elMaskW, elMaskH, elMaskOffX, elMaskOffY,
  updateSliderFill, _getOffsets,
  _updateArLockBtn, _updateZoomLockBtn, _updateFgFixedBtn, _syncZoomToMaskScale,
  fmtTime, updateProgress,
  _modalOpen, setModalOpen,
  setEffectsHidden, setMaskHidden,
  _activePresetIdx,
  _showDelPopup,
} from './canvas.js';
import {
  updateCanvasFilter, updateBarsOverlay,
  _rainSubVisible, _startRainOverlay, _stopRainOverlay,
  _glassesInitSize,
} from './render.js';
import { updateMediaControls, _updateDropLink } from './media.js';
import { syncPlay, syncPause, syncStop, _applyCompositeT } from './playback.js';
import { connectAudioElements } from './spectrum.js';
import './drag.js';
import './lang.js';

const _FPS_SNAPS = [0, 18, 23.976, 24, 29.97, 30, 48, 59.94, 60, 120];

// ============================================================
//  再生ボタン / tbtn グロー（再生関数本体は playback.js）
// ============================================================
function triggerTbtnGlow(btn) {
  btn.classList.remove('glow');
  void btn.offsetWidth;
  btn.classList.add('glow');
  btn.addEventListener('animationend', () => btn.classList.remove('glow'), { once: true });
}

document.querySelectorAll('.tbtn').forEach(btn => {
  btn.addEventListener('click', () => triggerTbtnGlow(btn));
});

elPlayBtn.addEventListener('click', () => {
  if (state.playing) syncPause(); else syncPlay();
});

const stopBtn = document.getElementById('stopBtn');
if (stopBtn) {
  stopBtn.addEventListener('click', () => { syncStop(); triggerTbtnGlow(stopBtn); });
}

// ============================================================
//  キーボードショートカット
// ============================================================
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (document.activeElement?.contentEditable === 'true' || document.activeElement?.contentEditable === 'plaintext-only') return;

  switch (e.code) {
    case 'Escape': {
      const langDialog = document.getElementById('langImportDialog');
      if (langDialog && !langDialog.hidden) {
        const addSec = document.getElementById('langAddSection');
        if (addSec && !addSec.hidden) {
          addSec.hidden = true;
          const toggle = document.getElementById('langAddToggle');
          if (toggle) toggle.querySelector('span:last-child').textContent = t('lang-add');
        } else {
          langDialog.hidden = true;
          document.getElementById('langImportText').value = '';
        }
        return;
      }
      const pop = document.getElementById('borderColorPopover');
      if (pop && pop.style.display !== 'none') {
        const customRow = document.getElementById('bcpCustomAnimRow');
        if (customRow?.classList.contains('is-open')) {
          customRow.classList.remove('is-open');
          _resetBcpTarget();
        } else {
          _closeBorderColorPop();
        }
        return;
      }
      break;
    }
    case 'Space':
      e.preventDefault();
      if (state.playing) syncPause(); else syncPlay();
      triggerTbtnGlow(elPlayBtn);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      setCompositeT(Math.max(0, _compositeT - (e.shiftKey ? 5 : 1)));
      _applyCompositeT(_compositeT);
      break;
    case 'ArrowRight': {
      e.preventDefault();
      const refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration
                   : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration : 0;
      setCompositeT(refDur ? Math.min(refDur, _compositeT + (e.shiftKey ? 5 : 1)) : _compositeT);
      _applyCompositeT(_compositeT);
      break;
    }
    case 'KeyP':
      e.preventDefault();
      document.getElementById('screenshotBtn').click();
      break;
  }
});

// ============================================================
//  スライダー
// ============================================================
export function bindSlider(id, valId, fmt, onChange) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  updateSliderFill(el);
  vl.value = fmt(parseFloat(el.value));

  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.value = fmt(v);
    updateSliderFill(el);
    if (onChange) onChange(v);
  });

  const applyVal = () => {
    const raw = parseFloat(vl.value);
    if (isNaN(raw)) { vl.value = fmt(parseFloat(el.value)); return; }
    const min = parseFloat(el.min);
    const max = parseFloat(el.max);
    const step = parseFloat(el.step) || 1;
    const clamped = Math.min(max, Math.max(min, Math.round(raw / step) * step));
    el.value = clamped;
    updateSliderFill(el);
    vl.value = fmt(clamped);
    if (onChange) onChange(clamped);
  };

  vl.addEventListener('focus', () => vl.select());
  vl.addEventListener('change', applyVal);
  vl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { applyVal(); vl.blur(); }
    if (e.key === 'Escape') { vl.value = fmt(parseFloat(el.value)); vl.blur(); }
  });

  const resetBtn = document.createElement('button');
  resetBtn.className = 'ctrl-reset-btn';
  resetBtn.dataset.i18nTitle = 'slider-reset';
  resetBtn.title = t('slider-reset');
  resetBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
  resetBtn.addEventListener('click', () => {
    const id = el.id;
    if ((id === 'maskW' || id === 'maskH') && state.mask.shape === 'phone') {
      const cw = canvas.width, ch = canvas.height;
      const targetW = 360, targetH = 780;
      let dw, dh;
      if (state.phoneLandscape) {
        dw = Math.min(targetH, cw);
        dh = Math.round(dw * targetW / targetH);
        if (dh > ch) { dh = Math.min(targetW, ch); dw = Math.round(dh * targetH / targetW); }
      } else {
        dw = Math.min(targetW, cw);
        dh = Math.round(dw * targetH / targetW);
        if (dh > ch) { dh = Math.min(targetH, ch); dw = Math.round(dh * targetW / targetH); }
      }
      el.value = id === 'maskW' ? dw : dh;
    } else if ((id === 'maskW' || id === 'maskH') && state.mask.shape === 'glasses') {
      const cw = canvas.width, ch = canvas.height;
      const _gs = _glassesInitSize(cw, ch);
      el.value = id === 'maskW' ? _gs.w : _gs.h;
    } else {
      el.value = el.defaultValue;
    }
    el.dispatchEvent(new Event('input'));
  });
  vl.insertAdjacentElement('afterend', resetBtn);
  lucide.createIcons({ nodes: [resetBtn] });
}

bindSlider('vol0',    'vol0Val',    v => `${Math.round(v)}`,    v => { vid[0].volume = (v / 100) ** 2; });
bindSlider('vol1',    'vol1Val',    v => `${Math.round(v)}`,    v => { vid[1].volume = (v / 100) ** 2; });

// ---- マスターボリューム ----
{
  const volTrack      = document.getElementById('masterVolTrack');
  const volFill       = document.getElementById('masterVolFill');
  const volThumb      = document.getElementById('masterVolThumb');
  const masterMuteBtn = document.getElementById('masterMuteBtn');
  let _masterVol    = 100;
  let _masterMuted  = false;

  const _applyVolUI = () => {
    if (!volFill) return;
    const pct = _masterMuted ? 0 : _masterVol;
    volFill.style.height  = `${pct}%`;
    volThumb.style.bottom = `${pct}%`;
  };
  const _applyMaster = () => {
    const g = _masterMuted ? 0 : _masterVol / 100;
    vid[0].volume = g * (parseFloat(elVol0.value) / 100) ** 2;
    vid[1].volume = g * (parseFloat(elVol1.value) / 100) ** 2;
    const iconName = _masterMuted || _masterVol === 0 ? 'volume-x' : _masterVol < 50 ? 'volume-1' : 'volume-2';
    masterMuteBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    lucide.createIcons({ nodes: [masterMuteBtn] });
    _applyVolUI();
  };
  _applyMaster();

  if (volTrack) {
    let _volDragging = false;
    const _volSeek = e => {
      const r = volTrack.getBoundingClientRect();
      const pct = Math.min(100, Math.max(0, Math.round((1 - (e.clientY - r.top) / r.height) * 100)));
      _masterVol = pct;
      _masterMuted = false;
      _applyMaster();
    };
    volTrack.addEventListener('mousedown', e => {
      _volDragging = true;
      volTrack.classList.add('dragging');
      _volSeek(e);
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => { if (_volDragging) _volSeek(e); });
    document.addEventListener('mouseup', () => {
      if (_volDragging) {
        _volDragging = false;
        volTrack.classList.remove('dragging');
      }
    });
    volTrack.addEventListener('touchstart', e => {
      _volDragging = true;
      volTrack.classList.add('dragging');
      _volSeek({ clientY: e.touches[0].clientY });
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', e => {
      if (_volDragging) _volSeek({ clientY: e.touches[0].clientY });
    });
    document.addEventListener('touchend', () => {
      if (_volDragging) {
        _volDragging = false;
        volTrack.classList.remove('dragging');
      }
    });
    volTrack.addEventListener('wheel', e => {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      _masterVol = Math.min(100, Math.max(0, _masterVol - Math.sign(e.deltaY) * step));
      _masterMuted = false;
      _applyMaster();
    }, { passive: false });
  }
  if (masterMuteBtn) {
    masterMuteBtn.addEventListener('click', e => {
      e.stopPropagation();
      _masterMuted = !_masterMuted;
      _applyMaster();
    });
  }
}
bindSlider('offset0', 'offset0Val', v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, null);
bindSlider('offset1', 'offset1Val', v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, null);
bindSlider('maskW',   'maskWVal',   v => `${Math.round(v)}`,    v => {
  const ar = state.mask.h > 0 ? state.mask.w / state.mask.h : 1;
  if (parseFloat(elMaskW.value) < 10) { elMaskW.value = 10; updateSliderFill(elMaskW); v = 10; document.getElementById('maskWVal').value = 10; }
  _syncZoomToMaskScale(state.mask.w, v);
  state.mask.w = v;
  if (state.arLock && state.mask.h > 0) {
    const newH = Math.max(0, Math.round(v / ar));
    state.mask.h = newH;
    elMaskH.value = newH;
    document.getElementById('maskHVal').value = newH;
    updateSliderFill(elMaskH);
  }
});
bindSlider('maskH',   'maskHVal',   v => `${Math.round(v)}`,    v => {
  const ar = state.mask.h > 0 ? state.mask.w / state.mask.h : 1;
  if (parseFloat(elMaskH.value) < 10) { elMaskH.value = 10; updateSliderFill(elMaskH); v = 10; document.getElementById('maskHVal').value = 10; }
  state.mask.h = v;
  if (state.arLock && state.mask.w > 0) {
    const newW = Math.max(0, Math.round(v * ar));
    state.mask.w = newW;
    elMaskW.value = newW;
    document.getElementById('maskWVal').value = newW;
    updateSliderFill(elMaskW);
  }
});
bindSlider('maskOffX', 'maskOffXVal', v => `${Math.round(v)}`, v => {
  const cw = canvas.width;
  const cx = Math.round((cw - state.mask.w) / 2);
  state.mask.x = Math.max(0, Math.min(cx + Math.round(v), cw - state.mask.w));
});
bindSlider('maskOffY', 'maskOffYVal', v => `${Math.round(v)}`, v => {
  const ch = canvas.height;
  const cy = Math.round((ch - state.mask.h) / 2);
  state.mask.y = Math.max(0, Math.min(cy + Math.round(v), ch - state.mask.h));
});
bindSlider('borderW', 'borderWVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('maskZoom', 'maskZoomVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(2), null);
bindSlider('fgPinX',   'fgPinXVal',   v => `${Math.round(v)}`, null);
bindSlider('fgPinY',   'fgPinYVal',   v => `${Math.round(v)}`, null);
bindSlider('fgPinLerp','fgPinLerpVal',v => `${Math.round(v)}`, null);
bindSlider('fgPinOpacity','fgPinOpacityVal',v => `${Math.round(v)}`, null);
bindSlider('maskBlur', 'maskBlurVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('maskPixel','maskPixelVal',v => `${Math.round(v)}`, null);
bindSlider('borderOpacity', 'borderOpacityVal', v => `${Math.round(v)}`, null);
bindSlider('borderAnimSpeed', 'borderAnimSpeedVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('borderAnimBright', 'borderAnimBrightVal', v => `${Math.round(v)}`, null);
bindSlider('frameBlur', 'frameBlurVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('frameTint', 'frameTintVal', v => `${Math.round(v)}`, null);
let _syncBorderSwatch    = () => {};
let _closeBorderColorPop = () => {};
export let _syncAnimColors = (_anim) => {};
let _resetBcpTarget      = ()      => {};
export function _applyBorderAnim(anim) {
  state.borderInvert = false;
  document.querySelector('.bcp-chip--invert')?.classList.remove('active');
  elBorderAnim.value = anim;
  document.querySelectorAll('.banim-btn[data-anim]').forEach(b => b.classList.toggle('active', b.dataset.anim === anim));
  const on = anim !== 'none';
  document.getElementById('borderColRow').classList.toggle('anim-active', on);
  document.getElementById('borderAnimSpeedRow').style.display  = on ? '' : 'none';
  document.getElementById('borderAnimBrightRow').style.display = on ? '' : 'none';
  const customRow = document.getElementById('bcpCustomAnimRow');
  if (customRow) {
    const showSwatches = on && anim !== 'rainbow';
    if (showSwatches) {
      const activeBtn = document.querySelector(`.banim-btn[data-anim="${anim}"]`);
      const wrap = activeBtn?.closest('.bcp-grad-wrap');
      if (activeBtn && wrap) {
        const btnRect  = activeBtn.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const centerX  = btnRect.left - wrapRect.left + btnRect.width / 2;
        customRow.style.setProperty('--pop-x', centerX + 'px');
      }
    }
    if (showSwatches) {
      const _applySwatchColors = () => {
        if (_animColors[anim]) {
          const [c0, c1] = _animColors[anim];
          const c0b = document.getElementById('bcpC0Swatch');
          const c1b = document.getElementById('bcpC1Swatch');
          if (c0b) c0b.style.background = c0;
          if (c1b) c1b.style.background = c1;
        }
      };
      _applySwatchColors();
      customRow.style.transition = 'none';
      customRow.classList.remove('is-open');
      customRow.style.opacity = '0';
      customRow.style.transform = 'translateX(-50%) translateY(-6px) scale(0.95)';
      void customRow.offsetHeight;
      customRow.style.transition = '';
      customRow.style.opacity = '';
      customRow.style.transform = '';
      customRow.classList.add('is-open');
    } else {
      customRow.classList.remove('is-open');
      if (anim === 'rainbow') _closeBorderColorPop();
    }
  }
  _resetBcpTarget();
  _syncBorderSwatch();
}
document.querySelectorAll('.banim-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = elBorderAnim.value;
    if (cur === btn.dataset.anim && cur !== 'rainbow') {
      const customRow = document.getElementById('bcpCustomAnimRow');
      if (customRow?.classList.contains('is-open')) {
        customRow.classList.remove('is-open');
        _closeBorderColorPop();
        _resetBcpTarget();
      } else {
        _applyBorderAnim(cur);
      }
      return;
    }
    const next = cur === btn.dataset.anim ? 'none' : btn.dataset.anim;
    _applyBorderAnim(next);
  });
});

// ── ボーダーカラーピッカー（HSV）
{
  const SOLID_PRESETS = [
    '#ffffff','#222222','#ff5555','#ff9933',
    '#ffdd33','#33dd77','#33aaff','#33eeff',
    '#aa55ff','#ff55bb','#ff8833'
  ];
  const GRAD_MAP = { rainbow: 'conic-gradient(from 0deg, #ff7eb3, #ffb347, #f9f871, #6ee7b7, #93c5fd, #d8b4fe, #ff7eb3)' };
  Object.entries(_animColors).forEach(([k, [c0, c1]]) => { GRAD_MAP[k] = `linear-gradient(135deg,${c0},${c1})`; });
  let _bcpTarget = 'main';

  const swatch    = document.getElementById('borderColorSwatch');
  const picker    = document.getElementById('borderColor');
  const popover   = document.getElementById('borderColorPopover');
  const solidRow  = document.getElementById('bcpSolidRow');
  const svCanvas  = document.getElementById('bcpSvCanvas');
  const hueCanvas = document.getElementById('bcpHueCanvas');
  const hexInput  = document.getElementById('bcpHexInput');
  const preview   = document.getElementById('bcpPreview');

  let _h = 0, _s = 1, _v = 1;

  function _hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if      (h <  60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function _hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function _rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d) {
      if      (max === r) h = ((g - b) / d + 6) % 6 * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else                h = ((r - g) / d + 4) * 60;
    }
    return [h, s, v];
  }

  function _drawSv() {
    const ctx = svCanvas.getContext('2d'), w = svCanvas.width, h = svCanvas.height;
    const gH = ctx.createLinearGradient(0, 0, w, 0);
    gH.addColorStop(0, '#fff'); gH.addColorStop(1, `hsl(${_h},100%,50%)`);
    ctx.fillStyle = gH; ctx.fillRect(0, 0, w, h);
    const gV = ctx.createLinearGradient(0, 0, 0, h);
    gV.addColorStop(0, 'rgba(0,0,0,0)'); gV.addColorStop(1, '#000');
    ctx.fillStyle = gV; ctx.fillRect(0, 0, w, h);
    const cx = _s * w, cy = (1 - _v) * h;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  }
  function _drawHue() {
    const ctx = hueCanvas.getContext('2d'), w = hueCanvas.width, h = hueCanvas.height;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const mx = Math.max(3, Math.min(w - 3, (_h / 360) * w));
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(mx - 3, 0, 6, h, 2); else ctx.rect(mx - 3, 0, 6, h);
    ctx.fill(); ctx.stroke();
  }

  function _applyColorState() {
    const [r, g, b] = _hsvToRgb(_h, _s, _v);
    const hex = _rgbToHex(r, g, b);
    hexInput.value = hex;
    preview.style.background = hex;
    if (_bcpTarget === 'c0') {
      const anim = elBorderAnim.value;
      if (_animColors[anim]) { _animColors[anim] = [hex, _animColors[anim][1]]; _syncAnimColors(anim); }
    } else if (_bcpTarget === 'c1') {
      const anim = elBorderAnim.value;
      if (_animColors[anim]) { _animColors[anim] = [_animColors[anim][0], hex]; _syncAnimColors(anim); }
    } else {
      picker.value = hex;
      document.querySelectorAll('.bcp-chip').forEach(c => c.classList.toggle('active', c.dataset.color === hex));
    }
    _syncBorderSwatch();
  }
  function _loadHex(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const [r, g, b] = _hexToRgb(hex);
    [_h, _s, _v] = _rgbToHsv(r, g, b);
    _drawSv(); _drawHue();
    hexInput.value = hex;
    preview.style.background = hex;
    document.querySelectorAll('.bcp-chip').forEach(c => c.classList.toggle('active', c.dataset.color === hex));
  }

  SOLID_PRESETS.forEach(hex => {
    const btn = document.createElement('button');
    btn.className = 'bcp-chip'; btn.style.background = hex; btn.dataset.color = hex;
    btn.addEventListener('click', () => {
      if (_bcpTarget === 'main') { _applyBorderAnim('none'); state.borderInvert = false; }
      _loadHex(hex); _applyColorState();
      if (_bcpTarget === 'main') _closeBorderColorPop();
    });
    solidRow.appendChild(btn);
  });
  // --- ネガポジ反転ボタン ---
  const invertBtn = document.createElement('button');
  invertBtn.className = 'bcp-chip bcp-chip--invert';
  invertBtn.title = 'ネガポジ反転';
  invertBtn.addEventListener('click', () => {
    _applyBorderAnim('none');
    state.borderInvert = !state.borderInvert;
    invertBtn.classList.toggle('active', state.borderInvert);
    _syncBorderSwatch();
    _closeBorderColorPop();
  });
  solidRow.appendChild(invertBtn);

  let _svDrag = false, _hueDrag = false, _wasDragging = false;
  function _pickSv(e) {
    const r = svCanvas.getBoundingClientRect();
    _s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    _v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    if (_bcpTarget === 'main') { _applyBorderAnim('none'); state.borderInvert = false; }
    _drawSv(); _applyColorState();
  }
  function _pickHue(e) {
    const r = hueCanvas.getBoundingClientRect();
    _h = Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360));
    _drawHue(); _drawSv(); _applyColorState();
  }
  svCanvas.addEventListener('mousedown',  e => { _svDrag  = true; _pickSv(e); });
  hueCanvas.addEventListener('mousedown', e => { _hueDrag = true; _pickHue(e); });
  window.addEventListener('mousemove', e => {
    if (_svDrag)  { _wasDragging = true; _pickSv(e); }
    if (_hueDrag) { _wasDragging = true; _pickHue(e); }
  });
  window.addEventListener('mouseup', () => { _svDrag = false; _hueDrag = false; });

  hexInput.addEventListener('change', () => {
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      if (_bcpTarget === 'main') { _applyBorderAnim('none'); state.borderInvert = false; }
      _loadHex(v); _applyColorState();
    }
  });

  picker.addEventListener('input', () => {
    if (_bcpTarget === 'main') { _applyBorderAnim('none'); state.borderInvert = false; }
    _loadHex(picker.value); _applyColorState();
  });

  _syncBorderSwatch = function () {
    const anim = elBorderAnim.value;
    if (state.borderInvert) {
      swatch.style.background = 'linear-gradient(135deg,#fff 50%,#000 50%)';
    } else {
      swatch.style.background = anim !== 'none' ? (GRAD_MAP[anim] || picker.value) : picker.value;
    }
  };
  _syncBorderSwatch();

  function _openPop() {
    _bcpTarget = 'main';
    document.getElementById('bcpC0Swatch')?.classList.remove('active');
    document.getElementById('bcpC1Swatch')?.classList.remove('active');
    _loadHex(picker.value);
    popover.style.display = '';
    swatch.classList.add('active');
  }
  _closeBorderColorPop = function () {
    popover.style.display = 'none';
    swatch.classList.remove('active');
    const customRow = document.getElementById('bcpCustomAnimRow');
    if (customRow) customRow.classList.remove('is-open');
    _resetBcpTarget();
  };
  swatch.addEventListener('click', e => {
    e.stopPropagation();
    popover.style.display === 'none' ? _openPop() : _closeBorderColorPop();
  });
  document.addEventListener('click', e => {
    if (_wasDragging) { _wasDragging = false; return; }
    if (!popover.contains(e.target) && e.target !== swatch) _closeBorderColorPop();
  });
  popover.addEventListener('click', e => e.stopPropagation());
  hexInput.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    const customRow = document.getElementById('bcpCustomAnimRow');
    if (customRow?.classList.contains('is-open')) {
      customRow.classList.remove('is-open');
      _resetBcpTarget();
      hexInput.blur();
    } else {
      _closeBorderColorPop();
    }
  });

  {
    const c0btn = document.getElementById('bcpC0Swatch');
    const c1btn = document.getElementById('bcpC1Swatch');
    const resetBtn = document.getElementById('bcpAnimReset');

    _syncAnimColors = function(anim) {
      if (!anim || !_animColors[anim]) return;
      const [c0, c1] = _animColors[anim];
      GRAD_MAP[anim] = `linear-gradient(135deg,${c0},${c1})`;
      const animBtn = document.querySelector(`.banim-btn[data-anim="${anim}"]`);
      if (animBtn) animBtn.style.background = GRAD_MAP[anim];
      if (elBorderAnim.value === anim) {
        if (c0btn) c0btn.style.background = c0;
        if (c1btn) c1btn.style.background = c1;
      }
      _syncBorderSwatch();
    };

    _resetBcpTarget = function() {
      _bcpTarget = 'main';
      if (c0btn) c0btn.classList.remove('active');
      if (c1btn) c1btn.classList.remove('active');
    };

    function _closeSwatchAndPop() {
      const customRow = document.getElementById('bcpCustomAnimRow');
      if (customRow) customRow.classList.remove('is-open');
      _resetBcpTarget();
    }
    c0btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_bcpTarget === 'c0') { _closeSwatchAndPop(); return; }
      _bcpTarget = 'c0';
      c0btn.classList.add('active');
      c1btn.classList.remove('active');
      const anim = elBorderAnim.value;
      _loadHex((_animColors[anim] || _ANIM_DEFAULTS.custom)[0]);
    });
    c1btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_bcpTarget === 'c1') { _closeSwatchAndPop(); return; }
      _bcpTarget = 'c1';
      c1btn.classList.add('active');
      c0btn.classList.remove('active');
      const anim = elBorderAnim.value;
      _loadHex((_animColors[anim] || _ANIM_DEFAULTS.custom)[1]);
    });
    if (resetBtn) {
      resetBtn.addEventListener('click', e => {
        e.stopPropagation();
        const anim = elBorderAnim.value;
        if (_ANIM_DEFAULTS[anim]) {
          _animColors[anim] = [..._ANIM_DEFAULTS[anim]];
          _syncAnimColors(anim);
          if (_bcpTarget === 'c0') _loadHex(_animColors[anim][0]);
          else if (_bcpTarget === 'c1') _loadHex(_animColors[anim][1]);
        }
      });
    }

    Object.keys(_animColors).forEach(_syncAnimColors);
  }

  _loadHex(picker.value);
}
bindSlider('filterBrightness', 'filterBrightnessVal', v => `${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterContrast',   'filterContrastVal',   v => `${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterHighlight',  'filterHighlightVal',  v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterShadow',     'filterShadowVal',     v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterSaturation', 'filterSaturationVal', v => `${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterHue',        'filterHueVal',        v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterTemp',       'filterTempVal',       v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterTint',       'filterTintVal',       v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterSharpness',  'filterSharpnessVal',  v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterCA',         'filterCAVal',         v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterVignette',   'filterVignetteVal',   v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterMatte',      'filterMatteVal',      v => `${parseFloat(v) % 1 === 0 ? parseInt(v) : parseFloat(v).toFixed(1)}`, null);
bindSlider('filterGrain',      'filterGrainVal',      v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterBloom',  'filterBloomVal',  v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterPencil',      'filterPencilVal',      v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterEmboss',      'filterEmbossVal',      v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterChalkboard',  'filterChalkboardVal',  v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterNightVision', 'filterNightVisionVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterAirbrush',    'filterAirbrushVal',    v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterFlare',      'filterFlareVal',      v => `${parseFloat(v) % 1 === 0 ? parseInt(v) : parseFloat(v).toFixed(1)}`, null);
bindSlider('filterBlur',       'filterBlurVal',       v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterBars',       'filterBarsVal',       v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), updateBarsOverlay);
bindSlider('filterFps',        'filterFpsVal',        v => v === 0 ? 'OFF' : `${v}`, null);
bindSlider('filterRain',       'filterRainVal',       v => `${Math.round(v)}`, v => {
  _rainSubVisible(v);
  if (v > 0 && !effectsHidden) _startRainOverlay(); else _stopRainOverlay();
});
bindSlider('rainSpeed',      'rainSpeedVal',      v => v.toFixed(1),        () => { if (parseInt(elFilterRain.value, 10) > 0 && !effectsHidden) _startRainOverlay(); });
bindSlider('rainRefraction', 'rainRefractionVal', v => `${Math.round(v)}`,   () => { if (parseInt(elFilterRain.value, 10) > 0 && !effectsHidden) _startRainOverlay(); });
bindSlider('rainShadow',     'rainShadowVal',     v => v === 1 ? 'ON' : 'OFF', () => { if (parseInt(elFilterRain.value, 10) > 0 && !effectsHidden) _startRainOverlay(); });
_rainSubVisible(parseInt(elFilterRain.value, 10));

elFilterFps.addEventListener('input', e => {
  if (!e.isTrusted) return;
  const v = parseFloat(elFilterFps.value);
  const snapped = _FPS_SNAPS.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
  if (snapped !== v) {
    elFilterFps.value = snapped;
    document.getElementById('filterFpsVal').value = snapped === 0 ? 'OFF' : `${snapped}`;
    updateSliderFill(elFilterFps);
  }
});

document.getElementById('filterVisBtn').addEventListener('click', () => {
  setEffectsHidden(!effectsHidden);
  const btn = document.getElementById('filterVisBtn');
  btn.innerHTML = effectsHidden
    ? '<i data-lucide="eye-off"></i>'
    : '<i data-lucide="eye"></i>';
  lucide.createIcons({ nodes: [btn] });
  updateCanvasFilter();
  updateBarsOverlay();
  if (effectsHidden) _stopRainOverlay();
  else if (parseInt(elFilterRain.value, 10) > 0) _startRainOverlay();
});

document.getElementById('filterResetBtn').addEventListener('click', () => {
  ['filterBrightness', 'filterContrast', 'filterHighlight', 'filterShadow', 'filterSaturation', 'filterHue', 'filterTemp', 'filterTint', 'filterSharpness', 'filterCA', 'filterVignette', 'filterMatte', 'filterGrain', 'filterBloom', 'filterPencil', 'filterEmboss', 'filterChalkboard', 'filterNightVision', 'filterAirbrush', 'filterFlare', 'filterBlur', 'filterBars', 'filterFps', 'maskBlur', 'maskPixel', 'filterRain'].forEach(id => {
    const el = document.getElementById(id);
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  });
  [
    { key: 'sharpness',  btnId: 'filterSharpnessMOBtn'  },
    { key: 'ca',         btnId: 'filterCAMOBtn'          },
    { key: 'matte',      btnId: 'filterMatteMOBtn'       },
    { key: 'bloom',      btnId: 'filterBloomMOBtn'       },
    { key: 'flare',      btnId: 'filterFlareMOBtn'       },
    { key: 'pencil',     btnId: 'filterPencilMOBtn'      },
    { key: 'emboss',     btnId: 'filterEmbossMOBtn'      },
    { key: 'chalkboard', btnId: 'filterChalkboardMOBtn'  },
    { key: 'nightvision',btnId: 'filterNightVisionMOBtn' },
    { key: 'airbrush',   btnId: 'filterAirbrushMOBtn'    },
  ].forEach(({ key, btnId }) => {
    state.filterMaskOnly[key] = false;
    document.getElementById(btnId)?.classList.remove('active');
  });
});

// ---- クイックフィルタープリセット ----
[
  { key: 'sharpness',  btnId: 'filterSharpnessMOBtn'  },
  { key: 'ca',         btnId: 'filterCAMOBtn'          },
  { key: 'matte',      btnId: 'filterMatteMOBtn'       },
  { key: 'bloom',      btnId: 'filterBloomMOBtn'       },
  { key: 'flare',      btnId: 'filterFlareMOBtn'       },
  { key: 'pencil',     btnId: 'filterPencilMOBtn'      },
  { key: 'emboss',     btnId: 'filterEmbossMOBtn'      },
  { key: 'chalkboard', btnId: 'filterChalkboardMOBtn'  },
  { key: 'nightvision',btnId: 'filterNightVisionMOBtn' },
  { key: 'airbrush',   btnId: 'filterAirbrushMOBtn'    },
].forEach(({ key, btnId }) => {
  document.getElementById(btnId).addEventListener('click', () => {
    state.filterMaskOnly[key] = !state.filterMaskOnly[key];
    document.getElementById(btnId).classList.toggle('active', state.filterMaskOnly[key]);
  });
});

const _FQP = {
  //            bright  cont   hl     sh     sat    hue    temp   tint   sharp  ca     vig    matte  grain  flare  blur   bars   fps    mblur  pixel
  cinema:  { filterBrightness: 95,  filterContrast: 122, filterHighlight: -15, filterShadow: +10, filterSaturation: 80,  filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 1.5, filterCA: 0.5, filterVignette: 4,   filterMatte: 5,   filterGrain: 0.8, filterFlare: 0,   filterBlur: 0, filterBars: 5,   filterFps: 24, maskBlur: 0, maskPixel: 0 },
  retro:   { filterBrightness: 105, filterContrast: 88,  filterHighlight: -20, filterShadow: +25, filterSaturation: 58,  filterHue: 0, filterTemp: +22, filterTint:  -8, filterSharpness: 0,   filterCA: 0,   filterVignette: 5,   filterMatte: 7,   filterGrain: 2.5, filterFlare: 1.5, filterBlur: 0, filterBars: 0,   filterFps: 18, maskBlur: 0, maskPixel: 0 },
  insta:   { filterBrightness: 112, filterContrast: 108, filterHighlight:   0, filterShadow:   0, filterSaturation: 128, filterHue: 0, filterTemp: +10, filterTint:   0, filterSharpness: 2,   filterCA: 0,   filterVignette: 1.5, filterMatte: 0,   filterGrain: 0,   filterFlare: 0.5, filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  pastel:  { filterBrightness: 130, filterContrast: 90,  filterHighlight:   0, filterShadow: +30, filterSaturation: 80,  filterHue: 0, filterTemp:   0, filterTint:  +5, filterSharpness: 0,   filterCA: 0,   filterVignette: 0,   filterMatte: 6,   filterGrain: 0,   filterFlare: 0,   filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  neon:    { filterBrightness: 88,  filterContrast: 138, filterHighlight: +20, filterShadow:   0, filterSaturation: 175, filterHue: 0, filterTemp: -18, filterTint: -10, filterSharpness: 0,   filterCA: 1.8, filterVignette: 7,   filterMatte: 0,   filterGrain: 0.5, filterFlare: 3.5, filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  sunset:  { filterBrightness: 108, filterContrast: 112, filterHighlight:   0, filterShadow:   0, filterSaturation: 135, filterHue: 0, filterTemp: +38, filterTint:  -5, filterSharpness: 1,   filterCA: 0,   filterVignette: 3,   filterMatte: 0,   filterGrain: 0,   filterFlare: 4.5, filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  cool:    { filterBrightness: 100, filterContrast: 108, filterHighlight:   0, filterShadow:   0, filterSaturation: 78,  filterHue: 0, filterTemp: -28, filterTint:   0, filterSharpness: 1.5, filterCA: 0,   filterVignette: 3,   filterMatte: 0,   filterGrain: 0,   filterFlare: 0,   filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  dreamy:  { filterBrightness: 112, filterContrast: 78,  filterHighlight: +15, filterShadow: +20, filterSaturation: 120, filterHue: 0, filterTemp: +15, filterTint:   0, filterSharpness: 0,   filterCA: 0,   filterVignette: 2,   filterMatte: 7,   filterGrain: 0,   filterFlare: 3,   filterBlur: 1.5, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  glitch:  { filterBrightness: 100, filterContrast: 122, filterHighlight:   0, filterShadow:   0, filterSaturation: 120, filterHue: 0, filterTemp:   0, filterTint:   0, filterSharpness: 0,   filterCA: 4.5, filterVignette: 2,   filterMatte: 0,   filterGrain: 2,   filterFlare: 0,   filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  noir:    { filterBrightness: 90,  filterContrast: 148, filterHighlight: -30, filterShadow: -20, filterSaturation: 12,  filterHue: 0, filterTemp:  -5, filterTint:   0, filterSharpness: 2,   filterCA: 0,   filterVignette: 8,   filterMatte: 3,   filterGrain: 1.2, filterFlare: 0,   filterBlur: 0, filterBars: 3,   filterFps: 24, maskBlur: 0, maskPixel: 0 },
  horror:  { filterBrightness: 83,  filterContrast: 130, filterHighlight:   0, filterShadow: -15, filterSaturation: 30,  filterHue: 0, filterTemp:  -8, filterTint:  -8, filterSharpness: 0,   filterCA: 0.5, filterVignette: 9,   filterMatte: 0,   filterGrain: 3.5, filterFlare: 0,   filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  modern:  { filterBrightness: 95,  filterContrast: 120, filterHighlight:   0, filterShadow:   0, filterSaturation: 110, filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 2,   filterCA: 2,   filterVignette: 0,   filterMatte: 0,   filterGrain: 0,   filterFlare: 1.5, filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  trend:   { filterBrightness: 90,  filterContrast: 150, filterHighlight:   0, filterShadow:   0, filterSaturation: 180, filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 0,   filterCA: 0,   filterVignette: 0,   filterMatte: 5,   filterGrain: 0,   filterFlare: 2,   filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
  prism:   { filterBrightness: 90,  filterContrast: 180, filterHighlight:  +4, filterShadow: +40, filterSaturation: 122, filterHue: 0, filterTemp: -12, filterTint:  -2, filterSharpness: 0,   filterCA: 3,   filterVignette: 0,   filterMatte: 6,   filterGrain: 0,   filterFlare: 3,   filterBlur: 0, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0 },
};
const _FQP_FILTER_KEYS = [
  'filterBrightness','filterContrast','filterHighlight','filterShadow',
  'filterSaturation','filterHue','filterTemp','filterTint',
  'filterSharpness','filterCA','filterVignette','filterMatte',
  'filterGrain','filterFlare','filterBlur','filterBars','filterFps','maskBlur','maskPixel','filterRain',
  'rainSpeed','rainRefraction','rainShadow'
];
const _FQP_CUSTOM_KEY = 'gf-fqp-custom';

export function _collectFilterParams() {
  return Object.fromEntries(_FQP_FILTER_KEYS.map(id => [id, parseFloat(document.getElementById(id)?.value ?? 0)]));
}
function _loadCustomFQP()        { try { return JSON.parse(localStorage.getItem(_FQP_CUSTOM_KEY) || '[]'); } catch { return []; } }
function _saveCustomFQPList(lst) { localStorage.setItem(_FQP_CUSTOM_KEY, JSON.stringify(lst)); }

function _applyFQPParams(params) {
  Object.entries(params).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input'));
  });
}

export function _renderCustomFQP() {
  const container = document.getElementById('filterQuickPresets');
  if (!container) return;
  container.querySelectorAll('.fqp-custom-btn').forEach(el => el.remove());
  const saveWrap = document.getElementById('fqpSaveWrap');
  _loadCustomFQP().forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.className = 'fqp-btn fqp-custom-btn';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'fqp-custom-name';
    const nameInner = document.createElement('span');
    nameInner.className = 'pname-inner';
    nameInner.textContent = item.name;
    nameSpan.appendChild(nameInner);
    const del = document.createElement('button');
    del.className = 'fqp-custom-del';
    del.title = t('fqp-custom-del-title');
    del.innerHTML = '<i data-lucide="x"></i>';
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (e.shiftKey) {
        const lst = _loadCustomFQP(); lst.splice(idx, 1);
        _saveCustomFQPList(lst); _renderCustomFQP();
      } else {
        _showDelPopup(del, t('del-confirm').replace('{name}', item.name), () => {
          const lst = _loadCustomFQP(); lst.splice(idx, 1);
          _saveCustomFQPList(lst); _renderCustomFQP();
        });
      }
    });
    del.addEventListener('mouseenter', () => { if (_shiftHeld) _setDelBtnIcon(del, 'trash-2'); });
    del.addEventListener('mouseleave', () => { _setDelBtnIcon(del, 'x'); });
    btn.appendChild(nameSpan);
    btn.addEventListener('click', () => _applyFQPParams(item.params));
    btn.appendChild(del);
    btn.addEventListener('keydown', e => {
      if (e.key !== 'F2') return;
      e.preventDefault();
      const inner = btn.querySelector('.pname-inner');
      if (!inner || inner.contentEditable === 'true') return;
      const prev = inner.textContent;
      inner.contentEditable = 'plaintext-only';
      inner.classList.remove('overflows');
      inner.style.removeProperty('--slide-dist');
      inner.focus();
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(inner); sel.removeAllRanges(); sel.addRange(range);
      const commit = () => {
        inner.contentEditable = 'false';
        const next = inner.textContent.trim().slice(0, 20) || prev;
        inner.textContent = next;
        const lst = _loadCustomFQP();
        if (lst[idx]) { lst[idx].name = next; _saveCustomFQPList(lst); }
        requestAnimationFrame(_calcOverflow);
      };
      inner.addEventListener('blur', commit, { once: true });
      const _renameKeydown = ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); inner.removeEventListener('keydown', _renameKeydown); inner.blur(); }
        if (ev.key === 'Escape') { inner.removeEventListener('keydown', _renameKeydown); inner.textContent = prev; inner.blur(); }
      };
      inner.addEventListener('keydown', _renameKeydown);
    });
    const _calcOverflow = () => {
      const inner = btn.querySelector('.pname-inner');
      const outer = btn.querySelector('.fqp-custom-name');
      if (!inner || !outer) return;
      const overflow = inner.scrollWidth - outer.clientWidth;
      if (overflow > 2) {
        inner.classList.add('overflows');
        inner.style.setProperty('--slide-dist', `-${overflow}px`);
      } else {
        inner.classList.remove('overflows');
        inner.style.removeProperty('--slide-dist');
      }
    };
    btn.addEventListener('mouseenter', () => requestAnimationFrame(_calcOverflow));
    container.insertBefore(btn, saveWrap);
    lucide.createIcons({ nodes: [del] });
    requestAnimationFrame(_calcOverflow);
  });
}

document.querySelectorAll('.fqp-btn[data-fqp]').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = _FQP[btn.dataset.fqp];
    if (p) _applyFQPParams(p);
  });
});

// ---- カスタムFQP 保存フォーム ----
{
  const saveBtn    = document.getElementById('fqpSaveBtn');
  const nameForm   = document.getElementById('fqpNameForm');
  const nameInput  = document.getElementById('fqpNameInput');
  const nameOk     = document.getElementById('fqpNameOk');
  const nameCancel = document.getElementById('fqpNameCancel');
  lucide.createIcons({ nodes: [nameOk, nameCancel] });

  const _openForm  = () => { saveBtn.style.display = 'none'; nameForm.style.display = 'inline-flex'; nameInput.value = ''; nameInput.focus(); };
  const _closeForm = () => { nameForm.style.display = 'none'; saveBtn.style.display = ''; };
  let _fqpCommitting = false;
  const _commit    = () => {
    if (_fqpCommitting) return;
    _fqpCommitting = true;
    const name = nameInput.value.trim();
    if (name) {
      const lst = _loadCustomFQP();
      lst.push({ name, params: _collectFilterParams() });
      _saveCustomFQPList(lst);
      _renderCustomFQP();
    }
    _closeForm();
    _fqpCommitting = false;
  };

  saveBtn.addEventListener('click', _openForm);
  nameOk.addEventListener('click', _commit);
  nameCancel.addEventListener('click', _closeForm);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); _commit(); }
    if (e.key === 'Escape') { e.stopPropagation(); _closeForm(); }
  });
  nameInput.addEventListener('blur', e => {
    if (e.relatedTarget === nameOk || e.relatedTarget === nameCancel) return;
    if (nameForm.style.display === 'none') return;
    _commit();
  });
}
_renderCustomFQP();

// ミュートボタン
const _muteVolume = [null, null];
[0, 1].forEach(i => {
  const btn   = document.getElementById(`mute${i}`);
  const volEl = document.getElementById(`vol${i}`);
  const valEl = document.getElementById(`vol${i}Val`);
  btn.addEventListener('click', () => {
    vid[i].muted = !vid[i].muted;
    btn.classList.toggle('muted', vid[i].muted);
    if (vid[i].muted) {
      _muteVolume[i] = parseFloat(volEl.value);
      volEl.value = 0;
      valEl.value = '0';
      updateSliderFill(volEl);
    } else {
      const prev = _muteVolume[i] ?? 50;
      volEl.value = prev;
      valEl.value = String(Math.round(prev));
      updateSliderFill(volEl);
      vid[i].volume = (prev / 100) ** 2;
    }
  });
});

// オフセットステップボタン
document.querySelectorAll('.offset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const el = document.getElementById(btn.dataset.id);
    const valEl = document.getElementById(btn.dataset.id + 'Val');
    const d = parseFloat(btn.dataset.d);
    const fmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
    let next = d === 0 ? 0 : Math.round((parseFloat(el.value) + d) * 100) / 100;
    next = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), next));
    el.value = next;
    valEl.value = fmt(next);
    updateSliderFill(el);
  });
});

// ============================================================
//  シェイプボタン
// ============================================================
let _phoneMaskState    = null;
let _nonPhoneMaskState = null;

document.querySelectorAll('.shape-btn').forEach(btn => {
  btn.addEventListener('pointerdown', () => {
    if (btn.disabled) return;
    document.querySelectorAll('.shape-btn').forEach(b => {
      b.classList.add('_was-active');
      if (b.classList.contains('active')) b.classList.add('_had-active');
      b.classList.remove('active');
    });
    const onUp = e => {
      document.removeEventListener('pointerup', onUp);
      const pending = document.querySelector('.shape-btn._was-active');
      if (pending) {
        document.querySelectorAll('.shape-btn._was-active').forEach(b => {
          if (b.classList.contains('_had-active')) b.classList.add('active');
          b.classList.remove('_was-active', '_had-active');
        });
      }
    };
    document.addEventListener('pointerup', onUp);
  });
  btn.addEventListener('click', () => {
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('_was-active', '_had-active'));
    if (btn.disabled) return;
    const prevShape = state.mask.shape;
    const newShape  = btn.dataset.shape;
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mask.shape = newShape;
    elPhoneUiRow.style.display = newShape === 'phone' ? '' : 'none';
    elGlassesUiRow.style.display = newShape === 'glasses' ? '' : 'none';
    elSpectrumUiRow.style.display = newShape === 'spectrum' ? '' : 'none';
    document.getElementById('specBarsRow').style.display    = newShape === 'spectrum' ? '' : 'none';
    document.getElementById('specAmpRow').style.display     = newShape === 'spectrum' ? '' : 'none';
    document.getElementById('specGapRow').style.display     = newShape === 'spectrum' ? '' : 'none';
    document.getElementById('specSmoothRow').style.display  = newShape === 'spectrum' ? '' : 'none';
    document.getElementById('specSymRow').style.display     = newShape === 'spectrum' ? '' : 'none';
    document.getElementById('specRotateRow').style.display  = newShape === 'spectrum' ? '' : 'none';
    const _isFrameShape2 = newShape === 'phone' || newShape === 'glasses';
    document.getElementById('frameBlurRow').style.display = _isFrameShape2 ? '' : 'none';
    document.getElementById('frameTintRow').style.display = _isFrameShape2 ? '' : 'none';
    if (newShape === 'glasses') {
      const _gsi = state.mask.glassesStyle || 0;
      elGlassesStyleBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.gstyle) === _gsi));
    }
    _updateFgFixedBtn();

    if (prevShape !== 'phone' && newShape === 'phone') {
      // メガネからの遷移: 横長サイズがそのまま残らないよう h×h に正規化して保存
      const saveW = prevShape === 'glasses' ? state.mask.h : state.mask.w;
      _nonPhoneMaskState = { w: saveW, h: state.mask.h, x: state.mask.x, y: state.mask.y };
    } else if (prevShape === 'phone' && newShape !== 'phone') {
      _phoneMaskState = { w: state.mask.w, h: state.mask.h, x: state.mask.x, y: state.mask.y };
      if (_nonPhoneMaskState) {
        state.mask.w = _nonPhoneMaskState.w; state.mask.h = _nonPhoneMaskState.h;
        state.mask.x = _nonPhoneMaskState.x; state.mask.y = _nonPhoneMaskState.y;
      } else {
        state.mask.w = 400; state.mask.h = 400;
        state.mask.x = Math.round((canvas.width  - 400) / 2);
        state.mask.y = Math.round((canvas.height - 400) / 2);
      }
    }

    // メガネからの遷移: h×h の正方形に正規化（全遷移先に適用）
    if (prevShape === 'glasses' && newShape !== 'glasses' && newShape !== 'phone') {
      const side = state.mask.h;
      state.mask.w = side;
      state.mask.x = Math.round((canvas.width - side) / 2);
    }

    if (newShape === 'heart') {
      const side = Math.max(state.mask.w, state.mask.h);
      state.mask.w = side; state.mask.h = side;
      ['maskW','maskH'].forEach(id => {
        const el = document.getElementById(id);
        el.value = Math.round(side);
        document.getElementById(id + 'Val').value = Math.round(side);
        updateSliderFill(el);
      });
      if (!state.arLock) { state.arLockBeforeAutoLock = false; state.arLock = true; _updateArLockBtn(); }
    } else if (newShape === 'phone') {
      const cw = canvas.width, ch = canvas.height;
      let newW, newH, newX, newY;
      if (_phoneMaskState) {
        newW = _phoneMaskState.w; newH = _phoneMaskState.h;
        newX = _phoneMaskState.x; newY = _phoneMaskState.y;
      } else {
        const targetW = 360, targetH = 780;
        newW = Math.min(targetW, cw);
        newH = Math.round(newW * targetH / targetW);
        if (newH > ch) { newH = ch; newW = Math.round(newH * targetW / targetH); }
        newX = Math.round((cw - newW) / 2);
        newY = Math.round((ch - newH) / 2);
      }
      state.mask.w = newW; state.mask.h = newH;
      state.mask.x = newX; state.mask.y = newY;
      if (!state.arLock) { state.arLockBeforeAutoLock = false; state.arLock = true; _updateArLockBtn(); }
    } else if (newShape === 'glasses') {
      const cw = canvas.width, ch = canvas.height;
      const _gs = _glassesInitSize(cw, ch);
      state.mask.w = _gs.w; state.mask.h = _gs.h;
      state.mask.x = Math.round((cw - _gs.w) / 2);
      state.mask.y = Math.round((ch - _gs.h) / 2);
      if (!state.arLock) { state.arLockBeforeAutoLock = false; state.arLock = true; _updateArLockBtn(); }
    } else if (newShape === 'spectrum') {
      connectAudioElements(vid[0], vid[1]);
      if (!state.arLock) { state.arLockBeforeAutoLock = false; state.arLock = true; _updateArLockBtn(); }
    } else {
      if (state.arLockBeforeAutoLock !== null) {
        state.arLock = state.arLockBeforeAutoLock;
        state.arLockBeforeAutoLock = null;
        _updateArLockBtn();
      } else if (state.arLock) {
        state.arLock = false;
        _updateArLockBtn();
      } else {
        _updateArLockBtn();
      }
    }
    _syncMaskSliders();
  });
});

// ---- スマホ UI オーバーレイ 表示トグル ----
[
  { btn: elPhoneUiBtnRoT,   get: () => state.phoneShowRoT,  set: v => { state.phoneShowRoT  = v; } },
  { btn: elPhoneUiBtnRec,   get: () => state.phoneShowRec,  set: v => { state.phoneShowRec  = v; } },
  { btn: elPhoneUiBtnDot,   get: () => state.phoneShowDot,  set: v => { state.phoneShowDot  = v; } },
].forEach(({ btn, get, set }) => {
  btn.addEventListener('click', () => {
    set(!get());
    btn.classList.toggle('active', get());
  });
});

elPhoneUiBtnRot90.addEventListener('click', () => {
  state.phoneLandscape = !state.phoneLandscape;
  elPhoneUiBtnRot90.classList.toggle('active', state.phoneLandscape);
  const cw = renderCvs.width, ch = renderCvs.height;
  const tmp = state.mask.w;
  state.mask.w = state.mask.h;
  state.mask.h = tmp;
  state.mask.x = Math.round((cw - state.mask.w) / 2);
  state.mask.y = Math.round((ch - state.mask.h) / 2);
  _syncMaskSliders();
});

// ---- メガネ スタイル ボタン ----
elGlassesStyleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.gstyle);
    state.mask.glassesStyle = idx;
    elGlassesStyleBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.gstyle) === idx));
    const cw = canvas.width, ch = canvas.height;
    const _gs = _glassesInitSize(cw, ch);
    state.mask.w = _gs.w; state.mask.h = _gs.h;
    state.mask.x = Math.round((cw - _gs.w) / 2);
    state.mask.y = Math.round((ch - _gs.h) / 2);
    if (!state.arLock) { state.arLock = true; _updateArLockBtn(); }
    _syncMaskSliders();
  });
});

// ---- スペクトラム 形状ボタン ----
document.querySelectorAll('.spec-shape-btn[data-specshape]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.mask.specShape = btn.dataset.specshape;
    document.querySelectorAll('.spec-shape-btn[data-specshape]').forEach(b =>
      b.classList.toggle('active', b.dataset.specshape === state.mask.specShape));
  });
});
// ---- スペクトラム 対称ボタン ----
document.querySelectorAll('.spec-sym-btn[data-specsym]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.mask.specSym = btn.dataset.specsym;
    document.querySelectorAll('.spec-sym-btn[data-specsym]').forEach(b =>
      b.classList.toggle('active', b.dataset.specsym === state.mask.specSym));
  });
});
bindSlider('specBars',   'specBarsVal',   v => `${Math.round(v)}`, null);
bindSlider('specAmp',    'specAmpVal',    v => `${Math.round(v)}`, null);
bindSlider('specGap',    'specGapVal',    v => `${Math.round(v)}`, null);
bindSlider('specSmooth', 'specSmoothVal', v => `${Math.round(v)}`, null);
bindSlider('specRotate', 'specRotateVal', v => `${Math.round(v)}°`, v => { state.mask.specRotate = Math.round(v); });

document.getElementById('fgFixedBtn').addEventListener('click', () => {
  state.fgFixed = !state.fgFixed;
  if (state.fgFixed) {
    state.zoomLockBeforeFgFixed = state.zoomLock;
    if (!state.zoomLock) {
      state.zoomLock = true;
      _updateZoomLockBtn();
    }
  } else {
    if (state.zoomLockBeforeFgFixed !== null) {
      state.zoomLock = state.zoomLockBeforeFgFixed;
      state.zoomLockBeforeFgFixed = null;
      _updateZoomLockBtn();
    }
  }
  _updateFgFixedBtn();
});

// ---- マスクリセット ----
document.getElementById('maskVisBtn').addEventListener('click', () => {
  setMaskHidden(!maskHidden);
  const btn = document.getElementById('maskVisBtn');
  btn.innerHTML = maskHidden
    ? '<i data-lucide="eye-off"></i>'
    : '<i data-lucide="eye"></i>';
  lucide.createIcons({ nodes: [btn] });
});

document.getElementById('maskResetBtn').addEventListener('click', () => {
  const cw = canvas.width, ch = canvas.height;
  let dw, dh;
  if (state.mask.shape === 'phone') {
    const targetW = 360, targetH = 780;
    if (state.phoneLandscape) {
      dw = Math.min(targetH, cw);
      dh = Math.round(dw * targetW / targetH);
      if (dh > ch) { dh = Math.min(targetW, ch); dw = Math.round(dh * targetH / targetW); }
    } else {
      dw = Math.min(targetW, cw);
      dh = Math.round(dw * targetH / targetW);
      if (dh > ch) { dh = Math.min(targetH, ch); dw = Math.round(dh * targetW / targetH); }
    }
  } else if (state.mask.shape === 'glasses') {
    const _gs = _glassesInitSize(cw, ch);
    dw = _gs.w; dh = _gs.h;
  } else {
    dw = 400; dh = 400;
  }
  state.mask.w = dw;
  state.mask.h = dh;
  state.mask.x = Math.round((canvas.width  - dw) / 2);
  state.mask.y = Math.round((canvas.height - dh) / 2);
  state.arLock = (state.mask.shape === 'phone' || state.mask.shape === 'heart' || state.mask.shape === 'glasses' || state.mask.shape === 'spectrum');
  _updateArLockBtn();
  if (state.mask.shape === 'phone') {
    _phoneMaskState = { w: dw, h: dh, x: state.mask.x, y: state.mask.y };
  }
  const resetSlider = id => {
    const el = document.getElementById(id);
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  };
  _syncMaskSliders();
  ['maskOffX', 'maskOffY', 'maskBlur', 'maskPixel', 'maskZoom', 'borderW', 'borderOpacity', 'borderAnimSpeed', 'borderAnimBright', 'frameBlur', 'frameTint',
   'specBars', 'specAmp', 'specGap', 'specSmooth', 'specRotate'].forEach(resetSlider);
  lucide.createIcons();
});

// ============================================================
//  動画の入れ替え
// ============================================================
export function swapVideos() {
  [vid[0], vid[1]]                   = [vid[1], vid[0]];
  [img[0], img[1]]                   = [img[1], img[0]];
  [mediaType[0], mediaType[1]]       = [mediaType[1], mediaType[0]];
  [loaded[0], loaded[1]]             = [loaded[1], loaded[0]];
  [_currentHandle[0], _currentHandle[1]]   = [_currentHandle[1], _currentHandle[0]];
  [_loadedFileName[0], _loadedFileName[1]] = [_loadedFileName[1], _loadedFileName[0]];
  [_loadedPageUrl[0],  _loadedPageUrl[1]]  = [_loadedPageUrl[1],  _loadedPageUrl[0]];
  [_loadedSrcUrl[0],   _loadedSrcUrl[1]]   = [_loadedSrcUrl[1],   _loadedSrcUrl[0]];
  [_vidBitmap[0],      _vidBitmap[1]]      = [_vidBitmap[1],      _vidBitmap[0]];
  [_vidBitmapPending[0], _vidBitmapPending[1]] = [_vidBitmapPending[1], _vidBitmapPending[0]];
  [visHidden[0],       visHidden[1]]       = [visHidden[1],       visHidden[0]];

  if (mediaType[0] === 'video') vid[0].volume = (parseFloat(elVol0.value) / 100) ** 2;
  if (mediaType[1] === 'video') vid[1].volume = (parseFloat(elVol1.value) / 100) ** 2;

  updateMediaControls(0);
  updateMediaControls(1);

  const zone1 = document.getElementById('drop0');
  const zone2 = document.getElementById('drop1');
  const lbl1  = zone1.querySelector('.drop-label0');
  const lbl2  = zone2.querySelector('.drop-label1');
  [lbl1.textContent, lbl2.textContent] = [lbl2.textContent, lbl1.textContent];
  const anim1 = zone1.style.animation;
  const anim2 = zone2.style.animation;
  zone1.classList.toggle('loaded', loaded[0]);
  zone1.style.animation = anim2;
  zone2.classList.toggle('loaded', loaded[1]);
  zone2.style.animation = anim1;
  _updateDropLink(0);
  _updateDropLink(1);

  const urlInput0 = document.getElementById('urlInput0');
  const urlInput1 = document.getElementById('urlInput1');
  if (urlInput0 && urlInput1) {
    [urlInput0.value, urlInput1.value] = [urlInput1.value, urlInput0.value];
    urlInput0.style.borderColor = '';
    urlInput1.style.borderColor = '';
    const urlErr0 = document.getElementById('urlErr0');
    const urlErr1 = document.getElementById('urlErr1');
    if (urlErr0) urlErr0.textContent = '';
    if (urlErr1) urlErr1.textContent = '';
  }
  ['vol', 'offset'].forEach(key => {
    const r1 = document.getElementById(`${key}0`);
    const r2 = document.getElementById(`${key}1`);
    const v1 = document.getElementById(`${key}0Val`);
    const v2 = document.getElementById(`${key}1Val`);
    [r1.value, r2.value] = [r2.value, r1.value];
    [v1.value, v2.value] = [v2.value, v1.value];
    updateSliderFill(r1);
    updateSliderFill(r2);
  });

  [0, 1].forEach(i => {
    _stopBitmapCapture(i);
    if (mediaType[i] === 'video' && loaded[i]) _startBitmapCapture(i);
  });
}

document.getElementById('swapBtn').addEventListener('click', swapVideos);

canvas.addEventListener('mousedown', e => {
  if (e.button === 1) { e.preventDefault(); swapVideos(); }
});

// ============================================================
//  プログレスバー シークバー
// ============================================================
(function() {
  const track = document.getElementById('progressTrack');
  let seeking = false;

  function seek(e) {
    const r = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration
                 : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration : 0;
    if (!refDur) return;
    setCompositeT(pct * refDur);
    _applyCompositeT(_compositeT);
  }

  track.addEventListener('mousedown', e => {
    seeking = true;
    track.classList.add('dragging');
    seek(e);
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => { if (seeking) seek(e); });
  document.addEventListener('mouseup',   () => { seeking = false; track.classList.remove('dragging'); });

  track.addEventListener('touchstart', e => {
    seeking = true;
    track.classList.add('dragging');
    seek({ clientX: e.touches[0].clientX });
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (seeking) seek({ clientX: e.touches[0].clientX });
  });
  document.addEventListener('touchend', () => { seeking = false; track.classList.remove('dragging'); });
})();

// ============================================================
//  ページ可視性
//  タブの表示・非表示を検知する Page Visibility API。
//  別タブへの切り替えや最小化で document.hidden が true になる。
//  非表示時は動画を一時停止してリソースを節約し、
//  再表示時（かつ再生中だった場合）に自動で再開する。
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].pause(); });
  } else if (state.playing) {
    [0, 1].forEach(i => { if (loaded[i] && mediaType[i] === 'video') vid[i].play().catch(() => {}); });
  }
});
