/**
 * gentle-frame ローカルプロキシ
 * Iwara ページURL → CDN URL を解決する
 *
 * 起動: node proxy.js
 * 依存: Node.js 18+
 * ポート: 8788
 *
 * エンドポイント:
 *   GET /resolve?url=<encoded-page-url>[&token=<bearer>]  → { url, title, author }
 *
 * 認証: ブラウザ側でログインしたトークンを ?token= で渡す。
 *       サーバー側にパスワード等は一切保存しない。
 */

const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { URL }  = require('url');
const path   = require('path');
const fs     = require('fs');

const PORT = 8788;

// ---------- Iwara direct API resolver ----------

function httpsGetJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        ...extraHeaders,
      },
    };
    const req = https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        console.log(`[iwara-api] redirect ${res.statusCode}: ${parsed.hostname}${parsed.pathname} → ${loc}`);
        // 相対URLを絶対URLに変換
        const absLoc = loc.startsWith('http') ? loc : `https://${parsed.hostname}${loc}`;
        httpsGetJson(absLoc, extraHeaders).then(resolve).catch(reject);
        return;
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          console.log(`[iwara-api] ${res.statusCode} location=${res.headers.location || '(none)'} body=${body.slice(0, 120)}`);
        }
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`JSON parse error (HTTP ${res.statusCode}): ${body.slice(0, 120)}`));
        }
      });
    });
    req.on('error', reject);
  });
}

function httpsPostJson(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...extraHeaders,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error(`JSON parse error (HTTP ${res.statusCode}): ${data.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// リフレッシュトークンをアクセストークンに交換
async function exchangeToken(refreshToken) {
  console.log('[iwara-api] リフレッシュトークンをアクセストークンに交換中...');
  const { status, data } = await httpsPostJson(
    'https://apiq.iwara.tv/user/token',
    {},
    { 'Authorization': `Bearer ${refreshToken}` }
  );
  if (status !== 200 || !data.accessToken) throw new Error(`Token exchange failed (HTTP ${status})`);
  console.log('[iwara-api] アクセストークン取得成功');
  return data.accessToken;
}

// JWTペイロードのtypeを確認
function getTokenType(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.type || '';
  } catch { return ''; }
}

async function resolveIwaraAPI(pageUrl, token = '') {
  const m = pageUrl.match(/iwara\.(tv|ai)\/video\/([^/?#]+)/);
  if (!m) throw new Error('Not an iwara video URL');
  const videoId = m[2];

  // リフレッシュトークンならアクセストークンに交換
  let accessToken = token;
  if (token && getTokenType(token) === 'refresh_token') {
    accessToken = await exchangeToken(token);
  }

  const authHeader = accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {};
  if (accessToken) console.log('[iwara-api] 認証トークンを使用します');

  console.log(`[iwara-api] fetching metadata for ${videoId}`);
  const metaEndpoints = [
    `https://apiq.iwara.tv/video/${videoId}`,
    `https://api.iwara.tv/video/${videoId}`,
  ];
  let metaResult;
  let differentSiteId = null;
  for (const endpoint of metaEndpoints) {
    try {
      metaResult = await httpsGetJson(endpoint, authHeader);
      if (metaResult.status === 200) break;
      if (metaResult.data?.message === 'errors.differentSite') {
        differentSiteId = metaResult.data.siteId;
        console.log(`[iwara-api] ${endpoint} → differentSite(${differentSiteId})`);
        continue;
      }
    } catch (e) {
      console.log(`[iwara-api] ${endpoint} エラー: ${e.message}`);
      continue;
    }
    console.log(`[iwara-api] ${endpoint} returned ${metaResult.status}, trying next...`);
  }
  if (differentSiteId && metaResult?.status !== 200) {
    const site = differentSiteId === 'iwara_ai' ? 'iwara.ai' : differentSiteId;
    const err = new Error('err-different-site');
    err.errorCode = 'err-different-site';
    err.site = site;
    throw err;
  }
  const { status: s1, data: info } = metaResult;
  if (s1 === 403) {
    const err = new Error('err-private-video');
    err.errorCode = 'err-private-video';
    throw err;
  }
  if (s1 !== 200) throw new Error(`iwara API returned ${s1}`);

  const title  = info.title || videoId;
  const author = info.user?.name || info.user?.username || '';
  const fileUrl = info.fileUrl;
  if (!fileUrl) {
    const err = new Error('err-auth-required');
    err.errorCode = 'err-auth-required';
    throw err;
  }

  // Compute X-Version: SHA1("{srcId}_{expires_ms}_{salt}")
  const fu     = new URL(fileUrl.startsWith('//') ? 'https:' + fileUrl : fileUrl);
  const srcId  = (fu.pathname.match(/\/file\/([^/?#]+)/) || fu.pathname.match(/\/([^/]+)\/source/) || [])[1] || videoId;
  const rawExp = fu.searchParams.get('expires') || '';
  // New salt (as of 2025+); expires used as-is (milliseconds for filesq)
  const xVer   = crypto.createHash('sha1').update(`${srcId}_${rawExp}_mSvL05GfEmeEmsEYfGCnVpEjYgTJraJN`).digest('hex');

  console.log(`[iwara-api] fetching sources (X-Version: ${xVer.slice(0, 12)}...)`);
  const { status: s2, data: sources } = await httpsGetJson(fileUrl, { 'X-Version': xVer, ...authHeader });
  if (s2 !== 200) throw new Error(`iwara sources API returned ${s2}`);

  const allSources = Array.isArray(sources) ? sources : [];
  console.log(`[iwara-api] available qualities: ${allSources.map(s => s.name).join(', ')}`);

  // Pick highest quality (exclude 'preview')
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

  // Wrap protocol-relative URLs
  const finalUrl = url.startsWith('//') ? 'https:' + url : url;
  console.log(`[iwara-api] resolved (${best.name}) → ${finalUrl.slice(0, 80)}...`);
  return { url: finalUrl, title, author };
}

// ---------- yt-dlp fallback (non-iwara) ----------

function resolveWithYtDlp(pageUrl) {
  return new Promise((resolve, reject) => {
    const cookiesFile = path.join(__dirname, 'cookies.txt');
    // execFile でシェル経由を回避し、コマンドインジェクションを防ぐ
    const args = ['-j', '--no-playlist', '--no-warnings'];
    if (fs.existsSync(cookiesFile)) args.push('--cookies', cookiesFile);
    args.push(pageUrl);
    console.log(`[yt-dlp] yt-dlp ${args.join(' ')}`);
    execFile('yt-dlp', args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        // stderr の最初の意味ある行をエラーとして返す
        const detail = stderr.split('\n').map(l => l.trim()).filter(l => l.startsWith('ERROR:'))[0]
          || stderr.trim().split('\n')[0]
          || err.message.split('\n')[0];
        console.error(`[yt-dlp] ${detail}`);
        reject(new Error(detail));
        return;
      }
      let info;
      try {
        // -j は複数エントリを改行区切りで出力するため最初のエントリを使用
        info = JSON.parse(stdout.trim().split('\n')[0]);
      } catch (e) {
        reject(new Error('yt-dlp: JSON parse error'));
        return;
      }
      const title = info.title || pageUrl;
      // requested_formats がある場合は映像+音声が別ストリームになるため動画単体の url を優先
      const url = info.url || (info.formats || []).slice(-1)[0]?.url;
      if (!url) {
        reject(new Error('yt-dlp: URL取得失敗'));
        return;
      }
      console.log(`[yt-dlp] resolved "${title}" → ${url.slice(0, 80)}...`);
      resolve({ url, title });
    });
  });
}

async function resolveUrl(pageUrl, token = '') {
  if (/iwara\.(tv|ai)\/video\//i.test(pageUrl)) {
    return resolveIwaraAPI(pageUrl, token);
  }
  return resolveWithYtDlp(pageUrl);
}

const server = http.createServer(async (req, res) => {
  // トークンをログに出力しない
  const logUrl = req.url.replace(/([?&]token=)[^&]*/i, '$1***');
  console.log(`[${req.method}] ${logUrl}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === '/resolve') {
    const pageUrl = reqUrl.searchParams.get('url');
    if (!pageUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
      return;
    }
    const token = reqUrl.searchParams.get('token') || '';
    try {
      const result = await resolveUrl(pageUrl, token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      const body = { error: e.errorCode || e.message };
      if (e.site) body.site = e.site;
      res.end(JSON.stringify(body));
    }
    return;
  }

  if (reqUrl.pathname === '/stream') {
    const target = reqUrl.searchParams.get('url');
    if (!target) { res.writeHead(400); res.end('Missing ?url='); return; }
    // Only allow iwara CDN hosts
    const targetUrl = new URL(target.startsWith('//') ? 'https:' + target : target);
    if (!/\.(iwara\.tv|iwara\.app)$/.test(targetUrl.hostname)) { res.writeHead(403); res.end('Forbidden'); return; }

    function streamFrom(urlStr) {
      const u = new URL(urlStr.startsWith('//') ? 'https:' + urlStr : urlStr);
      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {}),
        },
      };
      https.get(opts, (upstream) => {
        console.log(`[stream] ${u.hostname} → ${upstream.statusCode} (${upstream.headers['content-type']}, len=${upstream.headers['content-length'] || '?'})`);
        if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
          upstream.resume();
          streamFrom(upstream.headers.location);
          return;
        }
        const headers = {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': upstream.headers['content-type'] || 'video/mp4',
          'Accept-Ranges': 'bytes',
        };
        if (upstream.headers['content-length']) headers['Content-Length'] = upstream.headers['content-length'];
        if (upstream.headers['content-range'])  headers['Content-Range']  = upstream.headers['content-range'];
        res.writeHead(upstream.statusCode, headers);
        upstream.pipe(res);
      }).on('error', (e) => { console.error(`[stream] error: ${e.message}`); res.writeHead(502); res.end(e.message); });
    }
    streamFrom(target);
    return;
  }

  // ---- Pixiv illust info (/pixiv-info?id=) ----
  if (reqUrl.pathname === '/pixiv-info') {
    const illustId = reqUrl.searchParams.get('id');
    if (!illustId || !/^\d+$/.test(illustId)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing or invalid ?id=' })); return;
    }
    const apiUrl = `https://www.pixiv.net/ajax/illust/${illustId}`;
    const opts = {
      hostname: 'www.pixiv.net',
      path: `/ajax/illust/${illustId}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.pixiv.net/',
        'Accept': 'application/json',
      },
    };
    https.get(opts, (upstream) => {
      let body = '';
      upstream.on('data', chunk => { body += chunk; });
      upstream.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: data.message || 'Not found' })); return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600' });
          res.end(JSON.stringify({ title: data.body?.title || '', author: data.body?.userName || '' }));
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    }).on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // ---- 汎用 CORS プロキシ (?url=) ----
  const genericTarget = reqUrl.searchParams.get('url');
  if (reqUrl.pathname === '/' && genericTarget) {
    let targetUrl;
    try { targetUrl = new URL(genericTarget); } catch {
      res.writeHead(400); res.end('Invalid URL'); return;
    }
    const REFERER_MAP = {
      'i.pximg.net': 'https://www.pixiv.net/',
      'i-f.pximg.net': 'https://www.pixiv.net/',
    };
    const referer = REFERER_MAP[targetUrl.hostname];
    const opts = {
      hostname: targetUrl.hostname,
      path: targetUrl.pathname + targetUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(referer ? { 'Referer': referer } : {}),
      },
    };
    https.get(opts, (upstream) => {
      if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
        upstream.resume();
        res.writeHead(upstream.statusCode, { 'Location': upstream.headers.location, 'Access-Control-Allow-Origin': '*' });
        res.end(); return;
      }
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      };
      if (upstream.headers['content-length']) headers['Content-Length'] = upstream.headers['content-length'];
      res.writeHead(upstream.statusCode, headers);
      upstream.pipe(res);
    }).on('error', (e) => { res.writeHead(502); res.end(e.message); });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`gentle-frame proxy running at http://localhost:${PORT}`);
  console.log('  GET /resolve?url=<encoded-url>[&token=<bearer>]');
});

// EOF
