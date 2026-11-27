#!/usr/bin/env python3
"""Une varias listas M3U en una sola, quita duplicados y deja solo los canales que responden.

    python tools/unir_listas.py URL_o_archivo [URL_o_archivo ...] [-o app/listas/canales.m3u]

Ejemplo:
    python tools/unir_listas.py https://iptv-org.github.io/iptv/countries/cl.m3u ^
        https://iptv-org.github.io/iptv/languages/spa.m3u

Para cada canal descarga el inicio del enlace; si es HLS (.m3u8) también comprueba que
responda la primera sub-lista (calidad). Los canales caídos se anotan en un informe .txt.
Solo usa la biblioteca estándar de Python.
"""
import argparse
import concurrent.futures as cf
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fetch(url, limit=65536, timeout=10):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get('Content-Type', ''), r.read(limit), r.geturl()


def read_source(src):
    if re.match(r'^https?://', src):
        return fetch(src, limit=50_000_000, timeout=60)[2].decode('utf-8', 'replace')
    with open(src, encoding='utf-8', errors='replace') as f:
        return f.read()


def parse(text):
    """Devuelve [(lineas_extinf, url)] conservando #EXTINF y opciones intermedias."""
    out, meta = [], []
    header = ''
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith('#EXTM3U'):
            header = header or line
        elif line.startswith('#'):
            if line.upper().startswith('#EXTINF'):
                meta = [line]
            elif meta:
                meta.append(line)
        else:
            out.append((meta or ['#EXTINF:-1,' + line.rsplit('/', 1)[-1]], line))
            meta = []
    return header, out


def name_of(extinf):
    m = re.search(r',([^,]*)$', extinf[0])
    return (m.group(1) if m else '').strip()


def check(url):
    """Devuelve (ok, motivo)."""
    try:
        status, ctype, body, final = fetch(url)
        if status >= 400:
            return False, 'HTTP %d' % status
        head = body[:20].lstrip()
        if head.startswith(b'#EXTM3U') or 'mpegurl' in ctype.lower():
            text = body.decode('utf-8', 'replace')
            if '#EXT' not in text:
                return False, 'm3u8 vacío'
            # primera sub-lista o segmento
            for line in text.splitlines():
                line = line.strip()
                if line and not line.startswith('#'):
                    sub = urllib.parse.urljoin(final, line)
                    s2 = fetch(sub, limit=2048)[0]
                    return (s2 < 400), ('ok' if s2 < 400 else 'sub-lista HTTP %d' % s2)
            return False, 'm3u8 sin contenido'
        if ctype.startswith(('video/', 'audio/', 'application/octet-stream', 'application/dash')) or body[:1] == b'\x47':
            return True, 'ok'
        if ctype.startswith('text/html'):
            return False, 'devuelve una página web'
        return bool(body), 'ok' if body else 'vacío'
    except Exception as e:  # noqa: BLE001 - cualquier fallo de red = canal caído
        return False, type(e).__name__ + ': ' + str(e)[:80]


def main():
    ap = argparse.ArgumentParser(description='Une listas M3U y verifica los canales.')
    ap.add_argument('fuentes', nargs='+')
    ap.add_argument('-o', '--salida', default=os.path.join(ROOT, 'app', 'listas', 'canales.m3u'))
    ap.add_argument('--hilos', type=int, default=32)
    ap.add_argument('--sin-verificar', action='store_true', help='solo une y quita duplicados')
    a = ap.parse_args()

    entries, seen, url_tvg = [], set(), []
    for src in a.fuentes:
        try:
            header, items = parse(read_source(src))
        except Exception as e:  # noqa: BLE001
            print('No se pudo leer %s: %s' % (src, e))
            continue
        m = re.search(r'(?:url-tvg|x-tvg-url)="([^"]+)"', header)
        if m:
            url_tvg.append(m.group(1))
        nuevos = 0
        for meta, url in items:
            if url in seen:
                continue
            seen.add(url)
            entries.append((meta, url))
            nuevos += 1
        print('%-60s %5d canales (%d nuevos)' % (src[-60:], len(items), nuevos))
    print('Total sin duplicados:', len(entries))

    ok, bad, t0 = [], [], time.time()
    if a.sin_verificar:
        ok = entries
    else:
        with cf.ThreadPoolExecutor(a.hilos) as ex:
            futs = {ex.submit(check, url): (meta, url) for meta, url in entries}
            for i, f in enumerate(cf.as_completed(futs), 1):
                meta, url = futs[f]
                good, why = f.result()
                (ok if good else bad).append((meta, url) if good else (name_of(meta), url, why))
                if i % 50 == 0 or i == len(entries):
                    sys.stdout.write('\rVerificados %d/%d  activos %d  caídos %d' % (i, len(entries), len(ok), len(bad)))
                    sys.stdout.flush()
        print('\nTiempo: %.0f s' % (time.time() - t0))
        order = {url: i for i, (_, url) in enumerate(entries)}
        ok.sort(key=lambda e: order[e[1]])

    os.makedirs(os.path.dirname(os.path.abspath(a.salida)), exist_ok=True)
    head = '#EXTM3U' + (' url-tvg="%s"' % ','.join(url_tvg) if url_tvg else '')
    with open(a.salida, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + '\n')
        for meta, url in ok:
            f.write('\n'.join(meta) + '\n' + url + '\n')
    print('Lista final: %s (%d canales)' % (a.salida, len(ok)))
    if bad:
        rep = os.path.splitext(a.salida)[0] + '-caidos.txt'
        with open(rep, 'w', encoding='utf-8') as f:
            for name, url, why in sorted(bad):
                f.write('%s\t%s\t%s\n' % (name, why, url))
        print('Canales caídos:', rep)


if __name__ == '__main__':
    main()
