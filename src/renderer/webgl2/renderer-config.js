/**
 * Renderer Config
 * Centralized, production-safe configuration surface for the WebGL2 renderer.
 * All defaults match current behavior to preserve identical visuals and interactions.
 *
 * Units:
 * - secondsToWorldX, freqToWorldY: world units per second and log2 ratio
 * - *Px values are CSS pixels at zoom=1 (scaled in shaders with current zoom)
 * - *WU values are world units (pre-transform)
 */

export const defaultRendererConfig = {
  // Time/frequency mapping
  scales: {
    // x = seconds * secondsToWorldX * xScaleFactor
    secondsToWorldX: 200,
    // y = log2(baseFreq / freq) * freqToWorldY * yScaleFactor
    freqToWorldY: 100
  },

  // Note body visuals (world-space height and vertical alignment, rounded rect in CSS px at zoom=1)
  note: {
    heightWU: 22,
    // Shift applied to top-left so the visual center matches legacy 20px rows (+1 up)
    centerShiftWU: -1,
    roundedCornerPxAtZoom1: 6,
    borderPxAtZoom1: 1
  },

  // Base note glyph circle (world-space size)
  baseNote: {
    circleSizeWU: 40
  },

  // Playhead (CSS px and color)
  playhead: {
    // Premultiplied-friendly RGBA (matches #ffa800)
    color: [1.0, 0.66, 0.0, 1.0],
    thicknessPx: 1
  },

  // Measure bars dash style (CSS px)
  measures: {
    dashPx: 6,
    gapPx: 6
  },

  // Silence dashed border ring (CSS px)
  silenceRing: {
    dashPx: 3,
    gapPx: 3,
    // Sub-pixel inward bias so dashed ring thickness aligns visually with the solid border
    alignBiasPx: 0.25
  },

  // Overlay layout factors (relative to note height)
  overlays: {
    // Right pull tab width ~= 0.5 * noteHeight - border (exact calc remains in code; factor used as basis)
    tabWidthFactor: 0.5,
    // Left octave arrow column width ~= 0.5 * noteHeight
    arrowColumnWidthFactor: 0.5,
    // Inner vertical bar width ~= 0.1 * noteHeight
    innerTabBarWidthFactor: 0.1,
    // ID label font ~= 0.12 * noteHeight
    idLabelFontFactor: 0.12,
    // Fraction font ~= 0.26 * noteHeight
    fractionFontFactor: 0.26,
    // Divider thickness ~= 0.12 * fraction font px
    dividerThicknessFactor: 0.12
  },

  // Selection/hover ring thickness (CSS px at zoom=1)
  selection: {
    ringThicknessPxAtZoom1: 2,
    hoverThicknessPxAtZoom1: 1
  },

  // Text/glyph system
  text: {
    // Default glyph atlas usage (query string and localStorage can still override)
    useGlyphAtlasDefault: true,
    glyphBasePx: 64,
    maxOnscreenFontPx: 96,
    // Soft cap for texture backing store (device pixels)
    softTextureCapPx: 1024
  }
};

/**
 * Deep-merge a partial config into defaults and return a normalized config object.
 * - Arrays are replaced (last write wins), primitives are overwritten
 * - Objects are merged recursively
 */
export function normalizeRendererConfig(partial) {
  return deepMerge(defaultRendererConfig, partial || {});
}

/**
 * Deep merge: returns a new object; does not mutate inputs.
 */
export function deepMerge(a, b) {
  if (!isObject(a)) return clone(b);
  if (!isObject(b)) return clone(a);

  const out = { ...a };
  for (const k of Object.keys(b)) {
    const av = a[k];
    const bv = b[k];
    if (isPlainObject(av) && isPlainObject(bv)) {
      out[k] = deepMerge(av, bv);
    } else {
      out[k] = clone(bv);
    }
  }
  return out;
}

function isObject(x) {
  return x !== null && typeof x === 'object';
}
function isPlainObject(x) {
  return isObject(x) && Object.getPrototypeOf(x) === Object.prototype;
}
function clone(v) {
  if (Array.isArray(v)) return v.slice();
  if (isPlainObject(v)) return { ...v };
  return v;
}