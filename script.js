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
      this.tick = this.tick.bind(this);
    }

    setOptions(settings) {
      const fontChanged = settings.fontSize !== this.fontSize;
      this.fontSize = settings.fontSize;
      this.speed = settings.speed;
      this.density = settings.density;
      this.glow = settings.glow;
      this.bgFill = hexWithAlpha(settings.bgColor, settings.bgAlpha);
      this.bgOpaque = settings.bgColor;
      this.rainFill = hexWithAlpha(settings.rainColor, settings.rainAlpha);
      this.rainColor = settings.rainColor;
      this.headFill = resolveHeadColor(settings);
      this.chars = resolveCharset(settings);
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

    step() {
      const { ctx, fontSize, chars } = this;

      ctx.fillStyle = this.bgFill;
      ctx.fillRect(0, 0, this.width, this.height);

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
    }

    // A single frozen "mid-rain" frame, used when the animation is paused
    // (e.g. prefers-reduced-motion) so the page isn't blank.
    renderStaticFrame() {
      const { ctx, fontSize, chars } = this;
      if (!this.columns) return;
      const rows = Math.ceil(this.height / fontSize);
      ctx.fillStyle = this.bgOpaque;
      ctx.fillRect(0, 0, this.width, this.height);
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
    }
  }

  // ===== DOM / Settings panel ==============================================

  const $ = (id) => document.getElementById(id);

  const canvas = $('digitalRainCanvas');
  const engine = new RainEngine(canvas);

  const settings = sanitize(Storage.load());
  const saveDebounced = debounce(() => Storage.save(settings), 300);

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
    play: $('play-toggle'),
    reset: $('reset-button'),
    shuffle: $('shuffle-button'),
    fullscreen: $('fullscreen-button'),
    panel: $('settings-panel'),
    toggle: $('settings-toggle-button'),
  };

  function setPageTheme() {
    const root = document.documentElement.style;
    root.setProperty('--page-bg', settings.bgColor);
    root.setProperty('--text-color', settings.rainColor);
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
