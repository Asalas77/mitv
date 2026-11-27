/* Arranque de la app, cambio de pantallas y reparto de las teclas del control remoto. */
var App = (function () {
  'use strict';
  var A = { cur: null, inMenu: false, scale: 1, screens: {} };

  // La interfaz se diseña a 1920x1080 y se escala al tamaño real de la pantalla.
  // Celular: interfaz táctil a tamaño real (no se escala la de TV).
  A.mobile = /Mobi|iPhone|iPod/i.test(navigator.userAgent) ||
    (('ontouchstart' in window) && Math.min(screen.width, screen.height) < 600);
  function fit() {
    var w = window.innerWidth || 1920, h = window.innerHeight || 1080, st = U.$('#stage');
    if (A.mobile) {
      U.addClass(document.body, 'mobile');
      U.toggleClass(document.body, 'portrait', h >= w);
      st.style.webkitTransform = st.style.transform = 'none';
      st.style.left = st.style.top = '0px';
      st.style.width = w + 'px';
      st.style.height = h + 'px';
      A.scale = 1;
      if (A.started) Data.emit('resize');
      return;
    }
    var s = Math.min(w / 1920, h / 1080), tr = 'scale(' + s + ')';
    st.style.webkitTransform = tr;
    st.style.transform = tr;
    st.style.left = Math.round((w - 1920 * s) / 2) + 'px';
    st.style.top = Math.round((h - 1080 * s) / 2) + 'px';
    A.scale = s;
  }

  A.go = function (id, params) {
    var s = A.screens[id];
    if (!s) return;
    var prev = A.cur;
    if (prev && prev !== s) {
      if (prev.blur) prev.blur();
      U.show(prev.el, false);
    }
    A.cur = s;
    U.show(s.el, true);
    Menu.setSelected(s.menu || s.id);
    if (s.show) s.show(params || {}, prev);
    if (Player.kind === 'live' && Player.mode !== 'full') {
      if (s.previewRect) Player.setMode('mini', s.previewRect()); else Player.stop();
    }
    Clock.tick();
    A.focusScreen();
  };
  A.focusMenu = function () {
    if (A.inMenu) return;
    A.inMenu = true;
    if (A.cur && A.cur.blur) A.cur.blur();
    Menu.open();
  };
  A.focusScreen = function () {
    A.inMenu = false;
    Menu.close();
    if (A.cur && A.cur.focus) A.cur.focus();
  };
  // El puntero entró en la pantalla actual: cierra el menú sin cambiar el foco elegido.
  A.takeFocus = function (s) {
    if (A.cur !== s) return;
    if (A.inMenu) { A.inMenu = false; Menu.close(); }
  };
  A.exitFullLive = function () {
    var s = A.cur;
    if (s && s.previewRect) {
      Player.setMode('mini', s.previewRect());
      if (s.onPlayerExit) s.onPlayerExit();
    } else {
      Player.setMode('mini', A.screens.live.previewRect());
      A.go('live');
    }
  };
  A.exitVod = function () {
    Player.stop();
    if (A.cur && A.cur.onPlayerExit) A.cur.onPlayerExit();
  };
  A.confirmExit = function () {
    Modal.show({
      title: '¿Salir de ' + CONFIG.APP_NAME + '?',
      buttons: [{ label: 'Salir', value: true }, { label: 'Cancelar', value: false }],
      cancelValue: false, defaultIndex: 1
    }).then(function (yes) { if (yes) A.quit(); });
  };
  A.quit = function () {
    Player.stop();
    try {
      if (window.AndroidApp && window.AndroidApp.exit) { window.AndroidApp.exit(); return; }
      if (window.webOS && window.webOS.platformBack) { window.webOS.platformBack(); return; }
    } catch (e) { /* sigue */ }
    window.close();
  };

  // ---------- Teclas ----------
  function dispatch(k) {
    if (Modal.isOpen()) { Modal.handleKey(k); return; }
    if (Player.mode === 'full') {
      if (Keys.isNum(k)) { if (Player.kind === 'live') NumEntry.push(Keys.digit(k)); return; }
      Player.handleKey(k);
      return;
    }
    if (Keys.isNum(k)) {
      if (A.cur && A.cur.acceptsNumbers && Data.channels.length) NumEntry.push(Keys.digit(k));
      return;
    }
    if (A.inMenu) { Menu.handleKey(k); return; }
    if (A.cur && A.cur.handleKey && A.cur.handleKey(k)) return;
    if (k === 'left') { A.focusMenu(); return; }
    if (k === 'back' && !(A.cur && A.cur.back && A.cur.back())) A.focusMenu();
  }
  function onKeyDown(e) {
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
      // Escribiendo: solo OK, Atrás, ▲ y ▼ salen del campo; el resto lo maneja el teclado.
      var c = e.keyCode;
      if (c === 13 || c === 27 || c === 461 || c === 38 || c === 40) {
        e.preventDefault();
        a.blur();
        if (c === 38) dispatch('up');
        else if (c === 40) dispatch('down');
      }
      return;
    }
    var k = Keys.fromEvent(e);
    if (!k) return;
    e.preventDefault();
    dispatch(k);
  }

  // Rectángulo interior de un elemento, en coordenadas del escenario (para ubicar el video en miniatura).
  A.rectOf = function (el) {
    var s = A.scale || 1, r = el.getBoundingClientRect(), st = U.$('#stage').getBoundingClientRect();
    return {
      left: Math.round((r.left - st.left) / s + el.clientLeft), top: Math.round((r.top - st.top) / s + el.clientTop),
      width: el.clientWidth, height: el.clientHeight
    };
  };

  // Para la versión Android: la tecla Atrás del sistema llega como App.key('back').
  A.key = function (k) { dispatch(k); };

  A.start = function () {
    document.title = CONFIG.APP_NAME;
    fit();
    window.addEventListener('resize', fit);
    Favs.load();
    Menu.init();
    Player.init();
    [LiveScreen, GuideScreen, VodScreen, DetailScreen, SettingsScreen].forEach(function (s) {
      s.init();
      A.screens[s.id] = s;
    });
    document.addEventListener('keydown', onKeyDown, false);
    // Teclado en pantalla de webOS: al cerrarlo se sale del campo de texto.
    document.addEventListener('keyboardStateChange', function (e) {
      if (e.detail && !e.detail.visibility) {
        var a = document.activeElement;
        if (a && a.tagName === 'INPUT') a.blur();
      }
    }, false);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) Player.suspend(); else Player.resume();
    }, false);
    Clock.start();
    setInterval(function () { Data.emit('minute'); }, 60000);
    A.started = true;
    A.go('live');
    Data.loadLive();
    Data.loadVod();
  };

  return A;
})();

App.start();
