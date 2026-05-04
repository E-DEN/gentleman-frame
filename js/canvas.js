// canvas.js — キャンバス・DOM要素・共有ユーティリティ
import { state } from './state.js';
import { _glassesInitSize } from './render.js';

// ============================================================
//  ファイルハンドル（File System Access API + IndexedDB）
// ============================================================
export const _currentHandle  = [null, null];
export const _loadedFileName = ['', ''];
export const _loadedPageUrl  = ['', '']; // Iwara等ページURLを記憶（リンク表示用）
export const _loadedSrcUrl   = ['', '']; // 実際にロードしたURL（プリセット復元用）

export const _IDB = (() => {
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
//  ハンドル
// ============================================================
export const HANDLE_SZ = 3; // canvas座標の半サイズ

export function getHandles(m) {
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
//  動画 / 画像 要素
// ============================================================
export const vid = [document.createElement('video'), document.createElement('video')];
export const img = [document.createElement('img'), document.createElement('img')];
export const mediaType = ['video', 'video']; // 'video' | 'image'

// requestVideoFrameCallback で各フレームを ImageBitmap にスナップショット。
// render ループはライブな video テクスチャではなくこの bitmap から描画する。
// → GPU overlay demotion 時の drawImage(video) ブロッキングを回避。
export const _vidBitmap = [null, null];
export const _vidBitmapPending = [false, false];
export function _startBitmapCapture(i) {
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

export function _stopBitmapCapture(i) {
  if (_vidBitmap[i]) { _vidBitmap[i].close(); _vidBitmap[i] = null; }

}

export function getMediaSrc(i) {
  if (mediaType[i] === 'image') return img[i];
  return (_vidBitmap[i]) ? _vidBitmap[i] : vid[i];
}

export const loaded = [false, false];
export const visHidden = [false, false];
export let maskHidden = false;
export let effectsHidden = false;

vid.forEach(v => {
  v.loop = false;
  v.playsInline = true;
  v.preload = 'auto';
});

// ============================================================
//  Canvas + オフスクリーン
// ============================================================
export const canvas  = document.getElementById('mainCanvas');
export const displayCtx = canvas.getContext('2d');
// 描画は renderCvs (desynchronized) で行い、rAF 末尾に displayCtx へ1回ブリット。
// → レンダリングはコンポジターのGPUキュー競合に影響されない (スタッタリング回避)。
// → 表示側は vsync aligned な rAF でブリットするのでテアリングなし。
export const renderCvs = document.createElement('canvas');
renderCvs.width  = canvas.width;
renderCvs.height = canvas.height;
export const ctx     = renderCvs.getContext('2d', { desynchronized: true });
export const canvasWrap     = document.getElementById('canvasWrap');
export const effectsWrap    = document.getElementById('effectsWrap');
export const svgGblurEl     = document.getElementById('svgGblur');
export const maskDropOverlay = document.getElementById('maskDropOverlay');
// anchorCanvas: CSS mix-blend-mode:difference で映像のみとネガポジ反転合成
// z-index:4 = overlayCanvas(枠)より下なので枠の色を巻き込まない
export const anchorCanvas   = document.getElementById('anchorCanvas');
export const anchorCtx      = anchorCanvas.getContext('2d');
// overlayCanvas: effectsWrap 外側に配置 → CSS filter (hue-rotate 等) の影響を受けない
// 枠・リサイズハンドル・スマホ枠をここに描画
export const overlayCanvas  = document.getElementById('overlayCanvas');
export const overlayCtx     = overlayCanvas.getContext('2d');
export let _dispW = canvas.width;   // Canvas CSSピクセル表示サイズ
export let _dispH = canvas.height;

// 前景合成用オフスクリーンキャンバス（初期化時に1度だけ生成）
export const offCvs  = document.createElement('canvas');
offCvs.width  = canvas.width;
offCvs.height = canvas.height;
export const offCtx  = offCvs.getContext('2d');

// ポストプロセス用オフスクリーンキャンバス（色収差など）
export const postCvs = document.createElement('canvas');
postCvs.width  = canvas.width;
postCvs.height = canvas.height;
export const postCtx  = postCvs.getContext('2d');
export const chCvs = document.createElement('canvas');
chCvs.width  = canvas.width;
chCvs.height = canvas.height;
export const chCtx  = chCvs.getContext('2d');
export const caCvs = document.createElement('canvas');
caCvs.width  = canvas.width;
caCvs.height = canvas.height;
export const caCtx  = caCvs.getContext('2d');
// モーションブラー用バッファ
export let _mblurCvs = document.createElement('canvas');
_mblurCvs.width  = canvas.width;
_mblurCvs.height = canvas.height;
export let _mblurCtx = _mblurCvs.getContext('2d');

// グレイン用オフスクリーンキャンバス（固定 256×256 タイル）
export const grainCvs = document.createElement('canvas');
grainCvs.width = 256; grainCvs.height = 256;
export const grainCtx = grainCvs.getContext('2d');

// Canvas バッファ解像度を CSS 表示サイズに同期してアップスケール時のぼかしを防ぐ
export let _canvasAR = 1920 / 1080; // 現在のアスペクト比
export let _prevBufW = 1920, _prevBufH = 1080; // バッファ変更前のサイズ（マスク比率スケール用）

// CSS変数キャッシュ (getComputedStyleを毎フレーム呼ばないため)
export let _cachedAccent = '';
export let _cachedBg = '';
export let _maskOverlayCache = { left: '', top: '', width: '', height: '', borderRadius: '' };
export function _readCssVars() {
  const s = getComputedStyle(document.documentElement);
  _cachedAccent = s.getPropertyValue('--accent').trim();
  _cachedBg = s.getPropertyValue('--bg').trim() || '#080810';
}
_readCssVars();

// _syncMaskSliders / _syncOffsetSliders で使うため DOM キャッシュブロックより先に宣言
export const elMaskW    = document.getElementById('maskW');
export const elMaskH    = document.getElementById('maskH');
export const elMaskOffX = document.getElementById('maskOffX');
export const elMaskOffY = document.getElementById('maskOffY');
export const elMaskZoom = document.getElementById('maskZoom');

export function _syncAllBuffers(w, h) {
  canvas.width  = w; canvas.height = h;
  renderCvs.width = w; renderCvs.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
  anchorCanvas.width  = w; anchorCanvas.height  = h;
  offCvs.width  = w; offCvs.height = h;
  postCvs.width = w; postCvs.height = h;
  chCvs.width   = w; chCvs.height  = h;
  caCvs.width   = w; caCvs.height  = h;
  if (_mblurCvs) { _mblurCvs.width = w; _mblurCvs.height = h; }
}

export function _syncMaskSliders() {
  // W と H は固定レンジ [10, 790] → 400 がスライダーの中央になる。
  // 790 超の値はキャンバス上のドラッグで設定可能。テキスト欄は実際値を表示。
  elMaskW.value = Math.min(Math.round(state.mask.w), +elMaskW.max);
  elMaskH.value = Math.min(Math.round(state.mask.h), +elMaskH.max);
  document.getElementById('maskWVal').value = Math.round(state.mask.w);
  document.getElementById('maskHVal').value = Math.round(state.mask.h);
  updateSliderFill(elMaskW);
  updateSliderFill(elMaskH);
  _syncOffsetSliders();
}

export function _syncOffsetSliders() {
  const cw = canvas.width, ch = canvas.height;
  const cx = Math.round((cw - state.mask.w) / 2);
  const cy = Math.round((ch - state.mask.h) / 2);
  const offX = state.mask.x - cx;
  const offY = state.mask.y - cy;
  const halfW = Math.floor(cw / 2);
  const halfH = Math.floor(ch / 2);
  elMaskOffX.min = -halfW; elMaskOffX.max = halfW; elMaskOffX.value = offX;
  elMaskOffY.min = -halfH; elMaskOffY.max = halfH; elMaskOffY.value = offY;
  document.getElementById('maskOffXVal').value = offX;
  document.getElementById('maskOffYVal').value = offY;
  updateSliderFill(elMaskOffX);
  updateSliderFill(elMaskOffY);
}

// pending マスク設定をバッファ座標に変換して適用
export function _applyMaskFromPm(pm, cw, ch) {
  if (!pm || !pm.srcW || !pm.srcH || pm.x == null) return false;
  const sx = cw / pm.srcW, sy = ch / pm.srcH;
  state.mask.w = Math.max(1, Math.min(Math.round(pm.w * sx), cw));
  state.mask.h = Math.max(1, Math.min(Math.round(pm.h * sy), ch));
  state.mask.x = Math.max(0, Math.min(Math.round(pm.x * sx), cw - state.mask.w));
  state.mask.y = Math.max(0, Math.min(Math.round(pm.y * sy), ch - state.mask.h));
  return true;
}

export function setCanvasAspectRatio(w, h) {
  if (!w || !h) return;
  const prevAR = _canvasAR;
  _canvasAR = w / h;
  canvasWrap.style.setProperty('--ar', `${w}/${h}`);

  const arChangedBig = _canvasInitialized && Math.abs(prevAR - _canvasAR) / Math.max(prevAR, _canvasAR) > 0.1;

  _syncAllBuffers(w, h);

  if (!_canvasInitialized || arChangedBig || _pendingMask) {
    // 初回 or AR 大幅変化: pending があればそちら、なければデフォルト中央
    _canvasInitialized = true;
    const pm = _pendingMask;
    _pendingMask = null;
    if (!_applyMaskFromPm(pm, w, h)) {
      if (state.mask.shape === 'phone') {
        const targetW = 360, targetH = 780;
        let newW = Math.min(targetW, w);
        let newH = Math.round(newW * targetH / targetW);
        if (newH > h) { newH = h; newW = Math.round(newH * targetW / targetH); }
        state.mask.w = newW; state.mask.h = newH;
      } else if (state.mask.shape === 'glasses') {
        const _gs = _glassesInitSize(w, h);
        state.mask.w = _gs.w; state.mask.h = _gs.h;
      } else {
        state.mask.w = Math.min(400, w);
        state.mask.h = Math.min(400, h);
      }
      state.mask.x = Math.round((w - state.mask.w) / 2);
      state.mask.y = Math.round((h - state.mask.h) / 2);
    }
  } else {
    // 動画解像度変化: 比率を維持してマスクをスケール
    const sx = w / _prevBufW;
    const sy = h / _prevBufH;
    state.mask.x = Math.round(state.mask.x * sx);
    state.mask.y = Math.round(state.mask.y * sy);
    state.mask.w = Math.round(state.mask.w * sx);
    state.mask.h = Math.round(state.mask.h * sy);
  }
  _prevBufW = w;
  _prevBufH = h;
  _syncMaskSliders();
}

export let _canvasInitialized = false; // setCanvasAspectRatio が一度でも呼ばれたか（動画ロード済みフラグ）
export let _bufferSynced      = false; // 初回CSS表示サイズへのバッファ同期済みか
export let _pendingMask = null; // applySettings から設定。次回 setCanvasAspectRatio で適用される
export function setPendingMask(v) { _pendingMask = v; }
export let _activePresetIdx = null; // 現在適用中のプリセットのインデックス
export const _missingFiles  = new Set(); // 「presetId_slot」形式: このセッションでファイル未発見だったスロット
export const _resolvedFiles = new Set(); // 「presetId_slot」形式: このセッションでファイルロード成功したスロット
export const _pendingFiles  = new Set(); // 「presetId_slot」形式: ダイアログで未選択のままOKしたスロット
export let _shiftHeld = false; // Shift押下状態（削除ボタンアイコン切り替え用）
export const _setDelBtnIcon = (btn, icon) => {
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

// 初回同期: バッファ解像度はFHD(1920x1080)固定。CSS表示サイズは _dispW/_dispH で追跡。
export function initCanvasUI() {
  const r = canvas.getBoundingClientRect();
  const iw = Math.round(r.width), ih = Math.round(r.height);
  const BUF_W = 1920, BUF_H = 1080;
  _syncAllBuffers(BUF_W, BUF_H);
  _prevBufW = BUF_W; _prevBufH = BUF_H;
  if (iw > 0) { _dispW = iw; _dispH = Math.round(iw / _canvasAR); }
  if (state.mask.shape === 'phone') {
    const _tW = 360, _tH = 780;
    let _mw = Math.min(_tW, BUF_W);
    let _mh = Math.round(_mw * _tH / _tW);
    if (_mh > BUF_H) { _mh = BUF_H; _mw = Math.round(_mh * _tW / _tH); }
    state.mask.w = _mw; state.mask.h = _mh;
    state.arLock = true;
  } else if (state.mask.shape === 'glasses') {
    const _gs = _glassesInitSize(BUF_W, BUF_H);
    state.mask.w = _gs.w; state.mask.h = _gs.h;
    state.arLock = true;
  } else {
    state.mask.w = Math.min(400, BUF_W); state.mask.h = Math.min(400, BUF_H);
  }
  state.mask.x = Math.round((BUF_W - state.mask.w) / 2);
  state.mask.y = Math.round((BUF_H - state.mask.h) / 2);
  _bufferSynced = true;
  _syncMaskSliders();
  document.getElementById('phoneUiRow').style.display = state.mask.shape === 'phone' ? '' : 'none';
  const _isGlasses = state.mask.shape === 'glasses';
  document.getElementById('glassesUiRow').style.display = _isGlasses ? '' : 'none';
  const _isFrameShape = state.mask.shape === 'phone' || _isGlasses;
  document.getElementById('frameBlurRow').style.display = _isFrameShape ? '' : 'none';
  document.getElementById('frameTintRow').style.display = _isFrameShape ? '' : 'none';
  if (_isGlasses) {
    const _gsi = state.mask.glassesStyle || 0;
    document.querySelectorAll('.glasses-ui-btn[data-gstyle]').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.gstyle) === _gsi));
  }
  _updateArLockBtn();
  _updateFgFixedBtn();
}

// ResizeObserver: _dispW/_dispH の追跡のみ。バッファ・マスクは変更しない。
// 動画ロード前後・ズーム変更・ウィンドウリサイズのいずれでも値を固定。
new ResizeObserver(entries => {
  const w = Math.round(entries[0].contentRect.width);
  if (!w) return;
  _dispW = w;
  _dispH = Math.round(w / _canvasAR);
  if (_bufferSynced) return; // 初回同期済みなら何もしない
  // フォールバック: getBoundingClientRect が 0 だった極稀なケース
  const h = _dispH;
  const BUF_W = 1920, BUF_H = 1080;
  _syncAllBuffers(BUF_W, BUF_H);
  _prevBufW = BUF_W; _prevBufH = BUF_H;
  if (state.mask.shape === 'phone') {
    const _tW = 360, _tH = 780;
    let _mw = Math.min(_tW, BUF_W);
    let _mh = Math.round(_mw * _tH / _tW);
    if (_mh > BUF_H) { _mh = BUF_H; _mw = Math.round(_mh * _tW / _tH); }
    state.mask.w = _mw; state.mask.h = _mh;
    state.arLock = true;
  } else if (state.mask.shape === 'glasses') {
    const _gs = _glassesInitSize(BUF_W, BUF_H);
    state.mask.w = _gs.w; state.mask.h = _gs.h;
    state.arLock = true;
  } else {
    state.mask.w = Math.min(400, BUF_W); state.mask.h = Math.min(400, BUF_H);
  }
  state.mask.x = Math.round((BUF_W - state.mask.w) / 2);
  state.mask.y = Math.round((BUF_H - state.mask.h) / 2);
  _bufferSynced = true;
  _syncMaskSliders();
  _updateArLockBtn();
  _updateFgFixedBtn();
}).observe(canvas);

// 頻繁に参照する DOM 要素をキャッシュ
export const elBorderW = document.getElementById('borderW');
export const elBorderColor = document.getElementById('borderColor');
export const elBorderOpacity = document.getElementById('borderOpacity');
export const elBorderAnim = document.getElementById('borderAnim');
export const elBorderAnimSpeed = document.getElementById('borderAnimSpeed');
export const elBorderAnimBright = document.getElementById('borderAnimBright');
export const elFrameBlur  = document.getElementById('frameBlur');
export const elFrameTint  = document.getElementById('frameTint');
export const elPhoneUiRow = document.getElementById('phoneUiRow');
export const elGlassesUiRow = document.getElementById('glassesUiRow');
export const elSpectrumUiRow = document.getElementById('spectrumUiRow');
export const elSpecBars = document.getElementById('specBars');
export const elSpecAmp  = document.getElementById('specAmp');
export const elSpecGap  = document.getElementById('specGap');
export const elSpecSmooth = document.getElementById('specSmooth');
export const elGlassesStyleBtns = Array.from(document.querySelectorAll('.glasses-ui-btn[data-gstyle]'));
export const elPhoneUiBtnRoT = document.getElementById('phoneUiRoT');
export const elPhoneUiBtnRec = document.getElementById('phoneUiRec');
export const elPhoneUiBtnDot = document.getElementById('phoneUiDot');
export const elPhoneUiBtnRot90 = document.getElementById('phoneUiRot90');
export const elVol0    = document.getElementById('vol0');
export const elVol1    = document.getElementById('vol1');
export const elOffset0 = document.getElementById('offset0');
export const elOffset1 = document.getElementById('offset1');
export const elFgPinX       = document.getElementById('fgPinX');
export const elFgPinY       = document.getElementById('fgPinY');
export const elFgPinLerp    = document.getElementById('fgPinLerp');
export const elFgPinOpacity = document.getElementById('fgPinOpacity');
export const elFilterBlur = document.getElementById('filterBlur');
export const elFilterBrightness = document.getElementById('filterBrightness');
export const elFilterContrast = document.getElementById('filterContrast');
export const elFilterSaturation = document.getElementById('filterSaturation');
export const elFilterHue = document.getElementById('filterHue');
export const elFilterVignette = document.getElementById('filterVignette');
export const elFilterCA = document.getElementById('filterCA');
export const elFilterTemp = document.getElementById('filterTemp');
export const elFilterTint = document.getElementById('filterTint');
export const elFilterHighlight = document.getElementById('filterHighlight');
export const elFilterShadow = document.getElementById('filterShadow');
export const elFilterSharpness = document.getElementById('filterSharpness');
export const elFilterMatte = document.getElementById('filterMatte');
export const elFilterGrain = document.getElementById('filterGrain');
export const elMaskPixel = document.getElementById('maskPixel');
export const elMaskBlur  = document.getElementById('maskBlur');
export const elFilterFlare = document.getElementById('filterFlare');
export const elFilterBars = document.getElementById('filterBars');
export const elFilterFps = document.getElementById('filterFps');
export const elFilterRain = document.getElementById('filterRain');
export const elRainSpeed = document.getElementById('rainSpeed');
export const elRainRefraction = document.getElementById('rainRefraction');
export const elRainShadow = document.getElementById('rainShadow');
export const elProgressFill = document.getElementById('progressFill');
export const elProgressThumb = document.getElementById('progressThumb');
export const elTimeLabel = document.getElementById('timeLabel');
export const elPlayBtn = document.getElementById('playBtn');

export let _playDelayTimers = [];
export let _compositeT = 0;
export let _compositeLastRaf = null;
export let _compositeSeekPending = false;
export let _resyncTimer = null;
export let _autoResyncEnabled = false;
export let _autoResyncInterval = null;
// マスク枠フェードイン: -1=即全表示, 0=動画待ち, >0=フェード開始timestamp
export let _maskBorderFadeStart = -1;
export let _lastBufScale = 1;
export let _lastFgAlpha  = 1;
export function setLastBufScale(v) { _lastBufScale = v; }
export function setLastFgAlpha(v)  { _lastFgAlpha  = v; }
export let _fgFadeStart = -1; // 前景フェードイン開始時刻 (-1:常時表示, 0:非表示待機, >0:フェード中)
export function setMaskBorderFadeStart(v) { _maskBorderFadeStart = v; }
export function setFgFadeStart(v) { _fgFadeStart = v; }
export function setCompositeT(v) { _compositeT = v; }
export function setCompositeLastRaf(v) { _compositeLastRaf = v; }
export function setCompositeSeekPending(v) { _compositeSeekPending = v; }
export function setModalOpen(v) { _modalOpen = v; }
export function setEffectsHidden(v) { effectsHidden = v; }
export function setMaskHidden(v) { maskHidden = v; }

export function _scheduleResync(initialDelay = 100) {
  clearTimeout(_resyncTimer);
  _resyncTimer = setTimeout(_doResync, initialDelay);
}
export async function _doResync() {
  if (!state.playing || _compositeSeekPending) return;
  if (!loaded[0] || !loaded[1]) return;
  if (mediaType[0] !== 'video' || mediaType[1] !== 'video') return;
  // play() 呼び出し直後はまだ paused のままのことがある → リスケジュールして待つ
  if (vid[0].paused || vid[1].paused) {
    _resyncTimer = setTimeout(_doResync, 80);
    return;
  }
  const [o1, o2] = _getOffsets();
  const t0 = vid[0].currentTime - o1;
  const diff = vid[1].currentTime - (t0 + o2); // 正=vid[1]が進みすぎ、負=遅れ
  if (Math.abs(diff) > 0.080) {
    // 80ms超のズレ: vid[0] は継続再生させ、vid[1] だけをシークして補正
    // play() 直後の起動ズレ(30〜100ms)も含めて即スナップ
    vid[1].playbackRate = 1.0;
    vid[1].pause();
    vid[1].currentTime = Math.max(0, Math.min(vid[1].duration || 0, vid[0].currentTime - o1 + o2));
    await new Promise(res => {
      vid[1].addEventListener('seeked', res, { once: true });
    });
    if (state.playing && !_compositeSeekPending) {
      // シーク中に vid[0] が進んだ分の残差を playbackRate で吸収
      const postDiff = vid[1].currentTime - (vid[0].currentTime - o1 + o2);
      vid[1].playbackRate = postDiff < -0.016 ? 1.08 : postDiff > 0.016 ? 0.94 : 1.0;
      vid[1].play().catch(() => {});
      _resyncTimer = setTimeout(_doResync, 300);
    }
    return;
  } else if (Math.abs(diff) > 0.016) {
    // 中ズレ(1フレーム超): playbackRate で滑らかに追いつかせる
    // vid[1] が遅れている(diff<0) → 少し速く。進みすぎ(diff>0) → 少し遅く。
    const rate = diff < 0 ? 1.08 : 0.94;
    vid[1].playbackRate = rate;
    _resyncTimer = setTimeout(_doResync, 300);
    return;
  } else {
    // 1フレーム以内: 速度を戻す
    vid[1].playbackRate = 1.0;
  }
  _resyncTimer = setTimeout(_doResync, 1500);
}

// バックグラウンド復帰時に即座再同期（動画が進んでいる場合のみ。復帰後のズレが大きいことがあるため）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.playing) _scheduleResync(80);
});
window.addEventListener('focus', () => {
  if (state.playing) _scheduleResync(80);
});

// ============================================================
//  スライダー
// ============================================================
export function updateSliderFill(el) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

export function _getOffsets() {
  return [
    parseFloat(elOffset0.value) || 0,
    parseFloat(elOffset1.value) || 0,
  ];
}

// マスクのD&D overlay をS.maskに合わせて同期（canvas buffer座標 → CSS %）
// syncMaskDropOverlay: 値が変化した時だけDOMを更新 (毎フレーム style書き込みを避ける)
export function syncMaskDropOverlay() {
  const cw = canvas.width, ch = canvas.height;
  const { x, y, w, h, shape } = state.mask;
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

export function _updateArLockBtn() {
  const btn = document.getElementById('arLockBtn');
  btn.classList.toggle('active', state.arLock);
  btn.innerHTML = `<i data-lucide="${state.arLock ? 'lock' : 'lock-open'}"></i>`;
  btn.title = t(state.arLock ? 'ar-lock' : 'ar-unlock');
  lucide.createIcons();
}
document.getElementById('arLockBtn').addEventListener('click', () => {
  state.arLock = !state.arLock;
  _updateArLockBtn();
});

export function _updateZoomLockBtn() {
  const btn = document.getElementById('zoomLockBtn');
  btn.classList.toggle('active', state.zoomLock);
  btn.innerHTML = `<i data-lucide="${state.zoomLock ? 'lock' : 'lock-open'}"></i>`;
  btn.title = t(state.zoomLock ? 'zoom-lock' : 'zoom-unlock');
  lucide.createIcons();
}
document.getElementById('zoomLockBtn').addEventListener('click', () => {
  state.zoomLock = !state.zoomLock;
  _updateZoomLockBtn();
});

export function _updateFgFixedBtn() {
  const isPhone = state.mask.shape === 'phone';
  // phone 以外のときは fgFixed を解除
  if (!isPhone) state.fgFixed = false;
  // X/Y スライダーはアンカーモード（fgFixed ON）時のみ表示
  document.getElementById('fgPinXRow').style.display = state.fgFixed ? '' : 'none';
  document.getElementById('fgPinYRow').style.display = state.fgFixed ? '' : 'none';
  document.getElementById('fgPinLerpRow').style.display = state.fgFixed ? '' : 'none';
  document.getElementById('fgPinOpacityRow').style.display = state.fgFixed ? '' : 'none';
  // ズームスライダーはアンカーモードでも操作可能（zoomLock で連動制御）
  elMaskZoom.disabled = false;
  document.getElementById('maskZoomVal').disabled = false;
  // 錨アイコンはアンカーモード (fgFixed) の ON/OFF を反映
  const btn = document.getElementById('fgFixedBtn');
  btn.classList.toggle('active', state.fgFixed);
  btn.title = t('fg-anchor-show');
}

// ズームロック ON 時、マスク幅の変化率に比例して maskZoom を追従させる
export function _syncZoomToMaskScale(oldW, newW) {
  if (!state.zoomLock || oldW <= 0 || Math.abs(oldW - newW) < 0.5) return;
  const ratio = newW / oldW;
  const curZoom = parseFloat(elMaskZoom.value);
  const newZoom = Math.min(5, Math.max(0.1, parseFloat((curZoom * ratio).toFixed(2))));
  elMaskZoom.value = newZoom;
  document.getElementById('maskZoomVal').value = newZoom % 1 === 0 ? `${Math.round(newZoom)}` : newZoom.toFixed(2);
  updateSliderFill(elMaskZoom);
}

// ============================================================
//  プログレスバー
// ============================================================
export function fmtTime(sec, forceHours = false) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h > 0 || forceHours)
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function updateProgress() {
  const refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration
               : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration : 0;
  if (!refDur) return;
  const pct = Math.min(1, Math.max(0, _compositeT / refDur));
  elProgressFill.style.width = `${pct * 100}%`;
  elProgressThumb.style.left = `${pct * 100}%`;
  const useHours = refDur >= 3600;
  elTimeLabel.textContent = `${fmtTime(Math.min(_compositeT, refDur), useHours)} / ${fmtTime(refDur, useHours)}`;
}

export function _showDelPopup(anchorBtn, msg, onConfirm, okClass) {
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

export let _hintStatePrev = '';        // render.js のヒント状態キャッシュ
export let _isDraggingPreset = false;  // media.js の dragover 判定用
export let _f2Target = null;           // { type: 'folder'|'preset', idx: number }
export let _modalOpen = false;         // モーダル開閉フラグ

export function setIsDraggingPreset(v) { _isDraggingPreset = v; }
export function setActivePresetIdx(v)  { _activePresetIdx  = v; }
export function setF2Target(v)         { _f2Target         = v; }
