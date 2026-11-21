/**
 * Multisample instrument (ROADMAP.md Phase 5a).
 *
 * Replaces the single-buffer SampleInstrument (which pitch-shifted the whole
 * keyboard from one recording). A manifest describes several *zones*, each a
 * short mono sample with a root pitch and a frequency span; a played note picks
 * the nearest zone and pitch-shifts by at most a few semitones, so artifacts
 * stay small.
 *
 * Loading strategy:
 *   - Only the small `manifest.json` is fetched at registration (the old code
 *     eagerly fetched a whole WAV up front).
 *   - Zone audio is decoded lazily; `prepare(freqs)` (called from
 *     AudioEngine.preparePlayback) decodes exactly the zones the upcoming notes
 *     need, before playback starts.
 *   - If a zone isn't decoded yet when a voice is created (or the network
 *     failed), a sine oscillator is used as a graceful fallback.
 *
 * Voice contract matches the rest of the instruments: createOscillator()
 * returns { frequency, start, stop, connect, disconnect, onended }.
 *
 * Manifest schema (velocity-ready — `velLayers` is reserved and ignored today,
 * so a future note-dynamics feature can add layers without a migration):
 *   { schema, name, displayName, license:{id,source,author,url}, gainDb,
 *     envelope:{attack,release}, zones:[{root, rootHz, lowHz, highHz, url,
 *     tuneCents?, loop?, velLayers?}] }
 * `tuneCents` is the recording's own pitch against rootHz, measured by
 * scripts/tune-samples.mjs (Phase I): the zone is played against that pitch, so a
 * note sounds exactly the frequency written and every ratio between two zones is
 * exact. (Without it the stretch tuning of the piano recordings and the offsets of
 * the violin's, up to ±25 cents, were carried into every interval across zones.)
 * `envelope` is in seconds: the attack from the note's start, the release after
 * its end (the note's end is a note-off; see instrument-manager.js).
 */

import { applyVoiceEnvelope, envelopeLength } from './instrument-manager.ts';
import type { Envelope, Instrument, NoteShape, Voice } from './instrument-manager.ts';

type Loop = { start: number; end: number };

export interface SampleZone {
  root: string | null;
  rootHz: number;
  playedHz: number;
  lowHz: number;
  highHz: number;
  loop: Loop | null;
  decayT60: number | null;
  bowOffset?: number;
  url: string;
  buffer: AudioBuffer | null;
  decoding: Promise<AudioBuffer | null> | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


/** The crossfade length baked before a loop's end (seconds). */
export const LOOP_XFADE = 0.12;

/**
 * Make a recording's loop seamless: the LOOP_XFADE seconds before its end are
 * blended into the same length before its start, so when playback jumps from the
 * end back to the start the sound continues from where it would have been. The
 * blend keeps the level: its gains a, b satisfy a² + b² + 2abc = 1, where c is the
 * correlation of the two stretches (equal power when they are unrelated, equal gain
 * when they are alike, as loop points chosen for a match tend to be). Done once,
 * on the decoded buffer: nothing is re-encoded, and a decoder that shifts the
 * samples slightly only moves the seam, never opens it.
 * @param {AudioBuffer} buf
 * @param {{start:number, end:number}} loop seconds
 */
export function bakeLoopCrossfade(buf: Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels'> & { getChannelData(channel: number): Float32Array }, loop: Loop) {
  const sr = buf.sampleRate, L = Math.round(LOOP_XFADE * sr);
  const s = Math.round(loop.start * sr), e = Math.round(loop.end * sr);
  if (!(s - L >= 0 && e <= buf.length && e - L > s)) return false;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < L; i++) { const p = x[e - L + i], q = x[s - L + i]; xy += p * q; xx += p * p; yy += q * q; }
    const corr = Math.max(0, xy / Math.sqrt(xx * yy + 1e-30));
    for (let i = 0; i < L; i++) {
      const w = (i + 1) / L, a0 = Math.cos((Math.PI / 2) * w), b0 = Math.sin((Math.PI / 2) * w);
      const k = 1 / Math.sqrt(1 + 2 * a0 * b0 * corr);
      x[e - L + i] = (x[e - L + i] * a0 + x[s - L + i] * b0) * k;
    }
  }
  return true;
}

export class MultisampleInstrument implements Instrument {
  declare audioContext: BaseAudioContext;
  declare name: string;
  declare type: string;
  declare manifestUrl: string;
  declare baseDir: string;
  declare zones: SampleZone[];
  declare gain: number;
  declare envelope: Envelope;
  declare manifestLoaded: boolean;
  declare articulation: string;
  declare manifestPromise: Promise<void>;
  declare displayName?: string;
  declare license?: unknown;
  /**
   * @param {AudioContext} audioContext
   * @param {string} name registered instrument name (e.g. 'piano')
   * @param {string} manifestUrl absolute URL to the instrument manifest
   */
  constructor(audioContext: BaseAudioContext, name: string, manifestUrl: string) {
    this.audioContext = audioContext;
    this.name = name;
    this.type = 'sample';
    this.manifestUrl = manifestUrl;
    this.baseDir = manifestUrl.replace(/[^/]*$/, ''); // dir for relative zone urls

    /** @type {Array<{rootHz:number, lowHz:number, highHz:number, url:string, buffer:AudioBuffer|null, decoding:Promise|null}>} */
    this.zones = [];
    this.gain = 1;
    this.envelope = { attack: 0.005, release: 0.12 };
    this.manifestLoaded = false;
    this.articulation = 'sustained';   // subclasses: 'struck' (piano), 'bowed' (violin)
    this.manifestPromise = this._loadManifest();
  }

  async _loadManifest() {
    try {
      const res = await fetch(this.manifestUrl);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const m: unknown = await res.json();
      if (!record(m)) throw new Error('Invalid sample manifest');
      this.displayName = typeof m.displayName === 'string' && m.displayName || this.name;
      this.license = m.license || null;
      if (m.gainDb != null && Number.isFinite(Number(m.gainDb))) this.gain = Math.pow(10, Number(m.gainDb) / 20);
      if (record(m.envelope)) {
        for (const key of ['attack', 'release'] as const) {
          if (key in m.envelope) this.envelope[key] = m.envelope[key] == null ? undefined : Number(m.envelope[key]);
        }
      }
      const zones: unknown[] = Array.isArray(m.zones) ? m.zones : [];
      this.zones = zones
        .filter((z): z is Record<string, unknown> & { url: string } => record(z) && Number.isFinite(Number(z.rootHz)) && Number(z.rootHz) > 0 && typeof z.url === 'string' && !!z.url)
        .map((z): SampleZone => ({
          root: typeof z.root === 'string' && z.root || null,
          rootHz: Number(z.rootHz),
          // A loop (seconds into the recording) repeated while a note is held: the violin's
          loop: record(z.loop) && Number.isFinite(Number(z.loop.start)) && Number.isFinite(Number(z.loop.end)) && Number(z.loop.end) > Number(z.loop.start) + 0.2 ? { start: Number(z.loop.start), end: Number(z.loop.end) } : null,
          // How fast the recording dies away (s to fall 60 dB; measured, for the drawing)
          decayT60: Number.isFinite(Number(z.decayT60)) && Number(z.decayT60) > 0 ? Number(z.decayT60) : null,
          // The pitch the recording actually has (rootHz corrected by its measured tuneCents)
          playedHz: Number(z.rootHz) * Math.pow(2, (Number.isFinite(Number(z.tuneCents)) ? Number(z.tuneCents) : 0) / 1200),
          lowHz: Number.isFinite(Number(z.lowHz)) ? Number(z.lowHz) : 0,
          highHz: Number.isFinite(Number(z.highHz)) ? Number(z.highHz) : Infinity,
          url: /^https?:|^\//.test(z.url) ? z.url : this.baseDir + z.url,
          buffer: null,
          decoding: null,
        }))
        .sort((a, b) => a.rootHz - b.rootHz);
      this.manifestLoaded = true;
    } catch (e) {
      console.warn(`[multisample] ${this.name}: manifest load failed (${this.manifestUrl}) — oscillator fallback`, e);
      this.zones = [];
      this.manifestLoaded = true; // resolve so playback proceeds with fallback
    }
  }

  /** Resolves once the manifest is parsed (not the zone audio). */
  waitForLoad() {
    return this.manifestPromise || Promise.resolve();
  }

  // Pick the zone whose [lowHz, highHz] contains freq; else the nearest root.
  _zoneFor(freq: number) {
    if (!this.zones.length) return null;
    for (const z of this.zones) {
      if (freq >= z.lowHz && freq <= z.highHz) return z;
    }
    let best = this.zones[0];
    let bestDist = Math.abs(Math.log2(freq / best.rootHz));
    for (const z of this.zones) {
      const d = Math.abs(Math.log2(freq / z.rootHz));
      if (d < bestDist) { best = z; bestDist = d; }
    }
    return best;
  }

  async _decodeZone(zone: SampleZone) {
    if (zone.buffer) return zone.buffer;
    if (zone.decoding) return zone.decoding;
    zone.decoding = (async () => {
      try {
        const res = await fetch(zone.url);
        if (!res.ok) throw new Error(`zone ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await this.audioContext.decodeAudioData(arr);
        if (zone.loop) bakeLoopCrossfade(buf, zone.loop);
        zone.buffer = buf;
        return buf;
      } catch (e) {
        console.warn(`[multisample] ${this.name}: zone decode failed (${zone.url})`, e);
        zone.decoding = null; // allow retry
        return null;
      }
    })();
    return zone.decoding;
  }

  /**
   * Decode exactly the zones needed for the given frequencies (called before
   * playback). Ensures createOscillator() finds decoded buffers.
   * @param {number[]} frequencies
   */
  async prepare(frequencies: number[]) {
    await this.waitForLoad();
    if (!this.zones.length) return; // fallback mode
    const needed = new Set<SampleZone>();
    for (const f of frequencies || []) {
      const z = this._zoneFor(f);
      if (z && !z.buffer) needed.add(z);
    }
    await Promise.all(Array.from(needed).map((z) => this._decodeZone(z)));
  }

  _fallbackOscillator(frequency: number) {
    const osc = this.audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    return osc;
  }

  createOscillator(frequency: number): Voice {
    const zone = this._zoneFor(frequency);
    if (!zone || !zone.buffer) {
      // Not decoded yet / no zones — kick off a decode for next time, use a
      // sine oscillator now so the note still sounds (network-fail safe).
      if (zone && !zone.decoding) this._decodeZone(zone);
      return this._fallbackOscillator(frequency);
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = zone.buffer;
    // Against the recording's measured pitch, so the written frequency is what sounds
    source.playbackRate.value = frequency / (zone.playedHz || zone.rootHz);

    // Gentle anti-alias / anti-boom filter based on shift direction.
    const filter = this.audioContext.createBiquadFilter();
    const ratio = source.playbackRate.value;
    if (ratio > 1.0) {
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(this.audioContext.sampleRate * 0.48, 16000 / Math.sqrt(ratio));
      filter.Q.value = 0.5;
    } else {
      filter.type = 'highpass';
      filter.frequency.value = Math.max(20, 60 * Math.sqrt(ratio));
      filter.Q.value = 0.5;
    }
    source.connect(filter);
    // A held note repeats the recording's loop (scripts/tune-samples.mjs found it, and
    // _decodeZone blended its end into its start), so it lasts as long as written
    if (zone.loop) {
      source.loop = true;
      source.loopStart = zone.loop.start;
      source.loopEnd = zone.loop.end;
    }

    const buffer = zone.buffer;
    return {
      frequency: { value: frequency },
      // `offset` (seconds into the recording) lets a slurred note enter past its onset
      start: (when, offset = 0) => { try { source.start(when, Math.max(0, Math.min(offset, buffer.duration * 0.5))); } catch {} },
      // Where a slur enters this recording: past the bow's onset (its own peak, at most 0.25 s)
      bowOffset: zone.bowOffset != null ? zone.bowOffset : 0.15,
      stop: (when) => { try { source.stop(when); } catch {} },
      connect: (dest) => { try { filter.connect(dest); } catch {} return dest; },
      disconnect: () => { try { filter.disconnect(); } catch {} try { source.disconnect(); } catch {} },
      get onended() { return source.onended; },
      set onended(fn) { try { source.onended = fn; } catch {} },
    };
  }

  /**
   * The envelope, in seconds, from the manifest's `envelope` block: a short
   * attack (the recording carries its own onset), full gain until the note-off
   * (the recording carries its own decay), then the release.
   * @param {number} [duration] note length in seconds
   * @param {number} [frequency] the pitch that sounds
   */
  getEnvelopeSettings(duration: number, frequency?: number | null): Envelope {
    const e = this.envelope || {};
    const sec = (v: number | undefined, d: number) => (v != null && isFinite(v) && v >= 0 ? +v : d);
    // drawT60: the recording's own decay, which the workspace draws; the audio does
    // not apply it (the recording already decays).
    const z = frequency != null && isFinite(frequency) && frequency > 0 ? this._zoneFor(frequency) : null;
    const env: Envelope = { attack: sec(e.attack, 0.005), release: sec(e.release, 0.12) };
    if (z && z.decayT60 && frequency != null) env.drawT60 = z.decayT60 * (z.playedHz ? z.playedHz / frequency : 1);
    return env;
  }

  applyEnvelope(gainNode: GainNode, startTime: number, duration: number, initialVolume = 1.0, shape: NoteShape | null = null, frequency: number | null = null) {
    applyVoiceEnvelope(gainNode, startTime, duration, initialVolume * this.gain, this.getEnvelopeSettings(duration, frequency), shape);
  }

  /** Seconds from the note's start until the voice can be stopped. */
  voiceLength(duration: number, shape: NoteShape | null = null, frequency: number | null = null) {
    return envelopeLength(this.getEnvelopeSettings(duration, frequency), duration, shape);
  }
}
