// Interaction Engine: turns hand tracking into plain signals that every effect reads the same way.
//
//   MediaPipe (tracking.js) → Magi.interaction.read(frame) → signals → effect parameters
//
// It runs once per camera frame (tracking.js caches detection per frame, and this caches on the
// result), so every effect that asks in the same frame gets the same answer, and motion is
// measured between real camera frames, not screen refreshes.
//
// Per hand (ix.hands[i], in the same order as Magi.tracking.hands.detect):
//   id, side ('left' | 'right', a running vote over MediaPipe's handedness), score, points
//   center     palm centroid (wrist and the four knuckles), frame pixels
//   size       palm length, wrist → middle knuckle, pixels: the hand's apparent size, which grows as
//              it comes closer (MediaPipe's z is relative to the wrist, not distance to the camera)
//   rotation   wrist → middle knuckle from straight up, degrees, clockwise positive
//   fingers    { thumb, index, middle, ring, pinky }: { curl 0…1, extended, tip }
//              curl = total bend along the finger, the sum of the angles between consecutive bones
//              (measured on MediaPipe's metric world points, so it doesn't change with distance),
//              mapped so straight ≈ 0 and fully curled ≈ 1.
//   count      extended fingers, 0–5
//   pinch      0 (open) … 1 (touching): thumb–index distance ÷ palm length, 0.8 → 0, 0.15 → 1
//   pinched    on/off with hysteresis: on below 0.25 palm lengths, off above 0.35
//   pinchWith  { index, middle, ring, pinky }: { amount, on } for the thumb against each finger
//   spread     0…1, mean angle between neighboring fingers (index–middle, middle–ring, ring–pinky),
//              0.45 rad (26°) between each → 1
//   pointing   index extended, middle, ring and pinky not;   fist: all four fingers curled past 0.7
//   (a pinch needs that finger not curled past 0.8, so a fist with the thumb tucked isn't one;
//   spread counts only extended neighbors)
//   velocity   palm center, pixels per second;   speed: its length
// Two hands (ix.pair, or null): distance and angle between palm centers, midpoint, left and right
// hands, and `closer` (the hand whose palm looks at least 20% bigger; it changes back below 10%).
// Motion events (ix.events, each with a unique `n` so an effect acts on it once):
//   swipe  the palm travels a third of the frame height within 0.3 s, mostly along one axis
//   flick  a wrist snap: the index tip moves faster than 8 palm lengths per second relative to
//          the palm
//   shake  four reversals of the palm's horizontal motion within 0.8 s
// Every on/off state must hold for 80 ms before it switches, so a single noisy frame can't
// trigger anything; events have cooldowns (swipe 0.5 s, flick 0.4 s, shake 0.8 s).
(function () {
  var WRIST = 0, MIDDLE_MCP = 9, PALM = [0, 5, 9, 13, 17];
  var FINGERS = {
    thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20]
  };
  var NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  var DEBOUNCE = 0.08, EVENT_N = 0;

  function sub(a, b) { return [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)]; }
  function angle(u, v) {
    var lu = Math.hypot(u[0], u[1], u[2]), lv = Math.hypot(v[0], v[1], v[2]);
    if (!lu || !lv) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv))));
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // An on/off state with hysteresis and debounce: it turns on when `on` has held for DEBOUNCE
  // seconds, off when `off` has.
  function latch(st, key, on, off, t) {
    var s = st[key] || (st[key] = { value: false, since: null });
    var want = s.value ? !off : on;
    if (want === s.value) { s.since = null; return s.value; }
    if (s.since === null) s.since = t;
    if (t - s.since >= DEBOUNCE) { s.value = want; s.since = null; }
    return s.value;
  }

  function createEngine() {
    var lastPoints = null, cache = { hands: [], pair: null, events: [] }, states = {}, closer = null;

    function readHand(p, d, frame, t, dt) {
      var id = d.key || 'hand', st = states[id] || (states[id] = { hist: [], cool: {} });
      st.t = t;
      var size = dist(p[WRIST], p[MIDDLE_MCP]) || 1;
      var center = { x: 0, y: 0 };
      PALM.forEach(function (i) { center.x += p[i].x / 5; center.y += p[i].y / 5; });
      var rotation = Math.atan2(p[MIDDLE_MCP].x - p[WRIST].x, -(p[MIDDLE_MCP].y - p[WRIST].y)) * 180 / Math.PI;

      // Finger curl from bone angles; world points when MediaPipe gives them.
      var q = d.world && d.world.length === 21 ? d.world : p.map(function (r) { return { x: r.x, y: r.y, z: (r.z || 0) * frame.width }; });
      var fingers = {}, count = 0;
      NAMES.forEach(function (name) {
        var f = FINGERS[name], bend = 0;
        var chain = [q[WRIST]].concat(f.map(function (i) { return q[i]; }));
        for (var k = 1; k < chain.length - 1; k++) bend += angle(sub(chain[k], chain[k - 1]), sub(chain[k + 1], chain[k]));
        // The thumb bends less and starts angled away from the wrist line.
        var curl = name === 'thumb' ? clamp01((bend - 0.9) / 1.3) : clamp01((bend - 0.35) / 3.3);
        var extended = latch(st, 'ext' + name, curl < 0.35, curl > 0.5, t);
        if (name === 'thumb') extended = extended && dist(p[4], p[5]) / size > 0.55;
        if (extended) count++;
        fingers[name] = { curl: curl, extended: extended, tip: p[f[3]] };
      });

      var pinchWith = {};
      ['index', 'middle', 'ring', 'pinky'].forEach(function (name) {
        // A curled finger next to a tucked thumb (a fist) is not a pinch.
        var r = dist(p[4], p[FINGERS[name][3]]) / size, live = fingers[name].curl < 0.8;
        pinchWith[name] = { distance: r, amount: live ? clamp01((0.8 - r) / 0.65) : 0, on: latch(st, 'pinch' + name, live && r < 0.25, !live || r > 0.35, t) };
      });

      // Spread: angles between neighboring fingers' knuckle → tip directions, in the image.
      // Only extended neighbors count; curled fingers have no meaningful direction.
      var spread = 0, pairs = 0;
      [['index', 'middle'], ['middle', 'ring'], ['ring', 'pinky']].forEach(function (pr) {
        if (!fingers[pr[0]].extended || !fingers[pr[1]].extended) return;
        var a = FINGERS[pr[0]], b = FINGERS[pr[1]];
        spread += angle(sub(p[a[3]], p[a[0]]), sub(p[b[3]], p[b[0]]));
        pairs++;
      });
      spread = pairs ? clamp01(spread / pairs / 0.45) : 0;

      // Motion: palm velocity between camera frames, lightly eased.
      var v = st.v || { x: 0, y: 0 };
      if (st.center && dt > 0) {
        v = { x: v.x + ((center.x - st.center.x) / dt - v.x) * 0.6, y: v.y + ((center.y - st.center.y) / dt - v.y) * 0.6 };
      }
      var tipRel = { x: 0, y: 0 };
      if (st.tip && st.center && dt > 0) {
        tipRel = { x: (p[8].x - st.tip.x - (center.x - st.center.x)) / dt, y: (p[8].y - st.tip.y - (center.y - st.center.y)) / dt };
      }
      // A jump of a quarter frame in one camera frame is a re-detection, not motion: start over.
      if (st.center && dist(center, st.center) > frame.height / 4) { st.hist = []; v = { x: 0, y: 0 }; tipRel = { x: 0, y: 0 }; }
      st.v = v; st.center = center; st.tip = { x: p[8].x, y: p[8].y };
      st.hist.push({ t: t, x: center.x, y: center.y, vx: v.x });
      while (st.hist.length && t - st.hist[0].t > 0.8) st.hist.shift();

      var hand = {
        id: id, side: d.label === 'Left' ? 'left' : 'right', score: d.score || 0, points: p,
        center: center, size: size, rotation: rotation, fingers: fingers, count: count,
        pinch: pinchWith.index.amount, pinched: pinchWith.index.on, pinchWith: pinchWith, spread: spread,
        pointing: fingers.index.extended && !fingers.middle.extended && !fingers.ring.extended && !fingers.pinky.extended,
        fist: fingers.index.curl > 0.7 && fingers.middle.curl > 0.7 && fingers.ring.curl > 0.7 && fingers.pinky.curl > 0.7,
        velocity: v, speed: Math.hypot(v.x, v.y)
      };
      return { hand: hand, st: st, tipRel: tipRel };
    }

    function emit(events, st, hand, type, extra, t, cooldown) {
      if (st.cool[type] && t - st.cool[type] < cooldown) return;
      st.cool[type] = t;
      var e = { n: ++EVENT_N, type: type, hand: hand.id, side: hand.side, t: t };
      Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      events.push(e);
      st.last = e;
    }

    function dir4(x, y) { return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up'); }

    function motion(events, r, frame, t) {
      var st = r.st, hand = r.hand, H = frame.height, hist = st.hist;
      // Swipe: displacement over the last 0.3 s.
      var first = null;
      for (var i = hist.length - 1; i >= 0; i--) { if (t - hist[i].t <= 0.3) first = hist[i]; else break; }
      if (first) {
        var dx = hand.center.x - first.x, dy = hand.center.y - first.y, along = Math.max(Math.abs(dx), Math.abs(dy));
        if (along > H / 3 && along > 2 * Math.min(Math.abs(dx), Math.abs(dy))) emit(events, st, hand, 'swipe', { dir: dir4(dx, dy) }, t, 0.5);
      }
      // Flick: fingertip snapping relative to the palm.
      var rel = Math.hypot(r.tipRel.x, r.tipRel.y);
      if (rel > 8 * hand.size) emit(events, st, hand, 'flick', { dir: dir4(r.tipRel.x, r.tipRel.y) }, t, 0.4);
      // Shake: reversals of horizontal motion faster than 0.6 frame heights per second.
      var flips = 0, sign = 0;
      hist.forEach(function (h) {
        if (Math.abs(h.vx) < 0.6 * H) return;
        var s = h.vx > 0 ? 1 : -1;
        if (sign && s !== sign) flips++;
        sign = s;
      });
      if (flips >= 4) emit(events, st, hand, 'shake', { flips: flips }, t, 0.8);
    }

    return {
      // Signals for this camera frame: { hands, pair, events }.
      read: function (frame) {
        var tracker = Magi.tracking.hands, points = tracker.detect(frame);
        if (points === lastPoints) return cache;
        lastPoints = points;
        var details = tracker.details(), t = frame.time / 1000, events = [];
        var dt = cache.t ? Math.min(0.2, Math.max(0.001, t - cache.t)) : 0;
        var reads = points.map(function (p, i) { return readHand(p, details[i] || {}, frame, t, dt); });
        reads.forEach(function (r) { motion(events, r, frame, t); });
        var hands = reads.map(function (r) { return r.hand; });
        Object.keys(states).forEach(function (k) { if (t - states[k].t > 1) delete states[k]; });

        var pair = null;
        if (hands.length === 2) {
          var a = hands[0], b = hands[1];
          var byX = a.center.x <= b.center.x ? [a, b] : [b, a];
          var left = a.side !== b.side ? (a.side === 'left' ? a : b) : byX[0], right = left === a ? b : a;
          var big = a.size >= b.size ? a : b, small = big === a ? b : a, ratio = big.size / small.size;
          if (ratio > 1.2) closer = big.id;
          else if (ratio < 1.1 || (closer !== a.id && closer !== b.id)) closer = null;
          pair = {
            left: left, right: right,
            distance: dist(a.center, b.center),
            angle: Math.atan2(right.center.y - left.center.y, right.center.x - left.center.x) * 180 / Math.PI,
            midpoint: { x: (a.center.x + b.center.x) / 2, y: (a.center.y + b.center.y) / 2 },
            closer: closer === a.id ? a : closer === b.id ? b : null
          };
        } else closer = null;

        cache = { hands: hands, pair: pair, events: events, t: t };
        return cache;
      }
    };
  }

  Magi.interaction = createEngine();
})();
