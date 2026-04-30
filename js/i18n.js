// ============================================================
//  i18n — Gentleman Frame translation engine
// ============================================================
//  Built-in: ja (日本語), en (English)
//
//  ── 言語を追加するには ──────────────────────────────────────
//  1. js/locales/_template.js をコピーして js/locales/XX.js を作成
//  2. dict 内の全値を翻訳して埋める
//  3. index.html の <script src="js/app.js"> の直前に追加:
//       <script src="js/locales/XX.js"></script>
//  → ドロップダウンに自動で表示されます。
//
//  ── To add a language ──────────────────────────────────────
//  1. Copy js/locales/_template.js → js/locales/XX.js
//  2. Fill in every value in the dict
//  3. In index.html, add BEFORE <script src="js/app.js">:
//       <script src="js/locales/XX.js"></script>
//  The language will appear automatically in the dropdown.
// ============================================================

const _I18N_DICTS  = {};
const _I18N_LABELS = {};

/**
 * Register a translation.
 * @param {string} code   BCP-47 language code, e.g. 'zh', 'ko', 'fr'
 * @param {string} label  Display name shown in the dropdown, e.g. '中文'
 * @param {Object} dict   Key→value translation map (see locales/_template.js for all keys)
 */
function registerLang(code, label, dict) {
  _I18N_DICTS[code]  = dict;
  _I18N_LABELS[code] = label;
}

function unregisterLang(code) {
  delete _I18N_DICTS[code];
  delete _I18N_LABELS[code];
}

/** Returns registered languages in insertion order: [{code, label}, …] */
function getRegisteredLangs() {
  return Object.keys(_I18N_DICTS).map(code => ({ code, label: _I18N_LABELS[code] || code }));
}

// var (not let) so app.js can update it via plain assignment across script files
var _lang = localStorage.getItem('gf-lang') || 'ja';

function t(key) {
  return (_I18N_DICTS[_lang] || _I18N_DICTS['ja'] || {})[key] || key;
}

// ── Built-in: Japanese ─────────────────────────────────────
registerLang('ja', '日本語', {
  'mode-dark':'ダークモード','mode-light':'ライトモード',
  'vid-title':'動画',
  'bg-title':'背景','fg-title':'前景','mask-title':'マスク','filter-title':'フィルター','preset-title':'プリセット',
  'drop-label':'MP4をここにドロップ','drop-hint':'またはクリックして選択',
  'del-title':'削除','load-btn':'読込','mute-title':'ミュート',
  'vol':'音量','offset':'オフセット','swap-title':'背景・前景入れ替え',
  'vid-vis-title':'動画を表示/非表示','vid-clear-title':'動画をクリア',
  'bg-vis-title':'背景を表示/非表示','bg-clear-title':'背景をクリア',
  'fg-vis-title':'前景を表示/非表示','fg-clear-title':'前景をクリア',
  'open-page-title':'元ページを開く',
  'shape':'形状','shape-rect':'四角','shape-circle':'円','shape-heart':'ハート','shape-phone':'スマホ',
  'phone-ui':'表示','phone-ui-rot90':'横向き','phone-ui-rot':'三等分グリッド','phone-ui-rec':'RECボタン','phone-ui-tc':'タイムコード','phone-ui-dot':'フロントカメラ',
  'width':'幅','height':'高さ','mask-x':'位置 X','mask-y':'位置 Y','mask-zoom':'ズーム','blur':'ぼかし',
  'zoom-lock':'ズームをマスクに追従中（クリックで解除）','zoom-unlock':'ズームをマスクサイズに追従させる',
  'follow-mode-mask':'マウス追従: マスク','follow-mode-anchor':'マウス追従: アンカー','follow-mode-both':'マウス追従: マスク + アンカー','follow-mode-none':'マウス追従: オフ',
  'fg-fixed-mode':'アンカー',
  'fg-fixed':'アンカー固定中（クリックで解除）','fg-unfix':'前景アンカーを有効化',
  'fg-anchor-show':'アンカー',
  'fg-pin-x':'視点 X','fg-pin-y':'視点 Y',
  'border-w':'枠の太さ','border-op':'枠の透過','border-col':'枠の色',
  'border-anim':'アニメ','border-anim-rainbow':'レインボー',
  'border-anim-cm':'シアン/マゼンタ','border-anim-sakura':'サクラ',
  'border-anim-cyber':'サイバー','border-anim-fire':'ファイア','border-anim-pink':'ピンク',
  'border-speed':'枠の速度','border-bright':'枠の輝度',
  'brightness':'明るさ','contrast':'コントラスト','saturation':'彩度','filter-hue':'色相',
  'ca':'色収差','vignette':'ビネット',
  'filter-temp':'色温度','filter-matte':'マット','filter-grain':'フィルム粒子',
  'filter-pixel':'ピクセル化','filter-flare':'カラーフレア',
  'filter-bars':'レターボックス','filter-fps':'フレームレート',
  'filter-highlight':'ハイライト','filter-shadow':'シャドウ','filter-tint':'色かぶり補正','filter-sharpness':'シャープネス',
  'fqp-cinema':'シネマ','fqp-retro':'レトロ','fqp-insta':'インスタ',
  'fqp-pastel':'パステル','fqp-neon':'ネオン','fqp-sunset':'夕焼け',
  'fqp-cool':'クール','fqp-dreamy':'ドリーミー','fqp-glitch':'グリッチ',
  'fqp-noir':'ノワール','fqp-horror':'ホラー','fqp-modern':'モダン','fqp-trend':'トレンド',
  'fqp-save-title':'現在のフィルターを保存',
  'fqp-custom-del-title':'削除',
  'preset-add-label':'新しいプリセット',
  'preset-code-ph':'取込コード（gf~…）または JSON を貼り付け',
  'theater-open':'シアターモード（パネル非表示）','theater-close':'パネルを表示',
  'fs-open':'フルスクリーン','fs-close':'フルスクリーン解除',
  'play-title':'再生/一時停止','stop-title':'停止','screenshot-title':'スクリーンショット保存',
  'mask-vis-title':'マスクを表示/非表示','mask-reset-title':'マスクをリセット',
  'filter-vis-title':'フィルターを表示/非表示','filter-reset-title':'フィルターをリセット',
  'slider-reset':'リセット',
  'border-col-pick':'色を選択',
  'resync':'リシンク',
  'preset-default':'プリセット',
  'preset-empty':'まだプリセットがありません',
  'preset-add-title':'プリセットを作成',
  'preset-overwrite-confirm':'「{name}」を上書きしますか？',
  'preset-del-title':'プリセットを削除',
  'preset-save-title':'プリセットを保存',
  'preset-copy-title':'コードをコピー',
  'preset-rename-title':'名前を変更',
  'folder-copy-title':'フォルダをコードでコピー',
  'folder-rename-title':'名前を変更',
  'del-confirm':'「{name}」を削除しますか？',
  'del-confirm-folder':'フォルダ「{name}」とフォルダ内のプリセットを削除しますか？',
  'del-confirm-btn':'削除',
  'preset-save-confirm-btn':'保存',
  'del-cancel-btn':'キャンセル',
  'folder-new':'新しいフォルダ',
  'folder-add-title':'フォルダを作成',
  'folder-del-title':'フォルダを削除',
  'preset-no-video':'動画なし',
  'preset-saved':'{name}を保存しました',
  'preset-copied':'コードをコピーしました',
  'preset-imported':'{n}件取り込みました',
  'preset-import-empty':'取り込めるデータがありませんでした',
  'preset-import-err':'コードが正しくありません',
  'preset-file-missing':'ローカルファイルが見つかりません',
  'file-resolve-title':'ファイルが見つかりません',
  'file-resolve-desc':'ローカルファイルにアクセスできませんでした。各スロットのファイルを選び直してください。',
  'file-resolve-note':'他の端末から取り込んだプリセットは、初回のみファイルを選び直す必要があります。ブラウザのセキュリティ仕様上、ファイルへのアクセス権はデバイス間で共有できません。',
  'file-resolve-cancel':'キャンセル',
  'file-resolve-ok':'OK',
  'file-resolve-slot-drop':'ドロップ、またはクリックして選択',
  'file-resolve-folder-btn':'フォルダ選択',
  'file-resolve-name-warn':'ファイル名が一致しません',
  'file-resolve-mismatch-accept':'このファイルを使用',
  'file-resolve-mismatch-reject':'キャンセル',
  'file-mismatch-expected':'プリセットの登録名',
  'file-mismatch-picked':'選択したファイル名',
  'import-code':'コードをインポート',
  'export-json':'JSONファイルで保存',
  'copy-all-code':'すべてのコードをコピー',
  'all-copied':'すべてのコードをコピーしました',
  'no-presets':'プリセットがありません',
  'url-resolve-fail':'URL解決失敗',
  'api-checking':'APIを確認中...',
  'vid-loading':'動画を読み込み中...',
  'url-cors-err':'URLを読み込めません（直リンク非対応または無効なURL）',
  'cors-err':'CORS制限: キャンバスに描画できません',
  'err-different-site':'{site} 専用コンテンツのため非対応です。',
  'err-private-video':'プライベート動画またはログインが必要なコンテンツのため取得できません。',
  'err-auth-required':'プライベート動画または認証が必要なコンテンツのため取得できません。',
  'err-unsupported-site':'{site} は対応していません。',
  'err-invalid-url':'URLの形式が正しくありません（https://... の形で入力してください）',
  'ar-lock':'アス比固定中（クリックで解除）','ar-unlock':'アス比を固定する',
  'hint-bg':'1. 背景に動画・画像をドロップ',
  'hint-fg':'2. 前景に動画・画像をドロップ',
  'lang-import-title':'言語を切り替える',
  'lang-import-drop':'JSONファイルをドロップ',
  'dnd-hint':'JSONファイルをここにドロップ',
  'lang-import-or':'または JSON テキストを貼り付け',
  'lang-import-ph':'{"code":"ko","label":"한국어","dict":{...}}',
  'lang-import-apply':'適用',
  'lang-import-err':'言語ファイルの読み込みに失敗しました',
  'lang-add':'＋ 追加',
  'lang-cancel':'キャンセル',
  'lang-template-dl':'テンプレートをDL',
});

// ── Built-in: English ──────────────────────────────────────
registerLang('en', 'English', {
  'mode-dark':'Dark Mode','mode-light':'Light Mode',
  'vid-title':'Videos',
  'bg-title':'Background','fg-title':'Foreground','mask-title':'Mask','filter-title':'Filters','preset-title':'Presets',
  'drop-label':'Drop MP4 here','drop-hint':'or click to select',
  'del-title':'Remove','load-btn':'Load','mute-title':'Mute',
  'vol':'Volume','offset':'Offset','swap-title':'Swap BG / FG',
  'vid-vis-title':'Show/Hide videos','vid-clear-title':'Clear videos',
  'bg-vis-title':'Show/Hide background','bg-clear-title':'Clear background',
  'fg-vis-title':'Show/Hide foreground','fg-clear-title':'Clear foreground',
  'open-page-title':'Open source page',
  'shape':'Shape','shape-rect':'Rect','shape-circle':'Circle','shape-heart':'Heart','shape-phone':'Phone',
  'phone-ui':'Show','phone-ui-rot90':'Landscape','phone-ui-rot':'Rule of Thirds','phone-ui-rec':'REC Button','phone-ui-tc':'Timecode','phone-ui-dot':'Front Camera',
  'width':'Width','height':'Height','mask-x':'Pos X','mask-y':'Pos Y','mask-zoom':'Zoom','blur':'Blur',
  'zoom-lock':'Zoom tracks mask (click to release)','zoom-unlock':'Lock zoom to mask size',
  'follow-mode-mask':'Mouse follow: Mask','follow-mode-anchor':'Mouse follow: Anchor','follow-mode-both':'Mouse follow: Mask + Anchor','follow-mode-none':'Mouse follow: Off',
  'fg-fixed-mode':'Anchor',
  'fg-fixed':'Anchor On (click to release)','fg-unfix':'Enable foreground anchor',
  'fg-anchor-show':'Anchor',
  'fg-pin-x':'Focal X','fg-pin-y':'Focal Y',
  'border-w':'Border','border-op':'Opacity','border-col':'Color',
  'border-anim':'Anim','border-anim-rainbow':'Rainbow',
  'border-anim-cm':'Cyan/Magenta','border-anim-sakura':'Sakura',
  'border-anim-cyber':'Cyber','border-anim-fire':'Fire','border-anim-pink':'Pink',
  'border-speed':'Speed','border-bright':'Luminosity',
  'brightness':'Brightness','contrast':'Contrast','saturation':'Saturation','filter-hue':'Hue',
  'ca':'Aberration','vignette':'Vignette',
  'filter-temp':'Temp','filter-matte':'Matte','filter-grain':'Grain',
  'filter-pixel':'Pixelate','filter-flare':'Color Flare',
  'filter-bars':'Cinematic Bars','filter-fps':'Frame Rate',
  'filter-highlight':'Highlights','filter-shadow':'Shadows','filter-tint':'Tint','filter-sharpness':'Sharpness',
  'fqp-cinema':'Cinema','fqp-retro':'Retro','fqp-insta':'Insta',
  'fqp-pastel':'Pastel','fqp-neon':'Neon','fqp-sunset':'Sunset',
  'fqp-cool':'Cool','fqp-dreamy':'Dreamy','fqp-glitch':'Glitch',
  'fqp-noir':'Noir','fqp-horror':'Horror','fqp-modern':'Modern','fqp-trend':'Trend',
  'fqp-save-title':'Save current filter',
  'fqp-custom-del-title':'Delete',
  'preset-add-label':'New Preset',
  'preset-code-ph':'Paste import code (gf~…) or JSON',
  'theater-open':'Theater (hide panel)','theater-close':'Show panel',
  'fs-open':'Fullscreen','fs-close':'Exit fullscreen',
  'play-title':'Play / Pause','stop-title':'Stop','screenshot-title':'Save screenshot',
  'mask-vis-title':'Show/Hide mask','mask-reset-title':'Reset mask',
  'filter-vis-title':'Show/Hide filters','filter-reset-title':'Reset filters',
  'slider-reset':'Reset',
  'border-col-pick':'Pick color',
  'resync':'Resync',
  'preset-default':'Preset',
  'preset-empty':'No presets yet',
  'preset-add-title':'Create preset',
  'preset-overwrite-confirm':'Overwrite "{name}"?',
  'preset-del-title':'Delete preset',
  'preset-save-title':'Save preset',
  'preset-copy-title':'Copy as code',
  'preset-rename-title':'Rename',
  'folder-copy-title':'Copy folder as code',
  'folder-rename-title':'Rename',
  'del-confirm':'Delete "{name}"?',
  'del-confirm-folder':'Delete folder "{name}" and the presets inside?',
  'del-confirm-btn':'Delete',
  'preset-save-confirm-btn':'Save',
  'del-cancel-btn':'Cancel',
  'folder-new':'New Folder',
  'folder-add-title':'Create folder',
  'folder-del-title':'Delete folder',
  'preset-no-video':'No video',
  'preset-saved':'"{name}" saved',
  'preset-copied':'Code copied',
  'preset-imported':'{n} preset(s) imported',
  'preset-import-empty':'No importable data found',
  'preset-import-err':'Invalid code',
  'preset-file-missing':'Local file not found',
  'file-resolve-title':'File Not Found',
  'file-resolve-desc':'The local files saved in this preset could not be accessed. Please select each file again.',
  'file-resolve-note':'Presets imported from another device always need to be re-linked once. Due to browser security, file access permissions cannot be shared across devices.',
  'file-resolve-cancel':'Cancel',
  'file-resolve-ok':'OK',
  'file-resolve-slot-drop':'Drop here or click to select',
  'file-resolve-folder-btn':'Select folder',
  'file-resolve-name-warn':'File name does not match',
  'file-resolve-mismatch-accept':'Use selected file',
  'file-resolve-mismatch-reject':'Cancel',
  'file-mismatch-expected':'Preset filename',
  'file-mismatch-picked':'Selected filename',
  'import-code':'Import code',
  'export-json':'Save as JSON file',
  'copy-all-code':'Copy all code',
  'all-copied':'All code copied',
  'no-presets':'No presets',
  'url-resolve-fail':'Failed to resolve URL',
  'api-checking':'Checking API...',
  'vid-loading':'Loading video...',
  'url-cors-err':'Cannot load URL (direct link not allowed or invalid)',
  'cors-err':'CORS: cannot draw to canvas',
  'err-different-site':'{site} exclusive content — not supported.',
  'err-private-video':'Private video or login required.',
  'err-auth-required':'Private video or authentication required.',
  'err-unsupported-site':'{site} is not supported.',
  'err-invalid-url':'Invalid URL format (must start with https://...)',
  'ar-lock':'AR Locked (click to unlock)','ar-unlock':'Lock aspect ratio',
  'hint-bg':'1. Drop video / image for background',
  'hint-fg':'2. Drop video / image for foreground',
  'lang-import-title':'Switch Language',
  'lang-import-drop':'Drop JSON file here',
  'dnd-hint':'Drop JSON file here',
  'lang-import-or':'or paste JSON text below',
  'lang-import-ph':'{"code":"ko","label":"한국어","dict":{...}}',
  'lang-import-apply':'Apply',
  'lang-import-err':'Failed to load language file',
  'lang-add':'+ Add',
  'lang-cancel':'Cancel',
  'lang-template-dl':'Download Template',
});

// ── Built-in: Chinese Simplified ──────────────────────────
registerLang('zh', '中文', {
  'mode-dark':'深色模式','mode-light':'浅色模式',
  'vid-title':'视频',
  'bg-title':'背景','fg-title':'前景','mask-title':'遮罩','filter-title':'滤镜','preset-title':'预设',
  'drop-label':'将 MP4 拖放到此处','drop-hint':'或点击选择',
  'del-title':'删除','load-btn':'加载','mute-title':'静音',
  'vol':'音量','offset':'偏移','swap-title':'交换背景与前景',
  'shape':'形状','shape-rect':'矩形','shape-circle':'圆形','shape-heart':'心形','shape-phone':'手机',
  'phone-ui':'显示','phone-ui-rot90':'横向','phone-ui-rot':'三分居网格','phone-ui-rec':'录制按钮','phone-ui-tc':'时间码','phone-ui-dot':'前置摄像头',
  'width':'宽度','height':'高度','mask-x':'位置 X','mask-y':'位置 Y','mask-zoom':'缩放','blur':'模糊',
  'zoom-lock':'缩放跟随蒙版（点击解除）','zoom-unlock':'让缩放跟随蒙版大小',
  'follow-mode-mask':'鼠标跟随: 蒙版','follow-mode-anchor':'鼠标跟随: 锚点','follow-mode-both':'鼠标跟随: 蒙版 + 锚点','follow-mode-none':'鼠标跟随: 关闭',
  'fg-fixed-mode':'锥点',
  'fg-fixed':'锥点已启用（点击解除）','fg-unfix':'启用前景锥点',
  'fg-anchor-show':'锚点',
  'fg-pin-x':'视点 X','fg-pin-y':'视点 Y',
  'vid-vis-title':'显示/隐藏视频','vid-clear-title':'清除视频',
  'bg-vis-title':'显示/隐藏背景','bg-clear-title':'清除背景',
  'fg-vis-title':'显示/隐藏前景','fg-clear-title':'清除前景',
  'open-page-title':'打开原始页面',
  'border-w':'边框宽度','border-op':'边框透明度','border-col':'边框颜色',
  'border-anim':'动画','border-anim-rainbow':'彩虹',
  'border-anim-cm':'青/洋红','border-anim-sakura':'樱花',
  'border-anim-cyber':'赛博','border-anim-fire':'火焰','border-anim-pink':'粉色',
  'border-speed':'速度','border-bright':'明度',
  'brightness':'亮度','contrast':'对比度','saturation':'饱和度','filter-hue':'色相',
  'ca':'色差','vignette':'暗角',
  'filter-temp':'色温','filter-matte':'哑光','filter-grain':'胶片颗粒',
  'filter-pixel':'像素化','filter-flare':'色彩光晕',
  'filter-bars':'信箱遮幅','filter-fps':'帧率',  'filter-highlight':'高光','filter-shadow':'阴影','filter-tint':'色调','filter-sharpness':'锐化',
  'fqp-cinema':'电影','fqp-retro':'复古','fqp-insta':'网红',
  'fqp-pastel':'粉彩','fqp-neon':'霓虹','fqp-sunset':'夕阳',
  'fqp-cool':'冷色','fqp-dreamy':'梦幻','fqp-glitch':'故障',
  'fqp-noir':'黑白','fqp-horror':'恐怖','fqp-modern':'现代','fqp-trend':'潮流',
  'fqp-save-title':'保存当前滤镜',
  'fqp-custom-del-title':'删除',
  'preset-add-label':'新建预设',
  'preset-code-ph':'粘贴导入代码（gf~…）或 JSON',
  'theater-open':'影院模式（隐藏面板）','theater-close':'显示面板',
  'fs-open':'全屏','fs-close':'退出全屏',
  'play-title':'播放/暂停','stop-title':'停止','screenshot-title':'保存截图',
  'mask-vis-title':'显示/隐藏遮罩','mask-reset-title':'重置遮罩',
  'filter-vis-title':'显示/隐藏滤镜','filter-reset-title':'重置滤镜',
  'slider-reset':'重置',
  'border-col-pick':'选择颜色',
  'resync':'重新同步',
  'preset-default':'预设',
  'preset-empty':'暂无预设',
  'preset-add-title':'新建预设',
  'preset-overwrite-confirm':'覆盖「{name}」？',
  'preset-del-title':'删除预设',
  'preset-save-title':'保存预设',
  'preset-copy-title':'复制为代码',
  'preset-rename-title':'重命名',
  'folder-copy-title':'将文件夹复制为代码',
  'folder-rename-title':'重命名',
  'del-confirm':'删除「{name}」？',
  'del-confirm-folder':'删除文件夹「{name}」及其中的预设？',
  'del-confirm-btn':'删除',
  'preset-save-confirm-btn':'保存',
  'del-cancel-btn':'取消',
  'folder-new':'新建文件夹',
  'folder-add-title':'新建文件夹',
  'folder-del-title':'删除文件夹',
  'preset-no-video':'无视频',
  'preset-saved':'已保存「{name}」',
  'preset-copied':'已复制代码',
  'preset-imported':'已导入 {n} 个',
  'preset-import-empty':'未找到可导入的数据',
  'preset-import-err':'代码无效',
  'preset-file-missing':'找不到本地文件',
  'file-resolve-title':'找不到文件',
  'file-resolve-desc':'无法访问预设中登记的本地文件，请重新选择各文件。',
  'file-resolve-note':'从其他设备导入的预设，首次使用时需要重新选择文件。由于浏览器安全限制，文件访问权限无法跨设备共享。',
  'file-resolve-cancel':'取消',
  'file-resolve-ok':'确定',
  'file-resolve-slot-drop':'拖放到此处或点击选择',
  'file-resolve-folder-btn':'选择文件夹',
  'file-resolve-name-warn':'文件名不匹配',
  'file-mismatch-expected':'预设文件名',
  'file-mismatch-picked':'已选文件名',
  'import-code':'导入代码',
  'export-json':'保存为JSON文件',
  'copy-all-code':'复制全部代码',
  'all-copied':'已复制全部代码',
  'no-presets':'没有预设',
  'url-resolve-fail':'URL 解析失败',
  'api-checking':'正在检查 API...',
  'vid-loading':'正在加载视频...',
  'url-cors-err':'无法加载 URL（不支持直链或 URL 无效）',
  'cors-err':'CORS 限制：无法绘制到画布',
  'err-different-site':'{site} 专属内容，不受支持。',
  'err-private-video':'私密视频或需要登录才能访问。',
  'err-auth-required':'私密视频或需要身份验证才能访问。',
  'err-unsupported-site':'不支持 {site}。',
  'err-invalid-url':'URL 格式无效（请输入 https://... 格式的地址）',
  'ar-lock':'已锁定宽高比（点击解锁）','ar-unlock':'锁定宽高比',
  'hint-bg':'1. 拖入背景動画',
  'hint-fg':'2. 拖入前景動画',
  'lang-import-title':'切换语言',
  'lang-import-drop':'将 JSON 文件拖放到此处',
  'dnd-hint':'将 JSON 文件拖放到此处',
  'lang-import-or':'或粘贴 JSON 文本',
  'lang-import-ph':'{"code":"ko","label":"한국어","dict":{...}}',
  'lang-import-apply':'应用',
  'lang-import-err':'加载语言文件失败',
  'lang-add':'＋ 添加',
  'lang-cancel':'取消',  'lang-template-dl':'下载模板',});

// ============================================================
//  External language loading (JSON D&D / paste)
// ============================================================

/**
 * Parse and register a language from a JSON string.
 * The JSON format matches js/locales/_template.json:
 *   { "code": "zh", "label": "中文", "dict": { ... } }
 * Persists to localStorage so the language survives page reload.
 * @param {string} jsonText
 * @returns {{ code: string, label: string }}
 */
function loadLangJSON(jsonText) {
  const data = JSON.parse(jsonText);
  const { code, label, dict } = data;
  if (!code || !label || typeof dict !== 'object' || Array.isArray(dict)) {
    throw new Error('invalid lang JSON');
  }
  registerLang(code, label, dict);
  try {
    const saved = JSON.parse(localStorage.getItem('gf-ext-langs') || '[]');
    const idx = saved.findIndex(x => x.code === code);
    if (idx >= 0) saved[idx] = { code, label, dict };
    else saved.push({ code, label, dict });
    localStorage.setItem('gf-ext-langs', JSON.stringify(saved));
  } catch (e) {}
  return { code, label };
}

// Restore externally loaded languages from previous session
(function () {
  try {
    const saved = JSON.parse(localStorage.getItem('gf-ext-langs') || '[]');
    saved.forEach(({ code, label, dict }) => registerLang(code, label, dict));
  } catch (e) {}
})();

/**
 * Generate a blank template JSON (all values empty) based on the current
 * built-in 'ja' key set, then trigger a file download.
 */
function downloadLangTemplate() {
  const keys = Object.keys(_I18N_DICTS['ja'] || {});
  const en = _I18N_DICTS['en'] || {};
  const dict = {};
  keys.forEach(k => { dict[k] = en[k] ?? ''; });
  const template = {
    _instructions: {
      code:  'BCP-47 language code, e.g. "ko", "fr", "es", "de", "pt", "ru", "th", "id"',
      label: 'Display name shown in the language dropdown (use native script, e.g. "한국어", "Français")',
      dict:  'Translate every value. Keys must not be changed. Placeholders like {name}, {n}, {site} must be kept as-is.',
      usage: 'Drop this file (or paste its content) into the language dialog → + Add section.',
    },
    code:  'XX',
    label: 'Language Name',
    dict,
  };
  const json = JSON.stringify(template, null, 2);
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  a.download = 'gf-lang-template.json';
  a.click();
}
