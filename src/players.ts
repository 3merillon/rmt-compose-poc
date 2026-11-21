/**
 * Players: who plays a note, and so which instrument it sounds with
 * (Phase I, design/phase-i-instruments.md §4).
 *
 * The owner's rule (20 November 2026): "anything inheriting it's instrument
 * would be the same instrument ... Defining a note's instrument would make it a
 * 'new' instrument", and inheritance follows the START TIME, so that "a player
 * can have a silence in his score". A player is a LINE: notes joined by the
 * relation "starts where the previous one ends". A note's instrument is
 *
 *   1. its own `instrument`, if it sets one: it starts a new player, and the line
 *      goes on from it with that instrument;
 *   2. else, when its start is written from the end of a note or a silence p
 *      (`[p].t + [p].d`, or that plus a rest, `[p].t + [p].d + base.d * k`): p's;
 *   3. else, when it is a copy of a note k of a line and the copy of k's
 *      predecessor exists at the same offset: that copy's. A delayed copy
 *      may inherit its duration from k and take its pitch from another voice;
 *   4. else it starts a line, and takes the instrument of the note its start time
 *      is written from (a measure bar does not count), else the BaseNote's, else
 *      the default instrument.
 *
 * Rules 2 and 3 give a note its LINE PREDECESSOR (linePredecessor): the player's
 * previous note, which line playing (legato) needs too. The frequency plays no
 * part: a bass note tuned from the melody is still the bass.
 */
import { isMeasureNote, type Note } from './note.ts';
import type { Module } from './module.ts';
import type { ExpressionName } from './model-types.ts';
import { compare } from './value/exact.ts';

const FOLLOW = /^\s*\[(\d+)\]\.t\s*\+\s*\[(\d+)\]\.d\s*(?:\+\s*(.+?))?\s*$/;
const COPY_T = /^\s*\[(\d+)\]\.t\s*(?:\+\s*(.+?))?\s*$/;
const COPY_F = /^\s*(?:.+\*\s*)?\[(\d+)\]\.f\s*$/;
const COPY_D = /^\s*\[(\d+)\]\.d\s*$/;
const START_REF = /\[(\d+)\]\.[td]\b/;

/** Whether the saved module uses this rule (written by Module.createModuleJSON). */
export const INSTRUMENT_RULE = 'start-time';

const src = (note: Note | null | undefined, name: ExpressionName) => (note && typeof note.getExpressionSource === 'function' ? note.getExpressionSource(name) || '' : '');
/** A note or a silence that occupies time: start and duration, not a measure bar, not the BaseNote. */
const timed = (n: Note | null | undefined): n is Note => !!n && n.id !== 0 && !isMeasureNote(n) && !!src(n, 'startTime') && !!src(n, 'duration');
const norm = (s: string | undefined) => String(s || '').replace(/\s+/g, '');

export interface PlayerMemo extends Map<number, string> {
  prev?: Map<number, Note | null>;
}

function memoOf(memo?: PlayerMemo | null) {
  const m: PlayerMemo = memo || new Map<number, string>();
  if (!m.prev) m.prev = new Map<number, Note | null>();
  // The shared Map now carries both caches, including when supplied by the caller.
  return m as PlayerMemo & { prev: Map<number, Note | null> };
}

function copiesDelayedDuration(note: Note, source: Note, offset: string) {
  if (!offset || COPY_D.exec(src(note, 'duration'))?.[1] !== String(source.id)) return false;
  const start = note.getExactVariable('startTime');
  const origin = source.getExactVariable('startTime');
  return start != null && origin != null && compare(start, origin) > 0;
}

/**
 * The note a note follows in its line (rules 2 and 3), or null.
 * @param {object} module @param {object} note
 * @param {Map} [memo] shared across calls in one pass (see instrumentOf)
 */
export function linePredecessor(module: Module, note: Note | null | undefined, memo: PlayerMemo | null = null): Note | null {
  const M = memoOf(memo);
  if (!note || note.id === 0) return null;
  if (M.prev.has(note.id)) return M.prev.get(note.id) ?? null;
  M.prev.set(note.id, null); // guard: a relation loop yields no predecessor
  let res = null;
  const start = src(note, 'startTime');
  const f = FOLLOW.exec(start);
  if (f && f[1] === f[2]) {
    const p = module.getNoteById(Number(f[1]));
    if (timed(p) && p !== note) res = p;
  }
  if (!res) {
    const t = COPY_T.exec(start);
    if (t) {
      const k = module.getNoteById(Number(t[1]));
      if (timed(k) && k !== note) {
        const offset = norm(t[2]);
        const pitchCopy = COPY_F.exec(src(note, 'frequency'))?.[1] === t[1];
        if (pitchCopy || (copiesDelayedDuration(note, k, offset) && copyOf(module, k, offset) === note)) {
          const kp = linePredecessor(module, k, M);
          if (kp) res = copyOf(module, kp, offset, note);
        }
      }
    }
  }
  M.prev.set(note.id, res);
  return res;
}

// Find the copy of k with the same written time offset as its successor.
function copyOf(module: Module, k: Note, X: string, except?: Note): Note | null {
  const graph = module._dependencyGraph;
  const ids = graph && typeof graph.getDependents === 'function' ? graph.getDependents(k.id) : Object.keys(module.notes).map(Number);
  let best = null, rhythmCopy = null, rhythmCount = 0;
  for (const id of ids) {
    const d = module.getNoteById(Number(id));
    if (!d || d === except || !timed(d)) continue;
    const dt = COPY_T.exec(src(d, 'startTime'));
    if (!dt || Number(dt[1]) !== k.id || norm(dt[2]) !== X) continue;
    if (COPY_F.exec(src(d, 'frequency'))?.[1] === dt[1]) {
      if (!best || d.id < best.id) best = d;
    } else if (copiesDelayedDuration(d, k, X)) {
      rhythmCopy = d;
      rhythmCount++;
    }
  }
  // Earlier scores identify the answering line by its pitch copy. A tonal
  // answer can bridge two such notes when its rhythmic copy is unambiguous.
  return best || (rhythmCount === 1 ? rhythmCopy : null);
}

/**
 * The instrument a note sounds with (rules 1–4).
 * @param {object} module
 * @param {object} note
 * @param {Map} [memo] instruments (and predecessors) already resolved in this pass,
 *   by note id: a caller resolving many notes passes one Map, so each line is
 *   walked once rather than once per note on it
 * @param {string} defaultName the default instrument (Settings → Audio)
 */
export function instrumentOf(module: Module, note: Note | null | undefined, memo: PlayerMemo | null, defaultName: string): string {
  if (!note) return 'sine-wave';
  const M = memoOf(memo);
  const base = module.baseNote;
  // Walk the chain iteratively (a line can be tens of thousands of notes long),
  // then give every note on the way the instrument found at its end.
  const path = [];
  const seen = new Set();
  let r = defaultName;
  for (let n = note; n; ) {
    const hit = M.get(n.id);
    if (hit !== undefined) { r = hit; break; }
    if (seen.has(n.id)) { r = defaultName; break; }   // a relation loop: the default
    seen.add(n.id);
    path.push(n.id);
    if (n.id === 0 || n === base) { r = (base && base.properties.instrument) || defaultName; break; }
    if (n.properties.instrument) { r = n.properties.instrument; break; }
    const p = linePredecessor(module, n, M);
    if (p) { n = p; continue; }
    const m = START_REF.exec(src(n, 'startTime'));
    const k = m ? module.getNoteById(Number(m[1])) : null;
    n = k && k.id !== 0 && k !== n && !isMeasureNote(k) ? k : base;
    if (!n) break;
  }
  for (const id of path) M.set(id, r);
  return r;
}

/**
 * A note's player: the first note of its line (`head`, the note that decides the
 * instrument of every note after it until one sets its own) and the note it
 * follows in the line (`prev`; null for the first note, and for a note that sets
 * its own instrument, which starts a new player).
 * @returns {{head:number, prev:number|null}}
 */
export function playerOf(module: Module, note: Note | null | undefined, memo: PlayerMemo | null = null): { head: number; prev: number | null } {
  const M = memoOf(memo);
  if (!note) return { head: -1, prev: null };
  const own = (n: Note) => !!(n && n.properties && n.properties.instrument);
  const prevNote = own(note) ? null : linePredecessor(module, note, M);
  let head = note;
  const seen = new Set([note.id]);
  for (let p = prevNote; p && !seen.has(p.id); p = own(p) ? null : linePredecessor(module, p, M)) {
    seen.add(p.id);
    head = p;
    if (own(p)) break;
  }
  return { head: head.id, prev: prevNote ? prevNote.id : null };
}

/**
 * The rule before Phase I: a note without an instrument took the instrument of
 * the note its FREQUENCY reads (`[N].f`), else the BaseNote's (`base.f`), else the
 * default; a note without a frequency, the default. Kept only to migrate old
 * modules (migrateInstrumentRule), so they keep sounding as they did.
 */
export function legacyInstrumentOf(module: Module, note: Note | null | undefined, memo: Map<number, string> | undefined, defaultName: string): string;
export function legacyInstrumentOf(module: Module, note: Note | null | undefined, memo: null, defaultName: string): string | null;
export function legacyInstrumentOf(module: Module, note: Note | null | undefined, memo: Map<number, string> | null | undefined, defaultName: string): string | null {
  if (!note) return 'sine-wave';
  const path = [];
  const seen = new Set();
  let r = defaultName;
  for (let n = note; n; ) {
    const hit = memo && memo.get(n.id);
    if (hit === null) return null;
    if (hit !== undefined) { r = hit; break; }
    if (seen.has(n.id)) { r = defaultName; break; }
    seen.add(n.id);
    path.push(n.id);
    if (!n.hasExpression('frequency') && !n.getVariable('frequency')) { r = defaultName; break; }
    if (n.properties.instrument) { r = n.properties.instrument; break; }
    const fs = src(n, 'frequency');
    const ref = fs.match(/\[(\d+)\]\.f/);
    const parent = ref ? module.getNoteById(parseInt(ref[1], 10)) : null;
    if (parent && parent !== n) { n = parent; continue; }
    if (fs.includes('base.f')) { n = module.baseNote; continue; }
    r = defaultName;
    break;
  }
  if (memo) for (const id of path) memo.set(id, r);
  return r;
}

/**
 * Keep an old module (one saved before this rule) sounding with the instruments
 * it had: every sounding note whose instrument the new rule would change gets the
 * old one written onto it (it then starts its own player). Repeated until nothing
 * differs, since one pin can settle the notes that follow it.
 * @returns {number[]} the ids pinned
 */
export function migrateInstrumentRule(module: Module, defaultName: string) {
  const pinned = [];
  for (let pass = 0; pass < 16; pass++) {
    const memoNew = new Map<number, string>(), memoOld = new Map<number, string>();
    const diff: [Note, string][] = [];
    for (const id in module.notes) {
      const n = module.notes[id];
      if (!timed(n) || !src(n, 'frequency') || n.properties.instrument) continue;
      const before = legacyInstrumentOf(module, n, memoOld, defaultName);
      if (instrumentOf(module, n, memoNew, defaultName) !== before) diff.push([n, before]);
    }
    if (!diff.length) break;
    for (const [n, before] of diff) { n.setVariable('instrument', before); pinned.push(n.id); }
  }
  return pinned;
}
