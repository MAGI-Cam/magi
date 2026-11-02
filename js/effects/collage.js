// Collage: a source box locks onto a feature of your face; while your hand is up, numbered copies
// of it pile up around your face. Lower the hand and they fly back into the source and vanish.
//
// Face (Face Landmarker): the source box sits on an eye (corners 33/133 or 362/263), the mouth
// (61/291) or the nose (98/327 around the tip, 1), sized from those landmark distances. Eye mode
// copies one eye; Features takes eye, eye, mouth, nose in turn, and the box moves with it.
// Each copy is a still snapshot taken at the moment it spawns (`Rate` per second, up to `Count`).
//
// Hand (Hand Landmarker): a wireframe sphere on the palm reads two numbers.
//   scale    = mean fingertip distance from the palm center ÷ palm length, ÷ 1.45 so an open
//              hand reads about 1 — it sets how far apart the copies spread;
//   rotation = angle of wrist → middle knuckle from straight up, in degrees — it turns the whole
//              arrangement around your face.
// Copies are placed on a square spiral of slots around the face (slot k on ring ⌈(√k − 1)/2⌉),
// each with a little jitter, and ease toward their slot: x += (target − x)·(1 − e^(−7·dt)).
// The camera is turned gray (saturation blend with gray) with film grain, like the reference.
(function () {
  var WRIST = 0, MIDDLE_MCP = 9, TIPS = [4, 8, 12, 16, 20], PALM = [0, 5, 9, 13, 17];
  var GREEN = 'rgb(80,255,90)';

  // Square spiral: (0,0), (1,0), (1,1), (0,1), (−1,1), (−1,0), (−1,−1), …
  var SPIRAL = (function () {
    var out = [[0, 0]], x = 0, y = 0, dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]], leg = 1, d = 0;
    while (out.length < 400) {
      for (var r = 0; r < 2; r++) {
        for (var s = 0; s < leg && out.length < 400; s++) { x += dirs[d][0]; y += dirs[d][1]; out.push([x, y]); }
        d = (d + 1) % 4;
      }
      leg++;
    }
    return out;
  })();

  function noiseCanvas() {
    var c = document.createElement('canvas');
    c.width = c.height = 160;
    var g = c.getContext('2d'), img = g.createImageData(160, 160), d = img.data;
    for (var i = 0; i < d.length; i += 4) { var v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  // Feature boxes in frame pixels: center, width (height is 0.62 × width).
  function features(f) {
    var eyeA = { c: mid(f[33], f[133]), w: dist(f[33], f[133]) * 2.1 };
    var eyeB = { c: mid(f[362], f[263]), w: dist(f[362], f[263]) * 2.1 };
    eyeA.c.y -= eyeA.w * 0.06; eyeB.c.y -= eyeB.w * 0.06;
    var mouth = { c: mid(f[61], f[291]), w: dist(f[61], f[291]) * 1.6 };
    var nose = { c: mid(mid(f[98], f[327]), f[1]), w: dist(f[98], f[327]) * 2.0 };
    return [eyeA, eyeB, mouth, nose];
  }

  function label(ctx, text, x, y, fs, pad) {
    var w = ctx.measureText(text).width + pad * 2;
    ctx.fillStyle = GREEN;
    ctx.fillRect(x, y, w, fs + pad * 1.4);
    ctx.fillStyle = '#000';
    ctx.fillText(text, x + pad, y + pad * 0.7);
    return w;
  }

  function createCollage() {
    var tiles = [], count = 0, lastSpawn = 0, lastT = null, featureIndex = 0, grain = null, collapsing = false;

    function sphere(ctx, c, R, yaw, roll, u) {
      var cr = Math.cos(roll), sr = Math.sin(roll), cy = Math.cos(yaw), sy = Math.sin(yaw);
      function proj(lat, lon) {
        var x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
        var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;           // turn about the vertical axis
        return [c.x + (x1 * cr - y * sr) * R, c.y + (x1 * sr + y * cr) * R, z1]; // then roll in the image
      }
      ctx.strokeStyle = GREEN;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      var lats = [-1.05, -0.52, 0, 0.52, 1.05], i, k, p;
      lats.forEach(function (lat) {
        for (k = 0; k <= 24; k++) { p = proj(lat, k / 24 * Math.PI * 2); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      });
      for (i = 0; i < 8; i++) {
        var lon = i / 8 * Math.PI * 2;
        for (k = 0; k <= 16; k++) { p = proj(-Math.PI / 2 + k / 16 * Math.PI, lon); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      lats.forEach(function (lat) {
        for (i = 0; i < 8; i++) {
          p = proj(lat, i / 8 * Math.PI * 2);
          ctx.globalAlpha = p[2] > 0 ? 1 : 0.45;
          ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.2, 1.8 * u), 0, Math.PI * 2); ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var t = frame.time / 1000;
        var dt = lastT === null ? 1 / 30 : Math.max(1 / 120, Math.min(0.1, t - lastT));
        lastT = t;

        if (params.mono) {
          ctx.save();
          ctx.globalCompositeOperation = 'saturation'; // keep luminosity, take gray's zero saturation
          ctx.fillStyle = '#808080';
          ctx.fillRect(0, 0, W, H);
          if (!grain) grain = ctx.createPattern(noiseCanvas(), 'repeat');
          ctx.globalCompositeOperation = 'overlay';
          ctx.globalAlpha = 0.22;
          var ox = Math.random() * 160, oy = Math.random() * 160;
          ctx.translate(-ox, -oy);
          ctx.fillStyle = grain;
          ctx.fillRect(0, 0, W + 160, H + 160);
          ctx.restore();
        }

        var faceT = Magi.tracking.face, handT = Magi.tracking.hands;
        var faces = faceT.detect(frame), hands = handT.detect(frame);
        var face = faces[0], hand = hands[0];
        var fs = Math.max(8, Math.round(8 * u)), pad = Math.max(1, Math.round(1.5 * u));
        ctx.font = fs + 'px ' + Magi.fx.MONO;
        ctx.textBaseline = 'top';

        var src = null, center = null, unitW = 0;
        if (face) {
          var feats = features(face);
          src = feats[params.mode === 'features' ? featureIndex % 4 : 0];
          unitW = feats[0].w;
          center = { x: (feats[0].c.x + feats[1].c.x + feats[2].c.x) / 3, y: (feats[0].c.y + feats[1].c.y + feats[2].c.y) / 3 - unitW * 0.4 };
        }

        // Hand readings.
        var scale = 1, rotation = 0, palmC = null, palm = 0;
        if (hand) {
          palm = dist(hand[WRIST], hand[MIDDLE_MCP]) || 1;
          palmC = { x: 0, y: 0 };
          PALM.forEach(function (i) { palmC.x += hand[i].x / 5; palmC.y += hand[i].y / 5; });
          var open = 0;
          TIPS.forEach(function (i) { open += dist(hand[i], palmC) / 5; });
          scale = open / palm / 1.45;
          rotation = Math.atan2(hand[MIDDLE_MCP].x - hand[WRIST].x, -(hand[MIDDLE_MCP].y - hand[WRIST].y)) * 180 / Math.PI;
        }

        // Spawn while a face and a hand are in view; otherwise everything returns to the source.
        collapsing = !(face && hand);
        if (!collapsing && tiles.length < params.count && t - lastSpawn >= 1 / (1 + params.rate * 0.15)) {
          lastSpawn = t;
          var tw = Math.max(8, Math.round(unitW * (0.6 + params.size / 100))), th = Math.max(6, Math.round(tw * 0.62));
          var sw = src.w, sh = sw * 0.62;
          var snap = document.createElement('canvas');
          snap.width = tw; snap.height = th;
          snap.getContext('2d').drawImage(out, src.c.x - sw / 2, src.c.y - sh / 2, sw, sh, 0, 0, tw, th);
          tiles.push({ img: snap, w: tw, h: th, x: src.c.x, y: src.c.y, slot: count, n: count, jx: (Math.random() - 0.5) * 0.35, jy: (Math.random() - 0.5) * 0.35 });
          count++;
          featureIndex++;
        }

        var ease = 1 - Math.exp(-dt * 7), rot = rotation * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
        tiles = tiles.filter(function (tl) {
          var tx, ty;
          if (collapsing || !center) {
            var home = src ? src.c : { x: tl.x, y: tl.y };
            tx = home.x; ty = home.y;
            if (Math.hypot(tx - tl.x, ty - tl.y) < Math.max(4, tl.w * 0.15)) return false;
          } else {
            var s = SPIRAL[tl.slot % SPIRAL.length], gx = (s[0] + tl.jx) * tl.w * 1.05 * scale, gy = (s[1] + tl.jy) * tl.h * 1.15 * scale;
            tx = center.x + gx * cr - gy * sr; ty = center.y + gx * sr + gy * cr;
          }
          tl.x += (tx - tl.x) * ease;
          tl.y += (ty - tl.y) * ease;
          return true;
        });
        if (!tiles.length) count = 0;

        ctx.save();
        ctx.lineWidth = Math.max(1, u);
        tiles.forEach(function (tl) {
          var x = Math.round(tl.x - tl.w / 2), y = Math.round(tl.y - tl.h / 2);
          ctx.drawImage(tl.img, x, y);
          ctx.strokeStyle = GREEN;
          ctx.strokeRect(x + 0.5, y + 0.5, tl.w - 1, tl.h - 1);
          ctx.fillStyle = GREEN;
          ctx.textAlign = 'right';
          ctx.fillText(String(tl.n).padStart(2, '0'), x + tl.w - pad * 2, y + pad * 2);
        });
        ctx.textAlign = 'left';
        if (src) {
          var bw = src.w, bh = bw * 0.62, bx = src.c.x - bw / 2, by = src.c.y - bh / 2;
          ctx.strokeStyle = GREEN;
          ctx.strokeRect(bx, by, bw, bh);
          label(ctx, 'source:', bx, by - fs - pad * 1.4, fs, pad);
        }
        if (hand) {
          var R = palm * 0.75;
          sphere(ctx, palmC, R, t * 0.8, rot, u);
          // Readouts beside the sphere, on whichever side has room.
          var t1 = 'scale: ' + scale.toFixed(2), t2 = 'rotation: ' + rotation.toFixed(1);
          var lw = ctx.measureText(t2).width + pad * 2, right = palmC.x + R + 6 * u + lw < W;
          var lx = right ? palmC.x + R + 6 * u : palmC.x - R - 6 * u - lw, ly = palmC.y - R * 0.3;
          label(ctx, t1, lx, ly, fs, pad);
          label(ctx, t2, lx, ly + fs + pad * 4, fs, pad);
        }
        ctx.restore();

        if (faceT.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, faceT, 'face');
        else if (handT.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, handT, 'hand');
        else if (!face) frame.say('Face the camera.');
        else if (!hand) frame.say('Raise a hand to start copying.');
      },
      reset: function () { tiles = []; count = 0; lastSpawn = 0; lastT = null; featureIndex = 0; }
    };
  }

  Magi.renderers.collage = createCollage;
})();
