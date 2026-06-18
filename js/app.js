// app.js — エントリーポイント (ES Module)
import { state } from './state.js';
import { canvas, loaded, mediaType, vid, _vidBitmap, _compositeT,
         overlayCanvas, effectsHidden,
         elFilterBrightness, elFilterContrast, elFilterSaturation, elFilterHue, elFilterBars } from './canvas.js';
import { _applyCompositeT } from './playback.js';
// 以下のモジュールはインポート時にトップレベル初期化コードを実行する
import { rainOverlay } from './render.js';
import './controls.js';
import './media.js';
import './presets.js';
import './sortable.js';

// --- シアターモード & 全画面 ---
const appBody    = document.querySelector('.app-body');
const panel      = document.querySelector('.panel');
const theaterBtn = document.getElementById('theaterBtn');
const fsBtn      = document.getElementById('fullscreenBtn');

// --- リシンク ---
document.getElementById('resyncBtn').addEventListener('click', async () => {
  await _applyCompositeT(_compositeT);
  // drawImage(video) 直接参照のため rAF ループが次フレームで自動的に最新フレームを描画する。
  // 別途ビットマップ更新は不要。
});

// --- スクリーンショット保存 ---
document.getElementById('screenshotBtn').addEventListener('click', () => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `gentleman-frame_${ts}.png`;

  // 全レイヤーを合成: mainCanvas（canvas エフェクト済）+ 雨 + スマホ/メガネ枠
  const shot  = document.createElement('canvas');
  shot.width  = canvas.width;
  shot.height = canvas.height;
  const sCtx  = shot.getContext('2d');

  // effectsWrap の CSS フィルター（brightness/contrast/saturation/hue）を 2D context で再現
  if (!effectsHidden) {
    const b  = parseFloat(elFilterBrightness.value);
    const co = parseFloat(elFilterContrast.value);
    const s  = parseFloat(elFilterSaturation.value);
    const h  = parseFloat(elFilterHue.value);
    if (b !== 100 || co !== 100 || s !== 100 || h !== 0) {
      sCtx.filter = `brightness(${b}%) contrast(${co}%) saturate(${s}%) hue-rotate(${h}deg)`;
    }
  }
  sCtx.drawImage(canvas, 0, 0);       // mainCanvas（映像＋blur/vignette 等の canvas エフェクト）
  sCtx.drawImage(rainOverlay, 0, 0);  // 雨ガラスオーバーレイ（WebGL）
  sCtx.filter = 'none';

  // シネマバー（barsOverlay の CSS background をキャンバスで再現）
  if (!effectsHidden) {
    const barsAmt = parseFloat(elFilterBars.value);
    if (barsAmt > 0) {
      const pct  = (barsAmt / 10) * 18;
      const barH = Math.round(shot.height * pct / 100);
      sCtx.fillStyle = '#000';
      sCtx.fillRect(0, 0, shot.width, barH);
      sCtx.fillRect(0, shot.height - barH, shot.width, barH);
    }
  }

  // overlayCanvas（スマホ枠・メガネ枠・マスクボーダー）CSS filter 対象外
  sCtx.drawImage(overlayCanvas, 0, 0);

  shot.toBlob(blob => {
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

// --- 原寸表示 ---
const actualSizeBtn = document.getElementById('actualSizeBtn');
const canvasWrap    = document.getElementById('canvasWrap');

const videoArea  = document.getElementById('videoArea');
const mainCanvas = document.getElementById('mainCanvas');

function setActualSize(enable) {
  const isFs = !!document.fullscreenElement;
  if (isFs) {
    // フルスクリーン時: mainCanvas / videoArea に直接サイズを指定
    if (enable) {
      mainCanvas.style.setProperty('width',  `${canvas.width}px`,  'important');
      mainCanvas.style.setProperty('height', `${canvas.height}px`, 'important');
      videoArea.style.width = `${canvas.width}px`;
    } else {
      mainCanvas.style.removeProperty('width');
      mainCanvas.style.removeProperty('height');
      videoArea.style.width = '';
    }
  } else {
    if (enable) {
      canvasWrap.style.setProperty('--canvas-w', `${canvas.width}px`);
    }
    canvasWrap.classList.toggle('actual-size', enable);
  }
  actualSizeBtn.innerHTML = enable
    ? '<i data-lucide="scan-search"></i>'
    : '<i data-lucide="scan"></i>';
  actualSizeBtn.title = t(enable ? 'actual-size-close' : 'actual-size-open');
  lucide.createIcons();
}

actualSizeBtn.addEventListener('click', () => {
  const isFs = !!document.fullscreenElement;
  const isActive = isFs
    ? !!mainCanvas.style.getPropertyValue('width')
    : canvasWrap.classList.contains('actual-size');
  setActualSize(!isActive);
});

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
  if (_fsIsIdle === idle) return;
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
  if (e.clientY < 100) return;
  _resetFsIdle();
});
_fsWrap.addEventListener('mousedown', _resetFsIdle);

// フルスクリーン時、表示サイズがすでに原寸と同じなら原寸ボタンを隠す
function _updateActualSizeBtnVisibility() {
  if (!document.fullscreenElement) return;
  const displayed = Math.round(mainCanvas.getBoundingClientRect().width);
  actualSizeBtn.style.display = (displayed === canvas.width) ? 'none' : '';
}

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  fsBtn.innerHTML = isFs ? '<i data-lucide="minimize"></i>' : '<i data-lucide="maximize"></i>';
  fsBtn.title = t(isFs ? 'fs-close' : 'fs-open');
  theaterBtn.style.display = isFs ? 'none' : '';
  if (!isFs) {
    // フルスクリーン解除: フルスクリーン原寸をリセット
    mainCanvas.style.removeProperty('width');
    mainCanvas.style.removeProperty('height');
    videoArea.style.width = '';
    actualSizeBtn.style.display = '';
    setTheater(_wasTheaterBeforeFs);
    clearTimeout(_fsIdleTimer);
    _setFsIdle(false);
  } else {
    // requestAnimationFrame でレイアウト確定後に判定
    requestAnimationFrame(_updateActualSizeBtnVisibility);
    _resetFsIdle();
  }
  lucide.createIcons();
});

window.addEventListener('resize', _updateActualSizeBtnVisibility);

document.getElementById('canvasWrap').addEventListener('dblclick', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    _wasTheaterBeforeFs = appBody.classList.contains('theater');
    const target = document.getElementById('canvasWrap');
    (target.requestFullscreen || target.webkitRequestFullscreen || (() => {})).call(target).catch(() => {});
  }
});

// --- Card collapse (カード折りたたみ) ---
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
      // カードを閉じる時に loaded ゾーンのアニメーションを凍結する
      if (isCollapsed) {
        card.querySelectorAll('.drop-zone.loaded').forEach(z => {
          z.style.animation = 'none';
        });
      }
      const s = getSaved();
      if (isCollapsed) s[id] = true; else delete s[id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    });
  });
})();

lucide.createIcons();

// --- ブラウザのデフォルトファイルオープン防止 ---
// ドロップゾーン外にファイルをドロップしたときブラウザがファイルを
// 開いてしまわないよう、document レベルで dragover/drop を抑制する。
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop',     e => e.preventDefault());
