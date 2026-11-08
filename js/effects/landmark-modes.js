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
})();
