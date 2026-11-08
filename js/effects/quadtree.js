// Quadtree × Bokeh: what's in focus breaks into fine cells that keep the picture; what's out of
// focus melts into big flat squares.
//
// Bokeh: a lens blur. A thin lens images a point at distance S, focused at Sf, as a disc (circle
// of confusion) of diameter c = A·f·|S − Sf| / (S·(Sf − f)), so c ∝ |1 − Sf/S| for a fixed lens.
// Depth comes from MediaPipe's person mask (Magi.tracking.body), smoothed in time and space: you at 0.35, the room at 1 (in
// units of the background distance). Focus starts on you, so the room blurs (portrait mode).
// Pinch: focus moves to what's under the pinch (you or the room), and blur also grows with
// distance from that point across the frame, like a tilted focal plane. Make a fist: back to
// portrait focus. With nobody in view everything is in focus until you pinch. Blur sets the largest disc (Blur, up to 40 px at 720 p).
// The disc is gathered at half resolution with 64 golden-angle taps (turned per pixel by a fixed
// noise, so no rings show) over each pixel's own disc, then laid over the sharp camera; a tap counts only
// where its own disc reaches back to this pixel (scatter as gather), so sharp things don't smear
// into the blur around them, and bright taps weigh more, as highlights bloom into discs.
// Quadtree (Finkel & Bentley 1974; as in quadtree image coding): the frame is tiled with
// squares of Max size; a square splits into four while the standard deviation of its brightness
// is above a threshold (Detail), scaled by focus (×0.35 in focus, ×2.5 out of focus), and it is
// larger than Min. A sharp edge stays high-variance at
// every scale, so it divides down to the smallest cells; a blurred transition stops splitting at
// about its blur width; flat bokeh stays in big squares. Squares are filled with their mean
// color; the smallest cells keep the picture itself. Lines are 1 px. Faint lines outline every square (Lines,
// tinted by Color). Means and variances come from summed-area tables (Crow 1984), O(1) per square.
(function () {
  var FRAG = [
    'precision highp float;',
    'uniform sampler2D cam, mask;',
    'uniform vec2 size, focus;',
    'uniform float rmax, zf, useFocus, hasMask, H;',
    'varying vec2 uv;',
    'float depth(vec2 p) { return hasMask > 0.5 ? mix(1.0, 0.35, smoothstep(0.3, 0.7, texture2D(mask, p).r)) : 1.0; }',
    // Blur radius in pixels: thin-lens circle of confusion, normalized so you vs. the room is 1.
    'float coc(vec2 p) {',
    '  float c = min(1.0, abs(1.0 - zf / depth(p)) / 0.65);',
    '  if (useFocus > 0.5) c = min(1.0, c + 0.9 * smoothstep(0.08 * H, 0.55 * H, length(p * size - focus)));',
    '  return c * rmax;',
    '}',
    'void main() {',
    '  vec2 px = uv * size;',
    '  float rc = coc(uv);',
    '  vec3 base = texture2D(cam, uv).rgb;',
    '  if (rc < 0.35) { gl_FragColor = vec4(base, 0.0); return; }',
    '  vec3 sum = base; float wsum = 1.0;',
    // A fixed rotation per pixel (interleaved gradient noise) turns the taps' rings into fine,
    // still grain instead of visible circles.
    '  float rot = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
    '  for (int i = 0; i < 64; i++) {',
    '    float r = sqrt((float(i) + 0.5) / 64.0) * rc, a = float(i) * 2.39996 + rot;',
    '    vec2 q = clamp((px + vec2(cos(a), sin(a)) * r) / size, 0.0, 1.0);',
    '    vec3 c = texture2D(cam, q).rgb;',
    '    float w = clamp(coc(q) - r + 1.0, 0.0, 1.0);',
    '    w *= 1.0 + 3.0 * pow(dot(c, vec3(0.2126, 0.7152, 0.0722)), 4.0);',
    '    sum += c * w; wsum += w;',
    '  }',
    '  gl_FragColor = vec4(sum / wsum, smoothstep(0.35, 1.5, rc));',
    '}'
  ].join('\n');

  function createQuadtree() {
    var cur = document.createElement('canvas'), cctx = cur.getContext('2d');
    var ana = document.createElement('canvas'), actx = ana.getContext('2d', { willReadFrequently: true });
    var mos = document.createElement('canvas'), mctx = mos.getContext('2d');
    var pattern = null, patternKey = '';
    var pass, maskBytes = null, maskDirty = false, focus = null, zf = 0.35, lastSeg = null, present = 0, smooth = null, mw = 0, mh = 0;
    var half = document.createElement('canvas'), hctx = half.getContext('2d'), cellPrev = null;
    var satY = null, satY2 = null, satR = null, satG = null, satB = null, satF = null, mosaic = null, gw = 0, gh = 0;

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        if (cur.width !== W || cur.height !== H) { cur.width = W; cur.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(cctx, W, H);

        // Depth from the person mask; focus from a pinch.
        var seg = Magi.tracking.body.detect(frame), ix = Magi.interaction.read(frame);
        // The person mask, smoothed in time (each new mask moves it 40% of the way, so its edge
        // doesn't flicker) and in space (a 3×3 box blur feathers the edge); read bilinearly.
        if (seg && seg !== lastSeg) {
          lastSeg = seg;
          var nm = seg.width * seg.height, fresh = !smooth || mw !== seg.width || mh !== seg.height;
          if (fresh) { smooth = new Float32Array(nm); mw = seg.width; mh = seg.height; }
          var tmp = new Float32Array(nm);
          for (var yy0 = 0; yy0 < mh; yy0++) for (var xx0 = 0; xx0 < mw; xx0++) {
            var acc = 0, cnt = 0;
            for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
              var xs = xx0 + dx, ys = yy0 + dy;
              if (xs >= 0 && ys >= 0 && xs < mw && ys < mh) { acc += seg.mask[ys * mw + xs]; cnt++; }
            }
            tmp[yy0 * mw + xx0] = acc / cnt;
          }
          present = 0;
          for (var q = 0; q < nm; q++) { smooth[q] = fresh ? tmp[q] : smooth[q] + (tmp[q] - smooth[q]) * 0.4; if (smooth[q] > 0.5) present++; }
          present /= nm;
          if (!maskBytes || maskBytes.length !== nm * 4) maskBytes = new Uint8Array(nm * 4);
          for (var q2 = 0, o2 = 0; q2 < nm; q2++, o2 += 4) { var v2 = Math.round(smooth[q2] * 255); maskBytes[o2] = maskBytes[o2 + 1] = maskBytes[o2 + 2] = v2; maskBytes[o2 + 3] = 255; }
          maskDirty = true;
        }
        var maskAt = function (x, y) {
          if (!smooth) return 0;
          var fx = Math.max(0, Math.min(mw - 1.001, x / W * mw - 0.5)), fy = Math.max(0, Math.min(mh - 1.001, y / H * mh - 0.5));
          var x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, i0 = y0 * mw + x0;
          return (smooth[i0] * (1 - ax) + smooth[i0 + 1] * ax) * (1 - ay) + (smooth[i0 + mw] * (1 - ax) + smooth[i0 + mw + 1] * ax) * ay;
        };
        ix.hands.forEach(function (hd) {
          if (hd.pinched) {
            var p = hd.points;
            focus = { x: (p[4].x + p[8].x) / 2, y: (p[4].y + p[8].y) / 2 };
            var m = maskAt(focus.x, focus.y);
            zf = 1 + (0.35 - 1) * Math.min(1, Math.max(0, (m - 0.3) / 0.4));
          } else if (hd.fist) { focus = null; zf = 0.35; }
        });

        // With nobody in view (under 1% of the frame) there is no depth: all in focus, unless pinched.
        var person = !!smooth && present > 0.01;
        var img = cur;
        if (pass === undefined) pass = Magi.fx.shaderPass(FRAG, ['cam', 'mask']);
        if (pass && params.blur > 0) {
          if (maskDirty && maskBytes) { pass.data('mask', mw, mh, maskBytes); maskDirty = false; }
          // The blur runs at half resolution (a blurred picture loses nothing there), which buys 64
          // taps; it comes out transparent where you're in focus and is laid over the sharp camera.
          var hw = Math.max(1, Math.round(W / 2)), hh = Math.max(1, Math.round(H / 2));
          if (half.width !== hw || half.height !== hh) { half.width = hw; half.height = hh; }
          hctx.drawImage(cur, 0, 0, hw, hh);
          pass.texture('cam', half);
          pass.run(hw, hh, {
            size: [hw, hh], focus: focus ? [focus.x / 2, focus.y / 2] : [0, 0], rmax: params.blur / 100 * 20 * H / 720,
            zf: person || focus ? zf : 1, useFocus: focus ? 1 : 0, hasMask: person ? 1 : 0, H: hh
          });
          ctx.drawImage(cur, 0, 0);
          ctx.drawImage(pass.canvas, 0, 0, W, H);
          img = out;
        } else ctx.drawImage(img, 0, 0, W, H);

        // Analysis: the picture scaled down to one sample per smallest cell (the browser averages
        // each cell's pixels); summed-area tables of brightness, its square and color.
        var m = Math.max(2, Math.round(params.min * u)), cols = Math.ceil(W / m), rows = Math.ceil(H / m);
        if (cols !== gw || rows !== gh) {
          gw = cols; gh = rows;
          ana.width = gw; ana.height = gh; mos.width = gw; mos.height = gh;
          var sz = (gw + 1) * (gh + 1);
          satY = new Float64Array(sz); satY2 = new Float64Array(sz); satR = new Float64Array(sz); satG = new Float64Array(sz); satB = new Float64Array(sz); satF = new Float64Array(sz);
          mosaic = mctx.createImageData(gw, gh);
        }
        actx.clearRect(0, 0, ana.width, ana.height);
        // A true average of each cell's pixels (high-quality downscale), then eased in time with the
        // last frames' (60% new), so squares don't pop between sizes on camera noise.
        actx.imageSmoothingEnabled = true;
        actx.imageSmoothingQuality = 'high';
        actx.drawImage(img === out ? out : img, 0, 0, W / m, H / m);
        var d = actx.getImageData(0, 0, gw, gh).data, S = gw + 1;
        if (!cellPrev || cellPrev.length !== d.length) cellPrev = Float32Array.from(d);
        else for (var e0 = 0; e0 < d.length; e0++) { cellPrev[e0] += (d[e0] - cellPrev[e0]) * 0.6; }
        d = cellPrev;
        var lastX = Math.max(0, Math.ceil(W / m) - 1), lastY = Math.max(0, Math.ceil(H / m) - 1);
        // In focus: the same circle of confusion as the shader, per cell (1 = sharp, 0 = fully blurred).
        var depthOn = pass && params.blur > 0 && (person || focus);
        var depthAt = function (x, y) { return person ? 1 + (0.35 - 1) * Math.min(1, Math.max(0, (maskAt(x, y) - 0.3) / 0.4)) : 1; };
        var zfNow = person || focus ? zf : 1;
        for (var y = 0; y < gh; y++) {
          var ry = 0, ry2 = 0, rr = 0, rg = 0, rb = 0, rf = 0;
          for (var x = 0; x < gw; x++) {
            var k = (Math.min(lastY, y) * gw + Math.min(lastX, x)) * 4;
            var Y = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
            ry += Y; ry2 += Y * Y; rr += d[k]; rg += d[k + 1]; rb += d[k + 2];
            if (depthOn) {
              var cxp = (x + 0.5) * m, cyp = (y + 0.5) * m, c = Math.min(1, Math.abs(1 - zfNow / depthAt(cxp, cyp)) / 0.65);
              if (focus) { var dd = Math.hypot(cxp - focus.x, cyp - focus.y), e0 = 0.08 * H, e1 = 0.55 * H, tt = Math.min(1, Math.max(0, (dd - e0) / (e1 - e0))); c = Math.min(1, c + 0.9 * tt * tt * (3 - 2 * tt)); }
              rf += 1 - c;
            }
            var a = (y + 1) * S + x + 1, b = y * S + x + 1;
            satY[a] = satY[b] + ry; satY2[a] = satY2[b] + ry2; satR[a] = satR[b] + rr; satG[a] = satG[b] + rg; satB[a] = satB[b] + rb; satF[a] = satF[b] + rf;
          }
        }
        function box(t, x0, y0, x1, y1) { return t[y1 * S + x1] - t[y0 * S + x1] - t[y1 * S + x0] + t[y0 * S + x0]; }

        // Quadtree: split while brightness std is above the threshold.
        var thr = 4 + 60 * Math.pow(1 - params.detail / 100, 1.6);
        var top = 1;
        while (top * 2 * m <= Math.max(m, params.max * u)) top *= 2;
        var px = mosaic.data, leaves = [];
        function node(x, y, s) {
          var x1 = Math.min(gw, x + s), y1 = Math.min(gh, y + s);
          if (x >= gw || y >= gh) return;
          var nsub = (x1 - x) * (y1 - y), sumY = box(satY, x, y, x1, y1);
          var mean = sumY / nsub, std = Math.sqrt(Math.max(0, box(satY2, x, y, x1, y1) / nsub - mean * mean));
          // The threshold scales with focus: ×0.35 where the square is all in focus, ×2.5 where it is
          // all blurred, so detail splits readily in focus and the bokeh only at strong edges.
          var kf = depthOn ? 2.5 + (0.35 - 2.5) * (box(satF, x, y, x1, y1) / nsub) : 1;
          if (s > 1 && std > thr * kf) {
            var h = s / 2;
            node(x, y, h); node(x + h, y, h); node(x, y + h, h); node(x + h, y + h, h);
            return;
          }
          if (s > 1) leaves.push(x, y, x1 - x, y1 - y);
          var R = 0, G = 0, B = 0, A = 0;
          if (s > 1) { R = box(satR, x, y, x1, y1) / nsub; G = box(satG, x, y, x1, y1) / nsub; B = box(satB, x, y, x1, y1) / nsub; A = 255; }
          for (var yy = y; yy < y1; yy++) for (var xx = x; xx < x1; xx++) {
            var o = (yy * gw + xx) * 4;
            px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = A;
          }
        }
        for (var ty = 0; ty < gh; ty += top) for (var tx = 0; tx < gw; tx += top) node(tx, ty, top);
        mctx.putImageData(mosaic, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(mos, 0, 0, gw * m, gh * m);
        ctx.imageSmoothingEnabled = true;

        // Lines around every square. The smallest cells can number tens of thousands, so their lines
        // come from a repeating one-cell pattern filled over runs of them (one rect per run per row);
        // bigger squares are stroked one by one.
        if (params.lines > 0) {
          var ink = params.color ? Magi.fx.inkColor(params.color) : [1, 1, 1];
          var css = 'rgba(' + ink.map(function (v) { return Math.round(v * 255); }).join(',') + ',' + (params.lines / 100).toFixed(3) + ')';
          var lw = 1, pk = m + ':' + css + ':' + lw;
          if (pk !== patternKey) {
            patternKey = pk;
            var tile = document.createElement('canvas'), tc = tile.getContext('2d');
            tile.width = tile.height = m;
            tc.fillStyle = css;
            tc.fillRect(0, 0, m, lw); tc.fillRect(0, lw, lw, m - lw);
            pattern = ctx.createPattern(tile, 'repeat');
          }
          ctx.fillStyle = pattern;
          ctx.beginPath();
          for (var ry2 = 0; ry2 < gh; ry2++) {
            var run = -1;
            for (var rx = 0; rx <= gw; rx++) {
              var fine = rx < gw && px[(ry2 * gw + rx) * 4 + 3] === 0;
              if (fine && run < 0) run = rx;
              else if (!fine && run >= 0) { ctx.rect(run * m, ry2 * m, (rx - run) * m, m); run = -1; }
            }
          }
          ctx.fill();
          ctx.strokeStyle = css;
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (var j = 0; j < leaves.length; j += 4) ctx.rect(leaves[j] * m + lw / 2, leaves[j + 1] * m + lw / 2, leaves[j + 2] * m, leaves[j + 3] * m);
          ctx.stroke();
        }
      },
      reset: function () { focus = null; zf = 0.35; lastSeg = null; present = 0; gw = gh = 0; smooth = null; cellPrev = null; }
    };
  }

  Magi.renderers.quadtree = createQuadtree;
})();
