/**
 * gentle-frame 本番用 CORS プロキシ — Cloudflare Worker
 *
 * 【デプロイ手順】
 * 1. https://dash.cloudflare.com にサインアップ（無料）
 * 2. Workers & Pages → 「アプリケーションを作成」→「Worker を作成」→「Hello World を開始する」
 * 3. 適当な名前を付けて「デプロイ」→「コードを編集」
 * 4. このファイルの内容を全選択して貼り付け → 「保存してデプロイ」
 * 5. 割り当てられた URL（例: https://gf-proxy.your-name.workers.dev）を
 *    app.js の _MY_PROXY 定数に設定する
 *
 * 無料プラン: 100,000 リクエスト/日
 *
 * エンドポイント:
 *   GET /resolve?url=<encoded-iwara-page-url>  → { url, title, author }
 *   GET /?url=<encoded-url>                    → CORS プロキシ (汎用)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_HOSTS = [
  'api.iwara.tv',
  'apiq.iwara.tv',
  'files.iwara.tv',
  'filesq.iwara.tv',
];

// 画像直リン用に追加で許可するホスト（ワイルドカードなし、末尾一致）
const IMAGE_ALLOWED_HOSTS = [
  'i.pximg.net',
  'i-f.pximg.net',
  'cdnw.net',
  'user0514.cdnw.net',
  'imgur.com',
  'i.imgur.com',
];

// Referer が必要なホスト
const REFERER_MAP = {
  'i.pximg.net': 'https://www.pixiv.net/',
  'i-f.pximg.net': 'https://www.pixiv.net/',
};

// SHA-1 hex (Web Crypto API)
async function sha1hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---- iwara API resolver ----

async function resolveIwaraAPI(pageUrl) {
  const m = pageUrl.match(/iwara\.(tv|ai)\/video\/([^/?#]+)/);
  if (!m) throw new Error('Not an iwara video URL');
  const videoId = m[2];

  const metaEndpoints = [
    `https://apiq.iwara.tv/video/${videoId}`,
    `https://api.iwara.tv/video/${videoId}`,
  ];

  let metaRes, differentSiteId;
  for (const endpoint of metaEndpoints) {
    const r = await fetch(endpoint, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
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
    const site = differentSiteId === 'iwara_ai' ? 'iwara.ai' : differentSiteId;
    return { _errResp: jsonResp({ error: 'err-different-site', site }, 500) };
  }
  if (!metaRes) throw new Error('iwara API: no response');
  if (metaRes.status === 403) return { _errResp: jsonResp({ error: 'err-private-video' }, 500) };
  if (metaRes.status !== 200) throw new Error(`iwara API returned ${metaRes.status}`);

  const info = metaRes.data;
  const title  = info.title || videoId;
  const author = info.user?.name || info.user?.username || '';
  const fileUrl = info.fileUrl;
  if (!fileUrl) return { _errResp: jsonResp({ error: 'err-auth-required' }, 500) };

  // Compute X-Version: SHA1("{srcId}_{expires}_{salt}")
  const fu     = new URL(fileUrl.startsWith('//') ? 'https:' + fileUrl : fileUrl);
  const srcId  = (fu.pathname.match(/\/file\/([^/?#]+)/) || fu.pathname.match(/\/([^/]+)\/source/) || [])[1] || videoId;
  const rawExp = fu.searchParams.get('expires') || '';
  const xVer   = await sha1hex(`${srcId}_${rawExp}_mSvL05GfEmeEmsEYfGCnVpEjYgTJraJN`);

  const srcRes = await fetch(fileUrl.startsWith('//') ? 'https:' + fileUrl : fileUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-Version': xVer },
    redirect: 'follow',
  });
  if (!srcRes.ok) throw new Error(`iwara sources API returned ${srcRes.status}`);
  const sources = await srcRes.json();

  const allSources = Array.isArray(sources) ? sources : [];
  const order  = ['Source', '4K', '2160', '1440', '1080', '720', '480', '360', '240'];
  const sorted = allSources
    .filter(s => s.name !== 'preview')
    .sort((a, b) => {
      const ia = order.indexOf(a.name); const ib = order.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  const best = sorted[0];
  const url  = best?.src?.view || best?.src?.download;
  if (!url) throw new Error('No playable URL in iwara sources');

  return { url: url.startsWith('//') ? 'https:' + url : url, title, author };
}

// ---- main handler ----

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);

    // /resolve?url=<page-url>
    if (reqUrl.pathname === '/resolve') {
      const pageUrl = reqUrl.searchParams.get('url');
      if (!pageUrl) return jsonResp({ error: 'Missing ?url=' }, 400);
      try {
        const result = await resolveIwaraAPI(pageUrl);
        if (result._errResp) return result._errResp;
        return jsonResp(result);
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // ---- 汎用 CORS プロキシ (?url=) ----
    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400, headers: CORS_HEADERS });

    let targetUrl;
    try { targetUrl = new URL(target); } catch { return new Response('Invalid URL', { status: 400, headers: CORS_HEADERS }); }

    const allAllowed = [...ALLOWED_HOSTS, ...IMAGE_ALLOWED_HOSTS];
    if (!allAllowed.some(h => targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h))) {
      return new Response(`Host not allowed: ${targetUrl.hostname}`, { status: 403, headers: CORS_HEADERS });
    }

    const forwardHeaders = new Headers();
    const xv = request.headers.get('X-Version');
    if (xv) forwardHeaders.set('X-Version', xv);
    const referer = REFERER_MAP[targetUrl.hostname];
    if (referer) forwardHeaders.set('Referer', referer);
    forwardHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    const res = await fetch(targetUrl.toString(), { headers: forwardHeaders });
    const body = await res.arrayBuffer();

    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  },
};