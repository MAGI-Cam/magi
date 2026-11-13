// Word Space: characters strung together with red threads, like Word Box, but free in the room
// instead of held to your body: they drift through the whole picture and through depth.
//
// Flow: each character rides a curl-noise field (after Bridson et al. 2007, "Curl-Noise for
// Procedural Fluid Flow"). A stream function ψ(x, y, t) = sin(k₁x + 0.3t)·cos(k₂y − 0.2t)
// + ½·sin(k₃(x + y) + 0.17t) gives the velocity v = (∂ψ/∂y, −∂ψ/∂x), which has no divergence, so
// the words swirl and eddy without bunching up or thinning out. Depth z drifts on its own slow
// sine. Velocity eases toward the field (0.5 s); Flow sets the speed. Characters leaving one edge
// come back at the opposite one.
// Space: every character has a depth z in ±1 (Depth sets how deep), drawn in perspective about
// the picture's vertical axis, which sways slowly or turns with your hand's roll (Rotation), so
// near characters are bigger and move faster across the picture than far ones.
// Threads: each character is joined to its Links nearest neighbors on screen (a uniform grid of
// cells), a red web drawn twice, wide and faint then fine, like Word Box.
// Characters: Text, any keyboard, split into user-perceived characters (shared with Word Box);
// empty Text uses a set (Set).
// Hands (forces in the picture's plane, falling off linearly to zero at 2.5 palm lengths):
//   Open hand: a magnet, drawing words in from up to 6 palm lengths into a loose shell around it.
//   Fist: breaks everything apart: lets go of any pinched cluster, kicks every word in a random
//     direction, pushes words apart while it is held, and snaps all the threads.
//   Pinch: grabs the words within reach; they follow the pinch, drawn in closer, and keep your
//     hand's velocity when you let go (a throw).
//   Invert: swaps the palms, so an open palm breaks things apart and a fist draws words in.
//   Swipe: changes the set (with no Text).
(function () {
  function createWordSpace() {
    var P = [], chars = [], charKey = '', seen = 0, lastT = null, yaw = 0, grabs = {}, linkK = 1, wasFist = false;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT));
        lastT = t;
        var WS = Magi.wordSets, setIx = Math.max(0, Math.min(WS.SETS.length - 1, Math.round(params.set)));
        var text = (params.text || '').trim(), ck = text + '|' + setIx;
        if (ck !== charKey) { charKey = ck; chars = WS.graphemes(text || WS.SETS[setIx]); if (!chars.length) chars = WS.graphemes(WS.SETS[0]); P.forEach(function (p) { p.c = chars[Math.floor(Math.random() * chars.length)]; }); }
        // Change: each character is swapped at random times, a Poisson process of rate 3·Change/100
        // per second; 0 keeps them.
        var swapP = 1 - Math.exp(-3 * (params.change || 0) / 100 * dt);
        if (swapP > 0) P.forEach(function (p) { if (Math.random() < swapP) p.c = chars[Math.floor(Math.random() * chars.length)]; });

        var n = Math.round(params.points);
        while (P.length < n) P.push({ x: Math.random() * W, y: Math.random() * H, z: Math.random() * 2 - 1, vx: 0, vy: 0, c: chars[Math.floor(Math.random() * chars.length)], ph: Math.random() * 6.28 });
        if (P.length > n) P.length = n;

        var ix = Magi.interaction.read(frame), hands = ix.hands;
        ix.events.forEach(function (e) {
          if (e.n <= seen) return; seen = e.n;
          if (e.type === 'swipe' && !text && (e.dir === 'left' || e.dir === 'right')) frame.setParam('set', (setIx + (e.dir === 'left' ? WS.SETS.length - 1 : 1)) % WS.SETS.length);
        });
        var wantYaw = hands[0] ? hands[0].rotation * Math.PI / 180 * (params.rotation / 100 * 2) : Math.sin(t * 0.2) * 0.35;
        yaw += (wantYaw - yaw) * (1 - Math.exp(-dt / 0.15));

        // A closed fist (either hand) breaks everything apart: no pinch can hold words while it is
        // closed (any held cluster is let go), every word gets a kick in a random direction the
        // moment it closes (0.3–0.8 frame heights a second), and while it stays closed words
        // closer than 8% of the frame height push each other apart, so no clump survives.
        // Invert swaps the two palms: an open palm breaks things apart and a fist draws them in.
        var inv = !!params.invert, breaker = function (h) { return inv ? !h.fist && !h.pinched && h.count >= 4 : h.fist; };
        var fistNow = hands.some(breaker);
        // Pinch grabs: on the pinch, the words within reach are captured with their offsets.
        var live = {};
        hands.forEach(function (h) {
          live[h.id] = true;
          var pm = { x: (h.points[4].x + h.points[8].x) / 2, y: (h.points[4].y + h.points[8].y) / 2 };
          if (fistNow) { delete grabs[h.id]; return; }
          if (h.pinched && !grabs[h.id]) {
            var reach = h.size * 2.5, ids = [];
            P.forEach(function (p, i) { if (Math.hypot(p.sx - pm.x, p.sy - pm.y) < reach) ids.push(i); });
            grabs[h.id] = { ids: ids, pm: pm };
          } else if (!h.pinched && grabs[h.id]) {
            grabs[h.id].ids.forEach(function (i) { if (P[i]) { P[i].vx = h.velocity.x; P[i].vy = h.velocity.y; } });
            delete grabs[h.id];
          }
          if (grabs[h.id]) grabs[h.id].pm = pm;
        });
        Object.keys(grabs).forEach(function (id) { if (!live[id]) delete grabs[id]; });
        if (fistNow) grabs = {};
        var held = {};
        Object.keys(grabs).forEach(function (id) { grabs[id].ids.forEach(function (i) { held[i] = grabs[id].pm; }); });
        if (fistNow && !wasFist) P.forEach(function (p) { var a = Math.random() * Math.PI * 2, v = H * (0.3 + 0.5 * Math.random()); p.vx += Math.cos(a) * v; p.vy += Math.sin(a) * v; p.cut = 1.5; });
        if (fistNow) {
          var Rr = H * 0.08, rg = {};
          P.forEach(function (p, i) { var key = Math.floor(p.x / Rr) + ',' + Math.floor(p.y / Rr); (rg[key] || (rg[key] = [])).push(i); });
          P.forEach(function (p, i) {
            var gx0 = Math.floor(p.x / Rr), gy0 = Math.floor(p.y / Rr);
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) (rg[(gx0 + ox) + ',' + (gy0 + oy)] || []).forEach(function (j) {
              if (j === i) return;
              var dx = p.x - P[j].x, dy = p.y - P[j].y, d = Math.hypot(dx, dy) || 1e-3;
              if (d < Rr) { var f = (Rr - d) / Rr * H * 6 * dt; p.vx += dx / d * f; p.vy += dy / d * f; }
            });
          });
        }
        wasFist = fistNow;

        // Flow, hands and motion.
        var k1 = 2 * Math.PI / (W * 0.7), k2 = 2 * Math.PI / (H * 0.8), k3 = 2 * Math.PI / ((W + H) * 0.45), speed = params.flow / 100 * H * 0.25;
        var ease = 1 - Math.exp(-dt / 0.5), m = H * 0.1;
        P.forEach(function (p, i) {
          if (held[i]) {
            var pm = held[i];
            p.x += (pm.x + (p.x - pm.x) * 0.6 - p.x) * (1 - Math.exp(-dt / 0.12)); p.y += (pm.y + (p.y - pm.y) * 0.6 - p.y) * (1 - Math.exp(-dt / 0.12));
            return;
          }
          var a1 = k1 * p.x + 0.3 * t, b1 = k2 * p.y - 0.2 * t, c1 = k3 * (p.x + p.y) + 0.17 * t;
          var dpsidy = -Math.sin(a1) * Math.sin(b1) * k2 + 0.5 * Math.cos(c1) * k3, dpsidx = Math.cos(a1) * Math.cos(b1) * k1 + 0.5 * Math.cos(c1) * k3;
          var norm = 1 / Math.max(k1, k2), fx = dpsidy * norm * speed, fy = -dpsidx * norm * speed;
          var ax = 0, ay = 0;
          hands.forEach(function (h) {
            if (h.pinched) return;
            if (inv && !h.fist && !breaker(h)) return; // inverted: only a fist pulls
            var dx = p.x - h.center.x, dy = p.y - h.center.y, r = Math.hypot(dx, dy) || 1;
            if (breaker(h)) {
              // Fist: scatters them (a push falling to zero at 2.5 palm lengths) and breaks their
              // threads: a word within reach drops its links and rejoins 1.5 s after it leaves.
              var R1 = h.size * 2.5; if (r > R1) return;
              p.cut = 1.5;
              var f1 = (1 - r / R1) * H * 6; ax += dx / r * f1; ay += dy / r * f1;
            } else {
              // Open hand: a magnet. Words within 6 palm lengths are pulled in with a softened
              // inverse-square force, a = k / (r² + s²), and held off the palm by a stiff spring
              // inside 1.3 palm lengths, so they settle into a loose shell around your hand, with a
              // slight swirl so it stays alive.
              var R2 = h.size * 6; if (r > R2) return;
              var s2 = h.size * 0.8, f2 = H * 4 * h.size * h.size / (r * r + s2 * s2) * (1 - r / R2);
              var shell = h.size * 1.3, push = r < shell ? (shell - r) / shell * H * 10 : 0;
              ax += (-f2 + push) * dx / r - dy / r * f2 * 0.25; ay += (-f2 + push) * dy / r + dx / r * f2 * 0.25;
            }
          });
          p.vx += (fx - p.vx) * ease + ax * dt; p.vy += (fy - p.vy) * ease + ay * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.z = Math.max(-1, Math.min(1, p.z + Math.sin(t * 0.4 + p.ph) * 0.15 * dt));
          if (p.x < -m) p.x += W + 2 * m; else if (p.x > W + m) p.x -= W + 2 * m;
          if (p.y < -m) p.y += H + 2 * m; else if (p.y > H + m) p.y -= H + 2 * m;
        });

        // Perspective about the vertical axis through the middle of the picture.
        var cy = Math.cos(yaw), sy = Math.sin(yaw), D = params.depth / 100 * W * 0.6, Fp = W * 1.6;
        P.forEach(function (p) {
          var dx = p.x - W / 2, z = p.z * D, rx = dx * cy - z * sy, rz = dx * sy + z * cy, kp = Fp / (Fp + rz);
          p.sx = W / 2 + rx * kp; p.sy = H / 2 + (p.y - H / 2) * kp; p.k = kp;
        });

        P.forEach(function (p) { if (p.cut > 0) p.cut -= dt; });
        // A closed fist anywhere breaks the joined threads: the share still held, linkK, falls to 0
        // (time constant 0.15 s) and each thread snaps when linkK drops below its own random
        // threshold, so they break one by one; open the hand and they rejoin over about 1.5 s.
        linkK += ((fistNow ? 0 : 1) - linkK) * (1 - Math.exp(-dt / (fistNow ? 0.15 : 0.5)));
        // Threads to the nearest neighbors on screen (none for a word whose threads a fist broke).
        var kL = Math.round(params.links), cell = H * 0.08, grid = {}, segs = [];
        P.forEach(function (p, i) { var key = Math.floor(p.sx / cell) + ',' + Math.floor(p.sy / cell); (grid[key] || (grid[key] = [])).push(i); });
        P.forEach(function (p, i) {
          var gx = Math.floor(p.sx / cell), gy = Math.floor(p.sy / cell), near = [];
          if (p.cut > 0) return;
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) (grid[(gx + ox) + ',' + (gy + oy)] || []).forEach(function (j) { if (j > i && !(P[j].cut > 0)) { var d = Math.hypot(P[j].sx - p.sx, P[j].sy - p.sy); if (d < cell * 1.5) near.push([d, j]); } });
          near.sort(function (a, b) { return a[0] - b[0]; }).slice(0, kL).forEach(function (nb) { var hk = Math.sin(i * 12.9898 + nb[1] * 78.233) * 43758.5453; if (hk - Math.floor(hk) < linkK) segs.push(i, nb[1]); });
        });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        [[5 * u, 0.06 * params.glow / 100], [Math.max(0.6, 0.8 * u), 0.55]].forEach(function (pass) {
          if (pass[1] <= 0) return;
          ctx.strokeStyle = 'rgba(255,40,20,' + pass[1].toFixed(3) + ')';
          ctx.lineWidth = pass[0];
          ctx.beginPath();
          for (var q = 0; q < segs.length; q += 2) { var a = P[segs[q]], b = P[segs[q + 1]]; ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
          ctx.stroke();
        });
        ctx.restore();
        hud.save();
        hud.fillStyle = 'rgba(255,236,214,0.92)';
        hud.textAlign = 'center'; hud.textBaseline = 'middle';
        var base = (7 + params.size / 100 * 12) * u, lastSize = -1;
        P.slice().sort(function (a, b) { return a.k - b.k; }).forEach(function (p) {
          var sz = Math.max(4, Math.round(base * p.k));
          if (sz !== lastSize) { hud.font = '400 ' + sz + 'px "Noto Sans JP", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif'; lastSize = sz; }
          hud.fillText(p.c, p.sx, p.sy);
        });
        hud.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Words drift through the room. Open your hand to draw them to it like a magnet, make a fist to scatter them, pinch to grab and throw.');
      },
      reset: function () { P = []; lastT = null; grabs = {}; }
    };
  }

  Magi.renderers['word-space'] = createWordSpace;
})();
