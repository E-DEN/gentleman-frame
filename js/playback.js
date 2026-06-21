// playback.js — 再生・ポーズ・シーク

import { state } from './state.js';
import {
  vid, mediaType, loaded,
  _compositeT, _playDelayTimers,
  setCompositeT, setCompositeLastRaf, setCompositeSeekPending,
  _scheduleResync, _cancelResync,
  elPlayBtn,
  _getOffsets,
} from './canvas.js';

// --- 再生 ---
const _playFlashIcon = document.getElementById('playFlashIcon');
function _showPlayFlash(playing) {
  _playFlashIcon.classList.remove('flash');
  void _playFlashIcon.offsetWidth;
  _playFlashIcon.innerHTML = playing
    ? '<svg viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="white"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';
  _playFlashIcon.classList.add('flash');
}

export function setPlaying(playing) {
  state.playing = playing;
  elPlayBtn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i>`;
  lucide.createIcons();
}

export async function _applyCompositeT(T) {
  _playDelayTimers.forEach(t => clearTimeout(t));
  _playDelayTimers.length = 0;
  setCompositeLastRaf(null);
  setCompositeSeekPending(true);

  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].pause(); });

  const [o1, o2] = _getOffsets();
  const offsets = [o1, o2];

  // Phase 1: fastSeek — 最近傍キーフレームへ素早く移動（デコード開始コストを下げる）
  await Promise.all([0, 1].map(i => {
    if (!loaded[i] || mediaType[i] !== 'video' || !vid[i].duration) return Promise.resolve();
    const vt = Math.max(0, Math.min(vid[i].duration, T + offsets[i]));
    if (Math.abs(vid[i].currentTime - vt) < 0.003) return Promise.resolve();
    return new Promise(res => {
      vid[i].addEventListener('seeked', res, { once: true });
      typeof vid[i].fastSeek === 'function' ? vid[i].fastSeek(vt) : (vid[i].currentTime = vt);
    });
  }));

  // Phase 2: vid[0] の実際の着地位置を基準に vid[1] を正確同期
  const hasPrimary   = loaded[0] && mediaType[0] === 'video' && !!vid[0].duration;
  const hasSecondary = loaded[1] && mediaType[1] === 'video' && !!vid[1].duration;
  if (hasPrimary && hasSecondary) {
    const actualT = vid[0].currentTime - o1;
    const target1 = Math.max(0, Math.min(vid[1].duration, actualT + o2));
    if (Math.abs(vid[1].currentTime - target1) >= 0.003) {
      await new Promise(res => {
        vid[1].addEventListener('seeked', res, { once: true });
        vid[1].currentTime = target1;
      });
    }
  }

  setCompositeSeekPending(false);
  if (!state.playing) return;

  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].playbackRate = 1.0; });

  // 再生開始（実際の着地位置を基準にディレイを計算）
  const actualT = hasPrimary ? vid[0].currentTime - o1 : hasSecondary ? vid[1].currentTime - o2 : T;
  [o1, o2].forEach((o, i) => {
    if (!loaded[i] || mediaType[i] !== 'video') return;
    if (actualT + o < 0) {
      const t = setTimeout(() => { if (state.playing && loaded[i]) vid[i].play().catch(() => {}); }, -(actualT + o) * 1000);
      _playDelayTimers.push(t);
    } else {
      vid[i].play().catch(() => {});
    }
  });
  if (hasPrimary && hasSecondary) {
    _scheduleResync(80);
  }
}

export async function syncPlay() {
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
    _cancelResync();
    _playDelayTimers.forEach(t => clearTimeout(t));
    _playDelayTimers.length = 0;
    setCompositeLastRaf(null);
    setCompositeSeekPending(false);
    [0, 1].forEach(i => { if (loaded[i] && mediaType[i] === 'video') vid[i].playbackRate = 1.0; });
    [0, 1].forEach(i => {
      if (!loaded[i] || mediaType[i] !== 'video') return;
      const o = i === 0 ? o1 : o2;
      if (_compositeT + o < 0) {
        const t = setTimeout(() => { if (state.playing && loaded[i]) vid[i].play().catch(() => {}); }, -(_compositeT + o) * 1000);
        _playDelayTimers.push(t);
      } else {
        vid[i].play().catch(() => {});
      }
    });
    if (loaded[0] && loaded[1] && mediaType[0] === 'video' && mediaType[1] === 'video') {
      _scheduleResync(30);
    }
  } else {
    await _applyCompositeT(_compositeT);
  }
}

export function syncPause() {
  _cancelResync();
  _playDelayTimers.forEach(t => clearTimeout(t));
  _playDelayTimers.length = 0;
  setCompositeLastRaf(null);
  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].pause(); });
  setPlaying(false);
  _showPlayFlash(false);
}

export function syncStop() {
  _cancelResync();
  _playDelayTimers.forEach(t => clearTimeout(t));
  _playDelayTimers.length = 0;
  setCompositeLastRaf(null);
  setCompositeT(0);
  [0, 1].forEach(i => { if (mediaType[i] === 'video') { vid[i].pause(); vid[i].currentTime = 0; } });
  setPlaying(false);
}
