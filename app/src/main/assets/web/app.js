(function () {
  'use strict';

  var GROUP = 'movement';
  // Raise this when the Android shell changes in a way that needs a reinstall.
  var SHELL_LATEST = 2;
  var W = 1920;
  var H = 1080;

  var nativeApp = window.MTVNative || null;
  // On the TV everything is driven by the remote; elsewhere (Chrome on a laptop) add mouse support.
  var pointer = !nativeApp;
  if (pointer) document.documentElement.className += ' pointer';
  var stage = document.getElementById('stage');
  var screenEl = document.getElementById('screen');
  var playerEl = document.getElementById('player');
  var toastEl = document.getElementById('toast');

  /* ------------------------------------------------------------------ */
  /* Storage                                                             */
  /* ------------------------------------------------------------------ */

  function load(key, fallback) {
    try {
      var v = localStorage.getItem('mtv.' + key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem('mtv.' + key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function cap(s) { s = String(s).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function tidy(title) {
    var t = String(title || '').replace(/\s+/g, ' ').trim();
    if (t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t)) t = cap(t);
    return t;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function minutes(ms) {
    var m = Math.round((ms || 0) / 60000);
    return m < 1 ? 'under a minute' : m + ' min';
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function qs(obj) {
    var out = [];
    Object.keys(obj).forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    });
    return out.join('&');
  }
  function attr(s) { return esc(s); }
  function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  var CHECK = '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>';

  /* ------------------------------------------------------------------ */
  /* Reading programs from Skool                                         */
  /* ------------------------------------------------------------------ */

  function AppError(kind, detail) { this.kind = kind; this.detail = detail || ''; }

  function nextData(path) {
    return fetch(path, { credentials: 'include', cache: 'no-store' }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw new AppError('signin');
      if (!res.ok) throw new AppError('network', 'HTTP ' + res.status);
      return res.text();
    }, function () {
      throw new AppError('network');
    }).then(function (html) {
      var m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) throw new AppError('format', 'no page data on ' + path);
      try { return JSON.parse(m[1]); } catch (e) { throw new AppError('format', 'unreadable page data'); }
    });
  }

  function parseVideo(link) {
    if (!link) return null;
    link = String(link).trim();
    var start = 0;
    var tm = link.match(/[#&?]t=(\d+)s?(?:$|[&#])/);
    if (tm) start = parseInt(tm[1], 10) || 0;
    var m = link.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/);
    if (m) return { kind: 'youtube', id: m[1], start: start };
    m = link.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]{6,}))?/);
    if (m) {
      var h = m[2] || ((link.match(/[?&]h=([0-9a-f]+)/) || [])[1]) || '';
      return { kind: 'vimeo', id: m[1], hash: h, start: start };
    }
    return { kind: 'link', url: link, start: start };
  }

  function thumbFor(v) {
    return v && v.kind === 'youtube' ? 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg' : '';
  }

  // "Phase 1 (Day 1 + 3)" -> group "Phase 1", label "Day 1 + 3", big "1 + 3"
  function parseSectionTitle(raw) {
    var t = tidy(raw);
    var m = t.match(/^(phase|level|week|stage|block|part)\s*(\d+)\s*[(\-:,]?\s*(day\s*[^)]*?)\s*\)?$/i);
    if (m) {
      var num = m[3].replace(/^day\s*/i, '').trim();
      return { group: cap(m[1]) + ' ' + m[2], label: 'Day ' + num, big: num, kind: 'day' };
    }
    m = t.match(/^day\s*(\d+(?:\s*[+&,]\s*\d+)*)$/i);
    if (m) return { group: null, label: 'Day ' + m[1], big: m[1], kind: 'day' };
    m = t.match(/^(phase|level|week|stage|block|part)\s*(\d+)$/i);
    if (m) return { group: null, label: cap(m[1]) + ' ' + m[2], big: m[2], kind: 'num', prefix: cap(m[1]) };
    return { group: null, label: t, big: t, kind: 'word' };
  }

  function normalizeCourse(meta, tree) {
    var cname = meta.name;
    var sections = [];
    var loose = [];
    // Text-only lessons aren't shown on the TV, but still count toward the
    // program's percentage so it matches the Skool site.
    var extraTotal = 0, extraDone = 0;

    function lesson(node) {
      if (!node || node.unitType !== 'module') return null;
      var md = node.metadata || {};
      if (md.hasAccess === 0) return null;
      var v = parseVideo(md.videoLink);
      if (!v) { extraTotal++; if (md.completed) extraDone++; return null; }
      return {
        id: cname + ':' + node.name,
        mid: node.id,
        title: tidy(md.title) || 'Exercise',
        video: v,
        thumb: md.videoThumbnail || thumbFor(v),
        ms: md.videoLenMs || 0,
        skoolDone: !!md.completed
      };
    }
    function section(id, title, lessons) {
      var info = parseSectionTitle(title);
      return { id: id, title: tidy(title), group: info.group, label: info.label, big: info.big, kind: info.kind, lessons: lessons };
    }
    function flush() {
      if (!loose.length) return;
      sections.push(section(cname + ':extra' + sections.length, loose.length === 1 ? loose[0].title : 'Extras', loose));
      loose = [];
    }

    (tree.children || []).forEach(function (ch) {
      var node = ch.course || ch;
      if (node.unitType === 'set') {
        flush();
        var ls = (ch.children || []).map(function (m) { return lesson(m.course || m); }).filter(Boolean);
        if (ls.length) sections.push(section(cname + ':' + node.name, (node.metadata || {}).title, ls));
      } else {
        var l = lesson(node);
        if (l) loose.push(l);
      }
    });
    flush();

    var md = meta.metadata || {};
    return { id: cname, title: tidy(md.title) || 'Program', cover: md.coverImage || '', sections: sections, extraTotal: extraTotal, extraDone: extraDone };
  }

  function fetchCatalog(onProgress) {
    return nextData('/' + GROUP + '/classroom').then(function (home) {
      var pp = (home && home.props && home.props.pageProps) || {};
      if (!pp.self) throw new AppError('signin');
      if (!Array.isArray(pp.allCourses)) throw new AppError('format', 'no course list');
      var g = (pp.currentGroup && pp.currentGroup.metadata) || {};
      var list = pp.allCourses.filter(function (c) { return c && c.name && c.metadata && c.metadata.hasAccess !== 0; });
      var courses = new Array(list.length);
      var next = 0;
      var finished = 0;

      function worker() {
        if (next >= list.length) return Promise.resolve();
        var idx = next++;
        var c = list[idx];
        return nextData('/' + GROUP + '/classroom/' + encodeURIComponent(c.name)).then(function (d) {
          var tree = d && d.props && d.props.pageProps && d.props.pageProps.course;
          if (!tree) throw new AppError('format', 'no course outline');
          courses[idx] = normalizeCourse(c, tree);
          finished++;
          if (onProgress) onProgress(finished, list.length);
          return worker();
        });
      }

      return Promise.all([worker(), worker(), worker()]).then(function () {
        var usable = courses.filter(function (c) { return c && c.sections.length; });
        if (!usable.length) throw new AppError('format', 'no videos found');
        return { at: Date.now(), name: g.displayName || 'The Movement Skool', logo: g.logoUrl || '', courses: usable };
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Progress                                                            */
  /* ------------------------------------------------------------------ */

  var catalog = load('catalog', null);
  var recent = load('recent', {});
  var notesCache = load('notes', {});
  // Older versions kept TV-only checkmarks; progress now lives on Skool.
  try { localStorage.removeItem('mtv.done'); } catch (e) { /* ignore */ }

  function isDone(l) { return !!l.skoolDone; }

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? m[1] : '';
  }

  // Marks a lesson complete (or not) on Skool itself, the same way the Skool site does.
  function setDone(l, done) {
    var headers = { 'content-type': 'application/json' };
    var waf = cookie('aws-waf-token');
    if (waf) headers['x-aws-waf-token'] = waf;
    return fetch('https://api2.skool.com/courses/' + encodeURIComponent(l.mid) + (done ? '/mark-done' : '/mark-undone'), {
      method: 'POST', credentials: 'include', headers: headers
    }).then(function (res) {
      if (!res.ok) throw new AppError(res.status === 401 || res.status === 403 ? 'signin' : 'network', 'HTTP ' + res.status);
      l.skoolDone = done;
      save('catalog', catalog);
    }, function () { throw new AppError('network'); });
  }

  /* ---------- coach's notes (sets, reps, cues) ---------- */

  // Skool stores lesson text as rich-text JSON prefixed with [v2]; turn it into plain lines.
  function descLines(desc) {
    if (!desc) return [];
    var raw = String(desc);
    var lines = [];
    var cur = '';
    function push() { var t = cur.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); cur = ''; }
    try {
      var json = JSON.parse(raw.replace(/^\[v\d+\]/, ''));
      (function walk(n) {
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (!n || typeof n !== 'object') return;
        if (n.type === 'text' && n.text) cur += n.text;
        if (n.type === 'hardBreak') push();
        if (n.content) walk(n.content);
        if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem') push();
      })(json);
      push();
    } catch (e) {
      raw.replace(/<[^>]+>/g, '\n').split(/\n+/).forEach(function (t) { cur = t; push(); });
    }
    return lines;
  }

  var NOTES_MAX_AGE = 3 * 24 * 3600 * 1000;
  function notesFor(l) { var n = notesCache[l.id]; return n ? n.x : null; }

  function fetchNotes(c, l) {
    return nextData('/' + GROUP + '/classroom/' + encodeURIComponent(c.id) + '?md=' + encodeURIComponent(l.mid)).then(function (d) {
      var tree = d && d.props && d.props.pageProps && d.props.pageProps.course;
      var found = null;
      (function walk(n) {
        if (!n || found) return;
        var node = n.course || n;
        if (node.id === l.mid) { found = node; return; }
        (n.children || []).forEach(walk);
      })(tree);
      var lines = descLines(found && found.metadata && found.metadata.desc);
      notesCache[l.id] = { x: lines, at: Date.now() };
      save('notes', notesCache);
      return lines;
    });
  }

  // Load notes for a day's exercises a couple at a time, updating rows as they arrive.
  function loadDayNotes(c, s, onEach) {
    var todo = s.lessons.filter(function (l) {
      var n = notesCache[l.id];
      return !n || Date.now() - n.at > NOTES_MAX_AGE;
    });
    var next = 0;
    function worker() {
      if (next >= todo.length) return Promise.resolve();
      var l = todo[next++];
      return fetchNotes(c, l).then(function (lines) { onEach(l, lines); }, function () { onEach(l, notesFor(l)); }).then(worker);
    }
    return Promise.all([worker(), worker()]);
  }
  function touch(course) { recent[course.id] = Date.now(); save('recent', recent); }

  function secStats(s) {
    var n = 0, ms = 0;
    s.lessons.forEach(function (l) { if (isDone(l)) n++; ms += l.ms; });
    return { done: n, total: s.lessons.length, complete: n === s.lessons.length, started: n > 0, ms: ms };
  }
  function courseStats(c) {
    var n = c.extraDone || 0, t = c.extraTotal || 0;
    c.sections.forEach(function (s) { s.lessons.forEach(function (l) { t++; if (isDone(l)) n++; }); });
    return { done: n, total: t };
  }
  // The furthest session you've touched; if it's finished, the one after it.
  function nextSection(c) {
    var last = -1;
    c.sections.forEach(function (s, i) { if (secStats(s).started) last = i; });
    if (last < 0) return c.sections[0];
    if (!secStats(c.sections[last]).complete) return c.sections[last];
    return c.sections[last + 1] || null;
  }
  function resumeIndex(s) {
    for (var i = 0; i < s.lessons.length; i++) if (!isDone(s.lessons[i])) return i;
    return 0;
  }
  function continueCourse() {
    var cs = catalog.courses;
    var best = null, bt = 0;
    cs.forEach(function (c) { var t = recent[c.id] || 0; if (t > bt && nextSection(c)) { best = c; bt = t; } });
    if (best) return best;
    var most = null, mc = 0;
    cs.forEach(function (c) { var st = courseStats(c); if (st.done > mc && st.done < st.total) { most = c; mc = st.done; } });
    return most || cs[0];
  }
  function findCourse(id) {
    if (!catalog) return null;
    for (var i = 0; i < catalog.courses.length; i++) if (catalog.courses[i].id === id) return catalog.courses[i];
    return null;
  }
  function findSection(c, id) {
    if (!c) return null;
    for (var i = 0; i < c.sections.length; i++) if (c.sections[i].id === id) return c.sections[i];
    return null;
  }
  function sectionName(s) { return s.group ? s.group + ', ' + s.label : s.label; }

  /* ------------------------------------------------------------------ */
  /* Screen stack and focus                                              */
  /* ------------------------------------------------------------------ */

  var stack = [];
  var screens = {};
  var focused = null;
  var scale = 1;

  function current() { return stack[stack.length - 1]; }
  function leaveCurrent() {
    var cur = current();
    if (cur && screens[cur.name].leave) screens[cur.name].leave(cur.p, cur);
  }
  function go(name, params, replace) {
    leaveCurrent();
    if (replace) stack.pop();
    stack.push({ name: name, p: params || {}, focus: null });
    render();
  }
  function reset(name, params) {
    leaveCurrent();
    stack = [{ name: name, p: params || {}, focus: null }];
    render();
  }
  function back() {
    if (stack.length <= 1) return false;
    leaveCurrent();
    stack.pop();
    render();
    return true;
  }
  function render() {
    var cur = current();
    var sc = screens[cur.name];
    if (sc.valid && !sc.valid(cur.p)) {
      if (cur.name === 'home' || !screens.home.valid()) { boot(true); return; }
      stack = [{ name: 'home', p: {}, focus: null }];
      cur = current();
      sc = screens.home;
    }
    focused = null;
    screenEl.innerHTML = sc.html(cur.p, cur);
    paint(screenEl);
    if (sc.after) sc.after(cur.p, cur);
    restoreFocus(cur);
  }

  function paint(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-bg]'), function (el) {
      var u = el.getAttribute('data-bg');
      if (u) el.style.backgroundImage = 'url("' + u.replace(/"/g, '%22') + '")';
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-w]'), function (el) {
      var w = Math.max(0, Math.min(1, parseFloat(el.getAttribute('data-w')) || 0));
      el.style.width = (w * 100) + '%';
    });
    fitAll(root);
  }
  function fitAll(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-fit]'), function (el) {
      el.style.fontSize = '';
      var size = parseFloat(window.getComputedStyle(el).fontSize);
      var floor = parseFloat(el.getAttribute('data-fit')) || 40;
      while (el.scrollWidth > el.clientWidth + 1 && size > floor) {
        size -= 6;
        el.style.fontSize = size + 'px';
      }
    });
  }

  function focusables() { return Array.prototype.slice.call(screenEl.querySelectorAll('[data-f]')); }
  function setFocus(el, instant, noReveal) {
    if (focused && focused !== el) focused.classList.remove('is-f');
    focused = el || null;
    if (!el) return;
    el.classList.add('is-f');
    var cur = current();
    if (cur) cur.focus = el.getAttribute('data-key');
    var g = el.closest('[data-group]');
    if (g) g.setAttribute('data-last', el.getAttribute('data-key'));
    if (!noReveal) reveal(el, instant);
  }
  function restoreFocus(cur) {
    var el = null;
    if (cur.focus) el = screenEl.querySelector('[data-key="' + cssq(cur.focus) + '"]');
    if (!el) el = screenEl.querySelector('[data-default]');
    if (!el) el = focusables()[0];
    if (el) setFocus(el, true);
  }

  function box(el) {
    var r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
  }
  function gap(a1, a2, b1, b2) { if (b2 < a1) return a1 - b2; if (b1 > a2) return b1 - a2; return 0; }
  function score(dir, a, b) {
    if (dir === 'right') {
      if (b.cx <= a.cx + 1 || b.l < a.l + 1) return Infinity;
      return Math.max(0, b.l - a.r) + gap(a.t, a.b, b.t, b.b) * 4 + Math.abs(b.cy - a.cy) * 0.15;
    }
    if (dir === 'left') {
      if (b.cx >= a.cx - 1 || b.r > a.r - 1) return Infinity;
      return Math.max(0, a.l - b.r) + gap(a.t, a.b, b.t, b.b) * 4 + Math.abs(b.cy - a.cy) * 0.15;
    }
    if (dir === 'down') {
      if (b.cy <= a.cy + 1 || b.t < a.t + 1) return Infinity;
      return Math.max(0, b.t - a.b) + gap(a.l, a.r, b.l, b.r) * 2 + Math.abs(b.cx - a.cx) * 0.05;
    }
    if (dir === 'up') {
      if (b.cy >= a.cy - 1 || b.b > a.b - 1) return Infinity;
      return Math.max(0, a.t - b.b) + gap(a.l, a.r, b.l, b.r) * 2 + Math.abs(b.cx - a.cx) * 0.05;
    }
    return Infinity;
  }
  function move(dir) {
    var list = focusables();
    if (!list.length) return false;
    if (!focused || list.indexOf(focused) < 0) { setFocus(list[0]); return true; }
    var a = box(focused);
    var best = null, bestScore = Infinity;
    list.forEach(function (el) {
      if (el === focused) return;
      var s = score(dir, a, box(el));
      if (s < bestScore) { bestScore = s; best = el; }
    });
    if (!best) return false;
    var g = best.closest('[data-group]');
    var cg = focused.closest('[data-group]');
    if (g && g !== cg) {
      var lk = g.getAttribute('data-last');
      var rem = lk ? g.querySelector('[data-key="' + cssq(lk) + '"]') : null;
      if (rem) best = rem;
    }
    setFocus(best);
    return true;
  }
  // Keep the focused item inside its scrolling row or column.
  function reveal(el, instant) {
    var node = el.parentNode;
    while (node && node !== screenEl && node.getAttribute) {
      var axis = node.getAttribute('data-scroll');
      if (axis) {
        node.style.scrollBehavior = instant ? 'auto' : '';
        var er = el.getBoundingClientRect();
        var nr = node.getBoundingClientRect();
        if (axis === 'x') {
          var px = 112 * scale;
          if (er.left < nr.left + px) node.scrollLeft -= (nr.left + px - er.left) / scale;
          else if (er.right > nr.right - px) node.scrollLeft += (er.right - (nr.right - px)) / scale;
        } else {
          var py = 150 * scale;
          if (er.top < nr.top + py) node.scrollTop -= (nr.top + py - er.top) / scale;
          else if (er.bottom > nr.bottom - py) node.scrollTop += (er.bottom - (nr.bottom - py)) / scale;
        }
      }
      node = node.parentNode;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Remote control                                                      */
  /* ------------------------------------------------------------------ */

  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 27: 'back', 8: 'back', 179: 'playpause', 32: 'playpause', 227: 'rew', 228: 'ff', 412: 'rew', 417: 'ff' };
  var NAMED = { MediaPlayPause: 'playpause', MediaRewind: 'rew', MediaFastForward: 'ff', GoBack: 'back', BrowserBack: 'back' };

  document.addEventListener('keydown', function (e) {
    var k = KEYS[e.keyCode] || NAMED[e.key];
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    handle(k);
  }, true);

  function handle(k) {
    var cur = current();
    if (!cur) return false;
    var sc = screens[cur.name];
    if (sc.key && sc.key(k, cur.p, cur) === true) return true;
    if (k === 'back') return back();
    if (k === 'ok') { activate(focused); return true; }
    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') { move(k); return true; }
    return false;
  }
  function activate(el) {
    if (!el) return;
    var a = el.getAttribute('data-act');
    if (a && actions[a]) actions[a](el);
  }

  if (pointer) {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-f]') : null;
      var cur = current();
      if (!el && cur && cur.name === 'player' && P.mode === 'play') { togglePlay(); showOverlay(); return; }
      if (!el || !screenEl.contains(el)) return;
      e.preventDefault();
      setFocus(el, false, true);
      activate(el);
    });
    document.addEventListener('mouseover', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-f]') : null;
      if (el && el !== focused && screenEl.contains(el)) setFocus(el, false, true);
    });
    document.addEventListener('mousemove', function () {
      var cur = current();
      if (cur && cur.name === 'player') showOverlay();
    });
    document.addEventListener('wheel', function (e) {
      var node = e.target;
      while (node && node !== document.body && !(node.getAttribute && node.getAttribute('data-scroll'))) node = node.parentNode;
      if (!node || node === document.body || !node.getAttribute) return;
      e.preventDefault();
      node.style.scrollBehavior = 'auto';
      var d = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 40 : 1) / scale;
      if (node.getAttribute('data-scroll') === 'x') node.scrollLeft += d;
      else node.scrollTop += d;
    }, { passive: false });
  }

  function backButton(cls) {
    return pointer ? '<div class="btn small back-btn ' + (cls || '') + '" data-f data-key="back" data-act="goback">Back</div>' : '';
  }

  // Called by the Fire TV app for Back and media buttons.
  window.mtvKey = function (k) { return handle(k); };
  // The Fire TV app asks this before reloading to pick up newer screens.
  window.mtvCanReload = function () { var c = current(); return !c || c.name !== 'player'; };
  window.mtvBack = function () { return handle('back'); };

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2800);
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  var actions = {
    play: function (el) {
      go('player', { c: el.getAttribute('data-c'), s: el.getAttribute('data-s'), i: parseInt(el.getAttribute('data-i'), 10) || 0 });
    },
    course: function (el) { go('program', { c: el.getAttribute('data-c') }); },
    section: function (el) { go('day', { c: el.getAttribute('data-c'), s: el.getAttribute('data-s') }); },
    refresh: function () { refresh(true); },
    goback: function () {
      var cur = current();
      if (cur && cur.name === 'player') returnToList(P.ctx ? 'v:' + P.ctx.i : null);
      else back();
    },
    signin: function () {
      if (nativeApp && nativeApp.signIn) nativeApp.signIn();
      else window.location.href = '/login';
    },
    retry: function () { boot(true); },
    skool: function () {
      var path = '/' + GROUP + '/classroom';
      if (nativeApp && nativeApp.openSkool) nativeApp.openSkool(path);
      else window.location.href = path;
    },
    retryvideo: function () { loadLesson(current().p); },
    skipvideo: function () {
      if (P.ctx.i + 1 < P.ctx.s.lessons.length) advance(P.ctx.i + 1);
      else returnToList('d:' + P.ctx.i);
    },
    tolist: function () { returnToList(P.ctx ? 'v:' + P.ctx.i : null); },
    toggleDone: function (el) {
      if (el.getAttribute('data-busy')) return;
      var c = findCourse(el.getAttribute('data-c'));
      var s = findSection(c, el.getAttribute('data-s'));
      var i = parseInt(el.getAttribute('data-i'), 10) || 0;
      var l = s && s.lessons[i];
      if (!l) return;
      var want = !isDone(l);
      var before = el.innerHTML;
      el.setAttribute('data-busy', '1');
      el.textContent = 'Saving\u2026';
      setDone(l, want).then(function () {
        var cur = current();
        if (cur && cur.name === 'day') { cur.focus = 'd:' + i; render(); }
        toast(want ? 'Marked done on Skool' : 'Marked not done on Skool');
      }, function (e) {
        el.removeAttribute('data-busy');
        el.innerHTML = before;
        toast(e && e.kind === 'signin' ? 'Skool signed you out. Sign in again to save progress.' : 'Couldn\'t save to Skool. Try again.');
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Shared markup                                                       */
  /* ------------------------------------------------------------------ */

  function shellOutdated() {
    if (!nativeApp) return false;
    var v = 1;
    try { if (nativeApp.shellVersion) v = nativeApp.shellVersion(); } catch (e) { v = 1; }
    return v < SHELL_LATEST;
  }

  function topBar(withRefresh, withBack) {
    var logo = catalog && catalog.logo ? '<img src="' + attr(catalog.logo) + '" alt="">' : '';
    return '<div class="topbar"><div class="brand">' + logo + esc(catalog ? catalog.name : 'The Movement Skool') + '</div>' +
      '<div class="spacer"></div>' +
      (withRefresh && shellOutdated() ? '<div class="update-note">App update ready: enter 1080385 in Downloader</div>' : '') +
      (withRefresh ? '<div class="btn small" data-f data-key="refresh" data-act="refresh">Refresh</div>' : '') +
      (withBack ? backButton() : '') +
      '</div>';
  }

  function pill(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<div class="pill' + (pct >= 12 ? ' on' : '') + '"><i data-w="' + (pct / 100) + '"></i><span>' + pct + '%</span></div>';
  }

  function playAttrs(c, s, i) {
    return ' data-act="play" data-c="' + attr(c.id) + '" data-s="' + attr(s.id) + '" data-i="' + i + '"';
  }

  /* ------------------------------------------------------------------ */
  /* Screens                                                             */
  /* ------------------------------------------------------------------ */

  // 1. All programs
  screens.home = {
    valid: function () { return !!(catalog && catalog.courses && catalog.courses.length); },
    html: function () {
      var cards = catalog.courses.map(function (c, ci) {
        var cs = courseStats(c);
        return '<div class="pcard" data-f' + (ci === 0 ? ' data-default' : '') + ' data-key="c:' + attr(c.id) + '" data-act="course" data-c="' + attr(c.id) + '">' +
          '<div class="img" data-bg="' + attr(c.cover) + '"></div>' +
          '<div class="body"><div class="ttl">' + esc(c.title) + '</div>' + pill(cs.done, cs.total) + '</div></div>';
      }).join('');
      return topBar(true) +
        '<div class="home-grid"><div class="vs" data-scroll="y"><div class="vs-inner">' + cards + '</div></div></div>';
    }
  };

  // 2. A program's days
  screens.program = {
    valid: function (p) { return !!findCourse(p.c); },
    html: function (p) {
      var c = findCourse(p.c);
      var cs = courseStats(c);
      var ns = nextSection(c) || c.sections[0];

      var side = '<div class="p-side"><div class="p-card">' +
        '<div class="cover" data-bg="' + attr(c.cover) + '"></div>' +
        '<div class="body"><h1>' + esc(c.title) + '</h1>' + pill(cs.done, cs.total) +
        '<div class="meta">' + cs.done + ' of ' + plural(cs.total, 'lesson', 'lessons') + ' complete</div></div>' +
        '</div></div>';

      var rows = [];
      c.sections.forEach(function (s) {
        var key = s.group || (s.kind === 'word' ? '' : '#');
        var last = rows[rows.length - 1];
        if (last && last.key === key) last.items.push(s);
        else rows.push({ key: key, label: s.group || '', items: [s] });
      });

      var grid = rows.map(function (r, ri) {
        var tiles = r.items.map(function (s) {
          var st = secStats(s);
          var wide = s.kind === 'word' || String(s.big).length > 2;
          var cls = 'tile' + (wide ? ' wide' : '') + (s === ns && !st.complete ? ' next' : '');
          var head = s.kind === 'word'
            ? '<div class="nm">' + esc(s.label) + '</div>'
            : '<div class="dn" data-fit="34"><span class="dd">' + esc(s.kind === 'day' ? 'Day' : (s.prefix || '')) + '</span>' + esc(s.big) + '</div>';
          return '<div class="' + cls + '" data-f' + (s === c.sections[0] ? ' data-default' : '') + ' data-key="s:' + attr(s.id) + '" data-act="section" data-c="' + attr(c.id) + '" data-s="' + attr(s.id) + '">' +
            head +
            '<div class="dl">' + esc(plural(st.total, 'exercise', 'exercises') + ', ' + minutes(st.ms)) + '</div>' +
            (st.complete ? '<div class="badge">' + CHECK + '</div>' : '') +
            (st.started && !st.complete ? '<div class="mini"><i data-w="' + (st.done / st.total) + '"></i></div>' : '') +
            '</div>';
        }).join('');
        return '<div class="grp" data-group="g' + ri + '"><div class="grp-l">' + esc(r.label) + '</div>' + tiles + '</div>';
      }).join('');

      return topBar(false, true) + side + '<div class="p-main"><div class="vs" data-scroll="y"><div class="vs-inner">' + grid + '</div></div></div>';
    }
  };

  // 3. A day: header band, then a scrolling list of exercises (video + coach's notes)
  function notesHtml(l) {
    var lines = notesFor(l);
    if (lines === null) return '<div class="none">Loading notes\u2026</div>';
    if (!lines.length) return '<div class="none">No notes for this one. Watch the video for the details.</div>';
    return lines.map(function (t) { return '<div class="line">' + esc(t) + '</div>'; }).join('');
  }

  screens.day = {
    valid: function (p) { return !!findSection(findCourse(p.c), p.s); },
    html: function (p) {
      var c = findCourse(p.c);
      var s = findSection(c, p.s);
      var st = secStats(s);
      var name = s.group
        ? '<span class="g">' + esc(s.group) + '</span><span class="b">' + esc(s.label) + '</span>'
        : '<span class="b">' + esc(s.label) + '</span>';

      var head = '<div class="day-head">' + backButton('corner') + '<div class="titles">' +
          '<div class="course">' + esc(c.title) + '</div>' +
          '<div class="name' + (s.kind === 'word' ? ' word' : '') + '" data-fit="40">' + name + '</div></div>' +
        '<div class="prog"><div>' + st.done + ' of ' + plural(st.total, 'exercise', 'exercises') + ' done, about ' + minutes(st.ms) + '</div>' +
          pill(st.done, st.total) + '</div></div>';

      var rows = s.lessons.map(function (l, i) {
        var d = isDone(l);
        var ref = ' data-c="' + attr(c.id) + '" data-s="' + attr(s.id) + '" data-i="' + i + '"';
        return '<div class="ex2' + (d ? ' done' : '') + '">' +
          '<div class="vid" data-f' + (i === 0 ? ' data-default' : '') + ' data-key="v:' + i + '"' + playAttrs(c, s, i) + '>' +
            '<div class="th" data-bg="' + attr(l.thumb) + '"></div><div class="play"></div>' +
            (l.ms ? '<div class="len">' + clock(l.ms / 1000) + '</div>' : '') + '</div>' +
          '<div class="info">' +
            '<div class="k">Exercise ' + (i + 1) + ' of ' + s.lessons.length + '</div>' +
            '<div class="t">' + esc(l.title) + '</div>' +
            '<div class="notes" id="notes-' + i + '">' + notesHtml(l) + '</div>' +
            '<div class="btn done-btn' + (d ? ' on' : '') + '" data-f data-key="d:' + i + '" data-act="toggleDone"' + ref + '>' +
              (d ? CHECK + ' Done' : 'Mark done') + '</div>' +
          '</div></div>';
      }).join('');

      return head + '<div class="d-list2"><div class="vs" data-scroll="y"><div class="vs-inner">' + rows + '</div></div></div>';
    },
    after: function (p, entry) {
      var c = findCourse(p.c);
      var s = findSection(c, p.s);
      loadDayNotes(c, s, function (l) {
        if (current() !== entry) return;
        var i = s.lessons.indexOf(l);
        var box = $('notes-' + i);
        if (box) box.innerHTML = notesHtml(l);
      });
    }
  };

  screens.loading = {
    html: function () {
      return '<div class="msg"><h1>Loading your programs</h1>' +
        '<p id="load-note">Getting the latest from The Movement Skool.</p></div>' +
        '<div class="loader"><i></i></div>';
    }
  };

  screens.signin = {
    html: function () {
      return '<div class="msg"><h1>Sign in to The Movement Skool</h1>' +
        '<p>You sign in once, on Skool\'s own sign-in page. Use the on-screen keyboard for your email and password.</p>' +
        '<p>After that, this app opens straight to your programs.</p>' +
        '<div class="actions"><div class="btn primary" data-f data-default data-key="signin" data-act="signin">Sign in</div></div></div>';
    }
  };

  screens.error = {
    html: function (p) {
      if (p.kind === 'format') {
        return '<div class="msg"><h1>Skool\'s pages changed</h1>' +
          '<p>The app couldn\'t read your programs from Skool, so it can\'t show them right now. Skool\'s own site still works in the meantime.</p>' +
          '<div class="actions"><div class="btn primary" data-f data-default data-key="retry" data-act="retry">Try again</div>' +
          '<div class="btn" data-f data-key="skool" data-act="skool">Open Skool\'s site</div></div></div>';
      }
      return '<div class="msg"><h1>Can\'t reach Skool</h1>' +
        '<p>Check that the Firestick is connected to the internet, then try again.</p>' +
        '<div class="actions"><div class="btn primary" data-f data-default data-key="retry" data-act="retry">Try again</div></div></div>';
    }
  };

  /* ------------------------------------------------------------------ */
  /* Player                                                              */
  /* ------------------------------------------------------------------ */

  var P = {
    iframe: null, kind: null, origin: null, ctx: null, lesson: null,
    t: 0, d: 0, playing: false, ended: false, gotMsg: false, mode: 'play',
    listenTimer: null, hideTimer: null
  };

  screens.player = {
    valid: function (p) {
      var s = findSection(findCourse(p.c), p.s);
      return !!(s && s.lessons[p.i]);
    },
    html: function () {
      return '<div class="pl" id="pl">' +
        '<div class="scrim-top"></div><div class="scrim-bot"></div>' +
        '<div class="info"><div class="where" id="pl-where"></div><div class="now" id="pl-now"></div><div class="of" id="pl-of"></div><div class="pnotes" id="pl-notes"></div></div>' +
        '<div class="bottom"><div class="prog"><i id="pl-bar"></i></div>' +
          '<div class="times"><span id="pl-t">0:00</span><span class="state" id="pl-state">Loading</span><span id="pl-d"></span></div>' +
          '<div class="hints">' +
            '<span class="hint"><span class="key">OK</span><span id="pl-okhint">Pause</span></span>' +
            '<span class="hint"><span class="key">&#9664; &#9654;</span>Back or ahead 10 seconds</span>' +
            '<span class="hint"><span class="key">Back</span>Exercise list</span>' +
          '</div></div>' +
        backButton('corner on-video') +
        '</div><div id="pl-panel"></div>';
    },
    after: function (p) {
      document.body.classList.add('is-playing');
      loadLesson(p);
    },
    leave: function () {
      destroyFrame();
      clearTimeout(P.hideTimer);
      document.body.classList.remove('is-playing');
      P.mode = 'play';
    },
    key: function (k) {
      if (k === 'back') { returnToList(P.ctx ? 'v:' + P.ctx.i : null); return true; }
      if (P.mode !== 'play') return false; // error panel uses normal button focus
      showOverlay();
      if (k === 'ok' || k === 'playpause') { togglePlay(); return true; }
      if (k === 'left' || k === 'rew') { seekBy(-10); return true; }
      if (k === 'right' || k === 'ff') { seekBy(10); return true; }
      if (k === 'pause') { if (P.playing) togglePlay(); return true; }
      if (k === 'up' || k === 'down') return true;
      return false;
    }
  };

  function $(id) { return document.getElementById(id); }

  function destroyFrame() {
    clearInterval(P.listenTimer);
    if (P.iframe && P.iframe.parentNode) P.iframe.parentNode.removeChild(P.iframe);
    P.iframe = null;
    playerEl.innerHTML = '';
  }

  // Back to the day's list, with the given item ('v:2' = video 3, 'd:2' = its Done button) selected.
  function returnToList(focusKey) {
    var below = stack[stack.length - 2];
    if (below && below.name === 'day' && focusKey) below.focus = focusKey;
    if (!back()) reset('home');
  }

  function loadLesson(p) {
    var c = findCourse(p.c);
    var s = findSection(c, p.s);
    var l = s.lessons[p.i];
    var v = l.video;
    P.ctx = { c: c, s: s, i: p.i };
    P.lesson = l;
    P.t = v.start || 0;
    P.d = l.ms ? l.ms / 1000 : 0;
    P.playing = false;
    P.ended = false;
    P.gotMsg = false;
    P.mode = 'play';
    $('pl-panel').innerHTML = '';
    $('pl-where').textContent = c.title + ', ' + sectionName(s);
    $('pl-now').textContent = l.title;
    $('pl-of').textContent = 'Exercise ' + (p.i + 1) + ' of ' + s.lessons.length;
    $('pl-notes').textContent = (notesFor(l) || []).join('   ');
    $('pl-state').textContent = 'Loading';
    $('pl-okhint').textContent = 'Pause';
    updateTime();
    showOverlay(true);
    touch(c);

    destroyFrame();
    if (v.kind !== 'youtube' && v.kind !== 'vimeo') { playerError(); return; }

    var f = document.createElement('iframe');
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    f.setAttribute('tabindex', '-1');
    f.setAttribute('allowfullscreen', '');
    if (v.kind === 'youtube') {
      P.kind = 'youtube';
      P.origin = 'https://www.youtube.com';
      f.src = 'https://www.youtube.com/embed/' + v.id + '?' + qs({
        enablejsapi: 1, autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3,
        disablekb: 1, fs: 0, modestbranding: 1, cc_load_policy: 0, origin: window.location.origin,
        start: v.start || undefined
      });
    } else {
      P.kind = 'vimeo';
      P.origin = 'https://player.vimeo.com';
      f.src = 'https://player.vimeo.com/video/' + v.id + '?' + qs({
        h: v.hash || undefined, autoplay: 1, title: 0, byline: 0, portrait: 0, dnt: 1,
        controls: 0, keyboard: 0, pip: 0
      }) + (v.start ? '#t=' + v.start + 's' : '');
    }
    f.onload = function () { if (P.iframe === f && P.kind === 'youtube') ytHandshake(); };
    playerEl.appendChild(f);
    P.iframe = f;
  }

  // YouTube's embed listens for JSON strings; Vimeo's player takes plain objects.
  function post(obj) {
    if (!P.iframe || !P.iframe.contentWindow) return;
    try { P.iframe.contentWindow.postMessage(P.kind === 'youtube' ? JSON.stringify(obj) : obj, P.origin); } catch (e) { /* frame gone */ }
  }
  function ytCmd(func, args) { post({ event: 'command', func: func, args: args || [], id: 1, channel: 'widget' }); }
  function ytHandshake() {
    var n = 0;
    clearInterval(P.listenTimer);
    P.listenTimer = setInterval(function () {
      if (P.gotMsg || n++ > 40) { clearInterval(P.listenTimer); return; }
      post({ event: 'listening', id: 1, channel: 'widget' });
      ytCmd('addEventListener', ['onStateChange']);
      ytCmd('addEventListener', ['onError']);
    }, 250);
  }

  window.addEventListener('message', function (e) {
    if (!P.iframe || e.source !== P.iframe.contentWindow) return;
    var data = e.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (x) { return; } }
    if (!data || typeof data !== 'object') return;
    P.gotMsg = true;
    var ev = data.event;

    if (P.kind === 'youtube') {
      var info = data.info;
      if (ev === 'onReady') ytCmd('playVideo');
      if ((ev === 'infoDelivery' || ev === 'initialDelivery') && info && typeof info === 'object') {
        if (typeof info.currentTime === 'number') P.t = info.currentTime;
        if (info.duration) P.d = info.duration;
        if (typeof info.playerState === 'number') ytState(info.playerState);
        updateTime();
      }
      if (ev === 'onStateChange') ytState(typeof info === 'number' ? info : (info && info.playerState));
      if (ev === 'onError') playerError();
    } else if (P.kind === 'vimeo') {
      if (ev === 'ready') {
        ['ended', 'timeupdate', 'play', 'pause', 'error'].forEach(function (name) { post({ method: 'addEventListener', value: name }); });
        post({ method: 'play' });
      }
      // Older Vimeo players report playProgress/finish instead of timeupdate/ended.
      if ((ev === 'timeupdate' || ev === 'playProgress') && data.data) {
        P.t = data.data.seconds || 0;
        if (data.data.duration) P.d = data.data.duration;
        if (!P.playing) setPlaying(true);
        updateTime();
      }
      if (ev === 'play' || ev === 'playing') setPlaying(true);
      if (ev === 'pause') setPlaying(false);
      if (ev === 'ended' || ev === 'finish') onEnded();
      if (ev === 'error') playerError();
    }
  });

  function ytState(s) {
    if (s === 1) setPlaying(true);
    else if (s === 2) setPlaying(false);
    else if (s === 0) onEnded();
  }

  function setPlaying(on) {
    var state = $('pl-state');
    if (!state) return;
    if (P.playing === on && state.textContent !== 'Loading') return;
    P.playing = on;
    state.textContent = on ? '' : 'Paused';
    $('pl-okhint').textContent = on ? 'Pause' : 'Play';
    showOverlay();
  }

  function updateTime() {
    var t = $('pl-t');
    if (!t) return;
    t.textContent = clock(P.t);
    $('pl-d').textContent = P.d ? clock(P.d) : '';
    $('pl-bar').style.width = (P.d ? Math.min(100, (P.t / P.d) * 100) : 0) + '%';
  }

  function showOverlay(stay) {
    var pl = $('pl');
    if (!pl) return;
    pl.classList.remove('quiet');
    clearTimeout(P.hideTimer);
    if (stay) return;
    if (P.playing && P.mode === 'play') {
      P.hideTimer = setTimeout(function () { if ($('pl')) $('pl').classList.add('quiet'); }, 4000);
    }
  }

  function togglePlay() {
    if (P.kind === 'youtube') ytCmd(P.playing ? 'pauseVideo' : 'playVideo');
    else if (P.kind === 'vimeo') post({ method: P.playing ? 'pause' : 'play' });
    setPlaying(!P.playing);
  }

  function seekBy(delta) {
    var t = Math.max(0, P.t + delta);
    if (P.d) t = Math.min(t, Math.max(0, P.d - 1));
    if (P.kind === 'youtube') ytCmd('seekTo', [t, true]);
    else if (P.kind === 'vimeo') post({ method: 'setCurrentTime', value: t });
    P.t = t;
    updateTime();
  }

  function advance(i) {
    var cur = current();
    cur.p.i = i;
    cur.focus = null;
    loadLesson(cur.p);
  }

  // When a video finishes, go back to the list with its Done button ready to press.
  function onEnded() {
    if (P.ended) return;
    P.ended = true;
    var i = P.ctx.i;
    var hasNext = i + 1 < P.ctx.s.lessons.length;
    returnToList(!isDone(P.lesson) ? 'd:' + i : (hasNext ? 'v:' + (i + 1) : 'd:' + i));
  }

  function playerError() {
    P.mode = 'error';
    clearTimeout(P.hideTimer);
    var panel = $('pl-panel');
    var hasNext = P.ctx.i + 1 < P.ctx.s.lessons.length;
    panel.innerHTML = '<div class="panel"><div class="side">' +
      '<div class="label">' + esc(P.lesson.title) + '</div>' +
      '<div class="nm">This video won\'t play here</div>' +
      '<div class="note">It may have been moved or made private on Skool. Try again, skip to the next exercise, or open it on Skool\'s site.</div>' +
      '<div class="actions"><div class="btn primary" data-f data-default data-key="rv" data-act="retryvideo">Try again</div>' +
      (hasNext ? '<div class="btn" data-f data-key="sv" data-act="skipvideo">Next exercise</div>' : '') +
      '<div class="btn" data-f data-key="tl" data-act="tolist">Exercise list</div>' +
      '<div class="btn" data-f data-key="sk" data-act="skool">Open Skool</div></div></div></div>';
    setFocus(panel.querySelector('[data-default]'));
  }

  /* ------------------------------------------------------------------ */
  /* Start-up and refresh                                                */
  /* ------------------------------------------------------------------ */

  function fit() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    scale = Math.min(w / W, h / H);
    stage.style.transform = 'scale(' + scale + ')';
    stage.style.left = Math.round((w - W * scale) / 2) + 'px';
    stage.style.top = Math.round((h - H * scale) / 2) + 'px';
  }
  window.addEventListener('resize', function () { fit(); fitAll(screenEl); });
  fit();

  function boot(force) {
    if (!force && catalog && catalog.courses && catalog.courses.length) {
      reset('home');
      refresh(false);
      return;
    }
    reset('loading');
    fetchCatalog(function (n, total) {
      var note = $('load-note');
      if (note) note.textContent = n + ' of ' + total + ' programs loaded.';
    }).then(function (fresh) {
      catalog = fresh;
      save('catalog', catalog);
      reset('home');
    }, function (e) {
      if (e && e.kind === 'signin') reset('signin');
      else reset('error', { kind: (e && e.kind) || 'network' });
    });
  }

  var refreshing = false;
  function refresh(manual) {
    if (refreshing) return;
    refreshing = true;
    if (manual) toast('Checking Skool for updates');
    fetchCatalog().then(function (fresh) {
      refreshing = false;
      catalog = fresh;
      save('catalog', catalog);
      var cur = current();
      if (cur && (cur.name === 'home' || cur.name === 'program' || cur.name === 'day')) render();
      if (manual) toast('Up to date');
    }, function (e) {
      refreshing = false;
      if (e && e.kind === 'signin') reset('signin');
      else if (manual) toast(e && e.kind === 'format' ? 'Couldn\'t read Skool\'s pages' : 'Can\'t reach Skool right now');
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { fitAll(screenEl); });
  }

  // Exposed for testing in a desktop browser.
  window.MTV = { boot: boot, refit: function () { fitAll(screenEl); }, state: function () { return { stack: stack, catalog: catalog }; } };

  boot(false);
})();
