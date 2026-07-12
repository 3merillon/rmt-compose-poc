/**
 * Audio signal graph (ROADMAP.md Phase 5b).
 *
 * Owns every node downstream of the per-note voices and is the single runtime
 * consumer of the `audio.*` settings section. Topology:
 *
 *   voice → voiceGain(env) → [StereoPanner] → instrumentBus ─┬─ dry ───────────────┐
 *                                                            └─ reverbSend ─┐       │
 *   reverbInput → preDelay(DelayNode) → Convolver(algo IR) → reverbReturn(wet) ─────┤
 *                                                                                   ▼
 *                                          masterGain → [limiter] → destination
 *
 * The per-note part (voice → voiceGain → panner) is built by the AudioEngine's
 * `_scheduleNote`; this class exposes `getBus(name)` as the connection point and
 * `panPosition()`/stereo state for the panner.
 *
 * Settings mapping (all default so today's behavior is preserved — reverb/stereo
 * OFF, master 1.0):
 *   audio.masterVolume     → masterGain.gain (ramped)
 *   audio.limiter.enabled  → limiter in/out of the master chain (configured
 *                            −6 dB / knee 6 / ratio 12; a real peak catcher,
 *                            not the old accidental −24 dB heavy compression)
 *   audio.reverb.enabled   → send + return gains (0 when off, click-free)
 *   audio.reverb.wet       → reverbReturn.gain
 *   audio.reverb.preDelayMs→ preDelay.delayTime (live, no IR regen)
 *   audio.reverb.{roomSize,decaySec,damping} → IR regen (debounced 250 ms)
 *   audio.stereo.{enabled,width} → per-voice StereoPanner (applied at schedule)
 */

import { settingsStore } from '../settings/settings-store.js';
import { generateImpulseResponse } from './reverb.js';

const REGEN_DEBOUNCE_MS = 250;

export class AudioGraph {
  constructor(audioContext) {
    const ctx = (this.ctx = audioContext);
    const s = settingsStore.get('audio') || {};
    const rv = s.reverb || {};
    const st = s.stereo || {};

    // --- master + limiter ---------------------------------------------------
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = clamp01(s.masterVolume != null ? s.masterVolume : 1);

    this.limiter = ctx.createDynamicsCompressor();
    this._configureLimiter();
    this._limiterEnabled = !(s.limiter && s.limiter.enabled === false); // default ON
    this._connectMasterChain();

    // --- shared reverb send/return -----------------------------------------
    this.reverbInput = ctx.createGain();
    this.preDelay = ctx.createDelay(0.5);
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;
    this.reverbReturn = ctx.createGain();

    this.reverbInput.connect(this.preDelay);
    this.preDelay.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterGain);

    this._reverbEnabled = !!rv.enabled;
    this.reverbReturn.gain.value = this._reverbEnabled ? clamp01(rv.wet != null ? rv.wet : 0.25) : 0;
    this.preDelay.delayTime.value = clampNum(rv.preDelayMs != null ? rv.preDelayMs : 20, 0, 200) / 1000;

    // Remember the params that require an IR re-render.
    this._irKey = irKey(rv);
    this._irToken = 0;
    this._regenTimer = null;
    // Generate an IR up front (even if reverb is off) so the first enable is
    // instant and pop-free. Offline render works while the ctx is suspended.
    this._regenIR(rv);

    // --- stereo -------------------------------------------------------------
    this.stereoEnabled = !!st.enabled;
    this.stereoWidth = clamp01(st.width != null ? st.width : 0.6);

    // --- per-instrument buses (created lazily) -----------------------------
    /** @type {Map<string,{bus:GainNode,send:GainNode}>} */
    this._buses = new Map();

    this._unsub = settingsStore.subscribe((p) => {
      try { this._onSettings(p); } catch (e) { console.warn('[audio-graph] settings apply failed', e); }
    });
  }

  _configureLimiter() {
    const c = this.limiter;
    const t = this.ctx.currentTime;
    // Peak-catching limiter: gentle threshold, small knee, high ratio, fast.
    try { c.threshold.setValueAtTime(-6, t); } catch { c.threshold.value = -6; }
    try { c.knee.setValueAtTime(6, t); } catch { c.knee.value = 6; }
    try { c.ratio.setValueAtTime(12, t); } catch { c.ratio.value = 12; }
    try { c.attack.setValueAtTime(0.003, t); } catch { c.attack.value = 0.003; }
    try { c.release.setValueAtTime(0.25, t); } catch { c.release.value = 0.25; }
  }

  // Wire masterGain → [limiter] → destination, honoring the enable flag.
  _connectMasterChain() {
    const dest = this.ctx.destination;
    try { this.masterGain.disconnect(); } catch {}
    try { this.limiter.disconnect(); } catch {}
    if (this._limiterEnabled) {
      this.masterGain.connect(this.limiter);
      this.limiter.connect(dest);
    } else {
      this.masterGain.connect(dest);
    }
  }

  /**
   * The node a voice (or its panner) should connect into for a given
   * instrument. Lazily builds the bus + its dry/reverb-send split.
   * @param {string} name instrument name
   * @returns {GainNode}
   */
  getBus(name) {
    const key = String(name || '').toLowerCase();
    let entry = this._buses.get(key);
    if (!entry) {
      const bus = this.ctx.createGain();
      const send = this.ctx.createGain();
      bus.connect(this.masterGain);         // dry path (always unity)
      send.gain.value = this._reverbEnabled ? 1 : 0;
      bus.connect(send);
      send.connect(this.reverbInput);
      entry = { bus, send };
      this._buses.set(key, entry);
    }
    return entry.bus;
  }

  /**
   * Normalized pitch pan position in [-1, 1] before width scaling:
   * clamp(log2(f / baseF) / 3, -1, 1). Three octaves span full L↔R.
   */
  panPosition(freq, baseF) {
    if (!(freq > 0) || !(baseF > 0)) return 0;
    const p = Math.log2(freq / baseF) / 3;
    return p < -1 ? -1 : p > 1 ? 1 : p;
  }

  /** Ramp the master volume (immediate if the ctx isn't running yet). */
  setMasterVolume(value) {
    const v = clamp01(value);
    const g = this.masterGain.gain;
    if (this.ctx.state !== 'running') {
      g.value = v;
      return;
    }
    try {
      const now = this.ctx.currentTime;
      // Anchor the CURRENT value at `now` before ramping. cancelScheduledValues
      // alone does not hold the current value: a bare linearRamp would then
      // interpolate from the last *surviving* (past) event and jump on the
      // 2nd+ change. Snapshotting g.value + setValueAtTime fixes the zipper.
      const cur = g.value;
      g.cancelScheduledValues(now);
      g.setValueAtTime(cur, now);
      g.linearRampToValueAtTime(v, now + 0.05);
    } catch {
      g.value = v;
    }
  }

  // --- settings reactions ---------------------------------------------------

  _onSettings({ path, settings }) {
    // React only to audio changes (path '' is a full reset).
    if (path && path !== '' && !path.startsWith('audio')) return;
    const s = (settings && settings.audio) || settingsStore.get('audio') || {};
    const rv = s.reverb || {};
    const st = s.stereo || {};
    const now = this.ctx.currentTime;

    // Master volume.
    this.setMasterVolume(s.masterVolume != null ? s.masterVolume : 1);

    // Limiter enable (reconnect only on change to avoid needless clicks).
    const limOn = !(s.limiter && s.limiter.enabled === false);
    if (limOn !== this._limiterEnabled) {
      this._limiterEnabled = limOn;
      this._connectMasterChain();
    }

    // Stereo (applied to newly-scheduled voices).
    this.stereoEnabled = !!st.enabled;
    this.stereoWidth = clamp01(st.width != null ? st.width : 0.6);

    // Reverb enable + wet + pre-delay (all live params, no IR regen).
    this._reverbEnabled = !!rv.enabled;
    const sendTarget = this._reverbEnabled ? 1 : 0;
    for (const { send } of this._buses.values()) {
      try { send.gain.setTargetAtTime(sendTarget, now, 0.02); } catch { send.gain.value = sendTarget; }
    }
    const wet = this._reverbEnabled ? clamp01(rv.wet != null ? rv.wet : 0.25) : 0;
    try { this.reverbReturn.gain.setTargetAtTime(wet, now, 0.02); } catch { this.reverbReturn.gain.value = wet; }
    const pd = clampNum(rv.preDelayMs != null ? rv.preDelayMs : 20, 0, 200) / 1000;
    try { this.preDelay.delayTime.setTargetAtTime(pd, now, 0.02); } catch { this.preDelay.delayTime.value = pd; }

    // IR regen only if room/decay/damping changed (debounced).
    const key = irKey(rv);
    if (key !== this._irKey) {
      this._irKey = key;
      this._scheduleRegen(rv);
    }
  }

  _scheduleRegen(rv) {
    if (this._regenTimer) clearTimeout(this._regenTimer);
    this._regenTimer = setTimeout(() => {
      this._regenTimer = null;
      this._regenIR(rv);
    }, REGEN_DEBOUNCE_MS);
  }

  async _regenIR(rv) {
    const token = ++this._irToken;
    try {
      const ir = await generateImpulseResponse(this.ctx, {
        roomSize: rv.roomSize != null ? rv.roomSize : 0.5,
        decaySec: rv.decaySec != null ? rv.decaySec : 1.8,
        damping: rv.damping != null ? rv.damping : 0.5,
      });
      // Ignore stale renders (a newer change superseded this one).
      if (token === this._irToken) this.convolver.buffer = ir;
    } catch (e) {
      console.warn('[audio-graph] reverb IR generation failed', e);
    }
  }

  /** Tear down (not used by the singleton, but keeps the class self-contained). */
  dispose() {
    try { this._unsub && this._unsub(); } catch {}
    if (this._regenTimer) { clearTimeout(this._regenTimer); this._regenTimer = null; }
  }
}

// Params that require a fresh impulse response (pre-delay/wet are live).
function irKey(rv) {
  const r = rv || {};
  return `${r.roomSize != null ? r.roomSize : 0.5}|${r.decaySec != null ? r.decaySec : 1.8}|${r.damping != null ? r.damping : 0.5}`;
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
