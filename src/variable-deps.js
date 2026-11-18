/**
 * Variable-level dependencies
 *
 * A note has six variables, and an expression reads specific variables of
 * specific notes: `[2].f`, `base.tempo`, `beat([5])`. Evaluation order and
 * cycle checks have to work at that granularity. Note 1's frequency may read
 * note 2's frequency while note 2's start reads note 1's start and duration:
 * between whole notes that is a loop, between variables it is a tree.
 *
 * This module is the single statement of "which variables does (note,
 * variable) read". The evaluator orders by it, the note widget refuses cycles
 * by it, and the dependency graph uses it to know which notes can follow the
 * BaseNote without naming it.
 *
 * A variable is addressed as one integer, (noteId << 3) | varIndex.
 */

import { VAR, VAR_NAMES } from './binary-note.js';

const NO_REFS = [];

/**
 * The compiled expression behind one variable, or null when the note has none.
 * Works for both Note (`note.expressions.startTime`) and BinaryNote
 * (`note.startTime`).
 */
export function getVariableExpression(note, varIndex) {
  const expressions = note.expressions || note;
  let expr;
  // Spelled out per variable: this runs several times for every variable of
  // every evaluated note, and a fixed property name is far cheaper to load
  // than expressions[VAR_NAMES[varIndex]].
  switch (varIndex) {
    case VAR.START_TIME: expr = expressions.startTime; break;
    case VAR.DURATION: expr = expressions.duration; break;
    case VAR.FREQUENCY: expr = expressions.frequency; break;
    case VAR.TEMPO: expr = expressions.tempo; break;
    case VAR.BEATS_PER_MEASURE: expr = expressions.beatsPerMeasure; break;
    case VAR.MEASURE_LENGTH: expr = expressions.measureLength; break;
    default: return null;
  }
  return expr && expr.length > 0 ? expr : null;
}

/**
 * A measure bar or the BaseNote: when it has no measureLength expression the
 * evaluator computes one from beatsPerMeasure and tempo.
 */
export function hasComputedMeasureLength(note) {
  if (note.id === 0) return true;
  return getVariableExpression(note, VAR.START_TIME) !== null &&
         getVariableExpression(note, VAR.DURATION) === null &&
         getVariableExpression(note, VAR.FREQUENCY) === null;
}

/**
 * Whether evaluating `note` produces a value for this variable.
 */
export function definesVariable(note, varIndex) {
  if (!note) return false;
  if (getVariableExpression(note, varIndex) !== null) return true;
  return varIndex === VAR.MEASURE_LENGTH && hasComputedMeasureLength(note);
}

/**
 * What one variable reads, as written: packed (noteId << 3) | varIndex
 * entries, before inheritance is applied. Empty when the note does not define
 * the variable.
 */
export function getVariableRefs(note, varIndex) {
  const expr = getVariableExpression(note, varIndex);
  if (expr !== null) return expr.getVariableRefs();
  if (varIndex === VAR.MEASURE_LENGTH && hasComputedMeasureLength(note)) {
    // Computed as beatsPerMeasure * 60 / tempo, each its own or the BaseNote's
    return [(note.id << 3) | VAR.BEATS_PER_MEASURE, (note.id << 3) | VAR.TEMPO];
  }
  return NO_REFS;
}

/**
 * The variable a reference actually reads, or -1 when nothing defines it.
 *
 * tempo, beatsPerMeasure and measureLength inherit: `[5].tempo` on a note with
 * no tempo of its own reads the BaseNote's. startTime, duration and frequency
 * do not, so a reference to one that is missing resolves to nothing and the
 * evaluator substitutes a hard-coded default.
 *
 * @param {function(number): Object|null} getNote
 * @param {number} ref - Packed (noteId << 3) | varIndex
 * @returns {number} Packed variable, or -1
 */
export function resolveVariableRef(getNote, ref) {
  const varIndex = ref & 7;
  const noteId = ref >> 3;
  if (definesVariable(getNote(noteId), varIndex)) return ref;
  if (varIndex >= VAR.TEMPO && noteId !== 0 && definesVariable(getNote(0), varIndex)) {
    return varIndex; // the BaseNote's, (0 << 3) | varIndex
  }
  return -1;
}

/**
 * Whether a note can depend on the BaseNote without writing `base`: a measure
 * bar's computed measureLength inherits tempo and beatsPerMeasure, and a
 * reference such as `beat([5])` inherits when note 5 has no tempo of its own.
 */
export function inheritsFromBase(note) {
  if (!note || note.id === 0) return false;
  if (hasComputedMeasureLength(note)) return true;
  for (let varIndex = 0; varIndex < 6; varIndex++) {
    const refs = getVariableRefs(note, varIndex);
    for (let i = 0; i < refs.length; i++) {
      if ((refs[i] & 7) >= VAR.TEMPO && (refs[i] >> 3) !== 0) return true;
    }
  }
  return false;
}

/**
 * Find a dependency cycle through one variable.
 *
 * @param {function(number): Object|null} getNote
 * @param {number} start - Packed variable to test
 * @returns {number[]|null} The loop as packed variables, each reading the
 *   next and the last reading the first; null when `start` does not depend on
 *   itself. A direct self-reference returns [start].
 */
export function findVariableCycle(getNote, start) {
  const startNote = getNote(start >> 3);
  if (!startNote) return null;

  // Depth-first over what `start` reads, keeping the path so the loop can be named
  const visited = new Set([start]);
  const path = [start];
  const pathRefs = [getVariableRefs(startNote, start & 7)];
  const pathNext = [0];

  while (path.length > 0) {
    const depth = path.length - 1;
    const refs = pathRefs[depth];
    if (pathNext[depth] >= refs.length) {
      path.pop();
      pathRefs.pop();
      pathNext.pop();
      continue;
    }

    const target = resolveVariableRef(getNote, refs[pathNext[depth]++]);
    if (target < 0) continue;
    if (target === start) return path.slice();
    if (visited.has(target)) continue;

    visited.add(target);
    path.push(target);
    pathRefs.push(getVariableRefs(getNote(target >> 3), target & 7));
    pathNext.push(0);
  }

  return null;
}

/**
 * The cycle that giving one variable a new expression would create, if any.
 * Nothing is changed: the notes are read as if the variable already had it.
 *
 * @param {function(number): Object|null} getNote
 * @param {number} noteId - Note being edited
 * @param {number} varIndex - Variable being edited
 * @param {BinaryExpression} expr - The compiled candidate expression
 * @returns {number[]|null} See findVariableCycle()
 */
export function findCycleIfAssigned(getNote, noteId, varIndex, expr) {
  const current = getNote(noteId);
  const expressions = {};
  for (let i = 0; i < 6; i++) {
    expressions[VAR_NAMES[i]] = i === varIndex ? expr : (current ? getVariableExpression(current, i) : null);
  }
  const edited = { id: noteId, expressions };
  return findVariableCycle(
    (id) => (id === noteId ? edited : getNote(id)),
    (noteId << 3) | varIndex
  );
}

/**
 * The cycle that saving `expr` as one variable of a module's note would
 * create, if any. This is the edit-time form of the check: note and variable
 * come as the widget has them (an id, a variable name).
 *
 * @param {Module} moduleInstance
 * @param {number|string} noteId
 * @param {string} variableName - 'startTime', 'duration', 'frequency', ...
 * @param {BinaryExpression} expr - The compiled candidate expression
 * @returns {number[]|null} See findVariableCycle()
 */
export function findDependencyCycle(moduleInstance, noteId, variableName, expr) {
  let varIndex = -1;
  for (let i = 0; i < 6; i++) {
    if (VAR_NAMES[i] === variableName) varIndex = i;
  }
  // Not one of the six evaluated variables: nothing reads it, so no cycle
  if (varIndex < 0 || !moduleInstance) return null;

  return findCycleIfAssigned(
    (id) => moduleInstance.getNoteById(id) || null,
    Number(noteId),
    varIndex,
    expr
  );
}

/**
 * Human-readable name of a packed variable: `[5].frequency`, `base.tempo`.
 */
export function describeVariable(ref) {
  const noteId = ref >> 3;
  const name = VAR_NAMES[ref & 7] || `variable ${ref & 7}`;
  return noteId === 0 ? `base.${name}` : `[${noteId}].${name}`;
}
