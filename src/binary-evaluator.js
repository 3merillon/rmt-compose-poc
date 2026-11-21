/**
 * Stack-based Binary Expression Evaluator
 *
 * Evaluates binary bytecode expressions using a stack machine with pooled Fraction instances
 * to minimize garbage collection during high-frequency operations like dragging.
 */

import Fraction from 'fraction.js';
import { OP, VAR, VAR_NAMES, FIRST_INTERPRETATION_VAR, getCorruptionFlag } from './binary-note.js';
import {
  getVariableExpression,
  getVariableRefs,
  definesVariable,
  resolveVariableRef,
  findVariableCycle,
  describeVariable,
} from './variable-deps.js';
import * as X from './value/exact.js';

// Order in which a note's variables are visited when nothing forces another
// one. Dependencies are pulled in ahead on demand, so this only breaks ties.
const VAR_ORDER = [
  VAR.FREQUENCY, VAR.START_TIME, VAR.DURATION,
  VAR.AMPLITUDE, VAR.ATTACK, VAR.RELEASE,
];

// What a reference evaluates to when nothing defines the variable it names,
// indexed by VAR: startTime, duration, frequency, amplitude, attack, release.
const UNRESOLVED_DEFAULTS = [0, 1, 440, 1, 0, 0];

// Longest list of cycles / unresolved references written to the console
const MAX_REPORTED_PROBLEMS = 10;

function createEvaluationRecord() {
  return {
    startTime: null,
    duration: null,
    frequency: null,
    // The interpretation variables stay null when the note does not define
    // them: readers fall back to the BaseNote's, then to the default
    // (amplitude 1, see Module.findAmplitude; attack and release the
    // instrument's own envelope).
    amplitude: null,
    attack: null,
    release: null,
    // Bit per variable (1 << VAR index): the variable's own expression made an
    // irrational value (a power such as 2^(1/12)) or an approximation (a
    // division by zero, a fallback of the exact algebra). Inherited values are
    // reported transitively by the dependency graph, not here.
    corruptionFlags: 0,
    // Bit per variable: its value is approximate (src/value/exact.js), own or inherited.
    approxFlags: 0,
    // The exact value of each variable that is not rational: { frequency: Irrational|Approx, ... }.
    // The fields above then hold a Fraction shadow (the nearest double) for the
    // code that reads Fractions; evaluation itself reads these.
    exact: null,
  };
}

const VAR_FIELDS = ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release'];

/** What a reference to this variable of a record reads: the exact value, else the Fraction. */
export function recordValue(rec, varIdx) {
  const name = VAR_FIELDS[varIdx];
  if (name === undefined || !rec) return null;
  const ex = rec.exact;
  if (ex) {
    const v = ex[name];
    if (v != null) return v;
  }
  return rec[name];
}

/** The exact value of a record's variable by name (Fraction, Irrational or Approx), or null. */
export function exactValue(rec, name) {
  if (!rec) return null;
  const v = rec.exact && rec.exact[name];
  return v != null ? v : (rec[name] ?? null);
}

/** A pooled stack Fraction copied out of the pool, so an exact value can keep it. */
const own = (v) => (v.kind === undefined ? new Fraction(v.s * v.n, v.d) : v);

/**
 * The most Fractions the pool keeps. A pass of evaluateDirty() resets the pool
 * before each variable (see _poolPerVariable), so it needs only what one
 * expression takes; this bounds callers of evaluate() outside a pass. An
 * unbounded pool reset once per pass grew to the pass's size and kept it:
 * 2,097,149 Fractions, each holding its last BigInts, after evaluating 100,000
 * notes. Past the cap a Fraction is made and not kept: never handed out twice,
 * so it is as safe as a pooled one.
 */
const POOL_MAX = 4096;

/**
 * Fraction object pool to reduce GC pressure
 */
class FractionPool {
  constructor(size = 128) {
    this.pool = [];
    this.index = 0;

    // Pre-allocate pool
    for (let i = 0; i < size; i++) {
      this.pool.push(new Fraction(0));
    }
  }

  /**
   * Get a Fraction from the pool, initializing with given values.
   * Fields are ALWAYS written as BigInt — fraction.js 5.x is BigInt-backed
   * and mixed Number/BigInt fields throw on the next arithmetic op.
   * @param {bigint|number} n
   * @param {bigint|number} d
   */
  alloc(n = 0n, d = 1n) {
    if (this.index >= this.pool.length && this.pool.length < POOL_MAX) {
      // Expand pool if needed, up to POOL_MAX
      const newSize = Math.min(this.pool.length * 2, POOL_MAX);
      for (let i = this.pool.length; i < newSize; i++) {
        this.pool.push(new Fraction(0));
      }
    }

    const f = this.index < this.pool.length ? this.pool[this.index] : new Fraction(0);
    this.index++;
    let nn = typeof n === 'bigint' ? n : BigInt(n);
    let dd = typeof d === 'bigint' ? d : BigInt(d);
    if (dd < 0n) {
      nn = -nn;
      dd = -dd;
    }
    // Note: fraction.js stores {s: sign, n: magnitude, d: denominator}
    f.s = nn < 0n ? -1n : 1n;
    f.n = nn < 0n ? -nn : nn;
    f.d = dd;
    return f;
  }

  /**
   * Create a Fraction from an existing Fraction (copy).
   * Tolerates duck-typed {s,n,d} values with Number fields (e.g. from the
   * older callers) by coercing them to BigInt.
   */
  allocFrom(frac) {
    if (typeof frac.n === 'bigint') {
      const f = this.alloc(0n, 1n);
      f.s = frac.s < 0n ? -1n : 1n;
      f.n = frac.n < 0n ? -frac.n : frac.n;
      f.d = frac.d;
      return f;
    }
    // Number-backed duck value: round defensively (BigInt throws on
    // non-integer doubles) — such values are quantized approximations anyway.
    return this.alloc(BigInt(Math.round(frac.s * frac.n)), BigInt(Math.round(frac.d)));
  }

  /**
   * Reset pool index for next evaluation batch
   * Call this at the start of a new evaluation cycle
   */
  reset() {
    this.index = 0;
  }

  /**
   * Get current usage stats
   */
  stats() {
    return {
      used: this.index,
      total: this.pool.length,
      utilization: (this.index / this.pool.length * 100).toFixed(1) + '%'
    };
  }
}

/**
 * Stack-based evaluator for binary expressions
 */
export class BinaryEvaluator {
  constructor(module) {
    this.module = module;

    // Evaluation stack
    this.stack = new Array(32);
    this.stackTop = 0;

    // Fraction pool for allocation-free evaluation
    this.pool = new FractionPool(256);
    // True for the length of a pass of IncrementalEvaluator.evaluateDirty(),
    // which begins with a reset of the pool anyway: evaluateVariable() then
    // resets it before each variable, because it copies its value out of the
    // pool before it returns and nothing else of the pass keeps a pooled one
    this._poolPerVariable = false;

    // Generation counter for cache management
    this.generation = 0;

    // Evaluation cache: noteId -> { startTime, duration, frequency, ... }
    this.cache = new Map();

    // Track if the last evaluation produced an irrational value (corruption)
    // This is set during evaluate() when a POW operation produces an irrational result
    this._lastEvalWasCorrupted = false;
    // The exact value of the last evaluate() when it was not rational (src/value/exact.js)
    this._lastExact = null;

    // References the last evaluate() could not resolve and replaced with a
    // hard-coded default: packed (noteId << 3) | varIndex, or null when none
    this._lastEvalUnresolved = null;

    // Unresolved references collected per variable until reportProblems()
    this._unresolved = null;
  }

  /**
   * Set the module reference
   */
  setModule(module) {
    this.module = module;
    this.invalidateAll();
  }

  /**
   * Invalidate all cached evaluations
   */
  invalidateAll() {
    this.cache.clear();
    this.generation++;
  }

  /**
   * Invalidate cache for a specific note and its dependents
   */
  invalidate(noteId) {
    this.cache.delete(noteId);
    this.generation++;
  }

  /**
   * Prepare for a new evaluation batch
   */
  beginBatch() {
    this.pool.reset();
  }

  /**
   * Read a 16-bit unsigned integer from bytecode (big-endian)
   */
  readUint16(bytecode, offset) {
    return (bytecode[offset] << 8) | bytecode[offset + 1];
  }

  /**
   * Read a 32-bit unsigned integer from bytecode (big-endian)
   */
  readUint32(bytecode, offset) {
    return ((bytecode[offset] << 24) |
            (bytecode[offset + 1] << 16) |
            (bytecode[offset + 2] << 8) |
            bytecode[offset + 3]) >>> 0;
  }

  /**
   * Read a 32-bit signed integer from bytecode (big-endian)
   */
  readInt32(bytecode, offset) {
    const val = (bytecode[offset] << 24) |
                (bytecode[offset + 1] << 16) |
                (bytecode[offset + 2] << 8) |
                bytecode[offset + 3];
    // Convert to signed
    return val | 0;
  }

  /**
   * Read a signed BigInt from bytecode
   * Format: [sign(1)] [len(2)] [bytes(n)]
   * @returns {{ value: bigint, bytesRead: number }}
   */
  readBigIntSigned(bytecode, offset) {
    const sign = bytecode[offset];
    const { value: magnitude, bytesRead: magBytes } = this.readBigIntUnsigned(bytecode, offset + 1);
    const value = sign === 0x01 ? -magnitude : magnitude;
    return { value, bytesRead: 1 + magBytes };
  }

  /**
   * Read an unsigned BigInt from bytecode
   * Format: [len(2)] [bytes(n)]
   * @returns {{ value: bigint, bytesRead: number }}
   */
  readBigIntUnsigned(bytecode, offset) {
    const len = (bytecode[offset] << 8) | bytecode[offset + 1];
    let value = 0n;
    for (let i = 0; i < len; i++) {
      value = (value << 8n) | BigInt(bytecode[offset + 2 + i]);
    }
    return { value, bytesRead: 2 + len };
  }

  /**
   * Push a value onto the evaluation stack
   */
  push(value) {
    if (this.stackTop >= this.stack.length) {
      // Expand stack if needed
      const newStack = new Array(this.stack.length * 2);
      for (let i = 0; i < this.stackTop; i++) {
        newStack[i] = this.stack[i];
      }
      this.stack = newStack;
    }
    this.stack[this.stackTop++] = value;
  }

  /**
   * Pop a value from the evaluation stack
   */
  pop() {
    if (this.stackTop === 0) {
      throw new Error('Stack underflow in binary evaluator');
    }
    return this.stack[--this.stackTop];
  }

  /**
   * Peek at the top of the stack without removing
   */
  peek() {
    if (this.stackTop === 0) {
      throw new Error('Stack empty in binary evaluator');
    }
    return this.stack[this.stackTop - 1];
  }

  /**
   * The module's note with this id, or null
   */
  lookupNote(noteId) {
    const module = this.module;
    if (!module || typeof module.getNoteById !== 'function') return null;
    return module.getNoteById(noteId) || null;
  }

  /**
   * Nothing defines the referenced variable: push its hard-coded default and
   * remember the reference, so whoever asked for the evaluation can name it.
   */
  pushDefault(noteId, varIdx) {
    if (varIdx === VAR.AMPLITUDE && this.amplitudeIsUnset(noteId)) {
      this.push(this.pool.alloc(1, 1));
      return;
    }
    if (this._lastEvalUnresolved === null) this._lastEvalUnresolved = [];
    this._lastEvalUnresolved.push((noteId << 3) | varIdx);
    this.push(this.pool.alloc(UNRESOLVED_DEFAULTS[varIdx] || 0, 1));
  }

  /**
   * Whether a missing amplitude is simply the default: the note exists and
   * neither it nor the BaseNote sets one. Such a note sounds at 1, and that 1
   * is the variable's value, not a stand-in. (A note that does not exist, or
   * an amplitude that is set but lost to a cycle or a failed evaluation, is
   * an unresolved reference like any other.)
   */
  amplitudeIsUnset(noteId) {
    const note = this.lookupNote(noteId);
    if (!note || definesVariable(note, VAR.AMPLITUDE)) return false;
    const base = noteId === 0 ? note : this.lookupNote(0);
    return !(base && definesVariable(base, VAR.AMPLITUDE));
  }

  /**
   * Get cached value for a note variable, or null if not cached
   */
  getCachedValue(noteId, varIndex) {
    const cached = this.cache.get(noteId);
    if (!cached) return null;
    return recordValue(cached, varIndex);
  }

  /**
   * Push a value read from a record or computed by src/value/exact.js: a
   * Fraction goes through the pool, an exact value (immutable) as it is.
   */
  pushValue(v) {
    if (v.kind === undefined) this.push(this.pool.allocFrom(v));
    else this.push(v);
  }

  /**
   * Push the result of an operation on exact values. An approximation the
   * operation made itself (not one it inherited from an operand) flags the
   * evaluation, like an irrational power does.
   */
  pushResult(v, a, b) {
    if (v.kind === 'approx' && a.kind !== 'approx' && (b === undefined || b.kind !== 'approx')) {
      this._lastEvalWasCorrupted = true;
    }
    this.pushValue(v);
  }

  /**
   * Evaluate a binary expression
   *
   * @param {BinaryExpression} expr - The expression to evaluate
   * @param {Map} evalCache - Pre-evaluated note values (noteId -> {startTime, duration, ...})
   * @returns {Fraction} - The evaluated result
   */
  evaluate(expr, evalCache = null) {
    // Reset corruption flag for this evaluation
    this._lastEvalWasCorrupted = false;
    // The exact value of the last evaluate() when it was not rational (src/value/exact.js)
    this._lastExact = null;
    this._lastEvalUnresolved = null;
    this._lastExact = null;

    if (expr.isEmpty()) {
      return this.pool.alloc(0, 1);
    }

    this.stackTop = 0;
    const bytecode = expr.bytecode;
    let pc = 0;

    while (pc < expr.length) {
      const op = bytecode[pc++];

      switch (op) {
        case OP.LOAD_CONST: {
          // Read 32-bit numerator and denominator
          const num = this.readInt32(bytecode, pc);
          pc += 4;
          const den = this.readInt32(bytecode, pc);
          pc += 4;
          this.push(this.pool.alloc(num, den));
          break;
        }

        case OP.LOAD_CONST_BIG: {
          // Read signed numerator (variable length)
          const { value: numBig, bytesRead: numBytes } = this.readBigIntSigned(bytecode, pc);
          pc += numBytes;
          // Read unsigned denominator (variable length)
          const { value: denBig, bytesRead: denBytes } = this.readBigIntUnsigned(bytecode, pc);
          pc += denBytes;
          // Push the exact BigInt pair straight into the pool — no Fraction
          // construction, no precision loss at any magnitude.
          this.push(this.pool.alloc(numBig, denBig));
          break;
        }

        case OP.LOAD_REF:
        case OP.LOAD_REF_WIDE: {
          // Read note ID (2 bytes, or 4 above 65535) and variable index
          let noteId;
          if (op === OP.LOAD_REF) {
            noteId = this.readUint16(bytecode, pc);
            pc += 2;
          } else {
            noteId = this.readUint32(bytecode, pc);
            pc += 4;
          }
          const varIdx = bytecode[pc++];

          // Look up in evaluation cache
          let value = null;
          if (evalCache) {
            const cached = evalCache.get(noteId);
            if (cached) value = recordValue(cached, varIdx);
          }

          if (!value) {
            // Fallback: check internal cache
            value = this.getCachedValue(noteId, varIdx);
          }

          // Interpretation variables (amplitude, attack, release) fall back to
          // the BaseNote's when the target note has none. Time and pitch never do.
          if (!value && varIdx >= FIRST_INTERPRETATION_VAR) {
            // Try base note (ID 0)
            if (evalCache) {
              const baseCache = evalCache.get(0);
              if (baseCache) value = recordValue(baseCache, varIdx);
            }
            if (!value) {
              value = this.getCachedValue(0, varIdx);
            }
          }

          if (!value) {
            // Return a default value instead of throwing - this allows
            // graceful degradation when expressions can't be fully resolved
            this.pushDefault(noteId, varIdx);
          } else {
            // A Fraction is copied into the pool; an exact value is immutable
            this.pushValue(value);
          }
          break;
        }

        case OP.LOAD_BASE: {
          // Load from base note
          const varIdx = bytecode[pc++];

          let value = null;
          if (evalCache) {
            const cached = evalCache.get(0); // Base note is ID 0
            if (cached) value = recordValue(cached, varIdx);
          }

          if (!value) {
            value = this.getCachedValue(0, varIdx);
          }

          if (!value) {
            // Return sensible defaults for base note variables
            this.pushDefault(0, varIdx);
          } else {
            this.pushValue(value);
          }
          break;
        }

        case OP.ADD: {
          const b = this.pop();
          const a = this.pop();
          if (a.kind === undefined && b.kind === undefined) {
            this.push(this.pool.allocFrom(a.add(b)));
          } else {
            this.pushResult(X.add(own(a), own(b)), a, b);
          }
          break;
        }

        case OP.SUB: {
          const b = this.pop();
          const a = this.pop();
          if (a.kind === undefined && b.kind === undefined) {
            this.push(this.pool.allocFrom(a.sub(b)));
          } else {
            this.pushResult(X.sub(own(a), own(b)), a, b);
          }
          break;
        }

        case OP.MUL: {
          const b = this.pop();
          const a = this.pop();
          if (a.kind === undefined && b.kind === undefined) {
            this.push(this.pool.allocFrom(a.mul(b)));
          } else {
            this.pushResult(X.mul(own(a), own(b)), a, b);
          }
          break;
        }

        case OP.DIV: {
          const b = this.pop();
          const a = this.pop();
          if (X.isZero(b)) {
            console.warn('Division by zero in binary evaluator, using 1');
            // The substituted 1 is not the expression's value: it is
            // approximate, and flags the note like an irrational power does.
            this._lastEvalWasCorrupted = true;
            this.push(new X.Approx(new Fraction(1)));
          } else if (a.kind === undefined && b.kind === undefined) {
            this.push(this.pool.allocFrom(a.div(b)));
          } else {
            this.pushResult(X.div(own(a), own(b)), a, b);
          }
          break;
        }

        case OP.NEG: {
          const a = this.pop();
          if (a.kind === undefined) this.push(this.pool.allocFrom(a.neg()));
          else this.pushValue(X.neg(a));
          break;
        }

        case OP.POW: {
          // Exact: 2^(1/12) stays 2^(1/12) (src/value/exact.js). A power that
          // is not rational flags the evaluation (the note is tempered); an
          // approximation it had to make flags it too.
          const exp = this.pop();
          const base = this.pop();
          const result = X.pow(own(base), own(exp));
          if (result.kind === 'irrational') this._lastEvalWasCorrupted = true;
          this.pushResult(result, base, exp);
          break;
        }

        case OP.APPROX: {
          // `~261.63`: an approximate number. It flags the evaluation like an
          // irrational power does (the note is not exact), and everything
          // computed from it is approximate.
          const v = this.pop();
          this._lastEvalWasCorrupted = true;
          this.push(new X.Approx(X.shadow(own(v))));
          break;
        }

        case OP.DUP: {
          const top = this.peek();
          this.push(this.pool.allocFrom(top));
          break;
        }

        case OP.SWAP: {
          const a = this.pop();
          const b = this.pop();
          this.push(a);
          this.push(b);
          break;
        }

        default:
          throw new Error(`Unknown opcode: 0x${op.toString(16)} at pc=${pc - 1}`);
      }
    }

    if (this.stackTop !== 1) {
      console.warn(`Stack has ${this.stackTop} items after evaluation, expected 1`);
    }

    if (this.stackTop === 0) return this.pool.alloc(0, 1);
    const result = this.pop();
    if (result.kind === undefined) return result;
    // Not rational: the exact value stays available as _lastExact, the caller
    // gets its Fraction shadow (the nearest double, or the approximation)
    this._lastExact = result;
    return this.pool.allocFrom(X.shadow(result));
  }

  /**
   * Evaluate a note and cache the results
   *
   * The note's variables are evaluated in dependency order, so a variable may
   * read another variable of the same note (a start from its own duration, an
   * attack from its own release). Everything it reads from OTHER
   * notes must already be in `evalCache` (or in this evaluator's own cache).
   *
   * @param {Note|BinaryNote} note - The note to evaluate (supports both Note and BinaryNote)
   * @param {Map} evalCache - Pre-evaluated dependencies
   * @returns {Object} - Evaluated values { startTime, duration, frequency, ... }
   */
  evaluateNote(note, evalCache = null) {
    const result = createEvaluationRecord();

    // A variable must never read what this note evaluated to last time
    this.cache.delete(note.id);

    // Expressions within the same note may reference each other, so the cache
    // must contain this note's in-progress result during evaluation. Write it
    // into the shared cache directly instead of copying the whole cache per
    // note (the copy made every full evaluation O(N²)).
    const workingCache = evalCache || new Map();
    workingCache.set(note.id, result);

    this.reportProblems(this.evaluateVariables([note], [result], workingCache));

    // Cache the result
    this.cache.set(note.id, result);

    return result;
  }

  /**
   * Evaluate a group of notes together, one variable at a time, each variable
   * after the variables it reads.
   *
   * The walk is depth-first from every variable in turn (notes in the order
   * given, variables in VAR_ORDER): before a variable is evaluated, whatever
   * it reads inside the group is evaluated first. Variables of notes outside
   * the group are taken from `evalCache` as they are.
   *
   * Variables that read each other in a loop are a true cycle and have no
   * order. The walk finds each such set whole (Tarjan's strongly connected
   * components), evaluates its members in ascending (note, variable) order,
   * and returns one loop per set for reportProblems(). A member read before it
   * is evaluated falls back to a hard-coded default in evaluate(). Because the
   * order inside a set is fixed, the result depends only on the notes, never
   * on which variable the walk happened to reach first.
   *
   * @param {Array<Note|BinaryNote>} notes - The notes to evaluate, in ascending id order
   * @param {Array<Object>} records - records[i] receives notes[i]'s values; it must already be in evalCache
   * @param {Map} evalCache - noteId -> evaluated values
   * @returns {Array<number[]>|null} One loop per cycle, as packed (noteId << 3) | varIndex, or null
   */
  evaluateVariables(notes, records, evalCache) {
    const count = notes.length;

    // Where each note of the group sits in `notes`
    const position = new Map();
    for (let i = 0; i < count; i++) {
      position.set(notes[i].id, i);
    }
    const getNote = (noteId) => {
      const p = position.get(noteId);
      return p !== undefined ? notes[p] : this.lookupNote(noteId);
    };

    // A variable inside the group is (position << 3) | varIndex
    const reached = new Int32Array(count << 3); // when the walk first reached it (1, 2, ...); 0 = not yet
    const lowest = new Int32Array(count << 3);  // earliest still-open variable it leads back to
    const isOpen = new Uint8Array(count << 3);  // reached, not evaluated yet
    const open = [];      // the open variables, in the order they were reached
    const path = [];      // variables waiting on a dependency, outermost first
    const pathRefs = [];  // what each of them reads
    const pathNext = [];  // which of those reads comes next
    let reachedCount = 0;
    let selfReading = null;
    let cycles = null;

    for (let p = 0; p < count; p++) {
      const note = notes[p];

      for (let k = 0; k < VAR_ORDER.length; k++) {
        const varIndex = VAR_ORDER[k];
        const root = (p << 3) | varIndex;
        if (reached[root] !== 0) continue;
        if (!definesVariable(note, varIndex)) {
          reached[root] = ++reachedCount;
          continue;
        }

        let depth = 0;
        path[0] = root;
        pathRefs[0] = getVariableRefs(note, varIndex);
        pathNext[0] = 0;
        reached[root] = lowest[root] = ++reachedCount;
        isOpen[root] = 1;
        open.push(root);

        while (depth >= 0) {
          const current = path[depth];
          const refs = pathRefs[depth];
          let next = pathNext[depth];
          let dependency = -1;

          while (next < refs.length) {
            const ref = refs[next++];
            const refVar = ref & 7;
            let targetPosition = position.get(ref >> 3);
            let candidate;

            if (targetPosition !== undefined && definesVariable(notes[targetPosition], refVar)) {
              candidate = (targetPosition << 3) | refVar;
            } else {
              // A start, duration or frequency of a note outside the group is final
              if (targetPosition === undefined && refVar < FIRST_INTERPRETATION_VAR) continue;
              // Otherwise the read may be inherited from the BaseNote
              const target = resolveVariableRef(getNote, ref);
              if (target < 0) continue; // nothing defines it: evaluate() falls back to the default
              targetPosition = position.get(target >> 3);
              if (targetPosition === undefined) continue;
              candidate = (targetPosition << 3) | (target & 7);
            }

            if (reached[candidate] === 0) {
              dependency = candidate;
              break;
            }
            if (isOpen[candidate] === 1) {
              // Reads a variable that is itself still waiting: they are in a loop
              if (reached[candidate] < lowest[current]) lowest[current] = reached[candidate];
              if (candidate === current) {
                if (selfReading === null) selfReading = new Set();
                selfReading.add(current);
              }
            }
          }
          pathNext[depth] = next;

          if (dependency >= 0) {
            depth++;
            path[depth] = dependency;
            pathRefs[depth] = getVariableRefs(notes[dependency >> 3], dependency & 7);
            pathNext[depth] = 0;
            reached[dependency] = lowest[dependency] = ++reachedCount;
            isOpen[dependency] = 1;
            open.push(dependency);
            continue;
          }

          // Everything `current` reads has been walked. If it leads back to nothing
          // earlier, it closes a set: itself alone, unless it sits in a loop.
          if (lowest[current] === reached[current]) {
            if (open[open.length - 1] === current && (selfReading === null || !selfReading.has(current))) {
              open.pop();
              isOpen[current] = 0;
              this.evaluateVariable(notes[current >> 3], current & 7, records[current >> 3], evalCache);
            } else {
              const members = [];
              let member;
              do {
                member = open.pop();
                isOpen[member] = 0;
                members.push(member);
              } while (member !== current);
              members.sort((a, b) => a - b);

              for (const m of members) {
                this.evaluateVariable(notes[m >> 3], m & 7, records[m >> 3], evalCache);
              }

              // Name one loop through the first member for the report
              const first = (notes[members[0] >> 3].id << 3) | (members[0] & 7);
              if (cycles === null) cycles = [];
              cycles.push(findVariableCycle(getNote, first) || [first]);
            }
          }

          depth--;
          if (depth >= 0 && lowest[current] < lowest[path[depth]]) {
            lowest[path[depth]] = lowest[current];
          }
        }
      }
    }

    return cycles;
  }

  /**
   * Evaluate one variable of a note into the note's record
   *
   * @param {Note|BinaryNote} note
   * @param {number} varIndex - VAR.START_TIME ... VAR.RELEASE
   * @param {Object} record - The note's evaluated values; must already be in evalCache
   * @param {Map} evalCache - noteId -> evaluated values of everything it reads
   */
  evaluateVariable(note, varIndex, record, evalCache) {
    const expr = getVariableExpression(note, varIndex);

    if (expr !== null) {
      try {
        if (this._poolPerVariable) this.pool.reset();
        const pooledValue = this.evaluate(expr, evalCache);
        // IMPORTANT: Create a NEW Fraction for caching, not the pooled one!
        // Pooled fractions get reused when pool.reset() is called, which would
        // corrupt our cached values.
        const value = new Fraction(pooledValue.s * pooledValue.n, pooledValue.d);
        const exact = this._lastExact;
        if (exact !== null) {
          if (record.exact === null) record.exact = {};
          record.exact[VAR_FIELDS[varIndex]] = exact;
          if (exact.kind === 'approx') record.approxFlags |= getCorruptionFlag(varIndex);
        }
        switch (varIndex) {
          case VAR.START_TIME: record.startTime = value; break;
          case VAR.DURATION: record.duration = value; break;
          case VAR.FREQUENCY: record.frequency = value; break;
          case VAR.AMPLITUDE: record.amplitude = value; break;
          case VAR.ATTACK: record.attack = value; break;
          case VAR.RELEASE: record.release = value; break;
        }

        // Check if the evaluation actually produced an irrational value
        // This is set by the POW opcode handler when the result is irrational
        if (this._lastEvalWasCorrupted) {
          record.corruptionFlags |= getCorruptionFlag(varIndex);
        }

        // Keep what it could not resolve, with who was asking, for reportProblems()
        if (this._lastEvalUnresolved !== null) {
          if (this._unresolved === null) this._unresolved = [];
          for (const ref of this._lastEvalUnresolved) {
            this._unresolved.push((note.id << 3) | varIndex, ref);
          }
        }
      } catch (e) {
        console.warn(`Failed to evaluate ${VAR_NAMES[varIndex]} for note ${note.id}:`, e);
      }
    }
  }

  /**
   * Report what the last evaluation could not get right: true dependency
   * cycles, and references that fell back to a hard-coded default. Either way
   * some evaluated values are not what the expressions say, so this is a
   * console error naming every note and variable involved.
   *
   * @param {Array<number[]>|null} cycles - As returned by evaluateVariables()
   */
  reportProblems(cycles) {
    const unresolved = this._unresolved;
    if (cycles === null && unresolved === null) return;
    this._unresolved = null;

    const limit = (lines) => {
      if (lines.length <= MAX_REPORTED_PROBLEMS) return lines;
      const extra = lines.length - MAX_REPORTED_PROBLEMS;
      return lines.slice(0, MAX_REPORTED_PROBLEMS).concat(`… and ${extra} more`);
    };

    if (cycles !== null) {
      const lines = cycles.map((cycle) => cycle.concat(cycle[0]).map(describeVariable).join(' → '));
      console.error(
        'Dependency cycle detected! These variables depend on themselves, ' +
        'so some of their reads fell back to defaults:\n  ' + limit(lines).join('\n  ')
      );
    }

    if (unresolved !== null) {
      const lines = [];
      const seen = new Set();
      for (let i = 0; i < unresolved.length; i += 2) {
        const line = this.describeUnresolved(unresolved[i], unresolved[i + 1]);
        if (!seen.has(line)) {
          seen.add(line);
          lines.push(line);
        }
      }
      console.error(
        'Unresolved reference! A hard-coded default was used instead:\n  ' + limit(lines).join('\n  ')
      );
    }
  }

  /**
   * One line for a reference that fell back to a default: who read what, why
   * it has no value, and the value used.
   *
   * @param {number} reader - Packed variable being evaluated
   * @param {number} ref - Packed variable it referenced
   * @returns {string}
   */
  describeUnresolved(reader, ref) {
    const varIndex = ref & 7;
    const noteId = ref >> 3;
    const name = VAR_NAMES[varIndex];
    const note = this.lookupNote(noteId);

    let reason;
    if (!note) {
      reason = `but note ${noteId} does not exist`;
    } else if (definesVariable(note, varIndex)) {
      reason = 'which has no value because of a dependency cycle or a failed evaluation';
    } else if (noteId === 0) {
      reason = `but the BaseNote has no ${name}`;
    } else if (varIndex >= FIRST_INTERPRETATION_VAR) {
      const base = this.lookupNote(0);
      reason = base && definesVariable(base, varIndex)
        ? `which note ${noteId} inherits from the BaseNote, where it has no value because of a dependency cycle or a failed evaluation`
        : `but neither note ${noteId} nor the BaseNote has a ${name}`;
    } else {
      reason = `but note ${noteId} has no ${name}`;
    }

    return `${describeVariable(reader)} reads ${describeVariable(ref)}, ${reason}` +
           ` (used ${UNRESOLVED_DEFAULTS[varIndex]})`;
  }

  /**
   * Get pool statistics for debugging
   */
  getPoolStats() {
    return this.pool.stats();
  }
}

/**
 * Incremental evaluator that tracks dirty notes and evaluates in dependency order
 */
export class IncrementalEvaluator {
  constructor(module, dependencyGraph, evaluator) {
    this.module = module;
    this.graph = dependencyGraph;
    this.evaluator = evaluator;

    // Set of dirty note IDs needing re-evaluation
    this.dirty = new Set();

    // Cached evaluation results: noteId -> { startTime, duration, frequency, ... }
    this.cache = new Map();

    // Generation counter
    this.generation = 0;
  }

  /**
   * Set the module reference
   */
  setModule(module) {
    this.module = module;
    this.evaluator.setModule(module);
    this.invalidateAll();
  }

  /**
   * Mark a note as dirty (needs re-evaluation)
   *
   * @param {number} noteId
   * @param {Set<number>} [dependents] - graph.getEvaluationDependents(noteId),
   *   when the caller has already computed it
   */
  invalidate(noteId, dependents = null) {
    this.dirty.add(noteId);

    // Also invalidate all dependents, including the ones reached through the
    // BaseNote
    for (const dep of dependents || this.graph.getEvaluationDependents(noteId)) {
      this.dirty.add(dep);
    }

    this.generation++;
  }

  /**
   * Mark a note as dirty WITHOUT re-registration/invalidating its bytecode.
   * Use for dependents whose values changed but bytecode didn't.
   * (module.js calls this
   * for baseNote dependents and batch updates; without it those notes were
   * silently never re-evaluated on the JS path.)
   */
  markDirtyOnly(noteId) {
    this.dirty.add(noteId);
  }

  /**
   * Invalidate all notes
   */
  invalidateAll() {
    this.cache.clear();
    this.dirty.clear();
    this.generation++;

    // Also invalidate the underlying evaluator's cache to prevent stale values
    // being returned during re-evaluation
    this.evaluator.invalidateAll();

    // Mark all notes dirty (supports both Map and Object notes storage)
    if (this.module.notes instanceof Map) {
      for (const [id] of this.module.notes) {
        this.dirty.add(id);
      }
    } else {
      for (const id of Object.keys(this.module.notes)) {
        this.dirty.add(Number(id));
      }
    }
  }

  /**
   * Evaluate all dirty notes, one variable at a time, in dependency order
   *
   * Dirty tracking stays per note, but ordering is per (note, variable): see
   * BinaryEvaluator.evaluateVariables(). Two notes may read each other as long
   * as no variable ends up reading itself.
   *
   * @returns {Map} - Complete evaluation cache
   */
  evaluateDirty() {
    if (this.dirty.size === 0) {
      return this.cache;
    }

    // Reset fraction pool for this batch
    this.evaluator.beginBatch();

    // Ascending ids give the walk a fixed starting order, so the result never
    // depends on the order in which notes happened to be marked dirty.
    const ids = Array.from(this.dirty);
    for (let i = 1; i < ids.length; i++) {
      if (ids[i - 1] > ids[i]) {
        ids.sort((a, b) => a - b);
        break;
      }
    }

    // Every dirty note gets a blank record up front. From here on a variable
    // can read only what this batch has computed or what a clean note holds,
    // never the value a dirty note evaluated to last time.
    const notes = [];
    const records = [];
    for (const noteId of ids) {
      const note = this.module.getNoteById(noteId);
      if (!note) {
        this.cache.delete(noteId);
        continue;
      }
      const record = createEvaluationRecord();
      this.cache.set(noteId, record);
      notes.push(note);
      records.push(record);
    }

    let cycles;
    this.evaluator._poolPerVariable = true;
    try {
      cycles = this.evaluator.evaluateVariables(notes, records, this.cache);
    } finally {
      this.evaluator._poolPerVariable = false;
    }
    this.evaluator.reportProblems(cycles);

    this.dirty.clear();
    return this.cache;
  }

  /**
   * Get evaluation result for a note
   */
  getEvaluatedNote(noteId) {
    return this.cache.get(noteId) || null;
  }

  /**
   * Check if cache is valid (no dirty notes)
   */
  isCacheValid() {
    return this.dirty.size === 0;
  }
}
