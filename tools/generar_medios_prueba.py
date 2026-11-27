#!/usr/bin/env python3
"""Genera videos de prueba locales con ffmpeg, para probar la app en el PC sin internet.

    python tools/generar_medios_prueba.py

Crea tools/media/ con tres "canales" (canal-a/b/c.mp4), una película de 2 minutos
(pelicula.mp4) y una señal HLS (hls/index.m3u8). Necesita ffmpeg en el PATH.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'media')
ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '600k',
       '-c:a', 'aac', '-b:a', '96k', '-shortest']


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args, check=True)


def clip(name, video, freq, seconds, size='640x360'):
    ffmpeg(['-f', 'lavfi', '-i', '%s=size=%s:rate=25' % (video, size),
            '-f', 'lavfi', '-i', 'sine=frequency=%d:sample_rate=48000' % freq,
            '-t', str(seconds)] + ENC + ['-movflags', '+faststart', os.path.join(OUT, name)])


def main():
    if not shutil.which('ffmpeg'):
        sys.exit('No se encontró ffmpeg. Instálalo y vuelve a intentarlo.')
    os.makedirs(os.path.join(OUT, 'hls'), exist_ok=True)
    clip('canal-a.mp4', 'testsrc2', 440, 40)
    clip('canal-b.mp4', 'smptehdbars', 660, 40)
    clip('canal-c.mp4', 'mandelbrot', 880, 40)
    clip('pelicula.mp4', 'testsrc', 330, 120, '1280x720')
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000',
            '-t', '60'] + ENC + ['-g', '50', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0',
                                 '-hls_segment_filename', os.path.join(OUT, 'hls', 'seg%03d.ts'),
                                 os.path.join(OUT, 'hls', 'index.m3u8')])
    print('Videos de prueba creados en', OUT)


if __name__ == '__main__':
    main()
