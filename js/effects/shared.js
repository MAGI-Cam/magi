// Helpers shared by effect renderers: tone and color sampling, ordered-dither thresholds,
// ink coloring, glyph atlases, and a glyph renderer used by the character-based effects.
(function () {
  var fx = Magi.fx = {};

  // How much of the new frame each cell takes on per update. Lower is calmer motion.
  var MOTION_EASE = 0.45;
  // Partial linearization so midtones do not wash out when shown as ink density.
  var TONE_GAMMA = 1.5;
  // Floor for color normalization so near-black cells don't amplify sensor noise.
  var COLOR_FLOOR = 0.04;
  // Sobel magnitude above which a cell counts as an edge (tone is 0–1, max is about 4).
  var EDGE_THRESHOLD = 0.55;

  // 8x8 Bayer matrix as thresholds in (0, 1). Ordered dithering keeps the
  // pattern fixed in place, so live video does not shimmer the way error diffusion does.
  fx.BAYER = (function () {
    var m = [[0]];
    while (m.length < 8) {
      var s = m.length, next = [];
      for (var y = 0; y < s * 2; y++) {
        next[y] = [];
        for (var x = 0; x < s * 2; x++) {
          var q = [[0, 2], [3, 1]][(y / s) | 0][(x / s) | 0];
          next[y][x] = 4 * m[y % s][x % s] + q;
        }
      }
      m = next;
    }
    var flat = new Float32Array(64);
    for (var i = 0; i < 64; i++) flat[i] = (m[i >> 3][i & 7] + 0.5) / 64;
    return flat;
  })();

  // Cell size in canvas pixels for a Scale step. Pass the frame to read the sizes as screen
  // pixels instead, so characters stay legible whether the preview is shrunk (phones) or not.
  fx.cellSize = function (sizes, scale, frame) {
    var size = sizes[scale - 1] || sizes[(sizes.length / 2) | 0];
    return frame ? Math.max(4, Math.round(size * (frame.pxPerCss || 1))) : size;
  };

  // Samples a frame onto a cols×rows grid with gentle easing over time. Returns
  // { tone, color, cols, rows }: tone per cell in [0, 1] (0 = black, 1 = white) with
  // contrast from Intensity; color per cell as RGB scaled so its brightest channel is 1,
  // which keeps the cell's hue without its brightness (brightness is already in the tone).
  fx.createToneSampler = function () {
    var grid = document.createElement('canvas');
    var gctx = grid.getContext('2d', { willReadFrequently: true });
    var tone = null, color = null;

    return {
      sample: function (frame, cols, rows, intensity) {
        if (grid.width !== cols || grid.height !== rows) {
          grid.width = cols;
          grid.height = rows;
          tone = null;
        }
        gctx.imageSmoothingEnabled = true;
        gctx.imageSmoothingQuality = 'high';
        frame.draw(gctx, cols, rows);

        var d = gctx.getImageData(0, 0, cols, rows).data;
        // Intensity is contrast around mid-gray: 0 → 0.25x, 50 → 1x, 100 → 4x.
        var contrast = Math.pow(2, (intensity - 50) / 25);
        var ease = frame.moving && tone ? MOTION_EASE : 1;
        if (!tone) {
          tone = new Float32Array(cols * rows);
          color = new Float32Array(cols * rows * 3);
        }

        for (var i = 0, n = cols * rows; i < n; i++) {
          var p = i << 2, q = i * 3;
          var r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
          var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          l = (l - 0.5) * contrast + 0.5;
          l = l <= 0 ? 0 : l >= 1 ? 1 : Math.pow(l, TONE_GAMMA);
          tone[i] += (l - tone[i]) * ease;

          var m = Math.max(r, g, b, COLOR_FLOOR);
          color[q] += (r / m - color[q]) * ease;
          color[q + 1] += (g / m - color[q + 1]) * ease;
          color[q + 2] += (b / m - color[q + 2]) * ease;
        }
        return { tone: tone, color: color, cols: cols, rows: rows };
      },
      reset: function () { tone = null; }
    };
  };

  // Color slider value (0–100) → RGB in 0–1. 0 is white; 1–100 runs once around the hue wheel.
  fx.inkColor = function (value) {
    if (!value || value <= 0) return [1, 1, 1];
    var h = ((value - 1) / 99) * 6;
    var x = 1 - Math.abs((h % 2) - 1);
    return [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h) % 6];
  };

  // Tints everything lit in `out` (white pixels or glyphs on black). Each sample cell gets
  // the chosen ink color, blended toward the media's own color by Saturation.
  var inkCanvas = document.createElement('canvas');
  var ictx = inkCanvas.getContext('2d');
  var inkImage = null;

  fx.applyInk = function (out, sample, params) {
    var s = (params.saturation || 0) / 100;
    var ink = fx.inkColor(params.color);
    if (s === 0 && ink[0] === 1 && ink[1] === 1 && ink[2] === 1) return;

    var cols = sample.cols, rows = sample.rows, c = sample.color;
    if (inkCanvas.width !== cols || inkCanvas.height !== rows || !inkImage) {
      inkCanvas.width = cols;
      inkCanvas.height = rows;
      inkImage = ictx.createImageData(cols, rows);
    }
    var d = inkImage.data;
    for (var i = 0, n = cols * rows; i < n; i++) {
      var p = i << 2, q = i * 3;
      d[p] = 255 * (ink[0] + (c[q] - ink[0]) * s);
      d[p + 1] = 255 * (ink[1] + (c[q + 1] - ink[1]) * s);
      d[p + 2] = 255 * (ink[2] + (c[q + 2] - ink[2]) * s);
      d[p + 3] = 255;
    }
    ictx.putImageData(inkImage, 0, 0);

    var octx = out.getContext('2d');
    octx.save();
    octx.globalCompositeOperation = 'multiply';
    octx.imageSmoothingEnabled = false;
    octx.drawImage(inkCanvas, 0, 0, out.width, out.height);
    octx.restore();
  };

  // Renders draw(ctx, cell) functions side by side, snapped to pure white on transparent,
  // and measures each glyph's ink coverage (0–1). A pixel counts as ink when its coverage
  // reaches `threshold` (0–255, default half); fonts with hairlines need a lower one.
  // Glyphs are laid out in rows of ATLAS_COLUMNS to keep the canvas within phone size limits.
  var ATLAS_COLUMNS = 16;

  fx.buildAtlas = function (glyphs, cell, threshold) {
    var cut = threshold || 128;
    var canvas = document.createElement('canvas');
    canvas.width = cell * Math.min(glyphs.length, ATLAS_COLUMNS);
    canvas.height = cell * Math.ceil(glyphs.length / ATLAS_COLUMNS);
    var g = canvas.getContext('2d', { willReadFrequently: true });
    glyphs.forEach(function (draw, i) {
      var gx = (i % ATLAS_COLUMNS) * cell, gy = ((i / ATLAS_COLUMNS) | 0) * cell;
      g.save();
      g.beginPath();
      g.rect(gx, gy, cell, cell);
      g.clip();
      g.translate(gx, gy);
      g.fillStyle = g.strokeStyle = '#fff';
      draw(g, cell);
      g.restore();
    });

    var img = g.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;
    var cover = new Float32Array(glyphs.length);
    // One cell×cell on/off mask per glyph, for fast blitting.
    var masks = glyphs.map(function () { return new Uint8Array(cell * cell); });
    for (var y = 0; y < canvas.height; y++) {
      for (var x = 0; x < canvas.width; x++) {
        var p = (y * canvas.width + x) << 2;
        var on = d[p + 3] >= cut;
        d[p] = d[p + 1] = d[p + 2] = 255;
        d[p + 3] = on ? 255 : 0;
        if (on) {
          var gi = ((y / cell) | 0) * ATLAS_COLUMNS + ((x / cell) | 0);
          cover[gi] += 1 / (cell * cell);
          masks[gi][(y % cell) * cell + (x % cell)] = 1;
        }
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas: canvas, cover: cover, cell: cell, masks: masks };
  };

  // Writes one glyph per cell straight into a pixel buffer (white on opaque black) and puts it
  // on `out` in a single call. glyphs[i] is an atlas index, or −1 for an empty cell. Thousands of
  // separate drawImage calls per frame were what made small scales lag.
  var blitImage = null;
  fx.blitGlyphs = function (out, atlas, glyphs, cols, rows) {
    var c = atlas.cell, w = cols * c, h = rows * c;
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    var octx = out.getContext('2d');
    if (!blitImage || blitImage.width !== w || blitImage.height !== h) blitImage = octx.createImageData(w, h);
    var buf = new Uint32Array(blitImage.data.buffer);
    buf.fill(0xff000000); // opaque black (pixels are stored as ABGR on little-endian devices)
    for (var i = 0, n = cols * rows; i < n; i++) {
      var g = glyphs[i];
      if (g < 0) continue;
      var m = atlas.masks[g], ox = (i % cols) * c, oy = ((i / cols) | 0) * c;
      for (var y = 0, k = 0; y < c; y++) {
        var row = (oy + y) * w + ox;
        for (var x = 0; x < c; x++, k++) if (m[k]) buf[row + x] = 0xffffffff;
      }
    }
    octx.putImageData(blitImage, 0, 0);
  };

  // Orders glyphs by coverage (dropping ones that render equally dense at this size) and
  // returns a lookup from tone (0–255) to lower glyph, upper glyph and blend between them.
  // Glyph index -1 means an empty cell.
  fx.buildRamp = function (cover, count) {
    var levels = [{ index: -1, cover: 0 }];
    var order = [];
    for (var i = 0; i < count; i++) order.push({ index: i, cover: cover[i] });
    order.sort(function (a, b) { return a.cover - b.cover; }).forEach(function (l) {
      if (l.cover > levels[levels.length - 1].cover) levels.push(l);
    });

    var max = levels[levels.length - 1].cover;
    var lo = new Int16Array(256), hi = new Int16Array(256), mix = new Float32Array(256);
    for (var t = 0, k = 0; t < 256; t++) {
      var target = (t / 255) * max;
      while (k < levels.length - 2 && levels[k + 1].cover <= target) k++;
      var a = levels[k], b = levels[Math.min(k + 1, levels.length - 1)];
      lo[t] = a.index;
      hi[t] = b.index;
      mix[t] = b.cover > a.cover ? (target - a.cover) / (b.cover - a.cover) : 0;
    }
    return { lo: lo, hi: hi, mix: mix };
  };

  // Web fonts must finish loading before glyphs are drawn into an atlas, or the browser draws
  // a fallback face. Returns true once the family is ready; until then it starts the download.
  var fontState = {};
  fx.fontReady = function (family) {
    if (!family || !document.fonts) return true;
    if (fontState[family] === undefined) {
      fontState[family] = false;
      var done = function () { fontState[family] = true; };
      document.fonts.load('32px "' + family + '"').then(done, done);
    }
    return fontState[family];
  };

  // Builds a renderer that draws one glyph per cell, white on black, then applies ink.
  // options.cellSizes: pixel size per Scale step. options.glyphs: draw(ctx, cell) functions
  // forming the tone ramp; brighter cells get denser glyphs and in-between tones dither.
  // options.edges (optional): [horizontal, vertical, rising, falling] glyphs drawn in place
  // of the ramp wherever the image has a strong edge, following its direction.
  // options.font (optional): web font family the glyphs use; atlases are redrawn once it loads.
  fx.createGlyphRenderer = function (options) {
    var sampler = fx.createToneSampler();
    var atlases = {};
    var rampCount = options.glyphs.length;
    var fontLoaded = fx.fontReady(options.font);
    var picks = null;

    function atlasFor(cell) {
      if (!fontLoaded && fx.fontReady(options.font)) {
        fontLoaded = true;
        atlases = {};
      }
      if (!atlases[cell]) {
        var atlas = fx.buildAtlas(options.glyphs.concat(options.edges || []), cell, options.threshold);
        atlas.ramp = fx.buildRamp(atlas.cover, rampCount);
        atlases[cell] = atlas;
      }
      return atlases[cell];
    }

    return {
      // Keep redrawing still images until the font arrives, so the real face replaces the fallback.
      get animated() { return !fontLoaded; },
      render: function (frame, out, params) {
        var cell = fx.cellSize(options.cellSizes, params.scale, frame);
        var cols = Math.max(1, Math.round(frame.width / cell));
        var rows = Math.max(1, Math.round(frame.height / cell));
        var sample = sampler.sample(frame, cols, rows, params.intensity);
        var tone = sample.tone;
        var atlas = atlasFor(cell), ramp = atlas.ramp;
        if (!picks || picks.length !== cols * rows) picks = new Int16Array(cols * rows);

        for (var y = 0, i = 0; y < rows; y++) {
          var row = (y & 7) << 3;
          for (var x = 0; x < cols; x++, i++) {
            var glyph = -1;
            if (options.edges && x > 0 && y > 0 && x < cols - 1 && y < rows - 1) {
              var gx = tone[i - cols + 1] + 2 * tone[i + 1] + tone[i + cols + 1] -
                tone[i - cols - 1] - 2 * tone[i - 1] - tone[i + cols - 1];
              var gy = tone[i + cols - 1] + 2 * tone[i + cols] + tone[i + cols + 1] -
                tone[i - cols - 1] - 2 * tone[i - cols] - tone[i - cols + 1];
              if (gx * gx + gy * gy > EDGE_THRESHOLD * EDGE_THRESHOLD) {
                // The edge runs across the gradient. y points down, so a gradient toward
                // the bottom-right means a rising edge (/).
                var ax = Math.abs(gx), ay = Math.abs(gy);
                var dir = ay > 2 * ax ? 0 : ax > 2 * ay ? 1 : gx * gy > 0 ? 2 : 3;
                glyph = rampCount + dir;
              }
            }
            if (glyph < 0) {
              var t = (tone[i] * 255 + 0.5) | 0;
              glyph = ramp.mix[t] > fx.BAYER[row | (x & 7)] ? ramp.hi[t] : ramp.lo[t];
            }
            picks[i] = glyph;
          }
        }
        fx.blitGlyphs(out, atlas, picks, cols, rows);
        fx.applyInk(out, sample, params);
      },
      reset: function () { sampler.reset(); }
    };
  };

  // Draws a centered text character sized to the cell.
  fx.textGlyph = function (ch, family) {
    return function (g, cell) {
      g.font = Math.round(cell * 1.05) + 'px ' + family;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, cell / 2, cell * 0.54);
    };
  };

  fx.textGlyphs = function (chars) {
    return chars.split('').map(function (ch) { return fx.textGlyph(ch, fx.MONO); });
  };

  fx.MONO = 'Menlo, Consolas, "DejaVu Sans Mono", "Courier New", monospace';

  // Glyph typefaces offered as modes. `family` is the web font (loaded in index.html);
  // `stack` is what the canvas draws with, falling back to the system monospace.
  fx.FONTS = {
    system: { family: null, stack: fx.MONO },
    vt323: { family: 'VT323', stack: 'VT323, ' + fx.MONO },
    silkscreen: { family: 'Silkscreen', stack: 'Silkscreen, ' + fx.MONO },
    // Didone hairlines are under half a pixel at glyph sizes, so they need a low ink threshold.
    bodoni: { family: 'Bodoni Moda', stack: '"Bodoni Moda", Didot, "Bodoni 72", Georgia, serif', threshold: 40 }
  };

  // Wraps one renderer per mode, built on first use, and draws with the mode in params.mode.
  // A full-frame WebGL pass: one fragment shader run on every pixel, for per-pixel work over large
  // areas that would be too slow in JavaScript. Returns null where WebGL is unavailable.
  //   pass.texture(name, source)              upload an image, video or canvas
  //   pass.data(name, w, h, rgbaBytes)        upload a Uint8Array (straight alpha)
  //   pass.run(w, h, { name: number | [x, y] | [x, y, z] })   draw; the result is pass.canvas
  // The shader gets `varying vec2 uv` (0,0 at the top left) and one sampler per texture name.
  // Textures are bilinear and clamped at the edges (any size, no mipmaps).
  fx.shaderPass = function (frag, textures) {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return null;
    function shader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('Magi shader:', gl.getShaderInfoLog(sh));
      return sh;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER,
      'attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    var units = {}, uniforms = {};
    textures.forEach(function (name, i) {
      var t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), i);
      units[name] = i;
    });
    return {
      canvas: c,
      texture: function (name, source) {
        gl.activeTexture(gl.TEXTURE0 + units[name]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      },
      data: function (name, w, h, bytes) {
        gl.activeTexture(gl.TEXTURE0 + units[name]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      },
      run: function (w, h, values) {
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        gl.viewport(0, 0, w, h);
        Object.keys(values).forEach(function (name) {
          if (!(name in uniforms)) uniforms[name] = gl.getUniformLocation(prog, name);
          var v = values[name], u = uniforms[name];
          if (typeof v === 'number') gl.uniform1f(u, v);
          else if (v.length === 2) gl.uniform2f(u, v[0], v[1]);
          else gl.uniform3f(u, v[0], v[1], v[2]);
        });
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  };

  fx.createModeRenderer = function (modes, fallback) {
    var made = {};
    var current = null;
    function get(id) {
      if (!modes[id]) id = fallback;
      return made[id] || (made[id] = modes[id]());
    }
    return {
      get animated() { return !!(current && current.animated); },
      render: function (frame, out, params) {
        current = get(params.mode);
        current.render(frame, out, params);
      },
      reset: function () { Object.keys(made).forEach(function (id) { made[id].reset(); }); }
    };
  };
})();
