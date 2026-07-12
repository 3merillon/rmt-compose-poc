/**
 * Algorithmic impulse-response reverb (ROADMAP.md Phase 5b).
 *
 * Renders a stereo IR entirely offline (no external assets, keeps the MIT
 * relicense clean) and hands the resulting AudioBuffer to a ConvolverNode.
 * The IR is:
 *   - per-channel *decorrelated* white noise (independent L/R → wide stereo),
 *   - shaped by an exponential decay envelope e^(−t · ln(1000) / decaySec)
 *     (≈ −60 dB at `decaySec`),
 *   - seeded with a handful of discrete *early reflections* inside the first
 *     `roomSize · 80 ms` (the "size" cue),
 *   - filtered by a `damping` lowpass whose cutoff *sweeps down over the tail*
 *     so highs die faster than lows (air/surface absorption), plus a gentle
 *     highpass so the tail doesn't muddy the low end.
 *
 * Pure-runtime code: `Math.random` for the noise is fine here (this never runs
 * inside a workflow script). Regeneration is debounced by the caller
 * (audio-graph.js); only room/decay/damping changes need a new IR — pre-delay
 * and wet level are live node params.
 */

const LN1000 = 6.907755278982137; // ln(1000) → ~−60 dB reference

/**
 * Generate a stereo reverb impulse response.
 * @param {BaseAudioContext} audioContext - used only for its sampleRate.
 * @param {{roomSize?:number, decaySec?:number, damping?:number, sampleRate?:number}} opts
 *        roomSize/damping in [0,1]; decaySec in seconds.
 * @returns {Promise<AudioBuffer>}
 */
export async function generateImpulseResponse(audioContext, opts = {}) {
  const roomSize = clamp01(opts.roomSize != null ? opts.roomSize : 0.5);
  const damping = clamp01(opts.damping != null ? opts.damping : 0.5);
  const decaySec = clampNum(opts.decaySec != null ? opts.decaySec : 1.8, 0.1, 12);
  const sr = opts.sampleRate || audioContext.sampleRate || 44100;

  // Total IR length: decay time plus a short pad so the tail isn't clipped.
  const durationSec = decaySec + 0.12;
  const length = Math.max(1, Math.floor(durationSec * sr));

  const OfflineCtx =
    (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) ||
    (typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null);
  if (!OfflineCtx) throw new Error('OfflineAudioContext unavailable');

  const offline = new OfflineCtx(2, length, sr);

  // --- source: decorrelated, exponentially-decaying stereo noise ----------
  const noiseBuf = offline.createBuffer(2, length, sr);
  const decayK = LN1000 / decaySec;
  const erWindowSec = Math.max(0.006, roomSize * 0.08); // early-reflection span
  const erCount = 7;

  for (let ch = 0; ch < 2; ch++) {
    const data = noiseBuf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * decayK);
    }
    // Overlay a few decorrelated early reflections (louder, closer taps).
    for (let e = 0; e < erCount; e++) {
      const frac = (e + (ch ? 0.5 : 0.13)) / erCount; // offset L vs R
      const tap = Math.floor(frac * erWindowSec * sr);
      if (tap > 0 && tap < length) {
        // Alternate sign per channel for width; decay with distance.
        data[tap] += (1 - frac) * 0.5 * (ch ? -1 : 1);
      }
    }
  }

  const src = offline.createBufferSource();
  src.buffer = noiseBuf;

  // --- damping: tail lowpass sweep (bright → dark over the decay) ----------
  const lp = offline.createBiquadFilter();
  lp.type = 'lowpass';
  const hiCut = 18000 - damping * 12000;              // 18 kHz .. 6 kHz
  const loCut = Math.max(400, hiCut * (1 - damping * 0.8));
  lp.frequency.setValueAtTime(hiCut, 0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, loCut), durationSec);
  lp.Q.value = 0.2;

  // Keep the very low end out of the tail so it doesn't boom.
  const hp = offline.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 120;
  hp.Q.value = 0.2;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(offline.destination);
  src.start(0);

  return offline.startRendering();
}

function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampNum(v, lo, hi) {
  v = Number(v);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}
