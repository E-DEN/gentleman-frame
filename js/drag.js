// drag.js — マスクドラッグ・リサイズ・ヒットテスト・追従モード

import { state } from './state.js';
import {
  canvas, canvasWrap,
  HANDLE_SZ, getHandles,
  elFgPinX, elFgPinY, elMaskZoom, elMaskW, elMaskH,
  _syncMaskSliders, _syncOffsetSliders, _syncZoomToMaskScale,
  _modalOpen, _updateZoomLockBtn, updateSliderFill,
  _dispH,
} from './canvas.js';
import { buildMaskPath } from './render.js';
import { syncPlay, syncPause } from './playback.js';

// --- マスクドラッグ + リサイズ（マウス + タッチ） ---

// canvas.getBoundingClientRect() のキャッシュ
// resize / fullscreenchange / 原寸切替 で無効化し、それ以外の mousemove では再取得しない。
// getBoundingClientRect() は CSS :hover 状態変化や classList 変更が pending なときに呼ぶと
// 強制レイアウトフラッシュになるため、mousemove から切り離す。
let _canvasRectCache = null;
let _canvasScaleX = 1, _canvasScaleY = 1; // Pointer Lock中の movementX/Y 変換用スケール
export function invalidateCanvasRect() { _canvasRectCache = null; }
window.addEventListener('resize', invalidateCanvasRect);
document.addEventListener('fullscreenchange', invalidateCanvasRect);
// canvas のサイズ変化（動画ロード後のアスペクト比変更等）でもキャッシュを破棄する
new ResizeObserver(invalidateCanvasRect).observe(canvas);

export function canvasCoords(e) {
  if (!_canvasRectCache) _canvasRectCache = canvas.getBoundingClientRect();
  const r  = _canvasRectCache;
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  _canvasScaleX = sx; // Pointer Lock 中の movementX/Y 変換用に最新値を保存
  _canvasScaleY = sy;
  const src = (e.touches && e.touches[0]) ? e.touches[0] : e;
  return {
    x: (src.clientX - r.left) * sx,
    y: (src.clientY - r.top)  * sy
  };
}

export function hitTestHandle(px, py) {
  const tol = state.mask.shape === 'heart' ? HANDLE_SZ + 8 : HANDLE_SZ + 3;
  for (const h of getHandles(state.mask)) {
    if (Math.abs(px - h.x) <= tol && Math.abs(py - h.y) <= tol) return h;
  }
  return null;
}

export function hitTestMask(px, py) {
  const { x, y, w, h, shape } = state.mask;
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
  if (shape === 'glasses') return px >= x && px <= x + w && py >= y && py <= y + h;
  if (shape === 'spectrum') return px >= x && px <= x + w && py >= y && py <= y + h;
  return false;
}

export function hitTestAnchor(px, py) {
  if (!state.fgFixed || state.mask.shape !== 'phone') return false;
  const scale = _dispH > 0 ? canvas.height / _dispH : 1;
  const ax  = canvas.width  / 2 + parseFloat(elFgPinX.value);
  const ay  = canvas.height / 2 + parseFloat(elFgPinY.value);
  const r = Math.max(18, Math.round(28 * scale));
  return Math.abs(px - ax) <= r && Math.abs(py - ay) <= r;
}

function _applyAnchorDrag(p) {
  const nx = Math.max(-1920, Math.min(1920, Math.round(state.drag.pinX0 + (p.x - state.drag.sp.x))));
  const ny = Math.max(-1080, Math.min(1080, Math.round(state.drag.pinY0 + (p.y - state.drag.sp.y))));
  elFgPinX.value = nx; elFgPinY.value = ny;
  document.getElementById('fgPinXVal').value = nx;
  document.getElementById('fgPinYVal').value = ny;
  updateSliderFill(elFgPinX); updateSliderFill(elFgPinY);
}

function _snapMaskSize(w, h) {
  if (state.mask.shape === 'phone') {
    const ar = state.phoneLandscape ? 780 / 360 : 360 / 780;
    const sw = Math.round(w / 2) * 2;
    const sh = Math.round(sw / ar / 2) * 2;
    return { w: sw, h: sh };
  }
  return { w: Math.round(w), h: Math.round(h) };
}

export function applyResize(hid, dx, dy, shiftKey) {
  const sm = state.drag.sm;
  let { x, y, w, h } = sm;
  const MIN = 10;
  const isCorner = hid === 'tl' || hid === 'tr' || hid === 'bl' || hid === 'br';
  const lockAr = state.arLock || (shiftKey && isCorner);
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
    } else {
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
  state.mask.x = Math.round(x); state.mask.y = Math.round(y); state.mask.w = snapped.w; state.mask.h = snapped.h;
  elMaskW.value = state.mask.w;
  document.getElementById('maskWVal').value = state.mask.w;
  elMaskH.value = state.mask.h;
  document.getElementById('maskHVal').value = state.mask.h;
  updateSliderFill(elMaskW);
  updateSliderFill(elMaskH);
}

export function startDrag(e, p) {
  if (hitTestAnchor(p.x, p.y)) {
    state.drag.active = true;
    state.drag.mode   = 'fg-anchor';
    state.drag.sp     = { x: p.x, y: p.y };
    state.drag.pinX0  = parseFloat(elFgPinX.value);
    state.drag.pinY0  = parseFloat(elFgPinY.value);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }
  const hh = hitTestHandle(p.x, p.y);
  if (hh) {
    state.drag.active = true;
    state.drag.mode   = hh.id;
    state.drag.sm     = { ...state.mask };
    state.drag.sp     = { x: p.x, y: p.y };
    canvas.style.cursor = hh.cur;
    e.preventDefault();
    return;
  }
  if (hitTestMask(p.x, p.y)) {
    state.drag.active = true;
    state.drag.mode   = 'move';
    state.drag.ox     = p.x - state.mask.x;
    state.drag.oy     = p.y - state.mask.y;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
}

let _canvasClickMoved = false;
canvas.addEventListener('mousedown', e => {
  if (e.button === 2) return;
  _canvasClickMoved = false;
  if (state.followMode !== 'none') return;
  startDrag(e, canvasCoords(e));
});
canvas.addEventListener('click', () => {
  if (_canvasClickMoved) return;
  if (state.followMode !== 'none') return; // 追従モード中は再生/停止しない
  if (state.playing) syncPause(); else syncPlay();
});

// --- マスク追従モード (右クリック) ---
export function _setFollowMode(mode) {
  const prevMode = state.followMode;
  state.followMode = mode;
  canvasWrap.classList.toggle('mask-follow', mode !== 'none');
  if (mode === 'anchor' && !state.zoomLock) {
    state.zoomLock = true;
    _updateZoomLockBtn();
  }
  // 追従モード終了時にスライダーを一度だけ同期（毎フレーム同期を避けるため）
  if (prevMode === 'mask' && mode === 'none') {
    _syncOffsetSliders();
  }
  // Pointer Lock: フルスクリーン中の mask モードで要求（Chrome Native UI 表示防止）
  if (mode === 'mask' && document.fullscreenElement) {
    canvas.requestPointerLock().catch(() => {});
  } else if (prevMode === 'mask' && document.pointerLockElement) {
    document.exitPointerLock();
  }
}

// Pointer Lock が Esc 等で意図せず解除された場合は追従モードを OFF にする
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state.followMode === 'mask') {
    _setFollowMode('none');
  }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault(); // OS コンテキストメニューを抑制するのみ
});

// 追従モードの ON/OFF は mousedown(button=2) で処理する。
// contextmenu イベントは Pointer Lock 中に Chrome が抑制するため使わない。
canvas.addEventListener('mousedown', e => {
  if (e.button !== 2) return;
  e.preventDefault();
  // Pointer Lock 中: 座標不定のため即解除
  if (document.pointerLockElement === canvas) {
    _setFollowMode('none');
    return;
  }
  const p = canvasCoords(e);
  state.followTargetX = p.x;
  state.followTargetY = p.y;
  if (state.fgFixed && hitTestAnchor(p.x, p.y)) {
    const next = state.followMode === 'anchor' ? 'none' : 'anchor';
    _setFollowMode(next);
  } else if (hitTestMask(p.x, p.y) || hitTestHandle(p.x, p.y)) {
    const next = state.followMode === 'mask' ? 'none' : 'mask';
    _setFollowMode(next);
  }
});

canvas.addEventListener('wheel', e => {
  if (state.followMode === 'none' && !state.maskHovered && !state.anchorHovered) return;
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
    const cx = state.mask.x + state.mask.w / 2;
    const cy = state.mask.y + state.mask.h / 2;
    const oldW = state.mask.w;
    const rawW = Math.max(20, state.mask.w + step);
    const rawH = state.mask.h > 0 ? Math.max(20, Math.round(rawW * state.mask.h / state.mask.w)) : rawW;
    const snapped = _snapMaskSize(rawW, rawH);
    _syncZoomToMaskScale(oldW, snapped.w);
    state.mask.w = snapped.w;
    state.mask.h = snapped.h;
    state.mask.x = Math.round(cx - snapped.w / 2);
    state.mask.y = Math.round(cy - snapped.h / 2);
    state.followTargetX = cx;
    state.followTargetY = cy;
    _syncMaskSliders();
  };

  if (state.followMode === 'anchor' || state.anchorHovered) {
    if (e.ctrlKey) doResize(); else doZoom();
  } else {
    if (e.ctrlKey) doZoom(); else doResize();
  }
}, { passive: false });

canvas.addEventListener('mouseleave', () => { state.maskHovered = false; state.anchorHovered = false; });

document.addEventListener('mousemove', e => {
  if (_modalOpen) return;

  // Pointer Lock 中（フルスクリーン mask 追従モード）: movementX/Y で仮想カーソル座標を蓄積
  if (document.pointerLockElement === canvas) {
    state.followTargetX += e.movementX * _canvasScaleX;
    state.followTargetY += e.movementY * _canvasScaleY;
    return;
  }

  // フルスクリーン上端100px ゾーン: ドラッグ中・追従中はスキップしない（枠を上端まで移動できるようにする）
  // ホバーのみの場合は getBoundingClientRect を呼ばないようにスキップ
  if (document.fullscreenElement && e.clientY < 100 && !state.drag.active && state.followMode === 'none') return;
  const p = canvasCoords(e);
  if (state.followMode !== 'none') {
    state.followTargetX = p.x;
    state.followTargetY = p.y;
    if (state.followMode === 'mask') {
      state.mask.x = Math.round(p.x - state.mask.w / 2);
      state.mask.y = Math.round(p.y - state.mask.h / 2);
      // _syncOffsetSliders は _renderFrame 内で rAF 毎に呼ばれるため、mousemove では省略
    }
    if (state.followMode === 'anchor' && state.fgFixed) {
      const nx = Math.max(-1920, Math.min(1920, Math.round(p.x - canvas.width  / 2)));
      const ny = Math.max(-1080, Math.min(1080, Math.round(p.y - canvas.height / 2)));
      elFgPinX.value = nx; elFgPinY.value = ny;
      document.getElementById('fgPinXVal').value = nx;
      document.getElementById('fgPinYVal').value = ny;
      updateSliderFill(elFgPinX); updateSliderFill(elFgPinY);
    }
    state.maskHovered = false;
    return;
  }
  if (!state.drag.active) {
    const hh       = hitTestHandle(p.x, p.y);
    const inMask   = hitTestMask(p.x, p.y);
    const inAnchor = hitTestAnchor(p.x, p.y);
    state.maskHovered = !!(hh || inMask);
    state.anchorHovered = !!inAnchor;
    const _cur = inAnchor ? 'grab' : (hh ? hh.cur : (inMask ? 'grab' : 'default'));
    if (canvas.style.cursor !== _cur) canvas.style.cursor = _cur;
    return;
  }
  _canvasClickMoved = true;
  if (state.drag.mode === 'fg-anchor') {
    _applyAnchorDrag(p);
  } else if (state.drag.mode === 'move') {
    state.mask.x = Math.round(p.x - state.drag.ox);
    state.mask.y = Math.round(p.y - state.drag.oy);
    // _syncOffsetSliders は _renderFrame 内で rAF 毎に呼ばれるため、mousemove では省略
  } else {
    applyResize(state.drag.mode, p.x - state.drag.sp.x, p.y - state.drag.sp.y, e.shiftKey);
  }
});

document.addEventListener('mouseup', () => {
  if (state.drag.active) {
    state.drag.active = false; state.drag.mode = null; canvas.style.cursor = 'default';
    _syncOffsetSliders();
  }
});

canvas.addEventListener('touchstart', e => {
  const p = canvasCoords(e);
  if (hitTestHandle(p.x, p.y) || hitTestMask(p.x, p.y)) {
    state.maskTouched = true;
  } else {
    state.maskTouched = false;
  }
  startDrag(e, p);
}, { passive: false });

document.addEventListener('touchmove', e => {
  if (!state.drag.active) return;
  const p = canvasCoords(e);
  if (state.drag.mode === 'fg-anchor') {
    _applyAnchorDrag(p);
  } else if (state.drag.mode === 'move') {
    state.mask.x = Math.round(p.x - state.drag.ox);
    state.mask.y = Math.round(p.y - state.drag.oy);
    _syncOffsetSliders();
  } else {
    applyResize(state.drag.mode, p.x - state.drag.sp.x, p.y - state.drag.sp.y);
  }
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchend', () => { state.drag.active = false; state.drag.mode = null; _syncOffsetSliders(); });
