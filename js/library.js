// Media library: images from a feed the user names, for effects that lay out a collection.
//
//   Magi.library.get(source) → { status: 'idle' | 'loading' | 'ready' | 'failed', items: [canvas],
//                                 message }  (the same object fills in as images arrive). Each item
//   canvas carries .meta, its feed entry (src, title, and `embedding`, an array, if the feed has one).
//
// A source is either
//   - a JSON feed URL: { "items": [ { "src": "https://…" }, … ] }, or an array of URLs or of
//     { src } objects (see docs/ROADMAP.md), or
//   - a public Are.na channel: its URL (https://www.are.na/<user>/<channel>) or just "arena:<channel>",
//     read through Are.na's open API (api.are.na/v2/channels/<channel>/contents), images only.
// Images load with crossOrigin = 'anonymous', so a host that doesn't send CORS headers makes that
// image fail to load (it's skipped) instead of tainting the canvas, which would block saving
// photos and videos. Each image becomes a thumbnail canvas at most 256 px on its long side.
// Up to 120 images, six at a time. Results are kept per source for the session.
(function () {
  var MAX = 120, THUMB = 256, PARALLEL = 6, cache = {};

  function arenaSlug(src) {
    var m = /^arena:(.+)$/i.exec(src) || /are\.na\/[^/]+\/([^/?#]+)/i.exec(src);
    return m ? m[1] : null;
  }

  function list(src) {
    var slug = arenaSlug(src);
    if (slug) {
      return fetch('https://api.are.na/v2/channels/' + encodeURIComponent(slug) + '/contents?per=' + MAX)
        .then(function (r) { if (!r.ok) throw new Error('Are.na channel not found'); return r.json(); })
        .then(function (j) {
          return (j.contents || []).filter(function (b) { return b.image; }).map(function (b) {
            return { src: (b.image.display || b.image.large || b.image.thumb || b.image.original || {}).url, title: b.title || '' };
          }).filter(function (it) { return it.src; });
        });
    }
    return fetch(src).then(function (r) { if (!r.ok) throw new Error('Feed not found'); return r.json(); }).then(function (j) {
      var items = Array.isArray(j) ? j : (j.items || []);
      return items.map(function (it) { return typeof it === 'string' ? { src: it } : it; }).filter(function (it) { return it && it.src; });
    });
  }

  function thumb(item) {
    var url = item.src;
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var k = Math.min(1, THUMB / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.meta = item; // the feed entry: src, title, and an embedding if the feed carries one
        resolve(c);
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  Magi.library = {
    get: function (source) {
      source = (source || '').trim();
      if (!source) return { status: 'idle', items: [], message: '' };
      if (cache[source]) return cache[source];
      var entry = cache[source] = { status: 'loading', items: [], message: 'Loading the library…' };
      list(source).then(function (urls) {
        urls = urls.slice(0, MAX);
        if (!urls.length) { entry.status = 'failed'; entry.message = 'No images in that feed.'; return; }
        entry.total = urls.length;
        var next = 0, done = 0;
        function work() {
          if (next >= urls.length) return Promise.resolve();
          var url = urls[next++];
          return thumb(url).then(function (c) { done++; if (c) entry.items.push(c); return work(); });
        }
        var workers = [];
        for (var i = 0; i < PARALLEL; i++) workers.push(work());
        return Promise.all(workers).then(function () {
          entry.status = entry.items.length ? 'ready' : 'failed';
          entry.message = entry.items.length ? '' : 'Images couldn’t load: the host must allow other sites (CORS).';
        });
      }).catch(function (e) {
        entry.status = 'failed';
        entry.message = (e && e.message) || 'The library couldn’t load.';
      });
      return entry;
    }
  };
})();
