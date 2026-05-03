/**
 * GFRainEngine – WebGL rain-glass overlay for gentleman-frame
 *
 * Based on Codrops RainEffect by Lucas Bebber (MIT License)
 * Copyright (c) Codrops – https://tympanus.net/codrops/licensing/
 * https://tympanus.net/codrops/2015/11/04/rain-water-effect-experiments/
 * https://github.com/codrops/RainEffect
 *
 * Usage:
 *   GFRainEngine.start(overlayCanvas, mainCanvas, intensity)  // intensity: 1-10
 *   GFRainEngine.stop()
 */
'use strict';
(function (global) {

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function createCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width  = w;
    c.height = h;
    return c;
  }

  function random(from, to, interpolation) {
    if (from == null) { from = 0; to = 1; }
    else if (to == null) { to = from; from = 0; }
    var delta = to - from;
    if (interpolation == null) interpolation = function (n) { return n; };
    return from + (interpolation(Math.random()) * delta);
  }

  function chance(c) { return random() <= c; }

  function times(n, f) {
    for (var i = 0; i < n; i++) f.call(undefined, i);
  }

  // ─── WebGL utilities (from webgl.js) ────────────────────────────────────────

  function glGetContext(canvas, options) {
    var names = ['webgl', 'experimental-webgl'];
    var ctx = null;
    names.some(function (name) {
      try { ctx = canvas.getContext(name, options); } catch (e) {}
      return ctx != null;
    });
    return ctx;
  }

  function glCreateProgram(gl, vertSrc, fragSrc) {
    var vert = glCreateShader(gl, vertSrc, gl.VERTEX_SHADER);
    var frag = glCreateShader(gl, fragSrc, gl.FRAGMENT_SHADER);
    var prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('GFRainEngine: shader link error', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    var posLoc     = gl.getAttribLocation(prog, 'a_position');
    var texCoordLoc = gl.getAttribLocation(prog, 'a_texCoord');

    var tcBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tcBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1,  1,
      -1,  1,  1, -1,   1,  1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    return prog;
  }

  function glCreateShader(gl, src, type) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('GFRainEngine: shader compile error', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function glCreateTexture(gl, source, i) {
    var tex = gl.createTexture();
    glActiveTexture(gl, i);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (source != null) glUpdateTexture(gl, source);
    return tex;
  }

  function glCreateUniform(gl, prog, type, name) {
    var args = Array.prototype.slice.call(arguments, 4);
    var loc  = gl.getUniformLocation(prog, 'u_' + name);
    gl['uniform' + type].apply(gl, [loc].concat(args));
  }

  function glActiveTexture(gl, i) { gl.activeTexture(gl['TEXTURE' + i]); }

  function glUpdateTexture(gl, source) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function glSetRectangle(gl, x, y, w, h) {
    var x2 = x + w, y2 = y + h;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      x, y,  x2, y,  x, y2,  x, y2,  x2, y,  x2, y2
    ]), gl.STATIC_DRAW);
  }

  // ─── GL wrapper class (from gl-obj.js) ──────────────────────────────────────

  function GL(canvas, options, vert, frag) {
    this.canvas  = canvas;
    this.width   = canvas.width;
    this.height  = canvas.height;
    this.gl      = glGetContext(canvas, options);
    this.program = glCreateProgram(this.gl, vert, frag);
    this.gl.useProgram(this.program);
  }
  GL.prototype = {
    createTexture:  function (src, i) { return glCreateTexture(this.gl, src, i); },
    createUniform:  function (type, name) {
      var args = [this.gl, this.program, type, name].concat(Array.prototype.slice.call(arguments, 2));
      glCreateUniform.apply(null, args);
    },
    useProgram:     function (prog) { this.program = prog; this.gl.useProgram(prog); },
    activeTexture:  function (i)    { glActiveTexture(this.gl, i); },
    updateTexture:  function (src)  { glUpdateTexture(this.gl, src); },
    draw: function () {
      glSetRectangle(this.gl, -1, -1, 2, 2);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }
  };

  // ─── Shaders (inlined) ──────────────────────────────────────────────────────

  var VERT_SHADER = [
    'precision mediump float;',
    'attribute vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Modified water.frag: final line outputs only fg (drop refraction + alpha),
  // no bg fill — areas with no drops are transparent so mainCanvas shows through.
  var FRAG_SHADER = [
    'precision mediump float;',
    'uniform sampler2D u_waterMap;',
    'uniform sampler2D u_textureShine;',
    'uniform sampler2D u_textureFg;',
    'uniform sampler2D u_textureBg;',
    'varying vec2 v_texCoord;',
    'uniform vec2 u_resolution;',
    'uniform vec2 u_parallax;',
    'uniform float u_parallaxFg;',
    'uniform float u_parallaxBg;',
    'uniform float u_textureRatio;',
    'uniform bool u_renderShine;',
    'uniform bool u_renderShadow;',
    'uniform float u_minRefraction;',
    'uniform float u_refractionDelta;',
    'uniform float u_brightness;',
    'uniform float u_alphaMultiply;',
    'uniform float u_alphaSubtract;',

    'vec4 blend(vec4 bg, vec4 fg) {',
    '  vec3 bgm = bg.rgb * bg.a;',
    '  vec3 fgm = fg.rgb * fg.a;',
    '  float ia = 1.0 - fg.a;',
    '  float a  = fg.a + bg.a * ia;',
    '  vec3 rgb;',
    '  if (a != 0.0) { rgb = (fgm + bgm * ia) / a; }',
    '  else           { rgb = vec3(0.0); }',
    '  return vec4(rgb, a);',
    '}',

    'vec2 pixel() { return vec2(1.0) / u_resolution; }',
    'vec2 parallax(float v) { return u_parallax * pixel() * v; }',
    'vec2 texCoord() {',
    '  return vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_resolution;',
    '}',

    'vec2 scaledTexCoord() {',
    '  float ratio = u_resolution.x / u_resolution.y;',
    '  vec2 scale  = vec2(1.0);',
    '  vec2 offset = vec2(0.0);',
    '  float ratioDelta = ratio - u_textureRatio;',
    '  if (ratioDelta >= 0.0) {',
    '    scale.y  = 1.0 + ratioDelta;',
    '    offset.y = ratioDelta / 2.0;',
    '  } else {',
    '    scale.x  = 1.0 - ratioDelta;',
    '    offset.x = -ratioDelta / 2.0;',
    '  }',
    '  return (texCoord() + offset) / scale;',
    '}',

    'vec4 fgColor(float x, float y) {',
    '  float p2    = u_parallaxFg * 2.0;',
    '  vec2 scale  = vec2((u_resolution.x + p2) / u_resolution.x,',
    '                     (u_resolution.y + p2) / u_resolution.y);',
    '  vec2 stc    = texCoord() / scale;',
    '  vec2 offset = vec2((1.0 - (1.0 / scale.x)) / 2.0,',
    '                     (1.0 - (1.0 / scale.y)) / 2.0);',
    '  return texture2D(u_waterMap,',
    '    (stc + offset) + (pixel() * vec2(x, y)) + parallax(u_parallaxFg));',
    '}',

    'void main() {',
    '  vec4 cur = fgColor(0.0, 0.0);',
    '  float d  = cur.b;',
    '  float x  = cur.g;',
    '  float y  = cur.r;',
    '  float a  = clamp(cur.a * u_alphaMultiply - u_alphaSubtract, 0.0, 1.0);',

    '  vec2 refraction = (vec2(x, y) - 0.5) * 2.0;',
    '  vec2 refractionParallax = parallax(u_parallaxBg - u_parallaxFg);',
    '  vec2 refractionPos = scaledTexCoord()',
    '    + (pixel() * refraction * (u_minRefraction + (d * u_refractionDelta)))',
    '    + refractionParallax;',

    '  vec4 tex = texture2D(u_textureFg, refractionPos);',

    '  if (u_renderShine) {',
    '    float maxShine = 490.0;',
    '    float minShine = maxShine * 0.18;',
    '    vec2 shinePos  = vec2(0.5) + ((1.0 / 512.0) * refraction)',
    '                     * -(minShine + ((maxShine - minShine) * d));',
    '    vec4 shine = texture2D(u_textureShine, shinePos);',
    '    tex = blend(tex, shine);',
    '  }',

    '  vec4 fg = vec4(tex.rgb * u_brightness, a);',

    '  if (u_renderShadow) {',
    '    float borderAlpha = fgColor(0.0, 0.0 - (d * 6.0)).a;',
    '    borderAlpha = clamp(borderAlpha * u_alphaMultiply - (u_alphaSubtract + 0.5), 0.0, 1.0);',
    '    borderAlpha *= 0.2;',
    '    vec4 border = vec4(0.0, 0.0, 0.0, borderAlpha);',
    '    fg = blend(border, fg);',
    '  }',

    '  /* Glass-lens tint: drops visible on dark backgrounds; fades out on bright sources */',
    '  float srcBright = dot(tex.rgb, vec3(0.333, 0.333, 0.333));',
    '  fg.rgb = fg.rgb + vec3(0.12, 0.15, 0.20) * a * (1.0 - srcBright);',
    '  /* Only output the drop/refraction; transparent where no drops */',
    '  gl_FragColor = fg;',
    '}'
  ].join('\n');

  // ─── RainRenderer (from rain-renderer.js) ───────────────────────────────────

  var defaultRendererOptions = {
    renderShadow:    false,
    minRefraction:   128,
    maxRefraction:   256,
    brightness:      1.04,
    alphaMultiply:   18,
    alphaSubtract:   3,
    parallaxBg:      5,
    parallaxFg:      20
  };

  function RainRenderer(canvas, canvasLiquid, mainCanvas, options) {
    this.canvas       = canvas;
    this.canvasLiquid = canvasLiquid;
    this.imageFg      = mainCanvas;   // live canvas – updated every frame
    this.imageBg      = mainCanvas;   // same source; used for textureRatio
    this.options      = Object.assign({}, defaultRendererOptions, options || {});
    this._stopped     = false;
    this._rafId       = null;
    this._init();
  }
  RainRenderer.prototype = {
    _init: function () {
      var W  = this.canvas.width  = this.imageBg.width;
      var H  = this.canvas.height = this.imageBg.height;
      this.width  = W;
      this.height = H;

      this.gl = new GL(
        this.canvas,
        { alpha: true, premultipliedAlpha: false },
        VERT_SHADER, FRAG_SHADER
      );
      var gl = this.gl;

      gl.createUniform('2f', 'resolution',     W, H);
      gl.createUniform('1f', 'textureRatio',   this.imageBg.width / this.imageBg.height);
      gl.createUniform('1i', 'renderShine',    0);
      gl.createUniform('1i', 'renderShadow',   this.options.renderShadow ? 1 : 0);
      gl.createUniform('1f', 'minRefraction',  this.options.minRefraction);
      gl.createUniform('1f', 'refractionDelta',this.options.maxRefraction - this.options.minRefraction);
      gl.createUniform('1f', 'brightness',     this.options.brightness);
      gl.createUniform('1f', 'alphaMultiply',  this.options.alphaMultiply);
      gl.createUniform('1f', 'alphaSubtract',  this.options.alphaSubtract);
      gl.createUniform('1f', 'parallaxBg',     this.options.parallaxBg);
      gl.createUniform('1f', 'parallaxFg',     this.options.parallaxFg);

      // Texture slot 0: water map (updated from canvasLiquid every frame)
      gl.createTexture(null, 0);
      gl.createUniform('1i', 'waterMap', 0);

      // Texture slot 1: shine (unused – 2×2 blank)
      var blankCanvas = createCanvas(2, 2);
      this._textures = [
        { name: 'textureShine', img: blankCanvas },
        { name: 'textureFg',    img: this.imageFg },
        { name: 'textureBg',    img: this.imageBg }
      ];
      var self = this;
      this._textures.forEach(function (t, i) {
        gl.createTexture(t.img, i + 1);
        gl.createUniform('1i', t.name, i + 1);
      });

      this._draw();
    },

    _draw: function () {
      if (this._stopped) return;
      var gl = this.gl;
      gl.useProgram(gl.program);
      gl.createUniform('2f', 'parallax', 0, 0);

      // Update water map from Raindrops canvas
      gl.activeTexture(0);
      gl.updateTexture(this.canvasLiquid);

      // Update FG/BG from live mainCanvas (skip slot 0: shine is static)
      var self = this;
      this._textures.forEach(function (t, i) {
        if (i === 0) return; // shine is static blank
        self.gl.activeTexture(i + 1);
        self.gl.updateTexture(t.img);
      });

      gl.draw();
    },

    stop: function () {
      this._stopped = true;
      // Clear the WebGL canvas to transparent
      var rawGl = this.gl.gl;
      rawGl.clearColor(0, 0, 0, 0);
      rawGl.clear(rawGl.COLOR_BUFFER_BIT);
    }
  };

  // ─── Raindrops (from raindrops.js) ──────────────────────────────────────────

  var DROP_PROTO = {
    x: 0, y: 0, r: 0,
    spreadX: 0, spreadY: 0,
    momentum: 0, momentumX: 0,
    lastSpawn: 0, nextSpawn: 0,
    parent: null,
    isNew: true,
    killed: false,
    shrink: 0
  };

  var DEFAULT_RAIN_OPTS = {
    minR: 10,
    maxR: 40,
    maxDrops: 900,
    rainChance: 0.3,
    rainLimit: 3,
    dropletsRate: 50,
    dropletsSize: [2, 4],
    dropletsCleaningRadiusMultiplier: 0.43,
    raining: true,
    globalTimeScale: 1,
    trailRate: 1,
    autoShrink: true,
    spawnArea: [-0.1, 0.95],
    trailScaleRange: [0.2, 0.5],
    collisionRadius: 0.65,
    collisionRadiusIncrease: 0.01,
    dropFallMultiplier: 1,
    collisionBoostMultiplier: 0.05,
    collisionBoost: 1
  };

  var DROP_SIZE = 64;

  function Raindrops(width, height, scale, dropAlpha, dropColor, options) {
    this.width     = width;
    this.height    = height;
    this.scale     = scale;
    this.dropAlpha = dropAlpha;
    this.dropColor = dropColor;
    this.options   = Object.assign({}, DEFAULT_RAIN_OPTS, options || {});
    this._stopped  = false;
    this._rafId    = null;
    this._init();
  }
  Raindrops.prototype = {
    dropletsPixelDensity: 1,
    canvas:  null, ctx:  null,
    droplets: null, dropletsCtx: null,
    dropletsCounter: 0,
    drops:    null, dropsGfx: null,
    clearDropletsGfx: null,
    textureCleaningIterations: 0,
    lastRender: null,

    get deltaR()        { return this.options.maxR - this.options.minR; },
    get area()          { return (this.width * this.height) / this.scale; },
    get areaMultiplier(){ return Math.sqrt(this.area / (1024 * 768)); },

    _init: function () {
      this.canvas = createCanvas(this.width, this.height);
      this.ctx    = this.canvas.getContext('2d');

      this.droplets    = createCanvas(this.width * this.dropletsPixelDensity,
                                       this.height * this.dropletsPixelDensity);
      this.dropletsCtx = this.droplets.getContext('2d');

      this.drops    = [];
      this.dropsGfx = [];

      this._renderDropsGfx();
      this._update();
    },

    _renderDropsGfx: function () {
      var self        = this;
      var dropBuffer  = createCanvas(DROP_SIZE, DROP_SIZE);
      var dropBufCtx  = dropBuffer.getContext('2d');

      this.dropsGfx = Array.apply(null, Array(255)).map(function (cur, i) {
        var drop    = createCanvas(DROP_SIZE, DROP_SIZE);
        var dropCtx = drop.getContext('2d');

        dropBufCtx.clearRect(0, 0, DROP_SIZE, DROP_SIZE);

        dropBufCtx.globalCompositeOperation = 'source-over';
        dropBufCtx.drawImage(self.dropColor, 0, 0, DROP_SIZE, DROP_SIZE);

        dropBufCtx.globalCompositeOperation = 'screen';
        dropBufCtx.fillStyle = 'rgba(0,0,' + i + ',1)';
        dropBufCtx.fillRect(0, 0, DROP_SIZE, DROP_SIZE);

        dropCtx.globalCompositeOperation = 'source-over';
        dropCtx.drawImage(self.dropAlpha, 0, 0, DROP_SIZE, DROP_SIZE);

        dropCtx.globalCompositeOperation = 'source-in';
        dropCtx.drawImage(dropBuffer, 0, 0, DROP_SIZE, DROP_SIZE);
        return drop;
      });

      this.clearDropletsGfx = createCanvas(128, 128);
      var clrCtx = this.clearDropletsGfx.getContext('2d');
      clrCtx.fillStyle = '#000';
      clrCtx.beginPath();
      clrCtx.arc(64, 64, 64, 0, Math.PI * 2);
      clrCtx.fill();
    },

    _drawDroplet: function (x, y, r) {
      this._drawDrop(this.dropletsCtx, Object.assign(Object.create(DROP_PROTO), {
        x: x * this.dropletsPixelDensity,
        y: y * this.dropletsPixelDensity,
        r: r * this.dropletsPixelDensity
      }));
    },

    _drawDrop: function (ctx, drop) {
      if (!this.dropsGfx.length) return;
      var x = drop.x, y = drop.y, r = drop.r;
      var spreadX = drop.spreadX, spreadY = drop.spreadY;
      var scaleX = 1, scaleY = 1.5;
      var d = Math.max(0, Math.min(1, ((r - this.options.minR) / this.deltaR) * 0.9));
      d *= 1 / (((spreadX + spreadY) * 0.5) + 1);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      d = Math.floor(d * (this.dropsGfx.length - 1));
      ctx.drawImage(
        this.dropsGfx[d],
        (x - (r * scaleX * (spreadX + 1))) * this.scale,
        (y - (r * scaleY * (spreadY + 1))) * this.scale,
        (r * 2 * scaleX * (spreadX + 1))  * this.scale,
        (r * 2 * scaleY * (spreadY + 1))  * this.scale
      );
    },

    _clearDroplets: function (x, y, r) {
      if (r == null) r = 30;
      var ctx = this.dropletsCtx;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(
        this.clearDropletsGfx,
        (x - r) * this.dropletsPixelDensity * this.scale,
        (y - r) * this.dropletsPixelDensity * this.scale,
        (r * 2) * this.dropletsPixelDensity * this.scale,
        (r * 2) * this.dropletsPixelDensity * this.scale * 1.5
      );
    },

    _createDrop: function (opts) {
      if (this.drops.length >= this.options.maxDrops * this.areaMultiplier) return null;
      return Object.assign(Object.create(DROP_PROTO), opts);
    },

    _updateRain: function (timeScale) {
      var rainDrops = [];
      if (!this.options.raining) return rainDrops;
      var limit = this.options.rainLimit * timeScale * this.areaMultiplier;
      var count = 0;
      while (chance(this.options.rainChance * timeScale * this.areaMultiplier) && count < limit) {
        count++;
        var r = random(this.options.minR, this.options.maxR, function (n) { return Math.pow(n, 3); });
        var rd = this._createDrop({
          x: random(this.width / this.scale),
          y: random((this.height / this.scale) * this.options.spawnArea[0],
                    (this.height / this.scale) * this.options.spawnArea[1]),
          r: r,
          momentum: 1 + ((r - this.options.minR) * 0.1) + random(2),
          spreadX: 1.5,
          spreadY: 1.5
        });
        if (rd != null) rainDrops.push(rd);
      }
      return rainDrops;
    },

    _updateDroplets: function (timeScale) {
      if (this.textureCleaningIterations > 0) {
        this.textureCleaningIterations -= 1 * timeScale;
        this.dropletsCtx.globalCompositeOperation = 'destination-out';
        this.dropletsCtx.fillStyle = 'rgba(0,0,0,' + (0.05 * timeScale) + ')';
        this.dropletsCtx.fillRect(0, 0,
          this.width * this.dropletsPixelDensity,
          this.height * this.dropletsPixelDensity);
      }
      if (this.options.raining) {
        this.dropletsCounter += this.options.dropletsRate * timeScale * this.areaMultiplier;
        var self = this;
        times(this.dropletsCounter, function () {
          self.dropletsCounter--;
          self._drawDroplet(
            random(self.width  / self.scale),
            random(self.height / self.scale),
            random(self.options.dropletsSize[0], self.options.dropletsSize[1],
                   function (n) { return n * n; })
          );
        });
      }
      this.ctx.drawImage(this.droplets, 0, 0, this.width, this.height);
    },

    _updateDrops: function (timeScale) {
      var self     = this;
      var newDrops = [];

      this._updateDroplets(timeScale);
      var rainDrops = this._updateRain(timeScale);
      newDrops = newDrops.concat(rainDrops);

      this.drops.sort(function (a, b) {
        var va = (a.y * (self.width / self.scale)) + a.x;
        var vb = (b.y * (self.width / self.scale)) + b.x;
        return va > vb ? 1 : va === vb ? 0 : -1;
      });

      this.drops.forEach(function (drop, i) {
        if (drop.killed) return;

        if (chance((drop.r - (self.options.minR * self.options.dropFallMultiplier)) *
                   (0.1 / self.deltaR) * timeScale)) {
          drop.momentum += random((drop.r / self.options.maxR) * 4);
        }
        if (self.options.autoShrink && drop.r <= self.options.minR && chance(0.05 * timeScale)) {
          drop.shrink += 0.01;
        }
        drop.r -= drop.shrink * timeScale;
        if (drop.r <= 0) drop.killed = true;

        if (self.options.raining) {
          drop.lastSpawn += drop.momentum * timeScale * self.options.trailRate;
          if (drop.lastSpawn > drop.nextSpawn) {
            var trailDrop = self._createDrop({
              x: drop.x + (random(-drop.r, drop.r) * 0.1),
              y: drop.y - (drop.r * 0.01),
              r: drop.r * random(self.options.trailScaleRange[0], self.options.trailScaleRange[1]),
              spreadY: drop.momentum * 0.1,
              parent: drop
            });
            if (trailDrop != null) {
              newDrops.push(trailDrop);
              drop.r        *= Math.pow(0.97, timeScale);
              drop.lastSpawn = 0;
              drop.nextSpawn = random(self.options.minR, self.options.maxR) -
                               (drop.momentum * 2 * self.options.trailRate) +
                               (self.options.maxR - drop.r);
            }
          }
        }

        drop.spreadX *= Math.pow(0.4, timeScale);
        drop.spreadY *= Math.pow(0.7, timeScale);

        var moved = drop.momentum > 0;
        if (moved && !drop.killed) {
          drop.y += drop.momentum  * self.options.globalTimeScale;
          drop.x += drop.momentumX * self.options.globalTimeScale;
          if (drop.y > (self.height / self.scale) + drop.r) drop.killed = true;
        }

        if ((moved || drop.isNew) && !drop.killed) {
          drop.isNew = false;
          self.drops.slice(i + 1, i + 70).forEach(function (drop2) {
            if (drop === drop2 || drop.r <= drop2.r ||
                drop.parent === drop2 || drop2.parent === drop || drop2.killed) return;
            var dx = drop2.x - drop.x, dy = drop2.y - drop.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < (drop.r + drop2.r) * (self.options.collisionRadius +
                        drop.momentum * self.options.collisionRadiusIncrease * timeScale)) {
              var pi = Math.PI;
              var a1 = pi * drop.r  * drop.r;
              var a2 = pi * drop2.r * drop2.r;
              var targetR = Math.sqrt((a1 + a2 * 0.8) / pi);
              if (targetR > self.options.maxR) targetR = self.options.maxR;
              drop.r         = targetR;
              drop.momentumX += dx * 0.1;
              drop.spreadX   = 0;
              drop.spreadY   = 0;
              drop2.killed   = true;
              drop.momentum  = Math.max(drop2.momentum,
                Math.min(40, drop.momentum +
                  targetR * self.options.collisionBoostMultiplier +
                  self.options.collisionBoost));
            }
          });
        }

        drop.momentum -= Math.max(1, (self.options.minR * 0.5) - drop.momentum) * 0.1 * timeScale;
        if (drop.momentum < 0) drop.momentum = 0;
        drop.momentumX *= Math.pow(0.7, timeScale);

        if (!drop.killed) {
          newDrops.push(drop);
          if (moved && self.options.dropletsRate > 0) {
            self._clearDroplets(drop.x, drop.y,
              drop.r * self.options.dropletsCleaningRadiusMultiplier);
          }
          self._drawDrop(self.ctx, drop);
        }
      });

      this.drops = newDrops;
    },

    _update: function () {
      if (this._stopped) return;
      this.ctx.clearRect(0, 0, this.width, this.height);

      var now = Date.now();
      if (this.lastRender == null) this.lastRender = now;
      var deltaT    = now - this.lastRender;
      var timeScale = deltaT / ((1 / 60) * 1000);
      if (timeScale > 1.1) timeScale = 1.1;
      timeScale *= this.options.globalTimeScale;
      this.lastRender = now;

      this._updateDrops(timeScale);
    },

    stop: function () {
      this._stopped = true;
    }
  };

  // ─── Intensity mapping ───────────────────────────────────────────────────────

  function intensityToOptions(v) {
    // v: 1-10 (mapped from filterRain slider)
    var t = v / 10;
    return {
      maxDrops:    Math.round(100 + t * 800),       // 180 – 900
      rainChance:  0.05 + t * 0.25,                 // 0.08 – 0.3
      rainLimit:   Math.max(1, Math.round(t * 5)),  // 1 – 5
      dropletsRate: Math.round(10 + t * 40)         // 14 – 50
    };
  }

  // ─── Image loading ───────────────────────────────────────────────────────────

  function loadImages(list, cb) {
    var result  = {};
    var pending = list.length;
    list.forEach(function (item) {
      var img = new Image();
      img.onload  = function () { result[item.name] = img; if (--pending === 0) cb(result); };
      img.onerror = function () {
        console.error('GFRainEngine: could not load', item.src);
        if (--pending === 0) cb(result);
      };
      img.src = item.src;
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  var _state = null;
  var _generation = 0; // incremented on each stop() to cancel in-flight loadImages callbacks

  global.GFRainEngine = {
    /**
     * Start the rain glass overlay.
     * @param {HTMLCanvasElement} overlayCanvas  – the #rainOverlay canvas (WebGL will be used)
     * @param {HTMLCanvasElement} mainCanvas     – the main rendering canvas (video frames)
     * @param {number}           intensity       – 1-10
     * @param {object}           [extra]         – { speed, refraction, shadow }
     */
    start: function (overlayCanvas, mainCanvas, intensity, extra) {
      // Stop any running instance first
      this.stop();

      extra = extra || {};
      var opts = intensityToOptions(Math.max(1, Math.min(10, intensity || 5)));
      if (extra.speed != null) opts.globalTimeScale = extra.speed;

      var myGen = ++_generation;
      loadImages([
        { name: 'dropAlpha', src: 'img/drop-alpha.png' },
        { name: 'dropColor',  src: 'img/drop-color.png'  }
      ], function (imgs) {
        if (myGen !== _generation) return; // stop() was called while images were loading
        if (!imgs.dropAlpha || !imgs.dropColor) {
          console.error('GFRainEngine: drop textures failed to load. Ensure img/drop-alpha.png and img/drop-color.png exist.');
          return;
        }

        // Sync overlay canvas size to mainCanvas
        overlayCanvas.width  = mainCanvas.width;
        overlayCanvas.height = mainCanvas.height;

        var raindrops = new Raindrops(
          mainCanvas.width, mainCanvas.height,
          1,                          // scale
          imgs.dropAlpha, imgs.dropColor,
          opts
        );

        var refraction = extra.refraction != null ? extra.refraction : 200;
        var renderer = new RainRenderer(
          overlayCanvas,
          raindrops.canvas,   // the liquid (normal-map) canvas
          mainCanvas,         // used as both FG and BG texture source
          {
            minRefraction:  Math.round(refraction * 0.5),
            maxRefraction:  refraction,
            brightness:     1.04,
            alphaMultiply:  18,
            alphaSubtract:  3,
            renderShadow:   !!extra.shadow
          }
        );

        _state = { raindrops: raindrops, renderer: renderer };
      });
    },

    /**
     * Advance rain by one frame. Call this from the main render loop
     * so rain framerate is tied to filterFps.
     */
    tick: function () {
      if (!_state) return;
      _state.raindrops._update();
      _state.renderer._draw();
    },

    /** Stop and clear the overlay. */
    stop: function () {
      _generation++; // cancel any in-flight loadImages callback
      if (!_state) return;
      _state.raindrops.stop();
      _state.renderer.stop();
      _state = null;
    }
  };

})(window);
