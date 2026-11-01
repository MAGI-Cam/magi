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
    var renderer = activeRenderer();
    // Still images only re-render on change, unless the effect animates on its own.
    if (!src.moving && !dirty && !(renderer && renderer.animated)) return;
    dirty = false;

    var k = WORK_EDGE / Math.max(src.w, src.h);
    var w = Math.round(src.w * k), h = Math.round(src.h * k);
    var r = stageSize();
    var frame = {
      width: w,
      height: h,
      moving: src.moving,
      // Canvas pixels per screen (CSS) pixel once the frame is fitted to the stage. Effects
      // that should look the same size on any screen, like characters, multiply by this.
      pxPerCss: r.width && r.height ? 1 / Math.min(r.width / w, r.height / h) : 1,
      // For effects that track hands or faces: the raw element, whether the preview is
      // mirrored, and a clock in milliseconds.
      source: src.el,
      mirror: src.mirror,
      time: performance.now(),
      draw: function (c, dw, dh) {
        c.save();
        if (src.mirror) { c.translate(dw, 0); c.scale(-1, 1); }
        c.drawImage(src.el, 0, 0, dw, dh);
        c.restore();
      }
    };

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

  var stageRect = null;
  function stageSize() {
    return stageRect || (stageRect = stage.getBoundingClientRect());
  }

  // Contain the canvas in the stage without distortion.
  function fitView() {
    stageRect = null;
    dirty = true;
    if (!view.width || !view.height) return;
    var r = stageSize();
    var s = Math.min(r.width / view.width, r.height / view.height);
    view.style.width = Math.floor(view.width * s) + 'px';
    view.style.height = Math.floor(view.height * s) + 'px';
    // Nearest-pixel scaling keeps pixels square when enlarging, but when shrinking it drops whole
    // rows and columns (thin strokes vanish), so shrink smoothly instead.
    view.classList.toggle('is-reduced', s * (window.devicePixelRatio || 1) < 1);
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
    // Always open at the top level, so every parent tile is visible; the active effect's parent
    // is outlined and names it, and its controls stay below.
    if (open) showLevel(null);
  }

  function groupById(id) {
    for (var i = 0; i < Magi.effectGroups.length; i++) {
      if (Magi.effectGroups[i].id === id) return Magi.effectGroups[i];
    }
    return null;
  }

  // True when the effect sits in the group, directly or inside one of its subgroups.
  function inGroup(fx, groupId) {
    var g = fx && fx.group ? groupById(fx.group) : null;
    while (g) {
      if (g.id === groupId) return true;
      g = g.parent ? groupById(g.parent) : null;
    }
    return false;
  }

  // The tray shows one level at a time: the top (Normal and the parent tiles) or one group's
  // effects and subgroups, with a back row. `level` is the group id, or null for the top.
  var level = null;

  function showLevel(groupId) {
    level = groupId;
    tiles.textContent = '';
    var group = groupById(groupId);
    if (group) {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'tray-back';
      var parent = groupById(group.parent);
      back.innerHTML = '<span aria-hidden="true">‹</span><span class="tray-path"></span>';
      back.lastChild.textContent = (parent ? parent.name + ' / ' : '') + group.name;
      back.setAttribute('aria-label', 'Back to ' + (parent ? parent.name : 'all effects'));
      back.addEventListener('click', function () {
        showLevel(group.parent || null);
        tiles.querySelector('button').focus();
      });
      tiles.appendChild(back);
    }
    Magi.effectConfig.forEach(function (fx) { if ((fx.group || null) === groupId) addTile(fx); });
    Magi.effectGroups.forEach(function (g) { if ((g.parent || null) === groupId) addGroupTile(g); });
    syncTiles();
  }

  function addGroupTile(group) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile tile-parent';
    b.dataset.group = group.id;
    b.innerHTML = '<span></span><span class="tile-mode"></span>';
    b.firstChild.textContent = group.name;
    b.addEventListener('click', function () {
      showLevel(group.id);
      tiles.querySelector('.tile').focus();
    });
    tiles.appendChild(b);
  }

  function addTile(fx) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.dataset.effect = fx.id;
    b.setAttribute('role', 'radio');
    var name = document.createElement('span');
    name.textContent = fx.name;
    b.appendChild(name);
    if (fx.modes) {
      var mode = document.createElement('span');
      mode.className = 'tile-mode';
      b.appendChild(mode);
    }
    if (!fx.ready) {
      b.disabled = true;
      b.title = 'Coming later';
    }
    // Tapping the active tile steps through its modes, if it has any.
    b.addEventListener('click', function () {
      if (state.effectId !== fx.id) selectEffect(fx.id);
      else if (fx.modes) nextMode(fx);
    });
    tiles.appendChild(b);
  }

  function modeOf(fx) {
    var id = state.params[fx.id].mode;
    for (var i = 0; i < fx.modes.length; i++) if (fx.modes[i].id === id) return i;
    return 0;
  }

  function nextMode(fx) {
    state.params[fx.id].mode = fx.modes[(modeOf(fx) + 1) % fx.modes.length].id;
    resetRenderers();
    syncTiles();
  }

  // Marks the active effect, shows each effect's current mode, and on parent tiles names the
  // active effect inside them.
  function syncTiles() {
    var active = currentEffect();
    Array.prototype.forEach.call(tiles.querySelectorAll('.tile'), function (tile) {
      if (tile.dataset.group) {
        var holds = inGroup(active, tile.dataset.group);
        tile.classList.toggle('is-current', holds);
        tile.querySelector('.tile-mode').textContent = holds ? active.name : '';
        return;
      }
      var fx = effectById(tile.dataset.effect);
      tile.setAttribute('aria-checked', String(fx === active));
      if (!fx.modes) return;
      var mode = fx.modes[modeOf(fx)];
      tile.querySelector('.tile-mode').textContent = mode.name;
      tile.setAttribute('aria-label', fx.name + ', ' + mode.name + ' mode');
      tile.title = fx === active ? 'Tap to change mode' : '';
    });
  }

  function effectById(id) {
    for (var i = 0; i < Magi.effectConfig.length; i++) {
      if (Magi.effectConfig[i].id === id) return Magi.effectConfig[i];
    }
    return null;
  }

  function currentEffect() {
    return effectById(state.effectId);
  }

  function selectEffect(id) {
    state.effectId = id;
    resetRenderers();
    syncTiles();
    buildControls();
  }

  // Shows a slider's value: a number, or for the color slider a swatch of the chosen ink.
  function showValue(p, input, out) {
    if (p.track !== 'hue') {
      out.textContent = input.value;
      return;
    }
    var rgb = Magi.fx.inkColor(Number(input.value));
    out.style.setProperty('--swatch', 'rgb(' + rgb.map(function (c) { return Math.round(c * 255); }).join(',') + ')');
    var text = Number(input.value) === 0 ? 'White' : 'Hue ' + Math.round((input.value - 1) / 99 * 360) + '°';
    input.setAttribute('aria-valuetext', text);
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
      var mode = state.params[fx.id].mode;
      state.params[fx.id] = Magi.defaultsFor(fx);
      if (mode) state.params[fx.id].mode = mode; // reset adjusts sliders, not the chosen mode
      resetRenderers();
      buildControls();
    });
    controls.appendChild(head);

    fx.params.forEach(function (p) {
      if (p.type === 'toggle') return controls.appendChild(toggleControl(fx, p));
      if (p.type === 'text') return controls.appendChild(textControl(fx, p));
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
      if (p.track === 'hue') {
        input.classList.add('is-hue');
        out.classList.add('swatch');
      }
      showValue(p, input, out);
      setFill(input);
      input.addEventListener('input', function () {
        state.params[fx.id][p.id] = Number(input.value);
        showValue(p, input, out);
        setFill(input);
        dirty = true;
      });
      controls.appendChild(wrap);
    });
  }

  // On/off switch. The label says what "on" does; the switch shows the state.
  function toggleControl(fx, p) {
    var wrap = document.createElement('div');
    wrap.className = 'control control-row';
    wrap.innerHTML = '<span class="control-label"></span><button class="switch" type="button" role="switch"></button>';
    var label = wrap.firstChild, sw = wrap.lastChild;
    label.id = 'param-' + fx.id + '-' + p.id + '-label';
    label.textContent = p.label;
    sw.id = 'param-' + fx.id + '-' + p.id;
    sw.setAttribute('aria-labelledby', label.id);
    if (p.hint) sw.title = p.hint;
    function show() { sw.setAttribute('aria-checked', String(!!state.params[fx.id][p.id])); }
    show();
    sw.addEventListener('click', function () {
      state.params[fx.id][p.id] = !state.params[fx.id][p.id];
      show();
      dirty = true;
    });
    return wrap;
  }

  // Free text. A plain input, so every keyboard, language and emoji works as the device provides.
  function textControl(fx, p) {
    var id = 'param-' + fx.id + '-' + p.id;
    var wrap = document.createElement('div');
    wrap.className = 'control';
    wrap.innerHTML = '<label class="control-label"></label><input class="control-text" type="text">';
    var label = wrap.firstChild, input = wrap.lastChild;
    label.textContent = p.label;
    label.htmlFor = id;
    input.id = id;
    input.maxLength = p.maxLength || 280;
    input.placeholder = p.placeholder || '';
    input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'done');
    input.value = state.params[fx.id][p.id];
    input.addEventListener('input', function () {
      state.params[fx.id][p.id] = input.value;
      dirty = true;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') input.blur();
    });
    return wrap;
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
      // PNG keeps halftone edges exact; plain photos save as JPEG (see config photoType).
      var fx = currentEffect();
      var type = (fx && fx.photoType) || 'image/png';
      view.toBlob(function (blob) {
        resolve({ blob: blob, ext: type === 'image/jpeg' ? 'jpg' : 'png' });
      }, type, 0.92);
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

  showLevel(null);
  selectEffect('bitmap');
  setMode('photo');
  setPhase('live');
  startCamera();
  requestAnimationFrame(tick);
})();
