// DNA: a double helix stretched between your hands, spelling your text in base pairs.
//
// Geometry is B-DNA, the form DNA takes in cells (Watson & Crick 1953; Arnott & Hukins 1972):
// 10.5 base pairs per turn, so each pair turns 360°/10.5 = 34.3° about the axis; each pair rises
// 3.4 Å along the axis on a backbone radius of about 10 Å, so rise = 0.34·R. The two backbones
// are not opposite each other: seen along the axis they sit about 140° apart, which leaves the
// narrow minor groove on one side and the wide major groove on the other.
// Strand points: P(i) = A + â·(i·rise) + R·(n̂·cos θᵢ + depth·sin θᵢ), θᵢ = θ₀ + i·34.3°;
// strand 2 uses θᵢ + 140°. Depth (sin θ) sets width and brightness, drawn back to front.
// Sequence: your Text as UTF-8 bytes, two bits per base (00 A, 01 C, 10 G, 11 T, as in DNA data
// storage: Church, Gao & Kosuri 2012), so each character is four bases; the second strand is the
// Watson–Crick complement (A–T, G–C).
// Two hands: the helix runs from palm to palm; turning a hand twists that end (the difference
// between the hands winds the helix tighter or looser). One hand: it runs from your palm out
// past your index finger.
// Pinch and hold: the helix unzips from that end, like helicase opening it, and zips back when
// you let go.
(function () {
  var TURN = 2 * Math.PI / 10.5, GROOVE = 140 * Math.PI / 180, SUB = 4;
  var BASE = { A: [0.3, 1, 0.5], T: [1, 0.35, 0.45], G: [1, 0.85, 0.3], C: [0.35, 0.65, 1] };
  var PAIR = { A: 'T', T: 'A', G: 'C', C: 'G' }, CODE = 'ACGT';

  function encode(text) {
    var bytes = new TextEncoder().encode(text || 'MAGI'), s = '';
    for (var i = 0; i < bytes.length; i++) for (var b = 6; b >= 0; b -= 2) s += CODE[(bytes[i] >> b) & 3];
    return s || 'ACGT';
  }

  function rgba(c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a.toFixed(3) + ')'; }

  function createDNA() {
    var seqText = null, seq = '', ends = {}, zip = { a: 0, b: 0 }, lastT = null, spin = 0, axis = null;

    // A hand's rotation, unwrapped so turning past ±180° keeps winding instead of jumping back.
    function roll(key, deg) {
      var e = ends[key], r = deg * Math.PI / 180;
      if (!e) return (ends[key] = { raw: r, value: r }).value;
      var d = r - e.raw;
      d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      e.raw = r; e.value += d;
      return e.value;
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 120, Math.min(1 / 15, t - lastT));
        lastT = t;
        if (params.text !== seqText) { seqText = params.text; seq = encode(seqText); }
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame);

        // Axis ends A → B, the phase at each end, and which end is being pinched.
        var A, B, phA = 0, phB = 0, pinA = false, pinB = false, live = {};
        if (ix.pair) {
          var L = ix.pair.left, Rh = ix.pair.right;
          A = L.center; B = Rh.center;
          phA = roll('a', L.rotation); phB = roll('b', Rh.rotation);
          pinA = L.pinched; pinB = Rh.pinched;
          live.a = live.b = true;
        } else if (ix.hands.length) {
          var hd = ix.hands[0], p = hd.points, dx = p[8].x - hd.center.x, dy = p[8].y - hd.center.y, l = Math.hypot(dx, dy) || 1;
          var reach = Math.max(H * 0.45, l * 2.2);
          A = hd.center; B = { x: A.x + dx / l * reach, y: A.y + dy / l * reach };
          phA = phB = roll('a', hd.rotation);
          pinB = hd.pinched;
          live.a = true;
        }
        Object.keys(ends).forEach(function (k) { if (!live[k]) delete ends[k]; });
        // Ease the axis so a lost frame doesn't snap the helix; keep the last one briefly.
        if (A) {
          var k = 1 - Math.exp(-dt / 0.04);
          if (!axis) axis = { ax: A.x, ay: A.y, bx: B.x, by: B.y, fade: 1 };
          axis.ax += (A.x - axis.ax) * k; axis.ay += (A.y - axis.ay) * k;
          axis.bx += (B.x - axis.bx) * k; axis.by += (B.y - axis.by) * k;
          axis.fade = Math.min(1, axis.fade + dt * 4);
        } else if (axis) {
          axis.fade -= dt * 2.5;
          if (axis.fade <= 0) axis = null;
        }
        // Unzipping: eased toward fully open (0.65 of the length) in about 0.6 s, closing in 0.4 s.
        zip.a += ((pinA ? 1 : 0) - zip.a) * (1 - Math.exp(-dt / (pinA ? 0.25 : 0.15)));
        zip.b += ((pinB ? 1 : 0) - zip.b) * (1 - Math.exp(-dt / (pinB ? 0.25 : 0.15)));
        spin += (params.spin / 100) * Math.PI * dt;

        if (axis) {
          var R = H * (0.025 + params.size / 100 * 0.075), rise = 0.34 * R;
          var ex = axis.bx - axis.ax, ey = axis.by - axis.ay, len = Math.hypot(ex, ey);
          var n = Math.max(2, Math.floor(len / rise)), ux = ex / (len || 1), uy = ey / (len || 1), nx = -uy, ny = ux;
          var glow = params.glow / 100, mono = params.color ? Magi.fx.inkColor(params.color) : null, fade = axis.fade;
          var BINS = 6, segs = [], rungs = [], dots = [], letters = [];
          for (var bn = 0; bn < BINS; bn++) { segs.push([]); rungs.push({ A: [], T: [], G: [], C: [] }); dots.push([]); }
          var bin = function (s) { return Math.max(0, Math.min(BINS - 1, Math.floor((s + 1) / 2 * BINS))); };
          // Opening near an end: 1 where it's unzipped, easing to 0 over a few pairs.
          var open = function (i) {
            var fa = zip.a * 0.65 * n - i, fb = zip.b * 0.65 * n - (n - i), o = 0;
            if (zip.a > 0.01) o = Math.max(o, Math.min(1, fa / 3 + 0.5));
            if (zip.b > 0.01) o = Math.max(o, Math.min(1, fb / 3 + 0.5));
            return Math.max(0, o);
          };
          var point = function (i, strand) {
            var f = i / n, th = phA + (phB - phA) * f + i * TURN + spin + (strand ? GROOVE : 0);
            // Unzipped strands splay apart and flatten (single strands no longer wind round each other).
            var o = open(i), r = R * (1 - o * 0.55), push = (strand ? 1 : -1) * o * R * 1.9;
            var c = Math.cos(th), s = Math.sin(th), along = i * len / n;
            return { x: axis.ax + ux * along + nx * (r * c + push), y: axis.ay + uy * along + ny * (r * c + push), s: s, o: o };
          };
          var prev = [null, null];
          for (var j = 0; j <= n * SUB; j++) {
            var i = j / SUB;
            for (var st = 0; st < 2; st++) {
              var q = point(i, st);
              if (prev[st]) segs[bin((q.s + prev[st].s) / 2)].push([prev[st], q]);
              prev[st] = q;
            }
            if (j % SUB) continue;
            // A base pair: each half colored by its base, meeting in the middle unless unzipped.
            var b1 = seq[i % seq.length], b2 = PAIR[b1], p1 = point(i, 0), p2 = point(i, 1), o = p1.o;
            var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, reachT = 1 - o * 0.55;
            var m1 = { x: p1.x + (mx - p1.x) * reachT, y: p1.y + (my - p1.y) * reachT };
            var m2 = { x: p2.x + (mx - p2.x) * reachT, y: p2.y + (my - p2.y) * reachT };
            var rs = (p1.s + p2.s) / 2;
            rungs[bin(rs)][b1].push([p1, m1]);
            rungs[bin(rs)][b2].push([p2, m2]);
            dots[bin(p1.s)].push(p1); dots[bin(p2.s)].push(p2);
            if (params.letters && p1.s > 0.2) letters.push([p1, b1]);
            if (params.letters && p2.s > 0.2) letters.push([p2, b2]);
          }

          ctx.save();
          ctx.lineCap = 'round';
          // Glow is added like light; the strands themselves are painted, so they keep their color on bright backgrounds.
          var stroke = function (list, color, a, w, add) {
            if (!list.length) return;
            ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
            ctx.strokeStyle = rgba(color, a * fade);
            ctx.lineWidth = w;
            ctx.beginPath();
            list.forEach(function (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); });
            ctx.stroke();
          };
          var backbone = mono || [0.85, 0.95, 1];
          for (var b = 0; b < BINS; b++) {
            var d = (b + 0.5) / BINS, a = 0.25 + 0.75 * d, w = (0.8 + 1.6 * d) * u;
            Object.keys(BASE).forEach(function (key) {
              var col = mono ? mono.map(function (v) { return v * (key === 'A' || key === 'T' ? 1 : 0.7); }) : BASE[key];
              if (glow > 0) stroke(rungs[b][key], col, 0.22 * glow * a, w * 4, true);
              stroke(rungs[b][key], col, 0.95 * a, w * 1.6);
            });
            if (glow > 0) stroke(segs[b], backbone, 0.18 * glow * a, w * 4.5, true);
            stroke(segs[b], backbone, 0.95 * a, w * 1.5);
            if (dots[b].length) {
              ctx.globalCompositeOperation = 'source-over';
              ctx.fillStyle = rgba([1, 1, 1], 0.9 * a * fade);
              ctx.beginPath();
              dots[b].forEach(function (pt) { ctx.moveTo(pt.x + w * 1.4, pt.y); ctx.arc(pt.x, pt.y, w * 1.4, 0, Math.PI * 2); });
              ctx.fill();
            }
          }
          ctx.restore();

          // Base letters, sharp on the HUD, beside the pairs facing you.
          if (letters.length) {
            var hud = frame.hud, fs = Math.max(8, 9 * u);
            hud.save();
            hud.font = '600 ' + fs + 'px ' + Magi.fx.MONO;
            hud.textAlign = 'center';
            hud.textBaseline = 'middle';
            letters.forEach(function (lt) {
              var c = mono || BASE[lt[1]];
              hud.fillStyle = rgba(c, fade * Math.min(1, (lt[0].s - 0.2) * 3));
              hud.fillText(lt[1], lt[0].x, lt[0].y - fs * 0.9);
            });
            hud.restore();
          }
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!ix.hands.length && !axis) Magi.tracking.hint(ctx, frame, 'Raise both hands to stretch a double helix between them.');
      },
      reset: function () { ends = {}; zip = { a: 0, b: 0 }; lastT = null; spin = 0; axis = null; }
    };
  }

  Magi.renderers.dna = createDNA;
})();
