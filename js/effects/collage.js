// Collage: a source box locks onto a feature of your face; while your hand is up, numbered copies
// of it fill a sphere around your head. Lower the hand and they fly back into the source and vanish.
//
// Face (Face Landmarker): the source box sits on an eye (corners 33/133 or 362/263), the mouth
// (61/291) or the nose (98/327 around the tip, 1), sized from those landmark distances. Eye mode
// copies one eye; Features takes eye, eye, mouth, nose in turn, and the box moves with it.
// Each copy is a still snapshot taken at the moment it spawns (`Rate` per second, up to `Count`).
//
// Sphere: copy k of N sits at the k-th point of a Fibonacci sphere, the even spread of points
// given by y = 1 − 2(k + ½)/N, r = √(1 − y²), φ = k·137.5° (the golden angle). The sphere turns
// about its vertical axis and is drawn in perspective, scale f/(f + z) with f = 3 radii, back to
// front, far copies smaller and dimmer.
// Hand (Interaction Engine): pinch sets the sphere's size (thumb–index distance 0.15 → 0.6×,
// 1.1 palm lengths → 1.7× the head), rolling the hand spins it (1.5 × the roll angle), and finger
// spread sets the spacing (copies shrink from 1× to 0.55× as the fingers spread). A wireframe
// sphere on the palm shows the readings. Everything eases: x += (target − x)·(1 − e^(−7·dt)).
// The camera is turned gray with film grain, like the reference (a WebGL pass; canvas fallback).
(function () {
  var GREEN = 'rgb(80,255,90)';

  var GOLDEN = Math.PI * (3 - Math.sqrt(5)), FOCAL = 3, TILT = 0.28;

  // Point k of an N-point Fibonacci sphere, unit radius.
  function fib(k, n) {
    var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN;
    return [r * Math.cos(phi), y, r * Math.sin(phi)];
  }

  // Gray and grain in one GPU pass: Rec. 709 luma plus ±9% of per-pixel noise that changes every
  // frame, like film grain. (The canvas fallback blends with gray, then overlays a noise tile.)
  var MONO_FRAG = [
    'precision highp float;',
    'uniform sampler2D cam;',
    'uniform float seed;',
    'varying vec2 uv;',
    'float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'void main() {',
    '  float l = dot(texture2D(cam, uv).rgb, vec3(0.2126, 0.7152, 0.0722));',
    '  l += (hash(gl_FragCoord.xy + seed) - 0.5) * 0.18;',
    '  gl_FragColor = vec4(vec3(clamp(l, 0.0, 1.0)), 1.0);',
    '}'
  ].join('\n');

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
    var size = 1, spin = 0, gap = 1; // eased hand readings
    var monoPass;

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

        if (params.mono && monoPass === undefined) monoPass = Magi.fx.shaderPass(MONO_FRAG, ['cam']);
        if (params.mono && monoPass) {
          monoPass.texture('cam', out);
          monoPass.run(W, H, { seed: Math.random() * 1000 });
          ctx.drawImage(monoPass.canvas, 0, 0);
        } else if (params.mono) {
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
        var faces = faceT.detect(frame), ix = Magi.interaction.read(frame);
        var face = faces[0], sig = ix.hands[0], hand = sig && sig.points;
        var fs = Math.max(8, Math.round(8 * u)), pad = Math.max(1, Math.round(1.5 * u));
        ctx.font = fs + 'px ' + Magi.fx.MONO;
        ctx.textBaseline = 'top';

        var src = null, center = null, unitW = 0;
        if (face) {
          var feats = features(face);
          src = feats[params.mode === 'features' ? featureIndex % 4 : 0];
          unitW = feats[0].w;
          center = { x: (feats[0].c.x + feats[1].c.x + feats[2].c.x) / 3, y: (feats[0].c.y + feats[1].c.y + feats[2].c.y) / 3 };
        }

        // Hand readings, eased.
        var ease = 1 - Math.exp(-dt * 7), rotation = 0, palmC = null, palm = 0;
        if (sig) {
          palm = sig.size; palmC = sig.center; rotation = sig.rotation;
          var pd = sig.pinchWith.index.distance;
          size += (0.6 + 1.1 * Math.min(1, Math.max(0, (pd - 0.15) / 0.95)) - size) * ease;
          spin += (rotation * Math.PI / 180 * 1.5 - spin) * ease;
          gap += (1 - 0.45 * sig.spread - gap) * ease;
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
          tiles.push({ img: snap, w: tw, h: th, x: src.c.x, y: src.c.y, s: 0.3, z: 0, alpha: 1, slot: count, n: count });
          count++;
          featureIndex++;
        }

        // Targets on the sphere: turn about the vertical axis by `spin`, tip back by TILT, project.
        var R = unitW * 1.25 * size, cy = Math.cos(spin), sy = Math.sin(spin), ct = Math.cos(TILT), st = Math.sin(TILT);
        tiles = tiles.filter(function (tl) {
          var tx, ty, ts = 1, tz = 0;
          if (collapsing || !center) {
            var home = src ? src.c : { x: tl.x, y: tl.y };
            tx = home.x; ty = home.y; ts = 0.3;
            if (Math.hypot(tx - tl.x, ty - tl.y) < Math.max(4, tl.w * 0.15)) return false;
          } else {
            var q = fib(tl.slot % params.count, params.count);
            var x1 = q[0] * cy + q[2] * sy, z1 = -q[0] * sy + q[2] * cy;
            var y2 = q[1] * ct - z1 * st, z2 = q[1] * st + z1 * ct;
            var k = FOCAL / (FOCAL + z2);
            tx = center.x + x1 * R * k; ty = center.y + y2 * R * k; ts = k * gap; tz = z2;
          }
          tl.x += (tx - tl.x) * ease;
          tl.y += (ty - tl.y) * ease;
          tl.s += (ts - tl.s) * ease;
          tl.z = tz;
          return true;
        });
        if (!tiles.length) count = 0;
        var scale = size;

        ctx.save();
        ctx.lineWidth = Math.max(1, u);
        // Back to front; far copies dimmer.
        tiles.slice().sort(function (a, b) { return b.z - a.z; }).forEach(function (tl) {
          var w = Math.max(2, Math.round(tl.w * tl.s)), h = Math.max(2, Math.round(tl.h * tl.s));
          var x = Math.round(tl.x - w / 2), y = Math.round(tl.y - h / 2);
          ctx.globalAlpha = Math.max(0.35, Math.min(1, 0.7 - tl.z * 0.35));
          ctx.drawImage(tl.img, x, y, w, h);
          ctx.strokeStyle = GREEN;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          if (w > fs * 2.5) {
            ctx.fillStyle = GREEN;
            ctx.textAlign = 'right';
            ctx.fillText(String(tl.n).padStart(2, '0'), x + w - pad * 2, y + pad * 2);
          }
        });
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
        if (src) {
          var bw = src.w, bh = bw * 0.62, bx = src.c.x - bw / 2, by = src.c.y - bh / 2;
          ctx.strokeStyle = GREEN;
          ctx.strokeRect(bx, by, bw, bh);
          label(ctx, 'source:', bx, by - fs - pad * 1.4, fs, pad);
        }
        if (hand) {
          var rot = rotation * Math.PI / 180, PR = palm * 0.75;
          sphere(ctx, palmC, PR, spin + t * 0.3, rot, u);
          // Readouts beside the sphere, on whichever side has room.
          var t1 = 'scale: ' + scale.toFixed(2), t2 = 'rotation: ' + rotation.toFixed(1);
          var lw = ctx.measureText(t2).width + pad * 2, right = palmC.x + PR + 6 * u + lw < W;
          var lx = right ? palmC.x + PR + 6 * u : palmC.x - PR - 6 * u - lw, ly = palmC.y - PR * 0.3;
          label(ctx, t1, lx, ly, fs, pad);
          label(ctx, t2, lx, ly + fs + pad * 4, fs, pad);
        }
        ctx.restore();

        if (faceT.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, faceT, 'face');
        else if (handT.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, handT, 'hand');
        else if (!face) frame.say('Face the camera.');
        else if (!hand) frame.say('Raise a hand to start copying.');
      },
      reset: function () { tiles = []; count = 0; lastSpawn = 0; lastT = null; featureIndex = 0; size = 1; spin = 0; gap = 1; }
    };
  }

  Magi.renderers.collage = createCollage;
})();
