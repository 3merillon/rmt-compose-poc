/**
 * Settings schema — defaults + validation for the user-facing settings system
 * (ROADMAP.md Phase 2).
 *
 * Design rule (project invariant): every default here MUST reproduce exactly
 * the app's pre-settings behavior, so a fresh user or a wiped store looks and
 * behaves identically to before. In particular reverb and stereo default OFF
 * (the engine was mono/dry), and the arrow interval defaults to the octave.
 *
 * The store persists a versioned envelope under `rmt:settings:v1`. When the
 * schema grows, bump SETTINGS_VERSION and add a migration in `migrate()`.
 */

export const SETTINGS_VERSION = 1;

// Outer rails for the workspace scale factors AND for the user-editable limits
// themselves. The limits are what the sliders span; these are what the limits
// may span — six orders of magnitude, so a composition can be laid out at a
// density far from the default one.
export const SCALE_HARD_MIN = 0.001;
export const SCALE_HARD_MAX = 1000;

/**
 * Slider detent for a scale range: about a fiftieth of the span, snapped to a
 * 1/2/5 ladder so the numbers stay round. The default ranges land on 0.02 (X)
 * and 0.1 (Y), both of which keep 1.0 exactly reachable by dragging.
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function scaleStep(lo, hi) {
  const span = Math.max((hi - lo) || 0, SCALE_HARD_MIN);
  const raw = span / 50;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;                       // in [1, 10)
  const snapped = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return Math.max(snapped * mag, 1e-4);
}

/**
 * Factory for a fresh defaults object (never share a mutable reference).
 * @returns {object}
 */
export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    appearance: {
      themeId: 'classic-orange',
      // Sparse per-token color overrides on top of the active theme preset.
      overrides: {},
      // Note geometry (mirrors renderer-config defaults).
      note: {
        heightWU: 22,
        borderPxAtZoom1: 1,
        roundedCornerPxAtZoom1: 6,
      },
    },
    arrows: {
      enabled: true,
      // 'reciprocal' — user edits `up`, `down` auto-derives (d/n).
      // 'independent' — up and down are set separately.
      mode: 'reciprocal',
      up: { n: 2, d: 1, label: null },
      down: { n: 1, d: 2, label: null },
    },
    audio: {
      masterVolume: 1,
      defaultInstrument: 'sine-wave',
      reverb: {
        // On by default (user decision 2026-07-12): a touch of room ambience is
        // the nicer out-of-box sound. Stereo stays off; limiter stays on.
        enabled: true,
        roomSize: 0.5,
        decaySec: 1.8,
        damping: 0.5,
        preDelayMs: 20,
        wet: 0.25,
      },
      stereo: {
        enabled: false,
        width: 0.6,
      },
      limiter: { enabled: true },
    },
    library: {
      iconSizePx: 56,
      showCents: true,
      layoutVersion: 2,
    },
    scale: {
      // Workspace density — the same two values the bottom-left Scale Controls
      // widget drives. 1.0 is the pre-settings default; they now persist, so a
      // reload restores the view you left.
      x: 1,
      y: 1,
      // The rails the scale sliders span. These reproduce the widget's original
      // hardcoded slider bounds, and are editable so you can work at a density
      // orders of magnitude away from the default one.
      limits: { xMin: 0.3, xMax: 2, yMin: 0.3, yMax: 5 },
    },
  };
}

// ---- validation helpers -------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clampNum = (v, lo, hi, fallback) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const asBool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const isPosInt = (v) => Number.isInteger(v) && v > 0;

/**
 * Validate/coerce an arrow ratio {n,d,label}. Returns a clean object.
 * Enforces positive integers, ratio in [1/16, 16], ratio !== 1.
 */
export function validateRatio(raw, fallback) {
  const fb = fallback || { n: 2, d: 1, label: null };
  if (!raw || typeof raw !== 'object') return { ...fb };
  let n = isPosInt(raw.n) ? raw.n : fb.n;
  let d = isPosInt(raw.d) ? raw.d : fb.d;
  const ratio = n / d;
  if (!(ratio >= 1 / 16 && ratio <= 16) || ratio === 1) {
    n = fb.n;
    d = fb.d;
  }
  const label = typeof raw.label === 'string' && raw.label.length <= 12 ? raw.label : null;
  return { n, d, label };
}

/**
 * Validate one axis's {min,max} scale limits. An inverted or degenerate range
 * would leave the slider unusable, so it falls back to that axis's defaults
 * wholesale rather than inventing a bound the user never chose. (The panel
 * fixes ordering up before it writes, so this is the corrupt-storage path.)
 */
function validateScaleRange(rawLo, rawHi, defLo, defHi) {
  const lo = clampNum(rawLo, SCALE_HARD_MIN, SCALE_HARD_MAX, defLo);
  const hi = clampNum(rawHi, SCALE_HARD_MIN, SCALE_HARD_MAX, defHi);
  return (hi > lo) ? { lo, hi } : { lo: defLo, hi: defHi };
}

/**
 * Validate a settings object against the schema, coercing invalid fields to
 * defaults. Always returns a complete, safe settings object.
 * @param {any} raw - possibly-partial, possibly-corrupt input
 * @returns {object}
 */
export function validateSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;

  const src = raw;
  const a = src.appearance || {};
  const an = a.note || {};
  d.appearance.themeId = typeof a.themeId === 'string' ? a.themeId : d.appearance.themeId;
  d.appearance.overrides = (a.overrides && typeof a.overrides === 'object') ? { ...a.overrides } : {};
  d.appearance.note.heightWU = clampNum(an.heightWU, 8, 60, d.appearance.note.heightWU);
  d.appearance.note.borderPxAtZoom1 = clampNum(an.borderPxAtZoom1, 0, 6, d.appearance.note.borderPxAtZoom1);
  d.appearance.note.roundedCornerPxAtZoom1 = clampNum(an.roundedCornerPxAtZoom1, 0, 20, d.appearance.note.roundedCornerPxAtZoom1);

  const ar = src.arrows || {};
  d.arrows.enabled = asBool(ar.enabled, d.arrows.enabled);
  d.arrows.mode = ar.mode === 'independent' ? 'independent' : 'reciprocal';
  d.arrows.up = validateRatio(ar.up, d.arrows.up);
  if (d.arrows.mode === 'reciprocal') {
    d.arrows.down = { n: d.arrows.up.d, d: d.arrows.up.n, label: null };
  } else {
    d.arrows.down = validateRatio(ar.down, d.arrows.down);
  }

  const au = src.audio || {};
  const rv = au.reverb || {};
  const st = au.stereo || {};
  const lm = au.limiter || {};
  d.audio.masterVolume = clampNum(au.masterVolume, 0, 1, d.audio.masterVolume);
  d.audio.defaultInstrument = typeof au.defaultInstrument === 'string' ? au.defaultInstrument : d.audio.defaultInstrument;
  d.audio.reverb.enabled = asBool(rv.enabled, d.audio.reverb.enabled);
  d.audio.reverb.roomSize = clampNum(rv.roomSize, 0, 1, d.audio.reverb.roomSize);
  d.audio.reverb.decaySec = clampNum(rv.decaySec, 0.1, 12, d.audio.reverb.decaySec);
  d.audio.reverb.damping = clampNum(rv.damping, 0, 1, d.audio.reverb.damping);
  d.audio.reverb.preDelayMs = clampNum(rv.preDelayMs, 0, 200, d.audio.reverb.preDelayMs);
  d.audio.reverb.wet = clampNum(rv.wet, 0, 1, d.audio.reverb.wet);
  d.audio.stereo.enabled = asBool(st.enabled, d.audio.stereo.enabled);
  d.audio.stereo.width = clampNum(st.width, 0, 1, d.audio.stereo.width);
  d.audio.limiter.enabled = asBool(lm.enabled, d.audio.limiter.enabled);

  const lib = src.library || {};
  d.library.iconSizePx = clampNum(lib.iconSizePx, 32, 96, d.library.iconSizePx);
  d.library.showCents = asBool(lib.showCents, d.library.showCents);
  d.library.layoutVersion = isNum(lib.layoutVersion) ? lib.layoutVersion : d.library.layoutVersion;

  // Limits first, then the values — the range is what the value is clamped into,
  // so narrowing the limits pulls an out-of-range scale back in with it.
  const sc = src.scale || {};
  const sl = sc.limits || {};
  const xr = validateScaleRange(sl.xMin, sl.xMax, d.scale.limits.xMin, d.scale.limits.xMax);
  const yr = validateScaleRange(sl.yMin, sl.yMax, d.scale.limits.yMin, d.scale.limits.yMax);
  d.scale.limits = { xMin: xr.lo, xMax: xr.hi, yMin: yr.lo, yMax: yr.hi };
  // The neutral 1.0 is itself only a fallback when it fits: a range that lives
  // entirely away from 1 (say 100–200) must not snap the value back outside it.
  d.scale.x = clampNum(sc.x, xr.lo, xr.hi, clampNum(1, xr.lo, xr.hi, 1));
  d.scale.y = clampNum(sc.y, yr.lo, yr.hi, clampNum(1, yr.lo, yr.hi, 1));

  return d;
}

/**
 * Migrate a stored envelope forward to the current version. Currently a
 * passthrough (v1 is the first version); validateSettings then hardens it.
 * @param {any} stored
 * @returns {object}
 */
export function migrate(stored) {
  // Future: switch on stored.version and transform. For now just validate.
  return validateSettings(stored);
}
