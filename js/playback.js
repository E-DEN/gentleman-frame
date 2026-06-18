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

  setCompositeSeekPending(false);
  if (!state.playing) return;

  [0, 1].forEach(i => { if (mediaType[i] === 'video') vid[i].playbackRate = 1.0; });
  [o1, o2].forEach((o, i) => {
    if (!loaded[i] || mediaType[i] !== 'video') return;
    if (T + o < 0) {
      const t = setTimeout(() => { if (state.playing && loaded[i]) vid[i].play().catch(() => {}); }, -(T + o) * 1000);
      _playDelayTimers.push(t);
    } else {
      vid[i].play().catch(() => {});
    }
  });
  if (loaded[0] && loaded[1] && mediaType[0] === 'video' && mediaType[1] === 'video') {
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
