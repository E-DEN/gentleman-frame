/**
 * resolver.mjs — 共通リゾルバ・プロキシ設定
 *
 * Cloudflare Workers (cors-worker.js) と Node.js ローカルプロキシ (proxy.js) の
 * 両方で使用する。Web 標準 API (fetch / crypto.subtle) のみ使用。
 *
 * 将来的に他サービスのリゾルバ (resolveXxxAPI) もここに追加する。
 *
 * ⚠️  このファイルを変更した場合は必ず Worker を再デプロイすること:
 *     npx wrangler deploy server/cors-worker.js --name gf-proxy --compatibility-date 2024-01-01
 */

// ---- 許可ホスト (cors-worker.js の CORS プロキシで使用) ----

export const ALLOWED_HOSTS = [
  'api.iwara.tv',
  'apiq.iwara.tv',
  'files.iwara.tv',
  'filesq.iwara.tv',
];

export const IMAGE_ALLOWED_HOSTS = [
  'i.pximg.net',
  'i-f.pximg.net',
  'cdnw.net',
  'user0514.cdnw.net',
  'imgur.com',
  'i.imgur.com',
];

export const REFERER_MAP = {
  'i.pximg.net':   'https://www.pixiv.net/',
  'i-f.pximg.net': 'https://www.pixiv.net/',
};

// ---- SHA-1 hex (Web Crypto API — Node.js 18+ / Workers 両対応) ----

export async function sha1hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- iwara API resolver ----

/**
 * iwara ページ URL → { url, title, author }
 * @param {string} pageUrl   iwara 動画ページ URL
 * @param {string} [accessToken]  Bearer アクセストークン（省略可）
 *
 * 失敗時は Error をスローする。ビジネスエラーは error.code に以下のいずれかが入る:
 *   'err-different-site' — 別サイト (error.site にドメイン)
 *   'err-private-video'  — 非公開動画
 *   'err-auth-required'  — ログインが必要
 */
export async function resolveIwaraAPI(pageUrl, accessToken = '') {
  const m = pageUrl.match(/iwara\.(tv|ai)\/video\/([^/?#]+)/);
  if (!m) throw new Error('Not an iwara video URL');
  const videoId = m[2];

  const authHeader = accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {};

  const metaEndpoints = [
    `https://apiq.iwara.tv/video/${videoId}`,
    `https://api.iwara.tv/video/${videoId}`,
  ];

  let metaRes, differentSiteId;
  for (const endpoint of metaEndpoints) {
    const r = await fetch(endpoint, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', ...authHeader },
      redirect: 'follow',
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) { metaRes = { status: r.status, data }; break; }
    if (data?.message === 'errors.differentSite') {
      differentSiteId = data.siteId;
      continue;
    }
    metaRes = { status: r.status, data };
  }

  if (differentSiteId && metaRes?.status !== 200) {
    const err = new Error('err-different-site');
    err.code = 'err-different-site';
    err.site = differentSiteId === 'iwara_ai' ? 'iwara.ai' : differentSiteId;
    throw err;
  }
  if (!metaRes) throw new Error('iwara API: no response');
  if (metaRes.status === 403) {
    const err = new Error('err-private-video');
    err.code = 'err-private-video';
    throw err;
  }
  if (metaRes.status !== 200) throw new Error(`iwara API returned ${metaRes.status}`);

  const info = metaRes.data;
  const title   = info.title || videoId;
  const author  = info.user?.name || info.user?.username || '';
  const fileUrl = info.fileUrl;
  if (!fileUrl) {
    const err = new Error('err-auth-required');
    err.code = 'err-auth-required';
    throw err;
  }

  // X-Version: SHA1("{srcId}_{expires}_{salt}")
  const fu    = new URL(fileUrl.startsWith('//') ? 'https:' + fileUrl : fileUrl);
  const srcId = (fu.pathname.match(/\/file\/([^/?#]+)/) || fu.pathname.match(/\/([^/]+)\/source/) || [])[1] || videoId;
  const xVer  = await sha1hex(`${srcId}_${fu.searchParams.get('expires') || ''}_mSvL05GfEmeEmsEYfGCnVpEjYgTJraJN`);

  const srcRes = await fetch(fileUrl.startsWith('//') ? 'https:' + fileUrl : fileUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Version': xVer, ...authHeader },
    redirect: 'follow',
  });
  if (!srcRes.ok) throw new Error(`iwara sources API returned ${srcRes.status}`);
  const sources = await srcRes.json();

  const order  = ['Source', '4K', '2160', '1440', '1080', '720', '480', '360', '240'];
  const sorted = (Array.isArray(sources) ? sources : [])
    .filter(s => s.name !== 'preview')
    .sort((a, b) => {
      const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  const best = sorted[0];
  const url  = best?.src?.view || best?.src?.download;
  if (!url) throw new Error('No playable URL in iwara sources');

  return { url: url.startsWith('//') ? 'https:' + url : url, title, author };
}
