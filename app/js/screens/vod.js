/* Pantalla "Películas y series": filas de carátulas (Continuar viendo, Jellyfin y listas M3U). */
var VodScreen = (function () {
  'use strict';
  var S = { id: 'vod' };
  var rowsZ, emptyZ, zone = null, rows = [], els = {};
  var jf = { resume: [], movies: [], series: [], state: 'none', error: '', t: 0 };

  function setZone(z) {
    if (zone && zone !== z) zone.blur();
    zone = z;
    if (App.cur === S && !App.inMenu) z.focus();
  }
  function act(name) {
    return function () {
      var z = name === 'rows' ? rowsZ : emptyZ;
      App.takeFocus(S);
      if (zone !== z) setZone(z); else if (!z.active) z.focus();
    };
  }
  function position(it) {
    if (it.source === 'jellyfin') return it.position || 0;
    var r = Resume.get(it.id);
    return r ? r.pos : 0;
  }
  function duration(it) {
    if (it.runtime) return it.runtime;
    var r = Resume.get(it.id);
    return r ? r.dur : 0;
  }
  S.position = position;
  S.duration = duration;

  S.init = function () {
    S.el = U.$('#screen-vod');
    S.el.innerHTML =
      '<div class="backdrop" id="vod-bd"></div><div class="backdrop-fade"></div>' +
      '<div class="scr-head"><div class="scr-title">Películas y series</div><div class="scr-sub" id="vod-sub"></div><div class="clock"></div></div>' +
      '<div class="vod-hero" id="vod-hero"><div class="vh-title" id="vh-title"></div><div class="vh-meta" id="vh-meta"></div><div class="vh-desc" id="vh-desc"></div></div>' +
      '<div class="vod-rows" id="vod-rows"></div>' +
      '<div class="empty hidden" id="vod-empty"><div class="empty-title">Aún no tienes películas ni series</div>' +
        '<div class="empty-text">Conecta tu servidor Jellyfin, agrega una lista M3U de películas de tu proveedor o prueba la demostración con cortometrajes libres.</div>' +
        '<div class="empty-err" id="vod-err"></div>' +
        '<div class="btn focusable" data-id="jf">Conectar Jellyfin</div>' +
        '<div class="btn focusable" data-id="m3u">Agregar lista de películas</div>' +
        '<div class="btn focusable" data-id="demo">Probar la demostración</div></div>' +
      '<div class="loading hidden" id="vod-loading"><div class="spin"></div><div>Cargando catálogo…</div></div>';
    els.bd = U.$('#vod-bd');
    els.sub = U.$('#vod-sub');
    els.hero = U.$('#vod-hero');
    els.hTitle = U.$('#vh-title');
    els.hMeta = U.$('#vh-meta');
    els.hDesc = U.$('#vh-desc');
    els.rows = U.$('#vod-rows');
    els.empty = U.$('#vod-empty');
    els.err = U.$('#vod-err');
    els.loading = U.$('#vod-loading');

    rowsZ = new RowsZone({
      el: els.rows, rowHeight: 360, cardWidth: 206, visibleCards: 8,
      rows: function () { return rows; },
      renderCard: renderCard,
      onFocus: updateHero,
      onSelect: function (it) { App.go('detail', { item: it }); },
      activate: act('rows')
    });
    emptyZ = new FormZone(els.empty, { activate: act('empty') });
    U.$('[data-id="jf"]', S.el).addEventListener('click', function () { App.go('settings', { focus: 'jf-server' }); });
    U.$('[data-id="m3u"]', S.el).addEventListener('click', function () { App.go('settings', { focus: 'vod-url' }); });
    U.$('[data-id="demo"]', S.el).addEventListener('click', function () { SettingsScreen.loadDemo(); });

    Data.on('vod', function () { if (App.cur === S) rebuild(); });
    Data.on('jellyfin', function () { jf.t = 0; if (App.cur === S) loadJf(); });
  };

  function loadJf() {
    if (!Jellyfin.isConnected()) {
      jf.resume = [];
      jf.movies = [];
      jf.series = [];
      jf.state = 'none';
      rebuild();
      return;
    }
    jf.state = 'loading';
    updateState();
    Promise.all([Jellyfin.resume(), Jellyfin.movies(), Jellyfin.series()]).then(function (r) {
      jf.resume = r[0];
      jf.movies = r[1];
      jf.series = r[2];
      jf.state = 'ready';
      jf.error = '';
      jf.t = Date.now();
      rebuild();
    }, function (e) {
      jf.state = 'error';
      jf.error = e.status === 401 ? 'la sesión caducó, vuelve a conectar en Ajustes' : e.message;
      rebuild();
    });
  }

  function buildRows() {
    var out = [], cont = [];
    jf.resume.forEach(function (it) { cont.push(it); });
    Resume.list().forEach(function (r) {
      cont.push({ id: r.id, source: 'm3u', type: 'video', title: r.title, poster: r.poster, url: r.url, group: r.group,
        overview: r.overview, year: r.year, runtime: r.dur });
    });
    if (cont.length) out.push({ title: 'Continuar viendo', items: cont });
    if (jf.movies.length) out.push({ title: 'Películas · Jellyfin', items: jf.movies });
    if (jf.series.length) out.push({ title: 'Series · Jellyfin', items: jf.series });
    Data.vodGroups.concat(Data.liveVodGroups || []).forEach(function (g) { if (g.items.length) out.push({ title: g.name, items: g.items }); });
    return out;
  }
  function rebuild() {
    var cur = rowsZ.current(), curTitle = rows[rowsZ.r] ? rows[rowsZ.r].title : null;
    rows = buildRows();
    var r = 0, c = 0, i;
    for (i = 0; i < rows.length; i++) if (rows[i].title === curTitle) { r = i; break; }
    if (cur && rows[r]) for (i = 0; i < rows[r].items.length; i++) if (rows[r].items[i].id === cur.id) { c = i; break; }
    rowsZ.r = r;
    rowsZ.cols = [];
    rowsZ.cols[r] = c;
    rowsZ.reset();
    updateState();
    updateHero(rowsZ.current());
  }

  function updateState() {
    var loading = !rows.length && (Data.vodState === 'loading' || jf.state === 'loading');
    var none = !loading && !rows.length;
    var errs = [];
    Data.vodLists().forEach(function (l) {
      var info = Data.vodInfo[l.id];
      if (info && info.error) errs.push(l.name + ': ' + info.error);
    });
    if (jf.state === 'error') errs.push('Jellyfin: ' + jf.error);
    U.show(els.loading, loading);
    U.show(els.empty, none);
    U.show(els.rows, !loading && !none);
    U.show(els.hero, !loading && !none);
    U.setText(els.err, errs.join('\n'));
    U.setText(els.sub, none ? '' : (errs.length ? errs.join('  ·  ') : (jf.state === 'loading' ? 'Cargando Jellyfin…' : '')));
    if (none) { if (zone !== emptyZ) setZone(emptyZ); }
    else if (!loading && zone !== rowsZ) setZone(rowsZ);
  }

  function renderCard(it, ce) {
    var title = it.type === 'episode' && it.seriesName ? it.seriesName : it.title;
    var p = U.poster(it.poster, title, 'card-img'), pos = position(it), dur = duration(it);
    if (pos > 0 && dur > 0) p.appendChild(U.pbar(pos / dur * 100));
    if (it.type === 'series') p.appendChild(U.el('div', 'card-badge', 'Serie'));
    ce.appendChild(p);
    ce.appendChild(U.el('div', 'card-title', title));
    if (it.type === 'episode') ce.appendChild(U.el('div', 'card-sub', (it.subtitle ? it.subtitle + ' · ' : '') + it.title));
  }
  S.meta = function (it) {
    var m = [], pos = position(it), dur = duration(it);
    if (it.type === 'episode') m.push((it.subtitle ? it.subtitle + ' · ' : '') + it.title);
    if (it.type === 'series') m.push('Serie');
    if (it.year) m.push(it.year);
    if (dur) m.push(U.fmtMinutes(dur));
    if (pos > 0 && dur) m.push('Visto ' + Math.round(pos / dur * 100) + '%');
    return m.join('   ·   ');
  };
  S.setBackdrop = function (el, url) {
    el.style.backgroundImage = url ? 'url("' + String(url).replace(/["\\\n\r]/g, '') + '")' : 'none';
  };
  function updateHero(it) {
    if (!it) { U.setText(els.hTitle, ''); U.setText(els.hMeta, ''); U.setText(els.hDesc, ''); S.setBackdrop(els.bd, ''); return; }
    U.setText(els.hTitle, it.type === 'episode' && it.seriesName ? it.seriesName : it.title);
    U.setText(els.hMeta, S.meta(it));
    U.setText(els.hDesc, it.overview || '');
    S.setBackdrop(els.bd, it.backdrop || '');
  }

  S.show = function (params) {
    if (!params.keep || jf.state === 'none' || Date.now() - jf.t > 120000) loadJf(); else rebuild();
  };
  S.focus = function () { if (zone) zone.focus(); };
  S.blur = function () { if (zone) zone.blur(); };
  S.handleKey = function (k) { return zone ? zone.handleKey(k) : false; };
  S.onPlayerExit = function () { rebuild(); };

  return S;
})();
