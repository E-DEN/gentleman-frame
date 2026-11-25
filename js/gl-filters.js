// gl-filters.js — フィルター（色収差〜カラーフレア）の WebGL2 版
//
// render.js の _applyFilters2D と同じ順序・同じ計算を GPU のシェーダーで行う。
// 2D Canvas 版はフィルター 1 つごとに 4K 全面の合成を数回ずつ繰り返すため、重ねるほど重くなる。
// こちらは「周囲の画素を読む処理」（色収差・にじみ・鉛筆・エンボス・黒板・エアブラシ）ごとに 1 パスにまとめ、
// 画素ごとに完結する処理（色補正・ビネット・グレインなど）はそのパスに相乗りさせる。
//
// 画像は「0 行目 = キャンバスの上端」の向きでテクスチャに持ち、最後のキャンバス出力でだけ上下を反転する。
// 途中のテクスチャは 2D 版と同じく 8bit（RGBA8）で、非 premultiplied（ぼかし用の中間だけ premultiplied）。

// --- 処理の番号（2D 版の実行順） ---
const OP = {
  CA: 0, HL: 1, SH: 2, VIG: 3, TEMP: 4, TINT: 5, MATTE: 6, GRAIN: 7,
  BLOOM1: 8, BLOOM2: 9, SHARP: 10, PENCIL: 11, EMBOSS: 12, CHALK: 13, NIGHT: 14, AIR: 15, FLARE: 16,
};
// 周囲の画素（またはぼかし済み画像）を読むため、直前までの結果が全面そろっている必要がある処理。パスの先頭に置く
const NEIGHBOR_OPS = new Set([OP.CA, OP.BLOOM1, OP.BLOOM2, OP.PENCIL, OP.EMBOSS, OP.CHALK, OP.AIR]);
// state.filterMaskOnly のキー（OP の番号順）
const MASK_ONLY_KEYS = [
  'ca', 'highlight', 'shadow', 'vignette', 'temp', 'tint', 'matte', 'grain',
  'bloom', 'bloom', 'sharpness', 'pencil', 'emboss', 'chalkboard', 'nightvision', 'airbrush', 'flare',
];
// Skia（Chrome の 2D 描画）と同じく、σ がこれを超えるぼかしは 1/2 ずつ縮小した画像にかける
const MAX_SIGMA = 4;
const MAX_BLUR_R = MAX_SIGMA * 3; // ぼかしの片側のタップ数の上限（3σ）

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// --- メインのシェーダー ---
// uFirst の処理（近傍を読む処理ならここで行う）から、uEnd 未満の画素ごとの処理までを順に行う
const FS_MAIN = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform sampler2D uGrain;
uniform sampler2D uBlur;
uniform sampler2D uMask;
uniform vec2  uSize;
uniform int   uFirst;
uniform int   uEnd;
uniform int   uOn;
uniform int   uMO;
uniform bool  uFlip;
uniform vec4  uMaskRect;
uniform vec2  uMaskUV;
uniform float uCaS;
uniform vec2  uHl;
uniform vec2  uSh;
uniform vec4  uVig;
uniform float uVigA;
uniform vec4  uTemp;
uniform vec4  uTint;
uniform vec2  uMatte;
uniform float uBloomA;
uniform float uSharp;
uniform vec3  uPencil;
uniform vec2  uEmboss;
uniform vec3  uChalk;
uniform vec4  uNight;
uniform float uNightLh;
uniform float uAirA;
uniform float uFlareA;
out vec4 outColor;

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
vec3 cl(vec3 c) { return clamp(c, 0.0, 1.0); }
vec3 grayF(vec3 c) { return vec3(dot(c, LUM)); }
vec3 contrastF(vec3 c, float k) { return c * k + (0.5 - 0.5 * k); }
vec3 screenB(vec3 b, vec3 s) { return b + s - b * s; }
vec3 overlayB(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
}
float softD(float x) { return x <= 0.25 ? ((16.0 * x - 12.0) * x + 4.0) * x : sqrt(x); }

bool on(int k)  { return ((uOn >> k) & 1) == 1; }
bool run(int k) { return on(k) && k >= uFirst && k < uEnd; }
bool inb(ivec2 q) { return q.x >= 0 && q.y >= 0 && q.x < int(uSize.x) && q.y < int(uSize.y); }
vec3 F(ivec2 q) { return texelFetch(uSrc, q, 0).rgb; }

float maskAt(vec2 p) {
  vec2 r = (p - uMaskRect.xy) / uMaskRect.zw;
  if (r.x < 0.0 || r.y < 0.0 || r.x >= 1.0 || r.y >= 1.0) return 0.0;
  return texture(uMask, r * uMaskUV).a;
}

const vec3 FLARE_C[6] = vec3[6](
  vec3(255.0, 0.0, 80.0) / 255.0, vec3(255.0, 120.0, 0.0) / 255.0, vec3(255.0, 240.0, 0.0) / 255.0,
  vec3(0.0, 220.0, 80.0) / 255.0, vec3(0.0, 120.0, 255.0) / 255.0, vec3(160.0, 0.0, 255.0) / 255.0);

void main() {
  vec2 p = uFlip ? vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) : gl_FragCoord.xy;
  ivec2 ip = ivec2(p);
  vec4 s = texelFetch(uSrc, ip, 0);
  vec3 c = s.rgb;
  float mk = uMO != 0 ? maskAt(p) : 0.0;
  vec3 r;
  #define APPLY(k) c = ((uMO >> (k)) & 1) == 1 ? mix(c, r, mk) : r

  // --- 近傍を読む処理（パスの先頭のみ） ---
  if (uFirst == 0 && on(0)) {
    // 色収差: 赤は拡大、青は縮小、緑は等倍。縮小した青は等倍の青の上に重ね、縁は
    // 「画像の外を透明として補間した不透明度 × 描画範囲の被覆率」で混ぜる（2D 版との差は縁の 1px だけ）
    vec2 ctr = uSize * 0.5;
    vec2 qr = ctr + (p - ctr) / (1.0 + uCaS);
    vec2 qb = ctr + (p - ctr) / (1.0 - uCaS);
    vec2 inside = clamp(min(qb + 0.5, uSize) - max(qb - 0.5, vec2(0.0)), 0.0, 1.0);
    vec2 lo = ctr * uCaS, hi = ctr + (uSize - ctr) * (1.0 - uCaS);
    vec2 cov = clamp(min(p + 0.5, hi) - max(p - 0.5, lo), 0.0, 1.0);
    float b = mix(c.b, texture(uSrc, qb / uSize).b, inside.x * inside.y * cov.x * cov.y);
    r = vec3(texture(uSrc, qr / uSize).r, c.g, b);
    APPLY(0);
  } else if ((uFirst == 8 || uFirst == 9) && on(uFirst)) {
    // にじみ: 1 回目はぼかし+彩度のコピーを通常合成、2 回目は軽いぼかしのコピーを乗算（いずれも premultiplied）
    vec4 bl = texture(uBlur, p / uSize);
    if (uFirst == 8) { r = c * (1.0 - uBloomA * bl.a) + uBloomA * bl.rgb; APPLY(8); }
    else             { r = c * (1.0 - uBloomA * bl.a + uBloomA * bl.rgb); APPLY(9); }
  } else if (uFirst == 11 && on(11)) {
    // 鉛筆: ずらした自分との差分 → グレー化・明るさ・コントラスト・反転 → 乗算
    ivec2 q = ip - ivec2(int(uPencil.x));
    vec3 post = inb(q) ? abs(c - F(q)) : c;
    vec3 g = cl(grayF(post)); g = cl(g * 3.0); g = cl(contrastF(g, uPencil.y)); g = 1.0 - g;
    r = mix(c, c * g, uPencil.z);
    APPLY(11);
  } else if (uFirst == 12 && on(12)) {
    // エンボス: 右下にずらした自分をスクリーン、左上にずらした自分との差分 → 明るさ・反転・グレー化
    int off = int(uEmboss.x);
    vec3 post = c;
    ivec2 q1 = ip - ivec2(off); if (inb(q1)) post = screenB(post, F(q1));
    ivec2 q2 = ip + ivec2(off); if (inb(q2)) post = abs(post - F(q2));
    vec3 g = cl(post * 2.0); g = 1.0 - g; g = grayF(g);
    r = mix(c, g, uEmboss.y);
    APPLY(12);
  } else if (uFirst == 13 && on(13)) {
    // 黒板: ずらした自分との差分 → グレー化・明るさ
    ivec2 q = ip - ivec2(int(uChalk.x));
    vec3 post = inb(q) ? abs(c - F(q)) : c;
    vec3 g = cl(grayF(post)); g = cl(g * uChalk.y);
    r = mix(c, g, uChalk.z);
    APPLY(13);
  } else if (uFirst == 15 && on(15)) {
    // エアブラシ: 明るさ・彩度・ぼかし・コントラスト済みのコピー（premultiplied）を乗算
    vec4 bl = texture(uBlur, p / uSize);
    r = c * (1.0 - uAirA * bl.a + uAirA * bl.rgb);
    APPLY(15);
  }

  // --- 画素ごとの処理 ---
  if (run(1)) {
    // ハイライト: 明るく = 白のソフトライト、暗く = グレーの乗算
    if (uHl.x > 0.0) r = mix(c, vec3(softD(c.r), softD(c.g), softD(c.b)), uHl.y);
    else             r = c * uHl.y;
    APPLY(1);
  }
  if (run(2)) {
    // シャドウ: 明るく = グレーのスクリーン、暗く = 黒のソフトライト
    if (uSh.x > 0.0) r = screenB(c, vec3(uSh.y));
    else             r = mix(c, c * c, uSh.y);
    APPLY(2);
  }
  if (run(3)) {
    float t = clamp((distance(p, uVig.xy) - uVig.z) / (uVig.w - uVig.z), 0.0, 1.0);
    r = c * (1.0 - uVigA * t);
    APPLY(3);
  }
  if (run(4)) { r = mix(c, uTemp.rgb, uTemp.a); APPLY(4); }
  if (run(5)) { r = mix(c, uTint.rgb, uTint.a); APPLY(5); }
  if (run(6)) { r = screenB(c, vec3(uMatte.x)) * uMatte.y; APPLY(6); }
  if (run(7)) { r = overlayB(c, texture(uGrain, p / uSize).rgb); APPLY(7); }
  if (run(10)) { r = mix(c, overlayB(c, c), uSharp); APPLY(10); }
  if (run(14)) {
    // 暗視: グレー化・明るさ・コントラスト → 緑を乗算 → 走査線
    vec3 v = cl(grayF(c)); v = cl(v * uNight.x); v = cl(contrastF(v, uNight.y));
    vec3 ch = vec3(0.0, v.g, v.b * (60.0 / 255.0));
    if ((int(floor(p.y / uNightLh)) & 1) == 0) ch *= 1.0 - uNight.w;
    r = mix(c, ch, uNight.z);
    APPLY(14);
  }
  if (run(16)) {
    // カラーフレア: 左上→右下の虹色グラデーションをスクリーン
    float t = clamp(dot(p, uSize) / dot(uSize, uSize), 0.0, 1.0) * 5.0;
    int i = int(min(floor(t), 4.0));
    r = mix(c, screenB(c, mix(FLARE_C[i], FLARE_C[i + 1], t - float(i))), uFlareA);
    APPLY(16);
  }

  c = cl(c);
  outColor = uFlip ? vec4(c * s.a, s.a) : vec4(c, s.a);
}`;

// --- ぼかし（ガウス、縦横に分けて 2 パス） ---
// CSS の blur() と同じく、画像の外は透明として扱う（端は半透明になる）。出力は premultiplied。
// uPre: ぼかす前に掛ける処理（エアブラシの明るさ・彩度）、uPost: ぼかした後の処理（にじみの彩度・エアブラシのコントラスト）
// uBox > 0: 入力を uBox×uBox 画素ごとに平均して縮小する（uPre は縮小前の各画素に掛ける）
const FS_BLUR = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec2  uDst;
uniform vec2  uSrcSize;
uniform vec2  uScale;
uniform ivec2 uDir;
uniform int   uR;
uniform float uW[${MAX_BLUR_R + 1}];
uniform bool  uPremulIn;
uniform int   uBox;
uniform int   uPre;
uniform vec2  uPreP;
uniform int   uPost;
uniform float uPostP;
out vec4 outColor;

vec3 saturateF(vec3 c, float s) {
  return vec3(
    (0.213 + 0.787 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 - 0.072 * s) * c.b,
    (0.213 - 0.213 * s) * c.r + (0.715 + 0.285 * s) * c.g + (0.072 - 0.072 * s) * c.b,
    (0.213 - 0.213 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 + 0.928 * s) * c.b);
}
vec4 prep(vec4 s) {
  if (uPre == 1) {
    s.rgb = clamp(s.rgb * uPreP.x, 0.0, 1.0);
    s.rgb = clamp(saturateF(s.rgb, uPreP.y), 0.0, 1.0);
  }
  if (!uPremulIn) s.rgb *= s.a;
  return s;
}
vec4 tap(vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x >= uDst.x || q.y >= uDst.y) return vec4(0.0);
  if (uBox > 0) {
    ivec2 base = ivec2(floor(q)) * uBox;
    ivec2 mx = ivec2(uSrcSize) - 1;
    vec4 sum = vec4(0.0);
    for (int y = 0; y < 4; y++) {
      if (y >= uBox) break;
      for (int x = 0; x < 4; x++) {
        if (x >= uBox) break;
        sum += prep(texelFetch(uSrc, min(base + ivec2(x, y), mx), 0));
      }
    }
    return sum / float(uBox * uBox);
  }
  return prep(texture(uSrc, q * uScale / uSrcSize));
}
void main() {
  vec2 q = gl_FragCoord.xy;
  vec2 d = vec2(uDir);
  vec4 sum = tap(q) * uW[0];
  for (int i = 1; i <= ${MAX_BLUR_R}; i++) {
    if (i > uR) break;
    sum += (tap(q + d * float(i)) + tap(q - d * float(i))) * uW[i];
  }
  if (uPost != 0 && sum.a > 0.0) {
    vec3 c = sum.rgb / sum.a;
    c = uPost == 1 ? saturateF(c, uPostP) : c * uPostP + (0.5 - 0.5 * uPostP);
    sum.rgb = clamp(c, 0.0, 1.0) * sum.a;
  }
  outColor = sum;
}`;

let _gl = null;
let _cvs = null;
let _broken = false;
let _announced = false;
let _lost = false;
let _res = null; // GPU 資源（コンテキスト喪失時に作り直す）

function _compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function _program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, _compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, _compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}
function _newTex(gl, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
// 描画先テクスチャ（サイズが変わった時だけ作り直す）
function _target(gl, slot, w, h) {
  const r = _res.targets[slot];
  if (r && r.w === w && r.h === h) return r;
  if (r) { gl.deleteFramebuffer(r.fbo); gl.deleteTexture(r.tex); }
  const tex = _newTex(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return (_res.targets[slot] = { tex, fbo, w, h });
}

function _init() {
  if (_gl || _broken) return !!_gl;
  try {
    _cvs = document.createElement('canvas');
    const gl = _cvs.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) { _broken = true; return false; }
    _cvs.addEventListener('webglcontextlost', e => { e.preventDefault(); _lost = true; _res = null; });
    _cvs.addEventListener('webglcontextrestored', () => { _lost = false; });
    _gl = gl;
    return true;
  } catch (e) {
    console.warn('[gl-filters] WebGL2 を初期化できないため 2D 版を使います', e);
    _broken = true;
    return false;
  }
}
function _initResources(gl) {
  const main = _program(gl, FS_MAIN);
  const blur = _program(gl, FS_BLUR);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  _res = {
    main, blur, vao,
    src: _newTex(gl, gl.LINEAR),
    grain: _newTex(gl, gl.LINEAR),
    mask: _newTex(gl, gl.LINEAR),
    dummy: _newTex(gl, gl.NEAREST),
    targets: {},
  };
  // 使わないサンプラーが未完成のテクスチャを指さないよう、1×1 で初期化しておく
  for (const t of [_res.src, _res.grain, _res.mask, _res.dummy]) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
}

// 最初にフィルターを使う前にシェーダーのコンパイル・リンクを済ませておく。
// 初回の描画で行うと、数十〜数百 ms 止まってコマ落ちになる（小さな描画先に 1 回描いて確定させる）
export function warmUpFiltersGL() {
  if (!_init() || _lost) return;
  const gl = _gl;
  try {
    if (gl.isContextLost()) return;
    if (!_res) _initResources(gl);
    if (_res.warmed) return;
    gl.bindVertexArray(_res.vao);
    const t = _target(gl, 'warm', 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, 1, 1);
    for (let i = 0; i < 4; i++) _bindTex(gl, i, _res.dummy);
    for (const prog of [_res.main, _res.blur]) {
      gl.useProgram(prog.p);
      if (prog.u.uSize) gl.uniform2f(prog.u.uSize, 1, 1);
      if (prog.u.uDst) gl.uniform2f(prog.u.uDst, 1, 1);
      if (prog.u.uSrcSize) gl.uniform2f(prog.u.uSrcSize, 1, 1);
      if (prog.u.uScale) gl.uniform2f(prog.u.uScale, 1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // 実行の完了まで待つ
    _res.warmed = true;
  } catch (e) {
    console.warn('[gl-filters] 事前準備に失敗したため 2D 版を使います', e);
    _broken = true;
  }
}

function _gauss(sigma) {
  const r = Math.min(MAX_BLUR_R, Math.ceil(sigma * 3));
  const w = new Float32Array(MAX_BLUR_R + 1);
  if (r === 0 || sigma <= 0) { w[0] = 1; return { r: 0, w }; }
  let sum = 0;
  for (let i = 0; i <= r; i++) { w[i] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += i ? w[i] * 2 : w[i]; }
  for (let i = 0; i <= r; i++) w[i] /= sum;
  return { r, w };
}
function _bindTex(gl, unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

// ぼかし 2 パス（横 → 縦）。src を dw×dh（σ が大きいときはさらに 1/2 ずつ）に縮小しながらぼかす。
// 縮小前の各画素に処理（opt.pre）が要るときは、縮小と下ごしらえだけの 1 パスを先に行い、
// ぼかしのタップ側で画素ごとの処理を繰り返さない（タップ数 × 画素数の計算が消えて約 10 倍軽い）
function _blur(gl, srcTex, srcW, srcH, dw, dh, sigma, slotA, slotB, opt = {}) {
  let s = 1;
  while (sigma / s > MAX_SIGMA) s *= 2;
  dw = Math.ceil(dw / s); dh = Math.ceil(dh / s);
  const { p, u } = _res.blur;
  gl.useProgram(p);
  const { r, w } = _gauss(sigma / s);
  const one = new Float32Array(MAX_BLUR_R + 1); one[0] = 1;
  gl.uniform1i(u.uSrc, 0);
  gl.uniform2f(u.uDst, dw, dh);
  gl.viewport(0, 0, dw, dh);
  const pass = (tex, tw, th, target, dir, premulIn, box, pre, post, rr, ww) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    _bindTex(gl, 0, tex);
    gl.uniform1i(u.uR, rr);
    gl.uniform1fv(u.uW, ww);
    gl.uniform2f(u.uSrcSize, tw, th);
    gl.uniform2f(u.uScale, tw / dw, th / dh);
    gl.uniform2i(u.uDir, dir[0], dir[1]);
    gl.uniform1i(u.uPremulIn, premulIn ? 1 : 0);
    gl.uniform1i(u.uBox, box);
    gl.uniform1i(u.uPre, pre ? 1 : 0);
    gl.uniform2f(u.uPreP, pre ? pre[0] : 1, pre ? pre[1] : 1);
    gl.uniform1i(u.uPost, post ? post[0] : 0);
    gl.uniform1f(u.uPostP, post ? post[1] : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return target.tex;
  };
  let tex = srcTex, tw = srcW, th = srcH, premul = false;
  if (opt.pre && s > 1) {
    tex = pass(tex, tw, th, _target(gl, slotA + 'p', dw, dh), [1, 0], false, s, opt.pre, null, 0, one);
    tw = dw; th = dh; premul = true;
  }
  const a = _target(gl, slotA, dw, dh);
  const tHoriz = pass(tex, tw, th, a, [1, 0], premul, 0, premul ? null : opt.pre, null, r, w);
  return pass(tHoriz, dw, dh, _target(gl, slotB, dw, dh), [0, 1], true, 0, null, opt.post, r, w);
}

// --- パラメータ（2D 版と同じ式） ---
function _params(A, W, H, m) {
  const P = { on: 0, mo: 0 };
  const set = (k, v) => { if (v) P.on |= 1 << k; };
  set(OP.CA, A.ca > 0); P.caS = A.ca * 0.002;
  if (A.hl !== 0) {
    set(OP.HL, true);
    const t = Math.abs(A.hl) / 100;
    P.hl = A.hl > 0 ? [1, t * 0.60] : [-1, Math.round(255 - t * 55) / 255];
  }
  if (A.sh !== 0) {
    set(OP.SH, true);
    const t = Math.abs(A.sh) / 100;
    P.sh = A.sh > 0 ? [1, Math.round(t * 72) / 255] : [-1, t * 0.60];
  }
  if (A.vig > 0) {
    set(OP.VIG, true);
    const fo = A.mo.vignette;
    const cx = W / 2, cy = H / 2;
    P.vig = [
      fo ? m.x + m.w / 2 : cx,
      fo ? m.y + m.h / 2 : cy,
      fo ? Math.min(m.w, m.h) * 0.30 : Math.min(W, H) * 0.30,
      fo ? Math.sqrt((m.w / 2) ** 2 + (m.h / 2) ** 2) * 1.10 : Math.sqrt(cx * cx + cy * cy) * 1.10,
    ];
    P.vigA = (A.vig / 10) * 0.85;
  }
  if (A.temp !== 0) {
    set(OP.TEMP, true);
    const a = 0.22 * Math.abs(A.temp) / 50;
    P.temp = A.temp > 0 ? [1, 140 / 255, 0, a] : [20 / 255, 80 / 255, 1, a];
  }
  if (A.tint !== 0) {
    set(OP.TINT, true);
    const a = 0.14 * Math.abs(A.tint) / 50;
    P.tint = A.tint > 0 ? [0, 210 / 255, 60 / 255, a] : [1, 0, 200 / 255, a];
  }
  if (A.matte > 0) {
    set(OP.MATTE, true);
    const t = A.matte / 10;
    P.matte = [Math.round(t * 50) / 255, Math.round(255 - t * 45) / 255];
  }
  set(OP.GRAIN, A.grain > 0);
  if (A.bloom > 0) {
    set(OP.BLOOM1, true); set(OP.BLOOM2, true);
    const t = A.bloom / 10;
    // 4K 級では半解像度でぼかす（2D 版と同じ条件）
    const k = W * H > 2.2e6 ? 0.5 : 1;
    P.bloom = { t, k, sw: Math.ceil(W * k), sh: Math.ceil(H * k) };
  }
  if (A.sharp > 0) { set(OP.SHARP, true); P.sharp = Math.min(A.sharp * 0.09, 0.85); }
  if (A.pencil > 0) {
    set(OP.PENCIL, true);
    const t = A.pencil / 10;
    P.pencil = [Math.max(1, Math.round(1 + t * 3)), 4 + t * 8, 0.7 + t * 0.3];
  }
  if (A.emboss > 0) {
    set(OP.EMBOSS, true);
    const t = A.emboss / 10;
    P.emboss = [Math.round(1 + t * 2), t];
  }
  if (A.chalk > 0) {
    set(OP.CHALK, true);
    const t = A.chalk / 10;
    P.chalk = [Math.round(1 + t * 2), 1.5 + t * 0.5, t];
  }
  if (A.night > 0) {
    set(OP.NIGHT, true);
    const t = A.night / 10;
    P.night = [1.2 + t * 0.4, 1 + t * 0.5, t, t * 0.18];
    P.nightLh = Math.max(1, Math.ceil(H / 320));
  }
  if (A.air > 0) { set(OP.AIR, true); P.air = A.air / 10; }
  if (A.flare > 0) { set(OP.FLARE, true); P.flareA = (A.flare / 10) * 0.35; }
  for (let k = 0; k < MASK_ONLY_KEYS.length; k++) {
    if ((P.on >> k) & 1 && A.mo[MASK_ONLY_KEYS[k]]) P.mo |= 1 << k;
  }
  return P;
}

// 有効な処理をパスに分ける: 近傍を読む処理の手前で区切り、各パスは [first, end) を担当する
function _schedule(on) {
  const starts = [];
  let pendingPoint = false;
  for (let k = 0; k <= OP.FLARE; k++) {
    if (!((on >> k) & 1)) continue;
    if (NEIGHBOR_OPS.has(k)) starts.push(k);
    else if (!starts.length) pendingPoint = true;
  }
  // 先頭が画素ごとの処理なら、番号 0 から始まるパスを足す（色収差が無効でも 0 番から処理できる）
  if (pendingPoint && starts[0] !== 0) starts.unshift(0);
  return starts.map((first, i) => ({ first, end: i + 1 < starts.length ? starts[i + 1] : OP.FLARE + 1 }));
}

/**
 * フィルターを WebGL2 で適用する。
 * @param {HTMLCanvasElement} srcCvs  フィルター前の画像（W×H）
 * @param {object} A  スライダーの値など（render.js の _collectFilterArgs）
 * @param {object} hooks  { grain: () => canvas, mask: () => { cvs, x, y, dw, dh, sw, sh } }
 * @returns {HTMLCanvasElement|null|false}  結果のキャンバス / 何もしない場合 null / 使えない場合 false（2D 版で描く）
 */
export function applyFiltersGL(srcCvs, W, H, m, A, hooks) {
  if (!_init() || _lost) return false;
  const gl = _gl;
  if (gl.isContextLost()) return false;
  const P = _params(A, W, H, m);
  if (!P.on) return null;
  try {
    if (!_res) _initResources(gl);
    if (_cvs.width !== W || _cvs.height !== H) { _cvs.width = W; _cvs.height = H; }
    gl.bindVertexArray(_res.vao);
    gl.disable(gl.BLEND);
    if (!_announced) {
      _announced = true;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      console.info('[gl-filters] フィルターを WebGL で描画します（GPU: ' + (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) + '）');
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    _bindTex(gl, 0, _res.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCvs);
    if ((P.on >> OP.GRAIN) & 1) {
      _bindTex(gl, 1, _res.grain);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, hooks.grain());
    }
    let maskInfo = null;
    if (P.mo) {
      maskInfo = hooks.mask();
      _bindTex(gl, 3, _res.mask);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskInfo.cvs);
    }

    const passes = _schedule(P.on);
    let cur = _res.src;
    let ping = 0;
    for (let i = 0; i < passes.length; i++) {
      const { first, end } = passes[i];
      const last = i === passes.length - 1;
      // ぼかしの下ごしらえ（このパスの入力 cur から作る）
      let blurTex = _res.dummy;
      if (first === OP.BLOOM1 || first === OP.BLOOM2) {
        const b = P.bloom;
        blurTex = first === OP.BLOOM1
          ? _blur(gl, cur, W, H, b.sw, b.sh, b.t * 4 * b.k, 'bh', 'bv', { post: [1, 1 + b.t * 0.7] })
          : _blur(gl, cur, W, H, b.sw, b.sh, b.t * 2 * b.k, 'bh', 'bv');
      } else if (first === OP.AIR) {
        const t = P.air;
        blurTex = _blur(gl, cur, W, H, W, H, t * 8, 'ah', 'av', { pre: [1 + t * 0.5, 1 + t * 20], post: [2, 1 + t * 3] });
      }

      const { p, u } = _res.main;
      gl.useProgram(p);
      let out = null;
      if (last) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      else { out = _target(gl, ping ? 'p1' : 'p0', W, H); gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); ping ^= 1; }
      gl.viewport(0, 0, W, H);
      _bindTex(gl, 0, cur);
      _bindTex(gl, 1, _res.grain);
      _bindTex(gl, 2, blurTex);
      _bindTex(gl, 3, _res.mask);
      gl.uniform1i(u.uSrc, 0); gl.uniform1i(u.uGrain, 1); gl.uniform1i(u.uBlur, 2); gl.uniform1i(u.uMask, 3);
      gl.uniform2f(u.uSize, W, H);
      gl.uniform1i(u.uFirst, first);
      gl.uniform1i(u.uEnd, end);
      gl.uniform1i(u.uOn, P.on);
      gl.uniform1i(u.uMO, P.mo);
      gl.uniform1i(u.uFlip, last ? 1 : 0);
      if (maskInfo) {
        gl.uniform4f(u.uMaskRect, maskInfo.x, maskInfo.y, maskInfo.dw, maskInfo.dh);
        gl.uniform2f(u.uMaskUV, maskInfo.sw / maskInfo.cvs.width, maskInfo.sh / maskInfo.cvs.height);
      }
      gl.uniform1f(u.uCaS, P.caS || 0);
      if (P.hl) gl.uniform2fv(u.uHl, P.hl);
      if (P.sh) gl.uniform2fv(u.uSh, P.sh);
      if (P.vig) { gl.uniform4fv(u.uVig, P.vig); gl.uniform1f(u.uVigA, P.vigA); }
      if (P.temp) gl.uniform4fv(u.uTemp, P.temp);
      if (P.tint) gl.uniform4fv(u.uTint, P.tint);
      if (P.matte) gl.uniform2fv(u.uMatte, P.matte);
      if (P.bloom) gl.uniform1f(u.uBloomA, first === OP.BLOOM1 ? P.bloom.t * 0.55 : P.bloom.t * 0.30);
      if (P.sharp) gl.uniform1f(u.uSharp, P.sharp);
      if (P.pencil) gl.uniform3fv(u.uPencil, P.pencil);
      if (P.emboss) gl.uniform2fv(u.uEmboss, P.emboss);
      if (P.chalk) gl.uniform3fv(u.uChalk, P.chalk);
      if (P.night) { gl.uniform4fv(u.uNight, P.night); gl.uniform1f(u.uNightLh, P.nightLh); }
      if (P.air) gl.uniform1f(u.uAirA, P.air * 0.7);
      if (P.flareA) gl.uniform1f(u.uFlareA, P.flareA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (out) cur = out.tex;
    }
    return _cvs;
  } catch (e) {
    console.warn('[gl-filters] WebGL での描画に失敗したため 2D 版に切り替えます', e);
    _broken = true;
    return false;
  }
}
