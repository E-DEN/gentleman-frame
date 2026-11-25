// perf-hud.js — 診断表示（URL に ?perf=1 を付けたときだけ動く）
//
// カクつきが「描画の重さ」か「動画のデコード落ち」かを、実機の画面上で見分けるための表示。
// 1 秒ごとに、画面更新の回数・実際に描き直した回数・フレーム間隔の最大値・動画のコマ落ちを集計する。

export const perfOn = new URLSearchParams(location.search).has('perf');

let _el = null;
let _last = 0;
let _t0 = 0;
let _win = null;
let _total = { long: 0, dropped: 0 };
let _prevDropped = null;

function _reset() { _win = { raf: 0, paint: 0, idle: 0, throttle: 0, maxGap: 0, long: 0 }; }

/**
 * 画面更新（rAF）ごとに 1 回呼ぶ。
 * @param {number} now rAF のタイムスタンプ
 * @param {'paint'|'idle'|'throttle'} kind この回に全面を描き直したか、スキップ（変化なし / 間引き）したか
 * @param {{dropped: () => number, load: () => number, size: () => string, path: () => string}} info
 */
export function perfFrame(now, kind, info) {
  if (!perfOn) return;
  if (!_el) {
    _el = document.createElement('pre');
    _el.style.cssText = 'position:fixed;top:4px;left:4px;z-index:99999;margin:0;padding:6px 8px;font:11px/1.35 Consolas,monospace;'
      + 'color:#7CFC8A;background:rgba(0,0,0,0.78);border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(_el);
    _reset();
  }
  if (_last) {
    const gap = now - _last;
    if (gap > _win.maxGap) _win.maxGap = gap;
    if (gap > 25) { _win.long++; _total.long++; }
  }
  _last = now;
  _win.raf++;
  _win[kind]++;
  if (!_t0) _t0 = now;
  if (now - _t0 < 1000) return;
  const sec = (now - _t0) / 1000;
  const dropped = info.dropped();
  if (_prevDropped === null) _prevDropped = dropped;
  const dDrop = dropped - _prevDropped;
  _prevDropped = dropped;
  _total.dropped += dDrop;
  const load = info.load();
  _el.textContent =
    `GF perf  フィルター: ${load > 0 ? info.path() : '無し'} (負荷 ${load})  ${info.size()}\n`
    + `画面更新 ${(_win.raf / sec).toFixed(0)}/s   描き直し ${(_win.paint / sec).toFixed(0)}/s   `
    + `スキップ 変化なし ${_win.idle} / 間引き ${_win.throttle}\n`
    + `フレーム間隔 最大 ${_win.maxGap.toFixed(0)}ms   25ms超 ${_win.long} 回 (累計 ${_total.long})\n`
    + `動画コマ落ち ${dDrop} /s (累計 ${_total.dropped})`;
  _t0 = now;
  _reset();
}
