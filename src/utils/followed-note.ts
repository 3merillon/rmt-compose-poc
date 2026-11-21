/**
 * The note a moved note FOLLOWS: one that ends exactly where the moved note now
 * starts. The owner's rule (19 November 2026): such a start is written as the
 * relation `[P].t + [P].d`, not as `[Q].t + base.d * k`. Drags snap to sixteenths
 * of base.d, so an end on that grid is reachable by hand.
 *
 * Not followed: the BaseNote, the note itself, measure bars (a bar's end is the
 * next bar's start, which the bar chain already offers), a note without a positive
 * duration, and a note that the new start would put in a dependency cycle. Among
 * several, the note's current start parent wins, then the one that starts latest,
 * then the lowest id. Only for notes written in the DSL.
 */
import type { Module } from '../module.ts';
import type { Note } from '../note.ts';
import { isMeasureNote } from '../note.ts';
import { compiler } from '../expression-compiler.ts';
import { findDependencyCycle } from '../variable-deps.ts';
import { toNumber } from './fraction-num.ts';

// A drop compares the separately converted start and duration used by the snap
// rule. Store only the range of those ends for each occupied block of IDs.
const RANGE_SIZE = 128;
type EndRanges = Map<number, { min: number; max: number }>;
const endRanges = new WeakMap<Module, { revision: number; blocks: EndRanges }>();

function* candidates(module: Module, landing: number, tolerance: number): Generator<number | string> {
  if (typeof module.evaluationChangesSince !== 'function') {
    yield* Object.keys(module.notes);
    return;
  }
  const values = module.getEvaluationCache();
  let index = endRanges.get(module);
  if (!index || index.revision !== module._evaluationRevision) {
    const dirty = index && module.evaluationChangesSince(index.revision);
    const blocks: EndRanges = dirty && index ? index.blocks : new Map();
    const include = (id: number, block: number) => {
      const note = module.notes[id];
      if (!note) return;
      const record = note.module === module ? values.get(note.id) : null;
      const duration = toNumber(record?.duration ?? note.getVariable('duration'), 0);
      if (!(duration > 0)) return;
      const end = toNumber(record?.startTime ?? note.getVariable('startTime'), NaN) + duration;
      if (!Number.isFinite(end)) return;
      const range = blocks.get(block);
      if (range) {
        if (end < range.min) range.min = end;
        if (end > range.max) range.max = end;
      } else blocks.set(block, { min: end, max: end });
    };
    if (dirty) {
      const touched = new Set<number>();
      for (const id of dirty) touched.add(Math.floor(id / RANGE_SIZE));
      for (const block of touched) {
        blocks.delete(block);
        const first = block * RANGE_SIZE;
        for (let id = first; id < first + RANGE_SIZE; id++) include(id, block);
      }
    } else {
      for (const key in module.notes) {
        const id = Number(key);
        // Programmatic callers can supply aliased notes or nonnumeric keys.
        // Such objects have no stable ID block or local evaluation revision.
        if (!Number.isSafeInteger(id) || id < 0 || String(id) !== key ||
            module.notes[key]?.id !== id || module.notes[key].module !== module) {
          endRanges.delete(module);
          yield* Object.keys(module.notes);
          return;
        }
        include(id, Math.floor(id / RANGE_SIZE));
      }
    }
    index = { revision: module._evaluationRevision, blocks };
    endRanges.set(module, index);
  }
  for (const [block, range] of index.blocks) {
    if (range.min - landing > tolerance || landing - range.max > tolerance) continue;
    const first = block * RANGE_SIZE;
    for (let id = first; id < first + RANGE_SIZE; id++) yield id;
  }
}

/** The start expression that follows note `id`. */
export const followExpr = (id: number) => `[${id}].t + [${id}].d`;

/**
 * @param {object} module
 * @param {object} note the note being moved
 * @param {number} newStartSec where it lands (seconds; the snapped gesture position)
 * @param {object|null} [currentParent] the start parent the plain rule would use
 * @returns {object|null} the note to follow, or null
 */
export function findFollowedNote(module: Module, note: Note, newStartSec: number, currentParent: { id: number } | null = null) {
  try {
    if (!module || !note || !Number.isFinite(newStartSec)) return null;
    if (!note?.variables?.startTimeString) return null;
    const tol = 1e-6 * Math.max(1, Math.abs(newStartSec));
    let best = null, bestStart = -Infinity;
    for (const idStr of candidates(module, newStartSec, tol)) {
      const id = Number(idStr);
      if (id === 0 || id === note.id) continue;
      const p = module.notes[idStr];
      if (!p || isMeasureNote(p)) continue;
      const d = p.getVariable('duration'), t = p.getVariable('startTime');
      if (!d || !t) continue;
      const dSec = toNumber(d, 0);
      if (!(dSec > 0)) continue;
      const tSec = toNumber(t, NaN);
      if (!(Math.abs(tSec + dSec - newStartSec) <= tol)) continue;
      let cycle = true;
      try { cycle = findDependencyCycle(module, note.id, 'startTime', compiler.compile(followExpr(id))) !== null; } catch {}
      if (cycle) continue;
      if (currentParent && currentParent.id === id) return p;
      if (tSec > bestStart || (tSec === bestStart && best && id < best.id)) { best = p; bestStart = tSec; }
    }
    return best;
  } catch { return null; }
}
