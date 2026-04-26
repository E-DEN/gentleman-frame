// ============================================================
//  i18n — js/i18n.js から読み込む（このファイルより先に読み込むこと）
// ============================================================
const PRESET_KEY = 'gentleFrame_presets';
let _presetsReady = false;
let _maskFollowMode = false;
let _followTargetX = 0, _followTargetY = 0;

// ドロップゾーンの loaded アニメーションを管理するヘルパー。
// カード開閉時のアニメーション再起動を防ぐため、終了後に inline で凍結する。
function _setZoneLoaded(zone, isLoaded) {
  if (isLoaded) {
    // 凍結を解除してアニメーションを再生可能にする
    zone.style.animation = '';
    void zone.offsetWidth; // reflow でアニメーションをリセット
    zone.classList.add('loaded');
  } else {
    zone.classList.remove('loaded');
    zone.style.animation = '';
  }
}
// アニメーション終了時に凍結（display:none → block でも再起動しない）
;(function () {
  document.addEventListener('animationend', e => {
    const z = e.target;
    if (e.animationName === 'drop-loaded-settle' && z.classList.contains('loaded')) {
      z.style.animation = 'none';
    }
  }, true);
})();

// ============================================================
//  状態
// ============================================================
const S = {
  playing: false,
  maskHovered: false,
  maskTouched: false,
  mask: {
    x: 227, // (854 - 400) / 2
    y: 40,  // (480 - 400) / 2
    w: 400,
    h: 400,
    shape: 'rect'
  },
  arLock: false,
  drag: { active: false, mode: null, ox: 0, oy: 0, sm: null, sp: null }
};

// ============================================================
//  ファイルハンドル（File System Access API + IndexedDB）
// ============================================================
const _currentHandle  = [null, null];
const _loadedFileName = ['', ''];
const _loadedPageUrl  = ['', '']; // Iwara等ページURLを記憶（リンク表示用）
const _loadedSrcUrl   = ['', '']; // 実際にロードしたURL（プリセット復元用）

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
//  ハンドル
// ============================================================
const HANDLE_SZ = 3; // canvas px (half-size)

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
//  動画 / 画像 要素
// ============================================================
const vid = [document.createElement('video'), document.createElement('video')];
const img = [document.createElement('img'), document.createElement('img')];
const mediaType = ['video', 'video']; // 'video' | 'image'

// requestVideoFrameCallback で各フレームを ImageBitmap にスナップショット。
// render ループはライブな video テクスチャではなくこの bitmap から描画する。
// → GPU overlay demotion 時の drawImage(video) ブロッキングを回避。
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
//  Canvas + オフスクリーン
// ============================================================
const canvas  = document.getElementById('mainCanvas');
const displayCtx = canvas.getContext('2d');
// 描画は renderCvs (desynchronized) で行い、rAF 末尾に displayCtx へ1回ブリット。
// → レンダリングはコンポジターのGPUキュー競合に影響されない (スタッタリング回避)。
// → 表示側は vsync aligned な rAF でブリットするのでテアリングなし。
const renderCvs = document.createElement('canvas');
renderCvs.width  = canvas.width;
renderCvs.height = canvas.height;
const ctx     = renderCvs.getContext('2d', { desynchronized: true });
const canvasWrap     = document.getElementById('canvasWrap');
const maskDropOverlay = document.getElementById('maskDropOverlay');
let _dispW = canvas.width;   // Canvas CSSピクセル表示サイズ
let _dispH = canvas.height;

// 前景合成用オフスクリーンキャンバス（初期化時に1度だけ生成）
const offCvs  = document.createElement('canvas');
offCvs.width  = canvas.width;
offCvs.height = canvas.height;
const offCtx  = offCvs.getContext('2d');

// ポストプロセス用オフスクリーンキャンバス（色収差など）
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

// グレイン用オフスクリーンキャンバス（固定 256×256 タイル）
const grainCvs = document.createElement('canvas');
grainCvs.width = 256; grainCvs.height = 256;
const grainCtx = grainCvs.getContext('2d');

// Canvas バッファ解像度を CSS 表示サイズに同期してアップスケール時のぼかしを防ぐ
let _canvasAR = 854 / 480; // 現在のアスペクト比
let _prevBufW = 854, _prevBufH = 480; // バッファ変更前のサイズ（マスク比率スケール用）

// CSS変数キャッシュ (getComputedStyleを毎フレーム呼ばないため)
let _cachedAccent = '';
let _cachedBg = '';
let _maskOverlayCache = { left: '', top: '', width: '', height: '', borderRadius: '' };
function _readCssVars() {
  const s = getComputedStyle(document.documentElement);
  _cachedAccent = s.getPropertyValue('--accent').trim();
  _cachedBg = s.getPropertyValue('--bg').trim() || '#080810';
}
_readCssVars();

function _syncAllBuffers(w, h) {
  canvas.width  = w; canvas.height = h;
  renderCvs.width = w; renderCvs.height = h;
  offCvs.width  = w; offCvs.height = h;
  postCvs.width = w; postCvs.height = h;
  chCvs.width   = w; chCvs.height  = h;
  caCvs.width   = w; caCvs.height  = h;
}

function _syncMaskSliders() {
  const elMW = document.getElementById('maskW');
  const elMH = document.getElementById('maskH');
  // W と H は固定レンジ [10, 790] → 400 がスライダーの中央になる。
  // 790 超の値はキャンバス上のドラッグで設定可能。テキスト欄は実際値を表示。
  elMW.value = Math.min(Math.round(S.mask.w), +elMW.max);
  elMH.value = Math.min(Math.round(S.mask.h), +elMH.max);
  document.getElementById('maskWVal').value = Math.round(S.mask.w);
  document.getElementById('maskHVal').value = Math.round(S.mask.h);
  updateSliderFill(elMW);
  updateSliderFill(elMH);
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
  const elOX = document.getElementById('maskOffX');
  const elOY = document.getElementById('maskOffY');
  elOX.min = -halfW; elOX.max = halfW; elOX.value = offX;
  elOY.min = -halfH; elOY.max = halfH; elOY.value = offY;
  document.getElementById('maskOffXVal').value = offX;
  document.getElementById('maskOffYVal').value = offY;
  updateSliderFill(elOX);
  updateSliderFill(elOY);
}

// pending マスク設定をバッファ座標に変換して適用
// srcW/srcH あり → 比率スケール変換、なし（旧プリセット）→ 現バッファ中央に配置
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
    // 初回 or AR 大幅変化: pending があればそちら、なければデフォルト中央
    _canvasInitialized = true;
    const pm = _pendingMask;
    _pendingMask = null;
    if (!_applyMaskFromPm(pm, w, h)) {
      S.mask.w = Math.min(400, w);
      S.mask.h = Math.min(400, h);
      S.mask.x = Math.round((w - S.mask.w) / 2);
      S.mask.y = Math.round((h - S.mask.h) / 2);
    }
  } else {
    // 動画解像度変化: 比率を維持してマスクをスケール
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

let _canvasInitialized = false; // setCanvasAspectRatio が一度でも呼ばれたか（動画ロード済みフラグ）
let _bufferSynced      = false; // 初回CSS表示サイズへのバッファ同期済みか
let _pendingMask = null; // applySettings から設定。次回 setCanvasAspectRatio で適用される
let _activePresetIdx = null; // 現在適用中のプリセットのインデックス

// 初回同期: app.js は </body> 直前で実行されるため getBoundingClientRect が確実に使える。
// ResizeObserver より先に同期することで初期フレームのぼかしを防ぐ。
{
  const r = canvas.getBoundingClientRect();
  const iw = Math.round(r.width), ih = Math.round(r.height);
  if (iw > 0 && ih > 0) {
    _syncAllBuffers(iw, ih);
    _prevBufW = iw; _prevBufH = ih;
    S.mask.w = Math.min(400, iw); S.mask.h = Math.min(400, ih);
    S.mask.x = Math.round((iw - S.mask.w) / 2);
    S.mask.y = Math.round((ih - S.mask.h) / 2);
    _bufferSynced = true;
    _syncMaskSliders();
  }
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
  _syncAllBuffers(w, h);
  _prevBufW = w; _prevBufH = h;
  S.mask.w = Math.min(400, w); S.mask.h = Math.min(400, h);
  S.mask.x = Math.round((w - S.mask.w) / 2);
  S.mask.y = Math.round((h - S.mask.h) / 2);
  _bufferSynced = true;
  _syncMaskSliders();
}).observe(canvas);

// 頻繁に参照する DOM 要素をキャッシュ
const elBorderW       = document.getElementById('borderW');
const elBorderColor   = document.getElementById('borderColor');
const elBorderOpacity = document.getElementById('borderOpacity');
const elBorderAnim    = document.getElementById('borderAnim');
const elBorderAnimSpeed = document.getElementById('borderAnimSpeed');
const elBorderAnimBright = document.getElementById('borderAnimBright');
const elBlurAmt       = document.getElementById('blurAmt');
const elFilterVignette  = document.getElementById('filterVignette');
const elFilterCA        = document.getElementById('filterCA');
const elFilterTemp      = document.getElementById('filterTemp');
const elFilterTint      = document.getElementById('filterTint');
const elFilterHighlight = document.getElementById('filterHighlight');
const elFilterShadow    = document.getElementById('filterShadow');
const elFilterSharpness = document.getElementById('filterSharpness');
const elFilterMatte     = document.getElementById('filterMatte');
const elFilterGrain     = document.getElementById('filterGrain');
const elFilterPixel     = document.getElementById('filterPixel');
const elFilterFlare     = document.getElementById('filterFlare');
const elFilterBars      = document.getElementById('filterBars');
const elProgressFill  = document.getElementById('progressFill');
const elProgressThumb = document.getElementById('progressThumb');
const elTimeLabel   = document.getElementById('timeLabel');
const playBtn       = document.getElementById('playBtn');

let _playDelayTimers = [];
let _compositeT = 0;
let _compositeLastRaf = null;
let _compositeSeekPending = false;
let _resyncTimer = null;
let _autoResyncEnabled = false;
let _autoResyncInterval = null;
// マスク枠フェードイン: -1=即全表示, 0=動画待ち, >0=フェード開始timestamp
let _maskBorderFadeStart = -1;
let _fgFadeStart = -1; // 前景フェードイン開始時刻 (-1:常時表示, 0:非表示待機, >0:フェード中)

function _scheduleResync(initialDelay = 100) {
  clearTimeout(_resyncTimer);
  _resyncTimer = setTimeout(_doResync, initialDelay);
}
async function _doResync() {
  if (!S.playing || _compositeSeekPending) return;
  if (!loaded[0] || !loaded[1]) return;
  if (mediaType[0] !== 'video' || mediaType[1] !== 'video') return;
  if (vid[0].paused || vid[1].paused) return;
  const [o1, o2] = _getOffsets();
  const t0 = vid[0].currentTime - o1;
  const diff = vid[1].currentTime - (t0 + o2); // 正=vid[1]が進みすぎ、負=遅れ
  if (Math.abs(diff) > 0.300) {
    // 大きなズレ: フルシークで再同期
    vid[1].playbackRate = 1.0;
    await _applyCompositeT(t0);
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
  if (document.visibilityState === 'visible' && S.playing) _scheduleResync(80);
});
window.addEventListener('focus', () => {
  if (S.playing) _scheduleResync(80);
});

// ============================================================
//  Canvas CSS フィルター（明るさ / コントラスト / 彩度）
// ============================================================
function updateCanvasFilter() {
  if (effectsHidden) { canvas.style.filter = ''; return; }
  const b  = parseFloat(document.getElementById('filterBrightness').value);
  const co = parseFloat(document.getElementById('filterContrast').value);
  const s  = parseFloat(document.getElementById('filterSaturation').value);
  const h  = parseFloat(document.getElementById('filterHue').value);
  canvas.style.filter = (b === 100 && co === 100 && s === 100 && h === 0)
    ? '' : `brightness(${b}%) contrast(${co}%) saturate(${s}%) hue-rotate(${h}deg)`;
}

// ============================================================
//  枠アニメーション用グラデーション生成
// ============================================================
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
  } else if (anim === 'cm') {
    g.addColorStop(0,   `hsl(180,100%,${L}%)`);
    g.addColorStop(0.5, `hsl(300,100%,${L}%)`);
    g.addColorStop(1,   `hsl(180,100%,${L}%)`);
  } else if (anim === 'sakura') {
    g.addColorStop(0,   `hsl(335,100%,${L}%)`);
    g.addColorStop(0.5, `hsl(130,90%,${L}%)`);
    g.addColorStop(1,   `hsl(335,100%,${L}%)`);
  } else if (anim === 'neon') {
    g.addColorStop(0,   `hsl(145,100%,${L}%)`);
    g.addColorStop(0.5, `hsl(200,100%,${L}%)`);
    g.addColorStop(1,   `hsl(145,100%,${L}%)`);
  } else if (anim === 'fire') {
    g.addColorStop(0,   `hsl(0,100%,${L}%)`);
    g.addColorStop(0.5, `hsl(22,100%,${L}%)`);
    g.addColorStop(1,   `hsl(0,100%,${L}%)`);
  } else if (anim === 'aurora') {
    g.addColorStop(0,   `hsl(260,100%,${L}%)`);
    g.addColorStop(0.5, `hsl(160,100%,${L}%)`);
    g.addColorStop(1,   `hsl(260,100%,${L}%)`);
  }
  return g;
}

// ============================================================
//  レンダリングループ
// ============================================================
// _renderFrame と displayCtx blit を同一 rAF コールバック内でアトミックに実行し、
// setInterval との競合によるティアリングを防ぐ。
let _renderIntervalId = null; // 互換用（現在は未使用）

function _renderFrame() {
  // マスク追従モード: lerp でなめらかにカーソルへ追従
  if (_maskFollowMode) {
    const lerpK = 0.22; // 1フレームあたりの追従率 (0〜1)
    const cx = _followTargetX - S.mask.w / 2;
    const cy = _followTargetY - S.mask.h / 2;
    S.mask.x = Math.round(S.mask.x + (cx - S.mask.x) * lerpK);
    S.mask.y = Math.round(S.mask.y + (cy - S.mask.y) * lerpK);
    _syncOffsetSliders();
  }

  const W = canvas.width;
  const H = canvas.height;
  const m = S.mask;
  // バッファ → 表示CSS px の拡大率。動画解像度が高いほど > 1 になる。
  // lineWidth などの「見た目固定」値はこの係数で補正する。
  const bufScale = _dispH > 0 ? H / _dispH : 1;

  ctx.clearRect(0, 0, W, H);

  // --- 背景 動画/画像（レイヤー 1）---
  if (loaded[0] && !visHidden[0]) {
    try { ctx.drawImage(getMediaSrc(0), 0, 0, W, H); }
    catch (e) { ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H); drawHint(ctx,W/2,H/2,t('cors-err')); }
  } else {
    ctx.fillStyle = _cachedBg;
    ctx.fillRect(0, 0, W, H);
    if (!loaded[0] && !visHidden[0] && _maskBorderFadeStart !== 0) drawHint(ctx, W / 2, H / 2 - 10, t('hint-bg'));
  }

  const blurAmt = parseFloat(elBlurAmt.value);
  const pixelAmt = parseFloat(elFilterPixel.value);

  // --- 前景 動画/画像をマスクでクリップ（レイヤー 2）、ぼかしオプションあり ---
  const fgAlpha = _fgFadeStart < 0 ? 1
    : _fgFadeStart === 0 ? 0
    : Math.min(1, (performance.now() - _fgFadeStart) / 200);
  if (loaded[1] && !visHidden[1]) {
    offCtx.clearRect(0, 0, W, H);
    offCtx.drawImage(getMediaSrc(1), 0, 0, W, H);
    if (!maskHidden) {
      offCtx.globalCompositeOperation = 'destination-in';
      buildMaskPath(offCtx, m);
      offCtx.fill();
      offCtx.globalCompositeOperation = 'source-over';
    }

    // --- Pixelation (マスク側) ---
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
      // ピクセル化で拡大した際にマスク外へはみ出るため再クリップ
      if (!maskHidden) {
        offCtx.globalCompositeOperation = 'destination-in';
        buildMaskPath(offCtx, m);
        offCtx.fill();
        offCtx.globalCompositeOperation = 'source-over';
      }
    }

    if (blurAmt > 0) {
      const bp = blurAmt * 2;
      ctx.save();
      if (!maskHidden) { buildMaskPath(ctx, m); ctx.clip(); }
      ctx.filter = `blur(${bp}px)`;
      ctx.globalAlpha = fgAlpha;
      if (pixelAmt >= 2) {
        ctx.drawImage(offCvs, 0, 0);
      } else {
        ctx.drawImage(getMediaSrc(1), -bp, -bp, W + bp * 2, H + bp * 2);
      }
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.restore();
    } else {
      ctx.save(); ctx.globalAlpha = fgAlpha;
      ctx.drawImage(offCvs, 0, 0);
      ctx.globalAlpha = 1; ctx.restore();
    }
  } else if (loaded[0] && !visHidden[1] && !maskHidden && _fgFadeStart !== 0) {
    // 前景なし: マスク内の背景にぼかし/ピクセル化をすりガラス風に適用
    // _fgFadeStart===0 (ロード中) は表示しない
    if (pixelAmt >= 1 && blurAmt <= 0) {
      // ピクセル化 — postCvs で縮小→ctx.clip()内でフルサイズ拡大（destination-inのAA縁を回避）
      const pSize = Math.round(pixelAmt * 4);
      const pw = Math.ceil(W / pSize);
      const ph = Math.ceil(H / pSize);
      postCtx.clearRect(0, 0, W, H);
      postCtx.drawImage(getMediaSrc(0), 0, 0, pw, ph);
      ctx.save();
      buildMaskPath(ctx, m);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(postCvs, 0, 0, pw, ph, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.restore();
    } else if (blurAmt > 0) {
      // ぼかし (端の薄れ防止のためオーバードロー)
      const bp = blurAmt * 2;
      ctx.save();
      buildMaskPath(ctx, m);
      ctx.clip();
      ctx.filter = `blur(${bp}px)`;
      ctx.drawImage(getMediaSrc(0), -bp, -bp, W + bp * 2, H + bp * 2);
      ctx.filter = 'none';
      ctx.restore();
    }
  } else if (!loaded[1] && !visHidden[1] && _fgFadeStart !== 0) {
    drawHint(ctx, W / 2, H / 2 + 14, t('hint-fg'));
  }

  // --- 色収差（放射状、スケールベース）---
  if (!effectsHidden) {
  const caAmt = parseFloat(elFilterCA.value);
  if (caAmt > 0) {
    postCtx.clearRect(0, 0, W, H);
    postCtx.drawImage(renderCvs, 0, 0);
    const s = caAmt * 0.002;
    const cx = W / 2, cy = H / 2;
    const _drawCh = (color, scale) => {
      chCtx.clearRect(0, 0, W, H);
      // scale<1 のとき縁に隙間(黒)が生じる → 先にオリジナルで埋めてボーダーを防ぐ
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

  // --- Highlights (明るいトーン域を操作) ---
  const hlAmt = parseFloat(elFilterHighlight.value);
  if (hlAmt !== 0) {
    const t = Math.abs(hlAmt) / 100;
    ctx.save();
    if (hlAmt > 0) {
      // 明るい部分を持ち上げる (soft-light + white → 明部が優先的に明るくなる)
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(255,255,255,${t * 0.60})`;
    } else {
      // 明るい部分を落とす (multiply → 明部を乗算で圧縮)
      ctx.globalCompositeOperation = 'multiply';
      const l = Math.round(255 - t * 55);
      ctx.fillStyle = `rgb(${l},${l},${l})`;
    }
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Shadows (暗いトーン域を操作) ---
  const shAmt = parseFloat(elFilterShadow.value);
  if (shAmt !== 0) {
    const t = Math.abs(shAmt) / 100;
    ctx.save();
    if (shAmt > 0) {
      // 暗い部分を持ち上げる (screen + dim gray → 暗部優先でリフト)
      ctx.globalCompositeOperation = 'screen';
      const brightness = Math.round(t * 72);
      ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
    } else {
      // 暗い部分を落とす (soft-light + black → 暗部を crush)
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(0,0,0,${t * 0.60})`;
    }
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- ビネット ---
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

  // --- Color Temperature (色温度) ---
  const tempAmt = parseFloat(elFilterTemp.value);
  if (tempAmt !== 0) {
    const t2 = Math.abs(tempAmt) / 50;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = tempAmt > 0
      ? `rgba(255,140,0,${0.22 * t2})`   // 暖色
      : `rgba(20,80,255,${0.22 * t2})`;  // 寒色
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Tint (色かぶり補正: マゼンタ ↔ グリーン) ---
  const tintAmt = parseFloat(elFilterTint.value);
  if (tintAmt !== 0) {
    const t2 = Math.abs(tintAmt) / 50;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = tintAmt > 0
      ? `rgba(0,210,60,${0.14 * t2})`     // グリーン
      : `rgba(255,0,200,${0.14 * t2})`;   // マゼンタ
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Matte (黒浮き + 白浮き) ---
  const matteAmt = parseFloat(elFilterMatte.value);
  if (matteAmt > 0) {
    const t    = matteAmt / 10;
    const lift  = Math.round(t * 50);        // 0 → 50 : 暗部を底上げ
    const crush = Math.round(255 - t * 45);  // 255 → 210 : 明部を天井下げ
    // 黒浮き（screen合成）
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgb(${lift},${lift},${lift})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // 白圧縮（multiply合成）
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${crush},${crush},${crush})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Film Grain (フィルム粒子) ---
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

  // --- Sharpness (オーバーレイ unsharp mask) ---
  const sharpAmt = parseFloat(elFilterSharpness.value);
  if (sharpAmt > 0) {
    // postCvs に現状のフレームを保存 → chCvs にぼかし → overlay で高周波成分を強調
    postCtx.clearRect(0, 0, W, H);
    postCtx.drawImage(renderCvs, 0, 0);
    chCtx.clearRect(0, 0, W, H);
    chCtx.filter = `blur(${1 + sharpAmt * 0.25}px)`;
    chCtx.drawImage(postCvs, 0, 0);
    chCtx.filter = 'none';
    // オリジナルを overlay で重ね合わせてエッジのコントラストを強調
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(sharpAmt * 0.09, 0.85);
    ctx.drawImage(postCvs, 0, 0);
    ctx.restore();
  }

  // --- Color Flare (カラーフレア) ---
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

  // --- Cinematic Bars (映画の帯) ---
  const barsAmt = parseFloat(elFilterBars.value);
  if (barsAmt > 0) {
    // max=10 → 帯の高さ最大 = H * 0.18（長め）
    const barH = Math.round(H * (barsAmt / 10) * 0.18);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, barH);
    ctx.fillRect(0, H - barH, W, barH);
    ctx.restore();
  }
  } // end !effectsHidden

  // --- マスク枠（フィルターの上に描画）---
  const bw = parseFloat(elBorderW.value);
  if (bw > 0 && !maskHidden && !visHidden[1]) {
    // フェードイン計算 — _fgFadeStart が動いている間は前景と同期、それ以外は _maskBorderFadeStart の独立フェード
    let borderFadeA;
    if (_fgFadeStart === 0) {
      borderFadeA = 0;
    } else if (_fgFadeStart > 0) {
      borderFadeA = fgAlpha; // 前景と完全同期
    } else if (_maskBorderFadeStart === 0) {
      borderFadeA = 0;
    } else if (_maskBorderFadeStart > 0) {
      borderFadeA = Math.min(1, (performance.now() - _maskBorderFadeStart) / 500);
    } else {
      borderFadeA = 1;
    }
    if (borderFadeA > 0) {
      const anim = elBorderAnim.value;
      ctx.save();
      ctx.lineWidth   = bw * bufScale;
      ctx.globalAlpha = (parseInt(elBorderOpacity.value, 10) / 100) * borderFadeA;
      if (anim !== 'none') {
        const speed  = parseFloat(elBorderAnimSpeed.value) * 0.1;
        const bright = parseInt(elBorderAnimBright.value, 10);
        const phase  = (performance.now() * 0.001 * speed) % 1;
        ctx.strokeStyle = _buildBorderGrad(ctx, m, phase, anim, bright);
      } else {
        ctx.strokeStyle = elBorderColor.value;
      }
      buildMaskPath(ctx, m);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- リサイズハンドル ---
  if ((S.maskHovered || S.drag.active || S.maskTouched) && !maskHidden && !visHidden[1]) {
    ctx.save();
    const accent = _cachedAccent;
    const hSz = Math.max(1, Math.round(HANDLE_SZ * bufScale));
    for (const h of getHandles(m)) {
      ctx.fillStyle   = accent;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth   = 1.5 * bufScale;
      ctx.fillRect  (h.x - hSz, h.y - hSz, hSz * 2, hSz * 2);
      ctx.strokeRect(h.x - hSz, h.y - hSz, hSz * 2, hSz * 2);
    }
    ctx.restore();
  }

  // --- コンポジット時刻 ---
  const _rafNow = performance.now();
  if (S.playing && !_compositeSeekPending) {
    const [o1, o2] = _getOffsets();
    if (loaded[0] && mediaType[0] === 'video' && !vid[0].paused && vid[0].readyState >= 2) {
      _compositeT = vid[0].currentTime - o1;
    } else if (loaded[1] && mediaType[1] === 'video' && !vid[1].paused && vid[1].readyState >= 2) {
      _compositeT = vid[1].currentTime - o2;
    } else if (_compositeLastRaf !== null) {
      // 遅延フェーズ（負のオフセット）: ウォールクロックで追跡
      _compositeT += (_rafNow - _compositeLastRaf) / 1000;
      // refDur を超えないようにクランプ
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

function render() {
  _renderFrame();
  updateProgress();
  syncMaskDropOverlay();
  displayCtx.drawImage(renderCvs, 0, 0);
  requestAnimationFrame(render);
}

function _startRenderLoop() {
  if (_renderIntervalId) { clearInterval(_renderIntervalId); _renderIntervalId = null; }
  requestAnimationFrame(render);
}

function drawHint(c, x, y, text) {
  const isDark = document.documentElement.dataset.theme !== 'light';
  c.save();
  c.fillStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  c.font = '14px Segoe UI, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, x, y);
  c.restore();
}

function buildMaskPath(c, m) {
  c.beginPath();
  if (m.shape === 'rect') {
    c.rect(m.x, m.y, m.w, m.h);
  } else if (m.shape === 'circle') {
    c.ellipse(m.x + m.w / 2, m.y + m.h / 2, m.w / 2, m.h / 2, 0, 0, Math.PI * 2);
  } else if (m.shape === 'heart') {
    // ハート型パス (幅・高さに合わせてスケール)
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    const sx = m.w / 2, sy = m.h / 2;
    // f(t) = 13cos(t)-5cos(2t)-2cos(3t)-cos(4t) の実際の範囲:
    //   yMin = -17 (t=π, 下先端), yMax ≈ 12.0 (上バンプ)
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

_startRenderLoop();

// ============================================================
//  ファイル読み込み
// ============================================================

// proxy.js (yt-dlp) を使って Iwara ページURL → CDN URL を解決
// ローカル実行時はローカルプロキシ、本番（Pages）ではWorkerを自動選択
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

    // ── URL形式チェック ────────────────────────────────────
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(t('err-invalid-url'));
    }
    zone.classList.add('loading');
    _setDropSpinner(index, true);

    // ── 画像URL直リン判定 ──────────────────────────────────
    const IMAGE_URL_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?.*)?$/i;
    if (IMAGE_URL_RE.test(url) || /^data:image\//i.test(url)) {
      const name = url.split('/').pop().split('?')[0] || 'image';
      setStatus('画像を読み込み中...');
      await new Promise((resolve, reject) => {
        if (img[index].src?.startsWith('blob:')) URL.revokeObjectURL(img[index].src);
        img[index].removeAttribute('src'); // 同URLの再ロードでも onload を確実に発火させる
        _currentHandle[index]  = null;
        _loadedFileName[index] = name;
        // pximg.net の直リンからPixivページURLを生成
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
          // CORS失敗 → プロキシ経由で再試行
          const proxyUrl = `${_MY_PROXY}/?url=${encodeURIComponent(url)}`;
          img[index].onerror = _imgFail;
          img[index].src = proxyUrl;
        };
        // 既知のCORSブロックホストは最初からプロキシ経由
        const PROXY_FIRST_HOSTS = ['i.pximg.net', 'i-f.pximg.net'];
        const _needsProxy = PROXY_FIRST_HOSTS.some(h => url.includes(h));
        if (_needsProxy) {
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

    // ── 動画URL ────────────────────────────────────────────
    let resolvedUrl = url;
    let name = url.split('/').pop().split('?')[0] || url;
    if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
      throw new Error(t('err-unsupported-site').replace('{site}', 'YouTube'));
    }
    if (/iwara\.(tv|ai)\/video\//i.test(url)) {
      setStatus(t('api-checking'));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      // iwara.ai → iwara.tv に正規化（プロキシ側は両ドメイン対応）
      const iwaraUrl = url.replace(/^(https?:\/\/(?:www\.)?)(iwara\.ai)(.*)/i, '$1iwara.tv$3');
      const result = await resolveIwaraURL(iwaraUrl);
      if (!result) throw new Error(t('url-resolve-fail'));
      setStatus('CDN URLを取得中...');
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
    vid[index].removeAttribute('crossorigin');
    vid[index].src = resolvedUrl;
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
  // URL欄・ページリンクをリセット
  _loadedPageUrl[index]  = '';
  _loadedSrcUrl[index]   = '';
  _updateDropLink(index);
  const _vi = document.getElementById(`urlInput${index}`);
  const _ve = document.getElementById(`urlErr${index}`);
  if (_vi) { _vi.value = ''; _vi.style.borderColor = ''; }
  if (_ve)   _ve.textContent = '';
  // ロード中見た目
  const zone = document.getElementById(`drop${index}`);
  zone.classList.remove('loaded');
  zone.classList.add('loading');
  _setDropSpinner(index, true);
  const url = URL.createObjectURL(file);
  _stopBitmapCapture(index);
  loaded[index] = false;
  vid[index].src = url;
  vid[index].load();
  vid[index].onloadedmetadata = () => {
    loaded[index] = true;
    _stopBitmapCapture(index);
    _startBitmapCapture(index);
    zone.classList.remove('loading');
    _setDropSpinner(index, false);
    if (index === 1 && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
    if (index === 1 && _fgFadeStart === 0) _fgFadeStart = performance.now();
    vid[index].volume = (parseFloat(document.getElementById(`vol${index}`).value) / 100) ** 2;
    // index 0（背景）がロードされたらアスペクト比を更新
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
    zone.classList.remove('loading');
    _setDropSpinner(index, false);
    if (index === 0) setCanvasAspectRatio(img[0].naturalWidth, img[0].naturalHeight);
    if (index === 1 && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
    if (index === 1 && _fgFadeStart === 0) _fgFadeStart = performance.now();
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
  const zone  = document.getElementById(`drop${index}`);
  const input = document.getElementById(`file${index}`);

  async function pickFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [
            { description: '動画ファイル', accept: { 'video/*': ['.mp4', '.webm', '.mov', '.mkv'] } },
            { description: '画像ファイル', accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'] } },
          ],
          multiple: false,
        });
        const file = await handle.getFile();
        if (file.type.startsWith('image/')) loadImage(index, file, handle);
        else loadVideo(index, file, handle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        // 非対応環境では input.click() にフォールオーバー
      }
    }
    input.click();
  }

  zone.addEventListener('click', e => {
    if (e.target.closest(`#dropLink${index}`)) return; // 元ページリンクはバブリング無視
    pickFile();
  });
  // dropLinkのクリックはゾーンに伝播させない
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
  let _dragCount = 0;
  zone.addEventListener('dragenter', e => {
    e.preventDefault();
    e.stopPropagation();
    _dragCount++;
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
  });
  zone.addEventListener('dragleave', e => {
    e.stopPropagation();
    _dragCount--;
    if (_dragCount <= 0) { _dragCount = 0; zone.classList.remove('drag-over'); }
  });
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    _dragCount = 0;
    zone.classList.remove('drag-over');
    const item = e.dataTransfer.items?.[0];
    const f = e.dataTransfer.files[0]; // awaitより前に同期取得
    let handle = null;
    if (item?.getAsFileSystemHandle) {
      handle = await item.getAsFileSystemHandle().catch(() => null);
    }
    if (f && f.type.startsWith('image/')) loadImage(index, f, handle);
    else if (f && f.type.startsWith('video/')) loadVideo(index, f, handle);
  });
}

[0, 1].forEach(setupDropZone);

// ============================================================
//  動画コントロールリセット
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
//  動画表示切り替え
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
    // 全体ボタンのアイコンを同期
    const allHidden = visHidden[0] && visHidden[1];
    const allBtn = document.getElementById('vidVisAllBtn');
    allBtn.innerHTML = allHidden ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
    lucide.createIcons({ nodes: [allBtn] });
    _syncVidHiddenOverlay();
  });
});

// 全体表示切り替え
document.getElementById('vidVisAllBtn').addEventListener('click', () => {
  const allHidden = visHidden[0] && visHidden[1];
  const next = !allHidden;
  [0, 1].forEach(i => {
    if (visHidden[i] !== next) {
      visHidden[i] = next;
      const btn = document.getElementById(`visBtn${i}`);
      btn.innerHTML = next ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
      lucide.createIcons({ nodes: [btn] });
    }
  });
  const allBtn = document.getElementById('vidVisAllBtn');
  allBtn.innerHTML = next ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
  lucide.createIcons({ nodes: [allBtn] });
  _syncVidHiddenOverlay();
});

// 全体リセット
document.getElementById('vidResetAllBtn').addEventListener('click', () => {
  [0, 1].forEach(i => document.getElementById(`resetBtn${i}`).click());
});

// ============================================================
//  動画削除
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

// Canvas-wide drop: 1ファイル → 背景、2ファイル → 背景＋前景

// マスクのD&D overlay をS.maskに合わせて同期（canvas buffer座標 → CSS %）
// syncMaskDropOverlay: 値が変化した時だけDOMを更新 (毎フレーム style書き込みを避ける)
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

// dropファイル処理: DataTransferはawait前に同期取得必須
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
    // 2ファイル: 順に背景→前景
    for (let i = 0; i < pairs.length; i++) {
      let handle = null;
      if (pairs[i].item?.getAsFileSystemHandle) {
        handle = await pairs[i].item.getAsFileSystemHandle().catch(() => null);
      }
      if (pairs[i].file) _loadFileByType(i, pairs[i].file, handle);
    }
  }
}

// canvasWrap全体: D&D受付 + maskOverlayを有効化
let _isDraggingPreset = false;
// ============================================================
//  プリセット スムーズ並び替え — ゴースト要素方式
//  コンテナベース: ゴーストがどのフォルダ内にあるかを毎フレーム検出。
//  エスケープ/モード追跡ではなく、エリア検出で制御。
//  対応: どこからでもドラッグ、z-index、フォルダ離脱、
//           insert between folder items from outside, click threshold.
// ============================================================
let _mDragSrcIdx     = null;
let _mDraggedEl      = null;   // original element = invisible placeholder
let _mGhost          = null;   // fixed-position floating clone
let _mPointerOffsetY = 0;
let _mDraggedH       = 0;
let _mDragGap        = 2;
let _mActiveSiblings = [];     // siblings currently being slid
let _mCurContainer   = null;   // null = root, or .preset-folder DOM element
let _mFolderTarget   = null;   // closed-folder header for "drop at end"
let _mLastGhostMidY  = 0;
let _mContainerFollowers = []; // root elements after _mCurContainer when ghost is externally in a folder
let _mSrcOrigMidY    = 0;      // original midY of drag source element at drag start
let _mSrcContainerEl = null;   // container (_mCurContainer) at drag start
let _mLastRefY       = 0;      // reference Y for slide/insert: mouseY for folder drags, ghostMidY otherwise
let _mAddFolderTarget = false; // true when ghost is over the "新しいフォルダ" button
let _mFolderHoverTimer = null; // ホバー展開タイマー
// 移動閾値を超える前のドラッグ待機状態
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
// ドラッグ中にフォルダを開く（DOM更新 + データ保存）
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
// 現在ゴースト中心がどのオープンフォルダの子エリア内にあるかを検出。
// .preset-folder 要素を返す。ゴーストがルートレベルにある場合は null。
function _mDetectContainer(ghostMidY) {
  const folders = document.querySelectorAll('#presetList > .preset-folder');
  for (const folder of folders) {
    if (folder === _mDraggedEl) continue;
    const children = folder.querySelector('.preset-folder-children');
    if (!children || children.classList.contains('collapsed')) continue;
    const cr = children.getBoundingClientRect();
    if (cr.height === 0) continue;
    // 下部スナップゾーン: 最後のアイテムと次の兄弟の隙間を「フォルダ末尾」として扱う。
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
    // フォルダの兄弟要素に対しては、全体の midY（子要素を含みヘッダーより大幅に下にある）ではなく、
    // ヘッダーの midY と比較する。
    // こうすることでフォルダの子要素数に関わらずスライド挑発が自然になる。
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
// アクティブコンテナを切り替え、前のコンテナのフォロワーをリセットする。
function _mSwitchContainer(newContainer, ghostMidY) {
  // 旧フォロワーをクリア
  _mContainerFollowers.forEach(el => { el.style.transform = ''; el.style.transition = ''; });
  _mContainerFollowers = [];
  _mCurContainer = newContainer;
  // ドラッグ元が属するコンテナに再入りする場合、ドラッグ開始時と mIsAbove が同一になるよう
  // ソースの元の mouseY を基準にする。
  const refMidY = (newContainer === _mSrcContainerEl) ? _mSrcOrigMidY : ghostMidY;
  if (newContainer) {
    const rootUnits = _mGetRootUnits();
    const ci = rootUnits.indexOf(newContainer);
    if (ci >= 0) _mContainerFollowers = rootUnits.slice(ci + 1).filter(u => u !== _mDraggedEl);
    _mSetActiveSiblings(_mGetFolderItems(newContainer), refMidY);
  } else {
    const srcIsF = loadPresets()[_mDragSrcIdx]?.type === 'folder';
    // ルートの非フォルダプリセットは全フォルダの下に必ず置く（セパレーターで区切る）。
    // アクティブ兄弟からフォルダ要素を除外し、
    // ルートアイテムの並び替え時にフォルダがスライドしないようにする。
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

  // --- ゴーストが現在どのコンテナ上にあるかを検出 ---
  // フォルダはネスト不可なので、フォルダドラッグ時はコンテナ検出をスキップ。
  const srcIsFolder = loadPresets()[_mDragSrcIdx]?.type === 'folder';
  // 常に実際のカーソル Y（= ghost top + pointerOffset）を全ての比較に使用。
  // ghostMidY はゴーストの位置決定にのみ使う。
  // 以前は非フォルダドラッグで ghostMidY（= mouseY + H/2 - offset）を使っていたため、
  // 検出/スライド挑発がカーソル位置から遅れる原因になっていた。
  const refY = ghostMidY - _mDraggedH / 2 + _mPointerOffsetY;  // = mouseY
  _mLastRefY = refY;

  // --- フォルダヘッダーのホバー（全フォルダ: 開いたもの、閉じたもの、空のもの）---
  // ヘッダー検出はコンテナ検出よりも優先される。
  // フォルダヘッダーをホバーすると青枠を表示し、フォルダ末尾へドロップする。
  let newFolderTarget = null;
  if (!srcIsFolder) {
    document.querySelectorAll('#presetList > .preset-folder').forEach(folder => {
      const hdr = folder.querySelector('.preset-folder-header');
      if (!hdr || +hdr.dataset.idx === _mDragSrcIdx) return;
      const r = hdr.getBoundingClientRect();
      if (refY >= r.top && refY <= r.bottom) newFolderTarget = hdr;
    });
  }

  // --- コンテナ検出（子エリア; ヘッダーホバー中はスキップ）---
  if (!srcIsFolder) {
    const newContainer = newFolderTarget ? null : _mDetectContainer(refY);
    if (newContainer !== _mCurContainer) {
      _mSwitchContainer(newContainer, refY);
    }
  }

  // フォルダヘッダーのハイライトを更新
  if (_mFolderTarget !== newFolderTarget) {
    clearTimeout(_mFolderHoverTimer); _mFolderHoverTimer = null;
    if (_mFolderTarget) _mFolderTarget.classList.remove('drag-over');
    _mFolderTarget = newFolderTarget;
    if (_mFolderTarget) {
      _mFolderTarget.classList.add('drag-over');
      // 閉じているフォルダなら一定時間後に自動展開
      const _fc = _mFolderTarget.nextElementSibling;
      if (_fc?.classList.contains('collapsed')) {
        _mFolderHoverTimer = setTimeout(() => {
          _mOpenFolder(_mFolderTarget);
          _mFolderHoverTimer = null;
        }, 700);
      }
    }
  }

  // --- 「新しいフォルダ」ボタンへのドロップターゲット（ルートプリセットのみ）---
  const srcIsRootPreset = !srcIsFolder && _mSrcContainerEl === null;
  const addFolderBtn = document.getElementById('presetAddFolderBtn');
  let newAddFolderTarget = false;
  if (srcIsRootPreset && addFolderBtn) {
    const r = addFolderBtn.getBoundingClientRect();
    newAddFolderTarget = refY >= r.top && refY <= r.bottom
      && ghostMidY - _mDraggedH / 2 <= r.bottom && ghostMidY + _mDraggedH / 2 >= r.top;
    // シンプルに: カーソル Y だけ確認
    newAddFolderTarget = refY >= r.top && refY <= r.bottom;
  }
  if (newAddFolderTarget !== _mAddFolderTarget) {
    _mAddFolderTarget = newAddFolderTarget;
    if (addFolderBtn) addFolderBtn.classList.toggle('drag-over', newAddFolderTarget);
  }

  // --- アクティブ兄弟要素をスライド ---
  const ghostIsExternal = _mCurContainer !== null && !_mCurContainer.contains(_mDraggedEl);
  // フォルダからルートレベルへの離脱は、外部からの挿入と同じ視覚的意味を持つ:
  // ゴーストは上から到着するため、ゴースト位置以下のアイテムは挿入ギャップを示すため下にスライドする。
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

  // --- コンテナフォロワー（_mCurContainer より後ろのルート要素）をプッシュ ---
  const visibleSibs = _mActiveSiblings.filter(s => s !== _mDraggedEl);
  const lastSib = visibleSibs[visibleSibs.length - 1];
  let followerShift = 0;
  if (_mCurContainer !== null) {
    if (ghostIsExternal) {
      // 外部からの挿入時は常に 1アイテム分（H+gap）フォルダが大きくなる。
      // フォルダ内のどこに挿入するかに関わらず、transform ベースのスライドはレイアウト高を変えないため
      // フォルダの拡大を視覚的に示すためフォロワーは常にシフトする必要がある。
      followerShift = _mDraggedH + _mDragGap;
    } else if (lastSib) {
      // 内部並び替え: 最後の兄弟要素が下に移動する場合のみシフトする。
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
// ゴースト Y と保存された元の midY を比較し、フラットなプリセット配列内の挿入インデックスを計算する。
function _mCalcInsertAt() {
  const list = loadPresets();
  const srcIsFolder = list[_mDragSrcIdx]?.type === 'folder';
  const sibs = _mActiveSiblings.filter(s => s !== _mDraggedEl && !s.classList.contains('preset-root-separator'));

  // --- ルートレベルへドロップされた非フォルダアイテム ---
  // データモデル上、ルートアイテムは必ず最初のフォルダエントリより前に置かなければならない。
  // 「F2 の末尾」でも F2 内になるため、insertAt を firstFolderIdx 以下に据える。
  if (_mCurContainer === null && !srcIsFolder) {
    const firstFolderIdx = list.findIndex(p => p.type === 'folder');
    let insertAfterSib = null;
    for (const sib of sibs) {
      if (+sib.dataset.mOrigMidY < _mLastRefY) insertAfterSib = sib;
    }
    if (insertAfterSib !== null) {
      const idx = +insertAfterSib.dataset.idx;
      // idx + 1 は常に firstFolderIdx 以下（sibs はルートアイテムのみ）
      return firstFolderIdx !== -1 ? Math.min(idx + 1, firstFolderIdx) : idx + 1;
    }
    // ゴーストが全ルートアイテムより上 → 最初のルートアイテムの前に挿入
    if (sibs.length > 0) return +sibs[0].dataset.idx;
    return firstFolderIdx !== -1 ? firstFolderIdx : list.length;
  }

  // --- ルートでのフォルダドラッグ、またはフォルダコンテナ内でのアイテムドラッグ ---
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

  // ゴーストが全アクティブ兄弟要素より上 → 最初の兄弟要素の前に挿入。
  if (sibs.length > 0) return +sibs[0].dataset.idx;

  // アクティブ兄弟要素なし（空のフォルダまたは空のルート）。
  if (_mCurContainer) return +_mCurContainer.dataset.idx + 1;

  return _mDragSrcIdx; // fallback: no change
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
    // 閉じた/空のフォルダ末尾へドロップ
    const folderIdx = +_mFolderTarget.dataset.idx;
    const list2 = loadPresets();
    const src = list2[_mDragSrcIdx];
    if (src?.type !== 'folder') {
      let insertAt = folderIdx + 1;
      while (insertAt < list2.length && list2[insertAt].type !== 'folder') insertAt++;
      const [moved] = list2.splice(_mDragSrcIdx, 1);
      if (insertAt > _mDragSrcIdx) insertAt--;
      list2.splice(insertAt, 0, moved);
      list2[folderIdx].open = true; // ドロップ後にフォルダを開く
      savePresets(list2);
      return insertAt; // 移動後の新インデックス
    }
    return null;
  }
  const insertAt = _mCalcInsertAt();
  const list2 = loadPresets();
  const src = list2[_mDragSrcIdx];
  let srcEnd = _mDragSrcIdx + 1;
  if (src?.type === 'folder') while (srcEnd < list2.length && list2[srcEnd].type !== 'folder') srcEnd++;
  const count = srcEnd - _mDragSrcIdx;
  // 結果が同一か確認（同じコンテナ内の同じ位置）
  const moved = list2.slice(_mDragSrcIdx, srcEnd);
  const testList = [...list2];
  testList.splice(_mDragSrcIdx, count);
  let fi = insertAt;
  if (fi > _mDragSrcIdx) fi -= count;
  fi = Math.max(0, fi);
  testList.splice(fi, 0, ...moved);
  if (JSON.stringify(testList) === JSON.stringify(list2)) return null; // no change
  list2.splice(_mDragSrcIdx, count);
  list2.splice(fi, 0, ...moved);
  savePresets(list2);
  return fi; // 移動後の新インデックス
}
// 移動閾値を超えた時点で一度だけ呼ばれる — ドラッグモードに確定
function _mStartDrag(pending) {
  const { unit, rect, downY } = pending;

  _mDragSrcIdx     = +unit.dataset.idx;
  _mDraggedEl      = unit;
  _mDraggedH       = rect.height;
  _mPointerOffsetY = downY - rect.top;

  // DOM 上のユニット位置から初期コンテナを検出
  const closestFolderChildren = unit.closest('.preset-folder-children');
  _mCurContainer = closestFolderChildren ? unit.closest('.preset-folder') : null;

  const srcIsFolder2 = loadPresets()[_mDragSrcIdx]?.type === 'folder';
  let initSibs;
  if (_mCurContainer) {
    initSibs = _mGetFolderItems(_mCurContainer);
  } else if (srcIsFolder2) {
    initSibs = _mGetRootUnits();
  } else {
    // ルートの非フォルダ: フォルダはスライドさせず、ルートアイテムのみスライド。
    // ルートアイテムは全フォルダの下に表示されるためフォルダは動かさない。
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
  const initMouseY = rect.top + _mPointerOffsetY;  // cursor Y at drag start
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
// 閖値フェーズのリスナー（ドラッグ確定前）
function _mOnPendingMove(e) {
  if (!_mPending) return;
  const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
  const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  if (Math.abs(y - _mPending.downY) < _M_THRESHOLD &&
      Math.abs(x - _mPending.downX) < _M_THRESHOLD) return;
  // 閾値超過 — 本ドラッグに切り替え
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
  // 「新しいフォルダ」ボタンへドロップ → 新フォルダを作成してプリセットを移動
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
    // フォルダ名を即編集状態に
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
  // まだ preventDefault しない — クリックが機能するよう移動閾値を待つ
  const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
  const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  _mPending = { downY: y, downX: x, unit: draggedUnit, rect: draggedUnit.getBoundingClientRect() };
  document.body.classList.add('preset-pending-drag');
  document.addEventListener('mousemove', _mOnPendingMove);
  document.addEventListener('mouseup',   _mOnPendingUp);
  document.addEventListener('touchmove', _mOnPendingMove, { passive: false });
  document.addEventListener('touchend',  _mOnPendingUp);
}
// イベント委譲：#presetList が描画されたら一度だけバインド
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
canvasWrap.addEventListener('dragover', e => {
  if (_isDraggingPreset) { e.preventDefault(); return; }
  e.preventDefault();
  canvasWrap.classList.add('canvas-drop-over');
  maskDropOverlay.classList.add('drag-active');
  syncMaskDropOverlay(); // ドラッグ中にマスクが動いた場合にも追従
});
canvasWrap.addEventListener('dragleave', e => {
  if (!e.relatedTarget || !canvasWrap.contains(e.relatedTarget)) {
    canvasWrap.classList.remove('canvas-drop-over');
    maskDropOverlay.classList.remove('drag-active', 'drag-over');
  }
});
canvasWrap.addEventListener('drop', e => {
  e.preventDefault();
  if (e.target === maskDropOverlay) return; // マスク上のdropはoverlayが処理
  processDropFiles(e, 0); // canvasWrap直接ドロップ → 背景(0)
});

// maskDropOverlay: マスク領域が本物のD&Dターゲット
maskDropOverlay.addEventListener('dragover', e => {
  e.preventDefault();
  e.stopPropagation(); // canvasWrapに伝播させない
  maskDropOverlay.classList.add('drag-over');
  canvasWrap.classList.add('canvas-drop-over');
});
maskDropOverlay.addEventListener('dragleave', () => {
  maskDropOverlay.classList.remove('drag-over');
});
maskDropOverlay.addEventListener('drop', e => {
  e.preventDefault();
  e.stopPropagation();
  processDropFiles(e, 1); // マスク上ドロップ → 前景(1)
});

// ============================================================
//  再生
// ============================================================
function setPlaying(playing) {
  S.playing = playing;
  playBtn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i>`;
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
    // play()直後の起動ズレを素早く補正するため、短いバースト検査
    _scheduleResync(80);
  }
}

async function syncPlay() {
  setPlaying(true);
  await _applyCompositeT(_compositeT);
}

function syncPause() {
  clearTimeout(_resyncTimer);
  _playDelayTimers.forEach(t => clearTimeout(t));
  _playDelayTimers = [];
  _compositeLastRaf = null;
  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].pause(); });
  setPlaying(false);
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

playBtn.addEventListener('click', () => {
  if (S.playing) syncPause(); else syncPlay();
});

const stopBtn = document.getElementById('stopBtn');
if (stopBtn) {
  stopBtn.addEventListener('click', () => { syncStop(); triggerTbtnGlow(stopBtn); });
}

// ============================================================
//  キーボードショートカット
// ============================================================
document.addEventListener('keydown', e => {
  // テキスト入力中は無視
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (document.activeElement?.contentEditable === 'true' || document.activeElement?.contentEditable === 'plaintext-only') return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (S.playing) syncPause(); else syncPlay();
      triggerTbtnGlow(playBtn);
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
  }
});



// ============================================================
//  スライダー
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

  // --- 単体リセットボタン ---
  const resetBtn = document.createElement('button');
  resetBtn.className = 'ctrl-reset-btn';
  resetBtn.title = 'リセット';
  resetBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
  resetBtn.addEventListener('click', () => {
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  });
  vl.insertAdjacentElement('afterend', resetBtn);
  lucide.createIcons({ nodes: [resetBtn] });
}

bindSlider('vol0',    'vol0Val',    v => `${Math.round(v)}`,    v => { vid[0].volume = (v / 100) ** 2; });
bindSlider('vol1',    'vol1Val',    v => `${Math.round(v)}`,    v => { vid[1].volume = (v / 100) ** 2; });

// ---- マスターボリューム (transport overlay) ----
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
  _applyMaster(); // 初期描画

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
  S.mask.w = v;
  if (S.arLock && S.mask.h > 0) {
    const newH = Math.max(10, Math.round(v / ar));
    S.mask.h = newH;
    const elH = document.getElementById('maskH');
    elH.value = newH;
    document.getElementById('maskHVal').value = newH;
    updateSliderFill(elH);
  }
});
bindSlider('maskH',   'maskHVal',   v => `${Math.round(v)}`,    v => {
  const ar = S.mask.h > 0 ? S.mask.w / S.mask.h : 1;
  S.mask.h = v;
  if (S.arLock && S.mask.w > 0) {
    const newW = Math.max(10, Math.round(v * ar));
    S.mask.w = newW;
    const elW = document.getElementById('maskW');
    elW.value = newW;
    document.getElementById('maskWVal').value = newW;
    updateSliderFill(elW);
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
bindSlider('blurAmt',  'blurAmtVal',  v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('borderOpacity', 'borderOpacityVal', v => `${Math.round(v)}`, null);
bindSlider('borderAnimSpeed', 'borderAnimSpeedVal', v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('borderAnimBright', 'borderAnimBrightVal', v => `${Math.round(v)}`, null);
let _syncBorderSwatch   = () => {};
let _closeBorderColorPop = () => {};
function _applyBorderAnim(anim) {
  elBorderAnim.value = anim;
  document.querySelectorAll('.banim-btn[data-anim]').forEach(b => b.classList.toggle('active', b.dataset.anim === anim));
  const on = anim !== 'none';
  document.getElementById('borderColRow').classList.toggle('anim-active', on);
  document.getElementById('borderAnimSpeedRow').style.display  = on ? '' : 'none';
  document.getElementById('borderAnimBrightRow').style.display = on ? '' : 'none';
  _syncBorderSwatch();
}
document.querySelectorAll('.banim-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = elBorderAnim.value === btn.dataset.anim ? 'none' : btn.dataset.anim;
    _applyBorderAnim(next);
    _closeBorderColorPop();
  });
});
// ── ボーダーカラーピッカー（HSV）───────────────────────────────
{
  const SOLID_PRESETS = [
    '#ffffff','#222222','#ff5555','#ff9933',
    '#ffdd33','#33dd77','#33aaff','#33eeff',
    '#aa55ff','#ff55bb','#ff8833','#00ffcc'
  ];
  const GRAD_MAP = {
    rainbow: 'conic-gradient(from 0deg, #ff7eb3, #ffb347, #f9f871, #6ee7b7, #93c5fd, #d8b4fe, #ff7eb3)',
    cm:      'linear-gradient(135deg,#22d3ee,#f472b6)',
    sakura:  'linear-gradient(135deg,#f472b6,#4ade80)',
    neon:    'linear-gradient(135deg,#4ade80,#22d3ee)',
    fire:    'linear-gradient(135deg,#ef4444,#f97316)',
    aurora:  'linear-gradient(135deg,#7c3aed,#34d399)',
  };

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
    picker.value = hex;
    _syncBorderSwatch();
    document.querySelectorAll('.bcp-chip').forEach(c => c.classList.toggle('active', c.dataset.color === hex));
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

  // プリセットカラーチップ
  SOLID_PRESETS.forEach(hex => {
    const btn = document.createElement('button');
    btn.className = 'bcp-chip'; btn.style.background = hex; btn.dataset.color = hex;
    btn.addEventListener('click', () => {
      _applyBorderAnim('none');
      picker.value = hex; _loadHex(hex); _applyColorState();
      _closeBorderColorPop();
    });
    solidRow.appendChild(btn);
  });
  // SV / 色相ドラッグ
  let _svDrag = false, _hueDrag = false, _wasDragging = false;
  function _pickSv(e) {
    const r = svCanvas.getBoundingClientRect();
    _s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    _v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    _applyBorderAnim('none'); _drawSv(); _applyColorState();
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

  // Hex 入力
  hexInput.addEventListener('change', () => {
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      _applyBorderAnim('none');
      picker.value = v; _loadHex(v); _applyColorState();
    }
  });

  // ネイティブカラーピッカー フォールバック
  picker.addEventListener('input', () => {
    _applyBorderAnim('none');
    _loadHex(picker.value); _applyColorState();
  });

  // スウォッチ同期
  _syncBorderSwatch = function () {
    const anim = elBorderAnim.value;
    swatch.style.background = anim !== 'none' ? (GRAD_MAP[anim] || picker.value) : picker.value;
  };
  _syncBorderSwatch();

  // 開閉
  function _openPop() {
    _loadHex(picker.value);
    popover.style.display = '';
    swatch.classList.add('active');
  }
  _closeBorderColorPop = function () {
    popover.style.display = 'none';
    swatch.classList.remove('active');
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

  // 初期描画
  _loadHex(picker.value);
}
bindSlider('filterBrightness', 'filterBrightnessVal', v => `${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterContrast',   'filterContrastVal',   v => `${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterHighlight',  'filterHighlightVal',  v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterShadow',     'filterShadowVal',     v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterSaturation', 'filterSaturationVal', v => `${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterHue',       'filterHueVal',       v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, () => updateCanvasFilter());
bindSlider('filterTemp',       'filterTempVal',       v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterTint',       'filterTintVal',       v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v)}`, null);
bindSlider('filterSharpness',  'filterSharpnessVal',  v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterVignette',   'filterVignetteVal',   v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterCA',         'filterCAVal',         v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterMatte',      'filterMatteVal',      v => `${parseFloat(v) % 1 === 0 ? parseInt(v) : parseFloat(v).toFixed(1)}`, null);
bindSlider('filterGrain',      'filterGrainVal',      v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);
bindSlider('filterPixel',      'filterPixelVal',      v => `${Math.round(v)}`, null);
bindSlider('filterFlare',      'filterFlareVal',      v => `${parseFloat(v) % 1 === 0 ? parseInt(v) : parseFloat(v).toFixed(1)}`, null);
bindSlider('filterBars',       'filterBarsVal',       v => v % 1 === 0 ? `${Math.round(v)}` : v.toFixed(1), null);

document.getElementById('filterVisBtn').addEventListener('click', () => {
  effectsHidden = !effectsHidden;
  const btn = document.getElementById('filterVisBtn');
  btn.innerHTML = effectsHidden
    ? '<i data-lucide="eye-off"></i>'
    : '<i data-lucide="eye"></i>';
  lucide.createIcons({ nodes: [btn] });
  updateCanvasFilter();
});

document.getElementById('filterResetBtn').addEventListener('click', () => {
  ['filterBrightness', 'filterContrast', 'filterHighlight', 'filterShadow', 'filterSaturation', 'filterHue', 'filterVignette', 'filterCA', 'filterTemp', 'filterTint', 'filterSharpness', 'filterMatte', 'filterGrain', 'filterPixel', 'filterFlare', 'filterBars'].forEach(id => {
    const el = document.getElementById(id);
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  });
});

// ---- クイックフィルタープリセット ----
// 全パラメータを明示的に列挙 — プリセット切り替え時に前回値を完全リセットするため。
//   filterBrightness : 0–200   (default 100)
//   filterContrast   : 0–200   (default 100)
//   filterHighlight  : -100–100 (default 0)
//   filterShadow     : -100–100 (default 0)
//   filterSaturation : 0–200   (default 100)
//   filterHue        : -180–180 (default 0)
//   filterTemp       : -50–50  (default 0)
//   filterTint       : -50–50  (default 0)
//   filterSharpness  : 0–10    (default 0)
//   filterCA         : 0–10    (default 0)
//   filterVignette   : 0–10    (default 0)
//   filterMatte      : 0–10    (default 0)  ← 黒浮き + 白浮き同時
//   filterGrain      : 0–10    (default 0)
//   filterFlare      : 0–10    (default 0)
//   filterBars       : 0–10    (default 0)
//   filterPixel      : 0–10    (default 0)
const _FQP = {
  //            bright  cont   hl     sh     sat    hue    temp   tint   sharp  ca     vig    matte  grain  flare  bars   pixel
  cinema:  { filterBrightness: 95,  filterContrast: 122, filterHighlight: -15, filterShadow: +10, filterSaturation: 80,  filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 1.5, filterCA: 0.5, filterVignette: 4,   filterMatte: 5,   filterGrain: 0.8, filterFlare: 0,   filterBars: 5,   filterPixel: 0 },
  retro:   { filterBrightness: 105, filterContrast: 88,  filterHighlight: -20, filterShadow: +25, filterSaturation: 58,  filterHue: 0, filterTemp: +22, filterTint:  -8, filterSharpness: 0,   filterCA: 0,   filterVignette: 5,   filterMatte: 7,   filterGrain: 2.5, filterFlare: 1.5, filterBars: 0,   filterPixel: 0 },
  insta:   { filterBrightness: 112, filterContrast: 108, filterHighlight:   0, filterShadow:   0, filterSaturation: 128, filterHue: 0, filterTemp: +10, filterTint:   0, filterSharpness: 2,   filterCA: 0,   filterVignette: 1.5, filterMatte: 0,   filterGrain: 0,   filterFlare: 0.5, filterBars: 0,   filterPixel: 0 },
  pastel:  { filterBrightness: 130, filterContrast: 90,  filterHighlight:   0, filterShadow: +30, filterSaturation: 80,  filterHue: 0, filterTemp:   0, filterTint:  +5, filterSharpness: 0,   filterCA: 0,   filterVignette: 0,   filterMatte: 6,   filterGrain: 0,   filterFlare: 0,   filterBars: 0,   filterPixel: 0 },
  neon:    { filterBrightness: 88,  filterContrast: 138, filterHighlight: +20, filterShadow:   0, filterSaturation: 175, filterHue: 0, filterTemp: -18, filterTint: -10, filterSharpness: 0,   filterCA: 1.8, filterVignette: 7,   filterMatte: 0,   filterGrain: 0.5, filterFlare: 3.5, filterBars: 0,   filterPixel: 0 },
  sunset:  { filterBrightness: 108, filterContrast: 112, filterHighlight:   0, filterShadow:   0, filterSaturation: 135, filterHue: 0, filterTemp: +38, filterTint:  -5, filterSharpness: 1,   filterCA: 0,   filterVignette: 3,   filterMatte: 0,   filterGrain: 0,   filterFlare: 4.5, filterBars: 0,   filterPixel: 0 },
  cool:    { filterBrightness: 100, filterContrast: 108, filterHighlight:   0, filterShadow:   0, filterSaturation: 78,  filterHue: 0, filterTemp: -28, filterTint:   0, filterSharpness: 1.5, filterCA: 0,   filterVignette: 3,   filterMatte: 0,   filterGrain: 0,   filterFlare: 0,   filterBars: 0,   filterPixel: 0 },
  dreamy:  { filterBrightness: 108, filterContrast: 78,  filterHighlight: +10, filterShadow: +20, filterSaturation: 85,  filterHue: 0, filterTemp: +15, filterTint:   0, filterSharpness: 0,   filterCA: 0,   filterVignette: 2,   filterMatte: 7,   filterGrain: 0,   filterFlare: 3,   filterBars: 0,   filterPixel: 0 },
  glitch:  { filterBrightness: 100, filterContrast: 122, filterHighlight:   0, filterShadow:   0, filterSaturation: 120, filterHue: 0, filterTemp:   0, filterTint:   0, filterSharpness: 0,   filterCA: 4.5, filterVignette: 2,   filterMatte: 0,   filterGrain: 2,   filterFlare: 0,   filterBars: 0,   filterPixel: 0 },
  noir:    { filterBrightness: 90,  filterContrast: 148, filterHighlight: -30, filterShadow: -20, filterSaturation: 12,  filterHue: 0, filterTemp:  -5, filterTint:   0, filterSharpness: 2,   filterCA: 0,   filterVignette: 8,   filterMatte: 3,   filterGrain: 1.2, filterFlare: 0,   filterBars: 3,   filterPixel: 0 },
  horror:  { filterBrightness: 83,  filterContrast: 130, filterHighlight:   0, filterShadow: -15, filterSaturation: 30,  filterHue: 0, filterTemp:  -8, filterTint:  -8, filterSharpness: 0,   filterCA: 0.5, filterVignette: 9,   filterMatte: 0,   filterGrain: 3.5, filterFlare: 0,   filterBars: 0,   filterPixel: 0 },
  modern:  { filterBrightness: 95,  filterContrast: 120, filterHighlight:   0, filterShadow:   0, filterSaturation: 110, filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 2,   filterCA: 2,   filterVignette: 0,   filterMatte: 0,   filterGrain: 0,   filterFlare: 1.5, filterBars: 0,   filterPixel: 0 },
  trend:   { filterBrightness: 90,  filterContrast: 150, filterHighlight:   0, filterShadow:   0, filterSaturation: 180, filterHue: 0, filterTemp: -10, filterTint:   0, filterSharpness: 0,   filterCA: 0,   filterVignette: 0,   filterMatte: 5,   filterGrain: 0,   filterFlare: 2,   filterBars: 0,   filterPixel: 0 },
};
document.querySelectorAll('.fqp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = _FQP[btn.dataset.fqp];
    if (!p) return;
    Object.entries(p).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val;
      el.dispatchEvent(new Event('input'));
    });
  });
});

// ミュートボタン
const _muteVolume = [null, null]; // ミュート前の音量を保持
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
document.querySelectorAll('.shape-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.mask.shape = btn.dataset.shape;
    if (btn.dataset.shape === 'heart') {
      // ハート → 大きい方に揃えてアス比ロックを自動ON
      const side = Math.max(S.mask.w, S.mask.h);
      S.mask.w = side; S.mask.h = side;
      ['maskW','maskH'].forEach(id => {
        const el = document.getElementById(id);
        el.value = Math.round(side);
        document.getElementById(id + 'Val').value = Math.round(side);
        updateSliderFill(el);
      });
      if (!S.arLock) { S.arLock = true; _updateArLockBtn(); }
    } else {
      // ハート以外に切り替えたらロックを自動OFF
      if (S.arLock) { S.arLock = false; _updateArLockBtn(); }
    }
  });
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

// ---- マスクリセット ----
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
  const dw = 400, dh = 400;
  S.mask.x = Math.round((cw - dw) / 2);
  S.mask.y = Math.round((ch - dh) / 2);
  S.mask.w = dw;
  S.mask.h = dh;
  // shape はそのまま
  S.arLock = false;
  _updateArLockBtn();
  // スライダーを defaultValue（HTML の value 属性）にリセット
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
  setSliderValue('maskW', dw);
  setSliderValue('maskH', dh);
  _syncOffsetSliders();
  ['blurAmt', 'borderW', 'borderOpacity', 'borderSpeed', 'borderGlow'].forEach(resetSlider);
  document.getElementById('borderColor').value =
    document.getElementById('borderColor').defaultValue || '#ffffff';
  lucide.createIcons();
});

// ============================================================
//  動画の入れ替え
// ============================================================
function swapVideos() {
  // 動画/画像要素の参照をそのまま入れ替え → pause/load不要、再生位置そのまま
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

  // ボリュームを再割当て（スライダーと入れ替え前後の整合）
  if (mediaType[0] === 'video') vid[0].volume = (parseFloat(document.getElementById('vol0').value) / 100) ** 2;
  if (mediaType[1] === 'video') vid[1].volume = (parseFloat(document.getElementById('vol1').value) / 100) ** 2;

  // 動画専用コントロールの表示/非表示
  updateMediaControls(0);
  updateMediaControls(1);

  // ドロップゾーン入れ替え
  const zone1 = document.getElementById('drop0');
  const zone2 = document.getElementById('drop1');
  const lbl1  = zone1.querySelector('.drop-label0');
  const lbl2  = zone2.querySelector('.drop-label1');
  [lbl1.textContent, lbl2.textContent] = [lbl2.textContent, lbl1.textContent];
  // スワップ: アニメーションを発火させず loaded クラスと凍結状態だけを交換する
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
}

document.getElementById('swapBtn').addEventListener('click', swapVideos);

// ホイールクリックでも入れ替え
canvas.addEventListener('mousedown', e => {
  if (e.button === 1) { e.preventDefault(); swapVideos(); }
});

// ============================================================
//  マスクドラッグ + リサイズ（マウス + タッチ）
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
    // ハート型バウンディングボックスで粗チェック後、パスで厳密判定
    if (px < x || px > x + w || py < y || py > y + h) return false;
    const tmp = document.createElement('canvas');
    tmp.width = w + 2; tmp.height = h + 2;
    const tc = tmp.getContext('2d');
    buildMaskPath(tc, { x: 0, y: 0, w, h, shape: 'heart' });
    return tc.isPointInPath(px - x, py - y);
  }
  return false;
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
      // 左右エッジ → 幅で決めて高さ追従、y は中心固定
      if (hid === 'ml') { x = sm.x + dx; w = sm.w - dx; }
      if (hid === 'mr') { w = sm.w + dx; }
      if (w < MIN) { w = MIN; if (hid === 'ml') x = sm.x + sm.w - MIN; }
      const newH = w / ar;
      y = sm.y + (sm.h - newH) / 2;
      h = newH;
    } else { // tc / bc
      // 上下エッジ → 高さで決めて幅追従、x は中心固定
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
  S.mask.x = Math.round(x); S.mask.y = Math.round(y); S.mask.w = Math.round(w); S.mask.h = Math.round(h);
  // スライダーを同期
  const elMaskW = document.getElementById('maskW');
  const elMaskH = document.getElementById('maskH');
  elMaskW.value = Math.round(w);
  document.getElementById('maskWVal').value = Math.round(w);
  elMaskH.value = Math.round(h);
  document.getElementById('maskHVal').value = Math.round(h);
  updateSliderFill(elMaskW);
  updateSliderFill(elMaskH);
}

function startDrag(e, p) {
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
  if (e.button === 2) return; // 右クリックは startDrag に渡さない
  if (_maskFollowMode) return; // 追従モード中はドラッグ/ハンドル操作を無効化
  _canvasClickMoved = false;
  startDrag(e, canvasCoords(e));
});
canvas.addEventListener('click', () => {
  if (_canvasClickMoved) return;
  if (S.playing) syncPause(); else syncPlay();
});

// ---- マスク追従モード (右クリック) ----
// _maskFollowMode / _followTargetX,Y はファイル先頭で宣言済み

function _setMaskFollow(active) {
  _maskFollowMode = active;
  canvasWrap.classList.toggle('mask-follow', active);
}

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (_maskFollowMode) {
    _setMaskFollow(false);
  } else {
    const p = canvasCoords(e);
    _followTargetX = p.x;
    _followTargetY = p.y;
    _setMaskFollow(true);
  }
});

canvas.addEventListener('wheel', e => {
  if (!_maskFollowMode && !S.maskHovered) return;
  e.preventDefault();
  const step = e.deltaY < 0 ? 10 : -10;
  const ar = S.mask.h > 0 ? S.mask.w / S.mask.h : 1;
  const cx = S.mask.x + S.mask.w / 2;
  const cy = S.mask.y + S.mask.h / 2;
  const newW = Math.max(20, S.mask.w + step);
  const newH = Math.max(20, Math.round(newW / ar));
  S.mask.w = newW;
  S.mask.h = newH;
  S.mask.x = Math.round(cx - newW / 2);
  S.mask.y = Math.round(cy - newH / 2);
  _followTargetX = cx;
  _followTargetY = cy;
  _syncMaskSliders();
}, { passive: false });

canvas.addEventListener('mouseleave', () => { S.maskHovered = false; });

let _modalOpen = false;

document.addEventListener('mousemove', e => {
  if (_modalOpen) return;
  const p = canvasCoords(e);
  if (_maskFollowMode) {
    S.mask.x = Math.round(p.x - S.mask.w / 2);
    S.mask.y = Math.round(p.y - S.mask.h / 2);
    _followTargetX = p.x;
    _followTargetY = p.y;
    S.maskHovered = false;
    _syncOffsetSliders();
    return;
  }
  if (!S.drag.active) {
    const hh     = hitTestHandle(p.x, p.y);
    const inMask = hitTestMask(p.x, p.y);
    S.maskHovered = !!(hh || inMask);
    canvas.style.cursor = hh ? hh.cur : (inMask ? 'grab' : 'default');
    return;
  }
  _canvasClickMoved = true;
  if (S.drag.mode === 'move') {
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
  if (S.drag.mode === 'move') {
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
//  プログレスバー
// ============================================================
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateProgress() {
  const refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration
               : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration : 0;
  if (!refDur) return;
  const pct = Math.min(1, Math.max(0, _compositeT / refDur));
  elProgressFill.style.width = `${pct * 100}%`;
  elProgressThumb.style.left = `${pct * 100}%`;
  elTimeLabel.textContent = `${fmtTime(Math.min(_compositeT, refDur))} / ${fmtTime(refDur)}`;
}

// シークバードラッグ
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
//  Page Visibility — 非アクティブ時に動画停止
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    vid[0].pause();
    vid[1].pause();
  } else if (S.playing) {
    if (loaded[0]) vid[0].play();
    if (loaded[1]) vid[1].play();
  }
});

function applyLang(lang) {
  _lang = lang;
  localStorage.setItem('gf-lang', lang);
  document.documentElement.lang = lang;
  // 言語ダイアログのアクティブ状態を更新
  rebuildLangDialog();
  // テキストノード
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    // 動画ロード済の dropラベルは更新しない（ファイル名が表示されているため）
    if (el.classList.contains('drop-label0') && loaded[0]) return;
    if (el.classList.contains('drop-label1') && loaded[1]) return;
    el.textContent = t(key);
  });
  // HTML コンテンツ（<br> などのタグを含む）
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  // プレースホルダー
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  // title 属性 / ツールチップ
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  // innerHTML でテキストをセットする動的要素
  const isNowDark = document.documentElement.dataset.theme === 'dark';
  document.getElementById('themeBtn').innerHTML =
    `<i data-lucide="${isNowDark ? 'moon' : 'sun'}"></i>`;
  document.getElementById('themeBtn').title = t(isNowDark ? 'mode-dark' : 'mode-light');
  const isTheater = document.querySelector('.app-body').classList.contains('theater');
  document.getElementById('theaterBtn').title = t(isTheater ? 'theater-close' : 'theater-open');
  const isFs = !!document.fullscreenElement;
  document.getElementById('fullscreenBtn').title = t(isFs ? 'fs-close' : 'fs-open');
  if (_presetsReady) renderPresets();
  lucide.createIcons();
}

// ============================================================
//  テーマ切り替え
// ============================================================
document.getElementById('themeBtn').addEventListener('click', () => {
  const html = document.documentElement;
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  _readCssVars(); // CSS変数キャッシュを更新
  document.getElementById('themeBtn').innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
  document.getElementById('themeBtn').title = t(isDark ? 'mode-light' : 'mode-dark');
  // 枠色デフォルトをテーマに合わせて更新（ユーザーが変えていない初期値のみ）
  const bc = document.getElementById('borderColor');
  if (bc.value === '#ffffff' || bc.value === '#5c6370') {
    bc.value = '#ffffff';
  }
  lucide.createIcons();
});

// ドロップダウン内の言語オプションを構築
function rebuildLangDialog() {
  const list = document.getElementById('langOptionList');
  list.innerHTML = '';
  // 外部追加言語のコード一覧
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
      // 削除ボタンのクリック
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
  // 「+ 追加」行 — インポートフォームの開閉切り替え
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
      // キャンセル（section を閉じた）→ 言語ポップ全体も閉じる
      document.getElementById('langImportDialog').hidden = true;
    }
  });
  list.appendChild(addBtn);
}
rebuildLangDialog();

// アイコン初期描画 + 言語設定
lucide.createIcons();
applyLang(_lang);

// ============================================================
//  言語インポートダイアログ
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

  // 外側クリックでポップオーバーを閉じる
  document.addEventListener('click', (e) => {
    if (dialog.hidden) return;
    if (dialog.contains(e.target)) return;
    closePopover();
  });
  dialog.addEventListener('click', (e) => e.stopPropagation());

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

  // ドロップゾーンへの D&D（動画ファイルは無視）
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

  // ドロップゾーンクリックでファイルピッカーを開く
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
//  プリセット（localStorage）
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
    borderW:       document.getElementById('borderW').value,
    borderOpacity: document.getElementById('borderOpacity').value,
    borderColor:   document.getElementById('borderColor').value,
    borderAnim:    document.getElementById('borderAnim').value,
    borderAnimSpeed:  document.getElementById('borderAnimSpeed').value,
    borderAnimBright: document.getElementById('borderAnimBright').value,
    blurAmt:       document.getElementById('blurAmt').value,
    filterBrightness: document.getElementById('filterBrightness').value,
    filterContrast:   document.getElementById('filterContrast').value,
    filterHighlight:  document.getElementById('filterHighlight').value,
    filterShadow:     document.getElementById('filterShadow').value,
    filterSaturation: document.getElementById('filterSaturation').value,
    filterHue:        document.getElementById('filterHue').value,
    filterTemp:       document.getElementById('filterTemp').value,
    filterTint:       document.getElementById('filterTint').value,
    filterSharpness:  document.getElementById('filterSharpness').value,
    filterVignette:   document.getElementById('filterVignette').value,
    filterCA:         document.getElementById('filterCA').value,
    filterMatte:      document.getElementById('filterMatte').value,
    filterGrain:      document.getElementById('filterGrain').value,
    filterPixel:      document.getElementById('filterPixel').value,
    filterFlare:      document.getElementById('filterFlare').value,
    filterBars:       document.getElementById('filterBars').value,
    theme:         document.documentElement.dataset.theme,
    vid0Name:      _loadedFileName[0],
    vid1Name:      _loadedFileName[1],
    vid0Url:       _loadedSrcUrl[0] || _loadedPageUrl[0],
    vid1Url:       _loadedSrcUrl[1] || _loadedPageUrl[1],
  };
}

function applySettings(d) {
  const sliders = [
    ['vol0','vol0Val'],['offset0','offset0Val'],
    ['vol1','vol1Val'],['offset1','offset1Val'],
    ['maskW','maskWVal'],['maskH','maskHVal'],
    ['borderW','borderWVal'],['borderOpacity','borderOpacityVal'],['blurAmt','blurAmtVal'],
    ['filterBrightness','filterBrightnessVal'],['filterContrast','filterContrastVal'],
    ['filterHighlight','filterHighlightVal'],['filterShadow','filterShadowVal'],
    ['filterSaturation','filterSaturationVal'],['filterHue','filterHueVal'],['filterVignette','filterVignetteVal'],
    ['filterCA','filterCAVal'],
    ['filterTemp','filterTempVal'],['filterTint','filterTintVal'],['filterSharpness','filterSharpnessVal'],
    ['filterMatte','filterMatteVal'],['filterGrain','filterGrainVal'],
    ['filterPixel','filterPixelVal'],
    ['filterFlare','filterFlareVal'],
    ['filterBars','filterBarsVal'],
  ];
  const vals = {
    vol0: d.vol0, offset0: d.offset0,
    vol1: d.vol1, offset1: d.offset1,
    maskW: d.maskW, maskH: d.maskH,
    borderW: d.borderW, borderOpacity: d.borderOpacity, blurAmt: d.blurAmt,
    filterBrightness: d.filterBrightness, filterContrast: d.filterContrast,
    filterHighlight: d.filterHighlight ?? 0, filterShadow: d.filterShadow ?? 0,
    filterSaturation: d.filterSaturation, filterHue: d.filterHue ?? 0, filterVignette: d.filterVignette,
    filterCA: d.filterCA,
    filterTemp: d.filterTemp, filterTint: d.filterTint ?? 0, filterSharpness: d.filterSharpness ?? 0,
    filterMatte: d.filterMatte, filterGrain: d.filterGrain,
    filterPixel: d.filterPixel,
    filterFlare: d.filterFlare,
    filterBars: d.filterBars,
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
    _applyBorderAnim(d.borderAnim);
  }
  if (d.maskShape) {
    S.mask.shape = d.maskShape;
    document.querySelectorAll('.shape-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.shape === d.maskShape);
    });
  }
  // 動画ロードで AR が変化しても正しいマスクを復元できるよう pending に保存
  // srcW/srcH にプリセット保存時のバッファサイズを記録し、異なる解像度でも正確に変換できるようにする
  if (d.maskW != null) {
    _pendingMask = {
      w: +d.maskW,
      h: +d.maskH,
      x: d.maskX != null ? +d.maskX : null,
      y: d.maskY != null ? +d.maskY : null,
      srcW: d.bufW ? +d.bufW : null,  // 保存時のバッファ幅 (旧プリセットは null)
      srcH: d.bufH ? +d.bufH : null,
    };
    // bufW/bufH があれば正しい AR で即座に適用、なければ現バッファで直接適用
    if (_bufferSynced) {
      if (d.bufW && d.bufH) {
        setCanvasAspectRatio(+d.bufW, +d.bufH); // _pendingMask も内部で消費される
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
  if (d.theme && d.theme !== document.documentElement.dataset.theme) {
    document.documentElement.dataset.theme = d.theme;
    const isDark = d.theme === 'dark';
    document.getElementById('themeBtn').innerHTML =
      `<i data-lucide="${isDark ? 'moon' : 'sun'}"></i>`;
    document.getElementById('themeBtn').title = t(isDark ? 'mode-dark' : 'mode-light');
    lucide.createIcons();
  }
  // 動画ロード後のマスク枠フェードイン準備
  if (d.borderW != null && parseFloat(d.borderW) > 0) {
    _maskBorderFadeStart = loaded[1] ? performance.now() : 0;
  }
  updateCanvasFilter();
}

function loadPresets() { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); }
function savePresets(list) { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); }

// HTML特殊文字をエスケープしてXSSを防ぐ
function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  // ---- ヘルパー: 任意の名前要素のインライン名前変更 ----
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

  // ---- リストをルートアイテムとフォルダセクションに分解 ----
  if (list.length === 0) {
    el.innerHTML = `<div class="preset-empty">${t('preset-empty')}</div>`;
    _bindPresetAddBtn();
    return;
  }
  // ルートアイテム = フォルダより前（データ先頭）にあるプリセット
  // 表示はフォルダの後（下）に出す
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
  // フォルダがなければメインループで全アイテムがrootItemsに入っている（追加処理不要）
  const firstFolderIdx = folderSections.length > 0 ? folderSections[0].folderIdx : -1;
  // rootInsertIdx: ルートアイテムを挿入する位置（firstFolderIdxの直前 = ルート末尾）
  const rootInsertIdx = firstFolderIdx !== -1 ? firstFolderIdx : list.length;

  const presetItemHTML = (p, i, isChild) => {
    const n0 = p.data.vid0Name, n1 = p.data.vid1Name;
    let fileHint = '';
    if (n0 || n1) {
      const lines = [n0, n1].filter(Boolean)
        .map(n => `<span class="preset-file-line"><span class="pname-inner">${_esc(n)}</span></span>`)
        .join('');
      fileHint = `<span class="preset-item-files">${lines}</span>`;
    } else if (!p.data.presetId) {
      fileHint = `<span class="preset-item-files"><span class="preset-file-line"><span class="pname-inner">${t('preset-no-video')}</span></span></span>`;
    }
    const isActive = i === _activePresetIdx;
    const saveBtn = isActive
      ? `<button class="preset-item-del preset-item-save" data-idx="${i}" title="${t('preset-save-title')}"><i data-lucide="save"></i></button>`
      : '';
    return `<div class="preset-item${isChild ? ' preset-item-child' : ''}${isActive ? ' preset-item--active' : ''}" data-idx="${i}" tabindex="0">
        <span class="preset-drag-handle"><i data-lucide="grip-vertical"></i></span>
        <div class="preset-item-info" data-idx="${i}">
          <span class="preset-item-name"><span class="pname-inner">${_esc(p.name)}</span></span>
          ${fileHint}
        </div>
        <div class="preset-item-actions">
          ${saveBtn}
          <button class="preset-item-del preset-item-rename" data-idx="${i}" title="${t('preset-rename-title')}"><i data-lucide="pencil"></i></button>
          <button class="preset-item-del preset-item-share" data-idx="${i}" title="${t('preset-copy-title')}"><i data-lucide="copy"></i></button>
          <button class="preset-item-del preset-item-delete" data-idx="${i}" title="${t('preset-del-title')}"><i data-lucide="x"></i></button>
        </div>
      </div>`;
  };
  const dz = (insertIdx) => `<div class="preset-dropzone" data-insert="${insertIdx}"></div>`;
  // ルート専用ドロップゾーン（フォルダの外へ脱出させる）
  const rootDz = () => `<div class="preset-dropzone preset-dropzone-eject" data-insert="${rootInsertIdx}" data-root="true"></div>`;

  let html = '';

  // 1. フォルダセクション
  folderSections.forEach(({ folder, folderIdx, children }, fi) => {
    const countBadge = ``;
    // 各フォルダの前にドロップゾーン（フォルダの並び替え用）
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
    // フォルダ内末尾ドロップゾーン
    const lastChildIdx = children.length > 0 ? children[children.length - 1].idx + 1 : folderIdx + 1;
    html += dz(lastChildIdx);
    html += `</div></div>`;
  });

  // 2. フォルダ外脱出ゾーン + ルート末尾（フォルダがある場合のみ、D&D中に表示）
  // 3. ルートアイテム（フォルダの下に表示）
  if (folderSections.length > 0 && rootItems.length > 0) {
    html += '<hr class="preset-root-separator ctrl-mini-sep" aria-hidden="true">';
  }
  rootItems.forEach(({ item, idx }) => {
    html += dz(idx);
    html += presetItemHTML(item, idx, false);
  });
  // ルート末尾ドロップゾーン（フォルダがある場合のみ表示）
  if (folderSections.length > 0) {
    html += rootDz();
  }

  el.innerHTML = html;
  lucide.createIcons();

  // ---- プリセット名ホバースライド: はみ出す名前に overflows クラスとスライド距離を設定 ----
  // 非ホバー時: 現在の clientWidth で初期計算
  // ホバー時: mouseenter で実際のホバー後の clientWidth を使って再計算
  //           (actions が展開した後の正確な幅でスライド距離を決める)
  function _calcOverflows(item) {
    item.querySelectorAll('.pname-inner').forEach(inner => {
      const outer = inner.parentElement;
      const overflow = inner.scrollWidth - outer.clientWidth;
      if (overflow > 2) {
        inner.classList.add('overflows');
        // mask-imageのフェードゾーン(3%)分を加算して終端の文字が隠れないようにする
        const fadeZone = outer.clientWidth * 0.03;
        inner.style.setProperty('--slide-dist', `-${overflow + fadeZone}px`);
      } else {
        inner.classList.remove('overflows');
        inner.style.removeProperty('--slide-dist');
      }
    });
  }
  requestAnimationFrame(() => {
    el.querySelectorAll('.preset-item, .preset-folder-header').forEach(item => {
      _calcOverflows(item);
      item.addEventListener('mouseenter', () => _calcOverflows(item));
    });
  });

  // ---- Folder toggle (header全体クリックで開閉、ボタンは除外) ----
  el.querySelectorAll('.preset-folder-header').forEach(header => {
    header.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (e.target.closest('[contenteditable]:not([contenteditable="false"])')) return;
      const idx = +header.dataset.idx;
      const children = header.nextElementSibling;
      const isCollapsed = children.classList.toggle('collapsed');
      // トグルアイコン更新
      const icon = header.querySelector('.preset-folder-toggle i');
      if (icon) { icon.setAttribute('data-lucide', isCollapsed ? 'chevron-right' : 'chevron-down'); lucide.createIcons(); }
      // データ保存
      const list2 = loadPresets();
      if (list2[idx]) { list2[idx].open = !isCollapsed; savePresets(list2); }
    });
  });

  // ---- プリセットクリックで読み込み ----
  el.querySelectorAll('.preset-item-info').forEach(info => {
    info.addEventListener('click', async e => {
      // リネーム中のクリックは無視
      if (e.target.closest('[contenteditable]:not([contenteditable="false"])')) return;
      const idx = +info.dataset.idx;
      const p = loadPresets()[idx];
      if (!p || p.type === 'folder') return;
      syncStop();
      applySettings(p.data);
      _activePresetIdx = idx;
      _f2Target = { type: 'preset', idx };
      renderPresets();
      // 新しい動画を読み込む前に両レイヤーをクリア（旧動画が残らないように）
      loaded[0] = false; loaded[1] = false;
      _stopBitmapCapture(0); _stopBitmapCapture(1);
      // 枠は全動画のロード完了まで非表示にする
      _maskBorderFadeStart = 0;
      _fgFadeStart = 0;
      let needsRender = false;
      let vid1HasSource = false;
      for (const i of [0, 1]) {
        const handle = p.data.presetId
          ? await _IDB.get(`preset_${p.data.presetId}_${i}`).catch(() => null)
          : null;
        if (handle) {
          if (i === 1) vid1HasSource = true;
          await loadVideoFromHandle(i, handle);
        } else {
          const savedUrl = p.data[`vid${i}Url`];
          if (savedUrl) {
            if (i === 1) vid1HasSource = true;
            const urlInput = document.getElementById(`urlInput${i}`);
            if (urlInput) urlInput.value = savedUrl;
            await loadVideoFromURL(i, savedUrl);
            const resolved = _loadedFileName[i];
            if (resolved && resolved !== p.data[`vid${i}Name`]) {
              const list2 = loadPresets();
              if (list2[idx]) { list2[idx].data[`vid${i}Name`] = resolved; savePresets(list2); needsRender = true; }
            }
          }
        }
      }
      // vid1 がない場合のみここで枠フェードイン開始（vid1 がある場合は onloadedmetadata と同時に開始）
      if (!vid1HasSource && _maskBorderFadeStart === 0) _maskBorderFadeStart = performance.now();
      // _fgFadeStart は onloadedmetadata で vid1 実際のロード完了時にのみセットされる
      if (needsRender) renderPresets();
    });
  });

  // ---- 保存 / 上書き ----
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

  // ---- 名前変更（プリセット & フォルダ）----
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

  // ---- 共有（プリセット & フォルダ）----
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
        // 先頭行にフォルダ名ヘッダーを付与してフォルダ構造を保持
        const folderHeader = 'gff~' + encodeURIComponent(p.name || 'フォルダ');
        code = [folderHeader, ...children.map(c => _presetEncodeOne(c))].join('\n');
      } else {
        code = _presetEncodeOne(p);
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

  // ---- 削除（プリセット & フォルダ）----
  el.querySelectorAll('.preset-item-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const list2 = loadPresets();
      const p = list2[idx];
      const msgKey = p.type === 'folder' ? 'del-confirm-folder' : 'del-confirm';
      _showDelPopup(btn, t(msgKey).replace('{name}', p.name), async () => {
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
      });
    });
  });

  _bindPresetAddBtn();
}

// 現在の設定を自動命名で保存（最後のフォルダの中、またはルート末尾に追加）
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
  // フォルダより前（ルート末尾）に挿入して、フォルダ内に入らないようにする
  const firstFolderIdx = list.findIndex(p => p.type === 'folder');
  if (firstFolderIdx === -1) {
    list.push({ name, data });
  } else {
    list.splice(firstFolderIdx, 0, { name, data });
  }
  savePresets(list);
  renderPresets();
  // 追加したプリセット名をすぐ編集状態に
  requestAnimationFrame(() => {
    const items = document.querySelectorAll('.preset-item');
    // フォルダより前（先頭）に挿入されたのでindex=firstFolderIdxに相当するDOM要素を探す
    // data-idxで対応するボタンがあるアイテムを特定
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
// F2 リネーム: 最後にクリックされた対象（フォルダ or プリセット）をインデックスで追跡
let _f2Target = null; // { type: 'folder'|'preset', idx: number }
document.getElementById('presetList').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return; // ボタンクリックはスキップ
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
  // フォーカス中の要素を優先、なければ _f2Target、プリセットは _activePresetIdx にフォールバック
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

// フォルダ追加
document.getElementById('presetAddFolderBtn').addEventListener('click', () => {
  const list = loadPresets();
  list.push({ type: 'folder', name: t('folder-new'), open: true });
  savePresets(list);
  renderPresets();
  // 追加したフォルダ名をすぐ編集状態に
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

// インライン取込
const _doInlineImport = async (rawOverride) => {
  const inp = document.getElementById('presetCodeInput');
  // 全角チルダ各種をASCII ~に正規化し、先頭の不可視文字も除去
  // rawOverride が文字列でない場合（Eventオブジェクト等）は inp.value を使用
  const raw = (typeof rawOverride === 'string' ? rawOverride : inp.value)
    .replace(/[\uFF5E\u301C\u02DC\u2053\u223C\u3030\uFE4B\uFE4F]/g, '~').trim();
  if (!raw) return;
  let arr;
  try {
    const gf2Idx = raw.indexOf('gf2~');
    const gffIdx  = raw.indexOf('gff~');
    if (gffIdx !== -1) {
      // フォルダコピー形式: gff~名前 + gf2~ プリセット群
      // 改行・スペース等あらゆるセパレーターに対応 — gff~/gf2~ の直前で分割
      const allLines = raw.split(/\s+(?=gf[f2]~)/).map(l => l.trim()).filter(l => l);
      const gffLine = allLines.find(l => l.startsWith('gff~'));
      if (gffLine) {
        let folderName;
        try { folderName = decodeURIComponent(gffLine.slice(4)); } catch { folderName = gffLine.slice(4); }
        folderName = folderName || 'フォルダ';
        const presetLines = allLines.filter(l => l.startsWith('gf2~'));
        const decoded = [];
        for (const l of presetLines) {
          try { decoded.push(_presetDecodeOne(l)); } catch (e) { console.error('[folder import] skip line:', JSON.stringify(l), e); }
        }
        arr = [{ type: 'folder', name: folderName, open: true }, ...decoded];
      } else {
        // gff~ が見つからない場合は通常の gf2 インポートにフォールバック
        const lines = allLines.filter(l => l.startsWith('gf2~'));
        arr = lines.length > 1 ? lines.map(l => _presetDecodeOne(l)) : [_presetDecodeOne(raw.slice(gf2Idx))];
      }
    } else if (gf2Idx !== -1) {
      // 単体 or 複数の gf2~ コードをあらゆるセパレーターで分割してすべてデコード
      const lines = raw.split(/\s+(?=gf2~)/).map(l => l.trim()).filter(l => l.startsWith('gf2~'));
      if (lines.length > 1) {
        arr = lines.map(l => _presetDecodeOne(l));
      } else {
        arr = [_presetDecodeOne(raw.slice(gf2Idx))];
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
    // フォルダ込みの場合は末尾に追加、単体プリセットは既存フォルダの前に挿入
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

// ---- JSON / gf2コード D&D → プリセットカード全体で受付 ----
((() => {
  const card = document.getElementById('presetCard');
  const list = document.getElementById('presetList');
  if (!card) return;

  const _isJsonDrag = e => {
    if (!e.dataTransfer) return false;
    // ファイルドロップ判定（OS由来のファイル）
    if (e.dataTransfer.types.includes('Files')) return true;
    // テキスト（gf2コードやJSONテキスト）
    if (e.dataTransfer.types.includes('text/plain')) return true;
    return false;
  };

  const _doImportRaw = async (raw) => {
    raw = (raw || '').trim();
    if (!raw) return;
    await _doInlineImport(raw);
  };

  let _dndActive = false;
  const _enter = () => {
    if (_isDraggingPreset) return; // プリセット並び替え中は無視
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
    // カードの外に出たときだけ解除
    if (!card.contains(e.relatedTarget)) _leave();
  });
  card.addEventListener('drop', async e => {
    if (_isDraggingPreset) return;
    const files = [...(e.dataTransfer.files || [])].filter(f =>
      f.type === 'application/json' || f.type === 'text/plain' || f.name.endsWith('.json'));
    const hasText = e.dataTransfer.types.includes('text/plain');
    if (!files.length && !hasText) return; // 動画ドロップ等は無視
    e.preventDefault();
    e.stopPropagation(); // canvasWrapへの伝播を防ぐ
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

// コード取込トグル
document.getElementById('presetImportToggleBtn').addEventListener('click', () => {
  const row = document.getElementById('presetInputRow');
  const open = row.style.display === 'none';
  row.style.display = open ? '' : 'none';
  if (open) document.getElementById('presetCodeInput').focus();
});

_presetsReady = true;
renderPresets();

// ============================================================
//  プリセット圧縮コーデック v2
//  単体共有 : "gf2~<settings27>~<name>~<id0>~<id1>"  (設定+Iwara動画2本で~60文字)
//  全件バックアップ: deflate-raw JSON
//  ℹ️  Iwara ID 14文字×2が最小単位のため6-12文字は不可能
// ============================================================
const _B64U = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const _B64D = s => { const b64 = s.replace(/-/g,'+').replace(/_/g,'/'); return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length/4)*4,'=')), c => c.charCodeAt(0)); };

// ---- Bit-pack: 157 bits → 20 bytes → 27 base64url chars ----
const _MSHAPES = ['circle','rect','triangle','diamond','star','hexagon','none','ellipse'];
function _packPreset(d) {
  const bits = [];
  const w = (raw, n) => { const v = Math.round(+raw||0); for (let i=n-1;i>=0;i--) bits.push((v>>i)&1); };
  const cl = (v,lo,hi) => Math.max(lo, Math.min(hi, +v||0));
  w(cl(d.vol0,0,100),                       7);
  w(cl(d.vol1,0,100),                       7);
  w((cl(d.offset0,-10,10)+10)*100,         11); // 0-2000 (step 0.01)
  w((cl(d.offset1,-10,10)+10)*100,         11);
  w(cl(d.maskX,0,1023),                    10);
  w(cl(d.maskY,0,511),                      9);
  w(cl(d.maskW,0,1023),                    10);
  w(cl(d.maskH,0,511),                      9);
  w(Math.max(0,_MSHAPES.indexOf(d.maskShape??'circle')), 3);
  w(cl(d.borderW,0,10)*10,                  7); // 0-100 (step 0.1)
  w(cl(d.borderOpacity,0,100),              7);
  const c=(d.borderColor||'#ffffff').replace('#','');
  w(parseInt(c.slice(0,2)||'ff',16), 8); w(parseInt(c.slice(2,4)||'ff',16), 8); w(parseInt(c.slice(4,6)||'ff',16), 8);
  w(cl(d.blurAmt,0,10)*10,                  7); // 0-100 (step 0.1)
  w(cl(d.filterBrightness,50,150)-50,       7); // 0-100
  w(cl(d.filterContrast,50,150)-50,         7);
  w(cl(d.filterSaturation,0,200),           8);
  w(cl(d.filterVignette,0,10)*10,           7); // 0-100 (step 0.1)
  w(cl(d.filterCA,0,10)*10,                 7); // 0-100 (step 0.1)
  w(d.theme==='light'?1:0,                  1);
  while(bits.length%8) bits.push(0);
  const b=new Uint8Array(bits.length/8);
  for(let i=0;i<b.length;i++) b[i]=bits.slice(i*8,i*8+8).reduce((v,bit,j)=>v|(bit<<(7-j)),0);
  return b;
}
function _unpackPreset(bytes) {
  const bits=[];
  for(const byte of bytes) for(let i=7;i>=0;i--) bits.push((byte>>i)&1);
  let pos=0;
  const r=n=>{let v=0;for(let i=0;i<n;i++)v=(v<<1)|(bits[pos++]||0);return v;};
  const f=v=>v%1===0?String(v):String(+v.toFixed(2));
  return {
    vol0:String(r(7)), vol1:String(r(7)),
    offset0:f(r(11)/100-10), offset1:f(r(11)/100-10),
    maskX:r(10), maskY:r(9), maskW:r(10), maskH:r(9),
    maskShape:_MSHAPES[r(3)]||'circle',
    borderW:f(r(7)/10), borderOpacity:String(r(7)),
    borderColor:'#'+[r(8),r(8),r(8)].map(v=>v.toString(16).padStart(2,'0')).join(''),
    blurAmt:f(r(7)/10),
    filterBrightness:String(r(7)+50), filterContrast:String(r(7)+50),
    filterSaturation:String(r(8)), filterVignette:f(r(7)/10),
    filterCA:f(r(7)/10),
    theme:r(1)?'light':'dark',
  };
}

// 単体コード: "gf2~<27>~<name>~<id0>~<id1>"
const _iwaraId = url => url?.match(/iwara\.(?:tv|ai)\/video\/([^/?#]+)/)?.[1] ?? '';
function _presetEncodeOne(p) {
  const {presetId,vid0Name,vid1Name,...d} = p.data;
  const base = `gf2~${_B64U(_packPreset(d))}~${(p.name||'').replace(/~/g,'')}~${_iwaraId(d.vid0Url)||d.vid0Id||''}~${_iwaraId(d.vid1Url)||d.vid1Id||''}`;
  const ex = {
    ba: d.borderAnim ?? 'none',
    bs: d.borderAnimSpeed ?? '1',
    bb: d.borderAnimBright ?? '70',
    ft: d.filterTemp ?? '0',
    fm: d.filterMatte ?? '0',
    fg: d.filterGrain ?? '0',
    fp: d.filterPixel ?? '0',
    ff: d.filterFlare ?? '0',
    fb: d.filterBars ?? '0',
  };
  // iwara以外のURL（画像等）はexに保存
  if (d.vid0Url && !_iwaraId(d.vid0Url)) ex.u0 = d.vid0Url;
  if (d.vid1Url && !_iwaraId(d.vid1Url)) ex.u1 = d.vid1Url;
  return base + '~' + _B64U(new TextEncoder().encode(JSON.stringify(ex)));
}
function _presetDecodeOne(code) {
  const parts=code.split('~');
  if(parts[0]!=='gf2'||parts.length<5) throw new Error('invalid gf2 code');
  const [,s27,name,id0,id1,exPart]=parts;
  const data=_unpackPreset(_B64D(s27));
  if(id0) { data.vid0Url=`https://www.iwara.tv/video/${id0}`; data.vid0Name=id0; }
  if(id1) { data.vid1Url=`https://www.iwara.tv/video/${id1}`; data.vid1Name=id1; }
  if (exPart) {
    try {
      const ex = JSON.parse(new TextDecoder().decode(_B64D(exPart)));
      if (ex.ba != null) data.borderAnim      = ex.ba;
      if (ex.bs != null) data.borderAnimSpeed = ex.bs;
      if (ex.bb != null) data.borderAnimBright = ex.bb;
      if (ex.ft != null) data.filterTemp      = ex.ft;
      if (ex.fm != null) data.filterMatte     = ex.fm;
      if (ex.fg != null) data.filterGrain     = ex.fg;
      if (ex.fp != null) data.filterPixel     = ex.fp;
      if (ex.ff != null) data.filterFlare     = ex.ff;
      if (ex.fb != null) data.filterBars      = ex.fb;
      // iwara以外のURL（画像等）を復元
      if (ex.u0 != null) { data.vid0Url = ex.u0; data.vid0Name = data.vid0Name || ex.u0.split('/').pop().split('?')[0]; }
      if (ex.u1 != null) { data.vid1Url = ex.u1; data.vid1Name = data.vid1Name || ex.u1.split('/').pop().split('?')[0]; }
    } catch(e) {}
  }
  return {name:name||'インポート',data};
}

// 全件バックアップ: deflate JSON
const _iwaraUrl = id => `https://www.iwara.tv/video/${id}`;
async function _presetEncode(arr) {
  const data=arr.map(p=>{
    if (p.type === 'folder') return { type: 'folder', name: p.name, open: p.open !== false };
    const {presetId,vid0Name,vid1Name,...d}=p.data;
    const id0=_iwaraId(d.vid0Url); if(id0){d.vid0Id=id0;delete d.vid0Url;}
    const id1=_iwaraId(d.vid1Url); if(id1){d.vid1Id=id1;delete d.vid1Url;}
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
//  プリセット エクスポート / インポート
// ============================================================
const _presetShareStatus = document.getElementById('presetShareStatus');
let _presetStatusTimer = null;
function _presetStatusMsg(msg, ok = true) {
  // トースト表示
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
      // file:// プロトコル用フォールバック
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

// 読み込み: 取込コード / JSON どちらも受け付ける
// ============================================================
//  シアターモード & 全画面
// ============================================================
const appBody    = document.querySelector('.app-body');
const panel      = document.querySelector('.panel');
const theaterBtn = document.getElementById('theaterBtn');
const fsBtn      = document.getElementById('fullscreenBtn');

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

// フルスクリーン時カーソル/トランスポート自動非表示
const _fsWrap = document.getElementById('canvasWrap');
let _fsIdleTimer = null;
let _fsIsIdle = false;

function _setFsIdle(idle) {
  if (_fsIsIdle === idle) return; // 状態変化なし → DOM を触らない
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
  // ブラウザのネイティブ UI ゾーン（上部 ~100px）での動きは無視
  // Chrome の終了バブルは約 60-80px、余裕を持って 100px をデッドゾーンとする
  if (e.clientY < 100) return;
  _resetFsIdle();
});
_fsWrap.addEventListener('mousedown', _resetFsIdle);

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  fsBtn.innerHTML = isFs ? '<i data-lucide="minimize"></i>' : '<i data-lucide="maximize"></i>';
  fsBtn.title = t(isFs ? 'fs-close' : 'fs-open');
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

// ---- Card collapse (カード折りたたみ) ----
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
      // カードを閉じる時に loaded ゾーンのアニメーションを凍結する。
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
