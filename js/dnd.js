// dnd.js — プリセットスムーズ並び替え（ゴースト要素方式）

import { _activePresetIdx, _f2Target, setIsDraggingPreset, setActivePresetIdx, setF2Target } from './canvas.js';
import { loadPresets, savePresets, renderPresets } from './presets.js';

// ============================================================
//  プリセット スムーズ並び替え — ゴースト要素方式
//  コンテナベース: ゴーストがどのフォルダ内にあるかを毎フレーム検出。
//  エスケープ/モード追跡ではなく、エリア検出で制御。
//  対応: どこからでもドラッグ、z-index、フォルダ離脱、
//           外部からフォルダアイテム間への挿入、クリック閾値。
// ============================================================
let _mDragSrcIdx     = null;
let _mDraggedEl      = null;   // 元要素 = 非表示のプレースホルダー
let _mGhost          = null;   // fixed-position の浮遊クローン
let _mPointerOffsetY = 0;
let _mDraggedH       = 0;
let _mDragGap        = 2;
let _mActiveSiblings = [];     // 現在スライド中の兄弟要素
let _mCurContainer   = null;   // null=ルート、または .preset-folder DOM 要素
let _mFolderTarget   = null;   // 末尾ドロップ用の閉じたフォルダヘッダー
let _mLastGhostMidY  = 0;
let _mContainerFollowers = []; // ゴーストが外部からフォルダ内にいるときの _mCurContainer 以降のルート要素
let _mSrcOrigMidY    = 0;      // ドラッグ開始時のドラッグ元要素の元 midY
let _mSrcContainerEl = null;   // ドラッグ開始時のコンテナ（_mCurContainer）
let _mLastRefY       = 0;      // スライド/挿入の基準Y: フォルダドラッグ時は mouseY、それ以外は ghostMidY
let _mAddFolderTarget = false; // ゴーストが「新しいフォルダ」ボタン上にあるとき true
let _mFolderHoverTimer = null; // ホバー展開タイマー
// 移動閾値を超える前のドラッグ待機状態
let _mPending        = null;
const _M_THRESHOLD   = 5;

function _mGetRootUnits() {
  const list = document.getElementById('presetList');
  return list ? [...list.querySelectorAll(':scope > .preset-item, :scope > .preset-folder, :scope > .preset-root-separator')] : [];
}
function _mGetFolderItems(folderEl) {
  const cont = folderEl?.querySelector('.preset-folder-children');
  return cont ? [...cont.querySelectorAll(':scope > .preset-item')] : [];
}
// ドラッグ中にフォルダを開く（DOM更新 + データ保存）
function _mOpenFolder(hdr) {
  if (!hdr) return;
  const children = hdr.nextElementSibling;
  if (!children || !children.classList.contains('collapsed')) return;
  children.classList.remove('collapsed');
  const icon = hdr.querySelector('.preset-folder-toggle i');
  if (icon) { icon.setAttribute('data-lucide', 'chevron-down'); lucide.createIcons(); }
  const idx = +hdr.dataset.idx;
  const list2 = loadPresets();
  if (list2[idx]) { list2[idx].open = true; savePresets(list2); }
}
// 現在ゴースト中心がどのオープンフォルダの子エリア内にあるかを検出。
// .preset-folder 要素を返す。ゴーストがルートレベルにある場合は null。
function _mDetectContainer(ghostMidY) {
  const folders = document.querySelectorAll('#presetList > .preset-folder');
  for (const folder of folders) {
    if (folder === _mDraggedEl) continue;
    const children = folder.querySelector('.preset-folder-children');
    if (!children || children.classList.contains('collapsed')) continue;
    const cr = children.getBoundingClientRect();
    if (cr.height === 0) continue;
    // 下部スナップゾーン: 最後のアイテムと次の兄弟の隙間を「フォルダ末尾」として扱う。
    const snap = _mDraggedH > 0 ? _mDraggedH * 0.5 : 12;
    if (ghostMidY >= cr.top && ghostMidY <= cr.bottom + snap) return folder;
  }
  return null;
}
function _mInitSiblings(sibs, refY) {
  sibs.forEach(sib => {
    if (sib === _mDraggedEl) return;
    delete sib.dataset.mIsAbove;
    delete sib.dataset.mToggled;
    sib.style.transition = 'none';
    sib.style.transform  = '';
    const r = sib.getBoundingClientRect();
    // フォルダの兄弟要素に対しては、全体の midY（子要素を含みヘッダーより大幅に下にある）ではなく、
    // ヘッダーの midY と比較する。
    // こうすることでフォルダの子要素数に関わらずスライド挑発が自然になる。
    let origMidY;
    if (sib.classList.contains('preset-folder')) {
      const hdr = sib.querySelector('.preset-folder-header');
      const hr  = hdr ? hdr.getBoundingClientRect() : r;
      origMidY  = hr.top + hr.height / 2;
    } else {
      origMidY = r.top + r.height / 2;
    }
    sib.dataset.mOrigMidY = origMidY;
    if (origMidY < refY) sib.dataset.mIsAbove = '';
  });
}
function _mSetActiveSiblings(sibs, ghostMidY) {
  _mActiveSiblings.forEach(sib => {
    if (sib === _mDraggedEl) return;
    sib.style.transform  = '';
    sib.style.transition = '';
    delete sib.dataset.mIsAbove;
    delete sib.dataset.mToggled;
    delete sib.dataset.mOrigMidY;
  });
  _mActiveSiblings = sibs;
  _mInitSiblings(sibs, ghostMidY);
}
// アクティブコンテナを切り替え、前のコンテナのフォロワーをリセットする。
function _mSwitchContainer(newContainer, ghostMidY) {
  // 旧フォロワーをクリア
  _mContainerFollowers.forEach(el => { el.style.transform = ''; el.style.transition = ''; });
  _mContainerFollowers = [];
  _mCurContainer = newContainer;
  // ドラッグ元が属するコンテナに再入りする場合、ドラッグ開始時と mIsAbove が同一になるよう
  // ソースの元の mouseY を基準にする。
  const refMidY = (newContainer === _mSrcContainerEl) ? _mSrcOrigMidY : ghostMidY;
  if (newContainer) {
    const rootUnits = _mGetRootUnits();
    const ci = rootUnits.indexOf(newContainer);
    if (ci >= 0) _mContainerFollowers = rootUnits.slice(ci + 1).filter(u => u !== _mDraggedEl);
    _mSetActiveSiblings(_mGetFolderItems(newContainer), refMidY);
  } else {
    const srcIsF = loadPresets()[_mDragSrcIdx]?.type === 'folder';
    // ルートの非フォルダプリセットは全フォルダの下に必ず置く（セパレーターで区切る）。
    // アクティブ兄弟からフォルダ要素を除外し、
    // ルートアイテムの並び替え時にフォルダがスライドしないようにする。
    const rootSibs = srcIsF
      ? _mGetRootUnits()
      : _mGetRootUnits().filter(u => !u.classList.contains('preset-folder'));
    _mSetActiveSiblings(rootSibs, refMidY);
  }
}
function _mUpdateSlide(ghostMidY) {
  if (!_mGhost) return;
  _mLastGhostMidY = ghostMidY;
  _mGhost.style.top = (ghostMidY - _mDraggedH / 2) + 'px';

  // --- ゴーストが現在どのコンテナ上にあるかを検出 ---
  // フォルダはネスト不可なので、フォルダドラッグ時はコンテナ検出をスキップ。
  const srcIsFolder = loadPresets()[_mDragSrcIdx]?.type === 'folder';
  // 常に実際のカーソル Y（= ghost top + pointerOffset）を全ての比較に使用。
  // ghostMidY はゴーストの位置決定にのみ使う。
  // 以前は非フォルダドラッグで ghostMidY（= mouseY + H/2 - offset）を使っていたため、
  // 検出/スライド挑発がカーソル位置から遅れる原因になっていた。
  const refY = ghostMidY - _mDraggedH / 2 + _mPointerOffsetY;  // = mouseY
  _mLastRefY = refY;

  // --- フォルダヘッダーのホバー（全フォルダ: 開いたもの、閉じたもの、空のもの）---
  // ヘッダー検出はコンテナ検出よりも優先される。
  // フォルダヘッダーをホバーすると青枠を表示し、フォルダ末尾へドロップする。
  let newFolderTarget = null;
  if (!srcIsFolder) {
    document.querySelectorAll('#presetList > .preset-folder').forEach(folder => {
      const hdr = folder.querySelector('.preset-folder-header');
      if (!hdr || +hdr.dataset.idx === _mDragSrcIdx) return;
      const r = hdr.getBoundingClientRect();
      if (refY >= r.top && refY <= r.bottom) newFolderTarget = hdr;
    });
  }

  // --- コンテナ検出（子エリア; ヘッダーホバー中はスキップ）---
  if (!srcIsFolder) {
    const newContainer = newFolderTarget ? null : _mDetectContainer(refY);
    if (newContainer !== _mCurContainer) {
      _mSwitchContainer(newContainer, refY);
    }
  }

  // フォルダヘッダーのハイライトを更新
  if (_mFolderTarget !== newFolderTarget) {
    clearTimeout(_mFolderHoverTimer); _mFolderHoverTimer = null;
    if (_mFolderTarget) _mFolderTarget.classList.remove('drag-over');
    _mFolderTarget = newFolderTarget;
    if (_mFolderTarget) {
      _mFolderTarget.classList.add('drag-over');
      // 閉じているフォルダなら一定時間後に自動展開
      const _fc = _mFolderTarget.nextElementSibling;
      if (_fc?.classList.contains('collapsed')) {
        _mFolderHoverTimer = setTimeout(() => {
          _mOpenFolder(_mFolderTarget);
          _mFolderHoverTimer = null;
        }, 700);
      }
    }
  }

  // --- 「新しいフォルダ」ボタンへのドロップターゲット（ルートプリセットのみ）---
  const srcIsRootPreset = !srcIsFolder && _mSrcContainerEl === null;
  const addFolderBtn = document.getElementById('presetAddFolderBtn');
  let newAddFolderTarget = false;
  if (srcIsRootPreset && addFolderBtn) {
    const r = addFolderBtn.getBoundingClientRect();
    newAddFolderTarget = refY >= r.top && refY <= r.bottom
      && ghostMidY - _mDraggedH / 2 <= r.bottom && ghostMidY + _mDraggedH / 2 >= r.top;
    // シンプルに: カーソル Y だけ確認
    newAddFolderTarget = refY >= r.top && refY <= r.bottom;
  }
  if (newAddFolderTarget !== _mAddFolderTarget) {
    _mAddFolderTarget = newAddFolderTarget;
    if (addFolderBtn) addFolderBtn.classList.toggle('drag-over', newAddFolderTarget);
  }

  // --- アクティブ兄弟要素をスライド ---
  const ghostIsExternal = _mCurContainer !== null && !_mCurContainer.contains(_mDraggedEl);
  // フォルダからルートレベルへの離脱は、外部からの挿入と同じ視覚的意味を持つ:
  // ゴーストは上から到着するため、ゴースト位置以下のアイテムは挿入ギャップを示すため下にスライドする。
  const ejectToRoot = _mCurContainer === null && _mSrcContainerEl !== null;
  _mActiveSiblings.forEach(sib => {
    if (sib === _mDraggedEl) return;
    const sibMidY = +sib.dataset.mOrigMidY;
    if (ghostIsExternal || ejectToRoot) {
      sib.style.transition = 'transform 0.2s ease';
      sib.style.transform  = sibMidY >= refY ? `translateY(${_mDraggedH + _mDragGap}px)` : '';
      return;
    }
    const isAbove  = 'mIsAbove' in sib.dataset;
    const shouldToggle = isAbove ? refY <= sibMidY : refY >= sibMidY;
    const wasToggled   = 'mToggled' in sib.dataset;
    if (shouldToggle !== wasToggled) {
      if (shouldToggle) sib.dataset.mToggled = '';
      else              delete sib.dataset.mToggled;
    }
    sib.style.transition = 'transform 0.2s ease';
    sib.style.transform  = 'mToggled' in sib.dataset
      ? `translateY(${(isAbove ? 1 : -1) * (_mDraggedH + _mDragGap)}px)`
      : '';
  });

  // --- コンテナフォロワー（_mCurContainer より後ろのルート要素）をプッシュ ---
  const visibleSibs = _mActiveSiblings.filter(s => s !== _mDraggedEl);
  const lastSib = visibleSibs[visibleSibs.length - 1];
  let followerShift = 0;
  if (_mCurContainer !== null) {
    if (ghostIsExternal) {
      // 外部からの挿入時は常に 1アイテム分（H+gap）フォルダが大きくなる。
      // フォルダ内のどこに挿入するかに関わらず、transform ベースのスライドはレイアウト高を変えないため
      // フォルダの拡大を視覚的に示すためフォロワーは常にシフトする必要がある。
      followerShift = _mDraggedH + _mDragGap;
    } else if (lastSib) {
      // 内部並び替え: 最後の兄弟要素が下に移動する場合のみシフトする。
      if ('mIsAbove' in lastSib.dataset && 'mToggled' in lastSib.dataset) {
        followerShift = _mDraggedH + _mDragGap;
      }
    }
  }
  _mContainerFollowers.forEach(el => {
    el.style.transition = 'transform 0.2s ease';
    el.style.transform  = followerShift > 0 ? `translateY(${followerShift}px)` : '';
  });
}
// ゴースト Y と保存された元の midY を比較し、フラットなプリセット配列内の挿入インデックスを計算する。
function _mCalcInsertAt() {
  const list = loadPresets();
  const srcIsFolder = list[_mDragSrcIdx]?.type === 'folder';
  const sibs = _mActiveSiblings.filter(s => s !== _mDraggedEl && !s.classList.contains('preset-root-separator'));

  // --- ルートレベルへドロップされた非フォルダアイテム ---
  // データモデル上、ルートアイテムは必ず最初のフォルダエントリより前に置かなければならない。
  // 「F2 の末尾」でも F2 内になるため、insertAt を firstFolderIdx 以下に据える。
  if (_mCurContainer === null && !srcIsFolder) {
    const firstFolderIdx = list.findIndex(p => p.type === 'folder');
    let insertAfterSib = null;
    for (const sib of sibs) {
      if (+sib.dataset.mOrigMidY < _mLastRefY) insertAfterSib = sib;
    }
    if (insertAfterSib !== null) {
      const idx = +insertAfterSib.dataset.idx;
      // idx + 1 は常に firstFolderIdx 以下（sibs はルートアイテムのみ）
      return firstFolderIdx !== -1 ? Math.min(idx + 1, firstFolderIdx) : idx + 1;
    }
    // ゴーストが全ルートアイテムより上 → 最初のルートアイテムの前に挿入
    if (sibs.length > 0) return +sibs[0].dataset.idx;
    return firstFolderIdx !== -1 ? firstFolderIdx : list.length;
  }

  // --- ルートでのフォルダドラッグ、またはフォルダコンテナ内でのアイテムドラッグ ---
  let insertAfterSib = null;
  for (const sib of sibs) {
    if (+sib.dataset.mOrigMidY < _mLastRefY) insertAfterSib = sib;
  }

  if (insertAfterSib !== null) {
    const idx  = +insertAfterSib.dataset.idx;
    const item = list[idx];
    let end = idx + 1;
    if (item?.type === 'folder') while (end < list.length && list[end].type !== 'folder') end++;
    return end;
  }

  // ゴーストが全アクティブ兄弟要素より上 → 最初の兄弟要素の前に挿入。
  if (sibs.length > 0) return +sibs[0].dataset.idx;

  // アクティブ兄弟要素なし（空のフォルダまたは空のルート）。
  if (_mCurContainer) return +_mCurContainer.dataset.idx + 1;

  return _mDragSrcIdx; // fallback: 変更なし
}
function _mCleanup() {
  setIsDraggingPreset(false);
  document.body.classList.remove('preset-dragging', 'dragging-folder');
  document.removeEventListener('mousemove', _mOnMouseMove);
  document.removeEventListener('mouseup',   _mOnMouseUp);
  document.removeEventListener('touchmove', _mOnTouchMove);
  document.removeEventListener('touchend',  _mOnMouseUp);
  if (_mGhost) { _mGhost.remove(); _mGhost = null; }
  if (_mDraggedEl) {
    _mDraggedEl.classList.remove('dnd-src');
    _mDraggedEl.style.transform  = '';
    _mDraggedEl.style.transition = '';
    _mDraggedEl.style.zIndex     = '';
  }
  _mActiveSiblings.forEach(sib => {
    if (sib === _mDraggedEl) return;
    sib.style.transform  = '';
    sib.style.transition = '';
    delete sib.dataset.mIsAbove;
    delete sib.dataset.mToggled;
    delete sib.dataset.mOrigMidY;
  });
  if (_mFolderTarget) { _mFolderTarget.classList.remove('drag-over'); _mFolderTarget = null; }
  clearTimeout(_mFolderHoverTimer); _mFolderHoverTimer = null;
  const addFolderBtn2 = document.getElementById('presetAddFolderBtn');
  if (addFolderBtn2) addFolderBtn2.classList.remove('drag-over');
  _mAddFolderTarget = false;
  _mContainerFollowers.forEach(el => { el.style.transform = ''; el.style.transition = ''; });
  _mContainerFollowers = [];
  _mDraggedEl      = null;
  _mActiveSiblings = [];
  _mDragSrcIdx     = null;
  _mCurContainer   = null;
  _mLastGhostMidY  = 0;
  _mLastRefY       = 0;
  _mSrcOrigMidY    = 0;
  _mSrcContainerEl = null;
}
function _mApplyDrop() {
  if (_mFolderTarget) {
    // 閉じた/空のフォルダ末尾へドロップ
    const folderIdx = +_mFolderTarget.dataset.idx;
    const list2 = loadPresets();
    const src = list2[_mDragSrcIdx];
    if (src?.type !== 'folder') {
      let insertAt = folderIdx + 1;
      while (insertAt < list2.length && list2[insertAt].type !== 'folder') insertAt++;
      const [moved] = list2.splice(_mDragSrcIdx, 1);
      if (insertAt > _mDragSrcIdx) insertAt--;
      list2.splice(insertAt, 0, moved);
      list2[folderIdx].open = true; // ドロップ後にフォルダを開く
      savePresets(list2);
      return insertAt; // 移動後の新インデックス
    }
    return null;
  }
  const insertAt = _mCalcInsertAt();
  const list2 = loadPresets();
  const src = list2[_mDragSrcIdx];
  let srcEnd = _mDragSrcIdx + 1;
  if (src?.type === 'folder') while (srcEnd < list2.length && list2[srcEnd].type !== 'folder') srcEnd++;
  const count = srcEnd - _mDragSrcIdx;
  // 結果が同一か確認（同じコンテナ内の同じ位置）
  const moved = list2.slice(_mDragSrcIdx, srcEnd);
  const testList = [...list2];
  testList.splice(_mDragSrcIdx, count);
  let fi = insertAt;
  if (fi > _mDragSrcIdx) fi -= count;
  fi = Math.max(0, fi);
  testList.splice(fi, 0, ...moved);
  if (JSON.stringify(testList) === JSON.stringify(list2)) return null; // 変更なし
  list2.splice(_mDragSrcIdx, count);
  list2.splice(fi, 0, ...moved);
  savePresets(list2);
  return fi; // 移動後の新インデックス
}
// 移動閾値を超えた時点で一度だけ呼ばれる — ドラッグモードに確定
function _mStartDrag(pending) {
  const { unit, rect, downY } = pending;

  _mDragSrcIdx     = +unit.dataset.idx;
  _mDraggedEl      = unit;
  _mDraggedH       = rect.height;
  _mPointerOffsetY = downY - rect.top;

  // DOM 上のユニット位置から初期コンテナを検出
  const closestFolderChildren = unit.closest('.preset-folder-children');
  _mCurContainer = closestFolderChildren ? unit.closest('.preset-folder') : null;

  const srcIsFolder2 = loadPresets()[_mDragSrcIdx]?.type === 'folder';
  let initSibs;
  if (_mCurContainer) {
    initSibs = _mGetFolderItems(_mCurContainer);
  } else if (srcIsFolder2) {
    initSibs = _mGetRootUnits();
  } else {
    // ルートの非フォルダ: フォルダはスライドさせず、ルートアイテムのみスライド。
    // ルートアイテムは全フォルダの下に表示されるためフォルダは動かさない。
    initSibs = _mGetRootUnits().filter(u => !u.classList.contains('preset-folder'));
  }
  _mDragGap = 0;
  for (let i = 0; i < initSibs.length - 1; i++) {
    const r1 = initSibs[i].getBoundingClientRect();
    const r2 = initSibs[i + 1].getBoundingClientRect();
    const g  = r2.top - r1.bottom;
    if (g >= 0 && g < 100) { _mDragGap = g; break; }
  }
  const ghostMidY  = rect.top + rect.height / 2;
  const initMouseY = rect.top + _mPointerOffsetY;  // ドラッグ開始時のカーソルY
  _mSrcOrigMidY    = initMouseY;
  _mSrcContainerEl = _mCurContainer;
  _mActiveSiblings = initSibs;
  _mLastRefY       = initMouseY;
  _mInitSiblings(initSibs, initMouseY);

  _mGhost = unit.cloneNode(true);
  _mGhost.className += ' preset-dnd-ghost';
  _mGhost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;pointer-events:none;z-index:9999;opacity:0.9;box-shadow:0 8px 28px rgba(0,0,0,0.45);border-radius:8px;`;
  document.body.appendChild(_mGhost);
  lucide.createIcons({ el: _mGhost });
  unit.classList.add('dnd-src');
  setIsDraggingPreset(true);
  document.body.classList.add('preset-dragging');
  if (srcIsFolder2) document.body.classList.add('dragging-folder');
}
// 閾値フェーズのリスナー（ドラッグ確定前）
function _mOnPendingMove(e) {
  if (!_mPending) return;
  const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
  const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  if (Math.abs(y - _mPending.downY) < _M_THRESHOLD &&
      Math.abs(x - _mPending.downX) < _M_THRESHOLD) return;
  // 閾値超過 — 本ドラッグに切り替え
  const pending = _mPending;
  _mCancelPending();
  _mStartDrag(pending);
  document.addEventListener('mousemove', _mOnMouseMove);
  document.addEventListener('mouseup',   _mOnMouseUp);
  document.addEventListener('touchmove', _mOnTouchMove, { passive: false });
  document.addEventListener('touchend',  _mOnMouseUp);
  e.preventDefault();
  _mUpdateSlide(y - _mPointerOffsetY + _mDraggedH / 2);
}
function _mOnPendingUp() { _mCancelPending(); }
function _mCancelPending() {
  document.removeEventListener('mousemove', _mOnPendingMove);
  document.removeEventListener('mouseup',   _mOnPendingUp);
  document.removeEventListener('touchmove', _mOnPendingMove);
  document.removeEventListener('touchend',  _mOnPendingUp);
  document.body.classList.remove('preset-pending-drag');
  _mPending = null;
}
function _mOnMouseMove(e) {
  if (!_mDraggedEl) return;
  e.preventDefault();
  const y = e.clientY ?? e.touches?.[0]?.clientY;
  _mUpdateSlide(y - _mPointerOffsetY + _mDraggedH / 2);
}
const _mOnTouchMove = e => { if (_mDraggedEl) { e.preventDefault(); _mOnMouseMove(e); } };
function _mOnMouseUp() {
  if (!_mDraggedEl) return;
  // 「新しいフォルダ」ボタンへドロップ → 新フォルダを作成してプリセットを移動
  if (_mAddFolderTarget) {
    const list = loadPresets();
    const src = list[_mDragSrcIdx];
    if (src && src.type !== 'folder') {
      list.splice(_mDragSrcIdx, 1);
      list.push({ type: 'folder', name: t('folder-new'), open: true });
      list.push(src);
      savePresets(list);
    }
    _mCleanup();
    renderPresets();
    // フォルダ名を即編集状態に
    requestAnimationFrame(() => {
      const headers = document.querySelectorAll('.preset-folder-header');
      const last = headers[headers.length - 1];
      if (!last) return;
      const nameEl = last.querySelector('.preset-folder-name');
      if (!nameEl) return;
      const idx = +last.dataset.idx;
      nameEl.contentEditable = 'plaintext-only';
      nameEl.focus();
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(nameEl); sel.removeAllRanges(); sel.addRange(range);
      const commit = () => {
        nameEl.contentEditable = 'false';
        const next = nameEl.textContent.trim().slice(0, 50) || t('folder-new');
        nameEl.textContent = next;
        const l = loadPresets(); if (l[idx]) { l[idx].name = next; savePresets(l); }
      };
      nameEl.addEventListener('blur', commit, { once: true });
      nameEl.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
        if (ev.key === 'Escape') { nameEl.textContent = t('folder-new'); nameEl.blur(); }
      });
    });
    return;
  }
  const _dropSrcIdx = _mDragSrcIdx;
  const _dropNewIdx  = _mApplyDrop();
  if (_dropNewIdx != null && _dropSrcIdx === _activePresetIdx) {
    setActivePresetIdx(_dropNewIdx);
    setF2Target({ type: 'preset', idx: _dropNewIdx });
  }
  _mCleanup();
  renderPresets();
}
function _mOnMouseDown(e) {
  if (e.target.closest('button')) return;
  if (e.target.closest('[contenteditable]:not([contenteditable="false"])')) return;
  if (e.target.closest('.preset-folder-toggle')) return;
  if (e.target.closest('input, select, textarea')) return;
  const folderHeader = e.target.closest('.preset-folder-header');
  const draggedUnit  = folderHeader
    ? folderHeader.closest('.preset-folder')
    : e.target.closest('.preset-item');
  if (!draggedUnit) return;
  // まだ preventDefault しない — クリックが機能するよう移動閾値を待つ
  const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
  const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  _mPending = { downY: y, downX: x, unit: draggedUnit, rect: draggedUnit.getBoundingClientRect() };
  document.body.classList.add('preset-pending-drag');
  document.addEventListener('mousemove', _mOnPendingMove);
  document.addEventListener('mouseup',   _mOnPendingUp);
  document.addEventListener('touchmove', _mOnPendingMove, { passive: false });
  document.addEventListener('touchend',  _mOnPendingUp);
}
// イベント委譲：#presetList が描画されたら一度だけバインド
((() => {
  const bind = () => {
    const el = document.getElementById('presetList');
    if (!el || el._mouseDndBound) return;
    el._mouseDndBound = true;
    el.addEventListener('mousedown',  _mOnMouseDown);
    el.addEventListener('touchstart', _mOnMouseDown, { passive: false });
  };
  new MutationObserver(bind).observe(document.body, { childList: true, subtree: true });
})());
