#!/usr/bin/env node
/**
 * Envelopes — the note's end is a note-off (Phase I, npm test).
 *
 * Every registered instrument schedules its envelope on a recording AudioParam
 * (no browser: the automation is replayed here with Web Audio's own rules for
 * setValueAtTime, linear and exponential ramps), at many durations, pitches,
 * amplitudes and per-note shapes. For each:
 *
 *   A. no NaN, no negative value, every event time finite;
 *   B. it starts at silence (EPS at the note's start, after a gain resting at 0)
 *      and ends at silence (0 once the release and its step to zero are done);
 *   C. its peak is the amplitude-scaled level (the per-note peak times the
 *      instrument's own level or sample gain);
 *   D. the release begins at the note's end: the level there is the one
 *      envelopeTimes reports, nothing falls before it except a decay, and the
 *      curve never rises after it;
 *   E. the voice is stopped after its tail and not before (voiceLength);
 *   F. the drawn shares (envelopeShares) are the scheduled ramps: attack end,
 *      decay end and level, release length after the end;
 *   G. a short note keeps its instrument's attack and release in seconds (a
 *      0.1 s piano note is a 2 ms strike and a damper after its end, not one ramp);
 *   H. a note's own release share is counted after its end, up to MAX_RELEASE_SHARE.
 *
 * Run via `node scripts/test-envelopes.mjs`.
 */
import { MultisampleInstrument } from '../src/instruments/multisample-instrument.ts';
import { required } from './fixtures/required.ts';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

// Sample manifests are fetched by the multisampled instruments' constructors: answer from public/.
globalThis.fetch = async (url) => {
  const file = join(publicDir, String(url).replace(/^\/+/, ''));
  if (!existsSync(file)) return new Response(null, { status: 404 });
  const body = readFileSync(file);
  return new Response(body);
};

const IM = await import('../src/instruments/instrument-manager.ts');
const { SynthInstruments } = await import('../src/instruments/synth-instruments.ts');
const { SampleInstruments } = await import('../src/instruments/sample-instruments.ts');

let failures = 0, checks = 0;
const fail = (msg: string) => { failures++; if (failures <= 40) console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const check = (cond: unknown, msg: string) => { checks++; if (!cond) fail(msg); return cond; };

// ── a recording AudioParam and Web Audio's automation rules ──
class Param {
  value = 0;
  events: { type: 'lin' | 'exp' | 'set'; value: number; time: number }[] = [];
  _add(type: 'lin' | 'exp' | 'set', value: number, time: number) { this.events.push({ type, value, time }); this.events.sort((a, b) => a.time - b.time); return this; }
  cancelScheduledValues(t: number) { this.events = this.events.filter((e) => e.time < t); return this; }
  setValueAtTime(v: number, t: number) { return this._add('set', v, t); }
  linearRampToValueAtTime(v: number, t: number) { return this._add('lin', v, t); }
  exponentialRampToValueAtTime(v: number, t: number) { return this._add('exp', v, t); }
  at(x: number) {
    let pt = -Infinity, pv = this.value;
    for (const e of this.events) {
      if (e.time <= x) { pt = e.time; pv = e.value; continue; }
      if (e.type === 'set') return pv;
      const k = pt === -Infinity ? 1 : (x - pt) / (e.time - pt);
      if (e.type === 'lin') return pv + (e.value - pv) * k;
      return pv * Math.pow(e.value / pv, k);
    }
    return pv;
  }
}
const gainNode = () => ({ gain: new Param() });
const testSource = () => ({ playbackRate: {value: 1}, connect() {}, start() {}, stop() {}, buffer: null });
const ctx = {
  createBufferSource: testSource,
  sampleRate: 48000,
  createPeriodicWave: () => ({}),
  createOscillator: () => ({ frequency: {}, detune: {}, connect() {}, start() {}, stop() {} }),
  createGain: () => ({ gain: new Param(), connect() {} }),
  createBiquadFilter: () => ({ frequency: {}, Q: {}, connect() {} }),
};

const manager = new IM.InstrumentManager(ctx as unknown as BaseAudioContext) // This fixture implements only the nodes instrument registration uses.
;
manager.registerBuiltInInstruments(SynthInstruments, SampleInstruments);
for (const name of manager.getAvailableInstruments()) { const i = manager.getInstrument(name); if (required(i).waitForLoad) await required(i).waitForLoad?.(); }
const names = manager.getAvailableInstruments();

const EPS = 0.0001, ZERO_RAMP = 0.004;
const DURS = [0.001, 0.002, 0.005, 0.02, 0.1, 0.6, 4, 20];
const FREQS = [30, 263, 1500, 5000];
const PEAKS = [0.0002, 0.2, 0.8];   // INITIAL_VOLUME 0.2 times amplitudes 0.001, 1 and 4
const SHAPES = [null, { attack: 0.5 }, { release: 2 }, { attack: 1, release: 0 }, { attack: 0, release: 4 }, { release: 9 }];
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-12);

console.log(`Envelopes: ${names.length} instruments × ${DURS.length} durations × ${FREQS.length} pitches × ${PEAKS.length} peaks × ${SHAPES.length} shapes`);
for (const name of names) {
  const inst = required(manager.getInstrument(name));
  const scale = ('level' in inst && typeof inst.level === 'number' ? inst.level : 1)
    * ('gain' in inst && typeof inst.gain === 'number' ? inst.gain : 1);
  let before = failures;
  for (const dur of DURS) for (const f of FREQS) for (const peak of PEAKS) for (const shape of SHAPES) {
    const tag = `${name} d=${dur} f=${f} peak=${peak} shape=${JSON.stringify(shape)}`;
    const g = gainNode();
    const t0 = 1;
    // The envelope only touches gain automation on this recording node.
    manager.applyEnvelope(name, g as unknown as GainNode, t0, dur, peak, shape, f);
    const env = inst.getEnvelopeSettings(dur, f);
    const T = IM.envelopeTimes(env, dur, shape);
    const P = g.gain;
    const p = Math.max(EPS, peak * scale);
    // A
    check(P.events.every((e) => Number.isFinite(e.value) && e.value >= 0 && Number.isFinite(e.time)), `${tag}: NaN or negative event`);
    // B
    check(P.at(t0 - 0.01) === 0, `${tag}: not silent before its start`);
    check(near(P.at(t0), EPS), `${tag}: does not start at EPS (${P.at(t0)})`);
    check(P.at(t0 + T.end + ZERO_RAMP) === 0 && P.at(t0 + T.end + 1) === 0, `${tag}: does not end at silence`);
    // C
    let max = 0;
    const N = 400;
    for (let i = 0; i <= N; i++) { const v = P.at(t0 + (T.end * i) / N); if (v > max) max = v; }
    max = Math.max(max, P.at(t0 + T.attack));
    check(near(max, p, 1e-9), `${tag}: peak ${max} is not ${p}`);
    // D
    check(near(P.at(t0 + T.off), Math.max(EPS, p * T.levelAtEnd), 1e-6), `${tag}: level at the note-off ${P.at(t0 + T.off)} is not ${p * T.levelAtEnd}`);
    check(T.off >= dur - 1e-12 && near(T.end - T.off, T.release), `${tag}: the release does not follow the note's end`);
    let prev = Infinity, rises = false;
    for (let i = 0; i <= 200; i++) { const v = P.at(t0 + T.off + (T.release + ZERO_RAMP) * i / 200); if (v > prev * (1 + 1e-9)) rises = true; prev = v; }
    check(!rises, `${tag}: rises after the note-off`);
    if (!(T.decay > 0) && !(T.t60 > 0)) {
      check(near(P.at(t0 + T.attack + (T.off - T.attack) * 0.999), p, 1e-9), `${tag}: falls before its note-off`);
    }
    // E
    const len = manager.voiceLength(name, dur, shape, f);
    check(len >= T.end + ZERO_RAMP && len <= T.end + 0.05, `${tag}: voice length ${len} vs tail end ${T.end}`);
    // F
    const sh = IM.envelopeShares(env, dur, shape);
    check(near(sh.attack * T.dur, T.attack) && P.events.some((e) => e.type === 'lin' && near(e.time, t0 + T.attack) && near(e.value, p)), `${tag}: drawn attack is not the scheduled one`);
    check(near(sh.release * T.dur, T.release), `${tag}: drawn release ${sh.release * T.dur} is not ${T.release}`);
    const bodyEnd = t0 + T.attack + sh.decay * T.dur;
    if (env.drawT60 !== undefined && env.drawT60 > 0) {
      // A recording that decays by itself (the piano): the gain holds, and the drawing shows the recording's
      // measured decay on top of it, exactly that exponential
      const want = Math.pow(10, (-3 * (T.off - T.attack)) / env.drawT60);
      check(near(P.at(bodyEnd), p, 1e-6) && near(sh.sustain, want, 1e-9), `${tag}: drawn level ${sh.sustain} is not the recording's decay ${want}`);
    } else {
      check(near(P.at(bodyEnd), Math.max(EPS, p * sh.sustain), 1e-6), `${tag}: drawn level ${sh.sustain} is not the scheduled ${P.at(bodyEnd) / p}`);
    }
    // G2: envelopeGainAt (what a damper, a slur or a stolen voice fades from) is the scheduled gain
    let worst = 0;
    for (let i = 1; i <= 60; i++) {
      const tau = (T.end * i) / 61;
      const a = P.at(t0 + tau), b = IM.envelopeGainAt(T, p, tau);
      worst = Math.max(worst, Math.abs(a - b) / Math.max(a, b, 1e-12));
    }
    check(worst < 1e-6, `${tag}: envelopeGainAt differs from the scheduled gain by ${worst}`);
  }
  if (failures === before) ok(`${name}: starts and ends at silence, peaks at its level, releases after the end, stops after its tail, drawn = scheduled`);
}

// G: short notes keep their shape in seconds.
{
  const piano = manager.getInstrument('piano');
  const T = IM.envelopeTimes(required(piano).getEnvelopeSettings(0.1, 263), 0.1, null);
  check(near(T.attack, 0.003) && T.off === 0.1 && T.release > 0.1 && T.release < 0.3,
    `a 0.1 s piano note: attack ${T.attack}, note-off ${T.off}, damper ${T.release}`);
  const hi = IM.envelopeTimes(required(piano).getEnvelopeSettings(0.1, 2000), 0.1, null);
  check(hi.release === 1.5, `above F#6 the piano rings on (${hi.release} s)`);
  const sine = manager.getInstrument('sine-wave');
  const a = IM.envelopeTimes(required(sine).getEnvelopeSettings(4, 263), 4, null), b = IM.envelopeTimes(required(sine).getEnvelopeSettings(0.1, 263), 0.1, null);
  check(a.attack === b.attack && a.release === b.release, 'a sine attacks and releases in the same seconds at 4 s and at 0.1 s');
  const vib = manager.getInstrument('vibraphone');
  const lo = required(vib).getEnvelopeSettings(1, 65).t60, top = required(vib).getEnvelopeSettings(1, 2000).t60;
  check(required(lo) > required(top) && near(required(lo), 6) && near(required(top), 2), `the vibraphone's low bars ring longer (t60 ${lo} s against ${top} s)`);
  if (failures === 0) ok('short notes keep their instrument\'s seconds; the piano\'s damper and the vibraphone\'s ring follow pitch');
}
// H: a note's own release, after its end.
{
  const env = required(manager.getInstrument('sine-wave')).getEnvelopeSettings(2, 263);
  const T = IM.envelopeTimes(env, 2, { release: 0.5 });
  check(T.off === 2 && T.release === 1 && T.end === 3, `release 1/2 of a 2 s note rings 1 s after it (${T.release}, end ${T.end})`);
  const big = IM.envelopeTimes(env, 2, { release: 9 });
  check(big.release === 2 * IM.MAX_RELEASE_SHARE, `a release share above ${IM.MAX_RELEASE_SHARE} is clamped (${big.release})`);
  const a1 = IM.envelopeTimes(env, 2, { attack: 1 });
  check(a1.attack === 2 && a1.off === 2, 'attack 1 is a swell to the note\'s end');
  if (failures === 0) ok('a note\'s own release share is counted after its end, clamped to [0, 4]');
}

// I: the sampled instruments play against each recording's measured pitch (tuneCents)
{
  let before = failures;
  for (const name of ['piano', 'violin']) {
    const inst = required(manager.getInstrument(name));
    if (!(inst instanceof MultisampleInstrument)) throw new Error('Expected a sampled instrument');
    const zones = inst.zones;
    check(zones.length > 0 && zones.every((z) => Number.isFinite(z.playedHz) && Math.abs(1200 * Math.log2(z.playedHz / z.rootHz)) < 50),
      `${name}: every zone has a measured pitch within 50 cents of its root`);
    // Play the root of each zone: the rate must put the recording's own pitch on the written frequency.
    for (const z of zones) {
      // This path reads only the duration of the substituted decoded sample.
      z.buffer ??= { duration: 3 } as AudioBuffer;
      const saved = ctx.createBufferSource;
      const created: ReturnType<typeof testSource>[] = [];
      ctx.createBufferSource = () => { const source = testSource(); created.push(source); return source; };
      inst.createOscillator(z.rootHz);
      ctx.createBufferSource = saved;
      const src = created[0];
      check(src && near(src.playbackRate.value * z.playedHz, z.rootHz, 1e-12), `${name} ${z.root}: plays ${z.rootHz} Hz at rate ${src && src.playbackRate.value}`);
    }
  }
  if (failures === before) ok('piano and violin play each zone against its measured pitch (tuneCents), so the written frequency sounds');
}

console.log(failures ? `\n${failures} of ${checks} envelope checks FAILED` : `\nAll envelope checks passed (${checks}).`);
process.exit(failures ? 1 : 0);
