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
// It follows your palm (the midpoint of two hands), drifting back to the middle without a hand.
// Pinch to grab it and roll it like a ball under your fingers (a trackball); roll your pinching hand
// to spin it about the view axis; let go and it keeps spinning, slowing down. Swipe to fling it.
(function () {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));

  function createExhale() {
    var P = [], key = '', breath = 0.3, seen = 0, lastT = null;
    // Orientation as a rotation matrix (row-major 3×3), angular velocity ω (rad/s, a 3-vector), the
    // sphere's center on screen, and the pinch that holds it.
    var M = [1, 0, 0, 0, 1, 0, 0, 0, 1], omega = [0, 0.25, 0], center = null, grip = null;
    // Rotation by angle a about unit axis k (Rodrigues), applied on the left: M ← R·M.
    function turn(k, a) {
      var c = Math.cos(a), s1 = Math.sin(a), t1 = 1 - c, x = k[0], y = k[1], z = k[2];
      var R2 = [t1 * x * x + c, t1 * x * y - s1 * z, t1 * x * z + s1 * y, t1 * x * y + s1 * z, t1 * y * y + c, t1 * y * z - s1 * x, t1 * x * z - s1 * y, t1 * y * z + s1 * x, t1 * z * z + c];
      var out = new Array(9);
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) out[i * 3 + j] = R2[i * 3] * M[j] + R2[i * 3 + 1] * M[3 + j] + R2[i * 3 + 2] * M[6 + j];
      M = out;
    }
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
        // A swipe flings it: spin about the axis perpendicular to the swipe.
        ix.events.forEach(function (e) {
          if (e.n <= seen) return; seen = e.n;
          if (e.type === 'swipe') { var d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[e.dir] || [0, 0]; omega[0] += d[1] * 4; omega[1] += d[0] * 4; }
        });
        var R = Math.min(W, H) * 0.42 * (0.4 + params.size / 100 * 0.9), F = 3;
        if (!center) center = { x: W / 2, y: H / 2 };
        var hd = ix.hands[0], grabbing = ix.hands.filter(function (h) { return h.pinched; })[0];
        // Follow: the sphere drifts to your palm (between two hands), or back to the middle.
        var aim = ix.pair ? ix.pair.midpoint : hd ? hd.center : { x: W / 2, y: H / 2 };
        if (!grabbing) { var ef = 1 - Math.exp(-dt / (hd ? 0.12 : 0.8)); center.x += (aim.x - center.x) * ef; center.y += (aim.y - center.y) * ef; }
        // Grab: pinch and move to roll it like a ball under your fingers (a trackball: a drag d turns
        // it by |d|/R about the axis (d_y, d_x, 0) in the screen plane, y down); let go and it keeps
        // the spin, slowing with a 3 s half-life. Roll your pinching hand to spin it about the view axis.
        if (grabbing) {
          var gp = { x: (grabbing.points[4].x + grabbing.points[8].x) / 2, y: (grabbing.points[4].y + grabbing.points[8].y) / 2 };
          if (grip && grip.id === grabbing.id) {
            var dx = gp.x - grip.x, dy = gp.y - grip.y, dl = Math.hypot(dx, dy), dr = (grabbing.rotation - grip.rot) * Math.PI / 180;
            dr -= Math.round(dr / (2 * Math.PI)) * 2 * Math.PI;
            var w0 = [0, 0, 0];
            if (dl > 0.5) { var ang = dl / R; turn([dy / dl, dx / dl, 0], -ang); w0 = [dy / dl * ang / dt, dx / dl * ang / dt, 0]; }
            if (Math.abs(dr) > 0.002) { turn([0, 0, 1], dr); w0[2] = dr / dt; }
            omega = [omega[0] + (w0[0] - omega[0]) * 0.5, omega[1] + (w0[1] - omega[1]) * 0.5, omega[2] + (w0[2] - omega[2]) * 0.5];
          }
          grip = { id: grabbing.id, x: gp.x, y: gp.y, rot: grabbing.rotation };
        } else {
          grip = null;
          var wl = Math.hypot(omega[0], omega[1], omega[2]);
          if (wl > 1e-4) turn([omega[0] / wl, omega[1] / wl, omega[2] / wl], -wl * dt);
          var decay = Math.pow(0.5, dt / 3);
          omega = [omega[0] * decay, 0.25 + (omega[1] - 0.25) * decay, omega[2] * decay];
        }
        // Breath: two hands apart exhale; one open palm exhales, a fist inhales (held while you grab).
        if (ix.pair && !grabbing) target = Math.max(0.05, Math.min(1, (ix.pair.distance / W - 1 / 6) / (2 / 3 - 1 / 6)));
        else if (grabbing) target = breath;
        else if (hd) target = hd.fist ? 0.1 : hd.count >= 5 ? 1 : 0.1 + 0.9 * (hd.count / 5);
        else target = 0.5 - 0.5 * Math.cos(2 * Math.PI * (params.rate / 60) * t);
        breath += (target - breath) * (1 - Math.exp(-dt / 0.35));

        // Particles: a damped spring per particle toward the breath radius.
        var sub = 2, h = dt / sub;
        P.forEach(function (q) {
          for (var s = 0; s < sub; s++) {
            var a = -q.w * q.w * (q.r - breath * q.jit) - 2 * 0.35 * q.w * q.v;
            q.v += a * h; q.r += q.v * h;
          }
        });
        var cx = center.x, cy = center.y;
        var ink = params.color ? Magi.fx.inkColor(params.color) : [0.42, 1, 0.45], rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        var dots = [[], [], []], streaks = [[], [], []], bristle = params.bristles / 100;
        P.forEach(function (q) {
          var x = M[0] * q.d[0] + M[1] * q.d[1] + M[2] * q.d[2], y = -(M[3] * q.d[0] + M[4] * q.d[1] + M[5] * q.d[2]), zz = M[6] * q.d[0] + M[7] * q.d[1] + M[8] * q.d[2];
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
      reset: function () { key = ''; lastT = null; center = null; grip = null; M = [1, 0, 0, 0, 1, 0, 0, 0, 1]; omega = [0, 0.25, 0]; }
    };
  }

  Magi.renderers.exhale = createExhale;
})();
