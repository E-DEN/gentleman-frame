// ============================================================
//  app.js — エントリーポイント (ES Module)
// ============================================================
import { state } from './state.js';
import { canvas, loaded, mediaType, vid, _vidBitmap, _compositeT } from './canvas.js';
import { _applyCompositeT } from './controls.js';
// 以下のモジュールはインポート時にトップレベル初期化コードを実行する
import './render.js';
import './media.js';
import './presets.js';
import './dnd.js';

// ============================================================
//  シアターモード & 全画面
// ============================================================
const appBody    = document.querySelector('.app-body');
const panel      = document.querySelector('.panel');
const theaterBtn = document.getElementById('theaterBtn');
const fsBtn      = document.getElementById('fullscreenBtn');

// ---- リシンク ----
document.getElementById('resyncBtn').addEventListener('click', async () => {
  await _applyCompositeT(_compositeT);
  // 一時停止中は requestVideoFrameCallback が起動しないことがあるため、
  // シーク完了後に createImageBitmap で _vidBitmap を強制リフレッシュしてキャンバスに即反映
  if (!state.playing && 'createImageBitmap' in window) {
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

// ---- スクリーンショット保存 ----
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