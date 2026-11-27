/* Piezas de interfaz compartidas: menú lateral, avisos, ventanas de confirmación y reloj. */
var Menu = (function () {
  'use strict';
  var el, items, idx = 0, isOpen = false;
  function init() {
    el = U.$('#menu');
    items = U.$$('.menu-item', el);
    items.forEach(function (it, i) {
      it.addEventListener('mouseover', function () { if (!isOpen) App.focusMenu(); setIdx(i); });
      it.addEventListener('click', function () { App.go(it.getAttribute('data-screen')); });
    });
    U.$$('.app-name').forEach(function (n) { n.textContent = CONFIG.APP_NAME; });
  }
  function setIdx(i) {
    idx = i;
    items.forEach(function (it, j) { U.toggleClass(it, 'focus', j === idx); });
  }
  function setSelected(id) {
    items.forEach(function (it, j) {
      var on = it.getAttribute('data-screen') === id;
      U.toggleClass(it, 'selected', on);
      if (on) idx = j;
    });
    setIdx(idx);
  }
  function open() { isOpen = true; U.addClass(el, 'open'); setIdx(idx); }
  function close() { isOpen = false; U.removeClass(el, 'open'); }
  function handleKey(k) {
    if (k === 'up') { setIdx(Math.max(0, idx - 1)); return true; }
    if (k === 'down') { setIdx(Math.min(items.length - 1, idx + 1)); return true; }
    if (k === 'ok') {
      var id = items[idx].getAttribute('data-screen');
      if (App.cur && App.cur.id === id) App.focusScreen(); else App.go(id);
      return true;
    }
    if (k === 'right') { App.focusScreen(); return true; }
    if (k === 'back') { App.confirmExit(); return true; }
    return true;
  }
  return { init: init, open: open, close: close, setSelected: setSelected, handleKey: handleKey };
})();

var Toast = (function () {
  'use strict';
  var timer = null;
  function show(msg, ms) {
    var e = U.$('#toast');
    e.innerHTML = '';
    e.appendChild(U.el('span', '', msg));
    U.show(e, true);
    clearTimeout(timer);
    timer = setTimeout(function () { U.show(e, false); }, ms || 3000);
  }
  return { show: show };
})();

/* Ventana modal: Modal.show({title, text, buttons:[{label, value}], cancelValue, defaultIndex}) -> Promise */
var Modal = (function () {
  'use strict';
  var el = null, zone = null, isOpen = false, resolveFn = null, cancelValue = null;
  function close(v) {
    isOpen = false;
    U.show(el, false);
    el.innerHTML = '';
    var r = resolveFn;
    resolveFn = null;
    if (r) r(v);
  }
  function show(opts) {
    if (isOpen) close(cancelValue);
    return new Promise(function (resolve) {
      el = U.$('#modal');
      el.innerHTML = '';
      var box = U.el('div', 'modal-box');
      box.appendChild(U.el('div', 'modal-title', opts.title));
      if (opts.text) box.appendChild(U.el('div', 'modal-text', opts.text));
      if (opts.content) box.appendChild(opts.content);
      var row = U.el('div', 'modal-actions');
      opts.buttons.forEach(function (b) {
        var be = U.el('div', 'btn focusable', b.label);
        be.addEventListener('click', function () { close(b.value); });
        row.appendChild(be);
      });
      box.appendChild(row);
      el.appendChild(box);
      U.show(el, true);
      isOpen = true;
      resolveFn = resolve;
      cancelValue = opts.cancelValue === undefined ? null : opts.cancelValue;
      zone = new FormZone(box, {});
      zone.focus(row.children[opts.defaultIndex || 0]);
    });
  }
  function handleKey(k) {
    if (k === 'back') { close(cancelValue); return true; }
    zone.handleKey(k);
    return true;
  }
  return { show: show, handleKey: handleKey, close: function (v) { if (isOpen) close(v); }, isOpen: function () { return isOpen; } };
})();

/* Marcar un número de canal con el control remoto. */
var NumEntry = (function () {
  'use strict';
  var buf = '', timer = null;
  function push(d) {
    var e = U.$('#numentry');
    if (buf.length >= 4) buf = '';
    buf += String(d);
    e.textContent = buf;
    U.show(e, true);
    clearTimeout(timer);
    timer = setTimeout(commit, CONFIG.NUM_ENTRY_MS);
  }
  function commit() {
    var n = parseInt(buf, 10);
    buf = '';
    U.show(U.$('#numentry'), false);
    var ch = Data.byNum(n);
    if (!ch) { Toast.show('El canal ' + n + ' no existe'); return; }
    Player.playLive(ch, { full: true, ctxId: 'all' });
  }
  return { push: push };
})();

/* Fila de canal (número, logo, nombre y programa actual); se usa en TV en vivo y en la lista rápida. */
var ChannelRow = {
  build: function (c) {
    'use strict';
    var inn = U.el('div', 'row-in ch-row');
    inn.appendChild(U.el('div', 'ch-num', c.num));
    inn.appendChild(U.logo(c.logo, c.name));
    var txt = U.el('div', 'ch-txt');
    txt.appendChild(U.el('div', 'ch-name', c.name));
    var nn = Data.nowNext(c);
    txt.appendChild(U.el('div', 'ch-prog muted', nn && nn.now ? nn.now.t : (c.group || '')));
    if (nn && nn.now) txt.appendChild(U.pbar(Data.progress(nn.now)));
    inn.appendChild(txt);
    if (Favs.has(c.key)) inn.appendChild(U.el('div', 'ch-fav', '★'));
    if (Player.isLive(c)) inn.appendChild(U.el('div', 'ch-live', 'VIENDO'));
    return inn;
  }
};

var Clock = (function () {
  'use strict';
  function tick() {
    var t = U.fmtClock();
    U.$$('.clock').forEach(function (e) { e.textContent = t; });
  }
  function start() { tick(); setInterval(tick, 10000); }
  return { start: start, tick: tick };
})();
