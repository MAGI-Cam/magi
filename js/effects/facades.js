// Facades: the camera as the sun, seen through an adaptive building envelope.
//
// Each module (panel, louver, fin, cushion, pane, pixel) reads the light (or, for Interactive,
// the motion) behind it and actuates toward a target a* with first-order lag, the way a facade
// drive or a switchable glazing layer responds:
//     a(t + dt) = a* + (a(t) − a*)·e^(−dt/τ)
// "Shade" on: modules close against bright light, as a shading facade does. Off: they open to it.
// Each facade's own geometry follows the mechanism it is named for; see the notes on each.
(function () {
  var fx = Magi.fx;
  // Module size in screen pixels for each Scale step (1–9).
  var MODULE = [28, 36, 44, 54, 66, 80, 96, 116, 140];
  var GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.507…°, the golden angle
  var SEAM = '#111111';

  function gray(v) { // v in 0–1
    var g = Math.round(110 + v * 132);
    return 'rgb(' + g + ',' + g + ',' + (g - 3) + ')';
  }

  // Light, motion and color behind the frame on a coarse grid, read by position.
  function createSignal() {
    var c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    var gw = 0, gh = 0, fw = 1, fh = 1, fields = null;
    return {
      update: function (frame) {
        var w = 96, h = Math.max(1, Math.round(96 * frame.height / frame.width));
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
  // spec.layout(w, h, m) → modules; spec.target(module, signal, params, dt, tau) → a* (optional);
  // spec.draw(ctx, module, a, m, frame, signal); spec.before / spec.after for shared layers.
  function facade(spec) {
    return function () {
      var signal = createSignal(), modules = null, state = null, key = '', last = 0;
      return {
        animated: true,
        render: function (frame, out, params) {
          var w = frame.width, h = frame.height;
          if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
          var ctx = out.getContext('2d');
          var m = fx.cellSize(MODULE, params.scale, frame);
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
            var target = spec.target ? spec.target(md, signal, params, dt, tau)
              : closure(signal.mean('lum', md.x0, md.y0, md.x1, md.y1), params);
            state[i] += (target - state[i]) * ease;
          }

          ctx.save();
          frame.draw(ctx, w, h);
          ctx.lineWidth = Math.max(1, frame.pxPerCss * 0.9);
          ctx.strokeStyle = SEAM;
          if (spec.before) spec.before(ctx, w, h, m, frame);
          for (var j = 0; j < modules.length; j++) spec.draw(ctx, modules[j], state[j], m, frame, signal);
          if (spec.after) spec.after(ctx, modules, state, m, w, h, frame);
          ctx.restore();
        },
        reset: function () { key = ''; }
      };
    };
  }

  function grid(w, h, cw, ch, make) {
    var out = [];
    for (var y = 0; y < h; y += ch) {
      for (var x = 0; x < w; x += cw) out.push(make(x, y, cw, ch));
    }
    return out;
  }

  function rectModule(x, y, cw, ch) {
    return { x: x, y: y, w: cw, h: ch, x0: x, y0: y, x1: x + cw, y1: y + ch };
  }

  // Translation: panels slide sideways in their bays (rigid translation along a track).
  // Panel offset = (1 − a)·0.92·bay width, so an open panel parks over its neighbor.
  var translation = facade({
    layout: function (w, h, m) { return grid(w + m, h, m, m * 1.5, rectModule); },
    draw: function (ctx, md, a, m) {
      var x = md.x + (1 - a) * 0.92 * md.w, inset = md.h * 0.04;
      ctx.fillStyle = gray(0.85);
      ctx.fillRect(x, md.y + inset, md.w, md.h - inset * 2);
      ctx.fillStyle = gray(0.62);
      var slat = Math.max(2, md.w / 9);
      for (var sx = x + slat; sx < x + md.w - 1; sx += slat) ctx.fillRect(sx, md.y + inset * 2, 1, md.h - inset * 4);
      ctx.strokeRect(x + 0.5, md.y + inset + 0.5, md.w - 1, md.h - inset * 2 - 1);
    },
    after: function (ctx, modules, state, m, w, h) {
      ctx.fillStyle = SEAM;
      for (var y = 0; y < h; y += m * 1.5) ctx.fillRect(0, y, w, Math.max(1, m * 0.035)); // tracks
    }
  });

  // Scaling: triangular units on a triangular lattice, after the Al Bahar Towers' mashrabiya.
  // Each panel is the unit triangle under a homothety about its centroid G: P' = G + k·(P − G),
  // k = 0.06 + 0.94·a, drawn as three facets folding toward the hub.
  var scaling = facade({
    layout: function (w, h, m) {
      var out = [], th = m * Math.sqrt(3) / 2;
      for (var r = 0, y = 0; y < h; r++, y += th) {
        for (var i = 0; ; i++) {
          var L = i * m / 2 - m + (r % 2 ? m / 2 : 0);
          if (L > w) break;
          var up = i % 2 === 0;
          var v = up ? [[L, y + th], [L + m, y + th], [L + m / 2, y]] : [[L, y], [L + m, y], [L + m / 2, y + th]];
          var gx = (v[0][0] + v[1][0] + v[2][0]) / 3, gy = (v[0][1] + v[1][1] + v[2][1]) / 3;
          out.push({ v: v, gx: gx, gy: gy, x0: L, y0: y, x1: L + m, y1: y + th });
        }
      }
      return out;
    },
    draw: function (ctx, md, a) {
      var k = 0.06 + 0.94 * a, p = md.v.map(function (q) {
        return [md.gx + k * (q[0] - md.gx), md.gy + k * (q[1] - md.gy)];
      });
      for (var f = 0; f < 3; f++) {
        var A = p[f], B = p[(f + 1) % 3];
        // Facet brightness from its direction against light from the upper left.
        var mx = (A[0] + B[0]) / 2 - md.gx, my = (A[1] + B[1]) / 2 - md.gy, len = Math.hypot(mx, my) || 1;
        ctx.fillStyle = gray(0.55 + 0.4 * (-(mx * 0.6 + my * 0.8) / len));
        ctx.beginPath();
        ctx.moveTo(md.gx, md.gy);
        ctx.lineTo(A[0], A[1]);
        ctx.lineTo(B[0], B[1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    },
    after: function (ctx, modules) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      modules.forEach(function (md) {
        ctx.moveTo(md.v[0][0], md.v[0][1]);
        ctx.lineTo(md.v[1][0], md.v[1][1]);
        ctx.lineTo(md.v[2][0], md.v[2][1]);
        ctx.closePath();
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  // Rolling: roller blinds in each window bay. Unrolled length l = a·L. The fabric left on the
  // roller keeps its area, so the roll radius is r = √(r₀² + t·(L − l)/π): fatter when raised.
  var rolling = facade({
    layout: function (w, h, m) { return grid(w, h, m, m * 1.6, rectModule); },
    draw: function (ctx, md, a, m, frame) {
      var L = md.h * 0.94, r0 = m * 0.035, rMax = m * 0.11;
      var t = Math.PI * (rMax * rMax - r0 * r0) / L;           // fabric thickness that fills the roll
      var l = a * L, r = Math.sqrt(r0 * r0 + t * (L - l) / Math.PI);
      var x = md.x + m * 0.06, bw = md.w - m * 0.12, top = md.y + rMax;
      if (l > 1) {
        ctx.fillStyle = gray(0.82);
        ctx.fillRect(x, top, bw, l);
        ctx.fillStyle = gray(0.66);
        var weave = Math.max(2, 3 * frame.pxPerCss);
        for (var y = top + weave; y < top + l; y += weave) ctx.fillRect(x, y, bw, 1);
        ctx.fillStyle = gray(0.35);
        ctx.fillRect(x, top + l - Math.max(2, m * 0.04), bw, Math.max(2, m * 0.04)); // hem bar
      }
      ctx.fillStyle = gray(0.5);
      ctx.fillRect(x, top - r, bw, 2 * r);                     // the roll
      ctx.fillStyle = gray(0.9);
      ctx.fillRect(x, top - r * 0.35, bw, Math.max(1, r * 0.3));
      ctx.strokeRect(md.x + 0.5, md.y + 0.5, md.w - 1, md.h - 1); // window frame
    }
  });

  // Bending: vertical lamellae in tiers, each a cantilever clamped at the top and bent by a tip
  // load (Euler–Bernoulli): w(y) = δ·(y/L)²·(3 − y/L)/2. As a fin bends it twists toward the
  // viewer, so its visible width grows with the slope dw/dy.
  var bending = facade({
    layout: function (w, h, m) {
      var out = [], gap = m * 0.5, L = m * 3;
      for (var y = 0; y < h; y += L) {
        for (var x = gap / 2; x < w + gap; x += gap) out.push({ x: x, y: y, L: L, gap: gap, x0: x - gap / 2, y0: y, x1: x + gap / 2, y1: y + L });
      }
      return out;
    },
    draw: function (ctx, md, a) {
      var delta = a * md.gap * 1.6, t0 = md.gap * 0.16, N = 28, left = [], right = [];
      for (var i = 0; i <= N; i++) {
        var u = i / N, y = md.y + u * md.L;
        var wv = delta * u * u * (3 - u) / 2;
        var slope = delta * (6 * u - 3 * u * u) / (2 * md.L);
        var half = (t0 + Math.abs(slope) * md.gap * 0.9) / 2;
        left.push([md.x + wv - half, y]);
        right.push([md.x + wv + half, y]);
      }
      ctx.fillStyle = gray(0.86);
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      left.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
      for (var j = right.length - 1; j >= 0; j--) ctx.lineTo(right[j][0], right[j][1]);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath(); // shadow edge
      right.forEach(function (p, k) { k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.stroke();
    },
    after: function (ctx, modules, state, m, w, h) {
      ctx.fillStyle = SEAM;
      for (var y = 0; y < h; y += m * 3) ctx.fillRect(0, y, w, Math.max(2, m * 0.05)); // clamping beams
    }
  });

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

  // Active: pneumatic ETFE cushions on a rhombic cable net (after Media-TIC). Each cushion is a
  // paraboloid membrane z = p·(1 − ρ²) whose rise p follows the light. Contours are drawn at
  // equal heights Δ: ρₖ = √(1 − kΔ/p), so a fuller cushion shows more rings.
  var active = facade({
    layout: function (w, h, m) {
      var cw = m, ch = m * 1.35, out = [];
      for (var j = 0, y = 0; y < h + ch; j++, y += ch / 2) {
        for (var x = (j % 2 ? cw / 2 : 0); x < w + cw; x += cw) {
          out.push({ x: x, y: y, cw: cw, ch: ch, x0: x - cw / 2, y0: y - ch / 2, x1: x + cw / 2, y1: y + ch / 2 });
        }
      }
      return out;
    },
    draw: function (ctx, md, p) {
      function diamond(s) {
        ctx.beginPath();
        ctx.moveTo(md.x, md.y - md.ch / 2 * s);
        ctx.lineTo(md.x + md.cw / 2 * s, md.y);
        ctx.lineTo(md.x, md.y + md.ch / 2 * s);
        ctx.lineTo(md.x - md.cw / 2 * s, md.y);
        ctx.closePath();
      }
      diamond(1);
      ctx.fillStyle = 'rgba(238,238,234,' + (0.08 + 0.55 * p).toFixed(3) + ')'; // frit grows with rise
      ctx.fill();
      var step = 0.14;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      for (var k = 1; k * step < p; k++) {
        diamond(Math.sqrt(1 - k * step / p));
        ctx.stroke();
      }
      ctx.restore();
      diamond(1);
      ctx.stroke(); // cable net
    },
    after: function (ctx, modules, state, m) {
      ctx.fillStyle = gray(0.25);
      modules.forEach(function (md) { // cable nodes
        ctx.beginPath();
        ctx.arc(md.x, md.y - md.ch / 2, Math.max(1.5, m * 0.045), 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  // Smart: electrochromic glazing. Each pane tints by first-order kinetics toward a target set
  // by the glare behind it. Ions enter from the busbars at the edges, so the edge tints first
  // and the center follows with a longer time constant (the "iris" seen on real EC glass).
  var smart = facade({
    lag: 2,
    layout: function (w, h, m) {
      return grid(w, h, m * 1.2, m * 1.5, function (x, y, cw, ch) {
        var md = rectModule(x, y, cw, ch);
        md.center = 0;
        md.seeded = false;
        return md;
      });
    },
    target: function (md, signal, params, dt, tau) {
      var t = closure(signal.mean('lum', md.x0, md.y0, md.x1, md.y1), params);
      if (!md.seeded) { md.center = t; md.seeded = true; }
      md.center += (t - md.center) * (1 - Math.exp(-dt / (tau * 2.2)));
      return t;
    },
    draw: function (ctx, md, edge) {
      var cx = md.x + md.w / 2, cy = md.y + md.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(md.w / md.h, 1);
      var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, md.h * 0.72);
      gr.addColorStop(0, 'rgba(8,10,14,' + (md.center * 0.86).toFixed(3) + ')');
      gr.addColorStop(0.55, 'rgba(8,10,14,' + (md.center * 0.86).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(8,10,14,' + (edge * 0.86).toFixed(3) + ')');
      ctx.fillStyle = gr;
      ctx.fillRect(-md.h / 2, -md.h / 2, md.h, md.h);
      ctx.restore();
    },
    after: function (ctx, modules, state, m, w, h) {
      var bar = Math.max(2, m * 0.07);
      ctx.fillStyle = SEAM;
      for (var x = 0; x < w; x += m * 1.2) ctx.fillRect(x - bar / 2, 0, bar, h);        // mullions
      for (var y = 0; y < h; y += m * 1.5) ctx.fillRect(0, y - bar / 2, w, bar * 0.7);  // transoms
    }
  });

  // Interactive: pivoting louvers that answer movement in front of them. A module whose motion
  // passes the threshold turns face-on for 1.2 s, then turns back. A louver at angle θ shows a
  // projected width of m·cos θ and catches light in proportion to cos θ.
  var interactive = facade({
    lag: 0.25,
    layout: function (w, h, m) {
      return grid(w, h, m, m, function (x, y, cw, ch) {
        var md = rectModule(x, y, cw, ch);
        md.hold = 0;
        return md;
      });
    },
    target: function (md, signal, params, dt) {
      var threshold = 0.035 * Math.pow(2, (50 - params.response) / 25);
      if (signal.mean('motion', md.x0, md.y0, md.x1, md.y1) > threshold) md.hold = 1.2;
      else md.hold = Math.max(0, md.hold - dt);
      return (md.hold > 0) === !!params.shade ? 1 : 0;
    },
    draw: function (ctx, md, a, m) {
      var cos = Math.cos((1 - a) * Math.PI / 2), pw = md.w * 0.94 * cos, cx = md.x + md.w / 2;
      ctx.fillStyle = SEAM;
      ctx.fillRect(cx - 0.5, md.y, 1, md.h); // pivot rod
      if (pw < 0.75) return;
      ctx.fillStyle = gray(0.3 + 0.65 * cos);
      ctx.fillRect(cx - pw / 2, md.y + md.h * 0.03, pw, md.h * 0.94);
    }
  });

  // Electrokinetic pixel glazing: each pixel holds colored particles in clear fluid. Driven, they
  // spread across the pixel (colored); released, they compact into a small reservoir (clear).
  // The spread area follows the signal, so the disc radius is r = R·√a.
  var electrokinetic = facade({
    layout: function (w, h, m) {
      var p = m * 0.42, rowH = p * Math.sqrt(3) / 2, out = [];
      for (var j = 0, y = 0; y < h + p; j++, y += rowH) {
        for (var x = (j % 2 ? p / 2 : 0); x < w + p; x += p) {
          out.push({ x: x, y: y, p: p, x0: x - p / 2, y0: y - p / 2, x1: x + p / 2, y1: y + p / 2 });
        }
      }
      return out;
    },
    before: function (ctx, w, h) {
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fillRect(0, 0, w, h);
    },
    draw: function (ctx, md, a, m, frame, signal) {
      var c = signal.color(md.x, md.y);
      var rgb = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
      var R = md.p * 0.52, r = R * Math.sqrt(a);
      ctx.fillStyle = rgb;
      if (r > 0.4) {
        ctx.beginPath();
        ctx.arc(md.x, md.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1 - a; // compacted particles in the reservoir
      ctx.fillRect(md.x - R * 0.7, md.y - R * 0.7, Math.max(1, R * 0.16), Math.max(1, R * 0.16));
      ctx.globalAlpha = 1;
    }
  });

  Magi.renderers['facade-interactive'] = interactive;
  Magi.renderers['facade-active'] = active;
  Magi.renderers['facade-biomimetic'] = biomimetic;
  Magi.renderers['facade-smart'] = smart;
  Magi.renderers['facade-bending'] = bending;
  Magi.renderers['facade-translation'] = translation;
  Magi.renderers['facade-scaling'] = scaling;
  Magi.renderers['facade-rolling'] = rolling;
  Magi.renderers['facade-electrokinetic'] = electrokinetic;
})();
