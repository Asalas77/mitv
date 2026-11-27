/* Utilidades generales: DOM, formato de horas, red y textos. */
var U = (function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function addClass(e, c) { if (e && e.classList) e.classList.add(c); }
  function removeClass(e, c) { if (e && e.classList) e.classList.remove(c); }
  function hasClass(e, c) { return !!(e && e.classList && e.classList.contains(c)); }
  function toggleClass(e, c, on) { if (on) addClass(e, c); else removeClass(e, c); }
  function show(e, on) { toggleClass(e, 'hidden', !on); }
  function setText(e, t) { if (e) e.textContent = (t === undefined || t === null) ? '' : String(t); }

  function closest(node, test, stop) {
    while (node && node !== stop && node.nodeType === 1) {
      if (test(node)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function closestAttr(node, attr, stop) { return closest(node, function (n) { return n.hasAttribute(attr); }, stop); }

  // ---------- Fechas y duraciones ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(ms) { var d = ms === undefined ? new Date() : new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function fmtRange(s, e) { return fmtClock(s) + ' – ' + fmtClock(e); }
  function dayStart(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  var DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function fmtDay(ms) {
    var diff = Math.round((dayStart(ms) - dayStart(Date.now())) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    if (diff === -1) return 'Ayer';
    var d = new Date(ms);
    return DAYS[d.getDay()] + ' ' + d.getDate();
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s);
  }
  function fmtMinutes(sec) {
    var m = Math.round((sec || 0) / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }
  function hash(s) {
    s = String(s || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // ---------- Textos ----------
  function initials(name) {
    var clean = String(name || '').replace(/[\[\(][^\]\)]*[\]\)]/g, ' ').replace(/[^0-9A-Za-zÀ-ÿ ]+/g, ' ').trim();
    if (!clean) return '?';
    var w = clean.split(/\s+/);
    return (w[0].charAt(0) + (w.length > 1 ? w[1].charAt(0) : w[0].charAt(1))).toUpperCase();
  }
  // Normaliza nombres de canal para cruzarlos con la guía ("Canal Uno HD" = "canal uno").
  function normName(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
    s = s.replace(/\b(hd|fhd|uhd|sd|4k|hevc|h265|720p|1080p)\b/g, ' ');
    return s.replace(/[^a-z0-9]+/g, '');
  }

  // Imagen con respaldo: si no hay imagen o no carga, se ven las iniciales.
  function imageBox(cls, phCls, phText, phColor, url, imgCls) {
    var box = el('div', cls);
    var ph = el('div', phCls);
    ph.appendChild(el('span', '', phText));
    ph.style.backgroundColor = phColor;
    box.appendChild(ph);
    if (url) {
      var img = document.createElement('img');
      img.className = imgCls;
      img.onload = function () { ph.style.visibility = 'hidden'; };
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
      img.src = url;
      box.appendChild(img);
    }
    return box;
  }
  function logo(url, name, extra) {
    return imageBox('logo' + (extra ? ' ' + extra : ''), 'logo-ph', initials(name), 'hsl(' + (hash(name) % 360) + ',38%,30%)', url, 'logo-img');
  }
  function poster(url, title, extra) {
    return imageBox('poster' + (extra ? ' ' + extra : ''), 'poster-ph', title || '', 'hsl(' + (hash(title) % 360) + ',30%,22%)', url, 'poster-img');
  }
  function pbar(pct, extra) {
    var b = el('div', 'pbar' + (extra ? ' ' + extra : ''));
    var f = el('i');
    f.style.width = clamp(pct || 0, 0, 100) + '%';
    b.appendChild(f);
    return b;
  }

  // ---------- Red ----------
  function httpError(msg, status) { var e = new Error(msg); e.status = status || 0; return e; }
  function httpMessage(s) {
    if (s === 401 || s === 403) return 'Acceso denegado (' + s + ')';
    if (s === 404) return 'No se encontró la dirección (404)';
    return 'Error del servidor (' + s + ')';
  }
  function request(url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      try { xhr.open(opts.method || 'GET', url, true); } catch (e) { reject(httpError('La dirección no es válida', 0)); return; }
      if (opts.responseType) xhr.responseType = opts.responseType;
      xhr.timeout = opts.timeout || 30000;
      var h = opts.headers || {};
      for (var k in h) { if (h.hasOwnProperty(k)) xhr.setRequestHeader(k, h[k]); }
      xhr.onload = function () {
        var ok = xhr.status >= 200 && xhr.status < 300;
        if (!ok && xhr.status === 0) ok = !!xhr.response;   // archivos locales (file://) devuelven 0
        if (ok) resolve(xhr); else reject(httpError(httpMessage(xhr.status), xhr.status));
      };
      xhr.onerror = function () { reject(httpError('No se pudo conectar con el servidor', 0)); };
      xhr.ontimeout = function () { reject(httpError('El servidor tardó demasiado en responder', 0)); };
      xhr.send(opts.body === undefined ? null : opts.body);
    });
  }
  function decodeText(buf) {
    var bytes = new Uint8Array(buf), s;
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) {
        try { return new TextDecoder('windows-1252').decode(bytes); } catch (e2) { /* sigue abajo */ }
      }
    }
    s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    try { s = decodeURIComponent(escape(s)); } catch (e3) { /* texto latino sin convertir */ }
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return s;
  }
  // Convierte la respuesta en texto; descomprime .gz si el TV lo permite.
  function bufferToText(buf) {
    var b = new Uint8Array(buf);
    if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
      if (typeof window.DecompressionStream === 'undefined' || typeof window.Response === 'undefined' || !Blob.prototype.stream) {
        return Promise.reject(new Error('El archivo está comprimido (.gz) y este TV no puede descomprimirlo; usa la versión .xml'));
      }
      var stream = new Blob([buf]).stream().pipeThrough(new window.DecompressionStream('gzip'));
      return new window.Response(stream).arrayBuffer().then(decodeText);
    }
    return Promise.resolve(decodeText(buf));
  }
  function fetchText(url, opts) {
    opts = opts || {};
    return request(url, { responseType: 'arraybuffer', timeout: opts.timeout || 60000, headers: opts.headers }).then(function (xhr) {
      return bufferToText(xhr.response);
    });
  }
  function isAbsolute(u) { return /^[a-z][a-z0-9+.\-]*:/i.test(u); }
  function absolute(u) {
    if (isAbsolute(u)) return u;
    var a = document.createElement('a');
    a.href = u;
    return a.href;
  }
  // Resuelve direcciones relativas dentro de una lista (logos, streams).
  function resolveUrl(base, rel) {
    if (!rel) return '';
    rel = String(rel).trim();
    if (isAbsolute(rel)) return rel;
    var b = base ? absolute(base) : location.href;
    if (rel.indexOf('//') === 0) return b.split(':')[0] + ':' + rel;
    try { return new URL(rel, b).href; } catch (e) { /* TVs sin URL() */ }
    try {
      var doc = document.implementation.createHTMLDocument('');
      var be = doc.createElement('base');
      be.href = b;
      doc.head.appendChild(be);
      var a = doc.createElement('a');
      a.href = rel;
      doc.body.appendChild(a);
      return a.href;
    } catch (e2) { return rel; }
  }

  return {
    $: $, $$: $$, el: el, addClass: addClass, removeClass: removeClass, hasClass: hasClass,
    toggleClass: toggleClass, show: show, setText: setText, closest: closest, closestAttr: closestAttr,
    pad2: pad2, fmtClock: fmtClock, fmtRange: fmtRange, fmtDay: fmtDay, fmtDuration: fmtDuration,
    fmtMinutes: fmtMinutes, clamp: clamp, uid: uid, debounce: debounce, hash: hash,
    initials: initials, normName: normName, logo: logo, poster: poster, pbar: pbar,
    request: request, fetchText: fetchText, bufferToText: bufferToText, resolveUrl: resolveUrl
  };
})();
