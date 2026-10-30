// Magi camera interface: input (camera or upload), effect selection, capture, review and save.
// Effects plug in through Magi.effectConfig and Magi.renderers; nothing here is effect-specific.
(function () {
  'use strict';

  // Long edge of the processed frame. Keeps pixel counts consistent across sources.
  var WORK_EDGE = 1280;

  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), stage = $('stage'), view = $('view'), reviewVideo = $('review-video');
  var notice = $('notice'), noticeText = $('notice-text'), noticeActions = $('notice-actions');
  var shutter = $('shutter'), saveBtn = $('save'), timer = $('timer');
  var caret = $('caret'), tray = $('tray'), tiles = $('tiles'), controls = $('controls');
  var uploadBtn = $('upload'), cameraBtn = $('camera'), fileInput = $('file');
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mode-option]'));
  var ctx = view.getContext('2d');

  var camera = document.createElement('video');
  camera.muted = true;
  camera.playsInline = true;
  camera.setAttribute('playsinline', '');

  var state = {
    input: 'camera',   // 'camera' | 'upload'
    mode: 'photo',     // 'photo' | 'video'
    phase: 'live',     // 'live' | 'recording' | 'review'
    effectId: 'bitmap',
    trayOpen: false,
    params: {}
  };
  Magi.effectConfig.forEach(function (fx) { state.params[fx.id] = Magi.defaultsFor(fx); });

  var stream = null;        // camera MediaStream
  var upload = null;        // { kind: 'image' | 'video', el, url }
  var recorder = null;
  var result = null;        // Promise<{ blob, ext }> for the captured photo or video
  var renderers = {};
  var dirty = true;         // a still image only re-renders when something changed
  var recordStart = 0, timerId = 0;
  var preferShare = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  /* ---------- Sources ---------- */

  function currentSource() {
    if (state.input === 'camera') {
      if (!stream || camera.readyState < 2) return null;
      return { el: camera, w: camera.videoWidth, h: camera.videoHeight, moving: true, mirror: true };
    }
    if (!upload) return null;
    if (upload.kind === 'image') {
      return { el: upload.el, w: upload.el.naturalWidth, h: upload.el.naturalHeight, moving: false, mirror: false };
    }
    if (upload.el.readyState < 2) return null;
    return { el: upload.el, w: upload.el.videoWidth, h: upload.el.videoHeight, moving: true, mirror: false };
  }

  function startCamera() {
    stopUpload();
    state.input = 'camera';
    syncSourceButtons();
    resetRenderers();
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showNotice('unsupported');
      return;
    }
    showNotice('asking');
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    }).then(function (s) {
      if (state.input !== 'camera') { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      camera.srcObject = s;
      return camera.play().then(function () { hideNotice(); dirty = true; });
    }).catch(function (err) {
      if (state.input !== 'camera') return;
      stopCamera();
      var blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      showNotice(blocked ? 'denied' : 'unavailable');
    });
  }

  function stopCamera() {
    if (!stream) return;
    stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    camera.srcObject = null;
  }

  function openFile(file) {
    var url = URL.createObjectURL(file);
    var isVideo = /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
    var el;

    function ready() {
      stopUpload();
      stopCamera();
      upload = { kind: isVideo ? 'video' : 'image', el: el, url: url };
      state.input = 'upload';
      hideNotice();
      resetRenderers();
      syncSourceButtons();
    }
    function fail() {
      URL.revokeObjectURL(url);
      showNotice('badfile');
    }

    if (isVideo) {
      el = document.createElement('video');
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.onloadeddata = function () { el.onloadeddata = null; ready(); };
      el.onerror = fail;
      el.src = url;
      el.play().catch(function () {});
    } else {
      el = new Image();
      el.onload = ready;
      el.onerror = fail;
      el.src = url;
    }
  }

  function stopUpload() {
    if (!upload) return;
    if (upload.kind === 'video') upload.el.pause();
    URL.revokeObjectURL(upload.url);
    upload = null;
  }

  function syncSourceButtons() {
    uploadBtn.hidden = state.input !== 'camera';
    cameraBtn.hidden = state.input === 'camera';
  }

  /* ---------- Rendering ---------- */

  function activeRenderer() {
    var id = state.effectId;
    if (!id || !Magi.renderers[id]) return null;
    if (!renderers[id]) renderers[id] = Magi.renderers[id]();
    return renderers[id];
  }

  function resetRenderers() {
    Object.keys(renderers).forEach(function (id) { renderers[id].reset(); });
    dirty = true;
  }

  var shownW = 0, shownH = 0;

  function tick() {
    requestAnimationFrame(tick);
    if (state.phase === 'review') return;
    var src = currentSource();
    if (!src || !src.w || !src.h) return;
    if (!src.moving && !dirty) return;
    dirty = false;

    var k = WORK_EDGE / Math.max(src.w, src.h);
    var w = Math.round(src.w * k), h = Math.round(src.h * k);
    var frame = {
      width: w,
      height: h,
      moving: src.moving,
      draw: function (c, dw, dh) {
        c.save();
        if (src.mirror) { c.translate(dw, 0); c.scale(-1, 1); }
        c.drawImage(src.el, 0, 0, dw, dh);
        c.restore();
      }
    };

    var renderer = activeRenderer();
    if (renderer) {
      renderer.render(frame, view, state.params[state.effectId]);
    } else {
      if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
      frame.draw(ctx, w, h);
    }

    if (view.width !== shownW || view.height !== shownH) {
      shownW = view.width;
      shownH = view.height;
      fitView();
    }
  }

  // Contain the canvas in the stage without distortion.
  function fitView() {
    if (!view.width || !view.height) return;
    var r = stage.getBoundingClientRect();
    var s = Math.min(r.width / view.width, r.height / view.height);
    view.style.width = Math.floor(view.width * s) + 'px';
    view.style.height = Math.floor(view.height * s) + 'px';
  }

  /* ---------- Notices ---------- */

  var NOTICES = {
    asking: {
      text: 'Allow camera access to see the live preview.',
      actions: ['upload']
    },
    denied: {
      text: 'Camera access is blocked. Allow it in your browser’s site settings, then try again, or upload a photo or video instead.',
      actions: ['retry', 'upload']
    },
    unavailable: {
      text: 'No camera could be started. Check that one is connected and not in use by another app.',
      actions: ['retry', 'upload']
    },
    unsupported: {
      text: 'This browser can’t open the camera on this page. Open Magi over https or localhost, or upload a photo or video.',
      actions: ['upload']
    },
    badfile: {
      text: 'That file couldn’t be opened. Try a JPEG, PNG, WebP, MP4, MOV or WebM file.',
      actions: ['upload', 'retry']
    }
  };

  var ACTIONS = {
    retry: { label: 'Try camera again', run: function () { stopCamera(); startCamera(); } },
    upload: { label: 'Upload photo or video', run: function () { fileInput.click(); } }
  };

  function showNotice(key) {
    var n = NOTICES[key];
    noticeText.textContent = n.text;
    noticeActions.textContent = '';
    n.actions.forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'text-btn' + (i === 0 ? ' primary' : '');
      b.textContent = ACTIONS[a].label;
      b.addEventListener('click', ACTIONS[a].run);
      noticeActions.appendChild(b);
    });
    notice.hidden = false;
    view.hidden = true;
  }

  function hideNotice() {
    notice.hidden = true;
    view.hidden = false;
    fitView();
  }

  /* ---------- Effects tray ---------- */

  function setTray(open) {
    state.trayOpen = open;
    tray.dataset.open = String(open);
    caret.setAttribute('aria-expanded', String(open));
    caret.setAttribute('aria-label', open ? 'Hide effects' : 'Show effects');
  }

  function buildTiles() {
    Magi.effectConfig.forEach(function (fx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile';
      b.textContent = fx.name;
      b.dataset.effect = fx.id;
      b.setAttribute('role', 'radio');
      if (!fx.ready) {
        b.disabled = true;
        b.title = 'Coming later';
      }
      b.addEventListener('click', function () {
        selectEffect(state.effectId === fx.id ? null : fx.id);
      });
      tiles.appendChild(b);
    });
  }

  function currentEffect() {
    for (var i = 0; i < Magi.effectConfig.length; i++) {
      if (Magi.effectConfig[i].id === state.effectId) return Magi.effectConfig[i];
    }
    return null;
  }

  function selectEffect(id) {
    state.effectId = id;
    resetRenderers();
    Array.prototype.forEach.call(tiles.children, function (t) {
      t.setAttribute('aria-checked', String(t.dataset.effect === id));
    });
    buildControls();
  }

  function setFill(input) {
    var pct = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--fill', pct + '%');
  }

  function buildControls() {
    controls.textContent = '';
    var fx = currentEffect();
    if (!fx || !fx.params.length) { controls.hidden = true; return; }
    controls.hidden = false;

    var head = document.createElement('div');
    head.className = 'controls-head';
    head.innerHTML = '<span></span><button class="icon-btn" type="button" aria-label="Reset to defaults">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12a6.5 6.5 0 1 0 2-4.7"/><path d="M5 4v4h4"/></svg></button>';
    head.firstChild.textContent = fx.name;
    head.lastChild.addEventListener('click', function () {
      state.params[fx.id] = Magi.defaultsFor(fx);
      resetRenderers();
      buildControls();
    });
    controls.appendChild(head);

    fx.params.forEach(function (p) {
      var id = 'param-' + fx.id + '-' + p.id;
      var wrap = document.createElement('div');
      wrap.className = 'control';
      wrap.innerHTML = '<div class="control-row"><label class="control-label"></label><output></output></div>' +
        '<input type="range">';
      var label = wrap.querySelector('label'), out = wrap.querySelector('output'), input = wrap.querySelector('input');
      label.textContent = p.label;
      label.htmlFor = id;
      out.htmlFor = id;
      input.id = id;
      input.min = p.min;
      input.max = p.max;
      input.step = p.step;
      input.value = state.params[fx.id][p.id];
      out.textContent = input.value;
      setFill(input);
      input.addEventListener('input', function () {
        state.params[fx.id][p.id] = Number(input.value);
        out.textContent = input.value;
        setFill(input);
        dirty = true;
      });
      controls.appendChild(wrap);
    });
  }

  /* ---------- Capture, review and save ---------- */

  function setMode(mode) {
    if (state.phase !== 'live') return;
    state.mode = mode;
    app.dataset.mode = mode;
    modeButtons.forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.modeOption === mode));
    });
    updateShutterLabel();
  }

  function setPhase(phase) {
    state.phase = phase;
    app.dataset.phase = phase;
    if (phase !== 'live') setTray(false);
    saveBtn.hidden = phase !== 'review';
    updateShutterLabel();
  }

  function updateShutterLabel() {
    var label = state.phase === 'review' ? 'Retake'
      : state.phase === 'recording' ? 'Stop recording'
      : state.mode === 'photo' ? 'Take photo' : 'Start recording';
    shutter.setAttribute('aria-label', label);
  }

  function capturePhoto() {
    setPhase('review');
    result = new Promise(function (resolve) {
      view.toBlob(function (blob) { resolve({ blob: blob, ext: 'png' }); }, 'image/png');
    });
  }

  function videoType() {
    var types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  var canRecord = !!(window.MediaRecorder && view.captureStream);

  function startRecording() {
    var out = view.captureStream(30);
    var type = videoType();
    try {
      recorder = new MediaRecorder(out, type ? { mimeType: type, videoBitsPerSecond: 8000000 } : undefined);
    } catch (e) {
      recorder = new MediaRecorder(out);
    }
    var chunks = [];
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      out.getTracks().forEach(function (t) { t.stop(); });
      var mime = recorder.mimeType || type || 'video/webm';
      var blob = new Blob(chunks, { type: mime.split(';')[0] });
      result = Promise.resolve({ blob: blob, ext: /mp4/.test(mime) ? 'mp4' : 'webm' });
      reviewVideo.src = URL.createObjectURL(blob);
      reviewVideo.hidden = false;
      reviewVideo.play().catch(function () {});
      setPhase('review');
    };
    recorder.start(250);
    setPhase('recording');
    startTimer();
  }

  function stopRecording() {
    stopTimer();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  function startTimer() {
    recordStart = Date.now();
    timer.textContent = '00:00';
    timer.hidden = false;
    timerId = setInterval(function () {
      var s = Math.floor((Date.now() - recordStart) / 1000);
      timer.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    }, 250);
  }

  function stopTimer() {
    clearInterval(timerId);
    timer.hidden = true;
  }

  function retake() {
    if (reviewVideo.src) {
      reviewVideo.pause();
      URL.revokeObjectURL(reviewVideo.src);
      reviewVideo.removeAttribute('src');
      reviewVideo.load();
    }
    reviewVideo.hidden = true;
    result = null;
    resetRenderers();
    setPhase('live');
  }

  function save() {
    if (!result) return;
    saveBtn.classList.remove('is-saving');
    void saveBtn.offsetWidth; // restart the animation on repeated saves
    saveBtn.classList.add('is-saving');

    result.then(function (r) {
      var name = 'magi-' + stamp() + '.' + r.ext;
      // On phones the share sheet is the route to the camera roll; elsewhere, download.
      if (preferShare && navigator.canShare && window.File) {
        var file = new File([r.blob], name, { type: r.blob.type });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(function () {});
          return;
        }
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(r.blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  /* ---------- Wiring ---------- */

  shutter.addEventListener('click', function () {
    if (state.phase === 'review') return retake();
    if (state.phase === 'recording') return stopRecording();
    if (!currentSource() || notice.hidden === false) return;
    if (state.mode === 'photo') capturePhoto();
    else startRecording();
  });

  modeButtons.forEach(function (b) {
    if (b.dataset.modeOption === 'video' && !canRecord) {
      b.disabled = true;
      b.title = 'Video recording isn’t supported in this browser';
    }
    b.addEventListener('click', function () { setMode(b.dataset.modeOption); });
  });

  saveBtn.addEventListener('click', save);
  saveBtn.addEventListener('animationend', function (e) {
    if (e.animationName === 'save-drop') saveBtn.classList.remove('is-saving');
  });

  caret.addEventListener('click', function () { setTray(!state.trayOpen); });
  stage.addEventListener('click', function (e) {
    if (state.trayOpen && !notice.contains(e.target)) setTray(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.trayOpen) { setTray(false); caret.focus(); }
  });

  uploadBtn.addEventListener('click', function () { fileInput.click(); });
  cameraBtn.addEventListener('click', startCamera);
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) openFile(file);
  });

  window.addEventListener('resize', fitView);
  if (window.ResizeObserver) new ResizeObserver(fitView).observe(stage);

  buildTiles();
  selectEffect('bitmap');
  setMode('photo');
  setPhase('live');
  startCamera();
  requestAnimationFrame(tick);
})();
