#!/usr/bin/env python3
"""Genera los íconos de la app y las carátulas de la demostración.

    python tools/generar_iconos.py                      # colores por defecto (ámbar)
    python tools/generar_iconos.py --c1 "#29b6f6" --c2 "#1565c0"

Crea app/img/icon.png (80x80), app/img/largeIcon.png (130x130) y
app/demo/posters/*.jpg. Necesita Pillow:  pip install pillow
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
FONTS = ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf',
         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Bold.ttf']
FONTS_REG = ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/Library/Fonts/Arial.ttf']

# Cortometrajes libres de Blender Foundation (Creative Commons).
MOVIES = [
    ('big-buck-bunny', 'Big Buck Bunny', '2008 · CC BY 3.0', ('#9ccc65', '#1b5e20')),
    ('sintel', 'Sintel', '2010 · CC BY 3.0', ('#bcaaa4', '#3e2723')),
    ('tears-of-steel', 'Tears of Steel', '2012 · CC BY 3.0', ('#78909c', '#102027')),
    ('elephants-dream', 'Elephants Dream', '2006 · CC BY 2.5', ('#9575cd', '#311b92')),
]


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def font(paths, size):
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def diagonal(size, c1, c2):
    w, h = size
    img = Image.new('RGBA', size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / float(w + h - 2)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    return img


def vertical(size, c1, c2):
    w, h = size
    img = Image.new('RGB', size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / float(h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)))
    return img


def make_icon(size, c1, c2, out):
    s = size * 4  # se dibuja grande y se reduce para suavizar los bordes
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    img.paste(diagonal((s, s), c1, c2), (0, 0), mask)
    d = ImageDraw.Draw(img)
    dark = (17, 21, 28, 255)
    d.rounded_rectangle([s * 0.17, s * 0.22, s * 0.83, s * 0.70], radius=int(s * 0.07), fill=dark)
    d.rounded_rectangle([s * 0.36, s * 0.75, s * 0.64, s * 0.80], radius=int(s * 0.025), fill=dark)
    d.polygon([(s * 0.43, s * 0.345), (s * 0.43, s * 0.575), (s * 0.615, s * 0.46)], fill=c1 + (255,))
    img.resize((size, size), Image.LANCZOS).save(out)


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if draw.textlength(test, font=fnt) <= width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def make_poster(title, sub, colors, out):
    w, h = 400, 600
    img = vertical((w, h), rgb(colors[0]), rgb(colors[1])).convert('RGBA')
    over = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    d.ellipse([-120, -60, 330, 390], fill=(255, 255, 255, 38))
    d.ellipse([170, 120, 520, 470], fill=(255, 255, 255, 22))
    d.rectangle([0, 390, w, h], fill=(0, 0, 0, 90))
    img = Image.alpha_composite(img, over)
    d = ImageDraw.Draw(img)
    big, small = font(FONTS, 54), font(FONTS_REG, 22)
    y = 410
    for line in wrap(d, title, big, w - 48):
        d.text((24, y), line, font=big, fill=(255, 255, 255, 255))
        y += 60
    d.text((24, h - 70), 'Blender Foundation', font=small, fill=(230, 230, 230, 255))
    d.text((24, h - 40), sub, font=small, fill=(200, 200, 200, 255))
    img.convert('RGB').save(out, quality=88)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--c1', default='#ffb300', help='color claro del ícono')
    ap.add_argument('--c2', default='#ff6d00', help='color oscuro del ícono')
    a = ap.parse_args()
    os.makedirs(os.path.join(APP, 'img'), exist_ok=True)
    os.makedirs(os.path.join(APP, 'demo', 'posters'), exist_ok=True)
    make_icon(80, rgb(a.c1), rgb(a.c2), os.path.join(APP, 'img', 'icon.png'))
    make_icon(130, rgb(a.c1), rgb(a.c2), os.path.join(APP, 'img', 'largeIcon.png'))
    for slug, title, sub, colors in MOVIES:
        make_poster(title, sub, colors, os.path.join(APP, 'demo', 'posters', slug + '.jpg'))
    print('Íconos y carátulas generados en', APP)


if __name__ == '__main__':
    main()
