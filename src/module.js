import Fraction from 'fraction.js';
import { Note } from './note.js';
import { DependencyGraph } from './dependency-graph.js';
import { createEvaluator, createIncrementalEvaluator } from './wasm/evaluator-adapter.js';
import { compiler, decompiler } from './expression-compiler.js';

let memoizedModuleEndTime = null;
let moduleLastModifiedTime = 0;

export function invalidateModuleEndTimeCache() {
  memoizedModuleEndTime = null;
  moduleLastModifiedTime = Date.now();
}

/**
 * Module class - Binary-native implementation
 *
 * All expression evaluation is done through the binary evaluator.
 * No Function-based evaluation or *String dual storage.
 */
export class Module {
  constructor(baseNoteVariables = {}) {
    this.notes = {};
    this.nextId = 1;

    // Binary evaluation infrastructure
    // Uses WASM evaluator when available, falls back to JS automatically
    this._dependencyGraph = new DependencyGraph();
    this._binaryEvaluator = createEvaluator(this);
    this._incrementalEvaluator = createIncrementalEvaluator(
      this, // Module reference (we use notes Map interface)
      this._dependencyGraph,
      this._binaryEvaluator
    );

    // Evaluation cache (Map<noteId, {startTime, duration, ...}>)
    this._evaluationCache = new Map();
    this._dirtyNotes = new Set();

    // Create base note with default values
    const defaultBaseNoteVariables = {
      frequency: 'new Fraction(440)',
      startTime: 'new Fraction(0)',
      tempo: 'new Fraction(60)',
      beatsPerMeasure: 'new Fraction(4)',
      instrument: 'sine-wave',
      measureLength: "new Fraction(60).div(module.findTempo(module.baseNote)).mul(module.baseNote.getVariable('beatsPerMeasure'))",
    };

    // Merge defaults with provided variables (convert functions to strings if needed)
    const finalVars = { ...defaultBaseNoteVariables };
    for (const [key, value] of Object.entries(baseNoteVariables)) {
      if (key === 'color' || key === 'instrument') {
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
   * Register a note's dependencies in the graph
   */
  _registerNoteDependencies(note) {
    const allDeps = note.getAllDependencies();
    const refsBase = note.referencesBaseNote();
    this._dependencyGraph._updateDependencies(note.id, allDeps, refsBase);

    // Also register startTime-specific dependencies for drag preview
    const startTimeExpr = note.getExpression('startTime');
    this._dependencyGraph.registerStartTimeDependencies(note.id, startTimeExpr);

    // Register frequency-specific dependencies for property-colored visualization
    const freqExpr = note.getExpression('frequency');
    this._dependencyGraph.registerFrequencyDependencies(note.id, freqExpr);

    // Register duration-specific dependencies for property-colored visualization
    const durExpr = note.getExpression('duration');
    this._dependencyGraph.registerDurationDependencies(note.id, durExpr);
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

    // Invalidate incremental evaluator (this note's bytecode may have changed)
    if (this._incrementalEvaluator) {
      this._incrementalEvaluator.invalidate(numId);
    }

    // Also mark dependents as dirty (but don't invalidate - their bytecode hasn't changed)
    const dependents = this._dependencyGraph.getAllDependents(numId);
    for (const depId of dependents) {
      this._dirtyNotes.add(depId);
      // Use markDirtyOnly for dependents - they need re-evaluation but not re-registration
      if (this._incrementalEvaluator && typeof this._incrementalEvaluator.markDirtyOnly === 'function') {
        this._incrementalEvaluator.markDirtyOnly(depId);
      }
    }

    // If this is the base note (0), also mark all baseNoteDependents as dirty
    // These are notes that reference baseNote via module.baseNote, findTempo, findMeasureLength
    if (numId === 0) {
      const baseNoteDeps = this._dependencyGraph.getBaseNoteDependents();
      for (const depId of baseNoteDeps) {
        this._dirtyNotes.add(depId);
        if (this._incrementalEvaluator && typeof this._incrementalEvaluator.markDirtyOnly === 'function') {
          this._incrementalEvaluator.markDirtyOnly(depId);
        }
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

    // Check if base note is being marked - if so, add all base note dependents
    if (idsToProcess.has(0)) {
      const baseNoteDeps = this._dependencyGraph.getBaseNoteDependents();
      for (const depId of baseNoteDeps) {
        allDirty.add(depId);
      }
    }

    // For each note, add its dependents (notes that depend on it)
    for (const numId of idsToProcess) {
      const dependents = this._dependencyGraph.getAllDependents(numId);
      for (const depId of dependents) {
        allDirty.add(depId);
      }
    }

    // CRITICAL: Also add transitive dependencies (notes that the dirty notes depend on)
    // This ensures that when invalidateAll() clears the WASM cache,
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
        this._incrementalEvaluator.invalidate(id);
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
    delete this.notes[id];
    this._evaluationCache.delete(id);
    this._dependencyGraph.removeNote(id);

    if (this._incrementalEvaluator) {
      this._incrementalEvaluator.cache.delete(id);
    }

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
    if (this._dirtyNotes.size === 0 && this._evaluationCache.size > 0) {
      return this._evaluationCache;
    }

    // Use incremental evaluator
    const cache = this._incrementalEvaluator.evaluateDirty();

    // Update our cache reference
    this._evaluationCache = cache;

    // Update corruption flags in dependency graph after evaluation
    // This enables visual tinting for notes with irrational values (TET scales)
    this._updateCorruptionFlags(cache);

    this._dirtyNotes.clear();

    return cache;
  }

  /**
   * Update corruption flags in dependency graph from evaluation cache
   * @param {Map} cache - Evaluation cache with corruptionFlags per note
   * @private
   */
  _updateCorruptionFlags(cache) {
    if (!this._dependencyGraph || typeof this._dependencyGraph.setCorruptionFlags !== 'function') {
      return;
    }

    if (!cache || typeof cache.get !== 'function') {
      return;
    }

    try {
      // Always iterate through all notes and fetch from cache
      // This ensures we handle both regular Maps and lazy cache proxies correctly
      // (Lazy proxies' entries() method only yields locally-cached items, missing WASM-resident data)
      for (const id of Object.keys(this.notes)) {
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
   * Find tempo for a note (walks inheritance chain)
   */
  findTempo(note) {
    if (!note) return this.baseNote.getVariable('tempo') || new Fraction(60);

    let current = note;
    while (current) {
      if (current.hasExpression('tempo')) {
        return current.getVariable('tempo');
      }
      current = current.parentId !== undefined ? this.getNoteById(current.parentId) : null;
    }
    return this.baseNote.getVariable('tempo') || new Fraction(60);
  }

  /**
   * Find measure length for a note
   */
  findMeasureLength(note) {
    const tempo = this.findTempo(note);

    // Find beatsPerMeasure
    let beatsPerMeasure = null;
    const isMeasure = (n) => {
      try {
        return !!(n && n.hasExpression('startTime') && !n.hasExpression('duration') && !n.hasExpression('frequency'));
      } catch {
        return false;
      }
    };

    // Check direct per-note override
    if (note && note.hasExpression('beatsPerMeasure')) {
      beatsPerMeasure = note.getVariable('beatsPerMeasure');
    } else {
      // Walk up ancestry (skip measure ancestors)
      let cur = note;
      while (cur && cur.id !== 0) {
        cur = this.getNoteById(cur.parentId);
        if (!cur) break;
        if (cur.hasExpression('beatsPerMeasure') && !isMeasure(cur)) {
          beatsPerMeasure = cur.getVariable('beatsPerMeasure');
          break;
        }
      }
      if (!beatsPerMeasure) {
        beatsPerMeasure = this.baseNote.getVariable('beatsPerMeasure');
      }
    }

    if (!beatsPerMeasure) beatsPerMeasure = new Fraction(4);
    if (!tempo) return beatsPerMeasure.mul(1); // 1 second per beat default

    return beatsPerMeasure.div(tempo).mul(60);
  }

  /**
   * Find instrument for a note
   */
  findInstrument(note) {
    if (!note) return 'sine-wave';
    if (!note.hasExpression('frequency') && !note.getVariable('frequency')) {
      return 'sine-wave';
    }

    // Check direct instrument property
    if (note.properties.instrument) {
      return note.properties.instrument;
    }

    // Check frequency expression for parent reference
    const freqSource = note.getExpressionSource('frequency');
    if (freqSource) {
      const noteRefMatch = freqSource.match(/module\.getNoteById\((\d+)\)\.getVariable\('frequency'\)/);
      if (noteRefMatch) {
        const parentId = parseInt(noteRefMatch[1], 10);
        const parentNote = this.getNoteById(parentId);
        if (parentNote) return this.findInstrument(parentNote);
      }

      if (freqSource.includes("module.baseNote.getVariable('frequency')")) {
        return this.findInstrument(this.baseNote);
      }
    }

    return 'sine-wave';
  }

  /**
   * Generate measure notes starting from a given note
   */
  generateMeasures(fromNote, n) {
    const notesArray = [];

    for (let i = 0; i < n; i++) {
      const prevNote = (i === 0) ? fromNote : this.getNoteById(notesArray[i - 1].id);

      let rawString;
      if (prevNote.id === 0) {
        rawString = "module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote))";
      } else {
        rawString = `module.getNoteById(${prevNote.id}).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(${prevNote.id})))`;
      }

      const newNote = this.addNote({
        startTime: rawString
      });
      newNote.parentId = prevNote.id;
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

    // Create base note variables from JSON
    const baseVars = {};
    for (const [key, value] of Object.entries(data.baseNote)) {
      baseVars[key] = value;
    }

    const moduleInstance = new Module(baseVars);

    // Load notes
    // SECURITY: Blocked note IDs that could cause prototype pollution
    const blockedNoteIds = ['__proto__', 'constructor', 'prototype'];

    for (const noteData of data.notes) {
      const noteId = parseInt(noteData.id, 10);
      const variables = {};

      // SECURITY: Validate note ID to prevent prototype pollution and invalid values
      if (isNaN(noteId) || !Number.isInteger(noteId) || noteId < 0 || noteId > 100000) {
        console.warn(`[RMT Security] Invalid note ID: ${noteData.id}, skipping`);
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

      const note = new Note(noteId, variables);
      note.module = moduleInstance;
      moduleInstance.notes[noteId] = note;

      // Register dependencies
      moduleInstance._registerNoteDependencies(note);

      if (noteId >= moduleInstance.nextId) {
        moduleInstance.nextId = noteId + 1;
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
    const baseObj = {};
    const baseExprs = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    for (const name of baseExprs) {
      const source = this.baseNote.getExpressionSource(name);
      if (source) {
        baseObj[name] = source;
      }
    }
    if (this.baseNote.properties.color) baseObj.color = this.baseNote.properties.color;
    if (this.baseNote.properties.instrument) baseObj.instrument = this.baseNote.properties.instrument;
    moduleObj.baseNote = baseObj;

    // Export notes
    const notesArray = [];
    for (const note of Object.values(this.notes)) {
      if (note.id === 0) continue;

      const noteObj = { id: note.id };
      for (const name of baseExprs) {
        const source = note.getExpressionSource(name);
        if (source) {
          noteObj[name] = source;
        }
      }
      if (note.properties.color) noteObj.color = note.properties.color;
      if (note.properties.instrument) noteObj.instrument = note.properties.instrument;

      notesArray.push(noteObj);
    }

    notesArray.sort((a, b) => a.id - b.id);
    moduleObj.notes = notesArray;

    return moduleObj;
  }

  /**
   * Reindex module (renumber notes in order)
   */
  reindexModule() {
    const baseNote = this.baseNote;

    // Separate measures and regular notes
    const measureNotes = [];
    const regularNotes = [];

    for (const id in this.notes) {
      const note = this.notes[id];
      if (Number(id) === 0) continue;

      const isMeasure = note.hasExpression('startTime') &&
                        !note.hasExpression('duration') &&
                        !note.hasExpression('frequency');

      if (isMeasure) {
        measureNotes.push(note);
      } else {
        regularNotes.push(note);
      }
    }

    // Sort by startTime
    const sortByStartTime = (a, b) => {
      const aStart = a.getVariable('startTime');
      const bStart = b.getVariable('startTime');
      if (!aStart || !bStart) return 0;
      return aStart.valueOf() - bStart.valueOf();
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

    // Update expression references
    const updateReferences = (exprText) => {
      return exprText.replace(/(?:module\.)?getNoteById\(\s*(\d+)\s*\)/g, (match, p1) => {
        const oldRefId = parseInt(p1, 10);
        if (oldRefId === 0) {
          return 'module.baseNote';
        }
        const newRefId = newMapping[oldRefId];
        if (typeof newRefId !== 'number') {
          console.warn('No new mapping found for old id ' + oldRefId);
          return match;
        }
        return 'module.getNoteById(' + newRefId + ')';
      });
    };

    // Rebuild notes with new IDs
    const newNotes = { 0: baseNote };

    for (const oldId in this.notes) {
      if (Number(oldId) === 0) continue;

      const note = this.notes[oldId];
      const updatedId = newMapping[note.id];

      // Create new variables with updated references
      const variables = {};
      const exprNames = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

      for (const name of exprNames) {
        const source = note.getExpressionSource(name);
        if (source) {
          variables[name] = updateReferences(source);
        }
      }

      if (note.properties.color) variables.color = note.properties.color;
      if (note.properties.instrument) variables.instrument = note.properties.instrument;

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
    this._evaluationCache.clear();
    this._dirtyNotes.clear();

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
    this._evaluationCache.clear();
    this._dirtyNotes.clear();

    for (const id of Object.keys(this.notes)) {
      this._dirtyNotes.add(Number(id));
    }

    if (this._incrementalEvaluator) {
      this._incrementalEvaluator.invalidateAll();
    }
  }

  /**
   * Get the module end time (cached for performance)
   * Returns the time in seconds when the last note/measure ends
   */
  getModuleEndTime() {
    // Use cached value if available and module hasn't changed
    if (memoizedModuleEndTime !== null && this._dirtyNotes.size === 0) {
      return memoizedModuleEndTime;
    }

    // Ensure evaluation cache is up to date
    this.evaluateModule();

    // Compute measure end time
    const measureNotes = Object.values(this.notes).filter(note =>
      note.variables.startTime && !note.variables.duration && !note.variables.frequency
    );

    let measureEnd = 0;
    if (measureNotes.length > 0) {
      // Find last measure by startTime without full sort
      let lastMeasure = measureNotes[0];
      let lastMeasureStart = lastMeasure.getVariable('startTime');

      for (let i = 1; i < measureNotes.length; i++) {
        const note = measureNotes[i];
        const noteStart = note.getVariable('startTime');
        if (noteStart && lastMeasureStart && noteStart.valueOf() > lastMeasureStart.valueOf()) {
          lastMeasure = note;
          lastMeasureStart = noteStart;
        }
      }

      if (lastMeasureStart) {
        measureEnd = lastMeasureStart.add(this.findMeasureLength(lastMeasure)).valueOf();
      }
    }

    // Compute last note end time
    let lastNoteEnd = 0;
    for (const id in this.notes) {
      const note = this.notes[id];
      if (note.variables.startTime && note.variables.duration && note.variables.frequency) {
        const noteStart = note.getVariable('startTime');
        const noteDuration = note.getVariable('duration');
        if (noteStart && noteDuration) {
          const noteEnd = noteStart.valueOf() + noteDuration.valueOf();
          if (noteEnd > lastNoteEnd) lastNoteEnd = noteEnd;
        }
      }
    }

    memoizedModuleEndTime = Math.max(measureEnd, lastNoteEnd);
    return memoizedModuleEndTime;
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
