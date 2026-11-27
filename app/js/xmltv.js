/*
 * Lector de guías de programación XMLTV (.xml, o .xml.gz en TVs que pueden descomprimir).
 * Procesa los programas por partes para que el TV siga respondiendo mientras carga.
 */
var XMLTV = (function () {
  'use strict';
  var TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/;
  var SUB_RE = /<sub-title\b[^>]*>([\s\S]*?)<\/sub-title>/;
  var DESC_RE = /<desc\b[^>]*>([\s\S]*?)<\/desc>/;
  var ATTR_RE = /([\w:\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  var CDATA_RE = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;
  var CHUNK = 1500;

  function fromCode(n) {
    if (isNaN(n)) return '';
    if (n > 0xFFFF) { n -= 0x10000; return String.fromCharCode(0xD800 + (n >> 10), 0xDC00 + (n & 0x3FF)); }
    return String.fromCharCode(n);
  }
  function decode(s) {
    if (!s || s.indexOf('&') < 0) return s || '';
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      if (e.charAt(1) === 'x' || e.charAt(1) === 'X') return fromCode(parseInt(e.slice(2), 16));
      return fromCode(parseInt(e.slice(1), 10));
    });
  }
  function tagText(body, re) {
    var m = re.exec(body);
    if (!m) return '';
    var c = CDATA_RE.exec(m[1]);
    if (c) return c[1].trim();
    return decode(m[1].replace(/<[^>]+>/g, '')).trim();
  }
  function attrs(s) {
    var out = {}, m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(s)) !== null) out[m[1]] = decode(m[2] !== undefined ? m[2] : m[3]);
    return out;
  }
  // "20261124190000 +0100" -> milisegundos UTC
  function parseTime(s) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+\-]\d{2}:?\d{2})?/.exec(String(s || '').trim());
    if (!m) return NaN;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) {
      var z = m[7].replace(':', ''), sign = z.charAt(0) === '-' ? -1 : 1;
      t -= sign * ((+z.substr(1, 2)) * 60 + (+z.substr(3, 2))) * 60000;
    }
    return t;
  }

  /*
   * opts.from / opts.to: ventana de tiempo que se conserva.
   * opts.wanted(canales): devuelve {idEnMinúsculas: true} con los canales que interesan (o null = todos).
   */
  function parse(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var channels = {}, m, d;
      var chRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
      var dnRe = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g;
      while ((m = chRe.exec(text)) !== null) {
        var id = attrs(m[1]).id;
        if (!id) continue;
        var names = [];
        dnRe.lastIndex = 0;
        while ((d = dnRe.exec(m[2])) !== null) names.push(decode(d[1]).trim());
        channels[id] = names;
      }
      var wanted = opts.wanted ? opts.wanted(channels) : null;
      var from = opts.from || 0, to = opts.to || 8640000000000000;
      var progs = {}, count = 0, pRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;

      function step() {
        var n = 0, pm = null;
        while (n < CHUNK && (pm = pRe.exec(text)) !== null) {
          n++;
          var a = attrs(pm[1]), ch = a.channel;
          if (!ch || (wanted && !wanted[ch.toLowerCase()])) continue;
          var s = parseTime(a.start);
          if (isNaN(s) || s > to) continue;
          var e = parseTime(a.stop), noStop = isNaN(e);
          if (noStop) e = s + 3600000;
          if (e < from) continue;
          var p = { s: s, e: e, t: tagText(pm[2], TITLE_RE) || 'Sin título', st: tagText(pm[2], SUB_RE), d: tagText(pm[2], DESC_RE) };
          if (noStop) p.ns = true;
          (progs[ch] || (progs[ch] = [])).push(p);
          count++;
        }
        if (pm !== null) { setTimeout(step, 0); return; }
        for (var k in progs) {
          if (!progs.hasOwnProperty(k)) continue;
          var list = progs[k];
          list.sort(function (x, y) { return x.s - y.s; });
          for (var i = 0; i < list.length - 1; i++) if (list[i].ns) list[i].e = list[i + 1].s;
        }
        resolve({ channels: channels, programmes: progs, count: count });
      }
      step();
    });
  }

  return { parse: parse, parseTime: parseTime };
})();
