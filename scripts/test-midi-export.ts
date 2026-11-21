#!/usr/bin/env node
/**
 * MIDI export check (npm test).
 *
 * Exports modules with src/midi/midi-export.js, then reads the bytes back with
 * the independent Standard MIDI File parser below — it shares no code with the
 * exporter — and compares every note in the file against the module's evaluated
 * values:
 *
 *   pitch     key + pitch bend (using the bend range the FILE declares with
 *             RPN 0) must give the note's frequency within 0.1 cent
 *   time      start and length within one tick of the exact position
 *   loudness  velocity = 64 × √amplitude
 *   channels  no two notes sound on one channel at once, a channel's bend never
 *             moves under a sounding note. In the default layout, across the
 *             whole file: nothing on channel 10, and every note preceded by its
 *             instrument's General MIDI program. In the 'mpe' layout, every note
 *             on a member channel of a zone declared by an MPE Configuration
 *             Message
 *   coverage  every sounding note of the module is in the file, and nothing else
 *
 * Checked: the default module, every shipped library module, any module files
 * passed as arguments (and compositions/aubade/aubade.json when present), and
 * synthetic modules for the cases real ones do not reach — more simultaneous
 * notes than a zone has channels, channel rotation, the velocity curve,
 * irrational pitches, pitches outside MIDI's range, and the export options.
 *
 *   node scripts/test-midi-export.mjs [module.json ...]
 */
import { isLibraryManifest } from '../src/library/manifest.ts';
import { required } from './fixtures/required.ts';
import type { ScoreNote, ScoreFields } from '../src/model-types.ts';
import type { Module as ScoreModule } from '../src/module.ts';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fraction from 'fraction.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modulesDir = join(root, 'public', 'modules');

const { Module } = await import('../src/module.ts');
const { planMidi, encodeMidi, moduleToMidi } = await import('../src/midi/midi-export.ts');
const { toNumber } = await import('../src/utils/fraction-num.ts');

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const check = (cond: unknown, msg: string) => (cond ? ok(msg) : fail(msg));

const PITCH_TOLERANCE_CENTS = 0.1;
const TIME_TOLERANCE_TICKS = 1;

// ---------------------------------------------------------------------------
// An independent Standard MIDI File reader
// ---------------------------------------------------------------------------

function parseSmf(bytes: Uint8Array) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const varLen = () => { let v = 0, b; do { b = u8(); v = v * 128 + (b & 0x7F); } while (b & 0x80); return v; };

  if (tag() !== 'MThd') throw new Error('not a MIDI file: no MThd');
  if (u32() !== 6) throw new Error('unexpected header length');
  const format = u16(), trackCount = u16(), division = u16();
  if (division & 0x8000) throw new Error('SMPTE time division is not expected here');

  const tracks = [];
  for (let t = 0; t < trackCount; t++) {
    if (tag() !== 'MTrk') throw new Error(`track ${t}: no MTrk`);
    const end = u32() + p;
    const events = [];
    let tick = 0, status = 0, sawEnd = false;
    while (p < end) {
      tick += varLen();
      if (bytes[p] & 0x80) status = u8();            // otherwise: running status
      if (status === 0xFF) {
        const type = u8(), len = varLen();
        events.push({ tick, meta: type, data: bytes.slice(p, p + len) });
        p += len;
        if (type === 0x2F) sawEnd = true;
      } else if (status === 0xF0 || status === 0xF7) {
        p += varLen();
      } else {
        const kind = status & 0xF0, channel = status & 0x0F;
        const a = u8(), b = (kind === 0xC0 || kind === 0xD0) ? 0 : u8();
        events.push({ tick, kind, channel, a, b });
      }
    }
    if (p !== end) throw new Error(`track ${t}: length mismatch`);
    if (!sawEnd) throw new Error(`track ${t}: no End of Track`);
    tracks.push(events);
  }
  if (p !== bytes.length) throw new Error('trailing bytes after the last track');
  return { format, ppq: division, tracks };
}

/** Turn the parsed events into notes, tracking each channel's RPN and bend state. */
interface ReadNote {
  track: number; trackName: string; port: number; mpe: boolean; program: number | null;
  channel: number; key: number; velocity: number; startTick: number; endTick: number | null;
  bend: number; bendRange: number; frequency: number;
}
interface ReadTrack { index: number; name: string; memberChannels: number | null; port: number; notes: number; endTick: number }
interface Channel { rpn: number[]; bendRange: number | null; bendCents: number; bend: number; program: number | null; sounding: ReadNote[] }
interface ReadFile {
  ppq: number; format: number; usPerQuarter: number | null; timeSignature: { numerator: number; denominator: number } | null;
  tracks: ReadTrack[]; notes: ReadNote[]; problems: string[];
}
function readNotes(smf: ReturnType<typeof parseSmf>) {
  const text = (data: Uint8Array) => new TextDecoder().decode(data);
  const out: ReadFile = { ppq: smf.ppq, format: smf.format, usPerQuarter: null, timeSignature: null, tracks: [], notes: [], problems: [] };

  smf.tracks.forEach((events, trackIndex) => {
    const track: ReadTrack = { index: trackIndex, name: '', memberChannels: null, port: 0, notes: 0, endTick: 0 };
    const channels: Channel[] = Array.from({ length: 16 }, () => ({ rpn: [127, 127], bendRange: null, bendCents: 0, bend: 8192, program: null, sounding: [] }));

    for (const e of events) {
      track.endTick = e.tick;
      if (e.meta !== undefined) {
        if (e.meta === 0x03) track.name = text(e.data);
        if (e.meta === 0x21) track.port = e.data[0];
        if (e.meta === 0x51) out.usPerQuarter = (e.data[0] << 16) | (e.data[1] << 8) | e.data[2];
        if (e.meta === 0x58) out.timeSignature = { numerator: e.data[0], denominator: 2 ** e.data[1] };
        continue;
      }
      const ch = channels[e.channel];
      if (e.kind === 0xB0) {
        if (e.a === 101) ch.rpn[0] = e.b;
        else if (e.a === 100) ch.rpn[1] = e.b;
        else if (e.a === 6 && ch.rpn[0] === 0 && ch.rpn[1] === 0) ch.bendRange = e.b;       // RPN 0 MSB: semitones
        else if (e.a === 38 && ch.rpn[0] === 0 && ch.rpn[1] === 0) ch.bendCents = e.b;      // RPN 0 LSB: cents
        else if (e.a === 6 && ch.rpn[0] === 0 && ch.rpn[1] === 6) {                         // RPN 6: MPE configuration
          if (e.channel === 0) track.memberChannels = e.b;
          else out.problems.push(`track ${trackIndex}: MPE configuration on channel ${e.channel + 1}, not the master`);
        }
      } else if (e.kind === 0xC0) {
        if (ch.sounding.length) out.problems.push(`track ${trackIndex} ch ${e.channel + 1}: program changed under a sounding note at tick ${e.tick}`);
        ch.program = e.a;
      } else if (e.kind === 0xE0) {
        if (ch.sounding.length) out.problems.push(`track ${trackIndex} ch ${e.channel + 1}: pitch bend moved under a sounding note at tick ${e.tick}`);
        ch.bend = e.a | (e.b << 7);
      } else if (e.kind === 0x90 && e.b > 0) {
        if (ch.sounding.length) out.problems.push(`track ${trackIndex} ch ${e.channel + 1}: two notes sound at once at tick ${e.tick}`);
        if (track.memberChannels != null) {
          if (e.channel < 1 || e.channel > track.memberChannels) out.problems.push(`track ${trackIndex}: note on channel ${e.channel + 1}, outside the zone's member channels`);
        } else {
          if (e.channel === 9) out.problems.push(`track ${trackIndex}: note on channel 10, the General MIDI percussion channel`);
          if (ch.program == null) out.problems.push(`track ${trackIndex} ch ${e.channel + 1}: note before any program change`);
        }
        if (ch.bendRange == null) out.problems.push(`track ${trackIndex} ch ${e.channel + 1}: note before the bend range was declared`);
        const range = (ch.bendRange ?? 2) + ch.bendCents / 100;
        const note = {
          track: trackIndex, trackName: track.name, port: track.port, mpe: track.memberChannels != null, program: ch.program,
          channel: e.channel, key: e.a, velocity: e.b,
          startTick: e.tick, endTick: null, bend: ch.bend, bendRange: range,
          frequency: 440 * 2 ** ((e.a - 69) / 12 + ((ch.bend - 8192) / 8192) * (range / 12)),
        };
        ch.sounding.push(note);
        out.notes.push(note);
        track.notes++;
      } else if (e.kind === 0x80 || (e.kind === 0x90 && e.b === 0)) {
        const i = ch.sounding.findIndex((n) => n.key === e.a);
        if (i < 0) out.problems.push(`track ${trackIndex} ch ${e.channel + 1}: note-off without a note-on at tick ${e.tick}`);
        else ch.sounding.splice(i, 1)[0].endTick = e.tick;
      }
    }
    for (const ch of channels) if (ch.sounding.length) out.problems.push(`track ${trackIndex}: a note is never released`);
    out.tracks.push(track);
  });
  return out;
}

// ---------------------------------------------------------------------------
// The module's own truth, computed here rather than taken from the exporter
// ---------------------------------------------------------------------------

function expectedNotes(mod: ScoreModule, ppq: number) {
  const cache = mod.evaluateModule();
  const base = required(cache.get(0));
  const tempo = new Fraction(60).div(required(base.duration));       // the time unit is a quarter note
  const notes = [];
  for (const id of Object.keys(mod.notes).map(Number)) {
    if (id === 0) continue;
    const r = cache.get(id);
    if (!r || !r.startTime || !r.duration || !r.frequency) continue;      // measure bars and silences
    const amplitude = Math.min(4, Math.max(0, toNumber(r.amplitude || base.amplitude, 1)));
    if (amplitude === 0) continue;                                        // silent: not played, not exported
    const ticksPerSecond = tempo.mul(ppq).div(60);
    notes.push({
      id,
      instrument: mod.findInstrument(mod.notes[id]).toLowerCase(),
      frequency: toNumber(r.frequency),
      seconds: toNumber(r.startTime),
      exactStart: toNumber(r.startTime.mul(ticksPerSecond)),
      exactLength: toNumber(r.duration.mul(ticksPerSecond)),
      velocity: Math.min(127, Math.max(1, Math.round(64 * Math.sqrt(amplitude)))),
    });
  }
  return { notes, tempo };
}

const centsBetween = (a: number, b: number) => 1200 * Math.abs(Math.log2(a / b));

/** General MIDI programs (0-based), written out here independently of the exporter. */
const PROGRAMS: Record<string, number> = { 'piano': 0, 'fm-epiano': 5, 'vibraphone': 11, 'organ': 19, 'harmonium': 20, 'violin': 40,
  'triangle-wave': 73, 'sine-wave': 79, 'square-wave': 80, 'sawtooth-wave': 81 };

/**
 * Export `mod`, parse the bytes back, and compare note by note.
 * @returns {object} the measurements, for the caller to print or assert on
 */
function verify(mod: ScoreModule, options: Parameters<typeof planMidi>[1] = {}) {
  const plan = planMidi(mod, options);
  const bytes = encodeMidi(plan);
  const file = readNotes(parseSmf(bytes));
  const { notes: expected, tempo } = expectedNotes(mod, file.ppq);
  const problems = [...file.problems];

  if (file.format !== 1) problems.push(`format ${file.format}, expected 1`);
  const wantUs = Math.round(60000000 / toNumber(tempo));
  if (file.usPerQuarter !== wantUs) problems.push(`tempo ${file.usPerQuarter} µs/quarter, expected ${wantUs}`);

  const taken = new Set();
  let maxCents = 0, maxStart = 0, maxLength = 0, maxDriftMs = 0, velocityMismatch = 0, programMismatch = 0, missing = 0;
  for (const want of expected) {
    let best = -1, bestDistance = Infinity;
    file.notes.forEach((got, i) => {
      if (taken.has(i)) return;
      if (got.trackName !== want.instrument && !got.trackName.startsWith(`${want.instrument} (`)) return;
      const startError = Math.abs(got.startTick - want.exactStart);
      if (startError > TIME_TOLERANCE_TICKS) return;
      if (centsBetween(got.frequency, want.frequency) > PITCH_TOLERANCE_CENTS) return;
      if (startError < bestDistance) { best = i; bestDistance = startError; }
    });
    if (best < 0) { missing++; if (missing <= 3) problems.push(`note [${want.id}] not found in the file within tolerance`); continue; }
    taken.add(best);
    const got = file.notes[best];
    maxCents = Math.max(maxCents, centsBetween(got.frequency, want.frequency));
    maxStart = Math.max(maxStart, Math.abs(got.startTick - want.exactStart));
    maxLength = Math.max(maxLength, Math.abs((required(got.endTick) - got.startTick) - want.exactLength));
    // The same start through the file's own (rounded) tempo, against the module's clock.
    const fileSeconds = got.startTick * required(file.usPerQuarter) / (file.ppq * 1e6);
    maxDriftMs = Math.max(maxDriftMs, Math.abs(fileSeconds - want.seconds) * 1000);
    if (got.velocity !== want.velocity) velocityMismatch++;
    if (!got.mpe && got.program !== (PROGRAMS[want.instrument] ?? 0)) programMismatch++;
  }
  if (programMismatch) problems.push(`${programMismatch} notes sound with another program than their instrument's`);

  // An ordinary player merges all tracks of a port: a channel must carry one
  // note at a time across the WHOLE file, and two notes may meet on a tick
  // only inside one track, where note-off comes before note-on.
  const byChannel = new Map<string, ReadNote[]>();
  for (const n of file.notes) {
    if (n.mpe) continue;
    const key = `${n.port}:${n.channel}`;
    if (!byChannel.has(key)) byChannel.set(key, []);
    required(byChannel.get(key)).push(n);
  }
  let collisions = 0;
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.startTick - b.startTick);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], next = list[i];
      if (next.startTick < required(prev.endTick) || (next.startTick === prev.endTick && next.track !== prev.track)) collisions++;
    }
  }
  if (collisions) problems.push(`${collisions} notes share a channel with a note of another track that is still sounding`);
  if (missing > 3) problems.push(`… ${missing} notes missing in all`);
  if (file.notes.length !== expected.length) problems.push(`file has ${file.notes.length} notes, module has ${expected.length} sounding notes`);
  if (maxLength > TIME_TOLERANCE_TICKS) problems.push(`a length is ${maxLength.toFixed(3)} ticks off`);
  if (velocityMismatch) problems.push(`${velocityMismatch} velocities differ from 64·√amplitude`);

  return {
    plan, bytes, file, problems,
    notes: expected.length, matched: taken.size,
    maxCents, maxStart, maxLength, maxDriftMs,
    tickMs: (required(file.usPerQuarter) / file.ppq) / 1000,
  };
}

const describe = (v: ReturnType<typeof verify>) =>
  `${v.matched}/${v.notes} notes, ${v.file.tracks.length - 1} track${v.file.tracks.length === 2 ? '' : 's'}, ` +
  `pitch ≤ ${v.maxCents.toFixed(4)} cent, start ≤ ${v.maxStart.toFixed(3)} tick, length ≤ ${v.maxLength.toFixed(3)} tick`;

const loadFile = async (path: string) => {
  const mod = await Module.loadFromJSON(JSON.parse(readFileSync(path, 'utf8')));
  mod.evaluateModule();
  return mod;
};
const build = async (baseNote: ScoreFields, notes: ScoreNote[]) => {
  const mod = await Module.loadFromJSON({ baseNote, notes });
  mod.evaluateModule();
  return mod;
};
const BASE = { frequency: '263', startTime: '0', duration: '3/5' };     // 100 BPM

// --- 1. real modules -------------------------------------------------------------
console.log('MIDI export: real modules, read back from the bytes\n');
{
  const named = [join(modulesDir, 'defaultModule.json')];
  const aubade = join(root, 'compositions', 'aubade', 'aubade.json');
  if (existsSync(aubade)) named.push(aubade);
  for (const arg of process.argv.slice(2)) named.push(resolve(arg));

  for (const path of named) {
    if (!existsSync(path)) { fail(`${path}: file not found`); continue; }
    const v = verify(await loadFile(path));
    const label = `${basename(dirname(path))}/${basename(path)}`;
    check(v.problems.length === 0 && v.matched === v.notes, `${label}: ${describe(v)}`);
    for (const problem of v.problems) console.error(`      ${problem}`);
    const r = v.plan.report;
    console.log(`      tempo ${r.tempo.exactBpm} BPM stored as ${r.tempo.usPerQuarter} µs/quarter (${r.tempo.storedBpm.toFixed(6)} BPM); ` +
      `tick ${v.tickMs.toFixed(4)} ms; start vs module clock ≤ ${v.maxDriftMs.toFixed(4)} ms; ` +
      `max ${r.polyphony.max} notes at once; ${v.bytes.length} bytes`);
    console.log(`      tracks: ${v.file.tracks.slice(1).map((t) => `${t.name} (${t.notes})`).join(', ')}`);
    for (const w of r.warnings) console.log(`      note: ${w}`);
  }

  const lib = JSON.parse(readFileSync(join(modulesDir, 'library.json'), 'utf8'));
  if (!isLibraryManifest(lib)) throw new Error('Invalid v2 manifest');
  const files = lib.sections.flatMap((s) => (s.items || []).map((i) => i.file));
  let bad = 0, total = 0, worstCents = 0, worstStart = 0, worstLength = 0;
  for (const file of files) {
    const v = verify(await loadFile(join(modulesDir, file)));
    total += v.notes;
    worstCents = Math.max(worstCents, v.maxCents); worstStart = Math.max(worstStart, v.maxStart); worstLength = Math.max(worstLength, v.maxLength);
    if (v.problems.length || v.matched !== v.notes) { bad++; console.error(`      ${file}: ${v.problems.join('; ')}`); }
  }
  check(bad === 0, `all ${files.length} library modules (${total} notes): pitch ≤ ${worstCents.toFixed(4)} cent, start ≤ ${worstStart.toFixed(3)} tick, length ≤ ${worstLength.toFixed(3)} tick`);
}

// --- 2. more simultaneous notes than a zone has channels -----------------------------
console.log('\nMIDI export: the mpe layout, more notes at once than a zone has channels\n');
{
  const notes = [];
  // A 40-note piano cluster and a 20-note organ cluster, all sounding together.
  for (let k = 1; k <= 40; k++) notes.push({ id: k, startTime: 'base.t', duration: 'base.d * 4', frequency: `base.f * (${k + 8}/8)`, instrument: 'piano' });
  for (let k = 41; k <= 60; k++) notes.push({ id: k, startTime: 'base.t + base.d', duration: 'base.d * 2', frequency: `base.f * (${k}/32)`, instrument: 'organ' });
  const v = verify(await build(BASE, notes), { layout: 'mpe' });
  const r = v.plan.report;
  check(v.problems.length === 0 && v.matched === 60, `all 60 notes are in the file: ${describe(v)}`);
  for (const problem of v.problems) console.error(`      ${problem}`);
  check(v.file.tracks.slice(1).map((t) => `${t.name}:${t.notes}`).join(' ') === 'piano:15 piano (2):15 piano (3):10 organ:15 organ (2):5',
    `the surplus goes to further tracks: ${v.file.tracks.slice(1).map((t) => `${t.name} (${t.notes} notes)`).join(', ')}`);
  check(r.polyphony.max === 40 && r.polyphony.overflowNotes === 30 && r.polyphony.overflowTracks === 3,
    `and is reported: max ${r.polyphony.max} at once, ${r.polyphony.overflowNotes} notes in ${r.polyphony.overflowTracks} extra tracks`);
  check(r.warnings.length === 2 && r.warnings.every((w) => /MPE zone holds 15/.test(w)), `with a warning per instrument: "${r.warnings[0]}"`);
}

// --- 3. rotation ---------------------------------------------------------------------
console.log('\nMIDI export: the mpe layout, channel rotation\n');
{
  // A 40-note legato line: each note starts where the previous one ends.
  const notes = [];
  for (let k = 1; k <= 40; k++) notes.push({ id: k, startTime: k === 1 ? 'base.t' : `[${k - 1}].t + [${k - 1}].d`, duration: 'base.d * (1/2)', frequency: `base.f * (${k + 15}/16)` });
  const v = verify(await build(BASE, notes), { layout: 'mpe' });
  const order = [...v.file.notes].sort((a, b) => a.startTick - b.startTick).map((n) => n.channel + 1);
  check(v.problems.length === 0 && v.file.tracks.length === 2, `a monophonic line stays in one track: ${describe(v)}`);
  check(order.slice(0, 15).join(',') === '2,3,4,5,6,7,8,9,10,11,12,13,14,15,16' && order.every((ch, i) => i < 15 || ch === order[i - 15]),
    `notes cycle through channels 2–16, so a channel rests for 14 notes before it is bent again`);
  check(v.file.tracks[1].memberChannels === 15 && v.file.notes.every((n) => n.bendRange === 2), 'the file declares the zone (RPN 6 = 15) and the bend range (RPN 0 = 2 semitones)');
}

// --- 3b. the default layout: an ordinary General MIDI player ------------------------------
console.log('\nMIDI export: the default layout plays in an ordinary player\n');
{
  // Four instruments sounding together, twelve notes at once, then a legato line.
  const voices = ['organ', 'fm-epiano', 'vibraphone', 'triangle-wave'];
  const notes = [];
  for (let k = 0; k < 12; k++) notes.push({ id: k + 1, startTime: 'base.t', duration: 'base.d * 4', frequency: `base.f * (${k + 8}/8)`, instrument: voices[k % 4] });
  for (let k = 0; k < 30; k++) notes.push({ id: 20 + k, startTime: `base.t + base.d * ${4 + k}`, duration: 'base.d', frequency: `base.f * (${k + 16}/16)`, instrument: voices[k % 4] });
  const v = verify(await build(BASE, notes));
  const used = [...new Set(v.file.notes.map((n) => n.channel + 1))].sort((a, b) => a - b);
  check(v.problems.length === 0 && v.matched === 42, `all 42 notes, each alone on its channel across the whole file: ${describe(v)}`);
  check(!used.includes(10) && v.file.notes.every((n) => !n.mpe), `nothing on channel 10, no MPE zone declared (channels used: ${used.join(' ')})`);
  const programs = voices.map((name) => `${name} ${[...new Set(v.file.notes.filter((n) => n.trackName === name).map((n) => required(n.program) + 1))].join('/')}`);
  check(programs.join(', ') === 'organ 20, fm-epiano 6, vibraphone 12, triangle-wave 74', `every note is preceded by its instrument's program: ${programs.join(', ')}`);
  check(v.file.tracks.slice(1).map((x) => x.name).join(' ') === voices.join(' '), 'one track per instrument, named after it');

  const mpe = verify(await build(BASE, notes), { layout: 'mpe' });
  check(mpe.problems.length === 0 && mpe.matched === 42 && mpe.file.notes.every((n) => n.mpe), `the same module with layout 'mpe': ${describe(mpe)}`);

  // More than fifteen notes at once do not fit one port.
  const cluster = [];
  for (let k = 1; k <= 40; k++) cluster.push({ id: k, startTime: 'base.t', duration: 'base.d * 4', frequency: `base.f * (${k + 8}/8)`, instrument: 'piano' });
  const big = verify(await build(BASE, cluster));
  check(big.problems.length === 0 && big.matched === 40, `a 40-note cluster is all in the file: ${describe(big)}`);
  check(big.file.tracks.slice(1).map((x) => `${x.name}:${x.notes}@${x.port}`).join(' ') === 'piano:15@0 piano (port 2):15@1 piano (port 3):10@2'
    && big.plan.report.polyphony.overflowNotes === 25 && big.plan.report.warnings.some((w) => /one MIDI port carries 15/.test(w)),
    `the surplus is written for further ports and reported: "${big.plan.report.warnings[0]}"`);
  let threw = false;
  try {
    // Exercise the runtime validator with an invalid option from an untyped caller.
    Reflect.apply(planMidi, undefined, [await build(BASE, cluster), { layout: 'gm' }]);
  } catch { threw = true; }
  check(threw, 'an unknown layout is refused');
}

// --- 4. loudness ---------------------------------------------------------------------
console.log('\nMIDI export: amplitude to velocity\n');
{
  const amps = ['(1/4)', '(1/2)', '1', '(121/100)', '2', '4', '9', '0'];
  const notes: ScoreNote[] = amps.map((a, i) => ({ id: i + 1, startTime: `base.t + base.d * ${i}`, duration: 'base.d', frequency: 'base.f', amplitude: a }));
  notes.push({ id: 9, startTime: 'base.t + base.d * 8', duration: 'base.d', frequency: 'base.f' });     // inherits the BaseNote's
  const v = verify(await build({ ...BASE, amplitude: '(9/16)' }, notes));
  const velocities = [...v.file.notes].sort((a, b) => a.startTick - b.startTick).map((n) => n.velocity);
  check(v.problems.length === 0, `velocities match 64·√amplitude: ${describe(v)}`);
  check(velocities.join(',') === '32,45,64,70,91,127,127,48', `1/4, 1/2, 1, 121/100, 2, 4, 9, inherited 9/16 -> ${velocities.join(', ')}`);
  const r = v.plan.report;
  check(r.notes.skipped.silent.join() === '8' && r.notes.amplitudeClamped === 1 && r.warnings.length === 2,
    `amplitude 0 is left out and amplitude 9 is clamped, both reported: "${r.warnings.join('" / "')}"`);
}

// --- 5. pitch ------------------------------------------------------------------------
console.log('\nMIDI export: pitch\n');
{
  // 12-TET from A = 440 is exactly the MIDI key grid: every bend must be centred.
  const tet = [];
  for (let k = 0; k <= 12; k++) tet.push({ id: k + 1, startTime: `base.t + base.d * ${k}`, duration: 'base.d', frequency: `base.f * 2^(${k}/12)` });
  let v = verify(await build({ ...BASE, frequency: '440' }, tet));
  check(v.problems.length === 0 && v.file.notes.every((n) => n.bend === 8192) && v.file.notes.map((n) => n.key).join() === '69,70,71,72,73,74,75,76,77,78,79,80,81',
    `irrational 12-TET steps from 440 Hz land on keys 69–81 with no bend: ${describe(v)}`);

  // Just intervals: the bend carries the difference from equal temperament.
  const ji: [string, number][] = [['(3/2)', 1.955], ['(5/4)', -13.686], ['(7/4)', -31.174], ['(11/8)', -48.682]];
  v = verify(await build({ ...BASE, frequency: '440' }, ji.map(([ratio], i) => ({ id: i + 1, startTime: `base.t + base.d * ${i}`, duration: 'base.d', frequency: `base.f * ${ratio}` }))));
  const cents = [...v.file.notes].sort((a, b) => a.startTick - b.startTick).map((n) => ((n.bend - 8192) / 8192) * 200);
  check(v.problems.length === 0 && cents.every((c, i) => Math.abs(c - ji[i][1]) < 0.02),
    `3/2, 5/4, 7/4, 11/8 are bent by ${cents.map((c) => c.toFixed(2)).join(', ')} cents`);

  // Outside what the keys can reach.
  const far = [
    { id: 1, startTime: 'base.t', duration: 'base.d', frequency: '20000' },
    { id: 2, startTime: 'base.t', duration: 'base.d', frequency: '5' },
    { id: 3, startTime: 'base.t', duration: 'base.d', frequency: '13000' },      // key 127 plus 62 cents: reachable
  ];
  v = verify(await build(BASE, far));
  const r = v.plan.report;
  // verify() expects all three; two are deliberately unplayable.
  check(v.file.notes.length === 1 && v.file.notes[0].key === 127 && r.notes.skipped.outOfRange.join() === '1,2',
    `20 kHz and 5 Hz cannot be written and are reported; 13 kHz is key 127 bent up: "${r.warnings[0]}"`);
}

// --- 6. time -------------------------------------------------------------------------
console.log('\nMIDI export: time\n');
{
  // Septuplets do not divide 960; each start is rounded on its own, never accumulated.
  const notes = [];
  for (let k = 0; k < 70; k++) notes.push({ id: k + 1, startTime: `base.t + base.d * (${k}/7)`, duration: 'base.d * (1/7)', frequency: 'base.f' });
  let v = verify(await build(BASE, notes));
  check(v.problems.length === 0 && v.maxStart <= 0.5 + 1e-9, `70 septuplets at 960 PPQ: ${describe(v)}`);
  const sorted = [...v.file.notes].sort((a, b) => a.startTick - b.startTick);
  check(sorted.every((n, i) => i === 0 || n.startTick === sorted[i - 1].endTick), 'notes that touch in the module touch in the file (no gaps, no overlaps)');

  v = verify(await build(BASE, notes), { ppq: 20160 });
  check(v.problems.length === 0 && v.maxStart === 0 && v.maxLength === 0 && v.file.ppq === 20160, `the same at ppq 20160 (= 21 × 960, divisible by 7): exact — ${describe(v)}`);

  // 66 BPM is a time unit of 10/11 s; a first bar 7/2 units long is 7/8
  v = verify(await build({ ...BASE, duration: '10/11' },
    [...notes, { id: 999, startTime: 'base.t', duration: 'base.d * (7/2)', measure: true }]));
  check(v.problems.length === 0 && v.file.usPerQuarter === 909091 && required(v.file.timeSignature).numerator === 7 && required(v.file.timeSignature).denominator === 8,
    `base.d = 10/11 s (66 BPM) is stored as 909091 µs/quarter and a bar of base.d * (7/2) as 7/8; module clock off by ≤ ${v.maxDriftMs.toFixed(4)} ms`);

  // The edges of the grid. The report counts a note only when it is written.
  const plan = planMidi(await build(BASE, [
    { id: 1, startTime: 'base.t', duration: 'base.d * (1/100000)', frequency: 'base.f' },             // shorter than a tick
    { id: 2, startTime: 'base.t - base.d', duration: 'base.d * 2', frequency: 'base.f' },          // begins before zero
    { id: 3, startTime: 'base.t - base.d * 2', duration: 'base.d', frequency: 'base.f' },          // over before zero
    { id: 4, startTime: 'base.t', duration: 'base.d * (1/100000)', frequency: 'base.f * 1024' },       // too short and out of range
  ]));
  const written = plan.tracks.flatMap((t) => t.notes);
  const short = written.find((n) => n.id === 1), early = written.find((n) => n.id === 2);
  const rep = plan.report.notes;
  check(short && short.endTick - short.startTick === 1 && rep.lengthened === 1,
    `a note shorter than a tick is one tick long, and counted once (lengthened: ${rep.lengthened})`);
  check(early && early.startTick === 0 && early.endTick === 960 && rep.clippedAtStart === 1,
    'a note that begins before time zero starts at tick 0 and keeps its end');
  check(written.length === 2 && rep.skipped.beforeStart.join() === '3' && rep.skipped.outOfRange.join() === '4',
    'a note over before zero and one out of range are left out, each under its own cause');
}

// --- 7. options and the byte level ----------------------------------------------------
console.log('\nMIDI export: options and bytes\n');
{
  const mod = await loadFile(join(modulesDir, 'defaultModule.json'));
  const bytes = moduleToMidi(mod);
  const head = Array.from(bytes.slice(0, 14));
  check(String.fromCharCode(...head.slice(0, 4)) === 'MThd' && head[9] === 1 && ((head[12] << 8) | head[13]) === 960, 'header: MThd, format 1, 960 ticks per quarter note');
  check(Buffer.from(bytes).equals(Buffer.from(moduleToMidi(mod))), 'exporting twice gives identical bytes');

  // The MPE default bend range trades resolution for not having to set it in the instrument.
  const wide = planMidi(mod, { bendRange: 48 });
  const file = readNotes(parseSmf(encodeMidi(wide)));
  check(file.notes.every((n) => n.bendRange === 48) && wide.report.accuracy.maxPitchErrorCents < 0.3 && wide.report.bendStepCents > 0.58,
    `bendRange 48 is declared and costs resolution: steps of ${wide.report.bendStepCents.toFixed(3)} cent, worst note ${wide.report.accuracy.maxPitchErrorCents.toFixed(3)} cent off`);

  let threw = 0;
  for (const bad of [{ ppq: 0 }, { ppq: 40000 }, { bendRange: 0 }, { bendRange: 97 }, { unityVelocity: 0 }, { a4: -1 }]) {
    try { planMidi(mod, bad); } catch { threw++; }
  }
  check(threw === 6, 'out-of-range options are refused');
}

console.log(`\n${failures ? `${failures} failure(s).` : 'All MIDI export checks passed.'}`);
process.exit(failures ? 1 : 0);
