/*
 * Reproductor. Usa un solo <video> (los TVs LG no permiten dos a la vez) en tres modos:
 * 'hidden', 'mini' (vista previa dentro de la pantalla) y 'full' (pantalla completa).
 * webOS reproduce de forma nativa HLS (.m3u8), DASH (.mpd), MP4, MKV y TS.
 * Si en el PC se añade hls.js (window.Hls), se usa para HLS en navegadores que no lo soportan.
 */
var Player = (function () {
  'use strict';
  var P = { mode: 'hidden', kind: null, item: null, ctxId: 'all', failed: false, el: null, video: null };
  var v, ui = {}, session = 0, retries = 0, lastErr = null;
  var bannerTimer = null, barTimer = null, retryTimer = null, zapTimer = null, seekTimer = null;
  var zapTarget = null, pendingSeek = null, lastSave = 0, startAt = 0, playSession = '', transcode = false;
  var zap = { open: false, zone: null, catIdx: 0 };

  P.init = function () {
    P.el = U.$('#player');
    v = P.video = U.$('#video');
    ui.spinner = U.$('.p-spinner', P.el);
    ui.error = U.$('.p-error', P.el);
    ui.errTitle = U.$('.p-error-title', P.el);
    ui.errText = U.$('.p-error-text', P.el);
    ui.banner = U.$('.p-banner', P.el);
    ui.zap = U.$('.p-zap', P.el);
    ui.zapCat = U.$('.pz-cat', P.el);
    ui.vod = U.$('.p-vod', P.el);
    ui.vTitle = U.$('.pv-title', P.el);
    ui.vFill = U.$('.pv-fill', P.el);
    ui.vKnob = U.$('.pv-knob', P.el);
    ui.vCur = U.$('.pv-cur', P.el);
    ui.vDur = U.$('.pv-dur', P.el);
    ui.vState = U.$('.pv-state', P.el);

    v.addEventListener('waiting', function () { spinner(true); });
    v.addEventListener('seeking', function () { spinner(true); });
    v.addEventListener('canplay', function () { spinner(false); });
    v.addEventListener('seeked', function () { spinner(false); });
    v.addEventListener('playing', function () { spinner(false); hideError(); P.failed = false; retries = 0; updateVodBar(); });
    v.addEventListener('play', function () { if (P.kind === 'vod') showVodBar(); });
    v.addEventListener('pause', function () { if (P.kind === 'vod') showVodBar(); });
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', function () { onError(v.error ? v.error.code : 0, session); });

    P.el.addEventListener('click', function (e) {
      if (P.mode === 'mini') { P.setMode('full'); if (P.kind === 'live') showBanner(); return; }
      if (P.mode !== 'full') return;
      if (U.closest(e.target, function (n) { return U.hasClass(n, 'p-zap'); }, P.el)) return;
      if (P.kind === 'vod') togglePlay();
      else if (P.kind === 'live') { if (zap.open) closeZap(); else openZap(); }
    });
    P.el.addEventListener('mousemove', function () { if (P.mode === 'full' && P.kind === 'vod') showVodBar(); });

    zap.zone = new ListZone({
      el: U.$('.pz-list', P.el), itemHeight: 86, visible: 10,
      count: function () { return zapItems().length; },
      render: function (i, row) { var c = zapItems()[i]; if (c) row.appendChild(ChannelRow.build(c)); },
      emptyText: 'No hay canales en esta categoría',
      onSelect: function (i) {
        var c = zapItems()[i];
        if (!c) return;
        P.ctxId = Data.cats[zap.catIdx].id;
        closeZap();
        P.playLive(c, {});
        showBanner();
      }
    });
  };

  P.isLive = function (c) { return P.kind === 'live' && !!P.item && !!c && P.item.key === c.key; };

  // ---------- Fuente de video ----------
  function mimeFor(url) {
    var u = String(url).split('?')[0].split('#')[0].toLowerCase();
    if (/\.m3u8$/.test(u) || /[?&](type|format|output|extension)=(m3u8|hls)\b/i.test(url)) return 'application/vnd.apple.mpegurl';
    if (/\.mpd$/.test(u)) return 'application/dash+xml';
    if (/\.(mp4|m4v|mov)$/.test(u)) return 'video/mp4';
    if (/\.webm$/.test(u)) return 'video/webm';
    return '';
  }
  function clearSource() {
    session++;
    clearTimeout(retryTimer);
    if (P.hls) { try { P.hls.destroy(); } catch (e) { /* nada */ } P.hls = null; }
    try { v.pause(); } catch (e2) { /* nada */ }
    while (v.firstChild) v.removeChild(v.firstChild);
    v.removeAttribute('src');
    try { v.load(); } catch (e3) { /* nada */ }
  }
  function setSource(url) {
    clearSource();
    var my = session, type = mimeFor(url);
    P.mixed = location.protocol === 'https:' && /^http:\/\//i.test(url);   // canal http en la web https
    // hls.js se usa si el navegador no tiene HLS propio, y también para canales http en la web:
    // el HLS nativo de Chrome no los reconoce aunque se permita el "contenido no seguro".
    var useHlsJs = type === 'application/vnd.apple.mpegurl' && (P.mixed || !v.canPlayType(type));
    if (useHlsJs && window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
      P.hls = new window.Hls();
      P.hls.on(window.Hls.Events.ERROR, function (ev, data) { if (data && data.fatal) onError(4, my); });
      P.hls.loadSource(url);
      P.hls.attachMedia(v);
    } else {
      var s = document.createElement('source');
      s.src = url;
      if (type) s.type = type;
      s.addEventListener('error', function () { onError(4, my); });
      v.appendChild(s);
      v.load();
    }
    var pr = v.play();
    if (pr && pr.then) {
      pr.then(null, function (err) {
        if (my === session && err && err.name === 'NotAllowedError') {
          spinner(false);
          P.failed = true;
          showError('Pulsa OK para reproducir', '');
        }
      });
    }
  }
  function spinner(on) { U.show(ui.spinner, on); }
  function showError(title, text) {
    lastErr = { title: title, text: text };
    renderError();
    U.show(ui.error, true);
  }
  function renderError() {
    if (!lastErr) return;
    U.setText(ui.errTitle, lastErr.title);
    var t = lastErr.text || '';
    if (P.failed && P.mode === 'full' && t) t += ' Pulsa OK para reintentar.';
    U.setText(ui.errText, t);
  }
  function hideError() { lastErr = null; U.show(ui.error, false); }

  function onError(code, my) {
    if (my !== session || !P.kind) return;
    spinner(false);
    if (P.kind === 'live' && code !== 4 && retries < 2) {
      retries++;
      showError('Reconectando…', '');
      var url = P.item.url;
      retryTimer = setTimeout(function () { if (my === session) setSource(url); }, 2500);
      return;
    }
    P.failed = true;
    if (P.mixed) {
      showError('El navegador bloqueó este canal', 'Usa una conexión http y esta página es https. Permite el "Contenido no seguro" para este sitio en el navegador, o míralo en la app del TV o de Android.');
      return;
    }
    var msg = code === 4 ? 'El formato no es compatible o el enlace no está disponible.' :
      code === 2 ? 'Error de red al cargar el video.' :
      code === 3 ? 'No se pudo decodificar el video.' : 'No se pudo reproducir.';
    showError(P.kind === 'live' ? 'Sin señal' : 'No se pudo reproducir', msg);
  }
  function retry() {
    if (!P.item) return;
    var pos = v.currentTime || 0;
    P.failed = false;
    retries = 0;
    hideError();
    spinner(true);
    if (P.kind === 'vod') {
      startAt = pos || startAt;
      setSource(P.item.source === 'jellyfin' ? Jellyfin.streamUrl(P.item, transcode, playSession) : P.item.url);
    } else {
      setSource(P.item.url);
    }
  }

  function onMeta() {
    if (P.kind === 'vod' && startAt > 0) {
      var d = v.duration;
      if (!isFinite(d) || !d || startAt < d - 10) { try { v.currentTime = startAt; } catch (e) { /* nada */ } }
      startAt = 0;
    }
    updateVodBar();
  }
  function onTime() {
    if (P.kind !== 'vod') return;
    if (!U.hasClass(ui.vod, 'hidden')) updateVodBar();
    var now = Date.now();
    if (now - lastSave > 10000) { lastSave = now; saveProgress(false); }
  }
  function onEnded() {
    if (P.kind === 'vod') {
      var it = P.item;
      saveProgress(true, true);
      P.kind = 'vod-ended';
      App.exitVod();
      Toast.show('Terminó: ' + it.title);
    } else if (P.kind === 'live') {
      setSource(P.item.url);
    }
  }
  function saveProgress(final, ended) {
    if (P.kind !== 'vod' && P.kind !== 'vod-ended') return;
    var it = P.item;
    if (!it) return;
    var dur = isFinite(v.duration) && v.duration ? v.duration : (it.runtime || 0);
    var pos = ended ? (dur || v.currentTime || 0) : (v.currentTime || 0);
    var done = dur > 0 && pos > dur * 0.92;
    if (it.source === 'jellyfin') {
      if (final) Jellyfin.reportStopped(it, pos, playSession, transcode);
      else Jellyfin.reportProgress(it, pos, v.paused, playSession, transcode);
      it.position = done ? 0 : pos;
      if (done) it.played = true;
    } else if (done) {
      Resume.remove(it.id);
    } else if (pos > 15) {
      Resume.save(it.id, { pos: pos, dur: dur, title: it.title, poster: it.poster, url: it.url, group: it.group, overview: it.overview, year: it.year });
    }
  }

  // ---------- Reproducir / detener ----------
  P.playLive = function (ch, opts) {
    opts = opts || {};
    if (!ch) return;
    if (opts.ctxId) P.ctxId = opts.ctxId;
    var same = P.isLive(ch) && !P.failed;
    if (!same) {
      if (P.kind === 'vod') saveProgress(true);
      clearTimeout(zapTimer);
      zapTarget = null;
      P.kind = 'live';
      P.item = ch;
      P.failed = false;
      retries = 0;
      hideError();
      hideVodBar();
      spinner(true);
      Store.set('lastChannel', ch.key);
      setSource(ch.url);
      Data.emit('playing', ch);
    }
    if (opts.full) P.setMode('full');
    else if (opts.mini) P.setMode('mini', opts.mini);
    if (P.mode === 'full') showBanner();
  };

  P.playVod = function (item, opts) {
    opts = opts || {};
    if (P.kind === 'vod') saveProgress(true);
    var wasLive = P.kind === 'live';
    P.kind = 'vod';
    P.item = item;
    P.failed = false;
    startAt = opts.startAt || 0;
    lastSave = Date.now();
    pendingSeek = null;
    hideError();
    hideBanner();
    closeZap();
    spinner(true);
    P.setMode('full');
    var url = item.url;
    if (item.source === 'jellyfin') {
      transcode = !!Store.get('jfTranscode', false);
      playSession = U.uid();
      url = Jellyfin.streamUrl(item, transcode, playSession);
      Jellyfin.reportStart(item, startAt, playSession, transcode);
    }
    setSource(url);
    if (wasLive) Data.emit('playing', null);
    showVodBar();
  };

  P.stop = function () {
    if (P.kind === 'vod') saveProgress(true);
    var wasLive = P.kind === 'live';
    clearTimeout(zapTimer);
    clearTimeout(seekTimer);
    zapTarget = null;
    pendingSeek = null;
    clearSource();
    P.kind = null;
    P.item = null;
    P.failed = false;
    hideError();
    spinner(false);
    P.setMode('hidden');
    if (wasLive) Data.emit('playing', null);
  };

  P.setMode = function (mode, rect) {
    P.mode = mode;
    U.toggleClass(P.el, 'hidden', mode === 'hidden');
    U.toggleClass(P.el, 'full', mode === 'full');
    U.toggleClass(P.el, 'mini', mode === 'mini');
    U.toggleClass(U.$('#stage'), 'player-full', mode === 'full');
    if (mode === 'mini' && rect) {
      var s = P.el.style;
      s.left = rect.left + 'px';
      s.top = rect.top + 'px';
      s.width = rect.width + 'px';
      s.height = rect.height + 'px';
    }
    if (mode !== 'full') { hideBanner(); closeZap(); hideVodBar(); }
    renderError();
  };

  // Al pasar la app a segundo plano se corta la red; al volver se reanuda.
  P.suspend = function () {
    if (P.kind === 'vod') { saveProgress(false); try { v.pause(); } catch (e) { /* nada */ } }
    else if (P.kind === 'live') { P.suspended = true; clearSource(); }
  };
  P.resume = function () {
    if (P.suspended && P.kind === 'live' && P.item) { spinner(true); setSource(P.item.url); }
    P.suspended = false;
  };

  // ---------- Teclas en pantalla completa ----------
  P.handleKey = function (k) {
    if (P.mode !== 'full') return false;
    return P.kind === 'vod' ? vodKey(k) : liveKey(k);
  };

  function toggleFav(c) {
    if (!c) return;
    var on = Favs.toggle(c.key);
    Data.refreshFavs();
    Toast.show(on ? '★ ' + c.name + ' añadido a favoritos' : c.name + ' quitado de favoritos');
  }

  function liveKey(k) {
    if (zap.open) {
      if (k === 'back') { closeZap(); return true; }
      if (k === 'left' || k === 'right') { switchZapCat(k === 'left' ? -1 : 1); return true; }
      if (k === 'red') { toggleFav(zapItems()[zap.zone.index]); zap.zone.reset(); return true; }
      zap.zone.handleKey(k);
      return true;
    }
    switch (k) {
      case 'back': case 'stop': App.exitFullLive(); return true;
      case 'up': case 'chup': zapBy(1); return true;
      case 'down': case 'chdown': zapBy(-1); return true;
      case 'ok': if (P.failed) retry(); else openZap(); return true;
      case 'left': openZap(); return true;
      case 'right': case 'info': toggleBanner(); return true;
      case 'red': toggleFav(P.item); showBanner(); return true;
      case 'play': case 'playpause': if (P.failed) retry(); else if (v.paused) v.play(); return true;
      case 'pause': v.pause(); return true;
    }
    return false;
  }

  function ctxItems() { var c = Data.catById(P.ctxId); return c && c.items.length ? c.items : Data.channels; }
  function indexOfKey(items, key) {
    for (var j = 0; j < items.length; j++) if (items[j].key === key) return j;
    return -1;
  }
  // Cambio de canal: muestra el canal al instante y sintoniza cuando dejas de pulsar.
  function zapBy(d) {
    var items = ctxItems(), base = zapTarget || P.item;
    if (!items.length || !base) return;
    var i = indexOfKey(items, base.key);
    if (i < 0) { items = Data.channels; i = indexOfKey(items, base.key); }
    i = i < 0 ? 0 : (i + d + items.length) % items.length;
    zapTarget = items[i];
    showBanner(zapTarget);
    clearTimeout(zapTimer);
    zapTimer = setTimeout(function () {
      var t = zapTarget;
      zapTarget = null;
      if (t) P.playLive(t, {});
    }, CONFIG.ZAP_DELAY_MS);
  }

  function renderBanner(ch) {
    var b = ui.banner, bar = U.$('.pb-bar', b), nn = Data.nowNext(ch), lg = U.$('.pb-logo', b);
    U.setText(U.$('.pb-num', b), ch.num);
    U.setText(U.$('.pb-name', b), ch.name);
    U.show(U.$('.pb-fav', b), Favs.has(ch.key));
    lg.innerHTML = '';
    lg.appendChild(U.logo(ch.logo, ch.name));
    if (nn && nn.now) {
      U.setText(U.$('.pb-now-time', b), U.fmtRange(nn.now.s, nn.now.e));
      U.setText(U.$('.pb-now-title', b), nn.now.t);
      U.show(bar, true);
      bar.firstChild.style.width = Data.progress(nn.now) + '%';
    } else {
      U.setText(U.$('.pb-now-time', b), '');
      U.setText(U.$('.pb-now-title', b), Data.epgState === 'loading' ? 'Cargando guía…' : 'Sin información de programación');
      U.show(bar, false);
    }
    U.setText(U.$('.pb-next', b), nn && nn.next ? 'Después: ' + U.fmtClock(nn.next.s) + '   ' + nn.next.t : (ch.group || ''));
    Clock.tick();
  }
  function showBanner(ch) {
    ch = ch || zapTarget || P.item;
    if (!ch || P.mode !== 'full' || P.kind !== 'live') return;
    renderBanner(ch);
    U.show(ui.banner, true);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, CONFIG.BANNER_MS);
  }
  function hideBanner() { clearTimeout(bannerTimer); U.show(ui.banner, false); }
  function toggleBanner() { if (U.hasClass(ui.banner, 'hidden')) showBanner(); else hideBanner(); }

  // Lista rápida de canales sobre el video (OK o ◀ en pantalla completa).
  function zapItems() { var c = Data.cats[zap.catIdx]; return c ? c.items : []; }
  function renderZapHead() {
    var c = Data.cats[zap.catIdx];
    U.setText(ui.zapCat, c ? c.name + ' (' + c.items.length + ')' : '');
  }
  function openZap() {
    if (!Data.cats.length) return;
    hideBanner();
    zap.catIdx = Math.max(0, Data.catIndex(P.ctxId));
    zap.open = true;
    renderZapHead();
    U.show(ui.zap, true);
    var i = P.item ? indexOfKey(zapItems(), P.item.key) : 0;
    zap.zone.index = Math.max(0, i);
    zap.zone.top = Math.max(0, zap.zone.index - 4);
    zap.zone.reset();
    zap.zone.focus();
  }
  function closeZap() {
    if (!zap.open) return;
    zap.open = false;
    U.show(ui.zap, false);
    zap.zone.blur();
  }
  function switchZapCat(d) {
    var n = Data.cats.length;
    if (!n) return;
    zap.catIdx = (zap.catIdx + d + n) % n;
    renderZapHead();
    zap.zone.index = 0;
    zap.zone.top = 0;
    zap.zone.reset();
  }

  // ---------- Películas ----------
  function vodKey(k) {
    if (k === 'back' || k === 'stop') { App.exitVod(); return true; }
    if (P.failed && (k === 'ok' || k === 'play' || k === 'playpause')) { retry(); return true; }
    switch (k) {
      case 'ok': case 'playpause': togglePlay(); return true;
      case 'play': v.play(); showVodBar(); return true;
      case 'pause': v.pause(); showVodBar(); return true;
      case 'left': seekBy(-CONFIG.SEEK_STEP); return true;
      case 'right': seekBy(CONFIG.SEEK_STEP); return true;
      case 'rw': seekBy(-CONFIG.SEEK_STEP_FAST); return true;
      case 'ff': seekBy(CONFIG.SEEK_STEP_FAST); return true;
    }
    showVodBar();
    return true;
  }
  function togglePlay() {
    if (v.paused) {
      var p = v.play();
      if (p && p.then) p.then(null, function () {});
    } else {
      v.pause();
    }
    showVodBar();
  }
  function seekBy(d) {
    var dur = v.duration;
    if (!dur || !isFinite(dur)) { showVodBar(); return; }
    var base = pendingSeek !== null ? pendingSeek : v.currentTime;
    pendingSeek = U.clamp(base + d, 0, Math.max(0, dur - 1));
    showVodBar();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () {
      var t = pendingSeek;
      pendingSeek = null;
      try { v.currentTime = t; } catch (e) { /* nada */ }
      updateVodBar();
    }, 650);
  }
  function updateVodBar() {
    if (P.kind !== 'vod' || !P.item) return;
    var dur = isFinite(v.duration) && v.duration ? v.duration : (P.item.runtime || 0);
    var cur = pendingSeek !== null ? pendingSeek : (v.currentTime || 0);
    var pct = dur ? U.clamp(cur / dur * 100, 0, 100) : 0;
    ui.vFill.style.width = pct + '%';
    ui.vKnob.style.left = pct + '%';
    U.setText(ui.vCur, U.fmtDuration(cur));
    U.setText(ui.vDur, dur ? U.fmtDuration(dur) : '--:--');
    U.setText(ui.vState, pendingSeek !== null ? (pendingSeek >= (v.currentTime || 0) ? '⏩ ' : '⏪ ') + U.fmtDuration(pendingSeek) : (v.paused ? 'En pausa' : ''));
  }
  function showVodBar() {
    if (P.kind !== 'vod' || P.mode !== 'full') return;
    var it = P.item;
    U.setText(ui.vTitle, it.type === 'episode' && it.seriesName ? it.seriesName + ' · ' + (it.subtitle ? it.subtitle + ' · ' : '') + it.title : it.title);
    U.show(ui.vod, true);
    updateVodBar();
    clearTimeout(barTimer);
    barTimer = setTimeout(function () { if (!v.paused && pendingSeek === null) U.show(ui.vod, false); }, CONFIG.VOD_BAR_MS);
  }
  function hideVodBar() { clearTimeout(barTimer); U.show(ui.vod, false); }

  return P;
})();
