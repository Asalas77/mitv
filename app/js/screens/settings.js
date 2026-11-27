/* Pantalla "Ajustes": listas de canales, listas de películas, Jellyfin, demostración y mantenimiento. */
var SettingsScreen = (function () {
  'use strict';
  var S = { id: 'settings' };
  var zone, inner, scroller, draft = {}, jfStatus = '', pendingFocus = null, pendingRender = false;

  function isDemo(l) { return !!l.demo; }
  function notDemo(l) { return !l.demo; }
  function isHttp(u) { return /^https?:\/\/[^\s]+$/i.test(u); }

  S.init = function () {
    S.el = U.$('#screen-settings');
    S.el.innerHTML = '<div class="scr-head"><div class="scr-title">Ajustes</div><div class="clock"></div></div>' +
      '<div class="set-scroll" id="set-scroll"><div class="set-inner" id="set-inner"></div></div>';
    inner = U.$('#set-inner');
    scroller = U.$('#set-scroll');
    zone = new FormZone(inner, {
      scroller: scroller,
      activate: function () { App.takeFocus(S); if (!zone.active) zone.focus(); },
      onEditEnd: function () { if (pendingRender) setTimeout(render, 0); }
    });
    scroller.addEventListener('wheel', function (e) { scroller.scrollTop += e.deltaY > 0 ? 140 : -140; e.preventDefault(); });
    Data.on('live', function () { if (App.cur === S) render(); });
    Data.on('epg', function () { if (App.cur === S) render(); });
    Data.on('vod', function () { if (App.cur === S) render(); });
  };

  // ---------- Construcción de la pantalla ----------
  function section(title, text) {
    var s = U.el('div', 'set-sec');
    s.appendChild(U.el('div', 'set-h', title));
    if (text) s.appendChild(U.el('div', 'set-p', text));
    inner.appendChild(s);
    return s;
  }
  function button(label, id, fn, cls) {
    var b = U.el('div', 'btn focusable' + (cls ? ' ' + cls : ''), label);
    b.setAttribute('data-id', id);
    b.addEventListener('click', fn);
    return b;
  }
  function field(parent, label, id, placeholder, type) {
    var f = U.el('div', 'field'), inp = document.createElement('input');
    f.appendChild(U.el('label', '', label));
    inp.type = type || 'text';
    inp.className = 'focusable';
    inp.setAttribute('data-id', id);
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('spellcheck', 'false');
    inp.placeholder = placeholder || '';
    inp.value = draft[id] || '';
    inp.addEventListener('input', function () { draft[id] = inp.value; });
    f.appendChild(inp);
    parent.appendChild(f);
    return inp;
  }
  function listItem(l, kind, info) {
    var it = U.el('div', 'set-item'), tx = U.el('div', 'si-text');
    tx.appendChild(U.el('b', '', l.name));
    tx.appendChild(U.el('small', '', l.url));
    if (l.epg) tx.appendChild(U.el('small', '', 'Guía: ' + l.epg));
    var st = U.el('small', '');
    if (l.disabled) { st.textContent = 'Desactivada: sus canales no se cargan'; U.addClass(it, 'off'); }
    else if (info && info.error) { st.className = 'err'; st.textContent = 'No se pudo cargar: ' + info.error; }
    else if (info) {
      st.className = 'ok';
      st.textContent = info.count + (kind === 'live' ? ' canales' : ' títulos') +
        (info.vod ? ' · ' + info.vod + ' películas/episodios movidos a Películas y series' : '');
    }
    else st.textContent = 'Cargando…';
    tx.appendChild(st);
    it.appendChild(tx);
    it.appendChild(button(l.disabled ? 'Activar' : 'Desactivar', 'tog-' + kind + '-' + l.id, function () { toggleList(kind, l); }));
    it.appendChild(button('Eliminar', 'del-' + kind + '-' + l.id, function () { removeList(kind, l); }));
    return it;
  }

  // Mientras se escribe en un campo no se redibuja (se perdería el teclado); se hace al terminar.
  function editing() {
    var a = document.activeElement;
    return !!(a && a.tagName === 'INPUT' && inner.contains(a));
  }
  function render() {
    if (editing()) { pendingRender = true; return; }
    pendingRender = false;
    var keep = zone.cur ? zone.cur.getAttribute('data-id') : null, top = scroller.scrollTop;
    inner.innerHTML = '';

    // 1) Canales
    var lists = Data.liveLists();
    var s1 = section('Listas de canales (M3U)', 'Pega la dirección (URL) de la lista que te entrega tu proveedor de TV, o de canales que transmiten gratis de forma oficial. Si la lista trae su propia guía (url-tvg) se usa automáticamente.');
    s1.appendChild(button('Agregar una lista con el celular (código QR)', 'pair', function () { Pair.open(); }, 'primary'));
    if (!lists.length) s1.appendChild(U.el('div', 'set-empty', 'Aún no agregaste ninguna lista.'));
    lists.forEach(function (l) { s1.appendChild(listItem(l, 'live', Data.liveState === 'loading' ? null : Data.listInfo[l.id])); });
    if (Data.epgInfo.length || Data.epgState === 'loading') {
      var g = U.el('div', 'set-p');
      g.textContent = Data.epgState === 'loading' ? 'Guía de programación: cargando…' :
        'Guía de programación: ' + Data.epgInfo.map(function (e) { return e.error ? 'error (' + e.error + ')' : e.count + ' canales con guía'; }).join(' · ');
      s1.appendChild(g);
    }
    var f1 = U.el('div', 'set-form');
    s1.appendChild(f1);
    field(f1, 'Nombre (opcional)', 'live-name', 'Mi proveedor');
    field(f1, 'Dirección de la lista', 'live-url', 'http://…/lista.m3u', 'url');
    field(f1, 'Guía XMLTV (opcional)', 'live-epg', 'http://…/guia.xml', 'url');
    var a1 = U.el('div', 'set-actions');
    a1.appendChild(button('Guardar lista de canales', 'live-save', saveLive, 'primary'));
    f1.appendChild(a1);

    // 2) Películas y series en M3U
    var vlists = Data.vodLists();
    var s2 = section('Películas y series (M3U)', 'Listas M3U con películas o episodios. Cada entrada aparece con su carátula (tvg-logo) y se agrupa por su categoría (group-title).');
    if (!vlists.length) s2.appendChild(U.el('div', 'set-empty', 'Aún no agregaste ninguna lista de películas.'));
    vlists.forEach(function (l) { s2.appendChild(listItem(l, 'vod', Data.vodState === 'loading' ? null : Data.vodInfo[l.id])); });
    var f2 = U.el('div', 'set-form');
    s2.appendChild(f2);
    field(f2, 'Nombre (opcional)', 'vod-name', 'Mis películas');
    field(f2, 'Dirección de la lista', 'vod-url', 'http://…/peliculas.m3u', 'url');
    var a2 = U.el('div', 'set-actions');
    a2.appendChild(button('Guardar lista de películas', 'vod-save', saveVod, 'primary'));
    f2.appendChild(a2);

    // 3) Jellyfin
    var s3 = section('Servidor Jellyfin', 'Conecta tu propio servidor Jellyfin (por ejemplo http://192.168.1.10:8096) para ver tu colección de películas y series con "Continuar viendo".');
    if (Jellyfin.isConnected()) {
      var c = Jellyfin.cfg, it = U.el('div', 'set-item'), tx = U.el('div', 'si-text');
      tx.appendChild(U.el('b', '', 'Conectado como ' + c.userName));
      tx.appendChild(U.el('small', '', c.server));
      it.appendChild(tx);
      it.appendChild(button('Desconectar', 'jf-logout', function () {
        Jellyfin.logout();
        Data.emit('jellyfin');
        Toast.show('Jellyfin desconectado');
        render();
      }));
      s3.appendChild(it);
      var on = !!Store.get('jfTranscode', false);
      var sw = button('Transcodificar en el servidor (más compatible, usa más el PC del servidor)', 'jf-transcode', function () {
        Store.set('jfTranscode', !Store.get('jfTranscode', false));
        render();
      }, 'switch' + (on ? ' on' : ''));
      s3.appendChild(sw);
    } else {
      var f3 = U.el('div', 'set-form');
      s3.appendChild(f3);
      field(f3, 'Servidor', 'jf-server', 'http://192.168.1.10:8096', 'url');
      field(f3, 'Usuario', 'jf-user', '');
      field(f3, 'Contraseña', 'jf-pass', '', 'password');
      if (jfStatus) f3.appendChild(U.el('div', 'set-status', jfStatus));
      var a3 = U.el('div', 'set-actions');
      a3.appendChild(button('Conectar', 'jf-connect', connectJf, 'primary'));
      f3.appendChild(a3);
    }

    // 4) Demostración
    var demo = Data.liveLists().some(isDemo) || Data.vodLists().some(isDemo);
    var s4 = section('Contenido de demostración', 'Señales de prueba públicas (Apple, Mux y Akamai) y cortometrajes libres de Blender Foundation con licencia Creative Commons, para probar la app sin tener una lista propia.');
    s4.appendChild(demo ? button('Quitar la demostración', 'demo', removeDemo) : button('Cargar la demostración', 'demo', S.loadDemo, 'primary'));

    // 5) Mantenimiento
    var s5 = section('Mantenimiento', '');
    s5.appendChild(button('Actualizar listas y guía ahora', 'reload', function () {
      Toast.show('Actualizando…');
      Data.reloadAll().then(function () { Toast.show('Listas actualizadas: ' + Data.channels.length + ' canales'); });
    }));
    s5.appendChild(button('Borrar todos los datos de la app', 'reset', resetAll, 'danger'));

    // 6) Acerca de
    section('Acerca de', CONFIG.APP_NAME + ' ' + CONFIG.VERSION + ' · Reproductor para televisores LG webOS. Úsalo solo con contenido que tengas derecho a ver.');

    scroller.scrollTop = top;
    var t = keep ? zone.byId(keep) : null;
    if (zone.active) zone.focus(t || undefined);
    else { zone.cur = t; zone.lastId = keep; }
  }

  // ---------- Acciones ----------
  function focusId(id) { var t = zone.byId(id); if (t) zone.set(t); }
  function saveLive() {
    var url = (draft['live-url'] || '').trim(), epg = (draft['live-epg'] || '').trim(), name = (draft['live-name'] || '').trim();
    if (!isHttp(url)) { Toast.show('Escribe la dirección completa de la lista (empieza con http:// o https://)'); focusId('live-url'); return; }
    if (epg && !isHttp(epg)) { Toast.show('La dirección de la guía debe empezar con http:// o https://'); focusId('live-epg'); return; }
    var lists = Data.liveLists();
    var l = { id: U.uid(), name: name || ('Lista ' + (lists.filter(notDemo).length + 1)), url: url, epg: epg };
    lists.push(l);
    Data.saveLiveLists(lists);
    draft['live-url'] = draft['live-epg'] = draft['live-name'] = '';
    Toast.show('Cargando la lista…');
    Data.loadLive().then(function () {
      var info = Data.listInfo[l.id];
      Toast.show(info && info.error ? 'No se pudo cargar la lista: ' + info.error : 'Lista cargada: ' + (info ? info.count : 0) + ' canales', 4500);
    });
    render();
  }
  function saveVod() {
    var url = (draft['vod-url'] || '').trim(), name = (draft['vod-name'] || '').trim();
    if (!isHttp(url)) { Toast.show('Escribe la dirección completa de la lista (empieza con http:// o https://)'); focusId('vod-url'); return; }
    var lists = Data.vodLists();
    var l = { id: U.uid(), name: name || ('Películas ' + (lists.filter(notDemo).length + 1)), url: url };
    lists.push(l);
    Data.saveVodLists(lists);
    draft['vod-url'] = draft['vod-name'] = '';
    Toast.show('Cargando la lista…');
    Data.loadVod().then(function () {
      var info = Data.vodInfo[l.id];
      Toast.show(info && info.error ? 'No se pudo cargar la lista: ' + info.error : 'Lista cargada: ' + (info ? info.count : 0) + ' títulos', 4500);
    });
    render();
  }
  function toggleList(kind, l) {
    var all = kind === 'live' ? Data.liveLists() : Data.vodLists();
    all.forEach(function (x) { if (x.id === l.id) x.disabled = !x.disabled; });
    if (kind === 'live') { Data.saveLiveLists(all); Data.loadLive(); } else { Data.saveVodLists(all); Data.loadVod(); }
    // l es el estado anterior al cambio
    Toast.show(l.disabled ? '"' + l.name + '" activada' : '"' + l.name + '" desactivada: sus canales ya no aparecen');
    render();
  }
  function removeList(kind, l) {
    Modal.show({
      title: '¿Eliminar "' + l.name + '"?', text: 'Puedes volver a agregarla cuando quieras.',
      buttons: [{ label: 'Eliminar', value: true }, { label: 'Cancelar', value: false }], cancelValue: false, defaultIndex: 1
    }).then(function (yes) {
      if (!yes) return;
      if (kind === 'live') {
        Data.saveLiveLists(Data.liveLists().filter(function (x) { return x.id !== l.id; }));
        Data.loadLive();
      } else {
        Data.saveVodLists(Data.vodLists().filter(function (x) { return x.id !== l.id; }));
        Data.loadVod();
      }
      Toast.show('Lista eliminada');
      render();
    });
  }
  function connectJf() {
    var server = (draft['jf-server'] || '').trim(), user = (draft['jf-user'] || '').trim(), pw = draft['jf-pass'] || '';
    if (!server) { Toast.show('Escribe la dirección del servidor, por ejemplo http://192.168.1.10:8096'); focusId('jf-server'); return; }
    if (!user) { Toast.show('Escribe tu usuario de Jellyfin'); focusId('jf-user'); return; }
    jfStatus = 'Conectando…';
    render();
    Jellyfin.login(server, user, pw).then(function (c) {
      jfStatus = '';
      draft['jf-pass'] = '';
      Toast.show('Conectado a Jellyfin como ' + c.userName);
      Data.emit('jellyfin');
      render();
    }, function (e) {
      jfStatus = e.status === 401 ? 'Usuario o contraseña incorrectos.' : 'No se pudo conectar: ' + e.message;
      render();
    });
  }
  S.loadDemo = function () {
    var live = Data.liveLists(), vod = Data.vodLists();
    if (!live.some(isDemo)) live.unshift({ id: 'demo', name: 'Demostración', url: CONFIG.DEMO_LIVE_URL, demo: true });
    if (!vod.some(isDemo)) vod.unshift({ id: 'demo-vod', name: 'Cine abierto (demostración)', url: CONFIG.DEMO_VOD_URL, demo: true });
    Data.saveLiveLists(live);
    Data.saveVodLists(vod);
    Toast.show('Cargando la demostración…');
    Data.loadLive().then(function () { Toast.show('Demostración lista: ' + Data.channels.length + ' canales'); });
    Data.loadVod();
    if (App.cur === S) render();
  };
  function removeDemo() {
    Data.saveLiveLists(Data.liveLists().filter(notDemo));
    Data.saveVodLists(Data.vodLists().filter(notDemo));
    Data.reloadAll();
    Toast.show('Demostración quitada');
    render();
  }
  function resetAll() {
    Modal.show({
      title: '¿Borrar todos los datos?', text: 'Se eliminarán tus listas, favoritos, posiciones guardadas y la conexión con Jellyfin.',
      buttons: [{ label: 'Borrar todo', value: true }, { label: 'Cancelar', value: false }], cancelValue: false, defaultIndex: 1
    }).then(function (yes) {
      if (!yes) return;
      Player.stop();
      Store.clearAll();
      window.location.reload();
    });
  }

  S.show = function (params) {
    if (params.focus) pendingFocus = params.focus;
    render();
  };
  S.focus = function () {
    var t = pendingFocus ? zone.byId(pendingFocus) : null;
    pendingFocus = null;
    zone.focus(t || undefined);
  };
  S.blur = function () { zone.blur(); };
  S.handleKey = function (k) { return zone.handleKey(k); };

  return S;
})();
