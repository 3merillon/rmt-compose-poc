/**
 * Binary Expression Format for RMT Compose
 *
 * Replaces text-based expressions with a compact binary instruction format
 * that enables fast evaluation without runtime compilation via new Function().
 */

// Instruction opcodes (1 byte)
export const OP = {
  // Load operations
  LOAD_CONST:     0x01,  // Push Fraction constant: [num_hi, num_lo, num_lo2, num_lo3, den_hi, den_lo, den_lo2, den_lo3]
  LOAD_REF:       0x02,  // Push note reference: [noteId_hi, noteId_lo, varIndex]
  LOAD_BASE:      0x03,  // Push baseNote variable: [varIndex]

  // Arithmetic operations
  ADD:            0x10,  // Pop 2, push sum
  SUB:            0x11,  // Pop 2, push difference
  MUL:            0x12,  // Pop 2, push product
  DIV:            0x13,  // Pop 2, push quotient
  NEG:            0x14,  // Pop 1, push negation
  POW:            0x15,  // Pop 2 (base, exponent), push base^exponent (may corrupt to irrational)

  // Module lookup operations
  FIND_TEMPO:     0x20,  // Pop noteRef, push tempo lookup result
  FIND_MEASURE:   0x21,  // Pop noteRef, push measureLength lookup result
  FIND_INSTRUMENT: 0x22, // Pop noteRef, push instrument lookup result

  // Stack operations
  DUP:            0x30,  // Duplicate top of stack
  SWAP:           0x31,  // Swap top two stack values
};

// Variable indices for compact storage
export const VAR = {
  START_TIME: 0,
  DURATION: 1,
  FREQUENCY: 2,
  TEMPO: 3,
  BEATS_PER_MEASURE: 4,
  MEASURE_LENGTH: 5,
};

// Reverse mapping for decompilation
export const VAR_NAMES = {
  0: 'startTime',
  1: 'duration',
  2: 'frequency',
  3: 'tempo',
  4: 'beatsPerMeasure',
  5: 'measureLength',
};

// Corruption flags (bitmask indicating which properties contain irrational values)
export const CORRUPT = {
  START_TIME:       0x01,
  DURATION:         0x02,
  FREQUENCY:        0x04,
  TEMPO:            0x08,
  BEATS_PER_MEASURE: 0x10,
  MEASURE_LENGTH:   0x20,
};

/**
 * Get corruption flag for a variable index
 * @param {number} varIndex - Variable index (0-5)
 * @returns {number} Corruption flag bitmask
 */
export function getCorruptionFlag(varIndex) {
  return 1 << varIndex;
}

/**
 * Binary expression storage
 * Stores bytecode instructions and explicit dependency list
 */
export class BinaryExpression {
  constructor(initialSize = 64) {
    // Instruction bytecode buffer
    this.bytecode = new Uint8Array(initialSize);
    this.length = 0;

    // Explicit dependency list (note IDs this expression references)
    this.dependencies = new Uint16Array(16);
    this.depCount = 0;

    // Original text expression (for JSON round-trip)
    this.sourceText = '';

    // Whether this references baseNote (optimization for evaluation order)
    this.referencesBase = false;
  }

  /**
   * Ensure bytecode buffer has enough capacity
   */
  ensureCapacity(needed) {
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
  writeByte(value) {
    this.ensureCapacity(1);
    this.bytecode[this.length++] = value & 0xFF;
  }

  /**
   * Write a 16-bit unsigned integer (big-endian)
   */
  writeUint16(value) {
    this.ensureCapacity(2);
    this.bytecode[this.length++] = (value >> 8) & 0xFF;
    this.bytecode[this.length++] = value & 0xFF;
  }

  /**
   * Write a 32-bit signed integer (big-endian)
   */
  writeInt32(value) {
    this.ensureCapacity(4);
    this.bytecode[this.length++] = (value >> 24) & 0xFF;
    this.bytecode[this.length++] = (value >> 16) & 0xFF;
    this.bytecode[this.length++] = (value >> 8) & 0xFF;
    this.bytecode[this.length++] = value & 0xFF;
  }

  /**
   * Add a note dependency
   */
  addDependency(noteId) {
    // Check if already tracked
    for (let i = 0; i < this.depCount; i++) {
      if (this.dependencies[i] === noteId) return;
    }

    // Expand if needed
    if (this.depCount >= this.dependencies.length) {
      const newDeps = new Uint16Array(this.dependencies.length * 2);
      newDeps.set(this.dependencies);
      this.dependencies = newDeps;
    }

    this.dependencies[this.depCount++] = noteId;
  }

  /**
   * Get dependencies as a Set for compatibility
   */
  getDependencySet() {
    const set = new Set();
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
    const deps = new Map(); // noteId -> Set<varIndex>
    const bytecode = this.bytecode;
    const len = this.length;
    let pc = 0;

    while (pc < len) {
      const op = bytecode[pc++];

      switch (op) {
        case OP.LOAD_CONST:
          pc += 8; // Skip 8 bytes (num + den as 32-bit each)
          break;

        case OP.LOAD_REF: {
          // [noteId_hi, noteId_lo, varIndex]
          const noteId = (bytecode[pc] << 8) | bytecode[pc + 1];
          pc += 2;
          const varIdx = bytecode[pc++];

          if (!deps.has(noteId)) {
            deps.set(noteId, new Set());
          }
          deps.get(noteId).add(varIdx);
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
   * Check if this expression references a specific property of a note
   * @param {number} noteId - The note ID to check
   * @param {number} varIndex - The variable index (VAR.START_TIME, VAR.DURATION, etc.)
   * @returns {boolean}
   */
  referencesProperty(noteId, varIndex) {
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
  }

  /**
   * Clone this expression
   */
  clone() {
    const copy = new BinaryExpression(this.bytecode.length);
    copy.bytecode.set(this.bytecode.subarray(0, this.length));
    copy.length = this.length;
    copy.dependencies.set(this.dependencies.subarray(0, this.depCount));
    copy.depCount = this.depCount;
    copy.sourceText = this.sourceText;
    copy.referencesBase = this.referencesBase;
    return copy;
  }
}

/**
 * Binary note storage
 * Stores all note parameters as binary expressions
 */
export class BinaryNote {
  constructor(id) {
    this.id = id;

    // Binary expressions for each variable
    this.startTime = new BinaryExpression();
    this.duration = new BinaryExpression();
    this.frequency = new BinaryExpression();
    this.tempo = new BinaryExpression();
    this.beatsPerMeasure = new BinaryExpression();
    this.measureLength = new BinaryExpression();

    // Non-expression properties (stored directly)
    this.color = 'rgba(255, 0, 0, 0.5)';
    this.instrument = 'sine-wave';

    // Cached evaluation results (invalidated when deps change)
    this._cachedStart = null;
    this._cachedDur = null;
    this._cachedFreq = null;
    this._cachedTempo = null;
    this._cachedBPM = null;
    this._cachedMeasureLen = null;

    // Generation counter for cache invalidation
    this._cacheGen = -1;
  }

  /**
   * Get binary expression for a variable name
   */
  getExpression(varName) {
    switch (varName) {
      case 'startTime': return this.startTime;
      case 'duration': return this.duration;
      case 'frequency': return this.frequency;
      case 'tempo': return this.tempo;
      case 'beatsPerMeasure': return this.beatsPerMeasure;
      case 'measureLength': return this.measureLength;
      default: return null;
    }
  }

  /**
   * Set binary expression for a variable name
   */
  setExpression(varName, expr) {
    switch (varName) {
      case 'startTime': this.startTime = expr; break;
      case 'duration': this.duration = expr; break;
      case 'frequency': this.frequency = expr; break;
      case 'tempo': this.tempo = expr; break;
      case 'beatsPerMeasure': this.beatsPerMeasure = expr; break;
      case 'measureLength': this.measureLength = expr; break;
    }
  }

  /**
   * Get cached value for a variable
   */
  getCachedValue(varName) {
    switch (varName) {
      case 'startTime': return this._cachedStart;
      case 'duration': return this._cachedDur;
      case 'frequency': return this._cachedFreq;
      case 'tempo': return this._cachedTempo;
      case 'beatsPerMeasure': return this._cachedBPM;
      case 'measureLength': return this._cachedMeasureLen;
      default: return null;
    }
  }

  /**
   * Set cached value for a variable
   */
  setCachedValue(varName, value) {
    switch (varName) {
      case 'startTime': this._cachedStart = value; break;
      case 'duration': this._cachedDur = value; break;
      case 'frequency': this._cachedFreq = value; break;
      case 'tempo': this._cachedTempo = value; break;
      case 'beatsPerMeasure': this._cachedBPM = value; break;
      case 'measureLength': this._cachedMeasureLen = value; break;
    }
  }

  /**
   * Invalidate all cached values
   */
  invalidateCache() {
    this._cachedStart = null;
    this._cachedDur = null;
    this._cachedFreq = null;
    this._cachedTempo = null;
    this._cachedBPM = null;
    this._cachedMeasureLen = null;
    this._cacheGen = -1;
  }

  /**
   * Get all dependencies across all expressions
   */
  getAllDependencies() {
    const deps = new Set();

    const addDeps = (expr) => {
      for (let i = 0; i < expr.depCount; i++) {
        deps.add(expr.dependencies[i]);
      }
    };

    addDeps(this.startTime);
    addDeps(this.duration);
    addDeps(this.frequency);
    addDeps(this.tempo);
    addDeps(this.beatsPerMeasure);
    addDeps(this.measureLength);

    return deps;
  }

  /**
   * Check if any expression references baseNote
   */
  referencesBaseNote() {
    return this.startTime.referencesBase ||
           this.duration.referencesBase ||
           this.frequency.referencesBase ||
           this.tempo.referencesBase ||
           this.beatsPerMeasure.referencesBase ||
           this.measureLength.referencesBase;
  }

  /**
   * Clone this note
   */
  clone() {
    const copy = new BinaryNote(this.id);
    copy.startTime = this.startTime.clone();
    copy.duration = this.duration.clone();
    copy.frequency = this.frequency.clone();
    copy.tempo = this.tempo.clone();
    copy.beatsPerMeasure = this.beatsPerMeasure.clone();
    copy.measureLength = this.measureLength.clone();
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
    this.notes = new Map();

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
  getNoteById(id) {
    return this.notes.get(id) || null;
  }

  /**
   * Add a new note
   */
  addNote(note) {
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
  removeNote(id) {
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
