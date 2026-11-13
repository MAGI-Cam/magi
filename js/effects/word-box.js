// Word Box: your body as a constellation of characters, strung together with red threads, above a
// turning wireframe box (after a reference of a figure built from kana and kanji).
//
// Shape: MediaPipe's person mask (Magi.tracking.body), smoothed in time. Each point has an anchor
// in the body's own frame, (u, v) across the mask's bounding box, so the figure stands upright and
// moves with you; anchors are spread evenly from head to toe (v chosen uniformly by row, then u
// among that row's body pixels), so the characters don't pile up at the bottom. An anchor that
// stays outside the body for 0.4 s is moved. A share of the points (Hands) ride your hands instead:
// each sits a fraction of the way along one of the hand's bones, so the figure grows hands that
// follow yours. Points ease to their places with a 0.08 s time constant.
// Depth: every point has its own depth z (±0.35 of the figure's width); turning your hand turns the
// whole structure about its vertical axis (0–3 × your hand's roll, Rotation), drawn in perspective, the box
// included. With no hand it sways slowly.
// Each point is joined to its Links nearest neighbors (found on a uniform grid), a red web drawn
// twice, wide and faint then fine, like a glow.
// Characters: every point carries one. Text: type anything, with any keyboard — Japanese, Chinese,
// Korean, Arabic, emoji — split into user-perceived characters (Intl.Segmenter, so accents and emoji
// stay whole). Empty Text uses a set (Set): 0 Hiragana, 1 Kanji, 2 Latin, 3 Hangul, 4 Digits,
// 5 Emoji. Characters are drawn on the HUD so they stay sharp.
// Gestures: spread thumb and index (other fingers down) to zoom in between them (up to 1×–5×, Zoom); open
// palm loosens the figure, points drifting from their places, and spreads it apart: the more open
// your hand, the further the characters move from the figure's center (Spread); a fist pulls it
// tight; turn your hand to turn it; swipe to change the set. Change: characters swap over time.
(function () {
  var SETS = [
    'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
    '日月火水木金土山川人大小中上下本見言心手目口耳花雨空風光夢愛生死時間',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허',
    '0123456789',
    '✦✧★☆☾☀︎♡♢♤♧☁︎☂︎❄︎✿❀☘︎'
  ];
  function graphemes(s) {
    if (window.Intl && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), function (g) { return g.segment; }).filter(function (g) { return g.trim(); });
    return Array.from(s).filter(function (g) { return g.trim(); });
  }

  function createWordBox() {
    var pts = [], chars = [], charKey = '', zoom = 1, zc = null, yaw = 0, loose = 0, openK = 0, seen = 0, lastT = null;
    var smooth = null, mw = 0, mh = 0, lastSeg = null, bbox = null, rows = null;

    // Smoothed mask, its bounding box, and each row's body spans (for even sampling).
    function updateMask(seg) {
      var n = seg.width * seg.height;
      if (!smooth || mw !== seg.width || mh !== seg.height) { smooth = Float32Array.from(seg.mask); mw = seg.width; mh = seg.height; }
      else for (var i = 0; i < n; i++) smooth[i] += (seg.mask[i] - smooth[i]) * 0.5;
      var x0 = mw, y0 = mh, x1 = -1, y1 = -1;
      rows = [];
      for (var y = 0; y < mh; y++) {
        var xs = [];
        for (var x = 0; x < mw; x++) if (smooth[y * mw + x] > 0.5) { xs.push(x); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        rows.push(xs);
      }
      bbox = x1 >= 0 ? { x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1 } : null;
    }
    function inBody(u, v) {
      if (!bbox) return false;
      var x = Math.floor(bbox.x0 + u * (bbox.x1 - bbox.x0)), y = Math.floor(bbox.y0 + v * (bbox.y1 - bbox.y0));
      return x >= 0 && y >= 0 && x < mw && y < mh && smooth[y * mw + x] > 0.5;
    }
    function anchor() {
      if (!bbox) return null;
      for (var k = 0; k < 20; k++) {
        var v = Math.random(), y = Math.min(mh - 1, Math.floor(bbox.y0 + v * (bbox.y1 - bbox.y0))), xs = rows[y];
        if (!xs || !xs.length) continue;
        var x = xs[Math.floor(Math.random() * xs.length)] + Math.random();
        return { u: (x - bbox.x0) / (bbox.x1 - bbox.x0), v: v };
      }
      return null;
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT));
        lastT = t;
        var setIx = Math.max(0, Math.min(SETS.length - 1, Math.round(params.set)));

        // Characters for the points.
        var text = (params.text || '').trim(), ck = text + '|' + setIx;
        if (ck !== charKey) { charKey = ck; chars = graphemes(text || SETS[setIx]); if (!chars.length) chars = graphemes(SETS[0]); pts.forEach(function (p) { p.c = chars[Math.floor(Math.random() * chars.length)]; }); }
        // Change: each character is swapped for another at random times, a Poisson process of rate
        // 3·Change/100 per second (each frame with probability 1 − e^(−λ·dt)); 0 keeps them.
        var swapP = 1 - Math.exp(-3 * (params.change || 0) / 100 * dt);
        if (swapP > 0) pts.forEach(function (p) { if (Math.random() < swapP) p.c = chars[Math.floor(Math.random() * chars.length)]; });

        // Gestures.
        var ix = Magi.interaction.read(frame), hands = ix.hands, hd = hands[0], wantZoom = 1, wantLoose = 0, wantOpen = 0, wantYaw = Math.sin(t * 0.3) * 0.4;
        ix.events.forEach(function (e) {
          if (e.n <= seen) return; seen = e.n;
          if (e.type === 'swipe' && !text && (e.dir === 'left' || e.dir === 'right')) frame.setParam('set', (setIx + (e.dir === 'left' ? SETS.length - 1 : 1)) % SETS.length);
        });
        if (hd) {
          wantYaw = hd.rotation * Math.PI / 180 * (params.rotation / 100 * 3);
          // Openness: how straight the four fingers are, mean of (1 − curl), mapped so a fist is 0
          // and a flat open hand 1. The figure spreads apart by up to 1.5 × Spread/100 of its size.
          var op = ['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - hd.fingers[f].curl) / 4; }, 0);
          wantOpen = Math.max(0, Math.min(1, (op - 0.25) / 0.6));
          if (hd.count >= 5) wantLoose = 1;
          else if (hd.fist) wantLoose = -1;
          else if (!hd.pinched && hd.fingers.thumb.extended && hd.fingers.index.extended && !hd.fingers.middle.extended) {
            wantZoom = 1 + (params.zoom / 100 * 4) * Math.max(0, Math.min(1, (hd.pinchWith.index.distance - 0.4) / 1.2));
            var m = { x: (hd.points[4].x + hd.points[8].x) / 2, y: (hd.points[4].y + hd.points[8].y) / 2 };
            zc = zc ? { x: zc.x + (m.x - zc.x) * 0.3, y: zc.y + (m.y - zc.y) * 0.3 } : m;
          }
        }
        var fast = 1 - Math.exp(-dt / 0.08);
        yaw += (wantYaw - yaw) * fast;
        zoom += (wantZoom - zoom) * (1 - Math.exp(-dt / 0.15));
        loose += (wantLoose - loose) * (1 - Math.exp(-dt / 0.2));
        openK += (wantOpen - openK) * (1 - Math.exp(-dt / 0.15));

        // Body: anchors in the body's frame.
        var seg = Magi.tracking.body.detect(frame);
        if (seg && seg !== lastSeg) { lastSeg = seg; updateMask(seg); }
        var n = Math.round(params.points), C = (Magi.tracking.connections && Magi.tracking.connections.hand) || [];
        while (pts.length < n) pts.push({ a: anchor(), z: (Math.random() * 2 - 1) * 0.35, x: W / 2, y: H / 2, out: 0, bone: Math.floor(Math.random() * Math.max(1, C.length)), bt: Math.random(), c: chars[Math.floor(Math.random() * chars.length)], ph: Math.random() * 6.28, hand: Math.random() });
        if (pts.length > n) pts.length = n;
        var bw = bbox ? (bbox.x1 - bbox.x0) / mw * W : W * 0.4, cxB = bbox ? (bbox.x0 + bbox.x1) / 2 / mw * W : W / 2;
        var share = params.hands / 100, drift = Math.max(0, loose) * H * 0.06;
        var spreadK = openK * (params.spread || 0) / 100 * 1.5, cyB = bbox ? (bbox.y0 + bbox.y1) / 2 / mh * H : H / 2;
        pts.forEach(function (p) {
          var gx, gy, gz = p.z * bw;
          var onHand = hands.length && C.length && p.hand < share;
          if (onHand) {
            var hp = hands[Math.floor(p.hand / share * hands.length) % hands.length].points, bn = C[p.bone % C.length];
            gx = hp[bn.start].x + (hp[bn.end].x - hp[bn.start].x) * p.bt; gy = hp[bn.start].y + (hp[bn.end].y - hp[bn.start].y) * p.bt; gz = p.z * H * 0.08;
          } else if (bbox && p.a) {
            if (!inBody(p.a.u, p.a.v)) { p.out += dt; if (p.out > 0.4) { p.a = anchor() || p.a; p.out = 0; } } else p.out = 0;
            gx = (bbox.x0 + p.a.u * (bbox.x1 - bbox.x0)) / mw * W; gy = (bbox.y0 + p.a.v * (bbox.y1 - bbox.y0)) / mh * H;
            if (spreadK > 0) { gx = cxB + (gx - cxB) * (1 + spreadK); gy = cyB + (gy - cyB) * (1 + spreadK); }
          } else { if (!p.a) p.a = anchor(); gx = p.x; gy = p.y; }
          gx += Math.cos(t * 0.7 + p.ph) * drift; gy += Math.sin(t * 0.9 + p.ph) * drift;
          p.x += (gx - p.x) * fast; p.y += (gy - p.y) * fast; p.gz = gz;
        });
        // Turn in depth about the figure's vertical axis.
        var cy = Math.cos(yaw), sy = Math.sin(yaw), F = 3 * bw, zx = zc && zoom > 1.02 ? zc.x : W / 2, zy = zc && zoom > 1.02 ? zc.y : H / 2;
        var view = function (x, y, z) {
          var dx = x - cxB, rx = dx * cy - z * sy, rz = dx * sy + z * cy, kp = F / (F + rz), X = cxB + rx * kp, Y = H / 2 + (y - H / 2) * kp;
          return [zx + (X - zx) * zoom, zy + (Y - zy) * zoom, kp];
        };
        var V = pts.map(function (p) { return view(p.x, p.y, p.gz || 0); });
        if (pts.length) {
          var k = Math.round(params.links), cell = H * 0.06, grid = {};
          pts.forEach(function (p, i) { var key = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell); (grid[key] || (grid[key] = [])).push(i); });
          var maxLen = cell * (loose < 0 ? 1 + loose * 0.4 : 1) * 1.6, segs = [];
          pts.forEach(function (p, i) {
            var gx2 = Math.floor(p.x / cell), gy2 = Math.floor(p.y / cell), near = [];
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) (grid[(gx2 + ox) + ',' + (gy2 + oy)] || []).forEach(function (j) { if (j > i) { var d = Math.hypot(pts[j].x - p.x, pts[j].y - p.y); if (d < maxLen) near.push([d, j]); } });
            near.sort(function (a, b) { return a[0] - b[0]; }).slice(0, k).forEach(function (nb) { segs.push(i, nb[1]); });
          });
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          [[5 * u, 0.06 * params.glow / 100], [Math.max(0.6, 0.8 * u), 0.55]].forEach(function (pass) {
            if (pass[1] <= 0) return;
            ctx.strokeStyle = 'rgba(255,40,20,' + pass[1].toFixed(3) + ')';
            ctx.lineWidth = pass[0] * zoom;
            ctx.beginPath();
            for (var q = 0; q < segs.length; q += 2) { var a = V[segs[q]], b = V[segs[q + 1]]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
            ctx.stroke();
          });
          ctx.restore();
          hud.save();
          hud.fillStyle = 'rgba(255,236,214,0.92)';
          hud.textAlign = 'center'; hud.textBaseline = 'middle';
          var base = (7 + params.size / 100 * 10) * u * zoom, lastSize = -1;
          pts.forEach(function (p, i) {
            var v = V[i], sz = Math.round(base * v[2]);
            if (v[0] < -20 || v[0] > W + 20 || v[1] < -20 || v[1] > H + 20) return;
            if (sz !== lastSize) { hud.font = '400 ' + sz + 'px "Noto Sans JP", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif'; lastSize = sz; }
            hud.fillText(p.c, v[0], v[1]);
          });
          hud.restore();
        }

        // The wireframe box under the figure, turning with it.
        if (params.box && pts.length) {
          var by = bbox ? Math.min(H * 0.9, bbox.y1 / mh * H + H * 0.04) : H * 0.86, s = Math.min(H * 0.06, bw * 0.12);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, u);
          var Vb = [[-1, -0.4, -1], [1, -0.4, -1], [1, -0.4, 1], [-1, -0.4, 1], [-1, 0.4, -1], [1, 0.4, -1], [1, 0.4, 1], [-1, 0.4, 1]].map(function (c) {
            var y = by + c[1] * s - c[2] * s * 0.35;
            return view(cxB + c[0] * s * 1.4, y, c[2] * s);
          });
          ctx.beginPath();
          [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (eg) { ctx.moveTo(Vb[eg[0]][0], Vb[eg[0]][1]); ctx.lineTo(Vb[eg[1]][0], Vb[eg[1]][1]); });
          ctx.stroke(); ctx.restore();
        }

        var body = Magi.tracking.body;
        if (body.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, body, 'body');
        else if (!bbox && !hands.length) frame.say('Step into view.');
      },
      reset: function () { pts = []; zoom = 1; zc = null; lastT = null; smooth = null; bbox = null; lastSeg = null; }
    };
  }

  // Shared with Word Space.
  Magi.wordSets = { SETS: SETS, graphemes: graphemes };
  Magi.renderers['word-box'] = createWordBox;
})();
