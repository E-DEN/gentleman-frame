// state.js — アプリケーション状態 + 定数

export const PRESET_KEY = 'gentleFrame_presets';
export let _presetsReady = false;
export function setPresetsReady(v) { _presetsReady = v; }
export const _ANIM_DEFAULTS = {
  cm:     ['#22d3ee','#f472b6'],
  sakura: ['#f472b6','#4ade80'],
  cyber:  ['#8325df','#3be30b'],
  fire:   ['#ef4444','#f97316'],
  pink:   ['#dcbcd2','#cd2377'],
};
export let _animColors = structuredClone(_ANIM_DEFAULTS);

// ドロップゾーンの loaded アニメーションを管理するヘルパー。
// カード開閉時のアニメーション再起動を防ぐため、終了後に inline で凍結する。
export function _setZoneLoaded(zone, isLoaded) {
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

// --- プリセット名ホバースライド計算 ---
export function _calcOverflows(item) {
  const actions = item.querySelector('.preset-item-actions');
  if (actions) {
    actions.style.setProperty('max-width', '80px', 'important');
    actions.style.setProperty('margin-left', '0', 'important');
  }
  item.querySelectorAll('.pname-inner').forEach(inner => {
    const outer = inner.parentElement;
    const overflow = inner.scrollWidth - outer.clientWidth;
    if (overflow > 2) {
      inner.classList.add('overflows');
      const fadeZone = outer.clientWidth * 0.03;
      inner.style.setProperty('--slide-dist', `-${overflow + fadeZone}px`);
    } else {
      inner.classList.remove('overflows');
      inner.style.removeProperty('--slide-dist');
    }
  });
  if (actions) {
    actions.style.removeProperty('max-width');
    actions.style.removeProperty('margin-left');
  }
}

// --- 状態（すべてのモジュール間可変状態を一元管理） ---
export const state = {
  playing: false,
  maskHovered: false,
  anchorHovered: false,
  maskTouched: false,
  mask: {
    x: 0,
    y: 0,
    w: 400,
    h: 400,
    shape: 'rect',
    glassesStyle: 0,
    specShape: 'bars',
    specSym:   'none',
    specRotate: 0,
    specGap: 15,
  },
  borderInvert: false,
  filterMaskOnly: {
    highlight:   false,
    shadow:      false,
    temp:        false,
    tint:        false,
    sharpness:   false,
    ca:          false,
    vignette:    false,
    matte:       false,
    grain:       false,
    bloom:       false,
    blur:        false,
    flare:       false,
    rain:        false,
    pencil:      false,
    emboss:      false,
    chalkboard:  false,
    nightvision: false,
    airbrush:    false,
  },
  arLock: false,
  zoomLock: false,           // マスクリサイズ時にズームを自動追従させる
  fgFixed: false,            // false = 紳士枠モード, true = アンカーモード
  drag: { active: false, mode: null, ox: 0, oy: 0, sm: null, sp: null },
  // スマホUI
  phoneLandscape: false,
  phoneShowRoT:   true,
  phoneShowRec:   true,
  phoneShowDot:   true,
  // フォロー・追従
  followMode:    'none',     // 'none' | 'mask' | 'anchor' | 'both'
  followTargetX: 0,
  followTargetY: 0,
  // レンダー lerp（render.js が更新）
  fgPinDispX: 0,
  fgPinDispY: 0,
  fgZoomDisp: 1,
  // ロック保存値
  zoomLockBeforeFgFixed: null,
  arLockBeforeAutoLock:  null,
};
