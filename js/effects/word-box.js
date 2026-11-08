// Word Box: your body as a constellation of characters, strung together with red threads, above a
// turning wireframe box (after a reference of a figure built from kana and kanji).
//
// Shape: MediaPipe's person mask (Magi.tracking.body). Points (Points) are placed inside it by
// rejection sampling (a random spot is kept if the mask there is over 0.5); each point eases toward
// its own spot (time constant 0.25 s) and picks a new one when its spot leaves the mask, so the
// figure moves with you without the points flickering. Each point is joined to its Links nearest
// neighbors (found on a uniform grid), a red web drawn twice, wide and faint then fine, like a glow.
// Characters: every point carries one character. Text: type anything, with any keyboard — Japanese,
// Chinese, Korean, Arabic, emoji — it's split into user-perceived characters (Intl.Segmenter, so
// accents and emoji stay whole). Empty Text uses a set (Set): 0 Hiragana, 1 Kanji, 2 Latin,
// 3 Hangul, 4 Digits, 5 Emoji. Characters are drawn on the HUD so they stay sharp.
// The box: a wireframe cube under the figure, projected in perspective (focal length 3), turning on
// its own; turn your hand to turn it.
// Gestures: spread thumb and index to zoom into the figure, centered between them (1× to 3×), as the
// reference closes in on its characters; open palm (all five out) loosens the figure, each point
// drifting out from its spot; a fist pulls it tight (no drift, shorter threads); swipe to change
// the set.
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
    var pts = [], chars = [], charKey = '', zoom = 1, zc = null, spin = 0, loose = 0, seen = 0, lastT = null, setIx = null;

    function inside(seg, x, y, W, H) {
      var mx = Math.min(seg.width - 1, Math.max(0, Math.floor(x / W * seg.width))), my = Math.min(seg.height - 1, Math.max(0, Math.floor(y / H * seg.height)));
      return seg.mask[my * seg.width + mx] > 0.5;
    }
    function spot(seg, W, H) {
      for (var k = 0; k < 40; k++) { var x = Math.random() * W, y = Math.random() * H; if (inside(seg, x, y, W, H)) return [x, y]; }
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
        // The set follows its slider; a swipe moves the slider too (frame.setParam), so they agree.
        setIx = Math.max(0, Math.min(SETS.length - 1, Math.round(params.set)));

        // Characters for the points.
        var text = (params.text || '').trim(), ck = text + '|' + setIx;
        if (ck !== charKey) { charKey = ck; chars = graphemes(text || SETS[setIx] || SETS[0]); if (!chars.length) chars = graphemes(SETS[0]); pts.forEach(function (p) { p.c = chars[Math.floor(Math.random() * chars.length)]; }); }

        // Gestures.
        var ix = Magi.interaction.read(frame), hd = ix.hands[0], wantZoom = 1, wantLoose = 0;
        ix.events.forEach(function (e) {
          if (e.n <= seen) return; seen = e.n;
          if (e.type === 'swipe' && !text) { setIx = (setIx + (e.dir === 'left' ? SETS.length - 1 : 1)) % SETS.length; frame.setParam('set', setIx); }
        });
        if (hd) {
          spin += ((hd.rotation * Math.PI / 180) * 2 - spin) * 0.1;
          if (hd.count >= 5) wantLoose = 1;
          else if (hd.fist) wantLoose = -1;
          else if (!hd.pinched && hd.fingers.thumb.extended && hd.fingers.index.extended && hd.count <= 3) {
            wantZoom = 1 + 2 * Math.max(0, Math.min(1, (hd.pinchWith.index.distance - 0.4) / 1.2));
            var m = { x: (hd.points[4].x + hd.points[8].x) / 2, y: (hd.points[4].y + hd.points[8].y) / 2 };
            zc = zc ? { x: zc.x + (m.x - zc.x) * 0.1, y: zc.y + (m.y - zc.y) * 0.1 } : m;
          }
        } else spin += dt * 0.4;
        zoom += (wantZoom - zoom) * (1 - Math.exp(-dt / 0.3));
        loose += (wantLoose - loose) * (1 - Math.exp(-dt / 0.4));
        var zx = zc ? zc.x : W / 2, zy = zc ? zc.y : H / 2;
        var view = function (x, y) { return [zx + (x - zx) * zoom, zy + (y - zy) * zoom]; };

        // Points inside the body.
        var seg = Magi.tracking.body.detect(frame), n = Math.round(params.points);
        if (seg) {
          while (pts.length < n) { var s0 = spot(seg, W, H); if (!s0) break; pts.push({ x: s0[0], y: s0[1], tx: s0[0], ty: s0[1], c: chars[Math.floor(Math.random() * chars.length)], ph: Math.random() * 6.28 }); }
          if (pts.length > n) pts.length = n;
          var e = 1 - Math.exp(-dt / 0.25);
          pts.forEach(function (p) {
            if (!inside(seg, p.tx, p.ty, W, H)) { var s1 = spot(seg, W, H); if (s1) { p.tx = s1[0]; p.ty = s1[1]; } }
            var drift = Math.max(0, loose) * H * 0.06;
            var gx = p.tx + Math.cos(t * 0.7 + p.ph) * drift, gy = p.ty + Math.sin(t * 0.9 + p.ph) * drift;
            p.x += (gx - p.x) * e; p.y += (gy - p.y) * e;
          });
        }
        if (pts.length) {
          // Links: Links nearest neighbors on a grid.
          var k = Math.round(params.links), cell = H * 0.06, grid = {};
          pts.forEach(function (p, i) { var key = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell); (grid[key] || (grid[key] = [])).push(i); });
          var maxLen = cell * (loose < 0 ? 1 + loose * 0.4 : 1) * 1.6, segs = [];
          pts.forEach(function (p, i) {
            var cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), near = [];
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) (grid[(cx + ox) + ',' + (cy + oy)] || []).forEach(function (j) { if (j > i) { var d = Math.hypot(pts[j].x - p.x, pts[j].y - p.y); if (d < maxLen) near.push([d, j]); } });
            near.sort(function (a, b) { return a[0] - b[0]; }).slice(0, k).forEach(function (nb) { segs.push(i, nb[1]); });
          });
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          [[5 * u, 0.06 * params.glow / 100], [Math.max(0.6, 0.8 * u), 0.55]].forEach(function (pass) {
            if (pass[1] <= 0) return;
            ctx.strokeStyle = 'rgba(255,40,20,' + pass[1].toFixed(3) + ')';
            ctx.lineWidth = pass[0] * zoom;
            ctx.beginPath();
            for (var q = 0; q < segs.length; q += 2) { var a = view(pts[segs[q]].x, pts[segs[q]].y), b = view(pts[segs[q + 1]].x, pts[segs[q + 1]].y); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
            ctx.stroke();
          });
          ctx.restore();
          hud.save();
          hud.fillStyle = 'rgba(255,236,214,0.92)';
          hud.textAlign = 'center'; hud.textBaseline = 'middle';
          hud.font = '400 ' + Math.round((7 + params.size / 100 * 10) * u * zoom) + 'px "Noto Sans JP", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif';
          pts.forEach(function (p) { var v = view(p.x, p.y); if (v[0] > -20 && v[0] < W + 20 && v[1] > -20 && v[1] < H + 20) hud.fillText(p.c, v[0], v[1]); });
          hud.restore();
        }

        // The wireframe box under the figure.
        if (params.box) {
          var by = H * 0.86, bx = W * 0.5, s = H * 0.06 * zoom, cs = Math.cos(spin), sn = Math.sin(spin), F = 3;
          if (pts.length) { var lo = 0, sx = 0; pts.forEach(function (p) { lo = Math.max(lo, p.y); sx += p.x; }); bx = sx / pts.length; by = Math.min(H * 0.92, lo + H * 0.05); }
          var b0 = view(bx, by), V = [];
          [[-1, -0.5, -1], [1, -0.5, -1], [1, -0.5, 1], [-1, -0.5, 1], [-1, 0.5, -1], [1, 0.5, -1], [1, 0.5, 1], [-1, 0.5, 1]].forEach(function (v) {
            var x = v[0] * cs - v[2] * sn, z = v[0] * sn + v[2] * cs, y = v[1] * Math.cos(0.45) - z * Math.sin(0.45), zz = v[1] * Math.sin(0.45) + z * Math.cos(0.45), kp = F / (F + zz);
            V.push([b0[0] + x * s * 1.4 * kp, b0[1] + y * s * kp]);
          });
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, u);
          ctx.beginPath();
          [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (eg) { ctx.moveTo(V[eg[0]][0], V[eg[0]][1]); ctx.lineTo(V[eg[1]][0], V[eg[1]][1]); });
          ctx.stroke(); ctx.restore();
        }

        var body = Magi.tracking.body;
        if (body.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, body, 'body');
        else if (!pts.length) frame.say('Step into view.');
      },
      reset: function () { pts = []; zoom = 1; zc = null; lastT = null; }
    };
  }

  Magi.renderers['word-box'] = createWordBox;
})();
