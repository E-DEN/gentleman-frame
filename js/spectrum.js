// spectrum.js — Web Audio API スペクトラム解析

let _audioCtx  = null;
let _analyser  = null;
let _dataArray = null;

const FFT_SIZE = 2048; // 1024 bins

/**
 * vid[0] / vid[1] を AudioContext に接続する。
 * シェイプ選択時（ユーザジェスチャあり）に呼ぶこと。
 */
export function connectAudioElements(v0, v1) {
  if (!_audioCtx) {
    _audioCtx = new AudioContext();
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize             = FFT_SIZE;
    _analyser.smoothingTimeConstant = 0.82;
    _analyser.minDecibels         = -90;
    _analyser.maxDecibels         = -10;
    _dataArray = new Uint8Array(_analyser.frequencyBinCount);
    _analyser.connect(_audioCtx.destination);
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  [v0, v1].forEach(v => {
    if (!v || v._specConnected) return;
    try {
      _audioCtx.createMediaElementSource(v).connect(_analyser);
      v._specConnected = true;
    } catch (_) {}
  });
}

/**
 * 現在のフレームの周波数データを count 本のバー値（0〜1）として返す。
 * AudioContext が未初期化なら null を返す。
 */
export function getSpectrumBars(count) {
  if (!_analyser) return null;
  _analyser.getByteFrequencyData(_dataArray);
  const bins   = _dataArray.length;
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // 対数スケールマッピング（低音域を広く、高音域を狭く）
    const t0 = i / count;
    const t1 = (i + 1) / count;
    const s  = Math.floor(Math.pow(bins, t0));
    const e  = Math.max(s + 1, Math.floor(Math.pow(bins, t1)));
    let sum = 0, n = 0;
    for (let j = s; j < Math.min(e, bins); j++) { sum += _dataArray[j]; n++; }
    result[i] = n > 0 ? sum / n / 255 : 0;
  }
  return result;
}
