// Tutting: a volume of image tiles held in the box your arms make, cut from your own room.
//
// Tutting is a dance of right angles made with the arms and hands, so the volume follows the box
// between your palms: its width is their horizontal distance, its height their vertical offset
// (never thinner than a hand), so it stretches to a slab side by side and stacks into a column
// one above the other. Tiles fill the box in 3D and are drawn in perspective, far to near.
// Each tile turns about the vertical axis like a page of an open book, by θ = (π/2)(1 − |x|)
// from the edges in, so its visible width is w·sin(π|x|/2): full at the sides, an edge-on
// sliver at the center. Fan sets how strongly they turn.
// Flick a hand down (Interaction Engine) and that side of the volume turns 90° like a Rubik's cube
// layer, its front going down, over 0.35 s (smoothstep easing); the tiles keep the new places,
// (y, z) → (−z, y). Left hand turns the left half, right hand the right half.
// Tiles show the camera itself, no outside images. Scatter: each tile keeps a piece of the room
// from somewhere in the frame. Behind: each tile shows what is behind it, shifted by its depth,
// like a pane of thick glass.
(function () {
  var PALM = [0, 5, 9, 13, 17], WRIST = 0, MIDDLE_TIP = 12, FOCAL = 3;

  function palmCenter(p) {
    var x = 0, y = 0;
    PALM.forEach(function (i) { x += p[i].x; y += p[i].y; });
    return { x: x / PALM.length, y: y / PALM.length };
  }

  function smoothstep(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  function createTutting() {
    var tiles = [], box = null, last = 0, turns = [], seenEvent = 0;
    var cam = document.createElement('canvas'), cctx = cam.getContext('2d');

    function build(n) {
      tiles = [];
      for (var i = 0; i < n; i++) {
        tiles.push({
          x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() * 2 - 1,
          s: 0.6 + Math.random() * 0.8, u: Math.random(), v: Math.random(),
          ph: Math.random() * 6.28, rate: 0.4 + Math.random()
        });
      }
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        if (cam.width !== W || cam.height !== H) { cam.width = W; cam.height = H; }
        frame.draw(cctx, W, H);
        ctx.drawImage(cam, 0, 0);
        if (tiles.length !== params.tiles) build(params.tiles);
        var dt = last ? Math.min(0.05, (frame.time - last) / 1000) : 1 / 60;
        last = frame.time;

        var tracker = Magi.tracking.hands, hands = tracker.detect(frame), ix = Magi.interaction.read(frame);
        // A downward flick turns that hand's half of the volume like a Rubik's cube layer.
        ix.events.forEach(function (e) {
          if (e.n <= seenEvent) return;
          seenEvent = e.n;
          if (e.type !== 'flick' || e.dir !== 'down') return;
          var side = e.side === 'left' ? -1 : 1;
          if (!turns.some(function (tn) { return tn.side === side; })) turns.push({ side: side, t: 0 });
        });
        turns = turns.filter(function (tn) {
          tn.t += dt / 0.35;
          if (tn.t < 1) return true;
          // Done: the half's tiles keep their new places, (y, z) → (−z, y).
          tiles.forEach(function (q) { if ((q.x < 0 ? -1 : 1) === tn.side) { var y = q.y; q.y = -q.z; q.z = y; } });
          return false;
        });
        if (hands.length >= 2) {
          var A = palmCenter(hands[0]), B = palmCenter(hands[1]);
          var hand = (Math.hypot(hands[0][MIDDLE_TIP].x - hands[0][WRIST].x, hands[0][MIDDLE_TIP].y - hands[0][WRIST].y) +
            Math.hypot(hands[1][MIDDLE_TIP].x - hands[1][WRIST].x, hands[1][MIDDLE_TIP].y - hands[1][WRIST].y)) / 2;
          var want = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, w: Math.max(Math.abs(B.x - A.x) / 2, hand * 0.5), h: Math.max(Math.abs(B.y - A.y) / 2, hand * 0.55) };
          if (!box) box = want;
          var e = 1 - Math.exp(-dt / 0.07);
          Object.keys(want).forEach(function (k) { box[k] += (want[k] - box[k]) * e; });
        } else {
          box = null;
        }

        if (box) {
          if (params.dim) {
            ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100 * 0.85).toFixed(3) + ')';
            ctx.fillRect(0, 0, W, H);
          }
          var depth = 0.15 + (params.depth / 100) * 0.85, fan = params.fan / 100, drift = (params.drift / 100) * 0.06;
          var base = Math.min(W, H) * 0.012 + (params.size / 100) * Math.min(W, H) * 0.05;
          var placed = tiles.map(function (q) {
            var x = Math.max(-1, Math.min(1, q.x + Math.sin(t * q.rate + q.ph) * drift));
            var y = Math.max(-1, Math.min(1, q.y + Math.cos(t * q.rate * 0.8 + q.ph) * drift)), z = q.z;
            // A turning half rotates about the horizontal axis, its front going down.
            turns.forEach(function (tn) {
              if ((q.x < 0 ? -1 : 1) !== tn.side) return;
              var a = smoothstep(tn.t) * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), y0 = y;
              y = y0 * c - z * s; z = y0 * s + z * c;
            });
            var k = FOCAL / (FOCAL + z * depth);
            var turn = (1 - fan) + fan * Math.sin(Math.PI * Math.abs(x) / 2);
            var w = base * q.s * k, hgt = w * 0.55;
            return { q: q, sx: box.x + x * box.w * k, sy: box.y + y * box.h * k, w: Math.max(1, w * turn), h: hgt, z: z, k: k };
          });
          placed.sort(function (a, b) { return b.z - a.z; });
          var behind = params.mode === 'behind';
          placed.forEach(function (p) {
            var sw = p.w * 1.4, sh = p.h * 1.4, sx, sy;
            if (behind) {
              sx = p.sx - sw / 2 + p.z * box.w * 0.35;
              sy = p.sy - sh / 2;
            } else {
              sx = p.q.u * (W - sw);
              sy = p.q.v * (H - sh);
            }
            sx = Math.max(0, Math.min(W - sw, sx));
            sy = Math.max(0, Math.min(H - sh, sy));
            ctx.globalAlpha = 0.6 + 0.4 * Math.min(1, p.k);
            ctx.drawImage(cam, sx, sy, sw, sh, p.sx - p.w / 2, p.sy - p.h / 2, p.w, p.h);
            if (params.edges) {
              ctx.strokeStyle = 'rgba(255,255,255,0.35)';
              ctx.lineWidth = 1;
              ctx.strokeRect(p.sx - p.w / 2, p.sy - p.h / 2, p.w, p.h);
            }
          });
          ctx.globalAlpha = 1;
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (hands.length < 2) Magi.tracking.hint(ctx, frame, 'Hold up both hands. Move them apart, together, above and below.');
      },
      reset: function () { last = 0; box = null; turns = []; }
    };
  }

  Magi.renderers.tutting = createTutting;
})();
