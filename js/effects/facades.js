// Facades: the camera as the sun, seen through an adaptive building envelope.
//
// Each module reads the light (or, for Interactive, the motion) behind it and actuates toward a
// target a* with first-order lag, the way a facade drive or a switchable glazing layer responds:
//     a(t + dt) = a* + (a(t) − a*)·e^(−dt/τ)
// "Shade" on: modules close against bright light, as a shading facade does. Off: they open to it.
(function () {
  var fx = Magi.fx;
  // Module size in screen pixels per Scale step.
  var MODULE_FINE = [8, 12, 16, 22, 28, 36, 44, 54, 66, 80, 96, 116, 140];
  var MODULE_PIXEL = [16, 20, 24, 28, 36, 44, 54, 66, 80, 96, 116, 140];
  var SQRT3 = Math.sqrt(3);

  function rgb(c, k) { // c: [r, g, b] in 0–1, k: brightness
    return 'rgb(' + Math.round(c[0] * k * 255) + ',' + Math.round(c[1] * k * 255) + ',' + Math.round(c[2] * k * 255) + ')';
  }

  // Ink from the Color slider, blended toward the camera's own color by Saturation.
  function tint(params, src) {
    var ink = fx.inkColor(params.color), s = (params.saturation || 0) / 100;
    return [ink[0] + (src[0] - ink[0]) * s, ink[1] + (src[1] - ink[1]) * s, ink[2] + (src[2] - ink[2]) * s];
  }

  // The camera's color profile adjusted in HSV: hue rotated by the Color slider (0 = unchanged,
  // then once around the wheel) and saturation scaled by the Saturation slider (0 = gray).
  function profile(params, c) {
    var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]), d = max - min, h = 0;
    if (d > 0) {
      h = max === c[0] ? ((c[1] - c[2]) / d) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    }
    var shift = params.color > 0 ? ((params.color - 1) / 99) * 6 : 0;
    h = (((h + shift) % 6) + 6) % 6;
    var s = (max ? d / max : 0) * (params.saturation / 100), v = max;
    var x = v * s * (1 - Math.abs((h % 2) - 1)), m = v - v * s, cc = v * s;
    var t = [[cc, x, 0], [x, cc, 0], [0, cc, x], [0, x, cc], [x, 0, cc], [cc, 0, x]][Math.floor(h) % 6];
    return [t[0] + m, t[1] + m, t[2] + m];
  }

  // Light, motion and color behind the frame on a coarse grid, read by position.
  function createSignal() {
    var c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    var gw = 0, gh = 0, fw = 1, fh = 1, fields = null;
    return {
      update: function (frame) {
        var w = 128, h = Math.max(1, Math.round(128 * frame.height / frame.width));
        var fresh = false;
        if (w !== gw || h !== gh) { gw = c.width = w; gh = c.height = h; fields = null; }
        fw = frame.width;
        fh = frame.height;
        frame.draw(g, gw, gh);
        var d = g.getImageData(0, 0, gw, gh).data, n = gw * gh;
        if (!fields) {
          fields = { lum: new Float32Array(n), motion: new Float32Array(n), rgb: new Float32Array(n * 3) };
          fresh = true;
        }
        for (var i = 0; i < n; i++) {
          var r = d[i * 4] / 255, gg = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
          var l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
          var change = fresh ? 0 : Math.abs(l - fields.lum[i]);
          fields.motion[i] = Math.max(change, fields.motion[i] * 0.8);
          fields.lum[i] = l;
          var m = Math.max(r, gg, b, 0.04);
          fields.rgb[i * 3] = r / m;
          fields.rgb[i * 3 + 1] = gg / m;
          fields.rgb[i * 3 + 2] = b / m;
        }
      },
      // Mean of a field over a rectangle given in frame pixels.
      mean: function (name, x0, y0, x1, y1) {
        var f = fields[name];
        var ax = Math.max(0, Math.floor(x0 / fw * gw)), bx = Math.min(gw - 1, Math.floor(x1 / fw * gw));
        var ay = Math.max(0, Math.floor(y0 / fh * gh)), by = Math.min(gh - 1, Math.floor(y1 / fh * gh));
        if (bx < ax || by < ay) return name === 'lum' ? 0.5 : 0;
        var sum = 0, n = 0;
        for (var y = ay; y <= by; y++) for (var x = ax; x <= bx; x++) { sum += f[y * gw + x]; n++; }
        return sum / n;
      },
      color: function (x, y) {
        var ix = Math.min(gw - 1, Math.max(0, Math.floor(x / fw * gw)));
        var iy = Math.min(gh - 1, Math.max(0, Math.floor(y / fh * gh)));
        var i = (iy * gw + ix) * 3;
        return [fields.rgb[i], fields.rgb[i + 1], fields.rgb[i + 2]];
      }
    };
  }

  // Light → closure (0 open, 1 closed). Response sets the contrast around mid-gray.
  function closure(light, params) {
    var k = Math.pow(2, (params.response - 50) / 25);
    var v = Math.min(1, Math.max(0, (light - 0.5) * k + 0.5));
    return params.shade ? v : 1 - v;
  }

  // Generic facade: a layout of modules, each with a sample rectangle and a state a in 0–1.
  // spec.layout(w, h, m) → modules; spec.target(module, signal, params, dt) → a* (optional);
  // spec.draw(ctx, module, a, signal, params) per module over the camera, or
  // spec.paint(ctx, modules, state, frame, signal, params) to draw the whole frame itself.
  function facade(spec) {
    return function () {
      var signal = createSignal(), modules = null, state = null, key = '', last = 0;
      return {
        animated: true,
        render: function (frame, out, params) {
          var w = frame.width, h = frame.height;
          if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
          var ctx = out.getContext('2d');
          var m = fx.cellSize(spec.sizes, params.scale, frame);
          var k = w + 'x' + h + ':' + m;
          if (k !== key) {
            key = k;
            modules = spec.layout(w, h, m);
            state = new Float32Array(modules.length);
            last = 0;
          }
          // First frame after a layout change settles immediately; afterwards modules ease.
          var dt = last ? Math.min(0.1, (frame.time - last) / 1000) : 10;
          last = frame.time;
          signal.update(frame);

          // Speed → time constant τ, from about 2.5 s (slow) to 0.08 s (fast).
          var s = 1 - params.speed / 100;
          var tau = (0.08 + 2.4 * s * s) * (spec.lag || 1);
          var ease = 1 - Math.exp(-dt / tau);
          for (var i = 0; i < modules.length; i++) {
            var md = modules[i];
            var target = spec.target ? spec.target(md, signal, params, dt)
              : closure(signal.mean('lum', md.x0, md.y0, md.x1, md.y1), params);
            state[i] += (target - state[i]) * ease;
          }

          if (spec.paint) {
            spec.paint(ctx, modules, state, frame, signal, params);
            return;
          }
          ctx.save();
          frame.draw(ctx, w, h);
          for (var j = 0; j < modules.length; j++) spec.draw(ctx, modules[j], state[j], signal, params);
          ctx.restore();
        },
        reset: function () { key = ''; }
      };
    };
  }

  // Interactive: pivoting louvers that answer movement in front of them. A module whose motion
  // passes the threshold turns face-on for 1.2 s, then turns back. A louver at angle θ shows a
  // projected width of m·cos θ and catches light in proportion to cos θ.
  var interactive = facade({
    lag: 0.25,
    sizes: MODULE_FINE,
    layout: function (w, h, m) {
      var out = [];
      for (var y = 0; y < h; y += m) for (var x = 0; x < w; x += m) {
        out.push({ x: x + m / 2, y: y + m / 2, w: m, h: m, x0: x, y0: y, x1: x + m, y1: y + m, hold: 0 });
      }
      return out;
    },
    target: function (md, signal, params, dt) {
      var threshold = 0.035 * Math.pow(2, (50 - params.response) / 25);
      if (signal.mean('motion', md.x0, md.y0, md.x1, md.y1) > threshold) md.hold = 1.2;
      else md.hold = Math.max(0, md.hold - dt);
      return (md.hold > 0) === !!params.shade ? 1 : 0;
    },
    draw: function (ctx, md, a, signal, params) {
      var cos = Math.cos((1 - a) * Math.PI / 2), pw = md.w * 0.94 * cos;
      if (pw < 0.75) return;
      ctx.fillStyle = rgb(tint(params, signal.color(md.x, md.y)), 0.35 + 0.65 * cos);
      ctx.fillRect(md.x - pw / 2, md.y0 + md.h * 0.03, pw, md.h * 0.94);
    }
  });

  // Electrokinetic pixel glazing: each pixel holds colored particles in clear fluid. Driven, they
  // spread across the pixel (colored); released, they compact out of view (clear). Spread area
  // follows the signal, so the shape's linear size scales by √a.
  //
  // Tilings: circles and hexagons on a hexagonal lattice, squares on a square grid, triangles
  // alternating up and down, diamonds (rhombi 1.35 × taller than wide) on a staggered grid.
  function tiling(shape, w, h, m) {
    var out = [];
    function add(x, y, poly, rx, ry, kind) {
      out.push({ x: x, y: y, poly: poly, x0: x - rx, y0: y - ry, x1: x + rx, y1: y + ry, size: m, kind: kind || '' });
    }
    if (shape === 'square') {
      var sq = [[-m / 2, -m / 2], [m / 2, -m / 2], [m / 2, m / 2], [-m / 2, m / 2]];
      for (var y = m / 2; y < h + m; y += m) for (var x = m / 2; x < w + m; x += m) add(x, y, sq, m / 2, m / 2);
    } else if (shape === 'hexagon' || shape === 'circle') {
      // Pointy-top hexagons, width m: circumradius R = m/√3, rows 1.5R apart, odd rows offset m/2.
      var R = m / SQRT3, hex = [];
      for (var k = 0; k < 6; k++) hex.push([R * Math.cos(-Math.PI / 2 + k * Math.PI / 3), R * Math.sin(-Math.PI / 2 + k * Math.PI / 3)]);
      for (var j = 0, hy = 0; hy < h + R * 2; j++, hy += R * 1.5) {
        for (var hx = (j % 2 ? m / 2 : 0); hx < w + m; hx += m) add(hx, hy, shape === 'circle' ? null : hex, m / 2, R);
      }
    } else if (shape === 'triangle') {
      // Equilateral triangles of side m; centers at the centroids.
      var th = m * SQRT3 / 2;
      for (var r = 0, ty = 0; ty < h; r++, ty += th) {
        for (var i = 0; ; i++) {
          var L = i * m / 2 - m + (r % 2 ? m / 2 : 0);
          if (L > w) break;
          var up = i % 2 === 0;
          var v = up ? [[L, ty + th], [L + m, ty + th], [L + m / 2, ty]] : [[L, ty], [L + m, ty], [L + m / 2, ty + th]];
          var gx = (v[0][0] + v[1][0] + v[2][0]) / 3, gy = (v[0][1] + v[1][1] + v[2][1]) / 3;
          add(gx, gy, v.map(function (q) { return [q[0] - gx, q[1] - gy]; }), m / 2, th / 2, up ? 'up' : 'down');
        }
      }
    } else {
      var dw = m, dh = m * 1.35, rh = [[0, -dh / 2], [dw / 2, 0], [0, dh / 2], [-dw / 2, 0]];
      for (var dj = 0, dy = 0; dy < h + dh; dj++, dy += dh / 2) {
        for (var dx = (dj % 2 ? dw / 2 : 0); dx < w + dw; dx += dw) add(dx, dy, rh, dw / 2, dh / 2);
      }
    }
    return out;
  }

  function shapePath(ctx, md, cx, cy, k) {
    ctx.beginPath();
    if (!md.poly) {
      ctx.arc(cx, cy, (md.size / 2) * k, 0, Math.PI * 2);
      return;
    }
    md.poly.forEach(function (q, i) {
      var x = cx + q[0] * k, y = cy + q[1] * k;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
  }

  // Tens of thousands of pixels are too many to draw one call at a time, so each shape is
  // rasterized once (anti-aliased) per size level and per quarter-pixel position, and stamped
  // into one pixel buffer per frame. Stamping at the module's exact sub-pixel position keeps
  // neighbors aligned and edges smooth.
  var LEVELS = 32, PHASES = 4;

  function rasterize(md, k, px, py) {
    var reach = Math.ceil(md.size * 0.9) + 2, side = reach * 2 + 1;
    var c = rasterize.canvas || (rasterize.canvas = document.createElement('canvas'));
    if (c.width !== side) { c.width = c.height = side; }
    var g = c.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, side, side);
    g.fillStyle = '#fff';
    shapePath(g, md, reach + px, reach + py, k);
    g.fill();
    var d = g.getImageData(0, 0, side, side).data, offs = [], alpha = [];
    for (var y = 0; y < side; y++) {
      for (var x = 0; x < side; x++) {
        var a = d[(y * side + x) * 4 + 3];
        if (a) { offs.push(x - reach, y - reach); alpha.push(a); }
      }
    }
    return { offs: new Int16Array(offs), alpha: new Uint8Array(alpha) };
  }

  function electrokinetic(shape) {
    var cache = {}, cacheFor = '';
    // Work on a CPU-side canvas: reading pixels back from a GPU canvas every frame is slow.
    var work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
    return facade({
      sizes: MODULE_PIXEL,
      layout: function (w, h, m) { return tiling(shape, w, h, m * 0.42); },
      paint: function (ctx, modules, state, frame, signal, params) {
        var w = frame.width, h = frame.height;
        if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
        // Clear glass in front of a dim interior: the camera at 18% over black.
        wctx.globalAlpha = 1;
        wctx.fillStyle = '#000';
        wctx.fillRect(0, 0, w, h);
        wctx.globalAlpha = 0.18;
        frame.draw(wctx, w, h);
        wctx.globalAlpha = 1;
        var img = wctx.getImageData(0, 0, w, h), d = img.data;
        if (modules.length && cacheFor !== String(modules[0].size)) { cache = {}; cacheFor = String(modules[0].size); }
        for (var i = 0; i < modules.length; i++) {
          var md = modules[i], level = Math.round(Math.sqrt(state[i]) * (LEVELS - 1));
          if (!level) continue;
          var fx0 = Math.floor(md.x), fy0 = Math.floor(md.y);
          var phx = Math.round((md.x - fx0) * PHASES), phy = Math.round((md.y - fy0) * PHASES);
          if (phx === PHASES) { phx = 0; fx0++; }
          if (phy === PHASES) { phy = 0; fy0++; }
          var key = md.kind + phx + '.' + phy + ':' + level;
          var mask = cache[key] || (cache[key] = rasterize(md, (level / (LEVELS - 1)) * 1.02, phx / PHASES, phy / PHASES));
          var c = profile(params, signal.color(md.x, md.y));
          var r = c[0] * 255, g = c[1] * 255, b = c[2] * 255;
          var offs = mask.offs, alpha = mask.alpha;
          for (var k = 0, n = 0; k < offs.length; k += 2, n++) {
            var x = fx0 + offs[k], y = fy0 + offs[k + 1];
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            var p = (y * w + x) * 4, a = alpha[n] / 255;
            d[p] += (r - d[p]) * a;
            d[p + 1] += (g - d[p + 1]) * a;
            d[p + 2] += (b - d[p + 2]) * a;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
    });
  }

  function modes(make, ids, fallback) {
    var table = {};
    ids.forEach(function (id) { table[id] = make(id); });
    return function () { return fx.createModeRenderer(table, fallback); };
  }

  Magi.renderers['facade-interactive'] = interactive;
  Magi.renderers['facade-electrokinetic'] = modes(electrokinetic, ['circle', 'square', 'hexagon', 'triangle', 'diamond'], 'circle');
})();
