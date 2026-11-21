import type Fraction from 'fraction.js';

/**
 * Binary Expression Format for RMT Compose
 *
 * Replaces text-based expressions with a compact binary instruction format
 * that enables fast evaluation without runtime compilation via new Function().
 */

/**
 * The largest note id. A reference to a note up to 65535 is LOAD_REF (a
 * 2-byte id); above that it is LOAD_REF_WIDE (4 bytes). The limit itself is
 * the renderer's: picking draws each note's id in 24 bits of colour
 * (src/renderer/webgl2/picking.js), and 2^24 - 1 is also the largest integer
 * a float32 vertex attribute holds exactly.
 */
export const MAX_NOTE_ID = 0xFFFFFF;

// Instruction opcodes (1 byte)
export const OP = {
  // Load operations
  LOAD_CONST:     0x01,  // Push Fraction constant: [num_hi, num_lo, num_lo2, num_lo3, den_hi, den_lo, den_lo2, den_lo3]
  LOAD_REF:       0x02,  // Push note reference: [noteId_hi, noteId_lo, varIndex]
  LOAD_BASE:      0x03,  // Push baseNote variable: [varIndex]
  LOAD_REF_WIDE:  0x05,  // Push note reference to a note id above 65535: [noteId (4 bytes, big-endian), varIndex]
  LOAD_CONST_BIG: 0x04,  // Push BigInt Fraction: [sign(1), num_len(2), num_bytes(n), den_len(2), den_bytes(n)]

  // Arithmetic operations
  ADD:            0x10,  // Pop 2, push sum
  SUB:            0x11,  // Pop 2, push difference
  MUL:            0x12,  // Pop 2, push product
  DIV:            0x13,  // Pop 2, push quotient
  NEG:            0x14,  // Pop 1, push negation
  POW:            0x15,  // Pop 2 (base, exponent), push base^exponent (may corrupt to irrational)
  APPROX:         0x16,  // Pop 1, push it as an approximate value (`~261.63`); follows a constant

  // Module lookup operations. 0x20 (FIND_TEMPO) and 0x21 (FIND_MEASURE) were
  // retired with the tempo / measure-length variables; do not reuse them.
  FIND_INSTRUMENT: 0x22, // Pop noteRef, push instrument lookup result

  // Stack operations
  DUP:            0x30,  // Duplicate top of stack
  SWAP:           0x31,  // Swap top two stack values
} as const;

// Variable indices for compact storage
//
// 0-2 are the language: a note's frequency, start and duration, each a
// relation to other notes. 3-5 interpret a note when it sounds: amplitude
// (relative gain), attack and release (shares of the note's own duration).
// Only the interpretation variables fall back to the BaseNote when unset.
export const VAR = {
  START_TIME: 0,
  DURATION: 1,
  FREQUENCY: 2,
  AMPLITUDE: 3,
  ATTACK: 4,
  RELEASE: 5,
} as const;

/** First variable index that interprets rather than relates (inherits from the BaseNote). */
export const FIRST_INTERPRETATION_VAR = VAR.AMPLITUDE;

// Reverse mapping for decompilation
export const VAR_NAMES = {
  0: 'startTime',
  1: 'duration',
  2: 'frequency',
  3: 'amplitude',
  4: 'attack',
  5: 'release',
} as const;

export type VariableIndex = keyof typeof VAR_NAMES;
export type ExpressionName = (typeof VAR_NAMES)[VariableIndex];
export type NoteId = number;

// Corruption flags (bitmask indicating which properties contain irrational values)
export const CORRUPT = {
  START_TIME:       0x01,
  DURATION:         0x02,
  FREQUENCY:        0x04,
  AMPLITUDE:        0x08,
  ATTACK:           0x10,
  RELEASE:          0x20,
} as const;

/**
 * Get corruption flag for a variable index
 * @param {number} varIndex - Variable index (0-5)
 * @returns {number} Corruption flag bitmask
 */
export function getCorruptionFlag(varIndex: number) {
  return 1 << varIndex;
}

/** The empty dependency and reference list that expressions share; frozen, never written. */
// Freeze the shared empty buffer after construction. Writes grow it before indexing.
const EMPTY_LIST: number[] = [];
Object.freeze(EMPTY_LIST);

/**
 * Binary expression storage
 * Stores bytecode instructions and explicit dependency list
 */
export class BinaryExpression {
  /**
   * @param {number} [initialSize=64] - bytecode capacity in bytes
   * @param {ArrayLike<number>|null} [dependencies] - the dependency list to
   *   start from (clone() passes an exact-size one); a Uint32Array(16) if none
   */
  declare dependencies: number[] | Uint32Array;
  declare _varRefs: readonly number[] | null;
  constructor(initialSize = 64, dependencies: number[] | Uint32Array | null = null) {
    // Instruction bytecode buffer
    this.bytecode = new Uint8Array(initialSize);
    this.length = 0;

    // Explicit dependency list (note IDs this expression references): a
    // Uint32Array while compiling, an exact-size Array in a clone
    this.dependencies = dependencies || new Uint32Array(16);
    this.depCount = 0;

    // Original text expression (for JSON round-trip)
    this.sourceText = '';

    // Whether this references baseNote (optimization for evaluation order)
    this.referencesBase = false;

    // Decoded variable references, filled in by getVariableRefs()
    this._varRefs = null;
    this._varRefsLength = 0;
  }

  /**
   * Ensure bytecode buffer has enough capacity
   */
  ensureCapacity(needed: number) {
    if (this.length + needed > this.bytecode.length) {
      const newSize = Math.max(this.bytecode.length * 2, this.length + needed);
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.bytecode);
      this.bytecode = newBuffer;
    }
  }

  /**
   * Write a single byte
   */
  writeByte(value: number) {
    this.ensureCapacity(1);
    this.bytecode[this.length++] = value & 0xFF;
  }

  /**
   * Write a 16-bit unsigned integer (big-endian)
   */
  writeUint16(value: number) {
    this.ensureCapacity(2);
    this.bytecode[this.length++] = (value >> 8) & 0xFF;
    this.bytecode[this.length++] = value & 0xFF;
  }

  /**
   * Write a 32-bit unsigned integer (big-endian)
   */
  writeUint32(value: number) {
    this.ensureCapacity(4);
    this.bytecode[this.length++] = (value >>> 24) & 0xFF;
    this.bytecode[this.length++] = (value >>> 16) & 0xFF;
    this.bytecode[this.length++] = (value >>> 8) & 0xFF;
    this.bytecode[this.length++] = value & 0xFF;
  }

  /**
   * Write a 32-bit signed integer (big-endian)
   */
  writeInt32(value: number) {
    this.ensureCapacity(4);
    this.bytecode[this.length++] = (value >> 24) & 0xFF;
    this.bytecode[this.length++] = (value >> 16) & 0xFF;
    this.bytecode[this.length++] = (value >> 8) & 0xFF;
    this.bytecode[this.length++] = value & 0xFF;
  }

  /**
   * Write a signed BigInt as variable-length bytes
   * Format: [sign(1)] [len(2)] [bytes(n)]
   * @param {bigint} value - The BigInt value to write
   */
  writeBigIntSigned(value: bigint) {
    const bigVal = BigInt(value);
    const isNegative = bigVal < 0n;
    const magnitude = isNegative ? -bigVal : bigVal;

    // Write sign byte (0x00 = positive, 0x01 = negative)
    this.writeByte(isNegative ? 0x01 : 0x00);

    // Write magnitude as unsigned
    this.writeBigIntUnsigned(magnitude);
  }

  /**
   * Write an unsigned BigInt as variable-length bytes
   * Format: [len(2)] [bytes(n)]
   * @param {bigint} value - The BigInt value to write (must be non-negative)
   */
  writeBigIntUnsigned(value: bigint) {
    const bigVal = BigInt(value);
    if (bigVal < 0n) {
      throw new Error('writeBigIntUnsigned requires non-negative value');
    }

    // Handle zero specially
    if (bigVal === 0n) {
      this.writeUint16(1);  // Length = 1
      this.writeByte(0);    // Value = 0
      return;
    }

    // Convert to hex string, then to bytes (big-endian)
    let hex = bigVal.toString(16);
    if (hex.length % 2) hex = '0' + hex;  // Pad to even length
    const byteLen = hex.length / 2;

    // Write length as u16 (max 65535 bytes = 524280 bits)
    if (byteLen > 65535) {
      throw new Error('BigInt too large for bytecode encoding');
    }
    this.writeUint16(byteLen);

    // Write bytes (big-endian)
    this.ensureCapacity(byteLen);
    for (let i = 0; i < byteLen; i++) {
      this.bytecode[this.length++] = parseInt(hex.substr(i * 2, 2), 16);
    }
  }

  /**
   * Add a note dependency
   */
  addDependency(noteId: NoteId) {
    // Check if already tracked
    for (let i = 0; i < this.depCount; i++) {
      if (this.dependencies[i] === noteId) return;
    }

    // Expand if needed (a clone's list is exact-size, possibly empty)
    if (this.depCount >= this.dependencies.length) {
      const newDeps = new Uint32Array(Math.max(16, this.dependencies.length * 2));
      newDeps.set(this.dependencies);
      this.dependencies = newDeps;
    }

    this.dependencies[this.depCount++] = noteId;
  }

  /**
   * Get dependencies as a Set for compatibility
   */
  getDependencySet() {
    const set = new Set<NoteId>();
    for (let i = 0; i < this.depCount; i++) {
      set.add(this.dependencies[i]);
    }
    return set;
  }

  /**
   * Get property-level dependencies by scanning bytecode for LOAD_REF instructions
   * Returns Map<noteId, Set<varIndex>> showing which properties are referenced
   */
  getPropertyDependencies() {
    const deps = new Map<NoteId, Set<number>>(); // noteId -> Set<varIndex>
    const bytecode = this.bytecode;
    const len = this.length;
    let pc = 0;

    while (pc < len) {
      const op = bytecode[pc++];

      switch (op) {
        case OP.LOAD_CONST:
          pc += 8; // Skip 8 bytes (num + den as 32-bit each)
          break;

        case OP.LOAD_CONST_BIG: {
          // Skip sign byte
          pc += 1;
          // Read and skip numerator: len(2) + bytes(len)
          const numLen = (bytecode[pc] << 8) | bytecode[pc + 1];
          pc += 2 + numLen;
          // Read and skip denominator: len(2) + bytes(len)
          const denLen = (bytecode[pc] << 8) | bytecode[pc + 1];
          pc += 2 + denLen;
          break;
        }

        case OP.LOAD_REF:
        case OP.LOAD_REF_WIDE: {
          // [noteId (2 or 4 bytes), varIndex]
          let noteId;
          if (op === OP.LOAD_REF) {
            noteId = (bytecode[pc] << 8) | bytecode[pc + 1];
            pc += 2;
          } else {
            noteId = ((bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3]) >>> 0;
            pc += 4;
          }
          const varIdx = bytecode[pc++];

          if (!deps.has(noteId)) {
            deps.set(noteId, new Set());
          }
          deps.get(noteId)!.add(varIdx);
          break;
        }

        case OP.LOAD_BASE:
          pc += 1; // Skip varIndex
          break;

        // All other ops have no operands
        default:
          break;
      }
    }

    return deps;
  }

  /**
   * Every (note, variable) this expression reads, in order of first appearance.
   * Each entry is packed as (noteId << 3) | varIndex; `base.x` appears as note 0.
   *
   * Unlike getPropertyDependencies() this includes BaseNote reads, because
   * evaluation order and cycle checks work per variable, and `base.f` is a
   * dependency on the BaseNote's frequency like any other. Decoded once per
   * expression: bytecode is only appended to while compiling.
   *
   * @returns {number[]} Shared array, do not mutate
   */
  getVariableRefs() {
    if (this._varRefs !== null && this._varRefsLength === this.length) {
      return this._varRefs;
    }

    const refs: number[] = [];
    const addRef = (ref: number) => { if (!refs.includes(ref)) refs.push(ref); };
    const bytecode = this.bytecode;
    const len = this.length;
    let pc = 0;

    while (pc < len) {
      const op = bytecode[pc++];

      switch (op) {
        case OP.LOAD_CONST:
          pc += 8;
          break;

        case OP.LOAD_CONST_BIG: {
          pc += 1; // sign
          const numLen = (bytecode[pc] << 8) | bytecode[pc + 1];
          pc += 2 + numLen;
          const denLen = (bytecode[pc] << 8) | bytecode[pc + 1];
          pc += 2 + denLen;
          break;
        }

        case OP.LOAD_REF: {
          const noteId = (bytecode[pc] << 8) | bytecode[pc + 1];
          addRef((noteId << 3) | bytecode[pc + 2]);
          pc += 3;
          break;
        }

        case OP.LOAD_REF_WIDE: {
          const noteId = ((bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3]) >>> 0;
          addRef((noteId << 3) | bytecode[pc + 4]);
          pc += 5;
          break;
        }

        case OP.LOAD_BASE:
          addRef(bytecode[pc++]); // note 0
          break;

        // All other ops have no operands
        default:
          break;
      }
    }

    // Kept at its size: an array grown by push() holds 17 slots for one ref
    const kept = refs.length === 0 ? EMPTY_LIST : refs.slice();
    this._varRefs = kept;
    this._varRefsLength = len;
    return kept;
  }

  /**
   * Check if this expression references a specific property of a note
   * @param {number} noteId - The note ID to check
   * @param {number} varIndex - The variable index (VAR.START_TIME, VAR.DURATION, etc.)
   * @returns {boolean}
   */
  referencesProperty(noteId: NoteId, varIndex: number) {
    const deps = this.getPropertyDependencies();
    const noteProps = deps.get(noteId);
    return noteProps ? noteProps.has(varIndex) : false;
  }

  /**
   * Check if this expression has any instructions
   */
  isEmpty() {
    return this.length === 0;
  }

  /**
   * Reset expression to empty state
   */
  clear() {
    this.length = 0;
    this.depCount = 0;
    this.sourceText = '';
    this.referencesBase = false;
    this._varRefs = null;
  }

  /**
   * Clone this expression, at its size: the bytecode buffer holds exactly
   * `length` bytes and the dependency list exactly `depCount` ids (an Array;
   * the shared EMPTY_LIST when there are none). Every expression a note holds
   * is a clone (the compiler's cache hands out clones), and a 64-byte buffer
   * with a 16-entry Uint32Array cost about 530 B per expression in Node for
   * what is mostly a dozen bytes and one id. Writing to a clone grows it as
   * it would any expression (ensureCapacity, addDependency).
   */
  clone() {
    const n = this.depCount;
    const deps = n ? new Array<number>(n) : EMPTY_LIST;
    if (n > 0) {
      for (let i = 0; i < n; i++) deps[i] = this.dependencies[i];
    }
    const copy = new BinaryExpression(this.length, deps);
    copy.bytecode.set(this.bytecode.subarray(0, this.length));
    copy.length = this.length;
    copy.depCount = n;
    copy.sourceText = this.sourceText;
    copy.referencesBase = this.referencesBase;
    return copy;
  }
}

/**
 * The expression of a variable a note does not have: one instance that every
 * unset variable shares (src/note.js). A note used to make all six of its
 * expressions up front, each with a 64-byte bytecode buffer and a 16-entry
 * dependency list, and most notes set three: about 1.8 KB per note in Node.
 *
 * Frozen, so that a write to it throws instead of reaching every note. An
 * expression that belongs to a note is replaced (setVariable, compile), never
 * written in place; a clone of this one is an ordinary, writable expression.
 */
export const EMPTY_EXPRESSION = (() => {
  const e = new BinaryExpression(0);
  e.dependencies = new Uint32Array(0);
  e._varRefs = EMPTY_LIST; // what getVariableRefs() returns, without writing
  e._varRefsLength = 0;
  Object.freeze(e.bytecode);
  Object.freeze(e.dependencies);
  return Object.freeze(e);
})();

/**
 * Binary note storage
 * Stores all note parameters as binary expressions
 */
export class BinaryNote {
  declare _cachedStart: Fraction | null;
  declare _cachedDur: Fraction | null;
  declare _cachedFreq: Fraction | null;
  declare _cachedAmp: Fraction | null;
  declare _cachedAttack: Fraction | null;
  declare _cachedRelease: Fraction | null;
  constructor(id: NoteId) {
    this.id = id;

    // Binary expressions for each variable
    this.startTime = new BinaryExpression();
    this.duration = new BinaryExpression();
    this.frequency = new BinaryExpression();
    this.amplitude = new BinaryExpression();
    this.attack = new BinaryExpression();
    this.release = new BinaryExpression();

    // Non-expression properties (stored directly)
    this.color = 'rgba(255, 0, 0, 0.5)';
    this.instrument = 'sine-wave';

    // Cached evaluation results (invalidated when deps change)
    this._cachedStart = null;
    this._cachedDur = null;
    this._cachedFreq = null;
    this._cachedAmp = null;
    this._cachedAttack = null;
    this._cachedRelease = null;

    // Generation counter for cache invalidation
    this._cacheGen = -1;
  }

  /**
   * Get binary expression for a variable name
   */
  getExpression(varName: string) {
    switch (varName) {
      case 'startTime': return this.startTime;
      case 'duration': return this.duration;
      case 'frequency': return this.frequency;
      case 'amplitude': return this.amplitude;
      case 'attack': return this.attack;
      case 'release': return this.release;
      default: return null;
    }
  }

  /**
   * Set binary expression for a variable name
   */
  setExpression(varName: string, expr: BinaryExpression) {
    switch (varName) {
      case 'startTime': this.startTime = expr; break;
      case 'duration': this.duration = expr; break;
      case 'frequency': this.frequency = expr; break;
      case 'amplitude': this.amplitude = expr; break;
      case 'attack': this.attack = expr; break;
      case 'release': this.release = expr; break;
    }
  }

  /**
   * Get cached value for a variable
   */
  getCachedValue(varName: string) {
    switch (varName) {
      case 'startTime': return this._cachedStart;
      case 'duration': return this._cachedDur;
      case 'frequency': return this._cachedFreq;
      case 'amplitude': return this._cachedAmp;
      case 'attack': return this._cachedAttack;
      case 'release': return this._cachedRelease;
      default: return null;
    }
  }

  /**
   * Set cached value for a variable
   */
  setCachedValue(varName: string, value: Fraction | null) {
    switch (varName) {
      case 'startTime': this._cachedStart = value; break;
      case 'duration': this._cachedDur = value; break;
      case 'frequency': this._cachedFreq = value; break;
      case 'amplitude': this._cachedAmp = value; break;
      case 'attack': this._cachedAttack = value; break;
      case 'release': this._cachedRelease = value; break;
    }
  }

  /**
   * Invalidate all cached values
   */
  invalidateCache() {
    this._cachedStart = null;
    this._cachedDur = null;
    this._cachedFreq = null;
    this._cachedAmp = null;
    this._cachedAttack = null;
    this._cachedRelease = null;
    this._cacheGen = -1;
  }

  /**
   * Get all dependencies across all expressions
   */
  getAllDependencies() {
    const deps = new Set<NoteId>();

    const addDeps = (expr: BinaryExpression) => {
      for (let i = 0; i < expr.depCount; i++) {
        deps.add(expr.dependencies[i]);
      }
    };

    addDeps(this.startTime);
    addDeps(this.duration);
    addDeps(this.frequency);
    addDeps(this.amplitude);
    addDeps(this.attack);
    addDeps(this.release);

    return deps;
  }

  /**
   * Check if any expression references baseNote
   */
  referencesBaseNote() {
    return this.startTime.referencesBase ||
           this.duration.referencesBase ||
           this.frequency.referencesBase ||
           this.amplitude.referencesBase ||
           this.attack.referencesBase ||
           this.release.referencesBase;
  }

  /**
   * Clone this note
   */
  clone() {
    const copy = new BinaryNote(this.id);
    copy.startTime = this.startTime.clone();
    copy.duration = this.duration.clone();
    copy.frequency = this.frequency.clone();
    copy.amplitude = this.amplitude.clone();
    copy.attack = this.attack.clone();
    copy.release = this.release.clone();
    copy.color = this.color;
    copy.instrument = this.instrument;
    return copy;
  }
}

/**
 * Binary module container
 * Stores all notes in binary format with fast lookup
 */
export class BinaryModule {
  constructor() {
    // Note storage: id -> BinaryNote
    this.notes = new Map<NoteId, BinaryNote>();

    // Base note (id = 0) with default values
    this.baseNote = new BinaryNote(0);
    this.notes.set(0, this.baseNote);

    // ID counter for new notes
    this._nextId = 1;

    // Generation counter for cache invalidation
    this._generation = 0;
  }

  /**
   * Get a note by ID
   */
  getNoteById(id: NoteId) {
    return this.notes.get(id) || null;
  }

  /**
   * Add a new note
   */
  addNote(note: BinaryNote) {
    if (note.id === 0) {
      // Replace base note
      this.baseNote = note;
    }
    this.notes.set(note.id, note);
    if (note.id >= this._nextId) {
      this._nextId = note.id + 1;
    }
    this._generation++;
    return note;
  }

  /**
   * Create a new note with auto-generated ID
   */
  createNote() {
    const note = new BinaryNote(this._nextId++);
    this.notes.set(note.id, note);
    this._generation++;
    return note;
  }

  /**
   * Remove a note by ID
   */
  removeNote(id: NoteId) {
    if (id === 0) return false; // Cannot remove base note
    const removed = this.notes.delete(id);
    if (removed) {
      this._generation++;
    }
    return removed;
  }

  /**
   * Get all note IDs (excluding base note)
   */
  getNoteIds() {
    const ids = [];
    for (const id of this.notes.keys()) {
      if (id !== 0) ids.push(id);
    }
    return ids;
  }

  /**
   * Get note count (excluding base note)
   */
  get noteCount() {
    return this.notes.size - 1;
  }

  /**
   * Clear all notes (keeps base note)
   */
  clear() {
    const base = this.baseNote;
    this.notes.clear();
    this.notes.set(0, base);
    this._generation++;
  }

  /**
   * Iterate over all notes (including base note)
   */
  *[Symbol.iterator]() {
    yield* this.notes.values();
  }

  /**
   * Iterate over note entries
   */
  *entries() {
    yield* this.notes.entries();
  }
}
