#!/usr/bin/env python3
"""Concatenate src/ into one self-contained HTML file: dist/asakusa.html"""
import glob, os, sys
root = os.path.dirname(os.path.abspath(__file__))
src = sorted(glob.glob(os.path.join(root, 'src', '*')))
head = ''.join(open(f).read() for f in src if f.endswith('.html'))
js = '\n'.join(open(f).read() for f in src if f.endswith('.js'))
audio = os.path.join(root, 'audio.js')  # synthesized audio engine
if os.path.exists(audio) and '--no-audio' not in sys.argv:
    js = open(audio).read() + '\n' + js
out = head + '\n<script>\n"use strict";\n' + js + '\n</script>\n'
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
open(os.path.join(root, 'dist', 'asakusa.html'), 'w').write(out)
# local test copy wrapped like the artifact skeleton (charset + viewport meta)
test = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style></head><body>' + out + '</body></html>')
open(os.path.join(root, 'dist', 'test.html'), 'w').write(test)
# standalone site for Vercel: proper <head>, metas for mobile, same page
cut = head.index('<canvas')
site = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#05040a">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
        '<meta name="mobile-web-app-capable" content="yes">\n'
        '<meta name="description" content="A short night walk through Asakusa, Tokyo, rendered entirely in ASCII.">\n'
        '<meta property="og:title" content="Asakusa.txt">\n<meta property="og:description" content="A short night walk through Asakusa, Tokyo, rendered entirely in ASCII.">\n'
        + head[:cut] + '</head>\n<body>\n' + head[cut:] + '\n<script>\n"use strict";\n' + js + '\n</script>\n</body>\n</html>\n')
os.makedirs(os.path.join(root, 'dist', 'vercel'), exist_ok=True)
open(os.path.join(root, 'dist', 'vercel', 'index.html'), 'w').write(site)
print('dist/asakusa.html', len(out) // 1024, 'KB')
