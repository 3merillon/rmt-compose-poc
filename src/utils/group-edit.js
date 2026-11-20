/**
 * Group editing: selecting notes by their relations, and changing a variable
 * on many notes at once.
 *
 * SELECTING BY RELATION. relatedNoteIds() walks the references between notes,
 * restricted to one variable of the reading note: "dependents by t" of a note
 * are the notes whose start reads it, then the notes whose start reads those,
 * and so on. A melody whose notes each begin where the one before ends
 * ([p].t + [p].d) is, from its first note, exactly its dependents by t.
 * "Dependencies" walk the other way, to what the note reads.
 *
 * CHANGING A VARIABLE. Two meanings, both honest:
 *   set    write the same expression to every selected note, replacing what
 *          each had (relations included);
 *   scale  multiply what each note has by a ratio, keeping its relations.
 * A scale applies only to the selection's ROOTS for that variable: a selected
 * note whose value is read, through the same variable, from another selected
 * note (directly, or through notes outside the selection) follows that note,
 * and scaling it as well would change it twice. Its relation carries the change.
 * Notes outside the selection that read a changed note follow it too, as they
 * do for any edit: that is what a relation is.
 *
 * Nothing here touches the DOM; the caller re-evaluates and records the undo step.
 */
import Fraction from 'fraction.js';
import { VAR, FIRST_INTERPRETATION_VAR } from '../binary-note.js';
import { getVariableRefs } from '../variable-deps.js';
import { isMeasureNote } from '../note.js';
import { multiplyExpressionByFraction } from './simplify.js';
import { validateExpression } from '../modals/validation.js';

const ALL_VARS = [VAR.START_TIME, VAR.DURATION, VAR.FREQUENCY, VAR.AMPLITUDE, VAR.ATTACK, VAR.RELEASE];

/** Which variables of the READING note a relation walk follows. */
export const RELATION_VARS = {
  t: [VAR.START_TIME],
  d: [VAR.DURATION],
  f: [VAR.FREQUENCY],
  all: ALL_VARS,
};

/** The variables a group edit can change, by name. */
export const GROUP_VARS = {
  amplitude: VAR.AMPLITUDE,
  attack: VAR.ATTACK,
  release: VAR.RELEASE,
  frequency: VAR.FREQUENCY,
  duration: VAR.DURATION,
};

/** The DSL short name of each, for `base.x`. */
const SHORT = { amplitude: 'a', attack: 'attack', release: 'release', frequency: 'f', duration: 'd' };

const notesOf = (module) => Object.values(module.notes || {});

/** The ids of the notes a note's chosen variables read (the BaseNote is id 0). */
function readsOf(note, vars) {
  const out = new Set();
  for (const v of vars) {
    const refs = getVariableRefs(note, v);
    for (let i = 0; i < refs.length; i++) out.add(refs[i] >> 3);
  }
  return out;
}

/**
 * The notes related to `startId` through the chosen variables, transitively.
 * The start note itself is not in the result.
 *
 * @param {Module} module
 * @param {number} startId
 * @param {'dependents'|'dependencies'} direction  what reads it / what it reads
 * @param {'t'|'d'|'f'|'all'} which  the variable of the reading note that is followed
 * @returns {Set<number>}
 */
export function relatedNoteIds(module, startId, direction, which = 'all') {
  const vars = RELATION_VARS[which];
  if (!vars) throw new Error(`unknown relation "${which}"`);
  const start = Number(startId);
  const result = new Set();
  const queue = [start];
  const seen = new Set([start]);

  if (direction === 'dependencies') {
    while (queue.length) {
      const note = module.getNoteById(queue.shift());
      if (!note) continue;
      for (const id of readsOf(note, vars)) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (id !== 0) { result.add(id); queue.push(id); }
      }
    }
    return result;
  }

  if (direction !== 'dependents') throw new Error(`unknown direction "${direction}"`);
  // Inverse index, built once: id -> the notes whose chosen variables read it
  const readers = new Map();
  for (const note of notesOf(module)) {
    if (Number(note.id) === 0) continue;
    for (const id of readsOf(note, vars)) {
      if (!readers.has(id)) readers.set(id, []);
      readers.get(id).push(Number(note.id));
    }
  }
  while (queue.length) {
    for (const id of readers.get(queue.shift()) || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.add(id);
      queue.push(id);
    }
  }
  return result;
}

/**
 * The selected notes that follow another selected note through `varName`: their
 * value of that variable reads it (directly, or through notes outside the
 * selection), so a change to that note already reaches them.
 *
 * @returns {Set<number>}
 */
export function followersFor(module, ids, varName) {
  const v = GROUP_VARS[varName];
  const selected = new Set([...ids].map(Number));
  const out = new Set();
  for (const id of selected) {
    const queue = [id];
    const seen = new Set([id]);
    let follows = false;
    while (queue.length && !follows) {
      const note = module.getNoteById(queue.shift());
      if (!note) continue;
      const refs = getVariableRefs(note, v);
      for (let i = 0; i < refs.length; i++) {
        if ((refs[i] & 7) !== v) continue;               // only the same variable carries a scale
        const target = refs[i] >> 3;
        if (target === 0 || seen.has(target)) continue;   // the BaseNote is never selected
        if (selected.has(target)) { follows = true; break; }
        seen.add(target);
        queue.push(target);
      }
    }
    if (follows) out.add(id);
  }
  return out;
}

/** Notes a group edit can act on: not the BaseNote, not measure bars. */
function editable(module, ids) {
  const out = [];
  for (const raw of ids) {
    const note = module.getNoteById(Number(raw));
    if (note && Number(note.id) !== 0 && !isMeasureNote(note)) out.push(note);
  }
  return out;
}

/** "3/4", "0.75", "2" as an exact positive Fraction; null when it is not a plain number. */
export function parseRatio(text) {
  const s = String(text ?? '').trim();
  if (!/^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/.test(s)) return null;
  try {
    const r = new Fraction(s.replace(/\s+/g, ''));
    return r.compare(0) > 0 ? r : null;
  } catch { return null; }
}

const ratioText = (r) => (r.d === 1n ? `${r.s * r.n}` : `(${r.s * r.n}/${r.d})`);

/**
 * Multiply each root's value of `varName` by `factorText`: a plain ratio ("3/4")
 * is folded into the expression's coefficient; anything else (2^(1/12)) is
 * written as a factor in front, `(2^(1/12)) * (old)`.
 *
 * @returns {{ changed: number[], followed: number[], skipped: {id:number, reason:string}[] }}
 */
export function scaleGroup(module, ids, varName, factorText) {
  const v = GROUP_VARS[varName];
  if (v === undefined) throw new Error(`cannot scale "${varName}"`);
  const ratio = parseRatio(factorText);
  const factorExpr = ratio ? ratioText(ratio) : `(${String(factorText).trim()})`;
  if (!ratio) validateExpression(module, 0, factorExpr, 'frequency'); // a constant expression, or refuse
  const notes = editable(module, ids);
  const followers = followersFor(module, notes.map((n) => n.id), varName);
  const changed = [], followed = [], skipped = [];
  const writes = [];
  for (const note of notes) {
    const id = Number(note.id);
    if (followers.has(id)) { followed.push(id); continue; }
    const src = note.hasExpression(varName) ? note.getExpressionSource(varName) : null;
    let next;
    if (src) {
      next = ratio
        ? multiplyExpressionByFraction(src, Number(ratio.n), Number(ratio.d), varName, module)
        : `${factorExpr} * (${src})`;
    } else if (v >= FIRST_INTERPRETATION_VAR) {
      // No value of its own: it follows the BaseNote's, else the default
      const base = module.baseNote;
      if (base && base.hasExpression(varName)) next = `${factorExpr} * base.${SHORT[varName]}`;
      else if (varName === 'amplitude') next = factorExpr;            // the default amplitude is 1
      else { skipped.push({ id, reason: "uses the instrument's envelope" }); continue; }
    } else {
      skipped.push({ id, reason: `has no ${varName}` });
      continue;
    }
    try { validateExpression(module, id, next, varName); }
    catch (e) { skipped.push({ id, reason: e.message }); continue; }
    writes.push([note, next]);
  }
  // Write after every new text is computed, so each was folded against the values as they were
  for (const [note, next] of writes) { note.setVariable(varName + 'String', next); changed.push(Number(note.id)); }
  return { changed, followed, skipped };
}

/**
 * Write the same expression to `varName` of every selected note. A note for which
 * the expression would read itself (or close a loop) is skipped and reported.
 */
export function setGroup(module, ids, varName, exprText) {
  if (GROUP_VARS[varName] === undefined) throw new Error(`cannot set "${varName}"`);
  const text = String(exprText ?? '').trim();
  const changed = [], skipped = [];
  const writes = [];
  for (const note of editable(module, ids)) {
    const id = Number(note.id);
    try { writes.push([note, validateExpression(module, id, text, varName)]); }
    catch (e) { skipped.push({ id, reason: e.message }); }
  }
  for (const [note, next] of writes) { note.setVariable(varName + 'String', next); changed.push(Number(note.id)); }
  return { changed, followed: [], skipped };
}

/** Remove the notes' own amplitude, attack or release, so each inherits again. */
export function inheritGroup(module, ids, varName) {
  const v = GROUP_VARS[varName];
  if (v === undefined || v < FIRST_INTERPRETATION_VAR) throw new Error(`"${varName}" does not inherit`);
  const changed = [], skipped = [];
  for (const note of editable(module, ids)) {
    if (note.clearExpression(varName)) changed.push(Number(note.id));
    else skipped.push({ id: Number(note.id), reason: 'already inherits' });
  }
  return { changed, followed: [], skipped };
}

/** Set (or, with null, remove) the instrument or the colour of every selected note. */
export function setGroupProperty(module, ids, key, value) {
  if (key !== 'instrument' && key !== 'color') throw new Error(`cannot set "${key}"`);
  const changed = [];
  for (const note of editable(module, ids)) {
    if (value == null) note.properties[key] = null;
    else note.setVariable(key, value);
    try { module.markNoteDirty?.(note.id); } catch {}
    changed.push(Number(note.id));
  }
  return { changed, followed: [], skipped: [] };
}
