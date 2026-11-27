/* Ficha de una película o serie: reproducir / continuar, temporadas y episodios. */
var DetailScreen = (function () {
  'use strict';
  var S = { id: 'detail', menu: 'vod' };
  var item = null, acts, seasonsZ, epsZ, zone = null, seasons = [], eps = [], sIdx = 0, token = 0, els = {};

  function setZone(z) {
    if (zone && zone !== z) zone.blur();
    zone = z;
    if (App.cur === S && !App.inMenu) z.focus();
  }
  function act(name) {
    return function () {
      var z = { acts: acts, seasons: seasonsZ, eps: epsZ }[name];
      App.takeFocus(S);
      if (zone !== z) setZone(z); else if (!z.active) z.focus();
    };
  }
  function btn(label, id, fn) {
    var b = U.el('div', 'btn focusable', label);
    b.setAttribute('data-id', id);
    b.addEventListener('click', fn);
    return b;
  }

  S.init = function () {
    S.el = U.$('#screen-detail');
    S.el.innerHTML =
      '<div class="backdrop" id="det-bd"></div><div class="backdrop-fade"></div>' +
      '<div class="scr-head"><div class="scr-sub" style="margin-left:0">Películas y series</div><div class="clock"></div></div>' +
      '<div class="det-poster" id="det-poster"></div>' +
      '<div class="det-info" id="det-info"><div class="det-title" id="det-title"></div><div class="det-meta" id="det-meta"></div>' +
        '<div class="det-desc" id="det-desc"></div><div class="det-actions" id="det-actions"></div></div>' +
      '<div class="det-seasons hidden" id="det-seasons"></div>' +
      '<div class="det-eps hidden" id="det-eps"></div>';
    ['det-bd', 'det-poster', 'det-info', 'det-title', 'det-meta', 'det-desc', 'det-actions', 'det-seasons', 'det-eps'].forEach(function (id) {
      els[id.replace('det-', '')] = U.$('#' + id);
    });
    acts = new FormZone(els.actions, { activate: act('acts') });
    seasonsZ = new FormZone(els.seasons, {
      activate: act('seasons'),
      onFocus: function (el) { var i = parseInt(el.getAttribute('data-i'), 10); if (i !== sIdx) selectSeason(i); }
    });
    epsZ = new ListZone({
      el: els.eps, itemHeight: App.mobile ? 70 : 104, visible: 4,
      count: function () { return eps.length; },
      render: renderEp,
      onFocus: function (i) { var e = eps[i]; U.setText(els.desc, (e && e.overview) || item.overview || ''); },
      onSelect: function (i) { playEp(eps[i]); },
      emptyText: '',
      activate: act('eps')
    });
  };

  function render() {
    var isSeries = item.type === 'series';
    els.poster.innerHTML = '';
    els.poster.appendChild(U.poster(item.poster, item.type === 'episode' && item.seriesName ? item.seriesName : item.title));
    U.setText(els.title, item.type === 'episode' && item.seriesName ? item.seriesName : item.title);
    U.setText(els.meta, VodScreen.meta(item));
    U.setText(els.desc, item.overview || (item.source === 'm3u' ? item.group || '' : ''));
    VodScreen.setBackdrop(els.bd, item.backdrop || '');
    U.toggleClass(els.info, 'series', isSeries);
    U.show(els.actions, !isSeries);
    U.show(els.seasons, isSeries);
    U.show(els.eps, isSeries);
    if (isSeries) { loadSeasons(); setZone(seasonsZ); if (App.mobile) epsZ.fit(); }
    else { renderActions(); setZone(acts); }
  }
  function renderActions() {
    var box = els.actions, pos = VodScreen.position(item);
    box.innerHTML = '';
    if (pos > 30) {
      box.appendChild(btn('▶ Continuar desde ' + U.fmtDuration(pos), 'resume', function () { Player.playVod(item, { startAt: pos }); }));
      box.appendChild(btn('↺ Ver desde el inicio', 'start', function () { Player.playVod(item, { startAt: 0 }); }));
    } else {
      box.appendChild(btn('▶ Reproducir', 'play', function () { Player.playVod(item, { startAt: 0 }); }));
    }
    if (item.source === 'm3u' && Resume.get(item.id)) {
      box.appendChild(btn('Quitar de “Continuar viendo”', 'forget', function () {
        Resume.remove(item.id);
        renderActions();
        acts.focus();
        Toast.show('Quitado de “Continuar viendo”');
      }));
    }
    U.setText(els.meta, VodScreen.meta(item));
    acts.cur = null;
    if (zone === acts && acts.active) acts.focus();
  }

  // ---------- Series (Jellyfin) ----------
  function loadSeasons() {
    var my = ++token;
    seasons = [];
    eps = [];
    sIdx = 0;
    renderSeasons();
    epsZ.o.emptyText = 'Cargando temporadas…';
    epsZ.reset();
    Jellyfin.seasons(item.jfId).then(function (list) {
      if (my !== token) return;
      seasons = list;
      renderSeasons();
      if (!seasons.length) { epsZ.o.emptyText = 'Esta serie no tiene episodios disponibles.'; epsZ.reset(); return; }
      selectSeason(0);
      if (zone === seasonsZ && seasonsZ.active) seasonsZ.focus(U.$('.chip', els.seasons));
    }, function (e) {
      if (my !== token) return;
      epsZ.o.emptyText = 'No se pudieron cargar las temporadas: ' + e.message;
      epsZ.reset();
    });
  }
  function renderSeasons() {
    els.seasons.innerHTML = '';
    seasons.forEach(function (s, i) {
      var c = U.el('div', 'chip focusable' + (i === sIdx ? ' selected' : ''), s.title || ('Temporada ' + (i + 1)));
      c.setAttribute('data-i', i);
      c.setAttribute('data-id', 'season-' + i);
      els.seasons.appendChild(c);
    });
  }
  function selectSeason(i, keepIndex) {
    sIdx = i;
    U.$$('.chip', els.seasons).forEach(function (c, j) { U.toggleClass(c, 'selected', j === i); });
    var my = ++token, s = seasons[i];
    if (!s) return;
    if (keepIndex === undefined) { eps = []; epsZ.o.emptyText = 'Cargando episodios…'; epsZ.index = 0; epsZ.reset(); }
    Jellyfin.episodes(item.jfId, s.jfId).then(function (list) {
      if (my !== token) return;
      list.forEach(function (e) { if (!e.seriesName) e.seriesName = item.title; });
      eps = list;
      var first = 0;
      if (keepIndex !== undefined) first = keepIndex;
      else for (var j = 0; j < eps.length; j++) if (!eps[j].played) { first = j; break; }
      epsZ.index = first;
      epsZ.top = Math.max(0, first - 1);
      epsZ.o.emptyText = 'No hay episodios en esta temporada.';
      epsZ.reset();
    }, function (e) {
      if (my !== token) return;
      epsZ.o.emptyText = 'No se pudieron cargar los episodios: ' + e.message;
      epsZ.reset();
    });
  }
  function renderEp(i, row) {
    var e = eps[i];
    if (!e) return;
    var inn = U.el('div', 'row-in ep-row'), t = U.el('div', 'ep-txt'), sub = [];
    inn.appendChild(U.poster(e.thumb, '', 'ep-thumb'));
    t.appendChild(U.el('div', 'ep-title', (e.index !== undefined && e.index !== null ? e.index + '. ' : '') + e.title));
    if (e.runtime) sub.push(U.fmtMinutes(e.runtime));
    if (e.played) sub.push('Visto');
    else if (e.position > 0 && e.runtime) sub.push('Quedan ' + U.fmtMinutes(e.runtime - e.position));
    t.appendChild(U.el('div', 'ep-sub muted', sub.join('  ·  ')));
    if (!e.played && e.position > 0 && e.runtime) t.appendChild(U.pbar(e.position / e.runtime * 100));
    inn.appendChild(t);
    row.appendChild(inn);
  }
  function playEp(e) {
    if (!e) return;
    if (e.position > 30 && !e.played) {
      Modal.show({
        title: e.title, text: '¿Quieres seguir donde lo dejaste?',
        buttons: [{ label: '▶ Continuar desde ' + U.fmtDuration(e.position), value: 'r' }, { label: '↺ Desde el inicio', value: 's' }],
        cancelValue: null
      }).then(function (v) {
        if (v === 'r') Player.playVod(e, { startAt: e.position });
        else if (v === 's') Player.playVod(e, { startAt: 0 });
      });
    } else {
      Player.playVod(e, { startAt: 0 });
    }
  }

  S.show = function (params) {
    if (params.item) item = params.item;
    if (item) render();
  };
  S.focus = function () { if (zone) zone.focus(); };
  S.blur = function () { if (zone) zone.blur(); };
  S.handleKey = function (k) {
    if (!zone) return false;
    if (zone.handleKey(k)) return true;
    if (zone === seasonsZ && k === 'down' && eps.length) { setZone(epsZ); return true; }
    if (zone === epsZ && k === 'up') { if (seasons.length) setZone(seasonsZ); return true; }
    return false;
  };
  S.back = function () { App.go('vod', { keep: true }); return true; };
  S.onPlayerExit = function () {
    if (item.type === 'series') {
      selectSeason(sIdx, epsZ.index);
      setZone(epsZ);
    } else {
      renderActions();
      setZone(acts);
    }
  };

  return S;
})();
