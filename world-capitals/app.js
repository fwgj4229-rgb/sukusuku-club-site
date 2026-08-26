/* 世界の国と首都をおぼえよう — アプリ本体 */
(function () {
  'use strict';

  var DATA = window.COUNTRIES;
  var REGIONS = window.REGIONS;
  var MAP = window.WORLD_MAP;
  var NS = 'http://www.w3.org/2000/svg';
  var TARGET = {};
  DATA.forEach(function (c) { TARGET[c.id] = c; });

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ============================================================
     せいせき（localStorage）
     ============================================================ */
  var KEY = 'wc-progress-v1';
  var P = loadProgress();

  function loadProgress() {
    var base = { v: 1, stats: {}, total: { ok: 0, ng: 0 }, streak: 0, bestStreak: 0, quizzes: 0 };
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return base;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return base;
      o.stats = o.stats || {};
      o.total = o.total || { ok: 0, ng: 0 };
      o.streak = o.streak || 0;
      o.bestStreak = o.bestStreak || 0;
      o.quizzes = o.quizzes || 0;
      return o;
    } catch (e) { return base; }
  }
  function saveProgress() {
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* 保存できなくても学習は続けられる */ }
  }
  function statOf(id) {
    if (!P.stats[id]) P.stats[id] = { ok: 0, ng: 0 };
    return P.stats[id];
  }
  function record(id, ok) {
    var s = statOf(id);
    if (ok) { s.ok++; P.total.ok++; P.streak++; if (P.streak > P.bestStreak) P.bestStreak = P.streak; }
    else { s.ng++; P.total.ng++; P.streak = 0; }
    saveProgress();
  }
  function mastery(id) {              // 0〜1：その国の「おぼえた度」
    var s = P.stats[id];
    if (!s || (s.ok + s.ng) === 0) return 0;
    var rate = s.ok / (s.ok + s.ng);
    var exp = Math.min(1, (s.ok + s.ng) / 4);   // 4回以上やって初めて満点あつかい
    return rate * exp;
  }
  function weakness(id) {             // 大きいほど苦手
    var s = P.stats[id];
    if (!s || (s.ok + s.ng) === 0) return 0.7;  // まだやっていない国は少し優先
    return (s.ng + 0.5) / (s.ok + s.ng + 0.5);
  }

  /* ============================================================
     地図（正距円筒図法・パン／ズームつき）
     ============================================================ */
  function createMap(host, opt) {
    opt = opt || {};
    var W = MAP.meta.w, H = MAP.meta.h, S = MAP.meta.scale, LON0 = MAP.meta.lon0, LATT = MAP.meta.latTop;
    var view = { x: 0, y: 0, w: W };
    var lands = {}, hits = {}, anim = null;

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'map');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', opt.role || 'img');
    if (opt.label) svg.setAttribute('aria-label', opt.label);

    // 緯線（赤道・回帰線）と本初子午線
    var gGrid = document.createElementNS(NS, 'g');
    [[0, 'equator'], [23.44, ''], [-23.44, '']].forEach(function (t) {
      var y = (LATT - t[0]) * S;
      var l = document.createElementNS(NS, 'path');
      l.setAttribute('d', 'M0 ' + y.toFixed(1) + 'H' + W);
      l.setAttribute('class', 'grid ' + t[1]);
      gGrid.appendChild(l);
    });
    var mer = document.createElementNS(NS, 'path');
    mer.setAttribute('d', 'M' + ((0 - LON0) * S).toFixed(1) + ' 0V' + H);
    mer.setAttribute('class', 'grid');
    gGrid.appendChild(mer);

    var gLand = document.createElementNS(NS, 'g');
    var gHit = document.createElementNS(NS, 'g');
    var gPin = document.createElementNS(NS, 'g');

    Object.keys(MAP.paths).forEach(function (id) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', MAP.paths[id]);
      p.setAttribute('class', 'land' + (TARGET[id] ? ' tgt' : ''));
      gLand.appendChild(p);
      if (TARGET[id]) lands[id] = p;
    });

    // クリック判定用の透明レイヤー。
    // 下段＝輪郭を太らせた線（小さい国でも押しやすくする）、上段＝国の面そのもの。
    // 面を上に重ねることで、となりの国の「太らせた線」に自分の国土を取られないようにする。
    var bySize = DATA.slice().sort(function (a, b) { return (MAP.areas[b.id] || 0) - (MAP.areas[a.id] || 0); });
    bySize.forEach(function (c) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', MAP.paths[c.id]);
      p.setAttribute('class', 'hit hit-edge');
      p.setAttribute('aria-hidden', 'true');
      p.dataset.id = c.id;
      gHit.appendChild(p);
    });
    bySize.forEach(function (c) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', MAP.paths[c.id]);
      p.setAttribute('class', 'hit hit-area');
      p.setAttribute('tabindex', '-1');
      p.setAttribute('role', 'button');
      p.setAttribute('aria-label', c.ja);
      p.dataset.id = c.id;
      gHit.appendChild(p);
      hits[c.id] = p;
    });

    svg.appendChild(gGrid); svg.appendChild(gLand); svg.appendChild(gHit); svg.appendChild(gPin);
    host.appendChild(svg);

    /* --- 表示範囲 --- */
    function clamp(v) {
      var w = Math.max(40, Math.min(W, v.w));
      var h = w * H / W;
      return { x: Math.max(0, Math.min(W - w, v.x)), y: Math.max(0, Math.min(H - h, v.y)), w: w };
    }
    function apply() {
      var h = view.w * H / W;
      svg.setAttribute('viewBox', view.x.toFixed(2) + ' ' + view.y.toFixed(2) + ' ' + view.w.toFixed(2) + ' ' + h.toFixed(2));
      var k = view.w / W;
      $$('.pin-dot', svg).forEach(function (e) { e.setAttribute('r', (4 * k).toFixed(2)); });
      $$('.pin-ring', svg).forEach(function (e) { e.setAttribute('r', (9 * k).toFixed(2)); });
      $$('.pin-label', svg).forEach(function (e) {
        e.setAttribute('font-size', (12 * k).toFixed(2));
        e.setAttribute('y', (parseFloat(e.dataset.y) - 8 * k).toFixed(2));
      });
      $$('.hit-edge', svg).forEach(function (e) { e.setAttribute('stroke-width', (6 * k).toFixed(2)); });
    }
    function setView(v, animate) {
      var t = clamp(v);
      if (anim) { cancelAnimationFrame(anim); anim = null; }
      if (!animate) { view = t; apply(); return; }
      var from = { x: view.x, y: view.y, w: view.w }, t0 = performance.now(), dur = 480;
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur);
        var e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        view = { x: from.x + (t.x - from.x) * e, y: from.y + (t.y - from.y) * e, w: from.w + (t.w - from.w) * e };
        apply();
        if (p < 1) anim = requestAnimationFrame(step); else anim = null;
      })(t0);
    }
    function project(lon, lat) { return { x: (lon - LON0) * S, y: (LATT - lat) * S }; }
    function fitBox(box, pad, minW, animate) {
      var bw = box[2] - box[0], bh = box[3] - box[1];
      var w = Math.max(bw, bh * W / H) * (1 + (pad === undefined ? .8 : pad));
      w = Math.max(minW || 110, Math.min(W, w));
      var cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
      setView({ x: cx - w / 2, y: cy - (w * H / W) / 2, w: w }, animate !== false);
    }
    function focusCountry(id, animate) {
      var box = MAP.boxes[id];
      if (!box) return;
      // 島や飛び地で横に広がりすぎる国は、首都のまわりを見せる
      var c = TARGET[id];
      if (c && (box[2] - box[0]) > 420) {
        var p = project(c.lon, c.lat);
        var w = Math.min(W, Math.max(340, (box[2] - box[0]) * 0.55));
        setView({ x: p.x - w / 2, y: p.y - (w * H / W) / 2, w: w }, animate !== false);
      } else {
        fitBox(box, 1.1, 130, animate);
      }
    }
    function reset(animate) { setView({ x: 0, y: 0, w: W }, animate !== false); }

    /* --- 見た目の状態 --- */
    function clearStates() {
      Object.keys(lands).forEach(function (id) { lands[id].setAttribute('class', 'land tgt'); });
    }
    function clearHover() {
      Object.keys(lands).forEach(function (id) { lands[id].classList.remove('is-hover'); });
    }
    function setState(id, state) {   // 'is-focus' | 'is-correct' | 'is-wrong' | null
      if (!lands[id]) return;
      lands[id].setAttribute('class', 'land tgt' + (state ? ' ' + state : ''));
    }
    function paintLearned(on) {
      Object.keys(lands).forEach(function (id) {
        var cls = 'land tgt';
        if (on && mastery(id) >= 0.75) cls += ' learned';
        lands[id].setAttribute('class', cls);
      });
    }
    function clearPins() { while (gPin.firstChild) gPin.removeChild(gPin.firstChild); }
    function addPin(c, label) {
      var p = project(c.lon, c.lat);
      var ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('class', 'pin-ring');
      ring.setAttribute('cx', p.x.toFixed(1)); ring.setAttribute('cy', p.y.toFixed(1));
      var dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('class', 'pin-dot');
      dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1));
      gPin.appendChild(ring); gPin.appendChild(dot);
      if (label) {
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('class', 'pin-label');
        t.setAttribute('x', p.x.toFixed(1));
        t.setAttribute('text-anchor', p.x > MAP.meta.w * 0.86 ? 'end' : (p.x < MAP.meta.w * 0.14 ? 'start' : 'middle'));
        t.dataset.y = p.y;
        t.setAttribute('y', p.y.toFixed(1));
        t.textContent = label;
        gPin.appendChild(t);
      }
      apply();
    }

    /* --- 操作（ドラッグ／ホイール／ピンチ／クリック） --- */
    var pointers = {}, dragging = false, moved = 0, last = null, pinchDist = 0;
    function toUser(ev) {   // 画面座標 → 地図座標（拡大率や余白に左右されない）
      var ctm = svg.getScreenCTM();
      if (!ctm) {
        var r = svg.getBoundingClientRect();
        return { x: view.x + (ev.clientX - r.left) / r.width * view.w, y: view.y + (ev.clientY - r.top) / r.height * (view.w * H / W) };
      }
      var pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      var u = pt.matrixTransform(ctm.inverse());
      return { x: u.x, y: u.y };
    }
    function pxToUser() {   // 画面1pxが地図座標でいくつ分か
      var ctm = svg.getScreenCTM();
      if (ctm && ctm.a) return 1 / ctm.a;
      var r = svg.getBoundingClientRect();
      return r.width ? view.w / r.width : 1;
    }
    svg.addEventListener('pointerdown', function (ev) {
      // タッチ操作では、あとから合成される互換マウスクリックが
      // （地図が動いたあとの）別の要素に当たってしまうので止めておく
      if (ev.pointerType === 'touch' && ev.cancelable) ev.preventDefault();
      pointers[ev.pointerId] = ev;
      svg.setPointerCapture(ev.pointerId);
      if (Object.keys(pointers).length === 1) { dragging = true; moved = 0; last = { x: ev.clientX, y: ev.clientY }; }
      else { dragging = false; pinchDist = 0; }
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = ev;
      var ids = Object.keys(pointers);
      if (ids.length >= 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchDist) {
          var r = svg.getBoundingClientRect();
          var mid = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
          var u = toUser(mid);
          var nw = clamp({ x: 0, y: 0, w: view.w * (pinchDist / d) }).w;
          var f = nw / view.w;
          setView({ x: u.x - (u.x - view.x) * f, y: u.y - (u.y - view.y) * f, w: nw }, false);
        }
        pinchDist = d;
        moved = 99;
        return;
      }
      if (!dragging || !last) return;
      var k = pxToUser();
      var dx = (ev.clientX - last.x) * k;
      var dy = (ev.clientY - last.y) * k;
      moved += Math.abs(ev.clientX - last.x) + Math.abs(ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY };
      setView({ x: view.x - dx, y: view.y - dy, w: view.w }, false);
    });
    function endPointer(ev) {
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length === 0) { dragging = false; last = null; pinchDist = 0; }
    }
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var u = toUser(ev);
      var nw = clamp({ x: 0, y: 0, w: view.w * Math.exp(ev.deltaY * 0.0012) }).w;
      var f = nw / view.w;
      setView({ x: u.x - (u.x - view.x) * f, y: u.y - (u.y - view.y) * f, w: nw }, false);
    }, { passive: false });

    var pickHandler = null;
    // ポインターキャプチャ中は click の発火先が svg になるため、pointerup の位置から国を判定する
    function hitAt(cx, cy) {
      var el = document.elementFromPoint(cx, cy);
      var t = el && el.closest ? el.closest('.hit') : null;
      return t && t.dataset.id ? t.dataset.id : null;
    }
    function pickAt(cx, cy) {
      // ぴったり陸地を押せなくても（海岸線ぎりぎり・小さい島など）、
      // 少しはなれた場所まで探して近くの国をひろう
      var id = hitAt(cx, cy);
      if (id) return id;
      for (var r = 7; r <= 21; r += 7) {
        for (var a = 0; a < 8; a++) {
          var th = a * Math.PI / 4;
          id = hitAt(cx + Math.cos(th) * r, cy + Math.sin(th) * r);
          if (id) return id;
        }
      }
      return null;
    }
    svg.addEventListener('pointerup', function (ev) {
      if (!pickHandler || moved > 8 || Object.keys(pointers).length > 1) return;
      var id = pickAt(ev.clientX, ev.clientY);
      if (id) pickHandler(id);
    });
    gHit.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var t = ev.target.closest ? ev.target.closest('.hit') : null;
      if (!t || !pickHandler) return;
      ev.preventDefault();
      pickHandler(t.dataset.id);
    });
    gHit.addEventListener('pointerover', function (ev) {
      if (ev.pointerType && ev.pointerType !== 'mouse') return;   // 指のタップで色が残らないように
      var t = ev.target.closest ? ev.target.closest('.hit') : null;
      if (t && lands[t.dataset.id] && svg.classList.contains('pickable')) lands[t.dataset.id].classList.add('is-hover');
    });
    gHit.addEventListener('pointerout', function (ev) {
      var t = ev.target.closest ? ev.target.closest('.hit') : null;
      if (t && lands[t.dataset.id]) lands[t.dataset.id].classList.remove('is-hover');
    });

    /* --- ズームボタン --- */
    if (opt.tools !== false) {
      var tools = document.createElement('div');
      tools.className = 'map-tools';
      var tl = document.createElement('span');
      tl.className = 'tools-label';
      tl.textContent = '地図はドラッグで移動、ボタンや指2本で拡大・縮小できます';
      tools.appendChild(tl);
      [['＋', 'ズームイン', function () { zoomBy(1 / 1.6); }],
       ['−', 'ズームアウト', function () { zoomBy(1.6); }],
       ['全体', '地図全体を表示', function () { reset(true); }]].forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = t[0]; b.title = t[1];
        b.setAttribute('aria-label', t[1]);
        if (t[0] === '全体') b.className = 'wide';
        b.addEventListener('click', t[2]);
        tools.appendChild(b);
      });
      host.insertAdjacentElement('afterend', tools);
    }
    function zoomBy(f) {
      var cx = view.x + view.w / 2, cy = view.y + (view.w * H / W) / 2;
      var nw = clamp({ x: 0, y: 0, w: view.w * f }).w;
      setView({ x: cx - nw / 2, y: cy - (nw * H / W) / 2, w: nw }, true);
    }

    return {
      svg: svg,
      project: project,
      focusCountry: focusCountry,
      reset: reset,
      clearStates: clearStates,
      setState: setState,
      paintLearned: paintLearned,
      clearPins: clearPins,
      addPin: addPin,
      clearHover: clearHover,
      setPickable: function (on, handler) {
        svg.classList.toggle('pickable', !!on);
        clearHover();
        pickHandler = on ? handler : null;
        $$('.hit-area', svg).forEach(function (e) { e.setAttribute('tabindex', on ? '0' : '-1'); });
      }
    };
  }

  /* ============================================================
     ユーティリティ
     ============================================================ */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function sample(arr, n, exclude) {
    var pool = arr.filter(function (c) { return c !== exclude; });
    return shuffle(pool.slice()).slice(0, n);
  }

  /* ============================================================
     ずかん（さがす・おぼえる）
     ============================================================ */
  var zMap, zSelected = null, zRegion = 'ぜんぶ';

  function initZukan() {
    zMap = createMap($('#zukan-map'), { label: '世界地図。国をタップすると、その国の首都がわかります。' });
    zMap.setPickable(true, function (id) { selectCountry(id, true); });
    zMap.paintLearned(true);

    var chips = $('#zukan-regions');
    ['ぜんぶ'].concat(REGIONS).forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = r;
      b.setAttribute('aria-pressed', String(r === zRegion));
      b.addEventListener('click', function () {
        zRegion = r;
        $$('button', chips).forEach(function (x) { x.setAttribute('aria-pressed', String(x.textContent === r)); });
        renderZukanList();
      });
      chips.appendChild(b);
    });

    $('#toggle-cap').addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') === 'true';
      this.setAttribute('aria-pressed', String(!on));
      this.textContent = !on ? '首都を表示する' : '首都をかくす';
      $('#zukan-list').classList.toggle('hide-cap', !on);
    });

    renderZukanList();
    var first = DATA.filter(function (c) { return c.ja === '日本'; })[0] || DATA[0];
    selectCountry(first.id, false);   // 最初は日本を表示（自分の国を基準にすると位置をつかみやすい）
  }

  function renderZukanList() {
    var list = $('#zukan-list');
    list.innerHTML = '';
    DATA.filter(function (c) { return zRegion === 'ぜんぶ' || c.region === zRegion; })
      .forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.id = c.id;
        b.setAttribute('aria-current', String(c.id === zSelected));
        b.innerHTML = '<span class="cname"></span><span class="ccap"></span>';
        $('.cname', b).textContent = c.ja;
        $('.ccap', b).textContent = c.cap;
        b.addEventListener('click', function () { selectCountry(c.id, true); });
        list.appendChild(b);
      });
    $('#zukan-count').textContent = list.children.length + 'か国';
  }

  function selectCountry(id, animate) {
    var c = TARGET[id];
    if (!c) return;
    zSelected = id;
    var list = $('#zukan-list');
    $$('button', list).forEach(function (b) {
      var on = b.dataset.id === id;
      b.setAttribute('aria-current', String(on));
      if (!on) return;
      // ページ全体は動かさず、リストの中だけをスクロールする
      var top = b.offsetTop, bottom = top + b.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top - 6;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6;
    });
    zMap.paintLearned(true);
    zMap.setState(id, 'is-focus');
    zMap.clearPins();
    zMap.addPin(c, c.cap);
    zMap.focusCountry(id, animate);

    var s = P.stats[id] || { ok: 0, ng: 0 };
    var d = $('#zukan-detail');
    d.innerHTML =
      '<div class="big"></div>' +
      '<dl>' +
        '<dt>首都</dt><dd class="cap"></dd>' +
        '<dt>地域</dt><dd class="reg"></dd>' +
        '<dt>位置</dt><dd class="pos"></dd>' +
        '<dt>成績</dt><dd class="rec"></dd>' +
      '</dl>' +
      '<p class="memo"><b>おぼえかた：</b><span class="goro"></span></p>' +
      '<p class="hint memo2"></p>' +
      '<p class="hint trap"></p>';
    $('.big', d).textContent = c.ja;
    $('.cap', d).textContent = c.cap;
    $('.reg', d).textContent = c.region;
    $('.pos', d).textContent = fmtLatLon(c.lat, c.lon) + '（首都の位置）';
    $('.rec', d).textContent = (s.ok + s.ng) === 0 ? 'まだ出題されていません'
      : '正解 ' + s.ok + ' / 出題 ' + (s.ok + s.ng) + '（' + Math.round(s.ok / (s.ok + s.ng) * 100) + '%）';
    $('.goro', d).textContent = c.goro;
    $('.memo2', d).textContent = c.memo;
    $('.trap', d).textContent = c.trap ? '⚠ ' + c.trap : '';
  }

  function fmtLatLon(lat, lon) {
    return (lat >= 0 ? '北緯' : '南緯') + Math.abs(lat).toFixed(1) + '度、' +
           (lon >= 0 ? '東経' : '西経') + Math.abs(lon).toFixed(1) + '度';
  }

  /* ============================================================
     クイズ
     ============================================================ */
  var TYPES = {
    c2cap: { label: '国 ➜ 首都', map: false },
    cap2c: { label: '首都 ➜ 国', map: false },
    map2c: { label: '地図 ➜ 国名', map: true },
    find:  { label: '国名 ➜ 地図', map: true }
  };
  var cfg = { types: ['c2cap', 'cap2c', 'find'], regions: REGIONS.slice(), count: 10, weak: true };
  var qMap, quiz = null;

  function initQuiz() {
    qMap = createMap($('#quiz-map'), { label: 'クイズ用の世界地図' });

    var tc = $('#q-types');
    Object.keys(TYPES).forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = TYPES[k].label; b.dataset.k = k;
      b.setAttribute('aria-pressed', String(cfg.types.indexOf(k) >= 0));
      b.addEventListener('click', function () {
        var i = cfg.types.indexOf(k);
        if (i >= 0) { if (cfg.types.length === 1) return; cfg.types.splice(i, 1); }
        else cfg.types.push(k);
        b.setAttribute('aria-pressed', String(cfg.types.indexOf(k) >= 0));
      });
      tc.appendChild(b);
    });

    var rc = $('#q-regions');
    var all = document.createElement('button');
    all.type = 'button'; all.textContent = 'ぜんぶ'; all.setAttribute('aria-pressed', 'true');
    all.addEventListener('click', function () {
      cfg.regions = REGIONS.slice();
      $$('button', rc).forEach(function (x) { x.setAttribute('aria-pressed', String(x === all || true)); });
      $$('button', rc).forEach(function (x) { x.setAttribute('aria-pressed', 'true'); });
    });
    rc.appendChild(all);
    REGIONS.forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = r; b.dataset.r = r;
      b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', function () {
        var i = cfg.regions.indexOf(r);
        if (i >= 0) { if (cfg.regions.length === 1) return; cfg.regions.splice(i, 1); }
        else cfg.regions.push(r);
        b.setAttribute('aria-pressed', String(cfg.regions.indexOf(r) >= 0));
        all.setAttribute('aria-pressed', String(cfg.regions.length === REGIONS.length));
      });
      rc.appendChild(b);
    });

    var cc = $('#q-count');
    [[10, '10問'], [20, '20問'], [0, '全部の国']].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = t[1]; b.dataset.n = t[0];
      b.setAttribute('aria-pressed', String(cfg.count === t[0]));
      b.addEventListener('click', function () {
        cfg.count = t[0];
        $$('button', cc).forEach(function (x) { x.setAttribute('aria-pressed', String(Number(x.dataset.n) === cfg.count)); });
      });
      cc.appendChild(b);
    });

    $('#q-weak').addEventListener('click', function () {
      cfg.weak = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', String(cfg.weak));
    });
    $('#btn-start').addEventListener('click', function () { startQuiz(null); });
    $('#btn-next').addEventListener('click', nextQuestion);
    $('#btn-again').addEventListener('click', function () { startQuiz(null); });
    $('#btn-retry-miss').addEventListener('click', function () {
      var miss = quiz.results.filter(function (r) { return !r.ok; }).map(function (r) { return r.c; });
      startQuiz(uniq(miss));
    });
    $('#btn-back-setup').addEventListener('click', showSetup);
    $('#btn-setup-again').addEventListener('click', showSetup);

    document.addEventListener('keydown', function (ev) {
      if ($('#panel-quiz').hidden || !quiz || quiz.done) return;
      if (ev.key >= '1' && ev.key <= '4') {
        var b = $$('#q-choices button')[Number(ev.key) - 1];
        if (b && !b.disabled) b.click();
      } else if (ev.key === 'Enter' && !$('#btn-next').hidden) {
        ev.preventDefault(); $('#btn-next').click();
      }
    });
  }

  function uniq(arr) { var s = []; arr.forEach(function (c) { if (s.indexOf(c) < 0) s.push(c); }); return s; }

  function showSetup() {
    $('#quiz-setup').hidden = false;
    $('#quiz-play').hidden = true;
    $('#quiz-result').hidden = true;
    quiz = null;
  }

  function startQuiz(fixedList) {
    var pool = fixedList && fixedList.length ? fixedList.slice()
      : DATA.filter(function (c) { return cfg.regions.indexOf(c.region) >= 0; });
    if (!pool.length) pool = DATA.slice();
    var n = fixedList && fixedList.length ? pool.length : (cfg.count === 0 ? pool.length : cfg.count);

    var order;
    if (cfg.weak && !fixedList) {
      order = pool.slice().sort(function (a, b) { return weakness(b.id) - weakness(a.id) + (Math.random() - .5) * .3; });
      order = shuffle(order.slice(0, Math.max(n, Math.min(pool.length, 12))));
    } else {
      order = shuffle(pool.slice());
    }

    var qs = [], i = 0;
    while (qs.length < n) {
      if (i >= order.length) { order = shuffle(order); i = 0; }
      var c = order[i++];
      if (qs.length && qs[qs.length - 1].c === c && order.length > 1) { continue; }
      qs.push(makeQuestion(c, pool));
    }

    quiz = { qs: qs, i: 0, results: [], done: false };
    $('#quiz-setup').hidden = true;
    $('#quiz-result').hidden = true;
    $('#quiz-play').hidden = false;
    P.quizzes++; saveProgress();
    showQuestion();
  }

  function makeQuestion(c, pool) {
    var type = cfg.types[Math.floor(Math.random() * cfg.types.length)];
    var q = { c: c, type: type };
    if (type === 'find') return q;
    // まぎらわしい選択肢は、まず同じ地域から選ぶ
    var same = DATA.filter(function (x) { return x.region === c.region && x !== c; });
    var others = DATA.filter(function (x) { return x.region !== c.region && x !== c; });
    var dist = sample(same, 3).concat(sample(others, 3)).slice(0, 3);
    var opts = shuffle(dist.concat([c]));
    q.options = opts;
    q.answer = opts.indexOf(c);
    return q;
  }

  function showQuestion() {
    var q = quiz.qs[quiz.i];
    var c = q.c;
    var useMap = TYPES[q.type].map;

    $('#q-count-label').textContent = (quiz.i + 1) + ' / ' + quiz.qs.length + '問目';
    $('#q-bar').style.width = (quiz.i / quiz.qs.length * 100) + '%';
    var ok = quiz.results.filter(function (r) { return r.ok; }).length;
    $('#q-score').innerHTML = '<span class="ok">○ ' + ok + '</span>　<span class="ng">× ' + (quiz.results.length - ok) + '</span>';
    $('#q-type-label').textContent = TYPES[q.type].label;
    $('#q-judge').hidden = true;
    $('#q-judge').className = 'judge';
    $('#q-judge').innerHTML = '';   // 前の問題の○×を残さない
    $('#btn-next').hidden = true;

    $('#quiz-map-box').hidden = !useMap;
    qMap.clearStates(); qMap.clearPins(); qMap.setPickable(false);

    var qEl = $('#q-question');
    if (q.type === 'c2cap') {
      qEl.innerHTML = '<span class="em"></span> の首都はどこ？';
      $('.em', qEl).textContent = c.ja;
    } else if (q.type === 'cap2c') {
      qEl.innerHTML = '<span class="em"></span> が首都の国は？';
      $('.em', qEl).textContent = c.cap;
    } else if (q.type === 'map2c') {
      qEl.innerHTML = '地図で<span class="em">オレンジ色</span>の国はどこ？';
      qMap.setState(c.id, 'is-focus');
      qMap.focusCountry(c.id, true);
    } else {
      qEl.innerHTML = '<span class="em"></span> はどこ？　地図をクリック（タップ）してね';
      $('.em', qEl).textContent = c.ja;
      qMap.reset(true);
      qMap.setPickable(true, function (id) { answerMap(id); });
    }

    var ch = $('#q-choices');
    ch.innerHTML = '';
    if (q.type === 'find') { ch.hidden = true; return; }
    ch.hidden = false;
    q.options.forEach(function (o, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="num">' + (idx + 1) + '</span><span class="t"></span>';
      $('.t', b).textContent = (q.type === 'c2cap') ? o.cap : o.ja;
      b.addEventListener('click', function () { answerChoice(idx); });
      ch.appendChild(b);
    });
  }

  function answerChoice(idx) {
    var q = quiz.qs[quiz.i];
    var ok = idx === q.answer;
    $$('#q-choices button').forEach(function (b, i) {
      b.disabled = true;
      if (i === q.answer) b.classList.add('correct');
      else if (i === idx) b.classList.add('wrong');
    });
    finishQuestion(ok, q.options[idx]);
  }

  function answerMap(id) {
    var q = quiz.qs[quiz.i];
    var ok = id === q.c.id;
    qMap.setPickable(false);
    if (!ok) qMap.setState(id, 'is-wrong');
    qMap.setState(q.c.id, ok ? 'is-correct' : 'is-focus');
    finishQuestion(ok, TARGET[id]);
  }

  function finishQuestion(ok, chosen) {
    var q = quiz.qs[quiz.i], c = q.c;
    record(c.id, ok);
    quiz.results.push({ c: c, ok: ok, type: q.type });

    if (TYPES[q.type].map || true) {
      // 正解の場所と首都を見せて、位置とセットで記憶に残す
      $('#quiz-map-box').hidden = false;
      qMap.clearStates();
      qMap.setState(c.id, ok ? 'is-correct' : 'is-focus');
      if (!ok && chosen && chosen.id !== c.id) qMap.setState(chosen.id, 'is-wrong');
      qMap.clearPins();
      qMap.addPin(c, c.cap);
      qMap.focusCountry(c.id, true);
    }

    var j = $('#q-judge');
    j.hidden = false;
    j.className = 'judge ' + (ok ? 'ok' : 'ng');
    j.innerHTML = '<span class="mark"></span><span class="txt"></span>';
    $('.mark', j).textContent = ok ? '○' : '×';
    var t = $('.txt', j);
    var html = ok ? '<b>せいかい！</b><br>' : '<b>おしい！</b> ';
    if (!ok && chosen && chosen !== c) {
      html += '選んだのは' + (q.type === 'c2cap' ? esc(chosen.cap) + '（' + esc(chosen.ja) + 'の首都）' : esc(chosen.ja)) + 'でした。<br>';
    } else if (!ok) { html += '<br>'; }
    html += esc(c.ja) + ' の首都は <b>' + esc(c.cap) + '</b>（' + esc(c.region) + '）<br>' +
            '💡 ' + esc(c.goro);
    if (!ok && c.trap) html += '<br>⚠ ' + esc(c.trap);
    t.innerHTML = html;

    if (j.scrollIntoView) j.scrollIntoView({ block: 'nearest' });

    var b = $('#btn-next');
    b.hidden = false;
    b.textContent = (quiz.i + 1 >= quiz.qs.length) ? '結果を見る' : '次の問題へ →';
    b.focus();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

  function nextQuestion() {
    if (quiz.i + 1 >= quiz.qs.length) { showResult(); return; }
    quiz.i++;
    showQuestion();
  }

  function showResult() {
    quiz.done = true;
    $('#quiz-play').hidden = true;
    $('#quiz-result').hidden = false;
    var ok = quiz.results.filter(function (r) { return r.ok; }).length;
    var n = quiz.results.length;
    var rate = Math.round(ok / n * 100);
    $('#r-score').textContent = ok + ' / ' + n + '問　' + rate + '%';
    var stars = rate >= 90 ? 3 : rate >= 70 ? 2 : rate >= 50 ? 1 : 0;
    $('#r-stars').textContent = '★★★☆☆☆'.slice(3 - stars, 6 - stars);
    $('#r-msg').textContent = rate === 100 ? 'パーフェクト！ 世界がまるごと頭に入ったね' :
      rate >= 90 ? 'すばらしい！ ほとんど覚えられているよ' :
      rate >= 70 ? 'いい調子！ まちがえた国をもう一度やってみよう' :
      rate >= 50 ? 'あと少し。まちがえた国だけ復習すると伸びるよ' :
      'まずは「ずかん」で場所と首都をながめてみよう';

    var miss = uniq(quiz.results.filter(function (r) { return !r.ok; }).map(function (r) { return r.c; }));
    var ul = $('#r-miss');
    ul.innerHTML = '';
    miss.forEach(function (c) {
      var li = document.createElement('li');
      li.textContent = c.ja + ' → ' + c.cap + '（💡 ' + c.goro + '）';
      ul.appendChild(li);
    });
    $('#r-miss-wrap').hidden = miss.length === 0;
    $('#btn-retry-miss').hidden = miss.length === 0;
    renderRecords();
  }

  /* ============================================================
     きろく
     ============================================================ */
  function initRecords() {
    $('#btn-reset').addEventListener('click', function () {
      if (!confirm('これまでの成績をぜんぶ消します。よろしいですか？')) return;
      P = { v: 1, stats: {}, total: { ok: 0, ng: 0 }, streak: 0, bestStreak: 0, quizzes: 0 };
      saveProgress();
      renderRecords();
      if (zMap) zMap.paintLearned(true);
    });
    $('#record-sort').addEventListener('change', renderRecords);
    renderRecords();
  }

  function renderRecords() {
    var total = P.total.ok + P.total.ng;
    $('#stat-total').textContent = total;
    $('#stat-rate').textContent = total ? Math.round(P.total.ok / total * 100) + '%' : '—';
    $('#stat-streak').textContent = P.bestStreak;
    var learned = DATA.filter(function (c) { return mastery(c.id) >= 0.75; }).length;
    $('#stat-learned').textContent = learned + ' / ' + DATA.length;

    var mode = $('#record-sort').value;
    var list = DATA.slice();
    if (mode === 'weak') list.sort(function (a, b) { return weakness(b.id) - weakness(a.id) || (P.stats[b.id] ? 1 : 0) - (P.stats[a.id] ? 1 : 0); });
    else if (mode === 'region') list.sort(function (a, b) { return REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region); });

    var tb = $('#record-body');
    tb.innerHTML = '';
    list.forEach(function (c) {
      var s = P.stats[c.id] || { ok: 0, ng: 0 };
      var n = s.ok + s.ng;
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="n"></td><td class="cap"></td><td class="num"></td>' +
        '<td class="num"><span class="mastery"><i></i></span></td>';
      $('.n', tr).textContent = c.ja;
      $('.cap', tr).textContent = c.cap;
      $$('.num', tr)[0].textContent = n ? s.ok + '/' + n : '—';
      $('.mastery i', tr).style.width = Math.round(mastery(c.id) * 100) + '%';
      tb.appendChild(tr);
    });
  }

  /* ============================================================
     おぼえかたのコツ（データから表をつくる）
     ============================================================ */
  function initTips() {
    var traps = DATA.filter(function (c) { return c.trap && /首都ではない|首都は3つ/.test(c.trap); });
    var ul = $('#trap-list');
    traps.forEach(function (c) {
      var li = document.createElement('li');
      li.innerHTML = '<b></b> … <span></span>';
      $('b', li).textContent = c.ja + '＝' + c.cap;
      $('span', li).textContent = c.trap;
      ul.appendChild(li);
    });
    var tb = $('#goro-body');
    DATA.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="n"></td><td class="cap"></td><td class="g"></td>';
      $('.n', tr).textContent = c.ja;
      $('.cap', tr).textContent = c.cap;
      $('.g', tr).textContent = c.goro;
      tb.appendChild(tr);
    });
  }

  /* ============================================================
     タブ切りかえ
     ============================================================ */
  function initTabs() {
    $$('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        var tab = b.dataset.tab;
        $$('nav.tabs button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
        $$('.panel').forEach(function (p) { p.hidden = (p.id !== 'panel-' + tab); });
        if (tab === 'kiroku') renderRecords();
        if (tab === 'zukan' && zMap) zMap.paintLearned(true);
        if (tab === 'zukan' && zSelected) zMap.setState(zSelected, 'is-focus');
        location.hash = tab;
      });
    });
    var h = (location.hash || '').replace('#', '');
    var target = $$('nav.tabs button').filter(function (b) { return b.dataset.tab === h; })[0];
    if (target) target.click();
  }

  /* ============================================================
     スタート
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {
    initZukan();
    initQuiz();
    initRecords();
    initTips();
    initTabs();
  });
})();
