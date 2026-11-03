// Datamosh: the whole picture loses its keyframes and melts along its own motion.
//
// A video codec sends a full picture (I-frame) now and then and, between them, P-frames: one
// motion vector per macroblock ("this block came from 6 px to the left") plus a residual that
// corrects what the vector got wrong. Datamoshing deletes the I-frames, so the vectors go on
// moving the pixels of a picture that is no longer there: the old image smears along the new
// motion. Here the vectors are measured from the camera with three-step search
// (fx.motionEstimator) and applied, block by block, to a buffer that is never refreshed.
//   Residual: how much of the real correction is kept (0 = pure mosh, the classic look).
//   Bloom: P-frame duplication, the other datamosh trick: one P-frame repeated, so the same
//   vectors push again and again and the picture balloons in their direction. A swipe captures
//   that frame's vectors (spread out a little, plus the swipe's direction where things moved) and
//   repeats them, fading over up to 3 s.
//   Keyframes: an I-frame every 1–10 s (far left: never).
// Hand: make a fist and the keyframes stop; clap and a fresh keyframe cleans the picture. With
// Hand off it always moshes.
(function () {
  var fx = Magi.fx;
  var BLOCKS = [12, 16, 20, 24, 32, 40, 48, 56, 64];
  var DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

  function createDatamosh() {
    var cur = document.createElement('canvas'), cctx = cur.getContext('2d');
    var bufs = [document.createElement('canvas'), document.createElement('canvas')];
    var est = fx.motionEstimator(), key = '', front = 0, fresh = true;
    var moshing = false, seen = 0, fistSince = null, lastKey = 0, lastIx = null;
    var bloom = null, bloomAt = 0, vecs = null;

    function keyframe(t) { fresh = true; lastKey = t; }

    return {
      animated: true,
      render: function (frame, out, params) {
        var w = frame.width, h = frame.height, t = frame.time / 1000;
        var B = BLOCKS[params.block - 1] || 24, cols = Math.ceil(w / B), rows = Math.ceil(h / B);
        var k = w + 'x' + h + ':' + B;
        if (k !== key) {
          key = k;
          [cur, out, bufs[0], bufs[1]].forEach(function (c) { c.width = w; c.height = h; });
          vecs = new Float32Array(cols * rows * 2);
          bloom = null; fresh = true;
        }
        frame.draw(cctx, w, h);
        var octx = out.getContext('2d');
        var ix = Magi.interaction.read(frame), fid = Magi.tracking.frameId(frame.source) + w, newFrame = fid !== lastIx;
        lastIx = fid;

        // Gestures: a fist held 0.15 s drops the keyframes; a clap brings one back.
        if (params.hand) {
          var fist = ix.hands.some(function (hd) { return hd.fist; });
          if (fist) { if (fistSince === null) fistSince = t; } else fistSince = null;
          if (fistSince !== null && t - fistSince > 0.15 && !moshing) { moshing = true; keyframe(t); }
        } else if (!moshing) { moshing = true; keyframe(t); }
        ix.events.forEach(function (e) {
          if (e.n <= seen) return;
          seen = e.n;
          if (e.type === 'clap') { if (params.hand) moshing = false; keyframe(t); }
          if (e.type === 'swipe' && moshing && vecs) {
            // P-frame duplication: keep this frame's vectors, spread to neighbors, plus the swipe.
            var d = DIRS[e.dir] || [0, 0], push = B * 0.5, field = new Float32Array(vecs.length);
            for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
              var bx = 0, by = 0, bm = -1;
              for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
                var xx = x + ox, yy = y + oy;
                if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
                var q = (yy * cols + xx) * 2, m = vecs[q] * vecs[q] + vecs[q + 1] * vecs[q + 1];
                if (m > bm) { bm = m; bx = vecs[q]; by = vecs[q + 1]; }
              }
              var i2 = (y * cols + x) * 2;
              // The swipe's push goes only where something was moving, so the moving part balloons.
              var moving = Math.min(1, Math.sqrt(bm) / (B * 0.25));
              field[i2] = bx - d[0] * push * moving; field[i2 + 1] = by - d[1] * push * moving;
            }
            bloom = field; bloomAt = t;
          }
        });
        // Keyframes on a timer.
        var every = params.keyframes > 0 ? 1 + (100 - params.keyframes) / 100 * 9 : 0;
        if (moshing && every && t - lastKey > every) keyframe(t);

        if (fresh) {
          bufs[0].getContext('2d').drawImage(cur, 0, 0);
          bufs[1].getContext('2d').drawImage(cur, 0, 0);
          fresh = false;
        }
        var src = bufs[front], dst = bufs[1 - front], dctx = dst.getContext('2d');
        if (!moshing) {
          dctx.drawImage(cur, 0, 0);
          if (newFrame) est.update(cur, w, h, B);
        } else if (newFrame) {
          // One P-frame per camera frame: every block copied from the stale picture along its vector.
          est.update(cur, w, h, B);
          var gain = Math.pow(2, (params.scale - 50) / 25);
          var life = params.bloom / 100 * 3, bl = bloom && life > 0 ? Math.max(0, 1 - (t - bloomAt) / life) : 0;
          if (!bl) bloom = null;
          for (var by2 = 0, j = 0; by2 < rows; by2++) {
            for (var bx2 = 0; bx2 < cols; bx2++, j++) {
              var v = est.vector(bx2, by2), X = bx2 * B, Y = by2 * B;
              vecs[j * 2] = v[0]; vecs[j * 2 + 1] = v[1];
              var vx = gain * v[0], vy = gain * v[1];
              if (bl) { vx += bloom[j * 2] * gain * bl; vy += bloom[j * 2 + 1] * gain * bl; }
              var sx = Math.min(w - B, Math.max(0, X + vx)), sy = Math.min(h - B, Math.max(0, Y + vy));
              dctx.drawImage(src, sx, sy, B, B, X, Y, B, B);
            }
          }
          // Residual: part of the codec's correction toward the real picture.
          if (params.residual > 0) {
            dctx.globalAlpha = Math.pow(params.residual / 100, 2) * 0.5;
            dctx.drawImage(cur, 0, 0);
            dctx.globalAlpha = 1;
          }
        } else {
          dctx.drawImage(src, 0, 0);
        }
        front = 1 - front;
        octx.drawImage(dst, 0, 0);

        if (params.hand) {
          var tracker = Magi.tracking.hands;
          if (tracker.status() !== 'ready') Magi.tracking.drawStatus(octx, frame, tracker, 'hand');
          else if (!moshing) Magi.tracking.hint(octx, frame, 'Make a fist to drop the keyframes. Clap to clean.');
        }
      },
      reset: function () { key = ''; moshing = false; fistSince = null; bloom = null; lastIx = null; }
    };
  }

  Magi.renderers.datamosh = createDatamosh;
})();
