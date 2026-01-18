/**
 * Stack-based Binary Expression Evaluator
 *
 * Evaluates binary bytecode expressions using a stack machine with pooled Fraction instances
 * to minimize garbage collection during high-frequency operations like dragging.
 */

import Fraction from 'fraction.js';
import { OP, VAR, getCorruptionFlag } from './binary-note.js';

/**
 * MusicValue wrapper supporting both rational and irrational numbers
 *
 * Enables TET scale support via expressions like 2^(1/12) while preserving
 * exact rational arithmetic when possible.
 */
export class MusicValue {
  /**
   * @param {'rational'|'irrational'} type - Value type
   * @param {Fraction|number} data - Fraction for rational, number for irrational
   */
  constructor(type, data) {
    this.type = type;
    if (type === 'rational') {
      this.fraction = data; // Fraction.js instance
      this.float = null;
    } else {
      this.fraction = null;
      this.float = data; // f64 number
    }
  }

  /**
   * Create a rational value from a Fraction
   */
  static rational(frac) {
    return new MusicValue('rational', frac);
  }

  /**
   * Create an irrational value from a number
   */
  static irrational(f) {
    return new MusicValue('irrational', f);
  }

  /**
   * Create from numerator and denominator
   */
  static fromND(n, d) {
    return MusicValue.rational(new Fraction(n, d));
  }

  /**
   * Check if this value is corrupted (irrational)
   */
  isCorrupted() {
    return this.type === 'irrational';
  }

  /**
   * Convert to f64
   */
  toFloat() {
    return this.type === 'rational'
      ? this.fraction.valueOf()
      : this.float;
  }

  /**
   * Get a Fraction representation (approximates irrational values)
   */
  toFraction() {
    if (this.type === 'rational') {
      return this.fraction;
    }
    // Approximate irrational as fraction
    return new Fraction(this.float);
  }

  /**
   * Get fraction components for compatibility with existing code
   */
  get s() { return this.type === 'rational' ? this.fraction.s : (this.float < 0 ? -1 : this.float > 0 ? 1 : 0); }
  get n() { return this.type === 'rational' ? this.fraction.n : 0; }
  get d() { return this.type === 'rational' ? this.fraction.d : 1; }

  /**
   * Add two values
   */
  add(other) {
    if (this.type === 'rational' && other.type === 'rational') {
      return MusicValue.rational(this.fraction.add(other.fraction));
    }
    return MusicValue.irrational(this.toFloat() + other.toFloat());
  }

  /**
   * Subtract two values
   */
  sub(other) {
    if (this.type === 'rational' && other.type === 'rational') {
      return MusicValue.rational(this.fraction.sub(other.fraction));
    }
    return MusicValue.irrational(this.toFloat() - other.toFloat());
  }

  /**
   * Multiply two values
   */
  mul(other) {
    if (this.type === 'rational' && other.type === 'rational') {
      return MusicValue.rational(this.fraction.mul(other.fraction));
    }
    return MusicValue.irrational(this.toFloat() * other.toFloat());
  }

  /**
   * Divide two values
   */
  div(other) {
    if (this.type === 'rational' && other.type === 'rational') {
      return MusicValue.rational(this.fraction.div(other.fraction));
    }
    const divisor = other.toFloat();
    if (divisor === 0) {
      // Match Fraction behavior: return 1 for division by zero
      return MusicValue.fromND(1, 1);
    }
    return MusicValue.irrational(this.toFloat() / divisor);
  }

  /**
   * Negate the value
   */
  neg() {
    if (this.type === 'rational') {
      return MusicValue.rational(this.fraction.neg());
    }
    return MusicValue.irrational(-this.float);
  }

  /**
   * Power operation - the key to TET support
   * May produce irrational result (corruption)
   */
  pow(exponent) {
    if (this.type === 'rational' && exponent.type === 'rational') {
      const result = tryRationalPower(this.fraction, exponent.fraction);
      if (result) {
        return MusicValue.rational(result);
      }
    }
    return MusicValue.irrational(Math.pow(this.toFloat(), exponent.toFloat()));
  }

  /**
   * Get valueOf for compatibility
   */
  valueOf() {
    return this.toFloat();
  }
}

/**
 * Try to compute base^(num/den) as a rational if possible
 * Returns Fraction if rational, null if irrational
 */
function tryRationalPower(base, exp) {
  const expNum = exp.s * exp.n;
  const expDen = exp.d;

  // Zero exponent: always 1
  if (expNum === 0) {
    return new Fraction(1, 1);
  }

  // Integer exponent: always rational
  if (expDen === 1) {
    return rationalIntPower(base, expNum);
  }

  // Fractional exponent: check for perfect n-th root
  // base^(p/q) = (base^p)^(1/q)
  const basePowered = rationalIntPower(base, expNum);
  return tryPerfectNthRoot(basePowered, expDen);
}

/**
 * Compute base^n for integer n
 */
function rationalIntPower(base, n) {
  if (n === 0) {
    return new Fraction(1, 1);
  }

  const absN = Math.abs(n);
  let result = new Fraction(1, 1);

  // Simple repeated multiplication (could optimize with squaring)
  for (let i = 0; i < absN; i++) {
    result = result.mul(base);
  }

  if (n < 0) {
    return result.inverse();
  }
  return result;
}

/**
 * Check if value has a perfect n-th root that is rational
 * Returns Fraction if perfect root, null otherwise
 */
function tryPerfectNthRoot(value, n) {
  if (n === 0) return null;
  if (n === 1) return value;

  const num = value.s * value.n;
  const den = value.d;

  const numAbs = Math.abs(num);

  const numRoot = integerNthRoot(numAbs, n);
  const denRoot = integerNthRoot(den, n);

  if (numRoot === null || denRoot === null) {
    return null;
  }

  // Verify it's exact
  if (Math.pow(numRoot, n) === numAbs && Math.pow(denRoot, n) === den) {
    // Handle sign: odd roots preserve sign, even roots of negatives are not real
    let sign;
    if (num < 0) {
      if (n % 2 === 1) {
        sign = -1;
      } else {
        return null; // Even root of negative is not real
      }
    } else {
      sign = 1;
    }
    return new Fraction(sign * numRoot, denRoot);
  }

  return null;
}

/**
 * Integer n-th root if exact, null otherwise
 */
function integerNthRoot(value, n) {
  if (value === 0) return 0;
  if (value === 1 || n === 1) return value;

  const root = Math.round(Math.pow(value, 1 / n));

  // Check root and neighbors (floating point might be slightly off)
  for (let candidate = root - 1; candidate <= root + 1; candidate++) {
    if (candidate >= 0 && Math.pow(candidate, n) === value) {
      return candidate;
    }
  }

  return null;
}

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
   * Get a Fraction from the pool, initializing with given values
   */
  alloc(n = 0, d = 1) {
    if (this.index >= this.pool.length) {
      // Expand pool if needed
      const newSize = this.pool.length * 2;
      for (let i = this.pool.length; i < newSize; i++) {
        this.pool.push(new Fraction(0));
      }
    }

    const f = this.pool[this.index++];
    // Reinitialize the Fraction
    // Note: fraction.js stores {s: sign, n: numerator, d: denominator}
    if (d < 0) {
      f.s = n < 0 ? 1 : -1;
      f.n = Math.abs(n);
      f.d = Math.abs(d);
    } else {
      f.s = n < 0 ? -1 : 1;
      f.n = Math.abs(n);
      f.d = d;
    }
    return f;
  }

  /**
   * Create a Fraction from an existing Fraction (copy)
   */
  allocFrom(frac) {
    return this.alloc(frac.s * frac.n, frac.d);
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

    // Generation counter for cache management
    this.generation = 0;

    // Evaluation cache: noteId -> { startTime, duration, frequency, ... }
    this.cache = new Map();
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
   * Get cached value for a note variable, or null if not cached
   */
  getCachedValue(noteId, varIndex) {
    const cached = this.cache.get(noteId);
    if (!cached) return null;

    switch (varIndex) {
      case VAR.START_TIME: return cached.startTime;
      case VAR.DURATION: return cached.duration;
      case VAR.FREQUENCY: return cached.frequency;
      case VAR.TEMPO: return cached.tempo;
      case VAR.BEATS_PER_MEASURE: return cached.beatsPerMeasure;
      case VAR.MEASURE_LENGTH: return cached.measureLength;
      default: return null;
    }
  }

  /**
   * Evaluate a binary expression
   *
   * @param {BinaryExpression} expr - The expression to evaluate
   * @param {Map} evalCache - Pre-evaluated note values (noteId -> {startTime, duration, ...})
   * @returns {Fraction} - The evaluated result
   */
  evaluate(expr, evalCache = null) {
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

        case OP.LOAD_REF: {
          // Read note ID and variable index
          const noteId = this.readUint16(bytecode, pc);
          pc += 2;
          const varIdx = bytecode[pc++];

          // Look up in evaluation cache
          let value = null;
          if (evalCache) {
            const cached = evalCache.get(noteId);
            if (cached) {
              switch (varIdx) {
                case VAR.START_TIME: value = cached.startTime; break;
                case VAR.DURATION: value = cached.duration; break;
                case VAR.FREQUENCY: value = cached.frequency; break;
                case VAR.TEMPO: value = cached.tempo; break;
                case VAR.BEATS_PER_MEASURE: value = cached.beatsPerMeasure; break;
                case VAR.MEASURE_LENGTH: value = cached.measureLength; break;
              }
            }
          }

          if (!value) {
            // Fallback: check internal cache
            value = this.getCachedValue(noteId, varIdx);
          }

          // For inheritable properties (tempo, beatsPerMeasure, measureLength),
          // fall back to base note if not found on the target note
          if (!value && (varIdx === VAR.TEMPO || varIdx === VAR.BEATS_PER_MEASURE || varIdx === VAR.MEASURE_LENGTH)) {
            // Try base note (ID 0)
            if (evalCache) {
              const baseCache = evalCache.get(0);
              if (baseCache) {
                switch (varIdx) {
                  case VAR.TEMPO: value = baseCache.tempo; break;
                  case VAR.BEATS_PER_MEASURE: value = baseCache.beatsPerMeasure; break;
                  case VAR.MEASURE_LENGTH: value = baseCache.measureLength; break;
                }
              }
            }
            if (!value) {
              value = this.getCachedValue(0, varIdx);
            }
          }

          if (!value) {
            // Return a default value instead of throwing - this allows
            // graceful degradation when expressions can't be fully resolved
            // Use sensible defaults
            switch (varIdx) {
              case VAR.START_TIME: this.push(this.pool.alloc(0, 1)); break;
              case VAR.DURATION: this.push(this.pool.alloc(1, 1)); break;
              case VAR.FREQUENCY: this.push(this.pool.alloc(440, 1)); break;
              case VAR.TEMPO: this.push(this.pool.alloc(60, 1)); break;
              case VAR.BEATS_PER_MEASURE: this.push(this.pool.alloc(4, 1)); break;
              case VAR.MEASURE_LENGTH: this.push(this.pool.alloc(4, 1)); break;
              default: this.push(this.pool.alloc(0, 1));
            }
          } else {
            // Push a copy to avoid mutation issues
            this.push(this.pool.allocFrom(value));
          }
          break;
        }

        case OP.LOAD_BASE: {
          // Load from base note
          const varIdx = bytecode[pc++];

          let value = null;
          if (evalCache) {
            const cached = evalCache.get(0); // Base note is ID 0
            if (cached) {
              switch (varIdx) {
                case VAR.START_TIME: value = cached.startTime; break;
                case VAR.DURATION: value = cached.duration; break;
                case VAR.FREQUENCY: value = cached.frequency; break;
                case VAR.TEMPO: value = cached.tempo; break;
                case VAR.BEATS_PER_MEASURE: value = cached.beatsPerMeasure; break;
                case VAR.MEASURE_LENGTH: value = cached.measureLength; break;
              }
            }
          }

          if (!value) {
            value = this.getCachedValue(0, varIdx);
          }

          if (!value) {
            // Return sensible defaults for base note variables
            switch (varIdx) {
              case VAR.START_TIME: this.push(this.pool.alloc(0, 1)); break;
              case VAR.DURATION: this.push(this.pool.alloc(1, 1)); break;
              case VAR.FREQUENCY: this.push(this.pool.alloc(440, 1)); break;
              case VAR.TEMPO: this.push(this.pool.alloc(60, 1)); break;
              case VAR.BEATS_PER_MEASURE: this.push(this.pool.alloc(4, 1)); break;
              case VAR.MEASURE_LENGTH: this.push(this.pool.alloc(4, 1)); break;
              default: this.push(this.pool.alloc(0, 1));
            }
          } else {
            this.push(this.pool.allocFrom(value));
          }
          break;
        }

        case OP.ADD: {
          const b = this.pop();
          const a = this.pop();
          const result = a.add(b);
          this.push(this.pool.allocFrom(result));
          break;
        }

        case OP.SUB: {
          const b = this.pop();
          const a = this.pop();
          const result = a.sub(b);
          this.push(this.pool.allocFrom(result));
          break;
        }

        case OP.MUL: {
          const b = this.pop();
          const a = this.pop();
          const result = a.mul(b);
          this.push(this.pool.allocFrom(result));
          break;
        }

        case OP.DIV: {
          const b = this.pop();
          const a = this.pop();
          // Check for division by zero
          if (b.n === 0) {
            console.warn('Division by zero in binary evaluator, using 1');
            this.push(this.pool.alloc(1, 1));
          } else {
            const result = a.div(b);
            this.push(this.pool.allocFrom(result));
          }
          break;
        }

        case OP.NEG: {
          const a = this.pop();
          const result = a.neg();
          this.push(this.pool.allocFrom(result));
          break;
        }

        case OP.POW: {
          // Power operation for TET support
          // Note: This is handled by the WASM evaluator in most cases,
          // but we implement it here for completeness and fallback
          const exp = this.pop();
          const base = this.pop();

          // Convert to MusicValue for power calculation
          const baseValue = MusicValue.rational(new Fraction(base.s * base.n, base.d));
          const expValue = MusicValue.rational(new Fraction(exp.s * exp.n, exp.d));
          const powResult = baseValue.pow(expValue);

          // Convert back to pooled Fraction
          // Note: If the result is irrational, we lose the corruption flag here
          // The WASM evaluator handles corruption tracking properly
          if (powResult.isCorrupted()) {
            // Approximate as fraction
            const frac = new Fraction(powResult.toFloat());
            this.push(this.pool.alloc(frac.s * frac.n, frac.d));
          } else {
            const frac = powResult.fraction;
            this.push(this.pool.alloc(frac.s * frac.n, frac.d));
          }
          break;
        }

        case OP.FIND_TEMPO: {
          // Find tempo for a note (walks parent chain)
          const noteRef = this.pop();
          // For now, use base note tempo (most notes inherit from base)
          let tempoValue = null;
          if (evalCache) {
            const baseCache = evalCache.get(0);
            if (baseCache) tempoValue = baseCache.tempo;
          }
          if (!tempoValue) {
            tempoValue = this.getCachedValue(0, VAR.TEMPO);
          }
          if (tempoValue) {
            this.push(this.pool.allocFrom(tempoValue));
          } else {
            this.push(this.pool.alloc(60, 1)); // Default tempo 60 BPM
          }
          break;
        }

        case OP.FIND_MEASURE: {
          // Find measure length for a note: beatsPerMeasure / tempo * 60
          const noteRef = this.pop();
          // noteRef is a Fraction containing the note ID
          const noteId = noteRef ? Math.round(noteRef.valueOf()) : 0;

          // Get beatsPerMeasure - try note first, then base note
          let beatsPerMeasure = null;
          if (evalCache) {
            const noteCache = evalCache.get(noteId);
            if (noteCache && noteCache.beatsPerMeasure) {
              beatsPerMeasure = noteCache.beatsPerMeasure;
            }
            if (!beatsPerMeasure) {
              const baseCache = evalCache.get(0);
              if (baseCache && baseCache.beatsPerMeasure) {
                beatsPerMeasure = baseCache.beatsPerMeasure;
              }
            }
          }
          if (!beatsPerMeasure) {
            beatsPerMeasure = this.getCachedValue(noteId, VAR.BEATS_PER_MEASURE);
          }
          if (!beatsPerMeasure) {
            beatsPerMeasure = this.getCachedValue(0, VAR.BEATS_PER_MEASURE);
          }
          if (!beatsPerMeasure) {
            beatsPerMeasure = this.pool.alloc(4, 1); // Default 4 beats
          }

          // Get tempo - try note first, then base note
          let tempo = null;
          if (evalCache) {
            const noteCache = evalCache.get(noteId);
            if (noteCache && noteCache.tempo) {
              tempo = noteCache.tempo;
            }
            if (!tempo) {
              const baseCache = evalCache.get(0);
              if (baseCache && baseCache.tempo) {
                tempo = baseCache.tempo;
              }
            }
          }
          if (!tempo) {
            tempo = this.getCachedValue(noteId, VAR.TEMPO);
          }
          if (!tempo) {
            tempo = this.getCachedValue(0, VAR.TEMPO);
          }
          if (!tempo) {
            tempo = this.pool.alloc(60, 1); // Default 60 BPM
          }

          // Compute measureLength = beatsPerMeasure / tempo * 60
          // = beatsPerMeasure * 60 / tempo
          const sixty = this.pool.alloc(60, 1);
          const numerator = this.pool.alloc(1, 1);
          numerator.mul(beatsPerMeasure);
          numerator.mul(sixty);
          numerator.div(tempo);
          this.push(numerator);
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

    return this.stackTop > 0 ? this.pop() : this.pool.alloc(0, 1);
  }

  /**
   * Evaluate a note and cache the results
   *
   * @param {Note|BinaryNote} note - The note to evaluate (supports both Note and BinaryNote)
   * @param {Map} evalCache - Pre-evaluated dependencies
   * @returns {Object} - Evaluated values { startTime, duration, frequency, ... }
   */
  evaluateNote(note, evalCache = null) {
    const result = {
      startTime: null,
      duration: null,
      frequency: null,
      tempo: null,
      beatsPerMeasure: null,
      measureLength: null,
      corruptionFlags: 0, // Track irrational values (TET scales)
    };

    // Create a working cache that includes this note's partial results
    // This allows expressions within the same note to reference each other
    // (e.g., measureLength can reference tempo that was just evaluated)
    const workingCache = new Map(evalCache || []);
    workingCache.set(note.id, result);

    // Helper to get expression - supports both Note.expressions and BinaryNote direct properties
    const getExpr = (name) => {
      // New Note class uses expressions object
      if (note.expressions && note.expressions[name]) {
        return note.expressions[name];
      }
      // BinaryNote has direct properties
      if (note[name]) {
        return note[name];
      }
      return null;
    };

    // Corruption flag mapping: name -> bit flag
    const corruptionFlagMap = {
      startTime: 0x01,
      duration: 0x02,
      frequency: 0x04,
      tempo: 0x08,
      beatsPerMeasure: 0x10,
      measureLength: 0x20,
    };

    const safeEvaluate = (name) => {
      try {
        const expr = getExpr(name);
        if (expr && !expr.isEmpty()) {
          const pooledValue = this.evaluate(expr, workingCache);
          // IMPORTANT: Create a NEW Fraction for caching, not the pooled one!
          // Pooled fractions get reused when pool.reset() is called, which would
          // corrupt our cached values.
          const value = new Fraction(pooledValue.s * pooledValue.n, pooledValue.d);
          // Update result immediately so later expressions in this note can use it
          result[name] = value;

          // Check if bytecode contains POW opcode (0x15) - indicates potential irrational value
          // This is a heuristic: actual corruption depends on whether the power produces an irrational
          if (expr.bytecode && expr.length > 0) {
            for (let i = 0; i < expr.length; i++) {
              if (expr.bytecode[i] === OP.POW) {
                result.corruptionFlags |= corruptionFlagMap[name] || 0;
                break;
              }
            }
          }

          return value;
        }
      } catch (e) {
        console.warn(`Failed to evaluate ${name} for note ${note.id}:`, e);
      }
      return null;
    };

    // Evaluate in dependency order:
    // 1. First evaluate variables that don't typically depend on others
    result.tempo = safeEvaluate('tempo');
    result.beatsPerMeasure = safeEvaluate('beatsPerMeasure');
    result.frequency = safeEvaluate('frequency');

    // 2. measureLength depends on tempo and beatsPerMeasure
    result.measureLength = safeEvaluate('measureLength');

    // 3. startTime and duration may depend on measureLength/tempo
    result.startTime = safeEvaluate('startTime');
    result.duration = safeEvaluate('duration');

    // 4. If measureLength wasn't explicitly defined but this is a measure note or base note,
    // compute it from beatsPerMeasure and tempo. This is needed because findMeasureLength()
    // references are compiled as LOAD_REF which looks up measureLength in the cache.
    // Only compute for measure notes (have startTime, no duration/frequency) or base note (id=0)
    // to avoid expensive Fraction operations for regular notes.
    const isMeasureNote = result.startTime && !result.duration && !result.frequency;
    if (!result.measureLength && (isMeasureNote || note.id === 0)) {
      // Get beatsPerMeasure - use this note's value or fall back to base note
      let beats = result.beatsPerMeasure;
      if (!beats && evalCache) {
        const baseCache = evalCache.get(0);
        if (baseCache) beats = baseCache.beatsPerMeasure;
      }
      // Get tempo - use this note's value or fall back to base note
      let tempo = result.tempo;
      if (!tempo && evalCache) {
        const baseCache = evalCache.get(0);
        if (baseCache) tempo = baseCache.tempo;
      }
      // Compute measureLength = beatsPerMeasure / tempo * 60 using fast native math
      const beatsVal = beats ? (typeof beats.valueOf === 'function' ? beats.valueOf() : Number(beats)) : 4;
      const tempoVal = tempo ? (typeof tempo.valueOf === 'function' ? tempo.valueOf() : Number(tempo)) : 60;
      const measureLenVal = (beatsVal / tempoVal) * 60;
      // Store as simple object with s/n/d for compatibility, avoiding Fraction constructor
      result.measureLength = { s: 1, n: Math.round(measureLenVal * 1000000), d: 1000000, valueOf: () => measureLenVal };
    }

    // Cache the result
    this.cache.set(note.id, result);

    return result;
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
   */
  invalidate(noteId) {
    this.dirty.add(noteId);

    // Also invalidate all dependents
    const dependents = this.graph.getAllDependents(noteId);
    for (const dep of dependents) {
      this.dirty.add(dep);
    }

    this.generation++;
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
   * Evaluate all dirty notes in topological order
   *
   * @returns {Map} - Complete evaluation cache
   */
  evaluateDirty() {
    if (this.dirty.size === 0) {
      return this.cache;
    }

    // Reset fraction pool for this batch
    this.evaluator.beginBatch();

    // Topological sort dirty notes
    const sorted = this.topoSort(this.dirty);

    // Evaluate in dependency order
    for (const noteId of sorted) {
      const note = this.module.getNoteById(noteId);
      if (!note) {
        this.cache.delete(noteId);
        continue;
      }

      const result = this.evaluator.evaluateNote(note, this.cache);
      this.cache.set(noteId, result);
    }

    this.dirty.clear();
    return this.cache;
  }

  /**
   * Topological sort using Kahn's algorithm
   *
   * @param {Set} noteIds - Set of note IDs to sort
   * @returns {Array} - Sorted array of note IDs
   */
  topoSort(noteIds) {
    const inDegree = new Map();
    const result = [];
    const resultSet = new Set(); // O(1) lookups for cycle detection

    // Get notes that reference base note (they have implicit dependency on 0)
    const baseNoteDependents = this.graph.getBaseNoteDependents();
    const hasBaseNote = noteIds.has(0);

    // Calculate in-degrees (count of dependencies within dirty set)
    for (const id of noteIds) {
      const deps = this.graph.getDependencies(id);
      let count = 0;
      for (const d of deps) {
        if (noteIds.has(d)) count++;
      }
      // If this note references base note and base note is in the dirty set,
      // add implicit dependency (unless this IS the base note)
      if (hasBaseNote && id !== 0 && baseNoteDependents.has(id)) {
        count++;
      }
      inDegree.set(id, count);
    }

    // Start with nodes that have no dependencies (in-degree 0)
    // Sort by ID to ensure deterministic order - base note (0) first
    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    queue.sort((a, b) => a - b); // Sort numerically, base note (0) first

    // Process queue - use index instead of shift() for O(1) vs O(n)
    let queueIdx = 0;
    while (queueIdx < queue.length) {
      const id = queue[queueIdx++];
      result.push(id);
      resultSet.add(id);

      // Decrease in-degree of dependents
      const dependents = this.graph.getDependents(id);
      const newZeroDegree = [];
      const newZeroSet = new Set(); // Track duplicates in O(1)
      for (const dep of dependents) {
        if (!inDegree.has(dep)) continue;
        const newDeg = inDegree.get(dep) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) {
          newZeroDegree.push(dep);
          newZeroSet.add(dep);
        }
      }

      // If this is the base note (0), also release all baseNote-dependent notes
      if (id === 0) {
        for (const dep of baseNoteDependents) {
          if (!inDegree.has(dep)) continue;
          const newDeg = inDegree.get(dep) - 1;
          inDegree.set(dep, newDeg);
          if (newDeg === 0 && !newZeroSet.has(dep)) {
            newZeroDegree.push(dep);
            newZeroSet.add(dep);
          }
        }
      }

      // Sort newly discovered zero-degree nodes for deterministic order
      newZeroDegree.sort((a, b) => a - b);
      queue.push(...newZeroDegree);
    }

    // Check for cycles - use resultSet for O(1) lookups
    if (result.length !== noteIds.size) {
      console.warn('Dependency cycle detected! Some notes could not be evaluated.');
      // Debug: show which notes have remaining dependencies (limit to first 10)
      const stuck = [];
      for (const id of noteIds) {
        if (!resultSet.has(id)) {
          if (stuck.length < 10) {
            const deps = this.graph.getDependencies(id);
            const unresolvedDeps = [...deps].filter(d => !resultSet.has(d) && noteIds.has(d));
            stuck.push({ id, unresolvedDeps });
          }
        }
      }
      if (stuck.length > 0) {
        console.warn('Stuck notes:', stuck);
      }
      // Add remaining notes anyway - sort by ID for deterministic order
      const remaining = [];
      for (const id of noteIds) {
        if (!resultSet.has(id)) remaining.push(id);
      }
      remaining.sort((a, b) => a - b);
      result.push(...remaining);
    }

    return result;
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
