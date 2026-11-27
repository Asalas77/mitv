#!/usr/bin/env python3
"""Servidor local para probar Mi TV en el navegador del PC (no hace falta el TV).

Sirve:
  /                       la app (carpeta app/)
  /pruebas/canales.m3u    lista de canales de prueba con videos locales (tools/media)
  /pruebas/guia.xml       guía XMLTV generada alrededor de la hora actual (también guia.xml.gz)
  /pruebas/grande.m3u     3000 canales en 40 categorías, para probar el rendimiento
  /pruebas/peliculas.m3u  lista de películas de prueba
  /jellyfin/...           un servidor Jellyfin simulado: usuario "prueba", contraseña "prueba"

Uso:
  python tools/generar_medios_prueba.py        (una sola vez; necesita ffmpeg)
  python tools/servidor_pruebas.py [--port 8080] [--host 127.0.0.1] [--jellyfin-antiguo]
y abre http://localhost:8080 . Con --host 0.0.0.0 el TV también puede usarlo en tu red de casa.
"""
import argparse
import gzip
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, 'app')
MEDIA_DIR = os.path.join(ROOT, 'tools', 'media')
TOKEN = 'token-de-prueba'
USER = {'Id': 'f0e1d2c3b4a5968778695a4b3c2d1e0f', 'Name': 'prueba'}
PASSWORD = 'prueba'
LEGACY = False  # --jellyfin-antiguo: simula un Jellyfin anterior a 10.9 (sin rutas nuevas)
TYPES = {'.mp4': 'video/mp4', '.webm': 'video/webm', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t'}


def iid(name):
    return hashlib.md5(name.encode('utf-8')).hexdigest()


def hue(text):
    return int(hashlib.md5(text.encode('utf-8')).hexdigest()[:4], 16) % 360


def svg_image(title, w, h, sub=''):
    words, lines, cur = title.split(), [], ''
    for word in words:
        if len(cur) + len(word) + 1 > (14 if w < h else 26):
            lines.append(cur)
            cur = word
        else:
            cur = (cur + ' ' + word).strip()
    lines.append(cur)
    size = 44 if w < h else 52
    y0 = h // 2 - (len(lines) - 1) * size // 2
    text = ''.join('<text x="50%%" y="%d" font-size="%d" font-family="Arial" font-weight="bold" fill="#fff" '
                   'text-anchor="middle">%s</text>' % (y0 + i * (size + 8), size, html.escape(l)) for i, l in enumerate(lines))
    if sub:
        text += '<text x="50%%" y="%d" font-size="24" font-family="Arial" fill="#ddd" text-anchor="middle">%s</text>' % (h - 40, html.escape(sub))
    hh = hue(title)
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(%d,55%%,45%%)"/>'
            '<stop offset="1" stop-color="hsl(%d,60%%,14%%)"/></linearGradient></defs>'
            '<rect width="100%%" height="100%%" fill="url(#g)"/>%s</svg>') % (w, h, w, h, hh, hh, text)


def svg_logo(name):
    letters = ''.join(p[0] for p in re.sub(r'[^\w ]', ' ', name).split()[:2]).upper() or '?'
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
            '<circle cx="64" cy="64" r="60" fill="hsl(%d,65%%,50%%)"/><text x="64" y="80" font-size="46" '
            'font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">%s</text></svg>') % (hue(name), html.escape(letters))


# ---------------------------------------------------------------- Jellyfin simulado
class Library:
    def __init__(self):
        self.items = {}
        movies = [('Atardecer en la costa', 2021), ('Montañas de cristal', 2019), ('Ciudad de neón', 2023),
                  ('El último tren', 2018), ('Bosque de niebla', 2022), ('Viaje al norte', 2020)]
        for i, (name, year) in enumerate(movies):
            self.add({'Id': iid('m:' + name), 'Name': name, 'Type': 'Movie', 'year': year, 'runtime': 120, 'created': i,
                      'Overview': 'Película de prueba del servidor simulado. Dura dos minutos y muestra un reloj en pantalla.'})
        for sname, seasons in (('Serie de prueba A', 2), ('Serie de prueba B', 1)):
            sid = iid('s:' + sname)
            self.add({'Id': sid, 'Name': sname, 'Type': 'Series', 'year': 2024, 'created': 10,
                      'Overview': 'Serie de prueba con temporadas y episodios cortos.'})
            for sn in range(1, seasons + 1):
                seid = iid('se:%s:%d' % (sname, sn))
                self.add({'Id': seid, 'Name': 'Temporada %d' % sn, 'Type': 'Season', 'series': sid, 'sn': sn})
                for ep in range(1, (3 if sname.endswith('A') else 4) + 1):
                    self.add({'Id': iid('e:%s:%d:%d' % (sname, sn, ep)), 'Name': 'Episodio %d' % ep, 'Type': 'Episode',
                              'series': sid, 'season': seid, 'sn': sn, 'ep': ep, 'runtime': 120,
                              'Overview': 'Episodio %d de la temporada %d de %s.' % (ep, sn, sname)})
        self.items[iid('m:Montañas de cristal')].update(pos=45, last=time.time() - 60)
        self.items[iid('e:Serie de prueba A:1:2')].update(pos=30, last=time.time() - 30)

    def add(self, it):
        it.setdefault('pos', 0)
        it.setdefault('played', False)
        it.setdefault('last', 0)
        self.items[it['Id']] = it

    def dto(self, it):
        d = {'Id': it['Id'], 'Name': it['Name'], 'Type': it['Type'], 'ServerId': 'servidor-de-prueba',
             'Overview': it.get('Overview', ''), 'ImageTags': {'Primary': 'p' + it['Id'][:8]}, 'BackdropImageTags': [],
             'UserData': {'PlaybackPositionTicks': int(it['pos'] * 1e7), 'Played': it['played'], 'IsFavorite': False}}
        if it['Type'] in ('Movie', 'Series'):
            d['BackdropImageTags'] = ['b' + it['Id'][:8]]
            d['ProductionYear'] = it['year']
        if it['Type'] in ('Movie', 'Episode'):
            d['RunTimeTicks'] = it['runtime'] * 10 ** 7
            d['MediaType'] = 'Video'
        if it['Type'] in ('Episode', 'Season'):
            s = self.items[it['series']]
            d.update({'SeriesId': s['Id'], 'SeriesName': s['Name'], 'SeriesPrimaryImageTag': 'p' + s['Id'][:8],
                      'ParentBackdropItemId': s['Id'], 'ParentBackdropImageTags': ['b' + s['Id'][:8]]})
            d['IndexNumber'] = it['ep'] if it['Type'] == 'Episode' else it['sn']
        if it['Type'] == 'Episode':
            d.update({'SeasonId': it['season'], 'ParentIndexNumber': it['sn']})
        return d

    def page(self, items):
        return {'Items': [self.dto(i) for i in items], 'TotalRecordCount': len(items), 'StartIndex': 0}


LIB = Library()


# ---------------------------------------------------------------- Listas y guía de prueba
CHANNELS = [  # (tvg-id, nombre, categoría, video, logo)
    ('prueba.uno', 'Canal Uno', 'Noticias, actualidad', 'canal-a.mp4', 'svg'),
    ('prueba.dos', 'Canal Dos HD', 'Deportes', 'canal-b.mp4', 'svg'),
    ('', 'Señal Tres', 'Cultura', 'canal-c.mp4', ''),                    # sin tvg-id: se cruza con la guía por nombre
    ('prueba.cuatro', 'Cuatro HLS', 'Cultura', 'hls/index.m3u8', 'svg'),
    ('prueba.cinco', 'Canal Cinco (enlace roto)', 'Música', 'no-existe.mp4', 'roto'),
    ('prueba.seis', '<b>Seis</b> & "más"', 'Infantil', 'canal-a.mp4', 'svg'),  # nombre con HTML: debe verse como texto
]
EPG_CHANNELS = [('prueba.uno', 'Canal Uno'), ('prueba.dos', 'Canal Dos'), ('senal.tres', 'Señal Tres'),
                ('prueba.cuatro', 'Cuatro'), ('prueba.cinco', 'Canal Cinco'), ('prueba.seis', 'Seis')]
TITLES = ['Noticias & actualidad', 'Película: <El regreso>', 'Deportes en directo', 'Documental de naturaleza',
          'Música en vivo', 'Dibujos animados', 'Entrevistas', 'Cocina de casa']


def channels_m3u(base):
    out = ['#EXTM3U url-tvg="%s/pruebas/guia.xml.gz"' % base]
    for tid, name, group, media, logo in CHANNELS:
        attrs = []
        if tid:
            attrs.append('tvg-id="%s"' % tid)
        if logo == 'svg':
            attrs.append('tvg-logo="%s/pruebas/logo/%s.svg"' % (base, urllib.parse.quote(name)))
        elif logo == 'roto':
            attrs.append('tvg-logo="%s/pruebas/no-existe.png"' % base)
        attrs.append('group-title="%s"' % group)
        out.append('#EXTINF:-1 %s,%s' % (' '.join(attrs), name))
        out.append('%s/pruebas/media/%s' % (base, media))
    return '\n'.join(out) + '\n'


def big_m3u(base):
    out = ['#EXTM3U']
    for i in range(1, 3001):
        out.append('#EXTINF:-1 tvg-id="grande.%d" group-title="Grupo %02d",Canal de prueba %d' % (i, (i - 1) // 75 + 1, i))
        out.append('%s/pruebas/media/%s' % (base, ('canal-a.mp4', 'canal-b.mp4', 'canal-c.mp4')[i % 3]))
    return '\n'.join(out) + '\n'


def movies_m3u(base):
    out = ['#EXTM3U']
    for i, name in enumerate(['Prueba local uno', 'Prueba local dos', 'Prueba local tres', 'Prueba sin carátula']):
        logo = '' if 'sin' in name else ' tvg-logo="%s/pruebas/poster/%s.svg"' % (base, urllib.parse.quote(name))
        group = 'Películas de prueba' if i < 2 else 'Más pruebas'
        out.append('#EXTINF:120%s group-title="%s" year="202%d" description="Video local de dos minutos para probar la '
                   'reproducción y Continuar viendo.",%s' % (logo, group, i, name))
        out.append('%s/pruebas/media/pelicula.mp4' % base)
    return '\n'.join(out) + '\n'


def mixed_m3u(base):
    """Lista mixta (canales + películas + episodios) para probar la separación automática."""
    out = ['#EXTM3U']
    for i, (g, n) in enumerate([('Noticias', 'Canal Noticias'), ('Cine en vivo', 'Canal Cine 24h'), ('Deportes', 'Canal Deportes')]):
        out.append('#EXTINF:-1 tvg-id="mix.%d" group-title="%s",%s' % (i, g, n))
        out.append('%s/live/prueba/prueba/%d.ts' % (base, 100 + i))
    for i in range(3):
        out.append('#EXTINF:0 tvg-logo="%s/pruebas/poster/Peli%%20%d.svg" group-title="VOD | Acción",Película de prueba %d' % (base, i, i))
        out.append('%s/movie/prueba/prueba/%d.mp4' % (base, 200 + i))
    for i in range(2):
        out.append('#EXTINF:0 group-title="Series | Drama",Serie de prueba S01 E0%d' % (i + 1))
        out.append('%s/series/prueba/prueba/%d.mkv' % (base, 300 + i))
    out.append('#EXTINF:5400 group-title="Películas",Película local')
    out.append('%s/pruebas/media/pelicula.mp4' % base)
    return '\n'.join(out) + '\n'


def guide_xml():
    now = datetime.now(timezone.utc)
    tz = timezone(timedelta(hours=-3))  # horas con zona -0300 para probar la conversión
    start = (now - timedelta(hours=4)).replace(minute=0, second=0, microsecond=0)
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="Mi TV pruebas">']
    for cid, name in EPG_CHANNELS:
        out.append('  <channel id="%s"><display-name lang="es">%s</display-name></channel>' % (cid, html.escape(name)))
    lengths = [30, 45, 60, 90, 120, 15]
    for ci, (cid, name) in enumerate(EPG_CHANNELS):
        t, i = start, 0
        while t < now + timedelta(hours=30):
            d = timedelta(minutes=lengths[(i + ci) % len(lengths)])
            title = TITLES[(i * 3 + ci) % len(TITLES)]
            fmt = lambda x: x.astimezone(tz).strftime('%Y%m%d%H%M%S %z')
            if i % 5 == 0:
                title_xml = '<title><![CDATA[%s]]></title>' % title
            else:
                title_xml = '<title lang="es">%s</title>' % html.escape(title)
            desc = 'Programa %d de %s. Descripción de prueba con acentos (canción, año) y símbolos &amp; más.' % (i + 1, name)
            out.append('  <programme start="%s" stop="%s" channel="%s">%s<desc lang="es">%s</desc></programme>'
                       % (fmt(t), fmt(t + d), cid, title_xml, desc))
            t += d
            i += 1
    out.append('</tv>')
    return '\n'.join(out) + '\n'


# ---------------------------------------------------------------- Servidor
class Handler(SimpleHTTPRequestHandler):
    server_version = 'MiTVPruebas/1.0'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, X-Emby-Authorization, Content-Type, Range')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), fmt % args))

    def base(self):
        return 'http://' + self.headers.get('Host', 'localhost')

    def send_bytes(self, data, ctype, status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, obj, status=200):
        self.send_bytes(json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8', status)

    def send_empty(self, status=204):
        self.send_response(status)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def read_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        try:
            return json.loads(self.rfile.read(n).decode('utf-8')) if n else {}
        except ValueError:
            return {}

    def do_OPTIONS(self):
        self.send_empty(204)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/jellyfin/'):
            return self.jellyfin('GET')
        if path.startswith('/pruebas/'):
            return self.pruebas(path[len('/pruebas/'):])
        return super().do_GET()

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path.startswith('/jellyfin/'):
            return self.jellyfin('POST')
        self.send_error(404)

    # -- listas, guía, imágenes y videos de prueba
    def pruebas(self, rel):
        base = self.base()
        if rel == 'canales.m3u':
            return self.send_bytes(channels_m3u(base).encode('utf-8'), 'audio/x-mpegurl; charset=utf-8')
        if rel == 'mixta.m3u':
            return self.send_bytes(mixed_m3u(base).encode('utf-8'), 'audio/x-mpegurl; charset=utf-8')
        if rel == 'grande.m3u':
            return self.send_bytes(big_m3u(base).encode('utf-8'), 'audio/x-mpegurl; charset=utf-8')
        if rel == 'peliculas.m3u':
            return self.send_bytes(movies_m3u(base).encode('utf-8'), 'audio/x-mpegurl; charset=utf-8')
        if rel == 'guia.xml':
            return self.send_bytes(guide_xml().encode('utf-8'), 'application/xml; charset=utf-8')
        if rel == 'guia.xml.gz':
            return self.send_bytes(gzip.compress(guide_xml().encode('utf-8')), 'application/gzip')
        m = re.match(r'^(logo|poster)/(.+)\.svg$', rel)
        if m:
            name = urllib.parse.unquote(m.group(2))
            svg = svg_logo(name) if m.group(1) == 'logo' else svg_image(name, 400, 600, 'Prueba')
            return self.send_bytes(svg.encode('utf-8'), 'image/svg+xml')
        if rel.startswith('media/'):
            return self.send_media(urllib.parse.unquote(rel[len('media/'):]))
        self.send_error(404)

    def send_media(self, rel):
        full = os.path.realpath(os.path.join(MEDIA_DIR, rel))
        if not full.startswith(os.path.realpath(MEDIA_DIR) + os.sep) or not os.path.isfile(full):
            return self.send_error(404)
        size = os.path.getsize(full)
        start, end, status = 0, size - 1, 200
        m = re.match(r'bytes=(\d*)-(\d*)', self.headers.get('Range') or '')
        if m and (m.group(1) or m.group(2)):
            status = 206
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            else:
                start = max(0, size - int(m.group(2)))
        if start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.end_headers()
            return
        self.send_response(status)
        self.send_header('Content-Type', TYPES.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if status == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.end_headers()
        with open(full, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    break
                left -= len(chunk)

    # -- Jellyfin simulado
    def jf_authorized(self, q):
        h = (self.headers.get('Authorization') or '') + ' ' + (self.headers.get('X-Emby-Authorization') or '')
        return ('Token="%s"' % TOKEN) in h or TOKEN in (q.get('api_key', []) + q.get('ApiKey', []))

    def jellyfin(self, method):
        u = urllib.parse.urlparse(self.path)
        path, q = u.path[len('/jellyfin'):], urllib.parse.parse_qs(u.query)
        uid = USER['Id']
        if path == '/Users/AuthenticateByName' and method == 'POST':
            b = self.read_json()
            if b.get('Username') == USER['Name'] and b.get('Pw') == PASSWORD:
                return self.send_json({'User': USER, 'AccessToken': TOKEN, 'ServerId': 'servidor-de-prueba'})
            return self.send_json({'error': 'Usuario o contraseña incorrectos'}, 401)
        m = re.match(r'^/Items/([0-9a-f]{32})/Images/(Primary|Backdrop)(/\d+)?$', path)
        if m:
            it = LIB.items.get(m.group(1))
            if not it:
                return self.send_error(404)
            wide = m.group(2) == 'Backdrop' or it['Type'] == 'Episode'
            svg = svg_image(it['Name'], 1280 if wide else 400, 720 if wide else 600)
            return self.send_bytes(svg.encode('utf-8'), 'image/svg+xml')
        if not self.jf_authorized(q):
            return self.send_json({'error': 'No autorizado'}, 401)
        if LEGACY and (path.startswith('/UserItems/') or re.match(r'^/Items/[0-9a-f]{32}$', path)):
            return self.send_error(404)
        m = re.match(r'^/Videos/([0-9a-f]{32})/(stream|master\.m3u8)$', path)
        if m:
            target = '/pruebas/media/hls/index.m3u8' if m.group(2) == 'master.m3u8' else '/pruebas/media/pelicula.mp4'
            self.send_response(302)
            self.send_header('Location', target)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if path in ('/UserItems/Resume', '/Users/%s/Items/Resume' % uid):
            items = sorted([i for i in LIB.items.values() if i['pos'] > 0 and not i['played']], key=lambda i: -i['last'])
            return self.send_json(LIB.page(items))
        if path in ('/Items', '/Users/%s/Items' % uid):
            types = (q.get('IncludeItemTypes', [''])[0]).split(',')
            items = [i for i in LIB.items.values() if i['Type'] in types]
            if q.get('SortBy', [''])[0] == 'DateCreated':
                items.sort(key=lambda i: -i.get('created', 0))
            else:
                items.sort(key=lambda i: i['Name'])
            return self.send_json(LIB.page(items))
        m = re.match(r'^/(?:Users/[0-9a-f]{32}/)?Items/([0-9a-f]{32})$', path)
        if m and m.group(1) in LIB.items:
            return self.send_json(LIB.dto(LIB.items[m.group(1)]))
        m = re.match(r'^/Shows/([0-9a-f]{32})/(Seasons|Episodes)$', path)
        if m:
            sid = m.group(1)
            if m.group(2) == 'Seasons':
                items = [i for i in LIB.items.values() if i['Type'] == 'Season' and i['series'] == sid]
                items.sort(key=lambda i: i['sn'])
            else:
                season = q.get('seasonId', [''])[0]
                items = [i for i in LIB.items.values() if i['Type'] == 'Episode' and i['series'] == sid and (not season or i['season'] == season)]
                items.sort(key=lambda i: (i['sn'], i['ep']))
            return self.send_json(LIB.page(items))
        if path in ('/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped') and method == 'POST':
            b = self.read_json()
            it = LIB.items.get(b.get('ItemId', ''))
            if it:
                pos = (b.get('PositionTicks') or 0) / 1e7
                it['pos'], it['last'] = pos, time.time()
                if path.endswith('Stopped') and it.get('runtime') and pos >= it['runtime'] * 0.9:
                    it['pos'], it['played'] = 0, True
                self.log_message('Jellyfin: %s "%s" en %ds', path.rsplit('/', 1)[-1], it['Name'], int(pos))
            return self.send_empty(204)
        if path == '/Sessions/Logout':
            return self.send_empty(204)
        return self.send_error(404)


def main():
    global LEGACY
    ap = argparse.ArgumentParser(description='Servidor de pruebas de Mi TV')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--jellyfin-antiguo', action='store_true', help='simula Jellyfin anterior a 10.9')
    a = ap.parse_args()
    LEGACY = a.jellyfin_antiguo
    if not os.path.isdir(MEDIA_DIR):
        print('Aviso: no hay videos de prueba. Ejecuta antes: python tools/generar_medios_prueba.py')
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    print('Mi TV - servidor de pruebas en http://%s:%d  (Ctrl+C para salir)' % ('localhost' if a.host == '127.0.0.1' else a.host, a.port))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
