/**
 * Theme presets (ROADMAP.md Phase 3, data layer).
 *
 * A theme is a flat map of semantic tokens plus note geometry. The
 * theme-manager (Phase 3) projects these into (1) CSS custom properties
 * (`--rmt-*`) for the DOM and (2) a renderer-config partial for WebGL.
 *
 * `classic-orange` MUST be pixel-identical to the app's pre-theme visuals —
 * its values are read straight from the hardcoded shader/CSS literals:
 *   accent  #ffa800  (note id label / playhead / selection)
 *   border  #636363  (note border / silence ring / base circle)
 *   dependency highlights: frequency #ff8000, startTime #00ffff,
 *     duration #9d00ff  (renderer.js HIGHLIGHT_COLORS_*)
 *   bg #151525 (styles.css body)
 *
 * This file is pure data — no DOM/GL imports — so it is safe to import from
 * the settings panel before the theme system is wired.
 */

/** @typedef {{id:string,name:string,tokens:object,geometry:object}} ThemePreset */

const CLASSIC_ORANGE = {
  id: 'classic-orange',
  name: 'Classic Orange',
  tokens: {
    accent: '#ffa800',
    accentText: '#151525',
    bg: '#151525',
    surface: '#1e1e2e',
    surfaceBorder: '#3a3a4a',
    textPrimary: '#ffffff',
    textSecondary: '#aaaaaa',
    danger: '#ff0000',
    noteBorder: '#636363',
    playhead: '#ffa800',
    measureBar: '#ffffff',
    selectionRing: '#ffa800',
    hoverRing: '#ffffff',
    // Dependency highlight colors (source = dep, target = rdep tint).
    depFrequency: '#ff8000',
    depStartTime: '#00ffff',
    depDuration: '#9d00ff',
    noteDefaultSaturation: 0.7,
    // 'random' | 'accent' | a hex string
    newNoteColorMode: 'random',
  },
  geometry: {
    noteHeightWU: 22,
    borderPxAtZoom1: 1,
    roundedCornerPxAtZoom1: 6,
  },
};

const SLATE_CYAN = {
  id: 'slate-cyan',
  name: 'Slate Cyan',
  tokens: {
    accent: '#38bdf8',
    accentText: '#0b1120',
    bg: '#0b1120',
    surface: '#111a2e',
    surfaceBorder: '#26334d',
    textPrimary: '#e6f0ff',
    textSecondary: '#8fa3c0',
    danger: '#f43f5e',
    noteBorder: '#5a6a85',
    playhead: '#38bdf8',
    measureBar: '#cbd5e1',
    selectionRing: '#38bdf8',
    hoverRing: '#cbd5e1',
    depFrequency: '#fb923c',
    depStartTime: '#22d3ee',
    depDuration: '#a78bfa',
    noteDefaultSaturation: 0.62,
    newNoteColorMode: 'random',
  },
  geometry: { noteHeightWU: 22, borderPxAtZoom1: 1, roundedCornerPxAtZoom1: 6 },
};

const MONO_LIGHT = {
  id: 'mono-light',
  name: 'Mono Light',
  tokens: {
    accent: '#d17400',
    accentText: '#ffffff',
    bg: '#f5f5f0',
    surface: '#ffffff',
    surfaceBorder: '#cfcfc7',
    textPrimary: '#1a1a1a',
    textSecondary: '#666660',
    danger: '#c62828',
    noteBorder: '#9a9a92',
    playhead: '#d17400',
    measureBar: '#333333',
    selectionRing: '#d17400',
    hoverRing: '#333333',
    depFrequency: '#e06600',
    depStartTime: '#0088aa',
    depDuration: '#7a2fd0',
    noteDefaultSaturation: 0.55,
    newNoteColorMode: 'random',
  },
  geometry: { noteHeightWU: 22, borderPxAtZoom1: 1, roundedCornerPxAtZoom1: 6 },
};

const HIGH_CONTRAST = {
  id: 'high-contrast',
  name: 'High Contrast',
  tokens: {
    accent: '#ffd400',
    accentText: '#000000',
    bg: '#000000',
    surface: '#0a0a0a',
    surfaceBorder: '#ffffff',
    textPrimary: '#ffffff',
    textSecondary: '#dddddd',
    danger: '#ff2d2d',
    noteBorder: '#ffffff',
    playhead: '#ffd400',
    measureBar: '#ffffff',
    selectionRing: '#ffd400',
    hoverRing: '#ffffff',
    depFrequency: '#ff8000',
    depStartTime: '#00ffff',
    depDuration: '#c46bff',
    noteDefaultSaturation: 0.85,
    newNoteColorMode: 'random',
  },
  geometry: { noteHeightWU: 22, borderPxAtZoom1: 2, roundedCornerPxAtZoom1: 4 },
};

/** @type {Record<string, ThemePreset>} */
export const THEME_PRESETS = {
  'classic-orange': CLASSIC_ORANGE,
  'slate-cyan': SLATE_CYAN,
  'mono-light': MONO_LIGHT,
  'high-contrast': HIGH_CONTRAST,
};

export const DEFAULT_THEME_ID = 'classic-orange';

export function getPreset(id) {
  return THEME_PRESETS[id] || THEME_PRESETS[DEFAULT_THEME_ID];
}
