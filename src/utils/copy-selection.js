import Fraction from 'fraction.js';
import { VAR } from '../binary-note.js';
import { parse, tokenize } from '../dsl/index.js';
import { getCanonicalPropertyName } from '../dsl/constants.js';
import { remapNoteIds, rewriteNoteReferences } from '../dsl/remap-note-ids.js';
import { EXPRESSION_VARS, isMeasureNote } from '../note.js';
import { add, compare, div, equals, isRational, isZero, mul, sub } from '../value/exact.js';
import { getVariableRefs } from '../variable-deps.js';
import { valueFactor } from './value-expr.js';

const ZERO = new Fraction(0);

// A self-contained sum such as [P].t + [P].d shifts by exactly one origin.
// Leave these links in their ordinary form for editing and player inheritance.
function startShift(node) {
  if (node.type === 'NoteReference') return Number(node.property === 'startTime' && node.noteId !== 'base' && node.noteId !== 0);
  if (node.type === 'UnaryOp') return -startShift(node.operand);
  if (node.type !== 'BinaryOp') return 0;
  const left = startShift(node.left);
  const right = startShift(node.right);
  if (node.operator === '+') return left + right;
  if (node.operator === '-') return left - right;
  return left === 0 && right === 0 ? 0 : NaN;
}

// A quotient by a symbolic sum can be approximate even when the original
// value is exact. Keep a live factor only if it reconstructs the original.
function scaledValue(value, anchor, ref) {
  if (anchor != null && !isZero(anchor)) {
    if (equals(value, anchor)) return ref;
    const factor = div(value, anchor);
    if (equals(mul(factor, anchor), value)) return ref + ' * ' + valueFactor(factor);
  }
  return valueFactor(value);
}

function copiedExpression(note, key, lookup, origin, baseStart, sourceModule) {
  const source = note.getExpressionSource(key);
  const remapped = remapNoteIds(source, lookup);
  if (remapped == null) return null;
  const refs = note.getExpression(key).getVariableRefs();
  const isStart = key === 'startTime';
  if (isStart && !refs.some(ref => (ref >> 3) !== 0)) return null;
  const readsStart = refs.some(ref => (ref & 7) === VAR.START_TIME);
  if (!isStart && !readsStart) return remapped;
  // A tile initially at zero can later be dropped anywhere. Keep the raw
  // formula only if moving its time origin shifts it by the right amount.
  if (!refs.includes(VAR.START_TIME) && isRational(origin) &&
      startShift(parse(tokenize(source))) === Number(isStart)) return remapped;

  // Read start variables in the source coordinate system before applying
  // arbitrary operations (e.g. twice a start, or a pitch derived from time).
  const translated = rewriteNoteReferences(source, (id, spelling, original) => {
    if (getCanonicalPropertyName(spelling) !== 'startTime') return lookup(id);
    if (id === 0) return valueFactor(baseStart);
    const oldTime = sourceModule.getNoteById(id).getExactVariable('startTime');
    if (oldTime == null) return lookup(id);
    if (!equals(add(sub(oldTime, origin), origin), oldTime)) return valueFactor(oldTime);
    return '(' + remapNoteIds(original, lookup) + ' - base.t + ' + valueFactor(origin) + ')';
  });
  if (!isStart) return translated;
  // Do not let a trailing DSL line comment swallow the closing parenthesis.
  return 'base.t + (' + translated + (source.includes('#') ? '\n' : '') + ') - ' + valueFactor(origin);
}

// A BaseNote field can itself read the selected notes. Keep that live link
// only while its inputs travel intact. In particular, an octave copied from
// an omitted note is rebuilt against base.f; pointing base.f back at that
// octave would create a cycle. Start times are rebased in the new score.
function baseInputsTravel(module, expression, idMap) {
  const pending = [...expression.getVariableRefs()];
  const visited = new Set();
  while (pending.length) {
    const ref = pending.pop();
    if (visited.has(ref)) continue;
    visited.add(ref);
    const id = ref >> 3;
    const variable = ref & 7;
    if (variable === VAR.START_TIME) return false;
    if (id === 0) continue; // Other BaseNote fields are checked independently.
    if (!idMap.has(id)) return false;
    for (const next of getVariableRefs(module.getNoteById(id), variable)) pending.push(next);
  }
  return true;
}

/** A standalone module rooted at the earliest selected timed item. */
export function buildModuleFromSelection(module, ids) {
  const notes = Array.from(new Set(Array.from(ids, Number)), id => module.getNoteById(id))
    .filter(note => note && note.id !== 0);
  if (!notes.length) return null;

  notes.sort((a, b) => {
    const aStart = a.getExactVariable('startTime');
    const bStart = b.getExactVariable('startTime');
    return compare(aStart ?? ZERO, bStart ?? ZERO) || a.id - b.id;
  });
  const firstTimed = notes.find(note => note.hasExpression('startTime'));
  const origin = firstTimed?.getExactVariable('startTime') ?? ZERO;
  const idMap = new Map(notes.map((note, i) => [note.id, i + 1]));
  const lookup = id => id === 0 ? 0 : idMap.get(id);
  const base = module.baseNote;
  const baseStart = base.getExactVariable('startTime') ?? ZERO;
  const unit = base.getExactVariable('duration') ?? module.getTimeUnit();
  const baseFrequency = base.getExactVariable('frequency');
  const baseAmplitude = base.getExactVariable('amplitude') ?? module.findAmplitude(base);

  const baseNote = { startTime: '0' };
  for (const key of EXPRESSION_VARS) {
    if (key === 'startTime' || !base.hasExpression(key)) continue;
    const source = base.getExpressionSource(key);
    baseNote[key] = baseInputsTravel(module, base.getExpression(key), idMap)
      ? remapNoteIds(source, lookup)
      : valueFactor(base.getExactVariable(key));
  }
  if (base.properties.instrument) baseNote.instrument = base.properties.instrument;

  const rows = notes.map(note => {
    const row = { id: idMap.get(note.id) };
    if (isMeasureNote(note)) row.measure = true;
    if (note.properties.color) row.color = note.properties.color;
    if (note.properties.instrument) row.instrument = note.properties.instrument;

    for (const key of EXPRESSION_VARS) {
      if (!note.hasExpression(key)) continue;
      const portable = copiedExpression(note, key, lookup, origin, baseStart, module);
      if (portable != null) {
        row[key] = portable;
        continue;
      }

      const value = note.getExactVariable(key);
      switch (key) {
        case 'startTime': {
          const offset = sub(value, origin);
          row[key] = isZero(offset) ? 'base.t' : 'base.t + ' + scaledValue(offset, unit, 'base.d');
          break;
        }
        case 'duration': row[key] = scaledValue(value, unit, 'base.d'); break;
        case 'frequency': row[key] = scaledValue(value, baseFrequency, 'base.f'); break;
        case 'amplitude': row[key] = scaledValue(value, baseAmplitude, 'base.a'); break;
        default: row[key] = valueFactor(value); break; // attack or release
      }
    }
    return row;
  });
  return { baseNote, notes: rows };
}
