# Contributing to Gentleman Frame

## アーキテクチャ概要

```text
gentleman-frame/
├── index.html          # フロントエンド（ビルドステップなし）
├── js/
│   ├── app.js          # メインロジック
│   └── i18n.js         # 多言語対応（ja / en / zh）
├── locales/
│   └── ko.json         # 韓国語辞書
├── css/style.css
└── server/
    ├── cors-worker.js  # Cloudflare Worker（本番 CORS プロキシ）
    ├── resolver.mjs    # iwara API リゾルバ（Worker・ローカル共通）
    └── proxy.js        # ローカル開発用プロキシ（Node.js）
```

## インフラ構成

| 役割 | サービス | デプロイ方法 |
| --- | --- | --- |
| フロントエンド配信 | Cloudflare Pages | `main` ブランチへの push で**自動デプロイ** |
| CORS プロキシ / iwara リゾルバ | Cloudflare Worker (`gf-proxy`) | **手動デプロイ**（下記参照） |

### ブランチ運用

- `develop` — 開発ブランチ
- `main` — 本番ブランチ（Cloudflare Pages が自動ビルド）

```bash
git checkout main
git merge develop
git push origin main
git checkout develop
```

## デプロイ手順

### フロントエンド（Pages）

`main` へ push するだけで自動デプロイされます。

### Cloudflare Worker

`server/cors-worker.js` または `server/resolver.mjs` を変更した場合のみ手動デプロイが必要です。

```bash
npx wrangler deploy server/cors-worker.js --name gf-proxy --compatibility-date 2024-01-01
```

> [!NOTE]
> Worker を再デプロイしないと `resolver.mjs` の変更は本番に反映されません。

---

## ローカル開発

### 必要なもの

| ツール | バージョン | 用途 |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | v18 以上（動作確認: v22） | ローカルプロキシサーバー |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 最新推奨 | iwara URL 解決 |
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
| `/resolve?url=<iwaraURL>` | iwara 動画 → CDN URL 解決（yt-dlp 使用） |

---

## 多言語対応（i18n）

新しいキーを追加する場合は **ビルトイン3言語すべて** に追加してください。

| ファイル | 対象言語 |
| --- | --- |
| `js/i18n.js` | `ja` / `en` / `zh` |

`locales/ko.json` は外部言語インポート機能のデモ用サンプルファイルです（ユーザーが独自言語JSONをD&D/インポートする際のフォーマット例）。新キーを追加する際は `ko.json` も合わせて更新することを推奨しますが、必須ではありません。

---

## TODO 管理

小規模なタスクは [GitHub Projects](https://github.com/users/E-DEN/projects/1) でプライベートに管理しています。

### gh CLI でのアイテム操作

```powershell
# アイテム追加
gh project item-create 1 --owner E-DEN --title "タスク名"

# アイテム一覧（ステータス・タイトル・要件を確認）
# ※ PowerShell はエンコーディング設定が必須（設定なしだと文字化けして ConvertFrom-Json が失敗する）
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
gh project item-list 1 --owner E-DEN --format json | ConvertFrom-Json | Select-Object -ExpandProperty items | Format-Table @{L='Status';E={$_.status}},@{L='Title';E={$_.title}},@{L='Body';E={$_.content.body}} -Wrap

# ブラウザで開く
gh project item-list 1 --owner E-DEN --web
```

### ステータス変更（GraphQL 必須）

`gh project` コマンドにはステータス変更がないため、GraphQL API を直接使用する。

```powershell
# 既知の ID（変わらない限り使い回し可）
# projectId : PVT_kwHOADinic4BVy2-
# fieldId   : PVTSSF_lAHOADinic4BVy2-zhRMBbM
# Todo      : f75ad846
# In Progress: 47fc9ee4
# Done      : 98236657
# itemId は item-list で確認（PVTI_... の値）

$q = 'mutation { updateProjectV2ItemFieldValue(input:{projectId:\"PVT_kwHOADinic4BVy2-\", itemId:\"<PVTI_...>\", fieldId:\"PVTSSF_lAHOADinic4BVy2-zhRMBbM\", value:{singleSelectOptionId:\"98236657\"}}) { projectV2Item { id } } }'
gh api graphql -f query=$q
```
