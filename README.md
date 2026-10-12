# Asakusa.txt

A short night walk through Asakusa, Tokyo, rendered entirely in ASCII. Playable on phones (touch) and desktop (WASD / arrows, E to interact).

- `public/index.html` — the whole game in one self-contained page (what Vercel serves).
- `engine/` — sources: `src/*.js` (WebGL2 ASCII renderer, world, gameplay, UI), `audio.js` (synthesized music and sound), `build.py`.

## Build

```
cd engine && python3 build.py   # writes dist/vercel/index.html
cp dist/vercel/index.html ../public/index.html
```

No dependencies, no assets: geometry, textures, music and sound are all generated in code. The only external resource is the M PLUS 1 Code font from Google Fonts.
