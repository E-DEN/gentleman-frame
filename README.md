# Gentleman Frame

いわゆる紳士枠を表示するツール

**<https://gentleman-frame.pages.dev/>**

---

## 機能

### 動画

- **2レイヤー構成**：背景と前景を重ねて表示
- MP4・画像をドロップまたは URL 入力で読み込み。iwara.tv の URL にも対応
- 2本の動画の再生位置をオフセット値に合わせて**自動補正**。オフセットスライダーで任意の時間差を設定可能
- 背景・前景の**入れ替え**、表示/非表示、音量・ミュート調整

### マスク

- 前景動画に重ねる切り抜きエリアを**ドラッグ**で移動・リサイズ
- 形状：**四角 / 円 / ハート**
- ぼかし・ピクセル化・カラー枠線（虹・シアンマゼンタ・桜など**アニメーション**あり）
- **マウス追従モード**でリアルタイムにマスクを動かせる
- マスクホバー中にホイールでサイズ変更

### フィルター（映像全体）

| カテゴリ | 効果 |
| --- | --- |
| 基本補正 | 明るさ・コントラスト・彩度 |
| トーン | ハイライト・シャドウ |
| 特殊 | 色収差・シャープネス |
| 雰囲気 | ビネット・フィルム粒子 |

### プリセット

- 設定を名前付きで**保存・呼び出し**
- フォルダで整理
- **共有コード**（短縮テキスト）または **JSON ファイル**でエクスポート／インポート

> [!WARNING]
> プリセットはブラウザの **localStorage** に保存されています。
> ブラウザのキャッシュ・サイトデータをクリアすると**すべて消えます**。
> 大切なプリセットは定期的にプリセットパネル右上の **↓ ボタン（JSON 保存）** でバックアップしてください。

---

## 使い方

習うより慣れよー。

---

## ショートカット

### キーボード

| キー | 動作 |
| --- | --- |
| `Space` | 再生 / 一時停止 |
| `←` / `→` | 1 秒シーク |
| `Shift` + `←` / `→` | 5 秒シーク |

### マウス（キャンバス上）

| 操作 | 動作 |
| --- | --- |
| 右クリック | マスク追従モード ON / OFF |
| ホイール（追従中 or マスクホバー中） | マスクサイズ変更 |
| ホイールクリック（中ボタン） | 背景・前景入れ替え |
| ダブルクリック | フルスクリーン切替 |

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

### ローカルプロキシの機能

| エンドポイント | 説明 |
| --- | --- |
| `/?url=<URL>` | CORS プロキシ（pximg.net 等） |
| `/pixiv-info?id=<illustId>` | Pixiv 作者名・タイトル取得 |
| `/resolve?url=<iwaraURL>` | iwara 動画 → CDN URL 解決（yt-dlp 使用） |

---

## プライバシー

iwara の URL を入力した場合、動画解決リクエストは [Cloudflare Workers](https://workers.cloudflare.com/) 経由で処理されます。  
Cloudflare のインフラは送信元 IP アドレスおよびアクセス日時を記録することがあります（[Cloudflare プライバシーポリシー](https://www.cloudflare.com/privacypolicy/)）。  
このツール自体がユーザーの個人情報を収集・保存することはありません。

---

## License

[MIT](LICENSE)

---

## バグ報告・機能要望

[GitHub Issues](https://github.com/E-DEN/gentleman-frame/issues/new/choose) からお願いします。
