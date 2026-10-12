// ───────────────────────── UI: title, cards, dialog, omikuji, HUD, controls ─────────────────────────
// Everything here writes printable ASCII into the overlay grid (ov.put); no DOM, no state outside `UI`.
// Two drawing idioms:
//  - floating text (title, cards, HUD, end): flags-1 glyphs over a dithered "ink wash" of flags-3 dark cells,
//  - panels (dialog, omikuji, prompt, button): every cell flags 3. The renderer derives a flags-2 cell's
//    background from its own glyph colour (bg = col * 0.1), so a panel is filled with spaces of the same hue
//    as its text; that keeps the panel background even behind letters.
// Signature transition: `scramble` (letters cycle through random glyphs, staggered left to right, then settle).
const UI = (() => {
  // ── palette
  const PAPER = [0.92, 0.88, 0.8], VERM = [1, 0.34, 0.2], GOLD = [1, 0.78, 0.38], DIM = [0.5, 0.52, 0.65];
  const SOFT = [0.72, 0.72, 0.8];        // secondary text that must survive the corner vignette
  const INK = [0.1, 0.09, 0.17];         // wash cells: background = INK * 0.1, a night-blue black
  const WARM = [1, 0.86, 0.62];          // omikuji paper fill (warm), close to PAPER and GOLD text
  const SAFE = { top: 2, bottom: 3, side: 2 };

  // ── small helpers
  const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const clampI = (x, a, b) => x < a ? a : x > b ? b : x;
  const ease = x => 1 - Math.pow(1 - c01(x), 3);
  const sstep = (a, b, x) => { const k = c01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const mul = (c, a) => [c[0] * a, c[1] * a, c[2] * a];
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
  const maxLen = a => a.reduce((m, s) => Math.max(m, s.length), 0);
  const spaced = s => String(s).split(' ').filter(Boolean).map(w => w.split('').join(' ')).join('   ');
  const centreX = (ov, s) => Math.floor((ov.cols - s.length) / 2);

  // one glyph, colour scaled by alpha
  function put(ov, x, y, ch, col, a = 1, flags = 1, glow = 0) {
    if (a <= 0.004) return;
    ov.put(x, y, ch, a === 1 ? col : mul(col, a), 0, flags, glow * a);
  }
  function text(ov, x, y, s, col, a = 1, flags = 1, glow = 0) {
    if (a <= 0.004) return;
    const c = a === 1 ? col : mul(col, a);
    x = Math.round(x); y = Math.round(y);
    for (let i = 0; i < s.length; i++) ov.put(x + i, y, s[i], c, 0, flags, glow * a);
  }
  // panel cell: while fading (a < 1) cells appear through an ordered dither instead of a hard pop
  function cell(ov, x, y, ch, col, a, glow = 0) {
    if (a <= 0.004 || (a < 1 && a <= bayer(x, y))) return;
    ov.put(x, y, ch, col, 0, 3, glow);
  }

  // ── word wrap: paragraphs split on '\n', long words hard-broken
  function wrap(str, w) {
    w = Math.max(4, w | 0);
    const out = [];
    for (const para of String(str).split('\n')) {
      let line = '';
      for (let word of para.split(/\s+/)) {
        if (!word) continue;
        while (word.length > w) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, w)); word = word.slice(w); }
        if (!line) line = word;
        else if (line.length + 1 + word.length <= w) line += ' ' + word;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }
  // same line count as wrap(), but lines of even length (for centred text)
  function wrapBal(str, w) {
    let best = wrap(str, w);
    if (best.length < 2) return best;
    for (let ww = (w | 0) - 1; ww >= 8; ww--) {
      const l = wrap(str, ww);
      if (l.length > best.length || l.some(s => s.length > ww)) break;
      best = l;
    }
    return best;
  }

  // ── scramble: each letter cycles through random glyphs, staggered left to right, then settles
  const POOL_UP = 'ABCDEFGHJKMNPRSTUVWXYZ#%&*+=<>/\\|', POOL_LO = 'abcdefghjkmnpqrstuvwxyz+=~:;', POOL_DG = '0123456789#', POOL_SY = '.:;-=+*#%/\\|<>~^';
  function rchar(c, i, k) {
    const o = c.charCodeAt(0);
    const p = o >= 65 && o <= 90 ? POOL_UP : o >= 97 && o <= 122 ? POOL_LO : o >= 48 && o <= 57 ? POOL_DG : POOL_SY;
    return p[Math.floor(hash(i * 13.37 + k * 7.91) * p.length) % p.length];
  }
  const stagOf = n => Math.min(0.04, 0.6 / Math.max(1, n));
  function scramble(str, t, t0, speed = 1) {
    str = String(str);
    const n = str.length, el = (t - t0) * (speed || 1), stag = stagOf(n);
    if (el >= (n - 1) * stag + 0.45) return str;
    const k = Math.floor(t * 22);
    let out = '';
    for (let i = 0; i < n; i++) {
      const c = str[i];
      if (c === ' ') { out += ' '; continue; }
      const s = i * stag, e = s + 0.22 + 0.22 * hash(i * 3.1 + n * 0.7);
      out += el < s ? ' ' : el >= e ? c : rchar(c, i, k);
    }
    return out;
  }
  // the reverse: letters break up into noise, then vanish (left to right)
  function unscramble(str, t, t1, speed = 1) {
    str = String(str);
    const n = str.length, el = (t - t1) * (speed || 1), stag = stagOf(n) * 0.7;
    if (el <= 0) return str;
    const k = Math.floor(t * 22);
    let out = '';
    for (let i = 0; i < n; i++) {
      const c = str[i];
      if (c === ' ') { out += ' '; continue; }
      const s = i * stag, e = s + 0.16 + 0.12 * hash(i * 5.7 + n);
      out += el < s ? c : el >= e ? ' ' : rchar(c, i, k);
    }
    return out;
  }

  // ── ink wash: dark cells in a rounded rectangle, edges dithered over `m` columns
  function wash(ov, x0, y0, w, h, a, m = 5) {
    if (a <= 0.01) return;
    const my = Math.max(1, Math.round(m * 0.55));
    for (let y = y0 - my; y < y0 + h + my; y++) {
      if (y < 0 || y >= ov.rows) continue;
      const dy = y < y0 ? (y0 - y) / (my + 1) : y >= y0 + h ? (y - (y0 + h - 1)) / (my + 1) : 0;
      for (let x = x0 - m; x < x0 + w + m; x++) {
        if (x < 0 || x >= ov.cols) continue;
        const dx = x < x0 ? (x0 - x) / (m + 1) : x >= x0 + w ? (x - (x0 + w - 1)) / (m + 1) : 0;
        const k = (1 - Math.sqrt(dx * dx + dy * dy)) * a;
        if (k > bayer(x, y)) ov.put(x, y, 32, INK, 0, 3, 0);
      }
    }
  }

  // thin rule with a vermilion knot in the middle; `grow` 0..1 draws it outward from the centre
  function rule(ov, y, w, a, grow = 1, ch = '-', col = DIM, knot = '<>') {
    const C = ov.cols, x0 = Math.floor((C - w) / 2), mid = x0 + w / 2, half = (w / 2) * c01(grow);
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      if (Math.abs(x + 0.5 - mid) > half) continue;
      put(ov, x, y, ch, col, a);
    }
    if (knot && grow > 0.05) text(ov, Math.floor(mid - knot.length / 2), y, knot, VERM, a * c01(grow * 3), 1, 0.5);
  }

  // ─────────────────────────────── content ───────────────────────────────
  const TEXT = {
    title: {
      sub: 'an ascii night walk',
      cta: 'tap to begin',
      hint: 'WASD / arrows to walk - E to interact',
      phones: 'headphones on',
    },
    cards: {
      neon: { title: 'ASAKUSA', sub: 'Taito City, Tokyo - 11:52 pm' },
      avenue: { title: 'KAMINARIMON-DORI', sub: 'last buses, wet asphalt' },
      gate: { title: 'KAMINARI-MON', sub: 'the Thunder Gate - Fujin and Raijin keep watch' },
      nakamise: { title: 'NAKAMISE-DORI', sub: "one of Japan's oldest shopping streets, shutters down" },
      hozomon: { title: 'HOZO-MON', sub: 'the Treasure-House Gate' },
      temple: { title: 'SENSO-JI', sub: "Tokyo's oldest temple, founded 628" },
      pagoda: { title: 'GOJU-NO-TO', sub: 'five-storey pagoda, rebuilt 1973' },
      pond: { title: 'HYOTAN-IKE', sub: 'the gourd pond, as it was before 1951' },
    },
    intro: [
      'Late October, near midnight. Your last train has gone.',
      'To the north, past the gate, a few lanterns are still lit.',
    ],
    dialogs: {
      temple: [
        'In 628, two fishermen, the brothers Hinokuma Hamanari and Takenari, pulled a small statue of Kannon from the Sumida river in their nets.',
        'Their village chief made his home into a temple for it. The statue is still here, they say, never shown to anyone.',
      ],
      incense: [
        'You draw the smoke toward you with cupped hands.',
        'People believe it heals whatever it touches. Some guide it to their head, hoping to think more clearly.',
      ],
      temizu: [
        'Ladle in your right hand, pour over the left. Switch, and pour over the right.',
        'Cup a little water in your left palm and rinse your mouth from it. Never drink from the ladle itself.',
        'Tip the ladle upright, so the last water runs down the handle.',
      ],
      prayer: [
        'A coin into the offering box. A small bow.',
        'Palms together, you pray in silence. Senso-ji is a Buddhist temple: no clapping here - that belongs to Shinto shrines.',
        'A last bow.',
      ],
      omikuji_shake: [
        'A 100 yen coin. You shake the hexagonal box until a thin stick slides out of the hole.',
        'Its number is written in kanji. You find the drawer that matches, and take one paper.',
      ],
      lantern: [
        'You set a paper lantern on the water.',
        'It drifts out slowly, taking its small light away from you.',
      ],
      koi: [
        ['A koi rises to your shadow, mouths the surface, and sinks back into the dark.'],
        ['Koi can live for decades. This one may have been circling here since before you were born.'],
      ],
      cat: [
        ['The cat accepts exactly one scratch behind the ear.', 'Then it looks away, as if you had never been here.'],
        ['A temple cat. It has seen a great many visitors and is impressed by none of them.', 'It purrs anyway.'],
        ['The cat leans into your hand for a moment, then walks off toward the pagoda.', 'Its business is its own.'],
      ],
      vending: [
        'In autumn the machines turn warm: red labels are hot, blue labels are cold.',
        'Hot milk tea, 130 yen. The can is almost too hot to hold.',
      ],
      kaminarimon: [
        'The red lantern under the gate is almost four metres tall and weighs about 700 kilograms.',
        'Fujin, god of wind, stands guard on the right. Raijin, god of thunder, on the left.',
        'The old gate burned in 1865. This one was built in 1960.',
      ],
      hozomon: [
        "The gate's upper floor keeps the temple's sutras.",
        'On its back hang two straw sandals, each 4.5 metres long. Demons who see them, people say, think a giant guards the temple.',
      ],
      pagoda: [
        'The five-storey pagoda was rebuilt in 1973, after the old one burned in the war.',
        'Its top floor is said to hold a relic of the Buddha.',
      ],
      pond: [
        'Hyotan-ike, the gourd pond, lay west of the main hall until it was filled in, in 1951.',
        'Here it still holds the sky.',
      ],
      finale: [
        'Fireworks over the Sumida - out of season, unannounced.',
        'Smoke, water, a prayer, a paper fortune. Nothing more is asked of you tonight.',
        'The last one opens, hangs in the air, and lets go.',
      ],
    },
    prompts: {
      incense: 'smoke', temizu: 'purify', pray: 'pray', omikuji: 'omikuji', lantern: 'lantern',
      koi: 'koi', cat: 'pet', vending: 'buy', look: 'look', next: 'next', tie: 'tie', keep: 'keep',
    },
    rituals: ['incense smoke', 'prayer', 'omikuji'],
    fortuneFooter: { kyo: 'tie it to the rack to leave the bad luck here', good: 'keep it in your wallet' },
    // Senso-ji omikuji are famously strict: about three in ten are kyo. weight = percent of draws.
    // Categories follow the temple's own papers: wish, illness, lost things, the one you wait for,
    // building / moving, travel, marriage. `no` = drawer number shown on the strip (drawer 1 is dai-kichi).
    fortunes: [
      {
        rank: 'DAI-KICHI', reading: 'dai-kichi', meaning: 'great blessing', weight: 17, kyo: false, sets: [
          { no: 1, verse: 'a clear moon over still water', lines: ['WISH  it will be granted', 'ILLNESS  you will recover', 'LOST THINGS  found, close to home', 'TRAVEL  go; every road is kind'] },
          { no: 17, verse: 'spring wind through an open gate', lines: ['WISH  granted, and soon', 'THE ONE YOU WAIT FOR  is coming', 'MARRIAGE  joy on both sides', 'MOVING  a fine season for it'] },
        ],
      },
      {
        rank: 'KICHI', reading: 'kichi', meaning: 'blessing', weight: 35, kyo: false, sets: [
          { no: 8, verse: 'a lantern lit before dark', lines: ['WISH  it comes if you stop pushing', 'ILLNESS  slow, but it will pass', 'LOST THINGS  ask someone older', 'TRAVEL  good, in company'] },
          { no: 33, verse: 'the river finds its own way', lines: ['WISH  yes, by an unexpected road', 'THE ONE YOU WAIT FOR  will write', 'MARRIAGE  good, if you are honest', 'MOVING  steady; do not hurry'] },
          { no: 52, verse: 'rain the rice fields waited for', lines: ['WISH  it comes in its season', 'ILLNESS  rest, and it will lift', 'LOST THINGS  under something heavy', 'TRAVEL  fine, after the new year'] },
        ],
      },
      {
        rank: 'HAN-KICHI', reading: 'han-kichi', meaning: 'half blessing', weight: 5, kyo: false, sets: [
          { no: 46, verse: 'a bridge built halfway across', lines: ['WISH  half of it comes true', 'THE ONE YOU WAIT FOR  hesitates', 'TRAVEL  short journeys only', 'MOVING  keep the old key a while'] },
          { no: 71, verse: 'the moon behind thin cloud', lines: ['WISH  possible, with help', 'ILLNESS  better, worse, then gone', 'LOST THINGS  only part comes back', 'MARRIAGE  talk more, decide later'] },
        ],
      },
      {
        rank: 'SHO-KICHI', reading: 'sho-kichi', meaning: 'small blessing', weight: 4, kyo: false, sets: [
          { no: 23, verse: 'a small fire keeps the hut warm', lines: ['WISH  a small one is granted', 'ILLNESS  minor; keep warm', 'TRAVEL  near is better than far', 'MARRIAGE  quiet, and lasting'] },
          { no: 88, verse: 'one plum flower in the snow', lines: ['WISH  modest hopes come true', 'THE ONE YOU WAIT FOR  is near', 'LOST THINGS  in a coat pocket', 'MOVING  wait one more month'] },
        ],
      },
      {
        rank: 'SUE-SHO-KICHI', reading: 'sue-sho-kichi', meaning: 'small blessing, later', weight: 3, kyo: false, sets: [
          { no: 59, verse: 'seeds asleep under the frost', lines: ['WISH  late, but it comes', 'ILLNESS  long, then it heals', 'LOST THINGS  someone else finds it', 'TRAVEL  postpone it'] },
          { no: 94, verse: 'a boat waiting for the tide', lines: ['WISH  not yet; be patient', 'THE ONE YOU WAIT FOR  is delayed', 'MOVING  better next year', 'MARRIAGE  later is kinder'] },
        ],
      },
      {
        rank: 'SUE-KICHI', reading: 'sue-kichi', meaning: 'blessing, later', weight: 6, kyo: false, sets: [
          { no: 12, verse: 'the willow bends, and holds', lines: ['WISH  it comes after hardship', 'ILLNESS  recovery takes time', 'LOST THINGS  turns up much later', 'MOVING  after spring'] },
          { no: 77, verse: 'dawn comes slowly in winter', lines: ['WISH  delayed, not denied', 'THE ONE YOU WAIT FOR  comes late', 'TRAVEL  only if you must', 'MARRIAGE  wait for the thaw'] },
        ],
      },
      {
        rank: 'KYO', reading: 'kyo', meaning: 'bad luck', weight: 30, kyo: true, sets: [
          { no: 64, verse: 'a boat without oars at night', lines: ['WISH  it will not come true', 'ILLNESS  see a doctor; do not wait', 'LOST THINGS  gone; let it go', 'TRAVEL  stay home for now'] },
          { no: 29, verse: 'clouds on the moon all night', lines: ['WISH  not this year', "THE ONE YOU WAIT FOR  won't come", 'MOVING  a bad direction; wait', 'MARRIAGE  not now'] },
          { no: 96, verse: 'a leaf against the current', lines: ['WISH  let it go, for now', 'ILLNESS  long; be careful', 'MARRIAGE  not this one', 'TRAVEL  delays and trouble'] },
        ],
      },
    ],
    end: [
      'ASAKUSA.TXT',
      'an ascii night walk',
      'every lantern and every drop of rain was text',
      'keep wandering',
    ],
  };

  // one omikuji by weight: { rank, reading, meaning, verse, lines, kyo, no }
  function drawFortune(rand) {
    const R = typeof rand === 'function' ? rand : Math.random;
    const tbl = TEXT.fortunes, total = tbl.reduce((s, f) => s + f.weight, 0);
    let r = R() * total, f = tbl[tbl.length - 1];
    for (const e of tbl) { if (r < e.weight) { f = e; break; } r -= e.weight; }
    const set = f.sets[Math.floor(R() * f.sets.length) % f.sets.length];
    return { rank: f.rank, reading: f.reading, meaning: f.meaning, verse: set.verse, lines: set.lines.slice(), kyo: f.kyo, no: set.no };
  }
  // dialog lines by key; picks a variant for keys that have several (cat, koi)
  function lines(key, rand) {
    const d = TEXT.dialogs[key];
    if (!d) return [];
    if (Array.isArray(d[0])) return d[Math.floor((rand || Math.random)() * d.length) % d.length].slice();
    return d.slice();
  }

  // ─────────────────────────────── layout ───────────────────────────────
  function btnRect(ov, label) {
    const n = String(label || '').length, h = 5;
    let w = Math.max(9, n + 4);
    if ((w - n) % 2) w++;                 // keep the label exactly centred
    return [ov.cols - SAFE.side - w, ov.rows - SAFE.bottom - h, w, h];
  }
  // suggested positions; the stick ring spans +-7 cols / +-4 rows around its centre
  function layout(ov) {
    const b = btnRect(ov, 'omikuji'), sy = ov.rows - SAFE.bottom - 5.5;
    return { safe: SAFE, button: btnRect(ov, 'pray'), stick: [SAFE.side + 9.5, sy], stickRadius: [7, 7 * 0.55], dialogBottom: Math.min(b[1], Math.floor(sy) - 4) - 1 };
  }

  // per-widget memory (scramble start times etc.). A widget not drawn for GAP seconds starts fresh next time;
  // GAP is generous so a slow device (a few fps) does not restart the transition every frame.
  const GAP = 1.5;
  const S = { title: { t0: 0, last: -1e9 }, prompt: { label: '', t0: 0, last: -1e9 }, btn: { label: '', t0: 0, last: -1e9 }, rit: new Map() };

  // ─────────────────────────────── title ───────────────────────────────
  // FIGlet "georgia11", re-kerned by hand (78 cols); "thick" for narrower grids (53 cols)
  const LOGO_BIG = [
    "     db      .M\"\"\"bgd     db     `7MMF' `YM' `7MMF' `7MF' .M\"\"\"bgd     db",
    "    ;MM:    ,MI    \"Y    ;MM:      MM  .M'     MM     M  ,MI    \"Y    ;MM:",
    "   ,V^MM.   `MMb.       ,V^MM.     MM.d\"       MM     M  `MMb.       ,V^MM.",
    "  ,M  `MM     `YMMNq.  ,M  `MM     MMMMM.      MM     M    `YMMNq.  ,M  `MM",
    "  AbmmmqMA  .     `MM  AbmmmqMA    MM  VMA     MM     M  .     `MM  AbmmmqMA",
    " A'     VML Mb     dM A'     VML   MM   `MM.   YM.   ,M  Mb     dM A'     VML",
    ".AMA. .AMMA.P\"Ybmmd\" .AMA. .AMMA..JMML.  MMb.   `bmmd\"'  P\"Ybmmd\" .AMA. .AMMA.",
  ];
  const LOGO_MID = [
    "   db    .d88b.    db    8  dP 8    8 .d88b.    db",
    "  dPYb   YPwww.   dPYb   8wdP  8    8 YPwww.   dPYb",
    " dPwwYb      d8  dPwwYb  88Yb  8b..d8     d8  dPwwYb",
    "dP    Yb `Y88P' dP    Yb 8  Yb `Y88P' `Y88P' dP    Yb",
  ];
  const LOGO_POOL = "AMVYbdmq8P.:;'`^\",/\\|";
  const LOGO_BIG_W = maxLen(LOGO_BIG), LOGO_MID_W = maxLen(LOGO_MID);

  function title(ov, t, a = 1, t0) {
    const st = S.title;
    if (t0 !== undefined) st.t0 = t0;
    else if (!(t - st.last < GAP && t >= st.last)) st.t0 = t;
    st.last = t;
    a = c01(a);
    if (a <= 0.004) return;
    const C = ov.cols, R = ov.rows, el = t - st.t0, TT = TEXT.title;
    const logo = C >= LOGO_BIG_W + 6 ? LOGO_BIG : C >= LOGO_MID_W + 6 ? LOGO_MID : null;
    const land = C * 0.55 > R;
    const small = spaced('ASAKUSA');
    const lw = logo ? maxLen(logo) : small.length, lh = logo ? logo.length : 1;
    const sub = spaced(TT.sub).length <= C - 8 ? spaced(TT.sub) : TT.sub;
    // vertical rhythm: logo, .txt, rule, subtitle ... call to action ... headphones
    const blockH = lh + 5;
    const y0 = Math.max(SAFE.top + 4, Math.round(R * (land ? 0.18 : 0.25)));
    const lx = Math.floor((C - lw) / 2);
    wash(ov, lx - 3, y0 - 2, lw + 6, blockH + 3, a, 6);

    if (logo) {
      // letters arrive left to right as vermilion noise, then settle to paper; afterwards a slow
      // warm shimmer drifts across the logo every 9 s (whole columns, like light on lacquer)
      const sw = el - 3.2, per = 9, ph = ((sw % per) + per) % per, band = ph / 2.4 * (lw + 24) - 12;
      for (let r = 0; r < lh; r++) {
        const line = logo[r];
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === ' ') continue;
          const e = el - (0.15 + (i / lw) * 0.9 + hash(i * 1.7 + r * 9.3) * 0.25);
          if (e < 0) continue;
          let ch = c, col = mix(PAPER, [1, 0.94, 0.86], r / lh), g = 0.2;
          if (e < 0.38) {
            ch = LOGO_POOL[Math.floor(hash(i * 3.3 + r * 7.1 + Math.floor(t * 20) * 1.3) * LOGO_POOL.length) % LOGO_POOL.length];
            col = mix(VERM, PAPER, e / 0.38); g = 0.5;
          } else if (sw > 0) {
            const dd = Math.abs(i + r * 0.8 - band);
            if (dd < 6) { const k = 0.5 + 0.5 * Math.cos(dd / 6 * Math.PI); col = mix(col, GOLD, k * 0.55); g += k * 0.3; }
          }
          put(ov, lx + i, y0 + r, ch, col, a, 1, g);
        }
      }
      text(ov, lx + lw - 4, y0 + lh, scramble('.txt', t, st.t0 + 1.15), VERM, a, 1, 0.6);
    } else {
      rule(ov, y0 - 1, Math.min(C - 6, lw + 10), a * 0.9, ease((el - 0.1) / 0.6), '-', DIM, '');
      text(ov, lx, y0, scramble(small, t, st.t0 + 0.2), PAPER, a, 1, 0.45);
      text(ov, lx + lw - 4, y0 + 1, scramble('.txt', t, st.t0 + 0.9), VERM, a, 1, 0.6);
    }
    rule(ov, y0 + lh + 2, Math.min(C - 8, Math.max(24, Math.round(lw * 0.55))), a, ease((el - 1.25) / 0.6));
    text(ov, centreX(ov, sub), y0 + lh + 4, scramble(sub, t, st.t0 + 1.5), PAPER, a * 0.9, 1, 0.15);

    // call to action + desktop hint (one washed block), headphones near the bottom
    const yC = Math.min(Math.max(Math.round(R * (land ? 0.66 : 0.68)), y0 + blockH + 4), R - SAFE.bottom - 7);
    const yP = Math.max(R - SAFE.bottom - 2, yC + 5);
    const cta = spaced(TT.cta);
    const hint = TT.hint.length <= C - 4 ? TT.hint : 'E to interact';
    const ca = a * sstep(2.0, 2.6, el);
    if (ca > 0.004) {
      const bw = Math.max(cta.length, hint.length);
      wash(ov, Math.floor((C - bw) / 2) - 2, yC - 1, bw + 4, 4, ca, 5);
      const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos((el - 2.6) * 2.4));
      text(ov, centreX(ov, cta), yC, cta, GOLD, ca * pulse, 1, 0.5);
      text(ov, centreX(ov, hint), yC + 2, hint, SOFT, ca * 0.8);
      const ph = TT.phones, px = centreX(ov, ph), pa = a * sstep(2.6, 3.4, el);
      if (pa > 0.004) {
        wash(ov, px - 8, yP, ph.length + 16, 1, pa, 3);
        text(ov, px, yP, ph, SOFT, pa * 0.85);
        // sound waves breathing outward on both sides
        for (let k = 0; k < 3; k++) {
          const b = 0.2 + 0.8 * Math.max(0, Math.sin(t * 3 - k * 0.9));
          put(ov, px - 2 - k * 2, yP, '(', DIM, pa * b);
          put(ov, px + ph.length + 1 + k * 2, yP, ')', DIM, pa * b);
        }
      }
    }
  }

  // ─────────────────────────────── location card ───────────────────────────────
  const CARD_DUR = 3.6;
  function card(ov, t, c) {
    const el = t - (c.t0 || 0);
    if (el < 0) return true;
    if (el >= CARD_DUR) return false;
    const C = ov.cols, R = ov.rows;
    let ttl = spaced(c.title);
    if (ttl.length > C - 6) ttl = String(c.title);
    const subs = c.sub ? wrapBal(c.sub, Math.min(C - 8, 56)) : [];
    const y0 = Math.max(SAFE.top + 7, Math.round(R * 0.12));
    const tOut = CARD_DUR - 0.8, fade = 1 - sstep(tOut + 0.15, CARD_DUR, el);
    const ww = Math.max(ttl.length, maxLen(subs)) + 6;
    wash(ov, Math.floor((C - ww) / 2), y0 - 1, ww, 4 + subs.length, sstep(0, 0.35, el) * fade, 7);
    const s = el < tOut ? scramble(ttl, t, c.t0 + 0.05) : unscramble(ttl, t, c.t0 + tOut);
    text(ov, centreX(ov, ttl), y0, s, PAPER, 1, 1, 0.4);
    const rw = Math.min(C - 8, Math.max(ttl.length + 8, 22));
    rule(ov, y0 + 1, rw, fade, ease((el - 0.25) / 0.55) * (0.4 + 0.6 * fade), '-', DIM, '<>');
    const sa = sstep(0.75, 1.25, el) * fade;
    subs.forEach((l, i) => text(ov, centreX(ov, l), y0 + 2 + i, l, SOFT, sa));
    return true;
  }

  // ─────────────────────────────── dialog ───────────────────────────────
  // typewriter timing: ~45 chars/s with small breaths after punctuation and between paragraphs
  function schedule(rows) {
    let n = 0;
    for (const r of rows) n += r.s.length;
    const T = new Float32Array(n + 1);
    let acc = 0, k = 0, para = rows.length ? rows[0].p : 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      if (r.p !== para) { acc += 0.35; para = r.p; }
      for (let i = 0; i < r.s.length; i++) {
        T[k++] = acc;
        const ch = r.s[i], nx = i + 1 < r.s.length ? r.s[i + 1] : ' ';
        acc += 1 / 45;
        if ((ch === '.' || ch === '!' || ch === '?' || ch === ':') && nx === ' ') acc += 0.2;
        else if ((ch === ',' || ch === ';' || ch === '-') && nx === ' ') acc += 0.07;
      }
    }
    T[n] = acc;
    return T;
  }
  function dialog(ov, t, d) {
    const C = ov.cols, R = ov.rows, src = d.lines || [];
    const w = Math.min(C - 2 * SAFE.side, 80), x = Math.floor((C - w) / 2);
    const tw = w - 8;
    const key = src.join('\n') + '|' + tw;
    if (d._key !== key) {
      const rows = [];
      src.forEach((ln, p) => {
        if (p > 0) rows.push({ s: '', p, blank: true });
        for (const s of wrap(ln, tw)) rows.push({ s, p });
      });
      d._key = key; d._rows = rows; d._T = schedule(rows); d._n = d._T.length - 1;
    }
    const rows = d._rows, T = d._T, N = d._n;
    const h = rows.length + 4;
    // sits above the controls row (stick + action button) unless the caller passes d.bottom
    const bottom = d.bottom !== undefined ? Math.min(R, d.bottom | 0) : layout(ov).dialogBottom;
    const y = Math.max(SAFE.top + 4, bottom - h);
    const el = t - (d.t0 || 0), OPEN = 0.2;
    const open = ease(el / OPEN);
    if (open <= 0.004) return { done: false, typed: 0 };
    // frame unrolls from the centre
    const cw = Math.max(4, Math.round(w * open)), x0 = x + Math.floor((w - cw) / 2);
    for (let j = 0; j < h; j++) for (let i = 0; i < cw; i++) {
      const top = j === 0, bot = j === h - 1, lft = i === 0, rgt = i === cw - 1;
      let ch = ' ';
      if ((top || bot) && (lft || rgt)) ch = top ? '.' : "'";
      else if (top || bot) ch = '-';
      else if (lft || rgt) ch = '|';
      ov.put(x0 + i, y + j, ch, PAPER, 0, 3, 0);
    }
    if (d.name && open >= 1) {
      const tag = ' ' + String(d.name).toUpperCase() + ' ';
      text(ov, x + 3, y, tag, GOLD, 1, 3, 0.3);
    }
    if (open < 1) return { done: false, typed: 0 };
    const te = el - OPEN;
    let typed = 0;
    if (d.skip) typed = N;
    else { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= te) lo = m + 1; else hi = m; } typed = lo; }
    let k = 0;
    for (let r = 0; r < rows.length; r++) {
      const s = rows[r].s, yy = y + 2 + r;
      for (let i = 0; i < s.length; i++, k++) {
        if (k >= typed) break;
        const age = d.skip ? 1 : te - T[k];
        const col = age < 0.16 ? mix(GOLD, PAPER, age / 0.16) : PAPER;
        if (s[i] !== ' ') ov.put(x + 4 + i, yy, s[i], col, 0, 3, age < 0.16 ? 0.4 * (1 - age / 0.16) : 0);
      }
      if (k >= typed) break;
    }
    const done = typed >= N;
    if (done) {
      const since = d.skip ? te : te - T[N];
      const on = Math.floor(since * 1.6) % 2 === 0 ? 1 : 0.3;
      put(ov, x + w - 4, y + h - 2, 'v', GOLD, on * sstep(0, 0.15, since), 3, 0.5);
    }
    return { done, typed };
  }

  // ─────────────────────────────── omikuji strip ───────────────────────────────
  const FORTUNE_OPEN = 0.65;
  function fortuneRows(f, cw, maxRows) {
    const out = [];
    const B = (opt = true) => out.push({ k: 'blank', opt });
    B(false);
    if (f.no) out.push({ k: 'text', s: 'no. ' + f.no, col: GOLD });
    B();
    out.push({ k: 'band' }); out.push({ k: 'band', rank: true }); out.push({ k: 'band' });
    B();
    out.push({ k: 'text', s: f.meaning || '', col: PAPER });
    if (f.verse) { B(); for (const l of wrapBal('"' + f.verse + '"', cw)) out.push({ k: 'text', s: l, col: PAPER }); }
    B();
    out.push({ k: 'rule' });
    B();
    (f.lines || []).forEach((ln, i) => {
      if (i) B();
      const m = /^(.*?\S)\s{2,}(.*)$/.exec(ln);
      if (m) { out.push({ k: 'label', s: m[1] }); for (const l of wrap(m[2], cw - 2)) out.push({ k: 'body', s: l }); }
      else for (const l of wrap(ln, cw)) out.push({ k: 'body', s: l });
    });
    B();
    out.push({ k: 'rule', plain: true });
    B();
    for (const l of wrapBal(f.kyo ? TEXT.fortuneFooter.kyo : TEXT.fortuneFooter.good, cw)) out.push({ k: 'text', s: l, col: PAPER, foot: true });
    B(false);
    while (out.length + 2 > maxRows) {
      const i = out.findIndex(r => r.opt);
      if (i < 0) break;
      out.splice(i, 1);
    }
    return out;
  }
  function fortune(ov, t, f) {
    const C = ov.cols, R = ov.rows, el = t - (f.t0 || 0);
    if (el < 0) return true;
    const SW = Math.min(C - 4, 42), IW = SW - 2, CW = Math.min(IW - 4, 36);
    const key = C + 'x' + R;
    if (f._key !== key) { f._key = key; f._rows = fortuneRows(f, CW, R - 2); }
    const rows = f._rows, H = rows.length + 2;
    const x0 = Math.floor((C - SW) / 2), y0 = Math.max(0, Math.floor((R - H) / 2));
    const k = 0.06 + 0.94 * ease(el / FORTUNE_OPEN);
    const mid = y0 + (H - 1) / 2;
    const vt = Math.round(mid - (H - 1) / 2 * k), vb = Math.round(mid + (H - 1) / 2 * k);
    const appear = sstep(0, 0.12, el);
    wash(ov, x0, vt, SW, vb - vt + 1, appear, 6);
    const bandFill = f.kyo ? [0.55, 0.57, 0.74] : VERM;
    const rankCol = f.kyo ? [0.86, 0.88, 1] : [1, 0.62, 0.48];
    const icx = x0 + 1 + Math.floor(IW / 2);
    for (let y = vt; y <= vb; y++) {
      const top = y === vt, bot = y === vb;
      for (let i = 0; i < SW; i++) {
        const lft = i === 0, rgt = i === SW - 1;
        let ch = ' ';
        if ((top || bot) && (lft || rgt)) ch = top ? '.' : "'";
        else if (top || bot) ch = '-';
        else if (lft || rgt) ch = '|';
        cell(ov, x0 + i, y, ch, ch === ' ' ? WARM : PAPER, appear);
      }
      if (top || bot) continue;
      const r = rows[y - y0 - 1];
      if (!r) continue;
      if (r.k === 'band') {
        for (let i = 1; i < SW - 1; i++) cell(ov, x0 + i, y, ' ', bandFill, appear);
        if (r.rank) {
          const rs = spaced(f.rank).length <= IW - 2 ? spaced(f.rank) : String(f.rank);
          const s = scramble(rs, t, (f.t0 || 0) + FORTUNE_OPEN * 0.7);
          for (let i = 0; i < s.length; i++) if (s[i] !== ' ') ov.put(icx - Math.floor(rs.length / 2) + i, y, s[i], rankCol, 0, 3, 0.55);
        }
      } else if (r.k === 'text') {
        const s = r.s;
        for (let i = 0; i < s.length; i++) if (s[i] !== ' ') ov.put(icx - Math.floor(s.length / 2) + i, y, s[i], r.col, 0, 3, 0);
      } else if (r.k === 'label') {
        for (let i = 0; i < r.s.length; i++) if (r.s[i] !== ' ') ov.put(x0 + 3 + i, y, r.s[i], GOLD, 0, 3, 0.15);
      } else if (r.k === 'body') {
        for (let i = 0; i < r.s.length; i++) if (r.s[i] !== ' ') ov.put(x0 + 5 + i, y, r.s[i], PAPER, 0, 3, 0);
      } else if (r.k === 'rule') {
        const rw = r.plain ? 12 : CW - 4;
        for (let i = 0; i < rw; i++) ov.put(icx - Math.floor(rw / 2) + i, y, r.plain ? '.' : '-', PAPER, 0, 3, 0);
        if (!r.plain) { ov.put(icx - 1, y, '<', VERM, 0, 3, 0.3); ov.put(icx, y, '>', VERM, 0, 3, 0.3); }
      }
    }
    return el < FORTUNE_OPEN;
  }

  // ─────────────────────────────── world prompt ───────────────────────────────
  function prompt(ov, x, y, label, t, key) {
    const L = String(label), st = S.prompt, K = key ? String(key) : '';
    if (st.label !== L || t - st.last > GAP || t < st.last) { st.label = L; st.t0 = t; }
    st.last = t;
    const el = t - st.t0, a = 0.3 + 0.7 * sstep(0, 0.18, el);
    const C = ov.cols, R = ov.rows, kw = K ? K.length + 3 : 0, w = L.length + kw + 6, h = 3;
    const bx = clampI(Math.round(x - w / 2), 1, C - w - 1);
    const by = clampI(Math.round(y) - 5, SAFE.top + 4, R - h - 2);
    const s = scramble(L, t, st.t0 + 0.05);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const top = j === 0, bot = j === h - 1, lft = i === 0, rgt = i === w - 1;
      let ch = ' ';
      if ((top || bot) && (lft || rgt)) ch = top ? '.' : "'";
      else if (top || bot) ch = '-';
      else if (lft || rgt) ch = ':';
      cell(ov, bx + i, by + j, ch, ch === ' ' ? PAPER : GOLD, a);
    }
    if (K) { cell(ov, bx + 3, by + 1, '[', DIM, a); for (let i = 0; i < K.length; i++) cell(ov, bx + 4 + i, by + 1, K[i], GOLD, a, 0.3); cell(ov, bx + 4 + K.length, by + 1, ']', DIM, a); }
    for (let i = 0; i < s.length; i++) if (s[i] !== ' ') cell(ov, bx + 3 + kw + i, by + 1, s[i], PAPER, a);
    // marker points at the object and bobs between the frame and the row below
    const mx = clampI(Math.round(x), bx + 2, bx + w - 3);
    const down = Math.sin(t * 3.4) < 0 ? 1 : 0;
    if (a >= 1) put(ov, mx, by + h - 1 + down, 'v', VERM, 1, down ? 1 : 3, 0.6);
    return [bx, by, w, h];
  }

  // ─────────────────────────────── HUD ───────────────────────────────
  function hud(ov, s) {
    const a = s.alpha === undefined ? 1 : c01(s.alpha), t = s.t || 0;
    const C = ov.cols, x0 = SAFE.side, y0 = SAFE.top;
    const rits = s.rituals || [];
    if (a > 0.004) {
      const pw = maxLen(rits.map(r => r.label)) + 4;
      wash(ov, x0, y0, pw, rits.length, a, 2);
      rits.forEach((r, i) => {
        const y = y0 + i;
        let m = S.rit.get(r.label);
        if (!m) { m = { done: !!r.done, tc: -1e9 }; S.rit.set(r.label, m); }
        if (!!r.done !== m.done) { m.done = !!r.done; m.tc = r.done ? t : -1e9; }
        const since = t - m.tc, fresh = since >= 0 && since < 1.6 ? 1 - since / 1.6 : 0;
        const col = r.done ? mix(PAPER, GOLD, fresh) : SOFT;
        const ra = r.done ? 1 : 0.62;
        text(ov, x0, y, '[', col, a * ra * 0.8);
        text(ov, x0 + 2, y, ']', col, a * ra * 0.8);
        if (r.done) put(ov, x0 + 1, y, since >= 0 && since < 0.35 ? rchar('x', 1, Math.floor(t * 22)) : 'x', VERM, a, 1, 0.5 + fresh);
        const lab = fresh > 0 ? scramble(r.label, t, m.tc) : r.label;
        text(ov, x0 + 4, y, lab, col, a * ra, 1, fresh * 0.6);
      });
    }
    // top-right toggles
    const btn = (x, label, on) => {
      const s2 = '[ ' + label + ' ]';
      const col = on ? PAPER : DIM;
      text(ov, x, y0, '[', on ? GOLD : DIM, a * (on ? 0.9 : 0.7));
      text(ov, x + s2.length - 1, y0, ']', on ? GOLD : DIM, a * (on ? 0.9 : 0.7));
      text(ov, x + 2, y0, label, col, a * (on ? 1 : 0.7), 1, on ? 0.15 : 0);
      if (on) text(ov, x + 2, y0 + 1, '-'.repeat(label.length), VERM, a * 0.9, 1, 0.3);
      return s2.length;
    };
    const ws = 9, wr = 8;
    const xs = C - SAFE.side - ws, xr = xs - 2 - wr;
    wash(ov, xr, y0, ws + wr + 2, 2, a, 2);
    btn(xr, 'rain', !!s.rain);
    btn(xs, 'sound', !!s.sound);
    const rect = (x, w) => [Math.max(0, x - 1), 0, Math.min(w + 2, C - Math.max(0, x - 1)), y0 + 3];
    return { rain: rect(xr, wr), sound: rect(xs, ws) };
  }

  // ─────────────────────────────── joystick ───────────────────────────────
  // ring cells relative to the centre cell, built once: symmetric, one glyph per cell, '.' / "'" placed by
  // where the curve crosses the cell, ':' at the flanks. 7 cols x 3.85 rows reads as a circle on screen.
  const RING = (() => {
    const rx = 7, ry = rx * 0.55, N = 28, m = new Map(), sr = v => Math.sign(v) * Math.round(Math.abs(v));
    for (let n = 0; n < N; n++) {
      const ang = (n / N) * Math.PI * 2, X = Math.cos(ang) * rx, Y = Math.sin(ang) * ry;
      const dx = sr(X), dy = sr(Y), f = Y - dy;
      const ch = f < -0.2 ? "'" : f > 0.2 ? '.' : (Math.abs(Math.cos(ang)) > 0.85 ? ':' : '-');
      const k = dx + ',' + dy;
      if (!m.has(k)) m.set(k, { dx, dy, ch, ux: X / rx, uy: Y / ry });
    }
    return { rx, ry, cells: [...m.values()] };
  })();
  function stick(ov, s) {
    const act = !!s.active, a = act ? 1 : 0.55;
    const ox = s.ox, oy = s.oy, kx = s.kx === undefined ? ox : s.kx, ky = s.ky === undefined ? oy : s.ky;
    const cx = Math.floor(ox), cy = Math.floor(oy);
    const dx = kx - ox, dy = (ky - oy) / 0.55, dl = Math.hypot(dx, dy);
    for (const c of RING.cells) {
      let hi = 0;
      if (act && dl > 0.6) hi = Math.pow(Math.max(0, (c.ux * dx + c.uy * dy) / dl), 5) * Math.min(1, dl / RING.rx);
      put(ov, cx + c.dx, cy + c.dy, c.ch, mix(mix(SOFT, PAPER, 0.5), GOLD, hi), a * (0.85 + 0.15 * hi), 3, hi * 0.5);
    }
    if (act && dl > 1.5) for (let q = 1; q <= 2; q++) {
      const f = q / 3;
      put(ov, Math.floor(ox + (kx - ox) * f), Math.floor(oy + (ky - oy) * f), '.', GOLD, 0.3 + 0.2 * q, 1, 0.2);
    }
    const kxi = Math.floor(kx) - 1, kyi = Math.floor(ky);
    if (act) {
      text(ov, kxi, kyi, '(', PAPER, 0.9, 3, 0.4);
      put(ov, kxi + 1, kyi, '@', GOLD, 1, 3, 0.9);
      text(ov, kxi + 2, kyi, ')', PAPER, 0.9, 3, 0.4);
    } else {
      text(ov, kxi, kyi, '(.)', SOFT, a, 3);
    }
  }

  // ─────────────────────────────── action button ───────────────────────────────
  function button(ov, s) {
    const st = S.btn;
    if (!s || !s.visible) { st.label = ''; st.last = -1e9; return null; }
    const t = s.t || 0, L = String(s.label || '');
    if (L !== st.label || t - st.last > GAP || t < st.last) { st.label = L; st.t0 = t; }
    st.last = t;
    const [x, y, w, h] = btnRect(ov, L);
    const el = t - st.t0, a = 0.3 + 0.7 * sstep(0, 0.15, el), p = !!s.pressed;
    const breathe = 0.82 + 0.18 * Math.sin(t * 2.2);
    const bcol = p ? GOLD : mix(PAPER, GOLD, 0.25 * breathe);
    const fill = p ? VERM : PAPER;
    const hz = p ? '=' : '-';
    const rowsS = [
      ' .' + hz.repeat(w - 4) + '. ',
      '/' + ' '.repeat(w - 2) + '\\',
      '|' + ' '.repeat(w - 2) + '|',
      '\\' + ' '.repeat(w - 2) + '/',
      " '" + hz.repeat(w - 4) + "' ",
    ];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = rowsS[j][i];
      const inside = (j === 0 || j === h - 1) ? i >= 1 && i <= w - 2 : true;
      if (!inside) continue;
      cell(ov, x + i, y + j, ch, ch === ' ' ? fill : bcol, a, p ? 0.6 : 0.1);
    }
    const lab = scramble(L, t, st.t0 + 0.05);
    const lx = x + Math.floor((w - L.length) / 2);
    for (let i = 0; i < lab.length; i++) if (lab[i] !== ' ') cell(ov, lx + i, y + 2, lab[i], p ? [1, 0.86, 0.6] : PAPER, a, p ? 0.8 : 0.1);
    return [x, y, w, h];
  }

  // ─────────────────────────────── end card ───────────────────────────────
  function end(ov, t, t0) {
    const el = t - (t0 || 0);
    if (el < 0) return true;
    const C = ov.cols, R = ov.rows, L = TEXT.end;
    const yT = Math.round(R * 0.36);
    // the night dissolves into ink, densest around the text; a little sky stays visible at the top
    const dk = sstep(0, 3, el), sky = Math.max(3, Math.round(R * 0.22));
    if (dk > 0.004) for (let y = 0; y < R; y++) {
      const ky = dk * (y < sky ? 0.55 + 0.45 * (y / sky) : 1);
      for (let x = 0; x < C; x++) {
        const th = bayer(x, y) * 0.75 + hash(x * 0.37 + y * 7.1) * 0.25;
        if (ky > th) ov.put(x, y, 32, INK, 0, 3, 0);
      }
    }
    let ttl = spaced(L[0]);
    if (ttl.length > C - 6) ttl = L[0];
    if (el > 1.1) text(ov, centreX(ov, ttl), yT, scramble(ttl, t, t0 + 1.1), PAPER, 1, 1, 0.4);
    rule(ov, yT + 2, Math.min(C - 8, Math.max(ttl.length, 24)), 1, ease((el - 1.7) / 0.7));
    const a2 = sstep(2.1, 2.8, el);
    text(ov, centreX(ov, L[1]), yT + 4, L[1], PAPER, a2 * 0.9);
    const body = wrapBal(L[2], Math.min(C - 8, 52)), a3 = sstep(3.2, 4.0, el);
    body.forEach((l, i) => text(ov, centreX(ov, l), yT + 8 + i, l, SOFT, a3));
    const yl = yT + 8 + body.length + 3;
    const a4 = sstep(4.6, 5.6, el) * (0.8 + 0.2 * Math.cos(Math.max(0, el - 5.6) * 1.3));
    text(ov, centreX(ov, L[3]), yl, L[3], GOLD, a4, 1, 0.5);
    return el < 5.6;
  }

  return {
    TEXT, title, card, dialog, fortune, prompt, hud, stick, button, end,
    scramble, unscramble, drawFortune, lines, layout, wrap, spaced,
    SAFE, COL: { PAPER, VERM, GOLD, DIM, SOFT, INK, WARM },
  };
})();
