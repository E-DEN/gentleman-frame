// media.js — メディア読み込み・ドロップゾーン管理

import { state, _setZoneLoaded } from './state.js';
import {
  canvas, canvasWrap, maskDropOverlay,
  vid, img, mediaType, loaded, visHidden, maskHidden,
  _vidBitmap, _startBitmapCapture, _stopBitmapCapture,
  _currentHandle, _loadedFileName, _loadedPageUrl, _loadedSrcUrl,
  _maskBorderFadeStart, _fgFadeStart,
  _IDB,
  setCanvasAspectRatio,
  _isDraggingPreset,
  syncMaskDropOverlay,
  setMaskBorderFadeStart, setFgFadeStart,
  _isMuted,
} from './canvas.js';
import { resetHintState, _startRainOverlay, elFilterRain } from './render.js';

// --- ファイル読み込み ---

// setCanvasAspectRatio のラッパー。
// rainOverlay（WebGL）は _syncAllBuffers の対象外のため、
// 解像度変更後に雨が有効なら再起動してサイズを同期する。
function _setAR(w, h) {
  setCanvasAspectRatio(w, h);
  if (parseInt(elFilterRain.value, 10) > 0) _startRainOverlay();
}

// proxy.js (yt-dlp) を使って Iwara ページURL → CDN URL を解決
// ローカル実行時はローカルプロキシ、本番（Pages）ではWorkerを自動選択
const _cfg = window.GF_CONFIG;
export const _MY_PROXY = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? _cfg.proxyLocal
  : _cfg.proxyProd;

export async function resolveIwaraURL(pageUrl) {
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

export async function loadVideoFromURL(index, url) {
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
          if (index === 0) _setAR(img[0].naturalWidth, img[0].naturalHeight);
          if (index === 1 && _maskBorderFadeStart === 0) setMaskBorderFadeStart(performance.now());
          if (index === 1 && _fgFadeStart === 0) setFgFadeStart(performance.now());
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
          img[index].crossOrigin = 'anonymous';
          img[index].onerror = _imgFail;
          img[index].src = proxyUrl;
        };
        // 既知のCORSブロックホストは最初からプロキシ経由
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

    // ── 動画URL ────────────────────────────────────────────
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
    // crossOrigin='anonymous' を設定してプロキシ経由で読み込む
    // → toBlob() でキャンバスが tainted にならないようにする
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
      if (index === 1 && _maskBorderFadeStart === 0) setMaskBorderFadeStart(performance.now());
      if (index === 1 && _fgFadeStart === 0) setFgFadeStart(performance.now());
      vid[index].volume = (parseFloat(document.getElementById(`vol${index}`).value) / 100) ** 2;
      if (index === 0) _setAR(vid[0].videoWidth, vid[0].videoHeight);
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

export function loadVideo(index, file, handle = null) {
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
  vid[index].removeAttribute('crossorigin');
  vid[index].src = url;
  vid[index].load();
  vid[index].onloadedmetadata = () => {
    loaded[index] = true;
    _stopBitmapCapture(index);
    _startBitmapCapture(index);
    zone.classList.remove('loading');
    _setDropSpinner(index, false);
    if (index === 0 && _maskBorderFadeStart === 0) setMaskBorderFadeStart(performance.now());
    if (index === 1 && _maskBorderFadeStart === 0) setMaskBorderFadeStart(performance.now());
    if (index === 1 && _fgFadeStart === 0) setFgFadeStart(performance.now());
    resetHintState(); // ヒント状態を強制再評価
    vid[index].volume = (parseFloat(document.getElementById(`vol${index}`).value) / 100) ** 2;
    // index 0（背景）がロードされたらアスペクト比を更新
    if (index === 0) {
      _setAR(vid[0].videoWidth, vid[0].videoHeight);
    }
    _setZoneLoaded(zone, false);
    _setZoneLoaded(zone, true);
    const label = zone.querySelector(`.drop-label${index}`);
    if (label) label.textContent = file.name;
  };
  vid[index].onerror = () => { zone.classList.remove('loading'); _setDropSpinner(index, false); };
}

export function loadImage(index, file, handle = null) {
  vid[index].pause();
  _stopBitmapCapture(index);
  if (vid[index].src) { URL.revokeObjectURL(vid[index].src); vid[index].removeAttribute('src'); vid[index].load(); }
  if (img[index].src?.startsWith('blob:')) URL.revokeObjectURL(img[index].src);
  // ロード完了前に旧ビデオ状態が残らないよう即座にリセット
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
    // mediaType[index] = 'image' はロード開始時に設定済み
    zone.classList.remove('loading');
    _setDropSpinner(index, false);
    if (index === 0) { _setAR(img[0].naturalWidth, img[0].naturalHeight); if (_maskBorderFadeStart === 0) setMaskBorderFadeStart(performance.now()); }
    if (index === 1 && _maskBorderFadeStart === 0) setMaskBorderFadeStart(performance.now());
    if (index === 1 && _fgFadeStart === 0) setFgFadeStart(performance.now());
    resetHintState(); // ヒント状態を強制再評価
    _setZoneLoaded(zone, false);
    _setZoneLoaded(zone, true);
    const label = zone.querySelector(`.drop-label${index}`);
    if (label) label.textContent = file.name;
  };
  img[index].onerror = () => { zone.classList.remove('loading'); _setDropSpinner(index, false); };
  img[index].src = url;
}

export function updateMediaControls(index) {
  const ctrl = document.getElementById(`videoControls${index}`);
  if (ctrl) ctrl.style.display = mediaType[index] === 'image' ? 'none' : '';
}

function _setDropSpinner(index, on) {
  const overlay = document.querySelector(`#drop${index} .drop-loading-overlay`);
  if (!overlay) return;
  overlay.style.display = on ? 'flex' : 'none';
}

export function _updateDropLink(index) {
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

export async function loadVideoFromHandle(index, handle) {
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
  const section = zone.closest('.vid-section'); // カード全体
  const input   = document.getElementById(`file${index}`);

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

  // --- D&D: vid-section カード全体 ---
  // section レベルで統括。zone のイベントはバブリングさせて section に集約する。
  // zone.drop のみ stopPropagation を維持（section.drop との二重処理防止）。

  // 動画・画像ファイルのドラッグかどうかを判定（JSON等のテキストドロップは除外）
  // dragenter/dragover 中はブラウザがセキュリティ上 MIME type を公開しない場合があるため
  // items の type ではなく types に 'Files' が含まれるかで判定する
  const _isMediaDrag = e => !!(e.dataTransfer?.types?.includes('Files'));

  let _dragCount = 0;
  zone.addEventListener('dragenter', e => {
    if (!_isMediaDrag(e)) return;
    e.preventDefault();
    _dragCount++;
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragover', e => {
    if (!_isMediaDrag(e)) return;
    e.preventDefault();
  });
  zone.addEventListener('dragleave', e => {
    if (_dragCount > 0) {
      _dragCount--;
      if (_dragCount <= 0) { _dragCount = 0; zone.classList.remove('drag-over'); }
    }
    // stopPropagation しない → section.dragleave にバブリングさせる
  });
  zone.addEventListener('drop', async e => {
    if (!_isMediaDrag(e)) return; // JSONは無視（section.drop にもバブリングしない → OK）
    e.preventDefault();
    e.stopPropagation(); // section.drop との二重処理を防ぐ
    _dragCount = 0;
    zone.classList.remove('drag-over');
    const item = e.dataTransfer.items?.[0];
    const f = e.dataTransfer.files[0]; // awaitより前に同期取得
    let handle = null;
    if (item?.getAsFileSystemHandle) {
      handle = await item.getAsFileSystemHandle().catch(() => null);
    }
    if (f) _loadFileByType(index, f, handle);
  });

  if (section) {
    section.addEventListener('dragenter', e => {
      if (!_isMediaDrag(e)) return;
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    section.addEventListener('dragover', e => {
      if (!_isMediaDrag(e)) return;
      e.preventDefault(); // 動画・画像のみドロップを許可
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
      // zone.drop が stopPropagation 済みのためここには zone 上のドロップは来ない
      zone.classList.remove('drag-over');
      const item = e.dataTransfer.items?.[0];
      const f = e.dataTransfer.files[0];
      let handle = null;
      if (item?.getAsFileSystemHandle) {
        handle = await item.getAsFileSystemHandle().catch(() => null);
      }
      if (f) _loadFileByType(index, f, handle);
    });
  }
}

[0, 1].forEach(setupDropZone);

// --- 動画コントロールリセット ---
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

// --- 動画表示切り替え ---
const _vidHiddenOverlay = document.getElementById('vidHiddenOverlay');
export function _syncVidHiddenOverlay() {
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
    // 非表示→ミュート、再表示→ミュート解除
    const muteBtn = document.getElementById(`mute${i}`);
    if (visHidden[i] && !_isMuted[i]) {
      muteBtn.click();
    } else if (!visHidden[i] && _isMuted[i]) {
      muteBtn.click();
    }
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
      // 非表示→ミュート、再表示→ミュート解除
      const muteBtn = document.getElementById(`mute${i}`);
      if (next && !_isMuted[i]) {
        muteBtn.click();
      } else if (!next && _isMuted[i]) {
        muteBtn.click();
      }
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

// --- 動画削除 ---
export const DEFAULT_LABELS = () => [t('drop-label'), t('drop-label')];

export function clearVideo(index) {
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

// dropファイル処理: DataTransferはawait前に同期取得必須
export const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|ogv|ts)$/i;
export const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|avif|bmp|tiff?)$/i;

export function _loadFileByType(index, file, handle = null) {
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) loadImage(index, file, handle);
  else loadVideo(index, file, handle);
}

export async function processDropFiles(e, targetIdx) {
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

// --- キャンバスエリアへのドラッグ&ドロップ ---
// canvasWrap: 動画・画像のみ受け付ける（背景=0 へロード）
// maskDropOverlay: マスク領域が本物のD&Dターゲット（前景=1 へロード）
const _isFileDrag = e => !!(e.dataTransfer?.types?.includes('Files'));

canvasWrap.addEventListener('dragover', e => {
  if (_isDraggingPreset || !_isFileDrag(e)) return;
  e.preventDefault();
  canvasWrap.classList.add('canvas-drop-over');
  maskDropOverlay.classList.add('drag-active');
  syncMaskDropOverlay();
});
canvasWrap.addEventListener('dragleave', e => {
  if (!canvasWrap.contains(e.relatedTarget)) {
    canvasWrap.classList.remove('canvas-drop-over');
    maskDropOverlay.classList.remove('drag-active', 'drag-over');
  }
});
canvasWrap.addEventListener('drop', async e => {
  if (_isDraggingPreset || !_isFileDrag(e)) return;
  if (e.target === maskDropOverlay) return; // マスク上のdropはoverlayが処理
  e.preventDefault();
  await processDropFiles(e, 0);
});

// maskDropOverlay: マスク領域が本物のD&Dターゲット（前景=1 へロード）
maskDropOverlay.addEventListener('dragover', e => {
  if (_isDraggingPreset || !_isFileDrag(e)) return;
  e.preventDefault();
  maskDropOverlay.classList.add('drag-over');
  canvasWrap.classList.add('canvas-drop-over');
});
maskDropOverlay.addEventListener('dragleave', () => {
  maskDropOverlay.classList.remove('drag-over');
});
maskDropOverlay.addEventListener('drop', async e => {
  if (_isDraggingPreset || !_isFileDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  await processDropFiles(e, 1);
});
