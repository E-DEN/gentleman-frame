/**
 * gentle-frame 本番用 CORS プロキシ — Cloudflare Worker
 *
 * 【デプロイ手順】
 *   npx wrangler deploy server/cors-worker.js --name gf-proxy --compatibility-date 2024-01-01
 *   （wrangler が resolver.mjs を自動バンドルする）
 *
 * 無料プラン: 100,000 リクエスト/日
 *
 * エンドポイント:
 *   GET /resolve?url=<encoded-iwara-page-url>  → { url, title, author }
 *   GET /?url=<encoded-url>                    → CORS プロキシ (汎用 / Referer付き)
 *
 * [!] 共通ロジックは resolver.mjs を編集すること。
 */

import {
  resolveIwaraAPI,
  ALLOWED_HOSTS, IMAGE_ALLOWED_HOSTS, REFERER_MAP,
} from './resolver.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

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
        return jsonResp(result);
      } catch (e) {
        const body = { error: e.code || e.message };
        if (e.site) body.site = e.site;
        return jsonResp(body, 500);
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
    const range = request.headers.get('Range');
    if (range) forwardHeaders.set('Range', range);
    const referer = REFERER_MAP[targetUrl.hostname];
    if (referer) forwardHeaders.set('Referer', referer);
    forwardHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    let res;
    try {
      res = await fetch(targetUrl.toString(), { headers: forwardHeaders });
    } catch (e) {
      return new Response(`Upstream fetch failed: ${e.message}`, { status: 502, headers: CORS_HEADERS });
    }

    const respHeaders = {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    const cl = res.headers.get('Content-Length');
    if (cl) respHeaders['Content-Length'] = cl;
    const ar = res.headers.get('Accept-Ranges');
    if (ar) respHeaders['Accept-Ranges'] = ar;
    const cr = res.headers.get('Content-Range');
    if (cr) respHeaders['Content-Range'] = cr;

    return new Response(res.body, { status: res.status, headers: respHeaders });
  },
};
