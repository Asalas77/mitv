/*
 * Cliente para tu propio servidor Jellyfin (https://jellyfin.org): películas, series
 * y "continuar viendo". La posición de reproducción se guarda en el servidor.
 */
var Jellyfin = (function () {
  'use strict';
  var J = { cfg: Store.get('jellyfin', null) };
  var F = 'Overview,PrimaryImageAspectRatio';

  function deviceId() {
    var d = Store.get('deviceId', '');
    if (!d) { d = 'mitv-' + U.uid(); Store.set('deviceId', d); }
    return d;
  }
  function auth() {
    var s = 'MediaBrowser Client="' + CONFIG.JELLYFIN_CLIENT + '", Device="LG webOS TV", DeviceId="' + deviceId() + '", Version="' + CONFIG.VERSION + '"';
    if (J.cfg && J.cfg.token) s += ', Token="' + J.cfg.token + '"';
    return s;
  }
  function call(method, path, body) {
    var a = auth(), h = { 'Authorization': a, 'X-Emby-Authorization': a };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    return U.request(J.cfg.server + path, {
      method: method, headers: h, timeout: 20000,
      body: body === undefined ? null : JSON.stringify(body)
    }).then(function (xhr) {
      var t = xhr.responseText;
      if (!t) return null;
      try { return JSON.parse(t); } catch (e) { return null; }
    });
  }
  // Prueba rutas nuevas (Jellyfin 10.9+) y antiguas.
  function getFirst(paths) {
    var i = 0;
    function next() {
      return call('GET', paths[i]).then(null, function (e) {
        i++;
        if (e.status === 404 && i < paths.length) return next();
        throw e;
      });
    }
    return next();
  }

  J.normalizeServer = function (s) {
    s = String(s || '').trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  };
  J.isConnected = function () { return !!(J.cfg && J.cfg.token && J.cfg.userId); };
  J.login = function (server, user, pw) {
    server = J.normalizeServer(server);
    J.cfg = { server: server };
    return call('POST', '/Users/AuthenticateByName', { Username: user, Pw: pw }).then(function (r) {
      if (!r || !r.AccessToken || !r.User) throw new Error('Respuesta inesperada del servidor');
      J.cfg = { server: server, token: r.AccessToken, userId: r.User.Id, userName: r.User.Name || user };
      Store.set('jellyfin', J.cfg);
      return J.cfg;
    }, function (e) {
      J.cfg = null;
      throw e;
    });
  };
  J.logout = function () {
    if (J.isConnected()) call('POST', '/Sessions/Logout').then(null, function () {});
    J.cfg = null;
    Store.remove('jellyfin');
  };

  function img(id, type, params, tag) {
    return J.cfg.server + '/Items/' + id + '/Images/' + type + '?' + params + (tag ? '&tag=' + tag : '');
  }
  function posterOf(j) {
    if ((j.Type === 'Episode' || j.Type === 'Season') && j.SeriesId) return img(j.SeriesId, 'Primary', 'fillHeight=420&quality=90', j.SeriesPrimaryImageTag);
    if (j.ImageTags && j.ImageTags.Primary) return img(j.Id, 'Primary', 'fillHeight=420&quality=90', j.ImageTags.Primary);
    return '';
  }
  function thumbOf(j) {
    return j.ImageTags && j.ImageTags.Primary ? img(j.Id, 'Primary', 'fillWidth=320&quality=85', j.ImageTags.Primary) : '';
  }
  function backdropOf(j) {
    if (j.BackdropImageTags && j.BackdropImageTags.length) return img(j.Id, 'Backdrop/0', 'fillWidth=1280&quality=80', j.BackdropImageTags[0]);
    if (j.ParentBackdropItemId && j.ParentBackdropImageTags && j.ParentBackdropImageTags.length) {
      return img(j.ParentBackdropItemId, 'Backdrop/0', 'fillWidth=1280&quality=80', j.ParentBackdropImageTags[0]);
    }
    return '';
  }
  function toItem(j) {
    var type = j.Type === 'Series' ? 'series' : j.Type === 'Episode' ? 'episode' : j.Type === 'Season' ? 'season' : 'movie';
    var ud = j.UserData || {}, sub = '';
    if (type === 'episode') {
      sub = (j.ParentIndexNumber !== undefined && j.ParentIndexNumber !== null ? 'T' + j.ParentIndexNumber + ' ' : '') +
        (j.IndexNumber !== undefined && j.IndexNumber !== null ? 'E' + j.IndexNumber : '');
    }
    return {
      id: 'jf:' + j.Id, jfId: j.Id, source: 'jellyfin', type: type, title: j.Name || '',
      seriesName: j.SeriesName || '', subtitle: sub.trim(), year: j.ProductionYear || '', overview: j.Overview || '',
      runtime: j.RunTimeTicks ? j.RunTimeTicks / 1e7 : 0,
      position: ud.PlaybackPositionTicks ? ud.PlaybackPositionTicks / 1e7 : 0, played: !!ud.Played,
      poster: posterOf(j), thumb: thumbOf(j), backdrop: backdropOf(j), seriesId: j.SeriesId || '', index: j.IndexNumber
    };
  }
  function list(r) { return (r && r.Items ? r.Items : []).map(toItem); }
  function u() { return J.cfg.userId; }

  J.resume = function () {
    return getFirst([
      '/UserItems/Resume?userId=' + u() + '&Limit=30&MediaTypes=Video&Fields=' + F,
      '/Users/' + u() + '/Items/Resume?Limit=30&MediaTypes=Video&Fields=' + F
    ]).then(list);
  };
  J.movies = function () {
    return call('GET', '/Items?userId=' + u() + '&IncludeItemTypes=Movie&Recursive=true&SortBy=DateCreated&SortOrder=Descending&Limit=200&Fields=' + F).then(list);
  };
  J.series = function () {
    return call('GET', '/Items?userId=' + u() + '&IncludeItemTypes=Series&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=200&Fields=' + F).then(list);
  };
  J.seasons = function (seriesId) {
    return call('GET', '/Shows/' + seriesId + '/Seasons?userId=' + u() + '&Fields=' + F).then(list);
  };
  J.episodes = function (seriesId, seasonId) {
    return call('GET', '/Shows/' + seriesId + '/Episodes?seasonId=' + seasonId + '&userId=' + u() + '&Fields=' + F).then(list);
  };
  J.item = function (id) {
    return getFirst(['/Items/' + id + '?userId=' + u(), '/Users/' + u() + '/Items/' + id]).then(toItem);
  };

  // Reproducción directa del archivo, o HLS transcodificado por el servidor (más compatible).
  J.streamUrl = function (item, transcode, playSession) {
    var c = J.cfg;
    var q = 'MediaSourceId=' + item.jfId + '&DeviceId=' + encodeURIComponent(deviceId()) + '&api_key=' + c.token + '&PlaySessionId=' + playSession;
    if (transcode) {
      return c.server + '/Videos/' + item.jfId + '/master.m3u8?' + q +
        '&VideoCodec=h264&AudioCodec=aac&TranscodingMaxAudioChannels=2&MaxStreamingBitrate=20000000&SegmentContainer=ts';
    }
    return c.server + '/Videos/' + item.jfId + '/stream?static=true&' + q;
  };
  function report(path, item, pos, paused, playSession, transcode) {
    if (!J.isConnected()) return;
    call('POST', path, {
      ItemId: item.jfId, MediaSourceId: item.jfId, PositionTicks: Math.floor((pos || 0) * 1e7),
      IsPaused: !!paused, CanSeek: true, PlayMethod: transcode ? 'Transcode' : 'DirectPlay', PlaySessionId: playSession
    }).then(null, function () {});
  }
  J.reportStart = function (item, pos, ps, tr) { report('/Sessions/Playing', item, pos, false, ps, tr); };
  J.reportProgress = function (item, pos, paused, ps, tr) { report('/Sessions/Playing/Progress', item, pos, paused, ps, tr); };
  J.reportStopped = function (item, pos, ps, tr) { report('/Sessions/Playing/Stopped', item, pos, false, ps, tr); };

  return J;
})();
