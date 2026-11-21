/**
 * The amplitude boundary: exact relative gain in, playable gain out.
 *
 * A note's `amplitude` is an exact Fraction like every other variable, and it
 * is unbounded in the module. Anything that turns it into sound — the audio
 * engine's envelope peak, the MIDI export's velocity — clamps it here, once,
 * so playback and export agree on what a given amplitude means.
 *
 * Kept free of Web Audio so it also runs in Node (the MIDI export and its
 * check script import it).
 */

import { toNumber } from '../utils/fraction-num.ts';

/**
 * Largest gain the engine plays: 4 (+12 dB over the default 1).
 *
 * The per-note peak is 0.2, so a single voice at the maximum peaks at 0.8 —
 * below full scale even with the limiter switched off. It is also where the
 * MIDI export's velocity curve runs out (see src/midi/midi-export.js).
 */
export const MAX_AMPLITUDE = 4;

/**
 * Clamp an evaluated amplitude to the range that is played.
 *
 * @param {object|number|null} value exact Fraction, or null when neither the
 *   note nor the BaseNote defines an amplitude (unity gain)
 * @returns {number} gain in [0, MAX_AMPLITUDE]; 0 is silence. A negative gain
 *   has no meaning for a peak level and is treated as 0.
 */
export function amplitudeToGain(value: Parameters<typeof toNumber>[0]) {
  const a = toNumber(value, 1);
  if (Number.isNaN(a)) return 1;
  return a < 0 ? 0 : a > MAX_AMPLITUDE ? MAX_AMPLITUDE : a;
}
