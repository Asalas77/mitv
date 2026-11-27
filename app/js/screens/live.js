/* Pantalla "TV en vivo": categorías, lista de canales, vista previa e información del programa. */
var LiveScreen = (function () {
  'use strict';
  var S = { id: 'live', acceptsNumbers: true };
  var cats, chans, acts, empty, srch, zone = null, firstLoad = true, els = {};

  function curItems() { return Data.category().items; }
  function focused() { return curItems()[chans.index] || null; }
  function indexIn(items, ch) {
    if (!ch) return -1;
    for (var i = 0; i < items.length; i++) if (items[i].key === ch.key) return i;
    return -1;
  }
  function setZone(z) {
    if (zone && zone !== z) zone.blur();
    zone = z;
    if (App.cur === S && !App.inMenu) z.focus();
  }
  function act(name) {
    return function () {
      var z = { cats: cats, chans: chans, acts: acts, empty: empty, srch: srch }[name];
      App.takeFocus(S);
      if (zone !== z) setZone(z); else if (!z.active) z.focus();
    };
  }

  S.init = function () {
    S.el = U.$('#screen-live');
    S.el.innerHTML =
      '<div class="scr-head"><div class="scr-title">TV en vivo</div><div class="scr-sub" id="live-sub"></div><div class="clock"></div></div>' +
      '<div id="live-main">' +
        '<div class="live-search" id="live-search"><input class="focusable" data-id="q" type="text" placeholder="Buscar canal…" autocomplete="off" spellcheck="false"></div>' +
        '<div class="live-cats" id="live-cats"></div>' +
        '<div class="live-chans" id="live-chans"></div>' +
        '<div class="live-side">' +
          '<div class="preview-box"><div class="preview-ph" id="live-ph">Elige un canal y pulsa OK para verlo</div></div>' +
          '<div class="side-info">' +
            '<div class="si-name" id="si-name"></div>' +
            '<div class="si-now" id="si-now"></div>' +
            '<div class="si-time" id="si-time"></div>' +
            '<div class="pbar si-pbar" id="si-pbar"><i></i></div>' +
            '<div class="si-desc" id="si-desc"></div>' +
            '<div class="si-next" id="si-next"></div>' +
          '</div>' +
          '<div class="side-actions" id="live-actions">' +
            '<div class="btn focusable" data-id="play">▶ Pantalla completa</div>' +
            '<div class="btn focusable" data-id="fav">☆ Añadir a favoritos</div>' +
          '</div>' +
          '<div class="hints">● Rojo (F): favorito  ·  CH+/CH−: saltar página  ·  0-9: ir al canal</div>' +
        '</div>' +
      '</div>' +
      '<div class="empty hidden" id="live-empty">' +
        '<div class="empty-title" id="le-title"></div>' +
        '<div class="empty-text" id="le-text"></div>' +
        '<div class="empty-err" id="le-err"></div>' +
        '<div class="btn focusable" data-id="demo">Probar con la demostración</div>' +
        '<div class="btn focusable" data-id="settings">Agregar mi lista en Ajustes</div>' +
      '</div>' +
      '<div class="loading hidden" id="live-loading"><div class="spin"></div><div>Cargando canales…</div></div>';

    els.sub = U.$('#live-sub');
    els.main = U.$('#live-main');
    els.empty = U.$('#live-empty');
    els.loading = U.$('#live-loading');
    els.ph = U.$('#live-ph');
    els.name = U.$('#si-name');
    els.now = U.$('#si-now');
    els.time = U.$('#si-time');
    els.bar = U.$('#si-pbar');
    els.desc = U.$('#si-desc');
    els.next = U.$('#si-next');
    els.leTitle = U.$('#le-title');
    els.leText = U.$('#le-text');
    els.leErr = U.$('#le-err');
    els.favBtn = U.$('[data-id="fav"]', S.el);

    // Buscador: filtra mientras se escribe (con el teclado del TV o del PC).
    srch = new FormZone(U.$('#live-search'), { activate: act('srch') });
    els.q = U.$('#live-search input');
    els.q.addEventListener('input', U.debounce(function () { Data.search(els.q.value); }, 300));

    cats = new ListZone({
      el: U.$('#live-cats'), itemHeight: 72, visible: 11,
      count: function () { return Data.cats.length; },
      render: renderCat,
      isSelected: function (i) { return i === Data.curCat; },
      onFocus: U.debounce(function (i) { if (i !== Data.curCat) Data.setCat(i); }, 160),
      onSelect: function (i) { if (i !== Data.curCat) Data.setCat(i); if (curItems().length) setZone(chans); },
      activate: act('cats')
    });
    chans = new ListZone({
      el: U.$('#live-chans'), itemHeight: 88, visible: 10,
      count: function () { return curItems().length; },
      render: function (i, row) { var c = curItems()[i]; if (c) row.appendChild(ChannelRow.build(c)); },
      onFocus: U.debounce(updateSide, 60),
      onSelect: function (i) { play(curItems()[i]); },
      emptyText: '',
      activate: act('chans')
    });
    acts = new FormZone(U.$('#live-actions'), { activate: act('acts') });
    empty = new FormZone(els.empty, { activate: act('empty') });

    U.$('[data-id="play"]', S.el).addEventListener('click', function () { play(focused()); });
    els.favBtn.addEventListener('click', function () { toggleFav(focused()); });
    U.$('[data-id="demo"]', S.el).addEventListener('click', function () { SettingsScreen.loadDemo(); });
    U.$('[data-id="settings"]', S.el).addEventListener('click', function () { App.go('settings', { focus: 'live-url' }); });

    Data.on('live', onLive);
    Data.on('cat', onCat);
    Data.on('favs', onFavs);
    Data.on('epg', function () { chans.refreshAll(); updateSide(); updateSub(); });
    Data.on('playing', function () { chans.refreshAll(); updatePreview(); });
    Data.on('minute', function () { if (App.cur === S) { chans.refreshAll(); updateSide(); } });
  };

  function renderCat(i, row) {
    var c = Data.cats[i];
    if (!c) return;
    var inn = U.el('div', 'row-in');
    if (c.id === 'fav') inn.appendChild(U.el('span', 'cat-ico', '★'));
    inn.appendChild(U.el('span', 'cat-name', c.name));
    inn.appendChild(U.el('span', 'cat-count muted', c.items.length));
    row.appendChild(inn);
  }

  function updateSub() {
    var c = Data.category(), t = c.name + '  ·  ' + c.items.length + ' canales';
    if (Data.epgState === 'loading') t += '  ·  cargando guía…';
    U.setText(els.sub, Data.channels.length ? t : '');
    chans.o.emptyText = c.id === 'fav' ?
      'Aún no tienes favoritos. Ponte sobre un canal y pulsa el botón rojo (F en el PC) para añadirlo.' :
      'No hay canales en esta categoría.';
  }
  function updateSide() {
    var c = focused();
    if (!c) {
      [els.name, els.now, els.time, els.desc, els.next].forEach(function (e) { U.setText(e, ''); });
      U.show(els.bar, false);
      return;
    }
    U.setText(els.name, c.num + '   ' + c.name);
    var nn = Data.nowNext(c);
    if (nn && nn.now) {
      U.setText(els.now, nn.now.t + (nn.now.st ? ' · ' + nn.now.st : ''));
      U.setText(els.time, U.fmtRange(nn.now.s, nn.now.e));
      U.show(els.bar, true);
      els.bar.firstChild.style.width = Data.progress(nn.now) + '%';
      U.setText(els.desc, nn.now.d || '');
    } else {
      U.setText(els.now, Data.epgState === 'loading' ? 'Cargando guía…' : 'Sin información de programación');
      U.setText(els.time, c.group || '');
      U.show(els.bar, false);
      U.setText(els.desc, '');
    }
    U.setText(els.next, nn && nn.next ? 'Después: ' + U.fmtClock(nn.next.s) + '   ' + nn.next.t : '');
    U.setText(els.favBtn, Favs.has(c.key) ? '★ Quitar de favoritos' : '☆ Añadir a favoritos');
  }
  function updatePreview() { U.show(els.ph, Player.kind !== 'live'); }

  function updateState() {
    var loading = Data.liveState === 'loading' && !Data.channels.length;
    var none = !loading && !Data.channels.length;
    U.show(els.loading, loading);
    U.show(els.empty, none);
    U.show(els.main, !loading && !none);
    if (none) {
      var lists = Data.liveLists(), errs = [];
      lists.forEach(function (l) {
        var i = Data.listInfo[l.id];
        if (i && i.error) errs.push(l.name + ': ' + i.error);
      });
      U.setText(els.leTitle, lists.length ? 'No se pudieron cargar tus canales' : 'Todavía no tienes canales');
      U.setText(els.leText, lists.length ?
        'Revisa en Ajustes que la dirección de tu lista sea correcta y que el TV tenga conexión a internet.' :
        'Agrega la lista M3U que te entrega tu proveedor de TV, o prueba la app con la demostración (señales de prueba públicas y cortometrajes libres).');
      U.setText(els.leErr, errs.join('\n'));
      if (zone !== empty) setZone(empty);
    } else if (!loading && (zone === empty || !zone)) {
      setZone(chans);
    }
  }

  function onLive() {
    if (Data.liveState === 'ready') {
      if (firstLoad && Data.channels.length) {
        firstLoad = false;
        var last = Store.get('lastChannel', null), ch = last ? Data.byKey[last] : null;
        if (ch) {
          var i = indexIn(curItems(), ch);
          if (i < 0) { Data.setCat(0, true); i = ch.idx; }
          chans.index = i;
          chans.top = Math.max(0, i - 3);
          if (CONFIG.AUTOPLAY_LAST_CHANNEL && App.cur === S && !Player.kind) {
            Player.playLive(ch, { mini: S.previewRect(), ctxId: Data.category().id });
          }
        }
      } else {
        chans.index = Math.min(chans.index, Math.max(0, curItems().length - 1));
      }
    }
    cats.index = Data.curCat;
    cats.reset();
    chans.reset();
    updateSub();
    updateSide();
    updatePreview();
    updateState();
  }
  function onCat() {
    cats.index = Data.curCat;
    cats.reset();   // la lista de categorías puede cambiar (aparece/desaparece "Resultados")
    var j = Player.kind === 'live' ? indexIn(curItems(), Player.item) : -1;
    chans.index = j >= 0 ? j : 0;
    chans.top = Math.max(0, chans.index - 3);
    chans.reset();
    updateSub();
    updateSide();
  }
  function onFavs() {
    cats.refreshAll();
    if (Data.category().id === 'fav') chans.reset(); else chans.refreshAll();
    updateSub();
    updateSide();
  }

  function play(c) {
    if (!c) return;
    Player.playLive(c, { full: true, ctxId: Data.category().id });
  }
  function toggleFav(c) {
    if (!c) return;
    var on = Favs.toggle(c.key);
    Data.refreshFavs();
    Toast.show(on ? '★ ' + c.name + ' añadido a favoritos' : c.name + ' quitado de favoritos');
  }

  S.show = function () {
    cats.index = Data.curCat;
    cats.render();
    chans.render();
    updateSub();
    updateSide();
    updatePreview();
    updateState();
  };
  S.focus = function () {
    if (!zone && Data.channels.length) zone = chans;
    if (zone) zone.focus();
  };
  S.blur = function () { if (zone) zone.blur(); };
  S.handleKey = function (k) {
    if (!zone) return false;
    if (zone === chans && k === 'red') { toggleFav(focused()); return true; }
    if (zone === srch) {
      if (k === 'down' || k === 'right') { setZone(curItems().length && Data.query ? chans : cats); return true; }
      return zone.handleKey(k);
    }
    if (zone.handleKey(k)) return true;
    if (zone === cats && k === 'up') { setZone(srch); return true; }
    if (zone === cats && k === 'right' && curItems().length) { setZone(chans); return true; }
    if (zone === chans && k === 'left') { setZone(cats); return true; }
    if (zone === chans && k === 'right') { setZone(acts); return true; }
    if (zone === acts && k === 'left') { setZone(chans); return true; }
    return false;
  };
  S.back = function () {
    if (zone === acts) { setZone(chans); return true; }
    return false;
  };
  // Zona del video en miniatura (coincide con .preview-box en app.css).
  S.previewRect = function () { return { left: 1182, top: 142, width: 686, height: 384 }; };
  S.onPlayerExit = function () {
    var i = Player.kind === 'live' ? indexIn(curItems(), Player.item) : -1;
    if (i >= 0) chans.index = i;
    setZone(chans);
    chans.render();
    updateSide();
  };

  return S;
})();
