/* Pantalla "Guía": cuadrícula de programación (canales × horas). */
var GuideScreen = (function () {
  'use strict';
  var S = { id: 'guide', acceptsNumbers: true };
  var WIN = 120 * 60000, STEP = 30 * 60000, PX = 1420 / 120, ROWS = 7, ROW_H = 70;
  var st = { row: 0, top: 0, ft: 0, ws: 0 }, focusOn = 'grid', active = false, chans = [], els = {}, logos = {}, emptyZ;

  function now() { return Date.now(); }
  function minWs() { return Math.floor((now() - CONFIG.EPG_PAST_HOURS * 3600000) / STEP) * STEP; }
  function maxWs() { return Math.floor((now() + CONFIG.EPG_FUTURE_HOURS * 3600000) / STEP) * STEP - WIN; }
  function resetWindow() { var t = now(); st.ws = Math.floor(t / STEP) * STEP; st.ft = t; }

  S.init = function () {
    S.el = U.$('#screen-guide');
    S.el.innerHTML =
      '<div class="scr-head"><div class="scr-title">Guía</div><div class="chip" id="g-chip"></div><div class="clock"></div></div>' +
      '<div class="gd" id="gd"><div class="gd-title" id="gd-title"></div><div class="gd-meta" id="gd-meta"></div>' +
        '<div class="gd-chan" id="gd-chan"></div><div class="gd-desc" id="gd-desc"></div></div>' +
      '<div class="guide-preview"><div class="preview-box"><div class="preview-ph" id="g-ph">Pulsa OK sobre un programa para ver el canal</div></div></div>' +
      '<div class="gg" id="gg"><div class="gg-day" id="gg-day"></div><div class="gg-ruler" id="gg-ruler"></div>' +
        '<div class="gg-rows" id="gg-rows"></div><div class="gg-now hidden" id="gg-now"></div></div>' +
      '<div class="empty hidden" id="g-empty"><div class="empty-title">No hay canales</div>' +
        '<div class="empty-text">Agrega una lista de canales en Ajustes para ver su guía de programación.</div>' +
        '<div class="btn focusable" data-id="go">Ir a Ajustes</div></div>';
    ['g-chip', 'gd', 'gd-title', 'gd-meta', 'gd-chan', 'gd-desc', 'g-ph', 'gg', 'gg-day', 'gg-ruler', 'gg-rows', 'gg-now', 'g-empty'].forEach(function (id) {
      els[id.replace(/-/g, '_')] = U.$('#' + id);
    });
    emptyZ = new FormZone(els.g_empty, { activate: function () { App.takeFocus(S); emptyZ.focus(); } });
    U.$('[data-id="go"]', S.el).addEventListener('click', function () { App.go('settings', { focus: 'live-url' }); });

    els.g_chip.addEventListener('click', function () { App.takeFocus(S); setFocus('chip'); cycleCat(1); });
    els.gg_rows.addEventListener('click', function (e) {
      var cell = U.closestAttr(e.target, 'data-row', els.gg_rows);
      if (!cell) return;
      App.takeFocus(S);
      var r = parseInt(cell.getAttribute('data-row'), 10), t = cell.getAttribute('data-t');
      var same = r === st.row && t !== null && focusOn === 'grid' && active && blockAt(chans[r], +t) === focusBlock(chans[r]);
      st.row = r;
      if (t !== null) st.ft = +t;
      setFocus('grid');
      if (same || t === null) tune(chans[r]);
    });

    Data.on('cat', function () { st.row = 0; st.top = 0; logos = {}; if (App.cur === S) render(); });
    Data.on('live', function () { logos = {}; if (App.cur === S) render(); });
    Data.on('epg', function () { if (App.cur === S) render(); });
    Data.on('favs', function () { if (App.cur === S) render(); });
    Data.on('playing', function () { U.show(els.g_ph, Player.kind !== 'live'); });
    Data.on('minute', function () { if (App.cur === S) render(); });
  };

  // ---------- Bloques de programación de una fila ----------
  function firstEndingAfter(list, t) {
    var lo = 0, hi = list.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (list[m].e <= t) lo = m + 1; else hi = m; }
    return lo;
  }
  // Devuelve programas y huecos ("Sin información", en tramos de 30 min) que cubren la ventana visible.
  function blocks(c) {
    if (c._blocks && c._blocksWs === st.ws) return c._blocks;
    var list = Data.programmes(c) || [], out = [], ws = st.ws, we = ws + WIN, t = ws, i = firstEndingAfter(list, ws), guard = 0;
    while (t < we && guard++ < 300) {
      while (i < list.length && list[i].e <= t) i++;
      var p = list[i];
      if (p && p.s <= t) { out.push({ s: p.s, e: p.e, p: p }); t = p.e; i++; }
      else {
        var slotEnd = (Math.floor(t / STEP) + 1) * STEP, ge = p ? Math.min(p.s, slotEnd) : slotEnd;
        out.push({ s: t, e: ge, gap: true });
        t = ge;
      }
    }
    c._blocks = out;
    c._blocksWs = ws;
    return out;
  }
  function blockAt(c, t) {
    if (!c) return null;
    var bs = blocks(c);
    for (var i = 0; i < bs.length; i++) if (bs[i].s <= t && t < bs[i].e) return bs[i];
    return bs[bs.length - 1] || null;
  }
  function focusBlock(c) { return blockAt(c, U.clamp(st.ft, st.ws, st.ws + WIN - 1)); }

  // ---------- Dibujo ----------
  function render() {
    chans = Data.category().items;
    var any = Data.channels.length > 0, n = chans.length;
    U.show(els.g_empty, !any);
    U.show(els.gg, any);
    U.show(els.gd, any);
    U.setText(els.g_chip, '◀   ' + Data.category().name + '   ▶');
    U.toggleClass(els.g_chip, 'focus', active && focusOn === 'chip');
    U.toggleClass(els.gg, 'zone-active', active && focusOn === 'grid');
    U.show(els.g_ph, Player.kind !== 'live');
    if (!any) return;
    if (!n) {
      els.gg_rows.innerHTML = '';
      els.gg_rows.appendChild(U.el('div', 'lz-empty', Data.category().id === 'fav' ?
        'Aún no tienes favoritos. Pulsa el botón rojo (F) sobre un canal para añadirlo.' : 'No hay canales en esta categoría.'));
      U.setText(els.gd_title, '');
      U.setText(els.gd_meta, '');
      U.setText(els.gd_chan, '');
      U.setText(els.gd_desc, '');
      renderRuler();
      U.show(els.gg_now, false);
      return;
    }
    st.row = U.clamp(st.row, 0, n - 1);
    if (st.row < st.top) st.top = st.row;
    if (st.row > st.top + ROWS - 1) st.top = st.row - ROWS + 1;
    st.top = U.clamp(st.top, 0, Math.max(0, n - ROWS));
    for (var i = 0; i < chans.length; i++) chans[i]._blocks = null;
    renderRuler();
    renderRows();
    renderDetail();
    renderNow();
  }
  function renderRuler() {
    els.gg_ruler.innerHTML = '';
    for (var t = st.ws; t < st.ws + WIN; t += STEP) {
      var s = U.el('span', '', U.fmtClock(t));
      s.style.left = ((t - st.ws) / 60000 * PX) + 'px';
      els.gg_ruler.appendChild(s);
    }
    U.setText(els.gg_day, U.fmtDay(st.ws + 1));
  }
  function logoFor(c) {
    if (!logos[c.key]) logos[c.key] = U.logo(c.logo, c.name);
    return logos[c.key];
  }
  function renderRows() {
    els.gg_rows.innerHTML = '';
    var tnow = now(), end = Math.min(chans.length, st.top + ROWS);
    for (var r = st.top; r < end; r++) {
      var c = chans[r], row = U.el('div', 'gg-row');
      row.style.top = ((r - st.top) * ROW_H) + 'px';
      var ch = U.el('div', 'gg-ch' + (r === st.row ? ' cur' : ''));
      ch.setAttribute('data-row', r);
      ch.appendChild(U.el('span', 'gg-num', c.num));
      ch.appendChild(logoFor(c));
      ch.appendChild(U.el('span', 'gg-name', c.name));
      row.appendChild(ch);
      var track = U.el('div', 'gg-track'), bs = blocks(c), fb = r === st.row ? focusBlock(c) : null;
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i], s = Math.max(b.s, st.ws), e = Math.min(b.e, st.ws + WIN);
        var cell = U.el('div', 'gg-prog');
        if (b.gap) U.addClass(cell, 'gap');
        else if (b.e <= tnow) U.addClass(cell, 'past');
        else if (b.s <= tnow) U.addClass(cell, 'live');
        if (fb === b) U.addClass(cell, 'focus');
        cell.style.left = ((s - st.ws) / 60000 * PX + 2) + 'px';
        cell.style.width = Math.max(4, (e - s) / 60000 * PX - 4) + 'px';
        cell.appendChild(document.createTextNode(b.gap ? 'Sin información' : b.p.t));
        if (!b.gap && (e - s) >= 25 * 60000) cell.appendChild(U.el('span', 't', U.fmtRange(b.s, b.e)));
        cell.setAttribute('data-row', r);
        cell.setAttribute('data-t', s);
        track.appendChild(cell);
      }
      row.appendChild(track);
      els.gg_rows.appendChild(row);
    }
  }
  function renderDetail() {
    var c = chans[st.row], b = focusBlock(c), tnow = now();
    els.gd_title.innerHTML = '';
    if (!b || b.gap) {
      var gs = b ? Math.max(b.s, st.ws) : st.ws;
      U.setText(els.gd_title, 'Sin información de programación');
      U.setText(els.gd_meta, b ? U.fmtDay(gs) + '  ·  ' + U.fmtRange(gs, b.e) : '');
      U.setText(els.gd_desc, Data.epgState === 'loading' ? 'Cargando la guía…' : 'Este canal no tiene guía para este horario.');
    } else {
      if (b.s <= tnow && tnow < b.e) els.gd_title.appendChild(U.el('span', 'gd-live', 'EN VIVO'));
      els.gd_title.appendChild(document.createTextNode(b.p.t + (b.p.st ? ' · ' + b.p.st : '')));
      U.setText(els.gd_meta, U.fmtDay(b.s) + '  ·  ' + U.fmtRange(b.s, b.e) + '  ·  ' + U.fmtMinutes((b.e - b.s) / 1000));
      U.setText(els.gd_desc, b.p.d || '');
    }
    U.setText(els.gd_chan, c.num + '   ' + c.name + (Favs.has(c.key) ? '  ★' : ''));
  }
  function renderNow() {
    var d = now() - st.ws;
    U.show(els.gg_now, d >= 0 && d < WIN);
    els.gg_now.style.left = (300 + d / 60000 * PX) + 'px';
  }

  // ---------- Teclas ----------
  function setFocus(where) {
    focusOn = where;
    active = true;
    render();
  }
  function cycleCat(d) {
    var n = Data.cats.length;
    if (n) Data.setCat((Data.curCat + d + n) % n);
  }
  function tune(c) { if (c) Player.playLive(c, { full: true, ctxId: Data.category().id }); }
  function gridKey(k) {
    var n = chans.length;
    if (!n) { if (k === 'up') { setFocus('chip'); return true; } return false; }
    var c = chans[st.row], b = focusBlock(c);
    switch (k) {
      case 'right':
        var nt = b.e;
        while (nt >= st.ws + WIN && st.ws + STEP <= maxWs()) st.ws += STEP;
        if (nt < st.ws + WIN) st.ft = nt;
        render();
        return true;
      case 'left':
        var pt = b.s - 1;
        if (pt < st.ws) {
          if (st.ws - STEP < minWs()) return false;
          while (pt < st.ws && st.ws - STEP >= minWs()) st.ws -= STEP;
          if (pt < st.ws) pt = st.ws;
        }
        st.ft = pt;
        render();
        return true;
      case 'up':
        if (st.row > 0) st.row--; else { setFocus('chip'); return true; }
        render();
        return true;
      case 'down':
        if (st.row < n - 1) { st.row++; render(); }
        return true;
      case 'chup': st.row = Math.max(0, st.row - ROWS); render(); return true;
      case 'chdown': st.row = Math.min(n - 1, st.row + ROWS); render(); return true;
      case 'ok': tune(c); return true;
      case 'red':
        var on = Favs.toggle(c.key);
        Data.refreshFavs();
        Toast.show(on ? '★ ' + c.name + ' añadido a favoritos' : c.name + ' quitado de favoritos');
        return true;
    }
    return false;
  }

  S.show = function () {
    resetWindow();
    chans = Data.category().items;
    if (Player.kind === 'live') {
      for (var i = 0; i < chans.length; i++) if (chans[i].key === Player.item.key) { st.row = i; st.top = Math.max(0, i - 2); break; }
    }
    render();
  };
  S.focus = function () {
    active = true;
    if (!Data.channels.length) { render(); emptyZ.focus(); return; }
    render();
  };
  S.blur = function () {
    active = false;
    emptyZ.blur();
    render();
  };
  S.handleKey = function (k) {
    if (!Data.channels.length) return emptyZ.handleKey(k);
    if (focusOn === 'chip') {
      if (k === 'left' || k === 'right') { cycleCat(k === 'left' ? -1 : 1); return true; }
      if (k === 'down' || k === 'ok') { if (chans.length) setFocus('grid'); return true; }
      return k === 'up';
    }
    return gridKey(k);
  };
  S.back = function () {
    if (focusOn === 'chip' && chans.length) { setFocus('grid'); return true; }
    return false;
  };
  S.previewRect = function () { return App.rectOf(U.$('.preview-box', S.el)); };
  S.onPlayerExit = function () { setFocus('grid'); };

  return S;
})();
