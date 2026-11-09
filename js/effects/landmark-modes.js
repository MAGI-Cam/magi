// Landmarks modes beyond the skeleton: Contour, Filaments and Attention. Each is a factory in
// Magi.landmarkModes returning draw(ctx, frame, ix, params); landmarks.js calls the one for the mode.
(function () {
  var LIME = '#c8f03c';
  Magi.landmarkModes = Magi.landmarkModes || {};

  // Edge points around the hands, shared by Contour and Line Art. Around each hand (its box grown by
  // 60% of the palm length, so it reaches the wrist) the picture's edge strength is measured with the
  // Sobel operator, |G| = √(Gx² + Gy²) with Gx, Gy the 3×3 Sobel kernels, on a 160-px-wide copy, and
  // n points are drawn with probability proportional to |G| (inverse-transform sampling over the
  // cumulative sum), so they gather on outlines and folds. sample() redraws them at most `rate`
  // times a second and returns the latest set: [{ x, y, v }], v the edge strength 0…1.
  Magi.contourSampler = function () {
    var ana = document.createElement('canvas'), actx = ana.getContext('2d', { willReadFrequently: true });
    var pts = [], lastDraw = -9;
    return function (frame, ix, n, rate) {
      var W = frame.width, H = frame.height, t = frame.time / 1000;
      if (!ix.hands.length) { pts = []; return pts; }
      if (rate > 0 && t - lastDraw < 1 / rate) return pts;
      lastDraw = t;
      var aw = 160, ah = Math.round(160 * H / W), sx = W / aw, sy = H / ah;
      if (ana.width !== aw || ana.height !== ah) { ana.width = aw; ana.height = ah; }
      frame.draw(actx, aw, ah);
      var d = actx.getImageData(0, 0, aw, ah).data, L = new Float32Array(aw * ah), i, x, y;
      for (i = 0; i < aw * ah; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      var boxes = ix.hands.map(function (h) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, g = h.size * 0.6;
        h.points.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
        return [Math.max(1, Math.floor((x0 - g) / sx)), Math.max(1, Math.floor((y0 - g) / sy)), Math.min(aw - 2, Math.ceil((x1 + g) / sx)), Math.min(ah - 2, Math.ceil((y1 + g * 1.5) / sy))];
      });
      var cells = [], cdf = [], sum = 0, seen = {};
      boxes.forEach(function (b) {
        for (y = b[1]; y <= b[3]; y++) for (x = b[0]; x <= b[2]; x++) {
          var k = y * aw + x;
          if (seen[k]) continue;
          seen[k] = 1;
          var gx = L[k - aw + 1] + 2 * L[k + 1] + L[k + aw + 1] - L[k - aw - 1] - 2 * L[k - 1] - L[k + aw - 1];
          var gy = L[k + aw - 1] + 2 * L[k + aw] + L[k + aw + 1] - L[k - aw - 1] - 2 * L[k - aw] - L[k - aw + 1];
          var m = Math.sqrt(gx * gx + gy * gy);
          if (m < 0.04) continue;
          sum += m; cells.push([x, y, m]); cdf.push(sum);
        }
      });
      var maxG = 0;
      cells.forEach(function (c) { maxG = Math.max(maxG, c[2]); });
      pts = [];
      for (var s = 0; s < n && cells.length; s++) {
        var r = Math.random() * sum, lo = 0, hi = cdf.length - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
        var c = cells[lo];
        pts.push({ x: (c[0] + Math.random()) * sx, y: (c[1] + Math.random()) * sy, v: c[2] / (maxG || 1) });
      }
      return pts;
    };
  };

  // Nearest-neighbor tour: start at the first point, always step to the closest unvisited one.
  Magi.nearestTour = function (pts) {
    if (!pts.length) return [];
    var left = pts.slice(1), tour = [pts[0]];
    while (left.length) {
      var last = tour[tour.length - 1], bi = 0, bd = Infinity;
      for (var j = 0; j < left.length; j++) { var dd = (left[j].x - last.x) * (left[j].x - last.x) + (left[j].y - last.y) * (left[j].y - last.y); if (dd < bd) { bd = dd; bi = j; } }
      tour.push(left.splice(bi, 1)[0]);
    }
    return tour;
  };

  // Contour (after a knitting-hands reference): points on the outlines of your hands and arms,
  // shown three ways (Style; a pinch steps to the next):
  //   Points — lime dots with a readout beside some of them: the edge strength there, 0…1, printed
  //            to seven decimals like a raw sensor value;
  //   Path   — the same points joined by a nearest-neighbor tour (start anywhere, always step to
  //            the closest unvisited point), whose long jumps between hands make wild loops;
  //   Fill   — that path filled by the even–odd rule as one flat, grainy lime shape.
  // The points come from Magi.contourSampler (above), redrawn Rate times a second.
  Magi.landmarkModes.contour = function () {
    var sample = Magi.contourSampler(), grainTile = null, wasPinched = false;
    function grain(ctx) {
      if (grainTile) return grainTile;
      var c = document.createElement('canvas'); c.width = c.height = 96;
      var g = c.getContext('2d'), im = g.createImageData(96, 96);
      for (var i = 0; i < im.data.length; i += 4) {
        var v = 170 + Math.random() * 85;
        im.data[i] = 200 * v / 255; im.data[i + 1] = 240 * v / 255; im.data[i + 2] = 60 * v / 255; im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      return (grainTile = ctx.createPattern(c, 'repeat'));
    }
    return function (ctx, frame, ix, params) {
      var u = frame.pxPerCss, hud = frame.hud;
      var pinched = ix.hands.some(function (h) { return h.pinched; });
      if (pinched && !wasPinched) frame.setParam('style', ((Math.round(params.style) || 0) + 1) % 3);
      wasPinched = pinched;
      var pts = sample(frame, ix, Math.round(params.points), Math.max(1, params.rate / 100 * 20));
      if (!pts.length) return;
      var style = Math.round(params.style) || 0;
      ctx.save();
      if (style >= 1) {
        var tour = Magi.nearestTour(pts);
        ctx.beginPath();
        tour.forEach(function (q, k) { k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
        if (style === 2) { ctx.closePath(); ctx.fillStyle = grain(ctx); ctx.fill('evenodd'); }
        else { ctx.strokeStyle = LIME; ctx.lineWidth = Math.max(1, 1.4 * u); ctx.lineJoin = 'round'; ctx.stroke(); }
      } else {
        ctx.fillStyle = LIME;
        var rr = Math.max(1.2, 1.6 * u);
        ctx.beginPath();
        pts.forEach(function (q) { ctx.moveTo(q.x + rr, q.y); ctx.arc(q.x, q.y, rr, 0, Math.PI * 2); });
        ctx.fill();
        if (params.labels) {
          hud.save();
          hud.fillStyle = LIME;
          hud.font = '500 ' + Math.round(8 * u) + 'px ' + Magi.fx.MONO;
          hud.textBaseline = 'middle';
          for (var k2 = 0; k2 < pts.length; k2 += 6) hud.fillText(pts[k2].v.toFixed(7), pts[k2].x + 4 * u, pts[k2].y);
          hud.restore();
        }
      }
      ctx.restore();
    };
  };

  // Filaments (after "Tactile perception of digital vines"): bundles of glowing strands strung
  // between your joints. Every edge (the hand's bones, neighboring fingertips, a fixed handful of
  // extra joint pairs, and with two hands matching fingertips and each fingertip to the other palm)
  // is drawn as Strands quadratic curves. A strand's control point sits at the edge's midpoint,
  // pushed sideways by 0.35 × the edge's length × sin(ωt + φ), ω and φ its own, and its ends are
  // spread by ±2% of the length, so each bundle is thin at the joints and full in the middle and
  // flexes like fibers. Strands blend green to cyan (a few violet) and are added like light (Glow
  // adds a soft wide pass). Rings mark the fingertips. Bio-signals: one bright pulse per edge runs
  // from end to end at its own speed.
  var FIL_TIPS = [4, 8, 12, 16, 20];
  Magi.landmarkModes.filaments = function () {
    var extras = [];
    for (var e = 0; e < 10; e++) { var a = Math.floor(Math.random() * 21), b = Math.floor(Math.random() * 21); if (a !== b) extras.push([a, b]); }
    var phases = {};
    function phase(key, k) { var id = key + ':' + k; return phases[id] || (phases[id] = [Math.random() * 6.28, 0.6 + Math.random() * 1.6, Math.random()]); }
    return function (ctx, frame, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
      ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      var C = (Magi.tracking.connections && Magi.tracking.connections.hand) || [];
      var hs = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands, edges = [];
      hs.forEach(function (h, hi) {
        var p = h.points;
        C.forEach(function (c) { edges.push(['b' + hi + c.start + '-' + c.end, p[c.start], p[c.end]]); });
        for (var k = 0; k < 4; k++) edges.push(['t' + hi + k, p[FIL_TIPS[k]], p[FIL_TIPS[k + 1]]]);
        extras.forEach(function (x, k) { edges.push(['x' + hi + k, p[x[0]], p[x[1]]]); });
      });
      if (hs.length === 2) {
        FIL_TIPS.forEach(function (tp, k) {
          edges.push(['m' + k, hs[0].points[tp], hs[1].points[tp]]);
          edges.push(['c0' + k, hs[0].points[tp], hs[1].center]);
          edges.push(['c1' + k, hs[1].points[tp], hs[0].center]);
        });
      }
      var n = Math.round(params.strands), bins = [[], [], []], pulses = [];
      edges.forEach(function (ed) {
        var A = ed[1], B = ed[2], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
        for (var k = 0; k < n; k++) {
          var ph = phase(ed[0], k), sw = 0.35 * L * Math.sin(t * ph[1] + ph[0]), sp = (k / Math.max(1, n - 1) - 0.5) * 0.04 * L;
          var mx = (A.x + B.x) / 2 + nx * sw, my = (A.y + B.y) / 2 + ny * sw;
          bins[ph[2] < 0.12 ? 2 : ph[2] < 0.55 ? 0 : 1].push([A.x + nx * sp, A.y + ny * sp, mx, my, B.x + nx * sp, B.y + ny * sp]);
        }
        var pp = phase(ed[0], 'p'), f = (t * 0.35 * pp[1] + pp[0]) % 1, s0 = phase(ed[0], 0), sw0 = 0.35 * L * Math.sin(t * s0[1] + s0[0]);
        var cx = (A.x + B.x) / 2 + nx * sw0, cy = (A.y + B.y) / 2 + ny * sw0;
        pulses.push([(1 - f) * (1 - f) * A.x + 2 * (1 - f) * f * cx + f * f * B.x, (1 - f) * (1 - f) * A.y + 2 * (1 - f) * f * cy + f * f * B.y]);
      });
      var cols = ['61,255,122', '95,216,255', '190,120,255'], glow = params.glow / 100;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      bins.forEach(function (list, bi) {
        if (!list.length) return;
        ctx.beginPath();
        list.forEach(function (q) { ctx.moveTo(q[0], q[1]); ctx.quadraticCurveTo(q[2], q[3], q[4], q[5]); });
        if (glow > 0) { ctx.strokeStyle = 'rgba(' + cols[bi] + ',' + (0.05 * glow).toFixed(3) + ')'; ctx.lineWidth = 5 * u; ctx.stroke(); }
        ctx.strokeStyle = 'rgba(' + cols[bi] + ',0.32)';
        ctx.lineWidth = Math.max(0.6, 0.7 * u);
        ctx.stroke();
      });
      // Bio-signal pulses.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      pulses.forEach(function (q) { ctx.moveTo(q[0] + 1.6 * u, q[1]); ctx.arc(q[0], q[1], 1.6 * u, 0, Math.PI * 2); });
      ctx.fill();
      ctx.restore();
      // Node rings at the fingertips; a pink spot on each index tip.
      ctx.save();
      ctx.strokeStyle = 'rgba(160,255,190,0.85)';
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      hs.forEach(function (h) { FIL_TIPS.forEach(function (tp) { var q = h.points[tp]; ctx.moveTo(q.x + 7 * u, q.y); ctx.arc(q.x, q.y, 7 * u, 0, Math.PI * 2); }); });
      ctx.stroke();
      ctx.fillStyle = 'rgb(255,120,220)';
      hs.forEach(function (h) { var q = h.points[8]; ctx.beginPath(); ctx.arc(q.x, q.y, 2.6 * u, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();
    };
  };

  // Attention (after "the topology of attention"): your image library as a Mapper graph, the
  // topological summary used in topological data analysis (Singh, Mémoli & Carlsson 2007).
  // Features: the feed's own embedding for each image if it carries one (see docs/ROADMAP.md);
  // otherwise color: mean brightness, two opponent channels (R − G, (R + G)/2 − B), mean
  // saturation and a saturation-weighted 6-bin hue histogram, from a 16×16 copy; standardized.
  // Lens: the first principal component (power iteration on the covariance). Cover: six intervals
  // of the lens overlapping by 30%. In each, images closer than ε (1.5 × the median
  // nearest-neighbor distance) are joined by single linkage (union–find); each cluster is a node,
  // and nodes that share an image are joined by an edge. Layout: force-directed (Fruchterman–
  // Reingold: repulsion k²/d, attraction d²/k along edges, a pull to the center, kept inside the
  // frame), started from the
  // nodes' positions on the first two principal components. View: 0 Graph, 1 PCA (each image at
  // its first two principal components).
  // Gestures, after the reference's recognizer: Pointing_Up (only the index up) selects the node
  // under your fingertip and fans its images out; Closed_Fist pulls the graph in; Open_Palm spreads
  // it out. Without a feed, snapshots of the camera stand in. The camera sits in an inset.
  Magi.landmarkModes.attention = function () {
    var feats = new WeakMap(), model = null, modelKey = '', snaps = [], lastSnap = -9, scale = 1, sel = -1, lastT = null;
    var probe = document.createElement('canvas'), pctx = probe.getContext('2d', { willReadFrequently: true });
    probe.width = probe.height = 16;

    function feature(c) {
      if (feats.has(c)) return feats.get(c);
      var f;
      if (c.meta && Array.isArray(c.meta.embedding) && c.meta.embedding.length) f = c.meta.embedding.slice();
      else {
        pctx.clearRect(0, 0, 16, 16);
        pctx.drawImage(c, 0, 0, 16, 16);
        var d = pctx.getImageData(0, 0, 16, 16).data, L = 0, A = 0, B = 0, S = 0, hist = [0, 0, 0, 0, 0, 0];
        for (var i = 0; i < 256; i++) {
          var r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
          L += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 256; A += (r - g) / 256; B += ((r + g) / 2 - b) / 256; S += sat / 256;
          if (mx > mn) {
            var h = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
            hist[Math.floor(h) % 6] += sat / 256;
          }
        }
        f = [L, A, B, S].concat(hist);
      }
      feats.set(c, f);
      return f;
    }

    function pcs(X) {
      var n = X.length, d = X[0].length, mean = new Array(d).fill(0), sd = new Array(d).fill(0);
      X.forEach(function (x) { x.forEach(function (v, j) { mean[j] += v / n; }); });
      X.forEach(function (x) { x.forEach(function (v, j) { sd[j] += (v - mean[j]) * (v - mean[j]) / n; }); });
      var Z = X.map(function (x) { return x.map(function (v, j) { return (v - mean[j]) / (Math.sqrt(sd[j]) || 1); }); });
      function power(deflate) {
        var v = new Array(d).fill(0).map(function () { return Math.random() - 0.5; });
        for (var it = 0; it < 40; it++) {
          var w = new Array(d).fill(0);
          Z.forEach(function (z) {
            var dot = 0; for (var j = 0; j < d; j++) dot += z[j] * v[j];
            for (j = 0; j < d; j++) w[j] += dot * z[j];
          });
          if (deflate) { var p = 0; for (var j2 = 0; j2 < d; j2++) p += w[j2] * deflate[j2]; for (j2 = 0; j2 < d; j2++) w[j2] -= p * deflate[j2]; }
          var len = Math.hypot.apply(null, w) || 1; v = w.map(function (x) { return x / len; });
        }
        return v;
      }
      var v1 = power(null), v2 = power(v1);
      var proj = function (v) { return Z.map(function (z) { var s2 = 0; for (var j = 0; j < d; j++) s2 += z[j] * v[j]; return s2; }); };
      return { Z: Z, p1: proj(v1), p2: proj(v2) };
    }

    function mapper(items) {
      var X = items.map(feature), P = pcs(X), Z = P.Z, n = Z.length;
      var dist = function (a, b) { var s2 = 0; for (var j = 0; j < Z[a].length; j++) s2 += (Z[a][j] - Z[b][j]) * (Z[a][j] - Z[b][j]); return Math.sqrt(s2); };
      var nn = [];
      for (var i = 0; i < n; i++) { var m = Infinity; for (var k = 0; k < n; k++) if (k !== i) m = Math.min(m, dist(i, k)); nn.push(m); }
      var eps = 1.5 * (nn.slice().sort(function (a, b) { return a - b; })[n >> 1] || 1);
      var lo = Math.min.apply(null, P.p1), hi = Math.max.apply(null, P.p1), M = 6, ov = 0.3;
      var len = (hi - lo) / (M - (M - 1) * ov) || 1, nodes = [];
      for (var c = 0; c < M; c++) {
        var a0 = lo + c * len * (1 - ov), a1 = a0 + len, idx = [];
        for (i = 0; i < n; i++) if (P.p1[i] >= a0 - 1e-9 && P.p1[i] <= a1 + 1e-9) idx.push(i);
        var parent = {}; idx.forEach(function (q) { parent[q] = q; });
        var find = function (q) { while (parent[q] !== q) { parent[q] = parent[parent[q]]; q = parent[q]; } return q; };
        for (var x = 0; x < idx.length; x++) for (var y = x + 1; y < idx.length; y++) if (dist(idx[x], idx[y]) < eps) parent[find(idx[x])] = find(idx[y]);
        var groups = {};
        idx.forEach(function (q) { (groups[find(q)] = groups[find(q)] || []).push(q); });
        Object.keys(groups).forEach(function (g) { nodes.push({ members: groups[g] }); });
      }
      var edges = [];
      for (i = 0; i < nodes.length; i++) for (k = i + 1; k < nodes.length; k++) {
        if (nodes[i].members.some(function (q) { return nodes[k].members.indexOf(q) >= 0; })) edges.push([i, k]);
      }
      var s1 = Math.max(1e-6, hi - lo), lo2 = Math.min.apply(null, P.p2), s2 = Math.max(1e-6, Math.max.apply(null, P.p2) - lo2);
      nodes.forEach(function (nd) {
        var mx = 0, my = 0;
        nd.members.forEach(function (q) { mx += ((P.p1[q] - lo) / s1 * 2 - 1) / nd.members.length; my += ((P.p2[q] - lo2) / s2 * 2 - 1) / nd.members.length; });
        nd.x = mx * 0.8; nd.y = my * 0.8;
      });
      var pca = items.map(function (_, q) { return [(P.p1[q] - lo) / s1 * 2 - 1, (P.p2[q] - lo2) / s2 * 2 - 1]; });
      return { nodes: nodes, edges: edges, pca: pca, items: items };
    }

    function layout(m, dt) {
      var N = m.nodes.length, k = 1.1 / Math.sqrt(Math.max(1, N)), step = Math.min(0.05, dt * 0.6);
      for (var it = 0; it < 2; it++) {
        var dx = new Array(N).fill(0), dy = new Array(N).fill(0);
        for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
          var ex = m.nodes[i].x - m.nodes[j].x, ey = m.nodes[i].y - m.nodes[j].y, d = Math.hypot(ex, ey) || 1e-3, f = k * k / d;
          dx[i] += ex / d * f; dy[i] += ey / d * f; dx[j] -= ex / d * f; dy[j] -= ey / d * f;
        }
        m.edges.forEach(function (e) {
          var a = m.nodes[e[0]], b = m.nodes[e[1]], ex = a.x - b.x, ey = a.y - b.y, d = Math.hypot(ex, ey) || 1e-3, f = d * d / k;
          dx[e[0]] -= ex / d * f; dy[e[0]] -= ey / d * f; dx[e[1]] += ex / d * f; dy[e[1]] += ey / d * f;
        });
        m.nodes.forEach(function (nd, i2) {
          dx[i2] -= nd.x * 0.6; dy[i2] -= nd.y * 0.6;
          var l = Math.hypot(dx[i2], dy[i2]) || 1, mv = Math.min(l, 1) * step;
          nd.x = Math.max(-0.85, Math.min(0.85, nd.x + dx[i2] / l * mv)); nd.y = Math.max(-0.8, Math.min(0.8, nd.y + dy[i2] / l * mv));
        });
      }
    }

    return function (ctx, frame, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
      var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      var cam = document.createElement('canvas');
      var lib = Magi.library.get(params.feed), items = lib.items;
      if (!items.length) {
        if (t - lastSnap > 0.4 && snaps.length < 60) {
          lastSnap = t;
          var sc0 = document.createElement('canvas'), k0 = 160 / Math.max(W, H);
          sc0.width = Math.round(W * k0); sc0.height = Math.round(H * k0);
          frame.draw(sc0.getContext('2d'), sc0.width, sc0.height);
          snaps.push(sc0);
        }
        items = snaps;
      }
      // Inset camera first (drawn from the frame before the background covers it).
      var iw = W * 0.28, ih = iw * H / W, ix0 = W - iw - W * 0.03, iy0 = H - ih - H * 0.05;
      cam.width = Math.round(iw); cam.height = Math.round(ih);
      frame.draw(cam.getContext('2d'), cam.width, cam.height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      var key = items.length + ':' + (params.feed || '');
      if (items.length >= 4 && (key !== modelKey && (!model || t % 2 < dt * 2 || items.length - model.items.length >= 8 || lib.status === 'ready'))) { model = mapper(items.slice()); modelKey = key; sel = -1; }
      if (!model) { frame.say(lib.status === 'loading' || lib.status === 'failed' ? lib.message : 'Gathering images…'); }

      // Gestures.
      var hd = ix.hands[0], gesture = '';
      if (hd) {
        if (hd.fist) gesture = 'Closed_Fist';
        else if (hd.pointing) gesture = 'Pointing_Up';
        else if (hd.count >= 5) gesture = 'Open_Palm';
      }
      var want = gesture === 'Closed_Fist' ? 0.55 : gesture === 'Open_Palm' ? 1.45 : 1;
      scale += (want - scale) * (1 - Math.exp(-dt / 0.3));
      var R = Math.min(W, H) * 0.42 * scale, cx = W * 0.42, cy = H * 0.5;
      if (model) {
        var graph = (Math.round(params.view) || 0) === 0;
        if (graph) layout(model, dt);
        var thumb = Math.max(10, H * 0.035), pos = new Array(model.items.length);
        if (graph) {
          model.nodes.forEach(function (nd) {
            var r0 = thumb * 0.7 * Math.sqrt(nd.members.length);
            nd.members.forEach(function (q, j) {
              var a = j / nd.members.length * Math.PI * 2 + t * 0.1;
              if (!pos[q]) pos[q] = [cx + nd.x * R + Math.cos(a) * r0, cy + nd.y * R + Math.sin(a) * r0];
            });
          });
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = Math.max(1, 0.6 * u);
          ctx.beginPath();
          model.edges.forEach(function (e) { var a = model.nodes[e[0]], b = model.nodes[e[1]]; ctx.moveTo(cx + a.x * R, cy + a.y * R); ctx.lineTo(cx + b.x * R, cy + b.y * R); });
          model.nodes.forEach(function (nd) { nd.members.forEach(function (q) { ctx.moveTo(cx + nd.x * R, cy + nd.y * R); ctx.lineTo(pos[q][0], pos[q][1]); }); });
          ctx.stroke();
        } else {
          model.pca.forEach(function (p, q) { pos[q] = [cx + p[0] * R, cy + p[1] * R]; });
        }
        // Pointing selects the node (or image) nearest the fingertip.
        if (gesture === 'Pointing_Up') {
          var tip = hd.points[8], best = -1, bd = Infinity;
          if (graph) model.nodes.forEach(function (nd, i) { var d = Math.hypot(cx + nd.x * R - tip.x, cy + nd.y * R - tip.y); if (d < bd) { bd = d; best = i; } });
          else pos.forEach(function (p2, i) { if (p2) { var d = Math.hypot(p2[0] - tip.x, p2[1] - tip.y); if (d < bd) { bd = d; best = i; } } });
          sel = best;
        }
        model.items.forEach(function (img, q) {
          if (!pos[q]) return;
          var w = thumb, h2 = thumb * img.height / img.width;
          ctx.drawImage(img, pos[q][0] - w / 2, pos[q][1] - h2 / 2, w, h2);
        });
        hud.save();
        hud.fillStyle = 'rgba(255,255,255,0.75)';
        hud.font = '400 ' + Math.round(8 * u) + 'px ' + Magi.fx.MONO;
        if (graph) model.nodes.forEach(function (nd, i) { hud.fillText('node ' + i + ' · ' + nd.members.length, cx + nd.x * R + 6 * u, cy + nd.y * R - 6 * u); });
        hud.restore();
        // The selection fanned out, larger.
        if (sel >= 0) {
          var members = graph ? (model.nodes[sel] || { members: [] }).members : [sel], big = H * 0.12;
          var ax = graph ? cx + model.nodes[sel].x * R : pos[sel][0], ay = graph ? cy + model.nodes[sel].y * R : pos[sel][1];
          ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 1.2 * u);
          ctx.beginPath(); ctx.arc(ax, ay, big * 0.35, 0, Math.PI * 2); ctx.stroke();
          members.slice(0, 6).forEach(function (q, j) {
            var img = model.items[q], bw = big, bh = big * img.height / img.width, dir = ax > W * 0.5 ? -1 : 1;
            var x = Math.max(0, Math.min(W - bw, ax + dir * (big * 0.5 + j * bw * 0.55) - (dir < 0 ? bw : 0))), y = Math.max(0, Math.min(H - bh, ay - bh - big * 0.2 + j * 6 * u));
            ctx.drawImage(img, x, y, bw, bh); ctx.strokeRect(x, y, bw, bh);
          });
        }
      }
      // The inset, with the hand's joints and the recognized gesture.
      ctx.drawImage(cam, ix0, iy0, iw, ih);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(ix0 + 0.5, iy0 + 0.5, iw, ih);
      if (hd) {
        ctx.fillStyle = '#fff';
        hd.points.forEach(function (q) { ctx.beginPath(); ctx.arc(ix0 + q.x / W * iw, iy0 + q.y / H * ih, Math.max(1.2, 1.6 * u), 0, Math.PI * 2); ctx.fill(); });
        if (gesture) { hud.save(); hud.fillStyle = '#fff'; hud.font = '500 ' + Math.round(9 * u) + 'px ' + Magi.fx.MONO; hud.fillText(gesture, ix0 + 6 * u, iy0 + 14 * u); hud.restore(); }
      }
      hud.save();
      hud.fillStyle = 'rgba(255,255,255,0.8)';
      hud.font = '500 ' + Math.round(9 * u) + 'px ' + Magi.fx.MONO;
      hud.fillText(((Math.round(params.view) || 0) === 0 ? 'MAPPER' : 'PCA') + ' · ' + (model ? model.items.length : 0) + ' IMAGES' + (params.feed ? '' : ' (CAMERA)'), W * 0.03, H * 0.95);
      hud.restore();
    };
  };

  // Sequencer (after "a simple euclidean sequencer with hand tracking"): three rings of steps, each
  // playing a Euclidean rhythm. A Euclidean rhythm E(k, n) spreads k events as evenly as possible
  // over n steps (Toussaint 2005, after Bjorklund's algorithm for spacing timing pulses); step i is
  // an event when ⌊(i + 1)k/n⌋ − ⌊ik/n⌋ = 1, which gives the same rhythms up to rotation (E(3, 8) is
  // the tresillo, x..x..x.). Rings: red 16 steps (outer), yellow 12, blue 8 (inner); a playhead line
  // sweeps each at Tempo (sixteenth notes), and an event flashes as it's hit.
  // Gestures, as in the reference: the grip picks the ring — thumb and index out (an L): red; thumb,
  // index and middle: yellow; all five: blue — and turning the grip (the thumb-to-index line, like a
  // knob) changes that ring's number of events, one per 15°. Close your hand: every ring's events
  // are rotated to a random placement. Sound (on): each ring is a voice — red a kick (a sine falling
  // 150 → 45 Hz), yellow a snare (noise through a band-pass, plus a 190 Hz tone), blue a hi-hat
  // (noise through a high-pass) — and plays into video recordings.
  var SEQ = [
    { color: '#ff3b30', n: 16, k: 4, r: 1 },
    { color: '#ffd60a', n: 12, k: 5, r: 0.72 },
    { color: '#5b8cff', n: 8, k: 3, r: 0.46 }
  ];
  function euclid(k, n, rot) {
    var out = [];
    for (var i = 0; i < n; i++) { var j = (i + rot) % n; out.push(Math.floor((j + 1) * k / n) - Math.floor(j * k / n) === 1); }
    return out;
  }
  Magi.landmarkModes.sequencer = function () {
    var rings = SEQ.map(function (r) { return { color: r.color, n: r.n, k: r.k, r: r.r, rot: 0, flash: [] }; });
    var grab = null, cand = null, candSince = 0, wasFist = false, message = '', messageColor = '#fff', messageAt = -9, lastStep = null, noise = null;
    function wrap(a) { return a - Math.round(a / 360) * 360; }
    function voice(i, A) {
      var c = A.ctx, t0 = c.currentTime, g = c.createGain();
      g.connect(A.out);
      if (i === 0) {
        var o = c.createOscillator(); o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.25);
        g.gain.setValueAtTime(0.9, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3); o.connect(g); o.start(t0); o.stop(t0 + 0.32);
        return;
      }
      if (!noise) {
        noise = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
        var d = noise.getChannelData(0); for (var q = 0; q < d.length; q++) d[q] = Math.random() * 2 - 1;
      }
      var src = c.createBufferSource(), f = c.createBiquadFilter();
      src.buffer = noise; f.type = i === 1 ? 'bandpass' : 'highpass'; f.frequency.value = i === 1 ? 1800 : 7000;
      src.connect(f); f.connect(g);
      var len = i === 1 ? 0.14 : 0.05;
      g.gain.setValueAtTime(i === 1 ? 0.5 : 0.25, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
      src.start(t0); src.stop(t0 + len + 0.02);
      if (i === 1) { var o2 = c.createOscillator(), g2 = c.createGain(); o2.frequency.value = 190; g2.gain.setValueAtTime(0.3, t0); g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08); o2.connect(g2); g2.connect(A.out); o2.start(t0); o2.stop(t0 + 0.1); }
    }
    return function (ctx, frame, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
      ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      // Grip → ring; turning → event count; fist → random placements.
      var hd = ix.hands[0], grip = -1;
      if (hd) {
        var f = hd.fingers, out = function (nm) { return f[nm].extended; };
        if (out('thumb') && out('index') && out('middle') && out('ring') && out('pinky')) grip = 2;
        else if (out('thumb') && out('index') && out('middle') && !out('ring') && !out('pinky')) grip = 1;
        else if (out('thumb') && out('index') && !out('middle') && !out('ring') && !out('pinky')) grip = 0;
        if (hd.fist && !wasFist) {
          rings.forEach(function (rg) { rg.rot = Math.floor(Math.random() * rg.n); });
          message = 'RANDOMIZING EVENT PLACEMENTS...'; messageColor = '#ff3b30'; messageAt = t;
        }
        wasFist = hd.fist;
      } else wasFist = false;
      if (grip !== cand) { cand = grip; candSince = t; }
      var active = cand >= 0 && t - candSince > 0.15 ? cand : -1;
      if (active >= 0) {
        var p = hd.points, ang = Math.atan2(p[8].y - p[4].y, p[8].x - p[4].x) * 180 / Math.PI;
        if (!grab || grab.ring !== active) grab = { ring: active, last: ang, acc: 0, k: rings[active].k };
        grab.acc += wrap(ang - grab.last); grab.last = ang;
        rings[active].k = Math.max(0, Math.min(rings[active].n, Math.round(grab.k + grab.acc / 15)));
        message = 'CHANGING EVENT COUNT...'; messageColor = rings[active].color; messageAt = t;
      } else grab = null;

      // Clock: sixteenth notes at Tempo.
      var step = t * params.tempo / 60 * 4, A = params.sound ? Magi.fx.audio() : null;
      if (A) Magi.fx.audioLiveAt = performance.now();
      var R = H * 0.3, cx = Math.max(R * 1.25, W * 0.26), cy = H * 0.46;
      ctx.save();
      ctx.lineWidth = Math.max(1, 1.1 * u);
      rings.forEach(function (rg, i) {
        var pat = euclid(rg.k, rg.n, rg.rot), rad = R * rg.r, s = step % rg.n, cur = Math.floor(s);
        // Triggers: steps crossed since the last frame.
        if (lastStep !== null && Math.floor(step) !== Math.floor(lastStep)) {
          var hit = Math.floor(step) % rg.n;
          if (pat[hit]) { rg.flash[hit] = t; if (A) voice(i, A); }
        }
        ctx.strokeStyle = rg.color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
        // Playhead.
        var a = -Math.PI / 2 + s / rg.n * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); ctx.stroke();
        // Events.
        ctx.globalAlpha = 1;
        ctx.fillStyle = rg.color;
        pat.forEach(function (on, j) {
          if (!on) return;
          var aj = -Math.PI / 2 + j / rg.n * Math.PI * 2, fl = rg.flash[j] !== undefined ? Math.max(0, 1 - (t - rg.flash[j]) / 0.25) : 0;
          ctx.beginPath(); ctx.arc(cx + Math.cos(aj) * rad, cy + Math.sin(aj) * rad, (3.2 + 3 * fl) * u, 0, Math.PI * 2); ctx.fill();
        });
      });
      lastStep = step;
      // Fingertips in the active ring's color.
      if (hd) {
        ctx.fillStyle = active >= 0 ? rings[active].color : '#5b8cff';
        [4, 8, 12, 16, 20].forEach(function (k2) { if (k2 === 4 || hd.fingers[['thumb', 'index', 'middle', 'ring', 'pinky'][k2 / 4 - 1]].extended) { var q = hd.points[k2]; ctx.beginPath(); ctx.arc(q.x, q.y, 5 * u, 0, Math.PI * 2); ctx.fill(); } });
      }
      ctx.restore();
      if (t - messageAt < 1.5) {
        hud.save();
        if ('letterSpacing' in hud) hud.letterSpacing = Math.round(1.5 * u) + 'px';
        hud.fillStyle = messageColor;
        hud.font = '500 ' + Math.round(10 * u) + 'px ' + Magi.fx.MONO;
        hud.fillText(message, cx - R, cy + R * 1.35);
        if ('letterSpacing' in hud) hud.letterSpacing = '0px';
        hud.restore();
      }
    };
  };

  // Rabinovich (after "Rabinovich–Fabrikant equations"): a cloud of points riding the
  // Rabinovich–Fabrikant system (Rabinovich & Fabrikant 1979, a model of waves in a nonequilibrium
  // medium):
  //   ẋ = y(z − 1 + x²) + γx,   ẏ = x(3z + 1 − x²) + γy,   ż = −2z(α + xy),
  // integrated with fourth-order Runge–Kutta (h = 0.01, Speed steps a frame). γ = 0.1; α comes from
  // your hand: the thumb–index distance sets α from 0.1 to 1.3 (pinched to wide open), where the
  // attractor goes from a pair of tight rings to a broad spiral; with no hand α drifts slowly.
  // Turning your hand turns the view. Points that escape (|x|, |y| or |z| > 20) restart near the
  // origin. Each point leaves a pastel trail (hue by height z) added like light, fading by Trail.
  // The equations and α read on the HUD; red squares sit on your fingertips, α at the index tip.
  // Strength: how bright and thick the trails are (light per segment 0.32 × Strength/50, width
  // grows with it), from a faint haze to a solid glow.
  // Two hands: two attractors, one per hand, each with its own α and view, beside its hand.
  Magi.landmarkModes.rabinovich = function () {
    var N = 1400, trail = document.createElement('canvas'), tctx = trail.getContext('2d');
    function seed() { return [(Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, Math.random() * 0.8 + 0.1]; }
    function f(p, a, g) { var x = p[0], y = p[1], z = p[2]; return [y * (z - 1 + x * x) + g * x, x * (3 * z + 1 - x * x) + g * y, -2 * z * (a + x * y)]; }
    function rk4(p, a, g, h) {
      var k1 = f(p, a, g), p2 = [p[0] + k1[0] * h / 2, p[1] + k1[1] * h / 2, p[2] + k1[2] * h / 2];
      var k2 = f(p2, a, g), p3 = [p[0] + k2[0] * h / 2, p[1] + k2[1] * h / 2, p[2] + k2[2] * h / 2];
      var k3 = f(p3, a, g), p4 = [p[0] + k3[0] * h, p[1] + k3[1] * h, p[2] + k3[2] * h], k4 = f(p4, a, g);
      return [p[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]), p[2] + h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])];
    }
    // One attractor per hand (two hands: two attractors, each placed at its hand's side and shaped by
    // its own thumb–index opening); colors cool for the first, warm for the second.
    function attractor(x, palette) { var P = []; for (var i = 0; i < N; i++) P.push(seed()); return { P: P, alpha: 0.6, yaw: 0, pitch: 0.4, ox: x, pal: palette, on: 0 }; }
    var COOL = ['120,200,255', '150,255,220', '190,170,255', '255,170,230', '255,240,200'];
    var WARM = ['255,150,120', '255,200,140', '255,130,190', '255,230,160', '255,255,220'];
    var A = [attractor(0.32, COOL), attractor(0.68, WARM)];
    return function (ctx, frame, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
      if (trail.width !== W || trail.height !== H) { trail.width = W; trail.height = H; }
      ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      var hs = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands.slice(0, 1);
      var steps = Math.max(1, Math.round(params.speed / 100 * 6)), g = 0.1, h = 0.01;
      tctx.globalCompositeOperation = 'destination-out';
      tctx.fillStyle = 'rgba(0,0,0,' + (0.04 + (1 - params.trail / 100) * 0.3).toFixed(3) + ')';
      tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = 'lighter';
      var strength = (params.strength === undefined ? 50 : params.strength) / 50;
      tctx.lineWidth = Math.max(0.6, 0.7 * u * (0.6 + 0.4 * strength));
      A.forEach(function (at, k) {
        var hd = hs[k], solo = hs.length < 2;
        // The second attractor fades in with a second hand and out without it.
        at.on += ((k === 0 || !solo ? 1 : 0) - at.on) * 0.08;
        if (at.on < 0.02) return;
        var target = 0.7 + 0.55 * Math.sin(t * 0.07 + k * 2);
        if (hd) {
          target = 0.1 + 1.2 * Math.max(0, Math.min(1, (hd.pinchWith.index.distance - 0.15) / 1.2));
          at.yaw += ((hd.rotation * Math.PI / 180) * 1.5 - at.yaw) * 0.1;
          at.pitch += ((hd.center.y / H - 0.5) * 1.2 + 0.4 - at.pitch) * 0.1;
          at.ox += ((solo ? 0.32 : Math.max(0.15, Math.min(0.85, hd.center.x / W))) - at.ox) * 0.1;
        } else { at.yaw += 0.003; at.ox += ((solo ? 0.32 : 0.32 + k * 0.36) - at.ox) * 0.05; }
        at.alpha += (target - at.alpha) * 0.08;
        var cy = Math.cos(at.yaw), sy = Math.sin(at.yaw), cp = Math.cos(at.pitch), sp = Math.sin(at.pitch);
        var sc = H * (solo ? 0.2 : 0.15) * (0.5 + params.size / 100), ox = W * at.ox, oy = H * 0.5;
        var proj = function (p) { var x = p[0] * cy - p[1] * sy, y0 = p[0] * sy + p[1] * cy, z = p[2] - 0.6; return [ox + x * sc, oy - (z * cp - y0 * sp) * sc]; };
        var bins = [[], [], [], [], []], P = at.P;
        for (var i = 0; i < N; i++) {
          var a0 = proj(P[i]);
          for (var s2 = 0; s2 < steps; s2++) P[i] = rk4(P[i], at.alpha, g, h);
          var q = P[i];
          if (!isFinite(q[0]) || Math.abs(q[0]) > 20 || Math.abs(q[1]) > 20 || Math.abs(q[2]) > 20) { P[i] = seed(); continue; }
          var a1 = proj(q);
          bins[Math.max(0, Math.min(4, Math.floor(q[2] / 0.5)))].push(a0[0], a0[1], a1[0], a1[1]);
        }
        bins.forEach(function (b, kb) {
          if (!b.length) return;
          tctx.strokeStyle = 'rgba(' + at.pal[kb] + ',' + Math.min(1, 0.32 * strength * at.on).toFixed(3) + ')';
          tctx.beginPath();
          for (var j = 0; j < b.length; j += 4) { tctx.moveTo(b[j], b[j + 1]); tctx.lineTo(b[j + 2], b[j + 3]); }
          tctx.stroke();
        });
      });
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(trail, 0, 0);
      ctx.restore();
      // Fingertip squares and each hand's α.
      hs.forEach(function (hd, k) {
        ctx.save();
        ctx.strokeStyle = k ? '#ff9f43' : '#ff3b30'; ctx.lineWidth = Math.max(1, 1.2 * u);
        [4, 8, 12, 16, 20].forEach(function (k2) { var pt = hd.points[k2]; ctx.strokeRect(pt.x - 4 * u, pt.y - 4 * u, 8 * u, 8 * u); });
        ctx.beginPath(); ctx.moveTo(hd.points[4].x, hd.points[4].y); ctx.lineTo(hd.points[8].x, hd.points[8].y); ctx.stroke();
        ctx.restore();
        hud.save(); hud.fillStyle = '#fff'; hud.font = '400 ' + Math.round(9 * u) + 'px ' + Magi.fx.MONO;
        hud.fillText('α' + (hs.length > 1 ? k + 1 : '') + ':' + A[k].alpha.toFixed(4), hd.points[8].x + 8 * u, hd.points[8].y); hud.restore();
      });
      hud.save();
      hud.fillStyle = '#fff';
      hud.font = '300 ' + Math.round(15 * u) + 'px Inter, sans-serif';
      hud.fillText('Rabinovich–Fabrikant equations', W * 0.18, H * 0.08);
      hud.font = '300 ' + Math.round(9 * u) + 'px Inter, sans-serif';
      var lines = ['Δx = y(z − 1 + x²) + γx', 'Δy = x(3z + 1 − x²) + γy', 'Δz = −2z(α + xy)', (hs.length > 1 ? 'α₁ = ' : 'α = ') + A[0].alpha.toFixed(4)];
      if (hs.length > 1) lines.push('α₂ = ' + A[1].alpha.toFixed(4));
      lines.forEach(function (l, k) { hud.fillText(l, W * 0.66, H * 0.05 + k * 13 * u); });
      hud.restore();
    };
  };

  // Cohesion (after "landmarks cohesion level"): how tightly your hand holds together, as a chord
  // diagram of its 21 landmarks. Cohesion of a pair is c = max(0, 1 − d / L), d
  // their distance L = 0.9 palm lengths; the hand's cohesion level is the mean over all 210 pairs,
  // scaled so a closed fist reads 100% (an open hand about 50%). Around a circle, the landmarks sit at evenly spaced angles, named; each pair with
  // c > 0.15 is joined by a chord (a quadratic curve through the middle) in its landmark's hue, as
  // opaque as its cohesion, so a fist fills the circle and spread fingers thin it out. A white line
  // drawing of your hand (bones and joint rings) and a strip chart of the level's last 8 s go with it.
  // Two hands: 42 landmarks around the circle, the left hand on one half and the right on the other;
  // pairs across the hands are joined in white as the hands come together, and the HUD reads each
  // hand's level and the hands' cohesion with each other.
  var LM_NAMES = ['WRIST', 'THUMB CMC', 'THUMB MCP', 'THUMB IP', 'THUMB TIP', 'INDEX FINGER MCP', 'INDEX FINGER PIP', 'INDEX FINGER DIP', 'INDEX FINGER TIP',
    'MIDDLE FINGER MCP', 'MIDDLE FINGER PIP', 'MIDDLE FINGER DIP', 'MIDDLE FINGER TIP', 'RING FINGER MCP', 'RING FINGER PIP', 'RING FINGER DIP', 'RING FINGER TIP',
    'PINKY MCP', 'PINKY PIP', 'PINKY DIP', 'PINKY TIP'];
  Magi.landmarkModes.cohesion = function () {
    var levels = [0, 0], between = 0, hist = [[], []], lastSample = 0, FIST = 0.42, L = 0.9;
    return function (ctx, frame, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
      ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      var hs = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands.slice(0, 1), two = hs.length === 2;
      var nodes = [], pairs = [], C = (Magi.tracking.connections && Magi.tracking.connections.hand) || [];
      hs.forEach(function (hd, hI) { hd.points.forEach(function (q, k) { nodes.push({ q: q, hand: hI, k: k }); }); });
      // Pair cohesion c = max(0, 1 − d / (L · palm)); within each hand, and across the two hands.
      var palm = hs.length ? hs.reduce(function (a, h) { return a + (h.size || 1); }, 0) / hs.length : 1, sums = [0, 0], cross = 0, ncross = 0;
      for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
        var a = nodes[i], b = nodes[j], c = Math.max(0, 1 - Math.hypot(a.q.x - b.q.x, a.q.y - b.q.y) / (L * palm));
        if (a.hand === b.hand) sums[a.hand] += c; else { cross += c; ncross++; }
        if (c > 0.15) pairs.push([i, j, c, a.hand !== b.hand]);
      }
      hs.forEach(function (h, k) { levels[k] += (Math.min(1, sums[k] / 210 / FIST) - levels[k]) * 0.25; });
      between += ((two ? Math.min(1, cross / ncross / FIST) : 0) - between) * 0.25;
      // Each hand as a white line drawing.
      ctx.save();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 1.2 * u);
      ctx.beginPath();
      hs.forEach(function (hd) {
        var p = hd.points;
        C.forEach(function (e) { ctx.moveTo(p[e.start].x, p[e.start].y); ctx.lineTo(p[e.end].x, p[e.end].y); });
        p.forEach(function (q) { ctx.moveTo(q.x + 5 * u, q.y); ctx.arc(q.x, q.y, 5 * u, 0, Math.PI * 2); });
      });
      ctx.stroke(); ctx.restore();
      if (t - lastSample > 0.1) {
        lastSample = t;
        [0, 1].forEach(function (k) { hist[k].push(k < hs.length ? levels[k] : null); if (hist[k].length > 80) hist[k].shift(); });
      }
      // Chord diagram: one hand's 21 landmarks around the circle, or both hands' 42, each on its half.
      var n = Math.max(21, nodes.length), R = Math.min(W, H) * 0.3, cx = W - R * 1.55, cy = H * 0.5;
      var at = function (k) { var a = -Math.PI / 2 + (k - n / 2 + 0.5) * (Math.PI * 2 / n); return [cx + Math.cos(a) * R, cy + Math.sin(a) * R, a]; };
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = Math.max(1, u);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = Math.max(1, (two ? 1 : 1.3) * u);
      pairs.forEach(function (pr) {
        var a = at(pr[0]), b = at(pr[1]);
        ctx.strokeStyle = pr[3] ? 'rgba(255,255,255,' + (pr[2] * 0.9).toFixed(3) + ')' : 'hsla(' + Math.round((pr[0] % 21) / 21 * 360) + ',100%,62%,' + (pr[2] * 0.9).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(cx, cy, b[0], b[1]); ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      for (var k = 0; k < n; k++) { var q2 = at(k); ctx.strokeStyle = two && k >= 21 ? '#ff9f43' : '#ccff66'; ctx.beginPath(); ctx.arc(q2[0], q2[1], 3.5 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
      hud.save();
      hud.fillStyle = '#fff';
      hud.font = '500 ' + Math.round((two ? 5.5 : 7) * u) + 'px ' + Magi.fx.MONO;
      for (var k2 = 0; k2 < n; k2++) {
        var q3 = at(k2), right = Math.cos(q3[2]) >= 0;
        hud.textAlign = right ? 'left' : 'right';
        hud.fillText((two ? (k2 < 21 ? 'L ' : 'R ') : '') + LM_NAMES[k2 % 21], q3[0] + Math.cos(q3[2]) * 8 * u, q3[1] + Math.sin(q3[2]) * 8 * u);
      }
      hud.textAlign = 'left';
      hud.font = '500 ' + Math.round(11 * u) + 'px ' + Magi.fx.MONO;
      if (two) {
        hud.fillText('left hand cohesion level:' + Math.round(levels[0] * 100) + '%', W * 0.03, H * 0.06);
        hud.fillText('right hand cohesion level:' + Math.round(levels[1] * 100) + '%', W * 0.03, H * 0.06 + 15 * u);
        hud.fillText('hands cohesion level:' + Math.round(between * 100) + '%', W * 0.03, H * 0.06 + 30 * u);
      } else hud.fillText('landmarks cohesion level:' + Math.round(levels[0] * 100) + '%', W * 0.03, H * 0.06);
      hud.restore();
      // Strip chart of the levels (second hand in orange).
      ctx.save();
      ctx.lineWidth = Math.max(1, 1.2 * u);
      var x0 = W * 0.45, x1 = W * 0.6, y0 = H * 0.09;
      hist.forEach(function (hh, kk) {
        ctx.strokeStyle = kk ? '#ff9f43' : '#5b8cff';
        ctx.beginPath();
        var pen = false;
        hh.forEach(function (v, k3) { if (v === null) { pen = false; return; } var x = x0 + (x1 - x0) * k3 / 79, y = y0 - v * H * 0.05; pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; });
        ctx.stroke();
      });
      ctx.restore();
    };
  };

  // Pollinate (after an idea generator by gesture): a small pad cross-pollinates concepts. Point with your index finger: the pad appears there (only the index
  // finger moves it, by pushing past an edge) and your fingertip's place on it picks two concepts — across for the first, down for the
  // second. Hold still on a cell for 0.5 s and the pair pollinates: "A + B = ?" and an idea for a
  // work appear on the right, decoding from scrambled symbols into words, and the cell is marked in
  // red on the pad. Fist: clears the marks. The pair under the crosshair is named beside it.
  // Ideas: a small context-free grammar (after Kate Compton's Tracery): sentence slots filled from
  // word lists by a random generator seeded with the pair, so the same pair always grows the same
  // idea.
  var POLLEN = ['media theory', 'language as landscape', 'evolutionary algorithms', 'dubstep', 'glsl shaders', 'generative art', 'projection mapping',
    'oracular language', 'real-time interaction', 'pattern formation', 'spatial memory', 'future archaeology', 'gesture-driven world builder',
    'sound sculpture', 'machine dreams', 'soft robotics', 'tidal data', 'ritual computing', 'bioluminescence', 'swarm intelligence', 'urban noise',
    'folk tales', 'cellular automata', 'light fields', 'ASCII cinema', 'haptic poetry', 'weather systems', 'mycelium networks', 'typography', 'None'];
  var GRAMMAR = {
    form: ['A sonic sculpture', 'An augmented reality app', 'A kinetic sculpture', 'A dynamic projection mapping installation', 'An interactive light installation', 'A generative score', 'A wearable instrument', 'A browser-based ritual', 'A tactile archive', 'A responsive LED wall'],
    verb: ['that translates', 'that entangles', 'that maps', 'that slowly dissolves', 'that grows', 'that tunes', 'that remixes', 'that buries'],
    where: ['on ancient ruins', 'in a flooded parking garage', 'across a city at night', 'inside a dormant greenhouse', 'on the surface of a lake', 'in an empty concert hall', 'along a subway line', 'in a library after closing'],
    how: ['Visitors navigate it with their hands', 'The interaction involves removing objects from a sensor field', 'Audience proximity activates it', 'Each gesture leaves a trace that decays', 'It listens for silence rather than sound', 'Breathing near it changes its tempo'],
    result: ['triggering silent voids that bloom into visual and auditory echoes', 'so its patterns shift with every passerby', 'generating evolving geometric patterns', 'collapsing grammar trees into glitching sculptures', 'evolving through simulated selection for visual complexity', 'delivered in a pseudo-ancient tongue']
  };
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var r = Math.imul(seed ^ seed >>> 15, 1 | seed); r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r; return ((r ^ r >>> 14) >>> 0) / 4294967296; }; }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h; }
  function idea(a, b) {
    var r = rng(hashStr(a + '|' + b)), pick = function (k) { return GRAMMAR[k][Math.floor(r() * GRAMMAR[k].length)]; };
    var B = b === 'None' ? 'the absence of ' + a : b;
    return pick('form') + ' ' + pick('verb') + ' ' + a + ' into ' + B + ', ' + pick('where') + '. ' + pick('how') + ', ' + pick('result') + '.';
  }
  function wrap(hud, text, width) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) { var tryL = cur ? cur + ' ' + w : w; if (hud.measureText(tryL).width > width && cur) { lines.push(cur); cur = w; } else cur = tryL; });
    if (cur) lines.push(cur);
    return lines;
  }
  Magi.landmarkModes.pollinate = function () {
    var pad = null, cell = null, cellSince = 0, cross = null, pointSince = null, padSeen = -9, pair = null, text = '', textAt = 0, pins = [], lastT = null;
    var GLYPHS = '+*:;[]()=-~^%#@!?<>/\\|{}0123456789';
    return function (ctx, frame, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
      var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      var hd = ix.hands[0], K = POLLEN.length, ps = H * 0.16;
      // Only the index finger works the pad: pointing (index out, middle and ring in) for 0.15 s.
      // The pad stays where it is and the fingertip drags it only by pushing past an edge. The
      // crosshair is steadied (eased toward the fingertip, half-life 50 ms), and the cell under it
      // only changes once the crosshair is a quarter cell past the border (hysteresis), so a steady
      // hold of 0.5 s pollinates.
      var pointing = hd && hd.fingers.index.extended && !hd.fingers.middle.extended && !hd.fingers.ring.extended;
      if (pointing) { if (pointSince === null) pointSince = t; } else pointSince = null;
      if (hd && pointSince !== null && t - pointSince > 0.15) {
        var tip = hd.points[8];
        if (!cross) cross = { x: tip.x, y: tip.y };
        var ec = 1 - Math.pow(0.5, dt / 0.05);
        cross.x += (tip.x - cross.x) * ec; cross.y += (tip.y - cross.y) * ec;
        if (!pad) pad = { x: cross.x - ps / 2, y: cross.y - ps / 2 };
        if (cross.x < pad.x) pad.x = cross.x; if (cross.x > pad.x + ps) pad.x = cross.x - ps;
        if (cross.y < pad.y) pad.y = cross.y; if (cross.y > pad.y + ps) pad.y = cross.y - ps;
        var fx = (cross.x - pad.x) / ps * K, fy = (cross.y - pad.y) / ps * K;
        if (!cell || Math.abs(fx - (cell[0] + 0.5)) > 0.75 || Math.abs(fy - (cell[1] + 0.5)) > 0.75) {
          cell = [Math.max(0, Math.min(K - 1, Math.floor(fx))), Math.max(0, Math.min(K - 1, Math.floor(fy)))]; cellSince = t;
        } else if (t - cellSince > 0.5 && (!pair || pair.key !== cell.join(','))) {
          var gx = cell[0], gy = cell[1];
          pair = { a: POLLEN[gx], b: POLLEN[gy === gx ? (gy + 1) % K : gy], key: cell.join(','), gx: gx, gy: gy };
          text = idea(pair.a, pair.b); textAt = t;
          if (!pins.some(function (pn) { return pn[0] === gx && pn[1] === gy; })) pins.push([gx, gy]);
        }
      } else cross = null;
      if (hd) {
        if (hd.fist) pins = [];
        padSeen = t;
      }
      // The pad: a grid of dots, marked cells in red, the crosshair. It stays on screen and fades out only
      // after 2 s without a hand.
      if (pad && t - padSeen < 2.5) {
        ctx.globalAlpha = Math.max(0, Math.min(1, 2.5 - (t - padSeen)));
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = Math.max(1, u);
        ctx.strokeRect(pad.x, pad.y, ps, ps);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (var gy2 = 0; gy2 < 10; gy2++) for (var gx2 = 0; gx2 < 10; gx2++) ctx.fillRect(pad.x + (gx2 + 0.5) * ps / 10 - u * 0.6, pad.y + (gy2 + 0.5) * ps / 10 - u * 0.6, u * 1.2, u * 1.2);
        // The crosshair has an open center so the cell under it (and its red mark) stays visible.
        if (cross) {
          var tp = cross, g0 = 4 * u, g1 = 11 * u;
          ctx.strokeStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(tp.x - g1, tp.y); ctx.lineTo(tp.x - g0, tp.y); ctx.moveTo(tp.x + g0, tp.y); ctx.lineTo(tp.x + g1, tp.y);
          ctx.moveTo(tp.x, tp.y - g1); ctx.lineTo(tp.x, tp.y - g0); ctx.moveTo(tp.x, tp.y + g0); ctx.lineTo(tp.x, tp.y + g1);
          ctx.stroke();
          // The pair under the crosshair, named beside it.
          if (cell) {
            hud.save(); hud.fillStyle = '#fff'; hud.font = '400 ' + Math.round(8 * u) + 'px ' + Magi.fx.MONO; hud.textBaseline = 'middle';
            hud.fillText(POLLEN[cell[0]] + ' × ' + POLLEN[cell[1] === cell[0] ? (cell[1] + 1) % K : cell[1]], pad.x + ps + 8 * u, tp.y);
            hud.restore();
          }
        }
        ctx.fillStyle = '#ff2020';
        var mk = Math.max(5 * u, ps / K);
        pins.forEach(function (pn) { ctx.fillRect(pad.x + (pn[0] + 0.5) * ps / K - mk / 2, pad.y + (pn[1] + 0.5) * ps / K - mk / 2, mk, mk); });
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      // The idea, decoding: each character shows a random symbol until its turn (30 a second).
      if (pair) {
        hud.save();
        hud.fillStyle = '#fff';
        var fs = Math.round(9 * u), x0 = W * 0.64, y0 = H * 0.1, wdt = W * 0.33;
        hud.font = '400 ' + fs + 'px ' + Magi.fx.MONO;
        var lines = wrap(hud, pair.a + ' + ' + pair.b + ' = ?', wdt).concat(['']).concat(wrap(hud, text, wdt)), shown = Math.floor((t - textAt) * 30), n2 = 0;
        lines.forEach(function (l, li) {
          var out = '';
          for (var c = 0; c < l.length; c++, n2++) out += n2 < shown ? l[c] : n2 < shown + 40 && l[c] !== ' ' ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : ' ';
          hud.fillText(out, x0, y0 + li * fs * 1.35);
        });
        hud.restore();
      } else if (!hd) frame.say('Point with your index finger: the pad by your hand picks two ideas to cross.');
    };
  };

  // Zero (Landmarks mode): a sphere of digits that twists, curls and collapses into a zero, with a
  // wireframe cube inside (after a reference of a numbered sphere on blue). Over the camera.
  //
  // Points: a Fibonacci sphere (y = 1 − 2(k + ½)/N, φ = k·137.5°). Each point's digit is its latitude
  // ring, counted from the top pole, mod 10 (ring = round(arccos(y)/π · 20)), so the digits count
  // down the sphere in bands; a swipe shifts every ring's count.
  // Shape operators (Barr 1984, "Global and local deformations of solid primitives"), applied in
  // order to each point before it is turned and projected:
  //   Twist about y:  θ = τ·y,  (x, z) ← (x cos θ − z sin θ, x sin θ + z cos θ).
  //   Bend along y in the x–y plane, curvature κ, center line at x = 1/κ:
  //     x ← 1/κ − (1/κ − x)·cos(κy),  y ← (1/κ − x)·sin(κy)   (κ → 0 is no bend).
  //   Collapse onto the equator (the zero): p ← mix(p, (x/ρ, 0.04y, z/ρ), c), ρ = √(x² + z²).
  // τ, κ and c each follow their targets through a damped spring (c underdamped, ζ = 0.45, so the
  // sphere overshoots as it blooms back out of the ring).
  // Inside: a wireframe cube (half-size 0.5) and four lines that wander along the cube's grid out to
  // the shell, re-rolled every 6 s or with a swipe up or down. They turn and deform with the sphere.
  // View: perspective with focal length 3; the sphere is untethered (it stays where you leave it).
  // Hands:
  //   Pinch and drag: turns it (trackball: 1.6π across the frame about y, 0.9π about x), with momentum.
  //   Hand up, not pinched: the thumb–index spread sets the twist (wider: more, up to Twist); roll
  //     your hand left past 20° to twist the other way.
  //   Fist: collapses into a flat ring of digits, a zero. Open palm (five fingers): blooms back out.
  //   Two hands: the closer they are, the tighter the shell curls (up to Curl).
  //   Swipe left or right: shuffles the digits. Up or down: new lines inside the cube.
  //   No hand: a slow twist-and-curl loop.
  // The formulas and their live values read in the top-left corner. Glow: a bloom from a half-size
  // layer of the digits' positions (fx.bloom), so the digits themselves stay sharp on the HUD.
  Magi.landmarkModes.zero = function () {
    var GOLDEN = Math.PI * (3 - Math.sqrt(5)), RINGS = 20, glowLayer = document.createElement('canvas');
    var pts = [], nKey = 0, offset = 0, lines = [], linesAt = -99, seen = 0, lastT = null, atlas = null, atlasKey = '';
    var view = { yaw: 0.4, pitch: 0.3 }, vel = { yaw: 0, pitch: 0 }, grab = null;
    var tw = { v: 0, d: 0 }, bd = { v: 0, d: 0 }, cl = { v: 0, d: 0 }, target = { tw: 0, bd: 0, cl: 0 };
    function spring(s, goal, hz, zeta, dt) { var w = 2 * Math.PI * hz; s.d += (-w * w * (s.v - goal) - 2 * zeta * w * s.d) * dt; s.v += s.d * dt; }
    function build(n) {
      pts = [];
      for (var k = 0; k < n; k++) {
        var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN;
        pts.push({ p: [r * Math.cos(phi), y, r * Math.sin(phi)], ring: Math.round(Math.acos(y) / Math.PI * RINGS) });
      }
    }
    // Four lines that step along the cube's grid (0.5 steps on one axis at a time) out to the shell.
    function rollLines() {
      lines = [];
      for (var i = 0; i < 4; i++) {
        var c = [Math.random() < 0.5 ? -0.5 : 0.5, Math.random() < 0.5 ? -0.5 : 0.5, Math.random() < 0.5 ? -0.5 : 0.5], path = [c.slice()];
        for (var s = 0; s < 5; s++) {
          var ax = Math.floor(Math.random() * 3), step = (Math.random() < 0.5 ? -1 : 1) * 0.5, nx = c.slice();
          nx[ax] = Math.max(-1, Math.min(1, nx[ax] + step));
          if (Math.hypot(nx[0], nx[1], nx[2]) > 0.98) break;
          c = nx; path.push(c.slice());
        }
        lines.push(path);
      }
    }
    // White digit sprites, drawn once per size.
    function sprites(px) {
      var key = px + '';
      if (atlas && atlasKey === key) return atlas;
      atlasKey = key; atlas = [];
      for (var d = 0; d < 10; d++) {
        var c = document.createElement('canvas'); c.width = Math.ceil(px * 0.7); c.height = Math.ceil(px * 1.1);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = '400 ' + px + 'px ' + Magi.fx.MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(d), c.width / 2, c.height / 2);
        atlas.push(c);
      }
      return atlas;
    }

    return function (ctx, frame, ix, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var n = Math.round(params.zcount);
        if (n !== nKey) { nKey = n; build(n); }
        if (t - linesAt > 6) { rollLines(); linesAt = t; }

        // Hands.
        var hands = ix.hands, hd = hands[0];
        var maxT = params.ztwist / 100 * 6, maxK = params.zcurl / 100 * 2.6;
        ix.events.forEach(function (e) {
          if (e.n <= seen) return; seen = e.n;
          if (e.type !== 'swipe') return;
          if (e.dir === 'left' || e.dir === 'right') offset = (offset + 1 + Math.floor(Math.random() * 9)) % 10;
          else { rollLines(); linesAt = t; }
        });
        var pincher = hands.filter(function (h) { return h.pinched; })[0];
        if (pincher) {
          var m = { x: (pincher.points[4].x + pincher.points[8].x) / 2, y: (pincher.points[4].y + pincher.points[8].y) / 2 };
          if (grab && grab.id === pincher.id) {
            var dy = (m.x - grab.x) / W * Math.PI * 1.6, dp = (m.y - grab.y) / H * Math.PI * 0.9;
            view.yaw += dy; view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + dp));
            vel.yaw += (dy / Math.max(dt, 1e-3) - vel.yaw) * 0.3; vel.pitch += (dp / Math.max(dt, 1e-3) - vel.pitch) * 0.3;
          } else vel.yaw = vel.pitch = 0;
          grab = { id: pincher.id, x: m.x, y: m.y };
        } else {
          grab = null;
          var decay = Math.exp(-dt / 0.8);
          view.yaw += vel.yaw * dt + (hands.length ? 0 : params.zspin / 100 * 0.5 * dt); view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + vel.pitch * dt));
          vel.yaw *= decay; vel.pitch *= decay;
        }
        if (hd) {
          if (hd.fist) target.cl = 1;
          else if (hd.count >= 5) target.cl = 0;
          if (!hd.pinched && !hd.fist) {
            var spread = Math.max(0, Math.min(1, (hd.pinchWith.index.distance - 0.3) / 1.0));
            target.tw = maxT * spread * (hd.rotation < -20 ? -1 : 1);
          }
          target.bd = hands.length >= 2 ? maxK * Math.max(0, Math.min(1, 1 - (Math.hypot(hands[0].center.x - hands[1].center.x, hands[0].center.y - hands[1].center.y) / H - 0.25) / 0.75)) : 0;
        } else {
          target.tw = maxT * 0.6 * Math.sin(t * 0.5);
          target.bd = maxK * 0.5 * (0.5 + 0.5 * Math.sin(t * 0.23));
          target.cl = 0;
        }
        spring(tw, target.tw, 1.2, 0.8, dt); spring(bd, target.bd, 1.0, 0.8, dt); spring(cl, target.cl, 1.4, 0.45, dt);

        // Deform, turn, project.
        var cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
        var R = Math.min(W, H) * 0.34 * (0.4 + params.zsize / 100 * 1.2), cx = W / 2, cy = H / 2, F = 3, tau = tw.v, kap = bd.v, col = Math.max(0, Math.min(1.15, cl.v));
        function deform(q) {
          var x = q[0], y = q[1], z = q[2];
          var th = tau * y, ct = Math.cos(th), st = Math.sin(th), x1 = x * ct - z * st, z1 = x * st + z * ct; x = x1; z = z1;
          if (Math.abs(kap) > 1e-3) { var r0 = 1 / kap, a = kap * y; var xb = r0 - (r0 - x) * Math.cos(a), yb = (r0 - x) * Math.sin(a); x = xb; y = yb; }
          if (col > 0) { var rho = Math.hypot(x, z) || 1e-3; x += (x / rho - x) * col; y += (0.04 * y - y) * col; z += (z / rho - z) * col; }
          return [x, y, z];
        }
        function project(v) {
          var x1 = v[0] * cyw + v[2] * syw, z1 = -v[0] * syw + v[2] * cyw;
          var y2 = v[1] * cp - z1 * sp, z2 = v[1] * sp + z1 * cp, k = F / (F + z2);
          return [cx + x1 * R * k, cy - y2 * R * k, z2, k];
        }

        // The cube and its lines.
        var ink = params.zcolor ? Magi.fx.inkColor(params.zcolor) : [1, 1, 1], rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        if (params.zcube) {
          ctx.save();
          ctx.strokeStyle = 'rgba(' + rgb + ',0.85)'; ctx.lineWidth = Math.max(1, 1.1 * u);
          ctx.beginPath();
          var V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(function (c) { return project(deform([c[0] * 0.5, c[1] * 0.5, c[2] * 0.5])); });
          [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) { ctx.moveTo(V[e[0]][0], V[e[0]][1]); ctx.lineTo(V[e[1]][0], V[e[1]][1]); });
          lines.forEach(function (path) { path.forEach(function (c, i) { var q = project(deform(c)); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); });
          ctx.stroke();
          ctx.restore();
        }

        // The digits, far to near, faded with depth.
        var px = Math.max(6, Math.round((5 + params.ztext / 100 * 12) * u)), spr = sprites(px), list = [];
        pts.forEach(function (q) { var v = project(deform(q.p)); list.push([v[0], v[1], v[2], v[3], (q.ring + offset) % 10]); });
        list.sort(function (a, b) { return b[2] - a[2]; });
        hud.save();
        if (params.zcolor) { hud.globalCompositeOperation = 'source-over'; }
        list.forEach(function (v) {
          var s = spr[v[4]], k = v[3], w = s.width * k, h = s.height * k;
          hud.globalAlpha = Math.max(0.25, Math.min(1, 0.55 + 0.45 * (1 - v[2])));
          hud.drawImage(s, v[0] - w / 2, v[1] - h / 2, w, h);
        });
        hud.globalAlpha = 1;
        if (params.zcolor) {
          // Tint the digits: multiply the white sprites by the ink color on the HUD.
          hud.globalCompositeOperation = 'source-atop';
          hud.fillStyle = 'rgb(' + rgb + ')';
          hud.fillRect(0, 0, W, H);
        }
        hud.restore();
        // Glow: the digits' positions on a half-size layer, bloomed onto the picture.
        var gw = Math.max(1, Math.round(W / 2)), gh = Math.max(1, Math.round(H / 2));
        if (params.zglow > 0) {
          if (glowLayer.width !== gw || glowLayer.height !== gh) { glowLayer.width = gw; glowLayer.height = gh; }
          var gc = glowLayer.getContext('2d'), gs = Math.max(1, px * 0.25);
          gc.globalCompositeOperation = 'copy'; gc.fillStyle = '#000'; gc.fillRect(0, 0, gw, gh);
          gc.globalCompositeOperation = 'source-over'; gc.fillStyle = 'rgb(' + rgb + ')';
          gc.beginPath();
          list.forEach(function (v) { gc.rect(v[0] / 2 - gs / 2, v[1] / 2 - gs / 2, gs, gs); });
          gc.fill();
          Magi.fx.bloom(ctx, glowLayer, W, H, params.zglow / 100 * 0.6);
        }
        // The formulas, with their live values, in the top-left corner.
        hud.save();
        hud.fillStyle = '#fff'; hud.textBaseline = 'top';
        hud.font = '300 ' + Math.round(13 * u) + 'px Inter, sans-serif';
        hud.fillText('Zero', W * 0.04, H * 0.05);
        hud.font = '400 ' + Math.round(8 * u) + 'px ' + Magi.fx.MONO;
        ['twist   θ = τ·y', 'bend    x′ = 1/κ − (1/κ − x)·cos κy', '        y′ = (1/κ − x)·sin κy', 'zero    p′ = mix(p, (x/ρ, 0, z/ρ), c)', '',
          'τ = ' + tau.toFixed(3) + '   κ = ' + kap.toFixed(3) + '   c = ' + Math.max(0, col).toFixed(3)].forEach(function (l, k) { hud.fillText(l, W * 0.04, H * 0.05 + 18 * u + k * 11 * u); });
        hud.restore();
        if (!hands.length) frame.say('Pinch and drag to turn it. Spread thumb and index to twist; fist makes a zero; two hands curl it.');
    };
  };
})();
