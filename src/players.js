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
 *   3. else, when it is a copy of a note k of a line (start `[k].t + X`, frequency
 *      `r * [k].f`) and the copy of k's predecessor exists (written from it with
 *      the same X): that copy's. A copy of a line is a line: a canon voice;
 *   4. else it starts a line, and takes the instrument of the note its start time
 *      is written from (a measure bar does not count), else the BaseNote's, else
 *      the default instrument.
 *
 * Rules 2 and 3 give a note its LINE PREDECESSOR (linePredecessor): the player's
 * previous note, which line playing (legato) needs too. The frequency plays no
 * part: a bass note tuned from the melody is still the bass.
 */
import { isMeasureNote } from './note.js';

const FOLLOW = /^\s*\[(\d+)\]\.t\s*\+\s*\[(\d+)\]\.d\s*(?:\+\s*(.+?))?\s*$/;
const COPY_T = /^\s*\[(\d+)\]\.t\s*(?:\+\s*(.+?))?\s*$/;
const COPY_F = /^\s*(?:.+\*\s*)?\[(\d+)\]\.f\s*$/;
const START_REF = /\[(\d+)\]\.[td]\b/;

/** Whether the saved module uses this rule (written by Module.createModuleJSON). */
export const INSTRUMENT_RULE = 'start-time';

const src = (note, name) => (note && typeof note.getExpressionSource === 'function' ? note.getExpressionSource(name) || '' : '');
/** A note or a silence that occupies time: start and duration, not a measure bar, not the BaseNote. */
const timed = (n) => !!n && n.id !== 0 && !isMeasureNote(n) && !!src(n, 'startTime') && !!src(n, 'duration');
const norm = (s) => String(s || '').replace(/\s+/g, '');

function memoOf(memo) {
  const m = memo || new Map();
  if (!m.prev) m.prev = new Map();
  return m;
}

/**
 * The note a note follows in its line (rules 2 and 3), or null.
 * @param {object} module @param {object} note
 * @param {Map} [memo] shared across calls in one pass (see instrumentOf)
 */
export function linePredecessor(module, note, memo = null) {
  const M = memoOf(memo);
  if (!note || note.id === 0) return null;
  if (M.prev.has(note.id)) return M.prev.get(note.id);
  M.prev.set(note.id, null); // guard: a relation loop yields no predecessor
  let res = null;
  const start = src(note, 'startTime');
  const f = FOLLOW.exec(start);
  if (f && f[1] === f[2]) {
    const p = module.getNoteById(Number(f[1]));
    if (timed(p) && p !== note) res = p;
  }
  if (!res) {
    const t = COPY_T.exec(start), fr = COPY_F.exec(src(note, 'frequency'));
    if (t && fr && t[1] === fr[1]) {
      const k = module.getNoteById(Number(t[1]));
      const kp = timed(k) && k !== note ? linePredecessor(module, k, M) : null;
      if (kp) res = copyOf(module, kp, norm(t[2]), note);
    }
  }
  M.prev.set(note.id, res);
  return res;
}

// The note written as a copy of `k` with time offset X: start `[k].t + X`, frequency `r * [k].f`.
function copyOf(module, k, X, except) {
  const graph = module._dependencyGraph;
  const ids = graph && typeof graph.getDependents === 'function' ? graph.getDependents(k.id) : Object.keys(module.notes).map(Number);
  let best = null;
  for (const id of ids) {
    const d = module.getNoteById(Number(id));
    if (!d || d === except || !timed(d)) continue;
    const dt = COPY_T.exec(src(d, 'startTime')), df = COPY_F.exec(src(d, 'frequency'));
    if (dt && df && Number(dt[1]) === k.id && Number(df[1]) === k.id && norm(dt[2]) === X) {
      if (!best || d.id < best.id) best = d;
    }
  }
  return best;
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
export function instrumentOf(module, note, memo, defaultName) {
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
export function playerOf(module, note, memo = null) {
  const M = memoOf(memo);
  if (!note) return { head: -1, prev: null };
  const own = (n) => !!(n && n.properties && n.properties.instrument);
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
export function legacyInstrumentOf(module, note, memo, defaultName) {
  if (!note) return 'sine-wave';
  const path = [];
  const seen = new Set();
  let r = defaultName;
  for (let n = note; n; ) {
    const hit = memo && memo.get(n.id);
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
export function migrateInstrumentRule(module, defaultName) {
  const pinned = [];
  for (let pass = 0; pass < 16; pass++) {
    const memoNew = new Map(), memoOld = new Map(), diff = [];
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
