// Text Cry: your words pour from your eyes as tears.
//
// Face Landmarker gives 478 points; 145 and 374 are the centers of the two lower eyelids.
// Each eye releases the text one grapheme at a time (what a reader sees as one character, so
// emoji, accents and every script stay whole). Letters fall ballistically,
// y = y0 + v0·t + ½·g·t², with a small sideways drift.
// Pool on: letters land and settle like sand, each sliding to a lower neighboring column until
// no neighbor is more than one letter lower (a sandpile at its angle of repose).
// Pool off: they fall through the bottom of the frame.
(function () {
  var LOWER_LID = [145, 374];
  var EYE_CORNERS = [[33, 133], [362, 263]];
  var FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var MAX_FALLING = 500;

  var segmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  function graphemes(text) {
    if (segmenter) return Array.from(segmenter.segment(text), function (s) { return s.segment; });
    return Array.from(text); // code points: keeps emoji whole, may split combined accents
  }

  function createTextCry() {
    var falling = [], columns = [], cursors = [0, 0], clocks = [0, 0];
    var last = 0, layoutKey = '', text = '', glyphs = [];

    function resetPile(count) {
      columns = [];
      for (var i = 0; i < count; i++) columns.push([]);
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var w = frame.width, h = frame.height;
        if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, w, h);

        var dt = last ? Math.min(0.05, (frame.time - last) / 1000) : 0;
        last = frame.time;

        // Size is relative to the frame, so piled letters line up in fixed columns.
        var size = Math.round(h * (0.02 + (params.size / 100) * 0.09));
        var colW = size * 0.78, line = size * 1.02;
        var count = Math.max(1, Math.ceil(w / colW));
        var k = w + 'x' + h + ':' + size;
        if (k !== layoutKey) { layoutKey = k; resetPile(count); falling = []; }
        if (params.text !== text) { text = params.text; glyphs = graphemes(text); cursors = [0, 0]; }

        var speed = params.speed / 100;
        var rate = 2 + speed * 14;            // letters per second, per eye
        var g = h * (0.6 + speed * 2.2);      // gravity in frame pixels per second²

        var faces = Magi.tracking.face.detect(frame);
        var face = faces[0];
        if (face && glyphs.length) {
          for (var e = 0; e < 2; e++) {
            var lid = face[LOWER_LID[e]];
            var c = EYE_CORNERS[e], eyeW = Math.hypot(face[c[0]].x - face[c[1]].x, face[c[0]].y - face[c[1]].y);
            clocks[e] += dt * rate;
            while (clocks[e] >= 1) {
              clocks[e] -= 1;
              var ch = glyphs[cursors[e] % glyphs.length];
              cursors[e]++;
              if (!ch.trim() || falling.length >= MAX_FALLING) continue; // spaces leave a pause
              falling.push({
                ch: ch,
                x: lid.x + (Math.random() - 0.5) * eyeW * 0.35,
                y: lid.y + size * 0.6,
                vx: (Math.random() - 0.5) * eyeW * 0.6,
                vy: g * 0.04
              });
            }
          }
        }

        ctx.save();
        ctx.font = '400 ' + size + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        var ink = Magi.fx.inkColor(params.color);
        ctx.fillStyle = 'rgb(' + ink.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = size * 0.25;

        var maxRows = Math.floor(h / line) - 1;
        for (var i = falling.length - 1; i >= 0; i--) {
          var t = falling[i];
          t.vy += g * dt;
          t.x += t.vx * dt;
          t.y += t.vy * dt;
          if (params.pool) {
            var col = Math.min(count - 1, Math.max(0, Math.floor(t.x / colW)));
            var floor = h - columns[col].length * line;
            if (t.y >= floor) {
              // Settle: roll toward whichever neighbor is at least two letters lower.
              for (var moved = true; moved;) {
                moved = false;
                var here = columns[col].length;
                var left = col > 0 ? columns[col - 1].length : Infinity;
                var right = col < count - 1 ? columns[col + 1].length : Infinity;
                if (Math.min(left, right) + 1 < here) {
                  col += left <= right ? -1 : 1;
                  moved = true;
                }
              }
              if (columns[col].length < maxRows) columns[col].push(t.ch);
              falling.splice(i, 1);
              continue;
            }
          } else if (t.y - size > h) {
            falling.splice(i, 1);
            continue;
          }
          ctx.fillText(t.ch, t.x, t.y);
        }

        if (params.pool) {
          for (var cI = 0; cI < count; cI++) {
            var stack = columns[cI], cx = (cI + 0.5) * colW;
            for (var r = 0; r < stack.length; r++) ctx.fillText(stack[r], cx, h - r * line - size * 0.22);
          }
        } else if (columns.some(function (s) { return s.length; })) {
          // Turning Pool off lets what had pooled fall away too.
          columns.forEach(function (stack, cI) {
            stack.forEach(function (ch, r) {
              falling.push({ ch: ch, x: (cI + 0.5) * colW, y: h - r * line, vx: 0, vy: 0 });
            });
          });
          resetPile(count);
        }
        ctx.restore();

        var tracker = Magi.tracking.face;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'face');
        else if (!face) Magi.tracking.hint(ctx, frame, 'Look into the camera.');
      },
      reset: function () { layoutKey = ''; last = 0; falling = []; }
    };
  }

  Magi.renderers['text-cry'] = createTextCry;
})();
