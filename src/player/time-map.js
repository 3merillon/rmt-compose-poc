/**
 * Score time and clock time for one playback.
 *
 * Score time is the notation's: seconds as the module's t and d evaluate them
 * (the BaseNote's duration is the time unit), counted from the playback's start.
 * Clock time is the audio clock's, counted from the same start. Live tempo is a
 * performance setting outside the notation: a rate, in score seconds per clock
 * second (2 plays twice as fast). Frequencies never pass through here.
 *
 * The map is a chain of segments, each holding one rate from a clock instant on.
 * A rate change appends a segment at the instant it takes effect, so everything
 * before that instant keeps the times it already had: nothing that has sounded
 * or been scheduled earlier moves, and the playhead does not jump. A tempo curve
 * (an accelerando drawn over time) can later replace a segment's linear law by
 * its integral; callers only ever use scoreAt() and clockAt().
 */

export const MIN_RATE = 0.1;
export const MAX_RATE = 10;

/** A rate as the engine accepts it: finite, clamped to [MIN_RATE, MAX_RATE]; else 1. */
export function clampRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return r < MIN_RATE ? MIN_RATE : (r > MAX_RATE ? MAX_RATE : r);
}

export class TimeMap {
  /** @param {number} rate score seconds per clock second from clock 0 on */
  constructor(rate = 1) {
    /** @type {{c:number, s:number, rate:number}[]} sorted by c (and so by s) */
    this.segs = [{ c: 0, s: 0, rate: clampRate(rate) }];
  }

  /** The rate in force from the last change on. */
  get rate() { return this.segs[this.segs.length - 1].rate; }

  /** Score time at clock time c. Before 0, the first segment's law extends back. */
  scoreAt(c) {
    const segs = this.segs;
    let i = segs.length - 1;
    while (i > 0 && segs[i].c > c) i--;
    const g = segs[i];
    return g.s + (c - g.c) * g.rate;
  }

  /** Clock time at score time s (the inverse of scoreAt; every rate is > 0). */
  clockAt(s) {
    const segs = this.segs;
    let i = segs.length - 1;
    while (i > 0 && segs[i].s > s) i--;
    const g = segs[i];
    return g.c + (s - g.s) / g.rate;
  }

  /**
   * From clock time c on, play at `rate`. Segments that began at or after c are
   * replaced (a second change before the first took effect supersedes it).
   * @returns {number} the score time at c, where the new rate begins
   */
  setRate(rate, c) {
    const at = Math.max(0, Number(c) || 0);
    const s = this.scoreAt(at);
    while (this.segs.length > 1 && this.segs[this.segs.length - 1].c >= at) this.segs.pop();
    if (this.segs.length === 1 && this.segs[0].c >= at) {
      this.segs[0] = { c: 0, s: 0, rate: clampRate(rate) };
      return 0;
    }
    this.segs.push({ c: at, s, rate: clampRate(rate) });
    return s;
  }
}

/**
 * The tempo a live rate gives a module, and what "Commit tempo" writes.
 *
 * The rate is a float. Writing it into the piece as if it were exact would put a
 * measurement into the notation, so the commit snaps first: to the integer BPM the
 * transport shows, and base.d becomes exactly 60 / that BPM.
 *
 * @param {{n:bigint|number,d:bigint|number}|number} unit the BaseNote's duration (base.d), seconds
 * @param {number} rate live rate
 * @returns {{ notatedBpm:number, liveBpm:number, bpm:number, numerator:bigint, denominator:bigint, text:string }}
 *   bpm: the snapped integer; numerator/denominator: 60 / bpm in lowest terms; text: that fraction as written
 */
export function snapTempo(unit, rate) {
  const d = typeof unit === 'number' ? unit : Number(unit.n) / Number(unit.d);
  const notatedBpm = 60 / d;
  const liveBpm = notatedBpm * clampRate(rate);
  const bpm = Math.max(1, Math.round(liveBpm));
  let n = 60n, m = BigInt(bpm);
  const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
  const g = gcd(n, m);
  n /= g; m /= g;
  return { notatedBpm, liveBpm, bpm, numerator: n, denominator: m, text: m === 1n ? `${n}` : `${n}/${m}` };
}
