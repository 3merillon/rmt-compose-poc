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

import { applyVoiceEnvelope, envelopeLength } from './instrument-manager.js';

export class MultisampleInstrument {
  /**
   * @param {AudioContext} audioContext
   * @param {string} name registered instrument name (e.g. 'piano')
   * @param {string} manifestUrl absolute URL to the instrument manifest
   */
  constructor(audioContext, name, manifestUrl) {
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
      const m = await res.json();
      this.displayName = m.displayName || this.name;
      this.license = m.license || null;
      if (m.gainDb != null && isFinite(m.gainDb)) this.gain = Math.pow(10, m.gainDb / 20);
      if (m.envelope) this.envelope = { ...this.envelope, ...m.envelope };
      const zones = Array.isArray(m.zones) ? m.zones : [];
      this.zones = zones
        .filter((z) => z && isFinite(z.rootHz) && z.rootHz > 0 && z.url)
        .map((z) => ({
          root: z.root || null,
          rootHz: +z.rootHz,
          // The pitch the recording actually has (rootHz corrected by its measured tuneCents)
          playedHz: +z.rootHz * Math.pow(2, (isFinite(z.tuneCents) ? +z.tuneCents : 0) / 1200),
          lowHz: isFinite(z.lowHz) ? +z.lowHz : 0,
          highHz: isFinite(z.highHz) ? +z.highHz : Infinity,
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
  _zoneFor(freq) {
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

  async _decodeZone(zone) {
    if (zone.buffer) return zone.buffer;
    if (zone.decoding) return zone.decoding;
    zone.decoding = (async () => {
      try {
        const res = await fetch(zone.url);
        if (!res.ok) throw new Error(`zone ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await this.audioContext.decodeAudioData(arr);
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
  async prepare(frequencies) {
    await this.waitForLoad();
    if (!this.zones.length) return; // fallback mode
    const needed = new Set();
    for (const f of frequencies || []) {
      const z = this._zoneFor(f);
      if (z && !z.buffer) needed.add(z);
    }
    await Promise.all(Array.from(needed).map((z) => this._decodeZone(z)));
  }

  _fallbackOscillator(frequency) {
    const osc = this.audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    return osc;
  }

  createOscillator(frequency) {
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

    return {
      frequency: { value: frequency },
      // `offset` (seconds into the recording) lets a slurred note enter past its onset
      start: (when, offset = 0) => { try { source.start(when, Math.max(0, Math.min(offset, zone.buffer.duration * 0.5))); } catch {} },
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
  getEnvelopeSettings(duration, frequency) {
    const e = this.envelope || {};
    const sec = (v, d) => (v != null && isFinite(v) && v >= 0 ? +v : d);
    return { attack: sec(e.attack, 0.005), release: sec(e.release, 0.12) };
  }

  applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0, shape = null, frequency = null) {
    applyVoiceEnvelope(gainNode, startTime, duration, initialVolume * this.gain, this.getEnvelopeSettings(duration, frequency), shape);
  }

  /** Seconds from the note's start until the voice can be stopped. */
  voiceLength(duration, shape = null, frequency = null) {
    return envelopeLength(this.getEnvelopeSettings(duration, frequency), duration, shape);
  }
}
