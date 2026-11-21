import { snapshotPages, changedRows } from './store/snapshot-pages.js';
import Fraction from 'fraction.js';
import { Note, EXPRESSION_VARS, isMeasureNote } from './note.js';
import { migrateTimeModel } from './migrate/relational-time.js';
import { migrateSyntax } from './migrate/legacy-syntax.js';
import { toNumber } from './utils/fraction-num.js';
import { DependencyGraph } from './dependency-graph.js';
import { inheritsFromBase } from './variable-deps.js';
import { BinaryEvaluator, IncrementalEvaluator } from './binary-evaluator.js';
import { compiler } from './expression-compiler.js';
import { compare as compareExact } from './value/exact.js';
import { MAX_NOTE_ID } from './binary-note.js';
import { instrumentOf, playerOf, migrateInstrumentRule, INSTRUMENT_RULE } from './players.js';

// Explicit invalidations without a known evaluation invalidate all derived timing.
let timingGeneration = 0;

export function invalidateModuleEndTimeCache() {
  timingGeneration++;
}

// Global default instrument for notes that don't resolve to an explicit or
// inherited instrument (the base note and its parentless descendants). Driven
// by the `audio.defaultInstrument` setting via setDefaultInstrument() (wired in
// player.js). Kept as a plain module-level value so module.js stays importable
// in the Node perf bench without pulling in the browser-only settings store.
// Defaults to 'sine-wave' → preserves pre-settings behavior.
let _defaultInstrumentName = 'sine-wave';

export function setDefaultInstrument(name) {
  if (typeof name === 'string' && name) _defaultInstrumentName = name;
}

export function getDefaultInstrument() {
  return _defaultInstrumentName;
}

/**
 * Module class - Binary-native implementation
 *
 * All expression evaluation is done through the binary evaluator.
 * No Function-based evaluation or *String dual storage.
 */
// What markNoteDirty() hands the incremental evaluator for a note whose
// dependents are already dirty
const NO_DEPENDENTS = [];

/** A note (not the BaseNote) as saved in the module JSON. */
function noteJSON(note) {
  const noteObj = { id: note.id };
  for (const name of EXPRESSION_VARS) {
    const source = note.getExpressionSource(name);
    if (source) {
      noteObj[name] = source;
    }
  }
  if (note.properties.color) noteObj.color = note.properties.color;
  if (note.properties.instrument) noteObj.instrument = note.properties.instrument;
  if (note.properties.measure) noteObj.measure = true;
  return noteObj;
}

// noteJSONText() reads the six variables by name, in this order; with any
// other list it keeps nothing and every note is serialized each time.
const KEEPS_NOTE_TEXT = EXPRESSION_VARS.join() === 'startTime,duration,frequency,amplitude,attack,release';

const isPrimitive = (v) => v === null || (typeof v !== 'object' && typeof v !== 'function');

/**
 * What getExpressionSource() returns for this expression when that is decided by
 * fields alone: null when it is empty, else its source text. An expression with
 * bytecode and no source text is decompiled instead: '' says so.
 */
const keptSource = (e) => (e && e.length !== 0 ? e.sourceText : null);
/** Whether keptSource() gave what getExpressionSource() gives. */
const byFields = (s) => s === null || (typeof s === 'string' && s !== '');

/**
 * { id, text }: JSON.stringify(noteJSON(note)). The note keeps it (note._savedJSON)
 * with every input of noteJSON() it was made from, and it is used again while
 * those all read the same: the id, the colour, the instrument, the measure flag
 * and, for each variable, whether it is empty and its source text. Those are
 * read straight from the fields (getExpressionSource for every variable of
 * every note costs several times more). Nothing is kept for a note whose
 * colour or instrument is an object (it could change in place) or with an
 * expression that has no source text (decompiled each time).
 */
function noteJSONText(note) {
  const props = note.properties;
  const ex = note.expressions;
  const kept = note._savedJSON;
  if (kept && kept.id === note.id && kept.color === props.color &&
      kept.instrument === props.instrument && kept.measure === props.measure &&
      keptSource(ex.startTime) === kept.s0 && keptSource(ex.duration) === kept.s1 &&
      keptSource(ex.frequency) === kept.s2 && keptSource(ex.amplitude) === kept.s3 &&
      keptSource(ex.attack) === kept.s4 && keptSource(ex.release) === kept.s5) {
    return kept;
  }
  const entry = {
    id: note.id,
    text: JSON.stringify(noteJSON(note)),
    color: props.color,
    instrument: props.instrument,
    measure: props.measure,
    s0: keptSource(ex.startTime), s1: keptSource(ex.duration), s2: keptSource(ex.frequency),
    s3: keptSource(ex.amplitude), s4: keptSource(ex.attack), s5: keptSource(ex.release)
  };
  const keep = KEEPS_NOTE_TEXT &&
    isPrimitive(props.color) && isPrimitive(props.instrument) && isPrimitive(props.measure) &&
    byFields(entry.s0) && byFields(entry.s1) && byFields(entry.s2) &&
    byFields(entry.s3) && byFields(entry.s4) && byFields(entry.s5);
  note._savedJSON = keep ? entry : null;
  return entry;
}

export class Module {
  constructor(baseNoteVariables = {}) {
    this.notes = {};
    this.nextId = 1;

    // Binary evaluation infrastructure
    this._dependencyGraph = new DependencyGraph();
    // Bumped whenever the graph is cleared/rebuilt so cached per-note
    // registration keys (see _registerNoteDependencies) can't go stale.
    this._depsRegGeneration = 0;
    this._binaryEvaluator = new BinaryEvaluator(this);
    this._incrementalEvaluator = new IncrementalEvaluator(
      this, // Module reference (we use notes Map interface)
      this._dependencyGraph,
      this._binaryEvaluator
    );

    // Evaluation cache (Map<noteId, {startTime, duration, ...}>)
    this._evaluationCache = new Map();
    this._dirtyNotes = new Set();
    // Notes whose dependents markNoteDirty() has already marked dirty since
    // the last evaluation: marking one of them again needs no second walk
    this._dirtyClosed = new Set();
    this._evaluationRevision = 0;
    this._recentEvaluations = [];
    this._evaluating = false; // reentrancy guard for evaluateModule()

    // Create base note with default values
    // The reference note holds the only absolute values: a frequency in Hz,
    // a start and a duration in seconds. Its duration is the time unit every
    // other duration relates to (`base.d`); 60 / base.d is the tempo, as a view.
    const defaultBaseNoteVariables = {
      frequency: '440',
      startTime: '0',
      duration: '1',
      // No hardcoded base instrument: with none set, findInstrument() resolves
      // the base note (and everything inheriting from it) to the global default
      // instrument (_defaultInstrumentName, default 'sine-wave' → behavior
      // unchanged at defaults). This is what makes the audio.defaultInstrument
      // setting reach the common inheriting-note case. A caller/JSON may still
      // pass an explicit `instrument` to pin the base note's timbre.
    };

    // Merge defaults with provided variables (convert functions to strings if needed)
    const finalVars = { ...defaultBaseNoteVariables };
    for (const [key, value] of Object.entries(baseNoteVariables)) {
      if (key === 'color' || key === 'instrument' || key === 'repeat') {
        finalVars[key] = value;
      } else if (key.endsWith('String')) {
        // Use the string value directly
        const baseName = key.slice(0, -6);
        finalVars[baseName] = value;
      } else if (typeof value === 'string') {
        finalVars[key] = value;
      } else if (typeof value === 'function') {
        // Try to extract expression from function
        try {
          const funcStr = value.toString();
          const match = funcStr.match(/return\s+(.+?);?\s*\}?\s*$/);
          if (match) {
            finalVars[key] = match[1];
          }
        } catch (e) {
          // Keep default
        }
      }
    }

    this.baseNote = new Note(0, finalVars);
    this.baseNote.module = this;
    this.notes[0] = this.baseNote;

    // Register base note in dependency graph
    this._registerNoteDependencies(this.baseNote);

    // Mark all dirty for initial evaluation
    this._dirtyNotes.add(0);
  }

  /**
   * Register a note's dependencies in the graph.
   * Skipped when nothing relevant changed since the last registration:
   * dependencies derive purely from the note's compiled expressions, so a
   * note whose expressions (epoch), id, and graph generation are unchanged
   * is already registered identically. markNoteDirty calls this for every
   * marked note (e.g., all dependents on an octave change), so the skip
   * avoids rewriting ~15 graph maps per untouched note.
   */
  _registerNoteDependencies(note) {
    // A newly loaded note has generation and epoch zero. Its numeric id
    // already identifies that state, without retaining one string per note.
    const regKey = !this._depsRegGeneration && !note._depsEpoch
      ? note.id : `${this._depsRegGeneration}:${note.id}:${note._depsEpoch || 0}`;
    // The module identity check matters: import builds notes inside a temporary
    // module (which stamps them), then migrates the objects into this one. When
    // ids are reused — a drop after Clean Slate maps ids 1:1 — the key alone
    // collides and this module would never learn the note's real dependencies.
    if (note._depsRegKey === regKey && note._depsRegModule === this) {
      return;
    }

    const allDeps = note.getAllDependencies();
    const refsBase = note.referencesBaseNote();
    this._dependencyGraph._updateDependencies(note.id, allDeps, refsBase);
    // An `[n].a` read of a note without an amplitude follows the base note
    // without naming it; re-evaluation has to know about those too.
    this._dependencyGraph.setImplicitBaseDependent(note.id, inheritsFromBase(note));

    // Also register startTime-specific dependencies for drag preview
    const startTimeExpr = note.getExpression('startTime');
    this._dependencyGraph.registerStartTimeDependencies(note.id, startTimeExpr);

    // Register frequency-specific dependencies for property-colored visualization
    const freqExpr = note.getExpression('frequency');
    this._dependencyGraph.registerFrequencyDependencies(note.id, freqExpr);

    // Register duration-specific dependencies for property-colored visualization
    const durExpr = note.getExpression('duration');
    this._dependencyGraph.registerDurationDependencies(note.id, durExpr);

    note._depsRegKey = regKey;
    note._depsRegModule = this;
  }

  /**
   * Mark a note as dirty (needs re-evaluation)
   */
  markNoteDirty(noteId) {
    const numId = Number(noteId);
    this._dirtyNotes.add(numId);

    // Update dependency graph for this note
    const note = this.getNoteById(numId);
    if (note) {
      this._registerNoteDependencies(note);
    }

    // Already reached by the walk of a note marked earlier in this dirty
    // cycle: everything that reads it is dirty already (the walk is
    // transitive), so only its own bytecode may be new. Callers commonly mark
    // a note and then each of its dependents; without this every one of those
    // walked its own dependents again, quadratic in the length of a chain.
    if (this._dirtyClosed.has(numId)) {
      if (this._incrementalEvaluator) {
        this._incrementalEvaluator.invalidate(numId, NO_DEPENDENTS);
      }
      return;
    }

    // Everything that reads this note, directly or through other notes. The walk
    // crosses the base note: whatever reads it (base.d, base.f, an inherited
    // amplitude) follows, and so does whatever reads those.
    const dependents = this._dependencyGraph.getEvaluationDependents(numId);

    // Invalidate incremental evaluator (this note's bytecode may have changed)
    if (this._incrementalEvaluator) {
      this._incrementalEvaluator.invalidate(numId, dependents);
    }

    // Also mark dependents as dirty (but don't invalidate - their bytecode hasn't changed)
    this._dirtyClosed.add(numId);
    for (const depId of dependents) {
      this._dirtyNotes.add(depId);
      this._dirtyClosed.add(depId);
      // Use markDirtyOnly for dependents - they need re-evaluation but not re-registration
      if (this._incrementalEvaluator && typeof this._incrementalEvaluator.markDirtyOnly === 'function') {
        this._incrementalEvaluator.markDirtyOnly(depId);
      }
    }
  }

  /**
   * Mark multiple notes as dirty in a single batch operation.
   * More efficient than calling markNoteDirty() repeatedly because it:
   * 1. Collects all IDs first, then processes dependencies in bulk
   * 2. Avoids redundant getAllDependents() calls for notes that will be marked anyway
   * 3. Does a single invalidateAll() on the incremental evaluator at the end
   *
   * @param {Iterable<number>} noteIds - IDs of notes to mark dirty
   */
  markNotesDirtyBatch(noteIds) {
    const idsToProcess = new Set();
    for (const id of noteIds) {
      idsToProcess.add(Number(id));
    }

    // First pass: register dependencies for all notes (updates the graph)
    for (const numId of idsToProcess) {
      const note = this.getNoteById(numId);
      if (note) {
        this._registerNoteDependencies(note);
      }
    }

    // Second pass: collect all notes that need to be dirty (including dependents AND dependencies)
    const allDirty = new Set(idsToProcess);

    // For each note, add its dependents (notes that depend on it, also
    // through the base note)
    const dependentsOf = new Map();
    for (const numId of idsToProcess) {
      const dependents = this._dependencyGraph.getEvaluationDependents(numId);
      dependentsOf.set(numId, dependents);
      for (const depId of dependents) {
        allDirty.add(depId);
      }
    }

    // CRITICAL: Also add transitive dependencies (notes that the dirty notes depend on)
    // This ensures that when invalidateAll() clears the evaluation cache,
    // dependency notes are also re-evaluated before their dependents.
    // Without this, frequency chains break because the dependency's frequency
    // isn't in the cache when the dependent note tries to load it.
    // We need transitive closure because A->B->C means A needs both B and C.
    const visited = new Set();
    const addDependenciesRecursive = (noteId) => {
      if (visited.has(noteId)) return;
      visited.add(noteId);
      const dependencies = this._dependencyGraph.getDependencies(noteId);
      for (const depId of dependencies) {
        allDirty.add(depId);
        addDependenciesRecursive(depId);
      }
    };
    for (const numId of idsToProcess) {
      addDependenciesRecursive(numId);
    }

    // Add all to dirty set
    for (const id of allDirty) {
      this._dirtyNotes.add(id);
    }

    // Selective invalidation - only mark affected notes dirty, not ALL notes
    if (this._incrementalEvaluator) {
      // Notes in idsToProcess may have new/changed bytecode - use invalidate()
      for (const id of idsToProcess) {
        this._incrementalEvaluator.invalidate(id, dependentsOf.get(id));
      }
      // Notes in allDirty (but not in idsToProcess) just need re-evaluation - use markDirtyOnly()
      for (const id of allDirty) {
        if (!idsToProcess.has(id)) {
          this._incrementalEvaluator.markDirtyOnly(id);
        }
      }
    }

  }

  /**
   * Set expressions on multiple notes in a single batch operation.
   * More efficient than calling setVariable() repeatedly because it:
   * 1. Skips per-note change notifications
   * 2. Batches dependency re-registration
   * 3. Marks all affected notes dirty in one pass
   *
   * @param {Array<{noteId: number, varName: string, expr: string}>} updates - Array of expression updates
   */
  batchSetExpressions(updates) {
    if (!updates || updates.length === 0) return;

    const affectedNoteIds = new Set();

    // Phase 1: Apply all expression changes silently (no per-note notifications)
    for (const { noteId, varName, expr } of updates) {
      const note = this.getNoteById(noteId);
      if (!note) {
        console.warn(`batchSetExpressions: Note ${noteId} not found`);
        continue;
      }

      // Handle both direct variable names and *String suffixed names
      const baseName = varName.endsWith('String') ? varName.slice(0, -6) : varName;

      if (typeof note._setExpressionSilent === 'function') {
        note._setExpressionSilent(baseName, expr);
      } else {
        // Fallback: compile directly (for compatibility)
        try {
          note.expressions[baseName] = compiler.compile(expr, baseName);
          if (typeof note._depsEpoch === 'number') note._depsEpoch++;
          note.lastModifiedTime = Date.now();
        } catch (e) {
          console.warn(`batchSetExpressions: Failed to compile ${baseName} for note ${noteId}:`, e);
        }
      }

      affectedNoteIds.add(noteId);
    }

    // Phase 2: Re-register dependencies for all affected notes
    for (const noteId of affectedNoteIds) {
      const note = this.getNoteById(noteId);
      if (note) {
        this._registerNoteDependencies(note);
      }
    }

    // Phase 3: Mark all affected notes (and their dependents) dirty in batch
    this.markNotesDirtyBatch(affectedNoteIds);
  }

  /**
   * Get direct dependencies of a note (O(1) via dependency graph)
   */
  getDirectDependencies(noteId) {
    const deps = this._dependencyGraph.getDependencies(noteId);
    return Array.from(deps);
  }

  /**
   * Get all notes that depend on this note (O(d) via inverted index)
   */
  getDependentNotes(noteId) {
    const deps = this._dependencyGraph.getAllDependents(noteId);
    const result = new Set(deps);

    // If this is base note (0), also include baseNoteDependents
    if (Number(noteId) === 0) {
      const baseNoteDeps = this._dependencyGraph.getBaseNoteDependents();
      for (const depId of baseNoteDeps) {
        result.add(depId);
      }
    }

    return Array.from(result);
  }

  /**
   * Get dependents categorized by which property of THIS note they reference
   * Used for property-colored dependency visualization
   *
   * The paradigm is:
   * - Orange (frequency): Notes that would MOVE if I change the selected note's FREQUENCY
   * - Teal (startTime): Notes that would MOVE if I change the selected note's STARTTIME
   * - Purple (duration): Notes that would MOVE if I change the selected note's DURATION
   *
   * @param {number} noteId
   * @returns {{ frequency: number[], startTime: number[], duration: number[] }}
   */
  getDependentsByProperty(noteId) {
    const graph = this._dependencyGraph;
    const numId = Number(noteId);

    // Use the new transitive traversal methods that properly follow all dependency chains
    // These methods do a BFS that tracks which property changed and propagates through
    // all dependent properties (startTime, frequency, duration) transitively
    const frequencyAffected = graph.getAllAffectedByFrequencyChange(numId);
    const startTimeAffected = graph.getAllAffectedByStartTimeChange(numId);
    const durationAffected = graph.getAllAffectedByDurationChange(numId);

    return {
      frequency: Array.from(frequencyAffected),
      startTime: Array.from(startTimeAffected),
      duration: Array.from(durationAffected)
    };
  }

  /**
   * Get dependencies categorized by which expression of THIS note references them
   * Used for property-colored dependency visualization
   *
   * @param {number} noteId
   * @returns {{ frequency: number[], startTime: number[], duration: number[] }}
   */
  getDirectDependenciesByProperty(noteId) {
    const graph = this._dependencyGraph;
    const numId = Number(noteId);
    const note = this.getNoteById(numId);

    // Get base arrays from dependency graph
    const freqArr = Array.from(graph.frequencyDependencies.get(numId) || new Set());
    const startArr = Array.from(graph.startTimeDependencies.get(numId) || new Set());
    const durArr = Array.from(graph.durationDependencies.get(numId) || new Set());

    // Include baseNote (0) if the expression references it
    // The referencesBase flag is tracked separately from the dependencies array
    if (note) {
      const freqExpr = note.getExpression('frequency');
      const startExpr = note.getExpression('startTime');
      const durExpr = note.getExpression('duration');

      if (freqExpr && freqExpr.referencesBase && !freqArr.includes(0)) {
        freqArr.push(0);
      }
      if (startExpr && startExpr.referencesBase && !startArr.includes(0)) {
        startArr.push(0);
      }
      if (durExpr && durExpr.referencesBase && !durArr.includes(0)) {
        durArr.push(0);
      }
    }

    return {
      frequency: freqArr,
      startTime: startArr,
      duration: durArr
    };
  }

  /**
   * Get the full parent chain for a specific property, walking backward to baseNote
   * Used for visualizing the complete dependency chain per variable
   *
   * @param {number} noteId - The note to start from
   * @param {string} property - 'frequency' | 'startTime' | 'duration'
   * @returns {number[]} - Array of note IDs from noteId back to baseNote/root (excluding noteId itself)
   */
  getParentChainByProperty(noteId, property) {
    const graph = this._dependencyGraph;
    const numId = Number(noteId);
    const chain = [];
    const visited = new Set([numId]);
    let current = numId;

    // Map property name to dependency map
    const depMapName = `${property}Dependencies`;
    const depMap = graph[depMapName];
    if (!depMap) return chain;

    // Also check for baseNote references
    const baseDepSetName = `${property}BaseNoteDependents`;
    const baseDepSet = graph[baseDepSetName];

    while (true) {
      const deps = depMap.get(current);

      // Check if current note references baseNote for this property
      if (baseDepSet && baseDepSet.has(current)) {
        chain.push(0); // baseNote ID is 0
        break;
      }

      if (!deps || deps.size === 0) break;

      // Find the next parent (first unvisited dependency)
      let parent = null;
      for (const depId of deps) {
        if (!visited.has(depId)) {
          parent = depId;
          break;
        }
      }
      if (parent === null) break;

      chain.push(parent);
      visited.add(parent);
      current = parent;
    }

    return chain; // Array of parent IDs (not including noteId itself)
  }

  /**
   * Get the children tree as edges for a specific property
   * Used for visualizing the dependent tree from selected note
   *
   * @param {number} noteId - The root note
   * @param {string} property - 'frequency' | 'startTime' | 'duration'
   * @returns {{ edges: Array<{parentId: number, childId: number, depth: number}>, maxDepth: number }}
   */
  getChildrenTreeByProperty(noteId, property) {
    return this._dependencyGraph.getChildrenTreeByProperty(noteId, property);
  }

  /**
   * Get the children tree for ALL properties in a single traversal (optimization).
   * @param {number} noteId - The root note
   * @returns {{ edgesByProperty: { frequency: Array, startTime: Array, duration: Array }, maxDepth: number }}
   */
  getChildrenTreeByAllProperties(noteId) {
    return this._dependencyGraph.getChildrenTreeByAllProperties(noteId);
  }

  /**
   * Add a new note
   */
  addNote(variables = {}) {
    this._recordEvaluation(null);
    this._historyIds = null;
    this._canPatchHistory = false;
    const id = this.nextId++;
    const note = new Note(id, variables);
    note.module = this;
    this.notes[id] = note;

    // Register dependencies
    this._registerNoteDependencies(note);

    // Mark dirty
    this.markNoteDirty(id);
    invalidateModuleEndTimeCache();

    return note;
  }

  /**
   * Remove a note
   */
  removeNote(id) {
    this._recordEvaluation(null);
    this._historyIds = null;
    this._canPatchHistory = false;
    const numId = Number(id);
    // Warn about dependents left dangling: a LOAD_REF to a removed note pushes
    // hardcoded evaluator defaults (frequency 440, startTime 0, duration 1)
    // with no error. The UI's delete paths liberate dependents first; this
    // guards programmatic callers.
    const dependents = this._dependencyGraph.getDependents(numId);
    const dangling = dependents
      ? Array.from(dependents).filter(depId => depId !== numId && this.notes[depId])
      : [];
    if (dangling.length > 0) {
      console.warn(
        `removeNote(${numId}): ${dangling.length} dependent note(s) left dangling: [${dangling.join(', ')}] — ` +
        `their references to note ${numId} will now evaluate to hardcoded defaults`
      );
    }
    delete this.notes[id];
    this._evaluationCache.delete(id);
    this._dependencyGraph.removeNote(id);

    if (this._incrementalEvaluator) {
      this._incrementalEvaluator.cache.delete(id);
    }

    // Re-evaluate the dangling notes, so they show now what a reload would
    // show (and the evaluator names each broken reference in the console).
    for (const depId of dangling) {
      this.markNoteDirty(depId);
    }

    invalidateModuleEndTimeCache();
  }

  /**
   * Remove every note except the base note and reset to a clean slate.
   * Deleting from `notes` directly is NOT equivalent: it leaves the deleted
   * ids' edges in the dependency graph, and with nextId reset to 1 a later
   * import reuses exactly those ids — inheriting phantom edges and, via the
   * registration memo, skipping re-registration entirely. Both corrupt the
   * evaluation order until the page is reloaded.
   */
  clearAllNotes() {
    this._historyIds = null;
    this._canPatchHistory = false;
    for (const id of Object.keys(this.notes)) {
      if (Number(id) !== 0) {
        delete this.notes[id];
      }
    }
    this.nextId = 1;

    this._dependencyGraph.clear();
    // New generation: every memo stamp from before the wipe is now invalid,
    // whatever module it came from.
    this._depsRegGeneration++;
    this._registerNoteDependencies(this.baseNote);

    this.invalidateAll();
    invalidateModuleEndTimeCache();
  }

  /**
   * Get a note by ID
   */
  getNoteById(id) {
    return this.notes[id];
  }

  /**
   * Evaluate all dirty notes and return the evaluation cache
   */
  evaluateModule() {
    if (this._evaluating) {
      // Reentrant call from an evaluation callback (bytecode CALL ops like
      // getVariable re-enter via getEvaluationCache). Serve the
      // in-progress cache: topological order guarantees any dependency the
      // callback needs is already finalized. Recursing here instead used to
      // re-run the whole dirty set per callback.
      return this._incrementalEvaluator ? this._incrementalEvaluator.cache : this._evaluationCache;
    }

    if (this._dirtyNotes.size === 0 && this._evaluationCache.size > 0) {
      return this._evaluationCache;
    }

    // Corruption flags only change for notes that get re-evaluated, so
    // capture the dirty set before it is cleared and scope the flag update
    // to it (previously this scanned ALL notes on every evaluation).
    const dirtyIds = this._dirtyNotes.size > 0 ? Array.from(this._dirtyNotes) : null;
    // The evaluation consumes the dirty sets: from here on a note marked dirty
    // walks its dependents again
    this._dirtyClosed.clear();

    this._evaluating = true;
    let cache;
    try {
      // Use incremental evaluator
      cache = this._incrementalEvaluator.evaluateDirty();
    } finally {
      this._evaluating = false;
    }

    // Update our cache reference
    this._evaluationCache = cache;

    // Update corruption flags in dependency graph after evaluation
    // This enables visual tinting for notes with irrational values (TET scales)
    this._updateCorruptionFlags(cache, dirtyIds);
    this._recordEvaluation(dirtyIds);

    this._dirtyNotes.clear();
    this._dirtyClosed.clear();

    return cache;
  }

  _recordEvaluation(ids) {
    this._evaluationRevision++;
    // A missed large batch requires a full sync. Keep a short journal because
    // edits may evaluate more than once before the workspace next draws.
    this._recentEvaluations.push(ids && ids.length <= 8192 ? ids : null);
    if (this._recentEvaluations.length > 8) this._recentEvaluations.shift();
  }

  evaluationChangesSince(revision) {
    const count = this._evaluationRevision - revision;
    if (!Number.isInteger(count) || count < 0 || count > this._recentEvaluations.length) return null;
    const ids = new Set();
    for (let i = this._recentEvaluations.length - count; i < this._recentEvaluations.length; i++) {
      const batch = this._recentEvaluations[i];
      if (!batch) return null;
      for (const id of batch) ids.add(id);
    }
    return ids;
  }

  /**
   * Update corruption flags in dependency graph from evaluation cache
   * @param {Map} cache - Evaluation cache with corruptionFlags per note
   * @param {Array<number>|null} noteIds - IDs to update (null = all notes)
   * @private
   */
  _updateCorruptionFlags(cache, noteIds = null) {
    if (!this._dependencyGraph || typeof this._dependencyGraph.setCorruptionFlags !== 'function') {
      return;
    }

    if (!cache || typeof cache.get !== 'function') {
      return;
    }

    try {
      // Fetch per-id from cache (rather than iterating cache.entries()) so
      // a cache that is not a Map would be handled as well.
      const ids = noteIds !== null ? noteIds : Object.keys(this.notes);
      for (const id of ids) {
        const noteId = Number(id);
        const result = cache.get(noteId);
        if (result && result.corruptionFlags !== undefined) {
          this._dependencyGraph.setCorruptionFlags(noteId, result.corruptionFlags);
        }
      }
    } catch (e) {
      // Silently fail - corruption tracking is a visual enhancement, not critical
    }
  }

  /**
   * Get the evaluation cache (for Note.getVariable)
   */
  getEvaluationCache() {
    // Ensure we have evaluated
    if (this._dirtyNotes.size > 0) {
      this.evaluateModule();
    }
    return this._evaluationCache;
  }

  /**
   * Evaluate a specific note's variable (for on-demand evaluation)
   */
  evaluateNoteVariable(noteId, varName) {
    // Ensure evaluation is up to date
    const cache = this.getEvaluationCache();
    const noteCache = cache.get(noteId);
    if (noteCache && noteCache[varName] !== undefined) {
      return noteCache[varName];
    }
    return null;
  }

  /**
   * The time unit: the reference note's evaluated duration in seconds (one
   * beat, if you count in beats). 60 / getTimeUnit() is the tempo in BPM, a
   * view only; nothing stores it.
   * @returns {Fraction}
   */
  getTimeUnit() {
    const d = this.baseNote.getVariable('duration');
    return (d && typeof d.compare === 'function' && d.compare(0) > 0) ? d : new Fraction(1);
  }

  /** All measure bars, unordered. */
  getMeasureNotes() {
    return Object.values(this.notes).filter(isMeasureNote);
  }

  /**
   * Find the amplitude (relative gain) a note sounds at: its own when it
   * defines one, else the BaseNote's, else 1. Same fallback the evaluator
   * applies to `[id].a`, so playback, export and expressions agree.
   * @returns {Fraction} exact and unclamped — each consumer clamps for its medium
   */
  findAmplitude(note) {
    if (note && note.id !== 0) {
      const own = note.getVariable('amplitude');
      if (own) return own;
    }
    return this.baseNote.getVariable('amplitude') || new Fraction(1);
  }

  /**
   * Find instrument for a note
   */
  /**
   * The instrument a note sounds with: its own, else along its START TIME (the
   * line it is in, through rests and silences, or the copy of a line it is;
   * else the note its start is written from), else the BaseNote's, else the
   * default. See src/players.js for the rule and the owner's words.
   * @param {object} note
   * @param {Map} [memo] resolved in this pass, by note id: a caller resolving many
   *   notes passes one Map, so each line is walked once rather than once per note
   */
  findInstrument(note, memo = null) {
    return instrumentOf(this, note, memo, _defaultInstrumentName);
  }

  /**
   * The player of a note: the first note of its line (which decides the
   * instrument) and the note it follows in the line (null for a first note).
   * @returns {{head:number, prev:number|null}}
   */
  findPlayer(note, memo = null) {
    return playerOf(this, note, memo);
  }

  /**
   * Append `n` measure bars after `fromNote`. A bar is a silent note flagged
   * `measure`: it starts where the previous one ends and lasts as long
   * (`[p].t + [p].d`, `[p].d`), so changing one bar's duration carries to the
   * bars that follow. From the BaseNote, the first bar starts at `base.t` and
   * lasts four time units (`base.d * 4`).
   */
  generateMeasures(fromNote, n) {
    const notesArray = [];

    for (let i = 0; i < n; i++) {
      const prevNote = (i === 0) ? fromNote : this.getNoteById(notesArray[i - 1].id);
      const vars = (!prevNote || prevNote.id === 0 || !isMeasureNote(prevNote))
        ? { startTime: 'base.t', duration: 'base.d * 4', measure: true }
        : { startTime: `[${prevNote.id}].t + [${prevNote.id}].d`, duration: `[${prevNote.id}].d`, measure: true };

      const newNote = this.addNote(vars);
      newNote.parentId = prevNote ? prevNote.id : 0;
      notesArray.push(newNote);
    }

    return notesArray;
  }

  /**
   * Load module from JSON file or object
   */
  static async loadFromJSON(source) {
    let data;

    if (typeof source === 'string') {
      const response = await fetch(source);
      data = await response.json();
    } else {
      data = source;
    }

    // A module written for the old time model (tempo, beats per measure,
    // beat()/measure()) is converted first, exactly; see migrate/relational-time.js.
    // A module it cannot convert throws a TimeMigrationError, never loads wrong.
    const migration = migrateTimeModel(data);
    if (migration.migrated) {
      data = migration.data;
      console.info('[RMT] Converted a module to relational time: ' + migration.report.join('; '));
    }
    // Then expressions in the retired method-chain syntax become DSL, exactly;
    // see migrate/legacy-syntax.js. One it cannot read as written throws a
    // SyntaxMigrationError naming the note.
    const syntax = migrateSyntax(data);
    if (syntax.migrated) {
      data = syntax.data;
      console.info('[RMT] ' + syntax.report.join('; '));
    }

    // Create base note variables from JSON
    const baseVars = {};
    for (const [key, value] of Object.entries(data.baseNote)) {
      baseVars[key] = value;
    }

    const moduleInstance = new Module(baseVars);

    let previousId = 0;
    moduleInstance._canPatchHistory = true;
    // Load notes
    // SECURITY: Blocked note IDs that could cause prototype pollution
    const blockedNoteIds = ['__proto__', 'constructor', 'prototype'];

    for (const noteData of data.notes) {
      const noteId = parseInt(noteData.id, 10);
      const variables = {};

      // SECURITY: Validate note ID to prevent prototype pollution and invalid values.
      // Cap at MAX_NOTE_ID (src/binary-note.js), the largest id a note can have:
      // a larger one is skipped, never truncated to another note.
      if (isNaN(noteId) || !Number.isInteger(noteId) || noteId < 0 || noteId > MAX_NOTE_ID) {
        console.warn(`[RMT Security] Invalid note ID: ${noteData.id} (must be 0-${MAX_NOTE_ID}), skipping`);
        continue;
      }

      // SECURITY: Check for prototype pollution vectors
      if (blockedNoteIds.includes(String(noteData.id))) {
        console.error(`[RMT Security] Blocked dangerous note ID: ${noteData.id}`);
        continue;
      }

      for (const [key, value] of Object.entries(noteData)) {
        if (key === 'id') continue;
        variables[key] = value;
      }

      if (noteId <= previousId) moduleInstance._canPatchHistory = false;
      previousId = noteId;
      const note = new Note(noteId, variables);
      note.module = moduleInstance;
      moduleInstance.notes[noteId] = note;

      // Register dependencies
      moduleInstance._registerNoteDependencies(note);

      if (noteId >= moduleInstance.nextId) {
        moduleInstance.nextId = noteId + 1;
      }
    }

    // A module saved before instruments followed the start time (Phase I) keeps the
    // instruments it had: the notes the new rule would move to another instrument
    // get their old one written onto them (src/players.js, migrateInstrumentRule).
    if (data.instrumentRule !== INSTRUMENT_RULE) {
      const pinned = migrateInstrumentRule(moduleInstance, _defaultInstrumentName);
      if (pinned.length) {
        console.info(`[RMT] Instruments now follow the start time; kept the instrument of ${pinned.length} note(s) as before: ${pinned.slice(0, 20).join(', ')}${pinned.length > 20 ? ', …' : ''}`);
      }
    }

    // Mark all notes dirty for initial evaluation using invalidateAll for clean slate
    moduleInstance.invalidateAll();

    return moduleInstance;
  }

  /**
   * Export module as ordered JSON
   */
  async exportOrderedModule() {
    const moduleData = this.createModuleJSON();
    const tempModule = await Module.loadFromJSON(moduleData);
    tempModule.reindexModule();
    return JSON.stringify(tempModule.createModuleJSON(), null, 2);
  }

  /**
   * Create JSON representation of module
   */
  createModuleJSON() {
    const moduleObj = {};

    // Export base note
    moduleObj.baseNote = this._baseNoteJSON();

    // Export notes
    const notesArray = [];
    for (const note of Object.values(this.notes)) {
      if (note.id === 0) continue;
      notesArray.push(noteJSON(note));
    }

    notesArray.sort((a, b) => a.id - b.id);
    moduleObj.notes = notesArray;
    // Saved under the start-time instrument rule: loading it again migrates nothing.
    moduleObj.instrumentRule = INSTRUMENT_RULE;

    return moduleObj;
  }

  /**
   * The module as JSON text: exactly JSON.stringify(this.createModuleJSON()),
   * which is what undo history and the autosave store on every edit.
   *
   * Each note's text is kept from the last call and used again while what it
   * is made of (the note's id, its six expression sources, its colour,
   * instrument and measure flag) reads the same; only the notes an edit
   * changed are serialized again. Every note is still read on each call, so
   * an edit made by any route (the expressions or properties written
   * directly) is picked up. scripts/test-edit-cost.mjs holds the two to
   * the same text.
   */
  createModuleJSONString() {
    const entries = [];
    for (const note of Object.values(this.notes)) {
      if (note.id === 0) continue;
      entries.push(noteJSONText(note));
    }
    entries.sort((a, b) => a.id - b.id);
    const texts = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) texts[i] = entries[i].text;

    // The frame around the notes, with the same keys in the same order as
    // createModuleJSON(): baseNote, notes, instrumentRule
    const head = JSON.stringify({ baseNote: this._baseNoteJSON() });
    const tail = JSON.stringify({ instrumentRule: INSTRUMENT_RULE });
    return head.slice(0, -1) + ',"notes":[' + texts.join(',') + ']' +
      (tail === '{}' ? '' : ',' + tail.slice(1, -1)) + '}';
  }

  // The editor knows which mutations it just committed. Imports, deletes and
  // captures from arbitrary callers take a complete checkpoint instead. Public
  // createModuleJSONString() also accepts direct edits to the exposed fields.
  historySnapshot(tracked = false) {
    const prior = this._historyVersion;
    const partial = tracked && prior && this._historyIds && !this._untrackedProperties;
    let ids;
    if (partial) {
      ids = this._historyIds;
      // Some controls write a plain property and supply its ID at capture.
      if (Array.isArray(tracked)) for (const id of tracked) ids.add(Number(id));
    } else {
      const keys = Object.keys(this.notes);
      ids = keys.map(Number);
      // Directly aliased note objects and nonstandard keys are accepted by the
      // general serializer. They cannot be addressed by id in a page.
      if (ids.some((id, i) => !Number.isSafeInteger(id) || id < 0 ||
          String(id) !== keys[i] || this.notes[id]?.id !== id)) {
        this._historyVersion = null;
        this._canPatchHistory = false;
        return { snapshotStr: this.createModuleJSONString() };
      }
      if (prior) this._canPatchHistory = false;
      this._untrackedProperties = false;
    }
    const base = this.baseNote.properties;
    if (!this.baseNote.hasExpression('frequency') || !this.baseNote.hasExpression('duration') ||
        !this.baseNote.hasExpression('startTime') || base.measure || (base.color !== null && !base.color) ||
        (base.instrument !== null && !base.instrument) || (base.repeat !== undefined && !base.repeat)) {
      this._canPatchHistory = false;
    }
    const row = id => {
      const note = this.notes[id];
      if (!note) return undefined;
      const { color, instrument, measure } = note.properties;
      if (!isPrimitive(color) || !isPrimitive(instrument) || !isPrimitive(measure)) this._untrackedProperties = true;
      if (note.parentId !== undefined || note.properties.repeat !== undefined ||
          (color !== null && !color) || (instrument !== null && !instrument)) this._canPatchHistory = false;
      return JSON.stringify(noteJSON(note));
    };
    const version = snapshotPages(partial ? prior : null, ids, row,
      JSON.stringify(this._baseNoteJSON()), JSON.stringify(INSTRUMENT_RULE));
    version.origin = this._historyOrigin || (this._historyOrigin = Symbol());
    this._historyVersion = version;
    this._historyIds = new Set();
    return { snapshotStr: version.text, version };
  }

  // A fresh load establishes graph insertion order. Keep it for expression
  // edits that read the same variables. A rewire or structural edit uses the
  // loader on the next restore, which reestablishes that order from the text.
  noteExpressionChanged(id, previous, next) {
    if (!this._historyIds) return;
    this._historyIds.add(id);
    if (!this._canPatchHistory || previous === next) return;
    if (!previous?.getVariableRefs || !next?.getVariableRefs) {
      this._canPatchHistory = false;
      return;
    }
    const a = previous.getVariableRefs(), b = next.getVariableRefs();
    if (id === 0 || previous.isEmpty() !== next.isEmpty() ||
        previous.referencesBase !== next.referencesBase || previous.depCount !== next.depCount ||
        a.length !== b.length || a.some((v, i) => v !== b[i])) this._canPatchHistory = false;
    for (let i = 0; i < previous.depCount; i++) {
      if (previous.dependencies[i] !== next.dependencies[i] ||
          (previous.referencesBase && previous.dependencies[i] === 0)) this._canPatchHistory = false;
    }
  }

  restoreHistoryVersion(target) {
    if (!target || target.origin !== this._historyOrigin || !this._canPatchHistory || !this._historyVersion || this._historyIds?.size ||
        this._untrackedProperties || target.baseText !== this._historyVersion.baseText) return false;
    const changes = changedRows(this._historyVersion, target);
    const replacements = [];
    for (const { id, from, to } of changes) {
      if (!from || !to) return false;
      const current = this.notes[id];
      if (!current) return false;
      const replacement = new Note(id, JSON.parse(to));
      // A redo may cross a previous full restore into a different topology.
      for (const name of EXPRESSION_VARS) {
        this.noteExpressionChanged(id, current.expressions[name], replacement.expressions[name]);
      }
      if (!this._canPatchHistory) return false;
      replacements.push(replacement);
    }
    for (const note of replacements) {
      note.module = this;
      this.notes[note.id] = note;
      this.markNoteDirty(note.id);
    }
    this._historyIds.clear();
    this._historyVersion = target;
    return true;
  }

  /** The BaseNote as saved in the module JSON. */
  _baseNoteJSON() {
    const baseObj = {};
    for (const name of EXPRESSION_VARS) {
      const source = this.baseNote.getExpressionSource(name);
      if (source) {
        baseObj[name] = source;
      }
    }
    if (this.baseNote.properties.color) baseObj.color = this.baseNote.properties.color;
    if (this.baseNote.properties.instrument) baseObj.instrument = this.baseNote.properties.instrument;
    if (this.baseNote.properties.repeat) baseObj.repeat = this.baseNote.properties.repeat;
    return baseObj;
  }

  /**
   * Reindex module (renumber notes in order)
   */
  reindexModule() {
    this._recordEvaluation(null);
    this._historyIds = null;
    this._canPatchHistory = false;
    const baseNote = this.baseNote;

    // Separate measures and regular notes
    const measureNotes = [];
    const regularNotes = [];

    for (const id in this.notes) {
      const note = this.notes[id];
      if (Number(id) === 0) continue;

      if (isMeasureNote(note)) {
        measureNotes.push(note);
      } else {
        regularNotes.push(note);
      }
    }

    // Sort by startTime — exact comparison (a valueOf() subtraction collapses
    // rationals that differ past double precision), with id tie-break so
    // export renumbering stays deterministic.
    const sortByStartTime = (a, b) => {
      const aStart = a.getExactVariable('startTime');
      const bStart = b.getExactVariable('startTime');
      if (!aStart || !bStart) return a.id - b.id;
      try {
        const cmp = compareExact(aStart, bStart);
        if (cmp !== 0) return cmp;
      } catch (e) { /* non-Fraction value — fall through to id order */ }
      return a.id - b.id;
    };

    measureNotes.sort(sortByStartTime);
    regularNotes.sort(sortByStartTime);

    // Build ID mapping
    const newMapping = { 0: 0 };
    let newId = 1;

    for (const note of measureNotes) {
      newMapping[note.id] = newId++;
    }
    for (const note of regularNotes) {
      newMapping[note.id] = newId++;
    }

    // Track parent relationships
    const parentRelationships = {};
    for (const id in this.notes) {
      const note = this.notes[id];
      if (note.parentId !== undefined) {
        parentRelationships[id] = note.parentId;
      }
    }

    // Update expression references: [N] -> [new id]
    const updateReferences = (exprText) => {
      const updated = exprText.replace(/\[(\d+)\]/g, (match, p1) => {
        const oldRefId = parseInt(p1, 10);
        const newRefId = newMapping[oldRefId];
        if (typeof newRefId !== 'number') {
          console.warn('No new mapping found for old id ' + oldRefId);
          return match;
        }
        return '[' + newRefId + ']';
      });
      return updated;
    };

    // Rebuild notes with new IDs
    const newNotes = { 0: baseNote };

    for (const oldId in this.notes) {
      if (Number(oldId) === 0) continue;

      const note = this.notes[oldId];
      const updatedId = newMapping[note.id];

      // Create new variables with updated references
      const variables = {};
      const exprNames = EXPRESSION_VARS;

      for (const name of exprNames) {
        const source = note.getExpressionSource(name);
        if (source) {
          variables[name] = updateReferences(source);
        }
      }

      if (note.properties.color) variables.color = note.properties.color;
      if (note.properties.instrument) variables.instrument = note.properties.instrument;
      if (note.properties.measure) variables.measure = true;

      const newNote = new Note(updatedId, variables);
      newNote.module = this;

      // Update parent reference
      if (parentRelationships[oldId] !== undefined) {
        const oldParentId = parentRelationships[oldId];
        newNote.parentId = newMapping[oldParentId] !== undefined ? newMapping[oldParentId] : 0;
      }

      newNotes[updatedId] = newNote;
    }

    // Replace notes
    this.notes = newNotes;
    this.nextId = newId;

    // Rebuild dependency graph
    this._dependencyGraph.clear();
    this._depsRegGeneration++; // invalidate cached registration keys (e.g., reused baseNote)
    this._evaluationCache.clear();
    this._dirtyNotes.clear();
    this._dirtyClosed.clear();

    for (const id in this.notes) {
      const note = this.notes[id];
      this._registerNoteDependencies(note);
      this._dirtyNotes.add(Number(id));
    }

    if (this._incrementalEvaluator) {
      this._incrementalEvaluator.invalidateAll();
    }

    // Evaluate all notes to repopulate corruption flags in dependency graph.
    // This is critical: reindexing clears the graph's corruptionFlags Map,
    // and evaluateModule() calls _updateCorruptionFlags() to restore them
    // for correct transitive corruption detection and visualization.
    this.evaluateModule();

    invalidateModuleEndTimeCache();
  }

  /**
   * Invalidate all cached evaluations
   */
  invalidateAll() {
    this._recordEvaluation(null);
    this._evaluationCache.clear();
    this._dirtyNotes.clear();
    this._dirtyClosed.clear();

    for (const id of Object.keys(this.notes)) {
      this._dirtyNotes.add(Number(id));
    }

    if (this._incrementalEvaluator) {
      this._incrementalEvaluator.invalidateAll();
    }
  }

  // One maximum per 128 note IDs. Sound ends use the same exact addition and
  // final conversion as the transport. Measure ties are resolved by each caller.
  getTimingSummary() {
    const blockSize = 128;
    const values = this.evaluateModule();
    const previous = this._timingSummary;
    if (previous?.revision === this._evaluationRevision && previous.generation === timingGeneration) return previous;
    const dirty = previous?.generation === timingGeneration ? this.evaluationChangesSince(previous.revision) : null;
    const blocks = dirty ? previous.blocks : new Map();
    const measureIds = dirty ? previous.measureIds : new Set();
    const noteEnd = note => {
      if (!note.hasExpression('startTime') || !note.hasExpression('duration') || !note.hasExpression('frequency')) return 0;
      const record = note.module === this ? values.get(note.id) : null;
      const start = record?.startTime ?? note.getVariable('startTime');
      const duration = record?.duration ?? note.getVariable('duration');
      if (!start || !duration) return 0;
      try { return toNumber(start.add(duration)); }
      catch { return toNumber(start) + toNumber(duration); }
    };
    const visit = (id, block) => {
      const note = this.notes[id];
      if (!note) return;
      if (isMeasureNote(note)) measureIds.add(id);
      if (!id) return;
      const end = noteEnd(note);
      if (end > (blocks.get(block) || 0)) blocks.set(block, end);
    };
    if (dirty) {
      const touched = new Set();
      for (const id of dirty) {
        touched.add(Math.floor(id / blockSize));
        measureIds.delete(id);
      }
      for (const block of touched) {
        blocks.delete(block);
        for (let id = block * blockSize; id < (block + 1) * blockSize; id++) visit(id, block);
      }
    } else {
      for (const key in this.notes) {
        const id = Number(key);
        visit(id, Math.floor(id / blockSize));
      }
    }
    let soundEnd = 0;
    for (const end of blocks.values()) if (end > soundEnd) soundEnd = end;
    const measures = Array.from(measureIds).sort((a, b) => a - b).map(id => this.notes[id]);
    return this._timingSummary = {
      revision: this._evaluationRevision, generation: timingGeneration, blocks, measureIds, measures, soundEnd
    };
  }

  getModuleEndTime() {
    const timing = this.getTimingSummary();
    if (timing.moduleEnd !== undefined) return timing.moduleEnd;
    const measureNotes = timing.measures;

    let measureEnd = 0;
    if (measureNotes.length > 0) {
      // Find last measure by startTime without full sort — exact comparison,
      // one lossy conversion at the end (a NaN from valueOf overflow here
      // used to cascade into silent playback and a never-stopping playhead).
      let lastMeasure = measureNotes[0];
      let lastMeasureStart = lastMeasure.getExactVariable('startTime');

      for (let i = 1; i < measureNotes.length; i++) {
        const note = measureNotes[i];
        const noteStart = note.getExactVariable('startTime');
        if (noteStart && lastMeasureStart) {
          try {
            if (compareExact(noteStart, lastMeasureStart) > 0) {
              lastMeasure = note;
              lastMeasureStart = noteStart;
            }
          } catch (e) { /* non-Fraction value — keep current candidate */ }
        }
      }

      const lastMeasureLength = lastMeasure.getVariable('duration');
      if (lastMeasureStart && lastMeasureLength) {
        measureEnd = toNumber(lastMeasureStart.add(lastMeasureLength));
      }
    }

    return timing.moduleEnd = Math.max(measureEnd, timing.soundEnd);
  }

  /**
   * Get dependency graph (for debugging)
   */
  getDependencyGraph() {
    return this._dependencyGraph;
  }

  /**
   * Get pool statistics (for performance monitoring)
   */
  getPoolStats() {
    return this._binaryEvaluator.getPoolStats();
  }
}
