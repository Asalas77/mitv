/* Carga y organiza los canales, la guía de programación y el catálogo de películas. */
var Data = (function () {
  'use strict';
  var D = {
    channels: [], byKey: {}, cats: [], curCat: 0, epgUrls: [],
    liveState: 'idle', listInfo: {},
    epg: {}, epgState: 'idle', epgInfo: [],
    vodGroups: [], vodState: 'idle', vodInfo: {},
    _ls: {}, _liveGen: 0, _vodGen: 0
  };

  D.on = function (ev, fn) { (D._ls[ev] || (D._ls[ev] = [])).push(fn); };
  D.emit = function (ev, arg) {
    var l = D._ls[ev] || [];
    for (var i = 0; i < l.length; i++) {
      try { l[i](arg); } catch (e) { if (window.console) console.error(e); }
    }
  };

  // Si nunca se guardaron listas, se empieza con las de CONFIG.DEFAULT_LISTS (se pueden eliminar en Ajustes).
  D.liveLists = function () {
    var l = Store.get('lists', null);
    if (l === null) { l = CONFIG.DEFAULT_LISTS.slice(); Store.set('lists', l); }
    return l;
  };
  D.vodLists = function () { return Store.get('vodLists', []); };
  D.saveLiveLists = function (l) { Store.set('lists', l); };
  D.saveVodLists = function (l) { Store.set('vodLists', l); };

  function fetchList(l) {
    return U.fetchText(l.url).then(function (txt) {
      return { list: l, parsed: M3U.parse(txt, l.url) };
    }, function (err) {
      return { list: l, error: err };
    });
  }

  /*
   * Separación automática: decide si una entrada de una lista de canales es en realidad una
   * película ('movie') o un episodio ('series'). Devuelve null si es un canal en vivo.
   * Se basa en la dirección (formato Xtream: /movie/ y /series/), la extensión del archivo
   * y la categoría (group-title).
   */
  var VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|webm|wmv|flv)$/i;
  var SERIES_GROUP = /(^|[\s|:\[(-])(series?|temporada|season|novelas?|anime)(\b|$)/i;
  var MOVIE_GROUP = /(^|[\s|:\[(-])(vod|pel[ií]culas?|peliculas?|movies?|films?|cine|estrenos?)(\b|$)/i;
  D.classify = function (e) {
    var path = String(e.url || '').split('?')[0].split('#')[0];
    // Formato Xtream: .../series/usuario/clave/123.mkv y .../movie/usuario/clave/123.mp4
    if (/\/series\/[^\/]+\/[^\/]+\/\d+\.\w+$/i.test(path)) return 'series';
    if (/\/movie\/[^\/]+\/[^\/]+\/\d+\.\w+$/i.test(path)) return 'movie';
    // "#EXTINF:-1" marca una transmisión en vivo: no se mueve aunque el enlace sea .mp4.
    if (e.duration < 0 || /\.(m3u8|ts|mpd)$/i.test(path)) return null;
    if (VOD_EXT.test(path)) return SERIES_GROUP.test(e.group || '') ? 'series' : 'movie';
    if (SERIES_GROUP.test(e.group || '')) return 'series';
    if (MOVIE_GROUP.test(e.group || '')) return 'movie';
    return null;
  };
  D.liveVodGroups = [];

  // Las listas desactivadas en Ajustes se conservan pero no se cargan.
  function isEnabled(l) { return !l.disabled; }

  // ---------- Canales ----------
  D.loadLive = function () {
    var gen = ++D._liveGen, lists = D.liveLists().filter(isEnabled);
    D.liveState = 'loading';
    D.emit('live');
    return Promise.all(lists.map(fetchList)).then(function (res) {
      if (gen !== D._liveGen) return;
      var chans = [], epgUrls = [], seenEpg = {}, info = {}, vodGroups = [], vodByName = {};
      res.forEach(function (r) {
        var l = r.list;
        if (r.error) { info[l.id] = { error: r.error.message }; return; }
        var hdr = r.parsed.header, hShift = parseFloat(hdr['tvg-shift']) || 0;
        var epg = l.epg || hdr['url-tvg'] || hdr['x-tvg-url'] || '';
        epg.split(',').forEach(function (u) {
          u = u.trim();
          if (!u) return;
          u = U.resolveUrl(l.url, u);
          if (!seenEpg[u]) { seenEpg[u] = true; epgUrls.push(u); }
        });
        var nLive = 0, nVod = 0;
        r.parsed.entries.forEach(function (e) {
          var kind = D.classify(e);
          if (kind) {
            // Película o episodio dentro de una lista de canales: va a "Películas y series".
            var gname = e.group || (kind === 'series' ? 'Series' : 'Películas'), g = vodByName[gname];
            if (!g) { g = vodByName[gname] = { name: gname, items: [] }; vodGroups.push(g); }
            g.items.push({ id: 'm3u:' + e.url, source: 'm3u', type: 'video', title: e.name, poster: e.logo, url: e.url,
              group: gname, overview: e.desc, year: e.year, runtime: e.duration > 0 ? e.duration : 0 });
            nVod++;
            return;
          }
          e.listId = l.id;
          e.demo = !!l.demo;
          if (!e.shift) e.shift = hShift;
          chans.push(e);
          nLive++;
        });
        info[l.id] = { count: nLive, vod: nVod };
      });
      D.liveVodGroups = vodGroups;
      var byKey = {};
      chans.forEach(function (c, i) {
        var base = c.listId + ':' + (c.tvgId || c.tvgName || c.name), key = base, k = 2;
        while (byKey[key]) key = base + '#' + (k++);
        c.key = key;
        c.idx = i;
        c.num = i + 1;
        byKey[key] = c;
      });
      D.channels = chans;
      D.byKey = byKey;
      D.listInfo = info;
      D.epgUrls = epgUrls;
      D.epg = {};
      buildCats();
      D.liveState = 'ready';
      D.emit('live');
      D.emit('vod');
      D.loadEpg();
    });
  };

  function favItems() { return D.channels.filter(function (c) { return Favs.has(c.key); }); }
  function buildCats() {
    var prevId = D.cats[D.curCat] ? D.cats[D.curCat].id : Store.get('cat', 'all');
    var cats = [
      { id: 'all', name: 'Todos los canales', items: D.channels },
      { id: 'fav', name: 'Favoritos', items: favItems() }
    ];
    var groups = {}, order = [];
    D.channels.forEach(function (c) {
      var g = c.group || 'Sin categoría';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(c);
    });
    order.forEach(function (g) { cats.push({ id: 'g:' + g, name: g, items: groups[g] }); });
    if (D.query) cats.unshift({ id: 'search', name: 'Resultados: ' + D.query, items: searchItems(D.query) });
    D.cats = cats;
    D.curCat = Math.max(0, D.catIndex(prevId));
  }
  D.refreshFavs = function () { var f = D.catById('fav'); if (f) f.items = favItems(); D.emit('favs'); };

  // ---------- Buscador ----------
  function fold(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s;
  }
  // Busca por número exacto o por palabras del nombre o la categoría (todas deben aparecer).
  function searchItems(q) {
    var words = fold(q).split(/\s+/).filter(function (w) { return w; });
    var first = /^\d+$/.test(q) ? D.byNum(parseInt(q, 10)) : null;
    var found = D.channels.filter(function (c) {
      if (c === first) return false;
      var hay = fold(c.name + ' ' + c.group);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    });
    return first ? [first].concat(found) : found;
  }
  D.query = '';
  // Crea/actualiza la categoría "Resultados" (al principio) y la selecciona; con texto vacío la quita.
  D.search = function (q) {
    q = String(q || '').trim();
    D.query = q;
    var i = D.catIndex('search');
    if (!q) {
      if (i >= 0) { D.cats.splice(i, 1); D.curCat = 0; }
      D.emit('cat');
      return;
    }
    var cat = { id: 'search', name: 'Resultados: ' + q, items: searchItems(q) };
    if (i >= 0) D.cats[i] = cat; else D.cats.unshift(cat);
    D.curCat = 0;
    D.emit('cat');
  };
  D.category = function () { return D.cats[D.curCat] || { id: 'all', name: 'Todos los canales', items: D.channels }; };
  D.catIndex = function (id) {
    for (var i = 0; i < D.cats.length; i++) if (D.cats[i].id === id) return i;
    return -1;
  };
  D.catById = function (id) { var i = D.catIndex(id); return i >= 0 ? D.cats[i] : null; };
  D.setCat = function (i, silent) {
    if (!D.cats[i]) return;
    D.curCat = i;
    Store.set('cat', D.cats[i].id);
    if (!silent) D.emit('cat');
  };
  D.byNum = function (n) { return D.channels[n - 1] || null; };

  // ---------- Guía de programación ----------
  D.programmes = function (c) { return (c && D.epg[c.key]) || null; };
  D.nowNext = function (c, t) {
    var list = D.programmes(c);
    if (!list || !list.length) return null;
    t = t || Date.now();
    var lo = 0, hi = list.length - 1, idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return { now: idx >= 0 && list[idx].e > t ? list[idx] : null, next: list[idx + 1] || null };
  };
  D.progress = function (p, t) {
    t = t || Date.now();
    if (!p || p.e <= p.s) return 0;
    return U.clamp((t - p.s) / (p.e - p.s) * 100, 0, 100);
  };

  D.loadEpg = function () {
    var gen = D._liveGen, urls = D.epgUrls || [];
    D.epg = {};
    D.epgInfo = [];
    D.channels.forEach(function (c, i) { if (c.demo) D.epg[c.key] = demoEpg(i); });
    if (!urls.length) {
      D.epgState = 'none';
      D.emit('epg');
      return Promise.resolve();
    }
    D.epgState = 'loading';
    D.emit('epg');
    var chain = Promise.resolve();
    urls.forEach(function (u) {
      chain = chain.then(function () {
        if (gen !== D._liveGen) return null;
        return loadOneEpg(u, gen).then(function (n) {
          D.epgInfo.push({ url: u, count: n });
        }, function (e) {
          D.epgInfo.push({ url: u, error: e.message });
        });
      });
    });
    return chain.then(function () {
      if (gen !== D._liveGen) return;
      D.epgState = 'ready';
      D.emit('epg');
    });
  };

  function loadOneEpg(url, gen) {
    var now = Date.now(), mapping = {};
    return U.fetchText(url, { timeout: 180000 }).then(function (text) {
      if (gen !== D._liveGen) return 0;
      return XMLTV.parse(text, {
        from: now - CONFIG.EPG_PAST_HOURS * 3600000,
        to: now + CONFIG.EPG_FUTURE_HOURS * 3600000,
        wanted: function (chMap) {
          mapping = mapChannels(chMap);
          var w = {};
          for (var k in mapping) if (mapping.hasOwnProperty(k)) w[mapping[k].toLowerCase()] = true;
          return w;
        }
      }).then(function (res) {
        if (gen !== D._liveGen) return 0;
        var lower = {}, id, n = 0;
        for (id in res.programmes) if (res.programmes.hasOwnProperty(id)) lower[id.toLowerCase()] = res.programmes[id];
        D.channels.forEach(function (c) {
          if (D.epg[c.key] || !mapping[c.key]) return;
          var list = lower[mapping[c.key].toLowerCase()];
          if (!list) return;
          if (c.shift) {
            var off = c.shift * 3600000;
            list = list.map(function (p) { return { s: p.s + off, e: p.e + off, t: p.t, st: p.st, d: p.d }; });
          }
          D.epg[c.key] = list;
          n++;
        });
        D.emit('epg');
        return n;
      });
    });
  }

  // Cruza cada canal de la lista con un canal de la guía: por tvg-id, tvg-name o nombre.
  function mapChannels(chMap) {
    var byLower = {}, byName = {}, id, i, k;
    for (id in chMap) {
      if (!chMap.hasOwnProperty(id)) continue;
      byLower[id.toLowerCase()] = id;
      k = U.normName(id);
      if (k && !byName[k]) byName[k] = id;
      for (i = 0; i < chMap[id].length; i++) {
        k = U.normName(chMap[id][i]);
        if (k && !byName[k]) byName[k] = id;
      }
    }
    var map = {};
    D.channels.forEach(function (c) {
      if (D.epg[c.key]) return;
      var found = null;
      if (c.tvgId) found = chMap.hasOwnProperty(c.tvgId) ? c.tvgId : (byLower[c.tvgId.toLowerCase()] || null);
      if (!found && c.tvgName) found = byName[U.normName(c.tvgName)] || null;
      if (!found) found = byName[U.normName(c.name)] || null;
      if (!found && c.tvgId) found = c.tvgId;
      if (found) map[c.key] = found;
    });
    return map;
  }

  // Guía de ejemplo para los canales de demostración (no hay guía real para señales de prueba).
  var DEMO_TITLES = ['Noticias de la mañana', 'Documental: océanos', 'Cine de la tarde', 'Resumen deportivo',
    'Música en vivo', 'Serie de estreno', 'Cocina fácil', 'Viajes por el mundo', 'Ciencia y tecnología',
    'Dibujos animados', 'Debate de actualidad', 'Noticias de la noche'];
  var DEMO_LEN = [30, 45, 60, 60, 90, 120, 30, 60];
  function demoEpg(seed) {
    var step = 1800000, now = Date.now(), out = [], i = 0;
    var t = Math.floor((now - CONFIG.EPG_PAST_HOURS * 3600000) / step) * step, end = now + 26 * 3600000;
    while (t < end) {
      var len = DEMO_LEN[(i * 3 + seed) % DEMO_LEN.length] * 60000;
      out.push({ s: t, e: t + len, t: DEMO_TITLES[(i + seed * 5) % DEMO_TITLES.length], st: '',
        d: 'Programación de ejemplo generada por la app para mostrar la guía. Con tu propia lista y su guía XMLTV aquí aparece la información real del canal.' });
      t += len;
      i++;
    }
    return out;
  }

  // ---------- Películas y series desde listas M3U ----------
  D.loadVod = function () {
    var gen = ++D._vodGen, lists = D.vodLists().filter(isEnabled);
    if (!lists.length) {
      D.vodGroups = [];
      D.vodInfo = {};
      D.vodState = 'ready';
      D.emit('vod');
      return Promise.resolve();
    }
    D.vodState = 'loading';
    D.emit('vod');
    return Promise.all(lists.map(fetchList)).then(function (res) {
      if (gen !== D._vodGen) return;
      var groups = [], byName = {}, info = {};
      res.forEach(function (r) {
        var l = r.list;
        if (r.error) { info[l.id] = { error: r.error.message }; return; }
        r.parsed.entries.forEach(function (e) {
          var gname = e.group || l.name || 'Películas', g = byName[gname];
          if (!g) { g = byName[gname] = { name: gname, items: [] }; groups.push(g); }
          g.items.push({
            id: 'm3u:' + e.url, source: 'm3u', type: 'video', title: e.name, poster: e.logo, url: e.url,
            group: gname, overview: e.desc, year: e.year, runtime: e.duration > 0 ? e.duration : 0
          });
        });
        info[l.id] = { count: r.parsed.entries.length };
      });
      D.vodGroups = groups;
      D.vodInfo = info;
      D.vodState = 'ready';
      D.emit('vod');
    });
  };

  D.reloadAll = function () { return Promise.all([D.loadLive(), D.loadVod()]); };
  return D;
})();
