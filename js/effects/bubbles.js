// Bubbles: soap bubbles from your hands. Wave your fingers to stream small ones; pinch thumb and
// index and a bubble grows at your fingertips while you hold, and floats off when you let go.
// Inverse mode: each bubble inverts the video under it instead. Electrokinetic mode: inside each
// bubble the video turns into electrokinetic pixel glazing (dots sized by brightness). Neon mode:
// each bubble's rim is a neon tube in its film's interference color (below, taken where the rim
// meets the eye, cos θ = 0.3, then pushed to full saturation), added like light ('lighter'): a wide
// faint halo, a brighter band and a white-hot core.
// A bubble pops when its life runs out (2–5 s; 4–7 s for one you blew), or, with Pop on, when a
// fingertip touches it after its first 0.4 s.
//
// Motion: each fingertip releases bubbles in proportion to its speed (Amount), launched with 35%
// of the finger's velocity. A bubble is light enough to follow the air: its velocity relaxes toward
// the local air velocity with Stokes drag, dv/dt = (u_air − v)/τ, τ = 0.5 s, plus a slow rise
// (Float). The air is curl noise (the curl of a stream function ψ, so it is divergence-free and
// swirls without sources or sinks, Wind), and moving hands drag the air near them. A bubble
// inflates over its first 0.2 s, lives 2–5 s and pops; with Pop on, a fingertip pops it.
//
// Look: a bubble is a thin soap film, so its color is thin-film interference. Light reflected from
// the film's front and back surfaces differs in phase by δ = 4π·n·d·cos θt / λ (+π for the front
// reflection), so the reflected intensity at wavelength λ is ∝ sin²(2π·n·d·cos θt / λ), here for
// n = 1.33 at 650, 532 and 450 nm (red, green, blue). θt is the angle inside the film:
// sin θt = sin θ / n, and sin θ is the distance from the bubble's center over its radius when seen
// head-on. Films drain, so d is thinner at the top (d0 → 0.55·d0). How much light the film
// reflects at all follows Schlick's Fresnel term, F = F0 + (1 − F0)(1 − cos θ)^5 with
// F0 = 0.02: almost clear in the middle, bright at the rim. A specular highlight sits at the upper
// left and a dimmer reflection of it at the lower right. Each bubble is drawn from a cached sprite
// (12 sizes × 3 film thicknesses), so hundreds stay cheap.
(function () {
  var TIPS = [4, 8, 12, 16, 20], MAX = 600, TAU = 0.5, N_FILM = 1.33, F0 = 0.02;
  var LAMBDA = [650, 532, 450], THICK = [380, 470, 560], SIZES = 12;

  var sprites = {};
  // Sprite for radius bucket `b` and film thickness index `f`, drawn at radius rb pixels; films
  // scaled by `k` (Profile).
  function sprite(b, f, k) {
    k = k || 1;
    var key = b + ':' + f + ':' + k.toFixed(2);
    if (sprites[key]) return sprites[key];
    var rb = Math.round(4 * Math.pow(1.32, b)), size = rb * 2 + 2;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data, cx = size / 2;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = (x + 0.5 - cx) / rb, dy = (y + 0.5 - cx) / rb, rho = Math.sqrt(dx * dx + dy * dy);
        var o = (y * size + x) * 4;
        if (rho > 1) { d[o + 3] = 0; continue; }
        var cosI = Math.sqrt(1 - rho * rho), sinT = rho / N_FILM, cosT = Math.sqrt(1 - sinT * sinT);
        var film = THICK[f] * k * (0.55 + 0.45 * (dy + 1) / 2); // thinner at the top
        var F = F0 + (1 - F0) * Math.pow(1 - cosI, 5);
        var rgb = LAMBDA.map(function (l) { var s = Math.sin(2 * Math.PI * N_FILM * film * cosT / l); return s * s; });
        // Highlight (upper left) and its dim reflection (lower right).
        var h1 = Math.exp(-(Math.pow(dx + 0.38, 2) + Math.pow(dy + 0.42, 2)) / 0.018);
        var h2 = 0.35 * Math.exp(-(Math.pow(dx - 0.45, 2) + Math.pow(dy - 0.4, 2)) / 0.03);
        var edge = Math.max(0, 1 - (1 - rho) * rb / 1.2); // a crisp rim line, ~1 px
        var a = Math.min(1, 0.05 + F * 1.4 + h1 + h2 + edge * 0.35);
        for (var k = 0; k < 3; k++) d[o + k] = Math.min(255, 255 * (0.55 + 0.45 * rgb[k] + h1 + h2) );
        d[o + 3] = Math.min(255, a * 255 * Math.min(1, (1 - rho) * rb + 0.5)); // antialiased edge
      }
    }
    g.putImageData(img, 0, 0);
    return (sprites[key] = { c: c, r: rb });
  }
  function hsvHex(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), r, g, b;
    switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q; }
    return 'rgb(' + Math.round(r * 255) + ',' + Math.round(g * 255) + ',' + Math.round(b * 255) + ')';
  }
  function bucketFor(r) { return Math.max(0, Math.min(SIZES - 1, Math.round(Math.log(Math.max(4, r) / 4) / Math.log(1.32)))); }

  // Electrokinetic glazing, as in the Facade effect: per cell, a dot of the cell's color whose area
  // is proportional to its brightness (radius = cell · √(luma / π) · 1.1), anti-aliased, on black.
  var EK_FRAG = [
    'precision highp float;',
    'uniform sampler2D cam;',
    'uniform vec2 size;',
    'uniform float cell;',
    'varying vec2 uv;',
    'void main() {',
    '  vec2 px = uv * size, c = (floor(px / cell) + 0.5) * cell;',
    '  vec3 col = texture2D(cam, c / size).rgb;',
    '  float l = dot(col, vec3(0.299, 0.587, 0.114));',
    '  float r = cell * sqrt(l / 3.14159) * 1.1;',
    '  float a = clamp(r - length(px - c) + 0.5, 0.0, 1.0);',
    '  vec3 sat = clamp(mix(vec3(l), col, 1.6), 0.0, 1.0);',
    '  gl_FragColor = vec4(sat * a, 1.0);',
    '}'
  ].join('\n');

  function createBubbles() {
    var bubbles = [], pops = [], prev = {}, wands = {}, lastT = null, lastFrame = null, ekPass;

    function air(x, y, t, H, wind) {
      // ψ = sin(kx·x + ωt)·cos(ky·y − ω′t); u = (∂ψ/∂y, −∂ψ/∂x).
      var k1 = 5.1 / H, k2 = 2.3 / H, a = wind * H * 0.35;
      var s1 = Math.sin(k1 * x + t * 0.7), c1 = Math.cos(k1 * x + t * 0.7), s2 = Math.sin(k1 * y - t * 0.5), c2 = Math.cos(k1 * y - t * 0.5);
      var s3 = Math.sin(k2 * x - t * 0.3), c3 = Math.cos(k2 * x - t * 0.3), s4 = Math.sin(k2 * y + t * 0.4), c4 = Math.cos(k2 * y + t * 0.4);
      return [a * (-s1 * s2 - 0.8 * s3 * s4), -a * (c1 * c2 + 0.8 * c3 * c4)];
    }

    function newBubble(x, y, vx, vy, r) {
      return { x: x, y: y, vx: vx, vy: vy, r: r, age: 0, life: 2 + Math.random() * 3, phase: Math.random() * 6.28, film: Math.floor(Math.random() * 3), spin: Math.random() * 6.28 };
    }

    // A film's neon color: its thin-film reflectance near the rim (cos θ = 0.3, sin θt = sin θ / n),
    // stretched so the strongest channel is 255 and the weakest 0 (full saturation).
    var neonCache = {};
    function neonColor(f, k) {
      var nk = f + ':' + k.toFixed(2);
      if (neonCache[nk]) return neonCache[nk];
      var sinT = Math.sqrt(1 - 0.09) / N_FILM, cosT = Math.sqrt(1 - sinT * sinT);
      var rgb = LAMBDA.map(function (l) { var s = Math.sin(2 * Math.PI * N_FILM * THICK[f] * k * 0.8 * cosT / l); return s * s; });
      var lo = Math.min.apply(null, rgb), hi = Math.max.apply(null, rgb);
      return (neonCache[nk] = rgb.map(function (v) { return Math.round((v - lo) / Math.max(1e-3, hi - lo) * 255); }));
    }
    var filmK = 1;
    function drawBubble(ctx, x, y, r, film, spin, wob) {
      if (r < 1.5) return;
      var sp = sprite(bucketFor(r), film, filmK), k = r / sp.r;
      ctx.setTransform(k * (1 + wob), 0, 0, k * (1 - wob), x, y);
      ctx.rotate(spin * 0.15);
      ctx.drawImage(sp.c, -sp.c.width / 2, -sp.c.height / 2);
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
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), hands = ix.hands;
        var newFrame = ix !== lastFrame; // fingertip speeds only change with a new camera frame
        lastFrame = ix;
        var amount = params.amount / 100, size = (0.4 + params.size / 100 * 1.6) * H / 90;
        var wind = params.wind / 100, rise = params.float / 100 * H * 0.12;

        // Fingertips stream bubbles; moving hands drag the air near each tip.
        var movers = [], seen = {};
        hands.forEach(function (hd) {
          // Fingertip velocities are measured between camera frames and reused on screen
          // refreshes in between; bubbles are released once per camera frame.
          var p = hd.points, last = prev[hd.id], ft = last ? Math.min(0.1, ix.t - last.t) : 0;
          seen[hd.id] = true;
          var vel = newFrame || !last ? TIPS.map(function (i) {
            if (!last || ft <= 0) return [0, 0];
            var vx = (p[i].x - last.p[i].x) / ft, vy = (p[i].y - last.p[i].y) / ft, cap = H * 4, sp = Math.hypot(vx, vy);
            return sp > cap ? [vx * cap / sp, vy * cap / sp] : [vx, vy];
          }) : last.v;
          TIPS.forEach(function (i, ti) {
            var q = p[i], vx = vel[ti][0], vy = vel[ti][1], sp = Math.hypot(vx, vy);
            movers.push({ x: q.x, y: q.y, vx: vx, vy: vy, r: hd.size * 0.6 });
            if (!newFrame || (hd.pinched && (i === 4 || i === 8))) return; // the wand fingers don't stream
            var n = amount * 14 * (sp / H) * ft * 4, k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
            for (var j = 0; j < k && bubbles.length < MAX; j++) {
              bubbles.push(newBubble(q.x + (Math.random() - 0.5) * hd.size * 0.2, q.y + (Math.random() - 0.5) * hd.size * 0.2,
                vx * 0.35 + (Math.random() - 0.5) * H * 0.1, vy * 0.35 + (Math.random() - 0.5) * H * 0.1,
                size * (0.35 + Math.pow(Math.random(), 2) * 1.3)));
            }
          });
          if (newFrame || !last) prev[hd.id] = { t: ix.t, v: vel, p: p.map(function (q) { return { x: q.x, y: q.y }; }) };

          // Wand: the loop of thumb and index (points 2–8) holds a film that grows while pinched,
          // faster as the hand moves (blowing through it), up to 3.5× the loop's size.
          if (params.wand) {
            var w = wands[hd.id];
            if (hd.pinched) {
              // The bubble sits on the pinched fingertips, just beyond them, away from the palm.
              var tx = (p[4].x + p[8].x) / 2, ty = (p[4].y + p[8].y) / 2;
              var ox = tx - hd.center.x, oy = ty - hd.center.y, ol = Math.hypot(ox, oy) || 1;
              var ring = hd.size * 0.35;
              if (!w) w = wands[hd.id] = { r: ring * 0.4, film: Math.floor(Math.random() * 3), phase: Math.random() * 6 };
              w.r = Math.min(ring * 3.5, w.r + dt * ring * (0.5 + 2.5 * Math.min(1, hd.speed / H)));
              w.x = tx + ox / ol * w.r; w.y = ty + oy / ol * w.r; w.ring = ring;
              w.vx = hd.velocity.x; w.vy = hd.velocity.y;
            } else if (w) {
              // Released: it floats off with half the hand's velocity.
              if (bubbles.length < MAX && w.r > w.ring * 0.7) {
                var b = newBubble(w.x, w.y - w.r * 0.3, w.vx * 0.5, w.vy * 0.5 - H * 0.05, w.r);
                b.film = w.film; b.life = 4 + Math.random() * 3; b.age = 0.2;
                bubbles.push(b);
              }
              delete wands[hd.id];
            }
          }
        });
        Object.keys(prev).forEach(function (k) { if (!seen[k]) delete prev[k]; });
        Object.keys(wands).forEach(function (k) { if (!seen[k]) delete wands[k]; });

        var drag = 1 - Math.exp(-dt / TAU), keep = [];
        bubbles.forEach(function (b) {
          b.age += dt;
          var a = air(b.x, b.y, t, H, wind), ax = a[0], ay = a[1] - rise;
          for (var m = 0; m < movers.length; m++) {
            var mv = movers[m], dx = b.x - mv.x, dy = b.y - mv.y, d2 = dx * dx + dy * dy, R2 = mv.r * mv.r;
            if (d2 < R2) {
              var f = 1 - d2 / R2;
              ax += (mv.vx - ax) * f * 0.6; ay += (mv.vy - ay) * f * 0.6;
              if (params.pop && b.age > 0.4 && d2 < b.r * b.r) b.age = b.life; // a fingertip touches it
            }
          }
          b.vx += (ax - b.vx) * drag;
          b.vy += (ay - b.vy) * drag;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          var off = b.x < -b.r * 3 || b.x > W + b.r * 3 || b.y < -b.r * 3 || b.y > H + b.r * 3;
          if (b.age >= b.life) pops.push({ x: b.x, y: b.y, r: b.r, age: 0 });
          else if (!off) keep.push(b);
        });
        bubbles = keep;

        // Profile: Soap and Neon scale every film's thickness (×1 to ×2.6 in 20 steps): thicker films
        // reach higher interference orders, so the colors change the way real bubbles' do as they
        // vary, pastel pinks and greens rather than a tint. Inverse and Electrokinetic take a hue.
        var prof = (params.profile || 0) / 100;
        filmK = 1 + Math.round(prof * 20) / 20 * 1.6;
        var tint = prof > 0 ? hsvHex(prof, 0.65, 1) : '#fff';
        ctx.save();
        var all = bubbles.map(function (b) { return { x: b.x, y: b.y, r: b.r * Math.min(1, b.age / 0.2) * (1 + 0.03 * Math.sin(t * 5 + b.phase)), film: b.film, spin: b.spin + t * 0.5, wob: 0.03 * Math.sin(t * 5 + b.phase) }; });
        Object.keys(wands).forEach(function (k) { var w = wands[k]; all.push({ x: w.x, y: w.y, r: w.r, film: w.film, spin: w.phase + t, wob: 0.06 * Math.sin(t * 7 + w.phase) }); });
        if (params.mode === 'electro') {
          // Electrokinetic: inside each bubble the video becomes pixel glazing, a grid of colored
          // dots whose area follows the brightness behind them.
          if (ekPass === undefined) ekPass = Magi.fx.shaderPass(EK_FRAG, ['cam']);
          if (ekPass) {
            ekPass.texture('cam', out);
            ekPass.run(W, H, { size: [W, H], cell: Math.max(4, Math.round(7 * u)) });
            ctx.beginPath();
            all.forEach(function (b) { if (b.r >= 1) { ctx.moveTo(b.x + b.r, b.y); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); } });
            ctx.save();
            ctx.clip();
            ctx.drawImage(ekPass.canvas, 0, 0);
            if (prof > 0) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
            ctx.restore();
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = Math.max(1, u);
          ctx.beginPath();
          all.forEach(function (b) { if (b.r >= 2) { ctx.moveTo(b.x + b.r, b.y); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); } });
          ctx.stroke();
        } else if (params.mode === 'neon') {
          // Neon: one path per film thickness, stroked three times, added like light.
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          [0, 1, 2].forEach(function (f) {
            var c = neonColor(f, filmK), list = all.filter(function (b) { return b.film === f && b.r >= 2; });
            if (!list.length) return;
            ctx.beginPath();
            list.forEach(function (b) { var rr = b.r * (1 + b.wob); ctx.moveTo(b.x + rr, b.y); ctx.arc(b.x, b.y, rr, 0, Math.PI * 2); });
            [[7 * u, 0.1, 0], [2.6 * u, 0.4, 0], [Math.max(1, 0.9 * u), 0.95, 0.65]].forEach(function (ps) {
              var cc = c.map(function (v) { return Math.round(v + (255 - v) * ps[2]); });
              ctx.strokeStyle = 'rgba(' + cc.join(',') + ',' + ps[1] + ')';
              ctx.lineWidth = ps[0];
              ctx.stroke();
            });
          });
          ctx.globalCompositeOperation = 'source-over';
        } else if (params.mode === 'inverse') {
          // Inverse: each bubble inverts the video beneath it (difference with white: c → 1 − c),
          // edged with a crisp 1 px rim.
          ctx.globalCompositeOperation = 'difference';
          ctx.fillStyle = tint;
          ctx.beginPath();
          all.forEach(function (b) { if (b.r >= 1) { ctx.moveTo(b.x + b.r, b.y); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); } });
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = Math.max(1, u);
          ctx.beginPath();
          all.forEach(function (b) { if (b.r >= 2) { ctx.moveTo(b.x + b.r, b.y); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); } });
          ctx.stroke();
        } else {
          all.forEach(function (b) { drawBubble(ctx, b.x, b.y, b.r, b.film, b.spin, b.wob); });
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        // Pops: a ring of short dashes flying out for 0.15 s.
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(1, 1.2 * u);
        ctx.beginPath();
        pops = pops.filter(function (p) {
          p.age += dt;
          if (p.age > 0.15) return false;
          var k = p.age / 0.15, r0 = p.r * (1 + k * 0.6), r1 = r0 + p.r * 0.35 * (1 - k);
          for (var i = 0; i < 7; i++) {
            var a = i / 7 * Math.PI * 2;
            ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
            ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
          }
          return true;
        });
        ctx.stroke();

        var C = Magi.tracking.connections;
        if (params.skeleton && C) {
          hands.forEach(function (hd) {
            var p = hd.points;
            ctx.strokeStyle = 'rgb(80,230,90)';
            ctx.lineWidth = Math.max(1, 2 * u);
            ctx.beginPath();
            C.hand.forEach(function (c) { ctx.moveTo(p[c.start].x, p[c.start].y); ctx.lineTo(p[c.end].x, p[c.end].y); });
            ctx.stroke();
            ctx.fillStyle = 'rgb(240,60,40)';
            p.forEach(function (q) { ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, 3 * u), 0, Math.PI * 2); ctx.fill(); });
          });
        }
        ctx.restore();

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Wave your fingers, or pinch thumb and index to blow one.');
      },
      reset: function () { bubbles = []; pops = []; prev = {}; wands = {}; lastT = null; lastFrame = null; }
    };
  }

  Magi.renderers.bubbles = createBubbles;
})();
