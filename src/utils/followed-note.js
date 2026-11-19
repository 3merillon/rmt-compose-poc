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
import { isMeasureNote } from '../note.js';
import { isDSLSyntax } from '../dsl/index.js';
import { compiler } from '../expression-compiler.js';
import { findDependencyCycle } from '../variable-deps.js';
import { toNumber } from './fraction-num.js';

/** The start expression that follows note `id`. */
export const followExpr = (id) => `[${id}].t + [${id}].d`;

/**
 * @param {object} module
 * @param {object} note the note being moved
 * @param {number} newStartSec where it lands (seconds; the snapped gesture position)
 * @param {object|null} [currentParent] the start parent the plain rule would use
 * @returns {object|null} the note to follow, or null
 */
export function findFollowedNote(module, note, newStartSec, currentParent = null) {
  try {
    if (!module || !note || !Number.isFinite(newStartSec)) return null;
    if (!isDSLSyntax(note?.variables?.startTimeString || '')) return null;
    const tol = 1e-6 * Math.max(1, Math.abs(newStartSec));
    let best = null, bestStart = -Infinity;
    for (const idStr in module.notes) {
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
