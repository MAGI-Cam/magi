// Fractals and circle constructions over the camera.
//
// Sierpiński triangle and Vicsek fractal are the attractors of iterated function systems. One
// step applies the Hutchinson operator W(A) = w₁(A) ∪ … ∪ wₙ(A): shrink the picture and place
// copies. Here the picture itself is iterated, so after n steps it is exactly Wⁿ(picture).
//   Recursive on: every smallest piece holds the whole camera image.
//   Recursive off: the shape is a window onto the camera behind it.
// The anti-snowflake is a triangle whose edges are Koch curves turned inward; its area tends to
// 2/5 of the triangle's, A = (√3/10)·s².
// Metatron's Cube, Vesica Piscis and Egg of Life are exact circle constructions (they are not
// fractals). Parity inverts the camera where an odd number of circles overlap, which reveals
// the lens and petal regions.
(function () {
  var fx = Magi.fx;
  var SQRT3 = Math.sqrt(3);

  function makeCanvas() { return document.createElement('canvas'); }
  function size(c, w, h) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }

  // Frame-sized output with the camera drawn into a reusable canvas.
  function setup(frame, out, cam) {
    var w = frame.width, h = frame.height;
    size(out, w, h);
    size(cam, w, h);
    frame.draw(cam.getContext('2d'), w, h);
    return out.getContext('2d');
  }

  function spinAngle(params, frame) {
    return (params.spin / 100) * (Math.PI / 6) * (frame.time / 1000); // up to 30° per second
  }

  // Small formula line in the lower left, drawn by difference so it reads on any image.
  function notation(ctx, frame, text) {
    var s = Math.round(12 * frame.pxPerCss), m = Math.round(20 * frame.pxPerCss);
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.font = '300 ' + s + 'px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, m, frame.height - m);
    ctx.restore();
  }

  // An IFS fractal built by iterating images. maps are [x, y] offsets of each copy in units of
  // the copy size, with ratio r (copy size / whole). seed(ctx, w, h) draws the level-0 shape.
  function ifs(spec) {
    return function () {
      var cam = makeCanvas(), a = makeCanvas(), b = makeCanvas(), mask = makeCanvas();
      return {
        animated: true,
        render: function (frame, out, params) {
          var ctx = setup(frame, out, cam), W = frame.width, H = frame.height;
          var R = (params.size / 100) * Math.min(W, H) * 0.5;
          var bw = Math.max(2, Math.round(spec.width * R)), bh = Math.max(2, Math.round(spec.height * R));
          size(a, bw, bh);
          size(b, bw, bh);
          var actx = a.getContext('2d');
          actx.clearRect(0, 0, bw, bh);
          actx.save();
          spec.seed(actx, bw, bh);
          actx.clip();
          if (params.recursive) {
            // Level 0: the camera, scaled to cover the shape's box.
            var s = Math.max(bw / W, bh / H);
            actx.drawImage(cam, (bw - W * s) / 2, (bh - H * s) / 2, W * s, H * s);
          } else {
            actx.fillStyle = '#fff';
            actx.fillRect(0, 0, bw, bh);
          }
          actx.restore();

          // Wⁿ: each pass draws the previous picture into every map's place, scaled by r.
          var src = a, dst = b;
          for (var n = 0; n < params.depth; n++) {
            var dctx = dst.getContext('2d');
            dctx.clearRect(0, 0, bw, bh);
            spec.maps.forEach(function (o) {
              dctx.drawImage(src, o[0] * bw * spec.ratio, o[1] * bh * spec.ratio, bw * spec.ratio, bh * spec.ratio);
            });
            var t = src; src = dst; dst = t;
          }

          var angle = spinAngle(params, frame);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          if (params.recursive) {
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.rotate(angle);
            ctx.drawImage(src, -bw / 2, -bh / 2);
            ctx.restore();
          } else {
            // The iterated shape becomes a mask; the camera shows only inside it.
            size(mask, W, H);
            var mctx = mask.getContext('2d');
            mctx.clearRect(0, 0, W, H);
            mctx.save();
            mctx.translate(W / 2, H / 2);
            mctx.rotate(angle);
            mctx.drawImage(src, -bw / 2, -bh / 2);
            mctx.restore();
            mctx.globalCompositeOperation = 'source-in';
            mctx.drawImage(cam, 0, 0);
            mctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(mask, 0, 0);
          }
          if (params.notation) notation(ctx, frame, spec.label + '   n = ' + params.depth);
        },
        reset: function () {}
      };
    };
  }

  // Sierpiński triangle: 3 maps of ratio 1/2. D = log 3 / log 2.
  var sierpinski = ifs({
    width: SQRT3, height: 1.5, ratio: 0.5,
    maps: [[0.5, 0], [0, 1], [1, 1]],
    seed: function (c, w, h) {
      c.beginPath();
      c.moveTo(w / 2, 0);
      c.lineTo(w, h);
      c.lineTo(0, h);
      c.closePath();
    },
    label: 'Sierpiński triangle   D = log 3 / log 2 ≈ 1.585'
  });

  // Vicsek fractal (cross form): 5 maps of ratio 1/3, the center and its four neighbors.
  // D = log 5 / log 3.
  var vicsek = ifs({
    width: Math.SQRT2, height: Math.SQRT2, ratio: 1 / 3,
    maps: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
    seed: function (c, w, h) {
      c.beginPath();
      c.rect(0, 0, w, h);
    },
    label: 'Vicsek fractal   D = log 5 / log 3 ≈ 1.465'
  });

  // Anti-snowflake: replace each edge P→Q with the Koch generator turned inward:
  // P, P + d, P + d + rot(d, ±60°), P + 2d, Q, where d = (Q − P)/3. Repeat n times.
  function antiSnowflake() {
    var cam = makeCanvas();
    var cache = { key: '', pts: null };

    function koch(pts, sign) {
      var out = [], c = Math.cos(Math.PI / 3), s = Math.sin(Math.PI / 3) * sign;
      for (var i = 0; i < pts.length; i++) {
        var P = pts[i], Q = pts[(i + 1) % pts.length];
        var dx = (Q[0] - P[0]) / 3, dy = (Q[1] - P[1]) / 3;
        var A = [P[0] + dx, P[1] + dy], B = [P[0] + 2 * dx, P[1] + 2 * dy];
        out.push(P, A, [A[0] + dx * c - dy * s, A[1] + dx * s + dy * c], B);
      }
      return out;
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var ctx = setup(frame, out, cam), W = frame.width, H = frame.height;
        var side = (params.size / 100) * Math.min(W, H) * SQRT3 * 0.5;
        var key = side + ':' + params.depth;
        if (cache.key !== key) {
          // Triangle centered on its centroid, apex up, vertices clockwise on screen. With this
          // winding, turning by +60° sends each bump inward (checked: area → 0.4046·T at n = 6,
          // tending to 2/5; the other sign gives the outward snowflake, tending to 8/5).
          var r = side / SQRT3;
          var pts = [[0, -r], [side / 2, r / 2], [-side / 2, r / 2]];
          for (var n = 0; n < params.depth; n++) pts = koch(pts, 1);
          cache = { key: key, pts: pts, tri: [[0, -r], [side / 2, r / 2], [-side / 2, r / 2]] };
        }
        var cx = W / 2, cy = H / 2 + side * 0.04, angle = spinAngle(params, frame);
        function shape(pts) {
          ctx.beginPath();
          pts.forEach(function (p, i) {
            var x = cx + p[0] * Math.cos(angle) - p[1] * Math.sin(angle);
            var y = cy + p[0] * Math.sin(angle) + p[1] * Math.cos(angle);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        // What the Koch bumps removed: the triangle's camera, dimmed.
        ctx.save();
        shape(cache.tri);
        ctx.clip();
        ctx.drawImage(cam, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.74)';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        // The anti-snowflake itself: the camera at full strength.
        ctx.save();
        shape(cache.pts);
        ctx.clip();
        ctx.drawImage(cam, 0, 0);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(1, frame.pxPerCss);
        shape(cache.tri);
        ctx.stroke();
        if (params.notation) notation(ctx, frame, 'Anti-snowflake   A = (√3 / 10)·s² = (2 / 5)·T   n = ' + params.depth);
      },
      reset: function () {}
    };
  }

  // Circle constructions. figure(R) returns { circles: [[x, y, r]], lines: [[x1, y1, x2, y2]] }
  // centered on the origin and fitting within radius R.
  function circles(spec) {
    return function () {
      var cam = makeCanvas();
      return {
        animated: true,
        render: function (frame, out, params) {
          var ctx = setup(frame, out, cam), W = frame.width, H = frame.height;
          var R = (params.size / 100) * Math.min(W, H) * 0.47;
          var fig = spec.figure(R);
          ctx.drawImage(cam, 0, 0);
          ctx.save();
          ctx.translate(W / 2, H / 2);
          ctx.rotate(spinAngle(params, frame));
          ctx.globalCompositeOperation = 'difference';
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#fff';
          if (params.parity) {
            // Each circle inverts what is under it; two inversions cancel, so the result is
            // inverted exactly where an odd number of circles overlap.
            fig.circles.forEach(function (c) {
              ctx.beginPath();
              ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2);
              ctx.fill();
            });
          }
          ctx.lineWidth = Math.max(1, params.weight * 0.6 * frame.pxPerCss);
          ctx.beginPath();
          fig.circles.forEach(function (c) {
            ctx.moveTo(c[0] + c[2], c[1]);
            ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2);
          });
          (fig.lines || []).forEach(function (l) {
            ctx.moveTo(l[0], l[1]);
            ctx.lineTo(l[2], l[3]);
          });
          ctx.stroke();
          ctx.restore();
          if (params.notation) notation(ctx, frame, spec.label);
        },
        reset: function () {}
      };
    };
  }

  // Fruit of Life centers: the center, then two rings of six at distances 2r and 4r, pointing up.
  function fruitOfLife(r) {
    var pts = [[0, 0]];
    [2, 4].forEach(function (d) {
      for (var k = 0; k < 6; k++) {
        var a = -Math.PI / 2 + k * Math.PI / 3;
        pts.push([d * r * Math.cos(a), d * r * Math.sin(a)]);
      }
    });
    return pts;
  }

  // Metatron's Cube: the 13 Fruit of Life circles and a line between every pair of centers,
  // C(13, 2) = 78 lines. Circle radius r = R/5 so the outer circles touch radius R.
  var metatron = circles({
    figure: function (R) {
      var r = R / 5, pts = fruitOfLife(r), lines = [];
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) lines.push([pts[i][0], pts[i][1], pts[j][0], pts[j][1]]);
      }
      return { circles: pts.map(function (p) { return [p[0], p[1], r]; }), lines: lines };
    },
    label: 'Metatron’s Cube   13 circles   C(13, 2) = 78 lines'
  });

  // Vesica Piscis: two circles of radius r whose centers lie on each other's circumference.
  // The lens is r wide and r√3 tall; its centers and tips form two equilateral triangles.
  var vesica = circles({
    figure: function (R) {
      var r = R * 2 / 3, x = r / 2, y = r * SQRT3 / 2;
      return {
        circles: [[-x, 0, r], [x, 0, r]],
        lines: [[-x, 0, x, 0], [0, -y, 0, y], [-x, 0, 0, -y], [0, -y, x, 0], [x, 0, 0, y], [0, y, -x, 0]]
      };
    },
    label: 'Vesica Piscis   width : height = 1 : √3'
  });

  // Egg of Life: seven circles of radius r in hexagonal close packing, centers 2r apart.
  var egg = circles({
    figure: function (R) {
      var r = R / 3, out = [[0, 0, r]];
      for (var k = 0; k < 6; k++) out.push([2 * r * Math.cos(k * Math.PI / 3), 2 * r * Math.sin(k * Math.PI / 3), r]);
      return { circles: out };
    },
    label: 'Egg of Life   7 circles   centers 2r apart'
  });

  Magi.renderers['fractal-vicsek'] = vicsek;
  Magi.renderers['fractal-sierpinski'] = sierpinski;
  Magi.renderers['fractal-anti-snowflake'] = antiSnowflake;
  Magi.renderers['fractal-metatron'] = metatron;
  Magi.renderers['fractal-vesica'] = vesica;
  Magi.renderers['fractal-egg'] = egg;
})();
