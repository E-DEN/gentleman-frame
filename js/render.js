// render.js — レンダリングループ・描画関数

import { state, _animColors, _ANIM_DEFAULTS, _presetsReady } from './state.js';
import {
  canvas, displayCtx, renderCvs, ctx,
  overlayCanvas, overlayCtx, anchorCanvas, anchorCtx,
  offCvs, offCtx, postCvs, postCtx, chCvs, chCtx, caCvs, caCtx,
  _mblurCvs, _mblurCtx, grainCvs, grainCtx,
  effectsWrap, svgGblurEl,
  vid, img, mediaType, loaded, visHidden, maskHidden, effectsHidden,
  getMediaSrc, getVidFrameTs, getHandles, HANDLE_SZ,
  _dispH, _cachedAccent, _cachedBg,
  _lastBufScale, _lastFgAlpha,
  setLastBufScale, setLastFgAlpha,
  _compositeT, _compositeLastRaf, _compositeSeekPending,
  setCompositeT, setCompositeLastRaf,
  _maskBorderFadeStart, _fgFadeStart,
  elFilterBrightness, elFilterContrast, elFilterSaturation, elFilterHue,
  elFilterBlur, BLUR_SIGMA_PER_UNIT, elFilterPixel, elFilterHighlight, elFilterShadow, elFilterSharpness,
  elFilterCA, elFilterVignette, elFilterMatte, elFilterGrain,
  elFilterFlare, elFilterFps, elFilterBars, elFilterBloom,
  elFilterPencil, elFilterEmboss, elFilterChalkboard, elFilterNightVision, elFilterAirbrush,
  elFilterTemp, elFilterTint,
  elBorderW, elBorderColor, elBorderOpacity,
  elBorderAnim, elBorderAnimSpeed, elBorderAnimBright,
  elFrameBlur, elFrameTint,
  elFgPinX, elFgPinY, elFgPinLerp, elFgPinOpacity, elFgOpacity,
  elMaskZoom,
  elSpecBars, elSpecAmp, elSpecGap, elSpecSmooth,
  _scheduleResync,
  _syncOffsetSliders,
  _getOffsets,
  updateProgress, syncMaskDropOverlay,
} from './canvas.js';
import { getSpectrumBars, smoothBars } from './spectrum.js';
import { applyFiltersGL, warmUpFiltersGL } from './gl-filters.js';
import { perfFrame } from './perf-hud.js';

// --- 明るさ / コントラスト / 彩度 / 色相 ---
// 適用範囲が「全体」のものは CSS フィルター（effectsWrap。雨オーバーレイにも掛かる）、
// 「マスク内のみ / マスク外のみ」のものは canvas 側（表示用キャンバスへ焼き込み）で掛ける
// （モジュールの読み込み順の都合で、要素の参照は使うときに行う）
const _colorFilterDefs = () => [
  ['brightness', elFilterBrightness, 100, v => `brightness(${v}%)`],
  ['contrast',   elFilterContrast,   100, v => `contrast(${v}%)`],
  ['saturation', elFilterSaturation, 100, v => `saturate(${v}%)`],
  ['hue',        elFilterHue,        0,   v => `hue-rotate(${v}deg)`],
];
let _lastCssFilter = '';
export function _colorFilters() {
  const g = { all: [], in: [], out: [] };
  if (!effectsHidden) {
    for (const [key, el, def, fmt] of _colorFilterDefs()) {
      const v = parseFloat(el.value);
      if (v === def) continue;
      const sc = _maskScope(key);
      g[sc === 1 ? 'in' : sc === 2 ? 'out' : 'all'].push(fmt(v));
    }
  }
  return { css: g.all.join(' '), inStr: g.in.join(' '), outStr: g.out.join(' ') };
}
// スクリーンショット用: 画面に CSS で掛かっている色補正
export function getCssColorFilter() { return _colorFilters().css; }
export function updateCanvasFilter() {
  const css = _colorFilters().css;
  effectsWrap.style.filter = css;
  _lastCssFilter = css;
}
let _colTmp = null, _colTmpCtx = null;
function _applyColorScopes(c, W, H, m, cf) {
  if (cf.outStr) {
    // 外のみ: 全面に掛けたあと、枠の中だけ元の絵（内のみの色補正があればそれを掛けた絵）で描き直す
    if (!_colTmp) { _colTmp = document.createElement('canvas'); _colTmpCtx = _colTmp.getContext('2d'); }
    if (_colTmp.width !== W || _colTmp.height !== H) { _colTmp.width = W; _colTmp.height = H; }
    else _colTmpCtx.clearRect(0, 0, W, H);
    _colTmpCtx.drawImage(c.canvas, 0, 0);
    c.globalCompositeOperation = 'copy';
    c.filter = cf.outStr;
    c.drawImage(_colTmp, 0, 0);
    c.filter = 'none';
    c.globalCompositeOperation = 'source-over';
    _drawMaskedRegion(c, _colTmp, W, H, m, cf.inStr, 0);
  } else {
    _drawMaskedRegion(c, c.canvas, W, H, m, cf.inStr, 0);
  }
}

// シネマバーは effectsWrap（雨オーバーレイを含む）の外側の div で表示
export const barsOverlay = document.getElementById('barsOverlay');
export function updateBarsOverlay() {
  const barsAmt = parseFloat(elFilterBars.value);
  if (barsAmt <= 0 || effectsHidden) { barsOverlay.style.background = ''; return; }
  const pct = (barsAmt / 10) * 18;
  barsOverlay.style.background =
    `linear-gradient(to bottom, #000 ${pct}%, transparent ${pct}%, transparent ${100 - pct}%, #000 ${100 - pct}%)`;
}

// --- 雨オーバーレイ（WebGL – Codrops RainEffect ベース） ---
export const rainOverlay      = document.getElementById('rainOverlay');
export const elFilterRain     = document.getElementById('filterRain');
export const elRainSpeed      = document.getElementById('rainSpeed');
export const elRainRefraction = document.getElementById('rainRefraction');
export const elRainShadow     = document.getElementById('rainShadow');

// 雨サブ行の表示切替
export function _rainSubVisible(v) {
  ['rainSpeedRow', 'rainRefractionRow', 'rainShadowRow'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = v > 0 ? '' : 'none';
  });
}

export function _startRainOverlay() {
  const amt = parseInt(elFilterRain.value, 10);
  if (amt > 0) {
    GFRainEngine.start(rainOverlay, canvas, amt, {
      speed:      parseFloat(elRainSpeed.value),
      refraction: parseFloat(elRainRefraction.value),
      shadow:     parseInt(elRainShadow.value, 10) === 1
    });
  }
}
export function _stopRainOverlay() { GFRainEngine.stop(); }

export function _brightHex(hex, bright) {
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

// 枠色合い(frameTint +)用グラデーション塗りつぶしを生成（border strokeと同じ回転グラデーション）
export function _buildTintFill(ctx, cvs, animKey, phase) {
  if (animKey === 'none' || !animKey) return elBorderColor.value;
  const bright = parseInt(elBorderAnimBright.value, 10);
  const cx = cvs.width / 2, cy = cvs.height / 2;
  const r  = Math.hypot(cvs.width, cvs.height) / 2;
  const a  = phase * Math.PI * 2;
  const g  = ctx.createLinearGradient(
    cx + Math.cos(a) * r, cy + Math.sin(a) * r,
    cx - Math.cos(a) * r, cy - Math.sin(a) * r
  );
  if (animKey === 'rainbow') {
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,${bright}%)`);
  } else if (_animColors[animKey]) {
    const [c0, c1] = _animColors[animKey];
    g.addColorStop(0,   _brightHex(c0, bright));
    g.addColorStop(0.5, _brightHex(c1, bright));
    g.addColorStop(1,   _brightHex(c0, bright));
  } else {
    return elBorderColor.value;
  }
  return g;
}

export function _buildBorderGrad(ctx, m, phase, anim, bright) {
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

// --- レンダリングループ ---
// _renderFrame と displayCtx blit を同一 rAF コールバック内でアトミックに実行し、
// setInterval との競合によるティアリングを防ぐ。
export let _renderIntervalId = null; // 互換用（現在は未使用）

// マスクの外接矩形だけの小さなキャンバスで前景を切り抜き、メインに貼る。
// 4K 全面（約830万画素）を毎フレーム処理せず、マスクの面積に比例したコストで済む。
let _maskBoxCvs = null;
let _maskBoxCtx = null;
function _drawFgInMaskBox(src, W, H, m, dx, dy, zz, alpha) {
  let x0 = m.x, y0 = m.y, x1 = m.x + m.w, y1 = m.y + m.h;
  if (m.shape === 'spectrum' && m.specRotate) {
    // 回転すると外接矩形からはみ出すため、対角線を半径とする正方形で覆う
    const r = Math.hypot(m.w, m.h) / 2;
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    x0 = cx - r; y0 = cy - r; x1 = cx + r; y1 = cy + r;
  }
  x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
  x1 = Math.min(W, Math.ceil(x1) + 2);  y1 = Math.min(H, Math.ceil(y1) + 2);
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return;
  if (!_maskBoxCvs) { _maskBoxCvs = document.createElement('canvas'); _maskBoxCtx = _maskBoxCvs.getContext('2d'); }
  if (_maskBoxCvs.width !== bw || _maskBoxCvs.height !== bh) { _maskBoxCvs.width = bw; _maskBoxCvs.height = bh; }
  else _maskBoxCtx.clearRect(0, 0, bw, bh);
  // 前景全体は (dx, dy, W*zz, H*zz) に描かれる。小キャンバスから見た相対位置に全体を描く
  // （元画像の矩形指定 drawImage は動画フレームで遅い経路に落ちるため使わない。はみ出し部分は描画されない）
  _maskBoxCtx.drawImage(src, dx - x0, dy - y0, W * zz, H * zz);
  _maskBoxCtx.save();
  _maskBoxCtx.globalCompositeOperation = 'destination-in';
  _maskBoxCtx.translate(-x0, -y0);
  const gp = buildMaskPath(_maskBoxCtx, m);
  gp ? _maskBoxCtx.fill(gp) : _maskBoxCtx.fill();
  _maskBoxCtx.restore();
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.drawImage(_maskBoxCvs, x0, y0);
  ctx.globalAlpha = 1; ctx.restore();
}

// フィルターの適用範囲（state.filterMaskOnly[key]）: 0 = 全体 / 1 = マスク内のみ / 2 = マスク外のみ。
// マスクが非表示、または動画が無いときは全体として扱う（他のマスク内のみフィルターと同じ）
function _maskScope(key) {
  const v = state.filterMaskOnly[key];
  if (!v || maskHidden || !(loaded[1] ? !visHidden[1] : loaded[0] && !visHidden[0])) return 0;
  return v === 'out' ? 2 : 1;
}

// 雨の適用範囲。マスクが変わらない間は雨側がマスク画像を再利用する（key で判定）。
// スペクトラムは位置・サイズが同じでも形が音で変わり続けるため、毎回作り直す
let _rainMaskSeq = 0;
function _rainMask() {
  if (!(parseInt(elFilterRain.value, 10) > 0)) { _wetActive = false; return null; }
  const mode = _maskScope('rain');
  if (!mode) { _wetActive = false; return null; }
  const W = canvas.width, H = canvas.height, m = state.mask;
  const key = m.shape === 'spectrum' ? 'spectrum#' + (++_rainMaskSeq) : W + 'x' + H + JSON.stringify(m);
  if (mode === 2) return { mode: 4, key, get: () => _maskAlphaBox(W, H, m), wet: _stepWet(m, W, H) };
  _wetActive = false;
  return { mode, key, get: () => _maskAlphaBox(W, H, m) };
}

// 雨の「垂れ」: マスク外のみのとき、枠（ガラスを拭いた所）が抜けた跡は乾いた状態から始まり、上と横の濡れた所から順に濡れ戻る。
// 画面を粗いマス目（192×108）にした濡れ具合 0〜1 を持ち、枠の中は 0 に戻す。
// 濡れが隣へ移る速さは _RAIN_DRIP_SPEED で決まり、列ごとに速さを変えて筋状に流れ落ちるようにする
// 濡れが隣へ移る速さ（マス/秒）と、1 マスが濡れきるまでの速さ（/秒）。小さいほどゆっくり垂れてフェードインする
const _RAIN_DRIP_SPEED = 8;
const _RAIN_DRIP_RISE = 0.9;
const _WET_W = 192, _WET_H = 108;
let _wet = null, _wetU8 = null, _wetCol = null, _wetCtx = null, _wetT = 0, _wetActive = false;
function _stepWet(m, W, H) {
  const N = _WET_W * _WET_H;
  if (!_wet) {
    _wet = new Float32Array(N);
    _wetU8 = new Uint8Array(N);
    const r = Array.from({ length: _WET_W }, Math.random);
    _wetCol = new Float32Array(_WET_W);
    for (let x = 0; x < _WET_W; x++) {
      _wetCol[x] = 0.5 + (r[Math.max(0, x - 1)] + 2 * r[x] + r[Math.min(_WET_W - 1, x + 1)]) / 4;
    }
    const cv = document.createElement('canvas');
    cv.width = _WET_W; cv.height = _WET_H;
    _wetCtx = cv.getContext('2d', { willReadFrequently: true });
  }
  const now = performance.now();
  if (!_wetActive) { _wet.fill(1); _wetActive = true; _wetT = now; }
  const dt = Math.min(0.1, Math.max(0, (now - _wetT) / 1000));
  _wetT = now;
  // 枠をこの解像度に描いて、完全に枠の中のマスを判定する（縁のマスは外側として濡れさせ、細かい境界は雨側のマスクで切る）
  const c = _wetCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, _WET_W, _WET_H);
  c.setTransform(_WET_W / W, 0, 0, _WET_H / H, 0, 0);
  c.fillStyle = '#fff';
  const p = buildMaskPath(c, m);
  p ? c.fill(p) : c.fill();
  const a = c.getImageData(0, 0, _WET_W, _WET_H).data;
  const rise = _RAIN_DRIP_RISE; // 濡れが 0 → 1 になる速さ（/秒）。列の係数を掛ける
  const speed = _RAIN_DRIP_SPEED;
  for (let y = 0; y < _WET_H; y++) {
    for (let x = 0; x < _WET_W; x++) {
      const i = y * _WET_W + x;
      if (a[i * 4 + 3] > 250) { _wet[i] = 0; continue; }
      const col = _wetCol[x];
      const thr = Math.min(0.9, Math.max(0.02, rise * col / speed));
      const up = y === 0 ? 1 : _wet[i - _WET_W];
      const side = Math.max(x > 0 ? _wet[i - 1] : 0, x < _WET_W - 1 ? _wet[i + 1] : 0) * 0.6;
      if (Math.max(up, side) >= thr) _wet[i] = Math.min(1, _wet[i] + rise * col * dt);
    }
  }
  // 転送用。枠の中のマスは、縁の補間で外側が薄まらないよう隣の濡れ具合を借りる（中は雨側のマスクで消える）
  for (let y = 0; y < _WET_H; y++) {
    for (let x = 0; x < _WET_W; x++) {
      const i = y * _WET_W + x;
      let v = _wet[i];
      if (a[i * 4 + 3] > 250) {
        v = Math.max(y > 0 ? _wet[i - _WET_W] : 0, y < _WET_H - 1 ? _wet[i + _WET_W] : 0,
                     x > 0 ? _wet[i - 1] : 0, x < _WET_W - 1 ? _wet[i + 1] : 0);
      }
      // 二乗して、濡れ始めは薄く（ゆっくりフェードイン）
      _wetU8[i] = Math.round(v * v * 255);
    }
  }
  return { data: _wetU8, w: _WET_W, h: _WET_H };
}

// マスクの内側だけを src から描き直して target に重ねる。filterStr（CSS filter 文字列。空なら無加工）を掛けて描ける。
// 全体ぼかし・ピクセル化・色補正の適用範囲をマスク内 / 外に分けるために使う。マスク周辺だけの小さなキャンバスで済ませる。
// pad: 範囲の外へ広げる量（ぼかしの端が枠の中に影響しないよう、3σ ぶん広めに取る）
let _scopeBoxCvs = null, _scopeBoxCtx = null;
function _drawMaskedRegion(target, src, W, H, m, filterStr, padExtra, nearest, srcPad = 0) {
  let x0 = m.x, y0 = m.y, x1 = m.x + m.w, y1 = m.y + m.h;
  if (m.shape === 'spectrum' && m.specRotate) {
    const r = Math.hypot(m.w, m.h) / 2;
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    x0 = cx - r; y0 = cy - r; x1 = cx + r; y1 = cy + r;
  }
  const pad = 2 + padExtra;
  x0 = Math.max(0, Math.floor(x0) - pad); y0 = Math.max(0, Math.floor(y0) - pad);
  x1 = Math.min(W, Math.ceil(x1) + pad);  y1 = Math.min(H, Math.ceil(y1) + pad);
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  if (!_scopeBoxCvs) { _scopeBoxCvs = document.createElement('canvas'); _scopeBoxCtx = _scopeBoxCvs.getContext('2d'); }
  const needW = Math.ceil(bw / 64) * 64, needH = Math.ceil(bh / 64) * 64;
  if (_scopeBoxCvs.width < bw || _scopeBoxCvs.height < bh || _scopeBoxCvs.width > needW * 2 || _scopeBoxCvs.height > needH * 2) {
    _scopeBoxCvs.width = needW; _scopeBoxCvs.height = needH;
  }
  const c = _scopeBoxCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, _scopeBoxCvs.width, _scopeBoxCvs.height);
  // 全体を箱の位置に合わせて描く（元画像の矩形指定 drawImage より速い）
  c.imageSmoothingEnabled = !nearest;
  if (filterStr) c.filter = filterStr;
  c.drawImage(src, -x0 - srcPad, -y0 - srcPad, W + srcPad * 2, H + srcPad * 2);
  c.filter = 'none';
  c.imageSmoothingEnabled = true;
  c.setTransform(1, 0, 0, 1, -x0, -y0);
  c.globalCompositeOperation = 'destination-in';
  const gp = buildMaskPath(c, m);
  gp ? c.fill(gp) : c.fill();
  c.globalCompositeOperation = 'source-over';
  c.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(_scopeBoxCvs, 0, 0, bw, bh, x0, y0, bw, bh);
}

// ぼかし用に、画像の外側へ端の画素を複製して広げた画像を作る（p px ぶん）。
// そのままぼかすと画面の端が透明に薄れたり、端の 1〜2 行だけぼけずに残ったりするのを避ける
let _extCvs = null, _extCtx = null;
function _edgeExtended(src, W, H, p) {
  if (!_extCvs) { _extCvs = document.createElement('canvas'); _extCtx = _extCvs.getContext('2d'); }
  const EW = W + p * 2, EH = H + p * 2;
  if (_extCvs.width !== EW || _extCvs.height !== EH) { _extCvs.width = EW; _extCvs.height = EH; }
  const c = _extCtx;
  c.globalCompositeOperation = 'copy';
  c.drawImage(src, p, p);
  c.globalCompositeOperation = 'source-over';
  c.imageSmoothingEnabled = false;
  c.drawImage(src, 0, 0, 1, H, 0, p, p, H);
  c.drawImage(src, W - 1, 0, 1, H, W + p, p, p, H);
  c.drawImage(src, 0, 0, W, 1, p, 0, W, p);
  c.drawImage(src, 0, H - 1, W, 1, p, H + p, W, p);
  c.drawImage(src, 0, 0, 1, 1, 0, 0, p, p);
  c.drawImage(src, W - 1, 0, 1, 1, W + p, 0, p, p);
  c.drawImage(src, 0, H - 1, 1, 1, 0, H + p, p, p);
  c.drawImage(src, W - 1, H - 1, 1, 1, W + p, H + p, p, p);
  c.imageSmoothingEnabled = true;
  return _extCvs;
}

// ピクセル化（モザイク）。block = 値 × 4 px。適用範囲に応じて、全面 / マスク内のみ / マスク外のみ を target へ copy で描く
let _pixSmall = null, _pixSmallCtx = null, _pixFull = null, _pixFullCtx = null;
function _pixelateInto(target, src, W, H, m, amt, scope) {
  const size = Math.round(amt * 4);
  const pw = Math.ceil(W / size), ph = Math.ceil(H / size);
  if (!_pixSmall) { _pixSmall = document.createElement('canvas'); _pixSmallCtx = _pixSmall.getContext('2d'); }
  if (_pixSmall.width !== pw || _pixSmall.height !== ph) { _pixSmall.width = pw; _pixSmall.height = ph; }
  else _pixSmallCtx.clearRect(0, 0, pw, ph);
  _pixSmallCtx.drawImage(src, 0, 0, pw, ph);
  target.globalCompositeOperation = 'copy';
  if (scope === 1) {
    target.drawImage(src, 0, 0);
    target.globalCompositeOperation = 'source-over';
    _drawMaskedRegion(target, _pixSmall, W, H, m, '', 0, true);
  } else {
    target.imageSmoothingEnabled = false;
    target.drawImage(_pixSmall, 0, 0, pw, ph, 0, 0, W, H);
    target.imageSmoothingEnabled = true;
    target.globalCompositeOperation = 'source-over';
    if (scope === 2) _drawMaskedRegion(target, src, W, H, m, '', 0, false);
  }
}
// ピクセル化の結果を一時キャンバスに作る（このあとぼかしを重ねるとき用）
function _pixelateFrame(src, W, H, m, amt, scope) {
  if (!_pixFull) { _pixFull = document.createElement('canvas'); _pixFullCtx = _pixFull.getContext('2d'); }
  if (_pixFull.width !== W || _pixFull.height !== H) { _pixFull.width = W; _pixFull.height = H; }
  _pixelateInto(_pixFullCtx, src, W, H, m, amt, scope);
  return _pixFull;
}

export function _renderFrame() {
  // マスク追従モード: lerp でなめらかにカーソルへ追従
  if (state.followMode === 'mask') {
    const lerpK = 0.22; // 1フレームあたりの追従率 (0〜1)
    const cx = state.followTargetX - state.mask.w / 2;
    const cy = state.followTargetY - state.mask.h / 2;
    state.mask.x = Math.round(state.mask.x + (cx - state.mask.x) * lerpK);
    state.mask.y = Math.round(state.mask.y + (cy - state.mask.y) * lerpK);
    // _syncOffsetSliders は追従モード終了時に _setFollowMode から呼ぶ（毎フレームのDOM更新を避ける）
  } else if (state.drag.active && state.drag.mode === 'move') {
    // drag 中も rAF 毎にスライダーを同期（mousemove 毎の DOM 更新を避けるため）
    _syncOffsetSliders();
  }

  // アンカー描画位置を lerp で補間（ドラッグ中も滑らかに追従）
  // 表示0-100 → 内部 0.01-1.0 の対数スケール: 0.01 * 100^(x/100)
  const _rawLerp = elFgPinLerp ? parseFloat(elFgPinLerp.value) : 50;
  const _pinLerpK = 0.01 * Math.pow(100, _rawLerp / 100);
  state.fgPinDispX += (parseFloat(elFgPinX.value) - state.fgPinDispX) * _pinLerpK;
  state.fgPinDispY += (parseFloat(elFgPinY.value) - state.fgPinDispY) * _pinLerpK;
  state.fgZoomDisp += (parseFloat(elMaskZoom.value) - state.fgZoomDisp) * _pinLerpK;

  const W = canvas.width;
  const H = canvas.height;
  const m = state.mask;
  // バッファ → 表示CSS px の拡大率。動画解像度が高いほど > 1 になる。
  // lineWidth などの「見た目固定」値はこの係数で補正する。
  // バッファ → 表示CSS px の拡大率。動画解像度が高いほど > 1 になる。
  // lineWidth などの「見た目固定」値はこの係数で補正する。
  const bufScale = _dispH > 0 ? H / _dispH : 1;
  setLastBufScale(bufScale);

  ctx.clearRect(0, 0, W, H);

  // --- 背景 動画/画像（レイヤー 1） ---
  if (loaded[0] && !visHidden[0]) {
    try { ctx.drawImage(_getVidSrc(0), 0, 0, W, H); }
    catch (e) { ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H); }
  } else {
    ctx.fillStyle = _cachedBg;
    ctx.fillRect(0, 0, W, H);
  }

  // --- 前景 動画/画像をマスクでクリップ（レイヤー 2） ---
  const fgAlpha = _fgFadeStart < 0 ? 1
    : _fgFadeStart === 0 ? 0
    : Math.min(1, (performance.now() - _fgFadeStart) / 200);
  const fgDraw = fgAlpha * (elFgOpacity ? parseFloat(elFgOpacity.value) / 100 : 1);
  setLastFgAlpha(fgAlpha);
  if (loaded[1] && !visHidden[1]) {
    const maskZoom = state.fgZoomDisp;
    // 前景の描画位置・倍率（dx, dy, zz）
    // Mode 1（OFF）: マスク中央を zoom の基点にする（マスク追従）
    // Mode 2（ON） : ビデオのアンカー点（fgPinX/Yでパン）がマスク中央に重なるよう描画
    let dx = 0, dy = 0, zz = 1;
    if (Math.abs(maskZoom - 1) > 0.001 || Math.abs(parseFloat(elMaskZoom.value) - 1) > 0.001 || state.fgFixed) {
      zz = maskZoom;
      if (state.fgFixed) {
        const mcx = m.x + m.w / 2;
        const mcy = m.y + m.h / 2;
        const ax  = W / 2 + state.fgPinDispX;
        const ay  = H / 2 + state.fgPinDispY;
        dx = mcx - ax * maskZoom;
        dy = mcy - ay * maskZoom;
      } else {
        const cx = m.x + m.w / 2;
        const cy = m.y + m.h / 2;
        dx = cx * (1 - maskZoom);
        dy = cy * (1 - maskZoom);
      }
    }
    if (!maskHidden) {
      // マスクの外接矩形だけを処理する
      _drawFgInMaskBox(_getVidSrc(1), W, H, m, dx, dy, zz, fgDraw);
    } else {
      // マスク非表示: 前景を全面に描く
      offCtx.clearRect(0, 0, W, H);
      offCtx.drawImage(_getVidSrc(1), dx, dy, W * zz, H * zz);
      ctx.save(); ctx.globalAlpha = fgDraw;
      ctx.drawImage(offCvs, 0, 0);
      ctx.globalAlpha = 1; ctx.restore();
    }
  } else if (loaded[0] && !visHidden[1] && !maskHidden && _fgFadeStart !== 0) {
    // 前景なし かつ アンカーモード ON → 動画1をアンカー位置で描画
    if (state.fgFixed) {
      offCtx.clearRect(0, 0, W, H);
      const maskZoom = state.fgZoomDisp;
      const mcx = m.x + m.w / 2;
      const mcy = m.y + m.h / 2;
      const ax  = W / 2 + state.fgPinDispX;
      const ay  = H / 2 + state.fgPinDispY;
      const dx  = mcx - ax * maskZoom;
      const dy  = mcy - ay * maskZoom;
      offCtx.drawImage(_getVidSrc(0), dx, dy, W * maskZoom, H * maskZoom);
      offCtx.globalCompositeOperation = 'destination-in';
      const _gp2 = buildMaskPath(offCtx, m);
      _gp2 ? offCtx.fill(_gp2) : offCtx.fill();
      offCtx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.globalAlpha = fgDraw;
      ctx.drawImage(offCvs, 0, 0);
      ctx.globalAlpha = 1; ctx.restore();
    }
  }

  // --- フィルター（色収差〜カラーフレア） ---
  if (!effectsHidden) {
    const _maskClipOk = !maskHidden && (loaded[1] ? !visHidden[1] : loaded[0] && !visHidden[0]);
    if (_applyFiltersViaGL(W, H, m, _maskClipOk)) { _lastFilterPath = 'WebGL'; }
    else { _lastFilterPath = '2D（WebGL 不使用）'; _applyFilters2D(W, H, m, _maskClipOk); }
  }
}

// --- フィルター（WebGL 版） ---
// 使えない環境・描画に失敗した場合は false を返し、2D 版で描く。
// URL に ?gl=0 を付けると 2D 版に固定できる（見た目の比較・不具合時の切り分け用）
const _filterGLEnabled = new URLSearchParams(location.search).get('gl') !== '0';
let _glWarmed = false;
function _applyFiltersViaGL(W, H, m, maskClipOk) {
  if (!_filterGLEnabled) return false;
  const v = el => (el ? parseFloat(el.value) : 0);
  const mo = {}, inv = {};
  for (const k in state.filterMaskOnly) {
    mo[k] = !!state.filterMaskOnly[k] && maskClipOk;
    inv[k] = state.filterMaskOnly[k] === 'out' && maskClipOk;
  }
  const A = {
    ca: v(elFilterCA), hl: v(elFilterHighlight), sh: v(elFilterShadow), vig: v(elFilterVignette),
    temp: v(elFilterTemp), tint: v(elFilterTint), matte: v(elFilterMatte), grain: v(elFilterGrain),
    bloom: v(elFilterBloom), sharp: v(elFilterSharpness), pencil: v(elFilterPencil),
    emboss: v(elFilterEmboss), chalk: v(elFilterChalkboard), night: v(elFilterNightVision),
    air: v(elFilterAirbrush), flare: v(elFilterFlare), mo, inv,
  };
  const out = applyFiltersGL(renderCvs, W, H, m, A, {
    grain: () => { _fillGrain(A.grain); return grainCvs; },
    mask: () => _maskAlphaBox(W, H, m),
  });
  if (out === false) return false;
  if (out) {
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(out, 0, 0);
    ctx.restore();
  }
  return true;
}

// フィルター適用範囲のクリップ。inverse = true ならマスクの外側だけに適用する（evenodd で全体からマスクを除く）
function _clipMaskRegion(c, m, inverse, W, H) {
  const p = buildMaskPath(c, m);
  if (!inverse) { if (p) c.clip(p); else c.clip(); return; }
  if (p) { const q = new Path2D(); q.rect(0, 0, W, H); q.addPath(p); c.clip(q, 'evenodd'); }
  else { c.rect(0, 0, W, H); c.clip('evenodd'); }
}

// フィルム粒子のノイズ（256×256、毎フレーム作り直す）。2D 版・WebGL 版で共用
function _fillGrain(grainAmt) {
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
}

// マスク内限定フィルター用のマスク形状（WebGL 版で使う）。
// 4K 全面にパスを描くと遅いため、マスク周辺だけの箱キャンバスに白で塗って渡す
let _moLayer = null;
function _maskAlphaBox(W, H, m) {
  if (!_moLayer) _moLayer = _newBoxLayer(null);
  let x0 = m.x, y0 = m.y, x1 = m.x + m.w, y1 = m.y + m.h;
  if (m.shape === 'spectrum' && m.specRotate) {
    const r = Math.hypot(m.w, m.h) / 2;
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    x0 = cx - r; y0 = cy - r; x1 = cx + r; y1 = cy + r;
  }
  const c = _boxBegin(_moLayer, x0 - 2, y0 - 2, x1 + 2, y1 + 2, W, H);
  c.fillStyle = '#fff';
  const p = buildMaskPath(c, m);
  p ? c.fill(p) : c.fill();
  const L = _moLayer;
  return { cvs: L.cvs, x: L.x, y: L.y, dw: L.dw, dh: L.dh, sw: L.sw, sh: L.sh };
}

// --- フィルター（2D Canvas 版） ---
// WebGL が使えないとき・WebGL 版が対応しない設定のときの描画経路。
// WebGL 版（gl-filters.js）はこの関数と同じ順序・同じ計算で、結果が一致するように作ってある
function _applyFilters2D(W, H, m, _maskClipOk) {
  // --- 色収差（放射状、スケールベース） ---
  const caAmt = parseFloat(elFilterCA.value);
  if (caAmt > 0) {
    const _foCA = _maskClipOk && state.filterMaskOnly.ca;
    _snapToPost();
    const s = caAmt * 0.002;
    const cx = W / 2, cy = H / 2;
    const _drawCh = (color, scale) => {
      chCtx.clearRect(0, 0, W, H);
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
    if (_foCA) {
      ctx.save(); _clipMaskRegion(ctx, m, _foCA === 'out', W, H);
      ctx.drawImage(caCvs, 0, 0);
      ctx.restore();
    } else {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(caCvs, 0, 0);
    }
  }

  // --- Highlights (明るいトーン域を操作) ---
  // 色温度・色合い・マット・ハイライト(暗く)・シャドウ(明るく)は、いずれも「チャンネルごとの 1 次式 c' = c*A + B」で、
  // 連続するものは 1 回の塗りに合成できる（全面の塗りを 1 回減らすごとに 4K では約 1ms 軽くなる）。
  // soft-light・グラデーションなど 1 次式で表せない処理の前に _affFlush() で吐き出して順序を保つ
  let _aff = null;
  const _affFlush = () => {
    if (!_aff) return;
    const { A, r, g, b, fo } = _aff;
    _aff = null;
    const a = 1 - A;
    if (a <= 1e-6) return;
    ctx.save();
    if (fo) _clipMaskRegion(ctx, m, fo === 'out', W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(${Math.min(255, r / a * 255)},${Math.min(255, g / a * 255)},${Math.min(255, b / a * 255)},${a})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };
  const _affStart = fo => {
    if (_aff && _aff.fo !== fo) _affFlush();
    if (!_aff) _aff = { A: 1, r: 0, g: 0, b: 0, fo };
  };
  // 定数色 (r,g,b: 0〜1) を不透明度 a で通常合成
  const _affOver = (a, r, g, b, fo) => {
    _affStart(fo);
    _aff.A *= 1 - a;
    _aff.r = _aff.r * (1 - a) + r * a;
    _aff.g = _aff.g * (1 - a) + g * a;
    _aff.b = _aff.b * (1 - a) + b * a;
  };
  // グレー (0〜1) を乗算
  const _affMul = (gray, fo) => {
    _affStart(fo);
    _aff.A *= gray; _aff.r *= gray; _aff.g *= gray; _aff.b *= gray;
  };
  const hlAmt = parseFloat(elFilterHighlight.value);
  if (hlAmt !== 0) {
    const _foHL = _maskClipOk && state.filterMaskOnly.highlight;
    const t = Math.abs(hlAmt) / 100;
    if (hlAmt < 0) {
      _affMul(Math.round(255 - t * 55) / 255, _foHL);
    } else {
      _affFlush();
      ctx.save();
      if (_foHL) _clipMaskRegion(ctx, m, _foHL === 'out', W, H);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(255,255,255,${t * 0.60})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // --- Shadows (暗いトーン域を操作) ---
  const shAmt = parseFloat(elFilterShadow.value);
  if (shAmt !== 0) {
    const _foSH = _maskClipOk && state.filterMaskOnly.shadow;
    const t = Math.abs(shAmt) / 100;
    if (shAmt > 0) {
      // screen（グレー）= 白を不透明度 brightness/255 で通常合成するのと同じ
      _affOver(Math.round(t * 72) / 255, 1, 1, 1, _foSH);
    } else {
      _affFlush();
      ctx.save();
      if (_foSH) _clipMaskRegion(ctx, m, _foSH === 'out', W, H);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(0,0,0,${t * 0.60})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // --- ビネット ---
  const vigAmt = parseFloat(elFilterVignette.value);
  if (vigAmt > 0) {
    _affFlush();
    const _moVIG = _maskClipOk && state.filterMaskOnly.vignette;
    const _foVIG = _moVIG === true;   // マスク内のみ: ビネットの中心・半径もマスクに合わせる
    const _outVIG = _moVIG === 'out'; // マスク外のみ: ビネットは全体の形のまま、枠内だけ除く
    const cx = W / 2, cy = H / 2;
    const _vigX = _foVIG ? m.x + m.w / 2 : cx;
    const _vigY = _foVIG ? m.y + m.h / 2 : cy;
    const _vigR1 = _foVIG ? Math.min(m.w, m.h) * 0.30 : Math.min(W, H) * 0.30;
    const _vigR2 = _foVIG ? Math.sqrt((m.w/2)**2 + (m.h/2)**2) * 1.10 : Math.sqrt(cx*cx + cy*cy) * 1.10;
    const vg = ctx.createRadialGradient(_vigX, _vigY, _vigR1, _vigX, _vigY, _vigR2);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${(vigAmt / 10) * 0.85})`);
    ctx.save();
    if (_moVIG) _clipMaskRegion(ctx, m, _outVIG, W, H);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // --- Color Temperature (色温度) ---
  const tempAmt = parseFloat(elFilterTemp.value);
  if (tempAmt !== 0) {
    const _foTMP = _maskClipOk && state.filterMaskOnly.temp;
    const t2 = Math.abs(tempAmt) / 50;
    if (tempAmt > 0) _affOver(0.22 * t2, 1, 140 / 255, 0, _foTMP);
    else _affOver(0.22 * t2, 20 / 255, 80 / 255, 1, _foTMP);
  }

  // --- Tint (色かぶり補正: マゼンタ ↔ グリーン) ---
  const tintAmt = parseFloat(elFilterTint.value);
  if (tintAmt !== 0) {
    const _foTINT = _maskClipOk && state.filterMaskOnly.tint;
    const t2 = Math.abs(tintAmt) / 50;
    if (tintAmt > 0) _affOver(0.14 * t2, 0, 210 / 255, 60 / 255, _foTINT);
    else _affOver(0.14 * t2, 1, 0, 200 / 255, _foTINT);
  }

  // --- Matte (黒浮き + 白浮き) ---
  const matteAmt = parseFloat(elFilterMatte.value);
  if (matteAmt > 0) {
    const _foMAT = _maskClipOk && state.filterMaskOnly.matte;
    const t    = matteAmt / 10;
    const lift  = Math.round(t * 50);
    const crush = Math.round(255 - t * 45);
    _affOver(lift / 255, 1, 1, 1, _foMAT); // screen（グレー）= 白の通常合成
    _affMul(crush / 255, _foMAT);
  }
  _affFlush();

  // --- Film Grain (フィルム粒子) ---
  const grainAmt = parseFloat(elFilterGrain.value);
  if (grainAmt > 0) {
    const _moGR = _maskClipOk && state.filterMaskOnly.grain;
    _fillGrain(grainAmt);
    ctx.save();
    if (_moGR) _clipMaskRegion(ctx, m, _moGR === 'out', W, H);
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(grainCvs, 0, 0, W, H);
    ctx.restore();
  }

  // --- Bloom / にじみ ---
  const waterAmt = elFilterBloom ? parseFloat(elFilterBloom.value) : 0;
  if (waterAmt > 0) {
    const _foW = _maskClipOk && state.filterMaskOnly.bloom;
    if (_foW) { ctx.save(); _clipMaskRegion(ctx, m, _foW === 'out', W, H); }
    const t = waterAmt / 10;
    // ぼかしは低周波なので、4K 級では半解像度で処理して拡大する。
    // 全面のぼかしコピーを 2 回重ねると 4K では急に重くなりコマ落ちが散発するが、
    // 半解像度なら見た目の差は平均 0.5/255 程度に収まる。1080p 以下は従来どおり等倍
    const k = W * H > 2.2e6 ? 0.5 : 1;
    const sw = Math.ceil(W * k), sh = Math.ceil(H * k);
    if (!_bloomCvs) { _bloomCvs = document.createElement('canvas'); _bloomCtx = _bloomCvs.getContext('2d'); }
    if (_bloomCvs.width !== sw || _bloomCvs.height !== sh) { _bloomCvs.width = sw; _bloomCvs.height = sh; }
    const bc = _bloomCtx;
    // 1. 滲み: ぼかし+彩度ブースト済みコピーをノーマル合成
    bc.clearRect(0, 0, sw, sh);
    bc.filter = `blur(${t * 4 * k}px) saturate(${100 + t * 70}%)`;
    bc.drawImage(renderCvs, 0, 0, sw, sh);
    bc.filter = 'none';
    ctx.save();
    ctx.globalAlpha = t * 0.55;
    ctx.drawImage(_bloomCvs, 0, 0, W, H);
    ctx.restore();
    // 2. エッジ濃縮: 軽いぼかしコピーを multiply で暗化
    bc.clearRect(0, 0, sw, sh);
    bc.filter = `blur(${t * 2 * k}px)`;
    bc.drawImage(renderCvs, 0, 0, sw, sh);
    bc.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = t * 0.30;
    ctx.drawImage(_bloomCvs, 0, 0, W, H);
    ctx.restore();
    if (_foW) ctx.restore();
  }

  // --- Sharpness (オーバーレイ unsharp mask) ---
  const sharpAmt = parseFloat(elFilterSharpness.value);
  if (sharpAmt > 0) {
    const _foSHP = _maskClipOk && state.filterMaskOnly.sharpness;
    _snapToPost();
    ctx.save();
    if (_foSHP) _clipMaskRegion(ctx, m, _foSHP === 'out', W, H);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(sharpAmt * 0.09, 0.85);
    ctx.drawImage(postCvs, 0, 0);
    ctx.restore();
  }

  // --- Pencil (鉛筆スケッチ) ---
  const pencilAmt = elFilterPencil ? parseFloat(elFilterPencil.value) : 0;
  if (pencilAmt > 0) {
    const _foP = _maskClipOk && state.filterMaskOnly.pencil;
    if (_foP) { ctx.save(); _clipMaskRegion(ctx, m, _foP === 'out', W, H); }
    const t = pencilAmt / 10;
    const offset = Math.max(1, Math.round(1 + t * 3));
    // 差分でエッジ検出（エッジ部分が明るくなる）
    _snapToPost();
    postCtx.globalCompositeOperation = 'difference';
    postCtx.drawImage(renderCvs, offset, offset);
    postCtx.globalCompositeOperation = 'source-over';
    // グレースケール + コントラスト強化 + 反転 → 白地に黒い線
    chCtx.clearRect(0, 0, W, H);
    chCtx.filter = `grayscale(1) brightness(3) contrast(${4 + t * 8}) invert(1)`;
    chCtx.drawImage(postCvs, 0, 0);
    chCtx.filter = 'none';
    // multiply: 白地(非エッジ)は元画像を保持、黒線のみ乗算で描画
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.7 + t * 0.3;
    ctx.drawImage(chCvs, 0, 0);
    ctx.restore();
    if (_foP) ctx.restore();
  }

  // --- Emboss (エンボス) ---
  const embossAmt = elFilterEmboss ? parseFloat(elFilterEmboss.value) : 0;
  if (embossAmt > 0) {
    const _foE = _maskClipOk && state.filterMaskOnly.emboss;
    if (_foE) { ctx.save(); _clipMaskRegion(ctx, m, _foE === 'out', W, H); }
    const t = embossAmt / 10;
    const offset = Math.round(1 + t * 2);
    _snapToPost();
    postCtx.globalCompositeOperation = 'screen';
    postCtx.drawImage(renderCvs, offset, offset);
    postCtx.globalCompositeOperation = 'difference';
    postCtx.drawImage(renderCvs, -offset, -offset);
    postCtx.globalCompositeOperation = 'source-over';
    chCtx.clearRect(0, 0, W, H);
    chCtx.filter = 'brightness(2) invert(1) grayscale(1)';
    chCtx.drawImage(postCvs, 0, 0);
    chCtx.filter = 'none';
    ctx.save();
    ctx.globalAlpha = t;
    ctx.drawImage(chCvs, 0, 0);
    ctx.restore();
    if (_foE) ctx.restore();
  }

  // --- Chalkboard (黒板) ---
  const chalkAmt = elFilterChalkboard ? parseFloat(elFilterChalkboard.value) : 0;
  if (chalkAmt > 0) {
    const _foC = _maskClipOk && state.filterMaskOnly.chalkboard;
    if (_foC) { ctx.save(); _clipMaskRegion(ctx, m, _foC === 'out', W, H); }
    const t = chalkAmt / 10;
    const offset = Math.round(1 + t * 2);
    _snapToPost();
    postCtx.globalCompositeOperation = 'difference';
    postCtx.drawImage(renderCvs, offset, offset);
    postCtx.globalCompositeOperation = 'source-over';
    chCtx.clearRect(0, 0, W, H);
    chCtx.filter = `grayscale(1) brightness(${1.5 + t * 0.5})`;
    chCtx.drawImage(postCvs, 0, 0);
    chCtx.filter = 'none';
    ctx.save();
    ctx.globalAlpha = t;
    ctx.drawImage(chCvs, 0, 0);
    ctx.restore();
    if (_foC) ctx.restore();
  }

  // --- Night Vision (暗視) ---
  const nightVisionAmt = elFilterNightVision ? parseFloat(elFilterNightVision.value) : 0;
  if (nightVisionAmt > 0) {
    const _foN = _maskClipOk && state.filterMaskOnly.nightvision;
    if (_foN) { ctx.save(); _clipMaskRegion(ctx, m, _foN === 'out', W, H); }
    const t = nightVisionAmt / 10;
    postCtx.clearRect(0, 0, W, H);
    postCtx.filter = `grayscale(1) brightness(${1.2 + t * 0.4}) contrast(${1 + t * 0.5})`;
    postCtx.drawImage(renderCvs, 0, 0);
    postCtx.filter = 'none';
    chCtx.clearRect(0, 0, W, H);
    chCtx.fillStyle = 'rgb(0,255,60)';
    chCtx.fillRect(0, 0, W, H);
    chCtx.globalCompositeOperation = 'multiply';
    chCtx.drawImage(postCvs, 0, 0);
    chCtx.globalCompositeOperation = 'source-over';
    const lh = Math.max(1, Math.ceil(H / 320));
    chCtx.fillStyle = `rgba(0,0,0,${t * 0.18})`;
    for (let y = 0; y < H; y += lh * 2) { chCtx.fillRect(0, y, W, lh); }
    ctx.save();
    ctx.globalAlpha = t;
    ctx.drawImage(chCvs, 0, 0);
    ctx.restore();
    if (_foN) ctx.restore();
  }

  // --- Airbrush (エアブラシ) ---
  const airbrushAmt = elFilterAirbrush ? parseFloat(elFilterAirbrush.value) : 0;
  if (airbrushAmt > 0) {
    const _foA = _maskClipOk && state.filterMaskOnly.airbrush;
    if (_foA) { ctx.save(); _clipMaskRegion(ctx, m, _foA === 'out', W, H); }
    const t = airbrushAmt / 10;
    postCtx.clearRect(0, 0, W, H);
    postCtx.filter = `brightness(${1 + t * 0.5}) saturate(${1 + t * 20}) blur(${t * 8}px) contrast(${1 + t * 3})`;
    postCtx.drawImage(renderCvs, 0, 0);
    postCtx.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = t * 0.7;
    ctx.drawImage(postCvs, 0, 0);
    ctx.restore();
    if (_foA) ctx.restore();
  }

  // --- Color Flare (カラーフレア) ---
  const flareAmt = parseFloat(elFilterFlare.value);
  if (flareAmt > 0) {
    const _foFL = _maskClipOk && state.filterMaskOnly.flare;
    const alpha = (flareAmt / 10) * 0.35;
    ctx.save();
    if (_foFL) _clipMaskRegion(ctx, m, _foFL === 'out', W, H);
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

  // --- Cinematic Bars: barsOverlay div (effectsWrap 外側) で描画— updateBarsOverlay() 制御 ---

}

// --- コンポジット時刻 ---
// 描画をスキップするフレームでも進める必要があるため、_renderFrame とは分けて毎 rAF 呼ぶ
function _updateCompositeTime() {
  const _rafNow = performance.now();
  if (state.playing && !_compositeSeekPending) {
    const [o1, o2] = _getOffsets();
    if (loaded[0] && mediaType[0] === 'video' && !vid[0].paused && vid[0].readyState >= 2) {
      setCompositeT(vid[0].currentTime - o1);
    } else if (loaded[1] && mediaType[1] === 'video' && !vid[1].paused && vid[1].readyState >= 2) {
      setCompositeT(vid[1].currentTime - o2);
    } else if (_compositeLastRaf !== null) {
      // 遅延フェーズ（負のオフセット）: ウォールクロックで追跡
      setCompositeT(_compositeT + (_rafNow - _compositeLastRaf) / 1000);
      // refDur を超えないようにクランプ
      const [_o1, _o2] = _getOffsets();
      const _refDur = (loaded[0] && mediaType[0] === 'video' && vid[0].duration) ? vid[0].duration - _o1
                    : (loaded[1] && mediaType[1] === 'video' && vid[1].duration) ? vid[1].duration - _o2 : 0;
      if (_refDur > 0) setCompositeT(Math.min(_compositeT, _refDur));
    }
    setCompositeLastRaf(_rafNow);
  } else if (!state.playing || _compositeSeekPending) {
    setCompositeLastRaf(null);
  }
}

// マスク枠・ハンドル・アンカー・スマホフレームをぼかしより後に描画する
// ベジェ曲線を連続パスに追加するヘルパー（moveTo なし、pts[0] から連結される）
function _smoothCurveThrough(c, pts) {
  for (let i = 1; i < pts.length; i++) {
    const cpX = (pts[i - 1].x + pts[i].x) / 2;
    const cpY = (pts[i - 1].y + pts[i].y) / 2;
    c.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, cpX, cpY);
  }
  if (pts.length) c.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

// スペクトラム bars/mirror のスカイライン輪郭パス（gap=0時の枠用）
function _spectrumSkyline(ctx, m) {
  const specShape  = m.specShape  || 'bars';
  const specSym    = m.specSym    || 'none';
  const specRotate = ((m.specRotate || 0) * Math.PI / 180);
  if (specShape !== 'bars') return false; // radial は buildMaskPath で処理
  const BAR_COUNT = elSpecBars ? Math.max(4, parseInt(elSpecBars.value) || 64) : 64;
  const amp       = elSpecAmp  ? Math.max(0.1, parseFloat(elSpecAmp.value) / 100) : 1.0;
  const bars      = getSpectrumBars(BAR_COUNT);
  const smooth    = elSpecSmooth ? parseFloat(elSpecSmooth.value) / 100 : 0;
  const sBars     = smooth > 0 && bars ? smoothBars(bars, smooth * BAR_COUNT * 1.5) : bars;
  const barW      = m.w / BAR_COUNT;
  const cx = m.x + m.w / 2;
  const cy = m.y + m.h / 2;
  const HALF = Math.ceil(BAR_COUNT / 2);
  const _hv = (i) => {
    const idx = specSym === 'lr' ? (i < HALF ? HALF - 1 - i : i - HALF) : i;
    return Math.max(0, Math.min(1, (sBars ? sBars[idx] * amp : 0)));
  };
  if (specRotate !== 0) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(specRotate);
    ctx.translate(-cx, -cy);
  }
  ctx.beginPath();
  if (smooth > 0) {
    // スムース bezier 輪郭
    if (specSym === 'ud') {
      const midY = m.y + m.h / 2;
      const topPts = [{ x: m.x, y: midY }];
      for (let i = 0; i < BAR_COUNT; i++) topPts.push({ x: m.x + (i + 0.5) * barW, y: midY - _hv(i) * m.h / 2 });
      topPts.push({ x: m.x + m.w, y: midY });
      ctx.moveTo(topPts[0].x, topPts[0].y);
      _smoothCurveThrough(ctx, topPts);
      const botPts = topPts.slice().reverse().map(p => ({ x: p.x, y: 2 * midY - p.y }));
      _smoothCurveThrough(ctx, botPts.slice(1));
    } else {
      const bottom = m.y + m.h;
      const topPts = [{ x: m.x, y: bottom - _hv(0) * m.h }];
      for (let i = 0; i < BAR_COUNT; i++) topPts.push({ x: m.x + (i + 0.5) * barW, y: bottom - _hv(i) * m.h });
      topPts.push({ x: m.x + m.w, y: bottom - _hv(BAR_COUNT - 1) * m.h });
      ctx.moveTo(m.x, bottom);
      _smoothCurveThrough(ctx, topPts);
      ctx.lineTo(m.x + m.w, bottom);
    }
    ctx.closePath();
  } else if (specSym === 'ud') {
    // 上下対称（ミラー）階段輪郭
    const midY = m.y + m.h / 2;
    const hh = Array.from({ length: BAR_COUNT }, (_, i) => Math.max(1, Math.min(1, (bars ? bars[i] * amp : 0)) * m.h / 2));
    ctx.moveTo(m.x, midY);
    ctx.lineTo(m.x, midY - hh[0]);
    for (let i = 0; i < BAR_COUNT; i++) {
      ctx.lineTo(m.x + (i + 1) * barW, midY - hh[i]);
      if (i < BAR_COUNT - 1) ctx.lineTo(m.x + (i + 1) * barW, midY - hh[i + 1]);
    }
    ctx.lineTo(m.x + m.w, midY);
    ctx.lineTo(m.x + m.w, midY + hh[BAR_COUNT - 1]);
    for (let i = BAR_COUNT - 1; i >= 0; i--) {
      ctx.lineTo(m.x + i * barW, midY + hh[i]);
      if (i > 0) ctx.lineTo(m.x + i * barW, midY + hh[i - 1]);
    }
    ctx.lineTo(m.x, midY);
    ctx.closePath();
  } else {
    // none / lr: 下辺からの階段輪郭
    const bottom = m.y + m.h;
    const h = Array.from({ length: BAR_COUNT }, (_, i) => {
      const barIdx = specSym === 'lr' ? (i < HALF ? (HALF - 1 - i) : (i - HALF)) : i;
      return Math.max(2, Math.min(1, (bars ? bars[barIdx] * amp : 0)) * m.h);
    });
    ctx.moveTo(m.x, bottom);
    ctx.lineTo(m.x, bottom - h[0]);
    for (let i = 0; i < BAR_COUNT; i++) {
      ctx.lineTo(m.x + (i + 1) * barW, bottom - h[i]);
      if (i < BAR_COUNT - 1) ctx.lineTo(m.x + (i + 1) * barW, bottom - h[i + 1]);
    }
    ctx.lineTo(m.x + m.w, bottom);
    ctx.closePath();
  }
  if (specRotate !== 0) ctx.restore();
  return true;
}

// にじみ（ブルーム）用の作業キャンバス（4K 級では半解像度）
let _bloomCvs = null, _bloomCtx = null;

// フレーム全面の複製（postCvs へ上書きコピー）。clearRect + 通常合成より、dst を読まない copy の方が軽い
function _snapToPost() {
  postCtx.globalCompositeOperation = 'copy';
  postCtx.drawImage(renderCvs, 0, 0);
  postCtx.globalCompositeOperation = 'source-over';
}

// --- 小キャンバス描画レイヤー ---
// Skia Graphite（Chrome 新描画エンジン）では、矩形以外のパス描画のコストが
// 描く図形の大きさではなくキャンバス全体の大きさに比例し、4K では 1 本の枠線で 10fps 前後まで落ちる。
// マスク周辺だけの小さなキャンバスにパスを描き、本体キャンバスに貼ることで回避する。
// 描画コードは絶対座標のまま書けるよう、箱キャンバスに平行移動（と縮小）の変換を掛けて渡す。
const _BOX_MAX_PX = 2.2e6; // これを超える箱は縮小して描く（約2.3MPを超えると急に遅くなる）
function _newBoxLayer(target) {
  return { target, cvs: document.createElement('canvas'), ctx: null, last: null, x: 0, y: 0, dw: 0, dh: 0, sw: 0, sh: 0 };
}
// 描画範囲（本体キャンバス座標）を決めて箱キャンバスを用意し、描画用コンテキストを返す
function _boxBegin(L, x0, y0, x1, y1, W, H) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1));  y1 = Math.min(H, Math.ceil(y1));
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const k = Math.min(1, Math.sqrt(_BOX_MAX_PX / (bw * bh)));
  const sw = Math.ceil(bw * k), sh = Math.ceil(bh * k);
  // 大きさの変化のたびに再確保しないよう、足りない時だけ（または大きすぎる時に）64px 単位で確保し直す
  const need = Math.ceil(sw / 64) * 64, needH = Math.ceil(sh / 64) * 64;
  if (!L.ctx) L.ctx = L.cvs.getContext('2d');
  if (L.cvs.width < sw || L.cvs.height < sh || L.cvs.width > need * 2 || L.cvs.height > needH * 2) {
    L.cvs.width = need; L.cvs.height = needH;
  }
  const c = L.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, L.cvs.width, L.cvs.height);
  c.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  L.x = x0; L.y = y0; L.sw = sw; L.sh = sh; L.dw = sw / k; L.dh = sh / k;
  // サンプリング等で箱の座標系が必要な描画向け
  c._bx = x0; c._by = y0; c._bk = k;
  return c;
}
// 前回貼った領域をすべて消してから、今回描いたレイヤーを貼る（レイヤー同士で消し合わないよう消去を先にまとめる）
function _boxFinish(layers) {
  for (const [L] of layers) { if (L.last) L.target.clearRect(L.last.x, L.last.y, L.last.w, L.last.h); }
  for (const [L, opened] of layers) {
    if (!opened) { L.last = null; continue; }
    L.target.drawImage(L.cvs, 0, 0, L.sw, L.sh, L.x, L.y, L.dw, L.dh);
    L.last = { x: L.x, y: L.y, w: Math.ceil(L.dw), h: Math.ceil(L.dh) };
  }
}
// canvas.js との循環インポートのため、モジュール読み込み時には overlayCtx が未初期化。初回描画時に作る
let _ovLayer = null, _anLayer = null, _retLayer = null;

// → effectsWrap 外側の overlayCanvas に描くため CSS filter 非適用
export function _drawOverlays() {
  if (!_ovLayer) { _ovLayer = _newBoxLayer(overlayCtx); _anLayer = _newBoxLayer(anchorCtx); _retLayer = _newBoxLayer(anchorCtx); }
  const W = canvas.width, H = canvas.height;
  const m = state.mask;
  const bufScale = _lastBufScale;
  // 描画範囲: マスクの周囲（スマホ枠のはみ出し・ハンドル・枠線の太さ分の余白つき）。
  // 回転したスペクトラムは外接矩形からはみ出すため、対角線を半径とする範囲で覆う。
  // 実際に描くときだけ箱を開き、描かなかったレイヤーは前回分を消すだけにする
  const _cx = m.x + m.w / 2, _cy = m.y + m.h / 2;
  const _pad = 0.3 * Math.max(m.w, m.h) + 48 * bufScale;
  const _rot = m.shape === 'spectrum' && m.specRotate;
  const _hx = (_rot ? Math.hypot(m.w, m.h) / 2 : m.w / 2) + _pad;
  const _hy = (_rot ? Math.hypot(m.w, m.h) / 2 : m.h / 2) + _pad;
  let _ovOpen = false, _anOpen = false, _retOpen = false;
  const openD = () => { if (!_ovOpen) { _boxBegin(_ovLayer, _cx - _hx, _cy - _hy, _cx + _hx, _cy + _hy, W, H); _ovOpen = true; } return _ovLayer.ctx; };
  const openA = () => { if (!_anOpen) { _boxBegin(_anLayer, _cx - _hx, _cy - _hy, _cx + _hx, _cy + _hy, W, H); _anOpen = true; } return _anLayer.ctx; };
  const openR = (ax, ay, rr) => { if (!_retOpen) { _boxBegin(_retLayer, ax - rr, ay - rr, ax + rr, ay + rr, W, H); _retOpen = true; } return _retLayer.ctx; };

  // --- マスク枠 ---
  const bw = parseFloat(elBorderW.value);
  if (bw > 0 && !maskHidden && !visHidden[1] && state.mask.shape !== 'glasses') {
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
      const dCtx = openD();
      dCtx.save();
      dCtx.lineWidth   = bw * 1.5 * bufScale;
      dCtx.globalAlpha = (parseInt(elBorderOpacity.value, 10) / 100) * borderFadeA;
      if (anim !== 'none') {
        const speed  = parseFloat(elBorderAnimSpeed.value) * 0.1;
        const bright = parseInt(elBorderAnimBright.value, 10);
        const phase  = (performance.now() * 0.001 * speed) % 1;
        dCtx.strokeStyle = _buildBorderGrad(dCtx, m, phase, anim, bright);
      } else if (!state.borderInvert) {
        dCtx.strokeStyle = elBorderColor.value;
      }
      if (!state.borderInvert || anim !== 'none') {
        const _usesSkyline = m.shape === 'spectrum' && parseInt(elSpecGap?.value ?? 15) === 0;
        if (_usesSkyline && _spectrumSkyline(dCtx, m)) {
          dCtx.stroke();
        } else {
          const _gp6 = buildMaskPath(dCtx, m, true);
          _gp6 ? dCtx.stroke(_gp6) : dCtx.stroke();
        }
      }
      dCtx.restore();
    }
  }

  // --- リサイズハンドル ---
  if ((state.maskHovered || state.drag.active || state.maskTouched) && !maskHidden && !visHidden[1] && state.followMode === 'none' && state.drag.mode !== 'fg-anchor') {
    const dCtx = openD();
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

  // --- 前景アンカー（phone + fgFixed ON 時） ---
  // anchorCtx (mix-blend-mode:difference CSS) に描画 → 下の映像とネガポジ反転
  // （レイヤーを開いたときだけ描き、前回分の消去は _boxFinish がまとめて行う）

  // --- borderInvert 枠（anchorCanvas の difference 合成を利用） ---
  if (state.borderInvert && bw > 0 && !maskHidden && !visHidden[1] && state.mask.shape !== 'glasses') {
    // ※ borderFadeA / anim 判定は上で計算済みなので再利用できないため再計算
    let bfa;
    if (_fgFadeStart === 0) { bfa = 0; }
    else if (_fgFadeStart > 0) { bfa = _lastFgAlpha; }
    else if (_maskBorderFadeStart === 0) { bfa = 0; }
    else if (_maskBorderFadeStart > 0) { bfa = Math.min(1, (performance.now() - _maskBorderFadeStart) / 500); }
    else { bfa = 1; }
    if (bfa > 0) {
      const anchorCtx = openA();
      anchorCtx.save();
      anchorCtx.lineWidth   = bw * 1.5 * bufScale;
      anchorCtx.globalAlpha = (parseInt(elBorderOpacity.value, 10) / 100) * bfa;
      anchorCtx.strokeStyle = '#ffffff';
      const _usesSkylineInv = m.shape === 'spectrum' && parseInt(elSpecGap?.value ?? 15) === 0;
      if (_usesSkylineInv && _spectrumSkyline(anchorCtx, m)) {
        anchorCtx.stroke();
      } else {
        const _gp7 = buildMaskPath(anchorCtx, m, true);
        _gp7 ? anchorCtx.stroke(_gp7) : anchorCtx.stroke();
      }
      anchorCtx.restore();
    }
  }

  if (state.fgFixed && state.mask.shape === 'phone' && (loaded[1] ? !visHidden[1] : loaded[0] && !visHidden[0])) {
    const ax  = W / 2 + parseFloat(elFgPinX.value);
    const ay  = H / 2 + parseFloat(elFgPinY.value);
    const r   = Math.max(18, Math.round(28 * bufScale));
    const abw = Math.max(8,  Math.round(12 * bufScale));
    const ca  = Math.max(5,  Math.round(7  * bufScale));
    const lw  = Math.max(1,  1.2 * bufScale);
    const clw = Math.max(1,  1.0 * bufScale);
    const _anchorAlpha = elFgPinOpacity ? parseFloat(elFgPinOpacity.value) / 100 : 1;
    const anchorCtx = openR(ax, ay, r + abw + 8 * bufScale);
    anchorCtx.save();
    anchorCtx.globalAlpha = _anchorAlpha;
    // globalCompositeOperation はデフォルト source-over のまま
    // ネガポジ反転は CSS mix-blend-mode:difference が担当
    anchorCtx.strokeStyle = '#ffffff';
    anchorCtx.lineCap     = 'round';
    anchorCtx.lineJoin    = 'round';
    anchorCtx.lineWidth = lw;
    anchorCtx.beginPath();
    anchorCtx.moveTo(ax - r, ay - r + abw); anchorCtx.lineTo(ax - r, ay - r); anchorCtx.lineTo(ax - r + abw, ay - r); // TL
    anchorCtx.moveTo(ax + r - abw, ay - r); anchorCtx.lineTo(ax + r, ay - r); anchorCtx.lineTo(ax + r, ay - r + abw); // TR
    anchorCtx.moveTo(ax - r, ay + r - abw); anchorCtx.lineTo(ax - r, ay + r); anchorCtx.lineTo(ax - r + abw, ay + r); // BL
    anchorCtx.moveTo(ax + r - abw, ay + r); anchorCtx.lineTo(ax + r, ay + r); anchorCtx.lineTo(ax + r, ay + r - abw); // BR
    anchorCtx.stroke();
    anchorCtx.lineWidth = clw;
    anchorCtx.beginPath();
    anchorCtx.moveTo(ax - ca, ay); anchorCtx.lineTo(ax + ca, ay);
    anchorCtx.moveTo(ax, ay - ca); anchorCtx.lineTo(ax, ay + ca);
    anchorCtx.stroke();
    anchorCtx.restore();
  }

  // --- スマホ枠オーバーレイ ---
  if (!maskHidden && !visHidden[1] && state.mask.shape === 'phone') {
    const speed = parseFloat(elBorderAnimSpeed.value) * 0.1;
    const phase = (performance.now() * 0.001 * speed) % 1;
    if (state.borderInvert) {
      // UI要素は dCtx に通常描画、本体アウトラインのみ anchorCtx に白で描画
      _drawPhoneFrame(openD(), m, bufScale, 1.0, phase, null, true, false, true);   // UI only (skip outline + dot)
      _drawPhoneFrame(openA(), m, bufScale, 1.0, phase, '#ffffff', false, true); // outline + dot
    } else {
      _drawPhoneFrame(openD(), m, bufScale, 1.0, phase);
    }
  }

  // --- メガネ枠オーバーレイ ---
  if (!maskHidden && !visHidden[1] && state.mask.shape === 'glasses') {
    const gfCtx = state.borderInvert ? openA() : openD();
    _drawGlassesFrame(gfCtx, m, bufScale, state.borderInvert ? '#ffffff' : null);
  }
  _boxFinish([[_ovLayer, _ovOpen], [_anLayer, _anOpen], [_retLayer, _retOpen]]);
}

let _fpsLastTime = 0;
// FPS スナップ値 (インデックス 0=OFF, 1↑=実fps)
const _FPS_SNAPS = [0, 18, 23.976, 24, 29.97, 30, 48, 59.94, 60, 120];

// FPS 制限時の映像フレームキャッシュ
// 実フレームでキャプチャし、lerp 補間フレームでは同フレームを再利用する。
// これにより「映像はFPSレート、lerp/描画は毎rAF」が実現できる。
const _fpsVidCvs = [document.createElement('canvas'), document.createElement('canvas')];
const _fpsVidCtx = _fpsVidCvs.map(c => c.getContext('2d'));
const _vidFreezeReady = [false, false];
let _vidFreezeMode = false;
function _getVidSrc(i) {
  return (_vidFreezeMode && _vidFreezeReady[i]) ? _fpsVidCvs[i] : getMediaSrc(i);
}

// --- 描画スキップ（同じ映像フレームの再描画を避ける） ---
// リフレッシュレートが映像の fps より高い（例: 144Hz に 60fps の映像）と、rAF ごとに
// 同じ内容を全面再描画することになり、4K では GPU の無駄が大きく、フィルターを重ねるとコマ落ちの原因になる。
// 新しい映像フレームが届かず、操作・アニメーションも無いときだけ _renderFrame と表示用ブリットを省く。
// 判定漏れがあっても _PAINT_MAX_IDLE_MS ごとに必ず再描画する。
//
// 重いフィルターを重ねているときは、新しい動画フレームや、枠のドラッグなど操作・アニメーション由来の再描画を
// 約 75 回/秒までに間引く（全面を描き直すたびに数 ms の GPU 時間がかかり、それ以上では GPU が飽和してコマ落ちになるため）。
// 枠線・ハンドルなどのオーバーレイは毎回更新するので、操作の追従感は保たれる。
const _PAINT_MAX_IDLE_MS = 250;
const _DIRTY_HOLD_MS = 400;
const _HEAVY_LOAD = 3;
const _HEAVY_MIN_INTERVAL_MS = 13;
let _dirtyUntil = 0;
let _lastPaintT = 0;
let _paintedSig = '';
const _paintedTs = [-1, -1];
let _dirtyHooked = false;
let _paintOwed = false;
let _skipKind = 'idle';
let _lastFilterPath = '2D';
function _markDirty() { _dirtyUntil = performance.now() + _DIRTY_HOLD_MS; }
function _hookDirtyEvents() {
  if (_dirtyHooked) return;
  _dirtyHooked = true;
  ['pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'wheel', 'input', 'change', 'click',
   'drop', 'dragover', 'touchstart', 'touchmove', 'touchend', 'contextmenu']
    .forEach(t => window.addEventListener(t, _markDirty, { capture: true, passive: true }));
  window.addEventListener('resize', _markDirty);
  vid.forEach(v => ['loadeddata', 'seeking', 'seeked', 'emptied', 'play', 'pause']
    .forEach(t => v.addEventListener(t, _markDirty)));
}
function _paintSig() {
  return `${loaded[0]}${mediaType[0]}${visHidden[0]}|${loaded[1]}${mediaType[1]}${visHidden[1]}|${canvas.width}x${canvas.height}`;
}
// フィルターの重さの目安（4K での全面処理の回数に近い値）。にじみ・エアブラシは 2 回分
function _filterLoad() {
  if (effectsHidden) return 0;
  const on = el => (el && parseFloat(el.value) > 0 ? 1 : 0);
  return 2 * on(elFilterBloom) + 2 * on(elFilterAirbrush) + on(elFilterPencil) + on(elFilterEmboss)
    + on(elFilterChalkboard) + on(elFilterCA) + on(elFilterNightVision) + on(elFilterBlur) + 0.5 * on(elFilterPixel)
    + 0.5 * on(elFilterFlare) + 0.5 * on(elFilterSharpness) + (_colorFilters().outStr ? 1 : 0);
}
function _canSkipPaint(now) {
  if (now - _lastPaintT > _PAINT_MAX_IDLE_MS) return false;
  // 操作に関係なく、すぐ描き直す必要がある場合
  if (state.mask.shape === 'spectrum') return false;
  if (_fgFadeStart === 0 || (_fgFadeStart > 0 && now - _fgFadeStart < 400)) return false;
  let newFrame = false;
  for (let i = 0; i < 2; i++) {
    if (!loaded[i]) continue;
    // 動く可能性のある画像（GIF 等）は判定できないので常に描画する
    if (mediaType[i] === 'image') return false;
    const ts = getVidFrameTs(i);
    if (ts !== _paintedTs[i]) newFrame = true;
    // 再生中なのにフレーム取り込みが途絶えている場合は直接描画経路に落ちているため描画を続ける
    if (!vid[i].paused && now - ts > 100) return false;
  }
  if (_paintSig() !== _paintedSig) return false;
  // 操作・アニメーション中か
  const interactive = now < _dirtyUntil || state.drag.active || state.followMode !== 'none' ||
    Math.abs(parseFloat(elFgPinX.value)   - state.fgPinDispX) > 0.05 ||
    Math.abs(parseFloat(elFgPinY.value)   - state.fgPinDispY) > 0.05 ||
    Math.abs(parseFloat(elMaskZoom.value) - state.fgZoomDisp) > 0.0002;
  if (!interactive && !newFrame) {
    // 間引いて描けなかった最後の変更があれば、操作が終わったあとに必ず描く
    _skipKind = 'idle';
    return !_paintOwed;
  }
  // 描き直す理由はあるが、重いフィルターのときは回数を絞る。
  // 前景と背景の動画は新しいフレームが届く位相がずれており、どちらかが届くたびに描くと 60 回/秒を大きく超えるため
  if (now - _lastPaintT < _HEAVY_MIN_INTERVAL_MS && _filterLoad() >= _HEAVY_LOAD) {
    _paintOwed = true;
    _skipKind = 'throttle';
    return true;
  }
  return false;
}
function _notePainted(now) {
  _lastPaintT = now;
  _paintOwed = false;
  _paintedSig = _paintSig();
  _paintedTs[0] = getVidFrameTs(0);
  _paintedTs[1] = getVidFrameTs(1);
}
const _perfInfo = {
  dropped: () => vid.reduce((s, v) => s + (v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : 0), 0),
  load: _filterLoad,
  size: () => `${canvas.width}x${canvas.height}`,
  path: () => _lastFilterPath,
};

export function render(now) {
  _hookDirtyEvents();
  // 動画・画像が読み込まれたら、アイドル時に WebGL フィルターのシェーダーを準備しておく
  if (!_glWarmed && _filterGLEnabled && (loaded[0] || loaded[1])) {
    _glWarmed = true;
    (window.requestIdleCallback || (cb => setTimeout(cb, 500)))(() => warmUpFiltersGL());
  }
  // filterFps: 0=制限なし、それ以外=fps上限で間引き
  const fpsLimit = parseFloat(elFilterFps.value) || 0;
  const gb = effectsHidden ? 0 : parseFloat(elFilterBlur.value) * BLUR_SIGMA_PER_UNIT;
  // _blitMblur: _mblurCvs を blur フィルター込みで displayCtx に描画
  // (スキップフレームでも実フレームと同じ blur を適用してチラつきを防ぐ)
  const _blitMblur = (alpha) => {
    if (gb > 0) {
      svgGblurEl.setAttribute('stdDeviation', gb);
      displayCtx.filter = 'url(#gblur)';
    }
    displayCtx.globalAlpha = alpha;
    displayCtx.drawImage(_mblurCvs, 0, 0);
    displayCtx.filter = 'none';
    displayCtx.globalAlpha = 1;
  };
  let _isRealFrame = true;
  if (fpsLimit > 0) {
    const interval = 1000 / fpsLimit;
    if (now - _fpsLastTime < interval - 0.5) {
      // lerp 収束中・追従モード中はキャッシュ映像でフルレンダリング
      // 映像フレームは _fpsVidCvs（最後の実フレームで取得済み）を再利用するため
      // 映像のFPS間引きは維持しつつ、lerp/描画は毎rAFで更新できる。
      const _lerpActive =
        Math.abs(parseFloat(elFgPinX.value)   - state.fgPinDispX) > 0.05 ||
        Math.abs(parseFloat(elFgPinY.value)   - state.fgPinDispY) > 0.05 ||
        Math.abs(parseFloat(elMaskZoom.value) - state.fgZoomDisp) > 0.0002 ||
        state.followMode !== 'none';
      if (!_lerpActive) {
        // 前回の実フレームは displayCtx に表示済みで、ここで同じ内容を薄く重ね直しても内側の見た目は変わらない
        // （全体ぼかし有りだと外周の透明度だけがじわじわ変わる）。4K のぼかし描画を毎回行うのは無駄なので省く
        _drawOverlays();
        perfFrame(now, 'idle', _perfInfo);
        requestAnimationFrame(render);
        return;
      }
      // lerp 中: キャッシュ映像を使いフルレンダリング（_fpsLastTime は更新しない）
      _vidFreezeMode = true;
      _isRealFrame = false;
    } else {
      // 通常の実フレーム: モーションブラーを blit してから描画
      _blitMblur(0.35);
      _fpsLastTime = now;
      _vidFreezeMode = false;
    }
  }
  if (fpsLimit === 0 && _canSkipPaint(now)) {
    // 新しい映像フレームも操作も無い: 前回の描画結果をそのまま表示し、枠などのオーバーレイだけ更新する
    _updateCompositeTime();
    GFRainEngine.tick(false, _rainMask()); // メイン画像は前回から変わっていない（水滴だけ動かす）
    updateProgress();
    syncMaskDropOverlay();
    _updateCanvasHints();
    _drawOverlays();
    perfFrame(now, _skipKind, _perfInfo);
    requestAnimationFrame(render);
    return;
  }
  _renderFrame();
  _vidFreezeMode = false;
  _notePainted(now);
  _updateCompositeTime();
  if (_isRealFrame) {
    GFRainEngine.tick(undefined, _rainMask()); // 雨は filterFps レートのみ更新
    // 映像フレームをキャッシュに保存（FPS 制限時、lerp 補間フレームで再利用）
    const _cW = canvas.width, _cH = canvas.height;
    if (fpsLimit > 0) {
      if (_fpsVidCvs[0].width !== _cW || _fpsVidCvs[0].height !== _cH) {
        _fpsVidCvs.forEach(c => { c.width = _cW; c.height = _cH; });
      }
      for (let _vi = 0; _vi < 2; _vi++) {
        if (loaded[_vi] && !visHidden[_vi] && mediaType[_vi] !== 'image') {
          _fpsVidCtx[_vi].clearRect(0, 0, _cW, _cH);
          try { _fpsVidCtx[_vi].drawImage(getMediaSrc(_vi), 0, 0, _cW, _cH); _vidFreezeReady[_vi] = true; } catch (_) {}
        }
      }
    }
  }
  updateProgress();
  syncMaskDropOverlay();
  _updateCanvasHints();
  // 今フレームを保存（次フレームのブラー用）— 実フレームのみ更新
  if (fpsLimit > 0 && _isRealFrame) {
    _mblurCtx.clearRect(0, 0, _mblurCvs.width, _mblurCvs.height);
    _mblurCtx.drawImage(renderCvs, 0, 0);
  }
  // 最終段: ピクセル → ぼかし の順に、適用範囲（全体 / マスク内のみ / マスク外のみ）つきで表示用キャンバスへ描く。
  // copyモードでblit→透明画素も完全置換され残留しない
  // 内のみ・外のみのときは、マスク周辺の小さなキャンバスで反対側の絵を作って重ねる
  const fW = canvas.width, fH = canvas.height, fm = state.mask;
  const pxAmt = effectsHidden ? 0 : parseFloat(elFilterPixel.value);
  const pxScope = pxAmt >= 1 ? _maskScope('pixel') : 0;
  if (pxAmt >= 1 && gb <= 0) {
    // ぼかしが無ければ、ピクセル化の結果を直接表示用キャンバスへ描く（全面コピーを 1 回省ける）
    _pixelateInto(displayCtx, renderCvs, fW, fH, fm, pxAmt, pxScope);
  } else {
    const frameSrc = pxAmt >= 1 ? _pixelateFrame(renderCvs, fW, fH, fm, pxAmt, pxScope) : renderCvs;
    const gbScope = gb > 0 ? _maskScope('blur') : 0;
    if (gb > 0) svgGblurEl.setAttribute('stdDeviation', gb);
    // ぼかすときは端を外側へ複製した画像を使う（画面の端が薄れたり、端の数行だけぼけずに残るのを防ぐ）
    const blurPad = gb > 0 ? Math.ceil(gb * 3) + 2 : 0;
    const blurSrc = gb > 0 ? _edgeExtended(frameSrc, fW, fH, blurPad) : frameSrc;
    displayCtx.globalCompositeOperation = 'copy';
    if (gb > 0 && gbScope !== 1) {
      displayCtx.filter = 'url(#gblur)';
      displayCtx.drawImage(blurSrc, -blurPad, -blurPad);
      displayCtx.filter = 'none';
    } else {
      displayCtx.drawImage(frameSrc, 0, 0);
    }
    displayCtx.globalCompositeOperation = 'source-over';
    if (gbScope === 1) _drawMaskedRegion(displayCtx, blurSrc, fW, fH, fm, 'url(#gblur)', blurPad - 2, false, blurPad);
    else if (gbScope === 2) _drawMaskedRegion(displayCtx, frameSrc, fW, fH, fm, '', 0);
  }
  // 明るさ・コントラスト・彩度・色相: 全体は CSS（effectsWrap）。内のみ・外のみは、ここで表示用キャンバスに焼き込む
  const cf = _colorFilters();
  if (cf.css !== _lastCssFilter) { effectsWrap.style.filter = cf.css; _lastCssFilter = cf.css; }
  if (cf.inStr || cf.outStr) _applyColorScopes(displayCtx, fW, fH, fm, cf);
  // 枠・ハンドルは overlayCanvas (effectsWrap外) に描画 → filter非適用
  _drawOverlays();
  perfFrame(now, 'paint', _perfInfo);
  requestAnimationFrame(render);
}

export function _startRenderLoop() {
  if (_renderIntervalId) { clearInterval(_renderIntervalId); _renderIntervalId = null; }
  requestAnimationFrame(render);
}

const elHintBg = document.getElementById('hintBg');
const elHintFg = document.getElementById('hintFg');
export let _hintStatePrev = '';
export function resetHintState() { _hintStatePrev = ''; }
export function _updateCanvasHints() {
  const anyLoaded = loaded[0] || loaded[1];
  const showBg = !anyLoaded && !visHidden[0];
  const showFg = !anyLoaded && !visHidden[1];
  const hintKey = `${showBg}|${showFg}`;
  if (hintKey === _hintStatePrev) return; // 変化なければ DOM 操作しない
  _hintStatePrev = hintKey;
  elHintBg.textContent = showBg ? t('hint-bg') : '';
  elHintFg.textContent = showFg ? t('hint-fg') : '';
  elHintBg.classList.toggle('visible', showBg);
  elHintFg.classList.toggle('visible', showFg);
}

// --- メガネスタイル定義（7種） ---
const _GS = 4.166667; // SVGスケール定数
// Path2D キャッシュ: _glassesPaths[i] = { lens: Path2D, full: Path2D } または null
let _glassesPaths = [];
export const _GLASSES_STYLES = [
  // 0: ラウンド
  {
    vw: 2309, vh:  920, ox: 1735.157, oy:  80.322,
    lens: "M0,182.146C-50.218,182.146 -91.073,141.291 -91.073,91.073C-91.073,40.855 -50.218,0 0,0C50.218,0 91.073,40.855 91.073,91.073C91.073,141.291 50.218,182.146 0,182.146Z M-278.823,182.146C-329.041,182.146 -369.896,141.291 -369.896,91.073C-369.896,40.855 -329.041,0 -278.823,0C-228.605,0 -187.75,40.855 -187.75,91.073C-187.75,141.291 -228.605,182.146 -278.823,182.146Z",
    full: "M0,182.146C-50.218,182.146 -91.073,141.291 -91.073,91.073C-91.073,40.855 -50.218,0 0,0C50.218,0 91.073,40.855 91.073,91.073C91.073,141.291 50.218,182.146 0,182.146Z M-278.823,182.146C-329.041,182.146 -369.896,141.291 -369.896,91.073C-369.896,40.855 -329.041,0 -278.823,0C-228.605,0 -187.75,40.855 -187.75,91.073C-187.75,141.291 -228.605,182.146 -278.823,182.146Z M129.103,51.679L101.708,51.679C85.878,10.949 46.258,-18 0,-18C-45.314,-18 -84.258,9.779 -100.709,49.199C-111.771,40.321 -125.128,35.624 -139.412,35.624C-153.695,35.624 -167.052,40.321 -178.114,49.198C-194.566,9.778 -233.51,-18 -278.823,-18C-325.082,-18 -364.702,10.949 -380.532,51.679L-407.926,51.679C-411.902,51.679 -415.137,54.914 -415.137,58.89C-415.137,62.866 -411.902,66.101 -407.926,66.101L-385.008,66.101C-386.894,74.123 -387.896,82.483 -387.896,91.073C-387.896,151.216 -338.966,200.146 -278.823,200.146C-218.68,200.146 -169.75,151.216 -169.75,91.073C-169.75,81.763 -170.925,72.722 -173.131,64.088L-171.963,62.992C-153.71,45.845 -125.113,45.845 -106.86,62.992L-105.692,64.089C-107.898,72.722 -109.073,81.763 -109.073,91.073C-109.073,151.216 -60.143,200.146 0,200.146C60.143,200.146 109.073,151.216 109.073,91.073C109.073,82.483 108.071,74.123 106.184,66.101L129.103,66.101C133.079,66.101 136.314,62.866 136.314,58.89C136.314,54.914 133.079,51.679 129.103,51.679Z"
  },
  // 1: ティアドロップ
  {
    vw: 2331, vh:  832, ox: 1797.396, oy:  51.673,
    lens: "M0,175.027C-81.18,175.027 -115.149,94.999 -115.149,61.605C-115.149,14.969 -69.089,-0.576 -9.212,-0.576C50.666,-0.576 90.392,9.788 90.392,54.12C90.392,93.271 81.18,175.027 0,175.027Z M-303.418,175.027C-384.598,175.027 -393.81,93.271 -393.81,54.12C-393.81,9.788 -354.084,-0.576 -294.206,-0.576C-234.329,-0.576 -188.269,14.969 -188.269,61.605C-188.269,94.999 -222.238,175.027 -303.418,175.027Z",
    full: "M0,175.027C-81.18,175.027 -115.149,94.999 -115.149,61.605C-115.149,14.969 -69.089,-0.576 -9.212,-0.576C50.666,-0.576 90.392,9.788 90.392,54.12C90.392,93.271 81.18,175.027 0,175.027Z M-303.418,175.027C-384.598,175.027 -393.81,93.271 -393.81,54.12C-393.81,9.788 -354.084,-0.576 -294.206,-0.576C-234.329,-0.576 -188.269,14.969 -188.269,61.605C-188.269,94.999 -222.238,175.027 -303.418,175.027Z M-8.636,-10.939C-52.828,-10.939 -95.236,-3.233 -115.684,17.274C-136.513,8.06 -166.905,8.063 -187.735,17.274C-208.181,-3.233 -250.59,-10.939 -294.782,-10.939C-356.387,-10.939 -409.931,5.758 -430.082,13.242L-430.082,34.551C-403.022,43.187 -413.571,76.815 -390.932,127.24C-378.265,155.452 -352.356,185.966 -302.842,185.966C-227.996,185.966 -175.027,118.028 -175.027,47.787C-175.027,43.296 -175.671,39.124 -176.837,35.224C-162.184,29.707 -141.234,29.705 -126.581,35.224C-127.748,39.124 -128.392,43.296 -128.392,47.787C-128.392,118.028 -75.423,185.966 -0.576,185.966C48.938,185.966 74.847,155.452 87.513,127.24C110.153,76.815 99.604,43.187 126.664,34.551L126.664,13.242C106.513,5.758 52.969,-10.939 -8.636,-10.939Z"
  },
  // 2: ウェリントン
  {
    vw: 2233, vh:  801, ox: 2004.737, oy: 132.517,
    lens: "M0,126.277C-8.616,136.847 -39.803,144.354 -66.727,145.295C-93.649,146.235 -121.996,146.144 -137.113,132.991C-147.042,124.352 -165.315,83.836 -170.479,59.706C-176.615,31.039 -177.152,15.654 -169.773,6.411C-162.648,-2.514 -115.093,-8.334 -72.785,-9.812C7.344,-12.611 21.693,-6.051 22.768,24.717C24.2,65.744 8.616,115.708 0,126.277Z M-255.982,59.706C-261.147,83.836 -279.42,124.352 -289.349,132.991C-304.466,146.144 -332.812,146.235 -359.736,145.295C-386.659,144.354 -417.845,136.847 -426.461,126.277C-435.078,115.708 -450.662,65.744 -449.229,24.717C-448.155,-6.051 -433.806,-12.611 -353.677,-9.812C-311.369,-8.334 -263.813,-2.514 -256.688,6.411C-249.31,15.654 -249.847,31.039 -255.982,59.706Z",
    full: "M0,126.277C-8.616,136.847 -39.803,144.354 -66.727,145.295C-93.649,146.235 -121.996,146.144 -137.113,132.991C-147.042,124.352 -165.315,83.836 -170.479,59.706C-176.615,31.039 -177.152,15.654 -169.773,6.411C-162.648,-2.514 -115.093,-8.334 -72.785,-9.812C7.344,-12.611 21.693,-6.051 22.768,24.717C24.2,65.744 8.616,115.708 0,126.277Z M-255.982,59.706C-261.147,83.836 -279.42,124.352 -289.349,132.991C-304.466,146.144 -332.812,146.235 -359.736,145.295C-386.659,144.354 -417.845,136.847 -426.461,126.277C-435.078,115.708 -450.662,65.744 -449.229,24.717C-448.155,-6.051 -433.806,-12.611 -353.677,-9.812C-311.369,-8.334 -263.813,-2.514 -256.688,6.411C-249.31,15.654 -249.847,31.039 -255.982,59.706Z M-77.656,-29.859C-189.836,-25.942 -168.332,-8.619 -213.231,-8.619C-258.13,-8.619 -236.625,-25.942 -348.806,-29.859C-460.985,-33.777 -458.851,-12.202 -478.723,-12.896L-479.865,19.798C-469.742,24.002 -464.398,36.382 -461.313,58.312C-458.228,80.241 -450.04,129.058 -433.387,140.797C-417.101,152.276 -397.385,157.458 -360.206,158.756C-323.026,160.054 -295.965,155.812 -280.091,143.583C-260.964,128.847 -243.122,76.308 -233.21,50.874C-228.276,38.21 -220.447,30.507 -213.231,30.507C-206.016,30.507 -198.186,38.21 -193.251,50.874C-183.34,76.308 -165.498,128.847 -146.371,143.583C-130.497,155.812 -103.436,160.054 -66.256,158.756C-29.077,157.458 -9.361,152.276 6.925,140.797C23.578,129.058 31.767,80.241 34.851,58.312C37.937,36.382 43.28,24.002 53.402,19.798L52.261,-12.896C32.389,-12.202 34.524,-33.777 -77.656,-29.859Z"
  },
  // 3: ボストン
  {
    vw: 2176, vh:  653, ox: 1601.462, oy:  52.046,
    lens: "M0,131.539C-48.234,131.539 -89.932,85.684 -89.932,54.795C-89.932,19.222 -62.234,2.718 0,2.718C31.436,2.718 100.276,6.643 100.276,51.075C100.276,103.042 53.835,131.539 0,131.539Z M-246.498,131.539C-300.333,131.539 -346.774,103.042 -346.774,51.075C-346.774,6.643 -277.934,2.718 -246.498,2.718C-184.264,2.718 -156.566,19.222 -156.566,54.795C-156.566,85.684 -198.264,131.539 -246.498,131.539Z",
    full: "M0,131.539C-48.234,131.539 -89.932,85.684 -89.932,54.795C-89.932,19.222 -62.234,2.718 0,2.718C31.436,2.718 100.276,6.643 100.276,51.075C100.276,103.042 53.835,131.539 0,131.539Z M-246.498,131.539C-300.333,131.539 -346.774,103.042 -346.774,51.075C-346.774,6.643 -277.934,2.718 -246.498,2.718C-184.264,2.718 -156.566,19.222 -156.566,54.795C-156.566,85.684 -198.264,131.539 -246.498,131.539Z M133.515,28.795C127.764,28.795 116.133,28.003 108.305,26.369C93.251,0.667 48.646,-11.234 -1.556,-11.234C-45.746,-11.234 -79.534,-1.17 -95.246,20.069C-108.361,26.136 -108.81,18.659 -123.249,18.659C-137.688,18.659 -138.137,26.136 -151.252,20.068C-166.964,-1.17 -200.752,-11.234 -244.942,-11.234C-295.144,-11.234 -339.749,0.667 -354.803,26.369C-362.631,28.003 -374.262,28.795 -380.013,28.795C-384.46,35.219 -383.472,51.394 -380.013,58.807C-370.944,58.807 -364.261,59.855 -358.462,65.361C-348.802,115.536 -300.272,142.773 -244.942,142.773C-183.907,142.773 -142.709,89.446 -141.591,52.555C-136.601,47.743 -130.213,44.23 -123.249,44.23C-116.285,44.23 -109.897,47.743 -104.907,52.555C-103.789,89.446 -62.591,142.773 -1.556,142.773C53.774,142.773 102.304,115.536 111.964,65.361C117.763,59.855 124.446,58.807 133.515,58.807C136.974,51.394 137.961,35.219 133.515,28.795Z"
  },
  // 4: オーバル
  {
    vw: 2286, vh:  629, ox: 2054.879, oy: 168.448,
    lens: "M0,70.012C-13.306,82.529 -38.447,97.449 -82.655,97.449C-124.392,97.449 -148.529,86.341 -161.428,77.023C-176.991,65.779 -184.168,50.866 -184.168,33.897C-184.168,16.147 -177.162,1.724 -161.273,-8.971C-143.28,-21.084 -116.458,-27.486 -83.705,-27.486C-51.333,-27.486 -23.37,-22.261 -4.824,-10.391C12.283,0.559 19.907,16.521 19.907,34.982C19.907,40.301 15.041,55.862 0,70.012Z M-276.311,77.023C-289.209,86.341 -313.347,97.449 -355.083,97.449C-399.292,97.449 -424.433,82.529 -437.738,70.012C-452.779,55.862 -457.646,40.301 -457.646,34.982C-457.646,16.521 -450.021,0.559 -432.914,-10.391C-414.368,-22.261 -386.405,-27.486 -354.033,-27.486C-321.281,-27.486 -294.458,-21.084 -276.465,-8.971C-260.576,1.724 -253.57,16.147 -253.57,33.897C-253.57,50.866 -260.747,65.779 -276.311,77.023Z",
    full: "M0,70.012C-13.306,82.529 -38.447,97.449 -82.655,97.449C-124.392,97.449 -148.529,86.341 -161.428,77.023C-176.991,65.779 -184.168,50.866 -184.168,33.897C-184.168,16.147 -177.162,1.724 -161.273,-8.971C-143.28,-21.084 -116.458,-27.486 -83.705,-27.486C-51.333,-27.486 -23.37,-22.261 -4.824,-10.391C12.283,0.559 19.907,16.521 19.907,34.982C19.907,40.301 15.041,55.862 0,70.012Z M-276.311,77.023C-289.209,86.341 -313.347,97.449 -355.083,97.449C-399.292,97.449 -424.433,82.529 -437.738,70.012C-452.779,55.862 -457.646,40.301 -457.646,34.982C-457.646,16.521 -450.021,0.559 -432.914,-10.391C-414.368,-22.261 -386.405,-27.486 -354.033,-27.486C-321.281,-27.486 -294.458,-21.084 -276.465,-8.971C-260.576,1.724 -253.57,16.147 -253.57,33.897C-253.57,50.866 -260.747,65.779 -276.311,77.023Z M51.108,5.403C44.986,5.403 32.47,4.506 24.405,2.65C7.505,-24.003 -31.685,-39.074 -83.705,-39.074C-136.993,-39.074 -173.742,-23.518 -189.78,1.822C-203.96,9.196 -204.044,4.038 -218.869,4.038C-233.694,4.038 -233.778,9.196 -247.959,1.821C-263.996,-23.518 -300.746,-39.074 -354.033,-39.074C-406.054,-39.074 -445.243,-24.003 -462.144,2.65C-470.208,4.506 -482.725,5.403 -488.847,5.403C-493.294,11.826 -492.306,28.002 -488.847,35.414C-481.51,35.414 -476.435,36.1 -470.915,39.274C-467.426,60.825 -438.928,109.086 -355.083,109.086C-281.82,109.086 -241.791,77.256 -239.037,38.289C-233.828,33.31 -226.717,29.609 -218.869,29.609C-211.022,29.609 -203.91,33.31 -198.701,38.289C-195.948,77.256 -155.918,109.086 -82.655,109.086C1.189,109.086 29.687,60.825 33.177,39.274C38.696,36.1 43.771,35.414 51.108,35.414C54.567,28.002 55.556,11.826 51.108,5.403Z"
  },
  // 5: スクエア
  {
    vw: 2274, vh:  523, ox: 2001.467, oy:  87.418,
    lens: "M0,86.376C-14.313,93.001 -137.24,93.65 -150.436,87.524C-162.809,81.779 -179.756,27.576 -172.529,11.52C-167.025,-0.711 -99.086,-4.847 -67.708,-4.847C-45.689,-4.847 25.321,-7.481 25.321,14.519C25.321,27.77 14.313,79.751 0,86.376Z M-264.545,87.524C-277.74,93.65 -400.668,93.001 -414.98,86.376C-429.293,79.751 -440.302,27.77 -440.302,14.519C-440.302,-7.481 -369.291,-4.847 -347.272,-4.847C-315.896,-4.847 -247.955,-0.711 -242.451,11.52C-235.225,27.576 -252.172,81.779 -264.545,87.524Z",
    full: "M0,86.376C-14.313,93.001 -137.24,93.65 -150.436,87.524C-162.809,81.779 -179.756,27.576 -172.529,11.52C-167.025,-0.711 -99.086,-4.847 -67.708,-4.847C-45.689,-4.847 25.321,-7.481 25.321,14.519C25.321,27.77 14.313,79.751 0,86.376Z M-264.545,87.524C-277.74,93.65 -400.668,93.001 -414.98,86.376C-429.293,79.751 -440.302,27.77 -440.302,14.519C-440.302,-7.481 -369.291,-4.847 -347.272,-4.847C-315.896,-4.847 -247.955,-0.711 -242.451,11.52C-235.225,27.576 -252.172,81.779 -264.545,87.524Z M60.96,9.229C52.665,9.229 46.704,8.363 40.931,4.047C38.521,-18.386 -42.305,-19.648 -67.761,-19.648C-104.441,-19.648 -180.607,-10.639 -187.042,4.806C-187.585,6.108 -188.015,7.586 -188.343,9.209C-195.742,13.25 -193.614,7.35 -207.49,7.35C-221.365,7.35 -219.239,13.25 -226.638,9.209C-226.965,7.586 -227.396,6.108 -227.938,4.806C-234.374,-10.639 -310.539,-19.648 -347.22,-19.648C-372.676,-19.648 -453.501,-18.386 -455.911,4.047C-461.685,8.363 -467.646,9.229 -475.94,9.229C-479.422,16.689 -480.416,32.971 -475.94,39.437C-470.135,39.437 -458.389,40.238 -450.497,41.893C-445.144,65.126 -436.364,90.547 -426.373,95.543C-409.642,103.908 -274.408,106.024 -259.058,98.117C-245.479,91.122 -233.09,63.214 -228.128,38.695C-222.857,33.553 -215.558,29.519 -207.49,29.519C-199.423,29.519 -192.123,33.553 -186.854,38.695C-181.891,63.214 -169.501,91.122 -155.923,98.117C-140.572,106.024 -5.339,103.908 11.393,95.543C21.384,90.547 30.163,65.126 35.517,41.893C43.408,40.238 55.154,39.437 60.96,39.437C65.436,32.971 64.441,16.689 60.96,9.229Z"
  },
  // 6: スクエア (S)
  {
    vw: 2225, vh:  537, ox: 2108.502, oy: 343.775,
    lens: "M0,-36.168C-1.069,-10.201 -2.29,11.377 -13.69,21.555C-22.186,29.141 -66.082,37.433 -109.364,37.433C-152.646,37.433 -172.534,36.759 -185.577,22.529C-202.584,3.976 -207.901,-31.438 -200.967,-45.621C-192.011,-63.941 -118.58,-71.149 -80.634,-71.149C-49.804,-71.149 -20.158,-67.591 -14.229,-64.034C-8.301,-60.477 0.958,-59.444 0,-36.168Z M-292.3,22.529C-305.343,36.759 -325.231,37.433 -368.513,37.433C-411.794,37.433 -455.691,29.141 -464.187,21.555C-475.587,11.377 -476.808,-10.201 -477.877,-36.168C-478.835,-59.444 -469.576,-60.477 -463.647,-64.034C-457.719,-67.591 -428.073,-71.149 -397.242,-71.149C-359.297,-71.149 -285.866,-63.941 -276.91,-45.621C-269.976,-31.438 -275.292,3.976 -292.3,22.529Z",
    full: "M0,-36.168C-1.069,-10.201 -2.29,11.377 -13.69,21.555C-22.186,29.141 -66.082,37.433 -109.364,37.433C-152.646,37.433 -172.534,36.759 -185.577,22.529C-202.584,3.976 -207.901,-31.438 -200.967,-45.621C-192.011,-63.941 -118.58,-71.149 -80.634,-71.149C-49.804,-71.149 -20.158,-67.591 -14.229,-64.034C-8.301,-60.477 0.958,-59.444 0,-36.168Z M-292.3,22.529C-305.343,36.759 -325.231,37.433 -368.513,37.433C-411.794,37.433 -455.691,29.141 -464.187,21.555C-475.587,11.377 -476.808,-10.201 -477.877,-36.168C-478.835,-59.444 -469.576,-60.477 -463.647,-64.034C-457.719,-67.591 -428.073,-71.149 -397.242,-71.149C-359.297,-71.149 -285.866,-63.941 -276.91,-45.621C-269.976,-31.438 -275.292,3.976 -292.3,22.529Z M-81.82,-81.228C-151.189,-81.228 -187.356,-69.963 -199.807,-65.22C-212.258,-60.477 -230.638,-57.517 -238.938,-57.517C-247.239,-57.517 -265.619,-60.477 -278.07,-65.22C-290.521,-69.963 -326.687,-81.228 -396.057,-81.228C-465.426,-81.228 -490.921,-72.928 -504.558,-64.034L-504.558,-43.876C-492.699,-39.725 -488.007,-28.455 -486.178,-12.452C-483.806,8.3 -478.47,25.494 -462.462,32.608C-444.451,40.613 -394.871,45.06 -356.926,45.06C-318.979,45.06 -297.314,41.801 -285.185,28.458C-261.469,2.371 -263.247,-34.394 -238.938,-34.394C-214.63,-34.394 -216.408,2.371 -192.692,28.458C-180.562,41.801 -158.897,45.06 -120.951,45.06C-83.006,45.06 -33.426,40.613 -15.415,32.608C0.593,25.494 5.93,8.3 8.301,-12.452C10.13,-28.455 14.822,-39.725 26.681,-43.876L26.681,-64.034C13.044,-72.928 -12.451,-81.228 -81.82,-81.228Z"
  },
];

export function _glassesMatrix(g, m) {
  // SVG viewBox 座標系 → キャンバス座標系への変換行列（ユニフォームスケールでレターボックス配置）
  const s = Math.min(m.w / g.vw, m.h / g.vh);
  const dx = (m.w - g.vw * s) / 2;
  const dy = (m.h - g.vh * s) / 2;
  return new DOMMatrix([_GS * s, 0, 0, _GS * s, g.ox * s + m.x + dx, g.oy * s + m.y + dy]);
}

// 全スタイル共通の固定初期サイズ（800×320）— スタイル固有のアス比はレターボックスで収まる
export function _glassesInitSize(cw, ch) {
  return { w: Math.min(800, cw), h: Math.min(320, ch) };
}

export function buildMaskPath(c, m, forStroke = false) {
  if (m.shape === 'glasses') {
    const idx = (state.mask.glassesStyle || 0) % _GLASSES_STYLES.length;
    const g = _GLASSES_STYLES[idx];
    if (!_glassesPaths[idx]) {
      const frameStr = (g.full.match(/M[^M]*/g) || []).slice(2).join('');
      _glassesPaths[idx] = { lens: new Path2D(g.lens), full: new Path2D(g.full), frame: new Path2D(frameStr) };
    }
    const p = new Path2D();
    p.addPath(_glassesPaths[idx].lens, _glassesMatrix(g, m));
    return p;
  }
  // 他のシェイプは従来通り c に描いて null を返す
  c.beginPath();
  if (m.shape === 'rect') {
    c.rect(m.x, m.y, m.w, m.h);
  } else if (m.shape === 'phone') {
    const br = Math.round(Math.min(m.w, m.h) * 0.11);
    if (typeof c.roundRect === 'function') { c.roundRect(m.x, m.y, m.w, m.h, br); }
    else { c.rect(m.x, m.y, m.w, m.h); }
  } else if (m.shape === 'circle') {
    c.ellipse(m.x + m.w / 2, m.y + m.h / 2, m.w / 2, m.h / 2, 0, 0, Math.PI * 2);
  } else if (m.shape === 'spectrum') {
    const specShape  = m.specShape  || 'bars';
    const specSym    = m.specSym    || 'none';
    const specRotate = ((m.specRotate || 0) * Math.PI / 180);
    const BAR_COUNT = elSpecBars ? Math.max(4, parseInt(elSpecBars.value) || 64) : 64;
    const amp       = elSpecAmp  ? Math.max(0.1, parseFloat(elSpecAmp.value) / 100) : 1.0;
    const bars      = getSpectrumBars(BAR_COUNT);
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    if (specRotate !== 0) {
      c.save();
      c.translate(cx, cy);
      c.rotate(specRotate);
      c.translate(-cx, -cy);
    }
    c.beginPath();
    if (specShape === 'bars') {
      const smooth  = elSpecSmooth ? parseFloat(elSpecSmooth.value) / 100 : 0;
      const sBars   = smooth > 0 && bars ? smoothBars(bars, smooth * BAR_COUNT * 1.5) : bars;
      const gapPct  = elSpecGap ? parseInt(elSpecGap.value) : 0;
      const gap     = gapPct === 0 ? 0 : Math.max(1, Math.round(m.w / BAR_COUNT * gapPct / 100));
      const barW    = Math.max(1, (m.w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const HALF    = Math.ceil(BAR_COUNT / 2);
      const hv = (i) => {
        const barIdx = specSym === 'lr' ? (i < HALF ? HALF - 1 - i : i - HALF) : i;
        return Math.max(0, Math.min(1, (sBars ? sBars[barIdx] * amp : 0)));
      };
      if (smooth > 0 && gapPct === 0) {
        // スムース bezier 塗り
        if (specSym === 'ud') {
          const midY = m.y + m.h / 2;
          const topPts = [{ x: m.x, y: midY }];
          for (let i = 0; i < BAR_COUNT; i++) topPts.push({ x: m.x + (i + 0.5) * barW, y: midY - hv(i) * m.h / 2 });
          topPts.push({ x: m.x + m.w, y: midY });
          c.moveTo(topPts[0].x, topPts[0].y);
          _smoothCurveThrough(c, topPts);
          const botPts = topPts.slice().reverse().map(p => ({ x: p.x, y: 2 * midY - p.y }));
          _smoothCurveThrough(c, botPts.slice(1));
          c.closePath();
        } else {
          const bottom = m.y + m.h;
          const topPts = [{ x: m.x, y: bottom - hv(0) * m.h }];
          for (let i = 0; i < BAR_COUNT; i++) topPts.push({ x: m.x + (i + 0.5) * barW, y: bottom - hv(i) * m.h });
          topPts.push({ x: m.x + m.w, y: bottom - hv(BAR_COUNT - 1) * m.h });
          c.moveTo(m.x, bottom);
          _smoothCurveThrough(c, topPts);
          c.lineTo(m.x + m.w, bottom);
          c.closePath();
        }
      } else if (specSym === 'ud') {
        // 上下対称（ミラー）
        const midY = m.y + m.h / 2;
        for (let i = 0; i < BAR_COUNT; i++) {
          const halfH = Math.max(1, hv(i) * m.h / 2);
          c.rect(m.x + i * (barW + gap), midY - halfH, barW, halfH * 2);
        }
      } else {
        // none / lr: バー短冊
        const bottom = m.y + m.h;
        for (let i = 0; i < BAR_COUNT; i++) {
          const barH = Math.max(2, hv(i) * m.h);
          c.rect(m.x + i * (barW + gap), bottom - barH, barW, barH);
        }
      }
    } else if (specShape === 'ring') {
      // --- ring: 内側に膨らむドーナツ型スペクトラム ---
      // 外円（固定 R）と内側の音声波形の間のリング領域をクリップ
      // nonzero rule: 外円 CW(+1) ＋ 内波形 CCW(-1) → リング部分のみ塗り
      const smooth = elSpecSmooth ? parseFloat(elSpecSmooth.value) / 100 : 0;
      const sBars  = smooth > 0 && bars ? smoothBars(bars, smooth * BAR_COUNT * 1.5) : bars;
      const R      = Math.min(m.w, m.h) / 2;
      const rBase  = R * 0.80; // 無音時の内縁半径（外周 20% リングが常時見える）
      const rMin_  = R * 0.12; // 最大音量時の内縁半径（外周 88% まで広がる）
      const HALF_R = Math.floor(BAR_COUNT / 2);
      const innerR = (i) => {
        let barIdx;
        if (specSym === 'lr') {
          // 垂直軸（i=0:上 / i=HALF:下）で折り返し → 左右対称
          barIdx = i <= HALF_R ? i : BAR_COUNT - i;
        } else if (specSym === 'ud') {
          // 水平軸（i=N/4:右 / i=3N/4:左）で折り返し → 上下対称
          const shifted = (i + Math.round(BAR_COUNT / 4)) % BAR_COUNT;
          barIdx = shifted <= HALF_R ? shifted : BAR_COUNT - shifted;
        } else {
          barIdx = i;
        }
        barIdx = Math.min(barIdx, BAR_COUNT - 1);
        const v = sBars ? Math.min(1, sBars[barIdx] * amp) : 0;
        return rBase - v * (rBase - rMin_);
      };
      // 外円: 時計回り → 内部の巻き数 +1
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.closePath();
      // 内側波形: 角度を逆順に辿る（反時計回り → 内部の巻き数 -1）
      // → リング領域だけ巻き数 +1 (nonzero rule で塗り)
      const innerPts = [];
      for (let i = BAR_COUNT - 1; i >= 0; i--) {
        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
        innerPts.push({ x: cx + Math.cos(angle) * innerR(i), y: cy + Math.sin(angle) * innerR(i) });
      }
      const iN = innerPts.length;
      c.moveTo((innerPts[0].x + innerPts[iN - 1].x) / 2, (innerPts[0].y + innerPts[iN - 1].y) / 2);
      for (let i = 0; i < iN; i++) {
        const p1 = innerPts[i]; const p2 = innerPts[(i + 1) % iN];
        c.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      }
      c.closePath();
    } else { // radial
      const smooth  = elSpecSmooth ? parseFloat(elSpecSmooth.value) / 100 : 0;
      const sBars   = smooth > 0 && bars ? smoothBars(bars, smooth * BAR_COUNT * 1.5) : bars;
      const gapPct = elSpecGap ? parseInt(elSpecGap.value) : 0;
      const rMin = Math.min(m.w, m.h) * 0.18;
      const rMax = Math.min(m.w, m.h) * 0.50;
      if (specSym === 'lr') {
        // 左右対称スムース円形波（垂直軸で対称）
        const allPts = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          const v = sBars ? Math.min(1, sBars[i] * amp) : 0;
          const r = rMin + v * (rMax - rMin);
          const angle = Math.PI / 2 - (i / (BAR_COUNT - 1)) * Math.PI;
          allPts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        }
        for (let i = BAR_COUNT - 2; i >= 1; i--) {
          const v = sBars ? Math.min(1, sBars[i] * amp) : 0;
          const r = rMin + v * (rMax - rMin);
          const angle = Math.PI / 2 - (i / (BAR_COUNT - 1)) * Math.PI;
          allPts.push({ x: cx + Math.cos(Math.PI - angle) * r, y: cy + Math.sin(Math.PI - angle) * r });
        }
        const N = allPts.length;
        c.moveTo((allPts[0].x + allPts[N - 1].x) / 2, (allPts[0].y + allPts[N - 1].y) / 2);
        for (let i = 0; i < N; i++) {
          const p1 = allPts[i]; const p2 = allPts[(i + 1) % N];
          c.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        }
        c.closePath();
      } else if (specSym === 'ud') {
        // 上下対称スムース円形波（水平軸で対称）
        const HALF2 = BAR_COUNT;
        const allPts = [];
        // 上半円: 右(0) → 左(π)
        for (let i = 0; i <= HALF2; i++) {
          const v = sBars ? Math.min(1, sBars[Math.min(i, HALF2 - 1)] * amp) : 0;
          const r = rMin + v * (rMax - rMin);
          const angle = (i / HALF2) * Math.PI; // 0 → π
          allPts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        }
        // 下半円: 左(π) → 右(0)  ← 上の鏡像
        for (let i = HALF2 - 1; i >= 0; i--) {
          const v = sBars ? Math.min(1, sBars[Math.min(i, HALF2 - 1)] * amp) : 0;
          const r = rMin + v * (rMax - rMin);
          const angle = (i / HALF2) * Math.PI;
          allPts.push({ x: cx + Math.cos(angle) * r, y: cy - Math.sin(angle) * r }); // y を反転
        }
        const N = allPts.length;
        c.moveTo((allPts[0].x + allPts[N - 1].x) / 2, (allPts[0].y + allPts[N - 1].y) / 2);
        for (let i = 0; i < N; i++) {
          const p1 = allPts[i]; const p2 = allPts[(i + 1) % N];
          c.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        }
        c.closePath();
      } else if (gapPct > 0) {
        // spike（セグメント分割）
        const fullAngle = (Math.PI * 2) / BAR_COUNT;
        const barAngle  = fullAngle * Math.max(0.1, 1 - gapPct / 100);
        if (forStroke) {
          // スカイライン風連続パス
          const segs = Array.from({ length: BAR_COUNT }, (_, i) => {
            const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
            const a0 = angle - barAngle / 2;
            const a1 = angle + barAngle / 2;
            const v  = sBars ? Math.min(1, sBars[i] * amp) : 0;
            return { a0, a1, outerR: rMin + Math.max(0.04, v) * (rMax - rMin) };
          });
          c.moveTo(cx + Math.cos(segs[0].a0) * rMin, cy + Math.sin(segs[0].a0) * rMin);
          for (let i = 0; i < BAR_COUNT; i++) {
            const { a0, a1, outerR } = segs[i];
            const nextA0 = i + 1 < BAR_COUNT ? segs[i + 1].a0 : segs[0].a0 + Math.PI * 2;
            c.arc(cx, cy, outerR, a0, a1);
            c.arc(cx, cy, rMin,   a1, nextA0);
          }
          c.closePath();
        } else {
          // fill/clip: 内円 + セグメント群
          c.arc(cx, cy, rMin, 0, Math.PI * 2);
          c.closePath();
          for (let i = 0; i < BAR_COUNT; i++) {
            const v      = sBars ? Math.min(1, sBars[i] * amp) : 0;
            const outerR = rMin + Math.max(0.04, v) * (rMax - rMin);
            const angle  = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
            const a0 = angle - barAngle / 2;
            const a1 = angle + barAngle / 2;
            c.moveTo(cx + Math.cos(a0) * rMin, cy + Math.sin(a0) * rMin);
            c.arc(cx, cy, outerR, a0, a1);
            c.lineTo(cx + Math.cos(a1) * rMin, cy + Math.sin(a1) * rMin);
            c.arc(cx, cy, rMin, a1, a0, true);
            c.closePath();
          }
        }
      } else {
        // wave: スムースBlob
        const pts = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          const v     = sBars ? Math.min(1, sBars[i] * amp) : 0;
          const r     = rMin + v * (rMax - rMin);
          const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
          pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
        }
        const N = pts.length;
        c.moveTo((pts[0].x + pts[N - 1].x) / 2, (pts[0].y + pts[N - 1].y) / 2);
        for (let i = 0; i < N; i++) {
          const p1 = pts[i]; const p2 = pts[(i + 1) % N];
          c.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        }
        c.closePath();
      }
    }
    if (specRotate !== 0) c.restore();
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

// スマホカメラ録画風フレーム描画
let _shutterMorphT = 0;    // モーフ状態 (0=丸, 1=角丸四角)
let _shutterMorphLast = 0; // 前回の nowMs
let _glassSamplerCvs  = null; // 背景サンプリングキャッシュ（シャッター）
let _glassSamplerCtx  = null;
let _glassBlurCvs     = null; // blur済みキャッシュ（DOM外 → overlayCtxへのfilter設定を避ける）
let _glassBlurCtx     = null;

// 枠（メガネ・スマホのベゼル）の背面に重ねる「ぼかし + ティント」を、枠の形に切り抜いて destination-over で合成する。
// 4K 全面で行うとぼかし・パス塗りが毎フレーム 4K 分かかって重いため、枠の周辺だけの小さなキャンバスで処理する。
// ぼかしは低周波なので、強いときは縮小した上でかける（見た目の差はほぼ無い）。
let _bdCvs = null, _bdCtx = null;
function _drawFrameBackdrop(ctx, rect, shape, opacity, fb, ft, s) {
  const W = renderCvs.width, H = renderCvs.height;
  const sigma = fb * s;
  const pad = fb > 0 ? Math.ceil(sigma * 3) : 0;
  const x0 = Math.max(0, Math.floor(rect.x - 2 - pad)), y0 = Math.max(0, Math.floor(rect.y - 2 - pad));
  const x1 = Math.min(W, Math.ceil(rect.x + rect.w + 2 + pad)), y1 = Math.min(H, Math.ceil(rect.y + rect.h + 2 + pad));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  let k = fb > 0 ? (sigma >= 16 ? 0.25 : sigma >= 8 ? 0.5 : 1) : 1;
  k = Math.min(k, Math.sqrt(_BOX_MAX_PX / (bw * bh)));
  const sw = Math.max(1, Math.ceil(bw * k)), sh = Math.max(1, Math.ceil(bh * k));
  if (!_bdCvs) { _bdCvs = document.createElement('canvas'); _bdCtx = _bdCvs.getContext('2d'); }
  // 大きさの変化のたびに再確保しないよう、64px 単位で確保する
  const needW = Math.ceil(sw / 64) * 64, needH = Math.ceil(sh / 64) * 64;
  if (_bdCvs.width < sw || _bdCvs.height < sh || _bdCvs.width > needW * 2 || _bdCvs.height > needH * 2) {
    _bdCvs.width = needW; _bdCvs.height = needH;
  }
  const c = _bdCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.clearRect(0, 0, _bdCvs.width, _bdCvs.height);
  // 背景: 全体を縮小して左上を箱の位置に合わせて描く（部分指定の drawImage より速い）
  if (fb > 0) c.filter = `blur(${sigma * k}px)`;
  c.drawImage(renderCvs, -x0 * k, -y0 * k, W * k, H * k);
  c.filter = 'none';
  // 以降は 4K の絶対座標のまま描ける
  c.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  if (ft !== 0) {
    const animKey = elBorderAnim.value;
    const speed = parseFloat(elBorderAnimSpeed.value) * 0.1;
    const phase = (performance.now() * 0.001 * speed) % 1;
    c.globalAlpha = Math.abs(ft) / 100;
    c.fillStyle = ft > 0 ? _buildTintFill(c, { width: W, height: H }, animKey, phase) : '#000000';
    c.fillRect(x0, y0, bw, bh);
    c.globalAlpha = 1;
  }
  c.globalCompositeOperation = 'destination-in';
  c.fill(shape, 'evenodd');
  c.globalCompositeOperation = 'source-over';
  c.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.drawImage(_bdCvs, 0, 0, sw, sh, x0, y0, sw / k, sh / k);
  ctx.restore();
}

export function _drawGlassesFrame(ctx, m, bufScale, overrideColor = null) {
  const bw = parseFloat(elBorderW.value);
  const idx = (state.mask.glassesStyle || 0) % _GLASSES_STYLES.length;
  const g = _GLASSES_STYLES[idx];
  if (!_glassesPaths[idx]) {
    const frameStr = (g.full.match(/M[^M]*/g) || []).slice(2).join('');
    _glassesPaths[idx] = { lens: new Path2D(g.lens), full: new Path2D(g.full), frame: new Path2D(frameStr) };
  }
  const mat = _glassesMatrix(g, m);
  const pFull = new Path2D();
  pFull.addPath(_glassesPaths[idx].full, mat);
  const pFrame = new Path2D();
  pFrame.addPath(_glassesPaths[idx].frame, mat);
  const pLens = new Path2D();
  pLens.addPath(_glassesPaths[idx].lens, mat);

  const s  = bufScale || 1;
  const sw      = Math.max(1.5, 2.5 * s); // 外輪固定（スマホ本体と同一）
  const sw_lens = bw * 1.5 * s;           // 内枠: スライダー1 = 1.5バッファpx（外枠最小値と同等）

  const anim    = overrideColor ? 'none' : elBorderAnim.value;
  const speed   = parseFloat(elBorderAnimSpeed.value) * 0.1;
  const phase   = (performance.now() * 0.001 * speed) % 1;
  const bright  = parseInt(elBorderAnimBright.value, 10);
  const opacity = parseInt(elBorderOpacity.value, 10) / 100;
  const strokeStyle = anim !== 'none'
    ? _buildBorderGrad(ctx, m, phase, anim, bright)
    : (overrideColor || elBorderColor.value);

  // ① ストローク先描画
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur  = 4 * s;
  ctx.globalAlpha = opacity;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = sw;
  ctx.stroke(pFrame);              // 外枠（ブリッジ・ノーズパッド等）: 常時表示・固定太さ
  if (bw > 0) {
    ctx.lineWidth = sw_lens;
    ctx.stroke(pLens);             // 内枠（レンズ輪郭）: bw > 0 時のみ・スライダー連動
  }
  ctx.restore();

  // ② ブラー/ティントをストロークの背面に合成（destination-over）
  // overrideColor（borderInvert）時は差分合成が CSS 側で処理されるためスキップ
  if (!overrideColor) {
    const _fb = parseFloat(elFrameBlur.value);
    const _ft = parseInt(elFrameTint.value, 10);
    if (_fb > 0 || _ft !== 0) _drawFrameBackdrop(ctx, m, pFull, opacity, _fb, _ft, s);
  }
}

export function _drawPhoneFrame(ctx, m, bufScale, opacity, phase, overrideColor = null, skipOutline = false, outlineOnly = false, skipDot = false) {
  if (typeof ctx.roundRect !== 'function') return;
  const s = bufScale;

  // 選択色をRGBに展開
  const _bc     = overrideColor || elBorderColor.value;
  const _br     = parseInt(_bc.slice(1, 3), 16);
  const _bg     = parseInt(_bc.slice(3, 5), 16);
  const _bb     = parseInt(_bc.slice(5, 7), 16);

  // スマートフォン ディスプレイ比率: 9:19.5（縦）/ 横なら反転
  const IP17_W = 9, IP17_H = 19.5;
  const _land = state.phoneLandscape;
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

  // マージン: 縦向き=上下が広い、横向き=左右が広い
  const mShort = _land ? Math.round(scrH * 0.040) : Math.round(scrW * 0.040); // 短辺側マージン
  const mLong1 = _land ? Math.round(scrW * 0.048) : Math.round(scrH * 0.048); // 長辺・先頭側
  const mLong2 = _land ? Math.round(scrW * 0.038) : Math.round(scrH * 0.038); // 長辺・末尾側
  // 縦: bx=left, by=top(mTop), 横: bx=left(mLong1), by=top(mShort)
  const bx = _land ? scrX - mLong1 : scrX - mShort;
  const by = _land ? scrY - mShort  : scrY - mLong1;
  const bw = _land ? scrW + mLong1 + mLong2 : scrW + mShort * 2;
  const bh = _land ? scrH + mShort * 2       : scrH + mLong1 + mLong2;
  const bodyR = Math.round(Math.min(bw, bh) * 0.12);

  const sw   = Math.max(1.5, 2.5 * s);
  const btnW = Math.max(3, Math.round(4 * s));
  const btnR = Math.round(2 * s);

  // アニメON/OFF を確定してパーツ色を決定
  const _anim   = overrideColor ? 'none' : elBorderAnim.value;
  const _bright = parseInt(elBorderAnimBright.value, 10);
  const _animOn = _anim !== 'none';
  const _grad   = _animOn ? _buildBorderGrad(ctx, { x: bx, y: by, w: bw, h: bh }, phase, _anim, _bright) : null;
  // パーツ opacity: アニメON時はglobalAlphaで乗算、OFF時はrgbaに直接埋め込む
  const _dotA  = 0.85;
  const _btnA  = 0.70;
  const _homeA = 0.45;
  const colDot  = _animOn ? _grad : `rgba(${_br},${_bg},${_bb},${_dotA})`;
  const colBtn  = _animOn ? _grad : `rgba(${_br},${_bg},${_bb},${_btnA})`;
  const colHome = _animOn ? _grad : `rgba(${_br},${_bg},${_bb},${_homeA})`;

  ctx.save();
  ctx.globalAlpha = opacity;

  // --- 本体アウトライン（選択色 / アニメ対応） ---
  if (!skipOutline) {
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

  if (outlineOnly) {
    // アウトライン + ドットのみ（anchorCtx 向け）
    if (state.phoneShowDot) {
      const dotR = Math.max(2, Math.round(2.5 * s));
      ctx.save();
      if (_animOn) ctx.globalAlpha = opacity * _dotA;
      ctx.beginPath();
      const dotX2 = _land ? scrX + mLong1 * 0.44 : scrX + scrW / 2;
      const dotY2 = _land ? scrY + scrH / 2        : scrY + mLong1 * 0.44;
      ctx.arc(dotX2, dotY2, dotR, 0, Math.PI * 2);
      ctx.fillStyle = colDot;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore(); return;
  }

  // --- パンチホールカメラ ---
  if (state.phoneShowDot && !skipDot) {
    const dotR = Math.max(2, Math.round(2.5 * s));
    ctx.save();
    if (_animOn) ctx.globalAlpha = opacity * _dotA;
    ctx.beginPath();
    // 縦: ディスプレイ上辺中央、横: ディスプレイ左辺中央（どちらもディスプレイ内）
    const dotX = _land ? scrX + mLong1 * 0.44 : scrX + scrW / 2;
    const dotY = _land ? scrY + scrH / 2        : scrY + mLong1 * 0.44;
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = colDot;
    ctx.fill();
    ctx.restore();
  }

  // --- サイドボタン ---
  ctx.save();
  if (_animOn) ctx.globalAlpha = opacity * _btnA;
  ctx.fillStyle = colBtn;
  if (!_land) {
    // 縦向き: 左に3つ、右に1つ
    [[0.22, 0.055], [0.35, 0.085], [0.46, 0.085]].forEach(([yf, hf]) => {
      ctx.beginPath();
      ctx.roundRect(bx - btnW, by + bh * yf, btnW, bh * hf, btnR);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.roundRect(bx + bw, by + bh * 0.37, btnW, bh * 0.13, btnR);
    ctx.fill();
  } else {
    // 横向き (+90CW / ホーム右): 縦LEFT(音量3ボタン)→BOTTOM, 縦RIGHT(電源1ボタン)→TOP
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

  // --- ホームインジケーター（固定グレー＋シャドウ → 枠色に依存しない） ---
  {
    ctx.save();
    ctx.globalAlpha = opacity * (_animOn ? _homeA : 1.0);
    ctx.fillStyle = 'rgba(180,180,180,0.75)';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur  = Math.max(2, Math.round(3 * s));
    if (!_land) {
      const hiW = scrW * 0.26, hiH = Math.max(2.5, Math.round(3 * s));
      ctx.beginPath();
      ctx.roundRect(scrX + (scrW - hiW) / 2, scrY + scrH + (mLong2 - hiH) / 2, hiW, hiH, hiH / 2);
      ctx.fill();
    } else {
      const hiH = scrH * 0.26, hiW = Math.max(2.5, Math.round(3 * s));
      ctx.beginPath();
      ctx.roundRect(scrX + scrW + (mLong2 - hiW) / 2, scrY + (scrH - hiH) / 2, hiW, hiH, hiW / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- 三等分グリッド（Rule of Thirds） ---
  if (state.phoneShowRoT) {
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

  // --- モーフタイマー更新（カメラUI・シャッター・RECで共用） ---
  const nowMs = performance.now();
  const dtMs  = Math.min(50, _shutterMorphLast > 0 ? nowMs - _shutterMorphLast : 16);
  _shutterMorphLast = nowMs;
  _shutterMorphT += ((state.playing ? 1 : 0) - _shutterMorphT) * Math.min(1, (dtMs / 1000) * 7.0);
  const mt = _shutterMorphT;

  // --- シャッターボタン ---
  // 縦: 横中央・下寄り、横: 右寄り・縦中央（参考画像に小わせ）
  const sbCx = _land ? scrX + scrW * 0.855 : scrX + scrW / 2;
  const sbCy = _land ? scrY + scrH / 2      : scrY + scrH * 0.855;
  const sbR  = Math.max(8, Math.round((_land ? scrH : scrW) * 0.080));
  const sqSide  = Math.round(sbR * 1.15);
  const sqR_end = Math.max(2, Math.round(sqSide * 0.24));

  const glassR = sbR + Math.max(4, Math.round(4 * s));

  // --- 背景透過: ガウスブラー磨りガラス ---
  // getImageData(desynchronized canvas)はGPU Stall→動画ラグの原因。
  // drawImageで GPU間コピーのみ使用する。
  if (state.phoneShowRec) {
    const gx = Math.floor(sbCx - glassR);
    const gy = Math.floor(sbCy - glassR);
    const gd = Math.ceil(glassR * 2);
    // 箱レイヤーに描いている場合、キャンバスの原点・縮尺は本体キャンバスとずれている（_boxBegin 参照）
    const bx0 = ctx._bx || 0, by0 = ctx._by || 0, bk = ctx._bk || 1;
    const cW = bx0 + ctx.canvas.width / bk, cH = by0 + ctx.canvas.height / bk;
    const safeGx = Math.max(bx0, gx);
    const safeGy = Math.max(by0, gy);
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
        // GPU間コピー（CPU readbackなし）
        _glassSamplerCtx.drawImage(ctx.canvas, (safeGx - bx0) * bk, (safeGy - by0) * bk, safeW * bk, safeH * bk, 0, 0, safeW, safeH);
        // blur を DOM外Canvas で適用（overlayCtxへのfilter設定が強制スタイル再計算を引き起こすため）
        if (!_glassBlurCvs || _glassBlurCvs.width !== safeW || _glassBlurCvs.height !== safeH) {
          _glassBlurCvs = document.createElement('canvas');
          _glassBlurCvs.width  = safeW;
          _glassBlurCvs.height = safeH;
          _glassBlurCtx = _glassBlurCvs.getContext('2d');
        }
        const blurPx = Math.max(4, Math.round(glassR * 0.45));
        _glassBlurCtx.clearRect(0, 0, safeW, safeH);
        _glassBlurCtx.filter = `blur(${blurPx}px)`;
        _glassBlurCtx.drawImage(_glassSamplerCvs, 0, 0);
        _glassBlurCtx.filter = 'none';
        ctx.save();
        ctx.beginPath();
        ctx.arc(sbCx, sbCy, glassR, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(_glassBlurCvs, safeGx, safeGy);
        // 薄白膜（曇り感）
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fill();
        ctx.restore();
      } catch(e) {}
    }
  }

  // --- 録画インジケーター（赤丸→赤四角モーフ）＋タイムコード ---
  const pulse = 0.60 + 0.40 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
  if (state.phoneShowRec) {
    const iSide = sbR * 2 * (1 - mt) + sqSide * mt;
    const iCorR = sbR * (1 - mt) + sqR_end * mt;
    ctx.save();
    ctx.globalAlpha = opacity * pulse;
    ctx.fillStyle   = 'rgba(235,110,110,0.80)';
    ctx.beginPath();
    ctx.roundRect(sbCx - iSide / 2, sbCy - iSide / 2, iSide, iSide, iCorR);
    ctx.fill();
    ctx.restore();

    // --- タイムコード表示（mt > 0 のとき＝レコード四角化と同条件、mt でフェードイン） ---
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
      // 実際の字形の高さ（emスクエアでなく視覚的な高さ）でボックスを決定
      const textAsc  = metrics.actualBoundingBoxAscent  ?? fs * 0.75;
      const textDesc = metrics.actualBoundingBoxDescent ?? fs * 0.20;
      const textH = textAsc + textDesc;
      const boxW = tw + padW * 2;
      const boxH = textH + padH * 2;
      const tX   = scrX + Math.round((scrW - boxW) / 2);
      const tY   = scrY + Math.round(scrH * 0.045);
      const cX   = tX + boxW / 2;
      const cY   = tY + boxH / 2;

      // mt でスケール＋フェードイン（0.80→1.0）
      const tsScale = 0.80 + 0.20 * mt;
      ctx.translate(cX, cY);
      ctx.scale(tsScale, tsScale);
      ctx.translate(-cX, -cY);

      // 赤背景（レコード丸と同色・同 pulse）
      ctx.globalAlpha = opacity * pulse * mt;
      ctx.beginPath();
      ctx.roundRect(tX, tY, boxW, boxH, boxR);
      ctx.fillStyle = 'rgba(235,110,110,0.80)';
      ctx.fill();

      // テキスト：baseline を alphabet 基準にして視覚的中央へ配置
      ctx.globalAlpha = opacity * pulse * mt;
      ctx.fillStyle   = 'rgba(255,255,255,0.97)';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(timeStr, cX, tY + padH + textAsc);
      ctx.restore();
    } // end dur > 0
    } // end mt > 0.001
  } // end state.phoneShowRec

  ctx.restore();

  // --- ベゼル ブラー/ティントをすべての描画の背面に合成（destination-over） ---
  {
    const _fb = parseFloat(elFrameBlur.value);
    const _ft = parseInt(elFrameTint.value, 10);
    if (_fb > 0 || _ft !== 0) {
      const scrRb = Math.round(Math.min(scrW, scrH) * 0.11);
      const bezelPath = new Path2D();
      bezelPath.roundRect(bx, by, bw, bh, bodyR);
      bezelPath.roundRect(scrX, scrY, scrW, scrH, scrRb);
      _drawFrameBackdrop(ctx, { x: bx, y: by, w: bw, h: bh }, bezelPath, opacity, _fb, _ft, s);
    }
  }
}

_startRenderLoop();
