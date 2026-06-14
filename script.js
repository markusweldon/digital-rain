/* Digital Rain — zero-dependency canvas effect.
   Classic script (no ES modules) so double-clicking index.html keeps
   working from file:// in every browser. */
(() => {
  'use strict';

  // ===== Config =============================================================

  const STORAGE_KEY = 'digital-rain.settings.v1';
  const BASE_FPS = 30;
  const IDLE_HIDE_MS = 3000;

  const CHARSETS = {
    katakana: 'ｦｱｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:・."=*+-<>¦',
    latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{}|;\':",.<>/?',
    binary: '01',
    symbols: '@#$%^&*()_+-=[]{}|;:\'",.<>/?~`!',
  };

  const THEMES = {
    matrix:    { bgColor: '#000000', bgAlpha: 0.08, rainColor: '#00ff41', rainAlpha: 1, headColor: '#d8ffe8', charset: 'katakana' },
    synthwave: { bgColor: '#292138', bgAlpha: 0.08, rainColor: '#ff04a3', rainAlpha: 1, headColor: '#ffd9f2', charset: 'latin' },
    amber:     { bgColor: '#100800', bgAlpha: 0.10, rainColor: '#ffb000', rainAlpha: 1, headColor: '#ffe9c0', charset: 'latin' },
    ice:       { bgColor: '#020a12', bgAlpha: 0.08, rainColor: '#66ccff', rainAlpha: 1, headColor: '#eaf8ff', charset: 'binary' },
  };

  const DEFAULTS = {
    theme: 'synthwave',
    bgColor: '#292138',
    bgAlpha: 0.08,
    rainColor: '#ff04a3',
    rainAlpha: 1,
    fontSize: 16,
    speed: 1,
    density: 1,
    glow: true,
    grid: false,
    trailGradient: true,
    message: '',
    messageStyle: 'transmission',
    charset: 'latin',
    customChars: '',
  };

  // Numeric bounds mirror the slider min/max in index.html; loaded settings
  // are clamped so stale/corrupt localStorage can't break rendering.
  const RANGES = {
    bgAlpha: [0.02, 0.5],
    rainAlpha: [0.3, 1],
    fontSize: [10, 40],
    speed: [0.1, 2],
    density: [0.1, 1],
  };

  // ===== Helpers ============================================================

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const alphaHex = (a) => Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');

  const hexWithAlpha = (hex, a) => hex + alphaHex(a);

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('');
  }

  // Light tint of a color, used to derive a head color for custom themes.
  function mixWithWhite(hex, t) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
  }

  // Linear blend between two [r,g,b] arrays.
  function lerpRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  // ----- Shareable-URL codec: settings <-> URL-safe base64 of JSON -----
  function encodeSettings(s) {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(s));
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch {
      return '';
    }
  }

  function decodeSettings(str) {
    try {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function resolveCharset(settings) {
    if (settings.charset === 'custom') {
      // Array.from splits by code point, so emoji/astral chars stay intact.
      const chars = [...new Set(Array.from(settings.customChars.trim()))].filter((c) => c.trim());
      if (chars.length >= 2) return chars;
    }
    return Array.from(CHARSETS[settings.charset] || CHARSETS.latin);
  }

  function resolveHeadColor(settings) {
    const theme = THEMES[settings.theme];
    return theme ? theme.headColor : mixWithWhite(settings.rainColor, 0.75);
  }

  // ===== Storage ============================================================
  // localStorage can throw (file://, private browsing); never let it break boot.

  const Storage = {
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(settings) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch { /* ignore */ }
    },
    clear() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch { /* ignore */ }
    },
  };

  function sanitize(loaded) {
    const s = { ...DEFAULTS };
    if (!loaded || typeof loaded !== 'object') return s;
    for (const key of ['bgColor', 'rainColor']) {
      if (/^#[0-9a-f]{6}$/i.test(loaded[key])) s[key] = loaded[key].toLowerCase();
    }
    for (const key of Object.keys(RANGES)) {
      const v = Number(loaded[key]);
      if (Number.isFinite(v)) s[key] = clamp(v, RANGES[key][0], RANGES[key][1]);
    }
    if (loaded.theme === 'custom' || THEMES[loaded.theme]) s.theme = loaded.theme;
    if (CHARSETS[loaded.charset] || loaded.charset === 'custom') s.charset = loaded.charset;
    if (typeof loaded.customChars === 'string') s.customChars = loaded.customChars.slice(0, 200);
    if (typeof loaded.glow === 'boolean') s.glow = loaded.glow;
    if (typeof loaded.grid === 'boolean') s.grid = loaded.grid;
    if (typeof loaded.trailGradient === 'boolean') s.trailGradient = loaded.trailGradient;
    if (typeof loaded.message === 'string') s.message = loaded.message.slice(0, 60);
    if (loaded.messageStyle === 'transmission' || loaded.messageStyle === 'woven') {
      s.messageStyle = loaded.messageStyle;
    }
    return s;
  }

  // ===== RainEngine =========================================================

  class RainEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.drops = [];
      this.columns = 0;
      this.width = 0;
      this.height = 0;
      this.fontSize = DEFAULTS.fontSize;
      this.running = false;
      this.rafId = 0;
      this.lastTime = 0;
      this.gridPhase = 0; // 0..1 scroll offset for the synthwave floor grid
      this.msgClock = 0;  // step counter driving the transmission fade cycle
      this.woven = null;  // active woven-message run, or null between runs
      this.wovenGap = 0;  // steps remaining before the next woven run
      this.tick = this.tick.bind(this);
    }

    setOptions(settings) {
      const fontChanged = settings.fontSize !== this.fontSize;
      this.fontSize = settings.fontSize;
      this.speed = settings.speed;
      this.density = settings.density;
      this.glow = settings.glow;
      this.gridEnabled = settings.grid;
      this.bgFill = hexWithAlpha(settings.bgColor, settings.bgAlpha);
      this.bgOpaque = settings.bgColor;
      this.rainFill = hexWithAlpha(settings.rainColor, settings.rainAlpha);
      this.rainColor = settings.rainColor;
      this.headFill = resolveHeadColor(settings);
      this.chars = resolveCharset(settings);
      this.trailGradient = settings.trailGradient;
      // Precomputed RGB triplets for trail-gradient interpolation.
      this.rainRgb = hexToRgb(settings.rainColor);
      this.bgRgb = hexToRgb(settings.bgColor);
      if (settings.message !== this.message || settings.messageStyle !== this.messageStyle) {
        this.woven = null; // restart the reveal if the text/style changed
        this.wovenGap = 0;
      }
      this.message = settings.message;
      this.messageStyle = settings.messageStyle;
      if (fontChanged) {
        this.resize(true);
      }
      if (!this.running) this.renderStaticFrame();
    }

    newDrop() {
      return {
        y: -Math.floor(Math.random() * 40),
        speed: 0.6 + Math.random() * 0.9,
        acc: Math.random(),
      };
    }

    respawn(drop) {
      // Lower density stretches the off-screen delay before a column re-enters.
      drop.y = -Math.floor(Math.random() * 24 / this.density);
      drop.speed = 0.6 + Math.random() * 0.9;
      drop.acc = 0;
    }

    // Resize the backing store for the current viewport and DPR. Existing
    // drops are preserved (trimmed/extended) unless `rebuild` is set, so a
    // window resize doesn't restart every stream at once.
    resize(rebuild = false) {
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      // Setting canvas.width resets all context state.
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.font = this.fontSize + 'px monospace';
      this.ctx.textAlign = 'center';
      this.columns = Math.max(1, Math.floor(this.width / this.fontSize));
      if (rebuild) this.drops = [];
      while (this.drops.length < this.columns) this.drops.push(this.newDrop());
      this.drops.length = this.columns;
      // The browser blanks the canvas on resize; repaint so the page
      // background never flashes through.
      this.ctx.fillStyle = this.bgOpaque;
      this.ctx.fillRect(0, 0, this.width, this.height);
      if (!this.running) this.renderStaticFrame();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastTime = 0;
      this.rafId = requestAnimationFrame(this.tick);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    }

    tick(now) {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(this.tick);
      const interval = 1000 / (BASE_FPS * this.speed);
      if (!this.lastTime) this.lastTime = now;
      const elapsed = now - this.lastTime;
      if (elapsed < interval) return;
      this.lastTime = now - (elapsed % interval);
      this.step();
    }

    // A classic synthwave perspective floor in the lower part of the screen:
    // vertical lines fanning from a vanishing point on the horizon, plus
    // horizontal lines that bunch toward the horizon and scroll outward.
    // Drawn on the rain canvas (behind the glyphs); save/restore keeps its
    // alpha/shadow state from leaking into the rain passes.
    drawGrid() {
      if (!this.gridEnabled || !this.height) return;
      const { ctx } = this;
      const W = this.width;
      const H = this.height;
      const horizonY = H * 0.62;
      const vpX = W / 2;
      const floorH = H - horizonY;
      const ROWS = 9;
      const COLS = 7;
      const baseAlpha = 0.3;

      ctx.save();
      ctx.strokeStyle = this.rainColor;
      ctx.lineWidth = 1.3;
      if (this.glow) {
        ctx.shadowColor = this.rainColor;
        ctx.shadowBlur = this.fontSize * 0.5;
      }

      // Vertical fan — endpoints evenly spaced along the bottom edge (with
      // overscan) so the lines converge correctly at the vanishing point.
      ctx.globalAlpha = baseAlpha;
      ctx.beginPath();
      for (let c = -COLS; c <= COLS; c++) {
        ctx.moveTo(vpX, horizonY);
        ctx.lineTo(vpX + (c / COLS) * W * 1.6, H);
      }
      ctx.stroke();

      // Horizontal scroll lines — quadratic spacing bunches them near the
      // horizon; per-line edge fade hides the seam as the phase wraps.
      for (let r = 0; r < ROWS; r++) {
        const t = (r + this.gridPhase) / ROWS;
        const y = horizonY + t * t * floorH;
        const edgeFade = Math.min(1, t * 4) * Math.min(1, (1 - t) * 4 + 0.25);
        ctx.globalAlpha = baseAlpha * edgeFade;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Bright horizon line ties the floor to the "sky".
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(W, horizonY);
      ctx.stroke();

      ctx.restore();
    }

    step() {
      const { ctx, fontSize, chars } = this;

      ctx.fillStyle = this.bgFill;
      ctx.fillRect(0, 0, this.width, this.height);

      this.drawGrid();
      if (this.gridEnabled) {
        // One full row-slot every 20 steps; scroll speed tracks the Speed
        // slider since step() cadence does. Wrap for a seamless loop.
        this.gridPhase += 0.05;
        if (this.gridPhase >= 1) this.gridPhase -= 1;
      }

      // Pass A — trail bodies. The just-vacated head cell is repainted with a
      // fresh random glyph in the rain color: this both dims last frame's
      // bright head and produces the classic "mutating" trail.
      const heads = [];
      ctx.fillStyle = this.rainFill;
      for (let i = 0; i < this.drops.length; i++) {
        const drop = this.drops[i];
        drop.acc += drop.speed;
        let steps = Math.floor(drop.acc);
        drop.acc -= steps;
        if (!steps) continue;

        const x = (i + 0.5) * fontSize;
        while (steps--) {
          if (drop.y >= 0 && drop.y * fontSize <= this.height) {
            ctx.fillText(chars[(Math.random() * chars.length) | 0], x, drop.y * fontSize);
          }
          drop.y += 1;

          if (drop.y * fontSize > this.height + fontSize) {
            this.respawn(drop);
          } else if (drop.y > 0 && Math.random() > 0.978) {
            this.respawn(drop);
          }
        }

        if (drop.y >= 0 && drop.y * fontSize <= this.height) {
          heads.push(x, drop.y * fontSize);
        }
      }

      // Trail gradient — a short bright "neck" just above each head, fading
      // from the rain color toward the background. The bgFill fade still owns
      // the long tail below it; this only sharpens the freshest cells.
      if (this.trailGradient) {
        const NECK = 9;
        for (let h = 0; h < heads.length; h += 2) {
          const x = heads[h];
          const headY = heads[h + 1];
          for (let k = 1; k <= NECK; k++) {
            const y = headY - k * fontSize;
            if (y < 0) break;
            const f = (k - 1) / (NECK - 1);
            const [r, g, b] = lerpRgb(this.rainRgb, this.bgRgb, f);
            ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(1 - f * 0.85).toFixed(3)})`;
            ctx.fillText(chars[(Math.random() * chars.length) | 0], x, y);
          }
        }
      }

      // Pass B — glowing heads, batched so shadow state changes only once
      // per frame (per-glyph shadow toggling is a major canvas perf trap).
      if (this.glow) {
        ctx.shadowColor = this.rainColor;
        ctx.shadowBlur = fontSize * 0.6;
      }
      ctx.fillStyle = this.headFill;
      for (let i = 0; i < heads.length; i += 2) {
        ctx.fillText(chars[(Math.random() * chars.length) | 0], heads[i], heads[i + 1]);
      }
      ctx.shadowBlur = 0;

      this.drawMessage(true);
    }

    // Hidden message overlay. Isolated seam so the presentation style can be
    // swapped. `animate` advances timing (false = a single frozen frame).
    drawMessage(animate) {
      if (!this.message) return;
      if (this.messageStyle === 'woven') {
        this.drawWoven(animate);
      } else {
        this.drawTransmission(animate);
      }
    }

    // "Transmission": the phrase fades in centered, holds, fades out, loops.
    drawTransmission(animate) {
      const { ctx } = this;
      // 160-step cycle (~5.3s at 30fps): fade in / hold / fade out / gap.
      const CYCLE = 160;
      if (animate) this.msgClock = (this.msgClock + 1) % CYCLE;
      const p = this.msgClock;
      let alpha;
      if (!animate) alpha = 1;          // frozen frame shows it fully
      else if (p < 20) alpha = p / 20;
      else if (p < 120) alpha = 1;
      else if (p < 140) alpha = 1 - (p - 120) / 20;
      else return;                       // gap — nothing drawn
      if (alpha <= 0) return;

      ctx.save();
      // Scale the text to ~82% of the canvas width.
      let size = this.fontSize * 3;
      ctx.font = `bold ${size}px monospace`;
      const target = this.width * 0.82;
      const w = ctx.measureText(this.message).width;
      if (w > target) {
        size = Math.max(this.fontSize, size * (target / w));
        ctx.font = `bold ${size}px monospace`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = alpha;
      ctx.shadowColor = this.rainColor;
      ctx.shadowBlur = size * 0.5;
      ctx.fillStyle = this.headFill;
      ctx.fillText(this.message, this.width / 2, this.height / 2);
      ctx.restore();
    }

    // "Woven": every so often a column spells the phrase top-to-bottom as a
    // bright block descending through the rain.
    drawWoven(animate) {
      const { ctx, fontSize } = this;
      const chars = Array.from(this.message);
      const len = chars.length;
      const rows = Math.ceil(this.height / fontSize);

      if (!animate) {
        // Frozen frame: show the block centered in a central column.
        const col = Math.floor(this.columns / 2);
        const top = Math.max(0, Math.floor((rows - len) / 2));
        this.paintWoven(col, top + len, chars);
        return;
      }

      if (!this.woven) {
        if (this.wovenGap > 0) { this.wovenGap--; return; }
        const col = 2 + Math.floor(Math.random() * Math.max(1, this.columns - 4));
        this.woven = { col, headRow: 0 };
      }
      const run = this.woven;
      this.paintWoven(run.col, run.headRow, chars);
      run.headRow++;
      if (run.headRow - len > rows) {       // fully off the bottom
        this.woven = null;
        this.wovenGap = 120;                // ~4s pause before the next run
      }
    }

    // Draw the message chars stacked in one column, last char at `headRow`.
    paintWoven(col, headRow, chars) {
      const { ctx, fontSize } = this;
      const x = (col + 0.5) * fontSize;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = this.rainColor;
      ctx.shadowBlur = this.glow ? fontSize * 0.8 : 0;
      for (let ci = 0; ci < chars.length; ci++) {
        const row = headRow - (chars.length - 1 - ci);
        if (row < 0 || row > this.height / fontSize) continue;
        ctx.fillStyle = ci === chars.length - 1 ? this.headFill : this.rainColor;
        ctx.fillText(chars[ci], x, row * fontSize);
      }
      ctx.restore();
    }

    // A single frozen "mid-rain" frame, used when the animation is paused
    // (e.g. prefers-reduced-motion) so the page isn't blank.
    renderStaticFrame() {
      const { ctx, fontSize, chars } = this;
      if (!this.columns) return;
      const rows = Math.ceil(this.height / fontSize);
      ctx.fillStyle = this.bgOpaque;
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawGrid(); // frozen at the current phase while paused
      for (let i = 0; i < this.columns; i++) {
        if (Math.random() > this.density) continue;
        const x = (i + 0.5) * fontSize;
        const headRow = 2 + Math.floor(Math.random() * rows);
        const len = 4 + Math.floor(Math.random() * rows * 0.5);
        for (let k = 0; k <= len; k++) {
          const row = headRow - k;
          if (row < 0) break;
          ctx.globalAlpha = k === 0 ? 1 : Math.max(0.05, 1 - k / len);
          ctx.fillStyle = k === 0 ? this.headFill : this.rainFill;
          ctx.fillText(chars[(Math.random() * chars.length) | 0], x, row * fontSize);
        }
      }
      ctx.globalAlpha = 1;
      this.drawMessage(false);
    }
  }

  // ===== DOM / Settings panel ==============================================

  const $ = (id) => document.getElementById(id);

  const canvas = $('digitalRainCanvas');
  const engine = new RainEngine(canvas);

  // A shared link (#s=…) takes precedence over saved settings, then persists.
  const hashMatch = location.hash.match(/(?:^#|&)s=([^&]+)/);
  const fromHash = hashMatch ? decodeSettings(hashMatch[1]) : null;
  const settings = sanitize(fromHash || Storage.load());
  const saveDebounced = debounce(() => Storage.save(settings), 300);
  if (fromHash) Storage.save(settings);

  const controls = {
    theme: $('theme-select'),
    bgColor: $('bg-color-picker'),
    bgAlpha: $('bg-alpha-range'),
    rainColor: $('text-color-picker'),
    rainAlpha: $('text-alpha-range'),
    fontSize: $('font-size-range'),
    fontSizeValue: $('font-size-value'),
    speed: $('speed-range'),
    speedValue: $('speed-value'),
    density: $('density-range'),
    densityValue: $('density-value'),
    charset: $('charset-select'),
    customRow: $('custom-chars-row'),
    customChars: $('custom-chars-input'),
    glow: $('glow-checkbox'),
    grid: $('grid-checkbox'),
    trailGradient: $('gradient-checkbox'),
    message: $('message-input'),
    messageStyle: $('message-style-select'),
    messageStyleRow: $('message-style-row'),
    play: $('play-toggle'),
    reset: $('reset-button'),
    shuffle: $('shuffle-button'),
    share: $('share-button'),
    fullscreen: $('fullscreen-button'),
    panel: $('settings-panel'),
    toggle: $('settings-toggle-button'),
  };

  function setPageTheme() {
    const root = document.documentElement.style;
    root.setProperty('--page-bg', settings.bgColor);
    root.setProperty('--text-color', settings.rainColor);
    // Drive the whole UI accent from the rain color so the panel matches
    // whatever theme is active.
    const [r, g, b] = hexToRgb(settings.rainColor);
    root.setProperty('--accent', settings.rainColor);
    root.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.setProperty('--accent-2', resolveHeadColor(settings));
  }

  // Push the current settings into every control (used on boot, theme
  // change, shuffle and reset — slider input events skip this).
  function syncControls() {
    controls.theme.value = settings.theme;
    controls.bgColor.value = settings.bgColor;
    controls.bgAlpha.value = settings.bgAlpha;
    controls.rainColor.value = settings.rainColor;
    controls.rainAlpha.value = settings.rainAlpha;
    controls.fontSize.value = settings.fontSize;
    controls.fontSizeValue.textContent = settings.fontSize + 'px';
    controls.speed.value = settings.speed;
    controls.speedValue.textContent = settings.speed.toFixed(1) + 'x';
    controls.density.value = settings.density;
    controls.densityValue.textContent = Math.round(settings.density * 100) + '%';
    controls.charset.value = settings.charset;
    controls.customChars.value = settings.customChars;
    controls.customRow.hidden = settings.charset !== 'custom';
    controls.glow.checked = settings.glow;
    controls.grid.checked = settings.grid;
    controls.trailGradient.checked = settings.trailGradient;
    controls.message.value = settings.message;
    controls.messageStyle.value = settings.messageStyle;
    controls.messageStyleRow.hidden = !settings.message;
  }

  function applySettings(partial, { keepTheme = false } = {}) {
    Object.assign(settings, partial);
    if (!keepTheme) settings.theme = 'custom';
    engine.setOptions(settings);
    setPageTheme();
    saveDebounced();
  }

  function applyTheme(name) {
    if (!THEMES[name]) {
      settings.theme = 'custom';
    } else {
      Object.assign(settings, THEMES[name], { theme: name });
    }
    engine.setOptions(settings);
    setPageTheme();
    syncControls();
    saveDebounced();
  }

  controls.theme.addEventListener('change', () => applyTheme(controls.theme.value));

  controls.bgColor.addEventListener('input', () => applySettings({ bgColor: controls.bgColor.value }));
  controls.rainColor.addEventListener('input', () => applySettings({ rainColor: controls.rainColor.value }));
  controls.bgAlpha.addEventListener('input', () => applySettings({ bgAlpha: parseFloat(controls.bgAlpha.value) }));
  controls.rainAlpha.addEventListener('input', () => applySettings({ rainAlpha: parseFloat(controls.rainAlpha.value) }));

  controls.fontSize.addEventListener('input', () => {
    applySettings({ fontSize: parseInt(controls.fontSize.value, 10) }, { keepTheme: true });
    controls.fontSizeValue.textContent = settings.fontSize + 'px';
  });
  controls.speed.addEventListener('input', () => {
    applySettings({ speed: parseFloat(controls.speed.value) }, { keepTheme: true });
    controls.speedValue.textContent = settings.speed.toFixed(1) + 'x';
  });
  controls.density.addEventListener('input', () => {
    applySettings({ density: parseFloat(controls.density.value) }, { keepTheme: true });
    controls.densityValue.textContent = Math.round(settings.density * 100) + '%';
  });

  controls.charset.addEventListener('change', () => {
    applySettings({ charset: controls.charset.value }, { keepTheme: true });
    controls.customRow.hidden = settings.charset !== 'custom';
    if (settings.charset === 'custom') controls.customChars.focus();
  });
  controls.customChars.addEventListener('input', () => {
    applySettings({ customChars: controls.customChars.value }, { keepTheme: true });
  });

  controls.glow.addEventListener('change', () => {
    applySettings({ glow: controls.glow.checked }, { keepTheme: true });
  });

  controls.grid.addEventListener('change', () => {
    applySettings({ grid: controls.grid.checked }, { keepTheme: true });
  });

  controls.trailGradient.addEventListener('change', () => {
    applySettings({ trailGradient: controls.trailGradient.checked }, { keepTheme: true });
  });

  controls.message.addEventListener('input', () => {
    applySettings({ message: controls.message.value }, { keepTheme: true });
    controls.messageStyleRow.hidden = !settings.message;
  });
  controls.messageStyle.addEventListener('change', () => {
    applySettings({ messageStyle: controls.messageStyle.value }, { keepTheme: true });
  });

  controls.share.addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#s=' + encodeSettings(settings);
    try { history.replaceState(null, '', url); } catch { /* ignore */ }
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* fall through */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* fall through */ }
    }
    if (!ok) { try { window.prompt('Copy this link:', url); ok = true; } catch { /* ignore */ } }
    const original = controls.share.textContent;
    controls.share.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { controls.share.textContent = original; }, 1500);
  });

  controls.reset.addEventListener('click', () => {
    Storage.clear();
    Object.assign(settings, DEFAULTS);
    engine.setOptions(settings);
    setPageTheme();
    syncControls();
  });

  controls.shuffle.addEventListener('click', () => {
    const hue = Math.floor(Math.random() * 360);
    applySettings({
      rainColor: hslToHex(hue, 95, 55),
      bgColor: hslToHex((hue + 150 + Math.random() * 60) % 360, 55, 6),
    });
    syncControls();
  });

  // ----- Play / pause + reduced motion -----

  let paused = false;

  function setPaused(value) {
    paused = value;
    if (paused) {
      engine.stop();
      engine.renderStaticFrame();
    } else {
      engine.start();
    }
    controls.play.textContent = paused ? '▶ Play' : '⏸ Pause';
    controls.play.setAttribute('aria-pressed', String(paused));
  }

  controls.play.addEventListener('click', () => setPaused(!paused));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', () => setPaused(reducedMotion.matches));

  // ----- Fullscreen -----

  const fsRoot = document.documentElement;
  if (!fsRoot.requestFullscreen && !fsRoot.webkitRequestFullscreen) {
    controls.fullscreen.hidden = true; // iPhone Safari has no Fullscreen API
  }
  controls.fullscreen.addEventListener('click', () => {
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen).call(fsRoot);
    }
  });
  document.addEventListener('fullscreenchange', () => {
    controls.fullscreen.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  });

  // ----- Panel open/close -----
  // One .open class drives both the desktop popover and the mobile bottom
  // sheet (the difference lives entirely in CSS media queries).

  function setPanelOpen(open) {
    controls.panel.classList.toggle('open', open);
    controls.toggle.setAttribute('aria-expanded', String(open));
    if (!open && controls.panel.contains(document.activeElement)) {
      controls.toggle.focus();
    }
  }

  const isPanelOpen = () => controls.panel.classList.contains('open');

  controls.toggle.addEventListener('click', () => setPanelOpen(!isPanelOpen()));

  document.addEventListener('click', (event) => {
    if (!isPanelOpen()) return;
    if (controls.panel.contains(event.target) || controls.toggle.contains(event.target)) return;
    setPanelOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isPanelOpen()) setPanelOpen(false);
  });

  // ----- Screensaver-style idle hide -----

  let idleTimer;

  function wake() {
    document.body.classList.remove('ui-hidden');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!isPanelOpen()) document.body.classList.add('ui-hidden');
    }, IDLE_HIDE_MS);
  }

  for (const type of ['pointermove', 'pointerdown', 'keydown']) {
    document.addEventListener(type, wake, { passive: true });
  }

  // ----- Resize -----

  const onResize = debounce(() => engine.resize(), 200);
  window.addEventListener('resize', onResize);

  // ===== Bootstrap ==========================================================

  engine.setOptions(settings);
  engine.resize(true);
  setPageTheme();
  syncControls();
  setPaused(reducedMotion.matches);
  wake();
})();
