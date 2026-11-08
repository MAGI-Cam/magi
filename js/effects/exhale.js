// Exhale: a sphere of particles that breathes with your hands (after a reference of a green ring
// that blooms outward).
//
// Particles sit on a sphere, spread evenly as a Fibonacci sphere (y = 1 − 2(k + ½)/N, φ = k·137.5°),
// turning slowly and drawn in perspective (focal length 3), lit at the rim: bright where the shell is
// seen edge-on, faint where it faces you, so it reads as a ring. Each has its own radius: it follows the
// breath radius B through a spring with its own stiffness (2–6 Hz), so on an exhale the fast ones
// lead and the shell turns rough and bristled, and on an inhale they gather back into a bright
// thin ring. Moving particles leave a streak back along their radial motion, long and bright while
// they rush (Bristles), as in the reference's bursts.
// Breath, B from 0 (in) to 1 (out):
//   two hands — how far apart they are (a sixth to two thirds of the frame width);
//   one hand — open palm exhales (B → 1), a fist inhales (B → 0.1), and the hand's openness sets
//              anything between;
//   no hand — a slow breath on its own, Rate breaths a minute (B = ½ − ½cos 2πft).
// Swipe sideways: a gust that tilts the sphere's turn that way.
(function () {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));

  function createExhale() {
    var P = [], key = '', breath = 0.3, yaw = 0, spinV = 0.25, seen = 0, lastT = null;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var n = Math.round(params.count);
        if (key !== String(n)) {
          key = String(n); P = [];
          for (var k = 0; k < n; k++) {
            var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN;
            P.push({ d: [r * Math.cos(phi), y, r * Math.sin(phi)], r: breath, v: 0, w: 2 * Math.PI * (2 + Math.random() * 4), jit: 0.9 + Math.random() * 0.2 });
          }
        }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;

        // Breath target from the hands.
        var ix = Magi.interaction.read(frame), target;
        ix.events.forEach(function (e) { if (e.n > seen) { seen = e.n; if (e.type === 'swipe' && (e.dir === 'left' || e.dir === 'right')) spinV += e.dir === 'right' ? 1.5 : -1.5; } });
        if (ix.pair) target = Math.max(0.05, Math.min(1, (ix.pair.distance / W - 1 / 6) / (2 / 3 - 1 / 6)));
        else if (ix.hands.length) {
          var hd = ix.hands[0];
          target = hd.fist ? 0.1 : hd.count >= 5 ? 1 : 0.1 + 0.9 * (hd.count / 5);
        } else target = 0.5 - 0.5 * Math.cos(2 * Math.PI * (params.rate / 60) * t);
        breath += (target - breath) * (1 - Math.exp(-dt / 0.35));
        spinV += (0.25 - spinV) * (1 - Math.exp(-dt / 2));
        yaw += spinV * dt;

        // Particles: a damped spring per particle toward the breath radius.
        var sub = 2, h = dt / sub;
        P.forEach(function (q) {
          for (var s = 0; s < sub; s++) {
            var a = -q.w * q.w * (q.r - breath * q.jit) - 2 * 0.35 * q.w * q.v;
            q.v += a * h; q.r += q.v * h;
          }
        });
        var R = Math.min(W, H) * 0.42 * (0.4 + params.size / 100 * 0.9), cx = W / 2, cy = H / 2, F = 3;
        var cs = Math.cos(yaw), sn = Math.sin(yaw), tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
        var ink = params.color ? Magi.fx.inkColor(params.color) : [0.42, 1, 0.45], rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        var dots = [[], [], []], streaks = [[], [], []], bristle = params.bristles / 100;
        P.forEach(function (q) {
          var x = q.d[0] * cs + q.d[2] * sn, z = -q.d[0] * sn + q.d[2] * cs, y = q.d[1] * ct - z * st, zz = q.d[1] * st + z * ct;
          var kp = F / (F + zz), rr = 0.2 + 0.85 * q.r, sx = cx + x * rr * R * kp, sy = cy - y * rr * R * kp;
          // Rim light: the shell is bright where you see it edge-on (|z| small) and faint facing you.
          var az = Math.abs(zz), band = az < 0.35 ? 0 : az < 0.7 ? 1 : 2;
          dots[band].push(sx, sy);
          var speed = Math.abs(q.v);
          if (bristle > 0 && speed > 0.3) {
            var back = Math.min(0.5, speed * 0.12 * bristle) * Math.sign(q.v), r0 = rr - back;
            streaks[band].push(sx, sy, cx + x * r0 * R * kp, cy - y * r0 * R * kp);
          }
        });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var sz = Math.max(1, 1.3 * u), alphaBand = [0.95, 0.4, 0.1];
        for (var b = 2; b >= 0; b--) {
          ctx.strokeStyle = 'rgba(' + rgb + ',' + (alphaBand[b] * 0.8).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.6, 0.9 * u);
          ctx.beginPath();
          var sl = streaks[b];
          for (var j = 0; j < sl.length; j += 4) { ctx.moveTo(sl[j], sl[j + 1]); ctx.lineTo(sl[j + 2], sl[j + 3]); }
          ctx.stroke();
          ctx.fillStyle = 'rgba(' + rgb + ',' + alphaBand[b].toFixed(3) + ')';
          var dl = dots[b];
          for (var j2 = 0; j2 < dl.length; j2 += 2) ctx.fillRect(dl[j2] - sz / 2, dl[j2 + 1] - sz / 2, sz, sz);
        }
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
      },
      reset: function () { key = ''; lastT = null; }
    };
  }

  Magi.renderers.exhale = createExhale;
})();
