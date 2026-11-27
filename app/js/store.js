/* Guardado local en el TV: ajustes, favoritos y "continuar viendo". */
var Store = (function () {
  'use strict';
  var P = CONFIG.STORAGE_PREFIX;
  function get(k, def) {
    try {
      var v = window.localStorage.getItem(P + k);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function set(k, v) {
    try { window.localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function remove(k) { try { window.localStorage.removeItem(P + k); } catch (e) { /* nada */ } }
  function clearAll() {
    try {
      var ks = [], i;
      for (i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(P) === 0) ks.push(k);
      }
      for (i = 0; i < ks.length; i++) window.localStorage.removeItem(ks[i]);
    } catch (e) { /* nada */ }
  }
  return { get: get, set: set, remove: remove, clearAll: clearAll };
})();

var Favs = (function () {
  'use strict';
  var list = null, set = {};
  function load() {
    list = Store.get('favs', []);
    set = {};
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
  }
  function has(key) { if (!list) load(); return !!set[key]; }
  function toggle(key) {
    if (!list) load();
    if (set[key]) { delete set[key]; list.splice(list.indexOf(key), 1); } else { set[key] = true; list.push(key); }
    Store.set('favs', list);
    return !!set[key];
  }
  return { load: load, has: has, toggle: toggle };
})();

/* Posición guardada de películas de listas M3U (las de Jellyfin las guarda el servidor). */
var Resume = (function () {
  'use strict';
  var MAX = 60, map = null;
  function all() { if (!map) map = Store.get('resume', {}); return map; }
  function get(id) { return all()[id] || null; }
  function save(id, info) {
    var m = all();
    info.t = Date.now();
    m[id] = info;
    var keys = Object.keys(m);
    if (keys.length > MAX) {
      keys.sort(function (a, b) { return m[a].t - m[b].t; });
      for (var i = 0; i < keys.length - MAX; i++) delete m[keys[i]];
    }
    Store.set('resume', m);
  }
  function remove(id) { var m = all(); if (m[id]) { delete m[id]; Store.set('resume', m); } }
  function list() {
    var m = all();
    return Object.keys(m).map(function (k) { var v = m[k]; v.id = k; return v; }).sort(function (a, b) { return b.t - a.t; });
  }
  function reset() { map = null; }
  return { get: get, save: save, remove: remove, list: list, reset: reset };
})();
