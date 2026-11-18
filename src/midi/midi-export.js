/**
 * MIDI export — a module as a Standard MIDI File (type 1) that keeps its tuning.
 *
 * MIDI has 128 fixed keys; a module has exact frequencies. Each note is written
 * on its nearest 12-TET key together with a 14-bit pitch bend that carries the
 * remaining offset, and — because a pitch bend applies to a whole channel — each
 * sounding note gets a channel to itself. That per-note-channel layout is MPE
 * (MIDI Polyphonic Expression): channel 1 is the zone's master, channels 2–16
 * are its fifteen member channels.
 *
 * WHAT THE FILE CONTAINS
 *
 *   Track 0        the conductor: title, tempo (from the BaseNote), time
 *                  signature (from the BaseNote's beatsPerMeasure, when it can
 *                  be written as one).
 *   Track 1..N     one per instrument, named after it. Each is an MPE lower
 *                  zone of its own: an MPE Configuration Message on channel 1
 *                  (RPN 6 = 15 member channels), the pitch-bend range on every
 *                  member channel (RPN 0), then the notes.
 *
 *   An instrument that ever sounds more than fifteen notes at once cannot fit
 *   in one zone. The surplus goes to a further track for the same instrument
 *   ("piano (2)", ...), to be given an instrument of its own in the DAW. That
 *   is reported, never silently dropped.
 *
 * WHAT IS ROUNDED, AND HOW
 *
 *   Time     Starts and ends are converted to ticks exactly (BigInt fractions:
 *            seconds × tempo ÷ 60 × PPQ) and each is rounded to the nearest
 *            tick, ties upward. A length is the difference of the two rounded
 *            ends, so two notes that touch in the module touch in the file; a
 *            start is within half a tick of exact, a length within one tick.
 *            At the default 960 ticks per quarter note and 100 BPM a tick is
 *            0.625 ms.
 *   Tempo    MIDI stores it as whole microseconds per quarter note. Tick
 *            positions are computed from the EXACT tempo, so beats land on the
 *            DAW's grid; only the tempo event itself is rounded (66 BPM is
 *            stored as 909091 µs = 65.999993 BPM).
 *   Pitch    The bend is rounded to one of 16384 steps across ± the bend
 *            range. With the default range of 2 semitones a step is 0.0244
 *            cent, so every note is within 0.0123 cent of its exact frequency.
 *   Loudness velocity = 64 × √amplitude, rounded, kept within 1..127. That is
 *            the inverse of the DLS velocity response (gain ∝ velocity²),
 *            with amplitude 1 on MIDI's own "no velocity information" value,
 *            64; the engine's maximum amplitude, 4, lands on the top of the
 *            scale.
 *
 * Irrational (≈) values are exported by their evaluated value, like playback.
 *
 * This file is pure: module in, bytes out, no DOM and no Web Audio, so it runs
 * in Node (scripts/test-midi-export.mjs parses the result back and checks it).
 */

import Fraction from 'fraction.js';
import { toNumber } from '../utils/fraction-num.js';
import { amplitudeToGain, MAX_AMPLITUDE } from '../player/amplitude.js';

/** MPE lower zone: master on channel 1 (index 0), members on channels 2–16. */
const MASTER_CHANNEL = 0;
const MEMBER_CHANNELS = 15;

/**
 * The 'general' layout: every channel of one MIDI port except channel 10
 * (index 9), which General MIDI reserves for percussion — a note written there
 * plays as a drum in any ordinary player.
 */
const GENERAL_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/** General MIDI program (0-based) for each instrument; anything else plays as piano. */
const GM_PROGRAMS = Object.freeze({
  'piano': 0,           // Acoustic Grand Piano
  'fm-epiano': 5,       // Electric Piano 2 (the FM one)
  'vibraphone': 11,     // Vibraphone
  'organ': 19,          // Church Organ
  'harmonium': 20,      // Reed Organ
  'violin': 40,         // Violin
  'triangle-wave': 73,  // Flute
  'sine-wave': 79,      // Ocarina
  'square-wave': 80,    // Lead 1 (square)
  'sawtooth-wave': 81,  // Lead 2 (sawtooth)
});

/** Largest delta time a variable-length quantity can hold (four 7-bit groups). */
const MAX_DELTA = 0x0FFFFFFF;

export const MIDI_EXPORT_DEFAULTS = Object.freeze({
  /** Ticks per quarter note (1..32767). 960 is what most DAWs work in natively. */
  ppq: 960,
  /**
   * Pitch-bend range of the member channels, in semitones (1..96), declared in
   * the file with RPN 0. 2 is the General MIDI default and gives 0.0244-cent
   * steps. An MPE instrument left on its own default (48) must be set to match;
   * exporting with 48 instead costs resolution: 0.586-cent steps.
   */
  bendRange: 2,
  /** The velocity that amplitude 1 is written as. */
  unityVelocity: 64,
  /** Frequency of MIDI key 69, the reference of the 12-TET key grid. */
  a4: 440,
  /** Name of the conductor track (the sequence name a DAW shows). */
  title: 'RMT Compose',
  /**
   * How notes are given channels.
   * 'general'  plays in any General MIDI player: all instruments share the
   *            fifteen channels of one port (never channel 10), and every note
   *            sets its channel's program and bend before it sounds.
   * 'mpe'      one MPE lower zone per instrument track, for a DAW with one MPE
   *            instrument per track. Not for ordinary players: the tracks reuse
   *            the same channels, channel 10 included, and set no program.
   */
  layout: 'general',
});

// ---------------------------------------------------------------------------
// Exact helpers
// ---------------------------------------------------------------------------

/** Any evaluated value as a real Fraction (the evaluator hands out Fractions). */
function asFraction(value) {
  if (value instanceof Fraction) return value;
  if (value && typeof value.n === 'bigint' && typeof value.d === 'bigint') {
    const sign = value.s != null && value.s < 0n ? -1n : 1n;
    return new Fraction(sign * value.n, value.d);
  }
  const num = toNumber(value, NaN);
  return Number.isFinite(num) ? new Fraction(num) : null;
}

/** Nearest integer to an exact Fraction, ties upward; null if not a safe integer. */
function roundToInteger(frac) {
  const num = 2n * frac.s * frac.n + frac.d;
  const den = 2n * frac.d;
  let q = num / den;                               // BigInt division truncates
  if (num < 0n && q * den !== num) q -= 1n;        // ...so floor it by hand
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return (q > max || q < -max) ? null : Number(q);
}

// ---------------------------------------------------------------------------
// Plan: module -> everything the file will contain, as plain data
// ---------------------------------------------------------------------------

/**
 * Work out the file's contents without encoding them.
 *
 * @param {object} module a Module (src/module.js)
 * @param {Partial<typeof MIDI_EXPORT_DEFAULTS>} [options]
 * @returns {{ppq:number, bendRange:number, usPerQuarter:number, timeSignature:{numerator:number,denominator:number}|null,
 *   title:string, endTick:number, tracks:Array, report:object}}
 */
export function planMidi(module, options = {}) {
  const opt = { ...MIDI_EXPORT_DEFAULTS, ...options };
  const ppq = Math.round(Number(opt.ppq));
  if (!(ppq >= 1 && ppq <= 32767)) throw new RangeError(`ppq must be 1..32767 (got ${opt.ppq})`);
  const bendRange = Math.round(Number(opt.bendRange));
  if (!(bendRange >= 1 && bendRange <= 96)) throw new RangeError(`bendRange must be 1..96 semitones (got ${opt.bendRange})`);
  const unityVelocity = Number(opt.unityVelocity);
  if (!(unityVelocity >= 1 && unityVelocity <= 127)) throw new RangeError(`unityVelocity must be 1..127 (got ${opt.unityVelocity})`);
  const a4 = Number(opt.a4);
  if (!(a4 > 0 && Number.isFinite(a4))) throw new RangeError(`a4 must be a positive frequency (got ${opt.a4})`);

  const layout = String(opt.layout);
  if (layout !== 'general' && layout !== 'mpe') throw new RangeError(`layout must be 'general' or 'mpe' (got ${opt.layout})`);

  const cache = module.evaluateModule();
  const base = cache.get(0) || {};
  const warnings = [];

  // --- tempo -----------------------------------------------------------------
  let exactTempo = asFraction(base.tempo);
  if (!exactTempo || exactTempo.compare(0) <= 0) exactTempo = new Fraction(60);

  const idealUs = roundToInteger(new Fraction(60000000).div(exactTempo));
  const usPerQuarter = Math.min(0xFFFFFF, Math.max(1, idealUs == null ? 0xFFFFFF : idealUs));
  // The grid follows the exact tempo. Only a tempo MIDI cannot store at all
  // (below 3.58 BPM) moves the grid onto the nearest tempo it can.
  let gridTempo = exactTempo;
  if (usPerQuarter !== idealUs) {
    gridTempo = new Fraction(60000000, usPerQuarter);
    warnings.push(`BaseNote tempo ${exactTempo.toFraction()} BPM cannot be stored in a MIDI file; ` +
      `${toNumber(gridTempo).toPrecision(8)} BPM is used instead.`);
  }
  const ticksPerSecond = gridTempo.mul(ppq).div(60);
  const storedTempo = 60000000 / usPerQuarter;
  const tempoRelativeError = Math.abs(storedTempo - toNumber(gridTempo)) / toNumber(gridTempo);

  // --- time signature ----------------------------------------------------------
  const timeSignature = timeSignatureFor(asFraction(base.beatsPerMeasure));

  // --- notes -------------------------------------------------------------------
  const skipped = { silent: [], noPitch: [], outOfRange: [], noLength: [], beforeStart: [] };
  let silences = 0, lengthened = 0, clippedAtStart = 0, amplitudeClamped = 0, velocityFloored = 0;
  let maxStartError = 0, maxLengthError = 0, maxPitchError = 0;
  let endTick = 0;
  const byInstrument = new Map();   // instrument -> notes, in first-appearance order

  const ids = Object.keys(module.notes).map(Number).filter((id) => id !== 0).sort((a, b) => a - b);
  for (const id of ids) {
    const note = module.notes[id];
    const r = cache.get(id);
    if (!r || !r.startTime) continue;

    const start = asFraction(r.startTime);
    if (!start) continue;

    if (!r.duration) {
      // A measure bar. It makes no sound, but its measure extends the file.
      try {
        const ml = asFraction(module.findMeasureLength(note));
        const t = ml ? roundToInteger(start.add(ml).mul(ticksPerSecond)) : null;
        if (t != null && t > endTick) endTick = t;
      } catch { /* a measure that cannot be measured does not extend the file */ }
      continue;
    }
    if (!r.frequency) { silences++; continue; }      // a silence: a rest, nothing to write

    const duration = asFraction(r.duration);
    if (!duration || duration.compare(0) <= 0) { skipped.noLength.push(id); continue; }

    const exactStart = start.mul(ticksPerSecond);
    const exactEnd = start.add(duration).mul(ticksPerSecond);
    let startTick = roundToInteger(exactStart);
    let noteEndTick = roundToInteger(exactEnd);
    if (startTick == null || noteEndTick == null) { skipped.noLength.push(id); continue; }
    // Decided on the exact end, not the rounded one: a note at time zero that is
    // shorter than half a tick rounds to tick 0 too, and that one is kept.
    if (exactEnd.compare(0) <= 0) { skipped.beforeStart.push(id); continue; }
    // Like playback, a note that begins before time zero is heard from zero.
    const clipped = startTick < 0;
    if (clipped) startTick = 0;
    const tooShort = noteEndTick <= startTick;
    if (tooShort) noteEndTick = startTick + 1;

    const frequency = toNumber(r.frequency, NaN);
    if (!(frequency > 0) || !Number.isFinite(frequency)) { skipped.noPitch.push(id); continue; }

    // Nearest key, then the offset from it in cents. Keys stop at 0 and 127;
    // a note just past either end can still be reached by bending further.
    const semitones = 69 + 12 * Math.log2(frequency / a4);
    const key = Math.min(127, Math.max(0, Math.round(semitones)));
    const cents = (semitones - key) * 100;
    if (Math.abs(cents) > bendRange * 100) { skipped.outOfRange.push(id); continue; }
    const bend = Math.min(16383, Math.max(0, 8192 + Math.round((cents / (bendRange * 100)) * 8192)));
    const writtenCents = ((bend - 8192) / 8192) * bendRange * 100;

    const exactAmplitude = module.findAmplitude(note);
    const gain = amplitudeToGain(exactAmplitude);
    if (gain === 0) { skipped.silent.push(id); continue; }     // playback builds no voice either
    if (toNumber(exactAmplitude, 1) > MAX_AMPLITUDE) amplitudeClamped++;
    const rawVelocity = Math.round(unityVelocity * Math.sqrt(gain));
    if (rawVelocity < 1) velocityFloored++;
    const velocity = Math.min(127, Math.max(1, rawVelocity));

    // Counted only now that the note is certain to be written.
    if (clipped) clippedAtStart++;
    if (tooShort) lengthened++;
    if (!clipped) maxStartError = Math.max(maxStartError, Math.abs(startTick - toNumber(exactStart)));
    maxLengthError = Math.max(maxLengthError, Math.abs((noteEndTick - startTick) - toNumber(exactEnd.sub(clipped ? new Fraction(0) : exactStart))));
    maxPitchError = Math.max(maxPitchError, Math.abs(writtenCents - cents));
    if (noteEndTick > endTick) endTick = noteEndTick;

    const instrument = String(module.findInstrument(note) || 'sine-wave').toLowerCase();
    if (!byInstrument.has(instrument)) byInstrument.set(instrument, []);
    byInstrument.get(instrument).push({ id, instrument, startTick, endTick: noteEndTick, key, bend, cents, velocity, frequency, channel: -1 });
  }

  // --- channels ----------------------------------------------------------------
  // One MPE zone has fifteen member channels, so at most fifteen notes of an
  // instrument can sound at once in a track. Each note takes the member channel
  // that has been silent the longest — the rotation that leaves a release tail
  // the most time before the channel's bend is moved for the next note. When
  // every member channel is sounding, the note opens (or joins) a further track.
  const tracks = [];
  const instrumentReports = [];
  let overflowNotes = 0;
  let exported = 0;

  if (layout === 'general') {
    // One pool of fifteen channels for the whole piece, as an ordinary player
    // has: tracks do not separate channels there. A note takes a channel that
    // last played its own instrument when one is free (so a release tail is not
    // re-voiced), otherwise the one silent longest. Past fifteen notes at once
    // the surplus goes to a second port, which a single-port player cannot follow.
    const all = [...byInstrument.values()].flat().sort((a, b) => (a.startTick - b.startTick) || (a.id - b.id));
    const ports = [];
    for (const note of all) {
      note.program = GM_PROGRAMS[note.instrument] ?? 0;
      let placed = false;
      for (let p = 0; p < ports.length && !placed; p++) placed = placeInPort(ports[p], note);
      if (!placed) {
        const port = { freeAt: new Array(GENERAL_CHANNELS.length).fill(-1), last: new Array(GENERAL_CHANNELS.length).fill(null), notes: [] };
        ports.push(port);
        placeInPort(port, note);
      }
    }
    ports.forEach((port, p) => {
      if (p > 0) overflowNotes += port.notes.length;
      exported += port.notes.length;
      for (const instrument of byInstrument.keys()) {
        const own = port.notes.filter((n) => n.instrument === instrument);
        if (own.length === 0) continue;
        tracks.push({ name: p === 0 ? instrument : `${instrument} (port ${p + 1})`, instrument, zone: p + 1, layout, port: p, program: GM_PROGRAMS[instrument] ?? 0, notes: own });
      }
    });
    for (const [instrument, notes] of byInstrument) {
      instrumentReports.push({ instrument, program: GM_PROGRAMS[instrument] ?? 0, notes: notes.length, maxPolyphony: maxPolyphony(notes), tracks: tracks.filter((x) => x.instrument === instrument).length });
      if (!(instrument in GM_PROGRAMS)) warnings.push(`"${instrument}" has no General MIDI program assigned; it is written as piano (program 1).`);
    }
    if (ports.length > 1) {
      warnings.push(`Up to ${maxPolyphony(all)} notes sound at once; one MIDI port carries ${GENERAL_CHANNELS.length} with their own tuning. ` +
        `${overflowNotes} note${overflowNotes === 1 ? ' was' : 's were'} written for ${ports.length - 1} further port${ports.length === 2 ? '' : 's'} ("… (port 2)" tracks); ` +
        `a player with one port will mistune them.`);
    }
  } else for (const [instrument, notes] of byInstrument) {
    notes.sort((a, b) => (a.startTick - b.startTick) || (a.id - b.id));
    const zones = [];
    for (const note of notes) {
      let placed = false;
      for (let z = 0; z < zones.length && !placed; z++) placed = placeInZone(zones[z], note);
      if (!placed) {
        const zone = { freeAt: new Array(MEMBER_CHANNELS).fill(-1), notes: [] };
        zones.push(zone);
        placeInZone(zone, note);
      }
    }
    zones.forEach((zone, z) => {
      if (z > 0) overflowNotes += zone.notes.length;
      exported += zone.notes.length;
      tracks.push({
        name: z === 0 ? instrument : `${instrument} (${z + 1})`,
        instrument,
        zone: z + 1,
        layout,
        memberChannels: MEMBER_CHANNELS,
        notes: zone.notes,
      });
    });
    const polyphony = maxPolyphony(notes);
    instrumentReports.push({ instrument, notes: notes.length, maxPolyphony: polyphony, tracks: zones.length });
    if (zones.length > 1) {
      const surplus = zones.slice(1).reduce((sum, zone) => sum + zone.notes.length, 0);
      warnings.push(`"${instrument}" sounds up to ${polyphony} notes at once; one MPE zone holds ${MEMBER_CHANNELS}. ` +
        `${surplus} note${surplus === 1 ? ' was' : 's were'} written to ${zones.length - 1} extra track${zones.length === 2 ? '' : 's'} ` +
        `("${instrument} (2)"${zones.length > 2 ? ` … "${instrument} (${zones.length})"` : ''}) — give each its own instrument.`);
    }
  }

  // --- report --------------------------------------------------------------------
  const count = (list, what) => { if (list.length) warnings.push(`${list.length} note${list.length === 1 ? '' : 's'} not exported — ${what}: ${idList(list)}.`); };
  count(skipped.outOfRange, `pitch outside what MIDI keys 0–127 can reach with a ±${bendRange}-semitone bend`);
  count(skipped.noPitch, 'no usable frequency');
  count(skipped.noLength, 'no usable length');
  count(skipped.beforeStart, 'over before time zero');
  count(skipped.silent, 'amplitude 0 (silent in playback too)');
  if (amplitudeClamped) warnings.push(`${amplitudeClamped} note${amplitudeClamped === 1 ? ' has' : 's have'} an amplitude above ${MAX_AMPLITUDE}; like playback, the export treats it as ${MAX_AMPLITUDE} (velocity 127).`);
  if (velocityFloored) warnings.push(`${velocityFloored} note${velocityFloored === 1 ? ' is' : 's are'} too quiet for velocity 1 and ${velocityFloored === 1 ? 'was' : 'were'} written at velocity 1.`);
  if (lengthened) warnings.push(`${lengthened} note${lengthened === 1 ? ' is' : 's are'} shorter than one tick and ${lengthened === 1 ? 'was' : 'were'} given a length of one tick.`);
  if (!timeSignature) warnings.push(`beatsPerMeasure ${base.beatsPerMeasure ? asFraction(base.beatsPerMeasure).toFraction() : '(unset)'} cannot be written as a time signature; none is stored.`);

  const report = {
    ppq,
    bendRange,
    layout,
    bendStepCents: (bendRange * 100) / 8192,
    unityVelocity,
    a4,
    tempo: {
      exactBpm: exactTempo.toFraction(),
      usPerQuarter,
      storedBpm: storedTempo,
      relativeError: tempoRelativeError,
      /** How far a DAW playing the stored tempo is from the module's clock at the end, in seconds. */
      driftAtEndSeconds: tempoRelativeError * (endTick / toNumber(ticksPerSecond)),
    },
    timeSignature,
    tickSeconds: 1 / toNumber(ticksPerSecond),
    endTick,
    durationSeconds: endTick / toNumber(ticksPerSecond),
    notes: {
      exported,
      silences,
      skipped,
      skippedTotal: Object.values(skipped).reduce((sum, list) => sum + list.length, 0),
      clippedAtStart,
      lengthened,
      amplitudeClamped,
      velocityFloored,
    },
    polyphony: {
      channelsPerTrack: MEMBER_CHANNELS,
      max: instrumentReports.reduce((m, r) => Math.max(m, r.maxPolyphony), 0),
      overflowNotes,
      overflowTracks: tracks.filter((t) => t.zone > 1).length,
    },
    instruments: instrumentReports,
    tracks: tracks.map((t, i) => ({ index: i + 1, name: t.name, notes: t.notes.length })),
    accuracy: {
      maxPitchErrorCents: maxPitchError,
      maxStartErrorTicks: maxStartError,
      maxLengthErrorTicks: maxLengthError,
    },
    warnings,
  };

  return { ppq, bendRange, layout, usPerQuarter, timeSignature, title: String(opt.title || 'RMT Compose'), endTick, tracks, report };
}

/** Give `note` the member channel of `zone` that fell silent longest ago. */
function placeInZone(zone, note) {
  let best = -1;
  for (let c = 0; c < zone.freeAt.length; c++) {
    if (zone.freeAt[c] > note.startTick) continue;                 // still sounding
    if (best < 0 || zone.freeAt[c] < zone.freeAt[best]) best = c;  // ties: lowest channel
  }
  if (best < 0) return false;
  zone.freeAt[best] = note.endTick;
  note.channel = best + 1;            // member channels are MIDI channels 2–16 (indices 1–15)
  zone.notes.push(note);
  return true;
}

/**
 * Give `note` a channel of a General MIDI port. A channel is free once its
 * note has ended; on the very tick it ends only for the same instrument, whose
 * note-off and note-on share a track and so keep their order.
 */
function placeInPort(port, note) {
  let best = -1, bestSame = false;
  for (let c = 0; c < port.freeAt.length; c++) {
    const same = port.last[c] === note.instrument;
    if (port.freeAt[c] > note.startTick || (port.freeAt[c] === note.startTick && !same)) continue;
    if (best < 0 || (same && !bestSame) || (same === bestSame && port.freeAt[c] < port.freeAt[best])) { best = c; bestSame = same; }
  }
  if (best < 0) return false;
  port.freeAt[best] = note.endTick;
  port.last[best] = note.instrument;
  note.channel = GENERAL_CHANNELS[best];
  port.notes.push(note);
  return true;
}

/** Most notes sounding at one instant (a note ending on a tick frees it for one starting there). */
function maxPolyphony(notes) {
  const edges = [];
  for (const n of notes) { edges.push([n.startTick, 1]); edges.push([n.endTick, -1]); }
  edges.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  let now = 0, max = 0;
  for (const [, delta] of edges) { now += delta; if (now > max) max = now; }
  return max;
}

/**
 * beatsPerMeasure as a MIDI time signature over a quarter-note beat: 4 -> 4/4,
 * 7/2 -> 7/8. Null when it has no such form (5/3 beats, more than 255 beats).
 */
function timeSignatureFor(beats) {
  if (!beats || beats.compare(0) <= 0) return null;
  const n = beats.s * beats.n, d = beats.d;
  for (const [den, mul] of [[4, 1n], [8, 2n], [16, 4n], [32, 8n], [64, 16n]]) {
    if (mul % d === 0n) {
      const numerator = n * (mul / d);
      return numerator >= 1n && numerator <= 255n ? { numerator: Number(numerator), denominator: den } : null;
    }
  }
  return null;
}

function idList(ids) {
  const shown = ids.slice(0, 12).map((id) => `[${id}]`).join(' ');
  return ids.length > 12 ? `${shown} … (${ids.length} in all)` : shown;
}

// ---------------------------------------------------------------------------
// Encode: plan -> bytes
// ---------------------------------------------------------------------------

/**
 * Encode a plan from planMidi() as a Standard MIDI File, format 1.
 * @returns {Uint8Array}
 */
export function encodeMidi(plan) {
  const chunks = [conductorTrack(plan), ...plan.tracks.map((track) => noteTrack(track, plan))];

  const out = [];
  pushAscii(out, 'MThd');
  pushUint32(out, 6);
  pushUint16(out, 1);                    // format 1: simultaneous tracks
  pushUint16(out, chunks.length);
  pushUint16(out, plan.ppq);             // division: ticks per quarter note
  for (const chunk of chunks) {
    pushAscii(out, 'MTrk');
    pushUint32(out, chunk.length);
    for (let i = 0; i < chunk.length; i++) out.push(chunk[i]);
  }
  return Uint8Array.from(out);
}

/**
 * Module in, Standard MIDI File bytes out.
 * Use planMidi() + encodeMidi() instead when the report is wanted too.
 *
 * @param {object} module a Module (src/module.js)
 * @param {Partial<typeof MIDI_EXPORT_DEFAULTS>} [options]
 * @returns {Uint8Array}
 */
export function moduleToMidi(module, options = {}) {
  return encodeMidi(planMidi(module, options));
}

function conductorTrack(plan) {
  const events = [];
  let seq = 0;
  const at = (tick, bytes) => events.push({ tick, priority: 0, seq: seq++, bytes });

  at(0, meta(0x03, utf8(plan.title)));                                     // sequence name
  at(0, meta(0x01, utf8(plan.layout === 'mpe'
    ? `RMT Compose export: one MPE lower zone per track, member pitch-bend range +/-${plan.bendRange} semitones`
    : `RMT Compose export: one note per channel (never channel 10), pitch-bend range +/-${plan.bendRange} semitones`)));
  if (plan.timeSignature) {
    const { numerator, denominator } = plan.timeSignature;
    // nn, dd as a power of two, 24 MIDI clocks per click, 8 thirty-second notes per quarter
    at(0, meta(0x58, [numerator, Math.log2(denominator), 24, 8]));
  }
  at(0, meta(0x51, [(plan.usPerQuarter >> 16) & 0xFF, (plan.usPerQuarter >> 8) & 0xFF, plan.usPerQuarter & 0xFF]));
  return serializeTrack(events, plan.endTick);
}

function noteTrack(track, plan) {
  const events = [];
  let seq = 0;
  // Priorities order events that share a tick: setup, then note-offs (so a channel
  // reused on the very tick it fell free reads off -> bend -> on), bends, note-ons.
  const at = (tick, priority, bytes) => events.push({ tick, priority, seq: seq++, bytes });
  const cc = (channel, controller, value) => at(0, 0, [0xB0 | channel, controller, value]);

  at(0, 0, meta(0x03, utf8(track.name)));

  if (track.layout === 'general') {
    if (track.port > 0) at(0, 0, meta(0x21, [track.port]));                // MIDI port, for players that have several
    // Pitch-bend sensitivity (RPN 0) on every channel, in every track, so that
    // no track depends on another having been read first.
    for (const ch of GENERAL_CHANNELS) {
      cc(ch, 101, 0); cc(ch, 100, 0); cc(ch, 6, plan.bendRange); cc(ch, 38, 0);
      cc(ch, 101, 127); cc(ch, 100, 127);
    }
    let end = 0;
    for (const note of track.notes) {
      // Each note names its program and bend itself: channels are shared by all
      // instruments, and a player may start anywhere.
      at(note.startTick, 2, [0xC0 | note.channel, note.program]);
      at(note.startTick, 3, [0xE0 | note.channel, note.bend & 0x7F, (note.bend >> 7) & 0x7F]);
      at(note.startTick, 4, [0x90 | note.channel, note.key, note.velocity]);
      at(note.endTick, 1, [0x80 | note.channel, note.key, 64]);
      if (note.endTick > end) end = note.endTick;
    }
    return serializeTrack(events, end);
  }

  // MPE Configuration Message: RPN 6 on the master channel, value = member channels.
  cc(MASTER_CHANNEL, 101, 0); cc(MASTER_CHANNEL, 100, 6); cc(MASTER_CHANNEL, 6, track.memberChannels);
  cc(MASTER_CHANNEL, 101, 127); cc(MASTER_CHANNEL, 100, 127);              // RPN null
  // Pitch-bend sensitivity: RPN 0 = semitones (MSB) + cents (LSB). MPE applies one
  // member channel's setting to the whole zone; it is written on every member
  // channel so a plain multi-channel receiver ends up with the same range.
  for (let ch = 1; ch <= track.memberChannels; ch++) {
    cc(ch, 101, 0); cc(ch, 100, 0); cc(ch, 6, plan.bendRange); cc(ch, 38, 0);
    cc(ch, 101, 127); cc(ch, 100, 127);
  }

  let last = 0;
  for (const note of track.notes) {
    at(note.startTick, 2, [0xE0 | note.channel, note.bend & 0x7F, (note.bend >> 7) & 0x7F]);
    at(note.startTick, 3, [0x90 | note.channel, note.key, note.velocity]);
    at(note.endTick, 1, [0x80 | note.channel, note.key, 64]);
    if (note.endTick > last) last = note.endTick;
  }
  return serializeTrack(events, last);
}

/** Sort events, write delta times, append End of Track at `endTick`. */
function serializeTrack(events, endTick) {
  events.sort((a, b) => (a.tick - b.tick) || (a.priority - b.priority) || (a.seq - b.seq));
  const out = [];
  let now = 0;
  const advanceTo = (tick) => {
    let delta = tick - now;
    // A gap too long for one delta time is bridged with empty text events.
    while (delta > MAX_DELTA) { pushVarLen(out, MAX_DELTA); out.push(0xFF, 0x01, 0x00); delta -= MAX_DELTA; }
    pushVarLen(out, delta);
    now = tick;
  };
  for (const event of events) {
    advanceTo(event.tick);
    for (const byte of event.bytes) out.push(byte);
  }
  advanceTo(Math.max(endTick, now));
  out.push(0xFF, 0x2F, 0x00);
  return out;
}

function meta(type, data) {
  const out = [0xFF, type];
  pushVarLen(out, data.length);
  for (const byte of data) out.push(byte);
  return out;
}

function utf8(text) {
  return Array.from(new TextEncoder().encode(String(text)));
}

function pushVarLen(out, value) {
  const groups = [value & 0x7F];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) groups.unshift((rest & 0x7F) | 0x80);
  for (const group of groups) out.push(group);
}

function pushAscii(out, text) { for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i)); }
function pushUint16(out, v) { out.push((v >>> 8) & 0xFF, v & 0xFF); }
function pushUint32(out, v) { out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF); }
