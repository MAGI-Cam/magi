// Hand, face and body tracking for effects, using Google's MediaPipe Tasks: Hand Landmarker (21
// points per hand, handedness), Face Landmarker (478 points, 52 blendshape scores, head pose) and
// Image Segmenter (a person mask).
// These are the same models TouchDesigner's MediaPipe plugin runs. Nothing loads until an effect
// first asks, so effects that don't track cost nothing.
//
// Landmarks come back in frame pixels, mirrored to match the preview, and smoothed with the
// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cutoff rises with
// speed, so points hold still when you do and still follow fast moves without lag.
(function () {
  var VERSION = '0.10.14';
  var BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VERSION;
  var MODELS = {
    hands: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    body: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'
  };
  // One Euro settings, in frame pixels: steady at rest (1.5 Hz cutoff), opening up by
  // 0.02 Hz per pixel/second of speed.
  var MIN_CUTOFF = 1.5, BETA = 0.02, D_CUTOFF = 1;

  Magi.tracking = { connections: null };

  var vision = null;
  function loadVision() {
    if (!vision) {
      vision = import(BASE + '/vision_bundle.mjs').then(function (m) {
        // Connection lists for drawing, straight from MediaPipe.
        Magi.tracking.connections = {
          hand: m.HandLandmarker.HAND_CONNECTIONS,
          tesselation: m.FaceLandmarker.FACE_LANDMARKS_TESSELATION,
          faceOval: m.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
          lips: m.FaceLandmarker.FACE_LANDMARKS_LIPS,
          leftEye: m.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
          rightEye: m.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
          leftEyebrow: m.FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
          rightEyebrow: m.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
          leftIris: m.FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
          rightIris: m.FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS
        };
        return m.FilesetResolver.forVisionTasks(BASE + '/wasm').then(function (files) {
          return { m: m, files: files };
        });
      });
    }
    return vision;
  }

  function lowpass(dt, cutoff) {
    var tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  // One Euro filter for one coordinate.
  function OneEuro() { this.x = null; this.dx = 0; }
  OneEuro.prototype.filter = function (x, dt) {
    if (this.x === null) { this.x = x; return x; }
    var dx = (x - this.x) / dt;
    this.dx += lowpass(dt, D_CUTOFF) * (dx - this.dx);
    var cutoff = MIN_CUTOFF + BETA * Math.abs(this.dx);
    this.x += lowpass(dt, cutoff) * (x - this.x);
    return this.x;
  };

  function createTracker(kind) {
    var status = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
    var task = null, lastTs = 0, last = [], details = [], filters = {};

    function create(v, delegate) {
      var options = {
        baseOptions: { modelAssetPath: MODELS[kind], delegate: delegate },
        runningMode: 'VIDEO'
      };
      if (kind === 'hands') {
        options.numHands = 2;
        options.minHandDetectionConfidence = 0.6;
        options.minTrackingConfidence = 0.6;
        return v.m.HandLandmarker.createFromOptions(v.files, options);
      }
      options.numFaces = 1;
      options.outputFaceBlendshapes = true;
      options.outputFacialTransformationMatrixes = true;
      return v.m.FaceLandmarker.createFromOptions(v.files, options);
    }

    function load() {
      status = 'loading';
      loadVision().then(function (v) {
        // The GPU is much faster; some devices refuse it, so fall back to the CPU.
        return create(v, 'GPU').catch(function () { return create(v, 'CPU'); });
      }).then(function (t) {
        task = t;
        status = 'ready';
      }).catch(function (err) {
        console.warn('Magi: ' + kind + ' tracking could not load', err);
        status = 'failed';
      });
    }

    // Smooths one set of points. `key` keeps each hand's filters with that hand.
    function smooth(key, points, dt, frame) {
      var f = filters[key];
      if (!f || f.length !== points.length) {
        f = filters[key] = points.map(function () { return [new OneEuro(), new OneEuro()]; });
      }
      return points.map(function (p, i) {
        var x = (frame.mirror ? 1 - p.x : p.x) * frame.width, y = p.y * frame.height;
        return { x: f[i][0].filter(x, dt), y: f[i][1].filter(y, dt), z: p.z };
      });
    }

    return {
      status: function () { return status; },
      // Returns an array (one entry per hand or face) of landmark arrays: { x, y, z } in frame
      // pixels. Returns the last result while loading or if a frame can't be read.
      detect: function (frame) {
        if (status === 'idle') load();
        if (!task) return last;
        var ts = Math.max(frame.time, lastTs + 1); // timestamps must strictly increase
        var dt = Math.min(0.1, Math.max(0.001, (ts - lastTs) / 1000));
        lastTs = ts;
        var res;
        try {
          res = task.detectForVideo(frame.source, ts);
        } catch (e) {
          return last;
        }
        var seen = {};
        if (kind === 'hands') {
          var hands = res.landmarks || [], labels = res.handedness || res.handednesses || [];
          details = hands.map(function (points, i) {
            var c = (labels[i] && labels[i][0]) || { categoryName: 'Hand', score: 0 };
            // MediaPipe labels hands as if the image were mirrored; MAGI feeds it the raw camera
            // image, so the labels come back swapped.
            var label = c.categoryName === 'Left' ? 'Right' : c.categoryName === 'Right' ? 'Left' : c.categoryName;
            var key = seen[label] ? label + i : label;
            seen[key] = true;
            return { label: label, score: c.score, key: key };
          });
          last = hands.map(function (points, i) { return smooth(details[i].key, points, dt, frame); });
        } else {
          var faces = res.faceLandmarks || [];
          last = faces.map(function (points, i) { seen['face' + i] = true; return smooth('face' + i, points, dt, frame); });
          details = faces.map(function (points, i) {
            var shapes = res.faceBlendshapes && res.faceBlendshapes[i] ? res.faceBlendshapes[i].categories : [];
            var matrix = res.facialTransformationMatrixes && res.facialTransformationMatrixes[i];
            return { blendshapes: shapes, matrix: matrix ? matrix.data : null };
          });
        }
        Object.keys(filters).forEach(function (k) { if (!seen[k]) delete filters[k]; });
        return last;
      },
      // Extra results for the latest detection, parallel to detect()'s array:
      // hands: { label: 'Left' | 'Right', score }; face: { blendshapes: [{ categoryName, score }],
      // matrix: 4×4 column-major head transform }.
      details: function () { return details; }
    };
  }

  // Body: MediaPipe Image Segmenter with the selfie segmenter model, a per-pixel probability that
  // the pixel belongs to a person. It runs on a copy of the frame at most 256 px across (the model's
  // own input is 256×256), drawn mirrored like the preview, so the mask lines up with the frame.
  // Masks are eased over time (x ← x + 0.6·(new − x)) so the outline doesn't flicker.
  function createSegmenter() {
    var status = 'idle', task = null, lastTs = 0;
    var small = document.createElement('canvas'), sctx = small.getContext('2d');
    var result = null;

    function load() {
      status = 'loading';
      loadVision().then(function (v) {
        function create(delegate) {
          return v.m.ImageSegmenter.createFromOptions(v.files, {
            baseOptions: { modelAssetPath: MODELS.body, delegate: delegate },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false
          });
        }
        return create('GPU').catch(function () { return create('CPU'); });
      }).then(function (t) {
        task = t;
        status = 'ready';
      }).catch(function (err) {
        console.warn('Magi: body tracking could not load', err);
        status = 'failed';
      });
    }

    return {
      status: function () { return status; },
      // Returns { mask: Float32Array (0…1, row by row), width, height }, or null before the
      // first result. The mask covers the whole frame at reduced size.
      detect: function (frame) {
        if (status === 'idle') load();
        if (!task) return result;
        var s = Math.min(1, 256 / Math.max(frame.width, frame.height));
        var w = Math.max(1, Math.round(frame.width * s)), h = Math.max(1, Math.round(frame.height * s));
        if (small.width !== w || small.height !== h) { small.width = w; small.height = h; result = null; }
        frame.draw(sctx, w, h);
        var ts = Math.max(frame.time, lastTs + 1);
        lastTs = ts;
        try {
          task.segmentForVideo(small, ts, function (res) {
            var masks = res.confidenceMasks || [];
            if (!masks.length) return;
            // The person is the last category (the only one for this model).
            var m = masks[masks.length - 1].getAsFloat32Array();
            if (!result || result.mask.length !== m.length) { result = { mask: new Float32Array(m), width: w, height: h }; return; }
            var r = result.mask;
            for (var i = 0; i < m.length; i++) r[i] += (m[i] - r[i]) * 0.6;
          });
        } catch (e) {
          return result;
        }
        return result;
      }
    };
  }

  Magi.tracking.hands = createTracker('hands');
  Magi.tracking.face = createTracker('face');
  Magi.tracking.body = createSegmenter();

  // A quiet status line while a tracker loads or after it fails, so the effect never looks broken
  // without saying why. Shown as text over the preview through frame.say.
  Magi.tracking.drawStatus = function (ctx, frame, tracker, what) {
    var s = tracker.status();
    if (s === 'loading' || s === 'idle') frame.say('Loading ' + what + ' tracking…');
    else if (s === 'failed') frame.say(what.charAt(0).toUpperCase() + what.slice(1) + ' tracking couldn’t load. Check your connection.');
  };

  // A one-line instruction when tracking is ready but nobody is in view.
  Magi.tracking.hint = function (ctx, frame, text) {
    frame.say(text);
  };
})();
