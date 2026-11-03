// Mosh: real datamoshing, steered by your hand.
//
// Video codecs store most frames as P-frames: per-block motion vectors ("this 16×16 block came
// from 3 px to the left") plus a small correction. Datamoshing removes the I-frames (full
// pictures), so those vectors keep moving the pixels of a stale picture and the image smears
// and blooms. Here the vectors are measured from the camera with three-step search, a classic
// codec block-matching algorithm (fx.motionEstimator), and applied, with no correction, to a buffer that is never
// refreshed, but only inside the zone around your hand.
//
// Hand: the zone sits between thumb and index fingertip and grows as they spread apart.
// Clap your hands and the whole picture snaps clean, like a fresh I-frame.
// Scale multiplies the vectors; Hold sets how long the smear stays before it unwinds, block by
// block, in the reverse of the order it was moshed.
(function () {
  var fx = Magi.fx;
  // Macroblock size in frame pixels for each Block step (1–9).
  var BLOCKS = [12, 16, 20, 24, 32, 40, 48, 56, 64];
  var THUMB_TIP = 4, INDEX_TIP = 8;

  function createMosh() {
    var cur = document.createElement('canvas'), cctx = cur.getContext('2d');
    var bufs = [document.createElement('canvas'), document.createElement('canvas')];
    var est = fx.motionEstimator(), key = '', front = 0, lastSeen = 0;
    // Per block: entry order while moshing (−1 = clean), and when it should restore.
    var order = null, restoreAt = null, counter = 0, fresh = true, seenClap = 0;

    return {
      animated: true,
      render: function (frame, out, params) {
        var w = frame.width, h = frame.height;
        var B = BLOCKS[params.block - 1] || 32;
        var cols = Math.ceil(w / B), rows = Math.ceil(h / B);
        var k = w + 'x' + h + ':' + B;
        if (k !== key) {
          key = k;
          [cur, out, bufs[0], bufs[1]].forEach(function (c) { c.width = w; c.height = h; });
          order = new Int32Array(cols * rows).fill(-1);
          restoreAt = new Float64Array(cols * rows).fill(Infinity);
          counter = 0;
          fresh = true;
        }
        var now = frame.time / 1000;

        frame.draw(cctx, w, h);
        var octx = out.getContext('2d');
        if (fresh) {
          // Start both buffers from the real picture. Moshing an empty buffer smears black.
          bufs[0].getContext('2d').drawImage(cur, 0, 0);
          bufs[1].getContext('2d').drawImage(cur, 0, 0);
          fresh = false;
        }

        // Zones from tracked hands: center between thumb and index tips, radius from their spread.
        var hands = Magi.tracking.hands.detect(frame);
        var zones = [], pinched = false;
        var reach = 0.6 + (params.reach / 100) * 2.4;
        hands.forEach(function (p) {
          var a = p[THUMB_TIP], b = p[INDEX_TIP];
          var spread = Math.hypot(a.x - b.x, a.y - b.y);
          zones.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: spread * reach + B });
        });
        // A clap (Interaction Engine) snaps the picture clean.
        Magi.interaction.read(frame).events.forEach(function (e) {
          if (e.type === 'clap' && e.n > seenClap) { seenClap = e.n; pinched = true; }
        });
        if (hands.length) lastSeen = frame.time;

        // Hold: a block that leaves the zone keeps moshing for `hold` seconds, then blocks restore
        // one at a time, most recently moshed first, over about half the hold again.
        var hold = (params.hold / 100) * 6;
        var moshing = 0;
        for (var c = 0; c < order.length; c++) if (order[c] >= 0) moshing++;
        var step = (0.3 + hold * 0.5) / Math.max(1, moshing);
        var any = false;
        for (var by = 0, i = 0; by < rows; by++) {
          for (var bx = 0; bx < cols; bx++, i++) {
            var mx = (bx + 0.5) * B, my = (by + 0.5) * B, inside = false;
            for (var z = 0; z < zones.length; z++) {
              if (Math.hypot(mx - zones[z].x, my - zones[z].y) < zones[z].r) { inside = true; break; }
            }
            if (pinched) {
              order[i] = -1;
            } else if (inside) {
              if (order[i] < 0) order[i] = counter++;
              restoreAt[i] = Infinity;
            } else if (order[i] >= 0) {
              if (restoreAt[i] === Infinity) restoreAt[i] = now + hold + (counter - 1 - order[i]) * step;
              if (now >= restoreAt[i]) order[i] = -1;
            }
            if (order[i] >= 0) any = true;
          }
        }
        if (!any) counter = 0;
        var gain = Math.pow(2, (params.scale - 50) / 25); // Scale: motion vectors × 0.25 to × 4

        est.update(cur, w, h, B);

        var src = bufs[front], dst = bufs[1 - front], dctx = dst.getContext('2d');
        if (!any) {
          // Nothing moshing: the picture is just the camera, and the buffer stays in sync with it.
          dctx.drawImage(cur, 0, 0);
        } else {
          for (var y = 0, j = 0; y < rows; y++) {
            for (var x = 0; x < cols; x++, j++) {
              var X = x * B, Y = y * B;
              if (order[j] >= 0) {
                // P-block: copy from the stale buffer along the motion vector, no correction.
                var v = est.vector(x, y);
                var sx = Math.min(w - B, Math.max(0, X + gain * v[0]));
                var sy = Math.min(h - B, Math.max(0, Y + gain * v[1]));
                dctx.drawImage(src, sx, sy, B, B, X, Y, B, B);
              } else {
                // I-block: the real picture.
                dctx.drawImage(cur, X, Y, B, B, X, Y, B, B);
              }
            }
          }
        }
        front = 1 - front;
        octx.drawImage(dst, 0, 0);

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') {
          Magi.tracking.drawStatus(octx, frame, tracker, 'hand');
        } else if (frame.time - lastSeen > 1500) {
          Magi.tracking.hint(octx, frame, 'Raise a hand. Spread to mosh, clap to clear.');
        }
      },
      reset: function () { key = ''; }
    };
  }

  Magi.renderers.mosh = createMosh;
})();
