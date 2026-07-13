/**
 * Algorithmic impulse-response reverb (ROADMAP.md Phase 5b).
 *
 * Renders a stereo IR entirely offline (no external assets, keeps the MIT
 * relicense clean) and hands the resulting AudioBuffer to a ConvolverNode.
 * The IR is:
 *   - per-channel *decorrelated* white noise (independent L/R → wide stereo),
 *   - shaped by an exponential decay envelope e^(−t · ln(1000) / decaySec)
 *     (≈ −60 dB at `decaySec`), whose density *ramps in* over the early-
 *     reflection window rather than starting at full scale,
 *   - seeded with a handful of discrete *early reflections* inside the first
 *     `roomSize · 80 ms` (the "size" cue), on irregular per-channel offsets with
 *     randomized signs,
 *   - filtered by a `damping` lowpass whose cutoff *sweeps down over the tail*
 *     so highs die faster than lows (air/surface absorption), plus a gentle
 *     highpass so the tail doesn't muddy the low end.
 *
 * What this does NOT fix, and cannot: a sustained tone's reverb tail warbles
 * (measured ≈5.5 dB std around the smooth decay, ~3.4 Hz). That is Rayleigh
 * statistics — the tail of a narrowband input is the IR's spectrum sampled over
 * a narrow band, and *every* IR with a random spectrum does this, recorded ones
 * included. Allpass "diffusion" cannot help: an allpass leaves |H(f)| unchanged
 * by construction. The levers on how present the tail is in a musical rest are
 * `decaySec` and `wet`, not the IR's internal structure.
 *
 * Pure-runtime code: `Math.random` for the noise is fine here (this never runs
 * inside a workflow script). Regeneration is debounced by the caller
 * (audio-graph.js); only room/decay/damping changes need a new IR — pre-delay
 * and wet level are live node params.
 */

const LN1000 = 6.907755278982137; // ln(1000) → ~−60 dB reference

// Early-reflection tap positions, as fractions of the ER window; irregular, and
// different per channel. The previous version placed 7 taps at (e + k) / 7 — a
// *uniform* grid, i.e. a comb filter. At the default room size they landed 274.3
// samples (5.715 ms) apart, putting comb teeth every 175.0 Hz across the wet
// path (autocorrelation of the tap spectrum at 175 Hz: 0.977). These offsets
// bring that to −0.05, i.e. no periodicity.
//
// This is hygiene, not a fix for anything anyone could hear: in the rendered IR
// the taps sit ~29 dB below the noise bed, so the comb was undetectable in the
// output either way. Signs are randomized per tap for the same reason — tidier,
// not audibly different (the old whole-channel negation did NOT cancel in mono,
// since the L and R taps fall on disjoint sample indices and never coincide;
// mono-sum ER energy measures +2.97 dB old vs +3.04 dB new, both just a
// decorrelated sum).
const ER_TAPS_L = [0.043, 0.137, 0.271, 0.409, 0.577, 0.719, 0.907];
const ER_TAPS_R = [0.079, 0.191, 0.323, 0.463, 0.617, 0.787, 0.953];

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
  // A room's diffuse field *builds up* over roughly the early-reflection window;
  // it does not exist at full strength at t=0, as the old IR did (exp(0) = 1 at
  // sample 0). Ramp the density in.
  //
  // Be clear about what this buys, because it is less than it looks: it takes
  // ~2.5 dB off the first 50 ms of the response to an impulse, and *nothing* off
  // the peak. `convolver.normalize = true` (audio-graph.js) rescales by total IR
  // energy, so most of the energy this removes is handed straight back as
  // normalization gain — net, the late tail you hear in a musical rest comes out
  // ~1 dB HOTTER, not quieter. Kept because a build-up is the physically right
  // shape, not because it quiets anything. The lever on rest-tail level is
  // decaySec/wet (1.0 / 0.12 measures −19 dB vs the shipped 1.8 / 0.25).
  const buildN = Math.max(1, Math.floor(erWindowSec * sr));

  for (let ch = 0; ch < 2; ch++) {
    const data = noiseBuf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const build = i < buildN ? i / buildN : 1;
      data[i] = (Math.random() * 2 - 1) * build * Math.exp(-t * decayK);
    }
    // Discrete early reflections, on irregular offsets that differ per channel.
    const taps = ch ? ER_TAPS_R : ER_TAPS_L;
    for (let e = 0; e < taps.length; e++) {
      const frac = taps[e];
      const tap = Math.floor(frac * erWindowSec * sr);
      if (tap > 0 && tap < length) {
        const sign = Math.random() < 0.5 ? -1 : 1;
        data[tap] += (1 - frac) * 0.5 * sign;
      }
    }
  }

  const src = offline.createBufferSource();
  src.buffer = noiseBuf;

  // --- damping: tail lowpass sweep (bright → dark over the decay) ----------
  const lp = offline.createBiquadFilter();
  lp.type = 'lowpass';
  // Air and surfaces eat the highs, so the tail has to get markedly darker as it
  // decays. The old law swept only 12 kHz → ~7.2 kHz at the default damping of
  // 0.5, leaving 64% of the IR's energy above 5 kHz. This one (11 kHz → ~3.1 kHz)
  // brings that to 52%. Note it darkens the TOP: the 1–5 kHz *share* rises
  // (29% → 39%) because the band above it shrank.
  const hiCut = 16000 - damping * 10000;                        // 16 kHz .. 6 kHz
  const loCut = Math.max(250, hiCut * Math.pow(0.08, damping)); // 0.5 → ~28% of hiCut
  lp.frequency.setValueAtTime(hiCut, 0);
  lp.frequency.exponentialRampToValueAtTime(loCut, durationSec);
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
