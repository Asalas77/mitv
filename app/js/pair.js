/*
 * "Agregar con el celular": el TV muestra un código y un QR; desde el celular se abre
 * CONFIG.PAIR_SITE/vincular.html, se pega la lista y el TV la recibe consultando
 * CONFIG.PAIR_SITE/api/vincular cada pocos segundos.
 */
var Pair = (function () {
  'use strict';
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', POLL_MS = 3000, MAX_MS = 15 * 60000;
  var timer = null, code = '', started = 0, statusEl = null;

  function newCode() {
    var s = '';
    for (var i = 0; i < 6; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return s;
  }
  function stop() { clearTimeout(timer); timer = null; }

  function poll() {
    if (Date.now() - started > MAX_MS) { U.setText(statusEl, 'El código caducó. Cierra y vuelve a abrir esta ventana.'); return; }
    U.request(CONFIG.PAIR_SITE + '/api/vincular?c=' + code, { timeout: 10000 }).then(function (xhr) {
      var r = JSON.parse(xhr.responseText || '{}');
      if (r.ok && r.list) { receive(r.list); return; }
      timer = setTimeout(poll, POLL_MS);
    }, function () {
      U.setText(statusEl, 'Sin conexión con el servidor, reintentando…');
      timer = setTimeout(poll, POLL_MS * 2);
    });
  }

  function receive(l) {
    stop();
    Modal.close(null);
    var item = { id: U.uid(), name: l.name || (l.kind === 'vod' ? 'Películas (celular)' : 'Lista (celular)'), url: l.url, epg: l.epg || '' };
    Toast.show('Lista recibida desde el celular. Cargando…', 4000);
    if (l.kind === 'vod') {
      var v = Data.vodLists(); v.push(item); Data.saveVodLists(v);
      Data.loadVod().then(function () {
        var i = Data.vodInfo[item.id];
        Toast.show(i && i.error ? 'No se pudo cargar: ' + i.error : 'Lista agregada: ' + (i ? i.count : 0) + ' títulos', 5000);
      });
    } else {
      var lists = Data.liveLists(); lists.push(item); Data.saveLiveLists(lists);
      Data.loadLive().then(function () {
        var i = Data.listInfo[item.id];
        Toast.show(i && i.error ? 'No se pudo cargar: ' + i.error : 'Lista agregada: ' + (i ? i.count : 0) + ' canales', 5000);
      });
    }
  }

  function open() {
    stop();
    code = newCode();
    started = Date.now();
    var url = CONFIG.PAIR_SITE + '/vincular.html?c=' + code;
    var box = U.el('div', 'pair');
    var qrBox = U.el('div', 'pair-qr');
    try {
      var qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrBox.innerHTML = qr.createImgTag(7, 4);
    } catch (e) {
      qrBox.textContent = 'No se pudo dibujar el código QR';
    }
    var info = U.el('div', 'pair-info');
    info.appendChild(U.el('div', 'pair-step', '1. Escanea el código con la cámara del celular'));
    info.appendChild(U.el('div', 'pair-step', '2. Pega la dirección de tu lista y pulsa Enviar'));
    info.appendChild(U.el('div', 'pair-alt', 'O entra a ' + CONFIG.PAIR_SITE.replace(/^https?:\/\//, '') + '/vincular.html y escribe este código:'));
    info.appendChild(U.el('div', 'pair-code', code.slice(0, 3) + '-' + code.slice(3)));
    statusEl = U.el('div', 'pair-status', 'Esperando la lista…');
    info.appendChild(statusEl);
    box.appendChild(qrBox);
    box.appendChild(info);
    Modal.show({ title: 'Agregar una lista con el celular', content: box, buttons: [{ label: 'Cerrar', value: null }], cancelValue: null }).then(stop);
    timer = setTimeout(poll, POLL_MS);
  }

  return { open: open };
})();
