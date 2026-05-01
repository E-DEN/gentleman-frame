// ============================================================
//  i18n ? js/i18n.js �����ǂݍ��ށi���̃t�@�C���������ɓǂݍ��ނ��Ɓj
// ============================================================
const PRESET_KEY = 'gentleFrame_presets';
let _presetsReady = false;
let _followMode = 'none'; // 'none' | 'mask' | 'anchor' | 'both'
let _fgPinDispX = 0, _fgPinDispY = 0; // �A���J�[�`���p���Ԓl�ilerp�j
let _fgZoomDisp = 1; // �Y�[�����Ԓl�ilerp�j
let _followTargetX = 0, _followTargetY = 0;
let _zoomLockBeforeFgFixed = null; // fgFixed ON�O��zoomLock�l���ێ�
let _arLockBeforeAutoLock = null;   // heart/phone����ON�O��arLock�l���ێ�
const _ANIM_DEFAULTS = {
  cm:     ['#22d3ee','#f472b6'],
  sakura: ['#f472b6','#4ade80'],
  cyber:  ['#8325df','#3be30b'],
  fire:   ['#ef4444','#f97316'],
  pink:   ['#dcbcd2','#cd2377'],
};
let _animColors = structuredClone(_ANIM_DEFAULTS);

function _setZoneLoaded(zone, isLoaded) {
  if (isLoaded) {
    zone.style.animation = '';
    void zone.offsetWidth; // reflow �ŃA�j���[�V���������Z�b�g
    zone.classList.add('loaded');
  } else {
    zone.classList.remove('loaded');
    zone.style.animation = '';
  }
}
;(function () {
  document.addEventListener('animationend', e => {
    const z = e.target;
    if (e.animationName === 'drop-loaded-settle' && z.classList.contains('loaded')) {
      z.style.animation = 'none';
    }
  }, true);
})();

// ============================================================
// ============================================================
const S = {
  playing: false,
  maskHovered: false,
  anchorHovered: false,
  maskTouched: false,
  mask: {
    x: 0,
    y: 0,
    w: 400,
    h: 400,
    shape: 'rect'
  },
  arLock: false,
  zoomLock: false,  // �}�X�N���T�C�Y���ɃY�[���������Ǐ]������
  fgFixed: false,   // false = �a�m�g���[�h�i�O�i���w�i�Ɠ��ʒu�j�Atrue = �A���J�[���[�h
  drag: { active: false, mode: null, ox: 0, oy: 0, sm: null, sp: null }
};

// ============================================================
// ============================================================
const _currentHandle  = [null, null];
const _loadedFileName = ['', ''];
const _loadedPageUrl  = ['', '']; // Iwara���y�[�WURL���L���i�����N�\���p�j
const _loadedSrcUrl   = ['', '']; // ���ۂɃ��[�h����URL�i�v���Z�b�g�����p�j

// ---- �v���Z�b�g���z�o�[�X���C�h�v�Z�i���W���[�����x��: �s�b�J�[�������Ȃ� renderPresets �O�������Ăׂ��j ----
function _calcOverflows(item) {
  const actions = item.querySelector('.preset-item-actions');
  if (actions) {
    actions.style.setProperty('max-width', '80px', 'important');
    actions.style.setProperty('margin-left', '0', 'important');
  }
  item.querySelectorAll('.pname-inner').forEach(inner => {
    const outer = inner.parentElement;
    const overflow = inner.scrollWidth - outer.clientWidth;
    if (overflow > 2) {
      inner.classList.add('overflows');
      const fadeZone = outer.clientWidth * 0.03;
      inner.style.setProperty('--slide-dist', `-${overflow + fadeZone}px`);
    } else {
      inner.classList.remove('overflows');
      inner.style.removeProperty('--slide-dist');
    }
  });
  if (actions) {
    actions.style.removeProperty('max-width');
    actions.style.removeProperty('margin-left');
  }
}

const _IDB = (() => {
  const DB = 'gentleFrameDB', ST = 'fileHandles';
  let db = null;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(ST);
    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror = rej;
  });
  return {
    set: async (k, v) => { const d = await open(); return new Promise((res,rej) => { const tx=d.transaction(ST,'readwrite'); tx.objectStore(ST).put(v,k); tx.oncomplete=res; tx.onerror=rej; }); },
    get: async (k)    => { const d = await open(); return new Promise((res,rej) => { const tx=d.transaction(ST,'readonly');  const r=tx.objectStore(ST).get(k); r.onsuccess=()=>res(r.result); r.onerror=rej; }); },
    del: async (k)    => { const d = await open(); return new Promise((res,rej) => { const tx=d.transaction(ST,'readwrite'); tx.objectStore(ST).delete(k); tx.oncomplete=res; tx.onerror=rej; }); },
  };
})();

// ============================================================
// ============================================================
const HANDLE_SZ = 3; // canvas���W�̔��T�C�Y

function getHandles(m) {
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
  const r  = m.x + m.w,     b  = m.y + m.h;
  return [
    { id: 'tl', x: m.x, y: m.y, cur: 'nw-resize' },
    { id: 'tc', x: cx,  y: m.y, cur: 'n-resize'  },
    { id: 'tr', x: r,   y: m.y, cur: 'ne-resize' },
    { id: 'ml', x: m.x, y: cy,  cur: 'w-resize'  },
    { id: 'mr', x: r,   y: cy,  cur: 'e-resize'  },
    { id: 'bl', x: m.x, y: b,   cur: 'sw-resize' },
    { id: 'bc', x: cx,  y: b,   cur: 's-resize'  },
    { id: 'br', x: r,   y: b,   cur: 'se-resize' },
  ];
}

// ============================================================
// ============================================================
const vid = [document.createElement('video'), document.createElement('video')];
const img = [document.createElement('img'), document.createElement('img')];
const mediaType = ['video', 'video']; // 'video' | 'image'

// requestVideoFrameCallback �Ŋe�t���[���� ImageBitmap �ɃX�i�b�v�V���b�g�B
// render ���[�v�̓��C�u�� video �e�N�X�`���ł͂Ȃ����� bitmap �����`�悷���B
const _vidBitmap = [null, null];
const _vidBitmapPending = [false, false];
function _startBitmapCapture(i) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
  function onFrame() {
    if (!_vidBitmapPending[i]) {
      _vidBitmapPending[i] = true;
      createImageBitmap(vid[i]).then(bmp => {
        if (_vidBitmap[i]) _vidBitmap[i].close();
        _vidBitmap[i] = bmp;
        _vidBitmapPending[i] = false;
      }).catch(() => { _vidBitmapPending[i] = false; });
    }
    vid[i].requestVideoFrameCallback(onFrame);
  }
  vid[i].requestVideoFrameCallback(onFrame);
}

function _stopBitmapCapture(i) {
  if (_vidBitmap[i]) { _vidBitmap[i].close(); _vidBitmap[i] = null; }

}

function getMediaSrc(i) {
  if (mediaType[i] === 'image') return img[i];
  return (_vidBitmap[i]) ? _vidBitmap[i] : vid[i];
}

const loaded = [false, false];
const visHidden = [false, false];
let maskHidden = false;
let effectsHidden = false;

vid.forEach(v => {
  v.loop = false;
  v.playsInline = true;
  v.preload = 'auto';
});

// ============================================================
//  Canvas + �I�t�X�N���[��
// ============================================================
const canvas  = document.getElementById('mainCanvas');
const displayCtx = canvas.getContext('2d');
const renderCvs = document.createElement('canvas');
renderCvs.width  = canvas.width;
renderCvs.height = canvas.height;
const ctx     = renderCvs.getContext('2d', { desynchronized: true });
const canvasWrap     = document.getElementById('canvasWrap');
const effectsWrap    = document.getElementById('effectsWrap');
const svgGblurEl     = document.getElementById('svgGblur');
const maskDropOverlay = document.getElementById('maskDropOverlay');
let _dispW = canvas.width;   // Canvas CSS�s�N�Z���\���T�C�Y
let _dispH = canvas.height;

const offCvs  = document.createElement('canvas');
offCvs.width  = canvas.width;
offCvs.height = canvas.height;
const offCtx  = offCvs.getContext('2d');

const postCvs = document.createElement('canvas');
postCvs.width  = canvas.width;
postCvs.height = canvas.height;
const postCtx  = postCvs.getContext('2d');
const chCvs = document.createElement('canvas');
chCvs.width  = canvas.width;
chCvs.height = canvas.height;
const chCtx  = chCvs.getContext('2d');
const caCvs = document.createElement('canvas');
caCvs.width  = canvas.width;
caCvs.height = canvas.height;
const caCtx  = caCvs.getContext('2d');
let _mblurCvs = document.createElement('canvas');
_mblurCvs.width  = canvas.width;
_mblurCvs.height = canvas.height;
let _mblurCtx = _mblurCvs.getContext('2d');

const grainCvs = document.createElement('canvas');
grainCvs.width = 256; grainCvs.height = 256;
const grainCtx = grainCvs.getContext('2d');

// Canvas �o�b�t�@�𑜓x�� CSS �\���T�C�Y�ɓ������ăA�b�v�X�P�[�����̂ڂ������h��
let _canvasAR = 1920 / 1080; // ���݂̃A�X�y�N�g��
let _prevBufW = 1920, _prevBufH = 1080; // �o�b�t�@�ύX�O�̃T�C�Y�i�}�X�N�䗦�X�P�[���p�j

let _cachedAccent = '';
let _cachedBg = '';
let _maskOverlayCache = { left: '', top: '', width: '', height: '', borderRadius: '' };
function _readCssVars() {
  const s = getComputedStyle(document.documentElement);
  _cachedAccent = s.getPropertyValue('--accent').trim();
  _cachedBg = s.getPropertyValue('--bg').trim() || '#080810';
}
_readCssVars();

// _syncMaskSliders / _syncOffsetSliders �Ŏg������ DOM �L���b�V���u���b�N�������ɐ錾
const elMaskW    = document.getElementById('maskW');
const elMaskH    = document.getElementById('maskH');
const elMaskOffX = document.getElementById('maskOffX');
const elMaskOffY = document.getElementById('maskOffY');
const elMaskZoom = document.getElementById('maskZoom');

function _syncAllBuffers(w, h) {
  canvas.width  = w; canvas.height = h;
  renderCvs.width = w; renderCvs.height = h;
  offCvs.width  = w; offCvs.height = h;
  postCvs.width = w; postCvs.height = h;
  chCvs.width   = w; chCvs.height  = h;
  caCvs.width   = w; caCvs.height  = h;
  if (_mblurCvs) { _mblurCvs.width = w; _mblurCvs.height = h; }
}

function _syncMaskSliders() {
  // 790 ���̒l�̓L�����o�X���̃h���b�O�Őݒ��\�B�e�L�X�g���͎��ےl���\���B
  elMaskW.value = Math.min(Math.round(S.mask.w), +elMaskW.max);
  elMaskH.value = Math.min(Math.round(S.mask.h), +elMaskH.max);
  document.getElementById('maskWVal').value = Math.round(S.mask.w);
  document.getElementById('maskHVal').value = Math.round(S.mask.h);
  updateSliderFill(elMaskW);
  updateSliderFill(elMaskH);
  _syncOffsetSliders();
}

function _syncOffsetSliders() {
  const cw = canvas.width, ch = canvas.height;
  const cx = Math.round((cw - S.mask.w) / 2);
  const cy = Math.round((ch - S.mask.h) / 2);
  const offX = S.mask.x - cx;
  const offY = S.mask.y - cy;
  const halfW = Math.floor(cw / 2);
  const halfH = Math.floor(ch / 2);
  elMaskOffX.min = -halfW; elMaskOffX.max = halfW; elMaskOffX.value = offX;
  elMaskOffY.min = -halfH; elMaskOffY.max = halfH; elMaskOffY.value = offY;
  document.getElementById('maskOffXVal').value = offX;
  document.getElementById('maskOffYVal').value = offY;
  updateSliderFill(elMaskOffX);
  updateSliderFill(elMaskOffY);
}

// pending �}�X�N�ݒ����o�b�t�@���W�ɕϊ����ēK�p
// srcW/srcH ���� �� �䗦�X�P�[���ϊ��A�Ȃ��i���v���Z�b�g�j�� ���o�b�t�@�����ɔz�u
function _applyMaskFromPm(pm, cw, ch) {
  if (!pm) return false;
  if (pm.srcW && pm.srcH && pm.x != null) {
    const sx = cw / pm.srcW, sy = ch / pm.srcH;
    S.mask.w = Math.max(1, Math.min(Math.round(pm.w * sx), cw));
    S.mask.h = Math.max(1, Math.min(Math.round(pm.h * sy), ch));
    S.mask.x = Math.max(0, Math.min(Math.round(pm.x * sx), cw - S.mask.w));
    S.mask.y = Math.max(0, Math.min(Math.round(pm.y * sy), ch - S.mask.h));
  } else {
    S.mask.w = Math.max(1, Math.min(pm.w, cw));
    S.mask.h = Math.max(1, Math.min(pm.h, ch));
    S.mask.x = Math.round((cw - S.mask.w) / 2);
    S.mask.y = Math.round((ch - S.mask.h) / 2);
  }
  return true;
}

function setCanvasAspectRatio(w, h) {
  if (!w || !h) return;
  const prevAR = _canvasAR;
  _canvasAR = w / h;
  canvasWrap.style.setProperty('--ar', `${w}/${h}`);

  const arChangedBig = _canvasInitialized && Math.abs(prevAR - _canvasAR) / Math.max(prevAR, _canvasAR) > 0.1;

  _syncAllBuffers(w, h);

  if (!_canvasInitialized || arChangedBig || _pendingMask) {
    _canvasInitialized = true;
    const pm = _pendingMask;
    _pendingMask = null;
    if (!_applyMaskFromPm(pm, w, h)) {
      if (S.mask.shape === 'phone') {
        const targetW = 360, targetH = 780;
        let newW = Math.min(targetW, w);
        let newH = Math.round(newW * targetH / targetW);
        if (newH > h) { newH = h; newW = Math.round(newH * targetW / targetH); }
        S.mask.w = newW; S.mask.h = newH;
      } else {
        S.mask.w = Math.min(400, w);
        S.mask.h = Math.min(400, h);
      }
      S.mask.x = Math.round((w - S.mask.w) / 2);
      S.mask.y = Math.round((h - S.mask.h) / 2);
    }
  } else {
    const sx = w / _prevBufW;
    const sy = h / _prevBufH;
    S.mask.x = Math.round(S.mask.x * sx);
    S.mask.y = Math.round(S.mask.y * sy);
    S.mask.w = Math.round(S.mask.w * sx);
    S.mask.h = Math.round(S.mask.h * sy);
  }
  _prevBufW = w;
  _prevBufH = h;
  _syncMaskSliders();
}

let _canvasInitialized = false; // setCanvasAspectRatio �����x�ł��Ă΂ꂽ���i���惍�[�h�ς݃t���O�j
let _bufferSynced      = false; // ����CSS�\���T�C�Y�ւ̃o�b�t�@�����ς݂�
let _pendingMask = null; // applySettings �����ݒ��B���� setCanvasAspectRatio �œK�p������
let _activePresetIdx = null; // ���ݓK�p���̃v���Z�b�g�̃C���f�b�N�X
const _missingFiles  = new Set(); // �upresetId_slot�v�`��: ���̃Z�b�V�����Ńt�@�C���������������X���b�g
const _resolvedFiles = new Set(); // �upresetId_slot�v�`��: ���̃Z�b�V�����Ńt�@�C�����[�h���������X���b�g
const _pendingFiles  = new Set(); // �upresetId_slot�v�`��: �_�C�A���O�Ŗ��I���̂܂�OK�����X���b�g
let _shiftHeld = false; // Shift�������ԁi�폜�{�^���A�C�R���؂��ւ��p�j
const _setDelBtnIcon = (btn, icon) => {
  if (!btn) return;
  btn.innerHTML = `<i data-lucide="${icon}"></i>`;
  lucide.createIcons({ nodes: [btn] });
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Shift' || _shiftHeld) return;
  _shiftHeld = true;
  document.querySelector('.preset-item-delete:hover') && _setDelBtnIcon(document.querySelector('.preset-item-delete:hover'), 'trash-2');
  document.querySelector('.fqp-custom-del:hover') && _setDelBtnIcon(document.querySelector('.fqp-custom-del:hover'), 'trash-2');
});
document.addEventListener('keyup', e => {
  if (e.key !== 'Shift') return;
  _shiftHeld = false;
  document.querySelector('.preset-item-delete:hover') && _setDelBtnIcon(document.querySelector('.preset-item-delete:hover'), 'x');
  document.querySelector('.fqp-custom-del:hover') && _setDelBtnIcon(document.querySelector('.fqp-custom-del:hover'), 'x');
});

{
  const r = canvas.getBoundingClientRect();
  const iw = Math.round(r.width), ih = Math.round(r.height);
  const BUF_W = 1920, BUF_H = 1080;
  _syncAllBuffers(BUF_W, BUF_H);
  _prevBufW = BUF_W; _prevBufH = BUF_H;
  if (iw > 0) { _dispW = iw; _dispH = Math.round(iw / _canvasAR); }
  if (S.mask.shape === 'phone') {
    const _tW = 360, _tH = 780;
    let _mw = Math.min(_tW, BUF_W);
    let _mh = Math.round(_mw * _tH / _tW);
    if (_mh > BUF_H) { _mh = BUF_H; _mw = Math.round(_mh * _tW / _tH); }
    S.mask.w = _mw; S.mask.h = _mh;
    S.arLock = true;
  } else {
    S.mask.w = Math.min(400, BUF_W); S.mask.h = Math.min(400, BUF_H);
  }
  S.mask.x = Math.round((BUF_W - S.mask.w) / 2);
  S.mask.y = Math.round((BUF_H - S.mask.h) / 2);
  _bufferSynced = true;
  _syncMaskSliders();
  document.getElementById('phoneUiRow').style.display = S.mask.shape === 'phone' ? '' : 'none';
  _updateArLockBtn();
  _updateFgFixedBtn();
}

// ResizeObserver: _dispW/_dispH �̒ǐՂ̂݁B�o�b�t�@�E�}�X�N�͕ύX���Ȃ��B
new ResizeObserver(entries => {
  const w = Math.round(entries[0].contentRect.width);
  if (!w) return;
  _dispW = w;
  _dispH = Math.round(w / _canvasAR);
  if (_bufferSynced) return; // ���񓯊��ς݂Ȃ牽�����Ȃ�
  const h = _dispH;
  const BUF_W = 1920, BUF_H = 1080;
  _syncAllBuffers(BUF_W, BUF_H);
  _prevBufW = BUF_W; _prevBufH = BUF_H;
  if (S.mask.shape === 'phone') {
    const _tW = 360, _tH = 780;
    let _mw = Math.min(_tW, BUF_W);
    let _mh = Math.round(_mw * _tH / _tW);
    if (_mh > BUF_H) { _mh = BUF_H; _mw = Math.round(_mh * _tW / _tH); }
    S.mask.w = _mw; S.mask.h = _mh;
    S.arLock = true;
  } else {
    S.mask.w = Math.min(400, BUF_W); S.mask.h = Math.min(400, BUF_H);
  }
  S.mask.x = Math.round((BUF_W - S.mask.w) / 2);
  S.mask.y = Math.round((BUF_H - S.mask.h) / 2);
  _bufferSynced = true;
  _syncMaskSliders();
}).observe(canvas);

const elBorderW = document.getElementById('borderW');
const elBorderColor = document.getElementById('borderColor');
const elBorderOpacity = document.getElementById('borderOpacity');
const elBorderAnim = document.getElementById('borderAnim');
const elBorderAnimSpeed = document.getElementById('borderAnimSpeed');
const elBorderAnimBright = document.getElementById('borderAnimBright');
const elPhoneUiRow = document.getElementById('phoneUiRow');
const elPhoneUiBtnRoT = document.getElementById('phoneUiRoT');
const elPhoneUiBtnRec = document.getElementById('phoneUiRec');
const elPhoneUiBtnDot = document.getElementById('phoneUiDot');
const elPhoneUiBtnRot90 = document.getElementById('phoneUiRot90');
const elFgPinX = document.getElementById('fgPinX');
const elFgPinY = document.getElementById('fgPinY');
const elMaskBlur = document.getElementById('maskBlur');
const elFilterBlur = document.getElementById('filterBlur');
const elFilterBrightness = document.getElementById('filterBrightness');
const elFilterContrast = document.getElementById('filterContrast');
const elFilterSaturation = document.getElementById('filterSaturation');
const elFilterHue = document.getElementById('filterHue');
const elFilterVignette = document.getElementById('filterVignette');
const elFilterCA = document.getElementById('filterCA');
const elFilterTemp = document.getElementById('filterTemp');
const elFilterTint = document.getElementById('filterTint');
const elFilterHighlight = document.getElementById('filterHighlight');
const elFilterShadow = document.getElementById('filterShadow');
const elFilterSharpness = document.getElementById('filterSharpness');
const elFilterMatte = document.getElementById('filterMatte');
const elFilterGrain = document.getElementById('filterGrain');
const elMaskPixel = document.getElementById('maskPixel');
const elFilterFlare = document.getElementById('filterFlare');
const elFilterBars = document.getElementById('filterBars');
const elFilterFps = document.getElementById('filterFps');
const elProgressFill = document.getElementById('progressFill');
const elProgressThumb = document.getElementById('progressThumb');
const elTimeLabel = document.getElementById('timeLabel');
const elPlayBtn = document.getElementById('playBtn');

let _playDelayTimers = [];
let _compositeT = 0;
let _compositeLastRaf = null;
let _compositeSeekPending = false;
let _resyncTimer = null;
let _autoResyncEnabled = false;
let _autoResyncInterval = null;
let _maskBorderFadeStart = -1;
let _lastBufScale = 1;
let _lastFgAlpha  = 1;
let _fgFadeStart = -1; // �O�i�t�F�[�h�C���J�n���� (-1:�펞�\��, 0:���\���ҋ@, >0:�t�F�[�h��)

function _scheduleResync(initialDelay = 100) {
  clearTimeout(_resyncTimer);
  _resyncTimer = setTimeout(_doResync, initialDelay);
}
async function _doResync() {
  if (!S.playing || _compositeSeekPending) return;
  if (!loaded[0] || !loaded[1]) return;
  if (mediaType[0] !== 'video' || mediaType[1] !== 'video') return;
  // play() �Ăяo�������͂܂� paused �̂܂܂̂��Ƃ����� �� ���X�P�W���[�����đ҂�
  if (vid[0].paused || vid[1].paused) {
    _resyncTimer = setTimeout(_doResync, 80);
    return;
  }
  const [o1, o2] = _getOffsets();
  const t0 = vid[0].currentTime - o1;
  const diff = vid[1].currentTime - (t0 + o2); // ��=vid[1]���i�݂����A��=�x��
  if (Math.abs(diff) > 0.080) {
    // 80ms���̃Y��: vid[0] �͌p���Đ������Avid[1] �������V�[�N���ĕ␳
    // play() �����̋N���Y��(30?100ms)���܂߂đ��X�i�b�v
    vid[1].playbackRate = 1.0;
    vid[1].pause();
    vid[1].currentTime = Math.max(0, Math.min(vid[1].duration || 0, vid[0].currentTime - o1 + o2));
    await new Promise(res => {
      vid[1].addEventListener('seeked', res, { once: true });
    });
    if (S.playing && !_compositeSeekPending) {
      const postDiff = vid[1].currentTime - (vid[0].currentTime - o1 + o2);
      vid[1].playbackRate = postDiff < -0.016 ? 1.08 : postDiff > 0.016 ? 0.94 : 1.0;
      vid[1].play().catch(() => {});
      _resyncTimer = setTimeout(_doResync, 300);
    }
    return;
  } else if (Math.abs(diff) > 0.016) {
    // vid[1] ���x���Ă���(diff<0) �� ���������B�i�݂���(diff>0) �� �����x���B
    const rate = diff < 0 ? 1.08 : 0.94;
    vid[1].playbackRate = rate;
    _resyncTimer = setTimeout(_doResync, 300);
    return;
  } else {
    vid[1].playbackRate = 1.0;
  }
  _resyncTimer = setTimeout(_doResync, 1500);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.playing) _scheduleResync(80);
});
window.addEventListener('focus', () => {
  if (S.playing) _scheduleResync(80);
});

// ============================================================
//  Canvas CSS �t�B���^�[�i���邳 / �R���g���X�g / �ʓx�j
// ============================================================
function updateCanvasFilter() {
  if (effectsHidden) { effectsWrap.style.filter = ''; canvasWrap.style.filter = ''; return; }
  const b  = parseFloat(elFilterBrightness.value);
  const co = parseFloat(elFilterContrast.value);
  const s  = parseFloat(elFilterSaturation.value);
  const h  = parseFloat(elFilterHue.value);
  // blur はここで CSS に適用しない → render() でcanvas描画時に適用
  effectsWrap.style.filter = (b === 100 && co === 100 && s === 100 && h === 0)
    ? '' : `brightness(${b}%) contrast(${co}%) saturate(${s}%) hue-rotate(${h}deg)`;
  canvasWrap.style.filter = '';
}

const barsOverlay = document.getElementById('barsOverlay');
function updateBarsOverlay() {
  const barsAmt = parseFloat(elFilterBars.value);
  if (barsAmt <= 0 || effectsHidden) { barsOverlay.style.background = ''; return; }
  const pct = (barsAmt / 10) * 18;
  barsOverlay.style.background =
    `linear-gradient(to bottom, #000 ${pct}%, transparent ${pct}%, transparent ${100 - pct}%, #000 ${100 - pct}%)`;
}

// ============================================================
// ============================================================
const rainOverlay  = document.getElementById('rainOverlay');
const elFilterRain = document.getElementById('filterRain');

function _rainSubVisible(v) {
  ['rainSpeedRow', 'rainRefractionRow', 'rainShadowRow'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = v > 0 ? '' : 'none';
  });
}

window._startRainOverlay = function () {
  const amt = parseInt(elFilterRain.value, 10);
  if (amt > 0) {
    const elSpeed  = document.getElementById('rainSpeed');
    const elRef    = document.getElementById('rainRefraction');
    const elShadow = document.getElementById('rainShadow');
    GFRainEngine.start(rainOverlay, canvas, amt, {
      speed:      elSpeed  ? parseFloat(elSpeed.value)          : 1,
      refraction: elRef    ? parseFloat(elRef.value)            : 200,
      shadow:     elShadow ? parseInt(elShadow.value, 10) === 1 : false
    });
  }
};
window._stopRainOverlay = function () {
  GFRainEngine.stop();
};

function _brightHex(hex, bright) {
  if (bright === 70) return hex;
  const n = parseInt(hex.replace('#',''), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >>  8) & 0xff;
  const b =  n        & 0xff;
  if (bright <= 70) {
    const t = bright / 70;
    return `rgb(${Math.round(r*t)},${Math.round(g*t)},${Math.round(b*t)})`;
  } else {
    const t = (bright - 70) / 30;
    return `rgb(${Math.round(r+(255-r)*t)},${Math.round(g+(255-g)*t)},${Math.round(b+(255-b)*t)})`;
  }
}

function _buildBorderGrad(ctx, m, phase, anim, bright) {
  const L  = bright;
  const cx = m.x + m.w / 2;
  const cy = m.y + m.h / 2;
  const r  = Math.hypot(m.w, m.h) / 2;
  const a  = phase * Math.PI * 2;
  const g  = ctx.createLinearGradient(
    cx + Math.cos(a) * r, cy + Math.sin(a) * r,
    cx - Math.cos(a) * r, cy - Math.sin(a) * r
  );
  if (anim === 'rainbow') {
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,${L}%)`);
  } else if (_animColors[anim]) {
    const [c0, c1] = _animColors[anim];
    g.addColorStop(0,   _brightHex(c0, bright));
    g.addColorStop(0.5, _brightHex(c1, bright));
    g.addColorStop(1,   _brightHex(c0, bright));
  }
  return g;
}

// ============================================================
// ============================================================
// _renderFrame �� displayCtx blit �𓯈� rAF �R�[���o�b�N���ŃA�g�~�b�N�Ɏ��s���A
// setInterval �Ƃ̋����ɂ����e�B�A�����O���h���B
let _renderIntervalId = null; // �݊��p�i���݂͖��g�p�j

function _renderFrame() {
  if (_followMode === 'mask') {
    const lerpK = 0.22; // 1�t���[���������̒Ǐ]�� (0?1)
    const cx = _followTargetX - S.mask.w / 2;
    const cy = _followTargetY - S.mask.h / 2;
    S.mask.x = Math.round(S.mask.x + (cx - S.mask.x) * lerpK);
    S.mask.y = Math.round(S.mask.y + (cy - S.mask.y) * lerpK);
    _syncOffsetSliders();
  }

  const elFgPinLerp = document.getElementById('fgPinLerp');
  const _rawLerp = elFgPinLerp ? parseFloat(elFgPinLerp.value) : 50;
  const _pinLerpK = 0.01 * Math.pow(100, _rawLerp / 100);
  _fgPinDispX += (parseFloat(elFgPinX.value) - _fgPinDispX) * _pinLerpK;
  _fgPinDispY += (parseFloat(elFgPinY.value) - _fgPinDispY) * _pinLerpK;
  _fgZoomDisp += (parseFloat(elMaskZoom.value) - _fgZoomDisp) * _pinLerpK;

  const W = canvas.width;
  const H = canvas.height;
  const m = S.mask;
  // lineWidth �Ȃǂ́u�����ڌŒ��v�l�͂��̌W���ŕ␳�����B
  // lineWidth �Ȃǂ́u�����ڌŒ��v�l�͂��̌W���ŕ␳�����B
  const bufScale = _dispH > 0 ? H / _dispH : 1;
  _lastBufScale = bufScale;

  // --- �w�i ����/�摜�i���C���[ 1�j---
  if (loaded[0] && !visHidden[0]) {
    try { ctx.drawImage(getMediaSrc(0), 0, 0, W, H); }
    catch (e) { ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H); }
  } else {
    ctx.fillStyle = _cachedBg;
    ctx.fillRect(0, 0, W, H);
  }

  const maskBlur = parseFloat(elMaskBlur.value);
  const pixelAmt = parseFloat(elMaskPixel.value);

  // --- �O�i ����/�摜���}�X�N�ŃN���b�v�i���C���[ 2�j�A�ڂ����I�v�V�������� ---
  const fgAlpha = _fgFadeStart < 0 ? 1
    : _fgFadeStart === 0 ? 0
    : Math.min(1, (performance.now() - _fgFadeStart) / 200);
  _lastFgAlpha = fgAlpha;
  if (loaded[1] && !visHidden[1]) {
    offCtx.clearRect(0, 0, W, H);
    const maskZoom = _fgZoomDisp;
    if (Math.abs(maskZoom - 1) > 0.001 || Math.abs(parseFloat(elMaskZoom.value) - 1) > 0.001 || S.fgFixed) {
      // Mode 1�iOFF�j: �}�X�N������ zoom �̊��_�ɂ����i�}�X�N�Ǐ]�j
      // Mode 2�iON�j : �r�f�I�̃A���J�[�_�ifgPinX/Y�Ńp���j���}�X�N�����ɏd�Ȃ��悤�`��
      let dx, dy;
      if (S.fgFixed) {
        const mcx = m.x + m.w / 2;
        const mcy = m.y + m.h / 2;
        const ax  = W / 2 + _fgPinDispX;
        const ay  = H / 2 + _fgPinDispY;
        dx = mcx - ax * maskZoom;
        dy = mcy - ay * maskZoom;
      } else {
        const cx = m.x + m.w / 2;
        const cy = m.y + m.h / 2;
        dx = cx * (1 - maskZoom);
        dy = cy * (1 - maskZoom);
      }
      offCtx.drawImage(getMediaSrc(1), dx, dy, W * maskZoom, H * maskZoom);
    } else {
      offCtx.drawImage(getMediaSrc(1), 0, 0, W, H);
    }
    if (maskBlur > 0) {
      // blur (+pixel ������): offCvs �� blur+clip �ŕ`��
      if (pixelAmt >= 1) {
        const pSize = Math.round(pixelAmt * 4);
        const pw = Math.ceil(W / pSize);
        const ph = Math.ceil(H / pSize);
        postCtx.clearRect(0, 0, W, H);
        postCtx.drawImage(offCvs, 0, 0, pw, ph);
        offCtx.clearRect(0, 0, W, H);
        offCtx.imageSmoothingEnabled = false;
        offCtx.drawImage(postCvs, 0, 0, pw, ph, 0, 0, W, H);
        offCtx.imageSmoothingEnabled = true;
      }
      const bp = maskBlur * 2;
      ctx.save();
      if (!maskHidden) { buildMaskPath(ctx, m); ctx.clip(); }
      ctx.filter = `blur(${bp}px)`;
      ctx.globalAlpha = fgAlpha;
      ctx.drawImage(offCvs, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.restore();
    } else {
      // no blur: ���̃A���S���Y�� (pixel �� offCvs, destination-in �Ń}�X�N)
      if (pixelAmt >= 1) {
        const pSize = Math.round(pixelAmt * 4);
        const pw = Math.ceil(W / pSize);
        const ph = Math.ceil(H / pSize);
        postCtx.clearRect(0, 0, W, H);
        postCtx.drawImage(offCvs, 0, 0, pw, ph);
        offCtx.clearRect(0, 0, W, H);
        offCtx.imageSmoothingEnabled = false;
        offCtx.drawImage(postCvs, 0, 0, pw, ph, 0, 0, W, H);
        offCtx.imageSmoothingEnabled = true;
      }
      if (!maskHidden) {
        offCtx.globalCompositeOperation = 'destination-in';
        buildMaskPath(offCtx, m);
        offCtx.fill();
        offCtx.globalCompositeOperation = 'source-over';
      }
      ctx.save(); ctx.globalAlpha = fgAlpha;
      ctx.drawImage(offCvs, 0, 0);
      ctx.globalAlpha = 1; ctx.restore();
    }
  } else if (loaded[0] && !visHidden[1] && !maskHidden && _fgFadeStart !== 0) {
    // _fgFadeStart===0 (���[�h��) �͕\�����Ȃ�
    if (pixelAmt >= 1) {
      // pixel (+blur ������): ctx.clip()+�k�����g��
      const pSize = Math.round(pixelAmt * 4);
      const pw = Math.ceil(W / pSize);
      const ph = Math.ceil(H / pSize);
      postCtx.clearRect(0, 0, W, H);
      postCtx.drawImage(getMediaSrc(0), 0, 0, pw, ph);
      ctx.save();
      buildMaskPath(ctx, m);
      ctx.clip();
      if (maskBlur > 0) {
        const bp = maskBlur * 2;
        offCtx.clearRect(0, 0, W, H);
        offCtx.imageSmoothingEnabled = false;
        offCtx.drawImage(postCvs, 0, 0, pw, ph, 0, 0, W, H);
        offCtx.imageSmoothingEnabled = true;
        ctx.filter = `blur(${bp}px)`;
        ctx.drawImage(offCvs, -bp, -bp, W + bp * 2, H + bp * 2);
        ctx.filter = 'none';
      } else {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(postCvs, 0, 0, pw, ph, 0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
      }
      ctx.restore();
    } else if (maskBlur > 0) {
      // blur only: �I�[�o�[�h���[�Œ[�̔����h�~
      const bp = maskBlur * 2;
      ctx.save();
      buildMaskPath(ctx, m);
      ctx.clip();
      ctx.filter = `blur(${bp}px)`;
      ctx.drawImage(getMediaSrc(0), -bp, -bp, W + bp * 2, H + bp * 2);
      ctx.filter = 'none';
      ctx.restore();
    }
  }

  // --- �F�����i���ˏ��A�X�P�[���x�[�X�j---
  if (!effectsHidden) {
  const caAmt = parseFloat(elFilterCA.value);
  if (caAmt > 0) {
    postCtx.clearRect(0, 0, W, H);
    postCtx.drawImage(renderCvs, 0, 0);
    const s = caAmt * 0.002;
    const cx = W / 2, cy = H / 2;
    const _drawCh = (color, scale) => {
      chCtx.clearRect(0, 0, W, H);
      // scale<1 �̂Ƃ����Ɍ���(��)�������� �� ���ɃI���W�i���Ŗ��߂ă{�[�_�[���h��
      if (scale < 1) chCtx.drawImage(postCvs, 0, 0);
      chCtx.save();
      chCtx.translate(cx, cy);
      chCtx.scale(scale, scale);
      chCtx.translate(-cx, -cy);
      chCtx.drawImage(postCvs, 0, 0);
      chCtx.restore();
      chCtx.globalCompositeOperation = 'multiply';
      chCtx.fillStyle = color;
      chCtx.fillRect(0, 0, W, H);
      chCtx.globalCompositeOperation = 'source-over';
      caCtx.drawImage(chCvs, 0, 0);
    };
    caCtx.clearRect(0, 0, W, H);
    caCtx.globalCompositeOperation = 'screen';
    _drawCh('red',  1 + s);
    _drawCh('lime', 1);
    _drawCh('blue', 1 - s);
    caCtx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(caCvs, 0, 0);
  }

  // --- Highlights (���邢�g�[�����𑀍�) ---
  const hlAmt = parseFloat(elFilterHighlight.value);
  if (hlAmt !== 0) {
    const t = Math.abs(hlAmt) / 100;
    ctx.save();
    if (hlAmt > 0) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(255,255,255,${t * 0.60})`;
    } else {
      ctx.globalCompositeOperation = 'multiply';
      const l = Math.round(255 - t * 55);
      ctx.fillStyle = `rgb(${l},${l},${l})`;
    }
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Shadows (�Â��g�[�����𑀍�) ---
  const shAmt = parseFloat(elFilterShadow.value);
  if (shAmt !== 0) {
    const t = Math.abs(shAmt) / 100;
    ctx.save();
    if (shAmt > 0) {
      ctx.globalCompositeOperation = 'screen';
      const brightness = Math.round(t * 72);
      ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
    } else {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(0,0,0,${t * 0.60})`;
    }
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- �r�l�b�g ---
  const vigAmt = parseFloat(elFilterVignette.value);
  if (vigAmt > 0) {
    const cx = W / 2, cy = H / 2;
    const r1 = Math.min(W, H) * 0.30;
    const r2 = Math.sqrt(cx * cx + cy * cy) * 1.10;
    const vg = ctx.createRadialGradient(cx, cy, r1, cx, cy, r2);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${(vigAmt / 10) * 0.85})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // --- Color Temperature (�F���x) ---
  const tempAmt = parseFloat(elFilterTemp.value);
  if (tempAmt !== 0) {
    const t2 = Math.abs(tempAmt) / 50;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = tempAmt > 0
      ? `rgba(255,140,0,${0.22 * t2})`   // �g�F
      : `rgba(20,80,255,${0.22 * t2})`;  // ���F
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Tint (�F���Ԃ��␳: �}�[���^ ? �O���[��) ---
  const tintAmt = parseFloat(elFilterTint.value);
  if (tintAmt !== 0) {
    const t2 = Math.abs(tintAmt) / 50;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = tintAmt > 0
      ? `rgba(0,210,60,${0.14 * t2})`     // �O���[��
      : `rgba(255,0,200,${0.14 * t2})`;   // �}�[���^
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Matte (������ + ������) ---
  const matteAmt = parseFloat(elFilterMatte.value);
  if (matteAmt > 0) {
    const t    = matteAmt / 10;
    const lift  = Math.round(t * 50);        // 0 �� 50 : �Õ������グ
    const crush = Math.round(255 - t * 45);  // 255 �� 210 : �������V�䉺��
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgb(${lift},${lift},${lift})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${crush},${crush},${crush})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Film Grain (�t�B�������q) ---
  const grainAmt = parseFloat(elFilterGrain.value);
  if (grainAmt > 0) {
    const gSize = 256;
    const idata = grainCtx.createImageData(gSize, gSize);
    const gd = idata.data;
    const strength = (grainAmt / 10) * 110;
    for (let i = 0; i < gd.length; i += 4) {
      const v = Math.min(255, Math.max(0, 128 + (Math.random() - 0.5) * strength));
      gd[i] = gd[i+1] = gd[i+2] = v;
      gd[i+3] = 255;
    }
    grainCtx.putImageData(idata, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(grainCvs, 0, 0, W, H);
    ctx.restore();
  }

  // --- Sharpness (�I�[�o�[���C unsharp mask) ---
  const sharpAmt = parseFloat(elFilterSharpness.value);
  if (sharpAmt > 0) {
    // postCvs �Ɍ����̃t���[�����ۑ� �� chCvs �ɂڂ��� �� overlay �ō����g����������
    postCtx.clearRect(0, 0, W, H);
    postCtx.drawImage(renderCvs, 0, 0);
    chCtx.clearRect(0, 0, W, H);
    chCtx.filter = `blur(${1 + sharpAmt * 0.25}px)`;
    chCtx.drawImage(postCvs, 0, 0);
    chCtx.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(sharpAmt * 0.09, 0.85);
    ctx.drawImage(postCvs, 0, 0);
    ctx.restore();
  }

  // --- Color Flare (�J���[�t���A) ---
  const flareAmt = parseFloat(elFilterFlare.value);
  if (flareAmt > 0) {
    const alpha = (flareAmt / 10) * 0.35;
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0,    `rgba(255,0,80,${alpha})`);
    grad.addColorStop(0.2,  `rgba(255,120,0,${alpha})`);
    grad.addColorStop(0.4,  `rgba(255,240,0,${alpha})`);
    grad.addColorStop(0.6,  `rgba(0,220,80,${alpha})`);
    grad.addColorStop(0.8,  `rgba(0,120,255,${alpha})`);
    grad.addColorStop(1,    `rgba(160,0,255,${alpha})`);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Cinematic Bars: barsOverlay div (effectsWrap �O��) �ŕ`��? updateBarsOverlay() ���� ---

  } // end !effectsHidden

  // --- コンポジット時間 ---
  const _rafNow = performance.now();
  if (S.playing && !_compositeSeekPending) {
    const [o1, o2] = _getOffsets();
    if (loaded[0] && mediaType[0] === 'video' && !vid[0].paused && vid[0].readyState >= 2) {
      _compositeT = vid[0].currentTime - o1;
    } else if (loaded[1] && mediaType[1] === 'video' && !vid[1].paused && vid[1].readyState >= 2) {
      _compositeT = vid[1].currentTime - o2;
    } else if (_compositeLastRaf !== null) {
      _compositeT += (_rafNow - _compositeLastRaf) / 1000;
      // refDur �𒴂��Ȃ��悤�ɃN�����v
      const [_o1, _o2] = _getOffsets();
      const _refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration - _o1
                    : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration - _o2 : 0;
      if (_refDur > 0) _compositeT = Math.min(_compositeT, _refDur);
    }
    _compositeLastRaf = _rafNow;
  } else if (!S.playing || _compositeSeekPending) {
    _compositeLastRaf = null;
  }
}

// マスク枠・ハンドル・アンカー・スマホフレームを指定コンテキストに描画
// _renderFrame() の後、全体ぼかしより後のタイミングで呼ぶことで blur の影響を受けない
function _drawOverlays(dCtx) {
  const W = canvas.width, H = canvas.height;
  const m = S.mask;
  const bufScale = _lastBufScale;
  const maskHidden = S.maskHidden;

  // --- マスク枠 ---
  const bw = parseFloat(elBorderW.value);
  if (bw > 0 && !maskHidden && !visHidden[1]) {
    let borderFadeA;
    if (_fgFadeStart === 0) {
      borderFadeA = 0;
    } else if (_fgFadeStart > 0) {
      borderFadeA = _lastFgAlpha;
    } else if (_maskBorderFadeStart === 0) {
      borderFadeA = 0;
    } else if (_maskBorderFadeStart > 0) {
      borderFadeA = Math.min(1, (performance.now() - _maskBorderFadeStart) / 500);
    } else {
      borderFadeA = 1;
    }
    if (borderFadeA > 0) {
      const anim = elBorderAnim.value;
      dCtx.save();
      dCtx.lineWidth   = bw * bufScale;
      dCtx.globalAlpha = (parseInt(elBorderOpacity.value, 10) / 100) * borderFadeA;
      if (anim !== 'none') {
        const speed  = parseFloat(elBorderAnimSpeed.value) * 0.1;
        const bright = parseInt(elBorderAnimBright.value, 10);
        const phase  = (performance.now() * 0.001 * speed) % 1;
        dCtx.strokeStyle = _buildBorderGrad(dCtx, m, phase, anim, bright);
      } else {
        dCtx.strokeStyle = elBorderColor.value;
      }
      buildMaskPath(dCtx, m);
      dCtx.stroke();
      dCtx.restore();
    }
  }

  // --- リサイズハンドル ---
  if ((S.maskHovered || S.drag.active || S.maskTouched) && !maskHidden && !visHidden[1] && _followMode === 'none' && S.drag.mode !== 'fg-anchor') {
    dCtx.save();
    const accent = _cachedAccent;
    const hSz = Math.max(1, Math.round(HANDLE_SZ * bufScale));
    for (const h of getHandles(m)) {
      dCtx.fillStyle   = accent;
      dCtx.strokeStyle = 'rgba(255,255,255,0.8)';
      dCtx.lineWidth   = 1.5 * bufScale;
      dCtx.fillRect  (h.x - hSz, h.y - hSz, hSz * 2, hSz * 2);
      dCtx.strokeRect(h.x - hSz, h.y - hSz, hSz * 2, hSz * 2);
    }
    dCtx.restore();
  }

  // --- 前景アンカー (phone + fgFixed ON 時) ---
  if (S.fgFixed && S.mask.shape === 'phone' && loaded[1] && !visHidden[1]) {
    const ax  = W / 2 + parseFloat(elFgPinX.value);
    const ay  = H / 2 + parseFloat(elFgPinY.value);
    const r   = Math.max(18, Math.round(28 * bufScale));
    const abw = Math.max(8,  Math.round(12 * bufScale));
    const ca  = Math.max(5,  Math.round(7  * bufScale));
    const lw  = Math.max(1,  1.2 * bufScale);
    const clw = Math.max(1,  1.0 * bufScale);
    const _fgPinOpacityEl = document.getElementById('fgPinOpacity');
    const _anchorAlpha = _fgPinOpacityEl ? parseFloat(_fgPinOpacityEl.value) / 100 : 1;
    dCtx.save();
    dCtx.globalAlpha = _anchorAlpha;
    dCtx.globalCompositeOperation = 'difference';
    dCtx.strokeStyle = '#ffffff';
    dCtx.lineCap     = 'round';
    dCtx.lineJoin    = 'round';
    dCtx.lineWidth = lw;
    dCtx.beginPath();
    dCtx.moveTo(ax - r, ay - r + abw); dCtx.lineTo(ax - r, ay - r); dCtx.lineTo(ax - r + abw, ay - r); // TL
    dCtx.moveTo(ax + r - abw, ay - r); dCtx.lineTo(ax + r, ay - r); dCtx.lineTo(ax + r, ay - r + abw); // TR
    dCtx.moveTo(ax - r, ay + r - abw); dCtx.lineTo(ax - r, ay + r); dCtx.lineTo(ax - r + abw, ay + r); // BL
    dCtx.moveTo(ax + r - abw, ay + r); dCtx.lineTo(ax + r, ay + r); dCtx.lineTo(ax + r, ay + r - abw); // BR
    dCtx.stroke();
    dCtx.lineWidth = clw;
    dCtx.beginPath();
    dCtx.moveTo(ax - ca, ay); dCtx.lineTo(ax + ca, ay);
    dCtx.moveTo(ax, ay - ca); dCtx.lineTo(ax, ay + ca);
    dCtx.stroke();
    dCtx.restore();
  }

  // --- スマホ枠オーバーレイ ---
  if (!maskHidden && !visHidden[1] && S.mask.shape === 'phone') {
    const speed = parseFloat(elBorderAnimSpeed.value) * 0.1;
    const phase = (performance.now() * 0.001 * speed) % 1;
    _drawPhoneFrame(dCtx, m, bufScale, 1.0, phase);
  }
}

let _fpsLastTime = 0;
// FPS �X�i�b�v�l (�C���f�b�N�X 0=OFF, 1��=��fps)
const _FPS_SNAPS = [0, 18, 23.976, 24, 29.97, 30, 48, 59.94, 60, 120];

function render(now) {
  // filterFps: 0=�����Ȃ��A�����ȊO=fps�����ŊԈ���
  const fpsLimit = parseFloat(elFilterFps.value) || 0;
  if (fpsLimit > 0) {
    const interval = 1000 / fpsLimit;
    if (now - _fpsLastTime < interval - 0.5) {
      requestAnimationFrame(render);
      return;
    }
    displayCtx.globalAlpha = 0.35;
    displayCtx.drawImage(_mblurCvs, 0, 0);
    displayCtx.globalAlpha = 1;
    _fpsLastTime = now;
  }
  _renderFrame();
  GFRainEngine.tick(); // �J�����C�����[�v�ɓ����ifilterFps �ɒǏ]�j
  updateProgress();
  syncMaskDropOverlay();
  _updateCanvasHints();
  if (fpsLimit > 0) {
    _mblurCtx.clearRect(0, 0, _mblurCvs.width, _mblurCvs.height);
    _mblurCtx.drawImage(renderCvs, 0, 0);
  }
  // 全体ぼかし: CSS filterではなくcanvas描画時に適用
  // → _drawOverlays() で後から描く枠・ハンドルは blur の影響を受けない
  const gb = effectsHidden ? 0 : parseFloat(elFilterBlur.value);
  if (gb > 0) {
    svgGblurEl.setAttribute('stdDeviation', gb);
    displayCtx.filter = 'url(#gblur)';
    displayCtx.drawImage(renderCvs, 0, 0);
    displayCtx.filter = 'none';
  } else {
    displayCtx.drawImage(renderCvs, 0, 0);
  }
  _drawOverlays(displayCtx);
  requestAnimationFrame(render);
}

function _startRenderLoop() {
  if (_renderIntervalId) { clearInterval(_renderIntervalId); _renderIntervalId = null; }
  requestAnimationFrame(render);
}

const elHintBg = document.getElementById('hintBg');
const elHintFg = document.getElementById('hintFg');
let _hintStatePrev = '';
function _updateCanvasHints() {
  const anyLoaded = loaded[0] || loaded[1];
  const showBg = !anyLoaded && !visHidden[0];
  const showFg = !anyLoaded && !visHidden[1];
  const state = `${showBg}|${showFg}`;
  if (state === _hintStatePrev) return; // �ω��Ȃ����� DOM ���삵�Ȃ�
  _hintStatePrev = state;
  elHintBg.textContent = showBg ? t('hint-bg') : '';
  elHintFg.textContent = showFg ? t('hint-fg') : '';
  elHintBg.classList.toggle('visible', showBg);
  elHintFg.classList.toggle('visible', showFg);
}

function buildMaskPath(c, m) {
  c.beginPath();
  if (m.shape === 'rect') {
    c.rect(m.x, m.y, m.w, m.h);
  } else if (m.shape === 'phone') {
    const br = Math.round(Math.min(m.w, m.h) * 0.11);
    if (typeof c.roundRect === 'function') { c.roundRect(m.x, m.y, m.w, m.h, br); }
    else { c.rect(m.x, m.y, m.w, m.h); }
  } else if (m.shape === 'circle') {
    c.ellipse(m.x + m.w / 2, m.y + m.h / 2, m.w / 2, m.h / 2, 0, 0, Math.PI * 2);
  } else if (m.shape === 'heart') {
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    const sx = m.w / 2, sy = m.h / 2;
    // f(t) = 13cos(t)-5cos(2t)-2cos(3t)-cos(4t) �̎��ۂ͈̔�:
    //   yMin = -17 (t=��, �����[), yMax ? 12.0 (���o���v)
    const Y_MAX = 12.0, Y_MIN = -17.0;
    const Y_RANGE = Y_MAX - Y_MIN; // 29.0
    const Y_MID   = Y_MAX + Y_MIN; // -5.0
    const N = 512;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const hx = cx + sx * Math.sin(t) ** 3;
      const f  = 13*Math.cos(t) - 5*Math.cos(2*t) - 2*Math.cos(3*t) - Math.cos(4*t);
      const hy = cy - sy * (2*f - Y_MID) / Y_RANGE;
      i === 0 ? c.moveTo(hx, hy) : c.lineTo(hx, hy);
    }
    c.closePath();
  }
}

let _shutterMorphT = 0;    // ���[�t���� (0=��, 1=�p�ێl�p)
let _shutterMorphLast = 0; // �O���� nowMs
let _phoneShowRoT  = false; // �O�����O���b�h�\��
let _phoneShowRec  = true;  // REC�C���W�P�[�^�[�{�^�C���R�[�h�\��
let _phoneShowDot  = true;  // �p���`�z�[���J�����\��
let _phoneLandscape = false; // ���������[�h
let _glassSamplerCvs  = null; // �w�i�T���v�����O�L���b�V���i�V���b�^�[�j
let _glassSamplerCtx  = null;

function _drawPhoneFrame(ctx, m, bufScale, opacity, phase) {
  if (typeof ctx.roundRect !== 'function') return;
  const s = bufScale;

  const _bc     = elBorderColor.value;
  const _br     = parseInt(_bc.slice(1, 3), 16);
  const _bg     = parseInt(_bc.slice(3, 5), 16);
  const _bb     = parseInt(_bc.slice(5, 7), 16);

  const IP17_W = 9, IP17_H = 19.5;
  const _land = _phoneLandscape;
  const ratW = _land ? IP17_H : IP17_W;
  const ratH = _land ? IP17_W : IP17_H;
  let scrW = m.w, scrH = m.h;
  if (m.w / m.h > ratW / ratH) {
    scrW = Math.round(m.h * (ratW / ratH));
  } else {
    scrH = Math.round(m.w * (ratH / ratW));
  }
  const scrX = m.x + Math.round((m.w - scrW) / 2);
  const scrY = m.y + Math.round((m.h - scrH) / 2);

  const mShort = _land ? Math.round(scrH * 0.040) : Math.round(scrW * 0.040); // �Z�ӑ��}�[�W��
  const mLong1 = _land ? Math.round(scrW * 0.048) : Math.round(scrH * 0.048); // ���ӁE�擪��
  const mLong2 = _land ? Math.round(scrW * 0.038) : Math.round(scrH * 0.038); // ���ӁE������
  const bx = _land ? scrX - mLong1 : scrX - mShort;
  const by = _land ? scrY - mShort  : scrY - mLong1;
  const bw = _land ? scrW + mLong1 + mLong2 : scrW + mShort * 2;
  const bh = _land ? scrH + mShort * 2       : scrH + mLong1 + mLong2;
  const bodyR = Math.round(Math.min(bw, bh) * 0.12);

  const sw   = Math.max(1.5, 2.5 * s);
  const btnW = Math.max(3, Math.round(4 * s));
  const btnR = Math.round(2 * s);

  const _anim   = elBorderAnim.value;
  const _bright = parseInt(elBorderAnimBright.value, 10);
  const _animOn = _anim !== 'none';
  const _grad   = _animOn ? _buildBorderGrad(ctx, { x: bx, y: by, w: bw, h: bh }, phase, _anim, _bright) : null;
  const _dotA  = 0.85;
  const _btnA  = 0.70;
  const _homeA = 0.45;
  const colDot  = _animOn ? _grad : `rgba(${_br},${_bg},${_bb},${_dotA})`;
  const colBtn  = _animOn ? _grad : `rgba(${_br},${_bg},${_bb},${_btnA})`;
  const colHome = _animOn ? _grad : `rgba(${_br},${_bg},${_bb},${_homeA})`;

  ctx.save();
  ctx.globalAlpha = opacity;

  // ---- �{�̃A�E�g���C���i�I���F / �A�j���Ή��j----
  {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur  = 4 * s;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bodyR);
    ctx.strokeStyle = _animOn ? _grad : _bc;
    ctx.lineWidth = sw;
    ctx.stroke();
    ctx.restore();
  }

  // ---- �p���`�z�[���J���� ----
  if (_phoneShowDot) {
    const dotR = Math.max(2, Math.round(2.5 * s));
    ctx.save();
    if (_animOn) ctx.globalAlpha = opacity * _dotA;
    ctx.beginPath();
    const dotX = _land ? scrX + mLong1 * 0.44 : scrX + scrW / 2;
    const dotY = _land ? scrY + scrH / 2        : scrY + mLong1 * 0.44;
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = colDot;
    ctx.fill();
    ctx.restore();
  }

  // ---- �T�C�h�{�^�� ----
  ctx.save();
  if (_animOn) ctx.globalAlpha = opacity * _btnA;
  ctx.fillStyle = colBtn;
  if (!_land) {
    [[0.22, 0.055], [0.35, 0.085], [0.46, 0.085]].forEach(([yf, hf]) => {
      ctx.beginPath();
      ctx.roundRect(bx - btnW, by + bh * yf, btnW, bh * hf, btnR);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.roundRect(bx + bw, by + bh * 0.37, btnW, bh * 0.13, btnR);
    ctx.fill();
  } else {
    [[0.22, 0.055], [0.35, 0.085], [0.46, 0.085]].forEach(([xf, wf]) => {
      ctx.beginPath();
      ctx.roundRect(bx + bw * xf, by + bh, bw * wf, btnW, btnR);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.roundRect(bx + bw * 0.37, by - btnW, bw * 0.13, btnW, btnR);
    ctx.fill();
  }
  ctx.restore();

  // ---- �z�[���C���W�P�[�^�[ ----
  ctx.save();
  if (_animOn) ctx.globalAlpha = opacity * _homeA;
  if (!_land) {
    const hiW = scrW * 0.26, hiH = Math.max(2.5, Math.round(3 * s));
    ctx.beginPath();
    ctx.roundRect(scrX + (scrW - hiW) / 2, scrY + scrH + (mLong2 - hiH) / 2, hiW, hiH, hiH / 2);
    ctx.fillStyle = colHome;
    ctx.fill();
  } else {
    const hiH = scrH * 0.26, hiW = Math.max(2.5, Math.round(3 * s));
    ctx.beginPath();
    ctx.roundRect(scrX + scrW + (mLong2 - hiW) / 2, scrY + (scrH - hiH) / 2, hiW, hiH, hiW / 2);
    ctx.fillStyle = colHome;
    ctx.fill();
  }
  ctx.restore();

  // ---- �O�����O���b�h�iRule of Thirds�j----
  if (_phoneShowRoT) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(scrX, scrY, scrW, scrH, Math.round(Math.min(scrW, scrH) * 0.11));
    ctx.clip();
    ctx.globalAlpha = opacity * 0.55;
    ctx.strokeStyle = _animOn ? _grad : `rgba(${_br},${_bg},${_bb},0.75)`;
    ctx.lineWidth   = Math.max(0.5, 0.7 * s);
    const r3W = scrW / 3, r3H = scrH / 3;
    ctx.beginPath();
    ctx.moveTo(scrX + r3W,     scrY);       ctx.lineTo(scrX + r3W,     scrY + scrH);
    ctx.moveTo(scrX + r3W * 2, scrY);       ctx.lineTo(scrX + r3W * 2, scrY + scrH);
    ctx.moveTo(scrX,           scrY + r3H); ctx.lineTo(scrX + scrW,    scrY + r3H);
    ctx.moveTo(scrX,     scrY + r3H * 2);   ctx.lineTo(scrX + scrW,    scrY + r3H * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---- ���[�t�^�C�}�[�X�V�i�J����UI�E�V���b�^�[�EREC�ŋ��p�j----
  const nowMs = performance.now();
  const dtMs  = Math.min(50, _shutterMorphLast > 0 ? nowMs - _shutterMorphLast : 16);
  _shutterMorphLast = nowMs;
  _shutterMorphT += ((S.playing ? 1 : 0) - _shutterMorphT) * Math.min(1, (dtMs / 1000) * 7.0);
  const mt = _shutterMorphT;

  // ---- �V���b�^�[�{�^�� ----
  const sbCx = _land ? scrX + scrW * 0.855 : scrX + scrW / 2;
  const sbCy = _land ? scrY + scrH / 2      : scrY + scrH * 0.855;
  const sbR  = Math.max(8, Math.round((_land ? scrH : scrW) * 0.080));
  const sqSide  = Math.round(sbR * 1.15);
  const sqR_end = Math.max(2, Math.round(sqSide * 0.24));

  const glassR = sbR + Math.max(4, Math.round(4 * s));

  // ---- �w�i����: �K�E�X�u���[�����K���X ----
  // getImageData(desynchronized canvas)��GPU Stall�����惉�O�̌����B
  // drawImage�� GPU�ԃR�s�[�̂ݎg�p�����B
  if (_phoneShowRec) {
    const gx = Math.floor(sbCx - glassR);
    const gy = Math.floor(sbCy - glassR);
    const gd = Math.ceil(glassR * 2);
    const cW = ctx.canvas.width, cH = ctx.canvas.height;
    const safeGx = Math.max(0, gx);
    const safeGy = Math.max(0, gy);
    const safeW  = Math.min(gd - (safeGx - gx), cW - safeGx);
    const safeH  = Math.min(gd - (safeGy - gy), cH - safeGy);
    if (safeW > 4 && safeH > 4) {
      try {
        if (!_glassSamplerCvs || _glassSamplerCvs.width !== safeW || _glassSamplerCvs.height !== safeH) {
          _glassSamplerCvs = document.createElement('canvas');
          _glassSamplerCvs.width  = safeW;
          _glassSamplerCvs.height = safeH;
          _glassSamplerCtx = _glassSamplerCvs.getContext('2d');
        }
        _glassSamplerCtx.drawImage(ctx.canvas, safeGx, safeGy, safeW, safeH, 0, 0, safeW, safeH);
        ctx.save();
        ctx.beginPath();
        ctx.arc(sbCx, sbCy, glassR, 0, Math.PI * 2);
        ctx.clip();
        const blurPx = Math.max(4, Math.round(glassR * 0.45));
        ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(_glassSamplerCvs, safeGx, safeGy);
        ctx.filter = 'none';
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fill();
        ctx.restore();
      } catch(e) {}
    }
  }

  // ---- �^���C���W�P�[�^�[�i�Ԋہ��Ԏl�p���[�t�j�{�^�C���R�[�h ----
  const pulse = 0.60 + 0.40 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
  if (_phoneShowRec) {
    const iSide = sbR * 2 * (1 - mt) + sqSide * mt;
    const iCorR = sbR * (1 - mt) + sqR_end * mt;
    ctx.save();
    ctx.globalAlpha = opacity * pulse;
    ctx.fillStyle   = 'rgba(235,110,110,0.80)';
    ctx.beginPath();
    ctx.roundRect(sbCx - iSide / 2, sbCy - iSide / 2, iSide, iSide, iCorR);
    ctx.fill();
    ctx.restore();

    // ---- �^�C���R�[�h�\���imt > 0 �̂Ƃ������R�[�h�l�p���Ɠ������Amt �Ńt�F�[�h�C���j----
    if (mt > 0.001) {
    const dur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration > 0)
      ? vid[0].duration
      : (loaded[1] && mediaType[1] === 'video' && vid[1].duration > 0 ? vid[1].duration : 0);
    if (dur > 0) {
      const fmt = (t) => {
        const ss = Math.floor(t % 60);
        const mm = Math.floor(t / 60) % 60;
        const hh = Math.floor(t / 3600);
        return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
      };
      const timeStr = fmt(_compositeT);
      const fs      = Math.max(11, Math.round((_land ? scrH : scrW) * 0.052));
      const padH    = Math.round(fs * 0.20);
      const padW    = Math.round(fs * 0.50);
      const boxR    = Math.max(3, Math.round(fs * 0.28));

      ctx.save();
      ctx.font = `${fs}px Consolas, "Courier New", monospace`;
      const metrics = ctx.measureText(timeStr);
      const tw   = metrics.width;
      const textAsc  = metrics.actualBoundingBoxAscent  ?? fs * 0.75;
      const textDesc = metrics.actualBoundingBoxDescent ?? fs * 0.20;
      const textH = textAsc + textDesc;
      const boxW = tw + padW * 2;
      const boxH = textH + padH * 2;
      const tX   = scrX + Math.round((scrW - boxW) / 2);
      const tY   = scrY + Math.round(scrH * 0.045);
      const cX   = tX + boxW / 2;
      const cY   = tY + boxH / 2;

      const tsScale = 0.80 + 0.20 * mt;
      ctx.translate(cX, cY);
      ctx.scale(tsScale, tsScale);
      ctx.translate(-cX, -cY);

      ctx.globalAlpha = opacity * pulse * mt;
      ctx.beginPath();
      ctx.roundRect(tX, tY, boxW, boxH, boxR);
      ctx.fillStyle = 'rgba(235,110,110,0.80)';
      ctx.fill();

      ctx.globalAlpha = opacity * pulse * mt;
      ctx.fillStyle   = 'rgba(255,255,255,0.97)';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(timeStr, cX, tY + padH + textAsc);
      ctx.restore();
    } // end dur > 0
    } // end mt > 0.001
  } // end _phoneShowRec

  ctx.restore();
}

_startRenderLoop();

// ============================================================
// ============================================================

// proxy.js (yt-dlp) ���g���� Iwara �y�[�WURL �� CDN URL ������
const _MY_PROXY = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:8788'
  : 'https://gf-proxy.mydn.workers.dev';

async function resolveIwaraURL(pageUrl) {
  const base = _MY_PROXY;
  const r = await fetch(`${base}/resolve?url=${encodeURIComponent(pageUrl)}`, {
    signal: AbortSignal.timeout(35000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = data.error || '';
    const msg = code.startsWith('err-')
      ? t(code).replace('{site}', data.site || code)
      : (code || `HTTP ${r.status}`);
    throw new Error(msg);
  }
  return { url: data.url, name: data.title, author: data.author || '' };
}

async function loadVideoFromURL(index, url) {
  if (!url) return;
  const input    = document.getElementById(`urlInput${index}`);
  const btn      = document.getElementById(`urlLoadBtn${index}`);
  const zone = document.getElementById(`drop${index}`);
  const canvasOverlay = document.getElementById('canvasLoadOverlay');
  const canvasMsg     = document.getElementById('canvasLoadMsg');
  const setStatus = (msg) => {
    if (msg) {
      if (canvasOverlay) { canvasOverlay.style.display = 'flex'; }
      if (canvasMsg) canvasMsg.textContent = msg;
    } else {
      if (canvasOverlay) canvasOverlay.style.display = 'none';
      if (canvasMsg) canvasMsg.textContent = '';
    }
  };
  btn.classList.add('loading');
  btn.innerHTML = `<span class="url-spinner"></span>`;
  btn.disabled = true;
  let _pendingLoad = false;
  const _restoreBtn = () => { btn.classList.remove('loading'); btn.textContent = t('load-btn'); btn.disabled = false; };
  try {
    const errEl = document.getElementById(`urlErr${index}`);
    if (errEl) errEl.textContent = '';
    input.style.borderColor = '';

    if (!/^https?:\/\//i.test(url)) {
      throw new Error(t('err-invalid-url'));
    }
    zone.classList.add('loading');
    _setDropSpinner(index, true);

    const IMAGE_URL_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?.*)?$/i;
    if (IMAGE_URL_RE.test(url) || /^data:image\//i.test(url)) {
      const name = url.split('/').pop().split('?')[0] || 'image';
      setStatus('�摜���ǂݍ��ݒ�...');
      await new Promise((resolve, reject) => {
        if (img[index].src?.startsWith('blob:')) URL.revokeObjectURL(img[index].src);
        img[index].removeAttribute('src'); // ��URL�̍ă��[�h�ł� onload ���m���ɔ��΂�����
        _currentHandle[index]  = null;
        _loadedFileName[index] = name;
        // pximg.net �̒���������Pixiv�y�[�WURL�𐶐�
        const _pximgId = /pximg\.net\//.test(url) && (url.match(/\/(\d+)_p\d+/) || [])[1];
        _loadedPageUrl[index]  = _pximgId ? `https://www.pixiv.net/artworks/${_pximgId}` : url;
        _loadedSrcUrl[index]   = url;
        loaded[index] = false;
        mediaType[index] = 'image';
        updateMediaControls(index);
        img[index].onload = () => {
          loaded[index] = true;
          zone.classList.remove('loading');
          _setDropSpinner(index, false);
          if (index === 0) setCanvasAspectRatio(img[0].naturalWidth, img[0].naturalHeight);
          if (index === 1 && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
          if (index === 1 && _fgFadeStart === 0) _fgFadeStart = performance.now();
          _setZoneLoaded(zone, false);
          _setZoneLoaded(zone, true);
          _updateDropLink(index);
          const label = zone.querySelector(`.drop-label${index}`);
          if (label) label.textContent = name;
          input.style.borderColor = 'var(--ok)';
          setTimeout(() => {
            input.style.transition = 'border-color 0.6s ease';
            input.style.borderColor = '';
          }, 1800);
          resolve();
        };
        const _imgFail = () => {
          zone.classList.remove('loading');
          _setDropSpinner(index, false);
          if (errEl) errEl.textContent = t('url-cors-err');
          input.style.borderColor = 'red';
          reject(new Error(t('url-cors-err')));
        };
        img[index].onerror = () => {
          // CORS���s �� �v���L�V�o�R�ōĎ��s
          const proxyUrl = `${_MY_PROXY}/?url=${encodeURIComponent(url)}`;
          img[index].crossOrigin = 'anonymous';
          img[index].onerror = _imgFail;
          img[index].src = proxyUrl;
        };
        const PROXY_FIRST_HOSTS = ['i.pximg.net', 'i-f.pximg.net'];
        const _needsProxy = PROXY_FIRST_HOSTS.some(h => url.includes(h));
        if (_needsProxy) {
          img[index].crossOrigin = 'anonymous';
          img[index].onerror = _imgFail;
          img[index].src = `${_MY_PROXY}/?url=${encodeURIComponent(url)}`;
        } else {
          img[index].crossOrigin = 'anonymous';
          img[index].src = url;
        }
      });
      setStatus('');
      return;
    }

    let resolvedUrl = url;
    let name = url.split('/').pop().split('?')[0] || url;
    if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
      throw new Error(t('err-unsupported-site').replace('{site}', 'YouTube'));
    }
    if (/iwara\.(tv|ai)\/video\//i.test(url)) {
      setStatus(t('api-checking'));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const result = await resolveIwaraURL(url);
      if (!result) throw new Error(t('url-resolve-fail'));
      setStatus('CDN URL���擾��...');
      resolvedUrl = result.url;
      const author = result.author || '';
      name = result.name || result.title || name;
      if (author) name = `${author} - ${name}`;
    }
    _currentHandle[index]  = null;
    _loadedFileName[index] = name;
    _loadedPageUrl[index]  = url;
    _loadedSrcUrl[index]   = url;
    _updateDropLink(index);
    mediaType[index] = 'video';
    updateMediaControls(index);
    setStatus(t('vid-loading'));
    zone.classList.remove('loaded');
    _pendingLoad = true;
    _stopBitmapCapture(index);
    loaded[index] = false;
    // crossOrigin='anonymous' ���ݒ肵�ăv���L�V�o�R�œǂݍ���
    vid[index].crossOrigin = 'anonymous';
    vid[index].src = `${_MY_PROXY}/?url=${encodeURIComponent(resolvedUrl)}`;
    vid[index].load();
    vid[index].onloadedmetadata = () => {
      setStatus('');
      loaded[index] = true;
      _stopBitmapCapture(index);
      _startBitmapCapture(index);
      zone.classList.remove('loading');
      _setDropSpinner(index, false);
      _restoreBtn();
      if (index === 1 && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
      if (index === 1 && _fgFadeStart === 0) _fgFadeStart = performance.now();
      vid[index].volume = (parseFloat(document.getElementById(`vol${index}`).value) / 100) ** 2;
      if (index === 0) setCanvasAspectRatio(vid[0].videoWidth, vid[0].videoHeight);
      _setZoneLoaded(zone, false);
      _setZoneLoaded(zone, true);
      const label = zone.querySelector(`.drop-label${index}`);
      if (label) label.textContent = name;
      input.style.transition = 'border-color 0.1s';
      input.style.borderColor = 'var(--ok)';
      setTimeout(() => {
        input.style.transition = 'border-color 0.6s ease';
        input.style.borderColor = '';
      }, 1800);
    };
    vid[index].onerror = () => {
      setStatus('');
      zone.classList.remove('loading');
      _setDropSpinner(index, false);
      _restoreBtn();
      input.style.borderColor = 'red';
      const errEl = document.getElementById(`urlErr${index}`);
      if (errEl) errEl.textContent = t('url-cors-err');
    };
    input.style.borderColor = '';
  } catch (e) {
    setStatus('');
    zone.classList.remove('loading');
    _setDropSpinner(index, false);
    input.style.borderColor = 'red';
    const errEl = document.getElementById(`urlErr${index}`);
    if (errEl) errEl.textContent = e.message;
  } finally {
    if (!_pendingLoad) _restoreBtn();
  }
}

[0, 1].forEach(n => {
  const btn   = document.getElementById(`urlLoadBtn${n}`);
  const input = document.getElementById(`urlInput${n}`);
  btn.addEventListener('click', () => loadVideoFromURL(n, input.value.trim()));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') loadVideoFromURL(n, input.value.trim()); });
});

function loadVideo(index, file, handle = null) {
  if (img[index].src?.startsWith('blob:')) { URL.revokeObjectURL(img[index].src); img[index].removeAttribute('src'); }
  mediaType[index] = 'video';
  updateMediaControls(index);
  _currentHandle[index]  = handle;
  _loadedFileName[index] = file.name;
  _loadedPageUrl[index]  = '';
  _loadedSrcUrl[index]   = '';
  _updateDropLink(index);
  const _vi = document.getElementById(`urlInput${index}`);
  const _ve = document.getElementById(`urlErr${index}`);
  if (_vi) { _vi.value = ''; _vi.style.borderColor = ''; }
  if (_ve)   _ve.textContent = '';
  const zone = document.getElementById(`drop${index}`);
  zone.classList.remove('loaded');
  zone.classList.add('loading');
  _setDropSpinner(index, true);
  const url = URL.createObjectURL(file);
  _stopBitmapCapture(index);
  loaded[index] = false;
  vid[index].removeAttribute('crossorigin');
  vid[index].src = url;
  vid[index].load();
  vid[index].onloadedmetadata = () => {
    loaded[index] = true;
    _stopBitmapCapture(index);
    _startBitmapCapture(index);
    zone.classList.remove('loading');
    _setDropSpinner(index, false);
    if (index === 0 && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
    if (index === 1 && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
    if (index === 1 && _fgFadeStart === 0) _fgFadeStart = performance.now();
    _hintStatePrev = ''; // �q���g���Ԃ������ĕ]��
    vid[index].volume = (parseFloat(document.getElementById(`vol${index}`).value) / 100) ** 2;
    // index 0�i�w�i�j�����[�h���ꂽ���A�X�y�N�g�����X�V
    if (index === 0) {
      setCanvasAspectRatio(vid[0].videoWidth, vid[0].videoHeight);
    }
    _setZoneLoaded(zone, false);
    _setZoneLoaded(zone, true);
    const label = zone.querySelector(`.drop-label${index}`);
    if (label) label.textContent = file.name;
  };
  vid[index].onerror = () => { zone.classList.remove('loading'); _setDropSpinner(index, false); };
}

function loadImage(index, file, handle = null) {
  vid[index].pause();
  _stopBitmapCapture(index);
  if (vid[index].src) { URL.revokeObjectURL(vid[index].src); vid[index].removeAttribute('src'); vid[index].load(); }
  if (img[index].src?.startsWith('blob:')) URL.revokeObjectURL(img[index].src);
  loaded[index] = false;
  mediaType[index] = 'image';
  _currentHandle[index]  = handle;
  _loadedFileName[index] = file.name;
  _loadedPageUrl[index]  = '';
  _loadedSrcUrl[index]   = '';
  _updateDropLink(index);
  updateMediaControls(index);
  const zone = document.getElementById(`drop${index}`);
  zone.classList.remove('loaded');
  zone.classList.add('loading');
  _setDropSpinner(index, true);
  const url = URL.createObjectURL(file);
  img[index].onload = () => {
    loaded[index] = true;
    // mediaType[index] = 'image' �̓��[�h�J�n���ɐݒ��ς�
    zone.classList.remove('loading');
    _setDropSpinner(index, false);
    if (index === 0) { setCanvasAspectRatio(img[0].naturalWidth, img[0].naturalHeight); if (_maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now(); }
    if (index === 1 && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
    if (index === 1 && _fgFadeStart === 0) _fgFadeStart = performance.now();
    _hintStatePrev = ''; // �q���g���Ԃ������ĕ]��
    _setZoneLoaded(zone, false);
    _setZoneLoaded(zone, true);
    const label = zone.querySelector(`.drop-label${index}`);
    if (label) label.textContent = file.name;
  };
  img[index].onerror = () => { zone.classList.remove('loading'); _setDropSpinner(index, false); };
  img[index].src = url;
}

function updateMediaControls(index) {
  const ctrl = document.getElementById(`videoControls${index}`);
  if (ctrl) ctrl.style.display = mediaType[index] === 'image' ? 'none' : '';
}

function _setDropSpinner(index, on) {
  const overlay = document.querySelector(`#drop${index} .drop-loading-overlay`);
  if (!overlay) return;
  overlay.style.display = on ? 'flex' : 'none';
}

function _updateDropLink(index) {
  const link = document.getElementById(`dropLink${index}`);
  const zone = document.getElementById(`drop${index}`);
  const url  = _loadedPageUrl && _loadedPageUrl[index];
  if (!link) return;
  if (url) {
    link.href = url;
    link.classList.add('has-url');
    zone && zone.classList.add('has-link');
  } else {
    link.removeAttribute('href');
    link.classList.remove('has-url');
    zone && zone.classList.remove('has-link');
  }
}

async function loadVideoFromHandle(index, handle) {
  try {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return false;
    const file = await handle.getFile();
    if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) loadImage(index, file, handle);
    else loadVideo(index, file, handle);
    return true;
  } catch (e) { return false; }
}

function setupDropZone(index) {
  const zone    = document.getElementById(`drop${index}`);
  const section = zone.closest('.vid-section'); // �J�[�h�S��
  const input   = document.getElementById(`file${index}`);

  async function pickFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [
            { description: '�����t�@�C��', accept: { 'video/*': ['.mp4', '.webm', '.mov', '.mkv'] } },
            { description: '�摜�t�@�C��', accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'] } },
          ],
          multiple: false,
        });
        const file = await handle.getFile();
        if (file.type.startsWith('image/')) loadImage(index, file, handle);
        else loadVideo(index, file, handle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    input.click();
  }

  zone.addEventListener('click', e => {
    if (e.target.closest(`#dropLink${index}`)) return; // ���y�[�W�����N�̓o�u�����O����
    pickFile();
  });
  // dropLink�̃N���b�N�̓]�[���ɓ`�d�����Ȃ�
  document.getElementById(`dropLink${index}`)?.addEventListener('click', e => e.stopPropagation());
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); }
  });
  input.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) loadImage(index, f);
    else loadVideo(index, f);
  });

  // ---- D&D: vid-section �J�[�h�S�� ----
  // section ���x���œ����Bzone �̃C�x���g�̓o�u�����O������ section �ɏW�񂷂��B
  // zone.drop �̂� stopPropagation ���ێ��isection.drop �Ƃ̓��d�����h�~�j�B

  const _isMediaDrag = e => {
    if (!e.dataTransfer?.items) return false;
    return [...e.dataTransfer.items].some(item =>
      item.kind === 'file' && (item.type.startsWith('video/') || item.type.startsWith('image/'))
    );
  };

  let _dragCount = 0;
  zone.addEventListener('dragenter', e => {
    if (!_isMediaDrag(e)) return;
    _dragCount++;
    zone.classList.add('drag-over');
    // stopPropagation ���Ȃ� �� section.dragenter �Ƀo�u�����O������
  });
  zone.addEventListener('dragover', e => {
    if (!_isMediaDrag(e)) return;
    // stopPropagation ���Ȃ� �� section.dragover �Ƀo�u�����O������
  });
  zone.addEventListener('dragleave', e => {
    if (_dragCount > 0) {
      _dragCount--;
      if (_dragCount <= 0) { _dragCount = 0; zone.classList.remove('drag-over'); }
    }
    // stopPropagation ���Ȃ� �� section.dragleave �Ƀo�u�����O������
  });
  zone.addEventListener('drop', async e => {
    if (!_isMediaDrag(e)) return; // JSON�͖����isection.drop �ɂ��o�u�����O���Ȃ� �� OK�j
    e.preventDefault();
    e.stopPropagation(); // section.drop �Ƃ̓��d�������h��
    _dragCount = 0;
    zone.classList.remove('drag-over');
    const item = e.dataTransfer.items?.[0];
    const f = e.dataTransfer.files[0]; // await�����O�ɓ����擾
    let handle = null;
    if (item?.getAsFileSystemHandle) {
      handle = await item.getAsFileSystemHandle().catch(() => null);
    }
    if (f && f.type.startsWith('image/')) loadImage(index, f, handle);
    else if (f && f.type.startsWith('video/')) loadVideo(index, f, handle);
  });

  if (section) {
    section.addEventListener('dragenter', e => {
      if (!_isMediaDrag(e)) return;
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    section.addEventListener('dragover', e => {
      if (!_isMediaDrag(e)) return;
      e.preventDefault(); // �����E�摜�̂݃h���b�v������
    });
    section.addEventListener('dragleave', e => {
      if (!section.contains(e.relatedTarget)) {
        _dragCount = 0;
        zone.classList.remove('drag-over');
      }
    });
    section.addEventListener('drop', async e => {
      if (!_isMediaDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      // zone.drop �� stopPropagation �ς݂̂��߂����ɂ� zone ���̃h���b�v�͗��Ȃ�
      zone.classList.remove('drag-over');
      const item = e.dataTransfer.items?.[0];
      const f = e.dataTransfer.files[0];
      let handle = null;
      if (item?.getAsFileSystemHandle) {
        handle = await item.getAsFileSystemHandle().catch(() => null);
      }
      if (f && f.type.startsWith('image/')) loadImage(index, f, handle);
      else if (f && f.type.startsWith('video/')) loadVideo(index, f, handle);
    });
  }
}

[0, 1].forEach(setupDropZone);

// ============================================================
// ============================================================
[0, 1].forEach(i => {
  document.getElementById(`resetBtn${i}`).addEventListener('click', () => {
    const resetSlider = id => {
      const el = document.getElementById(id);
      el.value = el.defaultValue;
      el.dispatchEvent(new Event('input'));
    };
    resetSlider(`vol${i}`);
    resetSlider(`offset${i}`);
    clearVideo(i);
  });
});

// ============================================================
// ============================================================
const _vidHiddenOverlay = document.getElementById('vidHiddenOverlay');
function _syncVidHiddenOverlay() {
  const all = visHidden[0] && visHidden[1];
  _vidHiddenOverlay.style.display = all ? 'flex' : 'none';
}

[0, 1].forEach(i => {
  const btn = document.getElementById(`visBtn${i}`);
  btn.addEventListener('click', () => {
    visHidden[i] = !visHidden[i];
    btn.innerHTML = visHidden[i]
      ? '<i data-lucide="eye-off"></i>'
      : '<i data-lucide="eye"></i>';
    lucide.createIcons({ nodes: [btn] });
    const muteBtn = document.getElementById(`mute${i}`);
    if (visHidden[i] && !vid[i].muted) {
      muteBtn.click();
    } else if (!visHidden[i] && vid[i].muted) {
      muteBtn.click();
    }
    const allHidden = visHidden[0] && visHidden[1];
    const allBtn = document.getElementById('vidVisAllBtn');
    allBtn.innerHTML = allHidden ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
    lucide.createIcons({ nodes: [allBtn] });
    _syncVidHiddenOverlay();
  });
});

document.getElementById('vidVisAllBtn').addEventListener('click', () => {
  const allHidden = visHidden[0] && visHidden[1];
  const next = !allHidden;
  [0, 1].forEach(i => {
    if (visHidden[i] !== next) {
      visHidden[i] = next;
      const btn = document.getElementById(`visBtn${i}`);
      btn.innerHTML = next ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
      lucide.createIcons({ nodes: [btn] });
      const muteBtn = document.getElementById(`mute${i}`);
      if (next && !vid[i].muted) {
        muteBtn.click();
      } else if (!next && vid[i].muted) {
        muteBtn.click();
      }
    }
  });
  const allBtn = document.getElementById('vidVisAllBtn');
  allBtn.innerHTML = next ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
  lucide.createIcons({ nodes: [allBtn] });
  _syncVidHiddenOverlay();
});

document.getElementById('vidResetAllBtn').addEventListener('click', () => {
  [0, 1].forEach(i => document.getElementById(`resetBtn${i}`).click());
});

// ============================================================
// ============================================================
const DEFAULT_LABELS = () => [t('drop-label'), t('drop-label')];

function clearVideo(index) {
  vid[index].pause();
  _stopBitmapCapture(index);
  if (vid[index].src) {
    URL.revokeObjectURL(vid[index].src);
    vid[index].removeAttribute('src');
    vid[index].load();
  }
  if (img[index].src?.startsWith('blob:')) { URL.revokeObjectURL(img[index].src); img[index].removeAttribute('src'); }
  mediaType[index] = 'video';
  loaded[index] = false;
  _currentHandle[index]  = null;
  _loadedFileName[index] = '';
  _loadedPageUrl[index]  = '';
  _loadedSrcUrl[index]   = '';
  _updateDropLink(index);
  const zone  = document.getElementById(`drop${index}`);
  const input = document.getElementById(`file${index}`);
  const label = zone.querySelector(`.drop-label${index}`);
  zone.classList.remove('loaded');
  zone.style.animation = '';
  if (label) label.textContent = DEFAULT_LABELS()[index];
  input.value = '';
  const urlInput = document.getElementById(`urlInput${index}`);
  const urlErr   = document.getElementById(`urlErr${index}`);
  if (urlInput) { urlInput.value = ''; urlInput.style.borderColor = ''; }
  if (urlErr)   urlErr.textContent = '';
  updateMediaControls(index);
}
[0, 1].forEach(i => {
  document.getElementById(`del${i}`).addEventListener('click', e => {
    e.stopPropagation();
    clearVideo(i);
  });
});

// Canvas-wide drop: 1�t�@�C�� �� �w�i�A2�t�@�C�� �� �w�i�{�O�i

// syncMaskDropOverlay: �l���ω�����������DOM���X�V (���t���[�� style�������݂�������)
function syncMaskDropOverlay() {
  const cw = canvas.width, ch = canvas.height;
  const { x, y, w, h, shape } = S.mask;
  const left   = `${x / cw * 100}%`;
  const top    = `${y / ch * 100}%`;
  const width  = `${w / cw * 100}%`;
  const height = `${h / ch * 100}%`;
  const br     = shape === 'circle' ? '50%' : '4px';
  const c = _maskOverlayCache;
  if (c.left !== left)         { maskDropOverlay.style.left         = left;   c.left = left; }
  if (c.top !== top)           { maskDropOverlay.style.top          = top;    c.top = top; }
  if (c.width !== width)       { maskDropOverlay.style.width        = width;  c.width = width; }
  if (c.height !== height)     { maskDropOverlay.style.height       = height; c.height = height; }
  if (c.borderRadius !== br)   { maskDropOverlay.style.borderRadius = br;     c.borderRadius = br; }
}

// drop�t�@�C������: DataTransfer��await�O�ɓ����擾�K�{
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|ogv|ts)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|avif|bmp|tiff?)$/i;
function _loadFileByType(index, file, handle = null) {
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) loadImage(index, file, handle);
  else loadVideo(index, file, handle);
}
async function processDropFiles(e, targetIdx) {
  canvasWrap.classList.remove('canvas-drop-over');
  maskDropOverlay.classList.remove('drag-active', 'drag-over');
  const pairs = [...(e.dataTransfer.items || [])]
    .filter(it => it.kind === 'file' && (it.type.startsWith('video/') || it.type.startsWith('image/') || it.type === ''))
    .slice(0, 2)
    .map(it => ({ item: it, file: it.getAsFile() }))
    .filter(p => p.file && (p.file.type.startsWith('video/') || p.file.type.startsWith('image/') || VIDEO_EXT.test(p.file.name) || IMAGE_EXT.test(p.file.name)));
  if (pairs.length === 0) return;

  if (pairs.length === 1) {
    let handle = null;
    if (pairs[0].item?.getAsFileSystemHandle) {
      handle = await pairs[0].item.getAsFileSystemHandle().catch(() => null);
    }
    if (pairs[0].file) _loadFileByType(targetIdx, pairs[0].file, handle);
  } else {
    for (let i = 0; i < pairs.length; i++) {
      let handle = null;
      if (pairs[i].item?.getAsFileSystemHandle) {
        handle = await pairs[i].item.getAsFileSystemHandle().catch(() => null);
      }
      if (pairs[i].file) _loadFileByType(i, pairs[i].file, handle);
    }
  }
}

// canvasWrap�S��: D&D���t + maskOverlay���L����
let _isDraggingPreset = false;
// ============================================================
//           �O�������t�H���_�A�C�e���Ԃւ̑}���A�N���b�N臒l�B
// ============================================================
let _mDragSrcIdx     = null;
let _mDraggedEl      = null;   // ���v�f = ���\���̃v���[�X�z���_�[
let _mGhost          = null;   // fixed-position �̕��V�N���[��
let _mPointerOffsetY = 0;
let _mDraggedH       = 0;
let _mDragGap        = 2;
let _mActiveSiblings = [];     // ���݃X���C�h���̌Z���v�f
let _mCurContainer   = null;   // null=���[�g�A�܂��� .preset-folder DOM �v�f
let _mFolderTarget   = null;   // �����h���b�v�p�̕����t�H���_�w�b�_�[
let _mLastGhostMidY  = 0;
let _mContainerFollowers = []; // �S�[�X�g���O�������t�H���_���ɂ����Ƃ��� _mCurContainer �ȍ~�̃��[�g�v�f
let _mSrcOrigMidY    = 0;      // �h���b�O�J�n���̃h���b�O���v�f�̌� midY
let _mSrcContainerEl = null;   // �h���b�O�J�n���̃R���e�i�i_mCurContainer�j
let _mLastRefY       = 0;      // �X���C�h/�}���̊Y: �t�H���_�h���b�O���� mouseY�A�����ȊO�� ghostMidY
let _mAddFolderTarget = false; // �S�[�X�g���u�V�����t�H���_�v�{�^�����ɂ����Ƃ� true
let _mFolderHoverTimer = null; // �z�o�[�W�J�^�C�}�[
let _mPending        = null;
const _M_THRESHOLD   = 5;

function _mGetRootUnits() {
  const list = document.getElementById('presetList');
  return list ? [...list.querySelectorAll(':scope > .preset-item, :scope > .preset-folder, :scope > .preset-root-separator')] : [];
}
function _mGetFolderItems(folderEl) {
  const cont = folderEl?.querySelector('.preset-folder-children');
  return cont ? [...cont.querySelectorAll(':scope > .preset-item')] : [];
}
function _mOpenFolder(hdr) {
  if (!hdr) return;
  const children = hdr.nextElementSibling;
  if (!children || !children.classList.contains('collapsed')) return;
  children.classList.remove('collapsed');
  const icon = hdr.querySelector('.preset-folder-toggle i');
  if (icon) { icon.setAttribute('data-lucide', 'chevron-down'); lucide.createIcons(); }
  const idx = +hdr.dataset.idx;
  const list2 = loadPresets();
  if (list2[idx]) { list2[idx].open = true; savePresets(list2); }
}
// .preset-folder �v�f���Ԃ��B�S�[�X�g�����[�g���x���ɂ����ꍇ�� null�B
function _mDetectContainer(ghostMidY) {
  const folders = document.querySelectorAll('#presetList > .preset-folder');
  for (const folder of folders) {
    if (folder === _mDraggedEl) continue;
    const children = folder.querySelector('.preset-folder-children');
    if (!children || children.classList.contains('collapsed')) continue;
    const cr = children.getBoundingClientRect();
    if (cr.height === 0) continue;
    const snap = _mDraggedH > 0 ? _mDraggedH * 0.5 : 12;
    if (ghostMidY >= cr.top && ghostMidY <= cr.bottom + snap) return folder;
  }
  return null;
}
function _mInitSiblings(sibs, refY) {
  sibs.forEach(sib => {
    if (sib === _mDraggedEl) return;
    delete sib.dataset.mIsAbove;
    delete sib.dataset.mToggled;
    sib.style.transition = 'none';
    sib.style.transform  = '';
    const r = sib.getBoundingClientRect();
    let origMidY;
    if (sib.classList.contains('preset-folder')) {
      const hdr = sib.querySelector('.preset-folder-header');
      const hr  = hdr ? hdr.getBoundingClientRect() : r;
      origMidY  = hr.top + hr.height / 2;
    } else {
      origMidY = r.top + r.height / 2;
    }
    sib.dataset.mOrigMidY = origMidY;
    if (origMidY < refY) sib.dataset.mIsAbove = '';
  });
}
function _mSetActiveSiblings(sibs, ghostMidY) {
  _mActiveSiblings.forEach(sib => {
    if (sib === _mDraggedEl) return;
    sib.style.transform  = '';
    sib.style.transition = '';
    delete sib.dataset.mIsAbove;
    delete sib.dataset.mToggled;
    delete sib.dataset.mOrigMidY;
  });
  _mActiveSiblings = sibs;
  _mInitSiblings(sibs, ghostMidY);
}
function _mSwitchContainer(newContainer, ghostMidY) {
  _mContainerFollowers.forEach(el => { el.style.transform = ''; el.style.transition = ''; });
  _mContainerFollowers = [];
  _mCurContainer = newContainer;
  const refMidY = (newContainer === _mSrcContainerEl) ? _mSrcOrigMidY : ghostMidY;
  if (newContainer) {
    const rootUnits = _mGetRootUnits();
    const ci = rootUnits.indexOf(newContainer);
    if (ci >= 0) _mContainerFollowers = rootUnits.slice(ci + 1).filter(u => u !== _mDraggedEl);
    _mSetActiveSiblings(_mGetFolderItems(newContainer), refMidY);
  } else {
    const srcIsF = loadPresets()[_mDragSrcIdx]?.type === 'folder';
    const rootSibs = srcIsF
      ? _mGetRootUnits()
      : _mGetRootUnits().filter(u => !u.classList.contains('preset-folder'));
    _mSetActiveSiblings(rootSibs, refMidY);
  }
}
function _mUpdateSlide(ghostMidY) {
  if (!_mGhost) return;
  _mLastGhostMidY = ghostMidY;
  _mGhost.style.top = (ghostMidY - _mDraggedH / 2) + 'px';

  // --- �S�[�X�g�����݂ǂ̃R���e�i���ɂ��邩�����o ---
  const srcIsFolder = loadPresets()[_mDragSrcIdx]?.type === 'folder';
  // ghostMidY �̓S�[�X�g�̈ʒu�����ɂ̂ݎg���B
  const refY = ghostMidY - _mDraggedH / 2 + _mPointerOffsetY;  // = mouseY
  _mLastRefY = refY;

  // --- �t�H���_�w�b�_�[�̃z�o�[�i�S�t�H���_: �J�������́A�������́A���̂��́j---
  let newFolderTarget = null;
  if (!srcIsFolder) {
    document.querySelectorAll('#presetList > .preset-folder').forEach(folder => {
      const hdr = folder.querySelector('.preset-folder-header');
      if (!hdr || +hdr.dataset.idx === _mDragSrcIdx) return;
      const r = hdr.getBoundingClientRect();
      if (refY >= r.top && refY <= r.bottom) newFolderTarget = hdr;
    });
  }

  // --- �R���e�i���o�i�q�G���A; �w�b�_�[�z�o�[���̓X�L�b�v�j---
  if (!srcIsFolder) {
    const newContainer = newFolderTarget ? null : _mDetectContainer(refY);
    if (newContainer !== _mCurContainer) {
      _mSwitchContainer(newContainer, refY);
    }
  }

  if (_mFolderTarget !== newFolderTarget) {
    clearTimeout(_mFolderHoverTimer); _mFolderHoverTimer = null;
    if (_mFolderTarget) _mFolderTarget.classList.remove('drag-over');
    _mFolderTarget = newFolderTarget;
    if (_mFolderTarget) {
      _mFolderTarget.classList.add('drag-over');
      const _fc = _mFolderTarget.nextElementSibling;
      if (_fc?.classList.contains('collapsed')) {
        _mFolderHoverTimer = setTimeout(() => {
          _mOpenFolder(_mFolderTarget);
          _mFolderHoverTimer = null;
        }, 700);
      }
    }
  }

  // --- �u�V�����t�H���_�v�{�^���ւ̃h���b�v�^�[�Q�b�g�i���[�g�v���Z�b�g�̂݁j---
  const srcIsRootPreset = !srcIsFolder && _mSrcContainerEl === null;
  const addFolderBtn = document.getElementById('presetAddFolderBtn');
  let newAddFolderTarget = false;
  if (srcIsRootPreset && addFolderBtn) {
    const r = addFolderBtn.getBoundingClientRect();
    newAddFolderTarget = refY >= r.top && refY <= r.bottom
      && ghostMidY - _mDraggedH / 2 <= r.bottom && ghostMidY + _mDraggedH / 2 >= r.top;
    newAddFolderTarget = refY >= r.top && refY <= r.bottom;
  }
  if (newAddFolderTarget !== _mAddFolderTarget) {
    _mAddFolderTarget = newAddFolderTarget;
    if (addFolderBtn) addFolderBtn.classList.toggle('drag-over', newAddFolderTarget);
  }

  // --- �A�N�e�B�u�Z���v�f���X���C�h ---
  const ghostIsExternal = _mCurContainer !== null && !_mCurContainer.contains(_mDraggedEl);
  const ejectToRoot = _mCurContainer === null && _mSrcContainerEl !== null;
  _mActiveSiblings.forEach(sib => {
    if (sib === _mDraggedEl) return;
    const sibMidY = +sib.dataset.mOrigMidY;
    if (ghostIsExternal || ejectToRoot) {
      sib.style.transition = 'transform 0.2s ease';
      sib.style.transform  = sibMidY >= refY ? `translateY(${_mDraggedH + _mDragGap}px)` : '';
      return;
    }
    const isAbove  = 'mIsAbove' in sib.dataset;
    const shouldToggle = isAbove ? refY <= sibMidY : refY >= sibMidY;
    const wasToggled   = 'mToggled' in sib.dataset;
    if (shouldToggle !== wasToggled) {
      if (shouldToggle) sib.dataset.mToggled = '';
      else              delete sib.dataset.mToggled;
    }
    sib.style.transition = 'transform 0.2s ease';
    sib.style.transform  = 'mToggled' in sib.dataset
      ? `translateY(${(isAbove ? 1 : -1) * (_mDraggedH + _mDragGap)}px)`
      : '';
  });

  // --- �R���e�i�t�H�����[�i_mCurContainer ���������̃��[�g�v�f�j���v�b�V�� ---
  const visibleSibs = _mActiveSiblings.filter(s => s !== _mDraggedEl);
  const lastSib = visibleSibs[visibleSibs.length - 1];
  let followerShift = 0;
  if (_mCurContainer !== null) {
    if (ghostIsExternal) {
      followerShift = _mDraggedH + _mDragGap;
    } else if (lastSib) {
      if ('mIsAbove' in lastSib.dataset && 'mToggled' in lastSib.dataset) {
        followerShift = _mDraggedH + _mDragGap;
      }
    }
  }
  _mContainerFollowers.forEach(el => {
    el.style.transition = 'transform 0.2s ease';
    el.style.transform  = followerShift > 0 ? `translateY(${followerShift}px)` : '';
  });
}
function _mCalcInsertAt() {
  const list = loadPresets();
  const srcIsFolder = list[_mDragSrcIdx]?.type === 'folder';
  const sibs = _mActiveSiblings.filter(s => s !== _mDraggedEl && !s.classList.contains('preset-root-separator'));

  // --- ���[�g���x���փh���b�v���ꂽ���t�H���_�A�C�e�� ---
  if (_mCurContainer === null && !srcIsFolder) {
    const firstFolderIdx = list.findIndex(p => p.type === 'folder');
    let insertAfterSib = null;
    for (const sib of sibs) {
      if (+sib.dataset.mOrigMidY < _mLastRefY) insertAfterSib = sib;
    }
    if (insertAfterSib !== null) {
      const idx = +insertAfterSib.dataset.idx;
      // idx + 1 �͏��� firstFolderIdx �ȉ��isibs �̓��[�g�A�C�e���̂݁j
      return firstFolderIdx !== -1 ? Math.min(idx + 1, firstFolderIdx) : idx + 1;
    }
    if (sibs.length > 0) return +sibs[0].dataset.idx;
    return firstFolderIdx !== -1 ? firstFolderIdx : list.length;
  }

  // --- ���[�g�ł̃t�H���_�h���b�O�A�܂��̓t�H���_�R���e�i���ł̃A�C�e���h���b�O ---
  let insertAfterSib = null;
  for (const sib of sibs) {
    if (+sib.dataset.mOrigMidY < _mLastRefY) insertAfterSib = sib;
  }

  if (insertAfterSib !== null) {
    const idx  = +insertAfterSib.dataset.idx;
    const item = list[idx];
    let end = idx + 1;
    if (item?.type === 'folder') while (end < list.length && list[end].type !== 'folder') end++;
    return end;
  }

  if (sibs.length > 0) return +sibs[0].dataset.idx;

  if (_mCurContainer) return +_mCurContainer.dataset.idx + 1;

  return _mDragSrcIdx; // fallback: �ύX�Ȃ�
}
function _mCleanup() {
  _isDraggingPreset = false;
  document.body.classList.remove('preset-dragging', 'dragging-folder');
  document.removeEventListener('mousemove', _mOnMouseMove);
  document.removeEventListener('mouseup',   _mOnMouseUp);
  document.removeEventListener('touchmove', _mOnTouchMove);
  document.removeEventListener('touchend',  _mOnMouseUp);
  if (_mGhost) { _mGhost.remove(); _mGhost = null; }
  if (_mDraggedEl) {
    _mDraggedEl.classList.remove('dnd-src');
    _mDraggedEl.style.transform  = '';
    _mDraggedEl.style.transition = '';
    _mDraggedEl.style.zIndex     = '';
  }
  _mActiveSiblings.forEach(sib => {
    if (sib === _mDraggedEl) return;
    sib.style.transform  = '';
    sib.style.transition = '';
    delete sib.dataset.mIsAbove;
    delete sib.dataset.mToggled;
    delete sib.dataset.mOrigMidY;
  });
  if (_mFolderTarget) { _mFolderTarget.classList.remove('drag-over'); _mFolderTarget = null; }
  clearTimeout(_mFolderHoverTimer); _mFolderHoverTimer = null;
  const addFolderBtn2 = document.getElementById('presetAddFolderBtn');
  if (addFolderBtn2) addFolderBtn2.classList.remove('drag-over');
  _mAddFolderTarget = false;
  _mContainerFollowers.forEach(el => { el.style.transform = ''; el.style.transition = ''; });
  _mContainerFollowers = [];
  _mDraggedEl      = null;
  _mActiveSiblings = [];
  _mDragSrcIdx     = null;
  _mCurContainer   = null;
  _mLastGhostMidY  = 0;
  _mLastRefY       = 0;
  _mSrcOrigMidY    = 0;
  _mSrcContainerEl = null;
}
function _mApplyDrop() {
  if (_mFolderTarget) {
    const folderIdx = +_mFolderTarget.dataset.idx;
    const list2 = loadPresets();
    const src = list2[_mDragSrcIdx];
    if (src?.type !== 'folder') {
      let insertAt = folderIdx + 1;
      while (insertAt < list2.length && list2[insertAt].type !== 'folder') insertAt++;
      const [moved] = list2.splice(_mDragSrcIdx, 1);
      if (insertAt > _mDragSrcIdx) insertAt--;
      list2.splice(insertAt, 0, moved);
      list2[folderIdx].open = true; // �h���b�v���Ƀt�H���_���J��
      savePresets(list2);
      return insertAt; // �ړ����̐V�C���f�b�N�X
    }
    return null;
  }
  const insertAt = _mCalcInsertAt();
  const list2 = loadPresets();
  const src = list2[_mDragSrcIdx];
  let srcEnd = _mDragSrcIdx + 1;
  if (src?.type === 'folder') while (srcEnd < list2.length && list2[srcEnd].type !== 'folder') srcEnd++;
  const count = srcEnd - _mDragSrcIdx;
  const moved = list2.slice(_mDragSrcIdx, srcEnd);
  const testList = [...list2];
  testList.splice(_mDragSrcIdx, count);
  let fi = insertAt;
  if (fi > _mDragSrcIdx) fi -= count;
  fi = Math.max(0, fi);
  testList.splice(fi, 0, ...moved);
  if (JSON.stringify(testList) === JSON.stringify(list2)) return null; // �ύX�Ȃ�
  list2.splice(_mDragSrcIdx, count);
  list2.splice(fi, 0, ...moved);
  savePresets(list2);
  return fi; // �ړ����̐V�C���f�b�N�X
}
function _mStartDrag(pending) {
  const { unit, rect, downY } = pending;

  _mDragSrcIdx     = +unit.dataset.idx;
  _mDraggedEl      = unit;
  _mDraggedH       = rect.height;
  _mPointerOffsetY = downY - rect.top;

  // DOM ���̃��j�b�g�ʒu���珉���R���e�i�����o
  const closestFolderChildren = unit.closest('.preset-folder-children');
  _mCurContainer = closestFolderChildren ? unit.closest('.preset-folder') : null;

  const srcIsFolder2 = loadPresets()[_mDragSrcIdx]?.type === 'folder';
  let initSibs;
  if (_mCurContainer) {
    initSibs = _mGetFolderItems(_mCurContainer);
  } else if (srcIsFolder2) {
    initSibs = _mGetRootUnits();
  } else {
    initSibs = _mGetRootUnits().filter(u => !u.classList.contains('preset-folder'));
  }
  _mDragGap = 0;
  for (let i = 0; i < initSibs.length - 1; i++) {
    const r1 = initSibs[i].getBoundingClientRect();
    const r2 = initSibs[i + 1].getBoundingClientRect();
    const g  = r2.top - r1.bottom;
    if (g >= 0 && g < 100) { _mDragGap = g; break; }
  }
  const ghostMidY  = rect.top + rect.height / 2;
  const initMouseY = rect.top + _mPointerOffsetY;  // �h���b�O�J�n���̃J�[�\��Y
  _mSrcOrigMidY    = initMouseY;
  _mSrcContainerEl = _mCurContainer;
  _mActiveSiblings = initSibs;
  _mLastRefY       = initMouseY;
  _mInitSiblings(initSibs, initMouseY);

  _mGhost = unit.cloneNode(true);
  _mGhost.className += ' preset-dnd-ghost';
  _mGhost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;pointer-events:none;z-index:9999;opacity:0.9;box-shadow:0 8px 28px rgba(0,0,0,0.45);border-radius:8px;`;
  document.body.appendChild(_mGhost);
  lucide.createIcons({ el: _mGhost });
  unit.classList.add('dnd-src');
  _isDraggingPreset = true;
  document.body.classList.add('preset-dragging');
  if (srcIsFolder2) document.body.classList.add('dragging-folder');
}
function _mOnPendingMove(e) {
  if (!_mPending) return;
  const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
  const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  if (Math.abs(y - _mPending.downY) < _M_THRESHOLD &&
      Math.abs(x - _mPending.downX) < _M_THRESHOLD) return;
  const pending = _mPending;
  _mCancelPending();
  _mStartDrag(pending);
  document.addEventListener('mousemove', _mOnMouseMove);
  document.addEventListener('mouseup',   _mOnMouseUp);
  document.addEventListener('touchmove', _mOnTouchMove, { passive: false });
  document.addEventListener('touchend',  _mOnMouseUp);
  e.preventDefault();
  _mUpdateSlide(y - _mPointerOffsetY + _mDraggedH / 2);
}
function _mOnPendingUp() { _mCancelPending(); }
function _mCancelPending() {
  document.removeEventListener('mousemove', _mOnPendingMove);
  document.removeEventListener('mouseup',   _mOnPendingUp);
  document.removeEventListener('touchmove', _mOnPendingMove);
  document.removeEventListener('touchend',  _mOnPendingUp);
  document.body.classList.remove('preset-pending-drag');
  _mPending = null;
}
function _mOnMouseMove(e) {
  if (!_mDraggedEl) return;
  e.preventDefault();
  const y = e.clientY ?? e.touches?.[0]?.clientY;
  _mUpdateSlide(y - _mPointerOffsetY + _mDraggedH / 2);
}
const _mOnTouchMove = e => { if (_mDraggedEl) { e.preventDefault(); _mOnMouseMove(e); } };
function _mOnMouseUp() {
  if (!_mDraggedEl) return;
  if (_mAddFolderTarget) {
    const list = loadPresets();
    const src = list[_mDragSrcIdx];
    if (src && src.type !== 'folder') {
      list.splice(_mDragSrcIdx, 1);
      list.push({ type: 'folder', name: t('folder-new'), open: true });
      list.push(src);
      savePresets(list);
    }
    _mCleanup();
    renderPresets();
    requestAnimationFrame(() => {
      const headers = document.querySelectorAll('.preset-folder-header');
      const last = headers[headers.length - 1];
      if (!last) return;
      const nameEl = last.querySelector('.preset-folder-name');
      if (!nameEl) return;
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
    });
    return;
  }
  const _dropSrcIdx = _mDragSrcIdx;
  const _dropNewIdx  = _mApplyDrop();
  if (_dropNewIdx != null && _dropSrcIdx === _activePresetIdx) {
    _activePresetIdx = _dropNewIdx;
    _f2Target = { type: 'preset', idx: _dropNewIdx };
  }
  _mCleanup();
  renderPresets();
}
function _mOnMouseDown(e) {
  if (e.target.closest('button')) return;
  if (e.target.closest('[contenteditable]:not([contenteditable="false"])')) return;
  if (e.target.closest('.preset-folder-toggle')) return;
  if (e.target.closest('input, select, textarea')) return;
  const folderHeader = e.target.closest('.preset-folder-header');
  const draggedUnit  = folderHeader
    ? folderHeader.closest('.preset-folder')
    : e.target.closest('.preset-item');
  if (!draggedUnit) return;
  const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
  const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  _mPending = { downY: y, downX: x, unit: draggedUnit, rect: draggedUnit.getBoundingClientRect() };
  document.body.classList.add('preset-pending-drag');
  document.addEventListener('mousemove', _mOnPendingMove);
  document.addEventListener('mouseup',   _mOnPendingUp);
  document.addEventListener('touchmove', _mOnPendingMove, { passive: false });
  document.addEventListener('touchend',  _mOnPendingUp);
}
((() => {
  const bind = () => {
    const el = document.getElementById('presetList');
    if (!el || el._mouseDndBound) return;
    el._mouseDndBound = true;
    el.addEventListener('mousedown',  _mOnMouseDown);
    el.addEventListener('touchstart', _mOnMouseDown, { passive: false });
  };
  new MutationObserver(bind).observe(document.body, { childList: true, subtree: true });
})());
// canvasWrap / maskDropOverlay �ł͓����E�摜�̂ݎ󂯕t����
const _isMediaDragCanvas = e => {
  if (!e.dataTransfer?.items) return false;
  return [...e.dataTransfer.items].some(item =>
    item.kind === 'file' && (item.type.startsWith('video/') || item.type.startsWith('image/'))
  );
};

canvasWrap.addEventListener('dragover', e => {
  if (_isDraggingPreset) { e.preventDefault(); return; }
  if (!_isMediaDragCanvas(e)) return;
  e.preventDefault();
  canvasWrap.classList.add('canvas-drop-over');
  maskDropOverlay.classList.add('drag-active');
  syncMaskDropOverlay(); // �h���b�O���Ƀ}�X�N���������ꍇ�ɂ��Ǐ]
});
canvasWrap.addEventListener('dragleave', e => {
  if (!e.relatedTarget || !canvasWrap.contains(e.relatedTarget)) {
    canvasWrap.classList.remove('canvas-drop-over');
    maskDropOverlay.classList.remove('drag-active', 'drag-over');
  }
});
canvasWrap.addEventListener('drop', e => {
  if (!_isMediaDragCanvas(e)) return;
  e.preventDefault();
  if (e.target === maskDropOverlay) return; // �}�X�N����drop��overlay������
  processDropFiles(e, 0); // canvasWrap���ڃh���b�v �� �w�i(0)
});

// maskDropOverlay: �}�X�N�̈悪�{����D&D�^�[�Q�b�g
maskDropOverlay.addEventListener('dragover', e => {
  if (!_isMediaDragCanvas(e)) return;
  e.preventDefault();
  e.stopPropagation(); // canvasWrap�ɓ`�d�����Ȃ�
  maskDropOverlay.classList.add('drag-over');
  canvasWrap.classList.add('canvas-drop-over');
});
maskDropOverlay.addEventListener('dragleave', () => {
  maskDropOverlay.classList.remove('drag-over');
});
maskDropOverlay.addEventListener('drop', e => {
  if (!_isMediaDragCanvas(e)) return;
  e.preventDefault();
  e.stopPropagation();
  processDropFiles(e, 1); // �}�X�N���h���b�v �� �O�i(1)
});

// ============================================================
// ============================================================
const _playFlashIcon = document.getElementById('playFlashIcon');
function _showPlayFlash(playing) {
  _playFlashIcon.classList.remove('flash');
  // reflow �ōăg���K�[
  void _playFlashIcon.offsetWidth;
  _playFlashIcon.innerHTML = playing
    ? '<svg viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="white"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';
  _playFlashIcon.classList.add('flash');
}

function setPlaying(playing) {
  S.playing = playing;
  elPlayBtn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i>`;
  lucide.createIcons();
}

function _getOffsets() {
  return [
    parseFloat(document.getElementById('offset0').value) || 0,
    parseFloat(document.getElementById('offset1').value) || 0,
  ];
}

async function _applyCompositeT(T) {
  _playDelayTimers.forEach(t => clearTimeout(t));
  _playDelayTimers = [];
  _compositeLastRaf = null;
  _compositeSeekPending = true;

  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].pause(); });

  const [o1, o2] = _getOffsets();
  await Promise.all([0, 1].map(i => {
    if (mediaType[i] !== 'video') return Promise.resolve();
    const o = i === 0 ? o1 : o2;
    if (!loaded[i] || !vid[i].duration) return Promise.resolve();
    const vt = Math.max(0, Math.min(vid[i].duration, T + o));
    if (Math.abs(vid[i].currentTime - vt) < 0.003) return Promise.resolve();
    return new Promise(res => {
      vid[i].addEventListener('seeked', res, { once: true });
      vid[i].currentTime = vt;
    });
  }));

  _compositeSeekPending = false;
  if (!S.playing) return;

  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].playbackRate = 1.0; });
  [o1, o2].forEach((o, i) => {
    if (!loaded[i] || mediaType[i] !== 'video') return;
    if (T + o < 0) {
      const t = setTimeout(() => { if (S.playing && loaded[i]) vid[i].play().catch(() => {}); }, -(T + o) * 1000);
      _playDelayTimers.push(t);
    } else {
      vid[i].play().catch(() => {});
    }
  });
  if (loaded[0] && loaded[1] && mediaType[0] === 'video' && mediaType[1] === 'video') {
    // play()�����̋N���Y�����f�����␳���邽�߁A�Z���o�[�X�g����
    _scheduleResync(80);
  }
}

async function syncPlay() {
  setPlaying(true);
  _showPlayFlash(true);
  const [o1, o2] = _getOffsets();
  const needsSeek = [0, 1].some(i => {
    if (!loaded[i] || mediaType[i] !== 'video') return false;
    const o = i === 0 ? o1 : o2;
    const vt = Math.max(0, Math.min(vid[i].duration, _compositeT + o));
    return Math.abs(vid[i].currentTime - vt) >= 0.05;
  });
  if (!needsSeek) {
    // Fast resume: seek �s�v�A�� play()
    // playbackRate �����ɑS���Z�b�g���Ă��� play() �����Ĕ��΁i�Y���ŏ����j
    clearTimeout(_resyncTimer);
    _playDelayTimers.forEach(t => clearTimeout(t));
    _playDelayTimers = [];
    _compositeLastRaf = null;
    _compositeSeekPending = false;
    [0, 1].forEach(i => { if (loaded[i] && mediaType[i] === 'video') vid[i].playbackRate = 1.0; });
    [0, 1].forEach(i => {
      if (!loaded[i] || mediaType[i] !== 'video') return;
      const o = i === 0 ? o1 : o2;
      if (_compositeT + o < 0) {
        const t = setTimeout(() => { if (S.playing && loaded[i]) vid[i].play().catch(() => {}); }, -(_compositeT + o) * 1000);
        _playDelayTimers.push(t);
      } else {
        vid[i].play().catch(() => {});
      }
    });
    if (loaded[0] && loaded[1] && mediaType[0] === 'video' && mediaType[1] === 'video') {
      _scheduleResync(30); // ���߂ɏ���resync�����{���ăY�����f�����␳
    }
  } else {
    await _applyCompositeT(_compositeT);
  }
}

function syncPause() {
  clearTimeout(_resyncTimer);
  _playDelayTimers.forEach(t => clearTimeout(t));
  _playDelayTimers = [];
  _compositeLastRaf = null;
  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].pause(); });
  setPlaying(false);
  _showPlayFlash(false);
}

function syncStop() {
  clearTimeout(_resyncTimer);
  _playDelayTimers.forEach(t => clearTimeout(t));
  _playDelayTimers = [];
  _compositeLastRaf = null;
  _compositeT = 0;
  [0, 1].forEach(i => { if (mediaType[i] === 'video') { vid[i].pause(); vid[i].currentTime = 0; } });
  setPlaying(false);
}

function triggerTbtnGlow(btn) {
  btn.classList.remove('glow');
  void btn.offsetWidth; // reflow to restart animation
  btn.classList.add('glow');
  btn.addEventListener('animationend', () => btn.classList.remove('glow'), { once: true });
}

document.querySelectorAll('.tbtn').forEach(btn => {
  btn.addEventListener('click', () => triggerTbtnGlow(btn));
});

elPlayBtn.addEventListener('click', () => {
  if (S.playing) syncPause(); else syncPlay();
});

const stopBtn = document.getElementById('stopBtn');
if (stopBtn) {
  stopBtn.addEventListener('click', () => { syncStop(); triggerTbtnGlow(stopBtn); });
}

// ============================================================
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
      if (S.playing) syncPause(); else syncPlay();
      triggerTbtnGlow(elPlayBtn);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      _compositeT = Math.max(0, _compositeT - (e.shiftKey ? 5 : 1));
      _applyCompositeT(_compositeT);
      break;
    case 'ArrowRight': {
      e.preventDefault();
      const refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration
                   : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration : 0;
      _compositeT = refDur ? Math.min(refDur, _compositeT + (e.shiftKey ? 5 : 1)) : _compositeT;
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
// ============================================================
function updateSliderFill(el) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

function bindSlider(id, valId, fmt, onChange) {
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

  // --- �P�̃��Z�b�g�{�^�� ---
  const resetBtn = document.createElement('button');
  resetBtn.className = 'ctrl-reset-btn';
  resetBtn.dataset.i18nTitle = 'slider-reset';
  resetBtn.title = t('slider-reset');
  resetBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
  resetBtn.addEventListener('click', () => {
    // maskW / maskH �� phone �`���̂Ƃ������l���قȂ�
    const id = el.id;
    if ((id === 'maskW' || id === 'maskH') && S.mask.shape === 'phone') {
      const cw = canvas.width, ch = canvas.height;
      const targetW = 360, targetH = 780;
      let dw, dh;
      if (_phoneLandscape) {
        dw = Math.min(targetH, cw);
        dh = Math.round(dw * targetW / targetH);
        if (dh > ch) { dh = Math.min(targetW, ch); dw = Math.round(dh * targetH / targetW); }
      } else {
        dw = Math.min(targetW, cw);
        dh = Math.round(dw * targetH / targetW);
        if (dh > ch) { dh = Math.min(targetH, ch); dw = Math.round(dh * targetW / targetH); }
      }
      el.value = id === 'maskW' ? dw : dh;
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

// ---- �}�X�^�[�{�����[�� (transport overlay) ----
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
    vid[0].volume = g * (parseFloat(document.getElementById('vol0').value) / 100) ** 2;
    vid[1].volume = g * (parseFloat(document.getElementById('vol1').value) / 100) ** 2;
    const iconName = _masterMuted || _masterVol === 0 ? 'volume-x' : _masterVol < 50 ? 'volume-1' : 'volume-2';
    masterMuteBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    lucide.createIcons({ nodes: [masterMuteBtn] });
    _applyVolUI();
  };
  _applyMaster(); // �����`��

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
  const ar = S.mask.h > 0 ? S.mask.w / S.mask.h : 1;
  if (parseFloat(elMaskW.value) < 10) { elMaskW.value = 10; updateSliderFill(elMaskW); v = 10; document.getElementById('maskWVal').value = 10; }
  _syncZoomToMaskScale(S.mask.w, v);
  S.mask.w = v;
  if (S.arLock && S.mask.h > 0) {
    const newH = Math.max(0, Math.round(v / ar));
    S.mask.h = newH;
    elMaskH.value = newH;
    document.getElementById('maskHVal').value = newH;
    updateSliderFill(elMaskH);
  }
});
bindSlider('maskH',   'maskHVal',   v => `${Math.round(v)}`,    v => {
  const ar = S.mask.h > 0 ? S.mask.w / S.mask.h : 1;
  if (parseFloat(elMaskH.value) < 10) { elMaskH.value = 10; updateSliderFill(elMaskH); v = 10; document.getElementById('maskHVal').value = 10; }
  S.mask.h = v;
  if (S.arLock && S.mask.w > 0) {
    const newW = Math.max(0, Math.round(v * ar));
    S.mask.w = newW;
    elMaskW.value = newW;
    document.getElementById('maskWVal').value = newW;
    updateSliderFill(elMaskW);
  }
});
bindSlider('maskOffX', 'maskOffXVal', v => `${Math.round(v)}`, v => {
  const cw = canvas.width;
  const cx = Math.round((cw - S.mask.w) / 2);
  S.mask.x = Math.max(0, Math.min(cx + Math.round(v), cw - S.mask.w));
});
bindSlider('maskOffY', 'maskOffYVal', v => `${Math.round(v)}`, v => {
  const ch = canvas.height;
  const cy = Math.round((ch - S.mask.h) / 2);
  S.mask.y = Math.max(0, Math.min(cy + Math.round(v), ch - S.mask.h));
});
bindSlider('borderW', 'borderWVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('maskZoom', 'maskZoomVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(2), null);
bindSlider('fgPinX',   'fgPinXVal',   v => `${Math.round(v)}`, null);
bindSlider('fgPinY',   'fgPinYVal',   v => `${Math.round(v)}`, null);
bindSlider('fgPinLerp','fgPinLerpVal',v => `${Math.round(v)}`, null);
bindSlider('fgPinOpacity','fgPinOpacityVal',v => `${Math.round(v)}`, null);
bindSlider('maskBlur', 'maskBlurVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterBlur', 'filterBlurVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), updateCanvasFilter);
bindSlider('maskPixel','maskPixelVal',v => `${Math.round(v)}`, null);
bindSlider('borderOpacity', 'borderOpacityVal', v => `${Math.round(v)}`, null);
bindSlider('borderAnimSpeed', 'borderAnimSpeedVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('borderAnimBright', 'borderAnimBrightVal', v => `${Math.round(v)}`, null);
let _syncBorderSwatch    = () => {};
let _closeBorderColorPop = () => {};
let _syncAnimColors      = (_anim) => {};
let _resetBcpTarget      = ()      => {};
function _applyBorderAnim(anim) {
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
      void customRow.offsetHeight; // reflow
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
{
  const SOLID_PRESETS = [
    '#ffffff','#222222','#ff5555','#ff9933',
    '#ffdd33','#33dd77','#33aaff','#33eeff',
    '#aa55ff','#ff55bb','#ff8833','#00ffcc'
  ];
  const GRAD_MAP = { rainbow: 'conic-gradient(from 0deg, #ff7eb3, #ffb347, #f9f871, #6ee7b7, #93c5fd, #d8b4fe, #ff7eb3)' };
  Object.entries(_animColors).forEach(([k, [c0, c1]]) => { GRAD_MAP[k] = `linear-gradient(135deg,${c0},${c1})`; });
  let _bcpTarget = 'main'; // 'main' | 'c0' | 'c1'

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
      if (_bcpTarget === 'main') _applyBorderAnim('none');
      _loadHex(hex); _applyColorState();
      if (_bcpTarget === 'main') _closeBorderColorPop();
    });
    solidRow.appendChild(btn);
  });
  // SV / �F���h���b�O
  let _svDrag = false, _hueDrag = false, _wasDragging = false;
  function _pickSv(e) {
    const r = svCanvas.getBoundingClientRect();
    _s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    _v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    if (_bcpTarget === 'main') _applyBorderAnim('none');
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

  // Hex ����
  hexInput.addEventListener('change', () => {
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      if (_bcpTarget === 'main') _applyBorderAnim('none');
      _loadHex(v); _applyColorState();
    }
  });

  picker.addEventListener('input', () => {
    if (_bcpTarget === 'main') _applyBorderAnim('none');
    _loadHex(picker.value); _applyColorState();
  });

  _syncBorderSwatch = function () {
    const anim = elBorderAnim.value;
    swatch.style.background = anim !== 'none' ? (GRAD_MAP[anim] || picker.value) : picker.value;
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
  // HexInput �ł� Escape
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
bindSlider('filterFlare',      'filterFlareVal',      v => `${parseFloat(v) % 1 === 0 ? parseInt(v) : parseFloat(v).toFixed(1)}`, null);
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
  effectsHidden = !effectsHidden;
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
  ['filterBrightness', 'filterContrast', 'filterHighlight', 'filterShadow', 'filterSaturation', 'filterHue', 'filterTemp', 'filterTint', 'filterSharpness', 'filterCA', 'filterVignette', 'filterMatte', 'filterGrain', 'filterFlare', 'filterBars', 'filterFps', 'filterBlur', 'filterRain'].forEach(id => {
    const el = document.getElementById(id);
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  });
});

// ---- �N�C�b�N�t�B���^�[�v���Z�b�g ----
//   filterBrightness : 0?200   (default 100)
//   filterContrast   : 0?200   (default 100)
//   filterHighlight  : -100?100 (default 0)
//   filterShadow     : -100?100 (default 0)
//   filterSaturation : 0?200   (default 100)
//   filterHue        : -180?180 (default 0)
//   filterTemp       : -50?50  (default 0)
//   filterTint       : -50?50  (default 0)
//   filterSharpness  : 0?10    (default 0)
//   filterCA         : 0?10    (default 0)
//   filterVignette   : 0?10    (default 0)
//   filterMatte      : 0?10    (default 0)  �� ������ + ����������
//   filterGrain      : 0?10    (default 0)
//   filterFlare      : 0?10    (default 0)
//   filterBars       : 0?10    (default 0)
//   filterFps        : 0?120   (default 0, 0=�����Ȃ�)
//   filterBlur       : 0?10    (default 0) �� �}�X�N�Z�N�V����
//   filterPixel      : 0?10    (default 0) �� �}�X�N�Z�N�V����
const _FQP = {
  //            bright  cont   hl     sh     sat    hue    temp   tint   sharp  ca     vig    matte  grain  flare  bars   fps    blur   pixel
  cinema:  { filterBrightness: 95,  filterContrast: 122, filterHighlight: -15, filterShadow: +10, filterSaturation: 80,  filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 1.5, filterCA: 0.5, filterVignette: 4,   filterMatte: 5,   filterGrain: 0.8, filterFlare: 0,   filterBars: 5,   filterFps: 24, maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  retro:   { filterBrightness: 105, filterContrast: 88,  filterHighlight: -20, filterShadow: +25, filterSaturation: 58,  filterHue: 0, filterTemp: +22, filterTint:  -8, filterSharpness: 0,   filterCA: 0,   filterVignette: 5,   filterMatte: 7,   filterGrain: 2.5, filterFlare: 1.5, filterBars: 0,   filterFps: 18, maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  insta:   { filterBrightness: 112, filterContrast: 108, filterHighlight:   0, filterShadow:   0, filterSaturation: 128, filterHue: 0, filterTemp: +10, filterTint:   0, filterSharpness: 2,   filterCA: 0,   filterVignette: 1.5, filterMatte: 0,   filterGrain: 0,   filterFlare: 0.5, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  pastel:  { filterBrightness: 130, filterContrast: 90,  filterHighlight:   0, filterShadow: +30, filterSaturation: 80,  filterHue: 0, filterTemp:   0, filterTint:  +5, filterSharpness: 0,   filterCA: 0,   filterVignette: 0,   filterMatte: 6,   filterGrain: 0,   filterFlare: 0,   filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  neon:    { filterBrightness: 88,  filterContrast: 138, filterHighlight: +20, filterShadow:   0, filterSaturation: 175, filterHue: 0, filterTemp: -18, filterTint: -10, filterSharpness: 0,   filterCA: 1.8, filterVignette: 7,   filterMatte: 0,   filterGrain: 0.5, filterFlare: 3.5, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  sunset:  { filterBrightness: 108, filterContrast: 112, filterHighlight:   0, filterShadow:   0, filterSaturation: 135, filterHue: 0, filterTemp: +38, filterTint:  -5, filterSharpness: 1,   filterCA: 0,   filterVignette: 3,   filterMatte: 0,   filterGrain: 0,   filterFlare: 4.5, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  cool:    { filterBrightness: 100, filterContrast: 108, filterHighlight:   0, filterShadow:   0, filterSaturation: 78,  filterHue: 0, filterTemp: -28, filterTint:   0, filterSharpness: 1.5, filterCA: 0,   filterVignette: 3,   filterMatte: 0,   filterGrain: 0,   filterFlare: 0,   filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  dreamy:  { filterBrightness: 108, filterContrast: 78,  filterHighlight: +10, filterShadow: +20, filterSaturation: 85,  filterHue: 0, filterTemp: +15, filterTint:   0, filterSharpness: 0,   filterCA: 0,   filterVignette: 2,   filterMatte: 7,   filterGrain: 0,   filterFlare: 3,   filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  glitch:  { filterBrightness: 100, filterContrast: 122, filterHighlight:   0, filterShadow:   0, filterSaturation: 120, filterHue: 0, filterTemp:   0, filterTint:   0, filterSharpness: 0,   filterCA: 4.5, filterVignette: 2,   filterMatte: 0,   filterGrain: 2,   filterFlare: 0,   filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  noir:    { filterBrightness: 90,  filterContrast: 148, filterHighlight: -30, filterShadow: -20, filterSaturation: 12,  filterHue: 0, filterTemp:  -5, filterTint:   0, filterSharpness: 2,   filterCA: 0,   filterVignette: 8,   filterMatte: 3,   filterGrain: 1.2, filterFlare: 0,   filterBars: 3,   filterFps: 24, maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  horror:  { filterBrightness: 83,  filterContrast: 130, filterHighlight:   0, filterShadow: -15, filterSaturation: 30,  filterHue: 0, filterTemp:  -8, filterTint:  -8, filterSharpness: 0,   filterCA: 0.5, filterVignette: 9,   filterMatte: 0,   filterGrain: 3.5, filterFlare: 0,   filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  modern:  { filterBrightness: 95,  filterContrast: 120, filterHighlight:   0, filterShadow:   0, filterSaturation: 110, filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 2,   filterCA: 2,   filterVignette: 0,   filterMatte: 0,   filterGrain: 0,   filterFlare: 1.5, filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
  trend:   { filterBrightness: 90,  filterContrast: 150, filterHighlight:   0, filterShadow:   0, filterSaturation: 180, filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 0,   filterCA: 0,   filterVignette: 0,   filterMatte: 5,   filterGrain: 0,   filterFlare: 2,   filterBars: 0,   filterFps: 0,  maskBlur: 0, maskPixel: 0, filterBlur: 0 },
};
// ---- �J�X�^���t�B���^�[�v���Z�b�g ----
const _FQP_FILTER_KEYS = [
  'filterBrightness','filterContrast','filterHighlight','filterShadow',
  'filterSaturation','filterHue','filterTemp','filterTint',
  'filterSharpness','filterCA','filterVignette','filterMatte',
  'filterGrain','filterFlare','filterBars','filterFps','maskBlur','maskPixel','filterBlur','filterRain',
  'rainSpeed','rainRefraction','rainShadow'
];
const _FQP_CUSTOM_KEY = 'gf-fqp-custom';

function _collectFilterParams() {
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

function _renderCustomFQP() {
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

// ---- �J�X�^��FQP �ۑ��t�H�[�� ----
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

const _muteVolume = [null, null]; // �~���[�g�O�̉��ʂ��ێ�
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
// ============================================================
// phone ? ��phone �œƗ����ă}�X�N���Ԃ��ێ�
let _phoneMaskState    = null; // phone ���̍Ō��̏���
let _nonPhoneMaskState = null; // ��phone ���̍Ō��̏���

document.querySelectorAll('.shape-btn').forEach(btn => {
  // press���͑S�{�^���� active ���O���āu�������v�\����������
  btn.addEventListener('pointerdown', () => {
    if (btn.disabled) return;
    document.querySelectorAll('.shape-btn').forEach(b => {
      b.classList.add('_was-active');
      if (b.classList.contains('active')) b.classList.add('_had-active');
      b.classList.remove('active');
    });
    const onUp = e => {
      document.removeEventListener('pointerup', onUp);
      // click �������{�^�����Ŕ��΂����ꍇ�� click ���ŃN���[���A�b�v�ς�
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
    // _was-active �N���[���A�b�v�iclick �����������ꍇ�͕����s�v�j
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('_was-active', '_had-active'));
    if (btn.disabled) return;
    const prevShape = S.mask.shape;
    const newShape  = btn.dataset.shape;
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.mask.shape = newShape;
    elPhoneUiRow.style.display = newShape === 'phone' ? '' : 'none';
    _updateFgFixedBtn();

    // --- phone ? ��phone �̏��ԃX���b�v�i�`���ŗL�����������ɍs���j---
    if (prevShape !== 'phone' && newShape === 'phone') {
      _nonPhoneMaskState = { w: S.mask.w, h: S.mask.h, x: S.mask.x, y: S.mask.y };
    } else if (prevShape === 'phone' && newShape !== 'phone') {
      // phone �� ��phone: phone���Ԃ��ۑ����A��phone���Ԃ𕜌�
      _phoneMaskState = { w: S.mask.w, h: S.mask.h, x: S.mask.x, y: S.mask.y };
      if (_nonPhoneMaskState) {
        S.mask.w = _nonPhoneMaskState.w; S.mask.h = _nonPhoneMaskState.h;
        S.mask.x = _nonPhoneMaskState.x; S.mask.y = _nonPhoneMaskState.y;
      } else {
        S.mask.w = 400; S.mask.h = 400;
        S.mask.x = Math.round((canvas.width  - 400) / 2);
        S.mask.y = Math.round((canvas.height - 400) / 2);
      }
    }

    // --- �`���ŗL���� ---
    if (newShape === 'heart') {
      const side = Math.max(S.mask.w, S.mask.h);
      S.mask.w = side; S.mask.h = side;
      ['maskW','maskH'].forEach(id => {
        const el = document.getElementById(id);
        el.value = Math.round(side);
        document.getElementById(id + 'Val').value = Math.round(side);
        updateSliderFill(el);
      });
      if (!S.arLock) { _arLockBeforeAutoLock = false; S.arLock = true; _updateArLockBtn(); }
    } else if (newShape === 'phone') {
      // phone���Ԃ𕜌��i�Ȃ����΃f�t�H���g 360x780�j
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
      S.mask.w = newW; S.mask.h = newH;
      S.mask.x = newX; S.mask.y = newY;
      if (!S.arLock) { _arLockBeforeAutoLock = false; S.arLock = true; _updateArLockBtn(); }
    } else {
      // phone/heart�ȊO�ɐ؂��ւ����猳�̃��b�N���Ԃ𕜌�
      if (_arLockBeforeAutoLock !== null) {
        S.arLock = _arLockBeforeAutoLock;
        _arLockBeforeAutoLock = null;
        _updateArLockBtn();
      } else if (S.arLock) {
        S.arLock = false;
        _updateArLockBtn();
      }
    }
    _syncMaskSliders();
  });
});

// ---- �X�}�z UI �I�[�o�[���C �\���g�O�� ----
[
  { btn: elPhoneUiBtnRoT,   get: () => _phoneShowRoT,  set: v => { _phoneShowRoT  = v; } },
  { btn: elPhoneUiBtnRec,   get: () => _phoneShowRec,  set: v => { _phoneShowRec  = v; } },
  { btn: elPhoneUiBtnDot,   get: () => _phoneShowDot,  set: v => { _phoneShowDot  = v; } },
].forEach(({ btn, get, set }) => {
  btn.addEventListener('click', () => {
    set(!get());
    btn.classList.toggle('active', get());
  });
});

elPhoneUiBtnRot90.addEventListener('click', () => {
  _phoneLandscape = !_phoneLandscape;
  elPhoneUiBtnRot90.classList.toggle('active', _phoneLandscape);
  const cw = renderCvs.width, ch = renderCvs.height;
  const tmp = S.mask.w;
  S.mask.w = S.mask.h;
  S.mask.h = tmp;
  S.mask.x = Math.round((cw - S.mask.w) / 2);
  S.mask.y = Math.round((ch - S.mask.h) / 2);
  _syncMaskSliders();
});

function _updateArLockBtn() {
  const btn = document.getElementById('arLockBtn');
  btn.classList.toggle('active', S.arLock);
  btn.innerHTML = `<i data-lucide="${S.arLock ? 'lock' : 'lock-open'}"></i>`;
  btn.title = t(S.arLock ? 'ar-lock' : 'ar-unlock');
  lucide.createIcons();
}
document.getElementById('arLockBtn').addEventListener('click', () => {
  S.arLock = !S.arLock;
  _updateArLockBtn();
});

function _updateZoomLockBtn() {
  const btn = document.getElementById('zoomLockBtn');
  btn.classList.toggle('active', S.zoomLock);
  btn.innerHTML = `<i data-lucide="${S.zoomLock ? 'lock' : 'lock-open'}"></i>`;
  btn.title = t(S.zoomLock ? 'zoom-lock' : 'zoom-unlock');
  lucide.createIcons();
}
document.getElementById('zoomLockBtn').addEventListener('click', () => {
  S.zoomLock = !S.zoomLock;
  _updateZoomLockBtn();
});

function _updateFgFixedBtn() {
  const isPhone = S.mask.shape === 'phone';
  // phone �ȊO�̂Ƃ��� fgFixed ������
  if (!isPhone) S.fgFixed = false;
  // X/Y �X���C�_�[�̓A���J�[���[�h�ifgFixed ON�j���̂ݕ\��
  document.getElementById('fgPinXRow').style.display = S.fgFixed ? '' : 'none';
  document.getElementById('fgPinYRow').style.display = S.fgFixed ? '' : 'none';
  document.getElementById('fgPinLerpRow').style.display = S.fgFixed ? '' : 'none';
  document.getElementById('fgPinOpacityRow').style.display = S.fgFixed ? '' : 'none';
  elMaskZoom.disabled = false;
  document.getElementById('maskZoomVal').disabled = false;
  const btn = document.getElementById('fgFixedBtn');
  btn.classList.toggle('active', S.fgFixed);
  btn.title = t('fg-anchor-show');
}

function _syncZoomToMaskScale(oldW, newW) {
  if (!S.zoomLock || oldW <= 0 || Math.abs(oldW - newW) < 0.5) return;
  const ratio = newW / oldW;
  const curZoom = parseFloat(elMaskZoom.value);
  const newZoom = Math.min(5, Math.max(0.1, parseFloat((curZoom * ratio).toFixed(2))));
  elMaskZoom.value = newZoom;
  document.getElementById('maskZoomVal').value = newZoom % 1 === 0 ? `${Math.round(newZoom)}` : newZoom.toFixed(2);
  updateSliderFill(elMaskZoom);
}
document.getElementById('fgFixedBtn').addEventListener('click', () => {
  S.fgFixed = !S.fgFixed;
  if (S.fgFixed) {
    _zoomLockBeforeFgFixed = S.zoomLock;
    if (!S.zoomLock) {
      S.zoomLock = true;
      _updateZoomLockBtn();
    }
  } else {
    if (_zoomLockBeforeFgFixed !== null) {
      S.zoomLock = _zoomLockBeforeFgFixed;
      _zoomLockBeforeFgFixed = null;
      _updateZoomLockBtn();
    }
  }
  _updateFgFixedBtn();
});

// ---- �}�X�N���Z�b�g ----
document.getElementById('maskVisBtn').addEventListener('click', () => {
  maskHidden = !maskHidden;
  const btn = document.getElementById('maskVisBtn');
  btn.innerHTML = maskHidden
    ? '<i data-lucide="eye-off"></i>'
    : '<i data-lucide="eye"></i>';
  lucide.createIcons({ nodes: [btn] });
});

document.getElementById('maskResetBtn').addEventListener('click', () => {
  const cw = canvas.width, ch = canvas.height;
  let dw, dh;
  if (S.mask.shape === 'phone') {
    const targetW = 360, targetH = 780;
    if (_phoneLandscape) {
      dw = Math.min(targetH, cw);
      dh = Math.round(dw * targetW / targetH);
      if (dh > ch) { dh = Math.min(targetW, ch); dw = Math.round(dh * targetH / targetW); }
    } else {
      dw = Math.min(targetW, cw);
      dh = Math.round(dw * targetH / targetW);
      if (dh > ch) { dh = Math.min(targetH, ch); dw = Math.round(dh * targetW / targetH); }
    }
  } else {
    dw = 400; dh = 400;
  }
  S.mask.x = Math.round((cw - dw) / 2);
  S.mask.y = Math.round((ch - dh) / 2);
  S.mask.w = dw;
  S.mask.h = dh;
  // shape �͂��̂܂�
  S.arLock = (S.mask.shape === 'phone' || S.mask.shape === 'heart'); // phone/heart �� AR ���b�N���ێ�
  _updateArLockBtn();
  // phone �̕ۑ����Ԃ��X�V
  if (S.mask.shape === 'phone') {
    _phoneMaskState = { w: dw, h: dh, x: S.mask.x, y: S.mask.y };
  }
  const resetSlider = id => {
    const el = document.getElementById(id);
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  };
  const setSliderValue = (id, val) => {
    const el = document.getElementById(id);
    el.value = val;
    el.dispatchEvent(new Event('input'));
  };
  _syncMaskSliders();
  ['filterBlur', 'borderW', 'borderOpacity', 'borderSpeed', 'borderGlow'].forEach(resetSlider);
  document.getElementById('borderColor').value =
    document.getElementById('borderColor').defaultValue || '#ffffff';
  lucide.createIcons();
});

// ============================================================
// ============================================================
function swapVideos() {
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

  if (mediaType[0] === 'video') vid[0].volume = (parseFloat(document.getElementById('vol0').value) / 100) ** 2;
  if (mediaType[1] === 'video') vid[1].volume = (parseFloat(document.getElementById('vol1').value) / 100) ** 2;

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

  // Swap URL inputs
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

  // requestVideoFrameCallback �̃N���[�W���͌��C���f�b�N�X(i)���ێ������܂܂Ȃ̂�
  [0, 1].forEach(i => {
    _stopBitmapCapture(i); // �Â��r�b�g�}�b�v���j���i���[�v���͎̂��R���~�ɔC�����j
    if (mediaType[i] === 'video' && loaded[i]) _startBitmapCapture(i);
  });
}

document.getElementById('swapBtn').addEventListener('click', swapVideos);

canvas.addEventListener('mousedown', e => {
  if (e.button === 1) { e.preventDefault(); swapVideos(); }
});

// ============================================================
// ============================================================
function canvasCoords(e) {
  const r  = canvas.getBoundingClientRect();
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  const src = (e.touches && e.touches[0]) ? e.touches[0] : e;
  return {
    x: (src.clientX - r.left) * sx,
    y: (src.clientY - r.top)  * sy
  };
}

function hitTestHandle(px, py) {
  const tol = S.mask.shape === 'heart' ? HANDLE_SZ + 8 : HANDLE_SZ + 3;
  for (const h of getHandles(S.mask)) {
    if (Math.abs(px - h.x) <= tol && Math.abs(py - h.y) <= tol) return h;
  }
  return null;
}

function hitTestMask(px, py) {
  const { x, y, w, h, shape } = S.mask;
  if (shape === 'rect')   return px >= x && px <= x + w && py >= y && py <= y + h;
  if (shape === 'circle') {
    const dx = (px - (x + w / 2)) / (w / 2);
    const dy = (py - (y + h / 2)) / (h / 2);
    return dx * dx + dy * dy <= 1;
  }
  if (shape === 'heart') {
    if (px < x || px > x + w || py < y || py > y + h) return false;
    const tmp = document.createElement('canvas');
    tmp.width = w + 2; tmp.height = h + 2;
    const tc = tmp.getContext('2d');
    buildMaskPath(tc, { x: 0, y: 0, w, h, shape: 'heart' });
    return tc.isPointInPath(px - x, py - y);
  }
  if (shape === 'phone') return px >= x && px <= x + w && py >= y && py <= y + h;
  return false;
}

function hitTestAnchor(px, py) {
  if (!S.fgFixed || S.mask.shape !== 'phone') return false;
  const scale = _dispH > 0 ? canvas.height / _dispH : 1;
  const ax  = canvas.width  / 2 + parseFloat(elFgPinX.value);
  const ay  = canvas.height / 2 + parseFloat(elFgPinY.value);
  const r = Math.max(18, Math.round(28 * scale));
  return Math.abs(px - ax) <= r && Math.abs(py - ay) <= r;
}

function _applyAnchorDrag(p) {
  const nx = Math.max(-1920, Math.min(1920, Math.round(S.drag.pinX0 + (p.x - S.drag.sp.x))));
  const ny = Math.max(-1080, Math.min(1080, Math.round(S.drag.pinY0 + (p.y - S.drag.sp.y))));
  elFgPinX.value = nx; elFgPinY.value = ny;
  document.getElementById('fgPinXVal').value = nx;
  document.getElementById('fgPinYVal').value = ny;
  updateSliderFill(elFgPinX); updateSliderFill(elFgPinY);
}

// phone�`���̌Œ�AR����w�������ɃX�i�b�v����h�𓱏o�A�����ȊO�͒ʏ���Math.round
function _snapMaskSize(w, h) {
  if (S.mask.shape === 'phone') {
    const ar = _phoneLandscape ? 780 / 360 : 360 / 780;
    const sw = Math.round(w / 2) * 2; // �����X�i�b�v
    const sh = Math.round(sw / ar / 2) * 2;
    return { w: sw, h: sh };
  }
  return { w: Math.round(w), h: Math.round(h) };
}

function applyResize(hid, dx, dy, shiftKey) {
  const sm = S.drag.sm;
  let { x, y, w, h } = sm;
  const MIN = 10;
  const isCorner = hid === 'tl' || hid === 'tr' || hid === 'bl' || hid === 'br';
  const lockAr = S.arLock || (shiftKey && isCorner);
  if (lockAr) {
    const ar = sm.w / sm.h;
    if (isCorner) {
      const relDx = Math.abs(dx) / (sm.w || 1);
      const relDy = Math.abs(dy) / (sm.h || 1);
      if (relDx >= relDy) {
        if (hid.includes('l')) { x = sm.x + dx; w = sm.w - dx; }
        if (hid.includes('r')) { w = sm.w + dx; }
        if (w < MIN) { w = MIN; if (hid.includes('l')) x = sm.x + sm.w - MIN; }
        h = w / ar;
        if (hid.includes('t')) y = sm.y + sm.h - h;
      } else {
        if (hid.includes('t')) { y = sm.y + dy; h = sm.h - dy; }
        if (hid.includes('b')) { h = sm.h + dy; }
        if (h < MIN) { h = MIN; if (hid.includes('t')) y = sm.y + sm.h - MIN; }
        w = h * ar;
        if (hid.includes('l')) x = sm.x + sm.w - w;
      }
    } else if (hid === 'ml' || hid === 'mr') {
      if (hid === 'ml') { x = sm.x + dx; w = sm.w - dx; }
      if (hid === 'mr') { w = sm.w + dx; }
      if (w < MIN) { w = MIN; if (hid === 'ml') x = sm.x + sm.w - MIN; }
      const newH = w / ar;
      y = sm.y + (sm.h - newH) / 2;
      h = newH;
    } else { // tc / bc
      if (hid === 'tc') { y = sm.y + dy; h = sm.h - dy; }
      if (hid === 'bc') { h = sm.h + dy; }
      if (h < MIN) { h = MIN; if (hid === 'tc') y = sm.y + sm.h - MIN; }
      const newW = h * ar;
      x = sm.x + (sm.w - newW) / 2;
      w = newW;
    }
  } else {
    if (hid.includes('l')) { x = sm.x + dx; w = sm.w - dx; }
    if (hid.includes('r')) { w = sm.w + dx; }
    if (hid.includes('t')) { y = sm.y + dy; h = sm.h - dy; }
    if (hid.includes('b')) { h = sm.h + dy; }
    if (w < MIN) { w = MIN; if (hid.includes('l')) x = sm.x + sm.w - MIN; }
    if (h < MIN) { h = MIN; if (hid.includes('t')) y = sm.y + sm.h - MIN; }
  }
  _syncZoomToMaskScale(sm.w, Math.round(w));
  const snapped = _snapMaskSize(w, h);
  S.mask.x = Math.round(x); S.mask.y = Math.round(y); S.mask.w = snapped.w; S.mask.h = snapped.h;
  elMaskW.value = S.mask.w;
  document.getElementById('maskWVal').value = S.mask.w;
  elMaskH.value = S.mask.h;
  document.getElementById('maskHVal').value = S.mask.h;
  updateSliderFill(elMaskW);
  updateSliderFill(elMaskH);
}

function startDrag(e, p) {
  if (hitTestAnchor(p.x, p.y)) {
    S.drag.active = true;
    S.drag.mode   = 'fg-anchor';
    S.drag.sp     = { x: p.x, y: p.y };
    S.drag.pinX0  = parseFloat(elFgPinX.value);
    S.drag.pinY0  = parseFloat(elFgPinY.value);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }
  const hh = hitTestHandle(p.x, p.y);
  if (hh) {
    S.drag.active = true;
    S.drag.mode   = hh.id;
    S.drag.sm     = { ...S.mask };
    S.drag.sp     = { x: p.x, y: p.y };
    canvas.style.cursor = hh.cur;
    e.preventDefault();
    return;
  }
  if (hitTestMask(p.x, p.y)) {
    S.drag.active = true;
    S.drag.mode   = 'move';
    S.drag.ox     = p.x - S.mask.x;
    S.drag.oy     = p.y - S.mask.y;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
}

let _canvasClickMoved = false;
canvas.addEventListener('mousedown', e => {
  if (e.button === 2) return; // �E�N���b�N�� startDrag �ɓn���Ȃ�
  _canvasClickMoved = false;  // �Ǐ]���[�h���ł����Z�b�g�i�N���b�N�Đ��̂��߁j
  if (_followMode !== 'none') return; // �Ǐ]���[�h���̓h���b�O/�n���h�������𖳌���
  startDrag(e, canvasCoords(e));
});
canvas.addEventListener('click', () => {
  if (_canvasClickMoved) return;
  if (S.playing) syncPause(); else syncPlay();
});

// ---- �}�X�N�Ǐ]���[�h (�E�N���b�N) ----
// _followMode / _followTargetX,Y �̓t�@�C���擪�Ő錾�ς�

function _setFollowMode(mode) {
  _followMode = mode;
  canvasWrap.classList.toggle('mask-follow', mode !== 'none');
  if (mode === 'anchor' && !S.zoomLock) {
    S.zoomLock = true;
    _updateZoomLockBtn();
  }
}

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const p = canvasCoords(e);
  _followTargetX = p.x;
  _followTargetY = p.y;
  if (S.fgFixed && hitTestAnchor(p.x, p.y)) {
    const next = _followMode === 'anchor' ? 'none' : 'anchor';
    _setFollowMode(next);
  } else if (hitTestMask(p.x, p.y) || hitTestHandle(p.x, p.y)) {
    const next = _followMode === 'mask' ? 'none' : 'mask';
    _setFollowMode(next);
  }
});

canvas.addEventListener('wheel', e => {
  if (_followMode === 'none' && !S.maskHovered && !S.anchorHovered) return;
  e.preventDefault();

  const doZoom = () => {
    const cur = parseFloat(elMaskZoom.value);
    let next;
    if (e.shiftKey) {
      const dir = e.deltaY < 0 ? 1 : -1;
      next = Math.round(Math.min(5, Math.max(0.5, Math.round(cur / 0.5 + dir) * 0.5)) * 10) / 10;
    } else {
      const step = e.deltaY < 0 ? 0.1 : -0.1;
      next = Math.round(Math.min(5, Math.max(0.1, cur + step)) * 10) / 10;
    }
    elMaskZoom.value = next;
    elMaskZoom.dispatchEvent(new Event('input'));
  };
  const doResize = () => {
    const step = e.deltaY < 0 ? 10 : -10;
    const cx = S.mask.x + S.mask.w / 2;
    const cy = S.mask.y + S.mask.h / 2;
    const oldW = S.mask.w;
    const rawW = Math.max(20, S.mask.w + step);
    const rawH = S.mask.h > 0 ? Math.max(20, Math.round(rawW * S.mask.h / S.mask.w)) : rawW;
    const snapped = _snapMaskSize(rawW, rawH);
    _syncZoomToMaskScale(oldW, snapped.w);
    S.mask.w = snapped.w;
    S.mask.h = snapped.h;
    S.mask.x = Math.round(cx - snapped.w / 2);
    S.mask.y = Math.round(cy - snapped.h / 2);
    _followTargetX = cx;
    _followTargetY = cy;
    _syncMaskSliders();
  };

  if (_followMode === 'anchor' || S.anchorHovered) {
    if (e.ctrlKey) doResize(); else doZoom();
  } else {
    if (e.ctrlKey) doZoom(); else doResize();
  }
}, { passive: false });

canvas.addEventListener('mouseleave', () => { S.maskHovered = false; S.anchorHovered = false; });

let _modalOpen = false;

document.addEventListener('mousemove', e => {
  if (_modalOpen) return;
  const p = canvasCoords(e);
  if (_followMode !== 'none') {
    _followTargetX = p.x;
    _followTargetY = p.y;
    if (_followMode === 'mask') {
      S.mask.x = Math.round(p.x - S.mask.w / 2);
      S.mask.y = Math.round(p.y - S.mask.h / 2);
      _syncOffsetSliders();
    }
    if (_followMode === 'anchor' && S.fgFixed) {
      const nx = Math.max(-1920, Math.min(1920, Math.round(p.x - canvas.width  / 2)));
      const ny = Math.max(-1080, Math.min(1080, Math.round(p.y - canvas.height / 2)));
      elFgPinX.value = nx; elFgPinY.value = ny;
      document.getElementById('fgPinXVal').value = nx;
      document.getElementById('fgPinYVal').value = ny;
      updateSliderFill(elFgPinX); updateSliderFill(elFgPinY);
    }
    S.maskHovered = false;
    return;
  }
  if (!S.drag.active) {
    const hh       = hitTestHandle(p.x, p.y);
    const inMask   = hitTestMask(p.x, p.y);
    const inAnchor = hitTestAnchor(p.x, p.y);
    S.maskHovered = !!(hh || inMask);
    S.anchorHovered = !!inAnchor;
    canvas.style.cursor = inAnchor ? 'grab' : (hh ? hh.cur : (inMask ? 'grab' : 'default'));
    return;
  }
  _canvasClickMoved = true;
  if (S.drag.mode === 'fg-anchor') {
    _applyAnchorDrag(p);
  } else if (S.drag.mode === 'move') {
    S.mask.x = Math.round(p.x - S.drag.ox);
    S.mask.y = Math.round(p.y - S.drag.oy);
    _syncOffsetSliders();
  } else {
    applyResize(S.drag.mode, p.x - S.drag.sp.x, p.y - S.drag.sp.y, e.shiftKey);
  }
});

document.addEventListener('mouseup', () => {
  if (S.drag.active) {
    S.drag.active = false; S.drag.mode = null; canvas.style.cursor = 'default';
    _syncOffsetSliders();
  }
});

canvas.addEventListener('touchstart', e => {
  const p = canvasCoords(e);
  if (hitTestHandle(p.x, p.y) || hitTestMask(p.x, p.y)) {
    S.maskTouched = true;
  } else {
    S.maskTouched = false;
  }
  startDrag(e, p);
}, { passive: false });

document.addEventListener('touchmove', e => {
  if (!S.drag.active) return;
  const p = canvasCoords(e);
  if (S.drag.mode === 'fg-anchor') {
    _applyAnchorDrag(p);
  } else if (S.drag.mode === 'move') {
    S.mask.x = Math.round(p.x - S.drag.ox);
    S.mask.y = Math.round(p.y - S.drag.oy);
    _syncOffsetSliders();
  } else {
    applyResize(S.drag.mode, p.x - S.drag.sp.x, p.y - S.drag.sp.y);
  }
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', () => { S.drag.active = false; S.drag.mode = null; _syncOffsetSliders(); });

// ============================================================
// ============================================================
function fmtTime(sec, forceHours = false) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h > 0 || forceHours)
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function updateProgress() {
  const refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration
               : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration : 0;
  if (!refDur) return;
  const pct = Math.min(1, Math.max(0, _compositeT / refDur));
  elProgressFill.style.width = `${pct * 100}%`;
  elProgressThumb.style.left = `${pct * 100}%`;
  const useHours = refDur >= 3600;
  elTimeLabel.textContent = `${fmtTime(Math.min(_compositeT, refDur), useHours)} / ${fmtTime(refDur, useHours)}`;
}

(function() {
  const track = document.getElementById('progressTrack');
  let seeking = false;

  function seek(e) {
    const r = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration
                 : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration : 0;
    if (!refDur) return;
    _compositeT = pct * refDur;
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
//  Page Visibility ? ���A�N�e�B�u���ɓ������~
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].pause(); });
  } else if (S.playing) {
    [0, 1].forEach(i => { if (loaded[i] && mediaType[i] === 'video') vid[i].play().catch(() => {}); });
  }
});

function applyLang(lang) {
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
  // HTML �R���e���c�i<br> �Ȃǂ̃^�O���܂ށj
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  // title ���� / �c�[���`�b�v
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  // innerHTML �Ńe�L�X�g���Z�b�g���铮�I�v�f
  const isNowDark = document.documentElement.dataset.theme === 'dark';
  document.getElementById('themeBtn').innerHTML =
    `<i data-lucide="${isNowDark ? 'moon' : 'sun'}"></i>`;
  document.getElementById('themeBtn').title = t(isNowDark ? 'mode-dark' : 'mode-light');
  const isTheater = document.querySelector('.app-body').classList.contains('theater');
  document.getElementById('theaterBtn').title = t(isTheater ? 'theater-close' : 'theater-open');
  const isFs = !!document.fullscreenElement;
  document.getElementById('fullscreenBtn').title = t(isFs ? 'fs-close' : 'fs-open');
  _updateArLockBtn();
  _hintStatePrev = ''; // �L���b�V���𖳌������ăq���g���ĕ`��
  _updateCanvasHints();
  if (_presetsReady) renderPresets();
  lucide.createIcons();
}

// ============================================================
// ============================================================
document.getElementById('themeBtn').addEventListener('click', () => {
  const html = document.documentElement;
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  _readCssVars(); // CSS�ϐ��L���b�V�����X�V
  document.getElementById('themeBtn').innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
  document.getElementById('themeBtn').title = t(isDark ? 'mode-light' : 'mode-dark');
  const bc = document.getElementById('borderColor');
  if (bc.value === '#ffffff' || bc.value === '#5c6370') {
    bc.value = '#ffffff';
  }
  lucide.createIcons();
});

function rebuildLangDialog() {
  const list = document.getElementById('langOptionList');
  list.innerHTML = '';
  let extCodes = [];
  try { extCodes = JSON.parse(localStorage.getItem('gf-ext-langs') || '[]').map(x => x.code); } catch (e) {}

  getRegisteredLangs().forEach(({ code, label }) => {
    const isExt = extCodes.includes(code);
    const btn = document.createElement('button');
    btn.className = 'lang-option-item' + (code === _lang ? ' active' : '');
    btn.innerHTML =
      `<span class="lang-option-check">${code === _lang ? '?' : ''}</span>` +
      `<span style="flex:1">${label}</span>` +
      (isExt ? `<span class="lang-option-del" title="�폜" data-code="${code}" style="margin-left:4px;opacity:0.5;font-size:12px;padding:0 4px;line-height:1">?</span>` : '');
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

// ============================================================
// ============================================================
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

  // Escape \u4e8c\u6bb5\u968e\u30af\u30ed\u30fc\u30ba\uff08textarea \u30d5\u30a9\u30fc\u30ab\u30b9\u4e2d\u3082\u52d5\u4f5c\uff09
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

// ============================================================
// ============================================================

function collectSettings() {
  return {
    vol0:          document.getElementById('vol0').value,
    offset0:       document.getElementById('offset0').value,
    vol1:          document.getElementById('vol1').value,
    offset1:       document.getElementById('offset1').value,
    maskX:         S.mask.x,
    maskY:         S.mask.y,
    maskW:         S.mask.w,
    maskH:         S.mask.h,
    bufW:          canvas.width,
    bufH:          canvas.height,
    maskShape:     S.mask.shape,
    arLock:        S.arLock,
    borderW:       elBorderW.value,
    borderOpacity: elBorderOpacity.value,
    borderColor:   elBorderColor.value,
    borderAnim:    elBorderAnim.value,
    borderAnimSpeed:  elBorderAnimSpeed.value,
    borderAnimBright: elBorderAnimBright.value,
    borderAnimColors: JSON.stringify(_animColors),
    maskBlur:    elMaskBlur.value,
    filterBlur:  elFilterBlur.value,
    maskPixel:   elMaskPixel.value,
    maskZoom:      elMaskZoom.value,
    fgFixed:       S.fgFixed,
    zoomLock:      S.zoomLock,
    fgPinX:        elFgPinX.value,
    fgPinY:        elFgPinY.value,
    fgPinLerp:     document.getElementById('fgPinLerp')?.value ?? '50',
    fgPinOpacity:  document.getElementById('fgPinOpacity')?.value ?? '100',
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
    vid0Name:      _loadedFileName[0],
    vid1Name:      _loadedFileName[1],
    vid0Url:       _loadedSrcUrl[0] || _loadedPageUrl[0],
    vid1Url:       _loadedSrcUrl[1] || _loadedPageUrl[1],
    phoneLandscape: _phoneLandscape,
    phoneShowRoT:   _phoneShowRoT,
    phoneShowRec:   _phoneShowRec,
    phoneShowDot:   _phoneShowDot,
  };
}

function applySettings(d) {
  const sliders = [
    ['vol0','vol0Val'],['offset0','offset0Val'],
    ['vol1','vol1Val'],['offset1','offset1Val'],
    ['maskW','maskWVal'],['maskH','maskHVal'],
    ['borderW','borderWVal'],['borderOpacity','borderOpacityVal'],['maskBlur','maskBlurVal'],
    ['filterBlur','filterBlurVal'],
    ['maskPixel','maskPixelVal'],
    ['filterBrightness','filterBrightnessVal'],['filterContrast','filterContrastVal'],
    ['filterHighlight','filterHighlightVal'],['filterShadow','filterShadowVal'],
    ['filterSaturation','filterSaturationVal'],['filterHue','filterHueVal'],
    ['filterTemp','filterTempVal'],['filterTint','filterTintVal'],['filterSharpness','filterSharpnessVal'],
    ['filterCA','filterCAVal'],['filterVignette','filterVignetteVal'],
    ['filterMatte','filterMatteVal'],['filterGrain','filterGrainVal'],
    ['filterFlare','filterFlareVal'],
    ['filterBars','filterBarsVal'],
    ['filterFps','filterFpsVal'],
    ['maskZoom','maskZoomVal'],
    ['fgPinX','fgPinXVal'],
    ['fgPinY','fgPinYVal'],
    ['fgPinLerp','fgPinLerpVal'],
    ['fgPinOpacity','fgPinOpacityVal'],
  ];
  const vals = {
    vol0: d.vol0, offset0: d.offset0,
    vol1: d.vol1, offset1: d.offset1,
    maskW: d.maskW, maskH: d.maskH,
    borderW: d.borderW, borderOpacity: d.borderOpacity, maskBlur: d.maskBlur ?? 0,
    filterBlur: d.filterBlur ?? 0,
    maskPixel: d.maskPixel ?? 0,
    filterBrightness: d.filterBrightness, filterContrast: d.filterContrast,
    filterHighlight: d.filterHighlight ?? 0, filterShadow: d.filterShadow ?? 0,
    filterSaturation: d.filterSaturation, filterHue: d.filterHue ?? 0,
    filterTemp: d.filterTemp, filterTint: d.filterTint ?? 0, filterSharpness: d.filterSharpness ?? 0,
    filterCA: d.filterCA, filterVignette: d.filterVignette,
    filterMatte: d.filterMatte, filterGrain: d.filterGrain,
    filterFlare: d.filterFlare,
    filterBars: d.filterBars,
    filterFps: d.filterFps ?? 0,
    maskZoom: d.maskZoom ?? '1',
    fgPinX: d.fgPinX ?? '0',
    fgPinY: d.fgPinY ?? '0',
    fgPinLerp: d.fgPinLerp ?? '50',
    fgPinOpacity: d.fgPinOpacity ?? '100',
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
  }
  if (d.maskShape) {
    S.mask.shape = d.maskShape;
    document.querySelectorAll('.shape-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.shape === d.maskShape);
    });
    elPhoneUiRow.style.display = d.maskShape === 'phone' ? '' : 'none';
    _updateFgFixedBtn();
  }
  if (d.phoneLandscape != null) {
    _phoneLandscape = !!d.phoneLandscape;
    elPhoneUiBtnRot90.classList.toggle('active', _phoneLandscape);
  }
  if (d.phoneShowRoT != null) {
    _phoneShowRoT = !!d.phoneShowRoT;
    elPhoneUiBtnRoT.classList.toggle('active', _phoneShowRoT);
  }
  if (d.phoneShowRec != null) {
    _phoneShowRec = !!d.phoneShowRec;
    elPhoneUiBtnRec.classList.toggle('active', _phoneShowRec);
  }
  if (d.phoneShowTC != null && d.phoneShowRec == null) {
    _phoneShowRec = !!d.phoneShowTC;
    elPhoneUiBtnRec.classList.toggle('active', _phoneShowRec);
  }
  if (d.phoneShowDot != null) {
    _phoneShowDot = !!d.phoneShowDot;
    elPhoneUiBtnDot.classList.toggle('active', _phoneShowDot);
  }
  // srcW/srcH �Ƀv���Z�b�g�ۑ����̃o�b�t�@�T�C�Y���L�^���A�قȂ��𑜓x�ł����m�ɕϊ��ł����悤�ɂ���
  if (d.maskW != null) {
    _pendingMask = {
      w: +d.maskW,
      h: +d.maskH,
      x: d.maskX != null ? +d.maskX : null,
      y: d.maskY != null ? +d.maskY : null,
      srcW: d.bufW ? +d.bufW : null,  // �ۑ����̃o�b�t�@�� (���v���Z�b�g�� null)
      srcH: d.bufH ? +d.bufH : null,
    };
    // bufW/bufH �������ΐ����� AR �ő����ɓK�p�A�Ȃ����Ό��o�b�t�@�Œ��ړK�p
    if (_bufferSynced) {
      if (d.bufW && d.bufH) {
        setCanvasAspectRatio(+d.bufW, +d.bufH); // _pendingMask �������ŏ������
      } else {
        _applyMaskFromPm(_pendingMask, canvas.width, canvas.height);
        _syncMaskSliders();
      }
    }
  }
  if (d.arLock != null) {
    S.arLock = !!d.arLock;
    _updateArLockBtn();
  }
  if (d.zoomLock != null) {
    S.zoomLock = !!d.zoomLock;
    _updateZoomLockBtn();
  }
  if (d.fgFixed != null) {
    S.fgFixed = !!d.fgFixed;
    _updateFgFixedBtn();
  }
  // theme �̓v���Z�b�g�Ɋ܂߂Ȃ��i���[�U�[�l�̐ݒ��Ƃ��ēƗ��Ǘ��j
  if (d.borderW != null && parseFloat(d.borderW) > 0) {
    _maskBorderFadeStart = loaded[1] ? performance.now() : 0;
  }
  updateCanvasFilter();
  updateBarsOverlay();
  const rAmt = parseInt(elFilterRain.value, 10);
  if (rAmt > 0 && !effectsHidden) _startRainOverlay(); else _stopRainOverlay();
}

function loadPresets() { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); }
function savePresets(list) { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); }

// HTML���ꕶ�����G�X�P�[�v����XSS���h��
function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- �t�@�C���ă����N�I���_�C�A���O�iPromise<'files'|'folder'|null>�j ----
// ---- �t�H���_�n���h�������t�@�C������ FileHandle ���擾�i���W���[�����x���j ----
async function _tryFromFolder(dirHandle, filename) {
  try {
    const fh = await dirHandle.getFileHandle(filename);
    const perm = await fh.queryPermission({ mode: 'read' });
    if (perm === 'granted' || await fh.requestPermission({ mode: 'read' }) === 'granted') return fh;
  } catch {}
  return null;
}

// ---- �t�@�C���ă����N�_�C�A���O�i�X���b�g���ƂɃt�@�C���I���E�t�H���_�I���ED&D�j ----
// slots: �������K�v�ȃX���b�g�ԍ��̔z��, slotNames: {si: expectedName}, startHint: FileSystemFileHandle
function _showFileResolveDialog(slots, slotNames, startHint, preResolvedMap = new Map()) {
  return new Promise(resolve => {
    _modalOpen = true;
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

    const _ACCEPT = [{ description: '���� / �摜', accept: { 'video/*': ['.mp4','.webm','.mov','.mkv'], 'image/*': ['.jpg','.jpeg','.png','.gif','.webp','.avif'] } }];
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
      const selLine = null;
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
      delBtn.textContent = '?';

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
            if (pickedMap.has(otherSi)) continue; // ���łɉ����ς�
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
        if (zone.querySelector('.gf-rzone-mismatch')) return; // �~�X�}�b�`�m�F���̓t�@�C���s�b�J�[�s��
        try {
          const [fh] = await window.showOpenFilePicker({ types: _ACCEPT, multiple: false, ...(_hint ? { startIn: _hint } : {}) });
          const file = await fh.getFile();
          _hint = fh; _IDB.set('gf_folder_hint', fh).catch(() => {});
          _setResolved(si, fh, file.name);
        } catch {}
      });

      lucide.createIcons({ nodes: [iconEl] }); // DOM�ǉ��O�͉��Ăяo���i���ōČĂяo���j
      slotState[si] = { zone, expectedName };
      if (preResolvedMap.has(si)) {
        const { fh, name } = preResolvedMap.get(si);
        _setResolvedFinal(si, fh, name); // IDB�ς݃X���b�g�̓~�X�}�b�`�ă`�F�b�N�s�v
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
    lucide.createIcons({ nodes: [overlay] }); // DOM�ǉ����Ɉꊇ�`��

    const _close = res => { overlay.remove(); document.removeEventListener('keydown', _onKey); _modalOpen = false; resolve(res); };
    cancelBtn.addEventListener('click', () => _close(null));
    okBtn.addEventListener('click', () => _close(pickedMap));
    overlay.addEventListener('click', e => { if (e.target === overlay) _close(null); });
    const _onKey = e => { if (e.key === 'Escape') _close(null); };
    document.addEventListener('keydown', _onKey);
  });
}

function _showDelPopup(anchorBtn, msg, onConfirm, okClass) {
  document.querySelectorAll('.preset-del-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'preset-del-popup';
  const msgEl = document.createElement('span');
  msgEl.className = 'preset-del-popup-msg';
  msgEl.textContent = msg;
  const btnRow = document.createElement('div');
  btnRow.className = 'preset-del-popup-btns';
  const okBtn = document.createElement('button');
  okBtn.className = 'preset-del-popup-ok' + (okClass ? ' ' + okClass : '');
  okBtn.textContent = t(okClass === 'preset-del-popup-ok--save' ? 'preset-save-confirm-btn' : 'del-confirm-btn');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'preset-del-popup-cancel';
  cancelBtn.textContent = t('del-cancel-btn');
  btnRow.append(okBtn, cancelBtn);
  popup.append(msgEl, btnRow);
  document.body.appendChild(popup);
  const rect = anchorBtn.getBoundingClientRect();
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = rect.right - pw;
  let top = rect.bottom + 4;
  if (left < 4) left = 4;
  if (top + ph > window.innerHeight - 4) top = rect.top - ph - 4;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  const close = () => popup.remove();
  okBtn.addEventListener('click', e => { e.stopPropagation(); close(); onConfirm(); });
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); close(); });
  setTimeout(() => {
    const outside = e => { if (!popup.contains(e.target)) { close(); document.removeEventListener('click', outside, true); } };
    document.addEventListener('click', outside, true);
  }, 0);
}

function renderPresets() {
  const list = loadPresets();
  const el = document.getElementById('presetList');

  // ---- �w���p�[: �C�ӂ̖��O�v�f�̃C�����C�����O�ύX ----
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

  // ---- ���X�g�����[�g�A�C�e���ƃt�H���_�Z�N�V�����ɕ��� ----
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
  // rootInsertIdx: ���[�g�A�C�e�����}�������ʒu�ifirstFolderIdx�̒��O = ���[�g�����j
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

  folderSections.forEach(({ folder, folderIdx, children }, fi) => {
    const countBadge = ``;
    html += dz(folderIdx);
    html += `<div class="preset-folder" data-idx="${folderIdx}">
      <div class="preset-folder-header" data-idx="${folderIdx}">
        <span class="preset-drag-handle"><i data-lucide="grip-vertical"></i></span>
        <span class="preset-folder-toggle"><i data-lucide="${folder.open !== false ? 'chevron-down' : 'chevron-right'}"></i></span>
        <span class="preset-folder-name"><span class="pname-inner">${_esc(folder.name)}</span></span>
        ${countBadge}
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

  // ---- �v���Z�b�g���z�o�[�X���C�h ----
  setTimeout(() => {
    requestAnimationFrame(() => {
      el.querySelectorAll('.preset-item, .preset-folder-header').forEach(item => {
        _calcOverflows(item);
        item.addEventListener('mouseenter', () => _calcOverflows(item));
      });
    });
  }, 0);

  // ---- Folder toggle (header�S�̃N���b�N�ŊJ�A�{�^���͏��O) ----
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

  // ---- �v���Z�b�g�N���b�N�œǂݍ��� ----
  el.querySelectorAll('.preset-item-info').forEach(info => {
    info.addEventListener('click', async e => {
      if (e.target.closest('[contenteditable]:not([contenteditable="false"])')) return;
      const idx = +info.dataset.idx;
      const p = loadPresets()[idx];
      if (!p || p.type === 'folder') return;
      syncStop();
      applySettings(p.data);
      _activePresetIdx = idx;
      _f2Target = { type: 'preset', idx };
      renderPresets();
      loaded[0] = false; loaded[1] = false;
      _stopBitmapCapture(0); _stopBitmapCapture(1);
      _maskBorderFadeStart = 0;
      _fgFadeStart = 0;
      let needsRender = false;
      let vid1HasSource = false;

      // ---- ���[�J���t�@�C�������X���b�g���ꊇ�s�b�N�i�ő�1���̑����ŗ��X���b�g�����j ----
      // IDB �����K�v�ȏ��������ׂă��[�U�[�����O�Ɏ擾�i�W�F�X�`���[�������h���j
      const [_idbHandles, _startHint, _folderHandle] = await Promise.all([
        Promise.all([0, 1].map(si =>
          p.data.presetId ? _IDB.get(`preset_${p.data.presetId}_${si}`).catch(() => null) : Promise.resolve(null)
        )),
        _IDB.get('gf_folder_hint').catch(() => null),
        _IDB.get('gf_folder_handle').catch(() => null),
      ]);
      // IDB �n���h���Ȃ��EURL �Ȃ��E�t�@�C�������� �� �s�b�J�[���K�v�ȃX���b�g
      const _slotsLocal    = [0, 1].filter(si => !p.data[`vid${si}Url`] && !!p.data[`vid${si}Name`]);
      const _slotsNeedPick = _slotsLocal.filter(si => !_idbHandles[si]);
      const _prePickedHandles = new Map(); // slot index -> FileSystemFileHandle
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

      // IDB �Ō������Ă����X���b�g���_�C�A���O�O�ɐ��s���[�h�i�v���C���[�ɑ��\���j
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
          loaded_ok = _preLoadOk.get(i); // ���s���[�h�ς�
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
              // presetId ���Ȃ����ΐV�K���s
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
          if (_mkey && _resolvedFiles.has(_mkey)) {} // already tracked
          if (i === 1) vid1HasSource = true;
        }
        if (loaded_ok && i === 1) vid1HasSource = true;
      }
      // vid1 ���Ȃ��ꍇ�݂̂����Řg�t�F�[�h�C���J�n�ivid1 �������ꍇ�� onloadedmetadata �Ɠ����ɊJ�n�j
      if (!vid1HasSource && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
      // vid1 �\�[�X���Ȃ��ꍇ�̓��[�h�҂����Ԃ������i�g�E�q���g�𑦕\���j
      if (!vid1HasSource) _fgFadeStart = -1;
      if (needsRender) renderPresets();
    });
  });

  // ---- �ۑ� / �㏑�� ----
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

  // ---- ���O�ύX�i�v���Z�b�g & �t�H���_�j----
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

  // ---- ���L�i�v���Z�b�g & �t�H���_�j----
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
        const folderHeader = 'gff~' + encodeURIComponent(p.name || '�t�H���_');
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

  // ---- �폜�i�v���Z�b�g & �t�H���_�j----
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
          _activePresetIdx = null;
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
    const items = document.querySelectorAll('.preset-item');
    // data-idx�őΉ������{�^���������A�C�e��������
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
let _f2Target = null; // { type: 'folder'|'preset', idx: number }
document.getElementById('presetList').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return; // �{�^���N���b�N�̓X�L�b�v
  const header = e.target.closest('.preset-folder-header');
  const item   = e.target.closest('.preset-item');
  if (header) _f2Target = { type: 'folder', idx: +header.dataset.idx };
  else if (item) _f2Target = { type: 'preset', idx: +item.dataset.idx };
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

const _doInlineImport = async (rawOverride) => {
  const inp = document.getElementById('presetCodeInput');
  // rawOverride ���������łȂ��ꍇ�iEvent�I�u�W�F�N�g���j�� inp.value ���g�p
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
        folderName = folderName || '�t�H���_';
        const presetLines = allLines.filter(_isGfCode);
        const decoded = [];
        for (const l of presetLines) {
          try { decoded.push(await _presetDecodeOne(l)); } catch (e) { console.error('[folder import] skip line:', JSON.stringify(l), e); }
        }
        arr = [{ type: 'folder', name: folderName, open: true }, ...decoded];
      } else {
        // gff~ ���������Ȃ��ꍇ�͒ʏ��̃C���|�[�g�Ƀt�H�[���o�b�N
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
        toInsert.push({ type: 'folder', name: p.name || '�t�H���_', open: p.open !== false });
        added++;
        return;
      }
      if (!p?.data) return;
      toInsert.push({ name: p.name || `�C���|�[�g ${toInsert.length + 1}`, data: p.data });
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

// ---- JSON / gf~ �R�[�h D&D �� �v���Z�b�g�J�[�h�S�̂Ŏ��t ----
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
    if (_isDraggingPreset) return; // �v���Z�b�g���ёւ����͖���
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
  card.addEventListener('dragover', e => {
    if (_isDraggingPreset || !_isJsonDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!_dndActive) _enter();
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
    if (!files.length && !hasText) return; // �����h���b�v���͖���
    e.preventDefault();
    e.stopPropagation(); // canvasWrap�ւ̓`�d���h��
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

_presetsReady = true;
renderPresets();

// IDB �ǂݎ������������s���č�����
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

// ============================================================
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
  return {name: name || '�C���|�[�g', data};
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
    if (p.type === 'folder') return { type: 'folder', name: p.name || '�t�H���_', open: p.open !== false };
    const d={...p.data};
    if(d.vid0Id){d.vid0Url=_iwaraUrl(d.vid0Id);d.vid0Name=d.vid0Name||d.vid0Id;delete d.vid0Id;}
    if(d.vid1Id){d.vid1Url=_iwaraUrl(d.vid1Id);d.vid1Name=d.vid1Name||d.vid1Id;delete d.vid1Id;}
    return {name:p.name,data:d};
  });
}

// ============================================================
// ============================================================
const _presetShareStatus = document.getElementById('presetShareStatus');
let _presetStatusTimer = null;
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
      // file:// �v���g�R���p�t�H�[���o�b�N
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
// ============================================================
const appBody    = document.querySelector('.app-body');
const panel      = document.querySelector('.panel');
const theaterBtn = document.getElementById('theaterBtn');
const fsBtn      = document.getElementById('fullscreenBtn');

// ---- �X�N���[���V���b�g�ۑ� ----
document.getElementById('resyncBtn').addEventListener('click', async () => {
  await _applyCompositeT(_compositeT);
  if (!S.playing && 'createImageBitmap' in window) {
    await Promise.all([0, 1].map(async i => {
      if (!loaded[i] || mediaType[i] !== 'video') return;
      try {
        const bmp = await createImageBitmap(vid[i]);
        if (_vidBitmap[i]) _vidBitmap[i].close();
        _vidBitmap[i] = bmp;
      } catch (e) {}
    }));
  }
});

document.getElementById('screenshotBtn').addEventListener('click', () => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `gentleman-frame_${ts}.png`;
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

function setTheater(enable) {
  appBody.classList.toggle('theater', enable);
  panel.classList.toggle('collapsed', enable);
  theaterBtn.innerHTML = enable
    ? '<i data-lucide="panel-right-open"></i>'
    : '<i data-lucide="panel-right-close"></i>';
  theaterBtn.title = t(enable ? 'theater-close' : 'theater-open');
  lucide.createIcons();
}

theaterBtn.addEventListener('click', () => {
  setTheater(!appBody.classList.contains('theater'));
});

let _wasTheaterBeforeFs = false;

fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    _wasTheaterBeforeFs = appBody.classList.contains('theater');
    const target = document.getElementById('canvasWrap');
    (target.requestFullscreen || target.webkitRequestFullscreen || (() => {})).call(target).catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

const _fsWrap = document.getElementById('canvasWrap');
let _fsIdleTimer = null;
let _fsIsIdle = false;

function _setFsIdle(idle) {
  if (_fsIsIdle === idle) return; // ���ԕω��Ȃ� �� DOM ���G���Ȃ�
  _fsIsIdle = idle;
  _fsWrap.classList.toggle('fs-idle', idle);
}
function _resetFsIdle() {
  _setFsIdle(false);
  clearTimeout(_fsIdleTimer);
  if (document.fullscreenElement) {
    _fsIdleTimer = setTimeout(() => _setFsIdle(true), 3000);
  }
}
_fsWrap.addEventListener('mousemove', (e) => {
  // Chrome �̏I���o�u���͖� 60-80px�A�]�T�������� 100px ���f�b�h�]�[���Ƃ���
  if (e.clientY < 100) return;
  _resetFsIdle();
});
_fsWrap.addEventListener('mousedown', _resetFsIdle);

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  fsBtn.innerHTML = isFs ? '<i data-lucide="minimize"></i>' : '<i data-lucide="maximize"></i>';
  fsBtn.title = t(isFs ? 'fs-close' : 'fs-open');
  theaterBtn.style.display = isFs ? 'none' : '';
  if (!isFs) {
    setTheater(_wasTheaterBeforeFs);
    clearTimeout(_fsIdleTimer);
    _setFsIdle(false);
  } else {
    _resetFsIdle();
  }
  lucide.createIcons();
});

document.getElementById('canvasWrap').addEventListener('dblclick', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    _wasTheaterBeforeFs = appBody.classList.contains('theater');
    const target = document.getElementById('canvasWrap');
    (target.requestFullscreen || target.webkitRequestFullscreen || (() => {})).call(target).catch(() => {});
  }
});

// ---- Card collapse (�J�[�h�܂肽����) ----
(function () {
  const STORAGE_KEY = 'gf-card-collapsed';
  const getSaved = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) { return {}; } };
  const saved = getSaved();
  document.querySelectorAll('.card[data-card-id]').forEach(card => {
    const id = card.dataset.cardId;
    const titleEl = card.querySelector('.card-title');
    if (!titleEl) return;
    const updateIcon = (collapsed) => {};
    if (saved[id]) {
      card.classList.add('card--collapsed');
      updateIcon(true);
    }
    titleEl.addEventListener('click', e => {
      if (!e.target.closest('.card-title-label')) return;
      const isCollapsed = card.classList.toggle('card--collapsed');
      updateIcon(isCollapsed);
      if (isCollapsed) {
        card.querySelectorAll('.drop-zone.loaded').forEach(z => {
          z.style.animation = 'none';
        });
      }
      const state = getSaved();
      if (isCollapsed) state[id] = true; else delete state[id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    });
  });
})();

lucide.createIcons();
