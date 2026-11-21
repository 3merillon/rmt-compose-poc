/**
 * Settings schema — defaults + validation for the user-facing settings system
 * (ROADMAP.md Phase 2).
 *
 * Design rule (project invariant): every default here MUST reproduce exactly
 * the app's pre-settings behavior, so a fresh user or a wiped store looks and
 * behaves identically to before. Deliberate exception: reverb defaults ON
 * (user decision 2026-07-12 — see `audio.reverb` below). Stereo still defaults
 * OFF (the engine was mono), and the arrow interval defaults to the octave.
 *
 * The store persists a versioned envelope under `rmt:settings:v1`. When the
 * schema grows, bump SETTINGS_VERSION and add a migration in `migrate()`.
 */

import { DEFAULT_DETAIL_CUTOFF, MAX_MODULE_NOTES } from '../limits.js';

export const SETTINGS_VERSION = 1;

// Outer rails for the workspace scale factors AND for the user-editable limits
// themselves. The limits are what the sliders span; these are what the limits
// may span — six orders of magnitude, so a composition can be laid out at a
// density far from the default one.
export const SCALE_HARD_MIN = 0.001;
export const SCALE_HARD_MAX = 1000;

// The rails a live-tempo range may span, in whole BPM.
export const TEMPO_HARD_MIN = 1;
export const TEMPO_HARD_MAX = 1000;

/**
 * The live-tempo slider's span for a piece written at `notatedBpm`: the user's
 * range, kept within the engine's 0.1x-10x rate rails, and always reaching the
 * written tempo (so the slider can return to it). Whole BPM.
 * @returns {[number, number]}
 */
export function tempoSliderBounds(range, notatedBpm) {
  const r = range || { min: 20, max: 300 };
  const base = notatedBpm > 0 ? notatedBpm : 60;
  let lo = Math.max(Number(r.min) || 20, Math.ceil(base * 0.1));
  let hi = Math.min(Number(r.max) || 300, Math.floor(base * 10));
  lo = Math.min(lo, Math.floor(base));
  hi = Math.max(hi, Math.ceil(base));
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}

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

/** The voice limits Settings → Audio offers (audio.maxVoices). */
export const VOICE_LIMITS = [128, 256, 512, 1024, 2048, 4096];

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
      // Which notes draw the envelope they sound with inside them: 'own' the notes
      // that set an attack or a release (or inherit one from the BaseNote), 'all'
      // every sounding note, 'none' no note. 'own' is the app's behavior before the
      // setting existed. (Replaces the boolean `showEnvelopes`: true reads as 'all'.)
      envelopes: 'own',
      // Draw each note's release past its end: what rings after the note-off.
      // Display only; off by default.
      showTails: false,
      detailCutoff: DEFAULT_DETAIL_CUTOFF,
      neverReduceDetail: false,
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
      // Playback only: each frequency is moved to the nearest of twelve equal
      // steps to the octave, counted from the BaseNote — the module as a
      // keyboard tuned from that note would play it, to compare with the pure
      // intervals. The module itself is never touched. Off is the app's
      // behavior before the setting existed.
      tempered: { enabled: false },
      // At most this many voices sound at once; above it the quietest voice
      // already ringing after its note's end fades out (audio-engine.js).
      maxVoices: 256,
      // Loop playback (long-press Play): a module that transposes each repeat (its
      // BaseNote's `repeat`) is kept within one octave when `fold` is on. The
      // transposition itself is the module's, not a setting.
      loop: { fold: true },
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
      // The span of the live-tempo slider (module bar toolbar), in BPM. The slider
      // also stays within 0.1x-10x of the written tempo (the engine's rate rails)
      // and always reaches the written tempo itself.
      tempoRange: { min: 20, max: 300 },
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
 *
 * When `prev` (the last known-good tree) is given, an invalid arrow ratio
 * heals to the value the user previously had instead of the schema default —
 * so a bad edit doesn't silently replace a carefully-set interval with the
 * octave. Load/migrate paths pass no `prev` and behave as before.
 * @param {any} raw - possibly-partial, possibly-corrupt input
 * @param {object} [prev] - previous validated settings, used as ratio fallback
 * @returns {object}
 */
export function validateSettings(raw, prev) {
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
  d.appearance.envelopes = ['own', 'all', 'none'].includes(a.envelopes)
    ? a.envelopes
    : (a.showEnvelopes === true ? 'all' : d.appearance.envelopes);
  if (isPosInt(a.detailCutoff)) d.appearance.detailCutoff = Math.min(a.detailCutoff, MAX_MODULE_NOTES);
  d.appearance.neverReduceDetail = asBool(a.neverReduceDetail, false);
  d.appearance.showTails = asBool(a.showTails, d.appearance.showTails);

  const ar = src.arrows || {};
  const prevAr = (prev && prev.arrows) || {};
  d.arrows.enabled = asBool(ar.enabled, d.arrows.enabled);
  d.arrows.mode = ar.mode === 'independent' ? 'independent' : 'reciprocal';
  d.arrows.up = validateRatio(ar.up, validateRatio(prevAr.up, d.arrows.up));
  if (d.arrows.mode === 'reciprocal') {
    d.arrows.down = { n: d.arrows.up.d, d: d.arrows.up.n, label: null };
  } else {
    d.arrows.down = validateRatio(ar.down, validateRatio(prevAr.down, d.arrows.down));
  }

  const au = src.audio || {};
  const tp = au.tempered || {};
  const rv = au.reverb || {};
  const st = au.stereo || {};
  const lm = au.limiter || {};
  d.audio.masterVolume = clampNum(au.masterVolume, 0, 1, d.audio.masterVolume);
  d.audio.defaultInstrument = typeof au.defaultInstrument === 'string' ? au.defaultInstrument : d.audio.defaultInstrument;
  d.audio.tempered.enabled = asBool(tp.enabled, d.audio.tempered.enabled);
  d.audio.maxVoices = VOICE_LIMITS.includes(Number(au.maxVoices)) ? Number(au.maxVoices) : d.audio.maxVoices;
  const lp = au.loop || {};
  d.audio.loop.fold = asBool(lp.fold, d.audio.loop.fold);
  d.audio.reverb.enabled = asBool(rv.enabled, d.audio.reverb.enabled);
  d.audio.reverb.roomSize = clampNum(rv.roomSize, 0, 1, d.audio.reverb.roomSize);
  d.audio.reverb.decaySec = clampNum(rv.decaySec, 0.1, 12, d.audio.reverb.decaySec);
  d.audio.reverb.damping = clampNum(rv.damping, 0, 1, d.audio.reverb.damping);
  d.audio.reverb.preDelayMs = clampNum(rv.preDelayMs, 0, 200, d.audio.reverb.preDelayMs);
  d.audio.reverb.wet = clampNum(rv.wet, 0, 1, d.audio.reverb.wet);
  d.audio.stereo.enabled = asBool(st.enabled, d.audio.stereo.enabled);
  d.audio.stereo.width = clampNum(st.width, 0, 1, d.audio.stereo.width);
  d.audio.limiter.enabled = asBool(lm.enabled, d.audio.limiter.enabled);
  const tr = au.tempoRange || {};
  const tLo = clampNum(Math.round(tr.min), TEMPO_HARD_MIN, TEMPO_HARD_MAX, d.audio.tempoRange.min);
  const tHi = clampNum(Math.round(tr.max), TEMPO_HARD_MIN, TEMPO_HARD_MAX, d.audio.tempoRange.max);
  if (tHi > tLo) d.audio.tempoRange = { min: tLo, max: tHi };

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
