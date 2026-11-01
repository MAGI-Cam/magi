// Facades: the camera as the sun, seen through an adaptive building envelope.
//
// Each module (louver, cushion, panel, scale, pixel) reads the light (or, for Interactive, the
// motion) behind it and actuates toward a target a* with first-order lag, the way a facade drive
// or a switchable glazing layer responds:
//     a(t + dt) = a* + (a(t) − a*)·e^(−dt/τ)
// "Shade" on: modules close against bright light, as a shading facade does. Off: they open to it.
// Each facade's geometry follows the mechanism it is named for; see the notes on each.
(function () {
  var fx = Magi.fx;
  // Module size in screen pixels per Scale step. Interactive and Electrokinetic go finer.
  var MODULE = [28, 36, 44, 54, 66, 80, 96, 116, 140];
  var MODULE_FINE = [8, 12, 16, 22, 28, 36, 44, 54, 66, 80, 96, 116, 140];
  var MODULE_PIXEL = [16, 20, 24, 28, 36, 44, 54, 66, 80, 96, 116, 140];
  var GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.507…°, the golden angle
  var SQRT3 = Math.sqrt(3);
  var SEAM = '#111111';

  function gray(v) { // v in 0–1
    var g = Math.round(110 + v * 132);
    return 'rgb(' + g + ',' + g + ',' + (g - 3) + ')';
  }

  function rgb(c, k) { // c: [r, g, b] in 0–1, k: brightness
    return 'rgb(' + Math.round(c[0] * k * 255) + ',' + Math.round(c[1] * k * 255) + ',' + Math.round(c[2] * k * 255) + ')';
  }

  // Ink from the Color slider, blended toward the camera's own color by Saturation.
  function tint(params, src) {
    var ink = fx.inkColor(params.color), s = (params.saturation || 0) / 100;
    return [ink[0] + (src[0] - ink[0]) * s, ink[1] + (src[1] - ink[1]) * s, ink[2] + (src[2] - ink[2]) * s];
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
  // spec.draw(ctx, module, a, m, frame, signal, params); spec.before for a shared backdrop;
  // spec.paint(ctx, modules, state, w, h, signal, params) replaces per-module drawing entirely.
  function facade(spec) {
    return function () {
      var signal = createSignal(), modules = null, state = null, key = '', last = 0;
      return {
        animated: true,
        render: function (frame, out, params) {
          var w = frame.width, h = frame.height;
          if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
          var ctx = out.getContext('2d');
          var m = fx.cellSize(spec.sizes || MODULE, params.scale, frame);
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

          ctx.save();
          frame.draw(ctx, w, h);
          ctx.lineWidth = Math.max(1, frame.pxPerCss * 0.9);
          ctx.strokeStyle = SEAM;
          if (spec.before) spec.before(ctx, w, h);
          if (spec.paint) spec.paint(ctx, modules, state, w, h, signal, params);
          else for (var j = 0; j < modules.length; j++) spec.draw(ctx, modules[j], state[j], m, frame, signal, params);
          if (spec.after) spec.after(ctx, w, h, m);
          ctx.restore();
        },
        reset: function () { key = ''; }
      };
    };
  }

  function rectModule(x, y, cw, ch) {
    return { x: x + cw / 2, y: y + ch / 2, w: cw, h: ch, x0: x, y0: y, x1: x + cw, y1: y + ch };
  }

  // Tilings shared by Active and Electrokinetic. Each module has a center (x, y), a polygon
  // relative to that center (null for circles) and a sample rectangle.
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
      // Equilateral triangles of side m, alternating up and down; centers at the centroids.
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
    } else { // diamond: rhombi m wide and 1.35m tall, rows offset by half
      var dw = m, dh = m * 1.35, rh = [[0, -dh / 2], [dw / 2, 0], [0, dh / 2], [-dw / 2, 0]];
      for (var dj = 0, dy = 0; dy < h + dh; dj++, dy += dh / 2) {
        for (var dx = (dj % 2 ? dw / 2 : 0); dx < w + dw; dx += dw) add(dx, dy, rh, dw / 2, dh / 2);
      }
    }
    return out;
  }

  // Traces a module's polygon (or circle) scaled by k about its center.
  function shapePath(ctx, md, k) {
    ctx.beginPath();
    if (!md.poly) {
      ctx.arc(md.x, md.y, (md.size / 2) * k, 0, Math.PI * 2);
      return;
    }
    md.poly.forEach(function (q, i) {
      var x = md.x + q[0] * k, y = md.y + q[1] * k;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
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
        var md = rectModule(x, y, m, m);
        md.hold = 0;
        out.push(md);
      }
      return out;
    },
    target: function (md, signal, params, dt) {
      var threshold = 0.035 * Math.pow(2, (50 - params.response) / 25);
      if (signal.mean('motion', md.x0, md.y0, md.x1, md.y1) > threshold) md.hold = 1.2;
      else md.hold = Math.max(0, md.hold - dt);
      return (md.hold > 0) === !!params.shade ? 1 : 0;
    },
    draw: function (ctx, md, a, m, frame, signal, params) {
      var cos = Math.cos((1 - a) * Math.PI / 2), pw = md.w * 0.94 * cos;
      if (pw < 0.75) return;
      ctx.fillStyle = rgb(tint(params, signal.color(md.x, md.y)), 0.35 + 0.65 * cos);
      ctx.fillRect(md.x - pw / 2, md.y0 + md.h * 0.03, pw, md.h * 0.94);
    }
  });

  // Active: pneumatic ETFE cushions (after Media-TIC), in square, hexagonal, triangular or
  // diamond tilings. Each cushion is a paraboloid membrane z = p·(1 − ρ²) whose rise p follows
  // the light. Contours at equal heights Δ sit at ρₖ = √(1 − kΔ/p), so fuller cushions show more
  // rings, and the frit thickens with the rise.
  function active(shape) {
    return facade({
      layout: function (w, h, m) { return tiling(shape, w, h, m); },
      draw: function (ctx, md, p) {
        shapePath(ctx, md, 0.98);
        ctx.fillStyle = 'rgba(238,238,234,' + (0.08 + 0.55 * p).toFixed(3) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        for (var k = 1, step = 0.14; k * step < p; k++) {
          shapePath(ctx, md, 0.98 * Math.sqrt(1 - k * step / p));
          ctx.stroke();
        }
      }
    });
  }

  // Biomimetic: hygromorphic scales, like a pine cone that opens as it dries, placed by Vogel's
  // model of phyllotaxis: scale n sits at angle n·137.507° and radius c·√n. An opening scale
  // lifts by φ = (1 − a)·72°, so its projected length shrinks to ℓ·cos φ.
  var biomimetic = facade({
    layout: function (w, h, m) {
      var c = m * 0.42, cx = w / 2, cy = h / 2;
      var N = Math.ceil(Math.pow(Math.hypot(w, h) / 2 / c, 2)) + 12, out = [];
      for (var n = N; n >= 0; n--) { // outermost first, so inner scales overlap them
        var th = n * GOLDEN, r = c * Math.sqrt(n);
        var x = cx + r * Math.cos(th), y = cy + r * Math.sin(th);
        out.push({ x: x, y: y, th: th, c: c, x0: x - c, y0: y - c, x1: x + c, y1: y + c });
      }
      return out;
    },
    draw: function (ctx, md, a) {
      // A pointed scale from its base (toward the center) to its tip (outward). Neighbors in
      // Vogel's spiral sit about c·√π ≈ 1.77c apart, so a closed scale (1.85c wide, 2.3c long)
      // overlaps them the way a cone's scales do.
      var phi = (1 - a) * 1.25, len = md.c * 2.3 * Math.cos(phi), bulge = md.c * 1.85;
      if (len < 0.5) return;
      ctx.save();
      ctx.translate(md.x, md.y);
      ctx.rotate(md.th);
      ctx.fillStyle = gray(0.35 + 0.6 * Math.cos(phi));
      ctx.beginPath();
      ctx.moveTo(-md.c * 0.2, 0);
      ctx.quadraticCurveTo(len * 0.4, bulge, len, 0);
      ctx.quadraticCurveTo(len * 0.4, -bulge, -md.c * 0.2, 0);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  });

  // Translation: panels slide sideways in their bays (rigid translation along a track).
  // Panel offset = (1 − a)·0.92·bay width, so an open panel parks over its neighbor.
  var translation = facade({
    layout: function (w, h, m) {
      var out = [];
      for (var y = 0; y < h; y += m * 1.5) for (var x = 0; x < w + m; x += m) out.push(rectModule(x, y, m, m * 1.5));
      return out;
    },
    draw: function (ctx, md, a) {
      var x = md.x0 + (1 - a) * 0.92 * md.w, inset = md.h * 0.04;
      ctx.fillStyle = gray(0.85);
      ctx.fillRect(x, md.y0 + inset, md.w, md.h - inset * 2);
      ctx.fillStyle = gray(0.62);
      var slat = Math.max(2, md.w / 9);
      for (var sx = x + slat; sx < x + md.w - 1; sx += slat) ctx.fillRect(sx, md.y0 + inset * 2, 1, md.h - inset * 4);
      ctx.strokeRect(x + 0.5, md.y0 + inset + 0.5, md.w - 1, md.h - inset * 2 - 1);
    },
    after: function (ctx, w, h, m) {
      ctx.fillStyle = SEAM;
      for (var y = 0; y < h; y += m * 1.5) ctx.fillRect(0, y, w, Math.max(1, m * 0.035)); // tracks
    }
  });

  // Electrokinetic pixel glazing: each pixel holds colored particles in clear fluid. Driven, they
  // spread across the pixel (colored); released, they compact into a small reservoir (clear).
  // Spread area follows the signal, so the shape's linear size scales by √a.
  // Tens of thousands of pixels are too many to draw one by one, so each shape is rasterized
  // once at LEVELS sizes and stamped into a single pixel buffer per frame.
  var LEVELS = 24;

  // Pixel offsets (dx, dy from the center) covered by a module's shape at each size level.
  function maskSet(md) {
    var reach = Math.ceil(md.size * 0.9) + 2, side = reach * 2 + 1;
    var c = document.createElement('canvas');
    c.width = c.height = side;
    var g = c.getContext('2d', { willReadFrequently: true });
    var probe = { x: reach + 0.5, y: reach + 0.5, poly: md.poly, size: md.size };
    var set = [];
    for (var L = 0; L < LEVELS; L++) {
      g.clearRect(0, 0, side, side);
      g.fillStyle = '#fff';
      shapePath(g, probe, (L / (LEVELS - 1)) * 1.02);
      g.fill();
      var d = g.getImageData(0, 0, side, side).data, offs = [];
      for (var y = 0; y < side; y++) for (var x = 0; x < side; x++) if (d[(y * side + x) * 4 + 3] >= 128) offs.push(x - reach, y - reach);
      set.push(new Int16Array(offs));
    }
    return set;
  }

  function electrokinetic(shape) {
    var masks = {}, masksFor = '';
    return facade({
      sizes: MODULE_PIXEL,
      layout: function (w, h, m) { return tiling(shape, w, h, m * 0.42); },
      before: function (ctx, w, h) {
        ctx.fillStyle = 'rgba(0,0,0,0.82)';
        ctx.fillRect(0, 0, w, h);
      },
      paint: function (ctx, modules, state, w, h, signal, params) {
        if (!modules.length) return;
        var size = modules[0].size;
        if (masksFor !== String(size)) { masks = {}; masksFor = String(size); }
        var img = ctx.getImageData(0, 0, w, h), buf = new Uint32Array(img.data.buffer);
        for (var i = 0; i < modules.length; i++) {
          var md = modules[i], a = state[i];
          var set = masks[md.kind] || (masks[md.kind] = maskSet(md));
          var c = tint(params, signal.color(md.x, md.y));
          var color = 0xff000000 | (Math.round(c[2] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[0] * 255);
          var cx = Math.round(md.x), cy = Math.round(md.y);
          var offs = set[Math.round(Math.sqrt(a) * (LEVELS - 1))];
          for (var k = 0; k < offs.length; k += 2) {
            var x = cx + offs[k], y = cy + offs[k + 1];
            if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] = color;
          }
          if (a < 0.5) { // compacted particles in the reservoir at the pixel's corner
            var rx = Math.round(md.x - size * 0.36), ry = Math.round(md.y - size * 0.36);
            if (rx >= 0 && ry >= 0 && rx < w && ry < h) buf[ry * w + rx] = color;
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
  Magi.renderers['facade-active'] = modes(active, ['square', 'hexagon', 'triangle', 'diamond'], 'square');
  Magi.renderers['facade-biomimetic'] = biomimetic;
  Magi.renderers['facade-translation'] = translation;
  Magi.renderers['facade-electrokinetic'] = modes(electrokinetic, ['circle', 'square', 'hexagon', 'triangle', 'diamond'], 'circle');
})();
