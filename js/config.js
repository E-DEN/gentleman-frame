// ============================================================
//  config.js — サイト設定
//  フォークや自己ホスト時はこのファイルだけ変更してください
// ============================================================
window.GF_CONFIG = {
  // ローカル開発用プロキシ（node server/proxy.js で起動）
  proxyLocal: 'http://localhost:8788',
  // 本番用 Cloudflare Worker URL
  proxyProd:  'https://gf-proxy.mydn.workers.dev',
};
