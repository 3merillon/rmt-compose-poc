/**
 * Theme manager (ROADMAP.md Phase 3).
 *
 * Projects a theme (preset + sparse overrides) into TWO targets:
 *   1. CSS custom properties (`--rmt-*`) on <html> — themes all DOM that
 *      references them (the settings panel already does; styles.css is being
 *      migrated token-by-token).
 *   2. The WebGL renderer's config, via the existing `renderer.setConfig`,
 *      for note geometry (height / border / corner). Geometry changes require
 *      a re-sync (note rects are computed in sync()), so we call the resync
 *      hook the host registers.
 *
 * GL *color* literals (the orange accent baked into shaders) are not yet
 * uniform-driven; converting them is the remaining Phase 3 item. Until then
 * DOM + geometry theming is live and the canvas keeps its per-note colors.
 *
 * Usage (from player.js once the workspace exists):
 *   import { themeManager } from './theme/theme-manager.js';
 *   themeManager.init({ renderer, requestResync: () => updateVisualNotes(...) });
 */

import { settingsStore } from '../settings/settings-store.js';
import { getPreset } from './presets.js';

/**
 * Parse a #rgb / #rrggbb hex string to {r,g,b} 0..255 ints. Returns null on
 * failure.
 */
function hexToRgb255(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Parse a #rgb / #rrggbb hex string to a [r,g,b,a] float array in 0..1.
 * Returns null on failure.
 */
function hexToRgba(hex) {
  const c = hexToRgb255(hex);
  if (!c) return null;
  return [c.r / 255, c.g / 255, c.b / 255, 1.0];
}

// Map theme token keys -> CSS custom property names.
const CSS_VAR_MAP = {
  accent: '--rmt-accent',
  accentText: '--rmt-accent-text',
  bg: '--rmt-bg',
  surface: '--rmt-surface',
  surfaceBorder: '--rmt-surface-border',
  textPrimary: '--rmt-text-primary',
  textSecondary: '--rmt-text-secondary',
  danger: '--rmt-danger',
  noteBorder: '--rmt-note-border',
  playhead: '--rmt-playhead',
  measureBar: '--rmt-measure-bar',
  selectionRing: '--rmt-selection-ring',
  hoverRing: '--rmt-hover-ring',
  depFrequency: '--rmt-dep-frequency',
  depStartTime: '--rmt-dep-start-time',
  depDuration: '--rmt-dep-duration',
};

class ThemeManager {
  constructor() {
    this._renderer = null;
    this._requestResync = null;
    this._initialized = false;
    this._lastGeometryKey = null;
  }

  /**
   * Wire the manager to the live renderer + a resync callback, apply the
   * current theme, and subscribe to settings changes.
   * @param {{renderer:object, requestResync:Function}} opts
   */
  init({ renderer, requestResync } = {}) {
    this._renderer = renderer || null;
    this._requestResync = typeof requestResync === 'function' ? requestResync : null;
    this._initialized = true;

    this.apply();

    // React to appearance changes live.
    settingsStore.subscribe(({ path }) => {
      if (!path || path === '' || path === 'appearance' || path.indexOf('appearance') === 0) {
        this.apply();
      }
    });
  }

  /**
   * Resolve the effective theme = preset tokens/geometry overlaid with the
   * user's settings (themeId, sparse color overrides, note geometry sliders).
   */
  resolve() {
    const appearance = settingsStore.get('appearance') || {};
    const preset = getPreset(appearance.themeId);
    const tokens = { ...preset.tokens, ...(appearance.overrides || {}) };
    // Note geometry: settings sliders win over the preset's geometry.
    const noteCfg = appearance.note || {};
    const geometry = {
      noteHeightWU: noteCfg.heightWU ?? preset.geometry.noteHeightWU,
      borderPxAtZoom1: noteCfg.borderPxAtZoom1 ?? preset.geometry.borderPxAtZoom1,
      roundedCornerPxAtZoom1: noteCfg.roundedCornerPxAtZoom1 ?? preset.geometry.roundedCornerPxAtZoom1,
    };
    return { id: preset.id, tokens, geometry };
  }

  /** Apply the resolved theme to CSS variables + the renderer. */
  apply() {
    const theme = this.resolve();
    this._applyCssVars(theme.tokens);
    this._applyRenderer(theme.geometry, theme.tokens);
  }

  _applyCssVars(tokens) {
    try {
      const rootStyle = document.documentElement.style;
      for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
        const val = tokens[key];
        if (typeof val === 'string') rootStyle.setProperty(cssVar, val);
      }
      // RGB component triplets for rgba(var(--rmt-*-rgb), A) usages (glows,
      // scrollbars, translucent bars). Derived from the hex tokens.
      const setRgb = (cssVar, hex) => {
        const c = hexToRgb255(hex);
        if (c) rootStyle.setProperty(cssVar, `${c.r}, ${c.g}, ${c.b}`);
      };
      setRgb('--rmt-accent-rgb', tokens.accent);
      setRgb('--rmt-bg-rgb', tokens.bg);
      setRgb('--rmt-surface-rgb', tokens.surface);
      setRgb('--rmt-danger-rgb', tokens.danger);
      // Numeric token: the saturation new notes' random colors are born with
      // (read back by note-creation.js). Published as a CSS var so consumers
      // don't need to import the theme system.
      if (typeof tokens.noteDefaultSaturation === 'number' && Number.isFinite(tokens.noteDefaultSaturation)) {
        rootStyle.setProperty('--rmt-note-default-saturation', String(tokens.noteDefaultSaturation));
      }
    } catch (e) {
      console.warn('[theme] CSS var apply failed', e);
    }
  }

  _applyRenderer(geometry, tokens) {
    if (!this._renderer || typeof this._renderer.setConfig !== 'function') return;
    try {
      // Playhead color is already config-driven (renderer-config playhead.color
      // as premultiplied-friendly RGBA), so theme it directly. Other GL accents
      // (base circle, octave guides, note-id labels, selection ring) are still
      // shader literals — converting them to uniforms is the remaining item.
      const playRgba = hexToRgba(tokens?.playhead || tokens?.accent);
      this._renderer.setConfig({
        note: {
          heightWU: geometry.noteHeightWU,
          borderPxAtZoom1: geometry.borderPxAtZoom1,
          roundedCornerPxAtZoom1: geometry.roundedCornerPxAtZoom1,
        },
        ...(playRgba ? { playhead: { color: playRgba } } : {}),
      });

      // GL structural colors (base circle, octave/base guide lines, note-id +
      // measure-id labels) via the renderer's theme-color path.
      if (tokens && typeof this._renderer.setThemeColors === 'function') {
        this._renderer.setThemeColors({
          accent: tokens.accent,
          noteBorder: tokens.noteBorder,
          measureBar: tokens.measureBar,
          selectionRing: tokens.selectionRing,
          hoverRing: tokens.hoverRing,
          depFrequency: tokens.depFrequency,
          depStartTime: tokens.depStartTime,
          depDuration: tokens.depDuration,
          // On-note glyph text (fractions, "silence", octave arrows).
          textPrimary: tokens.textPrimary,
        });
      }
      // Geometry affects note rects computed in sync(); re-sync only when it
      // actually changed to avoid needless full rebuilds on color-only edits.
      const geoKey = `${geometry.noteHeightWU}:${geometry.borderPxAtZoom1}:${geometry.roundedCornerPxAtZoom1}`;
      if (geoKey !== this._lastGeometryKey) {
        this._lastGeometryKey = geoKey;
        if (this._requestResync) this._requestResync();
      }
    } catch (e) {
      console.warn('[theme] renderer apply failed', e);
    }
  }
}

export const themeManager = new ThemeManager();
