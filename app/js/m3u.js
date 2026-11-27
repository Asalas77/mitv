/*
 * Lector de listas M3U / M3U8 ("extended M3U", el formato que entregan los proveedores de IPTV):
 *   #EXTM3U url-tvg="http://.../guia.xml"
 *   #EXTINF:-1 tvg-id="canal1" tvg-logo="http://.../logo.png" group-title="Noticias",Canal 1
 *   http://.../canal1.m3u8
 */
var M3U = (function () {
  'use strict';
  var ATTR_RE = /([A-Za-z0-9_\-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"',]+))/g;

  function parseAttrs(s) {
    var out = {}, m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(s)) !== null) {
      out[m[1].toLowerCase()] = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]);
    }
    return out;
  }

  // Separa "atributos,Nombre del canal" respetando comas dentro de comillas.
  function splitExtinf(s) {
    var q = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) { if (ch === q) q = ''; }
      else if (ch === '"' || (ch === "'" && s.charAt(i - 1) === '=')) q = ch;
      else if (ch === ',') return [s.slice(0, i), s.slice(i + 1)];
    }
    return [s, ''];
  }

  function parse(text, baseUrl) {
    var lines = String(text || '').split(/\r\n|\r|\n/);
    var header = {}, entries = [], cur = null, pendingGroup = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.charAt(0) === '#') {
        var tag = line.slice(0, 8).toUpperCase();
        if (tag.indexOf('#EXTM3U') === 0) {
          header = parseAttrs(line.slice(7));
        } else if (tag === '#EXTINF:') {
          var parts = splitExtinf(line.slice(8));
          var dm = /^\s*(-?\d+(?:\.\d+)?)/.exec(parts[0]);
          cur = { attrs: parseAttrs(parts[0]), name: parts[1].trim(), duration: dm ? parseFloat(dm[1]) : -1, group: pendingGroup };
          pendingGroup = '';
        } else if (tag === '#EXTGRP:') {
          var g = line.slice(8).trim();
          if (cur) cur.group = g; else pendingGroup = g;
        }
        continue;
      }
      var a = cur ? cur.attrs : {};
      entries.push({
        name: (cur && cur.name) || a['tvg-name'] || line.split('/').pop() || 'Sin nombre',
        url: U.resolveUrl(baseUrl, line),
        logo: a['tvg-logo'] ? U.resolveUrl(baseUrl, a['tvg-logo']) : '',
        group: (a['group-title'] || (cur && cur.group) || '').trim(),
        tvgId: (a['tvg-id'] || '').trim(),
        tvgName: (a['tvg-name'] || '').trim(),
        shift: parseFloat(a['tvg-shift']) || 0,
        duration: cur ? cur.duration : -1,
        desc: a.description || a['tvg-description'] || '',
        year: a.year || a['tvg-year'] || ''
      });
      cur = null;
    }
    return { header: header, entries: entries };
  }

  return { parse: parse, parseAttrs: parseAttrs };
})();
