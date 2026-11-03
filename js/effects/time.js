// Time effects: Timescan and Slitscan. Both show different parts of the picture at different
// moments, the idea behind slit-scan photography (Douglas Trumbull's stargate in 2001, 1968;
// Golan Levin's catalogue of slit-scan video works, 2005-).
//
// History: the last 60 camera frames, at most 540 px on the long side, kept on the GPU in a
// WebGL2 texture array used as a ring (one layer per frame, the newest at `head`). A fragment
// shader picks, for every pixel, how many frames back to look (its delay d) and blends the two
// nearest frames, so delay changes smoothly. Where d is under a frame the full-resolution live
// picture shows through.
(function () {
  var N = 60, LONG = 540;

  var VERT = '#version 300 es\nin vec2 p; out vec2 uv; void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }';
  // Delay maps, as t in 0…1, then d = t·depth frames:
  //   0 Gradient: t = y (top is now, bottom is depth frames ago)
  //   1 Radial: t = distance from the center ÷ radius (frame heights)
  //   2 Luma: t = 1 − luma of the newest frame (Rec. 709), so dark parts lag and bright parts are live
  //   3 Slits: position across the frame along `dir`, cut into `slits` bands, each band one step older
  var FRAG = [
    '#version 300 es',
    'precision highp float; precision highp sampler2DArray;',
    'uniform sampler2DArray hist; uniform float head, count, depth, aspect, radius, slits, invert; uniform int mode;',
    'uniform vec2 center, dir; in vec2 uv; out vec4 o;',
    'vec4 layer(float a) { return texture(hist, vec3(uv, mod(head - a + 2.0 * float(' + N + '), float(' + N + ')))); }',
    'void main() {',
    '  float t;',
    '  if (mode == 0) t = uv.y;',
    '  else if (mode == 1) t = clamp(length((uv - center) * vec2(aspect, 1.0)) / radius, 0.0, 1.0);',
    '  else if (mode == 2) t = 1.0 - dot(layer(0.0).rgb, vec3(0.2126, 0.7152, 0.0722));',
    '  else {',
    '    float e = 0.5 * (abs(dir.x) * aspect + abs(dir.y));',
    '    float s = clamp((dot((uv - 0.5) * vec2(aspect, 1.0), dir) / e + 1.0) * 0.5, 0.0, 0.9999);',
    '    t = floor(s * slits) / max(1.0, slits - 1.0);',
    '  }',
    '  if (invert > 0.5) t = 1.0 - t;',
    '  float d = clamp(t * depth, 0.0, count - 1.0), a = floor(d);',
    '  vec4 c = mix(layer(a), layer(min(a + 1.0, count - 1.0)), d - a);',
    '  o = vec4(c.rgb, smoothstep(0.0, 1.0, d));',
    '}'
  ].join('\n');

  function createHistory() {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    var small = document.createElement('canvas'), sctx = small.getContext('2d');
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('Magi shader:', gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['hist', 'head', 'count', 'depth', 'aspect', 'radius', 'slits', 'invert', 'mode', 'center', 'dir'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.hist, 0);
    var tex = null, w = 0, h = 0, head = -1, count = 0, lastId = null;

    return {
      // Adds the frame if it's a new camera or video frame.
      push: function (frame) {
        var s = Math.min(1, LONG / Math.max(frame.width, frame.height));
        var tw = Math.max(1, Math.round(frame.width * s)), th = Math.max(1, Math.round(frame.height * s));
        if (tw !== w || th !== h) {
          w = small.width = c.width = tw; h = small.height = c.height = th;
          if (tex) gl.deleteTexture(tex);
          tex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
          gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, N);
          [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (f) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, f, gl.LINEAR); });
          [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (f) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, f, gl.CLAMP_TO_EDGE); });
          head = -1; count = 0; lastId = null;
        }
        var id = Magi.tracking.frameId(frame.source);
        if (id === lastId && count) return false;
        lastId = id;
        frame.draw(sctx, w, h);
        head = (head + 1) % N;
        count = Math.min(N, count + 1);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, head, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, small);
        return true;
      },
      // Draws the time-displaced picture; o: { mode, depth (frames), center, radius, dir, slits, invert }.
      run: function (o) {
        gl.viewport(0, 0, w, h);
        gl.uniform1f(U.head, head); gl.uniform1f(U.count, count);
        gl.uniform1f(U.depth, Math.min(N - 1, o.depth)); gl.uniform1f(U.aspect, w / h);
        gl.uniform1f(U.radius, o.radius || 1); gl.uniform1f(U.slits, o.slits || 1); gl.uniform1f(U.invert, o.invert ? 1 : 0);
        gl.uniform1i(U.mode, o.mode);
        gl.uniform2f(U.center, (o.center || [0.5, 0.5])[0], (o.center || [0.5, 0.5])[1]);
        gl.uniform2f(U.dir, (o.dir || [0, 1])[0], (o.dir || [0, 1])[1]);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return c;
      },
      reset: function () { head = -1; count = 0; lastId = null; }
    };
  }

  function drawLive(frame, out) {
    if (out.width !== frame.width || out.height !== frame.height) { out.width = frame.width; out.height = frame.height; }
    var ctx = out.getContext('2d');
    frame.draw(ctx, frame.width, frame.height);
    return ctx;
  }

  // Pinch and drag up or down: changes a parameter like a grabbed slider (frame.setParam).
  function pinchDrag(state, hd, frame, params, id, perHeight) {
    if (hd && hd.pinched) {
      if (!state.drag) state.drag = { y: hd.center.y, v: params[id] };
      var v = Math.round(Math.max(0, Math.min(100, state.drag.v + (state.drag.y - hd.center.y) / frame.height * perHeight)));
      if (v !== params[id]) frame.setParam(id, v);
    } else state.drag = null;
  }

  // Timescan: every pixel shows the picture from a different moment, by a delay map.
  // Gradient: top is now, the bottom is the past. Radial: around your palm, the farther the older.
  // Luma: dark parts lag behind and bright parts are live.
  // Pinch and drag up or down: more or less time (Depth).
  function createTimescan() {
    var hist = null, tried = false, center = null, state = {};
    return {
      animated: true,
      render: function (frame, out, params) {
        var ctx = drawLive(frame, out);
        if (!tried) { tried = true; hist = createHistory(); }
        if (!hist) { frame.say('Timescan needs WebGL2, which this browser doesn’t offer.'); return; }
        hist.push(frame);
        var ix = Magi.interaction.read(frame), hd = ix.hands[0];
        pinchDrag(state, hd, frame, params, 'depth', 150);
        var target = hd ? [hd.center.x / frame.width, hd.center.y / frame.height] : [0.5, 0.5];
        if (!center) center = target.slice();
        center[0] += (target[0] - center[0]) * 0.3; center[1] += (target[1] - center[1]) * 0.3;
        var mode = { gradient: 0, radial: 1, luma: 2 }[params.mode] || 0;
        var img = hist.run({ mode: mode, depth: params.depth / 100 * (N - 1), center: center, radius: 0.15 + params.radius / 100 * 1.2, invert: params.invert });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, frame.width, frame.height);
        if (mode === 1 && Magi.tracking.hands.status() === 'ready' && !hd) Magi.tracking.hint(ctx, frame, 'Raise a hand to move the center. Pinch and drag up or down for more time.');
      },
      reset: function () { if (hist) hist.reset(); center = null; state = {}; }
    };
  }

  // Slitscan: a slit across the picture decides when each part of it was taken.
  // Sweep: the slit travels across; behind it the picture freezes as it was when the slit passed.
  // Stretch: strip photography (the photo-finish camera): a fixed slit, and what passes through it
  // flows out to one side, so moving things stretch or squeeze by their speed.
  // Delay: the picture is cut into slits, each one step further in the past.
  // Pinch and turn your hand: turns the slit (Angle); letting go starts a new sweep.
  function createSlitscan() {
    var hist = null, tried = false, frozen = document.createElement('canvas'), fctx = frozen.getContext('2d');
    var strips = [document.createElement('canvas'), document.createElement('canvas')], front = 0;
    var sweep = null, lastT = null, grab = null, lastId = null, stripKey = '', wasPinched = false;

    // Half-plane behind the slit (local y < a), as a clip, for slit angle θ (0 = horizontal line moving down).
    function clipBehind(ctx, W, H, th, a, ahead) {
      var D = Math.hypot(W, H);
      ctx.translate(W / 2, H / 2); ctx.rotate(th);
      ctx.beginPath();
      if (ahead) ctx.rect(-D, a, 2 * D, D); else ctx.rect(-D, -D, 2 * D, D + a);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clip();
    }
    function line(ctx, W, H, th, a, u) {
      var D = Math.hypot(W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.rotate(th);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.beginPath(); ctx.moveTo(-D, a); ctx.lineTo(D, a); ctx.stroke();
      ctx.restore();
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT));
        lastT = t;
        var ctx = drawLive(frame, out), mode = params.mode || 'sweep';
        var ix = Magi.interaction.read(frame), hd = ix.hands[0];
        // Pinch and turn: the slit turns with your hand.
        if (hd && hd.pinched) {
          if (!grab) grab = { r: hd.rotation, a: params.angle };
          var ang = Math.round(grab.a + (hd.rotation - grab.r));
          ang = ((ang + 90) % 180 + 180) % 180 - 90;
          if (ang !== params.angle) frame.setParam('angle', ang);
        } else grab = null;
        var released = wasPinched && !(hd && hd.pinched);
        wasPinched = !!(hd && hd.pinched);
        var th = params.angle * Math.PI / 180, nx = -Math.sin(th), ny = Math.cos(th);
        var e = 0.5 * (Math.abs(nx) * W + Math.abs(ny) * H);

        if (mode === 'sweep') {
          // The slit moves from −e to +e across the frame in 1–10 s, then holds 1 s and starts over.
          var dur = 1 + (100 - params.speed) / 100 * 9;
          if (frozen.width !== W || frozen.height !== H) { frozen.width = W; frozen.height = H; sweep = null; }
          if (!sweep || released || (params.loop && sweep.s > 1 + 1 / dur)) sweep = { s: 0 };
          var prev = -e + Math.min(1, sweep.s) * 2 * e;
          sweep.s += dt / dur;
          var now = -e + Math.min(1, sweep.s) * 2 * e, D = Math.hypot(W, H), from = prev <= -e + 1e-6 ? -D : prev - 1;
          // Freeze the band the slit crossed since the last frame (1 px of overlap so no seam opens).
          fctx.save();
          fctx.translate(W / 2, H / 2); fctx.rotate(th);
          fctx.beginPath();
          fctx.rect(-D, from, 2 * D, now - from);
          fctx.setTransform(1, 0, 0, 1, 0, 0);
          fctx.clip();
          frame.draw(fctx, W, H);
          fctx.restore();
          ctx.save();
          clipBehind(ctx, W, H, th, now, false);
          ctx.drawImage(frozen, 0, 0);
          ctx.restore();
          if (params.line && sweep.s < 1) line(ctx, W, H, th, now, u);
        } else if (mode === 'stretch') {
          // Strip photography: each camera frame the history moves `step` px away from the slit and
          // the slit's current pixels are written in at the slit. Kept in the slit's own (rotated)
          // coordinates, on a square that covers the frame at any angle.
          var Dq = Math.ceil(Math.hypot(W, H)), step = Math.max(1, Math.round((0.5 + params.speed / 100 * 7.5) * H / 720));
          var k = Dq + ':' + W + 'x' + H;
          var id = Magi.tracking.frameId(frame.source);
          var src = strips[front], dst = strips[1 - front];
          if (k !== stripKey) {
            stripKey = k;
            strips.forEach(function (c) {
              c.width = c.height = Dq;
              var x = c.getContext('2d');
              x.translate(Dq / 2, Dq / 2); x.rotate(-th); x.translate(-W / 2, -H / 2);
              frame.draw(x, W, H);
              x.setTransform(1, 0, 0, 1, 0, 0);
            });
          }
          if (id !== lastId) {
            lastId = id;
            var dx = dst.getContext('2d');
            dx.clearRect(0, 0, Dq, Dq);
            dx.drawImage(src, 0, step);
            dx.save();
            dx.beginPath(); dx.rect(0, Dq / 2, Dq, step); dx.clip();
            dx.translate(Dq / 2, Dq / 2); dx.rotate(-th); dx.translate(-W / 2, -H / 2);
            frame.draw(dx, W, H);
            dx.restore();
            front = 1 - front;
          }
          ctx.save();
          clipBehind(ctx, W, H, th, 0, true);
          ctx.translate(W / 2, H / 2); ctx.rotate(th);
          ctx.drawImage(strips[front], -Dq / 2, -Dq / 2);
          ctx.restore();
          if (params.line) line(ctx, W, H, th, 0, u);
        } else {
          if (!tried) { tried = true; hist = createHistory(); }
          if (!hist) { frame.say('Delay needs WebGL2, which this browser doesn’t offer.'); return; }
          hist.push(frame);
          var img = hist.run({ mode: 3, depth: (params.slits - 1) * (params.step / 100 * 5), slits: params.slits, dir: [nx, ny] });
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, 0, 0, W, H);
        }
      },
      reset: function () { if (hist) hist.reset(); sweep = null; lastT = null; grab = null; lastId = null; stripKey = ''; }
    };
  }

  Magi.renderers.timescan = createTimescan;
  Magi.renderers.slitscan = createSlitscan;
})();
