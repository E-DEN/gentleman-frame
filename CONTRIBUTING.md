# Contributing to Gentleman Frame

## アーキテクチャ概要

```text
gentleman-frame/
├── index.html          # フロントエンド（ビルドステップなし）
├── css/
│   └── style.css
├── js/
│   ├── app.js          # エントリーポイント・初期化
│   ├── canvas.js       # DOM要素・メディア変数（loaded / mediaType / vid）+ マスク操作
│   ├── config.js       # window.GF_CONFIG（proxyLocal / proxyProd）
│   ├── controls.js     # スライダー・ボタン・FQPプリセット・シェイプ・スワップ
│   ├── drag.js         # マスクドラッグ・ヒットテスト・追従モード
│   ├── i18n.js         # 多言語対応（ja / en / zh）
│   ├── lang.js         # 言語切り替え・テーマ（applyLang / rebuildLangDialog）
│   ├── media.js        # 動画ロード・プロキシURL
│   ├── playback.js     # 再生/停止/シーク（syncPlay / syncPause / syncStop）
│   ├── presets.js      # プリセット CRUD・エクスポート/インポート
│   ├── rain.js         # WebGL 雨エフェクト（Codrops ベース IIFE）
│   ├── render.js       # 描画ループ・Canvas フィルター・スマホ枠
│   ├── sortable.js     # プリセットリスト ドラッグ並び替え
│   ├── spectrum.js     # スペクトラムアナライザー描画
│   └── state.js        # グローバル状態（state / _animColors 等）
├── locales/
│   └── ko.json         # 外部言語インポート機能のデモ用サンプル（韓国語）
└── server/
    ├── cors-worker.js  # Cloudflare Worker（本番 CORS プロキシ）
    ├── resolver.mjs    # iwara API リゾルバ（Worker・ローカル共通）
    └── proxy.js        # ローカル開発用プロキシ（Node.js）
```

## インフラ構成

| 役割 | サービス | デプロイ方法 |
| --- | --- | --- |
| フロントエンド配信 | Cloudflare Pages | `main` ブランチへの push で自動デプロイ |
| CORS プロキシ / iwara リゾルバ | Cloudflare Worker | `server/cors-worker.js` / `resolver.mjs` 変更時のみ手動デプロイ |

### ブランチ運用

- `develop` — 開発ブランチ
- `main` — 本番ブランチ（Cloudflare Pages が自動ビルド）

```bash
git checkout main
git merge develop
git push origin main
git checkout develop
git push origin develop
```

---

## ローカル開発

### 必要なもの

| ツール | バージョン | 用途 |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | v18 以上（動作確認: v22） | ローカルプロキシサーバー |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 最新推奨 | iwara 以外の URL 解決 |
| VS Code [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) 等 | - | フロントエンド配信 |

> 外部 npm パッケージは不要です（Node.js 標準モジュールのみ使用）。

### 起動手順

```bash
# 1. ローカルプロキシを起動（ポート 8788）
node server/proxy.js

# 2. index.html を Live Server などで開く
#    → http://127.0.0.1:5500/index.html 等
```

`localhost` または `127.0.0.1` でアクセスすると、プロキシ URL が自動でローカル（`http://localhost:8788`）に切り替わります。本番（`gentleman-frame.pages.dev`）では Cloudflare Worker が使われます。

### ローカルプロキシのエンドポイント

| エンドポイント | 説明 |
| --- | --- |
| `/?url=<URL>` | CORS プロキシ（pximg.net 等） |
| `/pixiv-info?id=<illustId>` | Pixiv 作者名・タイトル取得 |
| `/resolve?url=<iwaraURL>` | iwara 動画 → CDN URL 解決 |

---

## コーディング規約

- セクション区切り: `// --- 説明 ---`（ダッシュ3本・前後スペースあり）
- `//` の後にスペース1個
- 連続空行は最大1行（2行以上禁止）
- `var` 禁止（`const` / `let` のみ）。`rain.js` はレガシーコードのため例外
- ソースコードに絵文字禁止（i18n 文字列も含む）
- `title` 属性は必ず `data-i18n-title="キー名"` を使う。ハードコードは不可

### インポート上の注意

- `loaded` / `mediaType` / `vid` は `state.js` ではなく **`canvas.js`** からインポートする
- トースト表示は `_presetStatusMsg()` を使う

---

## 多言語対応（i18n）

新しいキーを追加する場合は **ビルトイン3言語すべて** に追加してください。

| ファイル | 対象言語 |
| --- | --- |
| `js/i18n.js` | `ja` / `en` / `zh` |

`locales/ko.json` は外部言語インポート機能のデモ用サンプルファイルです（ユーザーが独自言語 JSON を D&D/インポートする際のフォーマット例）。新キーを追加する際は `ko.json` も合わせて更新することを推奨しますが、必須ではありません。

---
